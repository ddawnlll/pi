/**
 * Execution Collector — Workspace 25.F
 *
 * Collects execution attempt events from the execution kernel's v4 event
 * schema and converts them into standardized ObservabilityEvent records
 * for the telemetry store.
 *
 * Handles all AttemptEventTypeV4 event types:
 * - Lifecycle: attempt_created, abort_requested, abort_completed
 * - Worktree: worktree_lease_requested, worktree_lease_acquired, worktree_lease_failed
 * - Executor: executor_started, executor_heartbeat, executor_completed, executor_failed
 * - LLM: llm_request_timed_out
 * - Tool: tool_call_failed
 * - Validation: validation_lane_requested, validation_lane_acquired,
 *   validation_started, validation_passed, validation_failed,
 *   validation_timed_out, validation_process_killed
 * - Integration: integration_queued, integration_started, integration_passed,
 *   integration_failed
 * - Merge: merge_conflict_detected
 * - Deadline: deadline_exceeded
 * - Lease: lease_stale_detected
 * - Quarantine: quarantine_required
 * - Handoff: handoff_required, handoff_retry_requested, handoff_closed
 * - Retry: retry_requested
 * - Manual: manual_resolution_recorded
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
 * @module observability/collectors/execution/execution-collector
 */

import { createHash } from "node:crypto";
import type { AttemptEvent, AttemptEventTypeV4, EventSource } from "../../../execution-runtime/event-schema.js";

import { createObservabilityEvent, createTraceContext } from "../../schema.js";
import type { ObservabilityEvent, ObservabilitySeverity, ObservabilityStatus } from "../../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Cooldown tracking for the execution collector.
 */
export interface ExecutionCollectorCooldown {
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
export interface ExecutionCollectorDedupeEntry {
	/** Content hash for deduplication */
	contentHash: string;
	/** ISO 8601 timestamp of first occurrence */
	firstSeenAt: string;
	/** Number of suppressed duplicates */
	suppressedCount: number;
}

/**
 * Budget configuration for execution collection.
 */
export interface ExecutionCollectorBudget {
	/** Maximum events to collect per collection cycle (default: 50) */
	maxPerCycle: number;
	/** Maximum total events retained in the collector buffer (default: 500) */
	maxTotal: number;
	/** Maximum CPU time (ms) spent collecting per cycle (default: 200) */
	maxTimeMs: number;
}

/**
 * Default budget for execution collection.
 */
export const DEFAULT_EXECUTION_COLLECTOR_BUDGET: ExecutionCollectorBudget = {
	maxPerCycle: 50,
	maxTotal: 500,
	maxTimeMs: 200,
};

/**
 * Deduplication configuration.
 */
export interface ExecutionCollectorDedupeConfig {
	/** Whether deduplication is enabled (default: true) */
	enabled: boolean;
	/** Time window in ms for considering events as duplicates (default: 30_000) */
	windowMs: number;
}

/**
 * Default dedupe configuration.
 */
export const DEFAULT_EXECUTION_COLLECTOR_DEDUPE: ExecutionCollectorDedupeConfig = {
	enabled: true,
	windowMs: 30_000,
};

/**
 * Stop condition for execution collection.
 */
export interface ExecutionCollectorStopCondition {
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
 * Full diagnostic state for the execution collector.
 */
export interface ExecutionCollectorDiagnostics {
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
	cooldowns: Record<string, ExecutionCollectorCooldown>;
	/** Stop condition states */
	stopConditions: ExecutionCollectorStopCondition[];
	/** Whether the collector has been stopped */
	stopped: boolean;
	/** Error message if the collector is in an error state */
	error: string | null;
	/** Event type counts since creation */
	eventTypeCounts: Record<string, number>;
}

/**
 * Collected execution buffer entry.
 */
export interface ExecutionCollectorBufferEntry {
	/** The observability event */
	event: ObservabilityEvent;
	/** Original execution event type (for filtering) */
	executionEventType: string;
	/** ISO 8601 timestamp of collection */
	collectedAt: string;
	/** Source component name */
	source: string;
	/** Attempt ID this event belongs to */
	attemptId: string;
	/** Plan execution ID */
	planExecutionId: string;
}

// ─────────────────────────────────────────────────────────────────────
// ExecutionCollector
// ─────────────────────────────────────────────────────────────────────

/**
 * Collects execution attempt events as observability events.
 *
 * Handles all AttemptEventTypeV4 event types from the execution kernel
 * and converts them into ObservabilityEvent format for telemetry storage.
 *
 * All autonomous behavior respects budget, cooldown, dedupe, and
 * stop-condition constraints.
 */
export class ExecutionCollector {
	private buffer: ExecutionCollectorBufferEntry[] = [];
	private cooldowns: Map<string, ExecutionCollectorCooldown> = new Map();
	private dedupeEntries: Map<string, ExecutionCollectorDedupeEntry> = new Map();
	private stopConditions: ExecutionCollectorStopCondition[] = [];

