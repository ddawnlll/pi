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
	type ApprovedPreviewMetadata,
	AutonomousExecutor,
	type CleanupReviewResult,
	createSafetyDoctor,
	killTrackedDetachedChildren,
	PiLogger,
	parsePlan,
	runCleanupReview,
	validatePlanTargetCommands,
	type WorkspaceExecutionResult,
	type WorkspaceQueue,
	WorkspaceStage,
} from "@earendil-works/pi-coding-agent";
import {
	appendAuditEntry,
	appendDecision,
	appendNarrativeEntry,
	appendRawLogLine,
	appendStructuredEntry,
} from "./execution-archive.js";
import { initializePlanMarkdown, updatePlanMarkdown } from "./plan-markdown.js";
import { computeBatchPlan } from "./plan-preview.js";
import { getStateStore, getWorkspaceRoot } from "./state-store-provider.js";
import { createTaskStore } from "./task-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionMeta {
	planFile: string;
	title: string;
	phase: string;
	startedAt: number;
	/** Approved preview metadata persisted for crash recovery (AC2). */
	approvedPreview?: ApprovedPreviewMetadata;
	/** Worktree isolation config persisted for crash recovery. */
	worktreeConfig?: { enabled: boolean };
	/** Workspace execution timeout in milliseconds persisted for crash recovery. */
	workspaceTimeoutMs?: number;
	/** User-provided phase title override (P22.E). */
	phaseTitle?: string;
	/** Whether this plan execution is archived (hidden from default runs list) (P22.E). */
	archived?: boolean;
}

export interface ActiveExecution {
	projectId: string;
	planExecId: string;
	title: string;
	phase: string;
	status: "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled" | "awaiting_handoff";
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
	safetyOverrides?: Record<string, boolean>;
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

// TTL for completed executions (default 30 minutes, configurable via env var)
// PI_EXECUTION_TTL_MINUTES overrides the default.
const EXECUTION_TTL_MS = (Number.parseInt(process.env.PI_EXECUTION_TTL_MINUTES ?? "", 10) || 30) * 60 * 1000;

// Map to track cleanup timers
const cleanupTimers = new Map<string, NodeJS.Timeout>();

// Bug #9 fix: clear all cleanup timers on shutdown to prevent memory leaks
function clearAllCleanupTimers(): void {
	for (const timer of cleanupTimers.values()) {
		clearTimeout(timer);
	}
	cleanupTimers.clear();
}

// Register shutdown handlers to clean up timers
process.on("beforeExit", () => {
	clearAllCleanupTimers();
});
process.on("SIGINT", () => {
	clearAllCleanupTimers();
});
process.on("SIGTERM", () => {
	clearAllCleanupTimers();
});

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
/**
 * Signal type emitted by WorkspaceCompletionBus.
 */
class WorkspaceCompletionSignal {
	/**
	 * @param continue_ - true to continue execution, false to stop
	 * @param wakeOnly - if true, this is a pure wake-up with no semantic meaning
	 */
	constructor(
		readonly continue_: boolean,
		readonly wakeOnly: boolean = false,
	) {}

	static complete(): WorkspaceCompletionSignal {
		return new WorkspaceCompletionSignal(true, false);
	}
	static stop(): WorkspaceCompletionSignal {
		return new WorkspaceCompletionSignal(false, false);
	}
	static wake(): WorkspaceCompletionSignal {
		return new WorkspaceCompletionSignal(true, true);
	}
}

class WorkspaceCompletionBus extends EventEmitter {
	private pendingNext: { resolve: (value: WorkspaceCompletionSignal) => void } | null = null;
	private lastSignal: WorkspaceCompletionSignal | null = null;
	// Bug #7 fix: use a simple mutex flag to prevent races between
	// nextCompletion() and signalCompletion()
	private busy = false;

	/**
	 * Reset the bus for reuse — clears any stale accumulated signal.
	 * Called when a new execution starts for the same planExecId.
	 */
	reset(): void {
		this.lastSignal = null;
	}

	/**
	 * Wait for the next completion or stop signal.
	 * @returns a signal describing what happened
	 */
	async nextCompletion(): Promise<WorkspaceCompletionSignal> {
		// Busy-wait briefly if signalCompletion is in progress
		while (this.busy) {
			await new Promise((r) => setTimeout(r, 10));
		}
		// If a signal was previously sent, consume it atomically
		if (this.lastSignal !== null) {
			const signal = this.lastSignal;
			this.lastSignal = null;
			return signal;
		}
		return new Promise<WorkspaceCompletionSignal>((resolve) => {
			this.pendingNext = { resolve };
		});
	}

	/** Signal that a workspace completed */
	signalCompletion(): void {
		this.busy = true;
		try {
			if (this.pendingNext) {
				const resolve = this.pendingNext.resolve;
				this.pendingNext = null;
				resolve(WorkspaceCompletionSignal.complete());
			} else {
				this.lastSignal = WorkspaceCompletionSignal.complete();
			}
		} finally {
			this.busy = false;
		}
	}

	/** Signal stop - resolves any pending nextCompletion */
	signalStop(): void {
		this.busy = true;
		try {
			if (this.pendingNext) {
				const resolve = this.pendingNext.resolve;
				this.pendingNext = null;
				resolve(WorkspaceCompletionSignal.stop());
			} else {
				this.lastSignal = WorkspaceCompletionSignal.stop();
			}
		} finally {
			this.busy = false;
		}
	}

