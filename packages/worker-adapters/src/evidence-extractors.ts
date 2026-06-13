/**
 * Evidence field extractors for the Local Pi Worker Adapter (P49.31 FIX-004).
 *
 * These functions populate the `changedFiles`, `events`, and `commandHistory`
 * fields of `WorkerRunResult` from real sources instead of empty arrays.
 *
 * ## Sources
 *
 * - `request.metadata.changedFiles: string[]` — caller-supplied file list
 * - `request.metadata.commandHistory: WorkerCommandHistoryEntry[]` — caller-supplied
 * - `request.metadata.events: WorkerEvent[]` — caller-supplied
 * - `agentResult.logs: string[]` — agent execution logs (used to derive events
 *   and command history when caller did not supply them)
 * - Worktree diff via `git diff --name-only` when `workspacePath` is a git
 *   worktree and `request.metadata.computeChangedFiles` is true. The git
 *   command is bounded by a 5s timeout and runs synchronously so a hung
 *   git cannot block the adapter.
 */

import { execFileSync } from "node:child_process";
import type { WorkerCommandHistoryEntry, WorkerEvent, WorkerRunRequest } from "@earendil-works/pi-execution-contracts";

const GIT_TIMEOUT_MS = 5_000;

interface MinimalAgentResult {
	logs: string[];
}

export function collectChangedFiles(request: WorkerRunRequest, agentResult: MinimalAgentResult): string[] {
	const meta = request.metadata ?? {};
	if (Array.isArray(meta.changedFiles)) {
		return meta.changedFiles.filter((f): f is string => typeof f === "string");
	}
	// No caller-supplied list. Caller may opt-in to a git diff when the
	// workspace path is a worktree.
	if (meta.computeChangedFiles === true && request.workspacePath) {
		return collectChangedFilesFromGit(request.workspacePath);
	}
	// Last resort: parse `Modified file:` markers from logs.
	return parseFileMarkers(agentResult.logs);
}

export function collectEvents(agentResult: MinimalAgentResult, request: WorkerRunRequest): WorkerEvent[] {
	const meta = request.metadata ?? {};
	if (Array.isArray(meta.events)) {
		return meta.events as WorkerEvent[];
	}
	return parseEventMarkers(agentResult.logs, request);
}

export function collectCommandHistory(
	agentResult: MinimalAgentResult,
	request: WorkerRunRequest,
): WorkerCommandHistoryEntry[] {
	const meta = request.metadata ?? {};
	if (Array.isArray(meta.commandHistory)) {
		return meta.commandHistory as WorkerCommandHistoryEntry[];
	}
	return parseCommandMarkers(agentResult.logs, request);
}

// ---------------------------------------------------------------------------
// Git diff
// ---------------------------------------------------------------------------

function collectChangedFilesFromGit(workspacePath: string): string[] {
	try {
		const stdout = execFileSync("git", ["diff", "--name-only", "HEAD"], {
			cwd: workspacePath,
			timeout: GIT_TIMEOUT_MS,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 1024 * 1024,
		});
		return stdout
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Log-based fallback parsing
// ---------------------------------------------------------------------------

const FILE_MARKER = /(?:^|\s)(?:Modified file|Wrote to file|file_write|file_edit):\s*(.+?)(?:\s|$)/i;
const EVENT_MARKER = /\[event\]\s+(\w+)\s+(.*)/;
const COMMAND_MARKER = /\[cmd\]\s+(.+?)\s+(?:exit=(\d+)|finished|started)/i;

function parseFileMarkers(logs: readonly string[]): string[] {
	const files = new Set<string>();
	for (const line of logs) {
		const m = FILE_MARKER.exec(line);
		if (m) files.add(m[1].trim());
	}
	return [...files];
}

function parseEventMarkers(logs: readonly string[], request: WorkerRunRequest): WorkerEvent[] {
	const events: WorkerEvent[] = [];
	let ts = Date.now();
	for (const line of logs) {
		const m = EVENT_MARKER.exec(line);
		if (m) {
			try {
				events.push({
					type: m[1],
					payload: JSON.parse(m[2]),
					timestamp: ts++,
				});
			} catch {
				events.push({ type: m[1], payload: { raw: m[2] }, timestamp: ts++ });
			}
		}
	}
	if (events.length > 0) return events;
	// Always emit a single workspace-lifecycle event so downstream consumers
	// can rely on at least one entry per run.
	return [
		{
			type: "workspace.run.completed",
			payload: { workspaceId: request.workspaceId, attempt: request.attemptNumber },
			timestamp: ts,
		},
	];
}

function parseCommandMarkers(logs: readonly string[], request: WorkerRunRequest): WorkerCommandHistoryEntry[] {
	const history: WorkerCommandHistoryEntry[] = [];
	for (const line of logs) {
		const m = COMMAND_MARKER.exec(line);
		if (m) {
			history.push({
				command: m[1].trim(),
				cwd: request.workspacePath,
				exitCode: m[2] !== undefined ? Number.parseInt(m[2], 10) : null,
				startedAt: Date.now(),
				finishedAt: Date.now(),
			});
		}
	}
	return history;
}
