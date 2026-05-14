/**
 * Worktree Manager - P2 Workstream 6.B
 *
 * Lifecycle manager for git worktrees used during plan execution.
 * Manages worktree creation, status tracking, diff artifact generation,
 * quarantining of failed worktrees, and provides a list API.
 *
 * Delegates cleanup to WorktreeCleanup for safe path-constrained removal.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WorktreeCleanup } from "./worktree-cleanup.js";
import {
	DEFAULT_WORKTREE_ROOT,
	type WorktreeCleanupResult,
	type WorktreeDiffArtifact,
	type WorktreeListEntry,
	type WorktreeState,
	type WorktreeStatus,
} from "./worktree-types.js";

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

// ---------------------------------------------------------------------------
// WorktreeManager
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of git worktrees for plan execution.
 *
 * Responsibilities:
 *   - Register worktree state after creation (by WorktreeWorkspaceExecutor).
 *   - Track status transitions (created -> active -> completed | failed -> quarantined).
 *   - Generate diff artifacts for completed worktrees (git diff base..HEAD).
 *   - Quarantine failed worktrees for later review.
 *   - Provide a list API returning all tracked worktrees with their status.
 *   - Delegate path-safe cleanup to WorktreeCleanup.
 */
export class WorktreeManager {
	private workspaceRoot: string;
	private worktrees: Map<string, WorktreeState>;
	private diffArtifacts: Map<string, WorktreeDiffArtifact>;
	private worktreeRoot: string;

	constructor(workspaceRoot: string, worktreeRootOverride?: string) {
		this.workspaceRoot = workspaceRoot;
		this.worktrees = new Map();
		this.diffArtifacts = new Map();
		this.worktreeRoot = worktreeRootOverride ?? DEFAULT_WORKTREE_ROOT;
	}

	/**
	 * The absolute path to the worktree storage root.
	 */
	get worktreeStorageRoot(): string {
		return path.resolve(this.workspaceRoot, this.worktreeRoot);
	}

	/**
	 * Register a worktree state with the manager.
	 * Called after a worktree is created by WorktreeWorkspaceExecutor.
	 *
	 * @param state - The worktree state to track.
	 */
	register(state: WorktreeState): void {
		const key = this.stateKey(state.planExecutionId, state.workspaceId);
		this.worktrees.set(key, { ...state });
	}

	/**
	 * Update the status of a tracked worktree.
	 *
	 * @param state - The worktree state whose status has changed.
	 */
	updateStatus(state: WorktreeState): void {
		const key = this.stateKey(state.planExecutionId, state.workspaceId);
		const existing = this.worktrees.get(key);
		if (existing) {
			existing.status = state.status;
			existing.statusChangedAt = state.statusChangedAt;
		} else {
			this.worktrees.set(key, { ...state });
		}
	}

	/**
	 * Get a single worktree state by plan execution ID and workspace ID.
	 *
	 * @param planExecutionId - Plan execution ID.
	 * @param workspaceId - Workspace ID.
	 * @returns The worktree state, or undefined if not tracked.
	 */
	getState(planExecutionId: string, workspaceId: string): WorktreeState | undefined {
		return this.worktrees.get(this.stateKey(planExecutionId, workspaceId));
	}

	/**
	 * List all tracked worktrees, optionally filtered by plan execution ID.
	 *
	 * @param planExecutionId - Optional filter to show only worktrees for a given plan.
	 * @returns Array of worktree list entries with status.
	 */
	list(planExecutionId?: string): WorktreeListEntry[] {
		const entries: WorktreeListEntry[] = [];
		for (const [, state] of this.worktrees) {
			if (planExecutionId && state.planExecutionId !== planExecutionId) {
				continue;
			}
			const diffKey = this.stateKey(state.planExecutionId, state.workspaceId);
			const artifact = this.diffArtifacts.get(diffKey);
			entries.push({
				worktreePath: state.worktreePath,
				workspaceId: state.workspaceId,
				planExecutionId: state.planExecutionId,
				branchName: state.branchName,
				baseCommit: state.baseCommit,
				status: state.status,
				createdAt: state.createdAt,
				statusChangedAt: state.statusChangedAt,
				diffArtifact: artifact?.diffPath,
			});
		}
		// Sort by created time ascending
		entries.sort((a, b) => a.createdAt - b.createdAt);
		return entries;
	}

