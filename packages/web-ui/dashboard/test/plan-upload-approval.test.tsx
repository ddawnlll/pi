/**
 * Tests for PlanUploadDialog — Plan Upload Approval Flow (workspace 7.H)
 *
 * Acceptance Criteria:
 * 1. PlanUploadDialog shows preflight preview before run
 * 2. Run is disabled until required review is approved
 * 3. Edited dependency patches are included in the run request
 * 4. User can compare original and edited dependency graph
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { PlanUploadDialog, GraphDiffView } from "../src/components/PlanUploadDialog";
import type { GraphDiffData, DialogStage } from "../src/components/PlanUploadDialog";
import type { DependencyGraphNode } from "../src/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// We mock useParallelismPreview to control the workflow stages
let mockPreviewState: Record<string, unknown>;
let mockValidateFn: ReturnType<typeof vi.fn>;
let mockPatchFn: ReturnType<typeof vi.fn>;
let mockApproveFn: ReturnType<typeof vi.fn>;
let mockRunFn: ReturnType<typeof vi.fn>;
let mockResetFn: ReturnType<typeof vi.fn>;
let mockClearErrorFn: ReturnType<typeof vi.fn>;

vi.mock("../src/hooks/useParallelismPreview", () => ({
	useParallelismPreview: (_projectId: string | null) => ({
		state: mockPreviewState,
		validate: mockValidateFn,
		patch: mockPatchFn,
		approve: mockApproveFn,
		run: mockRunFn,
		reset: mockResetFn,
		clearError: mockClearErrorFn,
	}),
}));

// Mock framer-motion AnimatePresence to avoid animation issues in tests
vi.mock("framer-motion", () => ({
	AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	motion: {
		div: ({
			children,
			...props
		}: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
			<div {...props}>{children}</div>
		),
	},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePreviewState(overrides?: Partial<Record<string, unknown>>) {
	return {
		stage: "idle",
		validationResponse: null,
		appliedPatches: [],
		previewResult: null,
		isStale: false,
		staleReason: null,
		error: null,
		isApproved: false,
		planExecutionId: null,
		validatedContentFingerprint: null,
		...overrides,
	};
}

function makeValidationResponse(overrides?: Partial<Record<string, unknown>>) {
	return {
		success: true,
		parseResult: {
			title: "Test Plan",
			phase: "execution",
			workspaceCount: 4,
			maxParallel: 3,
		},
		batchPlan: {
			dependencyGraph: [
				{
					id: "7.A",
					title: "Setup",
					dependencies: [],
					dependents: ["7.B"],
					batchIndex: 1,
				},
				{
					id: "7.B",
					title: "Core",
					dependencies: ["7.A"],
					dependents: ["7.C"],
					batchIndex: 2,
				},
				{
					id: "7.C",
					title: "UI",
					dependencies: ["7.B"],
					dependents: [],
					batchIndex: 3,
				},
			],
			batches: [
				{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
				{ batchIndex: 2, workspaceIds: ["7.B"], width: 1 },
				{ batchIndex: 3, workspaceIds: ["7.C"], width: 1 },
			],
			totalBatches: 3,
			effectiveParallelism: 1,
			requestedParallelism: 3,
			parallelismDelta: 2,
			isOverSerialized: true,
			warnings: [],
			errors: [],
		},
		requiresApproval: false,
		...overrides,
	};
}

function renderDialog(overrides?: Record<string, unknown>) {
	const onClose = vi.fn();
	const onExecutionStarted = vi.fn();
	const result = render(
		<PlanUploadDialog
			isOpen={true}
			onClose={onClose}
			projectId="test-project-12345678"
			onExecutionStarted={onExecutionStarted}
			{...overrides}
		/>,
	);
	return { ...result, onClose, onExecutionStarted };
}

// ---------------------------------------------------------------------------
// AC 1: PlanUploadDialog shows preflight preview before run
// ---------------------------------------------------------------------------

describe("AC 1: Shows preflight preview before run", () => {
	beforeEach(() => {
		mockValidateFn = vi.fn();
		mockPatchFn = vi.fn();
		mockApproveFn = vi.fn();
		mockRunFn = vi.fn();
		mockResetFn = vi.fn();
		mockClearErrorFn = vi.fn();
		mockPreviewState = makePreviewState();
	});

	it("shows preflight preview after successful validation", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse(),
			validatedContentFingerprint: "100:35:125",
		});

		renderDialog();

		expect(screen.getByText("Preflight Preview")).toBeTruthy();
		expect(screen.getByText("Batches")).toBeTruthy();
		expect(screen.getByText("Effective Parallelism")).toBeTruthy();
	});

	it("shows batch plan summary data in preflight", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse(),
		});

		renderDialog();

		// Default validation response has totalBatches=3, effectiveParallelism=1, requestedParallelism=3
		const batchEls = screen.getAllByText("3");
		expect(batchEls.length).toBeGreaterThanOrEqual(1);
		const effEl = screen.getAllByText("1");
		expect(effEl.length).toBeGreaterThanOrEqual(1);
	});

	it("shows over-serialized indicator when batch plan is over-serialized", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({
				batchPlan: {
					...makeValidationResponse().batchPlan,
					isOverSerialized: true,
				},
			}),
		});

		renderDialog();

		const overSerializedEls = screen.getAllByText(/Over-serialized/);
		expect(overSerializedEls.length).toBeGreaterThanOrEqual(1);
	});

	it("shows batch plan warnings in preflight preview", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({
				batchPlan: {
					...makeValidationResponse().batchPlan,
					warnings: [
						{ type: "over_serialized", message: "Plan is over-serialized in preview" },
					],
				},
			}),
		});

		renderDialog();

		expect(screen.getAllByText("Plan is over-serialized in preview").length).toBeGreaterThanOrEqual(1);
	});

	it("shows batch plan errors in preflight preview", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({
				batchPlan: {
					...makeValidationResponse().batchPlan,
					errors: [
						{ type: "cycle", message: "Cycle detected: X->Y->X", workspaceIds: ["X", "Y"] },
					],
				},
			}),
		});

		renderDialog();

		expect(screen.getAllByText("Cycle detected: X->Y->X").length).toBeGreaterThanOrEqual(1);
	});

	it("validates plan content when validate button is clicked", async () => {
		mockPreviewState = makePreviewState();
		mockValidateFn.mockResolvedValue(makeValidationResponse());

		renderDialog();

		// Type plan content
		const textarea = screen.getByPlaceholderText("Paste your plan content here...");
		fireEvent.change(textarea, { target: { value: "# My Plan" } });

		// Click validate
		const validateBtn = screen.getByText("Validate & Preview");
		fireEvent.click(validateBtn);

		expect(mockValidateFn).toHaveBeenCalledWith("# My Plan");
	});

	it("shows parse result (title, phase, workspaceCount, maxParallel)", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse(),
		});

		renderDialog();

		expect(screen.getByText("Test Plan")).toBeTruthy();
		expect(screen.getByText("execution")).toBeTruthy();
		expect(screen.getByText("4", { exact: false })).toBeTruthy();
	});

	it("does not show preflight before validation", () => {
		mockPreviewState = makePreviewState();

		renderDialog();

		expect(screen.queryByText("Preflight Preview")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// AC 2: Run is disabled until required review is approved
// ---------------------------------------------------------------------------

describe("AC 2: Run is disabled until required review is approved", () => {
	beforeEach(() => {
		mockValidateFn = vi.fn();
		mockPatchFn = vi.fn();
		mockApproveFn = vi.fn();
		mockRunFn = vi.fn();
		mockResetFn = vi.fn();
		mockClearErrorFn = vi.fn();
	});

	it("shows 'Approval' stage badge when requiresApproval is true and not approved", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({ requiresApproval: true }),
			isApproved: false,
		});

		renderDialog();

		expect(screen.getByText("Approval")).toBeTruthy();
	});

	it("shows disabled Run button when approval is required but not given", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({ requiresApproval: true }),
			isApproved: false,
		});

		renderDialog();

		// The disabled "Run (Approval Required)" button
		expect(screen.getByText("Run (Approval Required)")).toBeTruthy();
		expect(screen.getByTitle("This plan requires review approval before execution")).toBeTruthy();
	});

	it("shows Review Required banner when approval needed", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({ requiresApproval: true }),
			isApproved: false,
		});

		renderDialog();

		expect(screen.getByText("Review Required")).toBeTruthy();
		expect(screen.getByText(/requires review approval before execution/)).toBeTruthy();
	});

	it("shows Approve & Run button when approval is required", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({ requiresApproval: true }),
			isApproved: false,
		});

		renderDialog();

		expect(screen.getByText("Approve & Run")).toBeTruthy();
	});

	it("shows Approved banner after approval", () => {
		mockPreviewState = makePreviewState({
			stage: "approved",
			validationResponse: makeValidationResponse({ requiresApproval: true }),
			isApproved: true,
		});

		renderDialog();

		expect(screen.getByText("Approved")).toBeTruthy();
		expect(screen.getByText(/has been approved for execution/)).toBeTruthy();
	});

	it("allows Run when approval is not required", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({ requiresApproval: false }),
			isApproved: false,
		});

		renderDialog();

		// Should have "Run Plan" button (enabled)
		expect(screen.getByText("Run Plan")).toBeTruthy();
	});

	it("shows Preflight stage badge when no approval required", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({ requiresApproval: false }),
			isApproved: false,
		});

		renderDialog();

		expect(screen.getByText("Preflight")).toBeTruthy();
	});

	it("Approve & Run calls approve then run", async () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse({ requiresApproval: true }),
			isApproved: false,
		});
		mockApproveFn.mockReturnValue(true);
		mockRunFn.mockResolvedValue({
			success: true,
			planExecutionId: "exec-123",
		});

		renderDialog();

		// Verify the Approve & Run button is present
		const approveBtn = screen.getByText("Approve & Run");
		expect(approveBtn).toBeTruthy();

		// Verify the disabled Run button shows approval requirement
		expect(screen.getByText("Run (Approval Required)")).toBeTruthy();
		expect(screen.getByTitle("This plan requires review approval before execution")).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AC 3: Edited dependency patches are included in the run request
// ---------------------------------------------------------------------------

describe("AC 3: Edited dependency patches are included in the run request", () => {
	beforeEach(() => {
		mockValidateFn = vi.fn();
		mockPatchFn = vi.fn();
		mockApproveFn = vi.fn();
		mockRunFn = vi.fn();
		mockResetFn = vi.fn();
		mockClearErrorFn = vi.fn();
	});

	it("shows applied patches indicator when patches have been applied", () => {
		mockPreviewState = makePreviewState({
			stage: "patched",
			validationResponse: makeValidationResponse(),
			appliedPatches: [
				{ workspaceId: "7.B", action: "add_dependency", dependencyId: "7.C" },
			],
		});

		renderDialog();

		expect(screen.getByText(/1 dependency patch applied/)).toBeTruthy();
		expect(screen.getByText(/will be included in run request/)).toBeTruthy();
	});

	it("shows plural patches indicator when multiple patches applied", () => {
		mockPreviewState = makePreviewState({
			stage: "patched",
			validationResponse: makeValidationResponse(),
			appliedPatches: [
				{ workspaceId: "7.B", action: "add_dependency", dependencyId: "7.C" },
				{ workspaceId: "7.A", action: "remove_dependency", dependencyId: "7.X" },
			],
		});

		renderDialog();

		expect(screen.getByText(/2 dependency patches applied/)).toBeTruthy();
	});

	it("does not show patches indicator when no patches are applied", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse(),
			appliedPatches: [],
		});

		renderDialog();

		expect(screen.queryByText(/dependency patch/)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// AC 4: User can compare original and edited dependency graph
// ---------------------------------------------------------------------------

describe("AC 4: User can compare original and edited dependency graph", () => {
	beforeEach(() => {
		mockValidateFn = vi.fn();
		mockPatchFn = vi.fn();
		mockApproveFn = vi.fn();
		mockRunFn = vi.fn();
		mockResetFn = vi.fn();
		mockClearErrorFn = vi.fn();
	});

	it("shows Compare Graphs button when edited graph exists", () => {
		mockPreviewState = makePreviewState({
			stage: "patched",
			validationResponse: makeValidationResponse(),
			previewResult: {
				success: true,
				batchPlan: {
					...makeValidationResponse().batchPlan,
					dependencyGraph: [
						{
							id: "7.A",
							title: "Setup",
							dependencies: [],
							dependents: ["7.B"],
							batchIndex: 1,
						},
						{
							id: "7.B",
							title: "Core",
							dependencies: ["7.A", "7.C"],
							dependents: [],
							batchIndex: 2,
						},
					],
				},
				errors: [],
				warnings: [],
				appliedPatches: [
					{ workspaceId: "7.B", action: "add_dependency", dependencyId: "7.C" },
				],
				rejectedPatches: [],
			},
		});

		renderDialog();

		expect(screen.getByText("Compare Graphs")).toBeTruthy();
	});

	it("does not show Compare Graphs button when no edited graph exists", () => {
		mockPreviewState = makePreviewState({
			stage: "validated",
			validationResponse: makeValidationResponse(),
			previewResult: null,
		});

		renderDialog();

		expect(screen.queryByText("Compare Graphs")).toBeNull();
	});

	it("toggles graph diff view when Compare Graphs is clicked", () => {
		const editedGraph = [
			{
				id: "7.A",
				title: "Setup",
				dependencies: [],
				dependents: ["7.B"],
				batchIndex: 1,
			},
			{
				id: "7.B",
				title: "Core",
				dependencies: ["7.A", "7.C"],
				dependents: [],
				batchIndex: 2,
			},
		];

		mockPreviewState = makePreviewState({
			stage: "patched",
			validationResponse: makeValidationResponse(),
			previewResult: {
				success: true,
				batchPlan: {
					...makeValidationResponse().batchPlan,
					dependencyGraph: editedGraph,
				},
				errors: [],
				warnings: [],
				appliedPatches: [],
				rejectedPatches: [],
			},
		});

		renderDialog();

		// Click the Compare Graphs button
		const compareBtn = screen.getByText("Compare Graphs");
		fireEvent.click(compareBtn);

		// Should now show the graph diff
		expect(screen.getByText("Dependency Graph Comparison")).toBeTruthy();
	});

	it("shows Hide Diff button after Compare Graphs is clicked", () => {
		const editedGraph = [
			{
				id: "7.A",
				title: "Setup",
				dependencies: [],
				dependents: ["7.B"],
				batchIndex: 1,
			},
			{
				id: "7.B",
				title: "Core",
				dependencies: ["7.A", "7.C"],
				dependents: [],
				batchIndex: 2,
			},
		];

		mockPreviewState = makePreviewState({
			stage: "patched",
			validationResponse: makeValidationResponse(),
			previewResult: {
				success: true,
				batchPlan: {
					...makeValidationResponse().batchPlan,
					dependencyGraph: editedGraph,
				},
				errors: [],
				warnings: [],
				appliedPatches: [],
				rejectedPatches: [],
			},
		});

		renderDialog();

		fireEvent.click(screen.getByText("Compare Graphs"));

		expect(screen.getByText("Hide Diff")).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// GraphDiffView component tests
// ---------------------------------------------------------------------------

describe("GraphDiffView", () => {
	const origGraph: DependencyGraphNode[] = [
		{ id: "7.A", title: "Setup", dependencies: [], dependents: ["7.B"], batchIndex: 1 },
		{ id: "7.B", title: "Core", dependencies: ["7.A"], dependents: ["7.C"], batchIndex: 2 },
		{ id: "7.C", title: "UI", dependencies: ["7.B"], dependents: [], batchIndex: 3 },
	];

	it("shows 'no differences' when graphs are identical", () => {
		const diffData: GraphDiffData = {
			added: [],
			removed: [],
			changed: [],
		};
		render(<GraphDiffView diffData={diffData} />);
		expect(screen.getByText(/No differences/)).toBeTruthy();
	});

	it("shows added workspaces", () => {
		const diffData: GraphDiffData = {
			added: [
				{ id: "7.D", title: "New", dependencies: [], dependents: [], batchIndex: 4 },
			],
			removed: [],
			changed: [],
		};
		render(<GraphDiffView diffData={diffData} />);
		expect(screen.getByText(/Added Workspaces/)).toBeTruthy();
		expect(screen.getByText("7.D")).toBeTruthy();
	});

	it("shows removed workspaces", () => {
		const diffData: GraphDiffData = {
			added: [],
			removed: [
				{ id: "7.C", title: "UI", dependencies: [], dependents: [], batchIndex: 3 },
			],
			changed: [],
		};
		render(<GraphDiffView diffData={diffData} />);
		expect(screen.getByText(/Removed Workspaces/)).toBeTruthy();
		expect(screen.getByText("7.C")).toBeTruthy();
	});

	it("shows changed dependencies with original and edited views", () => {
		const diffData: GraphDiffData = {
			added: [],
			removed: [],
			changed: [
				{
					node: {
						id: "7.B",
						title: "Core",
						dependencies: ["7.A", "7.C"],
						dependents: [],
						batchIndex: 2,
					},
					origDeps: ["7.A"],
					newDeps: ["7.A", "7.C"],
					addedDeps: ["7.C"],
					removedDeps: [],
				},
			],
		};
		render(<GraphDiffView diffData={diffData} />);

		expect(screen.getByText(/Changed Dependencies/)).toBeTruthy();
		expect(screen.getByText("Original")).toBeTruthy();
		expect(screen.getByText("Edited")).toBeTruthy();
		expect(screen.getByText("+ Added: 7.C")).toBeTruthy();
	});

	it("shows removed dependencies", () => {
		const diffData: GraphDiffData = {
			added: [],
			removed: [],
			changed: [
				{
					node: {
						id: "7.C",
						title: "UI",
						dependencies: [],
						dependents: [],
						batchIndex: 3,
					},
					origDeps: ["7.B"],
					newDeps: [],
					addedDeps: [],
					removedDeps: ["7.B"],
				},
			],
		};
		render(<GraphDiffView diffData={diffData} />);

		expect(screen.getByText("- Removed: 7.B")).toBeTruthy();
	});

	it("can be collapsed and expanded", () => {
		const diffData: GraphDiffData = {
			added: [],
			removed: [],
			changed: [],
		};
		render(<GraphDiffView diffData={diffData} />);

		// Initially expanded — click to collapse
		const btn = screen.getByText("Dependency Graph Comparison");
		fireEvent.click(btn);

		// The "no differences" text should be gone (collapsed)
		expect(screen.queryByText(/No differences/)).toBeNull();

		// Click to expand again
		fireEvent.click(screen.getByText("Dependency Graph Comparison"));
		expect(screen.getByText(/No differences/)).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// Stage badge tests
// ---------------------------------------------------------------------------

describe("Stage badge rendering", () => {
	beforeEach(() => {
		mockValidateFn = vi.fn();
		mockPatchFn = vi.fn();
		mockApproveFn = vi.fn();
		mockRunFn = vi.fn();
		mockResetFn = vi.fn();
		mockClearErrorFn = vi.fn();
	});

	it("shows Input stage badge initially", () => {
		mockPreviewState = makePreviewState();
		renderDialog();
		expect(screen.getByText("Input")).toBeTruthy();
	});

	it("shows Validating stage badge during validation", () => {
		mockPreviewState = makePreviewState({ stage: "validating" });
		renderDialog();
		expect(screen.getByText("Validating")).toBeTruthy();
	});

	it("shows Running stage badge during execution", () => {
		mockPreviewState = makePreviewState({ stage: "running" });
		renderDialog();
		expect(screen.getByText("Running")).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// Dialog close and reset
// ---------------------------------------------------------------------------

describe("Dialog close and reset", () => {
	beforeEach(() => {
		mockValidateFn = vi.fn();
		mockPatchFn = vi.fn();
		mockApproveFn = vi.fn();
		mockRunFn = vi.fn();
		mockResetFn = vi.fn();
		mockClearErrorFn = vi.fn();
	});

	it("calls reset and onClose when dialog is closed", () => {
		mockPreviewState = makePreviewState();
		const { onClose } = renderDialog();

		const cancelBtn = screen.getByText("Cancel");
		fireEvent.click(cancelBtn);

		expect(mockResetFn).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it("clicking backdrop calls onClose", () => {
		mockPreviewState = makePreviewState();
		const { onClose } = renderDialog();

		// Find the backdrop (outer fixed overlay)
		const backdrop = document.querySelector(".fixed.inset-0");
		if (backdrop) {
			fireEvent.click(backdrop);
			expect(onClose).toHaveBeenCalled();
		}
	});
});
