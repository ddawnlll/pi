/**
 * IStateStore interface — abstraction over execution persistence backends.
 *
 * Enables PostgreSQL and legacy JSON implementations to coexist.
 * Follows the Phase 1 architecture plan §7.B.
 */

import type { JournalEvent } from "./plan-state.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

/**
 * Plan execution status values.
 */
export type PlanStatus = "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled";

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
	 * Append event to execution journal.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param event - Journal event
	 */
	appendJournal(planExecutionId: string, event: JournalEvent): Promise<void>;

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
	getStatistics(planExecutionId: string): Promise<{
		total: number;
		pending: number;
		active: number;
		complete: number;
		blocked: number;
		failed: number;
	} | null>;
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
		return new (require("./json-state-store.js").JsonStateStore)(workspaceRoot, jsonConfig);
	}

	if (backend === "postgres") {
		// Attempt to create a DatabaseStateStore; if DB is unavailable, fall back to JSON
		try {
			const { DatabaseStateStore } = require("./database-state-store.js");
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
			const { JsonStateStore } = require("./json-state-store.js");
			return new JsonStateStore(workspaceRoot, jsonConfig);
		}
	}

	throw new Error(`Unknown state store backend: ${backend}`);
}

/**
 * Determine state store backend from environment / config.
 *
 * Checks PI_STATE_STORE_BACKEND env var, then config file, then defaults to "json".
 *
 * @returns Backend identifier
 */
export function detectStateStoreBackend(): StateStoreBackend {
	// Check environment variable first
	const envBackend = process.env.PI_STATE_STORE_BACKEND;
	if (envBackend === "postgres" || envBackend === "json") {
		return envBackend;
	}

	// Check for PostgreSQL availability via env vars as a heuristic
	// (only if PI_PG_AUTO_DETECT is explicitly set)
	if (process.env.PI_PG_AUTO_DETECT === "1") {
		const hasPgEnv = process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER;
		if (hasPgEnv) {
			return "postgres";
		}
	}

	return "json";
}