	/**
	 * Generate a diff artifact for a completed worktree.
	 * Compares the worktree's HEAD against the base commit and stores
	 * the unified diff. The diff artifact is also persisted to disk
	 * under `.pi/worktrees/{planExecId}/{workspaceId}/diff.patch`.
	 *
	 * AC2: Completed worktree produces diff artifact.
	 *
	 * @param planExecutionId - Plan execution ID.
	 * @param workspaceId - Workspace ID.
	 * @returns The diff artifact, or undefined if the worktree is not found or not completed.
	 */
	async generateDiffArtifact(planExecutionId: string, workspaceId: string): Promise<WorktreeDiffArtifact | undefined> {
		const key = this.stateKey(planExecutionId, workspaceId);
		const state = this.worktrees.get(key);
		if (!state) {
			return undefined;
		}

		const worktreeDir = state.worktreePath;

		try {
			// Verify the worktree directory still exists
			await fs.access(worktreeDir);

			// Generate unified diff from base commit to HEAD in the worktree
			const diffOutput = git(["diff", state.baseCommit, "HEAD"], worktreeDir);

			const artifact: WorktreeDiffArtifact = {
				planExecutionId,
				workspaceId,
				diff: diffOutput,
				generatedAt: Date.now(),
			};

			// Persist the diff artifact to disk
			if (diffOutput) {
				const diffDir = path.dirname(worktreeDir);
				await fs.mkdir(diffDir, { recursive: true });
				const diffPath = path.join(worktreeDir, "diff.patch");
				await fs.writeFile(diffPath, diffOutput, "utf-8");
				artifact.diffPath = diffPath;
			}

			this.diffArtifacts.set(key, artifact);
			return artifact;
		} catch (err) {
			// Worktree may no longer exist or diff command failed
			console.error(
				`[worktree-manager] Failed to generate diff artifact for ${workspaceId}:`,
				err instanceof Error ? err.message : String(err),
			);
			return undefined;
		}
	}

	/**
	 * Mark a worktree as completed and optionally generate a diff artifact.
	 *
	 * AC2: Completed worktree produces diff artifact.
	 *
	 * @param planExecutionId - Plan execution ID.
	 * @param workspaceId - Workspace ID.
	 * @param generateDiff - Whether to generate a diff artifact (default: true).
	 * @returns The diff artifact if generated, or undefined.
	 */
	async completeWorktree(
		planExecutionId: string,
		workspaceId: string,
		generateDiff: boolean = true,
	): Promise<WorktreeDiffArtifact | undefined> {
		const key = this.stateKey(planExecutionId, workspaceId);
		const state = this.worktrees.get(key);
		if (!state) return undefined;

		state.status = "completed";
		state.statusChangedAt = Date.now();

		if (generateDiff) {
			return this.generateDiffArtifact(planExecutionId, workspaceId);
		}
		return undefined;
	}

	/**
	 * Mark a worktree as failed and quarantine it for review.
	 *
	 * AC1: Failed worktree is preserved/quarantined for review.
	 *
	 * The worktree is NOT removed; it stays on disk so the user or
	 * a reviewer can inspect the state at the time of failure.
	 *
	 * @param planExecutionId - Plan execution ID.
	 * @param workspaceId - Workspace ID.
	 */
	async failWorktree(planExecutionId: string, workspaceId: string): Promise<void> {
		const key = this.stateKey(planExecutionId, workspaceId);
		const state = this.worktrees.get(key);
		if (!state) return;

		state.status = "failed";
		state.statusChangedAt = Date.now();
	}

