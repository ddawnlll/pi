/**
 * Completion Gate Result Types
 *
 * Core result types produced by completion gate evaluations.
 * Extracted from completion-gate.ts for modular access.
 */

import type { WorkspaceStage } from "../workspace-schema.js";

/**
 * Result of workspace completion evaluation.
 */
export interface WorkspaceCompletionResult {
	/** Whether the workspace can be marked as Complete */
	canComplete: boolean;
	/** Reasons why completion is blocked (empty when canComplete is true) */
	blockReasons: string[];
	/** Recommended stage when completion is blocked */
	recommendedState?: WorkspaceStage;
}

/**
 * Result of plan completion evaluation.
 */
export interface PlanCompletionResult {
	/** Whether the plan can be marked as Complete */
	canComplete: boolean;
	/** Reasons why completion is blocked (empty when canComplete is true) */
	blockReasons: string[];
	/** IDs of workspaces that are unhealthy (Failed/Blocked/Interrupted) */
	unhealthyWorkspaceIds: string[];
}

/**
 * Evidence satisfaction summary for PlanSpec mode completion checks.
 * Tracks how many acceptance criteria have satisfied/failed/unverified evidence.
 */
export interface EvidenceSatisfaction {
	/** Number of ACs with satisfied evidence */
	satisfied: number;
	/** Number of ACs with failed evidence */
	failed: number;
	/** Number of ACs with unverified evidence */
	unverified: number;
	/** Whether AC evidence is required for completion */
	requiresAcceptanceCriteria: boolean;
}

/**
 * Governance ledger compliance result.
 */
export interface GovernanceLedgerCompletionResult {
	/** Whether governance compliance is satisfied */
	compliant: boolean;
	/** Reasons for non-compliance */
	blockReasons: string[];
}
