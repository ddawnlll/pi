/**
 * Proposal Inbox - P8.B / P8.E
 *
 * Manages the lifecycle of plan proposals from submission through
 * approval/rejection to execution. Proposals capture a plan's workspace
 * queue and planner output as evidence. No proposal can become an
 * execution plan without explicit approval.
 *
 * P8.E Integration:
 * - Approved proposals can produce draft plans via produceDraftPlan().
 * - Draft plans remain non-executable until normal plan approval gates pass.
 *
 * Acceptance Criteria:
 * 1. Proposal inbox persists proposal state and evidence.
 * 2. Approvals and rejections are auditable.
 * 3. No proposal becomes an execution plan without approval.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ConfidenceLevel, DetectionOutput, DetectionResult, RiskLevel } from "./detection-types.js";
import { DraftPlanner, type GenerateDraftPlanResult } from "./draft-planner.js";
import type { PlannerOutput } from "./planner.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The status of a proposal in the inbox.
 */
export type ProposalStatus = "pending" | "approved" | "rejected";

/**
 * An action recorded in the proposal audit trail.
 */
export interface ProposalAuditEntry {
	/** Timestamp of the action */
	timestamp: number;
	/** The action performed */
	action: "submitted" | "approved" | "rejected";
	/** Who performed the action (user or system identifier) */
	actor: string;
	/** Optional reason or comment */
	reason?: string;
	/** Snapshot of proposal status after this action */
	resultingStatus: ProposalStatus;
}

/**
 * Evidence bundle captured at proposal submission time.
 *
 * Contains the planner output, workspace queue, optimization proposals,
 * and P8.D detection/analysis results so that reviewers can make informed
 * decisions. Each proposal includes risk, confidence, evidence items,
 * and requiresApproval (P8.D AC1).
 */
export interface ProposalEvidence {
	/** Planner output with batch plan, critical path, warnings, suggestions */
	plannerOutput: PlannerOutput;
	/** The parsed workspace queue that was submitted */
	queue: WorkspaceQueue;
	/** Optimization proposals from the DAG optimizer (if any) */
	optimizationProposals?: Array<{
		id: string;
		kind: string;
		description: string;
		approvalStatus: string;
		evidence: Record<string, unknown>;
	}>;
	/**
	 * P8.D detection findings (bug candidates, performance issues, etc.).
	 * Each detection includes risk, confidence, evidence, and requiresApproval.
	 */
	detections?: DetectionResult[];
	/**
	 * P8.D detection output summary including false-positive tracking
	 * and unsafe suggestion information.
	 */
	detectionOutput?: DetectionOutput;
	/**
	 * Overall risk level for this proposal (aggregated from detections
	 * or manually assigned).
	 */
	overallRisk?: RiskLevel;
	/**
	 * Overall confidence level for this proposal.
	 */
	overallConfidence?: ConfidenceLevel;
}

/**
 * A plan proposal in the inbox.
 *
 * Represents a plan that has been submitted for review but has not
 * yet been approved for execution. Once approved, the proposal can
 * be converted to an execution plan. Until then, execution is blocked.
 */
export interface Proposal {
	/** Unique proposal identifier */
	id: string;
	/** Human-readable title */
	title: string;
	/** Phase identifier (e.g., "P2") */
	phase: string;
	/** Current approval status */
	status: ProposalStatus;
	/** Evidence bundle captured at submission */
	evidence: ProposalEvidence;
	/** Audit trail of all actions on this proposal */
	auditTrail: ProposalAuditEntry[];
	/** Timestamp when the proposal was submitted */
	submittedAt: number;
	/** Timestamp when the proposal was last actioned (approved/rejected) */
	actionedAt?: number;
	/** Rejection reason (only set when status === "rejected") */
	rejectionReason?: string;
	/** Optional metadata for extensibility */
	metadata?: Record<string, unknown>;
}

/**
 * Filter options for listing proposals.
 */
export interface ProposalFilter {
	/** Filter by status */
	status?: ProposalStatus;
	/** Filter by phase */
	phase?: string;
	/** Maximum results (default: 50) */
	limit?: number;
	/** Pagination offset (default: 0) */
	offset?: number;
}

/**
 * Result of submitting a proposal.
 */
export interface SubmitProposalResult {
	/** Whether submission succeeded */
	success: boolean;
	/** The created proposal (if successful) */
	proposal?: Proposal;
	/** Error message (if failed) */
	error?: string;
}

/**
 * Result of an approval or rejection action.
 */
