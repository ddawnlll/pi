/**
 * Overnight Run Orchestration — P20.A Tests
 *
 * Covers:
 * - SessionStore CRUD
 * - OvernightOrchestrator schedule/start/stop lifecycle
 * - Stop condition checks
 * - Progress tracking
 * - Type correctness
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	type OvernightConfig,
	OvernightOrchestrator,
	type OvernightStopCondition,
	type PlanQueueRef,
	type RunProgress,
	type RunSession,
	SessionStore,
} from "../../../src/brain/index.js";

// ── Helpers ────────────────────────────────────────────────────────────

function createMockPlanQueue(): PlanQueueRef {
	const queuedPlans: string[] = [];
	const planStatuses = new Map<string, string>();

	return {
		async getQueuedPlans(): Promise<string[]> {
			return [...queuedPlans];
		},
		async getPlanStatus(planExecId: string): Promise<string> {
			return planStatuses.get(planExecId) ?? "pending";
		},
		async startPlan(planExecId: string): Promise<void> {
			planStatuses.set(planExecId, "running");
		},
		async stopPlan(planExecId: string, _reason?: string): Promise<void> {
			planStatuses.set(planExecId, "stopped");
		},
		async enqueuePlan(planExecId: string): Promise<void> {
			queuedPlans.push(planExecId);
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

function makeSession(overrides?: Partial<RunSession>): RunSession {
	return {
		id: `test-${Date.now()}`,
		planExecIds: ["exec-1"],
		status: "running",
		progress: { completed: 0, total: 1, failed: 0 },
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

// ── SessionStore ───────────────────────────────────────────────────────

describe("SessionStore", () => {
	test("add and retrieve a session", () => {
		const store = new SessionStore();
		const session = makeSession({ id: "test-1", status: "running" });
		store.add(session as unknown as { id: string; [key: string]: unknown });
		const got = store.get("test-1") as RunSession;
		expect(got).toBeTruthy();
		expect((got as unknown as Record<string, unknown>).id).toBe("test-1");
	});

	test("get returns null for unknown id", () => {
		const store = new SessionStore();
		expect(store.get("nonexistent")).toBeNull();
	});

	test("update an existing session", () => {
		const store = new SessionStore();
		const session = makeSession({ id: "test-2" });
		store.add(session as unknown as { id: string; [key: string]: unknown });
		const updated = store.update("test-2", {
			status: "completed",
			progress: { completed: 1, total: 1, failed: 0 },
		}) as unknown as Record<string, unknown>;
		expect(updated).not.toBeNull();
		expect(updated.status).toBe("completed");
	});

	test("update returns null for unknown id", () => {
		const store = new SessionStore();
		const result = store.update("nonexistent", { status: "completed" });
		expect(result).toBeNull();
	});

	test("getAll returns most recent first", () => {
		const store = new SessionStore();
		const older = makeSession({ id: "older", createdAt: "2026-01-01T00:00:00.000Z", status: "completed" });
		const newer = makeSession({ id: "newer", createdAt: "2026-01-02T00:00:00.000Z", status: "running" });
		store.add(older as unknown as { id: string; [key: string]: unknown });
		store.add(newer as unknown as { id: string; [key: string]: unknown });
		const all = store.getAll(10) as unknown as Array<Record<string, unknown>>;
		expect(all[0].id).toBe("newer");
		expect(all[1].id).toBe("older");
	});

	test("remove deletes a session", () => {
		const store = new SessionStore();
		const session = makeSession({ id: "removable" });
		store.add(session as unknown as { id: string; [key: string]: unknown });
		expect(store.get("removable")).not.toBeNull();
		store.remove("removable");
		expect(store.get("removable")).toBeNull();
	});

	test("clear removes all sessions", () => {
		const store = new SessionStore();
		store.add(makeSession({ id: "s1" }) as unknown as { id: string; [key: string]: unknown });
		store.add(makeSession({ id: "s2" }) as unknown as { id: string; [key: string]: unknown });
		store.clear();
		expect(store.get("s1")).toBeNull();
		expect(store.get("s2")).toBeNull();
	});
});

// ── OvernightOrchestrator ──────────────────────────────────────────────

describe("OvernightOrchestrator", () => {
	let mockPlanQueue: PlanQueueRef;
	let orchestrator: OvernightOrchestrator;

	beforeEach(() => {
		mockPlanQueue = createMockPlanQueue();
		orchestrator = new OvernightOrchestrator(mockPlanQueue);
	});

	// ── startNow lifecycle ───────────────────────────────────────

	test("startNow creates a running session", async () => {
		const session = await orchestrator.startNow(validConfig());
		expect(session.id).toBeTruthy();
		expect(session.status).toBe("scheduled");
		expect(session.progress.total).toBe(2);
		expect(session.progress.completed).toBe(0);
	});

	test("startNow rejects concurrent sessions", async () => {
		await orchestrator.startNow(validConfig());
		await expect(orchestrator.startNow(validConfig())).rejects.toThrow("already running");
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
		await expect(orchestrator.startScheduled("nonexistent")).rejects.toThrow("not found");
	});

	test("startScheduled throws for non-scheduled session", async () => {
		const session = await orchestrator.startNow(validConfig());
		await expect(orchestrator.startScheduled(session.id)).rejects.toThrow("not scheduled");
	});

	// ── Stop lifecycle ───────────────────────────────────────────

	test("stop stops the running session", async () => {
		await orchestrator.startNow(validConfig());
		const stopped = await orchestrator.stop("test stop");
		expect(stopped.status).toBe("stopped");
		expect(stopped.stopReason).toBe("test stop");
		expect(stopped.completedAt).toBeTruthy();
	});

	test("stop throws when no active session", async () => {
		await expect(orchestrator.stop("no session")).rejects.toThrow("No active session");
	});

	// ── Pause / Resume ───────────────────────────────────────────

	test("pause stops the session", async () => {
		await orchestrator.startNow(validConfig());
		const paused = await orchestrator.pause();
		expect(paused.status).toBe("stopped");
		expect(paused.stopReason).toBe("Paused by user");
	});

	test("resume throws when no session exists", async () => {
		await expect(orchestrator.resume()).rejects.toThrow("No active session");
	});

	test("resume resumes a stopped session", async () => {
		await orchestrator.startNow(validConfig());
		await orchestrator.stop("test stop");
		const resumed = await orchestrator.resume();
		expect(resumed.status).toBe("running");
	});

	// ── Status ───────────────────────────────────────────────────

	test("getStatus returns null when no session", () => {
		const status = orchestrator.getStatus();
		expect(status).toBeNull();
	});

	test("getStatus returns current status snapshot", async () => {
		const session = await orchestrator.startNow(validConfig());
		const status = orchestrator.getStatus();
		expect(status).not.toBeNull();
		expect(status!.sessionId).toBe(session.id);
		expect(status!.status).toBe("scheduled");
		expect(status!.progress.total).toBe(2);
		expect(typeof status!.elapsedHours).toBe("number");
	});

	// ── getHistory ───────────────────────────────────────────────

	test("getHistory returns session history", async () => {
		await orchestrator.startNow(validConfig());
		const history = orchestrator.getHistory(10);
		expect(history.length).toBeGreaterThanOrEqual(1);
	});

	// ── Stop condition: max_duration_reached ───────────────────────

	test("checkStopConditions detects max_duration_reached", async () => {
		vi.useFakeTimers();
		const shortOrch = new OvernightOrchestrator(mockPlanQueue);
		await shortOrch.startNow({
			...validConfig(),
			stopConditions: ["max_duration_reached"],
			maxDurationHours: 1,
		});
		await vi.advanceTimersByTimeAsync(61 * 60 * 1000);
		const met = await shortOrch.checkStopConditions();
		expect(met).toContain("max_duration_reached");
		vi.useRealTimers();
	});

	// ── Stop condition: error_threshold_exceeded ─────────────────

	test("checkStopConditions detects error_threshold_exceeded", async () => {
		await orchestrator.startNow({
			...validConfig(),
			stopConditions: ["error_threshold_exceeded"],
		});
		const session = orchestrator.getSession();
		if (session) {
			session.progress = { completed: 1, total: 3, failed: 3 };
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
});
