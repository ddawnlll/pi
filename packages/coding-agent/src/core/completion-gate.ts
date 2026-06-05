/**
 * Completion Gate - P4.6.1 / P9.G7
 *
 * Hardened completion gate for workspaces and plans.
 * A workspace/plan must NOT be marked complete if:
 * - Validation failed
 * - Retries were exhausted
 * - Unresolved error events exist
 * - A validation command is still running
 * - Watch-mode validation was attempted
 * - Governance ledger is missing or incomplete (P9.G7)
 *
 * All checks are scoped by planExecId + workspaceId.
 * Events from different planExecId or workspaceId are ignored.
 *
 * P9.G7: Governance ledger integration requires a complete ledger entry
 * before marking any workspace or plan done.
 */

import type { GovernanceLedger } from "./governance-ledger.js";
import type { FailureSignal } from "./log-failure-detector.js";
import { FailureSignalCategory } from "./log-failure-detector.js";
import type { WorkspaceState } from "./plan-state.js";
import { isWatchModeCommand } from "./watch-mode-guard.js";
import type { WorkspaceCommitGateConfig } from "./workspace-commit-gate.js";
import { WorkspaceCommitGate } from "./workspace-commit-gate.js";
import type { Workspace } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Dangerous git command patterns (matching WorkspaceCommitGate semantics)
// ---------------------------------------------------------------------------

const DANGEROUS_GIT_COMMAND_PATTERNS = [
	/^git\s+add\s*\.\s*$/,
	/^git\s+add\s+-A\s*$/,
	/^git\s+add\s+--all\s*$/,
	/^git\s+add\s+--\s*\.\s*$/,
	/^git\s+add\s+--\s+'?:\/'?\s*$/,
	/^git\s+add\s+'?:\/'?\s*$/,
	/^git\s+commit\s+-a\b/,
	/^git\s+commit\s+--all\b/,
	/^git\s+commit\s+-am\b/,
	// Chained forms
	/^git\s+add\s*\.\s*&&\s*git\s+commit/,
	/^git\s+add\s+-A\s*&&\s*git\s+commit/,
	/^git\s+add\s+--all\s*;\s*git\s+commit/,
];

/**
 * Check whether a command is a dangerous git command.
 */
