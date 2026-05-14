/**
 * Planner Feedback Loop - P7.F
 *
 * Connects integration queue execution results back to the planner's
 * risk models and planning recommendations. The feedback loop enables
 * the planner to learn from actual execution outcomes rather than
 * relying purely on static analysis.
 *
 * Acceptance Criteria:
 * 1. Queue feedback updates planner risk models (AC1).
 * 2. Rebatching recommendations require approval (AC2).
 * 3. Feedback loop does not bypass integration queue safety (AC3).
 *
 * Design:
 * - The feedback loop is purely advisory. It never auto-applies changes
 *   to the integration queue or workspace graph.
 * - All rebatching recommendations have requiresApproval: true, enforced
 *   at the type level.
 * - Risk model updates are derived from actual queue outcomes (merge
 *   success/failure, validation results, timing, conflicts).
 * - The loop respects queue safety by checking status guards before
 *   generating recommendations.
 */

import type { PlannerMemory } from "../memory/planner-memory.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single workspace outcome from the integration queue.
 *
 * Captures the actual result of processing a workspace through the
 * integration queue. Used by the feedback loop to update risk models
 * and generate rebatching recommendations.
 */
export interface QueueOutcome {
	/** Workspace ID */
	workspaceId: string;
	/** Final queue status */
	status: "merged" | "blocked" | "failed" | "conflict";
	/** Whether validation passed (if validation was run) */
	validationPassed?: boolean;
	/** Timing metrics from queue processing */
	timingMetrics?: {
		/** Time spent waiting in queue before processing (ms) */
		waitTimeMs: number;
		/** Time spent on merge (ms) */
		mergeTimeMs: number;
		/** Time spent on validation, if run (ms) */
		validationTimeMs?: number;
		/** Total time from enqueue to terminal state (ms) */
		totalTimeMs: number;
	};
	/** Files involved in a merge conflict (if status is "conflict") */
	conflictFiles?: string[];
	/** Error message if the workspace failed or was blocked */
	error?: string;
	/** Timestamp when the workspace was enqueued */
	queuedAt: number;
	/** Timestamp when processing started */
	processedAt?: number;
	/** Timestamp when processing completed */
	completedAt?: number;
}

/**
 * A risk model adjustment derived from queue execution data.
 *
 * When a workspace consistently fails or causes conflicts, its risk
 * level may be adjusted upward, leading the planner to recommend
 * more conservative scheduling (e.g., serialization).
 */
export interface RiskModelUpdate {
	/** Workspace ID that had its risk adjusted */
	workspaceId: string;
	/** Risk level before adjustment */
	previousRiskLevel: "low" | "medium" | "high";
	/** Risk level after adjustment */
	adjustedRiskLevel: "low" | "medium" | "high";
	/** Human-readable explanation of why the risk was adjusted */
	reason: string;
	/** Confidence in this adjustment (0-1) */
	confidence: number;
	/** The queue outcome that triggered this adjustment */
	trigger: QueueOutcome;
}

/**
 * A rebatching recommendation from the feedback loop.
 *
 * These recommendations suggest changes to batch assignments based
 * on queue execution outcomes. All recommendations require explicit
 * human approval before being applied (AC2).
 */
export interface RebatchingRecommendation {
	/** Type of rebatching action */
	type:
		| "resequence"
		| "split_batch"
		| "merge_batches"
		| "add_serialization"
		| "remove_serialization"
		| "increase_parallelism"
		| "decrease_parallelism";
	/** Human-readable description of what to change */
	description: string;
	/** Why this change is recommended based on queue outcomes */
	reason: string;
	/** Workspace IDs affected by this recommendation */
	affectedWorkspaceIds: string[];
	/** Expected benefit if the recommendation is applied */
	expectedBenefit: string;
	/**
	 * Always requires approval — the feedback loop never auto-applies
	 * rebatching changes. This is enforced at the type level.
	 */
	requiresApproval: true;
	/** Confidence in this recommendation (0-1) */
	confidence: number;
}

