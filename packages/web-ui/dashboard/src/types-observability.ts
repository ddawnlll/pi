/**
 * Frontend types for the Local Observability Cockpit UI (25.H).
 *
 * Mirrors the backend ObservabilityEvent schema and TelemetryQueryApi
 * output types for type-safe integration with the REST API.
 */

// ── Severity and Status ──────────────────────────────────────────────

export type ObservabilitySeverity = "debug" | "info" | "warning" | "error" | "critical";
export type ObservabilityStatus = "ok" | "error" | "running" | "unknown";

// ── Observability Event ──────────────────────────────────────────────

export interface ObservabilityEvent {
	id: string;
	timestamp: string;
	eventType: string;
	source: string;
	severity: ObservabilitySeverity;
	status: ObservabilityStatus;
	name: string;
	message: string | null;
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	correlationId: string | null;
	projectId: string | null;
	planExecutionId: string | null;
	workspaceExecutionId: string | null;
	durationMs: number | null;
	data: Record<string, unknown>;
	error: string | null;
}

// ── Event Statistics ─────────────────────────────────────────────────

export interface EventStatistics {
	totalCount: number;
	bySeverity: Record<string, number>;
	byStatus: Record<string, number>;
	byEventType: Record<string, number>;
	bySource: Record<string, number>;
	duration: {
		min: number | null;
		max: number | null;
		avg: number | null;
		p50: number | null;
		p90: number | null;
		p95: number | null;
		p99: number | null;
	} | null;
	errorRate: number | null;
	errorCount: number;
}

// ── Dashboard Summary ────────────────────────────────────────────────

export interface TelemetryDashboardSummary {
	totalEvents: number;
	timeRange: { since: string | null; until: string | null };
	eventTypeBreakdown: Record<string, number>;
	severityBreakdown: Record<string, number>;
	errorRate: number | null;
	topSources: Array<{ source: string; count: number }>;
	avgDurationMs: number | null;
}

// ── Error Analysis ───────────────────────────────────────────────────

export interface TelemetryErrorAnalysis {
	totalErrors: number;
	bySource: Array<{
		source: string;
		count: number;
		latestTimestamp: string;
		latestMessage: string | null;
	}>;
	byEventType: Array<{ eventType: string; count: number }>;
	recentErrors: ObservabilityEvent[];
}

// ── Time Series ──────────────────────────────────────────────────────

export interface TelemetryTimeSeriesPoint {
	bucket: string;
	bucketEnd: string;
	count: number;
	values: Record<string, number | null>;
}

export interface TelemetryTimeSeries {
	bucketWidthMs: number;
	since: string;
	until: string;
	buckets: TelemetryTimeSeriesPoint[];
}

// ── Aggregation ──────────────────────────────────────────────────────

export interface TelemetryAggregations {
	aggregations: Record<string, number | null>;
	totalEvents: number;
}

export interface TelemetryStatsResponse {
	stats: EventStatistics;
	aggregations: TelemetryAggregations;
	filteredEvents: number;
	filter: Record<string, unknown>;
}

export interface TelemetryEventsQuery {
	since?: string;
	until?: string;
	limit?: number;
	offset?: number;
	order?: "asc" | "desc";
	severity?: string;
	eventType?: string;
	source?: string;
	projectId?: string;
	planExecutionId?: string;
	traceId?: string;
}

export interface TelemetryEventsResponse {
	events: ObservabilityEvent[];
	total: number;
	filter: Record<string, unknown>;
}

export interface TelemetryDashboardResponse {
	summary: TelemetryDashboardSummary;
	filter: Record<string, unknown>;
}

export interface TelemetryTimeSeriesResponse {
	bucketWidthMs: number;
	since: string;
	until: string;
	buckets: TelemetryTimeSeriesPoint[];
}

export interface TelemetryErrorAnalysisResponse {
	totalErrors: number;
	bySource: Array<{
		source: string;
		count: number;
		latestTimestamp: string;
		latestMessage: string | null;
	}>;
	byEventType: Array<{ eventType: string; count: number }>;
	recentErrors: ObservabilityEvent[];
}
