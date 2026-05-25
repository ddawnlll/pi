/**
 * Observability event schema, trace IDs, and correlation model (25.A).
 *
 * This file is the backward-compatible re-export boundary. All type
 * definitions, factories, serialization, and correlation helpers are
 * now in src/observability/. The TraceManager class lives here because
 * it is the orchestration layer consumed by the rest of the codebase.
 *
 * Migration path: consumers can move to `import { ... } from "../observability/index.js"`
 * for direct access to types and helpers.
 *
 * @module core/observability
 */

// Re-export all types, schema, and correlation helpers from the modular structure.
// Type-only re-exports use `export type { ... }` for proper isolatedModules compat.
export {
	ALL_OBSERVABILITY_SEVERITIES,
	ALL_OBSERVABILITY_STATUSES,
	correlationFromTraceContext,
	createCorrelation,
	createObservabilityEvent,
	createTraceContext,
	deserializeObservabilityEvent,
	deserializeTraceContext,
	EMPTY_CORRELATION,
	formatCorrelation,
	isCorrelationEmpty,
	isCorrelationPopulated,
	isValidSeverity,
	isValidStatus,
	isValidTimestamp,
	mergeCorrelation,
	serializeObservabilityEvent,
	serializeTraceContext,
	validateObservabilityEvent,
} from "../observability/index.js";

// 25.B — Telemetry store, retention, and query API exports
export {
	type FlushResult,
	type TelemetryFlushTarget,
	type TelemetryQueryFilter,
	type TelemetryStoreConfig,
	type TelemetryStoreDiagnostics,
	DEFAULT_TELEMETRY_STORE_CONFIG,
	InMemoryTelemetryStore,
	type DedupeConfig,
	type PruneResult,
	type RetentionBudget,
	type RetentionPolicy,
	type RetentionRule,
	DEFAULT_DEDUPE_CONFIG,
	DEFAULT_RETENTION_BUDGET,
	DEFAULT_RETENTION_POLICY,
	RetentionEngine,
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
} from "../observability/index.js";

export type {
	CorrelationModel,
	ObservabilityEvent,
	ObservabilitySeverity,
	ObservabilityStatus,
	TraceContext,
	ValidationResult,
} from "../observability/index.js";

// ─────────────────────────────────────────────────────────────────────
// TraceManager — trace/span lifecycle management
// ─────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import {
	createObservabilityEvent,
	createTraceContext,
} from "../observability/index.js";

import type {
	CorrelationModel,
	ObservabilityEvent,
	ObservabilityStatus,
	TraceContext,
} from "../observability/index.js";

/**
 * Callback for span lifecycle events.
 */
export type SpanEventHandler = (event: ObservabilityEvent) => void;

/**
 * TraceManager manages distributed trace and span lifecycle.
 *
 * Features:
 * - Start/end traces and nested spans
 * - Async-safe context management (no global state)
 * - Event callbacks for persistence or transport
 * - Correlation model propagation
 * - Duration tracking
 *
 * The TraceManager is designed to be instantiated per-component
 * (e.g., one per workspace execution) with optional event handlers
 * that can persist events to the database.
 */
export class TraceManager {
	/** Active trace contexts by traceId */
	private traces = new Map<string, TraceContext>();
	/** Active span stack by traceId */
	private spanStacks = new Map<string, TraceContext[]>();
	/** Span start times for duration calculation */
	private spanStartTimes = new Map<string, number>();

	/** Optional event handler for span events */
	private eventHandler: SpanEventHandler | null = null;

	/**
	 * Set the event handler for span lifecycle events.
	 *
	 * The handler is called for each span start and end event.
	 * Use this to persist events to the database or send to
	 * a transport layer.
	 */
	setEventHandler(handler: SpanEventHandler | null): void {
		this.eventHandler = handler;
	}

	/**
	 * Start a new trace with a root span.
	 *
	 * @param name - Human-readable trace/span name
	 * @param correlation - Optional correlation model
	 * @param metadata - Optional arbitrary metadata
	 * @returns TraceContext for the root span
	 */
	startTrace(
		name: string,
		correlation?: Partial<CorrelationModel>,
		metadata?: Record<string, unknown>,
	): TraceContext {
		const context = createTraceContext({
			name,
			parentSpanId: null,
			correlationId: correlation?.correlationId ?? null,
			projectId: correlation?.projectId ?? null,
			planExecutionId: correlation?.planExecutionId ?? null,
			workspaceExecutionId: correlation?.workspaceExecutionId ?? null,
			metadata: metadata ?? {},
		});

		this.traces.set(context.traceId, context);
		this.spanStacks.set(context.traceId, [context]);
		this.spanStartTimes.set(context.spanId, Date.now());

		// Emit span start event
		if (this.eventHandler) {
			this.eventHandler(
				createObservabilityEvent(context, {
					eventType: "span_start",
					source: "trace_manager",
					severity: "info",
					status: "running",
				}),
			);
		}

		return context;
	}

