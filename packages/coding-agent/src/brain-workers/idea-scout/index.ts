/**
 * Idea Scout Worker — 25.K
 *
 * Barrel file re-exporting all idea-scout modules.
 *
 * @packageDocumentation
 */

export {
	createIdeaDeduper,
	DEFAULT_IDEA_DEDUPER_CONFIG,
	IdeaDeduper,
	type IdeaDeduperConfig,
	type IdeaDeduperStats,
} from "./idea-deduper.js";
export {
	ALL_IDEA_PRIORITIES,
	ALL_SCOUT_SESSION_STATUSES,
	createIdeaScoutContract,
	createIdeaScoutWorker,
	DEFAULT_IDEA_SCOUT_BUDGET,
	DEFAULT_IDEA_SCOUT_DEDUP_CONFIG,
	DEFAULT_IDEA_SCOUT_WORKER_CONFIG,
	type IdeaPriority,
	IdeaScoutWorker,
	type IdeaScoutWorkerConfig,
	type IdeaScoutWorkerStats,
	type IdeaSourceRef,
	type IdeaTrend,
	IdeaTrendDetector,
	type IdeaTrendDetector as IdeaTrendDetectorType,
	type MinedSignal,
	type ScoutedIdea,
	type ScoutSession,
	type ScoutSessionStatus,
} from "./idea-scout-worker.js";
export {
	createSignalMiner,
	DEFAULT_SIGNAL_MINER_CONFIG,
	type MiningObservation,
	type MiningSignal,
	SignalMiner,
	type SignalMinerConfig,
} from "./signal-miner.js";
