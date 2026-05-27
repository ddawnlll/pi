/**
 * Validation Collector — Workspace 25.F
 *
 * Collects validation-specific events from the execution engine: validation
 * lane state changes, validation lock events, validation lane saturation
 * events, and execution-kernel validation attempt events. Converts them
 * into standardized ObservabilityEvent records for the telemetry store.
 *
 * Tracks:
 * - Validation lane saturation and backpressure state
 * - Validation lock lifecycle (waiting, acquired, released)
 * - Execution-kernel validation attempt events
 *   (validation_lane_requested, validation_lane_acquired, validation_started,
 *    validation_passed, validation_failed, validation_timed_out,
 *    validation_process_killed)
 * - Validation queue depth and aggregate statistics
 * - Validation runner outcomes (timeout, process kill, success)
 *
 * ## Autonomous Design
 *
 * All collection respects:
 * - **Budget**: Maximum events collected per cycle, max entries overall
 * - **Cooldown**: Minimum time between collection of the same event type
 * - **Dedupe**: Content-hash deduplication within a configurable window
 * - **Stop-conditions**: Early exit when budget or time limits are hit
 *
 * ## Diagnostics
 *
 * Every failure surfaces an evidence-backed diagnostic with at minimum
 * a placeholder entry rather than silent failure.
 *
 * @module observability/collectors/execution/validation-collector
 */

import { createHash } from "node:crypto";
import type {
	AttemptEvent,
	ValidationFailedPayload,
	ValidationPassedPayload,
	ValidationProcessKilledPayload,
	ValidationStartedPayload,
	ValidationTimedOutPayload,
} from "../../../execution-kernel/event-schema.js";
import { createObservabilityEvent, createTraceContext } from "../../schema.js";
import type { ObservabilityEvent, ObservabilitySeverity, ObservabilityStatus } from "../../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Validation event types for collection.
 */
export type ValidationEventType =
	| "lane_saturated"
	| "lane_backpressure_active"
	| "lane_backpressure_cleared"
	| "lock_waiting"
	| "lock_acquired"
	| "lock_released"
	| "validation_lane_requested"
	| "validation_lane_acquired"
	| "validation_started"
	| "validation_passed"
	| "validation_failed"
	| "validation_timed_out"
	| "validation_process_killed"
	| "queue_depth_change"
	| "validation_stats_snapshot";

/**
 * All valid ValidationEventType values.
 */
export const ALL_VALIDATION_EVENT_TYPES: ValidationEventType[] = [
	"lane_saturated",
	"lane_backpressure_active",
	"lane_backpressure_cleared",
	"lock_waiting",
	"lock_acquired",
	"lock_released",
	"validation_lane_requested",
	"validation_lane_acquired",
	"validation_started",
	"validation_passed",
	"validation_failed",
	"validation_timed_out",
	"validation_process_killed",
	"queue_depth_change",
	"validation_stats_snapshot",
];

/**
 * Validation lane saturation event data.
 */
export interface ValidationLaneSaturatedEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Current heavy validation count */
	heavyCount: number;
	/** Max concurrent heavy validations */
	maxHeavy: number;
	/** Current targeted validation count */
	targetedCount: number;
	/** Max concurrent targeted validations */
	maxTargeted: number;
	/** Whether backpressure is active */
	backpressureActive: boolean;
	/** Timestamp of the event */
	timestamp: string;
}

/**
 * Validation lane backpressure event data.
 */
export interface ValidationLaneBackpressureEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace ID being deferred (if applicable) */
	workspaceId: string | null;
	/** Reason for backpressure */
	reason: string;
	/** Current heavy count */
	heavyCount: number;
	/** Current targeted count */
	targetedCount: number;
	/** Timestamp of the event */
	timestamp: string;
}

/**
 * Validation lock event data.
 */
export interface ValidationLockEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace execution ID */
	workspaceExecutionId: string | null;
	/** Attempt ID */
	attemptId: string | null;
	/** Wait duration in ms (for lock_acquired events) */
	waitDurationMs: number | null;
	/** Hold duration in ms (for lock_released events) */
	holdDurationMs: number | null;
	/** Timestamp of the event */
	timestamp: string;
}

/**
 * Validation execution attempt event data.
 */
