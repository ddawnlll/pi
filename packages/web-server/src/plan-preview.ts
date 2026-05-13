/**
 * Plan Preview - Dependency graph, batch analysis, and preview patching
 *
 * Provides batch computation (topological sort), dependency graph analysis,
 * suggested fixes generation, and dependency patch preview without starting
 * execution.
 *
 * Acceptance Criteria (workspace 7.E):
 * 1. POST validate returns dependency graph, batches, warnings, and suggested fixes
 * 2. PATCH preview endpoint applies dependency patches without starting execution
 * 3. Run endpoint refuses unapproved interactive plans
 * 4. Existing validate/run behavior remains backward compatible
 */

import type { Workspace, WorkspaceQueue } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A node in the dependency graph. */
export interface DependencyGraphNode {
	/** Workspace ID */
	id: string;
	/** Workspace title */
	title: string;
	/** IDs of workspaces this workspace depends on */
	dependencies: string[];
	/** IDs of workspaces that depend on this workspace */
	dependents: string[];
	/** Batch index (1-based) from topological sort */
	batchIndex: number;
}

/** A topological batch of workspaces. */
export interface TopologicalBatch {
	/** 1-based batch index */
	batchIndex: number;
	/** Workspace IDs in this batch */
	workspaceIds: string[];
	/** Number of workspaces in this batch */
	width: number;
}

/** A suggested fix for a plan issue. */
export interface SuggestedFix {
	/** Fix identifier */
	id: string;
	/** Category of the fix */
	category: "remove_dependency" | "add_dependency" | "reorder_workspace" | "adjust_parallelism" | "resolve_cycle";
	/** Human-readable description */
	description: string;
	/** Workspace IDs affected */
	workspaceIds: string[];
	/** The patch to apply (if applicable) */
	patch?: DependencyPatch;
}

/** A dependency patch operation. */
export interface DependencyPatch {
	/** Workspace ID to modify */
	workspaceId: string;
	/** Type of patch operation */
	action: "add_dependency" | "remove_dependency";
	/** Dependency ID to add or remove */
	dependencyId: string;
}

/** Result of the batch plan computation. */
export interface BatchPlanResult {
	/** Dependency graph nodes */
	dependencyGraph: DependencyGraphNode[];
	/** Topological batches */
	batches: TopologicalBatch[];
	/** Total number of batches */
	totalBatches: number;
	/** Maximum width across all batches */
	effectiveParallelism: number;
	/** The maxParallelWorkspaces from the queue */
	requestedParallelism: number;
	/** Delta between requested and effective */
	parallelismDelta: number;
	/** Whether plan is over-serialized (requested > 1 but effective = 1) */
	isOverSerialized: boolean;
	/** Warnings about the batch plan */
	warnings: BatchPlanWarning[];
	/** Errors that prevented computation */
	errors: BatchPlanError[];
}

/** Warning about the batch plan. */
export interface BatchPlanWarning {
	type: "over_serialized" | "low_effective_parallelism" | "single_width_batch";
	message: string;
	workspaceIds?: string[];
	batchIndex?: number;
}

/** Error that prevented batch computation. */
export interface BatchPlanError {
	type: "cycle" | "missing_dependency" | "empty_queue";
	message: string;
	workspaceIds?: string[];
}

