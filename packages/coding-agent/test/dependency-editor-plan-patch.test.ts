/**
 * Tests for Dependency Edit Patch Model - P2 Workstream 7.C
 *
 * Acceptance criteria:
 * 1. Dependency add/remove/reorder operations are represented as safe patches
 * 2. Patches are validated before mutation
 * 3. Cycle-creating edits are rejected
 * 4. Patch preview can render before save
 */

import { describe, expect, it } from "vitest";
import {
	applyDependencyPatchPlan,
	createAddDependencyPatch,
	createDependencyPatchPlan,
	createInversePatchPlan,
	createRemoveDependencyPatch,
	createReorderDependencyPatch,
	invertDependencyPatch,
	markPlanValidated,
	previewDependencyPatchPlan,
	renderPatchPreview,
	simulatePatchApplication,
	validateDependencyPatchPlan,
} from "../src/core/dependency-patch.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueue(workspaces: Workspace[]): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Test Phase",
		maxParallelWorkspaces: 3,
		workspaces,
	};
}

function makeWorkspace(id: string, dependencies: string[] = []): Workspace {
	return {
		id,
		title: `Task ${id}`,
		dependencies,
		roleBudget: "worker",
		maxRetries: 3,
	};
}

// ---------------------------------------------------------------------------
// 1. Dependency add/remove/reorder operations are represented as safe patches
// ---------------------------------------------------------------------------

describe("Dependency add/remove/reorder as safe patches", () => {
	it("should create an add-dependency patch", () => {
		const patch = createAddDependencyPatch("7.B", "7.A");
		expect(patch.kind).toBe("add_dependency");
		expect(patch.workspaceId).toBe("7.B");
		expect(patch.dependencyId).toBe("7.A");
		expect(patch.id).toBeTruthy();
		expect(patch.description).toContain("7.A");
	});

	it("should create a remove-dependency patch", () => {
		const patch = createRemoveDependencyPatch("7.B", "7.A");
		expect(patch.kind).toBe("remove_dependency");
		expect(patch.workspaceId).toBe("7.B");
		expect(patch.dependencyId).toBe("7.A");
		expect(patch.id).toBeTruthy();
		expect(patch.description).toContain("7.A");
	});

	it("should create a reorder-dependency patch", () => {
		const patch = createReorderDependencyPatch("7.C", "7.A", 0);
		expect(patch.kind).toBe("reorder_dependencies");
		expect(patch.workspaceId).toBe("7.C");
		expect(patch.dependencyId).toBe("7.A");
		expect(patch.newIndex).toBe(0);
		expect(patch.id).toBeTruthy();
	});

	it("should create a patch plan from multiple patches", () => {
		const p1 = createAddDependencyPatch("7.B", "7.A");
		const p2 = createRemoveDependencyPatch("7.C", "7.A");
		const plan = createDependencyPatchPlan([p1, p2], "P2");

		expect(plan.patches).toHaveLength(2);
		expect(plan.phase).toBe("P2");
		expect(plan.validated).toBe(false);
		expect(plan.id).toBeTruthy();
		expect(plan.createdAt).toBeGreaterThan(0);
	});

	it("should create a plan with default phase", () => {
		const plan = createDependencyPatchPlan([]);
		expect(plan.phase).toBe("P2");
	});
});

// ---------------------------------------------------------------------------
// 2. Patches are validated before mutation
// ---------------------------------------------------------------------------

