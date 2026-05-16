/**
 * useMemoryMetrics — React hooks for the Memory Cockpit UI.
 *
 * P11.Q — Memory Cockpit UI
 *
 * Provides hooks for:
 *   - useMemoryHealth(): Fetch memory health metrics and source breakdowns
 *   - useMemoryProvenance(): Fetch top memories with provenance
 *   - useMemoryAction(): Perform policy-checked memory management actions
 *   - useMemoryAuditEvents(): Fetch memory audit events
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	MemoryHealthResponse,
	MemoryProvenanceResponse,
	MemoryActionResponse,
	MemoryProvenance,
	MemoryAuditEvent,
} from "../types";

const API_BASE = "";

// ---------------------------------------------------------------------------
// API fetch helpers
// ---------------------------------------------------------------------------

async function fetchMemoryHealth(): Promise<MemoryHealthResponse> {
	const res = await fetch(`${API_BASE}/api/memory/health`);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	}
	return res.json();
}

async function fetchMemoryProvenance(params?: {
	planId?: string;
	proposalId?: string;
	limit?: number;
}): Promise<MemoryProvenanceResponse> {
	const searchParams = new URLSearchParams();
	if (params?.planId) searchParams.set("planId", params.planId);
	if (params?.proposalId) searchParams.set("proposalId", params.proposalId);
	if (params?.limit) searchParams.set("limit", String(params.limit));

	const qs = searchParams.toString();
	const url = `${API_BASE}/api/memory/provenance${qs ? `?${qs}` : ""}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	}
	return res.json();
}

async function postMemoryAction(
	action: "reindex" | "compact" | "prune" | "forget",
	target?: string,
): Promise<MemoryActionResponse> {
	const res = await fetch(`${API_BASE}/api/memory/action`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action, target, actor: "dashboard" }),
	});
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	}
	return res.json();
}

async function fetchMemoryAuditEvents(params?: {
	action?: string;
	policyResult?: string;
	limit?: number;
}): Promise<{ success: boolean; events: MemoryAuditEvent[]; count: number; error?: string }> {
	const searchParams = new URLSearchParams();
	if (params?.action) searchParams.set("action", params.action);
	if (params?.policyResult) searchParams.set("policyResult", params.policyResult);
	if (params?.limit) searchParams.set("limit", String(params.limit));

	const qs = searchParams.toString();
	const url = `${API_BASE}/api/memory/audit${qs ? `?${qs}` : ""}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${res.statusText}`);
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Hook: useMemoryHealth
// ---------------------------------------------------------------------------

export interface UseMemoryHealthResult {
	metrics: MemoryHealthResponse | null;
	loading: boolean;
	error: Error | null;
	stale: boolean;
	refetch: () => void;
}

/**
 * Fetch memory health metrics and source breakdowns with auto-refresh.
 *
 * @param pollIntervalMs - Polling interval in milliseconds (default 30000; 0 to disable)
 * @returns Object with metrics, loading flag, error, stale flag, and refetch callback
 */
export function useMemoryHealth(pollIntervalMs: number = 30_000): UseMemoryHealthResult {
	const [data, setData] = useState<MemoryHealthResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const [stale, setStale] = useState(false);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const lastDataRef = useRef<MemoryHealthResponse | null>(null);

	const fetchData = useCallback(async () => {
		try {
			const result = await fetchMemoryHealth();
			setData(result);
			setError(null);
			if (lastDataRef.current && !stale) {
				// Data changed — mark as fresh
				setStale(false);
			}
			lastDataRef.current = result;
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)));
			if (lastDataRef.current) {
				setStale(true);
			}
		} finally {
			setLoading(false);
		}
	}, [stale]);

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

	return { metrics: data, loading, error, stale, refetch: fetchData };
}

// ---------------------------------------------------------------------------
// Hook: useMemoryProvenance
// ---------------------------------------------------------------------------

export interface UseMemoryProvenanceResult {
	memories: MemoryProvenance[];
	loading: boolean;
	error: Error | null;
	refetch: () => void;
}

/**
 * Fetch top memories with provenance information.
 *
 * @param planId - Optional plan execution ID filter
 * @param proposalId - Optional proposal ID filter
 * @returns Object with memories array, loading flag, error, and refetch callback
 */
export function useMemoryProvenance(
	planId?: string,
	proposalId?: string,
): UseMemoryProvenanceResult {
	const [memories, setMemories] = useState<MemoryProvenance[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const result = await fetchMemoryProvenance({ planId, proposalId });
			if (result.success) {
				setMemories(result.memories);
			} else {
				setMemories([]);
				setError(new Error(result.error ?? "Unknown error"));
			}
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)));
			setMemories([]);
		} finally {
			setLoading(false);
		}
	}, [planId, proposalId]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	return { memories, loading, error, refetch: fetchData };
}

// ---------------------------------------------------------------------------
// Hook: useMemoryAction
// ---------------------------------------------------------------------------

export interface UseMemoryActionResult {
	execute: (action: "reindex" | "compact" | "prune" | "forget", target?: string) => Promise<MemoryActionResponse>;
	pending: boolean;
	lastResult: MemoryActionResponse | null;
	error: Error | null;
}

/**
 * Hook to perform policy-checked memory management actions.
 *
 * @returns Object with execute function, pending flag, last result, and error
 */
export function useMemoryAction(): UseMemoryActionResult {
	const [pending, setPending] = useState(false);
	const [lastResult, setLastResult] = useState<MemoryActionResponse | null>(null);
	const [error, setError] = useState<Error | null>(null);

	const execute = useCallback(async (
		action: "reindex" | "compact" | "prune" | "forget",
		target?: string,
	): Promise<MemoryActionResponse> => {
		setPending(true);
		setError(null);
		try {
			const result = await postMemoryAction(action, target);
			setLastResult(result);
			return result;
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			setError(e);
			setLastResult({
				success: false,
				result: null,
				error: e.message,
			});
			return {
				success: false,
				result: null,
				error: e.message,
			};
		} finally {
			setPending(false);
		}
	}, []);

	return { execute, pending, lastResult, error };
}

// ---------------------------------------------------------------------------
// Hook: useMemoryAuditEvents
// ---------------------------------------------------------------------------

export interface UseMemoryAuditEventsResult {
	events: MemoryAuditEvent[];
	count: number;
	loading: boolean;
	error: Error | null;
	refetch: () => void;
}

/**
 * Fetch memory audit events with optional filters.
 *
 * @param action - Optional action type filter
 * @param policyResult - Optional policy result filter
 * @returns Object with events array, count, loading flag, error, and refetch callback
 */
export function useMemoryAuditEvents(
	action?: string,
	policyResult?: string,
): UseMemoryAuditEventsResult {
	const [events, setEvents] = useState<MemoryAuditEvent[]>([]);
	const [count, setCount] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const result = await fetchMemoryAuditEvents({ action, policyResult });
			if (result.success) {
				setEvents(result.events);
				setCount(result.count);
			} else {
				setEvents([]);
				setCount(0);
				setError(new Error(result.error ?? "Unknown error"));
			}
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)));
			setEvents([]);
			setCount(0);
		} finally {
			setLoading(false);
		}
	}, [action, policyResult]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	return { events, count, loading, error, refetch: fetchData };
}
