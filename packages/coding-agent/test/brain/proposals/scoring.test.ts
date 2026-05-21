/**
 * Proposal Scoring Engine — P16.C tests.
 *
 * Covers:
 * - Configuration defaults and merging
 * - Novelty calculation (unique vs repeat proposals)
 * - Confidence calculation (evidence quality)
 * - Urgency calculation (time-sensitivity)
 * - Feasibility calculation (capabilities)
 * - Auto-queue threshold enforcement
 * - Edge cases (empty proposals, boundary values)
 */

import { describe, expect, test } from "vitest";
import { ProposalScoringEngine } from "../../../src/brain/proposals/scoring.js";
import {
	createProposal,
	createProposalCreateInput,
	type Proposal,
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

function makeExistingProposal(
	overrides?: Partial<ProposalCreateInput> & { createdAt?: string; status?: string },
): Proposal {
	const input = makeCreateInput(overrides);
	const createdAt = overrides?.createdAt ?? new Date().toISOString();
	return createProposal(input, {
		createdAt,
		status:
			(overrides?.status as
				| "draft"
				| "pending_approval"
				| "approved"
				| "rejected"
				| "superseded"
				| "expired"
				| "executed") ?? "pending_approval",
	});
}

const DEFAULT_WEIGHTS = {
	novelty: 0.2,
	confidence: 0.3,
	urgency: 0.2,
	feasibility: 0.3,
};

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

describe("ProposalScoringEngine config defaults", () => {
	test("constructor without config uses defaults", () => {
		const engine = new ProposalScoringEngine();
		const config = engine.getConfig();
		expect(config.weights.novelty).toBe(DEFAULT_WEIGHTS.novelty);
		expect(config.weights.confidence).toBe(DEFAULT_WEIGHTS.confidence);
		expect(config.weights.urgency).toBe(DEFAULT_WEIGHTS.urgency);
		expect(config.weights.feasibility).toBe(DEFAULT_WEIGHTS.feasibility);
		expect(config.autoQueueThreshold).toBe(0.7);
		expect(config.autoQueueConfidenceMin).toBe(0.6);
		expect(config.noveltyLookbackDays).toBe(14);
	});

	test("constructor with partial config merges correctly", () => {
		const engine = new ProposalScoringEngine({
			autoQueueThreshold: 0.8,
			weights: { novelty: 0.3, confidence: 0.3 },
		});
		const config = engine.getConfig();
		expect(config.autoQueueThreshold).toBe(0.8);
		expect(config.weights.novelty).toBe(0.3);
		expect(config.weights.confidence).toBe(0.3);
		// Other weights should keep defaults
		expect(config.weights.urgency).toBe(DEFAULT_WEIGHTS.urgency);
		expect(config.weights.feasibility).toBe(DEFAULT_WEIGHTS.feasibility);
	});

	test("setConfig updates only provided fields", () => {
		const engine = new ProposalScoringEngine();
		engine.setConfig({ autoQueueConfidenceMin: 0.7 });
		expect(engine.getConfig().autoQueueConfidenceMin).toBe(0.7);
		expect(engine.getConfig().autoQueueThreshold).toBe(0.7); // unchanged
	});

	test("config is immutable after getConfig()", () => {
		const engine = new ProposalScoringEngine();
		const config = engine.getConfig();
		config.autoQueueThreshold = 0.99;
		expect(engine.getConfig().autoQueueThreshold).toBe(0.7);
	});
});

// ---------------------------------------------------------------------------
// Novelty
// ---------------------------------------------------------------------------

describe("calculateNovelty", () => {
	test("returns 1.0 when no existing proposals", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();
		expect(engine.calculateNovelty(input, [])).toBe(1.0);
	});

	test("returns 1.0 when all existing proposals are outside lookback window", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();
		const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
		const existing = [makeExistingProposal({ createdAt: oldDate })];

		expect(engine.calculateNovelty(input, existing)).toBe(1.0);
	});

	test("returns high novelty for different type than existing", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput({ type: "safety_proposal", title: "Safety check" });
		const existing = [makeExistingProposal({ type: "memory_proposal", title: "Memory update" })];

		const novelty = engine.calculateNovelty(input, existing);
		expect(novelty).toBeGreaterThanOrEqual(0.8);
	});

	test("returns lower novelty for same type and similar title", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput({ type: "memory_proposal", title: "Update memory record" });
		const existing = [makeExistingProposal({ type: "memory_proposal", title: "Update memory record" })];

		const novelty = engine.calculateNovelty(input, existing);
		expect(novelty).toBeLessThan(0.5);
	});

	test("returns 0 novelty for identical proposal", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput({
			type: "memory_proposal",
			title: "Identical title",
			description: "Identical description for testing",
		});
		const existing = [
			makeExistingProposal({
				type: "memory_proposal",
				title: "Identical title",
				description: "Identical description for testing",
			}),
		];

		const novelty = engine.calculateNovelty(input, existing);
		expect(novelty).toBeLessThan(0.3);
	});

	test("completely different proposals get high novelty", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput({
			type: "plan_proposal",
			title: "New architecture plan for module X",
			description: "Rewrite the authentication module using OAuth2",
		});
		const existing = [
			makeExistingProposal({
				type: "memory_proposal",
				title: "Memory cleanup",
				description: "Clean up stale memory records",
			}),
		];

		const novelty = engine.calculateNovelty(input, existing);
		expect(novelty).toBeGreaterThan(0.7);
	});
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe("calculateConfidence", () => {
	test("returns value between 0 and 1", () => {
		const engine = new ProposalScoringEngine();
		const evidence = makeEvidence({ confidence: 0.8 });
		const score = engine.calculateConfidence(evidence);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("evidence with observation refs gets highest source quality", () => {
		const engine = new ProposalScoringEngine();
		const obsEvidence = makeEvidence({
			confidence: 0.9,
			observationIds: ["obs-001", "obs-002"],
			memoryIds: [],
			sourceRefs: [],
		});
		const memEvidence = makeEvidence({
			confidence: 0.9,
			observationIds: [],
			memoryIds: ["mem-001"],
			sourceRefs: [],
		});

		const obsScore = engine.calculateConfidence(obsEvidence);
		const memScore = engine.calculateConfidence(memEvidence);
		expect(obsScore).toBeGreaterThan(memScore);
	});

	test("evidence with only source refs gets base quality", () => {
		const engine = new ProposalScoringEngine();
		const evidence = makeEvidence({
			confidence: 0.8,
			observationIds: [],
			memoryIds: [],
			sourceRefs: [{ type: "observation", path: "test.ts", id: "obs-1" }],
		});
		const score = engine.calculateConfidence(evidence);
		// sourceQuality=0.6, evidenceConfidence=0.8 => 0.48
		expect(score).toBeCloseTo(0.48, 2);
	});

	test("no refs gets lowest score", () => {
		const engine = new ProposalScoringEngine();
		const evidence = makeEvidence({
			confidence: 1.0,
			observationIds: [],
			memoryIds: [],
			sourceRefs: [],
		});
		const score = engine.calculateConfidence(evidence);
		// sourceQuality=0.3, evidenceConfidence=1.0 => 0.3
		expect(score).toBeCloseTo(0.3, 2);
	});

	test("higher evidence confidence increases score", () => {
		const engine = new ProposalScoringEngine();
		const lowEvidence = makeEvidence({ confidence: 0.3, memoryIds: ["mem-001"] });
		const highEvidence = makeEvidence({ confidence: 0.9, memoryIds: ["mem-001"] });

		const lowScore = engine.calculateConfidence(lowEvidence);
		const highScore = engine.calculateConfidence(highEvidence);
		expect(highScore).toBeGreaterThan(lowScore);
	});

	test("confidence clamped to valid range", () => {
		const engine = new ProposalScoringEngine();
		const negativeEvidence = makeEvidence({ confidence: -0.5, observationIds: ["obs-001"] });
		const overEvidence = makeEvidence({ confidence: 2.0, observationIds: ["obs-001"] });

		const negScore = engine.calculateConfidence(negativeEvidence);
		const overScore = engine.calculateConfidence(overEvidence);
		expect(negScore).toBeGreaterThanOrEqual(0);
		expect(overScore).toBeLessThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// Urgency
// ---------------------------------------------------------------------------

describe("calculateUrgency", () => {
	test("returns value between 0 and 1", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();
		const score = engine.calculateUrgency(input);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("proposals with observation refs are more urgent", () => {
		const engine = new ProposalScoringEngine();
		const withObs = makeCreateInput({
			evidence: makeEvidence({ observationIds: ["obs-001"] }),
		});
		const withoutObs = makeCreateInput({
			evidence: makeEvidence({ observationIds: [] }),
		});

		const urgentScore = engine.calculateUrgency(withObs);
		const normalScore = engine.calculateUrgency(withoutObs);
		expect(urgentScore).toBeGreaterThan(normalScore);
	});

	test("proposals with goal alignment are more urgent", () => {
		const engine = new ProposalScoringEngine();
		const withGoal = makeCreateInput({
			relatedGoalIds: ["goal-001"],
		});
		const withoutGoal = makeCreateInput({
			relatedGoalIds: [],
		});

		const goalScore = engine.calculateUrgency(withGoal, [{ id: "goal-001" }]);
		const noGoalScore = engine.calculateUrgency(withoutGoal);
		expect(goalScore).toBeGreaterThan(noGoalScore);
	});

	test("safety proposals are most urgent", () => {
		const engine = new ProposalScoringEngine();
		const safety = makeCreateInput({ type: "safety_proposal" });
		const reflection = makeCreateInput({ type: "reflection_proposal" });

		const safetyUrgency = engine.calculateUrgency(safety);
		const reflectionUrgency = engine.calculateUrgency(reflection);
		expect(safetyUrgency).toBeGreaterThan(reflectionUrgency);
	});

	test("proposal type urgency ordering is correct", () => {
		const engine = new ProposalScoringEngine();
		const types = [
			"safety_proposal",
			"plan_proposal",
			"goal_revision_proposal",
			"autonomy_adjustment_proposal",
			"memory_proposal",
			"reflection_proposal",
		] as const;

		const scores = types.map((type) => engine.calculateUrgency(makeCreateInput({ type })));

		// Each should be less than or equal to the previous
		for (let i = 1; i < scores.length; i++) {
			expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
		}
	});
});

// ---------------------------------------------------------------------------
// Feasibility
// ---------------------------------------------------------------------------

describe("calculateFeasibility", () => {
	test("returns value between 0 and 1", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();
		const score = engine.calculateFeasibility(input);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("higher autonomy level increases feasibility", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();
		const lowAuto = engine.calculateFeasibility(input, 0);
		const highAuto = engine.calculateFeasibility(input, 4);
		expect(highAuto).toBeGreaterThan(lowAuto);
	});

	test("memory proposals are most feasible (lowest resource)", () => {
		const engine = new ProposalScoringEngine();
		const memory = makeCreateInput({ type: "memory_proposal" });
		const plan = makeCreateInput({ type: "plan_proposal" });

		const memFeas = engine.calculateFeasibility(memory);
		const planFeas = engine.calculateFeasibility(plan);
		expect(memFeas).toBeGreaterThan(planFeas);
	});

	test("high risk proposals are less feasible", () => {
		const engine = new ProposalScoringEngine();
		const lowRisk = makeCreateInput({
			risk: makeRisk({ level: "low" }),
			evidence: makeEvidence({ observationIds: ["obs-001"] }),
		});
		const highRisk = makeCreateInput({
			risk: makeRisk({ level: "high" }),
			evidence: makeEvidence({ observationIds: ["obs-001"] }),
		});

		const lowFeas = engine.calculateFeasibility(lowRisk);
		const highFeas = engine.calculateFeasibility(highRisk);
		expect(lowFeas).toBeGreaterThan(highFeas);
	});

	test("proposals with more evidence are more feasible", () => {
		const engine = new ProposalScoringEngine();
		const shallowEvidence = makeCreateInput({
			evidence: makeEvidence({ memoryIds: ["mem-001"], observationIds: [] }),
		});
		const deepEvidence = makeCreateInput({
			evidence: makeEvidence({
				memoryIds: ["mem-001", "mem-002", "mem-003"],
				observationIds: ["obs-001", "obs-002"],
			}),
		});

		const shallow = engine.calculateFeasibility(shallowEvidence);
		const deep = engine.calculateFeasibility(deepEvidence);
		expect(deep).toBeGreaterThan(shallow);
	});
});

// ---------------------------------------------------------------------------
// Total Score
// ---------------------------------------------------------------------------

describe("calculateTotal", () => {
	test("computes weighted combination correctly", () => {
		const engine = new ProposalScoringEngine();
		const total = engine.calculateTotal({
			novelty: 1.0,
			confidence: 1.0,
			urgency: 1.0,
			feasibility: 1.0,
		});
		// 1.0*0.2 + 1.0*0.3 + 1.0*0.2 + 1.0*0.3 = 1.0
		expect(total).toBeCloseTo(1.0, 5);
	});

	test("zero scores give zero total", () => {
		const engine = new ProposalScoringEngine();
		const total = engine.calculateTotal({
			novelty: 0,
			confidence: 0,
			urgency: 0,
			feasibility: 0,
		});
		expect(total).toBe(0);
	});

	test("weighted formula matches spec", () => {
		const engine = new ProposalScoringEngine();
		// Using the example from the spec:
		// novelty=0.6, confidence=0.7, urgency=0.5, feasibility=0.8
		// total = 0.6*0.2 + 0.7*0.3 + 0.5*0.2 + 0.8*0.3
		//       = 0.12 + 0.21 + 0.10 + 0.24 = 0.67
		const total = engine.calculateTotal({
			novelty: 0.6,
			confidence: 0.7,
			urgency: 0.5,
			feasibility: 0.8,
		});
		expect(total).toBeCloseTo(0.67, 5);
	});

	test("custom weights affect total", () => {
		const engine = new ProposalScoringEngine({
			weights: { novelty: 0.4, confidence: 0.1, urgency: 0.4, feasibility: 0.1 },
		});
		const total = engine.calculateTotal({
			novelty: 1.0,
			confidence: 0.5,
			urgency: 1.0,
			feasibility: 0.5,
		});
		// 1.0*0.4 + 0.5*0.1 + 1.0*0.4 + 0.5*0.1 = 0.4+0.05+0.4+0.05 = 0.9
		expect(total).toBeCloseTo(0.9, 5);
	});
});

// ---------------------------------------------------------------------------
// Auto-queue
// ---------------------------------------------------------------------------

describe("shouldAutoQueue", () => {
	test("returns true when both thresholds met", () => {
		const engine = new ProposalScoringEngine();
		const score = { total: 0.7, confidence: 0.6, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(score)).toBe(true);
	});

	test("returns false when total below threshold", () => {
		const engine = new ProposalScoringEngine();
		const score = { total: 0.69, confidence: 0.6, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(score)).toBe(false);
	});

	test("returns false when confidence below threshold", () => {
		const engine = new ProposalScoringEngine();
		const score = { total: 0.7, confidence: 0.59, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(score)).toBe(false);
	});

	test("returns false when both below thresholds", () => {
		const engine = new ProposalScoringEngine();
		const score = { total: 0.5, confidence: 0.4, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(score)).toBe(false);
	});

	test("custom thresholds affect decision", () => {
		const engine = new ProposalScoringEngine({
			autoQueueThreshold: 0.6,
			autoQueueConfidenceMin: 0.5,
		});
		const score = { total: 0.65, confidence: 0.55, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(score)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Full Score
// ---------------------------------------------------------------------------

describe("score (integration)", () => {
	test("returns a complete ProposalScore with all dimensions", async () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();
		const score = await engine.score(input, []);

		expect(score).toHaveProperty("novelty");
		expect(score).toHaveProperty("confidence");
		expect(score).toHaveProperty("urgency");
		expect(score).toHaveProperty("feasibility");
		expect(score).toHaveProperty("total");
		expect(typeof score.novelty).toBe("number");
		expect(typeof score.total).toBe("number");
		expect(score.total).toBeGreaterThanOrEqual(0);
		expect(score.total).toBeLessThanOrEqual(1);
	});

	test("score is consistent with sub-calculations", async () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();
		const existing = [makeExistingProposal()];

		const score = await engine.score(input, existing);
		const directNovelty = engine.calculateNovelty(input, existing);
		const directConfidence = engine.calculateConfidence(input.evidence);
		const directUrgency = engine.calculateUrgency(input);
		const directFeasibility = engine.calculateFeasibility(input);

		expect(score.novelty).toBe(directNovelty);
		expect(score.confidence).toBe(directConfidence);
		expect(score.urgency).toBe(directUrgency);
		expect(score.feasibility).toBe(directFeasibility);
	});

	test("context affects scoring dimensions", async () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput({
			relatedGoalIds: ["goal-001"],
			evidence: makeEvidence({ observationIds: ["obs-001"], confidence: 0.9 }),
		});

		const scoreWithContext = await engine.score(input, [], {
			goals: [{ id: "goal-001" }],
			autonomyLevel: 4,
		});
		const scoreWithoutContext = await engine.score(input, [], {
			goals: [],
			autonomyLevel: 0,
		});

		// Context should increase urgency (goals) and feasibility (autonomy)
		expect(scoreWithContext.urgency).toBeGreaterThanOrEqual(scoreWithoutContext.urgency);
		expect(scoreWithContext.feasibility).toBeGreaterThanOrEqual(scoreWithoutContext.feasibility);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("proposal with no evidence refs scores low confidence", () => {
		const engine = new ProposalScoringEngine();
		const evidence = makeEvidence({
			memoryIds: [],
			observationIds: [],
			sourceRefs: [],
			confidence: 1.0,
		});
		const score = engine.calculateConfidence(evidence);
		expect(score).toBeLessThan(0.5);
	});

	test("novelty with many identical proposals scores near zero", () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput({
			type: "memory_proposal",
			title: "Common title",
			description: "Common description text",
		});

		// Create 5 very similar proposals
		const existing = Array.from({ length: 5 }, () =>
			makeExistingProposal({
				type: "memory_proposal",
				title: "Common title",
				description: "Common description text",
			}),
		);

		const novelty = engine.calculateNovelty(input, existing);
		expect(novelty).toBeLessThan(0.3);
	});

	test("setConfig affects scoring results", async () => {
		const engine = new ProposalScoringEngine();
		const input = makeCreateInput();

		engine.setConfig({ weights: { novelty: 1.0, confidence: 0, urgency: 0, feasibility: 0 } });
		const after = await engine.score(input, []);

		// With novelty weight of 1.0, total should equal novelty
		expect(after.total).toBe(after.novelty);
	});

	test("shouldAutoQueue with minimum boundary values", () => {
		const engine = new ProposalScoringEngine();
		// Exactly at thresholds
		const atThreshold = { total: 0.7, confidence: 0.6, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(atThreshold)).toBe(true);

		// Just below thresholds
		const belowTotal = { total: 0.699, confidence: 0.6, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(belowTotal)).toBe(false);

		// Just below confidence
		const belowConfidence = { total: 0.7, confidence: 0.599, novelty: 0, urgency: 0, feasibility: 0 };
		expect(engine.shouldAutoQueue(belowConfidence)).toBe(false);
	});

	test("empty createInput with no existing proposals gives valid scores", async () => {
		const engine = new ProposalScoringEngine();
		// Minimal valid input
		const input = makeCreateInput();
		const score = await engine.score(input, []);
		expect(score.total).toBeGreaterThanOrEqual(0);
		expect(score.total).toBeLessThanOrEqual(1);
	});
});
