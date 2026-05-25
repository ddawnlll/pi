/**
 * Telemetry Query API tests (25.B).
 *
 * Tests the TelemetryQueryApi with aggregation, time-series, statistics,
 * error analysis, and dashboard summary operations.
 */

import { describe, expect, it } from "vitest";
import { TelemetryQueryApi } from "../../src/observability/query-api.js";
import { createObservabilityEvent, createTraceContext } from "../../src/observability/index.js";

// Helper to create test events
function createEvent(overrides: {
	name?: string;
	eventType?: string;
	source?: string;
	severity?: string;
	status?: string;
	durationMs?: number | null;
	timestamp?: string;
	traceId?: string;
	spanId?: string;
	correlationId?: string;
	projectId?: string;
	planExecutionId?: string;
	workspaceExecutionId?: string;
	error?: string | null;
}) {
	const ctx = createTraceContext({
		name: overrides.name ?? "test",
		traceId: overrides.traceId,
		spanId: overrides.spanId,
		correlationId: overrides.correlationId ?? null,
		projectId: overrides.projectId ?? null,
		planExecutionId: overrides.planExecutionId ?? null,
		workspaceExecutionId: overrides.workspaceExecutionId ?? null,
	});
	const event = createObservabilityEvent(ctx, {
		eventType: overrides.eventType ?? "test",
		source: overrides.source ?? "test-suite",
		severity: (overrides.severity ?? "info") as any,
		status: (overrides.status ?? "ok") as any,
		durationMs: overrides.durationMs ?? null,
	});
	if (overrides.timestamp) {
		event.timestamp = overrides.timestamp;
	}
	if (overrides.error !== undefined) {
		event.error = overrides.error;
	}
	return event;
}

// ─────────────────────────────────────────────────────────────────────
// Aggregation
// ─────────────────────────────────────────────────────────────────────

describe("TelemetryQueryApi — aggregation", () => {
	it("counts events", () => {
		const api = new TelemetryQueryApi();
		const events = [createEvent({}), createEvent({})];

		const result = api.aggregate(events, [{ fn: "count", as: "total" }]);

		expect(result.totalEvents).toBe(2);
		expect(result.aggregations.total).toBe(2);
	});

	it("computes sum of durationMs", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ durationMs: 100 }),
			createEvent({ durationMs: 200 }),
			createEvent({ durationMs: 300 }),
		];

		const result = api.aggregate(events, [{ fn: "sum", field: "durationMs", as: "totalDuration" }]);

		expect(result.aggregations.totalDuration).toBe(600);
	});

	it("computes average of durationMs", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ durationMs: 100 }),
			createEvent({ durationMs: 200 }),
			createEvent({ durationMs: 300 }),
		];

		const result = api.aggregate(events, [{ fn: "avg", field: "durationMs", as: "avgDuration" }]);

		expect(result.aggregations.avgDuration).toBe(200);
	});

	it("computes min and max of durationMs", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ durationMs: 50 }),
			createEvent({ durationMs: 150 }),
			createEvent({ durationMs: 300 }),
		];

		const result = api.aggregate(events, [
			{ fn: "min", field: "durationMs", as: "minDuration" },
			{ fn: "max", field: "durationMs", as: "maxDuration" },
		]);

		expect(result.aggregations.minDuration).toBe(50);
		expect(result.aggregations.maxDuration).toBe(300);
	});

	it("computes percentiles", () => {
		const api = new TelemetryQueryApi();
		const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
		const events = durations.map((d) => createEvent({ durationMs: d }));

		const result = api.aggregate(events, [
			{ fn: "p50", field: "durationMs", as: "p50" },
			{ fn: "p90", field: "durationMs", as: "p90" },
			{ fn: "p95", field: "durationMs", as: "p95" },
			{ fn: "p99", field: "durationMs", as: "p99" },
		]);

		expect(result.aggregations.p50).toBeGreaterThanOrEqual(50);
		expect(result.aggregations.p50).toBeLessThanOrEqual(60);
		expect(result.aggregations.p90).toBeGreaterThanOrEqual(90);
		expect(result.aggregations.p90).toBeLessThanOrEqual(100);
	});

	it("returns null for empty list aggregations (except count)", () => {
		const api = new TelemetryQueryApi();

		const result = api.aggregate([], [
			{ fn: "count", as: "count" },
			{ fn: "avg", field: "durationMs", as: "avg" },
			{ fn: "sum", field: "durationMs", as: "sum" },
		]);

		expect(result.aggregations.count).toBe(0);
		expect(result.aggregations.avg).toBeNull();
		expect(result.aggregations.sum).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Time-series
// ─────────────────────────────────────────────────────────────────────

describe("TelemetryQueryApi — time-series", () => {
	const baseTime = "2024-06-01T00:00:00.000Z";

	it("buckets events into time windows", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ timestamp: "2024-06-01T00:15:00.000Z" }),
			createEvent({ timestamp: "2024-06-01T00:30:00.000Z" }),
			createEvent({ timestamp: "2024-06-01T01:15:00.000Z" }),
			createEvent({ timestamp: "2024-06-01T02:30:00.000Z" }),
		];

		const result = api.timeSeries(
			events,
			{ widthMs: 3600000, since: "2024-06-01T00:00:00.000Z", until: "2024-06-01T03:00:00.000Z" },
		);

		expect(result.points).toHaveLength(3);
		expect(result.points[0].count).toBe(2); // 00:00-01:00
		expect(result.points[1].count).toBe(1); // 01:00-02:00
		expect(result.points[2].count).toBe(1); // 02:00-03:00
	});

	it("computes per-bucket aggregations", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ timestamp: "2024-06-01T00:15:00.000Z", durationMs: 100 }),
			createEvent({ timestamp: "2024-06-01T00:45:00.000Z", durationMs: 200 }),
		];

		const result = api.timeSeries(
			events,
			{ widthMs: 3600000, since: "2024-06-01T00:00:00.000Z", until: "2024-06-01T01:00:00.000Z" },
			[{ fn: "avg", field: "durationMs", as: "avgDuration" }],
		);

		expect(result.points).toHaveLength(1);
		expect(result.points[0].count).toBe(2);
		expect(result.points[0].values.avgDuration).toBe(150);
	});

	it("handles empty events list", () => {
		const api = new TelemetryQueryApi();

		const result = api.timeSeries(
			[],
			{ widthMs: 3600000, since: "2024-06-01T00:00:00.000Z", until: "2024-06-01T02:00:00.000Z" },
		);

		expect(result.points).toHaveLength(2);
		expect(result.points[0].count).toBe(0);
		expect(result.points[1].count).toBe(0);
	});

	it("throws for invalid bucket width", () => {
		const api = new TelemetryQueryApi();

		expect(() =>
			api.timeSeries(
				[],
				{ widthMs: 0, since: "2024-06-01T00:00:00.000Z", until: "2024-06-01T01:00:00.000Z" },
			),
		).toThrow("Bucket width must be positive");
	});
});