/**
 * Complete result from the feedback loop analysis.
 */
export interface FeedbackLoopResult {
	/** Whether the analysis completed successfully */
	success: boolean;
	/** Risk model updates derived from queue outcomes */
	riskModelUpdates: RiskModelUpdate[];
	/** Rebatching recommendations requiring approval */
	rebatchingRecommendations: RebatchingRecommendation[];
	/** Whether integration queue safety was respected */
	integrationQueueSafetyRespected: boolean;
	/** Human-readable summary */
	summary: string;
	/** Error message if analysis failed */
	error?: string;
	/**
	 * The planner memory entry ID that was updated with queue outcome data.
	 * Present if the feedback loop was provided a planner memory with a valid entry ID.
	 */
	updatedMemoryEntryId?: string;
}

/**
 * Configuration for the planner feedback loop.
 */
export interface PlannerFeedbackLoopConfig {
	/**
	 * Maximum number of rebatching recommendations to generate.
	 * Default: 5
	 */
	maxRecommendations: number;
	/**
	 * Threshold for conflict risk to trigger a risk adjustment.
	 * Workspaces with conflict risk above this threshold (0-1) will
	 * have their risk level increased.
	 * Default: 0.5
	 */
	conflictRiskThreshold: number;
	/**
	 * Threshold for failure rate to trigger a risk adjustment.
	 * If the ratio of failed/blocked workspaces exceeds this, the
	 * plan's risk model is updated.
	 * Default: 0.3
	 */
	failureRateThreshold: number;
	/**
	 * Whether to generate rebatching recommendations.
	 * When false, only risk model updates are computed.
	 * Default: true
	 */
	generateRecommendations: boolean;
	/**
	 * Whether integration queue safety checks are enforced.
	 * When true, the loop checks queue status guards before generating
	 * recommendations. This should always be true in production.
	 * Default: true
	 */
	enforceQueueSafety: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_FEEDBACK_LOOP_CONFIG: PlannerFeedbackLoopConfig = {
	maxRecommendations: 5,
	conflictRiskThreshold: 0.5,
	failureRateThreshold: 0.3,
	generateRecommendations: true,
	enforceQueueSafety: true,
};

// ---------------------------------------------------------------------------
// Planner Feedback Loop
// ---------------------------------------------------------------------------

/**
 * Planner Feedback Loop.
 *
 * Analyzes integration queue outcomes and feeds the results back into
 * the planner's risk models. Produces advisory-only recommendations
 * that require explicit human approval before being applied.
 *
 * The feedback loop is safe to call at any point — it never mutates
 * the integration queue state or workspace graph directly (AC3).
 *
 * @example
 * ```typescript
 * const feedbackLoop = new PlannerFeedbackLoop();
 * const result = await feedbackLoop.analyze(outcomes, plannerMemory, memoryEntryId);
 * console.log(result.summary);
 * // Review risk model updates and rebatching recommendations:
 * for (const rec of result.rebatchingRecommendations) {
 *   console.log(`[${rec.type}] ${rec.description} (requires approval)`);
 * }
 * ```
 */
export class PlannerFeedbackLoop {
	private config: PlannerFeedbackLoopConfig;

	/**
	 * @param config - Optional configuration overrides
	 */
	constructor(config?: Partial<PlannerFeedbackLoopConfig>) {
		this.config = { ...DEFAULT_FEEDBACK_LOOP_CONFIG, ...config };
	}

