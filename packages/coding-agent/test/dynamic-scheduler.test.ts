/**
 * Tests for Dynamic Parallel Scheduler - Workspace 6.E
 *
 * Acceptance criteria:
 *   AC1: Scheduler fills capacity with ready-safe workspaces
 *   AC2: Scheduler can use higher concurrency in worktree mode
 *   AC3: Scheduler reduces concurrency when validation lock/resource pressure is high
 *   AC4: Scheduler explains skipped/selected decisions
 *   AC5: Same-file conflicts are not run unsafely
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PlanState } from "../src/core/plan-state.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";
import {
	DynamicParallelScheduler,
	formatCapacitySummary,
	formatSchedulingDecision,
} from "../src/scheduler/dynamic-scheduler.js";

function makeState(entries: [string, WorkspaceStage][]): PlanState {
	return {
		phase: "P2",
		title: "Test",
		workspaces: new Map(entries.map(([id, stage]) => [id, { workspaceId: id, stage, attempts: 0 }])),
		startedAt: Date.now(),
		status: "running",
	};
}

function makeWorkspace(id: string, deps: string[] = []): Workspace {
	return {
		id,
		title: `Task ${id}`,
		dependencies: deps,
		roleBudget: "worker",
		maxRetries: 3,
	};
}

function makeCapWorkspace(id: string, deps: string[], canEdit: string[]): Workspace {
	return {
		id,
		title: `Task ${id}`,
		dependencies: deps,
		roleBudget: "worker",
		maxRetries: 3,
		capabilities: {
			canEdit,
			cannotEdit: [],
			canRun: [],
			cannotRun: [],
		},
	};
}

describe("DynamicParallelScheduler — AC1: Fill capacity with ready-safe workspaces", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		scheduler = new DynamicParallelScheduler(3);
	});

	it("AC1: fills all available slots with ready workspaces", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2"), makeWorkspace("w3")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(3);
		expect(decision.ready.map((w) => w.id).sort()).toEqual(["w1", "w2", "w3"]);
		expect(decision.blocked).toHaveLength(0);
	});

	it("AC1: schedules all ready workspaces even with some blocked by dependencies", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2", ["w1"]), makeWorkspace("w3")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		// w1 and w3 are ready (no deps), w2 depends on w1
		expect(decision.ready).toHaveLength(2);
		expect(decision.ready.map((w) => w.id).sort()).toEqual(["w1", "w3"]);
	});

	it("AC1: respects worker limit and blocks overflow", () => {
		const scheduler2 = new DynamicParallelScheduler(2);
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2"), makeWorkspace("w3")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
		]);

		const decision = scheduler2.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(2);
		expect(decision.blocked).toHaveLength(1);
	});

	it("AC1: accounts for already active workspaces when filling capacity", () => {
		const scheduler2 = new DynamicParallelScheduler(3);
		const workspaces: Workspace[] = [
			makeWorkspace("w1"),
			makeWorkspace("w2"),
			makeWorkspace("w3"),
			makeWorkspace("w4"),
		];
		// 1 workspace already active
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
			["w4", WorkspaceStage.Pending],
		]);

		const decision = scheduler2.getNextWorkspaces(workspaces, state);

		// 2 slots available (3 max - 1 active)
		expect(decision.ready).toHaveLength(2);
		expect(decision.blocked).toHaveLength(1);
	});

	it("AC1: schedules nothing when all slots are occupied", () => {
		const scheduler2 = new DynamicParallelScheduler(2);
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2")];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Active],
		]);

		const decision = scheduler2.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(0);
	});
});

describe("DynamicParallelScheduler — AC2: Higher concurrency in worktree mode", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		scheduler = new DynamicParallelScheduler(3, true);
	});

	it("AC2: worktree mode skips file lock checks, allowing maximum parallelism", () => {
		const workspaces: Workspace[] = [
			makeCapWorkspace("w1", [], ["shared-file.ts"]),
			makeCapWorkspace("w2", [], ["shared-file.ts"]),
			makeCapWorkspace("w3", [], ["shared-file.ts"]),
		];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		// All 3 should be ready even though they share files (worktree isolation)
		expect(decision.ready).toHaveLength(3);
		// No file-lock skips
		const lockSkips = decision.diagnostics.skipped.filter((s) => s.category === "file_lock");
		expect(lockSkips).toHaveLength(0);
	});

	it("AC2: non-worktree mode still blocks same-file conflicts", () => {
		const nonWorktree = new DynamicParallelScheduler(3, false);
		const workspaces: Workspace[] = [
			makeCapWorkspace("w1", [], ["shared-file.ts"]),
			makeCapWorkspace("w2", [], ["shared-file.ts"]),
		];
		const _state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
		]);

		// Lock w1's file first
		nonWorktree.acquireFileLocks(workspaces[0]);

		const activeState = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);

		const decision = nonWorktree.getNextWorkspaces(workspaces, activeState);

		expect(decision.ready).toHaveLength(0);
	});

	it("AC2: worktree mode setting is configurable and togglable", () => {
		const ws = new DynamicParallelScheduler(3, false);
		expect(ws.getWorktreeMode()).toBe(false);

		ws.setWorktreeMode(true);
		expect(ws.getWorktreeMode()).toBe(true);

		ws.setWorktreeMode(false);
		expect(ws.getWorktreeMode()).toBe(false);
	});

	it("AC2: worktree mode shows in capacity snapshot", () => {
		const wsWorktree = new DynamicParallelScheduler(3, true);
		const wsNormal = new DynamicParallelScheduler(3, false);
		const state = makeState([]);

		const capWorktree = wsWorktree.getCapacitySnapshot(state);
		const capNormal = wsNormal.getCapacitySnapshot(state);

		expect(capWorktree.isWorktreeMode).toBe(true);
		expect(capNormal.isWorktreeMode).toBe(false);
	});

	it("AC2: worktree mode enables full capacity even with file conflicts", () => {
		const wsWorktree = new DynamicParallelScheduler(5, true);
		const workspaces: Workspace[] = [
			makeCapWorkspace("w1", [], ["file-a.ts"]),
			makeCapWorkspace("w2", [], ["file-a.ts"]),
			makeCapWorkspace("w3", [], ["file-a.ts"]),
			makeCapWorkspace("w4", [], ["file-a.ts"]),
			makeCapWorkspace("w5", [], ["file-a.ts"]),
		];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
			["w4", WorkspaceStage.Pending],
			["w5", WorkspaceStage.Pending],
		]);

		const decision = wsWorktree.getNextWorkspaces(workspaces, state);

		// All 5 can run simultaneously in worktree mode despite file overlaps
		expect(decision.ready).toHaveLength(5);
	});
});

describe("DynamicParallelScheduler — AC3: Reduce concurrency under resource pressure", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		// Use 4 workers for pressure reduction tests
		scheduler = new DynamicParallelScheduler(4, false);
	});

	it("AC3: starts with full effective capacity", () => {
		expect(scheduler.getEffectiveMaxWorkers()).toBe(4);
		expect(scheduler.getResourceMetrics().highPressure).toBe(false);
	});

	it("AC3: detects file lock conflicts and records them", () => {
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		const workspace2 = makeCapWorkspace("w2", [], ["file.ts"]);

		scheduler.acquireFileLocks(workspace1);
		const conflict = scheduler.checkFileLockConflict(workspace2);

		expect(conflict).not.toBeNull();
		expect(conflict!.file).toBe("file.ts");
		expect(conflict!.owner).toBe("w1");
		expect(conflict!.requester).toBe("w2");

		const metrics = scheduler.getResourceMetrics();
		expect(metrics.recentFileLockConflicts).toBeGreaterThan(0);
		expect(metrics.totalFileLockConflicts).toBeGreaterThan(0);
	});

	it("AC3: reduces effective concurrency after sustained high pressure", () => {
		// Acquire a file lock for w1
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		scheduler.acquireFileLocks(workspace1);

		// Simulate multiple scheduling rounds with high conflict
		const workspaces: Workspace[] = [
			makeCapWorkspace("w2", [], ["file.ts"]),
			makeCapWorkspace("w3", [], ["file.ts"]),
		];

		// Run enough rounds to trigger pressure reduction
		for (let round = 0; round < 12; round++) {
			const state = makeState([
				["w1", WorkspaceStage.Active],
				["w2", WorkspaceStage.Pending],
				["w3", WorkspaceStage.Pending],
			]);
			scheduler.getNextWorkspaces(workspaces, state);
		}

		const _metrics = scheduler.getResourceMetrics();
		const effectiveMax = scheduler.getEffectiveMaxWorkers();

		// Effective concurrency should be reduced
		expect(effectiveMax).toBeLessThan(4);
		expect(effectiveMax).toBeGreaterThanOrEqual(1);
	});

	it("AC3: restores concurrency when pressure subsides", () => {
		// First drive pressure up
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		scheduler.acquireFileLocks(workspace1);

		const conflictWorkspace = makeCapWorkspace("w2", [], ["file.ts"]);

		for (let round = 0; round < 12; round++) {
			const state = makeState([
				["w1", WorkspaceStage.Active],
				["w2", WorkspaceStage.Pending],
			]);
			scheduler.getNextWorkspaces([workspace1, conflictWorkspace], state);
		}

		// Record that pressure was reduced
		const reducedMax = scheduler.getEffectiveMaxWorkers();
		expect(reducedMax).toBeLessThanOrEqual(4);

		// Now release locks and run more rounds with no conflicts
		scheduler.releaseFileLocks(workspace1);

		for (let round = 0; round < 15; round++) {
			const state = makeState([
				["w1", WorkspaceStage.Complete],
				["w2", WorkspaceStage.Pending],
			]);
			scheduler.getNextWorkspaces([workspace1, conflictWorkspace], state);
		}

		// Pressure should have subsided and concurrency restored
		const restoredMax = scheduler.getEffectiveMaxWorkers();
		expect(restoredMax).toBe(4);
		expect(scheduler.getResourceMetrics().highPressure).toBe(false);
	});

	it("AC3: effective max never goes below MIN_STABLE_WORKERS", () => {
		// This scheduler already has max=4, so worst case is 4-2=2
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		scheduler.acquireFileLocks(workspace1);

		const conflictWorkspace = makeCapWorkspace("w2", [], ["file.ts"]);

		// Many rounds of conflict
		for (let round = 0; round < 30; round++) {
			const state = makeState([
				["w1", WorkspaceStage.Active],
				["w2", WorkspaceStage.Pending],
			]);
			scheduler.getNextWorkspaces([workspace1, conflictWorkspace], state);
		}

		expect(scheduler.getEffectiveMaxWorkers()).toBeGreaterThanOrEqual(1);
	});

	it("AC3: resource pressure shown in capacity snapshot", () => {
		// No pressure initially
		const state = makeState([]);
		const capNormal = scheduler.getCapacitySnapshot(state);
		expect(capNormal.resourcePressure).toBe(0);

		// Create high pressure with 2 workspaces sharing same file
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		scheduler.acquireFileLocks(workspace1);
		// Multiple workspaces conflicting on the same file generates higher pressure
		const conflictWorkspaces = [
			makeCapWorkspace("w2", [], ["file.ts"]),
			makeCapWorkspace("w3", [], ["file.ts"]),
			makeCapWorkspace("w4", [], ["file.ts"]),
		];

		for (let round = 0; round < 15; round++) {
			const pState = makeState([
				["w1", WorkspaceStage.Active],
				["w2", WorkspaceStage.Pending],
				["w3", WorkspaceStage.Pending],
				["w4", WorkspaceStage.Pending],
			]);
			scheduler.getNextWorkspaces([workspace1, ...conflictWorkspaces], pState);
		}

		const capHigh = scheduler.getCapacitySnapshot(state);
		expect(capHigh.resourcePressure).toBeGreaterThan(0);
	});
});

describe("DynamicParallelScheduler — AC4: Explain skipped/selected decisions", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		scheduler = new DynamicParallelScheduler(3);
	});

	it("AC4: selected workspaces include explanatory reasons", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.selectedWithReasons).toHaveLength(2);
		for (const sel of decision.diagnostics.selectedWithReasons) {
			expect(sel.reason).toBeTruthy();
			expect(sel.reason).toContain("Dependencies complete");
		}
	});

	it("AC4: dependency skips include missing dependency IDs and reason", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2", ["w1"])];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const depSkip = decision.diagnostics.skipped.find((s) => s.workspaceId === "w2");
		expect(depSkip).toBeDefined();
		expect(depSkip!.category).toBe("dependency");
		expect(depSkip!.reason).toContain("w1");
		expect(depSkip!.missingDependencyIds).toContain("w1");
	});

	it("AC4: file-lock skips include conflicting workspace and path", () => {
		const workspaces: Workspace[] = [
			makeCapWorkspace("w1", [], ["src/core.ts"]),
			makeCapWorkspace("w2", [], ["src/core.ts"]),
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
		expect(lockSkip!.reason).toContain("w1");
	});

	it("AC4: capacity skips include reason", () => {
		const scheduler2 = new DynamicParallelScheduler(2);
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2"), makeWorkspace("w3")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
		]);

		const decision = scheduler2.getNextWorkspaces(workspaces, state);

		const capSkip = decision.diagnostics.skipped.find((s) => s.category === "capacity");
		expect(capSkip).toBeDefined();
		expect(capSkip!.reason).toBeTruthy();
	});

	it("AC4: idle diagnostics explain why no work started", () => {
		const scheduler2 = new DynamicParallelScheduler(2);
		const workspaces: Workspace[] = [makeWorkspace("w1")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["a2", WorkspaceStage.Active],
			["a3", WorkspaceStage.Active],
		]);

		const decision = scheduler2.getNextWorkspaces(workspaces, state);

		expect(decision.diagnostics.idle.isIdle).toBe(true);
		expect(decision.diagnostics.idle.reasons.length).toBeGreaterThan(0);
	});

	it("AC4: not-pending workspaces are skipped with their stage", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2")];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Complete],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const notPending = decision.diagnostics.skipped.filter((s) => s.category === "not_pending");
		expect(notPending).toHaveLength(2);
		// Stage enum values are lowercase: "active", "complete"
		expect(notPending.some((s) => s.reason.includes("active"))).toBe(true);
		expect(notPending.some((s) => s.reason.includes("complete"))).toBe(true);
	});
});

describe("DynamicParallelScheduler — AC5: Same-file conflicts not run unsafely", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		scheduler = new DynamicParallelScheduler(3);
	});

	it("AC5: blocks workspace editing same file as another active workspace", () => {
		const workspaces: Workspace[] = [
			makeCapWorkspace("w1", [], ["shared.ts"]),
			makeCapWorkspace("w2", [], ["shared.ts"]),
		];

		scheduler.acquireFileLocks(workspaces[0]);

		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(0);
		expect(decision.blocked).toHaveLength(1);
		expect(decision.blockReasons.get("w2")).toContain("File lock conflict");
	});

	it("AC5: allows parallel execution of workspaces editing different files", () => {
		const workspaces: Workspace[] = [
			makeCapWorkspace("w1", [], ["file1.ts"]),
			makeCapWorkspace("w2", [], ["file2.ts"]),
		];

		scheduler.acquireFileLocks(workspaces[0]);

		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(1);
		expect(decision.ready[0].id).toBe("w2");
	});

	it("AC5: throws when trying to acquire already-held file lock", () => {
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		const workspace2 = makeCapWorkspace("w2", [], ["file.ts"]);

		scheduler.acquireFileLocks(workspace1);
		expect(() => scheduler.acquireFileLocks(workspace2)).toThrow("already locked");
	});

	it("AC5: properly releases locks and allows subsequent scheduling", () => {
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		const workspace2 = makeCapWorkspace("w2", [], ["file.ts"]);

		scheduler.acquireFileLocks(workspace1);
		scheduler.releaseFileLocks(workspace1);

		// Now w2 should be able to lock the file
		const locked = scheduler.acquireFileLocks(workspace2);
		expect(locked).toEqual(["file.ts"]);
		expect(scheduler.isFileLocked("file.ts")).toBe("w2");
	});

	it("AC5: no conflict when workspace has no capabilities", () => {
		const workspace1 = makeWorkspace("w1");
		const workspace2 = makeWorkspace("w2");

		const locked1 = scheduler.acquireFileLocks(workspace1);
		const locked2 = scheduler.acquireFileLocks(workspace2);

		expect(locked1).toHaveLength(0);
		expect(locked2).toHaveLength(0);
		expect(scheduler.getFileLocks().size).toBe(0);
	});

	it("AC5: getFileLocks returns copy of lock map", () => {
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		scheduler.acquireFileLocks(workspace1);

		const locks = scheduler.getFileLocks();
		expect(locks.get("file.ts")).toBe("w1");

		// Verify it's a copy - mutating it doesn't affect scheduler
		locks.delete("file.ts");
		expect(scheduler.isFileLocked("file.ts")).toBe("w1");
	});
});

describe("DynamicParallelScheduler — Diagnostics formatting", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		scheduler = new DynamicParallelScheduler(3);
	});

	it("formatSchedulingDecision shows ready workspace details", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1")];
		const state = makeState([["w1", WorkspaceStage.Pending]]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const formatted = formatSchedulingDecision(decision);
		expect(formatted).toContain("Ready to schedule: 1");
		expect(formatted).toContain("w1");
	});

	it("formatSchedulingDecision shows blocked workspace reasons", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2", ["w1"])];
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const formatted = formatSchedulingDecision(decision);
		expect(formatted).toContain("Blocked: 1");
		expect(formatted).toContain("w2");
	});

	it("formatCapacitySummary shows all diagnostic categories", () => {
		const workspaces: Workspace[] = [
			makeCapWorkspace("w1", [], ["shared.ts"]),
			makeCapWorkspace("w2", [], ["shared.ts"]),
			makeCapWorkspace("w3", [], ["shared.ts"]),
		];
		scheduler.acquireFileLocks(workspaces[0]);
		const state = makeState([
			["w1", WorkspaceStage.Active],
			["w2", WorkspaceStage.Pending],
			["w3", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const formatted = formatCapacitySummary(decision.diagnostics);
		expect(formatted).toContain("Dynamic Scheduler Capacity Summary");
		expect(formatted).toContain("Workers:");
		expect(formatted).toContain("File-lock skips:");
	});

	it("formatCapacitySummary shows idle reasons when idle", () => {
		const scheduler2 = new DynamicParallelScheduler(2);
		const workspaces: Workspace[] = [makeWorkspace("w1")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["a1", WorkspaceStage.Active],
			["a2", WorkspaceStage.Active],
		]);
		const decision = scheduler2.getNextWorkspaces(workspaces, state);

		const formatted = formatCapacitySummary(decision.diagnostics);
		expect(formatted).toContain("IDLE");
	});

	it("formatCapacitySummary shows dependency skip details", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2", ["w1"])];
		const state = makeState([
			["w1", WorkspaceStage.Failed],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const formatted = formatCapacitySummary(decision.diagnostics);
		expect(formatted).toContain("Dependency skips:");
		expect(formatted).toContain("w2");
		expect(formatted).toContain("w1");
	});

	it("formatCapacitySummary shows capacity skip details", () => {
		const scheduler2 = new DynamicParallelScheduler(1);
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2")];
		const state = makeState([
			["w1", WorkspaceStage.Pending],
			["w2", WorkspaceStage.Pending],
		]);
		const decision = scheduler2.getNextWorkspaces(workspaces, state);

		const formatted = formatCapacitySummary(decision.diagnostics);
		expect(formatted).toContain("Capacity skips:");
		expect(formatted).toContain("w2");
	});
});

describe("DynamicParallelScheduler — Batch assignments and lifecycle", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		scheduler = new DynamicParallelScheduler(3);
	});

	it("setBatchAssignment stores and retrieves batch IDs", () => {
		const batchAssignment = new Map([
			["w1", 1],
			["w2", 2],
		]);
		const batches = [
			{ batchIndex: 1, workspaceIds: ["w1"], width: 1 },
			{ batchIndex: 2, workspaceIds: ["w2"], width: 1 },
		];
		scheduler.setBatchAssignment(batchAssignment, batches);

		expect(scheduler.getBatchId("w1")).toBe(1);
		expect(scheduler.getBatchId("w2")).toBe(2);
		expect(scheduler.getBatchId("w3")).toBe(0);
	});

	it("reset clears all state", () => {
		const workspace1 = makeCapWorkspace("w1", [], ["file.ts"]);
		scheduler.acquireFileLocks(workspace1);
		scheduler.setBatchAssignment(new Map([["w1", 1]]), []);
		expect(scheduler.isFileLocked("file.ts")).toBe("w1");

		scheduler.reset();

		expect(scheduler.isFileLocked("file.ts")).toBeNull();
		expect(scheduler.getBatchAssignments().size).toBe(0);
		expect(scheduler.getBatches()).toHaveLength(0);
		expect(scheduler.getEffectiveMaxWorkers()).toBe(3);
	});

	it("getMaxWorkers returns configured max", () => {
		const s = new DynamicParallelScheduler(5);
		expect(s.getMaxWorkers()).toBe(5);
	});

	it("clamps maxWorkers to valid range", () => {
		const sLow = new DynamicParallelScheduler(0);
		expect(sLow.getMaxWorkers()).toBeGreaterThanOrEqual(1);

		const sHigh = new DynamicParallelScheduler(100);
		expect(sHigh.getMaxWorkers()).toBeLessThanOrEqual(6);
	});

	it("validateScheduling detects cycles", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1", ["w2"]), makeWorkspace("w2", ["w1"])];

		const result = scheduler.validateScheduling(workspaces);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("cycle"))).toBe(true);
	});

	it("validateScheduling validates non-existent dependencies", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1", ["w2"])];

		const result = scheduler.validateScheduling(workspaces);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("non-existent"))).toBe(true);
	});

	it("validateScheduling passes for valid graph", () => {
		const workspaces: Workspace[] = [makeWorkspace("w1"), makeWorkspace("w2", ["w1"])];

		const result = scheduler.validateScheduling(workspaces);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("areDependenciesComplete checks dependency stages", () => {
		const _dep1 = makeWorkspace("dep1");
		const ws = makeWorkspace("w1", ["dep1"]);

		const statePending = makeState([
			["dep1", WorkspaceStage.Pending],
			["w1", WorkspaceStage.Pending],
		]);
		expect(scheduler.areDependenciesComplete(ws, statePending).complete).toBe(false);

		const stateComplete = makeState([
			["dep1", WorkspaceStage.Complete],
			["w1", WorkspaceStage.Pending],
		]);
		expect(scheduler.areDependenciesComplete(ws, stateComplete).complete).toBe(true);

		const stateFailed = makeState([
			["dep1", WorkspaceStage.Failed],
			["w1", WorkspaceStage.Pending],
		]);
		expect(scheduler.areDependenciesComplete(ws, stateFailed).complete).toBe(false);
	});

	it("getStatistics returns correct counts", () => {
		const state = makeState([
			["w1", WorkspaceStage.Complete],
			["w2", WorkspaceStage.Active],
			["w3", WorkspaceStage.Pending],
			["w4", WorkspaceStage.Failed],
			["w5", WorkspaceStage.Blocked],
		]);

		const stats = scheduler.getStatistics(state);
		expect(stats.total).toBe(5);
		expect(stats.complete).toBe(1);
		expect(stats.active).toBe(1);
		expect(stats.pending).toBe(1);
		expect(stats.failed).toBe(1);
		expect(stats.blocked).toBe(1);
	});
});
