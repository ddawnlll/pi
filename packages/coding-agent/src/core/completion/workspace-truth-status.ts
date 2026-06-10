/**
 * P44.5 — Workspace Truth Status Utilities
 *
 * Helper functions for constructing, validating, and deriving truth statuses
 * for the dashboard/read model.
 *
 * Contract Schema: 4.1.1
 */

import type {
	BackfillStatus,
	CompletionGateVNextVerdict,
	RecoveryRoute,
	RecoveryState,
	RolloutMode,
	StageVerdict,
	WorkspaceDurabilityStatus,
	WorkspaceImplementationStatus,
	WorkspaceRuntimeStatus,
	WorkspaceTruthStatus,
	WorkspaceValidationStatus,
} from "./completion-gate-vnext-types.js";

// ---------------------------------------------------------------------------
// Status Constants
// ---------------------------------------------------------------------------

/**
 * Default rollout mode for new workspaces.
 */
export const DEFAULT_ROLLOUT_MODE: RolloutMode = "shadow";

/**
 * Minimum rollout mode that blocks completion.
 */
export const BLOCKING_ROLLOUT_MODES: readonly RolloutMode[] = ["block_strict_plans", "block_all_stable_3"] as const;

// ---------------------------------------------------------------------------
// Truth Status Builders
// ---------------------------------------------------------------------------

/**
 * Create an empty/unknown truth status for a workspace.
 * Used as an initial state before any evaluation runs.
 */
export function createWorkspaceTruthStatus(
	workspaceId: string,
	planId: string,
	options?: {
		waveId?: string;
		rolloutMode?: RolloutMode;
	},
): WorkspaceTruthStatus {
	return {
		workspaceId,
		planId,
		waveId: options?.waveId,
		runtimeStatus: "UNKNOWN",
		implementationStatus: "UNKNOWN",
		validationStatus: "UNKNOWN",
		durabilityStatus: "UNKNOWN",
		verifiedComplete: false,
		backfillStatus: "not_applicable",
		verifiedFiles: [],
		filesModified: 0,
		blockers: [],
		warnings: [],
		rolloutMode: options?.rolloutMode ?? DEFAULT_ROLLOUT_MODE,
		lastUpdatedAt: Date.now(),
	};
}

/**
 * Compute verifiedComplete from the four status dimensions.
 *
 * verifiedComplete is true ONLY when:
 * - runtimeStatus is COMPLETE
 * - implementationStatus is DECLARED_OUTPUT_EXISTS
 * - validationStatus is PASSED
 * - durabilityStatus is POST_COMMIT_VERIFIED
 */
export function computeVerifiedComplete(
	runtimeStatus: WorkspaceRuntimeStatus,
	implementationStatus: WorkspaceImplementationStatus,
	validationStatus: WorkspaceValidationStatus,
	durabilityStatus: WorkspaceDurabilityStatus,
): boolean {
	return (
		runtimeStatus === "COMPLETE" &&
		implementationStatus === "DECLARED_OUTPUT_EXISTS" &&
		validationStatus === "PASSED" &&
		durabilityStatus === "POST_COMMIT_VERIFIED"
	);
}

// ---------------------------------------------------------------------------
// Verdict Integration
// ---------------------------------------------------------------------------

/**
 * Apply a CompletionGateVNextVerdict to a WorkspaceTruthStatus.
 * Mutates the status in place and returns it.
 */
export function applyVerdictToStatus(
	status: WorkspaceTruthStatus,
	verdict: CompletionGateVNextVerdict,
): WorkspaceTruthStatus {
	status.lastVerdict = verdict;
	status.lastUpdatedAt = Date.now();
	status.blockers = verdict.blockReasons;
	status.warnings = verdict.warnings;

	if (verdict.routeRecommendation) {
		status.routeRecommendation = verdict.routeRecommendation;
	}

	// Update durability status from stage verdicts
	for (const sv of verdict.stageVerdicts) {
		switch (sv.stage) {
			case "DeclaredOutputExistence":
				status.implementationStatus = sv.passed ? "DECLARED_OUTPUT_EXISTS" : "NOT_STARTED";
				break;
			case "Validation":
				if (sv.passed) {
					status.validationStatus = "PASSED";
				} else if (sv.warning) {
					status.validationStatus = "WARNINGS";
				} else {
					status.validationStatus = "FAILED";
				}
				break;
			case "CommitExecution":
				status.durabilityStatus = sv.passed ? "COMMITTED" : "COMMIT_FAILED";
				break;
			case "PostCommitVerification":
				status.durabilityStatus = sv.passed ? "POST_COMMIT_VERIFIED" : "COMMITTED";
				break;
		}
	}

	// Recompute verifiedComplete
	status.verifiedComplete = computeVerifiedComplete(
		status.runtimeStatus,
		status.implementationStatus,
		status.validationStatus,
		status.durabilityStatus,
	);

	return status;
}