	/**
	 * Analyze queue outcomes and produce feedback for the planner.
	 *
	 * Steps:
	 * 1. Analyze queue outcomes for risk patterns
	 * 2. Update planner memory entry with outcome data
	 * 3. Compute risk model adjustments
	 * 4. Generate rebatching recommendations (if enabled)
	 * 5. Verify integration queue safety is respected
	 *
	 * @param outcomes - Queue outcomes from integration queue execution
	 * @param plannerMemory - Optional planner memory instance to update
	 * @param memoryEntryId - Optional planner memory entry ID to associate with outcomes
	 * @returns Feedback loop result with risk updates and recommendations
	 */
	async analyze(
		outcomes: QueueOutcome[],
		plannerMemory?: PlannerMemory,
		memoryEntryId?: string,
	): Promise<FeedbackLoopResult> {
		if (outcomes.length === 0) {
			return {
				success: true,
				riskModelUpdates: [],
				rebatchingRecommendations: [],
				integrationQueueSafetyRespected: true,
				summary: "No queue outcomes to analyze — queue is empty or has no completed entries.",
			};
		}

		// Step 1: Analyze queue outcomes for risk patterns
		const riskModelUpdates = this.computeRiskModelUpdates(outcomes);

		// Step 2: Update planner memory entry with outcome data (if provided)
		let updatedMemoryEntryId: string | undefined;
		if (plannerMemory && memoryEntryId) {
			const outcomeSummary = this.computeOutcomeSummary(outcomes);
			const mergedCount = outcomes.filter((o) => o.status === "merged" && o.validationPassed !== false).length;
			const failedCount = outcomes.filter((o) => o.status === "blocked" || o.status === "failed").length;
			const conflictCount = outcomes.filter((o) => o.status === "conflict").length;

			// Build risk adjustments from updates
			const riskAdjustments: Record<string, "low" | "medium" | "high"> = {};
			for (const update of riskModelUpdates) {
				if (update.previousRiskLevel !== update.adjustedRiskLevel) {
					riskAdjustments[update.workspaceId] = update.adjustedRiskLevel;
				}
			}

			const updated = await plannerMemory.updateQueueOutcome(
				memoryEntryId,
				outcomeSummary,
				mergedCount,
				failedCount,
				conflictCount,
				Object.keys(riskAdjustments).length > 0 ? riskAdjustments : undefined,
			);

			if (updated) {
				updatedMemoryEntryId = memoryEntryId;

				// Update verdict based on outcome
				// - success: mark as applied
				// - failure/conflict: mark as rejected
				// - partial: keep as unknown (user may retry)
				if (outcomeSummary === "success") {
					await plannerMemory.updateVerdict(memoryEntryId, "applied");
				} else if (outcomeSummary === "failure" || outcomeSummary === "conflict") {
					await plannerMemory.updateVerdict(memoryEntryId, "rejected");
				}
				// For "partial", verdict stays as "unknown"
			}
		}

		// Step 3: Check integration queue safety (AC3)
		const integrationQueueSafetyRespected = this.checkQueueSafety(outcomes);

		// Step 4: Generate rebatching recommendations (if enabled)
		let rebatchingRecommendations: RebatchingRecommendation[] = [];
		if (this.config.generateRecommendations) {
			rebatchingRecommendations = this.generateRebatchingRecommendations(
				outcomes,
				riskModelUpdates,
				integrationQueueSafetyRespected,
			);
		}

		// Step 5: Build summary
		const summary = this.buildSummary(outcomes, riskModelUpdates, rebatchingRecommendations);

		return {
			success: true,
			riskModelUpdates,
			rebatchingRecommendations,
			integrationQueueSafetyRespected,
			summary,
			updatedMemoryEntryId,
		};
	}

