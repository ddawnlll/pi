/**
 * P4.6 Execution Visibility — Verification, Dogfood, and Stability Report
 *
 * Tests cover all 7 acceptance criteria:
 * 1. Completed workspaces do not show hung warnings in dogfood
 * 2. Active stale workspace shows hung warning
 * 3. Progress percentage matches workspace state
 * 4. Burn rate matches total tokens divided by elapsed minutes
 * 5. Live logs update in dashboard/API
 * 6. Resume confidence reflects new events after resume
 * 7. Stability report is written
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assessHealth,
	computeBurnRate,
	computeProgressPercent,
	detectHungWorkspaces,
	formatStabilityReport,
	generateStabilityReport,
	LiveLogBuffer,
	StabilityHealth,
	type StabilityReport,
} from "../src/core/execution-visibility.js";
import type { JournalEvent, PlanState } from "../src/core/plan-state.js";
import { PlanStateStore } from "../src/core/plan-state.js";
import {
	countEventsAfterResume,
	evaluateResumeConfidence,
	findResumeTimestamp,
	type ResumeConfidenceResult,
} from "../src/core/resume-confidence.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal PlanState for testing. */
function makePlanState(overrides: Partial<PlanState> = {}): PlanState {
	return {
		phase: "P4.6",
		title: "Execution Visibility Test",
		workspaces: new Map(),
		startedAt: 1000,
		status: "running",
		...overrides,
	};
}

