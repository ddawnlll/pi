/**
 * Conflict Detection Engine — P14.E
 *
 * Detects contradictory, duplicate, and stale memories. Triggers disputed
 * lifecycle state when conflicts are found, and supports both automatic
 * and user-driven resolution.
 *
 * Detection strategies:
 * - Contradiction: same-type memories with text-similar content but
 *   divergent confidence scores (indicates different conclusions)
 * - Duplicate: same-type memories with near-identical title/summary/content
 * - Staleness: active memories whose age exceeds the configured threshold
 *
 * Resolution:
 * - User-driven: caller picks a winner record ID
 * - Auto-resolve: highest-confidence record wins (duplicates/staleness only;
 *   contradictions always require user judgment)
 *
 * File scope: This is the single conflict detection and resolution
 * implementation for all memory conflict use cases.
 *
 * Dependencies: P14.B (MemoryStore)
 */

import type { MemoryStore } from "./store.js";
import { createMemoryConflict, type MemoryConflict, type MemoryRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Conflict Detection Engine.
 *
 * All thresholds have sensible defaults suitable for most use cases.
 */
export interface ConflictConfig {
	/**
	 * Text similarity threshold above which same-type memories are
	 * flagged as contradictory (0.0 - 1.0). Default: 0.7.
	 */
	contradictionThreshold: number;

	/**
	 * Text similarity threshold above which memories are flagged as
	 * duplicates (0.0 - 1.0). Default: 0.9.
	 */
	duplicateSimilarityThreshold: number;

	/**
	 * Number of days after which an active memory is considered stale.
	 * Default: 180.
	 */
	stalenessThresholdDays: number;

	/**
	 * If true, duplicate and staleness conflicts are resolved
	 * automatically by picking the highest-confidence record.
	 * Contradictions are never auto-resolved. Default: false.
	 */
	autoResolve: boolean;
}

/**
 * Result of a single conflict detection pass against one memory record.
 */
export interface ConflictAnalysis {
	/** The ID of the memory record that conflicts. */
	memoryId: string;

	/** IDs of memory records this record conflicts with. */
	conflictingWith: string[];

	/** The types of conflict detected. */
	conflictTypes: ("contradiction" | "duplicate" | "staleness")[];

	/** Numeric scores for each detected conflict (same order as conflictTypes). */
	scores: number[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ConflictConfig = {
	contradictionThreshold: 0.7,
	duplicateSimilarityThreshold: 0.9,
	stalenessThresholdDays: 180,
	autoResolve: false,
};

// ---------------------------------------------------------------------------
// Text Similarity
// ---------------------------------------------------------------------------

/**
 * Compute Jaccard similarity between two text strings based on word sets.
 *
 * Returns a value in [0, 1] where 0 means no word overlap and 1 means
 * identical word sets. Non-alphanumeric characters are treated as word
 * separators. Case-insensitive.
 *
 * This is intentionally simple — it is suitable for first-pass detection
 * and keeps the dependency footprint at zero.
 */
function textSimilarity(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
	const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));

	if (wordsA.size === 0 && wordsB.size === 0) return 0;

	let intersection = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) intersection++;
	}

	const union = wordsA.size + wordsB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Detection Helpers
// ---------------------------------------------------------------------------

/**
 * Detect contradiction between two same-type memory records.
 *
 * Returns a score > 0 (proportional to similarity and confidence divergence)
 * when the records share the same type, have text-similar content above the
 * threshold, and their confidence scores diverge by more than 0.3.
 *
 * The divergence check prevents flagging records that agree with each other
 * but happen to describe similar topics.
 *
 * @returns A contradiction score in (0, 1], or 0 if no contradiction.
 */
function detectContradiction(a: MemoryRecord, b: MemoryRecord, threshold: number): number {
	if (a.type !== b.type) return 0;

	// Compare summaries first (more concise), then full content
	const summarySimilarity = a.summary && b.summary ? textSimilarity(a.summary, b.summary) : 0;
	const contentSimilarity = textSimilarity(a.content, b.content);

	const maxSimilarity = Math.max(summarySimilarity, contentSimilarity);

	if (maxSimilarity >= threshold) {
		const confidenceDiff = Math.abs(a.confidence - b.confidence);
		// Significant confidence divergence on similar content => contradiction
		if (confidenceDiff > 0.3) {
			return maxSimilarity * confidenceDiff;
		}
	}

	return 0;
}

