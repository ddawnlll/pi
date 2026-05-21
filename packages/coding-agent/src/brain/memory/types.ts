/**
 * Memory Domain Model — P14.A
 *
 * Defines the core data structures for durable memory with provenance
 * and conflict resolution.
 *
 * Every memory requires source references (provenance). The lifecycle
 * tracks each record through states from candidate to expired or rejected.
 * Conflicts are detected and can be resolved automatically or by the user.
 *
 * File scope: This is the single source of truth for all memory types
 * used by the Memory Store (P14.B), Lifecycle Engine (P14.C), and
 * Scoring Engine (P14.D).
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Memory Type
// ---------------------------------------------------------------------------

/**
 * The type of knowledge a memory record represents.
 *
 * Each type has distinct semantics for scoring and conflict detection:
 * - project_memory: Facts about the project structure, config, dependencies
 * - architecture_memory: Design decisions, architectural patterns, trade-offs
 * - plan_memory: Execution plans, batch strategies, workspace topology
 * - failure_memory: Past failures, error patterns, anti-patterns
 * - decision_memory: Deliberate choices with rationale
 * - execution_memory: Workspace execution results, outcomes
 * - idea_memory: Suggestions, proposals, brainstorming output
 * - user_preference_memory: User's explicit preferences and overrides
 */
export type MemoryType =
	| "project_memory"
	| "architecture_memory"
	| "plan_memory"
	| "failure_memory"
	| "decision_memory"
	| "execution_memory"
	| "idea_memory"
	| "user_preference_memory";

// ---------------------------------------------------------------------------
// Memory Lifecycle
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of a memory record.
 *
 * States and transitions:
 * - candidate:      Newly created, awaiting review (default on creation)
 * - active:         Approved and influencing decisions
 * - disputed:       Contradicted by another record, needs resolution
 * - superseded:     Replaced by a newer, more authoritative record
 * - expired:        Time-based expiry reached (configurable TTL)
 * - rejected_by_user:  Explicitly rejected by the user
 * - needs_review:   Requires human review (auto-detected anomaly)
 */
export type MemoryLifecycle =
	| "candidate"
	| "active"
	| "disputed"
	| "superseded"
	| "expired"
	| "rejected_by_user"
	| "needs_review";

// ---------------------------------------------------------------------------
// Source Reference
// ---------------------------------------------------------------------------

/**
 * A reference to a source artifact that backs a memory record.
 *
 * At minimum, `type`, `path`, and `id` must be provided. Line ranges
 * and commit hashes are optional but recommended for precision.
 *
 * Source refs are the foundation of provenance — every memory record
 * must carry at least one source ref.
 */
export interface MemorySourceRef {
	/** The kind of source artifact */
	type: "observation" | "journal" | "plan" | "reflection" | "user" | "external";
	/** File path or resource identifier */
	path: string;
	/** Unique identifier within the source system (e.g., observation ID, plan ID) */
	id: string;
	/** Optional start line in the source file */
	lineStart?: number;
	/** Optional end line in the source file */
	lineEnd?: number;
	/** Optional ISO 8601 timestamp of the source artifact */
	timestamp?: string;
}

// ---------------------------------------------------------------------------
// Memory Record
// ---------------------------------------------------------------------------

/**
 * A single durable memory record.
 *
 * Every memory record carries:
 * - Unique ID (ULID-like, currently UUID v4)
 * - Type classification for semantic grouping
 * - Lifecycle state for governance
 * - Confidence score (0-1) based on evidence quality and recency
 * - Full provenance with one or more source references
 * - Derivation tracking via `derivedFrom`
 * - Expiration support via `expiresAt`
 * - Supersession chaining via `supersededBy`
 * - Free-form tags and metadata
 */
