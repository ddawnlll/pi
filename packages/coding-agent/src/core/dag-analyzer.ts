/**
 * DAG Analyzer and Batch Planner - P2 Workstream 7.B
 *
 * Computes topological batches from workspace dependencies, analyzes effective
 * parallelism vs requested parallelism, detects over-serialization, and explains
 * why each workspace is blocked.
 *
 * Acceptance Criteria:
 * 1. Computes topological batches from workspace dependencies
 * 2. Computes effective parallelism and requested-vs-effective delta
 * 3. Detects over-serialization where maxParallelWorkspaces > 1 but effective width is 1
 * 4. Explains why each workspace is blocked
 */

import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";
import { detectCycles } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Batch Types
// ---------------------------------------------------------------------------

/**
 * A single topological batch — all workspaces in this batch can run in parallel
 * because their dependencies are satisfied by earlier batches.
 */
export interface TopologicalBatch {
	/** 1-based batch index (Batch 1 runs first) */
	batchIndex: number;
	/** Workspace IDs in this batch */
	workspaceIds: string[];
	/** Number of workspaces in this batch (= effective width at this layer) */
	width: number;
}

/**
 * Explanation for why a workspace is blocked (not in the earliest possible batch).
 */
export interface BlockExplanation {
	/** Workspace ID that is blocked */
	workspaceId: string;
	/** Batch this workspace lands in (0 if no batch assigned due to errors) */
	batchIndex: number;
	/** List of dependency IDs that caused the block */
	blockedBy: string[];
	/** Human-readable reason */
	reason: string;
}

/**
 * Result of computing topological batches from a workspace queue.
 */
export interface BatchPlanResult {
	/** Topological batches in execution order */
	batches: TopologicalBatch[];
	/** Total number of batches (= critical path length) */
	totalBatches: number;
	/** Maximum width across all batches (= effective parallelism) */
	effectiveParallelism: number;
	/** The maxParallelWorkspaces from the queue (= requested parallelism) */
	requestedParallelism: number;
	/** Delta between requested and effective parallelism */
	parallelismDelta: number;
	/** Whether the plan is over-serialized: requested > 1 but effective = 1 */
	isOverSerialized: boolean;
	/** Length of the critical path (= totalBatches, the longest dependency chain through the DAG) */
	criticalPathLength: number;
	/** Number of consecutive single-width batches at the end of the plan */
	serializedTailLength: number;
	/** Explanation for why each workspace is in its batch (not earlier) */
	blockExplanations: BlockExplanation[];
	/** Warnings (cycles, missing deps, etc.) */
	warnings: BatchPlanWarning[];
	/** Errors that prevented batch computation */
	errors: BatchPlanError[];
}

/**
 * Warning about the batch plan (non-fatal issues).
 */
export interface BatchPlanWarning {
	/** Warning type */
	type: "over_serialized" | "low_effective_parallelism" | "single_width_batch" | "file_overlap";
	/** Human-readable message */
	message: string;
	/** Workspace IDs involved */
	workspaceIds?: string[];
	/** Batch index involved */
	batchIndex?: number;
}

/**
 * Error that prevented batch computation.
 */
export interface BatchPlanError {
	/** Error type */
	type: "cycle" | "missing_dependency" | "empty_queue";
	/** Human-readable message */
	message: string;
	/** Workspace IDs involved */
	workspaceIds?: string[];
}

// ---------------------------------------------------------------------------
// Core: Compute Topological Batches
// ---------------------------------------------------------------------------

/**
 * Compute topological batches from a workspace queue.
 *
 * Uses Kahn's algorithm to group workspaces into batches where all workspaces
 * in the same batch have their dependencies fully satisfied by earlier batches.
 * Also computes effective parallelism, detects over-serialization, and explains
 * why each workspace is blocked from running earlier.
 *
 * @param queue - Workspace queue to analyze
 * @returns Batch plan result with batches, parallelism metrics, and block explanations
 */
