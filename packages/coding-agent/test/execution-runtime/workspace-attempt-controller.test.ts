import { describe, expect, it, vi } from "vitest";
import { WorkspaceAttemptController } from "../../src/execution-runtime/workspace-attempt-controller.js";

function createMockAttempt(overrides: Record<string, unknown> = {}) {
	return {
		id: "att-1",
		workspace_execution_id: "ws-1",
		plan_execution_id: "plan-1",
		project_id: "proj-1",
		current_state: "PENDING",
		version: 1,
		current_deadline_at: null,
		metadata: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

function createMockDb(options?: { attempt?: Record<string, unknown> | null; numUpdatedRows?: bigint }) {
	const attempt = options && "attempt" in options ? options.attempt : createMockAttempt();
	const numUpdated = options?.numUpdatedRows ?? 1n;

	const insertIntoChain = {
		values: vi.fn(() => ({
			onConflict: vi.fn((_cb: (oc: any) => any) => ({
				execute: vi.fn(async () => {}),
			})),
			execute: vi.fn(async () => {}),
		})),
	};

	return {
		selectFrom: vi.fn(() => ({
			selectAll: vi.fn(() => ({
				where: vi.fn(() => ({
					executeTakeFirst: vi.fn(async () => attempt),
				})),
			})),
		})),
		updateTable: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					where: vi.fn(() => ({
						executeTakeFirst: vi.fn(async () => ({
							numUpdatedRows: numUpdated,
						})),
					})),
				})),
			})),
		})),
		insertInto: vi.fn(() => insertIntoChain),
	};
}

describe("WorkspaceAttemptController", () => {
	it("loads attempt on handleEvent", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "PENDING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await controller.handleEvent("att-1", "attempt_started", {});

		expect(db.selectFrom).toHaveBeenCalledWith("attempts");
	});

	it("rejects event for non-existent attempt", async () => {
		const db = createMockDb({ attempt: null });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-404", "succeeded", {})).rejects.toThrow("Attempt not found");
	});

	it("rejects unknown events before journaling", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "RUNNING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-1", "unknown_event" as never, {})).rejects.toThrow(
			"Unknown attempt event: unknown_event",
		);
		expect(db.insertInto).not.toHaveBeenCalled();
	});

	it("rejects retry before terminal state", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "RUNNING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-1", "retry", {})).rejects.toThrow("Retry before terminal");
	});

	it("allows retry from FAILED_RETRYABLE", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "FAILED_RETRYABLE" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-1", "retry", {})).resolves.not.toThrow();
	});

	it("rejects illegal transition", async () => {
		// PENDING -> SUCCEEDED is illegal
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "PENDING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-1", "succeeded", {})).rejects.toThrow("Illegal attempt transition");
	});

	it("creates handoff_queue row for HANDOFF_REQUIRED", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "RUNNING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await controller.handleEvent("att-1", "handoff_required", { reason: "needs approval" });

		expect(db.insertInto).toHaveBeenCalledWith("handoff_queue");
	});

	it("rejects version conflict on transition", async () => {
		const db = createMockDb({
			attempt: createMockAttempt({ current_state: "RUNNING", version: 1 }),
			numUpdatedRows: 0n,
		});
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-1", "succeeded", {})).rejects.toThrow("version_conflict");
	});

	it("appends event after successful transition", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "RUNNING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await controller.handleEvent("att-1", "succeeded", {});

		expect(db.insertInto).toHaveBeenCalledWith("attempt_events");
	});

	it("handles succeeded from RUNNING", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "RUNNING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-1", "succeeded", {})).resolves.not.toThrow();
	});

	it("handles deadline_exceeded from RUNNING", async () => {
		const db = createMockDb({ attempt: createMockAttempt({ current_state: "RUNNING" }) });
		const controller = new WorkspaceAttemptController(db as any, "ctrl-1");

		await expect(controller.handleEvent("att-1", "deadline_exceeded", {})).resolves.not.toThrow();
	});
});