	/**
	 * Quarantine a failed worktree for review.
	 *
	 * AC1: Failed worktree is preserved/quarantined for review.
	 *
	 * The worktree remains on disk with its state intact, allowing
	 * post-mortem analysis. The status is set to "quarantined".
	 *
	 * @param planExecutionId - Plan execution ID.
	 * @param workspaceId - Workspace ID.
	 */
	async quarantineWorktree(planExecutionId: string, workspaceId: string): Promise<void> {
		const key = this.stateKey(planExecutionId, workspaceId);
		const state = this.worktrees.get(key);
		if (!state) return;

		state.status = "quarantined";
		state.statusChangedAt = Date.now();
	}

	/**
	 * Remove a completed worktree using path-safe cleanup.
	 * Refuses to clean up paths outside .pi/worktrees.
	 *
	 * AC3: Cleanup refuses paths outside .pi/worktrees.
	 * AC4: Cleanup does not use raw destructive commands.
	 *
	 * @param planExecutionId - Plan execution ID.
	 * @param workspaceId - Workspace ID.
	 * @returns Cleanup result.
	 */
	async cleanupCompletedWorktree(planExecutionId: string, workspaceId: string): Promise<WorktreeCleanupResult> {
		const key = this.stateKey(planExecutionId, workspaceId);
		const state = this.worktrees.get(key);
		if (!state) {
			return {
				success: false,
				path: "",
				error: `Worktree not found for ${planExecutionId}/${workspaceId}`,
			};
		}

		const cleanup = new WorktreeCleanup(this.workspaceRoot, this.worktreeRoot);
		const result = await cleanup.removeWorktree(state.worktreePath, state.branchName);

		if (result.success) {
			// Update status to completed (if not already) since it's been cleaned up
			state.status = "completed";
			state.statusChangedAt = Date.now();
		}

		return result;
	}

	/**
	 * Remove a quarantined worktree using path-safe cleanup.
	 * Refuses to clean up paths outside .pi/worktrees.
	 *
	 * AC3: Cleanup refuses paths outside .pi/worktrees.
	 * AC4: Cleanup does not use raw destructive commands.
	 *
	 * @param planExecutionId - Plan execution ID.
	 * @param workspaceId - Workspace ID.
	 * @returns Cleanup result.
	 */
	async cleanupQuarantinedWorktree(planExecutionId: string, workspaceId: string): Promise<WorktreeCleanupResult> {
		const key = this.stateKey(planExecutionId, workspaceId);
		const state = this.worktrees.get(key);
		if (!state) {
			return {
				success: false,
				path: "",
				error: `Worktree not found for ${planExecutionId}/${workspaceId}`,
			};
		}

		const cleanup = new WorktreeCleanup(this.workspaceRoot, this.worktreeRoot);
		const result = await cleanup.removeWorktree(state.worktreePath, state.branchName);

		if (result.success) {
			state.status = "completed";
			state.statusChangedAt = Date.now();
		}

		return result;
	}

	/**
	 * Count worktrees by status.
	 *
	 * @param planExecutionId - Optional filter by plan execution ID.
	 * @returns Record of status to count.
	 */
	countByStatus(planExecutionId?: string): Record<WorktreeStatus, number> {
		const counts: Record<WorktreeStatus, number> = {
			created: 0,
			active: 0,
			completed: 0,
			failed: 0,
			quarantined: 0,
		};

		for (const [, state] of this.worktrees) {
			if (planExecutionId && state.planExecutionId !== planExecutionId) continue;
			counts[state.status]++;
		}

		return counts;
	}

	/**
	 * Clear all tracked state (for tests / fresh start).
	 */
	clear(): void {
		this.worktrees.clear();
		this.diffArtifacts.clear();
	}

	/**
	 * Generate a unique key for a worktree state entry.
	 */
	private stateKey(planExecutionId: string, workspaceId: string): string {
		return `${planExecutionId}::${workspaceId}`;
	}
}
