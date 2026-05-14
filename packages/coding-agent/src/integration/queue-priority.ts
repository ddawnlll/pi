/**
 * Queue Priority - P2 Workstream 6.C
 *
 * Priority and critical-path scoring for integration queue entries.
 * Computes deterministic scores for workspace ordering decisions.
 *
 * Scoring dimensions:
 * - criticalPathRank: Longest path depth from root (entry point) to leaf.
 *   Workspaces on the critical path have the highest rank.
 * - unlockImpact: Number of workspaces (transitively) blocked by this one.
 *   High values mean merging this workspace unblocks many others.
 * - validationCost: Estimated cost of running validation. Based on risk
 *   level, acceptance criteria count, and capability manifest breadth.
 * - conflictRisk: Estimated probability of merge conflicts. Based on
 *   how many files this workspace edits and overlap with sibling branches.
 *
 * All scores are deterministic — same input always produces same output.
 */

import type { Workspace } from "../core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Deterministic priority score for a single workspace.
 */
export interface PriorityScore {
	/** Workspace ID */
	workspaceId: string;
	/**
	 * Critical path rank: the length of the longest path from this workspace
	 * to a leaf node in the dependency graph. Higher = more critical.
	 * A workspace with rank 0 has no dependents (leaf node).
	 */
	criticalPathRank: number;
	/**
	 * Unlock impact: the number of workspaces transitively blocked by this
	 * one. If this workspace hasn't merged, all its (direct and indirect)
	 * dependents are blocked. Higher = merging this unblocks more workspaces.
	 */
	unlockImpact: number;
	/**
	 * Estimated validation cost. Higher = more expensive to validate.
	 * Based on:
	 * - riskLevel: high=3, medium=2, low=1
	 * - acceptance criteria count (capped at 10)
	 * - capability manifest breadth (number of canEdit patterns)
	 */
	validationCost: number;
	/**
	 * Estimated conflict risk as a value in [0, 1].
	 * Higher = more likely to cause merge conflicts.
	 * Based on file edit breadth relative to other workspaces.
	 */
	conflictRisk: number;
	/**
	 * Composite total score.
	 * Higher-priority workspaces should be merged first.
	 * Formula: criticalPathRank * 100 + unlockImpact * 10 + conflictRisk * 5 - validationCost
	 */
	totalScore: number;
}

/**
 * A weighted edge in the dependency graph for critical-path analysis.
 */
