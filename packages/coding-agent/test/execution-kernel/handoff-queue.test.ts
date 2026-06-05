import { describe, expect, it, vi } from "vitest";
import { HandoffQueue } from "../../src/execution-kernel/handoff-queue.js";

function createMockDb(existingHandoffs: Array<Record<string, unknown>> = []) {
	// Build a chainable query mock
	const createWhereChain = (executeResult: any) => {
		const chain: any = {
			where: vi.fn(() => chain),
			executeTakeFirst: vi.fn(async () => executeResult),
			execute: vi.fn(async () => existingHandoffs),
		};
		return chain;
	};

	return {
		selectFrom: vi.fn(() => ({
			selectAll: vi.fn(() => createWhereChain(existingHandoffs.find((h: any) => h.status === "pending") ?? null)),
		})),
		insertInto: vi.fn(() => ({
			values: vi.fn(() => ({
				execute: vi.fn(async () => {}),
			})),
		})),
		updateTable: vi.fn(() => {
			const chain: any = {
				set: vi.fn(() => chain),
				where: vi.fn(() => chain),
				execute: vi.fn(async () => ({ numUpdatedRows: 1n })),
			};
			return chain;
		}),
	};
}

describe("HandoffQueue", () => {
	it("createRequired creates a handoff entry", async () => {
		const db = createMockDb();
		const queue = new HandoffQueue(db as any);

		const result = await queue.createRequired("att-1", "plan-1", "ws-1", "needs review");

		expect(db.insertInto).toHaveBeenCalledWith("handoff_queue");
		expect(result.deduped).toBe(false);
		expect(result.id).toBeDefined();
	});

	it("createRequired dedupes existing unresolved handoff with same attempt/reason", async () => {
		const db = createMockDb([
			{
				id: "existing-1",
				attempt_id: "att-1",
				reason: "needs review",
				status: "pending",
			},
		]);
		const queue = new HandoffQueue(db as any);

		const result = await queue.createRequired("att-1", "plan-1", "ws-1", "needs review");

		// Should NOT have called insertInto (deduped)
		expect(db.insertInto).not.toHaveBeenCalled();
		expect(result.deduped).toBe(true);
		expect(result.id).toBe("existing-1");
	});

	it("listPending returns unresolved handoffs", async () => {
		const db = createMockDb([
			{
				id: "h-1",
				attempt_id: "att-1",
				plan_execution_id: "plan-1",
				workspace_execution_id: "ws-1",
				status: "pending",
				reason: "needs review",
				required: true,
				expires_at: new Date(Date.now() + 3600000).toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			},
		]);
		const queue = new HandoffQueue(db as any);

		const pending = await queue.listPending();

		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe("pending");
	});

	it("resolve marks handoff resolved", async () => {
		const db = createMockDb();
		const queue = new HandoffQueue(db as any);

		const result = await queue.resolve("h-1", "review approved");

		expect(db.updateTable).toHaveBeenCalledWith("handoff_queue");
		expect(result.resolved).toBe(true);
	});

	it("reject marks handoff rejected", async () => {
		const db = createMockDb();
		const queue = new HandoffQueue(db as any);

		const result = await queue.reject("h-1", "changes required");

		expect(db.updateTable).toHaveBeenCalledWith("handoff_queue");
		expect(result.rejected).toBe(true);
	});

	it("expireTimedOut marks old handoffs as expired", async () => {
		const expiredHandoffs = [
			{
				id: "h-1",
				attempt_id: "att-1",
				plan_execution_id: "plan-1",
				workspace_execution_id: "ws-1",
				status: "pending",
				reason: "needs review",
				required: true,
				expires_at: new Date(Date.now() - 5000).toISOString(),
				created_at: new Date(Date.now() - 3600000).toISOString(),
				updated_at: new Date(Date.now() - 3600000).toISOString(),
			},
		];
		const db = {
			selectFrom: vi.fn(() => ({
				selectAll: vi.fn(() => ({
					where: vi.fn(() => ({
						where: vi.fn(() => ({
							execute: vi.fn(async () => expiredHandoffs),
						})),
					})),
				})),
			})),
			insertInto: vi.fn(() => ({
				values: vi.fn(() => ({
					execute: vi.fn(async () => {}),
				})),
			})),
			updateTable: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						where: vi.fn(() => ({
							execute: vi.fn(async () => ({ numUpdatedRows: 1n })),
						})),
					})),
				})),
			})),
		};
		const queue = new HandoffQueue(db as any);

		const expired = await queue.expireTimedOut();

		expect(expired).toHaveLength(1);
		expect(expired[0].id).toBe("h-1");
		expect(db.updateTable).toHaveBeenCalled();
	});

	it("expireTimedOut returns empty when no handoffs are expired", async () => {
		const db = {
			selectFrom: vi.fn(() => ({
				selectAll: vi.fn(() => ({
					where: vi.fn(() => ({
						where: vi.fn(() => ({
							execute: vi.fn(async () => []), // no pending
						})),
					})),
				})),
			})),
			insertInto: vi.fn(() => ({
				values: vi.fn(() => ({
					execute: vi.fn(async () => {}),
				})),
			})),
			updateTable: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						where: vi.fn(() => ({
							execute: vi.fn(async () => ({ numUpdatedRows: 1n })),
						})),
					})),
				})),
			})),
		};
		const queue = new HandoffQueue(db as any);

		const expired = await queue.expireTimedOut();

		expect(expired).toHaveLength(0);
	});

	it("timeout policy is configurable", () => {
		const db = createMockDb();
		const queue = new HandoffQueue(db as any, { timeoutMs: 5000, onTimeout: "mark_failed_final" });

		const policy = queue.getTimeoutPolicy();
		expect(policy.timeoutMs).toBe(5000);
		expect(policy.onTimeout).toBe("mark_failed_final");
	});

	it("default timeout policy is 24h and mark_failed_retryable", () => {
		const db = createMockDb();
		const queue = new HandoffQueue(db as any);

		const policy = queue.getTimeoutPolicy();
		expect(policy.timeoutMs).toBe(24 * 60 * 60 * 1000);
		expect(policy.onTimeout).toBe("mark_failed_retryable");
	});
});
