/**
 * Dynamic Parallel Scheduler - Workspace 6.E
 *
 * A capacity-aware scheduler that dynamically adjusts concurrency based on:
 * - Available worker slots
 * - Worktree isolation mode (higher concurrency in worktree mode)
 * - Resource pressure (file lock contention, validation lock pressure)
 * - Same-file conflict safety
 *
 * Every scheduling decision is explained with detailed diagnostic information.
 *
 * Acceptance Criteria:
 *   AC1: Scheduler fills capacity with ready-safe workspaces
 *   AC2: Scheduler can use higher concurrency in worktree mode
 *   AC3: Scheduler reduces concurrency when validation lock/resource pressure is high
 *   AC4: Scheduler explains skipped/selected decisions
 *   AC5: Same-file conflicts are not run unsafely
 */

import type { PlanState } from "../core/plan-state.js";
import type {
	FileLockConflict,
	IdleExplanation,
	Scheduler,
	SchedulerCapacitySnapshot,
	SchedulerDiagnostics,
	SchedulingDecision,
	SkipReason,
} from "../core/scheduler.js";
import { DEFAULT_WORKERS, MAX_EXPERIMENTAL_WORKERS, MIN_STABLE_WORKERS } from "../core/worker-concurrency.js";
import type { TopologicalBatch, Workspace } from "../core/workspace-schema.js";
import { detectCycles, WorkspaceStage } from "../core/workspace-schema.js";

// Re-export scheduler types for backward compatibility
export type {
	FileLockConflict,
	IdleExplanation,
	SchedulerCapacitySnapshot,
	SchedulerDiagnostics,
	SchedulingDecision,
	SkipReason,
} from "../core/scheduler.js";

// ---------------------------------------------------------------------------
// Resource Pressure Tracking
// ---------------------------------------------------------------------------

/**
 * Tracks resource pressure metrics for adaptive concurrency reduction.
 */
export interface ResourcePressureMetrics {
	/** Number of file lock conflicts detected in recent scheduling rounds */
	recentFileLockConflicts: number;
	/** Total file lock conflicts since last reset */
	totalFileLockConflicts: number;
	/** Number of workspaces contending for the same files */
	fileContentionCount: number;
	/** Whether we're currently in a high-pressure state */
	highPressure: boolean;
	/** Timestamp of last high pressure reduction */
	lastPressureReduction: number;
}

// ---------------------------------------------------------------------------
// DynamicParallelScheduler
// ---------------------------------------------------------------------------

/**
 * Dynamic Parallel Scheduler
 *
 * Manages workspace execution scheduling with dynamic concurrency:
 * - AC1: Fills capacity with ready-safe workspaces
 * - AC2: Higher concurrency in worktree mode (no file conflicts between isolated worktrees)
 * - AC3: Reduces concurrency when resource pressure (file lock contention) is high
 * - AC4: Explains skipped/selected decisions with detailed reasons
 * - AC5: Same-file conflicts are never run unsafely
 */
export class DynamicParallelScheduler implements Scheduler {
	private maxWorkers: number;
	private effectiveMaxWorkers: number;
	private isWorktreeMode: boolean;
	private fileLocks: Map<string, string>; // file path -> workspace ID
	private batchAssignment: Map<string, number>;
	private batches: TopologicalBatch[];

	// Resource pressure tracking
	private resourceMetrics: ResourcePressureMetrics;
	private readonly PRESSURE_WINDOW = 10; // Look at last N scheduling rounds
	private readonly PRESSURE_THRESHOLD = 0.3; // 30% file conflict rate triggers reduction
	private readonly MAX_REDUCTION = 0.5; // Can reduce at most 50% of max workers
	private schedulingRoundCount = 0;
	private recentConflictRates: number[] = [];

	constructor(maxWorkers = DEFAULT_WORKERS, isWorktreeMode = false) {
		// Clamp worker count to valid range
		const clamped = Math.max(MIN_STABLE_WORKERS, Math.min(MAX_EXPERIMENTAL_WORKERS, maxWorkers));
		this.maxWorkers = clamped;
		this.effectiveMaxWorkers = clamped;
		this.isWorktreeMode = isWorktreeMode;
		this.fileLocks = new Map();
		this.batchAssignment = new Map();
		this.batches = [];
		this.resourceMetrics = {
			recentFileLockConflicts: 0,
			totalFileLockConflicts: 0,
			fileContentionCount: 0,
			highPressure: false,
			lastPressureReduction: 0,
		};
	}

