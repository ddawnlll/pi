/**
 * Draft Planner - P8.E
 *
 * Semi-autonomous plan drafting from approved proposals.
 *
 * When a proposal is approved, it can produce a "draft plan" — a plan file
 * that is marked as non-executable. Draft plans remain non-executable until
 * they pass normal plan approval gates. The lead agent that created the
 * proposal/draft cannot enqueue or execute its own drafts.
 *
 * Acceptance Criteria:
 * 1. Approved proposals can produce draft plans.
 * 2. Draft plans remain non-executable until normal plan approval gates pass.
 * 3. Lead agent cannot enqueue or execute its own drafts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Proposal } from "./proposal-inbox.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata for a draft plan.
 *
 * Captures the provenance of a draft so that gates and lead-agent
 * restrictions can be enforced.
 */
export interface DraftPlanMeta {
	/** Unique draft identifier */
	id: string;
	/** The proposal ID from which this draft was generated */
	proposalId: string;
	/** Original proposal title */
	proposalTitle: string;
	/** Phase identifier */
	phase: string;
	/** Agent ID of the lead agent that created the draft */
	leadAgentId: string;
	/** Timestamp when the draft was generated */
	generatedAt: number;
	/** Whether the draft has passed normal plan approval gates */
	gatesPassed: boolean;
}

/**
 * Result of generating a draft plan from a proposal.
 */
export interface GenerateDraftPlanResult {
	/** Whether draft generation succeeded */
	success: boolean;
	/** The generated draft plan metadata (if successful) */
	draftMeta?: DraftPlanMeta;
	/** Path to the generated draft plan file (if successful) */
	draftFilePath?: string;
	/** Error message (if failed) */
	error?: string;
}

/**
 * Result of checking whether a draft plan can be enqueued.
 */
export interface DraftGateResult {
	/** Whether the enqueue/execute operation is allowed */
	allowed: boolean;
	/** Human-readable reason (if blocked) */
	reason?: string;
}

/**
 * Configuration for the draft planner.
 */
export interface DraftPlannerConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** .pi directory name (default: ".pi") */
	piDir?: string;
	/** Directory for draft plan files (default: "<piDir>/drafts") */
	draftsDir?: string;
}

// ---------------------------------------------------------------------------
// Draft Planner
// ---------------------------------------------------------------------------

/**
 * Draft Planner — converts approved proposals into draft plans and
 * enforces the P8.E gates.
 *
 * Draft plans are valid workspace queues with isDraft=true and leadAgentId
 * set. They cannot be executed until isDraft is explicitly cleared (which
 * requires normal plan approval gates to pass). The lead agent that created
 * the draft cannot enqueue or execute it.
 */
export class DraftPlanner {
	private workspaceRoot: string;
	private piDir: string;
	private draftsDir: string;

	/**
	 * @param config - Draft planner configuration
	 */
	constructor(config: DraftPlannerConfig) {
		this.workspaceRoot = config.workspaceRoot;
		this.piDir = config.piDir ?? ".pi";
		this.draftsDir = config.draftsDir ?? path.join(this.workspaceRoot, this.piDir, "drafts");
	}

