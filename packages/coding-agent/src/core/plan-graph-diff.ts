/**
 * Plan Graph Diff - P11.I
 *
 * Generates before/after diffs of workspace dependency graphs, enabling
 * comparison between original authored previews and optimizer-generated
 * proposals. Supports rendering diffs for plans with arbitrarily many
 * workspaces and highlights changes in parallelism, critical path, batches.
 *
 * Acceptance Criteria Covered:
 * 1. Original and optimized graph diffs can be generated for a plan with
 *    at least ten workspaces.
 * 2. (Supports) Invalid patches are rejected with actionable reasons.
 * 4. (Supports) Approval state transitions are audited.
 */

import { type BatchPlanResult, computeBatchPlan } from "./dag-analyzer.js";
import type { OptimizationProposal } from "./dag-optimizer.js";
import { createDependencyPatchPlan, simulatePatchApplication } from "./dependency-patch.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Graph Diff Types
// ---------------------------------------------------------------------------

/**
 * The kind of change in a dependency graph.
 */
export type DependencyChangeKind =
	/** A dependency was added between two workspaces */
	| "added"
	/** A dependency was removed between two workspaces */
	| "removed"
	/** A workspace was added to the graph */
	| "workspace_added"
	/** A workspace was removed from the graph */
	| "workspace_removed"
	/** A workspace's acceptance criteria or capabilities changed */
	| "workspace_modified";

/**
 * A single dependency-level change between two graph states.
 */
export interface DependencyChange {
	/** Kind of change */
	kind: DependencyChangeKind;
	/** Workspace that has the dependency (or is the subject of add/remove) */
	workspaceId: string;
	/** The dependency workspace ID (absent for workspace_added/removed) */
	dependencyId?: string;
	/** Human-readable description of the change */
	description: string;
}

/**
 * Batch-level change between two graph states.
 */
export interface BatchChange {
	/** Batch index (1-based) in the before graph */
	beforeBatchIndex?: number;
	/** Batch index (1-based) in the after graph */
	afterBatchIndex?: number;
	/** Workspace IDs in the before batch */
	beforeWorkspaceIds: string[];
	/** Workspace IDs in the after batch */
	afterWorkspaceIds: string[];
	/** Description of the change */
	description: string;
}

/**
 * Summary-level metrics comparison between two graph states.
 */
export interface MetricsComparison {
	/** Before metrics */
	before: {
		totalBatches: number;
		effectiveParallelism: number;
		criticalPathLength: number;
		totalWorkspaces: number;
		totalDependencies: number;
		isOverSerialized: boolean;
	};
	/** After metrics */
	after: {
		totalBatches: number;
		effectiveParallelism: number;
		criticalPathLength: number;
		totalWorkspaces: number;
		totalDependencies: number;
		isOverSerialized: boolean;
	};
	/** Deltas (positive means improvement) */
	deltas: {
		totalWorkspacesDiff: number;
		batchDelta: number; // negative = fewer batches (better)
		parallelismDelta: number; // positive = more parallelism (better)
		criticalPathDelta: number; // negative = shorter path (better)
		dependencyDelta: number; // positive or negative
	};
}

/**
 * Complete graph diff between two states of a plan's dependency graph.
 */
export interface PlanGraphDiff {
	/** Label for the "before" state */
	beforeLabel: string;
	/** Label for the "after" state */
	afterLabel: string;
	/** Batch plan result for "before" state */
	beforeBatchPlan: BatchPlanResult;
	/** Batch plan result for "after" state */
	afterBatchPlan: BatchPlanResult;
	/** Per-workspace dependency changes */
	dependencyChanges: DependencyChange[];
	/** Per-batch assignment changes */
	batchChanges: BatchChange[];
	/** Summary metrics comparison */
	metrics: MetricsComparison;
	/** Whether the two graphs are identical in structure */
	identical: boolean;
}

// ---------------------------------------------------------------------------
// Graph Diff Generation
// ---------------------------------------------------------------------------