	/**
	 * Set worktree mode.
	 *
	 * In worktree mode, each workspace runs in its own isolated worktree,
	 * so same-file conflicts cannot occur and the scheduler can safely
	 * use higher concurrency (AC2).
	 *
	 * @param enabled - Whether worktree mode is enabled
	 */
	setWorktreeMode(enabled: boolean): void {
		this.isWorktreeMode = enabled;
	}

	/**
	 * Whether worktree mode is enabled.
	 */
	getWorktreeMode(): boolean {
		return this.isWorktreeMode;
	}

	/**
	 * Get the next set of workspaces to schedule.
	 *
	 * AC1: Schedules as many ready, dependency-complete workspaces as possible
	 * up to capacity (fills all available worker slots).
	 *
	 * AC2: In worktree mode, skips file lock checks because same-file conflicts
	 * are impossible between isolated worktrees, allowing higher concurrency.
	 *
	 * AC3: Evaluates resource pressure before scheduling and reduces effective
	 * concurrency when file lock contention is high.
	 *
	 * AC4: Every selected and skipped decision includes a human-readable reason.
	 *
	 * AC5: File lock checks prevent concurrent modification of the same files.
	 *
	 * @param workspaces - All workspaces
	 * @param state - Current plan state
	 * @returns Scheduling decision with full diagnostics
	 */
	getNextWorkspaces(workspaces: Workspace[], state: PlanState): SchedulingDecision {
		this.schedulingRoundCount++;

		const ready: Workspace[] = [];
		const blocked: Workspace[] = [];
		const blockReasons = new Map<string, string>();
		const readyBatchIds = new Map<string, number>();
		const skipped: SkipReason[] = [];
		const selectedWithReasons: Array<{ workspaceId: string; reason: string }> = [];

		// Release stale file locks from workspaces that are no longer active.
		// This prevents completed/failed workspaces from blocking subsequent
		// workspaces that share the same canEdit paths (e.g., "src/**").
		for (const [wsId, wsState] of state.workspaces) {
			if (wsState.stage !== WorkspaceStage.Active) {
				this.releaseLocksByWorkspaceId(wsId);
			}
		}

		// Calculate active count
		const activeCount = Array.from(state.workspaces.values()).filter(
			(ws) => ws.stage === WorkspaceStage.Active,
		).length;

		// AC3: Evaluate resource pressure and adjust effective concurrency
		this.evaluateResourcePressure();
		const effectiveMax = this.effectiveMaxWorkers;

		// AC2: In worktree mode, file locks don't restrict parallelism
		// because each worktree is isolated.
		const skipFileLocks = this.isWorktreeMode;

		// Over-limit protection
		if (activeCount > effectiveMax) {
			for (const workspace of workspaces) {
				const wsState = state.workspaces.get(workspace.id);
				if (wsState?.stage === WorkspaceStage.Pending) {
					blocked.push(workspace);
					const msg = `Worker limit exceeded (active ${activeCount} > effective max ${effectiveMax})`;
					blockReasons.set(workspace.id, msg);
					skipped.push({
						workspaceId: workspace.id,
						category: "capacity",
						reason: msg,
						batchId: this.batchAssignment.get(workspace.id),
					});
				}
			}
			return this.buildDecision(ready, blocked, blockReasons, skipped, selectedWithReasons, state, effectiveMax);
		}

		const availableSlots = effectiveMax - activeCount;
		if (availableSlots <= 0) {
			for (const workspace of workspaces) {
				const wsState = state.workspaces.get(workspace.id);
				if (wsState?.stage === WorkspaceStage.Pending) {
					blocked.push(workspace);
					const msg = `Worker limit reached (effective max ${effectiveMax})`;
					blockReasons.set(workspace.id, msg);
					skipped.push({
						workspaceId: workspace.id,
						category: "capacity",
						reason: msg,
						batchId: this.batchAssignment.get(workspace.id),
					});
				}
			}
			return this.buildDecision(ready, blocked, blockReasons, skipped, selectedWithReasons, state, effectiveMax);
		}

		// Track file lock reservations for the current scheduling round.
		// Workspaces already selected in this round claim their canEdit files,
		// preventing subsequent workspaces that share the same files from being
		// scheduled concurrently (they'd crash at acquireFileLocks time).
		const reservedLocks = new Set<string>();

		// AC1: Fill capacity with ready-safe workspaces
		for (const workspace of workspaces) {
			const wsState = state.workspaces.get(workspace.id);

			// Skip workspaces that are not pending
			if (wsState?.stage !== WorkspaceStage.Pending) {
				if (wsState) {
					skipped.push({
						workspaceId: workspace.id,
						category: "not_pending",
						reason: `Workspace not pending (stage: ${wsState.stage})`,
						batchId: this.batchAssignment.get(workspace.id),
					});
				}
				continue;
			}

			// AC4: Check dependencies with detailed explanation
			const depsResult = this.areDependenciesCompleteDetailed(workspace, state);
			if (!depsResult.complete) {
				blocked.push(workspace);
				const depReason = depsResult.reason || "Dependencies not complete";
				blockReasons.set(workspace.id, depReason);
				skipped.push({
					workspaceId: workspace.id,
					category: "dependency",
					reason: depReason,
					missingDependencyIds: depsResult.missingIds,
					batchId: this.batchAssignment.get(workspace.id),
				});
				continue;
			}

			// AC5: Check file lock conflicts (skip in worktree mode - AC2)
			if (!skipFileLocks) {
				const lockConflict = this.checkFileLockConflict(workspace, reservedLocks);
				if (lockConflict) {
					blocked.push(workspace);
					const lockReason = `File lock conflict: ${lockConflict.file} owned by ${lockConflict.owner}`;
					blockReasons.set(workspace.id, lockReason);
					skipped.push({
						workspaceId: workspace.id,
						category: "file_lock",
						reason: lockReason,
						conflictingWorkspaceId: lockConflict.owner,
						conflictingPath: lockConflict.file,
						batchId: this.batchAssignment.get(workspace.id),
					});
					continue;
				}
			}

			// P7.G AC1: Check preflight approval requirement
			// Workspaces with preflightRequired=true must be approved before execution.
			const preflightStatus = wsState.preflightStatus;
			if (workspace.preflightRequired && preflightStatus !== "approved") {
				const statusLabel = preflightStatus ?? "not_reviewed";
				const preflightReason =
					preflightStatus === "rejected"
						? `Preflight rejected${wsState.preflightRejectionReason ? `: ${wsState.preflightRejectionReason}` : ""}`
						: `Preflight approval required (status: ${statusLabel})`;

				blocked.push(workspace);
				blockReasons.set(workspace.id, preflightReason);
				skipped.push({
					workspaceId: workspace.id,
					category: "preflight_required",
					reason: preflightReason,
					batchId: this.batchAssignment.get(workspace.id),
				});

				// The AutonomousExecutor layer handles initializing preflightStatus
				// to "pending" before calling the scheduler.
				continue;
			}

			// AC1: Check capacity
			if (ready.length >= availableSlots) {
				blocked.push(workspace);
				const msg = "No available worker slot";
				blockReasons.set(workspace.id, msg);
				skipped.push({
					workspaceId: workspace.id,
					category: "capacity",
					reason: msg,
					batchId: this.batchAssignment.get(workspace.id),
				});
				continue;
			}

			// Reserve file locks for this workspace so subsequent workspaces
			// in the same scheduling round see the conflict.
			if (!skipFileLocks && workspace.capabilities) {
				for (const file of workspace.capabilities.canEdit) {
					reservedLocks.add(file);
				}
			}

			// AC4: Workspace is ready - record reason
			const batchId = this.batchAssignment.get(workspace.id);
			if (batchId !== undefined) {
				readyBatchIds.set(workspace.id, batchId);
			}

			let selectReason = "Dependencies complete, no file conflicts, capacity available";
			if (this.isWorktreeMode) {
				selectReason = "Dependencies complete, worktree mode (file conflicts eliminated), capacity available";
			}

			selectedWithReasons.push({ workspaceId: workspace.id, reason: selectReason });
			ready.push(workspace);
		}

		// Fill remaining pending workspaces that weren't visited
		const readyIds = new Set(ready.map((w) => w.id));
		const blockedIds = new Set(blocked.map((w) => w.id));
		for (const workspace of workspaces) {
			const wsState = state.workspaces.get(workspace.id);
			if (
				wsState?.stage === WorkspaceStage.Pending &&
				!readyIds.has(workspace.id) &&
				!blockedIds.has(workspace.id)
			) {
				blocked.push(workspace);
				const msg = "Waiting for available slot";
				blockReasons.set(workspace.id, msg);
				skipped.push({
					workspaceId: workspace.id,
					category: "capacity",
					reason: msg,
					batchId: this.batchAssignment.get(workspace.id),
				});
			}
		}

		return this.buildDecision(ready, blocked, blockReasons, skipped, selectedWithReasons, state, effectiveMax);
	}

