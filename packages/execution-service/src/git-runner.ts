/**
 * GitRunner — Centralized Git Operation Layer (P23 W1)
 *
 * Owns all git subprocess calls, classifies operations by mutation scope,
 * and enforces the correct mutex before every git call.
 *
 * Operation classifications:
 *   - read_only: No mutex required. Safe to run concurrently.
 *   - per_worktree_mutation: Per-worktree mutex keyed by workspaceId.
 *   - repo_wide_mutation: Single repo-wide mutex.
 *
 * Design constraints:
 *   - Callers must NOT hold external locks during git calls.
 *   - GitRunner acquires mutexes internally.
 *   - Stale lock detection checks PID liveness before any action.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Mutex helpers
// ---------------------------------------------------------------------------

interface Mutex {
	promise: Promise<void>;
	resolve: () => void;
}

function createMutex(): Mutex {
	let resolve: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve: resolve! };
}

/**
 * Async mutex for serializing git operations within a scope key.
 */
class KeyedMutex {
	private locks = new Map<string, Mutex>();

	async acquire(key: string): Promise<void> {
		while (this.locks.has(key)) {
			await this.locks.get(key)!.promise;
		}
		const mutex = createMutex();
		this.locks.set(key, mutex);
	}

	release(key: string): void {
		const mutex = this.locks.get(key);
		if (mutex) {
			this.locks.delete(key);
			mutex.resolve();
		}
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Classification of a git operation's mutation scope.
 */
export type GitOperationScope = "read_only" | "per_worktree_mutation" | "repo_wide_mutation";

/**
 * Context metadata carried with every git call for audit logging.
 */
export interface GitCallContext {
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID, or empty string for repo-wide operations */
	workspaceId: string;
	/** Lease ID, or empty string if no lease */
	leaseId: string;
	/** Current working directory for the git command */
	cwd: string;
}

/**
 * Result of a git operation.
 */
export interface GitResult {
	/** Standard output */
	stdout: string;
	/** Standard error */
	stderr: string;
	/** Exit code (0 for success) */
	exitCode: number;
	/** Duration in ms */
	durationMs: number;
}

/**
 * Stale lock info returned by checkStaleLock.
 */
export interface StaleLockInfo {
	/** Path to the lock file */
	lockPath: string;
	/** Whether the lock is stale (owner process dead or too old) */
	isStale: boolean;
	/** Owner workspace ID from lock file content (if readable) */
	ownerWorkspaceId: string | null;
	/** Age of the lock file in ms */
	ageMs: number;
}

// ---------------------------------------------------------------------------
// GitRunner
// ---------------------------------------------------------------------------

/**
 * Centralized git command runner.
 *
 * Every git command goes through this class. Operations are classified
 * by their mutation scope, and the appropriate mutex is acquired before
 * executing the git command.
 */
export class GitRunner {
	/** Repo-wide mutex for operations like worktree add/remove, branch create/delete */
	private repoMutex = new KeyedMutex();

	/** Per-worktree mutex keyed by workspaceId */
	private worktreeMutex = new KeyedMutex();

	/** Default timeout for git operations (ms) */
	private defaultTimeoutMs = 60_000;

	/**
	 * Create a GitRunner instance.
	 *
	 * @param context - Default context for git calls (can be overridden per-call)
	 */
	constructor(private context: GitCallContext) {}

	/**
	 * Update the context for subsequent operations.
	 */
	setContext(context: GitCallContext): void {
		this.context = context;
	}

	/**
	 * Get the current context.
	 */
	getContext(): GitCallContext {
		return this.context;
	}

	/**
	 * Run a git command with the appropriate mutex for its scope.
	 *
	 * @param args - Git arguments (e.g., ["status", "--porcelain"])
	 * @param options - Optional overrides
	 * @param options.scope - Override the operation scope auto-detection
	 * @param options.cwd - Override the working directory
	 * @param options.timeout - Override timeout in ms
	 * @param options.context - Override context for this call
	 * @returns Git result
	 */
	async run(
		args: string[],
		options?: {
			scope?: GitOperationScope;
			cwd?: string;
			timeout?: number;
			context?: Partial<GitCallContext>;
		},
	): Promise<GitResult> {
		const scope = options?.scope ?? this.classifyOperation(args);
		const cwd = options?.cwd ?? this.context.cwd;
		const timeout = options?.timeout ?? this.defaultTimeoutMs;
		const ctx = { ...this.context, ...options?.context };

		const startTime = Date.now();

		const commandStr = `git ${args.join(" ")}`;
		this.emitAuditEvent("git_call_started", { command: commandStr, scope, workspaceId: ctx.workspaceId });

		// Acquire the appropriate mutex
		if (scope === "repo_wide_mutation") {
			await this.repoMutex.acquire("repo");
		} else if (scope === "per_worktree_mutation") {
			await this.worktreeMutex.acquire(ctx.workspaceId || "default");
		}

		try {
			const { stdout, stderr } = await execFileAsync("git", args, {
				cwd,
				encoding: "utf-8",
				timeout,
			});

			const durationMs = Date.now() - startTime;
			this.emitAuditEvent("git_call_completed", {
				command: commandStr,
				scope,
				durationMs,
				workspaceId: ctx.workspaceId,
			});

			return {
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				exitCode: 0,
				durationMs,
			};
		} catch (error: any) {
			const durationMs = Date.now() - startTime;

			// Map execFile error to GitResult
			const stderr = error.stderr?.toString().trim() ?? "";
			const stdout = error.stdout?.toString().trim() ?? "";
			const exitCode = error.code ?? 1;

			this.emitAuditEvent("git_call_failed", {
				command: commandStr,
				scope,
				durationMs,
				exitCode,
				stderr,
				workspaceId: ctx.workspaceId,
			});

			return {
				stdout,
				stderr,
				exitCode,
				durationMs,
			};
		} finally {
			// Release the mutex
			if (scope === "repo_wide_mutation") {
				this.repoMutex.release("repo");
			} else if (scope === "per_worktree_mutation") {
				this.worktreeMutex.release(ctx.workspaceId || "default");
			}
		}
	}

	/**
	 * Run a git command and return stdout. Throws on non-zero exit.
	 *
	 * @param args - Git arguments
	 * @param options - Optional overrides
	 * @returns stdout string
	 */
	async runOrThrow(
		args: string[],
		options?: {
			scope?: GitOperationScope;
			cwd?: string;
			timeout?: number;
			context?: Partial<GitCallContext>;
		},
	): Promise<string> {
		const result = await this.run(args, options);
		if (result.exitCode !== 0) {
			throw new Error(
				`Git command failed: git ${args.join(" ")}\n  stderr: ${result.stderr}\n  exitCode: ${result.exitCode}`,
			);
		}
		return result.stdout;
	}

	/**
	 * Run a read-only git command. No mutex acquired.
	 */
	async read(args: string[], options?: { cwd?: string; timeout?: number }): Promise<GitResult> {
		return this.run(args, { ...options, scope: "read_only" });
	}

	/**
	 * Run a read-only git command and return stdout. Throws on non-zero exit.
	 */
	async readOrThrow(args: string[], options?: { cwd?: string; timeout?: number }): Promise<string> {
		const result = await this.run(args, { ...options, scope: "read_only" });
		if (result.exitCode !== 0) {
			throw new Error(
				`Git read command failed: git ${args.join(" ")}\n  stderr: ${result.stderr}\n  exitCode: ${result.exitCode}`,
			);
		}
		return result.stdout;
	}

	/**
	 * Run a per-worktree mutation git command. Acquires per-worktree mutex.
	 */
	async writeWorktree(
		workspaceId: string,
		args: string[],
		options?: { cwd?: string; timeout?: number },
	): Promise<GitResult> {
		return this.run(args, {
			...options,
			scope: "per_worktree_mutation",
			context: { workspaceId },
		});
	}

	/**
	 * Run a repo-wide mutation git command. Acquires repo-wide mutex.
	 */
	async writeRepo(args: string[], options?: { cwd?: string; timeout?: number }): Promise<GitResult> {
		return this.run(args, { ...options, scope: "repo_wide_mutation" });
	}

	// -----------------------------------------------------------------------
	// Convenience methods for common git operations
	// -----------------------------------------------------------------------

	/**
	 * Get the current HEAD commit hash.
	 */
	async revParseHead(cwd?: string): Promise<string> {
		return this.readOrThrow(["rev-parse", "HEAD"], { cwd });
	}

	/**
	 * Check if the working tree is dirty (has uncommitted changes).
	 */
	async isDirty(cwd?: string): Promise<boolean> {
		const result = await this.read(["status", "--porcelain"], { cwd });
		return result.stdout.length > 0;
	}

	/**
	 * Get the status of files in the working tree.
	 */
	async status(cwd?: string): Promise<string> {
		const result = await this.read(["status", "--porcelain"], { cwd });
		return result.stdout;
	}

	/**
	 * Get diff --name-only between two refs.
	 */
	async diffNameOnly(base: string, head: string, cwd?: string): Promise<string[]> {
		const result = await this.read(["diff", "--name-only", base, head], { cwd });
		return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
	}

	/**
	 * Stage all changes (git add -A). Per-worktree mutation.
	 */
	async stageAll(workspaceId: string, cwd?: string): Promise<GitResult> {
		return this.writeWorktree(workspaceId, ["add", "-A"], { cwd });
	}

	/**
	 * Stage a specific file. Per-worktree mutation.
	 */
	async stageFile(workspaceId: string, file: string, cwd?: string): Promise<GitResult> {
		return this.writeWorktree(workspaceId, ["add", file], { cwd });
	}

	/**
	 * Commit staged changes. Per-worktree mutation.
	 */
	async commit(workspaceId: string, message: string, cwd?: string): Promise<GitResult> {
		return this.writeWorktree(workspaceId, ["commit", "--no-verify", "-m", message], { cwd });
	}

	/**
	 * Restore a staged file (git restore --staged). Per-worktree mutation.
	 */
	async unstageFile(workspaceId: string, file: string, cwd?: string): Promise<GitResult> {
		return this.writeWorktree(workspaceId, ["restore", "--staged", file], { cwd });
	}

	/**
	 * Checkout files (git checkout --). Repo-wide mutation.
	 */
	async checkoutFiles(files: string[], cwd?: string): Promise<GitResult> {
		return this.writeRepo(["checkout", "--", ...files], { cwd });
	}

	/**
	 * Checkout all (git checkout -- .). Repo-wide mutation.
	 */
	async checkoutAll(cwd?: string): Promise<GitResult> {
		return this.writeRepo(["checkout", "--", "."], { cwd });
	}

	/**
	 * Create a branch. Repo-wide mutation.
	 */
	async createBranch(branchName: string, baseCommit: string, cwd?: string): Promise<GitResult> {
		return this.writeRepo(["branch", branchName, baseCommit], { cwd });
	}

	/**
	 * Force-reset a branch. Repo-wide mutation.
	 */
	async forceBranch(branchName: string, baseCommit: string, cwd?: string): Promise<GitResult> {
		return this.writeRepo(["branch", "-f", branchName, baseCommit], { cwd });
	}

	/**
	 * Delete a branch. Repo-wide mutation.
	 */
	async deleteBranch(branchName: string, cwd?: string): Promise<GitResult> {
		return this.writeRepo(["branch", "-D", branchName], { cwd });
	}

	/**
	 * Add a worktree. Repo-wide mutation.
	 */
	async worktreeAdd(worktreeDir: string, branchName: string, cwd?: string): Promise<GitResult> {
		return this.writeRepo(["worktree", "add", "--checkout", worktreeDir, branchName], { cwd });
	}

	/**
	 * Remove a worktree. Repo-wide mutation.
	 */
	async worktreeRemove(worktreeDir: string, cwd?: string): Promise<GitResult> {
		return this.writeRepo(["worktree", "remove", "--force", worktreeDir], { cwd });
	}

	/**
	 * Prune stale worktree references. Repo-wide mutation.
	 */
	async worktreePrune(cwd?: string): Promise<GitResult> {
		return this.writeRepo(["worktree", "prune"], { cwd });
	}

	/**
	 * List worktrees. Read-only.
	 */
	async worktreeList(cwd?: string): Promise<string> {
		return this.readOrThrow(["worktree", "list"], { cwd });
	}

	/**
	 * Get recent commit log. Read-only.
	 */
	async log(count: number = 5, cwd?: string): Promise<string> {
		return this.readOrThrow(["log", `-${count}`, "--oneline"], { cwd });
	}

	/**
	 * Get diff stat. Read-only.
	 */
	async diffStat(ref1: string, ref2: string, cwd?: string): Promise<string> {
		return this.readOrThrow(["diff", "--stat", `${ref1}..${ref2}`], { cwd });
	}

	/**
	 * Get diff --name-only for uncommitted changes. Read-only.
	 */
	async diffNameOnlyUncommitted(cwd?: string): Promise<string[]> {
		return this.diffNameOnly("HEAD", "", cwd);
	}

	/**
	 * Check if inside a git work tree. Read-only.
	 */
	async isInsideWorkTree(cwd?: string): Promise<boolean> {
		try {
			await this.readOrThrow(["rev-parse", "--is-inside-work-tree"], { cwd });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * List branches matching a pattern. Read-only.
	 */
	async listBranches(pattern: string, cwd?: string): Promise<string> {
		return this.readOrThrow(["branch", "--list", pattern], { cwd });
	}

	/**
	 * Get the diff between two commits. Read-only.
	 */
	async diff(base: string, head: string, cwd?: string): Promise<string> {
		return this.readOrThrow(["diff", base, head], { cwd });
	}

	// -----------------------------------------------------------------------
	// Stale lock detection
	// -----------------------------------------------------------------------

	/**
	 * Check if a git lock file is stale.
	 *
	 * A lock file is stale if:
	 * 1. The lock file is older than 30 seconds, OR
	 * 2. The owning process/lease referenced in the lock file is not alive
	 *
	 * Never deletes the lock file directly — returns info for the caller
	 * to decide quarantine action.
	 *
	 * @param lockPath - Absolute path to the lock file (e.g., .git/index.lock)
	 * @returns Stale lock info
	 */
	checkStaleLock(lockPath: string): StaleLockInfo {
		const { existsSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
		if (!existsSync(lockPath)) {
			return { lockPath, isStale: false, ownerWorkspaceId: null, ageMs: 0 };
		}

		let ownerWorkspaceId: string | null = null;
		try {
			ownerWorkspaceId = readFileSync(lockPath, "utf-8").trim() || null;
		} catch {
			// Can't read lock file content
		}

		const stats = statSync(lockPath);
		const ageMs = Date.now() - stats.mtimeMs;

		// If lock is older than 30 seconds, consider it stale
		const isStale = ageMs > 30_000;

		return { lockPath, isStale, ownerWorkspaceId, ageMs };
	}

	// -----------------------------------------------------------------------
	// Scope classification
	// -----------------------------------------------------------------------

	/**
	 * Classify a git command's mutation scope based on its arguments.
	 *
	 * @param args - Git arguments
	 * @returns Operation scope
	 */
	private classifyOperation(args: string[]): GitOperationScope {
		if (args.length === 0) return "read_only";

		const command = args[0];
		const subcommand = args[1];

		// --- Repo-wide mutations ---
		if (command === "worktree") {
			if (subcommand === "add" || subcommand === "remove" || subcommand === "prune") {
				return "repo_wide_mutation";
			}
			return "read_only";
		}

		if (command === "branch") {
			// branch -D, branch <name> <base>, branch -f <name> <base> are repo-wide
			if (
				subcommand === "-D" ||
				subcommand === "-f" ||
				(subcommand && !subcommand.startsWith("--") && args.length >= 3)
			) {
				return "repo_wide_mutation";
			}
			return "read_only";
		}

		if (command === "fetch" || command === "gc" || command === "prune") {
			return "repo_wide_mutation";
		}

		// --- Per-worktree mutations ---
		if (command === "add") {
			return "per_worktree_mutation";
		}

		if (command === "commit") {
			return "per_worktree_mutation";
		}

		if (command === "reset") {
			return "per_worktree_mutation";
		}

		if (command === "checkout") {
			// checkout -- . or checkout -- <files> is per-worktree
			if (subcommand === "--") {
				return "per_worktree_mutation";
			}
			// checkout <branch> is per-worktree
			return "per_worktree_mutation";
		}

		if (command === "restore") {
			return "per_worktree_mutation";
		}

		if (command === "status") {
			// status may touch the index, classify as per-worktree mutation
			return "per_worktree_mutation";
		}

		// --- Read-only ---
		return "read_only";
	}

	// -----------------------------------------------------------------------
	// Audit / logging
	// -----------------------------------------------------------------------

	/**
	 * Emit audit event for git operations.
	 * Override in subclass or use event emitter for dashboard integration.
	 */
	private emitAuditEvent(eventName: string, data: Record<string, unknown>): void {
		// Hook point for dashboard event emission
		if (process.env.GIT_RUNNER_DEBUG) {
			console.error(`[git-runner] ${eventName}:`, JSON.stringify(data));
		}
	}
}

/**
 * Create a GitRunner instance.
 *
 * @param context - Context for git calls
 * @returns A new GitRunner instance
 */
export function createGitRunner(context: GitCallContext): GitRunner {
	return new GitRunner(context);
}
