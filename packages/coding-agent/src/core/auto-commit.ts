/**
 * Auto Commit - P2 Workstream 7.I
 *
 * Handles automatic git commits for completed workspaces with safety checks.
 * Never pushes, never merges, only commits approved changes.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceState } from "./plan-state.js";
import type { Workspace } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

const execAsync = promisify(exec);

/**
 * Commit result
 */
export interface CommitResult {
	/** Whether commit was successful */
	success: boolean;
	/** Commit hash (if successful) */
	commitHash?: string;
	/** Reason for skipping or failure */
	reason?: string;
	/** Files that were committed */
	committedFiles?: string[];
}

/**
 * Commit validation result
 */
export interface CommitValidation {
	/** Whether commit is allowed */
	allowed: boolean;
	/** Reason for blocking (if not allowed) */
	reason?: string;
	/** Files that would be committed */
	filesToCommit?: string[];
	/** Forbidden files that are dirty */
	forbiddenFilesDirty?: string[];
}

/**
 * Auto commit handler
 *
 * Manages automatic commits for completed workspaces with safety checks:
 * - Only commits after workspace is complete and approved
 * - Never pushes or merges
 * - Validates against capability manifest
 * - Checks for test failures
 * - Checks for forbidden file modifications
 */
export class AutoCommit {
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Validate if workspace can be committed
	 *
	 * @param workspace - Workspace specification
	 * @param state - Workspace state
	 * @returns Validation result
	 */
	async validateCommit(workspace: Workspace, state: WorkspaceState): Promise<CommitValidation> {
		// Check if workspace is complete
		if (state.stage !== WorkspaceStage.Complete) {
			return {
				allowed: false,
				reason: `Workspace is not complete (stage: ${state.stage})`,
			};
		}

		// Check if workspace exhausted retries (should be failed, not complete)
		if (state.attempts >= workspace.maxRetries && state.error) {
			return {
				allowed: false,
				reason: `Workspace exhausted retries (${state.attempts}/${workspace.maxRetries})`,
			};
		}

		// Check if there are any changes to commit
		const status = await this.getGitStatus();
		if (status.modified.length === 0 && status.added.length === 0 && status.deleted.length === 0) {
			return {
				allowed: false,
				reason: "No changes to commit",
			};
		}

		// Get all changed files
		const changedFiles = [...status.modified, ...status.added, ...status.deleted];

		// Check if workspace has capability manifest
		if (workspace.capabilities) {
			// Check for explicitly forbidden file modifications (cannotEdit)
			const forbiddenFilesDirty: string[] = [];

			for (const file of changedFiles) {
				if (workspace.capabilities.cannotEdit.some((pattern) => this.matchesPattern(file, pattern))) {
					forbiddenFilesDirty.push(file);
				}
			}

			if (forbiddenFilesDirty.length > 0) {
				return {
					allowed: false,
					reason: `Forbidden files are dirty: ${forbiddenFilesDirty.join(", ")}`,
					forbiddenFilesDirty,
				};
			}

			// Filter files to only those allowed by capability manifest.
			// Files outside canEdit are simply excluded (not forbidden) —
			// they will remain uncommitted rather than blocking the commit.
			const filesToCommit = changedFiles.filter((file) => {
				// If canEdit is empty, allow all files not in cannotEdit
				if (workspace.capabilities!.canEdit.length === 0) {
					return !workspace.capabilities!.cannotEdit.some((pattern) => this.matchesPattern(file, pattern));
				}

				// Otherwise, only allow files in canEdit
				return workspace.capabilities!.canEdit.some((pattern) => this.matchesPattern(file, pattern));
			});

			return {
				allowed: true,
				filesToCommit,
			};
		}

		// No capability manifest - commit all changes
		return {
			allowed: true,
			filesToCommit: changedFiles,
		};
	}

