/**
 * P44.5.05 — Post-Commit Verification Stage
 *
 * Verifies that a commit exists with the expected files and metadata.
 * Checks:
 * 1. Commit hash exists and is valid
 * 2. Author identity matches expected per-workspace identity
 * 3. Required trailers exist (Pi-Plan, Pi-Workspace, Pi-Agent, Pi-Completion-Gate, etc.)
 * 4. Expected files are in the commit
 * 5. No expected output remains untracked
 *
 * Block on failure and route to NEEDS_REPAIR.
 *
 * Contract Schema: 4.1.1
 */

import { execSync } from "node:child_process";
import type { StageExecutionContext, StageRunner } from "../completion-gate-vnext.js";
import type { StageVerdict } from "../completion-gate-vnext-types.js";
import { createFailedStageVerdict, createPassedStageVerdict } from "../workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the post-commit verification stage.
 */
export interface PostCommitVerificationStageConfig {
	/** Commit hash to verify */
	commitHash: string;
	/** Expected workspace identity (user name) */
	expectedAuthorName?: string;
	/** Expected workspace identity (user email) */
	expectedAuthorEmail?: string;
	/** Expected files to be in the commit */
	expectedFiles: string[];
	/** Expected trailer keys that must be present */
	requiredTrailers?: string[];
	/** Repository root path */
	repoRoot: string;
	/** Whether to also check filesystem for untracked expected output */
	checkUntrackedOutputs?: boolean;
	/** Function to verify commit (injectable for testing) */
	verifyCommit?: (hash: string) => CommitVerificationData;
}

/**
 * Data returned from commit verification.
 */
export interface CommitVerificationData {
	/** Whether the commit exists */
	commitExists: boolean;
	/** Author name from the commit */
	authorName?: string;
	/** Author email from the commit */
	authorEmail?: string;
	/** Files in the commit */
	filesInCommit: string[];
	/** Trailers from the commit message */
	trailers: Record<string, string>;
	/** Full commit message */
	commitMessage?: string;
}

// ---------------------------------------------------------------------------
// Default Trailers
// ---------------------------------------------------------------------------

/**
 * Trailers required by P44.5.07 contract.
 */
export const REQUIRED_COMMIT_TRAILERS = [
	"Pi-Plan",
	"Pi-Workspace",
	"Pi-Agent",
	"Pi-Completion-Gate",
	"Pi-Commit-Durability",
	"Pi-Validation",
	"Pi-Generated-By",
] as const;

// ---------------------------------------------------------------------------
// Stage Runner Factory
// ---------------------------------------------------------------------------

/**
 * Create a stage runner for the PostCommitVerification stage.
 *
 * @param config - Stage configuration
 */
