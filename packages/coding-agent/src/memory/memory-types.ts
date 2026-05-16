/**
 * Memory Pipeline Types - P11.L
 *
 * Core types for the unified memory pipeline that indexes plans, runs,
 * and proposals with source provenance tracking, forbidden-source blocking,
 * confidence scoring, and compaction.
 *
 * Pipeline sources:
 * - plan: Planner analysis results (batch plans, warnings, suggestions)
 * - run: Workspace execution results (success, failure, blocked)
 * - proposal: Proposal submission results with evidence
 * - manual: User-contributed memory
 */

import type { ExecutionMemoryEntry } from "./execution-memory.js";
import type { PlannerMemoryEntry } from "./planner-memory.js";

// ---------------------------------------------------------------------------
// Memory Source
// ---------------------------------------------------------------------------

/**
 * Identifies where a memory entry originated.
 */
export type MemorySourceKind = "plan" | "run" | "proposal" | "manual";

/**
 * Provenance metadata for a memory entry.
 *
 * Tracks the originating source with enough detail to locate the
 * original artifact and verify its authenticity. Every memory entry
 * carries provenance so that consumers can audit where memories came from.
 */
export interface SourceProvenance {
	/** Kind of source that produced this memory */
	kind: MemorySourceKind;
	/** Unique identifier of the source artifact (workspace ID, plan ID, proposal ID) */
	sourceId: string;
	/** Human-readable description of the source */
	description: string;
	/** Pointer to the specific location within the source (file path, line range, etc.) */
	sourcePointer: Record<string, unknown>;
	/** Timestamp when the source was created/collected */
	timestamp: number;
	/**
	 * Optional confidence in the source's reliability (0-1).
	 * Built-in sources (internal pipeline stages) have high confidence.
	 * External or inferred sources may have lower confidence.
	 * Default: 1.0
	 */
	sourceConfidence?: number;
}

// ---------------------------------------------------------------------------
// Forbidden Sources
// ---------------------------------------------------------------------------

/**
 * A source pattern that should be blocked from retrieval.
 *
 * Forbidden sources represent known-bad, deprecated, or otherwise
 * untrustworthy sources whose memories should not be returned in
 * retrieval results. Blocking is always opt-in and configured
 * explicitly.
 */
export interface ForbiddenSource {
	/** Human-readable label for this forbidden source (for logging/counting) */
	label: string;
	/** The source kind to block (or '*' for all kinds) */
	kind: MemorySourceKind | "*";
	/** Pattern to match against sourceId (glob-like, supports '*' and '?') */
	sourceIdPattern: string;
	/** Optional pattern to match against description */
	descriptionPattern?: string;
	/** Reason this source is forbidden (for audit trail) */
	reason: string;
}

// ---------------------------------------------------------------------------
// Memory Entry (Unified)
// ---------------------------------------------------------------------------

/**
 * Severity/importance level of a memory entry.
 */
export type MemorySeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * Lifecycle status of a memory entry.
 */
export type MemoryStatus = "active" | "superseded" | "archived";

/**
 * A unified memory entry in the pipeline.
 *
 * Combines provenance tracking, confidence scoring, and lifecycle
 * management. Each entry wraps either an ExecutionMemoryEntry,
 * PlannerMemoryEntry, or custom data with standardized metadata.
 */
