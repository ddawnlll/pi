/**
 * Organic Memory Schema - P11.F
 *
 * Defines the core data structures for the organic vector memory store.
 *
 * The schema supports:
 * - Embedding metadata (vector, model provenance)
 * - Content hash (SHA-256 for deduplication)
 * - Source pointer (project, plan, workspace, capability, file path)
 * - Freshness (timestamps, access tracking, computed freshness score)
 * - Safety classification (safe / caution / unsafe / forbidden)
 * - Multi-dimensional querying (by source, semantic relevance)
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Safety classification
// ---------------------------------------------------------------------------

/**
 * Safety classification levels for memory entries.
 *
 * - safe: Content is benign and can be freely retrieved.
 * - caution: Content may contain sensitive information; use with care.
 * - unsafe: Content is potentially harmful; restricted access.
 * - forbidden: Content matched a forbidden pattern; never ingested.
 */
export type SafetyLevel = "safe" | "caution" | "unsafe" | "forbidden";

/**
 * Safety classification attached to each memory entry.
 */
export interface SafetyClassification {
	/** Safety level */
	level: SafetyLevel;
	/** Human-readable reason for the classification (optional) */
	reason?: string;
	/** Timestamp (epoch ms) when classification was performed */
	checkedAt: number;
}

// ---------------------------------------------------------------------------
// Source pointer
// ---------------------------------------------------------------------------

/**
 * Pointer to the origin of a memory entry.
 *
 * Tracks provenance across the workspace hierarchy so memory can
 * be queried by project, plan, workspace, or capability.
 */
export interface SourcePointer {
	/** Project identifier (always required) */
	project: string;
	/** Plan identifier (optional, for plan-scoped memory) */
	plan?: string;
	/** Workspace identifier (optional, for workspace-scoped memory) */
	workspace?: string;
	/** Capability path (optional, e.g. "file-system.read" or "execution.database") */
	capability?: string;
	/** File path on disk that the memory relates to (optional) */
	filePath?: string;
}

// ---------------------------------------------------------------------------
// Embedding metadata
// ---------------------------------------------------------------------------

/**
 * Vector embedding attached to a memory entry.
 *
 * Stores the dense vector and records which embedding model
 * produced it for reproducibility.
 */
export interface EmbeddingData {
	/** Dense vector of numbers (floats) */
	vector: number[];
	/** Model identifier that produced this embedding (e.g. "built-in/tfidf-256") */
	model: string;
}

// ---------------------------------------------------------------------------
// Freshness scoring
// ---------------------------------------------------------------------------

/**
 * Freshness metadata and computed score for a memory entry.
 *
 * Freshness is a value between 0 (stale) and 1 (fresh), computed
 * from creation time, last access time, and access frequency.
 */
export interface FreshnessData {
	/** Timestamp (epoch ms) when the entry was created */
	createdAt: number;
	/** Timestamp (epoch ms) when the entry was last updated */
	updatedAt?: number;
	/** Timestamp (epoch ms) when the entry was last accessed / retrieved */
	lastAccessedAt?: number;
	/** Number of times this entry has been accessed */
	accessCount: number;
	/** Computed freshness score (0 = stale, 1 = fresh) */
	score: number;
}

// ---------------------------------------------------------------------------
// Organic Memory Entry
// ---------------------------------------------------------------------------

/**
 * A single organic memory entry.
 *
 * Rich memory record that supports:
 * - Vector embeddings for semantic similarity search
 * - Content hashing for deduplication
 * - Source provenance for multi-dimensional queries
 * - Freshness scoring for staleness-aware retrieval
 * - Safety classification for content filtering
 * - Free-form tags for ad-hoc categorization
 *
 * This is the core data type for the organic vector memory store.
 */
export interface OrganicMemoryEntry {
	/** Unique entry ID (UUID v4) */
	id: string;
	/** SHA-256 content hash for deduplication and integrity checks */
	contentHash: string;
	/** Pointer to the origin of this memory */
	sourcePointer: SourcePointer;
	/** Vector embedding for semantic search */
	embedding: EmbeddingData;
	/** The textual content / summary being stored */
	content: string;
	/** Freshness metadata and computed score */
	freshness: FreshnessData;
	/** Safety classification */
	safetyClassification: SafetyClassification;
	/** Free-form tags for ad-hoc categorization and filtering */
	tags: string[];
}

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

/**
 * Defines which dimensions to filter on when querying memory.
 *
 * All fields are optional. Only provided fields are filtered.
 * Semantic query is performed via embedding vector when `queryEmbedding`
 * or `queryText` is provided.
 */
