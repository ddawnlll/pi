/**
 * Overnight Collector — Workspace 25.G
 *
 * Collects observable telemetry from overnight run sessions (P20.A — Overnight
 * Run Orchestration) and converts them into standardized ObservabilityEvent
 * records for the telemetry store.
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
 * @module observability/collectors/brain/overnight-collector
 */

import { createHash } from "node:crypto";
import type {
	OvernightStatus,
	OvernightStopCondition,
	RunSession,
	RunStatus,
} from "../../../brain/overnight/orchestrator.js";
import { createObservabilityEvent, createTraceContext } from "../../schema.js";
import type { ObservabilityEvent, ObservabilitySeverity, ObservabilityStatus } from "../../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Cooldown tracking for the overnight collector.
 */
export interface OvernightCollectorCooldown {
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
export interface OvernightCollectorDedupeEntry {
	/** Content hash for deduplication */
	contentHash: string;
	/** ISO 8601 timestamp of first occurrence */
	firstSeenAt: string;
	/** Number of suppressed duplicates */
	suppressedCount: number;
}

/**
 * Budget configuration for overnight collection.
 */
export interface OvernightCollectorBudget {
	/** Maximum events to collect per collection cycle (default: 20) */
	maxPerCycle: number;
	/** Maximum total events retained in the collector buffer (default: 200) */
	maxTotal: number;
	/** Maximum CPU time (ms) spent collecting per cycle (default: 150) */
	maxTimeMs: number;
}

/**
 * Default budget for overnight collection.
 */
export const DEFAULT_OVERNIGHT_COLLECTOR_BUDGET: OvernightCollectorBudget = {
	maxPerCycle: 20,
	maxTotal: 200,
	maxTimeMs: 150,
};

/**
 * Deduplication configuration.
 */
export interface OvernightCollectorDedupeConfig {
	/** Whether deduplication is enabled (default: true) */
	enabled: boolean;
	/** Time window in ms for considering events as duplicates (default: 60_000) */
	windowMs: number;
}

/**
 * Default dedupe configuration.
 */
export const DEFAULT_OVERNIGHT_COLLECTOR_DEDUPE: OvernightCollectorDedupeConfig = {
	enabled: true,
	windowMs: 60_000,
};

/**
 * Stop condition for overnight collection (separate from overnight orchestration stop conditions).
 */
export interface OvernightCollectorStopCondition {
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
 * Full diagnostic state for the overnight collector.
 */
export interface OvernightCollectorDiagnostics {
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
	cooldowns: Record<string, OvernightCollectorCooldown>;
	/** Stop condition states */
	stopConditions: OvernightCollectorStopCondition[];
	/** Whether the collector has been stopped */
	stopped: boolean;
	/** Error message if the collector is in an error state */
	error: string | null;
}

/**
 * Collected overnight buffer entry.
 */
export interface OvernightCollectorBufferEntry {
	/** The observability event */
	event: ObservabilityEvent;
	/** Original overnight event type (for filtering) */
	overnightEventType: string;
	/** ISO 8601 timestamp of collection */
	collectedAt: string;
	/** Source component name */
	source: string;
}

/**
 * Event types emitted by the overnight collector.
 */
export type OvernightCollectorEventType =
	| "overnight_scheduled"
	| "overnight_started"
	| "overnight_completed"
	| "overnight_stopped"
	| "overnight_failed"
	| "overnight_progress"
	| "overnight_stop_condition_met"
	| "overnight_error";

// ─────────────────────────────────────────────────────────────────────
// OvernightCollector
// ─────────────────────────────────────────────────────────────────────

/**
 * Collects overnight run telemetry as observability events.
 *
 * Handles RunSession lifecycle, RunStatus updates, and stop condition
 * triggers — converting them into ObservabilityEvent format for
 * telemetry storage.
 *
 * All autonomous behavior respects budget, cooldown, dedupe, and
 * stop-condition constraints.
 */
export class OvernightCollector {
	private buffer: OvernightCollectorBufferEntry[] = [];
	private cooldowns: Map<string, OvernightCollectorCooldown> = new Map();
	private dedupeEntries: Map<string, OvernightCollectorDedupeEntry> = new Map();
	private stopConditions: OvernightCollectorStopCondition[] = [];

