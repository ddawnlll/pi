/**
 * Execution Memory - P5.5.E
 *
 * Records workspace execution results as memory that can be retrieved
 * by subsequent workspace executions to provide context and avoid
 * repeating mistakes.
 *
 * Key features:
 * - Records successful and failed workspace executions as memory entries
 * - Retrieves relevant prior memory for new workspaces via keyword matching
 * - Excludes raw hidden reasoning (thinking blocks) from stored memory
 * - Can be disabled entirely via config flag
 */

import { randomUUID } from "node:crypto";
import { type ExecutionMemoryStore, InMemoryExecutionMemoryStore } from "./execution-memory-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single execution memory entry.
 *
 * Captures the essential information about a workspace execution
 * that can provide context for future workspace runs.
 */
export interface ExecutionMemoryEntry {
	/** Unique entry ID */
	id: string;
	/** Workspace ID that produced this memory */
	workspaceId: string;
	/** Goal of the workspace execution */
	goal: string;
	/** Acceptance criteria for the workspace */
	acceptanceCriteria: string[];
	/** Final verdict */
	verdict: "COMPLETE" | "FAILED" | "BLOCKED";
	/** Human-readable summary of what was done / what happened */
	summary: string;
	/** Files that were modified during execution */
	filesModified: string[];
	/** Commands that were run during execution */
	commandsRun: string[];
	/** Error message if the workspace failed */
	error?: string;
	/** Whether this entry represents a failure */
	isFailure: boolean;
	/** Timestamp (epoch ms) when the entry was created */
	timestamp: number;
}

/**
 * Configuration for the execution memory system.
 */
export interface ExecutionMemoryConfig {
	/**
	 * Whether execution memory is enabled.
	 * When false, all operations are no-ops.
	 * Default: true
	 */
	enabled: boolean;
	/**
	 * Maximum number of entries to keep in memory.
	 * Oldest entries are pruned when this limit is exceeded.
	 * Default: 100
	 */
	maxEntries: number;
	/**
	 * Maximum age of entries in milliseconds.
	 * Entries older than this are pruned.
	 * Default: 7 days (604800000 ms)
	 */
	maxAgeMs: number;
	/**
	 * Maximum number of relevant results to return per query.
	 * Default: 5
	 */
	maxResults: number;
	/**
	 * Minimum relevance score (0-1) for an entry to be considered relevant.
	 * Default: 0.1
	 */
	minRelevanceScore: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_EXECUTION_MEMORY_CONFIG: ExecutionMemoryConfig = {
	enabled: true,
	maxEntries: 100,
	maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
	maxResults: 5,
	minRelevanceScore: 0.1,
};

// ---------------------------------------------------------------------------
// Execution Memory
// ---------------------------------------------------------------------------

/**
 * Execution memory manager.
 *
 * Records workspace execution results and retrieves relevant prior
 * memory to inform future workspace executions.
 */
export class ExecutionMemory {
	private config: ExecutionMemoryConfig;
	private store: ExecutionMemoryStore;
	private disabled: boolean;

	/**
	 * Create a new ExecutionMemory instance.
	 *
	 * @param config - Optional configuration overrides
	 * @param store - Optional custom store (defaults to InMemoryExecutionMemoryStore)
	 */
	constructor(config?: Partial<ExecutionMemoryConfig>, store?: ExecutionMemoryStore) {
		this.config = { ...DEFAULT_EXECUTION_MEMORY_CONFIG, ...config };
		this.store = store ?? new InMemoryExecutionMemoryStore();
		this.disabled = !this.config.enabled;
	}

