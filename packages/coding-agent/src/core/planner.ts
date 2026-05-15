/**
 * Autonomous Planner Core - P7.A
 *
 * Pure analysis planner that computes optimized batch plans from workspace
 * queues. The planner never executes code or mutates repo state. Its output
 * is purely advisory and must be explicitly approved before any execution
 * takes place.
 *
 * Acceptance Criteria:
 * 1. Planner emits optimizedBatches, criticalPath, plannerWarnings,
 *    plannerSuggestions, and predictedParallelism.
 * 2. Planner never executes code or mutates repo state.
 * 3. Planner output is advisory until human approval.
 */

import type { PlannerMemory, PlannerMemoryEntry } from "../memory/planner-memory.js";
import { type BatchPlanResult, computeBatchPlan } from "./dag-analyzer.js";
import { analyzeOptimizationOpportunities } from "./dag-optimizer.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Planner Output Types
// ---------------------------------------------------------------------------

/**
 * An optimized batch — a group of workspaces that can execute in parallel.
 *
 * Extends the topological batch concept with optimization annotations
 * that explain why workspaces are grouped together and whether the
 * batch could be further parallelized with plan changes.
 */
export interface OptimizedBatch {
	/** 1-based batch index (Batch 1 runs first) */
	batchIndex: number;
	/** Workspace IDs in this batch */
	workspaceIds: string[];
	/** Number of workspaces in this batch */
	width: number;
	/** Optimization notes explaining grouping rationale */
	optimizationNotes: string[];
	/**
	 * Whether this batch is a bottleneck.
	 * A batch is a bottleneck if it constrains overall plan throughput
	 * (e.g., single-width batch in the middle of the plan, or a batch
	 * that could be split across multiple parallel lanes).
	 */
	isBottleneck: boolean;
	/**
	 * Whether this batch is running at full capacity relative to
	 * the requested parallelism.
	 */
	isAtCapacity: boolean;
}

/**
 * Critical path information.
 *
 * The critical path is the longest dependency chain through the plan.
 * It determines the minimum possible execution wall-clock time in a
 * fully-parallelized execution.
 */
export interface CriticalPathInfo {
	/** Workspace IDs in critical path order (entry -> leaf) */
	path: string[];
	/** Length of the critical path (number of workspaces) */
	length: number;
	/**
	 * For each workspace on the critical path, the dependency that
	 * places it on the critical path (i.e., the dependency whose
	 * completion determines when this workspace can start).
	 * Key = workspace ID, value = dependency workspace ID.
	 */
	dependencies: Record<string, string>;
	/**
	 * The total number of batches in the plan (= critical path length
	 * in terms of parallel execution steps).
	 */
	batchCount: number;
	/**
	 * Estimated wall-clock time saved if the critical path could be
	 * shortened by one batch (human-readable).
	 */
	bottleneckImpact: string;
}

/**
 * A warning about the plan.
 *
 * Warnings are non-fatal issues that the user should be aware of
 * before approving the plan.
 */
export interface PlannerWarning {
	/** Warning type identifier */
	type: "over_serialized" | "low_effective_parallelism" | "single_width_batch" | "file_overlap" | "bottleneck";
	/** Human-readable message */
	message: string;
	/** Workspace IDs involved (if applicable) */
	workspaceIds?: string[];
	/** Batch index involved (if applicable) */
	batchIndex?: number;
}

/**
 * A suggestion for improving the plan.
 *
 * Suggestions are actionable recommendations that would improve
 * parallelism, reduce execution time, or resolve bottlenecks.
 * Each suggestion includes an explanation of the expected benefit.
 */
export interface PlannerSuggestion {
	/** Suggestion type identifier */
	type:
		| "add_parallel_group"
		| "remove_dependency"
		| "split_workspace"
		| "increase_parallelism"
		| "reduce_parallelism"
		| "reorder_workspaces"
		| "regroup_batches"
		| "add_serialization"
		| "remove_serialization";
	/** Human-readable description of the suggestion */
	message: string;
	/** Whether this suggestion requires human approval to apply */
	requiresApproval: boolean;
	/** Expected benefit if the suggestion is applied */
	expectedBenefit: string;
	/** Workspace IDs relevant to this suggestion */
	workspaceIds?: string[];
}

/**
 * Predicted parallelism metrics.
 *
 * These are the planner's best estimate of how parallel execution
 * will perform given the current workspace dependency graph.
 */
export interface PredictedParallelism {
	/** Requested parallelism (maxParallelWorkspaces) */
	requested: number;
	/** Effective parallelism (max width across all batches) */
	effective: number;
	/** Total number of batches (steps in the execution plan) */
	totalBatches: number;
	/**
	 * Predicted resource utilization percentage.
	 * 100% means all worker slots are used at peak efficiency.
	 * Lower values indicate unused capacity.
	 */
	resourceUtilizationPercent: number;
	/**
	 * Bottleneck analysis — workspaces or batches that constrain
	 * the overall execution time.
	 */
	bottlenecks: string[];
	/**
	 * Whether the effective parallelism could be improved
	 * by increasing maxParallelWorkspaces.
	 */
	parallelismHeadroom: boolean;
	/**
	 * The maxParallelWorkspaces value at which the graph would
	 * be fully saturated (no further benefit from more workers).
	 */
	saturationPoint: number;
}

