/**
 * Plan Runner - Background plan execution for the web dashboard
 *
 * Manages AutonomousExecutor instances in the background so
 * plan execution can be started, monitored, and controlled
 * through the web API.
 */

import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AutonomousExecutor,
	createSafetyDoctor,
	PiLogger,
	parsePlan,
	type WorkspaceQueue,
} from "@earendil-works/pi-coding-agent";
import {
	appendAuditEntry,
	appendDecision,
	appendNarrativeEntry,
	appendRawLogLine,
	appendStructuredEntry,
} from "./execution-archive.js";
import { initializePlanMarkdown, updatePlanMarkdown } from "./plan-markdown.js";
import { getStateStore } from "./state-store-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionMeta {
	planFile: string;
	title: string;
	phase: string;
	startedAt: number;
}

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

// Map planExecId to workspaceRoot so we can clean up meta files
const executionWorkspaceRoots = new Map<string, string>();

/**
 * File suffix for plan execution meta files.
 */
const META_FILE_SUFFIX = ".meta.json";

// TTL for completed executions (30 minutes)
const EXECUTION_TTL_MS = 30 * 60 * 1000;

// Map to track cleanup timers
const cleanupTimers = new Map<string, NodeJS.Timeout>();

// ---------------------------------------------------------------------------
// WorkspaceCompletionBus - Event-driven workspace completion signaling
// ---------------------------------------------------------------------------

/**
 * An EventEmitter-based bus that signals when a workspace completes or
 * the execution is stopped/resumed. Replaces all setTimeout polling in
 * the execution loop with await-based event waiting.
 *
 * Stores the last signal so it is not lost if sent before nextCompletion()
 * is called (handles race between API handler and loop wait).
 */
class WorkspaceCompletionBus extends EventEmitter {
	private pendingNext: { resolve: (value: boolean) => void } | null = null;
	private lastSignal: boolean | null = null;

	/**
	 * Wait for the next completion or stop signal.
	 * @returns true if a normal completion/resume occurred, false if stopped/cancelled
	 */
	async nextCompletion(): Promise<boolean> {
		// If a signal was previously sent, consume it immediately
		if (this.lastSignal !== null) {
			const signal = this.lastSignal;
			this.lastSignal = null;
			return signal;
		}
		return new Promise<boolean>((resolve) => {
			this.pendingNext = { resolve };
		});
	}

	/** Signal that a workspace completed */
	signalCompletion(): void {
		if (this.pendingNext) {
			const resolve = this.pendingNext.resolve;
			this.pendingNext = null;
			resolve(true);
		} else {
			this.lastSignal = true;
		}
	}

	/** Signal stop - resolves any pending nextCompletion with false */
	signalStop(): void {
		if (this.pendingNext) {
			const resolve = this.pendingNext.resolve;
			this.pendingNext = null;
			resolve(false);
		} else {
			this.lastSignal = false;
		}
	}
}

/**
 * Per-execution completion bus instances.
 */
const completionBuses = new Map<string, WorkspaceCompletionBus>();

/**
 * Get or create a WorkspaceCompletionBus for the given execution.
 */
function getCompletionBus(planExecId: string): WorkspaceCompletionBus {
	let bus = completionBuses.get(planExecId);
	if (!bus) {
		bus = new WorkspaceCompletionBus();
		completionBuses.set(planExecId, bus);
	}
	return bus;
}

/**
 * Signal an event on the execution's completion bus from outside
 * the execution loop (e.g., from the API control handler).
 *
 * @param planExecId - Plan execution ID
 * @param event - Event type: "complete" signals workspace completion/resume,
 *                "stop" signals stop/cancel to break out of any pending wait
 */
export function signalExecutionEvent(planExecId: string, event: "complete" | "stop"): void {
	const bus = completionBuses.get(planExecId);
	if (!bus) return;
	if (event === "stop") {
		bus.signalStop();
	} else {
		bus.signalCompletion();
	}
}

/**
 * Set of projectIds that currently have an in-flight runPlan() call.
 * Guards against concurrent initialization of the same project.
 */
const inFlightProjects = new Set<string>();

/**
 * Delete snapshot files (meta file + workspace queue) for a plan execution.
 *
 * Best-effort — warnings are logged on failure, but errors are never thrown.
 */
