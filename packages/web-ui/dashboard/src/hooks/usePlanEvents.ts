import { useCallback, useEffect, useRef, useState } from "react";
import type { JournalEvent } from "../types";

const API_BASE = "";
const MAX_EVENTS = 200;

interface UsePlanEventsOptions {
	projectId: string | null;
	planExecId: string | null;
}

export type PlanEventConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export function usePlanEvents({ projectId, planExecId }: UsePlanEventsOptions) {
	const [events, setEvents] = useState<JournalEvent[]>([]);
	const [connectionStatus, setConnectionStatus] = useState<PlanEventConnectionStatus>("disconnected");
	const [lastEventAt, setLastEventAt] = useState<number | null>(null);
	const sourceRef = useRef<EventSource | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const connect = useCallback(() => {
		if (sourceRef.current) {
			sourceRef.current.close();
			sourceRef.current = null;
		}

		if (!projectId || !planExecId) {
			setEvents([]);
			setConnectionStatus("disconnected");
			setLastEventAt(null);
			return;
		}

		setConnectionStatus((prev) => (prev === "connected" ? "reconnecting" : "connecting"));
		const url = `${API_BASE}/api/projects/${projectId}/plans/${planExecId}/events`;
		const source = new EventSource(url);
		sourceRef.current = source;

		source.onopen = () => {
			setConnectionStatus("connected");
			setLastEventAt(Date.now());
		};

		source.onmessage = (event) => {
			try {
				const parsed: JournalEvent = JSON.parse(event.data);
				setConnectionStatus("connected");
				setLastEventAt(Date.now());
				setEvents((prev) => {
					const next = [parsed, ...prev];
					if (next.length > MAX_EVENTS) next.pop();
					return next;
				});
			} catch (error) {
				console.error("Failed to parse event:", error);
			}
		};

		source.onerror = () => {
			console.error("Plan events SSE error, reconnecting...");
			setConnectionStatus("reconnecting");
			source.close();
			sourceRef.current = null;
			reconnectTimerRef.current = setTimeout(connect, 5000);
		};
	}, [projectId, planExecId]);

	useEffect(() => {
		connect();
		return () => {
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			if (sourceRef.current) {
				sourceRef.current.close();
				sourceRef.current = null;
			}
		};
	}, [connect]);

	const isStale = lastEventAt !== null && Date.now() - lastEventAt > 30_000;

	return { events, connectionStatus, lastEventAt, isStale };
}
