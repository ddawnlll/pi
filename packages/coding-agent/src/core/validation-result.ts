/**
 * Validation Result - P4.6.1
 *
 * Result types for workspace/plan validation that are produced by
 * the completion gate and consumed by the AutonomousExecutor.
 *
 * These types bridge the gap between the log-failure-detector (raw signal
 * extraction) and the completion-gate (policy-enforced gate). The executor
 * should use these result types when deciding whether to mark a workspace
 * or plan as complete.
 */

import type { FailureSignal } from "./log-failure-detector.js";
import type { WorkspaceState } from "./plan-state.js";
import { WorkspaceStage } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of a workspace validation attempt.
 */
export enum ValidationStatus {
	/** Validation passed — all criteria met */
	Passed = "passed",
	/** Validation failed — one or more criteria not met */
	Failed = "failed",
	/** Validation is still in progress */
	Running = "running",
	/** Validation has not been attempted yet */
	Pending = "pending",
	/** Validation was blocked (e.g., watch-mode command, lock unavailable) */
	Blocked = "blocked",
}

/**
 * Details about a single validation criterion.
 */
export interface ValidationCriterionResult {
	/** Description of the criterion */
	criterion: string;
	/** Whether it passed */
	passed: boolean;
	/** Optional message explaining the result */
	message?: string;
}

/**
 * Complete result of a workspace validation.
 */
export interface WorkspaceValidationResult {
	/** Workspace ID */
	workspaceId: string;
	/** Plan execution ID */
	planExecId: string;
	/** Overall validation status */
	status: ValidationStatus;
	/** Individual criterion results */
	criteria: ValidationCriterionResult[];
	/** Failure signals that contributed to failure (if any) */
	failureSignals: FailureSignal[];
	/** Whether the workspace can be marked complete */
	canComplete: boolean;
	/** Reasons completion is blocked (empty if canComplete) */
	blockReasons: string[];
	/** Recommended workspace stage */
	recommendedStage: WorkspaceStage;
	/** Timestamp when validation was evaluated */
	evaluatedAt: number;
}

/**
 * Complete result of a plan validation.
 */
export interface PlanValidationResult {
	/** Plan execution ID */
	planExecId: string;
	/** Whether the plan can be marked complete */
	canComplete: boolean;
	/** Reasons completion is blocked (empty if canComplete) */
	blockReasons: string[];
	/** Workspace IDs that are not healthy-terminal */
	unhealthyWorkspaceIds: string[];
	/** Timestamp when validation was evaluated */
	evaluatedAt: number;
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

/**
 * Build a workspace validation result from completion gate evaluation.
 *
 * @param workspaceId - Workspace ID
 * @param planExecId - Plan execution ID
 * @param canComplete - Whether the workspace can be marked complete
 * @param blockReasons - Block reasons
 * @param recommendedStage - Recommended stage
 * @param failureSignals - Failure signals
 * @returns Workspace validation result
 */
export function buildWorkspaceValidationResult(
	workspaceId: string,
	planExecId: string,
	canComplete: boolean,
	blockReasons: string[],
	recommendedStage: WorkspaceStage,
	failureSignals: FailureSignal[] = [],
): WorkspaceValidationResult {
	let status: ValidationStatus;
	if (canComplete) {
		status = ValidationStatus.Passed;
	} else if (blockReasons.some((r) => r.includes("still running"))) {
		status = ValidationStatus.Running;
	} else if (blockReasons.some((r) => r.includes("watch-mode") || r.includes("forbidden"))) {
		status = ValidationStatus.Blocked;
	} else {
		status = ValidationStatus.Failed;
	}

	const criteria: ValidationCriterionResult[] = [
		{
			criterion: "Implementation finished",
			passed: !blockReasons.some((r) => r.includes("Implementation not finished")),
		},
		{
			criterion: "Target command passed",
			passed: !blockReasons.some((r) => r.includes("Target command")),
		},
		{
			criterion: "No unresolved test failures",
			passed: !blockReasons.some((r) => r.includes("Unresolved test failures")),
		},
		{
			criterion: "No unresolved errors",
			passed: !blockReasons.some((r) => r.includes("Unresolved error")),
		},
		{
			criterion: "No out-of-retries",
			passed: !blockReasons.some((r) => r.includes("Out of retries")),
		},
		{
			criterion: "No validation command running",
			passed: !blockReasons.some((r) => r.includes("still running")),
		},
		{
			criterion: "No watch-mode command",
			passed: !blockReasons.some((r) => r.includes("watch-mode")),
		},
		{
			criterion: "Exit code is zero",
			passed: !blockReasons.some((r) => r.includes("non-zero code")),
		},
	];

	return {
		workspaceId,
		planExecId,
		status,
		criteria,
		failureSignals,
		canComplete,
		blockReasons,
		recommendedStage,
		evaluatedAt: Date.now(),
	};
}

/**
 * Build a plan validation result from completion gate evaluation.
 *
 * @param planExecId - Plan execution ID
 * @param workspaceStates - Map of workspace states
 * @returns Plan validation result
 */
export function buildPlanValidationResult(
	planExecId: string,
	workspaceStates: Map<string, WorkspaceState>,
): PlanValidationResult {
	const blockReasons: string[] = [];
	const unhealthyWorkspaceIds: string[] = [];

	for (const [id, ws] of workspaceStates) {
		if (ws.stage === WorkspaceStage.Complete) {
			continue;
		}

		if (ws.stage === WorkspaceStage.Pending || ws.stage === WorkspaceStage.Active) {
			blockReasons.push(`Workspace ${id} is not terminal (${ws.stage})`);
			unhealthyWorkspaceIds.push(id);
			continue;
		}

		if (ws.stage === WorkspaceStage.Failed) {
			blockReasons.push(`Workspace ${id} is failed`);
			unhealthyWorkspaceIds.push(id);
			continue;
		}

		if (ws.stage === WorkspaceStage.Blocked) {
			blockReasons.push(`Workspace ${id} is blocked`);
			unhealthyWorkspaceIds.push(id);
			continue;
		}

		blockReasons.push(`Workspace ${id} is in unexpected state: ${ws.stage}`);
		unhealthyWorkspaceIds.push(id);
	}

	return {
		planExecId,
		canComplete: blockReasons.length === 0,
		blockReasons,
		unhealthyWorkspaceIds,
		evaluatedAt: Date.now(),
	};
}
