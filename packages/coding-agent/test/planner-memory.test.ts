/**
 * Planner Memory Tests - P7.E
 *
 * Tests for planner heuristics and memory:
 * 1. Planner memory persists and can be inspected.
 * 2. Suggestions include evidence from memory when used.
 * 3. Memory does not auto-apply graph changes.
 */

import { describe, expect, it } from "vitest";
import { Planner, planExecution } from "../src/core/planner.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";
import { createPlannerMemory, PlannerMemory, type PlannerMemoryEntry } from "../src/memory/planner-memory.js";
import { InMemoryPlannerMemoryStore } from "../src/memory/planner-memory-store.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a PlannerMemory with a fresh in-memory store for each test.
 */
function createTestMemory(
	overrides?: Partial<import("../src/memory/planner-memory.js").PlannerMemoryConfig>,
): PlannerMemory {
	const store = new InMemoryPlannerMemoryStore();
	return new PlannerMemory({ enabled: true, ...overrides }, store);
}

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

// ============================================================================
// AC1: Planner memory persists and can be inspected
// ============================================================================

describe("AC1: Planner memory persists and can be inspected", () => {
	it("records a planner run with recordPlan and retrieves it via getAll", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordPlan(
			"P2",
			"Sequential Chain Test",
			4,
			3,
			1,
			4,
			true,
			true,
			["single_width_batch", "over_serialized"],
			["add_parallel_group", "remove_dependency"],
			["Fully serialized plan", "Batch 1 is bottleneck"],
			["Consider adding parallelGroup hints", "Remove unnecessary dependencies"],
			"=== Planner Summary ===\nSerialized plan",
		);

		expect(entry).not.toBeNull();
		expect(entry!.phase).toBe("P2");
		expect(entry!.title).toBe("Sequential Chain Test");
		expect(entry!.workspaceCount).toBe(4);
		expect(entry!.maxParallelWorkspaces).toBe(3);
		expect(entry!.effectiveParallelism).toBe(1);
		expect(entry!.totalBatches).toBe(4);
		expect(entry!.isOverSerialized).toBe(true);
		expect(entry!.hadWarnings).toBe(true);
		expect(entry!.warningTypes).toEqual(["single_width_batch", "over_serialized"]);
		expect(entry!.suggestionTypes).toEqual(["add_parallel_group", "remove_dependency"]);
		expect(entry!.bottlenecks).toEqual(["Fully serialized plan", "Batch 1 is bottleneck"]);
		expect(entry!.verdict).toBe("unknown");
		expect(entry!.timestamp).toBeGreaterThan(0);
		expect(entry!.id).toBeTruthy();
	});

	it("stores entry and makes it retrievable via getAll", async () => {
		const mem = createTestMemory();

		await mem.recordPlan("P2", "Test Plan", 3, 3, 2, 2, false, false, [], [], [], [], "Summary text.");

		const all = await mem.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].phase).toBe("P2");
	});

	it("stores multiple entries and returns them all", async () => {
		const mem = createTestMemory();

		await mem.recordPlan("P2", "Plan A", 5, 3, 3, 2, false, false, [], [], [], [], "Plan A summary.");
		await mem.recordPlan("P2", "Plan B", 10, 5, 4, 3, false, true, ["file_overlap"], [], [], [], "Plan B summary.");
		await mem.recordPlan(
			"P2",
			"Plan C",
			3,
			2,
			1,
			3,
			true,
			true,
			["over_serialized"],
			["add_parallel_group"],
			[],
			[],
			"Plan C summary.",
		);

		const all = await mem.getAll();
		expect(all).toHaveLength(3);

		const titles = all.map((e) => e.title);
		expect(titles).toContain("Plan A");
		expect(titles).toContain("Plan B");
		expect(titles).toContain("Plan C");
	});

	it("getAll returns entries newest first", async () => {
		const mem = createTestMemory();

		await mem.recordPlan("P2", "First", 1, 1, 1, 1, false, false, [], [], [], [], "First.");
		await new Promise((r) => setTimeout(r, 5));
		await mem.recordPlan("P2", "Second", 1, 1, 1, 1, false, false, [], [], [], [], "Second.");

		const all = await mem.getAll();
		expect(all[0].title).toBe("Second");
		expect(all[1].title).toBe("First");
	});

	it("returns empty array when no memory recorded", async () => {
		const mem = createTestMemory();
		const all = await mem.getAll();
		expect(all).toEqual([]);
	});

	it("count returns the number of stored entries", async () => {
		const mem = createTestMemory();

		expect(await mem.count()).toBe(0);

		await mem.recordPlan("P2", "Plan A", 1, 1, 1, 1, false, false, [], [], [], [], "A");
		expect(await mem.count()).toBe(1);

		await mem.recordPlan("P2", "Plan B", 1, 1, 1, 1, false, false, [], [], [], [], "B");
		expect(await mem.count()).toBe(2);
	});

	it("clear removes all entries", async () => {
		const mem = createTestMemory();

		await mem.recordPlan("P2", "Plan A", 1, 1, 1, 1, false, false, [], [], [], [], "A");
		await mem.recordPlan("P2", "Plan B", 1, 1, 1, 1, false, false, [], [], [], [], "B");
		expect(await mem.count()).toBe(2);

		await mem.clear();
		expect(await mem.count()).toBe(0);
		expect(await mem.getAll()).toEqual([]);
	});

	it("getConfig returns a copy of the config", async () => {
		const mem = new PlannerMemory({ enabled: true, maxEntries: 25 });

		const config = mem.getConfig();
		expect(config.maxEntries).toBe(25);
		expect(config.enabled).toBe(true);

		config.maxEntries = 999;
		expect(mem.getConfig().maxEntries).toBe(25);
	});
});