/** Result of applying dependency patches. */
export interface PreviewResult {
	/** Whether the preview was successfully computed */
	success: boolean;
	/** The modified workspace queue after applying patches */
	previewQueue?: WorkspaceQueue;
	/** Updated batch plan result after patches */
	batchPlan?: BatchPlanResult;
	/** Validation errors from the patched queue */
	errors: string[];
	/** Warnings from the patched queue */
	warnings: string[];
	/** Patches that were applied */
	appliedPatches: DependencyPatch[];
	/** Patches that could not be applied */
	rejectedPatches: Array<{ patch: DependencyPatch; reason: string }>;
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/**
 * Detect cycles in the workspace dependency graph.
 *
 * Uses DFS-based cycle detection with the coloring method.
 *
 * @param workspaces - List of workspaces to check
 * @returns Object with hasCycle flag and the cycle path if found
 */
export function detectCycles(workspaces: Workspace[]): { hasCycle: boolean; cycle?: string[] } {
	const graph = new Map<string, string[]>();
	for (const ws of workspaces) {
		graph.set(ws.id, [...ws.dependencies]);
	}

	// 0 = unvisited, 1 = in progress, 2 = done
	const state = new Map<string, number>();
	const path: string[] = [];

	function dfs(nodeId: string): boolean {
		state.set(nodeId, 1);
		path.push(nodeId);

		const neighbors = graph.get(nodeId) || [];
		for (const neighbor of neighbors) {
			const neighborState = state.get(neighbor);
			if (neighborState === 1) {
				// Cycle found
				const _cycleStart = path.indexOf(neighbor);
				return true;
			}
			if (neighborState === undefined || neighborState === 0) {
				if (dfs(neighbor)) {
					return true;
				}
			}
		}

		state.set(nodeId, 2);
		path.pop();
		return false;
	}

	for (const ws of workspaces) {
		if (state.get(ws.id) === undefined || state.get(ws.id) === 0) {
			if (dfs(ws.id)) {
				// Extract the cycle from path
				const lastNode = path[path.length - 1];
				const cycleStart = path.indexOf(lastNode);
				const cycle = path.slice(cycleStart);
				cycle.push(lastNode);
				return { hasCycle: true, cycle };
			}
		}
	}

	return { hasCycle: false };
}

// ---------------------------------------------------------------------------
// Batch computation
// ---------------------------------------------------------------------------

/**
 * Compute topological batches from a workspace queue using Kahn's algorithm.
 *
 * Groups workspaces into batches where all workspaces in the same batch
 * have their dependencies fully satisfied by earlier batches.
 *
 * @param queue - Workspace queue to analyze
 * @returns Batch plan result with dependency graph, batches, warnings, and errors
 */
export function computeBatchPlan(queue: WorkspaceQueue): BatchPlanResult {
	const workspaces = queue.workspaces;
	const maxParallel = queue.maxParallelWorkspaces;

	// Edge case: empty queue
	if (!workspaces || workspaces.length === 0) {
		return {
			dependencyGraph: [],
			batches: [],
			totalBatches: 0,
			effectiveParallelism: 0,
			requestedParallelism: maxParallel,
			parallelismDelta: maxParallel,
			isOverSerialized: false,
			warnings: [],
			errors: [{ type: "empty_queue", message: "Workspace queue is empty" }],
		};
	}

	// Detect cycles
	const cycleResult = detectCycles(workspaces);
	if (cycleResult.hasCycle) {
		return {
			dependencyGraph: buildDependencyGraph(workspaces, new Map()),
			batches: [],
			totalBatches: 0,
			effectiveParallelism: 0,
			requestedParallelism: maxParallel,
			parallelismDelta: maxParallel,
			isOverSerialized: false,
			warnings: [],
			errors: [
				{
					type: "cycle",
					message: `Dependency cycle detected: ${cycleResult.cycle?.join(" -> ")}`,
					workspaceIds: cycleResult.cycle,
				},
			],
		};
	}

	// Check for missing dependencies
	const errors: BatchPlanError[] = [];
	const wsIdSet = new Set(workspaces.map((w) => w.id));
	for (const ws of workspaces) {
		for (const depId of ws.dependencies) {
			if (!wsIdSet.has(depId)) {
				errors.push({
					type: "missing_dependency",
					message: `Workspace ${ws.id} depends on non-existent workspace: ${depId}`,
					workspaceIds: [ws.id, depId],
				});
			}
		}
	}
	if (errors.length > 0) {
		return {
			dependencyGraph: buildDependencyGraph(workspaces, new Map()),
			batches: [],
			totalBatches: 0,
			effectiveParallelism: 0,
			requestedParallelism: maxParallel,
			parallelismDelta: maxParallel,
			isOverSerialized: false,
			warnings: [],
			errors,
		};
	}

	// Build adjacency data for Kahn's algorithm
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	const workspaceMap = new Map<string, Workspace>();

	for (const ws of workspaces) {
		workspaceMap.set(ws.id, ws);
		inDegree.set(ws.id, ws.dependencies.length);
		for (const depId of ws.dependencies) {
			const list = dependents.get(depId) ?? [];
			list.push(ws.id);
			dependents.set(depId, list);
		}
	}

	// Kahn's algorithm with batch tracking
	const batches: TopologicalBatch[] = [];
	const batchAssignment = new Map<string, number>();
	let currentBatch: string[] = [];

	// Find initial zero in-degree nodes
	for (const ws of workspaces) {
		if (inDegree.get(ws.id) === 0) {
			currentBatch.push(ws.id);
		}
	}

	let batchIndex = 0;
	while (currentBatch.length > 0) {
		batchIndex++;
		const batch: TopologicalBatch = {
			batchIndex,
			workspaceIds: [...currentBatch],
			width: currentBatch.length,
		};
		batches.push(batch);

		for (const wsId of currentBatch) {
			batchAssignment.set(wsId, batchIndex);
		}

		const nextBatch: string[] = [];
		for (const wsId of currentBatch) {
			const deps = dependents.get(wsId) ?? [];
			for (const depId of deps) {
				const deg = inDegree.get(depId)! - 1;
				inDegree.set(depId, deg);
				if (deg === 0) {
					nextBatch.push(depId);
				}
			}
		}

		currentBatch = nextBatch;
	}

	// Build dependency graph
	const dependencyGraph = buildDependencyGraph(workspaces, batchAssignment);

	// Compute metrics
	const effectiveParallelism = batches.length > 0 ? Math.max(...batches.map((b) => b.width)) : 0;
	const parallelismDelta = maxParallel - effectiveParallelism;
	const isOverSerialized = maxParallel > 1 && effectiveParallelism === 1;

	// Generate warnings
	const warnings: BatchPlanWarning[] = [];

	if (isOverSerialized) {
		warnings.push({
			type: "over_serialized",
			message: `Plan requests ${maxParallel} parallel workspaces but the dependency graph is fully serialized (effective parallelism = 1). Consider removing unnecessary dependencies to increase concurrency.`,
		});
	}

	if (!isOverSerialized && effectiveParallelism > 0 && effectiveParallelism < maxParallel) {
		warnings.push({
			type: "low_effective_parallelism",
			message: `Effective parallelism (${effectiveParallelism}) is below requested (${maxParallel}). Some worker capacity will be unused.`,
		});
	}

	// Check for single-width batches creating bottlenecks
	for (const batch of batches) {
		if (batch.width === 1 && batches.length > 1 && batch.batchIndex > 1 && batch.batchIndex < batches.length) {
			const wsId = batch.workspaceIds[0];
			warnings.push({
				type: "single_width_batch",
				message: `Batch ${batch.batchIndex} has only 1 workspace (${wsId}), creating a serialization bottleneck.`,
				workspaceIds: batch.workspaceIds,
				batchIndex: batch.batchIndex,
			});
		}
	}

	return {
		dependencyGraph,
		batches,
		totalBatches: batches.length,
		effectiveParallelism,
		requestedParallelism: maxParallel,
		parallelismDelta,
		isOverSerialized,
		warnings,
		errors: [],
	};
}

/**
 * Build the dependency graph from workspaces and their batch assignments.
 *
 * @param workspaces - List of workspaces
 * @param batchAssignment - Map of workspace ID to batch index
 * @returns Dependency graph nodes
 */
function buildDependencyGraph(workspaces: Workspace[], batchAssignment: Map<string, number>): DependencyGraphNode[] {
	// Build dependents map
	const dependentsMap = new Map<string, string[]>();
	for (const ws of workspaces) {
		for (const depId of ws.dependencies) {
			const list = dependentsMap.get(depId) ?? [];
			list.push(ws.id);
			dependentsMap.set(depId, list);
		}
	}

	return workspaces.map((ws) => ({
		id: ws.id,
		title: ws.title,
		dependencies: [...ws.dependencies],
		dependents: dependentsMap.get(ws.id) ?? [],
		batchIndex: batchAssignment.get(ws.id) ?? 0,
	}));
}

// ---------------------------------------------------------------------------
// Suggested fixes
// ---------------------------------------------------------------------------

/**
 * Generate suggested fixes for plan issues based on the batch plan result.
 *
 * @param queue - Original workspace queue
 * @param batchPlan - Computed batch plan result
 * @returns List of suggested fixes
 */
export function generateSuggestedFixes(queue: WorkspaceQueue, batchPlan: BatchPlanResult): SuggestedFix[] {
	const fixes: SuggestedFix[] = [];
	const _workspaceMap = new Map(queue.workspaces.map((w) => [w.id, w]));

	// Suggest removing dependencies for over-serialized plans
	if (batchPlan.isOverSerialized) {
		// Find workspaces in batch > 1 and suggest removing non-essential deps
		for (const node of batchPlan.dependencyGraph) {
			if (node.batchIndex > 1 && node.dependencies.length > 0) {
				for (const depId of node.dependencies) {
					fixes.push({
						id: `fix-serialize-${node.id}-${depId}`,
						category: "remove_dependency",
						description: `Remove dependency ${depId} from ${node.id} to allow parallel execution (plan is over-serialized).`,
						workspaceIds: [node.id],
						patch: {
							workspaceId: node.id,
							action: "remove_dependency",
							dependencyId: depId,
						},
					});
				}
			}
		}
	}

	// Suggest fixing missing dependencies
	for (const error of batchPlan.errors) {
		if (error.type === "missing_dependency" && error.workspaceIds && error.workspaceIds.length >= 2) {
			const wsId = error.workspaceIds[0];
			const missingDepId = error.workspaceIds[1];
			fixes.push({
				id: `fix-missing-${wsId}-${missingDepId}`,
				category: "add_dependency",
				description: `Add missing workspace ${missingDepId} to the plan, or remove the dependency from ${wsId}.`,
				workspaceIds: [wsId],
				patch: {
					workspaceId: wsId,
					action: "remove_dependency",
					dependencyId: missingDepId,
				},
			});
		}
	}

	// Suggest fixing cycles
	for (const error of batchPlan.errors) {
		if (error.type === "cycle" && error.workspaceIds && error.workspaceIds.length >= 2) {
			// Suggest removing one edge to break the cycle
			const cycleNodes = error.workspaceIds;
			if (cycleNodes.length >= 2) {
				const lastInCycle = cycleNodes[cycleNodes.length - 1];
				const firstInCycle = cycleNodes[0];
				fixes.push({
					id: `fix-cycle-${lastInCycle}-${firstInCycle}`,
					category: "resolve_cycle",
					description: `Remove dependency ${firstInCycle} from ${lastInCycle} to break the cycle: ${cycleNodes.join(" -> ")}`,
					workspaceIds: [lastInCycle],
					patch: {
						workspaceId: lastInCycle,
						action: "remove_dependency",
						dependencyId: firstInCycle,
					},
				});
			}
		}
	}

	// Suggest adjusting parallelism when it's higher than effective
	if (!batchPlan.isOverSerialized && batchPlan.parallelismDelta > 0 && batchPlan.effectiveParallelism > 0) {
		fixes.push({
			id: "fix-parallelism",
			category: "adjust_parallelism",
			description: `Lower maxParallelWorkspaces from ${batchPlan.requestedParallelism} to ${batchPlan.effectiveParallelism} to match actual parallelism.`,
			workspaceIds: queue.workspaces.map((w) => w.id),
		});
	}

	return fixes;
}

// ---------------------------------------------------------------------------
// Preview: apply dependency patches without starting execution
// ---------------------------------------------------------------------------

/**
 * Apply dependency patches to a workspace queue and return the preview result.
 *
 * This does NOT start execution — it only simulates the patched queue
 * and validates the result.
 *
 * @param queue - Original workspace queue
 * @param patches - Dependency patches to apply
 * @returns Preview result with the modified queue and batch analysis
 */
export function applyDependencyPatches(queue: WorkspaceQueue, patches: DependencyPatch[]): PreviewResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const appliedPatches: DependencyPatch[] = [];
	const rejectedPatches: Array<{ patch: DependencyPatch; reason: string }> = [];

