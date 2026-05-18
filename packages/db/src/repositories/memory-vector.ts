/**
 * Memory Vector Repository (P11.F)
 *
 * Provides CRUD operations and semantic search for the organic vector memory store.
 * Supports querying by project, plan, workspace, capability, and semantic relevance.
 *
 * The repository handles vector similarity search when the pgvector extension is
 * available, and falls back to keyword-based text matching when it is not.
 */

import { type Kysely, sql } from "kysely";
import { generateId, now } from "../helpers.js";
import type { Database, MemoryVector, MemoryVectorUpdate, NewMemoryVector } from "../types.js";

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

/**
 * Options for querying memory vectors.
 */
export interface MemoryVectorQuery {
	/** Filter by project ID (required for all queries) */
	projectId: string;
	/** Optional filter by plan execution ID */
	planExecutionId?: string;
	/** Optional filter by workspace ID */
	workspaceId?: string;
	/** Optional filter by capability */
	capability?: string;
	/** Optional safety classification filter */
	safetyClassification?: string;
	/** Optional search query for semantic relevance */
	searchQuery?: string;
	/** Optional embedding vector for similarity search (number array) */
	embedding?: number[];
	/** Maximum results (default: 20) */
	limit?: number;
	/** Offset for pagination (default: 0) */
	offset?: number;
}

/**
 * Result from a memory vector query with relevance scoring.
 */
export interface MemoryVectorSearchResult {
	memory: MemoryVector;
	/** Relevance score (0-1) from vector similarity or keyword matching */
	relevanceScore: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Repository for managing memory vector records with semantic search.
 */
export class MemoryVectorRepository {
	private db: Kysely<Database>;
	private hasVectorExtension: boolean | null;

	constructor(db: Kysely<Database>) {
		this.db = db;
		this.hasVectorExtension = null;
	}

	// -----------------------------------------------------------------------
	// Schema detection
	// -----------------------------------------------------------------------

	/**
	 * Check whether the pgvector extension is available in the database.
	 */
	private async checkVectorExtension(): Promise<boolean> {
		if (this.hasVectorExtension !== null) {
			return this.hasVectorExtension;
		}

		try {
			const result = await sql<{ name: string }>`
				SELECT extname AS name FROM pg_extension WHERE extname = 'vector'
			`.execute(this.db);
			this.hasVectorExtension = result.rows.length > 0;
		} catch {
			this.hasVectorExtension = false;
		}

		return this.hasVectorExtension;
	}

	// -----------------------------------------------------------------------
	// CRUD operations
	// -----------------------------------------------------------------------