export interface MemoryPipelineEntry {
	/** Unique entry ID */
	id: string;
	/** The source provenance of this memory */
	provenance: SourceProvenance;
	/** When this entry was created (epoch ms) */
	createdAt: number;
	/** When this entry was last updated (epoch ms) */
	updatedAt: number;
	/** Content hash for deduplication */
	contentHash: string;
	// -------------------------------------------------------------------
	// Content
	// -------------------------------------------------------------------
	/** Short title/summary of the memory */
	title: string;
	/** Full content / body of the memory */
	content: string;
	/** Acceptance criteria keywords for retrieval matching */
	keywords: string[];
	/** Severity / importance level */
	severity: MemorySeverity;
	// -------------------------------------------------------------------
	// Status
	// -------------------------------------------------------------------
	/** Lifecycle status */
	status: MemoryStatus;
	/** If superseded, the ID(s) of the entry/entries that superseded this one */
	supersededByIds: string[];
	/** If this entry supersedes another, the ID(s) of the superseded entry/entries */
	supersedesIds: string[];
	// -------------------------------------------------------------------
	// Optional links to original entry types
	// -------------------------------------------------------------------
	/** The original execution memory entry, if this wraps one */
	executionEntry?: ExecutionMemoryEntry;
	/** The original planner memory entry, if this wraps one */
	plannerEntry?: PlannerMemoryEntry;
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Result of a retrieval query, with confidence and source pointer.
 */
export interface MemoryRetrievalResult {
	/** The matching memory entry */
	entry: MemoryPipelineEntry;
	/** Confidence score (0-1) indicating how relevant this entry is to the query */
	confidence: number;
	/** The provenance of the matched entry (convenience accessor) */
	provenance: SourceProvenance;
	/** The source pointer of the matched entry (convenience accessor) */
	sourcePointer: Record<string, unknown>;
	/** Factors that contributed to the confidence score */
	confidenceFactors: ConfidenceFactor[];
}

/**
 * A single factor contributing to a confidence score.
 */
export interface ConfidenceFactor {
	/** Factor name (e.g., "keyword_match", "phase_match", "recency") */
	factor: string;
	/** Contribution weight (0-1) */
	weight: number;
	/** Human-readable explanation */
	explanation: string;
}

/**
 * Summary of blocked sources for a retrieval query.
 */
export interface BlockedSourceSummary {
	/** Number of sources blocked */
	count: number;
	/** Details about each blocked source */
	blocked: Array<{
		label: string;
		sourceId: string;
		reason: string;
	}>;
}

/**
 * Full result of a memory retrieval operation.
 */
export interface MemoryRetrievalResponse {
	/** The matched entries, sorted by confidence (highest first) */
	results: MemoryRetrievalResult[];
	/** Summary of any sources that were blocked */
	blocked: BlockedSourceSummary;
	/** Total number of potential matches before blocking/filtering */
	totalCandidates: number;
	/** Time taken for the retrieval (ms) */
	retrievalTimeMs: number;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/**
 * Input for ingesting a memory into the pipeline.
 */
export interface MemoryIngestionInput {
	/** Source provenance */
	provenance: SourceProvenance;
	/** Title */
	title: string;
	/** Content body */
	content: string;
	/** Keywords for retrieval */
	keywords?: string[];
	/** Severity (default: "medium") */
	severity?: MemorySeverity;
	/** Optional execution memory entry to wrap */
	executionEntry?: ExecutionMemoryEntry;
	/** Optional planner memory entry to wrap */
	plannerEntry?: PlannerMemoryEntry;
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/**
 * Result of a compaction operation.
 */
export interface CompactionReport {
	/** Entries that were compacted (archived or marked superseded) */
	compacted: Array<{
		entryId: string;
		title: string;
		reason: string;
	}>;
	/** Entries that were preserved (still active) */
	preserved: Array<{
		entryId: string;
		title: string;
		provenance: SourceProvenance;
	}>;
	/** Statistics */
	stats: {
		/** Total entries before compaction */
		totalBefore: number;
		/** Total entries after compaction */
		totalAfter: number;
		/** Number of entries marked as superseded */
		superseded: number;
		/** Number of entries archived */
		archived: number;
		/** Number of entries kept as active */
		activeKept: number;
	};
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the memory pipeline.
 */
export interface MemoryPipelineConfig {
	/**
	 * Whether the pipeline is enabled.
	 * When false, ingestion and retrieval are no-ops.
	 * Default: true
	 */
	enabled: boolean;
	/**
	 * List of forbidden sources to block during retrieval.
	 */
	forbiddenSources: ForbiddenSource[];
	/**
	 * Maximum number of retrieval results to return.
	 * Default: 10
	 */
	maxResults: number;
	/**
	 * Minimum confidence score (0-1) for a result to be included.
	 * Default: 0.1
	 */
	minConfidence: number;
	/**
	 * Maximum number of entries in the pipeline before automatic compaction.
	 * Default: 500
	 */
	maxEntriesBeforeCompaction: number;
	/**
	 * Maximum age of entries in milliseconds before they become compaction candidates.
	 * Default: 30 days (2592000000 ms)
	 */
	maxEntryAgeMs: number;
	/**
	 * Whether to use the existing execution memory system as a backend.
	 * Default: false
	 */
	useExecutionMemoryBackend: boolean;
	/**
	 * Whether to use the existing planner memory system as a backend.
	 * Default: false
	 */
	usePlannerMemoryBackend: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MEMORY_PIPELINE_CONFIG: MemoryPipelineConfig = {
	enabled: true,
	forbiddenSources: [],
	maxResults: 10,
	minConfidence: 0.1,
	maxEntriesBeforeCompaction: 500,
	maxEntryAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
	useExecutionMemoryBackend: false,
	usePlannerMemoryBackend: false,
};
