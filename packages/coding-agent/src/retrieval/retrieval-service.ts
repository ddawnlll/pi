/**
 * Retrieval Service - P1 Workstream 5.5.D
 *
 * Orchestrates retrieval operations across the local repo index.
 * Provides a higher-level interface for querying code context
 * with token budget enforcement and reason logging.
 */

import { PiLogger } from "../utils/logger.js";
import {
	LocalRepoIndex,
	type LocalRepoIndexConfig,
	type RetrievalQuery,
	type RetrievalResult,
} from "./local-repo-index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for the retrieval service
 */
export interface RetrievalServiceOptions {
	/** Root directory of the repository to index */
	rootDir: string;
	/** Maximum tokens for retrieval output (default: 4000) */
	defaultMaxTokens?: number;
	/** Maximum snippets per query (default: 20) */
	defaultMaxSnippets?: number;
	/** Additional forbidden file patterns */
	forbiddenPatterns?: string[];
}

/**
 * Retrieval service for querying repository context
 */
export interface RetrievalService {
	/**
	 * Query the repository for relevant code snippets.
	 *
	 * @param query - Free-text query
	 * @param options - Optional query overrides
	 * @returns Retrieval result with snippets
	 */
	query(query: string, options?: Partial<RetrievalQuery>): RetrievalResult;

	/**
	 * Get stats about the indexed repository
	 */
	getStats(): RetrievalStats;

	/**
	 * Get the underlying index for direct access
	 */
	getIndex(): LocalRepoIndex;

	/**
	 * Re-index the repository (force refresh)
	 */
	reindex(): void;
}

/**
 * Stats about the indexed repository
 */
export interface RetrievalStats {
	/** Number of indexed files */
	fileCount: number;
	/** Total estimated tokens */
	totalTokens: number;
	/** Root directory being indexed */
	rootDir: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const log = new PiLogger({ module: "retrieval-service" });

const DEFAULT_OPTIONS: Required<Pick<RetrievalServiceOptions, "defaultMaxTokens" | "defaultMaxSnippets">> = {
	defaultMaxTokens: 4000,
	defaultMaxSnippets: 20,
};

/**
 * Create a retrieval service for querying repository context.
 *
 * The service wraps a LocalRepoIndex and provides convenience methods
 * for querying with sensible defaults.
 *
 * @param options - Service configuration
 * @returns RetrievalService instance
 */
export function createRetrievalService(options: RetrievalServiceOptions): RetrievalService {
	const { rootDir, defaultMaxTokens, defaultMaxSnippets } = {
		...DEFAULT_OPTIONS,
		...options,
	};

	const indexConfig: LocalRepoIndexConfig = {
		rootDir,
	};

	const index = new LocalRepoIndex(indexConfig);

	// Auto-index on creation
	index.index();

	const service: RetrievalService = {
		query(queryText: string, queryOptions?: Partial<RetrievalQuery>): RetrievalResult {
			const maxTokens = queryOptions?.maxTokens ?? defaultMaxTokens;
			const maxSnippets = queryOptions?.maxSnippets ?? defaultMaxSnippets;

			const query: RetrievalQuery = {
				query: queryText,
				maxTokens,
				maxSnippets,
				allowedFiles: queryOptions?.allowedFiles,
				forbiddenFiles: [...(options.forbiddenPatterns ?? []), ...(queryOptions?.forbiddenFiles ?? [])],
			};

			log.info(`Query: "${queryText}" (maxTokens=${maxTokens}, maxSnippets=${maxSnippets})`);

			const result = index.retrieve(query);

			log.info(
				`Query returned ${result.snippets.length} snippets (${result.totalTokens} tokens, truncated=${result.truncated})`,
			);

			return result;
		},

		getStats(): RetrievalStats {
			const files = index.getIndexedFiles();
			return {
				fileCount: files?.length ?? 0,
				totalTokens: index.getTotalTokens(),
				rootDir,
			};
		},

		getIndex(): LocalRepoIndex {
			return index;
		},

		reindex(): void {
			// Force reset the cache
			index.index();
			const stats = service.getStats();
			log.info(`Re-indexed: ${stats.fileCount} files, ${stats.totalTokens} tokens`);
		},
	};

	return service;
}
