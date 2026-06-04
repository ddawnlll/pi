import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkerInfo } from "../types";

// ─── Log channel types ────────────────────────────────────────────────────────

/** Log channels available in the live terminal. */
export type LogChannel = "stdout" | "stderr" | "test" | "tool" | "action" | "errors";

/** All available log channels for the filter buttons. */
export const LOG_CHANNELS: LogChannel[] = ["stdout", "stderr", "test", "tool", "action", "errors"];

/** Human-readable labels for each channel. */
export const CHANNEL_LABELS: Record<LogChannel, string> = {
	stdout: "Stdout",
	stderr: "Stderr",
	test: "Test",
	tool: "Tool",
	action: "Action",
	errors: "Errors",
};

/** Color classes for each channel's badge. */
export const CHANNEL_COLORS: Record<LogChannel, { text: string; bg: string }> = {
	stdout: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/30" },
	stderr: { text: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/30" },
	test: { text: "text-blue-700 dark:text-blue-300", bg: "bg-blue-50 dark:bg-blue-900/30" },
	tool: { text: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-900/30" },
	action: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/30" },
	errors: { text: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/30" },
};

// ─── Log entry ────────────────────────────────────────────────────────────────

/** A single log line with channel metadata. */
export interface LogEntry {
	/** Unique ID (incremental). */
	id: number;
	/** Channel this log belongs to. */
	channel: LogChannel;
	/** The log text content. */
	text: string;
	/** Timestamp when received. */
	timestamp: number;
	/** Worker ID this log came from. */
	workerId: string;
}

// ─── Log line classifier ────────────────────────────────────────────────────

/**
 * Classify a raw log line into a channel based on content.
 */
function classifyLogLine(line: string): LogChannel {
	const lower = line.toLowerCase();
	if (lower.includes("error") || lower.includes("fail") || lower.includes("stderr")) return "errors";
	if (lower.includes("test") || lower.includes("vitest") || lower.includes("validation")) return "test";
	if (lower.includes("tool:")) return "tool";
	if (lower.includes("running") || lower.includes("executing") || lower.includes("completed")) return "stdout";
	return "stdout";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES_PER_WORKER = 2000;

const API_BASE = "";

/**
 * Hook: manages live log entries for multiple workers using v2 log streams.
 *
 * Connects to /api/logs/v2/:planExecId/:workspaceId/raw which reads from
 * raw.log files on disk (always available, even for older executions).
 * Falls back to structured.ndjson and other log formats as needed.
 */
export function useLiveLogTerminal(
	workers: WorkerInfo[],
	planExecId: string | null,
) {
	/** Per-worker log entries, capped at MAX_LOG_ENTRIES_PER_WORKER. */
	const [logMap, setLogMap] = useState<Record<string, LogEntry[]>>({});
	/** Global incrementing ID counter. */
	const idCounterRef = useRef(0);
	/** Active channel filter (null = all channels). */
	const [activeChannel, setActiveChannel] = useState<LogChannel | null>(null);
	/** Selected worker ID. */
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	/** Whether auto-scroll is enabled. */
	const [autoScroll, setAutoScroll] = useState(true);
	/** Per-worker SSE connection refs for cleanup. */
	const sseSourcesRef = useRef<Map<string, EventSource>>(new Map());

	// Auto-select first active worker if none selected
	useEffect(() => {
		if (!selectedWorkerId && workers.length > 0) {
			const active = workers.find(w => w.stage === "active");
			setSelectedWorkerId(active?.id ?? workers[0].id);
		}
	}, [workers, selectedWorkerId]);

	// Ingest a log entry for a specific worker
	const addLog = useCallback((workerId: string, channel: LogChannel, text: string) => {
		const id = ++idCounterRef.current;
		const entry: LogEntry = { id, channel, text, timestamp: Date.now(), workerId };
		setLogMap(prev => {
			const existing = prev[workerId] ?? [];
			const updated = [...existing, entry];
			if (updated.length > MAX_LOG_ENTRIES_PER_WORKER) {
				return { ...prev, [workerId]: updated.slice(updated.length - MAX_LOG_ENTRIES_PER_WORKER) };
			}
			return { ...prev, [workerId]: updated };
		});
	}, []);

	// Connect to v2 log SSE stream for each worker
	useEffect(() => {
		if (!planExecId) return;

		// Clean up previous connections
		for (const [wid, source] of sseSourcesRef.current) {
			source.close();
		}
		sseSourcesRef.current.clear();
		setLogMap({});

		// Connect to raw log stream for each worker
		for (const worker of workers) {
			const workerId = worker.id;
			const workspaceId = worker.workspaceId ?? worker.id;
			const url = `${API_BASE}/api/logs/v2/${encodeURIComponent(planExecId)}/${encodeURIComponent(workspaceId)}/raw`;

			const source = new EventSource(url);
			sseSourcesRef.current.set(workerId, source);

			source.onmessage = (event) => {
				if (event.data === "__NO_LOGS__") return;

				const channel = classifyLogLine(event.data);
				addLog(workerId, channel, event.data);
			};

			source.onerror = () => {
				// Connection closed or error - this is normal for completed executions
			};
		}

		return () => {
			for (const [wid, source] of sseSourcesRef.current) {
				source.close();
			}
			sseSourcesRef.current.clear();
		};
	}, [planExecId, workers, addLog]);

	/** Logs for the currently selected worker, filtered by active channel. */
	const filteredLogs = useMemo(() => {
		const workerLogs = (selectedWorkerId ? logMap[selectedWorkerId] : null) ?? [];
		if (!activeChannel) return workerLogs;
		return workerLogs.filter(entry => entry.channel === activeChannel);
	}, [logMap, selectedWorkerId, activeChannel]);

	/** Total log count per worker (for display). */
	const logCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const [workerId, entries] of Object.entries(logMap)) {
			counts[workerId] = entries.length;
		}
		return counts;
	}, [logMap]);

	return {
		logMap,
		filteredLogs,
		activeChannel,
		setActiveChannel,
		selectedWorkerId,
		setSelectedWorkerId,
		autoScroll,
		setAutoScroll,
		addLog,
		logCounts,
	};
}
