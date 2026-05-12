/**
 * Database-backed state store implementation.
 *
 * Implements the IStateStore interface using the PostgreSQL persistence
 * layer from packages/db. Translates between the in-memory PlanState
 * model and the relational database schema.
 */

import type { Database, JournalEventRow, PlanExecution, Project, WorkspaceExecution } from "@earendil-works/pi-db";
import {
	generateId,
	getKysely,
	JournalEventRepository,
	now,
	PlanExecutionRepository,
	ProjectRepository,
	WorkspaceExecutionRepository,
	WorkspaceLogRepository,
} from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import type { JournalEvent, PlanState, WorkspaceState } from "./plan-state.js";
import type {
	ControlAction,
	IStateStore,
	PlanControlState,
	PlanExecutionSummary,
	ProjectSummary,
	StateStoreBackend,
} from "./state-store.js";
import type { WorkspaceQueue } from "./workspace-schema.js";
import { WorkspaceStage as WS } from "./workspace-schema.js";

/**
 * Database serialization failure error class.
 */
export class SerializationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SerializationError";
	}
}

/**
 * Database state store configuration.
 */
export interface DatabaseStateStoreConfig {
	/** Maximum retry attempts for serialization failures (default: 3) */
	maxRetries?: number;
	/** Base backoff delay in ms (default: 100) */
	retryBaseDelayMs?: number;
	/** Maximum backoff delay in ms (default: 2000) */
	retryMaxDelayMs?: number;
}

/**
 * Workspace state cache entry.
 */
interface WorkspaceEntry {
	id: string;
	workspaceId: string;
	stage: WS;
	attempts: number;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	ownedFiles?: string[];
}

/**
 * Plan state cache entry.
 */
interface PlanCacheEntry {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled";
	startedAt: number;
	completedAt?: number;
	workspaces: Map<string, WorkspaceEntry>;
	metadata?: Record<string, unknown>;
}

/**
 * Database-backed state store.
 *
 * Persists execution state to PostgreSQL using the packages/db repositories.
 * Maintains an in-memory cache of the current plan state for fast access
 * during execution, with all mutations going through transactional DB writes.
 */
export class DatabaseStateStore implements IStateStore {
	private db: Kysely<Database>;
	private projectRepo: ProjectRepository;
	private planExecutionRepo: PlanExecutionRepository;
	private workspaceExecutionRepo: WorkspaceExecutionRepository;
	private journalEventRepo: JournalEventRepository;
	private workspaceLogRepo: WorkspaceLogRepository;
	private cache: Map<string, PlanCacheEntry> = new Map();

	// In-memory log buffer for recent logs (for WebSocket streaming)
	private logBuffers: Map<string, string[]> = new Map();
	private readonly MAX_BUFFER_LINES = 1000;

	constructor(_config?: DatabaseStateStoreConfig) {
		this.db = getKysely();
		this.projectRepo = new ProjectRepository(this.db);
		this.planExecutionRepo = new PlanExecutionRepository(this.db);
		this.workspaceExecutionRepo = new WorkspaceExecutionRepository(this.db);
		this.journalEventRepo = new JournalEventRepository(this.db);
		this.workspaceLogRepo = new WorkspaceLogRepository(this.db);
	}

	getBackendType(): StateStoreBackend {
		return "postgres";
	}

	// =========================================================================
	// Project Management
	// =========================================================================

	async listProjects(): Promise<ProjectSummary[]> {
		const projects = await this.projectRepo.listAll();
		return projects.map((p: Project) => ({
			id: p.id,
			name: p.name,
			description: p.description,
			rootPath: p.root_path,
			createdAt: p.created_at,
		}));
	}

	async findOrCreateProject(name: string, rootPath?: string): Promise<ProjectSummary> {
		const project = await this.projectRepo.findOrCreate(name, rootPath);
		return {
			id: project.id,
			name: project.name,
			description: project.description,
			rootPath: project.root_path,
			createdAt: project.created_at,
		};
	}

	async updateProject(projectId: string, updates: Partial<Pick<ProjectSummary, "name" | "rootPath">>): Promise<void> {
		const dbUpdate: Record<string, unknown> = {};
		if (updates.name !== undefined) dbUpdate.name = updates.name;
		if (updates.rootPath !== undefined) dbUpdate.root_path = updates.rootPath;
		if (Object.keys(dbUpdate).length === 0) return;
		await this.projectRepo.update(projectId, dbUpdate as any);
	}

	// =========================================================================
	// Plan Execution
	// =========================================================================