	/**
	 * Generate a draft plan from an approved proposal.
	 *
	 * Takes the workspace queue and planner output from the approved proposal
	 * and produces a draft plan file with isDraft=true and the lead agent
	 * identifier. The draft is non-executable until the draft flag is cleared.
	 *
	 * @param proposal - An approved proposal (must have status === "approved")
	 * @param leadAgentId - Identifier of the lead agent that created the proposal
	 * @returns Generation result with draft metadata and file path
	 */
	async generateDraftPlan(proposal: Proposal, leadAgentId: string): Promise<GenerateDraftPlanResult> {
		// Validate proposal is approved (AC1: only approved proposals produce drafts)
		if (proposal.status !== "approved") {
			return {
				success: false,
				error: `Cannot generate draft plan from non-approved proposal (status: ${proposal.status}). Only approved proposals can produce draft plans.`,
			};
		}

		// Validate lead agent ID
		if (!leadAgentId) {
			return {
				success: false,
				error: "leadAgentId is required to generate a draft plan.",
			};
		}

		// Create the draft queue — a copy of the proposal's queue with draft flags
		const draftQueue: WorkspaceQueue = {
			...proposal.evidence.queue,
			isDraft: true,
			leadAgentId,
		};

		// Generate a unique draft ID
		const draftId = this.generateDraftId();
		const timestamp = Date.now();

		// Build the draft plan file content
		// The file contains both the workspace queue JSON and metadata header
		const draftContent = this.buildDraftFileContent(draftId, proposal, leadAgentId, timestamp, draftQueue);

		// Ensure drafts directory exists
		await fs.mkdir(this.draftsDir, { recursive: true });

		// Write the draft plan file
		const fileName = `${draftId}.json`;
		const filePath = path.join(this.draftsDir, fileName);

		const tempPath = `${filePath}.tmp.${timestamp}.${Math.random().toString(36).slice(2, 8)}`;
		await fs.writeFile(tempPath, draftContent, "utf-8");
		await fs.rename(tempPath, filePath);

		// Build draft metadata
		const draftMeta: DraftPlanMeta = {
			id: draftId,
			proposalId: proposal.id,
			proposalTitle: proposal.title,
			phase: proposal.phase,
			leadAgentId,
			generatedAt: timestamp,
			gatesPassed: false,
		};

		return {
			success: true,
			draftMeta,
			draftFilePath: filePath,
		};
	}

