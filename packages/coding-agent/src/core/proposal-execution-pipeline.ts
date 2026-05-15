/**
 * Proposal Execution Pipeline - P9.B
 *
 * Orchestrates the proposal-to-plan-to-execution pipeline with two separate
 * approval gates and an optimization feedback loop:
 *
 *   1. Proposal approval — Review and approve the proposal itself
 *   2. Remediation draft generation — Create a non-executable draft plan
 *   3. Planning approval — Approve the remediation plan (Gate 1)
 *   4. Execution approval — Approve actual execution (Gate 2, separate from Gate 1)
 *   5. Execution — Run the approved plan
 *   6. Optimization submission — Feed execution results to the planner feedback loop
 *
 * Acceptance Criteria:
 * 1. Approved proposals can generate remediation plan drafts (AC1).
 * 2. Planning approval does not imply execution approval (AC2).
 * 3. Generated plans can be submitted to planner optimization (AC3).
 */

import { checkDraftGates, type DraftGateResult, type DraftPlanMeta, DraftPlanner } from "./draft-planner.js";
import type { PlannerOutput } from "./planner.js";
import type { FeedbackLoopResult, PlannerFeedbackLoop, QueueOutcome } from "./planner-feedback-loop.js";
import {
	type ActionProposalResult,
	type Proposal,
	type ProposalEvidence,
	ProposalInbox,
	type SubmitProposalResult,
} from "./proposal-inbox.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Remediation Draft Types
// ---------------------------------------------------------------------------

/**
 * The type of remediation a draft plan addresses.
 */
export type RemediationType =
	/** Fixing detected code defects or health signals */
	| "defect_fix"
	/** Resolving merge conflicts detected during integration */
	| "conflict_resolution"
	/** Addressing performance bottlenecks from feedback loop */
	| "performance_optimization"
	/** Fixing dependency ordering or structural issues */
	| "dependency_repair"
	/** Applying safety recommendations from detection engine */
	| "safety_remediation"
	/** General-purpose remediation */
	| "general";

/**
 * Metadata about the source that triggered the remediation.
 */
export interface RemediationSource {
	/** Identifies what triggered the remediation */
	kind: "detection_output" | "feedback_loop" | "user_initiated" | "scheduled" | "health_signal";
	/** Reference ID from the source system */
	referenceId?: string;
	/** Human-readable description of the source */
	description: string;
	/** When the source was identified */
	timestamp: number;
}

/**
 * A remediation plan draft — a specialized draft plan with remediation
 * metadata that tracks the source, type, and approval status.
 *
 * Remediation drafts are generated from approved proposals and must
 * pass two separate approval gates before execution:
 *   1. Planning approval (Gate 1) — the plan is sound
 *   2. Execution approval (Gate 2) — the plan should be executed
 */
export interface RemediationDraftPlan {
	/** The underlying draft plan metadata */
	draftMeta: DraftPlanMeta;
	/** The type of remediation */
	remediationType: RemediationType;
	/** The source that triggered this remediation */
	source: RemediationSource;
	/** Whether planning approval (Gate 1) has been granted */
	planningApproved: boolean;
	/** Whether execution approval (Gate 2) has been granted */
	executionApproved: boolean;
	/** Timestamp when planning approval was granted */
	planningApprovedAt?: number;
	/** Timestamp when execution approval was granted */
	executionApprovedAt?: number;
	/** Path to the remediation draft plan file */
	filePath: string;
	/** Optional execution outcome (populated after execution) */
	executionOutcome?: QueueOutcome[];
	/** Optional optimization result (populated after optimization submission) */
	optimizationResult?: FeedbackLoopResult;
}

/**
 * Result of generating a remediation plan draft.
 */
export interface GenerateRemediationDraftResult {
	/** Whether generation succeeded */
	success: boolean;
	/** The remediation draft plan (if successful) */
	remediationDraft?: RemediationDraftPlan;
	/** Error message (if failed) */
	error?: string;
}

/**
 * Result of a planning approval operation.
 */
