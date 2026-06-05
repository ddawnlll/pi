/**
 * Scheduler Collector — Workspace 25.F
 *
 * Collects workspace scheduler state changes, slot allocations, and
 * bottleneck diagnostics from the execution engine and converts them
 * into standardized ObservabilityEvent records for the telemetry store.
 *
 * Tracks:
 * - Scheduler slot allocation and release events
 * - Worker pool utilization changes
 * - Bottleneck detection events
 * - Plan-level scheduling decisions
 * - Workspace stage transitions (pending, active, complete, blocked, failed)
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
 * @module observability/collectors/execution/scheduler-collector
 */

import { createHash } from "node:crypto";
import type { WorkspaceStage } from "../../../platform/types.js";
import { createObservabilityEvent, createTraceContext } from "../../schema.js";
import type { ObservabilityEvent, ObservabilitySeverity, ObservabilityStatus } from "../../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Scheduler event types for collection.
 */
export type SchedulerEventType =
	| "slot_allocated"
	| "slot_released"
	| "slot_rejected"
	| "worker_pool_change"
	| "bottleneck_detected"
	| "bottleneck_cleared"
	| "schedule_decision"
	| "workspace_stage_change"
	| "plan_state_change";

/**
 * All valid SchedulerEventType values.
 */
export const ALL_SCHEDULER_EVENT_TYPES: SchedulerEventType[] = [
	"slot_allocated",
	"slot_released",
	"slot_rejected",
	"worker_pool_change",
	"bottleneck_detected",
	"bottleneck_cleared",
	"schedule_decision",
	"workspace_stage_change",
	"plan_state_change",
];

/**
 * Scheduler event for slot allocation.
 */
export interface SlotAllocationEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace execution ID */
	workspaceExecutionId: string;
	/** Worker slot index */
	slotIndex: number;
	/** Total slots after allocation */
	totalSlots: number;
	/** Active slots after allocation */
	activeSlots: number;
	/** Timestamp of the allocation */
	timestamp: string;
}

/**
 * Scheduler event for slot release.
 */
export interface SlotReleaseEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace execution ID */
	workspaceExecutionId: string;
	/** Worker slot index */
	slotIndex: number;
	/** Total slots after release */
	totalSlots: number;
	/** Active slots after release */
	activeSlots: number;
	/** Reason for release */
	reason: string;
	/** Timestamp of the release */
	timestamp: string;
}

/**
 * Scheduler event for slot rejection.
 */
export interface SlotRejectedEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace execution ID */
	workspaceExecutionId: string;
	/** Reason for rejection */
	reason: string;
	/** Number of available slots at rejection time */
	availableSlots: number;
	/** Timestamp of the rejection */
	timestamp: string;
}

/**
 * Scheduler event for worker pool change.
 */
export interface WorkerPoolChangeEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Previous max worker count */
	previousMax: number;
	/** New max worker count */
	newMax: number;
	/** Reason for the change */
	reason: string;
	/** Timestamp of the change */
	timestamp: string;
}

/**
 * Scheduler event for bottleneck detection.
 */
export interface BottleneckDetectedEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** List of bottleneck reason strings */
	reasons: string[];
	/** Current active worker count */
	activeWorkers: number;
	/** Total available slots */
	totalSlots: number;
	/** Number of pending workspaces */
	pendingCount: number;
	/** Number of blocked workspaces */
	blockedCount: number;
	/** Timestamp of detection */
	timestamp: string;
}

/**
 * Scheduler event for bottleneck cleared.
 */
export interface BottleneckClearedEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Timestamp of clearance */
	timestamp: string;
}

/**
 * Scheduler event for a schedule decision.
 */
export interface ScheduleDecisionEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Decision type (e.g., "schedule_next", "wait", "pause") */
	decision: string;
	/** Reason for the decision */
	reason: string;
	/** Number of candidate workspaces considered */
	candidatesConsidered: number;
	/** Timestamp of the decision */
	timestamp: string;
}

/**
 * Scheduler event for workspace stage change.
 */
export interface WorkspaceStageChangeEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace execution ID */
	workspaceExecutionId: string;
	/** Previous workspace stage */
	previousStage: WorkspaceStage;
	/** New workspace stage */
	newStage: WorkspaceStage;
	/** Timestamp of the change */
	timestamp: string;
}

/**
 * Scheduler event for plan state change.
 */
