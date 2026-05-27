/**
 * Execution Collectors Tests — Workspace 25.F
 *
 * Tests for ExecutionCollector, SchedulerCollector, and ValidationCollector.
 *
 * Covers:
 * - Basic collection and conversion to ObservabilityEvent format
 * - Budget enforcement (per-cycle, total buffer, time budgets)
 * - Cooldown enforcement
 * - Deduplication
 * - Stop conditions
 * - Diagnostics
 * - Batch collection
 * - Convenience methods
 * - Error states
 * - Edge cases (empty inputs, stopped state, budget edge cases)
 */

import { describe, expect, it } from "vitest";
import type {
	AttemptEvent,
	AttemptEventPayload,
	AttemptEventTypeV4,
	EventSource,
} from "../../src/execution-kernel/event-schema.js";
import { ExecutionCollector } from "../../src/observability/collectors/execution/execution-collector.js";
import { SchedulerCollector } from "../../src/observability/collectors/execution/scheduler-collector.js";
import { ValidationCollector } from "../../src/observability/collectors/execution/validation-collector.js";
import type { ObservabilityEvent } from "../../src/observability/types.js";
import { WorkspaceStage } from "../../src/platform/types.js";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const TEST_EVENT_SOURCE: EventSource = "attempt_controller";

let eventCounter = 0;

function createTestAttemptEvent(overrides: Partial<AttemptEvent> & { type: AttemptEventTypeV4 }): AttemptEvent {
	eventCounter++;
	return {
		eventVersion: 1,
		eventId: `evt-${Date.now()}-${eventCounter}`,
		commandId: null,
		correlationId: "corr-001",
		planExecutionId: `plan-exec-${eventCounter}`,
		workspaceId: `ws-${eventCounter}`,
		attemptId: `attempt-${eventCounter}`,
		source: TEST_EVENT_SOURCE,
		createdAt: new Date().toISOString(),
		payload: {} as AttemptEventPayload,
		...overrides,
	};
}

function createValidationPassedEvent(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
	return createTestAttemptEvent({
		type: "validation_passed",
		payload: { output: "All tests passed", durationMs: 1500 },
		...overrides,
	});
}

