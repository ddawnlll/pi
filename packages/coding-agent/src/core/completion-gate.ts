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
	 * Evaluate workspace completion, optionally with governance ledger.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param workspace - Workspace definition
	 * @returns Completion result
	 */
	evaluateWorkspace(planExecId: string, workspaceId: string, workspace: Workspace): WorkspaceCompletionResult {
		const state = this.getOrCreate(planExecId, workspaceId);
		if (this._governanceLedger) {
			const result = evaluateWorkspaceCompletionWithGovernance(state, workspace, this._governanceLedger);
			// Record the gate evaluation in the ledger
			this._governanceLedger.recordCompletionGate(result.canComplete, result.blockReasons, {
				planExecId,
				workspaceId,
			});
			return result;
		}
		return evaluateWorkspaceCompletion(state, workspace);
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
