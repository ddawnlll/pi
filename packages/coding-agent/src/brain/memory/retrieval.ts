/**
 * Memory Retrieval V2 — V5.03
 *
 * Read-only retrieval layer for memory records, designed for retry-hotspot
 * queries and stable UI report output.
 *
 * Design principles:
 * 1. NEVER writes memory — all operations are pure reads from MemoryStore.
 * 2. Filters out rejected/superseded/expired/disputed lifecycle states so
 *    they cannot silently influence planning context.
 * 3. Returns structured, serialisable output suitable for display in a UI
 *    report (e.g., web dashboard or TUI inbox).
 * 4. Source refs (provenance) are always included in results so downstream
 *    consumers can trace claims back to evidence.
 *
 * @packageDocumentation
 */

import type { MemoryStore } from "./store.js";
import type { MemoryLifecycle, MemoryRecord, MemorySourceRef } from "./types.js";
import { ALL_MEMORY_LIFECYCLES } from "./types.js";

// =========================================================================
// Constants
// =========================================================================

/**
 * Lifecycle states that are excluded from retrieval results.
 *
 * These states represent records that should NOT influence planning
 * context:
 * - rejected_by_user:  User explicitly rejected this memory
 * - superseded:        Replaced by a newer, more authoritative record
 * - expired:           Time-based TTL reached
 * - disputed:          Contradicted by another record, needs resolution
 */
const _EXCLUDED_LIFECYCLES: ReadonlySet<MemoryLifecycle> = new Set<MemoryLifecycle>([
	"rejected_by_user",
	"superseded",
	"expired",
	"disputed",
]);

/**
 * Lifecycle states that ARE allowed in retrieval results.
 *
 * - candidate:   Newly created, awaiting review (allowed but lower priority)
 * - active:      Approved and influencing decisions (primary target)
 * - needs_review: Flagged for human review (still potentially useful context)
 */
const ALLOWED_LIFECYCLES: ReadonlySet<MemoryLifecycle> = new Set<MemoryLifecycle>([
	"candidate",
	"active",
	"needs_review",
]);

/** Default maximum results per query. */
const DEFAULT_QUERY_LIMIT = 10;

/** Maximum allowed results per query to prevent runaway queries. */
const MAX_QUERY_LIMIT = 50;

// =========================================================================
// Types — Query Input
// =========================================================================

/**
 * Input parameters for a retry-hotspot memory query.
 *
 * A retry-hotspot signal indicates a workspace or pattern that has
 * experienced repeated retries (3+). This query looks up relevant
 * failure_memory records to inform planning decisions.
 *
 * At least one of `workspaceId` or `errorText` should be provided for
 * meaningful results.
 */
export interface RetryHotspotQuery {
	/**
	 * The workspace ID that experienced the retries.
	 * Used to match failure_memory records whose source refs or tags
	 * reference this workspace.
	 */
	workspaceId?: string;

	/**
	 * Error text or pattern to match against failure memory content.
	 * Used for full-text search across title, content, and summary.
	 */
	errorText?: string;

	/**
	 * Plan execution ID for scope context.
	 * Limits results to memories recorded within the same plan execution.
	 */
	planExecId?: string;

	/** Maximum results (default: 10, max: 50). */
	limit?: number;

	/** Offset for pagination (default: 0). */
	offset?: number;
}

// =========================================================================
// Types — Retrieval Output
// =========================================================================

/**
 * A single retrieval result entry derived from a memory record.
 *
 * This is a stable, serialisable subset of MemoryRecord designed
 * for UI display. It always includes source refs for provenance.
 */
export interface MemoryRetrievalEntry {
	/** Memory record ID. */
	id: string;
	/** The memory type (typically "failure_memory" for retry-hotspot). */
	type: string;
	/** Short human-readable title. */
	title: string;
	/** Concise summary (falls back to truncated content). */
	summary: string;
	/** Full content of the memory record. */
	content: string;
	/** Current lifecycle state. */
	lifecycle: MemoryLifecycle;
	/** Confidence score (0–1). */
	confidence: number;
	/** Source references for provenance (always included). */
	sourceRefs: MemorySourceRef[];
	/** ISO 8601 creation timestamp. */
	createdAt: string;
	/** ISO 8601 last-updated timestamp. */
	updatedAt: string;
	/** Free-form tags for categorisation. */
	tags: string[];
	/** Optional category. */
	category?: string;
}

/**
 * A retrieval report suitable for UI display.
 *
 * Contains all information needed to render a memory retrieval result
 * in a web dashboard, TUI inbox, or CLI output.
 */
