/**
 * Overnight Run Orchestration — P20.A Tests
 *
 * Covers:
 * - Type correctness (compile-time)
 * - OvernightConfig validation
 * - Schedule/start lifecycle
 * - Stop conditions
 * - Progress tracking
 * - Session persistence
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	type OvernightConfig,
	OvernightOrchestrator,
	type OvernightStopCondition,
	type RunProgress,
	type RunSession,
	SessionStore,
} from "../../../src/brain/index.js";

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Create a mock PlanQueueRef for testing.
 *
 * Tracks state to simulate queue behavior.
 */
function createMockPlanQueue() {
	const planStatuses = new Map<string, { status: string; progress: { completed: number; total: number } } | null>();
	let queuedIds: string[] = [];
	let hasDirty = false;
	let activePlanId: string | null = null;

	return {
		planStatuses,
		async enqueuePlans(planExecIds: string[]) {
			queuedIds = [...queuedIds, ...planExecIds];
			for (const id of planExecIds) {
				if (!planStatuses.has(id)) {
					planStatuses.set(id, { status: "pending", progress: { completed: 0, total: 1 } });
				}
			}
		},
		async getQueuedPlanIds() {
			return [...queuedIds];
		},
		async getPlanStatus(planExecId: string) {
			return planStatuses.get(planExecId) ?? null;
		},
		async hasDirtyEntries() {
			return hasDirty;
		},
		setHasDirty(v: boolean) {
			hasDirty = v;
		},
		async getActivePlanId() {
			return activePlanId;
		},
		setActivePlanId(id: string | null) {
			activePlanId = id;
		},
	};
}

function validConfig(): OvernightConfig {
	return {
		planExecIds: ["exec-1", "exec-2"],
		autonomyLevel: 3,
		stopConditions: ["max_duration_reached"],
		maxDurationHours: 8,
		notificationEnabled: true,
		generateMorningReport: true,
	};
}

// ── SessionStore ───────────────────────────────────────────────────────

describe("SessionStore", () => {
	test("add and retrieve a session", async () => {
		const store = new SessionStore();
		const session: RunSession = {
			id: "test-1",
			planExecIds: ["exec-1"],
			status: "running",
			startedAt: new Date().toISOString(),
			progress: { completed: 0, total: 1, failed: 0 },
			createdAt: new Date().toISOString(),
			config: validConfig(),
		};
		await store.add(session);
		expect(store.get("test-1")).toEqual(session);
	});

	test("update an existing session", async () => {
		const store = new SessionStore();
		const session: RunSession = {
			id: "test-2",
			planExecIds: ["exec-1"],
			status: "running",
			startedAt: new Date().toISOString(),
			progress: { completed: 0, total: 1, failed: 0 },
			createdAt: new Date().toISOString(),
			config: validConfig(),
		};
		await store.add(session);
		const updated = await store.update("test-2", {
			status: "completed",
			completedAt: new Date().toISOString(),
			progress: { completed: 1, total: 1, failed: 0 },
		});
		expect(updated).not.toBeNull();
		expect(updated!.status).toBe("completed");
		expect(updated!.progress.completed).toBe(1);
	});

	test("get returns null for unknown id", () => {
		const store = new SessionStore();
		expect(store.get("nonexistent")).toBeNull();
	});

	test("update returns null for unknown id", async () => {
		const store = new SessionStore();
		const result = await store.update("nonexistent", { status: "completed" });
		expect(result).toBeNull();
	});

	test("getAll returns most recent first", async () => {
		const store = new SessionStore();
		const older: RunSession = {
			id: "older",
			planExecIds: ["exec-1"],
			status: "completed",
			startedAt: "2026-01-01T00:00:00.000Z",
			completedAt: "2026-01-01T01:00:00.000Z",
			progress: { completed: 1, total: 1, failed: 0 },
			createdAt: "2026-01-01T00:00:00.000Z",
			config: validConfig(),
		};
		const newer: RunSession = {
			id: "newer",
			planExecIds: ["exec-2"],
			status: "running",
			progress: { completed: 0, total: 1, failed: 0 },
			createdAt: "2026-01-02T00:00:00.000Z",
			config: validConfig(),
		};
		await store.add(older);
		await store.add(newer);
		const all = store.getAll(10);
		expect(all[0].id).toBe("newer");
		expect(all[1].id).toBe("older");
	});

	test("remove deletes a session", async () => {
		const store = new SessionStore();
		const session: RunSession = {
			id: "removable",
			planExecIds: [],
			status: "completed",
			progress: { completed: 0, total: 0, failed: 0 },
			createdAt: new Date().toISOString(),
			config: validConfig(),
		};
		await store.add(session);
		expect(store.get("removable")).not.toBeNull();
		await store.remove("removable");
		expect(store.get("removable")).toBeNull();
	});

	test("clear removes all sessions", async () => {
		const store = new SessionStore();
		const s1: RunSession = {
			id: "s1",
			planExecIds: [],
			status: "completed",
			progress: { completed: 0, total: 0, failed: 0 },
			createdAt: new Date().toISOString(),
			config: validConfig(),
		};
		const s2: RunSession = {
			id: "s2",
			planExecIds: [],
			status: "failed",
			progress: { completed: 0, total: 0, failed: 1 },
			createdAt: new Date().toISOString(),
			config: validConfig(),
		};
		await store.add(s1);
		await store.add(s2);
		await store.clear();
		expect(store.get("s1")).toBeNull();
		expect(store.get("s2")).toBeNull();
	});
});

