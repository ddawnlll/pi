/**
 * Queue Optimizer - P2 Workstream 6.C / 6.D
 *
 * Optimizes the integration queue order based on priority and critical-path
 * scoring. Uses the scoring from queue-priority.ts to reorder entries so
 * that higher-priority workspaces are merged first.
 *
 * The optimizer is safe to call at any point: it only reorders queued entries
 * (status === "queued") and leaves entries in other states (merging,
 * validating, merged, failed, blocked, conflict) untouched.
 *
 * The optimizer accepts optional Workspace definitions for accurate
 * dependency-graph-based scoring. When workspace definitions are not
 * provided, it falls back to simple heuristic scoring based on available
 * queue entry metadata.
 *
 * 6.D enhancements:
 * - Dependency-safe reordering: topological constraints are enforced so no
 *   workspace is placed before its dependencies in the queue.
 * - Reorder suggestions: the optimizer can produce individual move suggestions
 *   describing which workspace should move where and why.
 * - Throughput impact explanations: each suggestion and the overall reordering
 *   includes a human-readable estimate of throughput impact.
 */

import type { Workspace } from "../core/workspace-schema.js";
import type { IntegrationQueueState, QueueEntry } from "./integration-queue.js";
import {
	buildGraph,
	computeCriticalPathRanks,
	computeUnlockImpact,
	type PriorityScore,
	scoreWorkspaces,
} from "./queue-priority.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a queue optimization run.
 */
export interface OptimizationResult {
	/** Reordered queue entries (full state) */
	state: IntegrationQueueState;
	/** Optimization was applied (queue order changed) */
	optimized: boolean;
	/** Number of queued entries that were reordered */
	entriesReordered: number;
	/** Priority scores for the reordered entries */
	scores: PriorityScore[];
	/** Reason why optimization was not applied (if !optimized) */
	reason?: string;
	/** Throughput impact explanation (when optimized) */
	throughputImpact?: ThroughputImpact;
}

/**
 * A single reorder suggestion describing one workspace move.
 */
export interface ReorderSuggestion {
	/** Workspace ID of the entry to move */
	workspaceId: string;
	/** Current position in the queue (0-indexed among all entries) */
	currentIndex: number;
	/** Suggested new position in the queue (0-indexed among all entries) */
	suggestedIndex: number;
	/** Human-readable reason for the suggestion */
	reason: string;
	/** Throughput impact of this specific move */
	throughputImpact: string;
}

/**
 * Throughput impact metrics for a queue reordering.
 */
export interface ThroughputImpact {
	/** Estimated wall-clock time savings (ms) */
	estimatedTimeSavedMs: number;
	/** Number of workspaces that will be unblocked sooner */
	workspacesUnblockedSooner: number;
	/** Reduction in critical path steps */
	criticalPathReduction: number;
	/** Human-readable explanation */
	explanation: string;
}

/**
 * The result of a suggestReorder() call.
 */
export interface ReorderSuggestionResult {
	/** The suggested optimal queue order */
	suggestedOrder: QueueEntry[];
	/** Individual move suggestions (one per entry that moved) */
	suggestions: ReorderSuggestion[];
	/** Priority scores for all queued entries */
	scores: PriorityScore[];
	/** Whether the suggested reordering is safe to apply */
	isSafe: boolean;
	/** Safety warning if !isSafe */
	safetyWarning?: string;
	/** Throughput impact of the entire suggested reordering */
	throughputImpact: ThroughputImpact;
	/** The original queue order before suggestions */
	originalOrder: QueueEntry[];
}

/**
 * Policy for queue optimization behavior.
 */
export interface OptimizationPolicy {
	/**
	 * Whether to auto-optimize the queue after each enqueue operation.
	 * Default: false.
	 */
	autoOptimize: boolean;

	/**
	 * Whether to skip optimization when there are blocked or conflict
	 * entries in the queue. Default: true.
	 */
	skipOnBlockers: boolean;

	/**
	 * Whether to preserve the relative order of workspaces with equal
	 * priority scores. Default: true.
	 */
	stableSort: boolean;
}

const DEFAULT_POLICY: OptimizationPolicy = {
	autoOptimize: false,
	skipOnBlockers: true,
	stableSort: true,
};

