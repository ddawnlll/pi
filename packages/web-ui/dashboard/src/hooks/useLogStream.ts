import { useCallback, useEffect, useRef, useState } from "react";
import type { LogStream } from "../types";

const API_BASE = "";

/** Composites params into a stable key so we only clear lines when the target changes. */
function streamKey(
	workspaceId: string | null,
	attempt: number | null,
	stream: LogStream | null,
): string | null {
	if (!workspaceId || attempt === null || !stream) return null;
	return `${workspaceId}/${attempt}/${stream}`;
}

export function useLogStream(
	workspaceId: string | null,
	attempt: number | null,
	stream: LogStream | null,
	planExecId?: string | null,
) {
	const [lines, setLines] = useState<string[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [hasData, setHasData] = useState(false);
	const sourceRef = useRef<EventSource | null>(null);
	const prevKeyRef = useRef<string | null>(null);

	const connect = useCallback(() => {
		if (sourceRef.current) {
			sourceRef.current.close();
			sourceRef.current = null;
		}

		// Clear lines only when the stream target actually changes
		const key = streamKey(workspaceId, attempt, stream);
		if (key !== prevKeyRef.current) {
			setLines([]);
			prevKeyRef.current = key;
		}

		setIsConnected(false);

		if (!key) {
			return;
		}

		// The SSE endpoint accepts an optional planExecId query param
		// so the backend can look up logs from the state store.
		const params = new URLSearchParams();
		// planExecId is passed through the environment — the hook doesn't
		// receive it directly. Backend falls back to state store scan.
		const url = `${API_BASE}/api/logs/${workspaceId}/${attempt}/${stream}${planExecId ? `?planExecId=${encodeURIComponent(planExecId)}` : ""}`;
		const source = new EventSource(url);
		sourceRef.current = source;

		source.onmessage = (event) => {
			// Skip the no-logs sentinel
			if (event.data === "__NO_LOGS__") {
				setHasData(false);
				return;
			}
			setHasData(true);
			setLines((prev) => [...prev, event.data]);
		};

		source.onopen = () => {
			setIsConnected(true);
		};

		source.onerror = () => {
			setIsConnected(false);
			// EventSource auto-reconnects, so need to prevent reconnect
			// for completed-on-connect streams (no-logs signal).
			// The server closes the response when no logs exist.
		};
	}, [workspaceId, attempt, stream, planExecId]);

	useEffect(() => {
		connect();
		return () => {
			if (sourceRef.current) {
				sourceRef.current.close();
				sourceRef.current = null;
			}
		};
	}, [connect]);

	return { lines, isConnected, hasData };
}
