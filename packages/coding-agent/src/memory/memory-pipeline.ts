/**
 * Memory Pipeline - P11.L
 *
 * Unified memory ingestion, retrieval, provenance tracking, forbidden-source
 * blocking, confidence scoring, and compaction pipeline.
 *
 * The pipeline indexes data from three main sources:
 * - **plan** — Planner analysis results (batch plans, warnings, suggestions)
 * - **run** — Workspace execution results (success, failure, blocked)
 * - **proposal** — Proposal submission results with evidence
 * - **manual** — User-contributed memory
 *
 * Key features:
 * - Source provenance tracking on every entry
 * - Forbidden source filtering with counting
 * - Confidence-scored retrieval responses with source pointers
 * - Compaction that preserves provenance and marks superseded entries
 * - Optional backend integration with ExecutionMemory / PlannerMemory
 */

import { createHash, randomUUID } from "node:crypto";
import type { ExecutionMemory } from "./execution-memory.js";
import {
	type BlockedSourceSummary,
	type CompactionReport,
	type ConfidenceFactor,
	DEFAULT_MEMORY_PIPELINE_CONFIG,
	type ForbiddenSource,
	type MemoryIngestionInput,
	type MemoryPipelineConfig,
	type MemoryPipelineEntry,
	type MemoryRetrievalResponse,
	type MemoryRetrievalResult,
	type MemorySourceKind,
	type MemoryStatus,
	type SourceProvenance,
} from "./memory-types.js";
import type { PlannerMemory } from "./planner-memory.js";

// ---------------------------------------------------------------------------
// Pipeline Errors
// ---------------------------------------------------------------------------

/**
 * Error thrown when an operation fails due to a forbidden source.
 */
export class ForbiddenSourceError extends Error {
	constructor(
		message: string,
		public readonly source: ForbiddenSource,
	) {
		super(message);
		this.name = "ForbiddenSourceError";
	}
}

// ---------------------------------------------------------------------------
// Memory Pipeline
// ---------------------------------------------------------------------------

/**
 * Unified memory pipeline for indexing and retrieving execution, planner,
 * and proposal memories with full provenance tracking, forbidden-source
 * blocking, confidence scoring, and compaction.
 */
export class MemoryPipeline {
	private config: MemoryPipelineConfig;
	private entries: Map<string, MemoryPipelineEntry> = new Map();
	private disabled: boolean;

	/**
	 * Count of blocked sources (incremented each time a source is blocked).
	 * Keyed by forbidden source label.
	 */
	private blockedSourceCounts: Map<string, number> = new Map();

	/**
	 * Optional backends for interoperability with existing memory systems.
	 */
	private executionMemory?: ExecutionMemory;
	private plannerMemory?: PlannerMemory;

	constructor(
		config?: Partial<MemoryPipelineConfig>,
		executionMemory?: ExecutionMemory,
		plannerMemory?: PlannerMemory,
	) {
		this.config = {
			...DEFAULT_MEMORY_PIPELINE_CONFIG,
			...config,
			// Deep-clone array to prevent shared reference across instances
			forbiddenSources: [...(config?.forbiddenSources ?? DEFAULT_MEMORY_PIPELINE_CONFIG.forbiddenSources)],
		};
		this.disabled = !this.config.enabled;
		this.executionMemory = executionMemory;
		this.plannerMemory = plannerMemory;
	}

	// =======================================================================
	// Ingestion
	// =======================================================================

