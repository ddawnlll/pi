/**
 * Worktree Manager and Cleanup Tests - P2 Workstream 6.B
 *
 * Tests for:
 *   1. Failed worktree is preserved/quarantined for review (AC1)
 *   2. Completed worktree produces diff artifact (AC2)
 *   3. Cleanup refuses paths outside .pi/worktrees (AC3)
 *   4. Cleanup does not use raw destructive commands (AC4)
 *   5. Worktree list API shows status (AC5)
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktreeCleanup, WorktreeCleanup } from "../src/worktree/worktree-cleanup.js";
import { WorktreeManager } from "../src/worktree/worktree-manager.js";
import { DEFAULT_WORKTREE_ROOT, type WorktreeState } from "../src/worktree/worktree-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory with a minimal git repository.
 * Initializes git, creates an initial commit, and returns the path.
 */
async function createTempGitRepo(): Promise<string> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-mgr-test-"));
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

	// Create .gitignore
	await fs.writeFile(path.join(tmpDir, ".gitignore"), ".pi/\n", "utf-8");

	// Create initial files and commit
	await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
	await fs.writeFile(path.join(tmpDir, "README.md"), "# Test Repo\n", "utf-8");
	await fs.writeFile(path.join(tmpDir, "src", "main.ts"), 'console.log("hello");\n', "utf-8");
	execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
	execSync("git commit -m 'Initial commit'", { cwd: tmpDir, stdio: "pipe" });

	return tmpDir;
}

/**
 * Create a WorktreeState for testing.
 */
function createTestState(
	tmpRepo: string,
	planExecutionId: string,
	workspaceId: string,
	status: "created" | "active" | "completed" | "failed" | "quarantined" = "created",
): WorktreeState {
	const now = Date.now();
	return {
		worktreePath: path.join(tmpRepo, ".pi", "worktrees", planExecutionId, workspaceId),
		baseCommit: execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim(),
		branchName: `worktree/${planExecutionId}/${workspaceId}`,
		workspaceId,
		planExecutionId,
		createdAt: now,
		status,
		statusChangedAt: now,
	};
}

/**
 * Create an actual git worktree for testing.
 */
async function createActualWorktree(tmpRepo: string, planExecutionId: string, workspaceId: string): Promise<string> {
	const worktreeDir = path.join(tmpRepo, ".pi", "worktrees", planExecutionId, workspaceId);
	const branchName = `worktree/${planExecutionId}/${workspaceId}`;

	await fs.mkdir(path.dirname(worktreeDir), { recursive: true });

	// Create the branch if it doesn't exist
	const existing = execSync(`git branch --list "${branchName}"`, {
		cwd: tmpRepo,
		encoding: "utf-8",
	}).trim();
	if (!existing) {
		const baseCommit = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		execSync(`git branch "${branchName}" ${baseCommit}`, { cwd: tmpRepo, stdio: "pipe" });
	}

	// Create the worktree
	execSync(`git worktree add --checkout "${worktreeDir}" "${branchName}"`, {
		cwd: tmpRepo,
		stdio: "pipe",
	});

	return worktreeDir;
}

// ---------------------------------------------------------------------------
// Suite: WorktreeManager
// ---------------------------------------------------------------------------

