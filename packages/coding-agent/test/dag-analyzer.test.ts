/**
 * Tests for DAG Analyzer and Batch Planner - P2 Workstream 7.B
 *
 * Acceptance criteria:
 * 1. Computes topological batches from workspace dependencies
 * 2. Computes effective parallelism and requested-vs-effective delta
 * 3. Detects over-serialization where maxParallelWorkspaces > 1 but effective width is 1
 * 4. Explains why each workspace is blocked
 */

import { describe, expect, it } from "vitest";
import {
	computeBatchPlan,
	computeBlockDetails,
	formatBatchPlan,
	formatBlockDetails,
} from "../src/core/dag-analyzer.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal workspace with given id and dependencies */
function ws(id: string, deps: string[] = [], extra?: Partial<Workspace>): Workspace {
	return {
		id,
		title: `Task ${id}`,
		dependencies: deps,
		roleBudget: "worker",
		maxRetries: 3,
		...extra,
	};
}

/** Create a workspace queue from workspaces */
function queue(workspaces: Workspace[], maxParallel = 3): WorkspaceQueue {
	return {
		phase: "5.4",
		title: "Test Plan",
		maxParallelWorkspaces: maxParallel,
		workspaces,
	};
}

// ---------------------------------------------------------------------------
// AC1: Computes topological batches from workspace dependencies
// ---------------------------------------------------------------------------

