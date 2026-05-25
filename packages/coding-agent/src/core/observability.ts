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

export type {
	CorrelationModel,
	ObservabilityEvent,
	ObservabilitySeverity,
	ObservabilityStatus,
	TraceContext,
	ValidationResult,
} from "../observability/index.js";
// Re-export all types, schema, and correlation helpers from the modular structure.
// Type-only re-exports use `export type { ... }` for proper isolatedModules compat.
// 25.B — Telemetry store, retention, and query API exports
export {
	type Aggregation,
	type AggregationFunction,
	type AggregationResult,
	ALL_OBSERVABILITY_SEVERITIES,
	ALL_OBSERVABILITY_STATUSES,
	correlationFromTraceContext,
	createCorrelation,
	createObservabilityEvent,
	createTraceContext,
	DEFAULT_DEDUPE_CONFIG,
	DEFAULT_FILE_TELEMETRY_TARGET_CONFIG,
	DEFAULT_RETENTION_BUDGET,
	DEFAULT_RETENTION_POLICY,
	DEFAULT_TELEMETRY_STORE_CONFIG,
	type DedupeConfig,
	deserializeObservabilityEvent,
	deserializeTraceContext,
	EMPTY_CORRELATION,
	type ErrorAnalysis,
	type EventStatistics,
	FileTelemetryFlushTarget,
	type FileTelemetryTargetConfig,
	type FlushResult,
	formatCorrelation,
	InMemoryTelemetryStore,
	isCorrelationEmpty,
	isCorrelationPopulated,
	isValidSeverity,
	isValidStatus,
	isValidTimestamp,
	mergeCorrelation,
	type PruneResult,
	type RetentionBudget,
	RetentionEngine,
	type RetentionPolicy,
	type RetentionRule,
	serializeObservabilityEvent,
	serializeTraceContext,
	type TelemetryFlushTarget,
	type TelemetryQuery,
	TelemetryQueryApi,
	type TelemetryQueryFilter,
	type TelemetryStoreConfig,
	type TelemetryStoreDiagnostics,
	type TimeBucketConfig,
	type TimeSeriesPoint,
	type TimeSeriesResult,
	validateObservabilityEvent,
} from "../observability/index.js";

// Export TraceManager-level types
// Bug fix: TraceManagerConfig and TraceManagerDiagnostics are defined in this file,
// not re-exported from another module. Remove the self-referencing re-export.

// ─────────────────────────────────────────────────────────────────────
// TraceManager — trace/span lifecycle management
// ─────────────────────────────────────────────────────────────────────

import type {
	CorrelationModel,
	ObservabilityEvent,
	ObservabilityStatus,
	TraceContext,
} from "../observability/index.js";
import { createObservabilityEvent, createTraceContext } from "../observability/index.js";

/**
 * Configuration for TraceManager budget/cooldown/dedupe/stop-condition.
 */
export interface TraceManagerConfig {
	/** Maximum number of concurrent active traces (budget). 0 = unlimited. Default 0. */
	maxActiveTraces?: number;
	/** Minimum interval in ms between trace creations (cooldown). 0 = no cooldown. Default 0. */
	minTraceIntervalMs?: number;
	/** Whether to reject duplicate trace IDs when creating new traces. Default false. */
	rejectDuplicateTraceIds?: boolean;
	/** Whether to reject duplicate span IDs within the same trace. Default false. */
	rejectDuplicateSpanIds?: boolean;
}

/**
 * Default configuration for TraceManager.
 */
export const DEFAULT_TRACE_MANAGER_CONFIG: TraceManagerConfig = {
	maxActiveTraces: 0,
	minTraceIntervalMs: 0,
	rejectDuplicateTraceIds: false,
	rejectDuplicateSpanIds: false,
};

/**
 * Diagnostic information about the TraceManager's budget/cooldown/dedupe state.
 */
export interface TraceManagerDiagnostics {
	activeTraceCount: number;
	maxActiveTraces: number;
	minTraceIntervalMs: number;
	rejectDuplicateTraceIds: boolean;
	rejectDuplicateSpanIds: boolean;
	lastTraceTimestamp: string | null;
	cooldownRemainingMs: number | null;
	isStopped: boolean;
	totalTracesStarted: number;
	totalTracesEnded: number;
	totalSpansStarted: number;
	totalSpansEnded: number;
	totalBudgetRejections: number;
	totalCooldownRejections: number;
	totalDedupeRejections: number;
}

/**
 * Callback for span lifecycle events.
 */
export type SpanEventHandler = (event: ObservabilityEvent) => void;

/**
 * Error thrown when a trace operation is rejected by budget, cooldown, or dedupe.
 */
export class TraceManagerError extends Error {
	constructor(
		message: string,
		public readonly code: "budget" | "cooldown" | "dedupe" | "stopped",
		public readonly diagnostics: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "TraceManagerError";
	}
}

