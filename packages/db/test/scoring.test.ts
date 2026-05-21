/**
 * Scoring Engine unit tests.
 *
 * Tests the ProposalScorer and ProposalRankingEngine with pure logic
 * (no database dependency).
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { ProposalRankingEngine, ProposalScorer } from "../src/scoring/index.js";
import type { ProposalRubric, RubricCriterion } from "../src/types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function createDefaultCriteria(): RubricCriterion[] {
	return [
		{ name: "quality", description: "Overall quality of the proposal", weight: 0.4, max_score: 10 },
		{ name: "feasibility", description: "How feasible the proposal is", weight: 0.3, max_score: 10 },
		{ name: "impact", description: "Expected impact of the proposal", weight: 0.3, max_score: 10 },
	];
}

function createDefaultRubric(overrides?: Partial<ProposalRubric>): ProposalRubric {
	return {
		id: "rubric-1",
		project_id: "project-1",
		name: "Standard Rubric",
		description: "Standard evaluation rubric",
		criteria: createDefaultCriteria(),
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

// ── ProposalScorer Tests ────────────────────────────────────────────────────

describe("ProposalScorer", () => {
	const scorer = new ProposalScorer();

	it("scores a proposal with default scoring (evidence present)", () => {
		const rubric = createDefaultRubric();
		const proposal = {
			id: "prop-1",
			title: "Test Proposal",
			evidence: { key: "value" },
			source_artifacts: [],
		};

		const result = scorer.score({ proposal, rubric });

		assert.strictEqual(result.proposal_id, "prop-1");
		assert.strictEqual(result.rubric_id, "rubric-1");
		assert.strictEqual(result.scores.length, 3);
		assert.strictEqual(result.scored_by, "engine");
		assert.ok(result.total_score > 0);
		assert.ok(result.total_score <= 100);
		assert.ok(result.summary.length > 0);
	});

	it("scores a proposal with default scoring (with artifacts)", () => {
		const rubric = createDefaultRubric();
		const proposal = {
			id: "prop-2",
			title: "Artifact Proposal",
			evidence: { analysis: "detailed" },
			source_artifacts: [
				{ path: "/tmp/report.json", label: "Report", type: "report", recorded_at: "2026-01-01T00:00:00.000Z" },
			],
		};

		const result = scorer.score({ proposal, rubric });

		assert.strictEqual(result.proposal_id, "prop-2");
		assert.ok(result.total_score > 50, `Expected score > 50, got ${result.total_score}`);
	});

	it("scores a proposal with default scoring (no evidence)", () => {
		const rubric = createDefaultRubric();
		const proposal = {
			id: "prop-3",
			title: "Empty Proposal",
			evidence: {},
			source_artifacts: [],
		};

		const result = scorer.score({ proposal, rubric });

		assert.strictEqual(result.proposal_id, "prop-3");
		// Baseline with no evidence should be 50% of max
		assert.strictEqual(result.total_score, 50);
	});

	it("accepts manual criterion scores", () => {
		const rubric = createDefaultRubric();
		const proposal = {
			id: "prop-4",
			title: "Manual Score Proposal",
			evidence: { data: "xyz" },
			source_artifacts: [],
		};

		const criterionScores = [
			{ criterion_name: "quality", score: 9, rationale: "High quality" },
			{ criterion_name: "feasibility", score: 7, rationale: "Moderately feasible" },
			{ criterion_name: "impact", score: 8, rationale: "Good impact" },
		];

		const result = scorer.score({ proposal, rubric, criterionScores });

		assert.strictEqual(result.scored_by, "manual");
		assert.strictEqual(result.scores.length, 3);
		// quality: 9/10 * 0.4 = 0.36, feasibility: 7/10 * 0.3 = 0.21, impact: 8/10 * 0.3 = 0.24
		// total: (0.36 + 0.21 + 0.24) / 1.0 * 100 = 81
		assert.strictEqual(result.total_score, 81);
	});

	it("throws on empty rubric criteria", () => {
		const rubric = createDefaultRubric({ criteria: [] });
		const proposal = {
			id: "prop-5",
			title: "Bad Proposal",
			evidence: { key: "value" },
			source_artifacts: [],
		};

		assert.throws(() => scorer.score({ proposal, rubric }), /Rubric "Standard Rubric" has no criteria defined/);
	});

	it("throws on unknown criterion name in manual scores", () => {
		const rubric = createDefaultRubric();
		const proposal = {
			id: "prop-6",
			title: "Bad Score",
			evidence: {},
			source_artifacts: [],
		};

		const criterionScores = [{ criterion_name: "nonexistent", score: 5, rationale: "N/A" }];

		assert.throws(
			() => scorer.score({ proposal, rubric, criterionScores }),
			/Criterion "nonexistent" not found in rubric/,
		);
	});

	it("scores multiple proposals in batch", () => {
		const rubric = createDefaultRubric();
		const proposals = [
			{ id: "prop-a", title: "A", evidence: {}, source_artifacts: [] },
			{ id: "prop-b", title: "B", evidence: { has: "data" }, source_artifacts: [] },
		];

		const results = scorer.scoreBatch(proposals, rubric);

		assert.strictEqual(results.length, 2);
		// prop-a has no evidence => baseline 50
		assert.strictEqual(results[0].total_score, 50);
		// prop-b has evidence => 70% of max
		assert.strictEqual(results[1].total_score, 70);
	});

	it("validates well-formed criteria", () => {
		const valid = createDefaultCriteria();
		const errors = scorer.validateCriteria(valid);
		assert.strictEqual(errors.length, 0);
	});

	it("validates malformed criteria", () => {
		const badCriteria: RubricCriterion[] = [{ name: "", description: "", weight: 0, max_score: 0 }];
		const errors = scorer.validateCriteria(badCriteria);
		assert.ok(errors.length > 0, "Expected validation errors");
	});

	it("validates criteria with wrong weight sum", () => {
		const badWeight: RubricCriterion[] = [
			{ name: "c1", description: "First", weight: 0.1, max_score: 10 },
			{ name: "c2", description: "Second", weight: 0.1, max_score: 10 },
		];
		const errors = scorer.validateCriteria(badWeight);
		assert.ok(
			errors.some((e) => e.includes("weights sum to")),
			"Expected weight sum error",
		);
	});
});

// ── ProposalRankingEngine Tests ─────────────────────────────────────────────

describe("ProposalRankingEngine", () => {
	const engine = new ProposalRankingEngine();

	it("ranks proposals by score descending", () => {
		const results = [
			{
				proposal_id: "prop-low",
				rubric_id: "rubric-1",
				scores: [],
				total_score: 50,
				max_score: 100,
				percentage: 50,
				summary: "Fair",
				scored_by: "engine",
			},
			{
				proposal_id: "prop-high",
				rubric_id: "rubric-1",
				scores: [],
				total_score: 90,
				max_score: 100,
				percentage: 90,
				summary: "Excellent",
				scored_by: "engine",
			},
			{
				proposal_id: "prop-mid",
				rubric_id: "rubric-1",
				scores: [],
				total_score: 70,
				max_score: 100,
				percentage: 70,
				summary: "Good",
				scored_by: "engine",
			},
		];

		const output = engine.rank({ results });

		assert.strictEqual(output.total, 3);
		assert.strictEqual(output.rankings[0].proposal_id, "prop-high");
		assert.strictEqual(output.rankings[1].proposal_id, "prop-mid");
		assert.strictEqual(output.rankings[2].proposal_id, "prop-low");
		assert.strictEqual(output.rankings[0].rank, 1);
		assert.strictEqual(output.rankings[1].rank, 2);
		assert.strictEqual(output.rankings[2].rank, 3);
	});

	it("handles empty results", () => {
		const output = engine.rank({ results: [] });
		assert.strictEqual(output.total, 0);
		assert.deepStrictEqual(output.rankings, []);
	});

	it("applies rubric weights", () => {
		const results = [
			{
				proposal_id: "prop-1",
				rubric_id: "rubric-a",
				scores: [],
				total_score: 80,
				max_score: 100,
				percentage: 80,
				summary: "Good",
				scored_by: "engine",
			},
			{
				proposal_id: "prop-1",
				rubric_id: "rubric-b",
				scores: [],
				total_score: 60,
				max_score: 100,
				percentage: 60,
				summary: "Fair",
				scored_by: "engine",
			},
		];

		// Weight rubric-a twice as much as rubric-b
		const output = engine.rank({
			results,
			rubricWeights: { "rubric-a": 2.0, "rubric-b": 1.0 },
		});

		// rubric-a: 80 * 2.0 = 160, rubric-b: 60 * 1.0 = 60
		assert.strictEqual(output.rankings.length, 2);
		assert.strictEqual(output.rankings[0].total_score, 160);
		assert.strictEqual(output.rankings[1].total_score, 60);
	});

	it("ranks from database scores", () => {
		const dbScores = [
			{
				id: "score-1",
				proposal_id: "prop-a",
				rubric_id: "rubric-1",
				scores: [],
				total_score: 85,
				max_score: 100,
				summary: "Good",
				scored_by: "engine",
				scored_at: "2026-02-01T00:00:00.000Z",
				created_at: "2026-02-01T00:00:00.000Z",
			},
			{
				id: "score-2",
				proposal_id: "prop-b",
				rubric_id: "rubric-1",
				scores: [],
				total_score: 65,
				max_score: 100,
				summary: "Fair",
				scored_by: "engine",
				scored_at: "2026-02-02T00:00:00.000Z",
				created_at: "2026-02-02T00:00:00.000Z",
			},
		];

		const output = engine.rankFromDbScores(dbScores as any);

		assert.strictEqual(output.total, 2);
		assert.strictEqual(output.rankings[0].proposal_id, "prop-a");
		assert.strictEqual(output.rankings[1].proposal_id, "prop-b");
	});

	it("uses latest score per proposal when ranking from DB", () => {
		const dbScores = [
			{
				id: "score-old",
				proposal_id: "prop-a",
				rubric_id: "rubric-1",
				scores: [],
				total_score: 50,
				max_score: 100,
				summary: "Old",
				scored_by: "engine",
				scored_at: "2026-01-01T00:00:00.000Z",
				created_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "score-new",
				proposal_id: "prop-a",
				rubric_id: "rubric-1",
				scores: [],
				total_score: 95,
				max_score: 100,
				summary: "New",
				scored_by: "engine",
				scored_at: "2026-02-01T00:00:00.000Z",
				created_at: "2026-02-01T00:00:00.000Z",
			},
		];

		const output = engine.rankFromDbScores(dbScores as any);

		assert.strictEqual(output.total, 1);
		assert.strictEqual(output.rankings[0].total_score, 95);
	});
});
