/**
 * Temporal Journal v2 — Types
 *
 * Defines the types for daily, weekly, monthly, and entity-scoped temporal
 * journals that answer what happened, what repeated, and what changed over
 * time.
 *
 * Acceptance Criteria (V5.01):
 * 1. The system can answer "what got stuck last week?" from stored temporal rollups.
 * 2. Temporal events include evidence references and stable entity IDs where possible.
 * 3. Rollups are deterministic and can be regenerated from source events.
 * 4. No private chain-of-thought is stored; only safe summaries and evidence-backed facts.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

// =========================================================================
// Period & Scope
// =========================================================================

/** Rollup period granularity. */
export type RollupPeriod = "daily" | "weekly" | "monthly";

/** Entity types that can be tracked in temporal journals. */
export type TemporalEntityType = "workspace" | "plan" | "goal" | "memory" | "proposal" | "system";

// =========================================================================
// Temporal Event — the atomic unit
// =========================================================================

/**
 * A reference to evidence that supports a temporal event.
 *
 * Every temporal event must carry at least one evidence reference so that
 * claims can be traced back to their source. No private chain-of-thought
 * is stored — only safe summaries and evidence-backed facts.
 */
export interface TemporalEvidenceRef {
	/** Type of evidence source. */
	type: "file" | "journal" | "timeline_event" | "memory" | "observation" | "signal" | "log";
	/** Reference path or ID. */
	ref: string;
	/** Human-readable description of what this evidence shows. */
	description: string;
}

/**
 * A temporal event recorded by the brain.
 *
 * Temporal events are the atomic unit of the temporal journal system.
 * They represent a discrete occurrence at a point in time, with evidence
 * references and an optional stable entity ID for entity-scoped journals.
 *
 * No private chain-of-thought is stored — only safe summaries and
 * evidence-backed facts (acceptance criterion 4).
 */
export interface TemporalEvent {
	/** Unique identifier (UUID v4). */
	id: string;
	/** ISO 8601 timestamp of when the event occurred. */
	timestamp: string;
	/** Optional stable entity ID for entity-scoped journals. */
	entityId?: string;
	/** Optional entity type. */
	entityType?: TemporalEntityType;
	/** Event type label (e.g., "attempt_failed", "proposal_generated", "plan_completed"). */
	eventType: string;
	/** Safe, human-readable summary of what happened. No private chain-of-thought. */
	summary: string;
	/** Evidence references backing this event (acceptance criterion 2). */
	evidence: TemporalEvidenceRef[];
	/** Arbitrary additional metadata (safe facts only, no chain-of-thought). */
	metadata: Record<string, unknown>;
}

// =========================================================================
// Temporal Rollup — answers what happened, repeated, changed
// =========================================================================

/**
 * A single item in a timeline of what happened during a period.
 */
export interface TimelineItem {
	/** Source event ID. */
	eventId: string;
	/** ISO 8601 timestamp of occurrence. */
	timestamp: string;
	/** Event type label. */
	eventType: string;
	/** Optional entity ID this item relates to. */
	entityId?: string;
	/** Safe summary. */
	summary: string;
	/** Evidence references from the source event. */
	evidence: TemporalEvidenceRef[];
}

/**
 * A repeated pattern detected across multiple events.
 */
export interface RepeatedPattern {
	/** Pattern description (e.g., "workspace X failed 3 times"). */
	pattern: string;
	/** Number of occurrences in the period. */
	count: number;
	/** Event type of the pattern. */
	eventType: string;
	/** Optional entity ID the pattern relates to. */
	entityId?: string;
	/** ISO 8601 timestamp of first occurrence. */
	firstOccurrence: string;
	/** ISO 8601 timestamp of last occurrence. */
	lastOccurrence: string;
	/** Aggregate evidence references. */
	evidence: TemporalEvidenceRef[];
}

/**
 * A detected change between two points in time or across a period.
 */
export interface ChangeItem {
	/** Description of what changed. */
	description: string;
	/** Previous state/value (optional). */
	fromState?: string;
	/** New state/value (optional). */
	toState?: string;
	/** Optional entity ID the change relates to. */
	entityId?: string;
	/** IDs of events that evidence this change. */
	eventIds: string[];
	/** Evidence references. */
	evidence: TemporalEvidenceRef[];
}

/**
 * An item representing something that got stuck (blocked/failing).
 *
 * Used to answer the query "what got stuck last week?" (acceptance criterion 1).
 */
