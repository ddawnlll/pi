/**
 * InMemoryProposalStore tests — P16.F
 */

import { beforeEach, describe, expect, it } from "vitest";
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
		evidence: overrides?.evidence ?? makeEvidence(),
		risk: overrides?.risk ?? makeRisk(),
		relatedGoalIds: overrides?.relatedGoalIds,
		tags: overrides?.tags,
		metadata: overrides?.metadata,
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InMemoryProposalStore", () => {
	let store: InMemoryProposalStore;

	beforeEach(() => {
		store = new InMemoryProposalStore();
	});

	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	it("creates a proposal and assigns an ID", async () => {
		const proposal = await store.create(makeInput());
		expect(proposal.id).toBeDefined();
		expect(proposal.title).toBe("Test proposal");
		expect(proposal.status).toBe("draft");
		expect(proposal.createdAt).toBeDefined();
		expect(proposal.expiresAt).toBeDefined();
	});

	it("gets a proposal by ID", async () => {
		const created = await store.create(makeInput({ title: "Find me" }));
		const found = await store.getById(created.id);
		expect(found).not.toBeNull();
		expect(found!.title).toBe("Find me");
	});

	it("returns null for non-existent proposal", async () => {
		const found = await store.getById("non-existent");
		expect(found).toBeNull();
	});

	it("updates a proposal", async () => {
		const created = await store.create(makeInput());
		const updated = await store.update(created.id, { status: "approved", approvedBy: "test" });
		expect(updated.status).toBe("approved");
		expect(updated.approvedBy).toBe("test");
		expect(typeof updated.updatedAt).toBe("string");
	});

	it("throws when updating non-existent proposal", async () => {
		await expect(store.update("non-existent", { status: "approved" })).rejects.toThrow();
	});

	it("deletes a proposal", async () => {
		const created = await store.create(makeInput());
		await store.delete(created.id);
		const found = await store.getById(created.id);
		expect(found).toBeNull();
	});

	it("does not throw when deleting non-existent proposal", async () => {
		await expect(store.delete("non-existent")).resolves.toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------------

	it("lists all proposals", async () => {
		await store.create(makeInput({ title: "A" }));
		await store.create(makeInput({ title: "B" }));
		const list = await store.list();
		expect(list).toHaveLength(2);
	});

	it("filters by status", async () => {
		const p1 = await store.create(makeInput());
		await store.update(p1.id, { status: "approved" });
		await store.create(makeInput({ title: "Pending" }));

		const pending = await store.list({ status: ["pending_approval"] });
		expect(pending).toHaveLength(0); // default is draft, not pending_approval

		const drafts = await store.list({ status: ["draft"] });
		expect(drafts).toHaveLength(1);
	});

	it("filters by type", async () => {
		await store.create(makeInput({ type: "memory_proposal", title: "M" }));
		await store.create(makeInput({ type: "plan_proposal", title: "P" }));

		const plans = await store.list({ type: ["plan_proposal"] });
		expect(plans).toHaveLength(1);
		expect(plans[0].title).toBe("P");
	});

	it("filters by minScore", async () => {
		const p1 = await store.create(makeInput({ title: "Low" }));
		await store.update(p1.id, { status: "approved" });
		// Score defaults to 0, so minScore > 0 should filter it out
		const filtered = await store.list({ minScore: 0.1 });
		expect(filtered).toHaveLength(0);
	});

	it("filters by tag", async () => {
		await store.create(makeInput({ title: "Tagged", tags: ["important"] }));
		await store.create(makeInput({ title: "Normal" }));

		const tagged = await store.list({ tag: "important" });
		expect(tagged).toHaveLength(1);
		expect(tagged[0].title).toBe("Tagged");
	});

	it("lists proposals sorted by createdAt descending by default", async () => {
		const p1 = createProposal(makeInput({ title: "First" }));
		const p2 = createProposal(makeInput({ title: "Second" }), {
			createdAt: new Date(Date.now() + 1000).toISOString(),
		});
		store.seed(p2, p1);
		const list = await store.list();
		expect(list).toHaveLength(2);
		expect(list[0].title).toBe("Second");
		expect(list[1].title).toBe("First");
	});

	it("sorts by score ascending", async () => {
		// Seed proposals with explicit scores
		store.clear();
		const highScored = createProposal(makeInput({ title: "High" }), {
			score: { total: 0.9, novelty: 0.9, confidence: 0.9, urgency: 0.9, feasibility: 0.9 },
		});
		const lowScored = createProposal(makeInput({ title: "Low" }), {
			score: { total: 0.1, novelty: 0.1, confidence: 0.1, urgency: 0.1, feasibility: 0.1 },
		});
		store.seed(lowScored, highScored);
		const list = await store.list({ sortBy: "score", sortOrder: "asc" });
		expect(list[0].title).toBe("Low");
		expect(list[1].title).toBe("High");
	});

	it("paginates results", async () => {
		for (let i = 0; i < 10; i++) {
			await store.create(makeInput({ title: `Item ${i}` }));
		}
		const list = await store.list({ limit: 3, offset: 0 });
		expect(list).toHaveLength(3);
	});

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	it("computes stats correctly", async () => {
		const p1 = await store.create(makeInput({ type: "memory_proposal" }));
		const p2 = await store.create(makeInput({ type: "plan_proposal" }));
		await store.update(p1.id, { status: "approved", approvedBy: "test" });
		await store.update(p2.id, { status: "rejected", rejectedBy: "test", rejectionReason: "no" });

		const stats = await store.stats();
		expect(stats.totalProposals).toBe(2);
		expect(stats.byStatus.approved).toBe(1);
		expect(stats.byStatus.rejected).toBe(1);
		expect(stats.byType.memory_proposal).toBe(1);
		expect(stats.byType.plan_proposal).toBe(1);
		expect(stats.acceptanceRate).toBe(0.5);
	});

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	it("supports seed and clear helpers", async () => {
		const p = createProposal(makeInput());
		store.seed(p);
		expect(store.size).toBe(1);
		store.clear();
		expect(store.size).toBe(0);
	});
});