/**
 * Complete planner output.
 *
 * This is the top-level output of the planner. It is purely
 * advisory — the plan must be explicitly approved before any
 * execution takes place.
 */
export interface PlannerOutput {
	/** Whether planning succeeded */
	success: boolean;
	/** Optimized batch plan with annotations */
	optimizedBatches: OptimizedBatch[];
	/** Critical path analysis */
	criticalPath: CriticalPathInfo;
	/** Warnings about the plan */
	plannerWarnings: PlannerWarning[];
	/** Suggestions for improving the plan */
	plannerSuggestions: PlannerSuggestion[];
	/** Predicted parallelism metrics */
	predictedParallelism: PredictedParallelism;
	/** Underlying batch plan result (for tooling) */
	batchPlan?: BatchPlanResult;
	/**
	 * Optimized batch plan showing what the plan would look like if all
	 * suggestions were applied. Only present when optimization proposals
	 * are generated. Null if no optimizations are possible.
	 */
	optimizedBatchPlan?: BatchPlanResult;
	/**
	 * Expected parallelism gain from applying all suggestions.
	 * This is the difference between effective parallelism of the optimized
	 * plan and the current plan. Null if no optimizations are possible.
	 */
	expectedParallelismGain?: number;
	/** Human-readable summary of the plan */
	summary: string;
}

/**
 * Planner configuration options.
 */
export interface PlannerOptions {
	/**
	 * Whether to include the underlying BatchPlanResult in the output.
	 * Default: false.
	 */
	includeBatchPlanResult?: boolean;
	/**
	 * Planner memory instance for recording and retrieving past plan evidence.
	 * When provided, suggestions include evidence from relevant past plans.
	 * Default: undefined (no memory).
	 */
	plannerMemory?: PlannerMemory;
	/**
	 * Risk model adjustments from the feedback loop (P7.F).
	 * Maps workspace ID to adjusted risk level. When provided, the planner
	 * uses these adjusted risk levels instead of the workspace's default
	 * riskLevel for generating suggestions and predictions.
	 * Default: undefined (no adjustments).
	 */
	riskAdjustments?: Record<string, "low" | "medium" | "high">;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Autonomous Planner Core.
 *
 * Analyzes workspace queues and produces optimized batch plans,
 * critical path analysis, warnings, suggestions, and parallelism
 * predictions. The planner is a pure analysis module — it never
 * executes code or mutates repo state. Its output is advisory
 * until explicitly approved by a human.
 *
 * @example
 * ```typescript
 * const planner = new Planner();
 * const output = planner.plan(queue);
 * console.log(output.summary);
 * // Review and approve before executing:
 * if (humanApproved) {
 *   executor.execute(queue, output.optimizedBatches);
 * }
 * ```
 */
export class Planner {
	private options: {
		includeBatchPlanResult: boolean;
	};
	private plannerMemory?: PlannerMemory;
	private riskAdjustments?: Record<string, "low" | "medium" | "high">;

	/**
	 * @param options - Optional configuration
	 */
	constructor(options: PlannerOptions = {}) {
		this.options = {
			includeBatchPlanResult: options.includeBatchPlanResult ?? false,
		};
		this.plannerMemory = options.plannerMemory;
		this.riskAdjustments = options.riskAdjustments;
	}

	/**
	 * Plan execution for a workspace queue.
	 *
	 * Produces an optimized batch plan with annotations, critical path
	 * analysis, warnings, suggestions, and parallelism predictions.
	 *
	 * This method is **pure** — it does not execute any code, does not
	 * read or write files, does not mutate system state. The output is
	 * purely advisory and must be explicitly approved before execution.
	 *
	 * @param queue - Workspace queue to plan
	 * @returns Planner output (advisory — requires human approval before execution)
	 */
	async plan(queue: WorkspaceQueue): Promise<PlannerOutput> {
		// Compute the batch plan using the DAG analyzer
		const batchPlan = computeBatchPlan(queue);

		// If the batch plan has errors, return an error output
		if (batchPlan.errors.length > 0) {
			const errorMessages = batchPlan.errors.map((e) => e.message).join("; ");
			return {
				success: false,
				optimizedBatches: [],
				criticalPath: {
					path: [],
					length: 0,
					dependencies: {},
					batchCount: 0,
					bottleneckImpact: "Cannot compute — planning failed",
				},
				plannerWarnings: batchPlan.errors.map((e) => ({
					type: "bottleneck" as const,
					message: e.message,
					workspaceIds: e.workspaceIds,
				})),
				plannerSuggestions: [],
				predictedParallelism: {
					requested: queue.maxParallelWorkspaces,
					effective: 0,
					totalBatches: 0,
					resourceUtilizationPercent: 0,
					bottlenecks: errorMessages.length > 0 ? [errorMessages] : [],
					parallelismHeadroom: false,
					saturationPoint: 1,
				},
				batchPlan: this.options.includeBatchPlanResult ? batchPlan : undefined,
				summary: `Planning failed: ${errorMessages}\n\nThis plan is ADVISORY and has NOT been executed.\nExplicit human approval is required before execution.`,
			};
		}

		// Build optimized batches with annotations
		const optimizedBatches = this.buildOptimizedBatches(batchPlan, queue);

		// Compute critical path
		const criticalPath = this.computeCriticalPath(batchPlan, queue);

		// Convert DAG analyzer warnings to planner warnings
		const plannerWarnings = this.buildPlannerWarnings(batchPlan);

		// Generate suggestions (with memory evidence if available)
		const plannerSuggestions = await this.generateSuggestions(batchPlan, queue);

		// Integrate the DAG optimizer to compute optimized batch plan and expected gain
		const dagOptimization = this.computeDagOptimization(queue, batchPlan);
		const { optimizedBatchPlan, expectedParallelismGain } = dagOptimization;

		// Predict parallelism
		const predictedParallelism = this.predictParallelism(batchPlan, queue);

		// Build summary (now includes optimized plan info)
		const summary = this.buildSummary(
			batchPlan,
			predictedParallelism,
			plannerWarnings,
			plannerSuggestions,
			optimizedBatchPlan,
			expectedParallelismGain,
		);

		const output: PlannerOutput = {
			success: true,
			optimizedBatches,
			criticalPath,
			plannerWarnings,
			plannerSuggestions,
			predictedParallelism,
			optimizedBatchPlan,
			expectedParallelismGain,
			batchPlan: this.options.includeBatchPlanResult ? batchPlan : undefined,
			summary,
		};

		// Record to planner memory if available
		if (this.plannerMemory?.isEnabled()) {
			this.plannerMemory.recordPlan(
				queue.phase,
				queue.title,
				queue.workspaces.length,
				queue.maxParallelWorkspaces,
				batchPlan.effectiveParallelism,
				batchPlan.totalBatches,
				batchPlan.isOverSerialized,
				plannerWarnings.length > 0,
				plannerWarnings.map((w) => w.type),
				plannerSuggestions.map((s) => s.type),
				predictedParallelism.bottlenecks,
				plannerSuggestions.map((s) => s.message),
				summary,
			);
		}

		return output;
	}

