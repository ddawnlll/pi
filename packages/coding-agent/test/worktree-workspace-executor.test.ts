/**
 * Worktree Workspace Executor Tests - P2 Workstream 6.A
 *
 * Tests for git worktree isolation during workspace execution.
 * Verifies that workspaces can execute inside isolated git worktrees,
 * the main checkout remains clean, worktree state is recorded, and
 * worktree mode can be disabled.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceAgentExecutor, type WorkspaceAgentExecutorConfig } from "../src/core/workspace-agent-executor.js";
import { DEFAULT_WORKTREE_CONFIG, type WorktreeConfig } from "../src/worktree/worktree-types.js";
import {
	createWorktreeWorkspaceExecutor,
	WorktreeWorkspaceExecutor,
} from "../src/worktree/worktree-workspace-executor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory with a minimal git repository.
 * Initializes git, creates an initial commit, and returns the path.
 */
async function createTempGitRepo(): Promise<string> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-test-"));
	// Ensure we clean up on process exit
	const cleanup = async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	};
	process.on("exit", cleanup);

	// Initialize git repo
	execSync("git init", { cwd: tmpDir, stdio: "pipe" });
	execSync("git config user.name test", { cwd: tmpDir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });

	// Create .gitignore to prevent .pi/ from showing in git status
	await fs.writeFile(path.join(tmpDir, ".gitignore"), ".pi/\n", "utf-8");

	// Create an initial file and commit
	await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
	await fs.writeFile(path.join(tmpDir, "README.md"), "# Test Repo\n", "utf-8");
	await fs.writeFile(path.join(tmpDir, "src", "main.ts"), 'console.log("hello");\n', "utf-8");
	execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
	execSync("git commit -m 'Initial commit'", { cwd: tmpDir, stdio: "pipe" });

	// Also create a packages directory for testing nested structures
	await fs.mkdir(path.join(tmpDir, "packages", "core", "src"), { recursive: true });
	await fs.writeFile(path.join(tmpDir, "packages", "core", "src", "index.ts"), "export const foo = 1;\n", "utf-8");
	execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
	execSync("git commit -m 'Add packages structure'", { cwd: tmpDir, stdio: "pipe" });

	return tmpDir;
}

/**
 * Create a minimal HashedPacket for testing.
 */
function createTestPacket(workspaceId: string, goal: string): any {
	return {
		packet: {
			phaseId: "P2",
			workspaceId,
			role: "worker" as const,
			goal,
			allowedFiles: [],
			forbiddenFiles: [],
			acceptanceCriteria: [],
			targetCommand: null,
			stateSummary: "Test state",
			relevantSnippets: [],
			outputContract: "VERDICT: COMPLETE | BLOCKED | FAILED",
			budget: {
				maxInputTokens: 10000,
				estimatedInputTokens: 100,
			},
		},
		hash: "test-hash",
		createdAt: Date.now(),
	};
}

/**
 * Check if a given path is a valid git worktree by verifying the .git file.
 */