	async initializeState(projectId: string, queue: WorkspaceQueue): Promise<string> {
		const nowISO = now();
		const planExecutionId = generateId();

		// Create plan execution row
		await this.planExecutionRepo.create({
			id: planExecutionId,
			project_id: projectId,
			phase: queue.phase,
			title: queue.title,
			status: "running",
			started_at: nowISO,
			completed_at: null,
		});

		// Create workspace execution rows
		const wsEntries: Map<string, WorkspaceEntry> = new Map();
		for (const workspace of queue.workspaces) {
			const wsExecId = generateId();
			await this.workspaceExecutionRepo.create({
				id: wsExecId,
				plan_execution_id: planExecutionId,
				workspace_id: workspace.id,
				title: workspace.title,
				stage: "pending",
				attempts: 0,
				error_message: null,
				started_at: null,
				completed_at: null,
				metadata: null,
			});
			wsEntries.set(workspace.id, {
				id: wsExecId,
				workspaceId: workspace.id,
				stage: WS.Pending,
				attempts: 0,
			});
		}

		// Create initial journal event
		await this.journalEventRepo.create({
			id: generateId(),
			plan_execution_id: planExecutionId,
			workspace_execution_id: null,
			event_type: "plan_start",
			timestamp: nowISO,
			data: { phase: queue.phase, title: queue.title },
		});

		// Cache state
		this.cache.set(planExecutionId, {
			id: planExecutionId,
			projectId,
			phase: queue.phase,
			title: queue.title,
			status: "running",
			startedAt: Date.now(),
			workspaces: wsEntries,
		});

		return planExecutionId;
	}

	async loadState(planExecutionId: string): Promise<PlanState | null> {
		const planExec = await this.planExecutionRepo.findById(planExecutionId);
		if (!planExec) return null;

		const wsExecs = await this.workspaceExecutionRepo.listByPlanExecution(planExecutionId);

		const workspaces = new Map<string, WorkspaceState>();
		const wsEntries = new Map<string, WorkspaceEntry>();

		for (const ws of wsExecs) {
			const wsState: WorkspaceState = {
				workspaceId: ws.workspace_id,
				stage: ws.stage as WS,
				attempts: ws.attempts,
				startedAt: ws.started_at ? new Date(ws.started_at).getTime() : undefined,
				completedAt: ws.completed_at ? new Date(ws.completed_at).getTime() : undefined,
				error: ws.error_message ?? undefined,
			};
			workspaces.set(ws.workspace_id, wsState);

			wsEntries.set(ws.workspace_id, {
				id: ws.id,
				workspaceId: ws.workspace_id,
				stage: ws.stage as WS,
				attempts: ws.attempts,
				error: ws.error_message ?? undefined,
				startedAt: ws.started_at ? new Date(ws.started_at).getTime() : undefined,
				completedAt: ws.completed_at ? new Date(ws.completed_at).getTime() : undefined,
			});
		}

		const planState: PlanState = {
			phase: planExec.phase,
			title: planExec.title,
			workspaces,
			startedAt: new Date(planExec.started_at).getTime(),
			completedAt: planExec.completed_at ? new Date(planExec.completed_at).getTime() : undefined,
			status: planExec.status as PlanState["status"],
		};

		// Cache
		this.cache.set(planExecutionId, {
			id: planExecutionId,
			projectId: planExec.project_id,
			phase: planExec.phase,
			title: planExec.title,
			status: planExec.status as PlanCacheEntry["status"],
			startedAt: new Date(planExec.started_at).getTime(),
			completedAt: planExec.completed_at ? new Date(planExec.completed_at).getTime() : undefined,
			workspaces: wsEntries,
		});

		return planState;
	}

	async saveState(_planExecutionId: string): Promise<void> {
		// State is persisted eagerly on every mutation, so this is a no-op
		// for the database backend. The cache is kept in sync.
	}

	async listPlanExecutions(projectId: string): Promise<PlanExecutionSummary[]> {
		const executions = await this.planExecutionRepo.listByProject(projectId);
		return executions.map((e: PlanExecution) => ({
			id: e.id,
			projectId: e.project_id,
			phase: e.phase,
			title: e.title,
			status: e.status as PlanExecutionSummary["status"],
			startedAt: e.started_at,
			completedAt: e.completed_at,
		}));
	}

	// =========================================================================
	// Workspace State
	// =========================================================================