// ---------------------------------------------------------------------------
// QueueOptimizer
// ---------------------------------------------------------------------------

/**
 * Queue Optimizer
 *
 * Reorders queued entries in the integration queue based on priority
 * scoring. Workspaces with higher total scores are moved earlier in the
 * queue so they are merged first.
 *
 * The optimizer only touches entries with status === "queued". Entries
 * in any other state (merging, validating, merged, failed, blocked,
 * conflict) are left in their original positions.
 *
 * Dependency safety (6.D):
 * After score-based sorting, the optimizer enforces topological constraints
 * so that no workspace appears before its dependencies in the final order.
 * This guarantees that the reordering never violates dependency relationships.
 *
 * Reorder suggestions (6.D):
 * The suggestReorder() method returns individual move suggestions with
 * human-readable reasons and per-move throughput impact.
 */
export class QueueOptimizer {
	private policy: OptimizationPolicy;

	/**
	 * @param policy - Optional policy overrides
	 */
	constructor(policy: Partial<OptimizationPolicy> = {}) {
		this.policy = { ...DEFAULT_POLICY, ...policy };
	}

	/**
	 * Get the current optimization policy.
	 */
	getPolicy(): OptimizationPolicy {
		return { ...this.policy };
	}

	/**
	 * Update the optimization policy.
	 *
	 * @param updates - Partial policy updates
	 */
	updatePolicy(updates: Partial<OptimizationPolicy>): void {
		this.policy = { ...this.policy, ...updates };
	}

	// -----------------------------------------------------------------------
	// Optimize
	// -----------------------------------------------------------------------

	/**
	 * Optimize the queue order based on priority scoring.
	 *
	 * Only touches entries with status === "queued". Non-queued entries
	 * (merged, failed, blocked, conflict, merging, validating) are
	 * preserved in their original positions.
	 *
	 * The optimization applies dependency-safe topological ordering:
	 * after score-based sorting, a topological sort pass ensures that
	 * no workspace appears before any of its dependencies.
	 *
	 * When workspace definitions are provided, scoring uses the full
	 * dependency graph for accurate critical-path analysis and unlock
	 * impact computation. Without workspace definitions, a simple
	 * heuristic is used.
	 *
	 * @param state - Current integration queue state
	 * @param workspaceDefs - Optional full workspace definitions for accurate scoring
	 * @returns Optimization result
	 */
	optimize(state: IntegrationQueueState, workspaceDefs?: Workspace[]): OptimizationResult {
		const queuedEntries = state.entries.filter((e) => e.status === "queued");

		if (queuedEntries.length === 0) {
			return {
				state,
				optimized: false,
				entriesReordered: 0,
				scores: [],
				reason: "No queued entries to optimize",
			};
		}

		// Check for blockers if policy requires skipping
		if (this.policy.skipOnBlockers) {
			const hasBlockers = state.entries.some((e) => e.status === "blocked" || e.status === "conflict");
			if (hasBlockers) {
				return {
					state,
					optimized: false,
					entriesReordered: 0,
					scores: [],
					reason: "Queue has blocked or conflict entries; skipping optimization",
				};
			}
		}

		// Build Workspace objects for scoring
		const workspaceDefsToScore: Workspace[] = workspaceDefs ?? this.buildWorkspacesFromEntries(queuedEntries);

		// Score the workspaces
		const scores = scoreWorkspaces(workspaceDefsToScore);

		// Sort queued entries by score (descending)
		const scoreSorted = this.sortByScore(queuedEntries, scores);

		// Apply dependency-safe topological ordering (6.D)
		const topologicallySorted = this.enforceDependencyConstraints(scoreSorted, workspaceDefsToScore);

		// Check if the order actually changed from the original
		const orderChanged = topologicallySorted.some(
			(entry, index) => entry.workspaceId !== queuedEntries[index]?.workspaceId,
		);

		if (!orderChanged) {
			return {
				state,
				optimized: false,
				entriesReordered: 0,
				scores,
				reason: "Queue order already optimal",
			};
		}

		// Rebuild the full entries array: replace queued entries in-place,
		// preserving non-queued entries at their original positions
		const reordered: QueueEntry[] = [];
		let sortedIdx = 0;

		for (const entry of state.entries) {
			if (entry.status === "queued") {
				reordered.push(topologicallySorted[sortedIdx]!);
				sortedIdx++;
			} else {
				reordered.push(entry);
			}
		}

		// Compute throughput impact (6.D)
		const throughputImpact = this.computeThroughputImpact(
			queuedEntries,
			topologicallySorted,
			scores,
			workspaceDefsToScore,
		);

		const resultState: IntegrationQueueState = {
			...state,
			entries: reordered,
			updatedAt: Date.now(),
		};

		return {
			state: resultState,
			optimized: true,
			entriesReordered: topologicallySorted.length,
			scores,
			throughputImpact,
		};
	}

