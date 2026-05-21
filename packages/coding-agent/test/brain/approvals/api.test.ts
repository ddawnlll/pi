/**
 * Approval Queue API — P18.D — Tests
 *
 * Acceptance Criteria:
 * 1. GET /api/brain/approvals - list pending
 * 2. GET /api/brain/approvals/{id} - get single
 * 3. POST /api/brain/approvals/{id}/approve - approve
 * 4. POST /api/brain/approvals/{id}/reject - reject with reason
 * 5. POST /api/brain/approvals/{id}/defer - extend deadline
 * 6. GET /api/brain/approvals/stats - stats
 * 7. GET /api/brain/approvals/history - completed approvals
 */

import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalQueueApi } from "../../../src/brain/approvals/api.js";
import { ApprovalGate } from "../../../src/brain/approvals/gate.js";
import type { AuditEntry } from "../../../src/brain/audit/ledger.js";
import type {
	PolicyContext,
	ProposalRiskAssessment,
} from "../../../src/brain/policy/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "approval-api-test-"));
}

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		action: "memory_modification",
		actionType: "memory_proposal",
		actor: "pi",
		autonomyLevel: 3,
		riskLevel: "medium",
		proposalId: "proposal-001",
		metadata: {
			rationale: "Cleaning up stale memory entries",
			policyRuleId: "rule-appr-001",
		},
		...overrides,
	};
}

function makeAltContext(action: string, proposalId: string): PolicyContext {
	return {
		action,
		actionType: "plan_proposal",
		actor: "pi",
		autonomyLevel: 3,
		riskLevel: "high",
		proposalId,
		metadata: {
			rationale: `Execute plan ${proposalId}`,
			policyRuleId: "rule-appr-002",
		},
	};
}

function makeRisk(overrides?: Partial<ProposalRiskAssessment>): ProposalRiskAssessment {
	return {
		level: "medium",
		score: 0.6,
		factors: ["memory inconsistency", "potential data loss"],
		description: "Modifying memory records carries risk of data loss",
		...overrides,
	};
}

class MockAuditLedger {
	public entries: AuditEntry[] = [];

	async append(entry: AuditEntry): Promise<void> {
		this.entries.push(entry);
	}

