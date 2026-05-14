import { useCallback, useEffect, useRef, useState } from "react";
import type {
	WorkspacePerformanceMetrics,
	CachePerformanceMetrics,
	TokenSplitMetrics,
	ValidationLockMetrics,
} from "../types";

const API_BASE = "";

/**
 * Fetch performance metrics for a single workspace.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @returns Workspace performance metrics or null on error
 */
async function fetchWorkspacePerformance(
	projectId: string,
	planExecId: string,
	workspaceId: string,
): Promise<WorkspacePerformanceMetrics | null> {
	const res = await fetch(
		`${API_BASE}/api/projects/${projectId}/plans/${planExecId}/workspaces/${workspaceId}/performance`,
	);
	if (!res.ok) return null;
	return res.json();
}

/**
 * Aggregated plan-level performance metrics returned by the plan endpoint.
 */
export interface PlanPerformanceMetrics {
	planExecId: string;
	cache: CachePerformanceMetrics;
	validationLock: {
		lockWaits: number;
		totalLockWaitMs: number | null;
		maxLockWaitMs: number | null;
		avgLockWaitMs: number | null;
	};
	workspaceCount: number;
}

/**
 * Fetch aggregated performance metrics for an entire plan execution.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @returns Plan performance metrics or null on error
 */
async function fetchPlanPerformance(
	projectId: string,
	planExecId: string,
): Promise<PlanPerformanceMetrics | null> {
	const res = await fetch(
		`${API_BASE}/api/projects/${projectId}/plans/${planExecId}/performance`,
	);
	if (!res.ok) return null;
	return res.json();
}

/**
 * Hook to fetch and auto-refresh workspace-level performance metrics.
 *
 * Polls at the given interval (default 30s). Returns null while loading
 * or on fetch failure so the UI can show a loading/empty state.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param pollIntervalMs - Polling interval in milliseconds (default 30000)
 * @returns Object with metrics, loading flag, error, and refetch callback
 */
export function useWorkspacePerformanceMetrics(
	projectId: string | undefined,
	planExecId: string | undefined,
	workspaceId: string | undefined,
	pollIntervalMs: number = 30_000,
) {
	const [metrics, setMetrics] = useState<WorkspacePerformanceMetrics | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchMetrics = useCallback(async () => {
		if (!projectId || !planExecId || !workspaceId) {
			setLoading(false);
			return;
		}
		try {
			const data = await fetchWorkspacePerformance(projectId, planExecId, workspaceId);
			setMetrics(data);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			setLoading(false);
		}
	}, [projectId, planExecId, workspaceId]);

	useEffect(() => {
		setLoading(true);
		fetchMetrics();

		intervalRef.current = setInterval(fetchMetrics, pollIntervalMs);
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchMetrics, pollIntervalMs]);

	return { metrics, loading, error, refetch: fetchMetrics };
}

/**
 * Hook to fetch and auto-refresh plan-level aggregated performance metrics.
 *
 * Polls at the given interval (default 30s). Returns null while loading
 * or on fetch failure so the UI can show a loading/empty state.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param pollIntervalMs - Polling interval in milliseconds (default 30000)
 * @returns Object with metrics, loading flag, error, and refetch callback
 */
export function usePlanPerformanceMetrics(
	projectId: string | undefined,
	planExecId: string | undefined,
	pollIntervalMs: number = 30_000,
) {
	const [metrics, setMetrics] = useState<PlanPerformanceMetrics | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchMetrics = useCallback(async () => {
		if (!projectId || !planExecId) {
			setLoading(false);
			return;
		}
		try {
			const data = await fetchPlanPerformance(projectId, planExecId);
			setMetrics(data);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			setLoading(false);
		}
	}, [projectId, planExecId]);

	useEffect(() => {
		setLoading(true);
		fetchMetrics();

		intervalRef.current = setInterval(fetchMetrics, pollIntervalMs);
		return () => {
			if (intervalRef.current != null) {
				clearInterval(intervalRef.current);
			}
		};
	}, [fetchMetrics, pollIntervalMs]);

	return { metrics, loading, error, refetch: fetchMetrics };
}
