import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkerInfo, JournalEvent } from "../types";

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
	test: { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/30" },
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

// ─── Journal event → log channel classification ────────────────────────────────

/**
 * Classify a journal event type into a log channel.
 *
 * Maps real event types from the SSE stream to the terminal's channel model:
 * - tool_call → tool
 * - worker_status with test/tool keywords → test / tool
 * - workspace_start/complete, retry_attempt, file_lock → action
 * - validation → test
 * - blocker → errors
 * - plan_resumed, plan_paused, plan_complete → action
 * - Other error-like events → errors
 * - Everything else → stdout
 */
function classifyChannel(event: JournalEvent): LogChannel {
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
		t === "retry_attempt" ||
		t === "file_lock_acquired" ||
		t === "file_lock_released" ||
		t === "plan_resumed" ||
		t === "plan_paused" ||
		t === "plan_complete" ||
		t === "plan_failed" ||
		t === "plan_handoff"
	) {
		return "action";
	}

	// Worker status — check message content for test/stderr hints
	if (t === "worker_status") {
		const msg = String(event.data?.message ?? "").toLowerCase();
		if (msg.includes("test") || msg.includes("vitest") || msg.includes("pass") || msg.includes("fail")) {
			return "test";
		}
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
 * Format a journal event into a human-readable log line.
 */
function formatEventText(event: JournalEvent): string {
	const t = event.type;
	const data = event.data ?? {};

	switch (t) {
		case "tool_call": {
			const toolName = String(data.toolName ?? "unknown");
			const input = String(data.input ?? "");
			// Truncate long tool inputs
			const preview = input.length > 120 ? input.slice(0, 120) + "..." : input;
			return `[tool] ${toolName}(${preview})`;
		}
		case "worker_status": {
			const msg = String(data.message ?? "");
			return msg || `[${t}]`;
		}
		case "worker_decision_summary": {
			const summary = String(data.summary ?? "");
			return summary || `[${t}]`;
		}
		case "validation": {
			const passed = data.passed === true || data.passed === "true";
			const msg = String(data.message ?? "");
			return passed ? `✓ Validation passed: ${msg}` : `✗ Validation failed: ${msg}`;
		}
		case "blocker": {
			const reason = String(data.reason ?? data.message ?? "");
			return `⊘ Blocked: ${reason}`;
		}
		case "workspace_start":
			return `▶ Workspace started`;
		case "workspace_complete":
			return `✓ Workspace completed`;
		case "workspace_failed": {
			const err = String(data.error ?? "");
			return `✗ Workspace failed: ${err}`;
		}
		case "workspace_blocked":
			return `⊘ Workspace blocked`;
		case "retry_attempt": {
			const attempt = data.attempt ?? "?";
			const max = data.maxAttempts ?? "?";
			return `⟳ Retry attempt ${attempt}/${max}`;
		}
		case "file_lock_acquired": {
			const files = data.files as string[] | undefined;
			const fileStr = Array.isArray(files) && files.length > 0 ? `: ${files.join(", ")}` : "";
			return `🔒 File lock acquired${fileStr}`;
		}
		case "file_lock_released":
			return `🔓 File lock released`;
		case "plan_resumed":
			return `▶ Plan resumed`;
		case "plan_paused":
			return `⏸ Plan paused`;
		case "plan_complete":
			return `✓ Plan complete`;
		case "plan_failed": {
			const err = String(data.error ?? "");
			return `✗ Plan failed: ${err}`;
		}
		case "plan_handoff":
			return `⏳ Plan awaiting handoff`;
		default:
			return `[${t}]${Object.keys(data).length > 0 ? ` ${JSON.stringify(data).slice(0, 200)}` : ""}`;
	}
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES_PER_WORKER = 2000;

const API_BASE = "";

/**
 * Hook: manages live log entries for multiple workers with channel filtering and capping.
 *
 * Ingests real journal events from the SSE plan events endpoint.
 * Events are classified into channels and routed to the correct worker.
 * The hook caps logs at MAX_LOG_ENTRIES_PER_WORKER per worker to keep the UI responsive.
 */
export function useLiveLogTerminal(
	workers: WorkerInfo[],
	planEvents?: JournalEvent[],
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
	/** Track last processed event timestamp to avoid reprocessing on re-renders. */
	const lastProcessedTsRef = useRef<number>(0);

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
		return map;
	}, [workers]);

	// Ingest real plan events (from SSE) into the log terminal
	useEffect(() => {
		if (!planEvents || planEvents.length === 0) return;

		// Only process events newer than the last one we processed.
		// planEvents is newest-first (preluded by the hook), so the first
		// element is the most recent. We process in chronological order.
		const newEvents = planEvents
			.filter(e => e.timestamp > lastProcessedTsRef.current)
			.sort((a, b) => a.timestamp - b.timestamp);

		if (newEvents.length === 0) return;

		// Update the high-water mark
		lastProcessedTsRef.current = newEvents[newEvents.length - 1].timestamp;

		for (const event of newEvents) {
			const channel = classifyChannel(event);
			const text = formatEventText(event);

			// Route to the correct worker using workspaceId
			const workerId = event.workspaceId
				? (wsToWorkerMap.get(event.workspaceId) ?? String(event.workspaceId))
				: "_plan";

			addLog(workerId, channel, text);
		}
	}, [planEvents, wsToWorkerMap, addLog]);

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
