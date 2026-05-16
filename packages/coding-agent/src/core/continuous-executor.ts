/**
 * ContinuousExecutor
 *
 * Manages a pool of N concurrent workspace execution slots (default 6).
 * Fills all slots immediately at startup and continuously refills them
 * as each workspace completes, until no more ready workspaces exist.
 *
 * No batch barrier — new workspaces start on the same tick as a prior
 * one completes, keeping all slots busy until no more ready workspaces.
 *
 * Supports abort via AbortController.
 */

import type { WorkspaceExecutionResult } from "./autonomous-executor.js";
import type { Workspace } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Summary of a continuous execution run.
 */
export interface ContinuousExecutionSummary {
	/** Individual workspace results in completion order */
	results: WorkspaceExecutionResult[];
	/** Whether execution was aborted */
	aborted: boolean;
	/** Number of workspaces that completed successfully */
	completedCount: number;
	/** Number of workspaces that failed */
	failedCount: number;
	/** Number of workspaces that ended blocked */
	blockedCount: number;
}

// ---------------------------------------------------------------------------
// SerialMutex
// ---------------------------------------------------------------------------

/**
 * Simple promise-chain based async mutex.
 * Serializes access to a critical section without risk of deadlock.
 */
class SerialMutex {
	private current: Promise<void> = Promise.resolve();

	async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		await this.current;
		let release: () => void;
		this.current = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			return await fn();
		} finally {
			release!();
		}
	}
}

// ---------------------------------------------------------------------------
// ContinuousExecutor
// ---------------------------------------------------------------------------

/**
 * Configuration for the ContinuousExecutor.
 */
export interface ContinuousExecutorConfig {
	/**
	 * Number of concurrent execution slots.
	 * All slots are filled immediately on start and kept busy
	 * until no more ready workspaces exist.
	 * Default: 6
	 */
	concurrency?: number;
}

/**
 * ContinuousExecutor
 *
 * Maintains a pool of N concurrent workspace execution slots.
 * As soon as one workspace finishes, the next ready workspace
 * is dispatched to the freed slot — no batch barrier, no gap.
 *
 * Workspaces are polled via a `getReadyWorkspaces` callback that
 * returns workspaces whose dependencies are met and whose file
 * locks are not held by any active workspace.
 *
 * Abort is signalled via a per-run AbortController whose signal
 * is forwarded to each `executeWorkspace` call. Call
 * `executor.abort()` to cancel all in-flight executions.
 */
export class ContinuousExecutor {
	private concurrency: number;
	private abortController: AbortController | null = null;

	constructor(config: ContinuousExecutorConfig = {}) {
		this.concurrency = config.concurrency ?? 6;
	}

	/**
	 * Execute all ready workspaces continuously.
	 *
	 * Phase 1 — Fill: calls `getReadyWorkspaces` repeatedly (serially
	 * via mutex) to fill all N slots as fast as possible.
	 *
	 * Phase 2 — Drain/Refill: as each slot completes, immediately
	 * dispatches the next ready workspace to the freed slot. This
	 * loop continues until no more ready workspaces exist and all
	 * in-flight slots have settled.
	 *
	 * Abort: when `executor.abort()` is called, the `signal` is set
	 * to aborted, in-flight `executeWorkspace` promises are expected
	 * to detect the signal and resolve, and the method returns the
	 * partial results gathered so far.
	 *
	 * @param workspaces        - Full list of workspace definitions
	 * @param getReadyWorkspaces - Returns currently ready workspaces
	 * @param executeWorkspace  - Executes a single workspace; must
	 *                            respect the AbortSignal and resolve
	 *                            promptly when the signal fires
	 * @returns Execution summary
	 */
	async executeAll(
		workspaces: Workspace[],
		getReadyWorkspaces: (workspaces: Workspace[]) => Promise<Workspace[]>,
		executeWorkspace: (workspace: Workspace, signal: AbortSignal) => Promise<WorkspaceExecutionResult>,
	): Promise<ContinuousExecutionSummary> {
		// If already aborted (e.g., abort() called before start), return empty.
		if (this.abortController?.signal.aborted) {
			return {
				results: [],
				aborted: true,
				completedCount: 0,
				failedCount: 0,
				blockedCount: 0,
			};
		}

		this.abortController = new AbortController();
		const signal = this.abortController.signal;
		const started = new Set<string>();
		const results: WorkspaceExecutionResult[] = [];
		const mutex = new SerialMutex();

		let inFlight = 0;
		let resolveAllDone: (() => void) | null = null;
		const allDone = new Promise<void>((resolve) => {
			resolveAllDone = resolve;
		});

		// Signals completion when inFlight drops to zero.
		const signalDone = (): void => {
			if (inFlight === 0 && resolveAllDone) {
				resolveAllDone();
			}
		};

		// Atomically pick the next ready workspace that has not yet been
		// dispatched. Serialized via mutex to prevent races between
		// concurrent fill/drain operations.
		const getNext = async (): Promise<Workspace | null> => {
			return mutex.runExclusive(async () => {
				if (signal.aborted) return null;
				const ready = await getReadyWorkspaces(workspaces);
				const next = ready.find((ws) => !started.has(ws.id));
				if (next) started.add(next.id);
				return next ?? null;
			});
		};

		// Execute one workspace and, when done (or on abort), immediately
		// dispatch the next ready workspace to the freed slot.
		const executeOne = async (ws: Workspace): Promise<void> => {
			try {
				const result = await executeWorkspace(ws, signal);
				results.push(result);
			} finally {
				inFlight--;

				// If not aborted, immediately fill the freed slot with the
				// next ready workspace — same tick, no batch barrier.
				if (!signal.aborted) {
					const next = await getNext();
					if (next) {
						inFlight++;
						// Fire-and-forget: the chain continues asynchronously.
						executeOne(next);
					}
				}

				signalDone();
			}
		};

		// ---- Phase 1: Fill all slots immediately ------------------------
		// Loops serially (each iteration awaits getNext which acquires the
		// mutex), so we don't race on `started` or `getReadyWorkspaces`.
		for (let i = 0; i < this.concurrency; i++) {
			const ws = await getNext();
			if (!ws || signal.aborted) break;
			inFlight++;
			executeOne(ws);
		}

		// ---- Phase 2: Wait for drain ------------------------------------
		// When the last workspace completes and no more are ready,
		// inFlight reaches zero and allDone resolves.
		if (inFlight > 0) {
			await allDone;
		}

		return {
			results,
			aborted: signal.aborted,
			completedCount: results.filter((r) => r.verdict === "COMPLETE").length,
			failedCount: results.filter((r) => r.verdict === "FAILED").length,
			blockedCount: results.filter((r) => r.verdict === "BLOCKED").length,
		};
	}

	/**
	 * Abort all in-flight executions.
	 *
	 * Sets the AbortController's signal to aborted. Each in-flight
	 * `executeWorkspace` call is expected to detect the signal and
	 * resolve promptly. After calling this, `executeAll` will return
	 * the partial results gathered so far.
	 *
	 * If called before a run, the next `executeAll` call will see the
	 * aborted signal and return immediately with empty results.
	 */
	abort(): void {
		if (!this.abortController) {
			this.abortController = new AbortController();
		}
		this.abortController.abort();
	}

	/**
	 * Whether an abort has been requested.
	 */
	get aborted(): boolean {
		return this.abortController?.signal.aborted ?? false;
	}
}
