/**
 * WorkerAdapter Types — P40 Platform / Agent Separation
 *
 * Canonical types for the worker adapter boundary.
 * The WorkerAdapter executes work and returns results.
 * Execution decides how results map to state transitions.
 */

import type { HashedPacket } from "../core/role-packets.js";

// ---------------------------------------------------------------------------
// WorkerAdapter interface
// ---------------------------------------------------------------------------

/**
 * WorkerAdapter — the boundary between execution platform and agent workers.
 *
 * A WorkerAdapter executes a workspace packet and returns a result.
 * It does NOT own execution state, does NOT transition workspace state,
 * and does NOT bypass CompletionGate or Lead Agent.
 *
 * Execution decides how the result maps to workspace state.
 */
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

/**
 * Request to execute a workspace packet.
 */
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
	packet: HashedPacket;
	/** Allowed tools for this execution */
	allowedTools: string[];
	/** Execution timeout in milliseconds */
	timeoutMs: number;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// WorkerRunResult
// ---------------------------------------------------------------------------

/**
 * Result of a worker execution.
 *
 * This result has NO authority to mutate execution state.
 * Execution maps this result to workspace state transitions.
 */
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
	/** Error message if failed */
	error?: string;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Worker verdict — the outcome of a worker execution.
 */
export type WorkerVerdict = "complete" | "failed" | "blocked" | "timed_out" | "cancelled";

/**
 * Worker event — an event emitted during worker execution.
 */
export interface WorkerEvent {
	/** Event type */
	type: string;
	/** Event payload */
	payload: Record<string, unknown>;
	/** Timestamp */
	timestamp: number;
}

/**
 * Command history entry from worker execution.
 */
export interface WorkerCommandHistoryEntry {
	/** The command that was executed */
	command: string;
	/** Working directory */
	cwd: string;
	/** Exit code (null if still running) */
	exitCode: number | null;
	/** When the command started */
	startedAt: number;
	/** When the command finished */
	finishedAt: number;
	/** Output summary */
	outputSummary?: string;
}

// ---------------------------------------------------------------------------
// WorkerAdapterCapabilities
// ---------------------------------------------------------------------------

/**
 * Capabilities reported by a worker adapter.
 */
export interface WorkerAdapterCapabilities {
	/** Adapter name (e.g., "local-pi", "codex", "claude") */
	name: string;
	/** Adapter version */
	version: string;
	/** Whether this adapter supports worktree isolation */
	supportsWorktree: boolean;
	/** Whether this adapter supports patch transactions */
	supportsPatchTransaction: boolean;
	/** Maximum concurrent executions (0 = unlimited) */
	maxConcurrent: number;
}
