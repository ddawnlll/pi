/**
 * Autonomous Execution Loop - P2 Workstreams 7.F + 7.H
 *
 * Orchestrates autonomous workspace execution with state management,
 * packet generation, journal logging, and retry handling.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateWorkspaceReport, PlanStateStore } from "./plan-state.js";
import { RetryHandler, type RetryPolicy, RetryStage } from "./retry-handler.js";
import { type HashedPacket, RolePacketBuilder } from "./role-packets.js";
import { WorkspaceScheduler } from "./workspace-scheduler.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";
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
 * Autonomous executor
 *
 * Manages autonomous workspace execution:
 * - Reads plan state
 * - Schedules eligible workspaces
 * - Creates role packets
 * - Executes workspace stages
 * - Updates journal and state
 * - Creates workspace snapshots
 */
export class AutonomousExecutor {
	private stateStore: PlanStateStore;
	private scheduler: WorkspaceScheduler;
	private packetBuilder: RolePacketBuilder;
	private retryHandler: RetryHandler;
	private workspaceRoot: string;

	constructor(workspaceRoot: string, maxWorkers = 3, retryPolicy?: RetryPolicy) {
		this.workspaceRoot = workspaceRoot;
		this.stateStore = new PlanStateStore(workspaceRoot);
		this.scheduler = new WorkspaceScheduler(maxWorkers);
		this.packetBuilder = new RolePacketBuilder();
		this.retryHandler = new RetryHandler(retryPolicy);
	}

	/**
	 * Initialize execution for a plan
	 *
	 * @param queue - Workspace queue
	 */
	async initialize(queue: WorkspaceQueue): Promise<void> {
		await this.stateStore.initializeState(queue);
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
		const state = this.stateStore.getState();
		if (!state) {
			throw new Error("State not initialized");
		}

		const wsState = state.workspaces.get(workspace.id);
		if (!wsState) {
			throw new Error(`Workspace ${workspace.id} not found in state`);
		}

		try {
			// Increment attempt counter
			await this.stateStore.incrementRetryAttempt(workspace.id);
			const updatedState = this.stateStore.getWorkspaceState(workspace.id)!;

			// Transition to active
			await this.stateStore.transitionWorkspace(workspace.id, WorkspaceStage.Active);

			// Create workspace snapshot directory
			const snapshot = await this.createWorkspaceSnapshot(workspace.id);

			// Acquire file locks
			const lockedFiles = this.scheduler.acquireFileLocks(workspace);
			await this.stateStore.acquireFileLocks(workspace.id, lockedFiles);

			// Determine retry stage and generate appropriate packet
			const retryStage = this.retryHandler.getRetryStage(updatedState.attempts);
			const retryContext = updatedState.error
				? this.retryHandler.getRetryContext(updatedState, updatedState.error)
				: "";

			let packet: HashedPacket;
			if (retryStage === RetryStage.Flash && updatedState.attempts >= 4) {
				packet = this.packetBuilder.buildFlashPacket(workspace, updatedState, retryContext);
			} else if (retryStage === RetryStage.Reviewer && updatedState.attempts >= 7) {
				packet = this.packetBuilder.buildReviewerPacket(workspace, updatedState, retryContext);
			} else {
				packet = this.packetBuilder.buildWorkerPacket(workspace, updatedState, retryContext);
			}

			// Save packet to snapshot
			await this.savePacketSnapshot(snapshot, packet, updatedState.attempts);

			// Simulate execution (actual agent execution would happen here)
			// For testing, allow simulated failures
			if (simulateFailure) {
				throw new Error("Simulated test failure");
			}

			const result: WorkspaceExecutionResult = {
				workspaceId: workspace.id,
				success: true,
				verdict: "COMPLETE",
				report: `Workspace ${workspace.id} executed successfully (attempt ${updatedState.attempts})`,
			};

			// Generate and save report
			const report = generateWorkspaceReport(workspace, {
				...updatedState,
				stage: WorkspaceStage.Complete,
				completedAt: Date.now(),
			});
			await this.saveReport(snapshot, report);

			// Release file locks
			this.scheduler.releaseFileLocks(workspace);
			await this.stateStore.releaseFileLocks(workspace.id);

			// Transition to complete
			await this.stateStore.transitionWorkspace(workspace.id, WorkspaceStage.Complete, {
				verdict: result.verdict,
			});

			return result;
		} catch (error) {
			// Handle failure
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Release locks on failure
			this.scheduler.releaseFileLocks(workspace);
			await this.stateStore.releaseFileLocks(workspace.id);

			// Update state with error
			await this.stateStore.updateWorkspaceState(workspace.id, {
				error: errorMessage,
			});

			// Get updated state for retry decision
			const updatedState = this.stateStore.getWorkspaceState(workspace.id)!;

			// Classify failure and determine if retry is possible
			const failureType = this.retryHandler.classifyFailure(errorMessage);
			const retryDecision = this.retryHandler.shouldRetry(workspace, updatedState, failureType);

			if (retryDecision.shouldRetry) {
				// Transition back to pending for retry
				await this.stateStore.transitionWorkspace(workspace.id, WorkspaceStage.Pending, {
					error: errorMessage,
					retryStage: retryDecision.stage,
				});

				return {
					workspaceId: workspace.id,
					success: false,
					verdict: "BLOCKED",
					error: errorMessage,
					report: `Retry scheduled: ${retryDecision.reason}`,
				};
			}

			// No more retries - mark as failed
			await this.stateStore.transitionWorkspace(workspace.id, WorkspaceStage.Failed, {
				error: errorMessage,
			});

			return {
				workspaceId: workspace.id,
				success: false,
				verdict: "FAILED",
				error: errorMessage,
				report: `Failed after ${updatedState.attempts} attempts: ${retryDecision.reason}`,
			};
		}
	}

	/**
	 * Get next eligible workspaces to execute
	 *
	 * @param workspaces - All workspaces
	 * @returns Array of eligible workspaces
	 */
	getNextWorkspaces(workspaces: Workspace[]): Workspace[] {
		const state = this.stateStore.getState();
		if (!state) {
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
		const state = this.stateStore.getState();
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
		const state = this.stateStore.getState();
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
	 * Load state from disk
	 *
	 * @returns True if state was loaded
	 */
	async loadState(): Promise<boolean> {
		const state = await this.stateStore.loadState();
		return state !== null;
	}

	/**
	 * Get current state
	 */
	getState() {
		return this.stateStore.getState();
	}

	/**
	 * Complete plan execution
	 */
	async completePlan(): Promise<void> {
		await this.stateStore.completePlan();
	}

	/**
	 * Fail plan execution
	 *
	 * @param error - Error message
	 */
	async failPlan(error: string): Promise<void> {
		await this.stateStore.failPlan(error);
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
 * Create an autonomous executor instance
 *
 * @param workspaceRoot - Workspace root directory
 * @param maxWorkers - Maximum concurrent workers
 * @returns Autonomous executor
 */
export function createAutonomousExecutor(
	workspaceRoot: string,
	maxWorkers = 3,
	retryPolicy?: RetryPolicy,
): AutonomousExecutor {
	return new AutonomousExecutor(workspaceRoot, maxWorkers, retryPolicy);
}
