/**
 * Temporal Journal v2 — Barrel Exports
 *
 * Daily, weekly, monthly, and entity-scoped temporal journals that answer
 * what happened, what repeated, and what changed over time.
 *
 * Acceptance Criteria (V5.01):
 * 1. The system can answer "what got stuck last week?" from stored temporal rollups.
 * 2. Temporal events include evidence references and stable entity IDs where possible.
 * 3. Rollups are deterministic and can be regenerated from source events.
 * 4. No private chain-of-thought is stored; only safe summaries and evidence-backed facts.
 *
 * @packageDocumentation
 */

export {
	computePeriodBoundaries,
	computeRollupDeterministicHash,
	detectChanges,
	detectRepeatedPatterns,
	detectStuckItems,
	generateRollup,
	TemporalEngine,
} from "./engine.js";
export { InMemoryTemporalJournalStore } from "./store.js";
export type {
	StuckItem,
	TemporalEngineConfig,
	TemporalEntityJournal,
	TemporalEntityType,
	TemporalEvent,
	TemporalEventQuery,
	TemporalEvidenceRef,
	TemporalJournalStore,
	TemporalRollup,
	TemporalRollupQuery,
} from "./types.js";
export { DEFAULT_TEMPORAL_ENGINE_CONFIG } from "./types.js";