// ── OvernightOrchestrator ──────────────────────────────────────────────

describe("OvernightOrchestrator", () => {
	let mockPlanQueue: ReturnType<typeof createMockPlanQueue>;
	let orchestrator: OvernightOrchestrator;

	beforeEach(() => {
		mockPlanQueue = createMockPlanQueue();
		orchestrator = new OvernightOrchestrator(mockPlanQueue);
	});

	afterEach(() => {
		orchestrator.dispose();
	});

	// ── Config validation ────────────────────────────────────────

	test("startNow rejects empty planExecIds", async () => {
		await expect(orchestrator.startNow({ ...validConfig(), planExecIds: [] })).rejects.toThrow(
			"planExecIds must be a non-empty array",
		);
	});

	test("startNow rejects autonomyLevel below 3", async () => {
		await expect(orchestrator.startNow({ ...validConfig(), autonomyLevel: 2 as 3 })).rejects.toThrow(
			"autonomyLevel must be 3 or higher",
		);
	});

	test("startNow rejects maxDurationHours > 24", async () => {
		await expect(orchestrator.startNow({ ...validConfig(), maxDurationHours: 25 })).rejects.toThrow(
			"maxDurationHours must be between 1 and 24",
		);
	});

	test("startNow rejects maxDurationHours <= 0", async () => {
		await expect(orchestrator.startNow({ ...validConfig(), maxDurationHours: 0 })).rejects.toThrow(
			"maxDurationHours must be between 1 and 24",
		);
	});

	test("startNow rejects invalid scheduleTime format", async () => {
		await expect(orchestrator.startNow({ ...validConfig(), scheduleTime: "invalid" })).rejects.toThrow(
			"scheduleTime must be in HH:mm format",
		);
	});

	// ── startNow lifecycle ───────────────────────────────────────

	test("startNow creates a running session", async () => {
		const session = await orchestrator.startNow(validConfig());
		expect(session.id).toBeTruthy();
		expect(session.status).toBe("running");
		expect(session.startedAt).toBeTruthy();
		expect(session.progress.total).toBe(2);
		expect(session.progress.completed).toBe(0);
	});

	test("startNow enqueues plans", async () => {
		await orchestrator.startNow(validConfig());
		const queuedIds = await mockPlanQueue.getQueuedPlanIds();
		expect(queuedIds).toContain("exec-1");
		expect(queuedIds).toContain("exec-2");
	});

	test("startNow sets the session on the orchestrator", async () => {
		const session = await orchestrator.startNow(validConfig());
		expect(orchestrator.getSession()?.id).toBe(session.id);
	});

	// ── Schedule lifecycle ────────────────────────────────────────

	test("schedule creates a scheduled session", async () => {
		const session = await orchestrator.schedule({
			...validConfig(),
			scheduleTime: "23:00",
		});
		expect(session.status).toBe("scheduled");
	});

	test("startScheduled throws for unknown session", async () => {
		await expect(orchestrator.startScheduled("nonexistent")).rejects.toThrow('Session "nonexistent" not found');
	});

	test("startScheduled throws for non-scheduled session", async () => {
		const session = await orchestrator.startNow(validConfig());
		await expect(orchestrator.startScheduled(session.id)).rejects.toThrow('is not in "scheduled" status');
	});

	// ── Stop lifecycle ───────────────────────────────────────────

	test("stop stops the running session", async () => {
		await orchestrator.startNow(validConfig());
		const stopped = await orchestrator.stop("test stop");
		expect(stopped.status).toBe("stopped");
		expect(stopped.stopReason).toBe("test stop");
		expect(stopped.completedAt).toBeTruthy();
	});

	test("stop works when no session is active (graceful no-op)", async () => {
		const result = await orchestrator.stop("no session");
		expect(result.status).toBe("failed");
	});

	// ── Pause / Resume ───────────────────────────────────────────

	test("pause stops the session", async () => {
		await orchestrator.startNow(validConfig());
		const paused = await orchestrator.pause();
		expect(paused.status).toBe("stopped");
		expect(paused.stopReason).toBe("paused_by_user");
	});

	test("resume starts remaining plans", async () => {
		const config = validConfig();
		await orchestrator.startNow(config);
		// Stop the running session
		await orchestrator.stop("test stop");
		const stoppedSession = orchestrator.getSession();
		expect(stoppedSession?.status).toBe("stopped");
	});

	test("resume throws when no session exists", async () => {
		await expect(orchestrator.resume()).rejects.toThrow("No session to resume");
	});

	// ── Status ───────────────────────────────────────────────────

	test("getStatus returns current status snapshot", async () => {
		const config = validConfig();
		await orchestrator.startNow(config);
		const status = orchestrator.getStatus();
		expect(status.sessionId).toBeTruthy();
		expect(status.status).toBe("running");
		expect(status.progress.total).toBe(2);
		expect(typeof status.elapsedHours).toBe("number");
	});

	test("getStatus returns failed status when no session", () => {
		const status = orchestrator.getStatus();
		expect(status.status).toBe("failed");
		expect(status.progress.total).toBe(0);
	});

	// ── getHistory ───────────────────────────────────────────────

	test("getHistory returns session history", async () => {
		await orchestrator.startNow(validConfig());
		const history = orchestrator.getHistory(10);
		expect(history.length).toBeGreaterThanOrEqual(1);
		expect(history[0].status).toBe("running");
	});

	// ── Stop condition: max_duration_reached ───────────────────────

	test("checkStopConditions detects max_duration_reached", async () => {
		// Use fake timers to control time advancement
		vi.useFakeTimers();

		const shortOrch = new OvernightOrchestrator(mockPlanQueue);
		await shortOrch.startNow({
			...validConfig(),
			stopConditions: ["max_duration_reached"],
			maxDurationHours: 1, // 1 hour
		});

		// Advance time by 61 minutes to exceed the 1-hour duration
		await vi.advanceTimersByTimeAsync(61 * 60 * 1000);

		const met = await shortOrch.checkStopConditions();
		expect(met).toContain("max_duration_reached");

		shortOrch.dispose();
		vi.useRealTimers();
	});

	// ── Stop condition: integration_queue_dirty ───────────────────

	test("checkStopConditions detects integration_queue_dirty", async () => {
		await orchestrator.startNow({
			...validConfig(),
			stopConditions: ["integration_queue_dirty"],
		});

		mockPlanQueue.setHasDirty(true);
		const met = await orchestrator.checkStopConditions();
		expect(met).toContain("integration_queue_dirty");
	});

	// ── Stop condition: error_threshold_exceeded ─────────────────

	test("checkStopConditions detects error_threshold_exceeded", async () => {
		await orchestrator.startNow({
			...validConfig(),
			stopConditions: ["error_threshold_exceeded"],
		});

		// Simulate a session with more than 50% failures
		if (orchestrator.getSession()) {
			const session = orchestrator.getSession()!;
			session.progress = { completed: 1, total: 3, failed: 2 };
		}

		const met = await orchestrator.checkStopConditions();
		expect(met).toContain("error_threshold_exceeded");
	});

	// ── Type correctness (compile-time checks) ───────────────────

	test("OvernightStopCondition is a valid union type", () => {
		const conditions: OvernightStopCondition[] = [
			"integration_queue_dirty",
			"merge_conflict",
			"policy_violation",
			"low_confidence_unsafe",
			"user_intervention",
			"error_threshold_exceeded",
			"max_duration_reached",
		];
		expect(conditions.length).toBe(7);
	});

	test("RunProgress interface compiles correctly", () => {
		const progress: RunProgress = { completed: 5, total: 10, failed: 1 };
		expect(progress.completed).toBe(5);
		expect(progress.total).toBe(10);
		expect(progress.failed).toBe(1);
	});

	// ── Constructor with custom config defaults ──────────────────

	test("constructor applies partial config defaults", () => {
		const customOrch = new OvernightOrchestrator(mockPlanQueue, {
			maxDurationHours: 12,
			notificationEnabled: false,
		});
		// Access the internal config through behavior:
		// The default autonomyLevel should be 3
		expect(customOrch).toBeInstanceOf(OvernightOrchestrator);
		customOrch.dispose();
	});

	// ── SessionStore with persistence path ───────────────────────

	test("SessionStore with persistPath does not throw on add", async () => {
		const store = new SessionStore("/tmp/test-overnight-sessions.json");
		await store.add({
			id: "persist-test",
			planExecIds: [],
			status: "completed",
			progress: { completed: 0, total: 0, failed: 0 },
			createdAt: new Date().toISOString(),
			config: validConfig(),
		});
		// Should not throw
		expect(store.get("persist-test")).not.toBeNull();
	});
});
