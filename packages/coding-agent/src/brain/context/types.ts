/**
 * Context Builder Types — V5.04
 *
 * Defines the core data structures for the context builder, context packs,
 * memory injection reports, and compliance checking.
 *
 * A context pack is the assembled knowledge base used by query, proposal,
 * draft, and plan generation. It includes memory retrieval results, evidence
 * assessments, and temporal context.
 *
 * Following V4 ExecutionKernel doctrine: the context builder reads from
 * existing stores and indices but never mutates execution state directly.
 * All outputs are emitted as events via the V5EventSink.
 *
 * @packageDocumentation
 */

import type { EvidencePackSummary } from "../evidence/pack.js";
import type { EvidenceConfidenceLevel, EvidenceRef } from "../evidence/types.js";
import type { MemoryRetrievalReport } from "../memory/retrieval.js";

// =========================================================================
// Context Source Types
// =========================================================================

/**
 * The type of context source that contributed to a context pack.
 *
 * Each source type corresponds to a brain module that produces context.
 */
export type ContextSourceType =
	| "memory_retrieval"
	| "evidence_index"
	| "temporal_journal"
	| "policy_rules"
	| "reflection"
	| "proposal"
	| "signal"
	| "observation"
	| "user_input";

/** All valid ContextSourceType values. */
export const ALL_CONTEXT_SOURCE_TYPES: ContextSourceType[] = [
	"memory_retrieval",
	"evidence_index",
	"temporal_journal",
	"policy_rules",
	"reflection",
	"proposal",
	"signal",
	"observation",
	"user_input",
];

// =========================================================================
// Context Source
// =========================================================================

/**
 * A single context source that contributed to the context pack.
 *
 * Each source tracks what was included, how many items, and its
 * confidence assessment so downstream generators can weigh sources
 * appropriately.
 */
export interface ContextSource {
	/** The type of source. */
	type: ContextSourceType;
	/** Human-readable label for this source (e.g., "Failure Memory Retrieval"). */
	label: string;
	/** Brief description of what this source contributed. */
	description: string;
	/** Number of items retrieved from this source. */
	itemCount: number;
	/** Confidence level for this source's contributions. */
	confidenceLevel: EvidenceConfidenceLevel;
	/** Numerical confidence score (0-1) for this source. */
	confidence: number;
	/** ISO 8601 timestamp of when this source was queried. */
	retrievedAt: string;
	/** Arbitrary metadata about this source. */
	metadata?: Record<string, unknown>;
}

// =========================================================================
// Context Pack
// =========================================================================

/**
 * A complete context pack assembled by the ContextBuilder.
 *
 * The context pack is the primary input for query answering, proposal
 * generation, draft creation, and plan generation. It contains:
 *
 * - Memory retrieval reports (from MemoryRetrievalV2)
 * - Evidence pack summary (from EvidenceApi)
 * - Temporal context (what happened, what's stuck, patterns)
 * - Source tracking (what sources contributed and their confidence)
 *
 * Every generator that consumes a context pack must include the
 * evidence refs in its output to satisfy the rule that no generated
 * content can claim memory support without included evidence refs.
 */
export interface ContextPack {
	/** Unique pack identifier (UUID). */
	id: string;
	/** Human-readable title for this context pack. */
	title: string;
	/** The scope this context pack was built for (workspace ID, plan exec ID, etc.). */
	scope: string;
	/** ISO 8601 timestamp of when this pack was assembled. */
	createdAt: string;
	/** The sources that contributed to this pack. */
	sources: ContextSource[];
	/** Memory retrieval reports (if any). */
	memoryRetrievalReports: MemoryRetrievalReport[];
	/** Evidence pack summary (compact, renderable form). */
	evidencePackSummary: EvidencePackSummary;
	/** Temporal context — what's happening and what patterns exist. */
	temporalContext?: TemporalContext;
	/** Overall confidence level across all sources. */
	overallConfidenceLevel: EvidenceConfidenceLevel;
	/** Overall numerical confidence score (0-1). */
	overallConfidence: number;
	/** Human-readable summary of this context pack. */
	summary: string;
	/** Aggregated evidence references from all sources. */
	evidenceRefs: EvidenceRef[];
}

// =========================================================================
// Temporal Context (from Temporal Journal v2)
// =========================================================================

/**
 * Temporal context section within a context pack.
 *
 * Provides information about what happened, what got stuck, and
 * what patterns have been detected over time.
 */
export interface TemporalContext {
	/** ISO 8601 timestamp range start. */
	since: string;
	/** ISO 8601 timestamp range end. */
	until: string;
	/** Summary of what happened (from temporal rollups). */
	whatHappened: string;
	/** Items that are stuck or blocked. */
	stuckItems: StuckItemSummary[];
	/** Repeated patterns or anomalies. */
	patterns: RepeatedPatternSummary[];
	/** Number of temporal events in the period. */
	eventCount: number;
}

