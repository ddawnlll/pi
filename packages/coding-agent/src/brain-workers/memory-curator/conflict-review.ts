/**
 * Conflict Review — 25.M
 *
 * Reviews detected conflicts between memory records, evaluates resolution
 * strategies, and produces recommended actions. Used by the
 * MemoryCuratorWorker during the conflict detection and compaction
 * phases.
 *
 * Key design:
 * - Each review evaluates a set of conflicting records.
 * - Resolution strategies are matched to conflict types.
 * - A confidence score determines whether automatic resolution is safe.
 * - Low-confidence conflicts are flagged for manual review.
 * - All reviews produce evidence-backed diagnostics.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { CompactionActionType, CuratorConflict } from "./memory-curator-worker.js";

// ---------------------------------------------------------------------------
// Review Status
// ---------------------------------------------------------------------------

/**
 * Status of a conflict review.
 */
export type ConflictReviewStatus =
	| "pending" // Review created, awaiting analysis
	| "analyzing" // Review is in progress
	| "resolved" // Review completed with a resolution
	| "escalated" // Review escalated for manual intervention
	| "failed"; // Review failed with diagnostic

/**
 * All valid ConflictReviewStatus values for runtime validation.
 */
export const ALL_CONFLICT_REVIEW_STATUSES: readonly ConflictReviewStatus[] = [
	"pending",
	"analyzing",
	"resolved",
	"escalated",
	"failed",
] as const;

// ---------------------------------------------------------------------------
// Resolution Strategy
// ---------------------------------------------------------------------------

/**
 * Resolution strategy for a conflict.
 */
export type ResolutionStrategy =
	| "supersede_older" // Keep newer, archive older
	| "merge_records" // Merge into a single comprehensive record
	| "flag_manual" // Flag for manual review
	| "delete_duplicate" // Delete duplicate records
	| "update_reference"; // Update stale references

/**
 * All valid ResolutionStrategy values for runtime validation.
 */
export const ALL_RESOLUTION_STRATEGIES: readonly ResolutionStrategy[] = [
	"supersede_older",
	"merge_records",
	"flag_manual",
	"delete_duplicate",
	"update_reference",
] as const;

// ---------------------------------------------------------------------------
// Review Result
// ---------------------------------------------------------------------------

/**
 * Result of a single conflict review.
 */
export interface ConflictReviewResult {
	/** Unique identifier (UUID v4) */
	id: string;
	/** The conflict this result resolves */
	conflictId: string;
	/** The selected resolution strategy */
	strategy: ResolutionStrategy;
	/** Confidence in this resolution (0-1) */
	confidence: number;
	/** Human-readable description of the resolution */
	description: string;
	/** Evidence supporting this resolution */
	evidence: string;
	/** Compaction action type to apply */
	actionType: CompactionActionType;
	/** ISO 8601 timestamp */
	resolvedAt: string;
	/** IDs of records affected by this resolution */
	affectedRecordIds: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the ConflictReviewer.
 */
export interface ConflictReviewerConfig {
	/**
	 * Confidence threshold for automatic resolution (0-1).
	 * Conflicts with confidence >= this threshold are auto-resolved.
	 * Default: 0.7
	 */
	autoResolveThreshold: number;

	/**
	 * Whether to attempt automatic resolution of conflicts.
	 * When false, all conflicts are escalated for manual review.
	 * Default: true
	 */
	autoResolve: boolean;

	/**
	 * Whether to prefer merging over supersession for overlap conflicts.
	 * Default: true
	 */
	preferMerge: boolean;
}

/**
 * Default configuration for ConflictReviewer.
 */
export const DEFAULT_CONFLICT_REVIEWER_CONFIG: ConflictReviewerConfig = {
	autoResolveThreshold: 0.7,
	autoResolve: true,
	preferMerge: true,
};

// ---------------------------------------------------------------------------
// Review Statistics
// ---------------------------------------------------------------------------

/**
 * Runtime statistics for the ConflictReviewer.
 */
export interface ConflictReviewerStats {
	/** Total number of reviews performed */
	totalReviews: number;
	/** Number of auto-resolved reviews */
	autoResolved: number;
	/** Number of escalated reviews */
	escalated: number;
	/** Number of failed reviews */
	failed: number;
	/** Count per resolution strategy */
	byStrategy: Record<ResolutionStrategy, number>;
}

// ---------------------------------------------------------------------------
// Conflict Reviewer
// ---------------------------------------------------------------------------

/**
 * Reviews conflicts between memory records and recommends resolution
 * strategies based on conflict type, confidence, and configuration.
 */
export class ConflictReviewer {
	private config: ConflictReviewerConfig;
	private totalReviews: number;
	private autoResolved: number;
	private escalated: number;
	private failed: number;
	private byStrategy: Record<ResolutionStrategy, number>;

