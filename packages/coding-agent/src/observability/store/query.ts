/**
 * Telemetry Query API — high-level aggregation and statistics (25.B).
 *
 * Provides a comprehensive query interface for telemetry data with:
 *
 * - Aggregation queries (count, sum, avg, min, max by dimensions)
 * - Time-series bucketing (events grouped by time windows)
 * - Statistical summaries (error rates, duration percentiles)
 * - Dashboard data generation
 * - Streaming query support
 *
 * @module observability/store/query
 */

import type { ObservabilityEvent } from "../types.js";

// ─────────────────────────────────────────────────────────────────────
// Query Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Supported aggregation functions.
 */
export type AggregationFunction = "count" | "sum" | "avg" | "min" | "max" | "p50" | "p90" | "p95" | "p99";

/**
 * A single aggregation specification.
 */
export interface Aggregation {
	/** Aggregation function */
	fn: AggregationFunction;
	/** Field to aggregate over (e.g., "durationMs"). For count, this is ignored. */
	field?: string;
	/** Result key for the aggregation (auto-generated if not provided) */
	as?: string;
}

/**
 * Time bucketing configuration.
 */
export interface TimeBucketConfig {
	/** Bucket width in milliseconds */
	widthMs: number;
	/** ISO timestamp for the start of the range */
	since: string;
	/** ISO timestamp for the end of the range */
	until: string;
}

/**
 * Query filter for telemetry data.
 */
export interface TelemetryQuery {
	/** Event type filter */
	eventType?: string | string[];
	/** Source filter */
	source?: string | string[];
	/** Severity filter */
	severity?: string | string[];
	/** Status filter */
	status?: string | string[];
	/** Trace ID filter */
	traceId?: string;
	/** Correlation ID filter */
	correlationId?: string;
	/** Project ID filter */
	projectId?: string;
	/** Plan execution ID filter */
	planExecutionId?: string;
	/** Workspace execution ID filter */
	workspaceExecutionId?: string;
	/** ISO timestamp range start */
	since?: string;
	/** ISO timestamp range end */
	until?: string;
}

/**
 * Result of an aggregation query.
 */
export interface AggregationResult {
	/** Aggregation results by key */
	aggregations: Record<string, number | null>;
	/** Total events in the query range */
	totalEvents: number;
}

/**
 * Time-series data point.
 */
export interface TimeSeriesPoint {
	/** Bucket start timestamp (ISO 8601) */
	bucket: string;
	/** Bucket end timestamp (ISO 8601) */
	bucketEnd: string;
	/** Event count in this bucket */
	count: number;
	/** Aggregated values keyed by aggregation name */
	values: Record<string, number | null>;
}

/**
 * Time-series query result.
 */
export interface TimeSeriesResult {
	/** Array of time-series data points */
	points: TimeSeriesPoint[];
	/** Bucket width in milliseconds */
	bucketWidthMs: number;
	/** Query range start */
	since: string;
	/** Query range end */
	until: string;
}

/**
 * Statistics summary for a set of events.
 */
export interface EventStatistics {
	/** Total event count */
	totalCount: number;
	/** Count by severity */
	bySeverity: Record<string, number>;
	/** Count by status */
	byStatus: Record<string, number>;
	/** Count by event type */
	byEventType: Record<string, number>;
	/** Count by source */
	bySource: Record<string, number>;
	/** Duration statistics (only if events have durationMs) */
	duration: {
		min: number | null;
		max: number | null;
		avg: number | null;
		p50: number | null;
		p90: number | null;
		p95: number | null;
		p99: number | null;
	} | null;
	/** Error rate (events with status "error" / total) */
	errorRate: number | null;
	/** Error count */
	errorCount: number;
}

/**
 * Error analysis result.
 */
export interface ErrorAnalysis {
	/** Total error events */
	totalErrors: number;
	/** Errors grouped by source */
	bySource: Array<{ source: string; count: number; latestTimestamp: string; latestMessage: string | null }>;
	/** Errors grouped by event type */
	byEventType: Array<{ eventType: string; count: number }>;
	/** Most recent error events */
	recentErrors: ObservabilityEvent[];
}

// ─────────────────────────────────────────────────────────────────────
// TelemetryQueryApi
// ─────────────────────────────────────────────────────────────────────

/**
 * High-level query API for telemetry data.
 *
 * Operates on an array of events (from in-memory store or database).
 * All aggregation, statistics, and time-series operations are pure
 * functions that transform the input events.
 */
export class TelemetryQueryApi {
	/**
	 * Run aggregation queries against a set of events.
	 *
	 * @param events - Events to aggregate
	 * @param aggregations - List of aggregation specifications
	 * @returns Aggregation results
	 */
	aggregate(events: ObservabilityEvent[], aggregations: Aggregation[]): AggregationResult {
		const results: Record<string, number | null> = {};

		for (const agg of aggregations) {
			const key = agg.as ?? `${agg.fn}_${agg.field ?? "count"}`;
			results[key] = this.computeAggregation(events, agg);
		}

		return {
			aggregations: results,
			totalEvents: events.length,
		};
	}