	// Deep clone the workspaces
	const patchedWorkspaces: Workspace[] = queue.workspaces.map((ws) => ({
		...ws,
		dependencies: [...ws.dependencies],
	}));

	const wsMap = new Map(patchedWorkspaces.map((w) => [w.id, w]));

	for (const patch of patches) {
		const ws = wsMap.get(patch.workspaceId);
		if (!ws) {
			rejectedPatches.push({
				patch,
				reason: `Workspace ${patch.workspaceId} does not exist in the plan`,
			});
			continue;
		}

		if (patch.action === "remove_dependency") {
			const depIndex = ws.dependencies.indexOf(patch.dependencyId);
			if (depIndex === -1) {
				rejectedPatches.push({
					patch,
					reason: `Workspace ${patch.workspaceId} does not depend on ${patch.dependencyId}`,
				});
				continue;
			}
			ws.dependencies.splice(depIndex, 1);
			appliedPatches.push(patch);
		} else if (patch.action === "add_dependency") {
			if (ws.dependencies.includes(patch.dependencyId)) {
				rejectedPatches.push({
					patch,
					reason: `Workspace ${patch.workspaceId} already depends on ${patch.dependencyId}`,
				});
				continue;
			}
			// Check that the dependency target exists
			if (!wsMap.has(patch.dependencyId)) {
				rejectedPatches.push({
					patch,
					reason: `Target dependency ${patch.dependencyId} does not exist in the plan`,
				});
				continue;
			}
			// Check for self-dependency
			if (patch.workspaceId === patch.dependencyId) {
				rejectedPatches.push({
					patch,
					reason: `Workspace ${patch.workspaceId} cannot depend on itself`,
				});
				continue;
			}
			ws.dependencies.push(patch.dependencyId);
			appliedPatches.push(patch);
		}
	}

