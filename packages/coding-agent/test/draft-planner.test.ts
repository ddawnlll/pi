/**
 * Tests for Draft Planner - P8.E
 *
 * Acceptance Criteria:
 * 1. Approved proposals can produce draft plans.
 * 2. Draft plans remain non-executable until normal plan approval gates pass.
 * 3. Lead agent cannot enqueue or execute its own drafts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertNotDraftPlan,
	canAgentEnqueuePlan,
	canAgentExecutePlan,
	checkDraftGates,
	DraftPlanner,
	formatDraftGateResult,
	formatDraftPlanList,
	formatDraftPlanMeta,
	isDraftPlan,
	setDraftLeadAgent,
} from "../src/core/draft-planner.js";
import type { PlannerOutput } from "../src/core/planner.js";
import { ProposalInbox } from "../src/core/proposal-inbox.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-draft-planner");

/**
 * Create a minimal valid planner output for testing.
 */
function createMinimalPlannerOutput(overrides?: Partial<PlannerOutput>): PlannerOutput {
	return {
		success: true,
		optimizedBatches: [
			{
				batchIndex: 1,
				workspaceIds: ["8.E.1", "8.E.2"],
				width: 2,
				optimizationNotes: [],
				isBottleneck: false,
				isAtCapacity: true,
			},
		],
		criticalPath: {
			path: ["8.E.1"],
			length: 1,
			dependencies: {},
			batchCount: 1,
			bottleneckImpact: "No bottleneck",
		},
		plannerWarnings: [],
		plannerSuggestions: [],
		predictedParallelism: {
			requested: 3,
			effective: 2,
			totalBatches: 1,
			resourceUtilizationPercent: 66,
			bottlenecks: [],
			parallelismHeadroom: false,
			saturationPoint: 2,
		},
		summary: "Draft plan test summary",
		...overrides,
	};
}

/**
 * Create a minimal valid workspace queue for testing.
 */
