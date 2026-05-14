/**
 * Planner Memory - P7.E
 *
 * Records planner analysis results as memory that can be retrieved
 * by subsequent planning sessions to inform suggestions with evidence
 * from past runs. Planner memory is purely advisory — it does not
 * auto-apply any graph changes.
 *
 * Key features:
 * - Records planner outputs (batch plans, warnings, suggestions) as memory entries
 * - Retrieves relevant prior planner memory for new planning contexts
 * - Provides evidence from past plans to inform new suggestions
 * - Does not auto-apply graph changes (purely advisory)
 * - Can be inspected via getAll()
 */

import { randomUUID } from "node:crypto";
import type { PlannerMemoryStore } from "./planner-memory-store.js";
import { InMemoryPlannerMemoryStore } from "./planner-memory-store.js";

export type { PlannerMemoryStore } from "./planner-memory-store.js";
// Re-export store types for convenience
export { InMemoryPlannerMemoryStore } from "./planner-memory-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single planner memory entry.
 *
 * Captures the essential information about a planner run that can
 * provide evidence for future planning sessions.
 *
 * Queue outcome fields are populated by the feedback loop (P7.F)
 * when integration queue execution results are available.
 */
export interface PlannerMemoryEntry {
	/** Unique entry ID */
	id: string;
	/** Phase identifier (e.g., "P2") */
	phase: string;
	/** Phase title */
	title: string;
	/** Number of workspaces in the plan */
	workspaceCount: number;
	/** Requested parallelism */
	maxParallelWorkspaces: number;
	/** Effective parallelism achieved */
	effectiveParallelism: number;
	/** Total number of batches */
	totalBatches: number;
	/** Whether the plan was over-serialized */
	isOverSerialized: boolean;
	/** Whether the plan had warnings */
	hadWarnings: boolean;
	/** Types of warnings that were emitted */
	warningTypes: string[];
	/** Types of suggestions that were generated */
	suggestionTypes: string[];
	/** Bottleneck descriptions */
	bottlenecks: string[];
	/** Summary of the suggestion messages (for evidence matching) */
	suggestionSummaries: string[];
	/** The full planner summary text */
	summaryText: string;
	/** Whether the plan was applied, rejected, or unknown */
	verdict: "applied" | "rejected" | "unknown";
	/** Timestamp (epoch ms) when the entry was created */
	timestamp: number;

	// -----------------------------------------------------------------------
	// P7.F: Queue outcome tracking (populated by feedback loop)
	// -----------------------------------------------------------------------

	/**
	 * Queue outcome ID linking this plan entry to an integration queue result.
	 * Populated by the feedback loop when queue execution data is available.
	 */
	queueOutcomeId?: string;

	/**
	 * Queue outcome summary.
	 * Populated by the feedback loop after queue execution completes.
	 *
	 * - "success": All workspaces merged and validated successfully.
	 * - "partial": Some workspaces succeeded, others failed or blocked.
	 * - "failure": Plan execution resulted in failures or blocks.
	 * - "conflict": Merge conflicts occurred during integration.
	 * - "unknown": No queue outcome data available yet.
	 */
	queueOutcome?: "success" | "partial" | "failure" | "conflict" | "unknown";

	/**
	 * Number of workspaces that merged successfully.
	 */
	mergedCount?: number;

	/**
	 * Number of workspaces that failed or were blocked.
	 */
	failedCount?: number;

	/**
	 * Number of workspaces with merge conflicts.
	 */
	conflictCount?: number;

	/**
	 * Risk model adjustments derived from queue outcomes.
	 * Maps workspace ID -> adjusted risk level.
	 */
	riskAdjustments?: Record<string, "low" | "medium" | "high">;
}

/**
 * Configuration for the planner memory system.
 */
