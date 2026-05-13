/**
 * DAG Scheduler + File Locks - P2 Workstream 7.D
 *
 * Manages workspace scheduling with dependency resolution, file locking,
 * and bounded parallelism with stable (1-3) and experimental (4-6) worker modes.
 */

import type { PlanState } from "./plan-state.js";
import { DEFAULT_WORKERS, MAX_EXPERIMENTAL_WORKERS, MIN_STABLE_WORKERS } from "./worker-concurrency.js";
import type { Workspace } from "./workspace-schema.js";
import { detectCycles, WorkspaceStage } from "./workspace-schema.js";

/**
 * Reason a workspace was skipped (not selected for scheduling)
 */
export interface SkipReason {
	/** Workspace ID that was skipped */
	workspaceId: string;
	/** Category of skip */
	category: "dependency" | "file_lock" | "capacity" | "not_pending";
	/** Human-readable reason */
	reason: string;
	/** For dependency skips: list of missing/incomplete dependency IDs */
	missingDependencyIds?: string[];
	/** For file-lock skips: conflicting workspace ID */
	conflictingWorkspaceId?: string;
	/** For file-lock skips: conflicting file path or glob pattern */
	conflictingPath?: string;
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
 * Scheduler capacity diagnostics
 */
export interface SchedulerDiagnostics {
	/** Workspaces selected for scheduling */
	selected: string[];
	/** Workspaces skipped with detailed reasons */
	skipped: SkipReason[];
	/** Idle explanation (when no work was started) */
	idle: IdleExplanation;
	/** Capacity snapshot */
	capacity: SchedulerCapacitySnapshot;
}

/**
 * Snapshot of scheduler capacity for dashboard display
 */
export interface SchedulerCapacitySnapshot {
	/** Maximum concurrent workers */
	maxWorkers: number;
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
 * Workspace scheduler
 *
 * Manages workspace execution scheduling with:
 * - Dependency-aware execution
 * - File ownership tracking (no same-file parallelism)
 * - Stable (1-3) and experimental (4-6) worker concurrency
 * - Capability manifest boundary enforcement
 * - Cycle detection
 */
export class WorkspaceScheduler {
	private maxWorkers: number;
	private fileLocks: Map<string, string>; // file path -> workspace ID

	constructor(maxWorkers = DEFAULT_WORKERS) {
		// Clamp worker count to valid range
		const clamped = Math.max(MIN_STABLE_WORKERS, Math.min(MAX_EXPERIMENTAL_WORKERS, maxWorkers));
		this.maxWorkers = clamped;
		this.fileLocks = new Map();
	}