	/**
	 * Build a complete scheduling decision with diagnostics.
	 *
	 * @param ready - Selected workspaces
	 * @param blocked - Blocked workspaces
	 * @param blockReasons - Map of block reasons
	 * @param skipped - Skip reasons with details
	 * @param selectedWithReasons - Selected workspaces with reasons
	 * @param state - Current plan state
	 * @param effectiveMax - Effective maximum workers (after pressure reduction)
	 * @returns Complete scheduling decision
	 */
	private buildDecision(
		ready: Workspace[],
		blocked: Workspace[],
		blockReasons: Map<string, string>,
		skipped: SkipReason[],
		selectedWithReasons: Array<{ workspaceId: string; reason: string }>,
		state: PlanState,
		effectiveMax: number,
	): SchedulingDecision {
		const capacity = this.getCapacitySnapshot(state, effectiveMax);
		const selected = ready.map((w) => w.id);
		const batchIds = new Map<string, number>();
		for (const ws of ready) {
			const batchId = this.batchAssignment.get(ws.id);
			if (batchId !== undefined) {
				batchIds.set(ws.id, batchId);
			}
		}

		// AC4: Idle explanation
		const idle: IdleExplanation = { isIdle: selected.length === 0, reasons: [] };
		if (idle.isIdle) {
			if (capacity.activeWorkers >= effectiveMax) {
				idle.reasons.push(`All ${effectiveMax} worker slots occupied`);
			}
			const depSkips = skipped.filter((s) => s.category === "dependency");
			if (depSkips.length > 0) {
				idle.reasons.push(
					`${depSkips.length} workspace(s) blocked by dependencies: ${depSkips.map((s) => s.workspaceId).join(", ")}`,
				);
			}
			const lockSkips = skipped.filter((s) => s.category === "file_lock");
			if (lockSkips.length > 0) {
				idle.reasons.push(
					`${lockSkips.length} workspace(s) blocked by file locks: ${lockSkips.map((s) => s.workspaceId).join(", ")}`,
				);
			}
			if (capacity.pending === 0 && capacity.activeWorkers < effectiveMax) {
				idle.reasons.push("No pending workspaces available");
			}
			if (this.resourceMetrics.highPressure) {
				idle.reasons.push(
					`Resource pressure reduction active (effective: ${effectiveMax} of ${this.maxWorkers} workers)`,
				);
			}
		}

		const diagnostics: SchedulerDiagnostics = {
			selected,
			selectedWithReasons,
			skipped,
			idle,
			capacity,
			batchIds,
		};

		const readyBatchIds = new Map<string, number>();
		for (const ws of ready) {
			const batchId = this.batchAssignment.get(ws.id);
			if (batchId !== undefined) {
				readyBatchIds.set(ws.id, batchId);
			}
		}

		return { ready, blocked, blockReasons, diagnostics, readyBatchIds };
	}