export interface RemediationPlanApprovalResult {
	/** Whether the operation succeeded */
	success: boolean;
	/** Updated remediation draft plan (if successful) */
	remediationDraft?: RemediationDraftPlan;
	/** Error message (if failed) */
	error?: string;
}

/**
 * Result of submitting to planner optimization.
 */
export interface OptimizationSubmissionResult {
	/** Whether submission succeeded */
	success: boolean;
	/** Feedback loop result (if successful) */
	feedbackResult?: FeedbackLoopResult;
	/** Error message (if failed) */
	error?: string;
}

// ---------------------------------------------------------------------------
// Pipeline Stage
// ---------------------------------------------------------------------------

/**
 * The current stage of a proposal in the execution pipeline.
 *
 * Tracks progress from proposal submission through to optimization.
 */
export type PipelineStage =
	| "proposal_submitted"
	| "proposal_approved"
	| "remediation_drafting"
	| "remediation_draft_ready"
	| "planning_approved"
	| "execution_approved"
	| "executing"
	| "executed"
	| "optimization_submitted"
	| "failed";

/**
 * Human-readable labels for each pipeline stage.
 */
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
	proposal_submitted: "Proposal submitted, awaiting approval",
	proposal_approved: "Proposal approved, ready for remediation drafting",
	remediation_drafting: "Generating remediation plan draft",
	remediation_draft_ready: "Remediation draft ready for planning approval",
	planning_approved: "Planning approved, awaiting execution approval",
	execution_approved: "Execution approved, plan may be executed",
	executing: "Plan executing",
	executed: "Plan executed, ready for optimization submission",
	optimization_submitted: "Results submitted to planner optimization",
	failed: "Pipeline stage failed",
};

/**
 * A stage entry in the pipeline audit trail.
 */
export interface PipelineStageEntry {
	/** The stage */
	stage: PipelineStage;
	/** Timestamp when the stage was entered */
	timestamp: number;
	/** Human-readable reason for entering this stage */
	reason: string;
	/** Optional actor who triggered the transition */
	actor?: string;
}

// ---------------------------------------------------------------------------
// Pipeline Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the proposal execution pipeline.
 */
export interface ProposalExecutionPipelineConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** .pi directory name (default: ".pi") */
	piDir?: string;
	/** Planner feedback loop instance (optional, for AC3 optimization) */
	feedbackLoop?: PlannerFeedbackLoop;
}

// ---------------------------------------------------------------------------
// Proposal Execution Pipeline
// ---------------------------------------------------------------------------

/**
 * Proposal Execution Pipeline.
 *
 * Connects the ProposalInbox (proposal lifecycle), DraftPlanner (draft
 * generation), planning/execution gates, and PlannerFeedbackLoop
 * (optimization) into a single orchestrated pipeline.
 *
 * The pipeline enforces:
 * - AC1: Only approved proposals can generate remediation plan drafts
 * - AC2: Planning approval (Gate 1) is separate from execution approval (Gate 2)
 * - AC3: Generated plans can be submitted to planner optimization
 *
 * @example
 * ```typescript
 * const pipeline = new ProposalExecutionPipeline({ workspaceRoot: "/repo" });
 * await pipeline.initialize();
 *
 * // Submit and approve a proposal
 * const submitResult = await pipeline.submitProposal("Fix", "P9", queue, plannerOutput);
 * await pipeline.approveProposal(submitResult.proposal!.id);
 *
 * // Generate remediation draft (AC1)
 * const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
 *   remediationType: "defect_fix",
 *   source: { kind: "user_initiated", description: "User request", timestamp: Date.now() },
 *   leadAgentId: "agent-1",
 * });
 *
 * // Planning approval (Gate 1) — does not imply execution approval (AC2)
 * await pipeline.approvePlanning(draftResult.remediationDraft!.draftMeta.id);
 *
 * // Execution approval (Gate 2) — separate gate
 * await pipeline.approveExecution(draftResult.remediationDraft!.draftMeta.id);
 *
 * // Submit to optimization (AC3)
 * await pipeline.submitToOptimization(draftResult.remediationDraft!.draftMeta.id, outcomes);
 * ```
 */