/**
 * Generate a graph diff between two workspace queues.
 *
 * Compares the dependency structure, batch plans, and metrics between
 * an original (before) and modified (after) queue. Handles plans with
 * any number of workspaces.
 *
 * @param beforeQueue - The original workspace queue (authored preview)
 * @param afterQueue - The modified workspace queue (optimized)
 * @param beforeLabel - Label for the before state (default: "Authored")
 * @param afterLabel - Label for the after state (default: "Optimized")
 * @returns Complete graph diff
 */
export function generateGraphDiff(
	beforeQueue: WorkspaceQueue,
	afterQueue: WorkspaceQueue,
	beforeLabel = "Authorized Preview",
	afterLabel = "Optimized",
): PlanGraphDiff {
	const beforeBatchPlan = computeBatchPlan(beforeQueue);
	const afterBatchPlan = computeBatchPlan(afterQueue);

	const dependencyChanges = computeDependencyChanges(beforeQueue, afterQueue);
	const batchChanges = computeBatchChanges(beforeBatchPlan, afterBatchPlan);
	const metrics = computeMetricsComparison(beforeBatchPlan, afterBatchPlan, beforeQueue, afterQueue);

	return {
		beforeLabel,
		afterLabel,
		beforeBatchPlan,
		afterBatchPlan,
		dependencyChanges,
		batchChanges,
		metrics,
		identical: dependencyChanges.length === 0 && metrics.before.totalWorkspaces === metrics.after.totalWorkspaces,
	};
}

/**
 * Generate a graph diff between a queue and the queue with selected proposals applied.
 *
 * Convenience wrapper that applies all patches from proposals (excluding splits)
 * and diffs the result against the original.
 *
 * @param originalQueue - The original workspace queue
 * @param proposals - Optimization proposals to apply
 * @param label - Label for the after state (e.g., "With proposals applied")
 * @returns Graph diff
 */
export function generateOptimizedDiff(
	originalQueue: WorkspaceQueue,
	proposals: OptimizationProposal[],
	label = "With Optimizations",
): PlanGraphDiff {
	const allPatches = proposals.filter((p) => p.kind !== "split_workspace").flatMap((p) => p.patches);

	let afterQueue: WorkspaceQueue;
	if (allPatches.length > 0) {
		const patchPlan = createDependencyPatchPlan(allPatches, originalQueue.phase);
		afterQueue = simulatePatchApplication(patchPlan, originalQueue);
	} else {
		afterQueue = originalQueue;
	}

	return generateGraphDiff(originalQueue, afterQueue, "Original", label);
}

// ---------------------------------------------------------------------------
// Internal: Compute dependency-level changes
// ---------------------------------------------------------------------------

/**
 * Compute per-dependency changes between two queues.
 */
