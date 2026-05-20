/**
 * usePlanTranscript — SSE hook for plan-level aggregated transcript.
 *
 * Connects to /api/transcript/:planExecId which merges transcript events
 * from all workspaces plus plan-level narrative events, streamed in
 * chronological order.
 *
 * Automatically reconnects with exponential backoff on disconnect.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerTranscriptEvent } from "../types";

const API_BASE = "";

interface UsePlanTranscriptOptions {
	planExecId: string | null;
}

interface UsePlanTranscriptResult {
	events: WorkerTranscriptEvent[];
	isConnected: boolean;
	isReconnecting: boolean;
	error: string | null;
}

export function usePlanTranscript({
	planExecId,
}: UsePlanTranscriptOptions): UsePlanTranscriptResult {
	const [events, setEvents] = useState<WorkerTranscriptEvent[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sourceRef = useRef<EventSource | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectDelayRef = useRef(1000);
	const connectedExecRef = useRef<string | null>(null);

	const connect = useCallback(() => {
		if (!planExecId) {
			setEvents([]);
			setIsConnected(false);
			return;
		}

		// Close any existing connection
		if (sourceRef.current) {
			sourceRef.current.close();
			sourceRef.current = null;
		}

		// Clear events on execution switch
		if (connectedExecRef.current !== planExecId) {
			setEvents([]);
			setError(null);
			connectedExecRef.current = planExecId;
		}

		const url = `${API_BASE}/api/transcript/${encodeURIComponent(planExecId)}`;
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
	}, [planExecId]);

	useEffect(() => {
		reconnectDelayRef.current = 1000;
		connectedExecRef.current = null;

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
