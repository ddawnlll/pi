/**
 * Worktree Workspace Executor - P2 Workstream 6.A
 *
 * Runs workspace tasks inside isolated git worktrees.
 * Creates a git worktree per workspace, records worktree state,
 * delegates agent execution to WorkspaceAgentExecutor with the worktree
 * as the working directory, and manages cleanup/preservation.
 *
 * When worktree mode is disabled, falls back to P5.5 shared-working-tree behavior.
 */

import { exec as execCb } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { HashedPacket } from "../core/role-packets.js";

const execAsync = promisify(execCb);

import { WorkspaceAgentExecutor, type WorkspaceAgentExecutorConfig } from "../core/workspace-agent-executor.js";
import {
	DEFAULT_WORKTREE_CONFIG,
	DEFAULT_WORKTREE_ROOT,
	type WorktreeConfig,
	type WorktreeCreateResult,
	type WorktreeExecutionResult,
	type WorktreeState,
	type WorktreeStatus,
} from "./worktree-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command asynchronously and return stdout trimmed.
 */
async function git(args: string[], cwd: string): Promise<string> {
	try {
		const { stdout } = await execAsync(`git ${args.join(" ")}`, {
			cwd,
			encoding: "utf-8",
			timeout: 30_000,
		});
		return stdout.trim();
	} catch {
		return "";
	}
}

/**
 * Check if a given directory exists and is a directory.
 */