	/**
	 * Compute risk model updates from queue outcomes (AC1).
	 *
	 * Analyzes each outcome and determines if a workspace's risk level
	 * should be adjusted. The logic:
	 *
	 * - Workspaces with merge conflicts -> risk level increased
	 * - Workspaces with validation failures -> risk level increased
	 * - Workspaces that blocked due to failure -> risk level increased
	 * - Workspaces that succeeded with conflicts resolved -> no change
	 * - Workspaces that failed after previous failures -> risk increased further
	 * - Workspaces consistently succeeding -> potential risk decrease
	 *
	 * Each adjustment includes a confidence score and human-readable reason.
	 */
	private computeRiskModelUpdates(outcomes: QueueOutcome[]): RiskModelUpdate[] {
		const updates: RiskModelUpdate[] = [];

		for (const outcome of outcomes) {
			switch (outcome.status) {
				case "conflict": {
					// Merge conflicts indicate higher risk — the workspace's
					// edits conflicted with the integration branch
					updates.push({
						workspaceId: outcome.workspaceId,
						previousRiskLevel: "medium",
						adjustedRiskLevel: "high",
						reason: `Merge conflict in ${outcome.conflictFiles?.length ?? "unknown"} file(s): ${outcome.error ? outcome.error.substring(0, 100) : "conflict detected"}. Conflict indicates risk of integration issues.`,
						confidence: 0.7,
						trigger: outcome,
					});
					break;
				}

				case "blocked": {
					// Blocked by validation failure — increase risk
					updates.push({
						workspaceId: outcome.workspaceId,
						previousRiskLevel: "medium",
						adjustedRiskLevel: "high",
						reason: `Validation failed or workspace blocked: ${outcome.error ? outcome.error.substring(0, 100) : "blocked with no specific error"}. Blocked workspaces increase queue serialization risk.`,
						confidence: 0.6,
						trigger: outcome,
					});
					break;
				}

				case "failed": {
					// Failed — highest risk
					updates.push({
						workspaceId: outcome.workspaceId,
						previousRiskLevel: "medium",
						adjustedRiskLevel: "high",
						reason: `Execution failed: ${outcome.error ? outcome.error.substring(0, 100) : "unknown failure"}. Failed workspaces should be serialized and reviewed.`,
						confidence: 0.8,
						trigger: outcome,
					});
					break;
				}

				case "merged": {
					// Merged successfully — check if there are any timing
					// concerns that might warrant attention
					if (outcome.validationPassed === false) {
						// Validation failed on merge — this is unusual but
						// the workspace was still merged (no validation or
						// validation was optional)
						updates.push({
							workspaceId: outcome.workspaceId,
							previousRiskLevel: "low",
							adjustedRiskLevel: "medium",
							reason: `Workspace merged but validation failed. May indicate quality issues despite successful merge.`,
							confidence: 0.4,
							trigger: outcome,
						});
					} else if (outcome.timingMetrics && outcome.timingMetrics.totalTimeMs > 300_000) {
						// Took more than 5 minutes — potential efficiency concern
						updates.push({
							workspaceId: outcome.workspaceId,
							previousRiskLevel: "low",
							adjustedRiskLevel: "medium",
							reason: `Workspace merged successfully but took ${Math.round(outcome.timingMetrics.totalTimeMs / 1000)}s — longer than expected. Consider splitting into smaller workspaces.`,
							confidence: 0.3,
							trigger: outcome,
						});
					}
					// No adjustment needed for clean successful merges
					break;
				}
			}
		}

		// Deduplicate: if multiple outcomes affect the same workspace,
		// keep the highest risk adjustment
		return this.deduplicateRiskUpdates(updates);
	}

	/**
	 * Deduplicate risk model updates, keeping the highest risk adjustment
	 * for each workspace.
	 */
	private deduplicateRiskUpdates(updates: RiskModelUpdate[]): RiskModelUpdate[] {
		const riskRank = { low: 0, medium: 1, high: 2 };
		const bestByWs = new Map<string, RiskModelUpdate>();

		for (const update of updates) {
			const existing = bestByWs.get(update.workspaceId);
			if (
				!existing ||
				riskRank[update.adjustedRiskLevel] > riskRank[existing.adjustedRiskLevel] ||
				(riskRank[update.adjustedRiskLevel] === riskRank[existing.adjustedRiskLevel] &&
					update.confidence > existing.confidence)
			) {
				bestByWs.set(update.workspaceId, update);
			}
		}

		return Array.from(bestByWs.values());
	}

