/**
 * useObservability — Convenience hook for the Local Observability Cockpit UI (25.H).
 *
 * Aggregates telemetry data from the lower-level useTelemetry* hooks into a
 * single observable state.  Also provides derived health indicators and
 * polling lifecycle management.
 *
 * Acceptance Criteria (delegated):
 * - Covers loading, empty, error, and data-present states for all sub-hooks
 * - Polling can be started/stopped via `setPollingEnabled`
 * - Exposes an explicit `refetchAll` for manual refresh
 * - Surfaces evidence-backed diagnostics on failure
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	useTelemetryDashboard,
	useTelemetryEvents,
	useTelemetryStats,
	useTelemetryErrors,
	useTelemetryTimeSeries,
	useTelemetryRetentionPolicy,
} from "./useTelemetry";

import type {
	ObservabilityEvent,
	ObservabilitySeverity,
	TelemetryEventsQuery,
	TelemetryDashboardSummary,
	EventStatistics,
	TelemetryErrorAnalysis,
	TelemetryTimeSeriesResponse,
} from "../types-observability";
import type { RetentionPolicy } from "./useTelemetry";

// ── Polling configuration ────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 30_000; // 30s
const MAX_POLL_INTERVAL_MS = 300_000; // 5m

// ── Derived health status ────────────────────────────────────────────

export interface HealthStatus {
	overall: "healthy" | "degraded" | "unhealthy" | "unknown";
	sourceHealth: Array<{
		source: string;
		status: "healthy" | "degraded" | "unhealthy" | "unknown";
		errorCount: number;
		totalCount: number;
		latestTimestamp: string | null;
	}>;
	errorRate: number | null;
	criticalCount: number;
	errorCount: number;
	warningCount: number;
	totalEvents: number;
}

// ── ObservabilityState ───────────────────────────────────────────────

export interface ObservabilityState {
	dashboard: {
		summary: TelemetryDashboardSummary | null;
		loading: boolean;
		error: string | null;
	};
	events: {
		items: ObservabilityEvent[];
		total: number;
		loading: boolean;
		error: string | null;
	};
	stats: {
		statistics: EventStatistics | null;
		aggregations: Record<string, number | null> | null;
		filteredEvents: number;
		loading: boolean;
		error: string | null;
	};
	errors: {
		analysis: TelemetryErrorAnalysis | null;
		loading: boolean;
		error: string | null;
	};
	timeSeries: {
		data: TelemetryTimeSeriesResponse | null;
		loading: boolean;
		error: string | null;
	};
	retention: {
		policy: RetentionPolicy | null;
		loading: boolean;
		error: string | null;
	};
	health: HealthStatus;
	loading: boolean;
	anyError: string | null;
}

// ── Query params ─────────────────────────────────────────────────────

export interface ObservabilityQuery {
	since?: string;
	until?: string;
	bucketWidthMs?: number;
	severity?: string;
	source?: string;
	eventType?: string;
	projectId?: string;
	limit?: number;
	offset?: number;
	order?: "asc" | "desc";
}

// ── Health derivation ────────────────────────────────────────────────

function deriveHealth(
	stats: EventStatistics | null,
	summary: TelemetryDashboardSummary | null,
): HealthStatus {
	if (!stats && !summary) {
		return {
			overall: "unknown",
			sourceHealth: [],
			errorRate: null,
			criticalCount: 0,
			errorCount: 0,
			warningCount: 0,
			totalEvents: 0,
		};
	}

	const totalEvents = stats?.totalCount ?? summary?.totalEvents ?? 0;
	const errorCount = stats?.errorCount ?? 0;
	const errorRate = stats?.errorRate ?? null;
	const criticalCount = stats?.bySeverity?.critical ?? 0;
	const warningCount = stats?.bySeverity?.warning ?? 0;

	// Determine overall health
	let overall: HealthStatus["overall"] = "healthy";
	if (criticalCount > 0 || (errorRate != null && errorRate > 0.1)) {
		overall = "unhealthy";
	} else if (errorCount > 0 || (errorRate != null && errorRate > 0.05)) {
		overall = "degraded";
	}

	// Per-source health
	const sourceHealth: HealthStatus["sourceHealth"] = Object.entries(
		stats?.bySource ?? {},
	).map(([source, count]) => {
		const sourceErrors = stats?.bySeverity?.error ?? 0;
		const sourceCritical = stats?.bySeverity?.critical ?? 0;
		let status: HealthStatus["sourceHealth"][number]["status"] = "healthy";
		if (sourceCritical > 0) status = "unhealthy";
		else if (sourceErrors > 0) status = "degraded";
		return {
			source,
			status,
			errorCount: sourceErrors,
			totalCount: count,
			latestTimestamp: null,
		};
	});

	return {
		overall,
		sourceHealth,
		errorRate,
		criticalCount,
		errorCount,
		warningCount,
		totalEvents,
	};
}

// ── Composed error reporter ──────────────────────────────────────────

function firstError(
	dash: string | null,
	events: string | null,
	stats: string | null,
	errors: string | null,
	ts: string | null,
	retention: string | null,
): string | null {
	return dash ?? events ?? stats ?? errors ?? ts ?? retention;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useObservability(
	query: ObservabilityQuery = {},
	pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): ObservabilityState & { refetchAll: () => void; setPollingEnabled: (enabled: boolean) => void } {
	const {
		since,
		until,
		bucketWidthMs = 3_600_000,
		severity,
		source,
		eventType,
		projectId,
		limit = 50,
		offset = 0,
		order = "desc",
	} = query;

	const [pollingEnabled, setPollingEnabled] = useState(true);
	const effectivePoll = pollingEnabled
		? Math.min(Math.max(pollIntervalMs, 5_000), MAX_POLL_INTERVAL_MS)
		: 0;

	// ── Sub-hooks ──
	const dash = useTelemetryDashboard({ since, until, projectId }, effectivePoll);
	const events = useTelemetryEvents(
		{ since, until, severity, source, eventType, limit, offset, order, projectId } as TelemetryEventsQuery,
		effectivePoll,
	);
	const stats = useTelemetryStats(
		{ since, until, severity, source, eventType, projectId } as TelemetryEventsQuery,
		effectivePoll,
	);
	const errors = useTelemetryErrors({ limit: 10, since, until, projectId, source }, effectivePoll);
	const timeSeries = useTelemetryTimeSeries(since, until, bucketWidthMs, { severity, eventType, source, projectId }, effectivePoll);
	const retention = useTelemetryRetentionPolicy(effectivePoll);

	// ── Derived health ──
	const health = useMemo(
		() => deriveHealth(stats.stats, dash.summary),
		[stats.stats, dash.summary],
	);

	// ── Combined loading / error ──
	const loading = dash.loading || events.loading || stats.loading || errors.loading || timeSeries.loading || retention.loading;
	const anyError = firstError(
		dash.error,
		events.error,
		stats.error,
		errors.error,
		timeSeries.error,
		retention.error,
	);

	// ── refetchAll ──
	const refetchAll = useCallback(() => {
		dash.refetch();
		events.refetch();
		stats.refetch();
		errors.refetch();
		timeSeries.refetch();
		retention.refetch();
	}, [dash, events, stats, errors, timeSeries, retention]);

	return {
		dashboard: { summary: dash.summary, loading: dash.loading, error: dash.error },
		events: { items: events.events, total: events.total, loading: events.loading, error: events.error },
		stats: {
			statistics: stats.stats,
			aggregations: stats.aggregations,
			filteredEvents: stats.filteredEvents,
			loading: stats.loading,
			error: stats.error,
		},
		errors: { analysis: errors.analysis, loading: errors.loading, error: errors.error },
		timeSeries: { data: timeSeries.timeSeries, loading: timeSeries.loading, error: timeSeries.error },
		retention: { policy: retention.policy, loading: retention.loading, error: retention.error },
		health,
		loading,
		anyError,
		refetchAll,
		setPollingEnabled,
	};
}
