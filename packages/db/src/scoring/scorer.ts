/**
 * Proposal Scorer.
 *
 * Core scoring engine that evaluates a proposal against a rubric's
 * criteria, computes weighted scores, and generates a structured
 * scoring output.
 */

import type { CriterionScore, Proposal, ProposalRubric, RubricCriterion } from "../types.js";

/**
 * Input for scoring a single proposal.
 */
export interface ScoringInput {
	/** The proposal to score */
	proposal: Pick<Proposal, "id" | "title" | "evidence" | "source_artifacts">;
	/** The rubric to score against */
	rubric: ProposalRubric;
	/**
	 * Pre-computed criterion scores. If provided, the scorer uses these
	 * directly instead of computing default scores.
	 */
	criterionScores?: CriterionScore[];
	/**
	 * Optional scoring context for generating rationale.
	 * Can include additional project context, phase info, etc.
	 */
	context?: Record<string, unknown>;
}

/**
 * Output from scoring a single proposal.
 */
export interface ScoringOutput {
	/** The proposal ID */
	proposal_id: string;
	/** The rubric ID */
	rubric_id: string;
	/** Individual criterion scores */
	scores: CriterionScore[];
	/** Weighted total score */
	total_score: number;
	/** Maximum possible weighted score */
	max_score: number;
	/** Percentage score (0-100) */
	percentage: number;
	/** Human-readable scoring summary */
	summary: string;
	/** Source of the scores ("engine" | "manual") */
	scored_by: string;
}

/**
 * Default scoring function when no manual scores are provided.
 *
 * Assigns a baseline score to each criterion based on evidence presence:
 * - If the proposal has evidence, each criterion gets max_score * 0.7
 * - If evidence includes source_artifacts, each criterion gets max_score * 0.85
 * - Otherwise, each criterion gets max_score * 0.5
 *
 * @param criteria - Rubric criteria
 * @param proposal - The proposal being scored
 * @returns Default criterion scores
 */
function computeDefaultScores(
	criteria: RubricCriterion[],
	proposal: Pick<Proposal, "evidence" | "source_artifacts">,
): CriterionScore[] {
	const hasEvidence = proposal.evidence && Object.keys(proposal.evidence).length > 0;
	const hasArtifacts = Array.isArray(proposal.source_artifacts) && proposal.source_artifacts.length > 0;

	const multiplier = hasArtifacts ? 0.85 : hasEvidence ? 0.7 : 0.5;

	return criteria.map((criterion) => ({
		criterion_name: criterion.name,
		score: Math.round(criterion.max_score * multiplier * 100) / 100,
		rationale: hasArtifacts
			? `Scored based on source artifacts and evidence presence`
			: hasEvidence
				? `Scored based on available evidence`
				: `Scored at baseline (no evidence or artifacts found)`,
	}));
}

/**
 * Compute the weighted total score from criterion scores and rubric criteria.
 *
 * @param scores - Individual criterion scores
 * @param criteria - Rubric criteria (for weights and max scores)
 * @returns Object with total_score, max_score, and percentage
 */
function computeWeightedScore(
	scores: CriterionScore[],
	criteria: RubricCriterion[],
): { total_score: number; max_score: number; percentage: number } {
	const criteriaMap = new Map(criteria.map((c) => [c.name, c]));

	let totalScore = 0;
	let maxScore = 0;

	for (const score of scores) {
		const criterion = criteriaMap.get(score.criterion_name);
		if (!criterion) continue;

		const weight = criterion.weight;
		const normalizedScore = criterion.max_score > 0 ? score.score / criterion.max_score : 0;
		totalScore += normalizedScore * weight;
		maxScore += weight;
	}

	// Normalize to a 0-100 scale
	const normalizedTotal = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
	const roundedTotal = Math.round(normalizedTotal * 100) / 100;

	return {
		total_score: roundedTotal,
		max_score: 100,
		percentage: roundedTotal,
	};
}

/**
 * Generate a human-readable summary of the scoring result.
 *
 * @param scores - Individual criterion scores
 * @param totalScore - Weighted total score
 * @returns Summary string
 */