	/**
	 * Check whether a draft plan can be enqueued by a given agent.
	 *
	 * AC3: The lead agent cannot enqueue its own draft. Only a different
	 * agent (or the user) can enqueue a draft.
	 *
	 * @param draftQueue - The workspace queue (must have isDraft=true)
	 * @param agentId - The agent requesting to enqueue/execute
	 * @returns Gate result with allowed flag and reason
	 */
	checkEnqueueGate(draftQueue: WorkspaceQueue, agentId: string): DraftGateResult {
		if (!draftQueue.isDraft) {
			// Not a draft — normal gates apply
			return { allowed: true };
		}

		if (draftQueue.leadAgentId && draftQueue.leadAgentId === agentId) {
			return {
				allowed: false,
				reason: `Lead agent "${agentId}" cannot enqueue its own draft plan "${draftQueue.title}". Another agent or an explicit user approval is required to enqueue this draft.`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Check whether a draft plan is ready for execution.
	 *
	 * AC2: Draft plans remain non-executable until they pass normal plan
	 * approval gates. This means isDraft must be set to false (or gatesPassed
	 * must be true) before the plan can execute.
	 *
	 * @param draftQueue - The workspace queue to check
	 * @returns Gate result with allowed flag and reason
	 */
	checkExecutionGate(draftQueue: WorkspaceQueue): DraftGateResult {
		if (!draftQueue.isDraft) {
			// Not a draft — normal gates apply
			return { allowed: true };
		}

		return {
			allowed: false,
			reason: `Draft plan "${draftQueue.title}" (phase: ${draftQueue.phase}) is non-executable. Draft plans must pass normal plan approval gates before execution. Clear the "isDraft" flag to make this plan executable.`,
		};
	}

	/**
	 * Promote a draft plan to an executable plan.
	 *
	 * Clears the isDraft flag, which allows the plan to pass the execution gate.
	 * This represents the "normal plan approval gates" passing for the draft.
	 *
	 * Note: This modifies the queue object in-memory. Callers should persist
	 * it to disk if needed.
	 *
	 * @param draftQueue - The workspace queue to promote
	 * @returns The promoted queue (same reference, modified in-place)
	 */
	promoteDraftToPlan(draftQueue: WorkspaceQueue): WorkspaceQueue {
		draftQueue.isDraft = false;
		// Keep leadAgentId for audit trail but it won't block execution anymore
		return draftQueue;
	}

	/**
	 * Load a draft plan file and return the workspace queue.
	 *
	 * @param draftFilePath - Path to the draft plan file
	 * @returns The parsed workspace queue, or null if loading fails
	 */
	async loadDraftPlan(draftFilePath: string): Promise<WorkspaceQueue | null> {
		try {
			const content = await fs.readFile(draftFilePath, "utf-8");
			const parsed = JSON.parse(content);

			// Try to extract the embedded queue from the draft file format
			if (parsed.draftMeta && parsed.queue) {
				return parsed.queue as WorkspaceQueue;
			}

			// Fallback: the file itself might be the queue
			return parsed as WorkspaceQueue;
		} catch {
			return null;
		}
	}

	/**
	 * List all draft plan files in the drafts directory.
	 *
	 * @returns Array of draft metadata objects
	 */
	async listDraftPlans(): Promise<DraftPlanMeta[]> {
		await fs.mkdir(this.draftsDir, { recursive: true });

		const drafts: DraftPlanMeta[] = [];

		try {
			const files = await fs.readdir(this.draftsDir);

			for (const file of files) {
				if (!file.endsWith(".json")) continue;

				const filePath = path.join(this.draftsDir, file);
				try {
					const content = await fs.readFile(filePath, "utf-8");
					const parsed = JSON.parse(content);

					if (parsed.draftMeta) {
						drafts.push(parsed.draftMeta as DraftPlanMeta);
					}
				} catch {}
			}
		} catch {
			// Directory doesn't exist or can't be read
			return [];
		}

		// Sort newest first
		drafts.sort((a, b) => b.generatedAt - a.generatedAt);

		return drafts;
	}

	/**
	 * Delete a draft plan file.
	 *
	 * @param draftId - Draft plan ID
	 * @returns True if deleted
	 */
	async deleteDraftPlan(draftId: string): Promise<boolean> {
		const filePath = path.join(this.draftsDir, `${draftId}.json`);
		try {
			await fs.unlink(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get the drafts directory path.
	 *
	 * @returns Drafts directory path
	 */
	getDraftsDir(): string {
		return this.draftsDir;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Build the content of a draft plan file.
	 *
	 * The file format is a JSON object with:
	 * - draftMeta: DraftPlanMeta (metadata for gate enforcement)
	 * - queue: WorkspaceQueue (the actual plan)
	 * - generatedFrom: { proposalId, proposalTitle }
	 */
	private buildDraftFileContent(
		draftId: string,
		proposal: Proposal,
		leadAgentId: string,
		timestamp: number,
		draftQueue: WorkspaceQueue,
	): string {
		const draftMeta: DraftPlanMeta = {
			id: draftId,
			proposalId: proposal.id,
			proposalTitle: proposal.title,
			phase: proposal.phase,
			leadAgentId,
			generatedAt: timestamp,
			gatesPassed: false,
		};

		const document = {
			draftMeta,
			queue: draftQueue,
			generatedFrom: {
				proposalId: proposal.id,
				proposalTitle: proposal.title,
			},
		};

		return JSON.stringify(document, null, 2);
	}

	/**
	 * Generate a unique draft ID.
	 */
	private generateDraftId(): string {
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).slice(2, 8);
		return `draft-${timestamp}-${random}`;
	}
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Check if a workspace queue is a draft plan.
 *
 * @param queue - Workspace queue to check
 * @returns True if the queue is a draft plan
 */
export function isDraftPlan(queue: WorkspaceQueue): boolean {
	return queue.isDraft === true;
}

/**
 * Assert that a workspace queue is not a draft plan.
 *
 * Throws if the queue is a draft plan. This is the enforcement gate
 * that prevents draft plans from being executed (AC2).
 *
 * @param queue - Workspace queue to check
 * @throws Error if the queue is a draft plan
 */
export function assertNotDraftPlan(queue: WorkspaceQueue): void {
	if (queue.isDraft) {
		throw new Error(
			`Cannot execute draft plan "${queue.title}" (phase: ${queue.phase}). ` +
				`Draft plans must pass normal plan approval gates before execution. ` +
				`Lead agent: ${queue.leadAgentId ?? "unknown"}. ` +
				`Promote the draft using promoteDraftToPlan() after gates pass.`,
		);
	}
}

/**
 * Set the lead agent on a workspace queue.
 *
 * Marks who created the draft so that AC3 can be enforced.
 *
 * @param queue - Workspace queue
 * @param leadAgentId - Agent ID
 */
export function setDraftLeadAgent(queue: WorkspaceQueue, leadAgentId: string): void {
	queue.leadAgentId = leadAgentId;
}

/**
 * Check if an agent can enqueue a workspace queue.
 *
 * AC3: If the queue is a draft and the agent is the lead agent, they cannot enqueue it.
 *
 * @param queue - Workspace queue
 * @param agentId - Agent requesting to enqueue
 * @returns True if the agent can enqueue
 */
export function canAgentEnqueuePlan(queue: WorkspaceQueue, agentId: string): boolean {
	if (queue.isDraft && queue.leadAgentId === agentId) {
		return false;
	}
	return true;
}

/**
 * Check if an agent can execute a workspace queue.
 *
 * AC3: If the queue is a draft and the agent is the lead agent, they cannot execute it.
 *
 * @param queue - Workspace queue
 * @param agentId - Agent requesting to execute
 * @returns True if the agent can execute
 */
export function canAgentExecutePlan(queue: WorkspaceQueue, agentId: string): boolean {
	if (queue.isDraft && queue.leadAgentId === agentId) {
		return false;
	}
	return true;
}

/**
 * Create a DraftPlanner instance.
 *
 * @param config - Draft planner configuration
 * @returns DraftPlanner instance
 */
export function createDraftPlanner(config: DraftPlannerConfig): DraftPlanner {
	return new DraftPlanner(config);
}

// ---------------------------------------------------------------------------
// Draft Gate Integration
// ---------------------------------------------------------------------------

/**
 * Run all draft gates for a workspace queue and agent.
 *
 * Checks:
 * 1. AC2: Draft plans cannot be executed (checked via execution gate)
 * 2. AC3: Lead agent cannot enqueue/execute its own drafts
 *
 * @param queue - Workspace queue
 * @param agentId - Agent requesting the operation
 * @param operation - "enqueue" or "execute"
 * @returns Gate result
 */
export function checkDraftGates(
	queue: WorkspaceQueue,
	agentId: string,
	operation: "enqueue" | "execute",
): DraftGateResult {
	// AC2: Draft plans cannot be executed
	if (operation === "execute" && queue.isDraft) {
		return {
			allowed: false,
			reason: `Draft plan "${queue.title}" is non-executable. Draft plans must pass normal plan approval gates before execution.`,
		};
	}

	// AC3: Lead agent cannot enqueue or execute its own draft
	if (queue.isDraft && queue.leadAgentId === agentId) {
		return {
			allowed: false,
			reason: `Lead agent "${agentId}" cannot ${operation} its own draft plan "${queue.title}". Another agent or explicit user approval is required.`,
		};
	}

	return { allowed: true };
}

/**
 * Format a draft plan gate result as a human-readable string.
 *
 * @param result - Draft gate result
 * @returns Formatted string
 */
export function formatDraftGateResult(result: DraftGateResult): string {
	if (result.allowed) {
		return "Draft gate: allowed";
	}

	return `Draft gate: BLOCKED\nReason: ${result.reason}`;
}

/**
 * Format a draft plan metadata as a human-readable string.
 *
 * @param meta - Draft plan metadata
 * @returns Formatted string
 */
export function formatDraftPlanMeta(meta: DraftPlanMeta): string {
	const lines: string[] = [];

	lines.push(`Draft:  ${meta.id}`);
	lines.push(`Title:  ${meta.proposalTitle}`);
	lines.push(`Phase:  ${meta.phase}`);
	lines.push(`From:   Proposal ${meta.proposalId}`);
	lines.push(`Agent:  ${meta.leadAgentId}`);
	lines.push(`Date:   ${new Date(meta.generatedAt).toISOString()}`);
	lines.push(`Gates:  ${meta.gatesPassed ? "passed" : "pending"}`);

	return lines.join("\n");
}

/**
 * Format a list of draft plan metadata as a table-like string.
 *
 * @param drafts - Draft plan metadata array
 * @returns Formatted string
 */
export function formatDraftPlanList(drafts: DraftPlanMeta[]): string {
	if (drafts.length === 0) {
		return "No draft plans found.";
	}

	const lines: string[] = [];
	lines.push(`${"ID".padEnd(30)} ${"Title".padEnd(30)} ${"Phase".padEnd(8)} ${"Agent".padEnd(20)} Gates`);
	lines.push("─".repeat(90));

	for (const draft of drafts) {
		const id = draft.id.padEnd(30);
		const title = draft.proposalTitle.slice(0, 28).padEnd(30);
		const phase = draft.phase.padEnd(8);
		const agent = draft.leadAgentId.slice(0, 18).padEnd(20);
		const gates = draft.gatesPassed ? "passed" : "pending";
		lines.push(`${id} ${title} ${phase} ${agent} ${gates}`);
	}

	return lines.join("\n");
}
