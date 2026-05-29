/**
 * BrainProposalApi tests — P16.F
 */

import { beforeEach, describe, expect, it } from "vitest";
import { BrainProposalApi, proposalToCard } from "../../../src/brain/proposals/api.js";
import { ProposalDeduplication } from "../../../src/brain/proposals/dedup.js";
import { InMemoryProposalStore } from "../../../src/brain/proposals/store.js";
import {
	createProposal,
	createProposalCreateInput,
	type ProposalCreateInput,
	type ProposalEvidence,
	type ProposalRiskAssessment,
} from "../../../src/brain/proposals/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides?: Partial<ProposalEvidence>): ProposalEvidence {
	return {
		memoryIds: overrides?.memoryIds ?? ["mem-001"],
		observationIds: overrides?.observationIds ?? [],
		sourceRefs: overrides?.sourceRefs ?? [],
		confidence: overrides?.confidence ?? 0.8,
		evidenceSummary: overrides?.evidenceSummary ?? "Test evidence summary",
	};
}

function makeRisk(overrides?: Partial<ProposalRiskAssessment>): ProposalRiskAssessment {
	return {
		level: overrides?.level ?? "low",
		factors: overrides?.factors ?? ["factor-1"],
		mitigation: overrides?.mitigation ?? ["mitigation-1"],
		affectedSystems: overrides?.affectedSystems ?? ["system-a"],
		impactDescription: overrides?.impactDescription ?? "Low impact",
	};
}