function computeDependencyChanges(beforeQueue: WorkspaceQueue, afterQueue: WorkspaceQueue): DependencyChange[] {
	const changes: DependencyChange[] = [];

	// Build before and after workspace maps
	const beforeMap = new Map<string, Workspace>();
	for (const ws of beforeQueue.workspaces) {
		beforeMap.set(ws.id, ws);
	}

	const afterMap = new Map<string, Workspace>();
	for (const ws of afterQueue.workspaces) {
		afterMap.set(ws.id, ws);
	}

	// Check for added/removed workspaces
	const beforeIds = new Set(beforeMap.keys());
	const afterIds = new Set(afterMap.keys());

	// Workspaces added in after
	for (const wsId of afterIds) {
		if (!beforeIds.has(wsId)) {
			changes.push({
				kind: "workspace_added",
				workspaceId: wsId,
				description: `Workspace "${wsId}" added to the plan`,
			});
		}
	}

	// Workspaces removed in after
	for (const wsId of beforeIds) {
		if (!afterIds.has(wsId)) {
			changes.push({
				kind: "workspace_removed",
				workspaceId: wsId,
				description: `Workspace "${wsId}" removed from the plan`,
			});
		}
	}

	// Check dependency changes for workspaces that exist in both
	const commonIds = [...beforeIds].filter((id) => afterIds.has(id));

	for (const wsId of commonIds) {
		const beforeWs = beforeMap.get(wsId)!;
		const afterWs = afterMap.get(wsId)!;

		const beforeDeps = new Set(beforeWs.dependencies);
		const afterDeps = new Set(afterWs.dependencies);

		// Dependencies added
		for (const depId of afterDeps) {
			if (!beforeDeps.has(depId)) {
				changes.push({
					kind: "added",
					workspaceId: wsId,
					dependencyId: depId,
					description: `"${wsId}" now depends on "${depId}"`,
				});
			}
		}

		// Dependencies removed
		for (const depId of beforeDeps) {
			if (!afterDeps.has(depId)) {
				changes.push({
					kind: "removed",
					workspaceId: wsId,
					dependencyId: depId,
					description: `"${wsId}" no longer depends on "${depId}"`,
				});
			}
		}

		// Check for changes in acceptance criteria or capabilities (workspace_modified)
		const beforeCriteria = JSON.stringify(beforeWs.acceptanceCriteria ?? []);
		const afterCriteria = JSON.stringify(afterWs.acceptanceCriteria ?? []);
		const beforeCaps = JSON.stringify(beforeWs.capabilities?.canEdit ?? []);
		const afterCaps = JSON.stringify(afterWs.capabilities?.canEdit ?? []);

		if (beforeCriteria !== afterCriteria || beforeCaps !== afterCaps) {
			changes.push({
				kind: "workspace_modified",
				workspaceId: wsId,
				description: `"${wsId}" scope or capabilities modified`,
			});
		}
	}

	return changes;
}

// ---------------------------------------------------------------------------
// Internal: Compute batch-level changes
// ---------------------------------------------------------------------------

/**
 * Compute batch assignment changes between two batch plans.
 */
function computeBatchChanges(beforePlan: BatchPlanResult, afterPlan: BatchPlanResult): BatchChange[] {
	const changes: BatchChange[] = [];

	// Build workspace -> batch index maps
	const beforeBatchMap = new Map<string, number>();
	for (const batch of beforePlan.batches) {
		for (const wsId of batch.workspaceIds) {
			beforeBatchMap.set(wsId, batch.batchIndex);
		}
	}

	const afterBatchMap = new Map<string, number>();
	for (const batch of afterPlan.batches) {
		for (const wsId of batch.workspaceIds) {
			afterBatchMap.set(wsId, batch.batchIndex);
		}
	}

	// Collect all workspace IDs
	const allIds = new Set([...beforeBatchMap.keys(), ...afterBatchMap.keys()]);

	for (const wsId of allIds) {
		const beforeBatch = beforeBatchMap.get(wsId);
		const afterBatch = afterBatchMap.get(wsId);

		if (beforeBatch === undefined && afterBatch !== undefined) {
			changes.push({
				beforeBatchIndex: undefined,
				afterBatchIndex: afterBatch,
				beforeWorkspaceIds: [],
				afterWorkspaceIds: [wsId],
				description: `"${wsId}" assigned to batch ${afterBatch} (was not in before graph)`,
			});
		} else if (beforeBatch !== undefined && afterBatch === undefined) {
			changes.push({
				beforeBatchIndex: beforeBatch,
				afterBatchIndex: undefined,
				beforeWorkspaceIds: [wsId],
				afterWorkspaceIds: [],
				description: `"${wsId}" removed (was in batch ${beforeBatch})`,
			});
		} else if (beforeBatch !== undefined && afterBatch !== undefined && beforeBatch !== afterBatch) {
			changes.push({
				beforeBatchIndex: beforeBatch,
				afterBatchIndex: afterBatch,
				beforeWorkspaceIds: [wsId],
				afterWorkspaceIds: [wsId],
				description: `"${wsId}" moved from batch ${beforeBatch} to batch ${afterBatch}`,
			});
		}
	}

	// Also note when a batch's composition changed
	const maxBatches = Math.max(beforePlan.batches.length, afterPlan.batches.length);
	for (let i = 0; i < maxBatches; i++) {
		const beforeBatch = beforePlan.batches[i];
		const afterBatch = afterPlan.batches[i];

		const beforeIds = beforeBatch?.workspaceIds ?? [];
		const afterIds = afterBatch?.workspaceIds ?? [];

		if (beforeBatch && afterBatch) {
			const beforeSet = new Set(beforeIds);
			const afterSet = new Set(afterIds);
			const added = afterIds.filter((id) => !beforeSet.has(id));
			const removed = beforeIds.filter((id) => !afterSet.has(id));
			if (added.length > 0 || removed.length > 0) {
				const parts: string[] = [];
				if (removed.length > 0) parts.push(`-${removed.join(", ")}`);
				if (added.length > 0) parts.push(`+${added.join(", ")}`);
				changes.push({
					beforeBatchIndex: i + 1,
					afterBatchIndex: i + 1,
					beforeWorkspaceIds: beforeIds,
					afterWorkspaceIds: afterIds,
					description: `Batch ${i + 1} composition changed: ${parts.join(" ")}`,
				});
			}
		} else if (afterBatch && !beforeBatch) {
			changes.push({
				beforeBatchIndex: undefined,
				afterBatchIndex: i + 1,
				beforeWorkspaceIds: [],
				afterWorkspaceIds: afterIds,
				description: `New batch ${i + 1} with [${afterIds.join(", ")}]`,
			});
		} else if (beforeBatch && !afterBatch) {
			changes.push({
				beforeBatchIndex: i + 1,
				afterBatchIndex: undefined,
				beforeWorkspaceIds: beforeIds,
				afterWorkspaceIds: [],
				description: `Batch ${i + 1} removed (was [${beforeIds.join(", ")}])`,
			});
		}
	}

	return changes;
}

