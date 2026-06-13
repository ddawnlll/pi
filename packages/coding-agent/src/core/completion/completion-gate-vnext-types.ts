/**
 * P44.5 — CompletionGate vNext Contract Types
 *
 * Defines the core types for the CompletionGate vNext durability pipeline.
 * These types are the contracts that gate all downstream implementation.
 *
 * Key types:
 * - CompletionGateVNextVerdict: Aggregated verdict from the stage pipeline
 * - StageVerdict: Individual stage result with recovery routing
 * - AgentCompletionClaim: What the agent claims about completion
 * - VerifiedReality: Runtime-verified truth about completion
 * - CommitCandidateSet: Files staged and ready for commit
 * - WorkspaceTruthStatus: Full truth status for dashboard/read model
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for vNext types.
 */
export const COMPLETION_GATE_VNEXT_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Valid rollout modes for the completion gate.
 */
export type RolloutMode = "off" | "shadow" | "warn" | "block_strict_plans" | "block_all_stable_3";

/**
 * Ordered list of rollout modes for progression.
 */
export const ROLLOUT_MODE_SEQUENCE: readonly RolloutMode[] = [
	"off",
	"shadow",
	"warn",
	"block_strict_plans",
	"block_all_stable_3",
] as const;

// ---------------------------------------------------------------------------
// Stage Names
// ---------------------------------------------------------------------------

/**
 * All named stages in the CompletionGate vNext pipeline.
 * Stages run in declaration order.
 */
export type CompletionGateStageName =
	| "DeclaredOutputExistence"
	| "EvidenceLedger"
	| "Validation"
	| "ScopeAndWriteSet"
	| "CommitCandidate"
	| "CommitExecution"
	| "PostCommitVerification"
	| "CommitMessageComposer"
	| "DestructiveOperationGuard"
	| "AccpGate";

/**
 * Ordered list of stage names matching execution order.
 *
 * AccpGate is placed after EvidenceLedger and before Validation so that the
 * ACCP gate verdict (compiled from compiled ACCP artifacts) is consulted
 * before the workspace's own validation stages run. This makes the
 * ACCP gate authoritative for runtime completion in `required` mode.
 */
export const STAGE_ORDER: readonly CompletionGateStageName[] = [
	"DeclaredOutputExistence",
	"EvidenceLedger",
	"AccpGate",
	"Validation",
	"ScopeAndWriteSet",
	"CommitCandidate",
	"CommitExecution",
	"PostCommitVerification",
	"CommitMessageComposer",
	"DestructiveOperationGuard",
] as const;

// ---------------------------------------------------------------------------
// Stage Verdict
// ---------------------------------------------------------------------------

/**
 * Individual stage verdict within the pipeline.
 */
export interface StageVerdict {
	/** Which stage produced this verdict */
	stage: CompletionGateStageName;
	/** Whether the stage passed */
	passed: boolean;
	/** Whether the stage produced a warning (non-blocking) */
	warning: boolean;
	/** Stage-specific status detail (structured per-stage) */
	detail: Record<string, unknown>;
	/** Blocking reasons if not passed (empty for passed stages) */
	blockReasons: string[];
	/** Warnings (non-blocking) */
	warnings: string[];
	/** Timestamp when the stage was evaluated (epoch ms) */
	evaluatedAt: number;
	/** Duration of stage evaluation (ms) */
	durationMs: number;
}

// ---------------------------------------------------------------------------
// Gate Verdict
// ---------------------------------------------------------------------------

/**
 * Aggregated verdict from the full CompletionGate vNext pipeline.
 */
export interface CompletionGateVNextVerdict {
	/** Workspace identifier */
	workspaceId: string;
	/** Plan identifier */
	planId: string;
	/** Overall pass/fail */
	passed: boolean;
	/** Rollout mode used for this evaluation */
	rolloutMode: RolloutMode;
	/** If in warn mode, warnings that would have blocked in strict mode */
	wouldBlockReasons?: string[];
	/** All blocking reasons (empty if passed) */
	blockReasons: string[];
	/** All warnings across stages (empty if clean) */
	warnings: string[];
	/** Individual stage verdicts in execution order */
	stageVerdicts: StageVerdict[];
	/** Recommended recovery route if blocked */
	routeRecommendation?: RecoveryRoute;
	/** Whether the gate was evaluated or skipped (e.g., off mode) */
	evaluated: boolean;
	/** Timestamp of gate evaluation (epoch ms) */
	evaluatedAt: number;
	/** Total duration of gate evaluation (ms) */
	durationMs: number;
}