	/**
	 * Create a new ConflictReviewer.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<ConflictReviewerConfig>) {
		this.config = {
			autoResolveThreshold: config?.autoResolveThreshold ?? DEFAULT_CONFLICT_REVIEWER_CONFIG.autoResolveThreshold,
			autoResolve: config?.autoResolve ?? DEFAULT_CONFLICT_REVIEWER_CONFIG.autoResolve,
			preferMerge: config?.preferMerge ?? DEFAULT_CONFLICT_REVIEWER_CONFIG.preferMerge,
		};
		this.totalReviews = 0;
		this.autoResolved = 0;
		this.escalated = 0;
		this.failed = 0;
		this.byStrategy = {
			supersede_older: 0,
			merge_records: 0,
			flag_manual: 0,
			delete_duplicate: 0,
			update_reference: 0,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update reviewer configuration.
	 */
	setConfig(config: Partial<ConflictReviewerConfig>): void {
		if (config.autoResolveThreshold !== undefined) this.config.autoResolveThreshold = config.autoResolveThreshold;
		if (config.autoResolve !== undefined) this.config.autoResolve = config.autoResolve;
		if (config.preferMerge !== undefined) this.config.preferMerge = config.preferMerge;
	}

	/**
	 * Get current configuration.
	 */
	getConfig(): ConflictReviewerConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Review
	// -----------------------------------------------------------------------

	/**
	 * Review a single conflict and produce a resolution result.
	 *
	 * Evaluates the conflict type, confidence, and record patterns to
	 * determine the best resolution strategy. If auto-resolve is enabled
	 * and confidence meets the threshold, the result is marked as resolved.
	 * Otherwise, it is escalated for manual review.
	 *
	 * @param conflict - The conflict to review.
	 * @returns A ConflictReviewResult with the recommended resolution.
	 */
	reviewConflict(conflict: CuratorConflict): ConflictReviewResult {
		this.totalReviews++;
		const resolvedAt = new Date().toISOString();
		const affectedRecordIds = [...conflict.recordIds];

		// Determine strategy based on conflict type
		const { strategy, confidence, actionType } = this.determineStrategy(conflict);

		// Track by strategy
		this.byStrategy[strategy]++;

		// Determine if auto-resolve or escalate
		const canAutoResolve = this.config.autoResolve && conflict.confidence >= this.config.autoResolveThreshold;

		let description: string;
		let evidence: string;

		if (canAutoResolve) {
			this.autoResolved++;
			description = this.buildResolutionDescription(strategy, affectedRecordIds, conflict);
			evidence = this.buildResolutionEvidence(strategy, conflict, "Auto-resolved");
		} else {
			this.escalated++;
			description = this.buildEscalationDescription(strategy, affectedRecordIds, conflict);
			evidence = this.buildResolutionEvidence(strategy, conflict, "Escalated for manual review");
		}

		return {
			id: randomUUID(),
			conflictId: conflict.id,
			strategy,
			confidence: Math.min(1, Math.round(confidence * 100) / 100),
			description,
			evidence,
			actionType,
			resolvedAt,
			affectedRecordIds,
		};
	}

	/**
	 * Review multiple conflicts at once.
	 *
	 * @param conflicts - Array of conflicts to review.
	 * @returns Array of resolution results.
	 */
	reviewConflicts(conflicts: CuratorConflict[]): ConflictReviewResult[] {
		return conflicts.map((c) => this.reviewConflict(c));
	}

