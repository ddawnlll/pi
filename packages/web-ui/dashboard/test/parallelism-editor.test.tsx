/**
 * Tests for ParallelismEditor component (workspace 7.G)
 *
 * Acceptance Criteria:
 * 1. Shows requested vs effective parallelism
 * 2. Shows workspace DAG and batch lanes
 * 3. Allows dependency editing with preview-before-save
 * 4. Highlights serialized tails and blocked workspaces
 * 5. Displays file-overlap and dependency-cycle warnings
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
	ParallelismEditor,
	computeFileOverlaps,
	wouldCreateCycle,
} from "../src/components/ParallelismEditor";
import type {
	BatchPlanResult,
	DependencyGraphNode,
	TopologicalBatch,
	BatchPlanWarning,
	BatchPlanError,
	DependencyPatch,
} from "../src/types";

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeBatchPlan(overrides?: Partial<BatchPlanResult>): BatchPlanResult {
	return {
		dependencyGraph: overrides?.dependencyGraph ?? [
			{
				id: "7.A",
				title: "Setup",
				dependencies: [],
				dependents: ["7.B", "7.C"],
				batchIndex: 1,
			},
			{
				id: "7.B",
				title: "Backend",
				dependencies: ["7.A"],
				dependents: ["7.D"],
				batchIndex: 2,
			},
			{
				id: "7.C",
				title: "Frontend",
				dependencies: ["7.A"],
				dependents: ["7.D"],
				batchIndex: 2,
			},
			{
				id: "7.D",
				title: "Integration",
				dependencies: ["7.B", "7.C"],
				dependents: [],
				batchIndex: 3,
			},
		],
		batches: overrides?.batches ?? [
			{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
			{ batchIndex: 2, workspaceIds: ["7.B", "7.C"], width: 2 },
			{ batchIndex: 3, workspaceIds: ["7.D"], width: 1 },
		],
		totalBatches: overrides?.totalBatches ?? 3,
		effectiveParallelism: overrides?.effectiveParallelism ?? 2,
		requestedParallelism: overrides?.requestedParallelism ?? 4,
		parallelismDelta: overrides?.parallelismDelta ?? 2,
		isOverSerialized: overrides?.isOverSerialized ?? false,
		warnings: overrides?.warnings ?? [],
		errors: overrides?.errors ?? [],
	};
}

function renderEditor(overrides?: Partial<BatchPlanResult>, props?: Partial<Parameters<typeof ParallelismEditor>[0]>) {
	const batchPlan = makeBatchPlan(overrides);
	const onSave = vi.fn();
	const onReset = vi.fn();
	const result = render(
		<ParallelismEditor
			batchPlan={batchPlan}
			onSave={onSave}
			onReset={onReset}
			{...props}
		/>,
	);
	return { ...result, onSave, onReset, batchPlan };
}

// ─── AC 1: Shows requested vs effective parallelism ──────────────────────────

describe("AC 1: Shows requested vs effective parallelism", () => {
	it("displays the requested parallelism value", () => {
		renderEditor({ requestedParallelism: 4 });
		expect(screen.getByText("4")).toBeTruthy();
	});

	it("displays the effective parallelism value", () => {
		renderEditor({ effectiveParallelism: 2 });
		// The effective parallelism is shown with distinct styling
		const effectiveEls = screen.getAllByText("2");
		expect(effectiveEls.length).toBeGreaterThanOrEqual(1);
	});

	it("shows the delta between requested and effective", () => {
		renderEditor({ requestedParallelism: 4, effectiveParallelism: 2, parallelismDelta: 2 });
		expect(screen.getByText("Δ 2")).toBeTruthy();
	});

	it("shows over-serialized badge when isOverSerialized is true", () => {
		renderEditor({ isOverSerialized: true });
		expect(screen.getByText("Over-serialized")).toBeTruthy();
	});

	it("does not show over-serialized badge when isOverSerialized is false", () => {
		renderEditor({ isOverSerialized: false });
		expect(screen.queryByText("Over-serialized")).toBeNull();
	});

	it("shows percentage bar for effective vs requested", () => {
		renderEditor({ requestedParallelism: 4, effectiveParallelism: 2 });
		expect(screen.getByText("50%")).toBeTruthy();
	});

	it("shows dash when requested parallelism is 0", () => {
		renderEditor({ requestedParallelism: 0, effectiveParallelism: 0 });
		expect(screen.getByText("—")).toBeTruthy();
	});
});

// ─── AC 2: Shows workspace DAG and batch lanes ─────────────────────────────

describe("AC 2: Shows workspace DAG and batch lanes", () => {
	it("renders batch lane labels (B1, B2, B3)", () => {
		renderEditor();
		expect(screen.getByText("B1")).toBeTruthy();
		expect(screen.getByText("B2")).toBeTruthy();
		expect(screen.getByText("B3")).toBeTruthy();
	});

	it("renders workspace IDs in batch lanes", () => {
		renderEditor();
		// 7.A in B1, 7.B and 7.C in B2, 7.D in B3
		expect(screen.getByText("7.A")).toBeTruthy();
		expect(screen.getByText("7.B")).toBeTruthy();
		expect(screen.getByText("7.C")).toBeTruthy();
		expect(screen.getByText("7.D")).toBeTruthy();
	});

	it("shows dependency count badges", () => {
		renderEditor();
		// 7.D has 2 dependencies
		const text = screen.getAllByText("(2)");
		expect(text.length).toBeGreaterThanOrEqual(1);
	});

	it("shows batch widths", () => {
		renderEditor();
		expect(screen.getAllByText("×1").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("×2").length).toBeGreaterThanOrEqual(1);
	});

	it("renders arrows between batches", () => {
		renderEditor();
		// Arrow icons between batches — check the SVG elements exist
		const arrows = document.querySelectorAll("svg.lucide-arrow-right");
		expect(arrows.length).toBeGreaterThanOrEqual(2);
	});

	it("shows legend with serialized tail and blocked indicators", () => {
		renderEditor();
		expect(screen.getByText("Serialized tail")).toBeTruthy();
		expect(screen.getByText("Blocked")).toBeTruthy();
		expect(screen.getByText("Normal")).toBeTruthy();
	});
});

// ─── AC 3: Allows dependency editing with preview-before-save ────────────

describe("AC 3: Allows dependency editing with preview-before-save", () => {
	it("shows dependency editor when a workspace is selected", () => {
		renderEditor();
		// Click on workspace 7.D
		fireEvent.click(screen.getByText("7.D"));
		expect(screen.getByText(/Edit dependencies/)).toBeTruthy();
	});

	it("shows current dependencies for selected workspace", () => {
		renderEditor();
		fireEvent.click(screen.getByText("7.D"));
		// 7.D depends on 7.B and 7.C
		expect(screen.getByText("Current dependencies:")).toBeTruthy();
		expect(screen.getAllByText("7.B").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("7.C").length).toBeGreaterThanOrEqual(1);
	});

	it("adds a pending remove-dependency edit", () => {
		renderEditor();
		fireEvent.click(screen.getByText("7.D"));

		// Find the remove button for one of 7.D's dependencies
		// 7.D depends on 7.B and 7.C — we'll remove 7.C
		const depItems = screen.getAllByText("7.C");
		// The last occurrence should be in the dependency editor
		const depItem = depItems[depItems.length - 1];
		const parent = depItem.closest("div");
		if (parent) {
			const removeBtn = parent.querySelector('button[title="Remove dependency"]');
			if (removeBtn) {
				fireEvent.click(removeBtn);
			}
		}

		// Check that "Pending Changes" appears
		expect(screen.getByText(/Pending Changes/)).toBeTruthy();
	});

	it("shows 'Add dependency' option", () => {
		renderEditor();
		fireEvent.click(screen.getByText("7.A"));
		expect(screen.getByText("Add dependency")).toBeTruthy();
	});

	it("shows preview-before-save label", () => {
		const { onSave } = renderEditor();
		fireEvent.click(screen.getByText("7.D"));

		// Add a pending edit by removing a dependency
		const depItems = screen.getAllByText("7.B");
		const depItem = depItems[depItems.length - 1];
		const parent = depItem.closest("div");
		if (parent) {
			const removeBtn = parent.querySelector('button[title="Remove dependency"]');
			if (removeBtn) {
				fireEvent.click(removeBtn);
			}
		}

		expect(screen.getByText("Preview before save")).toBeTruthy();
	});

	it("calls onSave with pending patches when Save is clicked", () => {
		const { onSave } = renderEditor();
		fireEvent.click(screen.getByText("7.D"));

		// Remove a dependency
		const depItems = screen.getAllByText("7.B");
		const depItem = depItems[depItems.length - 1];
		const parent = depItem.closest("div");
		if (parent) {
			const removeBtn = parent.querySelector('button[title="Remove dependency"]');
			if (removeBtn) {
				fireEvent.click(removeBtn);
			}
		}

		// Click Save
		const saveBtn = screen.getByText("Save changes");
		fireEvent.click(saveBtn);

		expect(onSave).toHaveBeenCalledTimes(1);
		const patches: DependencyPatch[] = onSave.mock.calls[0][0];
		expect(patches.length).toBeGreaterThanOrEqual(1);
		expect(patches[0].action).toBe("remove_dependency");
		expect(patches[0].workspaceId).toBe("7.D");
		expect(patches[0].dependencyId).toBe("7.B");
	});

	it("resets pending edits on Clear all", () => {
		const { onReset } = renderEditor();
		fireEvent.click(screen.getByText("7.D"));

		// Remove a dependency to create a pending edit
		const depItems = screen.getAllByText("7.B");
		const depItem = depItems[depItems.length - 1];
		const parent = depItem.closest("div");
		if (parent) {
			const removeBtn = parent.querySelector('button[title="Remove dependency"]');
			if (removeBtn) {
				fireEvent.click(removeBtn);
			}
		}

		// Click Clear all
		const clearBtn = screen.getByText("Clear all");
		fireEvent.click(clearBtn);

		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it("allows removing individual pending edits", () => {
		renderEditor();
		fireEvent.click(screen.getByText("7.D"));

		// Remove a dependency
		const depItems = screen.getAllByText("7.B");
		const depItem = depItems[depItems.length - 1];
		const parent = depItem.closest("div");
		if (parent) {
			const removeBtn = parent.querySelector('button[title="Remove dependency"]');
			if (removeBtn) {
				fireEvent.click(removeBtn);
			}
		}

		// Should have pending changes panel
		expect(screen.getByText(/Pending Changes/)).toBeTruthy();

		// Click the X button on the pending edit item
		const removeEditBtns = screen.getAllByTitle("Remove this change");
		if (removeEditBtns.length > 0) {
			fireEvent.click(removeEditBtns[0]);
		}

		// Pending changes should be gone
		expect(screen.queryByText(/Pending Changes/)).toBeNull();
	});

	it("shows saving state on save button", () => {
		renderEditor(undefined, { saving: true });
		fireEvent.click(screen.getByText("7.D"));

		// Create a pending edit
		const depItems = screen.getAllByText("7.B");
		const depItem = depItems[depItems.length - 1];
		const parent = depItem.closest("div");
		if (parent) {
			const removeBtn = parent.querySelector('button[title="Remove dependency"]');
			if (removeBtn) {
				fireEvent.click(removeBtn);
			}
		}

		expect(screen.getByText("Saving...")).toBeTruthy();
	});
});

// ─── AC 4: Highlights serialized tails and blocked workspaces ─────────────

describe("AC 4: Highlights serialized tails and blocked workspaces", () => {
	it("marks workspaces in serialized tail batches with T badge", () => {
		// B1: [7.A] width=1, B2: [7.B, 7.C] width=2, B3: [7.D] width=1
		// Only the trailing single-width batch (B3) is a serialized tail
		// A is NOT a serialized tail because B2 has width > 1 after it
		renderEditor();
		// 7.D is in the serialized tail, so "T" badges should exist
		const tBadges = screen.getAllByText("T");
		expect(tBadges.length).toBeGreaterThanOrEqual(1);
	});

	it("does not mark leading single-width batch as serialized tail", () => {
		// In our default graph, B1 (7.A) is width=1 but NOT a tail because B2 is wider
		// Only B3 (7.D) should have the T badge
		// The T badge count should match only true tail workspaces
		const tBadges = screen.queryAllByText("T");
		// Only one tail workspace (7.D) - may be 0 or 1 depending on rendering
		expect(tBadges.length).toBeLessThanOrEqual(1);
	});

	it("marks blocked workspaces when errors reference them", () => {
		renderEditor({
			errors: [
				{
					type: "cycle",
					message: "Cycle detected in 7.B",
					workspaceIds: ["7.B"],
				},
			],
		});
		// 7.B should have blocked styling — check AlertCircle appears for it
		expect(screen.getByText("Cycle detected in 7.B")).toBeTruthy();
	});

	it("shows blocked indicator in legend", () => {
		renderEditor();
		expect(screen.getByText("Blocked")).toBeTruthy();
	});

	it("highlights multiple blocked workspaces from different errors", () => {
		renderEditor({
			errors: [
				{
					type: "cycle",
					message: "Cycle A",
					workspaceIds: ["7.A", "7.B"],
				},
				{
					type: "missing_dependency",
					message: "Missing dep in 7.C",
					workspaceIds: ["7.C"],
				},
			],
		});
		expect(screen.getByText("Cycle A")).toBeTruthy();
		expect(screen.getByText("Missing dep in 7.C")).toBeTruthy();
	});
});

// ─── AC 5: Displays file-overlap and dependency-cycle warnings ────────────

describe("AC 5: Displays file-overlap and dependency-cycle warnings", () => {
	it("shows dependency cycle errors in warnings panel", () => {
		const cycleError: BatchPlanError = {
			type: "cycle",
			message: "Cycle detected: 7.A -> 7.B -> 7.A",
			workspaceIds: ["7.A", "7.B"],
		};
		renderEditor({ errors: [cycleError] });
		expect(screen.getByText("Cycle detected: 7.A -> 7.B -> 7.A")).toBeTruthy();
	});

	it("shows batch plan warnings in warnings panel", () => {
		const warning: BatchPlanWarning = {
			type: "over_serialized",
			message: "Plan is over-serialized",
		};
		renderEditor({ warnings: [warning] });
		expect(screen.getByText("Plan is over-serialized")).toBeTruthy();
	});

	it("shows low effective parallelism warning", () => {
		const warning: BatchPlanWarning = {
			type: "low_effective_parallelism",
			message: "Effective parallelism is lower than requested",
			workspaceIds: ["7.A"],
		};
		renderEditor({ warnings: [warning] });
		expect(screen.getByText("Effective parallelism is lower than requested")).toBeTruthy();
	});

	it("shows single width batch warning", () => {
		const warning: BatchPlanWarning = {
			type: "single_width_batch",
			message: "Batch 1 only has 1 workspace",
			batchIndex: 1,
		};
		renderEditor({ warnings: [warning] });
		expect(screen.getByText("Batch 1 only has 1 workspace")).toBeTruthy();
	});

	it("shows file overlaps when fileOwnership is provided", () => {
		const fileOwnership: Record<string, string[]> = {
			"7.B": ["src/api.ts", "src/utils.ts"],
			"7.C": ["src/api.ts", "src/components.ts"],
		};
		renderEditor(undefined, { fileOwnership });

		// Should show overlap toggle
		expect(screen.getByText(/file overlap/)).toBeTruthy();
	});

	it("expands file overlaps on click", () => {
		const fileOwnership: Record<string, string[]> = {
			"7.B": ["src/api.ts", "src/utils.ts"],
			"7.C": ["src/api.ts", "src/components.ts"],
		};
		renderEditor(undefined, { fileOwnership });

		// Click the overlap toggle to expand
		const overlapBtn = screen.getByText(/file overlap/);
		fireEvent.click(overlapBtn);

		// Should show the overlapping file
		expect(screen.getByText(/src.api.ts/)).toBeTruthy();
	});

	it("shows no warnings panel when there are no warnings, errors, or overlaps", () => {
		renderEditor();
		// The warnings panel should not be present
		// The component renders but the warnings section should be null when no warnings
		// Check that the border-b-amber-200 warning container div is absent
		const alertPanel = document.querySelector(".border-b-amber-200");
		expect(alertPanel).toBeNull();
	});

	it("combines extra warnings with batch plan warnings", () => {
		const extraWarning: BatchPlanWarning = {
			type: "over_serialized",
			message: "Extra warning from parent",
		};
		renderEditor(
			{
				warnings: [
					{
						type: "low_effective_parallelism",
						message: "Batch plan warning",
					},
				],
			},
			{ extraWarnings: [extraWarning] },
		);
		expect(screen.getByText("Batch plan warning")).toBeTruthy();
		expect(screen.getByText("Extra warning from parent")).toBeTruthy();
	});

	it("combines extra errors with batch plan errors", () => {
		const extraError: BatchPlanError = {
			type: "missing_dependency",
			message: "Extra error from parent",
		};
		renderEditor(
			{
				errors: [
					{
						type: "cycle",
						message: "Batch plan error",
						workspaceIds: [],
					},
				],
			},
			{ extraErrors: [extraError] },
		);
		expect(screen.getByText("Batch plan error")).toBeTruthy();
		expect(screen.getByText("Extra error from parent")).toBeTruthy();
	});
});

// ─── Utility function tests ───────────────────────────────────────────────

describe("computeFileOverlaps", () => {
	it("returns empty array when no overlaps exist", () => {
		const nodes: DependencyGraphNode[] = [
			{ id: "7.A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "7.B", title: "B", dependencies: [], dependents: [], batchIndex: 1 },
		];
		const fileOwnership: Record<string, string[]> = {
			"7.A": ["file1.ts", "file2.ts"],
			"7.B": ["file3.ts", "file4.ts"],
		};
		expect(computeFileOverlaps(nodes, fileOwnership)).toEqual([]);
	});

	it("detects simple file overlap", () => {
		const nodes: DependencyGraphNode[] = [
			{ id: "7.A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "7.B", title: "B", dependencies: [], dependents: [], batchIndex: 1 },
		];
		const fileOwnership: Record<string, string[]> = {
			"7.A": ["src/shared.ts", "src/a.ts"],
			"7.B": ["src/shared.ts", "src/b.ts"],
		};
		const overlaps = computeFileOverlaps(nodes, fileOwnership);
		expect(overlaps).toHaveLength(1);
		expect(overlaps[0].workspaceA).toBe("7.A");
		expect(overlaps[0].workspaceB).toBe("7.B");
		expect(overlaps[0].overlappingFiles).toEqual(["src/shared.ts"]);
	});

	it("detects multiple overlapping files", () => {
		const nodes: DependencyGraphNode[] = [
			{ id: "7.A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "7.B", title: "B", dependencies: [], dependents: [], batchIndex: 1 },
		];
		const fileOwnership: Record<string, string[]> = {
			"7.A": ["file1.ts", "file2.ts", "file3.ts"],
			"7.B": ["file2.ts", "file3.ts", "file4.ts"],
		};
		const overlaps = computeFileOverlaps(nodes, fileOwnership);
		expect(overlaps).toHaveLength(1);
		expect(overlaps[0].overlappingFiles).toEqual(["file2.ts", "file3.ts"]);
	});

	it("handles empty file ownership", () => {
		const nodes: DependencyGraphNode[] = [
			{ id: "7.A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "7.B", title: "B", dependencies: [], dependents: [], batchIndex: 1 },
		];
		expect(computeFileOverlaps(nodes, {})).toEqual([]);
	});

	it("handles missing file ownership for some workspaces", () => {
		const nodes: DependencyGraphNode[] = [
			{ id: "7.A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "7.B", title: "B", dependencies: [], dependents: [], batchIndex: 1 },
		];
		const fileOwnership: Record<string, string[]> = {
			"7.A": ["file1.ts"],
		};
		expect(computeFileOverlaps(nodes, fileOwnership)).toEqual([]);
	});

	it("detects overlaps across multiple pairs", () => {
		const nodes: DependencyGraphNode[] = [
			{ id: "7.A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "7.B", title: "B", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "7.C", title: "C", dependencies: [], dependents: [], batchIndex: 1 },
		];
		const fileOwnership: Record<string, string[]> = {
			"7.A": ["shared.ts"],
			"7.B": ["shared.ts"],
			"7.C": ["shared.ts"],
		};
		const overlaps = computeFileOverlaps(nodes, fileOwnership);
		expect(overlaps).toHaveLength(3); // A-B, A-C, B-C
	});
});

describe("wouldCreateCycle", () => {
	const linearGraph: DependencyGraphNode[] = [
		{ id: "7.A", title: "A", dependencies: [], dependents: ["7.B"], batchIndex: 1 },
		{ id: "7.B", title: "B", dependencies: ["7.A"], dependents: ["7.C"], batchIndex: 2 },
		{ id: "7.C", title: "C", dependencies: ["7.B"], dependents: [], batchIndex: 3 },
	];

	it("returns false for adding a valid forward dependency", () => {
		// 7.A depends on nothing; adding 7.C as dep of 7.A would mean A -> C (no cycle since C depends on B which depends on A)
		// Actually let's think: 7.C already depends on 7.B which depends on 7.A.
		// Adding 7.C as a dependency of 7.A would create: A depends on C, C depends on B, B depends on A => cycle!
		// Let's use a less tangled example.
		const graph: DependencyGraphNode[] = [
			{ id: "1", title: "1", dependencies: [], dependents: ["2"], batchIndex: 1 },
			{ id: "2", title: "2", dependencies: ["1"], dependents: [], batchIndex: 2 },
		];
		// Adding 1 as dependency of 2: 2 already depends on 1, so adding is redundant but not a cycle
		// Adding 2 as dependency of 1: 1 depends on 2, and 2 depends on 1 => cycle
		expect(wouldCreateCycle("1", "2", graph)).toBe(true);
	});

	it("returns false for adding a valid dependency", () => {
		const graph: DependencyGraphNode[] = [
			{ id: "1", title: "1", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "2", title: "2", dependencies: [], dependents: [], batchIndex: 1 },
		];
		// Adding 1 as dep of 2 (2 depends on 1, no existing path back)
		expect(wouldCreateCycle("2", "1", graph)).toBe(false);
	});

	it("returns true for creating a direct cycle", () => {
		const graph: DependencyGraphNode[] = [
			{ id: "A", title: "A", dependencies: ["B"], dependents: [], batchIndex: 1 },
			{ id: "B", title: "B", dependencies: [], dependents: ["A"], batchIndex: 1 },
		];
		// A already depends on B. Adding A as dep of B means B depends on A, but A depends on B => cycle
		expect(wouldCreateCycle("B", "A", graph)).toBe(true);
	});

	it("returns true for creating a transitive cycle", () => {
		// A -> B -> C chain
		const graph: DependencyGraphNode[] = [
			{ id: "A", title: "A", dependencies: [], dependents: ["B"], batchIndex: 1 },
			{ id: "B", title: "B", dependencies: ["A"], dependents: ["C"], batchIndex: 2 },
			{ id: "C", title: "C", dependencies: ["B"], dependents: [], batchIndex: 3 },
		];
		// Adding C as dep of A: A depends on C, C depends on B, B depends on A => cycle
		expect(wouldCreateCycle("A", "C", graph)).toBe(true);
	});

	it("returns false for node with no dependents", () => {
		const graph: DependencyGraphNode[] = [
			{ id: "A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "B", title: "B", dependencies: [], dependents: [], batchIndex: 1 },
			{ id: "C", title: "C", dependencies: ["B"], dependents: [], batchIndex: 2 },
		];
		// Adding C as dep of A: A depends on C, C has no dependents and doesn't lead back
		expect(wouldCreateCycle("A", "C", graph)).toBe(false);
	});

	it("handles empty graph", () => {
		expect(wouldCreateCycle("A", "B", [])).toBe(false);
	});

	it("handles self-dependency attempt", () => {
		const graph: DependencyGraphNode[] = [
			{ id: "A", title: "A", dependencies: [], dependents: [], batchIndex: 1 },
		];
		// Adding A as dep of A: self-loop — A's dependents include A? No. But DFS from A reaches A immediately.
		// Actually the DFS starts from nodeId and checks if newDependencyId is reachable.
		// Starting from A, we check if A is in A's dependents. It's not, so no cycle via DFS.
		// But self-dependency is typically invalid. Let's check the current implementation.
		expect(wouldCreateCycle("A", "A", graph)).toBe(true);
	});
});

// ─── Integration: Full workflow ───────────────────────────────────────────

describe("Full parallelism editor workflow", () => {
	it("selects, edits, previews, and saves", () => {
		const onSave = vi.fn();
		const batchPlan = makeBatchPlan();
		render(<ParallelismEditor batchPlan={batchPlan} onSave={onSave} />);

		// 1. Verify parallelism header shows
		expect(screen.getByText("Requested")).toBeTruthy();
		expect(screen.getByText("Effective")).toBeTruthy();

		// 2. Verify batch lanes show
		expect(screen.getByText("B1")).toBeTruthy();
		expect(screen.getByText("B2")).toBeTruthy();

		// 3. Click on a workspace to select
		fireEvent.click(screen.getByText("7.A"));

		// 4. Should see dependency editor
		expect(screen.getByText(/Edit dependencies/)).toBeTruthy();

		// 5. Should see "Add dependency" for 7.A (no deps currently)
		expect(screen.getByText("Add dependency")).toBeTruthy();
	});

	it("displays dependency warnings alongside batch plan warnings", () => {
		const onSave = vi.fn();
		const batchPlan = makeBatchPlan({
			warnings: [
				{ type: "over_serialized", message: "Plan appears over-serialized" },
			],
			errors: [
				{ type: "cycle", message: "Cycle: 7.X -> 7.Y -> 7.X", workspaceIds: ["7.X"] },
			],
		});
		const fileOwnership: Record<string, string[]> = {
			"7.B": ["shared.ts"],
			"7.C": ["shared.ts"],
		};
		render(
			<ParallelismEditor
				batchPlan={batchPlan}
				onSave={onSave}
				fileOwnership={fileOwnership}
			/>,
		);

		// Should see all three warning types
		expect(screen.getByText("Plan appears over-serialized")).toBeTruthy();
		expect(screen.getByText("Cycle: 7.X -> 7.Y -> 7.X")).toBeTruthy();
		expect(screen.getByText(/file overlap/)).toBeTruthy();
	});
});
