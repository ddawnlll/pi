/**
 * DAG Optimizer - P7.B
 *
 * Analyzes workspace dependency graphs to identify optimization opportunities
 * and produce actionable proposals for improving parallelism. Builds on the
 * DAG Analyzer (topological batch computation) and Dependency Patch system
 * (safe dependency edits).
 *
 * Acceptance Criteria:
 * 1. Optimizer identifies critical path and bottlenecks.
 * 2. Optimizer proposes workspace splits and dependency reductions with evidence.
 * 3. Dependency changes require approval before becoming executable.
 */

import type { BatchPlanResult } from "./dag-analyzer.js";
import { computeBatchPlan } from "./dag-analyzer.js";
import {
	createAddDependencyPatch,
	createDependencyPatchPlan,
	createRemoveDependencyPatch,
	type DependencyPatch,
	type DependencyPatchPlan,
	type DependencyPatchPreview,
	previewDependencyPatchPlan,
	simulatePatchApplication,
	validateDependencyPatchPlan,
} from "./dependency-patch.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Optimization Proposal Types
// ---------------------------------------------------------------------------

/**
 * The kind of optimization proposal.
 */
export type OptimizationKind =
	/** Split a workspace into smaller parallel workspaces */
	| "split_workspace"
	/** Remove a transitive or unnecessary dependency */
	| "remove_dependency"
	/** Add a dependency to enforce ordering (serialization) */
	| "add_dependency";

/**
 * Status of an optimization proposal in the approval flow.
 */
export type ApprovalStatus = "pending" | "approved" | "rejected";

/**
 * Evidence supporting an optimization proposal.
 *
 * Shows the before/after impact of applying the proposal.
 */
export interface OptimizationEvidence {
	/** Effective parallelism before the change */
	beforeParallelism: number;
	/** Effective parallelism after the change */
	afterParallelism: number;
	/** Number of batches before the change */
	beforeBatchCount: number;
	/** Number of batches after the change */
	afterBatchCount: number;
	/** Critical path length before the change */
	beforeCriticalPathLength: number;
	/** Critical path length after the change */
	afterCriticalPathLength: number;
	/** Whether the change eliminates over-serialization */
	eliminatesOverSerialization: boolean;
	/** Human-readable description of the impact */
	description: string;
}

/**
 * A proposal to split a workspace into smaller parallel units.
 */
export interface SplitProposal {
	/** The workspace ID to split */
	workspaceId: string;
	/** Proposed names for the split workspaces */
	proposedWorkspaceIds: string[];
	/** How each split segment maps to the original workspace's scope */
	splitRationale: string[];
	/** The original workspace's acceptance criteria distributed across splits */
	acceptanceCriteriaDistribution?: Record<string, string[]>;
}

/**
 * A proposal to remove a dependency.
 */
export interface DependencyRemovalProposal {
	/** The workspace to remove the dependency from */
	workspaceId: string;
	/** The dependency to remove */
	dependencyId: string;
	/** Why this dependency is unnecessary (e.g., transitive, redundant) */
	rationale: "transitive" | "redundant" | "not_required" | "file_independent";
	/** Explanation of the rationale */
	explanation: string;
}

/**
 * A proposal to add a dependency (serialization).
 */
export interface DependencyAdditionProposal {
	/** The workspace to add the dependency to */
	workspaceId: string;
	/** The dependency to add */
	dependencyId: string;
	/** Why this dependency should be added (e.g., file overlap, risk) */
	rationale: "file_overlap" | "high_risk" | "integration_order";
	/** Explanation of the rationale */
	explanation: string;
}

/**
 * A single optimization proposal with supporting evidence.
 */
export interface OptimizationProposal {
	/** Unique proposal identifier */
	id: string;
	/** Kind of optimization */
	kind: OptimizationKind;
	/** Detailed description of the proposal */
	description: string;
	/** Evidence showing before/after impact */
	evidence: OptimizationEvidence;
	/** The dependency patch(es) needed to apply this proposal */
	patches: DependencyPatch[];
	/** The workspace IDs affected by this proposal */
	affectedWorkspaceIds: string[];
	/** Current approval status */
	approvalStatus: ApprovalStatus;
	/** Reason for rejection (if rejected) */
	rejectionReason?: string;
	/** Batch plan preview showing impact (populated on generation) */
	beforeBatchPlan: BatchPlanResult;
	afterBatchPlan: BatchPlanResult;
	/** Split-specific data (if kind === "split_workspace") */
	splitDetail?: SplitProposal;
	/** Dependency removal-specific data (if kind === "remove_dependency") */
	removalDetail?: DependencyRemovalProposal;
	/** Dependency addition-specific data (if kind === "add_dependency") */
	additionDetail?: DependencyAdditionProposal;
}

/**
 * The complete result of a DAG optimization analysis.
 */
export interface DagOptimizationResult {
	/** The workspace queue that was analyzed */
	queue: WorkspaceQueue;
	/** Proposals generated by the optimizer */
	proposals: OptimizationProposal[];
	/** Topological batch plan before any optimizations */
	beforeBatchPlan: BatchPlanResult;
	/** Batch plan if ALL proposals were applied (best case) */
	bestCaseBatchPlan: BatchPlanResult | null;
	/** Summary statistics */
	summary: OptimizationSummary;
	/** Whether there are pending proposals requiring approval */
	hasPendingProposals: boolean;
}