export function computeBatchPlan(queue: WorkspaceQueue): BatchPlanResult {
	const workspaces = queue.workspaces;
	const maxParallel = queue.maxParallelWorkspaces;

	// Edge case: empty queue
	if (!workspaces || workspaces.length === 0) {
		return {
			batches: [],
			totalBatches: 0,
			effectiveParallelism: 0,
			requestedParallelism: maxParallel,
			parallelismDelta: maxParallel,
			isOverSerialized: false,
			criticalPathLength: 0,
			serializedTailLength: 0,
			blockExplanations: [],
			warnings: [],
			errors: [{ type: "empty_queue", message: "Workspace queue is empty" }],
		};
	}

	// Detect cycles
	const cycleResult = detectCycles(workspaces);
	if (cycleResult.hasCycle) {
		return {
			batches: [],
			totalBatches: 0,
			effectiveParallelism: 0,
			requestedParallelism: maxParallel,
			parallelismDelta: maxParallel,
			isOverSerialized: false,
			criticalPathLength: 0,
			serializedTailLength: 0,
			blockExplanations: [],
			warnings: [],
			errors: [
				{
					type: "cycle",
					message: `Dependency cycle detected: ${cycleResult.cycle?.join(" → ")}`,
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
			batches: [],
			totalBatches: 0,
			effectiveParallelism: 0,
			requestedParallelism: maxParallel,
			parallelismDelta: maxParallel,
			isOverSerialized: false,
			criticalPathLength: 0,
			serializedTailLength: 0,
			blockExplanations: [],
			warnings: [],
			errors,
		};
	}

	// Build in-degree map and adjacency list
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>(); // dep -> [ws that depend on dep]
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
	const batchAssignment = new Map<string, number>(); // ws id -> batch index (1-based)
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

		// Record batch assignment
		for (const wsId of currentBatch) {
			batchAssignment.set(wsId, batchIndex);
		}

		// Reduce in-degree for dependents
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

	// Compute effective parallelism (max width across all batches)
	const effectiveParallelism = batches.length > 0 ? Math.max(...batches.map((b) => b.width)) : 0;

	// Compute delta (positive means under-utilizing capacity)
	const parallelismDelta = maxParallel - effectiveParallelism;

	// Detect over-serialization
	const isOverSerialized = maxParallel > 1 && effectiveParallelism === 1;

	// Build block explanations for every workspace that is NOT in batch 1
	const blockExplanations: BlockExplanation[] = [];
	for (const ws of workspaces) {
		const assignedBatch = batchAssignment.get(ws.id) ?? 0;
		if (assignedBatch <= 1) continue; // Not blocked (in first batch or unassigned)

		const blockedBy: string[] = [];
		const reasons: string[] = [];

		for (const depId of ws.dependencies) {
			const depBatch = batchAssignment.get(depId) ?? 0;
			// A dependency blocks this workspace if it lands in an earlier batch
			// (which is always true for a valid DAG, but we explain which deps
			// determined the batch assignment)
			if (depBatch >= assignedBatch) {
				// This shouldn't happen in a valid DAG; skip
				continue;
			}
			// Check if this dep is the reason the workspace is in this batch
			// (i.e., the dep's batch + 1 equals or exceeds the workspace's batch)
			if (depBatch + 1 === assignedBatch) {
				// This is on the critical-path dependency
				blockedBy.push(depId);
				reasons.push(
					`depends on ${depId} (batch ${depBatch}), which must complete before this workspace can start`,
				);
			} else {
				// This dep is on an earlier batch; it's a prerequisite but not
				// the reason this workspace is in this specific batch
				blockedBy.push(depId);
				reasons.push(`depends on ${depId} (batch ${depBatch})`);
			}
		}

		const reason =
			reasons.length > 0
				? `Blocked by dependencies: ${reasons.join("; ")}`
				: "No blocking dependencies (workspace is in first batch)";

		blockExplanations.push({
			workspaceId: ws.id,
			batchIndex: assignedBatch,
			blockedBy,
			reason,
		});
	}

	// Also include batch-1 workspaces with empty block explanation (not blocked)
	// No — blockExplanations only needs to explain *blocked* workspaces (AC4).
	// But we include workspaces with dependencies for completeness if they are trivially blocked.
	// Actually, re-reading AC4: "Explains why each workspace is blocked"
	// Workspaces in batch 1 are NOT blocked; they have no unsatisfied deps.

	// Generate warnings
	const warnings: BatchPlanWarning[] = [];

	if (isOverSerialized) {
		warnings.push({
			type: "over_serialized",
			message: `Plan requests ${maxParallel} parallel workspaces but the dependency graph is fully serialized (effective parallelism = 1). Consider removing unnecessary dependencies to increase concurrency.`,
			workspaceIds: workspaces.map((w) => w.id),
		});
	}

	if (!isOverSerialized && effectiveParallelism > 0 && effectiveParallelism < maxParallel) {
		warnings.push({
			type: "low_effective_parallelism",
			message: `Effective parallelism (${effectiveParallelism}) is below requested (${maxParallel}). Some worker capacity will be unused. Consider reviewing dependency graph for serialization opportunities.`,
			workspaceIds: workspaces.map((w) => w.id),
		});
	}

	// Check for single-width batches in the middle (serialization bottlenecks)
	for (const batch of batches) {
		if (batch.width === 1 && batches.length > 1 && batch.batchIndex > 1 && batch.batchIndex < batches.length) {
			const wsId = batch.workspaceIds[0];
			warnings.push({
				type: "single_width_batch",
				message: `Batch ${batch.batchIndex} has only 1 workspace (${wsId}), creating a serialization bottleneck. Other workspaces must wait for it to complete.`,
				workspaceIds: batch.workspaceIds,
				batchIndex: batch.batchIndex,
			});
		}
	}

	// Compute critical path length (= total number of batches)
	const criticalPathLength = batches.length;

	// Compute serialized tail length: number of consecutive single-width batches at the end
	let serializedTailLength = 0;
	for (let i = batches.length - 1; i >= 0; i--) {
		if (batches[i].width === 1) {
			serializedTailLength++;
		} else {
			break;
		}
	}

	// Detect file overlap between workspaces in the same batch (same-file parallelism violation)
	const fileOverlapWarnings = detectFileOverlaps(workspaces, batches);
	warnings.push(...fileOverlapWarnings);

	return {
		batches,
		totalBatches: batches.length,
		effectiveParallelism,
		requestedParallelism: maxParallel,
		parallelismDelta,
		isOverSerialized,
		criticalPathLength,
		serializedTailLength,
		blockExplanations,
		warnings,
		errors: [],
	};
}

// ---------------------------------------------------------------------------
// File Overlap Detection
// ---------------------------------------------------------------------------

/**
 * Detect file overlap between workspaces in the same batch.
 *
 * Workspaces in the same batch that share canEdit files cannot actually run
 * concurrently, which means effective parallelism is lower than it appears.
 *
 * @param workspaces - All workspaces
 * @param batches - Topological batches
 * @returns Warnings for file overlaps
 */
function detectFileOverlaps(workspaces: Workspace[], batches: TopologicalBatch[]): BatchPlanWarning[] {
	const warnings: BatchPlanWarning[] = [];
	const wsMap = new Map(workspaces.map((w) => [w.id, w]));

	for (const batch of batches) {
		if (batch.workspaceIds.length <= 1) continue;

		// Collect all canEdit files for each workspace in this batch
		const filesByWorkspace = new Map<string, Set<string>>();
		for (const wsId of batch.workspaceIds) {
			const ws = wsMap.get(wsId);
			if (ws?.capabilities?.canEdit) {
				filesByWorkspace.set(wsId, new Set(ws.capabilities.canEdit));
			}
		}

		// Check pairs
		const ids = batch.workspaceIds;
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const files1 = filesByWorkspace.get(ids[i]);
				const files2 = filesByWorkspace.get(ids[j]);
				if (!files1 || !files2) continue;

				const overlap = [...files1].filter((f) => files2.has(f));
				if (overlap.length > 0) {
					warnings.push({
						type: "file_overlap",
						message: `Workspaces ${ids[i]} and ${ids[j]} in batch ${batch.batchIndex} share editable files: ${overlap.join(", ")}. Same-file parallelism is forbidden; effective parallelism is lower than batch width.`,
						workspaceIds: [ids[i], ids[j]],
						batchIndex: batch.batchIndex,
					});
				}
			}
		}
	}

	return warnings;
}

