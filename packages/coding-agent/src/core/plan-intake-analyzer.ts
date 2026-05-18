/**
 * Plan Intake Analyzer - P11.C
 *
 * Analyzes uploaded plans automatically when they are uploaded or edited.
 * Parses Part 3 JSON, computes the dependency graph, detects bottlenecks,
 * and generates optimization proposals before execution approval.
 *
 * This is the entry point for the v2.4 plan lifecycle: every plan upload
 * triggers analysis, and execution remains blocked until graph approval is current.
 */

import { type BatchPlanResult, computeBatchPlan } from "./dag-analyzer.js";
import {
	analyzeOptimizationOpportunities,
	approveProposal,
	type DagOptimizationResult,
	formatOptimizationResult,
	rejectProposal,
} from "./dag-optimizer.js";
import type { PlanStackValidation } from "./project-stack-validator.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Plan Intake Analysis Types
// ---------------------------------------------------------------------------

/**
 * Severity level for plan intake diagnostics.
 */
export type IntakeSeverity = "info" | "warning" | "error";

/**
 * A single diagnostic message from plan intake analysis.
 */
export interface IntakeDiagnostic {
	severity: IntakeSeverity;
	message: string;
	workspaceId?: string;
	code?: string;
}

/**
 * Status of the plan intake lifecycle.
 */
export type IntakeStatus = "pending" | "analyzing" | "awaiting_approval" | "approved" | "rejected" | "stale";

/**
 * Bottleneck information detected during plan intake.
 */
export interface IntakeBottleneck {
	/** The workspace or batch causing the bottleneck */
	source: string;
	/** Why this is a bottleneck */
	reason: string;
	/** Impact description */
	impact: string;
	/** Suggested resolution */
	suggestion: string;
	/** Severity */
	severity: IntakeSeverity;
}

/**
 * Complete result of a plan intake analysis.
 */
export interface PlanIntakeAnalysis {
	/** Current lifecycle status */
	status: IntakeStatus;
	/** The workspace queue that was analyzed */
	queue: WorkspaceQueue;
	/** Batch plan computed from the queue */
	batchPlan: BatchPlanResult;
	/** DAG optimization result with proposals */
	optimization: DagOptimizationResult;
	/** Diagnostics from the analysis */
	diagnostics: IntakeDiagnostic[];
	/** Detected bottlenecks */
	bottlenecks: IntakeBottleneck[];
	/** Critical path information */
	criticalPath: CriticalPathInfo;
	/** Serialized tail detection */
	serializedTail: SerializedTailInfo | null;
	/** Whether the authored batch preview is stale (advisory) */
	authoredPreviewStale: boolean;
	/** Timestamp of analysis */
	analyzedAt: string;
	/** Whether execution is blocked pending approval */
	executionBlocked: boolean;
	/** Project stack validation result, if workspaceRoot was provided */
	stackValidation?: PlanStackValidation;
}

/**
 * Critical path information.
 */
export interface CriticalPathInfo {
	/** Workspace IDs along the critical path, in order */
	workspaceIds: string[];
	/** Total number of steps in the critical path */
	length: number;
	/** Whether the critical path is optimal */
	isOptimal: boolean;
	/** Reason if not optimal */
	optimizationHint?: string;
}

/**
 * Serialized tail detection.
 */
export interface SerializedTailInfo {
	/** Workspace IDs in the tail, in order */
	tailWorkspaceIds: string[];
	/** Length of the tail */
	tailLength: number;
	/** Why the tail is serialized */
	reason: string;
	/** Suggested fix */
	suggestion: string;
}

/**
 * Options for plan intake analysis.
 */
export interface PlanIntakeOptions {
	/** If true, skip optimization proposal generation */
	skipOptimization?: boolean;
	/** If provided, compare against this authored preview */
	authoredBatchCount?: number;
	/** If provided, compare against this authored parallelism */
	authoredParallelism?: number;
	/**
	 * Absolute path to the project root.
	 * When provided, runs project stack validation to check targetCommand
	 * compatibility (e.g., pnpm commands in an npm project).
	 */
	workspaceRoot?: string;
}

// ---------------------------------------------------------------------------
// Plan Intake Analysis Core
// ---------------------------------------------------------------------------