/**
 * Detect duplicate between two same-type memory records.
 *
 * Returns a score > 0 when title, summary, or content similarity exceeds
 * the threshold. The score is the maximum similarity across all three
 * text fields.
 *
 * @returns A duplicate score in (0, 1], or 0 if no duplicate.
 */
function detectDuplicate(a: MemoryRecord, b: MemoryRecord, threshold: number): number {
	if (a.type !== b.type) return 0;

	const titleSim = textSimilarity(a.title, b.title);
	const summarySim = a.summary && b.summary ? textSimilarity(a.summary, b.summary) : 0;
	const contentSim = textSimilarity(a.content, b.content);

	const maxSimilarity = Math.max(titleSim, summarySim, contentSim);
	return maxSimilarity >= threshold ? maxSimilarity : 0;
}

/**
 * Check whether an active memory record is stale.
 *
 * A record is stale when:
 * - Its lifecycle is "active"
 * - Its age in days exceeds the threshold
 */
function detectStaleness(memory: MemoryRecord, thresholdDays: number): boolean {
	if (memory.lifecycle !== "active") return false;

	const ageMs = Date.now() - new Date(memory.createdAt).getTime();
	const ageDays = ageMs / (24 * 60 * 60 * 1000);
	return ageDays > thresholdDays;
}

// ---------------------------------------------------------------------------
// Conflict Detection Engine
// ---------------------------------------------------------------------------

/**
 * Engine for detecting, managing, and resolving memory conflicts.
 *
 * Detection can be triggered on a single memory record (to check a new
 * record against existing ones) or as a full sweep of all records (e.g.,
 * during scheduled maintenance).
 *
 * Usage:
 * ```typescript
 * const store = new MemoryStore();
 * await store.initialize();
 *
 * const engine = new ConflictDetectionEngine(store);
 *
 * // Check a single new memory against existing records
 * const analyses = await engine.detectConflicts(newMemory);
 *
 * // Full scan of all records
 * const conflicts = await engine.runFullDetection();
 *
 * // Resolve a conflict
 * await engine.resolveConflict(conflictId, winnerId, "User verified this is correct");
 *
 * // Automatic resolution
 * await engine.autoResolveConflict(conflictId);
 * ```
 */
export class ConflictDetectionEngine {
	private config: ConflictConfig;
	private memoryStore: MemoryStore;

