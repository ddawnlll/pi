/**
 * Proposal Ranking Engine.
 *
 * Ranks proposals by their scores across rubrics, providing
 * comparison and prioritization for the execution pipeline.
 */

import type { ProposalScore } from "../types.js";
import type { ScoringOutput } from "./scorer.js";

/**
 * Input for ranking proposals.
 */
export interface RankingInput {
	/** Scoring outputs to rank */
	results: ScoringOutput[];
	/** Optional weights per rubric ID for multi-rubric ranking */
	rubricWeights?: Record<string, number>;
}

/**
 * A scored proposal with ranking metadata.
 */
export interface ScoredProposalRanking {
	/** The proposal ID */
	proposal_id: string;
	/** The rubric ID used */
	rubric_id: string;
	/** Weighted total score */
	total_score: number;
	/** Maximum score */
	max_score: number;
	/** Percentage score */
	percentage: number;
	/** Scoring summary */
	summary: string;
	/** Rank position (1 = highest) */
	rank: number;
	/** Number of proposals ranked */
	total_ranked: number;
}

/**
 * Ranking results.
 */
export interface RankingOutput {
	/** Ranked proposals (highest score first) */
	rankings: ScoredProposalRanking[];
	/** Number of proposals ranked */
	total: number;
}

/**
 * Proposal Ranking Engine.
 *
 * Ranks scoring outputs to determine proposal priority.
 */
export class ProposalRankingEngine {
	/**
	 * Rank scoring outputs by total score (highest first).
	 *
	 * @param input - Ranking input with scoring results
	 * @returns Ranked proposals with position metadata
	 */
	rank(input: RankingInput): RankingOutput {
		const { results, rubricWeights } = input;

		// Apply rubric weights if provided
		let adjusted = results;
		if (rubricWeights && Object.keys(rubricWeights).length > 0) {
			adjusted = results.map((r) => ({
				...r,
				total_score: r.total_score * (rubricWeights[r.rubric_id] ?? 1.0),
			}));
		}

		// Sort by total_score descending
		const sorted = [...adjusted].sort((a, b) => b.total_score - a.total_score);

		// Assign ranks
		const rankings: ScoredProposalRanking[] = sorted.map((result, index) => ({
			proposal_id: result.proposal_id,
			rubric_id: result.rubric_id,
			total_score: result.total_score,
			max_score: result.max_score,
			percentage: result.percentage,
			summary: result.summary,
			rank: index + 1,
			total_ranked: sorted.length,
		}));

		return {
			rankings,
			total: rankings.length,
		};
	}

	/**
	 * Rank proposals by their latest scores from the database.
	 *
	 * For each proposal, uses the most recent score entry per rubric.
	 *
	 * @param scores - Array of proposal scores from the database
	 * @returns Ranked proposals
	 */
	rankFromDbScores(scores: ProposalScore[]): RankingOutput {
		// Group by proposal_id and get latest per proposal
		const latestPerProposal = new Map<string, ProposalScore>();

		for (const score of scores) {
			const existing = latestPerProposal.get(score.proposal_id);
			if (!existing || score.scored_at > existing.scored_at) {
				latestPerProposal.set(score.proposal_id, score);
			}
		}

		const results: ScoringOutput[] = Array.from(latestPerProposal.values()).map((s) => ({
			proposal_id: s.proposal_id,
			rubric_id: s.rubric_id,
			scores: s.scores,
			total_score: s.total_score,
			max_score: s.max_score,
			percentage: s.max_score > 0 ? (s.total_score / s.max_score) * 100 : 0,
			summary: s.summary ?? "",
			scored_by: s.scored_by,
		}));

		return this.rank({ results });
	}
}
