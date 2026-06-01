/**
 * Event Store tests — P41.02 Event Spine / Event Store
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EventStoreError, InMemoryEventStore } from "../src/event-store.js";
import { createExecutionEvent } from "../src/events.js";

describe("InMemoryEventStore", () => {
	let store: InMemoryEventStore;

	beforeEach(() => {
		store = new InMemoryEventStore();
	});

	// -----------------------------------------------------------------------
	// appendEvent
	// -----------------------------------------------------------------------

	describe("appendEvent", () => {
		it("should append an event and return an eventId", async () => {
			const event = createExecutionEvent("plan_started", {
				planId: "plan-1",
				planExecutionId: "exec-1",
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});

			const eventId = await store.appendEvent("exec-1", event);

			expect(eventId).toBeDefined();
			expect(typeof eventId).toBe("string");
			expect(eventId.length).toBeGreaterThan(0);
		});

		it("should store the envelope with correct fields", async () => {
			const event = createExecutionEvent("plan_started", {
				planId: "plan-1",
				planExecutionId: "exec-1",
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});

			const eventId = await store.appendEvent("exec-1", event, "ws-1");
			const envelope = await store.getEvent(eventId);

			expect(envelope).not.toBeNull();
			expect(envelope!.eventId).toBe(eventId);
			expect(envelope!.planExecutionId).toBe("exec-1");
			expect(envelope!.workspaceId).toBe("ws-1");
			expect(envelope!.eventType).toBe("plan_started");
			expect(envelope!.seq).toBe("exec-1:1");
			expect(envelope!.payload).toEqual({
				planId: "plan-1",
				planExecutionId: "exec-1",
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});
			expect(envelope!.createdAt).toBeDefined();
		});

		it("should throw if planExecutionId is empty", async () => {
			const event = createExecutionEvent("system_info", {
				message: "test",
			});

			await expect(store.appendEvent("", event)).rejects.toThrow(EventStoreError);
		});

		it("should increment seq per plan execution", async () => {
			const event1 = createExecutionEvent("plan_started", {
				planId: "plan-1",
				planExecutionId: "exec-1",
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});
			const event2 = createExecutionEvent("workspace_running", {
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				fromStage: "Pending",
				toStage: "Running",
				attemptNumber: 1,
			});

			const id1 = await store.appendEvent("exec-1", event1);
			const id2 = await store.appendEvent("exec-1", event2);

			const e1 = await store.getEvent(id1);
			const e2 = await store.getEvent(id2);

			expect(e1!.seq).toBe("exec-1:1");
			expect(e2!.seq).toBe("exec-1:2");
		});

		it("should maintain separate seq counters per plan execution", async () => {
			const event = createExecutionEvent("plan_started", {
				planId: "plan-1",
				planExecutionId: "exec-1",
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});

			const id1 = await store.appendEvent("exec-1", event);
			const id2 = await store.appendEvent("exec-2", event);

			const e1 = await store.getEvent(id1);
			const e2 = await store.getEvent(id2);

			expect(e1!.seq).toBe("exec-1:1");
			expect(e2!.seq).toBe("exec-2:1");
		});

		it("should store events without workspaceId", async () => {
			const event = createExecutionEvent("system_info", {
				message: "no workspace scope",
			});

			const eventId = await store.appendEvent("exec-1", event);
			const envelope = await store.getEvent(eventId);

			expect(envelope!.workspaceId).toBeUndefined();
		});
	});

	// -----------------------------------------------------------------------
	// queryEvents
	// -----------------------------------------------------------------------

	describe("queryEvents", () => {
		it("should return all events in insertion order", async () => {
			const e1 = createExecutionEvent("plan_started", {
				planId: "plan-1",
				planExecutionId: "exec-1",
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});
			const e2 = createExecutionEvent("workspace_running", {
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				fromStage: "Pending",
				toStage: "Running",
				attemptNumber: 1,
			});
			const e3 = createExecutionEvent("workspace_completed", {
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				fromStage: "Running",
				toStage: "Complete",
				attemptNumber: 1,
			});

			await store.appendEvent("exec-1", e1);
			await store.appendEvent("exec-1", e2);
			await store.appendEvent("exec-1", e3);

			const results = await store.queryEvents("exec-1");

			expect(results).toHaveLength(3);
			expect(results[0].eventType).toBe("plan_started");
			expect(results[1].eventType).toBe("workspace_running");
			expect(results[2].eventType).toBe("workspace_completed");
		});

		it("should return empty array for unknown plan execution", async () => {
			const results = await store.queryEvents("nonexistent");
			expect(results).toEqual([]);
		});

		it("should filter by workspaceId", async () => {
			const e1 = createExecutionEvent("workspace_running", {
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				fromStage: "Pending",
				toStage: "Running",
				attemptNumber: 1,
			});
			const e2 = createExecutionEvent("workspace_running", {
				planExecutionId: "exec-1",
				workspaceId: "ws-2",
				workspaceExecutionId: "ws-exec-2",
				fromStage: "Pending",
				toStage: "Running",
				attemptNumber: 1,
			});

			await store.appendEvent("exec-1", e1, "ws-1");
			await store.appendEvent("exec-1", e2, "ws-2");

			const results = await store.queryEvents("exec-1", { workspaceId: "ws-1" });

			expect(results).toHaveLength(1);
			expect(results[0].workspaceId).toBe("ws-1");
		});

		it("should filter by eventType", async () => {
			const e1 = createExecutionEvent("plan_started", {
				planId: "plan-1",
				planExecutionId: "exec-1",
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});
			const e2 = createExecutionEvent("workspace_running", {
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				fromStage: "Pending",
				toStage: "Running",
				attemptNumber: 1,
			});

			await store.appendEvent("exec-1", e1);
			await store.appendEvent("exec-1", e2);

			const results = await store.queryEvents("exec-1", { eventType: "plan_started" });

			expect(results).toHaveLength(1);
			expect(results[0].eventType).toBe("plan_started");
		});

		it("should apply limit and offset", async () => {
			for (let i = 1; i <= 10; i++) {
				const event = createExecutionEvent("system_info", {
					message: `event-${i}`,
					planExecutionId: "exec-1",
				});
				await store.appendEvent("exec-1", event);
			}

			// First page: 3 items
			const page1 = await store.queryEvents("exec-1", { limit: 3, offset: 0 });
			expect(page1).toHaveLength(3);
			expect(page1[0].payload!.message).toBe("event-1");
			expect(page1[2].payload!.message).toBe("event-3");

			// Second page: 3 items starting from index 3
			const page2 = await store.queryEvents("exec-1", { limit: 3, offset: 3 });
			expect(page2).toHaveLength(3);
			expect(page2[0].payload!.message).toBe("event-4");
			expect(page2[2].payload!.message).toBe("event-6");

			// Last page: partial
			const page4 = await store.queryEvents("exec-1", { limit: 3, offset: 9 });
			expect(page4).toHaveLength(1);
			expect(page4[0].payload!.message).toBe("event-10");
		});

		it("should combine filters with limit and offset", async () => {
			// Add a mix of events
			for (let i = 0; i < 5; i++) {
				await store.appendEvent(
					"exec-1",
					createExecutionEvent("workspace_running", {
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						workspaceExecutionId: `ws-exec-${i}`,
						fromStage: "Pending",
						toStage: "Running",
						attemptNumber: 1,
					}),
					"ws-1",
				);
			}
			for (let i = 0; i < 5; i++) {
				await store.appendEvent(
					"exec-1",
					createExecutionEvent("workspace_completed", {
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						workspaceExecutionId: `ws-exec-${i}`,
						fromStage: "Running",
						toStage: "Complete",
						attemptNumber: 1,
					}),
					"ws-1",
				);
			}

			const results = await store.queryEvents("exec-1", {
				workspaceId: "ws-1",
				eventType: "workspace_completed",
				limit: 2,
				offset: 1,
			});

			expect(results).toHaveLength(2);
			expect(results[0].payload!.workspaceExecutionId).toBe("ws-exec-1");
			expect(results[1].payload!.workspaceExecutionId).toBe("ws-exec-2");
		});
	});

	// -----------------------------------------------------------------------
	// getEvent
	// -----------------------------------------------------------------------

	describe("getEvent", () => {
		it("should return null for unknown eventId", async () => {
			const result = await store.getEvent("nonexistent-id");
			expect(result).toBeNull();
		});

		it("should return the correct envelope for a stored event", async () => {
			const event = createExecutionEvent("system_info", {
				message: "hello",
				planExecutionId: "exec-1",
			});

			const eventId = await store.appendEvent("exec-1", event);
			const envelope = await store.getEvent(eventId);

			expect(envelope).not.toBeNull();
			expect(envelope!.eventId).toBe(eventId);
			expect(envelope!.eventType).toBe("system_info");
			expect(envelope!.payload!.message).toBe("hello");
		});
	});

	// -----------------------------------------------------------------------
	// countEvents
	// -----------------------------------------------------------------------

	describe("countEvents", () => {
		it("should return 0 for empty plan execution", async () => {
			const count = await store.countEvents("exec-1");
			expect(count).toBe(0);
		});

		it("should return the correct count", async () => {
			for (let i = 0; i < 5; i++) {
				await store.appendEvent(
					"exec-1",
					createExecutionEvent("system_info", {
						message: `event-${i}`,
						planExecutionId: "exec-1",
					}),
				);
			}

			const count = await store.countEvents("exec-1");
			expect(count).toBe(5);
		});

		it("should count per plan execution independently", async () => {
			await store.appendEvent(
				"exec-1",
				createExecutionEvent("system_info", { message: "a", planExecutionId: "exec-1" }),
			);
			await store.appendEvent(
				"exec-2",
				createExecutionEvent("system_info", { message: "b", planExecutionId: "exec-2" }),
			);
			await store.appendEvent(
				"exec-2",
				createExecutionEvent("system_info", { message: "c", planExecutionId: "exec-2" }),
			);

			expect(await store.countEvents("exec-1")).toBe(1);
			expect(await store.countEvents("exec-2")).toBe(2);
		});
	});

	// -----------------------------------------------------------------------
	// clear
	// -----------------------------------------------------------------------

	describe("clear", () => {
		it("should remove all events", async () => {
			await store.appendEvent(
				"exec-1",
				createExecutionEvent("system_info", { message: "a", planExecutionId: "exec-1" }),
			);
			await store.appendEvent(
				"exec-2",
				createExecutionEvent("system_info", { message: "b", planExecutionId: "exec-2" }),
			);

			await store.clear();

			expect(await store.countEvents("exec-1")).toBe(0);
			expect(await store.countEvents("exec-2")).toBe(0);

			const allEvents = await store.queryEvents("exec-1");
			expect(allEvents).toEqual([]);
		});

		it("should allow re-use after clear", async () => {
			await store.appendEvent(
				"exec-1",
				createExecutionEvent("system_info", { message: "a", planExecutionId: "exec-1" }),
			);
			await store.clear();

			const eventId = await store.appendEvent(
				"exec-1",
				createExecutionEvent("system_info", { message: "b", planExecutionId: "exec-1" }),
			);

			const envelope = await store.getEvent(eventId);
			expect(envelope!.seq).toBe("exec-1:1");
			expect(await store.countEvents("exec-1")).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// Integration with createExecutionEvent
	// -----------------------------------------------------------------------

	describe("integration with createExecutionEvent", () => {
		it("should store all event types", async () => {
			const eventTypes = [
				"plan_started",
				"plan_completed",
				"plan_failed",
				"plan_paused",
				"plan_resumed",
				"plan_cancelled",
				"plan_stopped",
				"workspace_pending",
				"workspace_running",
				"workspace_completed",
				"workspace_failed",
				"workspace_blocked",
				"workspace_cancelled",
				"workspace_skipped",
				"workspace_paused",
				"workspace_timed_out",
				"worker_started",
				"worker_completed",
				"worker_failed",
				"worker_timed_out",
				"worker_cancelled",
				"command_started",
				"command_finished",
				"brain_proposed",
				"brain_approved",
				"brain_rejected",
				"governance_check_started",
				"governance_approved",
				"governance_rejected",
				"governance_escalated",

				// Lead Agent escalation events (P41.09)
				"lead_agent_review_started",
				"lead_agent_directive_issued",
				"lead_agent_directive_acknowledged",
				"lead_agent_escalation_initiated",
				"lead_agent_escalation_resolved",

				"system_error",
				"system_warning",
				"system_info",
			] as const;

			for (const eventType of eventTypes) {
				const event = createExecutionEvent(eventType, {} as never);
				await store.appendEvent("exec-1", event);
			}

			const results = await store.queryEvents("exec-1");
			expect(results).toHaveLength(eventTypes.length);

			const storedTypes = results.map((e) => e.eventType);
			for (const t of eventTypes) {
				expect(storedTypes).toContain(t);
			}
		});

		it("should preserve timestamp precision", async () => {
			const before = Date.now();
			const event = createExecutionEvent("system_info", {
				message: "timestamp test",
				planExecutionId: "exec-1",
			});
			const after = Date.now();

			const eventId = await store.appendEvent("exec-1", event);
			const envelope = await store.getEvent(eventId);

			const createdAt = new Date(envelope!.createdAt).getTime();
			expect(createdAt).toBeGreaterThanOrEqual(before);
			expect(createdAt).toBeLessThanOrEqual(after);
		});
	});
});