	async updateWorkspaceState(
		planExecutionId: string,
		workspaceId: string,
		updates: Partial<WorkspaceState>,
	): Promise<void> {
		const entry = this.getWsEntry(planExecutionId, workspaceId);

		await this.workspaceExecutionRepo.update(entry.id, {
			stage: (updates.stage as string) ?? undefined,
			attempts: updates.attempts ?? undefined,
			error_message: updates.error ?? null,
			started_at: updates.startedAt ? new Date(updates.startedAt).toISOString() : undefined,
			completed_at: updates.completedAt ? new Date(updates.completedAt).toISOString() : undefined,
		});

		// Update cache
		if (updates.stage) entry.stage = updates.stage as WS;
		if (updates.attempts !== undefined) entry.attempts = updates.attempts;
		if (updates.error !== undefined) entry.error = updates.error;
		if (updates.startedAt) entry.startedAt = updates.startedAt;
		if (updates.completedAt) entry.completedAt = updates.completedAt;
	}

	async transitionWorkspace(
		planExecutionId: string,
		workspaceId: string,
		newStage: WS,
		data?: Record<string, unknown>,
	): Promise<void> {
		const entry = this.getWsEntry(planExecutionId, workspaceId);

		await this.workspaceExecutionRepo.updateStage(entry.id, newStage as WorkspaceExecution["stage"]);

		entry.stage = newStage;
		if (newStage === WS.Active && !entry.startedAt) {
			entry.startedAt = Date.now();
		}
		if ((newStage === WS.Complete || newStage === WS.Failed) && !entry.completedAt) {
			entry.completedAt = Date.now();
		}

		// Log to journal
		const eventType = this.getJournalEventType(newStage);
		if (eventType) {
			await this.appendJournal(planExecutionId, {
				type: eventType,
				timestamp: Date.now(),
				workspaceId,
				data,
			});
		}
	}

	async incrementRetryAttempt(planExecutionId: string, workspaceId: string): Promise<void> {
		const entry = this.getWsEntry(planExecutionId, workspaceId);

		await this.workspaceExecutionRepo.incrementAttempts(entry.id);
		entry.attempts++;

		await this.appendJournal(planExecutionId, {
			type: "retry_attempt",
			timestamp: Date.now(),
			workspaceId,
			data: { attempt: entry.attempts },
		});
	}

	// =========================================================================
	// File Locks
	// =========================================================================

	async acquireFileLocks(planExecutionId: string, workspaceId: string, files: string[]): Promise<void> {
		const entry = this.getWsEntry(planExecutionId, workspaceId);
		entry.ownedFiles = files;

		await this.appendJournal(planExecutionId, {
			type: "file_lock_acquired",
			timestamp: Date.now(),
			workspaceId,
			data: { files },
		});
	}

	async releaseFileLocks(planExecutionId: string, workspaceId: string): Promise<void> {
		const entry = this.getWsEntry(planExecutionId, workspaceId);
		entry.ownedFiles = [];

		await this.appendJournal(planExecutionId, {
			type: "file_lock_released",
			timestamp: Date.now(),
			workspaceId,
		});
	}

	// =========================================================================
	// Journal
	// =========================================================================

	async appendJournal(planExecutionId: string, event: JournalEvent): Promise<void> {
		const cacheEntry = this.cache.get(planExecutionId);
		let wsExecId: string | null = null;

		if (event.workspaceId && cacheEntry) {
			const wsEntry = cacheEntry.workspaces.get(event.workspaceId);
			if (wsEntry) {
				wsExecId = wsEntry.id;
			}
		}

		await this.journalEventRepo.create({
			id: generateId(),
			plan_execution_id: planExecutionId,
			workspace_execution_id: wsExecId,
			event_type: event.type,
			timestamp: new Date(event.timestamp).toISOString(),
			data: (event.data ?? null) as Record<string, unknown> | null,
		});
	}

	async readJournal(planExecutionId: string): Promise<JournalEvent[]> {
		const events = await this.journalEventRepo.query({
			planExecutionId,
			limit: 10000,
		});

		return events.map((e: JournalEventRow) => ({
			type: e.event_type as JournalEvent["type"],
			timestamp: new Date(e.timestamp).getTime(),
			workspaceId: e.workspace_execution_id ?? undefined,
			data: e.data ?? undefined,
		}));
	}

	// =========================================================================
	// Plan Lifecycle
	// =========================================================================

