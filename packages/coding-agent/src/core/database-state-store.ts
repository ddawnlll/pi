/**
 * Database-backed state store implementation.
 *
 * Implements the IStateStore interface using the PostgreSQL persistence
 * layer from packages/db. Translates between the in-memory PlanState
 * model and the relational database schema.
 *
 * Architecture:
 * - State is cached in-memory (PlanCacheEntry) for fast access
 * - All mutations write through to DB immediately
 * - Transcript events go to transcript_events table (not in-memory)
 * - Control requests go to control_requests table (not metadata hack)
 * - Cache is evicted when plan completes/fails/is cancelled
 * - saveState() is NOT a no-op — it flushes the cache to DB
 */

import type {
	Database,
	JournalEventRow,
	PlanExecution,
	Project,
	TranscriptEvent,
	WorkspaceExecution,
} from "@earendil-works/pi-db";
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
import { createGitRunner } from "@earendil-works/pi-execution-service";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import type { JournalEvent, PlanState, WorkspaceState } from "./plan-state.js";
import { buildTranscriptSummary, createWorkerTranscriptEvent } from "./plan-state.js";
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
	projectId: string;
	stage: WS;
	attempts: number;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	ownedFiles?: string[];
	contextUsed?: number;
}

/**
 * Plan state cache entry.
 */
interface PlanCacheEntry {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled" | "awaiting_handoff";
	startedAt: number;
	completedAt?: number;
	handoffStartedAt?: number;
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

	// Transcript sequence counter per workspace execution
	private transcriptSequences: Map<string, number> = new Map();

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

	async deleteProject(projectId: string): Promise<void> {
		await this.projectRepo.delete(projectId);
	}

	// =========================================================================
	// Plan Execution
	// =========================================================================

	async initializeState(projectId: string, queue: WorkspaceQueue): Promise<string> {
		const nowISO = now();
		const planExecutionId = generateId();
		const wsEntries: Map<string, WorkspaceEntry> = new Map();

		// Wrap multi-table initialization in a transaction to ensure atomicity.
		// If the process crashes or any step fails, all changes are rolled back.
		await this.db.transaction().execute(async (trx: Transaction<Database>) => {
			// Create plan execution row
			await trx
				.insertInto("plan_executions")
				.values({
					id: planExecutionId,
					project_id: projectId,
					phase: queue.phase,
					title: queue.title,
					status: "running",
					started_at: nowISO,
					completed_at: null,
				})
				.execute();

			// Create workspace execution rows with denorm project_id
			for (const workspace of queue.workspaces) {
				const wsExecId = generateId();
				await trx
					.insertInto("workspace_executions")
					.values({
						id: wsExecId,
						plan_execution_id: planExecutionId,
						project_id: projectId,
						workspace_id: workspace.id,
						title: workspace.title,
						stage: "pending",
						attempts: 0,
						error_message: null,
						started_at: null,
						completed_at: null,
						metadata: null,
					})
					.execute();

				wsEntries.set(workspace.id, {
					id: wsExecId,
					projectId,
					workspaceId: workspace.id,
					stage: WS.Pending,
					attempts: 0,
				});
			}

			// Create initial journal event with denorm project_id
			await trx
				.insertInto("journal_events")
				.values({
					id: generateId(),
					plan_execution_id: planExecutionId,
					project_id: projectId,
					workspace_execution_id: null,
					event_type: "plan_start",
					timestamp: nowISO,
					data: { phase: queue.phase, title: queue.title },
				})
				.execute();
		});

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
			// Extract contextUsed from metadata JSONB
			let contextUsed: number | undefined;
			if (ws.metadata && typeof ws.metadata === "object" && "contextUsed" in ws.metadata) {
				contextUsed = (ws.metadata as Record<string, unknown>).contextUsed as number | undefined;
			}

			const wsState: WorkspaceState = {
				workspaceId: ws.workspace_id,
				stage: ws.stage as WS,
				attempts: ws.attempts,
				startedAt: ws.started_at ? new Date(ws.started_at).getTime() : undefined,
				completedAt: ws.completed_at ? new Date(ws.completed_at).getTime() : undefined,
				error: ws.error_message ?? undefined,
				contextUsed,
			};
			workspaces.set(ws.workspace_id, wsState);

			wsEntries.set(ws.workspace_id, {
				id: ws.id,
				projectId: planExec.project_id,
				workspaceId: ws.workspace_id,
				stage: ws.stage as WS,
				attempts: ws.attempts,
				error: ws.error_message ?? undefined,
				startedAt: ws.started_at ? new Date(ws.started_at).getTime() : undefined,
				completedAt: ws.completed_at ? new Date(ws.completed_at).getTime() : undefined,
				contextUsed,
			});
		}