// ---------------------------------------------------------------------------
// Recovery Routing
// ---------------------------------------------------------------------------

/**
 * Recovery state derived from stage failure class.
 */
export type RecoveryState =
	| "NEEDS_REPAIR"
	| "NEEDS_REPAIR_OR_RAR"
	| "NEEDS_HIR"
	| "RETRYABLE_BLOCKED"
	| "FALLBACK_MESSAGE_USED"
	| "PASSED"
	| "WARNED";

/**
 * ACCP report type triggered by a recovery state.
 */
export type RecoveryReportType = "FPR" | "HIR" | "RAR" | "none";

/**
 * Retry policy after stage failure.
 */
export type RetryPolicy =
	| "allowed_after_repair"
	| "allowed_after_evidence_added"
	| "allowed_after_fix"
	| "not_allowed_without_authority"
	| "bounded_retry_allowed"
	| "not_needed"
	| "not_allowed_without_preservation";

/**
 * Stage failure classification.
 */
export type StageFailureKind =
	| "missing_declared_output"
	| "missing_or_stale_evidence"
	| "test_failed_or_command_invalid"
	| "unauthorized_mutation"
	| "transient_git_failure"
	| "non_transient_commit_failure"
	| "commit_missing_expected_files"
	| "timeout_or_invalid_message"
	| "unpreserved_output_at_risk";

/**
 * Recovery route determined by stage failure classification.
 */
export interface RecoveryRoute {
	/** Where to route the workspace */
	state: RecoveryState;
	/** What ACCP report to generate */
	reportType: RecoveryReportType;
	/** What retry policy applies */
	retryPolicy: RetryPolicy;
	/** Human-readable explanation */
	reason: string;
}

// ---------------------------------------------------------------------------
// Agent Completion Claim
// ---------------------------------------------------------------------------

/**
 * What the agent claims about workspace completion.
 * This is NEVER authoritative — it is a claim that must be verified by the gate.
 */
export interface AgentCompletionClaim {
	/** Workspace identifier */
	workspaceId: string;
	/** Plan identifier */
	planId: string;
	/** Agent identifier */
	agentId: string;
	/** Agent role */
	agentRole: string;
	/** Files the agent claims to have created/modified */
	claimedFiles: string[];
	/** Validation results the agent claims */
	claimedValidationResults: string[];
	/** Whether the agent claims to have committed */
	claimedCommit: boolean;
	/** Claimed commit hash (empty if not committed) */
	claimedCommitHash?: string;
	/** Timestamp of the claim (epoch ms) */
	claimedAt: number;
	/** Any warnings the agent self-reported */
	claimedWarnings?: string[];
}

// ---------------------------------------------------------------------------
// Verified Reality
// ---------------------------------------------------------------------------

/**
 * Runtime-verified truth about workspace completion.
 * This IS authoritative — it is computed from git state, file system, and test results.
 */
export interface VerifiedReality {
	/** Workspace identifier */
	workspaceId: string;
	/** Plan identifier */
	planId: string;
	/** Files actually created/modified (from git diff) */
	actualFiles: string[];
	/** Validation results (from actual test runs) */
	actualValidationResults: string[];
	/** Whether a commit actually exists */
	commitExists: boolean;
	/** Actual commit hash (from git rev-parse) */
	commitHash?: string;
	/** Whether the commit is verified (post-commit checks passed) */
	commitVerified: boolean;
	/** Files verified in the commit */
	verifiedFiles: string[];
	/** Timestamp of reality check (epoch ms) */
	verifiedAt: number;
	/** Discrepancies between claim and reality */
	discrepancies: string[];
}

// ---------------------------------------------------------------------------
// Commit Candidate Set
// ---------------------------------------------------------------------------

/**
 * Set of files staged and ready for commit.
 */
