import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionEvent } from "../types";

const API_BASE = "";
const MAX_EVENTS = 50;

export function useJournalStream() {
	const [events, setEvents] = useState<ExecutionEvent[]>([]);
	const sourceRef = useRef<EventSource | null>(null);

	const connect = useCallback(() => {
		if (sourceRef.current) {
			sourceRef.current.close();
		}

		const source = new EventSource(`${API_BASE}/api/events`);
		sourceRef.current = source;

		source.onmessage = (event) => {
			try {
				const executionEvent: ExecutionEvent = JSON.parse(event.data);
				setEvents((prev) => {
					const next = [executionEvent, ...prev];
					if (next.length > MAX_EVENTS) next.pop();
					return next;
				});
			} catch (error) {
				console.error("Failed to parse event:", error);
			}
		};

		source.onerror = () => {
			console.error("Event stream error, reconnecting...");
			source.close();
			sourceRef.current = null;
			setTimeout(connect, 5000);
		};
	}, []);

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