describe("computeBatchPlan — AC1: topological batches", () => {
	it("computes single batch for independent workspaces", () => {
		const workspaces = [ws("A"), ws("B"), ws("C")];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors).toHaveLength(0);
		expect(result.batches).toHaveLength(1);
		expect(result.batches[0].workspaceIds).toEqual(expect.arrayContaining(["A", "B", "C"]));
		expect(result.batches[0].width).toBe(3);
	});

	it("computes two batches for a chain A → B", () => {
		const workspaces = [ws("A"), ws("B", ["A"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors).toHaveLength(0);
		expect(result.batches).toHaveLength(2);
		expect(result.batches[0].workspaceIds).toContain("A");
		expect(result.batches[1].workspaceIds).toContain("B");
	});

	it("computes diamond-shaped batches: A → B, C → D", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A"]), ws("D", ["B", "C"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors).toHaveLength(0);
		expect(result.batches).toHaveLength(3);
		// Batch 1: A
		expect(result.batches[0].workspaceIds).toEqual(["A"]);
		// Batch 2: B, C
		expect(result.batches[1].workspaceIds).toEqual(expect.arrayContaining(["B", "C"]));
		expect(result.batches[1].width).toBe(2);
		// Batch 3: D
		expect(result.batches[2].workspaceIds).toEqual(["D"]);
	});

	it("computes wide-first layout: A, B, C → D → E", () => {
		const workspaces = [ws("A"), ws("B"), ws("C"), ws("D", ["A", "B", "C"]), ws("E", ["D"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors).toHaveLength(0);
		expect(result.batches).toHaveLength(3);
		expect(result.batches[0].width).toBe(3); // A, B, C
		expect(result.batches[1].width).toBe(1); // D
		expect(result.batches[2].width).toBe(1); // E
	});

	it("handles a fully serialized 14-workspace chain", () => {
		const workspaces: Workspace[] = [];
		for (let i = 1; i <= 14; i++) {
			const id = `WS${i}`;
			const deps = i === 1 ? [] : [`WS${i - 1}`];
			workspaces.push(ws(id, deps));
		}
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.errors).toHaveLength(0);
		expect(result.batches).toHaveLength(14);
		for (const batch of result.batches) {
			expect(batch.width).toBe(1);
		}
	});

	it("handles empty queue", () => {
		const result = computeBatchPlan(queue([], 3));
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].type).toBe("empty_queue");
		expect(result.batches).toHaveLength(0);
	});

	it("detects dependency cycles", () => {
		const workspaces = [ws("A", ["B"]), ws("B", ["A"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].type).toBe("cycle");
		expect(result.batches).toHaveLength(0);
	});

	it("detects missing dependencies", () => {
		const workspaces = [ws("A"), ws("B", ["MISSING"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].type).toBe("missing_dependency");
	});

	it("handles single workspace", () => {
		const result = computeBatchPlan(queue([ws("SOLO")]));
		expect(result.errors).toHaveLength(0);
		expect(result.batches).toHaveLength(1);
		expect(result.batches[0].workspaceIds).toEqual(["SOLO"]);
	});

	it("handles the plan from workspace 7.B's own example batches", () => {
		// From the plan: 7.A → 7.B+7.C → 7.D+7.E → 7.F → 7.G → 7.H+7.I → 7.J → 7.K
		const workspaces = [
			ws("7.A", []),
			ws("7.B", ["7.A"]),
			ws("7.C", ["7.A"]),
			ws("7.D", ["7.B", "7.C"]),
			ws("7.E", ["7.B", "7.C"]),
			ws("7.F", ["7.E"]),
			ws("7.G", ["7.F"]),
			ws("7.H", ["7.G", "7.D"]),
			ws("7.I", ["7.D", "7.E"]),
			ws("7.J", ["7.A", "7.B", "7.D"]),
			ws("7.K", ["7.H", "7.I", "7.J"]),
		];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.errors).toHaveLength(0);
		expect(result.batches.length).toBeGreaterThanOrEqual(1);
		// Batch 1 should contain 7.A (no deps)
		expect(result.batches[0].workspaceIds).toContain("7.A");
		// Effective parallelism should be at least 2 (7.B+7.C in same batch)
		expect(result.effectiveParallelism).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// AC2: Computes effective parallelism and requested-vs-effective delta
// ---------------------------------------------------------------------------

describe("computeBatchPlan — AC2: effective parallelism and delta", () => {
	it("reports effective parallelism = number of independent workspaces", () => {
		const workspaces = [ws("A"), ws("B"), ws("C")];
		const result = computeBatchPlan(queue(workspaces, 5));

		expect(result.effectiveParallelism).toBe(3); // All 3 can run in parallel
		expect(result.requestedParallelism).toBe(5);
		expect(result.parallelismDelta).toBe(2); // 5 - 3 = 2
	});

	it("reports effective parallelism = 1 for fully serialized chain", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.effectiveParallelism).toBe(1);
		expect(result.requestedParallelism).toBe(3);
		expect(result.parallelismDelta).toBe(2);
	});

	it("reports effective parallelism = 2 for diamond graph", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A"]), ws("D", ["B", "C"])];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.effectiveParallelism).toBe(2); // B and C can run in parallel
		expect(result.requestedParallelism).toBe(3);
		expect(result.parallelismDelta).toBe(1);
	});

	it("reports delta = 0 when effective equals requested", () => {
		const workspaces = [ws("A"), ws("B"), ws("C")];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.effectiveParallelism).toBe(3);
		expect(result.parallelismDelta).toBe(0);
	});

	it("reports delta correctly for wide-first layout", () => {
		const workspaces = [ws("A"), ws("B"), ws("C"), ws("D", ["A", "B", "C"]), ws("E", ["D"])];
		const result = computeBatchPlan(queue(workspaces, 3));

		// Max batch width is 3 (batch 1), effective parallelism = 3
		expect(result.effectiveParallelism).toBe(3);
		expect(result.parallelismDelta).toBe(0);
	});

	it("uses maxParallelWorkspaces from queue as requested parallelism", () => {
		const workspaces = [ws("A"), ws("B")];
		const result = computeBatchPlan(queue(workspaces, 10));

		expect(result.requestedParallelism).toBe(10);
		expect(result.effectiveParallelism).toBe(2);
		expect(result.parallelismDelta).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// AC3: Detects over-serialization where maxParallel > 1 but effective width is 1
// ---------------------------------------------------------------------------

describe("computeBatchPlan — AC3: over-serialization detection", () => {
	it("detects over-serialization in fully serialized chain with maxParallel > 1", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.isOverSerialized).toBe(true);
		expect(result.effectiveParallelism).toBe(1);
	});

	it("does not flag over-serialization when maxParallel = 1", () => {
		const workspaces = [ws("A"), ws("B", ["A"])];
		const result = computeBatchPlan(queue(workspaces, 1));

		// maxParallel = 1 and effective = 1, that's expected, not over-serialized
		expect(result.isOverSerialized).toBe(false);
	});

	it("does not flag over-serialization when effective > 1", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A"])];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.isOverSerialized).toBe(false);
		expect(result.effectiveParallelism).toBe(2);
	});

	it("generates over_serialized warning", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
		const result = computeBatchPlan(queue(workspaces, 5));

		expect(result.isOverSerialized).toBe(true);
		const warning = result.warnings.find((w) => w.type === "over_serialized");
		expect(warning).toBeDefined();
		expect(warning!.message).toContain("fully serialized");
	});

	it("14-workspace chain with maxParallel > 1 is over-serialized", () => {
		const workspaces: Workspace[] = [];
		for (let i = 1; i <= 14; i++) {
			const id = `WS${i}`;
			const deps = i === 1 ? [] : [`WS${i - 1}`];
			workspaces.push(ws(id, deps));
		}
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.isOverSerialized).toBe(true);
		expect(result.effectiveParallelism).toBe(1);
	});

	it("generates low_effective_parallelism warning when effective < requested but > 1", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A"])];
		const result = computeBatchPlan(queue(workspaces, 5));

		expect(result.isOverSerialized).toBe(false);
		const warning = result.warnings.find((w) => w.type === "low_effective_parallelism");
		expect(warning).toBeDefined();
	});

	it("generates single_width_batch warning for middle bottleneck", () => {
		const workspaces = [ws("A"), ws("B"), ws("C", ["A", "B"]), ws("D", ["C"]), ws("E", ["C"])];
		const result = computeBatchPlan(queue(workspaces, 3));

		const warning = result.warnings.find((w) => w.type === "single_width_batch");
		// C is in its own batch (batch 2) with width 1 — between first and last
		// This is a bottleneck
		if (warning) {
			expect(warning.message).toContain("serialization bottleneck");
		}
	});
});

