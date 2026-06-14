/**
 * PlanSupervisor completion predicate for v4 ExecutionKernel.
 *
 * Determines plan-level state from workspace terminal states,
 * handoff status, required/optional workspace classification,
 * and final validation result.
 */

import type { AttemptState, HandoffQueueRow } from "./types.js";

// =========================================================================
// Plan lifecycle states
// =========================================================================

export type PlanLifecycleState =
	| "created"
	| "preflight"
	| "running"
	| "blocked_with_reason"
	| "awaiting_handoff"
	| "final_validation"
	| "completed"
	| "completed_with_warnings"
	| "failed_final"
	| "stopping"
	| "stopped";

// =========================================================================
// Input types
// =========================================================================

export interface WorkspaceTerminalState {
	workspaceId: string;
	required: boolean;
	state: AttemptState;
	handoff: HandoffQueueRow | null;
}

export interface PlanCompletionInput {
	workspaces: WorkspaceTerminalState[];
	finalValidationPassed?: boolean;
	finalValidationFailed?: boolean;
	hasRequiredNonTerminal?: boolean;
	hasCriticalFailure?: boolean;
}

// =========================================================================
// Completion predicate
// =========================================================================

/**
 * Compute the plan lifecycle state from workspace terminal states.
 *
 * Rules:
 * 1. Any required HANDOFF_REQUIRED with unresolved handoff -> AWAITING_HANDOFF
 * 2. Any required FAILED_FINAL -> FAILED_FINAL
 * 3. Any required non-terminal -> RUNNING or BLOCKED_WITH_REASON
 * 4. All required SUCCEEDED and final validation not run -> FINAL_VALIDATION
 * 5. Final validation passed -> COMPLETED
 * 6. Final validation failed -> FAILED_FINAL
 * 7. Optional workspace failures with no critical failures -> COMPLETED_WITH_WARNINGS
 */
export function computePlanLifecycleState(input: PlanCompletionInput): PlanLifecycleState {
	const { workspaces, finalValidationPassed, finalValidationFailed } = input;

	// Check for unresolved required handoffs
	const hasUnresolvedHandoff = workspaces.some(
		(w) =>
			w.required &&
			w.state === "HANDOFF_REQUIRED" &&
			w.handoff &&
			w.handoff.required &&
			w.handoff.status !== "complete" &&
			w.handoff.status !== "manually_resolved",
	);
	if (hasUnresolvedHandoff) {
		return "awaiting_handoff";
	}

	// Check for required FAILED_FINAL
	const hasRequiredFailedFinal = workspaces.some((w) => w.required && w.state === "FAILED_FINAL");
	if (hasRequiredFailedFinal) {
		return "failed_final";
	}

	// Check for required non-terminal workspaces (anything not in a terminal
	// state is still in progress and keeps the plan running/blocked).
	const hasRequiredNonTerminal = workspaces.some(
		(w) => w.required && w.state !== "SUCCEEDED" && w.state !== "FAILED_FINAL" && w.state !== "FAILED_RETRYABLE",
	);
	if (hasRequiredNonTerminal) {
		return "blocked_with_reason";
	}

	// All required succeeded
	const allRequiredSucceeded = workspaces.filter((w) => w.required).every((w) => w.state === "SUCCEEDED");

	if (allRequiredSucceeded) {
		// Check optional workspace failures
		const optionalFailures = workspaces.filter(
			(w) => !w.required && (w.state === "FAILED_FINAL" || w.state === "FAILED_RETRYABLE"),
		);

		if (finalValidationFailed) {
			return "failed_final";
		}

		if (finalValidationPassed) {
			if (optionalFailures.length > 0) {
				return "completed_with_warnings";
			}
			return "completed";
		}

		return "final_validation";
	}

	// If every required workspace is FAILED_RETRYABLE, retries have been
	// exhausted without any reaching FAILED_FINAL, but the plan cannot make
	// further progress. This is a terminal failure.
	const hasRetryableOnly = workspaces
		.filter((w) => w.required)
		.every((w) => w.state === "SUCCEEDED" || w.state === "FAILED_RETRYABLE");
	if (hasRetryableOnly) {
		// Distinguish between a mix of SUCCEEDED + FAILED_RETRYABLE (treat as
		// failed_final) and pure FAILED_RETRYABLE (also failed_final since
		// no path forward remains).
		return "failed_final";
	}

	return "blocked_with_reason";
}

/**
 * Check whether a plan can be considered completed.
 */
export function isPlanComplete(state: PlanLifecycleState): boolean {
	return state === "completed" || state === "completed_with_warnings" || state === "failed_final";
}

/**
 * Assert that a plan is not trying to complete with unresolved handoffs.
 */
export function assertNoUnresolvedHandoffs(workspaces: WorkspaceTerminalState[]): void {
	const unresolved = workspaces.filter(
		(w) =>
			w.state === "HANDOFF_REQUIRED" &&
			w.handoff &&
			w.handoff.required &&
			w.handoff.status !== "complete" &&
			w.handoff.status !== "manually_resolved",
	);
	if (unresolved.length > 0) {
		throw new Error(
			`plan_completed_with_unresolved_handoff: workspaces ${unresolved.map((w) => w.workspaceId).join(", ")} have unresolved handoffs`,
		);
	}
}