/**
 * Analyze a workspace queue for plan intake.
 *
 * This is the main entry point triggered on plan upload or edit.
 * It:
 * 1. Computes the baseline batch plan
 * 2. Detects bottlenecks and serialized tails
 * 3. Computes the critical path
 * 4. Generates optimization proposals
 * 5. Returns a complete analysis with diagnostics
 *
 * @param queue - The workspace queue to analyze
 * @param options - Analysis options
 * @returns Plan intake analysis result
 */
export function analyzePlanIntake(queue: WorkspaceQueue, options?: PlanIntakeOptions): PlanIntakeAnalysis {
	const diagnostics: IntakeDiagnostic[] = [];
	const bottlenecks: IntakeBottleneck[] = [];

	// 1. Compute batch plan
	const batchPlan = computeBatchPlan(queue);

	// Check for parse errors
	if (batchPlan.errors.length > 0) {
		for (const error of batchPlan.errors) {
			diagnostics.push({
				severity: "error",
				message: error.message,
				code: error.type,
			});
		}
	}

	// 2. Detect serialization issues
	const serializedTail = detectSerializedTail(batchPlan, queue);
	if (serializedTail) {
		bottlenecks.push({
			source: `batch_${serializedTail.tailWorkspaceIds.join("_")}`,
			reason: serializedTail.reason,
			impact: `Serialized tail adds ${serializedTail.tailLength - 1} unnecessary batches`,
			suggestion: serializedTail.suggestion,
			severity: "warning",
		});
	}

	// 3. Compute critical path
	const criticalPath = computeCriticalPath(batchPlan, queue);

	// 4. Detect specific bottlenecks
	detectBottlenecks(batchPlan, queue, bottlenecks, diagnostics);

	// 5. Generate optimization proposals
	const optimization = options?.skipOptimization
		? createEmptyOptimizationResult(queue, batchPlan)
		: analyzeOptimizationOpportunities(queue);

	// 6. Check if authored preview is stale
	let authoredPreviewStale = false;
	if (options?.authoredBatchCount !== undefined && options?.authoredBatchCount !== batchPlan.totalBatches) {
		authoredPreviewStale = true;
		diagnostics.push({
			severity: "info",
			message: `Authored batch count (${options.authoredBatchCount}) differs from computed batch count (${batchPlan.totalBatches}). Using computed plan.`,
			code: "stale_authored_preview",
		});
	}
	if (options?.authoredParallelism !== undefined && options?.authoredParallelism !== batchPlan.effectiveParallelism) {
		authoredPreviewStale = true;
	}

	// 7. Determine if execution is blocked
	const executionBlocked = optimization.proposals.length > 0 || batchPlan.errors.length > 0;

	// 8. Determine status
	const status: IntakeStatus = optimization.hasPendingProposals
		? "awaiting_approval"
		: batchPlan.errors.length > 0
			? "rejected"
			: "approved";

	return {
		status,
		queue,
		batchPlan,
		optimization,
		diagnostics,
		bottlenecks,
		criticalPath,
		serializedTail,
		authoredPreviewStale,
		analyzedAt: new Date().toISOString(),
		executionBlocked,
	};
}

// ---------------------------------------------------------------------------
// Serialized Tail Detection
// ---------------------------------------------------------------------------

/**
 * Detect serialized tails in the batch plan.
 *
 * A serialized tail occurs when the last few batches each contain only
 * one workspace, indicating unnecessary serialization at the end of the plan.
 */
function detectSerializedTail(batchPlan: BatchPlanResult, queue: WorkspaceQueue): SerializedTailInfo | null {
	if (batchPlan.batches.length < 2) return null;

	// Find the trailing single-width batches
	const tailWorkspaceIds: string[] = [];
	const tailBatchIndices: number[] = [];

	for (let i = batchPlan.batches.length - 1; i >= 0; i--) {
		const batch = batchPlan.batches[i];
		if (batch.width === 1) {
			tailWorkspaceIds.unshift(...batch.workspaceIds);
			tailBatchIndices.unshift(batch.batchIndex);
		} else {
			break;
		}
	}

	if (tailWorkspaceIds.length < 2) return null;

	// Get workspace titles for the tail
	const wsMap = new Map(queue.workspaces.map((w) => [w.id, w]));
	const tailNames = tailWorkspaceIds.map((id) => wsMap.get(id)?.title ?? id);

	return {
		tailWorkspaceIds,
		tailLength: tailWorkspaceIds.length,
		reason: `The last ${tailBatchIndices.length} batches each contain only 1 workspace, creating a serialized tail`,
		suggestion: `Consider splitting workspaces [${tailNames.join(", ")}] into smaller parallel units, or removing transitive dependencies between them.`,
	};
}

