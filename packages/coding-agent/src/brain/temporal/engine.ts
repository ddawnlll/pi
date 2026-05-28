/**
 * Temporal Journal v2 — Engine
 *
 * Generates deterministic temporal rollups from source events. Rollups are
 * purely derived from stored TemporalEvent data with no random or LLM-dependent
 * fields, ensuring they can be deterministically regenerated (acceptance
 * criterion 3).
 *
 * The engine answers:
 * - "What happened?" — chronological timeline of events
 * - "What repeated?" — patterns detected across multiple events
 * - "What changed?" — state transitions and deltas
 * - "What got stuck?" — entities stuck in failing/blocked states (acceptance criterion 1)
 *
 * All rollup content is derived from safe summaries and evidence-backed facts;
 * no private chain-of-thought is stored (acceptance criterion 4).
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import type {
	ChangeItem,
	RepeatedPattern,
	RollupPeriod,
	StuckItem,
	TemporalEngineConfig,
	TemporalEvent,
	TemporalEventQuery,
	TemporalJournalStore,
	TemporalRollup,
	TimelineItem,
} from "./types.js";
import { DEFAULT_TEMPORAL_ENGINE_CONFIG } from "./types.js";

// =========================================================================
// Utility: period boundaries
// =========================================================================

/**
 * Compute the start (inclusive) and end (exclusive) ISO 8601 timestamps
 * for a given period type covering the given timestamp.
 */
export function computePeriodBoundaries(
	timestamp: string,
	period: RollupPeriod,
): { periodStart: string; periodEnd: string } {
	const date = new Date(timestamp);
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth();
	const day = date.getUTCDate();

	switch (period) {
		case "daily": {
			const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
			const end = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
			return {
				periodStart: start.toISOString(),
				periodEnd: end.toISOString(),
			};
		}
		case "weekly": {
			// Week starts on Monday (ISO week)
			const dayOfWeek = date.getUTCDay();
			const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Sunday → -6, Monday → 0
			const monday = new Date(Date.UTC(year, month, day + mondayOffset, 0, 0, 0, 0));
			const nextMonday = new Date(Date.UTC(year, month, day + mondayOffset + 7, 0, 0, 0, 0));
			return {
				periodStart: monday.toISOString(),
				periodEnd: nextMonday.toISOString(),
			};
		}
		case "monthly": {
			const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
			const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
			return {
				periodStart: start.toISOString(),
				periodEnd: end.toISOString(),
			};
		}
	}
}

/**
 * Get or compute the covering period boundaries that include both timestamps.
 */
export function computeCoveringPeriod(
	period: RollupPeriod,
	since: string,
	until: string,
): { periodStart: string; periodEnd: string } {
	const sinceBoundaries = computePeriodBoundaries(since, period);
	const untilBoundaries = computePeriodBoundaries(until, period);
	return {
		periodStart: sinceBoundaries.periodStart,
		periodEnd: untilBoundaries.periodEnd,
	};
}

// =========================================================================
// Deterministic hash computation
// =========================================================================

/**
 * Compute a deterministic SHA-256 hash from the rollup content fields.
 *
 * This hash allows verifying that a rollup can be faithfully regenerated
 * from its source events (acceptance criterion 3). The hash is computed
 * from all data-derived fields except `id`, `generatedAt`, and `deterministicHash`.
 */