async function deleteExecutionSnapshots(planExecId: string): Promise<void> {
	const workspaceRoot = executionWorkspaceRoots.get(planExecId);
	if (!workspaceRoot) {
		return;
	}

	const piDir = join(workspaceRoot, ".pi");

	// Delete the meta file
	try {
		const metaPath = join(piDir, `${planExecId}${META_FILE_SUFFIX}`);
		await unlink(metaPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			new PiLogger({ planExecId }).warn(`Failed to delete meta file for ${planExecId}: ${error}`);
		}
	}

	// Delete the workspace queue snapshot
	try {
		const queuePath = join(piDir, `${planExecId}.${QUEUE_SNAPSHOT_FILE}`);
		await unlink(queuePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			new PiLogger({ planExecId }).warn(`Failed to delete queue snapshot for ${planExecId}: ${error}`);
		}
	}

	executionWorkspaceRoots.delete(planExecId);
}

/**
 * Write the meta file for a plan execution.
 */
async function writeExecutionMeta(workspaceRoot: string, planExecId: string, meta: ExecutionMeta): Promise<void> {
	const piDir = join(workspaceRoot, ".pi");
	await mkdir(piDir, { recursive: true });
	const metaPath = join(piDir, `${planExecId}${META_FILE_SUFFIX}`);
	await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
	executionWorkspaceRoots.set(planExecId, workspaceRoot);
}

/**
 * Load the meta file for a plan execution.
 */
async function loadExecutionMeta(workspaceRoot: string, planExecId: string): Promise<ExecutionMeta | null> {
	try {
		const metaPath = join(workspaceRoot, ".pi", `${planExecId}${META_FILE_SUFFIX}`);
		const content = await readFile(metaPath, "utf-8");
		return JSON.parse(content) as ExecutionMeta;
	} catch {
		return null;
	}
}

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

			// Delete snapshot files (meta + workspace queue)
			deleteExecutionSnapshots(planExecId);

			// Schedule cleanup after TTL
			scheduleExecutionCleanup(planExecId);
		}
		if (error) {
			exec.error = error;
		}
	}
}

/**
 * Schedule cleanup of a completed execution after TTL expires.
 */