	/**
	 * Ingest a memory into the pipeline.
	 *
	 * Creates a MemoryPipelineEntry with provenance tracking, content hashing
	 * for deduplication, and all required metadata. Returns null if the
	 * pipeline is disabled or if a memory with the same content hash already
	 * exists (deduplication).
	 *
	 * @param input - Memory ingestion input
	 * @returns The created entry, or null if skipped
	 */
	async ingest(input: MemoryIngestionInput): Promise<MemoryPipelineEntry | null> {
		if (this.disabled) {
			return null;
		}

		// Content hash includes source info to allow same content from different sources
		const contentHash = this.hashContent(
			`${input.provenance.kind}:${input.provenance.sourceId}:${input.title}${input.content}`,
		);

		// Deduplication: skip if exact same content+source combo exists
		const existing = await this.findByContentHash(contentHash);
		if (existing) {
			return null;
		}

		const timestamp = input.provenance.timestamp || Date.now();

		const entry: MemoryPipelineEntry = {
			id: randomUUID(),
			provenance: {
				...input.provenance,
				sourceConfidence: input.provenance.sourceConfidence ?? 1.0,
			},
			createdAt: timestamp,
			updatedAt: timestamp,
			contentHash,
			title: input.title,
			content: input.content,
			keywords: input.keywords ?? this.extractKeywords(input.title, input.content),
			severity: input.severity ?? "medium",
			status: "active",
			supersededByIds: [],
			supersedesIds: [],
			executionEntry: input.executionEntry,
			plannerEntry: input.plannerEntry,
			metadata: input.metadata,
		};

		this.entries.set(entry.id, entry);

		// Optionally mirror to backend systems
		if (this.config.useExecutionMemoryBackend && this.executionMemory && input.executionEntry) {
			// Already stored via executionMemory; the entry is linked
		}
		if (this.config.usePlannerMemoryBackend && this.plannerMemory && input.plannerEntry) {
			// Already stored via plannerMemory; the entry is linked
		}

		return entry;
	}

	/**
	 * Ingest an execution memory entry into the pipeline.
	 *
	 * Convenience method that wraps an ExecutionMemoryEntry with provenance
	 * and adds it to the pipeline.
	 *
	 * @param entry - The execution memory entry to ingest
	 * @returns The pipeline entry, or null if skipped
	 */
	async ingestExecutionEntry(
		entry: import("./execution-memory.js").ExecutionMemoryEntry,
	): Promise<MemoryPipelineEntry | null> {
		return this.ingest({
			provenance: {
				kind: "run",
				sourceId: entry.workspaceId,
				description: `Workspace execution: ${entry.goal}`,
				sourcePointer: {
					workspaceId: entry.workspaceId,
					verdict: entry.verdict,
					filesModified: entry.filesModified,
				},
				timestamp: entry.timestamp,
			},
			title: entry.goal,
			content: entry.summary,
			keywords: [entry.goal, ...entry.acceptanceCriteria],
			severity: entry.isFailure ? "high" : "medium",
			executionEntry: entry,
		});
	}

	/**
	 * Ingest a planner memory entry into the pipeline.
	 *
	 * Convenience method that wraps a PlannerMemoryEntry with provenance
	 * and adds it to the pipeline.
	 *
	 * @param entry - The planner memory entry to ingest
	 * @returns The pipeline entry, or null if skipped
	 */
	async ingestPlannerEntry(
		entry: import("./planner-memory.js").PlannerMemoryEntry,
	): Promise<MemoryPipelineEntry | null> {
		return this.ingest({
			provenance: {
				kind: "plan",
				sourceId: entry.phase,
				description: `Plan: ${entry.title} (${entry.phase})`,
				sourcePointer: {
					phase: entry.phase,
					title: entry.title,
					workspaceCount: entry.workspaceCount,
					totalBatches: entry.totalBatches,
					queueOutcome: entry.queueOutcome,
				},
				timestamp: entry.timestamp,
			},
			title: entry.title,
			content: entry.summaryText,
			keywords: [entry.phase, entry.title, ...entry.warningTypes, ...entry.suggestionTypes],
			severity: entry.hadWarnings ? "high" : "medium",
			plannerEntry: entry,
		});
	}

	/**
	 * Ingest a proposal as a memory entry.
	 *
	 * @param proposalId - Proposal identifier
	 * @param proposalTitle - Proposal title
	 * @param description - Proposal description / content
	 * @param keywords - Optional keywords for retrieval
	 * @param metadata - Optional metadata
	 * @returns The pipeline entry, or null if skipped
	 */
	async ingestProposal(
		proposalId: string,
		proposalTitle: string,
		description: string,
		keywords?: string[],
		metadata?: Record<string, unknown>,
	): Promise<MemoryPipelineEntry | null> {
		return this.ingest({
			provenance: {
				kind: "proposal",
				sourceId: proposalId,
				description: `Proposal: ${proposalTitle}`,
				sourcePointer: {
					proposalId,
					title: proposalTitle,
				},
				timestamp: Date.now(),
			},
			title: proposalTitle,
			content: description,
			keywords: keywords ?? [proposalTitle],
			severity: "medium",
			metadata,
		});
	}