	// -----------------------------------------------------------------------
	// Private: Optimized Batches
	// -----------------------------------------------------------------------

	/**
	 * Build optimized batches from the batch plan result.
	 *
	 * Annotates each batch with optimization notes, bottleneck status,
	 * and capacity information.
	 */
	private buildOptimizedBatches(batchPlan: BatchPlanResult, queue: WorkspaceQueue): OptimizedBatch[] {
		return batchPlan.batches.map((batch, _index) => {
			const notes: string[] = [];
			let isBottleneck = false;

			// Determine if this batch is a bottleneck
			if (batch.width === 1 && batchPlan.batches.length > 1) {
				notes.push(
					`Single-width batch — workspace "${batch.workspaceIds[0]}" serializes execution; consider splitting or adding parallelism`,
				);
				isBottleneck = true;
			}

			// Check if batch could benefit from parallelGroup hints
			if (batch.width > 1) {
				const wsIds = batch.workspaceIds;
				const grouped = new Map<string, string[]>();
				for (const wsId of wsIds) {
					const ws = queue.workspaces.find((w) => w.id === wsId);
					if (ws?.parallelGroup) {
						const group = grouped.get(ws.parallelGroup) ?? [];
						group.push(wsId);
						grouped.set(ws.parallelGroup, group);
					}
				}
				if (grouped.size > 0) {
					const groupDesc = Array.from(grouped.entries())
						.map(([g, ids]) => `${g}: [${ids.join(", ")}]`)
						.join("; ");
					notes.push(`Parallel groups in this batch: ${groupDesc}`);
				}
				if (batch.width >= queue.maxParallelWorkspaces) {
					notes.push(`Batch is at capacity (${batch.width}/${queue.maxParallelWorkspaces} workers)`);
				}
			}

			// Check for workspaces with preflight requirements
			const preflightWs = batch.workspaceIds.filter((wsId) => {
				const ws = queue.workspaces.find((w) => w.id === wsId);
				return ws?.preflightRequired;
			});
			if (preflightWs.length > 0) {
				notes.push(
					`Workspaces requiring preflight approval: ${preflightWs.join(", ")} — will pause before execution`,
				);
			}

			// Check for high-risk workspaces (using risk adjustments from feedback loop if available)
			const highRisk = batch.workspaceIds.filter((wsId) => {
				const ws = queue.workspaces.find((w) => w.id === wsId);
				// Use risk adjustment from feedback loop (P7.F) if available, otherwise fall back to static risk level
				const effectiveRisk = this.riskAdjustments?.[wsId] ?? ws?.riskLevel ?? "low";
				return effectiveRisk === "high";
			});
			if (highRisk.length > 0) {
				notes.push(`High-risk workspaces: ${highRisk.join(", ")} — consider serializing`);
			}

			const isAtCapacity = batch.width >= queue.maxParallelWorkspaces;

			return {
				batchIndex: batch.batchIndex,
				workspaceIds: batch.workspaceIds,
				width: batch.width,
				optimizationNotes: notes,
				isBottleneck,
				isAtCapacity,
			};
		});
	}

	// -----------------------------------------------------------------------
	// Private: Critical Path
	// -----------------------------------------------------------------------