interface DependencyNode {
	workspaceId: string;
	/** Direct dependencies (workspace IDs this one depends on) */
	dependencies: string[];
	/** Direct dependents (workspace IDs that depend on this one) */
	dependents: string[];
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/**
 * Build the dependency graph from a list of workspaces.
 *
 * Returns a Map from workspace ID to DependencyNode containing both
 * forward (dependencies) and reverse (dependents) edges.
 *
 * Input order does not affect the graph structure; determinism is
 * guaranteed by processing workspace IDs in sorted order within
 * scoring functions.
 *
 * @param workspaces - Workspace definitions
 * @returns Dependency graph nodes keyed by workspace ID
 */
export function buildGraph(workspaces: Workspace[]): Map<string, DependencyNode> {
	const graph = new Map<string, DependencyNode>();

	// Initialize all nodes
	for (const ws of workspaces) {
		graph.set(ws.id, {
			workspaceId: ws.id,
			dependencies: [...ws.dependencies],
			dependents: [],
		});
	}

	// Populate dependents from dependency edges
	for (const ws of workspaces) {
		for (const dep of ws.dependencies) {
			const depNode = graph.get(dep);
			if (depNode) {
				depNode.dependents.push(ws.id);
			}
		}
	}

	return graph;
}

// ---------------------------------------------------------------------------
// Critical path rank
// ---------------------------------------------------------------------------

/**
 * Compute the critical path rank for every workspace.
 *
 * The critical path rank is the length of the longest path from this
 * workspace to any leaf node (workspace with no dependents). Workspaces
 * that block many downstream workspaces have a higher rank.
 *
 * Algorithm: For each node, compute the longest path to a leaf using
 * recursive DFS with memoization. Nodes with no dependents have rank 0.
 * Ranks are computed in sorted workspace-ID order for determinism.
 *
 * @param graph - Dependency graph
 * @returns Map from workspace ID to critical path rank
 */
export function computeCriticalPathRanks(graph: Map<string, DependencyNode>): Map<string, number> {
	const memo = new Map<string, number>();

	/** Recursive DFS with memoization */
	function longestPathToLeaf(nodeId: string): number {
		const cached = memo.get(nodeId);
		if (cached !== undefined) {
			return cached;
		}

		const node = graph.get(nodeId);
		if (!node || node.dependents.length === 0) {
			memo.set(nodeId, 0);
			return 0;
		}

		// Sort dependents for determinism
		const sortedDependents = [...node.dependents].sort();
		let maxDepth = 0;
		for (const depId of sortedDependents) {
			const depth = 1 + longestPathToLeaf(depId);
			if (depth > maxDepth) {
				maxDepth = depth;
			}
		}

		memo.set(nodeId, maxDepth);
		return maxDepth;
	}

	// Process all nodes in sorted order for determinism
	const sortedIds = [...graph.keys()].sort();
	for (const id of sortedIds) {
		longestPathToLeaf(id);
	}

	return memo;
}

// ---------------------------------------------------------------------------
// Unlock impact
// ---------------------------------------------------------------------------

/**
 * Compute unlock impact for every workspace.
 *
 * Unlock impact is the count of workspaces (transitively) that depend on
 * this workspace. If workspace A merges, its dependents (and their
 * dependents, etc.) are unblocked.
 *
 * Uses DFS with memoization for efficiency. Computed in sorted ID order
 * for determinism.
 *
 * @param graph - Dependency graph
 * @returns Map from workspace ID to unlock impact (count of transitive dependents)
 */
export function computeUnlockImpact(graph: Map<string, DependencyNode>): Map<string, number> {
	const memo = new Map<string, Set<string>>();

	/**
	 * Compute the set of all transitive dependents of a node.
	 * Uses DFS with memoization for efficiency.
	 */
	function transitiveDependents(nodeId: string): Set<string> {
		const cached = memo.get(nodeId);
		if (cached !== undefined) {
			return cached;
		}

		const node = graph.get(nodeId);
		if (!node || node.dependents.length === 0) {
			const empty = new Set<string>();
			memo.set(nodeId, empty);
			return empty;
		}

		// Sort dependents for determinism
		const sortedDependents = [...node.dependents].sort();
		const collected = new Set<string>();

		for (const depId of sortedDependents) {
			collected.add(depId);
			const subSet = transitiveDependents(depId);
			for (const subId of subSet) {
				collected.add(subId);
			}
		}

		memo.set(nodeId, collected);
		return collected;
	}

	const result = new Map<string, number>();

	const sortedIds = [...graph.keys()].sort();
	for (const id of sortedIds) {
		const deps = transitiveDependents(id);
		result.set(id, deps.size);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Validation cost
// ---------------------------------------------------------------------------

/**
 * Compute validation cost estimate for a single workspace.
 *
 * Uses workspace metadata:
 * - riskLevel: high=3, medium=2, low=1, undefined=1 (default low)
 * - acceptanceCriteria count: 0..10 scale (capped at 10)
 * - capabilities.canEdit length: 0..10 scale (capped at 10)
 *
 * Formula: riskWeight * 5 + criteriaWeight * 2 + editBreadth * 1
 *
 * @param workspace - Workspace to score
 * @returns Estimated validation cost (0..55 range)
 */
export function computeValidationCost(workspace: Workspace): number {
	const riskWeight = workspace.riskLevel === "high" ? 3 : workspace.riskLevel === "medium" ? 2 : 1;
	const criteriaWeight = Math.min(workspace.acceptanceCriteria?.length ?? 0, 10);
	const editBreadth = Math.min(workspace.capabilities?.canEdit?.length ?? 0, 10);
	return riskWeight * 5 + criteriaWeight * 2 + editBreadth * 1;
}

// ---------------------------------------------------------------------------
// Conflict risk
// ---------------------------------------------------------------------------

/**
 * Compute conflict risk estimate for every workspace.
 *
 * Conflict risk measures how likely a workspace is to cause merge
 * conflicts. Higher values mean higher risk.
 *
 * Factors:
 * - Number of files edited (via capabilities.canEdit or acceptanceCriteria)
 * - Relative breadth compared to the mean across all workspaces
 *
 * Result is clamped to [0, 1].
 *
 * @param graph - Dependency graph
 * @param workspaces - All workspace definitions
 * @returns Map from workspace ID to conflict risk in [0, 1]
 */
export function computeConflictRisks(
	_graph: Map<string, DependencyNode>,
	workspaces: Workspace[],
): Map<string, number> {
	const risks = new Map<string, number>();

	// Compute edit breadth for each workspace
	const editBreadths = new Map<string, number>();
	for (const ws of workspaces) {
		const editCount = ws.capabilities?.canEdit?.length ?? 0;
		const acCount = ws.acceptanceCriteria?.length ?? 0;
		// Combined breadth: number of files + acceptance criteria (normalized)
		const breadth = editCount + Math.min(acCount, 5);
		editBreadths.set(ws.id, breadth);
	}

	// Compute mean edit breadth
	const allBreadths = Array.from(editBreadths.values());
	const meanBreadth = allBreadths.length > 0 ? allBreadths.reduce((a, b) => a + b, 0) / allBreadths.length : 0;

	// Compute risk for each workspace
	for (const ws of workspaces) {
		const breadth = editBreadths.get(ws.id) ?? 0;

		// Base risk from edit breadth relative to mean
		let risk = 0;
		if (meanBreadth > 0) {
			risk = breadth / (meanBreadth * 2); // Normalize to ~0.5 at mean
		}

		// Boost risk for high-risk workspaces
		if (ws.riskLevel === "high") {
			risk += 0.2;
		} else if (ws.riskLevel === "medium") {
			risk += 0.1;
		}

		// Clamp to [0, 1]
		risk = Math.max(0, Math.min(1, risk));
		risks.set(ws.id, risk);
	}

	return risks;
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

/**
 * Configuration for the priority scoring formula.
 */
export interface ScoringConfig {
	/** Weight for criticalPathRank in totalScore (default: 100) */
	criticalPathWeight: number;
	/** Weight for unlockImpact in totalScore (default: 10) */
	unlockImpactWeight: number;
	/** Weight for conflictRisk in totalScore (default: 5) */
	conflictRiskWeight: number;
	/** Weight for validationCost in totalScore (negative, default: -1) */
	validationCostWeight: number;
}

const DEFAULT_SCORING_CONFIG: ScoringConfig = {
	criticalPathWeight: 100,
	unlockImpactWeight: 10,
	conflictRiskWeight: 5,
	validationCostWeight: -1,
};

/**
 * Score all workspaces with full priority and critical-path metrics.
 *
 * Produces a PriorityScore for each workspace. Scores are deterministic:
 * the same set of workspaces always produces the same scores, independent
 * of input order.
 *
 * @param workspaces - All workspace definitions
 * @param config - Optional scoring formula configuration
 * @returns Array of PriorityScore, one per workspace, sorted by totalScore descending
 */
export function scoreWorkspaces(workspaces: Workspace[], config: Partial<ScoringConfig> = {}): PriorityScore[] {
	const cfg = { ...DEFAULT_SCORING_CONFIG, ...config };
	const graph = buildGraph(workspaces);
	const criticalPathRanks = computeCriticalPathRanks(graph);
	const unlockImpacts = computeUnlockImpact(graph);
	const conflictRisks = computeConflictRisks(graph, workspaces);

	const scores: PriorityScore[] = workspaces.map((ws) => {
		const criticalPathRank = criticalPathRanks.get(ws.id) ?? 0;
		const unlockImpact = unlockImpacts.get(ws.id) ?? 0;
		const conflictRisk = conflictRisks.get(ws.id) ?? 0;
		const validationCost = computeValidationCost(ws);

		const totalScore =
			criticalPathRank * cfg.criticalPathWeight +
			unlockImpact * cfg.unlockImpactWeight +
			conflictRisk * cfg.conflictRiskWeight +
			validationCost * cfg.validationCostWeight;

		return {
			workspaceId: ws.id,
			criticalPathRank,
			unlockImpact,
			validationCost,
			conflictRisk,
			totalScore,
		};
	});

	// Sort by totalScore descending (highest priority first)
	// Ties are broken by workspaceId for determinism
	scores.sort((a, b) => {
		if (b.totalScore !== a.totalScore) {
			return b.totalScore - a.totalScore;
		}
		return a.workspaceId.localeCompare(b.workspaceId);
	});

	return scores;
}