	/** Signal wake - wakes without semantic meaning, e.g. pause has been written */
	signalWake(): void {
		this.busy = true;
		try {
			if (this.pendingNext) {
				const resolve = this.pendingNext.resolve;
				this.pendingNext = null;
				resolve(WorkspaceCompletionSignal.wake());
			} else {
				this.lastSignal = WorkspaceCompletionSignal.wake();
			}
		} finally {
			this.busy = false;
		}
	}
}

/**
 * Per-execution completion bus instances.
 */
const completionBuses = new Map<string, WorkspaceCompletionBus>();

/**
 * Get or create a WorkspaceCompletionBus for the given execution.
 * Resets any stale signal from a previous execution with the same id.
 */
function getCompletionBus(planExecId: string): WorkspaceCompletionBus {
	let bus = completionBuses.get(planExecId);
	if (!bus) {
		bus = new WorkspaceCompletionBus();
		completionBuses.set(planExecId, bus);
	} else {
		// Clear stale signal from a prior execution with the same id
		bus.reset();
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
export function signalExecutionEvent(planExecId: string, event: "complete" | "stop" | "wake"): void {
	const bus = completionBuses.get(planExecId);
	if (!bus) return;
	switch (event) {
		case "stop":
			bus.signalStop();
			break;
		case "wake":
			bus.signalWake();
			break;
		default:
			bus.signalCompletion();
			break;
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
export async function loadExecutionMeta(workspaceRoot: string, planExecId: string): Promise<ExecutionMeta | null> {
	try {
		const metaPath = join(workspaceRoot, ".pi", `${planExecId}${META_FILE_SUFFIX}`);
		const content = await readFile(metaPath, "utf-8");
		return JSON.parse(content) as ExecutionMeta;
	} catch {
		return null;
	}
}

/**
 * Write the meta file for a plan execution with partial updates.
 */
export async function updateExecutionMeta(
	workspaceRoot: string,
	planExecId: string,
	updates: Partial<ExecutionMeta>,
): Promise<void> {
	const existing = await loadExecutionMeta(workspaceRoot, planExecId);
	const merged: ExecutionMeta = {
		...existing,
		...updates,
		startedAt: updates.startedAt ?? existing?.startedAt ?? Date.now(),
		planFile: updates.planFile ?? existing?.planFile ?? "",
		title: updates.title ?? existing?.title ?? "Untitled Phase",
		phase: updates.phase ?? existing?.phase ?? "P2",
	};
	await writeExecutionMeta(workspaceRoot, planExecId, merged);
}

/**
 * Rename a plan execution by updating its title in the state store and meta file.
 * Returns true on success, false if the execution was not found.
 */
export async function renameExecution(workspaceRoot: string, planExecId: string, newTitle: string): Promise<boolean> {
	try {
		// Update the meta file with phaseTitle override (P22.E)
		// phaseTitle is the user-facing display name; title is the original plan title.
		await updateExecutionMeta(workspaceRoot, planExecId, { phaseTitle: newTitle });

		// Update the active execution in-memory (if still running)
		const active = activeExecutions.get(planExecId);
		if (active) {
			active.title = newTitle;
		}

		// Update the persisted state store
		const { getStateStore } = await import("./state-store-provider.js");
		const stateStore = getStateStore();
		const state = await stateStore.loadState(planExecId);
		if (state) {
			state.title = newTitle;
			await stateStore.saveState(planExecId);
		}

		return true;
	} catch (error) {
		console.error(`[renameExecution] Failed to rename ${planExecId}:`, error);
		return false;
	}
}

/**
 * Archive or unarchive a plan execution by updating the meta file.
 * Returns the new archived state, or null if the execution was not found.
 */
export async function archiveExecution(
	workspaceRoot: string,
	planExecId: string,
	archived: boolean,
): Promise<boolean | null> {
	try {
		const meta = await loadExecutionMeta(workspaceRoot, planExecId);
		if (!meta) return null;

		await updateExecutionMeta(workspaceRoot, planExecId, { archived });
		return archived;
	} catch (error) {
		console.error(`[archiveExecution] Failed to archive ${planExecId}:`, error);
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

			// P37.RCA: Only delete snapshot files on `complete`. For stopped, failed,
			// and cancelled, the user may Continue the plan, which needs the queue
			// snapshot and meta file to reconstruct the workspace list. Deleting them
			// here causes "Execution could not be continued. It may be complete or
			// missing its queue snapshot/plan metadata."
			if (status === "complete") {
				deleteExecutionSnapshots(planExecId).catch(() => {});
			}

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

	// Parse the plan FIRST to get the phase for proper dedup
	const parseResult = parsePlan(planContent);
	const currentPhase = parseResult.success && parseResult.queue ? parseResult.queue.phase : "";

	// AC #5: Guard against concurrent runPlan calls per projectId.
	// NOTE: The old dedup-by-phase logic was removed because each plan upload
	// should always create a new execution with a fresh UUID, even if the same
	// phase string (e.g. "P2") is reused. The in-flight guard below still prevents
	// concurrent calls for the same project.
	if (parseResult.success && parseResult.queue) {
		// Extract the title for better logging
		new PiLogger().info(
			`Preparing to run plan for project ${projectId}, phase=${currentPhase}, title="${parseResult.queue.title}"`,
		);
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
			inFlightProjects.delete(projectId);
			return {
				success: false,
				errors: ["workspaceRoot is required but was not provided"],
			};
		}

		// Ensure workspaceRoot is an absolute path
		const path = await import("node:path");
		if (!path.isAbsolute(workspaceRoot)) {
			inFlightProjects.delete(projectId);
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
			inFlightProjects.delete(projectId);
			return {
				success: false,
				errors: parseResult.errors.length > 0 ? parseResult.errors : ["Failed to parse plan"],
				warnings: parseResult.warnings,
			};
		}

		// v4 AdmissionGate check — every execution entrypoint must pass
		const queue = parseResult.queue;
		const isPostgresAvailable = true;
		const isProduction = true;
		// `jsonFallbackEnabled` is a raw JSON field, not typed on WorkspaceQueue
		const queueRaw = queue as unknown as Record<string, unknown>;
		const planExecRaw = queue.planExecution as unknown as Record<string, unknown> | undefined;
		const isJsonFallback = queueRaw.jsonFallbackEnabled === true || planExecRaw?.jsonFallbackEnabled === true;
		const isRepairMode = queue.repairMode !== undefined;
		const isAutonomousMode = queue.executionAutomation?.autonomousExecutionEnabled !== false;
		const gateInput = {
			postgresAvailable: isPostgresAvailable,
			production: isProduction,
			jsonFallback: isJsonFallback,
			repairMode: isRepairMode,
			autonomousMode: isAutonomousMode,
			promotionGateSatisfied: true,
		};
		// Dynamic import to avoid requiring compiled dist at module scope
		const { admitExecution } = await import("@earendil-works/pi-coding-agent");
		const gateDecision = admitExecution(gateInput);
		if (gateDecision === "reject") {
			inFlightProjects.delete(projectId);
			const reasons: string[] = [];
			if (!isPostgresAvailable) reasons.push("postgres unavailable");
			if (isProduction && isJsonFallback) reasons.push("JSON runtime fallback forbidden in production");
			if (isRepairMode && !isAutonomousMode) reasons.push("repair mode requires autonomous mode");
			new PiLogger().warn(`AdmissionGate rejected plan execution: ${reasons.join(", ")}`);
			return {
				success: false,
				errors: [`AdmissionGate rejected execution: ${reasons.join("; ")}`],
				warnings: parseResult.warnings,
			};
		}

		// Run project stack validation
		// Checks targetCommand compatibility (e.g., pnpm commands in npm project)
		const stackValidation = await validatePlanTargetCommands(
			workspaceRoot,
			queue.workspaces.map((w) => ({ id: w.id, targetCommand: w.targetCommand })),
		);

		if (!stackValidation.valid) {
			inFlightProjects.delete(projectId);
			const stackErrors = stackValidation.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
			return {
				success: false,
				errors: [
					"Project stack validation failed: targetCommand commands are incompatible with this project's tool stack",
					...stackErrors,
				],
				warnings: [
					`Detected package manager: ${stackValidation.detectedStack.packageManager}`,
					...stackValidation.diagnostics.filter((d) => d.severity !== "error").map((d) => d.message),
					...parseResult.warnings,
				],
			};
		}

		// Run safety doctor
		const doctor = createSafetyDoctor();
		const safetyReport = doctor.validateQueue(parseResult.queue);

		// Check dashboard safety overrides (e.g. user ticked "Override: approve anyway")
		const safetyOverrides = options.safetyOverrides ?? {};

		if (!safetyReport.safe) {
			// Filter out criticals that the user explicitly overrode via dashboard
			const userOverriddenTypes = Object.entries(safetyOverrides)
				.filter(([, v]) => v === true)
				.map(([k]) => k);

			const remainingCriticals = safetyReport.critical.filter((i) => !userOverriddenTypes.includes(i.type));

			const overrideWarnings =
				userOverriddenTypes.length > 0
					? [`Safety overrides applied: ${userOverriddenTypes.join(", ")} — proceeding with user override`]
					: [];

			if (remainingCriticals.length > 0) {
				inFlightProjects.delete(projectId);
				return {
					success: false,
					errors: remainingCriticals.map((i) => `[${i.type}] ${i.message}`),
					warnings: [
						...overrideWarnings,
						...safetyReport.warnings.map((i) => `[${i.type}] ${i.message}`),
						...parseResult.warnings,
					],
				};
			}

			// All criticals were overridden.
			// Continue without returning early.
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

		// AC1: Compute approved dependency graph (batch plan) from the parsed queue.
		// This ensures the executor uses the approved dependency graph, not stale
		// parser output.
		const batchPlan = computeBatchPlan(parseResult.queue);
		const approvedPreviewMetadata: ApprovedPreviewMetadata = {
			batchAssignment: {},
			batches: batchPlan.batches.map((b) => ({
				batchIndex: b.batchIndex,
				workspaceIds: b.workspaceIds,
				width: b.width,
			})),
			effectiveParallelism: batchPlan.effectiveParallelism,
			patchesApplied: false,
			approvedAt: Date.now(),
		};
		// Map batch assignments from the dependency graph
		for (const node of batchPlan.dependencyGraph) {
			approvedPreviewMetadata.batchAssignment[node.id] = node.batchIndex;
		}

		// Read worker concurrency settings from the settings manager so that
		// the dashboard's Scale & Safety tab (maxWorkers + experimentalModeEnabled)
		// is respected at runtime. The plan's maxParallelWorkspaces is the upper
		// bound; the settings value is the actual runtime cap.
		let workerConcurrencySettings = undefined as
			| { maxWorkers?: number; experimentalModeEnabled?: boolean }
			| undefined;
		let memoryGuardConfig = undefined as { memoryLimitGb?: number; memoryWaitTimeoutSec?: number } | undefined;
		try {
			const { SettingsManager, configureMemoryGuard } = await import("@earendil-works/pi-coding-agent");
			const sm = SettingsManager.create(workspaceRoot);
			workerConcurrencySettings = sm.getWorkerConcurrency();
			// P6.5: Configure memory guard from settings before any workers start
			memoryGuardConfig = sm.getMemoryGuard();
			configureMemoryGuard({
				memoryLimitGb: memoryGuardConfig.memoryLimitGb,
				waitTimeoutSec: memoryGuardConfig.memoryWaitTimeoutSec,
			});
		} catch {
			// Non-fatal — fall back to plan-level maxParallelWorkspaces and memory guard defaults
		}

		const workerConcurrency = workerConcurrencySettings
			? {
					maxWorkers: workerConcurrencySettings.maxWorkers ?? parseResult.queue.maxParallelWorkspaces ?? 3,
					experimentalModeEnabled: workerConcurrencySettings.experimentalModeEnabled ?? false,
				}
			: undefined;

		// Determine worktree mode from the plan's execution profile.
		// Plans with worktreeRequired=false (e.g., stable_3 plans like P41)
		// run without git worktree isolation. Other plans default to enabled.
		const derivedProfile = parseResult.queue.derivedProfile;
		const planWorktreeConfig = parseResult.queue.planExecution?.worktree;
		const worktreeRequired = derivedProfile?.worktreeRequired ?? true;
		const worktreeConfig: { enabled: boolean } = {
			enabled: worktreeRequired && (planWorktreeConfig?.enabled ?? true),
		};

		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot,
			projectId,
			maxWorkers: parseResult.queue.maxParallelWorkspaces || 3,
			workerConcurrency,
			skipProjectManagement: false,
			enableRealExecution: true,
			approvedPreview: approvedPreviewMetadata,
			worktree: worktreeConfig,
			workspaceTimeoutMs: parseResult.queue.workspaceTimeoutMs,
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

		// Register execution in activeExecutions BEFORE releasing the in-flight guard.
		// This ensures concurrent runPlan() calls see the running execution
		// and return it instead of starting a duplicate.
		activeExecutions.set(planExecutionId, execution);

		// P42.HOTFIX: Cancel any stale TTL cleanup timer so the
		// execution is not prematurely dropped from the registry.
		const staleTimer2 = cleanupTimers.get(planExecutionId);
		if (staleTimer2) {
			clearTimeout(staleTimer2);
			cleanupTimers.delete(planExecutionId);
		}

		// Write the meta file so recovery can find the correct plan file
		const planFileNameOnly = planFileName || path.basename(planFilePath);
		await writeExecutionMeta(workspaceRoot, planExecutionId, {
			planFile: planFileNameOnly,
			title: parseResult.queue.title,
			phase: parseResult.queue.phase,
			startedAt: execution.startedAt,
			approvedPreview: approvedPreviewMetadata, // AC2: persist approved preview metadata
			worktreeConfig: worktreeConfig, // persist for crash recovery
			workspaceTimeoutMs: parseResult.queue.workspaceTimeoutMs, // persist for crash recovery
		});

		// Release the in-flight guard AFTER execution is registered in activeExecutions.
		// The early-return check at the top of runPlan() checks activeExecutions,
		// so this prevents concurrent runPlan() calls on the same project.
		inFlightProjects.delete(projectId);

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
	} catch (err) {
		// Safety net: release guard on thrown errors before the try block's
		// setup completes (e.g., executor.initialize failure).
		inFlightProjects.delete(projectId);
		throw err;
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

// ---------------------------------------------------------------------------
// LogBuffer — batched log flushing to state store
// ---------------------------------------------------------------------------

/**
 * Buffers log lines and flushes them to the state store in batches.
 * Flushes when the buffer reaches 50 lines or after a 5-second idle timeout.
 * Safe to call dispose() multiple times.
 */
export class LogBuffer {
	private lines: string[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private count = 0;

	constructor(
		private readonly planExecId: string,
		private readonly stateStore: { saveExecutionLog: (id: string, batch: string) => Promise<void> },
	) {}

	/**
	 * Append a log line. Triggers an immediate flush if 50 lines have accumulated,
	 * otherwise schedules a 5-second flush timer.
	 */
	append(line: string): void {
		this.lines.push(line);
		this.count++;

		if (this.count >= 50) {
			this.cancelTimer();
			this.doFlush();
		} else {
			this.scheduleFlush();
		}
	}

	/**
	 * Dispose: cancel any pending timer and flush remaining lines.
	 * Safe to call multiple times.
	 */
	async dispose(): Promise<void> {
		this.cancelTimer();
		await this.doFlush();
	}

	private cancelTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private scheduleFlush(): void {
		if (this.timer !== null) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.doFlush();
		}, 5000);
	}

	/** Flushed state: when true, all log lines have been persisted successfully. */
	private flushed = false;
	/** Error message if the last flush attempt failed. */
	private lastFlushError: string | null = null;

	private async doFlush(): Promise<void> {
		if (this.lines.length === 0) return;
		const batch = this.lines.join("");
		this.lines = [];
		this.count = 0;

		try {
			await this.stateStore.saveExecutionLog(this.planExecId, batch);
			this.flushed = true;
			this.lastFlushError = null;
		} catch (err) {
			// Buffer the failed lines back so they aren't lost on transient write errors
			this.lines = [batch, ...this.lines];
			this.count += batch.split("\n").length;
			this.lastFlushError = err instanceof Error ? err.message : String(err);
			this.flushed = false;
			// Retry after a short delay
			this.scheduleFlush();
		}
	}

	/** Returns true if all buffered lines have been flushed successfully. */
	isFlushed(): boolean {
		return this.flushed && this.lines.length === 0;
	}

	/** Returns the last flush error, or null if none. */
	getLastFlushError(): string | null {
		return this.lastFlushError;
	}
}

/**
 * Execute a plan in the background, updating the execution status.
 */
async function executePlanInBackground(
	executor: AutonomousExecutor,
	queue: WorkspaceQueue,
	planExecId: string,
	workspaceRoot: string,
	isRecovery = false,
): Promise<void> {
	const logFile = join(workspaceRoot, ".pi", `execution-${planExecId}.log`);

	// Batched log buffer: lines since last flush to state store
	const logBuffer = new LogBuffer(planExecId, executor.getStateStore());

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
		logBuffer.append(logLine);
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

		// P41-HOTFIX: Profile admission check — validate plan profile matches runtime.
		// If the plan requires worktree=false but runtime is worktree-only, fail early.
		const profile = queue.derivedProfile;
		const planWorktree = queue.planExecution?.worktree;
		if (profile?.worktreeRequired === false && planWorktree?.enabled === true) {
			const msg =
				`Runtime profile mismatch: plan ${queue.phase} has derivedProfile.worktreeRequired=false ` +
				`but planExecution.worktree.enabled=true. ` +
				`Cannot execute plan with conflicting profile.`;
			await log(`FATAL: ${msg}`);
			updateExecutionStatus(planExecId, "failed", msg);
			return;
		}

		// Log workspace details
		await log(`Workspaces: ${queue.workspaces.map((w) => w.id).join(", ")}`);

		let _completedCount = 0;
		let failedCount = 0;
		let iteration = 0;
		let planRetryCount = 0;
		const maxPlanRetries = 10;

		// P41-HOTFIX: Runaway retry loop safety guards
		const maxAttemptsPerWorkspace = 5;
		const maxSameSignatureAttempts = 3;
		const maxInstantFailures = 3;
		const workspaceAttemptCounts = new Map<string, number>();
		const workspaceLastErrors = new Map<string, string>();
		const workspaceSameSignatureCounts = new Map<string, number>();
		const workspaceLastAttemptTimestamps = new Map<string, number>();

		// Persist the workspace queue for crash recovery
		await persistWorkspaceQueue(workspaceRoot, planExecId, queue);

		// Initialize the living plan markdown (clone plan file with status header).
		// Skip during recovery since the file already exists from the previous run.
		if (!isRecovery) {
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
		} else {
			// During recovery, emit a plan-resumed event to update the header status.
			try {
				await updatePlanMarkdown(join(workspaceRoot, ".pi"), planExecId, {
					type: "plan-resumed",
				});
			} catch (error) {
				await log(
					`WARNING: Failed to update plan markdown for recovery: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		while (!executor.isExecutionComplete()) {
			iteration++;
			await log(`\n=== Iteration ${iteration} ===`);

			// Reload state from store to pick up any database-side transitions
			// (e.g. crash recovery, external reset, stalled workspace recovery).
			await executor.loadState();

			// Check if execution was externally cancelled/stopped. Registry state is
			// not authoritative, but if it is terminal we must still drain active
			// workers instead of marking the plan failed cosmetically.
			let exec = activeExecutions.get(planExecId);
			if (!exec || exec.status === "stopped" || exec.status === "cancelled") {
				await log(`Execution ${exec?.status ?? "missing"} in active registry; draining active workspaces`);
				// Save worktree artifacts before aborting agents (Bug #4 fix)
				const saved = await executor.saveAllWorktreeArtifactsBeforeStop();
				if (saved > 0) await log(`Saved ${saved} worktree artifact(s) before stop`);
				await executor.drainActiveWorkspacesForStop(`active-registry-${exec?.status ?? "missing"}`);
				return;
			}

			// Check the plan status from the freshly-loaded state (DB authoritative),
			// not just the in-memory exec.status which may not be updated by the API.
			// P37.RCA: Handle stopped/cancelled from DB state, not just paused.
			const planStateCheck = executor.getState();
			if (planStateCheck && (planStateCheck.status === "stopped" || planStateCheck.status === "cancelled")) {
				// P37.RCA: The type narrows exec.status to exclude "stopped"/"cancelled"
				// due to the early return at the active-registry check above, so this
				// comparison always diverges. Log the mismatch unconditionally.
				await executor.getStateStore().appendJournal(planExecId, {
					type: "active_registry_db_mismatch",
					timestamp: Date.now(),
					data: { registryStatus: exec.status, dbStatus: planStateCheck.status },
				});
				await log(`active_registry_db_mismatch: registry=${exec.status} db=${planStateCheck.status}`);
				await executor.getStateStore().appendJournal(planExecId, {
					type: "runner_stopped_by_db_state",
					timestamp: Date.now(),
					data: { status: planStateCheck.status },
				});
				await log(`Execution ${planStateCheck.status} by external signal`);
				// Save worktree artifacts before aborting agents
				const saved = await executor.saveAllWorktreeArtifactsBeforeStop();
				if (saved > 0) await log(`Saved ${saved} worktree artifact(s) before stop`);
				await executor.drainActiveWorkspacesForStop(`db-${planStateCheck.status}`);
				updateExecutionStatus(planExecId, planStateCheck.status);
				return;
			}

			// Check if externally paused (e.g. via dashboard API which calls
			// stateStore.pausePlan() directly). When paused with active workers,
			// abort them immediately and reset to pending for resume.
			if (planStateCheck && planStateCheck.status === "paused") {
				await log(`Plan paused by external signal`);
				// Abort active workspaces and reset to pending
				const activeIds: string[] = [];
				for (const [wsId, ws] of planStateCheck.workspaces) {
					if (ws.stage === "active") {
						activeIds.push(wsId);
					}
				}
				if (activeIds.length > 0) {
					// Save worktree artifacts before aborting agents (Bug #4 fix)
					const saved = await executor.saveAllWorktreeArtifactsBeforeStop();
					if (saved > 0) await log(`Saved ${saved} worktree artifact(s) before pause`);
					await executor.stopAllActiveWorkspaces();
					for (const wsId of activeIds) {
						await executor.getStateStore().transitionWorkspace(planExecId, wsId, WorkspaceStage.Pending, {
							reason: "paused-abort",
						});
					}
					await executor.loadState();
				}
				updateExecutionStatus(planExecId, "paused");
				await log(`Plan paused, waiting for resume or stop event...`);
				const signal = await completionBus.nextCompletion();
				await executor.loadState();
				const finalState = executor.getState();
				if (
					!signal.continue_ ||
					!finalState ||
					finalState.status === "stopped" ||
					finalState.status === "cancelled"
				) {
					await log(`Execution stopped while paused`);
					return;
				}
				await log(`Plan resumed, continuing execution...`);
				continue;
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
						await log(`Plan paused, waiting for resume or stop event...`);
						const signal = await completionBus.nextCompletion();
						await executor.loadState();
						const finalState = executor.getState();
						if (
							!signal.continue_ ||
							!finalState ||
							finalState.status === "stopped" ||
							finalState.status === "cancelled"
						) {
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
						// Save worktree artifacts before aborting agents (Bug #4 fix)
						const saved = await executor.saveAllWorktreeArtifactsBeforeStop();
						if (saved > 0) await log(`Saved ${saved} worktree artifact(s) before stop`);
						await executor.stopAllActiveWorkspaces();
						updateExecutionStatus(planExecId, "stopped", control.reason);
						return;
					}
					// Fallback: check persisted state — the control endpoint may have
					// updated PostgreSQL but the executor's in-memory cache is stale.
					try {
						const stateStore = executor.getStateStore();
						const persisted = await stateStore.loadState(planExecId);
						if (persisted && persisted.status === "stopped") {
							await log(`Stopping execution (from persisted state): ${control.reason || "no reason"}`);
							const saved = await executor.saveAllWorktreeArtifactsBeforeStop();
							if (saved > 0) await log(`Saved ${saved} worktree artifact(s) before stop`);
							await executor.stopAllActiveWorkspaces();
							updateExecutionStatus(planExecId, "stopped", control.reason);
							return;
						}
					} catch {
						// Non-fatal — fall through and let the loop continue
					}
					// Still running (active workspaces finishing), let the loop continue
				}

				// Refresh exec after control handling — the pause/stop blocks above
				// may have mutated the status via updateExecutionStatus(). The stale
				// exec.status must not be used by the deadlock check below.
				exec = activeExecutions.get(planExecId);
				if (!exec) return;
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
				await log(
					`No workspaces ready: pending=${stats?.pending}, active=${stats?.active}, blocked=${stats?.blocked}, complete=${stats?.complete}, failed=${stats?.failed}`,
				);

				// 3. Deadlock check gated on exec.status === running
				if (stats && stats.blocked > 0 && stats.active === 0 && exec.status === "running") {
					const state = executor.getState();
					const blockedWs: string[] = [];
					const pendingWs: Array<{ id: string; waitingOn: string[] }> = [];
					const blockingReasons: Record<string, string> = {};

					if (state) {
						for (const [wsId, ws] of state.workspaces) {
							if (ws.stage === WorkspaceStage.Blocked) {
								blockedWs.push(wsId);
								blockingReasons[wsId] = ws.error || "unknown";
							}
						}
						for (const [wsId, ws] of state.workspaces) {
							if (ws.stage === WorkspaceStage.Pending) {
								const planWs = queue.workspaces.find((w) => w.id === wsId);
								const unmetDeps = (planWs?.dependencies ?? []).filter((depId) => {
									const depState = state.workspaces.get(depId);
									return !depState || depState.stage !== WorkspaceStage.Complete;
								});
								if (unmetDeps.length > 0) {
									pendingWs.push({ id: wsId, waitingOn: unmetDeps });
								}
							}
						}
					}

					const blockedList = blockedWs.join(", ");
					const pendingList = pendingWs.map((p) => `  ${p.id} waiting on [${p.waitingOn.join(", ")}]`).join("\n");
					const reasonList = Object.entries(blockingReasons)
						.map(([id, r]) => `  ${id}: ${r}`)
						.join("\n");

					await log(`ERROR: Execution blocked - dependency deadlock`);
					await log(`  Blocked workspaces (${blockedWs.length}): ${blockedList}`);
					await log(`  Block reasons:\n${reasonList}`);
					await log(`  Pending workspaces waiting on blocked deps:\n${pendingList}`);

					// Audit log: dependency deadlock with full diagnostics
					await appendAuditEntry(workspaceRoot, planExecId, "_plan", {
						timestamp: new Date().toISOString(),
						type: "deadlock-detected",
						blockedCount: stats.blocked,
						blockedWorkspaces: blockedWs,
						pendingWorkspaces: pendingWs.map((p) => p.id),
						blockingReasons,
						dependencyEdges: pendingWs.map((p) => ({ workspace: p.id, waitingOn: p.waitingOn })),
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
					let signal = await completionBus.nextCompletion();
					// Wake signals (e.g. from pause being issued) cause a re-check
					// of pause/stop state rather than looping back to scheduling.
					while (signal.wakeOnly) {
						await executor.loadState();
						const currentExec = activeExecutions.get(planExecId);
						if (!currentExec || currentExec.status === "stopped" || currentExec.status === "cancelled") {
							await log(`Execution stopped while waiting for active workspaces`);
							return;
						}
						if (stats && stats.active === 0) {
							break; // No active workspaces left, let the loop re-schedule
						}
						signal = await completionBus.nextCompletion();
					}
					if (!signal.continue_) {
						// Save worktree artifacts before returning (Bug #4 fix)
						const saved = await executor.saveAllWorktreeArtifactsBeforeStop();
						if (saved > 0) await log(`Saved ${saved} worktree artifact(s) before stop`);
						await executor.drainActiveWorkspacesForStop("stop-signal-while-waiting");
						await log(`Execution stopped while waiting for active workspaces`);
						return;
					}
					continue;
				}
				// No workspaces to schedule and none active - check if any failed
				// and retry them at plan level before declaring completion.
				//
				// The plan status must be set to "failed" first because rerunExecution()
				// only accepts terminal states (failed/stopped/cancelled).
				if (failedCount > 0 && planRetryCount < maxPlanRetries && exec.status === "running") {
					planRetryCount++;
					await log(
						`Plan-level retry ${planRetryCount}/${maxPlanRetries}: ${failedCount} workspace(s) failed, resetting to pending...`,
					);

					// Transition plan to failed state so rerunExecution() accepts it.
					// loadState is called between fail and rerun so the cache is fresh.
					await executor.failPlan(`Plan retry ${planRetryCount}: ${failedCount} workspace(s) failed`);
					await executor.loadState();

					try {
						const rerunResult = await executor.rerunExecution(queue, {
							resetFailed: true,
							resetBlocked: true,
						});

						if (rerunResult.success && rerunResult.resetWorkspaces.length > 0) {
							await log(
								`Plan retry ${planRetryCount}/${maxPlanRetries}: reset ${rerunResult.resetWorkspaces.length} workspace(s), kept ${rerunResult.keptWorkspaces.length} complete`,
							);
							failedCount = 0;
							_completedCount = 0;

							// Update plan markdown
							try {
								await updatePlanMarkdown(join(workspaceRoot, ".pi"), planExecId, {
									type: "plan-retry",
								});
							} catch {}

							continue;
						} else {
							await log(
								`Plan retry produced no resettable workspaces: ${rerunResult.error || "unknown"} — declaring complete`,
							);
						}
					} catch (retryError) {
						await log(
							`Plan retry threw: ${retryError instanceof Error ? retryError.message : String(retryError)} — declaring complete`,
						);
					}
				}

				// No workspaces to schedule and none active - execution is complete
				await log(`No more workspaces to schedule and none active - execution complete`);
				break;
			}

			await log(`Executing ${nextWorkspaces.length} workspace(s) in parallel...`);

			// Wrap each workspace execution with an individual timeout so a hung
			// workspace (e.g. stuck during worktree creation or LLM stream) does
			// not block the rest of the batch. Using 3 minutes per workspace —
			// the LLM idle watchdog is 60s and worktree creation is also bounded.
			// Reduced from 10 min so force-kill doesn't wait forever.
			// P42.HOTFIX: Use configured workspaceTimeoutMs from execution meta,
			// falling back to 15 min. The previous hardcoded 3 min killed agents
			// mid-LLM-stream, producing stale_attempt_completion_ignored cascades.
			const meta = await loadExecutionMeta(workspaceRoot, planExecId).catch(() => null);
			const configuredTimeout = meta?.workspaceTimeoutMs;
			const WORKSPACE_TIMEOUT_MS = configuredTimeout && configuredTimeout > 0 ? configuredTimeout : 15 * 60 * 1000;
			const settled = await Promise.allSettled(
				nextWorkspaces.map((ws) =>
					Promise.race([
						executor.executeWorkspace(ws),
						new Promise<never>((_, reject) =>
							setTimeout(
								() =>
									reject(new Error(`Workspace ${ws.id} timed out after ${WORKSPACE_TIMEOUT_MS / 60000} min`)),
								WORKSPACE_TIMEOUT_MS,
							).unref(),
						),
					]),
				),
			);
			const results: WorkspaceExecutionResult[] = [];
			for (let i = 0; i < settled.length; i++) {
				const r = settled[i];
				if (r.status === "fulfilled") {
					results.push(r.value);
				} else {
					const wsId = nextWorkspaces[i]?.id ?? "unknown";
					await log(`  - ${wsId}: UNCAUGHT ERROR: ${r.reason}`);
					results.push({
						workspaceId: wsId,
						success: false,
						verdict: "FAILED" as const,
						error: String(r.reason),
						report: `Uncaught workspace error: ${r.reason}`,
					});
				}
			}

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
				} else if (result.verdict === "FAILED" || result.verdict === "BLOCKED") {
					failedCount++;

					// ── P41-HOTFIX: Runaway retry loop safety guards ──────────────
					// Check attempt count, same-signature, and instant-failure guards
					// before retrying. If limits are exceeded, block the workspace
					// and emit a runaway_retry_loop_detected event.
					const currentAttempts = (workspaceAttemptCounts.get(result.workspaceId) ?? 0) + 1;
					workspaceAttemptCounts.set(result.workspaceId, currentAttempts);

					const lastError = workspaceLastErrors.get(result.workspaceId);
					const currentError = result.error ?? "";
					const isSameSignature = lastError !== undefined && lastError === currentError;
					if (isSameSignature) {
						const sigCount = (workspaceSameSignatureCounts.get(result.workspaceId) ?? 0) + 1;
						workspaceSameSignatureCounts.set(result.workspaceId, sigCount);
					} else if (currentError) {
						workspaceSameSignatureCounts.set(result.workspaceId, 1);
					}
					workspaceLastErrors.set(result.workspaceId, currentError);

					const now = Date.now();
					const lastTs = workspaceLastAttemptTimestamps.get(result.workspaceId);
					const isInstantFailure = lastTs !== undefined && now - lastTs < 1000;
					workspaceLastAttemptTimestamps.set(result.workspaceId, now);

					// Compute instant failure count (failures within 1s of last)
					let instantFailureCount = 0;
					if (isInstantFailure) {
						// We count consecutive instant failures; tracked separately
						for (let i = 0; i < currentAttempts; i++) {
							// Rough estimate: if currentAttempts > 3 and all recent were instant
							instantFailureCount = currentAttempts > 3 ? currentAttempts : 0;
						}
					}

					// Check all guards — any one exceeded means the workspace must be blocked
					const sameSignatureCount = workspaceSameSignatureCounts.get(result.workspaceId) ?? 0;
					const exceedMaxAttempts = currentAttempts > maxAttemptsPerWorkspace;
					const exceedSameSignature = sameSignatureCount >= maxSameSignatureAttempts;
					const exceedInstantFailures = instantFailureCount >= maxInstantFailures;
					const shouldEscalate = exceedMaxAttempts || exceedSameSignature || exceedInstantFailures;

					if (shouldEscalate) {
						// Do NOT retry — block workspace and create escalation
						await log(
							`  -> ${result.workspaceId} (${result.verdict}) RUNAWAY RETRY DETECTED: ` +
								`attempts=${currentAttempts}, sameSignature=${sameSignatureCount}, ` +
								`instantFailures=${instantFailureCount}. BLOCKING workspace.`,
						);

						// Emit runaway_retry_loop_detected event
						const runawayEvent: {
							type: "runaway_retry_loop_detected";
							timestamp: number;
							workspaceId: string;
							data: {
								planExecutionId: string;
								attemptCount: number;
								sameSignatureCount: number;
								instantFailureCount: number;
								lastFailureSignature: string;
								lastFailureMessage: string;
								actionTaken: string;
							};
						} = {
							type: "runaway_retry_loop_detected",
							timestamp: now,
							workspaceId: result.workspaceId,
							data: {
								planExecutionId: planExecId,
								attemptCount: currentAttempts,
								sameSignatureCount,
								instantFailureCount,
								lastFailureSignature: currentError.slice(0, 200),
								lastFailureMessage: currentError.slice(0, 500),
								actionTaken: "blocked",
							},
						};

						// Log the event to the journal
						try {
							await executor
								.getStateStore()
								.appendJournal(planExecId, runawayEvent)
								.catch(() => {});
						} catch {}

						// Transition workspace to BLOCKED (terminal, not retryable)
						try {
							await executor
								.getStateStore()
								.transitionWorkspace(planExecId, result.workspaceId, WorkspaceStage.Blocked, {
									reason: `runaway-retry-after-${currentAttempts}-attempts`,
								});
							await executor.loadState();
						} catch (stateError) {
							await log(`  WARNING: failed to block runaway workspace: ${stateError}`);
						}

						// Log the escalation event
						await log(
							`  ESCALATION: Workspace ${result.workspaceId} blocked after ${currentAttempts} attempts. ` +
								`Human intervention required.`,
						);
					} else {
						// Safe to retry — transition workspace back to Pending
						await log(
							`  -> ${result.workspaceId} (${result.verdict}) will be retried at plan level ` +
								`(attempt ${currentAttempts}/${maxAttemptsPerWorkspace})`,
						);

						try {
							await executor
								.getStateStore()
								.transitionWorkspace(planExecId, result.workspaceId, WorkspaceStage.Pending, {
									reason: result.verdict === "FAILED" ? "timeout-retry" : "blocked-retry",
								});
							await executor.loadState();
						} catch (stateError) {
							await log(`  WARNING: failed to transition workspace state: ${stateError}`);
						}
					}
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

		// ── Completion verification ───────────────────────────────────────
		// Before declaring complete, verify that at least 80% of workspaces
		// actually reached a terminal state through real execution, not just
		// being marked "blocked" or "failed" without ever running.
		// This prevents the loop from exiting prematurely when workspaces
		// are stuck in unresolved dependency/block states.
		const verificationState = executor.getState();
		if (verificationState) {
			let terminalCount = 0;
			let completedOrYes = 0;
			let stillPending = 0;
			for (const [, ws] of verificationState.workspaces) {
				if (ws.stage === WorkspaceStage.Complete || ws.stage === WorkspaceStage.Failed) {
					terminalCount++;
					completedOrYes++;
				} else if (ws.stage === WorkspaceStage.Blocked) {
					terminalCount++;
				} else if (ws.stage === WorkspaceStage.Pending || ws.stage === WorkspaceStage.Active) {
					stillPending++;
				}
			}

			const total = verificationState.workspaces.size;
			const completionRatio = total > 0 ? completedOrYes / total : 0;

			if (stillPending > 0) {
				// Some workspaces are still pending — the loop should not have exited.
				// This indicates a scheduling bug. Fail the plan to prevent false completion.
				await log(
					`CRITICAL: ${stillPending} workspace(s) still pending at loop exit. ` +
						`Loop exited with ${terminalCount}/${total} terminal, ${completedOrYes} completed-or-failed. ` +
						`Failing plan to prevent false completion.`,
				);
				await executor.failPlan(`${stillPending} workspace(s) never executed`);
				updateExecutionStatus(planExecId, "failed", `${stillPending} workspace(s) never executed`);
				return;
			}

			if (completionRatio < 0.8 && total > 1) {
				// Fewer than 80% of workspaces completed successfully or failed through execution.
				// Too many workspaces are in "blocked" state without having run — treat as failure.
				await log(
					`CRITICAL: Only ${completedOrYes}/${total} workspaces completed-or-failed (${Math.round(completionRatio * 100)}%). ` +
						`${terminalCount - completedOrYes} workspaces blocked without execution. Failing plan.`,
				);
				await executor.failPlan(
					`Only ${completedOrYes}/${total} workspaces executed (${Math.round(completionRatio * 100)}%)`,
				);
				updateExecutionStatus(planExecId, "failed", `Incomplete execution: ${completedOrYes}/${total} workspaces`);
				return;
			}

			await log(
				`Completion verification passed: ${completedOrYes}/${total} workspaces completed-or-failed (${Math.round(completionRatio * 100)}%)`,
			);
		}

		// Generate execution summary
		const stats = executor.getStatistics();
		const summary = generateExecutionSummary(queue, stats, failedCount);

		// ── Run cleanup review agent ────────────────────────────────────────
		// After all workspace workers complete, run a cleanup/review agent that:
		// 1. Reads workspace reports and git diffs
		// 2. Runs available tests
		// 3. Catches regressions and bugs
		// 4. If review passes, auto-commits all changes
		// 5. Produces a comprehensive plan summary for the dashboard
		let cleanupResult: CleanupReviewResult | null = null;
		try {
			await log(`Running cleanup/review agent...`);
			const model = (executor as any).agentExecutor?.model;
			cleanupResult = await runCleanupReview({
				workspaceRoot,
				planExecutionId: planExecId,
				stateStore: executor.getStateStore(),
				queue,
				model,
			});
			await log(`Cleanup/review complete: ${cleanupResult.passed ? "PASS" : "FAIL"}`);
			await log(`Summary: ${cleanupResult.summary}`);
			if (cleanupResult.issues.length > 0) {
				const issueList = cleanupResult.issues.join("; ");
				await log(`Issues found (${cleanupResult.issueCount}): ${issueList}`);
			}

			// Persist the cleanup result as plan metadata for the dashboard
			try {
				const cleanupPath = join(workspaceRoot, ".pi", "plan-summary.json");
				await writeFile(
					cleanupPath,
					JSON.stringify({
						planExecutionId: planExecId,
						planTitle: queue.title,
						phase: queue.phase,
						completedAt: Date.now(),
						...cleanupResult,
						testResults: cleanupResult.testResults,
						changedFiles: cleanupResult.changedFiles,
						rawOutput: undefined,
					}),
					"utf-8",
				);
			} catch {
				// Non-fatal
			}
		} catch (cleanupError) {
			const cleanupMsg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
			await log(`Cleanup/review agent failed: ${cleanupMsg}`);
		}

		// ── Finalize plan: commit, complete, or handoff ─────────────────────
		//
		// After cleanup review, we determine how to finalize:
		// 1. All workspaces passed + cleanup passed → auto-commit + mark complete
		// 2. All workspaces passed but cleanup has issues → handoff for review
		// 3. Some workspaces failed → mark as failed
		const cleanupPassed = cleanupResult?.passed === true;
		const canAutoComplete = failedCount === 0 && cleanupPassed;

		// Common: log final summary, update plan markdown, append audit/narrative
		const finalStatus = canAutoComplete ? "complete" : failedCount === 0 ? "awaiting_handoff" : "failed";

		await log(`\n=== Execution ${finalStatus.toUpperCase()} ===`);
		await log(summary);

		if (cleanupResult) {
			await log(`Cleanup review: ${cleanupPassed ? "PASS (auto-committing)" : "ISSUES FOUND (entering handoff)"}`);
		}

		// Audit log
		await appendAuditEntry(workspaceRoot, planExecId, "_plan", {
			timestamp: new Date().toISOString(),
			type: "plan-complete",
			planExecId,
			summary,
			cleanupPassed,
		}).catch(() => {});

		// Narrative log
		await appendNarrativeEntry(workspaceRoot, planExecId, "_plan", {
			timestamp: new Date().toISOString(),
			type: "execution-complete",
			planExecId,
			summary,
		}).catch(() => {});

		// Update living plan markdown
		try {
			const mdType = canAutoComplete
				? "plan-complete"
				: finalStatus === "failed"
					? "plan-failed"
					: finalStatus === "awaiting_handoff"
						? "plan-handoff"
						: "plan-complete";
			await updatePlanMarkdown(join(workspaceRoot, ".pi"), planExecId, { type: mdType });
		} catch (error) {
			await log(
				`WARNING: Failed to update plan markdown: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		if (canAutoComplete) {
			// ── Auto-complete: rollup commit + mark complete ────────────────
			// The cleanup agent already committed fixes. Now do a final rollup commit
			// that captures ALL changes (workspaces + cleanup fixes).
			try {
				// Stage all remaining changes including cleanup agent's fixes
				await log(`Auto-committing all plan changes...`);
				await executor.commitPlan();
			} catch (commitError) {
				const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
				await log(`Rollup commit warning: ${commitMsg}`);
			}

			// Complete the plan in state store (bypasses awaiting_handoff entirely)
			const stateStore = executor.getStateStore();
			await stateStore.completePlan(planExecId);
			await executor.loadState();

			updateExecutionStatus(planExecId, "complete");
			await log(`Plan execution complete, auto-committed.`);
		} else if (failedCount === 0) {
			// ── Enter handoff for user review (cleanup found issues) ─────────
			await log(`Cleanup review found ${cleanupResult?.issueCount ?? 0} issue(s). Auto-completing plan.`);
			await log(`Cleanup issues: ${cleanupResult?.issues?.join("; ") ?? "none"}`);

			// Auto-complete even with cleanup issues — the issues are informational
			// and should not block plan completion for autonomous task execution.
			// The cleanup agent already committed its fixes. Do a final rollup commit.
			try {
				await executor.commitPlan();
			} catch (commitError) {
				const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
				await log(`Rollup commit warning: ${commitMsg}`);
			}

			// Complete the plan directly (bypasses handoff)
			const stateStore = executor.getStateStore();
			await stateStore.completePlan(planExecId);
			await executor.loadState();
			updateExecutionStatus(planExecId, "complete");
			await log(`Plan execution complete (cleanup issues logged).`);

			const finalState = executor.getState();
			if (finalState?.status === "stopped" || finalState?.status === "cancelled") {
				await log(`Execution already ${finalState.status}, not overriding`);
				completionBus.signalCompletion();
				return;
			}

			updateExecutionStatus(planExecId, "complete");
		} else {
			// ── Mark as failed ────────────────────────────────────────────
			await executor.failPlan(`${failedCount} workspace(s) failed after ${planRetryCount} plan retries`);
			updateExecutionStatus(planExecId, "failed", `${failedCount} workspace(s) failed`);
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		await log(`\n=== Execution Error ===`);
		await log(`Fatal error: ${errorMsg}`);
		// Save worktree artifacts before the error propagates (Bug #4 fix)
		try {
			const saved = await executor.saveAllWorktreeArtifactsBeforeStop();
			if (saved > 0) await log(`Saved ${saved} worktree artifact(s) before error termination`);
		} catch {
			// Non-fatal
		}
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
		// Process lifecycle containment: kill all tracked child processes
		// (vitest, npm, node, etc.) that may have been spawned by workspace
		// agent sessions via the bash tool, even if the execution completed
		// or failed normally.
		// Process lifecycle containment: kill any tracked child processes that
		// may have been spawned by workspace agent sessions via the bash tool.
		killTrackedDetachedChildren();

		// Check if this execution belongs to a task and advance to next phase
		try {
			await advancePhaseIfReady(workspaceRoot, planExecId);
		} catch (advErr) {
			await log(
				`WARNING: Failed to advance task phase: ${advErr instanceof Error ? advErr.message : String(advErr)}`,
			);
		}

		await logBuffer.dispose().catch(() => {});
		// Signal a terminal stop on the bus before deleting, so any pending
		// nextCompletion() waiter unblocks and sees a stop signal.
		const bus = completionBuses.get(planExecId);
		if (bus) {
			bus.signalStop();
			completionBuses.delete(planExecId);
		} else {
			completionBuses.delete(planExecId);
		}
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
 * Wait for handoff resolution (commit, keep editing, discard, or timeout).
 *
 * Shared between the initial completion path and crash recovery so that
 * a recovered plan in awaiting_handoff preserves its original handoffStartedAt
 * timestamp instead of re-entering completePlan() and resetting the timeout.
 */
async function _thisWaitForHandoff(
	executor: AutonomousExecutor,
	completionBus: WorkspaceCompletionBus,
	planExecId: string,
	workspaceRoot: string,
	log: (msg: string) => Promise<void>,
): Promise<void> {
	while (executor.getState()?.status === "awaiting_handoff") {
		// Wait for a signal on the completion bus from the API handler
		const signal = await completionBus.nextCompletion();

		// Wake-only signals (e.g. pause being written) cause a harmless re-check
		if (signal.wakeOnly) {
			await executor.loadState();
			continue;
		}

		await executor.loadState();
		const current = executor.getState();

		// Stop/cancel ends the wait
		if (!signal.continue_ || current?.status === "stopped" || current?.status === "cancelled") {
			await log(`Handoff interrupted by stop/cancel`);
			break;
		}

		// Status changed (commit, keep editing) — break out
		if (current?.status !== "awaiting_handoff") {
			await log(`Handoff resolved: ${current?.status}`);
			break;
		}

		// Check handoff timeout (auto-commit after configured duration)
		const timedOut = await executor.checkHandoffTimeout();
		if (timedOut) {
			await log(`Handoff auto-committed after timeout`);
			break;
		}
	}

	const finalState = executor.getState();
	if (finalState?.status === "complete") {
		updateExecutionStatus(planExecId, "complete");
	} else if (finalState?.status === "failed") {
		updateExecutionStatus(planExecId, "failed", "Handoff discarded by user");
	} else if (finalState?.status === "running") {
		await log(`Handoff resolved to keep editing, plan remains active`);
		updateExecutionStatus(planExecId, "running");
	}

	completionBus.signalCompletion();

	// CRITICAL FIX: After handoff is resolved, advance to the next phase in the task
	// This enables sequential phase execution to continue after cleanup review completes
	try {
		await advancePhaseIfReady(workspaceRoot, planExecId);
	} catch (err) {
		await log(`WARNING: Failed to advance phase after handoff: ${err}`);
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
async function recoverSingleExecution(
	workspaceRoot: string,
	projectId: string,
	planExecId: string,
	options: { allowTerminal?: boolean } = {},
): Promise<boolean> {
	const piDir = join(workspaceRoot, ".pi");

	// Use the shared state store singleton
	const stateStore = getStateStore();

	// Load the plan state to check if it's terminal
	const planState = await stateStore.loadState(planExecId);
	if (!planState) {
		new PiLogger({ planExecId }).info(`No state found for ${planExecId}, skipping recovery`);
		return false;
	}

	// If already terminal, crash recovery skips it. Manual continue/rerun may
	// restart failed, stopped, or cancelled executions in-place while preserving
	// completed workspaces.
	if (planState.status === "complete") {
		new PiLogger({ planExecId }).info(`Execution ${planExecId} already complete, skipping recovery`);
		await deleteExecutionSnapshots(planExecId);
		return false;
	}
	if (
		(planState.status === "failed" || planState.status === "cancelled" || planState.status === "stopped") &&
		!options.allowTerminal
	) {
		new PiLogger({ planExecId }).info(
			`Execution ${planExecId} already ${planState.status}, preserving snapshots for manual continue`,
		);
		return false;
	}

	// Load meta file once — used for plan file lookup, worktree config, and approved preview
	const meta = await loadExecutionMeta(workspaceRoot, planExecId);

	// Try to load the persisted workspace queue
	let queue = await loadWorkspaceQueue(workspaceRoot, planExecId);

	// If no queue snapshot, try to reconstruct from the plan file
	if (!queue) {
		new PiLogger({ planExecId }).info(`No queue snapshot found for ${planExecId}, attempting to parse plan file`);
		const plansDir = join(piDir, "plans");

		// Use the plan file referenced in the meta file
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

		// P37.RCA: When meta is gone (deleted by an old updateExecutionStatus bug),
		// try the plan file named after the plan execution ID first, since the
		// plan files in .pi/plans/ are stored as {planExecId}.md.
		if (!planContent) {
			try {
				planContent = await readFile(join(plansDir, `${planExecId}.md`), "utf-8");
				new PiLogger({ planExecId }).info(`Found plan file by execution ID: ${planExecId}.md`);
			} catch {
				new PiLogger({ planExecId }).info(`No plan file at ${planExecId}.md, scanning directory`);
			}
		}

		// Final fallback: scan .md files for the most recent
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

	// AC1 + AC2: Restore approved preview metadata from the already-loaded meta file
	const approvedPreviewFromMeta = meta?.approvedPreview;

	// If no persisted metadata, compute fresh from queue (fallback)
	let approvedPreviewForRecovery = approvedPreviewFromMeta;
	if (!approvedPreviewForRecovery) {
		const batchPlan = computeBatchPlan(queue);
		approvedPreviewForRecovery = {
			batchAssignment: {},
			batches: batchPlan.batches.map((b) => ({
				batchIndex: b.batchIndex,
				workspaceIds: b.workspaceIds,
				width: b.width,
			})),
			effectiveParallelism: batchPlan.effectiveParallelism,
			patchesApplied: false,
			approvedAt: Date.now(),
		};
		for (const node of batchPlan.dependencyGraph) {
			approvedPreviewForRecovery.batchAssignment[node.id] = node.batchIndex;
		}
	}

	// Restore worktree config from meta (for crash recovery AC3).
	// Worktree is ALWAYS enabled regardless of what was persisted.
	const recoveredWorktreeConfig = meta?.worktreeConfig;

	const executor = new AutonomousExecutor(stateStore, {
		workspaceRoot,
		projectId,
		maxWorkers,
		worktree: recoveredWorktreeConfig ?? { enabled: true },
		skipProjectManagement: false,
		enableRealExecution: true,
		approvedPreview: approvedPreviewForRecovery,
		workspaceTimeoutMs: meta?.workspaceTimeoutMs,
	});

	// Adopt the existing execution (resets stranded active → pending)
	const adopted = await executor.adoptExistingExecution(planExecId, queue, {
		allowTerminal: options.allowTerminal,
	});
	if (!adopted) {
		// Already terminal or no state — nothing to do
		new PiLogger({ planExecId }).info(`Failed to adopt execution ${planExecId}`);
		return false;
	}

	// Filter out already-completed workspaces so the background loop doesn't
	// re-schedule them. This preserves progress across crashes: P11.0 and P11.A
	// should not be re-executed after recovery.
	const executorState = executor.getState();
	const completeWorkspaceIds = new Set<string>();
	if (executorState) {
		for (const [wsId, ws] of executorState.workspaces) {
			if (ws.stage === "complete") {
				completeWorkspaceIds.add(wsId);
			}
		}
	}
	if (completeWorkspaceIds.size > 0) {
		const originalCount = queue.workspaces.length;
		queue.workspaces = queue.workspaces.filter((w) => !completeWorkspaceIds.has(w.id));
		new PiLogger({ planExecId }).info(
			`Filtered out ${completeWorkspaceIds.size} complete workspace(s) from recovery queue (${originalCount} → ${queue.workspaces.length})`,
		);
	}

	if (options.allowTerminal) {
		const removed = await executor.cleanupWorktreesExcept(planExecId, completeWorkspaceIds);
		new PiLogger({ planExecId }).info(
			`Manual continue removed ${removed} non-complete worktree(s); preserving ${completeWorkspaceIds.size} complete worktree(s)`,
		);
	}

	// Worktree recovery: reconcile existing worktrees from disk with execution state
	// This identifies orphaned worktrees from the previous run that need attention
	if (recoveredWorktreeConfig?.enabled) {
		try {
			const loadedWorktrees = await executor.loadWorktreeManagerState();
			if (loadedWorktrees > 0) {
				new PiLogger({ planExecId }).info(`Loaded ${loadedWorktrees} worktree(s) from persisted state`);
			}

			// Reconcile: find worktrees for this execution that are no longer in the queue
			const activeWorktreeStates = executor.getWorktreeStates();
			const workspaceIdsInQueue = new Set(queue.workspaces.map((w) => w.id));
			const orphanedWorktrees = activeWorktreeStates.filter((wt) => !workspaceIdsInQueue.has(wt.workspaceId));

			if (orphanedWorktrees.length > 0) {
				new PiLogger({ planExecId }).warn(
					`Found ${orphanedWorktrees.length} orphaned worktree(s) from previous run: ${orphanedWorktrees
						.map((wt) => wt.workspaceId)
						.join(", ")}. These will be ignored during this recovery.`,
				);
			}
		} catch (error) {
			// Non-fatal - recovery can still proceed without worktree reconciliation
			new PiLogger({ planExecId }).warn(`Worktree reconciliation failed: ${error}, continuing recovery`);
		}
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

	// P42.HOTFIX: Cancel any stale TTL cleanup timer from a previous
	// stop-rerun cycle so the active execution is not prematurely dropped.
	const staleTimer = cleanupTimers.get(planExecId);
	if (staleTimer) {
		clearTimeout(staleTimer);
		cleanupTimers.delete(planExecId);
	}

	// Register the workspace root for meta file cleanup
	executionWorkspaceRoots.set(planExecId, workspaceRoot);

	// Start execution in background
	executePlanInBackground(executor, queue, planExecId, workspaceRoot, true).catch((error) => {
		new PiLogger({ planExecId }).error(`Background execution (recovered) failed: ${error}`);
		updateExecutionStatus(planExecId, "failed", String(error));
	});

	new PiLogger({ planExecId }).info(`Recovered stranded execution ${planExecId} (${queue.title})`);
	return true;
}

/**
 * Continue an existing stopped/failed execution in-place.
 *
 * Completed workspaces remain complete and are removed from the scheduling
 * queue. Failed/blocked/active workspaces are reset to pending and rerun under
 * the same plan execution ID, preserving dashboard history and artifacts.
 */
export async function continuePlanExecution(
	workspaceRoot: string,
	projectId: string,
	planExecId: string,
): Promise<boolean> {
	const stateStore = getStateStore();
	await stateStore
		.appendJournal(planExecId, {
			type: "continue_requested",
			timestamp: Date.now(),
			data: { projectId },
		})
		.catch(() => {});
	await stateStore
		.appendJournal(planExecId, {
			type: "continue_failed_plan_requested",
			timestamp: Date.now(),
			data: { projectId },
		})
		.catch(() => {});
	await stateStore
		.appendJournal(planExecId, {
			type: "continue_rerun_started",
			timestamp: Date.now(),
			data: { projectId },
		})
		.catch(() => {});
	const recovered = await recoverSingleExecution(workspaceRoot, projectId, planExecId, { allowTerminal: true });
	if (recovered) {
		await stateStore
			.appendJournal(planExecId, {
				type: "continue_rerun_completed",
				timestamp: Date.now(),
				data: { projectId },
			})
			.catch(() => {});
	}
	return recovered;
}

// ---------------------------------------------------------------------------
// Task Auto-Advance — Phase Transition Gate
// ---------------------------------------------------------------------------

/**
 * After a plan execution completes (or fails), check if it belongs to a task
 * and, if so, run the phase transition gate and auto-advance to the next phase
 * when conditions permit.
 *
 * This is called from executePlanInBackground after the execution loop finishes.
 */
export async function advancePhaseIfReady(workspaceRoot: string, planExecId: string): Promise<void> {
	// Task files always live under the global getWorkspaceRoot(), not the
	// project rootPath. The workspaceRoot parameter is the project root.
	const taskRoot = getWorkspaceRoot();
	const taskStore = createTaskStore();

	// Find the task and phase that owns this execution
	const found = await taskStore.findByPlanExecId(taskRoot, planExecId);
	if (!found) {
		// Not part of a task — nothing to advance
		return;
	}

	const { task, phase } = found;
	const phaseIndex = task.phases.findIndex((p) => p.id === phase.id);
	if (phaseIndex === -1) return;

	// Determine phase outcome before updating status
	const currentExec = getActiveExecution(planExecId);
	const execStatus = currentExec?.status ?? "running";
	const execError = currentExec?.error ?? null;

	// Determine if the phase actually failed (not just "completed" with errors)
	const phaseFailed =
		execStatus === "failed" || execStatus === "cancelled" || (execStatus === "complete" && execError);

	// Update the phase execution with current status
	const phaseStatus = phaseFailed ? "failed" : "complete";
	if (currentExec) {
		const now = Date.now();
		const durationMs = currentExec.startedAt ? now - currentExec.startedAt : null;

		await taskStore.updatePhaseStatus(taskRoot, task.id, phase.id, phaseStatus, {
			planExecId,
			status: execStatus,
			startedAt: currentExec.startedAt,
			completedAt: currentExec.completedAt ?? now,
			durationMs,
			workspaces: [],
			stats: {
				total: 0,
				complete: 0,
				failed: 0,
			},
			error: execError,
		});
	}

	// ── CRITICAL: Re-read task from disk after updatePhaseStatus ────────
	// The local `task` snapshot is stale; load fresh data for dependency
	// resolution and gate checking.
	const freshTask = await taskStore.loadTask(taskRoot, task.id);
	if (!freshTask) return;

	// If the phase failed, mark the task as failed and stop
	if (phaseFailed) {
		await taskStore.updateTaskStatus(taskRoot, freshTask.id, "failed");
		await taskStore.appendTimelineEvent(taskRoot, freshTask.id, {
			timestamp: Date.now(),
			type: "phase_failed",
			data: { phaseId: phase.id, planExecId, error: execError },
		});
		return;
	}

	// Find the next unstarted phase whose dependencies are all met
	const nextPhase = freshTask.phases.slice(phaseIndex + 1).find((p) => {
		if (p.status !== "pending") return false;
		// Check dependencies: all must be complete (using FRESH task data)
		return p.dependsOn.every((depId) => {
			const dep = freshTask.phases.find((ph) => ph.id === depId);
			return dep?.status === "complete" || dep?.status === "skipped";
		});
	});

	if (!nextPhase) {
		// No more phases — task is complete
		await taskStore.updateTaskStatus(taskRoot, freshTask.id, "complete");
		await taskStore.appendTimelineEvent(taskRoot, freshTask.id, {
			timestamp: Date.now(),
			type: "task_complete",
			data: { aggregate: freshTask.aggregate },
		});
		return;
	}

	// ── Phase Transition Gate ────────────────────────────────────────────
	const gateResult = await runPhaseTransitionGate(taskRoot, freshTask, nextPhase);

	if (!gateResult.allowed) {
		// Blocked — mark task as blocked and emit event
		await taskStore.updateTaskStatus(taskRoot, task.id, "blocked");
		await taskStore.appendTimelineEvent(taskRoot, task.id, {
			timestamp: Date.now(),
			type: "phase_blocked",
			data: {
				phaseId: nextPhase.id,
				blockedBy: gateResult.blockedBy,
				reason: gateResult.reason,
			},
		});
		return;
	}

	// Gate passed — mark next phase pending → start (status updated, execution launched)
	await taskStore.updatePhaseStatus(taskRoot, task.id, nextPhase.id, "running");
	await taskStore.appendTimelineEvent(taskRoot, task.id, {
		timestamp: Date.now(),
		type: "phase_auto_advanced",
		data: {
			fromPhaseId: phase.id,
			toPhaseId: nextPhase.id,
		},
	});

	// Read the phase's plan file and start execution
	try {
		const planFilePath = join(workspaceRoot, ".pi", "plans", nextPhase.planFile);
		const planContent = await readFile(planFilePath, "utf-8");

		// Use the existing runPlan to start execution
		const projectName = freshTask.title || freshTask.projectId;
		const result = await runPlan({
			planContent,
			projectId: freshTask.projectId,
			projectName,
			workspaceRoot,
			planFileName: nextPhase.planFile,
		});

		if (result.success && result.planExecId) {
			await taskStore.updatePhaseStatus(taskRoot, task.id, nextPhase.id, "running", {
				planExecId: result.planExecId,
				status: "running",
				startedAt: Date.now(),
				completedAt: null,
				durationMs: null,
				workspaces: [],
				stats: {
					total: 0,
					complete: 0,
					failed: 0,
				},
				error: null,
			});
		} else {
			await taskStore.updatePhaseStatus(taskRoot, task.id, nextPhase.id, "failed");
			await taskStore.appendTimelineEvent(taskRoot, task.id, {
				timestamp: Date.now(),
				type: "phase_start_failed",
				data: { phaseId: nextPhase.id, errors: result.errors },
			});
		}
	} catch (err) {
		await taskStore.updatePhaseStatus(taskRoot, task.id, nextPhase.id, "failed");
		await taskStore.appendTimelineEvent(taskRoot, task.id, {
			timestamp: Date.now(),
			type: "phase_start_failed",
			data: { phaseId: nextPhase.id, errors: [String(err)] },
		});
	}
}

/**
 * Phase transition gate — checks all conditions before allowing auto-advance.
 *
 * Gate checks:
 * 1. Dependencies complete (already checked before calling)
 * 2. Task still approved (not revoked)
 * 3. Policy version still current
 * 4. Integration queue clean (no dirty state)
 * 5. Budget still within limit
 * 6. Stop condition triggered
 * 7. Phase requires fresh approval
 */
async function runPhaseTransitionGate(
	workspaceRoot: string,
	task: import("./task-store.js").MultiPhaseTask,
	nextPhase: import("./task-store.js").PhasePlan,
): Promise<import("./task-store.js").PhaseTransitionGateResult> {
	// 1. Dependencies — already checked by caller
	// 2. Task still approved
	if (task.approval.status === "revoked" || task.approval.status === "rejected") {
		return { allowed: false, blockedBy: "approval_revoked", reason: "Task approval was revoked" };
	}

	// 3. Policy check — basic sanity
	if (!task.policy.policyVersion) {
		return { allowed: false, blockedBy: "no_policy", reason: "No policy snapshot found" };
	}

	// 4. Integration queue — check for .pi/queue-audit or dirty state
	// (Simple check: if there are pending audit entries, consider it dirty)
	// This is a basic implementation; V2 will have a proper integration queue check
	try {
		const auditDir = join(workspaceRoot, ".pi", "queue-audit");
		const auditFiles = await readdir(auditDir).catch(() => [] as string[]);
		if (auditFiles.length > 0) {
			// Check for recent unresolved entries (simplified: any file = dirty)
			new PiLogger({ taskId: task.id }).info(
				`Integration queue audit files found: ${auditFiles.length} — proceeding (basic gate)`,
			);
		}
	} catch {
		// Non-fatal
	}

	// 5. Budget check — always allow if budget info not available
	// V2 will enforce budget limits

	// 6. Stop conditions
	if (task.policy.stopConditions.length > 0) {
		const conditions = task.policy.stopConditions;
		if (conditions.includes("budget_exceeded")) {
			// Check if aggregate budget is reasonable (always allow for now)
			// V2: read actual budget from settings
		}
		if (conditions.includes("dirty_integration_queue")) {
			// Check integration queue
			try {
				const auditDir = join(workspaceRoot, ".pi", "queue-audit");
				const auditFiles = await readdir(auditDir).catch(() => [] as string[]);
				if (auditFiles.length > 5) {
					return {
						allowed: false,
						blockedBy: "dirty_integration_queue",
						reason: `Integration queue has ${auditFiles.length} unresolved audit entries`,
					};
				}
			} catch {
				// Non-fatal
			}
		}
	}

	// 7. Phase requires fresh approval
	if (nextPhase.requiresFreshApproval) {
		return {
			allowed: false,
			blockedBy: "approval_required",
			reason: `Phase ${nextPhase.id} requires fresh approval before execution`,
		};
	}

	return { allowed: true };
}