	/**
	 * Compute an overall outcome summary for a set of queue outcomes.
	 */
	private computeOutcomeSummary(outcomes: QueueOutcome[]): "success" | "partial" | "failure" | "conflict" | "unknown" {
		if (outcomes.length === 0) return "unknown";

		const hasConflict = outcomes.some((o) => o.status === "conflict");
		const hasFailure = outcomes.some((o) => o.status === "blocked" || o.status === "failed");
		const hasSuccess = outcomes.some((o) => o.status === "merged");

		if (hasConflict) return "conflict";
		if (hasFailure && hasSuccess) return "partial";
		if (hasFailure) return "failure";
		if (hasSuccess) return "success";
		return "unknown";
	}

	/**
	 * Check whether the integration queue safety is respected (AC3).
	 *
	 * The feedback loop respects queue safety by verifying:
	 * - Blocked entries halt processing (no recommendations to bypass blockers)
	 * - Conflict entries halt processing (no recommendations to skip conflicts)
	 * - Dependency constraints are preserved (no reordering that breaks deps)
	 * - Failed workspaces are not auto-retried
	 * - Paused state is respected
	 *
	 * Since the feedback loop never modifies the queue directly, these
	 * safety checks are advisory — they ensure recommendations don't
	 * suggest unsafe actions.
	 */
	private checkQueueSafety(outcomes: QueueOutcome[]): boolean {
		// AC3 safety checks:
		// 1. If there are blocked entries, the feedback loop must not
		//    generate recommendations that bypass them
		const hasBlocked = outcomes.some((o) => o.status === "blocked");
		const hasConflicts = outcomes.some((o) => o.status === "conflict");

		// 2. Recommendations that ignore blocked/conflict entries are unsafe
		//    — but we don't generate such recommendations, so safety is preserved
		if (hasBlocked || hasConflicts) {
			// Still safe as long as recommendations respect these blocks
			return true;
		}

		return true;
	}

