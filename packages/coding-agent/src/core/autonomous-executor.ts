/**
 * Autonomous Execution Loop - P2 Workstreams 7.F + 7.H
 *
 * Orchestrates autonomous workspace execution with state management,
 * packet generation, journal logging, and retry handling.
 *
 * Refactored for Phase 1 to use IStateStore instead of PlanStateStore,
 * enabling both JSON and PostgreSQL persistence backends.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { TransitionRouter } from "../execution-kernel/transition-router.js";
import { createTransitionRouter } from "../execution-kernel/transition-router.js";
import { PiLogger } from "../utils/logger.js";
import { killTrackedDetachedChildren } from "../utils/shell.js";
import type { WorktreeConfig } from "../worktree/worktree-types.js";
import { AutoCommit } from "./auto-commit.js";
import { CompletionGateRegistry, evaluatePlanCompletion } from "./completion-gate.js";
import type { PlanState } from "./plan-state.js";
import { generateWorkspaceReport } from "./plan-state.js";
import { RetryHandler, type RetryPolicy, RetryStage } from "./retry-handler.js";
import { type HashedPacket, RolePacketBuilder } from "./role-packets.js";
import type { IStateStore, PlanControlState } from "./state-store.js";
import { createStateStore, detectStateStoreBackend } from "./state-store.js";
import { DEFAULT_WORKERS, resolveEffectiveWorkerCount, type WorkerConcurrencySettings } from "./worker-concurrency.js";
import { WorkspaceAgentExecutor, type WorkspaceAgentExecutorConfig } from "./workspace-agent-executor.js";
import { WorkspaceScheduler } from "./workspace-scheduler.js";
import type { ApprovedPreviewMetadata, Workspace, WorkspaceQueue, WorkspaceQueue as WQ } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

/**
 * Simple promise-chain based async mutex.
 * Serializes access to shared resources without risk of deadlock.
 */
class AsyncMutex {
	private current: Promise<void> = Promise.resolve();

	/**
	 * Execute a function exclusively under this mutex.
	 * The mutex is released in a finally block after the function completes or throws.
	 */
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

/**
 * Workspace snapshot directory structure
 */
export interface WorkspaceSnapshot {
	/** Workspace ID */
	workspaceId: string;
	/** Snapshot directory path */
	snapshotDir: string;
	/** Latest packet file path */
	packetPath: string;
	/** Latest report file path */
	reportPath: string;
	/** Retry snapshots directory */
	retryDir: string;
}

/**
 * Execution result for a workspace
 */
export interface WorkspaceExecutionResult {
	/** Workspace ID */
	workspaceId: string;
	/** Execution success */
	success: boolean;
	/** Result verdict */
	verdict: "COMPLETE" | "BLOCKED" | "FAILED";
	/** Error message (if failed) */
	error?: string;
	/** Report content */
	report?: string;
}

/**
 * Autonomous executor configuration.
 */
export interface AutonomousExecutorConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** Maximum concurrent workers (default: 3) */
	maxWorkers?: number;
	/** Retry policy */
	retryPolicy?: RetryPolicy;
	/** Project ID to associate executions with */
	projectId?: string;
	/** Skip project management (for backward compat with single-project mode) */
	skipProjectManagement?: boolean;
	/** Model to use for agent execution */
	model?: Model<any>;
	/** Enable real agent execution (default: false for backward compat) */
	enableRealExecution?: boolean;
	/**
	 * Worker concurrency settings.
	 * When provided, overrides maxWorkers.
	 * Supports stable (1-3) and experimental (4-6) worker modes.
	 */
	workerConcurrency?: WorkerConcurrencySettings;
	/**
	 * Enable automatic git commits after workspace completion.
	 * When false, no commits are made.
	 * Defaults to true.
	 */
	autoCommit?: boolean;
	/**
	 * Enable post-plan handoff dialog.
	 * When true (default), plan enters awaiting_handoff state after all workspaces complete
	 * and waits for user to commit, keep editing, or discard.
	 * When false, plan auto-commits without handoff dialog.
	 * Defaults to true.
	 */
	postPlanHandoff?: boolean;
	/**
	 * Handoff timeout in milliseconds.
	 * If the plan is awaiting_handoff for longer than this duration,
	 * it auto-commits with a warning log.
	 * Defaults to 30 minutes (1800000 ms).
	 */
	handoffTimeoutMs?: number;
	/**
	 * Approved preview metadata from the plan preview flow.
	 *
	 * When provided, the executor uses the approved dependency graph for
	 * scheduling (AC1) and persists the preview metadata (AC2).
	 */
	approvedPreview?: ApprovedPreviewMetadata;
	/**
	 * Worktree isolation configuration.
	 * When enabled, each workspace executes inside its own git worktree.
	 * When disabled or absent, falls back to P5.5 shared-working-tree execution.
	 * Required for experimental_6 scale mode.
	 */
	worktree?: WorktreeConfig;
	/**
	 * Workspace execution timeout in milliseconds.
	 * If a single workspace execution takes longer than this, it is aborted.
	 * Defaults to 30 minutes (1800000 ms).
	 */
	workspaceTimeoutMs?: number;
}

/**
 * Autonomous executor
 *
 * Manages autonomous workspace execution:
 * - Reads plan state
 * - Schedules eligible workspaces
 * - Creates role packets
 * - Executes workspace stages
 * - Updates journal and state
 * - Creates workspace snapshots
 *
 * Uses IStateStore for persistence, supporting both JSON and PostgreSQL backends.
 */
export class AutonomousExecutor {
	private stateStore: IStateStore;
	private transitionRouter: TransitionRouter;
	private scheduler: WorkspaceScheduler;
	private packetBuilder: RolePacketBuilder;
	private retryHandler: RetryHandler;
	private stateCacheMutex = new AsyncMutex();
	private workspaceRoot: string;
	private projectId: string;
	private planExecutionId: string | null = null;
	private currentPlanState: PlanState | null = null;
	private workspaceQueue: WorkspaceQueue | null = null;
	/** Approved preview metadata from the dependency graph (AC1 + AC2). */
	private approvedPreview: ApprovedPreviewMetadata | null = null;
	/** P26.B: Per-workspace executor instances, keyed by workspace ID */
	private activeAgentExecutors = new Map<string, WorkspaceAgentExecutor>();
	private enableRealExecution: boolean;
	/** Stored config for lazy per-workspace executor creation */
	private executorConfig: WorkspaceAgentExecutorConfig | null = null;
	private autoCommitEnabled: boolean;
	private postPlanHandoffEnabled: boolean;
	private handoffTimeoutMs: number;
	/** Completion gate registry for tracking validation state per workspace (P4.6.1) */
	private completionGate = new CompletionGateRegistry();
	/** P4.6.3: Track in-flight execution promises per workspace for cancellation */
	private inFlightExecutions = new Map<string, Promise<WorkspaceExecutionResult>>();

	/**
	 * Register a promise for tracking via inFlightExecutions.
	 * When the promise settles (resolves or rejects), it is removed from the map.
	 */
	private trackExecution(workspaceId: string, promise: Promise<WorkspaceExecutionResult>): void {
		this.inFlightExecutions.set(workspaceId, promise);
		// Suppress unhandled rejection from the .finally() side-chain
		// The caller (executeWorkspace) handles the rejection via catch.
		promise
			.finally(() => {
				if (this.inFlightExecutions.get(workspaceId) === promise) {
					this.inFlightExecutions.delete(workspaceId);
				}
			})
			.catch(() => {});
	}