/**
 * Summary of a stuck item for inclusion in context packs.
 */
export interface StuckItemSummary {
	/** Entity ID that is stuck. */
	entityId?: string;
	/** Entity type. */
	entityType?: string;
	/** Description of what is stuck. */
	description: string;
	/** How long it has been stuck. */
	duration: string;
}

/**
 * Summary of a repeated pattern for inclusion in context packs.
 */
export interface RepeatedPatternSummary {
	/** Pattern description. */
	description: string;
	/** Number of occurrences detected. */
	occurrenceCount: number;
	/** Confidence in this pattern detection. */
	confidence: number;
}

// =========================================================================
// Memory Injection Types
// =========================================================================

/**
 * Result of compliance checking before memory injection.
 *
 * The compliance check validates that a memory injection does not
 * bypass policy, conflict, or lifecycle rules. Each check produces
 * a result that can either pass or fail with a reason.
 */
export interface InjectionComplianceResult {
	/** Whether all compliance checks passed. */
	passed: boolean;
	/** Individual check results. */
	checks: InjectionComplianceCheck[];
	/** If failed, the reason for block. */
	blockedReason?: string;
}

/**
 * A single compliance check result.
 */
export interface InjectionComplianceCheck {
	/** The rule that was checked. */
	rule: string;
	/** Whether this check passed. */
	passed: boolean;
	/** Human-readable detail about the check. */
	detail: string;
	/** Severity: "error" blocks the injection, "warning" is informational. */
	severity: "error" | "warning";
}

// =========================================================================
// Memory Injection Record
// =========================================================================

/**
 * A record of a single memory injection attempt.
 *
 * Used in the injection report to track which memories were injected,
 * which were ignored, and why.
 */
export interface MemoryInjectionRecord {
	/** Unique injection record ID (UUID). */
	id: string;
	/** The type of memory being injected. */
	memoryType: string;
	/** Title of the memory being injected. */
	title: string;
	/** Content of the memory being injected. */
	content: string;
	/** Whether this injection was accepted. */
	accepted: boolean;
	/** If rejected, the reason for rejection. */
	rejectionReason?: string;
	/** The memory ID if injected successfully. */
	memoryId?: string;
	/** Evidence references supporting this injection. */
	evidenceRefs: EvidenceRef[];
	/** Confidence level for this injection. */
	confidenceLevel: EvidenceConfidenceLevel;
	/** Numerical confidence score (0-1). */
	confidence: number;
	/** ISO 8601 timestamp of when this injection was attempted. */
	timestamp: string;
}

// =========================================================================
// Memory Injection Report
// =========================================================================

/**
 * A full memory injection report.
 *
 * This report is includeable in plan drafts and renderable in
 * dashboard Draft Studio and Memory UI. It contains:
 *
 * - memoryRetrievalReport: The retrieval context used for injection
 * - injectedMemoryIds: IDs of successfully injected memories
 * - ignoredMemoryIds: IDs of memories that were rejected, with reasons
 * - evidencePackSummary: Compact evidence pack summary
 */
export interface MemoryInjectionReport {
	/** Unique report ID (UUID). */
	id: string;
	/** ISO 8601 timestamp of when the report was generated. */
	createdAt: string;
	/** The scope this injection was performed for (workspace, plan exec, etc.). */
	scope: string;
	/** Memory retrieval report that informed the injection. */
	memoryRetrievalReport: MemoryRetrievalReport | null;
	/** IDs of successfully injected memory records. */
	injectedMemoryIds: string[];
	/** IDs of memories that were ignored/rejected, with reasons. */
	ignoredMemoryIds: IgnoredMemoryEntry[];
	/** Summary of the evidence pack backing this injection. */
	evidencePackSummary: EvidencePackSummary;
	/** Individual injection records (detailed). */
	injections: MemoryInjectionRecord[];
	/** Compliance check results. */
	compliance: InjectionComplianceResult;
	/** Overall confidence level. */
	overallConfidenceLevel: EvidenceConfidenceLevel;
	/** Overall numerical confidence score (0-1). */
	overallConfidence: number;
	/** Human-readable summary. */
	summary: string;
	/** Number of successful injections. */
	successfulCount: number;
	/** Number of ignored/rejected injections. */
	ignoredCount: number;
}

/**
 * Entry in the ignored memory IDs list with reason.
 */
export interface IgnoredMemoryEntry {
	/** The title or identifier of the memory that was ignored. */
	memoryTitle: string;
	/** The proposed memory type. */
	memoryType: string;
	/** Reason code for why it was ignored. */
	reasonCode: IgnoredReasonCode;
	/** Human-readable explanation. */
	reason: string;
	/** The compliance check that failed (if applicable). */
	failedCheck?: string;
}