export class ProposalExecutionPipeline {
	private inbox: ProposalInbox;
	private draftPlanner: DraftPlanner;
	private feedbackLoop?: PlannerFeedbackLoop;
	private workspaceRoot: string;
	private piDir: string;

	/** Pipeline metadata tracked inline with proposals */
	private pipelineMeta: Map<string, PipelineMeta> = new Map();
	/** Remediation draft plans keyed by draft ID */
	private remediationDrafts: Map<string, RemediationDraftPlan> = new Map();
	/** Whether the pipeline has been initialized */
	private initialized = false;

	constructor(config: ProposalExecutionPipelineConfig) {
		this.workspaceRoot = config.workspaceRoot;
		this.piDir = config.piDir ?? ".pi";
		this.inbox = new ProposalInbox(this.workspaceRoot, this.piDir);
		this.draftPlanner = new DraftPlanner({ workspaceRoot: this.workspaceRoot, piDir: this.piDir });
		this.feedbackLoop = config.feedbackLoop;
	}

	/**
	 * Initialize the pipeline.
	 *
	 * Loads proposal inbox from disk and prepares the pipeline for use.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;
		await this.inbox.initialize();
		this.initialized = true;
	}

	// =========================================================================
	// Proposal Inbox Delegates
	// =========================================================================

	/**
	 * Submit a new proposal to the inbox.
	 *
	 * Delegates to ProposalInbox and tracks pipeline stage.
	 *
	 * @returns Submission result
	 */
	async submitProposal(
		title: string,
		phase: string,
		queue: WorkspaceQueue,
		plannerOutput: PlannerOutput,
		options?: {
			actor?: string;
			optimizationProposals?: ProposalEvidence["optimizationProposals"];
			detections?: ProposalEvidence["detections"];
			detectionOutput?: ProposalEvidence["detectionOutput"];
			overallRisk?: ProposalEvidence["overallRisk"];
			overallConfidence?: ProposalEvidence["overallConfidence"];
			metadata?: Record<string, unknown>;
		},
	): Promise<SubmitProposalResult> {
		if (!this.initialized) await this.initialize();

		const result = await this.inbox.submitProposal(title, phase, queue, plannerOutput, options);

		if (result.success && result.proposal) {
			this.pipelineMeta.set(result.proposal.id, {
				proposalId: result.proposal.id,
				stage: "proposal_submitted",
				stageHistory: [
					{
						stage: "proposal_submitted",
						timestamp: result.proposal.submittedAt,
						reason: "Proposal submitted",
						actor: options?.actor,
					},
				],
			});
		}

		return result;
	}

	/**
	 * Approve a proposal.
	 *
	 * Delegates to ProposalInbox and advances pipeline stage.
	 *
	 * @returns Action result
	 */
	async approveProposal(
		proposalId: string,
		options?: { actor?: string; reason?: string },
	): Promise<ActionProposalResult> {
		if (!this.initialized) await this.initialize();

		const result = await this.inbox.approveProposal(proposalId, options);

		if (result.success) {
			const meta = this.pipelineMeta.get(proposalId) ?? this.createMeta(proposalId);
			this.advanceStage(meta, "proposal_approved", options?.reason ?? "Proposal approved", options?.actor);
		}

		return result;
	}

	/**
	 * Reject a proposal.
	 *
	 * Delegates to ProposalInbox.
	 */
	async rejectProposal(
		proposalId: string,
		reason?: string,
		options?: { actor?: string },
	): Promise<ActionProposalResult> {
		if (!this.initialized) await this.initialize();
		return this.inbox.rejectProposal(proposalId, reason, options);
	}

	/**
	 * Get a proposal by ID.
	 */
	async getProposal(proposalId: string): Promise<Proposal | undefined> {
		if (!this.initialized) await this.initialize();
		return this.inbox.getProposal(proposalId);
	}