	// -----------------------------------------------------------------------
	// Reorder Suggestions (6.D)
	// -----------------------------------------------------------------------

	/**
	 * Generate reorder suggestions without modifying the queue.
	 *
	 * Returns a ReorderSuggestionResult containing:
	 * - The suggested optimal order
	 * - Individual move suggestions with reasons and per-move throughput impact
	 * - Overall throughput impact
	 * - Safety assessment
	 *
	 * This method never modifies the queue state. It is safe to call at any
	 * point for informational purposes.
	 *
	 * @param state - Current integration queue state
	 * @param workspaceDefs - Optional workspace definitions for accurate scoring
	 * @returns Reorder suggestions
	 */
	suggestReorder(state: IntegrationQueueState, workspaceDefs?: Workspace[]): ReorderSuggestionResult {
		const queuedEntries = state.entries.filter((e) => e.status === "queued");

		if (queuedEntries.length === 0) {
			const throughputImpact: ThroughputImpact = {
				estimatedTimeSavedMs: 0,
				workspacesUnblockedSooner: 0,
				criticalPathReduction: 0,
				explanation: "No queued entries to reorder.",
			};
			return {
				suggestedOrder: state.entries,
				suggestions: [],
				scores: [],
				isSafe: true,
				throughputImpact,
				originalOrder: [...state.entries],
			};
		}

		// Check for blockers
		if (this.policy.skipOnBlockers) {
			const hasBlockers = state.entries.some((e) => e.status === "blocked" || e.status === "conflict");
			if (hasBlockers) {
				const throughputImpact: ThroughputImpact = {
					estimatedTimeSavedMs: 0,
					workspacesUnblockedSooner: 0,
					criticalPathReduction: 0,
					explanation:
						"Queue has blocked or conflict entries. Resolve blockers before reordering for optimal throughput.",
				};
				return {
					suggestedOrder: state.entries,
					suggestions: [],
					scores: [],
					isSafe: true,
					safetyWarning: "Queue has blocked or conflict entries; reorder suggestions limited.",
					throughputImpact,
					originalOrder: [...state.entries],
				};
			}
		}

		// Build Workspace objects for scoring
		const workspaceDefsToScore: Workspace[] = workspaceDefs ?? this.buildWorkspacesFromEntries(queuedEntries);

		// Score the workspaces
		const scores = scoreWorkspaces(workspaceDefsToScore);

		// Sort by score
		const scoreSorted = this.sortByScore(queuedEntries, scores);

		// Apply dependency-safe topological ordering
		const topologicallySorted = this.enforceDependencyConstraints(scoreSorted, workspaceDefsToScore);

		// Check safety
		const isSafe = this.isReorderSafe(queuedEntries, topologicallySorted, workspaceDefsToScore);

		// Compute overall throughput impact
		const throughputImpact = this.computeThroughputImpact(
			queuedEntries,
			topologicallySorted,
			scores,
			workspaceDefsToScore,
		);

		// Build individual suggestions
		const suggestions = this.buildReorderSuggestions(
			state.entries,
			queuedEntries,
			topologicallySorted,
			scores,
			workspaceDefsToScore,
			throughputImpact,
		);

		// Build the full suggested order (non-queued entries preserved at their positions)
		const suggestedFullOrder: QueueEntry[] = [];
		let sortedIdx = 0;
		for (const entry of state.entries) {
			if (entry.status === "queued") {
				suggestedFullOrder.push(topologicallySorted[sortedIdx]!);
				sortedIdx++;
			} else {
				suggestedFullOrder.push(entry);
			}
		}

		return {
			suggestedOrder: suggestedFullOrder,
			suggestions,
			scores,
			isSafe,
			safetyWarning: isSafe ? undefined : "Reorder violates dependency constraints; apply with caution.",
			throughputImpact,
			originalOrder: [...state.entries],
		};
	}

