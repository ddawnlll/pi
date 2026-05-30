/**
 * Rollback Manager - P37.03 Workstream
 *
 * Manages rollback of patch applications when validation fails or apply
 * errors occur. Ensures the working directory is left in a clean state
 * after a failed patch operation.
 *
 * Key responsibilities:
 * 1. Pre-apply snapshot of files before patch application
 * 2. Rollback restores all touched files to their pre-patch state
 * 3. Git-level rollback (git checkout/restore) if snapshots are unavailable
 * 4. Verify clean state after rollback (zero dirty files)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createGitRunner } from "../../git-runner.js";
import type { PatchFileOperation } from "./patch-artifact.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Snapshot of a file's content before patch application.
 */
export interface FileSnapshot {
	/** Relative file path */
	filePath: string;
	/** Content before patch (null if file didn't exist) */
	content: string | null;
}

/**
 * Result of a rollback operation.
 */
export interface RollbackResult {
	/** Whether the rollback completed successfully */
	success: boolean;
	/** Files that were restored */
	restoredFiles: string[];
	/** Files that failed to restore */
	failedFiles: string[];
	/** Error message if rollback failed entirely */
	error?: string;
	/** Whether the repo is clean after rollback */
	repoCleanAfterRollback: boolean;
}

/**
 * Configuration for RollbackManager.
 */
export interface RollbackManagerConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** Plan execution ID for logging */
	planExecId: string;
	/** Workspace ID for logging */
	workspaceId: string;
}

// ---------------------------------------------------------------------------
// RollbackManager
// ---------------------------------------------------------------------------

/**
 * Manages pre-apply snapshots and post-failure rollback for patch operations.
 */
export class RollbackManager {
	private readonly workspaceRoot: string;
	private readonly planExecId: string;
	private readonly workspaceId: string;
	private snapshots: Map<string, FileSnapshot>;

	constructor(config: RollbackManagerConfig) {
		this.workspaceRoot = path.resolve(config.workspaceRoot);
		this.planExecId = config.planExecId;
		this.workspaceId = config.workspaceId;
		this.snapshots = new Map();
	}

	/**
	 * Capture snapshots of all files that will be touched by the patch.
	 *
	 * Called BEFORE patch application. Stores a copy of each file's current
	 * content so it can be restored during rollback.
	 *
	 * @param fileOperations - The file operations in the patch
	 */
	async captureSnapshots(fileOperations: PatchFileOperation[]): Promise<void> {
		for (const op of fileOperations) {
			const fullPath = path.resolve(this.workspaceRoot, op.filePath);
			try {
				const content = await fs.readFile(fullPath, "utf-8");
				this.snapshots.set(op.filePath, {
					filePath: op.filePath,
					content,
				});
			} catch {
				// File doesn't exist — store null content (for create operations)
				this.snapshots.set(op.filePath, {
					filePath: op.filePath,
					content: null,
				});
			}
		}
	}

	/**
	 * Get the number of captured snapshots.
	 */
	get snapshotCount(): number {
		return this.snapshots.size;
	}

	/**
	 * Execute a rollback, restoring all files to their pre-patch state.
	 *
	 * Strategy:
	 * 1. Restore each snapshot file individually (write original content back)
	 * 2. For create operations where file was originally absent, delete the file
	 * 3. For edit/delete operations, write the original content back
	 * 4. If any snapshot restore fails, attempt git restore on the affected files
	 * 5. After all restores, verify the workspace is clean (git diff --name-only)
	 *
	 * @returns RollbackResult with detailed status
	 */
	async rollback(): Promise<RollbackResult> {
		const restoredFiles: string[] = [];
		const failedFiles: string[] = [];
		let criticalError: string | undefined;

		// Phase 1: Restore from snapshots
		for (const [filePath, snapshot] of this.snapshots) {
			try {
				const fullPath = path.resolve(this.workspaceRoot, filePath);

				if (snapshot.content === null) {
					// File didn't exist before — delete it if it exists now
					try {
						await fs.unlink(fullPath);
					} catch {
						// File may not exist, that's fine
					}
				} else {
					// Restore original content
					await fs.mkdir(path.dirname(fullPath), { recursive: true });
					await fs.writeFile(fullPath, snapshot.content, "utf-8");
				}

				restoredFiles.push(filePath);
			} catch {
				failedFiles.push(filePath);
			}
		}

		// Phase 2: If some files failed to restore from snapshot, try git restore
		if (failedFiles.length > 0) {
			try {
				const runner = createGitRunner({
					planExecId: this.planExecId,
					workspaceId: this.workspaceId,
					leaseId: "",
					cwd: this.workspaceRoot,
				});

				for (const filePath of failedFiles) {
					try {
						await runner.read(["checkout", "--", filePath], { cwd: this.workspaceRoot });
						restoredFiles.push(`git-restored:${filePath}`);
					} catch {
						// Git restore also failed
					}
				}
			} catch {
				criticalError =
					"Rollback: some files could not be restored from snapshot or git. Manual cleanup may be required.";
			}
		}

		// Phase 3: Verify clean state
		const repoClean = await this.isRepoClean();

		return {
			success: failedFiles.length === 0 && !criticalError && repoClean,
			restoredFiles,
			failedFiles,
			error: criticalError,
			repoCleanAfterRollback: repoClean,
		};
	}

	/**
	 * Check if the git working directory is clean (no modified files).
	 */
	async isRepoClean(): Promise<boolean> {
		try {
			const runner = createGitRunner({
				planExecId: this.planExecId,
				workspaceId: this.workspaceId,
				leaseId: "",
				cwd: this.workspaceRoot,
			});

			const result = await runner.read(["diff", "--name-only"], { cwd: this.workspaceRoot });
			const changes = result.stdout?.trim() ?? "";
			return changes.length === 0;
		} catch {
			// If git check fails, assume dirty (conservative)
			return false;
		}
	}

	/**
	 * Clear all captured snapshots.
	 */
	clearSnapshots(): void {
		this.snapshots.clear();
	}
}

/**
 * Create a RollbackManager instance.
 */
export function createRollbackManager(config: RollbackManagerConfig): RollbackManager {
	return new RollbackManager(config);
}
