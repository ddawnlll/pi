/**
 * Tests for Execution Stats - Plan Progress and Execution Cockpit Stats
 */

import { describe, expect, it } from "vitest";
import {
	computeExecutionStats,
	computeExecutionStatsSimple,
	type ExecutionStats,
	formatElapsedMs,
	formatExecutionStats,
} from "../src/core/execution-stats.js";
import type { JournalEvent, PlanState } from "../src/core/plan-state.js";
import { WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal PlanState with the given workspace stages. */
function makeState(
	entries: Array<{ id: string; stage: WorkspaceStage }>,
	options?: { startedAt?: number; completedAt?: number; status?: PlanState["status"] },
	now?: number,
): PlanState {
	const currentTime = now ?? Date.now();
	const workspaces = new Map<string, import("../src/core/plan-state.js").WorkspaceState>();
	for (const e of entries) {
		workspaces.set(e.id, {
			workspaceId: e.id,
			stage: e.stage,
			attempts: 0,
		});
	}
	return {
		phase: "P2",
		title: "Test Plan",
		workspaces,
		startedAt: options?.startedAt ?? currentTime,
		completedAt: options?.completedAt,
		status: options?.status ?? "running",
	};
}

/** Create an empty journal. */
function emptyJournal(): JournalEvent[] {
	return [];
}

/** Create a journal with the given timestamps. */
function makeJournal(timestamps: number[]): JournalEvent[] {
	return timestamps.map((ts, i) => ({
		type: "workspace_start" as const,
		timestamp: ts,
		workspaceId: `ws-${i}`,
		data: {},
	}));
}

// ---------------------------------------------------------------------------
// computeExecutionStats (with scheduler)
// ---------------------------------------------------------------------------

describe("computeExecutionStats", () => {
	it("shows plan progress percentage", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Complete },
				{ id: "B", stage: WorkspaceStage.Complete },
				{ id: "C", stage: WorkspaceStage.Pending },
				{ id: "D", stage: WorkspaceStage.Pending },
			],
			{ startedAt: now - 5000 },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		// 2 of 4 = 50%
		expect(stats.progressPercent).toBe(50);
	});

	it("shows 0% for no completed workspaces", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Pending },
				{ id: "B", stage: WorkspaceStage.Blocked },
			],
			{ startedAt: now - 1000 },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.progressPercent).toBe(0);
	});

	it("shows 100% for all completed workspaces", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Complete },
				{ id: "B", stage: WorkspaceStage.Complete },
			],
			{ startedAt: now - 5000, status: "complete", completedAt: now },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.progressPercent).toBe(100);
	});

	it("shows 0% for empty plan", () => {
		const now = 1000000;
		const state = makeState([], { startedAt: now - 100 }, now);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.progressPercent).toBe(0);
		expect(stats.total).toBe(0);
	});

	it("shows completed/total count", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Complete },
				{ id: "B", stage: WorkspaceStage.Complete },
				{ id: "C", stage: WorkspaceStage.Active },
				{ id: "D", stage: WorkspaceStage.Pending },
			],
			{ startedAt: now - 3000 },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.completed).toBe(2);
		expect(stats.total).toBe(4);
	});

	it("shows active/max worker count", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Active },
				{ id: "B", stage: WorkspaceStage.Active },
				{ id: "C", stage: WorkspaceStage.Pending },
			],
			{ startedAt: now - 2000 },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.active).toBe(2);
		expect(stats.maxWorkers).toBe(3);
	});

	it("shows ready/pending/blocked/failed counts", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Active },
				{ id: "B", stage: WorkspaceStage.Pending },
				{ id: "C", stage: WorkspaceStage.Blocked },
				{ id: "D", stage: WorkspaceStage.Failed },
				{ id: "E", stage: WorkspaceStage.Complete },
			],
			{ startedAt: now - 5000 },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.ready).toBeGreaterThanOrEqual(0);
		expect(stats.pending).toBe(1);
		expect(stats.blocked).toBe(1);
		expect(stats.failed).toBe(1);
	});

	it("shows elapsed time", () => {
		const now = 1000000;
		const startedAt = now - 45000; // 45 seconds ago
		const state = makeState([{ id: "A", stage: WorkspaceStage.Active }], { startedAt }, now);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.elapsedMs).toBe(45000);
	});

	it("shows last event timestamp from journal", () => {
		const now = 1000000;
		const state = makeState([{ id: "A", stage: WorkspaceStage.Active }], { startedAt: now - 1000 }, now);
		const scheduler = new WorkspaceScheduler(3);
		const journal = makeJournal([now - 800, now - 200]);

		const stats = computeExecutionStats(state, scheduler, journal, now);

		expect(stats.lastEventTimestamp).toBe(now - 200);
	});

	it("shows null last event timestamp for empty journal", () => {
		const now = 1000000;
		const state = makeState([{ id: "A", stage: WorkspaceStage.Active }], { startedAt: now - 1000 }, now);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.lastEventTimestamp).toBeNull();
	});

	it("computes progress for fractional percentages", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Complete },
				{ id: "B", stage: WorkspaceStage.Pending },
				{ id: "C", stage: WorkspaceStage.Pending },
			],
			{ startedAt: now - 1000 },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		// 1/3 = 33.333... => 33.3
		expect(stats.progressPercent).toBe(33.3);
	});

	it("handles all workspaces failed", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Failed },
				{ id: "B", stage: WorkspaceStage.Failed },
			],
			{ startedAt: now - 5000, status: "failed" },
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		expect(stats.progressPercent).toBe(0);
		expect(stats.failed).toBe(2);
		expect(stats.completed).toBe(0);
	});

	it("handles mixed stages with many workspaces", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "1", stage: WorkspaceStage.Complete },
				{ id: "2", stage: WorkspaceStage.Complete },
				{ id: "3", stage: WorkspaceStage.Complete },
				{ id: "4", stage: WorkspaceStage.Active },
				{ id: "5", stage: WorkspaceStage.Active },
				{ id: "6", stage: WorkspaceStage.Blocked },
				{ id: "7", stage: WorkspaceStage.Failed },
				{ id: "8", stage: WorkspaceStage.Pending },
				{ id: "9", stage: WorkspaceStage.Pending },
			],
			{ startedAt: now - 120000 }, // 2 minutes
			now,
		);
		const scheduler = new WorkspaceScheduler(3);

		const stats = computeExecutionStats(state, scheduler, emptyJournal(), now);

		// 3/9 ≈ 33.3%
		expect(stats.progressPercent).toBe(33.3);
		expect(stats.completed).toBe(3);
		expect(stats.total).toBe(9);
		expect(stats.active).toBe(2);
		expect(stats.pending).toBe(2);
		expect(stats.blocked).toBe(1);
		expect(stats.failed).toBe(1);
		expect(stats.maxWorkers).toBe(3);
		expect(stats.elapsedMs).toBe(120000);
	});
});

