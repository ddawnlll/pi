/**
 * Autonomous Execution Loop - P2 Workstream 7.F
 *
 * Orchestrates autonomous workspace execution with state management,
 * packet generation, and journal logging.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateWorkspaceReport, PlanStateStore } from "./plan-state.js";
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
	private workspaceRoot: string;

	constructor(workspaceRoot: string, maxWorkers = 3) {
		this.workspaceRoot = workspaceRoot;
		this.stateStore = new PlanStateStore(workspaceRoot);
		this.scheduler = new WorkspaceScheduler(maxWorkers);
		this.packetBuilder = new RolePacketBuilder();
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
	async executeWorkspace(workspace: Workspace): Promise<WorkspaceExecutionResult> {
		const state = this.stateStore.getState();
		if (!state) {
			throw new Error("State not initialized");
		}

		const wsState = state.workspaces.get(workspace.id);
		if (!wsState) {
			throw new Error(`Workspace ${workspace.id} not found in state`);
		}

		try {
			// Transition to active
			await this.stateStore.transitionWorkspace(workspace.id, WorkspaceStage.Active);

			// Create workspace snapshot directory
			const snapshot = await this.createWorkspaceSnapshot(workspace.id);

			// Acquire file locks
			const lockedFiles = this.scheduler.acquireFileLocks(workspace);
			await this.stateStore.acquireFileLocks(workspace.id, lockedFiles);

			// Generate role packet
			const packet = this.packetBuilder.buildWorkerPacket(workspace, wsState, "");

			// Save packet to snapshot
			await this.savePacketSnapshot(snapshot, packet, wsState.attempts);

			// Simulate execution (actual agent execution would happen here)
			// For now, we just create a mock result
			const result: WorkspaceExecutionResult = {
				workspaceId: workspace.id,
				success: true,
				verdict: "COMPLETE",
				report: `Workspace ${workspace.id} executed successfully`,
			};

			// Generate and save report
			const report = generateWorkspaceReport(workspace, {
				...wsState,
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

			// Transition to failed
			await this.stateStore.transitionWorkspace(workspace.id, WorkspaceStage.Failed, {
				error: errorMessage,
			});

			return {
				workspaceId: workspace.id,
				success: false,
				verdict: "FAILED",
				error: errorMessage,
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
}

/**
 * Create an autonomous executor instance
 *
 * @param workspaceRoot - Workspace root directory
 * @param maxWorkers - Maximum concurrent workers
 * @returns Autonomous executor
 */
export function createAutonomousExecutor(workspaceRoot: string, maxWorkers = 3): AutonomousExecutor {
	return new AutonomousExecutor(workspaceRoot, maxWorkers);
}