export interface ActionProposalResult {
	/** Whether the action succeeded */
	success: boolean;
	/** The updated proposal (if successful) */
	proposal?: Proposal;
	/** Error message (if failed) */
	error?: string;
}

// ---------------------------------------------------------------------------
// Proposal Inbox
// ---------------------------------------------------------------------------

/**
 * Proposal Inbox — manages the lifecycle of plan proposals.
 *
 * Provides persistence, audit trail, and approval gating so that
 * no proposal becomes an execution plan without explicit approval.
 *
 * Supports file-based persistence (legacy/standalone) and can be
 * extended with a DB-backed implementation via the repository interface.
 */
export class ProposalInbox {
	/** Proposals keyed by ID (in-memory cache) */
	private proposals: Map<string, Proposal> = new Map();
	/** Directory for file-based persistence */
	private proposalsDir: string;
	/** Path to the proposals index file */
	private indexFilePath: string;
	/** Whether the inbox has been initialized */
	private initialized = false;
	/** Draft planner for producing draft plans from approved proposals (P8.E) */
	private draftPlanner: DraftPlanner;

	/**
	 * @param workspaceRoot - Workspace root directory
	 * @param piDir - .pi directory name (default: ".pi")
	 */
	constructor(workspaceRoot: string, piDir = ".pi") {
		this.proposalsDir = path.join(workspaceRoot, piDir, "proposals");
		this.indexFilePath = path.join(this.proposalsDir, "index.json");
		this.draftPlanner = new DraftPlanner({ workspaceRoot, piDir });
	}