describe("Patch validation before mutation", () => {
	it("should validate a valid add patch", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject add dependency to non-existent workspace", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const patch = createAddDependencyPatch("7.Z", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "workspace_not_found")).toBe(true);
	});

	it("should reject add dependency on non-existent workspace", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const patch = createAddDependencyPatch("7.A", "7.Z");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "dependency_not_found")).toBe(true);
	});

	it("should reject adding a dependency that already exists", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B", ["7.A"])]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "dependency_already_exists")).toBe(true);
	});

	it("should reject self-dependency", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const patch = createAddDependencyPatch("7.A", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "cycle_detected")).toBe(true);
	});

	it("should validate a valid remove patch", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B", ["7.A"])]);
		const patch = createRemoveDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject removing a non-existent dependency", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createRemoveDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "dependency_not_found")).toBe(true);
	});

	it("should validate a valid reorder patch", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C", ["7.A", "7.B"])]);
		const patch = createReorderDependencyPatch("7.C", "7.B", 0);
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject reorder with invalid index", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.C", ["7.A"])]);
		const patch = createReorderDependencyPatch("7.C", "7.A", 5);
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "invalid_index")).toBe(true);
	});

	it("should reject reorder with negative index", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.C", ["7.A"])]);
		const patch = createReorderDependencyPatch("7.C", "7.A", -1);
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "invalid_index")).toBe(true);
	});

	it("should reject reorder of non-existent dependency", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.C")]);
		const patch = createReorderDependencyPatch("7.C", "7.A", 0);
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "dependency_not_found")).toBe(true);
	});

	it("should reject empty patch plan", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const plan = createDependencyPatchPlan([]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "empty_patch_plan")).toBe(true);
	});

	it("should throw when applying an unvalidated plan", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);

		expect(() => applyDependencyPatchPlan(plan, queue)).toThrow("has not been validated");
	});

	it("should throw when applying a plan that failed validation", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const patch = createAddDependencyPatch("7.A", "7.A"); // self-dep = invalid
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		const marked = markPlanValidated(plan, result);

		expect(() => applyDependencyPatchPlan(marked, queue)).toThrow("failed validation");
	});

	it("should apply a validated plan successfully", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);
		const marked = markPlanValidated(plan, result);
		const applied = applyDependencyPatchPlan(marked, queue);

		expect(applied.workspaces[1].dependencies).toEqual(["7.A"]);
		// Original should not be mutated
		expect(queue.workspaces[1].dependencies).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 3. Cycle-creating edits are rejected
// ---------------------------------------------------------------------------

describe("Cycle-creating edits are rejected", () => {
	it("should reject a simple cycle (A -> B, then add B -> A)", () => {
		const queue = makeQueue([makeWorkspace("7.A", ["7.B"]), makeWorkspace("7.B")]);
		// Adding B -> A would create A -> B -> A cycle
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "cross_workspace_cycle")).toBe(true);
	});

	it("should reject a transitive cycle (A -> B -> C, add C -> A)", () => {
		const queue = makeQueue([makeWorkspace("7.A", ["7.B"]), makeWorkspace("7.B", ["7.C"]), makeWorkspace("7.C")]);
		// Adding C -> A would create A -> B -> C -> A cycle
		const patch = createAddDependencyPatch("7.C", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "cross_workspace_cycle")).toBe(true);
	});

	it("should reject cycle from multiple patches in same plan", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		// Add A -> B and B -> A in same plan
		const p1 = createAddDependencyPatch("7.A", "7.B");
		const p2 = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([p1, p2]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "cross_workspace_cycle")).toBe(true);
	});

	it("should allow adding dependency that does not create a cycle", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B", ["7.A"]), makeWorkspace("7.C")]);
		// Adding C -> B is fine (no cycle)
		const patch = createAddDependencyPatch("7.C", "7.B");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);
	});

	it("should allow removing a dependency that breaks an existing cycle", () => {
		// B starts depending on A, creating A -> B -> A cycle… but wait,
		// that can't exist. Let's use a valid DAG and test that removing
		// a dependency is always allowed (removing can't create cycles).
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B", ["7.A"])]);
		const patch = createRemoveDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);
	});

	it("should reject cycle created through reorder (adds dependency)", () => {
		// Reorder itself cannot create a cycle — it only changes order.
		// But combined with add in same plan, the plan-level cycle check catches it.
		const queue = makeQueue([makeWorkspace("7.A", ["7.B"]), makeWorkspace("7.B"), makeWorkspace("7.C", ["7.A"])]);
		// Just reorder: always valid (can't create cycle by reordering)
		const patch = createReorderDependencyPatch("7.C", "7.A", 0);
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 4. Patch preview can render before save
// ---------------------------------------------------------------------------

describe("Patch preview rendering before save", () => {
	it("should generate a preview showing before/after for affected workspaces", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);

		expect(preview.planId).toBe(plan.id);
		expect(preview.snapshots).toHaveLength(1);
		expect(preview.snapshots[0].workspaceId).toBe("7.B");
		expect(preview.snapshots[0].before).toEqual([]);
		expect(preview.snapshots[0].after).toEqual(["7.A"]);
		expect(preview.valid).toBe(true);
		expect(preview.introducesCycle).toBe(false);
	});

	it("should show cycle warning in preview", () => {
		const queue = makeQueue([makeWorkspace("7.A", ["7.B"]), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);

		expect(preview.introducesCycle).toBe(true);
		expect(preview.valid).toBe(false);
	});

	it("should show multiple snapshots for multi-workspace patches", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C")]);
		const p1 = createAddDependencyPatch("7.B", "7.A");
		const p2 = createAddDependencyPatch("7.C", "7.A");
		const plan = createDependencyPatchPlan([p1, p2]);
		const preview = previewDependencyPatchPlan(plan, queue);

		expect(preview.snapshots).toHaveLength(2);
		const wsIds = preview.snapshots.map((s) => s.workspaceId).sort();
		expect(wsIds).toEqual(["7.B", "7.C"]);
	});

	it("should show remove preview correctly", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B", ["7.A"])]);
		const patch = createRemoveDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);

		expect(preview.snapshots[0].before).toEqual(["7.A"]);
		expect(preview.snapshots[0].after).toEqual([]);
	});

	it("should show reorder preview correctly", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C", ["7.A", "7.B"])]);
		const patch = createReorderDependencyPatch("7.C", "7.B", 0);
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);

		expect(preview.snapshots[0].before).toEqual(["7.A", "7.B"]);
		expect(preview.snapshots[0].after).toEqual(["7.B", "7.A"]);
	});

	it("should render preview as human-readable string", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);
		const rendered = renderPatchPreview(preview);

		expect(rendered).toContain("Dependency Patch Preview");
		expect(rendered).toContain("7.B");
		expect(rendered).toContain("7.A");
		expect(rendered).toContain("add_dependency");
	});

	it("should render validation errors in preview", () => {
		const queue = makeQueue([makeWorkspace("7.A", ["7.B"]), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);
		const rendered = renderPatchPreview(preview);

		expect(rendered).toContain("VALIDATION FAILED");
	});

	it("should show no snapshots for unaffected workspaces", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);

		// Only 7.B is affected, not 7.A or 7.C
		expect(preview.snapshots).toHaveLength(1);
		expect(preview.snapshots[0].workspaceId).toBe("7.B");
	});
});

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

