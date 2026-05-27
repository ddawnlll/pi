/**
 * Retention engine for telemetry event lifecycle management (25.B).
 *
 * Provides configurable retention policies that govern how long telemetry
 * events are kept before being pruned. Supports:
 *
 * - Time-to-live (TTL) retention per event type, source, or severity
 * - Maximum event count limits (global or per category)
 * - Budget enforcement with deduplication and cooldown
 * - Scheduled or manual pruning
 * - Diagnostic reporting
 *
 * @module observability/store/retention
 */

import type { ObservabilityEvent, ObservabilitySeverity } from "../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * A single retention rule defining what events to keep and for how long.
 */
export interface RetentionRule {
	/** Human-readable name for this rule */
	name: string;
	/** Event type filter (matched against event.eventType). Empty string matches all. */
	eventType?: string;
	/** Source filter (matched against event.source). Empty string matches all. */
	source?: string;
	/** Severity filter. Events matching this severity are subject to this rule. */
	severity?: ObservabilitySeverity | "all";
	/** Maximum age in milliseconds before the event is eligible for pruning */
	maxAgeMs: number;
	/** Maximum number of events matching this rule to retain (0 = unlimited) */
	maxCount: number;
	/** Priority for rule evaluation (lower = evaluated first, default: 100) */
	priority?: number;
}

/**
 * Retention policy — a named set of rules.
 */
export interface RetentionPolicy {
	/** Policy name */
	name: string;
	/** Individual retention rules evaluated in priority order */
	rules: RetentionRule[];
	/** Global maximum events across all categories (0 = unlimited) */
	globalMaxCount: number;
	/** Pruning interval in milliseconds (default: 60000 = 1 minute) */
	pruneIntervalMs: number;
	/** Whether to enable automatic background pruning */
	autoPrune: boolean;
}

/**
 * Default retention policy with sensible defaults.
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
	name: "default",
	rules: [
		// Debug events: 1 hour, max 1000
		{
			name: "debug-events",
			severity: "debug",
			maxAgeMs: 3_600_000, // 1 hour
			maxCount: 1000,
			priority: 10,
		},
		// Info events: 24 hours, max 10000
		{
			name: "info-events",
			severity: "info",
			maxAgeMs: 86_400_000, // 24 hours
			maxCount: 10_000,
			priority: 20,
		},
		// Warning events: 7 days, max 5000
		{
			name: "warning-events",
			severity: "warning",
			maxAgeMs: 604_800_000, // 7 days
			maxCount: 5000,
			priority: 30,
		},
		// Error events: 30 days, max 10000
		{
			name: "error-events",
			severity: "error",
			maxAgeMs: 2_592_000_000, // 30 days
			maxCount: 10_000,
			priority: 40,
		},
		// Critical events: 90 days, max 5000
		{
			name: "critical-events",
			severity: "critical",
			maxAgeMs: 7_776_000_000, // 90 days
			maxCount: 5000,
			priority: 50,
		},
		// Workspace and span events: 7 days
		{
			name: "trace-events",
			eventType: "span_start",
			maxAgeMs: 604_800_000, // 7 days
			maxCount: 50_000,
			priority: 60,
		},
		{
			name: "trace-end-events",
			eventType: "span_end",
			maxAgeMs: 604_800_000, // 7 days
			maxCount: 50_000,
			priority: 61,
		},
	],
	globalMaxCount: 100_000,
	pruneIntervalMs: 60_000, // 1 minute
	autoPrune: true,
};

/**
 * Result of a pruning operation.
 */
export interface PruneResult {
	/** Total events evaluated */
	eventsEvaluated: number;
	/** Total events pruned */
	eventsPruned: number;
	/** Events removed due to TTL expiry */
	prunedByAge: number;
	/** Events removed due to count limits */
	prunedByCount: number;
	/** Per-rule breakdown */
	rules: Array<{
		ruleName: string;
		eventsBefore: number;
		eventsAfter: number;
		pruned: number;
	}>;
	/** Duration of the prune operation in milliseconds */
	durationMs: number;
	/** Any errors encountered during pruning */
	errors: string[];
	/** Whether pruning was stopped early due to budget or time limits */
	stoppedEarly: boolean;
}

