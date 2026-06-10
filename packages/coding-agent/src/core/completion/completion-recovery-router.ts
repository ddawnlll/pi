/**
 * P44.5.08 — Completion Recovery Router
 *
 * Implements deterministic mapping from stage failure class to
 * recovery state, report type, and retry policy.
 *
 * This implements the frozen routing table from block-recovery-routing.md.
 * Each stage failure maps to exactly one recovery route.
 *
 * Contract Schema: 4.1.1
 */

import type { CompletionGateStageName, RecoveryRoute, StageFailureKind } from "./completion-gate-vnext-types.js";
import { createRecoveryRoute } from "./workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Routing Table
// ---------------------------------------------------------------------------

/**
 * The frozen routing table. Maps (stage, failureKind) to a recovery route.
 * This is authoritative and must not be deviated from at runtime.
 */
const ROUTING_TABLE: Record<string, RecoveryRoute> = {
	// DeclaredOutputExistenceStage: missing declared output -> NEEDS_REPAIR
	"DeclaredOutputExistence::missing_declared_output": {
		state: "NEEDS_REPAIR",
		reportType: "FPR",
		retryPolicy: "allowed_after_repair",
		reason: "Declared output file not found — fix the output and re-evaluate",
	},

	// EvidenceLedgerStage: missing or stale evidence -> NEEDS_REPAIR
	"EvidenceLedger::missing_or_stale_evidence": {
		state: "NEEDS_REPAIR",
		reportType: "FPR",
		retryPolicy: "allowed_after_evidence_added",
		reason: "Evidence missing or stale — add evidence and re-evaluate",
	},

	// ValidationStage: test failed or command invalid -> NEEDS_REPAIR_OR_RAR
	"Validation::test_failed_or_command_invalid": {
		state: "NEEDS_REPAIR_OR_RAR",
		reportType: "RAR",
		retryPolicy: "allowed_after_fix",
		reason: "Validation test failed — attempt repair twice, then emit RAR",
	},

	// ScopeAndWriteSetStage: unauthorized mutation -> NEEDS_HIR
	"ScopeAndWriteSet::unauthorized_mutation": {
		state: "NEEDS_HIR",
		reportType: "HIR",
		retryPolicy: "not_allowed_without_authority",
		reason: "Unauthorized mutation detected — human authority required",
	},

	// CommitExecutionStage: transient git failure -> RETRYABLE_BLOCKED
	"CommitExecution::transient_git_failure": {
		state: "RETRYABLE_BLOCKED",
		reportType: "none",
		retryPolicy: "bounded_retry_allowed",
		reason: "Transient git failure — retry with bounded budget",
	},

	// CommitExecutionStage: non-transient commit failure -> NEEDS_REPAIR
	"CommitExecution::non_transient_commit_failure": {
		state: "NEEDS_REPAIR",
		reportType: "FPR",
		retryPolicy: "allowed_after_fix",
		reason: "Non-transient commit failure — fix the issue and retry",
	},

	// PostCommitVerificationStage: commit missing expected files -> NEEDS_REPAIR
	"PostCommitVerification::commit_missing_expected_files": {
		state: "NEEDS_REPAIR",
		reportType: "FPR",
		retryPolicy: "allowed_after_repair",
		reason: "Expected files missing from commit — re-commit with all files",
	},

	// CommitMessageComposerStage: timeout or invalid message -> FALLBACK_MESSAGE_USED
	"CommitMessageComposer::timeout_or_invalid_message": {
		state: "FALLBACK_MESSAGE_USED",
		reportType: "none",
		retryPolicy: "not_needed",
		reason: "LLM composer failed — deterministic fallback used, no action needed",
	},

	// DestructiveOperationGuard: unpreserved output at risk -> NEEDS_HIR
	"DestructiveOperationGuard::unpreserved_output_at_risk": {
		state: "NEEDS_HIR",
		reportType: "HIR",
		retryPolicy: "not_allowed_without_preservation",
		reason: "Unpreserved output at risk — preserve or route to HIR",
	},
};

// ---------------------------------------------------------------------------
// Route Function
// ---------------------------------------------------------------------------

/**
 * Route a stage failure to the appropriate recovery action.
 *
 * @param stage - The stage that failed
 * @param failureKind - The kind of failure
 * @returns The recovery route
 */
export function routeStageFailure(stage: CompletionGateStageName, failureKind: StageFailureKind): RecoveryRoute {
	const key = `${stage}::${failureKind}`;
	const route = ROUTING_TABLE[key];

	if (route) {
		return route;
	}

	// Unknown stage/failure combination: default to HIR (fail-safe)
	return createRecoveryRoute(
		"NEEDS_HIR",
		"HIR",
		"not_allowed_without_authority",
		`Unknown failure: ${stage}::${failureKind} — human authority required`,
	);
}

/**
 * Get all available recovery routes for a stage.
 *
 * @param stage - The stage to query
 * @returns Array of (failureKind, route) pairs for the given stage
 */
export function getRoutesForStage(
	stage: CompletionGateStageName,
): Array<{ failureKind: StageFailureKind; route: RecoveryRoute }> {
	const results: Array<{ failureKind: StageFailureKind; route: RecoveryRoute }> = [];

	for (const [key, route] of Object.entries(ROUTING_TABLE)) {
		const [stageName] = key.split("::");
		if (stageName === stage) {
			const failureKind = key.split("::")[1] as StageFailureKind;
			results.push({ failureKind, route });
		}
	}

	return results;
}

/**
 * Verify that the routing table covers all expected stage/failure combinations.
 * Returns a list of missing entries.
 */
export function verifyRoutingTableCoverage(): string[] {
	const expected: Array<{ stage: CompletionGateStageName; failure: StageFailureKind }> = [
		{ stage: "DeclaredOutputExistence", failure: "missing_declared_output" },
		{ stage: "EvidenceLedger", failure: "missing_or_stale_evidence" },
		{ stage: "Validation", failure: "test_failed_or_command_invalid" },
		{ stage: "ScopeAndWriteSet", failure: "unauthorized_mutation" },
		{ stage: "CommitExecution", failure: "transient_git_failure" },
		{ stage: "CommitExecution", failure: "non_transient_commit_failure" },
		{ stage: "PostCommitVerification", failure: "commit_missing_expected_files" },
		{ stage: "CommitMessageComposer", failure: "timeout_or_invalid_message" },
		{ stage: "DestructiveOperationGuard", failure: "unpreserved_output_at_risk" },
	];

	const missing: string[] = [];
	for (const { stage, failure } of expected) {
		const key = `${stage}::${failure}`;
		if (!ROUTING_TABLE[key]) {
			missing.push(key);
		}
	}

	return missing;
}
