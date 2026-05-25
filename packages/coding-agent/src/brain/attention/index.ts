/**
 * Attention Ranking — 24.I
 *
 * Barrel file for the attention ranking sub-module.
 * Re-exports all public types and the AttentionRanker class.
 */

export { AttentionRanker } from "./attention-ranking.js";
export type {
	FeedbackEntry,
	FeedbackItemType,
	FeedbackQuery,
	FeedbackQueryResult,
	FeedbackRating,
	FeedbackStats,
} from "./feedback-store.js";
// 24.J — Feedback Store
export {
	ALL_FEEDBACK_ITEM_TYPES,
	createFeedbackEntry,
	FeedbackStore,
	validateFeedbackEntry,
} from "./feedback-store.js";
export type {
	AttentionSnapshot,
	MomentumConfig,
	MomentumDirection,
	MomentumResult,
	StalenessCheckableType,
	StalenessDetectorConfig,
	StalenessResult,
	StalenessScanResult,
	StalenessThresholds,
} from "./staleness-detector.js";
export {
	DEFAULT_MOMENTUM_CONFIG,
	DEFAULT_STALENESS_DETECTOR_CONFIG,
	DEFAULT_STALENESS_THRESHOLDS,
	StalenessDetector,
} from "./staleness-detector.js";
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