// ---------------------------------------------------------------------------
// Blocked Workspace Analysis (detailed per-workspace block reasons)
// ---------------------------------------------------------------------------

/**
 * Detailed block reason for a single workspace.
 */
export interface WorkspaceBlockDetail {
	/** Workspace ID */
	workspaceId: string;
	/** Whether this workspace is blocked (not in batch 1) */
	isBlocked: boolean;
	/** Batch this workspace is assigned to */
	batchIndex: number;
	/** Dependencies that must complete before this workspace can start */
	requiredDependencies: string[];
	/**
	 * Dependencies that are on the critical path for this workspace.
	 * These are the deps whose completion is what determines which batch
	 * this workspace lands in.
	 */
	criticalPathDependencies: string[];
	/** Human-readable reason */
	reason: string;
	/**
	 * The workspace's dependencyReason field (if provided in the plan).
	 * Maps dependency ID -> human-readable reason for that dependency.
	 */
	dependencyReasons: Record<string, string>;
}

/**
 * Compute detailed block reasons for all workspaces in a queue.
 *
 * This is the "plan doctor" view — it explains *why* each workspace is blocked
 * and which specific dependencies are responsible.
 *
 * @param queue - Workspace queue to analyze
 * @returns Detailed block reasons for each workspace
 */
export function computeBlockDetails(queue: WorkspaceQueue): WorkspaceBlockDetail[] {
	const workspaces = queue.workspaces;
	const result = computeBatchPlan(queue);

	// If there are errors, return minimal results
	if (result.errors.length > 0) {
		return workspaces.map((ws) => ({
			workspaceId: ws.id,
			isBlocked: false,
			batchIndex: 0,
			requiredDependencies: ws.dependencies,
			criticalPathDependencies: [],
			reason: `Cannot compute batches: ${result.errors.map((e) => e.message).join("; ")}`,
			dependencyReasons: ws.dependencyReason ?? {},
		}));
	}

	const batchAssignment = new Map<string, number>();
	for (const batch of result.batches) {
		for (const wsId of batch.workspaceIds) {
			batchAssignment.set(wsId, batch.batchIndex);
		}
	}

	return workspaces.map((ws) => {
		const assignedBatch = batchAssignment.get(ws.id) ?? 0;
		const isBlocked = assignedBatch > 1;
		const depReasons = ws.dependencyReason ?? {};

		const criticalPathDependencies: string[] = [];
		for (const depId of ws.dependencies) {
			const depBatch = batchAssignment.get(depId) ?? 0;
			if (depBatch + 1 === assignedBatch) {
				criticalPathDependencies.push(depId);
			}
		}

		// Build human-readable reason
		let reason: string;
		if (!isBlocked) {
			reason = "No blocking dependencies — workspace can start immediately";
		} else {
			const depReasonParts: string[] = [];
			for (const depId of ws.dependencies) {
				const depBatch = batchAssignment.get(depId) ?? 0;
				const humanReason = depReasons[depId];
				if (humanReason) {
					depReasonParts.push(`${depId} (batch ${depBatch}): ${humanReason})`);
				} else {
					depReasonParts.push(`${depId} (batch ${depBatch})`);
				}
			}
			reason = `Blocked until dependencies complete: ${depReasonParts.join("; ")}`;
		}

		return {
			workspaceId: ws.id,
			isBlocked,
			batchIndex: assignedBatch,
			requiredDependencies: ws.dependencies,
			criticalPathDependencies,
			reason,
			dependencyReasons: depReasons,
		};
	});
}