export interface CommitCandidateSet {
	/** Workspace identifier */
	workspaceId: string;
	/** Files staged for commit */
	stagedFiles: string[];
	/** Files modified but unstaged */
	unstagedFiles: string[];
	/** Files in writeSet that are staged or modified */
	allowedFiles: string[];
	/** Files modified outside writeSet (always a concern) */
	unexpectedFiles: string[];
	/** Generated artifact files (safe to commit if configured) */
	artifactFiles?: string[];
	/** Whether bulk git add was attempted (blocked) */
	bulkAddAttempted: boolean;
	/** Timestamp of candidate set computation (epoch ms) */
	computedAt: number;
}

// ---------------------------------------------------------------------------
// Workspace Truth Status
// ---------------------------------------------------------------------------

/**
 * Runtime execution status of a workspace.
 */
export type WorkspaceRuntimeStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "BLOCKED" | "UNKNOWN";

/**
 * Implementation status of a workspace.
 * This is about whether the code changes exist (not whether they're correct).
 */
export type WorkspaceImplementationStatus = "NOT_STARTED" | "IN_PROGRESS" | "DECLARED_OUTPUT_EXISTS" | "UNKNOWN";

/**
 * Validation status of a workspace.
 * This is about whether tests passed.
 */
export type WorkspaceValidationStatus = "NOT_RUN" | "RUNNING" | "PASSED" | "FAILED" | "WARNINGS" | "UNKNOWN";

/**
 * Durability status of a workspace.
 * This is about whether the work is durably committed.
 */
export type WorkspaceDurabilityStatus =
	| "NOT_COMMITTED"
	| "COMMIT_IN_PROGRESS"
	| "COMMITTED"
	| "POST_COMMIT_VERIFIED"
	| "COMMIT_FAILED"
	| "UNCOMMITTED_OUTPUT_AT_RISK"
	| "UNKNOWN";

/**
 * Backfill status for legacy COMPLETE workspaces.
 */
export type BackfillStatus =
	| "vnext_verified" // Full vNext verification passed
	| "legacy_commit_present" // Has commit hash but no post-commit verification
	| "legacy_no_commit_data" // No commit hash available
	| "not_applicable"; // Current workspace, not legacy

/**
 * Full truth status for a workspace in the dashboard/read model.
 *
 * This is the authoritative status. verifiedComplete is true ONLY when all four
 * status dimensions pass: runtime=COMPLETE, implementation=DECLARED_OUTPUT_EXISTS,
 * validation=PASSED, durability=POST_COMMIT_VERIFIED.
 */
export interface WorkspaceTruthStatus {
	/** Workspace identifier */
	workspaceId: string;
	/** Plan identifier */
	planId: string;
	/** Wave identifier */
	waveId?: string;

	/** Runtime execution status */
	runtimeStatus: WorkspaceRuntimeStatus;
	/** Implementation existence status */
	implementationStatus: WorkspaceImplementationStatus;
	/** Validation pass/fail status */
	validationStatus: WorkspaceValidationStatus;
	/** Durability/commit status */
	durabilityStatus: WorkspaceDurabilityStatus;

	/** Whether the workspace is fully verified complete (all four dimensions pass) */
	verifiedComplete: boolean;
	/** Backfill status for legacy workspaces */
	backfillStatus: BackfillStatus;

	/** Commit hash (if committed) */
	commitHash?: string;
	/** Files verified in the commit */
	verifiedFiles: string[];
	/** Number of files modified */
	filesModified: number;

	/** Blockers preventing completion (blocking issues) */
	blockers: string[];
	/** Warnings (non-blocking issues) */
	warnings: string[];

	/** Recommended recovery route if blocked */
	routeRecommendation?: RecoveryRoute;

	/** Current rollout mode */
	rolloutMode: RolloutMode;
	/** What mode is required for this workspace to be fully gated */
	requiredMode?: RolloutMode;

	/** Agent completion claim (for comparison with reality) */
	agentClaim?: AgentCompletionClaim;
	/** Verified reality (for comparison with claim) */
	verifiedReality?: VerifiedReality;

	/** Timestamp of last status update (epoch ms) */
	lastUpdatedAt: number;
	/** CompletionGate vNext verdict from last evaluation */
	lastVerdict?: CompletionGateVNextVerdict;
}