describe("WorktreeManager", () => {
	let tmpRepo: string;
	let planExecutionId: string;
	let manager: WorktreeManager;

	beforeEach(async () => {
		tmpRepo = await createTempGitRepo();
		planExecutionId = `test-plan-${Date.now()}`;
		manager = new WorktreeManager(tmpRepo);
	});

	afterEach(async () => {
		// Clean up worktrees
		try {
			execSync("git worktree prune", { cwd: tmpRepo, stdio: "pipe" });
		} catch {
			// Ignore
		}
		try {
			await fs.rm(tmpRepo, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	// -----------------------------------------------------------------------
	// AC5: Worktree list API shows status
	// -----------------------------------------------------------------------

	it("AC5: list returns empty array when no worktrees are registered", () => {
		const entries = manager.list();
		expect(entries).toEqual([]);
	});

	it("AC5: list returns registered worktrees with correct status", () => {
		const stateA = createTestState(tmpRepo, planExecutionId, "6.A", "created");
		const stateB = createTestState(tmpRepo, planExecutionId, "6.B", "active");

		manager.register(stateA);
		manager.register(stateB);

		const entries = manager.list();

		expect(entries).toHaveLength(2);

		const entryA = entries.find((e) => e.workspaceId === "6.A");
		const entryB = entries.find((e) => e.workspaceId === "6.B");

		expect(entryA).toBeDefined();
		expect(entryA!.status).toBe("created");
		expect(entryA!.worktreePath).toBe(stateA.worktreePath);
		expect(entryA!.baseCommit).toBe(stateA.baseCommit);
		expect(entryA!.branchName).toBe(stateA.branchName);

		expect(entryB).toBeDefined();
		expect(entryB!.status).toBe("active");
	});

	it("AC5: list filters by plan execution ID when provided", () => {
		const stateA = createTestState(tmpRepo, "plan-1", "6.A", "created");
		const stateB = createTestState(tmpRepo, "plan-2", "6.B", "active");

		manager.register(stateA);
		manager.register(stateB);

		const plan1Entries = manager.list("plan-1");
		expect(plan1Entries).toHaveLength(1);
		expect(plan1Entries[0].planExecutionId).toBe("plan-1");

		const plan2Entries = manager.list("plan-2");
		expect(plan2Entries).toHaveLength(1);
		expect(plan2Entries[0].planExecutionId).toBe("plan-2");
	});

	it("AC5: list returns entries sorted by createdAt ascending", () => {
		const stateA = createTestState(tmpRepo, planExecutionId, "6.A", "created");
		const stateB = createTestState(tmpRepo, planExecutionId, "6.B", "active");

		// Give stateB a later timestamp
		stateB.createdAt = stateA.createdAt + 1000;

		manager.register(stateB); // Register B first
		manager.register(stateA); // Register A second

		const entries = manager.list();
		expect(entries).toHaveLength(2);
		expect(entries[0].workspaceId).toBe("6.A");
		expect(entries[1].workspaceId).toBe("6.B");
	});

	it("AC5: countByStatus returns correct counts", () => {
		manager.register(createTestState(tmpRepo, planExecutionId, "6.A", "created"));
		manager.register(createTestState(tmpRepo, planExecutionId, "6.B", "active"));
		manager.register(createTestState(tmpRepo, planExecutionId, "7.A", "completed"));
		manager.register(createTestState(tmpRepo, planExecutionId, "7.B", "failed"));

		const counts = manager.countByStatus(planExecutionId);
		expect(counts.created).toBe(1);
		expect(counts.active).toBe(1);
		expect(counts.completed).toBe(1);
		expect(counts.failed).toBe(1);
		expect(counts.quarantined).toBe(0);
	});

	it("AC5: countByStatus without filter returns all worktrees across plans", () => {
		manager.register(createTestState(tmpRepo, "plan-1", "6.A", "created"));
		manager.register(createTestState(tmpRepo, "plan-2", "6.B", "failed"));

		const counts = manager.countByStatus();
		expect(counts.created).toBe(1);
		expect(counts.failed).toBe(1);
	});

	// -----------------------------------------------------------------------
	// AC1: Failed worktree is preserved/quarantined for review
	// -----------------------------------------------------------------------

	it("AC1: failWorktree sets status to failed", async () => {
		const state = createTestState(tmpRepo, planExecutionId, "6.A", "active");
		manager.register(state);

		await manager.failWorktree(planExecutionId, "6.A");

		const entries = manager.list();
		expect(entries).toHaveLength(1);
		expect(entries[0].status).toBe("failed");
	});

	it("AC1: quarantineWorktree preserves worktree with quarantined status", async () => {
		const state = createTestState(tmpRepo, planExecutionId, "6.A", "failed");
		manager.register(state);

		await manager.quarantineWorktree(planExecutionId, "6.A");

		const entries = manager.list();
		expect(entries).toHaveLength(1);
		expect(entries[0].status).toBe("quarantined");
	});

	it("AC1: quarantined worktree remains in the list for review", async () => {
		const state = createTestState(tmpRepo, planExecutionId, "6.A", "active");
		manager.register(state);

		// Simulate failure then quarantine
		await manager.failWorktree(planExecutionId, "6.A");
		await manager.quarantineWorktree(planExecutionId, "6.A");

		const entries = manager.list();
		expect(entries).toHaveLength(1);
		expect(entries[0].status).toBe("quarantined");

		// Verify state is retrievable
		const retrieved = manager.getState(planExecutionId, "6.A");
		expect(retrieved).toBeDefined();
		expect(retrieved!.status).toBe("quarantined");
		expect(retrieved!.worktreePath).toBe(state.worktreePath);
	});

	it("AC1: fail and quarantine are idempotent", async () => {
		const state = createTestState(tmpRepo, planExecutionId, "6.A");
		manager.register(state);

		// Call multiple times
		await manager.failWorktree(planExecutionId, "6.A");
		await manager.failWorktree(planExecutionId, "6.A");
		await manager.quarantineWorktree(planExecutionId, "6.A");
		await manager.quarantineWorktree(planExecutionId, "6.A");

		expect(manager.getState(planExecutionId, "6.A")!.status).toBe("quarantined");
	});

	// -----------------------------------------------------------------------
	// AC2: Completed worktree produces diff artifact
	// -----------------------------------------------------------------------

	it("AC2: completeWorktree generates a diff artifact for a real worktree", async () => {
		// Create an actual git worktree and make a commit in it
		const worktreeDir = await createActualWorktree(tmpRepo, planExecutionId, "6.A");

		// Register with the manager
		const baseCommit = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		const state: WorktreeState = {
			worktreePath: worktreeDir,
			baseCommit,
			branchName: `worktree/${planExecutionId}/6.A`,
			workspaceId: "6.A",
			planExecutionId,
			createdAt: Date.now(),
			status: "active",
			statusChangedAt: Date.now(),
		};
		manager.register(state);

		// Make a change in the worktree and commit it
		await fs.writeFile(path.join(worktreeDir, "new-file.txt"), "added in worktree\n", "utf-8");
		execSync("git config user.name test", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git commit -m 'Worktree change'", { cwd: worktreeDir, stdio: "pipe" });

		// Complete the worktree with diff generation
		const artifact = await manager.completeWorktree(planExecutionId, "6.A");

		expect(artifact).toBeDefined();
		expect(artifact!.planExecutionId).toBe(planExecutionId);
		expect(artifact!.workspaceId).toBe("6.A");
		expect(artifact!.diff).toBeTruthy();
		expect(artifact!.diff).toContain("new-file.txt");

		// Status should be updated
		const stateAfter = manager.getState(planExecutionId, "6.A");
		expect(stateAfter!.status).toBe("completed");
	});

	it("AC2: completeWorktree with generateDiff=false skips diff", async () => {
		const worktreeDir = await createActualWorktree(tmpRepo, planExecutionId, "6.A");
		const baseCommit = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		const state: WorktreeState = {
			worktreePath: worktreeDir,
			baseCommit,
			branchName: `worktree/${planExecutionId}/6.A`,
			workspaceId: "6.A",
			planExecutionId,
			createdAt: Date.now(),
			status: "active",
			statusChangedAt: Date.now(),
		};
		manager.register(state);

		const artifact = await manager.completeWorktree(planExecutionId, "6.A", false);
		expect(artifact).toBeUndefined();

		const stateAfter = manager.getState(planExecutionId, "6.A");
		expect(stateAfter!.status).toBe("completed");
	});

	it("AC2: diff artifact lists in WorktreeListEntry when present", async () => {
		const worktreeDir = await createActualWorktree(tmpRepo, planExecutionId, "6.A");
		const baseCommit = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		const state: WorktreeState = {
			worktreePath: worktreeDir,
			baseCommit,
			branchName: `worktree/${planExecutionId}/6.A`,
			workspaceId: "6.A",
			planExecutionId,
			createdAt: Date.now(),
			status: "active",
			statusChangedAt: Date.now(),
		};
		manager.register(state);

		// Make a change
		await fs.writeFile(path.join(worktreeDir, "feature.ts"), "export const x = 1;\n", "utf-8");
		execSync("git config user.name test", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git commit -m 'Feature change'", { cwd: worktreeDir, stdio: "pipe" });

		await manager.completeWorktree(planExecutionId, "6.A");

		const entries = manager.list();
		expect(entries[0].diffArtifact).toBeTruthy();
		expect(entries[0].diffArtifact).toContain(".patch");
	});

	it("AC2: generateDiffArtifact returns undefined for untracked worktree", async () => {
		const artifact = await manager.generateDiffArtifact("nonexistent", "6.A");
		expect(artifact).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// Path safety: updateStatus and getState
	// -----------------------------------------------------------------------

	it("updateStatus updates existing worktree state", () => {
		const state = createTestState(tmpRepo, planExecutionId, "6.A", "created");
		manager.register(state);

		state.status = "active";
		state.statusChangedAt = Date.now() + 100;
		manager.updateStatus(state);

		const retrieved = manager.getState(planExecutionId, "6.A");
		expect(retrieved).toBeDefined();
		expect(retrieved!.status).toBe("active");
		expect(retrieved!.statusChangedAt).toBe(state.statusChangedAt);
	});

	it("updateStatus registers state if not already tracked", () => {
		const state = createTestState(tmpRepo, planExecutionId, "6.A", "active");
		manager.updateStatus(state);

		const retrieved = manager.getState(planExecutionId, "6.A");
		expect(retrieved).toBeDefined();
		expect(retrieved!.status).toBe("active");
	});

	it("getState returns undefined for unregistered worktree", () => {
		const retrieved = manager.getState("nonexistent", "6.A");
		expect(retrieved).toBeUndefined();
	});

	it("clear removes all tracked state", () => {
		manager.register(createTestState(tmpRepo, planExecutionId, "6.A"));
		manager.register(createTestState(tmpRepo, planExecutionId, "6.B"));
		expect(manager.list()).toHaveLength(2);

		manager.clear();
		expect(manager.list()).toHaveLength(0);
	});

	it("worktreeStorageRoot returns correct absolute path", () => {
		expect(manager.worktreeStorageRoot).toBe(path.resolve(tmpRepo, ".pi", "worktrees"));
	});

	it("worktreeStorageRoot respects custom root override", () => {
		const customManager = new WorktreeManager(tmpRepo, ".pi/custom-worktrees");
		expect(customManager.worktreeStorageRoot).toBe(path.resolve(tmpRepo, ".pi", "custom-worktrees"));
	});
});

// ---------------------------------------------------------------------------
// Suite: WorktreeCleanup
// ---------------------------------------------------------------------------

describe("WorktreeCleanup", () => {
	let tmpRepo: string;
	let planExecutionId: string;

	beforeEach(async () => {
		tmpRepo = await createTempGitRepo();
		planExecutionId = `test-cleanup-${Date.now()}`;
	});

	afterEach(async () => {
		try {
			execSync("git worktree prune", { cwd: tmpRepo, stdio: "pipe" });
		} catch {
			// Ignore
		}
		try {
			await fs.rm(tmpRepo, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	// -----------------------------------------------------------------------
	// AC3: Cleanup refuses paths outside .pi/worktrees
	// -----------------------------------------------------------------------

	it("AC3: validatePath accepts paths inside .pi/worktrees", () => {
		const cleanup = new WorktreeCleanup(tmpRepo);
		const safePath = path.join(tmpRepo, ".pi", "worktrees", "plan-1", "6.A");

		// Should not throw
		expect(() => cleanup.validatePath(safePath)).not.toThrow();
	});

	it("AC3: validatePath rejects paths outside .pi/worktrees", () => {
		const cleanup = new WorktreeCleanup(tmpRepo);
		const outsidePath = path.join(tmpRepo, "src");

		expect(() => cleanup.validatePath(outsidePath)).toThrow();
		expect(() => cleanup.validatePath(outsidePath)).toThrow(/outside allowed worktree root/);
	});

	it("AC3: validatePath rejects paths with traversal escaping .pi/worktrees", () => {
		const cleanup = new WorktreeCleanup(tmpRepo);
		const traversalPath = path.join(tmpRepo, ".pi", "worktrees", "..", "..", "src");

		expect(() => cleanup.validatePath(traversalPath)).toThrow();
	});

	it("AC3: validatePath rejects paths completely outside project root", () => {
		const cleanup = new WorktreeCleanup(tmpRepo);
		const etcPath = "/etc/passwd";

		expect(() => cleanup.validatePath(etcPath)).toThrow();
	});

	it("AC3: validatePath accepts custom worktree root when configured", () => {
		const cleanup = new WorktreeCleanup(tmpRepo, ".pi/custom-worktrees");
		const safePath = path.join(tmpRepo, ".pi", "custom-worktrees", "plan-1", "6.A");

		expect(() => cleanup.validatePath(safePath)).not.toThrow();

		// But rejects the default root
		const defaultPath = path.join(tmpRepo, ".pi", "worktrees", "plan-1", "6.A");
		expect(() => cleanup.validatePath(defaultPath)).toThrow();
	});

	it("AC3: removeWorktree refuses paths outside allowed root", async () => {
		const cleanup = new WorktreeCleanup(tmpRepo);
		const outsidePath = path.join(tmpRepo, "src");

		const result = await cleanup.removeWorktree(outsidePath);
		expect(result.success).toBe(false);
		expect(result.error).toContain("outside allowed worktree root");
	});

	it("AC3: removeAll reports errors for paths outside allowed root", async () => {
		const cleanup = new WorktreeCleanup(tmpRepo);

		const results = await cleanup.removeAll([
			path.join(tmpRepo, ".pi", "worktrees", "plan-1", "6.A"),
			path.join(tmpRepo, "src"),
			path.join(tmpRepo, "etc"),
		]);

		expect(results).toHaveLength(3);
		expect(results[0].success).toBe(false); // Doesn't exist but path is valid
		expect(results[1].success).toBe(false); // Path outside root
		expect(results[1].error).toContain("outside allowed worktree root");
		expect(results[2].success).toBe(false); // Path outside root
		expect(results[2].error).toContain("outside allowed worktree root");
	});

	// -----------------------------------------------------------------------
	// AC4: Cleanup does not use raw destructive commands
	// -----------------------------------------------------------------------

	it("AC4: removeWorktree uses git worktree remove (not rm -rf)", async () => {
		// Create an actual worktree
		const worktreeDir = await createActualWorktree(tmpRepo, planExecutionId, "6.A");
		const branchName = `worktree/${planExecutionId}/6.A`;

		const cleanup = new WorktreeCleanup(tmpRepo);
		const result = await cleanup.removeWorktree(worktreeDir, branchName);

		expect(result.success).toBe(true);

		// Verify the worktree was removed via git
		const worktreeList = execSync("git worktree list", { cwd: tmpRepo, encoding: "utf-8" });
		expect(worktreeList).not.toContain(worktreeDir);

		// Verify the branch was also removed
		const branchExists = execSync(`git branch --list "${branchName}"`, {
			cwd: tmpRepo,
			encoding: "utf-8",
		}).trim();
		expect(branchExists).toBe("");
	});

	it("AC4: removeAll uses git worktree remove for each worktree", async () => {
		const dirA = await createActualWorktree(tmpRepo, planExecutionId, "6.A");
		const dirB = await createActualWorktree(tmpRepo, planExecutionId, "6.B");

		const cleanup = new WorktreeCleanup(tmpRepo);
		const results = await cleanup.removeAll(
			[dirA, dirB],
			[`worktree/${planExecutionId}/6.A`, `worktree/${planExecutionId}/6.B`],
		);

		expect(results).toHaveLength(2);
		expect(results[0].success).toBe(true);
		expect(results[1].success).toBe(true);

		// Verify both are gone
		const worktreeList = execSync("git worktree list", { cwd: tmpRepo, encoding: "utf-8" });
		expect(worktreeList).not.toContain(dirA);
		expect(worktreeList).not.toContain(dirB);
	});

	it("AC4: code review - no rm -rf in source", async () => {
		const source = await fs.readFile(path.join(__dirname, "..", "src", "worktree", "worktree-cleanup.ts"), "utf-8");
		// The source should not contain raw shell rm commands used in method bodies.
		// Doc comments referencing rm -rf as something to avoid are fine.
		// Strip comments to check only code (not doc comments)
		const codeWithoutComments = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
		expect(codeWithoutComments).not.toContain("rm -rf");
		expect(codeWithoutComments).not.toContain("rm -r");
		expect(codeWithoutComments).not.toContain("rimraf");
	});

	// -----------------------------------------------------------------------
	// WorktreeManager integration with WorktreeCleanup
	// -----------------------------------------------------------------------

	it("cleanupCompletedWorktree delegates to WorktreeCleanup", async () => {
		const worktreeDir = await createActualWorktree(tmpRepo, planExecutionId, "6.A");
		const baseCommit = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		const state: WorktreeState = {
			worktreePath: worktreeDir,
			baseCommit,
			branchName: `worktree/${planExecutionId}/6.A`,
			workspaceId: "6.A",
			planExecutionId,
			createdAt: Date.now(),
			status: "completed",
			statusChangedAt: Date.now(),
		};
		const manager = new WorktreeManager(tmpRepo);
		manager.register(state);

		// Make a change and commit so git worktree remove has something to clean
		await fs.writeFile(path.join(worktreeDir, "cleanup-test.txt"), "test\n", "utf-8");
		execSync("git config user.name test", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git commit -m 'Cleanup test'", { cwd: worktreeDir, stdio: "pipe" });

		const result = await manager.cleanupCompletedWorktree(planExecutionId, "6.A");
		expect(result.success).toBe(true);
		expect(result.path).toBe(worktreeDir);

		// Verify worktree is gone
		const worktreeList = execSync("git worktree list", { cwd: tmpRepo, encoding: "utf-8" });
		expect(worktreeList).not.toContain(worktreeDir);
	});

	it("cleanupCompletedWorktree returns error for untracked worktree", async () => {
		const manager = new WorktreeManager(tmpRepo);
		const result = await manager.cleanupCompletedWorktree("nonexistent", "6.A");
		expect(result.success).toBe(false);
		expect(result.error).toContain("Worktree not found");
	});

	it("cleanupQuarantinedWorktree delegates to WorktreeCleanup", async () => {
		const worktreeDir = await createActualWorktree(tmpRepo, planExecutionId, "6.A");
		const baseCommit = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
		const state: WorktreeState = {
			worktreePath: worktreeDir,
			baseCommit,
			branchName: `worktree/${planExecutionId}/6.A`,
			workspaceId: "6.A",
			planExecutionId,
			createdAt: Date.now(),
			status: "quarantined",
			statusChangedAt: Date.now(),
		};
		const manager = new WorktreeManager(tmpRepo);
		manager.register(state);

		await fs.writeFile(path.join(worktreeDir, "quarantine-test.txt"), "test\n", "utf-8");
		execSync("git config user.name test", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" });
		execSync("git commit -m 'Quarantine test'", { cwd: worktreeDir, stdio: "pipe" });

		const result = await manager.cleanupQuarantinedWorktree(planExecutionId, "6.A");
		expect(result.success).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Factory functions
	// -----------------------------------------------------------------------

	it("createWorktreeCleanup factory works correctly", () => {
		const cleanup = createWorktreeCleanup(tmpRepo);
		expect(cleanup).toBeInstanceOf(WorktreeCleanup);
		expect(cleanup.allowedRoot).toBe(path.resolve(tmpRepo, DEFAULT_WORKTREE_ROOT));
	});
});
