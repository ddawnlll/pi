/**
 * P45.S4 — Semantic Conflict Analyzer
 *
 * Detects semantic conflicts between namespaces that go beyond file overlap.
 * Even when namespaces own disjoint files, they can semantically conflict through:
 * - type exports consumed by other namespaces
 * - function/class signatures that must remain compatible
 * - shared assumptions about read models or API shapes
 * - implicit dependencies through barrel files
 *
 * The analyzer produces a conflict matrix and scores that feed into
 * the AsyncReadinessClassifier and AdaptiveConcurrencyGovernor.
 */

// =============================================================================
// Types
// =============================================================================

export type ConflictSeverity = "none" | "low" | "medium" | "high";

export type ConflictKind =
	| "type_export_dependency"
	| "function_signature_dependency"
	| "barrel_file_overlap"
	| "read_model_assumption"
	| "api_shape_dependency"
	| "implicit_runtime_dependency";

export interface SemanticConflict {
	/** Unique conflict identifier. */
	id: string;
	/** The two namespaces involved. */
	namespaces: [string, string];
	/** Kind of semantic conflict. */
	kind: ConflictKind;
	/** Severity of the conflict. */
	severity: ConflictSeverity;
	/** The file or export that is the source of the conflict. */
	source: string;
	/** Human-readable description. */
	description: string;
	/** Whether this was detected by static analysis (true) or declared by operator (false). */
	staticDetection: boolean;
	/** Whether this conflict is resolved. */
	resolved: boolean;
}

export interface ConflictMatrix {
	/** Total number of conflict entries. */
	totalConflicts: number;
	/** How many are not yet resolved. */
	unresolvedConflicts: number;
	/** Entries grouped by severity. */
	bySeverity: Record<ConflictSeverity, SemanticConflict[]>;
	/** Entries grouped by kind. */
	byKind: Record<ConflictKind, SemanticConflict[]>;
	/** All conflicts as a flat list. */
	conflicts: SemanticConflict[];
	/** Whether any high-severity unresolved conflicts exist (blocks async). */
	hasBlockingConflicts: boolean;
	/** Risk score for async execution (0=safe, 1=extremely risky). */
	asyncRiskScore: number;
}

// =============================================================================
// Analyzer
// =============================================================================

export class SemanticConflictAnalyzer {
	private conflicts: SemanticConflict[] = [];

	/**
	 * Register a detected or declared semantic conflict.
	 * Duplicate IDs are rejected.
	 */
	register(conflict: SemanticConflict): { success: true } | { success: false; reason: string } {
		if (this.conflicts.some((c) => c.id === conflict.id)) {
			return { success: false, reason: `Duplicate conflict ID: ${conflict.id}` };
		}
		this.conflicts.push({ ...conflict });
		return { success: true };
	}

	/**
	 * Register a batch of conflicts.
	 */
	registerBatch(conflicts: SemanticConflict[]): { accepted: number; rejected: number } {
		let accepted = 0;
		let rejected = 0;
		for (const c of conflicts) {
			const result = this.register(c);
			if (result.success) accepted++;
			else rejected++;
		}
		return { accepted, rejected };
	}

	/**
	 * Mark a conflict as resolved.
	 */
	resolve(id: string): boolean {
		const conflict = this.conflicts.find((c) => c.id === id);
		if (!conflict) return false;
		conflict.resolved = true;
		return true;
	}

	/**
	 * Get all conflicts involving a specific namespace.
	 */
	getConflictsForNamespace(namespace: string): SemanticConflict[] {
		return this.conflicts.filter((c) => c.namespaces[0] === namespace || c.namespaces[1] === namespace);
	}

	/**
	 * Get conflicts between two specific namespaces.
	 */
	getConflictsBetween(ns1: string, ns2: string): SemanticConflict[] {
		return this.conflicts.filter(
			(c) =>
				(c.namespaces[0] === ns1 && c.namespaces[1] === ns2) ||
				(c.namespaces[0] === ns2 && c.namespaces[1] === ns1),
		);
	}

	/**
	 * Build the full conflict matrix.
	 */
	buildMatrix(): ConflictMatrix {
		const bySeverity: Record<ConflictSeverity, SemanticConflict[]> = {
			none: [],
			low: [],
			medium: [],
			high: [],
		};

		const byKind: Record<ConflictKind, SemanticConflict[]> = {
			type_export_dependency: [],
			function_signature_dependency: [],
			barrel_file_overlap: [],
			read_model_assumption: [],
			api_shape_dependency: [],
			implicit_runtime_dependency: [],
		};

		for (const c of this.conflicts) {
			bySeverity[c.severity].push(c);
			byKind[c.kind].push(c);
		}

		const unresolvedConflicts = this.conflicts.filter((c) => !c.resolved);
		const highUnresolved = unresolvedConflicts.filter((c) => c.severity === "high");
		const hasBlockingConflicts = highUnresolved.length > 0;

		const asyncRiskScore = computeAsyncRiskScore(this.conflicts);

		return {
			totalConflicts: this.conflicts.length,
			unresolvedConflicts: unresolvedConflicts.length,
			bySeverity,
			byKind,
			conflicts: [...this.conflicts],
			hasBlockingConflicts,
			asyncRiskScore,
		};
	}

	/**
	 * Clear all conflicts.
	 */
	clear(): void {
		this.conflicts = [];
	}
}

// =============================================================================
// Risk Scoring
// =============================================================================

function computeAsyncRiskScore(conflicts: SemanticConflict[]): number {
	const unresolved = conflicts.filter((c) => !c.resolved);
	if (unresolved.length === 0) return 0;

	let score = 0;

	for (const c of unresolved) {
		switch (c.severity) {
			case "high":
				score += 0.3;
				break;
			case "medium":
				score += 0.15;
				break;
			case "low":
				score += 0.05;
				break;
		}
	}

	// Cap at 1.0
	return round3(Math.min(1.0, score));
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Check if two namespaces can safely run in parallel given the conflict matrix.
 */
export function canRunParallel(matrix: ConflictMatrix, ns1: string, ns2: string): { safe: boolean; reason?: string } {
	const conflicts = matrix.conflicts.filter(
		(c) =>
			!c.resolved &&
			((c.namespaces[0] === ns1 && c.namespaces[1] === ns2) || (c.namespaces[0] === ns2 && c.namespaces[1] === ns1)),
	);

	if (conflicts.length === 0) return { safe: true };

	const highConflicts = conflicts.filter((c) => c.severity === "high");
	if (highConflicts.length > 0) {
		return {
			safe: false,
			reason: `${highConflicts.length} high-severity conflicts between ${ns1} and ${ns2}`,
		};
	}

	const mediumConflicts = conflicts.filter((c) => c.severity === "medium");
	if (mediumConflicts.length >= 3) {
		return {
			safe: false,
			reason: `${mediumConflicts.length} medium-severity conflicts between ${ns1} and ${ns2} (threshold exceeded)`,
		};
	}

	// Low or few medium conflicts: safe with caution
	return { safe: true };
}
