import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "";
const MAX_EVENTS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
	type: "tool_call";
	timestamp: number;
	workspaceId?: string;
	toolName: string;
	input: string;
	result?: unknown;
	errorMessage?: string;
	isMcp: boolean;
	mcpServer?: string;
	/** Duration in ms (computed from consecutive start/end events, or null) */
	duration: number | null;
}

interface UseToolCallEventsOptions {
	projectId: string | null;
	planExecId: string | null;
}

// ---------------------------------------------------------------------------
// Raw journal event shape from the SSE stream
// ---------------------------------------------------------------------------

interface RawJournalEvent {
	type: string;
	timestamp: number;
	workspaceId?: string;
	data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that connects to the plan events SSE stream and filters for
 * `tool_call` events, returning structured ToolCallEvent objects.
 *
 * Each tool call is enriched with:
 *  - isMcp / mcpServer detection (tool names prefixed with `mcp:`)
 *  - duration tracking (matched start/completed pairs by workspace+toolName)
 */
export function useToolCallEvents({ projectId, planExecId }: UseToolCallEventsOptions) {
	const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
	const sourceRef = useRef<EventSource | null>(null);
	/** Track active tool calls by workspaceId+toolName for duration computation */
	const activeCallsRef = useRef<Map<string, number>>(new Map());

	const connect = useCallback(() => {
		if (sourceRef.current) {
			sourceRef.current.close();
			sourceRef.current = null;
		}

		if (!projectId || !planExecId) {
			setToolCalls([]);
			return;
		}

		const url = `${API_BASE}/api/projects/${projectId}/plans/${planExecId}/events`;
		const source = new EventSource(url);
		sourceRef.current = source;

		source.onmessage = (event) => {
			try {
				const parsed: RawJournalEvent = JSON.parse(event.data);

				// Only care about tool_call events
				if (parsed.type !== "tool_call") return;

				const data = parsed.data ?? {};
				const toolName = String(data.toolName ?? "unknown");
				const input = String(data.input ?? "");
				const isMcp = toolName.startsWith("mcp:");
				const mcpServer = isMcp ? toolName.split(":")[1] : undefined;

				// Determine status from data
				const hasError = data.result === "error" || !!data.errorMessage;
				const hasResult = data.result !== undefined && data.result !== "error";

				// Build a key for duration tracking
				const wsId = parsed.workspaceId ?? "global";
				const callKey = `${wsId}:${toolName}`;
				const now = parsed.timestamp;

				// Duration tracking: if this looks like a completion (has result or error),
				// compute duration from the stored start time.
				let duration: number | null = null;
				if (hasResult || hasError) {
					const startTime = activeCallsRef.current.get(callKey);
					if (startTime) {
						duration = now - startTime;
						activeCallsRef.current.delete(callKey);
					}
				} else {
					// Treat as start of tool call
					activeCallsRef.current.set(callKey, now);
				}

				const toolCallEvent: ToolCallEvent = {
					type: "tool_call",
					timestamp: parsed.timestamp,
					workspaceId: parsed.workspaceId,
					toolName,
					input,
					result: data.result,
					errorMessage: data.errorMessage as string | undefined,
					isMcp,
					mcpServer,
					duration,
				};

				setToolCalls((prev) => {
					const next = [toolCallEvent, ...prev];
					if (next.length > MAX_EVENTS) next.pop();
					return next;
				});
			} catch (error) {
				console.error("Failed to parse tool_call event:", error);
			}
		};

		source.onerror = () => {
			console.error("Tool call events SSE error, reconnecting...");
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
			activeCallsRef.current.clear();
		};
	}, [connect]);

	/** Reset and reconnect (useful when filters change or data is stale) */
	const refresh = useCallback(() => {
		connect();
	}, [connect]);

	return { toolCalls, refresh };
}
