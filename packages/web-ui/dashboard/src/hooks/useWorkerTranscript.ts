import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerTranscriptEvent } from "../types";

const API_BASE = "";

interface UseWorkerTranscriptOptions {
	planExecId: string | null;
	workspaceId: string | null;
}

/**
 * Hook for streaming worker transcript events via SSE.
 *
 * Connects to /api/transcript/:planExecId/:workspaceId SSE endpoint
 * and accumulates transcript events (worker_status, worker_decision_summary,
 * validation, blocker, etc.) for the live transcript timeline.
 *
 * Automatically reconnects with exponential backoff on disconnect.
 * Raw private chain-of-thought is never included — the backend sanitizes
 * before emission.
 */
export function useWorkerTranscript({ planExecId, workspaceId }: UseWorkerTranscriptOptions) {
	const [events, setEvents] = useState<WorkerTranscriptEvent[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sourceRef = useRef<EventSource | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectDelayRef = useRef(1000);
	const connectedWsRef = useRef<string | null>(null);

	const connect = useCallback(() => {
		if (!planExecId || !workspaceId) {
			setEvents([]);
			setIsConnected(false);
			return;
		}

		// Close any existing connection
		if (sourceRef.current) {
			sourceRef.current.close();
			sourceRef.current = null;
		}

		// Clear events on workspace switch
		if (connectedWsRef.current !== workspaceId) {
			setEvents([]);
			setError(null);
			connectedWsRef.current = workspaceId;
		}

		const url = `${API_BASE}/api/transcript/${planExecId}/${workspaceId}`;
		const source = new EventSource(url);
		sourceRef.current = source;

		source.onopen = () => {
			setIsConnected(true);
			setIsReconnecting(false);
			setError(null);
			reconnectDelayRef.current = 1000;
		};

		source.onmessage = (event) => {
			if (event.data === "__NO_TRANSCRIPT__") {
				return;
			}
			try {
				const parsed: WorkerTranscriptEvent = JSON.parse(event.data);
				setEvents((prev) => [...prev, parsed]);
			} catch (err) {
				console.error("Failed to parse transcript event:", err);
			}
		};

		source.onerror = () => {
			setIsConnected(false);
			const msg = "Transcript stream disconnected";
			setError(msg);

			source.close();
			sourceRef.current = null;

			// Schedule reconnect with exponential backoff
			setIsReconnecting(true);
			reconnectTimerRef.current = setTimeout(() => {
				reconnectTimerRef.current = null;
				reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30_000);
				connect();
			}, reconnectDelayRef.current);
		};
	}, [planExecId, workspaceId]);

	useEffect(() => {
		reconnectDelayRef.current = 1000;
		connectedWsRef.current = null;

		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}

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

	return { events, isConnected, isReconnecting, error };
}
