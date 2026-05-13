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
 * Scheduling decision
 */
export interface SchedulingDecision {
	/** Workspaces that can be scheduled now */
	ready: Workspace[];
	/** Workspaces that are blocked */
	blocked: Workspace[];
	/** Reason for blocking (workspace ID -> reason) */
	blockReasons: Map<string, string>;
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
	 * @returns Scheduling decision
	 */
	getNextWorkspaces(workspaces: Workspace[], state: PlanState): SchedulingDecision {
		const ready: Workspace[] = [];
		const blocked: Workspace[] = [];
		const blockReasons = new Map<string, string>();

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
				}
			}
			return { ready, blocked, blockReasons };
		}

		// Check each pending workspace
		for (const workspace of workspaces) {
			const wsState = state.workspaces.get(workspace.id);
			if (wsState?.stage !== WorkspaceStage.Pending) {
				continue; // Not pending
			}

			// Check dependencies
			const depsComplete = this.areDependenciesComplete(workspace, state);
			if (!depsComplete.complete) {
				blocked.push(workspace);
				blockReasons.set(workspace.id, depsComplete.reason || "Dependencies not complete");
				continue;
			}

			// Check file lock conflicts
			const lockConflict = this.checkFileLockConflict(workspace);
			if (lockConflict) {
				blocked.push(workspace);
				blockReasons.set(workspace.id, `File lock conflict: ${lockConflict.file} owned by ${lockConflict.owner}`);
				continue;
			}

			// Workspace is ready
			ready.push(workspace);

			// Stop if we've filled available slots
			if (ready.length >= availableSlots) {
				break;
			}
		}

		// Mark remaining pending workspaces as blocked
		for (const workspace of workspaces) {
			const wsState = state.workspaces.get(workspace.id);
			if (wsState?.stage === WorkspaceStage.Pending && !ready.includes(workspace) && !blocked.includes(workspace)) {
				blocked.push(workspace);
				blockReasons.set(workspace.id, "Waiting for available slot");
			}
		}

		return { ready, blocked, blockReasons };
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