	/**
	 * Compute the critical path through the workspace dependency graph.
	 *
	 * The critical path is the longest chain of dependencies from entry
	 * workspaces (no dependencies) to leaf workspaces (no dependents).
	 * It determines the minimum wall-clock execution time regardless
	 * of parallelism.
	 */
	private computeCriticalPath(batchPlan: BatchPlanResult, queue: WorkspaceQueue): CriticalPathInfo {
		if (batchPlan.batches.length === 0) {
			return {
				path: [],
				length: 0,
				dependencies: {},
				batchCount: 0,
				bottleneckImpact: "No batch plan to analyze",
			};
		}

		// Build a mapping of workspace -> batch index
		const wsBatchMap = new Map<string, number>();
		for (const batch of batchPlan.batches) {
			for (const wsId of batch.workspaceIds) {
				wsBatchMap.set(wsId, batch.batchIndex);
			}
		}

		// Build a reverse dependency graph (workspace -> its dependents)
		const dependents = new Map<string, string[]>();
		for (const ws of queue.workspaces) {
			for (const depId of ws.dependencies) {
				const list = dependents.get(depId) ?? [];
				list.push(ws.id);
				dependents.set(depId, list);
			}
		}

		// Find the critical path by walking from entry points (batch 1)
		// through the longest chain
		const entryWorkspaces = batchPlan.batches[0]?.workspaceIds ?? [];
		const criticalPath: string[] = [];
		const criticalDeps: Record<string, string> = {};

		for (const entry of entryWorkspaces) {
			const path = this.findLongestPath(entry, dependents, wsBatchMap, queue.workspaces);
			if (path.length > criticalPath.length) {
				criticalPath.length = 0;
				criticalPath.push(...path);
				// Compute dependencies between consecutive workspaces on the path
				for (let i = 1; i < path.length; i++) {
					const ws = queue.workspaces.find((w) => w.id === path[i]);
					if (ws) {
						// Find which dependency is on the critical path
						for (const depId of ws.dependencies) {
							if (depId === path[i - 1]) {
								criticalDeps[path[i]] = depId;
								break;
							}
						}
					}
				}
			}
		}

		// If no critical path found (e.g., all workspaces in batch 1)
		if (criticalPath.length === 0 && queue.workspaces.length > 0) {
			criticalPath.push(queue.workspaces[0].id);
		}

		// Build bottleneck impact description
		let bottleneckImpact: string;
		if (batchPlan.totalBatches <= 1) {
			bottleneckImpact = "No parallel execution bottleneck — all workspaces can run concurrently";
		} else if (batchPlan.effectiveParallelism === 1) {
			bottleneckImpact =
				"Plan is fully serialized: each batch reduces to a single workspace. Consider adding parallel branches.";
		} else if (criticalPath.length === batchPlan.totalBatches) {
			bottleneckImpact = `The critical path spans all ${batchPlan.totalBatches} batches, meaning the longest dependency chain equals the total plan length. Any reduction in critical path would directly reduce overall execution time.`;
		} else {
			const diff = batchPlan.totalBatches - criticalPath.length;
			bottleneckImpact = `The critical path is shorter than total plan (${criticalPath.length} vs ${batchPlan.totalBatches} batches). There are ${diff} batches of parallel work that do not affect the critical path.`;
		}

		return {
			path: criticalPath,
			length: criticalPath.length,
			dependencies: criticalDeps,
			batchCount: batchPlan.totalBatches,
			bottleneckImpact,
		};
	}

	/**
	 * Find the longest path from a given workspace through its transitive
	 * dependents using DFS. Returns the full path as a list of workspace IDs.
	 */
	private findLongestPath(
		startId: string,
		dependents: Map<string, string[]>,
		_wsBatchMap: Map<string, number>,
		_workspaces: Workspace[],
	): string[] {
		const visited = new Set<string>();
		const memo = new Map<string, string[]>();

		const dfs = (wsId: string): string[] => {
			if (memo.has(wsId)) {
				return memo.get(wsId)!;
			}
			visited.add(wsId);

			const deps = dependents.get(wsId) ?? [];
			if (deps.length === 0) {
				visited.delete(wsId);
				return [wsId];
			}

			let longest: string[] = [];
			for (const depId of deps) {
				if (!visited.has(depId)) {
					const path = dfs(depId);
					if (path.length > longest.length) {
						longest = path;
					}
				}
			}
			visited.delete(wsId);
			const result = [wsId, ...longest];
			memo.set(wsId, result);
			return result;
		};

		return dfs(startId);
	}

	// -----------------------------------------------------------------------
	// Private: Warnings
	// -----------------------------------------------------------------------

	/**
	 * Convert DAG analyzer warnings to planner warnings.
	 */
	private buildPlannerWarnings(batchPlan: BatchPlanResult): PlannerWarning[] {
		return batchPlan.warnings.map((w) => ({
			type:
				w.type === "over_serialized"
					? "over_serialized"
					: w.type === "low_effective_parallelism"
						? "low_effective_parallelism"
						: w.type === "single_width_batch"
							? "single_width_batch"
							: "file_overlap",
			message: w.message,
			workspaceIds: w.workspaceIds,
			batchIndex: w.batchIndex,
		}));
	}

	// -----------------------------------------------------------------------
	// Private: Suggestions
	// -----------------------------------------------------------------------