async function directoryExists(dir: string): Promise<boolean> {
	try {
		const stat = await fs.stat(dir);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Sanitize a workspace ID for use in git branch names and paths.
 * Strips path traversal characters and replaces non-alphanumeric
 * characters (except . - _) with hyphens.
 */
function sanitizeForPath(id: string): string {
	// First remove any path traversal patterns
	let result = id.replace(/\.\./g, "").replace(/\//g, "-");
	// Then replace remaining non-alphanumeric chars
	result = result.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
	// Remove leading/trailing dots and hyphens
	result = result.replace(/^[.\-_]+/, "").replace(/[.\-_]+$/, "");
	return result || "workspace";
}

// ---------------------------------------------------------------------------
// WorktreeWorkspaceExecutor
// ---------------------------------------------------------------------------

/**
 * Wraps WorkspaceAgentExecutor with git worktree isolation.
 *
 * When worktree mode is enabled:
 *   1. Captures the base commit hash from the main checkout.
 *   2. Creates a git worktree under `.pi/worktrees/{planExecId}/{workspaceId}/`.
 *   3. Records worktree state (path, base commit, branch, workspace ID, plan exec ID).
 *   4. Delegates agent execution with the worktree path as workspaceRoot.
 *   5. On completion, updates worktree status and optionally cleans up.
 *
 * When worktree mode is disabled:
 *   Directly delegates to WorkspaceAgentExecutor with the original workspaceRoot.
 */
export class WorktreeWorkspaceExecutor {
	private workspaceRoot: string;
	private planExecutionId: string;
	private workspaceId: string;
	private worktreeConfig: WorktreeConfig;
	private branchName: string;
	private branchRetryCount = 0;
	private worktreeState: WorktreeState | null = null;
	private lastExecutor: WorkspaceAgentExecutor | null = null;
	private abortController: AbortController | null = null;

	constructor(config: {
		workspaceRoot: string;
		planExecutionId: string;
		workspaceId: string;
		worktree?: WorktreeConfig;
		branchName?: string;
	}) {
		this.workspaceRoot = config.workspaceRoot;
		this.planExecutionId = config.planExecutionId;
		this.workspaceId = config.workspaceId;
		this.worktreeConfig = config.worktree ?? DEFAULT_WORKTREE_CONFIG;
		this.branchName =
			config.branchName ??
			`worktree/${sanitizeForPath(config.planExecutionId)}/${sanitizeForPath(config.workspaceId)}`;
	}

	/**
	 * Whether worktree mode is enabled for this executor.
	 */
	get isWorktreeModeEnabled(): boolean {
		return this.worktreeConfig.enabled;
	}

	/**
	 * Get the current worktree state, if worktree mode is active.
	 */
	get currentWorktreeState(): WorktreeState | null {
		return this.worktreeState;
	}

	/**
	 * Get the worktree path, if worktree mode is active.
	 */
	get worktreePath(): string | null {
		return this.worktreeState?.worktreePath ?? null;
	}

	/**
	 * Get the base commit hash, if available.
	 */
	get baseCommit(): string | null {
		return this.worktreeState?.baseCommit ?? null;
	}

	/**
	 * Resolve the effective workspace root for agent execution.
	 * Returns the worktree path when mode is enabled, or the original root otherwise.
	 */
	getEffectiveWorkspaceRoot(): string {
		if (this.worktreeConfig.enabled && this.worktreeState) {
			return this.worktreeState.worktreePath;
		}
		return this.workspaceRoot;
	}

	/**
	 * Abort the current execution, if one is active.
	 */
	abort(): void {
		if (this.abortController && !this.abortController.signal.aborted) {
			this.abortController.abort();
		}
		if (this.lastExecutor) {
			this.lastExecutor.abort();
		}
	}

	/**
	 * Set the plan execution ID and workspace ID.
	 * Used when the executor is reused across different workspaces.
	 */
	setPlanExecutionId(id: string): void {
		this.planExecutionId = id;
	}

	/**
	 * Get the base commit (HEAD) of the main workspace.
	 * Throws if the workspace root is not a git repository.
	 */
	private async getBaseCommit(cwd: string): Promise<string> {
		try {
			return await git(["rev-parse", "HEAD"], cwd);
		} catch (err) {
			throw new Error(`Failed to get base commit in ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/**
	 * Get the worktree root directory for this plan execution and workspace.
	 */
	private getWorktreeRootDir(): string {
		const base = this.worktreeConfig.root ?? DEFAULT_WORKTREE_ROOT;
		const suffix = this.branchRetryCount > 0 ? `-r${this.branchRetryCount}` : "";
		return path.join(
			this.workspaceRoot,
			base,
			sanitizeForPath(this.planExecutionId),
			sanitizeForPath(this.workspaceId) + suffix,
		);
	}

	/**
	 * Ensure the git branch for this worktree exists, based at the current HEAD.
	 * Creates a lightweight branch if it doesn't exist yet.
	 *
	 * Uses a file-level lock to avoid git ref locking conflicts when multiple
	 * workers create branches concurrently. If the branch already exists,
	 * it is reset with -f under the same lock.
	 */
	private async ensureBranch(cwd: string, baseCommit: string): Promise<void> {
		// Use a file lock to serialise concurrent branch creation from parallel workers.
		// Git ref locks are per-process and don't coordinate across concurrent calls.
		const lockDir = path.join(cwd, ".pi", "worktree-branch-locks");
		await fs.mkdir(lockDir, { recursive: true });
		const lockPath = path.join(lockDir, `${sanitizeForPath(this.planExecutionId)}.lock`);

		// Acquire lock with retry
		for (let attempt = 1; attempt <= 30; attempt++) {
			try {
				await fs.writeFile(lockPath, this.workspaceId, { flag: "wx" });
				break; // lock acquired
			} catch {
				// Lock held by another worker — wait and retry
				await new Promise((r) => setTimeout(r, 200));
			}
		}

		try {
			// Check if the branch already exists
			// If conflict persists, increment retry count and use a unique branch name
			for (let retry = 0; retry < 20; retry++) {
				const currentBranch = retry === 0 ? this.branchName : `${this.branchName}-r${retry}`;
				const existing = await git(["branch", "--list", currentBranch], cwd);

				if (!existing) {
					// Fresh branch — create it
					await git(["branch", currentBranch, baseCommit], cwd);
					if (retry > 0) {
						this.branchName = currentBranch;
						this.branchRetryCount = retry;
					}
					break;
				}

				// Branch exists. Try to force-reset it. If it's used by a worktree,
				// skip to next retry with a unique name (preserving the old worktree's work).
				try {
					await git(["branch", "-f", currentBranch, baseCommit], cwd);
					break; // success, no conflict
				} catch {}
			}
		} catch (err) {
			throw new Error(
				`Failed to create branch ${this.branchName}: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			// Release lock
			try {
				await fs.unlink(lockPath);
			} catch {
				// Ignore cleanup errors
			}
		}
	}

	/**
	 * Create a git worktree for this workspace.
	 *
	 * Steps:
	 *   1. Get base commit from main checkout.
	 *   2. Create a branch for the worktree.
	 *   3. Create the worktree directory.
	 *   4. Run `git worktree add`.
	 *   5. Record worktree state.
	 *
	 * @returns The created worktree state.
	 */
	async createWorktree(): Promise<WorktreeCreateResult> {
		if (!this.worktreeConfig.enabled) {
			return {
				state: null as unknown as WorktreeState,
				created: false,
				error: "Worktree mode is disabled",
			};
		}

		const worktreeDir = this.getWorktreeRootDir();

		// Check if a worktree already exists at this path (reuse if so)
		const alreadyExists = await directoryExists(worktreeDir);
		if (alreadyExists) {
			// Check if there's a .git file pointing to a valid worktree
			try {
				const gitFilePath = path.join(worktreeDir, ".git");
				await fs.access(gitFilePath);
				const gitFileContent = await fs.readFile(gitFilePath, "utf-8");
				if (gitFileContent.startsWith("gitdir:")) {
					// Worktree already exists, return its state (reconstructed)
					const baseCommit = await this.getBaseCommit(this.workspaceRoot);
					const state: WorktreeState = {
						worktreePath: worktreeDir,
						baseCommit,
						branchName: this.branchName,
						workspaceId: this.workspaceId,
						planExecutionId: this.planExecutionId,
						createdAt: Date.now(),
						status: "created",
						statusChangedAt: Date.now(),
					};
					this.worktreeState = state;
					return { state, created: false };
				}
			} catch {
				// .git file doesn't exist or isn't valid, continue with creation
			}
		}

		// Ensure parent directories exist
		await fs.mkdir(path.dirname(worktreeDir), { recursive: true });

		// Get the base commit
		let baseCommit: string;
		try {
			baseCommit = await this.getBaseCommit(this.workspaceRoot);
		} catch (err) {
			return {
				state: null as unknown as WorktreeState,
				created: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}

		// Acquire a file-level lock around branch + worktree creation to prevent
		// git ref locking conflicts when multiple workers create worktrees concurrently.
		const lockDir = path.join(this.workspaceRoot, ".pi", "worktree-create-locks");
		await fs.mkdir(lockDir, { recursive: true });
		const lockPath = path.join(lockDir, `${sanitizeForPath(this.planExecutionId)}.lock`);

		for (let attempt = 1; attempt <= 60; attempt++) {
			try {
				await fs.writeFile(lockPath, this.workspaceId, { flag: "wx" });
				break;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}

		try {
			// Ensure the branch exists
			await this.ensureBranch(this.workspaceRoot, baseCommit);

			// Create the worktree
			await git(["worktree", "add", "--checkout", worktreeDir, this.branchName], this.workspaceRoot);
		} catch (err) {
			return {
				state: null as unknown as WorktreeState,
				created: false,
				error: `Failed to create git worktree: ${err instanceof Error ? err.message : String(err)}`,
			};
		} finally {
			// Release lock
			try {
				await fs.unlink(lockPath);
			} catch {}
		}

		const state: WorktreeState = {
			worktreePath: worktreeDir,
			baseCommit,
			branchName: this.branchName,
			workspaceId: this.workspaceId,
			planExecutionId: this.planExecutionId,
			createdAt: Date.now(),
			status: "active",
			statusChangedAt: Date.now(),
		};

		this.worktreeState = state;
		return { state, created: true };
	}

	/**
	 * Update the worktree status.
	 */
	private async updateWorktreeStatus(status: WorktreeStatus): Promise<void> {
		if (!this.worktreeState) return;
		this.worktreeState.status = status;
		this.worktreeState.statusChangedAt = Date.now();
	}

	/**
	 * Remove the worktree if it exists and worktree cleanup is desired.
	 * This is called after execution completes, either to clean up
	 * successful workspaces or to quarantine failed ones.
	 */
	async removeWorktree(quarantine: boolean = false): Promise<void> {
		if (!this.worktreeState) return;
		const worktreeDir = this.worktreeState.worktreePath;

		if (quarantine) {
			await this.updateWorktreeStatus("quarantined");
			return; // Don't remove, just mark as quarantined
		}

		try {
			await git(["worktree", "remove", "--force", worktreeDir], this.workspaceRoot);
			// Also remove the branch to keep things clean
			try {
				await git(["branch", "-D", this.branchName], this.workspaceRoot);
			} catch {
				// Ignore branch deletion errors
			}
			await this.updateWorktreeStatus("completed");
		} catch (err) {
			console.error(
				`[worktree-executor] Failed to remove worktree ${worktreeDir}:`,
				err instanceof Error ? err.message : String(err),
			);
		}

		// Prune stale worktree references
		try {
			await git(["worktree", "prune"], this.workspaceRoot);
		} catch {
			// Ignore prune errors
		}
	}

	/**
	 * Execute a workspace inside a git worktree (or the main checkout if disabled).
	 *
	 * @param packet - Hashed workspace packet
	 * @param workspaceRootOverride - Optional override for the workspace root (e.g., worktree path)
	 * @returns Worktree execution result
	 */
	async execute(packet: HashedPacket, workspaceRootOverride?: string): Promise<WorktreeExecutionResult> {
		const logs: string[] = [];
		const log = (message: string) => {
			const timestamp = new Date().toISOString();
			const logLine = `[${timestamp}] ${message}`;
			logs.push(logLine);
			console.log(`[worktree-executor] ${logLine}`);
		};

		try {
			if (this.worktreeConfig.enabled) {
				// --- Worktree mode ---
				log(`Worktree mode enabled for workspace ${this.workspaceId}`);

				// Create the worktree
				const createResult = await this.createWorktree();
				if (createResult.error) {
					log(`Failed to create worktree: ${createResult.error}`);
					return {
						success: false,
						verdict: "FAILED",
						error: createResult.error,
						logs,
					};
				}

				log(`Worktree created/reused at: ${createResult.state.worktreePath}`);
				log(`Base commit: ${createResult.state.baseCommit}`);
				log(`Branch: ${createResult.state.branchName}`);

				await this.updateWorktreeStatus("active");

				// Determine effective workspace root (worktree path)
				const effectiveRoot = workspaceRootOverride ?? createResult.state.worktreePath;

				// Create the agent executor with the worktree as workspace root
				const executorConfig: WorkspaceAgentExecutorConfig = {
					workspaceRoot: effectiveRoot,
					maxTurns: packet.packet.budget.maxInputTokens > 32000 ? 50 : 30,
				};

				this.lastExecutor = new WorkspaceAgentExecutor(executorConfig);
				log(`Agent executor created with workspace root: ${effectiveRoot}`);

				// Execute the agent
				const agentResult = await this.lastExecutor.execute(packet, this.workspaceId);

				// Update worktree status based on result
				if (agentResult.success) {
					await this.updateWorktreeStatus("completed");
				} else {
					await this.updateWorktreeStatus("failed");
				}

				log(`Agent execution completed: verdict=${agentResult.verdict}`);

				return {
					success: agentResult.success,
					verdict: agentResult.verdict,
					worktreeState: this.worktreeState ?? undefined,
					report: agentResult.report,
					error: agentResult.error,
					logs: [...logs, ...agentResult.logs],
				};
			} else {
				// --- Shared-working-tree mode (P5.5 fallback) ---
				log("Worktree mode disabled, using shared-working-tree execution");

				const effectiveRoot = workspaceRootOverride ?? this.workspaceRoot;
				const executorConfig: WorkspaceAgentExecutorConfig = {
					workspaceRoot: effectiveRoot,
					maxTurns: packet.packet.budget.maxInputTokens > 32000 ? 50 : 30,
				};

				this.lastExecutor = new WorkspaceAgentExecutor(executorConfig);
				log(`Agent executor created with workspace root: ${effectiveRoot}`);

				const agentResult = await this.lastExecutor.execute(packet, this.workspaceId);

				return {
					success: agentResult.success,
					verdict: agentResult.verdict,
					report: agentResult.report,
					error: agentResult.error,
					logs: [...logs, ...agentResult.logs],
				};
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log(`Execution error: ${errorMessage}`);

			// Update worktree status on failure
			if (this.worktreeState) {
				await this.updateWorktreeStatus("failed");
			}

			return {
				success: false,
				verdict: "FAILED",
				error: errorMessage,
				worktreeState: this.worktreeState ?? undefined,
				logs,
			};
		} finally {
			this.lastExecutor = null;
			this.abortController = null;
		}
	}
}

/**
 * Create a WorktreeWorkspaceExecutor.
 *
 * @param config - Executor configuration
 * @returns A new WorktreeWorkspaceExecutor
 */
export function createWorktreeWorkspaceExecutor(config: {
	workspaceRoot: string;
	planExecutionId: string;
	workspaceId: string;
	worktree?: WorktreeConfig;
	branchName?: string;
}): WorktreeWorkspaceExecutor {
	return new WorktreeWorkspaceExecutor(config);
}