export function computeRollupDeterministicHash(rollup: {
	period: string;
	periodStart: string;
	periodEnd: string;
	entityId?: string;
	whatHappened: unknown;
	whatRepeated: unknown;
	whatChanged: unknown;
	whatGotStuck: unknown;
	sourceEventIds: string[];
}): string {
	const hash = createHash("sha256");

	// Serialize fields in a fixed order with sorted keys at every nesting level
	function deterministicSerialize(value: unknown): string {
		if (value === null || value === undefined) return "null";
		if (typeof value === "string") return JSON.stringify(value);
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		if (Array.isArray(value)) {
			return `[${value.map(deterministicSerialize).join(",")}]`;
		}
		if (typeof value === "object") {
			const keys = Object.keys(value as Record<string, unknown>).sort();
			const pairs = keys.map(
				(k) => `${JSON.stringify(k)}:${deterministicSerialize((value as Record<string, unknown>)[k])}`,
			);
			return `{${pairs.join(",")}}`;
		}
		return String(value);
	}

	// Build content object with sorted sourceEventIds
	const contentObj = {
		period: rollup.period,
		periodStart: rollup.periodStart,
		periodEnd: rollup.periodEnd,
		entityId: rollup.entityId ?? null,
		whatHappened: rollup.whatHappened,
		whatRepeated: rollup.whatRepeated,
		whatChanged: rollup.whatChanged,
		whatGotStuck: rollup.whatGotStuck,
		sourceEventIds: [...rollup.sourceEventIds].sort(),
	};

	const content = deterministicSerialize(contentObj);
	hash.update(content);
	return hash.digest("hex");
}

// =========================================================================
// Pattern detection (stuck items)
// =========================================================================

/** Event types that indicate a "stuck" condition. */
const STUCK_EVENT_TYPES = new Set([
	"attempt_failed",
	"attempt_blocked",
	"plan_blocked",
	"validation_failed",
	"queue_blocked",
	"retry_failed",
	"task_failed",
	"integration_failed",
]);

/** Event types that indicate a resolution or progress. */
const RESOLUTION_EVENT_TYPES = new Set([
	"plan_completed",
	"attempt_succeeded",
	"task_completed",
	"integration_merged",
	"blockage_resolved",
	"validation_passed",
]);

/**
 * Detect stuck items from a set of events.
 *
 * An item is "stuck" if it has events of stuck-indicating types within
 * the period and no resolution event after the first stuck occurrence.
 *
 * @param events - Events in the period (already filtered by time range)
 * @returns Detected stuck items
 */
export function detectStuckItems(events: TemporalEvent[]): StuckItem[] {
	const stuckMap = new Map<string, StuckItem>();

	for (const event of events) {
		if (!STUCK_EVENT_TYPES.has(event.eventType)) continue;

		const entityKey = event.entityId ?? `__global_${event.eventType}`;
		const existing = stuckMap.get(entityKey);

		if (existing) {
			// Update last observed
			existing.lastObserved = event.timestamp > existing.lastObserved ? event.timestamp : existing.lastObserved;
			existing.attemptsCount++;
			existing.relatedEventIds.push(event.id);
			// Add unique evidence
			for (const ev of event.evidence) {
				if (!existing.evidence.some((e) => e.ref === ev.ref)) {
					existing.evidence.push(ev);
				}
			}
		} else {
			stuckMap.set(entityKey, {
				entityId: event.entityId,
				entityType: event.entityType ?? "workspace",
				description: event.summary,
				stuckSince: event.timestamp,
				lastObserved: event.timestamp,
				attemptsCount: 1,
				evidence: [...event.evidence],
				relatedEventIds: [event.id],
			});
		}

		// Check if we have a resolution event after this stuck event
		// If so, remove from stuck map
		if (event.entityId) {
			const hasResolutionAfter = events.some(
				(e) =>
					e.entityId === event.entityId &&
					RESOLUTION_EVENT_TYPES.has(e.eventType) &&
					e.timestamp > event.timestamp,
			);
			if (hasResolutionAfter) {
				stuckMap.delete(entityKey);
			}
		}
	}

	return Array.from(stuckMap.values());
}

// =========================================================================
// Pattern detection (repeated events)
// =========================================================================

/**
 * Detect repeated patterns from a set of events.
 *
 * Patterns are grouped by (entityId, eventType) pairs that occur
 * more than once in the period.
 *
 * @param events - Events in the period
 * @returns Detected repeated patterns, sorted by count descending
 */