// ---------------------------------------------------------------------------
// Formatting Utilities
// ---------------------------------------------------------------------------

/**
 * Format a batch plan result for human-readable display.
 *
 * @param result - Batch plan result
 * @returns Formatted string
 */
export function formatBatchPlan(result: BatchPlanResult): string {
	const lines: string[] = [];

	lines.push("=== DAG Batch Plan ===");
	lines.push("");

	if (result.errors.length > 0) {
		lines.push("ERRORS (cannot compute batches):");
		for (const err of result.errors) {
			lines.push(`  ✗ ${err.message}`);
		}
		return lines.join(", ");
	}

	// Parallelism summary
	lines.push(`Requested parallelism: ${result.requestedParallelism}`);
	lines.push(`Effective parallelism: ${result.effectiveParallelism}`);
	lines.push(
		`Parallelism delta:    ${result.parallelismDelta > 0 ? `+${result.parallelismDelta}` : String(result.parallelismDelta)} (unused capacity)`,
	);
	if (result.isOverSerialized) {
		lines.push("⚠ OVER-SERIALIZED: maxParallel > 1 but effective width = 1");
	}
	lines.push("");

	// Batch layout
	lines.push(`Batches (${result.totalBatches} total):`);
	for (const batch of result.batches) {
		const ids = batch.workspaceIds.join(", ");
		lines.push(`  Batch ${batch.batchIndex}: [${ids}] (width: ${batch.width})`);
	}
	lines.push("");

	// Block explanations
	if (result.blockExplanations.length > 0) {
		lines.push("Block explanations:");
		for (const block of result.blockExplanations) {
			lines.push(`  ${block.workspaceId} (batch ${block.batchIndex}): ${block.reason}`);
		}
		lines.push("");
	}

	// Warnings
	if (result.warnings.length > 0) {
		lines.push("Warnings:");
		for (const warn of result.warnings) {
			lines.push(`  ⚠ ${warn.message}`);
		}
	}

	return lines.join(", ");
}

/**
 * Format block details for human-readable display.
 *
 * @param details - Block details for each workspace
 * @returns Formatted string
 */
export function formatBlockDetails(details: WorkspaceBlockDetail[]): string {
	const lines: string[] = [];

	lines.push("=== Workspace Block Analysis ===");
	lines.push("");

	for (const detail of details) {
		if (!detail.isBlocked) {
			lines.push(`${detail.workspaceId} (batch ${detail.batchIndex}): ✓ Ready — ${detail.reason}`);
		} else {
			lines.push(`${detail.workspaceId} (batch ${detail.batchIndex}): ✗ Blocked — ${detail.reason}`);
			if (detail.criticalPathDependencies.length > 0) {
				lines.push(`  Critical path deps: ${detail.criticalPathDependencies.join(", ")}`);
			}
		}
	}

	return lines.join(", ");
}