export interface PlannerMemoryConfig {
	/**
	 * Whether planner memory is enabled.
	 * When false, all operations are no-ops.
	 * Default: true
	 */
	enabled: boolean;
	/**
	 * Maximum number of entries to keep in memory.
	 * Oldest entries are pruned when this limit is exceeded.
	 * Default: 50
	 */
	maxEntries: number;
	/**
	 * Maximum age of entries in milliseconds.
	 * Entries older than this are pruned.
	 * Default: 30 days (2592000000 ms)
	 */
	maxAgeMs: number;
	/**
	 * Maximum number of relevant results to return per query.
	 * Default: 3
	 */
	maxResults: number;
	/**
	 * Minimum relevance score (0-1) for an entry to be considered relevant.
	 * Default: 0.15
	 */
	minRelevanceScore: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PLANNER_MEMORY_CONFIG: PlannerMemoryConfig = {
	enabled: true,
	maxEntries: 50,
	maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
	maxResults: 3,
	minRelevanceScore: 0.15,
};

// ---------------------------------------------------------------------------
// Planner Memory
// ---------------------------------------------------------------------------

/**
 * Planner memory manager.
 *
 * Records planner analysis results and retrieves relevant prior
 * planner memory to inform future planning sessions with evidence.
 *
 * Planner memory is purely advisory — it does not auto-apply
 * any graph changes. All operations are read-only with respect
 * to the workspace graph.
 */
export class PlannerMemory {
	private config: PlannerMemoryConfig;
	private store: PlannerMemoryStore;
	private disabled: boolean;

	/**
	 * Create a new PlannerMemory instance.
	 *
	 * @param config - Optional configuration overrides
	 * @param store - Optional custom store (defaults to InMemoryPlannerMemoryStore)
	 */
	constructor(config?: Partial<PlannerMemoryConfig>, store?: PlannerMemoryStore) {
		this.config = { ...DEFAULT_PLANNER_MEMORY_CONFIG, ...config };
		this.store = store ?? new InMemoryPlannerMemoryStore();
		this.disabled = !this.config.enabled;
	}

	/**
	 * Record a planner analysis result.
	 *
	 * Stores key metadata about the planner run that can later
	 * be retrieved as evidence for new planning sessions.
	 * This is a no-op if memory is disabled.
	 *
	 * The planner memory does not store the full workspace queue
	 * or batch plan — it stores derived metadata that is sufficient
	 * for relevance matching and evidence generation without being
	 * able to auto-apply graph changes.
	 *
	 * @param phase - Phase identifier
	 * @param title - Phase title
	 * @param workspaceCount - Number of workspaces
	 * @param maxParallelWorkspaces - Requested parallelism
	 * @param effectiveParallelism - Effective parallelism
	 * @param totalBatches - Total number of batches
	 * @param isOverSerialized - Whether plan was over-serialized
	 * @param hadWarnings - Whether plan had warnings
	 * @param warningTypes - Types of warnings
	 * @param suggestionTypes - Types of suggestions generated
	 * @param bottlenecks - Bottleneck descriptions
	 * @param suggestionSummaries - Summary of suggestion messages
	 * @param summaryText - Full planner summary text
	 * @param verdict - Whether plan was applied, rejected, or unknown
	 * @returns The created memory entry, or null if disabled
	 */
	async recordPlan(
		phase: string,
		title: string,
		workspaceCount: number,
		maxParallelWorkspaces: number,
		effectiveParallelism: number,
		totalBatches: number,
		isOverSerialized: boolean,
		hadWarnings: boolean,
		warningTypes: string[],
		suggestionTypes: string[],
		bottlenecks: string[],
		suggestionSummaries: string[],
		summaryText: string,
		verdict: "applied" | "rejected" | "unknown" = "unknown",
	): Promise<PlannerMemoryEntry | null> {
		if (this.disabled) {
			return null;
		}

		const entry: PlannerMemoryEntry = {
			id: randomUUID(),
			phase,
			title,
			workspaceCount,
			maxParallelWorkspaces,
			effectiveParallelism,
			totalBatches,
			isOverSerialized,
			hadWarnings,
			warningTypes: [...warningTypes],
			suggestionTypes: [...suggestionTypes],
			bottlenecks: [...bottlenecks],
			suggestionSummaries: [...suggestionSummaries],
			summaryText,
			verdict,
			timestamp: Date.now(),
		};

		await this.store.store(entry);
		await this.pruneIfNeeded();
		return entry;
	}