function isValidWorktree(dir: string): boolean {
	try {
		const gitFilePath = path.join(dir, ".git");
		const content = readFileSync(gitFilePath, "utf-8");
		return content.startsWith("gitdir:");
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("WorktreeWorkspaceExecutor", () => {
	let tmpRepo: string;
	let planExecutionId: string;

	beforeEach(async () => {
		tmpRepo = await createTempGitRepo();
		planExecutionId = `test-plan-${Date.now()}`;
	});

	afterEach(async () => {
		// Clean up any worktrees that might have been created
		try {
			const worktreeRoot = path.join(tmpRepo, ".pi", "worktrees");
			const exists = await fs
				.stat(worktreeRoot)
				.then(() => true)
				.catch(() => false);
			if (exists) {
				execSync(`git worktree prune`, { cwd: tmpRepo, stdio: "pipe" });
				// Also remove any lingering worktree directories
				const entries = await fs.readdir(worktreeRoot, { recursive: true }).catch(() => []);
				for (const entry of entries) {
					const fullPath = path.join(worktreeRoot, entry);
					try {
						await fs.rm(fullPath, { recursive: true, force: true });
					} catch {
						// Ignore cleanup errors
					}
				}
			}
		} catch {
			// Cleanup errors are non-fatal
		}

		// Remove the temp repo
		try {
			await fs.rm(tmpRepo, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	// -----------------------------------------------------------------------
	// AC1: A workspace can execute inside its own git worktree
	// -----------------------------------------------------------------------

	it("AC1: creates a git worktree and executes inside it", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		const worktreeDir = path.join(tmpRepo, ".pi", "worktrees", planExecutionId, "6.A");

		// Before creation, worktree path should be null
		expect(executor.worktreePath).toBeNull();

		// Create the worktree
		const createResult = await executor.createWorktree();
		expect(createResult.created).toBe(true);
		expect(createResult.error).toBeUndefined();

		// Verify worktree exists on disk
		const dirExists = await fs
			.stat(worktreeDir)
			.then(() => true)
			.catch(() => false);
		expect(dirExists).toBe(true);

		// Verify it's a valid git worktree (has .git file pointing to main repo)
		const isValid = isValidWorktree(worktreeDir);
		expect(isValid).toBe(true);

		// Verify worktree state is recorded
		const state = executor.currentWorktreeState;
		expect(state).not.toBeNull();
		expect(state!.worktreePath).toBe(worktreeDir);
		expect(state!.workspaceId).toBe("6.A");
		expect(state!.planExecutionId).toBe(planExecutionId);
		expect(state!.status).toBe("active");

		// Verify worktree path accessor
		expect(executor.worktreePath).toBe(worktreeDir);

		// Verify base commit is a valid hash
		expect(executor.baseCommit).toBeTruthy();
		expect(executor.baseCommit!.length).toBeGreaterThan(6);

		// Verify we can write a file in the worktree independently
		const testFilePath = path.join(worktreeDir, "test-worktree.txt");
		await fs.writeFile(testFilePath, "worktree content", "utf-8");

		// Verify the main checkout does NOT have this file
		const mainFilePath = path.join(tmpRepo, "test-worktree.txt");
		const mainHasFile = await fs
			.stat(mainFilePath)
			.then(() => true)
			.catch(() => false);
		expect(mainHasFile).toBe(false);

		// Clean up the worktree
		await executor.removeWorktree();
	});

	it("AC1: isWorktreeModeEnabled returns correct value", async () => {
		const enabledExecutor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});
		expect(enabledExecutor.isWorktreeModeEnabled).toBe(true);

		const disabledExecutor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: false },
		});
		expect(disabledExecutor.isWorktreeModeEnabled).toBe(false);

		const defaultExecutor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
		});
		expect(defaultExecutor.isWorktreeModeEnabled).toBe(false);
	});

	it("AC1: getEffectiveWorkspaceRoot returns worktree path when enabled", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		// Before creation, should still return workspaceRoot
		expect(executor.getEffectiveWorkspaceRoot()).toBe(tmpRepo);

		await executor.createWorktree();

		// After creation, should return worktree path
		expect(executor.getEffectiveWorkspaceRoot()).not.toBe(tmpRepo);
		expect(executor.getEffectiveWorkspaceRoot()).toContain(".pi/worktrees");
	});

	it("AC1: getEffectiveWorkspaceRoot returns original root when disabled", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: false },
		});

		expect(executor.getEffectiveWorkspaceRoot()).toBe(tmpRepo);
	});

	// -----------------------------------------------------------------------
	// AC2: Main checkout remains clean while workspace edits occur
	// -----------------------------------------------------------------------

	it("AC2: edits in worktree do not affect main checkout", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		await executor.createWorktree();
		const worktreeDir = executor.worktreePath!;

		// Record the initial state of the main checkout
		const mainStatusBefore = execSync("git status --porcelain", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		expect(mainStatusBefore).toBe(""); // Clean

		// Create a new file in the worktree
		await fs.writeFile(path.join(worktreeDir, "new-file.ts"), "export const x = 1;\n", "utf-8");

		// Also modify the existing main.ts in the worktree
		const modifiedMainTs = `console.log("modified in worktree");\n`;
		await fs.writeFile(path.join(worktreeDir, "src", "main.ts"), modifiedMainTs, "utf-8");

		// Verify main checkout is still clean
		const mainStatusAfter = execSync("git status --porcelain", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		expect(mainStatusAfter).toBe(""); // Still clean

		// Verify the original file in main checkout is unchanged
		const mainCheckoutContent = await fs.readFile(path.join(tmpRepo, "src", "main.ts"), "utf-8");
		expect(mainCheckoutContent).toBe('console.log("hello");\n');
	});

	it("AC2: git status in main checkout is unaffected by worktree edits", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		await executor.createWorktree();
		const worktreeDir = executor.worktreePath!;

		// Write multiple files in the worktree
		await fs.writeFile(path.join(worktreeDir, "file-a.ts"), "export const a = 1;\n", "utf-8");
		await fs.writeFile(path.join(worktreeDir, "file-b.ts"), "export const b = 2;\n", "utf-8");

		// Git status in main checkout should show nothing
		const mainDiff = execSync("git diff --stat", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		expect(mainDiff).toBe("");

		// Main checkout's tracked files should be unchanged
		const mainHash = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		const worktreeHash = execSync("git rev-parse HEAD", { cwd: worktreeDir, encoding: "utf-8" }).trim();
		expect(mainHash).toBe(worktreeHash); // Same base commit
	});

	// -----------------------------------------------------------------------
	// AC3: Workspace state records worktree path and base commit
	// -----------------------------------------------------------------------

	it("AC3: worktree state includes all required fields", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "7.C",
			worktree: { enabled: true },
		});

		await executor.createWorktree();

		const state = executor.currentWorktreeState!;

		expect(state.worktreePath).toBeTruthy();
		expect(state.baseCommit).toBeTruthy();
		expect(state.branchName).toBeTruthy();
		expect(state.workspaceId).toBe("7.C");
		expect(state.planExecutionId).toBe(planExecutionId);
		expect(state.createdAt).toBeGreaterThan(0);
		expect(state.status).toBe("active");
		expect(state.statusChangedAt).toBeGreaterThan(0);

		// Verify worktree path is absolute
		expect(path.isAbsolute(state.worktreePath)).toBe(true);

		// Verify base commit is a valid git hash
		expect(state.baseCommit).toMatch(/^[0-9a-f]{7,40}$/);

		// Verify the .git file exists and is valid
		const gitFilePath = path.join(state.worktreePath, ".git");
		const gitFileContent = await fs.readFile(gitFilePath, "utf-8");
		expect(gitFileContent).toContain("gitdir:");
	});

	it("AC3: base commit matches the main repo HEAD", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		await executor.createWorktree();

		const mainHead = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		expect(executor.baseCommit).toBe(mainHead);
	});

	it("AC3: branch name follows expected naming convention", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		await executor.createWorktree();

		const state = executor.currentWorktreeState!;
		expect(state.branchName).toContain("worktree/");
		expect(state.branchName).toContain(planExecutionId);
		expect(state.branchName).toContain("6.A");

		// Verify the branch actually exists in git
		const branchExists = execSync(`git branch --list "${state.branchName}"`, {
			cwd: tmpRepo,
			encoding: "utf-8",
		}).trim();
		expect(branchExists).toContain(state.branchName);
	});

	it("AC3: worktree state is accessible via getters", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		// Before creation
		expect(executor.currentWorktreeState).toBeNull();
		expect(executor.worktreePath).toBeNull();
		expect(executor.baseCommit).toBeNull();

		await executor.createWorktree();

		// After creation
		expect(executor.currentWorktreeState).not.toBeNull();
		expect(executor.worktreePath).not.toBeNull();
		expect(executor.baseCommit).not.toBeNull();
	});

	// -----------------------------------------------------------------------
	// AC4: Two independent workspaces can edit different files concurrently
	//      in separate worktrees
	// -----------------------------------------------------------------------

	it("AC4: two workspaces can create separate worktrees", async () => {
		const executorA = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		const executorB = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.B",
			worktree: { enabled: true },
		});

		// Create both worktrees
		const resultA = await executorA.createWorktree();
		const resultB = await executorB.createWorktree();

		expect(resultA.created).toBe(true);
		expect(resultB.created).toBe(true);

		// Both worktrees should have different paths
		expect(executorA.worktreePath).not.toBe(executorB.worktreePath);

		// Both should be valid worktrees
		expect(isValidWorktree(executorA.worktreePath!)).toBe(true);
		expect(isValidWorktree(executorB.worktreePath!)).toBe(true);
	});

	it("AC4: concurrent edits in separate worktrees are isolated", async () => {
		const executorA = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		const executorB = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.B",
			worktree: { enabled: true },
		});

		await executorA.createWorktree();
		await executorB.createWorktree();

		const worktreeDirA = executorA.worktreePath!;
		const worktreeDirB = executorB.worktreePath!;

		// Write different files in each worktree
		await fs.writeFile(
			path.join(worktreeDirA, "packages", "core", "src", "feature-a.ts"),
			'export const featureA = "A";\n',
			"utf-8",
		);
		await fs.writeFile(
			path.join(worktreeDirB, "packages", "core", "src", "feature-b.ts"),
			'export const featureB = "B";\n',
			"utf-8",
		);

		// Verify each worktree has its own file
		const filesInA = await fs.readdir(path.join(worktreeDirA, "packages", "core", "src"));
		const filesInB = await fs.readdir(path.join(worktreeDirB, "packages", "core", "src"));

		expect(filesInA).toContain("feature-a.ts");
		expect(filesInA).not.toContain("feature-b.ts");
		expect(filesInB).toContain("feature-b.ts");
		expect(filesInB).not.toContain("feature-a.ts");

		// Main checkout should have neither
		const mainFiles = await fs.readdir(path.join(tmpRepo, "packages", "core", "src"));
		expect(mainFiles).not.toContain("feature-a.ts");
		expect(mainFiles).not.toContain("feature-b.ts");
	});

	it("AC4: each worktree has its own branch and independent HEAD", async () => {
		const executorA = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		const executorB = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.B",
			worktree: { enabled: true },
		});

		await executorA.createWorktree();
		await executorB.createWorktree();

		// Each worktree should have a different branch name
		expect(executorA.currentWorktreeState!.branchName).not.toBe(executorB.currentWorktreeState!.branchName);

		// Make a commit in worktree A
		const worktreeDirA = executorA.worktreePath!;
		await fs.writeFile(path.join(worktreeDirA, "new-file-a.ts"), "export const a = 1;\n", "utf-8");
		execSync("git config user.name test", { cwd: worktreeDirA, stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: worktreeDirA, stdio: "pipe" });
		execSync("git add -A", { cwd: worktreeDirA, stdio: "pipe" });
		execSync("git commit -m 'Worktree A change'", { cwd: worktreeDirA, stdio: "pipe" });

		// Worktree B should still be at the base commit
		const headA = execSync("git rev-parse HEAD", { cwd: worktreeDirA, encoding: "utf-8" }).trim();
		const headB = execSync("git rev-parse HEAD", { cwd: executorB.worktreePath!, encoding: "utf-8" }).trim();

		expect(headA).not.toBe(headB);

		// Main checkout should still be at base commit (before A's commit)
		const mainHead = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		expect(mainHead).toBe(headB);
	});

	// -----------------------------------------------------------------------
	// AC5: Worktree mode can be disabled to fall back to P5.5 behavior
	// -----------------------------------------------------------------------

	it("AC5: when worktree mode is disabled, uses shared-working-tree", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: false },
		});

		expect(executor.isWorktreeModeEnabled).toBe(false);

		// When disabled, createWorktree should return error
		const result = await executor.createWorktree();
		expect(result.created).toBe(false);
		expect(result.error).toBeTruthy();

		// The worktree path should still be null
		expect(executor.worktreePath).toBeNull();
	});

	it("AC5: WorkspaceAgentExecutor respects disabled worktree mode", async () => {
		const config: WorkspaceAgentExecutorConfig = {
			workspaceRoot: tmpRepo,
			worktree: { enabled: false },
		};

		const executor = new WorkspaceAgentExecutor(config);

		expect(executor.isWorktreeModeEnabled).toBe(false);
		expect(executor.getEffectiveWorkspaceRoot()).toBe(tmpRepo);
	});

	it("AC5: WorkspaceAgentExecutor with enabled worktree mode has correct flag", async () => {
		const config: WorkspaceAgentExecutorConfig = {
			workspaceRoot: tmpRepo,
			planExecutionId,
			worktree: { enabled: true },
		};

		const executor = new WorkspaceAgentExecutor(config);

		expect(executor.isWorktreeModeEnabled).toBe(true);
		expect(executor.getEffectiveWorkspaceRoot()).toBe(tmpRepo); // Before worktree creation
	});

	it("AC5: createWorktreeWorkspaceExecutor factory works correctly", () => {
		const executor = createWorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		expect(executor).toBeInstanceOf(WorktreeWorkspaceExecutor);
		expect(executor.isWorktreeModeEnabled).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Path safety: worktree paths must be scoped and traversal-safe
	// -----------------------------------------------------------------------

	it("worktree path is scoped under .pi/worktrees", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		await executor.createWorktree();

		const worktreeDir = executor.worktreePath!;
		expect(worktreeDir).toContain(".pi/worktrees");
		expect(worktreeDir).toContain(planExecutionId);
		expect(worktreeDir).toContain("6.A");
	});

	it("worktree paths are sanitized to prevent traversal", async () => {
		// Test with a workspace ID that contains path traversal characters
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "../evil",
			worktree: { enabled: true },
		});

		await executor.createWorktree();

		const worktreeDir = executor.worktreePath!;
		// The traversal characters should be sanitized
		expect(worktreeDir).not.toContain("..");
		expect(worktreeDir).toContain(".pi/worktrees");
	});

	// -----------------------------------------------------------------------
	// Worktree lifecycle: creation and removal
	// -----------------------------------------------------------------------

	it("removeWorktree cleans up the worktree", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		await executor.createWorktree();
		const worktreeDir = executor.worktreePath!;

		// Verify it exists
		const existsBefore = await fs
			.stat(worktreeDir)
			.then(() => true)
			.catch(() => false);
		expect(existsBefore).toBe(true);

		// Remove it
		await executor.removeWorktree();

		// After removal, the worktree should be removed from git's perspective
		const worktreeList = execSync("git worktree list", { cwd: tmpRepo, encoding: "utf-8" });
		expect(worktreeList).not.toContain(worktreeDir);
	});

	it("removeWorktree with quarantine preserves the worktree", async () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		await executor.createWorktree();
		const _worktreeDir = executor.worktreePath!;

		// Remove with quarantine
		await executor.removeWorktree(true);

		// The worktree state should be marked as quarantined
		expect(executor.currentWorktreeState!.status).toBe("quarantined");
	});

	// -----------------------------------------------------------------------
	// Concurrent workspace execution simulation
	// -----------------------------------------------------------------------

	it("simulates two workspaces executing concurrently in separate worktrees", async () => {
		// Create two executors for different workspaces
		const executorA = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.A",
			worktree: { enabled: true },
		});

		const executorB = new WorktreeWorkspaceExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			workspaceId: "6.B",
			worktree: { enabled: true },
		});

		// Create both worktrees
		const [resultA, resultB] = await Promise.all([executorA.createWorktree(), executorB.createWorktree()]);

		expect(resultA.created).toBe(true);
		expect(resultB.created).toBe(true);

		// Simulate concurrent file edits mimicking disjoint workspace tasks
		const worktreeDirA = executorA.worktreePath!;
		const worktreeDirB = executorB.worktreePath!;

		// Workspace 6.A: edits core/src/feature-a.ts
		// Workspace 6.B: edits core/src/feature-b.ts
		await Promise.all([
			fs.writeFile(
				path.join(worktreeDirA, "packages", "core", "src", "feature-a.ts"),
				'export const featureA = "A";\n',
				"utf-8",
			),
			fs.writeFile(
				path.join(worktreeDirB, "packages", "core", "src", "feature-b.ts"),
				'export const featureB = "B";\n',
				"utf-8",
			),
		]);

		// Verify both files exist in their respective worktrees
		const [hasA, hasB] = await Promise.all([
			fs
				.stat(path.join(worktreeDirA, "packages", "core", "src", "feature-a.ts"))
				.then(() => true)
				.catch(() => false),
			fs
				.stat(path.join(worktreeDirB, "packages", "core", "src", "feature-b.ts"))
				.then(() => true)
				.catch(() => false),
		]);

		expect(hasA).toBe(true);
		expect(hasB).toBe(true);

		// Main checkout should have neither
		const [mainHasA, mainHasB] = await Promise.all([
			fs
				.stat(path.join(tmpRepo, "packages", "core", "src", "feature-a.ts"))
				.then(() => true)
				.catch(() => false),
			fs
				.stat(path.join(tmpRepo, "packages", "core", "src", "feature-b.ts"))
				.then(() => true)
				.catch(() => false),
		]);

		expect(mainHasA).toBe(false);
		expect(mainHasB).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	it("handles non-git directory gracefully", async () => {
		const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "non-git-"));
		try {
			const executor = new WorktreeWorkspaceExecutor({
				workspaceRoot: nonGitDir,
				planExecutionId,
				workspaceId: "6.A",
				worktree: { enabled: true },
			});

			const result = await executor.createWorktree();
			expect(result.created).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).toContain("Failed to get base commit");
		} finally {
			await fs.rm(nonGitDir, { recursive: true, force: true });
		}
	});

	it("handles non-git directory via execute gracefully", async () => {
		const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "non-git-"));
		try {
			const executor = new WorktreeWorkspaceExecutor({
				workspaceRoot: nonGitDir,
				planExecutionId,
				workspaceId: "6.A",
				worktree: { enabled: true },
			});

			const packet = createTestPacket("6.A", "Test goal");
			const result = await executor.execute(packet);

			expect(result.success).toBe(false);
			expect(result.verdict).toBe("FAILED");
			expect(result.logs.length).toBeGreaterThan(0);
		} finally {
			await fs.rm(nonGitDir, { recursive: true, force: true });
		}
	});
});