	/**
	 * Generate actionable suggestions for improving the plan.
	 *
	 * Suggestions are derived from the batch plan analysis and workspace
	 * metadata. When planner memory is available, suggestions include
	 * evidence from relevant past plans to support recommendations.
	 * Each suggestion includes an expected benefit and whether
	 * it requires human approval.
	 */
	private async generateSuggestions(batchPlan: BatchPlanResult, queue: WorkspaceQueue): Promise<PlannerSuggestion[]> {
		const suggestions: PlannerSuggestion[] = [];
		const wsMap = new Map(queue.workspaces.map((w) => [w.id, w]));

		// Query planner memory for relevant past evidence
		const memoryEvidence = await this.queryMemoryEvidence(queue);

		// Helper to append memory evidence to a suggestion message
		const withEvidence = (message: string, evidenceKey: string): string => {
			const evidence = memoryEvidence[evidenceKey];
			if (!evidence || evidence.length === 0) {
				return message;
			}
			const evidenceLines = evidence.map((e) => `  [Past plan: ${e.title}] ${e.summaryText.substring(0, 120)}...`);
			return `${message}\n\nEvidence from past plans:\n${evidenceLines.join("\n")}`;
		};

		// 1. Over-serialization suggestion
		if (batchPlan.isOverSerialized) {
			const baseMessage =
				"The plan is fully serialized (effective parallelism = 1) despite requesting multiple workers. Consider adding parallelGroup hints to workspaces that can run concurrently, or removing unnecessary dependencies.";
			suggestions.push({
				type: "add_parallel_group",
				message: withEvidence(baseMessage, "over_serialization"),
				requiresApproval: true,
				expectedBenefit:
					"Enables concurrent execution, reducing total execution time by up to the serialization factor.",
				workspaceIds: queue.workspaces.map((w) => w.id),
			});
		}

		// 2. Low parallelism suggestion
		if (
			batchPlan.effectiveParallelism < batchPlan.requestedParallelism &&
			batchPlan.effectiveParallelism > 1 &&
			!batchPlan.isOverSerialized
		) {
			const baseMessage = `Effective parallelism (${batchPlan.effectiveParallelism}) is below requested (${batchPlan.requestedParallelism}). Review dependency graph to identify workspaces that could be reordered or parallelized.`;
			suggestions.push({
				type: "regroup_batches",
				message: withEvidence(baseMessage, "low_parallelism"),
				requiresApproval: true,
				expectedBenefit: `Improves parallelism from ${batchPlan.effectiveParallelism} to ${batchPlan.requestedParallelism}, reducing execution time.`,
				workspaceIds: queue.workspaces.map((w) => w.id),
			});
		}

		// 3. Single-width batch bottlenecks
		for (const batch of batchPlan.batches) {
			if (batch.width === 1 && batchPlan.batches.length > 1) {
				const wsId = batch.workspaceIds[0];
				const ws = wsMap.get(wsId);
				const deps = ws?.dependencies ?? [];

				// Suggest removing unnecessary critical-path dependencies
				const exceededDeps = deps.filter((depId) => {
					// Check if this dependency is a gate that forces serialization
					const depBatch = batchPlan.batches.find((b) => b.workspaceIds.includes(depId));
					return depBatch && depBatch.batchIndex < batch.batchIndex;
				});

				if (exceededDeps.length > 0) {
					const baseMessage = `Workspace "${wsId}" in batch ${batch.batchIndex} is serialized by dependencies [${exceededDeps.join(", ")}]. Review whether all these dependencies are truly required — removing any would allow "${wsId}" to start earlier.`;
					suggestions.push({
						type: "remove_dependency",
						message: withEvidence(baseMessage, "remove_dependency"),
						requiresApproval: true,
						expectedBenefit: `May move "${wsId}" to an earlier batch, reducing critical path length.`,
						workspaceIds: [wsId, ...exceededDeps],
					});
				}

				// Suggest splitting the workspace into parallel subtasks
				if (ws?.acceptanceCriteria && ws.acceptanceCriteria.length > 1) {
					const baseMessage = `Workspace "${wsId}" in batch ${batch.batchIndex} has ${ws.acceptanceCriteria.length} acceptance criteria and blocks all subsequent workspaces. Consider splitting it into smaller parallel workspaces.`;
					suggestions.push({
						type: "split_workspace",
						message: withEvidence(baseMessage, "split_workspace"),
						requiresApproval: true,
						expectedBenefit: "Enables concurrent execution of subtasks, reducing serialization.",
						workspaceIds: [wsId],
					});
				}
			}
		}

		// 4. Suggestions based on parallelism headroom
		const effectiveParallelism = batchPlan.effectiveParallelism;
		const requestedParallelism = batchPlan.requestedParallelism;
		if (effectiveParallelism >= requestedParallelism && effectiveParallelism > 0) {
			const baseMessage = `The plan saturates all ${requestedParallelism} workers. Consider increasing maxParallelWorkspaces to improve throughput if more workspaces are added.`;
			suggestions.push({
				type: "increase_parallelism",
				message: withEvidence(baseMessage, "increase_parallelism"),
				requiresApproval: true,
				expectedBenefit: "Enables faster execution for plan extensions.",
				workspaceIds: [],
			});
		}

		// 5. Suggest reducing parallelism if it's much higher than effective
		if (requestedParallelism > effectiveParallelism * 2 && effectiveParallelism > 0) {
			const baseMessage = `Requested parallelism (${requestedParallelism}) is more than double effective parallelism (${effectiveParallelism}). Consider lowering maxParallelWorkspaces to ${effectiveParallelism + 1} to reduce resource allocation without affecting execution time.`;
			suggestions.push({
				type: "reduce_parallelism",
				message: withEvidence(baseMessage, "reduce_parallelism"),
				requiresApproval: true,
				expectedBenefit: "Reduces resource allocation without impacting execution time.",
				workspaceIds: [],
			});
		}

		// 6. File overlap suggestions
		const fileOverlapWarnings = batchPlan.warnings.filter((w) => w.type === "file_overlap");
		if (fileOverlapWarnings.length > 0) {
			const baseMessage = `${fileOverlapWarnings.length} file overlap(s) detected within batches. Workspaces editing the same file cannot execute concurrently. Consider serializing overlapping workspaces or splitting them into separate batches.`;
			suggestions.push({
				type: "regroup_batches",
				message: withEvidence(baseMessage, "file_overlap"),
				requiresApproval: true,
				expectedBenefit: "Eliminates same-file parallelism violations, improving execution correctness.",
				workspaceIds: [...new Set<string>(fileOverlapWarnings.flatMap((w) => w.workspaceIds ?? []))],
			});
		}

		// 7. P7.F: Risk adjustment suggestions
		// If the planner has risk adjustments from the feedback loop, generate
		// suggestions for workspaces with elevated risk levels that are in
		// parallel batches (they may need serialization).
		if (this.riskAdjustments) {
			const adjustedHighRisk = Object.entries(this.riskAdjustments)
				.filter(([_, level]) => level === "high")
				.map(([id]) => id);

			if (adjustedHighRisk.length > 0) {
				// Find which of these workspaces are in parallel batches
				const highRiskBatchMap = new Map<number, string[]>();
				for (const batch of batchPlan.batches) {
					for (const wsId of batch.workspaceIds) {
						if (adjustedHighRisk.includes(wsId) && batch.width > 1) {
							const list = highRiskBatchMap.get(batch.batchIndex) ?? [];
							list.push(wsId);
							highRiskBatchMap.set(batch.batchIndex, list);
						}
					}
				}

				if (highRiskBatchMap.size > 0) {
					const batchDescriptions = Array.from(highRiskBatchMap.entries())
						.map(([batchIdx, ids]) => `Batch ${batchIdx}: [${ids.join(", ")}]`)
						.join("; ");

					const baseMessage = `Feedback loop risk adjustments indicate elevated risk for workspaces: ${adjustedHighRisk.join(", ")}. High-risk workspaces in parallel batches: ${batchDescriptions}. Consider serializing these workspaces to reduce failure impact.`;
					suggestions.push({
						type: "add_serialization",
						message: withEvidence(baseMessage, "add_serialization"),
						requiresApproval: true,
						expectedBenefit:
							"Reduces the impact of high-risk workspace failures by ensuring they run before their dependents, preventing cascading failures in parallel execution.",
						workspaceIds: [...adjustedHighRisk],
					});
				}
			}

			// Workspaces whose risk was decreased (now low) in parallel batches
			// may benefit from splitting/parallelizing
			const adjustedLowRisk = Object.entries(this.riskAdjustments)
				.filter(([_, level]) => level === "low")
				.map(([id]) => id);

			if (adjustedLowRisk.length > 0) {
				const lowRiskInSerialBatches: string[] = [];
				for (const batch of batchPlan.batches) {
					if (batch.width === 1 && batch.batchIndex < batchPlan.totalBatches) {
						for (const wsId of batch.workspaceIds) {
							if (adjustedLowRisk.includes(wsId)) {
								lowRiskInSerialBatches.push(wsId);
							}
						}
					}
				}

				if (lowRiskInSerialBatches.length > 0) {
					const baseMessage = `Workspaces with adjusted low risk are in serial single-width batches: [${lowRiskInSerialBatches.join(", ")}]. Consider moving them to earlier batches or adding parallel groups to reduce serialization.`;
					suggestions.push({
						type: "remove_serialization",
						message: withEvidence(baseMessage, "remove_serialization"),
						requiresApproval: true,
						expectedBenefit:
							"Improves parallelism by moving low-risk workspaces out of serialized positions, reducing critical path length.",
						workspaceIds: [...lowRiskInSerialBatches],
					});
				}
			}
		}

		return suggestions;
	}