	/**
	 * Get next workspaces to schedule
	 *
	 * Selects workspaces that:
	 * - Are in pending stage
	 * - Have all dependencies complete
	 * - Don't conflict with active file locks
	 * - Don't exceed worker limit
	 *
	 * @param workspaces - All workspaces
	 * @param state - Current plan state
	 * @returns Scheduling decision (includes diagnostics)
	 */
	getNextWorkspaces(workspaces: Workspace[], state: PlanState): SchedulingDecision {
		const ready: Workspace[] = [];
		const blocked: Workspace[] = [];
		const blockReasons = new Map<string, string>();
		const skipped: SkipReason[] = [];

		// Get currently active workspaces
		const activeCount = Array.from(state.workspaces.values()).filter(
			(ws) => ws.stage === WorkspaceStage.Active,
		).length;

		// Check worker limit
		const availableSlots = this.maxWorkers - activeCount;
		if (availableSlots <= 0) {
			// All slots occupied
			for (const workspace of workspaces) {
				const wsState = state.workspaces.get(workspace.id);
				if (wsState?.stage === WorkspaceStage.Pending) {
					blocked.push(workspace);
					blockReasons.set(workspace.id, `Worker limit reached (max ${this.maxWorkers})`);
					skipped.push({
						workspaceId: workspace.id,
						category: "capacity",
						reason: `Worker limit reached (max ${this.maxWorkers})`,
					});
				}
			}

			const diag = this.buildDiagnostics(ready, skipped, state);
			return { ready, blocked, blockReasons, diagnostics: diag };
		}

		const capacityReached = { value: false };

		// Check each pending workspace
		for (const workspace of workspaces) {
			const wsState = state.workspaces.get(workspace.id);
			if (wsState?.stage !== WorkspaceStage.Pending) {
				// Not pending — skip with "not_pending" category
				if (wsState) {
					skipped.push({
						workspaceId: workspace.id,
						category: "not_pending",
						reason: `Workspace not pending (stage: ${wsState.stage})`,
					});
				}
				continue;
			}

			// Check dependencies
			const depsResult = this.areDependenciesCompleteDetailed(workspace, state);
			if (!depsResult.complete) {
				blocked.push(workspace);
				blockReasons.set(workspace.id, depsResult.reason || "Dependencies not complete");
				skipped.push({
					workspaceId: workspace.id,
					category: "dependency",
					reason: depsResult.reason || "Dependencies not complete",
					missingDependencyIds: depsResult.missingIds,
				});
				continue;
			}

			// Check file lock conflicts
			const lockConflict = this.checkFileLockConflict(workspace);
			if (lockConflict) {
				blocked.push(workspace);
				blockReasons.set(workspace.id, `File lock conflict: ${lockConflict.file} owned by ${lockConflict.owner}`);
				skipped.push({
					workspaceId: workspace.id,
					category: "file_lock",
					reason: `File lock conflict: ${lockConflict.file} owned by ${lockConflict.owner}`,
					conflictingWorkspaceId: lockConflict.owner,
					conflictingPath: lockConflict.file,
				});
				continue;
			}

			// Check capacity
			if (ready.length >= availableSlots) {
				capacityReached.value = true;
				blocked.push(workspace);
				blockReasons.set(workspace.id, "Waiting for available slot");
				skipped.push({
					workspaceId: workspace.id,
					category: "capacity",
					reason: "No available worker slot",
				});
				continue;
			}

			// Workspace is ready
			ready.push(workspace);
		}

		// Also track remaining pending workspaces that weren't visited
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
				blockReasons.set(workspace.id, "Waiting for available slot");
				skipped.push({
					workspaceId: workspace.id,
					category: "capacity",
					reason: "Waiting for available slot",
				});
			}
		}

		const diag = this.buildDiagnostics(ready, skipped, state);
		return { ready, blocked, blockReasons, diagnostics: diag };
	}