/**
 * Summary statistics for the optimization analysis.
 */
export interface OptimizationSummary {
	/** Total optimization proposals generated */
	totalProposals: number;
	/** Proposals by kind */
	splitProposals: number;
	dependencyRemovalProposals: number;
	dependencyAdditionProposals: number;
	/** Parallelism improvement potential */
	parallelismImprovement: number;
	/** Batch reduction potential */
	batchReduction: number;
	/** Critical path reduction potential */
	criticalPathReduction: number;
	/** Whether the plan can be fully de-serialized */
	canFullyDeserialize: boolean;
	/** Human-readable summary */
	text: string;
}

// ---------------------------------------------------------------------------
// Approval State
// ---------------------------------------------------------------------------

/**
 * Manages the approval lifecycle for optimization proposals.
 *
 * Proposals start as "pending" and must be explicitly approved or
 * rejected. Approved proposals can be converted to a dependency patch
 * plan and applied to the queue.
 */
export interface OptimizationApprovalSession {
	/** List of proposals being managed */
	proposals: OptimizationProposal[];
	/** The original workspace queue */
	originalQueue: WorkspaceQueue;
	/** Whether all pending proposals have been resolved */
	allResolved: boolean;
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

let proposalIdCounter = 0;

function generateProposalId(): string {
	proposalIdCounter++;
	return `opt-proposal-${proposalIdCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Core: Analyze Optimization Opportunities
// ---------------------------------------------------------------------------

/**
 * Analyze a workspace queue and generate optimization proposals.
 *
 * This is the main entry point for the DAG optimizer. It:
 * 1. Computes the baseline batch plan
 * 2. Identifies critical path bottlenecks
 * 3. Detects serialization opportunities (file overlap, risk)
 * 4. Generates proposals for workspace splits and dependency reductions
 * 5. Evaluates each proposal with before/after evidence
 *
 * @param queue - The workspace queue to analyze
 * @returns Optimization result with proposals and evidence
 */
export function analyzeOptimizationOpportunities(queue: WorkspaceQueue): DagOptimizationResult {
	const beforeBatchPlan = computeBatchPlan(queue);
	const proposals: OptimizationProposal[] = [];
	const wsMap = new Map(queue.workspaces.map((w) => [w.id, w]));

	// -----------------------------------------------------------------------
	// 1. Dependency reduction proposals
	//    Find transitive/redundant dependencies that can be safely removed.
	// -----------------------------------------------------------------------
	const removalProposals = generateDependencyReductionProposals(queue, beforeBatchPlan);
	proposals.push(...removalProposals);

	// -----------------------------------------------------------------------
	// 2. Workspace split proposals
	//    Identify bottleneck workspaces in single-width batches that have
	//    multiple acceptance criteria or large edit scopes.
	// -----------------------------------------------------------------------
	const splitProposals = generateSplitProposals(queue, beforeBatchPlan, wsMap);
	proposals.push(...splitProposals);

	// -----------------------------------------------------------------------
	// 3. Dependency addition proposals (serialization)
	//    Detect file overlaps between workspaces not in the same batch
	//    that could conflict if executed concurrently.
	// -----------------------------------------------------------------------
	const additionProposals = generateDependencyAdditionProposals(queue, beforeBatchPlan, wsMap);
	proposals.push(...additionProposals);

	// -----------------------------------------------------------------------
	// Compute best-case batch plan (apply all proposals)
	// -----------------------------------------------------------------------
	const bestCaseBatchPlan = computeBestCaseBatchPlan(queue, proposals);

	// -----------------------------------------------------------------------
	// Summary
	// -----------------------------------------------------------------------
	const summary = buildOptimizationSummary(proposals, beforeBatchPlan, bestCaseBatchPlan);

	return {
		queue,
		proposals,
		beforeBatchPlan,
		bestCaseBatchPlan,
		summary,
		hasPendingProposals: proposals.some((p) => p.approvalStatus === "pending"),
	};
}

// ---------------------------------------------------------------------------
// Dependency Reduction Analysis
// ---------------------------------------------------------------------------

/**
 * Generate proposals for removing unnecessary dependencies.
 *
 * Identifies:
 * - Transitive dependencies: A depends on B, and B depends on C, and A also
 *   directly depends on C. The A->C dependency is transitive and can be removed
 *   if B already serializes execution of C before A.
 * - Redundant dependencies: A depends on B, but removing it doesn't change
 *   the topological ordering because another path enforces the same order.
 *
 * @param queue - Workspace queue
 * @param batchPlan - Current batch plan
 * @param wsMap - Workspace ID -> Workspace map
 * @returns Array of optimization proposals
 */
function generateDependencyReductionProposals(
	queue: WorkspaceQueue,
	batchPlan: BatchPlanResult,
): OptimizationProposal[] {
	const proposals: OptimizationProposal[] = [];
	const wsBatchMap = buildWorkspaceBatchMap(batchPlan);

	// Build adjacency (forward) and reverse dependency graphs
	const forwardDeps = new Map<string, Set<string>>(); // ws -> deps of ws
	const reverseDeps = new Map<string, Set<string>>(); // dep -> workspaces that depend on it

	for (const ws of queue.workspaces) {
		for (const depId of ws.dependencies) {
			if (!forwardDeps.has(ws.id)) forwardDeps.set(ws.id, new Set());
			forwardDeps.get(ws.id)!.add(depId);

			if (!reverseDeps.has(depId)) reverseDeps.set(depId, new Set());
			reverseDeps.get(depId)!.add(ws.id);
		}
	}

	for (const ws of queue.workspaces) {
		if (ws.dependencies.length < 2) continue;

		// For each pair of dependencies (depA, depB), check if one transitively
		// depends on the other
		for (let i = 0; i < ws.dependencies.length; i++) {
			const depA = ws.dependencies[i];

			for (let j = i + 1; j < ws.dependencies.length; j++) {
				const depB = ws.dependencies[j];

				// Check if depA transitively depends on depB (depA -> ... -> depB)
				if (transitivelyDependsOn(depA, depB, forwardDeps, new Set())) {
					// ws depends on both depA and depB, but depA already depends on depB
					// So ws's dependency on depB is TRANSITIVE — depB will complete before depA anyway
					const proposal = buildRemovalProposal(
						ws,
						depB,
						"transitive",
						`"${ws.id}" depends on "${depB}", but "${depA}" already depends on "${depB}". Removing "${depB}" from "${ws.id}" would not change execution order because "${depB}" must complete before "${depA}" anyway.`,
						queue,
						batchPlan,
					);
					if (proposal) proposals.push(proposal);
				}

				// Check if depB transitively depends on depA
				if (transitivelyDependsOn(depB, depA, forwardDeps, new Set())) {
					const proposal = buildRemovalProposal(
						ws,
						depA,
						"transitive",
						`"${ws.id}" depends on "${depA}", but "${depB}" already depends on "${depA}". Removing "${depA}" from "${ws.id}" would not change execution order because "${depA}" must complete before "${depB}" anyway.`,
						queue,
						batchPlan,
					);
					if (proposal) proposals.push(proposal);
				}

				// Check if depA and depB are in the same batch (both already completed)
				const batchA = wsBatchMap.get(depA) ?? 0;
				const batchB = wsBatchMap.get(depB) ?? 0;

				if (batchA > 0 && batchB > 0 && batchA === batchB) {
					// Both deps are in same batch — both complete at the same time.
					// ws only needs to depend on one of them
					const proposal = buildRemovalProposal(
						ws,
						depB,
						"redundant",
						`"${ws.id}" depends on both "${depA}" and "${depB}", but both are in batch ${batchA} and complete at the same time. Removing "${depB}" from "${ws.id}" would not affect its start time.`,
						queue,
						batchPlan,
					);
					if (proposal) proposals.push(proposal);
				}
			}
		}
	}

	// Deduplicate proposals (same workspace+dependency combination)
	return deduplicateProposals(proposals);
}

/**
 * Check if `start` transitively depends on `target` through the dependency graph.
 */
function transitivelyDependsOn(
	start: string,
	target: string,
	forwardDeps: Map<string, Set<string>>,
	visited: Set<string>,
): boolean {
	if (start === target) return false;
	if (visited.has(start)) return false;
	visited.add(start);

	const deps = forwardDeps.get(start);
	if (!deps) return false;

	for (const dep of deps) {
		if (dep === target) return true;
		if (transitivelyDependsOn(dep, target, forwardDeps, visited)) return true;
	}

	return false;
}

/**
 * Build a removal proposal with before/after evidence.
 */
function buildRemovalProposal(
	ws: Workspace,
	depId: string,
	rationale: DependencyRemovalProposal["rationale"],
	explanation: string,
	queue: WorkspaceQueue,
	beforeBatchPlan: BatchPlanResult,
): OptimizationProposal | null {
	// Create the patch
	const removePatch = createRemoveDependencyPatch(ws.id, depId, `Remove transitive dependency: ${explanation}`);

	// Create a patch plan with just this patch
	const patchPlan = createDependencyPatchPlan([removePatch], queue.phase);

	// Simulate applying the patch to see the impact
	const afterQueue = simulatePatchApplication(patchPlan, queue);
	const afterBatchPlan = computeBatchPlan(afterQueue);

	// Compute evidence
	const evidence: OptimizationEvidence = {
		beforeParallelism: beforeBatchPlan.effectiveParallelism,
		afterParallelism: afterBatchPlan.effectiveParallelism,
		beforeBatchCount: beforeBatchPlan.totalBatches,
		afterBatchCount: afterBatchPlan.totalBatches,
		beforeCriticalPathLength: beforeBatchPlan.criticalPathLength,
		afterCriticalPathLength: afterBatchPlan.criticalPathLength,
		eliminatesOverSerialization: beforeBatchPlan.isOverSerialized && !afterBatchPlan.isOverSerialized,
		description: `Removing dependency "${depId}" from "${ws.id}" changes parallelism from ${beforeBatchPlan.effectiveParallelism} to ${afterBatchPlan.effectiveParallelism} and batch count from ${beforeBatchPlan.totalBatches} to ${afterBatchPlan.totalBatches}.`,
	};

	return {
		id: generateProposalId(),
		kind: "remove_dependency",
		description: `Remove transitive dependency "${depId}" from "${ws.id}". ${explanation}`,
		evidence,
		patches: [removePatch],
		affectedWorkspaceIds: [ws.id, depId],
		approvalStatus: "pending",
		beforeBatchPlan,
		afterBatchPlan,
		removalDetail: {
			workspaceId: ws.id,
			dependencyId: depId,
			rationale,
			explanation,
		},
	};
}

/**
 * Deduplicate proposals that target the same workspace + dependency.
 */
function deduplicateProposals(proposals: OptimizationProposal[]): OptimizationProposal[] {
	const seen = new Set<string>();
	return proposals.filter((p) => {
		if (p.kind === "remove_dependency" && p.removalDetail) {
			const key = `${p.removalDetail.workspaceId}:${p.removalDetail.dependencyId}`;
			if (seen.has(key)) return false;
			seen.add(key);
		}
		return true;
	});
}

// ---------------------------------------------------------------------------
// Workspace Split Analysis
// ---------------------------------------------------------------------------

/**
 * Generate proposals for splitting bottleneck workspaces.
 *
 * Identifies workspaces that:
 * - Are in a single-width batch (serialization point) AND
 * - Have multiple acceptance criteria OR multiple capability files
 * - Have downstream dependents that would benefit from parallelization
 *
 * @param queue - Workspace queue
 * @param batchPlan - Current batch plan
 * @param wsMap - Workspace ID -> Workspace map
 * @returns Array of optimization proposals
 */
function generateSplitProposals(
	queue: WorkspaceQueue,
	batchPlan: BatchPlanResult,
	_wsMap: Map<string, Workspace>,
): OptimizationProposal[] {
	const proposals: OptimizationProposal[] = [];
	const wsBatchMap = buildWorkspaceBatchMap(batchPlan);

	// Build reverse dependency graph to find workspaces with many dependents
	const dependents = new Map<string, string[]>();
	for (const ws of queue.workspaces) {
		for (const depId of ws.dependencies) {
			const list = dependents.get(depId) ?? [];
			list.push(ws.id);
			dependents.set(depId, list);
		}
	}

	for (const ws of queue.workspaces) {
		const wsBatch = wsBatchMap.get(ws.id) ?? 0;
		const batch = batchPlan.batches.find((b) => b.workspaceIds.includes(ws.id));

		// Only consider workspaces in single-width batches for splitting
		if (!batch || batch.width > 1) continue;

		// Check if this workspace has dependent workspaces (splitting would help)
		const wsDependents = dependents.get(ws.id) ?? [];
		if (wsDependents.length === 0) continue;

		// Check if this workspace has multiple acceptance criteria
		const acceptanceCriteria = ws.acceptanceCriteria ?? [];
		if (acceptanceCriteria.length < 2) continue;

		// Propose splitting the workspace
		const proposedIds = acceptanceCriteria.map((_, idx) => `${ws.id}.part${idx + 1}`);

		const splitDetail: SplitProposal = {
			workspaceId: ws.id,
			proposedWorkspaceIds: proposedIds,
			splitRationale: acceptanceCriteria.map((ac, idx) => `Part ${idx + 1}: handles "${ac}"`),
			acceptanceCriteriaDistribution: {
				[ws.id]: [...acceptanceCriteria],
				...Object.fromEntries(proposedIds.map((pid, idx) => [pid, [acceptanceCriteria[idx]]])),
			},
		};

		// Build the proposal
		const description = `Split "${ws.id}" (batch ${wsBatch}) into ${proposedIds.length} parallel workspaces. Currently in a single-width batch with ${acceptanceCriteria.length} acceptance criteria and ${wsDependents.length} downstream dependents.`;

		const proposal = buildSplitOptimizationProposal(ws, description, splitDetail, queue, batchPlan);

		if (proposal) proposals.push(proposal);
	}

	return proposals;
}

/**
 * Build a split optimization proposal with before/after evidence.
 *
 * For split proposals, the "after" state is estimated by creating a simulated
 * queue where the split workspace is replaced by multiple smaller workspaces
 * that can run in parallel (no interdependencies between parts).
 */
function buildSplitOptimizationProposal(
	ws: Workspace,
	description: string,
	splitDetail: SplitProposal,
	queue: WorkspaceQueue,
	beforeBatchPlan: BatchPlanResult,
): OptimizationProposal | null {
	const acceptanceCriteria = ws.acceptanceCriteria ?? [];
	if (acceptanceCriteria.length < 2) return null;

	const proposedIds = splitDetail.proposedWorkspaceIds;
	const splitCount = proposedIds.length;

	// Create a simulated queue with the split workspaces
	const afterWorkspaces: Workspace[] = queue.workspaces
		.filter((w) => w.id !== ws.id) // Remove the original workspace
		.concat(
			proposedIds.map((pid, idx) => ({
				...ws,
				id: pid,
				title: `${ws.title} (Part ${idx + 1})`,
				dependencies: [...ws.dependencies], // Same dependencies as original
				acceptanceCriteria: [acceptanceCriteria[idx]],
				capabilities: ws.capabilities
					? {
							...ws.capabilities,
							canEdit:
								splitCount > 1
									? ws.capabilities.canEdit.filter((_, fi) => fi % splitCount === idx)
									: ws.capabilities.canEdit,
						}
					: undefined,
			})),
		);

	const afterQueue: WorkspaceQueue = {
		...queue,
		workspaces: afterWorkspaces,
	};

	const afterBatchPlan = computeBatchPlan(afterQueue);

	// Build patches: for split proposals, we don't create actual patches
	// because splits require manual restructuring. Instead, we document
	// the proposed changes.

	const evidence: OptimizationEvidence = {
		beforeParallelism: beforeBatchPlan.effectiveParallelism,
		afterParallelism: afterBatchPlan.effectiveParallelism,
		beforeBatchCount: beforeBatchPlan.totalBatches,
		afterBatchCount: afterBatchPlan.totalBatches,
		beforeCriticalPathLength: beforeBatchPlan.criticalPathLength,
		afterCriticalPathLength: afterBatchPlan.criticalPathLength,
		eliminatesOverSerialization: beforeBatchPlan.isOverSerialized && !afterBatchPlan.isOverSerialized,
		description: `Splitting "${ws.id}" into ${splitCount} parallel workspaces changes parallelism from ${beforeBatchPlan.effectiveParallelism} to ${afterBatchPlan.effectiveParallelism} and batch count from ${beforeBatchPlan.totalBatches} to ${afterBatchPlan.totalBatches}.`,
	};

	return {
		id: generateProposalId(),
		kind: "split_workspace",
		description,
		evidence,
		patches: [], // Splits are not automated patches
		affectedWorkspaceIds: [ws.id, ...proposedIds],
		approvalStatus: "pending",
		beforeBatchPlan,
		afterBatchPlan,
		splitDetail,
	};
}

// ---------------------------------------------------------------------------
// Dependency Addition Analysis (Serialization)
// ---------------------------------------------------------------------------

/**
 * Generate proposals for adding dependencies to serialize execution.
 *
 * Identifies:
 * - File overlaps between workspaces that are not serialized
 * - High-risk workspaces that should be serialized after safe workspaces
 *
 * @param queue - Workspace queue
 * @param batchPlan - Current batch plan
 * @param wsMap - Workspace ID -> Workspace map
 * @returns Array of optimization proposals
 */
function generateDependencyAdditionProposals(
	queue: WorkspaceQueue,
	batchPlan: BatchPlanResult,
	_wsMap: Map<string, Workspace>,
): OptimizationProposal[] {
	const proposals: OptimizationProposal[] = [];
	// Skip addition proposals if the plan has errors
	if (batchPlan.errors.length > 0) return proposals;

	const wsBatchMap = buildWorkspaceBatchMap(batchPlan);

	// Check for file overlaps between workspaces.
	// If workspaces A and B don't have a dependency but edit the same file,
	// they should be serialized to prevent conflicts, regardless of batch.
	for (let i = 0; i < queue.workspaces.length; i++) {
		for (let j = i + 1; j < queue.workspaces.length; j++) {
			const wsA = queue.workspaces[i];
			const wsB = queue.workspaces[j];

			// Skip if already related by dependency
			if (hasDirectOrTransitiveDependency(wsA.id, wsB.id, queue.workspaces)) continue;

			// Check file overlap
			const filesA = new Set(wsA.capabilities?.canEdit ?? []);
			const filesB = new Set(wsB.capabilities?.canEdit ?? []);
			const overlapping = [...filesA].filter((f) => filesB.has(f));

			if (overlapping.length > 0) {
				// Determine which workspace should depend on the other.
				// If they're in different batches, the later batch workspace
				// should depend on the earlier one. If they're in the same batch
				// (both can run in parallel), pick the one that appears later
				// in the workspace list.
				const batchA = wsBatchMap.get(wsA.id) ?? 0;
				const batchB = wsBatchMap.get(wsB.id) ?? 0;

				let earlierId: string;
				let laterId: string;
				let laterWs: Workspace;

				if (batchA !== batchB) {
					// Different batches: later batch depends on earlier
					earlierId = batchA < batchB ? wsA.id : wsB.id;
					laterId = batchA < batchB ? wsB.id : wsA.id;
					laterWs = batchA < batchB ? wsB : wsA;
				} else {
					// Same batch: serializing by declaring one depends on the other
					earlierId = wsA.id;
					laterId = wsB.id;
					laterWs = wsB;
				}

				// Check if the later workspace already depends on the earlier one
				if (laterWs.dependencies.includes(earlierId)) continue;

				// Propose adding a dependency
				const addPatch = createAddDependencyPatch(
					laterId,
					earlierId,
					`Serialize file access: workspaces "${wsA.id}" and "${wsB.id}" both edit [${overlapping.join(", ")}]`,
				);

				const proposal = buildAdditionProposal(
					laterWs,
					earlierId,
					"file_overlap",
					`"${laterId}" edits file(s) [${overlapping.join(", ")}] that "${earlierId}" also edits. Adding a dependency ensures serialized access and prevents conflicts.`,
					addPatch,
					queue,
					batchPlan,
				);

				if (proposal) proposals.push(proposal);
			}
		}
	}

	// Check for high-risk workspaces that should be serialized after their dependents
	for (const ws of queue.workspaces) {
		if (ws.riskLevel !== "high") continue;
		const wsBatch = wsBatchMap.get(ws.id) ?? 0;

		// If a high-risk workspace is in an early batch, suggest serializing
		// (high-risk should run after validation workspaces)
		if (wsBatch <= 1) {
			// Find workspace in a later batch to add a dependency from
			// (this is a "soft" suggestion — execution order is reversed)
			// Actually, we skip this for now as it's complex and not always desirable
		}
	}

	return proposals;
}

/**
 * Check if there is a direct or transitive dependency between two workspaces.
 */
function hasDirectOrTransitiveDependency(wsIdA: string, wsIdB: string, workspaces: Workspace[]): boolean {
	const forwardDeps = new Map<string, Set<string>>();
	for (const ws of workspaces) {
		for (const depId of ws.dependencies) {
			if (!forwardDeps.has(ws.id)) forwardDeps.set(ws.id, new Set());
			forwardDeps.get(ws.id)!.add(depId);
		}
	}

	return (
		transitivelyDependsOn(wsIdA, wsIdB, forwardDeps, new Set()) ||
		transitivelyDependsOn(wsIdB, wsIdA, forwardDeps, new Set())
	);
}

/**
 * Build an addition proposal with before/after evidence.
 */
function buildAdditionProposal(
	ws: Workspace,
	depId: string,
	rationale: DependencyAdditionProposal["rationale"],
	explanation: string,
	addPatch: DependencyPatch,
	queue: WorkspaceQueue,
	beforeBatchPlan: BatchPlanResult,
): OptimizationProposal | null {
	// Create a patch plan with just this patch
	const patchPlan = createDependencyPatchPlan([addPatch], queue.phase);

	// Validate the patch
	const validation = validateDependencyPatchPlan(patchPlan, queue);
	if (!validation.valid) return null; // Skip invalid proposals

	// Simulate applying the patch
	const afterQueue = simulatePatchApplication(patchPlan, queue);
	const afterBatchPlan = computeBatchPlan(afterQueue);

	// Compute evidence
	const evidence: OptimizationEvidence = {
		beforeParallelism: beforeBatchPlan.effectiveParallelism,
		afterParallelism: afterBatchPlan.effectiveParallelism,
		beforeBatchCount: beforeBatchPlan.totalBatches,
		afterBatchCount: afterBatchPlan.totalBatches,
		beforeCriticalPathLength: beforeBatchPlan.criticalPathLength,
		afterCriticalPathLength: afterBatchPlan.criticalPathLength,
		eliminatesOverSerialization: false,
		description: `Adding dependency "${depId}" to "${ws.id}" changes batch count from ${beforeBatchPlan.totalBatches} to ${afterBatchPlan.totalBatches}. This may slightly reduce parallelism but prevents file conflicts.`,
	};

	return {
		id: generateProposalId(),
		kind: "add_dependency",
		description: `Add dependency "${depId}" to "${ws.id}". ${explanation}`,
		evidence,
		patches: [addPatch],
		affectedWorkspaceIds: [ws.id, depId],
		approvalStatus: "pending",
		beforeBatchPlan,
		afterBatchPlan,
		additionDetail: {
			workspaceId: ws.id,
			dependencyId: depId,
			rationale,
			explanation,
		},
	};
}

// ---------------------------------------------------------------------------
// Best-Case Batch Plan
// ---------------------------------------------------------------------------

/**
 * Compute what the batch plan would look like if ALL proposals were applied.
 *
 * Only includes proposals that have actual DependencyPatches (removal/addition).
 * Split proposals are advisory and don't have automated patches.
 */
function computeBestCaseBatchPlan(queue: WorkspaceQueue, proposals: OptimizationProposal[]): BatchPlanResult | null {
	// Collect all patches from approved/pending proposals
	const allPatches: DependencyPatch[] = [];
	for (const proposal of proposals) {
		if (proposal.kind === "split_workspace") continue; // No automated patches for splits
		allPatches.push(...proposal.patches);
	}

	if (allPatches.length === 0) {
		return computeBatchPlan(queue);
	}

	// Apply all patches to a simulated queue
	const patchPlan = createDependencyPatchPlan(allPatches, queue.phase);
	const afterQueue = simulatePatchApplication(patchPlan, queue);
	return computeBatchPlan(afterQueue);
}

// ---------------------------------------------------------------------------
// Approval Flow
// ---------------------------------------------------------------------------

/**
 * Approve a proposal.
 *
 * Marking a proposal as approved means the dependency changes it contains
 * are authorized to be applied. The proposal's patches can then be compiled
 * into a dependency patch plan and applied to the queue.
 *
 * @param proposal - The proposal to approve
 * @returns A new proposal with updated status
 */
export function approveProposal(proposal: OptimizationProposal): OptimizationProposal {
	return {
		...proposal,
		approvalStatus: "approved",
	};
}

/**
 * Reject a proposal with a reason.
 *
 * @param proposal - The proposal to reject
 * @param reason - Human-readable reason for rejection
 * @returns A new proposal with updated status
 */
export function rejectProposal(proposal: OptimizationProposal, reason: string): OptimizationProposal {
	return {
		...proposal,
		approvalStatus: "rejected",
		rejectionReason: reason,
	};
}

/**
 * Convert approved proposals into a dependency patch plan that can be
 * validated and applied to the queue.
 *
 * Only proposals with status "approved" and an applicable kind
 * (remove_dependency, add_dependency) are included. Split proposals
 * are advisory and require manual restructuring.
 *
 * @param proposals - The proposals to convert (must be approved)
 * @param queue - The target workspace queue
 * @returns A dependency patch plan, or null if no applicable approved proposals
 * @throws Error if any proposal is not approved
 */
export function createPatchPlanFromApprovedProposals(
	proposals: OptimizationProposal[],
	queue: WorkspaceQueue,
): DependencyPatchPlan {
	const approved = proposals.filter((p) => p.approvalStatus === "approved");

	const unapproved = proposals.filter((p) => p.approvalStatus !== "approved" && p.patches.length > 0);
	if (unapproved.length > 0) {
		throw new Error(
			`Cannot create patch plan: ${unapproved.length} proposal(s) with dependency changes have not been approved: ${unapproved.map((p) => `"${p.id}" (${p.approvalStatus})`).join(", ")}`,
		);
	}

	const allPatches: DependencyPatch[] = [];
	for (const proposal of approved) {
		if (proposal.kind === "split_workspace") continue; // Advisory only
		allPatches.push(...proposal.patches);
	}

	if (allPatches.length === 0) {
		throw new Error("No patchable proposals (remove_dependency or add_dependency) are approved");
	}

	const plan = createDependencyPatchPlan(allPatches, queue.phase);
	const validation = validateDependencyPatchPlan(plan, queue);

	if (!validation.valid) {
		throw new Error(`Patch plan validation failed: ${validation.errors.map((e) => e.message).join("; ")}`);
	}

	return plan;
}

/**
 * Preview the effect of applying all approved proposals to the queue.
 *
 * Shows the before/after state of the workspace dependency graph.
 *
 * @param proposals - Proposals (approved ones will be applied)
 * @param queue - The target workspace queue
 * @returns A preview of the patch plan
 */
export function previewApprovedProposals(
	proposals: OptimizationProposal[],
	queue: WorkspaceQueue,
): DependencyPatchPreview {
	const plan = createPatchPlanFromApprovedProposals(proposals, queue);
	return previewDependencyPatchPlan(plan, queue);
}

/**
 * Apply all approved proposals to the queue.
 *
 * This creates a validated patch plan, applies it, and returns the new
 * workspace queue with all dependency changes applied.
 *
 * @param proposals - Proposals (only approved ones are applied)
 * @param queue - The target workspace queue
 * @returns A new workspace queue with approved changes applied
 */
export function applyApprovedProposals(proposals: OptimizationProposal[], queue: WorkspaceQueue): WorkspaceQueue {
	const plan = createPatchPlanFromApprovedProposals(proposals, queue);
	return simulatePatchApplication(plan, queue);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format optimization proposals as a human-readable string.
 *
 * @param result - Optimization result to format
 * @returns Formatted string
 */
export function formatOptimizationResult(result: DagOptimizationResult): string {
	const lines: string[] = [];

	lines.push("=== DAG Optimization Analysis ===");
	lines.push("");

	// Summary
	lines.push(result.summary.text);
	lines.push("");

	// Current state
	lines.push("Current Batch Plan:");
	lines.push(`  Batches:              ${result.beforeBatchPlan.totalBatches}`);
	lines.push(`  Effective parallelism: ${result.beforeBatchPlan.effectiveParallelism}`);
	lines.push(`  Requested parallelism: ${result.beforeBatchPlan.requestedParallelism}`);
	lines.push(`  Critical path length:  ${result.beforeBatchPlan.criticalPathLength}`);

	if (result.beforeBatchPlan.warnings.length > 0) {
		lines.push(`  Warnings: ${result.beforeBatchPlan.warnings.length}`);
		for (const w of result.beforeBatchPlan.warnings) {
			lines.push(`    - ${w.message}`);
		}
	}
	lines.push("");

	// Best case
	if (result.bestCaseBatchPlan) {
		lines.push("Best Case (with all proposals applied):");
		lines.push(`  Batches:              ${result.bestCaseBatchPlan.totalBatches}`);
		lines.push(`  Effective parallelism: ${result.bestCaseBatchPlan.effectiveParallelism}`);
		lines.push(`  Critical path length:  ${result.bestCaseBatchPlan.criticalPathLength}`);
		lines.push("");
	}

	// Proposals
	if (result.proposals.length === 0) {
		lines.push("No optimization proposals generated.");
	} else {
		lines.push(`Proposals (${result.proposals.length}):`);
		lines.push("");

		// Dependency removal proposals
		const removals = result.proposals.filter((p) => p.kind === "remove_dependency");
		if (removals.length > 0) {
			lines.push("--- Dependency Removals ---");
			for (const p of removals) {
				const statusMark = statusSymbol(p.approvalStatus);
				lines.push(`  ${statusMark} [${p.id}] ${p.description}`);
				lines.push(
					`      Before: batch_count=${p.evidence.beforeBatchCount}, parallelism=${p.evidence.beforeParallelism}`,
				);
				lines.push(
					`      After:  batch_count=${p.evidence.afterBatchCount}, parallelism=${p.evidence.afterParallelism}`,
				);
				if (p.removalDetail) {
					lines.push(`      Rationale: ${p.removalDetail.rationale} — ${p.removalDetail.explanation}`);
				}
				if (p.rejectionReason) {
					lines.push(`      REJECTED: ${p.rejectionReason}`);
				}
				lines.push("");
			}
		}

		// Split proposals
		const splits = result.proposals.filter((p) => p.kind === "split_workspace");
		if (splits.length > 0) {
			lines.push("--- Workspace Splits ---");
			for (const p of splits) {
				const statusMark = statusSymbol(p.approvalStatus);
				lines.push(`  ${statusMark} [${p.id}] ${p.description}`);
				lines.push(
					`      Before: batch_count=${p.evidence.beforeBatchCount}, parallelism=${p.evidence.beforeParallelism}`,
				);
				lines.push(
					`      After:  batch_count=${p.evidence.afterBatchCount}, parallelism=${p.evidence.afterParallelism}`,
				);
				if (p.splitDetail) {
					const parts = p.splitDetail.proposedWorkspaceIds.join(", ");
					lines.push(`      Proposed parts: ${parts}`);
				}
				if (p.rejectionReason) {
					lines.push(`      REJECTED: ${p.rejectionReason}`);
				}
				lines.push("");
			}
		}

		// Dependency addition proposals
		const additions = result.proposals.filter((p) => p.kind === "add_dependency");
		if (additions.length > 0) {
			lines.push("--- Dependency Additions ---");
			for (const p of additions) {
				const statusMark = statusSymbol(p.approvalStatus);
				lines.push(`  ${statusMark} [${p.id}] ${p.description}`);
				lines.push(
					`      Before: batch_count=${p.evidence.beforeBatchCount}, parallelism=${p.evidence.beforeParallelism}`,
				);
				lines.push(
					`      After:  batch_count=${p.evidence.afterBatchCount}, parallelism=${p.evidence.afterParallelism}`,
				);
				if (p.additionDetail) {
					lines.push(`      Rationale: ${p.additionDetail.rationale} — ${p.additionDetail.explanation}`);
				}
				if (p.rejectionReason) {
					lines.push(`      REJECTED: ${p.rejectionReason}`);
				}
				lines.push("");
			}
		}
	}

	// Approval info
	const pendingCount = result.proposals.filter((p) => p.approvalStatus === "pending").length;
	if (pendingCount > 0) {
		lines.push("---");
		lines.push(
			`${pendingCount} proposal(s) require approval. Use approveProposal() to approve, rejectProposal() to reject.`,
		);
		lines.push("Dependency changes are NOT executable until approved.");
	}

	return lines.join("\n");
}

function statusSymbol(status: ApprovalStatus): string {
	switch (status) {
		case "approved":
			return "[APPROVED]";
		case "rejected":
			return "[REJECTED]";
		case "pending":
			return "[PENDING]";
	}
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Build a workspace ID -> batch index map from a batch plan.
 */
function buildWorkspaceBatchMap(batchPlan: BatchPlanResult): Map<string, number> {
	const map = new Map<string, number>();
	for (const batch of batchPlan.batches) {
		for (const wsId of batch.workspaceIds) {
			map.set(wsId, batch.batchIndex);
		}
	}
	return map;
}

/**
 * Build an optimization summary.
 */
function buildOptimizationSummary(
	proposals: OptimizationProposal[],
	beforePlan: BatchPlanResult,
	bestCasePlan: BatchPlanResult | null,
): OptimizationSummary {
	const removals = proposals.filter((p) => p.kind === "remove_dependency").length;
	const splits = proposals.filter((p) => p.kind === "split_workspace").length;
	const additions = proposals.filter((p) => p.kind === "add_dependency").length;

	let parallelismImprovement = 0;
	let batchReduction = 0;
	let criticalPathReduction = 0;
	let canFullyDeserialize = false;

	if (bestCasePlan) {
		parallelismImprovement = bestCasePlan.effectiveParallelism - beforePlan.effectiveParallelism;
		batchReduction = beforePlan.totalBatches - bestCasePlan.totalBatches;
		criticalPathReduction = beforePlan.criticalPathLength - bestCasePlan.criticalPathLength;
		canFullyDeserialize = beforePlan.isOverSerialized && !bestCasePlan.isOverSerialized;
	}

	// Build human-readable summary
	const parts: string[] = [];
	parts.push(`Found ${proposals.length} optimization opportunities:`);
	if (removals > 0) parts.push(`${removals} dependency removal(s)`);
	if (splits > 0) parts.push(`${splits} workspace split(s)`);
	if (additions > 0) parts.push(`${additions} dependency addition(s)`);
	parts.push("");

	if (bestCasePlan && proposals.length > 0) {
		parts.push(`Potential improvements with all proposals applied:`);
		if (parallelismImprovement > 0) {
			parts.push(
				`  +${parallelismImprovement} effective parallelism (${beforePlan.effectiveParallelism} -> ${bestCasePlan.effectiveParallelism})`,
			);
		}
		if (batchReduction > 0) {
			parts.push(`  -${batchReduction} batches (${beforePlan.totalBatches} -> ${bestCasePlan.totalBatches})`);
		}
		if (criticalPathReduction > 0) {
			parts.push(
				`  -${criticalPathReduction} critical path steps (${beforePlan.criticalPathLength} -> ${bestCasePlan.criticalPathLength})`,
			);
		}
		if (canFullyDeserialize) {
			parts.push("  Eliminates over-serialization");
		}
		if (parallelismImprovement === 0 && batchReduction === 0 && criticalPathReduction === 0) {
			parts.push("  No measurable parallelism improvement (changes are about correctness/safety)");
		}
	} else if (proposals.length === 0) {
		parts.push("No optimization opportunities found.");
	}

	const text = parts.join("\n");

	return {
		totalProposals: proposals.length,
		splitProposals: splits,
		dependencyRemovalProposals: removals,
		dependencyAdditionProposals: additions,
		parallelismImprovement,
		batchReduction,
		criticalPathReduction,
		canFullyDeserialize,
		text,
	};
}