export interface StuckItem {
	/** Optional entity ID of the stuck item. */
	entityId?: string;
	/** Entity type. */
	entityType?: TemporalEntityType;
	/** Description of what's stuck. */
	description: string;
	/** ISO 8601 timestamp of when it first became stuck. */
	stuckSince: string;
	/** ISO 8601 timestamp of when it was last observed stuck. */
	lastObserved: string;
	/** Number of failed/blocked attempts. */
	attemptsCount: number;
	/** Evidence references. */
	evidence: TemporalEvidenceRef[];
	/** IDs of related events. */
	relatedEventIds: string[];
}

/**
 * Section summarizing "what happened" during a rollup period.
 */
export interface WhatHappenedSection {
	/** Chronological items. */
	items: TimelineItem[];
	/** Brief summary of the period. */
	summary: string;
}

/**
 * Section summarizing "what repeated" during a rollup period.
 */
export interface WhatRepeatedSection {
	/** Detected patterns. */
	patterns: RepeatedPattern[];
	/** Brief summary of repeating patterns. */
	summary: string;
}

/**
 * Section summarizing "what changed" during a rollup period.
 */
export interface WhatChangedSection {
	/** Detected changes. */
	changes: ChangeItem[];
	/** Brief summary of changes. */
	summary: string;
}

/**
 * A deterministic temporal rollup covering a specific period.
 *
 * Rollups are generated from source events and can be deterministically
 * regenerated (acceptance criterion 3). The deterministicHash field
 * allows verification that a rollup matches its source events.
 *
 * No private chain-of-thought is stored — only safe summaries and
 * evidence-backed facts (acceptance criterion 4).
 */
export interface TemporalRollup {
	/** Unique identifier (UUID v4). */
	id: string;
	/** Rollup period type. */
	period: RollupPeriod;
	/** ISO 8601 start of the rollup period (inclusive). */
	periodStart: string;
	/** ISO 8601 end of the rollup period (exclusive). */
	periodEnd: string;
	/** Optional entity ID scope. */
	entityId?: string;
	/** ISO 8601 timestamp of when this rollup was generated. */
	generatedAt: string;
	/** What happened during the period. */
	whatHappened: WhatHappenedSection;
	/** What repeated during the period. */
	whatRepeated: WhatRepeatedSection;
	/** What changed during the period. */
	whatChanged: WhatChangedSection;
	/** What got stuck during the period (acceptance criterion 1). */
	whatGotStuck: StuckItem[];
	/** IDs of all source TemporalEvents that contributed to this rollup. */
	sourceEventIds: string[];
	/**
	 * Deterministic hash computed from the serialized content of the rollup.
	 * Allows verification that the rollup can be faithfully regenerated from
	 * source events (acceptance criterion 3).
	 */
	deterministicHash: string;
}

// =========================================================================
// Entity-Scoped Journal
// =========================================================================

/**
 * An entity-scoped temporal journal containing all events and rollups
 * for a specific entity (e.g., a workspace, plan, or goal).
 */
export interface TemporalEntityJournal {
	/** Stable entity ID. */
	entityId: string;
	/** Entity type. */
	entityType: TemporalEntityType;
	/** All events recorded for this entity, in chronological order. */
	events: TemporalEvent[];
	/** All rollups generated for this entity. */
	rollups: TemporalRollup[];
	/** ISO 8601 timestamp of when this journal was last updated. */
	lastUpdated: string;
}

// =========================================================================
// Query Interfaces
// =========================================================================

/** Options for querying temporal events. */
export interface TemporalEventQuery {
	/** Start of time range (ISO 8601, inclusive). */
	since?: string;
	/** End of time range (ISO 8601, exclusive). */
	until?: string;
	/** Filter by entity ID. */
	entityId?: string;
	/** Filter by event type(s). */
	eventTypes?: string[];
	/** Maximum results. */
	limit?: number;
	/** Offset for pagination. */
	offset?: number;
}

/** Options for querying temporal rollups. */
export interface TemporalRollupQuery {
	/** Period type filter. */
	period?: RollupPeriod;
	/** Start of time range (ISO 8601, inclusive). */
	since?: string;
	/** End of time range (ISO 8601, exclusive). */
	until?: string;
	/** Filter by entity ID. */
	entityId?: string;
	/** Maximum results. */
	limit?: number;
	/** Offset for pagination. */
	offset?: number;
}

/** Result of querying "what got stuck" (acceptance criterion 1). */
export interface StuckItemsResult {
	items: StuckItem[];
	total: number;
	period: { since: string; until: string };
}