	/**
	 * Query planner memory for evidence relevant to the current queue.
	 *
	 * Returns a mapping of suggestion evidence keys to matching memory entries.
	 * This is purely advisory — memory evidence is included in suggestion
	 * messages but does not affect the plan structure or auto-apply any changes.
	 */
	private async queryMemoryEvidence(queue: WorkspaceQueue): Promise<Record<string, PlannerMemoryEntry[]>> {
		const evidence: Record<string, PlannerMemoryEntry[]> = {
			over_serialization: [],
			low_parallelism: [],
			remove_dependency: [],
			split_workspace: [],
			increase_parallelism: [],
			reduce_parallelism: [],
			file_overlap: [],
		};

		if (!this.plannerMemory || !this.plannerMemory.isEnabled()) {
			return evidence;
		}

		const relevantEntries = await this.plannerMemory.getRelevantMemory(
			queue.workspaces.length,
			queue.maxParallelWorkspaces,
			queue.phase,
		);

		if (relevantEntries.length === 0) {
			return evidence;
		}

		// Classify memory entries by evidence type based on their stored characteristics
		for (const entry of relevantEntries) {
			if (entry.isOverSerialized) {
				evidence.over_serialization.push(entry);
			}
			if (entry.effectiveParallelism < entry.maxParallelWorkspaces && entry.effectiveParallelism > 1) {
				evidence.low_parallelism.push(entry);
			}
			if (entry.suggestionTypes.includes("remove_dependency")) {
				evidence.remove_dependency.push(entry);
			}
			if (entry.suggestionTypes.includes("split_workspace")) {
				evidence.split_workspace.push(entry);
			}
			if (entry.suggestionTypes.includes("increase_parallelism")) {
				evidence.increase_parallelism.push(entry);
			}
			if (entry.suggestionTypes.includes("reduce_parallelism")) {
				evidence.reduce_parallelism.push(entry);
			}
			if (entry.suggestionTypes.includes("regroup_batches")) {
				evidence.file_overlap.push(entry);
			}
		}

		return evidence;
	}

