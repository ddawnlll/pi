/**
 * P44.5.10 — Destructive Operation Preservation Guard
 *
 * Prevents destructive git/fs operations (checkout, reset, clean, worktree removal)
 * from destroying uncommitted workspace output. Before any destructive operation:
 * 1. Capture git status
 * 2. Capture diff patch
 * 3. Capture file snapshot when possible
 * 4. Record event
 * 5. Block if workspace output is not durably committed and preservation failed
 *
 * Contract Schema: 4.1.1
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Operations that are considered destructive and require guard.
 */
export const DESTRUCTIVE_OPERATIONS = [
	"git reset --hard",
	"git clean",
	"git checkout -- .",
	"git restore",
	"git worktree remove --force",
	"git worktree prune",
	"fs.rm",
	"fs.unlink",
	"rm -rf",
] as const;

export type DestructiveOperation = (typeof DESTRUCTIVE_OPERATIONS)[number];

// ---------------------------------------------------------------------------
// Preservation Snapshot
// ---------------------------------------------------------------------------

/**
 * Snapshot of workspace state before a destructive operation.
 */
export interface PreservationSnapshot {
	/** Git status output */
	gitStatus: string;
	/** Diff patch (if available) */
	diffPatch: string;
	/** List of changed files */
	changedFiles: string[];
	/** Whether the workspace is durably committed */
	isDurablyCommitted: boolean;
	/** Commit hash of the latest commit (if any) */
	latestCommitHash?: string;
	/** Timestamp of the snapshot */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Guard Result
// ---------------------------------------------------------------------------

/**
 * Result of a destructive operation guard check.
 */
export interface DestructiveOperationGuardResult {
	/** Whether the operation is allowed */
	allowed: boolean;
	/** Human-readable reason if blocked */
	reason?: string;
	/** Preservation snapshot (if captured) */
	snapshot?: PreservationSnapshot;
	/** Preservation artifact paths */
	preservationArtifacts?: PreservationArtifactPaths;
}

/**
 * Paths to preservation artifacts.
 */
export interface PreservationArtifactPaths {
	/** Path to the saved git status file */
	statusPath: string;
	/** Path to the saved diff patch file */
	diffPath: string;
	/** Path to the saved event record */
	eventPath: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the destructive operation guard.
 */
export interface DestructiveOperationGuardConfig {
	/** Repository root path */
	repoRoot: string;
	/** Workspace identifier */
	workspaceId: string;
	/** Plan execution identifier */
	planExecId: string;
	/** Archive directory for preservation snapshots */
	archiveDir: string;
	/** Whether to block if preservation fails */
	blockOnPreservationFailure: boolean;
}

// ---------------------------------------------------------------------------
// Guard Implementation
// ---------------------------------------------------------------------------

/**
 * The DestructiveOperationGuard class.
 * Guards against data loss before destructive git/fs operations.
 */
export class DestructiveOperationGuard {
	private readonly config: DestructiveOperationGuardConfig;

	constructor(config: DestructiveOperationGuardConfig) {
		this.config = config;
	}

	/**
	 * Check whether a destructive operation is allowed.
	 * Captures preservation state before allowing.
	 *
	 * @param operation - The operation being attempted
	 * @returns Guard result
	 */
	checkOperation(operation: string): DestructiveOperationGuardResult {
		// Identify the operation
		const isDestructive = DESTRUCTIVE_OPERATIONS.some((op) => operation.toLowerCase().includes(op.toLowerCase()));

		if (!isDestructive) {
			return { allowed: true };
		}

		// Capture preservation snapshot
		const snapshot = this.captureSnapshot();

		// Check if workspace output is durably committed
		if (snapshot.isDurablyCommitted) {
			// Safe: committed output is preserved in git history
			const artifacts = this.savePreservationArtifacts(snapshot);
			return {
				allowed: true,
				snapshot,
				preservationArtifacts: artifacts,
			};
		}

		// Uncommitted output: try preservation
		try {
			const artifacts = this.savePreservationArtifacts(snapshot);
			return {
				allowed: !this.config.blockOnPreservationFailure,
				reason: this.config.blockOnPreservationFailure
					? `Destructive operation blocked: workspace ${this.config.workspaceId} has uncommitted output. Preservation snapshot saved to ${artifacts.statusPath}. Route to HIR if this is intentional.`
					: undefined,
				snapshot,
				preservationArtifacts: artifacts,
			};
		} catch (err) {
			// Preservation failed
			return {
				allowed: false,
				reason: `Destructive operation blocked: cannot preserve uncommitted output for workspace ${this.config.workspaceId}. Preservation error: ${err instanceof Error ? err.message : String(err)}. Route to HIR.`,
				snapshot,
			};
		}
	}