// =========================================================================
// Store Interface
// =========================================================================

/**
 * Temporal journal store interface.
 *
 * Persists temporal events and rollups, supporting query by time range
 * and entity scope. Implementations must ensure deterministic rollup
 * regeneration from source events.
 */
export interface TemporalJournalStore {
	// ── Events ──

	/** Record a new temporal event. */
	recordEvent(event: TemporalEvent): Promise<void>;

	/** Record multiple temporal events atomically. */
	recordEvents(events: TemporalEvent[]): Promise<void>;

	/** Get a single event by ID. */
	getEvent(id: string): Promise<TemporalEvent | null>;

	/** Query events with optional filters. */
	queryEvents(query: TemporalEventQuery): Promise<TemporalEvent[]>;

	/** Count events matching query filters. */
	countEvents(query: TemporalEventQuery): Promise<number>;

	// ── Rollups ──

	/** Store a generated rollup. */
	storeRollup(rollup: TemporalRollup): Promise<void>;

	/** Get a single rollup by ID. */
	getRollup(id: string): Promise<TemporalRollup | null>;

	/** Query rollups with optional filters. */
	queryRollups(query: TemporalRollupQuery): Promise<TemporalRollup[]>;

	/** Count rollups matching query filters. */
	countRollups(query: TemporalRollupQuery): Promise<number>;

	/** Get the latest rollup for a given period and optional entity. */
	getLatestRollup(period: RollupPeriod, entityId?: string): Promise<TemporalRollup | null>;

	// ── Maintenance ──

	/** Remove all events and rollups. */
	clear(): Promise<void>;

	/** Persist to JSON file. */
	saveToFile(filePath: string): Promise<void>;

	/** Load from JSON file. */
	loadFromFile(filePath: string): Promise<number>;

	/** Get total count of events. */
	eventCount(): Promise<number>;

	/** Get total count of rollups. */
	rollupCount(): Promise<number>;
}

// =========================================================================
// Temporal Engine Interface
// =========================================================================

/** Configuration for the Temporal Engine. */
export interface TemporalEngineConfig {
	/** Whether to auto-generate daily rollups on event recording. */
	autoDailyRollup: boolean;
	/** Whether to auto-generate weekly rollups. */
	autoWeeklyRollup: boolean;
	/** Whether to auto-generate monthly rollups. */
	autoMonthlyRollup: boolean;
	/** Maximum events per rollup before triggering auto-rollup. */
	maxEventsBeforeRollup: number;
}

/** Default temporal engine config. */
export const DEFAULT_TEMPORAL_ENGINE_CONFIG: TemporalEngineConfig = {
	autoDailyRollup: false,
	autoWeeklyRollup: false,
	autoMonthlyRollup: false,
	maxEventsBeforeRollup: 100,
};

// =========================================================================
// Factory helpers
// =========================================================================

/** Create a new TemporalEvent with defaults applied. */
export function createTemporalEvent(overrides: Omit<TemporalEvent, "id"> & { id?: string }): TemporalEvent {
	return {
		id: overrides.id ?? randomUUID(),
		timestamp: overrides.timestamp,
		entityId: overrides.entityId,
		entityType: overrides.entityType,
		eventType: overrides.eventType,
		summary: overrides.summary,
		evidence: overrides.evidence,
		metadata: overrides.metadata ?? {},
	};
}

/** Create a new TemporalRollup shell (without hash). */
export function createTemporalRollup(
	overrides: {
		period: RollupPeriod;
		periodStart: string;
		periodEnd: string;
		entityId?: string;
	} & Partial<Omit<TemporalRollup, "id" | "period" | "periodStart" | "periodEnd" | "entityId">>,
): TemporalRollup {
	return {
		id: randomUUID(),
		period: overrides.period,
		periodStart: overrides.periodStart,
		periodEnd: overrides.periodEnd,
		entityId: overrides.entityId,
		generatedAt: overrides.generatedAt ?? new Date().toISOString(),
		whatHappened: overrides.whatHappened ?? { items: [], summary: "" },
		whatRepeated: overrides.whatRepeated ?? { patterns: [], summary: "" },
		whatChanged: overrides.whatChanged ?? { changes: [], summary: "" },
		whatGotStuck: overrides.whatGotStuck ?? [],
		sourceEventIds: overrides.sourceEventIds ?? [],
		deterministicHash: overrides.deterministicHash ?? "",
	};
}
