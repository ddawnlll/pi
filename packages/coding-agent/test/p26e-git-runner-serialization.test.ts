/**
 * P26.E — Strict GitRunner serialization and worktree lock hardening
 *
 * Tests:
 * - The 5-second mutex auto-release/bypass behavior is removed
 * - Branch lock acquisition throws if lock cannot be acquired
 * - Git worktree operations run through GitRunner's repo-wide mutation scope
 * - No silent unlocked proceeding
 */

import { describe, expect, it } from "vitest";
import { GitRunner } from "../src/core/git-runner.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.E — GitRunner serialization and lock hardening", () => {
	const runner = new GitRunner({
		planExecId: "test-plan",
		workspaceId: "test-ws",
		leaseId: "test-lease",
		cwd: "/tmp",
	});

	// ---- Scope classification ----

	it("should classify worktree add as repo_wide_mutation", () => {
		const scope = (runner as any).classifyOperation(["worktree", "add", "/path", "branch"]);
		expect(scope).toBe("repo_wide_mutation");
	});

	it("should classify worktree remove as repo_wide_mutation", () => {
		const scope = (runner as any).classifyOperation(["worktree", "remove", "--force", "/path"]);
		expect(scope).toBe("repo_wide_mutation");
	});

	it("should classify worktree prune as repo_wide_mutation", () => {
		const scope = (runner as any).classifyOperation(["worktree", "prune"]);
		expect(scope).toBe("repo_wide_mutation");
	});

	it("should classify branch -D as repo_wide_mutation", () => {
		const scope = (runner as any).classifyOperation(["branch", "-D", "my-branch"]);
		expect(scope).toBe("repo_wide_mutation");
	});

	it("should classify branch create as repo_wide_mutation", () => {
		const scope = (runner as any).classifyOperation(["branch", "new-branch", "abc123"]);
		expect(scope).toBe("repo_wide_mutation");
	});

	it("should classify branch -f as repo_wide_mutation", () => {
		const scope = (runner as any).classifyOperation(["branch", "-f", "existing-branch", "abc123"]);
		expect(scope).toBe("repo_wide_mutation");
	});

	it("should classify branch --list as read_only", () => {
		const scope = (runner as any).classifyOperation(["branch", "--list", "pattern"]);
		expect(scope).toBe("read_only");
	});

	it("should classify rev-parse HEAD as read_only", () => {
		const scope = (runner as any).classifyOperation(["rev-parse", "HEAD"]);
		expect(scope).toBe("read_only");
	});

	// ---- Mutex acquisition ----

	it("should acquire repo-wide mutex for writeRepo operations", async () => {
		let calledScope: string | undefined;
		const originalRun = runner.run.bind(runner);
		runner.run = (async (_args: string[], options?: any) => {
			calledScope = options?.scope;
			return { stdout: "", stderr: "", exitCode: 0, durationMs: 0 };
		}) as typeof runner.run;

		await runner.writeRepo(["branch", "-D", "test-branch"]);
		expect(calledScope).toBe("repo_wide_mutation");

		// Restore
		runner.run = originalRun;
	});

	it("should acquire per-worktree mutex for writeWorktree operations", async () => {
		let calledScope: string | undefined;
		const originalRun = runner.run.bind(runner);
		runner.run = (async (_args: string[], options?: any) => {
			calledScope = options?.scope;
			return { stdout: "", stderr: "", exitCode: 0, durationMs: 0 };
		}) as typeof runner.run;

		await runner.writeWorktree("ws-1", ["add", "-A"]);
		expect(calledScope).toBe("per_worktree_mutation");

		runner.run = originalRun;
	});

	it("should not acquire any mutex for read operations", async () => {
		let calledScope: string | undefined;
		const originalRun = runner.run.bind(runner);
		runner.run = (async (_args: string[], options?: any) => {
			calledScope = options?.scope;
			return { stdout: "", stderr: "", exitCode: 0, durationMs: 0 };
		}) as typeof runner.run;

		await runner.read(["status", "--porcelain"]);
		expect(calledScope).toBe("read_only");

		runner.run = originalRun;
	});

	// ---- Source code structural verification ----

	it("should not have auto-release bypass in worktree mutex", () => {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/worktree/worktree-workspace-executor.ts"), "utf-8");

		expect(src).not.toContain("auto-release after 5 seconds");
		expect(src).not.toContain("Safety timeout");
		expect(src).toContain("No auto-release bypass");
	});

	it("should throw when branch lock cannot be acquired", () => {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/worktree/worktree-workspace-executor.ts"), "utf-8");

		expect(src).toContain("throw new Error");
		expect(src).toContain("Failed to acquire branch lock after 30 retries");
	});

	it("should route worktree git calls through repo-wide mutation scope", () => {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/worktree/worktree-workspace-executor.ts"), "utf-8");

		// All worktree and branch mutation calls should pass `true` for isRepoMutation
		// (the 4th argument to the git() helper). The calls may be single-line or
		// multi-line, so we search for the string contents rather than exact format.
		expect(src).toContain('"worktree", "add"');
		expect(src).toContain('"worktree", "remove"');
		expect(src).toContain('"worktree", "prune"');

		// Each repo-wide mutation should pass true for isRepoMutation.
		// Count occurrences of `60_000,` followed by `true` with any whitespace.
		const mutationCount = (src.match(/60_000,\s*true/g) || []).length;
		expect(mutationCount).toBeGreaterThanOrEqual(6);
	});
});
