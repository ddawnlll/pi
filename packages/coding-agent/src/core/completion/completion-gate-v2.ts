/**
 * Completion Gate v2 — PlanSpec-aware completion checks
 *
 * This module re-exports the V2 completion gate types and function
 * from completion-gate.ts, providing a clean module boundary for the
 * completion sub-system.
 *
 * The V2 completion gate extends the base completion gate with
 * PlanSpec-specific checks:
 * 1. AC evidence satisfaction
 * 2. Plan lock hash match
 * 3. Workspace lock hash match
 * 4. Lock hashes present in PlanSpec mode
 * 5. Worker report lock hash echo verification
 */

import type { WorkspaceValidationState } from "../completion-gate.js";
import { evaluateWorkspaceCompletion } from "../completion-gate.js";
import type { Workspace } from "../workspace-schema.js";
import type { EvidenceSatisfaction, WorkspaceCompletionResult } from "./completion-gate-result.js";

/**
 * Options for evaluateWorkspaceCompletionV2.
 */
export interface WorkspaceCompletionV2Options {
	/** PlanSpec mode enables additional PlanSpec-specific checks */
	planspecMode?: boolean;
	/** Evidence satisfaction summary for AC checks */
	evidenceSatisfaction?: EvidenceSatisfaction;
	/** Expected plan lock hash for lock mismatch detection */
	expectedPlanLockHash?: string;
	/** Expected workspace lock hash for lock mismatch detection */
	expectedWorkspaceLockHash?: string;
	/** Worker report echo: the planLockHash the worker claimed */
	workerReportedPlanLockHash?: string;
	/** Worker report echo: the workspaceLockHash the worker claimed */
	workerReportedWorkspaceLockHash?: string;
}

/**
 * Wrapper around evaluateWorkspaceCompletion with v2 PlanSpec-aware checks.
 *
 * Additional checks in planspecMode:
 * 1. Lock hashes set — blocks if planspecMode but lock hashes are missing
 * 2. Plan lock hash match — blocks if planLockHash differs from expected
 * 3. Workspace lock hash match — blocks if workspaceLockHash differs from expected
 * 4. Worker report planLockHash echo — blocks if missing or mismatched
 * 5. Worker report workspaceLockHash echo — blocks if missing or mismatched
 *
 * Additional checks regardless of mode:
 * 6. AC evidence satisfaction — blocks if unverified/failed ACs exist
 *
 * @param validationState - Current workspace validation state
 * @param workspace - The workspace being evaluated
 * @param options - V2 options
 * @returns Completion result
 */
export function evaluateWorkspaceCompletionV2(
	validationState: WorkspaceValidationState,
	workspace: Workspace,
	options?: WorkspaceCompletionV2Options,
): WorkspaceCompletionResult {
	const baseResult = evaluateWorkspaceCompletion(validationState, workspace);
	const blockReasons = [...baseResult.blockReasons];

	// PlanSpec mode checks
	if (options?.planspecMode) {
		// Check 1: Lock hashes must be set in PlanSpec mode
		if (!validationState.planLockHash || !validationState.workspaceLockHash) {
			blockReasons.push("Lock hashes not set on validation state in PlanSpec mode");
		}

		// Check 2: Plan lock hash match
		if (
			options.expectedPlanLockHash &&
			validationState.planLockHash &&
			validationState.planLockHash !== options.expectedPlanLockHash
		) {
			blockReasons.push(
				`Plan lock hash mismatch: expected ${options.expectedPlanLockHash}, got ${validationState.planLockHash}`,
			);
		}

		// Check 3: Workspace lock hash match
		if (
			options.expectedWorkspaceLockHash &&
			validationState.workspaceLockHash &&
			validationState.workspaceLockHash !== options.expectedWorkspaceLockHash
		) {
			blockReasons.push(
				`Workspace lock hash mismatch: expected ${options.expectedWorkspaceLockHash}, got ${validationState.workspaceLockHash}`,
			);
		}

		// Check 4: Worker report planLockHash echo
		if (options.workerReportedPlanLockHash === undefined || options.workerReportedPlanLockHash === null) {
			blockReasons.push("Worker report is missing planLockHash echo");
		} else if (options.expectedPlanLockHash && options.workerReportedPlanLockHash !== options.expectedPlanLockHash) {
			blockReasons.push(
				`Worker report planLockHash mismatch: expected ${options.expectedPlanLockHash}, ` +
					`got ${options.workerReportedPlanLockHash}`,
			);
		}

		// Check 5: Worker report workspaceLockHash echo
		if (options.workerReportedWorkspaceLockHash === undefined || options.workerReportedWorkspaceLockHash === null) {
			blockReasons.push("Worker report is missing workspaceLockHash echo");
		} else if (
			options.expectedWorkspaceLockHash &&
			options.workerReportedWorkspaceLockHash !== options.expectedWorkspaceLockHash
		) {
			blockReasons.push(
				`Worker report workspaceLockHash mismatch: expected ${options.expectedWorkspaceLockHash}, ` +
					`got ${options.workerReportedWorkspaceLockHash}`,
			);
		}
	}

	// AC evidence satisfaction check (applies regardless of mode)
	if (options?.evidenceSatisfaction) {
		const es = options.evidenceSatisfaction;
		if (es.requiresAcceptanceCriteria && es.unverified > 0) {
			blockReasons.push(`${es.unverified} AC(s) have unverified evidence`);
		}
		if (es.failed > 0) {
			blockReasons.push(`${es.failed} AC(s) have failed evidence`);
		}
	}

	if (blockReasons.length > (baseResult.canComplete ? 0 : baseResult.blockReasons.length)) {
		return {
			canComplete: false,
			blockReasons,
			recommendedState: baseResult.recommendedState,
		};
	}

	return baseResult;
}

/**
 * Check whether all evidence satisfaction conditions are met.
 * Returns block reasons if any conditions fail.
 *
 * @param es - Evidence satisfaction summary
 * @returns Array of block reasons (empty if all conditions met)
 */
export function checkEvidenceSatisfaction(es: EvidenceSatisfaction): string[] {
	const reasons: string[] = [];
	if (es.requiresAcceptanceCriteria && es.unverified > 0) {
		reasons.push(`${es.unverified} AC(s) have unverified evidence`);
	}
	if (es.failed > 0) {
		reasons.push(`${es.failed} AC(s) have failed evidence`);
	}
	return reasons;
}

/**
 * Build options for V2 completion check from individual components.
 * Useful for constructing options programmatically.
 *
 * @param overrides - Partial V2 options to merge with defaults
 * @returns Complete V2 options
 */
export function buildV2Options(overrides?: Partial<WorkspaceCompletionV2Options>): WorkspaceCompletionV2Options {
	return {
		planspecMode: false,
		...overrides,
	};
}