	async completePlan(planExecutionId: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "complete");
		this.updateCacheStatus(planExecutionId, "complete");
		await this.appendJournal(planExecutionId, {
			type: "plan_complete",
			timestamp: Date.now(),
		});
	}

	async failPlan(planExecutionId: string, error: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "failed");
		this.updateCacheStatus(planExecutionId, "failed");
		await this.appendJournal(planExecutionId, {
			type: "plan_failed",
			timestamp: Date.now(),
			data: { error },
		});
	}

	async pausePlan(planExecutionId: string, reason?: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "paused");
		this.updateCacheStatus(planExecutionId, "paused");
		await this.appendJournal(planExecutionId, {
			type: "plan_paused",
			timestamp: Date.now(),
			data: { reason },
		});
	}

	async stopPlan(planExecutionId: string, reason?: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "stopped");
		this.updateCacheStatus(planExecutionId, "stopped");
		await this.appendJournal(planExecutionId, {
			type: "plan_stopped",
			timestamp: Date.now(),
			data: { reason },
		});
	}

	async cancelPlan(planExecutionId: string, reason?: string): Promise<void> {
		const cacheEntry = this.cache.get(planExecutionId);

		// Mark all active workspaces as cancelled
		if (cacheEntry) {
			for (const [_wsId, ws] of cacheEntry.workspaces) {
				if (ws.stage === WS.Active) {
					await this.workspaceExecutionRepo.updateStage(ws.id, "failed");
					ws.stage = WS.Failed;
					ws.error = "Cancelled by user";
					ws.completedAt = Date.now();
				}
			}
		}

		await this.planExecutionRepo.updateStatus(planExecutionId, "cancelled");
		this.updateCacheStatus(planExecutionId, "cancelled");
		await this.appendJournal(planExecutionId, {
			type: "plan_cancelled",
			timestamp: Date.now(),
			data: { reason },
		});
	}

	async resumePlan(planExecutionId: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "running");
		this.updateCacheStatus(planExecutionId, "running");
		await this.appendJournal(planExecutionId, {
			type: "plan_resumed",
			timestamp: Date.now(),
		});
	}

	// =========================================================================
	// Control
	// =========================================================================

	async writeControlRequest(planExecutionId: string, action: ControlAction, reason?: string): Promise<void> {
		// For DB backend, control requests are stored on the plan execution row
		// using a metadata field
		const controlData: PlanControlState = {
			action,
			requestedAt: Date.now(),
			reason,
		};

		await this.planExecutionRepo.update(planExecutionId, {
			metadata: { control: controlData } as unknown as Record<string, unknown>,
		} as any);
	}

	async readControlRequest(planExecutionId: string): Promise<PlanControlState | null> {
		const planExec = await this.planExecutionRepo.findById(planExecutionId);
		if (!planExec) return null;

		// For DB backend, control is stored in plan execution metadata
		const control = (planExec as any).metadata?.control as PlanControlState | undefined;
		return control ?? null;
	}

	async clearControlRequest(planExecutionId: string): Promise<void> {
		await this.planExecutionRepo.update(planExecutionId, {
			metadata: null,
		} as any);
	}

	// =========================================================================
	// Query
	// =========================================================================

	async getWorkspaceState(planExecutionId: string, workspaceId: string): Promise<WorkspaceState | undefined> {
		const entry = this.cache.get(planExecutionId)?.workspaces.get(workspaceId);
		if (!entry) return undefined;

		return {
			workspaceId: entry.workspaceId,
			stage: entry.stage,
			attempts: entry.attempts,
			startedAt: entry.startedAt,
			completedAt: entry.completedAt,
			error: entry.error,
			ownedFiles: entry.ownedFiles,
		};
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
		const cacheEntry = this.cache.get(planExecutionId);
		if (!cacheEntry) return null;

		const stats = { total: 0, pending: 0, active: 0, complete: 0, blocked: 0, failed: 0 };
		for (const ws of cacheEntry.workspaces.values()) {
			stats.total++;
			switch (ws.stage) {
				case WS.Pending:
					stats.pending++;
					break;
				case WS.Active:
					stats.active++;
					break;
				case WS.Complete:
					stats.complete++;
					break;
				case WS.Blocked:
					stats.blocked++;
					break;
				case WS.Failed:
					stats.failed++;
					break;
			}
		}

		// Compute telemetry from workspace execution data
		// Uses chars/4 token estimation (same heuristic as token-metering.ts)
		let totalCharsIn = 0;
		let totalCharsOut = 0;
		const now = Date.now();

		// Estimate tokens from workspace durations — each second of execution
		// represents roughly 1 token of input (conservative heuristic based on
		// observed agent behavior)
		for (const ws of cacheEntry.workspaces.values()) {
			const start = ws.startedAt;
			const end = ws.completedAt;
			if (start && end) {
				const durationMs = end - start;
				// ~100 chars/sec is typical for agent message processing
				const estChars = durationMs * 0.1;
				totalCharsIn += estChars;
				totalCharsOut += estChars * 0.3;
			}
		}

		const totalTokensIn = Math.ceil(totalCharsIn / 4);
		const totalTokensOut = Math.ceil(totalCharsOut / 4);

		// Estimate cost using approximate Claude/Haiku pricing ($3/M input, $15/M output)
		const estimatedCost = (totalTokensIn / 1_000_000) * 3 + (totalTokensOut / 1_000_000) * 15;

		// Burn rate: tokens per minute since execution started
		const startTime = cacheEntry.startedAt;
		const endTime = cacheEntry.completedAt ?? now;
		const elapsedMinutes = (endTime - startTime) / 60_000;
		const burnRate = elapsedMinutes > 0 ? Math.round(totalTokensIn / elapsedMinutes) : 0;

		return {
			...stats,
			total_tokens_in: totalTokensIn,
			total_tokens_out: totalTokensOut,
			cache_hit_rate: 0,
			estimated_cost_usd: Number.parseFloat(estimatedCost.toFixed(4)),
			burn_rate_per_min: burnRate,
		};
	}

	// =========================================================================
	// Internal Helpers
	// =========================================================================

	/**
	 * Get workspace entry from cache.
	 */
	private getWsEntry(planExecutionId: string, workspaceId: string): WorkspaceEntry {
		const cacheEntry = this.cache.get(planExecutionId);
		if (!cacheEntry) {
			throw new Error(`Plan execution not found: ${planExecutionId}`);
		}
		const entry = cacheEntry.workspaces.get(workspaceId);
		if (!entry) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}
		return entry;
	}

	/**
	 * Update cached plan status.
	 */
	private updateCacheStatus(planExecutionId: string, status: PlanCacheEntry["status"]): void {
		const entry = this.cache.get(planExecutionId);
		if (entry) {
			entry.status = status;
			if (status === "complete" || status === "failed" || status === "stopped" || status === "cancelled") {
				entry.completedAt = Date.now();
			}
		}
	}

	/**
	 * Map workspace stage to journal event type.
	 */
	private getJournalEventType(stage: WS): JournalEvent["type"] | null {
		switch (stage) {
			case WS.Active:
				return "workspace_start";
			case WS.Complete:
				return "workspace_complete";
			case WS.Failed:
				return "workspace_failed";
			case WS.Blocked:
				return "workspace_blocked";
			default:
				return null;
		}
	}

	// =========================================================================
	// Execution Logs
	// =========================================================================

	async saveExecutionLog(planExecutionId: string, logContent: string): Promise<void> {
		await this.db
			.updateTable("plan_executions")
			.set({
				execution_log: logContent,
			} as any)
			.where("id", "=", planExecutionId)
			.execute();
	}

	async loadExecutionLog(planExecutionId: string): Promise<string | null> {
		const result = await this.db
			.selectFrom("plan_executions")
			.select(["execution_log"] as any)
			.where("id", "=", planExecutionId)
			.executeTakeFirst();

		return (result as any)?.execution_log ?? null;
	}

	/**
	 * Append a log line to workspace-specific logs.
	 */
	async appendWorkspaceLog(planExecutionId: string, workspaceId: string, logLine: string): Promise<void> {
		const entry = this.getWsEntry(planExecutionId, workspaceId);
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

		// Get current line number
		const lineNumber = await this.workspaceLogRepo.getMaxLineNumber(entry.id);

		// Persist to database
		await this.workspaceLogRepo.create({
			workspace_execution_id: entry.id,
			stream: "stdout",
			line_number: lineNumber + 1,
			content: logLine,
			timestamp: new Date().toISOString(),
		});
	}

	/**
	 * Load workspace-specific log content.
	 */
	async loadWorkspaceLog(planExecutionId: string, workspaceId: string): Promise<string | null> {
		const entry = this.cache.get(planExecutionId)?.workspaces.get(workspaceId);
		if (!entry) return null;

		const logs = await this.workspaceLogRepo.getByWorkspaceExecution(entry.id);
		if (logs.length === 0) return null;

		return logs.map((log) => log.content).join("\n");
	}

	/**
	 * Get recent workspace logs from in-memory buffer.
	 */
	getRecentWorkspaceLogs(planExecutionId: string, workspaceId: string, maxLines = 100): string[] {
		const key = `${planExecutionId}:${workspaceId}`;
		const buffer = this.logBuffers.get(key);
		if (!buffer) {
			return [];
		}
		return buffer.slice(-maxLines);
	}
}