	/**
	 * Compute a time-series by bucketing events into time windows.
	 *
	 * @param events - Events to bucket
	 * @param config - Time bucket configuration
	 * @param aggregations - Optional per-bucket aggregations
	 * @returns Time-series result
	 */
	timeSeries(
		events: ObservabilityEvent[],
		config: TimeBucketConfig,
		aggregations: Aggregation[] = [],
	): TimeSeriesResult {
		const sinceMs = new Date(config.since).getTime();
		const untilMs = new Date(config.until).getTime();
		const widthMs = config.widthMs;

		if (widthMs <= 0) {
			throw new Error("Bucket width must be positive");
		}

		// Filter events to range
		const inRange = events.filter((e) => {
			const t = new Date(e.timestamp).getTime();
			return t >= sinceMs && t <= untilMs;
		});

		// Create buckets
		const points: TimeSeriesPoint[] = [];
		let bucketStart = sinceMs;

		while (bucketStart < untilMs) {
			const bucketEnd = Math.min(bucketStart + widthMs, untilMs);
			const bucketEvents = inRange.filter((e) => {
				const t = new Date(e.timestamp).getTime();
				return t >= bucketStart && t < bucketEnd;
			});

			const values: Record<string, number | null> = {};
			for (const agg of aggregations) {
				const key = agg.as ?? `${agg.fn}_${agg.field ?? "count"}`;
				values[key] = this.computeAggregation(bucketEvents, agg);
			}

			points.push({
				bucket: new Date(bucketStart).toISOString(),
				bucketEnd: new Date(bucketEnd).toISOString(),
				count: bucketEvents.length,
				values,
			});

			bucketStart = bucketEnd;
		}

		return {
			points,
			bucketWidthMs: widthMs,
			since: config.since,
			until: config.until,
		};
	}

	/**
	 * Compute comprehensive statistics for a set of events.
	 *
	 * @param events - Events to analyze
	 * @returns Event statistics
	 */
	statistics(events: ObservabilityEvent[]): EventStatistics {
		const bySeverity: Record<string, number> = {};
		const byStatus: Record<string, number> = {};
		const byEventType: Record<string, number> = {};
		const bySource: Record<string, number> = {};
		const durations: number[] = [];
		let errorCount = 0;

		for (const event of events) {
			bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
			byStatus[event.status] = (byStatus[event.status] ?? 0) + 1;
			byEventType[event.eventType] = (byEventType[event.eventType] ?? 0) + 1;
			bySource[event.source] = (bySource[event.source] ?? 0) + 1;

			if (event.status === "error" || event.severity === "error" || event.severity === "critical") {
				errorCount++;
			}

			if (event.durationMs !== null && event.durationMs !== undefined) {
				durations.push(event.durationMs);
			}
		}

		const sortedDurations = [...durations].sort((a, b) => a - b);
		const durationStats =
			durations.length > 0
				? {
						min: sortedDurations[0],
						max: sortedDurations[sortedDurations.length - 1],
						avg: durations.reduce((a, b) => a + b, 0) / durations.length,
						p50: this.percentile(sortedDurations, 0.5),
						p90: this.percentile(sortedDurations, 0.9),
						p95: this.percentile(sortedDurations, 0.95),
						p99: this.percentile(sortedDurations, 0.99),
					}
				: null;

		return {
			totalCount: events.length,
			bySeverity,
			byStatus,
			byEventType,
			bySource,
			duration: durationStats,
			errorRate: events.length > 0 ? errorCount / events.length : null,
			errorCount,
		};
	}

	/**
	 * Perform error analysis on a set of events.
	 *
	 * @param events - Events to analyze
	 * @param limit - Maximum recent errors to return (default: 20)
	 * @returns Error analysis result
	 */
	analyzeErrors(events: ObservabilityEvent[], limit = 20): ErrorAnalysis {
		const errorEvents = events.filter(
			(e) => e.status === "error" || e.severity === "error" || e.severity === "critical",
		);

		// Group by source
		const bySourceMap = new Map<string, { count: number; latestTimestamp: string; latestMessage: string | null }>();
		for (const event of errorEvents) {
			const existing = bySourceMap.get(event.source) ?? {
				count: 0,
				latestTimestamp: event.timestamp,
				latestMessage: event.message,
			};
			existing.count++;
			if (event.timestamp > existing.latestTimestamp) {
				existing.latestTimestamp = event.timestamp;
				existing.latestMessage = event.message;
			}
			bySourceMap.set(event.source, existing);
		}

		// Group by event type
		const byEventTypeMap = new Map<string, number>();
		for (const event of errorEvents) {
			byEventTypeMap.set(event.eventType, (byEventTypeMap.get(event.eventType) ?? 0) + 1);
		}

		// Recent errors (most recent first)
		const recentErrors = [...errorEvents].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);

