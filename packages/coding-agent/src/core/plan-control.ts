/**
 * Plan Control - P2 Execution Control Commands
 *
 * Provides control mechanisms for pausing, stopping, and cancelling plan execution.
 *
 * Supports dual backend:
 * - File-based: Control state stored in .pi/plan-control.json (legacy)
 * - State-store-based: Control state managed via IStateStore (PostgreSQL)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IStateStore } from "./state-store.js";

/**
 * Control action types
 */
export type ControlAction = "pause" | "stop" | "cancel" | "resume";

/**
 * Control request state
 */
export interface PlanControlState {
	/** Control action requested */
	action: ControlAction;
	/** Timestamp when control was requested */
	requestedAt: number;
	/** Optional reason for the control action */
	reason?: string;
}

/**
 * Plan control manager configuration.
 */
export interface PlanControlManagerConfig {
	/** Workspace root directory (required for file-based control) */
	workspaceRoot?: string;
	/** .pi directory name (default: ".pi") */
	piDir?: string;
	/** Optional state store instance (enables DB-backed control) */
	stateStore?: IStateStore;
	/** Plan execution ID (required when using stateStore) */
	planExecutionId?: string;
}

/**
 * Plan control manager
 *
 * Manages control requests for plan execution (pause, stop, cancel).
 * Supports both file-based (.pi/plan-control.json) and state-store-backed
 * (IStateStore) implementations.
 */
export class PlanControlManager {
	private controlFilePath: string | null = null;
	private stateStore: IStateStore | null = null;
	private planExecutionId: string | null = null;

	constructor(config: PlanControlManagerConfig) {
		if (config.stateStore && config.planExecutionId) {
			// State-store-backed mode
			this.stateStore = config.stateStore;
			this.planExecutionId = config.planExecutionId;
			this.controlFilePath = null;
		} else if (config.workspaceRoot) {
			// File-based mode
			const piDir = config.piDir ?? ".pi";
			this.controlFilePath = path.join(config.workspaceRoot, piDir, "plan-control.json");
			this.stateStore = null;
			this.planExecutionId = null;
		} else {
			throw new Error(
				"PlanControlManager requires either workspaceRoot (file mode) or stateStore+planExecutionId (DB mode)",
			);
		}
	}

	/**
	 * Write a control request
	 *
	 * @param action - Control action
	 * @param reason - Optional reason
	 */
	async writeControlRequest(action: ControlAction, reason?: string): Promise<void> {
		if (this.stateStore && this.planExecutionId) {
			// Delegate to state store
			await this.stateStore.writeControlRequest(this.planExecutionId, action, reason);
			return;
		}

		if (!this.controlFilePath) {
			throw new Error("No control backend configured");
		}

		// File-based fallback
		const controlState: PlanControlState = {
			action,
			requestedAt: Date.now(),
			reason,
		};

		const piDir = path.dirname(this.controlFilePath);
		await fs.mkdir(piDir, { recursive: true });

		const tempPath = `${this.controlFilePath}.tmp`;
		await fs.writeFile(tempPath, JSON.stringify(controlState, null, 2), "utf-8");
		await fs.rename(tempPath, this.controlFilePath);
	}

	/**
	 * Read current control request
	 *
	 * @returns Control state or null if no control request exists
	 */
	async readControlRequest(): Promise<PlanControlState | null> {
		if (this.stateStore && this.planExecutionId) {
			return this.stateStore.readControlRequest(this.planExecutionId);
		}

		if (!this.controlFilePath) {
			throw new Error("No control backend configured");
		}

		// File-based fallback
		try {
			const content = await fs.readFile(this.controlFilePath, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Clear control request
	 */
	async clearControlRequest(): Promise<void> {
		if (this.stateStore && this.planExecutionId) {
			await this.stateStore.clearControlRequest(this.planExecutionId);
			return;
		}

		if (!this.controlFilePath) {
			throw new Error("No control backend configured");
		}

		// File-based fallback
		try {
			await fs.unlink(this.controlFilePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// Already cleared
				return;
			}
			throw error;
		}
	}

	/**
	 * Check if a control request is pending
	 *
	 * @returns True if a control request exists
	 */
	async hasControlRequest(): Promise<boolean> {
		const control = await this.readControlRequest();
		return control !== null;
	}

	/**
	 * Get control file path (file-based mode only)
	 *
	 * @returns Control file path or null if using state store backend
	 */
	getControlFilePath(): string | null {
		return this.controlFilePath;
	}
}

/**
 * Create a plan control manager instance (file-based, backward compatible).
 *
 * @param workspaceRoot - Workspace root directory
 * @returns Plan control manager
 */
export function createPlanControlManager(workspaceRoot: string): PlanControlManager {
	return new PlanControlManager({ workspaceRoot });
}
