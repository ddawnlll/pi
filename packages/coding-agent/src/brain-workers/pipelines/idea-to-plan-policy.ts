/**
 * Idea to Plan Pipeline Policy — 25.Q
 *
 * Defines policy configuration for the idea-to-plan pipeline,
 * including budget controls, cooldown management, deduplication,
 * and stop-condition handling.
 *
 * The policy controls how ideas are promoted to proposals, and how
 * proposals are synthesized into plans. It enforces:
 * - Minimum confidence thresholds for idea-to-proposal promotion
 * - Maximum input sizes per pipeline run
 * - Resource budgets (tokens, runtime, consecutive failures)
 * - Cooldown periods between pipeline runs
 * - Deduplication windows to prevent redundant processing
 * - Stop conditions for pipeline auto-termination
 * - Closed-loop gating (approval or safe local execution policy)
 *
 * @packageDocumentation
 */

import type { WorkerBudget, WorkerDedupConfig, WorkerStopCondition } from "../types.js";

// ---------------------------------------------------------------------------
// Pipeline Stop Condition
// ---------------------------------------------------------------------------

/**
 * Conditions that cause the pipeline to stop processing.
 * Extends WorkerStopCondition with pipeline-specific conditions.
 */
export type PipelineStopCondition =
	| WorkerStopCondition
	| "max_ideas_reached" // Maximum ideas per run exceeded
	| "max_proposals_reached" // Maximum proposals per run exceeded
	| "low_confidence" // Idea confidence below threshold after filtering
	| "no_valid_proposals" // All ideas failed proposal validation
	| "synthesis_failed" // Plan synthesis step failed
	| "approval_required"; // Pipeline is gated and needs approval

/**
 * All valid PipelineStopCondition values for runtime validation.
 */
export const ALL_PIPELINE_STOP_CONDITIONS: readonly PipelineStopCondition[] = [
	"completed",
	"timeout",
	"token_budget_exhausted",
	"consecutive_failures_exceeded",
	"dag_validation_failed",
	"user_interrupt",
	"policy_blocked",
	"dependency_unavailable",
	"system_shutdown",
	"unknown_error",
	"max_ideas_reached",
	"max_proposals_reached",
	"low_confidence",
	"no_valid_proposals",
	"synthesis_failed",
	"approval_required",
] as const;

// ---------------------------------------------------------------------------
// Pipeline Stage
// ---------------------------------------------------------------------------

/**
 * Stages of the idea-to-plan pipeline.
 */
export type PipelineStage =
	| "idle" // Pipeline created, awaiting input
	| "ingesting_ideas" // Receiving and validating input ideas
	| "promoting_to_proposals" // Converting ideas to proposals
	| "synthesizing_plan" // Running plan synthesis
	| "validating_output" // Validating the generated plan
	| "completed" // Pipeline completed with output
	| "failed" // Pipeline failed with diagnostic
	| "cancelled" // Pipeline was cancelled
	| "awaiting_approval"; // Pipeline is gated and awaiting approval

/**
 * All valid PipelineStage values for runtime validation.
 */
export const ALL_PIPELINE_STAGES: readonly PipelineStage[] = [
	"idle",
	"ingesting_ideas",
	"promoting_to_proposals",
	"synthesizing_plan",
	"validating_output",
	"completed",
	"failed",
	"cancelled",
	"awaiting_approval",
] as const;

// ---------------------------------------------------------------------------
// Pipeline Policy Configuration
// ---------------------------------------------------------------------------

/**
 * Policy configuration for the idea-to-plan pipeline.
 *
 * Controls all autonomous behavior aspects including budgets, cooldowns,
 * deduplication, stop conditions, and approval gating.
 */
export interface IdeaToPlanPolicy {
	// -----------------------------------------------------------------------
	// Input Limits
	// -----------------------------------------------------------------------

	/**
	 * Maximum number of ideas accepted per pipeline run.
	 * Default: 20
	 */
	maxIdeasPerRun: number;

	/**
	 * Maximum number of proposals generated per pipeline run.
	 * Default: 10
	 */
	maxProposalsPerRun: number;

	// -----------------------------------------------------------------------
	// Confidence Thresholds
	// -----------------------------------------------------------------------