	// =======================================================================
	// Retrieval
	// =======================================================================

	/**
	 * Retrieve memories relevant to a query.
	 *
	 * Searches the pipeline for entries that match the given query text,
	 * filters out forbidden sources, scores results by confidence, and
	 * returns a response with source pointers and blocked source counts.
	 *
	 * @param query - Free-text search query
	 * @param filterByKind - Optional source kind filter
	 * @param filterByStatus - Optional status filter (default: active only)
	 * @param maxResults - Override max results count
	 * @returns Retrieval response with results and blocked source summary
	 */
	async retrieve(
		query: string,
		filterByKind?: MemorySourceKind,
		filterByStatus?: MemoryStatus,
		maxResults?: number,
	): Promise<MemoryRetrievalResponse> {
		const startTime = Date.now();

		if (this.disabled) {
			return {
				results: [],
				blocked: { count: 0, blocked: [] },
				totalCandidates: 0,
				retrievalTimeMs: Date.now() - startTime,
			};
		}

		const limit = maxResults ?? this.config.maxResults;
		const statusFilter = filterByStatus ?? "active";

		// Empty query returns no results
		if (!query || query.trim().length === 0) {
			return {
				results: [],
				blocked: { count: 0, blocked: [] },
				totalCandidates: 0,
				retrievalTimeMs: Date.now() - startTime,
			};
		}

		// Gather all entries matching status filter
		let candidates = Array.from(this.entries.values()).filter((e) => e.status === statusFilter);

		// Apply source kind filter if specified
		if (filterByKind) {
			candidates = candidates.filter((e) => e.provenance.kind === filterByKind);
		}

		const totalCandidates = candidates.length;

		// Apply forbidden source filtering
		const blockedEntries: BlockedSourceSummary["blocked"] = [];

		const allowedCandidates = candidates.filter((entry) => {
			const forbidden = this.findForbiddenSource(entry.provenance);
			if (forbidden) {
				this.incrementBlockedCount(entry.provenance);
				blockedEntries.push({
					label: forbidden.label,
					sourceId: entry.provenance.sourceId,
					reason: forbidden.reason,
				});
				return false;
			}
			return true;
		});

		// Score each allowed candidate for relevance
		const scored = allowedCandidates
			.map((entry) => this.scoreRelevance(entry, query))
			.filter((r) => r.confidence >= this.config.minConfidence)
			.sort((a, b) => b.confidence - a.confidence)
			.slice(0, limit);

		return {
			results: scored,
			blocked: {
				count: blockedEntries.length,
				blocked: blockedEntries,
			},
			totalCandidates,
			retrievalTimeMs: Date.now() - startTime,
		};
	}

	/**
	 * Get all entries in the pipeline.
	 *
	 * @param filterByStatus - Optional status filter
	 * @returns Array of pipeline entries
	 */
	async getAll(filterByStatus?: MemoryStatus): Promise<MemoryPipelineEntry[]> {
		if (this.disabled) {
			return [];
		}

		const all = Array.from(this.entries.values());
		if (filterByStatus) {
			return all.filter((e) => e.status === filterByStatus).sort((a, b) => b.createdAt - a.createdAt);
		}
		return all.sort((a, b) => b.createdAt - a.createdAt);
	}

	/**
	 * Get an entry by its ID.
	 *
	 * @param id - Entry ID
	 * @returns The entry, or null if not found
	 */
	async getById(id: string): Promise<MemoryPipelineEntry | null> {
		return this.entries.get(id) ?? null;
	}

	/**
	 * Get the provenance information for an entry.
	 *
	 * @param id - Entry ID
	 * @returns Provenance info, or null if not found
	 */
	async getProvenance(id: string): Promise<SourceProvenance | null> {
		const entry = this.entries.get(id);
		return entry ? { ...entry.provenance } : null;
	}

	// =======================================================================
	// Forbidden Source Management
	// =======================================================================

