/**
 * P45.S5 — Async Readiness Classifier
 *
 * Classifies whether a set of namespaces is ready for async parallel execution.
 * Consumes the conflict matrix from the SemanticConflictAnalyzer and
 * determines if async parallelism is safe, risky, or dangerous.
 *
 * Output classes:
 * - ready: all namespaces can safely run in parallel
 * - ready_with_caveats: minor conflicts exist but are safe
 * - not_ready: blocking conflicts prevent async execution
 * - requires_sequencing: conflicts require specific ordering
 */

import type { ConflictMatrix, SemanticConflict } from "./semantic-conflict-analyzer.js";

// =============================================================================
// Types
// =============================================================================

export type ReadinessClass = "ready" | "ready_with_caveats" | "not_ready" | "requires_sequencing";

export interface NamespaceReadiness {
	namespace: string;
	/** Whether this namespace is ready for async execution. */
	ready: boolean;
	/** Conflicts this namespace has with others. */
	conflicts: SemanticConflict[];
	/** Number of unresolved conflicts. */
	unresolvedConflicts: number;
}

export interface AsyncReadinessResult {
	/** Overall readiness class. */
	class: ReadinessClass;
	/** Whether async parallel execution is allowed. */
	asyncAllowed: boolean;
	/** Per-namespace readiness details. */
	namespaces: NamespaceReadiness[];
	/** Blocking reasons if async is not allowed. */
	blockingReasons: string[];
	/** Namespaces that must be sequentialized. */
	mustBeSequential: string[][];
	/** Namespaces that can run in parallel. */
	canBeParallel: string[];
	/** Overall risk score from the conflict matrix. */
	riskScore: number;
	/** Suggested max parallel workers. */
	suggestedMaxWorkers: number;
}

export interface ReadinessThresholds {
	/** Maximum risk score for "ready" classification (default: 0.2). */
	maxReadyRiskScore: number;
	/** Maximum risk score for "ready_with_caveats" (default: 0.5). Above this = not_ready. */
	maxCaveatsRiskScore: number;
	/** Minimum number of namespaces needed for async to be meaningful (default: 2). */
	minNamespacesForAsync: number;
}

// =============================================================================
// Default Thresholds
// =============================================================================

export const DEFAULT_READINESS_THRESHOLDS: ReadinessThresholds = {
	maxReadyRiskScore: 0.2,
	maxCaveatsRiskScore: 0.5,
	minNamespacesForAsync: 2,
};

// =============================================================================
// Classifier
// =============================================================================

/**
 * Classify async readiness across a set of namespaces.
 */
export function classifyAsyncReadiness(
	namespaceList: string[],
	matrix: ConflictMatrix,
	thresholds: ReadinessThresholds = DEFAULT_READINESS_THRESHOLDS,
): AsyncReadinessResult {
	const blockingReasons: string[] = [];
	const mustBeSequential: string[][] = [];
	const canBeParallel: string[] = [];
	const namespaces: NamespaceReadiness[] = [];

	// Build per-namespace readiness
	for (const ns of namespaceList) {
		const nsConflicts = matrix.conflicts.filter(
			(c) => !c.resolved && (c.namespaces[0] === ns || c.namespaces[1] === ns),
		);
		const unresolvedConflicts = nsConflicts.length;
		const hasHighConflict = nsConflicts.some((c) => c.severity === "high");

		namespaces.push({
			namespace: ns,
			ready: !hasHighConflict,
			conflicts: nsConflicts,
			unresolvedConflicts,
		});

		if (hasHighConflict) {
			blockingReasons.push(`Namespace ${ns} has high-severity unresolved conflicts`);
		}
	}

	// Check for blocking conflicts between pairs
	if (matrix.hasBlockingConflicts) {
		blockingReasons.push("High-severity blocking conflicts detected in matrix");
	}

	// Find pairs that must be sequential
	for (let i = 0; i < namespaceList.length; i++) {
		for (let j = i + 1; j < namespaceList.length; j++) {
			const nsA = namespaceList[i];
			const nsB = namespaceList[j];
			const pairConflicts = matrix.conflicts.filter(
				(c) =>
					!c.resolved &&
					((c.namespaces[0] === nsA && c.namespaces[1] === nsB) ||
						(c.namespaces[0] === nsB && c.namespaces[1] === nsA)),
			);
			const hasHigh = pairConflicts.some((c) => c.severity === "high");
			if (hasHigh) {
				mustBeSequential.push([nsA, nsB]);
			}
		}
	}

	// Find namespaces that can be parallel (no high conflicts)
	for (const ns of namespaces) {
		if (ns.ready) {
			canBeParallel.push(ns.namespace);
		}
	}

	// Determine overall class
	let readinessClass: ReadinessClass;
	let asyncAllowed: boolean;
	let suggestedMaxWorkers: number;

	if (namespaceList.length < thresholds.minNamespacesForAsync) {
		readinessClass = "not_ready";
		asyncAllowed = false;
		suggestedMaxWorkers = 1;
		blockingReasons.push(
			`Need at least ${thresholds.minNamespacesForAsync} namespaces for async execution (have ${namespaceList.length})`,
		);
	} else if (matrix.hasBlockingConflicts) {
		readinessClass = "not_ready";
		asyncAllowed = false;
		suggestedMaxWorkers = 1;
	} else if (matrix.asyncRiskScore <= thresholds.maxReadyRiskScore) {
		readinessClass = "ready";
		asyncAllowed = true;
		suggestedMaxWorkers = Math.min(12, namespaceList.length);
	} else if (matrix.asyncRiskScore <= thresholds.maxCaveatsRiskScore) {
		readinessClass = "ready_with_caveats";
		asyncAllowed = true;
		suggestedMaxWorkers = Math.min(6, namespaceList.length);
	} else if (mustBeSequential.length > 0) {
		readinessClass = "requires_sequencing";
		asyncAllowed = false;
		suggestedMaxWorkers = Math.max(1, namespaceList.length - mustBeSequential.length);
		blockingReasons.push("Some namespace pairs require sequential execution due to conflicts");
	} else {
		readinessClass = "not_ready";
		asyncAllowed = false;
		suggestedMaxWorkers = 1;
		blockingReasons.push(
			`Async risk score ${matrix.asyncRiskScore} exceeds threshold ${thresholds.maxCaveatsRiskScore}`,
		);
	}

	return {
		class: readinessClass,
		asyncAllowed,
		namespaces,
		blockingReasons,
		mustBeSequential,
		canBeParallel,
		riskScore: matrix.asyncRiskScore,
		suggestedMaxWorkers,
	};
}
