/**
 * Brain Collectors — Workspace 25.G
 *
 * Collects observable telemetry from brain operations (observations,
 * signals, timeline events) and converts them into standardized
 * ObservabilityEvent records for the telemetry store.
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
 * @module observability/collectors/brain/brain-collector
 */

import { createHash } from "node:crypto";
import type { BrainObservation, BrainSignal, BrainTimelineEvent } from "../../../brain/types.js";
import { createObservabilityEvent, createTraceContext } from "../../schema.js";
import type { ObservabilityEvent, ObservabilitySeverity, ObservabilityStatus } from "../../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Cooldown tracking for a single collector key.
 */
export interface BrainCollectorCooldown {
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
export interface BrainCollectorDedupeEntry {
	/** Content hash for deduplication */
	contentHash: string;
	/** ISO 8601 timestamp of first occurrence */
	firstSeenAt: string;
	/** Number of suppressed duplicates */
	suppressedCount: number;
}

/**
 * Budget configuration for autonomous brain collection.
 */
export interface BrainCollectorBudget {
	/** Maximum events to collect per collection cycle (default: 50) */
	maxPerCycle: number;
	/** Maximum total events retained in the collector buffer (default: 500) */
	maxTotal: number;
	/** Maximum CPU time (ms) spent collecting per cycle (default: 200) */
	maxTimeMs: number;
}

/**
 * Default budget for brain collection.
 */
export const DEFAULT_BRAIN_COLLECTOR_BUDGET: BrainCollectorBudget = {
	maxPerCycle: 50,
	maxTotal: 500,
	maxTimeMs: 200,
};

/**
 * Deduplication configuration.
 */
export interface BrainCollectorDedupeConfig {
	/** Whether deduplication is enabled (default: true) */
	enabled: boolean;
	/** Time window in ms for considering events as duplicates (default: 30_000) */
	windowMs: number;
}

/**
 * Default dedupe configuration.
 */
export const DEFAULT_BRAIN_COLLECTOR_DEDUPE: BrainCollectorDedupeConfig = {
	enabled: true,
	windowMs: 30_000,
};

/**
 * Stop condition for brain collection.
 */
export interface BrainCollectorStopCondition {
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
 * Full diagnostic state for the brain collector.
 */
export interface BrainCollectorDiagnostics {
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
	cooldowns: Record<string, BrainCollectorCooldown>;
	/** Stop condition states */
	stopConditions: BrainCollectorStopCondition[];
	/** Whether the collector has been stopped */
	stopped: boolean;
	/** Error message if the collector is in an error state */
	error: string | null;
}

/**
 * Collected brain event buffer entry.
 */
export interface BrainCollectorBufferEntry {
	/** The observability event */
	event: ObservabilityEvent;
	/** Original brain event type (for filtering) */
	brainEventType: string;
	/** ISO 8601 timestamp of collection */
	collectedAt: string;
	/** Source component name */
	source: string;
}

// ─────────────────────────────────────────────────────────────────────
// BrainCollector
// ─────────────────────────────────────────────────────────────────────

/**
 * Collects brain operations as observability events.
 *
 * Handles BrainObservation, BrainSignal, and BrainTimelineEvent
 * conversion into ObservabilityEvent format for telemetry storage.
 *
 * All autonomous behavior respects budget, cooldown, dedupe, and
 * stop-condition constraints.
 */
export class BrainCollector {
	private buffer: BrainCollectorBufferEntry[] = [];
	private cooldowns: Map<string, BrainCollectorCooldown> = new Map();
	private dedupeEntries: Map<string, BrainCollectorDedupeEntry> = new Map();
	private stopConditions: BrainCollectorStopCondition[] = [];

	private totalCollected = 0;
	private totalDeduplicated = 0;
	private cyclesHitBudget = 0;
	private cyclesHitTimeLimit = 0;
	private stopped = false;
	private error: string | null = null;

	private budget: BrainCollectorBudget;
	private dedupeConfig: BrainCollectorDedupeConfig;
	private cooldownMs: number;