export interface PlanStateChangeEvent {
	/** Plan execution ID */
	planExecutionId: string;
	/** Previous progress percentage */
	previousProgress: number;
	/** New progress percentage */
	newProgress: number;
	/** Total workspaces */
	totalWorkspaces: number;
	/** Completed workspaces */
	completedCount: number;
	/** Failed workspaces */
	failedCount: number;
	/** Timestamp of the change */
	timestamp: string;
}

/**
 * Union type for all scheduler event payloads.
 */
export type SchedulerEventPayload =
	| { type: "slot_allocated"; data: SlotAllocationEvent }
	| { type: "slot_released"; data: SlotReleaseEvent }
	| { type: "slot_rejected"; data: SlotRejectedEvent }
	| { type: "worker_pool_change"; data: WorkerPoolChangeEvent }
	| { type: "bottleneck_detected"; data: BottleneckDetectedEvent }
	| { type: "bottleneck_cleared"; data: BottleneckClearedEvent }
	| { type: "schedule_decision"; data: ScheduleDecisionEvent }
	| { type: "workspace_stage_change"; data: WorkspaceStageChangeEvent }
	| { type: "plan_state_change"; data: PlanStateChangeEvent };

/**
 * Cooldown tracking for the scheduler collector.
 */
export interface SchedulerCollectorCooldown {
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
export interface SchedulerCollectorDedupeEntry {
	/** Content hash for deduplication */
	contentHash: string;
	/** ISO 8601 timestamp of first occurrence */
	firstSeenAt: string;
	/** Number of suppressed duplicates */
	suppressedCount: number;
}

/**
 * Budget configuration for scheduler collection.
 */
export interface SchedulerCollectorBudget {
	/** Maximum events to collect per collection cycle (default: 30) */
	maxPerCycle: number;
	/** Maximum total events retained in the collector buffer (default: 300) */
	maxTotal: number;
	/** Maximum CPU time (ms) spent collecting per cycle (default: 150) */
	maxTimeMs: number;
}

/**
 * Default budget for scheduler collection.
 */
export const DEFAULT_SCHEDULER_COLLECTOR_BUDGET: SchedulerCollectorBudget = {
	maxPerCycle: 30,
	maxTotal: 300,
	maxTimeMs: 150,
};

/**
 * Deduplication configuration.
 */
export interface SchedulerCollectorDedupeConfig {
	/** Whether deduplication is enabled (default: true) */
	enabled: boolean;
	/** Time window in ms for considering events as duplicates (default: 30_000) */
	windowMs: number;
}

/**
 * Default dedupe configuration.
 */
export const DEFAULT_SCHEDULER_COLLECTOR_DEDUPE: SchedulerCollectorDedupeConfig = {
	enabled: true,
	windowMs: 30_000,
};

/**
 * Stop condition for scheduler collection.
 */
export interface SchedulerCollectorStopCondition {
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
 * Full diagnostic state for the scheduler collector.
 */
export interface SchedulerCollectorDiagnostics {
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
	cooldowns: Record<string, SchedulerCollectorCooldown>;
	/** Stop condition states */
	stopConditions: SchedulerCollectorStopCondition[];
	/** Whether the collector has been stopped */
	stopped: boolean;
	/** Error message if the collector is in an error state */
	error: string | null;
	/** Event type counts since creation */
	eventTypeCounts: Record<string, number>;
}

/**
 * Collected scheduler buffer entry.
 */
export interface SchedulerCollectorBufferEntry {
	/** The observability event */
	event: ObservabilityEvent;
	/** Original scheduler event type (for filtering) */
	schedulerEventType: string;
	/** ISO 8601 timestamp of collection */
	collectedAt: string;
	/** Source component name */
	source: string;
	/** Plan execution ID this event belongs to */
	planExecutionId: string;
}

// ─────────────────────────────────────────────────────────────────────
// SchedulerCollector
// ─────────────────────────────────────────────────────────────────────

/**
 * Collects scheduler state changes and slot events as observability events.
 *
 * Handles all SchedulerEventType variants and converts them into
 * ObservabilityEvent format for telemetry storage.
 *
 * All autonomous behavior respects budget, cooldown, dedupe, and
 * stop-condition constraints.
 */
export class SchedulerCollector {
	private buffer: SchedulerCollectorBufferEntry[] = [];
	private cooldowns: Map<string, SchedulerCollectorCooldown> = new Map();
	private dedupeEntries: Map<string, SchedulerCollectorDedupeEntry> = new Map();
	private stopConditions: SchedulerCollectorStopCondition[] = [];