	// Build the patched queue
	const previewQueue: WorkspaceQueue = {
		...queue,
		workspaces: patchedWorkspaces,
	};

	// Validate the patched queue
	const cycleCheck = detectCycles(patchedWorkspaces);
	if (cycleCheck.hasCycle) {
		errors.push(`Patches created a dependency cycle: ${cycleCheck.cycle?.join(" -> ")}`);
	}

	// Compute batch plan on the patched queue
	const batchPlan = computeBatchPlan(previewQueue);

	// Collect batch plan errors
	for (const err of batchPlan.errors) {
		errors.push(err.message);
	}

	// Collect batch plan warnings
	for (const warn of batchPlan.warnings) {
		warnings.push(warn.message);
	}

	return {
		success: errors.length === 0,
		previewQueue,
		batchPlan,
		errors,
		warnings,
		appliedPatches,
		rejectedPatches,
	};
}

// ---------------------------------------------------------------------------
// Interactive plan approval check
// ---------------------------------------------------------------------------

/**
 * Check if a plan requires interactive approval before execution.
 *
 * A plan requires approval if:
 * - interactiveParallelismReview is enabled in the queue's planExecution config
 * - parallelismReview is enabled on the WorkspaceQueue
 *
 * @param queue - Workspace queue to check
 * @returns Whether the plan requires interactive approval
 */
export function requiresInteractiveApproval(queue: WorkspaceQueue): boolean {
	// Check interactiveParallelismReview in planExecution
	if (queue.planExecution?.interactiveParallelismReview === true) {
		return true;
	}

	// Check parallelismReview
	if (queue.parallelismReview?.enabled) {
		return true;
	}

	return false;
}