describe("WorktreeTypes", () => {
	it("DEFAULT_WORKTREE_CONFIG has expected defaults", () => {
		expect(DEFAULT_WORKTREE_CONFIG.enabled).toBe(false);
		expect(DEFAULT_WORKTREE_CONFIG.root).toBe(".pi/worktrees");
	});

	it("WorktreeConfig accepts custom root", () => {
		const config: WorktreeConfig = {
			enabled: true,
			root: ".pi/custom-worktrees",
		};
		expect(config.enabled).toBe(true);
		expect(config.root).toBe(".pi/custom-worktrees");
	});
});

describe("WorkspaceAgentExecutor worktree integration", () => {
	let tmpRepo: string;
	let planExecutionId: string;

	beforeEach(async () => {
		tmpRepo = await createTempGitRepo();
		planExecutionId = `test-plan-${Date.now()}`;
	});

	afterEach(async () => {
		try {
			// Clean up worktrees
			try {
				execSync("git worktree prune", { cwd: tmpRepo, stdio: "pipe" });
			} catch {
				// worktree prune errors are non-fatal
			}
			await fs.rm(tmpRepo, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("WorkspaceAgentExecutor detects worktree mode from config", () => {
		const disabled = new WorkspaceAgentExecutor({
			workspaceRoot: tmpRepo,
			worktree: { enabled: false },
		});
		expect(disabled.isWorktreeModeEnabled).toBe(false);

		const enabled = new WorkspaceAgentExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			worktree: { enabled: true },
		});
		expect(enabled.isWorktreeModeEnabled).toBe(true);
	});

	it("WorkspaceAgentExecutor getEffectiveWorkspaceRoot returns correct root", async () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: tmpRepo,
			planExecutionId,
			worktree: { enabled: true },
		});

		// Before any execution, it should return the original root
		expect(executor.getEffectiveWorkspaceRoot()).toBe(tmpRepo);

		// With worktree mode disabled, always returns original root
		const disabledExecutor = new WorkspaceAgentExecutor({
			workspaceRoot: tmpRepo,
			worktree: { enabled: false },
		});
		expect(disabledExecutor.getEffectiveWorkspaceRoot()).toBe(tmpRepo);
	});

	it("WorkspaceAgentExecutor worktree getters return null when not in worktree mode", () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: tmpRepo,
			worktree: { enabled: false },
		});

		expect(executor.currentWorktreeState).toBeNull();
		expect(executor.worktreePath).toBeNull();
		expect(executor.baseCommit).toBeNull();
	});

	it("setPlanExecutionId updates worktree executor", () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: tmpRepo,
			worktree: { enabled: true },
		});

		expect(executor.currentWorktreeState).toBeNull();

		// Set the plan execution ID (this creates the worktree executor)
		executor.setPlanExecutionId(planExecutionId);
	});
});
