/**
 * Completion Gate Adapter
 *
 * Provides adapter functions that bridge between v1 (base) and v2
 * completion gate evaluations. Handles:
 * - Upgrading v1 results with v2 checks
 * - Creating v2 options from workspace/plan metadata
 * - Coordinating between EvidenceLedger and CompletionGate
 */

import type { WorkspaceValidationState } from "../completion-gate.js";
import { evaluateWorkspaceCompletion } from "../completion-gate.js";
import type { Workspace } from "../workspace-schema.js";
import type { EvidenceSatisfaction, WorkspaceCompletionResult } from "./completion-gate-result.js";
import { evaluateWorkspaceCompletionV2, type WorkspaceCompletionV2Options } from "./completion-gate-v2.js";
import type { EvidenceLedger } from "./evidence-ledger.js";

/**
 * Build evidence satisfaction summary from an EvidenceLedger.
 * Queries the ledger for evidence related to a workspace's acceptance criteria.
 *
 * @param ledger - The evidence ledger
 * @param criterionIds - Set of criterion IDs to check
 * @returns Evidence satisfaction summary
 */
export function buildEvidenceSatisfactionFromLedger(
	ledger: EvidenceLedger,
	criterionIds: string[],
): EvidenceSatisfaction {
	let satisfied = 0;
	let failed = 0;
	let unverified = 0;

	for (const criterionId of criterionIds) {
		const entries = ledger.getByCriterion(criterionId);
		if (entries.length === 0) {
			unverified++;
			continue;
		}

		// Check if any evidence for this criterion has failed
		const hasFailed = entries.some((e) => e.verdict === "fail");
		if (hasFailed) {
			failed++;
			continue;
		}

		// Check if any evidence has passed
		const hasPassed = entries.some((e) => e.verdict === "pass");
		if (hasPassed) {
			satisfied++;
			continue;
		}

		// Has evidence but no pass/fail verdict — count as unverified
		unverified++;
	}

	return {
		satisfied,
		failed,
		unverified,
		requiresAcceptanceCriteria: criterionIds.length > 0,
	};
}

/**
 * Run both v1 and v2 completion checks, merging results.
 * v1 checks run first, then v2 checks augment the result.
 *
 * This is useful for migration scenarios where both check sets are needed.
 *
 * @param validationState - Workspace validation state
 * @param workspace - The workspace
 * @param v2Options - V2 options (optional — if not provided, only v1 runs)
 * @returns Combined completion result
 */
export function evaluateCompletionWithAdapter(
	validationState: WorkspaceValidationState,
	workspace: Workspace,
	v2Options?: WorkspaceCompletionV2Options,
): WorkspaceCompletionResult {
	// Always run v1 checks
	const v1Result = evaluateWorkspaceCompletion(validationState, workspace);

	if (!v2Options) {
		return v1Result;
	}

	// Run v2 checks on top
	const v2Result = evaluateWorkspaceCompletionV2(validationState, workspace, v2Options);

	// Merge: if v1 says canComplete but v2 adds block reasons, use v2's result
	// If v1 already blocked and v2 adds more reasons, merge the reasons
	if (!v1Result.canComplete && !v2Result.canComplete) {
		// Both blocked — merge unique block reasons
		const mergedReasons = [...new Set([...v1Result.blockReasons, ...v2Result.blockReasons])];
		return {
			canComplete: false,
			blockReasons: mergedReasons,
			recommendedState: v2Result.recommendedState ?? v1Result.recommendedState,
		};
	}

	return v2Result;
}

/**
 * Extract lock hashes from a workspace's validation state and worker report
 * to create V2 options.
 *
 * @param validationState - Workspace validation state
 * @param workerReportedPlanHash - Plan lock hash from worker report (optional)
 * @param workerReportedWorkspaceHash - Workspace lock hash from worker report (optional)
 * @returns Partial V2 options with lock hash fields populated
 */
export function buildLockHashV2Options(
	validationState: WorkspaceValidationState,
	workerReportedPlanHash?: string,
	workerReportedWorkspaceHash?: string,
): Partial<WorkspaceCompletionV2Options> {
	return {
		planspecMode: true,
		expectedPlanLockHash: validationState.planLockHash,
		expectedWorkspaceLockHash: validationState.workspaceLockHash,
		workerReportedPlanLockHash: workerReportedPlanHash,
		workerReportedWorkspaceLockHash: workerReportedWorkspaceHash,
	};
}

/**
 * Determine if V2 mode should be enabled based on workspace and state.
 *
 * @param workspace - The workspace
 * @param validationState - Workspace validation state
 * @returns True if V2 mode should be used
 */
export function shouldUseV2Mode(workspace: Workspace, validationState: WorkspaceValidationState): boolean {
	// V2 mode is enabled when:
	// 1. Workspace has acceptance criteria (or is in planspec mode)
	// 2. Lock hashes are set on validation state
	return !!(
		(workspace.acceptanceCriteria && workspace.acceptanceCriteria.length > 0) ||
		validationState.planLockHash ||
		validationState.workspaceLockHash
	);
}
