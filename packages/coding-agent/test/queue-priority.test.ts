/**
 * Tests for Queue Priority & Critical-Path Scoring - P2 Workstream 6.C
 *
 * Covers:
 * - AC1: Computes criticalPathRank (longest path to leaf)
 * - AC2: Computes unlockImpact (transitive dependents)
 * - AC3: Estimates validationCost and conflictRisk
 * - AC4: Scoring is deterministic
 */

import { describe, expect, it } from "vitest";
import type { Workspace } from "../src/core/workspace-schema.js";
import {
	buildGraph,
	computeConflictRisks,
	computeCriticalPathRanks,
	computeUnlockImpact,
	computeValidationCost,
	scoreWorkspaces,
} from "../src/integration/queue-priority.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/**
 * Simple chain: A -> B -> C
 * A has no dependencies, B depends on A, C depends on B.
 */
function chainFixture(): Workspace[] {
	return [
		{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "C", title: "Workspace C", dependencies: ["B"], roleBudget: "worker" as const, maxRetries: 3 },
	];
}

/**
 * Diamond: A -> B, C -> D
 * A has no dependencies, B depends on A, C depends on A, D depends on B and C.
 */
function diamondFixture(): Workspace[] {
	return [
		{ id: "A", title: "Root", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "B", title: "Left Child", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "C", title: "Right Child", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "D", title: "Leaf", dependencies: ["B", "C"], roleBudget: "worker" as const, maxRetries: 3 },
	];
}

/**
 * Two independent chains: [A -> B -> C] and [X -> Y]
 */