	private totalCollected = 0;
	private totalDeduplicated = 0;
	private cyclesHitBudget = 0;
	private cyclesHitTimeLimit = 0;
	private stopped = false;
	private error: string | null = null;
	private eventTypeCounts: Record<string, number> = {};

	private budget: SchedulerCollectorBudget;
	private dedupeConfig: SchedulerCollectorDedupeConfig;
	private cooldownMs: number;

	constructor(
		budget?: Partial<SchedulerCollectorBudget>,
		dedupeConfig?: Partial<SchedulerCollectorDedupeConfig>,
		cooldownMs = 10_000,
	) {
		this.budget = { ...DEFAULT_SCHEDULER_COLLECTOR_BUDGET, ...budget };
		this.dedupeConfig = { ...DEFAULT_SCHEDULER_COLLECTOR_DEDUPE, ...dedupeConfig };
		this.cooldownMs = cooldownMs;
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Update budget configuration.
	 */
	setBudget(budget: Partial<SchedulerCollectorBudget>): void {
		this.budget = { ...this.budget, ...budget };
	}

	/**
	 * Get current budget configuration.
	 */
	getBudget(): SchedulerCollectorBudget {
		return { ...this.budget };
	}

	/**
	 * Update deduplication configuration.
	 */
	setDedupeConfig(config: Partial<SchedulerCollectorDedupeConfig>): void {
		this.dedupeConfig = { ...this.dedupeConfig, ...config };
	}

	/**
	 * Get current dedupe configuration.
	 */
	getDedupeConfig(): SchedulerCollectorDedupeConfig {
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
	getStopConditions(): SchedulerCollectorStopCondition[] {
		return this.stopConditions.map((sc) => ({ ...sc }));
	}

	// ── Collection ───────────────────────────────────────────────────

	/**
	 * Collect a scheduler event.
	 *
	 * @param event - The scheduler event payload to collect
	 * @returns The collected observability event, or null if suppressed
	 *          by budget, cooldown, dedupe, or stop condition
	 */
	collectSchedulerEvent(event: SchedulerEventPayload): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `scheduler:${event.type}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		const contentHash = this.computeContentHash(event as unknown as Record<string, unknown>);

		// Dedupe check (use event timestamp)
		const timestamp = event.data.timestamp;
		if (this.isDuplicate(contentHash, timestamp)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const obsEvent = this.schedulerEventToObservabilityEvent(event);

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
	 * Collect a batch of scheduler events in a single cycle.
	 *
	 * Respects per-cycle budget (maxPerCycle) and time budget (maxTimeMs).
	 * Returns the number of events successfully collected.
	 *
	 * @param events - Array of scheduler event payloads to collect
	 * @returns Count of successfully collected events
	 */
	collectBatch(events: SchedulerEventPayload[]): number {
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
			if (this.collectSchedulerEvent(event) !== null) {
				collected++;
			}
		}

		return collected;
	}

	/**
	 * Convenience method: collect a slot allocation event.
	 */
	collectSlotAllocation(event: SlotAllocationEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "slot_allocated", data: event });
	}

	/**
	 * Convenience method: collect a slot release event.
	 */
	collectSlotRelease(event: SlotReleaseEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "slot_released", data: event });
	}

	/**
	 * Convenience method: collect a slot rejection event.
	 */
	collectSlotRejected(event: SlotRejectedEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "slot_rejected", data: event });
	}

	/**
	 * Convenience method: collect a worker pool change event.
	 */
	collectWorkerPoolChange(event: WorkerPoolChangeEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "worker_pool_change", data: event });
	}

	/**
	 * Convenience method: collect a bottleneck detected event.
	 */
	collectBottleneckDetected(event: BottleneckDetectedEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "bottleneck_detected", data: event });
	}

	/**
	 * Convenience method: collect a bottleneck cleared event.
	 */
	collectBottleneckCleared(event: BottleneckClearedEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "bottleneck_cleared", data: event });
	}

	/**
	 * Convenience method: collect a schedule decision event.
	 */
	collectScheduleDecision(event: ScheduleDecisionEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "schedule_decision", data: event });
	}

	/**
	 * Convenience method: collect a workspace stage change event.
	 */
	collectWorkspaceStageChange(event: WorkspaceStageChangeEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "workspace_stage_change", data: event });
	}

	/**
	 * Convenience method: collect a plan state change event.
	 */
	collectPlanStateChange(event: PlanStateChangeEvent): ObservabilityEvent | null {
		return this.collectSchedulerEvent({ type: "plan_state_change", data: event });
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
	drainEntries(): SchedulerCollectorBufferEntry[] {
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
	peek(limit?: number): SchedulerCollectorBufferEntry[] {
		if (limit && limit > 0) {
			return this.buffer.slice(0, limit);
		}
		return [...this.buffer];
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get full diagnostics including cooldowns, dedupe stats, budget hits.
	 */
	getDiagnostics(): SchedulerCollectorDiagnostics {
		const cooldownsRecord: Record<string, SchedulerCollectorCooldown> = {};
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
		};
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

	// ── Private ──────────────────────────────────────────────────────

	/**
	 * Convert a scheduler event to an ObservabilityEvent.
	 */
	private schedulerEventToObservabilityEvent(event: SchedulerEventPayload): ObservabilityEvent {
		const ctx = createTraceContext({
			name: `scheduler/${event.type}`,
			planExecutionId: event.data.planExecutionId,
		});

		const severity = this.mapSchedulerTypeToSeverity(event.type);
		const status = this.mapSchedulerTypeToStatus(event.type);

		return createObservabilityEvent(ctx, {
			eventType: `execution_${event.type}`,
			source: "execution-runtime/workspace-scheduler",
			severity,
			status,
			name: `scheduler:${event.type}`,
			message: this.extractSchedulerMessage(event),
			data: {
				schedulerEventType: event.type,
				payload: event.data as unknown as Record<string, unknown>,
			},
			error: this.extractSchedulerError(event),
		});
	}

	/**
	 * Extract a human-readable message from a scheduler event.
	 */
	private extractSchedulerMessage(event: SchedulerEventPayload): string | null {
		switch (event.type) {
			case "slot_allocated":
				return `Slot ${event.data.slotIndex} allocated (${event.data.activeSlots}/${event.data.totalSlots} active)`;
			case "slot_released":
				return `Slot ${event.data.slotIndex} released: ${event.data.reason} (${event.data.activeSlots}/${event.data.totalSlots} active)`;
			case "slot_rejected":
				return `Slot rejected for ${event.data.workspaceExecutionId}: ${event.data.reason}`;
			case "worker_pool_change":
				return `Worker pool: ${event.data.previousMax} → ${event.data.newMax} (${event.data.reason})`;
			case "bottleneck_detected":
				return `Bottleneck detected: ${event.data.reasons.join("; ")}`;
			case "bottleneck_cleared":
				return "Bottleneck cleared";
			case "schedule_decision":
				return `Schedule decision: ${event.data.decision} (${event.data.reason})`;
			case "workspace_stage_change":
				return `Workspace ${event.data.previousStage} → ${event.data.newStage}`;
			case "plan_state_change":
				return `Progress: ${event.data.previousProgress}% → ${event.data.newProgress}%`;
			default:
				return `Scheduler event: ${(event as unknown as { type: string }).type}`;
		}
	}

	/**
	 * Extract an error from a scheduler event, if applicable.
	 */
	private extractSchedulerError(event: SchedulerEventPayload): string | null {
		if (event.type === "slot_rejected") {
			return event.data.reason;
		}
		return null;
	}

	/**
	 * Map scheduler event type to severity.
	 */
	private mapSchedulerTypeToSeverity(type: SchedulerEventType): ObservabilitySeverity {
		switch (type) {
			case "slot_rejected":
			case "bottleneck_detected":
				return "warning";
			default:
				return "info";
		}
	}

	/**
	 * Map scheduler event type to status.
	 */
	private mapSchedulerTypeToStatus(type: SchedulerEventType): ObservabilityStatus {
		switch (type) {
			case "slot_rejected":
			case "bottleneck_detected":
				return "error";
			case "bottleneck_cleared":
				return "ok";
			case "slot_allocated":
			case "workspace_stage_change":
				return "running";
			default:
				return "ok";
		}
	}

	private addToBuffer(event: ObservabilityEvent, schedulerEventType: string, planExecutionId: string): void {
		const entry: SchedulerCollectorBufferEntry = {
			event,
			schedulerEventType,
			source: "execution-runtime/workspace-scheduler",
			collectedAt: new Date().toISOString(),
			planExecutionId,
		};
		this.buffer.push(entry);
	}

	private computeContentHash(data: Record<string, unknown>): string {
		const hash = createHash("sha256");
		const stable = {
			type: data.type ?? "unknown",
			planExecutionId: (data.data as any)?.planExecutionId ?? "unknown",
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
