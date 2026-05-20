/**
 * useExecutionStats — Polls the plan execution statistics endpoint
 * to provide real-time workspace-level progress for running plans.
 *
 * Polls GET /api/projects/:projectId/plans/:planExecId/stats
 * every `intervalMs` while the execution is running.
 */

import { useEffect, useRef, useState } from "react";
import type { ExecutionStats } from "../types";

const API_BASE = "";
const DEFAULT_INTERVAL_MS = 2000;

interface UseExecutionStatsOptions {
	projectId: string | null;
	planExecId: string | null;
	/** Poll interval in ms (default: 2000) */
	intervalMs?: number;
	/** If true, keep polling even after execution completes (default: false) */
	pollAfterComplete?: boolean;
}

interface UseExecutionStatsResult {
	stats: ExecutionStats | null;
	isLoading: boolean;
	error: string | null;
}

/**
 * Polls the plan execution statistics endpoint.
 *
 * Automatically starts/stops polling based on planExecId changes.
 * Stops polling when the execution is complete (total === complete + failed)
 * unless `pollAfterComplete` is true.
 */
export function useExecutionStats({
	projectId,
	planExecId,
	intervalMs = DEFAULT_INTERVAL_MS,
	pollAfterComplete = false,
}: UseExecutionStatsOptions): UseExecutionStatsResult {
	const [stats, setStats] = useState<ExecutionStats | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const activeRef = useRef(true);

	useEffect(() => {
		// Reset when params change
		setStats(null);
		setError(null);

		if (!projectId || !planExecId) {
			setIsLoading(false);
			return;
		}

		activeRef.current = true;

		const fetchStats = async () => {
			if (!activeRef.current) return;
			setIsLoading(true);

			try {
				const res = await fetch(
					`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/stats`,
				);

				if (!activeRef.current) return;

				if (!res.ok) {
					// 404 means execution not found yet or already cleaned up
					if (res.status === 404) {
						setStats(null);
						setError(null);
						return;
					}
					throw new Error(`Stats fetch failed: ${res.status}`);
				}

				const data: ExecutionStats = await res.json();
				if (!activeRef.current) return;

				setStats(data);
				setError(null);

				// Stop polling if execution is complete and pollAfterComplete is false
				if (!pollAfterComplete && data.total > 0) {
					const done = (data.complete || 0) + (data.failed || 0);
					if (done >= data.total) {
						if (timerRef.current) {
							clearInterval(timerRef.current);
							timerRef.current = null;
						}
					}
				}
			} catch (err) {
				if (!activeRef.current) return;
				setError(err instanceof Error ? err.message : "Failed to fetch stats");
			} finally {
				if (activeRef.current) {
					setIsLoading(false);
				}
			}
		};

		// Immediate first fetch
		fetchStats();

		// Start polling
		timerRef.current = setInterval(fetchStats, intervalMs);

		return () => {
			activeRef.current = false;
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [projectId, planExecId, intervalMs, pollAfterComplete]);

	return { stats, isLoading, error };
}