export function detectRepeatedPatterns(events: TemporalEvent[]): RepeatedPattern[] {
	const patternMap = new Map<string, { count: number; events: TemporalEvent[] }>();

	for (const event of events) {
		const key = `${event.entityId ?? "__global"}::${event.eventType}`;
		const existing = patternMap.get(key);
		if (existing) {
			existing.count++;
			existing.events.push(event);
		} else {
			patternMap.set(key, { count: 1, events: [event] });
		}
	}

	// Only return patterns with count >= 2
	const patterns: RepeatedPattern[] = [];
	for (const [key, data] of patternMap) {
		if (data.count < 2) continue;
		const [, eventType] = key.split("::");
		const sorted = [...data.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		const firstEv = sorted[0]!;
		const lastEv = sorted[sorted.length - 1]!;

		// Collect unique evidence across all events
		const evidenceSet = new Map<string, TemporalEvent["evidence"][0]>();
		for (const ev of sorted) {
			for (const ref of ev.evidence) {
				if (!evidenceSet.has(ref.ref)) {
					evidenceSet.set(ref.ref, ref);
				}
			}
		}

		const entityId = sorted.find((e) => e.entityId)?.entityId;

		patterns.push({
			pattern: `${eventType} occurred ${data.count} times${entityId ? ` on ${entityId}` : ""}`,
			count: data.count,
			eventType,
			entityId,
			firstOccurrence: firstEv.timestamp,
			lastOccurrence: lastEv.timestamp,
			evidence: Array.from(evidenceSet.values()),
		});
	}

	// Sort by count descending
	patterns.sort((a, b) => b.count - a.count);
	return patterns;
}

// =========================================================================
// Change detection
// =========================================================================

/**
 * Detect changes from a set of events.
 *
 * Changes are derived from events with event types that indicate
 * state transitions (e.g., "plan_completed", "attempt_succeeded",
 * "validation_failed").
 *
 * @param events - Events in the period
 * @returns Detected changes
 */
export function detectChanges(events: TemporalEvent[]): ChangeItem[] {
	const changes: ChangeItem[] = [];

	// Group events by entity to detect state transitions
	const entityEvents = new Map<string, TemporalEvent[]>();
	for (const event of events) {
		if (event.entityId) {
			const list = entityEvents.get(event.entityId) ?? [];
			list.push(event);
			entityEvents.set(event.entityId, list);
		}
	}

	// For each entity, detect transitions
	for (const [entityId, entityEvts] of entityEvents) {
		const sorted = [...entityEvts].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		// Detect completion transitions
		const completionEvents = sorted.filter(
			(e) =>
				e.eventType === "plan_completed" || e.eventType === "attempt_succeeded" || e.eventType === "task_completed",
		);
		for (const ev of completionEvents) {
			changes.push({
				description: `${entityId}: ${ev.eventType} — ${ev.summary}`,
				toState: ev.eventType === "plan_completed" ? "completed" : "succeeded",
				entityId,
				eventIds: [ev.id],
				evidence: [...ev.evidence],
			});
		}

		// Detect failure transitions
		const failureEvents = sorted.filter(
			(e) => e.eventType === "attempt_failed" || e.eventType === "validation_failed",
		);
		for (const ev of failureEvents) {
			changes.push({
				description: `${entityId}: ${ev.eventType} — ${ev.summary}`,
				fromState: "running",
				toState: "failed",
				entityId,
				eventIds: [ev.id],
				evidence: [...ev.evidence],
			});
		}

		// Detect blockage transitions
		const blockedEvents = sorted.filter((e) => e.eventType === "plan_blocked" || e.eventType === "queue_blocked");
		for (const ev of blockedEvents) {
			changes.push({
				description: `${entityId}: ${ev.eventType} — ${ev.summary}`,
				toState: "blocked",
				entityId,
				eventIds: [ev.id],
				evidence: [...ev.evidence],
			});
		}
	}

	return changes;
}

// =========================================================================
// Rollup Generator
// =========================================================================

/**
 * Generate a deterministic temporal rollup from source events.
 *
 * The rollup is computed purely from the provided events with no
 * random or LLM-dependent fields. The deterministicHash is computed
 * from the rollup content, enabling verification that the rollup can
 * be faithfully regenerated (acceptance criterion 3).
 *
 * @param events - Source events for the rollup period
 * @param period - Rollup period type
 * @param periodStart - ISO 8601 start of period (inclusive)
 * @param periodEnd - ISO 8601 end of period (exclusive)
 * @param entityId - Optional entity ID scope
 * @returns A deterministic TemporalRollup
 */
export function generateRollup(
	events: TemporalEvent[],
	period: RollupPeriod,
	periodStart: string,
	periodEnd: string,
	entityId?: string,
): TemporalRollup {
	// Build timeline items
	const items: TimelineItem[] = events
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
		.map((e) => ({
			eventId: e.id,
			timestamp: e.timestamp,
			eventType: e.eventType,
			entityId: e.entityId,
			summary: e.summary,
			evidence: [...e.evidence],
		}));

	// Detect patterns, changes, stuck items
	const patterns = detectRepeatedPatterns(events);
	const changes = detectChanges(events);
	const stuckItems = detectStuckItems(events);

	// Build summaries
	const whatHappenedSummary =
		items.length > 0
			? `${items.length} event${items.length === 1 ? "" : "s"} recorded in this period.`
			: "No events recorded in this period.";

	const whatRepeatedSummary =
		patterns.length > 0
			? `${patterns.length} pattern${patterns.length === 1 ? "" : "s"} detected: ${patterns.map((p) => p.pattern).join("; ")}.`
			: "No repeating patterns detected.";

	const whatChangedSummary =
		changes.length > 0
			? `${changes.length} change${changes.length === 1 ? "" : "s"} detected in this period.`
			: "No changes detected.";

	// Build the rollup
	const sourceEventIds = events.map((e) => e.id);

	const rollup: TemporalRollup = {
		id: randomUUID(),
		period,
		periodStart,
		periodEnd,
		entityId,
		generatedAt: new Date().toISOString(),
		whatHappened: {
			items,
			summary: whatHappenedSummary,
		},
		whatRepeated: {
			patterns,
			summary: whatRepeatedSummary,
		},
		whatChanged: {
			changes,
			summary: whatChangedSummary,
		},
		whatGotStuck: stuckItems,
		sourceEventIds,
		deterministicHash: "", // Set below
	};

	// Compute deterministic hash
	rollup.deterministicHash = computeRollupDeterministicHash(rollup);

	return rollup;
}

// =========================================================================
// TemporalEngine
// =========================================================================

/**
 * Temporal Journal Engine.
 *
 * The engine manages the lifecycle of temporal events and rollups:
 * - Records events with evidence references (acceptance criterion 2)
 * - Generates deterministic rollups from source events (acceptance criterion 3)
 * - Answers "what got stuck?" queries (acceptance criterion 1)
 * - Stores only safe summaries and evidence-backed facts (acceptance criterion 4)
 */
export class TemporalEngine {
	private readonly _store: TemporalJournalStore;
	private _config: TemporalEngineConfig;

	constructor(store: TemporalJournalStore, config?: Partial<TemporalEngineConfig>) {
		this._store = store;
		this._config = { ...DEFAULT_TEMPORAL_ENGINE_CONFIG, ...config };
	}

	/** Get the underlying store for direct queries. */
	get store(): TemporalJournalStore {
		return this._store;
	}

	/** Get the current config. */
	get config(): TemporalEngineConfig {
		return { ...this._config };
	}

	/** Update the config. */
	updateConfig(config: Partial<TemporalEngineConfig>): void {
		this._config = { ...this._config, ...config };
	}

	// ── Event Recording ──

	/**
	 * Record a temporal event with evidence references and optional entity ID.
	 *
	 * @param event - The temporal event to record
	 */
	async recordEvent(event: TemporalEvent): Promise<void> {
		await this._store.recordEvent(event);

		// Auto-generate rollups if configured
		if (this._config.autoDailyRollup || this._config.autoWeeklyRollup || this._config.autoMonthlyRollup) {
			await this.maybeAutoRollup(event.timestamp, event.entityId);
		}
	}

	/**
	 * Record multiple temporal events atomically.
	 *
	 * @param events - The temporal events to record
	 */
	async recordEvents(events: TemporalEvent[]): Promise<void> {
		await this._store.recordEvents(events);

		// Auto-generate rollups based on the latest event timestamp
		if (
			events.length > 0 &&
			(this._config.autoDailyRollup || this._config.autoWeeklyRollup || this._config.autoMonthlyRollup)
		) {
			const latestEvent = [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]!;
			await this.maybeAutoRollup(latestEvent.timestamp, latestEvent.entityId);
		}
	}

	/**
	 * Check if auto-rollup should be triggered and generate if needed.
	 */
	private async maybeAutoRollup(timestamp: string, entityId?: string): Promise<void> {
		if (this._config.autoDailyRollup) {
			const { periodStart, periodEnd } = computePeriodBoundaries(timestamp, "daily");
			const existing = await this._store.getLatestRollup("daily", entityId);
			if (!existing || existing.periodStart !== periodStart) {
				// Generate daily rollup for the previous completed day?
				// For simplicity, we generate for the current period boundaries.
				// This is deterministic; same source events → same rollup.
				const events = await this._store.queryEvents({
					since: periodStart,
					until: periodEnd,
					entityId,
				});
				if (events.length > 0) {
					const rollup = generateRollup(events, "daily", periodStart, periodEnd, entityId);
					await this._store.storeRollup(rollup);
				}
			}
		}
	}

	// ── Rollup Generation ──

	/**
	 * Generate rollup(s) for a given period, optionally scoped to an entity.
	 *
	 * This is a pure function — the rollup is computed deterministically from
	 * the stored events without any LLM or random input, ensuring it can be
	 * regenerated from source events (acceptance criterion 3).
	 *
	 * @param period - Rollup period type
	 * @param periodStart - ISO 8601 start (inclusive)
	 * @param periodEnd - ISO 8601 end (exclusive)
	 * @param entityId - Optional entity ID scope
	 * @returns The generated rollup
	 */
	async generateAndStoreRollup(
		period: RollupPeriod,
		periodStart: string,
		periodEnd: string,
		entityId?: string,
	): Promise<TemporalRollup> {
		const events = await this._store.queryEvents({
			since: periodStart,
			until: periodEnd,
			entityId,
		});

		const rollup = generateRollup(events, period, periodStart, periodEnd, entityId);
		await this._store.storeRollup(rollup);
		return rollup;
	}

	/**
	 * Regenerate a rollup from its source events, verifying determinism.
	 *
	 * This fetches the original rollup, re-fetches the source events, and
	 * generates a new rollup from those same events. The deterministic hashes
	 * are compared to verify that the rollup can be faithfully regenerated
	 * (acceptance criterion 3).
	 *
	 * @param rollupId - ID of the existing rollup to regenerate
	 * @returns The regenerated rollup (also stored)
	 */
	async regenerateRollup(rollupId: string): Promise<{ rollup: TemporalRollup; matchesOriginal: boolean }> {
		const original = await this._store.getRollup(rollupId);
		if (!original) {
			throw new Error(`Rollup not found: ${rollupId}`);
		}

		// Fetch all source events
		const events: TemporalEvent[] = [];
		for (const eventId of original.sourceEventIds) {
			const event = await this._store.getEvent(eventId);
			if (event) events.push(event);
		}

		// Regenerate deterministically
		const regenerated = generateRollup(
			events,
			original.period,
			original.periodStart,
			original.periodEnd,
			original.entityId,
		);

		const matchesOriginal = regenerated.deterministicHash === original.deterministicHash;

		// Store the regenerated rollup for verification
		await this._store.storeRollup(regenerated);

		return { rollup: regenerated, matchesOriginal };
	}

	// ── Query: "What got stuck?" ──

	/**
	 * Answer "what got stuck?" for a given time range (acceptance criterion 1).
	 *
	 * Returns all stuck items detected from events in the time range.
	 *
	 * @param since - ISO 8601 start of time range (inclusive)
	 * @param until - ISO 8601 end of time range (exclusive)
	 * @param entityId - Optional entity ID filter
	 * @returns Stuck items found in the period
	 */
	async queryStuckItems(
		since: string,
		until: string,
		entityId?: string,
	): Promise<{
		items: StuckItem[];
		total: number;
		period: { since: string; until: string };
	}> {
		const events = await this._store.queryEvents({
			since,
			until,
			entityId,
		});

		const items = detectStuckItems(events);

		return {
			items,
			total: items.length,
			period: { since, until },
		};
	}

	/**
	 * Convenience: answer "what got stuck last week?"
	 *
	 * Computes the current week boundaries (Monday to Monday) and queries
	 * stuck items for the *previous* calendar week.
	 *
	 * @param entityId - Optional entity ID filter
	 * @returns Stuck items for last week
	 */
	async queryStuckLastWeek(entityId?: string): Promise<{
		items: StuckItem[];
		total: number;
		period: { since: string; until: string };
	}> {
		// Compute last week's boundaries
		const now = new Date();
		const dayOfWeek = now.getUTCDay();
		const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

		// This week's Monday
		const thisMonday = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset, 0, 0, 0, 0),
		);

		// Last week's Monday
		const lastMonday = new Date(thisMonday);
		lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

		const since = lastMonday.toISOString();
		const until = thisMonday.toISOString();

		return this.queryStuckItems(since, until, entityId);
	}

	// ── Query: "What happened?" ──

	/**
	 * Answer "what happened?" for a given time range.
	 *
	 * Returns a chronological timeline of events in the period.
	 *
	 * @param query - Event query options
	 * @returns Chronological timeline items
	 */
	async queryWhatHappened(query: TemporalEventQuery): Promise<{
		items: TimelineItem[];
		total: number;
	}> {
		const events = await this._store.queryEvents(query);
		const items: TimelineItem[] = events
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
			.map((e) => ({
				eventId: e.id,
				timestamp: e.timestamp,
				eventType: e.eventType,
				entityId: e.entityId,
				summary: e.summary,
				evidence: [...e.evidence],
			}));

		return { items, total: items.length };
	}

	// ── Query: "What repeated?" ──

	/**
	 * Answer "what repeated?" for a given time range.
	 *
	 * Returns patterns detected from repeated event types/entities.
	 *
	 * @param query - Event query options
	 * @returns Detected repeated patterns
	 */
	async queryWhatRepeated(query: TemporalEventQuery): Promise<{
		patterns: RepeatedPattern[];
		total: number;
	}> {
		const events = await this._store.queryEvents(query);
		const patterns = detectRepeatedPatterns(events);

		return { patterns, total: patterns.length };
	}

	// ── Query: "What changed?" ──

	/**
	 * Answer "what changed?" for a given time range.
	 *
	 * Returns state transitions and changes detected from events.
	 *
	 * @param query - Event query options
	 * @returns Detected changes
	 */
	async queryWhatChanged(query: TemporalEventQuery): Promise<{
		changes: ChangeItem[];
		total: number;
	}> {
		const events = await this._store.queryEvents(query);
		const changes = detectChanges(events);

		return { changes, total: changes.length };
	}

	// ── Rollup-based query: "What got stuck?" ──

	/**
	 * Answer "what got stuck?" using the latest available rollups for a period.
	 *
	 * This prefers stored rollups over live query. If rollups exist for the
	 * requested period, their stuck items are merged. Otherwise, a live query
	 * is performed against the raw events.
	 *
	 * @param period - Rollup period type
	 * @param entityId - Optional entity ID
	 * @returns Stuck items from the latest rollup or live query
	 */
	async queryStuckFromRollup(
		period: RollupPeriod,
		entityId?: string,
	): Promise<{
		items: StuckItem[];
		source: "rollup" | "live";
		rollupId?: string;
	}> {
		const latest = await this._store.getLatestRollup(period, entityId);

		if (latest) {
			return {
				items: latest.whatGotStuck,
				source: "rollup",
				rollupId: latest.id,
			};
		}

		// Fall back to live query for the current period
		const now = new Date().toISOString();
		const { periodStart } = computePeriodBoundaries(now, period);
		const result = await this.queryStuckItems(periodStart, now, entityId);
		return {
			items: result.items,
			source: "live",
		};
	}
}