	// -----------------------------------------------------------------------
	// Private: Parallelism Prediction
	// -----------------------------------------------------------------------

	/**
	 * Predict parallelism metrics from the batch plan.
	 *
	 * Computes resource utilization, bottlenecks, headroom, and the
	 * saturation point (the maxParallelWorkspaces value at which the
	 * graph would be fully saturated).
	 */
	private predictParallelism(batchPlan: BatchPlanResult, _queue: WorkspaceQueue): PredictedParallelism {
		const effective = batchPlan.effectiveParallelism;
		const requested = batchPlan.requestedParallelism;

		// Resource utilization: how well the requested workers would be utilized
		const resourceUtilizationPercent = requested > 0 ? Math.round((effective / requested) * 100) : 0;

		// Bottlenecks
		const bottlenecks: string[] = [];

		if (batchPlan.isOverSerialized) {
			bottlenecks.push(
				"Fully serialized — dependency graph forces single-file execution despite multiple workers requested",
			);
		}

		if (batchPlan.serializedTailLength > 0 && batchPlan.totalBatches > 1) {
			bottlenecks.push(
				`Serialized tail: the last ${batchPlan.serializedTailLength} batch(es) have only 1 workspace each — parallel capacity is unused at the end of execution`,
			);
		}

		for (const batch of batchPlan.batches) {
			if (batch.width === 1 && batchPlan.batches.length > 1) {
				const wsId = batch.workspaceIds[0];
				bottlenecks.push(
					`Batch ${batch.batchIndex}: workspace "${wsId}" is a serialization bottleneck — all subsequent workspaces wait for it to complete`,
				);
			}
		}

		// Parallelism headroom
		const parallelismHeadroom = effective >= requested && requested > 0;

		// Saturation point: the maxParallelWorkspaces at which the graph would be fully saturated.
		// This is equal to the max width across all batches (effective parallelism).
		const saturationPoint = Math.max(effective, 1);

		return {
			requested,
			effective,
			totalBatches: batchPlan.totalBatches,
			resourceUtilizationPercent,
			bottlenecks,
			parallelismHeadroom,
			saturationPoint,
		};
	}

	// -----------------------------------------------------------------------
	// Private: DAG Optimization (P9.C)
	// -----------------------------------------------------------------------

	/**
	 * Compute the optimized batch plan and expected parallelism gain using the
	 * DAG optimizer.
	 *
	 * Calls analyzeOptimizationOpportunities() from the DAG optimizer to
	 * generate formal proposals with simulated before/after evidence, then
	 * extracts the best-case batch plan and computes the expected parallelism
	 * gain.
	 *
	 * @param queue - Workspace queue to analyze
	 * @param batchPlan - Current batch plan (before optimizations)
	 * @returns Optimized batch plan (if proposals exist) and expected parallelism gain
	 */
	private computeDagOptimization(
		queue: WorkspaceQueue,
		batchPlan: BatchPlanResult,
	): {
		optimizedBatchPlan: BatchPlanResult | undefined;
		expectedParallelismGain: number | undefined;
	} {
		// If the batch plan has errors, no optimization is possible
		if (batchPlan.errors.length > 0) {
			return { optimizedBatchPlan: undefined, expectedParallelismGain: undefined };
		}

		// Run the DAG optimizer to generate formal proposals
		const optimizationResult = analyzeOptimizationOpportunities(queue);

		// If no proposals were generated, no optimization is possible
		if (optimizationResult.proposals.length === 0) {
			return { optimizedBatchPlan: undefined, expectedParallelismGain: undefined };
		}

		// Use the best-case batch plan from the optimizer
		const optimizedBatchPlan = optimizationResult.bestCaseBatchPlan ?? undefined;

		// Compute expected parallelism gain
		let expectedParallelismGain: number | undefined;
		if (optimizedBatchPlan && optimizationResult.summary.parallelismImprovement > 0) {
			expectedParallelismGain = optimizationResult.summary.parallelismImprovement;
		} else if (optimizedBatchPlan) {
			// Even if parallelism doesn't improve, there may be batch reductions
			// or other improvements; gain is 0 in that case
			expectedParallelismGain = 0;
		}

		return { optimizedBatchPlan, expectedParallelismGain };
	}