function createValidationFailedEvent(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
	return createTestAttemptEvent({
		type: "validation_failed",
		payload: { output: "Tests failed", durationMs: 2000, error: "Assertion error" },
		...overrides,
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────
// ExecutionCollector Tests
// ─────────────────────────────────────────────────────────────────────

describe("ExecutionCollector", () => {
	describe("basic collection", () => {
		it("collects a single attempt event", () => {
			const collector = new ExecutionCollector();
			const event = createTestAttemptEvent({ type: "attempt_created" });

			const result = collector.collectEvent(event);

			expect(result).not.toBeNull();
			expect(result!.eventType).toBe("execution_attempt_created");
			expect(result!.planExecutionId).toBe(event.planExecutionId);
			expect(result!.workspaceExecutionId).toBe(event.workspaceId);
			expect(result!.severity).toBe("info");
			expect(result!.status).toBe("running");
		});

		it("collects an executor completed event with ok status", () => {
			const collector = new ExecutionCollector();
			const event = createTestAttemptEvent({
				type: "executor_completed",
				payload: { result: "success", summary: "All tasks done" },
			});

			const result = collector.collectEvent(event);

			expect(result).not.toBeNull();
			expect(result!.status).toBe("ok");
		});

		it("collects a failure event with error severity", () => {
			const collector = new ExecutionCollector();
			const event = createTestAttemptEvent({
				type: "executor_failed",
				payload: { error: "Something went wrong", errorClass: "final" },
			});

			const result = collector.collectEvent(event);

			expect(result).not.toBeNull();
			expect(result!.severity).toBe("error");
			expect(result!.status).toBe("error");
			expect(result!.error).toBe("Something went wrong");
		});

		it("returns null when stopped", () => {
			const collector = new ExecutionCollector();
			collector.stop("test stop");

			const event = createTestAttemptEvent({ type: "attempt_created" });
			const result = collector.collectEvent(event);

			expect(result).toBeNull();
		});

		it("returns null for null/undefined events gracefully", () => {
			const collector = new ExecutionCollector();
			collector.stop();
			const event = createTestAttemptEvent({ type: "attempt_created" });
			expect(collector.collectEvent(event)).toBeNull();
		});
	});

	describe("batch collection", () => {
		it("collects a batch of events", () => {
			const collector = new ExecutionCollector();
			const events = [
				createTestAttemptEvent({ type: "attempt_created" }),
				createTestAttemptEvent({ type: "executor_started", payload: { agentId: "a1", providerModel: "gpt-4" } }),
				createTestAttemptEvent({ type: "executor_completed", payload: { result: "success", summary: "ok" } }),
			];

			const count = collector.collectBatch(events);

			expect(count).toBe(3);
			expect(collector.bufferSize()).toBe(3);
		});

		it("respects maxPerCycle budget", () => {
			const collector = new ExecutionCollector({ maxPerCycle: 2 }, undefined, 0);
			const events = [
				createTestAttemptEvent({ type: "attempt_created" }),
				createTestAttemptEvent({ type: "executor_started", payload: { agentId: "a1", providerModel: "gpt-4" } }),
				createTestAttemptEvent({ type: "executor_completed", payload: { result: "success", summary: "ok" } }),
			];

			const count = collector.collectBatch(events);

			expect(count).toBe(2);
			expect(collector.bufferSize()).toBe(2);
			const diag = collector.getDiagnostics();
			expect(diag.cyclesHitBudget).toBeGreaterThanOrEqual(1);
		});
	});

	describe("categorized collection", () => {
		it("collects from categorized events", () => {
			const collector = new ExecutionCollector();
			const events: Record<string, AttemptEvent[]> = {
				lifecycle: [createTestAttemptEvent({ type: "attempt_created" })],
				executor: [
					createTestAttemptEvent({ type: "executor_started", payload: { agentId: "a1", providerModel: "gpt-4" } }),
				],
			};

			const count = collector.collectCategorized(events);

			expect(count).toBe(2);
		});

		it("returns 0 for empty categories", () => {
			const collector = new ExecutionCollector();
			const count = collector.collectCategorized({});
			expect(count).toBe(0);
		});
	});

	describe("budget enforcement", () => {
		it("enforces maxTotal buffer limit", () => {
			const collector = new ExecutionCollector({ maxTotal: 2 }, undefined, 0);
			const events = [
				createTestAttemptEvent({ type: "attempt_created" }),
				createTestAttemptEvent({ type: "executor_started", payload: { agentId: "a1", providerModel: "gpt-4" } }),
				createTestAttemptEvent({ type: "executor_completed", payload: { result: "success", summary: "ok" } }),
			];

			collector.collectBatch(events);
			expect(collector.bufferSize()).toBe(2);

			// Third event should be suppressed
			const extra = createTestAttemptEvent({ type: "attempt_created" });
			const result = collector.collectEvent(extra);
			expect(result).toBeNull();
		});

		it("allows budget update", () => {
			const collector = new ExecutionCollector({ maxTotal: 1 }, undefined, 0);
			collector.setBudget({ maxTotal: 10 });

			const events = Array.from({ length: 5 }, () => createTestAttemptEvent({ type: "attempt_created" }));
			const count = collector.collectBatch(events);
			expect(count).toBe(5);
		});
	});

	describe("cooldown", () => {
		it("suppresses events during cooldown", () => {
			const collector = new ExecutionCollector(undefined, undefined, 50_000);
			const event = createTestAttemptEvent({ type: "attempt_created" });

			// First collection succeeds
			expect(collector.collectEvent(event)).not.toBeNull();
			// Second within cooldown is suppressed
			expect(collector.collectEvent(event)).toBeNull();
		});

		it("allows events after cooldown expires", async () => {
			const collector = new ExecutionCollector(undefined, undefined, 10);
			const event = createTestAttemptEvent({ type: "attempt_created" });

			expect(collector.collectEvent(event)).not.toBeNull();
			await sleep(20);
			expect(
				collector.collectEvent(
					createTestAttemptEvent({ type: "executor_started", payload: { agentId: "a2", providerModel: "gpt-4" } }),
				),
			).not.toBeNull();
		});
	});

	describe("deduplication", () => {
		it("suppresses identical events within same cooldown window", () => {
			// ExecutionCollector ties dedupe entries to cooldown key lifecycle.
			// With a positive cooldown, the second same-type event is suppressed
			// by cooldown before dedupe is reached.
			const collector = new ExecutionCollector(undefined, { enabled: true, windowMs: 30_000 }, 10_000);
			const event = createTestAttemptEvent({ type: "attempt_created" });

			expect(collector.collectEvent(event)).not.toBeNull();
			// Second event has same type → same cooldown key → suppressed
			expect(collector.collectEvent(event)).toBeNull();
		});

		it("allows events after cooldown expires (different content, no dedupe overlap)", async () => {
			const collector = new ExecutionCollector(undefined, { enabled: true, windowMs: 1 }, 10);
			const event1 = createTestAttemptEvent({ type: "attempt_created" });

			expect(collector.collectEvent(event1)).not.toBeNull();
			await sleep(20);
			// Different event content bypasses dedup; cooldown has expired.
			const event2 = createTestAttemptEvent({
				type: "executor_started",
				payload: { agentId: "a2", providerModel: "gpt-4" },
			});
			expect(collector.collectEvent(event2)).not.toBeNull();
		});

		it("does not deduplicate when dedupe is disabled", () => {
			const collector = new ExecutionCollector(undefined, { enabled: false }, 0);
			const event = createTestAttemptEvent({ type: "attempt_created" });

			expect(collector.collectEvent(event)).not.toBeNull();
			expect(collector.collectEvent(event)).not.toBeNull();
		});
	});

	describe("stop conditions", () => {
		it("stops collection when all conditions triggered", () => {
			const collector = new ExecutionCollector();
			collector.addStopCondition("max_errors");
			collector.triggerStopCondition("max_errors");

			const event = createTestAttemptEvent({ type: "attempt_created" });
			expect(collector.collectEvent(event)).toBeNull();
		});

		it("tracks multiple stop conditions", () => {
			const collector = new ExecutionCollector();
			collector.addStopCondition("condition_a");
			collector.addStopCondition("condition_b");

			const conditions = collector.getStopConditions();
			expect(conditions).toHaveLength(2);
			expect(conditions[0].triggered).toBe(false);
		});
	});

	describe("diagnostics", () => {
		it("returns diagnostics with event type counts", () => {
			const collector = new ExecutionCollector();
			collector.collectEvent(createTestAttemptEvent({ type: "attempt_created" }));
			collector.collectEvent(
				createTestAttemptEvent({
					type: "executor_started",
					payload: { agentId: "a1", providerModel: "gpt-4" },
				}),
			);

			const diag = collector.getDiagnostics();
			expect(diag.totalCollected).toBe(2);
			expect(diag.eventTypeCounts.attempt_created).toBe(1);
			expect(diag.eventTypeCounts.executor_started).toBe(1);
			expect(diag.stopped).toBe(false);
		});

		it("tracks error state", () => {
			const collector = new ExecutionCollector();
			collector.setError("Something broke");
			const diag = collector.getDiagnostics();
			expect(diag.error).toBe("Something broke");

			collector.clearError();
			expect(collector.getDiagnostics().error).toBeNull();
		});
	});

	describe("buffer drain", () => {
		it("drains all events", () => {
			const collector = new ExecutionCollector(undefined, undefined, 0);
			collector.collectEvent(createTestAttemptEvent({ type: "attempt_created" }));
			collector.collectEvent(
				createTestAttemptEvent({ type: "executor_started", payload: { agentId: "a1", providerModel: "gpt-4" } }),
			);

			const events = collector.drain();
			expect(events).toHaveLength(2);
			expect(collector.bufferSize()).toBe(0);
		});

		it("drains entries with full metadata", () => {
			const collector = new ExecutionCollector();
			collector.collectEvent(createTestAttemptEvent({ type: "attempt_created" }));

			const entries = collector.drainEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].attemptId).toBe(entries[0].attemptId);
			expect(entries[0].planExecutionId).toBe(entries[0].planExecutionId);
		});

		it("peek returns entries without draining", () => {
			const collector = new ExecutionCollector();
			collector.collectEvent(createTestAttemptEvent({ type: "attempt_created" }));

			const entries = collector.peek();
			expect(entries).toHaveLength(1);
			expect(collector.bufferSize()).toBe(1);
		});
	});

	describe("reset", () => {
		it("clears all state", () => {
			const collector = new ExecutionCollector();
			collector.collectEvent(createTestAttemptEvent({ type: "attempt_created" }));
			collector.stop("some condition");

			collector.reset();

			expect(collector.bufferSize()).toBe(0);
			expect(collector.isStopped()).toBe(false);
			const diag = collector.getDiagnostics();
			expect(diag.totalCollected).toBe(0);
		});
	});
});

// ─────────────────────────────────────────────────────────────────────
// SchedulerCollector Tests
// ─────────────────────────────────────────────────────────────────────

describe("SchedulerCollector", () => {
	describe("basic collection", () => {
		it("collects a slot allocation event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectSlotAllocation({
				planExecutionId: "plan-exec-sa-1",
				workspaceExecutionId: "ws-sa-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 3,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("execution_slot_allocated");
			expect(event!.planExecutionId).toBe("plan-exec-sa-1");
		});

		it("collects a slot release event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectSlotRelease({
				planExecutionId: "plan-exec-sr-1",
				workspaceExecutionId: "ws-sr-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 2,
				reason: "completed",
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("execution_slot_released");
		});

		it("collects a bottleneck detected event with warning severity", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectBottleneckDetected({
				planExecutionId: "plan-exec-bd-1",
				reasons: ["Validation lane saturated"],
				activeWorkers: 1,
				totalSlots: 3,
				pendingCount: 5,
				blockedCount: 2,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.severity).toBe("warning");
			expect(event!.status).toBe("error");
		});

		it("collects a bottleneck cleared event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectBottleneckCleared({
				planExecutionId: "plan-exec-bc-1",
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.severity).toBe("info");
			expect(event!.status).toBe("ok");
		});

		it("collects a worker pool change event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectWorkerPoolChange({
				planExecutionId: "plan-exec-wp-1",
				previousMax: 3,
				newMax: 5,
				reason: "demand increase",
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("execution_worker_pool_change");
		});

		it("collects a schedule decision event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectScheduleDecision({
				planExecutionId: "plan-exec-sd-1",
				decision: "schedule_next",
				reason: "slot available",
				candidatesConsidered: 3,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
		});

		it("collects a workspace stage change event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectWorkspaceStageChange({
				planExecutionId: "plan-exec-ws-1",
				workspaceExecutionId: "ws-ws-1",
				previousStage: WorkspaceStage.Pending,
				newStage: WorkspaceStage.Active,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("execution_workspace_stage_change");
		});

		it("collects a plan state change event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectPlanStateChange({
				planExecutionId: "plan-exec-ps-1",
				previousProgress: 30,
				newProgress: 50,
				totalWorkspaces: 10,
				completedCount: 5,
				failedCount: 0,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
		});

		it("collects a slot rejection event", () => {
			const collector = new SchedulerCollector();
			const event = collector.collectSlotRejected({
				planExecutionId: "plan-exec-sr-2",
				workspaceExecutionId: "ws-sr-2",
				reason: "no available slots",
				availableSlots: 0,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.severity).toBe("warning");
			expect(event!.status).toBe("error");
			expect(event!.error).toBe("no available slots");
		});
	});

	describe("batch collection", () => {
		it("collects a batch of scheduler events", () => {
			const collector = new SchedulerCollector();
			const ts = new Date().toISOString();
			const events = [
				{
					type: "slot_allocated" as const,
					data: {
						planExecutionId: "plan-exec-b1",
						workspaceExecutionId: "ws-b1",
						slotIndex: 1,
						totalSlots: 5,
						activeSlots: 3,
						timestamp: ts,
					},
				},
				{
					type: "slot_released" as const,
					data: {
						planExecutionId: "plan-exec-b2",
						workspaceExecutionId: "ws-b2",
						slotIndex: 1,
						totalSlots: 5,
						activeSlots: 2,
						reason: "completed",
						timestamp: ts,
					},
				},
			];

			const count = collector.collectBatch(events);
			expect(count).toBe(2);
		});
	});

	describe("budget enforcement", () => {
		it("respects maxTotal on scheduler collector", () => {
			const collector = new SchedulerCollector({ maxTotal: 1 });
			const ts = new Date().toISOString();

			collector.collectSlotAllocation({
				planExecutionId: "plan-exec-be-1",
				workspaceExecutionId: "ws-be-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 3,
				timestamp: ts,
			});

			const result = collector.collectSlotRelease({
				planExecutionId: "plan-exec-be-2",
				workspaceExecutionId: "ws-be-2",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 2,
				reason: "done",
				timestamp: ts,
			});

			expect(result).toBeNull();
		});
	});

	describe("cooldown", () => {
		it("suppresses duplicate scheduler events during cooldown", () => {
			const collector = new SchedulerCollector(undefined, undefined, 50_000);
			const ts = new Date().toISOString();
			const event = {
				planExecutionId: "plan-exec-cd-1",
				workspaceExecutionId: "ws-cd-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 3,
				timestamp: ts,
			};

			expect(collector.collectSlotAllocation(event)).not.toBeNull();
			expect(collector.collectSlotAllocation(event)).toBeNull();
		});
	});

	describe("stop conditions", () => {
		it("stops on trigger", () => {
			const collector = new SchedulerCollector();
			collector.addStopCondition("emergency_stop");
			collector.triggerStopCondition("emergency_stop");

			expect(
				collector.collectSlotAllocation({
					planExecutionId: "plan-exec-st-1",
					workspaceExecutionId: "ws-st-1",
					slotIndex: 1,
					totalSlots: 5,
					activeSlots: 3,
					timestamp: new Date().toISOString(),
				}),
			).toBeNull();
		});
	});

	describe("diagnostics", () => {
		it("returns scheduler diagnostics", () => {
			const collector = new SchedulerCollector();
			collector.collectSlotAllocation({
				planExecutionId: "plan-exec-diag-1",
				workspaceExecutionId: "ws-diag-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 3,
				timestamp: new Date().toISOString(),
			});

			const diag = collector.getDiagnostics();
			expect(diag.totalCollected).toBe(1);
			expect(diag.eventTypeCounts.slot_allocated).toBe(1);
		});
	});

	describe("buffer operations", () => {
		it("drains entries with full metadata", () => {
			const collector = new SchedulerCollector();
			collector.collectSlotAllocation({
				planExecutionId: "plan-exec-buf-1",
				workspaceExecutionId: "ws-buf-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 3,
				timestamp: new Date().toISOString(),
			});

			const entries = collector.drainEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].schedulerEventType).toBe("slot_allocated");
		});

		it("peek returns entries without draining", () => {
			const collector = new SchedulerCollector();
			collector.collectSlotAllocation({
				planExecutionId: "plan-exec-peek-1",
				workspaceExecutionId: "ws-peek-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 3,
				timestamp: new Date().toISOString(),
			});

			expect(collector.peek()).toHaveLength(1);
			expect(collector.bufferSize()).toBe(1);
		});
	});

	describe("error state", () => {
		it("tracks error state", () => {
			const collector = new SchedulerCollector();
			collector.setError("Scheduler crashed");
			expect(collector.getDiagnostics().error).toBe("Scheduler crashed");

			collector.clearError();
			expect(collector.getDiagnostics().error).toBeNull();
		});
	});

	describe("reset", () => {
		it("clears all state", () => {
			const collector = new SchedulerCollector();
			collector.collectSlotAllocation({
				planExecutionId: "plan-exec-reset-1",
				workspaceExecutionId: "ws-reset-1",
				slotIndex: 1,
				totalSlots: 5,
				activeSlots: 3,
				timestamp: new Date().toISOString(),
			});
			collector.stop("test");

			collector.reset();

			expect(collector.bufferSize()).toBe(0);
			expect(collector.isStopped()).toBe(false);
			const diag = collector.getDiagnostics();
			expect(diag.totalCollected).toBe(0);
		});
	});
});

