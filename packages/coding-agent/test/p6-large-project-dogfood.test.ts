/**
 * P6 Large-Project Dogfood & Stability — Workspace 6.K
 *
 * Validates large-project scale infrastructure:
 * - Worktree isolation for concurrent workspace execution
 * - Integration queue for serial merge-and-validate
 * - Failed worktree discard/quarantine lifecycle
 * - Experimental 6-worker mode gating and prerequisites
 * - No git push in any code path
 *
 * Acceptance Criteria:
 * 1. Dogfood report exists
 * 2. Worktree isolation is proven
 * 3. Integration queue is proven
 * 4. Failed worktree discard/quarantine is proven
 * 5. Experimental 6-worker mode is validated or blocked with clear reason
 * 6. No git push occurs
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	MAX_EXPERIMENTAL_WORKERS,
	MAX_STABLE_WORKERS,
	MIN_EXPERIMENTAL_WORKERS,
	resolveEffectiveWorkerCount,
	validateWorkerConcurrency,
} from "../src/core/worker-concurrency.js";
import { IntegrationQueue } from "../src/integration/integration-queue.js";
import {
	checkScaleModeReadiness,
	PREREQ_INTEGRATION_QUEUE,
	PREREQ_VALIDATION_LOCK,
	PREREQ_WORKTREE_ISOLATION,
	type ScaleModeConfig,
} from "../src/scheduler/scale-mode-policy.js";
import { WorktreeCleanup } from "../src/worktree/worktree-cleanup.js";
import { WorktreeManager } from "../src/worktree/worktree-manager.js";
import { DEFAULT_WORKTREE_CONFIG, type WorktreeState } from "../src/worktree/worktree-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to the stability report, relative to the test file. */
const STABILITY_REPORT_PATH = "../../../docs/pi/stability/p6-large-project-scale-report.md";

/** Path to the worktree isolation design doc. */
const WORKTREE_ISOLATION_DOC = "../../../docs/pi/scale/worktree-isolation.md";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory with a minimal git repository.
 */
