import { describe, expect, it, vi } from "vitest";
import { AttemptEventJournal } from "../../src/execution-kernel/attempt-event-journal.js";
import type { AttemptEventType } from "../../src/execution-kernel/types.js";

function createMockDb() {
	let capturedValues: Record<string, unknown> | null = null;
	return {
		insertInto: vi.fn(() => ({
			values: vi.fn((vals: Record<string, unknown>) => {
				capturedValues = vals;
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
		getCapturedValues: () => capturedValues,
	};
}

describe("AttemptEventJournal", () => {
	it("appends an event", async () => {
		const db = createMockDb();
		const journal = new AttemptEventJournal(db as any);

		await journal.append({
			eventId: "evt-1",
			attemptId: "att-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
			eventType: "attempt_started" as AttemptEventType,
			eventVersion: 1,
			payload: { foo: "bar" },
		});

		expect(db.insertInto).toHaveBeenCalledWith("attempt_events");
	});

	it("lists events by attempt", async () => {
		const db = createMockDb();
		const journal = new AttemptEventJournal(db as any);

		await journal.listByAttempt("att-1");

		expect(db.selectFrom).toHaveBeenCalledWith("attempt_events");
	});

	it("handles idempotent append", async () => {
		const db = createMockDb();
		const journal = new AttemptEventJournal(db as any);

		await journal.append({
			eventId: "evt-1",
			attemptId: "att-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
			eventType: "attempt_started" as AttemptEventType,
			eventVersion: 1,
		});

		// Second append with same eventId should not throw
		await expect(
			journal.append({
				eventId: "evt-1",
				attemptId: "att-1",
				planExecutionId: "plan-1",
				workspaceExecutionId: "ws-1",
				eventType: "attempt_started" as AttemptEventType,
				eventVersion: 1,
			}),
		).resolves.not.toThrow();
	});

	it("includes event_version in append", async () => {
		let capturedValues: Record<string, unknown> | null = null;
		const db = {
			insertInto: vi.fn(() => ({
				values: vi.fn((vals: Record<string, unknown>) => {
					capturedValues = vals;
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
		};

		const journal = new AttemptEventJournal(db as any);

		await journal.append({
			eventId: "evt-2",
			attemptId: "att-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
			eventType: "attempt_progressed" as AttemptEventType,
			eventVersion: 2,
		});

		expect((capturedValues as unknown as Record<string, unknown>)?.event_version).toBe(2);
	});
});
