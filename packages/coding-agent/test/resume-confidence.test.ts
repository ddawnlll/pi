/**
 * Resume Confidence Indicator Tests - Workspace 4.6.G
 *
 * Tests cover:
 * - Resume timestamp detection from journal events
 * - New event count after resume
 * - Stall warning when no events after threshold
 * - Rerun warning when completed workspace appears to re-execute
 * - All four confidence states: progressing, nominal, stalled, unsafe
 * - Edge cases: empty events, no resume, cancelled plans
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanState } from "../src/core/plan-state.js";
import { PlanStateStore } from "../src/core/plan-state.js";
import {
	countEventsAfterResume,
	detectRerunWorkspaces,
	evaluateResumeConfidence,
	findResumeTimestamp,
	formatResumeConfidenceIndicator,
	getPostResumeEvents,
	type ResumeConfidenceResult,
} from "../src/core/resume-confidence.js";
import { type WorkspaceQueue, WorkspaceStage } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal PlanState for testing. */
function makePlanState(overrides: Partial<PlanState> = {}): PlanState {
	return {
		phase: "test",
		title: "Test Plan",
		workspaces: new Map(),
		startedAt: 1000,
		status: "running",
		...overrides,
	};
}

/** Create a basic test workspace queue. */
function makeTestQueue(): WorkspaceQueue {
	return {
		phase: "test",
		title: "Test Plan",
		workspaces: [
			{ id: "ws1", title: "WS 1", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "ws2", title: "WS 2", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		],
		maxParallelWorkspaces: 2,
	};
}

// ---------------------------------------------------------------------------
// findResumeTimestamp
// ---------------------------------------------------------------------------

describe("findResumeTimestamp", () => {
	it("returns 0 for empty events array", () => {
		expect(findResumeTimestamp([])).toBe(0);
	});

	it("returns 0 when no plan_resumed event exists", () => {
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_paused" as const, timestamp: 2000 },
		];
		expect(findResumeTimestamp(events)).toBe(0);
	});

	it("returns timestamp of the first plan_resumed event", () => {
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_paused" as const, timestamp: 2000 },
			{ type: "plan_resumed" as const, timestamp: 3000 },
		];
		expect(findResumeTimestamp(events)).toBe(3000);
	});

	it("returns the most recent plan_resumed timestamp when multiple exist", () => {
		const events = [
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "plan_paused" as const, timestamp: 4000 },
			{ type: "plan_resumed" as const, timestamp: 5000 },
		];
		expect(findResumeTimestamp(events)).toBe(5000);
	});
});

// ---------------------------------------------------------------------------
// countEventsAfterResume
// ---------------------------------------------------------------------------