	/**
	 * List proposals with optional filters.
	 */
	async listProposals(filter?: {
		status?: "pending" | "approved" | "rejected";
		phase?: string;
		limit?: number;
		offset?: number;
	}): Promise<Proposal[]> {
		if (!this.initialized) await this.initialize();
		return this.inbox.listProposals(filter);
	}

	// =========================================================================
	// AC1: Remediation Plan Draft Generation
	// =========================================================================

	/**
	 * Generate a remediation plan draft from an approved proposal (AC1).
	 *
	 * Takes an approved proposal and generates a remediation-specific
	 * draft plan with remediation metadata. The draft is non-executable
	 * until both planning and execution gates pass.
	 *
	 * AC1: Only approved proposals can generate remediation plan drafts.
	 *
	 * @param proposalId - ID of an approved proposal
	 * @param options - Remediation options including type, source, and lead agent
	 * @returns Generation result with remediation draft plan metadata
	 */
	async generateRemediationDraft(
		proposalId: string,
		options: {
			/** The type of remediation */
			remediationType: RemediationType;
			/** Source that triggered the remediation */
			source: RemediationSource;
			/** Lead agent identifier */
			leadAgentId: string;
			/** Optional actor who requested the draft */
			actor?: string;
		},
	): Promise<GenerateRemediationDraftResult> {
		if (!this.initialized) await this.initialize();

		// Get the proposal (must exist)
		const proposal = await this.inbox.getProposal(proposalId);
		if (!proposal) {
			return { success: false, error: `Proposal "${proposalId}" not found.` };
		}

		// AC1: Must be approved to generate remediation draft
		if (proposal.status !== "approved") {
			return {
				success: false,
				error:
					`Cannot generate remediation draft from non-approved proposal (status: ${proposal.status}). ` +
					`Only approved proposals can produce remediation plan drafts.`,
			};
		}

		// Validate required fields
		if (!options.leadAgentId) {
			return { success: false, error: "leadAgentId is required to generate a remediation draft." };
		}
		if (!options.source || !options.source.kind || !options.source.description) {
			return { success: false, error: "source (with kind and description) is required." };
		}

		// Track pipeline stage
		const meta = this.pipelineMeta.get(proposalId) ?? this.createMeta(proposalId);
		this.advanceStage(meta, "remediation_drafting", "Generating remediation plan draft", options.actor);

		// Generate the draft plan via the DraftPlanner
		const draftResult = await this.inbox.produceDraftPlan(proposalId, options.leadAgentId);

		if (!draftResult.success || !draftResult.draftMeta || !draftResult.draftFilePath) {
			this.advanceStage(
				meta,
				"failed",
				`Draft generation failed: ${draftResult.error ?? "unknown error"}`,
				options.actor,
			);
			return {
				success: false,
				error: draftResult.error ?? "Failed to generate remediation draft plan.",
			};
		}

		// Build the remediation draft plan
		const remediationDraft: RemediationDraftPlan = {
			draftMeta: draftResult.draftMeta,
			remediationType: options.remediationType,
			source: options.source,
			planningApproved: false,
			executionApproved: false,
			filePath: draftResult.draftFilePath,
		};

		// Track the remediation draft
		this.remediationDrafts.set(remediationDraft.draftMeta.id, remediationDraft);

		// Advance pipeline stage
		this.advanceStage(
			meta,
			"remediation_draft_ready",
			`Remediation draft generated (type: ${options.remediationType}, source: ${options.source.kind})`,
			options.actor,
		);

		return {
			success: true,
			remediationDraft,
		};
	}

	/**
	 * Approve the remediation plan (Gate 1).
	 *
	 * Planning approval signifies that the remediation plan is sound and
	 * has been reviewed. This does NOT imply execution approval (AC2).
	 *
	 * AC2: Planning approval does not imply execution approval.
	 *
	 * Required state: remediation_draft_ready
	 *
	 * @param draftId - Remediation draft plan ID
	 * @param options - Optional parameters
	 * @returns Approval result
	 */
	async approvePlanning(
		draftId: string,
		options?: { actor?: string; reason?: string; proposalId?: string },
	): Promise<RemediationPlanApprovalResult> {
		return this.approveGate(draftId, "planning", options);
	}