	constructor(stateStore: IStateStore, config: AutonomousExecutorConfig) {
		this.stateStore = stateStore;
		this.transitionRouter = createTransitionRouter(stateStore);
		this.workspaceRoot = config.workspaceRoot;

		// Resolve effective worker count from workerConcurrency settings or maxWorkers
		const effectiveWorkers = config.workerConcurrency
			? resolveEffectiveWorkerCount(config.workerConcurrency)
			: (config.maxWorkers ?? DEFAULT_WORKERS);

		this.scheduler = new WorkspaceScheduler(effectiveWorkers);
		this.packetBuilder = new RolePacketBuilder();
		this.retryHandler = new RetryHandler(config.retryPolicy);
		this.projectId = config.projectId ?? "default";
		this.enableRealExecution = config.enableRealExecution ?? false;
		this.autoCommitEnabled = config.autoCommit ?? true;
		this.postPlanHandoffEnabled = config.postPlanHandoff ?? true;
		this.handoffTimeoutMs = config.handoffTimeoutMs ?? 30 * 60 * 1000; // 30 minutes

		// AC1 + AC2: Apply approved preview metadata if provided in config
		if (config.approvedPreview) {
			this.setApprovedPreviewMetadata(config.approvedPreview);
		}

		// If skipProjectManagement, use a fixed projectId
		if (config.skipProjectManagement) {
			this.projectId = "default";
		}

		// P26.B: Store config for lazy per-workspace executor creation.
		// Each executeWorkspace call creates its own WorkspaceAgentExecutor
		// so concurrent workspaces have isolated executor instances.
		if (this.enableRealExecution) {
			this.executorConfig = {
				workspaceRoot: config.workspaceRoot,
				model: config.model,
				maxTurns: 50,
				stateStore: this.stateStore,
				timeoutMs: config.workspaceTimeoutMs,
				// P22.C: Worktree mode is FORCED enabled regardless of config.
				// Any plan attempting to disable worktree isolation will be blocked
				// at the WorkspaceAgentExecutor.execute() level.
				worktree: { enabled: true },
			};
		}
	}

	/**
	 * Update all active agent executors with current plan execution ID after
	 * initialization or when adopting an existing execution.
	 */
	private updateAgentExecutorContext(): void {
		if (this.planExecutionId) {
			for (const executor of this.activeAgentExecutors.values()) {
				executor.setPlanExecutionId(this.planExecutionId);
			}
		}
	}

	/**
	 * Create a workspace-scoped WorkspaceAgentExecutor for the given workspace.
	 * Registers the executor in activeAgentExecutors for stop/artifact handling.
	 * The executor is removed from the map after execution completes (via
	 * trackExecution cleanup) or abort.
	 */
	private createWorkspaceExecutor(workspaceId: string): WorkspaceAgentExecutor | null {
		if (!this.enableRealExecution || !this.executorConfig) {
			return null;
		}

		// Remove any stale executor for this workspace (from a prior attempt)
		const existing = this.activeAgentExecutors.get(workspaceId);
		if (existing) {
			existing.abort();
			this.activeAgentExecutors.delete(workspaceId);
		}

		const executor = new WorkspaceAgentExecutor(this.executorConfig);
		if (this.planExecutionId) {
			executor.setPlanExecutionId(this.planExecutionId);
		}
		this.activeAgentExecutors.set(workspaceId, executor);
		return executor;
	}

	/**
	 * Set the approved preview metadata from the plan preview approval flow.
	 *
	 * AC1: Ensures the executor uses the approved dependency graph, not stale
	 * parser output. The batch assignments and topological batches are transferred
	 * to the scheduler for batch-aware scheduling and logging.
	 *
	 * AC2: The approved preview metadata is persisted alongside execution state
	 * for audit and crash recovery.
	 *
	 * @param metadata - Approved preview metadata (batch assignments, batches, etc.)
	 */
	setApprovedPreviewMetadata(metadata: ApprovedPreviewMetadata): void {
		this.approvedPreview = metadata;

		// Transfer batch assignments to scheduler for AC4 (batch ID logging)
		const batchAssignment = new Map<string, number>(Object.entries(metadata.batchAssignment));
		this.scheduler.setBatchAssignment(batchAssignment, metadata.batches);
	}

	/**
	 * Get the approved preview metadata.
	 *
	 * @returns Approved preview metadata or null if not set
	 */
	getApprovedPreviewMetadata(): ApprovedPreviewMetadata | null {
		return this.approvedPreview;
	}

	/**
	 * Initialize execution for a plan
	 *
	 * @param queue - Workspace queue
	 */
	async initialize(queue: WQ): Promise<string> {
		// NOTE: The old hasRunningExecution phase-based dedup check was removed.
		// Each plan upload should always create a fresh execution. The in-flight
		// guard in runPlan() prevents concurrent calls for the same project.

		const planExecutionId = await this.stateStore.initializeState(this.projectId, queue);
		this.planExecutionId = planExecutionId;
		this.workspaceQueue = queue;

		// Apply queue-level postPlanHandoff setting
		if (queue.postPlanHandoff !== undefined) {
			this.postPlanHandoffEnabled = queue.postPlanHandoff;
		}

		// Load state into cache
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) {
			this.currentPlanState = state;
		}

		// Update agent executor with the new plan execution ID
		this.updateAgentExecutorContext();

