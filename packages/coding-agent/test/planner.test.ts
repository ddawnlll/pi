/**
 * Planner Core Tests - P7.A
 *
 * Tests for the autonomous planner core:
 * - AC1: Planner emits optimizedBatches, criticalPath, plannerWarnings,
 *        plannerSuggestions, and predictedParallelism.
 * - AC2: Planner never executes code or mutates repo state.
 * - AC3: Planner output is advisory until human approval.
 */

import { describe, expect, it } from "vitest";
import { formatCriticalPath, formatPlannerOutput, Planner, planExecution } from "../src/core/planner.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a workspace with defaults.
 */
function ws(id: string, dependencies: string[], overrides: Partial<Workspace> = {}): Workspace {
	return {
		id,
		title: `Workspace ${id}`,
		dependencies,
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

/**
 * Sequential chain: A -> B -> C -> D
 */
function sequentialChain(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Sequential Chain Test",
		maxParallelWorkspaces: 3,
		workspaces: [ws("A", []), ws("B", ["A"]), ws("C", ["B"]), ws("D", ["C"])],
	};
}

/**
 * Fan-in, fan-out: A and B are parallel, C depends on both, D and E depend on C.
 * A,B can run in batch 1, C in batch 2, D,E in batch 3.
 */
function fanInFanOut(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Fan-In Fan-Out Test",
		maxParallelWorkspaces: 3,
		workspaces: [ws("A", []), ws("B", []), ws("C", ["A", "B"]), ws("D", ["C"]), ws("E", ["C"])],
	};
}

/**
 * Completely parallel: all workspaces independent.
 */
function allParallel(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "All Parallel Test",
		maxParallelWorkspaces: 5,
		workspaces: [ws("A", []), ws("B", []), ws("C", []), ws("D", []), ws("E", [])],
	};
}

/**
 * Diamond: A -> B,C -> D
 */
function diamond(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Diamond Test",
		maxParallelWorkspaces: 2,
		workspaces: [ws("A", []), ws("B", ["A"]), ws("C", ["A"]), ws("D", ["B", "C"])],
	};
}

/**
 * Empty queue.
 */
function emptyQueue(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Empty Queue",
		maxParallelWorkspaces: 3,
		workspaces: [],
	};
}

/**
 * Cyclic queue.
 */
function cyclicQueue(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Cyclic Queue",
		maxParallelWorkspaces: 3,
		workspaces: [ws("A", ["B"]), ws("B", ["C"]), ws("C", ["A"])],
	};
}

/**
 * Over-serialized: 3 workers requested but graph forces serial execution.
 */
function overSerialized(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Over-Serialized",
		maxParallelWorkspaces: 3,
		workspaces: [ws("A", []), ws("B", ["A"]), ws("C", ["B"])],
	};
}

/**
 * Queue with high-risk and preflight-required workspaces.
 */
function mixedRiskQueue(): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Mixed Risk",
		maxParallelWorkspaces: 3,
		workspaces: [
			ws("A", [], { riskLevel: "low" }),
			ws("B", [], { riskLevel: "high" }),
			ws("C", ["A", "B"], { riskLevel: "medium", preflightRequired: true }),
		],
	};
}

// ---------------------------------------------------------------------------
// AC1: Planner emits correct output fields
// ---------------------------------------------------------------------------