export interface MemoryRetrievalReport {
	/** The query that produced this report. */
	query: RetryHotspotQuery;
	/** Total matching records (before pagination). */
	total: number;
	/** Matching memory entries. */
	entries: MemoryRetrievalEntry[];
	/** Number of records excluded due to lifecycle filtering. */
	filteredByLifecycle: number;
	/** Number of records excluded due to lifecycle filtering, by state. */
	filteredByLifecycleBreakdown: Record<string, number>;
	/** Human-readable summary of the retrieval. */
	summary: string;
	/** ISO 8601 timestamp of when this report was generated. */
	generatedAt: string;
}

/**
 * Result of a memory retrieval operation.
 */
export interface MemoryRetrievalResult {
	success: boolean;
	report?: MemoryRetrievalReport;
	error?: string;
}

// =========================================================================
// Memory Retrieval V2
// =========================================================================

/**
 * Read-only retrieval layer for memory records.
 *
 * This class is the single entry point for all memory retrieval
 * operations in the V5 brain. It enforces the following invariants:
 *
 * 1. **Read-only**: All operations are pure reads from MemoryStore.
 *    This class never calls create(), update(), delete(), or any
 *    other mutation method.
 *
 * 2. **Lifecycle filtering**: Rejected, superseded, expired, and
 *    disputed records are automatically excluded from all results.
 *    They cannot silently influence planning context.
 *
 * 3. **Stable output**: All retrieval methods return structured
 *    `MemoryRetrievalReport` objects suitable for serialisation
 *    and UI display.
 *
 * 4. **Source refs included**: Every result entry includes its
 *    source references so consumers can trace provenance.
 *
 * Usage:
 * ```typescript
 * const store = new MemoryStore();
 * await store.initialize();
 * const retrieval = new MemoryRetrievalV2(store);
 *
 * // Query for failure memories related to a retry hotspot
 * const result = await retrieval.queryByRetryHotspot({
 *   workspaceId: "ws-123",
 *   errorText: "docker build failed",
 * });
 *
 * if (result.success && result.report) {
 *   console.log(result.report.summary);
 *   for (const entry of result.report.entries) {
 *     console.log(`- ${entry.title} (${entry.confidence})`);
 *     for (const ref of entry.sourceRefs) {
 *       console.log(`  source: ${ref.path}`);
 *     }
 *   }
 * }
 * ```
 */
export class MemoryRetrievalV2 {
	private readonly store: MemoryStore;

	/**
	 * @param store - An initialised MemoryStore instance.
	 *                The retrieval layer only reads from this store;
	 *                it never mutates it.
	 */
	constructor(store: MemoryStore) {
		this.store = store;
	}

	// -------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------