	/**
	 * Add a forbidden source pattern to the pipeline.
	 *
	 * Once added, any attempt to retrieve memories matching this source
	 * will be blocked and counted.
	 *
	 * @param source - The forbidden source definition
	 */
	addForbiddenSource(source: ForbiddenSource): void {
		// Check for duplicates by label
		const existing = this.config.forbiddenSources.findIndex((s) => s.label === source.label);
		if (existing >= 0) {
			this.config.forbiddenSources[existing] = source;
		} else {
			this.config.forbiddenSources.push(source);
		}
	}

	/**
	 * Remove a forbidden source by its label.
	 *
	 * @param label - The label of the forbidden source to remove
	 * @returns True if removed, false if not found
	 */
	removeForbiddenSource(label: string): boolean {
		const index = this.config.forbiddenSources.findIndex((s) => s.label === label);
		if (index >= 0) {
			this.config.forbiddenSources.splice(index, 1);
			return true;
		}
		return false;
	}

	/**
	 * Get the current list of forbidden sources.
	 *
	 * @returns A copy of the forbidden sources list
	 */
	getForbiddenSources(): ForbiddenSource[] {
		return [...this.config.forbiddenSources];
	}

	/**
	 * Get the count of blocked retrievals for each forbidden source.
	 *
	 * @returns Map of forbidden source label -> block count
	 */
	getBlockedSourceCounts(): Map<string, number> {
		return new Map(this.blockedSourceCounts);
	}

	/**
	 * Reset all blocked source counters to zero.
	 */
	resetBlockedSourceCounts(): void {
		this.blockedSourceCounts.clear();
	}

	// =======================================================================
	// Compaction
	// =======================================================================

	/**
	 * Run compaction on the pipeline.
	 *
	 * Compaction preserves provenance while cleaning up old, superseded,
	 * or irrelevant entries. The algorithm:
	 *
	 * 1. Entries older than maxEntryAgeMs are marked as "archived" (status
	 *    changes but provenance and metadata are preserved).
	 * 2. For entries with the same content hash, the oldest is marked as
	 *    superseded by the newest (the superseded entry's supersededByIds
	 *    is set, and the new entry's supersedesIds is set).
	 * 3. Entries with low confidence sources (sourceConfidence < 0.3) that
	 *    have newer active entries on the same topic are archived.
	 * 4. Provenance data is always preserved on all entries regardless of
	 *    status change.
	 *
	 * @param forceArchivalOlderThanMs - Override max entry age for archival
	 * @returns Report of what was compacted and preserved
	 */
	async compact(forceArchivalOlderThanMs?: number): Promise<CompactionReport> {
		const compacted: CompactionReport["compacted"] = [];
		const preserved: CompactionReport["preserved"] = [];
		const now = Date.now();
		const ageLimit = forceArchivalOlderThanMs ?? this.config.maxEntryAgeMs;

		const allEntries = Array.from(this.entries.values());
		const totalBefore = allEntries.length;

		// Phase 1: Archive entries older than the age limit
		for (const entry of allEntries) {
			if (entry.status !== "active") continue;

			const age = now - entry.createdAt;
			if (age > ageLimit) {
				entry.status = "archived";
				entry.updatedAt = now;
				// Provenance is preserved (we keep the full provenance object)
				compacted.push({
					entryId: entry.id,
					title: entry.title,
					reason: `Entry is ${formatDuration(age)} old (max ${formatDuration(ageLimit)})`,
				});
			} else {
				preserved.push({
					entryId: entry.id,
					title: entry.title,
					provenance: entry.provenance,
				});
			}
		}

		// Phase 2: Mark superseded entries (same content hash, keep newest)
		const byContentHash = new Map<string, MemoryPipelineEntry[]>();
		for (const entry of this.entries.values()) {
			if (entry.status === "archived") continue;
			const existing = byContentHash.get(entry.contentHash) ?? [];
			existing.push(entry);
			byContentHash.set(entry.contentHash, existing);
		}

		for (const [, group] of byContentHash) {
			if (group.length <= 1) continue;

			// Sort by createdAt (newest first)
			group.sort((a, b) => b.createdAt - a.createdAt);

			// The newest entry stays active; all older are superseded
			const newest = group[0];
			for (let i = 1; i < group.length; i++) {
				const older = group[i];
				if (older.status !== "active") continue;

				older.status = "superseded";
				older.supersededByIds.push(newest.id);
				older.updatedAt = now;

				newest.supersedesIds.push(older.id);

				compacted.push({
					entryId: older.id,
					title: older.title,
					reason: `Superseded by newer entry ${newest.id} (same content)`,
				});
			}

			// Ensure newest is in preserved (if not already)
			if (!preserved.find((p) => p.entryId === newest.id) && newest.status === "active") {
				preserved.push({
					entryId: newest.id,
					title: newest.title,
					provenance: newest.provenance,
				});
			}
		}

		// Phase 3: Archive low-confidence sources with newer active replacements
		for (const entry of allEntries) {
			if (entry.status !== "active") continue;

			const sourceConfidence = entry.provenance.sourceConfidence ?? 1.0;
			if (sourceConfidence >= 0.3) continue;

			// Check if there's a newer active entry on a similar topic
			const newerSimilar = allEntries.find(
				(e) =>
					e.id !== entry.id &&
					e.status === "active" &&
					e.createdAt > entry.createdAt &&
					this.hasKeywordOverlap(e.keywords, entry.keywords),
			);

			if (newerSimilar) {
				entry.status = "archived";
				entry.updatedAt = now;

				compacted.push({
					entryId: entry.id,
					title: entry.title,
					reason: `Archived: low source confidence (${sourceConfidence}) superseded by ${newerSimilar.title}`,
				});
			}
		}

		// Recompute preserved list (final pass)
		const finalPreserved: CompactionReport["preserved"] = [];
		for (const entry of this.entries.values()) {
			if (entry.status === "active") {
				finalPreserved.push({
					entryId: entry.id,
					title: entry.title,
					provenance: { ...entry.provenance },
				});
			}
		}

		const totalAfter = Array.from(this.entries.values()).length;
		const superseded = Array.from(this.entries.values()).filter((e) => e.status === "superseded").length;
		const archived = Array.from(this.entries.values()).filter((e) => e.status === "archived").length;
		const activeKept = Array.from(this.entries.values()).filter((e) => e.status === "active").length;

		return {
			compacted: [...compacted],
			preserved: finalPreserved,
			stats: {
				totalBefore,
				totalAfter,
				superseded,
				archived,
				activeKept,
			},
		};
	}