function scheduleExecutionCleanup(planExecId: string): void {
	// Clear any existing timer
	const existingTimer = cleanupTimers.get(planExecId);
	if (existingTimer) {
		clearTimeout(existingTimer);
	}

	// Schedule new cleanup
	const timer = setTimeout(() => {
		new PiLogger({ planExecId }).info(`Cleaning up completed execution ${planExecId} after TTL`);
		activeExecutions.delete(planExecId);
		cleanupTimers.delete(planExecId);
	}, EXECUTION_TTL_MS);

	cleanupTimers.set(planExecId, timer);
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

	// AC #5: If there's already a running execution for this project, return it
	const existingRunning = getActiveExecutions(projectId).find((e) => e.status === "running");
	if (existingRunning) {
		new PiLogger().info(`Project ${projectId} already has a running execution, returning existing`);
		return {
			success: true,
			planExecId: existingRunning.planExecId,
			execution: existingRunning,
		};
	}

	// AC #1 & AC #2: Guard against concurrent runPlan calls per projectId
	if (inFlightProjects.has(projectId)) {
		new PiLogger().info(`Project ${projectId} is already being initialized, rejecting duplicate`);
		return {
			success: false,
			errors: [
				`A plan is already being initialized for project "${projectId}". Wait for initialization to complete before starting a new one.`,
			],
		};
	}
	inFlightProjects.add(projectId);

	try {
		// Validate workspaceRoot before any filesystem operations
		if (!workspaceRoot || workspaceRoot.trim() === "") {
			return {
				success: false,
				errors: ["workspaceRoot is required but was not provided"],
			};
		}

		// Ensure workspaceRoot is an absolute path
		const path = await import("node:path");
		if (!path.isAbsolute(workspaceRoot)) {
			return {
				success: false,
				errors: [`workspaceRoot must be an absolute path, got: ${workspaceRoot}`],
			};
		}

		new PiLogger().info(`Starting plan execution for project ${projectId}`);
		new PiLogger().info(`Workspace root: ${workspaceRoot}`);

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

		// Audit log: safety doctor validation result
		const _safetyAuditEntry = {
			timestamp: new Date().toISOString(),
			type: "safety-validation",
			safe: safetyReport.safe,
			criticalCount: safetyReport.critical.length,
			warningCount: safetyReport.warnings.length,
			projectId,
		};

		// Save the plan file to the project directory
		const piDir = join(workspaceRoot, ".pi");
		const plansDir = join(piDir, "plans");
		if (!existsSync(plansDir)) {
			await mkdir(plansDir, { recursive: true });
		}
		const planFilePath = join(plansDir, planFileName || `plan-${Date.now()}.md`);
		await writeFile(planFilePath, planContent, "utf-8");

		// Use the shared state store singleton so WebSocket log streaming
		// sees the same in-memory log buffers as workspace execution.
		const stateStore = getStateStore();

		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot,
			projectId,
			maxWorkers: parseResult.queue.maxParallelWorkspaces || 3,
			skipProjectManagement: false,
			enableRealExecution: true, // Enable real agent execution
		});

		// AC #3: Guard released on initialize() success or failure
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

		// Write the meta file so recovery can find the correct plan file
		const planFileNameOnly = planFileName || path.basename(planFilePath);
		await writeExecutionMeta(workspaceRoot, planExecutionId, {
			planFile: planFileNameOnly,
			title: parseResult.queue.title,
			phase: parseResult.queue.phase,
			startedAt: execution.startedAt,
		});

		// Start execution in background (do not await)
		executePlanInBackground(executor, parseResult.queue, planExecutionId, workspaceRoot).catch((error) => {
			new PiLogger({ planExecId: planExecutionId }).error(`Background execution failed: ${error}`);
			updateExecutionStatus(planExecutionId, "failed", String(error));
		});

		// Audit log: safety validation persisted to archive (fire-and-forget)
		appendAuditEntry(workspaceRoot, planExecutionId, "_plan", _safetyAuditEntry).catch(() => {});

		return {
			success: true,
			planExecId: planExecutionId,
			execution,
			warnings: parseResult.warnings,
		};
	} finally {
		// AC #3: Always release the guard, regardless of success or failure
		inFlightProjects.delete(projectId);
	}
}

// ---------------------------------------------------------------------------
// Execution Summary Generation
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable execution summary.
 */
function generateExecutionSummary(
	queue: WorkspaceQueue,
	stats: { total: number; pending: number; active: number; complete: number; blocked: number; failed: number } | null,
	failedCount: number,
): string {
	const lines: string[] = [];

	lines.push(`Plan: ${queue.title}`);
	lines.push(`Phase: ${queue.phase}`);
	lines.push("");

	if (stats) {
		lines.push(`Total workspaces: ${stats.total}`);
		lines.push(`Completed: ${stats.complete}`);
		lines.push(`Failed: ${stats.failed}`);
		if (stats.blocked > 0) {
			lines.push(`Blocked: ${stats.blocked}`);
		}
		if (stats.pending > 0) {
			lines.push(`Pending: ${stats.pending}`);
		}
	}

	lines.push("");

	if (failedCount === 0) {
		lines.push("✓ All workspaces completed successfully");
	} else {
		lines.push(`✗ ${failedCount} workspace(s) failed`);
	}

	return lines.join("\n");
}

/**
 * Execute a plan in the background, updating the execution status.
 */
