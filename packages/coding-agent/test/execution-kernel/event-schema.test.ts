import { describe, expect, it } from "vitest";
import {
	ATTEMPT_EVENT_VERSION,
	assertAttemptEvent,
	createAttemptEvent,
	isAttemptEvent,
	isValidAttemptEventType,
	isValidEventSource,
} from "../../src/execution-kernel/event-schema.js";

describe("event-schema", () => {
	describe("event type validation", () => {
		it("accepts valid event types", () => {
			expect(isValidAttemptEventType("attempt_created")).toBe(true);
			expect(isValidAttemptEventType("deadline_exceeded")).toBe(true);
			expect(isValidAttemptEventType("handoff_required")).toBe(true);
			expect(isValidAttemptEventType("retry_requested")).toBe(true);
			expect(isValidAttemptEventType("worktree_lease_acquired")).toBe(true);
			expect(isValidAttemptEventType("executor_completed")).toBe(true);
			expect(isValidAttemptEventType("validation_passed")).toBe(true);
			expect(isValidAttemptEventType("integration_started")).toBe(true);
			expect(isValidAttemptEventType("merge_conflict_detected")).toBe(true);
			expect(isValidAttemptEventType("manual_resolution_recorded")).toBe(true);
		});

		it("rejects invalid event types", () => {
			expect(isValidAttemptEventType("invalid_event")).toBe(false);
			expect(isValidAttemptEventType("")).toBe(false);
			expect(isValidAttemptEventType("attempt_started")).toBe(false); // old v3 type
		});
	});

	describe("source validation", () => {
		it("accepts valid sources", () => {
			expect(isValidEventSource("attempt_controller")).toBe(true);
			expect(isValidEventSource("executor_actor")).toBe(true);
			expect(isValidEventSource("deadline_watchdog")).toBe(true);
			expect(isValidEventSource("human")).toBe(true);
		});

		it("rejects invalid sources", () => {
			expect(isValidEventSource("unknown_source")).toBe(false);
			expect(isValidEventSource("")).toBe(false);
		});
	});

	describe("isAttemptEvent", () => {
		it("validates a complete attempt event", () => {
			const event = createAttemptEvent({
				eventId: "evt-1",
				commandId: null,
				correlationId: null,
				planExecutionId: "plan-1",
				workspaceId: "ws-1",
				attemptId: "att-1",
				source: "attempt_controller",
				type: "attempt_created",
				payload: {
					workspaceExecutionId: "ws-1",
					planExecutionId: "plan-1",
					projectId: "proj-1",
					attemptNo: 1,
					initialState: "PENDING",
					deadlineAt: null,
				},
			});
			expect(isAttemptEvent(event)).toBe(true);
		});

		it("rejects null/undefined", () => {
			expect(isAttemptEvent(null)).toBe(false);
			expect(isAttemptEvent(undefined)).toBe(false);
		});

		it("rejects missing required fields", () => {
			expect(isAttemptEvent({})).toBe(false);
		});
	});

	describe("assertAttemptEvent", () => {
		it("does not throw for valid event", () => {
			const event = createAttemptEvent({
				eventId: "evt-2",
				commandId: null,
				correlationId: null,
				planExecutionId: "plan-1",
				workspaceId: null,
				attemptId: "att-1",
				source: "executor_actor",
				type: "executor_completed",
				payload: {
					result: "success",
					summary: "all good",
				},
			});
			expect(() => assertAttemptEvent(event)).not.toThrow();
		});

		it("throws for invalid event", () => {
			expect(() => assertAttemptEvent({})).toThrow("Invalid AttemptEvent");
		});
	});

	describe("createAttemptEvent", () => {
		it("sets eventVersion and createdAt", () => {
			const event = createAttemptEvent({
				eventId: "evt-3",
				commandId: null,
				correlationId: null,
				planExecutionId: "plan-1",
				workspaceId: null,
				attemptId: "att-1",
				source: "human",
				type: "manual_resolution_recorded",
				payload: {
					resolution: "manual_fix",
					summary: "fixed manually",
				},
			});
			expect(event.eventVersion).toBe(ATTEMPT_EVENT_VERSION);
			expect(event.createdAt).toBeTypeOf("string");
			expect(event.eventId).toBe("evt-3");
			expect(event.source).toBe("human");
			expect(event.type).toBe("manual_resolution_recorded");
		});
	});
});