	// =======================================================================
	// Pipeline Management
	// =======================================================================

	/**
	 * Get the number of entries in the pipeline.
	 *
	 * @param filterByStatus - Optional status filter
	 * @returns Entry count
	 */
	async count(filterByStatus?: MemoryStatus): Promise<number> {
		if (this.disabled) {
			return 0;
		}
		if (filterByStatus) {
			return Array.from(this.entries.values()).filter((e) => e.status === filterByStatus).length;
		}
		return this.entries.size;
	}

	/**
	 * Clear all entries from the pipeline.
	 */
	async clear(): Promise<void> {
		this.entries.clear();
		this.blockedSourceCounts.clear();
	}

	/**
	 * Disable the pipeline. All operations become no-ops.
	 */
	disable(): void {
		this.disabled = true;
	}

	/**
	 * Enable the pipeline.
	 */
	enable(): void {
		this.disabled = false;
	}

	/**
	 * Check whether the pipeline is currently enabled.
	 */
	isEnabled(): boolean {
		return !this.disabled;
	}

	/**
	 * Get a copy of the current configuration.
	 */
	getConfig(): MemoryPipelineConfig {
		return { ...this.config, forbiddenSources: [...this.config.forbiddenSources] };
	}

	// =======================================================================
	// Private: Forbidden Source Matching
	// =======================================================================

	/**
	 * Check if a provenance matches any forbidden source pattern.
	 * If it does, increment the block counter and return the matching ForbiddenSource.
	 */
	private findForbiddenSource(provenance: SourceProvenance): ForbiddenSource | null {
		for (const forbidden of this.config.forbiddenSources) {
			if (forbidden.kind !== "*" && forbidden.kind !== provenance.kind) {
				continue;
			}

			const sourceMatches = this.patternMatch(forbidden.sourceIdPattern, provenance.sourceId);
			if (!sourceMatches) {
				continue;
			}

			// If a descriptionPattern is specified, it must also match (AND logic)
			if (forbidden.descriptionPattern) {
				if (!this.patternMatch(forbidden.descriptionPattern, provenance.description)) {
					continue;
				}
			}

			return forbidden;
		}
		return null;
	}