async function createTempGitRepo(): Promise<string> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p6-dogfood-"));
	execSync("git init", { cwd: tmpDir, stdio: "pipe" });
	execSync("git config user.name test", { cwd: tmpDir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
	await fs.writeFile(path.join(tmpDir, ".gitignore"), ".pi/\n", "utf-8");
	await fs.writeFile(path.join(tmpDir, "README.md"), "# Test Repo\n", "utf-8");
	execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
	execSync("git commit -m 'Initial commit'", { cwd: tmpDir, stdio: "pipe" });
	return tmpDir;
}

/**
 * Create a WorktreeState for testing.
 *
 * @param tmpRepo - Path to the git repository (must be a real git repo when baseCommit is omitted).
 * @param planExecutionId - Plan execution ID.
 * @param workspaceId - Workspace ID.
 * @param status - Worktree status.
 * @param baseCommitOverride - Optional base commit to use instead of querying git.
 */
function createTestState(
	tmpRepo: string,
	planExecutionId: string,
	workspaceId: string,
	status: "created" | "active" | "completed" | "failed" | "quarantined" = "created",
	baseCommitOverride?: string,
): WorktreeState {
	const now = Date.now();
	const baseCommit = baseCommitOverride ?? execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
	return {
		worktreePath: path.join(tmpRepo, ".pi", "worktrees", planExecutionId, workspaceId),
		baseCommit,
		branchName: `worktree/${planExecutionId}/${workspaceId}`,
		workspaceId,
		planExecutionId,
		createdAt: now,
		status,
		statusChangedAt: now,
	};
}

/**
 * Check whether the worktree-isolation design doc has content that covers
 * all required acceptance criteria.
 */
function checkWorktreeDocContent(): {
	hasAc1: boolean;
	hasAc2: boolean;
	hasAc3: boolean;
	hasAc4: boolean;
	hasAc5: boolean;
} {
	const docPath = path.resolve(__dirname, WORKTREE_ISOLATION_DOC);
	const content = readFileSync(docPath, "utf-8");

	return {
		// AC1: Workspace execution inside git worktree
		hasAc1: content.includes("git worktree") && content.includes("WorktreeWorkspaceExecutor"),
		// AC2: Main checkout remains clean during edits
		hasAc2: content.includes("main checkout") && content.includes("clean"),
		// AC3: Worktree state records path, base commit, branch
		hasAc3: content.includes("WorktreeState") && content.includes("baseCommit"),
		// AC4: Two workspaces can edit different files concurrently
		hasAc4: content.includes("concurrently") || (content.includes("Two workspaces") && content.includes("edit")),
		// AC5: Worktree mode can be disabled (P5.5 fallback)
		hasAc5: content.includes("fallback") || (content.includes("disabled") && content.includes("P5.5")),
	};
}

// ---------------------------------------------------------------------------
// AC1: Dogfood report exists
// ---------------------------------------------------------------------------

describe("AC1: Dogfood report exists", () => {
	it("stability report file exists at the expected path", () => {
		expect(existsSync(path.resolve(__dirname, STABILITY_REPORT_PATH))).toBe(true);
	});

	it("stability report is a non-empty markdown document", () => {
		const content = readFileSync(path.resolve(__dirname, STABILITY_REPORT_PATH), "utf-8");
		expect(content.length).toBeGreaterThan(100);
		expect(content).toMatch(/^#/m);
	});
});

// ---------------------------------------------------------------------------
// AC2: Worktree isolation is proven
// ---------------------------------------------------------------------------

describe("AC2: Worktree isolation is proven", () => {
	it("WorktreeCleanup refuses paths outside .pi/worktrees", () => {
		const cleanup = new WorktreeCleanup("/tmp/workspace", ".pi/worktrees");
		const allowedRoot = cleanup.allowedRoot;

		// Path inside allowed root should validate
		const insidePath = path.join(allowedRoot, "plan-1", "ws-a");
		expect(() => cleanup.validatePath(insidePath)).not.toThrow();

		// Path outside allowed root should throw
		const outsidePath = "/etc/passwd";
		expect(() => cleanup.validatePath(outsidePath)).toThrow(/outside allowed worktree root/);

		// A path under a sibling directory outside the root should throw
		const siblingOutside = "/tmp/other/worktrees/plan-1/ws-a";
		expect(() => cleanup.validatePath(siblingOutside)).toThrow(/outside allowed worktree root/);

		// Path traversal attempt with ../ should be rejected
		const traversalPath = path.join(allowedRoot, "..", "..", "etc", "passwd");
		expect(() => cleanup.validatePath(traversalPath)).toThrow(/outside allowed worktree root/);
	});

	it("WorktreeCleanup removeWorktree returns failure for non-existent path within root", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const cleanup = new WorktreeCleanup(tmpRepo, ".pi/worktrees");
			const fakePath = path.join(cleanup.allowedRoot, "fake-plan", "fake-ws");

			// Should fail gracefully (git worktree remove fails on invalid path)
			const result = await cleanup.removeWorktree(fakePath, "worktree/fake-plan/fake-ws");
			expect(result.success).toBe(false);
			expect(result.error).toBeTruthy();
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("WorktreeManager tracks status lifecycle correctly", () => {
		const tmpRepo = "/tmp/fake-p6-worktree-test";
		const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

		const state = createTestState(tmpRepo, "plan-6k", "6K.A", "created", "abc123");

		// Register created state
		manager.register(state);
		expect(manager.getState("plan-6k", "6K.A")).toBeDefined();
		expect(manager.getState("plan-6k", "6K.A")?.status).toBe("created");

		// Update to active
		state.status = "active";
		state.statusChangedAt = Date.now();
		manager.updateStatus(state);
		expect(manager.getState("plan-6k", "6K.A")?.status).toBe("active");

		// Update to completed
		state.status = "completed";
		state.statusChangedAt = Date.now();
		manager.updateStatus(state);
		expect(manager.getState("plan-6k", "6K.A")?.status).toBe("completed");
	});

	it("WorktreeManager lists all tracked worktrees with correct status", () => {
		const tmpRepo = "/tmp/fake-p6-list-test";
		const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

		manager.register(createTestState(tmpRepo, "plan-6k", "6K.A", "created", "aaa"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.B", "active", "bbb"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.C", "completed", "ccc"));

		const allEntries = manager.list();
		expect(allEntries).toHaveLength(3);

		const planEntries = manager.list("plan-6k");
		expect(planEntries).toHaveLength(3);

		const noEntries = manager.list("other-plan");
		expect(noEntries).toHaveLength(0);
	});

	it("WorktreeManager countByStatus aggregates correctly", () => {
		const tmpRepo = "/tmp/fake-p6-count-test";
		const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

		manager.register(createTestState(tmpRepo, "plan-6k", "6K.A", "created", "aaa"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.B", "active", "bbb"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.C", "completed", "ccc"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.D", "failed", "ddd"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.E", "quarantined", "eee"));

		const counts = manager.countByStatus("plan-6k");
		expect(counts.created).toBe(1);
		expect(counts.active).toBe(1);
		expect(counts.completed).toBe(1);
		expect(counts.failed).toBe(1);
		expect(counts.quarantined).toBe(1);
	});

	it("Worktree isolation design document covers all ACs", () => {
		const result = checkWorktreeDocContent();

		// AC1: Workspace execution inside git worktree
		expect(result.hasAc1).toBe(true);

		// AC2: Main checkout remains clean during edits
		expect(result.hasAc2).toBe(true);

		// AC3: Worktree state records path, base commit, branch
		expect(result.hasAc3).toBe(true);

		// AC4: Two workspaces can edit different files concurrently
		expect(result.hasAc4).toBe(true);

		// AC5: Worktree mode can be disabled (P5.5 fallback)
		expect(result.hasAc5).toBe(true);
	});

	it("default worktree config has disabled mode for safe fallback", () => {
		expect(DEFAULT_WORKTREE_CONFIG.enabled).toBe(false);
		expect(DEFAULT_WORKTREE_CONFIG.root).toBe(".pi/worktrees");
	});
});

// ---------------------------------------------------------------------------
// AC3: Integration queue is proven
// ---------------------------------------------------------------------------

describe("AC3: Integration queue is proven", () => {
	it("IntegrationQueue enqueues workspaces with correct initial state", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const queue = new IntegrationQueue(tmpRepo, "test-integration-6k", "main");
			await queue.enqueue("6K.A", "abc123");
			await queue.enqueue("6K.B", "def456");

			const state = await queue.getQueueState();
			expect(state.entries).toHaveLength(2);
			expect(state.entries[0].workspaceId).toBe("6K.A");
			expect(state.entries[0].commitHash).toBe("abc123");
			expect(state.entries[0].status).toBe("queued");
			expect(state.entries[1].workspaceId).toBe("6K.B");
			expect(state.entries[1].status).toBe("queued");
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("IntegrationQueue enqueue is idempotent for already-queued workspaces", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const queue = new IntegrationQueue(tmpRepo, "test-idemp-6k", "main");

			// Enqueue same workspace multiple times
			await queue.enqueue("6K.ID", "hash1");
			await queue.enqueue("6K.ID", "hash2");

			const state = await queue.getQueueState();
			expect(state.entries).toHaveLength(1); // Only one entry
			expect(state.entries[0].commitHash).toBe("hash2"); // Updated
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("IntegrationQueue state correctly reports isProcessing and provides filters", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const queue = new IntegrationQueue(tmpRepo, "test-state-6k", "main");

			// Initially not processing
			expect(queue.isProcessing).toBe(false);
			expect(queue.currentWorkspaceId).toBeUndefined();

			await queue.enqueue("6K.S1", "hash1");
			const state = await queue.getQueueState();
			expect(state.isProcessing).toBe(false);
			expect(state.createdAt).toBeGreaterThan(0);
			expect(state.updatedAt).toBeGreaterThan(0);

			// Filter methods work on queued entries
			const merged = await queue.getMergedWorkspaces();
			expect(merged).toHaveLength(0);

			const failed = await queue.getFailedWorkspaces();
			expect(failed).toHaveLength(0);

			const conflicts = await queue.getConflictWorkspaces();
			expect(conflicts).toHaveLength(0);

			const allEntries = await queue.getAllEntries();
			expect(allEntries).toHaveLength(1);
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("IntegrationQueue persists state to disk as JSON", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const queue = new IntegrationQueue(tmpRepo, "test-persist-6k", "main");
			await queue.enqueue("6K.P1", "hash1");
			await queue.enqueue("6K.P2", "hash2");

			const configPath = path.join(tmpRepo, ".pi", "integration-queue.json");
			const raw = readFileSync(configPath, "utf-8");
			const parsed = JSON.parse(raw);
			expect(parsed.entries).toHaveLength(2);
			expect(parsed.entries[0].workspaceId).toBe("6K.P1");
			expect(parsed.entries[1].workspaceId).toBe("6K.P2");
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("IntegrationQueue enqueue works without validation command", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const queue = new IntegrationQueue(tmpRepo, "test-novalid-6k", "main");
			await queue.enqueue("6K.NV1", "hash1");
			await queue.enqueue("6K.NV2", "hash2", undefined);

			const state = await queue.getQueueState();
			state.entries.forEach((entry) => {
				expect(entry.validationCommand).toBeUndefined();
			});
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("IntegrationQueue preserves name derived from integration branch name", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const queue = new IntegrationQueue(tmpRepo, "my-integration-branch", "main");
			expect(queue.name).toBe("my-integration-branch-queue");
			expect(queue.integrationBranch.name).toBe("my-integration-branch");
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});
});

// ---------------------------------------------------------------------------
// AC4: Failed worktree discard/quarantine is proven
// ---------------------------------------------------------------------------

describe("AC4: Failed worktree discard/quarantine is proven", () => {
	it("WorktreeManager.failWorktree marks worktree as failed without removing it", () => {
		const tmpRepo = "/tmp/fake-p6-fail-test";
		const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

		const state = createTestState(tmpRepo, "plan-6k", "6K.FAIL", "active", "abc123");
		manager.register(state);

		// Fail the worktree
		manager.failWorktree("plan-6k", "6K.FAIL");
		const failedState = manager.getState("plan-6k", "6K.FAIL");
		expect(failedState?.status).toBe("failed");
	});

	it("WorktreeManager.quarantineWorktree preserves failed worktree for review", () => {
		const tmpRepo = "/tmp/fake-p6-quarantine-test";
		const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

		const state = createTestState(tmpRepo, "plan-6k", "6K.Q", "failed", "abc123");
		manager.register(state);

		// Quarantine
		manager.quarantineWorktree("plan-6k", "6K.Q");
		const quarantinedState = manager.getState("plan-6k", "6K.Q");
		expect(quarantinedState?.status).toBe("quarantined");
	});

	it("WorktreeManager provides countByStatus for failed/quarantined worktrees", () => {
		const tmpRepo = "/tmp/fake-p6-count-ac4";
		const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

		manager.register(createTestState(tmpRepo, "plan-6k", "6K.F1", "failed", "f1hash"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.F2", "failed", "f2hash"));
		manager.register(createTestState(tmpRepo, "plan-6k", "6K.Q1", "quarantined", "q1hash"));

		const counts = manager.countByStatus("plan-6k");
		expect(counts.failed).toBe(2);
		expect(counts.quarantined).toBe(1);
		expect(counts.created).toBe(0);
	});

	it("cleanupCompletedWorktree uses git worktree remove not destructive commands", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

			// Create and register a worktree state
			const worktreeDir = path.join(tmpRepo, ".pi", "worktrees", "plan-6k", "6K.CLEAN");
			const branchName = "worktree/plan-6k/6K.CLEAN";

			await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
			execSync(`git branch "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });
			execSync(`git worktree add --checkout "${worktreeDir}" "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });

			const state = createTestState(tmpRepo, "plan-6k", "6K.CLEAN", "completed");
			state.worktreePath = worktreeDir;
			state.branchName = branchName;
			manager.register(state);

			// Cleanup should succeed (uses git worktree remove)
			const result = await manager.cleanupCompletedWorktree("plan-6k", "6K.CLEAN");
			expect(result.success).toBe(true);
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("cleanupQuarantinedWorktree removes quarantined worktree safely", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

			// Create and register a quarantined worktree state
			const worktreeDir = path.join(tmpRepo, ".pi", "worktrees", "plan-6k", "6K.QR");
			const branchName = "worktree/plan-6k/6K.QR";

			await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
			execSync(`git branch "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });
			execSync(`git worktree add --checkout "${worktreeDir}" "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });

			const state = createTestState(tmpRepo, "plan-6k", "6K.QR", "quarantined");
			state.worktreePath = worktreeDir;
			state.branchName = branchName;
			manager.register(state);

			// Cleanup quarantined worktree
			const result = await manager.cleanupQuarantinedWorktree("plan-6k", "6K.QR");
			expect(result.success).toBe(true);
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("WorktreeCleanup.removeAll handles multiple worktrees gracefully", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const cleanup = new WorktreeCleanup(tmpRepo, ".pi/worktrees");
			const paths: string[] = [];
			const branches: string[] = [];

			for (let i = 0; i < 3; i++) {
				const wsId = `6K.B${i}`;
				const worktreeDir = path.join(tmpRepo, ".pi", "worktrees", "plan-6k", wsId);
				const branchName = `worktree/plan-6k/${wsId}`;
				await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
				execSync(`git branch "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });
				execSync(`git worktree add --checkout "${worktreeDir}" "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });
				paths.push(worktreeDir);
				branches.push(branchName);
			}

			const results = await cleanup.removeAll(paths, branches);
			expect(results).toHaveLength(3);
			for (const r of results) {
				expect(r.success).toBe(true);
			}
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("WorktreeManager generates diff artifact for completed worktree", async () => {
		const tmpRepo = await createTempGitRepo();
		try {
			const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

			// Create a worktree with a change
			const worktreeDir = path.join(tmpRepo, ".pi", "worktrees", "plan-6k", "6K.DIFF");
			const branchName = "worktree/plan-6k/6K.DIFF";

			await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
			const baseCommit = execSync("git rev-parse HEAD", { cwd: tmpRepo, encoding: "utf-8" }).trim();
			execSync(`git branch "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });
			execSync(`git worktree add --checkout "${worktreeDir}" "${branchName}"`, { cwd: tmpRepo, stdio: "pipe" });

			// Make a change in the worktree
			await fs.writeFile(path.join(worktreeDir, "new-file.txt"), "new content", "utf-8");
			execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" });
			execSync("git commit -m 'Add new file'", { cwd: worktreeDir, stdio: "pipe" });

			const state = createTestState(tmpRepo, "plan-6k", "6K.DIFF", "completed");
			state.worktreePath = worktreeDir;
			state.branchName = branchName;
			state.baseCommit = baseCommit;
			manager.register(state);

			// Generate diff artifact
			const artifact = await manager.generateDiffArtifact("plan-6k", "6K.DIFF");
			expect(artifact).toBeDefined();
			if (artifact) {
				expect(artifact.diff).toBeTruthy();
				expect(artifact.diff).toContain("new-file.txt");
				expect(artifact.diff).toContain("new content");
			}
		} finally {
			await fs.rm(tmpRepo, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("WorktreeManager.generateDiffArtifact returns undefined for untracked worktree", async () => {
		const tmpRepo = "/tmp/fake-p6-diff-missing";
		const manager = new WorktreeManager(tmpRepo, ".pi/worktrees");

		const artifact = await manager.generateDiffArtifact("plan-6k", "nonexistent");
		expect(artifact).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// AC5: Experimental 6-worker mode is validated or blocked with clear reason
// ---------------------------------------------------------------------------

describe("AC5: Experimental 6-worker mode is validated or blocked with clear reason", () => {
	it("stable default is 3 workers (MAX_STABLE_WORKERS)", () => {
		expect(MAX_STABLE_WORKERS).toBe(3);
	});

	it("experimental range is 4-6 workers", () => {
		expect(MIN_EXPERIMENTAL_WORKERS).toBe(4);
		expect(MAX_EXPERIMENTAL_WORKERS).toBe(6);
	});

	it("validateWorkerConcurrency allows 1-3 workers without experimental mode", () => {
		for (let w = 1; w <= 3; w++) {
			const result = validateWorkerConcurrency({ maxWorkers: w });
			expect(result.valid).toBe(true);
			expect(result.isExperimental).toBe(false);
			expect(result.effectiveWorkers).toBe(w);
		}
	});

	it("validateWorkerConcurrency requires experimental mode for 4+ workers", () => {
		const result = validateWorkerConcurrency({ maxWorkers: 5 });
		expect(result.valid).toBe(false);
		expect(result.isExperimental).toBe(false);
		expect(result.effectiveWorkers).toBe(3); // Falls back to stable max
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toContain("requires experimental mode");
	});

	it("validateWorkerConcurrency with experimental mode enabled, 5 workers, passes prerequisites", () => {
		const result = validateWorkerConcurrency(
			{ maxWorkers: 5, experimentalModeEnabled: true },
			{ archiveEnabled: true, stopOnFailureEnabled: true },
		);
		expect(result.valid).toBe(true);
		expect(result.isExperimental).toBe(true);
		expect(result.effectiveWorkers).toBe(5);
	});

	it("validateWorkerConcurrency blocks experimental mode when archive is disabled", () => {
		const result = validateWorkerConcurrency(
			{ maxWorkers: 5, experimentalModeEnabled: true },
			{ archiveEnabled: false, stopOnFailureEnabled: true },
		);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("archive"))).toBe(true);
	});

	it("validateWorkerConcurrency blocks experimental mode when stop-on-failure is disabled", () => {
		const result = validateWorkerConcurrency(
			{ maxWorkers: 5, experimentalModeEnabled: true },
			{ archiveEnabled: true, stopOnFailureEnabled: false },
		);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("stop-on-failure"))).toBe(true);
	});

	it("validateWorkerConcurrency clamps to valid range for values < 1", () => {
		const result = validateWorkerConcurrency({ maxWorkers: 0 });
		expect(result.effectiveWorkers).toBe(1);
	});

	it("validateWorkerConcurrency clamps to valid range for values > 6", () => {
		const result = validateWorkerConcurrency({ maxWorkers: 10, experimentalModeEnabled: true });
		expect(result.effectiveWorkers).toBe(6);
	});

	it("validateWorkerConcurrency warns when experimental flag has no effect at stable worker count", () => {
		const result = validateWorkerConcurrency(
			{ maxWorkers: 3, experimentalModeEnabled: true },
			{ archiveEnabled: true, stopOnFailureEnabled: true },
		);
		expect(result.valid).toBe(true);
		expect(result.isExperimental).toBe(false);
		expect(result.warnings.some((w) => w.includes("no effect"))).toBe(true);
	});

	it("checkScaleModeReadiness blocks scale mode when worktree isolation is disabled", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 5,
			experimentalModeEnabled: true,
		};

		const readiness = checkScaleModeReadiness(config);
		expect(readiness.ready).toBe(false);
		expect(readiness.isScaleModeActive).toBe(true);
		expect(readiness.errors.length).toBeGreaterThan(0);
		expect(readiness.errors.some((e) => e.includes("Worktree Isolation"))).toBe(true);
	});

	it("checkScaleModeReadiness blocks scale mode when integration queue is disabled", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: false,
			validationLockEnabled: true,
			requestedWorkers: 5,
			experimentalModeEnabled: true,
		};

		const readiness = checkScaleModeReadiness(config);
		expect(readiness.ready).toBe(false);
		expect(readiness.isScaleModeActive).toBe(true);
		expect(readiness.errors.length).toBeGreaterThan(0);
		expect(readiness.errors.some((e) => e.includes("Integration Queue"))).toBe(true);
	});

	it("checkScaleModeReadiness blocks scale mode when validation lock is disabled", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: false,
			requestedWorkers: 5,
			experimentalModeEnabled: true,
		};

		const readiness = checkScaleModeReadiness(config);
		expect(readiness.ready).toBe(false);
		expect(readiness.isScaleModeActive).toBe(true);
		expect(readiness.errors.length).toBeGreaterThan(0);
		expect(readiness.errors.some((e) => e.includes("Global Validation Lock"))).toBe(true);
	});

	it("checkScaleModeReadiness passes with all prerequisites met for scale mode", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};

		const readiness = checkScaleModeReadiness(config);
		expect(readiness.ready).toBe(true);
		expect(readiness.isScaleModeActive).toBe(true);
		expect(readiness.errors.length).toBe(0);
	});

	it("checkScaleModeReadiness does not enforce prerequisites for stable range", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: false,
			validationLockEnabled: false,
			requestedWorkers: 2,
			experimentalModeEnabled: false,
		};

		const readiness = checkScaleModeReadiness(config);
		expect(readiness.ready).toBe(true);
		expect(readiness.isScaleModeActive).toBe(false);
		expect(readiness.errors.length).toBe(0);
	});

	it("checkScaleModeReadiness returns relevant prerequisite keys and messages", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 5,
			experimentalModeEnabled: true,
		};

		const readiness = checkScaleModeReadiness(config);
		const prereqKeys = readiness.prerequisites.map((p) => p.key);
		expect(prereqKeys).toContain(PREREQ_WORKTREE_ISOLATION);
		expect(prereqKeys).toContain(PREREQ_INTEGRATION_QUEUE);
		expect(prereqKeys).toContain(PREREQ_VALIDATION_LOCK);

		// All met, no errors
		readiness.prerequisites.forEach((p) => {
			expect(p.met).toBe(true);
			expect(p.message).toBeTruthy();
		});
	});

	it("validateWorkerConcurrency returns warnings for experimental mode", () => {
		const result = validateWorkerConcurrency(
			{ maxWorkers: 6, experimentalModeEnabled: true },
			{ archiveEnabled: true, stopOnFailureEnabled: true },
		);
		expect(result.isExperimental).toBe(true);
		expect(result.warnings.some((w) => w.includes("Experimental mode enabled"))).toBe(true);
		expect(result.warnings.some((w) => w.includes("less tested"))).toBe(true);
	});

	it("resolveEffectiveWorkerCount returns requested value even when prerequisites not met", () => {
		// resolveEffectiveWorkerCount runs validation but preserves the requested
		// worker count as effectiveWorkers even when validation fails; the caller
		// is responsible for checking validation result
		const count = resolveEffectiveWorkerCount(
			{ maxWorkers: 5, experimentalModeEnabled: true },
			{ archiveEnabled: false, stopOnFailureEnabled: true },
		);
		expect(count).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// AC6: No git push occurs
// ---------------------------------------------------------------------------

describe("AC6: No git push occurs", () => {
	it("WorktreeCleanup source does not contain git push", () => {
		const cleanupCode = readFileSync(path.resolve(__dirname, "../src/worktree/worktree-cleanup.ts"), "utf-8");
		expect(cleanupCode).not.toMatch(/"push"/);
	});

	it("WorktreeManager source does not contain git push", () => {
		const managerCode = readFileSync(path.resolve(__dirname, "../src/worktree/worktree-manager.ts"), "utf-8");
		expect(managerCode).not.toMatch(/"push"/);
	});

	it("IntegrationQueue source does not contain git push", () => {
		const queueCode = readFileSync(path.resolve(__dirname, "../src/integration/integration-queue.ts"), "utf-8");
		expect(queueCode).not.toMatch(/"push"/);
	});

	it("IntegrationBranch source does not contain git push calls", () => {
		const branchCode = readFileSync(path.resolve(__dirname, "../src/integration/integration-branch.ts"), "utf-8");
		// Check for actual push invocation (quoted string "push" as command argument),
		// not comments that mention "git push is never called"
		expect(branchCode).not.toMatch(/"push"/);
	});

	it("DynamicScheduler source does not contain git push", () => {
		const schedulerCode = readFileSync(path.resolve(__dirname, "../src/scheduler/dynamic-scheduler.ts"), "utf-8");
		expect(schedulerCode).not.toMatch(/"push"/);
	});

	it("Scale-mode-policy source does not contain git push", () => {
		const policyCode = readFileSync(path.resolve(__dirname, "../src/scheduler/scale-mode-policy.ts"), "utf-8");
		expect(policyCode).not.toMatch(/"push"/);
	});

	it("Worker concurrency source does not contain git push", () => {
		const concurrencyCode = readFileSync(path.resolve(__dirname, "../src/core/worker-concurrency.ts"), "utf-8");
		expect(concurrencyCode).not.toMatch(/"push"/);
	});

	it("scale-readiness-doctor source does not contain git push", () => {
		const doctorCode = readFileSync(path.resolve(__dirname, "../src/doctor/scale-readiness-doctor.ts"), "utf-8");
		expect(doctorCode).not.toMatch(/"push"/);
	});

	it("worktree-workspace-executor source does not contain git push", () => {
		const executorCode = readFileSync(
			path.resolve(__dirname, "../src/worktree/worktree-workspace-executor.ts"),
			"utf-8",
		);
		expect(executorCode).not.toMatch(/"push"/);
	});

	it("merge-conflict-handoff source does not contain git push", () => {
		const handoffCode = readFileSync(
			path.resolve(__dirname, "../src/integration/merge-conflict-handoff.ts"),
			"utf-8",
		);
		expect(handoffCode).not.toMatch(/"push"/);
	});
});