function createMinimalQueue(overrides?: Partial<WorkspaceQueue>): WorkspaceQueue {
	return {
		phase: "P8",
		title: "Test Draft Phase",
		maxParallelWorkspaces: 3,
		workspaces: [
			{
				id: "8.E.1",
				title: "Draft Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "8.E.2",
				title: "Draft Task B",
				dependencies: ["8.E.1"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
		...overrides,
	};
}

describe("DraftPlanner", () => {
	let planner: DraftPlanner;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		planner = new DraftPlanner({ workspaceRoot: TEST_DIR });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	// =========================================================================
	// AC1: Approved proposals can produce draft plans
	// =========================================================================

	describe("AC1: Approved proposals can produce draft plans", () => {
		it("should reject draft generation from non-approved proposals", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			// Submit a pending proposal
			const submitResult = await inbox.submitProposal("Pending Proposal", "P8", queue, plannerOutput);
			expect(submitResult.success).toBe(true);

			// Try to produce a draft from the pending proposal — should fail
			const draftResult = await inbox.produceDraftPlan(submitResult.proposal!.id, "lead-agent-1");
			expect(draftResult.success).toBe(false);
			expect(draftResult.error).toContain("non-approved");
		});

		it("should generate draft plan from approved proposal via ProposalInbox", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			// Submit and approve
			const submitResult = await inbox.submitProposal("Draft Test", "P8", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id, { actor: "reviewer" });

			// Produce draft plan
			const draftResult = await inbox.produceDraftPlan(submitResult.proposal!.id, "lead-agent-1");
			expect(draftResult.success).toBe(true);
			expect(draftResult.draftMeta).toBeDefined();
			expect(draftResult.draftFilePath).toBeDefined();
			expect(draftResult.draftMeta!.proposalId).toBe(submitResult.proposal!.id);
			expect(draftResult.draftMeta!.leadAgentId).toBe("lead-agent-1");
			expect(draftResult.draftMeta!.gatesPassed).toBe(false);
			expect(draftResult.draftMeta!.id).toMatch(/^draft-/);
		});

		it("should generate draft plan via DraftPlanner directly", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Direct Draft", "P8", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id);

			const proposal = await inbox.getProposal(submitResult.proposal!.id);
			expect(proposal).toBeDefined();

			const draftResult = await planner.generateDraftPlan(proposal!, "lead-agent-2");
			expect(draftResult.success).toBe(true);
			expect(draftResult.draftMeta).toBeDefined();
			expect(draftResult.draftMeta!.leadAgentId).toBe("lead-agent-2");
			expect(draftResult.draftFilePath).toBeDefined();
		});

		it("should embed draft flags in the generated queue", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Flags Test", "P8", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id);

			const draftResult = await inbox.produceDraftPlan(submitResult.proposal!.id, "lead-agent-3");
			expect(draftResult.success).toBe(true);

			// Load the draft plan file and verify the queue has draft flags
			const draftQueue = await planner.loadDraftPlan(draftResult.draftFilePath!);
			expect(draftQueue).toBeDefined();
			expect(draftQueue!.isDraft).toBe(true);
			expect(draftQueue!.leadAgentId).toBe("lead-agent-3");
		});

		it("should persist draft plan file to disk", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Persist Test", "P8", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id);

			const draftResult = await inbox.produceDraftPlan(submitResult.proposal!.id, "lead-agent-4");

			// Verify the file exists
			const fileExists = await fs
				.access(draftResult.draftFilePath!)
				.then(() => true)
				.catch(() => false);
			expect(fileExists).toBe(true);

			// Verify file has correct JSON structure
			const content = await fs.readFile(draftResult.draftFilePath!, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.draftMeta).toBeDefined();
			expect(parsed.queue).toBeDefined();
			expect(parsed.generatedFrom).toBeDefined();
			expect(parsed.draftMeta.id).toBe(draftResult.draftMeta!.id);
		});
	});

	// =========================================================================
	// AC2: Draft plans remain non-executable until gates pass
	// =========================================================================

	describe("AC2: Draft plans remain non-executable until normal plan approval gates pass", () => {
		it("should detect a workspace queue as a draft plan", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "agent-x" });
			expect(isDraftPlan(queue)).toBe(true);
		});

		it("should not detect non-draft queue as a draft plan", () => {
			const queue = createMinimalQueue();
			expect(isDraftPlan(queue)).toBe(false);
		});

		it("should block execution of draft plans via execution gate", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "agent-x", title: "Blocked Draft" });
			const gateResult = checkDraftGates(queue, "other-agent", "execute");
			expect(gateResult.allowed).toBe(false);
			expect(gateResult.reason).toContain("non-executable");
			expect(gateResult.reason).toContain("Blocked Draft");
		});

		it("should allow execution of non-draft plans via execution gate", () => {
			const queue = createMinimalQueue({ title: "Normal Plan" });
			const gateResult = checkDraftGates(queue, "any-agent", "execute");
			expect(gateResult.allowed).toBe(true);
		});

		it("assertNotDraftPlan should throw for draft plans", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "agent-x" });
			expect(() => assertNotDraftPlan(queue)).toThrow("Cannot execute draft plan");
		});

		it("assertNotDraftPlan should pass for non-draft plans", () => {
			const queue = createMinimalQueue();
			expect(() => assertNotDraftPlan(queue)).not.toThrow();
		});

		it("should allow promotion of draft to executable plan", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "agent-x", title: "Promotable Draft" });
			expect(isDraftPlan(queue)).toBe(true);

			// Promote the draft
			const promoted = planner.promoteDraftToPlan(queue);
			expect(promoted.isDraft).toBe(false);
			expect(isDraftPlan(promoted)).toBe(false);

			// Now it should pass the execution gate
			const gateResult = checkDraftGates(promoted, "agent-x", "execute");
			expect(gateResult.allowed).toBe(true);
		});

		it("should enforce execution gate via DraftPlanner.checkExecutionGate", () => {
			const draftQueue = createMinimalQueue({ isDraft: true, leadAgentId: "agent-x", title: "Gate Check Draft" });

			// Draft should be blocked
			let result = planner.checkExecutionGate(draftQueue);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("non-executable");

			// After promotion, it should be allowed
			planner.promoteDraftToPlan(draftQueue);
			result = planner.checkExecutionGate(draftQueue);
			expect(result.allowed).toBe(true);
		});
	});

	// =========================================================================
	// AC3: Lead agent cannot enqueue or execute its own drafts
	// =========================================================================

	describe("AC3: Lead agent cannot enqueue or execute its own drafts", () => {
		it("should prevent lead agent from enqueueing its own draft", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "lead-agent", title: "Self-Enqueue Draft" });
			const gateResult = checkDraftGates(queue, "lead-agent", "enqueue");
			expect(gateResult.allowed).toBe(false);
			expect(gateResult.reason).toContain("lead-agent");
			expect(gateResult.reason).toContain("enqueue");
		});

		it("should prevent lead agent from executing its own draft", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "lead-agent", title: "Self-Execute Draft" });
			const gateResult = checkDraftGates(queue, "lead-agent", "execute");
			// AC2 execution gate fires before AC3 lead agent check
			expect(gateResult.allowed).toBe(false);
			expect(gateResult.reason).toContain("non-executable");
		});

		it("should allow another agent to enqueue a draft", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "lead-agent", title: "Other Agent Enqueue" });
			const gateResult = checkDraftGates(queue, "other-agent", "enqueue");
			expect(gateResult.allowed).toBe(true);
		});

		it("should allow another agent to execute a promoted draft", () => {
			const queue = createMinimalQueue({
				isDraft: true,
				leadAgentId: "lead-agent",
				title: "Other Execute Promoted",
			});

			// Promote first
			planner.promoteDraftToPlan(queue);
			expect(queue.isDraft).toBe(false);

			// Now other agent can execute
			const gateResult = checkDraftGates(queue, "other-agent", "execute");
			expect(gateResult.allowed).toBe(true);
		});

		it("canAgentEnqueuePlan should return false for lead agent", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "lead-agent" });
			expect(canAgentEnqueuePlan(queue, "lead-agent")).toBe(false);
			expect(canAgentEnqueuePlan(queue, "other-agent")).toBe(true);
		});

		it("canAgentExecutePlan should return false for lead agent", () => {
			const queue = createMinimalQueue({ isDraft: true, leadAgentId: "lead-agent" });
			expect(canAgentExecutePlan(queue, "lead-agent")).toBe(false);
			expect(canAgentExecutePlan(queue, "other-agent")).toBe(true);
		});

		it("should allow non-lead-agent operations on non-draft plans", () => {
			const queue = createMinimalQueue();
			expect(canAgentEnqueuePlan(queue, "any-agent")).toBe(true);
			expect(canAgentExecutePlan(queue, "any-agent")).toBe(true);
		});

		it("DraftPlanner.checkEnqueueGate should block lead agent", () => {
			const draftQueue = createMinimalQueue({
				isDraft: true,
				leadAgentId: "lead-agent",
				title: "Enqueue Gate Draft",
			});

			// Lead agent cannot enqueue
			let result = planner.checkEnqueueGate(draftQueue, "lead-agent");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("lead-agent");

			// Other agent can enqueue
			result = planner.checkEnqueueGate(draftQueue, "other-agent");
			expect(result.allowed).toBe(true);
		});
	});

	// =========================================================================
	// Draft Plan Management
	// =========================================================================

	describe("Draft Plan Management", () => {
		it("should list draft plans", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Listable Draft", "P8", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id);
			await inbox.produceDraftPlan(submitResult.proposal!.id, "agent-alpha");

			const drafts = await planner.listDraftPlans();
			expect(drafts).toHaveLength(1);
			expect(drafts[0].proposalTitle).toBe("Listable Draft");
			expect(drafts[0].leadAgentId).toBe("agent-alpha");
		});

		it("should list multiple draft plans sorted newest first", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const r1 = await inbox.submitProposal("First Draft", "P8", queue, plannerOutput);
			await inbox.approveProposal(r1.proposal!.id);
			await inbox.produceDraftPlan(r1.proposal!.id, "agent-a");

			await new Promise((r) => setTimeout(r, 10));

			const r2 = await inbox.submitProposal("Second Draft", "P8", queue, plannerOutput);
			await inbox.approveProposal(r2.proposal!.id);
			await inbox.produceDraftPlan(r2.proposal!.id, "agent-b");

			const drafts = await planner.listDraftPlans();
			expect(drafts).toHaveLength(2);
			expect(drafts[0].proposalTitle).toBe("Second Draft");
			expect(drafts[1].proposalTitle).toBe("First Draft");
		});

		it("should delete a draft plan", async () => {
			const inbox = new ProposalInbox(TEST_DIR);
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Deletable Draft", "P8", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id);
			const draftResult = await inbox.produceDraftPlan(submitResult.proposal!.id, "agent-c");

			// Delete the draft
			const deleted = await planner.deleteDraftPlan(draftResult.draftMeta!.id);
			expect(deleted).toBe(true);

			const drafts = await planner.listDraftPlans();
			expect(drafts).toHaveLength(0);
		});

		it("should return false when deleting non-existent draft", async () => {
			const deleted = await planner.deleteDraftPlan("non-existent-draft");
			expect(deleted).toBe(false);
		});

		it("should return empty list when no drafts exist", async () => {
			const drafts = await planner.listDraftPlans();
			expect(drafts).toHaveLength(0);
		});
	});

	// =========================================================================
	// Utility Functions
	// =========================================================================

	describe("Utility Functions", () => {
		it("setDraftLeadAgent should set lead agent on queue", () => {
			const queue = createMinimalQueue();
			setDraftLeadAgent(queue, "agent-x");
			expect(queue.leadAgentId).toBe("agent-x");
		});

		it("formatDraftGateResult should format blocked result", () => {
			const result = { allowed: false, reason: "Blocked by draft gate" };
			const formatted = formatDraftGateResult(result);
			expect(formatted).toContain("BLOCKED");
			expect(formatted).toContain("Blocked by draft gate");
		});

		it("formatDraftGateResult should format allowed result", () => {
			const result = { allowed: true };
			const formatted = formatDraftGateResult(result);
			expect(formatted).toContain("allowed");
		});

		it("formatDraftPlanMeta should format metadata", () => {
			const meta = {
				id: "draft-test-123",
				proposalId: "prop-abc-123",
				proposalTitle: "Test Proposal",
				phase: "P8",
				leadAgentId: "agent-x",
				generatedAt: 1700000000000,
				gatesPassed: false,
			};
			const formatted = formatDraftPlanMeta(meta);
			expect(formatted).toContain("draft-test-123");
			expect(formatted).toContain("Test Proposal");
			expect(formatted).toContain("agent-x");
			expect(formatted).toContain("pending");
		});

		it("formatDraftPlanList should format empty list", () => {
			expect(formatDraftPlanList([])).toBe("No draft plans found.");
		});

		it("formatDraftPlanList should format non-empty list", () => {
			const metas = [
				{
					id: "draft-1",
					proposalId: "prop-1",
					proposalTitle: "Draft Alpha",
					phase: "P8",
					leadAgentId: "agent-a",
					generatedAt: 1700000000000,
					gatesPassed: false,
				},
			];
			const formatted = formatDraftPlanList(metas);
			expect(formatted).toContain("ID");
			expect(formatted).toContain("Draft Alpha");
			expect(formatted).toContain("pending");
		});

		it("should reject draft generation without lead agent ID", async () => {
			const proposal: any = {
				id: "prop-test",
				title: "No Agent",
				phase: "P8",
				status: "approved",
				evidence: {
					queue: createMinimalQueue(),
					plannerOutput: createMinimalPlannerOutput(),
				},
				auditTrail: [],
				submittedAt: Date.now(),
			};

			const result = await planner.generateDraftPlan(proposal, "");
			expect(result.success).toBe(false);
			expect(result.error).toContain("leadAgentId");
		});

		it("should reject draft generation from rejected proposal", async () => {
			const proposal: any = {
				id: "prop-rejected",
				title: "Rejected",
				phase: "P8",
				status: "rejected",
				evidence: {
					queue: createMinimalQueue(),
					plannerOutput: createMinimalPlannerOutput(),
				},
				auditTrail: [],
				submittedAt: Date.now(),
			};

			const result = await planner.generateDraftPlan(proposal, "agent-x");
			expect(result.success).toBe(false);
			expect(result.error).toContain("non-approved");
			expect(result.error).toContain("rejected");
		});
	});
});