	/**
	 * Check if workspace dependencies are complete (detailed version)
	 *
	 * Returns missing dependency IDs for diagnostics.
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
				if (!firstReason) firstReason = `Dependency ${depId} not found`;
				continue;
			}

			if (depState.stage === WorkspaceStage.Failed) {
				missingIds.push(depId);
				if (!firstReason) firstReason = `Dependency ${depId} failed`;
				continue;
			}

			if (depState.stage === WorkspaceStage.Blocked) {
				missingIds.push(depId);
				if (!firstReason) firstReason = `Dependency ${depId} is blocked`;
				continue;
			}

			if (depState.stage !== WorkspaceStage.Complete) {
				missingIds.push(depId);
				if (!firstReason) firstReason = `Dependency ${depId} not complete (${depState.stage})`;
			}
		}

		if (missingIds.length > 0) {
			return { complete: false, reason: firstReason, missingIds };
		}

		return { complete: true, missingIds: [] };
	}

	/**
	 * Build diagnostics from scheduling results.
	 *
	 * @param ready - Selected workspaces
	 * @param skipped - Skipped reasons
	 * @param state - Current plan state
	 * @returns Scheduler diagnostics
	 */
	private buildDiagnostics(ready: Workspace[], skipped: SkipReason[], state: PlanState): SchedulerDiagnostics {
		const capacity = this.getCapacitySnapshot(state);
		const selected = ready.map((w) => w.id);

		// Determine idle explanation
		const idle: IdleExplanation = { isIdle: selected.length === 0, reasons: [] };
		if (idle.isIdle) {
			if (capacity.activeWorkers >= capacity.maxWorkers) {
				idle.reasons.push(`All ${capacity.maxWorkers} worker slots occupied`);
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
			if (capacity.pending === 0 && capacity.activeWorkers < capacity.maxWorkers) {
				idle.reasons.push("No pending workspaces available");
			}
		}

		return { selected, skipped, idle, capacity };
	}

	/**
	 * Get a capacity snapshot for dashboard display.
	 *
	 * @param state - Current plan state
	 * @returns Capacity snapshot
	 */
	private getCapacitySnapshot(state: PlanState): SchedulerCapacitySnapshot {
		const stats = this.getStatistics(state);
		return {
			maxWorkers: this.maxWorkers,
			activeWorkers: stats.active,
			availableSlots: stats.availableSlots,
			totalWorkspaces: stats.total,
			pending: stats.pending,
			active: stats.active,
			complete: stats.complete,
			blocked: stats.blocked,
			failed: stats.failed,
			fileLocks: this.fileLocks.size,
			utilization: this.maxWorkers > 0 ? stats.active / this.maxWorkers : 0,
		};
	}

	/**
	 * Check if workspace dependencies are complete
	 *
	 * @param workspace - Workspace to check
	 * @param state - Current plan state
	 * @returns Dependency check result
	 */
	areDependenciesComplete(workspace: Workspace, state: PlanState): { complete: boolean; reason?: string } {
		for (const depId of workspace.dependencies) {
			const depState = state.workspaces.get(depId);
			if (!depState) {
				return { complete: false, reason: `Dependency ${depId} not found` };
			}

			if (depState.stage === WorkspaceStage.Failed) {
				return { complete: false, reason: `Dependency ${depId} failed` };
			}

			if (depState.stage === WorkspaceStage.Blocked) {
				return { complete: false, reason: `Dependency ${depId} is blocked` };
			}

			if (depState.stage !== WorkspaceStage.Complete) {
				return { complete: false, reason: `Dependency ${depId} not complete (${depState.stage})` };
			}
		}

		return { complete: true };
	}

	/**
	 * Check for file lock conflicts
	 *
	 * @param workspace - Workspace to check
	 * @returns Conflict details or null if no conflict
	 */
	checkFileLockConflict(workspace: Workspace): FileLockConflict | null {
		if (!workspace.capabilities) {
			return null; // No restrictions
		}

		// Check if any files this workspace wants to edit are locked
		for (const file of workspace.capabilities.canEdit) {
			const owner = this.fileLocks.get(file);
			if (owner && owner !== workspace.id) {
				return {
					file,
					owner,
					requester: workspace.id,
				};
			}
		}

		return null;
	}

	/**
	 * Acquire file locks for a workspace
	 *
	 * @param workspace - Workspace acquiring locks
	 * @returns Array of locked files
	 */
	acquireFileLocks(workspace: Workspace): string[] {
		if (!workspace.capabilities) {
			return [];
		}

		const lockedFiles: string[] = [];

		for (const file of workspace.capabilities.canEdit) {
			// Check if already locked by another workspace
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
	 * Release file locks for a workspace
	 *
	 * @param workspace - Workspace releasing locks
	 */
	releaseFileLocks(workspace: Workspace): void {
		if (!workspace.capabilities) {
			return;
		}

		for (const file of workspace.capabilities.canEdit) {
			const owner = this.fileLocks.get(file);
			if (owner === workspace.id) {
				this.fileLocks.delete(file);
			}
		}
	}

	/**
	 * Get currently locked files
	 *
	 * @returns Map of file path to owner workspace ID
	 */
	getFileLocks(): Map<string, string> {
		return new Map(this.fileLocks);
	}

	/**
	 * Check if a file is locked
	 *
	 * @param filePath - File path to check
	 * @returns Owner workspace ID or null if not locked
	 */
	isFileLocked(filePath: string): string | null {
		return this.fileLocks.get(filePath) || null;
	}

	/**
	 * Validate workspace queue for scheduling
	 *
	 * Checks for:
	 * - Dependency cycles
	 * - Invalid dependencies
	 * - Potential deadlocks
	 *
	 * @param workspaces - Workspaces to validate
	 * @returns Validation result
	 */
	validateScheduling(workspaces: Workspace[]): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		// Check for cycles
		const cycleResult = detectCycles(workspaces);
		if (cycleResult.hasCycle) {
			errors.push(`Dependency cycle detected: ${cycleResult.cycle?.join(" → ")}`);
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

		// Check for potential file lock deadlocks
		const deadlockCheck = this.detectFileLockDeadlocks(workspaces);
		if (deadlockCheck.hasDeadlock) {
			errors.push(`Potential file lock deadlock: ${deadlockCheck.reason}`);
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	/**
	 * Detect potential file lock deadlocks
	 *
	 * Checks if there are circular file dependencies that could cause deadlock.
	 *
	 * @param workspaces - Workspaces to check
	 * @returns Deadlock detection result
	 */
	private detectFileLockDeadlocks(workspaces: Workspace[]): { hasDeadlock: boolean; reason?: string } {
		// Build file dependency graph
		const fileOwners = new Map<string, string[]>(); // file -> workspace IDs that want it

		for (const workspace of workspaces) {
			if (!workspace.capabilities) continue;

			for (const file of workspace.capabilities.canEdit) {
				const owners = fileOwners.get(file) || [];
				owners.push(workspace.id);
				fileOwners.set(file, owners);
			}
		}

		// Check for files wanted by multiple workspaces with circular dependencies
		for (const [file, owners] of Array.from(fileOwners.entries())) {
			if (owners.length > 1) {
				// Multiple workspaces want this file
				// Check if they have circular dependencies
				for (let i = 0; i < owners.length; i++) {
					for (let j = i + 1; j < owners.length; j++) {
						const ws1 = workspaces.find((w) => w.id === owners[i]);
						const ws2 = workspaces.find((w) => w.id === owners[j]);

						if (ws1 && ws2) {
							// Check if ws1 depends on ws2 AND ws2 depends on ws1 (circular)
							const ws1DependsOnWs2 = this.hasDependencyPath(ws1, ws2.id, workspaces);
							const ws2DependsOnWs1 = this.hasDependencyPath(ws2, ws1.id, workspaces);

							if (ws1DependsOnWs2 && ws2DependsOnWs1) {
								return {
									hasDeadlock: true,
									reason: `Circular dependency between ${ws1.id} and ${ws2.id} with shared file ${file}`,
								};
							}
						}
					}
				}
			}
		}

		return { hasDeadlock: false };
	}

	/**
	 * Check if there's a dependency path from workspace to target
	 *
	 * @param workspace - Starting workspace
	 * @param targetId - Target workspace ID
	 * @param allWorkspaces - All workspaces
	 * @returns True if path exists
	 */
	private hasDependencyPath(workspace: Workspace, targetId: string, allWorkspaces: Workspace[]): boolean {
		const visited = new Set<string>();
		const queue = [workspace.id];

		while (queue.length > 0) {
			const currentId = queue.shift()!;
			if (visited.has(currentId)) continue;
			visited.add(currentId);

			const current = allWorkspaces.find((w) => w.id === currentId);
			if (!current) continue;

			if (current.dependencies.includes(targetId)) {
				return true;
			}

			queue.push(...current.dependencies);
		}

		return false;
	}

	/**
	 * Get scheduling statistics
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
		stats.availableSlots = Math.max(0, this.maxWorkers - stats.active);

		return stats;
	}

	/**
	 * Reset scheduler state (clears file locks)
	 */
	reset(): void {
		this.fileLocks.clear();
	}
}

/**
 * Build execution order (topological sort)
 *
 * Returns workspaces in an order that respects dependencies.
 *
 * @param workspaces - Workspaces to sort
 * @returns Sorted workspaces or null if cycle detected
 */
export function buildExecutionOrder(workspaces: Workspace[]): Workspace[] | null {
	// Check for cycles first
	const cycleResult = detectCycles(workspaces);
	if (cycleResult.hasCycle) {
		return null;
	}

	// Build dependency graph
	const graph = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const workspace of workspaces) {
		graph.set(workspace.id, workspace.dependencies);
		inDegree.set(workspace.id, workspace.dependencies.length);
	}

	// Topological sort (Kahn's algorithm)
	const queue: string[] = [];
	const result: Workspace[] = [];

	// Find all nodes with no dependencies
	for (const workspace of workspaces) {
		if (workspace.dependencies.length === 0) {
			queue.push(workspace.id);
		}
	}

	while (queue.length > 0) {
		const currentId = queue.shift()!;
		const current = workspaces.find((w) => w.id === currentId);
		if (current) {
			result.push(current);
		}

		// Reduce in-degree for dependents
		for (const workspace of workspaces) {
			if (workspace.dependencies.includes(currentId)) {
				const degree = inDegree.get(workspace.id)! - 1;
				inDegree.set(workspace.id, degree);

				if (degree === 0) {
					queue.push(workspace.id);
				}
			}
		}
	}

	// If result doesn't contain all workspaces, there's a cycle
	if (result.length !== workspaces.length) {
		return null;
	}

	return result;
}

/**
 * Format scheduling decision for display
 *
 * @param decision - Scheduling decision
 * @returns Formatted string
 */
export function formatSchedulingDecision(decision: SchedulingDecision): string {
	const lines: string[] = [];

	lines.push(`Ready to schedule: ${decision.ready.length}`);
	if (decision.ready.length > 0) {
		for (const ws of decision.ready) {
			lines.push(`  • ${ws.id} — ${ws.title}`);
		}
	}

	if (decision.blocked.length > 0) {
		lines.push("");
		lines.push(`Blocked: ${decision.blocked.length}`);
		for (const ws of decision.blocked) {
			const reason = decision.blockReasons.get(ws.id) || "Unknown reason";
			lines.push(`  • ${ws.id} — ${reason}`);
		}
	}

	return lines.join("\n");
}

/**
 * Format scheduler capacity summary for dashboard display
 *
 * Shows a dashboard-friendly summary of current scheduler capacity,
 * including worker utilization, file locks, and per-category skip counts.
 *
 * @param diagnostics - Scheduler diagnostics
 * @returns Formatted capacity summary string
 */
export function formatCapacitySummary(diagnostics: SchedulerDiagnostics): string {
	const { capacity, selected, skipped, idle } = diagnostics;
	const lines: string[] = [];

	lines.push("=== Scheduler Capacity Summary ===");
	lines.push("");
	lines.push(
		`Workers:    ${capacity.activeWorkers}/${capacity.maxWorkers} active (${capacity.availableSlots} available)`,
	);
	lines.push(`Utilization: ${Math.round(capacity.utilization * 100)}%`);
	lines.push(`File Locks:  ${capacity.fileLocks} held`);
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
			lines.push(`  • ${s.workspaceId} — missing deps: ${ids}`);
		}
	}

	if (lockSkips.length > 0) {
		lines.push("");
		lines.push(`File-lock skips: ${lockSkips.length}`);
		for (const s of lockSkips) {
			lines.push(`  • ${s.workspaceId} — conflict with ${s.conflictingWorkspaceId} on ${s.conflictingPath}`);
		}
	}

	if (capSkips.length > 0) {
		lines.push("");
		lines.push(`Capacity skips: ${capSkips.length}`);
		for (const s of capSkips) {
			lines.push(`  • ${s.workspaceId} — ${s.reason}`);
		}
	}

	if (idle.isIdle) {
		lines.push("");
		lines.push("IDLE — no work started:");
		for (const r of idle.reasons) {
			lines.push(`  • ${r}`);
		}
	}

	return lines.join("\n");
}
