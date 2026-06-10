/**
 * P44.5.11 — Verified Complete Backfill
 *
 * Computes retroactive verifiedComplete status for legacy COMPLETE workspaces
 * that were completed before P44.5 deployment. This is a READ-MODEL PROJECTION
 * only — it NEVER mutates historical state.
 *
 * Values:
 * - vnext_verified: Full vNext verification passed (has commit hash + post-commit)
 * - legacy_commit_present: Has commit hash but no post-commit verification data
 * - legacy_no_commit_data: No commit hash available (workspace completed before P44.5)
 * - not_applicable: Current workspace, not legacy
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Backfill status for a workspace.
 */
export type VerifiedCompleteBackfillStatus =
	| "vnext_verified"
	| "legacy_commit_present"
	| "legacy_no_commit_data"
	| "not_applicable";

/**
 * Input data needed to compute backfill status for a workspace.
 */
export interface BackfillInput {
	/** Workspace identifier */
	workspaceId: string;
	/** Whether the workspace has a full vNext completion gate verdict */
	hasVNextVerdict: boolean;
	/** Whether the workspace has a commit hash */
	hasCommitHash: boolean;
	/** Whether the workspace has post-commit verification data */
	hasPostCommitVerification: boolean;
	/** Workspace stage */
	stage: string;
	/** Timestamp when the workspace was completed (epoch ms) */
	completedAt?: number;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/**
 * Timestamp (epoch ms) of the P44.5 deployment.
 * Workspaces completed before this are considered legacy.
 */
export const P445_DEPLOYMENT_TIMESTAMP = Date.now();

// ---------------------------------------------------------------------------
// Backfill Computation
// ---------------------------------------------------------------------------

/**
 * Compute backfill status for a workspace.
 * This is a pure function — never mutates state.
 *
 * @param input - Backfill input data
 * @returns Backfill status
 */
export function computeBackfillStatus(input: BackfillInput): VerifiedCompleteBackfillStatus {
	// If workspace has a vNext verdict, it was evaluated by the new gate
	if (input.hasVNextVerdict) {
		return "vnext_verified";
	}

	// If workspace has commit hash but no post-commit verification
	if (input.hasCommitHash && !input.hasPostCommitVerification) {
		return "legacy_commit_present";
	}

	// If no commit hash at all
	if (!input.hasCommitHash) {
		return "legacy_no_commit_data";
	}

	return "not_applicable";
}

/**
 * Compute backfill status for a legacy workspace that was COMPLETE before P44.5.
 * Legacy workspaces are identified by having no vNext verdict data.
 *
 * @param workspaceId - Workspace identifier
 * @param hasCommitHash - Whether the workspace state has a commit hash
 * @returns Backfill status
 */
export function computeLegacyBackfillStatus(
	_workspaceId: string,
	hasCommitHash: boolean,
): VerifiedCompleteBackfillStatus {
	if (hasCommitHash) {
		return "legacy_commit_present";
	}
	return "legacy_no_commit_data";
}

/**
 * Create a backfill status default for a workspace with no data.
 */
export function createDefaultBackfillStatus(): VerifiedCompleteBackfillStatus {
	return "not_applicable";
}

/**
 * Check if a backfill status indicates the workspace needs attention.
 */
export function needsBackfillAttention(status: VerifiedCompleteBackfillStatus): boolean {
	return status === "legacy_no_commit_data" || status === "legacy_commit_present";
}

/**
 * Human-readable label for a backfill status.
 */
export function backfillStatusLabel(status: VerifiedCompleteBackfillStatus): string {
	const labels: Record<VerifiedCompleteBackfillStatus, string> = {
		vnext_verified: "Verified by vNext gate",
		legacy_commit_present: "Has commit, no post-commit verification (legacy)",
		legacy_no_commit_data: "No commit data available (legacy)",
		not_applicable: "Current workspace",
	};
	return labels[status];
}