	/**
	 * Initialize the proposal inbox.
	 *
	 * Loads existing proposals from disk. Must be called before
	 * any other operations.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		await fs.mkdir(this.proposalsDir, { recursive: true });

		try {
			const indexContent = await fs.readFile(this.indexFilePath, "utf-8");
			const parsed = JSON.parse(indexContent);

			if (Array.isArray(parsed.proposals)) {
				for (const proposal of parsed.proposals) {
					this.proposals.set(proposal.id, proposal as Proposal);
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// No index file yet — first use
				await this.saveIndex();
			} else {
				throw error;
			}
		}

		this.initialized = true;
	}

	/**
	 * Persist the index to disk.
	 */
	private async saveIndex(): Promise<void> {
		const serializable = {
			updatedAt: Date.now(),
			proposals: Array.from(this.proposals.values()),
		};

		const tempPath = `${this.indexFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		await fs.writeFile(tempPath, JSON.stringify(serializable, null, 2), "utf-8");
		await fs.rename(tempPath, this.indexFilePath);
	}

	// =========================================================================
	// CRUD Operations
	// =========================================================================

	/**
	 * Submit a new proposal to the inbox.
	 *
	 * Captures the workspace queue and planner output as evidence.
	 * The proposal starts in "pending" status and must be explicitly
	 * approved before it can become an execution plan.
	 *
	 * @param title - Human-readable title for the proposal
	 * @param phase - Phase identifier
	 * @param queue - The workspace queue being proposed
	 * @param plannerOutput - Planner output with analysis evidence
	 * @param options - Optional parameters
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
			/** P8.D detection findings attached to this proposal */
			detections?: DetectionResult[];
			/** P8.D detection output with full analysis summary */
			detectionOutput?: DetectionOutput;
			/** Overall risk level for the proposal */
			overallRisk?: RiskLevel;
			/** Overall confidence level for the proposal */
			overallConfidence?: ConfidenceLevel;
			metadata?: Record<string, unknown>;
		},
	): Promise<SubmitProposalResult> {
		if (!this.initialized) {
			await this.initialize();
		}

		// Validate required fields
		if (!title || !phase || !queue || !plannerOutput) {
			return {
				success: false,
				error: "Missing required fields: title, phase, queue, and plannerOutput are required",
			};
		}

		// Generate a unique proposal ID
		const id = this.generateProposalId();

		const now = Date.now();
		const actor = options?.actor ?? "system";

		const evidence: ProposalEvidence = {
			plannerOutput,
			queue,
			optimizationProposals: options?.optimizationProposals,
			detections: options?.detections,
			detectionOutput: options?.detectionOutput,
			overallRisk: options?.overallRisk,
			overallConfidence: options?.overallConfidence,
		};

		const proposal: Proposal = {
			id,
			title,
			phase,
			status: "pending",
			evidence,
			auditTrail: [
				{
					timestamp: now,
					action: "submitted",
					actor,
					resultingStatus: "pending",
				},
			],
			submittedAt: now,
			metadata: options?.metadata,
		};

		this.proposals.set(id, proposal);
		await this.saveIndex();

		return { success: true, proposal };
	}

	/**
	 * Approve a pending proposal.
	 *
	 * Marks the proposal as "approved" and records the action
	 * in the audit trail. Only pending proposals can be approved.
	 *
	 * @param proposalId - ID of the proposal to approve
	 * @param options - Optional parameters
	 * @returns Action result
	 */
	async approveProposal(
		proposalId: string,
		options?: {
			actor?: string;
			reason?: string;
		},
	): Promise<ActionProposalResult> {
		if (!this.initialized) {
			await this.initialize();
		}

		const proposal = this.proposals.get(proposalId);
		if (!proposal) {
			return { success: false, error: `Proposal "${proposalId}" not found` };
		}

		if (proposal.status === "approved") {
			return { success: false, error: `Proposal "${proposalId}" is already approved` };
		}

		if (proposal.status === "rejected") {
			return { success: false, error: `Proposal "${proposalId}" was rejected and cannot be approved` };
		}

		const now = Date.now();
		const actor = options?.actor ?? "system";

		proposal.status = "approved";
		proposal.actionedAt = now;
		proposal.rejectionReason = undefined;
		proposal.auditTrail.push({
			timestamp: now,
			action: "approved",
			actor,
			reason: options?.reason,
			resultingStatus: "approved",
		});

		await this.saveIndex();

		return { success: true, proposal };
	}

	/**
	 * Reject a pending proposal.
	 *
	 * Marks the proposal as "rejected" with an optional reason.
	 * The rejection and reason are recorded in the audit trail.
	 * Only pending proposals can be rejected.
	 *
	 * @param proposalId - ID of the proposal to reject
	 * @param reason - Reason for rejection (recommended for audit trail)
	 * @param options - Optional parameters
	 * @returns Action result
	 */
	async rejectProposal(
		proposalId: string,
		reason?: string,
		options?: {
			actor?: string;
		},
	): Promise<ActionProposalResult> {
		if (!this.initialized) {
			await this.initialize();
		}

		const proposal = this.proposals.get(proposalId);
		if (!proposal) {
			return { success: false, error: `Proposal "${proposalId}" not found` };
		}

		if (proposal.status === "rejected") {
			return { success: false, error: `Proposal "${proposalId}" is already rejected` };
		}

		if (proposal.status === "approved") {
			return { success: false, error: `Proposal "${proposalId}" was already approved and cannot be rejected` };
		}

		const now = Date.now();
		const actor = options?.actor ?? "system";

		proposal.status = "rejected";
		proposal.actionedAt = now;
		proposal.rejectionReason = reason;
		proposal.auditTrail.push({
			timestamp: now,
			action: "rejected",
			actor,
			reason,
			resultingStatus: "rejected",
		});

		await this.saveIndex();

		return { success: true, proposal };
	}

	/**
	 * Get a proposal by ID.
	 *
	 * @param proposalId - Proposal ID
	 * @returns The proposal, or undefined if not found
	 */
	async getProposal(proposalId: string): Promise<Proposal | undefined> {
		if (!this.initialized) {
			await this.initialize();
		}

		return this.proposals.get(proposalId);
	}

	/**
	 * List proposals in the inbox with optional filters.
	 *
	 * @param filter - Optional filter criteria
	 * @returns Array of matching proposals, newest first
	 */
	async listProposals(filter?: ProposalFilter): Promise<Proposal[]> {
		if (!this.initialized) {
			await this.initialize();
		}

		let results = Array.from(this.proposals.values());

		// Apply status filter
		if (filter?.status) {
			results = results.filter((p) => p.status === filter.status);
		}

		// Apply phase filter
		if (filter?.phase) {
			results = results.filter((p) => p.phase === filter.phase);
		}

		// Sort by submission time, newest first
		results.sort((a, b) => b.submittedAt - a.submittedAt);

		// Apply pagination
		const offset = filter?.offset ?? 0;
		const limit = filter?.limit ?? 50;
		results = results.slice(offset, offset + limit);

		return results;
	}

	/**
	 * Check if a proposal is approved and ready for execution.
	 *
	 * This is the gate that prevents unapproved proposals from
	 * becoming execution plans. (AC3)
	 *
	 * @param proposalId - Proposal ID
	 * @returns True if the proposal is approved
	 */
	async isProposalApproved(proposalId: string): Promise<boolean> {
		const proposal = await this.getProposal(proposalId);
		return proposal?.status === "approved";
	}

	/**
	 * Get the audit trail for a proposal.
	 *
	 * Returns the full history of submissions, approvals, and
	 * rejections for auditability. (AC2)
	 *
	 * @param proposalId - Proposal ID
	 * @returns Array of audit entries, or undefined if proposal not found
	 */
	async getProposalAuditTrail(proposalId: string): Promise<ProposalAuditEntry[] | undefined> {
		const proposal = await this.getProposal(proposalId);
		return proposal?.auditTrail;
	}

	/**
	 * Delete a proposal from the inbox.
	 *
	 * @param proposalId - Proposal ID
	 * @returns True if deleted
	 */
	async deleteProposal(proposalId: string): Promise<boolean> {
		if (!this.initialized) {
			await this.initialize();
		}

		const existed = this.proposals.has(proposalId);
		if (!existed) return false;

		this.proposals.delete(proposalId);
		await this.saveIndex();

		return true;
	}

	// =========================================================================
	// P8.E: Draft Plan Production
	// =========================================================================

	/**
	 * Produce a draft plan from an approved proposal (P8.E).
	 *
	 * Takes the approved proposal and generates a draft plan file with
	 * isDraft=true and leadAgentId set. The draft is non-executable until
	 * it passes normal plan approval gates.
	 *
	 * AC1: Only approved proposals can produce draft plans.
	 * AC2: Draft plans remain non-executable until gates pass.
	 * AC3: Lead agent is recorded to prevent self-enqueue/execution.
	 *
	 * @param proposalId - ID of an approved proposal
	 * @param leadAgentId - Identifier of the lead agent that created the proposal
	 * @returns Draft plan generation result
	 */
	async produceDraftPlan(proposalId: string, leadAgentId: string): Promise<GenerateDraftPlanResult> {
		if (!this.initialized) {
			await this.initialize();
		}

		const proposal = this.proposals.get(proposalId);
		if (!proposal) {
			return {
				success: false,
				error: `Proposal "${proposalId}" not found.`,
			};
		}

		return this.draftPlanner.generateDraftPlan(proposal, leadAgentId);
	}

	/**
	 * Get the DraftPlanner instance for direct draft management.
	 *
	 * Provides access to draft listing, deletion, and gate checking.
	 *
	 * @returns The DraftPlanner instance
	 */
	getDraftPlanner(): DraftPlanner {
		return this.draftPlanner;
	}

	/**
	 * Get the count of proposals matching optional filters.
	 *
	 * @param filter - Optional filter criteria
	 * @returns Count of matching proposals
	 */
	async countProposals(filter?: { status?: ProposalStatus; phase?: string }): Promise<number> {
		if (!this.initialized) {
			await this.initialize();
		}

		let count = 0;
		for (const proposal of this.proposals.values()) {
			if (filter?.status && proposal.status !== filter.status) continue;
			if (filter?.phase && proposal.phase !== filter.phase) continue;
			count++;
		}

		return count;
	}

	// =========================================================================
	// Execution Gate (AC3)
	// =========================================================================

	/**
	 * Check whether a proposal is allowed to become an execution plan.
	 *
	 * This is the enforcement point for AC3: only approved proposals
	 * may proceed to execution. Throws or returns false for any
	 * proposal that is not in "approved" status.
	 *
	 * @param proposalId - Proposal ID
	 * @returns True if the proposal can be executed
	 */
	async mayExecute(proposalId: string): Promise<boolean> {
		const proposal = await this.getProposal(proposalId);
		if (!proposal) return false;
		return proposal.status === "approved";
	}

	/**
	 * Assert that a proposal is approved and ready for execution.
	 *
	 * Throws with a descriptive error if the proposal is not
	 * approved, making it impossible to silently bypass the gate.
	 *
	 * @param proposalId - Proposal ID
	 * @throws Error if the proposal is not approved
	 */
	async assertMayExecute(proposalId: string): Promise<void> {
		const proposal = await this.getProposal(proposalId);
		if (!proposal) {
			throw new Error(
				`Proposal "${proposalId}" not found. Cannot execute a plan that has not been submitted as a proposal.`,
			);
		}

		if (proposal.status !== "approved") {
			const statusMsg =
				proposal.status === "rejected"
					? `was rejected${proposal.rejectionReason ? `: ${proposal.rejectionReason}` : ""}`
					: "is still pending review";
			throw new Error(
				`Proposal "${proposalId}" ${statusMsg}. ` +
					`Only approved proposals may become execution plans. ` +
					`Use approveProposal() to approve this proposal first.`,
			);
		}
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	/**
	 * Generate a unique proposal ID.
	 */
	private generateProposalId(): string {
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).slice(2, 8);
		return `prop-${timestamp}-${random}`;
	}
}

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

/**
 * Format a proposal as a human-readable string.
 *
 * @param proposal - Proposal to format
 * @returns Formatted string
 */
export function formatProposal(proposal: Proposal): string {
	const lines: string[] = [];

	lines.push(`Proposal: ${proposal.id}`);
	lines.push(`Title:    ${proposal.title}`);
	lines.push(`Phase:    ${proposal.phase}`);
	lines.push(`Status:   ${proposal.status}`);
	lines.push(`Submitted: ${new Date(proposal.submittedAt).toISOString()}`);
	if (proposal.actionedAt) {
		lines.push(`Actioned:  ${new Date(proposal.actionedAt).toISOString()}`);
	}
	if (proposal.rejectionReason) {
		lines.push(`Reason:    ${proposal.rejectionReason}`);
	}

	// Evidence summary
	const evidence = proposal.evidence;
	lines.push("");
	lines.push("Evidence:");
	lines.push(`  Workspaces:         ${evidence.queue.workspaces.length}`);
	lines.push(
		`  Parallelism:        ${evidence.plannerOutput.predictedParallelism.effective} / ${evidence.plannerOutput.predictedParallelism.requested}`,
	);
	lines.push(`  Batches:            ${evidence.plannerOutput.predictedParallelism.totalBatches}`);
	lines.push(`  Critical path:      ${evidence.plannerOutput.criticalPath.length} batch(es)`);
	lines.push(`  Warnings:           ${evidence.plannerOutput.plannerWarnings.length}`);
	lines.push(`  Suggestions:        ${evidence.plannerOutput.plannerSuggestions.length}`);
	lines.push(`  Plan success:       ${evidence.plannerOutput.success}`);

	if (evidence.optimizationProposals && evidence.optimizationProposals.length > 0) {
		lines.push(`  Optimization props: ${evidence.optimizationProposals.length}`);
	}

	// P8.D detection analysis (if available)
	if (evidence.detections && evidence.detections.length > 0) {
		lines.push(`  Detections:         ${evidence.detections.length}`);
		const byCategory = new Map<string, number>();
		for (const d of evidence.detections) {
			byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + 1);
		}
		for (const [cat, count] of byCategory) {
			lines.push(`    ${cat}: ${count}`);
		}
		const unsafeCount = evidence.detections.filter((d) => d.isUnsafe).length;
		const fpCount = evidence.detections.filter((d) => d.isFalsePositive).length;
		if (unsafeCount > 0) lines.push(`  Unsafe:             ${unsafeCount}`);
		if (fpCount > 0) lines.push(`  False positives:    ${fpCount}`);
	}

	if (evidence.overallRisk) {
		lines.push(`  Overall risk:       ${evidence.overallRisk}`);
	}
	if (evidence.overallConfidence) {
		lines.push(`  Overall confidence: ${evidence.overallConfidence}`);
	}

	// Audit trail
	lines.push("");
	lines.push("Audit Trail:");
	for (const entry of proposal.auditTrail) {
		const dateStr = new Date(entry.timestamp).toISOString();
		const reasonStr = entry.reason ? ` — ${entry.reason}` : "";
		lines.push(`  [${dateStr}] ${entry.action} by ${entry.actor}${reasonStr}`);
	}

	return lines.join("\n");
}

/**
 * Format a list of proposals as a table-like string.
 *
 * @param proposals - Proposals to format
 * @returns Formatted string
 */
export function formatProposalList(proposals: Proposal[]): string {
	if (proposals.length === 0) {
		return "No proposals found.";
	}

	const lines: string[] = [];
	lines.push(`${"ID".padEnd(30)} ${"Title".padEnd(30)} ${"Phase".padEnd(8)} ${"Status".padEnd(10)} Submitted`);
	lines.push("─".repeat(90));

	for (const proposal of proposals) {
		const id = proposal.id.padEnd(30);
		const title = proposal.title.slice(0, 28).padEnd(30);
		const phase = proposal.phase.padEnd(8);
		const status = proposal.status.padEnd(10);
		const date = new Date(proposal.submittedAt).toISOString().slice(0, 19).replace("T", " ");
		lines.push(`${id} ${title} ${phase} ${status} ${date}`);
	}

	return lines.join("\n");
}
