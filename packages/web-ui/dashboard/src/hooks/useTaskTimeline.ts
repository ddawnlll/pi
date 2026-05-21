/**
 * useTaskTimeline — Fetches or streams task-level timeline events.
 *
 * When EventSource is available, connects to the SSE endpoint.
 * Falls back to polling GET /api/projects/:projectId/tasks/:taskId/timeline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineEvent } from "../types";

const API_BASE = "";
const POLL_INTERVAL_MS = 3000;

interface UseTaskTimelineOptions {
	projectId: string | null;
	taskId: string | null;
	useSSE?: boolean;
}

interface UseTaskTimelineResult {
	events: TimelineEvent[];
	isLoading: boolean;
	error: string | null;
	clear: () => void;
}

export function useTaskTimeline({
	projectId,
	taskId,
	useSSE = false,
}: UseTaskTimelineOptions): UseTaskTimelineResult {
	const [events, setEvents] = useState<TimelineEvent[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const esRef = useRef<EventSource | null>(null);
	const activeRef = useRef(true);

	const clear = useCallback(() => {
		setEvents([]);
	}, []);

	useEffect(() => {
		setEvents([]);
		setError(null);

		if (!projectId || !taskId) {
			setIsLoading(false);
			return;
		}

		activeRef.current = true;

		if (useSSE && typeof EventSource !== "undefined") {
			// SSE mode
			const es = new EventSource(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/timeline`,
			);

			es.onmessage = (msg) => {
				if (!activeRef.current) return;
				try {
					const event = JSON.parse(msg.data) as TimelineEvent;
					setEvents((prev) => [...prev, event]);
				} catch {
					// ignore malformed
				}
			};

			es.onerror = () => {
				if (!activeRef.current) return;
				setError("SSE connection error");
			};

			esRef.current = es;

			return () => {
				activeRef.current = false;
				es.close();
				esRef.current = null;
			};
		}

		// Polling mode (fallback)
		setIsLoading(true);

		const fetchTimeline = async () => {
			if (!activeRef.current) return;

			try {
				const res = await fetch(
					`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/timeline`,
				);

				if (!activeRef.current) return;

				if (!res.ok) {
					if (res.status !== 404) {
						throw new Error(`Timeline fetch failed: ${res.status}`);
					}
					return;
				}

				const data = await res.json();
				if (!activeRef.current) return;

				setEvents(data.events as TimelineEvent[]);
				setError(null);
			} catch (err) {
				if (!activeRef.current) return;
				setError(err instanceof Error ? err.message : "Failed to fetch timeline");
			} finally {
				if (activeRef.current) {
					setIsLoading(false);
				}
			}
		};

		fetchTimeline();
		timerRef.current = setInterval(fetchTimeline, POLL_INTERVAL_MS);

		return () => {
			activeRef.current = false;
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [projectId, taskId, useSSE]);

	return { events, isLoading, error, clear };
}
