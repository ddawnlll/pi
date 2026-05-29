/**
 * Proposal Scoring Engine — P16.C
 *
 * Scores proposals across four dimensions: novelty, confidence,
 * urgency, and feasibility. Computes total score for auto-queue
 * decisions.
 *
 * Scoring formulas (from Vision §6.3):
 *   Total Score = (novelty × 0.2) + (confidence × 0.3) + (urgency × 0.2) + (feasibility × 0.3)
 *
 * V5.08: Auto-queue is removed from the API (AC2, AC4). The scoring
 * engine still computes scores, but the API no longer auto-transitions
 * proposals to approved. All proposals require user approval before
 * reaching execution_ready status.
 *
 * Auto-queue thresholds (retained for informational purposes):
 *   - Total score >= 0.7 AND confidence >= 0.6
 *
 * File scope: This is the single scoring implementation for all
 * proposal scoring needs across the system.
 */

import type { Proposal, ProposalCreateInput, ProposalScore } from "./types.js";

// ---------------------------------------------------------------------------
// Scoring Config
// ---------------------------------------------------------------------------

/**
 * Weights for each scoring dimension in the total calculation.
 */
export interface ScoringWeights {
	/** Weight for novelty contribution to total */
	novelty: number;
	/** Weight for confidence contribution to total */
	confidence: number;
	/** Weight for urgency contribution to total */
	urgency: number;
	/** Weight for feasibility contribution to total */
	feasibility: number;
}

/**
 * Configuration for the Proposal Scoring Engine.
 *
 * All weight fields control how each dimension contributes to the
 * composite total score. Auto-queue thresholds determine whether
 * a proposal is automatically queued for execution or sent to the
 * approval inbox. Novelty lookback controls how far back we compare
 * for duplicate detection.
 */
export interface ScoringConfig {
	/** Weights for each scoring dimension */
	weights: ScoringWeights;
	/** Minimum total score for auto-queue (default: 0.7) */
	autoQueueThreshold: number;
	/** Minimum confidence score for auto-queue (default: 0.6) */
	autoQueueConfidenceMin: number;
	/** Number of days to look back for novelty comparison (default: 14) */
	noveltyLookbackDays: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default scoring configuration.
 *
 * - Weights follow the Vision §6.3 formula.
 * - Auto-queue is conservative (0.7 total, 0.6 confidence).
 * - Novelty lookback is 14 days.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
	weights: {
		novelty: 0.2,
		confidence: 0.3,
		urgency: 0.2,
		feasibility: 0.3,
	},
	autoQueueThreshold: 0.7,
	autoQueueConfidenceMin: 0.6,
	noveltyLookbackDays: 14,
};

// ---------------------------------------------------------------------------
// Proposal Scoring Engine
// ---------------------------------------------------------------------------

/**
 * Engine for scoring proposals across multiple dimensions.
 *
 * Usage:
 * ```typescript
 * const engine = new ProposalScoringEngine();
 * const score = await engine.score(proposal, existingProposals);
 * const shouldQueue = engine.shouldAutoQueue(score);
 * ```
 */
export class ProposalScoringEngine {
	private config: ScoringConfig;