	/**
	 * Retrieve relevant prior planner memory for a new planning context.
	 *
	 * Uses keyword-based relevance matching to find planner memory
	 * entries that are related to the given queue characteristics.
	 * Results are sorted by relevance score (highest first).
	 *
	 * @param workspaceCount - Number of workspaces in the current plan
	 * @param maxParallelWorkspaces - Requested parallelism
	 * @param phase - Phase identifier (optional, for scoping)
	 * @param maxResults - Maximum number of results (overrides config)
	 * @returns Array of relevant planner memory entries, sorted by relevance
	 */
	async getRelevantMemory(
		workspaceCount: number,
		maxParallelWorkspaces: number,
		phase?: string,
		maxResults?: number,
	): Promise<PlannerMemoryEntry[]> {
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
				score: this.computeRelevance(entry, workspaceCount, maxParallelWorkspaces, phase),
			}))
			.filter((s) => s.score >= this.config.minRelevanceScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((s) => s.entry);

		return scored;
	}

	/**
	 * Get all stored planner memory entries (regardless of age).
	 *
	 * @returns All entries, newest first
	 */
	async getAll(): Promise<PlannerMemoryEntry[]> {
		if (this.disabled) {
			return [];
		}
		return this.store.getAll();
	}

	/**
	 * Clear all planner memory.
	 */
	async clear(): Promise<void> {
		await this.store.clear();
	}

	/**
	 * Disable planner memory.
	 * All future operations will be no-ops.
	 */
	disable(): void {
		this.disabled = true;
	}

	/**
	 * Enable planner memory.
	 */
	enable(): void {
		this.disabled = false;
	}

	/**
	 * Check whether planner memory is currently enabled.
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
	getConfig(): PlannerMemoryConfig {
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

	/**
	 * Update the verdict of an existing planner memory entry.
	 *
	 * Used by the feedback loop (P7.F) to mark plans as "applied" or
	 * "rejected" after queue execution results are available. This is
	 * the primary mechanism through which queue feedback updates the
	 * planner's historical memory.
	 *
	 * @param entryId - ID of the entry to update
	 * @param verdict - New verdict
	 * @returns True if the entry was found and updated, false otherwise
	 */
	async updateVerdict(entryId: string, verdict: "applied" | "rejected" | "unknown"): Promise<boolean> {
		if (this.disabled) {
			return false;
		}

		const entry = await this.store.getById(entryId);
		if (!entry) {
			return false;
		}

		entry.verdict = verdict;
		await this.store.update(entry);
		return true;
	}

	/**
	 * Update queue outcome data on an existing planner memory entry.
	 *
	 * Populated by the feedback loop (P7.F) when integration queue
	 * execution results are available. This method only sets fields
	 * that are explicitly provided — existing values are preserved.
	 *
	 * @param entryId - ID of the entry to update
	 * @param outcome - Queue outcome summary
	 * @param mergedCount - Number of merged workspaces
	 * @param failedCount - Number of failed/blocked workspaces
	 * @param conflictCount - Number of conflicted workspaces
	 * @param riskAdjustments - Optional risk level adjustments per workspace
	 * @returns True if the entry was found and updated, false otherwise
	 */
	async updateQueueOutcome(
		entryId: string,
		outcome: "success" | "partial" | "failure" | "conflict" | "unknown",
		mergedCount?: number,
		failedCount?: number,
		conflictCount?: number,
		riskAdjustments?: Record<string, "low" | "medium" | "high">,
	): Promise<boolean> {
		if (this.disabled) {
			return false;
		}

		const entry = await this.store.getById(entryId);
		if (!entry) {
			return false;
		}

		entry.queueOutcome = outcome;
		entry.queueOutcomeId = `${entry.id}-queue-outcome`;
		if (mergedCount !== undefined) entry.mergedCount = mergedCount;
		if (failedCount !== undefined) entry.failedCount = failedCount;
		if (conflictCount !== undefined) entry.conflictCount = conflictCount;
		if (riskAdjustments !== undefined) entry.riskAdjustments = { ...riskAdjustments };

		await this.store.update(entry);
		return true;
	}

	/**
	 * Get a specific planner memory entry by ID.
	 *
	 * @param entryId - Entry ID
	 * @returns The entry, or null if not found
	 */
	async getById(entryId: string): Promise<PlannerMemoryEntry | null> {
		if (this.disabled) {
			return null;
		}
		return this.store.getById(entryId);
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Compute a relevance score (0-1) between a planner memory entry and
	 * the given queue characteristics.
	 *
	 * Factors considered:
	 * - Phase match (same phase = strong signal)
	 * - Workspace count similarity (closer = higher score)
	 * - Parallelism similarity (closer = higher score)
	 * - Shared structural characteristics (over-serialized, similar bottlenecks)
	 */
	private computeRelevance(
		entry: PlannerMemoryEntry,
		workspaceCount: number,
		maxParallelWorkspaces: number,
		phase?: string,
	): number {
		let score = 0;
		let factors = 0;

		// Phase match (strong signal: same phase = 0.4 base)
		if (phase && entry.phase === phase) {
			score += 0.4;
			factors++;
		}

		// Workspace count similarity (closer is better, normalized by max)
		const wsDiff = Math.abs(entry.workspaceCount - workspaceCount);
		const wsMax = Math.max(entry.workspaceCount, workspaceCount, 1);
		const wsSimilarity = 1 - wsDiff / wsMax;
		if (wsSimilarity > 0.5) {
			score += wsSimilarity * 0.3;
			factors++;
		}

		// Parallelism similarity
		const parDiff = Math.abs(entry.maxParallelWorkspaces - maxParallelWorkspaces);
		const parMax = Math.max(entry.maxParallelWorkspaces, maxParallelWorkspaces, 1);
		const parSimilarity = 1 - parDiff / parMax;
		if (parSimilarity > 0.5) {
			score += parSimilarity * 0.2;
			factors++;
		}

		// Structural similarity (over-serialized patterns)
		if (entry.isOverSerialized) {
			// Over-serialized plans are relevant to other plans that might be over-serialized
			// We add a small bonus for structural similarity regardless
			score += 0.1;
			factors++;
		}

		// Queue outcome similarity (P7.F): plans with similar outcomes
		// are more relevant — a success pattern for one plan is likely
		// to repeat for structurally similar plans
		if (entry.queueOutcome && entry.queueOutcome !== "unknown") {
			// Plans with concrete queue outcomes are generally more useful
			// as evidence than plans with no outcome data
			score += 0.05;
			factors++;

			// Particularly useful: plans that succeeded at high parallelism
			if (entry.queueOutcome === "success" && entry.effectiveParallelism > 1) {
				score += 0.05;
				factors++;
			}
		}

		return factors > 0 ? score / factors : 0;
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
			const sorted = [...remaining].sort((a, b) => a.timestamp - b.timestamp);
			const toRemove = sorted.slice(0, remaining.length - this.config.maxEntries);
			for (const entry of toRemove) {
				await this.store.deleteById(entry.id);
			}
		}
	}
}

/**
 * Create a PlannerMemory instance with default settings.
 *
 * @param config - Optional configuration overrides
 * @param store - Optional custom store
 * @returns A new PlannerMemory instance
 */
export function createPlannerMemory(config?: Partial<PlannerMemoryConfig>, store?: PlannerMemoryStore): PlannerMemory {
	return new PlannerMemory(config, store);
}
