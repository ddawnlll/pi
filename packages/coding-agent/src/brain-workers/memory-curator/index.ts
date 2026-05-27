/**
 * Memory Curator Worker — 25.M
 *
 * Barrel file re-exporting all memory curator modules.
 *
 * @packageDocumentation
 */

export {
	ConflictReviewer,
	type ConflictReviewerConfig,
	type ConflictReviewerStats,
	type ConflictReviewResult,
	type ConflictReviewStatus,
	createConflictReviewer,
	DEFAULT_CONFLICT_REVIEWER_CONFIG,
	type ResolutionStrategy,
} from "./conflict-review.js";
export {
	ALL_COMPACTION_ACTION_TYPES,
	ALL_CURATION_SESSION_STATUSES,
	ALL_MEMORY_CONFLICT_TYPES,
	type CompactionAction,
	type CompactionActionType,
	type CurationSession,
	type CurationSessionStatus,
	type CuratorConflict,
	createMemoryCuratorContract,
	createMemoryCuratorWorker,
	DEFAULT_MEMORY_CURATOR_BUDGET,
	DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG,
	DEFAULT_MEMORY_CURATOR_WORKER_CONFIG,
	type MemoryConflictType,
	MemoryCuratorWorker,
	type MemoryCuratorWorkerConfig,
	type MemoryCuratorWorkerStats,
} from "./memory-curator-worker.js";
export {
	createStaleMemoryDetector,
	DEFAULT_STALE_MEMORY_DETECTOR_CONFIG,
	type MemoryRecordInfo,
	type StaleAction,
	StaleMemoryDetector,
	type StaleMemoryDetectorConfig,
	type StaleMemoryDetectorStats,
	type StaleMemoryRecord,
	type StalenessReason,
} from "./stale-memory-detector.js";