	// -----------------------------------------------------------------------
	// Private: Summary
	// -----------------------------------------------------------------------

	/**
	 * Build a human-readable summary of the planner output.
	 */
	private buildSummary(
		batchPlan: BatchPlanResult,
		predicted: PredictedParallelism,
		warnings: PlannerWarning[],
		suggestions: PlannerSuggestion[],
		optimizedBatchPlan?: BatchPlanResult,
		expectedParallelismGain?: number,
	): string {
		const lines: string[] = [];

		lines.push("=== Planner Summary ===");
		lines.push("");

		// Parallelism
		lines.push("Parallelism:");
		lines.push(`  Requested:   ${predicted.requested} workers`);
		lines.push(`  Effective:   ${predicted.effective} workers`);
		lines.push(`  Utilization: ${predicted.resourceUtilizationPercent}%`);
		lines.push(`  Batches:     ${predicted.totalBatches}`);
		lines.push("");

		// Critical path
		lines.push("Critical Path:");
		lines.push(`  Length: ${batchPlan.criticalPathLength} batch(es)`);
		if (batchPlan.criticalPathLength > 0) {
			const batchNames = batchPlan.batches.map((b) => `Batch ${b.batchIndex}: [${b.workspaceIds.join(", ")}]`);
			lines.push(`  Batches: ${batchNames.join(" -> ")}`);
		}
		lines.push("");

		// Warnings
		if (warnings.length > 0) {
			lines.push(`Warnings (${warnings.length}):`);
			for (const w of warnings) {
				lines.push(`  - ${w.message}`);
			}
			lines.push("");
		}

		// Suggestions
		if (suggestions.length > 0) {
			lines.push(`Suggestions (${suggestions.length}):`);
			for (const s of suggestions) {
				const approvalMark = s.requiresApproval ? " [requires approval]" : "";
				lines.push(`  - ${s.message}${approvalMark}`);
				lines.push(`    Benefit: ${s.expectedBenefit}`);
			}
			lines.push("");
		}

		// Bottlenecks
		if (predicted.bottlenecks.length > 0) {
			lines.push("Bottlenecks:");
			for (const b of predicted.bottlenecks) {
				lines.push(`  - ${b}`);
			}
			lines.push("");
		}

		// Optimized plan (from DAG optimizer, P9.C)
		if (optimizedBatchPlan) {
			lines.push("Optimized Plan (with suggestions applied):");
			lines.push(`  Batches:              ${optimizedBatchPlan.totalBatches}`);
			lines.push(`  Effective parallelism: ${optimizedBatchPlan.effectiveParallelism}`);
			lines.push(`  Critical path length:  ${optimizedBatchPlan.criticalPathLength}`);
			if (expectedParallelismGain !== undefined && expectedParallelismGain > 0) {
				lines.push(`  Parallelism gain:      +${expectedParallelismGain}`);
			}
			if (optimizedBatchPlan.effectiveParallelism > batchPlan.effectiveParallelism) {
				lines.push(
					`  Improvement: ${batchPlan.effectiveParallelism} -> ${optimizedBatchPlan.effectiveParallelism} workers`,
				);
			}
			if (optimizedBatchPlan.totalBatches < batchPlan.totalBatches) {
				lines.push(`  Batch reduction: ${batchPlan.totalBatches} -> ${optimizedBatchPlan.totalBatches} batches`);
			}
			if (
				optimizedBatchPlan.isOverSerialized !== batchPlan.isOverSerialized &&
				!optimizedBatchPlan.isOverSerialized
			) {
				lines.push("  Eliminates over-serialization");
			}
			lines.push("");
		}

		// Advisory notice
		lines.push("---");
		lines.push("This plan is ADVISORY and has NOT been executed.");
		lines.push("Explicit human approval is required before execution.");

		return lines.join("\n");
	}
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Plan execution for a workspace queue using the default planner.
 *
 * Convenience wrapper around `new Planner().plan()`.
 *
 * @param queue - Workspace queue to plan
 * @param options - Optional planner options
 * @returns Planner output (advisory — requires human approval before execution)
 */
export async function planExecution(queue: WorkspaceQueue, options?: PlannerOptions): Promise<PlannerOutput> {
	const planner = new Planner(options);
	return planner.plan(queue);
}

/**
 * Format planner output as a human-readable string.
 *
 * @param output - Planner output to format
 * @returns Formatted string
 */
export function formatPlannerOutput(output: PlannerOutput): string {
	return output.summary;
}

/**
 * Format the critical path as a human-readable string.
 *
 * @param criticalPath - Critical path info to format
 * @returns Formatted string
 */
export function formatCriticalPath(criticalPath: CriticalPathInfo): string {
	const lines: string[] = [];
	lines.push("Critical Path:");
	lines.push(`  Path:  ${criticalPath.path.join(" -> ")}`);
	lines.push(`  Length: ${criticalPath.length}`);
	lines.push(`  Impact: ${criticalPath.bottleneckImpact}`);
	if (Object.keys(criticalPath.dependencies).length > 0) {
		lines.push("  Dependencies:");
		for (const [ws, dep] of Object.entries(criticalPath.dependencies)) {
			lines.push(`    ${ws} depends on ${dep}`);
		}
	}
	return lines.join("\n");
}