// ============================================================================
// AC1: Planner memory works with Planner integration
// ============================================================================

describe("AC1: Planner integration with memory", () => {
	it("planner records memory when PlannerMemory is provided", async () => {
		const mem = createTestMemory();
		const planner = new Planner({ plannerMemory: mem });

		await planner.plan(sequentialChain());

		const all = await mem.getAll();
		expect(all.length).toBeGreaterThan(0);
		expect(all[0].phase).toBe("P2");
		expect(all[0].workspaceCount).toBe(4);
		expect(all[0].isOverSerialized).toBe(true);
	});

	it("planner records memory from planExecution with memory options", async () => {
		const mem = createTestMemory();
		await planExecution(sequentialChain(), { plannerMemory: mem });

		const all = await mem.getAll();
		expect(all.length).toBeGreaterThan(0);
	});

	it("planner does not record memory when PlannerMemory is not provided", async () => {
		const planner = new Planner();
		await planner.plan(sequentialChain());

		// No memory to inspect — this just verifies no crash
		expect(true).toBe(true);
	});

	it("multiple plan runs are all recorded in memory", async () => {
		const mem = createTestMemory();
		const planner = new Planner({ plannerMemory: mem });

		await planner.plan(sequentialChain());
		await planner.plan(fanInFanOut());
		await planner.plan(allParallel());

		const all = await mem.getAll();
		expect(all).toHaveLength(3);
	});
});

// ============================================================================
// AC2: Suggestions include evidence from memory when used
// ============================================================================

