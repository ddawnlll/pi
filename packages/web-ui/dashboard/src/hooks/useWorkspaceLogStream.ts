import { useCallback, useEffect, useRef, useState } from "react";

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

	const connect = useCallback(() => {
		if (socketRef.current) {
			socketRef.current.close();
			socketRef.current = null;
		}

		// Clear lines on reconnect
		setLines([]);
		setError(null);
		setIsConnected(false);

		if (!planExecId || !workspaceId) {
			return;
		}

		// Convert http/https to ws/wss
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const host = window.location.host;
		const wsUrl = `${protocol}//${host}${API_BASE}/api/ws/logs/${planExecId}/${workspaceId}`;

		try {
			const socket = new WebSocket(wsUrl);
			socketRef.current = socket;

			socket.onopen = () => {
				setIsConnected(true);
				setError(null);
			};

			socket.onmessage = (event) => {
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
				setError("Connection error");
				setIsConnected(false);
			};

			socket.onclose = () => {
				setIsConnected(false);
			};
		} catch (err) {
			console.error("Failed to create WebSocket:", err);
			setError("Failed to connect");
		}
	}, [planExecId, workspaceId]);

	useEffect(() => {
		connect();
		return () => {
			if (socketRef.current) {
				socketRef.current.close();
				socketRef.current = null;
			}
		};
	}, [connect]);

	return { lines, isConnected, error };
}