		const planState: PlanState = {
			phase: planExec.phase,
			title: planExec.title,
			workspaces,
			startedAt: new Date(planExec.started_at).getTime(),
			completedAt: planExec.completed_at ? new Date(planExec.completed_at).getTime() : undefined,
			status: planExec.status as PlanState["status"],
			handoffStartedAt: planExec.handoff_started_at ? new Date(planExec.handoff_started_at).getTime() : undefined,
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
			handoffStartedAt: planExec.handoff_started_at ? new Date(planExec.handoff_started_at).getTime() : undefined,
			workspaces: wsEntries,
		});

		return planState;
	}

	async saveState(planExecutionId: string): Promise<void> {
		// Flush cache to DB: this ensures all in-memory workspace state
		// transitions are persisted even if they haven't gone through
		// the normal mutation path.
		const cacheEntry = this.cache.get(planExecutionId);
		if (!cacheEntry) return;

		// Also sync the plan execution row to ensure consistency
		const planUpdate: Record<string, unknown> = {
			status: cacheEntry.status,
		};

		// Set completed_at for terminal states
		if (cacheEntry.completedAt) {
			planUpdate.completed_at = new Date(cacheEntry.completedAt).toISOString();
		}

		// Set handoff_started_at for awaiting_handoff state
		if (cacheEntry.status === "awaiting_handoff" && cacheEntry.handoffStartedAt) {
			planUpdate.handoff_started_at = new Date(cacheEntry.handoffStartedAt).toISOString();
		}

		await this.planExecutionRepo.update(planExecutionId, planUpdate as any);

		// Update workspace execution rows
		for (const ws of cacheEntry.workspaces.values()) {
			await this.workspaceExecutionRepo.update(ws.id, {
				stage: ws.stage,
				attempts: ws.attempts ?? undefined,
				error_message: ws.error ?? null,
				started_at: ws.startedAt ? new Date(ws.startedAt).toISOString() : null,
				completed_at: ws.completedAt ? new Date(ws.completedAt).toISOString() : null,
			});
		}
	}

	async listPlanExecutions(projectId: string): Promise<PlanExecutionSummary[]> {
		const executions = await this.planExecutionRepo.listByProject(projectId);
		return executions.map((e: PlanExecution) => {
			// Extract lock metadata from execution_log JSON
			let planLockHash: string | undefined;
			let planSpecVersion: string | undefined;
			let lockStatus: PlanExecutionSummary["lockStatus"] | undefined;
			if (e.execution_log) {
				try {
					const logData = JSON.parse(e.execution_log);
					planLockHash = logData.planLockHash as string | undefined;
					planSpecVersion = logData.planSpecVersion as string | undefined;
					lockStatus = logData.lockStatus as PlanExecutionSummary["lockStatus"];
				} catch {
					// Not valid JSON-structured log
				}
			}
			return {
				id: e.id,
				projectId: e.project_id,
				phase: e.phase,
				title: e.title,
				status: e.status as PlanExecutionSummary["status"],
				startedAt: e.started_at,
				completedAt: e.completed_at,
				planLockHash,
				planSpecVersion,
				lockStatus,
			};
		});
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

		const dbUpdates: Record<string, unknown> = {};
		if (updates.stage) dbUpdates.stage = updates.stage;
		if (updates.attempts !== undefined) dbUpdates.attempts = updates.attempts;
		if (updates.error !== undefined) dbUpdates.error_message = updates.error ?? null;
		if (updates.startedAt) dbUpdates.started_at = new Date(updates.startedAt).toISOString();
		if (updates.completedAt) dbUpdates.completed_at = new Date(updates.completedAt).toISOString();

		// Persist contextUsed in metadata JSONB so web server doesn't read log files
		if (updates.contextUsed !== undefined) {
			const existingMeta = (entry as any)._metadata || {};
			dbUpdates.metadata = { ...existingMeta, contextUsed: updates.contextUsed };
		}

		await this.workspaceExecutionRepo.update(entry.id, dbUpdates);

		// Update cache
		if (updates.stage) entry.stage = updates.stage as WS;
		if (updates.attempts !== undefined) entry.attempts = updates.attempts;
		if (updates.error !== undefined) entry.error = updates.error;
		if (updates.startedAt) entry.startedAt = updates.startedAt;
		if (updates.completedAt) entry.completedAt = updates.completedAt;
		if (updates.contextUsed !== undefined) {
			entry.contextUsed = updates.contextUsed;
			(entry as any)._metadata = ((entry as any)._metadata || {}) as Record<string, unknown>;
			((entry as any)._metadata as Record<string, unknown>).contextUsed = updates.contextUsed;
		}
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
		const newAttempt = entry.attempts + 1;
		entry.attempts = newAttempt;

		// Only emit retry_attempt for actual retries (attempt > 1 in 1-based).
		// Attempt 1 is the initial execution, not a retry.
		// See Finding 3 in P25 audit.
		if (newAttempt > 1) {
			await this.appendJournal(planExecutionId, {
				type: "retry_attempt",
				timestamp: Date.now(),
				workspaceId,
				data: { attempt: newAttempt },
			});
		}
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
	// Journal (with denorm project_id)
	// =========================================================================

	async appendJournal(planExecutionId: string, event: JournalEvent): Promise<void> {
		const cacheEntry = this.cache.get(planExecutionId);
		let wsExecId: string | null = null;
		const projectId: string | null = cacheEntry?.projectId ?? null;

		if (event.workspaceId && cacheEntry) {
			const wsEntry = cacheEntry.workspaces.get(event.workspaceId);
			if (wsEntry) {
				wsExecId = wsEntry.id;
			}
		}

		await this.journalEventRepo.create({
			id: generateId(),
			plan_execution_id: planExecutionId,
			project_id: projectId,
			workspace_execution_id: wsExecId,
			event_type: event.type,
			timestamp: new Date(event.timestamp).toISOString(),
			data: (event.data ?? null) as Record<string, unknown> | null,
		});
	}

	async appendJournalEvent(
		planExecutionId: string,
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

		await this.appendJournal(planExecutionId, {
			type: "tool_call",
			timestamp: Date.now(),
			data,
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
		this.evictCache(planExecutionId);
		await this.appendJournal(planExecutionId, {
			type: "plan_complete",
			timestamp: Date.now(),
		});
	}

	async failPlan(planExecutionId: string, error: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "failed");
		this.updateCacheStatus(planExecutionId, "failed");
		this.evictCache(planExecutionId);
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
		this.evictCache(planExecutionId);
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
		this.evictCache(planExecutionId);
		await this.appendJournal(planExecutionId, {
			type: "plan_cancelled",
			timestamp: Date.now(),
			data: { reason },
		});
	}

	async updatePlanLockMetadata(
		planExecutionId: string,
		metadata: {
			planLockHash: string;
			planSpecVersion: string;
			lockStatus: "admitted" | "pending" | "rejected";
		},
	): Promise<void> {
		// Store lock metadata as structured JSON in execution_log for DB backend.
		// The JSON state store uses a dedicated tracking file.
		const existingLog = (await this.planExecutionRepo.findById(planExecutionId))?.execution_log;
		let logData: Record<string, unknown> = {};
		try {
			if (existingLog) logData = JSON.parse(existingLog);
		} catch {
			// Not valid JSON, start fresh
		}
		logData.planLockHash = metadata.planLockHash;
		logData.planSpecVersion = metadata.planSpecVersion;
		logData.lockStatus = metadata.lockStatus;
		await this.planExecutionRepo.update(planExecutionId, {
			execution_log: JSON.stringify(logData),
		});
	}

	async resumePlan(planExecutionId: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "running");
		this.updateCacheStatus(planExecutionId, "running");

		// Reload state to ensure workspace cache is synchronized with DB
		// This handles cases where workspaces were in various states when paused
		await this.loadState(planExecutionId);

		await this.appendJournal(planExecutionId, {
			type: "plan_resumed",
			timestamp: Date.now(),
		});
	}

	async setAwaitingHandoff(planExecutionId: string, planTitle: string): Promise<void> {
		await this.db
			.updateTable("plan_executions")
			.set({ status: "awaiting_handoff", handoff_started_at: sql`now()` })
			.where("id", "=", planExecutionId)
			.execute();
		this.updateCacheStatus(planExecutionId, "awaiting_handoff");
		await this.appendJournal(planExecutionId, {
			type: "plan_handoff",
			timestamp: Date.now(),
			data: { title: planTitle },
		});
	}

	async handoffCommit(planExecutionId: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "complete");
		this.updateCacheStatus(planExecutionId, "complete");
		this.evictCache(planExecutionId);
		await this.appendJournal(planExecutionId, {
			type: "plan_handoff_committed",
			timestamp: Date.now(),
		});
	}

	async handoffKeepEditing(planExecutionId: string): Promise<void> {
		await this.planExecutionRepo.updateStatus(planExecutionId, "running");
		this.updateCacheStatus(planExecutionId, "running");
		await this.appendJournal(planExecutionId, {
			type: "plan_handoff_keep",
			timestamp: Date.now(),
		});
	}

	async handoffDiscard(planExecutionId: string, workspaceRoot: string): Promise<void> {
		// Revert uncommitted workspace files via git
		try {
			const runner = createGitRunner({
				planExecId: planExecutionId,
				workspaceId: "",
				leaseId: "",
				cwd: workspaceRoot,
			});
			await runner.checkoutAll(workspaceRoot);
		} catch {
			// Ignore errors during revert
		}

		await this.planExecutionRepo.updateStatus(planExecutionId, "failed");
		this.updateCacheStatus(planExecutionId, "failed");
		this.evictCache(planExecutionId);
		await this.appendJournal(planExecutionId, {
			type: "plan_handoff_discard",
			timestamp: Date.now(),
			data: { error: "User discarded changes during handoff" },
		});
	}

	async isAwaitingHandoff(planExecutionId: string): Promise<boolean> {
		const entry = this.cache.get(planExecutionId);
		if (entry) return entry.status === "awaiting_handoff";

		// Cache miss — read from DB
		const planExec = await this.planExecutionRepo.findById(planExecutionId);
		return planExec?.status === "awaiting_handoff";
	}

	async getHandoffStartedAt(planExecutionId: string): Promise<number> {
		const entry = this.cache.get(planExecutionId);
		if (entry?.handoffStartedAt) return entry.handoffStartedAt;

		// Cache miss — read from DB
		const planExec = await this.planExecutionRepo.findById(planExecutionId);
		if (planExec?.handoff_started_at) {
			return new Date(planExec.handoff_started_at).getTime();
		}
		return 0;
	}

	// =========================================================================
	// Control (using control_requests table)
	// =========================================================================

	async writeControlRequest(planExecutionId: string, action: ControlAction, reason?: string): Promise<void> {
		// Look up project_id from cache or DB
		let projectId: string | null = this.cache.get(planExecutionId)?.projectId ?? null;
		if (!projectId) {
			const planExec = await this.planExecutionRepo.findById(planExecutionId);
			projectId = planExec?.project_id ?? null;
		}

		// Acknowledge any prior unacknowledged request
		await this.db
			.updateTable("control_requests")
			.set({ acknowledged: true, acknowledged_at: sql`now()` })
			.where("plan_execution_id", "=", planExecutionId)
			.where("acknowledged", "=", false)
			.execute();

		// Insert new control request (project_id is NOT NULL)
		if (!projectId) {
			throw new Error(`Cannot write control request: no project_id for execution ${planExecutionId}`);
		}
		const pid = projectId as string;
		await this.db
			.insertInto("control_requests")
			.values({
				id: generateId(),
				plan_execution_id: planExecutionId,
				project_id: pid,
				type: action,
				reason: reason ?? null,
				requested_at: sql`now()`,
				acknowledged: false,
				acknowledged_at: null,
			})
			.execute();
	}

	async readControlRequest(planExecutionId: string): Promise<PlanControlState | null> {
		const row = await this.db
			.selectFrom("control_requests")
			.selectAll()
			.where("plan_execution_id", "=", planExecutionId)
			.where("acknowledged", "=", false)
			.orderBy("requested_at", "desc")
			.limit(1)
			.executeTakeFirst();

		if (!row) return null;

		return {
			action: row.type as ControlAction,
			requestedAt: new Date(row.requested_at).getTime(),
			reason: row.reason ?? undefined,
			planExecutionId: row.plan_execution_id,
		};
	}

	async clearControlRequest(planExecutionId: string): Promise<void> {
		await this.db
			.updateTable("control_requests")
			.set({ acknowledged: true, acknowledged_at: sql`now()` })
			.where("plan_execution_id", "=", planExecutionId)
			.where("acknowledged", "=", false)
			.execute();
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
			contextUsed: entry.contextUsed,
		};
	}

	async getWorkspaceAttempts(
		planExecutionId: string,
		workspaceId: string,
	): Promise<import("./state-store.js").WorkspaceAttempt[]> {
		const entry = this.cache.get(planExecutionId)?.workspaces.get(workspaceId);
		if (!entry) return [];

		const getRole = (attempt: number): "worker" | "flash" | "reviewer" | "final" => {
			if (attempt <= 3) return "worker";
			if (attempt <= 6) return "flash";
			if (attempt <= 9) return "reviewer";
			return "final";
		};

		const total = entry.attempts;
		const attempts: import("./state-store.js").WorkspaceAttempt[] = [];

		for (let a = 1; a <= total; a++) {
			const isLast = a === total;
			const verdict = isLast
				? entry.stage === "complete"
					? ("complete" as const)
					: entry.stage === "failed"
						? ("failed" as const)
						: ("running" as const)
				: ("failed" as const);

			const startedAt = entry.startedAt ?? null;
			const completedAt = entry.completedAt ?? null;
			const duration = startedAt && completedAt ? completedAt - startedAt : null;

			attempts.push({
				attempt: a,
				role: getRole(a),
				startedAt,
				completedAt,
				duration,
				verdict,
				error: isLast ? (entry.error?.slice(0, 200) ?? null) : null,
			});
		}

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
		// Try cache first for fast path
		let cacheEntry = this.cache.get(planExecutionId);

		// If cache miss, load state from DB (handles post-completion stats queries)
		if (!cacheEntry) {
			try {
				await this.loadState(planExecutionId);
				cacheEntry = this.cache.get(planExecutionId);
			} catch {
				// Failed to load from DB
			}
		}

		if (!cacheEntry) {
			// Last resort: query DB directly for workspace stats
			try {
				const stats = await this.workspaceExecutionRepo.getStats(planExecutionId);
				return {
					...stats,
					total_tokens_in: undefined,
					total_tokens_out: undefined,
					cache_hit_rate: 0,
					cache_hit_rate_known: false,
					estimated_cost_usd: undefined,
					burn_rate_per_min: undefined,
					tokens_per_workspace: undefined,
					tokens_per_percent: undefined,
				};
			} catch {
				return null;
			}
		}

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
		let totalCharsIn = 0;
		let totalCharsOut = 0;
		const now = Date.now();

		// Estimate tokens from workspace durations
		for (const ws of cacheEntry.workspaces.values()) {
			const start = ws.startedAt;
			const end = ws.completedAt;
			if (start && end) {
				const durationMs = end - start;
				const estChars = durationMs * 0.1;
				totalCharsIn += estChars;
				totalCharsOut += estChars * 0.3;
			}
		}

		const totalTokensIn = Math.ceil(totalCharsIn / 4);
		const totalTokensOut = Math.ceil(totalCharsOut / 4);

		const estimatedCost = (totalTokensIn / 1_000_000) * 3 + (totalTokensOut / 1_000_000) * 15;

		const startTime = cacheEntry.startedAt;
		const endTime = cacheEntry.completedAt ?? now;
		const elapsedMinutes = (endTime - startTime) / 60_000;
		const burnRate = elapsedMinutes > 0 ? Math.round(totalTokensIn / elapsedMinutes) : 0;

		const tokensPerWorkspace = stats.complete > 0 ? Math.round(totalTokensIn / stats.complete) : undefined;
		const progressPct = stats.total > 0 ? (stats.complete / stats.total) * 100 : 0;
		const tokensPerPercent = progressPct > 0 ? Math.round(totalTokensIn / progressPct) : undefined;

		// Compute cache hit rate from cache_usage journal events if available
		let cacheHitRate: number | undefined;
		let cacheHitRateKnown = false;
		try {
			const cacheEvents = await this.journalEventRepo.query({
				planExecutionId,
				eventTypes: ["cache_usage"],
			});
			let totalCacheRead = 0;
			let totalInput = 0;
			for (const entry of cacheEvents) {
				const data =
					typeof entry.data === "string"
						? JSON.parse(entry.data)
						: ((entry.data as Record<string, unknown>) ?? {});
				totalCacheRead += Number(data.cacheRead ?? 0);
				totalInput += Number(data.input ?? 0);
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
			if (status === "awaiting_handoff") {
				entry.handoffStartedAt = Date.now();
			}
		}
	}

	/**
	 * Evict cache entry when plan is terminal.
	 */
	private evictCache(planExecutionId: string): void {
		this.cache.delete(planExecutionId);
		// Clean up transcript sequences too
		for (const key of this.transcriptSequences.keys()) {
			if (key.startsWith(planExecutionId)) {
				this.transcriptSequences.delete(key);
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
	// Execution Logs (no `as any` casts)
	// =========================================================================

	async saveExecutionLog(planExecutionId: string, logContent: string): Promise<void> {
		await this.db
			.updateTable("plan_executions")
			// Use SQL concat to append to existing log
			.set({
				execution_log: sql`COALESCE(execution_log, '') || ${logContent}`,
			})
			.where("id", "=", planExecutionId)
			.execute();
	}

	async loadExecutionLog(planExecutionId: string): Promise<string | null> {
		const result = await this.db
			.selectFrom("plan_executions")
			.select("execution_log")
			.where("id", "=", planExecutionId)
			.executeTakeFirst();

		return result?.execution_log ?? null;
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

		// Persist to database with denorm columns
		await this.workspaceLogRepo.create({
			workspace_execution_id: entry.id,
			project_id: entry.projectId,
			plan_execution_id: planExecutionId,
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

	// =========================================================================
	// Worker Transcript (persisted to transcript_events table)
	// =========================================================================

	async appendWorkerTranscriptEvent(
		planExecutionId: string,
		workspaceId: string,
		event: import("./plan-state.js").WorkerTranscriptEvent,
	): Promise<void> {
		const cacheEntry = this.cache.get(planExecutionId);
		const wsEntry = cacheEntry?.workspaces.get(workspaceId);
		if (!wsEntry) return;

		// Get next sequence number
		const seqKey = `${planExecutionId}:${workspaceId}`;
		const seq = (this.transcriptSequences.get(seqKey) ?? 0) + 1;
		this.transcriptSequences.set(seqKey, seq);

		await this.db
			.insertInto("transcript_events")
			.values({
				id: generateId(),
				workspace_execution_id: wsEntry.id,
				plan_execution_id: planExecutionId,
				project_id: wsEntry.projectId,
				role: "assistant",
				content: event.summary ?? "",
				token_count: null,
				metadata: event as unknown as Record<string, unknown>,
				sequence: seq,
				timestamp: new Date(event.timestamp).toISOString(),
			})
			.execute();
	}

	async getWorkspaceIdsWithTranscript(planExecutionId: string): Promise<string[]> {
		const rows = await this.db
			.selectFrom("transcript_events")
			.select("workspace_execution_id")
			.where("plan_execution_id", "=", planExecutionId)
			.distinct()
			.execute();

		const wsExecIds = new Set(rows.map((r) => r.workspace_execution_id));
		const cacheEntry = this.cache.get(planExecutionId);
		if (!cacheEntry) return [];

		const result: string[] = [];
		for (const [wsId, ws] of cacheEntry.workspaces) {
			if (wsExecIds.has(ws.id)) {
				result.push(wsId);
			}
		}
		return result;
	}

	async readWorkerTranscriptEvents(
		planExecutionId: string,
		workspaceId: string,
	): Promise<import("./plan-state.js").WorkerTranscriptEvent[]> {
		const wsEntry = this.cache.get(planExecutionId)?.workspaces.get(workspaceId);
		if (!wsEntry) return [];

		const rows = await this.db
			.selectFrom("transcript_events")
			.selectAll()
			.where("workspace_execution_id", "=", wsEntry.id)
			.orderBy("sequence", "asc")
			.execute();

		return rows.map((r: TranscriptEvent) => {
			// Try to reconstruct from stored metadata first
			if (r.metadata && typeof r.metadata === "object" && "type" in r.metadata && "summary" in r.metadata) {
				const stored = r.metadata as unknown as import("./plan-state.js").WorkerTranscriptEvent;
				return {
					...stored,
					timestamp: new Date(r.timestamp).getTime(),
				};
			}
			// Fallback: reconstruct from row columns
			return {
				type: "worker_status" as import("./plan-state.js").WorkerTranscriptEventType,
				timestamp: new Date(r.timestamp).getTime(),
				workspaceId,
				summary: r.content,
			};
		});
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
			data: { status, message: message ?? undefined },
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
			data: { summary, verdict },
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
			data: { criterion, passed, details: details ?? undefined },
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
			data: { reason, dependencies: dependencies ?? undefined },
		};
		await this.appendJournal(planExecutionId, event);
		const transcriptEvent = createWorkerTranscriptEvent(event, buildTranscriptSummary(event));
		if (transcriptEvent) {
			await this.appendWorkerTranscriptEvent(planExecutionId, workspaceId, transcriptEvent);
		}
	}
}