	/**
	 * Capture a snapshot of the current workspace state.
	 */
	private captureSnapshot(): PreservationSnapshot {
		const timestamp = Date.now();
		let gitStatus = "";
		let diffPatch = "";

		try {
			gitStatus = execFileSync("git", ["status", "--porcelain"], {
				cwd: this.config.repoRoot,
				encoding: "utf-8",
				maxBuffer: 1024 * 1024,
			});
		} catch {
			gitStatus = "Unable to capture git status";
		}

		try {
			diffPatch = execFileSync("git", ["diff", "--cached"], {
				cwd: this.config.repoRoot,
				encoding: "utf-8",
				maxBuffer: 1024 * 1024,
			});
		} catch {
			diffPatch = "Unable to capture diff patch";
		}

		const changedFiles = gitStatus
			.split("\n")
			.filter((l) => l.length > 0)
			.map((l) => l.slice(3).trim())
			.filter(Boolean);

		let latestCommitHash: string | undefined;
		try {
			latestCommitHash = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: this.config.repoRoot,
				encoding: "utf-8",
			}).trim();
		} catch {
			latestCommitHash = undefined;
		}

		return {
			gitStatus,
			diffPatch,
			changedFiles,
			isDurablyCommitted: changedFiles.length === 0,
			latestCommitHash,
			timestamp,
		};
	}

	/**
	 * Save preservation artifacts to disk.
	 */
	private savePreservationArtifacts(snapshot: PreservationSnapshot): PreservationArtifactPaths {
		const archiveDir = path.resolve(this.config.archiveDir, this.config.planExecId, this.config.workspaceId);
		fs.mkdirSync(archiveDir, { recursive: true });

		const statusPath = path.join(archiveDir, "preservation-status.txt");
		const diffPath = path.join(archiveDir, "preservation-diff.patch");
		const eventPath = path.join(archiveDir, "preservation-event.json");

		fs.writeFileSync(statusPath, snapshot.gitStatus, "utf-8");
		fs.writeFileSync(diffPath, snapshot.diffPatch, "utf-8");
		fs.writeFileSync(
			eventPath,
			JSON.stringify(
				{
					timestamp: snapshot.timestamp,
					workspaceId: this.config.workspaceId,
					planExecId: this.config.planExecId,
					isDurablyCommitted: snapshot.isDurablyCommitted,
					latestCommitHash: snapshot.latestCommitHash,
					changedFiles: snapshot.changedFiles,
				},
				null,
				2,
			),
			"utf-8",
		);

		return { statusPath, diffPath, eventPath };
	}

	/**
	 * Force-allow an operation (for HIR override).
	 */
	forceAllow(reason: string): DestructiveOperationGuardResult {
		return {
			allowed: true,
			reason: `HIR override: ${reason}`,
		};
	}
}

/**
 * Create a default guard configuration.
 */
export function createDestructiveOperationGuard(
	repoRoot: string,
	workspaceId: string,
	planExecId: string,
	archiveDir?: string,
): DestructiveOperationGuard {
	return new DestructiveOperationGuard({
		repoRoot,
		workspaceId,
		planExecId,
		archiveDir: archiveDir ?? path.join(repoRoot, ".pi", "preservation"),
		blockOnPreservationFailure: true,
	});
}