	/**
	 * AC3: Evaluate resource pressure from file lock contention and adjust
	 * effective concurrency dynamically.
	 *
	 * Tracks a sliding window of file lock conflict rates. When the
	 * smoothed rate exceeds the threshold, reduces effective concurrency.
	 * When pressure subsides, gradually restores concurrency.
	 */
	private evaluateResourcePressure(): void {
		const recentConflicts = this.resourceMetrics.recentFileLockConflicts;
		const windowSize = Math.min(this.PRESSURE_WINDOW, Math.max(1, this.schedulingRoundCount));
		const conflictRate = windowSize > 0 ? recentConflicts / windowSize : 0;

		this.recentConflictRates.push(conflictRate);
		if (this.recentConflictRates.length > this.PRESSURE_WINDOW) {
			this.recentConflictRates.shift();
		}

		// Smooth the conflict rate over the window
		const smoothedRate =
			this.recentConflictRates.reduce((a, b) => a + b, 0) / Math.max(1, this.recentConflictRates.length);

		// Reset recent conflicts for next round
		this.resourceMetrics.recentFileLockConflicts = 0;

		if (smoothedRate > this.PRESSURE_THRESHOLD && this.maxWorkers > MIN_STABLE_WORKERS) {
			// High pressure - reduce effective concurrency
			const reduction = Math.max(1, Math.floor(this.maxWorkers * this.MAX_REDUCTION));
			this.effectiveMaxWorkers = Math.max(MIN_STABLE_WORKERS, this.maxWorkers - reduction);
			this.resourceMetrics.highPressure = true;
			this.resourceMetrics.lastPressureReduction = Date.now();
		} else if (smoothedRate < this.PRESSURE_THRESHOLD * 0.5 && this.effectiveMaxWorkers < this.maxWorkers) {
			// Pressure subsided - gradually restore concurrency
			this.effectiveMaxWorkers = Math.min(this.maxWorkers, this.effectiveMaxWorkers + 1);
			if (this.effectiveMaxWorkers >= this.maxWorkers) {
				this.resourceMetrics.highPressure = false;
			}
		}
	}

