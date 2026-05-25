/**
 * useTelemetry — React hooks for the Local Observability Cockpit UI (25.H).
 *
 * Provides hooks to fetch telemetry data from the existing REST API:
 * - useTelemetryDashboard: dashboard summary
 * - useTelemetryEvents: paginated event list
 * - useTelemetryStats: statistics and aggregations
 * - useTelemetryErrors: error analysis
 * - useTelemetryTimeSeries: time-series data
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ObservabilityEvent,
	TelemetryDashboardResponse,
	TelemetryEventsQuery,
	TelemetryEventsResponse,
	TelemetryStatsResponse,
	TelemetryErrorAnalysisResponse,
	TelemetryTimeSeriesResponse,
	EventStatistics,
	TelemetryErrorAnalysis,
} from "../types-observability";

const API_BASE = "";

// ── Raw fetch helpers ────────────────────────────────────────────────

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(url, { signal });
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
	}
	return res.json();
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== "") {
			parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
		}
	}
	return parts.length > 0 ? `?${parts.join("&")}` : "";
}

// ── useTelemetryDashboard ─────────────────────────────────────────────

export interface TelemetryDashboardResult {
	summary: TelemetryDashboardResponse["summary"] | null;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

/**
 * Fetch the telemetry dashboard summary.
 *
 * @param query - Optional query filter with since/until/projectId
 * @param pollIntervalMs - Polling interval in ms (default 0 = no polling)
 */
