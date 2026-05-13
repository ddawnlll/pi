/**
 * IStateStore interface — abstraction over execution persistence backends.
 *
 * Enables PostgreSQL and legacy JSON implementations to coexist.
 * Follows the Phase 1 architecture plan §7.B.
 */

import { DatabaseStateStore } from "./database-state-store.js";
import { JsonStateStore } from "./json-state-store.js";
import type { JournalEvent } from "./plan-state.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

/**
 * Plan execution status values.
 */
export type PlanStatus = "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled" | "awaiting_handoff";

/**
 * Control action types.
 */
export type ControlAction = "pause" | "stop" | "cancel" | "resume";

/**
 * Control request state.
 */
export interface PlanControlState {
	action: ControlAction;
	requestedAt: number;
	reason?: string;
}

/**
 * State store backend identifier.
 */
export type StateStoreBackend = "json" | "postgres";

/**
 * Plan execution summary (for listing).
 */
export interface PlanExecutionSummary {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: PlanStatus;
	startedAt: string;
	completedAt: string | null;
}

/**
 * A single attempt in a workspace's retry history.
 */
export interface WorkspaceAttempt {
	/** Attempt number (1-based) */
	attempt: number;
	/** Role stage for this attempt */
	role: "worker" | "flash" | "reviewer" | "final";
	/** Start timestamp */
	startedAt: number | null;
	/** Completion timestamp */
	completedAt: number | null;
	/** Duration in milliseconds (null if still running) */
	duration: number | null;
	/** Verdict for this attempt */
	verdict: "running" | "complete" | "failed";
	/** Error excerpt (truncated to 200 chars) */
	error: string | null;
}

/**
 * Project summary.
 */
export interface ProjectSummary {
	id: string;
	name: string;
	description: string | null;
	rootPath: string | null;
	createdAt: string;
}

/**
 * State store configuration.
 */
export interface StateStoreConfig {
	/** Backend type */
	backend: StateStoreBackend;
	/** Workspace root directory (required for JSON backend) */
	workspaceRoot?: string;
	/** Project ID (defaults to "default" when not specified) */
	projectId?: string;
	/** JSON state store config */
	jsonConfig?: { piDir?: string };
	/** Database state store config */
	dbConfig?: { maxRetries?: number; retryBaseDelayMs?: number; retryMaxDelayMs?: number };
}

/**
 * State store interface.
 *
 * Abstracts execution state persistence behind a common interface.
 * Both JSON (PlanStateStore) and PostgreSQL (DatabaseStateStore)
 * implementations satisfy this contract.
 */
export interface IStateStore {
	/**
	 * Get the backend type identifier.
	 */
	getBackendType(): StateStoreBackend;

	// =========================================================================
	// Project Management
	// =========================================================================

	/**
	 * List all projects.
	 */
	listProjects(): Promise<ProjectSummary[]>;

	/**
	 * Find or create a project by name.
	 *
	 * @param name - Project name
	 * @param rootPath - Optional root path
	 * @returns Project summary
	 */
	findOrCreateProject(name: string, rootPath?: string): Promise<ProjectSummary>;

	/**
	 * Update project properties (name, rootPath, etc).
	 *
	 * @param projectId - Project ID
	 * @param updates - Fields to update
	 */
	updateProject(projectId: string, updates: Partial<Pick<ProjectSummary, "name" | "rootPath">>): Promise<void>;

	// =========================================================================
	// Plan Execution
	// =========================================================================

	/**
	 * Initialize state for a new plan execution.
	 *
	 * @param projectId - Project ID
	 * @param queue - Workspace queue
	 * @returns Plan execution ID
	 */
	initializeState(projectId: string, queue: WorkspaceQueue): Promise<string>;

	/**
	 * Load execution state.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns Plan state or null
	 */
	loadState(planExecutionId: string): Promise<import("./plan-state.js").PlanState | null>;

	/**
	 * Save current execution state.
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	saveState(planExecutionId: string): Promise<void>;

	/**
	 * List plan executions for a project.
	 *
	 * @param projectId - Project ID
	 * @returns Array of execution summaries
	 */
	listPlanExecutions(projectId: string): Promise<PlanExecutionSummary[]>;

	// =========================================================================
	// Workspace State
	// =========================================================================

	/**
	 * Update workspace state.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param updates - State updates
	 */
	updateWorkspaceState(
		planExecutionId: string,
		workspaceId: string,
		updates: Partial<import("./plan-state.js").WorkspaceState>,
	): Promise<void>;