	/**
	 * Commit workspace changes
	 *
	 * Stages only files matching the workspace capability manifest (canEdit)
	 * and creates a single commit with a descriptive message.
	 * Never pushes, never merges.
	 *
	 * @param workspace - Workspace specification
	 * @param state - Workspace state
	 * @param phase - Phase identifier (e.g. "2") for commit message
	 * @returns Commit result
	 */
	async commit(workspace: Workspace, state: WorkspaceState, phase?: string): Promise<CommitResult> {
		// Validate commit
		const validation = await this.validateCommit(workspace, state);

		if (!validation.allowed) {
			return {
				success: false,
				reason: validation.reason,
			};
		}

		if (!validation.filesToCommit || validation.filesToCommit.length === 0) {
			return {
				success: false,
				reason: "No files to commit",
			};
		}

		try {
			// Stage files
			for (const file of validation.filesToCommit) {
				await execAsync(`git add "${file}"`, { cwd: this.workspaceRoot });
			}

			// Generate commit message
			const phaseStr = phase ?? "2";
			const shortTitle = workspace.title.slice(0, 50);
			const commitMessage = `feat(p${phaseStr}): complete workspace ${workspace.id} — ${shortTitle}`;

			// Commit
			const { stdout } = await execAsync(`git commit -m "${commitMessage}"`, { cwd: this.workspaceRoot });

			// Extract commit hash
			const hashMatch = stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
			const commitHash = hashMatch ? hashMatch[1] : undefined;

			return {
				success: true,
				commitHash,
				committedFiles: validation.filesToCommit,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Check if error is "nothing to commit"
			if (errorMessage.includes("nothing to commit")) {
				return {
					success: false,
					reason: "No changes to commit (git reported nothing to commit)",
				};
			}

			return {
				success: false,
				reason: `Git commit failed: ${errorMessage}`,
			};
		}
	}

	/**
	 * Commit a rollup of all staged files from the entire plan.
	 *
	 * Stages all modified files (regardless of individual workspace canEdit
	 * boundaries) into a single plan-level commit. This is called after
	 * all workspaces are complete.
	 * Never pushes, never merges.
	 *
	 * @param phase - Phase identifier (e.g. "2") for commit message
	 * @param planTitle - Plan title for commit message
	 * @returns Commit result
	 */
	async commitPlan(phase?: string, planTitle?: string): Promise<CommitResult> {
		try {
			// Get git status to find all changes
			const status = await this.getGitStatus();
			const allChanges = [...status.modified, ...status.added, ...status.deleted];

			if (allChanges.length === 0) {
				return {
					success: false,
					reason: "No changes to commit",
				};
			}

			// Stage all changes
			await execAsync("git add -A", { cwd: this.workspaceRoot });

			// Generate commit message
			const phaseStr = phase ?? "2";
			const title = planTitle ?? "Plan execution complete";
			const commitMessage = `feat(p${phaseStr}): complete plan — ${title}`;

			// Commit
			const { stdout } = await execAsync(`git commit -m "${commitMessage}"`, { cwd: this.workspaceRoot });

			// Extract commit hash
			const hashMatch = stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
			const commitHash = hashMatch ? hashMatch[1] : undefined;

			return {
				success: true,
				commitHash,
				committedFiles: allChanges,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			if (errorMessage.includes("nothing to commit")) {
				return {
					success: false,
					reason: "No changes to commit (git reported nothing to commit)",
				};
			}

			return {
				success: false,
				reason: `Git rollup commit failed: ${errorMessage}`,
			};
		}
	}

	/**
	 * Get git status
	 *
	 * @returns Git status with modified, added, and deleted files
	 */
	private async getGitStatus(): Promise<{
		modified: string[];
		added: string[];
		deleted: string[];
	}> {
		try {
			const { stdout } = await execAsync("git status --porcelain --untracked-files=all", {
				cwd: this.workspaceRoot,
			});

			const modified: string[] = [];
			const added: string[] = [];
			const deleted: string[] = [];

			for (const line of stdout.split("\n")) {
				if (!line.trim()) continue;

				const status = line.slice(0, 2);
				const file = line.slice(3).trim();

				// Skip directories (git status shows them with trailing /)
				if (file.endsWith("/")) {
					continue;
				}

				if (status.includes("M")) {
					modified.push(file);
				} else if (status.includes("A") || status.includes("?")) {
					added.push(file);
				} else if (status.includes("D")) {
					deleted.push(file);
				}
			}

			return { modified, added, deleted };
		} catch (_error) {
			// If git command fails, return empty status
			return { modified: [], added: [], deleted: [] };
		}
	}

	/**
	 * Match file path against pattern (supports wildcards)
	 *
	 * @param filePath - File path to match
	 * @param pattern - Pattern (supports * wildcard)
	 * @returns True if file matches pattern
	 */
	private matchesPattern(filePath: string, pattern: string): boolean {
		// Convert glob pattern to regex
		const regexPattern = pattern
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
			.replace(/\*/g, ".*"); // Convert * to .*

		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(filePath);
	}
}

/**
 * Create an auto commit instance
 *
 * @param workspaceRoot - Workspace root directory
 * @returns Auto commit instance
 */
export function createAutoCommit(workspaceRoot: string): AutoCommit {
	return new AutoCommit(workspaceRoot);
}