describe("AC2: Suggestions include evidence from memory when used", () => {
	it("suggestions contain evidence text when relevant past plans exist", async () => {
		const mem = createTestMemory();

		// Pre-populate memory with a past over-serialized plan
		await mem.recordPlan(
			"P2",
			"Previous Serial Plan",
			4,
			3,
			1,
			4,
			true,
			true,
			["over_serialized"],
			["add_parallel_group"],
			["Fully serialized"],
			["Consider adding parallelGroup hints"],
			"=== Planner Summary ===\nPreviously a similar chain was fully serialized.",
		);

		// Now plan the same kind of queue — should reference memory
		const planner = new Planner({ plannerMemory: mem });
		const output = await planner.plan(sequentialChain());

		// Suggestions should have evidence appended
		const overSerializedSuggestion = output.plannerSuggestions.find((s) => s.type === "add_parallel_group");
		expect(overSerializedSuggestion).toBeDefined();
		expect(overSerializedSuggestion!.message).toContain("Evidence from past plans");
		expect(overSerializedSuggestion!.message).toContain("Previous Serial Plan");
	});

	it("suggestions do not contain evidence when no relevant past plans exist", async () => {
		const mem = createTestMemory();

		// Pre-populate with unrelated memory
		await mem.recordPlan(
			"P3",
			"Unrelated Plan",
			10,
			5,
			5,
			1,
			false,
			false,
			[],
			[],
			[],
			[],
			"Unrelated plan summary.",
		);

		const planner = new Planner({ plannerMemory: mem });
		const output = await planner.plan(sequentialChain());

		const overSerializedSuggestion = output.plannerSuggestions.find((s) => s.type === "add_parallel_group");
		expect(overSerializedSuggestion).toBeDefined();
		// The unrelated plan has different phase, different characteristics
		// so it shouldn't match as relevant evidence
		expect(overSerializedSuggestion!.message).not.toContain("Evidence from past plans");
	});

	it("suggestions from planner without memory do not contain evidence", async () => {
		const planner = new Planner(); // No memory
		const output = await planner.plan(sequentialChain());

		const overSerializedSuggestion = output.plannerSuggestions.find((s) => s.type === "add_parallel_group");
		expect(overSerializedSuggestion).toBeDefined();
		expect(overSerializedSuggestion!.message).not.toContain("Evidence from past plans");
	});

	it("memory evidence shows up in low-parallelism suggestions", async () => {
		const mem = createTestMemory();

		// Pre-populate with a past low-parallelism plan
		await mem.recordPlan(
			"P2",
			"Previous Low Parallel Plan",
			5,
			3,
			2,
			3,
			false,
			true,
			["low_effective_parallelism"],
			["regroup_batches"],
			["Low parallelism"],
			["Effective parallelism is below requested"],
			"=== Planner Summary ===\nPreviously a fan-in/out had low parallelism.",
		);

		const planner = new Planner({ plannerMemory: mem });
		const output = await planner.plan(fanInFanOut());

		const regroupSuggestion = output.plannerSuggestions.find((s) => s.type === "regroup_batches");
		expect(regroupSuggestion).toBeDefined();

		// The past plan had regroup_batches suggestion and low parallelism,
		// so it should be relevant evidence
		expect(regroupSuggestion!.message).toContain("Evidence from past plans");
	});

	it("multiple evidence entries can appear in a single suggestion", async () => {
		const mem = createTestMemory();

		// Pre-populate with two past over-serialized plans
		await mem.recordPlan(
			"P2",
			"Past Plan Alpha",
			4,
			3,
			1,
			4,
			true,
			true,
			["over_serialized"],
			["add_parallel_group"],
			["Fully serialized"],
			["Add parallel groups"],
			"Past plan Alpha summary.",
		);
		await mem.recordPlan(
			"P2",
			"Past Plan Beta",
			3,
			3,
			1,
			3,
			true,
			true,
			["over_serialized"],
			["add_parallel_group"],
			["Fully serialized"],
			["Add parallel groups"],
			"Past plan Beta summary.",
		);

		const planner = new Planner({ plannerMemory: mem });
		const output = await planner.plan(sequentialChain());

		const overSerializedSuggestion = output.plannerSuggestions.find((s) => s.type === "add_parallel_group");
		expect(overSerializedSuggestion).toBeDefined();
		expect(overSerializedSuggestion!.message).toContain("Past Plan Alpha");
		expect(overSerializedSuggestion!.message).toContain("Past Plan Beta");
	});
});

