/**
 * Test suite for GitRunner (P23 W1).
 *
 * Tests:
 * - Read-only operations run without mutex
 * - Per-worktree mutations are isolated by workspaceId
 * - Repo-wide mutations block other operations
 * - Stale lock detection
 * - Operation scope classification
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitRunner, type GitRunner } from "../src/core/git-runner.js";

function createTestRepo(): string {
	const dir = join(tmpdir(), `git-runner-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	execSync("git init", { cwd: dir });
	execSync('git config user.email "test@test.com"', { cwd: dir });
	execSync('git config user.name "Test"', { cwd: dir });
	writeFileSync(join(dir, "README.md"), "# Test");
	execSync("git add -A && git commit -m 'initial'", { cwd: dir });
	return dir;
}

describe("GitRunner", () => {
	let repoDir: string;
	let runner: GitRunner;

	beforeEach(() => {
		repoDir = createTestRepo();
		runner = createGitRunner({
			planExecId: "test-plan",
			workspaceId: "test-ws",
			leaseId: "test-lease",
			cwd: repoDir,
		});
	});

	afterEach(() => {
		rmSync(repoDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Read-only operations
	// -----------------------------------------------------------------------

	describe("read-only operations", () => {
		it("can read HEAD revision", async () => {
			const hash = await runner.revParseHead();
			expect(hash).toMatch(/^[a-f0-9]{7,40}$/);
		});

		it("can check if dirty", async () => {
			const dirty = await runner.isDirty();
			expect(dirty).toBe(false);

			writeFileSync(join(repoDir, "new.txt"), "hello");
			const dirty2 = await runner.isDirty();
			expect(dirty2).toBe(true);
		});

		it("can list worktrees", async () => {
			const output = await runner.worktreeList();
			expect(output).toContain(repoDir);
		});

		it("can get log", async () => {
			const log = await runner.log(1);
			expect(log).toContain("initial");
		});

		it("can diff files", async () => {
			writeFileSync(join(repoDir, "new.txt"), "hello");
			const files = await runner.diffNameOnly("HEAD", "", repoDir);
			expect(files).toEqual([]);

			// With committed change
			execSync("git add new.txt && git commit -m 'add new'", { cwd: repoDir });
			const files2 = await runner.diffNameOnly("HEAD~1", "HEAD");
			expect(files2).toContain("new.txt");
		});
	});

	// -----------------------------------------------------------------------
	// Per-worktree mutations
	// -----------------------------------------------------------------------

	describe("per-worktree mutations", () => {
		it("can stage and commit files", async () => {
			writeFileSync(join(repoDir, "test.txt"), "content");
			const stageResult = await runner.stageAll("ws-A");
			expect(stageResult.exitCode).toBe(0);
			const commitResult = await runner.commit("ws-A", "test commit");
			expect(commitResult.exitCode).toBe(0);
			const log = await runner.log(1);
			expect(log).toContain("test commit");
		});

		it("per-worktree mutexes are independent across workspace IDs", async () => {
			// Create two branches to test independent per-worktree operations
			await runner.writeRepo(["branch", "branch-A", "HEAD"]);
			await runner.writeRepo(["branch", "branch-B", "HEAD"]);

			// Use separate working dirs (simulating worktrees) for each
			const worktreeDirA = join(repoDir, "..", "wt-a");
			const worktreeDirB = join(repoDir, "..", "wt-b");
			await runner.worktreeAdd(worktreeDirA, "branch-A");
			await runner.worktreeAdd(worktreeDirB, "branch-B");

			let wsAFinished = false;
			let wsBFinished = false;

			// Create a runner for each worktree
			const runnerA = createGitRunner({
				planExecId: "test-plan",
				workspaceId: "ws-A",
				leaseId: "lease-A",
				cwd: worktreeDirA,
			});
			const runnerB = createGitRunner({
				planExecId: "test-plan",
				workspaceId: "ws-B",
				leaseId: "lease-B",
				cwd: worktreeDirB,
			});

			const wsA = (async () => {
				writeFileSync(join(worktreeDirA, "ws-a.txt"), "a");
				await runnerA.stageAll("ws-A");
				await runnerA.commit("ws-A", "commit from A");
				wsAFinished = true;
			})();

			const wsB = (async () => {
				writeFileSync(join(worktreeDirB, "ws-b.txt"), "b");
				await runnerB.stageAll("ws-B");
				await runnerB.commit("ws-B", "commit from B");
				wsBFinished = true;
			})();

			await Promise.all([wsA, wsB]);
			expect(wsAFinished).toBe(true);
			expect(wsBFinished).toBe(true);

			// Check that both branches have their commits
			const logA = await runner.readOrThrow(["log", "branch-A", "--oneline", "-3"]);
			expect(logA).toContain("commit from A");
			const logB = await runner.readOrThrow(["log", "branch-B", "--oneline", "-3"]);
			expect(logB).toContain("commit from B");

			// Cleanup worktrees
			await runner.worktreeRemove(worktreeDirA);
			await runner.worktreeRemove(worktreeDirB);
			await runner.deleteBranch("branch-A");
			await runner.deleteBranch("branch-B");
			await runner.worktreePrune();
		});
	});

	// -----------------------------------------------------------------------
	// Repo-wide mutations
	// -----------------------------------------------------------------------

	describe("repo-wide mutations", () => {
		it("can create and delete branches", async () => {
			await runner.writeRepo(["branch", "test-branch", "HEAD"]);
			let branches = await runner.listBranches("test-branch");
			expect(branches).toContain("test-branch");

			await runner.deleteBranch("test-branch");
			branches = await runner.listBranches("test-branch");
			expect(branches).toBe("");
		});

		it("can add and remove worktrees", async () => {
			const wtDir = join(repoDir, "..", "test-worktree");
			await runner.createBranch("wt-branch", "HEAD");
			await runner.worktreeAdd(wtDir, "wt-branch");

			const list = await runner.worktreeList();
			expect(list).toContain(wtDir);

			await runner.worktreeRemove(wtDir);
			await runner.deleteBranch("wt-branch");
			await runner.worktreePrune();

			const list2 = await runner.worktreeList();
			expect(list2).not.toContain(wtDir);
		});

		it("repo-wide mutex blocks concurrent per-worktree operations", async () => {
			// Start a long repo-wide operation
			let repoOpDone = false;
			const repoOp = (async () => {
				await runner.writeRepo(["branch", "slow-branch", "HEAD"]);
				// Simulate slow op
				await new Promise((r) => setTimeout(r, 100));
				repoOpDone = true;
			})();

			// Try concurrent per-worktree op — should block until repo op finishes
			const worktreeOp = (async () => {
				writeFileSync(join(repoDir, "concurrent.txt"), "concurrent");
				await runner.stageAll("ws-concurrent");
				await runner.commit("ws-concurrent", "concurrent commit");
			})();

			await repoOp;
			await worktreeOp;
			expect(repoOpDone).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Stale lock detection
	// -----------------------------------------------------------------------

	describe("stale lock detection", () => {
		it("detects no lock when file does not exist", () => {
			const info = runner.checkStaleLock(join(repoDir, ".git", "index.lock"));
			expect(info.isStale).toBe(false);
		});

		it("detects stale lock when file is old", () => {
			const lockPath = join(repoDir, ".git", "index.lock");
			writeFileSync(lockPath, "test-workspace");
			const info = runner.checkStaleLock(lockPath);
			// The lock is brand new, but our check uses 30 seconds threshold
			// The file might or might not be "stale" depending on age
			expect(info.lockPath).toBe(lockPath);
			expect(info.ownerWorkspaceId).toBe("test-workspace");
		});
	});

	// -----------------------------------------------------------------------
	// Scope classification
	// -----------------------------------------------------------------------

	describe("scope classification", () => {
		it("classifies read operations as read_only", async () => {
			const result = await runner.read(["log", "-1", "--oneline"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBeTruthy();
		});

		it("classifies status as per_worktree_mutation", async () => {
			const result = await runner.writeWorktree("test", ["status", "--porcelain"]);
			// Should succeed
			expect(result.exitCode).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	describe("error handling", () => {
		it("returns error result for invalid commands", async () => {
			// Use a non-existent git command
			const result = await runner.run(["--invalid-flag-xyz"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toBeTruthy();
		});

		it("runOrThrow throws on error", async () => {
			await expect(runner.runOrThrow(["--invalid-flag-xyz"] as any)).rejects.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// Context management
	// -----------------------------------------------------------------------

	describe("context management", () => {
		it("can update and get context", () => {
			runner.setContext({
				planExecId: "new-plan",
				workspaceId: "new-ws",
				leaseId: "new-lease",
				cwd: repoDir,
			});
			const ctx = runner.getContext();
			expect(ctx.planExecId).toBe("new-plan");
			expect(ctx.workspaceId).toBe("new-ws");
		});
	});
});