	private totalCollected = 0;
	private totalDeduplicated = 0;
	private cyclesHitBudget = 0;
	private cyclesHitTimeLimit = 0;
	private stopped = false;
	private error: string | null = null;
	private eventTypeCounts: Record<string, number> = {};

	private budget: ExecutionCollectorBudget;
	private dedupeConfig: ExecutionCollectorDedupeConfig;
	private cooldownMs: number;

	constructor(
		budget?: Partial<ExecutionCollectorBudget>,
		dedupeConfig?: Partial<ExecutionCollectorDedupeConfig>,
		cooldownMs = 10_000,
	) {
		this.budget = { ...DEFAULT_EXECUTION_COLLECTOR_BUDGET, ...budget };
		this.dedupeConfig = { ...DEFAULT_EXECUTION_COLLECTOR_DEDUPE, ...dedupeConfig };
		this.cooldownMs = cooldownMs;
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Update budget configuration.
	 */
	setBudget(budget: Partial<ExecutionCollectorBudget>): void {
		this.budget = { ...this.budget, ...budget };
	}

	/**
	 * Get current budget configuration.
	 */
	getBudget(): ExecutionCollectorBudget {
		return { ...this.budget };
	}

	/**
	 * Update deduplication configuration.
	 */
	setDedupeConfig(config: Partial<ExecutionCollectorDedupeConfig>): void {
		this.dedupeConfig = { ...this.dedupeConfig, ...config };
	}

	/**
	 * Get current dedupe configuration.
	 */
	getDedupeConfig(): ExecutionCollectorDedupeConfig {
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
	getStopConditions(): ExecutionCollectorStopCondition[] {
		return this.stopConditions.map((sc) => ({ ...sc }));
	}

	// ── Collection ───────────────────────────────────────────────────

	/**
	 * Collect a single execution attempt event.
	 *
	 * @param event - The AttemptEvent to collect
	 * @returns The collected observability event, or null if suppressed
	 *          by budget, cooldown, dedupe, or stop condition
	 */
	/**
	 * Collect a single execution attempt event.
	 *
	 * @param event - The AttemptEvent to collect
	 * @returns The collected observability event, or null if suppressed
	 *          by budget, cooldown, dedupe, or stop condition
	 */
	collectEvent(event: AttemptEvent): ObservabilityEvent | null {
		return this.collectEventInternal(event, true);
	}

	/**
	 * Internal collection with optional cooldown check.
	 * Bypasses cooldown for batch/categorized collection (checkCooldown=false)
	 * to avoid rate-limiting within a single cycle.
	 */
	private collectEventInternal(event: AttemptEvent, checkCooldown = false): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `execution:${event.type}`;

		// Dedupe check (before cooldown so identical events are caught as duplicates)
		const contentHash = this.computeContentHash(event as unknown as Record<string, unknown>);
		if (this.isDuplicate(contentHash, event.createdAt)) return null;

		// Cooldown check (only for single collect calls, not batch)
		if (checkCooldown && this.isOnCooldown(collectionKey)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const obsEvent = this.attemptEventToObservabilityEvent(event);

		this.addToBuffer(obsEvent, event.type, event.source, event.attemptId, event.planExecutionId);
		if (checkCooldown) {
			this.trackCooldown(collectionKey);
		}
		this.trackDedupe(contentHash, event.createdAt);

		this.totalCollected++;
		this.eventTypeCounts[event.type] = (this.eventTypeCounts[event.type] ?? 0) + 1;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return obsEvent;
	}

	/**
	 * Collect a batch of execution attempt events in a single cycle.
	 *
	 * Respects per-cycle budget (maxPerCycle) and time budget (maxTimeMs).
	 * Returns the number of events successfully collected.
	 *
	 * @param events - Array of AttemptEvent records to collect
	 * @returns Count of successfully collected events
	 */
	collectBatch(events: AttemptEvent[]): number {
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
			// Batch collection bypasses cooldown — rate limiting applies across
			// separate collectEvent cycles, not within a single batch.
			if (this.collectEventInternal(event) !== null) {
				collected++;
			}
		}

		return collected;
	}

	/**
	 * Collect multiple execution attempt events categorized by type.
	 *
	 * Processes events in order: lifecycle, worktree, executor, validation,
	 * integration, and other events.
	 *
	 * @param events - Record of event type to AttemptEvent arrays
	 * @returns Count of successfully collected events
	 */
	collectCategorized(events: Record<string, AttemptEvent[]>): number {
		if (this.stopped) return 0;
		if (this.hasStopConditionTriggered()) return 0;

		const startTime = Date.now();
		let collected = 0;
		let hitBudget = false;

		// Define processing order
		const categoryOrder = [
			"lifecycle",
			"worktree",
			"executor",
			"llm",
			"tool",
			"validation",
			"integration",
			"merge",
			"deadline",
			"lease",
			"quarantine",
			"handoff",
			"retry",
			"manual",
		];

		for (const category of categoryOrder) {
			if (hitBudget) break;

			const categoryEvents = events[category] ?? [];
			for (const event of categoryEvents) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					this.cyclesHitBudget++;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					hitBudget = true;
					this.cyclesHitTimeLimit++;
					break;
				}
				// Categorized collection bypasses cooldown
				if (this.collectEventInternal(event) !== null) {
					collected++;
				}
			}
		}