	/**
	 * Transition workspace to a new stage.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param newStage - New stage
	 * @param data - Additional data for journal
	 */
	transitionWorkspace(
		planExecutionId: string,
		workspaceId: string,
		newStage: import("./workspace-schema.js").WorkspaceStage,
		data?: Record<string, unknown>,
	): Promise<void>;

	/**
	 * Increment retry attempt counter.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 */
	incrementRetryAttempt(planExecutionId: string, workspaceId: string): Promise<void>;

	// =========================================================================
	// File Locks
	// =========================================================================

	/**
	 * Acquire file locks for a workspace.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param files - Files to lock
	 */
	acquireFileLocks(planExecutionId: string, workspaceId: string, files: string[]): Promise<void>;

	/**
	 * Release file locks for a workspace.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 */
	releaseFileLocks(planExecutionId: string, workspaceId: string): Promise<void>;

	// =========================================================================
	// Journal
	// =========================================================================

	/**
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	setAwaitingHandoff(planExecutionId: string, planTitle: string): Promise<void>;

	/**
	 * Finalize handoff: commit rollup, mark plan complete.
	 * Called when user chooses "Commit & finish".
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	handoffCommit(planExecutionId: string): Promise<void>;

	/**
	 * Keep editing: return plan to running status.
	 * Called when user chooses "Keep editing".
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	handoffKeepEditing(planExecutionId: string): Promise<void>;

	/**
	 * Discard: revert uncommitted workspace files and fail the plan.
	 * Called when user chooses "Discard".
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceRoot - Root directory for git revert operations
	 */
	handoffDiscard(planExecutionId: string, workspaceRoot: string): Promise<void>;

	/**
	 * Check if plan is currently awaiting handoff.
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	isAwaitingHandoff(planExecutionId: string): Promise<boolean>;

	/**
	 * Get the timestamp when the plan entered awaiting_handoff state.
	 * Returns 0 if not in that state.
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	getHandoffStartedAt(planExecutionId: string): Promise<number>;

	/**
	 * Append event to execution journal.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param event - Journal event
	 */
	appendJournal(planExecutionId: string, event: JournalEvent): Promise<void>;

	/**
	 * Append a tool_call journal event.
	 *
	 * Handles MCP tool name prefixing, input truncation at 2KB,
	 * and error result mapping.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param toolName - Tool name (MCP tools get mcp:{server}:{tool} prefix)
	 * @param input - Tool input arguments (truncated to 2KB)
	 * @param options - Additional options
	 */
	appendJournalEvent(
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
	): Promise<void>;

	/**
	 * Read execution journal.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns Array of journal events
	 */
	readJournal(planExecutionId: string): Promise<JournalEvent[]>;

	// =========================================================================
	// Plan Lifecycle
	// =========================================================================

	/**
	 * Mark plan as complete.
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	completePlan(planExecutionId: string): Promise<void>;

	/**
	 * Mark plan as failed.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param error - Error message
	 */
	failPlan(planExecutionId: string, error: string): Promise<void>;

	/**
	 * Pause plan execution.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param reason - Optional reason
	 */
	pausePlan(planExecutionId: string, reason?: string): Promise<void>;

	/**
	 * Stop plan execution.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param reason - Optional reason
	 */
	stopPlan(planExecutionId: string, reason?: string): Promise<void>;

	/**
	 * Cancel plan execution.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param reason - Optional reason
	 */
	cancelPlan(planExecutionId: string, reason?: string): Promise<void>;

	/**
	 * Resume plan execution.
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	resumePlan(planExecutionId: string): Promise<void>;

	// =========================================================================
	// Control
	// =========================================================================

	/**
	 * Write a control request.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param action - Control action
	 * @param reason - Optional reason
	 */
	writeControlRequest(planExecutionId: string, action: ControlAction, reason?: string): Promise<void>;

	/**
	 * Read current control request.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns Control state or null
	 */
	readControlRequest(planExecutionId: string): Promise<PlanControlState | null>;

	/**
	 * Clear control request.
	 *
	 * @param planExecutionId - Plan execution ID
	 */
	clearControlRequest(planExecutionId: string): Promise<void>;

	// =========================================================================
	// Query
	// =========================================================================

	/**
	 * Get workspace state.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Workspace state or undefined
	 */
	getWorkspaceState(
		planExecutionId: string,
		workspaceId: string,
	): Promise<import("./plan-state.js").WorkspaceState | undefined>;

