import { useCallback, useEffect, useRef, useState } from "react";
import type { LogStream } from "../types";

const API_BASE = "";

export function useLogStream(
	workspaceId: string | null,
	attempt: number | null,
	stream: LogStream | null,
) {
	const [lines, setLines] = useState<string[]>([]);
	const sourceRef = useRef<EventSource | null>(null);

	const connect = useCallback(() => {
		if (sourceRef.current) {
			sourceRef.current.close();
			sourceRef.current = null;
		}

		// Clear lines on reconnect
		setLines([]);

		if (!workspaceId || attempt === null || !stream) {
			return;
		}

		const source = new EventSource(
			`${API_BASE}/api/logs/${workspaceId}/${attempt}/${stream}`,
		);
		sourceRef.current = source;

		source.onmessage = (event) => {
			setLines((prev) => [...prev, event.data]);
		};

		source.onerror = () => {
			console.error("Log stream error");
		};
	}, [workspaceId, attempt, stream]);

	useEffect(() => {
		connect();
		return () => {
			if (sourceRef.current) {
				sourceRef.current.close();
				sourceRef.current = null;
			}
		};
	}, [connect]);

	return { lines };
}