	/**
	 * Create a new scoring engine with an optional partial config.
	 * Missing keys default to DEFAULT_SCORING_CONFIG values.
	 *
	 * @param config - Optional partial configuration
	 */
	constructor(config?: {
		weights?: Partial<ScoringWeights>;
		autoQueueThreshold?: number;
		autoQueueConfidenceMin?: number;
		noveltyLookbackDays?: number;
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
		autoQueueThreshold?: number;
		autoQueueConfidenceMin?: number;
		noveltyLookbackDays?: number;
	}): ScoringConfig {
		const base = DEFAULT_SCORING_CONFIG;

		if (!partial) {
			return {
				...base,
				weights: { ...base.weights },
			};
		}

		return {
			weights: {
				...base.weights,
				...partial.weights,
			},
			autoQueueThreshold: partial.autoQueueThreshold ?? base.autoQueueThreshold,
			autoQueueConfidenceMin: partial.autoQueueConfidenceMin ?? base.autoQueueConfidenceMin,
			noveltyLookbackDays: partial.noveltyLookbackDays ?? base.noveltyLookbackDays,
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
		autoQueueThreshold?: number;
		autoQueueConfidenceMin?: number;
		noveltyLookbackDays?: number;
	}): void {
		this.config = this.mergeConfig({
			weights: { ...this.config.weights, ...config.weights },
			autoQueueThreshold: config.autoQueueThreshold ?? this.config.autoQueueThreshold,
			autoQueueConfidenceMin: config.autoQueueConfidenceMin ?? this.config.autoQueueConfidenceMin,
			noveltyLookbackDays: config.noveltyLookbackDays ?? this.config.noveltyLookbackDays,
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
		};
	}

	// -----------------------------------------------------------------------
	// Full Scoring
	// -----------------------------------------------------------------------

	/**
	 * Score a proposal across all four dimensions.
	 *
	 * Computes novelty, confidence, urgency, and feasibility scores
	 * and combines them into a weighted total.
	 *
	 * @param proposal - The proposal to score (create input form)
	 * @param existingProposals - Previously created proposals for novelty comparison
	 * @param context - Optional context (goals, autonomy level)
	 * @returns A fully populated ProposalScore
	 */
	async score(
		proposal: ProposalCreateInput,
		existingProposals: Proposal[] = [],
		context?: { goals?: unknown[]; autonomyLevel?: number },
	): Promise<ProposalScore> {
		const novelty = this.calculateNovelty(proposal, existingProposals);
		const confidence = this.calculateConfidence(proposal.evidence);
		const urgency = this.calculateUrgency(proposal, context?.goals);
		const feasibility = this.calculateFeasibility(proposal, context?.autonomyLevel);

		return {
			novelty,
			confidence,
			urgency,
			feasibility,
			total: this.calculateTotal({ novelty, confidence, urgency, feasibility }),
		};
	}

	// -----------------------------------------------------------------------
	// Novelty
	// -----------------------------------------------------------------------

	/**
	 * Calculate a novelty score (0-1) for a proposal.
	 *
	 * Novelty measures how different a proposal is from existing ones.
	 * It is computed by comparing against recent proposals (within
	 * noveltyLookbackDays) using word overlap, type match, and title
	 * similarity.
	 *
	 * Formula:
	 *   For each existing proposal of the same type:
	 *     similarity = wordOverlap(wordMatch) + typeMatch + titleSimilarity
	 *   novelty = 1 - maxSimilarity
	 *
	 * A completely novel proposal (no similar proposals) scores 1.0.
	 * A proposal identical to an existing one scores 0.0.
	 *
	 * @param proposal - The proposal to evaluate
	 * @param existingProposals - Previously created proposals
	 * @returns Novelty score between 0 and 1
	 */
	calculateNovelty(proposal: ProposalCreateInput, existingProposals: Proposal[]): number {
		if (existingProposals.length === 0) {
			return 1.0;
		}

		// Filter to recent proposals within lookback window
		const lookbackMs = this.config.noveltyLookbackDays * 24 * 60 * 60 * 1000;
		const cutoff = Date.now() - lookbackMs;

		const recentProposals = existingProposals.filter((p) => {
			const created = new Date(p.createdAt).getTime();
			return created >= cutoff;
		});

		if (recentProposals.length === 0) {
			return 1.0;
		}

		// Compare against proposals of the same type
		const sameTypeProposals = recentProposals.filter((p) => p.type === proposal.type);

		if (sameTypeProposals.length === 0) {
			// Different type from all recent → high novelty
			return 0.9;
		}

		// Compute max similarity across same-type proposals
		let maxSimilarity = 0;

		for (const existing of sameTypeProposals) {
			const similarity = this.computeSimilarity(proposal, existing);
			maxSimilarity = Math.max(maxSimilarity, similarity);
		}

		// Novelty is the inverse of the maximum similarity found.
		// If the most similar proposal scores 0.8 similarity, novelty is 0.2.
		const novelty = 1 - maxSimilarity;

		// Clamp to [0, 1]
		return Math.max(0, Math.min(1, novelty));
	}

	/**
	 * Compute similarity between a proposal input and an existing proposal.
	 *
	 * Uses word overlap in title + description, type match, and length
	 * similarity. Returns a value between 0 (completely different) and
	 * 1 (identical).
	 *
	 * @param a - The new proposal
	 * @param b - An existing proposal
	 * @returns Similarity score between 0 and 1
	 */
	private computeSimilarity(a: ProposalCreateInput, b: Proposal): number {
		let score = 0;

		// Word overlap in title (weight: 0.4)
		const wordsA = this.tokenize(a.title);
		const wordsB = this.tokenize(b.title);
		const titleOverlap = this.jaccardSimilarity(wordsA, wordsB);
		score += 0.4 * titleOverlap;

		// Word overlap in description (weight: 0.3)
		const descWordsA = this.tokenize(a.description);
		const descWordsB = this.tokenize(b.description);
		const descOverlap = this.jaccardSimilarity(descWordsA, descWordsB);
		score += 0.3 * descOverlap;

		// Type match (weight: 0.2)
		if (a.type === b.type) {
			score += 0.2;
		}

		// Length similarity (weight: 0.1)
		const lenA = a.description.length;
		const lenB = b.description.length;
		if (lenA > 0 && lenB > 0) {
			const ratio = Math.min(lenA, lenB) / Math.max(lenA, lenB);
			score += 0.1 * ratio;
		}

		return Math.max(0, Math.min(1, score));
	}

	/**
	 * Tokenize a string into lowercase word tokens.
	 *
	 * @param text - The text to tokenize
	 * @returns Array of word tokens
	 */
	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, "")
			.split(/\s+/)
			.filter((w) => w.length > 0);
	}

	/**
	 * Compute Jaccard similarity between two arrays of tokens.
	 *
	 * @param a - First token array
	 * @param b - Second token array
	 * @returns Jaccard similarity between 0 and 1
	 */
	private jaccardSimilarity(a: string[], b: string[]): number {
		if (a.length === 0 && b.length === 0) {
			return 1.0;
		}
		if (a.length === 0 || b.length === 0) {
			return 0;
		}

		const setA = new Set(a);
		const setB = new Set(b);

		let intersection = 0;
		for (const word of setA) {
			if (setB.has(word)) {
				intersection++;
			}
		}

		const union = new Set([...setA, ...setB]).size;
		return intersection / union;
	}

	// -----------------------------------------------------------------------
	// Confidence
	// -----------------------------------------------------------------------

	/**
	 * Calculate a confidence score (0-1) for a proposal based on its evidence.
	 *
	 * Formula:
	 *   confidence = evidence.confidence * sourceQuality
	 *
	 * Where:
	 *   - evidence.confidence is the submitted confidence of the evidence
	 *   - sourceQuality is derived from the types of source refs:
	 *     - Has observation refs: 1.0 (real-time signals are trusted)
	 *     - Has memory refs only: 0.8 (memory is somewhat trusted)
	 *     - Has source refs only: 0.6 (generic references)
	 *     - No refs: 0.3 (lowest trust)
	 *
	 * The evidence confidence is the strength of the evidence itself.
	 * The source quality adjusts for the trustworthiness of the source type.
	 * The product ensures both dimensions must be high for a high score.
	 *
	 * @param evidence - The proposal's evidence
	 * @returns Confidence score between 0 and 1
	 */
	calculateConfidence(evidence: {
		confidence: number;
		memoryIds: string[];
		observationIds: string[];
		sourceRefs: unknown[];
	}): number {
		// Source quality based on reference types
		let sourceQuality = 0.3; // default: lowest trust

		if (evidence.observationIds.length > 0) {
			sourceQuality = 1.0; // observations are trusted sources
		} else if (evidence.memoryIds.length > 0) {
			sourceQuality = 0.8; // memory references are somewhat trusted
		} else if (evidence.sourceRefs.length > 0) {
			sourceQuality = 0.6; // generic source refs
		}

		// Clamp evidence confidence to [0, 1]
		const evidenceConfidence = Math.max(0, Math.min(1, evidence.confidence));

		// Product formula: both dimensions must be high
		const confidence = evidenceConfidence * sourceQuality;

		// Clamp to [0, 1]
		return Math.max(0, Math.min(1, confidence));
	}

	// -----------------------------------------------------------------------
	// Urgency
	// -----------------------------------------------------------------------

	/**
	 * Calculate an urgency score (0-1) for a proposal.
	 *
	 * Urgency measures how time-sensitive a proposal is. It is based on:
	 * - Observation recency: recent observations increase urgency
	 * - Goal alignment: alignment with active goals increases urgency
	 * - Proposal type: some types are inherently more urgent
	 *
	 * Formula:
	 *   urgency = observationRecency * goalUrgency * typeUrgency
	 *
	 * Where:
	 *   - observationRecency: 1.0 if observationIds > 0, else 0.5
	 *   - goalUrgency: 1.0 if goals provided and relevant, else 0.7
	 *   - typeUrgency: varies by proposal type
	 *
	 * @param proposal - The proposal to evaluate
	 * @param goals - Optional array of active goals
	 * @returns Urgency score between 0 and 1
	 */
	calculateUrgency(proposal: ProposalCreateInput, goals?: unknown[]): number {
		// Observation recency: proposals backed by observations are more urgent
		const observationRecency = proposal.evidence.observationIds.length > 0 ? 1.0 : 0.5;

		// Goal urgency: alignment with goals increases urgency
		const goalUrgency =
			goals && goals.length > 0 && proposal.relatedGoalIds && proposal.relatedGoalIds.length > 0 ? 1.0 : 0.7;

		// Type urgency: some types are inherently more time-sensitive
		const typeUrgency = this.getTypeUrgency(proposal.type);

		// Product formula
		const urgency = observationRecency * goalUrgency * typeUrgency;

		// Clamp to [0, 1]
		return Math.max(0, Math.min(1, urgency));
	}

	/**
	 * Get the base urgency for a proposal type.
	 *
	 * Safety proposals are most urgent, followed by plan and goal
	 * revisions. Memory and reflection proposals are less urgent.
	 *
	 * @param type - The proposal type
	 * @returns Base urgency multiplier (0-1)
	 */
	private getTypeUrgency(type: string): number {
		switch (type) {
			case "safety_proposal":
				return 1.0;
			case "plan_proposal":
				return 0.9;
			case "goal_revision_proposal":
				return 0.8;
			case "autonomy_adjustment_proposal":
				return 0.7;
			case "memory_proposal":
				return 0.6;
			case "reflection_proposal":
				return 0.5;
			default:
				return 0.5;
		}
	}

	// -----------------------------------------------------------------------
	// Feasibility
	// -----------------------------------------------------------------------

	/**
	 * Calculate a feasibility score (0-1) for a proposal.
	 *
	 * Feasibility measures whether we can execute this proposal given
	 * available capabilities and resources.
	 *
	 * Formula:
	 *   feasibility = capabilityCheck * resourceCheck * complexityCheck
	 *
	 * Where:
	 *   - capabilityCheck: 1.0 if autonomy level >= 1, scales with higher levels
	 *   - resourceCheck: based on proposal type complexity
	 *   - complexityCheck: based on evidence depth and risk level
	 *
	 * @param proposal - The proposal to evaluate
	 * @param autonomyLevel - Optional current autonomy level (numeric)
	 * @returns Feasibility score between 0 and 1
	 */
	calculateFeasibility(proposal: ProposalCreateInput, autonomyLevel?: number): number {
		// Capability check: higher autonomy means more feasible
		const capabilityCheck = autonomyLevel !== undefined ? Math.min(1, (autonomyLevel + 1) / 5) : 0.6;

		// Resource check: some types require more resources
		const resourceCheck = this.getTypeResourceRequirement(proposal.type);

		// Complexity check: proposals with better evidence and lower risk are more feasible
		const evidenceDepth = proposal.evidence.memoryIds.length + proposal.evidence.observationIds.length;
		const evidenceFactor = Math.min(1, evidenceDepth / 5);

		const riskFactor = this.getRiskFeasibilityFactor(proposal.risk.level);

		const complexityCheck = 0.5 * evidenceFactor + 0.5 * riskFactor;

		// Product formula
		const feasibility = capabilityCheck * resourceCheck * complexityCheck;

		// Clamp to [0, 1]
		return Math.max(0, Math.min(1, feasibility));
	}

	/**
	 * Get resource requirement factor for a proposal type.
	 *
	 * Higher values = fewer resources needed = more feasible.
	 *
	 * @param type - The proposal type
	 * @returns Resource check multiplier (0-1)
	 */
	private getTypeResourceRequirement(type: string): number {
		switch (type) {
			case "memory_proposal":
				return 1.0; // low resource
			case "reflection_proposal":
				return 0.9;
			case "goal_revision_proposal":
				return 0.8;
			case "plan_proposal":
				return 0.7; // high resource
			case "autonomy_adjustment_proposal":
				return 0.6;
			case "safety_proposal":
				return 0.8;
			default:
				return 0.7;
		}
	}

	/**
	 * Get feasibility factor based on risk level.
	 *
	 * Higher risk = lower feasibility.
	 *
	 * @param level - The risk level
	 * @returns Feasibility factor (0-1)
	 */
	private getRiskFeasibilityFactor(level: string): number {
		switch (level) {
			case "low":
				return 1.0;
			case "medium":
				return 0.8;
			case "high":
				return 0.5;
			case "critical":
				return 0.3;
			default:
				return 0.5;
		}
	}

	// -----------------------------------------------------------------------
	// Total Score
	// -----------------------------------------------------------------------

	/**
	 * Calculate the weighted total score from dimension scores.
	 *
	 * Formula (per Vision §6.3):
	 *   total = (novelty × 0.2) + (confidence × 0.3) + (urgency × 0.2) + (feasibility × 0.3)
	 *
	 * @param dimensions - The four dimension scores (without total)
	 * @returns Weighted total score between 0 and 1
	 */
	calculateTotal(dimensions: Omit<ProposalScore, "total">): number {
		const { weights } = this.config;
		const total =
			dimensions.novelty * weights.novelty +
			dimensions.confidence * weights.confidence +
			dimensions.urgency * weights.urgency +
			dimensions.feasibility * weights.feasibility;

		return Math.max(0, Math.min(1, total));
	}

	// -----------------------------------------------------------------------
	// Auto-queue Decision
	// -----------------------------------------------------------------------

	/**
	 * Determine whether a proposal should be auto-queued.
	 *
	 * Auto-queue is allowed when:
	 *   - Total score >= autoQueueThreshold (default 0.7)
	 *   - Confidence score >= autoQueueConfidenceMin (default 0.6)
	 *
	 * This two-condition gate ensures that both the overall quality
	 * and the evidence confidence are sufficiently high.
	 *
	 * @param score - The computed proposal score
	 * @returns True if the proposal should be auto-queued
	 */
	shouldAutoQueue(score: ProposalScore): boolean {
		return score.total >= this.config.autoQueueThreshold && score.confidence >= this.config.autoQueueConfidenceMin;
	}
}