// ─────────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────

describe("TelemetryQueryApi — statistics", () => {
	it("computes comprehensive statistics", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ severity: "info", status: "ok", eventType: "span_start", source: "tm", durationMs: 50 }),
			createEvent({ severity: "info", status: "ok", eventType: "span_end", source: "tm", durationMs: 100 }),
			createEvent({ severity: "error", status: "error", eventType: "tool_call", source: "exec", durationMs: null }),
		];

		const stats = api.statistics(events);

		expect(stats.totalCount).toBe(3);
		expect(stats.bySeverity).toEqual({ info: 2, error: 1 });
		expect(stats.byStatus).toEqual({ ok: 2, error: 1 });
		expect(stats.byEventType).toEqual({ span_start: 1, span_end: 1, tool_call: 1 });
		expect(stats.bySource).toEqual({ tm: 2, exec: 1 });
		expect(stats.errorCount).toBe(1);
		expect(stats.errorRate).toBe(1 / 3);
	});

	it("computes duration statistics", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ durationMs: 10 }),
			createEvent({ durationMs: 20 }),
			createEvent({ durationMs: 30 }),
			createEvent({ durationMs: 40 }),
			createEvent({ durationMs: 50 }),
		];

		const stats = api.statistics(events);

		expect(stats.duration).not.toBeNull();
		expect(stats.duration!.min).toBe(10);
		expect(stats.duration!.max).toBe(50);
		expect(stats.duration!.avg).toBe(30);
	});

	it("handles empty event list", () => {
		const api = new TelemetryQueryApi();
		const stats = api.statistics([]);

		expect(stats.totalCount).toBe(0);
		expect(stats.duration).toBeNull();
		expect(stats.errorRate).toBeNull();
	});

	it("handles events with no duration data", () => {
		const api = new TelemetryQueryApi();
		const events = [createEvent({ durationMs: null }), createEvent({ durationMs: null })];

		const stats = api.statistics(events);

		expect(stats.totalCount).toBe(2);
		expect(stats.duration).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Error analysis
// ─────────────────────────────────────────────────────────────────────

describe("TelemetryQueryApi — error analysis", () => {
	it("analyzes error events", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ severity: "error", status: "error", source: "executor", eventType: "tool_call", error: "File not found" }),
			createEvent({ severity: "critical", status: "error", source: "executor", eventType: "tool_call", error: "Out of memory" }),
			createEvent({ severity: "error", status: "error", source: "trace_manager", eventType: "span_end", error: "Timeout" }),
			createEvent({ severity: "info", status: "ok", source: "test", eventType: "test" }), // not an error
		];

		const analysis = api.analyzeErrors(events);

		expect(analysis.totalErrors).toBe(3);
		expect(analysis.bySource).toHaveLength(2);
		expect(analysis.bySource[0].source).toBe("executor");
		expect(analysis.bySource[0].count).toBe(2);
		expect(analysis.byEventType).toHaveLength(2);
		expect(analysis.recentErrors).toHaveLength(3);
	});

	it("limits recent errors", () => {
		const api = new TelemetryQueryApi();
		const events = Array.from({ length: 10 }, (_, i) =>
			createEvent({ severity: "error", status: "error", name: `error-${i}` }),
		);

		const analysis = api.analyzeErrors(events, 3);

		expect(analysis.recentErrors).toHaveLength(3);
		expect(analysis.totalErrors).toBe(10);
	});

	it("returns empty analysis when no errors", () => {
		const api = new TelemetryQueryApi();
		const events = [createEvent({ severity: "info", status: "ok" })];

		const analysis = api.analyzeErrors(events);

		expect(analysis.totalErrors).toBe(0);
		expect(analysis.bySource).toHaveLength(0);
		expect(analysis.recentErrors).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Dashboard summary
// ─────────────────────────────────────────────────────────────────────

describe("TelemetryQueryApi — dashboard summary", () => {
	it("generates dashboard summary from events", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ severity: "info", eventType: "span_start", source: "tm", durationMs: 50, timestamp: "2024-01-01T00:00:00.000Z" }),
			createEvent({ severity: "error", eventType: "tool_call", source: "exec", durationMs: null, timestamp: "2024-01-02T00:00:00.000Z" }),
			createEvent({ severity: "info", eventType: "span_end", source: "tm", durationMs: 150, timestamp: "2024-01-03T00:00:00.000Z" }),
		];

		const summary = api.dashboardSummary(events);

		expect(summary.totalEvents).toBe(3);
		expect(summary.timeRange.since).toBe("2024-01-01T00:00:00.000Z");
		expect(summary.timeRange.until).toBe("2024-01-03T00:00:00.000Z");
		expect(summary.severityBreakdown).toEqual({ info: 2, error: 1 });
		expect(summary.errorRate).toBe(1 / 3);
		expect(summary.avgDurationMs).toBe(100);
		expect(summary.topSources).toHaveLength(2);
		expect(summary.topSources[0].source).toBe("tm");
		expect(summary.topSources[0].count).toBe(2);
	});

	it("handles empty events", () => {
		const api = new TelemetryQueryApi();
		const summary = api.dashboardSummary([]);

		expect(summary.totalEvents).toBe(0);
		expect(summary.timeRange.since).toBeNull();
		expect(summary.timeRange.until).toBeNull();
		expect(summary.errorRate).toBeNull();
		expect(summary.avgDurationMs).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Filtering
// ─────────────────────────────────────────────────────────────────────

describe("TelemetryQueryApi — filtering", () => {
	it("filters by event type", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ eventType: "type_a" }),
			createEvent({ eventType: "type_b" }),
			createEvent({ eventType: "type_a" }),
		];

		const filtered = api.filter(events, { eventType: "type_a" });
		expect(filtered).toHaveLength(2);
	});

	it("filters by multiple event types", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ eventType: "type_a" }),
			createEvent({ eventType: "type_b" }),
			createEvent({ eventType: "type_c" }),
		];

		const filtered = api.filter(events, { eventType: ["type_a", "type_b"] });
		expect(filtered).toHaveLength(2);
	});

	it("filters by severity", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ severity: "info" }),
			createEvent({ severity: "error" }),
			createEvent({ severity: "warning" }),
		];

		const filtered = api.filter(events, { severity: "error" });
		expect(filtered).toHaveLength(1);
	});

	it("filters by time range", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ timestamp: "2024-01-01T00:00:00.000Z" }),
			createEvent({ timestamp: "2024-06-01T00:00:00.000Z" }),
		];

		const filtered = api.filter(events, { since: "2024-03-01T00:00:00.000Z" });
		expect(filtered).toHaveLength(1);
	});

	it("filters by project/plan/workspace execution", () => {
		const api = new TelemetryQueryApi();
		const events = [
			createEvent({ projectId: "proj-1" }),
			createEvent({ projectId: "proj-2" }),
		];

		const filtered = api.filter(events, { projectId: "proj-1" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0].projectId).toBe("proj-1");
	});
});
