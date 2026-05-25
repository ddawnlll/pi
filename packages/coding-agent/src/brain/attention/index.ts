/**
 * Attention Ranking — 24.I
 *
 * Barrel file for the attention ranking sub-module.
 * Re-exports all public types and the AttentionRanker class.
 */

export { AttentionRanker } from "./attention-ranking.js";
export type {
	AttentionCategory,
	AttentionItem,
	AttentionRankingConfig,
	AttentionRankingResult,
} from "./types.js";
export {
	ALL_ATTENTION_CATEGORIES,
	computeRecencyScore,
	createAttentionItem,
	DEFAULT_ATTENTION_RANKING_CONFIG,
	SEVERITY_SCORES,
	validateAttentionItem,
} from "./types.js";