function generateSummary(scores: CriterionScore[], totalScore: number): string {
	const rating =
		totalScore >= 90 ? "Excellent" : totalScore >= 75 ? "Good" : totalScore >= 50 ? "Fair" : "Needs Improvement";

	const highest = scores.reduce((best, s) => (s.score > best.score ? s : best), scores[0]);
	const lowest = scores.reduce((worst, s) => (s.score < worst.score ? s : worst), scores[0]);

	return (
		`${rating} (${totalScore.toFixed(1)}/100). ` +
		`Strongest criterion: "${highest?.criterion_name}" (${highest?.score.toFixed(1)}). ` +
		`Weakest criterion: "${lowest?.criterion_name}" (${lowest?.score.toFixed(1)}).`
	);
}

/**
 * Proposal Scorer.
 *
 * Evaluates proposals against rubrics and produces structured scoring
 * output with weighted totals, individual criterion scores, and summaries.
 */
export class ProposalScorer {
	/**
	 * Score a single proposal against a rubric.
	 *
	 * @param input - Scoring input with proposal, rubric, and optional manual scores
	 * @returns Scoring output with computed scores and summary
	 */
	score(input: ScoringInput): ScoringOutput {
		const { proposal, rubric, criterionScores, context: _context } = input;

		// Validate input
		if (!rubric.criteria || rubric.criteria.length === 0) {
			throw new Error(`Rubric "${rubric.name}" has no criteria defined`);
		}

		// Use provided scores or compute defaults
		const scores = criterionScores ?? computeDefaultScores(rubric.criteria, proposal);

		// Validate that all criteria have scores
		const criterionNames = new Set(rubric.criteria.map((c) => c.name));
		for (const score of scores) {
			if (!criterionNames.has(score.criterion_name)) {
				throw new Error(`Criterion "${score.criterion_name}" not found in rubric "${rubric.name}"`);
			}
		}

		// Compute weighted score
		const { total_score, max_score, percentage } = computeWeightedScore(scores, rubric.criteria);

		// Generate summary
		const summary = generateSummary(scores, total_score);

		return {
			proposal_id: proposal.id,
			rubric_id: rubric.id,
			scores,
			total_score,
			max_score,
			percentage,
			summary,
			scored_by: criterionScores ? "manual" : "engine",
		};
	}

	/**
	 * Score multiple proposals against the same rubric.
	 *
	 * @param proposals - Array of proposals to score
	 * @param rubric - The rubric to score against
	 * @param manualScores - Optional map of proposal_id -> manual criterion scores
	 * @returns Array of scoring outputs
	 */
	scoreBatch(
		proposals: ScoringInput["proposal"][],
		rubric: ProposalRubric,
		manualScores?: Map<string, CriterionScore[]>,
	): ScoringOutput[] {
		return proposals.map((proposal) => {
			const criterionScores = manualScores?.get(proposal.id);
			return this.score({
				proposal,
				rubric,
				criterionScores,
			});
		});
	}

	/**
	 * Validate that a rubric's criteria are well-formed.
	 *
	 * @param criteria - Array of rubric criteria
	 * @returns Array of validation error messages (empty if valid)
	 */
	validateCriteria(criteria: RubricCriterion[]): string[] {
		const errors: string[] = [];

		for (let i = 0; i < criteria.length; i++) {
			const c = criteria[i];

			if (!c.name || c.name.trim().length === 0) {
				errors.push(`Criterion at index ${i} has no name`);
			}
			if (c.weight <= 0) {
				errors.push(`Criterion "${c.name || i}" has weight <= 0`);
			}
			if (c.max_score <= 0) {
				errors.push(`Criterion "${c.name || i}" has max_score <= 0`);
			}
			if (!c.description || c.description.trim().length === 0) {
				errors.push(`Criterion "${c.name || i}" has no description`);
			}
		}

		// Check that weights sum to approximately 1.0
		if (criteria.length > 0) {
			const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
			if (Math.abs(totalWeight - 1.0) > 0.01) {
				errors.push(`Criteria weights sum to ${totalWeight.toFixed(3)}, expected approximately 1.0`);
			}
		}

		return errors;
	}
}
