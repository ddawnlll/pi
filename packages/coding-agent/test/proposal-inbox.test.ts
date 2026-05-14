/**
 * Tests for Proposal Inbox - P8.B
 *
 * Acceptance Criteria:
 * 1. Proposal inbox persists proposal state and evidence.
 * 2. Approvals and rejections are auditable.
 * 3. No proposal becomes an execution plan without approval.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlannerOutput } from "../src/core/planner.js";
import { formatProposal, formatProposalList, ProposalInbox } from "../src/core/proposal-inbox.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-proposal-inbox");

/**
 * Create a minimal valid planner output for testing.
 */
function createMinimalPlannerOutput(overrides?: Partial<PlannerOutput>): PlannerOutput {
	return {
		success: true,
		optimizedBatches: [
			{
				batchIndex: 1,
				workspaceIds: ["7.A", "7.B"],
				width: 2,
				optimizationNotes: [],
				isBottleneck: false,
				isAtCapacity: true,
			},
		],
		criticalPath: {
			path: ["7.A"],
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
		summary: "Test plan summary",
		...overrides,
	};
}

/**
 * Create a minimal valid workspace queue for testing.
 */
function createMinimalQueue(overrides?: Partial<WorkspaceQueue>): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Test Phase",
		maxParallelWorkspaces: 3,
		workspaces: [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
		...overrides,
	};
}