	/**
	 * Get execution statistics.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns Statistics or null
	 */
	/**
	 * Get workspace retry attempt history.
	 *
	 * Reads execution log files and journal events to reconstruct
	 * the timeline of attempts for a given workspace.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Array of attempt records, newest first
	 */
	getWorkspaceAttempts(planExecutionId: string, workspaceId: string): Promise<WorkspaceAttempt[]>;

	/**
	 * Get execution statistics.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns Statistics or null
	 */
	getStatistics(planExecutionId: string): Promise<{
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
	} | null>;

	// =========================================================================
	// Execution Logs
	// =========================================================================

	/**
	 * Save execution log content.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param logContent - Log content to save
	 */
	saveExecutionLog(planExecutionId: string, logContent: string): Promise<void>;

	/**
	 * Load execution log content.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns Log content or null if not found
	 */
	loadExecutionLog(planExecutionId: string): Promise<string | null>;

	/**
	 * Append a log line to workspace-specific logs.
	 * Optional method for workspace-level log streaming.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param logLine - Log line to append
	 */
	appendWorkspaceLog?(planExecutionId: string, workspaceId: string, logLine: string): Promise<void>;

	/**
	 * Load workspace-specific log content.
	 * Optional method for workspace-level log retrieval.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Log content or null if not found
	 */
	loadWorkspaceLog?(planExecutionId: string, workspaceId: string): Promise<string | null>;

	/**
	 * Get recent workspace logs from in-memory buffer.
	 * Optional method for real-time log streaming (JSON backend only).
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param maxLines - Maximum number of lines to return
	 * @returns Array of recent log lines
	 */
	getRecentWorkspaceLogs?(planExecutionId: string, workspaceId: string, maxLines?: number): string[];
}

/**
 * Create a state store instance based on configuration.
 *
 * Selects the appropriate backend (JSON or PostgreSQL) and configures it.
 * Falls back to JSON with a warning if PostgreSQL is selected but unavailable.
 *
 * @param config - State store configuration
 * @returns Configured state store instance
 */
export function createStateStore(config: StateStoreConfig): IStateStore {
	const { backend, workspaceRoot, jsonConfig, dbConfig } = config;

	if (backend === "json" || !backend) {
		if (!workspaceRoot) {
			throw new Error("workspaceRoot is required for JSON state store backend");
		}
		return new JsonStateStore(workspaceRoot, jsonConfig);
	}

	if (backend === "postgres") {
		// Attempt to create a DatabaseStateStore; if DB is unavailable, fall back to JSON
		try {
			return new DatabaseStateStore(dbConfig);
		} catch (error) {
			console.warn(
				"[pi] PostgreSQL backend requested but unavailable:",
				error instanceof Error ? error.message : String(error),
			);
			console.warn("[pi] Falling back to JSON state store backend.");

			if (!workspaceRoot) {
				throw new Error(
					"workspaceRoot is required for JSON state store fallback. " +
						'Set state_store_backend = "json" or provide a workspace root.',
				);
			}
			return new JsonStateStore(workspaceRoot, jsonConfig);
		}
	}

	throw new Error(`Unknown state store backend: ${backend}`);
}

/**
 * Determine state store backend from environment / config.
 *
 * Checks PI_STATE_STORE_BACKEND env var, then PostgreSQL connection env vars,
 * then defaults to "json". Reads environment at call time, not at module load.
 *
 * @returns Backend identifier
 */
export function detectStateStoreBackend(): StateStoreBackend {
	// Check environment variable first (read at call time)
	const envBackend = process.env.PI_STATE_STORE_BACKEND;
	if (envBackend === "postgres" || envBackend === "json") {
		console.log(`[state-store] Backend explicitly set via PI_STATE_STORE_BACKEND: ${envBackend}`);
		return envBackend;
	}

	// Check for PostgreSQL availability via DATABASE_URL or standard PG env vars
	const hasDatabaseUrl = !!process.env.DATABASE_URL;
	const hasPgEnv = !!(process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER);

	if (hasDatabaseUrl || hasPgEnv) {
		console.log(`[state-store] PostgreSQL env vars detected, using postgres backend`);
		return "postgres";
	}

	// Default to JSON only if no PostgreSQL env vars are present
	console.log(`[state-store] No PostgreSQL env vars found, defaulting to json backend`);
	return "json";
}
