import { describe, expect, it, vi } from "vitest";
import {
	mapPlanTransition,
	mapWorkspaceTransition,
	ShadowAttemptJournal,
} from "../../src/execution-runtime/shadow-attempt-journal.js";

function createMockDb() {
	const captured: Array<{
		table: string;
		values: Record<string, unknown>;
	}> = [];
	return {
		insertInto: vi.fn((table: string) => ({
			values: vi.fn((vals: Record<string, unknown>) => {
				captured.push({ table, values: vals });
				return {
					onConflict: vi.fn((_cb: (oc: any) => any) => ({
						execute: vi.fn(async () => {}),
					})),
					execute: vi.fn(async () => {}),
				};
			}),
		})),
		selectFrom: vi.fn(() => ({
			selectAll: vi.fn(() => ({
				where: vi.fn(() => ({
					orderBy: vi.fn(() => ({
						execute: vi.fn(async () => []),
					})),
				})),
			})),
		})),
		getCaptured: () => captured,
	};
}

describe("ShadowAttemptJournal", () => {
	it("emits legacy state write as shadow event", async () => {
		const db = createMockDb() as any;
		const journal = new ShadowAttemptJournal(db);

		await journal.emitLegacyEvent("shadow:ws:ws-exec-1", "plan-1", "ws-exec-1", "attempt_succeeded", 1, {
			legacy_stage: "complete",
		});

		expect(db.insertInto).toHaveBeenCalledWith("attempt_events");
	});

	it("includes _shadow flag in payload", async () => {
		const db = createMockDb() as any;
		const captured: any[] = [];
		db.insertInto = vi.fn(() => ({
			values: vi.fn((vals: Record<string, unknown>) => {
				captured.push(vals);
				return {
					onConflict: vi.fn(() => ({
						execute: vi.fn(async () => {}),
					})),
					execute: vi.fn(async () => {}),
				};
			}),
		}));
		const journal = new ShadowAttemptJournal(db);

		await journal.emitLegacyEvent("shadow:ws:ws-exec-1", "plan-1", "ws-exec-1", "attempt_succeeded", 1);

		expect((captured[0].payload as Record<string, unknown>)?._shadow).toBe(true);
		expect((captured[0].payload as Record<string, unknown>)?._shadow_source).toBe("legacy_state_store");
	});

	it("generates shadow attempt ID from workspace execution ID", () => {
		expect(ShadowAttemptJournal.shadowAttemptId("ws-exec-1")).toBe("shadow:ws:ws-exec-1");
	});

	it("generates shadow plan attempt ID from plan execution ID", () => {
		expect(ShadowAttemptJournal.shadowPlanAttemptId("plan-1")).toBe("shadow:plan:plan-1");
	});

	it("maps workspace stage to event type", () => {
		expect(ShadowAttemptJournal.legacyStageToEvent("pending")).toBe("attempt_started");
		expect(ShadowAttemptJournal.legacyStageToEvent("active")).toBe("attempt_started");
		expect(ShadowAttemptJournal.legacyStageToEvent("complete")).toBe("attempt_succeeded");
		expect(ShadowAttemptJournal.legacyStageToEvent("failed")).toBe("attempt_failed");
		expect(ShadowAttemptJournal.legacyStageToEvent("blocked")).toBe("attempt_blocked");
		expect(ShadowAttemptJournal.legacyStageToEvent("unknown")).toBe("legacy_state_write_detected");
	});

	it("maps plan status to event type", () => {
		expect(ShadowAttemptJournal.legacyPlanStatusToEvent("running")).toBe("attempt_progressed");
		expect(ShadowAttemptJournal.legacyPlanStatusToEvent("complete")).toBe("attempt_succeeded");
		expect(ShadowAttemptJournal.legacyPlanStatusToEvent("failed")).toBe("attempt_failed");
		expect(ShadowAttemptJournal.legacyPlanStatusToEvent("stopped")).toBe("attempt_failed");
		expect(ShadowAttemptJournal.legacyPlanStatusToEvent("cancelled")).toBe("legacy_state_write_detected");
		expect(ShadowAttemptJournal.legacyPlanStatusToEvent("awaiting_handoff")).toBe("handoff_required");
		expect(ShadowAttemptJournal.legacyPlanStatusToEvent("paused")).toBe("attempt_blocked");
	});

	it("lists shadow events in order", async () => {
		const db = {
			insertInto: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflict: vi.fn(() => ({
						execute: vi.fn(async () => {}),
					})),
					execute: vi.fn(async () => {}),
				})),
			})),
			selectFrom: vi.fn(() => ({
				selectAll: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							execute: vi.fn(async () => [
								{
									seq: "1",
									event_id: "shadow:shadow:ws:ws-1:1:attempt_started",
									attempt_id: "shadow:ws:ws-1",
									plan_execution_id: "plan-1",
									workspace_execution_id: "ws-exec-1",
									event_type: "attempt_started",
									event_version: 1,
									payload: { _shadow: true },
									created_at: "2024-01-01T00:00:00Z",
								},
							]),
						})),
					})),
				})),
			})),
		} as any;
		const journal = new ShadowAttemptJournal(db);

		const events = await journal.listShadowEvents("shadow:ws:ws-1");

		expect(events).toHaveLength(1);
		expect(events[0].eventType).toBe("attempt_started");
		expect(events[0].eventVersion).toBe(1);
	});

	it("is idempotent — same eventId does not throw", async () => {
		const db = createMockDb() as any;
		const journal = new ShadowAttemptJournal(db);

		await journal.emitLegacyEvent("shadow:ws:ws-1", "plan-1", "ws-exec-1", "attempt_succeeded", 1);
		await journal.emitLegacyEvent("shadow:ws:ws-1", "plan-1", "ws-exec-1", "attempt_succeeded", 1);

		expect(db.insertInto).toHaveBeenCalledTimes(2);
	});
});

describe("mapWorkspaceTransition", () => {
	it("returns correct attemptId and eventType for workspace stage", () => {
		const result = mapWorkspaceTransition("ws-exec-1", "plan-1", "complete");
		expect(result.attemptId).toBe("shadow:ws:ws-exec-1");
		expect(result.eventType).toBe("attempt_succeeded");
	});
});

describe("mapPlanTransition", () => {
	it("returns correct attemptId and eventType for plan status", () => {
		const result = mapPlanTransition("plan-1", "failed");
		expect(result.attemptId).toBe("shadow:plan:plan-1");
		expect(result.eventType).toBe("attempt_failed");
	});
});
