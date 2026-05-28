/**
 * Brain V5 TypeScript interfaces for the V2 second-brain dashboard.
 *
 * Mirrors the backend API responses from Brain V5 routes,
 * including Temporal Journal v2 (V5.01) types.
 *
 * @packageDocumentation
 */

// =========================================================================
// V5 Mode
// =========================================================================

/**
 * V5 operating modes, ordered from least to most capable.
 *
 * OFF             - V5 is disabled. No V5 code paths execute.
 * READ_ONLY       - V5 can observe but cannot emit any events.
 * ADVISORY        - V5 can emit observation/signal events but cannot push.
 * DRAFTING        - V5 can emit approved change proposals for execution.
 * OPERATOR_READY  - V5 can autonomously run overnight operator sessions.
 */
export type BrainV5Mode = "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";

// =========================================================================
// V5 Status
// =========================================================================

/** Response from GET /brain-v5/status */
export interface BrainV5StatusResponse {
	/** Current V5 operating mode. */
	mode: BrainV5Mode;
	/** Raw capability flags. */
	flags: BrainV5Flags;
	/** Raw settings from settings manager. */
	settings: Record<string, unknown>;
	/** Whether V5 is available (not OFF). */
	v5Available: boolean;
	/** Whether V5 can emit events (not OFF or READ_ONLY). */
	canEmit: boolean;
	/** Whether V5 can push changes (DRAFTING or OPERATOR_READY). */
	canPush: boolean;
	/** Whether V5 can run overnight operator (OPERATOR_READY only). */
	canRunOvernight: boolean;
}

/** V5 capability flags displayed in the dashboard. */
export interface BrainV5Flags {
	/** Master switch: enable all V5 brain code paths. */
	enabled: boolean;
	/** Read-only mode: V5 cannot emit any mutation-bound events. */
	readOnlyMode: boolean;
	/** Push enabled: V5 can push approved changes to the execution kernel. */
	pushEnabled: boolean;
	/** Overnight operator: V5 can run autonomous overnight operator sessions. */
	overnightOperatorEnabled: boolean;
}

// =========================================================================
// V5 Plan Doctor Report
// =========================================================================

/** Response from GET /brain-v5/doctor */
export interface BrainV5DoctorReport {
	/** The current V5 mode. */
	mode: BrainV5Mode;
	/** Whether V5 can directly suggest plan mutations. */
	canSuggest: boolean;
	/** Whether operator gates have passed for this workspace. */
	operatorGatesPassed: boolean;
	/** Human-readable summary of the V5 advisory status. */
	summary: string;
	/** Detailed messages about gate status and constraints. */
	details: string[];
}

// =========================================================================
// V5 Operator Gate Status
// =========================================================================

/** Response from GET /brain-v5/gates */
export interface BrainV5GateStatus {
	/** Whether the user has explicitly enabled push for V5. */
	pushEnabled: boolean;
	/** Whether the user has explicitly enabled overnight operator. */
	overnightOperatorEnabled: boolean;
	/** Whether the safety profile allows V5 mutations. */
	safetyProfileAllows: boolean;
	/** Whether the current plan execution context permits V5 actions. */
	executionContextAllows: boolean;
	/** Overall gate result: all gates must pass to reach DRAFTING+. */
	allGatesPassed: boolean;
}

// =========================================================================
// V5 API Error
// =========================================================================

export interface BrainV5ApiError {
	error: string;
	message?: string;
	mode: "OFF";
	v5Available: false;
	canEmit: false;
	canPush: false;
	canRunOvernight: false;
}

// =========================================================================
// Temporal Journal v2 (V5.01)
// =========================================================================

/** Rollup period granularity. */
export type TemporalRollupPeriod = "daily" | "weekly" | "monthly";

/** Entity types tracked in temporal journals. */
export type TemporalEntityType = "workspace" | "plan" | "goal" | "memory" | "proposal" | "system";

/** Evidence reference for a temporal event. */
export interface TemporalEvidenceRef {
	type: "file" | "journal" | "timeline_event" | "memory" | "observation" | "signal" | "log";
	ref: string;
	description: string;
}

/** A temporal event recorded by the brain. */
export interface TemporalEvent {
	id: string;
	timestamp: string;
	entityId?: string;
	entityType?: TemporalEntityType;
	eventType: string;
	summary: string;
	evidence: TemporalEvidenceRef[];
	metadata: Record<string, unknown>;
}

/** A single item in a "what happened" timeline. */
export interface TimelineItem {
	eventId: string;
	timestamp: string;
	eventType: string;
	entityId?: string;
	summary: string;
	evidence: TemporalEvidenceRef[];
}

/** A repeated pattern detected across multiple events. */
export interface RepeatedPattern {
	pattern: string;
	count: number;
	eventType: string;
	entityId?: string;
	firstOccurrence: string;
	lastOccurrence: string;
	evidence: TemporalEvidenceRef[];
}

/** A detected change across a period. */
export interface ChangeItem {
	description: string;
	fromState?: string;
	toState?: string;
	entityId?: string;
	eventIds: string[];
	evidence: TemporalEvidenceRef[];
}

/** An item representing something that got stuck. */
export interface StuckItem {
	entityId?: string;
	entityType?: TemporalEntityType;
	description: string;
	stuckSince: string;
	lastObserved: string;
	attemptsCount: number;
	evidence: TemporalEvidenceRef[];
	relatedEventIds: string[];
}

/** What happened section of a rollup. */
export interface WhatHappenedSection {
	items: TimelineItem[];
	summary: string;
}

/** What repeated section of a rollup. */
export interface WhatRepeatedSection {
	patterns: RepeatedPattern[];
	summary: string;
}

/** What changed section of a rollup. */
export interface WhatChangedSection {
	changes: ChangeItem[];
	summary: string;
}

/** A deterministic temporal rollup. */
export interface TemporalRollup {
	id: string;
	period: TemporalRollupPeriod;
	periodStart: string;
	periodEnd: string;
	entityId?: string;
	generatedAt: string;
	whatHappened: WhatHappenedSection;
	whatRepeated: WhatRepeatedSection;
	whatChanged: WhatChangedSection;
	whatGotStuck: StuckItem[];
	sourceEventIds: string[];
	deterministicHash: string;
}

/** Request body for POST /brain-v5/temporal/events */
export interface RecordTemporalEventRequest {
	timestamp?: string;
	entityId?: string;
	entityType?: TemporalEntityType;
	eventType: string;
	summary: string;
	evidence?: TemporalEvidenceRef[];
	metadata?: Record<string, unknown>;
}

/** Response from GET /brain-v5/temporal/events */
export interface TemporalEventsResponse {
	events: TemporalEvent[];
	total: number;
}

/** Response from GET /brain-v5/temporal/rollups */
export interface TemporalRollupsResponse {
	rollups: TemporalRollup[];
}

/** Request body for POST /brain-v5/temporal/rollups/generate */
export interface GenerateRollupRequest {
	period: TemporalRollupPeriod;
	periodStart: string;
	periodEnd: string;
	entityId?: string;
}

/** Response from POST /brain-v5/temporal/rollups/generate */
export interface GenerateRollupResponse {
	rollup: TemporalRollup;
}

/** Response from GET /brain-v5/temporal/stuck */
export interface StuckItemsResponse {
	items: StuckItem[];
	total: number;
	period: { since: string; until: string };
}

/** Response from POST /brain-v5/temporal/rollups/:id/regenerate */
export interface RegenerateRollupResponse {
	rollup: TemporalRollup;
	matchesOriginal: boolean;
	verificationPassed: boolean;
}