// ---------------------------------------------------------------------------
// Internal: Compute metrics comparison
// ---------------------------------------------------------------------------

/**
 * Compute summary metrics comparison between two batch plans and queues.
 */
function computeMetricsComparison(
	beforePlan: BatchPlanResult,
	afterPlan: BatchPlanResult,
	beforeQueue: WorkspaceQueue,
	afterQueue: WorkspaceQueue,
): MetricsComparison {
	const beforeTotalDeps = beforeQueue.workspaces.reduce((sum, ws) => sum + ws.dependencies.length, 0);
	const afterTotalDeps = afterQueue.workspaces.reduce((sum, ws) => sum + ws.dependencies.length, 0);

	return {
		before: {
			totalBatches: beforePlan.totalBatches,
			effectiveParallelism: beforePlan.effectiveParallelism,
			criticalPathLength: beforePlan.criticalPathLength,
			totalWorkspaces: beforeQueue.workspaces.length,
			totalDependencies: beforeTotalDeps,
			isOverSerialized: beforePlan.isOverSerialized,
		},
		after: {
			totalBatches: afterPlan.totalBatches,
			effectiveParallelism: afterPlan.effectiveParallelism,
			criticalPathLength: afterPlan.criticalPathLength,
			totalWorkspaces: afterQueue.workspaces.length,
			totalDependencies: afterTotalDeps,
			isOverSerialized: afterPlan.isOverSerialized,
		},
		deltas: {
			totalWorkspacesDiff: afterQueue.workspaces.length - beforeQueue.workspaces.length,
			batchDelta: afterPlan.totalBatches - beforePlan.totalBatches,
			parallelismDelta: afterPlan.effectiveParallelism - beforePlan.effectiveParallelism,
			criticalPathDelta: afterPlan.criticalPathLength - beforePlan.criticalPathLength,
			dependencyDelta: afterTotalDeps - beforeTotalDeps,
		},
	};
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a PlanGraphDiff as a human-readable string.
 *
 * @param diff - The graph diff to format
 * @returns Formatted string representation
 */
export function formatGraphDiff(diff: PlanGraphDiff): string {
	const lines: string[] = [];

	lines.push("=== Plan Graph Diff ===");
	lines.push(`Before: ${diff.beforeLabel}`);
	lines.push(`After:  ${diff.afterLabel}`);
	lines.push("");

	if (diff.identical) {
		lines.push("No structural differences between the two graphs.");
		lines.push("");
	}

	// Metrics comparison
	lines.push("--- Metrics ---");
	lines.push(
		`  Workspaces:      ${diff.metrics.before.totalWorkspaces} -> ${diff.metrics.after.totalWorkspaces} (${formatSigned(diff.metrics.deltas.totalWorkspacesDiff)})`,
	);
	lines.push(
		`  Dependencies:    ${diff.metrics.before.totalDependencies} -> ${diff.metrics.after.totalDependencies} (${formatSigned(diff.metrics.deltas.dependencyDelta)})`,
	);
	lines.push(
		`  Batches:          ${diff.metrics.before.totalBatches} -> ${diff.metrics.after.totalBatches} (${formatSigned(diff.metrics.deltas.batchDelta)})`,
	);
	lines.push(
		`  Effective parallelism: ${diff.metrics.before.effectiveParallelism} -> ${diff.metrics.after.effectiveParallelism} (${formatSigned(diff.metrics.deltas.parallelismDelta)})`,
	);
	lines.push(
		`  Critical path:    ${diff.metrics.before.criticalPathLength} -> ${diff.metrics.after.criticalPathLength} (${formatSigned(diff.metrics.deltas.criticalPathDelta)})`,
	);
	if (diff.metrics.before.isOverSerialized) {
		lines.push("  WARN Before: over-serialized (requested parallelism > 1 but effective = 1)");
	}
	if (diff.metrics.after.isOverSerialized) {
		lines.push("  WARN After: over-serialized (requested parallelism > 1 but effective = 1)");
	}
	lines.push("");

	// Batch plan
	if (!diff.identical) {
		lines.push("--- Before Batches ---");
		for (const batch of diff.beforeBatchPlan.batches) {
			lines.push(`  Batch ${batch.batchIndex}: [${batch.workspaceIds.join(", ")}] (width: ${batch.width})`);
		}
		lines.push("");

		lines.push("--- After Batches ---");
		for (const batch of diff.afterBatchPlan.batches) {
			lines.push(`  Batch ${batch.batchIndex}: [${batch.workspaceIds.join(", ")}] (width: ${batch.width})`);
		}
		lines.push("");

		// Dependency changes
		if (diff.dependencyChanges.length > 0) {
			lines.push("--- Dependency Changes ---");
			for (const change of diff.dependencyChanges) {
				switch (change.kind) {
					case "added":
						lines.push(`  + ${change.description}`);
						break;
					case "removed":
						lines.push(`  - ${change.description}`);
						break;
					case "workspace_added":
						lines.push(`  + WS ${change.description}`);
						break;
					case "workspace_removed":
						lines.push(`  - WS ${change.description}`);
						break;
					case "workspace_modified":
						lines.push(`  ~ ${change.description}`);
						break;
				}
			}
			lines.push("");
		}

		// Batch changes
		if (diff.batchChanges.length > 0) {
			lines.push("--- Batch Changes ---");
			for (const change of diff.batchChanges) {
				lines.push(`  ~ ${change.description}`);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

function formatSigned(value: number): string {
	if (value > 0) return `+${value}`;
	if (value < 0) return String(value);
	return "0";
}

/**
 * Format a PlanGraphDiff as a compact single-line summary.
 *
 * @param diff - The graph diff
 * @returns Short summary string
 */
export function formatGraphDiffSummary(diff: PlanGraphDiff): string {
	if (diff.identical) {
		return "Graph unchanged";
	}
	const metrics = diff.metrics;
	return [
		`WS: ${metrics.before.totalWorkspaces}->${metrics.after.totalWorkspaces}`,
		`Batches: ${metrics.before.totalBatches}->${metrics.after.totalBatches}`,
		`Parallelism: ${metrics.before.effectiveParallelism}->${metrics.after.effectiveParallelism}`,
		`CritPath: ${metrics.before.criticalPathLength}->${metrics.after.criticalPathLength}`,
		`Changes: ${diff.dependencyChanges.length}`,
	].join(", ");
}