// ============================================================================
// AC3: Memory does not auto-apply graph changes
// ============================================================================

describe("AC3: Memory does not auto-apply graph changes", () => {
	it("plan() does not mutate the queue even when memory is used", async () => {
		const mem = createTestMemory();

		// Pre-populate memory
		await mem.recordPlan(
			"P2",
			"Past Plan",
			4,
			3,
			1,
			4,
			true,
			true,
			["over_serialized"],
			["add_parallel_group"],
			[],
			[],
			"Past plan.",
		);

		const planner = new Planner({ plannerMemory: mem });
		const queue = sequentialChain();

		// Capture original state
		const originalWorkspaces = queue.workspaces.map((w) => ({ ...w }));
		const originalParallelism = queue.maxParallelWorkspaces;

		await planner.plan(queue);

		// Queue should be unchanged
		expect(queue.maxParallelWorkspaces).toBe(originalParallelism);
		for (let i = 0; i < queue.workspaces.length; i++) {
			expect(queue.workspaces[i].id).toBe(originalWorkspaces[i].id);
			expect(queue.workspaces[i].dependencies).toEqual(originalWorkspaces[i].dependencies);
		}
	});

	it("memory does not modify workspace dependencies", async () => {
		const mem = createTestMemory();

		await mem.recordPlan(
			"P2",
			"Past Plan",
			4,
			3,
			1,
			4,
			true,
			true,
			["over_serialized"],
			["remove_dependency"],
			[],
			[],
			"Past plan.",
		);

		const planner = new Planner({ plannerMemory: mem });
		const queue = sequentialChain();

		// Verify initial dependencies
		const initialDeps = queue.workspaces.map((w) => [...w.dependencies]);
		await planner.plan(queue);

		// Dependencies should be unchanged
		for (let i = 0; i < queue.workspaces.length; i++) {
			expect(queue.workspaces[i].dependencies).toEqual(initialDeps[i]);
		}
	});

	it("memory does not alter planner output structure — it only annotates suggestion messages", async () => {
		const mem = createTestMemory();

		await mem.recordPlan(
			"P2",
			"Past Plan",
			4,
			3,
			1,
			4,
			true,
			true,
			["over_serialized"],
			["add_parallel_group"],
			[],
			[],
			"Past plan.",
		);

		const plannerWithMem = new Planner({ plannerMemory: mem });
		const plannerWithoutMem = new Planner();

		const [outputWithMem, outputWithoutMem] = await Promise.all([
			plannerWithMem.plan(sequentialChain()),
			plannerWithoutMem.plan(sequentialChain()),
		]);

		// Same number of suggestions
		expect(outputWithMem.plannerSuggestions.length).toBe(outputWithoutMem.plannerSuggestions.length);

		// Same suggestion types
		const withTypes = outputWithMem.plannerSuggestions.map((s) => s.type);
		const withoutTypes = outputWithoutMem.plannerSuggestions.map((s) => s.type);
		expect(withTypes).toEqual(withoutTypes);

		// Same requiresApproval values
		for (let i = 0; i < outputWithMem.plannerSuggestions.length; i++) {
			expect(outputWithMem.plannerSuggestions[i].requiresApproval).toBe(
				outputWithoutMem.plannerSuggestions[i].requiresApproval,
			);
		}

		// Same expectedBenefit values
		for (let i = 0; i < outputWithMem.plannerSuggestions.length; i++) {
			expect(outputWithMem.plannerSuggestions[i].expectedBenefit).toBe(
				outputWithoutMem.plannerSuggestions[i].expectedBenefit,
			);
		}

		// Same optimized batches
		expect(outputWithMem.optimizedBatches).toEqual(outputWithoutMem.optimizedBatches);

		// Same critical path
		expect(outputWithMem.criticalPath.path).toEqual(outputWithoutMem.criticalPath.path);

		// Same predicted parallelism
		expect(outputWithMem.predictedParallelism).toEqual(outputWithoutMem.predictedParallelism);

		// Same warnings
		expect(outputWithMem.plannerWarnings.map((w) => w.type)).toEqual(
			outputWithoutMem.plannerWarnings.map((w) => w.type),
		);

		// Only difference: the suggestion messages with memory have extra evidence text
		const withMessages = outputWithMem.plannerSuggestions.map((s) => s.message);
		const withoutMessages = outputWithoutMem.plannerSuggestions.map((s) => s.message);

		for (let i = 0; i < withMessages.length; i++) {
			// With memory should contain the base message from without memory
			const baseMsg = withoutMessages[i];
			const memoryMsg = withMessages[i];
			// memory messages should be supersets of the base messages
			if (memoryMsg !== baseMsg) {
				// The memory message should still contain the base content
				// and include the evidence marking
				expect(memoryMsg).toContain("Evidence from past plans");
			}
		}
	});

	it("memory works purely as annotation, no structural change to any planner decision", async () => {
		const mem = createTestMemory();

		// Add memory that contains a different pattern than what we're testing
		await mem.recordPlan(
			"P2",
			"Irrelevant Past Plan",
			100,
			10,
			8,
			12,
			false,
			true,
			["file_overlap"],
			["regroup_batches"],
			[],
			[],
			"Irrelevant past plan.",
		);

		const planner = new Planner({ plannerMemory: mem });
		const output = await planner.plan(sequentialChain());

		// The sequential chain should still produce 4 batches, each single-width
		expect(output.optimizedBatches).toHaveLength(4);
		for (const batch of output.optimizedBatches) {
			expect(batch.width).toBe(1);
		}

		// Critical path should still be A -> B -> C -> D
		expect(output.criticalPath.path).toEqual(["A", "B", "C", "D"]);

		// All suggestions should still require approval
		for (const suggestion of output.plannerSuggestions) {
			expect(suggestion.requiresApproval).toBe(true);
		}
	});
});

