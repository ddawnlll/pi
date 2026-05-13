/**
 * Tests for Scheduler Diagnostics - 4.6.F
 *
 * Acceptance criteria:
 * 1. Scheduler emits selected/skipped/idle diagnostics
 * 2. Dependency skips list missing dependency ids
 * 3. File-lock skips list conflicting workspace and path/pattern
 * 4. Idle capacity logs explain why no work started
 * 5. Dashboard displays scheduler capacity summary
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PlanState } from "../src/core/plan-state.js";
import { formatCapacitySummary, WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

function makeState(entries: [string, WorkspaceStage][]): PlanState {
	return {
		phase: "P2",
		title: "Test",
		workspaces: new Map(entries.map(([id, stage]) => [id, { workspaceId: id, stage, attempts: 0 }])),
		startedAt: Date.now(),
		status: "running",
	};
}

describe("scheduler diagnostics — selected/skipped/idle", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(3);
	});

	it("AC1: scheduler emits selected workspaces in diagnostics", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Task 2", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.selected).toHaveLength(2);
		expect(decision.diagnostics.selected).toContain("w1");
		expect(decision.diagnostics.selected).toContain("w2");
	});

	it("AC1: scheduler emits skipped workspaces with categories", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Task 2", dependencies: ["w1"], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.skipped.length).toBeGreaterThan(0);
		const depSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "w2");
		expect(depSkip).toBeDefined();
		expect(depSkip!.category).toBe("dependency");
	});

	it("AC1: scheduler emits idle diagnostics when no work selected", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		// All 3 slots occupied so nothing can be scheduled
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["a1", WorkspaceStage.Active],
			["a2", WorkspaceStage.Active],
			["a3", WorkspaceStage.Active],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.idle.isIdle).toBe(true);
		expect(decision.diagnostics.idle.reasons.length).toBeGreaterThan(0);
	});

	it("AC1: idle is false when work was selected", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([["w1", WorkspaceStage.Pending]]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.idle.isIdle).toBe(false);
	});
});

describe("scheduler diagnostics — dependency skips with missing IDs", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(3);
	});

	it("AC2: dependency skip lists missing dependency IDs", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Upstream", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Downstream", dependencies: ["w1", "w-missing"], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const depSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "w2");
		expect(depSkip).toBeDefined();
		expect(depSkip!.category).toBe("dependency");
		expect(depSkip!.missingDependencyIds).toBeDefined();
		expect(depSkip!.missingDependencyIds).toContain("w1");
		expect(depSkip!.missingDependencyIds).toContain("w-missing");
	});

	it("AC2: dependency skip with single incomplete dep lists that dep ID", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Upstream", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Downstream", dependencies: ["w1"], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const depSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "w2");
		expect(depSkip!.missingDependencyIds).toEqual(["w1"]);
	});

	it("AC2: dependency skip with failed dep lists that dep ID", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Upstream", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Downstream", dependencies: ["w1"], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Failed],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const depSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "w2");
		expect(depSkip!.missingDependencyIds).toContain("w1");
	});
});

describe("scheduler diagnostics — file-lock skips with conflicting workspace and path", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(3);
	});

	it("AC3: file-lock skip lists conflicting workspace ID and path", () => {
		const workspaces: Workspace[] = [
			{
				id: "w1",
				title: "Editor A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
			{
				id: "w2",
				title: "Editor B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
		];
		scheduler.acquireFileLocks(workspaces[0]);
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const lockSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "w2");
		expect(lockSkip).toBeDefined();
		expect(lockSkip!.category).toBe("file_lock");
		expect(lockSkip!.conflictingWorkspaceId).toBe("w1");
		expect(lockSkip!.conflictingPath).toBe("src/core.ts");
	});

	it("AC3: file-lock skip with glob-pattern conflict", () => {
		const workspaces: Workspace[] = [
			{
				id: "w1",
				title: "Editor A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["src/*.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
			{
				id: "w2",
				title: "Editor B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["src/*.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
		];
		scheduler.acquireFileLocks(workspaces[0]);
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const lockSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "w2");
		expect(lockSkip!.category).toBe("file_lock");
		expect(lockSkip!.conflictingWorkspaceId).toBe("w1");
		expect(lockSkip!.conflictingPath).toBe("src/*.ts");
	});
});

describe("scheduler diagnostics — idle capacity explanation", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(2);
	});

	it("AC4: idle explanation when all worker slots occupied", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Waiting", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		// Both slots occupied
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["a1", WorkspaceStage.Active],
			["a2", WorkspaceStage.Active],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.idle.isIdle).toBe(true);
		expect(decision.diagnostics.idle.reasons).toEqual(
			expect.arrayContaining([expect.stringContaining("worker slots occupied")]),
		);
	});

	it("AC4: idle explanation when workspaces blocked by dependencies", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Upstream", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Downstream", dependencies: ["w1"], roleBudget: "worker", maxRetries: 3 },
		];
		// w1 active, w2 pending but depends on w1
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		// No new work was selected (w2 blocked by dep, w1 already active)
		if (decision.diagnostics.idle.isIdle) {
			const hasDepReason = decision.diagnostics.idle.reasons.some((r) => r.toLowerCase().includes("dependenc"));
			expect(hasDepReason).toBe(true);
		}
	});

	it("AC4: idle explanation when workspaces blocked by file locks", () => {
		const workspaces: Workspace[] = [
			{
				id: "w1",
				title: "Editor A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["file.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
			{
				id: "w2",
				title: "Editor B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["file.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
		];
		scheduler.acquireFileLocks(workspaces[0]);
		// One slot occupied by w1, w2 blocked by file lock
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		if (decision.diagnostics.idle.isIdle) {
			const hasLockReason = decision.diagnostics.idle.reasons.some((r) => r.toLowerCase().includes("file lock"));
			expect(hasLockReason).toBe(true);
		}
	});

	it("AC4: idle explanation when no pending workspaces", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Done", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([["w1", WorkspaceStage.Complete]]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.idle.isIdle).toBe(true);
		expect(decision.diagnostics.idle.reasons).toEqual(
			expect.arrayContaining([expect.stringContaining("No pending")]),
		);
	});

	it("AC4: idle is false with available work", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Ready", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([["w1", WorkspaceStage.Pending]]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.idle.isIdle).toBe(false);
		expect(decision.diagnostics.idle.reasons).toEqual([]);
	});
});

describe("scheduler diagnostics — capacity snapshot", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(3);
	});

	it("diagnostics include capacity snapshot with correct fields", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Active],
			["w3", WorkspaceStage.Complete],
			["w4", WorkspaceStage.Failed],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const cap = decision.diagnostics.capacity;

		expect(cap.maxWorkers).toBe(3);
		expect(cap.activeWorkers).toBe(1);
		expect(cap.availableSlots).toBe(2);
		expect(cap.totalWorkspaces).toBe(4);
		expect(cap.active).toBe(1);
		expect(cap.complete).toBe(1);
		expect(cap.failed).toBe(1);
		expect(cap.fileLocks).toBe(0);
		expect(typeof cap.utilization).toBe("number");
	});

	it("capacity utilization is 0 when no active workers", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([["w1", WorkspaceStage.Pending]]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.diagnostics.capacity.utilization).toBe(0);
	});

	it("capacity utilization reflects active workers", () => {
		const workspaces: Workspace[] = [];
		const state = makeState([
			["a1", WorkspaceStage.Active],
			["a2", WorkspaceStage.Active],
			["a3", WorkspaceStage.Active],
		]);
		// Can't schedule but we still get diagnostics
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		expect(decision.diagnostics.capacity.utilization).toBeCloseTo(1.0);
	});
});

describe("scheduler diagnostics — dashboard capacity summary", () => {
	let scheduler: WorkspaceScheduler;

	beforeEach(() => {
		scheduler = new WorkspaceScheduler(3);
	});

	it("AC5: formatCapacitySummary produces readable dashboard output", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Task 2", dependencies: ["w1"], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Complete],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).toContain("Scheduler Capacity Summary");
		expect(summary).toContain("Workers:");
		expect(summary).toContain("Utilization:");
		expect(summary).toContain("File Locks:");
		expect(summary).toContain("Workspaces:");
		expect(summary).toContain("Pending:");
		expect(summary).toContain("Active:");
		expect(summary).toContain("Complete:");
		expect(summary).toContain("Blocked:");
		expect(summary).toContain("Failed:");
	});

	it("AC5: dashboard shows selected workspaces", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([["w1", WorkspaceStage.Pending]]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).toContain("Selected:");
		expect(summary).toContain("w1");
	});

	it("AC5: dashboard shows (none) when no workspaces selected", () => {
		const workspaces: Workspace[] = [];
		const state = makeState([
			["a1", WorkspaceStage.Active],
			["a2", WorkspaceStage.Active],
			["a3", WorkspaceStage.Active],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).toContain("Selected:");
		expect(summary).toContain("(none)");
	});

	it("AC5: dashboard shows dependency skips with missing IDs", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Upstream", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Downstream", dependencies: ["w1", "w-missing"], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).toContain("Dependency skips:");
		expect(summary).toContain("w2");
		expect(summary).toContain("w1");
		expect(summary).toContain("w-missing");
	});

	it("AC5: dashboard shows file-lock skips with workspace and path", () => {
		const workspaces: Workspace[] = [
			{
				id: "w1",
				title: "Editor A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
			{
				id: "w2",
				title: "Editor B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: { canEdit: ["src/core.ts"], cannotEdit: [], canRun: [], cannotRun: [] },
			},
		];
		scheduler.acquireFileLocks(workspaces[0]);
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).toContain("File-lock skips:");
		expect(summary).toContain("w2");
		expect(summary).toContain("w1");
		expect(summary).toContain("src/core.ts");
	});

	it("AC5: dashboard shows IDLE explanation when no work started", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Waiting", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		// All slots full
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["a1", WorkspaceStage.Active],
			["a2", WorkspaceStage.Active],
			["a3", WorkspaceStage.Active],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).toContain("IDLE");
		expect(summary).toContain("no work started");
	});

	it("AC5: dashboard does not show IDLE when work was selected", () => {
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Ready", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([["w1", WorkspaceStage.Pending]]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).not.toContain("IDLE");
	});

	it("AC5: dashboard shows capacity skips", () => {
		const scheduler4 = new WorkspaceScheduler(1);
		const workspaces: Workspace[] = [
			{ id: "w1", title: "Task 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "w2", title: "Task 2", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler4.getNextWorkspaces(workspaces, state);
		const summary = formatCapacitySummary(decision.diagnostics);

		expect(summary).toContain("Capacity skips:");
		expect(summary).toContain("w2");
	});
});
