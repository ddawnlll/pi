import { describe, expect, it, vi } from "vitest";
import { HandoffQueue } from "../../src/execution-kernel/handoff-queue.js";

function createMockDb() {
	return {
		insertInto: vi.fn(() => ({
			values: vi.fn(() => ({
				execute: vi.fn(async () => {}),
			})),
		})),
	};
}

describe("HandoffQueue", () => {
	it("creates a required handoff entry", async () => {
		const db = createMockDb();
		const queue = new HandoffQueue(db as any);

		await queue.createRequired("att-1", "plan-1", "ws-1", "needs approval");

		expect(db.insertInto).toHaveBeenCalledWith("handoff_queue");
	});

	it("stores reason in handoff entry", async () => {
		const db = createMockDb();
		let capturedValues: Record<string, unknown> | null = null;
		db.insertInto = vi.fn(() => ({
			values: vi.fn((vals: Record<string, unknown>) => {
				capturedValues = vals;
				return {
					execute: vi.fn(async () => {}),
				};
			}),
		}));
		const queue = new HandoffQueue(db as any);

		await queue.createRequired("att-1", "plan-1", "ws-1", "needs user input");

		expect((capturedValues as unknown as Record<string, unknown>)?.reason).toBe("needs user input");
		expect((capturedValues as unknown as Record<string, unknown>)?.status).toBe("pending");
		expect((capturedValues as unknown as Record<string, unknown>)?.required).toBe(true);
	});

	it("generates unique id for each entry", async () => {
		const db = createMockDb();
		const captured: string[] = [];
		db.insertInto = vi.fn(() => ({
			values: vi.fn((vals: Record<string, unknown>) => {
				captured.push(vals.id as unknown as string);
				return {
					execute: vi.fn(async () => {}),
				};
			}),
		}));
		const queue = new HandoffQueue(db as any);

		await queue.createRequired("att-1", "plan-1", "ws-1", "reason 1");
		await queue.createRequired("att-2", "plan-2", "ws-2", "reason 2");

		expect(captured[0]).not.toBe(captured[1]);
	});
});
