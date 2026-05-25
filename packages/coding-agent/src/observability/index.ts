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

// Re-export all types
export {
	ALL_OBSERVABILITY_SEVERITIES,
	ALL_OBSERVABILITY_STATUSES,
	type CorrelationModel,
	EMPTY_CORRELATION,
	type ObservabilityEvent,
	type ObservabilitySeverity,
	type ObservabilityStatus,
	type TraceContext,
	type ValidationResult,
	isValidSeverity,
	isValidStatus,
	isValidTimestamp,
	validateObservabilityEvent,
} from "./types.js";

// Re-export schema factories and serialization
export {
	createObservabilityEvent,
	createTraceContext,
	deserializeObservabilityEvent,
	deserializeTraceContext,
	serializeObservabilityEvent,
	serializeTraceContext,
} from "./schema.js";

// Re-export correlation helpers
export {
	correlationFromTraceContext,
	createCorrelation,
	formatCorrelation,
	isCorrelationEmpty,
	isCorrelationPopulated,
	mergeCorrelation,
} from "./correlation.js";

// Re-export telemetry store (25.B)
export {
	type FlushResult,
	type TelemetryFlushTarget,
	type TelemetryQueryFilter,
	type TelemetryStoreConfig,
	type TelemetryStoreDiagnostics,
	DEFAULT_TELEMETRY_STORE_CONFIG,
	InMemoryTelemetryStore,
} from "./telemetry-store.js";

// Re-export retention engine (25.B)
export {
	type DedupeConfig,
	type PruneResult,
	type RetentionBudget,
	type RetentionPolicy,
	type RetentionRule,
	DEFAULT_DEDUPE_CONFIG,
	DEFAULT_RETENTION_BUDGET,
	DEFAULT_RETENTION_POLICY,
	RetentionEngine,
} from "./retention.js";

// Re-export query API (25.B)
export {
	type Aggregation,
	type AggregationFunction,
	type AggregationResult,
	type ErrorAnalysis,
	type EventStatistics,
	type TelemetryQuery,
	type TimeBucketConfig,
	type TimeSeriesPoint,
	type TimeSeriesResult,
	TelemetryQueryApi,
} from "./query-api.js";