	/**
	 * Query failure_memory records relevant to a retry-hotspot context.
	 *
	 * This is the primary method for AC1: a retry-hotspot signal queries
	 * relevant failure_memory records with source refs.
	 *
	 * The query matches failure_memory records by:
	 * 1. Error text search (match against title, content, summary)
	 * 2. Workspace ID matching (via tags or source refs)
	 * 3. Plan execution ID matching (via tags or source refs)
	 *
	 * Results are filtered to exclude rejected, superseded, expired,
	 * and disputed lifecycle states (AC2).
	 *
	 * The output is structured as a MemoryRetrievalReport suitable for
	 * UI display (AC3).
	 *
	 * @param query - Retry-hotspot query parameters
	 * @returns MemoryRetrievalResult with report on success
	 */
	async queryByRetryHotspot(query: RetryHotspotQuery): Promise<MemoryRetrievalResult> {
		try {
			this.validateQuery(query);

			const failureMemories = await this.store.query({
				types: ["failure_memory"],
				lifecycle: Array.from(ALLOWED_LIFECYCLES),
			});

			// Apply text filter if errorText is provided
			const textFiltered = this.applyTextFilter(failureMemories, query.errorText);

			// Apply workspace/plan context filter
			const contextFiltered = this.applyContextFilter(textFiltered, query);

			// Count what would have been filtered by lifecycle
			const allFailureMemories = await this.store.query({ types: ["failure_memory"] });
			const lifecycleFilteredCount = allFailureMemories.length - failureMemories.length;
			const lifecycleBreakdown = this.computeLifecycleBreakdown(allFailureMemories, failureMemories);

			// Sort by confidence descending (most relevant first)
			contextFiltered.sort((a, b) => b.confidence - a.confidence);

			// Apply pagination
			const limit = Math.min(query.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
			const offset = query.offset ?? 0;
			const paginated = contextFiltered.slice(offset, offset + limit);

			// Build entries
			const entries = paginated.map((record) => this.toRetrievalEntry(record));

			// Build summary
			const summary = this.buildSummary(query, entries.length, contextFiltered.length, lifecycleFilteredCount);

			const report: MemoryRetrievalReport = {
				query,
				total: contextFiltered.length,
				entries,
				filteredByLifecycle: lifecycleFilteredCount,
				filteredByLifecycleBreakdown: lifecycleBreakdown,
				summary,
				generatedAt: new Date().toISOString(),
			};

			return { success: true, report };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Query all failure_memory records (with lifecycle filtering).
	 *
	 * Convenience method for listing all failure memories that are
	 * relevant for planning context.
	 *
	 * @param limit - Max results (default: 20, max: 50)
	 * @param offset - Pagination offset
	 * @returns MemoryRetrievalReport
	 */
	async listFailureMemories(limit?: number, offset?: number): Promise<MemoryRetrievalResult> {
		try {
			const resolvedLimit = Math.min(limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

			const allFailureMemories = await this.store.query({ types: ["failure_memory"] });
			const activeFailureMemories = allFailureMemories.filter((r) => ALLOWED_LIFECYCLES.has(r.lifecycle));

			// Sort by confidence descending
			activeFailureMemories.sort((a, b) => b.confidence - a.confidence);

			const paginated = activeFailureMemories.slice(offset ?? 0, (offset ?? 0) + resolvedLimit);

			const entries = paginated.map((record) => this.toRetrievalEntry(record));

			const lifecycleFilteredCount = allFailureMemories.length - activeFailureMemories.length;

			const report: MemoryRetrievalReport = {
				query: { limit: resolvedLimit, offset: offset ?? 0 },
				total: activeFailureMemories.length,
				entries,
				filteredByLifecycle: lifecycleFilteredCount,
				filteredByLifecycleBreakdown: this.computeLifecycleBreakdown(allFailureMemories, activeFailureMemories),
				summary: `${activeFailureMemories.length} failure memory record(s) found (${lifecycleFilteredCount} excluded by lifecycle state).`,
				generatedAt: new Date().toISOString(),
			};

			return { success: true, report };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Query any memory type with lifecycle filtering and structured output.
	 *
	 * Generic retrieval method for querying any memory type. Returns
	 * only records in active/candidate/needs_review lifecycle states.
	 *
	 * @param query - Standard memory query with optional type/lifecycle filters
	 * @returns MemoryRetrievalResult
	 */
	async queryMemories(
		query: { types?: string[]; searchText?: string; tags?: string[]; limit?: number; offset?: number } = {},
	): Promise<MemoryRetrievalResult> {
		try {
			const resolvedLimit = Math.min(query.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

			// Get total matching records across all lifecycles for filtering stats
			const allMatching = await this.store.query({
				types: query.types as any,
				searchText: query.searchText,
				tags: query.tags,
			});

			// Get only allowed-lifecycle records
			const filtered = allMatching.filter((r) => ALLOWED_LIFECYCLES.has(r.lifecycle));

			// Sort by confidence descending
			filtered.sort((a, b) => b.confidence - a.confidence);

			const paginated = filtered.slice(query.offset ?? 0, (query.offset ?? 0) + resolvedLimit);
			const entries = paginated.map((record) => this.toRetrievalEntry(record));

			const lifecycleFilteredCount = allMatching.length - filtered.length;

			const report: MemoryRetrievalReport = {
				query: { ...query, limit: resolvedLimit, offset: query.offset ?? 0 },
				total: filtered.length,
				entries,
				filteredByLifecycle: lifecycleFilteredCount,
				filteredByLifecycleBreakdown: this.computeLifecycleBreakdown(allMatching, filtered),
				summary: `${filtered.length} memory record(s) found (${lifecycleFilteredCount} excluded by lifecycle state).`,
				generatedAt: new Date().toISOString(),
			};

			return { success: true, report };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	// -------------------------------------------------------------------
	// Internal Helpers
	// -------------------------------------------------------------------

	/**
	 * Validate query parameters.
	 */
	private validateQuery(query: RetryHotspotQuery): void {
		if (
			query.limit !== undefined &&
			(typeof query.limit !== "number" || query.limit < 1 || query.limit > MAX_QUERY_LIMIT)
		) {
			throw new Error(`limit must be between 1 and ${MAX_QUERY_LIMIT}`);
		}
		if (query.offset !== undefined && (typeof query.offset !== "number" || query.offset < 0)) {
			throw new Error("offset must be a non-negative number");
		}
	}

	/**
	 * Filter records by error text (case-insensitive substring match).
	 */
	private applyTextFilter(records: MemoryRecord[], errorText?: string): MemoryRecord[] {
		if (!errorText || errorText.trim().length === 0) {
			return records;
		}

		const searchLower = errorText.toLowerCase();
		return records.filter((r) => {
			if (r.title.toLowerCase().includes(searchLower)) return true;
			if (r.content.toLowerCase().includes(searchLower)) return true;
			if (r.summary?.toLowerCase().includes(searchLower)) return true;
			return false;
		});
	}

	/**
	 * Filter records by workspace ID or plan execution ID context.
	 *
	 * Matches against tags and source ref paths.
	 */
	private applyContextFilter(records: MemoryRecord[], query: RetryHotspotQuery): MemoryRecord[] {
		const { workspaceId, planExecId } = query;

		if (!workspaceId && !planExecId) {
			return records;
		}

		return records.filter((r) => {
			// Check tags
			if (workspaceId && r.tags.some((t) => t.toLowerCase().includes(workspaceId.toLowerCase()))) {
				return true;
			}
			if (planExecId && r.tags.some((t) => t.toLowerCase().includes(planExecId.toLowerCase()))) {
				return true;
			}

			// Check source ref paths
			for (const ref of r.provenance.sourceRefs) {
				if (workspaceId && ref.path.toLowerCase().includes(workspaceId.toLowerCase())) {
					return true;
				}
				if (planExecId && ref.path.toLowerCase().includes(planExecId.toLowerCase())) {
					return true;
				}
				if (workspaceId && ref.id.toLowerCase().includes(workspaceId.toLowerCase())) {
					return true;
				}
				if (planExecId && ref.id.toLowerCase().includes(planExecId.toLowerCase())) {
					return true;
				}
			}

			return false;
		});
	}

	/**
	 * Compute lifecycle breakdown of filtered-out records.
	 */
	private computeLifecycleBreakdown(
		allRecords: MemoryRecord[],
		allowedRecords: MemoryRecord[],
	): Record<string, number> {
		const allowedIds = new Set(allowedRecords.map((r) => r.id));
		const filtered = allRecords.filter((r) => !allowedIds.has(r.id));

		const breakdown: Record<string, number> = {};
		for (const lc of ALL_MEMORY_LIFECYCLES) {
			const count = filtered.filter((r) => r.lifecycle === lc).length;
			if (count > 0) {
				breakdown[lc] = count;
			}
		}
		return breakdown;
	}

	/**
	 * Convert a MemoryRecord to a stable retrieval entry for UI display.
	 */
	private toRetrievalEntry(record: MemoryRecord): MemoryRetrievalEntry {
		return {
			id: record.id,
			type: record.type,
			title: record.title,
			summary: record.summary ?? record.content.slice(0, 200) + (record.content.length > 200 ? "..." : ""),
			content: record.content,
			lifecycle: record.lifecycle,
			confidence: record.confidence,
			sourceRefs: [...record.provenance.sourceRefs],
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			tags: [...record.tags],
			category: record.category,
		};
	}

	/**
	 * Build a human-readable summary string for the report.
	 */
	private buildSummary(
		query: RetryHotspotQuery,
		resultCount: number,
		totalCount: number,
		filteredByLifecycle: number,
	): string {
		const parts: string[] = [];

		if (query.workspaceId) {
			parts.push(`Retry-hotspot query for workspace "${query.workspaceId}"`);
		} else if (query.errorText) {
			parts.push(`Retry-hotspot query matching "${query.errorText}"`);
		} else {
			parts.push("Retry-hotspot query");
		}

		if (resultCount > 0) {
			parts.push(`found ${resultCount} failure memory record(s)`);
		} else {
			parts.push("found no matching failure memory records");
		}

		if (totalCount > resultCount) {
			parts.push(`(${totalCount} total matched, showing ${resultCount})`);
		}

		if (filteredByLifecycle > 0) {
			parts.push(`${filteredByLifecycle} record(s) excluded by lifecycle state`);
		}

		return parts.join(" — ");
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a MemoryRetrievalV2 instance.
 *
 * @param store - An initialised MemoryStore instance.
 * @returns MemoryRetrievalV2 instance
 */
export function createMemoryRetrievalV2(store: MemoryStore): MemoryRetrievalV2 {
	return new MemoryRetrievalV2(store);
}
