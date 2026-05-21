/**
 * useTaskStats — Polls the task aggregate stats endpoint.
 *
 * Polls GET /api/projects/:projectId/tasks/:taskId/stats
 * every `intervalMs` while the task is active.
 */

import { useEffect, useRef, useState } from "react";
import type { TaskAggregate } from "../types";

const API_BASE = "";
const DEFAULT_INTERVAL_MS = 2000;

interface UseTaskStatsOptions {
	projectId: string | null;
	taskId: string | null;
	intervalMs?: number;
}

interface UseTaskStatsResult {
	aggregate: TaskAggregate | null;
	isLoading: boolean;
	error: string | null;
}

export function useTaskStats({
	projectId,
	taskId,
	intervalMs = DEFAULT_INTERVAL_MS,
}: UseTaskStatsOptions): UseTaskStatsResult {
	const [aggregate, setAggregate] = useState<TaskAggregate | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const activeRef = useRef(true);

	useEffect(() => {
		setAggregate(null);
		setError(null);

		if (!projectId || !taskId) {
			setIsLoading(false);
			return;
		}

		activeRef.current = true;

		const fetchStats = async () => {
			if (!activeRef.current) return;
			setIsLoading(true);

			try {
				const res = await fetch(
					`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/stats`,
				);

				if (!activeRef.current) return;

				if (!res.ok) {
					if (res.status === 404) {
						setAggregate(null);
						setError(null);
						return;
					}
					throw new Error(`Stats fetch failed: ${res.status}`);
				}

				const data = await res.json();
				if (!activeRef.current) return;

				setAggregate(data.aggregate as TaskAggregate);
				setError(null);
			} catch (err) {
				if (!activeRef.current) return;
				setError(err instanceof Error ? err.message : "Failed to fetch task stats");
			} finally {
				if (activeRef.current) {
					setIsLoading(false);
				}
			}
		};

		fetchStats();
		timerRef.current = setInterval(fetchStats, intervalMs);

		return () => {
			activeRef.current = false;
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [projectId, taskId, intervalMs]);

	return { aggregate, isLoading, error };
}