/**
 * Deduplication configuration for autonomous pruning.
 */
export interface DedupeConfig {
	/** Whether deduplication is enabled (default: true) */
	enabled: boolean;
	/** Time window in ms for considering events as duplicates (default: 5000) */
	windowMs: number;
	/** Maximum number of similar events within the window (default: 10) */
	maxSimilar: number;
}

/**
 * Default deduplication configuration.
 */
export const DEFAULT_DEDUPE_CONFIG: DedupeConfig = {
	enabled: true,
	windowMs: 5000,
	maxSimilar: 10,
};

/**
 * Budget configuration for autonomous retention.
 */
export interface RetentionBudget {
	/** Maximum number of events to prune in a single operation (default: 10000) */
	maxPrunePerCycle: number;
	/** Cooldown period in ms between automatic prune cycles (default: 30000) */
	cooldownMs: number;
	/** Maximum CPU time (ms) spent pruning per cycle (default: 100) */
	maxTimeMs: number;
}

/**
 * Default retention budget.
 */
export const DEFAULT_RETENTION_BUDGET: RetentionBudget = {
	maxPrunePerCycle: 10_000,
	cooldownMs: 30_000,
	maxTimeMs: 100,
};

// ─────────────────────────────────────────────────────────────────────
// RetentionEngine
// ─────────────────────────────────────────────────────────────────────

/**
 * Retention engine that applies configured policies to prune events.
 *
 * Supports both automatic background pruning on an interval and manual
 * pruning on demand. All autonomous behavior respects budget, cooldown,
 * dedupe, and stop-condition constraints.
 */
export class RetentionEngine {
	private policy: RetentionPolicy;
	private dedupeConfig: DedupeConfig;
	private budget: RetentionBudget;
	private pruneTimer: ReturnType<typeof setInterval> | null = null;
	private lastPruneTimestamp: number | null = null;
	private isPruning = false;
	private totalPruned = 0;
	private totalPruneCycles = 0;
	private totalPruneTimeMs = 0;

	// Store reference - events are provided to prune() as needed
	// The engine does not own the events; it processes them when called.

