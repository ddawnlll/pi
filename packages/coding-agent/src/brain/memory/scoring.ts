/**
 * Memory Scoring Engine — P14.D
 *
 * Calculates confidence, relevance, and conflict scores for memory records.
 *
 * The engine implements the scoring formulas:
 * - Confidence: (evidenceCount / maxEvidence) * sourceQuality * recencyScore
 * - Relevance: keyword match bonus + type match bonus + tag match bonus
 * - Recency: decays from 1.0 to 0.5 over recencyDecayDays
 * - Conflict: opposing scores for contradictory memories
 *
 * File scope: This is the single scoring implementation for all
 * memory scoring needs across the system.
 */

import type { MemoryQuery, MemoryRecord, MemoryScore } from "./types.js";

// ---------------------------------------------------------------------------
// Scoring Config
// ---------------------------------------------------------------------------

/**
 * Default maximum evidence count for normalisation.
 * Memories with more than this many source refs get maximum evidence score.
 */
const DEFAULT_MAX_EVIDENCE = 10;

/**
 * Weights for each scoring dimension.
 */
export interface ScoringWeights {
	/** Weight for evidence count contribution to confidence */
	evidenceCount: number;
	/** Weight for source quality contribution to confidence */
	sourceQuality: number;
	/** Weight for recency contribution to confidence */
	recency: number;
	/** Weight for tag match contribution to relevance */
	tagMatch: number;
	/** Weight for keyword match contribution to relevance */
	keywordMatch: number;
}

/**
 * Configuration for the Memory Scoring Engine.
 *
 * All weight fields control how each dimension contributes to the
 * composite scores. Recency decay controls how fast memories age.
 * Source quality scores assign a multiplier per validated-by value.
 */
export interface ScoringConfig {
	/** Weights for each scoring dimension */
	weights: ScoringWeights;
	/** Number of days before recency decays from 1.0 to 0.5 */
	recencyDecayDays: number;
	/**
	 * Quality multiplier per `validatedBy` value.
	 * Values not present in this map default to 0.3.
	 */
	sourceQualityScores: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default scoring configuration.
 *
 * - Weights favour evidence count and source quality slightly over recency.
 * - Recency half-life: 30 days.
 * - System-validated memories get the highest quality score (1.0).
 * - Unvalidated LLM memories get the lowest score (0.3) unless overridden.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
	weights: {
		evidenceCount: 0.4,
		sourceQuality: 0.35,
		recency: 0.25,
		tagMatch: 0.3,
		keywordMatch: 0.4,
	},
	recencyDecayDays: 30,
	sourceQualityScores: {
		system: 1.0,
		user: 0.9,
		llm_validated: 0.8,
	},
};

// ---------------------------------------------------------------------------
// Memory Scoring Engine
// ---------------------------------------------------------------------------

/**
 * Engine for calculating multi-dimensional memory scores.
 *
 * Usage:
 * ```typescript
 * const engine = new MemoryScoringEngine();
 * const confidence = engine.calculateConfidence(record);
 * const relevance = engine.calculateRelevance(record, query);
 * const total = engine.scoreMemories(memories, query);
 * ```
 */
export class MemoryScoringEngine {
	private config: ScoringConfig;