export function useTelemetryDashboard(
	query?: { since?: string; until?: string; projectId?: string },
	pollIntervalMs = 0,
): TelemetryDashboardResult {
	const [summary, setSummary] = useState<TelemetryDashboardResponse["summary"] | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchData = useCallback(async () => {
		try {
			const qs = buildQueryString({
				since: query?.since,
				until: query?.until,
				projectId: query?.projectId,
			});
			const data = await fetchJson<TelemetryDashboardResponse>(
				`${API_BASE}/api/telemetry/dashboard${qs}`,
			);
			setSummary(data.summary);
			setError(null);
		} catch (err) {
			if (err instanceof DOMException && (err as DOMException).name === "AbortError") return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [query?.since, query?.until, query?.projectId]);

	useEffect(() => {
		setLoading(true);
		fetchData();
		if (pollIntervalMs > 0) {
			intervalRef.current = setInterval(fetchData, pollIntervalMs);
		}
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchData, pollIntervalMs]);

	return { summary, loading, error, refetch: fetchData };
}

// ── useTelemetryEvents ───────────────────────────────────────────────

export interface TelemetryEventsResult {
	events: ObservabilityEvent[];
	total: number;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

/**
 * Fetch paginated telemetry events with filters.
 *
 * @param filters - Query filters
 * @param pollIntervalMs - Polling interval in ms (default 0 = no polling)
 */
export function useTelemetryEvents(
	filters: TelemetryEventsQuery = {},
	pollIntervalMs = 0,
): TelemetryEventsResult {
	const [events, setEvents] = useState<ObservabilityEvent[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchData = useCallback(async () => {
		try {
			const qs = buildQueryString({
				since: filters.since,
				until: filters.until,
				limit: filters.limit,
				offset: filters.offset,
				order: filters.order,
				severity: filters.severity,
				eventType: filters.eventType,
				source: filters.source,
				projectId: filters.projectId,
				planExecutionId: filters.planExecutionId,
				traceId: filters.traceId,
			});
			const data = await fetchJson<TelemetryEventsResponse>(
				`${API_BASE}/api/telemetry/events${qs}`,
			);
			setEvents(data.events);
			setTotal(data.total);
			setError(null);
		} catch (err) {
			if (err instanceof DOMException && (err as DOMException).name === "AbortError") return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [
		filters.since,
		filters.until,
		filters.limit,
		filters.offset,
		filters.order,
		filters.severity,
		filters.eventType,
		filters.source,
		filters.projectId,
		filters.planExecutionId,
		filters.traceId,
	]);

	useEffect(() => {
		setLoading(true);
		fetchData();
		if (pollIntervalMs > 0) {
			intervalRef.current = setInterval(fetchData, pollIntervalMs);
		}
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchData, pollIntervalMs]);

	return { events, total, loading, error, refetch: fetchData };
}

// ── useTelemetryStats ────────────────────────────────────────────────

export interface TelemetryStatsResult {
	stats: EventStatistics | null;
	aggregations: Record<string, number | null> | null;
	filteredEvents: number;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

/**
 * Fetch telemetry statistics with aggregations.
 *
 * @param filters - Query filters
 * @param pollIntervalMs - Polling interval in ms (default 0 = no polling)
 */
export function useTelemetryStats(
	filters: TelemetryEventsQuery = {},
	pollIntervalMs = 0,
): TelemetryStatsResult {
	const [stats, setStats] = useState<EventStatistics | null>(null);
	const [aggregations, setAggregations] = useState<Record<string, number | null> | null>(null);
	const [filteredEvents, setFilteredEvents] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchData = useCallback(async () => {
		try {
			const qs = buildQueryString({
				since: filters.since,
				until: filters.until,
				severity: filters.severity,
				eventType: filters.eventType,
				source: filters.source,
				projectId: filters.projectId,
				planExecutionId: filters.planExecutionId,
				traceId: filters.traceId,
			});
			const data = await fetchJson<TelemetryStatsResponse>(
				`${API_BASE}/api/telemetry/stats${qs}`,
			);
			setStats(data.stats);
			setAggregations(data.aggregations?.aggregations ?? null);
			setFilteredEvents(data.filteredEvents);
			setError(null);
		} catch (err) {
			if (err instanceof DOMException && (err as DOMException).name === "AbortError") return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [
		filters.since,
		filters.until,
		filters.severity,
		filters.eventType,
		filters.source,
		filters.projectId,
		filters.planExecutionId,
		filters.traceId,
	]);

	useEffect(() => {
		setLoading(true);
		fetchData();
		if (pollIntervalMs > 0) {
			intervalRef.current = setInterval(fetchData, pollIntervalMs);
		}
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchData, pollIntervalMs]);

	return { stats, aggregations, filteredEvents, loading, error, refetch: fetchData };
}

// ── useTelemetryErrors ───────────────────────────────────────────────

export interface TelemetryErrorsResult {
	analysis: TelemetryErrorAnalysis | null;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

/**
 * Fetch telemetry error analysis.
 *
 * @param filters - Query filters (limit, since, until, source)
 * @param pollIntervalMs - Polling interval in ms (default 0 = no polling)
 */
export function useTelemetryErrors(
	filters: { limit?: number; since?: string; until?: string; projectId?: string; source?: string } = {},
	pollIntervalMs = 0,
): TelemetryErrorsResult {
	const [analysis, setAnalysis] = useState<TelemetryErrorAnalysis | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchData = useCallback(async () => {
		try {
			const qs = buildQueryString({
				limit: filters.limit,
				since: filters.since,
				until: filters.until,
				projectId: filters.projectId,
				source: filters.source,
			});
			const data = await fetchJson<TelemetryErrorAnalysisResponse>(
				`${API_BASE}/api/telemetry/errors${qs}`,
			);
			setAnalysis(data);
			setError(null);
		} catch (err) {
			if (err instanceof DOMException && (err as DOMException).name === "AbortError") return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [
		filters.limit,
		filters.since,
		filters.until,
		filters.projectId,
		filters.source,
	]);

	useEffect(() => {
		setLoading(true);
		fetchData();
		if (pollIntervalMs > 0) {
			intervalRef.current = setInterval(fetchData, pollIntervalMs);
		}
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchData, pollIntervalMs]);

	return { analysis, loading, error, refetch: fetchData };
}

// ── useTelemetryTimeSeries ───────────────────────────────────────────

export interface TelemetryTimeSeriesResult {
	timeSeries: TelemetryTimeSeriesResponse | null;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

/**
 * Fetch telemetry time-series data.
 *
 * @param since - ISO timestamp for range start (required)
 * @param until - ISO timestamp for range end (required)
 * @param bucketWidthMs - Bucket width in ms (default 3600000 = 1h)
 * @param filters - Additional filters
 * @param pollIntervalMs - Polling interval in ms (default 0 = no polling)
 */
export function useTelemetryTimeSeries(
	since: string | undefined,
	until: string | undefined,
	bucketWidthMs = 3_600_000,
	filters: { severity?: string; eventType?: string; source?: string; projectId?: string } = {},
	pollIntervalMs = 0,
): TelemetryTimeSeriesResult {
	const [timeSeries, setTimeSeries] = useState<TelemetryTimeSeriesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchData = useCallback(async () => {
		if (!since || !until) {
			setLoading(false);
			return;
		}
		try {
			const qs = buildQueryString({
				since,
				until,
				bucketWidthMs,
				severity: filters.severity,
				eventType: filters.eventType,
				source: filters.source,
				projectId: filters.projectId,
			});
			const data = await fetchJson<TelemetryTimeSeriesResponse>(
				`${API_BASE}/api/telemetry/time-series${qs}`,
			);
			setTimeSeries(data);
			setError(null);
		} catch (err) {
			if (err instanceof DOMException && (err as DOMException).name === "AbortError") return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [since, until, bucketWidthMs, filters.severity, filters.eventType, filters.source, filters.projectId]);

	useEffect(() => {
		setLoading(true);
		fetchData();
		if (pollIntervalMs > 0) {
			intervalRef.current = setInterval(fetchData, pollIntervalMs);
		}
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchData, pollIntervalMs]);

	return { timeSeries, loading, error, refetch: fetchData };
}

// ── useTelemetryRetentionPolicy ──────────────────────────────────────

export interface RetentionPolicy {
	name: string;
	rules: Array<{
		name: string;
		eventType?: string;
		source?: string;
		severity?: string;
		maxAgeMs: number;
		maxCount: number;
		priority?: number;
	}>;
	globalMaxCount?: number;
	pruneIntervalMs?: number;
	autoPrune?: boolean;
}

export interface TelemetryRetentionResult {
	policy: RetentionPolicy | null;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

/**
 * Fetch the current telemetry retention policy.
 */
export function useTelemetryRetentionPolicy(
	pollIntervalMs = 0,
): TelemetryRetentionResult {
	const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchData = useCallback(async () => {
		try {
			const data = await fetchJson<{ policy: RetentionPolicy }>(
				`${API_BASE}/api/telemetry/retention/policy`,
			);
			setPolicy(data.policy);
			setError(null);
		} catch (err) {
			if (err instanceof DOMException && (err as DOMException).name === "AbortError") return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		setLoading(true);
		fetchData();
		if (pollIntervalMs > 0) {
			intervalRef.current = setInterval(fetchData, pollIntervalMs);
		}
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchData, pollIntervalMs]);

	return { policy, loading, error, refetch: fetchData };
}
