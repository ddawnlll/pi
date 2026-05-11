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
import type { PlanState } from "./plan-state.js";
import { generateWorkspaceReport } from "./plan-state.js";
import { RetryHandler, type RetryPolicy, RetryStage } from "./retry-handler.js";
import { type HashedPacket, RolePacketBuilder } from "./role-packets.js";
import type { IStateStore, PlanControlState } from "./state-store.js";
import { WorkspaceScheduler } from "./workspace-scheduler.js";
import type { Workspace, WorkspaceQueue as WQ } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

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
	private scheduler: WorkspaceScheduler;
	private packetBuilder: RolePacketBuilder;
	private retryHandler: RetryHandler;
	private workspaceRoot: string;
	private projectId: string;
	private planExecutionId: string | null = null;
	private currentPlanState: PlanState | null = null;

	constructor(stateStore: IStateStore, config: AutonomousExecutorConfig) {
		this.stateStore = stateStore;
		this.workspaceRoot = config.workspaceRoot;
		this.scheduler = new WorkspaceScheduler(config.maxWorkers ?? 3);
		this.packetBuilder = new RolePacketBuilder();
		this.retryHandler = new RetryHandler(config.retryPolicy);
		this.projectId = config.projectId ?? "default";

		// If skipProjectManagement, use a fixed projectId
		if (config.skipProjectManagement) {
			this.projectId = "default";
		}
	}

	/**
	 * Initialize execution for a plan
	 *
	 * @param queue - Workspace queue
	 */
	async initialize(queue: WQ): Promise<string> {
		const planExecutionId = await this.stateStore.initializeState(this.projectId, queue);
		this.planExecutionId = planExecutionId;

		// Load state into cache
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) {
			this.currentPlanState = state;
		}

		return planExecutionId;
	}

	/**
	 * Get the current plan execution ID.
	 */
	getPlanExecutionId(): string | null {
		return this.planExecutionId;
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
	async executeWorkspace(workspace: Workspace, simulateFailure = false): Promise<WorkspaceExecutionResult> {
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

		try {
			// Increment attempt counter
			await this.stateStore.incrementRetryAttempt(planExecutionId, workspace.id);
			const updatedWsState = await this.stateStore.getWorkspaceState(planExecutionId, workspace.id);

			// Transition to active
			await this.stateStore.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Active);

			// Create workspace snapshot directory
			const snapshot = await this.createWorkspaceSnapshot(workspace.id);

			// Acquire file locks
			const lockedFiles = this.scheduler.acquireFileLocks(workspace);
			await this.stateStore.acquireFileLocks(planExecutionId, workspace.id, lockedFiles);

			const wsStateForPacket = updatedWsState ?? wsState;

			// Determine retry stage and generate appropriate packet
			const retryStage = this.retryHandler.getRetryStage(wsStateForPacket.attempts);
			const retryContext = wsStateForPacket.error
				? this.retryHandler.getRetryContext(wsStateForPacket, wsStateForPacket.error)
				: "";

			let packet: HashedPacket;
			if (retryStage === RetryStage.Flash && wsStateForPacket.attempts >= 4) {
				packet = this.packetBuilder.buildFlashPacket(workspace, wsStateForPacket, retryContext);
			} else if (retryStage === RetryStage.Reviewer && wsStateForPacket.attempts >= 7) {
				packet = this.packetBuilder.buildReviewerPacket(workspace, wsStateForPacket, retryContext);
			} else {
				packet = this.packetBuilder.buildWorkerPacket(workspace, wsStateForPacket, retryContext);
			}

			// Save packet to snapshot
			await this.savePacketSnapshot(snapshot, packet, wsStateForPacket.attempts);

			// Simulate execution (actual agent execution would happen here)
			// For testing, allow simulated failures
			if (simulateFailure) {
				throw new Error("Simulated test failure");
			}

			const result: WorkspaceExecutionResult = {
				workspaceId: workspace.id,
				success: true,
				verdict: "COMPLETE",
				report: `Workspace ${workspace.id} executed successfully (attempt ${wsStateForPacket.attempts})`,
			};

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

			// Transition to complete
			await this.stateStore.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Complete, {
				verdict: result.verdict,
			});

			// Update local cache
			const updatedState = await this.stateStore.loadState(planExecutionId);
			if (updatedState) {
				this.currentPlanState = updatedState;
			}

			return result;
		} catch (error) {
			// Handle failure
			const errorMessage = error instanceof Error ? error.message : String(error);

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
				// Transition back to pending for retry
				await this.stateStore.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Pending, {
					error: errorMessage,
					retryStage: retryDecision.stage,
				});

				// Update local cache
				const updatedState = await this.stateStore.loadState(planExecutionId);
				if (updatedState) {
					this.currentPlanState = updatedState;
				}

				return {
					workspaceId: workspace.id,
					success: false,
					verdict: "BLOCKED",
					error: errorMessage,
					report: `Retry scheduled: ${retryDecision.reason}`,
				};
			}

			// No more retries - mark as failed
			await this.stateStore.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Failed, {
				error: errorMessage,
			});

			// Update local cache
			const updatedState = await this.stateStore.loadState(planExecutionId);
			if (updatedState) {
				this.currentPlanState = updatedState;
			}

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
					// Check if there are active workspaces
					const activeCount = Array.from(state.workspaces.values()).filter((ws) => ws.stage === "active").length;

					if (activeCount === 0) {
						// No active workspaces, pause immediately
						await this.stateStore.pausePlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					}
					// Otherwise, keep control request and let active workspaces finish
				}
				break;

			case "stop":
				if (state.status === "running" || state.status === "paused") {
					// Check if there are active workspaces
					const activeCount = Array.from(state.workspaces.values()).filter((ws) => ws.stage === "active").length;

					if (activeCount === 0) {
						// No active workspaces, stop immediately
						await this.stateStore.stopPlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					}
					// Otherwise, keep control request and let active workspaces finish
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
	 * Get next eligible workspaces to execute
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

		const decision = this.scheduler.getNextWorkspaces(workspaces, state);
		return decision.ready;
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
	 * Complete plan execution
	 */
	async completePlan(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");
		await this.stateStore.completePlan(planExecutionId);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
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
	maxWorkers = 3,
	retryPolicy?: RetryPolicy,
): AutonomousExecutor {
	const { JsonStateStore } = require("./json-state-store.js");
	const stateStore = new JsonStateStore(workspaceRoot);
	return new AutonomousExecutor(stateStore, {
		workspaceRoot,
		maxWorkers,
		retryPolicy,
		projectId: "default",
		skipProjectManagement: true,
	});
}