	/**
	 * Create a new scoring engine with an optional partial config.
	 * Missing keys default to DEFAULT_SCORING_CONFIG values.
	 *
	 * @param config - Optional partial configuration
	 */
	constructor(config?: {
		weights?: Partial<ScoringWeights>;
		recencyDecayDays?: number;
		sourceQualityScores?: Record<string, number>;
	}) {
		this.config = this.mergeConfig(config);
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Merge a partial config into the current config.
	 *
	 * @param partial - Partial configuration to merge
	 * @returns A fully resolved ScoringConfig
	 */
	private mergeConfig(partial?: {
		weights?: Partial<ScoringWeights>;
		recencyDecayDays?: number;
		sourceQualityScores?: Record<string, number>;
	}): ScoringConfig {
		const base = DEFAULT_SCORING_CONFIG;

		if (!partial) {
			return { ...base, weights: { ...base.weights }, sourceQualityScores: { ...base.sourceQualityScores } };
		}

		return {
			weights: {
				...base.weights,
				...partial.weights,
			},
			recencyDecayDays: partial.recencyDecayDays ?? base.recencyDecayDays,
			sourceQualityScores: {
				...base.sourceQualityScores,
				...partial.sourceQualityScores,
			},
		};
	}

	/**
	 * Update the engine configuration.
	 * Only provided fields are changed; others keep their current values.
	 *
	 * @param config - Partial configuration to apply
	 */
	setConfig(config: {
		weights?: Partial<ScoringWeights>;
		recencyDecayDays?: number;
		sourceQualityScores?: Record<string, number>;
	}): void {
		this.config = this.mergeConfig({
			weights: { ...this.config.weights, ...config.weights },
			recencyDecayDays: config.recencyDecayDays ?? this.config.recencyDecayDays,
			sourceQualityScores: { ...this.config.sourceQualityScores, ...config.sourceQualityScores },
		});
	}

	/**
	 * Get the current engine configuration (read-only snapshot).
	 *
	 * @returns A shallow copy of the current config
	 */
	getConfig(): ScoringConfig {
		return {
			...this.config,
			weights: { ...this.config.weights },
			sourceQualityScores: { ...this.config.sourceQualityScores },
		};
	}

	// -----------------------------------------------------------------------
	// Confidence
	// -----------------------------------------------------------------------

	/**
	 * Calculate a confidence score (0-1) for a memory record.
	 *
	 * Formula (per spec):
	 *   confidence = (evidenceCount / maxEvidence) * sourceQuality * recencyScore
	 *
	 * Where:
	 *   - evidenceCount is the number of source refs (capped at maxEvidence=10)
	 *   - sourceQuality is looked up from config.sourceQualityScores by
	 *     validatedBy; unknown values default to 0.3
	 *   - recencyScore is computed by calculateRecencyScore
	 *
	 * This is a purely multiplicative formula — each factor scales the
	 * others. A memory with few sources, low-quality validation, or old
	 * age will score proportionally lower in every dimension.
	 *
	 * @param memory - The memory record to evaluate
	 * @returns Confidence score between 0 and 1
	 */
	calculateConfidence(memory: MemoryRecord): number {
		const evidenceCount = memory.provenance.sourceRefs.length;
		const evidenceFactor = Math.min(1, evidenceCount / DEFAULT_MAX_EVIDENCE);

		const validatedBy = memory.provenance.validatedBy;
		const sourceQuality = this.config.sourceQualityScores[validatedBy] ?? 0.3;

		const recencyScore = this.calculateRecencyScore(memory);

		// Pure product formula (per P14 spec): each factor multiplies the others
		const confidence = evidenceFactor * sourceQuality * recencyScore;

		// Clamp to [0, 1]
		return Math.max(0, Math.min(1, confidence));
	}

	// -----------------------------------------------------------------------
	// Recency
	// -----------------------------------------------------------------------

	/**
	 * Calculate a recency score (0-1) for a memory record.
	 *
	 * The score decays from 1.0 (new) to 0.5 once recencyDecayDays have
	 * elapsed, and approaches 0 asymptotically beyond that.
	 *
	 * Formula:
	 *   ageDays = (now - createdAt) / (24 * 60 * 60 * 1000)
	 *   recency = 1 / (1 + ageDays / recencyDecayDays)
	 *
	 * This ensures recency is always > 0 and smoothly decays.
	 *
	 * @param memory - The memory record to evaluate
	 * @returns Recency score between 0 and 1
	 */
	calculateRecencyScore(memory: MemoryRecord): number {
		const ageMs = Date.now() - new Date(memory.createdAt).getTime();
		const ageDays = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
		const decayDays = this.config.recencyDecayDays;

		if (decayDays <= 0) {
			return 1.0; // no decay when configured to 0 or negative
		}

		// Decay: 1.0 at age 0, 0.5 at age = decayDays, approaching 0 asymptotically
		return 1.0 / (1.0 + ageDays / decayDays);
	}

	// -----------------------------------------------------------------------
	// Relevance
	// -----------------------------------------------------------------------

	/**
	 * Calculate a relevance score (0-1) between a memory record and a query.
	 *
	 * Relevance is composed of:
	 * - Keyword match bonus (0.4): the query searchText is found in the
	 *   record's title, content, or summary
	 * - Type match bonus (0.3): the query specifies types and the record
	 *   matches one of them
	 * - Tag match bonus (0.3): the query specifies tags and the record
	 *   shares at least one tag; bonus scales with overlap ratio
	 *
	 * If no query is provided the score is the configured baseline (0.5).
	 * If the query has no filter fields the baseline is also returned.
	 *
	 * @param memory - The memory record to evaluate
	 * @param query - Optional query context
	 * @returns Relevance score between 0 and 1
	 */
	calculateRelevance(memory: MemoryRecord, query?: MemoryQuery): number {
		if (!query) {
			return 0.5;
		}

		let score = 0;
		let hasFactor = false;

		// Keyword match (searchText in title / content / summary)
		// Bonus: 0.4
		if (query.searchText) {
			hasFactor = true;
			const lowerQuery = query.searchText.toLowerCase();
			if (
				memory.title.toLowerCase().includes(lowerQuery) ||
				memory.content.toLowerCase().includes(lowerQuery) ||
				memory.summary?.toLowerCase().includes(lowerQuery)
			) {
				score += 0.4;
			}
		}

		// Type match
		// Bonus: 0.3
		if (query.types && query.types.length > 0) {
			hasFactor = true;
			if (query.types.includes(memory.type)) {
				score += 0.3;
			}
		}

		// Tag match
		// Bonus: 0.3 * (matchingTags / queryTags)
		if (query.tags && query.tags.length > 0) {
			hasFactor = true;
			const matchingTags = query.tags.filter((t) => memory.tags.includes(t));
			if (matchingTags.length > 0) {
				const tagRatio = Math.min(1, matchingTags.length / Math.max(1, query.tags.length));
				score += 0.3 * tagRatio;
			}
		}

		if (!hasFactor) {
			return 0.5;
		}

		return Math.max(0, Math.min(1, score));
	}

	// -----------------------------------------------------------------------
	// Conflict Scoring
	// -----------------------------------------------------------------------

	/**
	 * Calculate a conflict score between two memory records.
	 *
	 * A high score (> configurable threshold, typically > 0.7) indicates
	 * that the two memories are likely in conflict. The score is computed
	 * as the product of their individual total scores — if both records
	 * have high confidence/relevance, their conflict potential is higher.
	 *
	 * For same-type memories, the score is boosted by 0.2 to reflect
	 * higher conflict likelihood within the same category.
	 *
	 * @param memoryA - First memory record
	 * @param memoryB - Second memory record
	 * @returns Conflict score between 0 and 1
	 */
	calculateConflictScore(memoryA: MemoryRecord, memoryB: MemoryRecord): number {
		const scoreA = this.calculateConfidence(memoryA);
		const scoreB = this.calculateConfidence(memoryB);
		const avgConfidence = (scoreA + scoreB) / 2;
		const maxConfidence = Math.max(scoreA, scoreB);

		// Base conflict score: high when both records have high confidence
		// Use max confidence to avoid penalising a pair with one low-confidence record
		let conflictScore = avgConfidence * maxConfidence;

		// Boost for same-type memories (more likely to conflict)
		if (memoryA.type === memoryB.type) {
			conflictScore += 0.2;
		}

		// Clamp to [0, 1]
		return Math.max(0, Math.min(1, conflictScore));
	}

	// -----------------------------------------------------------------------
	// Batch Scoring
	// -----------------------------------------------------------------------

	/**
	 * Score multiple memory records, optionally against a query.
	 *
	 * Each memory gets a full MemoryScore with confidence, relevance,
	 * recency, evidenceQuality, and total dimensions.
	 *
	 * Note: The evidenceQuality dimension is derived from the evidence
	 * count factor used in confidence calculation, representing the
	 * normalised source reference count.
	 *
	 * @param memories - Array of memory records to score
	 * @param query - Optional query for relevance scoring
	 * @returns Map of record ID to MemoryScore
	 */
	scoreMemories(memories: MemoryRecord[], query?: MemoryQuery): Map<string, MemoryScore> {
		const results = new Map<string, MemoryScore>();

		for (const memory of memories) {
			const confidence = this.calculateConfidence(memory);
			const relevance = this.calculateRelevance(memory, query);
			const recency = this.calculateRecencyScore(memory);

			const evidenceCount = memory.provenance.sourceRefs.length;
			const evidenceQuality = Math.min(1, evidenceCount / DEFAULT_MAX_EVIDENCE);

			// Total: weighted average of confidence, relevance, recency, evidenceQuality
			const total = confidence * 0.3 + relevance * 0.3 + recency * 0.2 + evidenceQuality * 0.2;

			results.set(memory.id, {
				confidence,
				relevance,
				recency,
				evidenceQuality,
				total,
			});
		}

		return results;
	}
}