	/**
	 * Record a successful workspace execution.
	 *
	 * Creates a memory entry with the COMPLETE verdict and stores it
	 * for future retrieval. This is a no-op if memory is disabled.
	 *
	 * The summary should describe what was accomplished and any
	 * important context (e.g., "Fixed the memory store by adding
	 * null checks to the getById method"). Raw hidden reasoning
	 * (thinking blocks) are NOT included in the summary.
	 *
	 * @param workspaceId - The workspace ID
	 * @param goal - The workspace goal
	 * @param acceptanceCriteria - List of acceptance criteria
	 * @param summary - Human-readable summary (without raw reasoning)
	 * @param filesModified - Files that were modified
	 * @param commandsRun - Commands that were run
	 * @returns The created memory entry, or null if disabled
	 */
	async recordSuccess(
		workspaceId: string,
		goal: string,
		acceptanceCriteria: string[],
		summary: string,
		filesModified: string[] = [],
		commandsRun: string[] = [],
	): Promise<ExecutionMemoryEntry | null> {
		if (this.disabled) {
			return null;
		}

		const entry: ExecutionMemoryEntry = {
			id: randomUUID(),
			workspaceId,
			goal,
			acceptanceCriteria: [...acceptanceCriteria],
			verdict: "COMPLETE",
			summary: this.sanitizeSummary(summary),
			filesModified: [...filesModified],
			commandsRun: [...commandsRun],
			isFailure: false,
			timestamp: Date.now(),
		};

		await this.store.store(entry);
		await this.pruneIfNeeded();
		return entry;
	}

	/**
	 * Record a failed workspace execution.
	 *
	 * Creates a memory entry with the FAILED or BLOCKED verdict and
	 * stores it for future retrieval. This is a no-op if memory is disabled.
	 *
	 * The summary should describe what went wrong and why, without
	 * including raw hidden reasoning tokens.
	 *
	 * @param workspaceId - The workspace ID
	 * @param goal - The workspace goal
	 * @param acceptanceCriteria - List of acceptance criteria
	 * @param error - Error message describing the failure
	 * @param verdict - Optional verdict override (defaults to FAILED)
	 * @param summary - Optional human-readable summary
	 * @param filesModified - Files that were modified (if any before failure)
	 * @param commandsRun - Commands that were run (if any before failure)
	 * @returns The created memory entry, or null if disabled
	 */
	async recordFailure(
		workspaceId: string,
		goal: string,
		acceptanceCriteria: string[],
		error: string,
		verdict: "FAILED" | "BLOCKED" = "FAILED",
		summary?: string,
		filesModified: string[] = [],
		commandsRun: string[] = [],
	): Promise<ExecutionMemoryEntry | null> {
		if (this.disabled) {
			return null;
		}

		const entry: ExecutionMemoryEntry = {
			id: randomUUID(),
			workspaceId,
			goal,
			acceptanceCriteria: [...acceptanceCriteria],
			verdict,
			summary: summary ? this.sanitizeSummary(summary) : `Execution failed: ${error}`,
			filesModified: [...filesModified],
			commandsRun: [...commandsRun],
			error,
			isFailure: true,
			timestamp: Date.now(),
		};

		await this.store.store(entry);
		await this.pruneIfNeeded();
		return entry;
	}

