/**
 * TransitionRouter — authoritative workspace lifecycle transition path.
 *
 * Routes workspace lifecycle mutations through the kernel's FSM-backed
 * controller (WorkspaceAttemptController) when PostgreSQL is available,
 * or falls back to direct IStateStore mutations for JSON backend.
 *
 * This eliminates the authority split described in the P25 audit:
 * - Attempt state is mutated only through WorkspaceAttemptController (PG)
 * - Direct IStateStore mutations are only used for JSON fallback
 * - Retry semantics are enforced by the attempt FSM
 * - Journal events are emitted with proper attempt event types
 */

import { type Database, getKysely } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import type { IStateStore } from "../core/state-store.js";
import type { WorkspaceStage } from "../core/workspace-schema.js";
import { WorkspaceStage as WS } from "../core/workspace-schema.js";
import { PiLogger } from "../utils/logger.js";
import { assertLegalTransition } from "./attempt-fsm.js";
import type { AttemptState } from "./types.js";
import { WorkspaceAttemptController } from "./workspace-attempt-controller.js";

/**
 * Maps workspace lifecycle stages to attempt FSM states.
 */
function mapStageToAttemptState(stage: WorkspaceStage): AttemptState | null {
	switch (stage) {
		case WS.Pending:
			return "PENDING";
		case WS.Active:
			return "RUNNING";
		case WS.Complete:
			return "SUCCEEDED";
		case WS.Failed:
			return "FAILED_RETRYABLE";
		case WS.Blocked:
			return "BLOCKED";
		default:
			return null;
	}
}

/**
 * TransitionRouter interface.
 *
 * Provides authoritative workspace lifecycle transition methods.
 * Implementations route through the kernel controller (PG) or
 * delegate directly to IStateStore (JSON fallback).
 */
export interface TransitionRouter {
	/**
	 * Route a workspace stage transition through the authoritative path.
	 *
	 * For PG backend, this creates attempt rows and routes events through
	 * WorkspaceAttemptController for FSM validation and journaling.
	 * For JSON backend, this delegates to IStateStore directly.
	 */
	transitionWorkspace(
		planExecutionId: string,
		workspaceId: string,
		newStage: WorkspaceStage,
		data?: Record<string, unknown>,
	): Promise<void>;

	/**
	 * Increment the workspace execution attempt counter.
	 *
	 * Attempt FSM retry events are routed by Failed/Blocked → Pending
	 * transitions. This method only updates the denormalized execution count.
	 */
	incrementRetryAttempt(planExecutionId: string, workspaceId: string): Promise<void>;
}

// =========================================================================
// DirectTransitionRouter — JSON backend fallback
// =========================================================================

/**
 * Direct transition router for JSON backend.
 * Delegates all lifecycle mutations to IStateStore directly.
 * No FSM validation, no attempt rows.
 */
export class DirectTransitionRouter implements TransitionRouter {
	private readonly stateStore: IStateStore;

	constructor(stateStore: IStateStore) {
		this.stateStore = stateStore;
	}

	async transitionWorkspace(
		planExecutionId: string,
		workspaceId: string,
		newStage: WorkspaceStage,
		data?: Record<string, unknown>,
	): Promise<void> {
		await this.stateStore.transitionWorkspace(planExecutionId, workspaceId, newStage, data);
	}

	async incrementRetryAttempt(planExecutionId: string, workspaceId: string): Promise<void> {
		await this.stateStore.incrementRetryAttempt(planExecutionId, workspaceId);
	}
}

// =========================================================================
// KernelTransitionRouter — PostgreSQL backend with FSM enforcement
// =========================================================================

/**
 * Internal cache entry for tracking attempt rows per workspace execution.
 */
interface AttemptCacheEntry {
	attemptId: string;
	workspaceExecutionId: string;
	version: number;
	currentState: AttemptState;
}

/**
 * Kernel transition router for PostgreSQL backend.
 *
 * Routes workspace lifecycle transitions through WorkspaceAttemptController
 * for FSM validation and attempt-level journaling. Also maintains attempt
 * rows in the database for audit and recovery.
 *
 * Falls through to IStateStore for the actual workspace stage persistence.
 */
export class KernelTransitionRouter implements TransitionRouter {
	private readonly stateStore: IStateStore;
	private readonly controller: WorkspaceAttemptController;
	private readonly db: Kysely<Database>;
	private readonly controllerId: string;
	private readonly log: PiLogger;

