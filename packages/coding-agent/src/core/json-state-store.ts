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
import type { JournalEvent, PlanState, WorkerTranscriptEvent, WorkspaceState } from "./plan-state.js";
import {
	buildTranscriptSummary,
	createWorkerTranscriptEvent,
	PlanStateStore,
	sanitizeTranscriptData,
} from "./plan-state.js";
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

	// In-memory log buffer: Map<planExecId:workspaceId, { lines: string[]; bytes: number }>
	private logBuffers: Map<string, { lines: string[]; bytes: number }> = new Map();
	private readonly MAX_BUFFER_LINES = 1000;
	private readonly MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB

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

	/**
	 * Get the current plan execution ID (set during initializeState).
	 */
	getCurrentPlanExecutionId(): string | null {
		return this.currentPlanExecutionId;
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

	async appendJournalEvent(
		_planExecutionId: string,
		toolName: string,
		input: Record<string, unknown>,
		options?: {
			isMcp?: boolean;
			mcpServer?: string;
			isError?: boolean;
			errorMessage?: string;
			result?: unknown;
		},
	): Promise<void> {
		// Prefix MCP tool names with mcp:{server}:{tool}
		let formattedName = toolName;
		if (options?.isMcp && options?.mcpServer) {
			formattedName = `mcp:${options.mcpServer}:${toolName}`;
		}

		// Serialize input and truncate to 2KB
		const inputStr = JSON.stringify(input);
		const truncatedInput = inputStr.length > 2048 ? `${inputStr.substring(0, 2048)}...(truncated)` : inputStr;

		// Build event data
		const data: Record<string, unknown> = {
			toolName: formattedName,
			input: truncatedInput,
		};

		// Include error info if present
		if (options?.isError) {
			data.result = "error";
			if (options?.errorMessage) {
				data.errorMessage = options.errorMessage;
			}
		}

		// Include result if provided
		if (options?.result !== undefined) {
			data.result = data.result ?? options.result;
		}

		await this.appendJournal(_planExecutionId, {
			type: "tool_call",
			timestamp: Date.now(),
			data,
		});
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

	async setAwaitingHandoff(planExecutionId: string, planTitle: string): Promise<void> {
		await this.store.setAwaitingHandoff(planTitle);
		await this.updateExecutionStatus(planExecutionId, "awaiting_handoff");
	}

	async handoffCommit(planExecutionId: string): Promise<void> {
		await this.store.handoffCommitPlan();
		await this.updateExecutionStatus(planExecutionId, "complete");
	}

	async handoffKeepEditing(planExecutionId: string): Promise<void> {
		await this.store.handoffKeepEditingPlan();
		await this.updateExecutionStatus(planExecutionId, "running");
	}

	async handoffDiscard(planExecutionId: string, workspaceRoot: string): Promise<void> {
		// Revert uncommitted workspace files via git
		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);
			// Checkout all modified tracked files to revert uncommitted changes
			await execAsync("git checkout -- .", { cwd: workspaceRoot }).catch(() => {
				// Ignore errors (e.g., not a git repo, no changes)
			});
		} catch {
			// Ignore errors during revert
		}

		await this.store.revertAndFailPlan("User discarded changes during handoff");
		await this.updateExecutionStatus(planExecutionId, "failed");
	}

	async isAwaitingHandoff(_planExecutionId: string): Promise<boolean> {
		const state = await this.store.loadState();
		return state?.status === "awaiting_handoff";
	}

	async getHandoffStartedAt(_planExecutionId: string): Promise<number> {
		const state = await this.store.loadState();
		return state?.handoffStartedAt ?? 0;
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

	async getWorkspaceAttempts(
		_planExecutionId: string,
		workspaceId: string,
	): Promise<import("./state-store.js").WorkspaceAttempt[]> {
		const ws = this.store.getWorkspaceState(workspaceId);
		const workspacesDir = path.join(this.workspaceRoot, this.piDir, "workspaces", workspaceId);
		const attempts: import("./state-store.js").WorkspaceAttempt[] = [];

		// Determine total attempts from the workspace state
		const totalAttempts = ws?.attempts ?? 0;
		if (totalAttempts === 0) {
			return [];
		}

		// Map attempt number to retry role (matches DEFAULT_RETRY_POLICY in retry-handler.ts)
		const getRole = (attempt: number): "worker" | "flash" | "reviewer" | "final" => {
			if (attempt <= 3) return "worker";
			if (attempt <= 6) return "flash";
			if (attempt <= 9) return "reviewer";
			return "final";
		};

		// Check if a log file exists for a given attempt
		const hasLogFile = async (attempt: number): Promise<boolean> => {
			const logPath = path.join(workspacesDir, `execution-${attempt}.log`);
			try {
				await fs.stat(logPath);
				return true;
			} catch {
				return false;
			}
		};

		// Read log file for error excerpt
		const getLogError = async (attempt: number): Promise<string | null> => {
			const logPath = path.join(workspacesDir, `execution-${attempt}.log`);
			try {
				const content = await fs.readFile(logPath, "utf-8");
				const lines = content.split("\n");
				for (const line of lines) {
					if (line.toLowerCase().includes("error") || line.includes("FAILED") || line.includes("failed")) {
						return line.slice(0, 200);
					}
				}
				return null;
			} catch {
				return null;
			}
		};

		// Read journal events for this workspace to get attempt-level timing
		const journal = await this.store.readJournal();
		const wsJournalEvents = journal.filter(
			(e) =>
				e.workspaceId === workspaceId &&
				(e.type === "workspace_start" ||
					e.type === "workspace_complete" ||
					e.type === "workspace_failed" ||
					e.type === "retry_attempt"),
		);

		// Build attempt history
		for (let a = 1; a <= totalAttempts; a++) {
			const hasLog = await hasLogFile(a);
			const role = getRole(a);

			// Determine timing from journal events
			let startedAt: number | null = null;
			let completedAt: number | null = null;

			// Find matching retry_attempt event for this attempt
			const retryEvents = wsJournalEvents.filter(
				(e: import("./plan-state.js").JournalEvent) => e.type === "retry_attempt" && e.data?.attempt === a + 1,
			);
			const retryEvent = retryEvents[retryEvents.length - 1];

			// For the first attempt (a=1), use workspace_start
			if (a === 1) {
				const startEvent = wsJournalEvents.find((e) => e.type === "workspace_start");
				if (startEvent) {
					startedAt = startEvent.timestamp;
				}
			} else if (retryEvent) {
				startedAt = retryEvent.timestamp;
			}

			// Fall back to workspace state timestamps if journal doesn't have events
			if (!startedAt) {
				startedAt = ws?.startedAt ?? null;
			}

			// Determine verdict and timing
			let verdict: "running" | "complete" | "failed";
			let error: string | null = null;

			if (a < totalAttempts) {
				// Previous attempts always ended in failure
				verdict = "failed";
				// Try to get error from log file
				error = ws?.error && a === totalAttempts - 1 ? ws.error.slice(0, 200) : null;
				if (!error && hasLog) {
					error = await getLogError(a);
				}

				// Use retry_attempt event time as completion for this attempt
				if (retryEvent) {
					completedAt = retryEvent.timestamp;
				} else {
					// Estimate: each retry attempt takes roughly 1/3 of total duration
					completedAt = ws?.completedAt ?? Date.now();
				}
			} else {
				// Current/last attempt
				if (ws?.stage === "complete" /* WorkspaceStage.Complete */) {
					verdict = "complete";
					completedAt = ws?.completedAt ?? null;
				} else if (ws?.stage === "failed" /* WorkspaceStage.Failed */) {
					verdict = "failed";
					error = ws?.error?.slice(0, 200) ?? (hasLog ? await getLogError(a) : null);
					completedAt = ws?.completedAt ?? null;
				} else {
					verdict = "running";
					completedAt = null;
				}
			}

			// Calculate duration
			let duration: number | null = null;
			if (startedAt && completedAt) {
				duration = completedAt - startedAt;
			}

			attempts.push({
				attempt: a,
				role,
				startedAt,
				completedAt,
				duration,
				verdict,
				error,
			});
		}

		// Return newest first
		return attempts.reverse();
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
		cache_hit_rate_known?: boolean;
		estimated_cost_usd?: number;
		burn_rate_per_min?: number;
		tokens_per_workspace?: number;
		tokens_per_percent?: number;
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

		// Tokens per completed workspace
		const tokensPerWorkspace = stats.complete > 0 ? Math.round(totalTokensIn / stats.complete) : undefined;

		// Tokens per percent progress (only defined when total > 0)
		const progressPct = stats.total > 0 ? (stats.complete / stats.total) * 100 : 0;
		const tokensPerPercent = progressPct > 0 ? Math.round(totalTokensIn / progressPct) : undefined;

		// Compute cache hit rate from cache_usage journal events if available
		let cacheHitRate: number | undefined;
		let cacheHitRateKnown = false;
		try {
			const journal = await this.store.readJournal();
			let totalCacheRead = 0;
			let totalInput = 0;
			for (const entry of journal) {
				if (entry.type === "cache_usage" && entry.data) {
					totalCacheRead += Number(entry.data.cacheRead ?? 0);
					totalInput += Number(entry.data.input ?? 0);
				}
			}
			const denom = totalCacheRead + totalInput;
			if (denom > 0) {
				cacheHitRate = totalCacheRead / denom;
				cacheHitRateKnown = true;
			}
		} catch {
			// Non-fatal — fall back to unknown
		}

		return {
			...stats,
			total_tokens_in: totalTokensIn,
			total_tokens_out: totalTokensOut,
			cache_hit_rate: cacheHitRate ?? 0,
			cache_hit_rate_known: cacheHitRateKnown,
			estimated_cost_usd: Number.parseFloat(estimatedCost.toFixed(4)),
			burn_rate_per_min: burnRate,
			tokens_per_workspace: tokensPerWorkspace,
			tokens_per_percent: tokensPerPercent,
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
		let entry = this.logBuffers.get(key);
		if (!entry) {
			entry = { lines: [], bytes: 0 };
			this.logBuffers.set(key, entry);
		}

		// Add line to buffer and track bytes
		entry.lines.push(logLine);
		entry.bytes += Buffer.byteLength(logLine, "utf-8");

		// Trim buffer if it exceeds max lines OR max bytes
		while (entry.lines.length > this.MAX_BUFFER_LINES || entry.bytes > this.MAX_BUFFER_BYTES) {
			const removed = entry.lines.shift();
			if (removed === undefined) break;
			entry.bytes -= Buffer.byteLength(removed, "utf-8");
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
		const entry = this.logBuffers.get(key);
		if (!entry) {
			return [];
		}
		return entry.lines.slice(-maxLines);
	}

	// =========================================================================
	// Worker Transcript
	// =========================================================================

	async appendWorkerTranscriptEvent(
		planExecutionId: string,
		workspaceId: string,
		event: WorkerTranscriptEvent,
	): Promise<void> {
		// Delegate to PlanStateStore which handles the transcript ndjson file
		this.store.setCurrentPlanExecutionId(planExecutionId);
		await this.store.appendWorkerTranscriptEvent(planExecutionId, workspaceId, event);
	}

	async readWorkerTranscriptEvents(planExecutionId: string, workspaceId: string): Promise<WorkerTranscriptEvent[]> {
		return this.store.readWorkerTranscriptEvents(planExecutionId, workspaceId);
	}

	async emitWorkerStatus(
		planExecutionId: string,
		workspaceId: string,
		status: string,
		message?: string,
	): Promise<void> {
		const event: JournalEvent = {
			type: "worker_status",
			timestamp: Date.now(),
			workspaceId,
			data: sanitizeTranscriptData({ status, message: message ?? undefined }) as Record<string, unknown>,
		};
		await this.appendJournal(planExecutionId, event);
		const transcriptEvent = createWorkerTranscriptEvent(event, buildTranscriptSummary(event));
		if (transcriptEvent) {
			await this.appendWorkerTranscriptEvent(planExecutionId, workspaceId, transcriptEvent);
		}
	}

	async emitWorkerDecisionSummary(
		planExecutionId: string,
		workspaceId: string,
		summary: string,
		verdict: string,
	): Promise<void> {
		const event: JournalEvent = {
			type: "worker_decision_summary",
			timestamp: Date.now(),
			workspaceId,
			data: sanitizeTranscriptData({ summary, verdict }) as Record<string, unknown>,
		};
		await this.appendJournal(planExecutionId, event);
		const transcriptEvent = createWorkerTranscriptEvent(event, buildTranscriptSummary(event));
		if (transcriptEvent) {
			await this.appendWorkerTranscriptEvent(planExecutionId, workspaceId, transcriptEvent);
		}
	}

	async emitValidation(
		planExecutionId: string,
		workspaceId: string,
		criterion: string,
		passed: boolean,
		details?: string,
	): Promise<void> {
		const event: JournalEvent = {
			type: "validation",
			timestamp: Date.now(),
			workspaceId,
			data: sanitizeTranscriptData({ criterion, passed, details: details ?? undefined }) as Record<string, unknown>,
		};
		await this.appendJournal(planExecutionId, event);
		const transcriptEvent = createWorkerTranscriptEvent(event, buildTranscriptSummary(event));
		if (transcriptEvent) {
			await this.appendWorkerTranscriptEvent(planExecutionId, workspaceId, transcriptEvent);
		}
	}

	async emitBlocker(
		planExecutionId: string,
		workspaceId: string,
		reason: string,
		dependencies?: string[],
	): Promise<void> {
		const event: JournalEvent = {
			type: "blocker",
			timestamp: Date.now(),
			workspaceId,
			data: sanitizeTranscriptData({ reason, dependencies: dependencies ?? undefined }) as Record<string, unknown>,
		};
		await this.appendJournal(planExecutionId, event);
		const transcriptEvent = createWorkerTranscriptEvent(event, buildTranscriptSummary(event));
		if (transcriptEvent) {
			await this.appendWorkerTranscriptEvent(planExecutionId, workspaceId, transcriptEvent);
		}
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
			// Write directly instead of temp+rename to avoid race conditions
			// when multiple workers call updateExecutionStatus concurrently.
			await fs.writeFile(filePath, JSON.stringify(executions, null, 2), "utf-8");
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
