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
		updateTable: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					execute: vi.fn(async () => ({ numUpdatedRows: 1n })),
				})),
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

	// =======================================================================
	// Original inbox-only tests (backward compatibility)
	// =======================================================================

	it("scans and emits deadline_exceeded for expired non-terminal attempts", async () => {
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "RUNNING",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "inbox_only",
			inboxEnabled: true,
		});

		const results = await watchdog.scan();

		expect(db.insertInto).toHaveBeenCalledWith("controller_inbox");
		expect(results).toHaveLength(1);
		expect(results[0].action).toBe("inbox_only");
	});

	it("does not emit for attempts without deadline", async () => {
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "RUNNING",
					current_deadline_at: null,
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "inbox_only",
		});

		const results = await watchdog.scan();

		expect(db.insertInto).not.toHaveBeenCalled();
		expect(results).toHaveLength(1);
	});

	it("does not emit for attempts with future deadline", async () => {
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "RUNNING",
					current_deadline_at: new Date(Date.now() + 60000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "inbox_only",
		});

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
							current_state: "RUNNING",
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
			updateTable: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						execute: vi.fn(async () => ({ numUpdatedRows: 1n })),
					})),
				})),
			})),
		};

		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "inbox_only", // inbox-only mode still writes inbox
			inboxEnabled: true,
		});

		await watchdog.scan();

		expect(capturedValues).not.toBeNull();
		expect(capturedValues!.dedupe_key).toBe("deadline_exceeded:att-1:2");
	});

	it("start/stop lifecycle works", () => {
		const db = createMockDb({ attempts: [] });
		const watchdog = new DeadlineWatchdog(db as any, { scanIntervalMs: 100 });

		watchdog.start();
		expect((watchdog as unknown as { timer: ReturnType<typeof setInterval> }).timer).not.toBeNull();

		watchdog.stop();
		expect((watchdog as unknown as { timer: ReturnType<typeof setInterval> }).timer).toBeNull();
	});

	it("periodically scans when started", async () => {
		const db = createMockDb({ attempts: [] });
		const watchdog = new DeadlineWatchdog(db as any, { scanIntervalMs: 100 });

		const scanSpy = vi.spyOn(watchdog, "scan");

		watchdog.start();
		vi.advanceTimersByTime(250);
		watchdog.stop();

		expect(scanSpy).toHaveBeenCalledTimes(2); // at 100ms and 200ms
	});

	// =======================================================================
	// Recovery tests (new)
	// =======================================================================

	it("expired RUNNING attempt triggers recovery with mark_failed_retryable mode", async () => {
		const transitioner = {
			markDeadlineExceeded: vi.fn(async () => ({ transitioned: true })),
		};
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "RUNNING",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "mark_failed_retryable",
			transitioner,
			inboxEnabled: false,
		});

		const results = await watchdog.scan();

		expect(transitioner.markDeadlineExceeded).toHaveBeenCalledTimes(1);
		expect(transitioner.markDeadlineExceeded).toHaveBeenCalledWith({
			attemptId: "att-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
			currentState: "RUNNING",
			reason: "deadline_exceeded:RUNNING",
		});
		expect(results[0].recovered).toBe(true);
		expect(results[0].action).toBe("marked_failed_retryable");
		expect(results[0].toState).toBe("FAILED_RETRYABLE");
	});

	it("expired RUNNING attempt calls processAborter in act_and_mark_failed_retryable mode", async () => {
		const processAborter = {
			abortAttempt: vi.fn(async () => ({ aborted: true })),
		};
		const transitioner = {
			markDeadlineExceeded: vi.fn(async () => ({ transitioned: true })),
		};
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "RUNNING",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "act_and_mark_failed_retryable",
			processAborter,
			transitioner,
			inboxEnabled: false,
		});

		const results = await watchdog.scan();

		expect(processAborter.abortAttempt).toHaveBeenCalledTimes(1);
		expect(processAborter.abortAttempt).toHaveBeenCalledWith({
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
			attemptId: "att-1",
			reason: "deadline_exceeded",
		});
		expect(transitioner.markDeadlineExceeded).toHaveBeenCalledTimes(1);
		expect(results[0].action).toBe("acted_and_marked_failed_retryable");
		expect(results[0].processAborted).toBe(true);
	});

	it("terminal SUCCEEDED attempt is ignored", async () => {
		const transitioner = {
			markDeadlineExceeded: vi.fn(async () => ({ transitioned: true })),
		};
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "SUCCEEDED",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "act_and_mark_failed_retryable",
			transitioner,
			inboxEnabled: false,
		});

		const results = await watchdog.scan();

		expect(transitioner.markDeadlineExceeded).not.toHaveBeenCalled();
		expect(results[0].action).toBe("ignored_terminal");
	});

	it("recovery is idempotent across repeated scans", async () => {
		const transitioner = {
			markDeadlineExceeded: vi.fn(async () => ({ transitioned: true })),
		};
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "FAILED_RETRYABLE",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 2,
				},
			],
		});

		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "mark_failed_retryable",
			transitioner,
			inboxEnabled: false,
		});

		// Scan once
		await watchdog.scan();
		// Scan again (attempt is now FAILED_RETRYABLE, which is not in RECOVERABLE_STATES)
		const results = await watchdog.scan();

		// Transitioner should NOT have been called (FAILED_RETRYABLE is not recoverable)
		expect(transitioner.markDeadlineExceeded).toHaveBeenCalledTimes(0);
		// Second scan result should be inbox_only (FAILED_RETRYABLE is not RECOVERABLE_STATES)
		expect(results[0].recovered).toBe(false);
		expect(results[0].action).toBe("inbox_only");
	});

	it("process abort failure does not crash scan", async () => {
		const processAborter = {
			abortAttempt: vi.fn(async () => {
				throw new Error("process abort failed");
			}),
		};
		const transitioner = {
			markDeadlineExceeded: vi.fn(async () => ({ transitioned: true })),
		};
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "RUNNING",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "act_and_mark_failed_retryable",
			processAborter,
			transitioner,
			inboxEnabled: false,
		});

		// Should not throw
		const results = await watchdog.scan();

		// Transitioner should still be called even though abort failed
		expect(transitioner.markDeadlineExceeded).toHaveBeenCalledTimes(1);
		expect(results[0].recovered).toBe(true);
	});

	it("deadline inbox audit is still written when inboxEnabled", async () => {
		const transitioner = {
			markDeadlineExceeded: vi.fn(async () => ({ transitioned: true })),
		};
		const db = createMockDb({
			attempts: [
				{
					id: "att-1",
					plan_execution_id: "plan-1",
					workspace_execution_id: "ws-1",
					current_state: "RUNNING",
					current_deadline_at: new Date(Date.now() - 5000).toISOString(),
					version: 1,
				},
			],
		});
		const watchdog = new DeadlineWatchdog(db as any, {
			scanIntervalMs: 60000,
			recoveryMode: "mark_failed_retryable",
			transitioner,
			inboxEnabled: true,
		});

		await watchdog.scan();

		// Both recovery and inbox write should have happened
		expect(transitioner.markDeadlineExceeded).toHaveBeenCalledTimes(1);
		expect(db.insertInto).toHaveBeenCalled();
	});

	it("default recovery mode is act_and_mark_failed_retryable (P44 safe)", () => {
		const db = createMockDb({ attempts: [] });
		const watchdog = new DeadlineWatchdog(db as any);
		expect((watchdog as unknown as { config: { recoveryMode: string } }).config.recoveryMode).toBe(
			"act_and_mark_failed_retryable",
		);
	});
});