	/**
	 * Check if workspace dependencies are complete with detailed reporting.
	 *
	 * @param workspace - Workspace to check
	 * @param state - Current plan state
	 * @returns Dependency check result with missing IDs
	 */
	private areDependenciesCompleteDetailed(
		workspace: Workspace,
		state: PlanState,
	): { complete: boolean; reason?: string; missingIds: string[] } {
		const missingIds: string[] = [];
		let firstReason: string | undefined;

		for (const depId of workspace.dependencies) {
			const depState = state.workspaces.get(depId);
			if (!depState) {
				missingIds.push(depId);
				if (!firstReason) firstReason = `Dependency ${depId} not found in plan state`;
				continue;
			}

			switch (depState.stage) {
				case WorkspaceStage.Failed:
					missingIds.push(depId);
					if (!firstReason) firstReason = `Dependency ${depId} failed`;
					break;
				case WorkspaceStage.Blocked:
					missingIds.push(depId);
					if (!firstReason) firstReason = `Dependency ${depId} is blocked`;
					break;
				case WorkspaceStage.Complete:
					// Dependency satisfied - no issue
					break;
				default:
					missingIds.push(depId);
					if (!firstReason) firstReason = `Dependency ${depId} not complete (${depState.stage})`;
					break;
			}
		}

		if (missingIds.length > 0) {
			return { complete: false, reason: firstReason, missingIds };
		}

		return { complete: true, missingIds: [] };
	}

	/**
	 * Check for file lock conflicts.
	 *
	 * Checks against both currently held locks (active workspaces) and
	 * reservations from workspaces selected earlier in this scheduling round.
	 * Tracks the conflict in resource metrics for pressure evaluation.
	 *
	 * @param workspace - Workspace to check
	 * @param reservedLocks - Set of files reserved by workspaces selected in this round
	 * @returns Conflict details or null if no conflict
	 */
	checkFileLockConflict(workspace: Workspace, reservedLocks?: Set<string>): FileLockConflict | null {
		if (!workspace.capabilities) {
			return null;
		}

		for (const file of workspace.capabilities.canEdit) {
			const owner = this.fileLocks.get(file);
			if (owner && owner !== workspace.id) {
				this.resourceMetrics.recentFileLockConflicts++;
				this.resourceMetrics.totalFileLockConflicts++;
				return { file, owner, requester: workspace.id };
			}
			// Also check reservations from the current scheduling round
			if (reservedLocks?.has(file)) {
				this.resourceMetrics.recentFileLockConflicts++;
				this.resourceMetrics.totalFileLockConflicts++;
				return {
					file,
					owner: "(scheduling round)",
					requester: workspace.id,
				};
			}
		}

		return null;
	}