async function executePlanInBackground(
	executor: AutonomousExecutor,
	queue: WorkspaceQueue,
	planExecId: string,
	workspaceRoot: string,
): Promise<void> {
	const logFile = join(workspaceRoot, ".pi", `execution-${planExecId}.log`);

	// Batched log buffer: lines since last flush to state store
	const logLines: string[] = [];
	let linesSinceLastFlush = 0;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;

	const cancelFlushTimer = () => {
		if (flushTimer !== null) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
	};

	const flushLogBuffer = async () => {
		if (logLines.length === 0) return;
		const batch = logLines.join("");
		logLines.length = 0;
		linesSinceLastFlush = 0;

		try {
			const stateStore = executor.getStateStore();
			await stateStore.saveExecutionLog(planExecId, batch);
		} catch {
			// Ignore write errors
		}
	};

	const scheduleFlush = () => {
		if (flushTimer !== null) return;
		flushTimer = setTimeout(async () => {
			flushTimer = null;
			await flushLogBuffer();
		}, 5000);
	};

	const log = async (message: string) => {
		const timestamp = new Date().toISOString();
		const logLine = `[${timestamp}] ${message}\n`;
		new PiLogger({ planExecId }).info(message);

		try {
			// Write to log file (append-only)
			await writeFile(logFile, logLine, { flag: "a" });
		} catch {
			// Ignore write errors
		}

		// Buffer for batched state store persistence
		logLines.push(logLine);
		linesSinceLastFlush++;

		if (linesSinceLastFlush >= 50) {
			cancelFlushTimer();
			await flushLogBuffer();
		} else {
			scheduleFlush();
		}
	};

	// Create event bus for this execution
	const completionBus = getCompletionBus(planExecId);

	try {
		// Verify workspace directory exists or create it
		try {
			await mkdir(workspaceRoot, { recursive: true });
			await log(`Workspace directory verified: ${workspaceRoot}`);
		} catch (error) {
			await log(`ERROR: Failed to create workspace directory: ${workspaceRoot}`);
			await log(`Error: ${error instanceof Error ? error.message : String(error)}`);
			throw new Error(`Cannot create workspace directory: ${workspaceRoot}`);
		}

		// Log comprehensive execution metadata
		await log(`Starting execution for plan ${planExecId} (${queue.title})`);
		await log(`Phase: ${queue.phase}`);
		await log(`Workspace root: ${workspaceRoot}`);
		await log(`Total workspaces: ${queue.workspaces.length}, Max parallel: ${queue.maxParallelWorkspaces || 3}`);

		// Raw log: execution start
		await appendRawLogLine(
			workspaceRoot,
			planExecId,
			"_plan",
			`[${new Date().toISOString()}] Starting execution for plan ${planExecId} (${queue.title})`,
		).catch(() => {});

		// Structured log: execution started
		await appendStructuredEntry(workspaceRoot, planExecId, "_plan", {
			timestamp: new Date().toISOString(),
			category: "execution-started",
			planExecId,
			title: queue.title,
			phase: queue.phase,
			totalWorkspaces: queue.workspaces.length,
			maxParallel: queue.maxParallelWorkspaces || 3,
		}).catch(() => {});

		// Log model information
		const state = executor.getState();
		if (state) {
			await log(`Execution backend: ${state.metadata?.backend || "json"}`);
		}

		// Log workspace details
		await log(`Workspaces: ${queue.workspaces.map((w) => w.id).join(", ")}`);

		let _completedCount = 0;
		let failedCount = 0;
		let iteration = 0;

		// Persist the workspace queue for crash recovery
		await persistWorkspaceQueue(workspaceRoot, planExecId, queue);

		// Initialize the living plan markdown (clone plan file with status header)
		try {
			const meta = await loadExecutionMeta(workspaceRoot, planExecId);
			if (meta) {
				const plansDir = join(workspaceRoot, ".pi", "plans");
				const planFilePath = join(plansDir, meta.planFile);
				const planContent = await readFile(planFilePath, "utf-8");
				await initializePlanMarkdown(
					join(workspaceRoot, ".pi"),
					planExecId,
					planContent,
					new Date(meta.startedAt).toISOString(),
				);
				await log(`Living plan markdown initialized: ${planExecId}.md`);
			}
		} catch (error) {
			await log(
				`WARNING: Failed to initialize plan markdown: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		while (!executor.isExecutionComplete()) {
			iteration++;
			await log(`\n=== Iteration ${iteration} ===`);

			// Check if execution was externally cancelled/stopped
			const exec = activeExecutions.get(planExecId);
			if (!exec || exec.status === "stopped" || exec.status === "cancelled") {
				await log(`Execution cancelled by user`);
				await executor.failPlan("Execution cancelled by user");
				return;
			}

			// 1. Control check at top of while loop before getNextWorkspaces
			const control = await executor.checkControlRequest();
			if (control) {
				await log(`Control request: ${control.action}`);

				// Audit log: control action (pause/resume/stop)
				await appendAuditEntry(workspaceRoot, planExecId, "_plan", {
					timestamp: new Date().toISOString(),
					type: "control",
					action: control.action,
					actor: control.reason ? `dashboard: ${control.reason}` : "dashboard",
					planExecId,
				}).catch(() => {});
				if (control.action === "pause") {
					const planState = executor.getState();
					if (planState && planState.status === "paused") {
						updateExecutionStatus(planExecId, "paused");
						// 2. Paused status awaits resumed/stopped event instead of polling
						await log(`Plan paused, waiting for resume or stop event...`);
						const shouldContinue = await completionBus.nextCompletion();
						await executor.loadState();
						const finalState = executor.getState();
						if (
							!shouldContinue ||
							!finalState ||
							finalState.status === "stopped" ||
							finalState.status === "cancelled"
						) {
							// 4. Stop while paused exits cleanly
							await log(`Execution stopped while paused`);
							return;
						}
						await log(`Plan resumed, continuing execution...`);
						continue;
					}
					// Still running (active workspaces finishing), let the loop continue
				}
				if (control.action === "stop") {
					const planState = executor.getState();
					if (planState && planState.status === "stopped") {
						await log(`Stopping execution: ${control.reason || "no reason"}`);
						updateExecutionStatus(planExecId, "stopped", control.reason);
						return;
					}
					// Still running (active workspaces finishing), let the loop continue
				}
			}

			const stats = executor.getStatistics();
			await log(
				`Stats: pending=${stats?.pending}, active=${stats?.active}, blocked=${stats?.blocked}, complete=${stats?.complete}, failed=${stats?.failed}`,
			);

			const nextWorkspaces = await executor.getNextWorkspaces(queue.workspaces);
			await log(
				`Next workspaces to execute: ${nextWorkspaces.length} [${nextWorkspaces.map((w) => w.id).join(", ")}]`,
			);

			// Audit log: queue reorder / workspace scheduling decision
			if (nextWorkspaces.length > 0) {
				await appendAuditEntry(workspaceRoot, planExecId, "_plan", {
					timestamp: new Date().toISOString(),
					type: "queue-reorder",
					scheduledWorkspaces: nextWorkspaces.map((w) => w.id),
					iteration,
					planExecId,
				}).catch(() => {});
			}

			if (nextWorkspaces.length === 0) {
				// 3. Deadlock check gated on exec.status === running
				if (stats && stats.blocked > 0 && stats.active === 0 && exec.status === "running") {
					await log(`ERROR: Execution blocked - dependency deadlock`);

					// Audit log: dependency deadlock
					await appendAuditEntry(workspaceRoot, planExecId, "_plan", {
						timestamp: new Date().toISOString(),
						type: "deadlock-detected",
						blockedCount: stats.blocked,
						planExecId,
						iteration,
					}).catch(() => {});
					await executor.failPlan("Execution blocked - dependency deadlock");
					updateExecutionStatus(planExecId, "failed", "Execution blocked - dependency deadlock");
					return;
				}
				// If there are active workspaces, wait for them to complete
				if (stats && stats.active > 0) {
					await log(`Waiting for ${stats.active} active workspace(s) to complete...`);
					const shouldContinue = await completionBus.nextCompletion();
					if (!shouldContinue) {
						await log(`Execution stopped while waiting for active workspaces`);
						return;
					}
					continue;
				}
				// No workspaces to schedule and none active - execution is complete
				await log(`No more workspaces to schedule and none active - execution complete`);
				break;
			}

			await log(`Executing ${nextWorkspaces.length} workspace(s) in parallel...`);
			const results = await Promise.all(nextWorkspaces.map((ws) => executor.executeWorkspace(ws)));

			for (const result of results) {
				await log(`  - ${result.workspaceId}: ${result.verdict} (success=${result.success})`);
				if (result.error) {
					await log(`    Error: ${result.error}`);
				}

				// Raw log: mirror execution result to workspace raw.log
				await appendRawLogLine(
					workspaceRoot,
					planExecId,
					result.workspaceId,
					`[${new Date().toISOString()}] Workspace ${result.workspaceId}: ${result.verdict} (success=${result.success})`,
				).catch(() => {});

				// Structured log: workspace result as JSON
				await appendStructuredEntry(workspaceRoot, planExecId, result.workspaceId, {
					timestamp: new Date().toISOString(),
					category: "workspace-result",
					workspaceId: result.workspaceId,
					verdict: result.verdict,
					success: result.success,
					error: result.error ?? null,
				}).catch(() => {});

				// Narrative log: human-readable worker summary
				await appendNarrativeEntry(workspaceRoot, planExecId, result.workspaceId, {
					timestamp: new Date().toISOString(),
					type: "worker-summary",
					workspaceId: result.workspaceId,
					verdict: result.verdict,
					summary: result.success
						? `Workspace ${result.workspaceId} completed successfully with verdict ${result.verdict}.`
						: `Workspace ${result.workspaceId} ${result.verdict === "BLOCKED" ? "was blocked" : "failed"} with verdict ${result.verdict}.`,
					error: result.error ?? null,
				}).catch(() => {});

				// Decision log: agent decision record
				await appendDecision(workspaceRoot, planExecId, result.workspaceId, {
					timestamp: new Date().toISOString(),
					type: "workspace-verdict",
					workspaceId: result.workspaceId,
					verdict: result.verdict,
					success: result.success,
					error: result.error ?? null,
					iteration,
				}).catch(() => {});

				// Audit log: workspace completion/failure
				await appendAuditEntry(workspaceRoot, planExecId, result.workspaceId, {
					timestamp: new Date().toISOString(),
					type: "workspace-result",
					workspaceId: result.workspaceId,
					verdict: result.verdict,
					success: result.success,
					error: result.error ?? null,
				}).catch(() => {});

				if (result.success) {
					_completedCount++;
				} else if (result.verdict === "FAILED") {
					failedCount++;
				}

				// Update living plan markdown with workspace result
				try {
					const attempts = executor.getState()?.workspaces.get(result.workspaceId)?.attempts ?? 1;
					const eventType = result.success
						? "workspace-complete"
						: result.verdict === "BLOCKED"
							? "workspace-blocked"
							: "workspace-failed";
					await updatePlanMarkdown(join(workspaceRoot, ".pi"), planExecId, {
						type: eventType,
						workspaceId: result.workspaceId,
						attempts,
					});
				} catch (error) {
					await log(
						`WARNING: Failed to update plan markdown: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		}

		// Signal completion so any pending nextCompletion() resolves
		completionBus.signalCompletion();

		// Check final state before completing
		const finalState = executor.getState();
		if (finalState?.status === "stopped" || finalState?.status === "cancelled") {
			await log(`Execution already ${finalState.status}, not overriding`);
			return;
		}

		// Generate execution summary
		const stats = executor.getStatistics();
		const summary = generateExecutionSummary(queue, stats, failedCount);

		// Complete execution
		if (failedCount === 0) {
			await log(`\n=== Execution Complete ===`);
			await log(summary);

			// Audit log: plan completion
			await appendAuditEntry(workspaceRoot, planExecId, "_plan", {
				timestamp: new Date().toISOString(),
				type: "plan-complete",
				planExecId,
				summary,
			}).catch(() => {});

			// Narrative log: final execution summary
			await appendNarrativeEntry(workspaceRoot, planExecId, "_plan", {
				timestamp: new Date().toISOString(),
				type: "execution-complete",
				planExecId,
				summary,
			}).catch(() => {});

			// Update living plan markdown to complete state before plan completion
			try {
				await updatePlanMarkdown(join(workspaceRoot, ".pi"), planExecId, { type: "plan-complete" });
			} catch (error) {
				await log(
					`WARNING: Failed to finalize plan markdown: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			await executor.completePlan();
			updateExecutionStatus(planExecId, "complete");
		} else {
			await log(`\n=== Execution Failed ===`);
			await log(summary);

			// Audit log: plan failure
			await appendAuditEntry(workspaceRoot, planExecId, "_plan", {
				timestamp: new Date().toISOString(),
				type: "plan-failed",
				planExecId,
				failedCount,
				summary,
			}).catch(() => {});

			// Narrative log: execution failure summary
			await appendNarrativeEntry(workspaceRoot, planExecId, "_plan", {
				timestamp: new Date().toISOString(),
				type: "execution-failed",
				planExecId,
				summary,
				failedCount,
			}).catch(() => {});

			// Update living plan markdown to failed state before plan failure
			try {
				await updatePlanMarkdown(join(workspaceRoot, ".pi"), planExecId, { type: "plan-failed" });
			} catch (error) {
				await log(
					`WARNING: Failed to finalize plan markdown: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			await executor.failPlan(`${failedCount} workspace(s) failed`);
			updateExecutionStatus(planExecId, "failed", `${failedCount} workspace(s) failed`);
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		await log(`\n=== Execution Error ===`);
		await log(`Fatal error: ${errorMsg}`);
		// Update living plan markdown to failed state on unexpected error
		try {
			await updatePlanMarkdown(join(workspaceRoot, ".pi"), planExecId, { type: "plan-failed" });
		} catch (mdError) {
			await log(
				`WARNING: Failed to update plan markdown after error: ${mdError instanceof Error ? mdError.message : String(mdError)}`,
			);
		}
		updateExecutionStatus(planExecId, "failed", errorMsg);
	} finally {
		cancelFlushTimer();
		await flushLogBuffer().catch(() => {});
		completionBuses.delete(planExecId);
	}
}

// ---------------------------------------------------------------------------
// Crash recovery — resume stranded executions on server startup
// ---------------------------------------------------------------------------

/**
 * File name used to persist the workspace queue alongside plan state.
 */
const QUEUE_SNAPSHOT_FILE = "workspace-queue.json";

/**
 * Persist the workspace queue to disk so it can be recovered after a crash.
 *
 * Called from executePlanInBackground after the executor has been initialised.
 */
export async function persistWorkspaceQueue(
	workspaceRoot: string,
	planExecId: string,
	queue: WorkspaceQueue,
): Promise<void> {
	const piDir = join(workspaceRoot, ".pi");
	await mkdir(piDir, { recursive: true });
	const queuePath = join(piDir, `${planExecId}.${QUEUE_SNAPSHOT_FILE}`);
	await writeFile(queuePath, JSON.stringify(queue, null, 2), "utf-8");
}

/**
 * Load a previously persisted workspace queue.
 */
async function loadWorkspaceQueue(workspaceRoot: string, planExecId: string): Promise<WorkspaceQueue | null> {
	try {
		const queuePath = join(workspaceRoot, ".pi", `${planExecId}.${QUEUE_SNAPSHOT_FILE}`);
		const content = await readFile(queuePath, "utf-8");
		return JSON.parse(content) as WorkspaceQueue;
	} catch {
		return null;
	}
}

/**
 * Scan for stranded (in-flight) plan executions and resume them.
 *
 * Called once during server startup. Scans for all workspace queue snapshots
 * and attempts to recover each one, not just the most recent.
 */
export async function resumeStrandedExecutions(
	workspaceRoot: string,
	projectId: string,
	_projectName: string,
): Promise<number> {
	const piDir = join(workspaceRoot, ".pi");

	new PiLogger().info(`Scanning for stranded executions in ${piDir}`);

	// Scan for all workspace queue snapshots
	let queueFiles: string[] = [];
	try {
		const files = await readdir(piDir);
		queueFiles = files.filter((f) => f.endsWith(`.${QUEUE_SNAPSHOT_FILE}`));
	} catch {
		new PiLogger().info(`No .pi directory found, skipping recovery`);
		return 0;
	}

	if (queueFiles.length === 0) {
		new PiLogger().info(`No queue snapshots found, nothing to recover`);
		return 0;
	}

	new PiLogger().info(`Found ${queueFiles.length} queue snapshot(s), attempting recovery`);

	let recovered = 0;
	for (const queueFile of queueFiles) {
		// Extract plan execution ID from filename: <planExecId>.workspace-queue.json
		const planExecId = queueFile.replace(`.${QUEUE_SNAPSHOT_FILE}`, "");

		// Check if this execution is already tracked as active/running
		if (activeExecutions.has(planExecId)) {
			new PiLogger({ planExecId }).info(`Execution ${planExecId} already active, skipping`);
			continue;
		}

		const result = await recoverSingleExecution(workspaceRoot, projectId, planExecId);
		if (result) {
			recovered++;
		}
	}

	new PiLogger().info(`Recovery complete: ${recovered} execution(s) resumed`);
	return recovered;
}

/**
 * Recover a single stranded execution.
 */
async function recoverSingleExecution(workspaceRoot: string, projectId: string, planExecId: string): Promise<boolean> {
	const piDir = join(workspaceRoot, ".pi");

	// Use the shared state store singleton
	const stateStore = getStateStore();

	// Load the plan state to check if it's terminal
	const planState = await stateStore.loadState(planExecId);
	if (!planState) {
		new PiLogger({ planExecId }).info(`No state found for ${planExecId}, skipping recovery`);
		return false;
	}

	// If already terminal, nothing to recover — clean up orphaned snapshot files
	if (planState.status === "complete" || planState.status === "failed" || planState.status === "cancelled") {
		new PiLogger({ planExecId }).info(
			`Execution ${planExecId} already ${planState.status}, cleaning up orphaned snapshots`,
		);
		await deleteExecutionSnapshots(planExecId);
		return false;
	}

	// Try to load the persisted workspace queue
	let queue = await loadWorkspaceQueue(workspaceRoot, planExecId);

	// If no queue snapshot, try to reconstruct from the plan file
	if (!queue) {
		new PiLogger({ planExecId }).info(`No queue snapshot found for ${planExecId}, attempting to parse plan file`);
		const plansDir = join(piDir, "plans");

		// Check meta file first for the exact plan file to use
		const meta = await loadExecutionMeta(workspaceRoot, planExecId);
		let planContent: string | null = null;

		if (meta?.planFile) {
			// Use the plan file referenced in the meta file
			try {
				planContent = await readFile(join(plansDir, meta.planFile), "utf-8");
				new PiLogger({ planExecId }).info(`Found plan file from meta: ${meta.planFile}`);
			} catch {
				new PiLogger({ planExecId }).info(
					`Meta referenced ${meta.planFile} but file not found, falling back to scan`,
				);
			}
		}

		// Fallback: scan .md files for the most recent
		if (!planContent) {
			const planFiles = await readdir(plansDir).catch(() => [] as string[]);
			for (const file of planFiles.reverse()) {
				if (file.endsWith(".md")) {
					try {
						planContent = await readFile(join(plansDir, file), "utf-8");
						break;
					} catch {}
				}
			}
		}

		if (!planContent) {
			new PiLogger({ planExecId }).error(`Cannot recover ${planExecId}: no queue snapshot and no plan file found`);
			return false;
		}

		// Parse the plan
		const parseResult = parsePlan(planContent);
		if (!parseResult.success || !parseResult.queue) {
			new PiLogger({ planExecId }).error(`Cannot recover ${planExecId}: failed to parse plan file`);
			return false;
		}

		queue = parseResult.queue;
		new PiLogger({ planExecId }).info(`Reconstructed queue from plan file for ${planExecId}`);
	}

	// Re-use the same max-workers from the original plan
	const maxWorkers = queue.maxParallelWorkspaces || 3;

	const executor = new AutonomousExecutor(stateStore, {
		workspaceRoot,
		projectId,
		maxWorkers,
		skipProjectManagement: false,
		enableRealExecution: true,
	});

	// Adopt the existing execution (resets stranded active → pending)
	const adopted = await executor.adoptExistingExecution(planExecId, queue);
	if (!adopted) {
		// Already terminal or no state — nothing to do
		new PiLogger({ planExecId }).info(`Failed to adopt execution ${planExecId}`);
		return false;
	}

	// Create the execution tracking object
	const startedAt = executor.getState()?.startedAt ?? Date.now();
	const execution: ActiveExecution = {
		projectId,
		planExecId,
		title: queue.title,
		phase: queue.phase,
		status: "running",
		startedAt,
		completedAt: null,
	};

	activeExecutions.set(planExecId, execution);

	// Register the workspace root for meta file cleanup
	executionWorkspaceRoots.set(planExecId, workspaceRoot);

	// Start execution in background
	executePlanInBackground(executor, queue, planExecId, workspaceRoot).catch((error) => {
		new PiLogger({ planExecId }).error(`Background execution (recovered) failed: ${error}`);
		updateExecutionStatus(planExecId, "failed", String(error));
	});

	new PiLogger({ planExecId }).info(`Recovered stranded execution ${planExecId} (${queue.title})`);
	return true;
}