	// -----------------------------------------------------------------------
	// Dependency-safe topological ordering (6.D)
	// -----------------------------------------------------------------------

	/**
	 * Enforce dependency constraints on a score-sorted array of queue entries.
	 *
	 * Uses Kahn's algorithm to produce a topological ordering that respects
	 * the partial order defined by workspace dependencies. The tiebreaking
	 * order follows the score-sorted input so that higher-priority workspaces
	 * come first whenever dependencies allow.
	 *
	 * This guarantees that no workspace appears before any of its dependencies
	 * in the resulting order.
	 *
	 * @param entries - Score-sorted queue entries to reorder
	 * @param workspaceDefs - Workspace definitions with dependency info
	 * @returns Topologically sorted entries
	 */
	private enforceDependencyConstraints(entries: QueueEntry[], workspaceDefs: Workspace[]): QueueEntry[] {
		if (workspaceDefs.length === 0) return entries;

		const entryMap = new Map(entries.map((e) => [e.workspaceId, e]));
		const queueIds = new Set(entries.map((e) => e.workspaceId));

		// Build in-degree map counting only dependencies that are also in the queue
		const inDegree = new Map<string, number>();
		const dependents = new Map<string, string[]>();

		for (const entry of entries) {
			inDegree.set(entry.workspaceId, 0);
			dependents.set(entry.workspaceId, []);
		}

		for (const ws of workspaceDefs) {
			if (!queueIds.has(ws.id)) continue;
			let depCount = 0;
			for (const dep of ws.dependencies) {
				if (queueIds.has(dep)) {
					depCount++;
					dependents.get(dep)?.push(ws.id);
				}
			}
			inDegree.set(ws.id, depCount);
		}

		// Score-based index for tiebreaking (lower index = higher priority)
		const scoreIndex = new Map(entries.map((e, i) => [e.workspaceId, i]));

		// Collect initially ready nodes (no dependencies)
		const ready: string[] = [];
		for (const entry of entries) {
			if ((inDegree.get(entry.workspaceId) ?? 0) === 0) {
				ready.push(entry.workspaceId);
			}
		}

		// Sort ready by score-derived order
		ready.sort((a, b) => (scoreIndex.get(a) ?? 0) - (scoreIndex.get(b) ?? 0));

		const result: QueueEntry[] = [];
		while (ready.length > 0) {
			const wsId = ready.shift()!;
			result.push(entryMap.get(wsId)!);

			for (const depId of dependents.get(wsId) ?? []) {
				const currentInDegree = inDegree.get(depId) ?? 1;
				const newInDegree = currentInDegree - 1;
				inDegree.set(depId, newInDegree);
				if (newInDegree === 0) {
					// Insert in score-order position to preserve priority
					const insertIdx = this.findInsertIndex(ready, depId, scoreIndex);
					ready.splice(insertIdx, 0, depId);
				}
			}
		}

		// Append any entries that were not reached (should not happen with consistent defs)
		const processed = new Set(result.map((e) => e.workspaceId));
		for (const entry of entries) {
			if (!processed.has(entry.workspaceId)) {
				result.push(entry);
			}
		}

		return result;
	}

	/**
	 * Find the insertion index to maintain score-order in the ready array.
	 */
	private findInsertIndex(sortedArray: string[], item: string, scoreIndex: Map<string, number>): number {
		const itemIndex = scoreIndex.get(item) ?? Infinity;
		let low = 0;
		let high = sortedArray.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			const midItem = sortedArray[mid]!;
			const midIndex = scoreIndex.get(midItem) ?? Infinity;
			if (midIndex < itemIndex) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		return low;
	}