describe("ProposalInbox", () => {
	let inbox: ProposalInbox;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		inbox = new ProposalInbox(TEST_DIR);
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	// =========================================================================
	// AC1: Persistence
	// =========================================================================

	describe("AC1: Persists proposal state and evidence", () => {
		it("should initialize empty inbox", async () => {
			const proposals = await inbox.listProposals();
			expect(proposals).toHaveLength(0);
		});

		it("should submit a proposal and persist it", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Test Proposal", "P2", queue, plannerOutput);

			expect(result.success).toBe(true);
			expect(result.proposal).toBeDefined();
			expect(result.proposal?.title).toBe("Test Proposal");
			expect(result.proposal?.phase).toBe("P2");
			expect(result.proposal?.status).toBe("pending");
			expect(result.proposal?.submittedAt).toBeGreaterThan(0);
			expect(result.proposal?.id).toMatch(/^prop-/);
		});

		it("should persist proposal evidence (planner output + queue)", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Evidence Test", "P2", queue, plannerOutput);
			expect(result.success).toBe(true);

			const proposal = result.proposal!;

			// Evidence should contain the planner output
			expect(proposal.evidence.plannerOutput).toBeDefined();
			expect(proposal.evidence.plannerOutput.success).toBe(true);
			expect(proposal.evidence.plannerOutput.criticalPath.length).toBe(1);
			expect(proposal.evidence.plannerOutput.predictedParallelism.requested).toBe(3);

			// Evidence should contain the queue
			expect(proposal.evidence.queue).toBeDefined();
			expect(proposal.evidence.queue.phase).toBe("P2");
			expect(proposal.evidence.queue.workspaces).toHaveLength(2);
		});

		it("should persist proposal across inbox restarts", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			// Submit a proposal
			await inbox.submitProposal("Restart Test", "P2", queue, plannerOutput);

			// Create a new inbox instance (simulates restart)
			const newInbox = new ProposalInbox(TEST_DIR);
			const proposals = await newInbox.listProposals();

			expect(proposals).toHaveLength(1);
			expect(proposals[0].title).toBe("Restart Test");
			expect(proposals[0].status).toBe("pending");
			expect(proposals[0].evidence.plannerOutput.success).toBe(true);
			expect(proposals[0].evidence.queue.workspaces).toHaveLength(2);
		});

		it("should persist approval state across restarts", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			// Submit and approve
			const submitResult = await inbox.submitProposal("Approval Persist", "P2", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id, { actor: "test-user" });

			// Create a new inbox instance (simulates restart)
			const newInbox = new ProposalInbox(TEST_DIR);
			const proposal = await newInbox.getProposal(submitResult.proposal!.id);

			expect(proposal).toBeDefined();
			expect(proposal!.status).toBe("approved");
		});

		it("should reject proposal with invalid data", async () => {
			const result = await inbox.submitProposal(
				"",
				"",
				null as unknown as WorkspaceQueue,
				null as unknown as PlannerOutput,
			);

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	// =========================================================================
	// AC2: Auditability
	// =========================================================================

	describe("AC2: Approvals and rejections are auditable", () => {
		it("should record submission in audit trail", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Audit Test", "P2", queue, plannerOutput, {
				actor: "alice",
			});

			const auditTrail = result.proposal!.auditTrail;
			expect(auditTrail).toHaveLength(1);
			expect(auditTrail[0].action).toBe("submitted");
			expect(auditTrail[0].actor).toBe("alice");
			expect(auditTrail[0].resultingStatus).toBe("pending");
			expect(auditTrail[0].timestamp).toBeGreaterThan(0);
		});

		it("should record approval in audit trail", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Audit Approve", "P2", queue, plannerOutput);
			const approveResult = await inbox.approveProposal(submitResult.proposal!.id, {
				actor: "bob",
				reason: "Looks good",
			});

			expect(approveResult.success).toBe(true);

			const auditTrail = approveResult.proposal!.auditTrail;
			expect(auditTrail).toHaveLength(2);
			expect(auditTrail[1].action).toBe("approved");
			expect(auditTrail[1].actor).toBe("bob");
			expect(auditTrail[1].reason).toBe("Looks good");
			expect(auditTrail[1].resultingStatus).toBe("approved");
		});

		it("should record rejection with reason in audit trail", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Audit Reject", "P2", queue, plannerOutput);
			const rejectResult = await inbox.rejectProposal(submitResult.proposal!.id, "Missing safety checks", {
				actor: "carol",
			});

			expect(rejectResult.success).toBe(true);

			const auditTrail = rejectResult.proposal!.auditTrail;
			expect(auditTrail).toHaveLength(2);
			expect(auditTrail[1].action).toBe("rejected");
			expect(auditTrail[1].actor).toBe("carol");
			expect(auditTrail[1].reason).toBe("Missing safety checks");
			expect(auditTrail[1].resultingStatus).toBe("rejected");
			expect(rejectResult.proposal!.rejectionReason).toBe("Missing safety checks");
		});

		it("should retrieve audit trail via helper method", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Audit Trail", "P2", queue, plannerOutput);
			await inbox.approveProposal(submitResult.proposal!.id, { actor: "dave" });

			const auditTrail = await inbox.getProposalAuditTrail(submitResult.proposal!.id);
			expect(auditTrail).toBeDefined();
			expect(auditTrail).toHaveLength(2);
			expect(auditTrail![0].action).toBe("submitted");
			expect(auditTrail![1].action).toBe("approved");
		});

		it("should return undefined audit trail for non-existent proposal", async () => {
			const auditTrail = await inbox.getProposalAuditTrail("non-existent");
			expect(auditTrail).toBeUndefined();
		});

		it("should include timestamps in audit entries", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await inbox.submitProposal("Timestamps", "P2", queue, plannerOutput);
			const beforeReject = Date.now();
			await new Promise((r) => setTimeout(r, 5));
			await inbox.rejectProposal(submitResult.proposal!.id, "Test");
			const afterReject = Date.now();

			const auditTrail = await inbox.getProposalAuditTrail(submitResult.proposal!.id);
			expect(auditTrail).toBeDefined();
			expect(auditTrail!.length).toBe(2);

			// Approval timestamp should be within range
			const rejectEntry = auditTrail![1];
			expect(rejectEntry.timestamp).toBeGreaterThanOrEqual(beforeReject);
			expect(rejectEntry.timestamp).toBeLessThanOrEqual(afterReject);
		});
	});

	// =========================================================================
	// AC3: No proposal becomes an execution plan without approval
	// =========================================================================

	describe("AC3: No proposal becomes an execution plan without approval", () => {
		it("should not allow execution of non-existent proposal", async () => {
			const mayExec = await inbox.mayExecute("non-existent");
			expect(mayExec).toBe(false);
		});

		it("should not allow execution of pending proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Pending Test", "P2", queue, plannerOutput);
			const mayExec = await inbox.mayExecute(result.proposal!.id);
			expect(mayExec).toBe(false);
		});

		it("should not allow execution of rejected proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Rejected Test", "P2", queue, plannerOutput);
			await inbox.rejectProposal(result.proposal!.id, "Not safe");

			const mayExec = await inbox.mayExecute(result.proposal!.id);
			expect(mayExec).toBe(false);
		});

		it("should allow execution of approved proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Approved Test", "P2", queue, plannerOutput);
			await inbox.approveProposal(result.proposal!.id);

			const mayExec = await inbox.mayExecute(result.proposal!.id);
			expect(mayExec).toBe(true);
		});

		it("assertMayExecute should throw for non-approved proposals", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Assert Test", "P2", queue, plannerOutput);

			// Pending
			await expect(inbox.assertMayExecute(result.proposal!.id)).rejects.toThrow(/not approved|pending review/i);

			// Rejected
			await inbox.rejectProposal(result.proposal!.id, "Bad");
			await expect(inbox.assertMayExecute(result.proposal!.id)).rejects.toThrow(/not approved|rejected/i);
		});

		it("assertMayExecute should pass for approved proposals", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Assert Pass", "P2", queue, plannerOutput);
			await inbox.approveProposal(result.proposal!.id);

			await expect(inbox.assertMayExecute(result.proposal!.id)).resolves.toBeUndefined();
		});

		it("should prevent approving already-rejected proposals", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Double Reject", "P2", queue, plannerOutput);
			await inbox.rejectProposal(result.proposal!.id, "First rejection");

			const approveResult = await inbox.approveProposal(result.proposal!.id);
			expect(approveResult.success).toBe(false);
			expect(approveResult.error).toContain("rejected");
		});

		it("should prevent rejecting already-approved proposals", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Double Approve", "P2", queue, plannerOutput);
			await inbox.approveProposal(result.proposal!.id);

			const rejectResult = await inbox.rejectProposal(result.proposal!.id, "Late rejection");
			expect(rejectResult.success).toBe(false);
			expect(rejectResult.error).toContain("approved");
		});

		it("should prevent duplicate approval", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Duplicate Approve", "P2", queue, plannerOutput);
			await inbox.approveProposal(result.proposal!.id);

			const duplicateApprove = await inbox.approveProposal(result.proposal!.id);
			expect(duplicateApprove.success).toBe(false);
			expect(duplicateApprove.error).toContain("already approved");
		});

		it("should prevent duplicate rejection", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Duplicate Reject", "P2", queue, plannerOutput);
			await inbox.rejectProposal(result.proposal!.id, "First");

			const duplicateReject = await inbox.rejectProposal(result.proposal!.id, "Second");
			expect(duplicateReject.success).toBe(false);
			expect(duplicateReject.error).toContain("already rejected");
		});
	});

	// =========================================================================
	// Listing and Filtering
	// =========================================================================

	describe("Listing and filtering", () => {
		it("should list proposals sorted by submission time (newest first)", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			await inbox.submitProposal("First", "P2", queue, plannerOutput);
			await new Promise((r) => setTimeout(r, 5));
			await inbox.submitProposal("Second", "P2", queue, plannerOutput);

			const proposals = await inbox.listProposals();
			expect(proposals).toHaveLength(2);
			expect(proposals[0].title).toBe("Second");
			expect(proposals[1].title).toBe("First");
		});

		it("should filter proposals by status", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const _r1 = await inbox.submitProposal("Pending One", "P2", queue, plannerOutput);
			const r2 = await inbox.submitProposal("Approved One", "P2", queue, plannerOutput);
			await inbox.approveProposal(r2.proposal!.id);
			const r3 = await inbox.submitProposal("Rejected One", "P2", queue, plannerOutput);
			await inbox.rejectProposal(r3.proposal!.id, "No");

			const pending = await inbox.listProposals({ status: "pending" });
			expect(pending).toHaveLength(1);
			expect(pending[0].title).toBe("Pending One");

			const approved = await inbox.listProposals({ status: "approved" });
			expect(approved).toHaveLength(1);
			expect(approved[0].title).toBe("Approved One");

			const rejected = await inbox.listProposals({ status: "rejected" });
			expect(rejected).toHaveLength(1);
			expect(rejected[0].title).toBe("Rejected One");
		});

		it("should filter proposals by phase", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			await inbox.submitProposal("P2 Proposal", "P2", queue, plannerOutput);
			await inbox.submitProposal("P3 Proposal", "P3", queue, plannerOutput);

			const p2 = await inbox.listProposals({ phase: "P2" });
			expect(p2).toHaveLength(1);
			expect(p2[0].title).toBe("P2 Proposal");
		});

		it("should paginate results", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			for (let i = 0; i < 5; i++) {
				await inbox.submitProposal(`Proposal ${i}`, "P2", queue, plannerOutput);
			}

			const page1 = await inbox.listProposals({ limit: 2, offset: 0 });
			expect(page1).toHaveLength(2);

			const page2 = await inbox.listProposals({ limit: 2, offset: 2 });
			expect(page2).toHaveLength(2);

			const page3 = await inbox.listProposals({ limit: 2, offset: 4 });
			expect(page3).toHaveLength(1);

			// Ensure no overlap
			const page1Ids = new Set(page1.map((p) => p.id));
			const page2Ids = new Set(page2.map((p) => p.id));
			const page3Ids = new Set(page3.map((p) => p.id));

			for (const id of page1Ids) {
				expect(page2Ids.has(id)).toBe(false);
				expect(page3Ids.has(id)).toBe(false);
			}
			for (const id of page2Ids) {
				expect(page3Ids.has(id)).toBe(false);
			}
		});
	});

	// =========================================================================
	// Delete operations
	// =========================================================================

	describe("Delete operations", () => {
		it("should delete an existing proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Delete Me", "P2", queue, plannerOutput);
			const deleted = await inbox.deleteProposal(result.proposal!.id);
			expect(deleted).toBe(true);

			const proposals = await inbox.listProposals();
			expect(proposals).toHaveLength(0);
		});

		it("should return false when deleting non-existent proposal", async () => {
			const deleted = await inbox.deleteProposal("does-not-exist");
			expect(deleted).toBe(false);
		});
	});

	// =========================================================================
	// Count
	// =========================================================================

	describe("Count operations", () => {
		it("should count all proposals", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			await inbox.submitProposal("A", "P2", queue, plannerOutput);
			await inbox.submitProposal("B", "P3", queue, plannerOutput);

			const count = await inbox.countProposals();
			expect(count).toBe(2);
		});

		it("should count proposals filtered by status", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const r1 = await inbox.submitProposal("A", "P2", queue, plannerOutput);
			await inbox.approveProposal(r1.proposal!.id);
			await inbox.submitProposal("B", "P2", queue, plannerOutput);

			const pendingCount = await inbox.countProposals({ status: "pending" });
			expect(pendingCount).toBe(1);

			const approvedCount = await inbox.countProposals({ status: "approved" });
			expect(approvedCount).toBe(1);
		});
	});

	// =========================================================================
	// Formatting
	// =========================================================================

	describe("Formatting", () => {
		it("should format a single proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await inbox.submitProposal("Format Test", "P2", queue, plannerOutput);
			const formatted = formatProposal(result.proposal!);

			expect(formatted).toContain("Proposal:");
			expect(formatted).toContain("Title:    Format Test");
			expect(formatted).toContain("Phase:    P2");
			expect(formatted).toContain("Status:   pending");
			expect(formatted).toContain("Evidence:");
			expect(formatted).toContain("Audit Trail:");
			expect(formatted).toContain("submitted by system");
		});

		it("should format proposal list as empty", () => {
			const formatted = formatProposalList([]);
			expect(formatted).toBe("No proposals found.");
		});

		it("should format proposal list with entries", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			await inbox.submitProposal("List Test", "P2", queue, plannerOutput);
			const proposals = await inbox.listProposals();
			const formatted = formatProposalList(proposals);

			expect(formatted).toContain("ID");
			expect(formatted).toContain("Title");
			expect(formatted).toContain("Status");
			expect(formatted).toContain("List Test");
		});
	});

	// =========================================================================
	// Optimization proposals evidence
	// =========================================================================

	describe("Optimization proposals evidence", () => {
		it("should persist optimization proposals as part of evidence", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const optimizationProposals = [
				{
					id: "opt-1",
					kind: "remove_dependency",
					description: "Remove transitive dependency from 7.B to 7.A",
					approvalStatus: "pending",
					evidence: { beforeParallelism: 1, afterParallelism: 2 },
				},
			];

			const result = await inbox.submitProposal("Opt Test", "P2", queue, plannerOutput, {
				optimizationProposals,
			});

			expect(result.success).toBe(true);
			expect(result.proposal!.evidence.optimizationProposals).toHaveLength(1);
			expect(result.proposal!.evidence.optimizationProposals![0].kind).toBe("remove_dependency");
			expect(result.proposal!.evidence.optimizationProposals![0].evidence.beforeParallelism).toBe(1);
		});
	});
});