	clear(): void {
		this.entries = [];
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalQueueApi", () => {
	let api: ApprovalQueueApi;
	let gate: ApprovalGate;
	let ledger: MockAuditLedger;
	let tempDir: string;
	let persistencePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		persistencePath = join(tempDir, "requests.json");
		ledger = new MockAuditLedger();
		gate = new ApprovalGate(ledger, undefined, persistencePath);
		await gate.initialize();
		api = new ApprovalQueueApi(gate);
	});

	afterEach(async () => {
		gate.stopExpiryCheck();
		await rm(tempDir, { recursive: true, force: true });
	});

	// =======================================================================
	// AC 1: GET /api/brain/approvals - list pending
	// =======================================================================

	describe("AC 1: listApprovals — list pending", () => {
		it("returns empty list when no approvals exist", async () => {
			const result = await api.listApprovals();
			expect(result.approvals).toHaveLength(0);
			expect(result.total).toBe(0);
			expect(result.stats.total).toBe(0);
		});

		it("returns pending approvals by default", async () => {
			await gate.requestApproval(makeContext(), makeRisk());

			const result = await api.listApprovals();
			expect(result.approvals).toHaveLength(1);
			expect(result.total).toBe(1);
			expect(result.approvals[0].status).toBe("pending");
		});

		it("filters by status", async () => {
			const req1 = await gate.requestApproval(makeContext(), makeRisk());
			await gate.requestApproval(makeAltContext("plan_execution", "proposal-002"), makeRisk({ level: "high" }));

			// Approve one
			await gate.approve(req1.id, "user");

			// List pending
			const pending = await api.listApprovals({ status: "pending" });
			expect(pending.total).toBe(1);
			expect(pending.approvals[0].status).toBe("pending");

			// List approved
			const approved = await api.listApprovals({ status: "approved" });
			expect(approved.total).toBe(1);
			expect(approved.approvals[0].status).toBe("approved");

			// List all
			const all = await api.listApprovals({ status: "all" });
			expect(all.total).toBe(2);
		});

		it("respects limit and offset", async () => {
			// Create 5 requests with different proposal IDs
			for (let i = 1; i <= 5; i++) {
				await gate.requestApproval(
					makeAltContext(`action_${i}`, `proposal-${String(i).padStart(3, "0")}`),
					makeRisk(),
				);
			}

			const first = await api.listApprovals({ limit: 2, offset: 0 });
			expect(first.approvals).toHaveLength(2);
			expect(first.total).toBe(5);

			const second = await api.listApprovals({ limit: 2, offset: 2 });
			expect(second.approvals).toHaveLength(2);
			expect(second.total).toBe(5);

			const last = await api.listApprovals({ limit: 2, offset: 4 });
			expect(last.approvals).toHaveLength(1);
			expect(last.total).toBe(5);
		});

		it("returns stats alongside approvals", async () => {
			const req1 = await gate.requestApproval(makeContext(), makeRisk());
			await gate.requestApproval(makeAltContext("plan_execution", "proposal-002"), makeRisk({ level: "high" }));
			await gate.approve(req1.id, "user");

			const result = await api.listApprovals();
			expect(result.stats).toBeDefined();
			expect(result.stats.total).toBe(2);
			expect(result.stats.pending).toBe(1);
			expect(result.stats.approved).toBe(1);
			expect(result.stats.rejected).toBe(0);
		});
	});

	// =======================================================================
	// AC 2: GET /api/brain/approvals/{id} - get single
	// =======================================================================

	describe("AC 2: getApproval — get single", () => {
		it("returns the approval request by ID", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const found = await api.getApproval(request.id);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(request.id);
			expect(found!.action).toBe("memory_modification");
			expect(found!.proposalId).toBe("proposal-001");
		});

		it("returns null for non-existent ID", async () => {
			const found = await api.getApproval("non-existent-id");
			expect(found).toBeNull();
		});

		it("returns the request even after it has been processed", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(request.id, "user");

			const found = await api.getApproval(request.id);
			expect(found).not.toBeNull();
			expect(found!.status).toBe("approved");
		});
	});

	// =======================================================================
	// AC 3: POST /api/brain/approvals/{id}/approve - approve
	// =======================================================================

	describe("AC 3: approveRequest — approve", () => {
		it("approves a pending request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const result = await api.approveRequest(request.id, "user");
			expect(result.success).toBe(true);
			expect(result.approval).toBeDefined();
			expect(result.approval!.status).toBe("approved");
			expect(result.approval!.approvedBy).toBe("user");
		});

		it("returns failure for non-existent request", async () => {
			const result = await api.approveRequest("non-existent-id", "user");
			expect(result.success).toBe(false);
			expect(result.message).toContain("not found");
		});

		it("returns failure for already processed request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(request.id, "user");

			const result = await api.approveRequest(request.id, "user");
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/Cannot approve a request with status/);
		});
	});

	// =======================================================================
	// AC 4: POST /api/brain/approvals/{id}/reject - reject with reason
	// =======================================================================

	describe("AC 4: rejectRequest — reject with reason", () => {
		it("rejects a pending request with reason", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const result = await api.rejectRequest(request.id, "user", "Too risky");
			expect(result.success).toBe(true);
			expect(result.approval).toBeDefined();
			expect(result.approval!.status).toBe("rejected");
			expect(result.approval!.rejectedBy).toBe("user");
			expect(result.approval!.rejectionReason).toBe("Too risky");
			expect(result.message).toContain("Too risky");
		});

		it("rejects a pending request without reason", async () => {
			// Override config to not require reason
			const customGate = new ApprovalGate(ledger, { requireReasonOnRejection: false }, join(tempDir, "requests-noreason.json"));
			await customGate.initialize();
			const customApi = new ApprovalQueueApi(customGate);

			const request = await customGate.requestApproval(makeContext(), makeRisk());
			const result = await customApi.rejectRequest(request.id, "user");
			expect(result.success).toBe(true);
			expect(result.approval!.status).toBe("rejected");

			customGate.stopExpiryCheck();
		});

		it("returns failure for non-existent request", async () => {
			const result = await api.rejectRequest("non-existent-id", "user", "Reason");
			expect(result.success).toBe(false);
			expect(result.message).toContain("not found");
		});
	});

	// =======================================================================
	// AC 5: POST /api/brain/approvals/{id}/defer - extend deadline
	// =======================================================================

	describe("AC 5: deferRequest — extend deadline", () => {
		it("defers a pending request (extends deadline)", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			const originalDeadline = request.deadline;

			// Small delay to ensure deadline changes
			await new Promise((r) => setTimeout(r, 5));

			const result = await api.deferRequest(request.id);
			expect(result.success).toBe(true);
			expect(result.approval).toBeDefined();
			expect(result.approval!.status).toBe("pending");
			expect(new Date(result.approval!.deadline).getTime()).toBeGreaterThan(
				new Date(originalDeadline).getTime(),
			);
		});

		it("defers with a custom new deadline", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const futureDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
			const result = await api.deferRequest(request.id, futureDeadline);
			expect(result.success).toBe(true);
			expect(result.approval!.deadline).toBe(futureDeadline);
		});

		it("returns failure for invalid deadline format", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const result = await api.deferRequest(request.id, "not-a-date");
			expect(result.success).toBe(false);
			expect(result.message).toContain("Invalid deadline format");
		});

		it("returns failure for past deadline", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const pastDeadline = new Date(Date.now() - 1000).toISOString();
			const result = await api.deferRequest(request.id, pastDeadline);
			expect(result.success).toBe(false);
			expect(result.message).toContain("future");
		});

		it("returns failure for non-existent request", async () => {
			const result = await api.deferRequest("non-existent-id");
			expect(result.success).toBe(false);
			expect(result.message).toContain("not found");
		});

		it("returns failure for already processed request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(request.id, "user");

			const result = await api.deferRequest(request.id);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/Cannot defer a request with status/);
		});
	});

	// =======================================================================
	// AC 6: GET /api/brain/approvals/stats - stats
	// =======================================================================

	describe("AC 6: getStats — stats", () => {
		it("returns zero stats when no approvals exist", async () => {
			const stats = await api.getStats();
			expect(stats.total).toBe(0);
			expect(stats.pending).toBe(0);
			expect(stats.approved).toBe(0);
			expect(stats.rejected).toBe(0);
			expect(stats.expired).toBe(0);
		});

		it("returns correct stats after various operations", async () => {
			const req1 = await gate.requestApproval(makeContext(), makeRisk());
			const req2 = await gate.requestApproval(
				makeAltContext("plan_execution", "proposal-002"),
				makeRisk({ level: "high" }),
			);
			const req3 = await gate.requestApproval(
				makeAltContext("memory_query", "proposal-003"),
				makeRisk({ level: "low" }),
			);

			await gate.approve(req1.id, "user");
			await gate.reject(req2.id, "user", "Not needed");

			const stats = await api.getStats();
			expect(stats.total).toBe(3);
			expect(stats.pending).toBe(1);
			expect(stats.approved).toBe(1);
			expect(stats.rejected).toBe(1);
			expect(stats.expired).toBe(0);
		});

		it("includes pendingByType breakdown", async () => {
			await gate.requestApproval(makeContext({ actionType: "memory_proposal" }), makeRisk());
			await gate.requestApproval(
				makeAltContext("plan_execution", "proposal-002"),
				makeRisk({ level: "high" }),
			);

			const stats = await api.getStats();
			expect(stats.pendingByType).toBeDefined();
			expect(Object.keys(stats.pendingByType).length).toBeGreaterThanOrEqual(1);
		});
	});

	// =======================================================================
	// AC 7: GET /api/brain/approvals/history - completed approvals
	// =======================================================================

	describe("AC 7: getHistory — completed approvals", () => {
		it("returns empty history when no approvals are completed", async () => {
			const result = await api.getHistory();
			expect(result.approvals).toHaveLength(0);
			expect(result.total).toBe(0);
		});

		it("returns completed approvals (approved + rejected + expired)", async () => {
			const req1 = await gate.requestApproval(makeContext(), makeRisk());
			const req2 = await gate.requestApproval(
				makeAltContext("plan_execution", "proposal-002"),
				makeRisk({ level: "high" }),
			);
			const req3 = await gate.requestApproval(
				makeAltContext("memory_query", "proposal-003"),
				makeRisk({ level: "low" }),
			);

			await gate.approve(req1.id, "user");
			await gate.reject(req2.id, "user", "Not needed");

			// Pending request should NOT be in history
			const result = await api.getHistory();
			expect(result.total).toBe(2);
			expect(result.approvals.some((a) => a.id === req1.id)).toBe(true);
			expect(result.approvals.some((a) => a.id === req2.id)).toBe(true);
			expect(result.approvals.some((a) => a.id === req3.id)).toBe(false);
		});

		it("sorts history most recent first", async () => {
			const req1 = await gate.requestApproval(makeContext(), makeRisk());
			await new Promise((r) => setTimeout(r, 10));
			const req2 = await gate.requestApproval(
				makeAltContext("plan_execution", "proposal-002"),
				makeRisk({ level: "high" }),
			);

			await gate.approve(req1.id, "user");
			await new Promise((r) => setTimeout(r, 10));
			await gate.approve(req2.id, "admin");

			const result = await api.getHistory();
			expect(result.total).toBe(2);
			// Most recent should be first
			expect(result.approvals[0].id).toBe(req2.id);
			expect(result.approvals[1].id).toBe(req1.id);
		});

		it("respects limit and offset", async () => {
			for (let i = 1; i <= 5; i++) {
				const req = await gate.requestApproval(
					makeAltContext(`action_${i}`, `proposal-${String(i).padStart(3, "0")}`),
					makeRisk(),
				);
				await gate.approve(req.id, "user");
			}

			const first = await api.getHistory({ limit: 2, offset: 0 });
			expect(first.approvals).toHaveLength(2);
			expect(first.total).toBe(5);

			const second = await api.getHistory({ limit: 3, offset: 2 });
			expect(second.approvals).toHaveLength(3);
			expect(second.total).toBe(5);
		});

		it("filters by since date", async () => {
			const req1 = await gate.requestApproval(makeContext(), makeRisk());
			await new Promise((r) => setTimeout(r, 50));
			const timestamp = new Date().toISOString();
			await new Promise((r) => setTimeout(r, 50));
			const req2 = await gate.requestApproval(
				makeAltContext("plan_execution", "proposal-002"),
				makeRisk({ level: "high" }),
			);

			await gate.approve(req1.id, "user");
			await gate.approve(req2.id, "admin");

			// Should only include requests processed after timestamp
			const result = await api.getHistory({ since: timestamp });
			// Since we filter by processedAt (approvedAt/rejectedAt), not requestedAt,
			// both were approved after the timestamp
			expect(result.total).toBe(2);
		});

		it("filters by until date", async () => {
			const req = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(req.id, "user");

			const beforeTimestamp = new Date(Date.now() - 60000).toISOString();
			const result = await api.getHistory({ until: beforeTimestamp });
			expect(result.total).toBe(0);
		});
	});
});
