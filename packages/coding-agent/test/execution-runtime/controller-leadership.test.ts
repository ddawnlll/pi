import { describe, expect, it, vi } from "vitest";
import { ControllerLeadership } from "../../src/execution-runtime/controller-leadership.js";

function createMockDb(override?: { lease?: Record<string, unknown> | null }) {
	const lease = override?.lease ?? null;
	return {
		selectFrom: vi.fn(() => ({
			selectAll: vi.fn(() => ({
				where: vi.fn(() => ({
					executeTakeFirst: vi.fn(async () => lease),
				})),
			})),
		})),
	};
}

describe("ControllerLeadership", () => {
	it("executes function when no existing lease", async () => {
		const db = createMockDb({ lease: null });
		const leadership = new ControllerLeadership(db as any, "controller-1");

		const result = await leadership.withAttemptLock("att-1", async () => "done");
		expect(result).toBe("done");
	});

	it("executes function when lease belongs to this controller", async () => {
		const db = createMockDb({
			lease: {
				attempt_id: "att-1",
				controller_id: "controller-1",
				lease_expires_at: new Date(Date.now() + 60000).toISOString(),
			},
		});
		const leadership = new ControllerLeadership(db as any, "controller-1");

		const result = await leadership.withAttemptLock("att-1", async () => "done");
		expect(result).toBe("done");
	});

	it("throws controller_conflict when lease held by another controller", async () => {
		const db = createMockDb({
			lease: {
				attempt_id: "att-1",
				controller_id: "controller-other",
				lease_expires_at: new Date(Date.now() + 60000).toISOString(),
			},
		});
		const leadership = new ControllerLeadership(db as any, "controller-1");

		await expect(leadership.withAttemptLock("att-1", async () => "done")).rejects.toThrow("controller_conflict");
	});

	it("allows execution when lease is expired", async () => {
		const db = createMockDb({
			lease: {
				attempt_id: "att-1",
				controller_id: "controller-other",
				lease_expires_at: new Date(Date.now() - 60000).toISOString(),
			},
		});
		const leadership = new ControllerLeadership(db as any, "controller-1");

		const result = await leadership.withAttemptLock("att-1", async () => "done");
		expect(result).toBe("done");
	});
});