	/**
	 * Increment the blocked count for a forbidden source.
	 */
	private incrementBlockedCount(provenance: SourceProvenance): void {
		const forbidden = this.findForbiddenSource(provenance);
		if (forbidden) {
			const current = this.blockedSourceCounts.get(forbidden.label) ?? 0;
			this.blockedSourceCounts.set(forbidden.label, current + 1);
		}
	}

	/**
	 * Simple glob-like pattern matching.
	 * Supports '*' (any sequence) and '?' (any single char).
	 */
	private patternMatch(pattern: string, value: string): boolean {
		// Convert glob pattern to regex
		const regexStr =
			"^" +
			pattern
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, ".*")
				.replace(/\?/g, ".") +
			"$";

		try {
			return new RegExp(regexStr, "i").test(value);
		} catch {
			return pattern === value;
		}
	}

	// =======================================================================
	// Private: Relevance Scoring
	// =======================================================================

	/**
	 * Compute a confidence score (0-1) between a pipeline entry and a query.
	 *
	 * Combines multiple factors:
	 * - Keyword overlap (0-0.5): Shared significant terms between query and entry
	 * - Recency (0-0.2): Newer entries get higher recency scores
	 * - Severity bonus (0-0.2): Critical and high-severity entries get a bonus
	 * - Source confidence (0-0.1): How reliable the source is
	 *
	 * @returns A MemoryRetrievalResult with confidence breakdown
	 */
	private scoreRelevance(entry: MemoryPipelineEntry, query: string): MemoryRetrievalResult {
		const factors: ConfidenceFactor[] = [];

		// Factor 1: Keyword overlap (0-0.5) — this is the primary signal
		const queryTokens = this.tokenize(query);
		const entryTokens = new Set([
			...this.tokenize(entry.title),
			...this.tokenize(entry.content),
			...entry.keywords.flatMap((k) => this.tokenize(k)),
		]);

		let keywordScore = 0;
		if (queryTokens.size > 0 && entryTokens.size > 0) {
			let matches = 0;
			for (const token of queryTokens) {
				if (entryTokens.has(token)) {
					matches++;
				}
			}
			keywordScore = (matches / queryTokens.size) * 0.5;
		}

		// Keyword overlap is a prerequisite — without any match the entry is not relevant
		if (keywordScore === 0 && queryTokens.size > 0) {
			return {
				entry,
				confidence: 0,
				provenance: entry.provenance,
				sourcePointer: entry.provenance.sourcePointer,
				confidenceFactors: [
					{
						factor: "keyword_match",
						weight: 0,
						explanation: "No query keywords matched this entry",
					},
				],
			};
		}

		factors.push({
			factor: "keyword_match",
			weight: keywordScore,
			explanation: `${Math.round((keywordScore / 0.5) * 100)}% of query keywords matched`,
		});

		// Factor 2: Recency (0-0.2)
		const age = Date.now() - entry.createdAt;
		const maxRelevanceAge = this.config.maxEntryAgeMs;
		const recencyScore = Math.max(0, 1 - age / maxRelevanceAge) * 0.2;

		factors.push({
			factor: "recency",
			weight: recencyScore,
			explanation: `Entry is ${formatDuration(age)} old`,
		});

		// Factor 3: Severity bonus (0-0.2)
		let severityScore = 0;
		switch (entry.severity) {
			case "critical":
				severityScore = 0.2;
				break;
			case "high":
				severityScore = 0.15;
				break;
			case "medium":
				severityScore = 0.1;
				break;
			case "low":
				severityScore = 0.05;
				break;
			case "info":
				severityScore = 0;
				break;
		}

		factors.push({
			factor: "severity",
			weight: severityScore,
			explanation: `Severity: ${entry.severity}`,
		});

		// Factor 4: Source confidence (0-0.1)
		const sourceConfidenceWeight = (entry.provenance.sourceConfidence ?? 1.0) * 0.1;

		factors.push({
			factor: "source_confidence",
			weight: sourceConfidenceWeight,
			explanation: `Source confidence: ${entry.provenance.sourceConfidence ?? 1.0}`,
		});

		// Total confidence (sum of all factors, capped at 1.0)
		const totalConfidence = Math.min(1.0, keywordScore + recencyScore + severityScore + sourceConfidenceWeight);

		return {
			entry,
			confidence: totalConfidence,
			provenance: entry.provenance,
			sourcePointer: entry.provenance.sourcePointer,
			confidenceFactors: factors,
		};
	}

	// =======================================================================
	// Private: Helpers
	// =======================================================================

	/**
	 * Compute a SHA-256 content hash for deduplication.
	 */
	private hashContent(content: string): string {
		return createHash("sha256").update(content).digest("hex").slice(0, 16);
	}

	/**
	 * Find an entry by its content hash.
	 */
	private async findByContentHash(hash: string): Promise<MemoryPipelineEntry | undefined> {
		for (const entry of this.entries.values()) {
			if (entry.contentHash === hash) {
				return entry;
			}
		}
		return undefined;
	}

	/**
	 * Extract significant keywords from title and content.
	 */
	private extractKeywords(title: string, content: string): string[] {
		const tokens = this.tokenize(`${title} ${content}`);
		return Array.from(tokens);
	}

	/**
	 * Tokenize text into lowercase keyword tokens for matching.
	 */
	private tokenize(text: string): Set<string> {
		const stopWords = new Set([
			"the",
			"a",
			"an",
			"is",
			"are",
			"was",
			"were",
			"be",
			"been",
			"being",
			"have",
			"has",
			"had",
			"do",
			"does",
			"did",
			"will",
			"would",
			"could",
			"should",
			"may",
			"might",
			"shall",
			"can",
			"to",
			"of",
			"in",
			"for",
			"on",
			"with",
			"at",
			"by",
			"from",
			"and",
			"or",
			"but",
			"not",
			"no",
			"nor",
			"so",
			"if",
			"as",
			"this",
			"that",
			"these",
			"those",
			"it",
			"its",
			"my",
			"your",
			"our",
			"their",
			"his",
			"her",
			"all",
			"each",
			"every",
			"both",
			"more",
			"some",
			"any",
			"about",
			"into",
			"over",
			"after",
			"before",
			"between",
			"under",
			"above",
			"below",
			"up",
			"down",
			"out",
			"off",
			"than",
			"then",
			"once",
			"here",
			"there",
			"also",
			"just",
			"very",
			"too",
			"now",
			"other",
			"such",
			"only",
			"own",
			"same",
			"so",
			"than",
			"too",
			"very",
			"just",
			"because",
			"but",
			"and",
			"or",
			"for",
			"nor",
			"yet",
			"so",
			"although",
			"while",
			"when",
			"where",
			"how",
			"what",
			"which",
			"who",
		]);

		const words = text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length >= 3 && !stopWords.has(w));

		return new Set(words);
	}

	/**
	 * Check if two keyword arrays have a significant overlap.
	 */
	private hasKeywordOverlap(a: string[], b: string[]): boolean {
		const setB = new Set(b.map((k) => k.toLowerCase()));
		let matches = 0;
		for (const kw of a) {
			if (setB.has(kw.toLowerCase())) {
				matches++;
			}
		}
		// At least 30% overlap or at least 1 match
		return matches > 0 && matches / Math.max(a.length, 1) >= 0.3;
	}
}

// ===========================================================================
// Utility Functions
// ===========================================================================

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

/**
 * Create a MemoryPipeline instance with default settings.
 *
 * @param config - Optional configuration overrides
 * @param executionMemory - Optional execution memory backend
 * @param plannerMemory - Optional planner memory backend
 * @returns A new MemoryPipeline instance
 */
export function createMemoryPipeline(
	config?: Partial<MemoryPipelineConfig>,
	executionMemory?: ExecutionMemory,
	plannerMemory?: PlannerMemory,
): MemoryPipeline {
	return new MemoryPipeline(config, executionMemory, plannerMemory);
}