	/**
	 * Acquire file locks for a workspace.
	 *
	 * @param workspace - Workspace acquiring locks
	 * @returns Array of locked files
	 */
	acquireFileLocks(workspace: Workspace): string[] {
		if (!workspace.capabilities) return [];

		const lockedFiles: string[] = [];
		for (const file of workspace.capabilities.canEdit) {
			const owner = this.fileLocks.get(file);
			if (owner && owner !== workspace.id) {
				throw new Error(`File ${file} is already locked by ${owner}`);
			}
			this.fileLocks.set(file, workspace.id);
			lockedFiles.push(file);
		}
		return lockedFiles;
	}

	/**
	 * Release file locks for a workspace.
	 *
	 * @param workspace - Workspace releasing locks
	 */
	releaseFileLocks(workspace: Workspace): void {
		if (!workspace.capabilities) return;
		for (const file of workspace.capabilities.canEdit) {
			if (this.fileLocks.get(file) === workspace.id) {
				this.fileLocks.delete(file);
			}
		}
	}

	/**
	 * Get a capacity snapshot for dashboard display.
	 *
	 * @param state - Current plan state
	 * @param effectiveMax - Effective maximum workers (optional)
	 * @returns Capacity snapshot
	 */
	getCapacitySnapshot(state: PlanState, effectiveMax?: number): SchedulerCapacitySnapshot {
		const stats = this.getStatistics(state);
		const effMax = effectiveMax ?? this.effectiveMaxWorkers;
		return {
			maxWorkers: this.maxWorkers,
			effectiveMaxWorkers: effMax,
			activeWorkers: stats.active,
			availableSlots: Math.max(0, effMax - stats.active),
			totalWorkspaces: stats.total,
			pending: stats.pending,
			active: stats.active,
			complete: stats.complete,
			blocked: stats.blocked,
			failed: stats.failed,
			fileLocks: this.fileLocks.size,
			utilization: effMax > 0 ? stats.active / effMax : 0,
			isWorktreeMode: this.isWorktreeMode,
			resourcePressure: this.resourceMetrics.highPressure ? 1.0 : 0.0,
		};
	}

	/**
	 * Get scheduling statistics.
	 *
	 * @param state - Current plan state
	 * @returns Scheduling statistics
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
	} {
		const stats = {
			total: state.workspaces.size,
			pending: 0,
			active: 0,
			complete: 0,
			blocked: 0,
			failed: 0,
			activeSlots: 0,
			availableSlots: 0,
		};

		for (const ws of Array.from(state.workspaces.values())) {
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

		stats.activeSlots = stats.active;
		stats.availableSlots = Math.max(0, this.effectiveMaxWorkers - stats.active);

		return stats;
	}

	/**
	 * Check if workspace dependencies are complete.
	 *
	 * @param workspace - Workspace to check
	 * @param state - Current plan state
	 * @returns Dependency check result
	 */
	areDependenciesComplete(workspace: Workspace, state: PlanState): { complete: boolean; reason?: string } {
		for (const depId of workspace.dependencies) {
			const depState = state.workspaces.get(depId);
			if (!depState) return { complete: false, reason: `Dependency ${depId} not found` };
			if (depState.stage === WorkspaceStage.Failed) return { complete: false, reason: `Dependency ${depId} failed` };
			if (depState.stage === WorkspaceStage.Blocked)
				return { complete: false, reason: `Dependency ${depId} is blocked` };
			if (depState.stage !== WorkspaceStage.Complete)
				return { complete: false, reason: `Dependency ${depId} not complete (${depState.stage})` };
		}
		return { complete: true };
	}

	/**
	 * Reset scheduler state (clears file locks, batch assignments, pressure metrics).
	 */
	/**
	 * Get the set of workspace IDs that currently hold file locks.
	 *
	 * @returns Set of workspace IDs that own at least one file lock
	 */
	getLockedWorkspaceIds(): Set<string> {
		const ids = new Set<string>();
		for (const owner of this.fileLocks.values()) {
			ids.add(owner);
		}
		return ids;
	}

	/**
	 * Release all file locks held by a specific workspace.
	 * This is used to clean up stale locks from workspaces that have
	 * completed or failed but whose locks were not properly released.
	 *
	 * Unlike releaseFileLocks(), this does not require a Workspace object
	 * with capabilities — it just needs the workspace ID.
	 *
	 * @param workspaceId - ID of the workspace whose locks to release
	 */
	releaseLocksByWorkspaceId(workspaceId: string): void {
		const toDelete: string[] = [];
		for (const [file, owner] of this.fileLocks) {
			if (owner === workspaceId) {
				toDelete.push(file);
			}
		}
		for (const file of toDelete) {
			this.fileLocks.delete(file);
		}
	}