export interface MemoryRecord {
	/** Unique record identifier (UUID v4) */
	id: string;
	/** Type of knowledge this record represents */
	type: MemoryType;
	/** Short human-readable title */
	title: string;
	/** Full content / body of the memory */
	content: string;
	/** Optional brief summary (for search snippets) */
	summary?: string;
	/** Current lifecycle state */
	lifecycle: MemoryLifecycle;
	/** Confidence score between 0 (low) and 1 (high) */
	confidence: number;
	/** Provenance information */
	provenance: MemoryProvenance;
	/** ISO 8601 timestamp of creation */
	createdAt: string;
	/** ISO 8601 timestamp of last modification */
	updatedAt: string;
	/** Optional ISO 8601 timestamp of automatic expiry */
	expiresAt?: string;
	/** If superseded, the ID of the record that superseded this one */
	supersededBy?: string;
	/** IDs of other memory records that this record affects or is affected by */
	affectedBy?: string[];
	/** Free-form tags for ad-hoc categorization and search */
	tags: string[];
	/** Optional category for grouping within a type */
	category?: string;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

/**
 * Provenance information attached to every memory record.
 *
 * Tracks where the memory came from via source references, how it
 * relates to other records via derivation, and who validated it.
 */
export interface MemoryProvenance {
	/** One or more source references that back this memory */
	sourceRefs: MemorySourceRef[];
	/** Optional parent memory IDs that this record was derived from */
	derivedFrom?: string[];
	/** Who validated this record: "system", "user", or an LLM identifier */
	validatedBy: "system" | "user" | "llm_validated";
}

// ---------------------------------------------------------------------------
// Memory Conflict
// ---------------------------------------------------------------------------

/**
 * A detected conflict between two memory records.
 *
 * Conflicts arise when two records have contradictory content within
 * the same type category. The scoring engine assigns scores to each
 * record, and the conflict can be resolved automatically or manually.
 */
export interface MemoryConflict {
	/** Unique conflict identifier (UUID v4) */
	id: string;
	/** The two record IDs involved in the conflict (ordered) */
	recordIds: [string, string];
	/** The nature of the conflict */
	conflictType: "contradiction" | "duplicate" | "staleness";
	/** Confidence/relevance scores for each record, keyed by record ID */
	scores: { [recordId: string]: number };
	/** Resolution status */
	resolution?: "auto_resolved" | "user_selected" | "pending";
	/** ID of the record selected as the resolution (if resolved) */
	resolvedBy?: string;
	/** ISO 8601 timestamp of resolution */
	resolvedAt?: string;
	/** Optional evidence or explanation for the conflict */
	evidence?: string;
}

// ---------------------------------------------------------------------------
// Memory Score
// ---------------------------------------------------------------------------

/**
 * Scoring dimensions for a memory record.
 *
 * The total score is a weighted composite of confidence, relevance,
 * recency, and evidence quality. Each dimension is 0-1.
 */
export interface MemoryScore {
	/** Confidence in the record's accuracy (0-1) */
	confidence: number;
	/** Relevance to the current context (0-1) */
	relevance: number;
	/** Recency weight (0-1, higher for newer records) */
	recency: number;
	/** Quality of supporting evidence (0-1) */
	evidenceQuality: number;
	/** Composite total score (weighted combination, 0-1) */
	total: number;
}

// ---------------------------------------------------------------------------
// Memory Query
// ---------------------------------------------------------------------------

/**
 * Query parameters for searching memory records.
 *
 * All fields are optional. Only provided fields are used for filtering.
 * Results are sorted by the specified field and order.
 */
export interface MemoryQuery {
	/** Filter by one or more memory types */
	types?: MemoryType[];
	/** Filter by one or more lifecycle states */
	lifecycle?: MemoryLifecycle[];
	/** Filter by tags (OR logic: record matches if it has any of the tags) */
	tags?: string[];
	/** Free-text search against title, content, and summary */
	searchText?: string;
	/** Minimum confidence score (0-1) */
	minConfidence?: number;
	/** Minimum relevance score (0-1) */
	minRelevance?: number;
	/** Maximum number of results (default: 20) */
	limit?: number;
	/** Number of results to skip (for pagination) */
	offset?: number;
	/** Field to sort by */
	sortBy?: "createdAt" | "updatedAt" | "confidence" | "relevance";
	/** Sort direction */
	sortOrder?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Memory Statistics
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics about the memory store.
 */
export interface MemoryStats {
	/** Total number of memory records */
	totalMemories: number;
	/** Count of records grouped by type */
	byType: Record<MemoryType, number>;
	/** Count of records grouped by lifecycle state */
	byLifecycle: Record<MemoryLifecycle, number>;
	/** Average confidence score across all records */
	avgConfidence: number;
	/** Number of unresolved conflicts */
	conflictCount: number;
	/** Number of expired records */
	expiredCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid MemoryType values. */
export const ALL_MEMORY_TYPES: MemoryType[] = [
	"project_memory",
	"architecture_memory",
	"plan_memory",
	"failure_memory",
	"decision_memory",
	"execution_memory",
	"idea_memory",
	"user_preference_memory",
];

/** All valid MemoryLifecycle values. */
export const ALL_MEMORY_LIFECYCLES: MemoryLifecycle[] = [
	"candidate",
	"active",
	"disputed",
	"superseded",
	"expired",
	"rejected_by_user",
	"needs_review",
];

/** All valid MemorySourceRef type values. */
export const ALL_MEMORY_SOURCE_REF_TYPES: MemorySourceRef["type"][] = [
	"observation",
	"journal",
	"plan",
	"reflection",
	"user",
	"external",
];

/** All valid conflict type values. */
export const ALL_CONFLICT_TYPES: MemoryConflict["conflictType"][] = ["contradiction", "duplicate", "staleness"];

/** All valid resolution values. */
export const ALL_RESOLUTION_TYPES: NonNullable<MemoryConflict["resolution"]>[] = [
	"auto_resolved",
	"user_selected",
	"pending",
];

/** All valid validatedBy values. */
export const ALL_VALIDATED_BY: MemoryProvenance["validatedBy"][] = ["system", "user", "llm_validated"];

/**
 * Default limit for query results.
 */
export const DEFAULT_QUERY_LIMIT = 20;

/**
 * Maximum limit for query results.
 */
export const MAX_QUERY_LIMIT = 100;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Result of a validation check.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate that a value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * Validate that a value is a number between 0 and 1 inclusive.
 */
function isConfidence(value: unknown): value is number {
	return typeof value === "number" && value >= 0 && value <= 1;
}

/**
 * Validate a MemoryRecord object.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateMemoryRecord(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const record = value as Record<string, unknown>;

	if (!isNonEmptyString(record.id)) {
		errors.push("id must be a non-empty string");
	}
	if (!ALL_MEMORY_TYPES.includes(record.type as MemoryType)) {
		errors.push(`type must be one of: ${ALL_MEMORY_TYPES.join(", ")}`);
	}
	if (!isNonEmptyString(record.title)) {
		errors.push("title must be a non-empty string");
	}
	if (typeof record.content !== "string") {
		errors.push("content must be a string");
	}
	if (record.summary !== undefined && typeof record.summary !== "string") {
		errors.push("summary must be a string when provided");
	}
	if (!ALL_MEMORY_LIFECYCLES.includes(record.lifecycle as MemoryLifecycle)) {
		errors.push(`lifecycle must be one of: ${ALL_MEMORY_LIFECYCLES.join(", ")}`);
	}
	if (!isConfidence(record.confidence)) {
		errors.push("confidence must be a number between 0 and 1");
	}

	// Validate provenance
	if (!record.provenance || typeof record.provenance !== "object") {
		errors.push("provenance must be a non-null object");
	} else {
		const prov = record.provenance as Record<string, unknown>;
		if (!Array.isArray(prov.sourceRefs) || prov.sourceRefs.length === 0) {
			errors.push("provenance.sourceRefs must be a non-empty array");
		} else {
			for (const [i, ref] of prov.sourceRefs.entries()) {
				if (!ref || typeof ref !== "object") {
					errors.push(`provenance.sourceRefs[${i}] must be a non-null object`);
				} else {
					const sr = ref as Record<string, unknown>;
					if (!ALL_MEMORY_SOURCE_REF_TYPES.includes(sr.type as MemorySourceRef["type"])) {
						errors.push(
							`provenance.sourceRefs[${i}].type must be one of: ${ALL_MEMORY_SOURCE_REF_TYPES.join(", ")}`,
						);
					}
					if (!isNonEmptyString(sr.path)) {
						errors.push(`provenance.sourceRefs[${i}].path must be a non-empty string`);
					}
					if (!isNonEmptyString(sr.id)) {
						errors.push(`provenance.sourceRefs[${i}].id must be a non-empty string`);
					}
				}
			}
		}
		if (
			prov.derivedFrom !== undefined &&
			(!Array.isArray(prov.derivedFrom) || !prov.derivedFrom.every((d: unknown) => typeof d === "string"))
		) {
			errors.push("provenance.derivedFrom must be an array of strings when provided");
		}
		if (!ALL_VALIDATED_BY.includes(prov.validatedBy as MemoryProvenance["validatedBy"])) {
			errors.push(`provenance.validatedBy must be one of: ${ALL_VALIDATED_BY.join(", ")}`);
		}
	}

	if (typeof record.createdAt !== "string" || record.createdAt.length === 0) {
		errors.push("createdAt must be a non-empty ISO 8601 string");
	}
	if (typeof record.updatedAt !== "string" || record.updatedAt.length === 0) {
		errors.push("updatedAt must be a non-empty ISO 8601 string");
	}
	if (record.expiresAt !== undefined && (typeof record.expiresAt !== "string" || record.expiresAt.length === 0)) {
		errors.push("expiresAt must be a non-empty ISO 8601 string when provided");
	}
	if (record.supersededBy !== undefined && !isNonEmptyString(record.supersededBy)) {
		errors.push("supersededBy must be a non-empty string when provided");
	}
	if (record.affectedBy !== undefined && !Array.isArray(record.affectedBy)) {
		errors.push("affectedBy must be an array when provided");
	} else if (record.affectedBy !== undefined) {
		for (const [i, id] of (record.affectedBy as unknown[]).entries()) {
			if (typeof id !== "string") {
				errors.push(`affectedBy[${i}] must be a string`);
			}
		}
	}
	if (!Array.isArray(record.tags)) {
		errors.push("tags must be an array");
	} else {
		for (const [i, tag] of (record.tags as unknown[]).entries()) {
			if (typeof tag !== "string") {
				errors.push(`tags[${i}] must be a string`);
			}
		}
	}
	if (record.category !== undefined && !isNonEmptyString(record.category)) {
		errors.push("category must be a non-empty string when provided");
	}
	if (record.metadata !== undefined && (typeof record.metadata !== "object" || record.metadata === null)) {
		errors.push("metadata must be a non-null object");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a MemoryConflict object.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateMemoryConflict(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const conflict = value as Record<string, unknown>;

	if (!isNonEmptyString(conflict.id)) {
		errors.push("id must be a non-empty string");
	}
	if (!Array.isArray(conflict.recordIds) || conflict.recordIds.length !== 2) {
		errors.push("recordIds must be an array of exactly 2 strings");
	} else {
		for (const [i, id] of (conflict.recordIds as unknown[]).entries()) {
			if (typeof id !== "string" || id.length === 0) {
				errors.push(`recordIds[${i}] must be a non-empty string`);
			}
		}
	}
	if (!ALL_CONFLICT_TYPES.includes(conflict.conflictType as MemoryConflict["conflictType"])) {
		errors.push(`conflictType must be one of: ${ALL_CONFLICT_TYPES.join(", ")}`);
	}
	if (!conflict.scores || typeof conflict.scores !== "object") {
		errors.push("scores must be a non-null object");
	}
	if (
		conflict.resolution !== undefined &&
		!ALL_RESOLUTION_TYPES.includes(conflict.resolution as NonNullable<MemoryConflict["resolution"]>)
	) {
		errors.push(`resolution must be one of: ${ALL_RESOLUTION_TYPES.join(", ")}`);
	}
	if (conflict.resolvedBy !== undefined && !isNonEmptyString(conflict.resolvedBy)) {
		errors.push("resolvedBy must be a non-empty string when provided");
	}
	if (
		conflict.resolvedAt !== undefined &&
		(typeof conflict.resolvedAt !== "string" || conflict.resolvedAt.length === 0)
	) {
		errors.push("resolvedAt must be a non-empty ISO 8601 string when provided");
	}
	if (conflict.evidence !== undefined && typeof conflict.evidence !== "string") {
		errors.push("evidence must be a string when provided");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a MemoryQuery object.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateMemoryQuery(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const query = value as Record<string, unknown>;

	if (query.types !== undefined) {
		if (!Array.isArray(query.types)) {
			errors.push("types must be an array when provided");
		} else {
			for (const [i, t] of (query.types as unknown[]).entries()) {
				if (!ALL_MEMORY_TYPES.includes(t as MemoryType)) {
					errors.push(`types[${i}] must be a valid MemoryType`);
				}
			}
		}
	}
	if (query.lifecycle !== undefined) {
		if (!Array.isArray(query.lifecycle)) {
			errors.push("lifecycle must be an array when provided");
		} else {
			for (const [i, lc] of (query.lifecycle as unknown[]).entries()) {
				if (!ALL_MEMORY_LIFECYCLES.includes(lc as MemoryLifecycle)) {
					errors.push(`lifecycle[${i}] must be a valid MemoryLifecycle`);
				}
			}
		}
	}
	if (query.tags !== undefined) {
		if (!Array.isArray(query.tags)) {
			errors.push("tags must be an array when provided");
		} else {
			for (const [i, tag] of (query.tags as unknown[]).entries()) {
				if (typeof tag !== "string") {
					errors.push(`tags[${i}] must be a string`);
				}
			}
		}
	}
	if (query.searchText !== undefined && typeof query.searchText !== "string") {
		errors.push("searchText must be a string when provided");
	}
	if (query.minConfidence !== undefined && !isConfidence(query.minConfidence)) {
		errors.push("minConfidence must be a number between 0 and 1");
	}
	if (query.minRelevance !== undefined && !isConfidence(query.minRelevance)) {
		errors.push("minRelevance must be a number between 0 and 1");
	}
	if (
		query.limit !== undefined &&
		(typeof query.limit !== "number" || query.limit < 1 || query.limit > MAX_QUERY_LIMIT)
	) {
		errors.push(`limit must be a number between 1 and ${MAX_QUERY_LIMIT}`);
	}
	if (query.offset !== undefined && (typeof query.offset !== "number" || query.offset < 0)) {
		errors.push("offset must be a non-negative number");
	}
	const validSortBy = ["createdAt", "updatedAt", "confidence", "relevance"];
	if (query.sortBy !== undefined && !validSortBy.includes(query.sortBy as string)) {
		errors.push(`sortBy must be one of: ${validSortBy.join(", ")}`);
	}
	if (query.sortOrder !== undefined && !["asc", "desc"].includes(query.sortOrder as string)) {
		errors.push('sortOrder must be "asc" or "desc"');
	}

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a new MemoryRecord with defaults applied.
 *
 * @param overrides - Partial record fields (type, title, content, and provenance are required)
 * @returns A fully populated MemoryRecord
 */
export function createMemoryRecord(
	overrides: Partial<Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">> &
		Pick<MemoryRecord, "type" | "title" | "content" | "provenance">,
): MemoryRecord {
	const now = new Date().toISOString();

	const record: MemoryRecord = {
		id: randomUUID(),
		type: overrides.type,
		title: overrides.title,
		content: overrides.content,
		summary: overrides.summary,
		lifecycle: overrides.lifecycle ?? "candidate",
		confidence: overrides.confidence ?? 0.5,
		provenance: overrides.provenance,
		createdAt: now,
		updatedAt: now,
		expiresAt: overrides.expiresAt,
		supersededBy: overrides.supersededBy,
		affectedBy: overrides.affectedBy,
		tags: overrides.tags ?? [],
		category: overrides.category,
		metadata: overrides.metadata ?? {},
	};

	return record;
}

/**
 * Create a new MemoryConflict with defaults applied.
 *
 * @param overrides - Partial conflict fields (recordIds and conflictType are required)
 * @returns A fully populated MemoryConflict
 */
export function createMemoryConflict(
	overrides: Partial<Omit<MemoryConflict, "id">> &
		Pick<MemoryConflict, "recordIds" | "conflictType"> & {
			scores: { [recordId: string]: number };
		},
): MemoryConflict {
	const conflict: MemoryConflict = {
		id: randomUUID(),
		recordIds: overrides.recordIds,
		conflictType: overrides.conflictType,
		scores: overrides.scores,
		resolution: overrides.resolution,
		resolvedBy: overrides.resolvedBy,
		resolvedAt: overrides.resolvedAt,
		evidence: overrides.evidence,
	};

	return conflict;
}

/**
 * Compute a MemoryScore for a given record and query context.
 *
 * @param record - The memory record to score
 * @param query - Optional query context for relevance scoring
 * @returns A MemoryScore with all dimensions
 */
export function computeMemoryScore(record: MemoryRecord, query?: MemoryQuery): MemoryScore {
	const confidence = record.confidence;

	// Recency: newer records score higher
	const ageMs = Date.now() - new Date(record.createdAt).getTime();
	const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
	const recency = Math.max(0, 1 - ageMs / thirtyDaysMs);

	// Evidence quality: based on number of source refs
	const evidenceQuality = Math.min(1, (record.provenance.sourceRefs.length || 1) / 5);

	// Relevance: based on type and lifecycle match with query
	let relevance = 0.5; // default mid-range
	if (query) {
		let matchFactors = 0;
		let matchScore = 0;

		if (query.types && query.types.length > 0) {
			matchFactors++;
			if (query.types.includes(record.type)) {
				matchScore += 0.4;
			}
		}

		if (query.lifecycle && query.lifecycle.length > 0) {
			matchFactors++;
			if (query.lifecycle.includes(record.lifecycle)) {
				matchScore += 0.3;
			}
		}

		if (query.tags && query.tags.length > 0) {
			matchFactors++;
			const tagOverlap = query.tags.filter((t) => record.tags.includes(t)).length;
			if (tagOverlap > 0) {
				matchScore += 0.3 * Math.min(1, tagOverlap / query.tags.length);
			}
		}

		if (query.searchText) {
			matchFactors++;
			const searchLower = query.searchText.toLowerCase();
			const titleMatch = record.title.toLowerCase().includes(searchLower);
			const contentMatch = record.content.toLowerCase().includes(searchLower);
			const summaryMatch = record.summary?.toLowerCase().includes(searchLower);
			if (titleMatch) matchScore += 0.3;
			if (contentMatch) matchScore += 0.2;
			if (summaryMatch) matchScore += 0.1;
		}

		if (matchFactors > 0) {
			relevance = Math.min(1, matchScore / matchFactors);
		}
	}

	// Composite total: weighted average
	const total = confidence * 0.3 + relevance * 0.3 + recency * 0.2 + evidenceQuality * 0.2;

	return {
		confidence,
		relevance,
		recency,
		evidenceQuality,
		total,
	};
}

/**
 * Compute aggregate MemoryStats from an array of records and conflicts.
 *
 * @param records - All memory records
 * @param conflicts - All memory conflicts
 * @returns MemoryStats with aggregated counts and averages
 */
export function computeMemoryStats(records: MemoryRecord[], conflicts: MemoryConflict[]): MemoryStats {
	const byType = {} as Record<MemoryType, number>;
	const byLifecycle = {} as Record<MemoryLifecycle, number>;

	for (const type of ALL_MEMORY_TYPES) {
		byType[type] = 0;
	}
	for (const lc of ALL_MEMORY_LIFECYCLES) {
		byLifecycle[lc] = 0;
	}

	let totalConfidence = 0;
	let expiredCount = 0;

	for (const record of records) {
		byType[record.type]++;
		byLifecycle[record.lifecycle]++;
		totalConfidence += record.confidence;
		if (record.lifecycle === "expired") {
			expiredCount++;
		}
	}

	const conflictCount = conflicts.filter((c) => c.resolution === "pending" || !c.resolution).length;

	return {
		totalMemories: records.length,
		byType,
		byLifecycle,
		avgConfidence: records.length > 0 ? totalConfidence / records.length : 0,
		conflictCount,
		expiredCount,
	};
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a MemoryRecord to a JSON string.
 *
 * @param record - The memory record to serialize
 * @returns Pretty-printed JSON string
 */
export function serializeMemoryRecord(record: MemoryRecord): string {
	return JSON.stringify(record, null, 2);
}

/**
 * Deserialize a JSON string to a MemoryRecord with validation.
 *
 * @param json - The JSON string to parse
 * @returns A validated MemoryRecord
 * @throws If the JSON is invalid or validation fails
 */
export function deserializeMemoryRecord(json: string): MemoryRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse MemoryRecord JSON: ${(e as Error).message}`);
	}

	const result = validateMemoryRecord(parsed);
	if (!result.valid) {
		throw new Error(`Invalid MemoryRecord: ${result.errors.join("; ")}`);
	}

	return parsed as MemoryRecord;
}

/**
 * Serialize a MemoryConflict to a JSON string.
 *
 * @param conflict - The memory conflict to serialize
 * @returns Pretty-printed JSON string
 */
export function serializeMemoryConflict(conflict: MemoryConflict): string {
	return JSON.stringify(conflict, null, 2);
}

/**
 * Deserialize a JSON string to a MemoryConflict with validation.
 *
 * @param json - The JSON string to parse
 * @returns A validated MemoryConflict
 * @throws If the JSON is invalid or validation fails
 */
export function deserializeMemoryConflict(json: string): MemoryConflict {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse MemoryConflict JSON: ${(e as Error).message}`);
	}

	const result = validateMemoryConflict(parsed);
	if (!result.valid) {
		throw new Error(`Invalid MemoryConflict: ${result.errors.join("; ")}`);
	}

	return parsed as MemoryConflict;
}