export interface ValidationExecutionEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace execution ID */
	workspaceExecutionId: string | null;
	/** Attempt ID */
	attemptId: string;
	/** Validation command (for started/passed/failed/timed_out) */
	command: string | null;
	/** Duration in ms (for completed events) */
	durationMs: number | null;
	/** Error message (for failure events) */
	error: string | null;
	/** Lane type (for lane events) */
	laneType: "heavy" | "targeted" | null;
	/** Output (for passed/failed events) */
	output: string | null;
	/** PID (for process_killed events) */
	pid: number | null;
	/** Signal (for process_killed events) */
	signal: string | null;
	/** Timeout in ms (for timed_out events) */
	timeoutMs: number | null;
	/** Timestamp of the event */
	timestamp: string;
}

/**
 * Validation queue depth change event data.
 */
export interface ValidationQueueDepthChangeEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Current queue depth */
	queueDepth: number;
	/** Previous queue depth */
	previousDepth: number;
	/** Heavy queue depth */
	heavyQueueDepth: number;
	/** Targeted queue depth */
	targetedQueueDepth: number;
	/** Timestamp of the event */
	timestamp: string;
}

/**
 * Validation statistics snapshot event data.
 */
export interface ValidationStatsSnapshotEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Total validations run */
	totalValidations: number;
	/** Pass count */
	passedCount: number;
	/** Fail count */
	failedCount: number;
	/** Timed out count */
	timedOutCount: number;
	/** Process killed count */
	killedCount: number;
	/** Average duration in ms of completed validations */
	averageDurationMs: number;
	/** Timestamp of the snapshot */
	timestamp: string;
}

/**
 * Union type for all validation event payloads.
 */
export type ValidationEventPayload =
	| { type: "lane_saturated"; data: ValidationLaneSaturatedEvent }
	| { type: "lane_backpressure_active"; data: ValidationLaneBackpressureEvent }
	| { type: "lane_backpressure_cleared"; data: ValidationLaneBackpressureEvent }
	| { type: "lock_waiting"; data: ValidationLockEvent }
	| { type: "lock_acquired"; data: ValidationLockEvent }
	| { type: "lock_released"; data: ValidationLockEvent }
	| { type: "validation_lane_requested"; data: ValidationExecutionEvent }
	| { type: "validation_lane_acquired"; data: ValidationExecutionEvent }
	| { type: "validation_started"; data: ValidationExecutionEvent }
	| { type: "validation_passed"; data: ValidationExecutionEvent }
	| { type: "validation_failed"; data: ValidationExecutionEvent }
	| { type: "validation_timed_out"; data: ValidationExecutionEvent }
	| { type: "validation_process_killed"; data: ValidationExecutionEvent }
	| { type: "queue_depth_change"; data: ValidationQueueDepthChangeEvent }
	| { type: "validation_stats_snapshot"; data: ValidationStatsSnapshotEvent };

/**
 * Cooldown tracking for the validation collector.
 */
export interface ValidationCollectorCooldown {
	/** ISO 8601 timestamp when cooldown expires (null if not in cooldown) */
	expiresAt: string | null;
	/** Human-readable reason for the cooldown */
	reason: string | null;
	/** How many times this key has been collected (for diagnostics) */
	collectionCount: number;
	/** ISO 8601 timestamp of last collection */
	lastCollectedAt: string | null;
}

/**
 * Deduplication tracking entry.
 */
export interface ValidationCollectorDedupeEntry {
	/** Content hash for deduplication */
	contentHash: string;
	/** ISO 8601 timestamp of first occurrence */
	firstSeenAt: string;
	/** Number of suppressed duplicates */
	suppressedCount: number;
}

/**
 * Budget configuration for validation collection.
 */
export interface ValidationCollectorBudget {
	/** Maximum events to collect per collection cycle (default: 25) */
	maxPerCycle: number;
	/** Maximum total events retained in the collector buffer (default: 200) */
	maxTotal: number;
	/** Maximum CPU time (ms) spent collecting per cycle (default: 150) */
	maxTimeMs: number;
}

/**
 * Default budget for validation collection.
 */
export const DEFAULT_VALIDATION_COLLECTOR_BUDGET: ValidationCollectorBudget = {
	maxPerCycle: 20,
	maxTotal: 200,
	maxTimeMs: 150,
};

/**
 * Deduplication configuration.
 */
export interface ValidationCollectorDedupeConfig {
	/** Whether deduplication is enabled (default: true) */
	enabled: boolean;
	/** Time window in ms for considering events as duplicates (default: 30_000) */
	windowMs: number;
}

/**
 * Default dedupe configuration.
 */
export const DEFAULT_VALIDATION_COLLECTOR_DEDUPE: ValidationCollectorDedupeConfig = {
	enabled: true,
	windowMs: 30_000,
};

/**
 * Stop condition for validation collection.
 */
