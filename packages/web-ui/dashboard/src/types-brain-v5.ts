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

// =========================================================================
// Evidence Index (V5.02)
// =========================================================================

/** Types of evidence that the index can reference. */
export type EvidenceRefType =
	| "git_file"
	| "validation"
	| "execution_journal"
	| "memory"
	| "proposal"
	| "reflection"
	| "approval"
	| "observation"
	| "signal"
	| "temporal_event";

/** A single evidence reference. */
export interface EvidenceRef {
	type: EvidenceRefType;
	id: string;
	label: string;
	description: string;
	timestamp: string;
	sourcePath?: string;
	confidence: number;
	metadata?: Record<string, unknown>;
}

/** Input for registering evidence. */
export interface RegisterEvidenceRequest {
	type: string;
	id?: string;
	label: string;
	description: string;
	confidence?: number;
	content?: string;
}

/** Response from POST /brain-v5/evidence/register */
export interface RegisterEvidenceResponse {
	success: boolean;
	ref: EvidenceRef;
}

/** Response from POST /brain-v5/evidence/register-batch */
export interface RegisterEvidenceBatchResponse {
	success: boolean;
	count: number;
	refs: EvidenceRef[];
}

/** Query parameters for GET /brain-v5/evidence/query */
export interface EvidenceQueryParams {
	types?: string;
	search?: string;
	minConfidence?: string;
	createdAfter?: string;
	createdBefore?: string;
	limit?: string;
	offset?: string;
	sortBy?: string;
	sortOrder?: string;
}

/** Response from GET /brain-v5/evidence/query */
export interface EvidenceQueryResponse {
	items: EvidenceRef[];
	total: number;
}

/** Evidence resolution outcome. */
export interface EvidenceResolution {
	ref: EvidenceRef;
	resolved: boolean;
	content?: string;
	error?: string;
	resolvedAt: string;
}

/** Evidence confidence level. */
export type EvidenceConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "BLOCKED";

/** Evidence assessment result. */
export interface EvidenceAssessment {
	level: EvidenceConfidenceLevel;
	confidence: number;
	resolvedCount: number;
	missingCount: number;
	lowConfidenceCount: number;
	resolutions: EvidenceResolution[];
	summary: string;
	recommendations: string[];
}

/** Request body for POST /brain-v5/evidence/resolve */
export interface ResolveEvidenceRequest {
	refs: Array<{ type: string; id: string }>;
}

/** Response from POST /brain-v5/evidence/resolve */
export interface ResolveEvidenceResponse {
	resolutions: EvidenceResolution[];
}

/** Request body for POST /brain-v5/evidence/assess */
export interface AssessEvidenceRequest {
	refs: Array<{ type: string; id: string }>;
}

/** Response from POST /brain-v5/evidence/assess */
export interface AssessEvidenceResponse {
	assessment: EvidenceAssessment;
}

/** Evidence index statistics. */
export interface EvidenceStats {
	totalRefs: number;
	byType: Record<string, number>;
	averageConfidence: number;
	highConfidenceCount: number;
	lowConfidenceCount: number;
	earliestTimestamp: string | null;
	latestTimestamp: string | null;
}

/** Response from GET /brain-v5/evidence/stats */
export interface EvidenceStatsResponse {
	stats: EvidenceStats;
}

// =========================================================================
// Proposal Engine v2 (V5.08)
// =========================================================================

/**
 * V5.08 Proposal card view — what the dashboard shows.
 *
 * AC1: Proposal cards explain:
 * - problem (title + description)
 * - why now (whyNow explanation)
 * - evidence count
 * - related memories
 * - risk
 * - expected impact
 * - draft availability
 * - approval requirement
 */

/** V5.08 Proposal types */
export type V5ProposalType =
	| "memory_proposal"
	| "plan_proposal"
	| "goal_revision_proposal"
	| "autonomy_adjustment_proposal"
	| "reflection_proposal"
	| "safety_proposal";

/** V5.08 Proposal lifecycle status */
export type V5ProposalStatus =
	| "draft"
	| "pending_approval"
	| "approved"
	| "rejected"
	| "superseded"
	| "expired"
	| "execution_ready"
	| "executed";

/** V5.08 Risk level */
export type V5RiskLevel = "low" | "medium" | "high" | "critical";

/** V5.08 Evidence backing for a proposal card */
export interface V5ProposalCardEvidence {
	/** Number of memory references */
	memoryCount: number;
	/** Number of observation references */
	observationCount: number;
	/** Total evidence reference count */
	evidenceCount: number;
	/** Overall confidence (0-1) */
	confidence: number;
	/** Human-readable summary */
	evidenceSummary: string;
	/** IDs of referenced memory records */
	relatedMemoryIds: string[];
}