	private totalCollected = 0;
	private totalDeduplicated = 0;
	private cyclesHitBudget = 0;
	private cyclesHitTimeLimit = 0;
	private stopped = false;
	private error: string | null = null;

	private budget: OvernightCollectorBudget;
	private dedupeConfig: OvernightCollectorDedupeConfig;
	private cooldownMs: number;

	constructor(
		budget?: Partial<OvernightCollectorBudget>,
		dedupeConfig?: Partial<OvernightCollectorDedupeConfig>,
		cooldownMs = 15_000,
	) {
		this.budget = { ...DEFAULT_OVERNIGHT_COLLECTOR_BUDGET, ...budget };
		this.dedupeConfig = { ...DEFAULT_OVERNIGHT_COLLECTOR_DEDUPE, ...dedupeConfig };
		this.cooldownMs = cooldownMs;
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Update budget configuration.
	 */
	setBudget(budget: Partial<OvernightCollectorBudget>): void {
		this.budget = { ...this.budget, ...budget };
	}

	/**
	 * Get current budget configuration.
	 */
	getBudget(): OvernightCollectorBudget {
		return { ...this.budget };
	}

	/**
	 * Update deduplication configuration.
	 */
	setDedupeConfig(config: Partial<OvernightCollectorDedupeConfig>): void {
		this.dedupeConfig = { ...this.dedupeConfig, ...config };
	}

	/**
	 * Get current dedupe configuration.
	 */
	getDedupeConfig(): OvernightCollectorDedupeConfig {
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
	getStopConditions(): OvernightCollectorStopCondition[] {
		return this.stopConditions.map((sc) => ({ ...sc }));
	}

	// ── Collection ───────────────────────────────────────────────────

	/**
	 * Collect an overnight run session event based on status transition.
	 *
	 * @param session - The run session that transitioned
	 * @param previousStatus - The previous status (for transition diagnostics)
	 * @param stopReason - Optional stop reason (for stopped/failed transitions)
	 * @returns The collected observability event, or null if suppressed
	 */
	collectSessionTransition(
		session: RunSession,
		previousStatus?: OvernightStatus,
		stopReason?: string,
	): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `overnight:session:${session.status}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check
		const stablePayload = {
			sessionId: session.id,
			status: session.status,
			progress: session.progress,
			stopReason: session.stopReason ?? stopReason ?? null,
		};
		const contentHash = this.computeContentHash(stablePayload);
		if (this.isDuplicate(contentHash, session.createdAt)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.sessionToEvent(session, previousStatus, stopReason);

		this.addToBuffer(event, `overnight_${session.status}`, "brain/overnight-orchestrator");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, session.createdAt);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a run status update (progress heartbeat).
	 *
	 * @param status - The current run status
	 * @returns The collected observability event, or null if suppressed
	 */
	collectRunStatus(status: RunStatus): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = "overnight:run_status";

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check
		const stablePayload = {
			sessionId: status.sessionId,
			status: status.status,
			completed: status.progress.completed,
			total: status.progress.total,
			failed: status.progress.failed,
		};
		const contentHash = this.computeContentHash(stablePayload);
		const dedupeRefTime = status.lastStopCheckAt ?? new Date().toISOString();
		if (this.isDuplicate(contentHash, dedupeRefTime)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.runStatusToEvent(status);

		this.addToBuffer(event, "overnight_progress", "brain/overnight-orchestrator");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, dedupeRefTime);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a stop condition that was met during an overnight run.
	 *
	 * @param condition - The stop condition string
	 * @param sessionId - The session ID
	 * @param detail - Additional detail about why the condition was met
	 * @returns The collected observability event, or null if suppressed
	 */
	collectStopCondition(
		condition: OvernightStopCondition,
		sessionId: string,
		detail?: string,
	): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `overnight:stop_condition:${condition}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check — stop conditions are deduplicated per condition+session
		const stablePayload = { condition, sessionId };
		const contentHash = this.computeContentHash(stablePayload);
		if (this.isDuplicate(contentHash, new Date().toISOString())) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.stopConditionToEvent(condition, sessionId, detail);

		this.addToBuffer(event, "overnight_stop_condition_met", "brain/overnight-orchestrator");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, new Date().toISOString());

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a batch of overnight events in a single cycle.
	 *
	 * Respects per-cycle budget (maxPerCycle) and time budget (maxTimeMs).
	 * Returns the number of events successfully collected.
	 *
	 * @param sessions - Run sessions to collect
	 * @param statuses - Run status updates to collect
	 * @param stopConditions - Stop conditions to collect
	 * @returns Count of successfully collected events
	 */
	collectBatch(
		sessions: { session: RunSession; previousStatus?: OvernightStatus; stopReason?: string }[] = [],
		statuses: RunStatus[] = [],
		stopConditions: { condition: OvernightStopCondition; sessionId: string; detail?: string }[] = [],
	): number {
		if (this.stopped) return 0;
		if (this.hasStopConditionTriggered()) return 0;

		const startTime = Date.now();
		let collected = 0;
		let hitBudget = false;

		// Collect session transitions
		for (const item of sessions) {
			if (collected >= this.budget.maxPerCycle) {
				hitBudget = true;
				break;
			}
			const elapsed = Date.now() - startTime;
			if (elapsed >= this.budget.maxTimeMs) {
				this.cyclesHitTimeLimit++;
				break;
			}
			if (this.collectSessionTransition(item.session, item.previousStatus, item.stopReason) !== null) {
				collected++;
			}
		}

		// Collect run status updates (respect remaining per-cycle budget)
		if (!hitBudget) {
			for (const st of statuses) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					this.cyclesHitTimeLimit++;
					break;
				}
				if (this.collectRunStatus(st) !== null) {
					collected++;
				}
			}
		}