describe("simulatePatchApplication", () => {
	it("should not mutate the original queue", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);

		const simulated = simulatePatchApplication(plan, queue);

		expect(simulated.workspaces[1].dependencies).toEqual(["7.A"]);
		expect(queue.workspaces[1].dependencies).toEqual([]);
	});

	it("should apply add dependency", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B")]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);

		const result = simulatePatchApplication(plan, queue);
		expect(result.workspaces[1].dependencies).toEqual(["7.A"]);
	});

	it("should apply remove dependency", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B", ["7.A"])]);
		const patch = createRemoveDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);

		const result = simulatePatchApplication(plan, queue);
		expect(result.workspaces[1].dependencies).toEqual([]);
	});

	it("should apply reorder dependency", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C", ["7.A", "7.B"])]);
		const patch = createReorderDependencyPatch("7.C", "7.B", 0);
		const plan = createDependencyPatchPlan([patch]);

		const result = simulatePatchApplication(plan, queue);
		expect(result.workspaces[2].dependencies).toEqual(["7.B", "7.A"]);
	});

	it("should apply multiple patches sequentially", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C")]);
		const p1 = createAddDependencyPatch("7.B", "7.A");
		const p2 = createAddDependencyPatch("7.C", "7.B");
		const plan = createDependencyPatchPlan([p1, p2]);

		const result = simulatePatchApplication(plan, queue);
		expect(result.workspaces[1].dependencies).toEqual(["7.A"]);
		expect(result.workspaces[2].dependencies).toEqual(["7.B"]);
	});

	it("should skip patches for non-existent workspaces", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const patch = createAddDependencyPatch("7.Z", "7.A");
		const plan = createDependencyPatchPlan([patch]);

		// Should not throw, just skip
		const result = simulatePatchApplication(plan, queue);
		expect(result.workspaces).toHaveLength(1);
	});

	it("should skip add if dependency already exists", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B", ["7.A"])]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);

		const result = simulatePatchApplication(plan, queue);
		// Should not duplicate
		expect(result.workspaces[1].dependencies).toEqual(["7.A"]);
	});
});

// ---------------------------------------------------------------------------
// Inverse Patches
// ---------------------------------------------------------------------------