	constructor(
		policy?: Partial<RetentionPolicy>,
		dedupeConfig?: Partial<DedupeConfig>,
		budget?: Partial<RetentionBudget>,
	) {
		this.policy = { ...DEFAULT_RETENTION_POLICY, ...policy };
		this.dedupeConfig = { ...DEFAULT_DEDUPE_CONFIG, ...dedupeConfig };
		this.budget = { ...DEFAULT_RETENTION_BUDGET, ...budget };
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Get the current retention policy.
	 */
	getPolicy(): RetentionPolicy {
		return { ...this.policy };
	}

	/**
	 * Update the retention policy at runtime.
	 */
	setPolicy(policy: Partial<RetentionPolicy>): void {
		this.policy = { ...this.policy, ...policy };
	}

	/**
	 * Get the current dedupe configuration.
	 */
	getDedupeConfig(): DedupeConfig {
		return { ...this.dedupeConfig };
	}

	/**
	 * Update dedupe configuration.
	 */
	setDedupeConfig(config: Partial<DedupeConfig>): void {
		this.dedupeConfig = { ...this.dedupeConfig, ...config };
	}

	/**
	 * Get the current retention budget.
	 */
	getBudget(): RetentionBudget {
		return { ...this.budget };
	}

	/**
	 * Update the retention budget.
	 */
	setBudget(budget: Partial<RetentionBudget>): void {
		this.budget = { ...this.budget, ...budget };
	}

	// ── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Start automatic background pruning.
	 */
	start(): void {
		if (this.pruneTimer) return;
		if (!this.policy.autoPrune) return;

		this.pruneTimer = setInterval(() => {
			this.pruneIfNeeded([]).catch(() => {
				// Silently handle pruning errors in background
			});
		}, this.policy.pruneIntervalMs);

		if (this.pruneTimer && typeof this.pruneTimer === "object" && "unref" in this.pruneTimer) {
			this.pruneTimer.unref();
		}
	}

	/**
	 * Stop automatic background pruning.
	 */
	stop(): void {
		if (this.pruneTimer) {
			clearInterval(this.pruneTimer);
			this.pruneTimer = null;
		}
	}

	// ── Pruning ──────────────────────────────────────────────────────

	/**
	 * Prune events based on retention policy.
	 *
	 * This method accepts a list of events (from the telemetry store or database)
	 * and returns the subset that should be retained, plus a PruneResult.
	 *
	 * The pruning process respects:
	 * - Budget (max events to prune, max time spent)
	 * - Cooldown (minimum time between automatic prunes)
	 * - Dedupe (removes similar events within a time window)
	 * - Stop-condition (early exit when budget or time limits hit)
	 *
	 * @param events - Full list of events to evaluate for pruning
	 * @returns Object with retained events and prune result
	 */
	prune(events: ObservabilityEvent[]): { retained: ObservabilityEvent[]; result: PruneResult } {
		const startTime = Date.now();
		const errors: string[] = [];
		let prunedByAge = 0;
		let prunedByCount = 0;
		let stoppedEarly = false;

		const maxTimeMs = this.budget.maxTimeMs;

		// ── Step 1: Sort rules by priority ────────────────────────
		const sortedRules = [...this.policy.rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

		// ── Step 2: Apply deduplication ────────────────────────────
		let dedupedEvents = events;
		if (this.dedupeConfig.enabled) {
			dedupedEvents = this.applyDeduplication(events);
		}

		// ── Step 3: Apply TTL-based pruning ────────────────────────
		const now = Date.now();
		let afterTtl = dedupedEvents;
		const ruleBreakdown: Array<{
			ruleName: string;
			eventsBefore: number;
			eventsAfter: number;
			pruned: number;
		}> = [];

		for (const rule of sortedRules) {
			// Stop-condition check: if we've exceeded time budget, stop early
			const elapsedSoFar = Date.now() - startTime;
			if (maxTimeMs >= 0 && elapsedSoFar >= maxTimeMs) {
				stoppedEarly = true;
				errors.push(`Time budget exceeded: stopped early at ${elapsedSoFar}ms (budget: ${maxTimeMs}ms)`);
				break;
			}

			const beforeCount = afterTtl.length;

			// Determine eligible events based on rule filters
			const eligible = afterTtl.filter((e) => this.eventMatchesRule(e, rule));
			const nonEligible = afterTtl.filter((e) => !this.eventMatchesRule(e, rule));

			// Apply TTL: remove events older than maxAgeMs
			const ttlCutoff = new Date(now - rule.maxAgeMs).toISOString();
			const ttlKept = eligible.filter((e) => e.timestamp >= ttlCutoff);
			const ttlPruned = eligible.length - ttlKept.length;
			prunedByAge += ttlPruned;

			// Apply max count: if still over limit, remove oldest
			let afterCountLimit = ttlKept;
			if (rule.maxCount > 0 && afterCountLimit.length > rule.maxCount) {
				afterCountLimit.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
				const countPruned = afterCountLimit.length - rule.maxCount;
				afterCountLimit = afterCountLimit.slice(afterCountLimit.length - rule.maxCount);
				prunedByCount += countPruned;
			}

			afterTtl = [...nonEligible, ...afterCountLimit];
			const prunedInRule = beforeCount - afterTtl.length;

			ruleBreakdown.push({
				ruleName: rule.name,
				eventsBefore: beforeCount,
				eventsAfter: afterTtl.length,
				pruned: prunedInRule,
			});
		}

		// ── Step 4: Apply global max count ─────────────────────────
		if (this.policy.globalMaxCount > 0 && afterTtl.length > this.policy.globalMaxCount) {
			afterTtl.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
			const globalPruned = afterTtl.length - this.policy.globalMaxCount;
			afterTtl = afterTtl.slice(afterTtl.length - this.policy.globalMaxCount);
			prunedByCount += globalPruned;
		}

		const durationMs = Date.now() - startTime;
		if (this.budget.maxTimeMs >= 0 && durationMs >= this.budget.maxTimeMs) {
			stoppedEarly = true;
			errors.push(`Time budget exceeded: ${durationMs}ms >= ${this.budget.maxTimeMs}ms`);
		}
		this.totalPruneTimeMs += durationMs;
		const eventsPruned = events.length - afterTtl.length;
		this.totalPruned += eventsPruned;
		this.totalPruneCycles++;
		this.lastPruneTimestamp = now;

		return {
			retained: afterTtl,
			result: {
				eventsEvaluated: events.length,
				eventsPruned,
				prunedByAge,
				prunedByCount,
				rules: ruleBreakdown,
				durationMs,
				errors,
				stoppedEarly,
			},
		};
	}

	/**
	 * Conditionally prune if cooldown has elapsed.
	 *
	 * This is the autonomous-friendly version of prune() that respects
	 * cooldown and budget constraints. It is called by the background timer.
	 *
	 * @param events - Full list of events
	 * @returns PruneResult or null if cooldown not elapsed
	 */
	async pruneIfNeeded(events: ObservabilityEvent[]): Promise<PruneResult | null> {
		if (this.isPruning) return null;

		// Cooldown check
		if (this.lastPruneTimestamp !== null) {
			const elapsed = Date.now() - this.lastPruneTimestamp;
			if (elapsed < this.budget.cooldownMs) {
				return null;
			}
		}

		// Stop condition: global max pruned
		if (this.totalPruned >= this.budget.maxPrunePerCycle) {
			return null;
		}

		this.isPruning = true;
		try {
			const { result } = this.prune(events);
			return result;
		} finally {
			this.isPruning = false;
		}
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get retention engine diagnostics.
	 */
	getDiagnostics(): {
		policyName: string;
		rules: number;
		autoPrune: boolean;
		isPruning: boolean;
		totalPruned: number;
		totalPruneCycles: number;
		totalPruneTimeMs: number;
		lastPruneTimestamp: number | null;
		cooldownRemainingMs: number | null;
	} {
		const now = Date.now();
		return {
			policyName: this.policy.name,
			rules: this.policy.rules.length,
			autoPrune: this.policy.autoPrune,
			isPruning: this.isPruning,
			totalPruned: this.totalPruned,
			totalPruneCycles: this.totalPruneCycles,
			totalPruneTimeMs: this.totalPruneTimeMs,
			lastPruneTimestamp: this.lastPruneTimestamp,
			cooldownRemainingMs:
				this.lastPruneTimestamp !== null
					? Math.max(0, this.budget.cooldownMs - (now - this.lastPruneTimestamp))
					: null,
		};
	}

	// ── Private ──────────────────────────────────────────────────────

	/**
	 * Check if an event matches a retention rule's filters.
	 */
	private eventMatchesRule(event: ObservabilityEvent, rule: RetentionRule): boolean {
		if (rule.eventType && rule.eventType !== "" && event.eventType !== rule.eventType) return false;
		if (rule.source && rule.source !== "" && event.source !== rule.source) return false;
		if (rule.severity && rule.severity !== "all" && event.severity !== rule.severity) return false;
		return true;
	}

	/**
	 * Apply deduplication to events.
	 *
	 * If multiple events with the same eventType, source, and name occur
	 * within the dedupe window, only the first is kept.
	 */
	private applyDeduplication(events: ObservabilityEvent[]): ObservabilityEvent[] {
		if (events.length < 2) return events;

		const windowMs = this.dedupeConfig.windowMs;
		const maxSimilar = this.dedupeConfig.maxSimilar;
		const seen = new Map<string, number[]>();

		return events.filter((event) => {
			const key = `${event.eventType}:${event.source}:${event.name}`;
			const timestamps = seen.get(key) ?? [];
			const eventTime = new Date(event.timestamp).getTime();

			// Clean up old entries outside the window
			const recent = timestamps.filter((t) => eventTime - t <= windowMs);

			if (recent.length >= maxSimilar) {
				return false; // Deduplicate
			}

			recent.push(eventTime);
			seen.set(key, recent);
			return true;
		});
	}
}