export interface ValidationCollectorStopCondition {
	/** Whether the stop condition has been triggered */
	triggered: boolean;
	/** Human-readable condition description */
	condition: string;
	/** ISO 8601 timestamp when triggered (null if not triggered) */
	triggeredAt: string | null;
	/** Additional detail */
	detail: string | null;
}

/**
 * Full diagnostic state for the validation collector.
 */
export interface ValidationCollectorDiagnostics {
	/** Total events collected since creation */
	totalCollected: number;
	/** Total events deduplicated (suppressed) */
	totalDeduplicated: number;
	/** Number of cycles that hit the maxPerCycle budget */
	cyclesHitBudget: number;
	/** Number of cycles that hit the maxTimeMs budget */
	cyclesHitTimeLimit: number;
	/** Current buffer size */
	bufferSize: number;
	/** Cooldown states by key */
	cooldowns: Record<string, ValidationCollectorCooldown>;
	/** Stop condition states */
	stopConditions: ValidationCollectorStopCondition[];
	/** Whether the collector has been stopped */
	stopped: boolean;
	/** Error message if the collector is in an error state */
	error: string | null;
	/** Event type counts since creation */
	eventTypeCounts: Record<string, number>;
	/** Aggregate validation statistics (incremental) */
	aggregateStats: {
		totalValidations: number;
		passedCount: number;
		failedCount: number;
		timedOutCount: number;
		killedCount: number;
		totalDurationMs: number;
	};
}

/**
 * Collected validation buffer entry.
 */
export interface ValidationCollectorBufferEntry {
	/** The observability event */
	event: ObservabilityEvent;
	/** Original validation event type (for filtering) */
	validationEventType: string;
	/** ISO 8601 timestamp of collection */
	collectedAt: string;
	/** Source component name */
	source: string;
	/** Plan execution ID this event belongs to */
	planExecutionId: string;
}

// ─────────────────────────────────────────────────────────────────────
// ValidationCollector
// ─────────────────────────────────────────────────────────────────────
// Constants for Validation Event Identification
// ─────────────────────────────────────────────────────────────────────

/**
 * Set of execution-kernel validation event types.
 */
export const VALIDATION_EVENT_TYPES: ReadonlySet<string> = new Set([
	"validation_lane_requested",
	"validation_lane_acquired",
	"validation_started",
	"validation_passed",
	"validation_failed",
	"validation_timed_out",
	"validation_process_killed",
]);

/**
 * Check if an event type is a validation event type.
 */
export function isValidationEventType(type: string): boolean {
	return VALIDATION_EVENT_TYPES.has(type);
}

// ─────────────────────────────────────────────────────────────────────

/**
 * Collects validation-specific events as observability events.
 *
 * Handles validation lane state, lock lifecycle, execution-kernel
 * validation attempt events, and aggregate statistics.
 *
 * All autonomous behavior respects budget, cooldown, dedupe, and
 * stop-condition constraints.
 */
export class ValidationCollector {
	private buffer: ValidationCollectorBufferEntry[] = [];
	private cooldowns: Map<string, ValidationCollectorCooldown> = new Map();
	private dedupeEntries: Map<string, ValidationCollectorDedupeEntry> = new Map();
	private stopConditions: ValidationCollectorStopCondition[] = [];

	private totalCollected = 0;
	private totalDeduplicated = 0;
	private cyclesHitBudget = 0;
	private cyclesHitTimeLimit = 0;
	private stopped = false;
	private error: string | null = null;
	private eventTypeCounts: Record<string, number> = {};

	/** Aggregate validation statistics (incremental) */
	private aggregateStats = {
		totalValidations: 0,
		passedCount: 0,
		failedCount: 0,
		timedOutCount: 0,
		killedCount: 0,
		totalDurationMs: 0,
	};

	private budget: ValidationCollectorBudget;
	private dedupeConfig: ValidationCollectorDedupeConfig;
	private cooldownMs: number;

	/**
	 * Check if an AttemptEvent is a validation event.
	 */
	static isValidationEvent(event: AttemptEvent): boolean {
		return VALIDATION_EVENT_TYPES.has(event.type);
	}

