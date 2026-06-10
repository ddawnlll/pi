/**
 * P44.5.04 — Commit Candidate Stage
 *
 * Prepares the set of files that should be committed. Inspects git state
 * and computes the candidate set from staged files, unstaged files, and
 * writeSet membership.
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
 * Information about files available for commit.
 */
export interface CommitCandidateInfo {
	/** Files staged in git index */
	stagedFiles: string[];
	/** Files modified but unstaged */
	unstagedFiles: string[];
	/** Files in the writeSet that have changes */
	writeSetFiles: string[];
}

/**
 * Configuration for the commit candidate stage.
 */
export interface CommitCandidateStageConfig {
	/** Workspace write set globs */
	writeSet: string[];
	/** Whether to require staged files before allowing commit */
	requireStagedFiles?: boolean;
	/** Function to get candidate info (injectable for testing) */
	getCandidateInfo?: () => CommitCandidateInfo;
}

// ---------------------------------------------------------------------------
// Stage Runner Factory
// ---------------------------------------------------------------------------

/**
 * Create a stage runner for the CommitCandidate stage.
 */
export function createCommitCandidateStageRunner(config: CommitCandidateStageConfig): StageRunner {
	return (_stage: string, _workspace: unknown, _context: StageExecutionContext): StageVerdict => {
		const startTime = Date.now();
		const requireStaged = config.requireStagedFiles ?? false;

		const info = config.getCandidateInfo?.() ?? {
			stagedFiles: [],
			unstagedFiles: [],
			writeSetFiles: [],
		};

		if (requireStaged && info.stagedFiles.length === 0) {
			return createFailedStageVerdict(
				"CommitCandidate",
				["No files staged for commit"],
				{
					candidateInfo: info,
					recoveryState: "NEEDS_REPAIR",
				},
				Date.now() - startTime,
			);
		}

		const totalChanged = info.stagedFiles.length + info.unstagedFiles.length;
		if (totalChanged === 0) {
			return createFailedStageVerdict(
				"CommitCandidate",
				["No files changed — nothing to commit"],
				{
					candidateInfo: info,
					recoveryState: "NEEDS_REPAIR",
				},
				Date.now() - startTime,
			);
		}

		return createPassedStageVerdict(
			"CommitCandidate",
			{
				stagedFiles: info.stagedFiles,
				unstagedFiles: info.unstagedFiles,
				writeSetFiles: info.writeSetFiles,
				totalChanged,
			},
			Date.now() - startTime,
		);
	};
}