		// Collect stop conditions (respect remaining per-cycle budget)
		if (!hitBudget) {
			for (const sc of stopConditions) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					this.cyclesHitTimeLimit++;
					break;
				}
				if (this.collectStopCondition(sc.condition, sc.sessionId, sc.detail) !== null) {
					collected++;
				}
			}
		}

		if (hitBudget) {
			this.cyclesHitBudget++;
		}

		return collected;
	}

	// ── Buffer Access ────────────────────────────────────────────────

	/**
	 * Drain all buffered events and return them.
	 * Clears the buffer after draining.
	 *
	 * @returns Array of buffered observability events
	 */
	drain(): OvernightCollectorBufferEntry[] {
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
	peek(limit?: number): OvernightCollectorBufferEntry[] {
		if (limit && limit > 0) {
			return this.buffer.slice(0, limit);
		}
		return [...this.buffer];
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get full diagnostics including cooldowns, dedupe stats, budget hits.
	 */
	getDiagnostics(): OvernightCollectorDiagnostics {
		const cooldownsRecord: Record<string, OvernightCollectorCooldown> = {};
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

	private sessionToEvent(
		session: RunSession,
		previousStatus?: OvernightStatus,
		stopReason?: string,
	): ObservabilityEvent {
		const eventType = this.overnightStatusToEventType(session.status);
		const ctx = createTraceContext({
			name: `brain/${eventType}`,
			correlationId: null,
			projectId: null,
			planExecutionId: session.planExecIds[0] ?? null,
			workspaceExecutionId: null,
		});

		const severity = this.mapOvernightStatusToSeverity(session.status);
		const status = this.mapOvernightStatusToObservabilityStatus(session.status);

		return createObservabilityEvent(ctx, {
			eventType,
			source: "brain/overnight-orchestrator",
			severity,
			status,
			name: `overnight:${session.id}`,
			message: this.buildSessionMessage(session, previousStatus, stopReason),
			data: {
				sessionId: session.id,
				status: session.status,
				previousStatus: previousStatus ?? null,
				planExecIds: session.planExecIds,
				progress: {
					completed: session.progress.completed,
					total: session.progress.total,
					failed: session.progress.failed,
				},
				startedAt: session.startedAt ?? null,
				completedAt: session.completedAt ?? null,
				stopReason: session.stopReason ?? stopReason ?? null,
			},
		});
	}

	private runStatusToEvent(status: RunStatus): ObservabilityEvent {
		const ctx = createTraceContext({
			name: "brain/overnight_progress",
			correlationId: null,
			projectId: null,
			planExecutionId: status.currentPlan ?? status.sessionId,
			workspaceExecutionId: null,
		});

		return createObservabilityEvent(ctx, {
			eventType: "overnight_progress",
			source: "brain/overnight-orchestrator",
			severity: "info",
			status: "running",
			name: `overnight:progress:${status.sessionId}`,
			message: `Progress: ${status.progress.completed}/${status.progress.total} (${status.progress.failed} failed)`,
			data: {
				sessionId: status.sessionId,
				status: status.status,
				progress: status.progress,
				currentPlan: status.currentPlan ?? null,
				currentPlanStatus: status.currentPlanStatus ?? null,
				lastStopCheckAt: status.lastStopCheckAt ?? null,
				stopConditionsMet: status.stopConditionsMet ?? [],
				elapsedHours: status.elapsedHours,
			},
		});
	}

	private stopConditionToEvent(
		condition: OvernightStopCondition,
		sessionId: string,
		detail?: string,
	): ObservabilityEvent {
		const ctx = createTraceContext({
			name: "brain/overnight_stop_condition_met",
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});

		return createObservabilityEvent(ctx, {
			eventType: "overnight_stop_condition_met",
			source: "brain/overnight-orchestrator",
			severity: "warning",
			status: "error",
			name: `overnight:stop:${condition}`,
			message: `Stop condition met: ${condition}${detail ? ` — ${detail}` : ""}`,
			data: {
				condition,
				sessionId,
				detail: detail ?? null,
			},
		});
	}

	private addToBuffer(event: ObservabilityEvent, overnightEventType: string, source: string): void {
		const entry: OvernightCollectorBufferEntry = {
			event,
			overnightEventType,
			source,
			collectedAt: new Date().toISOString(),
		};
		this.buffer.push(entry);
	}

	private computeContentHash(data: Record<string, unknown>): string {
		const hash = createHash("sha256");
		hash.update(JSON.stringify(data));
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

		// Expired — clear it
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

	/**
	 * Map OvernightStatus to an observability event type string.
	 */
	private overnightStatusToEventType(status: OvernightStatus): string {
		switch (status) {
			case "scheduled":
				return "overnight_scheduled";
			case "running":
				return "overnight_started";
			case "completed":
				return "overnight_completed";
			case "stopped":
				return "overnight_stopped";
			case "failed":
				return "overnight_failed";
		}
	}

	/**
	 * Map OvernightStatus to observability severity.
	 */
	private mapOvernightStatusToSeverity(status: OvernightStatus): ObservabilitySeverity {
		switch (status) {
			case "scheduled":
				return "info";
			case "running":
				return "info";
			case "completed":
				return "info";
			case "stopped":
				return "warning";
			case "failed":
				return "error";
		}
	}

	/**
	 * Map OvernightStatus to observability status.
	 */
	private mapOvernightStatusToObservabilityStatus(status: OvernightStatus): ObservabilityStatus {
		switch (status) {
			case "scheduled":
				return "running";
			case "running":
				return "running";
			case "completed":
				return "ok";
			case "stopped":
				return "error";
			case "failed":
				return "error";
		}
	}

	/**
	 * Build a human-readable message for a session transition.
	 */
	private buildSessionMessage(session: RunSession, _previousStatus?: OvernightStatus, stopReason?: string): string {
		const effectiveStopReason = session.stopReason ?? stopReason;
		switch (session.status) {
			case "scheduled":
				return `Overnight session ${session.id} scheduled with ${session.planExecIds.length} plan(s)`;
			case "running":
				return `Overnight session ${session.id} started (${session.planExecIds.length} plan(s))`;
			case "completed":
				return `Overnight session ${session.id} completed: ${session.progress.completed}/${session.progress.total} done, ${session.progress.failed} failed`;
			case "stopped":
				return `Overnight session ${session.id} stopped${effectiveStopReason ? `: ${effectiveStopReason}` : ""}`;
			case "failed":
				return `Overnight session ${session.id} failed${effectiveStopReason ? `: ${effectiveStopReason}` : ""}`;
		}
	}
}
