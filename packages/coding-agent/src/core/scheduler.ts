/**
 * Scheduler Interface
 *
 * Common interface for workspace schedulers.
 * Both WorkspaceScheduler (v1) and DynamicParallelScheduler (v2) implement this.
 */

import type { PlanState } from "./plan-state.js";
import type { TopologicalBatch, Workspace } from "./workspace-schema.js";

/**
 * Reason a workspace was skipped (not selected for scheduling)
 */
export interface SkipReason {
	/** Workspace ID that was skipped */
	workspaceId: string;
	/** Category of skip */
	category: "dependency" | "file_lock" | "capacity" | "not_pending" | "preflight_required" | "resource_pressure";
	/** Human-readable reason */
	reason: string;
	/** For dependency skips: list of missing/incomplete dependency IDs */
	missingDependencyIds?: string[];
	/** For file-lock skips: conflicting workspace ID */
	conflictingWorkspaceId?: string;
	/** For file-lock skips: conflicting file path or glob pattern */
	conflictingPath?: string;
	/** Planned batch ID for the workspace (1-based, from approved dependency graph) */
	batchId?: number;
	/** Resource metric name for resource-pressure skips */
	resourceMetric?: string;
	/** Threshold value for resource-pressure skips */
	resourceThreshold?: number;
	/** Current value for resource-pressure skips */
	resourceValue?: number;
}

/**
 * Explanation for why the scheduler is idle (no work started)
 */
export interface IdleExplanation {
	/** True when scheduler is idle */
	isIdle: boolean;
	/** Reasons the scheduler produced no selected workspaces */
	reasons: string[];
}

/**
 * Scheduler capacity snapshot for dashboard display
 */
export interface SchedulerCapacitySnapshot {
	/** Maximum configured workers */
	maxWorkers: number;
	/** Effective maximum due to pressure reduction (may be < maxWorkers) */
	effectiveMaxWorkers: number;
	/** Currently active workers */
	activeWorkers: number;
	/** Available worker slots */
	availableSlots: number;
	/** Total workspaces tracked */
	totalWorkspaces: number;
	/** Workspaces in pending state */
	pending: number;
	/** Workspaces in active state */
	active: number;
	/** Workspaces in complete state */
	complete: number;
	/** Workspaces in blocked state */
	blocked: number;
	/** Workspaces in failed state */
	failed: number;
	/** Number of file locks currently held */
	fileLocks: number;
	/** Utilization ratio (0-1) */
	utilization: number;
	/** Whether worktree mode is active */
	isWorktreeMode: boolean;
	/** Resource pressure level (0-1) */
	resourcePressure: number;
}

/**
 * Full scheduler diagnostics
 */
export interface SchedulerDiagnostics {
	/** Workspaces selected for scheduling */
	selected: string[];
	/** Workspaces selected with explanatory reasons */
	selectedWithReasons: Array<{ workspaceId: string; reason: string }>;
	/** Workspaces skipped with detailed reasons */
	skipped: SkipReason[];
	/** Idle explanation (when no work was started) */
	idle: IdleExplanation;
	/** Capacity snapshot */
	capacity: SchedulerCapacitySnapshot;
	/** Batch IDs for scheduled workspaces (workspace ID -> 1-based batch index) */
	batchIds: Map<string, number>;
}

/**
 * Scheduling decision
 */
export interface SchedulingDecision {
	/** Workspaces that can be scheduled now */
	ready: Workspace[];
	/** Workspaces that are blocked */
	blocked: Workspace[];
	/** Reason for blocking (workspace ID -> reason) */
	blockReasons: Map<string, string>;
	/** Diagnostics (selected/skipped/idle detail) */
	diagnostics: SchedulerDiagnostics;
	/** Batch IDs for ready workspaces (workspace ID -> 1-based batch index) */
	readyBatchIds: Map<string, number>;
}

/**
 * File lock conflict
 */
export interface FileLockConflict {
	/** File path */
	file: string;
	/** Workspace that owns the file */
	owner: string;
	/** Workspace that wants the file */
	requester: string;
}

/**
 * Scheduler interface
 *
 * Implemented by both WorkspaceScheduler (v1) and DynamicParallelScheduler (v2).
 */
export interface Scheduler {
	/**
	 * Get the next set of workspaces to schedule.
	 * Returns workspaces that are ready to run (dependencies complete,
	 * no file lock conflicts, within capacity).
	 */
	getNextWorkspaces(workspaces: Workspace[], state: PlanState): SchedulingDecision;

	/**
	 * Check if workspace dependencies are complete.
	 */
	areDependenciesComplete(workspace: Workspace, state: PlanState): { complete: boolean; reason?: string };

	/**
	 * Acquire file locks for a workspace.
	 */
	acquireFileLocks(workspace: Workspace): string[];

	/**
	 * Release file locks for a workspace.
	 */
	releaseFileLocks(workspace: Workspace): void;

	/**
	 * Release all file locks held by a workspace ID.
	 */
	releaseLocksByWorkspaceId(workspaceId: string): void;

	/**
	 * Get currently locked files.
	 */
	getFileLocks(): Map<string, string>;

	/**
	 * Check if a file is locked.
	 */
	isFileLocked(filePath: string): string | null;

	/**
	 * Get the set of workspace IDs that currently hold file locks.
	 */
	getLockedWorkspaceIds(): Set<string>;

	/**
	 * Set batch assignments from approved plan preview.
	 */
	setBatchAssignment(batchAssignment: Map<string, number>, batches: TopologicalBatch[]): void;

	/**
	 * Get the batch index for a workspace.
	 */
	getBatchId(workspaceId: string): number;

	/**
	 * Get all batch assignments.
	 */
	getBatchAssignments(): Map<string, number>;

	/**
	 * Get the configured topological batches.
	 */
	getBatches(): TopologicalBatch[];

	/**
	 * Get scheduling statistics.
	 */
	getStatistics(state: PlanState): {
		total: number;
		pending: number;
		active: number;
		complete: number;
		blocked: number;
		failed: number;
		activeSlots: number;
		availableSlots: number;
	};

	/**
	 * Get the maximum parallel workspaces limit.
	 */
	getMaxWorkers(): number;

	/**
	 * Reset scheduler state.
	 */
	reset(): void;

	/**
	 * Validate workspace queue for scheduling.
	 */
	validateScheduling(workspaces: Workspace[]): { valid: boolean; errors: string[] };
}