function makeInput(overrides?: Partial<ProposalCreateInput>): ProposalCreateInput {
	return createProposalCreateInput({
		type: overrides?.type ?? "memory_proposal",
		title: overrides?.title ?? "Test proposal",
		description: overrides?.description ?? "A test proposal",
		whyNow: overrides?.whyNow,
		expectedImpact: overrides?.expectedImpact,
		evidence: overrides?.evidence ?? makeEvidence(),
		risk: overrides?.risk ?? makeRisk(),
		score: overrides?.score,
		draftAvailable: overrides?.draftAvailable,
		approvalRequired: overrides?.approvalRequired,
		relatedGoalIds: overrides?.relatedGoalIds,
		tags: overrides?.tags,
		metadata: overrides?.metadata,
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BrainProposalApi", () => {
	let store: InMemoryProposalStore;
	let api: BrainProposalApi;

	beforeEach(() => {
		store = new InMemoryProposalStore();
		api = new BrainProposalApi(store);
	});

	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	it("creates a proposal and transitions to pending_approval", async () => {
		const result = await api.createProposal(makeInput());
		expect(result.success).toBe(true);
		expect(result.proposal).toBeDefined();
		expect(result.proposal!.status).toBe("pending_approval");
	});

	it("rejects duplicate proposals", async () => {
		const input = makeInput();
		const first = await api.createProposal(input);
		expect(first.success).toBe(true);
		const dup = await api.createProposal(input);
		expect(dup.success).toBe(false);
		expect(dup.isDuplicate).toBe(true);
	});

	it("lists proposals", async () => {
		await api.createProposal(makeInput({ title: "A", evidence: makeEvidence({ memoryIds: ["mem-a"] }) }));
		await api.createProposal(makeInput({ title: "B", evidence: makeEvidence({ memoryIds: ["mem-b"] }) }));
		const list = await api.listProposals();
		expect(list).toHaveLength(2);
	});

	it("gets a proposal by ID", async () => {
		const created = await api.createProposal(makeInput());
		const found = await api.getProposal(created.proposal!.id);
		expect(found).not.toBeNull();
		expect(found!.title).toBe("Test proposal");
	});

	it("returns null for non-existent proposal", async () => {
		const found = await api.getProposal("non-existent");
		expect(found).toBeNull();
	});

	it("updates a proposal", async () => {
		const created = await api.createProposal(makeInput());
		const updated = await api.updateProposal(created.proposal!.id, { status: "approved" });
		expect(updated).not.toBeNull();
		expect(updated!.status).toBe("approved");
	});

	it("deletes a proposal", async () => {
		const created = await api.createProposal(makeInput());
		const deleted = await api.deleteProposal(created.proposal!.id);
		expect(deleted).toBe(true);
		const found = await api.getProposal(created.proposal!.id);
		expect(found).toBeNull();
	});

	it("returns false when deleting non-existent proposal", async () => {
		const deleted = await api.deleteProposal("non-existent");
		expect(deleted).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Accept / Reject
	// -----------------------------------------------------------------------

	it("accepts a proposal", async () => {
		const created = await api.createProposal(makeInput());
		const result = await api.acceptProposal(created.proposal!.id, "user");
		expect(result.success).toBe(true);
		expect(result.proposal.status).toBe("approved");
		expect(result.proposal.approvedBy).toBe("user");
	});

	it("rejects accept on non-existent proposal", async () => {
		const result = await api.acceptProposal("non-existent");
		expect(result.success).toBe(false);
	});

	it("rejects a proposal", async () => {
		const created = await api.createProposal(makeInput());
		const result = await api.rejectProposal(created.proposal!.id, "user", "Not needed");
		expect(result.success).toBe(true);
		expect(result.proposal.status).toBe("rejected");
		expect(result.proposal.rejectedBy).toBe("user");
		expect(result.proposal.rejectionReason).toBe("Not needed");
	});

	it("rejects reject on non-existent proposal", async () => {
		const result = await api.rejectProposal("non-existent");
		expect(result.success).toBe(false);
	});

	it("can reject an already approved proposal (V5.08 AC2: user may change mind)", async () => {
		const created = await api.createProposal(makeInput());
		await api.acceptProposal(created.proposal!.id);
		const result = await api.rejectProposal(created.proposal!.id);
		expect(result.success).toBe(true);
		expect(result.proposal.status).toBe("rejected");
	});

	// -----------------------------------------------------------------------
	// Correct / Expire
	// -----------------------------------------------------------------------

	it("corrects a pending proposal", async () => {
		const created = await api.createProposal(makeInput({ title: "Old title" }));
		const result = await api.correctProposal(created.proposal!.id, {
			title: "New title",
			description: "Updated description",
		});
		expect(result.success).toBe(true);
		expect(result.proposal.title).toBe("New title");
	});

	it("expires a proposal", async () => {
		const created = await api.createProposal(makeInput());
		const result = await api.expireProposal(created.proposal!.id);
		expect(result.success).toBe(true);
		expect(result.proposal.status).toBe("expired");
	});

	it("cannot expire already expired proposal", async () => {
		const created = await api.createProposal(makeInput());
		await api.expireProposal(created.proposal!.id);
		const result = await api.expireProposal(created.proposal!.id);
		expect(result.success).toBe(true); // already expired is idempotent
	});

	// -----------------------------------------------------------------------
	// Inbox
	// -----------------------------------------------------------------------

	it("returns empty inbox when no proposals", async () => {
		const inbox = await api.getInbox();
		expect(inbox.entries).toHaveLength(0);
		expect(inbox.totalPending).toBe(0);
	});

	it("returns inbox with pending proposals", async () => {
		const created = await api.createProposal(makeInput());
		// After create, proposal should be pending_approval
		await store.update(created.proposal!.id, { status: "pending_approval" });
		const inbox = await api.getInbox();
		expect(inbox.entries.length).toBeGreaterThanOrEqual(1);
		expect(inbox.totalPending).toBeGreaterThanOrEqual(1);
	});

	it("returns inbox stats", async () => {
		const created = await api.createProposal(makeInput());
		await store.update(created.proposal!.id, { status: "pending_approval" });
		// Score is 0, so it won't auto-approve
		const stats = await api.getInboxStats();
		expect(stats.totalPending).toBeGreaterThanOrEqual(1);
	});

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	it("returns aggregate stats", async () => {
		await api.createProposal(makeInput({ type: "memory_proposal" }));
		await api.createProposal(makeInput({ type: "plan_proposal" }));
		const stats = await api.getStats();
		expect(stats.totalProposals).toBe(2);
	});

	// -----------------------------------------------------------------------
	// Evidence
	// -----------------------------------------------------------------------

	it("returns evidence detail for a proposal", async () => {
		const created = await api.createProposal(makeInput());
		const evidence = await api.getEvidence(created.proposal!.id);
		expect(evidence).not.toBeNull();
		expect(evidence!.evidence.evidenceSummary).toBe("Test evidence summary");
		expect(evidence!.evidence.memoryIds).toEqual(["mem-001"]);
		expect(evidence!.risk.level).toBe("low");
	});

	it("returns null for non-existent proposal evidence", async () => {
		const evidence = await api.getEvidence("non-existent");
		expect(evidence).toBeNull();
	});

	// -----------------------------------------------------------------------
	// V5.08 AC1: Proposal Card Fields
	// -----------------------------------------------------------------------

	describe("V5.08 AC1: proposalToCard", () => {
		it("converts a Proposal to ProposalCard with all required fields", async () => {
			const input = makeInput({
				title: "Memory compaction needed",
				description: "Memory store has grown beyond 10k entries, affecting recall performance",
				whyNow: "Recall latency has increased by 40% in the last 24 hours",
				expectedImpact: "Reducing memory size will restore recall performance",
				evidence: makeEvidence({
					memoryIds: ["mem-001", "mem-002", "mem-003"],
					observationIds: ["obs-001"],
					sourceRefs: [{ type: "external", path: "/tmp/foo", id: "src-001" }],
					confidence: 0.85,
					evidenceSummary: "Memory growth detected via periodic scan",
				}),
				risk: makeRisk({
					level: "medium",
					factors: ["Memory pressure", "Performance degradation"],
					mitigation: ["Compress old entries", "Archive unused connections"],
					impactDescription: "Temporary performance hit during compaction",
				}),
				draftAvailable: true,
				approvalRequired: true,
			});

			const created = await api.createProposal(input);
			expect(created.success).toBe(true);
			expect(created.proposal).toBeDefined();

			const card = proposalToCard(created.proposal!);

			expect(card.title).toBe("Memory compaction needed");
			expect(card.description).toBe("Memory store has grown beyond 10k entries, affecting recall performance");
			expect(card.whyNow).toBe("Recall latency has increased by 40% in the last 24 hours");
			expect(card.evidence.evidenceCount).toBe(5);
			expect(card.evidence.relatedMemoryIds).toEqual(["mem-001", "mem-002", "mem-003"]);
			expect(card.evidence.memoryCount).toBe(3);
			expect(card.evidence.observationCount).toBe(1);
			expect(card.risk.level).toBe("medium");
			expect(card.risk.factors).toEqual(["Memory pressure", "Performance degradation"]);
			expect(card.risk.mitigation).toEqual(["Compress old entries", "Archive unused connections"]);
			expect(card.risk.impactDescription).toBe("Temporary performance hit during compaction");
			expect(card.expectedImpact).toBe("Reducing memory size will restore recall performance");
			expect(card.draftAvailable).toBe(true);
			expect(card.approvalRequired).toBe(true);
			expect(card.id).toBe(created.proposal!.id);
			expect(card.type).toBe("memory_proposal");
			expect(card.status).toBe("pending_approval");
			expect(card.score).toBe(created.proposal!.score.total);
			expect(card.isDuplicate).toBe(false);
			expect(card.duplicateOf).toBeNull();
		});

		it("evidence count is computed correctly from memory, observation, and source refs", async () => {
			const proposal = createProposal(
				createProposalCreateInput({
					type: "memory_proposal",
					title: "Test",
					description: "Test",
					whyNow: "Now",
					expectedImpact: "Impact",
					evidence: {
						memoryIds: ["a", "b"],
						observationIds: ["c"],
						sourceRefs: [
							{ type: "external", path: "/x", id: "d" },
							{ type: "journal", path: "/y", id: "e" },
						],
						confidence: 0.9,
						evidenceSummary: "Summary",
					},
					risk: makeRisk(),
				}),
			);
			const card = proposalToCard(proposal);
			expect(card.evidence.evidenceCount).toBe(5);
			expect(card.evidence.memoryCount).toBe(2);
			expect(card.evidence.observationCount).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// V5.08 AC2: No execution-ready without user approval
	// -----------------------------------------------------------------------

	describe("V5.08 AC2: execution-ready gate", () => {
		it("blocks execution-ready for draft proposals", async () => {
			const created = await api.createProposal(makeInput());
			const result = await api.markExecutionReady(created.proposal!.id);
			expect(result.success).toBe(false);
			expect(result.message).toContain("Only approved proposals");
		});

		it("allows execution-ready only after user approval", async () => {
			const created = await api.createProposal(makeInput());
			const accept = await api.acceptProposal(created.proposal!.id, "user");
			expect(accept.success).toBe(true);
			expect(accept.proposal.status).toBe("approved");
			const ready = await api.markExecutionReady(created.proposal!.id, "user");
			expect(ready.success).toBe(true);
			expect(ready.proposal.status).toBe("execution_ready");
		});

		it("blocks execution-ready for rejected proposals", async () => {
			const created = await api.createProposal(makeInput());
			await api.rejectProposal(created.proposal!.id, "user", "Not needed");
			const result = await api.markExecutionReady(created.proposal!.id);
			expect(result.success).toBe(false);
			expect(result.message).toContain("Only approved proposals");
		});

		it("blocks execution-ready for expired proposals", async () => {
			const created = await api.createProposal(makeInput());
			await api.expireProposal(created.proposal!.id);
			const result = await api.markExecutionReady(created.proposal!.id);
			expect(result.success).toBe(false);
			expect(result.message).toContain("Only approved proposals");
		});

		it("is idempotent when already execution-ready", async () => {
			const created = await api.createProposal(makeInput());
			await api.acceptProposal(created.proposal!.id, "user");
			await api.markExecutionReady(created.proposal!.id, "user");
			const result = await api.markExecutionReady(created.proposal!.id, "user");
			expect(result.success).toBe(true);
			expect(result.message).toContain("already execution-ready");
		});
	});

	// -----------------------------------------------------------------------
	// V5.08 AC3: Duplicate marking (suppressDuplicates=false)
	// -----------------------------------------------------------------------

	describe("V5.08 AC3: duplicate marking", () => {
		it("marks proposal as duplicate when suppressDuplicates is false", async () => {
			const dedup = new ProposalDeduplication({
				enabled: true,
				suppressDuplicates: false,
			});
			const api = new BrainProposalApi(store, undefined, undefined, dedup);

			const input = makeInput();
			const first = await api.createProposal(input);
			expect(first.success).toBe(true);

			const dup = await api.createProposal(input);
			expect(dup.success).toBe(true);
			expect(dup.isDuplicate).toBe(true);
			expect(dup.proposal).toBeDefined();
			expect(dup.proposal!.isDuplicate).toBe(true);
		});

		it("suppresses proposals entirely when suppressDuplicates is true (default)", async () => {
			const input = makeInput();
			const first = await api.createProposal(input);
			expect(first.success).toBe(true);
			const dup = await api.createProposal(input);
			expect(dup.success).toBe(false);
			expect(dup.isDuplicate).toBe(true);
			expect(dup.proposal).toBeUndefined();
		});

		it("duplicateOf references the original proposal ID", async () => {
			const dedup = new ProposalDeduplication({
				enabled: true,
				suppressDuplicates: false,
				hashAlgorithm: "sha256",
			});
			const api = new BrainProposalApi(store, undefined, undefined, dedup);

			const input = makeInput();
			const first = await api.createProposal(input);
			const dup = await api.createProposal(input);
			expect(dup.proposal!.duplicateOf).toBe(first.proposal!.id);
		});

		it("non-duplicate proposals are not marked", async () => {
			const dedup = new ProposalDeduplication({
				enabled: true,
				suppressDuplicates: false,
			});
			const api = new BrainProposalApi(store, undefined, undefined, dedup);

			const a = await api.createProposal(
				makeInput({ title: "Proposal A", evidence: makeEvidence({ memoryIds: ["mem-a"] }) }),
			);
			const b = await api.createProposal(
				makeInput({ title: "Proposal B", evidence: makeEvidence({ memoryIds: ["mem-b"] }) }),
			);
			expect(a.proposal!.isDuplicate).toBe(false);
			expect(b.proposal!.isDuplicate).toBe(false);
			expect(b.proposal!.duplicateOf).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// V5.08 AC4: Advisory only - no auto-queue to execution
	// -----------------------------------------------------------------------

	describe("V5.08 AC4: advisory only", () => {
		it("created proposals are always pending_approval, never approved", async () => {
			const result = await api.createProposal(makeInput());
			expect(result.success).toBe(true);
			expect(result.proposal!.status).toBe("pending_approval");
			expect(result.proposal!.status).not.toBe("approved");
			expect(result.proposal!.status).not.toBe("execution_ready");
			expect(result.proposal!.status).not.toBe("executed");
		});

		it("cannot skip directly from pending_approval to execution_ready", async () => {
			const created = await api.createProposal(makeInput());
			const result = await api.markExecutionReady(created.proposal!.id);
			expect(result.success).toBe(false);
			expect(result.message).toContain("Only approved proposals");
		});

		it("cannot skip directly from draft to execution_ready", async () => {
			const created = await api.createProposal(makeInput());
			await store.update(created.proposal!.id, { status: "draft" });
			const result = await api.markExecutionReady(created.proposal!.id);
			expect(result.success).toBe(false);
		});

		it("createProposal always uses pending_approval regardless of input score", async () => {
			const highScore = {
				total: 0.95,
				novelty: 0.9,
				confidence: 0.9,
				urgency: 0.9,
				feasibility: 0.9,
			};
			const result = await api.createProposal(makeInput({ score: highScore }));
			expect(result.success).toBe(true);
			expect(result.proposal!.status).toBe("pending_approval");
			expect(result.proposal!.score.total).toBe(0.95);
		});
	});

	// -----------------------------------------------------------------------
	// Dedup / Cooldown
	// -----------------------------------------------------------------------

	it("detects duplicate proposals", async () => {
		const input = makeInput();
		await api.createProposal(input);
		const check = await api.checkDuplicate(input);
		expect(check.suppress).toBe(true);
	});
});
