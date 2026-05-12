import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "";

interface LogMessage {
	type: "log" | "ready" | "error";
	data?: string;
	message?: string;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

/**
 * WebSocket-based log streaming hook for workspace logs.
 *
 * Connects to ws://<host>/api/ws/logs/:planExecId/:workspaceId
 * and receives real-time log updates.
 *
 * Auto-reconnects with exponential backoff when the connection
 * drops unexpectedly. Lines accumulated so far are preserved
 * across reconnections.
 */
export function useWorkspaceLogStream(
	planExecId: string | null,
	workspaceId: string | null,
) {
	const [lines, setLines] = useState<string[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
	// Track which workspace we're connected to so reconnects preserve lines
	const connectedWsRef = useRef<string | null>(null);

	const connect = useCallback(() => {
		if (!planExecId || !workspaceId) {
			return;
		}

		// Close any existing socket before creating a new one
		const existing = socketRef.current;
		if (existing) {
			socketRef.current = null;
			// Only close if it was open, to avoid "closed before connection established" noise
			if (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING) {
				try {
					existing.close();
				} catch {
					// Ignore close errors on stale sockets
				}
			}
		}

		// Only clear lines on first connect to a NEW workspace (not on reconnect)
		if (connectedWsRef.current !== workspaceId) {
			setLines([]);
			setError(null);
			connectedWsRef.current = workspaceId;
		}

		// Convert http/https to ws/wss
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const host = window.location.host;
		const wsUrl = `${protocol}//${host}${API_BASE}/api/ws/logs/${planExecId}/${workspaceId}`;

		let socket: WebSocket | null = null;

		try {
				socket = new WebSocket(wsUrl);
			socketRef.current = socket;

			socket.onopen = () => {
				if (socketRef.current !== socket) return;
				setIsConnected(true);
				setIsReconnecting(false);
				setError(null);
				// Reset backoff on successful connect
				reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
			};

			socket.onmessage = (event) => {
				if (socketRef.current !== socket) return;

				try {
					const message: LogMessage = JSON.parse(event.data);

					if (message.type === "log" && message.data) {
						setLines((prev) => [...prev, message.data!]);
					} else if (message.type === "error") {
						setError(message.message || "Unknown error");
					}
					// "ready" type is just a signal, no action needed
				} catch (err) {
					console.error("Failed to parse WebSocket message:", err);
				}
			};

			socket.onerror = () => {
				if (socketRef.current !== socket) return;
				setIsConnected(false);
				// Don't set error here — onclose will fire with more detail
			};

			socket.onclose = (event) => {
				if (socketRef.current !== socket) return;
				console.debug(
					`WebSocket closed: code=${event.code} reason="${event.reason}" wasClean=${event.wasClean} planExecId=${planExecId} workspaceId=${workspaceId}`,
				);
				setIsConnected(false);
				setIsReconnecting(false);

				// Normal close (cleanup initiated by us) — do not reconnect
				if (event.code === 1000 || event.code === 1001) {
					return;
				}

				// Unexpected close — surface error and schedule reconnect
				const msg =
					event.code === 1006
						? "Connection lost"
						: `Connection closed (code: ${event.code})`;
				setError(msg);

				// Schedule reconnect with exponential backoff
				setIsReconnecting(true);
				reconnectTimerRef.current = setTimeout(() => {
					reconnectTimerRef.current = null;
					reconnectDelayRef.current = Math.min(
						reconnectDelayRef.current * 2,
						MAX_RECONNECT_DELAY_MS,
					);
					connect();
				}, reconnectDelayRef.current);
			};
		} catch (err) {
			console.error("Failed to create WebSocket:", err);
			setError("Failed to connect");

			// Schedule reconnect for construction failure too
			setIsReconnecting(true);
			reconnectTimerRef.current = setTimeout(() => {
				reconnectTimerRef.current = null;
				reconnectDelayRef.current = Math.min(
					reconnectDelayRef.current * 2,
					MAX_RECONNECT_DELAY_MS,
				);
				connect();
			}, reconnectDelayRef.current);
		}
	}, [planExecId, workspaceId]);

	useEffect(() => {
		// Reset reconnect state when switching workspaces
		reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
		connectedWsRef.current = null;

		// Clear any pending reconnect
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}

		connect();

		return () => {
			// Prevent reconnect after unmount
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			// Null out ref so no stale callbacks fire
			const current = socketRef.current;
			socketRef.current = null;
			// Only close fully-open sockets during cleanup to avoid
			// "WebSocket is closed before the connection is established" warnings.
			if (current && current.readyState === WebSocket.OPEN) {
				current.close(1000, "Component unmount");
			}
		};
	}, [connect]);

	return { lines, isConnected, isReconnecting, error };
}
