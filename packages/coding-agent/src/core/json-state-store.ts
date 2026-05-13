/**
 * JSON-backed state store adapter.
 *
 * Wraps the existing PlanStateStore (filesystem JSON) to implement
 * the IStateStore interface. Maintains backward compatibility with
 * .pi/plan-state.json and .pi/execution-journal.ndjson.
 *
 * For project management, uses a .pi/projects.json tracking file.
 * Multi-execution operations return only the current/last execution.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { JournalEvent, PlanState, WorkspaceState } from "./plan-state.js";
import { PlanStateStore } from "./plan-state.js";
import type {
	ControlAction,
	IStateStore,
	PlanControlState,
	PlanExecutionSummary,
	ProjectSummary,
	StateStoreBackend,
} from "./state-store.js";
import type { WorkspaceQueue } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

/**
 * JSON state store configuration.
 */
export interface JsonStateStoreConfig {
	piDir?: string;
}

/**
 * Simple project tracking entry.
 */
interface ProjectEntry {
	id: string;
	name: string;
	description: string | null;
	rootPath: string | null;
	createdAt: string;
}

/**
 * JSON-backed state store adapter.
 *
 * Delegates to PlanStateStore for current-execution state management,
 * and maintains a projects.json for multi-project tracking.
 * Control requests are file-based via plan-control.json (same as PlanControlManager).
 */
export class JsonStateStore implements IStateStore {
	private workspaceRoot: string;
	private piDir: string;
	private projectsFilePath: string;
	private controlFilePath: string;
	private store: PlanStateStore;

	// In-memory log buffer: Map<planExecId:workspaceId, string[]>
	private logBuffers: Map<string, string[]> = new Map();
	private readonly MAX_BUFFER_LINES = 1000;

	constructor(workspaceRoot: string, config?: JsonStateStoreConfig) {
		this.workspaceRoot = workspaceRoot;
		this.piDir = config?.piDir ?? ".pi";
		this.projectsFilePath = path.join(workspaceRoot, this.piDir, "projects.json");
		this.controlFilePath = path.join(workspaceRoot, this.piDir, "plan-control.json");
		this.store = new PlanStateStore(workspaceRoot, this.piDir);
	}

	getBackendType(): StateStoreBackend {
		return "json";
	}

	/**
	 * Access the underlying PlanStateStore instance.
	 */
	getPlanStateStore(): PlanStateStore {
		return this.store;
	}

	// =========================================================================
	// Project Management
	// =========================================================================

	async listProjects(): Promise<ProjectSummary[]> {
		const projects = await this.readProjectsFile();
		return projects.map((p) => ({
			id: p.id,
			name: p.name,
			description: p.description,
			rootPath: p.rootPath,
			createdAt: p.createdAt,
		}));
	}

	async findOrCreateProject(name: string, rootPath?: string): Promise<ProjectSummary> {
		const projects = await this.readProjectsFile();

		// Look for existing project by name
		const existing = projects.find((p) => p.name === name);
		if (existing) {
			return {
				id: existing.id,
				name: existing.name,
				description: existing.description,
				rootPath: existing.rootPath,
				createdAt: existing.createdAt,
			};
		}

		// Create new project entry
		const id = this.generateId();
		const createdAt = new Date().toISOString();
		const entry: ProjectEntry = {
			id,
			name,
			description: null,
			rootPath: rootPath ?? null,
			createdAt,
		};

		projects.push(entry);
		await this.writeProjectsFile(projects);

		return {
			id,
			name,
			description: null,
			rootPath: rootPath ?? null,
			createdAt,
		};
	}

	async updateProject(projectId: string, updates: Partial<Pick<ProjectSummary, "name" | "rootPath">>): Promise<void> {
		const projects = await this.readProjectsFile();
		const index = projects.findIndex((p) => p.id === projectId);
		if (index === -1) {
			throw new Error(`Project not found: ${projectId}`);
		}
		if (updates.name !== undefined) {
			projects[index].name = updates.name;
		}
		if (updates.rootPath !== undefined) {
			projects[index].rootPath = updates.rootPath;
		}
		await this.writeProjectsFile(projects);
	}

	// =========================================================================
	// Plan Execution
	// =========================================================================

	/**
	 * The JSON adapter wraps a single execution context. For multi-execution
	 * scenarios, each call uses the "current" execution from PlanStateStore.
	 * The planExecutionId is stored as metadata so the same ID can be returned
	 * when listing executions.
	 */
	private currentPlanExecutionId: string | null = null;