	/**
	 * Determine the best resolution strategy for a conflict.
	 *
	 * Maps conflict types to strategies based on configuration preferences.
	 */
	private determineStrategy(conflict: CuratorConflict): {
		strategy: ResolutionStrategy;
		confidence: number;
		actionType: CompactionActionType;
	} {
		switch (conflict.type) {
			case "contradiction": {
				// Contradictions need human judgment
				const confidence = conflict.confidence * 0.6; // Downgrade confidence
				return {
					strategy: "flag_manual",
					confidence,
					actionType: "flag_review",
				};
			}

			case "overlap": {
				if (this.config.preferMerge) {
					const confidence = conflict.confidence * 0.85;
					return {
						strategy: "merge_records",
						confidence,
						actionType: "merge",
					};
				}
				const confidence = conflict.confidence * 0.75;
				return {
					strategy: "supersede_older",
					confidence,
					actionType: "supersede",
				};
			}

			case "stale_ref": {
				const confidence = conflict.confidence * 0.8;
				return {
					strategy: "update_reference",
					confidence,
					actionType: "flag_review",
				};
			}

			case "duplicate": {
				const confidence = conflict.confidence * 0.9; // High confidence for duplicates
				return {
					strategy: "delete_duplicate",
					confidence,
					actionType: "delete",
				};
			}

			case "confidence_drop": {
				const confidence = conflict.confidence * 0.5; // Low confidence, needs review
				return {
					strategy: "flag_manual",
					confidence,
					actionType: "flag_review",
				};
			}

			default: {
				return {
					strategy: "flag_manual",
					confidence: 0.3,
					actionType: "flag_review",
				};
			}
		}
	}

	/**
	 * Build a description for a resolved conflict.
	 */
	private buildResolutionDescription(
		strategy: ResolutionStrategy,
		recordIds: string[],
		conflict: CuratorConflict,
	): string {
		switch (strategy) {
			case "supersede_older":
				return `Auto-resolved: ${conflict.type} conflict — superseding older records among [${recordIds.join(", ")}]`;
			case "merge_records":
				return `Auto-resolved: ${conflict.type} conflict — merging records [${recordIds.join(", ")}] into a single record`;
			case "flag_manual":
				return `Escalated: ${conflict.type} conflict — flagging records [${recordIds.join(", ")}] for manual review`;
			case "delete_duplicate":
				return `Auto-resolved: ${conflict.type} conflict — deleting duplicate records [${recordIds.join(", ")}]`;
			case "update_reference":
				return `Auto-resolved: ${conflict.type} conflict — updating stale references in records [${recordIds.join(", ")}]`;
		}
	}

	/**
	 * Build an escalation description for a low-confidence conflict.
	 */
	private buildEscalationDescription(
		strategy: ResolutionStrategy,
		recordIds: string[],
		conflict: CuratorConflict,
	): string {
		return `Manual review required: ${conflict.type} conflict between [${recordIds.join(", ")}] (confidence: ${conflict.confidence} < threshold: ${this.config.autoResolveThreshold}). Suggested strategy: ${strategy}`;
	}

	/**
	 * Build evidence string for a resolution.
	 */
	private buildResolutionEvidence(
		strategy: ResolutionStrategy,
		conflict: CuratorConflict,
		disposition: string,
	): string {
		return [
			`Disposition: ${disposition}`,
			`Conflict type: ${conflict.type}`,
			`Strategy: ${strategy}`,
			`Records: [${conflict.recordIds.join(", ")}]`,
			`Detection confidence: ${conflict.confidence}`,
			`Original description: ${conflict.description}`,
		].join(" | ");
	}

	/**
	 * Check if a conflict result is resolved (not escalated).
	 *
	 * @param result - The review result to check.
	 * @returns true if the conflict was auto-resolved.
	 */
	isResolved(result: ConflictReviewResult): boolean {
		return (
			result.strategy !== "flag_manual" &&
			result.confidence >= this.config.autoResolveThreshold &&
			this.config.autoResolve
		);
	}

	// -----------------------------------------------------------------------
	// Statistics
	// -----------------------------------------------------------------------

	/**
	 * Get runtime statistics.
	 */
	getStats(): ConflictReviewerStats {
		return {
			totalReviews: this.totalReviews,
			autoResolved: this.autoResolved,
			escalated: this.escalated,
			failed: this.failed,
			byStrategy: { ...this.byStrategy },
		};
	}

	/**
	 * Mark a review as failed (for error handling).
	 */
	recordFailure(): void {
		this.failed++;
	}

	/**
	 * Reset all statistics.
	 */
	resetStats(): void {
		this.totalReviews = 0;
		this.autoResolved = 0;
		this.escalated = 0;
		this.failed = 0;
		this.byStrategy = {
			supersede_older: 0,
			merge_records: 0,
			flag_manual: 0,
			delete_duplicate: 0,
			update_reference: 0,
		};
	}

	/**
	 * Clear all state.
	 */
	clear(): void {
		this.resetStats();
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ConflictReviewer with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new ConflictReviewer instance.
 */
export function createConflictReviewer(config?: Partial<ConflictReviewerConfig>): ConflictReviewer {
	return new ConflictReviewer(config);
}