export function isDangerousGitCommand(command: string): boolean {
	const trimmed = command.trim().replace(/\s+/g, " ");
	return DANGEROUS_GIT_COMMAND_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Check whether a command history contains any dangerous git command.
 */
export function hasDangerousGitCommandInHistory(commands: string[]): boolean {
	return commands.some((cmd) => isDangerousGitCommand(cmd));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of command history entries to keep per workspace.
 * P37.HOTFIX: bounded history prevents unbounded memory growth.
 */
const MAX_COMMAND_HISTORY = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single recorded command in the bounded command history.
 * P37.HOTFIX: used by equivalent validation to track which commands
 * were run and their outcomes.
 */
export interface CommandHistoryEntry {
	planExecId?: string;
	workspaceId?: string;
	/** The command string that was executed */
	command: string;
	cwd?: string;
	/** Exit code (null if still running or unknown) */
	exitCode: number | null;
	/** When the command started (epoch ms) */
	startedAt?: number;
	/** When the command finished (epoch ms) */
	finishedAt?: number;
	outputSummary?: string;
	outputArtifactPath?: string;
	/** Whether this was explicitly marked as the workspace's targetCommand */
	isTargetCommand?: boolean;
	matchedValidationRequirement?: boolean;
	matchedAcceptedEquivalentCommand?: string;
	noTestsFoundDetected?: boolean;
	/** Whether this command satisfied an equivalent validation requirement */
	equivalentValidationSatisfied?: boolean;
}

/**
 * Events/signals tracked per workspace for completion gate evaluation.
 * These are populated by the executor as it processes log output and
 * command exit codes.
 */
export interface WorkspaceValidationState {
	/** Plan execution ID this state belongs to */
	planExecId: string;
	/** Workspace ID this state belongs to */
	workspaceId: string;
	/** Whether the workspace implementation has finished */
	implementationFinished: boolean;
	/** Whether targetCommand exited with code 0 (or no targetCommand defined) */
	targetCommandPassed: boolean | null;
	/** Whether targetCommand is still running */
	targetCommandRunning: boolean;
	/** Accumulated failure signals for this workspace */
	failureSignals: FailureSignal[];
	/** Whether any "out of retries" event exists for this workspace */
	outOfRetries: boolean;
	/** Whether a forbidden watch-mode command was detected */
	watchModeCommandDetected: boolean;
	/** The forbidden watch-mode command, if any */
	watchModeCommand: string | null;
	/** Whether a validation command is currently running */
	validationCommandRunning: boolean;
	/** Most recent command exit code (null if no command run or still running) */
	lastCommandExitCode: number | null;
	/** Bounded command history (last MAX_COMMAND_HISTORY commands) */
	commandHistory: CommandHistoryEntry[];
	/**
	 * Whether a dangerous git command was detected in command history.
	 * Set by recordCommand / evaluateWorkspaceCompletion.
	 */
	dangerousGitCommandDetected: boolean;
	/** The dangerous git command, if any */
	dangerousGitCommand: string | null;
}

/**
 * Result of evaluating whether a workspace can be marked complete.
 */
export interface WorkspaceCompletionResult {
	/** Whether the workspace can be marked complete */
	canComplete: boolean;
	/** Reasons the workspace cannot be marked complete (empty if canComplete) */
	blockReasons: string[];
	/** Recommended terminal state if cannot complete */
	recommendedState: WorkspaceStage.Complete | WorkspaceStage.Failed | WorkspaceStage.Blocked;
}

/**
 * Result of evaluating whether a plan can be marked complete.
 */
export interface PlanCompletionResult {
	/** Whether the plan can be marked complete */
	canComplete: boolean;
	/** Reasons the plan cannot be marked complete (empty if canComplete) */
	blockReasons: string[];
	/** Workspace IDs that are in unhealthy states */
	unhealthyWorkspaceIds: string[];
}

// ---------------------------------------------------------------------------
// Workspace completion gate
// ---------------------------------------------------------------------------

/**
 * Healthy terminal states for a workspace.
 */
const _HEALTHY_WORKSPACE_TERMINAL_STAGES: ReadonlySet<WorkspaceStage> = new Set([WorkspaceStage.Complete]);

/**
 * Unhealthy terminal states for a workspace.
 */
const _UNHEALTHY_WORKSPACE_TERMINAL_STAGES: ReadonlySet<WorkspaceStage> = new Set([
	WorkspaceStage.Failed,
	WorkspaceStage.Blocked,
]);

/**
 * Failure signal categories that represent unresolved test failures.
 */
const TEST_FAILURE_CATEGORIES: ReadonlySet<FailureSignalCategory> = new Set([
	FailureSignalCategory.TestFail,
	FailureSignalCategory.TestSummaryFail,
	FailureSignalCategory.VitestSummaryFail,
]);

/**
 * Failure signal categories that represent unresolved errors.
 */
const ERROR_CATEGORIES: ReadonlySet<FailureSignalCategory> = new Set([
	FailureSignalCategory.ErrorLine,
	FailureSignalCategory.FileNotFound,
	FailureSignalCategory.OutOfRetries,
	FailureSignalCategory.NonZeroExitCode,
]);

/**
 * Check if a failure signal is a test failure.
 *
 * @param signal - Failure signal
 * @returns True if the signal represents a test failure
 */
export function isTestFailureSignal(signal: FailureSignal): boolean {
	return TEST_FAILURE_CATEGORIES.has(signal.category);
}

/**
 * Check if a failure signal is an error (non-test).
 *
 * @param signal - Failure signal
 * @returns True if the signal represents an error
 */
export function isErrorSignal(signal: FailureSignal): boolean {
	return ERROR_CATEGORIES.has(signal.category);
}

/**
 * Check whether equivalent validation has been satisfied via command history.
 *
 * P37.HOTFIX: The completion gate no longer requires an exact targetCommand
 * string match. If a command in the history satisfies the validation
 * requirement through equivalence, this returns true.
 *
 * Rules:
 * - If targetCommandPassed === true, return true (exact match).
 * - If workspace has acceptedEquivalentCommands and any of them appear in
 *   command history with exitCode 0, return true.
 * - If workspace has validationRequirement.testFile and any command in
 *   history contains that testFile reference and exited 0, return true.
 * - Watch-mode commands are always rejected even if they match a pattern.
 * - Non-zero exit codes always fail.
 *
 * @param validationState - Current validation state
 * @param workspace - Workspace definition (for equivalence fields)
 * @returns True if equivalent validation is satisfied
 */
export function isEquivalentValidationSatisfied(
	validationState: WorkspaceValidationState,
	workspace: Workspace,
): boolean {
	// Exact target command passed
	if (validationState.targetCommandPassed === true) {
		return true;
	}

	// No targetCommand and no equivalence fields -> nothing to check
	if (!workspace.targetCommand && !workspace.validationRequirement && !workspace.acceptedEquivalentCommands) {
		return true; // No validation needed
	}

	// No command history at all -> cannot determine equivalence
	if (validationState.commandHistory.length === 0) {
		return false;
	}

	// Collect all acceptable equivalent commands
	const acceptedCommands = new Set<string>();

	// From workspace-level acceptedEquivalentCommands
	if (workspace.acceptedEquivalentCommands) {
		for (const cmd of workspace.acceptedEquivalentCommands) {
			acceptedCommands.add(cmd);
		}
	}

	// From validationRequirement.acceptedEquivalentCommands
	if (workspace.validationRequirement?.acceptedEquivalentCommands) {
		for (const cmd of workspace.validationRequirement.acceptedEquivalentCommands) {
			acceptedCommands.add(cmd);
		}
	}

	// Include targetCommand itself as accepted
	if (workspace.targetCommand) {
		acceptedCommands.add(workspace.targetCommand);
	}

	// The test file from validationRequirement
	const testFile = workspace.validationRequirement?.testFile;

	// Scan command history for accepted equivalents
	for (const entry of validationState.commandHistory) {
		// Watch-mode commands are always rejected
		if (isWatchModeCommand(entry.command)) {
			continue;
		}

		// P37.RCA: Direct equivalent validation satisfied flag set by
		// AutonomousExecutor.recordWorkspaceCommand. Covers test file
		// heuristic matching and other fallback equivalence checks.
		if (entry.equivalentValidationSatisfied) {
			return true;
		}

		// Non-zero exit codes and targeted test no-match output are rejections.
		if (entry.exitCode !== 0 || entry.noTestsFoundDetected) {
			continue;
		}

		// Check if command is in the accepted set
		if (acceptedCommands.has(entry.command)) {
			return true;
		}

		// Check if command contains the test file reference
		if (testFile && entry.command.includes(testFile)) {
			return true;
		}
	}

	return false;
}

/**
 * Evaluate whether a workspace can be marked complete.
 *
 * A workspace can be marked complete ONLY if ALL are true:
 * - implementation finished
 * - targetCommand, if defined, exited with code 0 (or equivalent satisfied)
 * - no unresolved test failure exists for that workspace
 * - no unresolved error event exists for that workspace
 * - no "out of retries" event exists for that workspace
 * - no validation command is still running
 * - no forbidden watch-mode command was used
 *
 * @param validationState - Current validation state for the workspace
 * @param workspace - Workspace definition (for targetCommand check)
 * @returns Completion evaluation result
 */
export function evaluateWorkspaceCompletion(
	validationState: WorkspaceValidationState,
	workspace: Workspace,
): WorkspaceCompletionResult {
	const blockReasons: string[] = [];

	// 1. Implementation must be finished
	if (!validationState.implementationFinished) {
		blockReasons.push("Implementation not finished");
	}

	const validationPolicy = workspace.validationPolicy;
	const deferredMode = validationPolicy?.mode === "deferred";
	const workspaceValidationNotRequired = deferredMode && validationPolicy?.requiredBeforeWorkspaceComplete === false;

	// 2. Target command, if defined, must have exited with code 0
	//    or satisfied via equivalent validation (P37.HOTFIX)
	//
	// P42.HOTFIX: When implementation is finished and all other gates are
	// clear (no failure signals, no test failures, no errors, no out-of-retries,
	// no watch-mode), AND there is at least one successful command (exit 0) in
	// the command history, a missing exact targetCommand match is downgraded to a
	// non-blocking warning. The worker explicitly reported COMPLETE with clean
	// evidence, and the absence of an exact targetCommand match should not hold
	// the workspace in a blocked state indefinitely.
	//
	// This only applies when the worker DID exercise some commands (history is
	// non-empty) and all observable signals are clean. If the command history is
	// empty or contains only failures, the block stands.
	if (workspace.targetCommand && !workspaceValidationNotRequired) {
		if (validationState.targetCommandRunning) {
			blockReasons.push(`Target command still running: ${workspace.targetCommand}`);
		} else if (validationState.targetCommandPassed === null) {
			// Check if equivalent validation is satisfied before blocking
			if (!isEquivalentValidationSatisfied(validationState, workspace)) {
				const anyWatchModeInHistory = validationState.commandHistory.some(
					(e) => e.command && isWatchModeCommand(e.command),
				);
				const hasCleanEvidence =
					validationState.implementationFinished &&
					validationState.failureSignals.length === 0 &&
					!validationState.outOfRetries &&
					!validationState.watchModeCommandDetected &&
					!anyWatchModeInHistory &&
					validationState.commandHistory.some((e) => e.exitCode === 0);
				if (hasCleanEvidence) {
					// Worker reported COMPLETE with clean evidence and at
					// least one successful command run — treat missing
					// exact targetCommand as advisory, not blocking.
					console.warn(
						`[completion-gate] Workspace ${workspace.id} reported COMPLETE with clean evidence but targetCommand not executed: ${workspace.targetCommand}. Downgrading to non-blocking warning.`,
					);
				} else {
					blockReasons.push(`Target command has not been executed: ${workspace.targetCommand}`);
				}
			}
		} else if (!validationState.targetCommandPassed) {
			blockReasons.push(`Target command did not exit with code 0: ${workspace.targetCommand}`);
		}
	}

	if (workspace.validationRequirement?.kind === "targeted_test") {
		const hasNoTestsFound = validationState.commandHistory.some((entry) => entry.noTestsFoundDetected);
		if (hasNoTestsFound) {
			blockReasons.push("Targeted validation matched no tests (No test files found)");
		}
		if (!workspaceValidationNotRequired && !isEquivalentValidationSatisfied(validationState, workspace)) {
			// P42.HOTFIX: Same clean-evidence downgrade as targetCommand check above.
			const anyWatchModeInHistory = validationState.commandHistory.some(
				(e) => e.command && isWatchModeCommand(e.command),
			);
			const hasCleanEvidence =
				validationState.implementationFinished &&
				validationState.failureSignals.length === 0 &&
				!validationState.outOfRetries &&
				!validationState.watchModeCommandDetected &&
				!anyWatchModeInHistory &&
				validationState.commandHistory.some((e) => e.exitCode === 0);
			if (hasCleanEvidence) {
				console.warn(
					`[completion-gate] Workspace ${workspace.id} reported COMPLETE with clean evidence but targeted_test validation unsatisfied. Downgrading to non-blocking warning.`,
				);
			} else {
				blockReasons.push("Validation requirement unsatisfied: targeted_test");
			}
		}
	}

	// 3. No unresolved test failures
	const testFailures = validationState.failureSignals.filter(isTestFailureSignal);
	if (testFailures.length > 0) {
		blockReasons.push(`Unresolved test failures: ${testFailures.map((s) => s.rawLine).join("; ")}`);
	}

	// 4. No unresolved error events
	const errorEvents = validationState.failureSignals.filter(isErrorSignal);
	if (errorEvents.length > 0) {
		blockReasons.push(`Unresolved error events: ${errorEvents.map((s) => s.description).join("; ")}`);
	}

	// 5. No "out of retries" event
	if (validationState.outOfRetries) {
		blockReasons.push("Out of retries event exists");
	}

	// 6. No validation command still running
	if (validationState.validationCommandRunning) {
		blockReasons.push("Validation command is still running");
	}

	// 7. No forbidden watch-mode command
	if (validationState.watchModeCommandDetected) {
		blockReasons.push(`Forbidden watch-mode command used: ${validationState.watchModeCommand ?? "unknown"}`);
	}

	// 7b. No dangerous git command
	if (validationState.dangerousGitCommandDetected) {
		blockReasons.push(
			`Dangerous git command detected: ${validationState.dangerousGitCommand ?? "git add . / git commit -a"}. Use scoped 'git add <file>' instead.`,
		);
	}

	// 8. Non-zero exit code from last command
	if (validationState.lastCommandExitCode !== null && validationState.lastCommandExitCode !== 0) {
		blockReasons.push(`Last command exited with non-zero code: ${validationState.lastCommandExitCode}`);
	}

	if (blockReasons.length > 0) {
		// Determine recommended state
		let recommendedState: WorkspaceStage = WorkspaceStage.Failed;

		// If targetCommand not passed (not executed or failed), mark as blocked
		// so agent can retry with an alternative command (up to 10 attempts)
		const targetCommandBlocked = blockReasons.some((r) => r.startsWith("Target command"));
		if (targetCommandBlocked && !validationState.outOfRetries) {
			recommendedState = WorkspaceStage.Blocked;
		}

		// If only test failures but implementation is done, mark as blocked (can retry)
		if (
			validationState.implementationFinished &&
			testFailures.length > 0 &&
			!validationState.outOfRetries &&
			!validationState.watchModeCommandDetected
		) {
			recommendedState = WorkspaceStage.Blocked;
		}

		// If out of retries, must be failed
		if (validationState.outOfRetries) {
			recommendedState = WorkspaceStage.Failed;
		}

		// If watch-mode was used, blocked (the command needs to be re-run properly)
		if (validationState.watchModeCommandDetected && !validationState.outOfRetries) {
			recommendedState = WorkspaceStage.Blocked;
		}

		return {
			canComplete: false,
			blockReasons,
			recommendedState,
		};
	}

	return {
		canComplete: true,
		blockReasons: [],
		recommendedState: WorkspaceStage.Complete,
	};
}

/**
 * Create an empty validation state for a workspace.
 *
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @returns Empty validation state
 */
export function createWorkspaceValidationState(planExecId: string, workspaceId: string): WorkspaceValidationState {
	return {
		planExecId,
		workspaceId,
		implementationFinished: false,
		targetCommandPassed: null,
		targetCommandRunning: false,
		failureSignals: [],
		outOfRetries: false,
		watchModeCommandDetected: false,
		watchModeCommand: null,
		validationCommandRunning: false,
		lastCommandExitCode: null,
		commandHistory: [],
		dangerousGitCommandDetected: false,
		dangerousGitCommand: null,
	};
}

/**
 * Merge failure signals from log scan into a workspace's validation state.
 *
 * Only incorporates signals that match the given planExecId + workspaceId.
 * Signals from a different context are silently dropped (log isolation).
 *
 * @param state - Current validation state
 * @param signals - Failure signals to merge
 * @param planExecId - The planExecId to scope by
 * @param workspaceId - The workspaceId to scope by
 * @returns Updated validation state
 */
export function mergeFailureSignals(
	state: WorkspaceValidationState,
	signals: FailureSignal[],
	planExecId: string,
	workspaceId: string,
): WorkspaceValidationState {
	// Isolation: only process signals for matching planExecId + workspaceId
	if (state.planExecId !== planExecId || state.workspaceId !== workspaceId) {
		return state; // Ignore signals from different context
	}

	const newSignals = [...state.failureSignals, ...signals];

	// Check for out-of-retries in new signals
	const hasOutOfRetries = newSignals.some((s) => s.category === FailureSignalCategory.OutOfRetries);

	return {
		...state,
		failureSignals: newSignals,
		outOfRetries: state.outOfRetries || hasOutOfRetries,
	};
}

/**
 * Append an entry to the bounded command history.
 * Keeps at most MAX_COMMAND_HISTORY entries, dropping the oldest first.
 *
 * @param history - Current command history
 * @param entry - Entry to append
 * @returns Updated command history (bounded)
 */
export function appendCommandHistory(
	history: CommandHistoryEntry[],
	entry: CommandHistoryEntry,
): CommandHistoryEntry[] {
	const updated = [...history, entry];
	if (updated.length > MAX_COMMAND_HISTORY) {
		return updated.slice(updated.length - MAX_COMMAND_HISTORY);
	}
	return updated;
}

/**
 * Record a command being used as validation, checking for watch-mode.
 *
 * If the command is a watch-mode command, marks the validation state accordingly.
 * Adds the command to the bounded command history.
 *
 * @param state - Current validation state
 * @param command - The command being run
 * @param planExecId - The planExecId to scope by
 * @param workspaceId - The workspaceId to scope by
 * @returns Updated validation state
 */
export function recordValidationCommand(
	state: WorkspaceValidationState,
	command: string,
	planExecId: string,
	workspaceId: string,
): WorkspaceValidationState {
	// Isolation: only update for matching context
	if (state.planExecId !== planExecId || state.workspaceId !== workspaceId) {
		return state;
	}

	const update: Partial<WorkspaceValidationState> = {
		validationCommandRunning: true,
	};

	// Check for watch-mode
	if (isWatchModeCommand(command)) {
		update.watchModeCommandDetected = true;
		update.watchModeCommand = command;
	}

	// Record in command history
	// Check for dangerous git command
	if (isDangerousGitCommand(command)) {
		update.dangerousGitCommandDetected = true;
		update.dangerousGitCommand = command;
	}

	const historyEntry: CommandHistoryEntry = {
		command,
		exitCode: null,
		startedAt: Date.now(),
	};

	return {
		...state,
		...update,
		commandHistory: appendCommandHistory(state.commandHistory, historyEntry),
	};
}

/**
 * Record command completion in validation state.
 *
 * Updates the last unmatched command entry in history (one with exitCode null)
 * or appends a new one with the exit code. If isTargetCommand, updates
 * targetCommandPassed accordingly.
 *
 * @param state - Current validation state
 * @param exitCode - Exit code of the command
 * @param isTargetCommand - Whether this was the workspace's targetCommand
 * @param planExecId - The planExecId to scope by
 * @param workspaceId - The workspaceId to scope by
 * @param command - Optional command string that completed (P37.HOTFIX)
 * @returns Updated validation state
 */
export function recordCommandCompletion(
	state: WorkspaceValidationState,
	exitCode: number,
	isTargetCommand: boolean,
	planExecId: string,
	workspaceId: string,
	command?: string,
): WorkspaceValidationState {
	// Isolation: only update for matching context
	if (state.planExecId !== planExecId || state.workspaceId !== workspaceId) {
		return state;
	}

	const update: Partial<WorkspaceValidationState> = {
		validationCommandRunning: false,
		lastCommandExitCode: exitCode,
	};

	if (isTargetCommand) {
		update.targetCommandRunning = false;
		update.targetCommandPassed = exitCode === 0;
	}

	// Check for dangerous git command in the completed command
	if (command && isDangerousGitCommand(command)) {
		update.dangerousGitCommandDetected = true;
		update.dangerousGitCommand = command;
	}

	// Update command history: find the last entry with null exitCode and update it
	let history = state.commandHistory;
	if (command) {
		// Check if the last entry has the same command name and null exitCode
		const lastIdx = history.length - 1;
		if (lastIdx >= 0 && history[lastIdx].command === command && history[lastIdx].exitCode === null) {
			// Update the existing entry
			const updatedHistory = [...history];
			updatedHistory[lastIdx] = {
				...updatedHistory[lastIdx],
				exitCode,
				finishedAt: Date.now(),
				isTargetCommand: isTargetCommand || updatedHistory[lastIdx].isTargetCommand,
			};
			history = updatedHistory;
		} else {
			// Append a new completion entry
			history = appendCommandHistory(history, {
				command,
				exitCode,
				finishedAt: Date.now(),
				isTargetCommand,
			});
		}
	} else if (isTargetCommand && history.length > 0) {
		// No command string but isTargetCommand: update the last entry
		const lastIdx = history.length - 1;
		const updatedHistory = [...history];
		updatedHistory[lastIdx] = {
			...updatedHistory[lastIdx],
			exitCode,
			finishedAt: Date.now(),
			isTargetCommand: true,
		};
		history = updatedHistory;
	}

	return {
		...state,
		...update,
		commandHistory: history,
	};
}

// ---------------------------------------------------------------------------
// WriteSet drift detection
// ---------------------------------------------------------------------------

/**
 * P26.L: Result of a writeSet drift check.
 */
export interface WriteSetDriftResult {
	/** Whether drift was detected */
	driftDetected: boolean;
	/** Files that were modified outside the declared conflictScope */
	driftedFiles: string[];
	/** Files that were within the declared conflictScope */
	scopedFiles: string[];
	/** Declared conflict scope patterns */
	declaredScope: string[];
	/** Error message if check failed */
	error?: string;
}

/**
 * Check for writeSet drift after workspace completion.
 *
 * Compares the empirical git diff (actual files modified) against the
 * declared conflictScope. If the workspace modified files outside its
 * declared scope, drift is detected and the result should block completion
 * or trigger a handoff artifact.
 *
 * @param empiricalDiffFiles - Files actually modified (from git diff --name-only)
 * @param declaredScope - Declared conflict scope patterns (glob patterns)
 * @returns Drift check result
 */
export function checkWriteSetDrift(empiricalDiffFiles: string[], declaredScope: string[]): WriteSetDriftResult {
	if (declaredScope.length === 0) {
		return {
			driftDetected: false,
			driftedFiles: [],
			scopedFiles: [],
			declaredScope: [],
			error: "No conflict scope declared — drift detection skipped",
		};
	}

	// Simple glob matching — convert to regex
	const matchesPattern = (filePath: string, pattern: string): boolean => {
		// Convert glob pattern to regex
		const regexStr = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".");
		return new RegExp(`^${regexStr}$`).test(filePath);
	};

	const scopedFiles: string[] = [];
	const driftedFiles: string[] = [];

	for (const file of empiricalDiffFiles) {
		const matchesScope = declaredScope.some((pattern) => matchesPattern(file, pattern));
		if (matchesScope) {
			scopedFiles.push(file);
		} else {
			driftedFiles.push(file);
		}
	}

	return {
		driftDetected: driftedFiles.length > 0,
		driftedFiles,
		scopedFiles,
		declaredScope,
	};
}

// ---------------------------------------------------------------------------
// Plan completion gate
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a plan can be marked complete.
 *
 * A plan can be marked complete ONLY if ALL workspaces are terminal healthy.
 * Healthy terminal states: complete, skipped (only if explicitly allowed)
 * Unhealthy terminal states: failed, blocked, interrupted, cancelled,
 *   awaiting_handoff (unless post-plan handoff is resolved)
 *
 * @param workspaceStates - Map of workspace ID to workspace state
 * @param allowSkipped - Whether skipped workspaces are allowed
 * @returns Plan completion result
 */
export function evaluatePlanCompletion(
	workspaceStates: Map<string, WorkspaceState>,
	_allowSkipped: boolean = false,
): PlanCompletionResult {
	const blockReasons: string[] = [];
	const unhealthyWorkspaceIds: string[] = [];

	for (const [id, ws] of workspaceStates) {
		// Healthy terminal: complete
		if (ws.stage === WorkspaceStage.Complete) {
			continue;
		}

		// Pending or active: not terminal
		if (ws.stage === WorkspaceStage.Pending || ws.stage === WorkspaceStage.Active) {
			blockReasons.push(`Workspace ${id} is not terminal (${ws.stage})`);
			unhealthyWorkspaceIds.push(id);
			continue;
		}

		// Blocked or failed: unhealthy terminal
		if (ws.stage === WorkspaceStage.Blocked) {
			blockReasons.push(`Workspace ${id} is blocked`);
			unhealthyWorkspaceIds.push(id);
			continue;
		}

		if (ws.stage === WorkspaceStage.Failed) {
			blockReasons.push(`Workspace ${id} is failed`);
			unhealthyWorkspaceIds.push(id);
			continue;
		}

		// Any other stage is unhealthy
		blockReasons.push(`Workspace ${id} is in unexpected state: ${ws.stage}`);
		unhealthyWorkspaceIds.push(id);
	}

	if (blockReasons.length > 0) {
		return {
			canComplete: false,
			blockReasons,
			unhealthyWorkspaceIds,
		};
	}

	return {
		canComplete: true,
		blockReasons: [],
		unhealthyWorkspaceIds: [],
	};
}

/**
 * Verify that a workspace currently in Complete state should remain complete.
 *
 * Called after new failure signals arrive to detect "false complete" situations.
 * If any unresolved failure signals exist, the workspace should not remain complete.
 *
 * @param validationState - Current validation state for the workspace
 * @param workspace - Workspace definition
 * @returns True if the workspace is legitimately complete
 */
export function isWorkspaceLegitimatelyComplete(
	validationState: WorkspaceValidationState,
	workspace: Workspace,
): boolean {
	const result = evaluateWorkspaceCompletion(validationState, workspace);
	return result.canComplete;
}

// ---------------------------------------------------------------------------
// Governance Ledger Completion Gate (P9.G7)
// ---------------------------------------------------------------------------

/**
 * Result of evaluating governance ledger compliance for completion.
 */
export interface GovernanceLedgerCompletionResult {
	/** Whether the governance gate is satisfied */
	passed: boolean;
	/** Block reasons if not passed */
	blockReasons: string[];
}

/**
 * Evaluate whether a governance ledger is complete enough to allow
 * a plan/workspace to be marked done.
 *
 * The governance ledger must have:
 * 1. At least one entry recorded (non-empty ledger)
 * 2. No unresolved critical or error entries
 * 3. No unresolved validation failures
 * 4. At least one G3 approval entry if the lifecycle has progressed
 * 5. At least one G4 validation entry if the lifecycle has progressed
 *
 * This is called as part of the completion gate evaluation chain.
 * The ledger gate is additive — it cannot override a passing result
 * from the standard completion gate to force a pass, but it can add
 * additional block reasons.
 *
 * @param ledger - The governance ledger to evaluate
 * @returns Governance ledger compliance result
 */
export function evaluateGovernanceLedgerCompliance(ledger: GovernanceLedger): GovernanceLedgerCompletionResult {
	const blockReasons: string[] = [];

	// 1. Ledger must not be empty
	if (ledger.entries.length === 0) {
		blockReasons.push("Governance ledger is empty — no entries recorded");
	}

	// 2. No unresolved critical/error entries (excluding completion gate entries,
	//    which record gate outcomes rather than actionable errors)
	const unresolvedIssues = ledger.entries.filter(
		(e) => (e.severity === "critical" || e.severity === "error") && e.category !== "completion_gate",
	);
	if (unresolvedIssues.length > 0) {
		blockReasons.push(
			`Governance ledger has ${unresolvedIssues.length} unresolved entries with error/critical severity`,
		);
	}

	// 3. No unresolved validation failures
	const unresolvedFailures = ledger.entries.filter(
		(e) => e.category === "validation_failure" && e.severity === "error",
	);
	if (unresolvedFailures.length > 0) {
		blockReasons.push(`Governance ledger has ${unresolvedFailures.length} unresolved validation failures`);
	}

	// 4. Must have at least one G3 approval entry if any G3 entries exist
	const hasG3Entries = ledger.entries.some((e) => e.source === "g3_approval_budget");
	const hasG3Approvals = ledger.entries.some((e) => e.source === "g3_approval_budget" && e.category === "approval");
	if (hasG3Entries && !hasG3Approvals) {
		blockReasons.push("Governance ledger has G3 entries but no approval events recorded");
	}

	// 5. Must have at least one G4 validation entry if any G4 entries exist
	const hasG4Entries = ledger.entries.some((e) => e.source === "g4_dry_run_validation");
	const hasG4Validations = ledger.entries.some(
		(e) => e.source === "g4_dry_run_validation" && e.category === "validation",
	);
	if (hasG4Entries && !hasG4Validations) {
		blockReasons.push("Governance ledger has G4 entries but no validation outcomes recorded");
	}

	return {
		passed: blockReasons.length === 0,
		blockReasons,
	};
}

/**
 * Evaluate workspace completion with governance ledger integration.
 * Checks both the standard completion gate conditions and the
 * governance ledger compliance.
 *
 * @param validationState - Current validation state for the workspace
 * @param workspace - Workspace definition
 * @param ledger - Governance ledger to check
 * @returns Combined completion result
 */
export function evaluateWorkspaceCompletionWithGovernance(
	validationState: WorkspaceValidationState,
	workspace: Workspace,
	ledger: GovernanceLedger,
): WorkspaceCompletionResult {
	// Standard completion check
	const baseResult = evaluateWorkspaceCompletion(validationState, workspace);

	// Governance ledger check
	const governanceResult = evaluateGovernanceLedgerCompliance(ledger);

	// Merge results
	const blockReasons = [...baseResult.blockReasons, ...governanceResult.blockReasons];

	if (blockReasons.length > 0) {
		return {
			canComplete: false,
			blockReasons,
			recommendedState: baseResult.recommendedState,
		};
	}

	return baseResult;
}

/**
 * Evaluate plan completion with governance ledger integration.
 * Checks both the standard plan completion conditions and the
 * governance ledger compliance.
 *
 * @param workspaceStates - Map of workspace ID to workspace state
 * @param ledger - Governance ledger to check
 * @param allowSkipped - Whether skipped workspaces are allowed
 * @returns Combined plan completion result
 */
export function evaluatePlanCompletionWithGovernance(
	workspaceStates: Map<string, WorkspaceState>,
	ledger: GovernanceLedger,
	allowSkipped: boolean = false,
): PlanCompletionResult {
	// Standard plan completion check
	const baseResult = evaluatePlanCompletion(workspaceStates, allowSkipped);

	// Governance ledger check
	const governanceResult = evaluateGovernanceLedgerCompliance(ledger);

	// Merge results
	const blockReasons = [...baseResult.blockReasons, ...governanceResult.blockReasons];

	if (blockReasons.length > 0) {
		return {
			canComplete: false,
			blockReasons,
			unhealthyWorkspaceIds: baseResult.unhealthyWorkspaceIds,
		};
	}

	return baseResult;
}

// ---------------------------------------------------------------------------
// Validation state registry (in-memory, keyed by planExecId+workspaceId)
// ---------------------------------------------------------------------------

/**
 * In-memory registry of workspace validation states.
 * Keyed by composite key `${planExecId}:${workspaceId}`.
 */
export class CompletionGateRegistry {
	private states: Map<string, WorkspaceValidationState> = new Map();
	private _governanceLedger?: GovernanceLedger;

	/**
	 * Attach a governance ledger for compliance checks.
	 * When set, all evaluate* calls also check governance ledger compliance (P9.G7).
	 *
	 * @param ledger - Governance ledger instance
	 */
	setGovernanceLedger(ledger: GovernanceLedger): void {
		this._governanceLedger = ledger;
	}

	/**
	 * Get the attached governance ledger, if any.
	 */
	get governanceLedger(): GovernanceLedger | undefined {
		return this._governanceLedger;
	}

	/**
	 * Build a composite key for a plan/workspace.
	 */
	private key(planExecId: string, workspaceId: string): string {
		return `${planExecId}:${workspaceId}`;
	}

	/**
	 * Get or create validation state for a workspace.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Validation state
	 */
	getOrCreate(planExecId: string, workspaceId: string): WorkspaceValidationState {
		const k = this.key(planExecId, workspaceId);
		let state = this.states.get(k);
		if (!state) {
			state = createWorkspaceValidationState(planExecId, workspaceId);
			this.states.set(k, state);
		}
		return state;
	}

	/**
	 * Update validation state for a workspace.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param state - New validation state
	 */
	set(planExecId: string, workspaceId: string, state: WorkspaceValidationState): void {
		const k = this.key(planExecId, workspaceId);
		this.states.set(k, state);
	}

	/**
	 * Get validation state for a workspace.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Validation state or undefined
	 */
	get(planExecId: string, workspaceId: string): WorkspaceValidationState | undefined {
		return this.states.get(this.key(planExecId, workspaceId));
	}

	/**
	 * Merge failure signals into a workspace's validation state.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param signals - Failure signals to merge
	 */
	mergeSignals(planExecId: string, workspaceId: string, signals: FailureSignal[]): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		const updated = mergeFailureSignals(state, signals, planExecId, workspaceId);
		this.set(planExecId, workspaceId, updated);
	}

	/**
	 * Record a validation command in the workspace's state.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param command - The command being run
	 */
	recordCommand(planExecId: string, workspaceId: string, command: string): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		const updated = recordValidationCommand(state, command, planExecId, workspaceId);
		this.set(planExecId, workspaceId, updated);
	}

	/**
	 * Record command completion.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param exitCode - Exit code
	 * @param isTargetCommand - Whether this was the target command
	 * @param command - Optional command string that completed (P37.HOTFIX)
	 */
	recordCompletion(
		planExecId: string,
		workspaceId: string,
		exitCode: number,
		isTargetCommand: boolean,
		command?: string,
		metadata?: Partial<CommandHistoryEntry>,
	): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		let updated = recordCommandCompletion(state, exitCode, isTargetCommand, planExecId, workspaceId, command);
		if (command && metadata) {
			const history = [...updated.commandHistory];
			let idx = -1;
			for (let i = history.length - 1; i >= 0; i--) {
				const entry = history[i];
				if (entry.command === command && entry.exitCode === exitCode) {
					idx = i;
					break;
				}
			}
			if (idx >= 0) {
				history[idx] = { ...history[idx], ...metadata, planExecId, workspaceId };
				updated = { ...updated, commandHistory: history };
			}
		}
		this.set(planExecId, workspaceId, updated);
	}

	/**
	 * Mark implementation as finished.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 */
	markImplementationFinished(planExecId: string, workspaceId: string): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		this.set(planExecId, workspaceId, { ...state, implementationFinished: true });
	}

	/**
	 * Mark target command as started, recording the command string.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param command - Optional command string being started (P37.HOTFIX)
	 */
	markTargetCommandStarted(planExecId: string, workspaceId: string, command?: string): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		const update: Partial<WorkspaceValidationState> = {
			targetCommandRunning: true,
		};
		let history = state.commandHistory;
		if (command) {
			const entry: CommandHistoryEntry = {
				command,
				exitCode: null,
				startedAt: Date.now(),
				isTargetCommand: true,
			};
			history = appendCommandHistory(history, entry);
		}
		this.set(planExecId, workspaceId, { ...state, ...update, commandHistory: history });
	}

	/**
	 * Record an equivalent validation command directly into state.
	 * P37.HOTFIX: Allows the executor to record that a low-memory equivalent
	 * command passed validation without requiring exact targetCommand match.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param command - The command that was run
	 * @param exitCode - Exit code (must be 0 to satisfy)
	 */
	recordEquivalentCommand(planExecId: string, workspaceId: string, command: string, exitCode: number): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		const entry: CommandHistoryEntry = {
			command,
			exitCode,
			finishedAt: Date.now(),
			isTargetCommand: false,
			equivalentValidationSatisfied: exitCode === 0,
		};
		this.set(planExecId, workspaceId, {
			...state,
			commandHistory: appendCommandHistory(state.commandHistory, entry),
		});
	}

	/**
	 * Check if equivalent validation is satisfied for a workspace.
	 * Convenience wrapper around isEquivalentValidationSatisfied.
	 * P37.HOTFIX
	 */
	isEquivalentSatisfied(planExecId: string, workspaceId: string, workspace: Workspace): boolean {
		const state = this.getOrCreate(planExecId, workspaceId);
		return isEquivalentValidationSatisfied(state, workspace);
	}

	/**
	 * Evaluate workspace completion, optionally with governance ledger.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param workspace - Workspace definition
	 * @returns Completion result
	 */
	evaluateWorkspace(planExecId: string, workspaceId: string, workspace: Workspace): WorkspaceCompletionResult {
		const state = this.getOrCreate(planExecId, workspaceId);
		let result: WorkspaceCompletionResult;
		if (this._governanceLedger) {
			result = evaluateWorkspaceCompletionWithGovernance(state, workspace, this._governanceLedger);
			// Record the gate evaluation in the ledger
			this._governanceLedger.recordCompletionGate(result.canComplete, result.blockReasons, {
				planExecId,
				workspaceId,
			});
		} else {
			result = evaluateWorkspaceCompletion(state, workspace);
		}
		return result;
	}

	/**
	 * Validate commit safety for a workspace using WorkspaceCommitGate.
	 * Inspects actual git staged files and returns block reasons.
	 * Must be called before evaluateWorkspace for production execution.
	 *
	 * @param commitGateOpts - WorkspaceCommitGate configuration
	 * @returns Block reasons (empty if safe)
	 */
	async validateCommitSafety(commitGateOpts: WorkspaceCommitGateConfig): Promise<string[]> {
		try {
			const gate = new WorkspaceCommitGate(commitGateOpts);
			const commitResult = await gate.inspectGitState();
			if (!commitResult.allowed) {
				return [`WorkspaceCommitGate: ${commitResult.reason ?? "unexpected staged files"}`];
			}
			return [];
		} catch (error) {
			return [`WorkspaceCommitGate inspection error: ${error instanceof Error ? error.message : String(error)}`];
		}
	}

	/**
	 * Evaluate plan completion, optionally with governance ledger.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceStates - Map of workspace ID to workspace state
	 * @param allowSkipped - Whether skipped workspaces are allowed
	 * @returns Plan completion result
	 */
	evaluatePlan(
		planExecId: string,
		workspaceStates: Map<string, WorkspaceState>,
		allowSkipped: boolean = false,
	): PlanCompletionResult {
		if (this._governanceLedger) {
			const result = evaluatePlanCompletionWithGovernance(workspaceStates, this._governanceLedger, allowSkipped);
			// Record the gate evaluation in the ledger
			this._governanceLedger.recordCompletionGate(result.canComplete, result.blockReasons, {
				planExecId,
				workspaceIds: Array.from(workspaceStates.keys()),
			});
			return result;
		}
		return evaluatePlanCompletion(workspaceStates, allowSkipped);
	}

	/**
	 * Clear all states for a plan execution.
	 *
	 * @param planExecId - Plan execution ID
	 */
	clearForPlan(planExecId: string): void {
		for (const key of Array.from(this.states.keys())) {
			if (key.startsWith(`${planExecId}:`)) {
				this.states.delete(key);
			}
		}
	}

	/**
	 * Clear all states.
	 */
	clear(): void {
		this.states.clear();
	}
}