	/**
	 * Check whether a proposed reordering is safe (does not violate dependencies).
	 */
	private isReorderSafe(original: QueueEntry[], reordered: QueueEntry[], workspaceDefs: Workspace[]): boolean {
		const queueIds = new Set(original.map((e) => e.workspaceId));

		// Build position map for the reordered queue
		const position = new Map<string, number>();
		for (let i = 0; i < reordered.length; i++) {
			position.set(reordered[i]!.workspaceId, i);
		}

		// Check every dependency constraint
		for (const ws of workspaceDefs) {
			if (!queueIds.has(ws.id)) continue;
			const wsPos = position.get(ws.id);
			if (wsPos === undefined) continue;

			for (const dep of ws.dependencies) {
				if (!queueIds.has(dep)) continue;
				const depPos = position.get(dep);
				if (depPos === undefined) continue;

				// Dependency must come before dependant
				if (depPos > wsPos) {
					return false;
				}
			}
		}

		return true;
	}

	// -----------------------------------------------------------------------
	// Reorder suggestion builder (6.D)
	// -----------------------------------------------------------------------

	/**
	 * Build individual reorder suggestions from the difference between
	 * original and optimized order.
	 */
	private buildReorderSuggestions(
		fullEntries: QueueEntry[],
		_queuedEntries: QueueEntry[],
		optimizedQueued: QueueEntry[],
		scores: PriorityScore[],
		workspaceDefs: Workspace[],
		_overallImpact: ThroughputImpact,
	): ReorderSuggestion[] {
		const suggestions: ReorderSuggestion[] = [];

		// Build a map of workspaceId -> original full-array index
		const originalFullIndex = new Map<string, number>();
		for (let i = 0; i < fullEntries.length; i++) {
			originalFullIndex.set(fullEntries[i]!.workspaceId, i);
		}

		// Build a lookup of workspaceId -> new full-array index
		const newFullIndex = new Map<string, number>();
		let queuedIdx = 0;
		for (let i = 0; i < fullEntries.length; i++) {
			if (fullEntries[i]!.status === "queued") {
				newFullIndex.set(optimizedQueued[queuedIdx]!.workspaceId, i);
				queuedIdx++;
			} else {
				newFullIndex.set(fullEntries[i]!.workspaceId, i);
			}
		}

		// Score lookup
		const scoreMap = new Map(scores.map((s) => [s.workspaceId, s]));

		// Dependency lookup for throughput descriptions
		const depMap = this.buildDependencyMap(workspaceDefs);

		// Find entries whose position changed
		for (const entry of optimizedQueued) {
			const origIndex = originalFullIndex.get(entry.workspaceId) ?? -1;
			const newIndex = newFullIndex.get(entry.workspaceId) ?? -1;

			if (origIndex === newIndex || origIndex === -1 || newIndex === -1) continue;

			const score = scoreMap.get(entry.workspaceId);

			// Build reason
			const reasonParts: string[] = [];
			if (score) {
				if (score.criticalPathRank > 0) {
					reasonParts.push(`on critical path (rank ${score.criticalPathRank})`);
				}
				if (score.unlockImpact > 0) {
					reasonParts.push(
						`unlocks ${score.unlockImpact} dependent workspace${score.unlockImpact !== 1 ? "s" : ""}`,
					);
				}
			}

			const deps = depMap.get(entry.workspaceId) ?? new Set();
			if (deps.size > 0) {
				const depList = Array.from(deps).join(", ");
				reasonParts.push(`depends on: ${depList}`);
			}

			const reason =
				reasonParts.length > 0
					? `Move earlier in queue — ${reasonParts.join("; ")}`
					: "Move to optimal position in queue";

			// Build per-move throughput impact
			const direction = newIndex < origIndex ? "earlier" : "later";
			const throughputImpact = this.buildMoveThroughputImpact(
				entry.workspaceId,
				origIndex,
				newIndex,
				direction,
				score,
				depMap,
			);

			suggestions.push({
				workspaceId: entry.workspaceId,
				currentIndex: origIndex,
				suggestedIndex: newIndex,
				reason,
				throughputImpact,
			});
		}

		// Sort by absolute distance moved (largest moves first)
		suggestions.sort(
			(a, b) => Math.abs(b.suggestedIndex - b.currentIndex) - Math.abs(a.suggestedIndex - a.currentIndex),
		);

		return suggestions;
	}