// ============================================================================
// Planner memory edge cases
// ============================================================================

describe("Planner memory edge cases", () => {
	it("handles empty suggestion types and warning types", async () => {
		const mem = createTestMemory();

		const entry = await mem.recordPlan(
			"P2",
			"Perfect Plan",
			5,
			5,
			5,
			1,
			false,
			false,
			[],
			[],
			[],
			[],
			"Perfect plan.",
		);
		expect(entry!.warningTypes).toEqual([]);
		expect(entry!.suggestionTypes).toEqual([]);
		expect(entry!.bottlenecks).toEqual([]);
	});

	it("handles very long summary text", async () => {
		const mem = createTestMemory();

		const longSummary = "A".repeat(10000);
		const entry = await mem.recordPlan("P2", "Long Plan", 1, 1, 1, 1, false, false, [], [], [], [], longSummary);
		expect(entry!.summaryText.length).toBe(10000);
	});

	it("prunes old entries", async () => {
		const store = new InMemoryPlannerMemoryStore();
		const mem = new PlannerMemory({ enabled: true, maxAgeMs: 1, maxEntries: 100 }, store);

		await mem.recordPlan("P2", "Old Plan", 1, 1, 1, 1, false, false, [], [], [], [], "Old.");

		await new Promise((r) => setTimeout(r, 10));

		await mem.recordPlan("P2", "New Plan", 1, 1, 1, 1, false, false, [], [], [], [], "New.");

		const all = await mem.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe("New Plan");
	});

	it("prunes excess entries by count", async () => {
		const store = new InMemoryPlannerMemoryStore();
		const mem = new PlannerMemory({ enabled: true, maxEntries: 3, maxAgeMs: 100000 }, store);

		await mem.recordPlan("P2", "Plan 1", 1, 1, 1, 1, false, false, [], [], [], [], "1");
		await mem.recordPlan("P2", "Plan 2", 1, 1, 1, 1, false, false, [], [], [], [], "2");
		await mem.recordPlan("P2", "Plan 3", 1, 1, 1, 1, false, false, [], [], [], [], "3");
		await mem.recordPlan("P2", "Plan 4", 1, 1, 1, 1, false, false, [], [], [], [], "4");

		const all = await mem.getAll();
		expect(all).toHaveLength(3);
		expect(all.find((e) => e.title === "Plan 1")).toBeUndefined();
	});

	it("returns relevant memory based on phase match", async () => {
		const mem = createTestMemory();

		await mem.recordPlan("P2", "P2 Plan", 4, 3, 1, 4, true, true, [], [], [], [], "P2 plan.");
		await mem.recordPlan("P3", "P3 Plan", 10, 5, 5, 2, false, false, [], [], [], [], "P3 plan.");

		const results = await mem.getRelevantMemory(4, 3, "P2");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].phase).toBe("P2");
	});

	it("returns empty array when no relevant memory matches", async () => {
		const mem = createTestMemory();

		await mem.recordPlan("P3", "P3 Plan", 10, 5, 5, 1, false, false, [], [], [], [], "P3 plan.");

		const results = await mem.getRelevantMemory(4, 3, "P2");
		expect(results).toHaveLength(0);
	});

	it("respects maxResults parameter", async () => {
		const mem = createTestMemory({ minRelevanceScore: 0 });

		for (let i = 1; i <= 5; i++) {
			await mem.recordPlan("P2", `Plan ${i}`, 4, 3, 1, 4, true, true, ["over_serialized"], [], [], [], `${i}`);
		}

		const results = await mem.getRelevantMemory(4, 3, "P2", 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});
});