describe("countEventsAfterResume", () => {
	it("returns 0 when resume timestamp is 0 (never resumed)", () => {
		const events = [{ type: "plan_start" as const, timestamp: 1000 }];
		expect(countEventsAfterResume(events, 0)).toBe(0);
	});

	it("counts events with timestamp strictly after resume", () => {
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3100, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: 3200, workspaceId: "ws1" },
		];
		expect(countEventsAfterResume(events, 3000)).toBe(2);
	});

	it("counts events that appear after plan_resumed in journal order", () => {
		const events = [
			{ type: "plan_paused" as const, timestamp: 3000 },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3000, workspaceId: "ws1" },
		];
		// workspace_start appears after plan_resumed in journal order
		expect(countEventsAfterResume(events, 3000)).toBe(1);
	});

	it("does not count events before plan_resumed in journal order", () => {
		const events = [
			{ type: "workspace_start" as const, timestamp: 3000, workspaceId: "ws1" },
			{ type: "plan_resumed" as const, timestamp: 3000 },
		];
		// workspace_start appears BEFORE plan_resumed in journal order, so not counted
		expect(countEventsAfterResume(events, 3000)).toBe(0);
	});

	it("returns 0 for empty events array", () => {
		expect(countEventsAfterResume([], 3000)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// getPostResumeEvents
// ---------------------------------------------------------------------------

describe("getPostResumeEvents", () => {
	it("returns empty array when no plan_resumed event exists", () => {
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_paused" as const, timestamp: 2000 },
		];
		expect(getPostResumeEvents(events)).toEqual([]);
	});

	it("returns events after the last plan_resumed event", () => {
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_resumed" as const, timestamp: 2000 },
			{ type: "workspace_start" as const, timestamp: 2100, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: 2200, workspaceId: "ws1" },
		];
		const postResume = getPostResumeEvents(events);
		expect(postResume).toHaveLength(2);
		expect(postResume[0].type).toBe("workspace_start");
		expect(postResume[1].type).toBe("workspace_complete");
	});

	it("returns empty array when plan_resumed is the last event", () => {
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_resumed" as const, timestamp: 2000 },
		];
		expect(getPostResumeEvents(events)).toEqual([]);
	});

	it("uses the last plan_resumed event when multiple exist", () => {
		const events = [
			{ type: "plan_resumed" as const, timestamp: 2000 },
			{ type: "workspace_start" as const, timestamp: 2100, workspaceId: "ws1" },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3100, workspaceId: "ws2" },
		];
		const postResume = getPostResumeEvents(events);
		expect(postResume).toHaveLength(1);
		expect(postResume[0].workspaceId).toBe("ws2");
	});

	it("handles same-millisecond events correctly by journal ordering", () => {
		const events = [
			{ type: "plan_paused" as const, timestamp: 3000 },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3000, workspaceId: "ws1" },
		];
		const postResume = getPostResumeEvents(events);
		expect(postResume).toHaveLength(1);
		expect(postResume[0].type).toBe("workspace_start");
	});
});

// ---------------------------------------------------------------------------
// detectRerunWorkspaces
// ---------------------------------------------------------------------------