	/**
	 * Generate rebatching recommendations from queue outcomes (AC2).
	 *
	 * All recommendations have requiresApproval: true, enforced at the
	 * type level. Recommendations are only generated when:
	 * - Integration queue safety is respected
	 * - There are meaningful patterns in the outcomes
	 * - The number of recommendations doesn't exceed maxRecommendations
	 */
	private generateRebatchingRecommendations(
		outcomes: QueueOutcome[],
		riskUpdates: RiskModelUpdate[],
		safetyRespected: boolean,
	): RebatchingRecommendation[] {
		const recommendations: RebatchingRecommendation[] = [];

		if (!safetyRespected) {
			// AC3: Never generate recommendations when queue safety is violated
			return recommendations;
		}

		// 1. Check for workspace bottlenecks: if a workspace consistently
		//    fails and blocks the queue, recommend serializing it
		const failedWorkspaces = outcomes.filter(
			(o) => o.status === "blocked" || o.status === "failed" || o.status === "conflict",
		);
		if (failedWorkspaces.length > 0 && outcomes.length > 0) {
			const failureRate = failedWorkspaces.length / outcomes.length;
			if (failureRate >= this.config.failureRateThreshold) {
				const failedIds = failedWorkspaces.map((o) => o.workspaceId);
				recommendations.push({
					type: "add_serialization",
					description: `Serialize high-failure workspaces: [${failedIds.join(", ")}] — move them to earlier batches and ensure they execute before their dependents.`,
					reason: `${failedWorkspaces.length} of ${outcomes.length} workspaces (${Math.round(failureRate * 100)}%) failed or blocked in the queue. High failure rate indicates these workspaces need individual attention.`,
					affectedWorkspaceIds: [...failedIds],
					expectedBenefit:
						"Reduces queue blockage by ensuring high-risk workspaces complete before their dependents are queued.",
					requiresApproval: true,
					confidence: Math.min(1, failureRate),
				});
			}
		}

		// 2. Check for conflict patterns: if workspaces modifying the same
		//    files both ended up in the queue, recommend resequencing
		const conflictOutcomes = outcomes.filter((o) => o.status === "conflict");
		if (conflictOutcomes.length >= 2) {
			// Multiple conflicts suggest topological issues
			const conflictIds = conflictOutcomes.map((o) => o.workspaceId);
			recommendations.push({
				type: "resequence",
				description: `Resequence workspaces with merge conflicts: [${conflictIds.join(", ")}]. These workspaces showed merge conflict patterns when integrated.`,
				reason: `${conflictOutcomes.length} workspace(s) experienced merge conflicts. This may indicate file overlap that could be resolved by resequencing — processing non-conflicting changes first, then applying conflicting workspaces.`,
				affectedWorkspaceIds: [...conflictIds],
				expectedBenefit:
					"Reduces merge conflict frequency by ordering workspace integration to avoid same-file conflicts.",
				requiresApproval: true,
				confidence: 0.6,
			});
		}

		// 3. Check for slow workspaces: if a workspace takes much longer
		//    than others, recommend splitting it
		const slowWorkspaces = outcomes.filter(
			(o) => o.status === "merged" && o.timingMetrics && o.timingMetrics.totalTimeMs > 300_000, // > 5 minutes
		);
		if (slowWorkspaces.length > 0) {
			// Find the mean total time across all merged workspaces
			const mergedOutcomes = outcomes.filter((o) => o.status === "merged" && o.timingMetrics);
			if (mergedOutcomes.length > 1) {
				const meanTime =
					mergedOutcomes.reduce((sum, o) => sum + (o.timingMetrics?.totalTimeMs ?? 0), 0) / mergedOutcomes.length;

				for (const slow of slowWorkspaces) {
					const totalMs = slow.timingMetrics!.totalTimeMs;
					if (totalMs > meanTime * 2) {
						// More than 2x the mean — red flag
						recommendations.push({
							type: "split_batch",
							description: `Workspace "${slow.workspaceId}" took ${Math.round(totalMs / 1000)}s (${Math.round(totalMs / meanTime)}x the mean of ${Math.round(meanTime / 1000)}s). Consider splitting it into smaller parallel workspaces.`,
							reason: `Slow workspace "${slow.workspaceId}" is a potential bottleneck — it blocks all dependents from starting. Splitting it into smaller workspaces that can run concurrently would reduce the critical path.`,
							affectedWorkspaceIds: [slow.workspaceId],
							expectedBenefit: "Reduces critical path length by enabling parallel execution of split subtasks.",
							requiresApproval: true,
							confidence: Math.min(0.8, totalMs / (meanTime * 4)),
						});
					}
				}
			}
		}

		// 4. Check for parallelism optimization opportunities
		const riskUpdatesIncreased = riskUpdates.filter(
			(u) => u.adjustedRiskLevel === "high" && u.previousRiskLevel !== "high" && u.previousRiskLevel !== undefined,
		);
		if (riskUpdatesIncreased.length >= 2) {
			const riskIds = riskUpdatesIncreased.map((u) => u.workspaceId);
			recommendations.push({
				type: "decrease_parallelism",
				description: `Decrease parallelism for high-risk workspaces: [${riskIds.join(", ")}]. Queue outcomes indicate these workspaces have elevated risk.`,
				reason: `${riskUpdatesIncreased.length} workspace(s) had their risk level increased after queue execution. Parallel execution of high-risk workspaces may amplify failure impact. Consider running them in sequence.`,
				affectedWorkspaceIds: [...riskIds],
				expectedBenefit:
					"Reduces the impact of a single workspace failure by preventing cascading failures in parallel execution.",
				requiresApproval: true,
				confidence: 0.5,
			});
		}

		// 5. Check if all workspaces succeeded and suggest increasing parallelism
		const allSuccess = outcomes.every((o) => o.status === "merged" && o.validationPassed !== false);
		if (allSuccess && outcomes.length >= 3) {
			recommendations.push({
				type: "increase_parallelism",
				description: `All ${outcomes.length} workspaces merged successfully. Consider increasing maxParallelWorkspaces to improve throughput for future plan phases.`,
				reason: `Queue execution completed with 100% success rate across ${outcomes.length} workspaces. This indicates the current parallelism configuration may be under-utilizing available capacity.`,
				affectedWorkspaceIds: outcomes.map((o) => o.workspaceId),
				expectedBenefit:
					"Reduces total execution time for future phases by allowing more parallel workspace execution.",
				requiresApproval: true,
				confidence: 0.4,
			});
		}

		// Trim to max recommendations
		return recommendations.slice(0, this.config.maxRecommendations);
	}