		return {
			totalErrors: errorEvents.length,
			bySource: Array.from(bySourceMap.entries())
				.map(([source, data]) => ({ source, ...data }))
				.sort((a, b) => b.count - a.count),
			byEventType: Array.from(byEventTypeMap.entries())
				.map(([eventType, count]) => ({ eventType, count }))
				.sort((a, b) => b.count - a.count),
			recentErrors,
		};
	}

	/**
	 * Generate a dashboard summary from events.
	 *
	 * Produces a concise overview suitable for dashboard display.
	 *
	 * @param events - Events to summarize
	 * @returns Dashboard summary object
	 */
	dashboardSummary(events: ObservabilityEvent[]): {
		totalEvents: number;
		timeRange: { since: string | null; until: string | null };
		eventTypeBreakdown: Record<string, number>;
		severityBreakdown: Record<string, number>;
		errorRate: number | null;
		topSources: Array<{ source: string; count: number }>;
		avgDurationMs: number | null;
	} {
		const stats = this.statistics(events);

		// Find time range
		let since: string | null = null;
		let until: string | null = null;
		for (const event of events) {
			if (!since || event.timestamp < since) since = event.timestamp;
			if (!until || event.timestamp > until) until = event.timestamp;
		}

		// Top sources
		const topSources = Object.entries(stats.bySource)
			.map(([source, count]) => ({ source, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);

		return {
			totalEvents: stats.totalCount,
			timeRange: { since, until },
			eventTypeBreakdown: stats.byEventType,
			severityBreakdown: stats.bySeverity,
			errorRate: stats.errorRate,
			topSources,
			avgDurationMs: stats.duration?.avg ?? null,
		};
	}

	/**
	 * Filter events by query parameters.
	 *
	 * @param events - Events to filter
	 * @param query - Query filter
	 * @returns Filtered events
	 */
	filter(events: ObservabilityEvent[], query: TelemetryQuery): ObservabilityEvent[] {
		let filtered = [...events];

		if (query.eventType) {
			const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
			filtered = filtered.filter((e) => types.includes(e.eventType));
		}
		if (query.source) {
			const sources = Array.isArray(query.source) ? query.source : [query.source];
			filtered = filtered.filter((e) => sources.includes(e.source));
		}
		if (query.severity) {
			const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
			filtered = filtered.filter((e) => severities.includes(e.severity));
		}
		if (query.status) {
			const statuses = Array.isArray(query.status) ? query.status : [query.status];
			filtered = filtered.filter((e) => statuses.includes(e.status));
		}
		if (query.traceId) {
			filtered = filtered.filter((e) => e.traceId === query.traceId);
		}
		if (query.correlationId) {
			filtered = filtered.filter((e) => e.correlationId === query.correlationId);
		}
		if (query.projectId) {
			filtered = filtered.filter((e) => e.projectId === query.projectId);
		}
		if (query.planExecutionId) {
			filtered = filtered.filter((e) => e.planExecutionId === query.planExecutionId);
		}
		if (query.workspaceExecutionId) {
			filtered = filtered.filter((e) => e.workspaceExecutionId === query.workspaceExecutionId);
		}
		if (query.since) {
			filtered = filtered.filter((e) => e.timestamp >= query.since!);
		}
		if (query.until) {
			filtered = filtered.filter((e) => e.timestamp <= query.until!);
		}

		return filtered;
	}

	// ── Private ──────────────────────────────────────────────────────

	private computeAggregation(events: ObservabilityEvent[], agg: Aggregation): number | null {
		if (events.length === 0) {
			if (agg.fn === "count") return 0;
			return null;
		}

		switch (agg.fn) {
			case "count":
				return events.length;

			case "sum": {
				const values = this.getNumericValues(events, agg.field);
				if (values.length === 0) return null;
				return values.reduce((a, b) => a + b, 0);
			}

			case "avg": {
				const values = this.getNumericValues(events, agg.field);
				if (values.length === 0) return null;
				return values.reduce((a, b) => a + b, 0) / values.length;
			}

			case "min": {
				const values = this.getNumericValues(events, agg.field);
				if (values.length === 0) return null;
				return Math.min(...values);
			}

			case "max": {
				const values = this.getNumericValues(events, agg.field);
				if (values.length === 0) return null;
				return Math.max(...values);
			}

			case "p50":
			case "p90":
			case "p95":
			case "p99": {
				const values = this.getNumericValues(events, agg.field);
				if (values.length === 0) return null;
				const sorted = [...values].sort((a, b) => a - b);
				const percentiles: Record<string, number> = {
					p50: 0.5,
					p90: 0.9,
					p95: 0.95,
					p99: 0.99,
				};
				return this.percentile(sorted, percentiles[agg.fn]);
			}

			default:
				return null;
		}
	}

	private getNumericValues(events: ObservabilityEvent[], field?: string): number[] {
		if (!field) return [];
		return events
			.map((e) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const value = (e as any)[field] as unknown as number | undefined;
				if (typeof value === "number") return value;
				return null;
			})
			.filter((v): v is number => v !== null);
	}

	private percentile(sortedValues: number[], p: number): number {
		if (sortedValues.length === 0) return 0;
		if (sortedValues.length === 1) return sortedValues[0];

		const index = Math.ceil(p * sortedValues.length) - 1;
		return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
	}
}