describe("detectRerunWorkspaces", () => {
	it("returns empty array when never resumed", () => {
		const plan = makePlanState();
		const events: Array<{ type: "workspace_complete" | "workspace_start"; timestamp: number; workspaceId: string }> =
			[];
		expect(detectRerunWorkspaces(plan, events, 0)).toEqual([]);
	});

	it("returns empty array when no completed workspace is re-running", () => {
		const plan = makePlanState({
			workspaces: new Map([
				["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Complete, attempts: 1 }],
				["ws2", { workspaceId: "ws2", stage: WorkspaceStage.Active, attempts: 1 }],
			]),
		});
		// ws2 was never completed, ws1 completed but not re-started after resume
		const events = [
			{ type: "workspace_start" as const, timestamp: 1000, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: 2000, workspaceId: "ws1" },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3100, workspaceId: "ws2" },
		];
		expect(detectRerunWorkspaces(plan, events, 3000)).toEqual([]);
	});

	it("detects workspace that completed then was started again after resume", () => {
		const plan = makePlanState({
			workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Active, attempts: 2 }]]),
		});
		const events = [
			{ type: "workspace_start" as const, timestamp: 1000, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: 2000, workspaceId: "ws1" },
			{ type: "plan_paused" as const, timestamp: 2500 },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3100, workspaceId: "ws1" },
		];
		expect(detectRerunWorkspaces(plan, events, 3000)).toEqual(["ws1"]);
	});

	it("does not flag completed workspace that is not currently active", () => {
		const plan = makePlanState({
			workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Complete, attempts: 1 }]]),
		});
		const events = [
			{ type: "workspace_complete" as const, timestamp: 2000, workspaceId: "ws1" },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3100, workspaceId: "ws1" },
		];
		// ws1 completed previously, started after resume, but already completed again
		expect(detectRerunWorkspaces(plan, events, 3000)).toEqual([]);
	});

	it("detects multiple rerun workspaces", () => {
		const plan = makePlanState({
			workspaces: new Map([
				["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Active, attempts: 2 }],
				["ws2", { workspaceId: "ws2", stage: WorkspaceStage.Active, attempts: 2 }],
			]),
		});
		const events = [
			{ type: "workspace_complete" as const, timestamp: 2000, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: 2100, workspaceId: "ws2" },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3100, workspaceId: "ws1" },
			{ type: "workspace_start" as const, timestamp: 3200, workspaceId: "ws2" },
		];
		const result = detectRerunWorkspaces(plan, events, 3000);
		expect(result).toContain("ws1");
		expect(result).toContain("ws2");
		expect(result).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// evaluateResumeConfidence
// ---------------------------------------------------------------------------

describe("evaluateResumeConfidence", () => {
	it("returns nominal when plan has never been resumed", () => {
		const plan = makePlanState();
		const events = [{ type: "plan_start" as const, timestamp: 1000 }];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("nominal");
		expect(result.resumedAt).toBe(0);
		expect(result.newEventCount).toBe(0);
		expect(result.hasStallWarning).toBe(false);
		expect(result.hasRerunWarning).toBe(false);
		expect(result.summary).toBe("Plan has not been resumed");
	});

	it("returns nominal when recently resumed with no events yet (within threshold)", () => {
		const plan = makePlanState();
		const resumeTime = Date.now() - 10_000; // 10 seconds ago
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_resumed" as const, timestamp: resumeTime },
		];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("nominal");
		expect(result.resumedAt).toBe(resumeTime);
		expect(result.newEventCount).toBe(0);
		expect(result.hasStallWarning).toBe(false);
	});

	it("returns progressing when events occurred after resume", () => {
		const plan = makePlanState();
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_resumed" as const, timestamp: 2000 },
			{ type: "workspace_start" as const, timestamp: 2100, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: 2200, workspaceId: "ws1" },
		];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("progressing");
		expect(result.resumedAt).toBe(2000);
		expect(result.newEventCount).toBe(2);
		expect(result.hasStallWarning).toBe(false);
		expect(result.hasRerunWarning).toBe(false);
		expect(result.summary).toContain("2 new event(s)");
	});

	it("returns stalled when no events after resume beyond threshold", () => {
		const plan = makePlanState();
		const stallThreshold = 5000; // 5 seconds for testing
		const resumeTime = Date.now() - 10_000; // 10 seconds ago
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_resumed" as const, timestamp: resumeTime },
		];
		const result = evaluateResumeConfidence(plan, events, { stallThresholdMs: stallThreshold });
		expect(result.state).toBe("stalled");
		expect(result.resumedAt).toBe(resumeTime);
		expect(result.newEventCount).toBe(0);
		expect(result.hasStallWarning).toBe(true);
		expect(result.hasRerunWarning).toBe(false);
		expect(result.summary).toContain("STALLED");
	});

	it("returns unsafe when a completed workspace appears to rerun", () => {
		const plan = makePlanState({
			workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Active, attempts: 2 }]]),
		});
		const events = [
			{ type: "workspace_start" as const, timestamp: 1000, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: 2000, workspaceId: "ws1" },
			{ type: "plan_resumed" as const, timestamp: 3000 },
			{ type: "workspace_start" as const, timestamp: 3100, workspaceId: "ws1" },
		];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("unsafe");
		expect(result.resumedAt).toBe(3000);
		expect(result.hasRerunWarning).toBe(true);
		expect(result.hasStallWarning).toBe(false);
		expect(result.rerunWorkspaceIds).toContain("ws1");
		expect(result.summary).toContain("UNSAFE");
	});

	it("unsafe takes priority over stalled", () => {
		const plan = makePlanState({
			workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Active, attempts: 2 }]]),
		});
		const stallThreshold = 1000;
		const resumeTime = Date.now() - 5000;
		const events = [
			{ type: "workspace_complete" as const, timestamp: 1000, workspaceId: "ws1" },
			{ type: "plan_resumed" as const, timestamp: resumeTime },
			{ type: "workspace_start" as const, timestamp: resumeTime + 100, workspaceId: "ws1" },
		];
		const result = evaluateResumeConfidence(plan, events, { stallThresholdMs: stallThreshold });
		expect(result.state).toBe("unsafe");
		expect(result.hasRerunWarning).toBe(true);
	});

	it("returns nominal when resumed within threshold even with default config", () => {
		const plan = makePlanState();
		const resumeTime = Date.now() - 1000; // 1 second ago
		const events = [{ type: "plan_resumed" as const, timestamp: resumeTime }];
		const result = evaluateResumeConfidence(plan, events);
		// Default threshold is 60s, 1s is within that
		expect(result.state).toBe("nominal");
		expect(result.hasStallWarning).toBe(false);
	});

	it("returns stalled with default 60s threshold when resume was over 60s ago", () => {
		const plan = makePlanState();
		const resumeTime = Date.now() - 61_000; // 61 seconds ago
		const events = [{ type: "plan_resumed" as const, timestamp: resumeTime }];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("stalled");
		expect(result.hasStallWarning).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// formatResumeConfidenceIndicator
// ---------------------------------------------------------------------------

describe("formatResumeConfidenceIndicator", () => {
	it("returns empty array when plan was never resumed", () => {
		const result: ResumeConfidenceResult = {
			state: "nominal",
			resumedAt: 0,
			newEventCount: 0,
			hasStallWarning: false,
			hasRerunWarning: false,
			rerunWorkspaceIds: [],
			summary: "Plan has not been resumed",
		};
		expect(formatResumeConfidenceIndicator(result, false)).toEqual([]);
		expect(formatResumeConfidenceIndicator(result, true)).toEqual([]);
	});

	it("shows resume timestamp and event count", () => {
		const result: ResumeConfidenceResult = {
			state: "progressing",
			resumedAt: 1705000000000,
			newEventCount: 5,
			hasStallWarning: false,
			hasRerunWarning: false,
			rerunWorkspaceIds: [],
			summary: "Resumed — progressing",
		};
		const lines = formatResumeConfidenceIndicator(result, false);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines[0]).toContain("5 new events");
	});

	it("includes stall warning line when flagged", () => {
		const result: ResumeConfidenceResult = {
			state: "stalled",
			resumedAt: 1705000000000,
			newEventCount: 0,
			hasStallWarning: true,
			hasRerunWarning: false,
			rerunWorkspaceIds: [],
			summary: "STALLED",
		};
		const lines = formatResumeConfidenceIndicator(result, false);
		const stallLine = lines.find((l) => l.includes("STALLED"));
		expect(stallLine).toBeDefined();
	});

	it("includes rerun warning line when flagged", () => {
		const result: ResumeConfidenceResult = {
			state: "unsafe",
			resumedAt: 1705000000000,
			newEventCount: 1,
			hasStallWarning: false,
			hasRerunWarning: true,
			rerunWorkspaceIds: ["ws1", "ws2"],
			summary: "UNSAFE",
		};
		const lines = formatResumeConfidenceIndicator(result, false);
		const rerunLine = lines.find((l) => l.includes("RERUN"));
		expect(rerunLine).toBeDefined();
		expect(rerunLine).toContain("ws1, ws2");
	});
});

// ---------------------------------------------------------------------------
// Integration with PlanStateStore
// ---------------------------------------------------------------------------

describe("PlanStateStore resume confidence integration", () => {
	let tempDir: string;
	let stateStore: PlanStateStore;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "resume-confidence-test-"));
		stateStore = new PlanStateStore(tempDir);
		await stateStore.initializeState(makeTestQueue());
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("tracks resumedAt timestamp when resumePlan is called", async () => {
		await stateStore.pausePlan();
		await stateStore.resumePlan();

		const state = stateStore.getState();
		expect(state?.resumedAt).toBeDefined();
		expect(state!.resumedAt!).toBeGreaterThan(0);
	});

	it("journal records plan_resumed event after resume", async () => {
		await stateStore.pausePlan();
		await stateStore.resumePlan();

		const journal = await stateStore.readJournal();
		const resumeEvent = journal.find((e) => e.type === "plan_resumed");
		expect(resumeEvent).toBeDefined();
		expect(resumeEvent!.timestamp).toBeGreaterThan(0);
	});

	it("evaluateResumeConfidence works with real PlanStateStore data", async () => {
		// Simulate a pause-resume cycle
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Complete);
		await stateStore.pausePlan();
		await stateStore.resumePlan();

		// Read state and journal
		const state = stateStore.getState()!;
		const journal = await stateStore.readJournal();

		const result = evaluateResumeConfidence(state, journal);
		expect(result.resumedAt).toBeGreaterThan(0);
		expect(["progressing", "nominal", "stalled", "unsafe"]).toContain(result.state);
	});

	it("detects progressing state after resume with new workspace events", async () => {
		// Complete ws1, then pause, then resume and start ws2
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Complete);
		await stateStore.pausePlan();
		await stateStore.resumePlan();
		await stateStore.transitionWorkspace("ws2", WorkspaceStage.Active);

		const state = stateStore.getState()!;
		const journal = await stateStore.readJournal();

		const result = evaluateResumeConfidence(state, journal);
		expect(result.state).toBe("progressing");
		expect(result.newEventCount).toBeGreaterThan(0);
	});

	it("detects stalled state when no new events after resume and beyond threshold", async () => {
		await stateStore.pausePlan();
		await stateStore.resumePlan();

		const state = stateStore.getState()!;
		const journal = await stateStore.readJournal();

		// Use a very short threshold to trigger stall immediately
		const result = evaluateResumeConfidence(state, journal, { stallThresholdMs: 0 });
		expect(result.state).toBe("stalled");
		expect(result.hasStallWarning).toBe(true);
	});

	it("detects unsafe state when completed workspace restarts after resume", async () => {
		// Complete ws1, pause, resume, then restart ws1
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Complete);
		await stateStore.pausePlan();
		await stateStore.resumePlan();
		// Re-start ws1 (should trigger unsafe)
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);

		const state = stateStore.getState()!;
		const journal = await stateStore.readJournal();

		const result = evaluateResumeConfidence(state, journal);
		expect(result.state).toBe("unsafe");
		expect(result.hasRerunWarning).toBe(true);
		expect(result.rerunWorkspaceIds).toContain("ws1");
	});
});