// ---------------------------------------------------------------------------
// Critical Path Computation
// ---------------------------------------------------------------------------

/**
 * Compute the critical path through the workspace graph.
 *
 * The critical path is the longest chain of dependent workspaces
 * that determines the minimum execution time.
 */
function computeCriticalPath(batchPlan: BatchPlanResult, queue: WorkspaceQueue): CriticalPathInfo {
	if (batchPlan.criticalPathLength === 0) {
		return {
			workspaceIds: [],
			length: 0,
			isOptimal: true,
		};
	}

	// Build the dependency graph
	const forwardDeps = new Map<string, string[]>();
	for (const ws of queue.workspaces) {
		forwardDeps.set(ws.id, [...ws.dependencies]);
	}

	// Find the critical path through topological order
	// Start from the last batch and trace back through dependencies
	const wsBatchMap = new Map<string, number>();
	for (const batch of batchPlan.batches) {
		for (const wsId of batch.workspaceIds) {
			wsBatchMap.set(wsId, batch.batchIndex);
		}
	}

	// Workspaces in the last batch are potential end points
	const lastBatch = batchPlan.batches[batchPlan.batches.length - 1];
	const endPoints = lastBatch?.workspaceIds ?? [];

	// For each endpoint, trace back to find the longest dependency chain
	let criticalPath: string[] = [];
	let criticalPathLength = 0;

	for (const endPoint of endPoints) {
		const path = traceCriticalPath(endPoint, forwardDeps, wsBatchMap);
		if (path.length > criticalPathLength) {
			criticalPath = path;
			criticalPathLength = path.length;
		}
	}

	// Determine if the critical path is optimal
	const isOptimal = criticalPathLength <= batchPlan.totalBatches;
	const optimizationHint = isOptimal
		? undefined
		: `Critical path (${criticalPathLength}) is longer than total batches (${batchPlan.totalBatches}). Consider parallelizing nodes along the path.`;

	return {
		workspaceIds: criticalPath,
		length: criticalPathLength,
		isOptimal,
		optimizationHint,
	};
}

/**
 * Trace the critical path backwards from a workspace through its dependents.
 */
function traceCriticalPath(
	startId: string,
	forwardDeps: Map<string, string[]>,
	wsBatchMap: Map<string, number>,
): string[] {
	const path: string[] = [startId];
	let current = startId;

	while (true) {
		const deps = forwardDeps.get(current) ?? [];
		if (deps.length === 0) break;

		// Find the dependency with the latest batch (deepest in the graph)
		let latestDep: string | null = null;
		let latestBatch = -1;

		for (const dep of deps) {
			const batch = wsBatchMap.get(dep) ?? 0;
			if (batch > latestBatch) {
				latestBatch = batch;
				latestDep = dep;
			}
		}

		if (!latestDep || latestBatch <= 0) break;

		path.unshift(latestDep);
		current = latestDep;
	}

	return path;
}

// ---------------------------------------------------------------------------
// Bottleneck Detection
// ---------------------------------------------------------------------------

/**
 * Detect specific bottlenecks in the workspace graph.
 */