	/**
	 * Retrieve relevant prior memory for a given goal and acceptance criteria.
	 *
	 * Uses keyword-based relevance matching to find memory entries that
	 * are related to the given workspace context. Results are sorted by
	 * relevance score (highest first).
	 *
	 * @param goal - The workspace goal to match against
	 * @param acceptanceCriteria - The acceptance criteria to match against
	 * @param maxResults - Maximum number of results (overrides config)
	 * @returns Array of relevant memory entries, sorted by relevance
	 */
	async getRelevantMemory(
		goal: string,
		acceptanceCriteria: string[],
		maxResults?: number,
	): Promise<ExecutionMemoryEntry[]> {
		if (this.disabled) {
			return [];
		}

		const allEntries = await this.store.getAll();
		const limit = maxResults ?? this.config.maxResults;

		// Remove old entries
		const now = Date.now();
		const validEntries = allEntries.filter((e) => now - e.timestamp <= this.config.maxAgeMs);

		// Score each entry for relevance
		const scored = validEntries
			.map((entry) => ({
				entry,
				score: this.computeRelevance(entry, goal, acceptanceCriteria),
			}))
			.filter((s) => s.score >= this.config.minRelevanceScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((s) => s.entry);

		return scored;
	}

	/**
	 * Get all stored memory entries (regardless of age).
	 *
	 * @returns All entries, newest first
	 */
	async getAll(): Promise<ExecutionMemoryEntry[]> {
		if (this.disabled) {
			return [];
		}
		return this.store.getAll();
	}

	/**
	 * Clear all execution memory.
	 */
	async clear(): Promise<void> {
		await this.store.clear();
	}

	/**
	 * Disable execution memory.
	 * All future operations will be no-ops.
	 */
	disable(): void {
		this.disabled = true;
	}

	/**
	 * Enable execution memory.
	 */
	enable(): void {
		this.disabled = false;
	}

	/**
	 * Check whether execution memory is currently enabled.
	 *
	 * @returns True if memory is enabled
	 */
	isEnabled(): boolean {
		return !this.disabled;
	}

	/**
	 * Get the current configuration.
	 *
	 * @returns A copy of the current config
	 */
	getConfig(): ExecutionMemoryConfig {
		return { ...this.config };
	}

	/**
	 * Get the number of stored entries.
	 *
	 * @returns Entry count
	 */
	async count(): Promise<number> {
		if (this.disabled) {
			return 0;
		}
		return this.store.count();
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Remove raw hidden reasoning / thinking blocks from the summary.
	 *
	 * Strips content between ​​ tags (thinking tags used by models like
	 * Claude), as well as any other known reasoning delimiters.
	 * This ensures only actionable information is stored as memory.
	 */
	private sanitizeSummary(summary: string): string {
		let cleaned = summary;

		// Strip ​​thinking​​...​​/thinking​​ blocks (Anthropic-style reasoning)
		cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");

		// Strip ​​reasoning​​...​​/reasoning​​ blocks
		cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");

		// Strip ​​think​​...​​/think​​ blocks
		cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");

		// Strip ```thinking ... ``` code blocks
		cleaned = cleaned.replace(/```thinking[\s\S]*?```/gi, "");

		// Trim and collapse whitespace
		cleaned = cleaned.trim().replace(/\s+/g, " ");

		return cleaned;
	}

	/**
	 * Compute a relevance score (0-1) between a memory entry and
	 * the given goal/acceptance criteria.
	 *
	 * Uses keyword overlap scoring:
	 * - Tokenize goal and AC into words
	 * - Count how many of those words appear in the entry's goal/summary
	 * - Normalize by total unique keywords
	 */
	private computeRelevance(entry: ExecutionMemoryEntry, goal: string, acceptanceCriteria: string[]): number {
		const queryTokens = this.tokenize(goal + " " + acceptanceCriteria.join(" "));
		const entryTokens = this.tokenize(entry.goal + " " + entry.summary + " " + entry.acceptanceCriteria.join(" "));

		if (queryTokens.size === 0) {
			return 0;
		}

		// Count how many query tokens appear in the entry
		let matches = 0;
		for (const token of queryTokens) {
			if (entryTokens.has(token)) {
				matches++;
			}
		}

		// Normalize by the size of the query token set
		return matches / queryTokens.size;
	}

	/**
	 * Tokenize text into lowercase keyword tokens.
	 *
	 * Splits on non-alphanumeric characters, filters out common
	 * stop words and very short tokens.
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
		]);

		const words = text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length >= 3 && !stopWords.has(w));

		return new Set(words);
	}

	/**
	 * Prune old and excess entries if limits are exceeded.
	 *
	 * Removes entries older than maxAgeMs, then trims to maxEntries
	 * by removing the oldest remaining entries.
	 */
	private async pruneIfNeeded(): Promise<void> {
		const allEntries = await this.store.getAll();

		// Remove entries that exceed the maximum age
		const now = Date.now();
		const expired = allEntries.filter((e) => now - e.timestamp > this.config.maxAgeMs);
		for (const entry of expired) {
			await this.store.deleteById(entry.id);
		}

		// If still over capacity, remove oldest entries
		const remaining = await this.store.getAll();
		if (remaining.length > this.config.maxEntries) {
			// Sort oldest first, then remove from oldest
			const sorted = [...remaining].sort((a, b) => a.timestamp - b.timestamp);
			const toRemove = sorted.slice(0, remaining.length - this.config.maxEntries);
			for (const entry of toRemove) {
				await this.store.deleteById(entry.id);
			}
		}
	}
}

/**
 * Create an ExecutionMemory instance with default settings.
 *
 * @param config - Optional configuration overrides
 * @param store - Optional custom store
 * @returns A new ExecutionMemory instance
 */
export function createExecutionMemory(
	config?: Partial<ExecutionMemoryConfig>,
	store?: ExecutionMemoryStore,
): ExecutionMemory {
	return new ExecutionMemory(config, store);
}