	/**
	 * Minimum confidence score (0-1) for an idea to be promoted to a proposal.
	 * Ideas below this threshold are still recorded but not promoted.
	 * Default: 0.4
	 */
	minIdeaConfidenceForProposal: number;

	/**
	 * Minimum confidence score (0-1) for a proposal to be included in
	 * plan synthesis. Proposals below this threshold are skipped.
	 * Default: 0.5
	 */
	minProposalConfidenceForSynthesis: number;

	// -----------------------------------------------------------------------
	// Budget Enforcement
	// -----------------------------------------------------------------------

	/**
	 * Resource budget for each pipeline run.
	 * Default: 250_000 tokens, 3 max consecutive failures, 300s cooldown,
	 * 1_200_000ms max runtime.
	 */
	budget: WorkerBudget;

	// -----------------------------------------------------------------------
	// Deduplication
	// -----------------------------------------------------------------------

	/**
	 * Deduplication configuration.
	 * Default: enabled, 300_000ms window, similarity matching at 0.85 threshold.
	 */
	dedupConfig: WorkerDedupConfig;

	// -----------------------------------------------------------------------
	// Closed-Loop Gating
	// -----------------------------------------------------------------------

	/**
	 * Whether the pipeline requires approval before executing.
	 *
	 * When true:
	 * - The pipeline pauses at the "awaiting_approval" stage after
	 *   proposal generation, requiring manual approval to proceed
	 *   to plan synthesis.
	 * - If approval is denied, the pipeline is cancelled.
	 *
	 * When false:
	 * - The pipeline proceeds autonomously through all stages.
	 * - Local execution policy checks still apply.
	 *
	 * Default: true (approval gate enabled for safety)
	 */
	requireApproval: boolean;

	/**
	 * Whether local execution policy checks are enforced.
	 *
	 * When true:
	 * - The pipeline validates that all operations are safe for
	 *   local execution before proceeding.
	 * - If any operation is deemed unsafe, the pipeline reports
	 *   a diagnostic and stops.
	 *
	 * Default: true
	 */
	enforceLocalExecutionPolicy: boolean;

	/**
	 * Maximum recursion depth for autonomous pipeline re-invocation.
	 *
	 * Prevents the pipeline from recursively triggering itself
	 * beyond this depth. Each full pipeline run counts as one level.
	 * Default: 1 (no recursion by default)
	 */
	maxRecursionDepth: number;

	// -----------------------------------------------------------------------
	// Diagnostics and Observability
	// -----------------------------------------------------------------------

	/**
	 * Whether to emit detailed diagnostics for all stop conditions.
	 * Default: true
	 */
	verboseDiagnostics: boolean;

	/**
	 * Maximum number of evidence references to retain per diagnostic.
	 * Default: 20
	 */
	maxEvidenceRefsPerDiagnostic: number;

	// -----------------------------------------------------------------------
	// Template and Version
	// -----------------------------------------------------------------------

	/**
	 * Contract version string for the pipeline.
	 * Default: "1.0.0"
	 */
	contractVersion: string;

	/**
	 * Plan template ID to use for synthesis, if any.
	 * Default: "standard-execution"
	 */
	defaultTemplateId: string;
}

// ---------------------------------------------------------------------------
// Default Policy
// ---------------------------------------------------------------------------

/**
 * Default policy configuration.
 *
 * Sensible defaults for safe autonomous operation with approval gating.
 */
export const DEFAULT_IDEA_TO_PLAN_POLICY: IdeaToPlanPolicy = {
	maxIdeasPerRun: 20,
	maxProposalsPerRun: 10,
	minIdeaConfidenceForProposal: 0.4,
	minProposalConfidenceForSynthesis: 0.5,
	budget: {
		maxTokensPerCycle: 250_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 300_000,
		maxRuntimeMs: 1_200_000,
	},
	dedupConfig: {
		enabled: true,
		windowMs: 300_000,
		useSimilarity: true,
		similarityThreshold: 0.85,
	},
	requireApproval: true,
	enforceLocalExecutionPolicy: true,
	maxRecursionDepth: 1,
	verboseDiagnostics: true,
	maxEvidenceRefsPerDiagnostic: 20,
	contractVersion: "1.0.0",
	defaultTemplateId: "standard-execution",
};