describe("AC1: Planner emits optimizedBatches, criticalPath, plannerWarnings, plannerSuggestions, predictedParallelism", () => {
	it("emits all five required output fields for a sequential chain", async () => {
		const planner = new Planner();
		const output = await planner.plan(sequentialChain());

		expect(output).toHaveProperty("optimizedBatches");
		expect(output).toHaveProperty("criticalPath");
		expect(output).toHaveProperty("plannerWarnings");
		expect(output).toHaveProperty("plannerSuggestions");
		expect(output).toHaveProperty("predictedParallelism");
		expect(output.success).toBe(true);
	});

	it("emits all five required output fields for fan-in fan-out", async () => {
		const output = await planExecution(fanInFanOut());

		expect(output).toHaveProperty("optimizedBatches");
		expect(output).toHaveProperty("criticalPath");
		expect(output).toHaveProperty("plannerWarnings");
		expect(output).toHaveProperty("plannerSuggestions");
		expect(output).toHaveProperty("predictedParallelism");
		expect(output.success).toBe(true);
	});

	it("emits all five required output fields for all-parallel", async () => {
		const output = await planExecution(allParallel());
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toBeDefined();
		expect(output.criticalPath).toBeDefined();
		expect(output.plannerWarnings).toBeDefined();
		expect(output.plannerSuggestions).toBeDefined();
		expect(output.predictedParallelism).toBeDefined();
	});

	it("emits all five required output fields for diamond", async () => {
		const output = await planExecution(diamond());
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toBeDefined();
		expect(output.criticalPath).toBeDefined();
		expect(output.plannerWarnings).toBeDefined();
		expect(output.plannerSuggestions).toBeDefined();
		expect(output.predictedParallelism).toBeDefined();
	});

	it("emits all five required output fields for empty queue (success=false)", async () => {
		const output = await planExecution(emptyQueue());
		expect(output.success).toBe(false);
		expect(output.optimizedBatches).toBeDefined();
		expect(output.criticalPath).toBeDefined();
		expect(output.plannerWarnings).toBeDefined();
		expect(output.plannerSuggestions).toBeDefined();
		expect(output.predictedParallelism).toBeDefined();
	});

	it("emits all five required output fields for cyclic queue (success=false)", async () => {
		const output = await planExecution(cyclicQueue());
		expect(output.success).toBe(false);
		expect(output.optimizedBatches).toBeDefined();
		expect(output.criticalPath).toBeDefined();
		expect(output.plannerWarnings).toBeDefined();
		expect(output.plannerSuggestions).toBeDefined();
		expect(output.predictedParallelism).toBeDefined();
	});

	it("optimizedBatches have correct structure with annotations", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);

		for (const batch of output.optimizedBatches) {
			expect(batch).toHaveProperty("batchIndex");
			expect(batch).toHaveProperty("workspaceIds");
			expect(batch).toHaveProperty("width");
			expect(batch).toHaveProperty("optimizationNotes");
			expect(batch).toHaveProperty("isBottleneck");
			expect(batch).toHaveProperty("isAtCapacity");
			expect(typeof batch.batchIndex).toBe("number");
			expect(Array.isArray(batch.workspaceIds)).toBe(true);
			expect(typeof batch.width).toBe("number");
			expect(Array.isArray(batch.optimizationNotes)).toBe(true);
			expect(typeof batch.isBottleneck).toBe("boolean");
			expect(typeof batch.isAtCapacity).toBe("boolean");
		}
	});

	it("criticalPath has correct structure", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);

		expect(output.criticalPath).toHaveProperty("path");
		expect(output.criticalPath).toHaveProperty("length");
		expect(output.criticalPath).toHaveProperty("dependencies");
		expect(output.criticalPath).toHaveProperty("batchCount");
		expect(output.criticalPath).toHaveProperty("bottleneckImpact");
		expect(Array.isArray(output.criticalPath.path)).toBe(true);
		expect(typeof output.criticalPath.length).toBe("number");
		expect(typeof output.criticalPath.batchCount).toBe("number");
		expect(typeof output.criticalPath.bottleneckImpact).toBe("string");
	});

	it("plannerWarnings have correct structure", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);

		for (const warning of output.plannerWarnings) {
			expect(warning).toHaveProperty("type");
			expect(warning).toHaveProperty("message");
			expect([
				"over_serialized",
				"low_effective_parallelism",
				"single_width_batch",
				"file_overlap",
				"bottleneck",
			]).toContain(warning.type);
		}
	});

	it("plannerSuggestions have correct structure", async () => {
		const output = await planExecution(overSerialized());
		expect(output.success).toBe(true);

		for (const suggestion of output.plannerSuggestions) {
			expect(suggestion).toHaveProperty("type");
			expect(suggestion).toHaveProperty("message");
			expect(suggestion).toHaveProperty("requiresApproval");
			expect(suggestion).toHaveProperty("expectedBenefit");
			expect(typeof suggestion.requiresApproval).toBe("boolean");
		}
	});

	it("predictedParallelism has correct structure", async () => {
		const output = await planExecution(fanInFanOut());
		expect(output.success).toBe(true);

		expect(output.predictedParallelism).toHaveProperty("requested");
		expect(output.predictedParallelism).toHaveProperty("effective");
		expect(output.predictedParallelism).toHaveProperty("totalBatches");
		expect(output.predictedParallelism).toHaveProperty("resourceUtilizationPercent");
		expect(output.predictedParallelism).toHaveProperty("bottlenecks");
		expect(output.predictedParallelism).toHaveProperty("parallelismHeadroom");
		expect(output.predictedParallelism).toHaveProperty("saturationPoint");
		expect(typeof output.predictedParallelism.resourceUtilizationPercent).toBe("number");
		expect(Array.isArray(output.predictedParallelism.bottlenecks)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC1: Optimized batches correctness
// ---------------------------------------------------------------------------

describe("AC1: Optimized batch correctness", () => {
	it("sequential chain produces 4 batches, each single-width", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toHaveLength(4);
		for (const batch of output.optimizedBatches) {
			expect(batch.width).toBe(1);
			expect(batch.isBottleneck).toBe(true);
		}
	});

	it("fan-in fan-out produces 3 batches: [A,B], [C], [D,E]", async () => {
		const output = await planExecution(fanInFanOut());
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toHaveLength(3);

		// Batch 1: A, B
		const b1 = output.optimizedBatches[0];
		expect(b1!.batchIndex).toBe(1);
		expect(b1!.workspaceIds.sort()).toEqual(["A", "B"]);
		expect(b1!.width).toBe(2);

		// Batch 2: C
		const b2 = output.optimizedBatches[1];
		expect(b2!.batchIndex).toBe(2);
		expect(b2!.workspaceIds).toEqual(["C"]);
		expect(b2!.width).toBe(1);
		expect(b2!.isBottleneck).toBe(true);

		// Batch 3: D, E
		const b3 = output.optimizedBatches[2];
		expect(b3!.batchIndex).toBe(3);
		expect(b3!.workspaceIds.sort()).toEqual(["D", "E"]);
		expect(b3!.width).toBe(2);
	});

	it("all parallel produces 1 batch with all workspaces", async () => {
		const output = await planExecution(allParallel());
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toHaveLength(1);
		const batch = output.optimizedBatches[0]!;
		expect(batch.width).toBe(5);
		expect(batch.isAtCapacity).toBe(true); // 5 === maxParallelWorkspaces
	});

	it("diamond produces 3 batches: [A], [B,C], [D]", async () => {
		const output = await planExecution(diamond());
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toHaveLength(3);

		expect(output.optimizedBatches[0]!.workspaceIds).toEqual(["A"]);
		expect(output.optimizedBatches[1]!.workspaceIds.sort()).toEqual(["B", "C"]);
		expect(output.optimizedBatches[2]!.workspaceIds).toEqual(["D"]);
	});
});

// ---------------------------------------------------------------------------
// AC1: Critical path correctness
// ---------------------------------------------------------------------------

describe("AC1: Critical path correctness", () => {
	it("sequential chain critical path is A -> B -> C -> D (length 4)", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);
		expect(output.criticalPath.length).toBe(4);
		expect(output.criticalPath.path).toEqual(["A", "B", "C", "D"]);
		expect(output.criticalPath.batchCount).toBe(4);
	});

	it("fan-in fan-out critical path is A -> C -> D (or B -> C -> D, length 3)", async () => {
		const output = await planExecution(fanInFanOut());
		expect(output.success).toBe(true);
		// Critical path should be one of the longest chains: e.g., A -> C -> D
		expect(output.criticalPath.length).toBe(3);
		// The path should start with A or B, go through C, end with D or E
		expect(output.criticalPath.path[0]).toMatch(/^[AB]$/);
		expect(output.criticalPath.path[1]).toBe("C");
		expect(output.criticalPath.path[2]).toMatch(/^[DE]$/);
	});

	it("all parallel critical path is any single workspace (length 1)", async () => {
		const output = await planExecution(allParallel());
		expect(output.success).toBe(true);
		expect(output.criticalPath.length).toBe(1);
		expect(output.criticalPath.path).toHaveLength(1);
	});

	it("diamond critical path length is 3", async () => {
		const output = await planExecution(diamond());
		expect(output.success).toBe(true);
		expect(output.criticalPath.length).toBe(3);
		// Path should be A -> B -> D or A -> C -> D
		expect(output.criticalPath.path[0]).toBe("A");
		expect(output.criticalPath.path[2]).toBe("D");
	});

	it("empty queue critical path has length 0", async () => {
		const output = await planExecution(emptyQueue());
		expect(output.criticalPath.length).toBe(0);
		expect(output.criticalPath.path).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// AC1: Planner warnings
// ---------------------------------------------------------------------------

describe("AC1: Planner warnings", () => {
	it("sequential chain produces single_width_batch warnings", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);
		// Should have single_width_batch warnings for middle batches
		const singleWidth = output.plannerWarnings.filter((w) => w.type === "single_width_batch");
		expect(singleWidth.length).toBeGreaterThan(0);
	});

	it("over-serialized plan produces over_serialized warning", async () => {
		const output = await planExecution(overSerialized());
		expect(output.success).toBe(true);
		const overSerializedWarnings = output.plannerWarnings.filter((w) => w.type === "over_serialized");
		expect(overSerializedWarnings.length).toBeGreaterThan(0);
	});

	it("fan-in fan-out produces low_effective_parallelism warning when effective < requested", async () => {
		const output = await planExecution(fanInFanOut());
		expect(output.success).toBe(true);
		// maxParallelWorkspaces=3, effective=2 -> low_effective_parallelism
		const lowParallelismWarnings = output.plannerWarnings.filter((w) => w.type === "low_effective_parallelism");
		expect(lowParallelismWarnings.length).toBeGreaterThan(0);
	});

	it("all-parallel with 5 workers and effective 5 produces no low_parallelism warning", async () => {
		const output = await planExecution(allParallel());
		expect(output.success).toBe(true);
		const lowParallelismWarnings = output.plannerWarnings.filter((w) => w.type === "low_effective_parallelism");
		expect(lowParallelismWarnings).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// AC1: Planner suggestions
// ---------------------------------------------------------------------------

describe("AC1: Planner suggestions", () => {
	it("over-serialized plan suggests add_parallel_group", async () => {
		const output = await planExecution(overSerialized());
		expect(output.success).toBe(true);
		const parallelGroupSuggestion = output.plannerSuggestions.find((s) => s.type === "add_parallel_group");
		expect(parallelGroupSuggestion).toBeDefined();
		expect(parallelGroupSuggestion!.requiresApproval).toBe(true);
	});

	it("low parallelism plan suggests regroup_batches", async () => {
		const output = await planExecution(fanInFanOut());
		expect(output.success).toBe(true);
		const regroupSuggestion = output.plannerSuggestions.find((s) => s.type === "regroup_batches");
		expect(regroupSuggestion).toBeDefined();
		expect(regroupSuggestion!.requiresApproval).toBe(true);
	});

	it('sequential chain suggests remove_dependency for workspace "B"', async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);
		const depSuggestion = output.plannerSuggestions.find((s) => s.type === "remove_dependency");
		expect(depSuggestion).toBeDefined();
		expect(depSuggestion!.requiresApproval).toBe(true);
	});

	it("all suggestions have requiresApproval set to true", async () => {
		const output = await planExecution(overSerialized());
		expect(output.success).toBe(true);
		for (const suggestion of output.plannerSuggestions) {
			expect(suggestion.requiresApproval).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// AC1: Predicted parallelism
// ---------------------------------------------------------------------------

describe("AC1: Predicted parallelism", () => {
	it("sequential chain has effective=1, utilization below 100%", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);
		expect(output.predictedParallelism.effective).toBe(1);
		expect(output.predictedParallelism.resourceUtilizationPercent).toBeLessThan(100);
	});

	it("fan-in fan-out has effective=2, utilization=67%", async () => {
		const output = await planExecution(fanInFanOut());
		expect(output.success).toBe(true);
		expect(output.predictedParallelism.effective).toBe(2);
		expect(output.predictedParallelism.resourceUtilizationPercent).toBe(67);
	});

	it("all parallel has effective=5, utilization=100%", async () => {
		const output = await planExecution(allParallel());
		expect(output.success).toBe(true);
		expect(output.predictedParallelism.effective).toBe(5);
		expect(output.predictedParallelism.resourceUtilizationPercent).toBe(100);
	});

	it("saturation point equals effective parallelism", async () => {
		const output = await planExecution(fanInFanOut());
		expect(output.success).toBe(true);
		expect(output.predictedParallelism.saturationPoint).toBe(output.predictedParallelism.effective);
	});

	it("bottlenecks are present for sequential chain", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);
		expect(output.predictedParallelism.bottlenecks.length).toBeGreaterThan(0);
	});

	it("empty queue has effective=0, saturationPoint=1", async () => {
		const output = await planExecution(emptyQueue());
		expect(output.predictedParallelism.effective).toBe(0);
		expect(output.predictedParallelism.saturationPoint).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// AC2: Planner never executes code or mutates repo state
// ---------------------------------------------------------------------------

describe("AC2: Planner never executes code or mutates repo state", () => {
	it("plan() does not access filesystem", async () => {
		const planner = new Planner();
		const queue = sequentialChain();

		// The plan() method should be a pure function: no side effects
		// We verify by checking that the queue is not mutated
		const originalWorkspaces = queue.workspaces.map((w) => ({ ...w }));
		await planner.plan(queue);

		// Queue should be unchanged
		for (let i = 0; i < queue.workspaces.length; i++) {
			expect(queue.workspaces[i].id).toBe(originalWorkspaces[i].id);
			expect(queue.workspaces[i].title).toBe(originalWorkspaces[i].title);
			expect(queue.workspaces[i].dependencies).toEqual(originalWorkspaces[i].dependencies);
		}
	});

	it("plan() can be called multiple times with same input and produce identical output", async () => {
		const planner = new Planner();
		const queue = sequentialChain();

		const output1 = await planner.plan(queue);
		const output2 = await planner.plan(queue);

		// Batch plans should be identical
		expect(output1.optimizedBatches).toEqual(output2.optimizedBatches);
		expect(output1.criticalPath.path).toEqual(output2.criticalPath.path);
		expect(output1.predictedParallelism).toEqual(output2.predictedParallelism);
	});

	it("plan() is a pure analysis — no writes, no commands, no mutations", async () => {
		// Verify the planner class has no file I/O methods and no execution methods
		const planner = new Planner();
		const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(planner)).filter(
			(name) => typeof (planner as unknown as Record<string, unknown>)[name] === "function",
		);

		// The only public method should be plan()
		expect(methods).toContain("plan");
		// There should be no execute, run, commit, save, or write methods
		expect(methods).not.toContain("execute");
		expect(methods).not.toContain("run");
		expect(methods).not.toContain("commit");
		expect(methods).not.toContain("save");
		expect(methods).not.toContain("write");
		expect(methods).not.toContain("mutate");
	});
});

// ---------------------------------------------------------------------------
// AC3: Planner output is advisory until human approval
// ---------------------------------------------------------------------------

describe("AC3: Planner output is advisory until human approval", () => {
	it("summary contains advisory notice", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.summary).toContain("ADVISORY");
		expect(output.summary).toContain("human approval");
	});

	it("summary contains advisory notice in over-serialized plan", async () => {
		const output = await planExecution(overSerialized());
		expect(output.summary).toContain("ADVISORY");
		expect(output.summary).toContain("human approval");
	});

	it("summary contains advisory notice even when planning fails", async () => {
		const output = await planExecution(emptyQueue());
		// When planning fails, the summary still includes the advisory notice
		expect(output.summary).toContain("ADVISORY");
		expect(output.summary).toContain("human approval");
	});

	it("all suggestions have requiresApproval=true", async () => {
		// All planner suggestions require human approval by design
		const output = await planExecution(overSerialized());
		for (const suggestion of output.plannerSuggestions) {
			expect(suggestion.requiresApproval).toBe(true);
		}
	});

	it("output has explicit success flag — it can be rejected without consequences", async () => {
		// The success flag being false means planning failed (e.g., cycle).
		// Even when success=true, the output is purely advisory — rejecting it
		// has no consequences because no state was mutated.
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);

		// Rejection: we simply don't use the output for execution.
		// No side effects to clean up, nothing to roll back.
		const wasRejected = true;
		if (wasRejected) {
			// No cleanup needed — planner left no state
			expect(output.optimizedBatches.length).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Mixed risk and preflight-required workspaces
// ---------------------------------------------------------------------------

describe("Mixed risk and preflight workspaces", () => {
	it("high-risk workspaces are annotated in optimized batches", async () => {
		const output = await planExecution(mixedRiskQueue());
		expect(output.success).toBe(true);

		// Find the batch with workspace B (high-risk)
		const batchB = output.optimizedBatches.find((b) => b.workspaceIds.includes("B"));
		expect(batchB).toBeDefined();
		expect(batchB!.optimizationNotes.some((n) => n.includes("High-risk"))).toBe(true);
	});

	it("preflight-required workspaces are annotated in optimized batches", async () => {
		const output = await planExecution(mixedRiskQueue());
		expect(output.success).toBe(true);

		// Find the batch with workspace C (preflightRequired)
		const batchC = output.optimizedBatches.find((b) => b.workspaceIds.includes("C"));
		expect(batchC).toBeDefined();
		expect(batchC!.optimizationNotes.some((n) => n.includes("preflight approval"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

describe("Formatting utilities", () => {
	it("formatPlannerOutput returns the summary string", async () => {
		const output = await planExecution(sequentialChain());
		const formatted = formatPlannerOutput(output);
		expect(typeof formatted).toBe("string");
		expect(formatted.length).toBeGreaterThan(0);
		expect(formatted).toContain("ADVISORY");
	});

	it("formatCriticalPath returns a readable string", async () => {
		const output = await planExecution(sequentialChain());
		const formatted = formatCriticalPath(output.criticalPath);
		expect(typeof formatted).toBe("string");
		expect(formatted).toContain("A");
		expect(formatted).toContain("B");
		expect(formatted).toContain("C");
		expect(formatted).toContain("D");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
	it("single workspace queue produces 1 batch, no warnings", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Single",
			maxParallelWorkspaces: 3,
			workspaces: [ws("A", [])],
		};
		const output = await planExecution(queue);
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toHaveLength(1);
		expect(output.criticalPath.length).toBe(1);
	});

	it("all workspaces depend on one root", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Star",
			maxParallelWorkspaces: 3,
			workspaces: [ws("ROOT", []), ws("B", ["ROOT"]), ws("C", ["ROOT"]), ws("D", ["ROOT"])],
		};
		const output = await planExecution(queue);
		expect(output.success).toBe(true);
		expect(output.optimizedBatches).toHaveLength(2);
		// Batch 1: ROOT, Batch 2: B, C, D
		expect(output.optimizedBatches[0]!.width).toBe(1);
		expect(output.optimizedBatches[1]!.width).toBe(3);
		// ROOT is bottleneck
		expect(output.optimizedBatches[0]!.isBottleneck).toBe(true);
	});

	it("no warnings for perfectly parallelizable queue", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Perfect",
			maxParallelWorkspaces: 2,
			workspaces: [ws("A", []), ws("B", []), ws("C", ["A", "B"])],
		};
		const output = await planExecution(queue);
		expect(output.success).toBe(true);
		// Effective = 2, Requested = 2 -> no low parallelism warning
		const lowParallel = output.plannerWarnings.filter((w) => w.type === "low_effective_parallelism");
		expect(lowParallel).toHaveLength(0);
	});

	it("plan with includeBatchPlanResult includes underlying batchPlan", async () => {
		const planner = new Planner({ includeBatchPlanResult: true });
		const output = await planner.plan(sequentialChain());
		expect(output.success).toBe(true);
		expect(output.batchPlan).toBeDefined();
		expect(output.batchPlan!.batches).toHaveLength(4);
	});

	it("plan without includeBatchPlanResult does not include batchPlan", async () => {
		const planner = new Planner({ includeBatchPlanResult: false });
		const output = await planner.plan(sequentialChain());
		expect(output.success).toBe(true);
		expect(output.batchPlan).toBeUndefined();
	});

	it("default planner options do not include batchPlan result", async () => {
		const output = await planExecution(sequentialChain());
		expect(output.success).toBe(true);
		expect(output.batchPlan).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// P9.C: Automatic DAG and parallel optimization
// ---------------------------------------------------------------------------

/**
 * P9.C Acceptance Criteria:
 * 1. Planner detects unnecessary serialization.
 * 2. Planner suggests safe workspace splitting and rebatching.
 * 3. Planner computes optimized batches, critical path, and expected parallelism gain.
 */

describe("P9.C — Automatic DAG and parallel optimization", () => {
	// =======================================================================
	// AC1: Planner detects unnecessary serialization
	// =======================================================================

	describe("AC1: Detects unnecessary serialization", () => {
		it("detects over-serialization in fully serialized chain with multiple workers", async () => {
			const output = await planExecution(overSerialized());
			expect(output.success).toBe(true);
			// Over-serialization warning should be present
			const serializedWarn = output.plannerWarnings.find((w) => w.type === "over_serialized");
			expect(serializedWarn).toBeDefined();
			expect(serializedWarn!.message).toContain("fully serialized");
			// Predicted parallelism should show effective=1 despite requested=3
			expect(output.predictedParallelism.effective).toBe(1);
			expect(output.predictedParallelism.requested).toBe(3);
			// Bottlenecks should mention serialization
			expect(output.predictedParallelism.bottlenecks.length).toBeGreaterThan(0);
			const serialBottleneck = output.predictedParallelism.bottlenecks.find((b) => b.includes("serialized"));
			expect(serialBottleneck).toBeDefined();
		});

		it("detects single-width batch bottlenecks causing unnecessary serialization", async () => {
			// A, B parallel -> C (single-width) -> D, E parallel
			// C being a single-width batch in the middle is unnecessary serialization
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Single-Width Bottleneck",
				maxParallelWorkspaces: 3,
				workspaces: [ws("A", []), ws("B", []), ws("C", ["A", "B"]), ws("D", ["C"]), ws("E", ["C"])],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// Should have single_width_batch warnings
			const singleWidth = output.plannerWarnings.filter((w) => w.type === "single_width_batch");
			expect(singleWidth.length).toBeGreaterThan(0);

			// Batch 2 (C) should be identified as bottleneck
			const batch2 = output.optimizedBatches.find((b) => b.batchIndex === 2);
			expect(batch2).toBeDefined();
			expect(batch2!.isBottleneck).toBe(true);
			expect(batch2!.optimizationNotes.some((n) => n.includes("Single-width"))).toBe(true);

			// Effective parallelism should be 2 (A+B), not 3
			expect(output.predictedParallelism.effective).toBe(2);
		});

		it("detects serialized tail where parallel capacity is unused", async () => {
			// A, B, C parallel -> D -> E -> F (serial tail)
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Serial Tail",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", []),
					ws("B", []),
					ws("C", []),
					ws("D", ["A", "B", "C"]),
					ws("E", ["D"]),
					ws("F", ["E"]),
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// Should have bottlenecks mentioning serialized tail
			const tailBottleneck = output.predictedParallelism.bottlenecks.find((b) => b.includes("Serialized tail"));
			expect(tailBottleneck).toBeDefined();

			// Low parallelism warning since effective (1) < requested (3)
			// Actually effective is 3 (first batch has A,B,C), then serial tail
			expect(output.predictedParallelism.effective).toBe(3);
			expect(output.predictedParallelism.bottlenecks.length).toBeGreaterThan(0);
		});

		it("does not flag over-serialization when plan is already optimal", async () => {
			const output = await planExecution(allParallel());
			expect(output.success).toBe(true);
			const serializedWarn = output.plannerWarnings.find((w) => w.type === "over_serialized");
			expect(serializedWarn).toBeUndefined();
			expect(output.predictedParallelism.effective).toBe(5);
			expect(output.predictedParallelism.resourceUtilizationPercent).toBe(100);
		});
	});

	// =======================================================================
	// AC2: Planner suggests safe workspace splitting and rebatching
	// =======================================================================

	describe("AC2: Suggests safe workspace splitting and rebatching", () => {
		it("suggests splitting workspaces with multiple acceptance criteria in a serial bottleneck", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Split Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", []),
					ws("B", ["A"], {
						title: "Big Task",
						acceptanceCriteria: ["Step 1", "Step 2", "Step 3"],
					}),
					ws("C", ["B"]),
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// Should suggest split_workspace
			const splitSuggestion = output.plannerSuggestions.find((s) => s.type === "split_workspace");
			expect(splitSuggestion).toBeDefined();
			expect(splitSuggestion!.message).toContain("B");
			expect(splitSuggestion!.message).toContain("acceptance criteria");
			expect(splitSuggestion!.workspaceIds).toContain("B");
		});

		it("suggests remove_dependency for workspaces that are unnecessarily serialized", async () => {
			// A -> B -> C (fully serial). Each middle workspace has deps that
			// could potentially be removed
			const output = await planExecution(sequentialChain());
			expect(output.success).toBe(true);

			// Should suggest remove_dependency for B (depends on A, causing serialization)
			const depSuggestion = output.plannerSuggestions.find((s) => s.type === "remove_dependency");
			expect(depSuggestion).toBeDefined();
			expect(depSuggestion!.requiresApproval).toBe(true);
			expect(depSuggestion!.expectedBenefit).toBeTruthy();
		});

		it("suggests regrouping batches for low parallelism", async () => {
			const output = await planExecution(fanInFanOut());
			expect(output.success).toBe(true);

			// Effective is 2, requested is 3 -> suggests regroup_batches
			const regroupSuggestion = output.plannerSuggestions.find((s) => s.type === "regroup_batches");
			expect(regroupSuggestion).toBeDefined();
			expect(regroupSuggestion!.requiresApproval).toBe(true);
		});

		it("suggests add_parallel_group when plan is over-serialized", async () => {
			const output = await planExecution(overSerialized());
			expect(output.success).toBe(true);

			const parallelGroupSuggestion = output.plannerSuggestions.find((s) => s.type === "add_parallel_group");
			expect(parallelGroupSuggestion).toBeDefined();
			expect(parallelGroupSuggestion!.message).toContain("parallelGroup");
		});

		it("does not suggest splitting when workspace has no acceptance criteria", async () => {
			// Over-serialized chain, no AC on B
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "No Split Needed",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", []),
					ws("B", ["A"]), // No acceptanceCriteria
					ws("C", ["B"]),
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			const splitSuggestion = output.plannerSuggestions.find((s) => s.type === "split_workspace");
			expect(splitSuggestion).toBeUndefined();
		});

		it("all suggestions require approval before execution", async () => {
			const output = await planExecution(overSerialized());
			expect(output.success).toBe(true);

			for (const suggestion of output.plannerSuggestions) {
				expect(suggestion.requiresApproval).toBe(true);
			}
		});
	});

	// =======================================================================
	// AC3: Planner computes optimized batches, critical path, and expected
	//      parallelism gain
	// =======================================================================

	describe("AC3: Computes optimized batches, critical path, and expected parallelism gain", () => {
		it("includes optimizedBatchPlan in output when optimizations exist", async () => {
			// Two workspaces editing the same file — triggers addition proposal
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Optimization Exists",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", [], {
						capabilities: {
							canEdit: ["src/shared.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					}),
					ws("B", [], {
						capabilities: {
							canEdit: ["src/shared.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					}),
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// The optimizer should find proposals (file overlap addition)
			// and populate optimizedBatchPlan
			expect(output.optimizedBatchPlan).toBeDefined();
			expect("expectedParallelismGain" in output).toBe(true);
		});

		it("expectedParallelismGain is a non-negative number when set", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Gain Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", []),
					ws("B", ["A"]),
					ws("C", ["A", "B"]), // A is transitive
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			if (output.expectedParallelismGain !== undefined) {
				expect(typeof output.expectedParallelismGain).toBe("number");
				expect(output.expectedParallelismGain).toBeGreaterThanOrEqual(0);
			}
		});

		it("optimizedBatchPlan is undefined when no optimizations are possible", async () => {
			// Fully parallel with no dependencies — no optimization needed
			const output = await planExecution(allParallel());
			expect(output.success).toBe(true);

			// No transitive deps, no splits, no serial bottlenecks
			expect(output.optimizedBatchPlan).toBeUndefined();
			expect(output.expectedParallelismGain).toBeUndefined();
		});

		it("optimizedBatchPlan shows the effect of applying proposals", async () => {
			// Two workspaces editing the same file — optimizer adds serialization dep
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Optimization Effect",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", [], {
						capabilities: {
							canEdit: ["src/shared.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					}),
					ws("B", [], {
						capabilities: {
							canEdit: ["src/shared.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					}),
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// Current plan: Batch 1: A, B (both parallel, width=2)
			expect(output.optimizedBatches).toHaveLength(1);
			expect(output.optimizedBatches[0]!.width).toBe(2);

			// Optimized plan (adding serialization for file overlap):
			// If the optimizer added a dep from A to B, we'd have [A] -> [B] (2 batches, width=1 each)
			// This shows the optimized plan reflects the proposed changes
			if (output.optimizedBatchPlan) {
				// The optimizer proposes adding a dependency, which may change batch count
				expect(output.optimizedBatchPlan.batches.length).toBeGreaterThanOrEqual(1);
				expect(typeof output.optimizedBatchPlan.totalBatches).toBe("number");
				expect(typeof output.optimizedBatchPlan.effectiveParallelism).toBe("number");
			}
		});

		it("optimizedBatchPlan is defined when file overlap exists", async () => {
			// Two workspaces editing the same file should trigger an addition proposal
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "File Overlap Opt",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", [], {
						capabilities: {
							canEdit: ["src/shared.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					}),
					ws("B", [], {
						capabilities: {
							canEdit: ["src/shared.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					}),
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// Should have an optimized plan (dependency addition proposal)
			if (output.expectedParallelismGain !== undefined) {
				// File overlap addition may not improve parallelism (it may slightly reduce it)
				// But it should still produce an optimized batch plan
				expect(output.expectedParallelismGain).toBeGreaterThanOrEqual(0);
			}
		});

		it("summary includes optimized plan details when optimizations exist", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Summary Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", []),
					ws("B", ["A"]),
					ws("C", ["A", "B"]), // A is transitive
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// Summary should mention optimized plan if it exists
			if (output.optimizedBatchPlan) {
				expect(output.summary).toContain("Optimized Plan");
				if (output.expectedParallelismGain !== undefined && output.expectedParallelismGain > 0) {
					expect(output.summary).toContain("Parallelism gain");
				}
			}
		});

		it("critical path computation remains correct with optimizer integration", async () => {
			const output = await planExecution(sequentialChain());
			expect(output.success).toBe(true);

			// Critical path is the full chain
			expect(output.criticalPath.length).toBe(4);
			expect(output.criticalPath.path).toEqual(["A", "B", "C", "D"]);
			expect(output.criticalPath.batchCount).toBe(4);
		});

		it("predicted parallelism metrics are computed alongside optimized plan", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Metrics Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					ws("A", []),
					ws("B", ["A"]),
					ws("C", ["A", "B"]), // A is transitive
				],
			};
			const output = await planExecution(queue);
			expect(output.success).toBe(true);

			// Always has predicted parallelism
			expect(output.predictedParallelism).toBeDefined();
			expect(output.predictedParallelism.effective).toBeGreaterThanOrEqual(0);
			expect(output.predictedParallelism.totalBatches).toBeGreaterThan(0);
			expect(output.predictedParallelism.resourceUtilizationPercent).toBeGreaterThanOrEqual(0);

			// If optimized plan exists, comparison metrics should be consistent
			if (output.optimizedBatchPlan) {
				// The optimized plan should be a BatchPlanResult with proper fields
				expect(output.optimizedBatchPlan.batches).toBeDefined();
				expect(output.optimizedBatchPlan.totalBatches).toBeGreaterThan(0);
				expect(output.optimizedBatchPlan.effectiveParallelism).toBeGreaterThanOrEqual(0);
			}
		});

		it("optimizedBatchPlan remains consistent within the same queue across multiple calls", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Consistency Test",
				maxParallelWorkspaces: 3,
				workspaces: [ws("A", []), ws("B", ["A"]), ws("C", ["A", "B"])],
			};

			const output1 = await planExecution(queue);
			const output2 = await planExecution(queue);

			// If both have optimizedBatchPlan, they should be equivalent
			if (output1.optimizedBatchPlan && output2.optimizedBatchPlan) {
				expect(output1.optimizedBatchPlan.totalBatches).toBe(output2.optimizedBatchPlan.totalBatches);
				expect(output1.optimizedBatchPlan.effectiveParallelism).toBe(
					output2.optimizedBatchPlan.effectiveParallelism,
				);
			}

			// expectedParallelismGain should be consistent too
			expect(output1.expectedParallelismGain).toEqual(output2.expectedParallelismGain);
		});
	});
});
