/**
 * WorkerAdapter — P40 Platform / Agent Separation
 *
 * The boundary between execution platform and agent workers.
 * A WorkerAdapter executes a workspace packet and returns a result.
 * It does NOT own execution state, does NOT transition workspace state,
 * and does NOT bypass CompletionGate or Lead Agent.
 *
 * Execution decides how the result maps to workspace state.
 */

import type { AccpWorkerOutput } from "./accp-types.js";

// ---------------------------------------------------------------------------
// WorkerAdapter interface
// ---------------------------------------------------------------------------

export interface WorkerAdapter {
	/**
	 * Execute a workspace packet.
	 * Returns a WorkerRunResult with verdict, events, and artifacts.
	 */
	run(request: WorkerRunRequest): Promise<WorkerRunResult>;

	/**
	 * Abort a running execution by run ID.
	 */
	abort(runId: string): Promise<void>;

	/**
	 * Get adapter capabilities (for future extensibility).
	 */
	getCapabilities(): WorkerAdapterCapabilities;
}

// ---------------------------------------------------------------------------
// WorkerRunRequest
// ---------------------------------------------------------------------------

export interface WorkerRunRequest {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace execution ID */
	workspaceExecutionId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Attempt number (1-based) */
	attemptNumber: number;
	/** Project root directory */
	projectRoot: string;
	/** Workspace path (may differ from projectRoot in worktree mode) */
	workspacePath: string;
	/** The hashed packet to execute */
	packet: Record<string, unknown>;
	/** Allowed tools for this execution */
	allowedTools: string[];
	/** Execution timeout in milliseconds */
	timeoutMs: number;
	/** Optional external abort signal (e.g. from plan stop) */
	abortSignal?: AbortSignal;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// WorkerRunResult
// ---------------------------------------------------------------------------

export interface WorkerRunResult {
	/** Verdict from the worker */
	verdict: WorkerVerdict;
	/** Events emitted during execution */
	events: WorkerEvent[];
	/** Files changed by the worker */
	changedFiles: string[];
	/** Command history recorded during execution */
	commandHistory: WorkerCommandHistoryEntry[];
	/** Worker report/output */
	report?: string;
	/** Optional ACCP v2.0 structured output (additive — P49.03) */
	accp?: AccpWorkerOutput;
	/** Error message if failed */
	error?: string;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export type WorkerVerdict = "complete" | "failed" | "blocked" | "timed_out" | "cancelled";

export interface WorkerEvent {
	type: string;
	payload: Record<string, unknown>;
	timestamp: number;
}

export interface WorkerCommandHistoryEntry {
	command: string;
	cwd: string;
	exitCode: number | null;
	startedAt: number;
	finishedAt: number;
	outputSummary?: string;
}

export interface WorkerAdapterCapabilities {
	name: string;
	version: string;
	supportsWorktree: boolean;
	supportsPatchTransaction: boolean;
	maxConcurrent: number;
}
