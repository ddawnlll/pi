/**
 * Idea Scout Worker — 25.K
 *
 * Barrel file re-exporting all idea-scout modules.
 *
 * @packageDocumentation
 */

export {
	ALL_IDEA_PRIORITIES,
	ALL_SCOUT_SESSION_STATUSES,
	createIdeaScoutContract,
	createIdeaScoutWorker,
	DEFAULT_IDEA_SCOUT_BUDGET,
	DEFAULT_IDEA_SCOUT_DEDUP_CONFIG,
	DEFAULT_IDEA_SCOUT_WORKER_CONFIG,
	IdeaScoutWorker,
	type IdeaPriority,
	type IdeaScoutWorkerConfig,
	type IdeaScoutWorkerStats,
	type IdeaSourceRef,
	type IdeaTrend,
	type MinedSignal,
	type ScoutedIdea,
	type ScoutSession,
	type ScoutSessionStatus,
} from "./idea-scout-worker.js";

export {
	IdeaTrendDetector,
	type IdeaTrendDetector as IdeaTrendDetectorType,
} from "./idea-scout-worker.js";