	/** Cache of attempt rows keyed by workspaceId */
	private attemptCache = new Map<string, AttemptCacheEntry>();

	constructor(stateStore: IStateStore, db: Kysely<Database>, controllerId?: string) {
		this.stateStore = stateStore;
		this.db = db;
		this.controllerId = controllerId ?? `autonomous-executor-${Date.now()}`;
		this.controller = new WorkspaceAttemptController(db, this.controllerId);
		this.log = new PiLogger({ component: "KernelTransitionRouter" });
	}

	async transitionWorkspace(
		planExecutionId: string,
		workspaceId: string,
		newStage: WorkspaceStage,
		data?: Record<string, unknown>,
	): Promise<void> {
		// Get current workspace stage from state store
		const wsState = await this.stateStore.getWorkspaceState(planExecutionId, workspaceId);
		const currentStage = wsState?.stage ?? WS.Pending;

		// Route through attempt controller for Active/Complete/Failed transitions
		if (currentStage !== newStage) {
			await this.routeStageTransition(planExecutionId, workspaceId, currentStage, newStage, data);
		}

		// Persist the workspace stage through IStateStore
		await this.stateStore.transitionWorkspace(planExecutionId, workspaceId, newStage, data);
	}

	async incrementRetryAttempt(planExecutionId: string, workspaceId: string): Promise<void> {
		const wsState = await this.stateStore.getWorkspaceState(planExecutionId, workspaceId);
		if (!wsState) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}

