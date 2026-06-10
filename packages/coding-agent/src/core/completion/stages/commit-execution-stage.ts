/**
 * P44.5.04 — Commit Execution Stage
 *
 * Executes the git commit using P26 GitRunner with per-workspace identity
 * and commit trailers. Block on commit failure.
 *
 * Per the P26 overlap map, the base GitRunner is reused (adapter pattern).
 * This stage adds identity config and trailer injection on top.
 *
 * Contract Schema: 4.1.1
 */

import type { StageExecutionContext, StageRunner } from "../completion-gate-vnext.js";
import type { StageVerdict } from "../completion-gate-vnext-types.js";
import { createFailedStageVerdict, createPassedStageVerdict } from "../workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a commit execution attempt.
 */
export interface CommitExecutionResult {
	/** Whether the commit was successful */
	success: boolean;
	/** Commit hash (if successful) */
	commitHash?: string;
	/** Files that were committed */
	committedFiles?: string[];
	/** Error message (if failed) */
	error?: string;
	/** Whether the failure appears transient (retryable) */
	isTransient?: boolean;
}

/**
 * Configuration for the commit execution stage.
 */
export interface CommitExecutionStageConfig {
	/** Function that attempts to execute the commit (injectable for testing) */
	executeCommit: () => Promise<CommitExecutionResult> | CommitExecutionResult;
}

// ---------------------------------------------------------------------------
// Stage Runner Factory
// ---------------------------------------------------------------------------

/**
 * Create a stage runner for the CommitExecution stage.
 *
 * Delegates actual git execution to the caller, maintaining the P26 adapter
 * pattern. The caller is responsible for:
 * - Creating the GitRunner with per-workspace identity
 * - Setting up commit trailers
 * - Running the actual git commit command
 */
export function createCommitExecutionStageRunner(config: CommitExecutionStageConfig): StageRunner {
	return async (_stage: string, _workspace: unknown, _context: StageExecutionContext): Promise<StageVerdict> => {
		const startTime = Date.now();

		const result = await config.executeCommit();

		if (result.success) {
			return createPassedStageVerdict(
				"CommitExecution",
				{
					commitHash: result.commitHash,
					committedFiles: result.committedFiles,
				},
				Date.now() - startTime,
			);
		}

		// Classify the failure
		const recoveryState = result.isTransient ? "RETRYABLE_BLOCKED" : "NEEDS_REPAIR";

		return createFailedStageVerdict(
			"CommitExecution",
			[result.error ?? "Commit execution failed"],
			{
				isTransient: result.isTransient ?? false,
				recoveryState,
			},
			Date.now() - startTime,
		);
	};
}