	async initializeState(projectId: string, queue: WorkspaceQueue): Promise<string> {
		await this.store.initializeState(queue);
		const id = this.generateId();
		this.currentPlanExecutionId = id;

		// Track this execution in a simple list
		await this.appendExecutionTracking({
			id,
			projectId,
			phase: queue.phase,
			title: queue.title,
			status: "running" as const,
			startedAt: new Date().toISOString(),
			completedAt: null,
		});

		// Store plan execution ID reference
		const statePath = path.join(this.workspaceRoot, this.piDir, "current-execution.json");
		await fs.mkdir(path.dirname(statePath), { recursive: true });
		await fs.writeFile(statePath, JSON.stringify({ planExecutionId: id }), "utf-8");

		return id;
	}

	async loadState(_planExecutionId: string): Promise<PlanState | null> {
		return this.store.loadState();
	}

	async saveState(_planExecutionId: string): Promise<void> {
		await this.store.saveState();
	}

	async listPlanExecutions(projectId: string): Promise<PlanExecutionSummary[]> {
		const executions = await this.readExecutionTracking();
		return executions
			.filter((e) => e.projectId === projectId)
			.map((e) => ({
				id: e.id,
				projectId: e.projectId,
				phase: e.phase,
				title: e.title,
				status: e.status as PlanExecutionSummary["status"],
				startedAt: e.startedAt,
				completedAt: e.completedAt,
			}));
	}

	// =========================================================================
	// Workspace State
	// =========================================================================

	async updateWorkspaceState(
		_planExecutionId: string,
		workspaceId: string,
		updates: Partial<WorkspaceState>,
	): Promise<void> {
		await this.store.updateWorkspaceState(workspaceId, updates);
	}

	async transitionWorkspace(
		_planExecutionId: string,
		workspaceId: string,
		newStage: WorkspaceStage,
		data?: Record<string, unknown>,
	): Promise<void> {
		await this.store.transitionWorkspace(workspaceId, newStage, data);
		// Update execution status if all workspaces are complete/failed
		this.syncPlanStatus();
	}

	async incrementRetryAttempt(_planExecutionId: string, workspaceId: string): Promise<void> {
		await this.store.incrementRetryAttempt(workspaceId);
	}

	// =========================================================================
	// File Locks
	// =========================================================================

	async acquireFileLocks(_planExecutionId: string, workspaceId: string, files: string[]): Promise<void> {
		await this.store.acquireFileLocks(workspaceId, files);
	}

	async releaseFileLocks(_planExecutionId: string, workspaceId: string): Promise<void> {
		await this.store.releaseFileLocks(workspaceId);
	}

	// =========================================================================
	// Journal
	// =========================================================================

	async appendJournal(_planExecutionId: string, event: JournalEvent): Promise<void> {
		await this.store.appendJournal(event);
	}

	async readJournal(_planExecutionId: string): Promise<JournalEvent[]> {
		return this.store.readJournal();
	}

	// =========================================================================
	// Plan Lifecycle
	// =========================================================================

	async completePlan(planExecutionId: string): Promise<void> {
		await this.store.completePlan();
		await this.updateExecutionStatus(planExecutionId, "complete");
	}

	async failPlan(planExecutionId: string, error: string): Promise<void> {
		await this.store.failPlan(error);
		await this.updateExecutionStatus(planExecutionId, "failed");
	}

	async pausePlan(planExecutionId: string, reason?: string): Promise<void> {
		await this.store.pausePlan(reason);
		await this.updateExecutionStatus(planExecutionId, "paused");
	}

	async stopPlan(planExecutionId: string, reason?: string): Promise<void> {
		await this.store.stopPlan(reason);
		await this.updateExecutionStatus(planExecutionId, "stopped");
	}

	async cancelPlan(planExecutionId: string, reason?: string): Promise<void> {
		await this.store.cancelPlan(reason);
		await this.updateExecutionStatus(planExecutionId, "cancelled");
	}

	async resumePlan(planExecutionId: string): Promise<void> {
		await this.store.resumePlan();
		await this.updateExecutionStatus(planExecutionId, "running");
	}

	// =========================================================================
	// Control
	// =========================================================================

	async writeControlRequest(_planExecutionId: string, action: ControlAction, reason?: string): Promise<void> {
		const controlState: PlanControlState = {
			action,
			requestedAt: Date.now(),
			reason,
		};

		const piDirPath = path.dirname(this.controlFilePath);
		await fs.mkdir(piDirPath, { recursive: true });

		const tempPath = `${this.controlFilePath}.tmp`;
		await fs.writeFile(tempPath, JSON.stringify(controlState, null, 2), "utf-8");
		await fs.rename(tempPath, this.controlFilePath);
	}