/** Create a basic test workspace queue. */
function makeTestQueue(): WorkspaceQueue {
	return {
		phase: "P4.6",
		title: "Execution Visibility Test",
		workspaces: [
			{ id: "ws1", title: "WS 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "ws2", title: "WS 2", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "ws3", title: "WS 3", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		],
		maxParallelWorkspaces: 3,
	};
}

/** Create journal events (simple shorthand). */
function makeJournal(entries: Array<{ type: string; timestamp: number; workspaceId?: string }>): JournalEvent[] {
	return entries.map((e) => ({
		type: e.type as JournalEvent["type"],
		timestamp: e.timestamp,
		workspaceId: e.workspaceId,
		data: {},
	}));
}

// ---------------------------------------------------------------------------
// AC1: Completed workspaces do NOT show hung warnings in dogfood
// ---------------------------------------------------------------------------

describe("AC1: Completed workspaces do not show hung warnings", () => {
	it("completed workspace is never flagged as hung regardless of duration", () => {
		const now = 1_000_000;
		const longAgo = now - 600_000; // 10 minutes ago

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-completed",
					{
						workspaceId: "ws-completed",
						stage: WorkspaceStage.Complete,
						attempts: 1,
						startedAt: longAgo,
						completedAt: now,
					},
				],
			]),
			startedAt: longAgo,
		});

		const result = detectHungWorkspaces(state, [], 5 * 60 * 1000, now);

		expect(result.warnings).toHaveLength(0);
		expect(result.hasHungWorkspaces).toBe(false);
	});

	it("failed workspace is never flagged as hung", () => {
		const now = 1_000_000;
		const longAgo = now - 600_000;

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-failed",
					{
						workspaceId: "ws-failed",
						stage: WorkspaceStage.Failed,
						attempts: 2,
						startedAt: longAgo,
						completedAt: now,
					},
				],
			]),
			startedAt: longAgo,
		});

		const result = detectHungWorkspaces(state, [], 5 * 60 * 1000, now);

		expect(result.warnings).toHaveLength(0);
		expect(result.hasHungWorkspaces).toBe(false);
	});

	it("blocked workspace is never flagged as hung", () => {
		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-blocked",
					{
						workspaceId: "ws-blocked",
						stage: WorkspaceStage.Blocked,
						attempts: 1,
						startedAt: 0,
					},
				],
			]),
		});

		const result = detectHungWorkspaces(state, [], 5 * 60 * 1000);

		expect(result.warnings).toHaveLength(0);
	});

	it("pending workspace is never flagged as hung", () => {
		const state = makePlanState({
			workspaces: new Map([
				["ws-pending", { workspaceId: "ws-pending", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
		});

		const result = detectHungWorkspaces(state, [], 5 * 60 * 1000);

		expect(result.warnings).toHaveLength(0);
	});

	it("dogfood: mixed workspace states — only active ones can be flagged", () => {
		const now = 1_000_000;
		const longAgo = now - 600_000;

		const state = makePlanState({
			workspaces: new Map([
				// Completed — never flagged
				[
					"ws-done",
					{
						workspaceId: "ws-done",
						stage: WorkspaceStage.Complete,
						attempts: 1,
						startedAt: longAgo,
						completedAt: now - 100_000,
					},
				],
				// Failed — never flagged
				[
					"ws-err",
					{
						workspaceId: "ws-err",
						stage: WorkspaceStage.Failed,
						attempts: 2,
						startedAt: longAgo,
						completedAt: now - 50_000,
					},
				],
				// Active but recent — not hung
				[
					"ws-recent",
					{
						workspaceId: "ws-recent",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt: now - 30_000, // 30 seconds ago
					},
				],
				// Active and stale — SHOULD be flagged
				[
					"ws-stale",
					{
						workspaceId: "ws-stale",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt: longAgo,
					},
				],
			]),
			startedAt: longAgo,
		});

		const result = detectHungWorkspaces(state, [], 5 * 60 * 1000, now);

		// Only ws-stale should be flagged
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0].workspaceId).toBe("ws-stale");
		expect(result.hasHungWorkspaces).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC2: Active stale workspace shows hung warning
// ---------------------------------------------------------------------------

describe("AC2: Active stale workspace shows hung warning", () => {
	it("active workspace beyond threshold is flagged as hung", () => {
		const now = 1_000_000;
		const startedAt = now - 700_000; // ~11.7 min ago
		const threshold = 10 * 60 * 1000; // 10 min

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-active-stale",
					{
						workspaceId: "ws-active-stale",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const journal = makeJournal([
			{ type: "workspace_start", timestamp: startedAt, workspaceId: "ws-active-stale" },
			{ type: "worker_status", timestamp: startedAt + 5000, workspaceId: "ws-active-stale" },
		]);

		const result = detectHungWorkspaces(state, journal, threshold, now);

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0].workspaceId).toBe("ws-active-stale");
		expect(result.warnings[0].activeDurationMs).toBe(now - startedAt);
		expect(result.warnings[0].thresholdMs).toBe(threshold);
		expect(result.warnings[0].lastEventTimestamp).toBe(startedAt + 5000);
	});

	it("active workspace within threshold is NOT flagged", () => {
		const now = 1_000_000;
		const startedAt = now - 30_000; // 30 seconds ago

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-active-fresh",
					{
						workspaceId: "ws-active-fresh",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const result = detectHungWorkspaces(state, [], 10 * 60 * 1000, now);

		expect(result.warnings).toHaveLength(0);
		expect(result.hasHungWorkspaces).toBe(false);
	});

	it("active workspace exactly at threshold boundary is NOT flagged", () => {
		const threshold = 10 * 60 * 1000;
		const now = 1_000_000;
		const startedAt = now - threshold; // exactly at threshold

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-boundary",
					{
						workspaceId: "ws-boundary",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const result = detectHungWorkspaces(state, [], threshold, now);

		// Must be STRICTLY beyond threshold
		expect(result.warnings).toHaveLength(0);
	});

	it("active workspace just past threshold IS flagged", () => {
		const threshold = 10 * 60 * 1000;
		const now = 1_000_000;
		const startedAt = now - threshold - 1; // 1ms past threshold

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-past",
					{
						workspaceId: "ws-past",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const result = detectHungWorkspaces(state, [], threshold, now);

		expect(result.warnings).toHaveLength(1);
	});

	it("detects multiple hung workspaces", () => {
		const now = 1_000_000;
		const startedAt = now - 700_000; // beyond 10 min threshold

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-1",
					{
						workspaceId: "ws-1",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
				[
					"ws-2",
					{
						workspaceId: "ws-2",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const result = detectHungWorkspaces(state, [], 10 * 60 * 1000, now);

		expect(result.warnings).toHaveLength(2);
		expect(result.hasHungWorkspaces).toBe(true);
	});

	it("active workspace with no startedAt is not flagged", () => {
		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-no-start",
					{
						workspaceId: "ws-no-start",
						stage: WorkspaceStage.Active,
						attempts: 1,
						// startedAt intentionally undefined
					},
				],
			]),
		});

		const result = detectHungWorkspaces(state, [], 10 * 60 * 1000);

		expect(result.warnings).toHaveLength(0);
	});

	it("finds last event timestamp for hung workspace from journal", () => {
		const now = 1_000_000;
		const startedAt = now - 700_000;

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-1",
					{
						workspaceId: "ws-1",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const journal = makeJournal([
			{ type: "workspace_start", timestamp: startedAt, workspaceId: "ws-1" },
			{ type: "worker_status", timestamp: startedAt + 1000, workspaceId: "ws-1" },
			{ type: "tool_call", timestamp: startedAt + 2000, workspaceId: "ws-1" },
			// Other workspace events that should not interfere
			{ type: "worker_status", timestamp: startedAt + 3000, workspaceId: "ws-2" },
		]);

		const result = detectHungWorkspaces(state, journal, 10 * 60 * 1000, now);

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0].lastEventTimestamp).toBe(startedAt + 2000);
	});

	it("returns null lastEventTimestamp when no events for workspace", () => {
		const now = 1_000_000;
		const startedAt = now - 700_000;

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-1",
					{
						workspaceId: "ws-1",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		// Journal has events for a different workspace
		const journal = makeJournal([{ type: "workspace_start", timestamp: startedAt, workspaceId: "ws-2" }]);

		const result = detectHungWorkspaces(state, journal, 10 * 60 * 1000, now);

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0].lastEventTimestamp).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// AC3: Progress percentage matches workspace state
// ---------------------------------------------------------------------------

describe("AC3: Progress percentage matches workspace state", () => {
	it("0% for all pending workspaces", () => {
		const state = makePlanState({
			workspaces: new Map([
				["A", { workspaceId: "A", stage: WorkspaceStage.Pending, attempts: 0 }],
				["B", { workspaceId: "B", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
		});

		expect(computeProgressPercent(state)).toBe(0);
	});

	it("50% for half completed workspaces", () => {
		const state = makePlanState({
			workspaces: new Map([
				["A", { workspaceId: "A", stage: WorkspaceStage.Complete, attempts: 1 }],
				["B", { workspaceId: "B", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
		});

		expect(computeProgressPercent(state)).toBe(50);
	});

	it("100% for all completed workspaces", () => {
		const state = makePlanState({
			workspaces: new Map([
				["A", { workspaceId: "A", stage: WorkspaceStage.Complete, attempts: 1 }],
				["B", { workspaceId: "B", stage: WorkspaceStage.Complete, attempts: 1 }],
			]),
		});

		expect(computeProgressPercent(state)).toBe(100);
	});

	it("0% for empty plan (no workspaces)", () => {
		const state = makePlanState({ workspaces: new Map() });
		expect(computeProgressPercent(state)).toBe(0);
	});

	it("33.3% for 1 of 3 completed", () => {
		const state = makePlanState({
			workspaces: new Map([
				["A", { workspaceId: "A", stage: WorkspaceStage.Complete, attempts: 1 }],
				["B", { workspaceId: "B", stage: WorkspaceStage.Active, attempts: 1 }],
				["C", { workspaceId: "C", stage: WorkspaceStage.Pending, attempts: 0 }],
			]),
		});

		expect(computeProgressPercent(state)).toBe(33.3);
	});

	it("failed workspaces do NOT count toward progress", () => {
		const state = makePlanState({
			workspaces: new Map([
				["A", { workspaceId: "A", stage: WorkspaceStage.Complete, attempts: 1 }],
				["B", { workspaceId: "B", stage: WorkspaceStage.Failed, attempts: 2 }],
			]),
		});

		// Only 1 of 2 completed = 50%
		expect(computeProgressPercent(state)).toBe(50);
	});

	it("66.7% for 2 of 3 completed", () => {
		const state = makePlanState({
			workspaces: new Map([
				["A", { workspaceId: "A", stage: WorkspaceStage.Complete, attempts: 1 }],
				["B", { workspaceId: "B", stage: WorkspaceStage.Complete, attempts: 1 }],
				["C", { workspaceId: "C", stage: WorkspaceStage.Failed, attempts: 2 }],
			]),
		});

		expect(computeProgressPercent(state)).toBe(66.7);
	});
});

// ---------------------------------------------------------------------------
// AC4: Burn rate matches total tokens / elapsed minutes
// ---------------------------------------------------------------------------

describe("AC4: Burn rate matches total tokens / elapsed minutes", () => {
	it("basic burn rate calculation", () => {
		// 6000 tokens over 10 minutes = 600 tokens/min
		const now = 1_000_000;
		const startedAt = now - 600_000; // 10 min ago

		expect(computeBurnRate(6000, startedAt, now)).toBe(600);
	});

	it("returns 0 when elapsed time is 0", () => {
		const now = 1_000_000;
		expect(computeBurnRate(6000, now, now)).toBe(0);
	});

	it("returns 0 when elapsed time is negative", () => {
		expect(computeBurnRate(6000, 1_000_001, 1_000_000)).toBe(0);
	});

	it("returns 0 when total tokens is 0", () => {
		const now = 1_000_000;
		const startedAt = now - 600_000;
		expect(computeBurnRate(0, startedAt, now)).toBe(0);
	});

	it("fractional burn rate is rounded", () => {
		// 100 tokens over 3 minutes = 33.333... -> 33
		const now = 1_000_000;
		const startedAt = now - 180_000; // 3 min
		expect(computeBurnRate(100, startedAt, now)).toBe(33);
	});

	it("high burn rate scenario", () => {
		// 100,000 tokens over 5 minutes = 20,000 tokens/min
		const now = 1_000_000;
		const startedAt = now - 300_000; // 5 min
		expect(computeBurnRate(100_000, startedAt, now)).toBe(20_000);
	});

	it("burn rate with 1 minute elapsed", () => {
		const now = 1_000_000;
		const startedAt = now - 60_000;
		expect(computeBurnRate(5000, startedAt, now)).toBe(5000);
	});

	it("burn rate with sub-minute elapsed", () => {
		const now = 1_000_000;
		const startedAt = now - 30_000; // 0.5 min
		// 5000 / 0.5 = 10000
		expect(computeBurnRate(5000, startedAt, now)).toBe(10_000);
	});
});

// ---------------------------------------------------------------------------
// AC5: Live logs update in dashboard/API
// ---------------------------------------------------------------------------

describe("AC5: Live logs update in dashboard/API", () => {
	it("appending lines makes them available via getRecentLines", () => {
		const buffer = new LiveLogBuffer();
		const planExecId = "plan-1";
		const workspaceId = "ws-1";

		buffer.appendLine(planExecId, workspaceId, "line 1: starting execution");
		buffer.appendLine(planExecId, workspaceId, "line 2: reading files");

		const lines = buffer.getRecentLines(planExecId, workspaceId);
		expect(lines).toEqual(["line 1: starting execution", "line 2: reading files"]);
	});

	it("getRecentLines returns up to maxLines", () => {
		const buffer = new LiveLogBuffer();
		const planExecId = "plan-1";
		const workspaceId = "ws-1";

		for (let i = 0; i < 200; i++) {
			buffer.appendLine(planExecId, workspaceId, `line ${i}`);
		}

		const lines = buffer.getRecentLines(planExecId, workspaceId, 50);
		expect(lines).toHaveLength(50);
		// Should return the LAST 50 lines
		expect(lines[0]).toBe("line 150");
		expect(lines[49]).toBe("line 199");
	});

	it("empty buffer returns empty array", () => {
		const buffer = new LiveLogBuffer();
		const lines = buffer.getRecentLines("nonexistent", "ws-1");
		expect(lines).toEqual([]);
	});

	it("workspaces are isolated from each other", () => {
		const buffer = new LiveLogBuffer();
		const planExecId = "plan-1";

		buffer.appendLine(planExecId, "ws-1", "workspace 1 line");
		buffer.appendLine(planExecId, "ws-2", "workspace 2 line");

		expect(buffer.getRecentLines(planExecId, "ws-1")).toEqual(["workspace 1 line"]);
		expect(buffer.getRecentLines(planExecId, "ws-2")).toEqual(["workspace 2 line"]);
	});

	it("plan executions are isolated from each other", () => {
		const buffer = new LiveLogBuffer();

		buffer.appendLine("plan-A", "ws-1", "plan A line");
		buffer.appendLine("plan-B", "ws-1", "plan B line");

		expect(buffer.getRecentLines("plan-A", "ws-1")).toEqual(["plan A line"]);
		expect(buffer.getRecentLines("plan-B", "ws-1")).toEqual(["plan B line"]);
	});

	it("buffer trims to maxLinesPerWorkspace when exceeding limit", () => {
		const buffer = new LiveLogBuffer(10); // small buffer
		const planExecId = "plan-1";
		const workspaceId = "ws-1";

		for (let i = 0; i < 15; i++) {
			buffer.appendLine(planExecId, workspaceId, `line ${i}`);
		}

		// Buffer should have been trimmed to 10
		const count = buffer.getLineCount(planExecId, workspaceId);
		expect(count).toBe(10);

		const lines = buffer.getRecentLines(planExecId, workspaceId, 100);
		expect(lines[0]).toBe("line 5"); // First 5 were trimmed
		expect(lines[9]).toBe("line 14");
	});

	it("clear removes a specific workspace buffer", () => {
		const buffer = new LiveLogBuffer();
		const planExecId = "plan-1";

		buffer.appendLine(planExecId, "ws-1", "line for ws-1");
		buffer.appendLine(planExecId, "ws-2", "line for ws-2");

		buffer.clear(planExecId, "ws-1");

		expect(buffer.getRecentLines(planExecId, "ws-1")).toEqual([]);
		expect(buffer.getRecentLines(planExecId, "ws-2")).toEqual(["line for ws-2"]);
	});

	it("clearAll removes all buffers", () => {
		const buffer = new LiveLogBuffer();

		buffer.appendLine("plan-1", "ws-1", "line 1");
		buffer.appendLine("plan-2", "ws-2", "line 2");

		buffer.clearAll();

		expect(buffer.getRecentLines("plan-1", "ws-1")).toEqual([]);
		expect(buffer.getRecentLines("plan-2", "ws-2")).toEqual([]);
	});

	it("getLineCount returns 0 for nonexistent buffer", () => {
		const buffer = new LiveLogBuffer();
		expect(buffer.getLineCount("nonexistent", "ws-1")).toBe(0);
	});

	it("live log streaming: dashboard simulates append-then-read", () => {
		const buffer = new LiveLogBuffer();
		const planExecId = "plan-live";
		const workspaceId = "ws-live";

		// Simulate execution progress
		buffer.appendLine(planExecId, workspaceId, "[00:00] Worker starting...");
		buffer.appendLine(planExecId, workspaceId, "[00:01] Reading source files...");

		// Dashboard polls
		let lines = buffer.getRecentLines(planExecId, workspaceId);
		expect(lines).toHaveLength(2);

		// More execution progress
		buffer.appendLine(planExecId, workspaceId, "[00:05] Editing file.ts...");
		buffer.appendLine(planExecId, workspaceId, "[00:08] Running typecheck...");

		// Dashboard polls again
		lines = buffer.getRecentLines(planExecId, workspaceId);
		expect(lines).toHaveLength(4);
		expect(lines[2]).toBe("[00:05] Editing file.ts...");
	});
});

// ---------------------------------------------------------------------------
// AC6: Resume confidence reflects new events after resume
// ---------------------------------------------------------------------------

describe("AC6: Resume confidence reflects new events after resume", () => {
	it("resume confidence shows progressing when new events exist after resume", () => {
		const state = makePlanState();
		const now = Date.now();

		const events = makeJournal([
			{ type: "plan_start", timestamp: now - 5000 },
			{ type: "plan_paused", timestamp: now - 4000 },
			{ type: "plan_resumed", timestamp: now - 3000 },
			{ type: "workspace_start", timestamp: now - 2000, workspaceId: "ws1" },
			{ type: "workspace_complete", timestamp: now - 1000, workspaceId: "ws1" },
		]);

		const result = evaluateResumeConfidence(state, events);

		expect(result.state).toBe("progressing");
		expect(result.newEventCount).toBe(2);
		expect(result.resumedAt).toBe(now - 3000);
	});

	it("resume confidence shows nominal when recently resumed with no events yet", () => {
		const state = makePlanState();
		const now = Date.now();

		const events = makeJournal([
			{ type: "plan_start", timestamp: now - 5000 },
			{ type: "plan_resumed", timestamp: now - 1000 },
		]);

		const result = evaluateResumeConfidence(state, events);

		expect(result.state).toBe("nominal");
		expect(result.newEventCount).toBe(0);
		expect(result.hasStallWarning).toBe(false);
	});

	it("resume confidence shows stalled when no events after threshold", () => {
		const state = makePlanState();
		const now = Date.now();

		const events = makeJournal([
			{ type: "plan_resumed", timestamp: now - 120_000 }, // 2 min ago
		]);

		const result = evaluateResumeConfidence(state, events, { stallThresholdMs: 60_000 });

		expect(result.state).toBe("stalled");
		expect(result.newEventCount).toBe(0);
		expect(result.hasStallWarning).toBe(true);
	});

	it("resume confidence shows unsafe when completed workspace reruns", () => {
		const state = makePlanState({
			workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Active, attempts: 2 }]]),
		});
		const now = Date.now();

		const events = makeJournal([
			{ type: "workspace_start", timestamp: now - 10000, workspaceId: "ws1" },
			{ type: "workspace_complete", timestamp: now - 8000, workspaceId: "ws1" },
			{ type: "plan_resumed", timestamp: now - 5000 },
			{ type: "workspace_start", timestamp: now - 3000, workspaceId: "ws1" },
		]);

		const result = evaluateResumeConfidence(state, events);

		expect(result.state).toBe("unsafe");
		expect(result.hasRerunWarning).toBe(true);
		expect(result.rerunWorkspaceIds).toContain("ws1");
	});

	it("never-resumed plan returns nominal with 0 resume timestamp", () => {
		const state = makePlanState();
		const events = makeJournal([{ type: "plan_start", timestamp: 1000 }]);

		const result = evaluateResumeConfidence(state, events);

		expect(result.state).toBe("nominal");
		expect(result.resumedAt).toBe(0);
		expect(result.newEventCount).toBe(0);
	});

	it("findResumeTimestamp returns latest resume timestamp", () => {
		const events = makeJournal([
			{ type: "plan_resumed", timestamp: 3000 },
			{ type: "plan_paused", timestamp: 4000 },
			{ type: "plan_resumed", timestamp: 5000 },
		]);

		expect(findResumeTimestamp(events)).toBe(5000);
	});

	it("countEventsAfterResume counts events after last plan_resumed", () => {
		const events = makeJournal([
			{ type: "plan_start", timestamp: 1000 },
			{ type: "plan_resumed", timestamp: 3000 },
			{ type: "workspace_start", timestamp: 3100, workspaceId: "ws1" },
			{ type: "workspace_complete", timestamp: 3200, workspaceId: "ws1" },
		]);

		expect(countEventsAfterResume(events, 3000)).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// AC7: Stability report is written
// ---------------------------------------------------------------------------

describe("AC7: Stability report is written", () => {
	it("generates a complete stability report with all fields", () => {
		const now = 1_000_000;
		const startedAt = now - 600_000;

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws1",
					{
						workspaceId: "ws1",
						stage: WorkspaceStage.Complete,
						attempts: 1,
						startedAt: startedAt + 1000,
						completedAt: now - 300_000,
					},
				],
				[
					"ws2",
					{
						workspaceId: "ws2",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt: startedAt + 2000,
					},
				],
				[
					"ws3",
					{
						workspaceId: "ws3",
						stage: WorkspaceStage.Pending,
						attempts: 0,
					},
				],
			]),
			startedAt,
		});

		const journal = makeJournal([
			{ type: "plan_start", timestamp: startedAt },
			{ type: "workspace_start", timestamp: startedAt + 1000, workspaceId: "ws1" },
			{ type: "workspace_complete", timestamp: now - 300_000, workspaceId: "ws1" },
			{ type: "workspace_start", timestamp: startedAt + 2000, workspaceId: "ws2" },
		]);

		const report = generateStabilityReport(state, journal, {
			totalTokensIn: 12000,
			hungThresholdMs: 10 * 60 * 1000,
			now,
		});

		// All required fields present
		expect(typeof report.generatedAt).toBe("number");
		expect(report.planPhase).toBe("P4.6");
		expect(report.planTitle).toBe("Execution Visibility Test");
		expect(report.planStatus).toBe("running");
		expect(report.totalWorkspaces).toBe(3);
		expect(report.completedWorkspaces).toBe(1);
		expect(report.activeWorkspaces).toBe(1);
		expect(report.pendingWorkspaces).toBe(1);
		expect(report.failedWorkspaces).toBe(0);
		expect(report.blockedWorkspaces).toBe(0);
		expect(report.progressPercent).toBe(33.3);
		expect(report.burnRatePerMin).toBe(1200); // 12000 tokens / 10 min = 1200/min
		expect(report.totalTokensIn).toBe(12000);
		expect(report.elapsedMinutes).toBe(10);
		expect(Array.isArray(report.hungWorkspaces)).toBe(true);
		expect(report.resumeConfidence).toBeNull(); // Never resumed
		expect(typeof report.health).toBe("string");
		expect(typeof report.summary).toBe("string");
	});

	it("stability report detects hung workspaces", () => {
		const now = 1_000_000;
		const startedAt = now - 700_000;

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-hung",
					{
						workspaceId: "ws-hung",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const report = generateStabilityReport(state, [], {
			totalTokensIn: 5000,
			hungThresholdMs: 10 * 60 * 1000,
			now,
		});

		expect(report.hungWorkspaces).toContain("ws-hung");
		expect(report.health).toBe(StabilityHealth.Warning);
	});

	it("stability report is critical when multiple hung workspaces", () => {
		const now = 1_000_000;
		const startedAt = now - 700_000;

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws-hung-1",
					{
						workspaceId: "ws-hung-1",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
				[
					"ws-hung-2",
					{
						workspaceId: "ws-hung-2",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt,
					},
				],
			]),
			startedAt,
		});

		const report = generateStabilityReport(state, [], {
			hungThresholdMs: 10 * 60 * 1000,
			now,
		});

		expect(report.hungWorkspaces).toHaveLength(2);
		expect(report.health).toBe(StabilityHealth.Critical);
	});

	it("stability report includes resume confidence when plan was resumed", () => {
		const now = 1_000_000;

		const state = makePlanState({
			workspaces: new Map([
				[
					"ws1",
					{
						workspaceId: "ws1",
						stage: WorkspaceStage.Active,
						attempts: 1,
						startedAt: now - 600_000,
					},
				],
			]),
			startedAt: now - 600_000,
		});

		const events = makeJournal([
			{ type: "plan_start", timestamp: now - 600_000 },
			{ type: "plan_paused", timestamp: now - 300_000 },
			{ type: "plan_resumed", timestamp: now - 200_000 },
			{ type: "workspace_start", timestamp: now - 150_000, workspaceId: "ws1" },
		]);

		const report = generateStabilityReport(state, events, { now });

		expect(report.resumeConfidence).not.toBeNull();
		expect(report.resumeConfidence!.state).toBe("progressing");
		expect(report.resumeConfidence!.newEventCount).toBe(1);
		expect(report.resumeConfidence!.resumedAt).toBe(now - 200_000);
	});

	it("stability report resume confidence is null when plan never resumed", () => {
		const now = 1_000_000;
		const state = makePlanState({
			workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Complete, attempts: 1 }]]),
			startedAt: now - 600_000,
		});

		const events = makeJournal([
			{ type: "plan_start", timestamp: now - 600_000 },
			{ type: "workspace_start", timestamp: now - 500_000, workspaceId: "ws1" },
			{ type: "workspace_complete", timestamp: now - 400_000, workspaceId: "ws1" },
		]);

		const report = generateStabilityReport(state, events, { now });

		expect(report.resumeConfidence).toBeNull();
	});

	it("stability report health is critical when all workspaces failed and none active", () => {
		const now = 1_000_000;
		const _state = makePlanState({
			workspaces: new Map([
				["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Failed, attempts: 2 }],
				["ws2", { workspaceId: "ws2", stage: WorkspaceStage.Failed, attempts: 2 }],
			]),
			startedAt: now - 600_000,
			status: "failed",
		});

		const health = assessHealth(
			{ warnings: [], hasHungWorkspaces: false },
			null,
			2, // failedWorkspaces
			0, // activeWorkspaces
		);

		expect(health).toBe(StabilityHealth.Critical);
	});

	it("stability report health is critical when resume confidence is unsafe", () => {
		const resumeConfidence: ResumeConfidenceResult = {
			state: "unsafe",
			resumedAt: 1000,
			newEventCount: 1,
			hasStallWarning: false,
			hasRerunWarning: true,
			rerunWorkspaceIds: ["ws1"],
			summary: "UNSAFE",
		};

		const health = assessHealth({ warnings: [], hasHungWorkspaces: false }, resumeConfidence, 0, 1);

		expect(health).toBe(StabilityHealth.Critical);
	});

	it("stability report health is warning when resume confidence is stalled", () => {
		const resumeConfidence: ResumeConfidenceResult = {
			state: "stalled",
			resumedAt: 1000,
			newEventCount: 0,
			hasStallWarning: true,
			hasRerunWarning: false,
			rerunWorkspaceIds: [],
			summary: "STALLED",
		};

		const health = assessHealth({ warnings: [], hasHungWorkspaces: false }, resumeConfidence, 0, 1);

		expect(health).toBe(StabilityHealth.Warning);
	});

	it("stability report health is healthy for normal execution", () => {
		const health = assessHealth({ warnings: [], hasHungWorkspaces: false }, null, 0, 2);

		expect(health).toBe(StabilityHealth.Healthy);
	});

	it("formatStabilityReport produces readable output", () => {
		const now = 1_000_000;

		const report: StabilityReport = {
			generatedAt: now,
			planPhase: "P4.6",
			planTitle: "Execution Visibility",
			planStatus: "running",
			totalWorkspaces: 3,
			completedWorkspaces: 1,
			failedWorkspaces: 0,
			activeWorkspaces: 1,
			blockedWorkspaces: 0,
			pendingWorkspaces: 1,
			progressPercent: 33.3,
			burnRatePerMin: 120,
			totalTokensIn: 12000,
			elapsedMinutes: 10,
			hungWorkspaces: [],
			resumeConfidence: null,
			health: StabilityHealth.Healthy,
			summary: "Progress: 33.3% | Burn rate: 120 tokens/min | Health: healthy",
		};

		const formatted = formatStabilityReport(report);

		expect(formatted).toContain("P4.6 Stability Report");
		expect(formatted).toContain("33.3%");
		expect(formatted).toContain("120 tokens/min");
		expect(formatted).toContain("healthy");
	});

	it("formatStabilityReport includes hung workspace warnings", () => {
		const report: StabilityReport = {
			generatedAt: 1_000_000,
			planPhase: "P4.6",
			planTitle: "Test",
			planStatus: "running",
			totalWorkspaces: 2,
			completedWorkspaces: 0,
			failedWorkspaces: 0,
			activeWorkspaces: 2,
			blockedWorkspaces: 0,
			pendingWorkspaces: 0,
			progressPercent: 0,
			burnRatePerMin: 500,
			totalTokensIn: 5000,
			elapsedMinutes: 10,
			hungWorkspaces: ["ws-hung-1", "ws-hung-2"],
			resumeConfidence: null,
			health: StabilityHealth.Critical,
			summary: "Critical: 2 hung workspaces",
		};

		const formatted = formatStabilityReport(report);

		expect(formatted).toContain("HUNG WORKSPACES");
		expect(formatted).toContain("ws-hung-1");
		expect(formatted).toContain("ws-hung-2");
	});

	it("stability report can be serialized and written to disk", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "p46-stability-test-"));

		try {
			const now = 1_000_000;
			const state = makePlanState({
				workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Complete, attempts: 1 }]]),
				startedAt: now - 600_000,
			});

			const report = generateStabilityReport(state, [], {
				totalTokensIn: 5000,
				now,
			});

			// Write to JSON file
			const reportPath = path.join(tempDir, "stability-report.json");
			await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

			// Read back and verify
			const content = await fs.readFile(reportPath, "utf-8");
			const parsed = JSON.parse(content);

			expect(parsed.planPhase).toBe("P4.6");
			expect(parsed.progressPercent).toBe(100);
			expect(parsed.burnRatePerMin).toBe(500); // 5000 / 10 min = 500/min
			expect(parsed.health).toBe("healthy");
			expect(parsed.hungWorkspaces).toEqual([]);
			expect(parsed.resumeConfidence).toBeNull();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// Integration: PlanStateStore + stability report
// ---------------------------------------------------------------------------

describe("Integration: PlanStateStore + stability report", () => {
	let tempDir: string;
	let stateStore: PlanStateStore;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "p46-integration-test-"));
		stateStore = new PlanStateStore(tempDir);
		await stateStore.initializeState(makeTestQueue());
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("generates stability report from real PlanStateStore data", async () => {
		// Transition workspaces through realistic execution
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Complete);
		await stateStore.transitionWorkspace("ws2", WorkspaceStage.Active);

		const state = stateStore.getState()!;
		const journal = await stateStore.readJournal();

		const report = generateStabilityReport(state, journal, {
			totalTokensIn: 8000,
			hungThresholdMs: 10 * 60 * 1000,
		});

		expect(report.totalWorkspaces).toBe(3);
		expect(report.completedWorkspaces).toBe(1);
		expect(report.activeWorkspaces).toBe(1);
		expect(report.pendingWorkspaces).toBe(1);
		expect(report.progressPercent).toBe(33.3);
	});

	it("stability report detects hung after simulated stall", async () => {
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);

		const state = stateStore.getState()!;
		const journal = await stateStore.readJournal();

		// Make ws1 appear hung by setting its startedAt far in the past
		const now = Date.now();
		const hungStartedAt = now - 700_000; // >10 min ago
		state.workspaces.get("ws1")!.startedAt = hungStartedAt;

		const report = generateStabilityReport(state, journal, {
			hungThresholdMs: 10 * 60 * 1000,
			now,
		});

		expect(report.hungWorkspaces).toContain("ws1");
		expect(report.health).toBe(StabilityHealth.Warning);
	});

	it("stability report reflects resume and subsequent progress", async () => {
		// Complete ws1, pause, resume, then start ws2
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Complete);
		await stateStore.pausePlan();
		await stateStore.resumePlan();
		await stateStore.transitionWorkspace("ws2", WorkspaceStage.Active);

		const state = stateStore.getState()!;
		const journal = await stateStore.readJournal();

		const report = generateStabilityReport(state, journal);

		expect(report.resumeConfidence).not.toBeNull();
		expect(report.resumeConfidence!.state).toBe("progressing");
		expect(report.resumeConfidence!.newEventCount).toBeGreaterThan(0);
	});
});
