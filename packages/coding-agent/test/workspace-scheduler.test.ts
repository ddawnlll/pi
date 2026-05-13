/**
 * Tests for DAG Scheduler + File Locks - P2 Workstream 7.D
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PlanState } from "../src/core/plan-state.js";
import { buildExecutionOrder, formatSchedulingDecision, WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import type { TopologicalBatch, Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

describe("WorkspaceScheduler", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(3);
	});

	it("should schedule workspaces with no dependencies", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const state: PlanState = {
			phase: "P2",
			title: "Test",
			workspaces: new Map([
				["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Pending, attempts: 0 }],
				["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
			startedAt: Date.now(),
			status: "running",
		};

		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.ready).toHaveLength(2);
		expect(decision.blocked).toHaveLength(0);
	});

	it("should respect worker limit", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.C",
				title: "Task C",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.D",
				title: "Task D",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const state: PlanState = {
			phase: "P2",
			title: "Test",
			workspaces: new Map([
				["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Pending, attempts: 0 }],
				["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
				["7.C", { workspaceId: "7.C", stage: WorkspaceStage.Pending, attempts: 0 }],
				["7.D", { workspaceId: "7.D", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
			startedAt: Date.now(),
			status: "running",
		};

		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.ready).toHaveLength(3); // Max 3 workers
		expect(decision.blocked).toHaveLength(1);
	});

	it("should block workspaces with incomplete dependencies", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const state: PlanState = {
			phase: "P2",
			title: "Test",
			workspaces: new Map([
				["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Active, attempts: 0 }],
				["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
			startedAt: Date.now(),
			status: "running",
		};

		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.ready).toHaveLength(0);
		expect(decision.blocked).toHaveLength(1);
		expect(decision.blockReasons.get("7.B")).toContain("not complete");
	});

	it("should schedule workspaces when dependencies are complete", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const state: PlanState = {
			phase: "P2",
			title: "Test",
			workspaces: new Map([
				["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Complete, attempts: 0 }],
				["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
			startedAt: Date.now(),
			status: "running",
		};

		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.ready).toHaveLength(1);
		expect(decision.ready[0].id).toBe("7.B");
	});

	it("should detect file lock conflicts", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["file1.ts"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["file1.ts"], // Same file!
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			},
		];

		// Acquire lock for 7.A
		scheduler.acquireFileLocks(workspaces[0]);

		const state: PlanState = {
			phase: "P2",
			title: "Test",
			workspaces: new Map([
				["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Active, attempts: 0 }],
				["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
			startedAt: Date.now(),
			status: "running",
		};

		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.ready).toHaveLength(0);
		expect(decision.blocked).toHaveLength(1);
		expect(decision.blockReasons.get("7.B")).toContain("File lock conflict");
	});

	it("should allow parallel execution of non-conflicting files", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["file1.ts"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["file2.ts"], // Different file
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			},
		];

		// Acquire lock for 7.A
		scheduler.acquireFileLocks(workspaces[0]);

		const state: PlanState = {
			phase: "P2",
			title: "Test",
			workspaces: new Map([
				["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Active, attempts: 0 }],
				["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
			startedAt: Date.now(),
			status: "running",
		};

		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.ready).toHaveLength(1);
		expect(decision.ready[0].id).toBe("7.B");
	});

	it("should acquire and release file locks", () => {
		const workspace: Workspace = {
			id: "7.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker",
			maxRetries: 3,
			capabilities: {
				canEdit: ["file1.ts", "file2.ts"],
				cannotEdit: [],
				canRun: [],
				cannotRun: [],
			},
		};

		const locked = scheduler.acquireFileLocks(workspace);
		expect(locked).toEqual(["file1.ts", "file2.ts"]);
		expect(scheduler.isFileLocked("file1.ts")).toBe("7.A");
		expect(scheduler.isFileLocked("file2.ts")).toBe("7.A");

		scheduler.releaseFileLocks(workspace);
		expect(scheduler.isFileLocked("file1.ts")).toBeNull();
		expect(scheduler.isFileLocked("file2.ts")).toBeNull();
	});

	it("should throw error when acquiring already locked file", () => {
		const workspace1: Workspace = {
			id: "7.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker",
			maxRetries: 3,
			capabilities: {
				canEdit: ["file1.ts"],
				cannotEdit: [],
				canRun: [],
				cannotRun: [],
			},
		};

		const workspace2: Workspace = {
			id: "7.B",
			title: "Task B",
			dependencies: [],
			roleBudget: "worker",
			maxRetries: 3,
			capabilities: {
				canEdit: ["file1.ts"],
				cannotEdit: [],
				canRun: [],
				cannotRun: [],
			},
		};

		scheduler.acquireFileLocks(workspace1);
		expect(() => scheduler.acquireFileLocks(workspace2)).toThrow("already locked");
	});

	it("should validate scheduling for cycles", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: ["7.B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const result = scheduler.validateScheduling(workspaces);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("cycle"))).toBe(true);
	});

	it("should get scheduling statistics", () => {
		const state: PlanState = {
			phase: "P2",
			title: "Test",
			workspaces: new Map([
				["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Complete, attempts: 0 }],
				["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Active, attempts: 0 }],
				["7.C", { workspaceId: "7.C", stage: WorkspaceStage.Pending, attempts: 0 }],
				["7.D", { workspaceId: "7.D", stage: WorkspaceStage.Failed, attempts: 3 }],
			]),
			startedAt: Date.now(),
			status: "running",
		};

		const stats = scheduler.getStatistics(state);
		expect(stats.total).toBe(4);
		expect(stats.complete).toBe(1);
		expect(stats.active).toBe(1);
		expect(stats.pending).toBe(1);
		expect(stats.failed).toBe(1);
		expect(stats.activeSlots).toBe(1);
		expect(stats.availableSlots).toBe(2);
	});

	it("should reset scheduler state", () => {
		const workspace: Workspace = {
			id: "7.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker",
			maxRetries: 3,
			capabilities: {
				canEdit: ["file1.ts"],
				cannotEdit: [],
				canRun: [],
				cannotRun: [],
			},
		};

		scheduler.acquireFileLocks(workspace);
		expect(scheduler.isFileLocked("file1.ts")).toBe("7.A");

		scheduler.reset();
		expect(scheduler.isFileLocked("file1.ts")).toBeNull();
	});
});

describe("buildExecutionOrder", () => {
	it("should build topological order", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.C",
				title: "Task C",
				dependencies: ["7.A", "7.B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const order = buildExecutionOrder(workspaces);
		expect(order).not.toBeNull();
		expect(order).toHaveLength(3);

		// A must come before B and C
		const aIndex = order!.findIndex((w) => w.id === "7.A");
		const bIndex = order!.findIndex((w) => w.id === "7.B");
		const cIndex = order!.findIndex((w) => w.id === "7.C");

		expect(aIndex).toBeLessThan(bIndex);
		expect(aIndex).toBeLessThan(cIndex);
		expect(bIndex).toBeLessThan(cIndex);
	});

	it("should return null for cyclic dependencies", () => {
		const workspaces: Workspace[] = [
			{
				id: "7.A",
				title: "Task A",
				dependencies: ["7.B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: ["7.A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const order = buildExecutionOrder(workspaces);
		expect(order).toBeNull();
	});
});

describe("formatSchedulingDecision", () => {
	it("should format scheduling decision", () => {
		const decision = {
			ready: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker" as const,
					maxRetries: 3,
				},
			],
			blocked: [
				{
					id: "7.B",
					title: "Task B",
					dependencies: ["7.A"],
					roleBudget: "worker" as const,
					maxRetries: 3,
				},
			],
			blockReasons: new Map([["7.B", "Dependencies not complete"]]),
			readyBatchIds: new Map(),
			diagnostics: {
				selected: ["7.A"],
				skipped: [
					{
						workspaceId: "7.B",
						category: "dependency" as const,
						reason: "Dependencies not complete",
						missingDependencyIds: ["7.A"],
					},
				],
				idle: { isIdle: false, reasons: [] },
				batchIds: new Map(),
				capacity: {
					maxWorkers: 3,
					activeWorkers: 0,
					availableSlots: 3,
					totalWorkspaces: 2,
					pending: 1,
					active: 0,
					complete: 0,
					blocked: 1,
					failed: 0,
					fileLocks: 0,
					utilization: 0,
				},
			},
		};

		const formatted = formatSchedulingDecision(decision);
		expect(formatted).toContain("Ready to schedule: 1");
		expect(formatted).toContain("7.A");
		expect(formatted).toContain("Blocked: 1");
		expect(formatted).toContain("7.B");
		expect(formatted).toContain("Dependencies not complete");
	});
});

// ---------------------------------------------------------------------------
// Workspace 7.I: Scheduler Enforcement of Approved Plan
// ---------------------------------------------------------------------------

describe("Workspace 7.I: Scheduler Enforcement of Approved Plan", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(3);
	});

	// AC1: Executor uses approved dependency graph, not stale parser output
	describe("AC1: approved dependency graph", () => {
		it("should use batch assignments from approved dependency graph", () => {
			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.B", title: "Task B", dependencies: ["7.A"], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.C", title: "Task C", dependencies: ["7.A"], roleBudget: "worker", maxRetries: 3 },
			];

			// Set approved batch assignments from plan preview
			const batchAssignment = new Map([
				["7.A", 1],
				["7.B", 2],
				["7.C", 2],
			]);
			const batches: TopologicalBatch[] = [
				{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
				{ batchIndex: 2, workspaceIds: ["7.B", "7.C"], width: 2 },
			];
			scheduler.setBatchAssignment(batchAssignment, batches);

			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([
					["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Pending, attempts: 0 }],
					["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
					["7.C", { workspaceId: "7.C", stage: WorkspaceStage.Pending, attempts: 0 }],
				]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = scheduler.getNextWorkspaces(workspaces, state);
			// Only 7.A should be scheduled (batch 1) since 7.B and 7.C depend on 7.A
			expect(decision.ready).toHaveLength(1);
			expect(decision.ready[0].id).toBe("7.A");
			// Batch ID should be available for logging
			expect(decision.readyBatchIds.get("7.A")).toBe(1);
		});

		it("should return correct batch IDs after dependencies complete", () => {
			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.B", title: "Task B", dependencies: ["7.A"], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.C", title: "Task C", dependencies: ["7.A"], roleBudget: "worker", maxRetries: 3 },
			];

			const batchAssignment = new Map([
				["7.A", 1],
				["7.B", 2],
				["7.C", 2],
			]);
			const batches: TopologicalBatch[] = [
				{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
				{ batchIndex: 2, workspaceIds: ["7.B", "7.C"], width: 2 },
			];
			scheduler.setBatchAssignment(batchAssignment, batches);

			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([
					["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Complete, attempts: 0 }],
					["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
					["7.C", { workspaceId: "7.C", stage: WorkspaceStage.Pending, attempts: 0 }],
				]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = scheduler.getNextWorkspaces(workspaces, state);
			// Both 7.B and 7.C should now be scheduled (batch 2)
			expect(decision.ready).toHaveLength(2);
			expect(decision.readyBatchIds.get("7.B")).toBe(2);
			expect(decision.readyBatchIds.get("7.C")).toBe(2);
		});
	});

	// AC2: Execution persists approved preview metadata
	describe("AC2: approved preview metadata", () => {
		it("should store and retrieve batch assignments", () => {
			const batchAssignment = new Map([
				["7.A", 1],
				["7.B", 2],
			]);
			const batches: TopologicalBatch[] = [
				{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
				{ batchIndex: 2, workspaceIds: ["7.B"], width: 1 },
			];
			scheduler.setBatchAssignment(batchAssignment, batches);

			expect(scheduler.getBatchId("7.A")).toBe(1);
			expect(scheduler.getBatchId("7.B")).toBe(2);
			expect(scheduler.getBatchId("7.C")).toBe(0); // Not assigned
		});

		it("should expose batch assignments for persistence", () => {
			const batchAssignment = new Map([
				["7.A", 1],
				["7.B", 2],
			]);
			const batches: TopologicalBatch[] = [
				{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
				{ batchIndex: 2, workspaceIds: ["7.B"], width: 1 },
			];
			scheduler.setBatchAssignment(batchAssignment, batches);

			// getBatchAssignments returns a copy for persistence
			const assignments = scheduler.getBatchAssignments();
			expect(assignments.get("7.A")).toBe(1);
			expect(assignments.get("7.B")).toBe(2);
		});

		it("should expose batches for persistence", () => {
			const batches: TopologicalBatch[] = [
				{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
				{ batchIndex: 2, workspaceIds: ["7.B", "7.C"], width: 2 },
			];
			scheduler.setBatchAssignment(
				new Map([
					["7.A", 1],
					["7.B", 2],
					["7.C", 2],
				]),
				batches,
			);

			const result = scheduler.getBatches();
			expect(result).toHaveLength(2);
			expect(result[0].batchIndex).toBe(1);
			expect(result[1].workspaceIds).toEqual(["7.B", "7.C"]);
		});

		it("should clear batch assignments on reset", () => {
			scheduler.setBatchAssignment(new Map([["7.A", 1]]), [{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 }]);
			expect(scheduler.getBatchId("7.A")).toBe(1);

			scheduler.reset();
			expect(scheduler.getBatchId("7.A")).toBe(0);
			expect(scheduler.getBatchAssignments().size).toBe(0);
			expect(scheduler.getBatches()).toHaveLength(0);
		});
	});

	// AC3: Scheduler never exceeds maxParallelWorkspaces
	describe("AC3: never exceeds maxParallelWorkspaces", () => {
		it("should never schedule more than maxWorkers workspaces", () => {
			const maxWorkers = 2;
			const localScheduler = new WorkspaceScheduler(maxWorkers);

			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.B", title: "Task B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.C", title: "Task C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.D", title: "Task D", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.E", title: "Task E", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			];

			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map(
					workspaces.map((w) => [w.id, { workspaceId: w.id, stage: WorkspaceStage.Pending, attempts: 0 }]),
				),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = localScheduler.getNextWorkspaces(workspaces, state);
			expect(decision.ready.length).toBeLessThanOrEqual(maxWorkers);
			expect(decision.ready).toHaveLength(2); // maxWorkers = 2
		});

		it("should account for active workspaces when scheduling", () => {
			const maxWorkers = 3;
			const localScheduler = new WorkspaceScheduler(maxWorkers);

			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.B", title: "Task B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.C", title: "Task C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.D", title: "Task D", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			];

			// 2 workspaces already active
			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([
					["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Active, attempts: 0 }],
					["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Active, attempts: 0 }],
					["7.C", { workspaceId: "7.C", stage: WorkspaceStage.Pending, attempts: 0 }],
					["7.D", { workspaceId: "7.D", stage: WorkspaceStage.Pending, attempts: 0 }],
				]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = localScheduler.getNextWorkspaces(workspaces, state);
			// Only 1 more slot available (3 max - 2 active)
			expect(decision.ready).toHaveLength(1);
			expect(decision.ready.length + 2).toBeLessThanOrEqual(maxWorkers);
		});

		it("should refuse scheduling when all slots are occupied", () => {
			const maxWorkers = 2;
			const localScheduler = new WorkspaceScheduler(maxWorkers);

			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.B", title: "Task B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.C", title: "Task C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			];

			// All 2 slots already active
			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([
					["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Active, attempts: 0 }],
					["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Active, attempts: 0 }],
					["7.C", { workspaceId: "7.C", stage: WorkspaceStage.Pending, attempts: 0 }],
				]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = localScheduler.getNextWorkspaces(workspaces, state);
			expect(decision.ready).toHaveLength(0);
			// Total active + ready must not exceed maxWorkers
			expect(2 + decision.ready.length).toBeLessThanOrEqual(maxWorkers);
		});

		it("should report maxWorkers via getMaxWorkers", () => {
			const localScheduler = new WorkspaceScheduler(5);
			expect(localScheduler.getMaxWorkers()).toBe(5);
		});

		it("should clamp maxWorkers to valid range", () => {
			// Values below 1 are clamped to MIN_STABLE_WORKERS (1)
			const schedulerBelow = new WorkspaceScheduler(0);
			expect(schedulerBelow.getMaxWorkers()).toBeGreaterThanOrEqual(1);

			// Values above 6 are clamped to MAX_EXPERIMENTAL_WORKERS (6)
			const schedulerAbove = new WorkspaceScheduler(100);
			expect(schedulerAbove.getMaxWorkers()).toBeLessThanOrEqual(6);
		});
	});

	// AC4: Scheduler logs planned batch id for each workspace
	describe("AC4: logs planned batch id", () => {
		it("should include batch IDs in ready workspaces when batch assignments are set", () => {
			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.B", title: "Task B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			];

			scheduler.setBatchAssignment(
				new Map([
					["7.A", 1],
					["7.B", 1],
				]),
				[{ batchIndex: 1, workspaceIds: ["7.A", "7.B"], width: 2 }],
			);

			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([
					["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Pending, attempts: 0 }],
					["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
				]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = scheduler.getNextWorkspaces(workspaces, state);
			// readyBatchIds should map each ready workspace to its batch index
			expect(decision.readyBatchIds.get("7.A")).toBe(1);
			expect(decision.readyBatchIds.get("7.B")).toBe(1);
		});

		it("should include batch IDs in skipped workspaces diagnostics", () => {
			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "7.B", title: "Task B", dependencies: ["7.A"], roleBudget: "worker", maxRetries: 3 },
			];

			scheduler.setBatchAssignment(
				new Map([
					["7.A", 1],
					["7.B", 2],
				]),
				[
					{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 },
					{ batchIndex: 2, workspaceIds: ["7.B"], width: 1 },
				],
			);

			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([
					["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Active, attempts: 0 }],
					["7.B", { workspaceId: "7.B", stage: WorkspaceStage.Pending, attempts: 0 }],
				]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = scheduler.getNextWorkspaces(workspaces, state);
			// 7.B is blocked (dependency 7.A is active), but should still have batch ID
			const bSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "7.B");
			expect(bSkip).toBeDefined();
			expect(bSkip!.batchId).toBe(2);
		});

		it("should include batch IDs in diagnostics batchIds map", () => {
			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			];

			scheduler.setBatchAssignment(new Map([["7.A", 1]]), [{ batchIndex: 1, workspaceIds: ["7.A"], width: 1 }]);

			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Pending, attempts: 0 }]]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = scheduler.getNextWorkspaces(workspaces, state);
			expect(decision.diagnostics.batchIds.get("7.A")).toBe(1);
		});

		it("should include batch ID in formatted scheduling decision output", () => {
			const decision = {
				ready: [{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 }],
				blocked: [] as Workspace[],
				blockReasons: new Map<string, string>(),
				readyBatchIds: new Map([["7.A", 1]]),
				diagnostics: {
					selected: ["7.A"],
					skipped: [],
					idle: { isIdle: false, reasons: [] },
					batchIds: new Map([["7.A", 1]]),
					capacity: {
						maxWorkers: 3,
						activeWorkers: 0,
						availableSlots: 3,
						totalWorkspaces: 1,
						pending: 1,
						active: 0,
						complete: 0,
						blocked: 0,
						failed: 0,
						fileLocks: 0,
						utilization: 0,
					},
				},
			};

			const formatted = formatSchedulingDecision(decision as any);
			expect(formatted).toContain("[batch 1]");
		});

		it("should not include batch info when no batch assignments are set", () => {
			const workspaces: Workspace[] = [
				{ id: "7.A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			];

			// No setBatchAssignment called - no batch info

			const state: PlanState = {
				phase: "P2",
				title: "Test",
				workspaces: new Map([["7.A", { workspaceId: "7.A", stage: WorkspaceStage.Pending, attempts: 0 }]]),
				startedAt: Date.now(),
				status: "running",
			};

			const decision = scheduler.getNextWorkspaces(workspaces, state);
			expect(decision.readyBatchIds.size).toBe(0);
			expect(decision.diagnostics.batchIds.size).toBe(0);
		});
	});
});
