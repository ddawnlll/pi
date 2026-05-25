/**
 * useActivityTimeline — Fetches recent activity events for the Activity Timeline widget.
 *
 * Returns activities aggregated from across the system (plan executions, audit events, etc.)
 * with loading, error, and success states.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "";
const POLL_INTERVAL_MS = 10_000;

export interface ActivityEvent {
	id: string;
	type: "plan_started" | "plan_completed" | "plan_failed" | "plan_paused" | "plan_stopped";
	timestamp: number;
	message: string;
	source: string;
	severity: "info" | "warn" | "error";
	projectId?: string;
	projectName?: string;
	planExecutionId?: string;
	data?: Record<string, unknown>;
}

interface UseActivityTimelineResult {
	activities: ActivityEvent[];
	isLoading: boolean;
	error: string | null;
	refetch: () => Promise<void>;
}

export function useActivityTimeline(): UseActivityTimelineResult {
	const [activities, setActivities] = useState<ActivityEvent[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const activeRef = useRef(true);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchActivities = useCallback(async () => {
		if (!activeRef.current) return;

		try {
			const response = await fetch(`${API_BASE}/api/activity-timeline`);
			if (!activeRef.current) return;

			if (!response.ok) {
				throw new Error(`Failed to fetch activity timeline: ${response.status}`);
			}

			const data = await response.json();
			if (!activeRef.current) return;

			setActivities(data.activities as ActivityEvent[]);
			setError(null);
		} catch (err) {
			if (!activeRef.current) return;
			setError(err instanceof Error ? err.message : "Failed to load activity timeline");
		} finally {
			if (activeRef.current) {
				setIsLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		setIsLoading(true);
		activeRef.current = true;

		fetchActivities();

		timerRef.current = setInterval(fetchActivities, POLL_INTERVAL_MS);

		return () => {
			activeRef.current = false;
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [fetchActivities]);

	return {
		activities,
		isLoading,
		error,
		refetch: fetchActivities,
	};
}