	/**
	 * Build a per-move throughput impact explanation.
	 */
	private buildMoveThroughputImpact(
		_workspaceId: string,
		origIndex: number,
		newIndex: number,
		direction: string,
		score?: PriorityScore,
		_depMap?: Map<string, Set<string>>,
	): string {
		const parts: string[] = [];
		const positionsMoved = Math.abs(origIndex - newIndex);

		if (direction === "earlier") {
			parts.push(`Moves ${positionsMoved} position${positionsMoved !== 1 ? "s" : ""} earlier`);
			if (score && score.unlockImpact > 0) {
				parts.push(
					`unblocking ${score.unlockImpact} downstream workspace${score.unlockImpact !== 1 ? "s" : ""} sooner`,
				);
			}
			if (score && score.criticalPathRank > 0) {
				parts.push(`reducing critical path wait`);
			}
		} else {
			parts.push(`Moves ${positionsMoved} position${positionsMoved !== 1 ? "s" : ""} later`);
		}

		// Estimate time saved: each position is roughly one merge cycle
		const estimatedMsPerPosition = 30_000; // ~30s per merge cycle estimate
		if (direction === "earlier") {
			const savedMs = positionsMoved * estimatedMsPerPosition;
			parts.push(`saving approximately ${this.formatDuration(savedMs)}`);
		}

		return parts.join("; ");
	}

	/**
	 * Build a dependency map for the workspace definitions within the queue.
	 */
	private buildDependencyMap(workspaceDefs: Workspace[]): Map<string, Set<string>> {
		const depMap = new Map<string, Set<string>>();
		for (const ws of workspaceDefs) {
			const deps = new Set(ws.dependencies);
			depMap.set(ws.id, deps);
		}
		return depMap;
	}

	// -----------------------------------------------------------------------
	// Throughput impact (6.D)
	// -----------------------------------------------------------------------

	/**
	 * Compute throughput impact metrics for a reordering.
	 *
	 * Estimates the wall-clock time saved, number of workspaces unblocked
	 * sooner, and critical path reduction.
	 */
	private computeThroughputImpact(
		originalQueued: QueueEntry[],
		optimizedQueued: QueueEntry[],
		scores: PriorityScore[],
		workspaceDefs: Workspace[],
	): ThroughputImpact {
		if (originalQueued.length === 0 || optimizedQueued.length === 0) {
			return {
				estimatedTimeSavedMs: 0,
				workspacesUnblockedSooner: 0,
				criticalPathReduction: 0,
				explanation: "No queued entries to evaluate.",
			};
		}

		// Build position maps
		const origPos = new Map(originalQueued.map((e, i) => [e.workspaceId, i]));
		const optPos = new Map(optimizedQueued.map((e, i) => [e.workspaceId, i]));

		const queueIds = new Set(originalQueued.map((e) => e.workspaceId));

		// Score lookup
		const scoreMap = new Map(scores.map((s) => [s.workspaceId, s]));

		// --- Critical path reduction ---
		// Build graph for the queue entries only
		const graph = buildGraph(workspaceDefs.filter((ws) => queueIds.has(ws.id)));
		const criticalPathRanks = computeCriticalPathRanks(graph);

		// Calculate the "effective critical path wait" for the original vs optimized order
		let origCriticalWait = 0;
		let optCriticalWait = 0;
		for (const ws of workspaceDefs) {
			if (!queueIds.has(ws.id)) continue;
			const rank = criticalPathRanks.get(ws.id) ?? 0;
			const origIdx = origPos.get(ws.id) ?? 0;
			const optIdx = optPos.get(ws.id) ?? 0;
			// A workspace on the critical path should be early in the queue
			origCriticalWait += rank * origIdx;
			optCriticalWait += rank * optIdx;
		}

		const criticalPathReduction = Math.max(
			0,
			Math.round((origCriticalWait - optCriticalWait) / Math.max(1, workspaceDefs.length)),
		);

		// --- Workspaces unblocked sooner ---
		let workspacesUnblockedSooner = 0;
		const unlockImpacts = computeUnlockImpact(graph);
		for (const ws of workspaceDefs) {
			if (!queueIds.has(ws.id)) continue;
			const origIdx = origPos.get(ws.id) ?? 0;
			const optIdx = optPos.get(ws.id) ?? 0;
			const unlockImpact = unlockImpacts.get(ws.id) ?? 0;

			if (optIdx < origIdx && unlockImpact > 0) {
				// This workspace moved up, unblocking its dependents sooner
				workspacesUnblockedSooner += unlockImpact;
			}
		}

		// --- Estimated time saved ---
		// Each queue position jump saves approximately 30s (average merge+validate cycle)
		const estimatedMsPerPosition = 30_000;
		let totalPositionImprovement = 0;
		for (const ws of workspaceDefs) {
			if (!queueIds.has(ws.id)) continue;
			const origIdx = origPos.get(ws.id) ?? 0;
			const optIdx = optPos.get(ws.id) ?? 0;
			const _score = scoreMap.get(ws.id);
			const unlockImpact = unlockImpacts.get(ws.id) ?? 0;

			// Weight the position improvement by unlock impact
			const weight = 1 + unlockImpact * 0.5;
			totalPositionImprovement += (origIdx - optIdx) * weight;
		}

		const estimatedTimeSavedMs = Math.max(0, Math.round(totalPositionImprovement * estimatedMsPerPosition));

		// --- Human-readable explanation ---
		const explanation = this.buildThroughputExplanation(
			estimatedTimeSavedMs,
			workspacesUnblockedSooner,
			criticalPathReduction,
			originalQueued,
			optimizedQueued,
			scores,
			workspaceDefs,
		);

		return {
			estimatedTimeSavedMs,
			workspacesUnblockedSooner,
			criticalPathReduction,
			explanation,
		};
	}