		// Persist execution attempt count through IStateStore. Do not emit an
		// attempt-controller retry event here: retry is a lifecycle transition
		// (Failed/Blocked → Pending), while this counter increments once per
		// actual agent execution, including the initial attempt.
		await this.stateStore.incrementRetryAttempt(planExecutionId, workspaceId);
	}

	/**
	 * Route a workspace stage transition through the attempt controller FSM.
	 */
	private async routeStageTransition(
		planExecutionId: string,
		workspaceId: string,
		currentStage: WorkspaceStage,
		newStage: WorkspaceStage,
		data?: Record<string, unknown>,
	): Promise<void> {
		try {
			// Pending → Active: create attempt row and fire attempt_started
			if (currentStage === WS.Pending && newStage === WS.Active) {
				await this.createAndStartAttempt(planExecutionId, workspaceId, data);
				return;
			}

			// Active → Complete: fire attempt_succeeded
			if (currentStage === WS.Active && newStage === WS.Complete) {
				await this.completeAttempt(workspaceId, data);
				return;
			}

			// Active → Failed: fire attempt_failed
			if (currentStage === WS.Active && newStage === WS.Failed) {
				await this.failAttempt(workspaceId, data);
				return;
			}

			// Failed → Pending (retry): fire retry event
			if (currentStage === WS.Failed && newStage === WS.Pending) {
				await this.retryAttempt(planExecutionId, workspaceId, data);
				return;
			}

			// Blocked → Pending (unblock): fire retry event
			if (currentStage === WS.Blocked && newStage === WS.Pending) {
				await this.retryAttempt(planExecutionId, workspaceId, data);
				return;
			}

			// Active → Blocked: fire attempt_blocked
			if (currentStage === WS.Active && newStage === WS.Blocked) {
				await this.blockAttempt(workspaceId, data);
				return;
			}

			// Active → Pending (pause): no attempt event, just log
			if (currentStage === WS.Active && newStage === WS.Pending) {
				this.log.info(`[workspace ${workspaceId}] Pause reset — no attempt event`);
				return;
			}

			// All other transitions: FSM validation only, no attempt event
			const fromState = mapStageToAttemptState(currentStage);
			const toState = mapStageToAttemptState(newStage);
			if (fromState && toState) {
				assertLegalTransition(fromState, toState);
			}
		} catch (error) {
			this.log.warn(
				`[workspace ${workspaceId}] Attempt controller rejected transition ${currentStage} -> ${newStage}: ${error instanceof Error ? error.message : String(error)}`,
			);
			// Fatal: controller/FSM rejection means the transition is not authorized.
			// The execution must stop here. Do NOT persist the transition via stateStore.
			// The caller (AutonomousExecutor.executeWorkspace()) relies on this throw
			// to abort workspace execution before starting the agent.
			throw error;
		}
	}

	/**
	 * Create an attempt row and fire attempt_started.
	 */
	private async createAndStartAttempt(
		planExecutionId: string,
		workspaceId: string,
		data?: Record<string, unknown>,
	): Promise<void> {
		// P37.RCA: If the attempt is already cached (retry of the same
		// workspace), skip row creation but still fire attempt_started so
		// the attempt transitions from its last state (e.g. FAILED_RETRYABLE
		// or PENDING from retry) back to RUNNING in the DB. Without this,
		// completeAttempt fires attempt_succeeded on a non-RUNNING attempt
		// and the FSM rejects PENDING -> SUCCEEDED.
		const cachedEntry = this.attemptCache.get(workspaceId);
		if (cachedEntry) {
			try {
				await this.controller.handleEvent(cachedEntry.attemptId, "attempt_started", {
					...data,
					workspaceId,
				});
				cachedEntry.currentState = "RUNNING";
				cachedEntry.version++;
			} catch (error) {
				this.log.error(
					`[workspace ${workspaceId}] Cached attempt handleEvent(attempt_started) failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				throw error;
			}
			return;
		}

		// Look up workspace execution ID from the DB
		const wsExecs = await this.db
			.selectFrom("workspace_executions")
			.select(["id", "project_id"])
			.where("plan_execution_id", "=", planExecutionId)
			.where("workspace_id", "=", workspaceId)
			.execute();

		const wsExec = wsExecs[0];
		if (!wsExec) {
			this.log.warn(`[workspace ${workspaceId}] No workspace execution row found, skipping attempt creation`);
			return;
		}

		// Check if an attempt row already exists for this workspace execution
		const existingAttempts = await this.db
			.selectFrom("attempts")
			.selectAll()
			.where("workspace_execution_id", "=", wsExec.id)
			.orderBy("created_at", "desc")
			.limit(1)
			.execute();

		let attemptId: string;

		if (existingAttempts.length > 0) {
			// Reuse existing attempt row
			const existing = existingAttempts[0];
			attemptId = existing.id;
			this.log.info(
				`[workspace ${workspaceId}] Reusing existing attempt ${attemptId} in state ${existing.current_state}`,
			);
		} else {
			// Create new attempt row
			const now = new Date().toISOString();
			attemptId = crypto.randomUUID();

			await this.db
				.insertInto("attempts")
				.values({
					id: attemptId,
					workspace_execution_id: wsExec.id,
					plan_execution_id: planExecutionId,
					project_id:
						wsExec.project_id ??
						(() => {
							throw new Error(`No project_id for workspace ${workspaceId} (exec ${wsExec.id})`);
						})(),
					current_state: "PENDING",
					version: 0,
					created_at: now,
					updated_at: now,
				})
				.execute();

			this.log.info(`[workspace ${workspaceId}] Created attempt ${attemptId}`);
		}

		// Route attempt_started through controller
		try {
			await this.controller.handleEvent(attemptId, "attempt_started", {
				...data,
				workspaceId,
			});
		} catch (error) {
			this.log.error(
				`[workspace ${workspaceId}] Controller handleEvent(attempt_started) failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}

		// Cache the attempt
		this.attemptCache.set(workspaceId, {
			attemptId,
			workspaceExecutionId: wsExec.id,
			version: 1,
			currentState: "RUNNING",
		});
	}

	/**
	 * Complete an attempt: fire attempt_succeeded.
	 */
	private async completeAttempt(workspaceId: string, data?: Record<string, unknown>): Promise<void> {
		const cacheEntry = this.attemptCache.get(workspaceId);
		if (!cacheEntry) {
			this.log.info(`[workspace ${workspaceId}] No cached attempt for completion, skipping`);
			return;
		}

		try {
			await this.controller.handleEvent(cacheEntry.attemptId, "attempt_succeeded", {
				...data,
				workspaceId,
			});
			cacheEntry.currentState = "SUCCEEDED";
			cacheEntry.version++;
		} catch (error) {
			// Post-execution: workspace is already complete, controller failure
			// is logged but does not undo execution. The state store transition
			// still happens in the caller.
			this.log.error(
				`[workspace ${workspaceId}] Controller handleEvent(attempt_succeeded) failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Fail an attempt: fire attempt_failed.
	 * Uses failed_final if max retries exhausted, otherwise failed_retryable.
	 */
	private async failAttempt(workspaceId: string, data?: Record<string, unknown>): Promise<void> {
		const cacheEntry = this.attemptCache.get(workspaceId);
		if (!cacheEntry) {
			this.log.info(`[workspace ${workspaceId}] No cached attempt for failure, skipping`);
			return;
		}

		try {
			await this.controller.handleEvent(cacheEntry.attemptId, "attempt_failed", {
				...data,
				workspaceId,
				isFinal: data?.isFinal ?? false,
			});
			cacheEntry.currentState = data?.isFinal ? "FAILED_FINAL" : "FAILED_RETRYABLE";
			cacheEntry.version++;
		} catch (error) {
			// Post-execution: workspace already failed, controller failure
			// is logged but does not undo the failure state.
			this.log.error(
				`[workspace ${workspaceId}] Controller handleEvent(attempt_failed) failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Retry an attempt: fire retry event (with FSM validation).
	 */
	private async retryAttempt(
		_planExecutionId: string,
		workspaceId: string,
		data?: Record<string, unknown>,
	): Promise<void> {
		const cacheEntry = this.attemptCache.get(workspaceId);
		if (!cacheEntry) {
			this.log.info(`[workspace ${workspaceId}] No cached attempt for retry, skipping controller routing`);
			return;
		}

		try {
			// assertRetryAllowed is called by handleEvent internally
			await this.controller.handleEvent(cacheEntry.attemptId, "retry", {
				reason: data?.reason ?? "retry_after_failure",
				previousStage: data?.previousStage,
				workspaceId,
			});
			cacheEntry.currentState = "READY";
			cacheEntry.version++;
		} catch (error) {
			// Pre-execution: retry rejection is fatal — the workspace must not retry.
			// The caller handles the error and marks the workspace as failed.
			this.log.error(
				`[workspace ${workspaceId}] Controller handleEvent(retry) rejected: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}

		// Clear the cache entry so the next Pending->Active transition
		// creates a fresh attempt row for the retry. Without this, the
		// cache hit in createAndStartAttempt would skip attempt_started,
		// leaving the DB state stuck at FAILED_RETRYABLE and causing an
		// illegal FAILED_RETRYABLE -> SUCCEEDED FSM rejection on completion.
		this.attemptCache.delete(workspaceId);
	}

	/**
	 * Block an attempt: fire attempt_blocked.
	 */
	private async blockAttempt(workspaceId: string, data?: Record<string, unknown>): Promise<void> {
		const cacheEntry = this.attemptCache.get(workspaceId);
		if (!cacheEntry) {
			this.log.info(`[workspace ${workspaceId}] No cached attempt for blocking, skipping`);
			return;
		}

		try {
			await this.controller.handleEvent(cacheEntry.attemptId, "attempt_blocked", {
				...data,
				workspaceId,
			});
			cacheEntry.currentState = "BLOCKED";
			cacheEntry.version++;
		} catch (error) {
			// Blocking happens during execution routing; controller failure
			// means the attempt is not properly tracked, which should be visible.
			this.log.error(
				`[workspace ${workspaceId}] Controller handleEvent(attempt_blocked) failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	}

	/**
	 * Clear the attempt cache for a workspace (e.g., on plan completion).
	 */
	clearCache(workspaceId?: string): void {
		if (workspaceId) {
			this.attemptCache.delete(workspaceId);
		} else {
			this.attemptCache.clear();
		}
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create the appropriate TransitionRouter based on backend type.
 *
 * For PostgreSQL: returns a KernelTransitionRouter with FSM enforcement.
 * For JSON: returns a DirectTransitionRouter that delegates to IStateStore.
 *
 * @param stateStore - The state store instance
 * @returns A TransitionRouter instance
 */
export function createTransitionRouter(stateStore: IStateStore): TransitionRouter {
	const backend = stateStore.getBackendType();

	if (backend === "postgres") {
		// PostgreSQL execution must use the kernel router. Falling back to
		// DirectTransitionRouter would bypass attempt rows and controller events.
		const db = getKysely();
		return new KernelTransitionRouter(stateStore, db);
	}

	return new DirectTransitionRouter(stateStore);
}