	constructor(
		budget?: Partial<BrainCollectorBudget>,
		dedupeConfig?: Partial<BrainCollectorDedupeConfig>,
		cooldownMs = 10_000,
	) {
		this.budget = { ...DEFAULT_BRAIN_COLLECTOR_BUDGET, ...budget };
		this.dedupeConfig = { ...DEFAULT_BRAIN_COLLECTOR_DEDUPE, ...dedupeConfig };
		this.cooldownMs = cooldownMs;
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Update budget configuration.
	 */
	setBudget(budget: Partial<BrainCollectorBudget>): void {
		this.budget = { ...this.budget, ...budget };
	}

	/**
	 * Get current budget configuration.
	 */
	getBudget(): BrainCollectorBudget {
		return { ...this.budget };
	}

	/**
	 * Update deduplication configuration.
	 */
	setDedupeConfig(config: Partial<BrainCollectorDedupeConfig>): void {
		this.dedupeConfig = { ...this.dedupeConfig, ...config };
	}

	/**
	 * Get current dedupe configuration.
	 */
	getDedupeConfig(): BrainCollectorDedupeConfig {
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
	getStopConditions(): BrainCollectorStopCondition[] {
		return this.stopConditions.map((sc) => ({ ...sc }));
	}

	// ── Collection ───────────────────────────────────────────────────

	/**
	 * Collect a BrainObservation as an observability event.
	 *
	 * @param observation - The brain observation to collect
	 * @returns The collected observability event, or null if suppressed
	 *          by budget, cooldown, dedupe, or stop condition
	 */
	collectObservation(observation: BrainObservation): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `observation:${observation.signalType}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check
		const contentHash = this.computeContentHash(observation as unknown as Record<string, unknown>);
		if (this.isDuplicate(contentHash, observation.timestamp)) return null;

		// Budget check (time budget)
		const startTime = Date.now();

		// Convert to observability event
		const event = this.observationToEvent(observation);

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		this.addToBuffer(event, "brain_observation", "brain/observation-engine");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, observation.timestamp);

		this.totalCollected++;

		// Time budget check
		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a BrainSignal as an observability event.
	 *
	 * @param signal - The brain signal to collect
	 * @returns The collected observability event, or null if suppressed
	 */
	collectSignal(signal: BrainSignal): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `signal:${signal.pattern}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check
		const contentHash = this.computeContentHash(signal as unknown as Record<string, unknown>);
		if (this.isDuplicate(contentHash, signal.createdAt)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.signalToEvent(signal);

		this.addToBuffer(event, "brain_signal", "brain/signal-engine");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, signal.createdAt);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a BrainTimelineEvent as an observability event.
	 *
	 * @param timelineEvent - The timeline event to collect
	 * @returns The collected observability event, or null if suppressed
	 */
	collectTimelineEvent(timelineEvent: BrainTimelineEvent): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `timeline:${timelineEvent.eventType}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check
		const contentHash = this.computeContentHash(timelineEvent as unknown as Record<string, unknown>);
		if (this.isDuplicate(contentHash, timelineEvent.timestamp)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.timelineEventToEvent(timelineEvent);

		this.addToBuffer(event, `timeline:${timelineEvent.eventType}`, "brain/timeline-store");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, timelineEvent.timestamp);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a batch of brain events in a single cycle.
	 *
	 * Respects per-cycle budget (maxPerCycle) and time budget (maxTimeMs).
	 * Returns the number of events successfully collected.
	 *
	 * @param observations - Brain observations to collect
	 * @param signals - Brain signals to collect
	 * @param timelineEvents - Timeline events to collect
	 * @returns Count of successfully collected events
	 */
	collectBatch(
		observations: BrainObservation[] = [],
		signals: BrainSignal[] = [],
		timelineEvents: BrainTimelineEvent[] = [],
	): number {
		if (this.stopped) return 0;
		if (this.hasStopConditionTriggered()) return 0;

		const startTime = Date.now();
		let collected = 0;
		let hitBudget = false;

		// Collect observations
		for (const obs of observations) {
			if (collected >= this.budget.maxPerCycle) {
				hitBudget = true;
				break;
			}
			const elapsed = Date.now() - startTime;
			if (elapsed >= this.budget.maxTimeMs) {
				this.cyclesHitTimeLimit++;
				break;
			}
			if (this.collectObservation(obs) !== null) {
				collected++;
			}
		}

		// Collect signals (respect remaining per-cycle budget)
		if (!hitBudget) {
			for (const sig of signals) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					this.cyclesHitTimeLimit++;
					break;
				}
				if (this.collectSignal(sig) !== null) {
					collected++;
				}
			}
		}

		// Collect timeline events (respect remaining per-cycle budget)
		if (!hitBudget) {
			for (const ev of timelineEvents) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					this.cyclesHitTimeLimit++;
					break;
				}
				if (this.collectTimelineEvent(ev) !== null) {
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
	drain(): BrainCollectorBufferEntry[] {
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
	peek(limit?: number): BrainCollectorBufferEntry[] {
		if (limit && limit > 0) {
			return this.buffer.slice(0, limit);
		}
		return [...this.buffer];
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get full diagnostics including cooldowns, dedupe stats, budget hits.
	 */
	getDiagnostics(): BrainCollectorDiagnostics {
		const cooldownsRecord: Record<string, BrainCollectorCooldown> = {};
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

	private observationToEvent(observation: BrainObservation): ObservabilityEvent {
		const ctx = createTraceContext({
			name: `brain/observation:${observation.signalType}`,
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});

		const severity = this.mapBrainSeverityToObservability(observation.severity);

		return createObservabilityEvent(ctx, {
			eventType: "brain_observation",
			source: `brain/observation-engine`,
			severity,
			status: "ok",
			name: observation.title,
			message: observation.description,
			data: {
				observationId: observation.id,
				signalType: observation.signalType,
				source: observation.source,
				provenance: {
					confidence: observation.provenance.confidence,
					validatedBy: observation.provenance.validatedBy,
					evidenceCount: observation.evidence.length,
				},
				evidence: observation.evidence.map((e) => ({
					type: e.type,
					path: e.path,
				})),
			},
		});
	}

	private signalToEvent(signal: BrainSignal): ObservabilityEvent {
		const ctx = createTraceContext({
			name: `brain/signal:${signal.pattern}`,
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});

		const severity = this.mapBrainSeverityToObservability(signal.severity);

		return createObservabilityEvent(ctx, {
			eventType: "brain_signal",
			source: "brain/signal-engine",
			severity,
			status: signal.resolvedAt ? "ok" : "running",
			name: signal.pattern,
			message: signal.summary,
			data: {
				signalId: signal.id,
				pattern: signal.pattern,
				confidence: signal.confidence,
				observationIds: signal.observationIds,
				resolvedAt: signal.resolvedAt ?? null,
			},
		});
	}

	private timelineEventToEvent(timelineEvent: BrainTimelineEvent): ObservabilityEvent {
		const ctx = createTraceContext({
			name: `brain/timeline:${timelineEvent.eventType}`,
			correlationId: null,
			projectId: null,
			planExecutionId: timelineEvent.planExecId ?? null,
			workspaceExecutionId: timelineEvent.workspaceId ?? null,
		});

		const severity = this.mapBrainSeverityToObservability(timelineEvent.severity);
		const isErrorType = timelineEvent.eventType === "daemon_error";
		const status: ObservabilityStatus = isErrorType ? "error" : "ok";

		return createObservabilityEvent(ctx, {
			eventType: `brain_timeline_${timelineEvent.eventType}`,
			source: "brain/timeline-store",
			severity,
			status,
			name: `timeline:${timelineEvent.eventType}`,
			message: null,
			data: {
				eventId: timelineEvent.id,
				eventType: timelineEvent.eventType,
				payload: timelineEvent.data,
			},
		});
	}

	private addToBuffer(event: ObservabilityEvent, brainEventType: string, source: string): void {
		const entry: BrainCollectorBufferEntry = {
			event,
			brainEventType,
			source,
			collectedAt: new Date().toISOString(),
		};
		this.buffer.push(entry);
	}

	private computeContentHash(data: Record<string, unknown>): string {
		const hash = createHash("sha256");
		// Use a stable subset of fields to avoid trivial differences
		const stable = {
			type: (data as any).signalType ?? (data as any).pattern ?? (data as any).eventType ?? "unknown",
			title: (data as any).title ?? (data as any).summary ?? "unknown",
			severity: data.severity,
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

	private mapBrainSeverityToObservability(severity: "info" | "warning" | "critical"): ObservabilitySeverity {
		switch (severity) {
			case "info":
				return "info";
			case "warning":
				return "warning";
			case "critical":
				return "error";
		}
	}
}