/**
 * TraceManager manages distributed trace and span lifecycle.
 *
 * Features:
 * - Start/end traces and nested spans
 * - Async-safe context management (no global state)
 * - Event callbacks for persistence or transport
 * - Correlation model propagation
 * - Duration tracking
 * - Budget enforcement (maxActiveTraces)
 * - Cooldown enforcement (minTraceIntervalMs)
 * - Deduplication (rejectDuplicateTraceIds, rejectDuplicateSpanIds)
 * - Stop-condition (graceful stop)
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

	/** Configuration for budget/cooldown/dedupe/stop */
	private config: Required<TraceManagerConfig>;

	/** Timestamps of last trace creation per trace name (for cooldown) */
	private lastTraceTimestamps = new Map<string, number>();
	/** Timestamp of the last created trace (for cooldown) */
	private lastTraceTimestamp: number | null = null;

	/** Whether the manager has been stopped */
	private stopped = false;

	// Counters for diagnostics
	private totalTracesStarted = 0;
	private totalTracesEnded = 0;
	private totalSpansStarted = 0;
	private totalSpansEnded = 0;
	private totalBudgetRejections = 0;
	private totalCooldownRejections = 0;
	private totalDedupeRejections = 0;

	constructor(config?: TraceManagerConfig) {
		this.config = {
			maxActiveTraces: config?.maxActiveTraces ?? DEFAULT_TRACE_MANAGER_CONFIG.maxActiveTraces!,
			minTraceIntervalMs: config?.minTraceIntervalMs ?? DEFAULT_TRACE_MANAGER_CONFIG.minTraceIntervalMs!,
			rejectDuplicateTraceIds:
				config?.rejectDuplicateTraceIds ?? DEFAULT_TRACE_MANAGER_CONFIG.rejectDuplicateTraceIds!,
			rejectDuplicateSpanIds: config?.rejectDuplicateSpanIds ?? DEFAULT_TRACE_MANAGER_CONFIG.rejectDuplicateSpanIds!,
		};
	}

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
	 * Check whether the manager has been stopped.
	 */
	get isStopped(): boolean {
		return this.stopped;
	}

	/**
	 * Get the current TraceManagerConfig.
	 */
	getConfig(): Required<TraceManagerConfig> {
		return { ...this.config };
	}

	/**
	 * Update the configuration at runtime.
	 */
	updateConfig(overrides: Partial<TraceManagerConfig>): void {
		if (overrides.maxActiveTraces !== undefined) {
			this.config.maxActiveTraces = overrides.maxActiveTraces;
		}
		if (overrides.minTraceIntervalMs !== undefined) {
			this.config.minTraceIntervalMs = overrides.minTraceIntervalMs;
		}
		if (overrides.rejectDuplicateTraceIds !== undefined) {
			this.config.rejectDuplicateTraceIds = overrides.rejectDuplicateTraceIds;
		}
		if (overrides.rejectDuplicateSpanIds !== undefined) {
			this.config.rejectDuplicateSpanIds = overrides.rejectDuplicateSpanIds;
		}
	}

	/**
	 * Stop the TraceManager. No new traces or spans can be created after this.
	 * Existing active traces are left in place (they can still be ended).
	 */
	stop(): void {
		this.stopped = true;
	}

	/**
	 * Start a new trace with a root span.
	 *
	 * Enforces budget (maxActiveTraces), cooldown (minTraceIntervalMs),
	 * dedupe (rejectDuplicateTraceIds), and stop-condition (isStopped).
	 * On rejection, throws TraceManagerError with evidence-backed diagnostics.
	 *
	 * @param name - Human-readable trace/span name
	 * @param correlation - Optional correlation model
	 * @param metadata - Optional arbitrary metadata
	 * @returns TraceContext for the root span
	 * @throws TraceManagerError if budget, cooldown, dedupe, or stop-condition rejects the trace
	 */
	startTrace(name: string, correlation?: Partial<CorrelationModel>, metadata?: Record<string, unknown>): TraceContext {
		// Stop-condition check
		if (this.stopped) {
			this.totalBudgetRejections++;
			throw new TraceManagerError("TraceManager is stopped; cannot create new traces", "stopped", {
				traceName: name,
			});
		}

		// Budget check
		const maxTraces = this.config.maxActiveTraces;
		if (maxTraces > 0 && this.traces.size >= maxTraces) {
			this.totalBudgetRejections++;
			throw new TraceManagerError(
				`Active trace count (${this.traces.size}) exceeds maxActiveTraces budget (${maxTraces})`,
				"budget",
				{
					traceName: name,
					activeTraceCount: this.traces.size,
					maxActiveTraces: maxTraces,
				},
			);
		}

		// Cooldown check
		const cooldownMs = this.config.minTraceIntervalMs;
		if (cooldownMs > 0 && this.lastTraceTimestamp !== null) {
			const elapsed = Date.now() - this.lastTraceTimestamp;
			if (elapsed < cooldownMs) {
				this.totalCooldownRejections++;
				throw new TraceManagerError(
					`Trace creation cooldown active: ${elapsed}ms elapsed, ${cooldownMs}ms required`,
					"cooldown",
					{
						traceName: name,
						elapsedMs: elapsed,
						minTraceIntervalMs: cooldownMs,
						remainingMs: cooldownMs - elapsed,
					},
				);
			}
		}

		const context = createTraceContext({
			name,
			parentSpanId: null,
			correlationId: correlation?.correlationId ?? null,
			projectId: correlation?.projectId ?? null,
			planExecutionId: correlation?.planExecutionId ?? null,
			workspaceExecutionId: correlation?.workspaceExecutionId ?? null,
			metadata: metadata ?? {},
		});

		// Dedupe trace ID check
		if (this.config.rejectDuplicateTraceIds && this.traces.has(context.traceId)) {
			this.totalDedupeRejections++;
			throw new TraceManagerError(`Duplicate trace ID: ${context.traceId}`, "dedupe", {
				traceName: name,
				traceId: context.traceId,
			});
		}

		this.traces.set(context.traceId, context);
		this.spanStacks.set(context.traceId, [context]);
		this.spanStartTimes.set(context.spanId, Date.now());
		this.lastTraceTimestamp = Date.now();
		this.lastTraceTimestamps.set(name, Date.now());
		this.totalTracesStarted++;

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
	 * Enforces stop-condition and dedupe (rejectDuplicateSpanIds).
	 *
	 * @param parentContext - Parent TraceContext
	 * @param name - Span name
	 * @param metadata - Optional arbitrary metadata
	 * @returns New child TraceContext
	 * @throws TraceManagerError if stop-condition or dedupe rejects the span
	 */
	startSpan(parentContext: TraceContext, name: string, metadata?: Record<string, unknown>): TraceContext {
		// Stop-condition check
		if (this.stopped) {
			throw new TraceManagerError("TraceManager is stopped; cannot create new spans", "stopped", {
				parentTraceId: parentContext.traceId,
				spanName: name,
			});
		}

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

		// Dedupe span ID check within the same trace
		if (this.config.rejectDuplicateSpanIds) {
			const stack = this.spanStacks.get(childContext.traceId) ?? [];
			if (stack.some((s) => s.spanId === childContext.spanId)) {
				this.totalDedupeRejections++;
				throw new TraceManagerError(
					`Duplicate span ID: ${childContext.spanId} in trace ${childContext.traceId}`,
					"dedupe",
					{
						traceId: childContext.traceId,
						spanId: childContext.spanId,
						spanName: name,
					},
				);
			}
		}

		// Push onto span stack for this trace
		const stack = this.spanStacks.get(childContext.traceId) ?? [];
		stack.push(childContext);
		this.spanStacks.set(childContext.traceId, stack);
		this.spanStartTimes.set(childContext.spanId, Date.now());
		this.totalSpansStarted++;

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

		this.totalSpansEnded++;

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
	endTrace(context: TraceContext, status: ObservabilityStatus = "ok", data?: Record<string, unknown>): number | null {
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
		this.totalTracesEnded++;

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
	 * Clear all traces and spans. Resets all counters.
	 */
	clear(): void {
		this.traces.clear();
		this.spanStacks.clear();
		this.spanStartTimes.clear();
		this.lastTraceTimestamps.clear();
		this.lastTraceTimestamp = null;
		this.stopped = false;
		this.totalTracesStarted = 0;
		this.totalTracesEnded = 0;
		this.totalSpansStarted = 0;
		this.totalSpansEnded = 0;
		this.totalBudgetRejections = 0;
		this.totalCooldownRejections = 0;
		this.totalDedupeRejections = 0;
	}

	/**
	 * Get the number of active traces.
	 */
	get activeTraceCount(): number {
		return this.traces.size;
	}

	/**
	 * Get diagnostic information about the TraceManager state.
	 * Provides evidence-backed diagnostics for all budget/cooldown/dedupe/stop decisions.
	 */
	getDiagnostics(): TraceManagerDiagnostics {
		const now = Date.now();
		let cooldownRemainingMs: number | null = null;
		if (this.config.minTraceIntervalMs > 0 && this.lastTraceTimestamp !== null) {
			const elapsed = now - this.lastTraceTimestamp;
			if (elapsed < this.config.minTraceIntervalMs) {
				cooldownRemainingMs = this.config.minTraceIntervalMs - elapsed;
			}
		}

		return {
			activeTraceCount: this.traces.size,
			maxActiveTraces: this.config.maxActiveTraces,
			minTraceIntervalMs: this.config.minTraceIntervalMs,
			rejectDuplicateTraceIds: this.config.rejectDuplicateTraceIds,
			rejectDuplicateSpanIds: this.config.rejectDuplicateSpanIds,
			lastTraceTimestamp: this.lastTraceTimestamp ? new Date(this.lastTraceTimestamp).toISOString() : null,
			cooldownRemainingMs,
			isStopped: this.stopped,
			totalTracesStarted: this.totalTracesStarted,
			totalTracesEnded: this.totalTracesEnded,
			totalSpansStarted: this.totalSpansStarted,
			totalSpansEnded: this.totalSpansEnded,
			totalBudgetRejections: this.totalBudgetRejections,
			totalCooldownRejections: this.totalCooldownRejections,
			totalDedupeRejections: this.totalDedupeRejections,
		};
	}
}
