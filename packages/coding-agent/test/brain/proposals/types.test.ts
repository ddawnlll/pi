/**
 * Proposal Domain Model — P16.A tests.
 *
 * Covers:
 * - Type constants and enums
 * - Factory functions (createProposalCreateInput, createProposal)
 * - Validation functions
 * - Statistics computation
 * - Edge cases
 */

import { describe, expect, test } from "vitest";
import {
	ALL_PROPOSAL_STATUSES,
	ALL_PROPOSAL_TYPES,
	ALL_RISK_LEVELS,
	computeProposalStats,
	createProposal,
	createProposalCreateInput,
	type ProposalCreateInput,
	type ProposalEvidence,
	type ProposalRiskAssessment,
	validateProposalCreateInput,
	validateProposalEvidence,
	validateProposalRisk,
} from "../../../src/brain/proposals/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides?: Partial<ProposalEvidence>): ProposalEvidence {
	return {
		memoryIds: overrides?.memoryIds ?? ["mem-001"],
		observationIds: overrides?.observationIds ?? [],
		sourceRefs: overrides?.sourceRefs ?? [
			{
				type: "observation" as const,
				path: "src/test.ts",
				id: "obs-test-001",
			},
		],
		confidence: overrides?.confidence ?? 0.8,
		evidenceSummary: overrides?.evidenceSummary ?? "Evidence summary for testing",
	};
}

function makeRisk(overrides?: Partial<ProposalRiskAssessment>): ProposalRiskAssessment {
	return {
		level: overrides?.level ?? "low",
		factors: overrides?.factors ?? ["risk factor 1"],
		mitigation: overrides?.mitigation ?? ["mitigation 1"],
		affectedSystems: overrides?.affectedSystems ?? ["system-a"],
		impactDescription: overrides?.impactDescription ?? "Low impact description",
	};
}

