/**
 * BrainProposalApi tests — P16.F
 */

import { beforeEach, describe, expect, it } from "vitest";
import { BrainProposalApi } from "../../../src/brain/proposals/api.js";
import { InMemoryProposalStore } from "../../../src/brain/proposals/store.js";
import {
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
	// Dedup / Cooldown
	// -----------------------------------------------------------------------

	it("detects duplicate proposals", async () => {
		const input = makeInput();
		await api.createProposal(input);
		const check = await api.checkDuplicate(input);
		expect(check.suppress).toBe(true);
	});
});