/** V5.08 Risk assessment for a proposal card */
export interface V5ProposalCardRisk {
	/** Risk level */
	level: V5RiskLevel;
	/** Contributing factors */
	factors: string[];
	/** Mitigation strategies */
	mitigation: string[];
	/** Description of potential impact */
	impactDescription: string;
}

/** V5.08 Proposal card — the primary user-facing unit */
export interface V5ProposalCard {
	/** Unique proposal ID */
	id: string;
	/** Proposal type */
	type: V5ProposalType;
	/** Problem: short title */
	title: string;
	/** Problem: detailed description */
	description: string;
	/** AC1: Why act now? */
	whyNow: string;
	/** AC1: Expected impact if enacted */
	expectedImpact: string;
	/** AC1: Evidence backing */
	evidence: V5ProposalCardEvidence;
	/** AC1: Risk assessment */
	risk: V5ProposalCardRisk;
	/** Current status */
	status: V5ProposalStatus;
	/** AC1: Whether a draft/plan is already available */
	draftAvailable: boolean;
	/** AC1: Whether user approval is required before execution */
	approvalRequired: boolean;
	/** AC3: Whether this is a duplicate proposal */
	isDuplicate: boolean;
	/** AC3: ID of the proposal this duplicates (if any) */
	duplicateOf: string | null;
	/** Score (for ranking, 0-1) */
	score: number;
	/** ISO 8601 creation timestamp */
	createdAt: string;
	/** ISO 8601 last update timestamp */
	updatedAt: string;
	/** Related goal IDs */
	relatedGoalIds: string[];
	/** Tags */
	tags: string[];
}

/** V5.08 Inbox entry for a proposal card */
export interface V5InboxEntry {
	/** The proposal card */
	proposal: V5ProposalCard;
	/** Rank position */
	rank: number;
	/** Why this proposal is in the inbox */
	reason: string;
	/** Recommendation hint */
	recommendation: "auto_approve" | "review" | "reject";
	/** Related memory summaries */
	relatedMemorySummaries: string[];
	/** Related observation summaries */
	relatedObservationSummaries: string[];
}

/** V5.08 Inbox view */
export interface V5InboxView {
	entries: V5InboxEntry[];
	totalPending: number;
	lastUpdated: string;
}

/** Response from GET /brain-v5/proposals */
export interface V5ProposalsResponse {
	proposals: V5ProposalCard[];
}

/** Response from GET /brain-v5/proposals/:id */
export interface V5ProposalResponse {
	proposal: V5ProposalCard;
}

/** Response from POST /brain-v5/proposals */
export interface V5CreateProposalResponse {
	success: boolean;
	proposal?: V5ProposalCard;
	error?: string;
	isDuplicate?: boolean;
	duplicateReason?: string;
	isInCooldown?: boolean;
	cooldownRemainingHours?: number;
}

/** Response from POST /brain-v5/proposals/:id/accept */
export interface V5AcceptProposalResponse {
	success: boolean;
	proposal?: V5ProposalCard;
	message: string;
}

/** Response from POST /brain-v5/proposals/:id/reject */
export interface V5RejectProposalResponse {
	success: boolean;
	proposal?: V5ProposalCard;
	message: string;
}

/** Response from POST /brain-v5/proposals/:id/execution-ready */
export interface V5ExecutionReadyResponse {
	success: boolean;
	proposal?: V5ProposalCard;
	message: string;
}

/** Response from GET /brain-v5/proposals/inbox */
export interface V5InboxResponse {
	inbox: V5InboxView;
}

/** Response from GET /brain-v5/proposals/evidence/:id */
export interface V5EvidenceDetail {
	proposalId: string;
	proposalTitle: string;
	evidence: {
		memoryIds: string[];
		observationIds: string[];
		sourceRefs: Array<{
			type: string;
			path: string;
			id: string;
			lineStart?: number;
			lineEnd?: number;
			timestamp?: string;
		}>;
		confidence: number;
		evidenceSummary: string;
		evidenceCount: number;
	};
	risk: {
		level: string;
		factors: string[];
		mitigation: string[];
		affectedSystems: string[];
		impactDescription: string;
	};
	whyNow: string;
	expectedImpact: string;
	isDuplicate: boolean;
	duplicateOf: string | null;
	draftAvailable: boolean;
	reviewsApprovalRequired: boolean;
	relatedMemoryIds: string[];
}

/** Response from GET /brain-v5/proposals/stats */
export interface V5ProposalStats {
	totalProposals: number;
	byStatus: Record<string, number>;
	byType: Record<string, number>;
	averageScore: number;
	acceptanceRate: number;
	pendingApprovalCount: number;
	expiredCount: number;
}

/** Response from GET /brain-v5/proposals/stats */
export interface V5ProposalStatsResponse {
	stats: V5ProposalStats;
}
