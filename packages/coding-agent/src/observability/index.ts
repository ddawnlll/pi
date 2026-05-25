/**
 * Observability module: event schema, trace IDs, and correlation model (25.A).
 *
 * This module provides distributed tracing primitives for the execution engine:
 *
 * - **types.ts**: Core type definitions (TraceContext, CorrelationModel,
 *   ObservabilityEvent, severity/status enums, type guards, validation)
 * - **schema.ts**: Event factories, serialization/deserialization
 * - **correlation.ts**: Correlation model helpers (merge, extract, format)
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