// ---------------------------------------------------------------------------
// computeExecutionStatsSimple (without scheduler)
// ---------------------------------------------------------------------------

describe("computeExecutionStatsSimple", () => {
	it("computes stats without a scheduler instance", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Complete },
				{ id: "B", stage: WorkspaceStage.Active },
				{ id: "C", stage: WorkspaceStage.Pending },
			],
			{ startedAt: now - 5000 },
			now,
		);

		const stats = computeExecutionStatsSimple(state, emptyJournal(), 3, now);

		expect(stats.progressPercent).toBe(33.3);
		expect(stats.completed).toBe(1);
		expect(stats.total).toBe(3);
		expect(stats.active).toBe(1);
		expect(stats.maxWorkers).toBe(3);
		expect(stats.pending).toBe(1);
		expect(stats.ready).toBe(1); // 1 available slot, 1 pending
		expect(stats.blocked).toBe(0);
		expect(stats.failed).toBe(0);
		expect(stats.elapsedMs).toBe(5000);
		expect(stats.lastEventTimestamp).toBeNull();
	});

	it("defaults maxWorkers to 3", () => {
		const now = 1000000;
		const state = makeState([{ id: "A", stage: WorkspaceStage.Active }], { startedAt: now }, now);

		const stats = computeExecutionStatsSimple(state, emptyJournal(), undefined, now);

		expect(stats.maxWorkers).toBe(3);
	});

	it("shows 0 ready when all worker slots are occupied", () => {
		const now = 1000000;
		const state = makeState(
			[
				{ id: "A", stage: WorkspaceStage.Active },
				{ id: "B", stage: WorkspaceStage.Active },
				{ id: "C", stage: WorkspaceStage.Active },
				{ id: "D", stage: WorkspaceStage.Pending },
			],
			{ startedAt: now },
			now,
		);

		const stats = computeExecutionStatsSimple(state, emptyJournal(), 3, now);

		// 3 active workers, max 3 => 0 ready slots => 0 ready
		expect(stats.ready).toBe(0);
	});

	it("handles journal with last event timestamp", () => {
		const now = 1000000;
		const state = makeState([{ id: "A", stage: WorkspaceStage.Active }], { startedAt: now - 1000 }, now);
		const journal = makeJournal([now - 500, now - 100]);

		const stats = computeExecutionStatsSimple(state, journal, 3, now);

		expect(stats.lastEventTimestamp).toBe(now - 100);
	});
});

