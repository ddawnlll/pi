/**
 * Approval Gate — P18.C — Tests
 *
 * Acceptance Criteria:
 * 1. ApprovalRequest created from policy decision
 * 2. Approve sets status to approved, logs audit entry
 * 3. Reject sets status to rejected, logs audit entry with reason
 * 4. Defer extends deadline
 * 5. Auto-expire after deadline
 * 6. Query pending, approved, rejected, expired
 * 7. Persistence survives restart
 */

import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalGate, createApprovalGate } from "../../../src/brain/approvals/gate.js";
import type { AuditEntry } from "../../../src/brain/audit/ledger.js";
import type {
	ApprovalConfig,
	ApprovalRequest,
	PolicyContext,
	ProposalRiskAssessment,
} from "../../../src/brain/policy/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "approval-gate-test-"));
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

describe("ApprovalGate", () => {
	let gate: ApprovalGate;
	let ledger: MockAuditLedger;
	let tempDir: string;
	let persistencePath: string;

	beforeEach(async () => {
		tempDir = createTempDir();
		persistencePath = join(tempDir, "requests.json");
		ledger = new MockAuditLedger();
		gate = createApprovalGate(ledger, undefined, persistencePath);
		await gate.initialize();
	});

	afterEach(async () => {
		gate.stopExpiryCheck();
		await rm(tempDir, { recursive: true, force: true });
	});

	// =======================================================================
	// AC 1: ApprovalRequest created from policy decision
	// =======================================================================

	describe("AC 1: ApprovalRequest creation", () => {
		it("creates an approval request from context and risk assessment", async () => {
			const context = makeContext();
			const risk = makeRisk();

			const request = await gate.requestApproval(context, risk);

			expect(request).toBeDefined();
			expect(request.id).toBeTruthy();
			expect(request.proposalId).toBe("proposal-001");
			expect(request.action).toBe("memory_modification");
			expect(request.rationale).toBe("Cleaning up stale memory entries");
			expect(request.status).toBe("pending");
			expect(request.requestedBy).toBe("pi");
			expect(request.policyRuleId).toBe("rule-appr-001");
			expect(new Date(request.deadline).getTime()).toBeGreaterThan(new Date(request.requestedAt).getTime());
		});

		it("creates a request with the correct risk assessment", async () => {
			const context = makeContext();
			const risk = makeRisk({ level: "high", score: 0.85 });

			const request = await gate.requestApproval(context, risk);

			expect(request.risk.level).toBe("high");
			expect(request.risk.score).toBe(0.85);
			expect(request.risk.factors).toContain("memory inconsistency");
			expect(request.risk.description).toBeTruthy();
		});

		it("creates a request in pending state", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			expect(request.status).toBe("pending");

			const pending = gate.getPending();
			expect(pending).toHaveLength(1);
			expect(pending[0].id).toBe(request.id);
		});

		it("sets deadline to approximately defaultDeadlineHours from now", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const requestedAt = new Date(request.requestedAt).getTime();
			const deadline = new Date(request.deadline).getTime();
			const diffHours = (deadline - requestedAt) / (1000 * 60 * 60);

			// Should be within ~24 hours (allow small tolerance for test execution)
			expect(diffHours).toBeGreaterThanOrEqual(23.9);
			expect(diffHours).toBeLessThanOrEqual(24.1);
		});

		it("throws when too many pending requests exist for the same type", async () => {
			const config: Partial<ApprovalConfig> = { maxPendingPerType: 2 };
			const customGate = createApprovalGate(ledger, config, join(tempDir, "requests-cap.json"));
			await customGate.initialize();

			// Create 2 requests (should succeed)
			await customGate.requestApproval(makeContext({ actionType: "memory_proposal" }), makeRisk());
			await customGate.requestApproval(makeContext({ actionType: "memory_proposal" }), makeRisk());

			// 3rd request for same type should throw
			await expect(
				customGate.requestApproval(makeContext({ actionType: "memory_proposal" }), makeRisk()),
			).rejects.toThrow("Too many pending approval requests");

			customGate.stopExpiryCheck();
		});

		it("allows requests for different types independently", async () => {
			const config: Partial<ApprovalConfig> = { maxPendingPerType: 1 };
			const customGate = createApprovalGate(ledger, config, join(tempDir, "requests-types.json"));
			await customGate.initialize();

			// Create requests for different types
			await customGate.requestApproval(
				makeContext({ actionType: "memory_proposal", action: "memory_modification" }),
				makeRisk(),
			);
			await customGate.requestApproval(
				makeContext({ actionType: "plan_proposal", action: "plan_execution" }),
				makeRisk(),
			);

			expect(customGate.getPending()).toHaveLength(2);

			customGate.stopExpiryCheck();
		});

		it("sets requestedBy from context actor", async () => {
			const piRequest = await gate.requestApproval(makeContext({ actor: "pi" }), makeRisk());
			expect(piRequest.requestedBy).toBe("pi");

			const userRequest = await gate.requestApproval(makeContext({ actor: "user" }), makeRisk());
			expect(userRequest.requestedBy).toBe("user");
		});
	});

	// =======================================================================
	// AC 2: Approve sets status to approved, logs audit entry
	// =======================================================================

	describe("AC 2: Approve", () => {
		it("approves a pending request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const approved = await gate.approve(request.id, "test-user");

			expect(approved.status).toBe("approved");
			expect(approved.approvedBy).toBe("test-user");
			expect(approved.approvedAt).toBeTruthy();
			expect(approved.approvedAt).toBeDefined();
		});

		it("moves request from pending to history on approve", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			expect(gate.getPending()).toHaveLength(1);
			expect(gate.getApproved()).toHaveLength(0);

			await gate.approve(request.id, "test-user");

			expect(gate.getPending()).toHaveLength(0);
			expect(gate.getApproved()).toHaveLength(1);
			expect(gate.getApproved()[0].id).toBe(request.id);
		});

		it("logs an audit entry on approval", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			expect(ledger.entries).toHaveLength(0);

			await gate.approve(request.id, "test-user");

			expect(ledger.entries).toHaveLength(1);
			const entry = ledger.entries[0];
			expect(entry.action).toBe("approve:memory_modification");
			expect(entry.decision).toBe("allow");
			expect(entry.result).toBe("success");
			expect(entry.actor).toBe("user");
			expect(entry.approvalRequestId).toBe(request.id);
			expect(entry.proposalId).toBe("proposal-001");
		});

		it("throws when approving a non-existent request", async () => {
			await expect(gate.approve("non-existent-id", "test-user")).rejects.toThrow(
				'Approval request "non-existent-id" not found or already processed',
			);
		});

		it("throws when approving an already approved request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(request.id, "user-a");

			await expect(gate.approve(request.id, "user-b")).rejects.toThrow(
				`Approval request "${request.id}" not found or already processed`,
			);
		});

		it("records the approver name correctly", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			const approved = await gate.approve(request.id, "admin-user");
			expect(approved.approvedBy).toBe("admin-user");
		});
	});

	// =======================================================================
	// AC 3: Reject sets status to rejected, logs audit entry with reason
	// =======================================================================

	describe("AC 3: Reject", () => {
		it("rejects a pending request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const rejected = await gate.reject(request.id, "test-user", "Not needed at this time");

			expect(rejected.status).toBe("rejected");
			expect(rejected.rejectedBy).toBe("test-user");
			expect(rejected.rejectedAt).toBeTruthy();
			expect(rejected.rejectionReason).toBe("Not needed at this time");
		});

		it("moves request from pending to history on reject", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			expect(gate.getPending()).toHaveLength(1);
			expect(gate.getRejected()).toHaveLength(0);

			await gate.reject(request.id, "test-user", "Not needed");

			expect(gate.getPending()).toHaveLength(0);
			expect(gate.getRejected()).toHaveLength(1);
			expect(gate.getRejected()[0].id).toBe(request.id);
		});

		it("logs an audit entry on rejection", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			expect(ledger.entries).toHaveLength(0);

			await gate.reject(request.id, "test-user", "Risky action");

			expect(ledger.entries).toHaveLength(1);
			const entry = ledger.entries[0];
			expect(entry.action).toBe("reject:memory_modification");
			expect(entry.decision).toBe("deny");
			expect(entry.result).toBe("blocked");
			expect(entry.actor).toBe("user");
			expect(entry.metadata.reason).toBe("Risky action");
		});

		it("requires a reason when configured", async () => {
			const config: Partial<ApprovalConfig> = { requireReasonOnRejection: true };
			const customGate = createApprovalGate(ledger, config, join(tempDir, "requests-reqreason.json"));
			await customGate.initialize();

			const request = await customGate.requestApproval(makeContext(), makeRisk());

			await expect(customGate.reject(request.id, "test-user")).rejects.toThrow("Rejection reason is required");

			customGate.stopExpiryCheck();
		});

		it("allows rejection without reason when configured", async () => {
			const config: Partial<ApprovalConfig> = { requireReasonOnRejection: false };
			const customGate = createApprovalGate(ledger, config, join(tempDir, "requests-noreason.json"));
			await customGate.initialize();

			const request = await customGate.requestApproval(makeContext(), makeRisk());
			const rejected = await customGate.reject(request.id, "test-user");
			expect(rejected.status).toBe("rejected");
			expect(rejected.rejectionReason).toBeUndefined();

			customGate.stopExpiryCheck();
		});

		it("throws when rejecting a non-existent request", async () => {
			await expect(gate.reject("non-existent-id", "test-user", "reason")).rejects.toThrow(
				'Approval request "non-existent-id" not found or already processed',
			);
		});

		it("stores rejection reason in audit entry metadata", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.reject(request.id, "reviewer", "Conflicts with existing goals");

			expect(ledger.entries).toHaveLength(1);
			expect(ledger.entries[0].metadata.reason).toBe("Conflicts with existing goals");
		});
	});

	// =======================================================================
	// AC 4: Defer extends deadline
	// =======================================================================

	describe("AC 4: Defer", () => {
		it("extends the deadline of a pending request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			const originalDeadline = request.deadline;

			// Defer by 48 hours
			const deferred = await gate.defer(request.id, 48);
			const newDeadline = new Date(deferred.deadline).getTime();
			const originalDeadlineMs = new Date(originalDeadline).getTime();

			expect(newDeadline).toBeGreaterThan(originalDeadlineMs);
		});

		it("keeps request in pending status after defer", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			const deferred = await gate.defer(request.id, 12);
			expect(deferred.status).toBe("pending");
		});

		it("uses default deadline hours when none specified", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			const deferred = await gate.defer(request.id);
			const newDeadline = new Date(deferred.deadline).getTime();

			// Should be set to approximately 24h from now
			const expectedMin = Date.now() + 23.9 * 60 * 60 * 1000;
			const expectedMax = Date.now() + 24.1 * 60 * 60 * 1000;
			expect(newDeadline).toBeGreaterThanOrEqual(expectedMin);
			expect(newDeadline).toBeLessThanOrEqual(expectedMax);
		});

		it("throws when deferring a non-existent request", async () => {
			await expect(gate.defer("non-existent-id")).rejects.toThrow(
				'Approval request "non-existent-id" not found or already processed',
			);
		});

		it("throws when deferring an already processed request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(request.id, "user");

			await expect(gate.defer(request.id)).rejects.toThrow("not found or already processed");
		});

		it("throws when deferring a rejected request", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.reject(request.id, "user", "reason");

			await expect(gate.defer(request.id)).rejects.toThrow("not found or already processed");
		});
	});

	// =======================================================================
	// AC 5: Auto-expire after deadline
	// =======================================================================

	describe("AC 5: Auto-expire", () => {
		it("expires a request past its deadline", async () => {
			// Create a request with a deadline in the past
			const context = makeContext({ metadata: { rationale: "test" } });
			const request = await gate.requestApproval(context, makeRisk());

			// Manually set the deadline to the past
			const pastDeadline = new Date(Date.now() - 1000).toISOString();
			const requestWithPastDeadline = gate.getById(request.id)!;
			// Direct manipulation for testing
			(requestWithPastDeadline as ApprovalRequest).deadline = pastDeadline;

			const expired = await gate.checkExpired();

			expect(expired).toHaveLength(1);
			expect(expired[0].id).toBe(request.id);
			expect(expired[0].status).toBe("expired");
		});

		it("moves expired requests to history", async () => {
			const context = makeContext({ metadata: { rationale: "test" } });
			const request = await gate.requestApproval(context, makeRisk());

			// Set deadline to the past
			const storedRequest = gate.getById(request.id)!;
			(storedRequest as ApprovalRequest).deadline = new Date(Date.now() - 1000).toISOString();

			await gate.checkExpired();

			expect(gate.getPending()).toHaveLength(0);
			expect(gate.getExpired()).toHaveLength(1);
		});

		it("does not expire requests with future deadlines", async () => {
			const context = makeContext({ metadata: { rationale: "test" } });
			await gate.requestApproval(context, makeRisk());

			const expired = await gate.checkExpired();
			expect(expired).toHaveLength(0);
			expect(gate.getPending()).toHaveLength(1);
		});

		it("does not expire already approved requests", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(request.id, "user");

			const expired = await gate.checkExpired();
			expect(expired).toHaveLength(0);
			expect(gate.getApproved()).toHaveLength(1);
		});

		it("does not expire already rejected requests", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.reject(request.id, "user", "reason");

			const expired = await gate.checkExpired();
			expect(expired).toHaveLength(0);
			expect(gate.getRejected()).toHaveLength(1);
		});

		it("expires multiple past-deadline requests", async () => {
			// Create two requests
			const req1 = await gate.requestApproval(makeContext({ metadata: { rationale: "r1" } }), makeRisk());
			const req2 = await gate.requestApproval(makeContext({ metadata: { rationale: "r2" } }), makeRisk());

			// Set both deadlines to the past
			const past = new Date(Date.now() - 1000).toISOString();
			(gate.getById(req1.id)! as ApprovalRequest).deadline = past;
			(gate.getById(req2.id)! as ApprovalRequest).deadline = past;

			const expired = await gate.checkExpired();
			expect(expired).toHaveLength(2);
		});
	});

	// =======================================================================
	// AC 6: Query pending, approved, rejected, expired
	// =======================================================================

	describe("AC 6: Queries", () => {
		it("getPending returns only pending requests", async () => {
			const req1 = await gate.requestApproval(makeContext({ metadata: { rationale: "r1" } }), makeRisk());
			const req2 = await gate.requestApproval(makeContext({ metadata: { rationale: "r2" } }), makeRisk());

			expect(gate.getPending()).toHaveLength(2);

			await gate.approve(req1.id, "user");

			const pending = gate.getPending();
			expect(pending).toHaveLength(1);
			expect(pending[0].id).toBe(req2.id);
		});

		it("getApproved returns only approved requests", async () => {
			const req1 = await gate.requestApproval(makeContext({ metadata: { rationale: "r1" } }), makeRisk());
			await gate.requestApproval(makeContext({ metadata: { rationale: "r2" } }), makeRisk());

			await gate.approve(req1.id, "user");

			const approved = gate.getApproved();
			expect(approved).toHaveLength(1);
			expect(approved[0].id).toBe(req1.id);
		});

		it("getRejected returns only rejected requests", async () => {
			await gate.requestApproval(makeContext({ metadata: { rationale: "r1" } }), makeRisk());
			const req2 = await gate.requestApproval(makeContext({ metadata: { rationale: "r2" } }), makeRisk());

			await gate.reject(req2.id, "user", "reason");

			const rejected = gate.getRejected();
			expect(rejected).toHaveLength(1);
			expect(rejected[0].id).toBe(req2.id);
		});

		it("getExpired returns only expired requests", async () => {
			const req = await gate.requestApproval(makeContext({ metadata: { rationale: "r1" } }), makeRisk());

			// Set deadline to the past
			(gate.getById(req.id)! as ApprovalRequest).deadline = new Date(Date.now() - 1000).toISOString();
			await gate.checkExpired();

			expect(gate.getExpired()).toHaveLength(1);
			expect(gate.getExpired()[0].id).toBe(req.id);
		});

		it("getById returns request from pending or history", async () => {
			const pending = await gate.requestApproval(makeContext({ metadata: { rationale: "pending" } }), makeRisk());
			expect(gate.getById(pending.id)).toBeDefined();
			expect(gate.getById(pending.id)!.status).toBe("pending");

			const approved = await gate.requestApproval(makeContext({ metadata: { rationale: "approved" } }), makeRisk());
			await gate.approve(approved.id, "user");
			expect(gate.getById(approved.id)).toBeDefined();
			expect(gate.getById(approved.id)!.status).toBe("approved");
		});

		it("getById returns null for unknown id", async () => {
			expect(gate.getById("non-existent")).toBeNull();
		});

		it("getByProposal returns all requests for a proposal", async () => {
			const ctx1 = makeContext({ proposalId: "proposal-A" });
			const ctx2 = makeContext({ proposalId: "proposal-B" });

			const reqA1 = await gate.requestApproval(ctx1, makeRisk());
			const reqA2 = await gate.requestApproval(ctx1, makeRisk());
			await gate.requestApproval(ctx2, makeRisk());

			const forA = gate.getByProposal("proposal-A");
			expect(forA).toHaveLength(2);
			expect(forA.map((r) => r.id)).toContain(reqA1.id);
			expect(forA.map((r) => r.id)).toContain(reqA2.id);
		});

		it("getByProposal returns requests across pending and history", async () => {
			const ctx = makeContext({ proposalId: "proposal-C" });

			const req1 = await gate.requestApproval(ctx, makeRisk());
			await gate.requestApproval(ctx, makeRisk());

			await gate.approve(req1.id, "user");

			const results = gate.getByProposal("proposal-C");
			expect(results).toHaveLength(2);
		});

		it("getByProposal returns empty array for unknown proposal", async () => {
			expect(gate.getByProposal("unknown-proposal")).toHaveLength(0);
		});
	});

	// =======================================================================
	// AC 7: Persistence survives restart
	// =======================================================================

	describe("AC 7: Persistence", () => {
		it("persists pending requests and restores them", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());

			// Create a new gate with the same persistence path
			const gate2 = createApprovalGate(new MockAuditLedger(), undefined, persistencePath);
			await gate2.initialize();

			expect(gate2.getPending()).toHaveLength(1);
			expect(gate2.getPending()[0].id).toBe(request.id);
			expect(gate2.getPending()[0].status).toBe("pending");

			gate2.stopExpiryCheck();
		});

		it("persists approved requests and restores them", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.approve(request.id, "user");

			// Create a new gate with the same persistence path
			const gate2 = createApprovalGate(new MockAuditLedger(), undefined, persistencePath);
			await gate2.initialize();

			expect(gate2.getPending()).toHaveLength(0);
			expect(gate2.getApproved()).toHaveLength(1);
			expect(gate2.getApproved()[0].id).toBe(request.id);
			expect(gate2.getApproved()[0].approvedBy).toBe("user");

			gate2.stopExpiryCheck();
		});

		it("persists rejected requests and restores them", async () => {
			const request = await gate.requestApproval(makeContext(), makeRisk());
			await gate.reject(request.id, "reviewer", "Not appropriate");

			const gate2 = createApprovalGate(new MockAuditLedger(), undefined, persistencePath);
			await gate2.initialize();

			expect(gate2.getRejected()).toHaveLength(1);
			expect(gate2.getRejected()[0].rejectionReason).toBe("Not appropriate");

			gate2.stopExpiryCheck();
		});

		it("persists mixed state and restores correctly", async () => {
			const ctx1 = makeContext({ proposalId: "p1", metadata: { rationale: "r1" } });
			const ctx2 = makeContext({ proposalId: "p2", metadata: { rationale: "r2" } });
			const ctx3 = makeContext({ proposalId: "p3", metadata: { rationale: "r3" } });

			const req1 = await gate.requestApproval(ctx1, makeRisk()); // will be approved
			const req2 = await gate.requestApproval(ctx2, makeRisk()); // will be rejected
			await gate.requestApproval(ctx3, makeRisk()); // stays pending

			await gate.approve(req1.id, "admin");
			await gate.reject(req2.id, "admin", "Out of scope");

			const gate2 = createApprovalGate(new MockAuditLedger(), undefined, persistencePath);
			await gate2.initialize();

			expect(gate2.getPending()).toHaveLength(1);
			expect(gate2.getApproved()).toHaveLength(1);
			expect(gate2.getRejected()).toHaveLength(1);
			expect(gate2.getExpired()).toHaveLength(0);

			gate2.stopExpiryCheck();
		});
	});

	// =======================================================================
	// Stats
	// =======================================================================

	describe("getStats", () => {
		it("returns zero stats for empty gate", async () => {
			const stats = gate.getStats();
			expect(stats.total).toBe(0);
			expect(stats.pending).toBe(0);
			expect(stats.approved).toBe(0);
			expect(stats.rejected).toBe(0);
			expect(stats.expired).toBe(0);
			expect(stats.avgResponseTimeMs).toBe(0);
		});

		it("returns correct counts after operations", async () => {
			const req1 = await gate.requestApproval(makeContext({ metadata: { rationale: "r1" } }), makeRisk());
			const req2 = await gate.requestApproval(makeContext({ metadata: { rationale: "r2" } }), makeRisk());
			await gate.requestApproval(makeContext({ metadata: { rationale: "r3" } }), makeRisk());

			await gate.approve(req1.id, "user");
			await gate.reject(req2.id, "user", "reason");

			const stats = gate.getStats();
			expect(stats.total).toBe(3);
			expect(stats.pending).toBe(1);
			expect(stats.approved).toBe(1);
			expect(stats.rejected).toBe(1);
			expect(stats.expired).toBe(0);
		});

		it("computes pendingByType correctly", async () => {
			await gate.requestApproval(makeContext({ actionType: "memory_proposal" }), makeRisk());
			await gate.requestApproval(makeContext({ actionType: "memory_proposal" }), makeRisk());
			await gate.requestApproval(makeContext({ actionType: "plan_proposal" }), makeRisk());

			const stats = gate.getStats();
			expect(stats.pendingByType).toEqual({
				memory_proposal: 2,
				plan_proposal: 1,
			});
		});

		it("computes avgResponseTimeMs for completed requests", async () => {
			// Use fake timers to ensure elapsed time is measurable
			vi.useFakeTimers();

			const gate2 = createApprovalGate(new MockAuditLedger(), undefined, join(tempDir, "requests-timing.json"));
			await gate2.initialize();

			const req1 = await gate2.requestApproval(makeContext({ metadata: { rationale: "r1" } }), makeRisk());
			const req2 = await gate2.requestApproval(makeContext({ metadata: { rationale: "r2" } }), makeRisk());

			// Advance time by 1 hour
			vi.advanceTimersByTime(3600000);

			await gate2.approve(req1.id, "user");
			await gate2.reject(req2.id, "user", "reason");

			const stats = gate2.getStats();
			expect(stats.avgResponseTimeMs).toBeGreaterThanOrEqual(3600000);

			gate2.stopExpiryCheck();
			vi.useRealTimers();
		});
	});

	// =======================================================================
	// Configuration
	// =======================================================================

	describe("Configuration", () => {
		it("getConfig returns current config", () => {
			const config = gate.getConfig();
			expect(config.defaultDeadlineHours).toBe(24);
			expect(config.autoExpireCheckIntervalMs).toBe(3600000);
			expect(config.requireReasonOnRejection).toBe(true);
			expect(config.maxPendingPerType).toBe(10);
		});

		it("setConfig merges with existing config", () => {
			gate.setConfig({ maxPendingPerType: 5, requireReasonOnRejection: false });

			const config = gate.getConfig();
			expect(config.maxPendingPerType).toBe(5);
			expect(config.requireReasonOnRejection).toBe(false);
			expect(config.defaultDeadlineHours).toBe(24); // unchanged
		});

		it("can be constructed with custom config", () => {
			const customLedger = new MockAuditLedger();
			const customGate = createApprovalGate(customLedger, {
				defaultDeadlineHours: 48,
				maxPendingPerType: 3,
			});

			const config = customGate.getConfig();
			expect(config.defaultDeadlineHours).toBe(48);
			expect(config.maxPendingPerType).toBe(3);

			customGate.stopExpiryCheck();
		});
	});

	// =======================================================================
	// Error Handling
	// =======================================================================

	describe("Error handling", () => {
		it("handles missing persistence file gracefully", async () => {
			const gate2 = createApprovalGate(new MockAuditLedger(), undefined, "/nonexistent/path/requests.json");
			await expect(gate2.initialize()).resolves.not.toThrow();
			gate2.stopExpiryCheck();
		});

		it("handles corrupted persistence file gracefully", async () => {
			// Write invalid JSON to the persistence file
			await writeFile(persistencePath, "not valid json", "utf-8");

			const gate2 = createApprovalGate(new MockAuditLedger(), undefined, persistencePath);
			await expect(gate2.initialize()).resolves.not.toThrow();
			expect(gate2.getPending()).toHaveLength(0);

			gate2.stopExpiryCheck();
		});
	});

	// =======================================================================
	// Lifecycle
	// =======================================================================

	describe("Lifecycle", () => {
		it("dispose saves state and stops expiry check", async () => {
			await gate.requestApproval(makeContext(), makeRisk());
			await gate.dispose();

			// Verify state was saved to disk
			const content = await readFile(persistencePath, "utf-8");
			const data = JSON.parse(content);
			expect(data.pending).toHaveLength(1);
		});
	});

	// =======================================================================
	// Factory
	// =======================================================================

	describe("Factory", () => {
		it("createApprovalGate creates gate with defaults", () => {
			const g = createApprovalGate(new MockAuditLedger());
			expect(g).toBeInstanceOf(ApprovalGate);
			expect(g.getConfig().defaultDeadlineHours).toBe(24);
			g.stopExpiryCheck();
		});

		it("createApprovalGate accepts custom config", () => {
			const g = createApprovalGate(new MockAuditLedger(), { defaultDeadlineHours: 48 });
			expect(g.getConfig().defaultDeadlineHours).toBe(48);
			g.stopExpiryCheck();
		});
	});
});