		return collected;
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
	drainEntries(): ExecutionCollectorBufferEntry[] {
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
	peek(limit?: number): ExecutionCollectorBufferEntry[] {
		if (limit && limit > 0) {
			return this.buffer.slice(0, limit);
		}
		return [...this.buffer];
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get full diagnostics including cooldowns, dedupe stats, budget hits.
	 */
	getDiagnostics(): ExecutionCollectorDiagnostics {
		const cooldownsRecord: Record<string, ExecutionCollectorCooldown> = {};
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
	 * Convert an AttemptEvent to an ObservabilityEvent.
	 */
	private attemptEventToObservabilityEvent(event: AttemptEvent): ObservabilityEvent {
		const ctx = createTraceContext({
			name: `execution/${event.type}`,
			traceId: event.correlationId ?? undefined,
			correlationId: event.correlationId,
			planExecutionId: event.planExecutionId,
			workspaceExecutionId: event.workspaceId,
		});

		const severity = this.mapEventTypeToSeverity(event.type, event.source);
		const status = this.mapEventTypeToStatus(event.type);
		const payload = event.payload as unknown as Record<string, unknown>;

		return createObservabilityEvent(ctx, {
			eventType: `execution_${event.type}`,
			source: `execution-runtime/${event.source}`,
			severity,
			status,
			name: `attempt:${event.type}`,
			message: this.extractMessage(event.type, payload),
			data: {
				eventId: event.eventId,
				eventType: event.type,
				attemptId: event.attemptId,
				commandId: event.commandId ?? null,
				planExecutionId: event.planExecutionId,
				workspaceId: event.workspaceId ?? null,
				payload,
			},
			error: status === "error" ? this.extractErrorMessage(event.type, payload) : null,
		});
	}

	/**
	 * Extract a human-readable message from the event.
	 */
	private extractMessage(type: AttemptEventTypeV4, payload: Record<string, unknown>): string | null {
		switch (type) {
			case "attempt_created":
				return `Attempt created for workspace execution ${payload.workspaceExecutionId}`;
			case "worktree_lease_requested":
				return `Worktree lease requested: ${payload.worktreeId}`;
			case "worktree_lease_acquired":
				return `Worktree lease acquired: ${payload.path}`;
			case "worktree_lease_failed":
				return `Worktree lease failed: ${payload.reason}`;
			case "executor_started":
				return `Executor started: ${payload.providerModel}`;
			case "executor_heartbeat":
				return `Executor heartbeat: ${payload.progress}`;
			case "executor_completed":
				return `Executor completed: ${payload.result}`;
			case "executor_failed":
				return `Executor failed: ${payload.error}`;
			case "llm_request_timed_out":
				return `LLM request timed out (${payload.provider}, ${payload.timeoutMs}ms)`;
			case "tool_call_failed":
				return `Tool call failed: ${payload.tool} - ${payload.error}`;
			case "validation_lane_requested":
				return `Validation lane requested: ${payload.laneType}`;
			case "validation_lane_acquired":
				return `Validation lane acquired: ${payload.laneType}`;
			case "validation_started":
				return `Validation started: ${payload.command}`;
			case "validation_passed":
				return `Validation passed (${payload.durationMs}ms)`;
			case "validation_failed":
				return `Validation failed: ${payload.error}`;
			case "validation_timed_out":
				return `Validation timed out (${payload.timeoutMs}ms)`;
			case "validation_process_killed":
				return `Validation process killed (PID ${payload.pid}, signal ${payload.signal})`;
			case "integration_queued":
				return `Integration queued (position ${payload.queuePosition})`;
			case "integration_started":
				return `Integration started on branch ${payload.branch}`;
			case "integration_passed":
				return `Integration passed (commit ${payload.commitHash})`;
			case "integration_failed":
				return `Integration failed: ${payload.error}`;
			case "merge_conflict_detected":
				return `Merge conflict detected in ${(payload.files as string[])?.length ?? 0} files`;
			case "abort_requested":
				return `Abort requested: ${payload.reason}`;
			case "abort_completed":
				return `Abort completed: ${payload.cleanupStatus}`;
			case "deadline_exceeded":
				return `Deadline exceeded (state: ${payload.state}, deadline: ${payload.deadlineAt})`;
			case "lease_stale_detected":
				return `Stale lease detected (last heartbeat: ${payload.lastHeartbeatAt})`;
			case "quarantine_required":
				return `Quarantine required: ${payload.reason}`;
			case "handoff_required":
				return `Handoff required: ${payload.reason}`;
			case "retry_requested":
				return `Retry requested (remaining budget: ${payload.retryBudgetRemaining})`;
			case "handoff_retry_requested":
				return `Handoff retry requested for attempt ${payload.previousAttemptId}`;
			case "handoff_closed":
				return `Handoff closed: ${payload.resolution}`;
			case "manual_resolution_recorded":
				return `Manual resolution: ${payload.resolution}`;
			default:
				return `Execution event: ${type}`;
		}
	}

	/**
	 * Extract an error message from failure events.
	 */
	private extractErrorMessage(type: AttemptEventTypeV4, payload: Record<string, unknown>): string | null {
		switch (type) {
			case "worktree_lease_failed":
				return String(payload.reason ?? "Worktree lease failed");
			case "executor_failed":
				return String(payload.error ?? "Executor failed");
			case "llm_request_timed_out":
				return `LLM request timed out after ${payload.timeoutMs}ms`;
			case "tool_call_failed":
				return `Tool ${payload.tool} failed: ${payload.error}`;
			case "validation_failed":
				return String(payload.error ?? "Validation failed");
			case "validation_timed_out":
				return `Validation timed out after ${payload.timeoutMs}ms`;
			case "validation_process_killed":
				return `Validation process killed (signal ${payload.signal})`;
			case "integration_failed":
				return String(payload.error ?? "Integration failed");
			case "merge_conflict_detected":
				return `Merge conflict in ${(payload.files as string[])?.join(", ")}`;
			case "deadline_exceeded":
				return `Deadline exceeded at ${payload.deadlineAt}`;
			case "lease_stale_detected":
				return `Stale lease detected`;
			case "quarantine_required":
				return String(payload.reason ?? "Quarantine required");
			default:
				return null;
		}
	}

	/**
	 * Map event type to an observability severity.
	 */
	private mapEventTypeToSeverity(type: AttemptEventTypeV4, _source: EventSource): ObservabilitySeverity {
		switch (type) {
			// Error events
			case "worktree_lease_failed":
			case "executor_failed":
			case "tool_call_failed":
			case "validation_failed":
			case "validation_timed_out":
			case "validation_process_killed":
			case "integration_failed":
			case "merge_conflict_detected":
			case "deadline_exceeded":
			case "lease_stale_detected":
			case "quarantine_required":
				return "error";

			// Warning events
			case "llm_request_timed_out":
			case "handoff_required":
			case "retry_requested":
			case "handoff_retry_requested":
			case "abort_requested":
				return "warning";

			// Info events
			default:
				return "info";
		}
	}

	/**
	 * Map event type to an observability status.
	 */
	private mapEventTypeToStatus(type: AttemptEventTypeV4): ObservabilityStatus {
		switch (type) {
			case "executor_failed":
			case "worktree_lease_failed":
			case "tool_call_failed":
			case "validation_failed":
			case "validation_timed_out":
			case "validation_process_killed":
			case "integration_failed":
			case "merge_conflict_detected":
			case "deadline_exceeded":
			case "lease_stale_detected":
			case "quarantine_required":
				return "error";

			case "executor_completed":
			case "validation_passed":
			case "integration_passed":
			case "abort_completed":
				return "ok";

			case "executor_heartbeat":
			case "validation_started":
			case "executor_started":
			case "integration_started":
			case "worktree_lease_requested":
			case "worktree_lease_acquired":
			case "validation_lane_requested":
			case "validation_lane_acquired":
			case "attempt_created":
			case "abort_requested":
				return "running";

			default:
				return "unknown";
		}
	}

	private addToBuffer(
		event: ObservabilityEvent,
		executionEventType: string,
		source: string,
		attemptId: string,
		planExecutionId: string,
	): void {
		const entry: ExecutionCollectorBufferEntry = {
			event,
			executionEventType,
			source,
			collectedAt: new Date().toISOString(),
			attemptId,
			planExecutionId,
		};
		this.buffer.push(entry);
	}

	private computeContentHash(data: Record<string, unknown>): string {
		const hash = createHash("sha256");
		const stable = {
			type: data.type ?? "unknown",
			eventId: data.eventId ?? "unknown",
			attemptId: data.attemptId ?? "unknown",
			planExecutionId: data.planExecutionId ?? "unknown",
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

		// Outside window, remove and allow through
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

		// Expired — clear cooldown but leave dedupe entries intact.
		// Dedupe entries are cleaned up by their own window check in isDuplicate.
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
