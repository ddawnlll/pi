import { describe, expect, it, vi } from "vitest";
import { ReplayComparator } from "../../src/execution-kernel/replay-comparator.js";

function createMockDb() {
	return {
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
						execute: vi.fn(async () => []),
					})),
				})),
			})),
		})),
	};
}

describe("ReplayComparator", () => {
	it("returns null replay when no events exist", async () => {
		const db = createMockDb() as any;
		const comparator = new ReplayComparator(db);

		const result = await comparator.replay("shadow:ws:missing");

		expect(result).toBeNull();
	});

	it("replays events through FSM and computes final state", async () => {
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
								{
									seq: "2",
									event_id: "shadow:shadow:ws:ws-1:2:attempt_succeeded",
									attempt_id: "shadow:ws:ws-1",
									plan_execution_id: "plan-1",
									workspace_execution_id: "ws-exec-1",
									event_type: "attempt_succeeded",
									event_version: 2,
									payload: { _shadow: true },
									created_at: "2024-01-01T00:01:00Z",
								},
							]),
						})),
					})),
				})),
			})),
		} as any;
		const comparator = new ReplayComparator(db);

		const result = await comparator.replay("shadow:ws:ws-1");

		expect(result).not.toBeNull();
		expect(result!.replayedState).toBe("SUCCEEDED");
		expect(result!.replayedVersion).toBe(2);
		expect(result!.eventCount).toBe(2);
	});

	it("replays workspace transition through multiple states", async () => {
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
								{
									seq: "2",
									event_id: "shadow:shadow:ws:ws-1:2:attempt_blocked",
									attempt_id: "shadow:ws:ws-1",
									plan_execution_id: "plan-1",
									workspace_execution_id: "ws-exec-1",
									event_type: "attempt_blocked",
									event_version: 2,
									payload: { _shadow: true },
									created_at: "2024-01-01T00:05:00Z",
								},
								{
									seq: "3",
									event_id: "shadow:shadow:ws:ws-1:3:attempt_failed",
									attempt_id: "shadow:ws:ws-1",
									plan_execution_id: "plan-1",
									workspace_execution_id: "ws-exec-1",
									event_type: "attempt_failed",
									event_version: 3,
									payload: { _shadow: true },
									created_at: "2024-01-01T00:10:00Z",
								},
							]),
						})),
					})),
				})),
			})),
		} as any;
		const comparator = new ReplayComparator(db);

		const result = await comparator.replay("shadow:ws:ws-1");

		expect(result).not.toBeNull();
		expect(result!.replayedState).toBe("FAILED_FINAL");
		expect(result!.eventCount).toBe(3);
	});

	it("derives state from latest meaningful event", async () => {
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
									event_id: "shadow:shadow:ws:ws-1:1:attempt_succeeded",
									attempt_id: "shadow:ws:ws-1",
									plan_execution_id: "plan-1",
									workspace_execution_id: "ws-exec-1",
									event_type: "attempt_succeeded",
									event_version: 1,
									payload: { _shadow: true },
									created_at: "2024-01-01T00:00:00Z",
								},
								// The latest meaningful event determines the state,
								// even if it would be illegal as a strict FSM transition
								{
									seq: "2",
									event_id: "shadow:shadow:ws:ws-1:2:legacy_state_write_detected",
									attempt_id: "shadow:ws:ws-1",
									plan_execution_id: "plan-1",
									workspace_execution_id: "ws-exec-1",
									event_type: "legacy_state_write_detected",
									event_version: 2,
									payload: { _shadow: true },
									created_at: "2024-01-01T00:01:00Z",
								},
							]),
						})),
					})),
				})),
			})),
		} as any;
		const comparator = new ReplayComparator(db);

		const result = await comparator.replay("shadow:ws:ws-1");

		// SUCCEEDED because that's the latest meaningful event
		// (legacy_state_write_detected returns null from deriveState)
		expect(result).not.toBeNull();
		expect(result!.replayedState).toBe("SUCCEEDED");
		expect(result!.eventCount).toBe(2);
	});

	it("compares plan execution with matching state", async () => {
		const db = {
			insertInto: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflict: vi.fn(() => ({
						execute: vi.fn(async () => {}),
					})),
					execute: vi.fn(async () => {}),
				})),
			})),
			selectFrom: vi.fn((table: string) => ({
				select: vi.fn(() => ({
					where: vi.fn(() => ({
						executeTakeFirst: vi.fn(async () => {
							if (table === "attempt_events") {
								return null;
							}
							return { status: "running" };
						}),
					})),
				})),
				selectAll: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							execute: vi.fn(async () => []),
						})),
					})),
				})),
			})),
		} as any;
		const comparator = new ReplayComparator(db);

		const result = await comparator.comparePlanExecution("plan-1");

		expect(result.diverged).toBe(true);
		expect(result.replayed).toBeNull();
		expect(result.legacy).toEqual({ status: "running" });
	});

	it("compares workspace execution with matching state", async () => {
		const db = {
			insertInto: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflict: vi.fn(() => ({
						execute: vi.fn(async () => {}),
					})),
					execute: vi.fn(async () => {}),
				})),
			})),
			selectFrom: vi.fn((table: string) => ({
				select: vi.fn(() => ({
					where: vi.fn(() => ({
						executeTakeFirst: vi.fn(async () => {
							if (table === "workspace_executions") {
								return { stage: "complete", attempts: 2 };
							}
							return { status: "complete" };
						}),
					})),
				})),
				selectAll: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							execute: vi.fn(async () => []),
						})),
					})),
				})),
			})),
		} as any;
		const comparator = new ReplayComparator(db);

		const result = await comparator.compareWorkspaceExecution("ws-exec-1");

		expect(result.diverged).toBe(true);
		expect(result.replayed).toBeNull();
		expect(result.legacy).toEqual({ stage: "complete", attempts: 2 });
	});
});
