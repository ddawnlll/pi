/**
 * Completion Gate - P4.6.1
 *
 * Hardened completion gate for workspaces and plans.
 * A workspace/plan must NOT be marked complete if:
 * - Validation failed
 * - Retries were exhausted
 * - Unresolved error events exist
 * - A validation command is still running
 * - Watch-mode validation was attempted
 *
 * All checks are scoped by planExecId + workspaceId.
 * Events from different planExecId or workspaceId are ignored.
 */

import type { FailureSignal } from "./log-failure-detector.js";
import { FailureSignalCategory } from "./log-failure-detector.js";
import type { WorkspaceState } from "./plan-state.js";
import { isWatchModeCommand } from "./watch-mode-guard.js";
import type { Workspace } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
 * Evaluate whether a workspace can be marked complete.
 *
 * A workspace can be marked complete ONLY if ALL are true:
 * - implementation finished
 * - targetCommand, if defined, exited with code 0
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

	// 2. Target command, if defined, must have exited with code 0
	if (workspace.targetCommand) {
		if (validationState.targetCommandRunning) {
			blockReasons.push(`Target command still running: ${workspace.targetCommand}`);
		} else if (validationState.targetCommandPassed === null) {
			blockReasons.push(`Target command has not been executed: ${workspace.targetCommand}`);
		} else if (!validationState.targetCommandPassed) {
			blockReasons.push(`Target command did not exit with code 0: ${workspace.targetCommand}`);
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

	// 8. Non-zero exit code from last command
	if (validationState.lastCommandExitCode !== null && validationState.lastCommandExitCode !== 0) {
		blockReasons.push(`Last command exited with non-zero code: ${validationState.lastCommandExitCode}`);
	}

	if (blockReasons.length > 0) {
		// Determine recommended state
		let recommendedState: WorkspaceStage = WorkspaceStage.Failed;

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
 * Record a command being used as validation, checking for watch-mode.
 *
 * If the command is a watch-mode command, marks the validation state accordingly.
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

	return {
		...state,
		...update,
	};
}

/**
 * Record command completion in validation state.
 *
 * @param state - Current validation state
 * @param exitCode - Exit code of the command
 * @param isTargetCommand - Whether this was the workspace's targetCommand
 * @param planExecId - The planExecId to scope by
 * @param workspaceId - The workspaceId to scope by
 * @returns Updated validation state
 */
export function recordCommandCompletion(
	state: WorkspaceValidationState,
	exitCode: number,
	isTargetCommand: boolean,
	planExecId: string,
	workspaceId: string,
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

	return {
		...state,
		...update,
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
// Validation state registry (in-memory, keyed by planExecId+workspaceId)
// ---------------------------------------------------------------------------

/**
 * In-memory registry of workspace validation states.
 * Keyed by composite key `${planExecId}:${workspaceId}`.
 */
export class CompletionGateRegistry {
	private states: Map<string, WorkspaceValidationState> = new Map();

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
	 */
	recordCompletion(planExecId: string, workspaceId: string, exitCode: number, isTargetCommand: boolean): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		const updated = recordCommandCompletion(state, exitCode, isTargetCommand, planExecId, workspaceId);
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
	 * Mark target command as started.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 */
	markTargetCommandStarted(planExecId: string, workspaceId: string): void {
		const state = this.getOrCreate(planExecId, workspaceId);
		this.set(planExecId, workspaceId, { ...state, targetCommandRunning: true });
	}

	/**
	 * Evaluate workspace completion.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param workspace - Workspace definition
	 * @returns Completion result
	 */
	evaluateWorkspace(planExecId: string, workspaceId: string, workspace: Workspace): WorkspaceCompletionResult {
		const state = this.getOrCreate(planExecId, workspaceId);
		return evaluateWorkspaceCompletion(state, workspace);
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