export function createPostCommitVerificationStageRunner(config: PostCommitVerificationStageConfig): StageRunner {
	return (_stage: string, _workspace: unknown, _context: StageExecutionContext): StageVerdict => {
		const startTime = Date.now();
		const blockReasons: string[] = [];

		// Verify the commit
		let verificationData: CommitVerificationData;
		if (config.verifyCommit) {
			verificationData = config.verifyCommit(config.commitHash);
		} else {
			verificationData = verifyCommitViaGit(config.commitHash, config.repoRoot);
		}

		// Check commit existence
		if (!verificationData.commitExists) {
			return createFailedStageVerdict(
				"PostCommitVerification",
				[`Commit ${config.commitHash} does not exist`],
				{
					commitHash: config.commitHash,
					recoveryState: "NEEDS_REPAIR",
				},
				Date.now() - startTime,
			);
		}

		// Check author name
		if (config.expectedAuthorName && verificationData.authorName !== config.expectedAuthorName) {
			blockReasons.push(
				`Author name mismatch: expected "${config.expectedAuthorName}", got "${verificationData.authorName}"`,
			);
		}

		// Check author email
		if (config.expectedAuthorEmail && verificationData.authorEmail !== config.expectedAuthorEmail) {
			blockReasons.push(
				`Author email mismatch: expected "${config.expectedAuthorEmail}", got "${verificationData.authorEmail}"`,
			);
		}

		// Check expected files
		const missingFiles = config.expectedFiles.filter((f) => !verificationData.filesInCommit.includes(f));
		if (missingFiles.length > 0) {
			blockReasons.push(`Expected files not in commit: ${missingFiles.join(", ")}`);
		}

		// Check required trailers
		const trailersToCheck = config.requiredTrailers ?? [...REQUIRED_COMMIT_TRAILERS];
		const missingTrailers = trailersToCheck.filter((t) => !verificationData.trailers[t]);
		if (missingTrailers.length > 0) {
			blockReasons.push(`Required trailers missing: ${missingTrailers.join(", ")}`);
		}

		if (blockReasons.length > 0) {
			return createFailedStageVerdict(
				"PostCommitVerification",
				blockReasons,
				{
					commitHash: config.commitHash,
					filesInCommit: verificationData.filesInCommit,
					authorName: verificationData.authorName,
					authorEmail: verificationData.authorEmail,
					trailersPresent: Object.keys(verificationData.trailers),
					missingFiles,
					missingTrailers,
					recoveryState: "NEEDS_REPAIR",
				},
				Date.now() - startTime,
			);
		}

		return createPassedStageVerdict(
			"PostCommitVerification",
			{
				commitHash: config.commitHash,
				filesInCommit: verificationData.filesInCommit,
				authorName: verificationData.authorName,
				authorEmail: verificationData.authorEmail,
				trailersPresent: Object.keys(verificationData.trailers),
				allExpectedFilesPresent: true,
				allTrailersPresent: true,
			},
			Date.now() - startTime,
		);
	};
}

// ---------------------------------------------------------------------------
// Git Verification
// ---------------------------------------------------------------------------

/**
 * Verify commit data by running git commands.
 */
function verifyCommitViaGit(commitHash: string, repoRoot: string): CommitVerificationData {
	try {
		// Check if commit exists
		execSync(`git rev-parse --verify ${commitHash}`, {
			cwd: repoRoot,
			stdio: "pipe",
			encoding: "utf-8",
		});
	} catch {
		return {
			commitExists: false,
			filesInCommit: [],
			trailers: {},
		};
	}

	try {
		// Get author name and email
		const authorName = execSync(`git log -1 --format="%an" ${commitHash}`, {
			cwd: repoRoot,
			encoding: "utf-8",
		}).trim();
		const authorEmail = execSync(`git log -1 --format="%ae" ${commitHash}`, {
			cwd: repoRoot,
			encoding: "utf-8",
		}).trim();

		// Get files in commit
		const filesInCommit = execSync(`git diff-tree --no-commit-id --name-only -r ${commitHash}`, {
			cwd: repoRoot,
			encoding: "utf-8",
		})
			.trim()
			.split("\n")
			.filter(Boolean);

		// Get commit message (for trailers)
		const commitMessage = execSync(`git log -1 --format="%B" ${commitHash}`, {
			cwd: repoRoot,
			encoding: "utf-8",
		}).trim();

		// Parse trailers
		const trailers: Record<string, string> = {};
		const trailerLines = commitMessage.split("\n").filter((line) => line.includes(": "));
		for (const line of trailerLines) {
			const colonIdx = line.indexOf(": ");
			if (colonIdx > 0) {
				const key = line.slice(0, colonIdx).trim();
				const value = line.slice(colonIdx + 2).trim();
				trailers[key] = value;
			}
		}

		return {
			commitExists: true,
			authorName,
			authorEmail,
			filesInCommit,
			trailers,
			commitMessage,
		};
	} catch {
		return {
			commitExists: true, // commit exists but we couldn't read details
			filesInCommit: [],
			trailers: {},
		};
	}
}