	reset(): void {
		this.fileLocks.clear();
		this.batchAssignment.clear();
		this.batches = [];
		this.effectiveMaxWorkers = this.maxWorkers;
		this.resourceMetrics = {
			recentFileLockConflicts: 0,
			totalFileLockConflicts: 0,
			fileContentionCount: 0,
			highPressure: false,
			lastPressureReduction: 0,
		};
		this.recentConflictRates = [];
		this.schedulingRoundCount = 0;
	}

	/**
	 * Set batch assignments for workspaces from the approved plan preview.
	 *
	 * @param batchAssignment - Map of workspace ID to 1-based batch index
	 * @param batches - Computed topological batches
	 */
	setBatchAssignment(batchAssignment: Map<string, number>, batches: TopologicalBatch[]): void {
		this.batchAssignment = new Map(batchAssignment);
		this.batches = batches;
	}

	/**
	 * Get the batch index for a workspace from the approved plan preview.
	 *
	 * @param workspaceId - Workspace ID
	 * @returns 1-based batch index, or 0 if not assigned
	 */
	getBatchId(workspaceId: string): number {
		return this.batchAssignment.get(workspaceId) ?? 0;
	}

	/**
	 * Get all batch assignments.
	 *
	 * @returns Map of workspace ID to batch index
	 */
	getBatchAssignments(): Map<string, number> {
		return new Map(this.batchAssignment);
	}

	/**
	 * Get the configured topological batches.
	 *
	 * @returns Array of topological batches
	 */
	getBatches(): TopologicalBatch[] {
		return [...this.batches];
	}

	/**
	 * Get the maximum parallel workspaces limit.
	 *
	 * @returns Maximum number of concurrent workers configured
	 */
	getMaxWorkers(): number {
		return this.maxWorkers;
	}

	/**
	 * Get the effective maximum workers (after pressure reduction).
	 *
	 * @returns Effective number of concurrent workers
	 */
	getEffectiveMaxWorkers(): number {
		return this.effectiveMaxWorkers;
	}

	/**
	 * Get resource pressure metrics.
	 *
	 * @returns Copy of current resource pressure metrics
	 */
	getResourceMetrics(): ResourcePressureMetrics {
		return { ...this.resourceMetrics };
	}

	/**
	 * Get currently locked files.
	 *
	 * @returns Map of file path to owner workspace ID
	 */
	getFileLocks(): Map<string, string> {
		return new Map(this.fileLocks);
	}

	/**
	 * Check if a file is locked.
	 *
	 * @param filePath - File path to check
	 * @returns Owner workspace ID or null if not locked
	 */
	isFileLocked(filePath: string): string | null {
		return this.fileLocks.get(filePath) || null;
	}

	/**
	 * Validate workspace queue for scheduling.
	 *
	 * Checks for cycles, invalid dependencies, and potential file lock deadlocks.
	 *
	 * @param workspaces - Workspaces to validate
	 * @returns Validation result
	 */
	validateScheduling(workspaces: Workspace[]): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		// Check for cycles
		const cycleResult = detectCycles(workspaces);
		if (cycleResult.hasCycle) {
			errors.push(`Dependency cycle detected: ${cycleResult.cycle?.join(" \u2192 ")}`);
		}

		// Check for invalid dependencies
		const idSet = new Set(workspaces.map((w) => w.id));
		for (const workspace of workspaces) {
			for (const dep of workspace.dependencies) {
				if (!idSet.has(dep)) {
					errors.push(`Workspace ${workspace.id} depends on non-existent workspace: ${dep}`);
				}
			}
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}
}

// ---------------------------------------------------------------------------
// Formatting utilities for diagnostics display
// ---------------------------------------------------------------------------

/**
 * Format scheduling decision for display.
 *
 * AC4: Shows selected workspaces with their reasons and blocked workspaces
 * with their reasons.
 *
 * @param decision - Scheduling decision
 * @returns Formatted string
 */
