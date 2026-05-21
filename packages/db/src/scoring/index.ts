/**
 * Proposal Scoring Engine (P16.C).
 *
 * Evaluates proposals against defined rubrics, computing weighted
 * scores and generating summaries. Supports both manual and
 * automated scoring workflows.
 */

export {
	ProposalRankingEngine,
	type RankingInput,
	type ScoredProposalRanking,
} from "./ranking.js";
export { ProposalScorer, type ScoringInput, type ScoringOutput } from "./scorer.js";
