/**
 * Plan Control - P2 Execution Control Commands
 *
 * Provides control mechanisms for pausing, stopping, and cancelling plan execution.
 * Control state is stored in .pi/plan-control.json and monitored by the executor.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

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
 * Plan control manager
 *
 * Manages control requests for plan execution (pause, stop, cancel).
 */
export class PlanControlManager {
	private controlFilePath: string;

	constructor(workspaceRoot: string, piDir = ".pi") {
		this.controlFilePath = path.join(workspaceRoot, piDir, "plan-control.json");
	}

	/**
	 * Write a control request
	 *
	 * @param action - Control action
	 * @param reason - Optional reason
	 */
	async writeControlRequest(action: ControlAction, reason?: string): Promise<void> {
		const controlState: PlanControlState = {
			action,
			requestedAt: Date.now(),
			reason,
		};

		// Ensure .pi directory exists
		const piDir = path.dirname(this.controlFilePath);
		await fs.mkdir(piDir, { recursive: true });

		// Write control file atomically
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
	 * Get control file path
	 */
	getControlFilePath(): string {
		return this.controlFilePath;
	}
}

/**
 * Create a plan control manager instance
 *
 * @param workspaceRoot - Workspace root directory
 * @returns Plan control manager
 */
export function createPlanControlManager(workspaceRoot: string): PlanControlManager {
	return new PlanControlManager(workspaceRoot);
}