	/**
	 * Build a human-readable throughput impact explanation.
	 */
	private buildThroughputExplanation(
		estimatedTimeSavedMs: number,
		workspacesUnblockedSooner: number,
		criticalPathReduction: number,
		originalQueued: QueueEntry[],
		optimizedQueued: QueueEntry[],
		scores: PriorityScore[],
		_workspaceDefs: Workspace[],
	): string {
		const paragraphs: string[] = [];

		// Summary
		if (estimatedTimeSavedMs > 0) {
			paragraphs.push(
				`Estimated throughput improvement: ${this.formatDuration(estimatedTimeSavedMs)} saved by reordering ${optimizedQueued.length} queued workspace${optimizedQueued.length !== 1 ? "s" : ""}.`,
			);
		}

		if (workspacesUnblockedSooner > 0) {
			paragraphs.push(
				`${workspacesUnblockedSooner} downstream workspace${workspacesUnblockedSooner !== 1 ? "s" : ""} will be unblocked sooner when upstream workspaces merge first.`,
			);
		}

		if (criticalPathReduction > 0) {
			paragraphs.push(
				`Critical path reduced by ${criticalPathReduction} step${criticalPathReduction !== 1 ? "s" : ""}, meaning the longest dependency chain completes faster.`,
			);
		}

		// Per-workspace highlights
		const scoreMap = new Map(scores.map((s) => [s.workspaceId, s]));

		// Find the highest-priority workspace that moved up
		const notableMoves: string[] = [];
		const origPos = new Map(originalQueued.map((e, i) => [e.workspaceId, i]));
		const optPos = new Map(optimizedQueued.map((e, i) => [e.workspaceId, i]));

		for (const entry of optimizedQueued) {
			const origIdx = origPos.get(entry.workspaceId) ?? 0;
			const optIdx = optPos.get(entry.workspaceId) ?? 0;
			const diff = origIdx - optIdx;
			const score = scoreMap.get(entry.workspaceId);

			if (diff > 0) {
				const parts = [`"${entry.workspaceId}" moved up ${diff} position${diff !== 1 ? "s" : ""}`];
				if (score && score.unlockImpact > 0) {
					parts.push(`(unlocks ${score.unlockImpact} downstream workspace${score.unlockImpact !== 1 ? "s" : ""})`);
				}
				notableMoves.push(parts.join(" "));
			}
		}

		if (notableMoves.length > 0) {
			paragraphs.push(`Key moves: ${notableMoves.join("; ")}.`);
		}

		// Dependency safety note
		paragraphs.push("Reorder respects all dependency constraints — no workspace is placed before its dependencies.");

		return paragraphs.join("\n");
	}

