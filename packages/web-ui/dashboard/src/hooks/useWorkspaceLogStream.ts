import { useEffect, useRef, useState } from "react";

const API_BASE = "";

interface LogMessage {
	type: "log" | "ready" | "error";
	data?: string;
	message?: string;
}

/**
 * WebSocket-based log streaming hook for workspace logs.
 *
 * Connects to ws://localhost:3000/api/ws/logs/:planExecId/:workspaceId
 * and receives real-time log updates.
 */
export function useWorkspaceLogStream(
	planExecId: string | null,
	workspaceId: string | null,
) {
	const [lines, setLines] = useState<string[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		if (!planExecId || !workspaceId) {
			return;
		}

		// Clear lines and error when switching to a new workspace
		setLines([]);
		setError(null);
		setIsConnected(false);

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
				setError(null);
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

			socket.onerror = (event) => {
				console.error("WebSocket error:", event);
				if (socketRef.current !== socket) return;
				setError("Connection error");
				setIsConnected(false);
			};

			socket.onclose = (event) => {
				if (socketRef.current !== socket) return;
				// Log diagnostics: close code, reason, wasClean
				console.debug(
					`WebSocket closed: code=${event.code} reason="${event.reason}" wasClean=${event.wasClean} planExecId=${planExecId} workspaceId=${workspaceId}`,
				);
				setIsConnected(false);
				// Only surface an error if the close was unexpected (not a normal cleanup)
				if (event.code !== 1000 && event.code !== 1001) {
					setError(`Connection closed (code: ${event.code})`);
				}
			};
		} catch (err) {
			console.error("Failed to create WebSocket:", err);
			setError("Failed to connect");
		}

		return () => {
			// Null out the ref so no callbacks from this socket fire after cleanup
			if (socketRef.current === socket) {
				socketRef.current = null;
			}
			// Close the socket (this will fire onclose, but our ref check prevents state updates)
			if (socket && socket.readyState !== WebSocket.CLOSED) {
				socket.close();
			}
		};
	}, [planExecId, workspaceId]);

	return { lines, isConnected, error };
}