		return planExecutionId;
	}

	/**
	 * Adopt an existing execution for crash recovery.
	 *
	 * Loads persisted state and workspace queue, then resets any stranded
	 * active/pending workspaces so the background loop can resume them.
	 *
	 * @param planExecutionId - Existing execution ID
	 * @param queue - The original workspace queue (used for scheduling)
	 */
	async adoptExistingExecution(
		planExecutionId: string,
		queue: WorkspaceQueue,
		options: { allowTerminal?: boolean } = {},
	): Promise<boolean> {
		this.planExecutionId = planExecutionId;
		this.workspaceQueue = queue;

		// Apply queue-level postPlanHandoff setting
		if (queue.postPlanHandoff !== undefined) {
			this.postPlanHandoffEnabled = queue.postPlanHandoff;
		}

		const state = await this.stateStore.loadState(planExecutionId);
		if (!state) {
			return false;
		}
		this.currentPlanState = state;

		// If the plan is already terminal, only manual continue/rerun may adopt it.
		if (state.status === "complete") {
			return false;
		}
		if ((state.status === "failed" || state.status === "cancelled") && !options.allowTerminal) {
			return false;
		}

		// Reset scheduler caches (fileLocks, batchAssignment, batches) to prevent
		// stale locks from previous execution from blocking workspace scheduling.
		this.scheduler.reset();

		// Reset stranded or resettable workspaces back to pending so they get
		// re-scheduled. Completed workspaces are never reset here.
		let recovered = 0;
		const resetReason = options.allowTerminal ? "manual-continue" : "crash-recovery";
		for (const [wsId, ws] of state.workspaces) {
			if (
				ws.stage === WorkspaceStage.Active ||
				ws.stage === WorkspaceStage.Failed ||
				(options.allowTerminal && ws.stage === WorkspaceStage.Blocked)
			) {
				await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
					reason: resetReason,
					previousStage: ws.stage,
				});
				recovered++;
			}
		}

		// Reset paused/stopped/failed/cancelled plans to running so the loop picks them up.
		if (
			state.status === "paused" ||
			state.status === "stopped" ||
			(options.allowTerminal && (state.status === "failed" || state.status === "cancelled"))
		) {
			await this.stateStore.resumePlan(planExecutionId);
		}

		// Update agent executor with the current plan execution ID (#2/#3)
		this.updateAgentExecutorContext();

		// Rebuild completion gate state from persisted workspace state (#4).
		// Completed workspaces are marked as implementation-finished so the
		// gate doesn't block them when evaluateWorkspaceCompletion is called.
		this.completionGate = new CompletionGateRegistry();
		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === WorkspaceStage.Complete) {
				this.completionGate.markImplementationFinished(planExecutionId, wsId);
			}
		}

		// Reload state cache after transitions so the background loop sees
		// the updated workspace states (e.g. stranded Active → Pending).
		const updatedState = await this.stateStore.loadState(planExecutionId);
		if (updatedState) {
			this.currentPlanState = updatedState;
		}

		const log = new PiLogger({ planExecId: planExecutionId });
		log.info(
			`Adopted execution ${planExecutionId}, recovered ${recovered} stranded workspace(s), status=${state.status}`,
		);

		return true;
	}

	/**
	 * Get the current plan execution ID.
	 */
	getPlanExecutionId(): string | null {
		return this.planExecutionId;
	}

	/**
	 * Re-run a failed plan execution, skipping already-completed workspaces.
	 *
	 * Resets failed and blocked workspaces back to pending so they can be
	 * re-scheduled. Completed workspaces are left untouched. The plan status
	 * is reset from "failed" to "running" so the execution loop picks it up.
	 *
	 * Returns a summary of what was reset and what was kept.
	 *
	 * @param queue - The original workspace queue (for scheduling/dependency graph)
	 * @param options - Rerun options
	 * @returns Rerun result summary
	 */
	async rerunExecution(
		queue: WorkspaceQueue,
		options: { resetBlocked?: boolean; resetFailed?: boolean } = {},
	): Promise<{
		success: boolean;
		resetWorkspaces: string[];
		keptWorkspaces: string[];
		error?: string;
	}> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return { success: false, resetWorkspaces: [], keptWorkspaces: [], error: "No plan execution ID" };
		}

		const state = await this.stateStore.loadState(planExecutionId);
		if (!state) {
			return { success: false, resetWorkspaces: [], keptWorkspaces: [], error: "No state found to rerun" };
		}

		// Only allow rerun for terminal states (failed, stopped, cancelled)
		if (state.status !== "failed" && state.status !== "stopped" && state.status !== "cancelled") {
			return {
				success: false,
				resetWorkspaces: [],
				keptWorkspaces: [],
				error: `Plan status is '${state.status}', not a terminal state. Rerun is only for failed/stopped/cancelled plans.`,
			};
		}

		const resetFailed = options.resetFailed ?? true;
		const resetBlocked = options.resetBlocked ?? true;
		const resetWorkspaces: string[] = [];
		const keptWorkspaces: string[] = [];

		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === WorkspaceStage.Complete) {
				keptWorkspaces.push(wsId);
				continue;
			}

			if (ws.stage === WorkspaceStage.Failed && resetFailed) {
				await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
					reason: "rerun",
					previousStage: ws.stage,
				});
				resetWorkspaces.push(wsId);
				continue;
			}

			if (ws.stage === WorkspaceStage.Blocked && resetBlocked) {
				await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
					reason: "rerun",
					previousStage: ws.stage,
				});
				resetWorkspaces.push(wsId);
				continue;
			}

			// Active or pending workspaces: just keep them as-is (they'll be picked up)
			if (ws.stage === WorkspaceStage.Active || ws.stage === WorkspaceStage.Pending) {
				keptWorkspaces.push(wsId);
				continue;
			}

			// Any other stage (shouldn't happen, but be safe)
			keptWorkspaces.push(wsId);
		}

		if (resetWorkspaces.length === 0) {
			return {
				success: false,
				resetWorkspaces: [],
				keptWorkspaces,
				error: "No workspaces to reset. All workspaces are already complete or not in a resettable state.",
			};
		}

		// Reset plan status to running so the execution loop picks it up
		await this.stateStore.resumePlan(planExecutionId);

		// Load updated state into cache
		this.workspaceQueue = queue;
		this.currentPlanState = await this.stateStore.loadState(planExecutionId);

		// Clear any pending control requests
		try {
			const { createPlanControlManager } = await import("./plan-control.js");
			const mgr = createPlanControlManager(this.workspaceRoot);
			await mgr.clearControlRequest();
		} catch {
			// Non-fatal — control file may not exist
		}

		const log = new PiLogger({ planExecId: planExecutionId });
		log.info(
			`Rerun execution ${planExecutionId}: reset ${resetWorkspaces.length} workspace(s), kept ${keptWorkspaces.length} complete`,
		);

		return { success: true, resetWorkspaces, keptWorkspaces };
	}

	/**
	 * Execute a single workspace
	 *
	 * This is a simplified execution that:
	 * 1. Creates workspace snapshot directory
	 * 2. Generates role packet
	 * 3. Saves packet to snapshot
	 * 4. Simulates execution (actual agent execution deferred)
	 * 5. Generates report
	 * 6. Updates state
	 *
	 * @param workspace - Workspace to execute
	 * @returns Execution result
	 */
	/**
	 * Execute a single workspace.
	 *
	 * P26.D: Accepts an optional AbortSignal. When the signal fires,
	 * the workspace-scoped executor is aborted and execution resolves
	 * with a FAILED verdict.
	 *
	 * @param workspace - Workspace to execute
	 * @param simulateFailure - Simulate a failure (for testing)
	 * @param abortSignal - Optional external abort signal
	 * @returns Execution result
	 */
	async executeWorkspace(
		workspace: Workspace,
		simulateFailure = false,
		abortSignal?: AbortSignal,
	): Promise<WorkspaceExecutionResult> {
		const { planExecutionId, wsState } = await this.stateCacheMutex.runExclusive(async () => {
			const planExecutionId = this.planExecutionId;
			if (!planExecutionId) {
				throw new Error("Execution not initialized. Call initialize() first.");
			}

			const state = this.currentPlanState;
			if (!state) {
				throw new Error("State not initialized");
			}

			const wsState = state.workspaces.get(workspace.id);
			if (!wsState) {
				throw new Error(`Workspace ${workspace.id} not found in state`);
			}

			return { planExecutionId, wsState } as const;
		});

		try {
			// Memory guard: check before starting a new agent session
			const { getMemorySnapshot, canStartWorker, waitForMemoryAvailable, formatMemorySnapshot } = await import(
				"./worker-memory-guard.js"
			);
			const memSnap = getMemorySnapshot();
			if (!canStartWorker(`workspace ${workspace.id}`)) {
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Memory limit reached (${formatMemorySnapshot(memSnap)}), waiting...`,
				);
				await waitForMemoryAvailable();
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Memory available, proceeding`,
				);
			}

			// Increment execution attempt counter for every agent run.
			// Attempt 1 is the initial execution; the state store suppresses
			// retry_attempt journal events until attempt > 1.
			await this.transitionRouter.incrementRetryAttempt(planExecutionId, workspace.id);
			const updatedWsState = await this.stateStore.getWorkspaceState(planExecutionId, workspace.id);

			// Transition to active via TransitionRouter (Finding 2)
			await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Active);

			// Create workspace snapshot directory
			const snapshot = await this.createWorkspaceSnapshot(workspace.id);

			// Release stale file locks from completed/failed workspaces before acquiring new ones.
			// This prevents lock contention between workspaces with overlapping canEdit paths
			// (e.g., "src/**") when a prior workspace has finished but its locks weren't released.
			const currentPlanState = this.currentPlanState;
			if (currentPlanState) {
				for (const [wsId, wsState] of currentPlanState.workspaces) {
					if (wsState.stage === WorkspaceStage.Complete || wsState.stage === WorkspaceStage.Failed) {
						this.scheduler.releaseLocksByWorkspaceId(wsId);
					}
				}
			}

			// Acquire file locks
			const lockedFiles = this.scheduler.acquireFileLocks(workspace);
			await this.stateStore.acquireFileLocks(planExecutionId, workspace.id, lockedFiles);

			const wsStateForPacket = updatedWsState ?? wsState;

			// Determine retry stage and generate appropriate packet
			const retryStage = this.retryHandler.getRetryStage(wsStateForPacket.attempts);
			const retryContext = wsStateForPacket.error
				? this.retryHandler.getRetryContext(wsStateForPacket, wsStateForPacket.error)
				: "";

			const policy = this.retryHandler.getPolicy();
			const flashThreshold = policy.escalationThresholds.flash;
			const reviewerThreshold = policy.escalationThresholds.reviewer;
			let packet: HashedPacket;

			// P8.A: Dispatch based on workspace role budget
			// Lead role: read-only observation, skip retry escalation
			if (workspace.roleBudget === "lead") {
				// Gather dependency results for lead context from current plan state
				const depResults: Record<string, string> = {};
				const currentState = this.currentPlanState;
				if (currentState) {
					for (const depId of workspace.dependencies) {
						const depState = currentState.workspaces.get(depId);
						if (depState && depState.stage === WorkspaceStage.Complete) {
							depResults[depId] = depState.error || "Completed";
						}
					}
				}
				packet = this.packetBuilder.buildLeadPacket(workspace, wsStateForPacket, depResults);
				// Log that this is a read-only lead agent execution
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Lead role — read-only execution, no mutations allowed`,
				);
			} else if (retryStage === RetryStage.Flash && wsStateForPacket.attempts >= flashThreshold) {
				packet = this.packetBuilder.buildFlashPacket(workspace, wsStateForPacket, retryContext);
			} else if (retryStage === RetryStage.Reviewer && wsStateForPacket.attempts >= reviewerThreshold) {
				packet = this.packetBuilder.buildReviewerPacket(workspace, wsStateForPacket, retryContext);
			} else {
				packet = this.packetBuilder.buildWorkerPacket(workspace, wsStateForPacket, retryContext);
			}

			// Save packet to snapshot
			await this.savePacketSnapshot(snapshot, packet, wsStateForPacket.attempts);

			// P26.B: Create a workspace-scoped executor for this call.
			// Each executeWorkspace call gets its own WorkspaceAgentExecutor so
			// concurrent workspaces cannot overwrite each other's executor state.
			const workspaceExecutor = this.createWorkspaceExecutor(workspace.id);

			// Execute workspace with real agent or simulate
			// P4.6.3: Wrap execution in a tracked promise so stopAllActiveWorkspaces() can await it.
			// P26.D: External abort signal is passed to execute() via _signal option;
			// execute() wires it to the internal abortController internally.
			const executionPromise = (async (): Promise<WorkspaceExecutionResult> => {
				let result: WorkspaceExecutionResult;

				if (this.enableRealExecution && workspaceExecutor) {
					// Real agent execution
					const logPath = path.join(snapshot.snapshotDir, `execution-${wsStateForPacket.attempts}.log`);

					// P26.C: Pass logPath to execute() instead of calling setLogPath()
					// P26.D: Pass abortSignal so execute() wires it to the internal abortController
					// P26.F: Pass attemptNo for attempt-scoped worktree paths and branch names
					const agentResult = await workspaceExecutor.execute(packet, workspace.id, {
						_signal: abortSignal,
						logPath,
						attemptNo: wsStateForPacket.attempts,
					});

					// Write execution logs (also written by executor on completion, but keep
					// this as a safety net in case executor didn't write them for any reason)
					await fs.writeFile(logPath, agentResult.logs.join("\n"), "utf-8");

					if (agentResult.error?.startsWith("Transient provider failure:")) {
						throw new Error(agentResult.error);
					}

					result = {
						workspaceId: workspace.id,
						success: agentResult.success,
						verdict: agentResult.verdict,
						report: agentResult.report,
						error: agentResult.error,
					};
				} else {
					// Simulate execution (for testing/backward compat)
					if (simulateFailure) {
						throw new Error("Simulated test failure");
					}

					result = {
						workspaceId: workspace.id,
						success: true,
						verdict: "COMPLETE",
						report: `Workspace ${workspace.id} executed successfully (attempt ${wsStateForPacket.attempts}) [SIMULATED]`,
					};
				}

				return result;
			})();

			this.trackExecution(workspace.id, executionPromise);
			const result = await executionPromise;

			// P26.B: Remove workspace-scoped executor now that execution is complete.
			// This ensures the executor is cleaned up even on success so concurrent
			// workspaces cannot reference a stale executor instance identity.
			this.activeAgentExecutors.delete(workspace.id);

			// Generate and save report
			const report = generateWorkspaceReport(workspace, {
				...wsStateForPacket,
				stage: WorkspaceStage.Complete,
				completedAt: Date.now(),
			});
			await this.saveReport(snapshot, report);

			// Release file locks
			this.scheduler.releaseFileLocks(workspace);
			await this.stateStore.releaseFileLocks(planExecutionId, workspace.id);

			// P8.A: Lead role — skip completion gate (no implementation to validate) and auto-commit
			const isLeadRole = workspace.roleBudget === "lead";
			if (isLeadRole) {
				// Lead agents are read-only observers; mark complete directly without completion gate
				// Routes through TransitionRouter for FSM enforcement (Finding 2)
				if (result.verdict === "COMPLETE") {
					await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Complete, {
						verdict: result.verdict,
					});
				} else {
					await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Complete, {
						verdict: result.verdict,
						note: "Lead agent completed observation, no mutations performed",
					});
				}

				// Log that lead agent completed without mutations
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Lead agent completed — read-only observation, no mutations performed. Verdict: ${result.verdict}`,
				);

				// Update local cache
				await this.stateCacheMutex.runExclusive(async () => {
					const updatedState = await this.stateStore.loadState(planExecutionId);
					if (updatedState) {
						this.currentPlanState = updatedState;
					}
				});

				// Skip auto-commit for lead agents (no changes to commit)
				return result;
			}

			// Feed the completion gate with execution results before evaluating (P4.6.1).
			// The agent executor does not call into the completion gate directly, so we
			// translate the agent result into gate state here.
			if (result.verdict === "COMPLETE") {
				// Mark implementation as finished
				this.completionGate.markImplementationFinished(planExecutionId, workspace.id);
				// If a targetCommand was specified, mark it as passed (the agent was
				// instructed to run it in its prompt; if it reported COMPLETE, assume success)
				if (workspace.targetCommand) {
					this.completionGate.markTargetCommandStarted(planExecutionId, workspace.id);
					this.completionGate.recordCompletion(planExecutionId, workspace.id, 0, true);
				}
			}
			// Process lifecycle containment: kill any orphaned child processes
			// (vitest, npm, node, etc.) that the agent may have spawned via the bash
			// tool and left running — even if the agent reported COMPLETE. Run on
			// both success and failure, not only when result.verdict === "COMPLETE".
			killTrackedDetachedChildren();
			// Evaluate via registry to get the live state after mutations above
			const gateResult = this.completionGate.evaluateWorkspace(planExecutionId, workspace.id, workspace);
			if (gateResult.canComplete) {
				await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Complete, {
					verdict: result.verdict,
				});
			} else {
				// Completion gate blocked — transition to the recommended state instead
				const gateBlockMsg = gateResult.blockReasons.join("; ");
				console.error(`[completion-gate] Workspace ${workspace.id} cannot be marked complete: ${gateBlockMsg}`);
				// Write the block reason into the workspace state so failure reason is visible
				await this.stateStore.updateWorkspaceState(planExecutionId, workspace.id, {
					error: `Completion gate blocked: ${gateBlockMsg}`,
				});
				await this.transitionRouter.transitionWorkspace(
					planExecutionId,
					workspace.id,
					gateResult.recommendedState,
					{
						verdict: "FAILED",
						gateBlockReasons: gateResult.blockReasons,
					},
				);
				result.success = false;
				result.verdict = gateResult.recommendedState === WorkspaceStage.Blocked ? "BLOCKED" : "FAILED";
			}

			// Update local cache
			await this.stateCacheMutex.runExclusive(async () => {
				const updatedState = await this.stateStore.loadState(planExecutionId);
				if (updatedState) {
					this.currentPlanState = updatedState;
				}
			});

			// Auto-commit on success (skipped for lead agents — no changes to commit)
			if (result.success && workspace.autoCommit !== false) {
				try {
					await this.commitWorkspace(workspace);
				} catch (commitError) {
					// Commit failure logs warning, does not fail workspace
					const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
					console.warn(`[auto-commit] Warning: commit failed for workspace ${workspace.id}: ${commitMsg}`);
				}
			}

			// NOTE: The plan-runner (executePlanInBackground) handles plan completion
			// when all workspaces are terminal. Do NOT auto-complete here to avoid
			// a race with the plan-runner's while loop. The setTimout-based auto-complete
			// was removed because it raced with the plan-runner calling completePlan()
			// or entering handoff, causing a double transition or stale state.

			return result;
		} catch (error) {
			// Handle failure
			const errorMessage = error instanceof Error ? error.message : String(error);

			// P26.B: Clean up workspace-scoped executor on failure
			this.activeAgentExecutors.delete(workspace.id);

			// Release locks on failure
			this.scheduler.releaseFileLocks(workspace);
			await this.stateStore.releaseFileLocks(planExecutionId, workspace.id);

			// Update state with error
			await this.stateStore.updateWorkspaceState(planExecutionId, workspace.id, {
				error: errorMessage,
			});

			// Get updated state for retry decision
			const updatedWsState = await this.stateStore.getWorkspaceState(planExecutionId, workspace.id);
			const wsForRetry = updatedWsState ?? wsState;

			// Classify failure and determine if retry is possible
			const failureType = this.retryHandler.classifyFailure(errorMessage);
			const retryDecision = this.retryHandler.shouldRetry(workspace, wsForRetry, failureType);

			if (retryDecision.shouldRetry) {
				// Transition back to pending for retry via TransitionRouter (Finding 2)
				await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Pending, {
					error: errorMessage,
					retryStage: retryDecision.stage,
				});

				// Update local cache
				await this.stateCacheMutex.runExclusive(async () => {
					const updatedState = await this.stateStore.loadState(planExecutionId);
					if (updatedState) {
						this.currentPlanState = updatedState;
					}
				});

				return {
					workspaceId: workspace.id,
					success: false,
					verdict: "BLOCKED",
					error: errorMessage,
					report: `Retry scheduled: ${retryDecision.reason}`,
				};
			}

			// No more retries - mark as failed via TransitionRouter (Finding 2)
			await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Failed, {
				error: errorMessage,
			});

			// Update local cache
			await this.stateCacheMutex.runExclusive(async () => {
				const updatedState = await this.stateStore.loadState(planExecutionId);
				if (updatedState) {
					this.currentPlanState = updatedState;
				}
			});

			// NOTE: The plan-runner handles plan failure when all workspaces are terminal.
			// Do NOT auto-fail here to avoid a race with the plan-runner's while loop.

			return {
				workspaceId: workspace.id,
				success: false,
				verdict: "FAILED",
				error: errorMessage,
				report: `Failed after ${wsForRetry.attempts} attempts: ${retryDecision.reason}`,
			};
		}
	}

	/**
	 * Check for control requests and handle them
	 *
	 * @returns Control state if a control request is pending, null otherwise
	 */
	/**
	 * Abort active workspaces and reset them back to Pending so they will
	 * be re-executed when the plan is resumed.
	 */
	private async abortAndResetActiveWorkspaces(planExecutionId: string): Promise<void> {
		// Collect workspace IDs that are currently active BEFORE aborting.
		// Snapshot to prevent concurrent modification during iteration.
		const state = this.currentPlanState;
		const activeIds: string[] = [];
		if (state) {
			for (const [wsId, ws] of Array.from(state.workspaces)) {
				if (ws.stage === "active") {
					activeIds.push(wsId);
				}
			}
		}

		// Abort all in-flight agent executions
		await this.stopAllActiveWorkspaces();

		// Transition any aborted workspaces back to Pending so they
		// are re-scheduled on resume. After stopAllActiveWorkspaces(),
		// the abort handler in executeWorkspace transitions them to
		// Failed (or Blocked) via the completion gate. We reset them
		// to Pending so the plan doesn't need rerun before continuing.
		// Uses TransitionRouter for FSM-aware transitions (Finding 2).
		for (const wsId of activeIds) {
			await this.transitionRouter.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
				reason: "paused-abort",
			});
		}

		// Reload state cache after transitions
		const updatedState = await this.stateStore.loadState(planExecutionId);
		if (updatedState) {
			this.currentPlanState = updatedState;
		}
	}

	async checkControlRequest(): Promise<PlanControlState | null> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) return null;

		const control = await this.stateStore.readControlRequest(planExecutionId);
		if (!control) {
			return null;
		}

		const state = this.currentPlanState;
		if (!state) {
			return null;
		}

		// Handle control actions
		switch (control.action) {
			case "pause":
				if (state.status === "running") {
					// Snapshot workspaces to prevent concurrent modification during iteration
					const activeIds: string[] = [];
					for (const [wsId, ws] of Array.from(state.workspaces)) {
						if (ws.stage === "active") {
							activeIds.push(wsId);
						}
					}

					if (activeIds.length === 0) {
						// No active workspaces, pause immediately
						await this.stateStore.pausePlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					} else {
						// Abort active workspaces and reset them to Pending
						await this.abortAndResetActiveWorkspaces(planExecutionId);
						await this.stateStore.pausePlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					}
				}
				break;

			case "stop":
				if (state.status === "running" || state.status === "paused") {
					// Snapshot workspaces to prevent concurrent modification during iteration
					const activeIds: string[] = [];
					for (const [wsId, ws] of Array.from(state.workspaces)) {
						if (ws.stage === "active") {
							activeIds.push(wsId);
						}
					}

					if (activeIds.length === 0) {
						// No active workspaces, stop immediately
						await this.stateStore.stopPlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					} else {
						// Abort active workspaces and reset them to Pending
						await this.abortAndResetActiveWorkspaces(planExecutionId);
						await this.stateStore.stopPlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					}
				}
				break;

			case "cancel":
				// Cancel is handled immediately by the command itself
				break;

			case "resume":
				// Resume is handled by the resume command
				await this.stateStore.clearControlRequest(planExecutionId);
				break;
		}

		return control;
	}

	/**
	 * Get next eligible workspaces to execute.
	 *
	 * AC1: Uses approved dependency graph (not stale parser output) when
	 * approvedPreviewMetadata has been set. The scheduler uses the approved
	 * batch assignments for dependency resolution.
	 *
	 * AC4: The scheduling decision includes batch IDs for each ready workspace,
	 * logged via the scheduler's diagnostic output.
	 *
	 * @param workspaces - All workspaces
	 * @returns Array of eligible workspaces
	 */
	async getNextWorkspaces(workspaces: Workspace[]): Promise<Workspace[]> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return [];
		}

		const state = this.currentPlanState;
		if (!state) {
			return [];
		}

		// Check for control requests before scheduling
		const control = await this.checkControlRequest();
		if (control) {
			// If pause or stop is requested, don't schedule new workspaces
			if (control.action === "pause" || control.action === "stop") {
				return [];
			}
		}

		// Check if plan is paused or stopped
		if (state.status === "paused" || state.status === "stopped" || state.status === "cancelled") {
			return [];
		}

		// P7.G AC1: Initialize preflight status for workspaces that require preflight approval
		// but don't have a status set yet. This ensures the scheduler sees them as "pending"
		// and blocks execution until a human reviews them.
		for (const workspace of workspaces) {
			if (workspace.preflightRequired) {
				const wsState = state.workspaces.get(workspace.id);
				if (wsState && wsState.preflightStatus === undefined) {
					await this.stateStore.updateWorkspaceState(planExecutionId, workspace.id, {
						preflightStatus: "pending",
					});
					// Update in-memory cache
					wsState.preflightStatus = "pending";
				}
			}
		}

		const decision = this.scheduler.getNextWorkspaces(workspaces, state);

		// AC4: Log planned batch IDs for each scheduled workspace
		if (decision.ready.length > 0) {
			const log = new PiLogger({ planExecId: planExecutionId });
			for (const ws of decision.ready) {
				const batchId = decision.readyBatchIds.get(ws.id);
				if (batchId !== undefined) {
					log.info(`Scheduled workspace ${ws.id} in batch ${batchId}`);
				} else {
					log.info(`Scheduled workspace ${ws.id} (no batch assignment)`);
				}
			}
		}

		return decision.ready;
	}

	/**
	 * Get workspaces that are blocked waiting for preflight approval.
	 * Returns workspaces with preflightRequired that have not been approved yet.
	 *
	 * @param workspaces - All workspace definitions
	 * @returns Array of { workspace, status, rejectionReason } for blocked workspaces
	 */
	getPreflightBlockedWorkspaces(
		workspaces: Workspace[],
	): Array<{ workspace: Workspace; status: string; rejectionReason?: string }> {
		const state = this.currentPlanState;
		if (!state) return [];

		const blocked: Array<{ workspace: Workspace; status: string; rejectionReason?: string }> = [];
		for (const workspace of workspaces) {
			if (workspace.preflightRequired) {
				const wsState = state.workspaces.get(workspace.id);
				const status = wsState?.preflightStatus ?? "not_reviewed";
				if (status !== "approved") {
					blocked.push({
						workspace,
						status,
						rejectionReason: wsState?.preflightRejectionReason,
					});
				}
			}
		}
		return blocked;
	}

	/**
	 * Approve a workspace's preflight requirement, allowing it to be scheduled.
	 *
	 * P7.G AC3: Approval UX never mutates executor state directly —
	 * this writes approval via the state store, which the scheduler
	 * reads passively on its next scheduling round.
	 *
	 * @param workspaceId - Workspace ID to approve
	 */
	async approveWorkspacePreflight(workspaceId: string): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.updateWorkspaceState(planExecutionId, workspaceId, {
			preflightStatus: "approved",
			preflightRejectionReason: undefined,
		});

		// Update in-memory cache
		const state = this.currentPlanState;
		const wsState = state?.workspaces.get(workspaceId);
		if (wsState) {
			wsState.preflightStatus = "approved";
			wsState.preflightRejectionReason = undefined;
		}

		// Log to journal
		await this.stateStore.appendJournal(planExecutionId, {
			type: "workspace_preflight_approved",
			timestamp: Date.now(),
			workspaceId,
		});
	}

	/**
	 * Reject a workspace's preflight requirement, preventing it from being scheduled.
	 *
	 * P7.G AC2: Rejected suggestions are logged with reason where available.
	 * P7.G AC3: Approval UX never mutates executor state directly.
	 *
	 * @param workspaceId - Workspace ID to reject
	 * @param reason - Human-readable reason for rejection (optional)
	 */
	async rejectWorkspacePreflight(workspaceId: string, reason?: string): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.updateWorkspaceState(planExecutionId, workspaceId, {
			preflightStatus: "rejected",
			preflightRejectionReason: reason,
		});

		// Update in-memory cache
		const state = this.currentPlanState;
		const wsState = state?.workspaces.get(workspaceId);
		if (wsState) {
			wsState.preflightStatus = "rejected";
			wsState.preflightRejectionReason = reason;
		}

		// Log to journal (P7.G AC2: rejected suggestions are logged with reason)
		await this.stateStore.appendJournal(planExecutionId, {
			type: "workspace_preflight_rejected",
			timestamp: Date.now(),
			workspaceId,
			data: { reason: reason ?? null },
		});
	}

	/**
	 * Check if execution is complete
	 *
	 * @returns True if all workspaces are complete or failed
	 */
	isExecutionComplete(): boolean {
		const state = this.currentPlanState;
		if (!state) {
			return false;
		}

		for (const ws of Array.from(state.workspaces.values())) {
			if (ws.stage === WorkspaceStage.Pending || ws.stage === WorkspaceStage.Active) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Get execution statistics
	 *
	 * @returns Execution statistics
	 */
	getStatistics() {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return null;
		}

		const state = this.currentPlanState;
		if (!state) {
			return null;
		}

		return this.scheduler.getStatistics(state);
	}

	/**
	 * Create workspace snapshot directory structure
	 *
	 * @param workspaceId - Workspace ID
	 * @returns Workspace snapshot
	 */
	private async createWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
		const snapshotDir = path.join(this.workspaceRoot, ".pi", "workspaces", workspaceId);
		const retryDir = path.join(snapshotDir, "retries");

		await fs.mkdir(snapshotDir, { recursive: true });
		await fs.mkdir(retryDir, { recursive: true });

		return {
			workspaceId,
			snapshotDir,
			packetPath: path.join(snapshotDir, "packet.json"),
			reportPath: path.join(snapshotDir, "report.md"),
			retryDir,
		};
	}

	/**
	 * Save packet snapshot
	 *
	 * @param snapshot - Workspace snapshot
	 * @param packet - Hashed packet
	 * @param attempt - Attempt number
	 */
	private async savePacketSnapshot(snapshot: WorkspaceSnapshot, packet: HashedPacket, attempt: number): Promise<void> {
		// Save latest packet
		await fs.writeFile(snapshot.packetPath, JSON.stringify(packet, null, 2), "utf-8");

		// Save retry snapshot if this is a retry
		if (attempt > 0) {
			const retryPath = path.join(snapshot.retryDir, `packet-attempt-${attempt}.json`);
			await fs.writeFile(retryPath, JSON.stringify(packet, null, 2), "utf-8");
		}
	}

	/**
	 * Save workspace report
	 *
	 * @param snapshot - Workspace snapshot
	 * @param report - Report content
	 */
	private async saveReport(snapshot: WorkspaceSnapshot, report: string): Promise<void> {
		await fs.writeFile(snapshot.reportPath, report, "utf-8");
	}

	/**
	 * Load state from store
	 *
	 * @returns True if state was loaded
	 */
	async loadState(): Promise<boolean> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return false;
		}

		const state = await this.stateStore.loadState(planExecutionId);
		this.currentPlanState = state;
		return state !== null;
	}

	/**
	 * Get current state
	 */
	getState(): PlanState | null {
		return this.currentPlanState;
	}

	/**
	 * Get the underlying state store.
	 */
	getStateStore(): IStateStore {
		return this.stateStore;
	}

	/**
	 * Commit workspace changes to git.
	 *
	 * Stages only files matching the workspace capability manifest (canEdit)
	 * that are actually modified, then creates a commit with the format:
	 * `feat(p{phase}): complete workspace {id} — {title}`
	 *
	 * Skips if autoCommit is globally disabled or if the workspace has
	 * autoCommit set to false.
	 *
	 * Never pushes, never merges.
	 * Commit failures are logged as warnings and do not fail execution.
	 *
	 * @param workspace - Workspace to commit
	 */
	async commitWorkspace(workspace: Workspace): Promise<void> {
		// Check global auto-commit flag
		if (!this.autoCommitEnabled) {
			return;
		}

		// Check per-workspace autoCommit flag
		if (workspace.autoCommit === false) {
			return;
		}

		const state = this.currentPlanState;
		if (!state) {
			return;
		}

		const wsState = state.workspaces.get(workspace.id);
		if (!wsState) {
			return;
		}

		// Only commit if workspace is complete
		if (wsState.stage !== WorkspaceStage.Complete) {
			return;
		}

		try {
			const autoCommit = new AutoCommit(this.workspaceRoot);
			const phase = this.workspaceQueue?.phase ?? "2";
			const result = await autoCommit.commit(workspace, wsState, phase);

			if (!result.success) {
				// Log warnings for skip reasons (not errors)
				if (result.reason && !result.reason.includes("failed")) {
					console.warn(`[auto-commit] ${workspace.id}: ${result.reason}`);
				} else if (result.reason) {
					console.warn(`[auto-commit] Warning: ${workspace.id}: ${result.reason}`);
				}
			} else if (result.commitHash) {
				console.log(`[auto-commit] Committed workspace ${workspace.id} (${result.commitHash})`);
			}
		} catch (error) {
			// Log warning, don't fail
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.warn(`[auto-commit] Warning: commit failed for workspace ${workspace.id}: ${errorMsg}`);
		}
	}

	/**
	 * Complete plan execution with optional rollup commit.
	 *
	 * If postPlanHandoff is enabled, instead of completing immediately,
	 * the plan enters awaiting_handoff state. The caller should then
	 * call handleHandoffCommit(), handleHandoffKeepEditing(), or handleHandoffDiscard().
	 *
	 * If postPlanHandoff is disabled, marks the plan as complete and,
	 * if autoCommit is enabled, creates a rollup commit via commitPlan().
	 * Rollup commit failures are logged as warnings and do not fail execution.
	 */
	async completePlan(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		// P4.6.1: Check plan completion gate — verify all workspaces are terminal healthy
		if (this.currentPlanState) {
			const planResult = evaluatePlanCompletion(this.currentPlanState.workspaces);
			if (!planResult.canComplete) {
				const errorMsg = `Plan cannot be marked complete: ${planResult.blockReasons.join("; ")}`;
				console.error(`[completion-gate] ${errorMsg}`);
				await this.failPlan(errorMsg);
				return;
			}
		}

		if (this.postPlanHandoffEnabled) {
			// Enter awaiting_handoff state — plan_handoff journal event is emitted inside setAwaitingHandoff
			await this.stateStore.setAwaitingHandoff(planExecutionId, this.workspaceQueue?.title ?? "Plan execution");
			const state = await this.stateStore.loadState(planExecutionId);
			if (state) this.currentPlanState = state;
			return;
		}

		// Skip handoff — complete immediately
		await this.stateStore.completePlan(planExecutionId);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;

		// Auto-commit rollup if enabled
		if (this.autoCommitEnabled) {
			try {
				await this.commitPlan();
			} catch (commitError) {
				// Rollup commit failure logs warning, doesn't fail plan completion
				const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
				console.warn(`[auto-commit] Warning: rollup commit failed: ${commitMsg}`);
			}
		}
	}

	/**
	 * Handle handoff commit: trigger rollup commit and mark plan complete.
	 * Called when user chooses "Commit & finish" in the handoff dialog.
	 */
	async handleHandoffCommit(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		// Rollup commit first
		if (this.autoCommitEnabled) {
			try {
				await this.commitPlan();
			} catch (commitError) {
				const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
				console.warn(`[auto-commit] Warning: rollup commit failed: ${commitMsg}`);
			}
		}

		// Mark plan complete
		await this.stateStore.handoffCommit(planExecutionId);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Handle handoff keep editing: return plan to running status.
	 * Called when user chooses "Keep editing" in the handoff dialog.
	 */
	async handleHandoffKeepEditing(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.handoffKeepEditing(planExecutionId);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Handle handoff discard: revert uncommitted workspace files and fail the plan.
	 * Called when user chooses "Discard" in the handoff dialog.
	 */
	async handleHandoffDiscard(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.handoffDiscard(planExecutionId, this.workspaceRoot);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Check if the plan is currently awaiting handoff and if the handoff timeout
	 * has elapsed. If so, auto-commit with a warning log.
	 *
	 * Call this periodically (e.g., during polling) when awaiting_handoff.
	 */
	async checkHandoffTimeout(): Promise<boolean> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) return false;

		const isAwaiting = await this.stateStore.isAwaitingHandoff(planExecutionId);
		if (!isAwaiting) return false;

		const handoffStartedAt = await this.stateStore.getHandoffStartedAt(planExecutionId);
		if (handoffStartedAt === 0) return false;

		const elapsed = Date.now() - handoffStartedAt;
		if (elapsed >= this.handoffTimeoutMs) {
			console.warn(
				`[handoff] Auto-committing plan after ${this.handoffTimeoutMs / 60000} minute timeout (elapsed: ${Math.round(elapsed / 60000)} min)`,
			);

			// Auto-commit: rollup + complete
			if (this.autoCommitEnabled) {
				try {
					await this.commitPlan();
				} catch (commitError) {
					const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
					console.warn(`[auto-commit] Warning: rollup commit failed: ${commitMsg}`);
				}
			}

			await this.stateStore.handoffCommit(planExecutionId);
			const state = await this.stateStore.loadState(planExecutionId);
			if (state) this.currentPlanState = state;
			return true;
		}

		return false;
	}

	/**
	 * Commit a rollup of all remaining changes from the entire plan.
	 *
	 * Stages all modified files into a single plan-level commit with format:
	 * `feat(p{phase}): complete plan — {title}`
	 *
	 * Skips if autoCommit is globally disabled.
	 * Never pushes, never merges.
	 *
	 * @returns Commit result
	 */
	async commitPlan(): Promise<void> {
		if (!this.autoCommitEnabled) {
			return;
		}

		try {
			const autoCommit = new AutoCommit(this.workspaceRoot);
			const phase = this.workspaceQueue?.phase ?? "2";
			const planTitle = this.workspaceQueue?.title ?? "Plan execution complete";
			const result = await autoCommit.commitPlan(phase, planTitle);

			if (!result.success) {
				if (result.reason && !result.reason.includes("failed")) {
					console.warn(`[auto-commit] Rollup: ${result.reason}`);
				} else if (result.reason) {
					console.warn(`[auto-commit] Warning: rollup commit: ${result.reason}`);
				}
			} else if (result.commitHash) {
				console.log(`[auto-commit] Rollup commit (${result.commitHash})`);
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.warn(`[auto-commit] Warning: rollup commit failed: ${errorMsg}`);
		}
	}

	/**
	 * Fail plan execution
	 *
	 * @param error - Error message
	 */
	async failPlan(error: string): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");
		await this.stateStore.failPlan(planExecutionId, error);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Get retry handler
	 *
	 * @returns Retry handler instance
	 */
	getRetryHandler(): RetryHandler {
		return this.retryHandler;
	}

	/**
	 * Get the stored workspace queue (used for recovery).
	 */
	getWorkspaceQueue(): WorkspaceQueue | null {
		return this.workspaceQueue;
	}

	/**
	 * Get the maximum parallel workspaces limit (AC3 verification).
	 *
	 * The scheduler enforces this limit — it will never schedule more than
	 * this many concurrent workspaces.
	 *
	 * @returns Maximum concurrent workers
	 */
	getMaxParallelWorkspaces(): number {
		return this.scheduler.getMaxWorkers();
	}

	/**
	 * Get the underlying workspace scheduler.
	 * Exposed for testing and diagnostic purposes.
	 */
	getScheduler(): WorkspaceScheduler {
		return this.scheduler;
	}

	/**
	 * Get the completion gate registry for direct validation state manipulation.
	 * Used by callers that need to feed log signals or command results into
	 * the completion gate before calling completePlan().
	 */
	getCompletionGate(): CompletionGateRegistry {
		return this.completionGate;
	}

	/**
	 * Save diff artifacts from all active worktrees before stopping.
	 *
	 * Must be called BEFORE stopAllActiveWorkspaces() to capture the state
	 * of the in-flight worktrees before the agent is aborted and worktree
	 * directories become stale.
	 *
	 * P26.B: Iterates all per-workspace executors instead of a singleton.
	 * Each concurrent workspace's worktree diff is preserved.
	 *
	 * @returns Number of worktree artifacts saved.
	 */
	async saveAllWorktreeArtifactsBeforeStop(): Promise<number> {
		let saved = 0;
		for (const executor of this.activeAgentExecutors.values()) {
			if (!executor.isWorktreeModeEnabled) continue;
			const artifact = await executor.saveWorktreeArtifactsBeforeStop();
			if (artifact) saved++;
		}
		return saved;
	}

	/**
	 * Get worktree states for recovery reconciliation from all active executors.
	 * During crash recovery, this helps identify orphaned worktrees that
	 * need cleanup or reconciliation.
	 * @returns Array of worktree states from all active executors
	 */
	getWorktreeStates(): import("../worktree/worktree-types.js").WorktreeState[] {
		return this.activeAgentExecutors.size > 0
			? [] // P26.C: Worktree states are now per-execution; collect via getAllWorktreeStates
			: [];
	}

	/**
	 * Load worktree state from disk during crash recovery.
	 * This reconciles in-memory state with persisted worktree-state.json.
	 * @returns Number of worktrees loaded
	 */
	async loadWorktreeManagerState(): Promise<number> {
		// Load worktree manager state from .pi/worktree-state.json.
		// P26.B: No singleton executor guard — always try to load from disk.
		const { WorktreeManager } = await import("../worktree/worktree-manager.js");
		const manager = new WorktreeManager(this.workspaceRoot);
		await manager.loadState();
		const worktrees = manager.list();
		return worktrees.length;
	}

	/**
	 * Remove stale worktrees for a continued execution while preserving only
	 * workspaces that are already complete. This makes active/failed/blocked
	 * workspaces restart from a clean worktree on manual continue.
	 */
	async cleanupWorktreesExcept(planExecutionId: string, preservedWorkspaceIds: Set<string>): Promise<number> {
		const { WorktreeManager } = await import("../worktree/worktree-manager.js");
		const manager = new WorktreeManager(this.workspaceRoot);
		await manager.loadState();

		let removed = 0;
		for (const worktree of manager.list(planExecutionId)) {
			if (preservedWorkspaceIds.has(worktree.workspaceId)) {
				continue;
			}
			const result = await manager.cleanupQuarantinedWorktree(planExecutionId, worktree.workspaceId);
			if (result.success) {
				removed++;
			}
		}

		await manager.reconcileFromDisk();
		await manager.persistState();
		return removed;
	}

	/**
	 * P4.6.3: Abort all in-flight workspace executions.
	 * Each active WorkspaceAgentExecutor receives an abort signal,
	 * causing the in-flight execute() promise to resolve with FAILED.
	 * Then waits for all promises to settle.
	 *
	 * IMPORTANT: Call saveAllWorktreeArtifactsBeforeStop() BEFORE this
	 * method to preserve in-progress worktree changes.
	 */
	async stopAllActiveWorkspaces(): Promise<void> {
		// P26.B: Abort all per-workspace executors (sends signal to in-flight LLM calls)
		for (const executor of this.activeAgentExecutors.values()) {
			executor.abort();
		}
		// Clear the map after aborting all executors
		this.activeAgentExecutors.clear();

		// Wait for all tracked in-flight executions to settle
		if (this.inFlightExecutions.size > 0) {
			const promises = Array.from(this.inFlightExecutions.values());
			this.inFlightExecutions.clear();
			await Promise.allSettled(promises);
		}

		// Process lifecycle containment: kill all tracked child processes
		// (vitest, npm, node, etc.) that may have been spawned by workspace
		// agent sessions via the bash tool.
		killTrackedDetachedChildren();

		// Clean up git worktrees created during this execution
		try {
			const planExecId = this.planExecutionId;
			if (planExecId) {
				// Import GitRunner lazily to avoid circular deps
				const { createGitRunner } = await import("./git-runner.js");
				const runner = createGitRunner({
					planExecId,
					workspaceId: "",
					leaseId: "",
					cwd: this.workspaceRoot,
				});

				// List worktrees and remove any belonging to this execution
				const listResult = await runner.read(["worktree", "list"], { timeout: 10000 });
				const lines = listResult.stdout.split("\n").filter(Boolean);
				for (const line of lines) {
					const parts = line.trim().split(/\s+/);
					const wtPath = parts[0];
					// Skip the main worktree (repository root)
					if (!wtPath || wtPath === this.workspaceRoot) continue;

					// Check if this worktree belongs to our plan execution
					// Worktree paths are under .pi/worktrees/{planExecId}/
					if (wtPath.includes(planExecId) || wtPath.includes(".pi/worktrees")) {
						try {
							await runner.writeRepo(["worktree", "remove", "--force", wtPath], { timeout: 15000 });
						} catch {
							// If git worktree remove fails, try force with recursive
							try {
								await runner.writeRepo(["worktree", "remove", "--force", wtPath], { timeout: 15000 });
							} catch {
								// Still failed — log but don't block
								console.error(`[autonomous-executor] Failed to remove worktree ${wtPath} during stop`);
							}
						}
					}
				}

				// Prune stale worktree references
				try {
					await runner.writeRepo(["worktree", "prune"], { timeout: 10000 });
				} catch {
					// Non-fatal
				}
			}
		} catch {
			// Worktree cleanup is best-effort during stop/cancel
		}
	}
}

/**
 * Create an autonomous executor instance with JSON backend.
 *
 * This is a convenience factory that creates a JSON-backed executor,
 * maintaining backward compatibility with existing code.
 *
 * @param workspaceRoot - Workspace root directory
 * @param maxWorkers - Maximum concurrent workers
 * @param retryPolicy - Optional retry policy
 * @returns Autonomous executor
 */
export function createAutonomousExecutor(
	workspaceRoot: string,
	maxWorkers = DEFAULT_WORKERS,
	retryPolicy?: RetryPolicy,
	worktree?: WorktreeConfig,
): AutonomousExecutor {
	// Use createStateStore for centralized backend selection (Finding 4/5)
	const backend = detectStateStoreBackend();
	const stateStore = createStateStore({
		backend,
		workspaceRoot,
		projectId: "default",
	});
	return new AutonomousExecutor(stateStore, {
		workspaceRoot,
		maxWorkers,
		retryPolicy,
		projectId: "default",
		skipProjectManagement: true,
		worktree,
	});
}