	/**
	 * Approve execution of the remediation plan (Gate 2).
	 *
	 * Execution approval is a separate gate from planning approval (AC2).
	 * Planning must be approved first before execution can be approved.
	 *
	 * Required state: planning_approved
	 *
	 * @param draftId - Remediation draft plan ID
	 * @param options - Optional parameters
	 * @returns Approval result
	 */
	async approveExecution(
		draftId: string,
		options?: { actor?: string; reason?: string; proposalId?: string },
	): Promise<RemediationPlanApprovalResult> {
		return this.approveGate(draftId, "execution", options);
	}

	/**
	 * Internal gate approval logic.
	 *
	 * @param draftId - Draft ID
	 * @param gate - Which gate to approve ("planning" or "execution")
	 * @param options - Optional parameters
	 */
	private async approveGate(
		draftId: string,
		gate: "planning" | "execution",
		options?: { actor?: string; reason?: string; proposalId?: string },
	): Promise<RemediationPlanApprovalResult> {
		if (!this.initialized) await this.initialize();

		// Find the remediation draft
		const draft = this.remediationDrafts.get(draftId);
		if (!draft) {
			return { success: false, error: `Remediation draft "${draftId}" not found.` };
		}

		// Find the pipeline meta via the draft's proposal
		const proposalId = draft.draftMeta.proposalId;
		const meta = this.pipelineMeta.get(proposalId);
		if (!meta) {
			return { success: false, error: `Pipeline metadata not found for proposal "${proposalId}".` };
		}

		if (gate === "planning") {
			// AC2: Check that we're in the right stage for planning approval
			if (draft.planningApproved) {
				return { success: false, error: `Remediation draft "${draftId}" already has planning approval.` };
			}
			if (draft.executionApproved) {
				return {
					success: false,
					error: `Remediation draft "${draftId}" already has execution approval. Planning approval cannot be granted retroactively.`,
				};
			}

			// Grant planning approval
			draft.planningApproved = true;
			draft.planningApprovedAt = Date.now();

			this.advanceStage(meta, "planning_approved", options?.reason ?? "Planning approved", options?.actor);

			return {
				success: true,
				remediationDraft: { ...draft },
			};
		}

		if (gate === "execution") {
			// AC2: Execution approval requires planning approval first
			if (!draft.planningApproved) {
				return {
					success: false,
					error:
						`Cannot approve execution for remediation draft "${draftId}": ` +
						`planning approval (Gate 1) must be granted before execution approval (Gate 2). ` +
						`Planning approval does not imply execution approval, but execution requires planning approval first.`,
				};
			}
			if (draft.executionApproved) {
				return { success: false, error: `Remediation draft "${draftId}" already has execution approval.` };
			}

			// Grant execution approval
			draft.executionApproved = true;
			draft.executionApprovedAt = Date.now();

			this.advanceStage(meta, "execution_approved", options?.reason ?? "Execution approved", options?.actor);

			return {
				success: true,
				remediationDraft: { ...draft },
			};
		}

		return { success: false, error: `Unknown gate: ${gate}` };
	}

	/**
	 * Check whether a remediation draft is approved for execution.
	 *
	 * Both planning approval AND execution approval must be granted.
	 *
	 * @param draftId - Remediation draft plan ID
	 * @returns True if execution is approved
	 */
	isExecutionApproved(draftId: string): boolean {
		const draft = this.remediationDrafts.get(draftId);
		if (!draft) return false;
		return draft.planningApproved && draft.executionApproved;
	}

	/**
	 * Get the execution gate block reason, if execution is not approved.
	 *
	 * @param draftId - Remediation draft plan ID
	 * @returns Human-readable reason, or undefined if execution is approved
	 */
	getExecutionBlockReason(draftId: string): string | undefined {
		const draft = this.remediationDrafts.get(draftId);
		if (!draft) return "Remediation draft not found.";

		if (!draft.planningApproved && !draft.executionApproved) {
			return "Both Planning approval (Gate 1) and Execution approval (Gate 2) are required. Neither has been granted.";
		}
		if (!draft.planningApproved) {
			return "Planning approval (Gate 1) has not been granted. The remediation plan must be reviewed and approved first.";
		}
		if (!draft.executionApproved) {
			return "Execution approval (Gate 2) has not been granted. Planning approval is complete, but execution requires separate approval.";
		}
		return undefined;
	}