	/**
	 * Create a new memory vector record.
	 *
	 * @param data - Memory vector data
	 * @returns The created memory vector
	 */
	async create(data: Omit<NewMemoryVector, "id" | "created_at" | "updated_at">): Promise<MemoryVector> {
		const id = generateId();
		const timestamp = now();

		const result = await this.db
			.insertInto("memory_vectors")
			.values({
				id,
				project_id: data.project_id,
				plan_execution_id: data.plan_execution_id ?? null,
				workspace_id: data.workspace_id ?? null,
				capability: data.capability ?? null,
				content: data.content,
				content_hash: data.content_hash,
				embedding: data.embedding ?? null,
				embedding_model: data.embedding_model ?? null,
				source_pointer: (data.source_pointer ?? {}) as any,
				freshness: data.freshness ?? timestamp,
				safety_classification: data.safety_classification ?? "safe",
				metadata: (data.metadata ?? null) as any,
				created_at: timestamp,
				updated_at: timestamp,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		return result;
	}

	/**
	 * Find a memory vector by ID.
	 *
	 * @param id - Memory vector ID
	 * @returns The memory vector, or null if not found
	 */
	async findById(id: string): Promise<MemoryVector | null> {
		const result = await this.db.selectFrom("memory_vectors").selectAll().where("id", "=", id).executeTakeFirst();

		return result ?? null;
	}

	/**
	 * Find memory vectors by content hash (for deduplication).
	 *
	 * @param projectId - Project ID
	 * @param contentHash - Content hash to search for
	 * @returns Matching memory vectors
	 */
	async findByContentHash(projectId: string, contentHash: string): Promise<MemoryVector[]> {
		return await this.db
			.selectFrom("memory_vectors")
			.selectAll()
			.where("project_id", "=", projectId)
			.where("content_hash", "=", contentHash)
			.execute();
	}

	/**
	 * Update a memory vector record.
	 *
	 * @param id - Memory vector ID
	 * @param data - Fields to update
	 * @returns The updated memory vector
	 */
	async update(id: string, data: MemoryVectorUpdate): Promise<MemoryVector | null> {
		const timestamp = now();

		const result = await this.db
			.updateTable("memory_vectors")
			.set({
				...data,
				updated_at: timestamp,
			})
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();

		return result ?? null;
	}

	/**
	 * Touch freshness timestamp for a memory vector.
	 *
	 * @param id - Memory vector ID
	 * @param freshness - Optional new freshness timestamp (defaults to now)
	 * @returns The updated memory vector
	 */
	async refreshFreshness(id: string, freshness?: string): Promise<MemoryVector | null> {
		return this.update(id, {
			freshness: freshness ?? now(),
		});
	}

	/**
	 * Delete a memory vector by ID.
	 *
	 * @param id - Memory vector ID
	 */
	async deleteById(id: string): Promise<void> {
		await this.db.deleteFrom("memory_vectors").where("id", "=", id).execute();
	}

	/**
	 * Delete stale memory vectors older than a given timestamp.
	 *
	 * @param olderThan - ISO timestamp; memory older than this is deleted
	 * @returns Number of deleted records
	 */
	async deleteStale(olderThan: string): Promise<number> {
		const result = await sql<{ deleted: bigint }>`
			WITH deleted AS (
				DELETE FROM memory_vectors WHERE freshness < ${olderThan}::timestamptz
				RETURNING 1
			)
			SELECT COUNT(*)::bigint AS deleted FROM deleted
		`.execute(this.db);

		return Number(result.rows[0]?.deleted ?? 0);
	}

	/**
	 * Count memory vectors matching optional filters.
	 *
	 * @param projectId - Project ID
	 * @param options - Optional filters
	 * @returns Count of matching records
	 */
	async count(
		projectId: string,
		options?: {
			capability?: string;
			safetyClassification?: string;
		},
	): Promise<number> {
		let query = this.db
			.selectFrom("memory_vectors")
			.select(this.db.fn.countAll<number>().as("count"))
			.where("project_id", "=", projectId);

		if (options?.capability) {
			query = query.where("capability", "=", options.capability);
		}
		if (options?.safetyClassification) {
			query = query.where("safety_classification", "=", options.safetyClassification);
		}

		const result = await query.executeTakeFirstOrThrow();
		return Number(result.count);
	}

	// -----------------------------------------------------------------------
	// Query operations
	// -----------------------------------------------------------------------

	/**
	 * Query memory vectors by project, plan, workspace, and/or capability.
	 *
	 * Supports filtering by any combination of the above dimensions, plus
	 * optional semantic relevance search.
	 *
	 * When an embedding vector is provided AND pgvector is available, results
	 * are sorted by vector similarity (highest first). When a text search
	 * query is provided, results are sorted by keyword relevance. Otherwise,
	 * results are sorted by freshness (newest first).
	 *
	 * @param queryParams - Query parameters
	 * @returns Array of memory vectors with relevance scores
	 */
	async query(queryParams: MemoryVectorQuery): Promise<MemoryVectorSearchResult[]> {
		const {
			projectId,
			planExecutionId,
			workspaceId,
			capability,
			safetyClassification,
			searchQuery,
			embedding,
			limit = 20,
			offset = 0,
		} = queryParams;

		// If we have an embedding AND pgvector is available, use dedicated vector path
		if (embedding && embedding.length > 0 && (await this.checkVectorExtension())) {
			return this.vectorSearch(
				projectId,
				planExecutionId,
				workspaceId,
				capability,
				safetyClassification,
				embedding,
				limit,
				offset,
			);
		}

		// Build a Kysely query with all filters
		let query = this.db.selectFrom("memory_vectors").selectAll().where("project_id", "=", projectId);

		if (planExecutionId) {
			query = query.where("plan_execution_id", "=", planExecutionId);
		}
		if (workspaceId) {
			query = query.where("workspace_id", "=", workspaceId);
		}
		if (capability) {
			query = query.where("capability", "=", capability);
		}
		if (safetyClassification) {
			query = query.where("safety_classification", "=", safetyClassification);
		}

		// Text search with keyword relevance
		if (searchQuery && searchQuery.trim().length > 0) {
			// Get all matching rows with full-text search filter
			const results = await query
				.where(sql<boolean>`to_tsvector('english', content) @@ plainto_tsquery('english', ${searchQuery})`)
				.execute();

			// Score each result by keyword overlap
			const queryTokens = this.tokenize(searchQuery);
			const scored = results.map((row) => ({
				memory: row,
				relevanceScore: this.computeRelevance(row.content, queryTokens),
			}));

			scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
			return scored.slice(offset, offset + limit);
		}

		// No search — return results ordered by freshness
		const results = await query.orderBy("freshness", "desc").limit(limit).offset(offset).execute();

		return results.map((row) => ({
			memory: row,
			relevanceScore: 1.0,
		}));
	}

	/**
	 * Perform vector similarity search using pgvector cosine distance.
	 */
	private async vectorSearch(
		projectId: string,
		planExecutionId: string | undefined,
		workspaceId: string | undefined,
		capability: string | undefined,
		safetyClassification: string | undefined,
		embedding: number[],
		limit: number,
		offset: number,
	): Promise<MemoryVectorSearchResult[]> {
		const embeddingStr = `[${embedding.join(",")}]`;
		const conditions: string[] = [`project_id = '${projectId.replace(/'/g, "''")}'`];

		if (planExecutionId) {
			conditions.push(`plan_execution_id = '${planExecutionId.replace(/'/g, "''")}'`);
		}
		if (workspaceId) {
			conditions.push(`workspace_id = '${workspaceId.replace(/'/g, "''")}'`);
		}
		if (capability) {
			conditions.push(`capability = '${capability.replace(/'/g, "''")}'`);
		}
		if (safetyClassification) {
			conditions.push(`safety_classification = '${safetyClassification.replace(/'/g, "''")}'`);
		}

		const whereClause = conditions.join(" AND ");

		const results = await sql<Record<string, any>>`
			SELECT *,
				1 - (embedding <=> ${sql.raw(embeddingStr)}::vector) AS similarity
			FROM memory_vectors
			WHERE ${sql.raw(whereClause)}
			ORDER BY similarity DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`.execute(this.db);

		return results.rows.map((row) => {
			const { similarity, ...memoryData } = row;
			return {
				memory: memoryData as unknown as MemoryVector,
				relevanceScore: Math.max(0, Math.min(1, Number(similarity))),
			};
		});
	}

	// -----------------------------------------------------------------------
	// Provenance operations
	// -----------------------------------------------------------------------

	/**
	 * Get memory vectors by source pointer.
	 *
	 * @param projectId - Project ID
	 * @param sourcePath - Source file path
	 * @returns Matching memory vectors
	 */
	async findBySourcePointer(projectId: string, sourcePath: string): Promise<MemoryVector[]> {
		return (await this.db
			.selectFrom("memory_vectors")
			.selectAll()
			.where("project_id", "=", projectId)
			.where(sql<boolean>`source_pointer->>'path' = ${sourcePath}`)
			.orderBy("freshness", "desc")
			.execute()) as unknown as MemoryVector[];
	}

	/**
	 * Get provenance summary for a memory vector.
	 *
	 * @param id - Memory vector ID
	 * @returns Provenance info or null if not found
	 */
	async getProvenance(id: string): Promise<{
		id: string;
		projectId: string;
		sourcePointer: Record<string, unknown>;
		createdAt: string;
		freshness: string;
		ageMs: number;
	} | null> {
		const memory = await this.findById(id);
		if (!memory) {
			return null;
		}

		return {
			id: memory.id,
			projectId: memory.project_id,
			sourcePointer: memory.source_pointer as Record<string, unknown>,
			createdAt: memory.created_at,
			freshness: memory.freshness,
			ageMs: Date.now() - new Date(memory.freshness).getTime(),
		};
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Tokenize text into lowercase keyword tokens.
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
		]);

		const words = text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length >= 3 && !stopWords.has(w));

		return new Set(words);
	}

	/**
	 * Compute a relevance score based on keyword overlap.
	 */
	private computeRelevance(content: string, queryTokens: Set<string>): number {
		if (queryTokens.size === 0) {
			return 0;
		}

		const contentTokens = this.tokenize(content);
		if (contentTokens.size === 0) {
			return 0;
		}

		let matches = 0;
		for (const token of queryTokens) {
			if (contentTokens.has(token)) {
				matches++;
			}
		}

		return matches / queryTokens.size;
	}
}
