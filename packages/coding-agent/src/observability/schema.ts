/**
 * Observability event schema: serialization, deserialization, and event factory.
 *
 * This module provides:
 * - createTraceContext: factory for trace contexts with sensible defaults
 * - createObservabilityEvent: factory for events linked to a trace context
 * - serializeObservabilityEvent: JSON serialization with full type fidelity
 * - deserializeObservabilityEvent: JSON deserialization with validation
 * - serializeTraceContext / deserializeTraceContext: context persistence
 *
 * The schema is the persistence boundary for observability data. All events
 * are serialized as JSON and validated on deserialization to prevent corrupt
 * data from entering the system.
 *
 * @module observability/schema
 */

import { randomUUID } from "node:crypto";
import type {
	ObservabilityEvent,
	ObservabilitySeverity,
	ObservabilityStatus,
	TraceContext,
} from "./types.js";
import { validateObservabilityEvent } from "./types.js";
import type { CorrelationModel } from "./types.js";

// ─────────────────────────────────────────────────────────────────────
// Factory functions
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a new TraceContext with defaults.
 *
 * @param overrides - Partial fields; name is required. traceId and spanId
 *                    default to UUID v4 if not provided.
 * @returns A fully populated TraceContext
 */
export function createTraceContext(
	overrides: Partial<
		Omit<TraceContext, "traceId" | "spanId" | "startTime">
	> & {
		traceId?: string;
		spanId?: string;
		name: string;
	},
): TraceContext {
	return {
		traceId: overrides.traceId ?? randomUUID(),
		spanId: overrides.spanId ?? randomUUID(),
		parentSpanId: overrides.parentSpanId ?? null,
		name: overrides.name,
		startTime: new Date().toISOString(),
		correlationId: overrides.correlationId ?? null,
		projectId: overrides.projectId ?? null,
		planExecutionId: overrides.planExecutionId ?? null,
		workspaceExecutionId: overrides.workspaceExecutionId ?? null,
		metadata: overrides.metadata ?? {},
	};
}

/**
 * Create an ObservabilityEvent from a TraceContext and additional data.
 *
 * The event inherits trace IDs and correlation model from the context.
 * Override severity, status, name, message, duration, data, and error
 * via the overrides parameter.
 *
 * @param context - Active TraceContext (determines traceId, spanId, correlation fields)
 * @param overrides - Event-specific fields
 * @returns A fully populated ObservabilityEvent
 */
export function createObservabilityEvent(
	context: TraceContext,
	overrides: {
		eventType: string;
		source: string;
		severity?: ObservabilitySeverity;
		status?: ObservabilityStatus;
		name?: string;
		message?: string | null;
		durationMs?: number | null;
		data?: Record<string, unknown>;
		error?: string | null;
	},
): ObservabilityEvent {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		timestamp: now,
		eventType: overrides.eventType,
		source: overrides.source,
		severity: overrides.severity ?? "info",
		status: overrides.status ?? "ok",
		name: overrides.name ?? context.name,
		message: overrides.message ?? null,
		traceId: context.traceId,
		spanId: context.spanId,
		parentSpanId: context.parentSpanId,
		correlationId: context.correlationId,
		projectId: context.projectId,
		planExecutionId: context.planExecutionId,
		workspaceExecutionId: context.workspaceExecutionId,
		durationMs: overrides.durationMs ?? null,
		data: overrides.data ?? {},
		error: overrides.error ?? null,
	};
}

// ─────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────

/**
 * Serialize an ObservabilityEvent to JSON.
 *
 * @param event - The event to serialize
 * @returns JSON string representation
 */
export function serializeObservabilityEvent(event: ObservabilityEvent): string {
	return JSON.stringify(event);
}

/**
 * Deserialize a JSON string to an ObservabilityEvent with validation.
 *
 * @param json - JSON string to deserialize
 * @returns Validated ObservabilityEvent
 * @throws If the JSON is invalid or fails schema validation
 */
export function deserializeObservabilityEvent(json: string): ObservabilityEvent {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(
			`Failed to parse ObservabilityEvent JSON: ${(e as Error).message}`,
		);
	}

	const result = validateObservabilityEvent(parsed);
	if (!result.valid) {
		throw new Error(
			`Invalid ObservabilityEvent: ${result.errors.join("; ")}`,
		);
	}

	return parsed as ObservabilityEvent;
}

/**
 * Serialize a TraceContext to JSON.
 *
 * @param context - The trace context to serialize
 * @returns JSON string representation
 */
export function serializeTraceContext(context: TraceContext): string {
	return JSON.stringify(context);
}

/**
 * Deserialize a JSON string to a TraceContext.
 *
 * @param json - JSON string to deserialize
 * @returns Deserialized TraceContext (no validation beyond JSON parse)
 */
export function deserializeTraceContext(json: string): TraceContext {
	return JSON.parse(json) as TraceContext;
}