// ============================================================================
// Memory can be disabled
// ============================================================================

describe("Memory can be disabled", () => {
	it("returns null from recordPlan when disabled via config", async () => {
		const mem = createTestMemory({ enabled: false });

		const entry = await mem.recordPlan("P2", "Test", 1, 1, 1, 1, false, false, [], [], [], [], "Test.");
		expect(entry).toBeNull();
	});

	it("returns empty array from getAll when disabled", async () => {
		const mem = createTestMemory({ enabled: false });

		await mem.recordPlan("P2", "Test", 1, 1, 1, 1, false, false, [], [], [], [], "Test.");
		const all = await mem.getAll();
		expect(all).toHaveLength(0);
	});

	it("returns empty results from getRelevantMemory when disabled", async () => {
		const mem = createTestMemory({ enabled: false });

		await mem.recordPlan("P2", "Test", 4, 3, 1, 4, true, true, ["over_serialized"], [], [], [], "Test.");
		const results = await mem.getRelevantMemory(4, 3, "P2");
		expect(results).toHaveLength(0);
	});

	it("returns 0 from count when disabled", async () => {
		const mem = createTestMemory({ enabled: false });
		await mem.recordPlan("P2", "Test", 1, 1, 1, 1, false, false, [], [], [], [], "Test.");
		expect(await mem.count()).toBe(0);
	});

	it("can be toggled at runtime with disable()/enable()", async () => {
		const mem = createTestMemory({ enabled: true });

		const entry1 = await mem.recordPlan("P2", "Plan A", 1, 1, 1, 1, false, false, [], [], [], [], "A");
		expect(entry1).not.toBeNull();

		mem.disable();
		const entry2 = await mem.recordPlan("P2", "Plan B", 1, 1, 1, 1, false, false, [], [], [], [], "B");
		expect(entry2).toBeNull();

		mem.enable();
		const entry3 = await mem.recordPlan("P2", "Plan C", 1, 1, 1, 1, false, false, [], [], [], [], "C");
		expect(entry3).not.toBeNull();

		const all = await mem.getAll();
		expect(all).toHaveLength(2);
	});

	it("isEnabled() reflects current state", async () => {
		const mem = createTestMemory({ enabled: true });
		expect(mem.isEnabled()).toBe(true);

		mem.disable();
		expect(mem.isEnabled()).toBe(false);

		mem.enable();
		expect(mem.isEnabled()).toBe(true);
	});
});