function detectBottlenecks(
	batchPlan: BatchPlanResult,
	queue: WorkspaceQueue,
	bottlenecks: IntakeBottleneck[],
	diagnostics: IntakeDiagnostic[],
): void {
	const wsMap = new Map(queue.workspaces.map((w) => [w.id, w]));

	// 1. Detect over-serialization
	if (batchPlan.isOverSerialized) {
		bottlenecks.push({
			source: "batch_plan",
			reason: "Effective parallelism is 1, meaning workspaces run sequentially despite available capacity",
			impact: "Maximum performance penalty — no parallel execution",
			suggestion:
				"Review workspace dependency graph for unnecessary serialization. Look for transitive dependencies and single-width batches.",
			severity: "error",
		});
	}

	// 2. Detect single-width bottleneck batches
	for (const batch of batchPlan.batches) {
		if (batch.width === 1 && batchPlan.effectiveParallelism > 1) {
			const wsId = batch.workspaceIds[0];
			const ws = wsMap.get(wsId);
			bottlenecks.push({
				source: wsId,
				reason: `Workspace "${ws?.title ?? wsId}" is the only workspace in batch ${batch.batchIndex}`,
				impact: `All other batches must wait for this workspace to complete before proceeding`,
				suggestion:
					ws?.acceptanceCriteria && ws.acceptanceCriteria.length > 1
						? `Consider splitting "${wsId}" into ${ws.acceptanceCriteria.length} parallel workspaces (one per acceptance criterion)`
						: `Check if "${wsId}" can be parallelized or combined with another batch`,
				severity: "warning",
			});
		}
	}

	// 3. Detect validation-lock bottlenecks
	const hasValidationWorkspace = queue.workspaces.some(
		(ws) => ws.title?.toLowerCase().includes("validation") || ws.id.toLowerCase().includes("validation"),
	);
	if (hasValidationWorkspace) {
		diagnostics.push({
			severity: "info",
			message:
				"Validation workspace detected. Global validation lock may create a bottleneck if multiple validation workspaces run sequentially.",
			code: "validation_bottleneck",
		});
	}

	// 4. Detect insufficient parallelism vs requested parallelism
	if (batchPlan.effectiveParallelism < batchPlan.requestedParallelism) {
		bottlenecks.push({
			source: "batch_plan",
			reason: `Requested parallelism (${batchPlan.requestedParallelism}) exceeds effective parallelism (${batchPlan.effectiveParallelism})`,
			impact: `${batchPlan.requestedParallelism - batchPlan.effectiveParallelism} worker slots will be idle`,
			suggestion:
				"Reduce requested parallelism or restructure workspace dependencies to increase effective parallelism",
			severity: "info",
		});
	}

	// 5. Detect missing dependencies (accidental parallelism)
	for (const batch of batchPlan.batches) {
		if (batch.width > batchPlan.requestedParallelism) {
			const wsNames = batch.workspaceIds.map((id) => `"${wsMap.get(id)?.title ?? id}"`).join(", ");
			bottlenecks.push({
				source: `batch_${batch.batchIndex}`,
				reason: `Batch ${batch.batchIndex} has ${batch.width} workspaces but only ${batchPlan.requestedParallelism} workers are available`,
				impact: `${batch.width - batchPlan.requestedParallelism} workspaces will be deferred`,
				suggestion: `Consider adding dependencies between [${wsNames}] to serialize access to shared resources, or increase maxParallelWorkspaces`,
				severity: "warning",
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a plan intake analysis as a human-readable string.
 */
export function formatPlanIntakeAnalysis(analysis: PlanIntakeAnalysis): string {
	const lines: string[] = [];

	lines.push("=== Plan Intake Analysis ===");
	lines.push(`Status: ${analysis.status}`);
	lines.push(`Analyzed: ${analysis.analyzedAt}`);
	lines.push(`Execution blocked: ${analysis.executionBlocked ? "Yes (requires approval)" : "No"}`);
	lines.push("");

	// Batch Plan Summary
	lines.push("--- Batch Plan ---");
	lines.push(`  Total batches:          ${analysis.batchPlan.totalBatches}`);
	lines.push(`  Effective parallelism:  ${analysis.batchPlan.effectiveParallelism}`);
	lines.push(`  Requested parallelism:  ${analysis.batchPlan.requestedParallelism}`);
	lines.push(`  Critical path length:   ${analysis.batchPlan.criticalPathLength}`);
	lines.push(`  Is over-serialized:     ${analysis.batchPlan.isOverSerialized}`);
	lines.push("");

	// Critical Path
	lines.push("--- Critical Path ---");
	if (analysis.criticalPath.workspaceIds.length > 0) {
		lines.push(`  Path: ${analysis.criticalPath.workspaceIds.join(" -> ")}`);
		lines.push(`  Length: ${analysis.criticalPath.length}`);
		lines.push(`  Optimal: ${analysis.criticalPath.isOptimal}`);
		if (analysis.criticalPath.optimizationHint) {
			lines.push(`  Hint: ${analysis.criticalPath.optimizationHint}`);
		}
	} else {
		lines.push("  No critical path computed.");
	}
	lines.push("");

	// Serialized Tail
	if (analysis.serializedTail) {
		lines.push("--- Serialized Tail ---");
		lines.push(`  Tail workspaces: ${analysis.serializedTail.tailWorkspaceIds.join(", ")}`);
		lines.push(`  Tail length: ${analysis.serializedTail.tailLength}`);
		lines.push(`  Reason: ${analysis.serializedTail.reason}`);
		lines.push(`  Suggestion: ${analysis.serializedTail.suggestion}`);
		lines.push("");
	}

	// Bottlenecks
	if (analysis.bottlenecks.length > 0) {
		lines.push("--- Bottlenecks ---");
		for (const b of analysis.bottlenecks) {
			const icon = b.severity === "error" ? "!" : b.severity === "warning" ? "?" : "i";
			lines.push(`  [${icon}] ${b.source}: ${b.reason}`);
			lines.push(`       Impact: ${b.impact}`);
			lines.push(`       Suggestion: ${b.suggestion}`);
		}
		lines.push("");
	}

	// Batches
	lines.push("--- Batches ---");
	for (const batch of analysis.batchPlan.batches) {
		lines.push(`  Batch ${batch.batchIndex} (${batch.width} workspace(s)): ${batch.workspaceIds.join(", ")}`);
	}
	lines.push("");

	// Diagnostics
	if (analysis.diagnostics.length > 0) {
		lines.push("--- Diagnostics ---");
		for (const d of analysis.diagnostics) {
			const icon = d.severity === "error" ? "!" : d.severity === "warning" ? "?" : "i";
			lines.push(`  [${icon}] [${d.code ?? "info"}] ${d.message}`);
		}
		lines.push("");
	}

	// Authored preview
	if (analysis.authoredPreviewStale) {
		lines.push("--- Important ---");
		lines.push("  Authored batch preview is stale. The recomputed plan is authoritative.");
		lines.push("");
	}

	// Optimization summary
	lines.push(formatOptimizationResult(analysis.optimization));

	return lines.join("\n");
}

/**
 * Approve an optimization proposal within the plan intake lifecycle.
 */
export function approveIntakeProposal(analysis: PlanIntakeAnalysis, proposalId: string): PlanIntakeAnalysis {
	const updatedProposals = analysis.optimization.proposals.map((p) => (p.id === proposalId ? approveProposal(p) : p));

	const updatedOptimization = {
		...analysis.optimization,
		proposals: updatedProposals,
		hasPendingProposals: updatedProposals.some((p) => p.approvalStatus === "pending"),
	};

	const allResolved = !updatedOptimization.hasPendingProposals;

	return {
		...analysis,
		optimization: updatedOptimization,
		status: allResolved ? "approved" : "awaiting_approval",
		executionBlocked: !allResolved,
	};
}

/**
 * Reject an optimization proposal within the plan intake lifecycle.
 */
export function rejectIntakeProposal(
	analysis: PlanIntakeAnalysis,
	proposalId: string,
	reason: string,
): PlanIntakeAnalysis {
	const updatedProposals = analysis.optimization.proposals.map((p) =>
		p.id === proposalId ? rejectProposal(p, reason) : p,
	);

	const updatedOptimization = {
		...analysis.optimization,
		proposals: updatedProposals,
		hasPendingProposals: updatedProposals.some((p) => p.approvalStatus === "pending"),
	};

	return {
		...analysis,
		optimization: updatedOptimization,
	};
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Create an empty optimization result (when skipping optimization).
 */
function createEmptyOptimizationResult(queue: WorkspaceQueue, batchPlan: BatchPlanResult): DagOptimizationResult {
	return {
		queue,
		proposals: [],
		beforeBatchPlan: batchPlan,
		bestCaseBatchPlan: null,
		summary: {
			totalProposals: 0,
			splitProposals: 0,
			dependencyRemovalProposals: 0,
			dependencyAdditionProposals: 0,
			parallelismImprovement: 0,
			batchReduction: 0,
			criticalPathReduction: 0,
			canFullyDeserialize: false,
			text: "Optimization skipped",
		},
		hasPendingProposals: false,
	};
}