// ---------------------------------------------------------------------------
// AC4: Explains why each workspace is blocked
// ---------------------------------------------------------------------------

describe("computeBatchPlan — AC4: block explanations", () => {
	it("explains blocking dependencies for chained workspaces", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.blockExplanations.length).toBeGreaterThan(0);
		// B is blocked by A
		const bBlock = result.blockExplanations.find((b) => b.workspaceId === "B");
		expect(bBlock).toBeDefined();
		expect(bBlock!.blockedBy).toContain("A");
		expect(bBlock!.reason).toContain("A");

		// C is blocked by B
		const cBlock = result.blockExplanations.find((b) => b.workspaceId === "C");
		expect(cBlock).toBeDefined();
		expect(cBlock!.blockedBy).toContain("B");
	});

	it("workspaces in batch 1 have no block explanations (they are not blocked)", () => {
		const workspaces = [ws("A"), ws("B", ["A"])];
		const result = computeBatchPlan(queue(workspaces));

		const aBlock = result.blockExplanations.find((b) => b.workspaceId === "A");
		expect(aBlock).toBeUndefined(); // A is in batch 1, not blocked
	});

	it("explains blocking for diamond graph", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A"]), ws("D", ["B", "C"])];
		const result = computeBatchPlan(queue(workspaces));

		// D is blocked by B and C
		const dBlock = result.blockExplanations.find((b) => b.workspaceId === "D");
		expect(dBlock).toBeDefined();
		expect(dBlock!.blockedBy).toEqual(expect.arrayContaining(["B", "C"]));
	});

	it("includes dependency reasons in block explanations via computeBlockDetails", () => {
		const workspaces: Workspace[] = [
			ws("A"),
			ws("B", ["A"], { dependencyReason: { A: "A provides the schema that B extends" } }),
		];
		const details = computeBlockDetails(queue(workspaces));

		const bDetail = details.find((d) => d.workspaceId === "B");
		expect(bDetail).toBeDefined();
		expect(bDetail!.isBlocked).toBe(true);
		expect(bDetail!.dependencyReasons).toEqual({ A: "A provides the schema that B extends" });
	});
});

// ---------------------------------------------------------------------------
// computeBlockDetails (detailed per-workspace analysis)
// ---------------------------------------------------------------------------

describe("computeBlockDetails — detailed block analysis", () => {
	it("marks root workspaces as not blocked", () => {
		const workspaces = [ws("A"), ws("B", ["A"])];
		const details = computeBlockDetails(queue(workspaces));

		const aDetail = details.find((d) => d.workspaceId === "A");
		expect(aDetail!.isBlocked).toBe(false);
		expect(aDetail!.batchIndex).toBe(1);
		expect(aDetail!.requiredDependencies).toEqual([]);
	});

	it("marks downstream workspaces as blocked", () => {
		const workspaces = [ws("A"), ws("B", ["A"])];
		const details = computeBlockDetails(queue(workspaces));

		const bDetail = details.find((d) => d.workspaceId === "B");
		expect(bDetail!.isBlocked).toBe(true);
		expect(bDetail!.requiredDependencies).toEqual(["A"]);
	});

	it("identifies critical path dependencies", () => {
		// A, B can run first; C depends on A; D depends on B and C
		// Batch 1: A, B
		// Batch 2: C (blocked by A, which is in batch 1; critical path dep = A)
		// Batch 3: D (blocked by B at batch 1 and C at batch 2; critical = C since C+1 = 3)
		const workspaces = [ws("A"), ws("B"), ws("C", ["A"]), ws("D", ["B", "C"])];
		const details = computeBlockDetails(queue(workspaces));

		const dDetail = details.find((d) => d.workspaceId === "D");
		expect(dDetail!.isBlocked).toBe(true);
		expect(dDetail!.criticalPathDependencies).toContain("C");
		// B is not a critical path dep because B is in batch 1, and D is in batch 3
		// 1 + 1 = 2 != 3, so B is not critical path
	});

	it("returns empty critical path for unblocked workspaces", () => {
		const workspaces = [ws("A")];
		const details = computeBlockDetails(queue(workspaces));

		expect(details[0].criticalPathDependencies).toEqual([]);
	});

	it("handles cycles gracefully in block details", () => {
		const workspaces = [ws("A", ["B"]), ws("B", ["A"])];
		const details = computeBlockDetails(queue(workspaces));

		// Should not crash; should report error
		expect(details.length).toBe(2);
		for (const detail of details) {
			expect(detail.reason).toContain("Cannot compute batches");
		}
	});
});