	/**
	 * Format a duration in ms to a human-readable string.
	 */
	private formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		const minutes = Math.floor(ms / 60_000);
		const seconds = Math.round((ms % 60_000) / 1000);
		return `${minutes}m ${seconds}s`;
	}

	// -----------------------------------------------------------------------
	// Sorting helpers
	// -----------------------------------------------------------------------

	/**
	 * Sort queued entries by priority score descending with stable tiebreaking.
	 */
	private sortByScore(entries: QueueEntry[], scores: PriorityScore[]): QueueEntry[] {
		const scoreMap = new Map(scores.map((s) => [s.workspaceId, s]));

		return [...entries].sort((a, b) => {
			const scoreA = scoreMap.get(a.workspaceId);
			const scoreB = scoreMap.get(b.workspaceId);

			const totalA = scoreA?.totalScore ?? 0;
			const totalB = scoreB?.totalScore ?? 0;

			if (totalB !== totalA) {
				return totalB - totalA;
			}

			if (this.policy.stableSort) {
				return entries.indexOf(a) - entries.indexOf(b);
			}

			return a.workspaceId.localeCompare(b.workspaceId);
		});
	}

	/**
	 * Build Workspace objects from queue entries for scoring.
	 *
	 * Uses available metadata from queue entry fields to create
	 * minimal Workspace objects for heuristic scoring.
	 *
	 * @param entries - Queue entries to convert
	 * @returns Workspace definitions for scoring
	 */
	private buildWorkspacesFromEntries(entries: QueueEntry[]): Workspace[] {
		return entries.map((entry) => {
			const validationCommandLength = entry.validationCommand?.length ?? 0;
			const riskLevel = validationCommandLength > 0 ? ("medium" as const) : ("low" as const);

			return {
				id: entry.workspaceId,
				title: `Workspace ${entry.workspaceId}`,
				dependencies: [],
				roleBudget: "worker" as const,
				maxRetries: 3,
				riskLevel,
				acceptanceCriteria: entry.validationCommand ? [`Validate: ${entry.validationCommand}`] : undefined,
			};
		});
	}
}

/**
 * Convenience function: score and sort an array of Workspace definitions
 * by priority. Returns workspace IDs in optimal merge order.
 *
 * @param workspaces - Workspace definitions
 * @param config - Optional scoring config
 * @returns Workspace IDs sorted by priority (highest first)
 */
export function prioritizeWorkspaces(
	workspaces: Workspace[],
	config?: Partial<import("./queue-priority.js").ScoringConfig>,
): string[] {
	const scores = scoreWorkspaces(workspaces, config);
	return scores.map((s) => s.workspaceId);
}

/**
 * Check whether a given ordering respects workspace dependency constraints.
 *
 * Returns an array of dependency violations, or an empty array if the
 * ordering is valid.
 *
 * @param orderedIds - Workspace IDs in the proposed order
 * @param workspaceDefs - Workspace definitions with dependency info
 * @returns Dependency violations found
 */
export function checkDependencySafety(
	orderedIds: string[],
	workspaceDefs: Workspace[],
): Array<{ workspaceId: string; dependency: string; message: string }> {
	const violations: Array<{ workspaceId: string; dependency: string; message: string }> = [];
	const position = new Map(orderedIds.map((id, i) => [id, i]));

	for (const ws of workspaceDefs) {
		const wsPos = position.get(ws.id);
		if (wsPos === undefined) continue;

		for (const dep of ws.dependencies) {
			const depPos = position.get(dep);
			if (depPos === undefined) continue;

			if (depPos > wsPos) {
				violations.push({
					workspaceId: ws.id,
					dependency: dep,
					message: `Workspace "${ws.id}" depends on "${dep}" but "${dep}" appears after it in the queue (position ${depPos} vs ${wsPos})`,
				});
			}
		}
	}

	return violations;
}

/**
 * Format throughput impact for display.
 *
 * @param impact - Throughput impact metrics
 * @returns Human-readable string
 */
export function formatThroughputImpact(impact: ThroughputImpact): string {
	return impact.explanation;
}