// ---------------------------------------------------------------------------
// formatExecutionStats
// ---------------------------------------------------------------------------

describe("formatExecutionStats", () => {
	it("formats all stats into a dashboard string", () => {
		const stats: ExecutionStats = {
			progressPercent: 66.7,
			completed: 2,
			total: 3,
			active: 1,
			maxWorkers: 3,
			ready: 0,
			pending: 0,
			blocked: 0,
			failed: 0,
			elapsedMs: 45000,
			lastEventTimestamp: 1000500,
		};

		const formatted = formatExecutionStats(stats);

		expect(formatted).toContain("66.7%");
		expect(formatted).toContain("2/3");
		expect(formatted).toContain("1/3");
		expect(formatted).toContain("ready=0");
		expect(formatted).toContain("pending=0");
		expect(formatted).toContain("blocked=0");
		expect(formatted).toContain("failed=0");
		expect(formatted).toContain("45s");
		expect(formatted).toContain("1970-01-01"); // ISO date part
	});

	it("shows dash for null last event timestamp", () => {
		const stats: ExecutionStats = {
			progressPercent: 0,
			completed: 0,
			total: 1,
			active: 0,
			maxWorkers: 3,
			ready: 0,
			pending: 1,
			blocked: 0,
			failed: 0,
			elapsedMs: 0,
			lastEventTimestamp: null,
		};

		const formatted = formatExecutionStats(stats);

		expect(formatted).toContain("Last event: —");
	});
});

// ---------------------------------------------------------------------------
// formatElapsedMs
// ---------------------------------------------------------------------------

describe("formatElapsedMs", () => {
	it("formats seconds only", () => {
		expect(formatElapsedMs(12_000)).toBe("12s");
	});

	it("formats minutes and seconds", () => {
		expect(formatElapsedMs(125_000)).toBe("2m 05s");
	});

	it("formats hours, minutes, and seconds", () => {
		expect(formatElapsedMs(3_780_000)).toBe("1h 03m 00s");
	});

	it("formats 0 as 0s", () => {
		expect(formatElapsedMs(0)).toBe("0s");
	});

	it("handles negative as 0s", () => {
		expect(formatElapsedMs(-5000)).toBe("0s");
	});

	it("pads single-digit seconds", () => {
		expect(formatElapsedMs(63_000)).toBe("1m 03s");
	});
});