export interface OrganicMemoryQuery {
	/** Filter by project name */
	project?: string;
	/** Filter by plan identifier */
	plan?: string;
	/** Filter by workspace identifier */
	workspace?: string;
	/** Filter by capability path */
	capability?: string;
	/** Filter by tags (OR logic: entry matches if any tag matches) */
	tags?: string[];
	/** Minimum safety level allowed ("safe" allows all) */
	minSafetyLevel?: SafetyLevel;
	/** Minimum freshness score (0-1). Default: 0 (no filter) */
	minFreshness?: number;
	/**
	 * Query text for semantic search.
	 * If provided without queryEmbedding, a built-in embedding will be
	 * computed from the text.
	 */
	queryText?: string;
	/**
	 * Query embedding vector for semantic search.
	 * Takes precedence over queryText if both are provided.
	 */
	queryEmbedding?: number[];
	/** Maximum number of results. Default: 10 */
	limit?: number;
	/** Whether to include forbidden entries in results. Default: false */
	includeForbidden?: boolean;
}

/**
 * A scored result from an organic memory query.
 */
export interface ScoredMemoryResult {
	/** The matched memory entry */
	entry: OrganicMemoryEntry;
	/** Semantic relevance score (0-1). 0 = no match, 1 = perfect match. */
	semanticScore: number;
	/** Freshness score at query time (copied from entry.freshness.score) */
	freshnessScore: number;
	/** Overall combined score (composite of semantic + freshness) */
	combinedScore: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Configuration for the organic memory store.
 */
export interface OrganicMemoryConfig {
	/**
	 * Whether the organic memory store is enabled.
	 * When false, all operations are no-ops.
	 * Default: true
	 */
	enabled: boolean;

	/**
	 * Maximum number of entries to keep.
	 * Oldest/lowest-freshness entries are pruned.
	 * Default: 1000
	 */
	maxEntries: number;

	/**
	 * Maximum age of entries in milliseconds.
	 * Default: 90 days (7776000000 ms)
	 */
	maxAgeMs: number;

	/**
	 * Freshness half-life in milliseconds.
	 * After this time, an entry's base freshness drops to 0.5
	 * (if never accessed again).
	 * Default: 30 days (2592000000 ms)
	 */
	freshnessHalfLifeMs: number;

	/**
	 * Freshness boost per access (additive, max 1.0).
	 * Default: 0.1
	 */
	freshnessAccessBoost: number;

	/**
	 * Weight of semantic score vs freshness score in combined score.
	 * 1.0 = pure semantic, 0.0 = pure freshness.
	 * Default: 0.7
	 */
	semanticWeight: number;

	/**
	 * Maximum number of results to return per query.
	 * Default: 10
	 */
	maxResults: number;

	/**
	 * Minimum combined score threshold (0-1).
	 * Results below this threshold are not returned.
	 * Default: 0.1
	 */
	minScoreThreshold: number;

	/**
	 * Whether to enable content deduplication via content hash.
	 * Default: true
	 */
	enableDeduplication: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ORGANIC_MEMORY_CONFIG: OrganicMemoryConfig = {
	enabled: true,
	maxEntries: 1000,
	maxAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 days
	freshnessHalfLifeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
	freshnessAccessBoost: 0.1,
	semanticWeight: 0.7,
	maxResults: 10,
	minScoreThreshold: 0.1,
	enableDeduplication: true,
};

// ---------------------------------------------------------------------------
// Helper: safety level ordering
// ---------------------------------------------------------------------------

/**
 * Ordered ranking of safety levels from most restrictive to least.
 * Used for filtering: minSafetyLevel filters out anything below the threshold.
 */
const SAFETY_ORDER: Record<SafetyLevel, number> = {
	forbidden: 0,
	unsafe: 1,
	caution: 2,
	safe: 3,
};

/**
 * Check whether a safety level meets or exceeds a minimum threshold.
 *
 * @param level - The entry's safety level
 * @param minLevel - The minimum acceptable safety level
 * @returns True if the entry's level is >= minLevel
 */
export function meetsSafetyThreshold(level: SafetyLevel, minLevel?: SafetyLevel): boolean {
	if (!minLevel) return true;
	return SAFETY_ORDER[level] >= SAFETY_ORDER[minLevel];
}

/**
 * Generate a random UUID.
 *
 * @returns A new UUID v4 string
 */
export function generateId(): string {
	return randomUUID();
}

/**
 * Compute a freshness score for an entry.
 *
 * The base freshness decays exponentially from 1.0 with a half-life
 * defined in config. Each access boosts the freshness additively
 * (capped at 1.0).
 *
 * @param createdAt - Creation timestamp (epoch ms)
 * @param _lastAccessedAt - Last access timestamp (epoch ms, may be undefined)
 * @param accessCount - Number of times accessed
 * @param now - Current timestamp (epoch ms)
 * @param halfLifeMs - Freshness half-life in ms
 * @param accessBoost - Freshness boost per access
 * @returns Freshness score (0-1)
 */
export function computeFreshness(
	createdAt: number,
	_lastAccessedAt: number | undefined,
	accessCount: number,
	now: number,
	halfLifeMs: number,
	accessBoost: number,
): number {
	const age = Math.max(0, now - createdAt);
	const decayFactor = Math.exp((-Math.LN2 * age) / halfLifeMs);
	const baseFreshness = decayFactor;

	// Boost from accesses
	const accessBonus = Math.min(accessCount * accessBoost, 1 - baseFreshness);
	const freshness = Math.min(1, baseFreshness + accessBonus);

	return Math.max(0, freshness);
}