	constructor(
		budget?: Partial<ValidationCollectorBudget>,
		dedupeConfig?: Partial<ValidationCollectorDedupeConfig>,
		cooldownMs = 10_000,
	) {
		this.budget = { ...DEFAULT_VALIDATION_COLLECTOR_BUDGET, ...budget };
		this.dedupeConfig = { ...DEFAULT_VALIDATION_COLLECTOR_DEDUPE, ...dedupeConfig };
		this.cooldownMs = cooldownMs;
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Update budget configuration.
	 */
	setBudget(budget: Partial<ValidationCollectorBudget>): void {
		this.budget = { ...this.budget, ...budget };
	}

	/**
	 * Get current budget configuration.
	 */
	getBudget(): ValidationCollectorBudget {
		return { ...this.budget };
	}

	/**
	 * Update deduplication configuration.
	 */
	setDedupeConfig(config: Partial<ValidationCollectorDedupeConfig>): void {
		this.dedupeConfig = { ...this.dedupeConfig, ...config };
	}

	/**
	 * Get current dedupe configuration.
	 */
	getDedupeConfig(): ValidationCollectorDedupeConfig {
		return { ...this.dedupeConfig };
	}

	/**
	 * Set cooldown duration in milliseconds.
	 */
	setCooldownMs(ms: number): void {
		this.cooldownMs = ms;
	}

	/**
	 * Get current cooldown duration.
	 */
	getCooldownMs(): number {
		return this.cooldownMs;
	}

	// ── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Check whether the collector is stopped.
	 */
	isStopped(): boolean {
		return this.stopped;
	}

	/**
	 * Stop the collector. Prevents further collection until reset().
	 */
	stop(condition?: string, detail?: string): void {
		this.stopped = true;
		if (condition) {
			this.stopConditions.push({
				triggered: true,
				condition,
				triggeredAt: new Date().toISOString(),
				detail: detail ?? null,
			});
		}
	}

	/**
	 * Reset the collector to its initial state, clearing all state.
	 */
	reset(): void {
		this.buffer = [];
		this.cooldowns.clear();
		this.dedupeEntries.clear();
		this.stopConditions = [];
		this.totalCollected = 0;
		this.totalDeduplicated = 0;
		this.cyclesHitBudget = 0;
		this.cyclesHitTimeLimit = 0;
		this.stopped = false;
		this.error = null;
		this.eventTypeCounts = {};
		this.aggregateStats = {
			totalValidations: 0,
			passedCount: 0,
			failedCount: 0,
			timedOutCount: 0,
			killedCount: 0,
			totalDurationMs: 0,
		};
	}

	// ── Stop conditions ──────────────────────────────────────────────

	/**
	 * Add a stop condition to the collector.
	 */
	addStopCondition(condition: string, detail?: string): void {
		this.stopConditions.push({
			triggered: false,
			condition,
			triggeredAt: null,
			detail: detail ?? null,
		});
	}

	/**
	 * Trigger a stop condition by key/condition name.
	 */
	triggerStopCondition(conditionName: string): boolean {
		for (const sc of this.stopConditions) {
			if (sc.condition === conditionName && !sc.triggered) {
				sc.triggered = true;
				sc.triggeredAt = new Date().toISOString();
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if any stop condition is triggered.
	 */
	hasStopConditionTriggered(): boolean {
		return this.stopConditions.some((sc) => sc.triggered);
	}

	/**
	 * Get all stop conditions.
	 */
	getStopConditions(): ValidationCollectorStopCondition[] {
		return this.stopConditions.map((sc) => ({ ...sc }));
	}

	// ── Collection ───────────────────────────────────────────────────

	/**
	 * Collect a validation event from the validation event payload type.
	 *
	 * @param event - The validation event payload to collect
	 * @returns The collected observability event, or null if suppressed
	 *          by budget, cooldown, dedupe, or stop condition
	 */
	collectValidationEvent(event: ValidationEventPayload): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `validation:${event.type}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		const contentHash = this.computeContentHash(event as unknown as Record<string, unknown>);

		// Dedupe check
		const timestamp = event.data.timestamp;
		if (this.isDuplicate(contentHash, timestamp)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const obsEvent = this.validationEventPayloadToObservabilityEvent(event);

		this.updateAggregateStats(event);

		const planExecutionId = event.data.planExecutionId;
		this.addToBuffer(obsEvent, event.type, planExecutionId);
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, timestamp);

		this.totalCollected++;
		this.eventTypeCounts[event.type] = (this.eventTypeCounts[event.type] ?? 0) + 1;

		// Time budget check
		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return obsEvent;
	}

	/**
	 * Collect an execution kernel AttemptEvent that is validation-related.
	 *
	 * Convenience method for extracting validation events from the kernel
	 * event stream without having to manually map them to ValidationEventPayload.
	 *
	 * @param event - The AttemptEvent to collect (only validation types are processed)
	 * @returns The collected observability event, or null if suppressed or not a validation type
	 */
	collectExecutionEvent(event: AttemptEvent): ObservabilityEvent | null {
		const executionEvent = this.attemptEventToValidationPayload(event);
		if (!executionEvent) return null;
		return this.collectValidationEvent(executionEvent);
	}

	/**
	 * Collect a batch of validation events in a single cycle.
	 *
	 * Respects per-cycle budget (maxPerCycle) and time budget (maxTimeMs).
	 * Returns the number of events successfully collected.
	 *
	 * @param events - Array of validation event payloads to collect
	 * @returns Count of successfully collected events
	 */
	collectBatch(events: ValidationEventPayload[]): number {
		if (this.stopped) return 0;
		if (this.hasStopConditionTriggered()) return 0;

		const startTime = Date.now();
		let collected = 0;

		for (const event of events) {
			if (collected >= this.budget.maxPerCycle) {
				this.cyclesHitBudget++;
				break;
			}
			const elapsed = Date.now() - startTime;
			if (elapsed >= this.budget.maxTimeMs) {
				this.cyclesHitTimeLimit++;
				break;
			}
			if (this.collectValidationEvent(event) !== null) {
				collected++;
			}
		}

		return collected;
	}

	/**
	 * Collect a batch of execution events (validation-related only).
	 *
	 * @param events - Array of AttemptEvent records
	 * @returns Count of successfully collected events
	 */
	collectExecutionBatch(events: AttemptEvent[]): number {
		if (this.stopped) return 0;
		if (this.hasStopConditionTriggered()) return 0;

		const startTime = Date.now();
		let collected = 0;

		for (const event of events) {
			if (collected >= this.budget.maxPerCycle) {
				this.cyclesHitBudget++;
				break;
			}
			const elapsed = Date.now() - startTime;
			if (elapsed >= this.budget.maxTimeMs) {
				this.cyclesHitTimeLimit++;
				break;
			}
			if (this.collectExecutionEvent(event) !== null) {
				collected++;
			}
		}

		return collected;
	}

	// ── Convenience methods for lane events ──────────────────────────

	/**
	 * Collect a validation lane saturation event.
	 */
	collectLaneSaturated(event: ValidationLaneSaturatedEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "lane_saturated", data: event });
	}

	/**
	 * Collect a lane backpressure active event.
	 */
	collectLaneBackpressureActive(event: ValidationLaneBackpressureEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "lane_backpressure_active", data: event });
	}

	/**
	 * Collect a lane backpressure cleared event.
	 */
	collectLaneBackpressureCleared(event: ValidationLaneBackpressureEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "lane_backpressure_cleared", data: event });
	}

	// ── Convenience methods for lock events ──────────────────────────

	/**
	 * Collect a validation lock waiting event.
	 */
	collectLockWaiting(event: ValidationLockEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "lock_waiting", data: event });
	}

	/**
	 * Collect a validation lock acquired event.
	 */
	collectLockAcquired(event: ValidationLockEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "lock_acquired", data: event });
	}

	/**
	 * Collect a validation lock released event.
	 */
	collectLockReleased(event: ValidationLockEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "lock_released", data: event });
	}

	// ── Convenience methods for queue / stats events ─────────────────

	/**
	 * Collect a validation queue depth change event.
	 */
	collectQueueDepthChange(event: ValidationQueueDepthChangeEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "queue_depth_change", data: event });
	}

	/**
	 * Collect a validation stats snapshot event.
	 */
	collectStatsSnapshot(event: ValidationStatsSnapshotEvent): ObservabilityEvent | null {
		return this.collectValidationEvent({ type: "validation_stats_snapshot", data: event });
	}

	// ── Buffer Access ────────────────────────────────────────────────

	/**
	 * Drain all buffered events and return them.
	 * Clears the buffer after draining.
	 *
	 * @returns Array of buffered observability events (without metadata)
	 */
	drain(): ObservabilityEvent[] {
		const events = this.buffer.map((e) => e.event);
		this.buffer = [];
		return events;
	}

	/**
	 * Drain all buffered entries with full metadata.
	 * Clears the buffer after draining.
	 *
	 * @returns Array of buffered entries with full metadata
	 */
	drainEntries(): ValidationCollectorBufferEntry[] {
		const entries = [...this.buffer];
		this.buffer = [];
		return entries;
	}

	/**
	 * Get current buffer size.
	 */
	bufferSize(): number {
		return this.buffer.length;
	}

	/**
	 * Get all buffered entries without draining.
	 */
	peek(limit?: number): ValidationCollectorBufferEntry[] {
		if (limit && limit > 0) {
			return this.buffer.slice(0, limit);
		}
		return [...this.buffer];
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get full diagnostics including cooldowns, dedupe stats, budget hits.
	 */
	getDiagnostics(): ValidationCollectorDiagnostics {
		const cooldownsRecord: Record<string, ValidationCollectorCooldown> = {};
		for (const [key, value] of this.cooldowns) {
			cooldownsRecord[key] = { ...value };
		}

		return {
			totalCollected: this.totalCollected,
			totalDeduplicated: this.totalDeduplicated,
			cyclesHitBudget: this.cyclesHitBudget,
			cyclesHitTimeLimit: this.cyclesHitTimeLimit,
			bufferSize: this.buffer.length,
			cooldowns: cooldownsRecord,
			stopConditions: this.getStopConditions(),
			stopped: this.stopped,
			error: this.error,
			eventTypeCounts: { ...this.eventTypeCounts },
			aggregateStats: { ...this.aggregateStats },
		};
	}

	/**
	 * Get the current aggregate validation statistics.
	 */
	getAggregateStats(): ValidationCollectorDiagnostics["aggregateStats"] {
		return { ...this.aggregateStats };
	}

	/**
	 * Set an error state with a diagnostic message.
	 */
	setError(message: string): void {
		this.error = message;
	}

	/**
	 * Clear the error state.
	 */
	clearError(): void {
		this.error = null;
	}

	// ── Private: Event Conversion ────────────────────────────────────

	/**
	 * Convert a validation event payload to an ObservabilityEvent.
	 */
	private validationEventPayloadToObservabilityEvent(event: ValidationEventPayload): ObservabilityEvent {
		const ctx = createTraceContext({
			name: `validation/${event.type}`,
			planExecutionId: event.data.planExecutionId,
		});

		const severity = this.mapValidationTypeToSeverity(event.type);
		const status = this.mapValidationTypeToStatus(event.type);

		return createObservabilityEvent(ctx, {
			eventType: `validation_${event.type}`,
			source: "execution-kernel/validation",
			severity,
			status,
			name: `validation:${event.type}`,
			message: this.extractValidationMessage(event),
			data: {
				validationEventType: event.type,
				payload: event.data as unknown as Record<string, unknown>,
			},
			error: this.extractValidationError(event),
		});
	}

	/**
	 * Convert an AttemptEvent to a ValidationEventPayload, if it is a
	 * validation-related event. Returns null for non-validation events.
	 */
	private attemptEventToValidationPayload(event: AttemptEvent): ValidationEventPayload | null {
		const payload = event.payload as unknown as Record<string, unknown>;

		switch (event.type) {
			case "validation_lane_requested": {
				const lanePayload = payload as unknown as { laneType: "heavy" | "targeted" };
				return {
					type: "validation_lane_requested",
					data: {
						planExecutionId: event.planExecutionId,
						workspaceExecutionId: event.workspaceId,
						attemptId: event.attemptId,
						command: null,
						durationMs: null,
						error: null,
						laneType: lanePayload.laneType ?? null,
						output: null,
						pid: null,
						signal: null,
						timeoutMs: null,
						timestamp: event.createdAt,
					},
				};
			}
			case "validation_lane_acquired": {
				const lanePayload = payload as unknown as { laneType: "heavy" | "targeted" };
				return {
					type: "validation_lane_acquired",
					data: {
						planExecutionId: event.planExecutionId,
						workspaceExecutionId: event.workspaceId,
						attemptId: event.attemptId,
						command: null,
						durationMs: null,
						error: null,
						laneType: lanePayload.laneType ?? null,
						output: null,
						pid: null,
						signal: null,
						timeoutMs: null,
						timestamp: event.createdAt,
					},
				};
			}
			case "validation_started": {
				const startedPayload = payload as unknown as ValidationStartedPayload;
				return {
					type: "validation_started",
					data: {
						planExecutionId: event.planExecutionId,
						workspaceExecutionId: event.workspaceId,
						attemptId: event.attemptId,
						command: startedPayload.command ?? null,
						durationMs: null,
						error: null,
						laneType: null,
						output: null,
						pid: null,
						signal: null,
						timeoutMs: startedPayload.timeoutMs ?? null,
						timestamp: event.createdAt,
					},
				};
			}
			case "validation_passed": {
				const passedPayload = payload as unknown as ValidationPassedPayload;
				return {
					type: "validation_passed",
					data: {
						planExecutionId: event.planExecutionId,
						workspaceExecutionId: event.workspaceId,
						attemptId: event.attemptId,
						command: null,
						durationMs: passedPayload.durationMs ?? null,
						error: null,
						laneType: null,
						output: passedPayload.output ?? null,
						pid: null,
						signal: null,
						timeoutMs: null,
						timestamp: event.createdAt,
					},
				};
			}
			case "validation_failed": {
				const failedPayload = payload as unknown as ValidationFailedPayload;
				return {
					type: "validation_failed",
					data: {
						planExecutionId: event.planExecutionId,
						workspaceExecutionId: event.workspaceId,
						attemptId: event.attemptId,
						command: null,
						durationMs: failedPayload.durationMs ?? null,
						error: failedPayload.error ?? null,
						laneType: null,
						output: failedPayload.output ?? null,
						pid: null,
						signal: null,
						timeoutMs: null,
						timestamp: event.createdAt,
					},
				};
			}
			case "validation_timed_out": {
				const timeoutPayload = payload as unknown as ValidationTimedOutPayload;
				return {
					type: "validation_timed_out",
					data: {
						planExecutionId: event.planExecutionId,
						workspaceExecutionId: event.workspaceId,
						attemptId: event.attemptId,
						command: timeoutPayload.command ?? null,
						durationMs: null,
						error: `Timed out after ${timeoutPayload.timeoutMs}ms`,
						laneType: null,
						output: timeoutPayload.outputTruncated ?? null,
						pid: null,
						signal: null,
						timeoutMs: timeoutPayload.timeoutMs ?? null,
						timestamp: event.createdAt,
					},
				};
			}
			case "validation_process_killed": {
				const killedPayload = payload as unknown as ValidationProcessKilledPayload;
				return {
					type: "validation_process_killed",
					data: {
						planExecutionId: event.planExecutionId,
						workspaceExecutionId: event.workspaceId,
						attemptId: event.attemptId,
						command: null,
						durationMs: null,
						error: `Process killed (signal ${killedPayload.signal})`,
						laneType: null,
						output: null,
						pid: killedPayload.pid ?? null,
						signal: killedPayload.signal ?? null,
						timeoutMs: null,
						timestamp: event.createdAt,
					},
				};
			}
			default:
				return null;
		}
	}

	/**
	 * Extract a human-readable message from a validation event.
	 */
	private extractValidationMessage(event: ValidationEventPayload): string | null {
		switch (event.type) {
			case "lane_saturated":
				return `Validation lane saturated (${event.data.heavyCount}/${event.data.maxHeavy} heavy, ${event.data.targetedCount}/${event.data.maxTargeted} targeted)`;
			case "lane_backpressure_active":
				return `Validation lane backpressure active: ${event.data.reason} (${event.data.heavyCount} heavy, ${event.data.targetedCount} targeted)`;
			case "lane_backpressure_cleared":
				return `Validation lane backpressure cleared: ${event.data.reason}`;
			case "lock_waiting":
				return `Validation lock waiting (workspace ${event.data.workspaceExecutionId})`;
			case "lock_acquired":
				return `Validation lock acquired after ${event.data.waitDurationMs}ms wait`;
			case "lock_released":
				return `Validation lock released after ${event.data.holdDurationMs}ms hold`;
			case "validation_lane_requested":
				return `Validation lane requested: ${event.data.laneType}`;
			case "validation_lane_acquired":
				return `Validation lane acquired: ${event.data.laneType}`;
			case "validation_started":
				return `Validation started: ${event.data.command}`;
			case "validation_passed":
				return `Validation passed (${event.data.durationMs}ms)`;
			case "validation_failed":
				return `Validation failed: ${event.data.error}`;
			case "validation_timed_out":
				return `Validation timed out (${event.data.timeoutMs}ms)`;
			case "validation_process_killed":
				return `Validation process killed (PID ${event.data.pid}, signal ${event.data.signal})`;
			case "queue_depth_change":
				return `Validation queue depth: ${event.data.previousDepth} -> ${event.data.queueDepth} (heavy: ${event.data.heavyQueueDepth}, targeted: ${event.data.targetedQueueDepth})`;
			case "validation_stats_snapshot":
				return `Validation stats: ${event.data.passedCount}/${event.data.totalValidations} passed, avg ${Math.round(event.data.averageDurationMs)}ms`;
			default:
				return `Validation event: ${(event as unknown as { type: string }).type}`;
		}
	}

	/**
	 * Extract an error from a validation event, if applicable.
	 */
	private extractValidationError(event: ValidationEventPayload): string | null {
		switch (event.type) {
			case "lane_saturated":
				return `Validation lane saturated (heavy: ${event.data.heavyCount}/${event.data.maxHeavy})`;
			case "validation_failed":
				return event.data.error ?? "Validation failed";
			case "validation_timed_out":
				return `Validation timed out after ${event.data.timeoutMs}ms`;
			case "validation_process_killed":
				return `Validation process killed (signal ${event.data.signal})`;
			default:
				return null;
		}
	}

	/**
	 * Map validation event type to an observability severity.
	 */
	private mapValidationTypeToSeverity(type: ValidationEventType): ObservabilitySeverity {
		switch (type) {
			case "validation_failed":
			case "validation_timed_out":
			case "validation_process_killed":
				return "error";
			case "lane_saturated":
			case "lane_backpressure_active":
				return "warning";
			default:
				return "info";
		}
	}

	/**
	 * Map validation event type to an observability status.
	 */
	private mapValidationTypeToStatus(type: ValidationEventType): ObservabilityStatus {
		switch (type) {
			case "validation_failed":
			case "validation_timed_out":
			case "validation_process_killed":
				return "error";
			case "validation_passed":
			case "lane_backpressure_cleared":
			case "lock_released":
				return "ok";
			case "validation_started":
			case "validation_lane_requested":
			case "validation_lane_acquired":
			case "lock_acquired":
			case "lock_waiting":
				return "running";
			default:
				return "unknown";
		}
	}

	/**
	 * Update incremental aggregate statistics based on event type.
	 */
	private updateAggregateStats(event: ValidationEventPayload): void {
		switch (event.type) {
			case "validation_passed":
				this.aggregateStats.totalValidations++;
				this.aggregateStats.passedCount++;
				if (event.data.durationMs != null) {
					this.aggregateStats.totalDurationMs += event.data.durationMs;
				}
				break;
			case "validation_failed":
				this.aggregateStats.totalValidations++;
				this.aggregateStats.failedCount++;
				if (event.data.durationMs != null) {
					this.aggregateStats.totalDurationMs += event.data.durationMs;
				}
				break;
			case "validation_timed_out":
				this.aggregateStats.totalValidations++;
				this.aggregateStats.timedOutCount++;
				break;
			case "validation_process_killed":
				this.aggregateStats.totalValidations++;
				this.aggregateStats.killedCount++;
				break;
		}
	}

	private addToBuffer(event: ObservabilityEvent, validationEventType: string, planExecutionId: string): void {
		const entry: ValidationCollectorBufferEntry = {
			event,
			validationEventType,
			source: "execution-kernel/validation",
			collectedAt: new Date().toISOString(),
			planExecutionId,
		};
		this.buffer.push(entry);
	}

	private computeContentHash(data: Record<string, unknown>): string {
		const hash = createHash("sha256");
		const stable = {
			type: data.type ?? "unknown",
			planExecutionId: (data.data as Record<string, unknown>)?.planExecutionId ?? "unknown",
			workspaceExecutionId: (data.data as Record<string, unknown>)?.workspaceExecutionId ?? "unknown",
		};
		hash.update(JSON.stringify(stable));
		return hash.digest("hex");
	}

	private isDuplicate(contentHash: string, timestamp: string): boolean {
		if (!this.dedupeConfig.enabled) return false;

		const existing = this.dedupeEntries.get(contentHash);
		if (!existing) return false;

		const eventTime = new Date(timestamp).getTime();
		const firstTime = new Date(existing.firstSeenAt).getTime();
		const elapsed = eventTime - firstTime;

		if (elapsed <= this.dedupeConfig.windowMs) {
			existing.suppressedCount++;
			this.totalDeduplicated++;
			return true;
		}

		this.dedupeEntries.delete(contentHash);
		return false;
	}

	private trackDedupe(contentHash: string, timestamp: string): void {
		if (!this.dedupeConfig.enabled) return;
		this.dedupeEntries.set(contentHash, {
			contentHash,
			firstSeenAt: timestamp,
			suppressedCount: 0,
		});
	}

	private isOnCooldown(key: string): boolean {
		const cooldown = this.cooldowns.get(key);
		if (!cooldown || !cooldown.expiresAt) return false;

		const now = Date.now();
		const expires = new Date(cooldown.expiresAt).getTime();

		if (now < expires) {
			return true;
		}

		this.cooldowns.delete(key);
		return false;
	}

	private trackCooldown(key: string, reason?: string): void {
		const expiresAt = new Date(Date.now() + this.cooldownMs).toISOString();
		const existing = this.cooldowns.get(key);

		this.cooldowns.set(key, {
			expiresAt,
			reason: reason ?? null,
			collectionCount: (existing?.collectionCount ?? 0) + 1,
			lastCollectedAt: new Date().toISOString(),
		});
	}
}