// ---------------------------------------------------------------------------
// All four confidence states
// ---------------------------------------------------------------------------

describe("all four resume confidence states", () => {
	it("progressing: new events after resume", () => {
		const now = Date.now();
		const plan = makePlanState();
		const events = [
			{ type: "plan_start" as const, timestamp: now - 5000 },
			{ type: "plan_paused" as const, timestamp: now - 4000 },
			{ type: "plan_resumed" as const, timestamp: now - 3000 },
			{ type: "workspace_start" as const, timestamp: now - 2000, workspaceId: "ws1" },
		];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("progressing");
		expect(result.newEventCount).toBe(1);
		expect(result.hasStallWarning).toBe(false);
		expect(result.hasRerunWarning).toBe(false);
	});

	it("nominal: resumed recently, no new events yet", () => {
		const now = Date.now();
		const plan = makePlanState();
		const events = [{ type: "plan_resumed" as const, timestamp: now - 1000 }];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("nominal");
		expect(result.newEventCount).toBe(0);
		expect(result.hasStallWarning).toBe(false);
	});

	it("stalled: no new events after threshold", () => {
		const now = Date.now();
		const plan = makePlanState();
		const events = [{ type: "plan_resumed" as const, timestamp: now - 100_000 }];
		const result = evaluateResumeConfidence(plan, events, { stallThresholdMs: 50_000 });
		expect(result.state).toBe("stalled");
		expect(result.hasStallWarning).toBe(true);
		expect(result.hasRerunWarning).toBe(false);
	});

	it("unsafe: completed workspace reruns after resume", () => {
		const now = Date.now();
		const plan = makePlanState({
			workspaces: new Map([["ws1", { workspaceId: "ws1", stage: WorkspaceStage.Active, attempts: 2 }]]),
		});
		const events = [
			{ type: "workspace_start" as const, timestamp: now - 5000, workspaceId: "ws1" },
			{ type: "workspace_complete" as const, timestamp: now - 4000, workspaceId: "ws1" },
			{ type: "plan_resumed" as const, timestamp: now - 3000 },
			{ type: "workspace_start" as const, timestamp: now - 2000, workspaceId: "ws1" },
		];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("unsafe");
		expect(result.hasRerunWarning).toBe(true);
		expect(result.hasStallWarning).toBe(false);
		expect(result.rerunWorkspaceIds).toEqual(["ws1"]);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("handles empty events array", () => {
		const plan = makePlanState();
		const result = evaluateResumeConfidence(plan, []);
		expect(result.state).toBe("nominal");
		expect(result.resumedAt).toBe(0);
	});

	it("handles plan with no workspaces", () => {
		const plan = makePlanState({ workspaces: new Map() });
		const events = [{ type: "plan_resumed" as const, timestamp: Date.now() - 1000 }];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("nominal");
		expect(result.rerunWorkspaceIds).toEqual([]);
	});

	it("handles multiple resume events (uses latest)", () => {
		const now = Date.now();
		const plan = makePlanState();
		const events = [
			{ type: "plan_resumed" as const, timestamp: now - 60_000 },
			{ type: "plan_paused" as const, timestamp: now - 50_000 },
			{ type: "plan_resumed" as const, timestamp: now - 1000 },
			{ type: "workspace_start" as const, timestamp: now - 500, workspaceId: "ws1" },
		];
		const result = evaluateResumeConfidence(plan, events);
		// Should use the second resume timestamp
		expect(result.resumedAt).toBe(now - 1000);
		expect(result.newEventCount).toBe(1);
		expect(result.state).toBe("progressing");
	});

	it("custom stallThresholdMs is respected", () => {
		const now = Date.now();
		const plan = makePlanState();
		// Resumed 2 seconds ago, threshold 5 seconds — nominal
		const events = [{ type: "plan_resumed" as const, timestamp: now - 2000 }];
		let result = evaluateResumeConfidence(plan, events, { stallThresholdMs: 5000 });
		expect(result.state).toBe("nominal");
		expect(result.hasStallWarning).toBe(false);

		// Resumed 2 seconds ago, threshold 1 second — stalled
		result = evaluateResumeConfidence(plan, events, { stallThresholdMs: 1000 });
		expect(result.state).toBe("stalled");
		expect(result.hasStallWarning).toBe(true);
	});

	it("zero stallThresholdMs makes any resume with no events immediately stalled", () => {
		const now = Date.now();
		const plan = makePlanState();
		const events = [{ type: "plan_resumed" as const, timestamp: now }];
		const result = evaluateResumeConfidence(plan, events, { stallThresholdMs: 0 });
		expect(result.state).toBe("stalled");
	});

	it("handles cancelled plan that was never resumed", () => {
		const plan = makePlanState({ status: "cancelled" });
		const events = [
			{ type: "plan_start" as const, timestamp: 1000 },
			{ type: "plan_cancelled" as const, timestamp: 2000 },
		];
		const result = evaluateResumeConfidence(plan, events);
		expect(result.state).toBe("nominal");
		expect(result.resumedAt).toBe(0);
	});
});