	/**
	 * Start a child span within an existing trace.
	 *
	 * @param parentContext - Parent TraceContext
	 * @param name - Span name
	 * @param metadata - Optional arbitrary metadata
	 * @returns New child TraceContext
	 */
	startSpan(
		parentContext: TraceContext,
		name: string,
		metadata?: Record<string, unknown>,
	): TraceContext {
		const childContext = createTraceContext({
			traceId: parentContext.traceId,
			parentSpanId: parentContext.spanId,
			name,
			correlationId: parentContext.correlationId,
			projectId: parentContext.projectId,
			planExecutionId: parentContext.planExecutionId,
			workspaceExecutionId: parentContext.workspaceExecutionId,
			metadata: { ...parentContext.metadata, ...metadata },
		});

		// Push onto span stack for this trace
		const stack = this.spanStacks.get(childContext.traceId) ?? [];
		stack.push(childContext);
		this.spanStacks.set(childContext.traceId, stack);
		this.spanStartTimes.set(childContext.spanId, Date.now());

		// Emit span start event
		if (this.eventHandler) {
			this.eventHandler(
				createObservabilityEvent(childContext, {
					eventType: "span_start",
					source: "trace_manager",
					severity: "info",
					status: "running",
				}),
			);
		}

		return childContext;
	}

	/**
	 * End a span and record its duration.
	 *
	 * @param context - Span context to end
	 * @param status - Final status (ok, error)
	 * @param data - Optional result data
	 * @param error - Optional error message
	 * @returns Duration in milliseconds, or null if start time not tracked
	 */
	endSpan(
		context: TraceContext,
		status: ObservabilityStatus = "ok",
		data?: Record<string, unknown>,
		error?: string | null,
	): number | null {
		const startTime = this.spanStartTimes.get(context.spanId);
		const durationMs = startTime !== undefined ? Date.now() - startTime : null;

		// Clean up span start time
		this.spanStartTimes.delete(context.spanId);

		// Pop from span stack
		const stack = this.spanStacks.get(context.traceId);
		if (stack) {
			const idx = stack.findIndex((s) => s.spanId === context.spanId);
			if (idx >= 0) {
				stack.splice(idx, 1);
			}
			if (stack.length === 0) {
				this.spanStacks.delete(context.traceId);
			}
		}

		// Emit span end event
		if (this.eventHandler) {
			this.eventHandler(
				createObservabilityEvent(context, {
					eventType: "span_end",
					source: "trace_manager",
					severity: status === "error" ? "error" : "info",
					status,
					durationMs,
					data: data ?? {},
					error: error ?? null,
				}),
			);
		}

		return durationMs;
	}

	/**
	 * End an entire trace and all its remaining spans.
	 *
	 * @param context - Root span context
	 * @param status - Final status
	 * @param data - Optional result data
	 * @returns Duration in milliseconds, or null
	 */
	endTrace(
		context: TraceContext,
		status: ObservabilityStatus = "ok",
		data?: Record<string, unknown>,
	): number | null {
		// End any remaining child spans
		const stack = this.spanStacks.get(context.traceId);
		if (stack) {
			for (const span of [...stack]) {
				if (span.spanId !== context.spanId) {
					this.endSpan(span, status, data);
				}
			}
		}

		// End the root span
		const duration = this.endSpan(context, status, data);

		// Clean up trace
		this.traces.delete(context.traceId);

		return duration;
	}

	/**
	 * Get the current span stack for a trace.
	 *
	 * @param traceId - Trace UUID
	 * @returns Array of active spans (innermost last), or empty array
	 */
	getActiveSpans(traceId: string): TraceContext[] {
		return this.spanStacks.get(traceId) ?? [];
	}

	/**
	 * Get the innermost active span for a trace.
	 *
	 * @param traceId - Trace UUID
	 * @returns Current span context, or null if no active spans
	 */
	getCurrentSpan(traceId: string): TraceContext | null {
		const stack = this.spanStacks.get(traceId);
		return stack && stack.length > 0 ? stack[stack.length - 1] : null;
	}

	/**
	 * Check if a trace is still active.
	 *
	 * @param traceId - Trace UUID
	 * @returns True if the trace exists and has active spans
	 */
	isTraceActive(traceId: string): boolean {
		return this.traces.has(traceId);
	}

	/**
	 * Clear all traces and spans.
	 */
	clear(): void {
		this.traces.clear();
		this.spanStacks.clear();
		this.spanStartTimes.clear();
	}

	/**
	 * Get the number of active traces.
	 */
	get activeTraceCount(): number {
		return this.traces.size;
	}
}
