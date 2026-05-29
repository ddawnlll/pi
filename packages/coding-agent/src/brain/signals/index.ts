/**
 * Signal & Anomaly Engine — Barrel Exports (V5.06)
 *
 * Core signal detection, deduplication, and feeding logic.
 *
 * @packageDocumentation
 */

export { createSignalEngine, SignalEngine } from "./engine.js";
export type {
	CooldownConfig,
	DecisionImpactContext,
	FeedRoutingConfig,
	SignalDedupKey,
	SignalEngineConfig,
	SignalEngineState,
	SignalFeedTarget,
	ValidationRepeatConfig,
	ValidationSignature,
} from "./types.js";
export {
	DEFAULT_COOLDOWN_CONFIG,
	DEFAULT_FEED_ROUTING,
	DEFAULT_SIGNAL_ENGINE_CONFIG,
	DEFAULT_VALIDATION_REPEAT_CONFIG,
	formatDedupKey,
	parseDedupKey,
} from "./types.js";
