/**
 * Integration Branch - P2 Workstream 6.C
 *
 * Manages a local integration branch that workspaces merge into sequentially.
 * Each workspace is merged one at a time, with validation running after each
 * merge. Results are recorded in archive state.
 *
 * Never pushes to remote — all operations are local.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Integration merge status for a workspace entry.
 */
export type IntegrationMergeStatus =
	/** Waiting to be merged */
	| "pending"
	/** Currently being merged */
	| "merging"
	/** Successfully merged into integration branch */
	| "merged"
	/** Validation is running */
	| "validating"
	/** Validation failed — merge is blocked */
	| "blocked"
	/** Merge or validation failed */
	| "failed";

/**
 * A single workspace merge entry in the integration branch.
 */
export interface WorkspaceMergeEntry {
	/** Workspace ID */
	workspaceId: string;
	/** Current merge status */
	status: IntegrationMergeStatus;
	/** Commit hash from the workspace branch that was merged */
	commitHash: string;
	/** Timestamp when merge started */
	mergeStartedAt?: number;
	/** Timestamp when merge completed */
	mergedAt?: number;
	/** Git commit hash of the merge commit in the integration branch */
	mergeCommitHash?: string;
	/** Validation command that was run */
	validationCommand?: string;
	/** Whether validation passed */
	validationPassed?: boolean;
	/** Validation output */
	validationOutput?: string;
	/** Error message if merge or validation failed */
	error?: string;
}

/**
 * Serialized state of the integration branch.
 */
export interface IntegrationBranchState {
	/** Name of the integration branch */
	branchName: string;
	/** Base branch the integration branch was created from */
	baseBranch: string;
	/** Merge entries in order of processing */
	entries: WorkspaceMergeEntry[];
	/** Timestamp when the branch was created */
	createdAt: number;
	/** Timestamp when the state was last updated */
	updatedAt: number;
}

// ---------------------------------------------------------------------------
// Git helpers
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
 * Check if a git branch exists locally.
 */
function branchExists(branchName: string, cwd: string): boolean {
	try {
		git(["rev-parse", "--verify", branchName], cwd);
		return true;
	} catch {
		return false;
	}
}

/**
 * Get the current branch name.
 */