	// =========================================================================
	// AC2: Execution Gate Enforcement
	// =========================================================================

	/**
	 * Assert that a remediation draft is approved for execution.
	 *
	 * Throws with a descriptive error if either gate has not passed,
	 * making it impossible to silently bypass the execution gate (AC2).
	 *
	 * @param draftId - Remediation draft plan ID
	 * @throws Error if execution is not approved
	 */
	assertExecutionApproved(draftId: string): void {
		const blockReason = this.getExecutionBlockReason(draftId);
		if (blockReason) {
			throw new Error(
				`Remediation draft "${draftId}" cannot be executed. ${blockReason} ` +
					`Call approvePlanning() for Gate 1 and approveExecution() for Gate 2.`,
			);
		}
	}

	/**
	 * Check draft execution gates via DraftPlanner.
	 *
	 * Verifies both the planning/execution gates AND the draft gates
	 * (non-executability of drafts before promotion, lead agent checks).
	 *
	 * @param draftId - Remediation draft plan ID
	 * @param agentId - Agent requesting execution
	 * @returns Gate result
	 */
	async checkFullExecutionGate(draftId: string, agentId: string): Promise<DraftGateResult> {
		const draft = this.remediationDrafts.get(draftId);
		if (!draft) {
			return { allowed: false, reason: `Remediation draft "${draftId}" not found.` };
		}

		// AC2: Check planning + execution gates
		if (!this.isExecutionApproved(draftId)) {
			const blockReason = this.getExecutionBlockReason(draftId);
			return { allowed: false, reason: blockReason ?? "Execution not approved." };
		}

		// Check draft gates (isDraft flag, lead agent)
		const draftQueue = await this.draftPlanner.loadDraftPlan(draft.filePath);
		if (draftQueue) {
			const draftGateResult = checkDraftGates(draftQueue, agentId, "execute");
			if (!draftGateResult.allowed) {
				return draftGateResult;
			}
		}

		return { allowed: true };
	}

	// =========================================================================
	// AC3: Planner Optimization
	// =========================================================================

	/**
	 * Submit execution results to the planner feedback loop for
	 * optimization (AC3).
	 *
	 * Generated plans (post-execution) can be submitted to the planner
	 * optimization pipeline. The feedback loop analyzes outcomes and
	 * produces risk model updates and rebatching recommendations.
	 *
	 * AC3: Generated plans can be submitted to planner optimization.
	 *
	 * @param draftId - Remediation draft plan ID
	 * @param outcomes - Queue outcomes from executing the plan
	 * @param options - Optional parameters
	 * @returns Optimization submission result
	 */
	async submitToOptimization(
		draftId: string,
		outcomes: QueueOutcome[],
		options?: {
			actor?: string;
			plannerMemory?: unknown;
			memoryEntryId?: string;
		},
	): Promise<OptimizationSubmissionResult> {
		if (!this.initialized) await this.initialize();

		const draft = this.remediationDrafts.get(draftId);
		if (!draft) {
			return { success: false, error: `Remediation draft "${draftId}" not found.` };
		}

		if (!this.feedbackLoop) {
			return {
				success: false,
				error: "Planner feedback loop not configured. Pass a feedbackLoop instance in the pipeline config to enable optimization.",
			};
		}

		if (!outcomes || outcomes.length === 0) {
			return {
				success: false,
				error: "No queue outcomes provided. Execution results are required for optimization analysis.",
			};
		}

		// Store the execution outcomes on the draft
		draft.executionOutcome = outcomes;

		try {
			// Submit to the feedback loop
			const feedbackResult = await this.feedbackLoop.analyze(
				outcomes,
				options?.plannerMemory as any,
				options?.memoryEntryId,
			);

			// Store the optimization result
			draft.optimizationResult = feedbackResult;

			// Update pipeline stage
			const meta = this.pipelineMeta.get(draft.draftMeta.proposalId);
			if (meta) {
				this.advanceStage(
					meta,
					"optimization_submitted",
					`Results submitted to planner optimization: ${feedbackResult.summary.substring(0, 100)}`,
					options?.actor,
				);
			}

			return {
				success: true,
				feedbackResult,
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: `Optimization submission failed: ${errorMsg}`,
			};
		}
	}

