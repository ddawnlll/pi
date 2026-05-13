/**
 * Plan Preview - Tests for workspace 7.E
 *
 * Acceptance Criteria:
 * 1. POST validate returns dependency graph, batches, warnings, and suggested fixes
 * 2. PATCH preview endpoint applies dependency patches without starting execution
 * 3. Run endpoint refuses unapproved interactive plans
 * 4. Existing validate/run behavior remains backward compatible
 */

import type { WorkspaceQueue } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	applyDependencyPatches,
	computeBatchPlan,
	type DependencyPatch,
	detectCycles,
	generateSuggestedFixes,
	requiresInteractiveApproval,
} from "../src/plan-preview.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function sampleQueue(): WorkspaceQueue {
	return {
		phase: "P7",
		title: "API Validate and Preview Endpoints",
		maxParallelWorkspaces: 3,
		workspaces: [
			{
				id: "7.A",
				title: "Dependency Graph",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Batch Computation",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.C",
				title: "Preview Endpoint",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.D",
				title: "Run Refusal",
				dependencies: ["7.B", "7.C"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
	};
}

function serialQueue(): WorkspaceQueue {
	return {
		phase: "P7",
		title: "Serialized Plan",
		maxParallelWorkspaces: 3,
		workspaces: [
			{
				id: "7.A",
				title: "First",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Second",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.C",
				title: "Third",
				dependencies: ["7.B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
	};
}

function cycleQueue(): WorkspaceQueue {
	return {
		phase: "P7",
		title: "Cycle Plan",
		maxParallelWorkspaces: 2,
		workspaces: [
			{
				id: "7.A",
				title: "A",
				dependencies: ["7.B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "B",
				dependencies: ["7.C"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.C",
				title: "C",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
	};
}

function missingDepQueue(): WorkspaceQueue {
	return {
		phase: "P7",
		title: "Missing Dep Plan",
		maxParallelWorkspaces: 2,
		workspaces: [
			{
				id: "7.A",
				title: "Valid",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Invalid Dep",
				dependencies: ["7.Z"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
	};
}

function interactiveQueue(): WorkspaceQueue {
	return {
		...sampleQueue(),
		planExecution: {
			interactiveParallelismReview: true,
		},
	};
}

function parallelismReviewQueue(): WorkspaceQueue {
	return {
		...sampleQueue(),
		parallelismReview: {
			enabled: true,
			threshold: 2,
			description: "Review required for parallelism above threshold",
		},
	};
}

// ---------------------------------------------------------------------------
// AC 1: POST validate returns dependency graph, batches, warnings, and suggested fixes
// ---------------------------------------------------------------------------

describe("plan-preview validate enhancements", () => {
	describe("computeBatchPlan", () => {
		it("returns dependency graph with nodes, dependencies, and dependents", () => {
			const queue = sampleQueue();
			const result = computeBatchPlan(queue);

			expect(result.dependencyGraph).toBeDefined();
			expect(result.dependencyGraph).toHaveLength(4);

			// 7.A has no dependencies, but is depended on by 7.B and 7.C
			const nodeA = result.dependencyGraph.find((n) => n.id === "7.A")!;
			expect(nodeA.dependencies).toEqual([]);
			expect(nodeA.dependents).toContain("7.B");
			expect(nodeA.dependents).toContain("7.C");

			// 7.D depends on 7.B and 7.C
			const nodeD = result.dependencyGraph.find((n) => n.id === "7.D")!;
			expect(nodeD.dependencies).toContain("7.B");
			expect(nodeD.dependencies).toContain("7.C");
			expect(nodeD.dependents).toEqual([]);
		});

		it("returns topological batches in correct order", () => {
			const queue = sampleQueue();
			const result = computeBatchPlan(queue);

			expect(result.batches).toBeDefined();
			expect(result.batches.length).toBeGreaterThan(0);

			// Batch 1 should contain 7.A (no dependencies)
			const batch1 = result.batches.find((b) => b.batchIndex === 1)!;
			expect(batch1.workspaceIds).toContain("7.A");

			// Batch 2 should contain 7.B and 7.C (depend on 7.A)
			const batch2 = result.batches.find((b) => b.batchIndex === 2)!;
			expect(batch2.workspaceIds).toContain("7.B");
			expect(batch2.workspaceIds).toContain("7.C");

			// Batch 3 should contain 7.D (depends on 7.B and 7.C)
			const batch3 = result.batches.find((b) => b.batchIndex === 3)!;
			expect(batch3.workspaceIds).toContain("7.D");
		});

		it("computes effective and requested parallelism", () => {
			const queue = sampleQueue();
			const result = computeBatchPlan(queue);

			expect(result.requestedParallelism).toBe(3);
			expect(result.effectiveParallelism).toBe(2); // max width is batch 2 with 7.B and 7.C
			expect(result.parallelismDelta).toBe(1);
		});

		it("detects over-serialization", () => {
			const queue = serialQueue();
			const result = computeBatchPlan(queue);

			expect(result.isOverSerialized).toBe(true);
			expect(result.effectiveParallelism).toBe(1);
			expect(result.requestedParallelism).toBe(3);
		});

		it("returns over-serialized warning", () => {
			const queue = serialQueue();
			const result = computeBatchPlan(queue);

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings.some((w) => w.type === "over_serialized")).toBe(true);
		});

		it("returns low effective parallelism warning when below max", () => {
			const queue = sampleQueue();
			const result = computeBatchPlan(queue);

			expect(result.warnings.some((w) => w.type === "low_effective_parallelism")).toBe(true);
		});

		it("assigns batch indices to graph nodes", () => {
			const queue = sampleQueue();
			const result = computeBatchPlan(queue);

			const nodeA = result.dependencyGraph.find((n) => n.id === "7.A")!;
			expect(nodeA.batchIndex).toBe(1);

			const nodeD = result.dependencyGraph.find((n) => n.id === "7.D")!;
			expect(nodeD.batchIndex).toBe(3);
		});

		it("handles empty queue", () => {
			const queue: WorkspaceQueue = {
				phase: "P7",
				title: "Empty",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};
			const result = computeBatchPlan(queue);

			expect(result.errors.length).toBe(1);
			expect(result.errors[0].type).toBe("empty_queue");
			expect(result.batches).toEqual([]);
		});

		it("detects cycles", () => {
			const queue = cycleQueue();
			const result = computeBatchPlan(queue);

			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors.some((e) => e.type === "cycle")).toBe(true);
		});

		it("detects missing dependencies", () => {
			const queue = missingDepQueue();
			const result = computeBatchPlan(queue);

			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors.some((e) => e.type === "missing_dependency")).toBe(true);
		});
	});

	describe("detectCycles", () => {
		it("returns hasCycle=false for a valid DAG", () => {
			const queue = sampleQueue();
			const result = detectCycles(queue.workspaces);
			expect(result.hasCycle).toBe(false);
		});

		it("returns hasCycle=true for a cycle", () => {
			const queue = cycleQueue();
			const result = detectCycles(queue.workspaces);
			expect(result.hasCycle).toBe(true);
			expect(result.cycle).toBeDefined();
		});

		it("handles self-loop", () => {
			const queue: WorkspaceQueue = {
				phase: "P7",
				title: "Self Loop",
				maxParallelWorkspaces: 1,
				workspaces: [
					{
						id: "7.A",
						title: "Self",
						dependencies: ["7.A"],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};
			const result = detectCycles(queue.workspaces);
			expect(result.hasCycle).toBe(true);
		});
	});

	describe("generateSuggestedFixes", () => {
		it("suggests removing dependencies for over-serialized plans", () => {
			const queue = serialQueue();
			const batchPlan = computeBatchPlan(queue);
			const fixes = generateSuggestedFixes(queue, batchPlan);

			expect(fixes.length).toBeGreaterThan(0);
			expect(fixes.some((f) => f.category === "remove_dependency")).toBe(true);
		});

		it("suggests adjusting parallelism for under-utilized plans", () => {
			const queue = sampleQueue();
			const batchPlan = computeBatchPlan(queue);
			const fixes = generateSuggestedFixes(queue, batchPlan);

			expect(fixes.some((f) => f.category === "adjust_parallelism")).toBe(true);
		});

		it("suggests cycle resolution for cyclic plans", () => {
			const queue = cycleQueue();
			const batchPlan = computeBatchPlan(queue);
			const fixes = generateSuggestedFixes(queue, batchPlan);

			expect(fixes.some((f) => f.category === "resolve_cycle")).toBe(true);
		});

		it("suggests fixes for missing dependencies", () => {
			const queue = missingDepQueue();
			const batchPlan = computeBatchPlan(queue);
			const fixes = generateSuggestedFixes(queue, batchPlan);

			expect(fixes.some((f) => f.category === "add_dependency")).toBe(true);
		});

		it("includes patches in suggested fixes where applicable", () => {
			const queue = serialQueue();
			const batchPlan = computeBatchPlan(queue);
			const fixes = generateSuggestedFixes(queue, batchPlan);

			const fixWithPatch = fixes.find((f) => f.patch !== undefined);
			expect(fixWithPatch).toBeDefined();
			expect(fixWithPatch!.patch!.action).toBe("remove_dependency");
		});
	});
});

// ---------------------------------------------------------------------------
// AC 2: PATCH preview endpoint applies dependency patches without starting execution
// ---------------------------------------------------------------------------

describe("plan-preview preview patches", () => {
	describe("applyDependencyPatches", () => {
		it("applies a remove_dependency patch", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [{ workspaceId: "7.B", action: "remove_dependency", dependencyId: "7.A" }];

			const result = applyDependencyPatches(queue, patches);

			expect(result.success).toBe(true);
			expect(result.appliedPatches).toHaveLength(1);
			expect(result.rejectedPatches).toHaveLength(0);

			// Check that 7.B no longer depends on 7.A in the preview
			const wsB = result.previewQueue!.workspaces.find((w) => w.id === "7.B")!;
			expect(wsB.dependencies).not.toContain("7.A");
		});

		it("applies an add_dependency patch", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [{ workspaceId: "7.C", action: "add_dependency", dependencyId: "7.B" }];

			const result = applyDependencyPatches(queue, patches);

			expect(result.success).toBe(true);
			expect(result.appliedPatches).toHaveLength(1);

			const wsC = result.previewQueue!.workspaces.find((w) => w.id === "7.C")!;
			expect(wsC.dependencies).toContain("7.B");
		});

		it("rejects patches for non-existent workspaces", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [{ workspaceId: "7.Z", action: "remove_dependency", dependencyId: "7.A" }];

			const result = applyDependencyPatches(queue, patches);

			expect(result.rejectedPatches).toHaveLength(1);
			expect(result.rejectedPatches[0].reason).toContain("does not exist");
		});

		it("rejects removing a non-existent dependency", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [{ workspaceId: "7.A", action: "remove_dependency", dependencyId: "7.Z" }];

			const result = applyDependencyPatches(queue, patches);

			expect(result.rejectedPatches).toHaveLength(1);
			expect(result.rejectedPatches[0].reason).toContain("does not depend");
		});

		it("rejects adding an already-existing dependency", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [{ workspaceId: "7.B", action: "add_dependency", dependencyId: "7.A" }];

			const result = applyDependencyPatches(queue, patches);

			expect(result.rejectedPatches).toHaveLength(1);
			expect(result.rejectedPatches[0].reason).toContain("already depends");
		});

		it("rejects self-dependency", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [{ workspaceId: "7.A", action: "add_dependency", dependencyId: "7.A" }];

			const result = applyDependencyPatches(queue, patches);

			expect(result.rejectedPatches).toHaveLength(1);
			expect(result.rejectedPatches[0].reason).toContain("cannot depend on itself");
		});

		it("detects cycles introduced by patches", () => {
			// Add 7.A -> 7.D dependency to create: 7.A -> 7.D -> 7.B -> 7.A?
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [
				{ workspaceId: "7.D", action: "add_dependency", dependencyId: "7.A" },
				{ workspaceId: "7.A", action: "add_dependency", dependencyId: "7.D" },
			];

			const result = applyDependencyPatches(queue, patches);

			expect(result.success).toBe(false);
			expect(result.errors.some((e) => e.includes("cycle") || e.includes("Cycle"))).toBe(true);
		});

		it("returns batch plan for the patched queue", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [{ workspaceId: "7.B", action: "remove_dependency", dependencyId: "7.A" }];

			const result = applyDependencyPatches(queue, patches);

			expect(result.batchPlan).toBeDefined();
			expect(result.batchPlan!.batches.length).toBeGreaterThan(0);

			// 7.B and 7.A should now be in the same batch
			const batch1 = result.batchPlan!.batches.find((b) => b.batchIndex === 1)!;
			expect(batch1.workspaceIds).toContain("7.A");
			expect(batch1.workspaceIds).toContain("7.B");
		});

		it("does not modify the original queue", () => {
			const queue = sampleQueue();
			const originalDeps = [...queue.workspaces.find((w) => w.id === "7.B")!.dependencies];

			const patches: DependencyPatch[] = [{ workspaceId: "7.B", action: "remove_dependency", dependencyId: "7.A" }];

			applyDependencyPatches(queue, patches);

			// Original queue should be unchanged
			expect(queue.workspaces.find((w) => w.id === "7.B")!.dependencies).toEqual(originalDeps);
		});

		it("applies multiple patches in order", () => {
			const queue = sampleQueue();
			const patches: DependencyPatch[] = [
				{ workspaceId: "7.B", action: "remove_dependency", dependencyId: "7.A" },
				{ workspaceId: "7.C", action: "add_dependency", dependencyId: "7.B" },
			];

			const result = applyDependencyPatches(queue, patches);

			expect(result.success).toBe(true);
			expect(result.appliedPatches).toHaveLength(2);
		});

		it("handles empty patches array", () => {
			const queue = sampleQueue();
			const result = applyDependencyPatches(queue, []);

			expect(result.success).toBe(true);
			expect(result.appliedPatches).toHaveLength(0);
			expect(result.rejectedPatches).toHaveLength(0);
			expect(result.previewQueue).toBeDefined();
		});
	});
});

// ---------------------------------------------------------------------------
// AC 3: Run endpoint refuses unapproved interactive plans
// ---------------------------------------------------------------------------

describe("plan-preview interactive approval", () => {
	describe("requiresInteractiveApproval", () => {
		it("returns false for normal plans", () => {
			const queue = sampleQueue();
			expect(requiresInteractiveApproval(queue)).toBe(false);
		});

		it("returns true when interactiveParallelismReview is enabled", () => {
			const queue = interactiveQueue();
			expect(requiresInteractiveApproval(queue)).toBe(true);
		});

		it("returns true when parallelismReview is enabled", () => {
			const queue = parallelismReviewQueue();
			expect(requiresInteractiveApproval(queue)).toBe(true);
		});

		it("returns false when interactiveParallelismReview is false", () => {
			const queue: WorkspaceQueue = {
				...sampleQueue(),
				planExecution: {
					interactiveParallelismReview: false,
				},
			};
			expect(requiresInteractiveApproval(queue)).toBe(false);
		});

		it("returns false when parallelismReview is disabled", () => {
			const queue: WorkspaceQueue = {
				...sampleQueue(),
				parallelismReview: { enabled: false },
			};
			expect(requiresInteractiveApproval(queue)).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// AC 4: Existing validate/run behavior remains backward compatible
// ---------------------------------------------------------------------------

describe("plan-preview backward compatibility", () => {
	describe("computeBatchPlan backward compat", () => {
		it("returns the same fields as before for a simple plan", () => {
			const queue = sampleQueue();
			const result = computeBatchPlan(queue);

			// New fields should be additive
			expect(result).toHaveProperty("dependencyGraph");
			expect(result).toHaveProperty("batches");
			expect(result).toHaveProperty("totalBatches");
			expect(result).toHaveProperty("effectiveParallelism");
			expect(result).toHaveProperty("requestedParallelism");
			expect(result).toHaveProperty("isOverSerialized");
			expect(result).toHaveProperty("warnings");
			expect(result).toHaveProperty("errors");
		});

		it("validate response still includes original fields (parseResult, safety, warnings)", () => {
			// This is tested at the API level; here we verify the computeBatchPlan
			// result can be merged alongside original fields without conflict
			const queue = sampleQueue();
			const result = computeBatchPlan(queue);

			// The result should be safely mergeable with the original response
			const originalFields = {
				success: true,
				parseResult: { title: queue.title, phase: queue.phase },
				safety: { safe: true, critical: [], warnings: [], info: [], totalIssues: 0 },
				warnings: [],
			};

			const merged = { ...originalFields, ...result };
			expect(merged.success).toBe(true);
			expect(merged.parseResult).toBeDefined();
			expect(merged.safety).toBeDefined();
			expect(merged.dependencyGraph).toBeDefined();
			expect(merged.batches).toBeDefined();
		});
	});

	describe("applyDependencyPatches backward compat", () => {
		it("with empty patches, returns the same queue structure", () => {
			const queue = sampleQueue();
			const result = applyDependencyPatches(queue, []);

			expect(result.success).toBe(true);
			expect(result.previewQueue!.phase).toBe(queue.phase);
			expect(result.previewQueue!.title).toBe(queue.title);
			expect(result.previewQueue!.maxParallelWorkspaces).toBe(queue.maxParallelWorkspaces);
			expect(result.previewQueue!.workspaces).toHaveLength(queue.workspaces.length);
		});

		it("preserves workspace properties beyond dependencies", () => {
			const queue: WorkspaceQueue = {
				phase: "P7",
				title: "Rich Queue",
				maxParallelWorkspaces: 2,
				workspaces: [
					{
						id: "7.A",
						title: "Rich Workspace",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 5,
						riskLevel: "high",
						autoCommit: false,
					},
					{
						id: "7.B",
						title: "Dependent",
						dependencies: ["7.A"],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const patches: DependencyPatch[] = [{ workspaceId: "7.B", action: "remove_dependency", dependencyId: "7.A" }];

			const result = applyDependencyPatches(queue, patches);
			expect(result.success).toBe(true);

			// 7.A should retain its original properties
			const wsA = result.previewQueue!.workspaces.find((w) => w.id === "7.A")!;
			expect(wsA.title).toBe("Rich Workspace");
			expect(wsA.maxRetries).toBe(5);
			expect(wsA.riskLevel).toBe("high");
			expect(wsA.autoCommit).toBe(false);
		});
	});
});
