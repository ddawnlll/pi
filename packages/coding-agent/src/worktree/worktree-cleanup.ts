/**
 * Worktree Cleanup - P2 Workstream 6.B
 *
 * Safe, path-constrained worktree removal.
 *
 * SECURITY PROPERTIES:
 *   1. All cleanup operations refuse paths outside `.pi/worktrees` (AC3).
 *   2. Cleanup uses `git worktree remove` and `git branch -D` — never raw
 *      destructive shell commands like `rm -rf` (AC4).
 *   3. All input paths are resolved and validated against the allowed root
 *      before any operation is performed.
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import { DEFAULT_WORKTREE_ROOT, type WorktreeCleanupResult } from "./worktree-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command and return stdout trimmed.
 */
function git(args: string[], cwd: string): string {
	const result = execSync(`git ${args.join(" ")}`, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return result.trim();
}

/**
 * Validate that a resolved path is within the allowed worktree root.
 * Throws if the path escapes the allowed root.
 *
 * AC3: Cleanup refuses paths outside .pi/worktrees.
 *
 * @param targetPath - The absolute target path to check.
 * @param allowedRoot - The absolute allowed root directory.
 * @throws Error if the path is outside the allowed root.
 */
function assertPathWithinRoot(targetPath: string, allowedRoot: string): void {
	// Resolve both paths to eliminate symlinks and relative segments
	const resolvedTarget = path.resolve(targetPath);
	const resolvedRoot = path.resolve(allowedRoot);

	// Normalize trailing separator for comparison
	const normalizedRoot = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
	const normalizedTarget = resolvedTarget.endsWith(path.sep) ? resolvedTarget : resolvedTarget + path.sep;

	if (!normalizedTarget.startsWith(normalizedRoot)) {
		throw new Error(
			`Cleanup path "${resolvedTarget}" is outside allowed worktree root "${resolvedRoot}". ` +
				`Refusing to clean up.`,
		);
	}
}

// ---------------------------------------------------------------------------
// WorktreeCleanup
// ---------------------------------------------------------------------------

/**
 * Path-safe worktree cleanup operations.
 *
 * All cleanup methods validate that target paths are within the allowed
 * `.pi/worktrees` root directory before performing any operations.
 * No raw `rm -rf` or equivalent destructive commands are used.
 */
export class WorktreeCleanup {
	private workspaceRoot: string;
	private worktreeRoot: string;

	/**
	 * @param workspaceRoot - Absolute path to the main project root.
	 * @param worktreeRootOverride - Optional override for the worktree storage root.
	 *                               Defaults to ".pi/worktrees".
	 */
	constructor(workspaceRoot: string, worktreeRootOverride?: string) {
		this.workspaceRoot = path.resolve(workspaceRoot);
		this.worktreeRoot = worktreeRootOverride ?? DEFAULT_WORKTREE_ROOT;
	}

	/**
	 * The absolute path to the allowed worktree storage root.
	 */
	get allowedRoot(): string {
		return path.resolve(this.workspaceRoot, this.worktreeRoot);
	}

	/**
	 * Validate a path is within the allowed worktree root.
	 *
	 * @param targetPath - Absolute path to validate.
	 * @throws Error if the path is outside the allowed root.
	 */
	validatePath(targetPath: string): void {
		assertPathWithinRoot(targetPath, this.allowedRoot);
	}

	/**
	 * Remove a git worktree using `git worktree remove --force`.
	 *
	 * AC3: Refuses paths outside .pi/worktrees.
	 * AC4: Uses `git worktree remove` (not raw destructive commands).
	 *
	 * @param worktreeDir - Absolute path to the worktree directory.
	 * @param branchName - Optional git branch name to clean up after removal.
	 * @returns Cleanup result.
	 */
	async removeWorktree(worktreeDir: string, branchName?: string): Promise<WorktreeCleanupResult> {
		const resolvedDir = path.resolve(worktreeDir);

		// AC3: Validate path is within allowed root
		try {
			this.validatePath(resolvedDir);
		} catch (err) {
			return {
				success: false,
				path: resolvedDir,
				error: err instanceof Error ? err.message : String(err),
			};
		}

		// AC4: Use git worktree remove, not rm -rf
		try {
			git(["worktree", "remove", "--force", resolvedDir], this.workspaceRoot);
		} catch (err) {
			return {
				success: false,
				path: resolvedDir,
				error: `Failed to remove git worktree: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		// Also remove the branch to keep things clean
		if (branchName) {
			try {
				git(["branch", "-D", branchName], this.workspaceRoot);
			} catch {
				// Ignore branch deletion errors
			}
		}

		// Prune stale worktree references
		try {
			git(["worktree", "prune"], this.workspaceRoot);
		} catch {
			// Ignore prune errors
		}

		return {
			success: true,
			path: resolvedDir,
		};
	}

	/**
	 * Remove all worktrees under a given plan execution ID.
	 *
	 * This is a bulk cleanup operation. Each worktree is removed individually
	 * using `git worktree remove`. If any removal fails, the error is collected
	 * and remaining worktrees continue to be processed.
	 *
	 * AC3: Each individual worktree path is validated.
	 * AC4: Each removal uses `git worktree remove`.
	 *
	 * @param worktreePaths - Array of absolute worktree paths to remove.
	 * @param branchNames - Optional array of branch names (parallel to worktreePaths).
	 * @returns Array of cleanup results.
	 */
	async removeAll(worktreePaths: string[], branchNames?: string[]): Promise<WorktreeCleanupResult[]> {
		const results: WorktreeCleanupResult[] = [];

		for (let i = 0; i < worktreePaths.length; i++) {
			const dir = worktreePaths[i];
			const branch = branchNames?.[i];
			const result = await this.removeWorktree(dir, branch);
			results.push(result);
		}

		return results;
	}
}

/**
 * Create a WorktreeCleanup instance.
 *
 * @param workspaceRoot - Absolute path to the main project root.
 * @param worktreeRootOverride - Optional override for the worktree storage root.
 * @returns A new WorktreeCleanup instance.
 */
export function createWorktreeCleanup(workspaceRoot: string, worktreeRootOverride?: string): WorktreeCleanup {
	return new WorktreeCleanup(workspaceRoot, worktreeRootOverride);
}
