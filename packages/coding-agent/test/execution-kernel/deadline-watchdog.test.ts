import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadlineWatchdog } from "../../src/execution-kernel/deadline-watchdog.js";

function createMockDb(options?: { attempts?: Array<Record<string, unknown>> }) {
	const attempts = options?.attempts ?? [];
	return {
		selectFrom: vi.fn(() => ({
			selectAll: vi.fn(() => ({
				execute: vi.fn(async () => attempts),
			})),
		})),
		insertInto: vi.fn(() => ({
			values: vi.fn(() => ({
				onConflict: vi.fn((_cb: (oc: any) => any) => ({
					execute: vi.fn(async () => {}),
				})),
				execute: vi.fn(async () => {}),
			})),
		})),
	};
}

describe("DeadlineWatchdog", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("scans and emits deadline_exceeded for expired non-terminal attempts", async () => {
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, 60000);

		await watchdog.scan();

		expect(db.insertInto).toHaveBeenCalledWith("controller_inbox");
	});

	it("does not emit for attempts without deadline", async () => {
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_deadline_at: null,
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, 60000);

		await watchdog.scan();

		expect(db.insertInto).not.toHaveBeenCalled();
	});

	it("does not emit for attempts with future deadline", async () => {
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_deadline_at: new Date(Date.now() + 60000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, 60000);

		await watchdog.scan();

		expect(db.insertInto).not.toHaveBeenCalled();
	});

	it("uses dedupe_key for idempotent deadline events", async () => {
		let capturedValues: Record<string, unknown> | null = null;
		const db = {
			selectFrom: vi.fn(() => ({
				selectAll: vi.fn(() => ({
					execute: vi.fn(async () => [
						{
							id: "att-1",
							plan_execution_id: "plan-1",
							workspace_execution_id: "ws-1",
							current_deadline_at: new Date(Date.now() - 5000).toISOString(),
							version: 2,
						},
					]),
				})),
			})),
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
		};

		const watchdog = new DeadlineWatchdog(db as any, 60000);

		await watchdog.scan();

		expect((capturedValues as unknown as Record<string, unknown>)?.dedupe_key).toBe("deadline:att-1:2");
		expect((capturedValues as unknown as Record<string, unknown>)?.message_type).toBe("deadline_exceeded");
	});

	it("start/stop lifecycle works", () => {
		const db = createMockDb();
		const watchdog = new DeadlineWatchdog(db as any, 60000);

		expect(() => watchdog.start()).not.toThrow();
		expect(() => watchdog.start()).not.toThrow(); // double start is safe
		expect(() => watchdog.stop()).not.toThrow();
		expect(() => watchdog.stop()).not.toThrow(); // double stop is safe
	});

	it("periodically scans when started", async () => {
		const db = createMockDb();
		const watchdog = new DeadlineWatchdog(db as any, 100);
		const scanSpy = vi.spyOn(watchdog, "scan");

		watchdog.start();
		vi.advanceTimersByTime(250);
		watchdog.stop();

		expect(scanSpy).toHaveBeenCalledTimes(2); // at 100ms and 200ms
	});
});
