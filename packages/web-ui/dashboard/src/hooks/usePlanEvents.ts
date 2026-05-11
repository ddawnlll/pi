import { useCallback, useEffect, useRef, useState } from "react";
import type { JournalEvent } from "../types";

const API_BASE = "";
const MAX_EVENTS = 200;

interface UsePlanEventsOptions {
	projectId: string | null;
	planExecId: string | null;
}

export function usePlanEvents({ projectId, planExecId }: UsePlanEventsOptions) {
	const [events, setEvents] = useState<JournalEvent[]>([]);
	const sourceRef = useRef<EventSource | null>(null);

	const connect = useCallback(() => {
		if (sourceRef.current) {
			sourceRef.current.close();
			sourceRef.current = null;
		}

		if (!projectId || !planExecId) {
			setEvents([]);
			return;
		}

		const url = `${API_BASE}/api/projects/${projectId}/plans/${planExecId}/events`;
		const source = new EventSource(url);
		sourceRef.current = source;

		source.onmessage = (event) => {
			try {
				const parsed: JournalEvent = JSON.parse(event.data);
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
			source.close();
			sourceRef.current = null;
			setTimeout(connect, 5000);
		};
	}, [projectId, planExecId]);

	useEffect(() => {
		connect();
		return () => {
			if (sourceRef.current) {
				sourceRef.current.close();
				sourceRef.current = null;
			}
		};
	}, [connect]);

	return { events };
}
