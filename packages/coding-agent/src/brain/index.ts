/**
 * Brain — Pi V2 second-brain cognitive OS module.
 *
 * This barrel file re-exports all public types and helpers
 * from the brain sub-modules.
 */

export type { MemoryCorrectionRecord, MemoryListResult, SupersedeResult } from "./memory/api.js";
// Memory Correction API (P14.F)
export { MemoryCorrectionApi } from "./memory/api.js";
export type { LifecycleConfig, LifecycleTransition } from "./memory/lifecycle.js";
// Memory Lifecycle Engine (P14.C)
export { MemoryLifecycleEngine } from "./memory/lifecycle.js";

// Memory Scoring Engine (P14.D)
export {
	DEFAULT_SCORING_CONFIG,
	MemoryScoringEngine,
	type ScoringConfig,
	type ScoringWeights,
} from "./memory/scoring.js";
export type { MemoryIndex, MemoryIndexEntry, MemoryStoreConfig } from "./memory/store.js";
// Memory Store (P14.B)
export { MemoryStore } from "./memory/store.js";
// Memory Domain Model (P14.A)
export type {
	MemoryConflict,
	MemoryLifecycle,
	MemoryProvenance,
	MemoryQuery,
	MemoryRecord,
	MemoryScore,
	MemorySourceRef,
	MemoryStats,
	MemoryType,
} from "./memory/types.js";
export {
	ALL_CONFLICT_TYPES,
	ALL_MEMORY_LIFECYCLES,
	ALL_MEMORY_SOURCE_REF_TYPES,
	ALL_MEMORY_TYPES,
	ALL_RESOLUTION_TYPES,
	ALL_VALIDATED_BY,
	computeMemoryScore,
	computeMemoryStats,
	createMemoryConflict,
	createMemoryRecord,
	deserializeMemoryConflict,
	deserializeMemoryRecord,
	MAX_QUERY_LIMIT,
	serializeMemoryConflict,
	serializeMemoryRecord,
	validateMemoryConflict,
	validateMemoryQuery,
	validateMemoryRecord,
} from "./memory/types.js";
export {
	ExecutionJournalObserver,
	ObservationEngine,
	type ObservationEngineConfig,
	type ObservationResult,
	type Observer,
	type ObserverOutput,
	QueueHealthObserver,
	RetryFailureSignalExtractor,
} from "./observation-engine.js";
export type {
	OvernightConfig,
	OvernightStopCondition,
	PlanQueueRef,
	RunProgress,
	RunSession,
	RunStatus,
} from "./overnight/index.js";
// Overnight Run Orchestration (P20.A)
export {
	DEFAULT_OVERNIGHT_CONFIG,
	OvernightOrchestrator,
	SessionStore,
} from "./overnight/index.js";
export {
	type AppendEventResult,
	BrainTimelineStore,
	type BrainTimelineStoreConfig,
	InMemoryBrainTimelineStore,
	MAX_ARCHIVES,
	MAX_TIMELINE_FILE_SIZE,
	type TimelineQueryOptions,
	type TimelineQueryResult,
	type TimelineStoreStats,
} from "./timeline-store.js";
export type {
	BrainObservation,
	BrainSignal,
	BrainTimelineEvent,
	EventSource,
	ProvenanceInfo,
	Severity,
	SignalType,
	SourceRef,
	SourceRefType,
	TimelineEventType,
	ValidationResult,
} from "./types.js";
export {
	ALL_EVENT_SOURCES,
	ALL_SEVERITIES,
	ALL_SIGNAL_TYPES,
	ALL_SOURCE_REF_TYPES,
	ALL_TIMELINE_EVENT_TYPES,
	createBrainObservation,
	createBrainSignal,
	createBrainTimelineEvent,
	deserializeBrainObservation,
	deserializeBrainSignal,
	deserializeBrainTimelineEvent,
	serializeBrainObservation,
	serializeBrainSignal,
	serializeBrainTimelineEvent,
	validateBrainObservation,
	validateBrainSignal,
	validateBrainTimelineEvent,
} from "./types.js";