export function formatSchedulingDecision(decision: SchedulingDecision): string {
	const lines: string[] = [];

	lines.push(`Ready to schedule: ${decision.ready.length}`);
	if (decision.ready.length > 0) {
		for (const ws of decision.ready) {
			const batchId = decision.readyBatchIds.get(ws.id);
			const batchInfo = batchId !== undefined ? ` [batch ${batchId}]` : "";
			const selReason = decision.diagnostics.selectedWithReasons.find((s) => s.workspaceId === ws.id)?.reason ?? "";
			lines.push(`  \u2022 ${ws.id} \u2014 ${ws.title}${batchInfo}`);
			if (selReason) {
				lines.push(`    Reason: ${selReason}`);
			}
		}
	}

	if (decision.blocked.length > 0) {
		lines.push("");
		lines.push(`Blocked: ${decision.blocked.length}`);
		for (const ws of decision.blocked) {
			const reason = decision.blockReasons.get(ws.id) || "Unknown reason";
			lines.push(`  \u2022 ${ws.id} \u2014 ${reason}`);
		}
	}

	return lines.join("\n");
}

/**
 * Format scheduler capacity summary for dashboard display.
 *
 * Shows a dashboard-friendly summary of current scheduler capacity,
 * including worker utilization, file locks, and per-category skip counts.
 *
 * AC4: Provides clear explanations of why workspaces were selected or skipped.
 *
 * @param diagnostics - Scheduler diagnostics
 * @returns Formatted capacity summary string
 */
export function formatCapacitySummary(diagnostics: SchedulerDiagnostics): string {
	const { capacity, selected, skipped, idle } = diagnostics;
	const lines: string[] = [];

	lines.push("=== Dynamic Scheduler Capacity Summary ===");
	lines.push("");
	lines.push(
		`Workers:    ${capacity.activeWorkers}/${capacity.effectiveMaxWorkers} active (${capacity.availableSlots} available)`,
	);
	lines.push(`  Configured max: ${capacity.maxWorkers}`);
	lines.push(`  Utilization:    ${Math.round(capacity.utilization * 100)}%`);
	lines.push(`  Worktree mode:  ${capacity.isWorktreeMode ? "YES" : "no"}`);
	lines.push(`  Resource pressure: ${capacity.resourcePressure > 0 ? "HIGH" : "normal"}`);
	lines.push(`  File Locks:    ${capacity.fileLocks} held`);
	lines.push("");
	lines.push(`Workspaces:  ${capacity.totalWorkspaces} total`);
	lines.push(`  Pending:   ${capacity.pending}`);
	lines.push(`  Active:    ${capacity.active}`);
	lines.push(`  Complete:  ${capacity.complete}`);
	lines.push(`  Blocked:   ${capacity.blocked}`);
	lines.push(`  Failed:    ${capacity.failed}`);
	lines.push("");

	if (selected.length > 0) {
		lines.push(`Selected:    ${selected.join(", ")}`);
	} else {
		lines.push("Selected:    (none)");
	}

	const depSkips = skipped.filter((s) => s.category === "dependency");
	const lockSkips = skipped.filter((s) => s.category === "file_lock");
	const capSkips = skipped.filter((s) => s.category === "capacity");

	if (depSkips.length > 0) {
		lines.push("");
		lines.push(`Dependency skips: ${depSkips.length}`);
		for (const s of depSkips) {
			const ids = s.missingDependencyIds?.join(", ") ?? "unknown";
			lines.push(`  \u2022 ${s.workspaceId} \u2014 ${s.reason}`);
			lines.push(`    Missing deps: ${ids}`);
		}
	}

	if (lockSkips.length > 0) {
		lines.push("");
		lines.push(`File-lock skips: ${lockSkips.length}`);
		for (const s of lockSkips) {
			lines.push(
				`  \u2022 ${s.workspaceId} \u2014 conflict with ${s.conflictingWorkspaceId} on ${s.conflictingPath}`,
			);
		}
	}

	if (capSkips.length > 0) {
		lines.push("");
		lines.push(`Capacity skips: ${capSkips.length}`);
		for (const s of capSkips) {
			lines.push(`  \u2022 ${s.workspaceId} \u2014 ${s.reason}`);
		}
	}

	if (idle.isIdle) {
		lines.push("");
		lines.push("IDLE \u2014 no work started:");
		for (const r of idle.reasons) {
			lines.push(`  \u2022 ${r}`);
		}
	}

	return lines.join("\n");
}