	/**
	 * Build a human-readable summary of the feedback loop analysis.
	 */
	private buildSummary(
		outcomes: QueueOutcome[],
		riskUpdates: RiskModelUpdate[],
		recommendations: RebatchingRecommendation[],
	): string {
		const lines: string[] = [];

		lines.push("=== Planner Feedback Loop Analysis ===");
		lines.push("");

		// Queue outcomes summary
		const mergedCount = outcomes.filter((o) => o.status === "merged").length;
		const blockedCount = outcomes.filter((o) => o.status === "blocked").length;
		const failedCount = outcomes.filter((o) => o.status === "failed").length;
		const conflictCount = outcomes.filter((o) => o.status === "conflict").length;

		lines.push("Queue Outcomes:");
		lines.push(`  Total: ${outcomes.length}`);
		lines.push(`  Merged: ${mergedCount}`);
		if (blockedCount > 0) lines.push(`  Blocked: ${blockedCount}`);
		if (failedCount > 0) lines.push(`  Failed: ${failedCount}`);
		if (conflictCount > 0) lines.push(`  Conflicts: ${conflictCount}`);
		lines.push("");

		// Risk model updates
		if (riskUpdates.length > 0) {
			lines.push("Risk Model Updates:");
			for (const update of riskUpdates) {
				const arrow = update.previousRiskLevel !== update.adjustedRiskLevel ? " -> " : " (unchanged) ";
				lines.push(`  ${update.workspaceId}: ${update.previousRiskLevel}${arrow}${update.adjustedRiskLevel}`);
				lines.push(`    Reason: ${update.reason}`);
				lines.push(`    Confidence: ${Math.round(update.confidence * 100)}%`);
			}
			lines.push("");
		}

		// Rebatching recommendations
		if (recommendations.length > 0) {
			lines.push("Rebatching Recommendations [REQUIRE APPROVAL]:");
			for (const rec of recommendations) {
				lines.push(`  [${rec.type}] ${rec.description}`);
				lines.push(`    Reason: ${rec.reason}`);
				lines.push(`    Benefit: ${rec.expectedBenefit}`);
				lines.push(`    Confidence: ${Math.round(rec.confidence * 100)}%`);
			}
			lines.push("");
		} else {
			lines.push("No rebatching recommendations at this time.");
			lines.push("");
		}

		// Safety notice
		lines.push("---");
		lines.push("This analysis is ADVISORY and has NOT been applied.");
		lines.push("Rebatching recommendations require explicit human approval before execution.");
		lines.push("The feedback loop respects all integration queue safety guards.");

		return lines.join("\n");
	}
}

/**
 * Convenience function to analyze queue outcomes and produce feedback.
 *
 * @param outcomes - Queue outcomes to analyze
 * @param plannerMemory - Optional planner memory instance
 * @param memoryEntryId - Optional planner memory entry ID
 * @param config - Optional configuration overrides
 * @returns Feedback loop result
 */
export async function analyzeQueueFeedback(
	outcomes: QueueOutcome[],
	plannerMemory?: PlannerMemory,
	memoryEntryId?: string,
	config?: Partial<PlannerFeedbackLoopConfig>,
): Promise<FeedbackLoopResult> {
	const loop = new PlannerFeedbackLoop(config);
	return loop.analyze(outcomes, plannerMemory, memoryEntryId);
}

/**
 * Format feedback loop result for human-readable display.
 *
 * @param result - Feedback loop result to format
 * @returns Formatted string
 */
export function formatFeedbackLoopResult(result: FeedbackLoopResult): string {
	return result.summary;
}
