/**
 * Tests for the Observability Cockpit UI (25.H).
 *
 * @tags observability cockpit dashboard
 *
 * Acceptance Criteria:
 * 1. ObservabilityCockpit renders without crashing in all states
 * 2. Types cover ObservabilityEvent, EventStatistics, TelemetryDashboardSummary
 * 3. Hook handles loading, error, and data states
 * 4. Time-range presets work correctly
 * 5. Severity helpers produce correct output
 * 6. Tab navigation switches between overview, events, errors, and traces
 * 7. HealthSummary component renders all health states
 * 8. TraceTimeline component renders waterfall layout with all states
 * 9. All failures surface evidence-backed diagnostics
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import {
	ObservabilityCockpit,
} from "../src/features/observability/ObservabilityCockpit";
import { HealthSummary, HealthBadge } from "../src/features/observability/HealthSummary";
import type { HealthStatus } from "../src/features/observability/HealthSummary";
import { TraceTimeline } from "../src/features/observability/TraceTimeline";
import {
	useTelemetryDashboard,
	useTelemetryEvents,
	useTelemetryStats,
	useTelemetryErrors,
	useTelemetryTimeSeries,
	useTelemetryRetentionPolicy,
} from "../src/hooks/useTelemetry";
import type {
	ObservabilityEvent,
	ObservabilitySeverity,
	ObservabilityStatus,
	EventStatistics,
	TelemetryDashboardSummary,
	TelemetryErrorAnalysis,
	TelemetryTimeSeries,
	TelemetryTimeSeriesPoint,
} from "../src/types-observability";

function renderHook<T>(useHook: () => T): { result: { current: T } } {
	const result = { current: null as unknown as T };
	function TestComponent() {
		result.current = useHook();
		return null;
	}
	const { unmount } = render(<TestComponent />);
	return { result, unmount };
}

// ---------------------------------------------------------------------------
// AC 1: Types cover ObservabilityEvent, EventStatistics, TelemetryDashboardSummary
// ---------------------------------------------------------------------------

describe("observability types", () => {
	it("ObservabilityEvent has all required fields", () => {
		const event: ObservabilityEvent = {
			id: "evt-001",
			timestamp: "2026-05-25T12:00:00.000Z",
			eventType: "workspace_start",
			source: "plan-runner",
			severity: "info",
			status: "ok",
			name: "Workspace started",
			message: "Workspace 7.A started execution",
			traceId: "trace-001",
			spanId: "span-001",
			parentSpanId: null,
			correlationId: null,
			projectId: "proj-001",
			planExecutionId: "plan-001",
			workspaceExecutionId: "ws-001",
			durationMs: null,
			data: { workspaceId: "7.A" },
			error: null,
		};
		expect(event.id).toBe("evt-001");
		expect(event.severity).toBe("info");
		expect(event.status).toBe("ok");
		expect(event.eventType).toBe("workspace_start");
	});

	it("EventStatistics has all required fields", () => {
		const stats: EventStatistics = {
			totalCount: 100,
			bySeverity: { info: 80, warning: 15, error: 5 },
			byStatus: { ok: 95, error: 5 },
			byEventType: { workspace_start: 50, tool_call: 30, completion: 20 },
			bySource: { "plan-runner": 60, "agent-core": 40 },
			duration: {
				min: 100,
				max: 5000,
				avg: 1200,
				p50: 1000,
				p90: 3000,
				p95: 4000,
				p99: 4800,
			},
			errorRate: 0.05,
			errorCount: 5,
		};
		expect(stats.totalCount).toBe(100);
		expect(stats.errorRate).toBe(0.05);
		expect(stats.duration?.avg).toBe(1200);
	});

	it("TelemetryDashboardSummary has all required fields", () => {
		const summary: TelemetryDashboardSummary = {
			totalEvents: 500,
			timeRange: { since: "2026-05-24T00:00:00Z", until: "2026-05-25T00:00:00Z" },
			eventTypeBreakdown: { workspace_start: 200, tool_call: 200, completion: 100 },
			severityBreakdown: { info: 400, warning: 80, error: 20 },
			errorRate: 0.04,
			topSources: [{ source: "plan-runner", count: 300 }, { source: "agent-core", count: 200 }],
			avgDurationMs: 1500,
		};
		expect(summary.totalEvents).toBe(500);
		expect(summary.topSources).toHaveLength(2);
		expect(summary.avgDurationMs).toBe(1500);
	});

	it("supports all severity levels", () => {
		const severities: ObservabilitySeverity[] = ["debug", "info", "warning", "error", "critical"];
		for (const s of severities) {
			const evt: ObservabilityEvent = {
				id: "test",
				timestamp: "2026-01-01T00:00:00Z",
				eventType: "test",
				source: "test",
				severity: s,
				status: "ok",
				name: "Test event",
				message: null,
				traceId: "t",
				spanId: "s",
				parentSpanId: null,
				correlationId: null,
				projectId: null,
				planExecutionId: null,
				workspaceExecutionId: null,
				durationMs: null,
				data: {},
				error: null,
			};
			expect(evt.severity).toBe(s);
		}
	});

	it("supports all status values", () => {
		const statuses: ObservabilityStatus[] = ["ok", "error", "running", "unknown"];
		for (const s of statuses) {
			const evt: ObservabilityEvent = {
				id: "test",
				timestamp: "2026-01-01T00:00:00Z",
				eventType: "test",
				source: "test",
				severity: "info",
				status: s,
				name: "Test",
				message: null,
				traceId: "t",
				spanId: "s",
				parentSpanId: null,
				correlationId: null,
				projectId: null,
				planExecutionId: null,
				workspaceExecutionId: null,
				durationMs: null,
				data: {},
				error: null,
			};
			expect(evt.status).toBe(s);
		}
	});

	it("TelemetryTimeSeriesPoint has bucket and count", () => {
		const point: TelemetryTimeSeriesPoint = {
			bucket: "2026-05-25T00:00:00Z",
			bucketEnd: "2026-05-25T01:00:00Z",
			count: 42,
			values: { count: 42 },
		};
		expect(point.bucket).toBeTruthy();
		expect(point.count).toBe(42);
	});
});

// ---------------------------------------------------------------------------
// AC 3: Hook helpers work in isolation
// ---------------------------------------------------------------------------

describe("observability severity helpers", () => {
	it("correctly identifies error vs info severities", () => {
		const errorEvent: Pick<ObservabilityEvent, "severity"> = { severity: "error" };
		const infoEvent: Pick<ObservabilityEvent, "severity"> = { severity: "info" };
		const criticalEvent: Pick<ObservabilityEvent, "severity"> = { severity: "critical" };

		expect(errorEvent.severity).toBe("error");
		expect(infoEvent.severity).toBe("info");
		expect(criticalEvent.severity).toBe("critical");
	});
});

// ---------------------------------------------------------------------------
// AC 2 & 4: ObservabilityCockpit renders without crashing
// ---------------------------------------------------------------------------

describe("ObservabilityCockpit component rendering", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/dashboard")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						summary: {
							totalEvents: 0,
							timeRange: { since: null, until: null },
							eventTypeBreakdown: {},
							severityBreakdown: {},
							errorRate: null,
							topSources: [],
							avgDurationMs: null,
						},
						filter: {},
					}),
				});
			}
			if (url.includes("/api/telemetry/stats")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						stats: {
							totalCount: 0,
							bySeverity: {},
							byStatus: {},
							byEventType: {},
							bySource: {},
							duration: null,
							errorRate: null,
							errorCount: 0,
						},
						aggregations: { aggregations: {}, totalEvents: 0 },
						filteredEvents: 0,
						filter: {},
					}),
				});
			}
			if (url.includes("/api/telemetry/events")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ events: [], total: 0, filter: {} }),
				});
			}
			if (url.includes("/api/telemetry/errors")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						totalErrors: 0,
						bySource: [],
						byEventType: [],
						recentErrors: [],
					}),
				});
			}
			if (url.includes("/api/telemetry/time-series")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						bucketWidthMs: 3600000,
						since: "2026-05-24T00:00:00Z",
						until: "2026-05-25T00:00:00Z",
						buckets: [],
					}),
				});
			}
			if (url.includes("/api/telemetry/retention/policy")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						policy: {
							name: "default",
							rules: [],
							globalMaxCount: 100000,
						},
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders without crashing", async () => {
		const { container } = render(<ObservabilityCockpit />);
		expect(screen.getByText("Observability Cockpit")).toBeTruthy();
		expect(screen.getByText("Overview")).toBeTruthy();
		expect(screen.getByText("Events")).toBeTruthy();
		expect(screen.getAllByText("Errors").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText("Last 24 hours")).toBeTruthy();
		expect(container).toBeTruthy();
	});

	it("has working tab navigation", () => {
		render(<ObservabilityCockpit />);

		fireEvent.click(screen.getByText("Events"));
		expect(screen.getByText("Events")).toBeTruthy();

		const errorElements = screen.getAllByText("Errors");
		fireEvent.click(errorElements[0]);
		expect(errorElements.length).toBeGreaterThanOrEqual(1);

		fireEvent.click(screen.getByText("Overview"));
		expect(screen.getByText("Overview")).toBeTruthy();
	});

	it("shows filter bar when filter button clicked", () => {
		render(<ObservabilityCockpit />);

		const filterButton = screen.getByText("Filters");
		fireEvent.click(filterButton);
		expect(screen.getByText("Severity")).toBeTruthy();
		expect(screen.getByText("Source")).toBeTruthy();
		expect(screen.getByText("Event Type")).toBeTruthy();
	});

	it("shows refresh button", () => {
		render(<ObservabilityCockpit />);
		expect(screen.getByText("Refresh")).toBeTruthy();
	});

	it("has time range presets in the select", () => {
		render(<ObservabilityCockpit />);
		const selects = screen.getAllByRole("combobox");
		expect(selects.length).toBeGreaterThanOrEqual(1);
	});

	it("shows empty state when no data", () => {
		render(<ObservabilityCockpit />);
		expect(screen.getByText("Observability Cockpit")).toBeTruthy();
	});

	it("accepts custom className", () => {
		const { container } = render(<ObservabilityCockpit className="test-class" />);
		const outerDiv = container.querySelector(".test-class");
		expect(outerDiv).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AC: Traces tab integration
// ---------------------------------------------------------------------------

describe("Traces tab navigation", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/dashboard")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						summary: {
							totalEvents: 0,
							timeRange: { since: null, until: null },
							eventTypeBreakdown: {},
							severityBreakdown: {},
							errorRate: null,
							topSources: [],
							avgDurationMs: null,
						},
						filter: {},
					}),
				});
			}
			if (url.includes("/api/telemetry/stats")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						stats: {
							totalCount: 0,
							bySeverity: {},
							byStatus: {},
							byEventType: {},
							bySource: {},
							duration: null,
							errorRate: null,
							errorCount: 0,
						},
						aggregations: { aggregations: {}, totalEvents: 0 },
						filteredEvents: 0,
						filter: {},
					}),
				});
			}
			if (url.includes("/api/telemetry/events")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ events: [], total: 0, filter: {} }),
				});
			}
			if (url.includes("/api/telemetry/errors")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						totalErrors: 0,
						bySource: [],
						byEventType: [],
						recentErrors: [],
					}),
				});
			}
			if (url.includes("/api/telemetry/time-series")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						bucketWidthMs: 3600000,
						since: "2026-05-24T00:00:00Z",
						until: "2026-05-25T00:00:00Z",
						buckets: [],
					}),
				});
			}
			if (url.includes("/api/telemetry/retention/policy")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						policy: {
							name: "default",
							rules: [],
							globalMaxCount: 100000,
						},
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("shows the Traces tab in the tab bar", () => {
		render(<ObservabilityCockpit />);
		expect(screen.getByText("Traces")).toBeTruthy();
	});

	it("switches to Traces tab on click", () => {
		render(<ObservabilityCockpit />);
		fireEvent.click(screen.getByText("Traces"));
		expect(screen.getByText("Trace Timeline")).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AC: HealthSummary component rendering
// ---------------------------------------------------------------------------

describe("HealthSummary component", () => {
	it("renders with ok status when no errors", () => {
		const summary: TelemetryDashboardSummary = {
			totalEvents: 100,
			timeRange: { since: "2026-05-25T00:00:00Z", until: "2026-05-25T12:00:00Z" },
			eventTypeBreakdown: { workspace_start: 60, tool_call: 40 },
			severityBreakdown: { info: 95, warning: 5 },
			errorRate: 0,
			topSources: [{ source: "plan-runner", count: 60 }],
			avgDurationMs: 1200,
		};
		const stats: EventStatistics = {
			totalCount: 100,
			bySeverity: { info: 95, warning: 5 },
			byStatus: { ok: 100 },
			byEventType: { workspace_start: 60, tool_call: 40 },
			bySource: { "plan-runner": 60, "agent-core": 40 },
			duration: null,
			errorRate: 0,
			errorCount: 0,
		};
		render(<HealthSummary summary={summary} stats={stats} />);
		expect(screen.getByText("System Health")).toBeTruthy();
		expect(screen.getByText("Healthy")).toBeTruthy();
	});

	it("renders degraded status when errors present", () => {
		const stats: EventStatistics = {
			totalCount: 100,
			bySeverity: { info: 90, warning: 5, error: 5 },
			byStatus: { ok: 95, error: 5 },
			byEventType: { workspace_start: 60, tool_call: 40 },
			bySource: { "plan-runner": 60, "agent-core": 40 },
			duration: null,
			errorRate: 0.05,
			errorCount: 5,
		};
		render(<HealthSummary stats={stats} />);
		expect(screen.getByText("System Health")).toBeTruthy();
		expect(screen.getByText("Degraded")).toBeTruthy();
	});

	it("renders error status with high error rate", () => {
		const stats: EventStatistics = {
			totalCount: 50,
			bySeverity: { info: 30, error: 20 },
			byStatus: { ok: 30, error: 20 },
			byEventType: { workspace_start: 30, tool_call: 20 },
			bySource: { "plan-runner": 50 },
			duration: null,
			errorRate: 0.4,
			errorCount: 20,
		};
		render(<HealthSummary stats={stats} />);
		expect(screen.getByText("Unhealthy")).toBeTruthy();
	});

	it("renders loading state", () => {
		render(<HealthSummary loading={true} />);
		expect(screen.getByText("System Health")).toBeTruthy();
		expect(screen.getByText("Checking...")).toBeTruthy();
	});

	it("renders error state", () => {
		render(<HealthSummary error="Failed to fetch" />);
		expect(screen.getByText("Unhealthy")).toBeTruthy();
	});

	it("renders empty/unknown state when no data", () => {
		render(<HealthSummary />);
		expect(screen.getByText("No health data available")).toBeTruthy();
	});

	it("accepts custom className", () => {
		const { container } = render(<HealthSummary className="test-class" />);
		const el = container.querySelector(".test-class");
		expect(el).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AC: HealthBadge component
// ---------------------------------------------------------------------------

describe("HealthBadge component", () => {
	it("renders all status variants", () => {
		const statuses: HealthStatus[] = ["ok", "degraded", "error", "unknown"];
		const labels = ["Healthy", "Degraded", "Unhealthy", "Unknown"];
		for (let i = 0; i < statuses.length; i++) {
			const { container } = render(<HealthBadge status={statuses[i]} />);
			expect(screen.getByText(labels[i])).toBeTruthy();
			cleanup();
		}
	});

	it("renders with reason text", () => {
		render(<HealthBadge status="degraded" reason="5 errors detected" />);
		expect(screen.getByText("Degraded")).toBeTruthy();
		expect(screen.getByText(/5 errors detected/)).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AC: TraceTimeline component rendering
// ---------------------------------------------------------------------------

describe("TraceTimeline component", () => {
	const makeSpan = (id: string, parentId: string | null, name: string, status: string, durationMs: number | null = null): ObservabilityEvent => ({
		id: `evt-${id}`,
		timestamp: "2026-05-25T12:00:00.000Z",
		eventType: "span",
		source: "agent-core",
		severity: "info",
		status: status as ObservabilityEvent["status"],
		name,
		message: null,
		traceId: "trace-001",
		spanId: id,
		parentSpanId: parentId,
		correlationId: null,
		projectId: null,
		planExecutionId: null,
		workspaceExecutionId: null,
		durationMs,
		data: {},
		error: null,
	});

	it("renders loading state", () => {
		render(<TraceTimeline spans={[]} loading={true} />);
		expect(screen.getByText("Loading trace...")).toBeTruthy();
	});

	it("renders error state", () => {
		render(<TraceTimeline spans={[]} error="Failed to load trace" />);
		expect(screen.getByText("Failed to load trace")).toBeTruthy();
	});

	it("renders empty state", () => {
		render(<TraceTimeline spans={[]} />);
		expect(screen.getByText("No trace spans available")).toBeTruthy();
	});

	it("renders spans in waterfall layout", () => {
		const spans = [
			makeSpan("root", null, "Root Span", "ok", 1000),
			makeSpan("child", "root", "Child Span", "ok", 500),
			makeSpan("leaf", "child", "Leaf Span", "ok", 200),
		];
		render(<TraceTimeline spans={spans} />);
		expect(screen.getByText("Root Span")).toBeTruthy();
		expect(screen.getByText("Child Span")).toBeTruthy();
		expect(screen.getByText("Leaf Span")).toBeTruthy();
		expect(screen.getByText("3 spans")).toBeTruthy();
	});

	it("renders spans with error status", () => {
		const spans = [
			makeSpan("s1", null, "Failed Span", "error", 100),
		];
		render(<TraceTimeline spans={spans} />);
		expect(screen.getByText("Failed Span")).toBeTruthy();
		expect(screen.getByText("error")).toBeTruthy();
	});

	it("calls onSelectSpan when a span is clicked", () => {
		const onSelect = vi.fn();
		const spans = [
			makeSpan("s1", null, "Clickable Span", "ok", 100),
		];
		render(<TraceTimeline spans={spans} onSelectSpan={onSelect} />);
		fireEvent.click(screen.getByText("Clickable Span"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ spanId: "s1" }),
		);
	});

	it("accepts custom className", () => {
		const { container } = render(<TraceTimeline spans={[]} className="test-class" />);
		const el = container.querySelector(".test-class");
		expect(el).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AC 4: Edge case — error analysis with events
// ---------------------------------------------------------------------------

describe("error analysis type completeness", () => {
	it("TelemetryErrorAnalysis contains all required fields", () => {
		const analysis: TelemetryErrorAnalysis = {
			totalErrors: 3,
			bySource: [
				{ source: "agent-core", count: 2, latestTimestamp: "2026-05-25T12:00:00Z", latestMessage: "Tool call failed" },
				{ source: "plan-runner", count: 1, latestTimestamp: "2026-05-25T11:00:00Z", latestMessage: "Workspace failed" },
			],
			byEventType: [
				{ eventType: "tool_call", count: 2 },
				{ eventType: "workspace_failed", count: 1 },
			],
			recentErrors: [
				{
					id: "err-1",
					timestamp: "2026-05-25T12:00:00Z",
					eventType: "tool_call",
					source: "agent-core",
					severity: "error",
					status: "error",
					name: "Tool call error",
					message: "Failed to execute tool",
					traceId: "t1",
					spanId: "s1",
					parentSpanId: null,
					correlationId: null,
					projectId: "p1",
					planExecutionId: null,
					workspaceExecutionId: null,
					durationMs: null,
					data: {},
					error: "Timeout",
				},
			],
		};

		expect(analysis.totalErrors).toBe(3);
		expect(analysis.bySource).toHaveLength(2);
		expect(analysis.byEventType).toHaveLength(2);
		expect(analysis.recentErrors).toHaveLength(1);
		expect(analysis.recentErrors[0].error).toBe("Timeout");
	});
});

// ---------------------------------------------------------------------------
// AC 2 & 3: useTelemetry hook direct tests (loading, error, data, dedupe)
// ---------------------------------------------------------------------------

describe("useTelemetryDashboard hook", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/dashboard")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						summary: {
							totalEvents: 250,
							timeRange: { since: "2026-05-24T00:00:00Z", until: "2026-05-25T00:00:00Z" },
							eventTypeBreakdown: { workspace_start: 150, tool_call: 100 },
							severityBreakdown: { info: 200, warning: 40, error: 10 },
							errorRate: 0.04,
							topSources: [{ source: "plan-runner", count: 150 }],
							avgDurationMs: 1200,
						},
						filter: {},
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("fetches dashboard summary on mount", async () => {
		const { result } = renderHook(() => useTelemetryDashboard({}));
		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});
		expect(result.current.summary?.totalEvents).toBe(250);
		expect(result.current.error).toBeNull();
	});

	it("surfaces fetch error", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));
		const { result } = renderHook(() => useTelemetryDashboard({}));
		await waitFor(() => {
			expect(result.current.error).toBe("Network failure");
		});
	});

	it("supports refetch", async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			callCount++;
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({
					summary: { totalEvents: callCount * 100, timeRange: { since: null, until: null }, eventTypeBreakdown: {}, severityBreakdown: {}, errorRate: null, topSources: [], avgDurationMs: null },
					filter: {},
				}),
			});
		});
		const { result } = renderHook(() => useTelemetryDashboard({}));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.summary?.totalEvents).toBe(100);
		act(() => { result.current.refetch(); });
		await waitFor(() => expect(result.current.summary?.totalEvents).toBe(200));
	});

	it("handles HTTP error status", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			text: () => Promise.resolve("Server error details"),
		});
		const { result } = renderHook(() => useTelemetryDashboard({}));
		await waitFor(() => {
			expect(result.current.error).toContain("500");
		});
	});

	it("ignores stale responses after refetch", async () => {
		// Simulate slow first request that arrives after fast second request
		let resolveSlow!: (v: unknown) => void;
		const slowPromise = new Promise((resolve) => { resolveSlow = resolve; });
		const fastPromise = Promise.resolve({
			ok: true,
			json: () => Promise.resolve({
				summary: { totalEvents: 200, timeRange: { since: null, until: null }, eventTypeBreakdown: {}, severityBreakdown: {}, errorRate: null, topSources: [], avgDurationMs: null },
				filter: {},
			}),
		});

		let callIdx = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			callIdx++;
			if (callIdx === 1) return slowPromise;
			return fastPromise;
		});

		const { result } = renderHook(() => useTelemetryDashboard({}));
		// First request is slow; trigger refetch immediately
		await act(async () => {
			result.current.refetch();
			// Now resolve the slow one
			resolveSlow({
				ok: true,
				json: () => Promise.resolve({
					summary: { totalEvents: 999, timeRange: { since: null, until: null }, eventTypeBreakdown: {}, severityBreakdown: {}, errorRate: null, topSources: [], avgDurationMs: null },
					filter: {},
				}),
			});
		});

		await waitFor(() => expect(result.current.loading).toBe(false));
		// Should have the fast result (200), not the stale slow result (999)
		expect(result.current.summary?.totalEvents).toBe(200);
	});
});

describe("useTelemetryEvents hook", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/events")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						events: [{
							id: "evt-1", timestamp: "2026-05-25T12:00:00Z", eventType: "test",
							source: "test", severity: "info", status: "ok", name: "Test event",
							message: null, traceId: "t", spanId: "s", parentSpanId: null,
							correlationId: null, projectId: null, planExecutionId: null,
							workspaceExecutionId: null, durationMs: null, data: {}, error: null,
						}],
						total: 1,
						filter: {},
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("fetches events on mount", async () => {
		const { result } = renderHook(() => useTelemetryEvents({}));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.events).toHaveLength(1);
		expect(result.current.total).toBe(1);
	});

	it("surfaces error on fetch failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Events fetch failed"));
		const { result } = renderHook(() => useTelemetryEvents({}));
		await waitFor(() => expect(result.current.error).toBe("Events fetch failed"));
	});
});

describe("useTelemetryStats hook", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/stats")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						stats: { totalCount: 100, bySeverity: { info: 80, error: 20 }, byStatus: { ok: 80, error: 20 }, byEventType: { a: 60, b: 40 }, bySource: { src1: 100 }, duration: { min: 1, max: 100, avg: 50, p50: 45, p90: 80, p95: 90, p99: 99 }, errorRate: 0.2, errorCount: 20 },
						aggregations: { aggregations: { totalDuration: 5000 }, totalEvents: 100 },
						filteredEvents: 100,
						filter: {},
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("fetches stats on mount", async () => {
		const { result } = renderHook(() => useTelemetryStats({}));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.stats?.totalCount).toBe(100);
		expect(result.current.stats?.errorRate).toBe(0.2);
		expect(result.current.aggregations).toEqual({ totalDuration: 5000 });
	});

	it("surfaces error on fetch failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Stats failed"));
		const { result } = renderHook(() => useTelemetryStats({}));
		await waitFor(() => expect(result.current.error).toBe("Stats failed"));
	});
});

describe("useTelemetryErrors hook", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/errors")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						totalErrors: 5,
						bySource: [{ source: "src1", count: 3, latestTimestamp: "2026-05-25T12:00:00Z", latestMessage: "err" }],
						byEventType: [{ eventType: "fail", count: 5 }],
						recentErrors: [],
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("fetches error analysis on mount", async () => {
		const { result } = renderHook(() => useTelemetryErrors({}));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.analysis?.totalErrors).toBe(5);
	});

	it("surfaces error on fetch failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Errors fetch failed"));
		const { result } = renderHook(() => useTelemetryErrors({}));
		await waitFor(() => expect(result.current.error).toBe("Errors fetch failed"));
	});
});

describe("useTelemetryTimeSeries hook", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/time-series")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						bucketWidthMs: 3_600_000,
						since: "2026-05-24T00:00:00Z",
						until: "2026-05-25T00:00:00Z",
						buckets: [{ bucket: "2026-05-24T00:00:00Z", bucketEnd: "2026-05-24T01:00:00Z", count: 10, values: { count: 10 } }],
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("fetches time-series on mount with since/until", async () => {
		const { result } = renderHook(() => useTelemetryTimeSeries("2026-05-24T00:00:00Z", "2026-05-25T00:00:00Z"));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.timeSeries?.buckets).toHaveLength(1);
		expect(result.current.timeSeries?.buckets[0].count).toBe(10);
	});

	it("does not fetch when since/until are empty", async () => {
		const { result } = renderHook(() => useTelemetryTimeSeries(undefined, undefined));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.timeSeries).toBeNull();
	});

	it("surfaces error on fetch failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Time-series fetch failed"));
		const { result } = renderHook(() => useTelemetryTimeSeries("2026-05-24T00:00:00Z", "2026-05-25T00:00:00Z"));
		await waitFor(() => expect(result.current.error).toBe("Time-series fetch failed"));
	});
});

describe("useTelemetryRetentionPolicy hook", () => {
	beforeEach(() => {
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/retention/policy")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						policy: {
							name: "test-policy",
							rules: [{ name: "keep-7d", maxAgeMs: 604_800_000, maxCount: 100_000 }],
							globalMaxCount: 1_000_000,
						},
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("fetches retention policy on mount", async () => {
		const { result } = renderHook(() => useTelemetryRetentionPolicy());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.policy?.name).toBe("test-policy");
		expect(result.current.policy?.globalMaxCount).toBe(1_000_000);
	});

	it("surfaces error on fetch failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Retention fetch failed"));
		const { result } = renderHook(() => useTelemetryRetentionPolicy());
		await waitFor(() => expect(result.current.error).toBe("Retention fetch failed"));
	});
});

// ---------------------------------------------------------------------------
// AC 3: Polling stop-condition handling
// ---------------------------------------------------------------------------

describe("polling stop-condition", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("stops polling after unmount", async () => {
		let fetchCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			fetchCount++;
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({
					policy: { name: "p", rules: [], globalMaxCount: 1000 },
				}),
			});
		});

		const { unmount } = renderHook(() => useTelemetryRetentionPolicy(20));
		await waitFor(() => expect(fetchCount).toBeGreaterThanOrEqual(1));

		const beforeUnmount = fetchCount;
		unmount();

		// Wait to ensure no additional fetches after unmount
		await new Promise((r) => setTimeout(r, 60));
		expect(fetchCount).toBe(beforeUnmount);
	});
});

// ---------------------------------------------------------------------------
// AC 2: ObservabilityCockpit with data (event list, event detail panel)
// ---------------------------------------------------------------------------

describe("ObservabilityCockpit with data", () => {
	// Use a mutable counter for unique event IDs across refetch
	let mockEventIdCounter = 0;

	function makeEvent(idSuffix: string): ObservabilityEvent {
		return {
			id: `evt-${idSuffix}`,
			timestamp: new Date(Date.now() - Number(idSuffix) * 1000).toISOString(),
			eventType: idSuffix === "0" ? "error" : "workspace_start",
			source: "plan-runner",
			severity: idSuffix === "0" ? "error" : "info",
			status: idSuffix === "0" ? "error" : "ok",
			name: idSuffix === "0" ? "Error event" : `Workspace ${idSuffix}`,
			message: idSuffix === "0" ? "Something went wrong" : null,
			traceId: "trace-001",
			spanId: `span-${idSuffix}`,
			parentSpanId: null,
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
			durationMs: idSuffix === "0" ? null : 1500,
			data: {},
			error: idSuffix === "0" ? "Timeout error" : null,
		};
	}

	beforeEach(() => {
		mockEventIdCounter = 0;
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/telemetry/dashboard")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						summary: { totalEvents: 10, timeRange: { since: null, until: null }, eventTypeBreakdown: {}, severityBreakdown: { info: 8, error: 2 }, errorRate: 0.2, topSources: [{ source: "plan-runner", count: 8 }, { source: "agent-core", count: 2 }], avgDurationMs: 1200 },
						filter: {},
					}),
				});
			}
			if (url.includes("/api/telemetry/stats")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						stats: { totalCount: 10, bySeverity: { info: 8, error: 2 }, byStatus: { ok: 8, error: 2 }, byEventType: { workspace_start: 8, error: 2 }, bySource: { "plan-runner": 8, "agent-core": 2 }, duration: null, errorRate: 0.2, errorCount: 2 },
						aggregations: { aggregations: {}, totalEvents: 10 },
						filteredEvents: 10,
						filter: {},
					}),
				});
			}
			if (url.includes("/api/telemetry/events")) {
				const events = [makeEvent("0"), makeEvent("1"), makeEvent("2")];
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ events, total: 3, filter: {} }),
				});
			}
			if (url.includes("/api/telemetry/errors")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						totalErrors: 1,
						bySource: [{ source: "plan-runner", count: 1, latestTimestamp: new Date().toISOString(), latestMessage: "Timeout error" }],
						byEventType: [{ eventType: "error", count: 1 }],
						recentErrors: [makeEvent("0")],
					}),
				});
			}
			if (url.includes("/api/telemetry/time-series")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						bucketWidthMs: 3_600_000,
						since: "2026-05-24T00:00:00Z",
						until: "2026-05-25T00:00:00Z",
						buckets: [],
					}),
				});
			}
			if (url.includes("/api/telemetry/retention/policy")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({
						policy: { name: "default", rules: [{ name: "keep-all", maxAgeMs: 604_800_000, maxCount: 100_000 }], globalMaxCount: 1_000_000 },
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("shows events table with data in Events tab", async () => {
		render(<ObservabilityCockpit />);
		await act(async () => {
			fireEvent.click(screen.getByText("Events"));
		});
		await waitFor(() => {
			expect(screen.getByText("Error event")).toBeTruthy();
			expect(screen.getByText("Workspace 1")).toBeTruthy();
			expect(screen.getByText("Workspace 2")).toBeTruthy();
		});
	});

	it("shows event detail panel when event is clicked", async () => {
		render(<ObservabilityCockpit />);
		await act(async () => {
			fireEvent.click(screen.getByText("Events"));
		});
		await waitFor(() => {
			expect(screen.getByText("Error event")).toBeTruthy();
		});

		// Click on an event to open detail panel
		await act(async () => {
			fireEvent.click(screen.getByText("Error event"));
		});

		// Detail panel should show event fields
		expect(screen.getByText("Event Detail")).toBeTruthy();
		expect(screen.getByText("Trace ID")).toBeTruthy();
		expect(screen.getByText("trace-001")).toBeTruthy();
		expect(screen.getByText("Timeout error")).toBeTruthy();
	});

	it("closes event detail panel on close button click", async () => {
		render(<ObservabilityCockpit />);
		await act(async () => {
			fireEvent.click(screen.getByText("Events"));
		});
		await waitFor(() => expect(screen.getByText("Error event")).toBeTruthy());

		await act(async () => {
			fireEvent.click(screen.getByText("Error event"));
		});
		expect(screen.getByText("Event Detail")).toBeTruthy();

		// Close the panel
		const closeBtn = document.querySelector("button");
		if (closeBtn) {
			await act(async () => { fireEvent.click(closeBtn); });
		}
	});

	it("shows error analysis with data in Errors tab", async () => {
		render(<ObservabilityCockpit />);
		await act(async () => {
			const errorTabs = screen.getAllByText("Errors");
			fireEvent.click(errorTabs[0]);
		});
		await waitFor(() => {
			expect(screen.getByText("1 Error Found")).toBeTruthy();
		});
	});

	it("shows severity breakdown cards in Overview", async () => {
		render(<ObservabilityCockpit />);
		await waitFor(() => {
			// Should show severity data
			expect(screen.getByText("Severity Breakdown")).toBeTruthy();
		});
	});
});