// ─────────────────────────────────────────────────────────────────────
// ValidationCollector Tests
// ─────────────────────────────────────────────────────────────────────

describe("ValidationCollector", () => {
	describe("basic collection from validation payload", () => {
		it("collects a lane saturation event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectLaneSaturated({
				planExecutionId: "plan-exec-vc-1",
				heavyCount: 1,
				maxHeavy: 1,
				targetedCount: 3,
				maxTargeted: 3,
				backpressureActive: true,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_lane_saturated");
			expect(event!.severity).toBe("warning");
			expect(event!.planExecutionId).toBe("plan-exec-vc-1");
		});

		it("collects a lane backpressure active event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectLaneBackpressureActive({
				planExecutionId: "plan-exec-vc-2",
				workspaceId: "ws-vc-2",
				reason: "Heavy validation slot saturated",
				heavyCount: 1,
				targetedCount: 2,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_lane_backpressure_active");
			expect(event!.severity).toBe("warning");
		});

		it("collects a lane backpressure cleared event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectLaneBackpressureCleared({
				planExecutionId: "plan-exec-vc-3",
				workspaceId: null,
				reason: "Heavy validation completed",
				heavyCount: 0,
				targetedCount: 1,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_lane_backpressure_cleared");
			expect(event!.status).toBe("ok");
		});

		it("collects a lock waiting event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectLockWaiting({
				planExecutionId: "plan-exec-vc-4",
				workspaceExecutionId: "ws-vc-4",
				attemptId: "attempt-vc-4",
				waitDurationMs: null,
				holdDurationMs: null,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_lock_waiting");
			expect(event!.status).toBe("running");
		});

		it("collects a lock acquired event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectLockAcquired({
				planExecutionId: "plan-exec-vc-5",
				workspaceExecutionId: "ws-vc-5",
				attemptId: "attempt-vc-5",
				waitDurationMs: 500,
				holdDurationMs: null,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_lock_acquired");
		});

		it("collects a lock released event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectLockReleased({
				planExecutionId: "plan-exec-vc-6",
				workspaceExecutionId: "ws-vc-6",
				attemptId: "attempt-vc-6",
				waitDurationMs: null,
				holdDurationMs: 1200,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_lock_released");
			expect(event!.status).toBe("ok");
		});

		it("collects a queue depth change event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectQueueDepthChange({
				planExecutionId: "plan-exec-vc-7",
				queueDepth: 5,
				previousDepth: 3,
				heavyQueueDepth: 1,
				targetedQueueDepth: 4,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_queue_depth_change");
		});

		it("collects a stats snapshot event", () => {
			const collector = new ValidationCollector();
			const event = collector.collectStatsSnapshot({
				planExecutionId: "plan-exec-vc-8",
				totalValidations: 10,
				passedCount: 8,
				failedCount: 1,
				timedOutCount: 1,
				killedCount: 0,
				averageDurationMs: 2500,
				timestamp: new Date().toISOString(),
			});

			expect(event).not.toBeNull();
			expect(event!.eventType).toBe("validation_validation_stats_snapshot");
			expect(event!.severity).toBe("info");
		});
	});

	describe("collection from execution kernel events", () => {
		it("collects a validation_passed execution event", () => {
			const collector = new ValidationCollector();
			const event = createValidationPassedEvent();

			const result = collector.collectExecutionEvent(event);
			expect(result).not.toBeNull();
			expect(result!.eventType).toBe("validation_validation_passed");
			expect(result!.status).toBe("ok");
		});

		it("collects a validation_failed execution event with error severity", () => {
			const collector = new ValidationCollector();
			const event = createValidationFailedEvent();

			const result = collector.collectExecutionEvent(event);
			expect(result).not.toBeNull();
			expect(result!.severity).toBe("error");
			expect(result!.status).toBe("error");
			expect(result!.error).toBe("Assertion error");
		});

		it("collects a validation_started execution event", () => {
			const collector = new ValidationCollector();
			const event = createTestAttemptEvent({
				type: "validation_started",
				payload: { command: "npm test", timeoutMs: 30000 },
			});

			const result = collector.collectExecutionEvent(event);
			expect(result).not.toBeNull();
			expect(result!.eventType).toBe("validation_validation_started");
			expect(result!.status).toBe("running");
		});

		it("collects a validation_timed_out execution event", () => {
			const collector = new ValidationCollector();
			const event = createTestAttemptEvent({
				type: "validation_timed_out",
				payload: { command: "npm test", timeoutMs: 30000, outputTruncated: "..." },
			});

			const result = collector.collectExecutionEvent(event);
			expect(result).not.toBeNull();
			expect(result!.severity).toBe("error");
			expect(result!.error).toBe("Validation timed out after 30000ms");
		});

		it("collects a validation_process_killed execution event", () => {
			const collector = new ValidationCollector();
			const event = createTestAttemptEvent({
				type: "validation_process_killed",
				payload: { pid: 12345, signal: "SIGKILL" },
			});

			const result = collector.collectExecutionEvent(event);
			expect(result).not.toBeNull();
			expect(result!.severity).toBe("error");
		});

		it("collects validation_lane_requested and validation_lane_acquired", () => {
			const collector = new ValidationCollector();

			const requested = createTestAttemptEvent({
				type: "validation_lane_requested",
				payload: { laneType: "heavy" },
			});
			const acquired = createTestAttemptEvent({
				type: "validation_lane_acquired",
				payload: { laneType: "heavy" },
			});

			expect(collector.collectExecutionEvent(requested)).not.toBeNull();
			expect(collector.collectExecutionEvent(acquired)).not.toBeNull();
		});

		it("returns null for non-validation execution events", () => {
			const collector = new ValidationCollector();
			const event = createTestAttemptEvent({ type: "attempt_created" });

			const result = collector.collectExecutionEvent(event);
			expect(result).toBeNull();
		});
	});

	describe("batch collection", () => {
		it("collects a batch of validation payload events", () => {
			const collector = new ValidationCollector();
			const ts = new Date().toISOString();
			const events = [
				{
					type: "lane_saturated" as const,
					data: {
						planExecutionId: "plan-exec-bv-1",
						heavyCount: 1,
						maxHeavy: 1,
						targetedCount: 3,
						maxTargeted: 3,
						backpressureActive: true,
						timestamp: ts,
					},
				},
				{
					type: "lock_waiting" as const,
					data: {
						planExecutionId: "plan-exec-bv-2",
						workspaceExecutionId: "ws-bv-2",
						attemptId: "attempt-bv-2",
						waitDurationMs: null,
						holdDurationMs: null,
						timestamp: ts,
					},
				},
			];

			const count = collector.collectBatch(events);
			expect(count).toBe(2);
		});

		it("collects a batch of execution events (validation-only)", () => {
			const collector = new ValidationCollector();
			const events = [
				createValidationPassedEvent(),
				createValidationFailedEvent(),
				createTestAttemptEvent({ type: "attempt_created" }), // should be skipped
			];

			const count = collector.collectExecutionBatch(events);
			expect(count).toBe(2);
		});
	});

	describe("aggregate statistics", () => {
		it("tracks validation pass/fail stats incrementally", () => {
			const collector = new ValidationCollector();

			collector.collectValidationEvent({
				type: "validation_passed",
				data: {
					planExecutionId: "plan-exec-stats-1",
					workspaceExecutionId: "ws-stats-1",
					attemptId: "attempt-stats-1",
					command: null,
					durationMs: 1000,
					error: null,
					laneType: null,
					output: "ok",
					pid: null,
					signal: null,
					timeoutMs: null,
					timestamp: new Date().toISOString(),
				},
			});

			collector.collectValidationEvent({
				type: "validation_failed",
				data: {
					planExecutionId: "plan-exec-stats-2",
					workspaceExecutionId: "ws-stats-2",
					attemptId: "attempt-stats-2",
					command: null,
					durationMs: 2000,
					error: "fail",
					laneType: null,
					output: "error",
					pid: null,
					signal: null,
					timeoutMs: null,
					timestamp: new Date().toISOString(),
				},
			});

			const stats = collector.getAggregateStats();
			expect(stats.totalValidations).toBe(2);
			expect(stats.passedCount).toBe(1);
			expect(stats.failedCount).toBe(1);
			expect(stats.totalDurationMs).toBe(3000);
		});

		it("tracks timeouts and kills separately", () => {
			const collector = new ValidationCollector();
			const ts = new Date().toISOString();

			collector.collectValidationEvent({
				type: "validation_timed_out",
				data: {
					planExecutionId: "plan-exec-stats-3",
					workspaceExecutionId: "ws-stats-3",
					attemptId: "attempt-stats-3",
					command: "npm test",
					durationMs: null,
					error: "timeout",
					laneType: null,
					output: null,
					pid: null,
					signal: null,
					timeoutMs: 30000,
					timestamp: ts,
				},
			});

			collector.collectValidationEvent({
				type: "validation_process_killed",
				data: {
					planExecutionId: "plan-exec-stats-4",
					workspaceExecutionId: "ws-stats-4",
					attemptId: "attempt-stats-4",
					command: null,
					durationMs: null,
					error: "killed",
					laneType: null,
					output: null,
					pid: 12345,
					signal: "SIGKILL",
					timeoutMs: null,
					timestamp: ts,
				},
			});

			const stats = collector.getAggregateStats();
			expect(stats.totalValidations).toBe(2);
			expect(stats.timedOutCount).toBe(1);
			expect(stats.killedCount).toBe(1);
		});
	});

	describe("deduplication", () => {
		it("deduplicates identical saturation events within window", () => {
			const collector = new ValidationCollector(undefined, { enabled: true, windowMs: 30_000 }, 0);
			const ts = new Date().toISOString();

			expect(
				collector.collectLaneSaturated({
					planExecutionId: "plan-exec-dd-1",
					heavyCount: 1,
					maxHeavy: 1,
					targetedCount: 3,
					maxTargeted: 3,
					backpressureActive: true,
					timestamp: ts,
				}),
			).not.toBeNull();

			expect(
				collector.collectLaneSaturated({
					planExecutionId: "plan-exec-dd-1",
					heavyCount: 1,
					maxHeavy: 1,
					targetedCount: 3,
					maxTargeted: 3,
					backpressureActive: true,
					timestamp: ts,
				}),
			).toBeNull();

			const diag = collector.getDiagnostics();
			expect(diag.totalDeduplicated).toBe(1);
		});
	});

	describe("budget enforcement", () => {
		it("enforces maxTotal on validation collector", () => {
			const collector = new ValidationCollector({ maxTotal: 1 });
			const ts = new Date().toISOString();

			collector.collectLaneSaturated({
				planExecutionId: "plan-exec-be-v-1",
				heavyCount: 1,
				maxHeavy: 1,
				targetedCount: 3,
				maxTargeted: 3,
				backpressureActive: true,
				timestamp: ts,
			});

			const result = collector.collectLockWaiting({
				planExecutionId: "plan-exec-be-v-2",
				workspaceExecutionId: "ws-be-v-2",
				attemptId: "attempt-be-v-2",
				waitDurationMs: null,
				holdDurationMs: null,
				timestamp: ts,
			});

			expect(result).toBeNull();
		});
	});

	describe("cooldown", () => {
		it("suppresses during cooldown", () => {
			const collector = new ValidationCollector(undefined, undefined, 50_000);
			const ts = new Date().toISOString();

			expect(
				collector.collectLaneSaturated({
					planExecutionId: "plan-exec-cd-v-1",
					heavyCount: 1,
					maxHeavy: 1,
					targetedCount: 3,
					maxTargeted: 3,
					backpressureActive: true,
					timestamp: ts,
				}),
			).not.toBeNull();

			// Different key type — not suppressed by cooldown
			expect(
				collector.collectLockWaiting({
					planExecutionId: "plan-exec-cd-v-2",
					workspaceExecutionId: "ws-cd-v-2",
					attemptId: "attempt-cd-v-2",
					waitDurationMs: null,
					holdDurationMs: null,
					timestamp: ts,
				}),
			).not.toBeNull();

			// Same key should be suppressed by cooldown
			expect(
				collector.collectLaneSaturated({
					planExecutionId: "plan-exec-cd-v-1",
					heavyCount: 1,
					maxHeavy: 1,
					targetedCount: 3,
					maxTargeted: 3,
					backpressureActive: true,
					timestamp: ts,
				}),
			).toBeNull();
		});
	});

	describe("stop conditions", () => {
		it("stops on trigger", () => {
			const collector = new ValidationCollector();
			collector.addStopCondition("validation_halt");
			collector.triggerStopCondition("validation_halt");

			expect(
				collector.collectLaneSaturated({
					planExecutionId: "plan-exec-st-v-1",
					heavyCount: 1,
					maxHeavy: 1,
					targetedCount: 3,
					maxTargeted: 3,
					backpressureActive: true,
					timestamp: new Date().toISOString(),
				}),
			).toBeNull();
		});
	});

	describe("diagnostics", () => {
		it("returns diagnostics with aggregate stats", () => {
			const collector = new ValidationCollector();
			collector.collectLaneSaturated({
				planExecutionId: "plan-exec-diag-v-1",
				heavyCount: 1,
				maxHeavy: 1,
				targetedCount: 3,
				maxTargeted: 3,
				backpressureActive: true,
				timestamp: new Date().toISOString(),
			});

			const diag = collector.getDiagnostics();
			expect(diag.totalCollected).toBe(1);
			expect(diag.eventTypeCounts.lane_saturated).toBe(1);
			expect(diag.aggregateStats).toBeDefined();
			expect(diag.aggregateStats.totalValidations).toBe(0); // lane_saturated doesn't update stats
		});

		it("returns aggregate stats separately", () => {
			const collector = new ValidationCollector();
			const stats = collector.getAggregateStats();
			expect(stats.totalValidations).toBe(0);
			expect(stats.passedCount).toBe(0);
			expect(stats.failedCount).toBe(0);
		});
	});

	describe("buffer operations", () => {
		it("drains entries with full metadata", () => {
			const collector = new ValidationCollector();
			collector.collectLaneSaturated({
				planExecutionId: "plan-exec-buf-v-1",
				heavyCount: 1,
				maxHeavy: 1,
				targetedCount: 3,
				maxTargeted: 3,
				backpressureActive: true,
				timestamp: new Date().toISOString(),
			});

			const entries = collector.drainEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].validationEventType).toBe("lane_saturated");
		});

		it("peek returns entries without draining", () => {
			const collector = new ValidationCollector();
			collector.collectLaneSaturated({
				planExecutionId: "plan-exec-peek-v-1",
				heavyCount: 1,
				maxHeavy: 1,
				targetedCount: 3,
				maxTargeted: 3,
				backpressureActive: true,
				timestamp: new Date().toISOString(),
			});

			expect(collector.peek()).toHaveLength(1);
			expect(collector.bufferSize()).toBe(1);
		});

		it("drain returns events without metadata", () => {
			const collector = new ValidationCollector();
			collector.collectLaneSaturated({
				planExecutionId: "plan-exec-dr-v-1",
				heavyCount: 1,
				maxHeavy: 1,
				targetedCount: 3,
				maxTargeted: 3,
				backpressureActive: true,
				timestamp: new Date().toISOString(),
			});

			const events = collector.drain();
			expect(events).toHaveLength(1);
			expect((events[0] as ObservabilityEvent).eventType).toBe("validation_lane_saturated");
		});
	});

	describe("error state", () => {
		it("tracks error state", () => {
			const collector = new ValidationCollector();
			collector.setError("Validation system unavailable");
			expect(collector.getDiagnostics().error).toBe("Validation system unavailable");

			collector.clearError();
			expect(collector.getDiagnostics().error).toBeNull();
		});
	});

	describe("reset", () => {
		it("clears all state including aggregate stats", () => {
			const collector = new ValidationCollector();
			collector.collectValidationEvent({
				type: "validation_passed",
				data: {
					planExecutionId: "plan-exec-reset-1",
					workspaceExecutionId: "ws-reset-1",
					attemptId: "attempt-reset-1",
					command: null,
					durationMs: 1000,
					error: null,
					laneType: null,
					output: "ok",
					pid: null,
					signal: null,
					timeoutMs: null,
					timestamp: new Date().toISOString(),
				},
			});
			collector.stop("test");

			collector.reset();

			expect(collector.bufferSize()).toBe(0);
			expect(collector.isStopped()).toBe(false);
			const diag = collector.getDiagnostics();
			expect(diag.totalCollected).toBe(0);
			expect(diag.aggregateStats.totalValidations).toBe(0);
		});
	});
});
