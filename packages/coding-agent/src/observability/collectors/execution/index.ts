/**
 * Execution Collectors — Workspace 25.F
 *
 * Barrel file re-exporting all execution, scheduler, and validation collectors
 * and their associated types, budgets, dedupe configs, and diagnostic
 * interfaces.
 *
 * Each collector converts domain events into standardized ObservabilityEvent
 * records for the telemetry store, respecting budget, cooldown, dedupe,
 * and stop-condition constraints.
 *
 * @module observability/collectors/execution
 */

// ── Execution Collector (attempt events) ─────────────────────────────
export {
	DEFAULT_EXECUTION_COLLECTOR_BUDGET,
	DEFAULT_EXECUTION_COLLECTOR_DEDUPE,
	ExecutionCollector,
	type ExecutionCollectorBudget,
	type ExecutionCollectorBufferEntry,
	type ExecutionCollectorCooldown,
	type ExecutionCollectorDedupeConfig,
	type ExecutionCollectorDedupeEntry,
	type ExecutionCollectorDiagnostics,
	type ExecutionCollectorStopCondition,
} from "./execution-collector.js";

// ── Scheduler Collector (slot allocation, bottlenecks, scheduling) ───
export {
	ALL_SCHEDULER_EVENT_TYPES,
	type BottleneckClearedEvent,
	type BottleneckDetectedEvent,
	DEFAULT_SCHEDULER_COLLECTOR_BUDGET,
	DEFAULT_SCHEDULER_COLLECTOR_DEDUPE,
	type PlanStateChangeEvent,
	type ScheduleDecisionEvent,
	SchedulerCollector,
	type SchedulerCollectorBudget,
	type SchedulerCollectorBufferEntry,
	type SchedulerCollectorCooldown,
	type SchedulerCollectorDedupeConfig,
	type SchedulerCollectorDedupeEntry,
	type SchedulerCollectorDiagnostics,
	type SchedulerCollectorStopCondition,
	type SchedulerEventPayload,
	type SchedulerEventType,
	type SlotAllocationEvent,
	type SlotRejectedEvent,
	type SlotReleaseEvent,
	type WorkerPoolChangeEvent,
	type WorkspaceStageChangeEvent,
} from "./scheduler-collector.js";

// ── Validation Collector (validation lifecycle events, lane state, locks) ──
export {
	ALL_VALIDATION_EVENT_TYPES,
	DEFAULT_VALIDATION_COLLECTOR_BUDGET,
	DEFAULT_VALIDATION_COLLECTOR_DEDUPE,
	ValidationCollector,
	type ValidationCollectorBudget,
	type ValidationCollectorBufferEntry,
	type ValidationCollectorCooldown,
	type ValidationCollectorDedupeConfig,
	type ValidationCollectorDedupeEntry,
	type ValidationCollectorDiagnostics,
	type ValidationCollectorStopCondition,
	type ValidationEventPayload,
	type ValidationEventType,
	type ValidationExecutionEvent,
	type ValidationLaneBackpressureEvent,
	type ValidationLaneSaturatedEvent,
	type ValidationLockEvent,
	type ValidationQueueDepthChangeEvent,
	type ValidationStatsSnapshotEvent,
} from "./validation-collector.js";