// ---------------------------------------------------------------------------
// Blocked Workspace Check
// ---------------------------------------------------------------------------

/**
 * Determine whether a rollout mode should block completion.
 */
export function shouldBlockCompletion(mode: RolloutMode, _requiredMode?: RolloutMode): boolean {
	if (mode === "off" || mode === "shadow") return false;
	if (mode === "warn") return false;
	if (mode === "block_strict_plans" || mode === "block_all_stable_3") return true;
	return false;
}

/**
 * Get recovery state from the first stage verdict that recommends a non-passed state.
 */
export function deriveRecoveryState(verdict: CompletionGateVNextVerdict): RecoveryState {
	if (verdict.passed) return "PASSED";

	for (const sv of verdict.stageVerdicts) {
		if (!sv.passed && sv.detail.recoveryState) {
			return sv.detail.recoveryState as RecoveryState;
		}
	}

	// Default: repair needed if not passed
	return "NEEDS_REPAIR";
}

// ---------------------------------------------------------------------------
// Backfill Helpers
// ---------------------------------------------------------------------------

/**
 * Determine backfill status for a workspace based on available data.
 */
export function determineBackfillStatus(
	hasCommitHash: boolean,
	hasPostCommitVerification: boolean,
	hasVNextVerdict: boolean,
): BackfillStatus {
	if (hasVNextVerdict) return "vnext_verified";
	if (hasCommitHash && !hasPostCommitVerification) return "legacy_commit_present";
	if (!hasCommitHash) return "legacy_no_commit_data";
	return "not_applicable";
}

// ---------------------------------------------------------------------------
// Stage Verdict Helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple passed stage verdict.
 */
export function createPassedStageVerdict(
	stage: StageVerdict["stage"],
	detail?: Record<string, unknown>,
	durationMs?: number,
): StageVerdict {
	return {
		stage,
		passed: true,
		warning: false,
		detail: detail ?? {},
		blockReasons: [],
		warnings: [],
		evaluatedAt: Date.now(),
		durationMs: durationMs ?? 0,
	};
}

/**
 * Create a failed stage verdict with block reasons.
 */
export function createFailedStageVerdict(
	stage: StageVerdict["stage"],
	blockReasons: string[],
	detail?: Record<string, unknown>,
	durationMs?: number,
): StageVerdict {
	return {
		stage,
		passed: false,
		warning: false,
		detail: detail ?? {},
		blockReasons,
		warnings: [],
		evaluatedAt: Date.now(),
		durationMs: durationMs ?? 0,
	};
}

/**
 * Create a warning stage verdict (passed but with warnings).
 */
export function createWarningStageVerdict(
	stage: StageVerdict["stage"],
	warnings: string[],
	detail?: Record<string, unknown>,
	durationMs?: number,
): StageVerdict {
	return {
		stage,
		passed: true,
		warning: true,
		detail: detail ?? {},
		blockReasons: [],
		warnings,
		evaluatedAt: Date.now(),
		durationMs: durationMs ?? 0,
	};
}

// ---------------------------------------------------------------------------
// Recovery Route Helpers
// ---------------------------------------------------------------------------

/**
 * Create a recovery route from state, report type, and retry policy.
 */
export function createRecoveryRoute(
	state: RecoveryState,
	reportType: RecoveryRoute["reportType"],
	retryPolicy: RecoveryRoute["retryPolicy"],
	reason: string,
): RecoveryRoute {
	return { state, reportType, retryPolicy, reason };
}

// ---------------------------------------------------------------------------
// Status String Converters (for rendering)
// ---------------------------------------------------------------------------

/**
 * Human-readable label for durability status.
 */
export function durabilityStatusLabel(s: WorkspaceDurabilityStatus): string {
	const map: Record<WorkspaceDurabilityStatus, string> = {
		NOT_COMMITTED: "Not Committed",
		COMMIT_IN_PROGRESS: "Commit In Progress",
		COMMITTED: "Committed",
		POST_COMMIT_VERIFIED: "Post-Commit Verified",
		COMMIT_FAILED: "Commit Failed",
		UNCOMMITTED_OUTPUT_AT_RISK: "Uncommitted Output At Risk",
		UNKNOWN: "Unknown",
	};
	return map[s];
}

/**
 * Human-readable label for validation status.
 */
export function validationStatusLabel(s: WorkspaceValidationStatus): string {
	const map: Record<WorkspaceValidationStatus, string> = {
		NOT_RUN: "Not Run",
		RUNNING: "Running",
		PASSED: "Passed",
		FAILED: "Failed",
		WARNINGS: "Warnings",
		UNKNOWN: "Unknown",
	};
	return map[s];
}
