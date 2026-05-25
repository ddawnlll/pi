/**
 * Observability module: event schema, trace IDs, correlation model, telemetry store,
 * retention policies, and query API (25.A, 25.B).
 *
 * This module provides distributed tracing primitives for the execution engine,
 * plus a local telemetry store, retention engine, and high-level query API.
 *
 * Sub-modules:
 * - **types.ts**: Core type definitions (TraceContext, CorrelationModel,
 *   ObservabilityEvent, severity/status enums, type guards, validation)
 * - **schema.ts**: Event factories, serialization/deserialization
 * - **correlation.ts**: Correlation model helpers (merge, extract, format)
 * - **telemetry-store.ts**: In-memory telemetry store with batch flushing
 * - **retention.ts**: Retention policies, pruning, deduplication
 * - **query-api.ts**: High-level aggregation, statistics, time-series queries
 *
 * The TraceManager class (in core/observability.ts) orchestrates trace/span
 * lifecycle using these types and schema.
 *
 * @module observability
 */

// Re-export brain collectors (25.G)
export {
	BrainCollector,
	type BrainCollectorBudget,
	type BrainCollectorBufferEntry,
	type BrainCollectorCooldown,
	type BrainCollectorDedupeConfig,
	type BrainCollectorDedupeEntry,
	type BrainCollectorDiagnostics,
	type BrainCollectorStopCondition,
	DEFAULT_BRAIN_COLLECTOR_BUDGET,
	DEFAULT_BRAIN_COLLECTOR_DEDUPE,
	type OvernightCollectorBudget,
	type OvernightCollectorBufferEntry,
	type OvernightCollectorCooldown,
	type OvernightCollectorDedupeConfig,
	type OvernightCollectorDedupeEntry,
	type OvernightCollectorDiagnostics,
	type OvernightCollectorEventType,
	type OvernightCollectorStopCondition,
	OvernightCollector,
	DEFAULT_OVERNIGHT_COLLECTOR_BUDGET,
	DEFAULT_OVERNIGHT_COLLECTOR_DEDUPE,
	type ProposalCollectorBudget,
	type ProposalCollectorBufferEntry,
	type ProposalCollectorCooldown,
	type ProposalCollectorDedupeConfig,
	type ProposalCollectorDedupeEntry,
	type ProposalCollectorDiagnostics,
	type ProposalCollectorEventType,
	type ProposalCollectorStopCondition,
	type ProposalDedupeInput,
	type ProposalScoreInput,
	type ProposalStatusChangeInput,
	ProposalCollector,
	DEFAULT_PROPOSAL_COLLECTOR_BUDGET,
	DEFAULT_PROPOSAL_COLLECTOR_DEDUPE,
} from "./collectors/brain/index.js";

// Re-export correlation helpers
export {
	correlationFromTraceContext,
	createCorrelation,
	formatCorrelation,
	isCorrelationEmpty,
	isCorrelationPopulated,
	mergeCorrelation,
} from "./correlation.js";
// Re-export query API (25.B)
export {
	type Aggregation,
	type AggregationFunction,
	type AggregationResult,
	type ErrorAnalysis,
	type EventStatistics,
	type TelemetryQuery,
	TelemetryQueryApi,
	type TimeBucketConfig,
	type TimeSeriesPoint,
	type TimeSeriesResult,
} from "./query-api.js";
// Re-export retention engine (25.B)
export {
	DEFAULT_DEDUPE_CONFIG,
	DEFAULT_RETENTION_BUDGET,
	DEFAULT_RETENTION_POLICY,
	type DedupeConfig,
	type PruneResult,
	type RetentionBudget,
	RetentionEngine,
	type RetentionPolicy,
	type RetentionRule,
} from "./retention.js";
// Re-export schema factories and serialization
export {
	createObservabilityEvent,
	createTraceContext,
	deserializeObservabilityEvent,
	deserializeTraceContext,
	serializeObservabilityEvent,
	serializeTraceContext,
} from "./schema.js";
// Re-export telemetry store (25.B)
export {
	DEFAULT_TELEMETRY_STORE_CONFIG,
	type FlushResult,
	InMemoryTelemetryStore,
	type TelemetryFlushTarget,
	type TelemetryQueryFilter,
	type TelemetryStoreConfig,
	type TelemetryStoreDiagnostics,
} from "./telemetry-store.js";
// Re-export file telemetry target (25.B)
export {
	DEFAULT_FILE_TELEMETRY_TARGET_CONFIG,
	FileTelemetryFlushTarget,
	type FileTelemetryTargetConfig,
} from "./store/file-telemetry-target.js";
// Re-export all types
export {
	ALL_OBSERVABILITY_SEVERITIES,
	ALL_OBSERVABILITY_STATUSES,
	type CorrelationModel,
	EMPTY_CORRELATION,
	isValidSeverity,
	isValidStatus,
	isValidTimestamp,
	type ObservabilityEvent,
	type ObservabilitySeverity,
	type ObservabilityStatus,
	type TraceContext,
	type ValidationResult,
	validateObservabilityEvent,
} from "./types.js";
