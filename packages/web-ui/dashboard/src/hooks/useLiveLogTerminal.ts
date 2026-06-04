import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkerInfo, WorkerTranscriptEvent } from "../types";

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

// ─── Transcript event → log channel classification ────────────────────────────────

/**
 * Classify a transcript event type into a log channel.
 *
 * Maps transcript event types to the terminal's channel model:
 * - tool_call → tool
 * - validation → test
 * - blocker → errors
 * - workspace_failed → errors
 * - workspace_start/complete/blocked → action
 * - retry_attempt → action
 * - worker_status → stdout or stderr based on content
 * - worker_decision_summary → stdout
 */
function classifyChannel(event: WorkerTranscriptEvent): LogChannel {
	const t = event.type;

	// Tool calls
	if (t === "tool_call") return "tool";

	// Errors and blockers
	if (t === "blocker" || t === "workspace_failed") return "errors";

	// Validation results (pass/fail)
	if (t === "validation") return "test";

	// Workspace lifecycle actions
	if (
		t === "workspace_start" ||
		t === "workspace_complete" ||
		t === "workspace_blocked" ||
		t === "retry_attempt"
	) {
		return "action";
	}

	// Worker status — check summary content for hints
	if (t === "worker_status") {
		const msg = (event.summary ?? "").toLowerCase();
		if (msg.includes("error") || msg.includes("fail") || msg.includes("warning")) {
			return "stderr";
		}
		if (msg.startsWith("tool:")) return "tool";
		return "stdout";
	}

	// worker_decision_summary → stdout
	if (t === "worker_decision_summary") return "stdout";

	// Default to stdout
	return "stdout";
}

/**
 * Format a transcript event into a human-readable log line.
 * Uses the summary field which is already formatted.
 */
function formatEventText(event: WorkerTranscriptEvent): string {
	return event.summary || `[${event.type}]`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES_PER_WORKER = 2000;

const API_BASE = "";

/**
 * Hook: manages live log entries for multiple workers using transcript SSE stream.
 *
 * Connects to /api/transcript/:planExecId which provides aggregated transcript
 * events from all workspaces in chronological order.
 * Events are classified into channels and routed to the correct worker.
 * The hook caps logs at MAX_LOG_ENTRIES_PER_WORKER per worker to keep the UI responsive.
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
			// Cap at MAX_LOG_ENTRIES_PER_WORKER — trim oldest
			if (updated.length > MAX_LOG_ENTRIES_PER_WORKER) {
				return { ...prev, [workerId]: updated.slice(updated.length - MAX_LOG_ENTRIES_PER_WORKER) };
			}
			return { ...prev, [workerId]: updated };
		});
	}, []);

	// Build a map from workspaceId to workerId for routing events to the correct worker
	const wsToWorkerMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const w of workers) {
			if (w.workspaceId) {
				map.set(w.workspaceId, w.id);
			}
		}
		console.log('[LiveLogTerminal] Built wsToWorkerMap:', {
			size: map.size,
			entries: Array.from(map.entries()),
			workers: workers.map(w => ({ id: w.id, workspaceId: w.workspaceId })),
		});
		return map;
	}, [workers]);

	// Connect to transcript SSE stream
	useEffect(() => {
		if (!planExecId) {
			console.log('[LiveLogTerminal] No planExecId provided');
			return;
		}

		console.log('[LiveLogTerminal] Connecting to transcript stream for plan:', planExecId);

		const url = `${API_BASE}/api/transcript/${encodeURIComponent(planExecId)}`;
		console.log('[LiveLogTerminal] Full URL:', url);
		
		const source = new EventSource(url);

		source.onopen = () => {
			console.log('[LiveLogTerminal] ✓ Transcript stream connected successfully');
		};

		source.onmessage = (event) => {
			if (event.data === "__NO_TRANSCRIPT__") {
				console.log('[LiveLogTerminal] No transcript data available yet');
				return;
			}

			try {
				const transcriptEvent: WorkerTranscriptEvent = JSON.parse(event.data);
				
				console.log('[LiveLogTerminal] Received transcript event:', {
					type: transcriptEvent.type,
					workspaceId: transcriptEvent.workspaceId,
					summary: transcriptEvent.summary?.substring(0, 100),
				});

				const channel = classifyChannel(transcriptEvent);
				const text = formatEventText(transcriptEvent);

				// Route to the correct worker using workspaceId
				const workerId = wsToWorkerMap.get(transcriptEvent.workspaceId) ?? transcriptEvent.workspaceId;

				console.log('[LiveLogTerminal] Routing to worker:', workerId);
				addLog(workerId, channel, text);
			} catch (err) {
				console.error("[LiveLogTerminal] Failed to parse transcript event:", err);
			}
		};

		source.onerror = (error) => {
			console.error("[LiveLogTerminal] ✗ Transcript stream error:", error);
			console.error("[LiveLogTerminal] ReadyState:", source.readyState);
			console.error("[LiveLogTerminal] URL was:", url);
		};

		return () => {
			console.log('[LiveLogTerminal] Closing transcript stream');
			source.close();
		};
	}, [planExecId, wsToWorkerMap, addLog]);

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