function makeCreateInput(overrides?: Partial<ProposalCreateInput>): ProposalCreateInput {
	return createProposalCreateInput({
		type: overrides?.type ?? "memory_proposal",
		title: overrides?.title ?? "Test proposal",
		description: overrides?.description ?? "A test proposal for unit testing",
		evidence: overrides?.evidence ?? makeEvidence(),
		risk: overrides?.risk ?? makeRisk(),
		relatedGoalIds: overrides?.relatedGoalIds,
		tags: overrides?.tags,
		metadata: overrides?.metadata,
	});
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("Proposal constants", () => {
	test("ALL_PROPOSAL_TYPES contains all valid types", () => {
		expect(ALL_PROPOSAL_TYPES).toContain("memory_proposal");
		expect(ALL_PROPOSAL_TYPES).toContain("plan_proposal");
		expect(ALL_PROPOSAL_TYPES).toContain("goal_revision_proposal");
		expect(ALL_PROPOSAL_TYPES).toContain("autonomy_adjustment_proposal");
		expect(ALL_PROPOSAL_TYPES).toContain("reflection_proposal");
		expect(ALL_PROPOSAL_TYPES).toContain("safety_proposal");
		expect(ALL_PROPOSAL_TYPES.length).toBe(6);
	});

	test("ALL_PROPOSAL_STATUSES contains all valid statuses", () => {
		expect(ALL_PROPOSAL_STATUSES).toContain("draft");
		expect(ALL_PROPOSAL_STATUSES).toContain("pending_approval");
		expect(ALL_PROPOSAL_STATUSES).toContain("approved");
		expect(ALL_PROPOSAL_STATUSES).toContain("rejected");
		expect(ALL_PROPOSAL_STATUSES).toContain("superseded");
		expect(ALL_PROPOSAL_STATUSES).toContain("expired");
		expect(ALL_PROPOSAL_STATUSES).toContain("executed");
		expect(ALL_PROPOSAL_STATUSES.length).toBe(8);
		expect(ALL_PROPOSAL_STATUSES).toContain("execution_ready");
	});

	test("ALL_RISK_LEVELS contains all valid levels", () => {
		expect(ALL_RISK_LEVELS).toContain("low");
		expect(ALL_RISK_LEVELS).toContain("medium");
		expect(ALL_RISK_LEVELS).toContain("high");
		expect(ALL_RISK_LEVELS).toContain("critical");
		expect(ALL_RISK_LEVELS.length).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

describe("createProposalCreateInput", () => {
	test("creates a complete ProposalCreateInput from partial", () => {
		const input = makeCreateInput();
		expect(input.type).toBe("memory_proposal");
		expect(input.title).toBe("Test proposal");
		expect(input.description).toBe("A test proposal for unit testing");
		expect(input.evidence).toBeDefined();
		expect(input.risk).toBeDefined();
		expect(input.relatedGoalIds).toEqual([]);
		expect(input.tags).toEqual([]);
		expect(input.metadata).toEqual({});
	});

	test("preserves provided fields", () => {
		const input = makeCreateInput({
			type: "safety_proposal",
			title: "Safety check",
			relatedGoalIds: ["goal-001"],
			tags: ["safety", "critical"],
			metadata: { source: "test" },
		});
		expect(input.type).toBe("safety_proposal");
		expect(input.title).toBe("Safety check");
		expect(input.relatedGoalIds).toEqual(["goal-001"]);
		expect(input.tags).toEqual(["safety", "critical"]);
		expect(input.metadata).toEqual({ source: "test" });
	});
});

describe("createProposal", () => {
	test("creates a complete Proposal from input", () => {
		const input = makeCreateInput();
		const proposal = createProposal(input);

		expect(proposal.id).toBeTypeOf("string");
		expect(proposal.id.length).toBeGreaterThan(0);
		expect(proposal.type).toBe("memory_proposal");
		expect(proposal.title).toBe("Test proposal");
		expect(proposal.description).toBe("A test proposal for unit testing");
		expect(proposal.status).toBe("draft");
		expect(proposal.submittedBy).toBe("pi");
		expect(proposal.createdAt).toBeTypeOf("string");
		expect(proposal.updatedAt).toBeTypeOf("string");
		expect(proposal.expiresAt).toBeTypeOf("string");
		expect(proposal.relatedProposalIds).toEqual([]);
		expect(proposal.relatedGoalIds).toEqual([]);
		expect(proposal.tags).toEqual([]);
		expect(proposal.metadata).toEqual({});
	});

	test("score defaults to zeroes when not provided", () => {
		const input = makeCreateInput();
		const proposal = createProposal(input);

		expect(proposal.score.total).toBe(0);
		expect(proposal.score.novelty).toBe(0);
		expect(proposal.score.confidence).toBe(0);
		expect(proposal.score.urgency).toBe(0);
		expect(proposal.score.feasibility).toBe(0);
	});

	test("overrides work correctly", () => {
		const input = makeCreateInput();
		const proposal = createProposal(input, {
			id: "test-id-001",
			status: "pending_approval",
			submittedBy: "user",
			approvedBy: "user-1",
		});

		expect(proposal.id).toBe("test-id-001");
		expect(proposal.status).toBe("pending_approval");
		expect(proposal.submittedBy).toBe("user");
		expect(proposal.approvedBy).toBe("user-1");
	});

	test("evidence and risk are deep-copied", () => {
		const input = makeCreateInput();
		const proposal = createProposal(input);

		// Mutations to original should not affect proposal
		input.evidence.memoryIds.push("mem-002");
		input.risk.factors.push("new factor");

		expect(proposal.evidence.memoryIds).toEqual(["mem-001"]);
		expect(proposal.risk.factors).toEqual(["risk factor 1"]);
	});

	test("creates proposals of all types", () => {
		for (const type of ALL_PROPOSAL_TYPES) {
			const input = makeCreateInput({ type });
			const proposal = createProposal(input);
			expect(proposal.type).toBe(type);
		}
	});
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateProposalEvidence", () => {
	test("valid evidence returns no errors", () => {
		const evidence = makeEvidence();
		const errors = validateProposalEvidence(evidence);
		expect(errors).toEqual([]);
	});

	test("evidence with no references returns error", () => {
		const evidence = makeEvidence({
			memoryIds: [],
			observationIds: [],
			sourceRefs: [],
		});
		const errors = validateProposalEvidence(evidence);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("evidence reference");
	});

	test("evidence with confidence out of range returns error", () => {
		const evidence = makeEvidence({ confidence: 1.5 });
		const errors = validateProposalEvidence(evidence);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("confidence");
	});

	test("evidence with empty summary returns error", () => {
		const evidence = makeEvidence({ evidenceSummary: "" });
		const errors = validateProposalEvidence(evidence);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("summary");
	});

	test("evidence with only whitespace summary returns error", () => {
		const evidence = makeEvidence({ evidenceSummary: "   " });
		const errors = validateProposalEvidence(evidence);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("summary");
	});

	test("evidence with only memory refs is valid", () => {
		const evidence = makeEvidence({
			memoryIds: ["mem-001"],
			observationIds: [],
			sourceRefs: [],
		});
		const errors = validateProposalEvidence(evidence);
		expect(errors).toEqual([]);
	});

	test("evidence with only observation refs is valid", () => {
		const evidence = makeEvidence({
			memoryIds: [],
			observationIds: ["obs-001"],
			sourceRefs: [],
		});
		const errors = validateProposalEvidence(evidence);
		expect(errors).toEqual([]);
	});

	test("evidence with only sourceRefs is valid", () => {
		const evidence = makeEvidence({
			memoryIds: [],
			observationIds: [],
			sourceRefs: [{ type: "observation", path: "test.ts", id: "obs-1" }],
		});
		const errors = validateProposalEvidence(evidence);
		expect(errors).toEqual([]);
	});
});

describe("validateProposalRisk", () => {
	test("valid risk returns no errors", () => {
		const risk = makeRisk();
		const errors = validateProposalRisk(risk);
		expect(errors).toEqual([]);
	});

	test("invalid risk level returns error", () => {
		const risk = makeRisk({ level: "extreme" as "low" });
		const errors = validateProposalRisk(risk);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("risk level");
	});

	test("risk with no factors returns error", () => {
		const risk = makeRisk({ factors: [] });
		const errors = validateProposalRisk(risk);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("risk factor");
	});

	test("risk with no affected systems returns error", () => {
		const risk = makeRisk({ affectedSystems: [] });
		const errors = validateProposalRisk(risk);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("affected system");
	});
});

describe("validateProposalCreateInput", () => {
	test("valid input returns no errors", () => {
		const input = makeCreateInput();
		const errors = validateProposalCreateInput(input);
		expect(errors).toEqual([]);
	});

	test("invalid type returns error", () => {
		const input = makeCreateInput({ type: "invalid_type" as "memory_proposal" });
		const errors = validateProposalCreateInput(input);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("proposal type");
	});

	test("empty title returns error", () => {
		const input = makeCreateInput({ title: "" });
		const errors = validateProposalCreateInput(input);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("title");
	});

	test("empty description returns error", () => {
		const input = makeCreateInput({ description: "" });
		const errors = validateProposalCreateInput(input);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("description");
	});

	test("aggregates sub-validator errors", () => {
		const input = makeCreateInput({
			title: "",
			description: "",
			evidence: makeEvidence({ memoryIds: [], observationIds: [], sourceRefs: [], confidence: 1.5 }),
			risk: makeRisk({ level: "extreme" as "low", factors: [] }),
		});
		const errors = validateProposalCreateInput(input);
		// Should have errors from title, description, evidence, and risk
		expect(errors.length).toBeGreaterThanOrEqual(4);
	});
});

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

describe("computeProposalStats", () => {
	test("empty proposals returns zero stats", () => {
		const stats = computeProposalStats([]);
		expect(stats.totalProposals).toBe(0);
		expect(stats.pendingApprovalCount).toBe(0);
		expect(stats.expiredCount).toBe(0);
		expect(stats.averageScore).toBe(0);
		expect(stats.acceptanceRate).toBe(0);
	});

	test("counts proposals by status", () => {
		const baseInput = makeCreateInput();
		const proposals = [
			createProposal(baseInput, { status: "pending_approval" }),
			createProposal(baseInput, { status: "approved" }),
			createProposal(baseInput, { status: "rejected" }),
			createProposal(baseInput, { status: "expired" }),
			createProposal(baseInput, { status: "pending_approval" }),
		];

		const stats = computeProposalStats(proposals);
		expect(stats.totalProposals).toBe(5);
		expect(stats.pendingApprovalCount).toBe(2);
		expect(stats.expiredCount).toBe(1);
	});

	test("counts proposals by type", () => {
		const proposals = [
			createProposal(makeCreateInput({ type: "memory_proposal" })),
			createProposal(makeCreateInput({ type: "plan_proposal" })),
			createProposal(makeCreateInput({ type: "plan_proposal" })),
		];

		const stats = computeProposalStats(proposals);
		expect(stats.byType.memory_proposal).toBe(1);
		expect(stats.byType.plan_proposal).toBe(2);
	});

	test("computes average score", () => {
		const proposals = [
			createProposal(makeCreateInput(), {
				score: { total: 0.8, novelty: 0.8, confidence: 0.9, urgency: 0.7, feasibility: 0.8 },
			}),
			createProposal(makeCreateInput(), {
				score: { total: 0.6, novelty: 0.6, confidence: 0.5, urgency: 0.6, feasibility: 0.7 },
			}),
		];

		const stats = computeProposalStats(proposals);
		expect(stats.averageScore).toBeCloseTo(0.7, 5);
	});

	test("computes acceptance rate", () => {
		const baseInput = makeCreateInput();
		const proposals = [
			createProposal(baseInput, { status: "approved" }),
			createProposal(baseInput, { status: "approved" }),
			createProposal(baseInput, { status: "rejected" }),
			createProposal(baseInput, { status: "pending_approval" }), // not reviewed
		];

		const stats = computeProposalStats(proposals);
		// 2 approved out of 3 reviewed
		expect(stats.acceptanceRate).toBeCloseTo(2 / 3, 5);
	});

	test("handles all statuses present", () => {
		const baseInput = makeCreateInput();
		const proposals = ALL_PROPOSAL_STATUSES.map((status) => createProposal(baseInput, { status }));

		const stats = computeProposalStats(proposals);
		expect(stats.totalProposals).toBe(ALL_PROPOSAL_STATUSES.length);
		for (const status of ALL_PROPOSAL_STATUSES) {
			expect(stats.byStatus[status]).toBe(1);
		}
	});
});