	/**
	 * Get the optimization result for a remediation draft.
	 *
	 * @param draftId - Remediation draft plan ID
	 * @returns Optimization result, or undefined if not yet submitted
	 */
	getOptimizationResult(draftId: string): FeedbackLoopResult | undefined {
		const draft = this.remediationDrafts.get(draftId);
		return draft?.optimizationResult;
	}

	/**
	 * Check whether a remediation draft has been submitted to optimization.
	 *
	 * @param draftId - Remediation draft plan ID
	 * @returns True if submitted
	 */
	isSubmittedToOptimization(draftId: string): boolean {
		const draft = this.remediationDrafts.get(draftId);
		return draft?.optimizationResult !== undefined;
	}

	// =========================================================================
	// Pipeline Stage Tracking
	// =========================================================================

	/**
	 * Get the current pipeline stage for a proposal.
	 *
	 * @param proposalId - Proposal ID
	 * @returns Current stage, or undefined if proposal not tracked
	 */
	getPipelineStage(proposalId: string): PipelineStage | undefined {
		return this.pipelineMeta.get(proposalId)?.stage;
	}

	/**
	 * Get the full pipeline stage history for a proposal.
	 *
	 * @param proposalId - Proposal ID
	 * @returns Stage history, or undefined if proposal not tracked
	 */
	getPipelineStageHistory(proposalId: string): PipelineStageEntry[] | undefined {
		return this.pipelineMeta.get(proposalId)?.stageHistory;
	}

	/**
	 * Get a remediation draft by draft ID.
	 *
	 * @param draftId - Draft ID
	 * @returns Remediation draft, or undefined if not found
	 */
	getRemediationDraft(draftId: string): RemediationDraftPlan | undefined {
		return this.remediationDrafts.get(draftId);
	}

	/**
	 * List all remediation drafts for a proposal.
	 *
	 * @param proposalId - Proposal ID
	 * @returns Array of remediation drafts
	 */
	listRemediationDrafts(proposalId?: string): RemediationDraftPlan[] {
		const drafts = Array.from(this.remediationDrafts.values());
		if (proposalId) {
			return drafts.filter((d) => d.draftMeta.proposalId === proposalId);
		}
		return drafts;
	}

	/**
	 * Check if a proposal has been submitted to the pipeline.
	 *
	 * @param proposalId - Proposal ID
	 * @returns True if tracked
	 */
	hasProposal(proposalId: string): boolean {
		return this.pipelineMeta.has(proposalId) || this.inbox.getProposal(proposalId) !== undefined;
	}

	// =========================================================================
	// Formatting
	// =========================================================================