	async readControlRequest(_planExecutionId: string): Promise<PlanControlState | null> {
		try {
			const content = await fs.readFile(this.controlFilePath, "utf-8");
			return JSON.parse(content) as PlanControlState;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	async clearControlRequest(_planExecutionId: string): Promise<void> {
		try {
			await fs.unlink(this.controlFilePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}

	// =========================================================================
	// Query
	// =========================================================================

	async getWorkspaceState(_planExecutionId: string, workspaceId: string): Promise<WorkspaceState | undefined> {
		return this.store.getWorkspaceState(workspaceId);
	}

	async getStatistics(planExecutionId: string): Promise<{
		total: number;
		pending: number;
		active: number;
		complete: number;
		blocked: number;
		failed: number;
		total_tokens_in?: number;
		total_tokens_out?: number;
		cache_hit_rate?: number;
		estimated_cost_usd?: number;
		burn_rate_per_min?: number;
	} | null> {
		const state = this.store.getState();
		if (!state) return null;

		const stats = { total: 0, pending: 0, active: 0, complete: 0, blocked: 0, failed: 0 };
		for (const ws of state.workspaces.values()) {
			stats.total++;
			switch (ws.stage) {
				case WorkspaceStage.Pending:
					stats.pending++;
					break;
				case WorkspaceStage.Active:
					stats.active++;
					break;
				case WorkspaceStage.Complete:
					stats.complete++;
					break;
				case WorkspaceStage.Blocked:
					stats.blocked++;
					break;
				case WorkspaceStage.Failed:
					stats.failed++;
					break;
			}
		}

		// Compute telemetry from workspace execution logs
		// Uses the chars/4 token estimation heuristic from token-metering.ts
		let totalCharsIn = 0;
		let totalCharsOut = 0;
		const now = Date.now();

		for (const ws of state.workspaces.values()) {
			if (ws.startedAt && ws.completedAt) {
				const logFiles = await this.loadWorkspaceExecutionLogs(planExecutionId, ws.workspaceId);
				for (const logContent of logFiles) {
					if (!logContent) continue;
					const lines = logContent.split("\n").filter((l: string) => l.length > 0);
					for (const line of lines) {
						totalCharsIn += line.length;
					}
					totalCharsOut += logContent.length * 0.3; // ~30% of log is output (assistant messages)
				}
			}
		}

		const totalTokensIn = Math.ceil(totalCharsIn / 4);
		const totalTokensOut = Math.ceil(totalCharsOut / 4);

		// Estimate cost using approximate Claude/Haiku pricing ($3/M input, $15/M output)
		const estimatedCost = (totalTokensIn / 1_000_000) * 3 + (totalTokensOut / 1_000_000) * 15;

		// Burn rate: tokens per minute since execution started
		const elapsedMs = (state.completedAt ?? now) - state.startedAt;
		const elapsedMinutes = elapsedMs / 60_000;
		const burnRate = elapsedMinutes > 0 ? Math.round(totalTokensIn / elapsedMinutes) : 0;

		return {
			...stats,
			total_tokens_in: totalTokensIn,
			total_tokens_out: totalTokensOut,
			cache_hit_rate: 0, // Not tracked yet
			estimated_cost_usd: Number.parseFloat(estimatedCost.toFixed(4)),
			burn_rate_per_min: burnRate,
		};
	}

	// =========================================================================
	// Execution Logs
	// =========================================================================

	async saveExecutionLog(planExecutionId: string, logContent: string): Promise<void> {
		const logFilePath = path.join(this.workspaceRoot, this.piDir, `execution-${planExecutionId}.log`);
		await fs.mkdir(path.dirname(logFilePath), { recursive: true });
		await fs.appendFile(logFilePath, logContent, "utf-8");
	}

	async loadExecutionLog(planExecutionId: string): Promise<string | null> {
		const logFilePath = path.join(this.workspaceRoot, this.piDir, `execution-${planExecutionId}.log`);
		try {
			return await fs.readFile(logFilePath, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Append a log line to workspace-specific logs.
	 */
	async appendWorkspaceLog(planExecutionId: string, workspaceId: string, logLine: string): Promise<void> {
		const key = `${planExecutionId}:${workspaceId}`;

		// Get or create buffer
		let buffer = this.logBuffers.get(key);
		if (!buffer) {
			buffer = [];
			this.logBuffers.set(key, buffer);
		}

		// Add line to buffer
		buffer.push(logLine);

		// Trim buffer if it exceeds max size
		if (buffer.length > this.MAX_BUFFER_LINES) {
			buffer.shift();
		}

		// Persist to file
		const logFilePath = path.join(this.workspaceRoot, this.piDir, `workspace-${planExecutionId}-${workspaceId}.log`);
		await fs.mkdir(path.dirname(logFilePath), { recursive: true });
		await fs.appendFile(logFilePath, `${logLine}\n`, "utf-8");
	}

	/**
	 * Load all workspace execution attempt logs for a plan execution.
	 * Reads from .pi/workspaces/{workspaceId}/execution-{attempt}.log
	 */
	private async loadWorkspaceExecutionLogs(_planExecutionId: string, workspaceId: string): Promise<string[]> {
		const results: string[] = [];
		const wsDir = path.join(this.workspaceRoot, this.piDir, "workspaces", workspaceId);
		try {
			const files = await fs.readdir(wsDir);
			const logFiles = files.filter((f) => f.startsWith("execution-") && f.endsWith(".log"));
			logFiles.sort();
			for (const file of logFiles) {
				try {
					const content = await fs.readFile(path.join(wsDir, file), "utf-8");
					results.push(content);
				} catch {
					// Skip unreadable files
				}
			}
		} catch {
			// Directory doesn't exist or can't be read
		}
		return results;
	}

	/**
	 * Load workspace-specific log content.
	 */
	async loadWorkspaceLog(planExecutionId: string, workspaceId: string): Promise<string | null> {
		const logFilePath = path.join(this.workspaceRoot, this.piDir, `workspace-${planExecutionId}-${workspaceId}.log`);
		try {
			return await fs.readFile(logFilePath, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Get recent log lines from buffer (for WebSocket streaming).
	 */
	getRecentWorkspaceLogs(planExecutionId: string, workspaceId: string, maxLines = 100): string[] {
		const key = `${planExecutionId}:${workspaceId}`;
		const buffer = this.logBuffers.get(key);
		if (!buffer) {
			return [];
		}
		return buffer.slice(-maxLines);
	}

	// =========================================================================
	// Internal Helpers
	// =========================================================================

	/**
	 * Read projects from tracking file.
	 */
	private async readProjectsFile(): Promise<ProjectEntry[]> {
		try {
			const content = await fs.readFile(this.projectsFilePath, "utf-8");
			return JSON.parse(content) as ProjectEntry[];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Write projects to tracking file.
	 */
	private async writeProjectsFile(projects: ProjectEntry[]): Promise<void> {
		await fs.mkdir(path.dirname(this.projectsFilePath), { recursive: true });
		const tempPath = `${this.projectsFilePath}.tmp`;
		await fs.writeFile(tempPath, JSON.stringify(projects, null, 2), "utf-8");
		await fs.rename(tempPath, this.projectsFilePath);
	}

	/**
	 * Execution tracking entry.
	 */
	private async readExecutionTracking(): Promise<
		Array<{
			id: string;
			projectId: string;
			phase: string;
			title: string;
			status: string;
			startedAt: string;
			completedAt: string | null;
		}>
	> {
		const filePath = path.join(this.workspaceRoot, this.piDir, "executions.json");
		try {
			const content = await fs.readFile(filePath, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Append execution tracking entry.
	 */
	private async appendExecutionTracking(entry: {
		id: string;
		projectId: string;
		phase: string;
		title: string;
		status: string;
		startedAt: string;
		completedAt: string | null;
	}): Promise<void> {
		const executions = await this.readExecutionTracking();
		executions.push(entry);
		const filePath = path.join(this.workspaceRoot, this.piDir, "executions.json");
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		const tempPath = `${filePath}.tmp`;
		await fs.writeFile(tempPath, JSON.stringify(executions, null, 2), "utf-8");
		await fs.rename(tempPath, filePath);
	}

	/**
	 * Update execution status in tracking.
	 */
	private async updateExecutionStatus(planExecutionId: string, status: string): Promise<void> {
		const executions = await this.readExecutionTracking();
		const idx = executions.findIndex((e) => e.id === planExecutionId);
		if (idx !== -1) {
			executions[idx].status = status;
			if (["complete", "failed", "stopped", "cancelled"].includes(status)) {
				executions[idx].completedAt = new Date().toISOString();
			}
			const filePath = path.join(this.workspaceRoot, this.piDir, "executions.json");
			const tempPath = `${filePath}.tmp`;
			await fs.writeFile(tempPath, JSON.stringify(executions, null, 2), "utf-8");
			await fs.rename(tempPath, filePath);
		}
	}

	/**
	 * Sync plan status from PlanStateStore to execution tracking.
	 */
	private async syncPlanStatus(): Promise<void> {
		if (!this.currentPlanExecutionId) return;
		const state = this.store.getState();
		if (!state) return;
		await this.updateExecutionStatus(this.currentPlanExecutionId, state.status);
	}

	/**
	 * Generate a simple UUID v4.
	 */
	private generateId(): string {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === "x" ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	}
}