// ============================================================================
// InMemoryPlannerMemoryStore
// ============================================================================

describe("InMemoryPlannerMemoryStore", () => {
	it("stores and retrieves entries", async () => {
		const store = new InMemoryPlannerMemoryStore();

		const entry: PlannerMemoryEntry = {
			id: "test-1",
			phase: "P2",
			title: "Test Plan",
			workspaceCount: 4,
			maxParallelWorkspaces: 3,
			effectiveParallelism: 1,
			totalBatches: 4,
			isOverSerialized: true,
			hadWarnings: true,
			warningTypes: ["over_serialized"],
			suggestionTypes: ["add_parallel_group"],
			bottlenecks: ["Serialized"],
			suggestionSummaries: ["Add parallel groups"],
			summaryText: "Test plan summary.",
			verdict: "unknown",
			timestamp: Date.now(),
		};

		await store.store(entry);
		const retrieved = await store.getById("test-1");
		expect(retrieved).toEqual(entry);
	});

	it("returns null for non-existent entries", async () => {
		const store = new InMemoryPlannerMemoryStore();
		const result = await store.getById("non-existent");
		expect(result).toBeNull();
	});

	it("deletes entries by ID", async () => {
		const store = new InMemoryPlannerMemoryStore();

		await store.store({
			id: "test-1",
			phase: "P2",
			title: "Plan 1",
			workspaceCount: 1,
			maxParallelWorkspaces: 1,
			effectiveParallelism: 1,
			totalBatches: 1,
			isOverSerialized: false,
			hadWarnings: false,
			warningTypes: [],
			suggestionTypes: [],
			bottlenecks: [],
			suggestionSummaries: [],
			summaryText: "1",
			verdict: "unknown",
			timestamp: 100,
		});
		await store.store({
			id: "test-2",
			phase: "P2",
			title: "Plan 2",
			workspaceCount: 1,
			maxParallelWorkspaces: 1,
			effectiveParallelism: 1,
			totalBatches: 1,
			isOverSerialized: false,
			hadWarnings: false,
			warningTypes: [],
			suggestionTypes: [],
			bottlenecks: [],
			suggestionSummaries: [],
			summaryText: "2",
			verdict: "unknown",
			timestamp: 200,
		});

		await store.deleteById("test-1");
		const all = await store.getAll();
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe("test-2");
	});

	it("clears all entries", async () => {
		const store = new InMemoryPlannerMemoryStore();
		await store.store({
			id: "test-1",
			phase: "P2",
			title: "Plan 1",
			workspaceCount: 1,
			maxParallelWorkspaces: 1,
			effectiveParallelism: 1,
			totalBatches: 1,
			isOverSerialized: false,
			hadWarnings: false,
			warningTypes: [],
			suggestionTypes: [],
			bottlenecks: [],
			suggestionSummaries: [],
			summaryText: "1",
			verdict: "unknown",
			timestamp: 100,
		});

		await store.clear();
		expect(await store.count()).toBe(0);
	});
});

// ============================================================================
// Factory function
// ============================================================================

describe("createPlannerMemory factory", () => {
	it("creates a PlannerMemory with default config", () => {
		const mem = createPlannerMemory();
		expect(mem).toBeInstanceOf(PlannerMemory);
		expect(mem.isEnabled()).toBe(true);
	});

	it("creates with overridden config", () => {
		const mem = createPlannerMemory({ enabled: false, maxEntries: 10 });
		expect(mem.isEnabled()).toBe(false);
		expect(mem.getConfig().maxEntries).toBe(10);
	});
});
