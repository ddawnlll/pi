/**
 * PlanSupervisor completion predicate for v4 ExecutionKernel.
 *
 * Determines plan-level state from workspace terminal states,
 * handoff status, required/optional workspace classification,
 * and final validation result.
 *
 * ## ACCP v2.0 Gate Verdict Integration (P49.31 FIX-003)
 *
 * When `input.accpGate` is provided, the predicate consults the compiled
 * ACCP gate verdict for ACCP-required plans:
 *
 * - `modeRequired = true` and `verdict = null` (missing compiled verdict)
 *   -> BLOCKED_WITH_REASON (kernel does not accept raw YAML authority)
 * - `modeRequired = true` and `valid = false` (blocked verdict)
 *   -> BLOCKED_WITH_REASON
 * - `modeRequired = true` and verdict is stale (older than the
 *   `staleAfterMs` threshold) -> treated as missing and ignored
 * - `modeRequired = false` -> verdict is advisory; predicate proceeds
 *
 * Raw ACCP YAML is never accepted as runtime authority. Only compiled
 * gate-verdict.json read through the AccpArtifactStore (or passed via
 * the same in-process channel as `input.accpGate`) is consulted.
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";
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
	/**
	 * ACCP gate verdict consulted at the kernel boundary (P49.31 FIX-003).
	 * Set when ACCP mode is `required` for the plan. When modeRequired=true,
	 * a missing/blocked/stale verdict blocks plan completion.
	 */
	accpGate?: {
		modeRequired: boolean;
		verdict: AccpGateVerdict | null;
		evaluatedAt: number;
		staleAfterMs?: number;
	} | null;
}

// =========================================================================
// Completion predicate
// =========================================================================

export function isTerminalHandoffStatus(status: string): boolean {
	return status === "resolved" || status === "manually_resolved" || status === "complete";
}

function isUnresolvedRequiredHandoff(workspace: WorkspaceTerminalState): boolean {
	return Boolean(
		workspace.required &&
			workspace.state === "HANDOFF_REQUIRED" &&
			workspace.handoff &&
			workspace.handoff.required &&
			!isTerminalHandoffStatus(workspace.handoff.status),
	);
}

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

	// P49.31 FIX-003: ACCP gate verdict is consulted BEFORE the terminal
	// completion branch. A missing/blocked/stale verdict in required mode
	// must never allow the plan to reach `completed` or
	// `completed_with_warnings`.
	const accpGateDecision = evaluateAccpGate(input.accpGate);
	if (accpGateDecision === "blocked") {
		return "blocked_with_reason";
	}

	// Check for unresolved required handoffs
	const hasUnresolvedHandoff = workspaces.some(isUnresolvedRequiredHandoff);
	if (hasUnresolvedHandoff) {
		return "awaiting_handoff";
	}

	// Check for required FAILED_FINAL
	const hasRequiredFailedFinal = workspaces.some((w) => w.required && w.state === "FAILED_FINAL");
	if (hasRequiredFailedFinal) {
		return "failed_final";
	}

	// Check for required non-terminal workspaces
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

	// Some required workspaces failed - hasRequiredFailedFinal already handled above,
	// remaining failures are retryable
	const hasRetryableOnly = workspaces
		.filter((w) => w.required)
		.every((w) => w.state === "SUCCEEDED" || w.state === "FAILED_RETRYABLE");
	if (hasRetryableOnly) {
		return "running";
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
	const unresolved = workspaces.filter(isUnresolvedRequiredHandoff);
	if (unresolved.length > 0) {
		throw new Error(
			`plan_completed_with_unresolved_handoff: workspaces ${unresolved.map((w) => w.workspaceId).join(", ")} have unresolved handoffs`,
		);
	}
}

// =========================================================================
// ACCP gate verdict evaluation (P49.31 FIX-003)
// =========================================================================

/**
 * Evaluate the ACCP gate verdict for plan completion.
 *
 * Returns:
 *  - "ok"      — verdict passes (or is not required); predicate proceeds.
 *  - "blocked" — verdict blocks completion; caller should return
 *                `blocked_with_reason` so the plan does not reach
 *                `completed` / `completed_with_warnings` / `failed_final`.
 */
export function evaluateAccpGate(gate: PlanCompletionInput["accpGate"]): "ok" | "blocked" {
	if (!gate || !gate.modeRequired) return "ok";

	// Missing verdict — kernel cannot accept raw YAML authority.
	if (!gate.verdict) return "blocked";

	// Stale verdict — ignore and block so a fresh verdict must be produced.
	const staleAfter = gate.staleAfterMs ?? 24 * 60 * 60 * 1000; // 24h default
	const ageMs = Date.now() - gate.evaluatedAt;
	if (gate.evaluatedAt <= 0 || ageMs > staleAfter) return "blocked";

	// Blocked verdict — gate explicitly invalid.
	if (!gate.verdict.valid) return "blocked";

	return "ok";
}
