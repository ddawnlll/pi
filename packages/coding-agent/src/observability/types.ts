/**
 * Observability core types: severity, status, trace context, correlation model, and event schema.
 *
 * These types form the foundation for distributed tracing and cross-cutting
 * observability in the execution engine. Every span, event, and correlation
 * identifier is rooted in these type definitions.
 *
 * @module observability/types
 */

// ─────────────────────────────────────────────────────────────────────
// Severity and Status
// ─────────────────────────────────────────────────────────────────────

/**
 * Severity levels for observability events.
 */
export type ObservabilitySeverity = "debug" | "info" | "warning" | "error" | "critical";

/**
 * All valid ObservabilitySeverity values.
 */
export const ALL_OBSERVABILITY_SEVERITIES: ObservabilitySeverity[] = ["debug", "info", "warning", "error", "critical"];

/**
 * Status of a span or operation.
 */
export type ObservabilityStatus = "ok" | "error" | "running" | "unknown";

/**
 * All valid ObservabilityStatus values.
 */
export const ALL_OBSERVABILITY_STATUSES: ObservabilityStatus[] = ["ok", "error", "running", "unknown"];

// ─────────────────────────────────────────────────────────────────────
// Trace Context
// ─────────────────────────────────────────────────────────────────────

/**
 * Trace context carried through execution.
 *
 * Every span belongs to a trace and may have a parent span.
 * The correlation ID provides cross-cutting linkage across
 * execution hierarchy boundaries.
 */
export interface TraceContext {
	/** Root trace identifier (UUID v4) */
	traceId: string;
	/** Current span identifier (UUID v4) */
	spanId: string;
	/** Parent span identifier (UUID v4, null for root spans) */
	parentSpanId: string | null;
	/** Human-readable span name */
	name: string;
	/** ISO 8601 timestamp when this span started */
	startTime: string;
	/** Correlation model linking to execution hierarchy */
	correlationId: string | null;
	projectId: string | null;
	planExecutionId: string | null;
	workspaceExecutionId: string | null;
	/** Arbitrary metadata attached at span creation */
	metadata: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Correlation Model
// ─────────────────────────────────────────────────────────────────────

/**
 * Correlation model linking events across execution domains.
 *
 * Provides structured identifiers for cross-cutting observability:
 * - correlationId: links events across service/call boundaries (e.g., user request ID)
 * - projectId, planExecutionId, workspaceExecutionId: links to execution hierarchy
 */
export interface CorrelationModel {
	/** Cross-cutting correlation identifier (e.g., user request, webhook ID) */
	correlationId: string | null;
	/** Project UUID */
	projectId: string | null;
	/** Plan execution UUID */
	planExecutionId: string | null;
	/** Workspace execution UUID */
	workspaceExecutionId: string | null;
}

/**
 * Empty correlation model with all null fields.
 */
export const EMPTY_CORRELATION: CorrelationModel = {
	correlationId: null,
	projectId: null,
	planExecutionId: null,
	workspaceExecutionId: null,
};

// ─────────────────────────────────────────────────────────────────────
// Observability Event Schema
// ─────────────────────────────────────────────────────────────────────

/**
 * Standardized observability event for persistence and transport.
 *
 * This is the canonical event format emitted by the observability
 * system. It carries trace/span/correlation identifiers plus
 * structured payload for diagnostics, audit, and replay.
 */
export interface ObservabilityEvent {
	/** Unique event identifier (UUID v4) */
	id: string;
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Event type (e.g., "workspace_start", "tool_call", "completion") */
	eventType: string;
	/** Component that emitted the event */
	source: string;
	/** Severity level */
	severity: ObservabilitySeverity;
	/** Status of the operation */
	status: ObservabilityStatus;
	/** Human-readable event name */
	name: string;
	/** Human-readable description */
	message: string | null;
	/** Trace identifier for distributed tracing */
	traceId: string;
	/** Span identifier */
	spanId: string;
	/** Parent span identifier (null for root spans) */
	parentSpanId: string | null;
	/** Correlation model linking to execution hierarchy */
	correlationId: string | null;
	projectId: string | null;
	planExecutionId: string | null;
	workspaceExecutionId: string | null;
	/** Duration in milliseconds (for completed spans) */
	durationMs: number | null;
	/** Arbitrary event payload */
	data: Record<string, unknown>;
	/** Error information if status is "error" */
	error: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

/**
 * Result of a validation check.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a severity string.
 */
export function isValidSeverity(value: unknown): value is ObservabilitySeverity {
	return typeof value === "string" && (ALL_OBSERVABILITY_SEVERITIES as readonly string[]).includes(value);
}

/**
 * Validate a status string.
 */
export function isValidStatus(value: unknown): value is ObservabilityStatus {
	return typeof value === "string" && (ALL_OBSERVABILITY_STATUSES as readonly string[]).includes(value);
}

/**
 * Validate an ISO 8601 timestamp string.
 */
export function isValidTimestamp(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (value.length === 0) return false;
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
}

/**
 * Validate an ObservabilityEvent object.
 *
 * Returns a ValidationResult with all validation errors collected.
 * A valid event must have all required fields with correct types.
 */
export function validateObservabilityEvent(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const event = value as Record<string, unknown>;

	if (typeof event.id !== "string" || event.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!isValidTimestamp(event.timestamp)) {
		errors.push("timestamp must be a valid ISO 8601 string");
	}
	if (typeof event.eventType !== "string" || event.eventType.length === 0) {
		errors.push("eventType must be a non-empty string");
	}
	if (typeof event.source !== "string" || event.source.length === 0) {
		errors.push("source must be a non-empty string");
	}
	if (!isValidSeverity(event.severity)) {
		errors.push(`severity must be one of: ${ALL_OBSERVABILITY_SEVERITIES.join(", ")}`);
	}
	if (!isValidStatus(event.status)) {
		errors.push(`status must be one of: ${ALL_OBSERVABILITY_STATUSES.join(", ")}`);
	}
	if (typeof event.name !== "string" || event.name.length === 0) {
		errors.push("name must be a non-empty string");
	}
	if (event.message !== null && typeof event.message !== "string") {
		errors.push("message must be a string or null");
	}
	if (typeof event.traceId !== "string" || event.traceId.length === 0) {
		errors.push("traceId must be a non-empty string");
	}
	if (typeof event.spanId !== "string" || event.spanId.length === 0) {
		errors.push("spanId must be a non-empty string");
	}
	if (event.parentSpanId !== null && typeof event.parentSpanId !== "string") {
		errors.push("parentSpanId must be a string or null");
	}
	if (event.correlationId !== null && typeof event.correlationId !== "string") {
		errors.push("correlationId must be a string or null");
	}
	if (event.projectId !== null && typeof event.projectId !== "string") {
		errors.push("projectId must be a string or null");
	}
	if (event.planExecutionId !== null && typeof event.planExecutionId !== "string") {
		errors.push("planExecutionId must be a string or null");
	}
	if (event.workspaceExecutionId !== null && typeof event.workspaceExecutionId !== "string") {
		errors.push("workspaceExecutionId must be a string or null");
	}
	if (event.durationMs !== null && typeof event.durationMs !== "number") {
		errors.push("durationMs must be a number or null");
	}
	if (typeof event.data !== "object" || event.data === null) {
		errors.push("data must be a non-null object");
	}
	if (event.error !== null && typeof event.error !== "string") {
		errors.push("error must be a string or null");
	}

	return { valid: errors.length === 0, errors };
}