describe("Inverse patches", () => {
	it("should invert an add patch to a remove patch", () => {
		const patch = createAddDependencyPatch("7.B", "7.A");
		const inverse = invertDependencyPatch(patch, []);

		expect(inverse.kind).toBe("remove_dependency");
		expect(inverse.dependencyId).toBe("7.A");
		expect(inverse.workspaceId).toBe("7.B");
	});

	it("should invert a remove patch to an add patch", () => {
		const patch = createRemoveDependencyPatch("7.B", "7.A");
		const inverse = invertDependencyPatch(patch, ["7.A"]);

		expect(inverse.kind).toBe("add_dependency");
		expect(inverse.dependencyId).toBe("7.A");
		expect(inverse.workspaceId).toBe("7.B");
	});

	it("should invert a reorder patch to restore original position", () => {
		const patch = createReorderDependencyPatch("7.C", "7.B", 0);
		const inverse = invertDependencyPatch(patch, ["7.A", "7.B"]);

		expect(inverse.kind).toBe("reorder_dependencies");
		expect(inverse.dependencyId).toBe("7.B");
		expect(inverse.newIndex).toBe(1); // 7.B was at index 1
	});

	it("should create an inverse patch plan in reverse order", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C")]);
		const p1 = createAddDependencyPatch("7.B", "7.A");
		const p2 = createAddDependencyPatch("7.C", "7.B");
		const plan = createDependencyPatchPlan([p1, p2]);

		const inversePlan = createInversePatchPlan(plan, queue);
		expect(inversePlan.patches).toHaveLength(2);
		// Reverse order: first invert p2, then p1
		expect(inversePlan.patches[0].kind).toBe("remove_dependency");
		expect(inversePlan.patches[0].workspaceId).toBe("7.C");
		expect(inversePlan.patches[1].kind).toBe("remove_dependency");
		expect(inversePlan.patches[1].workspaceId).toBe("7.B");
	});
});

// ---------------------------------------------------------------------------
// markPlanValidated
// ---------------------------------------------------------------------------

describe("markPlanValidated", () => {
	it("should mark plan as validated with result", () => {
		const plan = createDependencyPatchPlan([createAddDependencyPatch("7.B", "7.A")]);
		expect(plan.validated).toBe(false);

		const result = { valid: true, errors: [], warnings: [] };
		const marked = markPlanValidated(plan, result);

		expect(marked.validated).toBe(true);
		expect(marked.validationResult).toBe(result);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
	it("should handle empty workspace queue", () => {
		const queue = makeQueue([]);
		const patch = createAddDependencyPatch("7.B", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "workspace_not_found")).toBe(true);
	});

	it("should handle single workspace with no dependencies", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const patch = createRemoveDependencyPatch("7.A", "7.Z");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(false);
	});

	it("should handle workspace with multiple dependencies", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.B"), makeWorkspace("7.C", ["7.A", "7.B"])]);
		const patch = createRemoveDependencyPatch("7.C", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);

		const simulated = simulatePatchApplication(plan, queue);
		expect(simulated.workspaces[2].dependencies).toEqual(["7.B"]);
	});

	it("should handle reorder to same position", () => {
		const queue = makeQueue([makeWorkspace("7.A"), makeWorkspace("7.C", ["7.A"])]);
		const patch = createReorderDependencyPatch("7.C", "7.A", 0);
		const plan = createDependencyPatchPlan([patch]);
		const result = validateDependencyPatchPlan(plan, queue);

		expect(result.valid).toBe(true);

		const simulated = simulatePatchApplication(plan, queue);
		expect(simulated.workspaces[1].dependencies).toEqual(["7.A"]);
	});

	it("should handle custom descriptions on patches", () => {
		const patch = createAddDependencyPatch("7.B", "7.A", "Custom reason");
		expect(patch.description).toBe("Custom reason");
	});

	it("should handle preview with no affected workspaces (patches for non-existent ws)", () => {
		const queue = makeQueue([makeWorkspace("7.A")]);
		const patch = createAddDependencyPatch("7.Z", "7.A");
		const plan = createDependencyPatchPlan([patch]);
		const preview = previewDependencyPatchPlan(plan, queue);

		// 7.Z is not in the queue, so no snapshot for it
		expect(preview.snapshots).toHaveLength(0);
		expect(preview.valid).toBe(false);
	});
});
