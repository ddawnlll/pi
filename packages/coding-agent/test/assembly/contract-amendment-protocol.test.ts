import { describe, expect, it } from "vitest";
import { ContractAmendmentProtocol } from "../../src/core/assembly/contract-amendment-protocol.js";

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("ContractAmendmentProtocol — positive path", () => {
	it("proposes non-breaking amendment with evidence = auto-approved", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-1",
			contract: "ns-a/export.ts",
			kind: "add_contract",
			breaking: "non_breaking",
			proposer: "ns-a",
			proposedAt: new Date().toISOString(),
			evidence: ["static_confirmation: verified by compiler"],
			reason: "New export detected by static analysis",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.amendment.approved).toBe(true);
			expect(result.amendment.approvedBy).toBe("auto");
			expect(result.amendment.dcrRequired).toBe(false);
			expect(result.amendment.carRequired).toBe(false);
		}
	});

	it("proposes non-breaking with human_approval evidence = auto-approved", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-2",
			contract: "ns-b/types.ts",
			kind: "change_evidence",
			breaking: "non_breaking",
			proposer: "ns-b",
			proposedAt: new Date().toISOString(),
			evidence: ["human_approved: operator confirmed"],
			reason: "Human operator confirmed evidence class upgrade",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.amendment.approved).toBe(true);
		}
	});

	it("change_evidence amendment requires CAR", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-3",
			contract: "ns-c/data.ts",
			kind: "change_evidence",
			breaking: "non_breaking",
			proposer: "ns-c",
			proposedAt: new Date().toISOString(),
			evidence: ["static_confirmation: evidence reclassified"],
			reason: "Evidence class changed from llm_only to static",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.amendment.carRequired).toBe(true);
		}
	});

	it("change_outcome amendment requires DCR", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-4",
			contract: "ns-d/outcome.ts",
			kind: "change_outcome",
			breaking: "non_breaking",
			proposer: "ns-d",
			proposedAt: new Date().toISOString(),
			evidence: ["static_confirmation"],
			reason: "Outcome updated after assembly",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.amendment.dcrRequired).toBe(true);
		}
	});

	it("breaking amendment with evidence requires DCR and is NOT auto-approved", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-5",
			contract: "ns-e/breaking.ts",
			kind: "remove_contract",
			breaking: "breaking",
			proposer: "ns-e",
			proposedAt: new Date().toISOString(),
			evidence: ["static_confirmation: contract no longer needed"],
			reason: "Obsolete contract detected",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.amendment.approved).toBe(false);
			expect(result.amendment.dcrRequired).toBe(true);
			expect(result.amendment.carRequired).toBe(true);
		}
	});

	it("manual approval works for breaking amendments", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-6",
			contract: "ns-f/manual.ts",
			kind: "change_outcome",
			breaking: "breaking",
			proposer: "ns-f",
			proposedAt: new Date().toISOString(),
			evidence: ["human_approved"],
			reason: "Manual review required",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.amendment.approved).toBe(false);
			const approved = protocol.approve("am-6", "operator@pi");
			expect(approved).toBe(true);

			const amendments = protocol.getAmendments();
			const amended = amendments.find((a) => a.id === "am-6");
			expect(amended!.approved).toBe(true);
			expect(amended!.approvedBy).toBe("operator@pi");
		}
	});

	it("buildVerdict correctly counts auto-approved vs human review", () => {
		const protocol = new ContractAmendmentProtocol();
		protocol.propose({
			id: "am-7",
			contract: "a.ts",
			kind: "add_contract",
			breaking: "non_breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["static_confirmation"],
			reason: "test",
		});
		protocol.propose({
			id: "am-8",
			contract: "b.ts",
			kind: "change_outcome",
			breaking: "breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["evidence"],
			reason: "test",
		});

		const verdict = protocol.buildVerdict(["am-7", "am-8"]);
		expect(verdict.autoApproved).toBe(1);
		expect(verdict.requireHumanReview).toBe(1);
		expect(verdict.allAccepted).toBe(false);
	});

	it("getPendingAmendments returns only unapproved", () => {
		const protocol = new ContractAmendmentProtocol();
		protocol.propose({
			id: "am-9",
			contract: "a.ts",
			kind: "add_contract",
			breaking: "non_breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["static_confirmation"],
			reason: "test",
		});
		protocol.propose({
			id: "am-10",
			contract: "b.ts",
			kind: "change_outcome",
			breaking: "breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["evidence"],
			reason: "test",
		});

		expect(protocol.getPendingAmendments()).toHaveLength(1);
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("ContractAmendmentProtocol — negative path", () => {
	it("rejects amendments without evidence", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-reject",
			contract: "no-evidence.ts",
			kind: "add_contract",
			breaking: "non_breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: [],
			reason: "No evidence provided",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.reason).toContain("no evidence");
		}
	});

	it("rejects duplicate amendment IDs", () => {
		const protocol = new ContractAmendmentProtocol();
		protocol.propose({
			id: "dup",
			contract: "a.ts",
			kind: "add_contract",
			breaking: "non_breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["static"],
			reason: "first",
		});
		const result = protocol.propose({
			id: "dup",
			contract: "b.ts",
			kind: "add_contract",
			breaking: "non_breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["static"],
			reason: "second",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.reason).toContain("Duplicate");
		}
	});

	it("non-breaking amendment without strong evidence is NOT auto-approved", () => {
		const protocol = new ContractAmendmentProtocol();
		const result = protocol.propose({
			id: "am-weak",
			contract: "weak.ts",
			kind: "add_contract",
			breaking: "non_breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["llm_only: predicted by AI"],
			reason: "LLM prediction",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.amendment.approved).toBe(false);
		}
	});

	it("approve returns false for non-existent ID", () => {
		const protocol = new ContractAmendmentProtocol();
		expect(protocol.approve("nonexistent", "operator")).toBe(false);
	});

	it("breaking amendment counts as human review required and adds blocking reason", () => {
		const protocol = new ContractAmendmentProtocol();
		protocol.propose({
			id: "am-block",
			contract: "block.ts",
			kind: "remove_contract",
			breaking: "breaking",
			proposer: "ns",
			proposedAt: new Date().toISOString(),
			evidence: ["evidence"],
			reason: "breaking change",
		});

		const verdict = protocol.buildVerdict(["am-block"]);
		expect(verdict.allAccepted).toBe(false);
		expect(verdict.requireHumanReview).toBe(1);
		expect(verdict.blockingReasons.length).toBeGreaterThan(0);
		expect(verdict.dcrNeeded).toHaveLength(1); // breaking → DCR
		expect(verdict.carNeeded).toHaveLength(1); // remove_contract → CAR
	});
});