/**
 * Reason codes for why a memory injection was ignored.
 */
export type IgnoredReasonCode =
	| "policy_rule_blocked"
	| "conflict_detected"
	| "lifecycle_state_invalid"
	| "evidence_insufficient"
	| "confidence_too_low"
	| "duplicate_content"
	| "user_preference_violation"
	| "scope_mismatch";

/** All valid IgnoredReasonCode values. */
export const ALL_IGNORED_REASON_CODES: IgnoredReasonCode[] = [
	"policy_rule_blocked",
	"conflict_detected",
	"lifecycle_state_invalid",
	"evidence_insufficient",
	"confidence_too_low",
	"duplicate_content",
	"user_preference_violation",
	"scope_mismatch",
];

// =========================================================================
// Context Build Options
// =========================================================================

/**
 * Options for building a context pack.
 */
export interface ContextBuildOptions {
	/** Scope identifier (workspace ID, plan exec ID, etc.). */
	scope: string;
	/** How many memory records to retrieve per type (default: 10). */
	memoryLimit?: number;
	/** Whether to include temporal context (default: true). */
	includeTemporalContext?: boolean;
	/** Start of temporal window (ISO 8601). */
	temporalSince?: string;
	/** End of temporal window (ISO 8601). */
	temporalUntil?: string;
	/** Whether to skip evidence pack building (default: false). */
	skipEvidencePack?: boolean;
	/** Arbitrary metadata to attach to the context pack. */
	metadata?: Record<string, unknown>;
}

// =========================================================================
// Memory Injection Options
// =========================================================================

/**
 * Options for performing memory injections.
 */
export interface MemoryInjectionOptions {
	/** Scope identifier (workspace ID, plan exec ID, etc.). */
	scope: string;
	/** The memories to inject. */
	injections: MemoryInjectionInput[];
	/** Whether to skip compliance checks (default: false, NOT recommended). */
	skipCompliance?: boolean;
	/** Minimum confidence threshold for accepting injections (default: 0.5). */
	minConfidence?: number;
}

/**
 * Input for a single memory injection.
 */
export interface MemoryInjectionInput {
	/** The type of memory to create. */
	memoryType: string;
	/** Title of the memory. */
	title: string;
	/** Content of the memory. */
	content: string;
	/** Optional summary. */
	summary?: string;
	/** Evidence references supporting this memory. */
	evidenceRefs: EvidenceRef[];
	/** Confidence score (0-1). */
	confidence: number;
	/** Optional tags. */
	tags?: string[];
	/** Optional category. */
	category?: string;
	/** Optional metadata. */
	metadata?: Record<string, unknown>;
}

// =========================================================================
// Injection Compliance Rules
// =========================================================================

/**
 * Policy rules for injection compliance checking.
 *
 * These rules define what checks are performed before a memory
 * injection is accepted. Rules can be configured per-scope or
 * globally.
 */
export interface InjectionPolicyRules {
	/** Maximum number of evidence refs below which injection is blocked (default: 0). */
	minEvidenceRefs: number;
	/** Minimum confidence for accepting an injection (default: 0.5). */
	minConfidence: number;
	/** Types of memory that are allowed to be injected (empty = all allowed). */
	allowedMemoryTypes: string[];
	/** Types of memory that are explicitly blocked from injection. */
	blockedMemoryTypes: string[];
	/** Whether to run conflict detection before injection (default: true). */
	checkConflicts: boolean;
	/** Whether to check lifecycle validity (default: true). */
	checkLifecycle: boolean;
	/** Whether to check for duplicate content (default: true). */
	checkDuplicates: boolean;
}

/** Default injection policy rules. */
export const DEFAULT_INJECTION_POLICY_RULES: InjectionPolicyRules = {
	minEvidenceRefs: 0,
	minConfidence: 0.5,
	allowedMemoryTypes: [],
	blockedMemoryTypes: [],
	checkConflicts: true,
	checkLifecycle: true,
	checkDuplicates: true,
};

// =========================================================================
// Event Types (for V5EventSink)
// =========================================================================

/**
 * Event emitted when a context pack is built (payload for timeline events).
 */
export interface ContextPackBuiltPayload extends Record<string, unknown> {
	kind: "context_pack_built";
	pack: ContextPack;
}

/**
 * Event emitted when a memory injection is performed (payload for timeline events).
 */
export interface MemoryInjectionPayload extends Record<string, unknown> {
	kind: "memory_injection_performed";
	report: MemoryInjectionReport;
}

/**
 * Event emitted when an injection compliance check blocks an injection.
 */
export interface InjectionBlockedPayload extends Record<string, unknown> {
	kind: "injection_blocked";
	report: MemoryInjectionReport;
	blockedReason: string;
}