function independentChainsFixture(): Workspace[] {
	return [
		{ id: "A", title: "A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "C", title: "C", dependencies: ["B"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "X", title: "X", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "Y", title: "Y", dependencies: ["X"], roleBudget: "worker" as const, maxRetries: 3 },
	];
}

/**
 * Complex graph: A -> B, C; B -> D; C -> D, E; D -> F; E -> F
 */
function complexFixture(): Workspace[] {
	return [
		{ id: "A", title: "Root", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "C", title: "C", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "D", title: "D", dependencies: ["B", "C"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "E", title: "E", dependencies: ["C"], roleBudget: "worker" as const, maxRetries: 3 },
		{ id: "F", title: "F", dependencies: ["D", "E"], roleBudget: "worker" as const, maxRetries: 3 },
	];
}

/**
 * Workspaces with risk levels for validation cost tests.
 */
function riskFixture(): Workspace[] {
	return [
		{
			id: "LOW",
			title: "Low Risk",
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
			riskLevel: "low",
			acceptanceCriteria: ["c1"],
		},
		{
			id: "MED",
			title: "Medium Risk",
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
			riskLevel: "medium",
			acceptanceCriteria: ["c1", "c2", "c3"],
		},
		{
			id: "HIGH",
			title: "High Risk",
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
			riskLevel: "high",
			acceptanceCriteria: ["c1", "c2", "c3", "c4", "c5"],
			capabilities: { canEdit: ["src/a.ts", "src/b.ts", "src/c.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
		},
	];
}

// ---------------------------------------------------------------------------
// AC1: criticalPathRank
// ---------------------------------------------------------------------------

describe("AC1: criticalPathRank", () => {
	it("should compute rank 0 for leaf nodes (no dependents) in a chain", () => {
		const graph = buildGraph(chainFixture());
		const ranks = computeCriticalPathRanks(graph);

		// C is a leaf (no dependents)
		expect(ranks.get("C")).toBe(0);
	});

	it("should compute rank 1 for nodes with only leaf dependents", () => {
		const graph = buildGraph(chainFixture());
		const ranks = computeCriticalPathRanks(graph);

		// B has one dependent (C) which is a leaf
		expect(ranks.get("B")).toBe(1);
	});

	it("should compute rank 2 for root node in a chain of 3", () => {
		const graph = buildGraph(chainFixture());
		const ranks = computeCriticalPathRanks(graph);

		// A's longest path to a leaf: A->B->C = 2
		expect(ranks.get("A")).toBe(2);
	});

	it("should rank merge nodes higher in a diamond graph", () => {
		const graph = buildGraph(diamondFixture());
		const ranks = computeCriticalPathRanks(graph);

		// D is leaf: rank 0
		expect(ranks.get("D")).toBe(0);
		// B and C have D as dependent: rank 1
		expect(ranks.get("B")).toBe(1);
		expect(ranks.get("C")).toBe(1);
		// A's longest path: A->B->D (2) or A->C->D (2)
		expect(ranks.get("A")).toBe(2);
	});

	it("should compute ranks independently for separate chains", () => {
		const graph = buildGraph(independentChainsFixture());
		const ranks = computeCriticalPathRanks(graph);

		// C is leaf in first chain: rank 0
		expect(ranks.get("C")).toBe(0);
		// B->C: rank 1
		expect(ranks.get("B")).toBe(1);
		// A->B->C: rank 2
		expect(ranks.get("A")).toBe(2);
		// Y is leaf in second chain: rank 0
		expect(ranks.get("Y")).toBe(0);
		// X->Y: rank 1
		expect(ranks.get("X")).toBe(1);
	});

	it("should compute ranks for a complex graph with multiple paths", () => {
		const graph = buildGraph(complexFixture());
		const ranks = computeCriticalPathRanks(graph);

		// F is leaf: rank 0
		expect(ranks.get("F")).toBe(0);
		// D->F and E->F: both rank 1
		expect(ranks.get("D")).toBe(1);
		expect(ranks.get("E")).toBe(1);
		// B->D->F: rank 2
		expect(ranks.get("B")).toBe(2);
		// C's longest path: C->E->F (2) or C->D->F (2)
		expect(ranks.get("C")).toBe(2);
		// A's longest path: A->C->E->F (3) or A->C->D->F (3) or A->B->D->F (3)
		expect(ranks.get("A")).toBe(3);
	});

	it("should handle empty graph", () => {
		const graph = buildGraph([]);
		const ranks = computeCriticalPathRanks(graph);
		expect(ranks.size).toBe(0);
	});

	it("should handle isolated nodes (no dependencies, no dependents)", () => {
		const workspaces = [
			{ id: "ISO1", title: "Isolated 1", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
			{ id: "ISO2", title: "Isolated 2", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		];
		const graph = buildGraph(workspaces);
		const ranks = computeCriticalPathRanks(graph);

		expect(ranks.get("ISO1")).toBe(0);
		expect(ranks.get("ISO2")).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC2: unlockImpact
// ---------------------------------------------------------------------------

describe("AC2: unlockImpact", () => {
	it("should compute 0 unlock impact for leaf nodes", () => {
		const graph = buildGraph(chainFixture());
		const impacts = computeUnlockImpact(graph);

		expect(impacts.get("C")).toBe(0);
	});

	it("should compute 1 unlock impact for node with one direct dependent", () => {
		const graph = buildGraph(chainFixture());
		const impacts = computeUnlockImpact(graph);

		// B has C as dependent = 1
		expect(impacts.get("B")).toBe(1);
	});

	it("should compute transitive unlock impact for root of chain", () => {
		const graph = buildGraph(chainFixture());
		const impacts = computeUnlockImpact(graph);

		// A has B and C as transitive dependents = 2
		expect(impacts.get("A")).toBe(2);
	});

	it("should compute unlock impact for diamond graph", () => {
		const graph = buildGraph(diamondFixture());
		const impacts = computeUnlockImpact(graph);

		// D is leaf: 0
		expect(impacts.get("D")).toBe(0);
		// B has D: 1
		expect(impacts.get("B")).toBe(1);
		// C has D: 1
		expect(impacts.get("C")).toBe(1);
		// A has B, C, D: 3
		expect(impacts.get("A")).toBe(3);
	});

	it("should compute unlock impact for complex graph", () => {
		const graph = buildGraph(complexFixture());
		const impacts = computeUnlockImpact(graph);

		// F is leaf: 0
		expect(impacts.get("F")).toBe(0);
		// D has F: 1
		expect(impacts.get("D")).toBe(1);
		// E has F: 1
		expect(impacts.get("E")).toBe(1);
		// B has D, F: 2
		expect(impacts.get("B")).toBe(2);
		// C has D, E, F: 3
		expect(impacts.get("C")).toBe(3);
		// A has B, C, D, E, F: 5
		expect(impacts.get("A")).toBe(5);
	});

	it("should handle empty graph", () => {
		const graph = buildGraph([]);
		const impacts = computeUnlockImpact(graph);
		expect(impacts.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC3: validationCost and conflictRisk
// ---------------------------------------------------------------------------

describe("AC3: validationCost and conflictRisk", () => {
	describe("computeValidationCost", () => {
		it("should compute low validation cost for low-risk workspace", () => {
			const ws: Workspace = {
				id: "T1",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "low",
			};

			const cost = computeValidationCost(ws);
			// riskWeight=1 * 5 + criteriaWeight=0 * 2 + editBreadth=0 * 1 = 5
			expect(cost).toBe(5);
		});

		it("should compute medium validation cost for medium-risk workspace", () => {
			const ws: Workspace = {
				id: "T2",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "medium",
				acceptanceCriteria: ["c1", "c2"],
			};

			const cost = computeValidationCost(ws);
			// riskWeight=2 * 5 + criteriaWeight=2 * 2 + editBreadth=0 * 1 = 10 + 4 = 14
			expect(cost).toBe(14);
		});

		it("should compute high validation cost for high-risk workspace", () => {
			const ws: Workspace = {
				id: "T3",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "high",
				acceptanceCriteria: ["c1", "c2", "c3", "c4", "c5"],
				capabilities: {
					canEdit: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const cost = computeValidationCost(ws);
			// riskWeight=3 * 5 + criteriaWeight=5 * 2 + editBreadth=4 * 1 = 15 + 10 + 4 = 29
			expect(cost).toBe(29);
		});

		it("should default to low risk when riskLevel is undefined", () => {
			const ws: Workspace = {
				id: "T4",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const cost = computeValidationCost(ws);
			expect(cost).toBe(5); // Same as low risk
		});

		it("should cap acceptance criteria at 10", () => {
			const ws: Workspace = {
				id: "T5",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "low",
				acceptanceCriteria: Array.from({ length: 20 }, (_, i) => `c${i + 1}`),
			};

			const cost = computeValidationCost(ws);
			// riskWeight=1 * 5 + criteriaWeight=10 (capped) * 2 + editBreadth=0 = 5 + 20 = 25
			expect(cost).toBe(25);
		});

		it("should cap edit breadth at 10", () => {
			const ws: Workspace = {
				id: "T6",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "low",
				capabilities: {
					canEdit: Array.from({ length: 20 }, (_, i) => `src/file${i + 1}.ts`),
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const cost = computeValidationCost(ws);
			// riskWeight=1 * 5 + criteriaWeight=0 + editBreadth=10 (capped) = 5 + 10 = 15
			expect(cost).toBe(15);
		});
	});

	describe("computeConflictRisks", () => {
		it("should compute 0 risk when workspace edits nothing and has no criteria", () => {
			const ws: Workspace = {
				id: "T1",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "low",
			};

			const graph = buildGraph([ws]);
			const risks = computeConflictRisks(graph, [ws]);

			expect(risks.get("T1")).toBe(0);
		});

		it("should compute higher risk for workspaces with more edits", () => {
			const ws1: Workspace = {
				id: "SMALL",
				title: "Small",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "low",
				capabilities: { canEdit: ["src/a.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			};
			const ws2: Workspace = {
				id: "LARGE",
				title: "Large",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "low",
				capabilities: {
					canEdit: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const graph = buildGraph([ws1, ws2]);
			const risks = computeConflictRisks(graph, [ws1, ws2]);

			const smallRisk = risks.get("SMALL") ?? 0;
			const largeRisk = risks.get("LARGE") ?? 0;
			expect(largeRisk).toBeGreaterThan(smallRisk);
		});

		it("should boost risk for high-risk workspaces", () => {
			const ws1: Workspace = {
				id: "LOW",
				title: "Low",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "low",
			};
			const ws2: Workspace = {
				id: "HIGH",
				title: "High",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "high",
			};

			const graph = buildGraph([ws1, ws2]);
			const risks = computeConflictRisks(graph, [ws1, ws2]);

			const lowRisk = risks.get("LOW") ?? 0;
			const highRisk = risks.get("HIGH") ?? 0;
			expect(highRisk).toBeGreaterThan(lowRisk);
		});

		it("should clamp risk to [0, 1]", () => {
			const ws: Workspace = {
				id: "BIG",
				title: "BIG",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				riskLevel: "high",
				capabilities: {
					canEdit: Array.from({ length: 100 }, (_, i) => `src/file${i + 1}.ts`),
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
				acceptanceCriteria: Array.from({ length: 100 }, (_, i) => `c${i + 1}`),
			};

			const graph = buildGraph([ws]);
			const risks = computeConflictRisks(graph, [ws]);

			const risk = risks.get("BIG") ?? 0;
			expect(risk).toBeGreaterThanOrEqual(0);
			expect(risk).toBeLessThanOrEqual(1);
		});

		it("should handle empty workspace list", () => {
			const graph = buildGraph([]);
			const risks = computeConflictRisks(graph, []);
			expect(risks.size).toBe(0);
		});
	});
});

// ---------------------------------------------------------------------------
// AC4: Deterministic scoring
// ---------------------------------------------------------------------------

describe("AC4: Deterministic scoring", () => {
	it("should produce identical scores when called multiple times with same input", () => {
		const fixtures = [chainFixture(), diamondFixture(), complexFixture()];

		for (const workspaces of fixtures) {
			const result1 = scoreWorkspaces(workspaces);
			const result2 = scoreWorkspaces(workspaces);
			const result3 = scoreWorkspaces(workspaces);

			expect(result1).toEqual(result2);
			expect(result2).toEqual(result3);
		}
	});

	it("should produce identical scores regardless of input order", () => {
		const workspaces = complexFixture();
		const reversed = [...workspaces].reverse();
		const shuffled = [workspaces[3]!, workspaces[0]!, workspaces[4]!, workspaces[2]!, workspaces[1]!, workspaces[5]!];

		const resultOriginal = scoreWorkspaces(workspaces);
		const resultReversed = scoreWorkspaces(reversed);
		const resultShuffled = scoreWorkspaces(shuffled);

		// Individual scores should be identical per workspace ID
		const mapOriginal = new Map(resultOriginal.map((s) => [s.workspaceId, s]));
		const mapReversed = new Map(resultReversed.map((s) => [s.workspaceId, s]));
		const mapShuffled = new Map(resultShuffled.map((s) => [s.workspaceId, s]));

		for (const [id, score] of mapOriginal) {
			expect(mapReversed.get(id)).toEqual(score);
			expect(mapShuffled.get(id)).toEqual(score);
		}
	});

	it("should sort by totalScore descending with same ID tiebreak", () => {
		const workspaces = complexFixture();
		const scores = scoreWorkspaces(workspaces);

		for (let i = 1; i < scores.length; i++) {
			const prev = scores[i - 1]!;
			const curr = scores[i]!;

			if (curr.totalScore === prev.totalScore) {
				// Tiebreak by workspaceId
				expect(curr.workspaceId.localeCompare(prev.workspaceId)).toBeGreaterThanOrEqual(0);
			} else {
				expect(curr.totalScore).toBeLessThanOrEqual(prev.totalScore);
			}
		}
	});

	it("should produce same deterministic results from isolated test data", () => {
		// This test runs the same assertions from AC1 tests to verify
		// that the scoring function produces the same results as the
		// individual component calls.

		const chainWorkspaces = chainFixture();
		const chainScores = scoreWorkspaces(chainWorkspaces);

		expect(chainScores.length).toBe(3);

		const scoreA = chainScores.find((s) => s.workspaceId === "A");
		const scoreB = chainScores.find((s) => s.workspaceId === "B");
		const scoreC = chainScores.find((s) => s.workspaceId === "C");

		expect(scoreA?.criticalPathRank).toBe(2);
		expect(scoreB?.criticalPathRank).toBe(1);
		expect(scoreC?.criticalPathRank).toBe(0);

		expect(scoreA?.unlockImpact).toBe(2);
		expect(scoreB?.unlockImpact).toBe(1);
		expect(scoreC?.unlockImpact).toBe(0);
	});

	it("should not mutate the input workspaces array", () => {
		const workspaces = chainFixture();
		const originalLength = workspaces.length;
		const originalIds = workspaces.map((w) => w.id);

		scoreWorkspaces(workspaces);

		expect(workspaces.length).toBe(originalLength);
		expect(workspaces.map((w) => w.id)).toEqual(originalIds);
	});

	it("should handle empty workspace array", () => {
		const scores = scoreWorkspaces([]);
		expect(scores).toEqual([]);
	});

	it("should handle custom scoring config", () => {
		const workspaces = chainFixture();
		const scores1 = scoreWorkspaces(workspaces, { criticalPathWeight: 10, unlockImpactWeight: 1 });
		const scores2 = scoreWorkspaces(workspaces); // Default config

		// Scores should differ with different config
		const totalA1 = scores1.find((s) => s.workspaceId === "A")?.totalScore ?? 0;
		const totalA2 = scores2.find((s) => s.workspaceId === "A")?.totalScore ?? 0;
		expect(totalA1).not.toBe(totalA2);
	});
});

// ---------------------------------------------------------------------------
// Integration: Full scoring pipeline
// ---------------------------------------------------------------------------

describe("Full scoring pipeline", () => {
	it("should produce all four score dimensions for each workspace", () => {
		const workspaces = complexFixture();
		const scores = scoreWorkspaces(workspaces);

		expect(scores.length).toBe(workspaces.length);

		for (const score of scores) {
			expect(score.workspaceId).toBeTruthy();
			expect(typeof score.criticalPathRank).toBe("number");
			expect(typeof score.unlockImpact).toBe("number");
			expect(typeof score.validationCost).toBe("number");
			expect(typeof score.conflictRisk).toBe("number");
			expect(typeof score.totalScore).toBe("number");
		}
	});

	it("should rank root workspace highest in chain graph", () => {
		const scores = scoreWorkspaces(chainFixture());

		// A should be first (highest priority)
		expect(scores[0]?.workspaceId).toBe("A");
		expect(scores[0]?.totalScore).toBeGreaterThan(scores[1]?.totalScore ?? 0);
	});

	it("should rank root workspace highest in diamond graph", () => {
		const scores = scoreWorkspaces(diamondFixture());

		expect(scores[0]?.workspaceId).toBe("A");
	});

	it("should rank deeper-root higher in independent chains", () => {
		const scores = scoreWorkspaces(independentChainsFixture());

		// A (chain of 3) should rank higher than X (chain of 2)
		const scoreA = scores.find((s) => s.workspaceId === "A");
		const scoreX = scores.find((s) => s.workspaceId === "X");

		expect(scoreA?.totalScore).toBeGreaterThan(scoreX?.totalScore ?? 0);
	});

	it("should include validation cost and conflict risk in composite score", () => {
		const workspaces = riskFixture();
		const scores = scoreWorkspaces(workspaces);

		// HIGH should have higher validation cost but also higher conflict risk
		const scoreHigh = scores.find((s) => s.workspaceId === "HIGH");
		const scoreLow = scores.find((s) => s.workspaceId === "LOW");

		expect(scoreHigh?.validationCost).toBeGreaterThan(scoreLow?.validationCost ?? 0);
		expect(scoreHigh?.conflictRisk).toBeGreaterThanOrEqual(scoreLow?.conflictRisk ?? 0);
	});
});

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------

describe("buildGraph", () => {
	it("should create nodes for all workspaces", () => {
		const graph = buildGraph(chainFixture());
		expect(graph.size).toBe(3);
	});

	it("should populate dependencies correctly", () => {
		const graph = buildGraph(chainFixture());
		expect(graph.get("A")?.dependencies).toEqual([]);
		expect(graph.get("B")?.dependencies).toEqual(["A"]);
		expect(graph.get("C")?.dependencies).toEqual(["B"]);
	});

	it("should populate dependents (reverse edges) correctly", () => {
		const graph = buildGraph(chainFixture());
		expect(graph.get("A")?.dependents).toEqual(["B"]);
		expect(graph.get("B")?.dependents).toEqual(["C"]);
		expect(graph.get("C")?.dependents).toEqual([]);
	});

	it("should handle workspaces with no dependencies", () => {
		const workspaces = [
			{ id: "ROOT1", title: "R1", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
			{ id: "ROOT2", title: "R2", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		];
		const graph = buildGraph(workspaces);

		expect(graph.get("ROOT1")?.dependents).toEqual([]);
		expect(graph.get("ROOT2")?.dependents).toEqual([]);
	});

	it("should ignore references to non-existent workspaces", () => {
		const workspaces = [
			{ id: "A", title: "A", dependencies: ["NONEXISTENT"], roleBudget: "worker" as const, maxRetries: 3 },
		];
		const graph = buildGraph(workspaces);

		expect(graph.get("A")?.dependencies).toEqual(["NONEXISTENT"]);
	});
});