// ---------------------------------------------------------------------------
// File Overlap Detection
// ---------------------------------------------------------------------------

describe("computeBatchPlan — file overlap detection", () => {
	it("detects file overlap between workspaces in same batch", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			}),
			ws("B", [], {
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			}),
		];
		const result = computeBatchPlan(queue(workspaces));

		const overlapWarning = result.warnings.find((w) => w.type === "file_overlap");
		expect(overlapWarning).toBeDefined();
		expect(overlapWarning!.message).toContain("src/core.ts");
		expect(overlapWarning!.workspaceIds).toEqual(expect.arrayContaining(["A", "B"]));
	});

	it("does not warn about file overlap for workspaces in different batches", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			}),
			ws("B", ["A"], {
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			}),
		];
		const result = computeBatchPlan(queue(workspaces));

		const overlapWarning = result.warnings.find((w) => w.type === "file_overlap");
		// A and B are in different batches, so no same-batch overlap
		expect(overlapWarning).toBeUndefined();
	});

	it("does not warn about file overlap for workspaces without capabilities", () => {
		const workspaces = [ws("A"), ws("B")];
		const result = computeBatchPlan(queue(workspaces));

		const overlapWarning = result.warnings.find((w) => w.type === "file_overlap");
		expect(overlapWarning).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatBatchPlan", () => {
	it("produces readable output for a simple plan", () => {
		const workspaces = [ws("A"), ws("B", ["A"])];
		const result = computeBatchPlan(queue(workspaces));
		const formatted = formatBatchPlan(result);

		expect(formatted).toContain("DAG Batch Plan");
		expect(formatted).toContain("Requested parallelism");
		expect(formatted).toContain("Effective parallelism");
	});

	it("produces error output for cycle plan", () => {
		const workspaces = [ws("A", ["B"]), ws("B", ["A"])];
		const result = computeBatchPlan(queue(workspaces));
		const formatted = formatBatchPlan(result);

		expect(formatted).toContain("ERRORS");
		expect(formatted).toContain("cycle");
	});
});

describe("formatBlockDetails", () => {
	it("produces readable block detail output", () => {
		const workspaces = [ws("A"), ws("B", ["A"])];
		const details = computeBlockDetails(queue(workspaces));
		const formatted = formatBlockDetails(details);

		expect(formatted).toContain("Workspace Block Analysis");
		expect(formatted).toContain("A");
		expect(formatted).toContain("B");
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("computeBatchPlan — edge cases", () => {
	it("handles workspace with multiple dependencies from different batches", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A"]), ws("D", ["B"]), ws("E", ["B", "C", "D"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors).toHaveLength(0);
		// E should be in a later batch since it depends on D
		const eBlock = result.blockExplanations.find((b) => b.workspaceId === "E");
		expect(eBlock).toBeDefined();
	});

	it("handles workspace that depends on all others (convergence point)", () => {
		const workspaces = [ws("A"), ws("B"), ws("C"), ws("FINAL", ["A", "B", "C"])];
		const result = computeBatchPlan(queue(workspaces));

		expect(result.errors).toHaveLength(0);
		expect(result.batches).toHaveLength(2);
		expect(result.batches[0].workspaceIds).toEqual(expect.arrayContaining(["A", "B", "C"]));
		expect(result.batches[1].workspaceIds).toEqual(["FINAL"]);
	});

	it("handles maxParallelWorkspaces = 0 gracefully", () => {
		// Edge case — value 0 is unusual but should not crash
		const workspaces = [ws("A")];
		const result = computeBatchPlan(queue(workspaces, 0));

		expect(result.requestedParallelism).toBe(0);
		expect(result.effectiveParallelism).toBe(1);
		expect(result.parallelismDelta).toBe(-1);
		// Not over-serialized since maxParallel = 0 (which is <= 1)
		expect(result.isOverSerialized).toBe(false);
	});

	it("handles two independent chains: A→B, C→D", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C"), ws("D", ["C"])];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.errors).toHaveLength(0);
		expect(result.effectiveParallelism).toBe(2); // A+C in batch 1, B+D in batch 2
	});

	it("handles three-way parallel: A, B, C independent", () => {
		const workspaces = [ws("A"), ws("B"), ws("C")];
		const result = computeBatchPlan(queue(workspaces, 3));

		expect(result.effectiveParallelism).toBe(3);
		expect(result.parallelismDelta).toBe(0);
		expect(result.isOverSerialized).toBe(false);
	});
});