function getCurrentBranch(cwd: string): string {
	return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

/**
 * Check if there are uncommitted changes.
 */
function _hasUncommittedChanges(cwd: string): boolean {
	try {
		const status = git(["status", "--porcelain"], cwd);
		return status.length > 0;
	} catch {
		return true;
	}
}

// ---------------------------------------------------------------------------
// IntegrationBranch
// ---------------------------------------------------------------------------

/**
 * Integration Branch Manager
 *
 * Manages a local integration branch where workspace changes are merged one
 * at a time in queue order. After each merge, validation runs. If validation
 * fails, the merge is blocked and subsequent workspaces cannot proceed.
 *
 * All operations are local — git push is never called.
 */
export class IntegrationBranch {
	private workspaceRoot: string;
	private branchName: string;
	private baseBranch: string;
	private state: IntegrationBranchState;
	private stateFilePath: string;

	/**
	 * @param workspaceRoot - Root directory of the workspace (git repo)
	 * @param branchName - Name of the integration branch (default: "integration")
	 * @param baseBranch - Base branch to create the integration branch from (default: "main")
	 */
	constructor(workspaceRoot: string, branchName = "integration", baseBranch = "main") {
		this.workspaceRoot = workspaceRoot;
		this.branchName = branchName;
		this.baseBranch = baseBranch;
		this.state = {
			branchName,
			baseBranch,
			entries: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		this.stateFilePath = path.join(workspaceRoot, ".pi", "integration-branch.json");
	}

	/**
	 * Name of the integration branch.
	 */
	get name(): string {
		return this.branchName;
	}

	/**
	 * Base branch the integration branch was created from.
	 */
	get base(): string {
		return this.baseBranch;
	}

	/**
	 * Current merge entries in order of processing.
	 */
	get entries(): WorkspaceMergeEntry[] {
		return [...this.state.entries];
	}

	/**
	 * Ensure the integration branch exists.
	 *
	 * Creates it from baseBranch if it doesn't exist yet.
	 * Does not switch the current branch.
	 */
	async ensureBranch(): Promise<void> {
		await this.loadState();

		if (!branchExists(this.branchName, this.workspaceRoot)) {
			// Create the integration branch from baseBranch
			const currentBranch = getCurrentBranch(this.workspaceRoot);

			try {
				git(["checkout", this.baseBranch], this.workspaceRoot);
				git(["checkout", "-b", this.branchName], this.workspaceRoot);
			} finally {
				// Return to the original branch
				if (currentBranch !== getCurrentBranch(this.workspaceRoot)) {
					git(["checkout", currentBranch], this.workspaceRoot);
				}
			}
		}

		this.state.createdAt = Date.now();
		await this.saveState();
	}

	/**
	 * Merge a workspace commit into the integration branch.
	 *
	 * Cherry-picks the workspace commit onto the integration branch.
	 * Does NOT run validation — that is handled separately by the queue.
	 *
	 * @param workspaceId - Workspace ID
	 * @param commitHash - Commit hash from the workspace branch to merge
	 * @param files - Files that were changed (for logging)
	 * @returns Updated merge entry
	 */
	async mergeWorkspace(workspaceId: string, commitHash: string): Promise<WorkspaceMergeEntry> {
		await this.loadState();

		// Find or create entry
		let entry = this.state.entries.find((e) => e.workspaceId === workspaceId);
		if (!entry) {
			entry = {
				workspaceId,
				status: "merging",
				commitHash,
				mergeStartedAt: Date.now(),
			};
			this.state.entries.push(entry);
		} else {
			entry.status = "merging";
			entry.commitHash = commitHash;
			entry.mergeStartedAt = Date.now();
			entry.error = undefined;
		}

		await this.saveState();

		const currentBranch = getCurrentBranch(this.workspaceRoot);

		try {
			// Switch to integration branch
			git(["checkout", this.branchName], this.workspaceRoot);

			// Cherry-pick the workspace commit
			git(["cherry-pick", "--no-commit", commitHash], this.workspaceRoot);

			// Create a merge commit
			const mergeCommitHash = git(
				["commit", "--no-verify", "-m", `chore: merge workspace ${workspaceId} into integration`],
				this.workspaceRoot,
			);

			entry.status = "merged";
			entry.mergedAt = Date.now();
			entry.mergeCommitHash = mergeCommitHash;
		} catch (error) {
			// Cherry-pick or commit failed — abort the cherry-pick
			try {
				git(["cherry-pick", "--abort"], this.workspaceRoot);
			} catch {
				// If cherry-pick --abort fails, try reset
				try {
					git(["reset", "--merge"], this.workspaceRoot);
				} catch {
					// Last resort
				}
			}

			entry.status = "failed";
			entry.error = error instanceof Error ? error.message : String(error);

			throw error;
		} finally {
			// Return to the original branch
			if (currentBranch !== getCurrentBranch(this.workspaceRoot)) {
				git(["checkout", currentBranch], this.workspaceRoot);
			}

			await this.saveState();
		}

		return entry;
	}

	/**
	 * Run validation on the integration branch after a merge.
	 *
	 * Switches to the integration branch, runs the validation command, and
	 * records the result. If validation fails, the workspace is marked as
	 * "blocked" instead of "failed" — the merge is blocked but the workspace
	 * is not considered permanently failed (can be retried after fix).
	 *
	 * @param workspaceId - Workspace ID to validate
	 * @param validationCommand - Shell command to run for validation
	 * @returns Validation result
	 */
	async runValidation(workspaceId: string, validationCommand: string): Promise<{ passed: boolean; output: string }> {
		await this.loadState();

		const entry = this.state.entries.find((e) => e.workspaceId === workspaceId);
		if (!entry) {
			throw new Error(`No merge entry found for workspace ${workspaceId}`);
		}

		if (entry.status !== "merged") {
			throw new Error(`Workspace ${workspaceId} is not merged (status: ${entry.status})`);
		}

		entry.status = "validating";
		entry.validationCommand = validationCommand;
		await this.saveState();

		const currentBranch = getCurrentBranch(this.workspaceRoot);
		let output = "";
		let passed = false;

		try {
			// Switch to integration branch
			git(["checkout", this.branchName], this.workspaceRoot);

			// Run validation command
			try {
				const result = execSync(validationCommand, {
					cwd: this.workspaceRoot,
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 300_000, // 5 minute timeout
				});
				output = result.trim();
				passed = true;
			} catch (error) {
				if (error instanceof Error) {
					output = error.message;
				} else {
					output = String(error);
				}
				passed = false;
			}

			if (passed) {
				entry.status = "merged";
				entry.validationPassed = true;
				entry.validationOutput = output;
			} else {
				entry.status = "blocked";
				entry.validationPassed = false;
				entry.validationOutput = output;
				entry.error = `Validation failed: ${validationCommand}`;
			}
		} finally {
			// Return to the original branch
			if (currentBranch !== getCurrentBranch(this.workspaceRoot)) {
				git(["checkout", currentBranch], this.workspaceRoot);
			}

			await this.saveState();
		}

		return { passed, output };
	}

	/**
	 * Record a merge entry result to the persistent state.
	 *
	 * @param entry - Merge entry to record
	 */
	async recordResult(entry: WorkspaceMergeEntry): Promise<void> {
		await this.loadState();

		const idx = this.state.entries.findIndex((e) => e.workspaceId === entry.workspaceId);
		if (idx >= 0) {
			this.state.entries[idx] = { ...entry };
		} else {
			this.state.entries.push({ ...entry });
		}

		await this.saveState();
	}

	/**
	 * Get the merge status for a workspace.
	 *
	 * @param workspaceId - Workspace ID
	 * @returns Merge entry or undefined if not found
	 */
	getMergeStatus(workspaceId: string): WorkspaceMergeEntry | undefined {
		return this.state.entries.find((e) => e.workspaceId === workspaceId);
	}

	/**
	 * Get all merge entries.
	 */
	getAllEntries(): WorkspaceMergeEntry[] {
		return [...this.state.entries];
	}

	/**
	 * Get the serializable state of the integration branch.
	 */
	getState(): IntegrationBranchState {
		return { ...this.state, entries: [...this.state.entries] };
	}

	/**
	 * Check whether the integration branch exists locally.
	 */
	exists(): boolean {
		return branchExists(this.branchName, this.workspaceRoot);
	}

	/**
	 * Get the git log of the integration branch relative to the base branch.
	 * Returns a list of commit summaries.
	 */
	getLog(): string[] {
		try {
			const log = git(["log", "--oneline", `${this.baseBranch}..${this.branchName}`], this.workspaceRoot);
			return log.split("\n").filter(Boolean);
		} catch {
			return [];
		}
	}

	/**
	 * Get the diff stat between the integration branch and the base branch.
	 */
	getDiffStat(): string {
		try {
			return git(["diff", "--stat", `${this.baseBranch}..${this.branchName}`], this.workspaceRoot);
		} catch {
			return "";
		}
	}

	/**
	 * Save state to disk as JSON.
	 */
	private async saveState(): Promise<void> {
		this.state.updatedAt = Date.now();

		const piDir = path.dirname(this.stateFilePath);
		await fs.mkdir(piDir, { recursive: true });

		const tempPath = `${this.stateFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), "utf-8");
		await fs.rename(tempPath, this.stateFilePath);
	}

	/**
	 * Load state from disk if it exists.
	 */
	private async loadState(): Promise<void> {
		try {
			const content = await fs.readFile(this.stateFilePath, "utf-8");
			const parsed = JSON.parse(content) as IntegrationBranchState;

			// Merge loaded state with defaults
			this.state = {
				...parsed,
				entries: parsed.entries ?? [],
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// No saved state yet — use defaults
				return;
			}
			throw error;
		}
	}
}

/**
 * Format a merge entry for human-readable display.
 *
 * @param entry - Merge entry
 * @returns Formatted string
 */
export function formatMergeEntry(entry: WorkspaceMergeEntry): string {
	const lines: string[] = [];
	lines.push(`Workspace: ${entry.workspaceId}`);
	lines.push(`  Status: ${entry.status}`);
	lines.push(`  Commit: ${entry.commitHash.slice(0, 8)}`);

	if (entry.mergeCommitHash) {
		lines.push(`  Merge Commit: ${entry.mergeCommitHash.slice(0, 8)}`);
	}
	if (entry.mergeStartedAt) {
		lines.push(`  Merge Started: ${new Date(entry.mergeStartedAt).toISOString()}`);
	}
	if (entry.mergedAt) {
		lines.push(`  Merged At: ${new Date(entry.mergedAt).toISOString()}`);
	}
	if (entry.validationCommand) {
		lines.push(`  Validation: ${entry.validationCommand}`);
	}
	if (entry.validationPassed !== undefined) {
		lines.push(`  Validation Passed: ${entry.validationPassed}`);
	}
	if (entry.validationOutput) {
		lines.push(`  Validation Output: ${entry.validationOutput.slice(0, 200)}`);
	}
	if (entry.error) {
		lines.push(`  Error: ${entry.error}`);
	}

	return lines.join("\n");
}

/**
 * Format full integration branch state for display.
 *
 * @param state - Integration branch state
 * @returns Formatted string
 */
export function formatIntegrationBranchState(state: IntegrationBranchState): string {
	const lines: string[] = [];

	lines.push(`Integration Branch: ${state.branchName}`);
	lines.push(`Base Branch: ${state.baseBranch}`);
	lines.push(`Created: ${new Date(state.createdAt).toISOString()}`);
	lines.push(`Updated: ${new Date(state.updatedAt).toISOString()}`);
	lines.push("");
	lines.push(`Entries (${state.entries.length}):`);
	lines.push("");

	for (let i = 0; i < state.entries.length; i++) {
		const entry = state.entries[i];
		lines.push(`  [${i + 1}] ${entry.workspaceId} — ${entry.status}`);
		if (entry.validationPassed !== undefined) {
			lines.push(`       Validation: ${entry.validationPassed ? "PASSED" : "FAILED"}`);
		}
		if (entry.error) {
			lines.push(`       Error: ${entry.error}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}