	/**
	 * Format a remediation draft plan as a human-readable string.
	 *
	 * @param draft - Remediation draft plan
	 * @returns Formatted string
	 */
	formatRemediationDraft(draft: RemediationDraftPlan): string {
		const lines: string[] = [];

		lines.push(`Remediation Draft: ${draft.draftMeta.id}`);
		lines.push(`Title:             ${draft.draftMeta.proposalTitle}`);
		lines.push(`Phase:             ${draft.draftMeta.phase}`);
		lines.push(`From Proposal:     ${draft.draftMeta.proposalId}`);
		lines.push(`Lead Agent:        ${draft.draftMeta.leadAgentId}`);
		lines.push(`Type:              ${draft.remediationType}`);
		lines.push(`Source:            ${draft.source.kind} — ${draft.source.description}`);
		lines.push(`File:              ${draft.filePath}`);
		lines.push(`Generated:         ${new Date(draft.draftMeta.generatedAt).toISOString()}`);
		lines.push("");

		// Approval status
		lines.push("Approval Status:");
		lines.push(
			`  Planning (Gate 1): ${draft.planningApproved ? "APPROVED" : "PENDING"}${draft.planningApprovedAt ? ` at ${new Date(draft.planningApprovedAt).toISOString()}` : ""}`,
		);
		lines.push(
			`  Execution (Gate 2): ${draft.executionApproved ? "APPROVED" : "PENDING"}${draft.executionApprovedAt ? ` at ${new Date(draft.executionApprovedAt).toISOString()}` : ""}`,
		);

		// Execution outcomes
		if (draft.executionOutcome && draft.executionOutcome.length > 0) {
			const merged = draft.executionOutcome.filter((o) => o.status === "merged").length;
			const failed = draft.executionOutcome.filter((o) => o.status === "failed" || o.status === "blocked").length;
			const conflicts = draft.executionOutcome.filter((o) => o.status === "conflict").length;
			lines.push("");
			lines.push("Execution Results:");
			lines.push(`  Total outcomes:   ${draft.executionOutcome.length}`);
			lines.push(`  Merged:           ${merged}`);
			lines.push(`  Failed/Blocked:   ${failed}`);
			lines.push(`  Conflicts:        ${conflicts}`);
		}

		// Optimization results
		if (draft.optimizationResult) {
			lines.push("");
			lines.push("Optimization:");
			lines.push(`  Risk updates:     ${draft.optimizationResult.riskModelUpdates.length}`);
			lines.push(`  Recommendations:  ${draft.optimizationResult.rebatchingRecommendations.length}`);
		}

		return lines.join("\n");
	}

	/**
	 * Format a pipeline stage as a human-readable string.
	 *
	 * @param stage - Pipeline stage
	 * @returns Human-readable label
	 */
	formatPipelineStage(stage: PipelineStage): string {
		return PIPELINE_STAGE_LABELS[stage] ?? stage;
	}

	// =========================================================================
	// Internals
	// =========================================================================

	/**
	 * Create pipeline metadata for a proposal.
	 */
	private createMeta(proposalId: string): PipelineMeta {
		const meta: PipelineMeta = {
			proposalId,
			stage: "proposal_submitted",
			stageHistory: [],
		};
		this.pipelineMeta.set(proposalId, meta);
		return meta;
	}

	/**
	 * Advance the pipeline stage for a proposal.
	 */
	private advanceStage(meta: PipelineMeta, stage: PipelineStage, reason: string, actor?: string): void {
		meta.stage = stage;
		meta.stageHistory.push({
			stage,
			timestamp: Date.now(),
			reason,
			actor,
		});
	}
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/**
 * Pipeline metadata tracked per proposal.
 */
interface PipelineMeta {
	proposalId: string;
	stage: PipelineStage;
	stageHistory: PipelineStageEntry[];
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Format a pipeline stage entry as a human-readable string.
 *
 * @param entry - Stage entry
 * @returns Formatted string
 */
export function formatPipelineStageEntry(entry: PipelineStageEntry): string {
	const dateStr = new Date(entry.timestamp).toISOString();
	const actorStr = entry.actor ? ` by ${entry.actor}` : "";
	return `[${dateStr}] ${entry.stage}${actorStr} — ${entry.reason}`;
}

/**
 * Format a pipeline stage history as a human-readable list.
 *
 * @param entries - Stage history entries
 * @returns Formatted string
 */
export function formatPipelineStageHistory(entries: PipelineStageEntry[]): string {
	if (entries.length === 0) return "No pipeline stage history.";
	return entries.map(formatPipelineStageEntry).join("\n");
}

/**
 * Create a ProposalExecutionPipeline instance.
 *
 * @param config - Pipeline configuration
 * @returns ProposalExecutionPipeline instance
 */
export function createProposalExecutionPipeline(config: ProposalExecutionPipelineConfig): ProposalExecutionPipeline {
	return new ProposalExecutionPipeline(config);
}
