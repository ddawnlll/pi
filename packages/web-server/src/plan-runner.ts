/**
 * Plan Runner - Background plan execution for the web dashboard
 *
 * Manages AutonomousExecutor instances in the background so
 * plan execution can be started, monitored, and controlled
 * through the web API.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const _require = createRequire(import.meta.url);

// Use ESM import path resolution via the package reference (compiled)
import {
	AutonomousExecutor,
	createSafetyDoctor,
	createStateStore,
	detectStateStoreBackend,
	type IStateStore,
	parsePlan,
	type WorkspaceQueue,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveExecution {
	projectId: string;
	planExecId: string;
	title: string;
	phase: string;
	status: "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled";
	startedAt: number;
	completedAt: number | null;
	error?: string;
}

export interface RunPlanOptions {
	planContent: string;
	projectId: string;
	projectName: string;
	workspaceRoot: string;
	planFileName?: string;
}

export interface RunPlanResult {
	success: boolean;
	planExecId?: string;
	execution?: ActiveExecution;
	errors?: string[];
	warnings?: string[];
}

// ---------------------------------------------------------------------------
// Registry of active executions
// ---------------------------------------------------------------------------

const activeExecutions = new Map<string, ActiveExecution>();

/**
 * Get all active executions for a project.
 */
export function getActiveExecutions(projectId: string): ActiveExecution[] {
	const result: ActiveExecution[] = [];
	for (const exec of activeExecutions.values()) {
		if (exec.projectId === projectId) {
			result.push(exec);
		}
	}
	return result;
}

/**
 * Get a specific active execution.
 */
export function getActiveExecution(planExecId: string): ActiveExecution | undefined {
	return activeExecutions.get(planExecId);
}

/**
 * Update an active execution's status.
 */
function updateExecutionStatus(planExecId: string, status: ActiveExecution["status"], error?: string): void {
	const exec = activeExecutions.get(planExecId);
	if (exec) {
		exec.status = status;
		if (status === "complete" || status === "failed" || status === "stopped" || status === "cancelled") {
			exec.completedAt = Date.now();
		}
		if (error) {
			exec.error = error;
		}
	}
}

// ---------------------------------------------------------------------------
// Run a plan in the background
// ---------------------------------------------------------------------------

/**
 * Run a plan in the background.
 *
 * Parses the plan, validates it, creates an executor, and starts execution.
 * Returns immediately with the execution ID.
 */
export async function runPlan(options: RunPlanOptions): Promise<RunPlanResult> {
	const { planContent, projectId, workspaceRoot, planFileName } = options;

	// Parse the plan
	const parseResult = parsePlan(planContent);

	if (!parseResult.success || !parseResult.queue) {
		return {
			success: false,
			errors: parseResult.errors.length > 0 ? parseResult.errors : ["Failed to parse plan"],
			warnings: parseResult.warnings,
		};
	}

	// Run safety doctor
	const doctor = createSafetyDoctor();
	const safetyReport = doctor.validateQueue(parseResult.queue);

	if (!safetyReport.safe) {
		return {
			success: false,
			errors: safetyReport.critical.map((i) => `[${i.type}] ${i.message}`),
			warnings: [...safetyReport.warnings.map((i) => `[${i.type}] ${i.message}`), ...parseResult.warnings],
		};
	}

	// Save the plan file to the project directory
	const piDir = join(workspaceRoot, ".pi");
	const plansDir = join(piDir, "plans");
	if (!existsSync(plansDir)) {
		await mkdir(plansDir, { recursive: true });
	}
	const planFilePath = join(plansDir, planFileName || `plan-${Date.now()}.md`);
	await writeFile(planFilePath, planContent, "utf-8");

	// Create the executor using the state store
	const stateStore: IStateStore = createStateStore({
		backend: detectStateStoreBackend(),
		workspaceRoot,
	});

	const executor = new AutonomousExecutor(stateStore, {
		workspaceRoot,
		projectId,
		maxWorkers: parseResult.queue.maxParallelWorkspaces || 3,
		skipProjectManagement: false,
	});

	// Initialize the execution
	const planExecutionId = await executor.initialize(parseResult.queue);

	// Create the execution tracking object
	const execution: ActiveExecution = {
		projectId,
		planExecId: planExecutionId,
		title: parseResult.queue.title,
		phase: parseResult.queue.phase,
		status: "running",
		startedAt: Date.now(),
		completedAt: null,
	};

	activeExecutions.set(planExecutionId, execution);

	// Start execution in background (do not await)
	executePlanInBackground(executor, parseResult.queue, planExecutionId).catch((error) => {
		console.error(`[plan-runner] Background execution failed:`, error);
		updateExecutionStatus(planExecutionId, "failed", String(error));
	});

	return {
		success: true,
		planExecId: planExecutionId,
		execution,
		warnings: parseResult.warnings,
	};
}

/**
 * Execute a plan in the background, updating the execution status.
 */
async function executePlanInBackground(
	executor: AutonomousExecutor,
	queue: WorkspaceQueue,
	planExecId: string,
): Promise<void> {
	try {
		let _completedCount = 0;
		let failedCount = 0;

		while (!executor.isExecutionComplete()) {
			// Check if execution was externally cancelled/stopped
			const exec = activeExecutions.get(planExecId);
			if (!exec || exec.status === "stopped" || exec.status === "cancelled") {
				await executor.failPlan("Execution cancelled by user");
				return;
			}

			const nextWorkspaces = await executor.getNextWorkspaces(queue.workspaces);

			if (nextWorkspaces.length === 0) {
				const stats = executor.getStatistics();
				if (stats && stats.blocked > 0 && stats.active === 0) {
					await executor.failPlan("Execution blocked - dependency deadlock");
					updateExecutionStatus(planExecId, "failed", "Execution blocked - dependency deadlock");
					return;
				}
				break;
			}

			const results = await Promise.all(nextWorkspaces.map((ws) => executor.executeWorkspace(ws)));

			for (const result of results) {
				if (result.success) {
					_completedCount++;
				} else if (result.verdict === "FAILED") {
					failedCount++;
				}
			}

			// Check for control requests (pause/stop)
			const control = await executor.checkControlRequest();
			if (control) {
				if (control.action === "pause") {
					updateExecutionStatus(planExecId, "paused");
				}
				if (control.action === "stop") {
					updateExecutionStatus(planExecId, "stopped", control.reason);
					return;
				}
			}
		}

		// Complete execution
		if (failedCount === 0) {
			await executor.completePlan();
			updateExecutionStatus(planExecId, "complete");
		} else {
			await executor.failPlan(`${failedCount} workspace(s) failed`);
			updateExecutionStatus(planExecId, "failed", `${failedCount} workspace(s) failed`);
		}
	} catch (error) {
		updateExecutionStatus(planExecId, "failed", error instanceof Error ? error.message : String(error));
	}
}