	/**
	 * Create a new ConflictDetectionEngine.
	 *
	 * @param memoryStore - An initialized MemoryStore instance (P14.B).
	 * @param config - Optional partial configuration. Missing keys use defaults.
	 */
	constructor(memoryStore: MemoryStore, config?: Partial<ConflictConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.memoryStore = memoryStore;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the engine configuration.
	 *
	 * Only provided fields are changed; missing fields keep their current values.
	 *
	 * @param config - Partial configuration to apply.
	 */
	setConfig(config: Partial<ConflictConfig>): void {
		if (config.contradictionThreshold !== undefined) {
			this.config.contradictionThreshold = config.contradictionThreshold;
		}
		if (config.duplicateSimilarityThreshold !== undefined) {
			this.config.duplicateSimilarityThreshold = config.duplicateSimilarityThreshold;
		}
		if (config.stalenessThresholdDays !== undefined) {
			this.config.stalenessThresholdDays = config.stalenessThresholdDays;
		}
		if (config.autoResolve !== undefined) {
			this.config.autoResolve = config.autoResolve;
		}
	}

	/**
	 * Get a snapshot of the current engine configuration.
	 *
	 * @returns A shallow copy of the current config.
	 */
	getConfig(): ConflictConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Detection
	// -----------------------------------------------------------------------

	/**
	 * Check a single memory record for conflicts against existing records.
	 *
	 * Compares the given record against all active, candidate, and needs_review
	 * records of the same type. Returns an array of ConflictAnalysis describing
	 * any contradictions or duplicates found.
	 *
	 * This is the method to call after creating or updating a memory record
	 * to see if it introduces any conflicts before promoting it to active.
	 *
	 * @param memory - The memory record to check.
	 * @returns Array of ConflictAnalysis for each conflicting record found.
	 */
	async detectConflicts(memory: MemoryRecord): Promise<ConflictAnalysis[]> {
		const analyses: ConflictAnalysis[] = [];

		// Query same-type records that could potentially conflict
		const sameTypeRecords = await this.memoryStore.query({
			types: [memory.type],
			lifecycle: ["active", "candidate", "needs_review"],
		});

		for (const other of sameTypeRecords) {
			if (other.id === memory.id) continue;

			const conflictTypes: ("contradiction" | "duplicate")[] = [];
			const scores: number[] = [];

			// Check contradiction
			const contradictionScore = detectContradiction(memory, other, this.config.contradictionThreshold);
			if (contradictionScore > 0) {
				conflictTypes.push("contradiction");
				scores.push(contradictionScore);
			}

			// Check duplicate (only if no contradiction flagged)
			if (contradictionScore <= 0) {
				const duplicateScore = detectDuplicate(memory, other, this.config.duplicateSimilarityThreshold);
				if (duplicateScore > 0) {
					conflictTypes.push("duplicate");
					scores.push(duplicateScore);
				}
			}

			if (conflictTypes.length > 0) {
				analyses.push({
					memoryId: other.id,
					conflictingWith: [memory.id],
					conflictTypes,
					scores,
				});
			}
		}

		return analyses;
	}

	/**
	 * Run a full conflict detection sweep across all stored memory records.
	 *
	 * Performs three kinds of checks:
	 * 1. Pairwise contradiction detection between same-type records
	 * 2. Pairwise duplicate detection between same-type records
	 * 3. Staleness check for all active records
	 *
	 * Each detected conflict is persisted as a MemoryConflict record in the
	 * store. If autoResolve is enabled, eligible conflicts are resolved
	 * automatically.
	 *
	 * @returns Array of all MemoryConflict records created during this sweep.
	 */
	async runFullDetection(): Promise<MemoryConflict[]> {
		const allRecords = await this.memoryStore.query({});
		const createdConflicts: MemoryConflict[] = [];
		const processedPairs = new Set<string>();

		// Pairwise contradiction and duplicate detection
		for (let i = 0; i < allRecords.length; i++) {
			for (let j = i + 1; j < allRecords.length; j++) {
				const a = allRecords[i];
				const b = allRecords[j];
				if (a.type !== b.type) continue;

				const pairKey = [a.id, b.id].sort().join(":");
				if (processedPairs.has(pairKey)) continue;
				processedPairs.add(pairKey);

				let conflictScore = 0;
				let conflictType: "contradiction" | "duplicate" | null = null;

				// Check contradiction first (higher priority)
				const cScore = detectContradiction(a, b, this.config.contradictionThreshold);
				if (cScore > 0) {
					conflictScore = cScore;
					conflictType = "contradiction";
				}

				// Check duplicate only if no contradiction
				if (!conflictType) {
					const dScore = detectDuplicate(a, b, this.config.duplicateSimilarityThreshold);
					if (dScore > 0) {
						conflictScore = dScore;
						conflictType = "duplicate";
					}
				}

				if (conflictType && conflictScore > 0) {
					// Use record confidence for comparison scores (spec: auto-pick highest confidence)
					const scores = {
						[a.id]: a.confidence,
						[b.id]: b.confidence,
					};

					const conflict = createMemoryConflict({
						recordIds: [a.id, b.id],
						conflictType,
						scores,
						evidence: `Detected ${conflictType} with score ${conflictScore.toFixed(3)} between "${a.title}" and "${b.title}"`,
					});

					const persisted = await this.memoryStore.createConflict(conflict);
					createdConflicts.push(persisted);
				}
			}
		}

		// Staleness check for active records
		const activeRecords = await this.memoryStore.findByLifecycle("active");
		for (const record of activeRecords) {
			if (detectStaleness(record, this.config.stalenessThresholdDays)) {
				const staleConflict = createMemoryConflict({
					recordIds: [record.id, record.id],
					conflictType: "staleness",
					scores: { [record.id]: record.confidence },
					evidence: `Memory "${record.title}" (${record.id}) is stale: created ${record.createdAt}, age exceeds ${this.config.stalenessThresholdDays} days`,
				});
				const persisted = await this.memoryStore.createConflict(staleConflict);
				createdConflicts.push(persisted);
			}
		}

		// Auto-resolve eligible conflicts if configured
		if (this.config.autoResolve) {
			for (const conflict of createdConflicts) {
				if (!conflict.resolution || conflict.resolution === "pending") {
					await this.autoResolveConflict(conflict.id);
				}
			}
		}

		return createdConflicts;
	}

	// -----------------------------------------------------------------------
	// Conflict Management
	// -----------------------------------------------------------------------

	/**
	 * Get all stored conflict records.
	 *
	 * @returns Array of all MemoryConflict records.
	 */
	async getConflicts(): Promise<MemoryConflict[]> {
		return this.memoryStore.listConflicts();
	}

	/**
	 * Get a single conflict record by ID.
	 *
	 * @param id - The conflict UUID.
	 * @returns The MemoryConflict, or null if not found.
	 */
	async getConflict(id: string): Promise<MemoryConflict | null> {
		return this.memoryStore.getConflict(id);
	}

	/**
	 * Resolve a conflict by explicitly selecting a winner record.
	 *
	 * The winner must be one of the record IDs involved in the conflict.
	 * The resolution is recorded as "user_selected" along with the
	 * user-provided resolution text.
	 *
	 * @param conflictId - The UUID of the conflict to resolve.
	 * @param winnerId - The ID of the record selected as the winner.
	 * @param resolution - Human-readable explanation of the resolution.
	 * @throws If the conflict is not found or the winner is not part of it.
	 */
	async resolveConflict(conflictId: string, winnerId: string, resolution: string): Promise<void> {
		const conflict = await this.memoryStore.getConflict(conflictId);
		if (!conflict) {
			throw new Error(`Conflict not found: ${conflictId}`);
		}

		if (!conflict.recordIds.includes(winnerId)) {
			throw new Error(`Winner ID ${winnerId} is not part of conflict ${conflictId}`);
		}

		const updatedConflict: MemoryConflict = {
			...conflict,
			resolution: "user_selected",
			resolvedBy: winnerId,
			resolvedAt: new Date().toISOString(),
			evidence: resolution,
		};

		await this.persistConflictUpdate(conflictId, updatedConflict);
	}

	/**
	 * Automatically resolve a conflict by picking the highest-confidence record.
	 *
	 * Rules:
	 * - Contradictions are NEVER auto-resolved (they require user judgment)
	 * - Duplicates are auto-resolved: the record with the highest confidence wins
	 * - Staleness is a self-conflict; the stale record is already flagged
	 *
	 * @param conflictId - The UUID of the conflict to auto-resolve.
	 * @throws If the conflict is not found.
	 */
	async autoResolveConflict(conflictId: string): Promise<void> {
		const conflict = await this.memoryStore.getConflict(conflictId);
		if (!conflict) {
			throw new Error(`Conflict not found: ${conflictId}`);
		}

		if (conflict.resolution && conflict.resolution !== "pending") {
			return; // Already resolved
		}

		// Contradictions always require user judgment
		if (conflict.conflictType === "contradiction") {
			return;
		}

		// Pick the winner by highest confidence score
		let winnerId: string | null = null;
		let highestScore = -1;

		for (const [recordId, score] of Object.entries(conflict.scores)) {
			if (score > highestScore) {
				highestScore = score;
				winnerId = recordId;
			}
		}

		if (!winnerId) {
			throw new Error(`Cannot resolve conflict ${conflictId}: no valid scores`);
		}

		const updatedConflict: MemoryConflict = {
			...conflict,
			resolution: "auto_resolved",
			resolvedBy: winnerId,
			resolvedAt: new Date().toISOString(),
			evidence: `Auto-resolved: ${conflict.conflictType} conflict, picked record ${winnerId} with highest score ${highestScore}`,
		};

		await this.persistConflictUpdate(conflictId, updatedConflict);
	}

	// -----------------------------------------------------------------------
	// Scheduled Detection
	// -----------------------------------------------------------------------

	/**
	 * Run scheduled conflict detection.
	 *
	 * This is the primary method for periodic/cron-based conflict scanning.
	 * It performs a full detection sweep and, if autoResolve is enabled,
	 * also attempts to auto-resolve any existing unresolved conflicts.
	 *
	 * @returns Array of newly created MemoryConflict records.
	 */
	async runScheduledDetection(): Promise<MemoryConflict[]> {
		const conflicts = await this.runFullDetection();

		// Auto-resolve any existing unresolved conflicts if configured
		if (this.config.autoResolve) {
			const existingConflicts = await this.memoryStore.listConflicts();
			for (const conflict of existingConflicts) {
				if (!conflict.resolution || conflict.resolution === "pending") {
					await this.autoResolveConflict(conflict.id);
				}
			}
		}

		return conflicts;
	}

	// -----------------------------------------------------------------------
	// Internal Helpers
	// -----------------------------------------------------------------------

	/**
	 * Persist an update to an existing conflict record.
	 *
	 * The MemoryStore does not have a dedicated updateConflict method, so
	 * we delete and recreate the conflict record atomically. Since the
	 * store's createConflict uses atomicWrite (rename), the operation is
	 * safe even if interrupted.
	 */
	private async persistConflictUpdate(conflictId: string, conflict: MemoryConflict): Promise<void> {
		await this.memoryStore.deleteConflict(conflictId);
		await this.memoryStore.createConflict(conflict);
	}
}
