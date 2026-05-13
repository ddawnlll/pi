/**
 * Tests for DAG Scheduler + File Locks - P2 Workstream 7.D
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PlanState } from "../src/core/plan-state.js";
import { buildExecutionOrder, formatSchedulingDecision, WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import type { Workspace } from "../src/core/workspace-schema.js";
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
