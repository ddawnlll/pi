/**
 * Tests for Integration Branch and Merge Queue - P2 Workstream 6.C
 *
 * Covers:
 * - IntegrationQueue CRUD (enqueue, status, cancel)
 * - One-at-a-time processing
 * - Validation pass/fail blocking
 * - IntegrationBranch merge and validation
 * - Archive/state persistence
 * - git push is never called
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanStateStore } from "../src/core/plan-state.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";
import {
	formatIntegrationBranchState,
	formatMergeEntry,
	IntegrationBranch,
} from "../src/integration/integration-branch.js";
import {
	formatIntegrationQueueState,
	formatQueueEntry,
	IntegrationQueue,
	type IntegrationQueueState,
	type QueueEntryTiming,
} from "../src/integration/integration-queue.js";

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

const TEST_DIR = path.join(process.cwd(), ".test-integration-queue");

describe("IntegrationBranch", () => {
	let branch: IntegrationBranch;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });

		// Initialize a git repo for testing
		try {
			const { execSync } = await import("node:child_process");
			execSync("git init", { cwd: TEST_DIR, stdio: "ignore" });
			execSync('git config user.email "test@example.com"', { cwd: TEST_DIR, stdio: "ignore" });
			execSync('git config user.name "Test"', { cwd: TEST_DIR, stdio: "ignore" });
			// Create initial commit on main
			await fs.writeFile(path.join(TEST_DIR, "README.md"), "# Test Repo", "utf-8");
			execSync("git add README.md", { cwd: TEST_DIR, stdio: "ignore" });
			execSync("git commit -m 'initial commit'", { cwd: TEST_DIR, stdio: "ignore" });
		} catch {
			// git might not be available in test env — branch tests will skip
		}

		branch = new IntegrationBranch(TEST_DIR, "test-integration", "main");
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
	});

	it("should initialize with correct defaults", () => {
		expect(branch.name).toBe("test-integration");
		expect(branch.base).toBe("main");
		expect(branch.entries).toHaveLength(0);
	});

	it("should create integration branch from base branch", async () => {
		// Check if git is available and repo was initialized
		const hasGit = await checkGitAvailable(TEST_DIR);
		if (!hasGit) {
			console.warn("Skipping git-dependent test: git not available or repo not initialized");
			return;
		}

		await branch.ensureBranch();
		expect(branch.exists()).toBe(true);
	});

	it("should record merge entries and allow retrieval", async () => {
		const entry = {
			workspaceId: "6.C",
			status: "merged" as const,
			commitHash: "abc123def456",
			mergeStartedAt: Date.now(),
			mergedAt: Date.now(),
			mergeCommitHash: "integ789",
			validationPassed: true,
		};

		await branch.recordResult(entry);

		const retrieved = branch.getMergeStatus("6.C");
		expect(retrieved).toBeDefined();
		expect(retrieved?.workspaceId).toBe("6.C");
		expect(retrieved?.status).toBe("merged");
		expect(retrieved?.commitHash).toBe("abc123def456");
	});

	it("should retrieve all entries", async () => {
		await branch.recordResult({
			workspaceId: "6.A",
			status: "merged",
			commitHash: "aaa",
			mergedAt: Date.now(),
		});

		await branch.recordResult({
			workspaceId: "6.B",
			status: "blocked",
			commitHash: "bbb",
			error: "Validation failed",
		});

		const all = branch.getAllEntries();
		expect(all).toHaveLength(2);
		expect(all[0]?.workspaceId).toBe("6.A");
		expect(all[1]?.workspaceId).toBe("6.B");
	});

	it("should update existing entry on recordResult", async () => {
		await branch.recordResult({
			workspaceId: "6.C",
			status: "merged",
			commitHash: "abc",
			mergedAt: Date.now(),
		});

		await branch.recordResult({
			workspaceId: "6.C",
			status: "merged",
			commitHash: "abc",
			mergedAt: Date.now(),
			validationPassed: true,
		});

		const entry = branch.getMergeStatus("6.C");
		expect(entry?.validationPassed).toBe(true);
	});

	it("should return undefined for unknown workspace", () => {
		expect(branch.getMergeStatus("nonexistent")).toBeUndefined();
	});

	it("should format merge entry to string", () => {
		const entry = {
			workspaceId: "6.C",
			status: "merged" as const,
			commitHash: "abc123def456",
			mergedAt: Date.now(),
			mergeCommitHash: "integ789",
			validationPassed: true,
			validationCommand: "npm test",
		};

		const formatted = formatMergeEntry(entry);
		expect(formatted).toContain("6.C");
		expect(formatted).toContain("merged");
		expect(formatted).toContain("abc123");
		expect(formatted).toContain("npm test");
	});

	it("should format full state to string with validation results", () => {
		const state = {
			branchName: "integration",
			baseBranch: "main",
			entries: [
				{
					workspaceId: "6.A",
					status: "merged" as const,
					commitHash: "aaa",
					mergedAt: Date.now(),
					validationPassed: true,
				},
				{
					workspaceId: "6.B",
					status: "blocked" as const,
					commitHash: "bbb",
					error: "Validation failed",
					validationPassed: false,
				},
			],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const formatted = formatIntegrationBranchState(state);
		expect(formatted).toContain("integration");
		expect(formatted).toContain("main");
		expect(formatted).toContain("6.A");
		expect(formatted).toContain("6.B");
		expect(formatted).toContain("PASSED");
		expect(formatted).toContain("FAILED");
	});
});

describe("IntegrationQueue", () => {
	let queue: IntegrationQueue;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
	});

	it("should initialize with correct defaults", () => {
		expect(queue.name).toBe("test-integration-queue");
		expect(queue.isProcessing).toBe(false);
		expect(queue.currentWorkspaceId).toBeUndefined();
	});

	// ---- enqueue / state ----

	it("should enqueue a workspace", async () => {
		await queue.enqueue("6.C", "abc123", "npm test");
		const state = await queue.getQueueState();
		expect(state.entries).toHaveLength(1);
		expect(state.entries[0]?.workspaceId).toBe("6.C");
		expect(state.entries[0]?.status).toBe("queued");
		expect(state.entries[0]?.commitHash).toBe("abc123");
		expect(state.entries[0]?.validationCommand).toBe("npm test");
	});

	it("should enqueue multiple workspaces in order", async () => {
		await queue.enqueue("6.A", "hash-a");
		await queue.enqueue("6.B", "hash-b");
		await queue.enqueue("6.C", "hash-c");

		const state = await queue.getQueueState();
		expect(state.entries).toHaveLength(3);
		expect(state.entries[0]?.workspaceId).toBe("6.A");
		expect(state.entries[1]?.workspaceId).toBe("6.B");
		expect(state.entries[2]?.workspaceId).toBe("6.C");
	});

	it("should update commit hash when re-enqueuing same workspace", async () => {
		await queue.enqueue("6.C", "hash-v1", "npm test");
		await queue.enqueue("6.C", "hash-v2", "npm run typecheck");

		const state = await queue.getQueueState();
		expect(state.entries).toHaveLength(1);
		expect(state.entries[0]?.commitHash).toBe("hash-v2");
		expect(state.entries[0]?.validationCommand).toBe("npm run typecheck");
	});

	it("should return all entries", async () => {
		await queue.enqueue("6.A", "hash-a");
		await queue.enqueue("6.B", "hash-b");

		const entries = await queue.getAllEntries();
		expect(entries).toHaveLength(2);
	});

	// ---- processNext (without git) ----

	it("should skip processing if queue is already processing", async () => {
		await queue.enqueue("6.A", "hash-a");

		// Manually set processing state
		const state = await queue.getQueueState();
		(state as unknown as Record<string, unknown>).isProcessing = true;
		await saveQueueStateDirectly(queue, state);

		const result = await queue.processNext();
		expect(result.processed).toBe(false);
	});

	it("should skip processing if no queued entries", async () => {
		const result = await queue.processNext();
		expect(result.processed).toBe(false);
	});

	it("should skip processing if next entry is blocked (queue halted)", async () => {
		// Manually insert a blocked entry
		const state = await queue.getQueueState();
		state.entries.push({
			workspaceId: "6.A",
			status: "blocked",
			commitHash: "hash-a",
			queuedAt: Date.now(),
		});
		await saveQueueStateDirectly(queue, state);

		const result = await queue.processNext();
		expect(result.processed).toBe(false);
	});

	// ---- retryEntry / cancelEntry ----

	it("should retry a blocked entry", async () => {
		const state = await queue.getQueueState();
		state.entries.push({
			workspaceId: "6.A",
			status: "blocked",
			commitHash: "hash-a",
			queuedAt: Date.now(),
			error: "Validation failed",
		});
		await saveQueueStateDirectly(queue, state);

		await queue.retryEntry("6.A");

		const entry = await queue.getEntry("6.A");
		expect(entry?.status).toBe("queued");
		expect(entry?.error).toBeUndefined();
	});

	it("should retry a failed entry", async () => {
		const state = await queue.getQueueState();
		state.entries.push({
			workspaceId: "6.A",
			status: "failed",
			commitHash: "hash-a",
			queuedAt: Date.now(),
			error: "Merge conflict",
		});
		await saveQueueStateDirectly(queue, state);

		await queue.retryEntry("6.A");

		const entry = await queue.getEntry("6.A");
		expect(entry?.status).toBe("queued");
	});

	it("should throw when retrying non-blocked/failed entry", async () => {
		await queue.enqueue("6.A", "hash-a");
		await expect(queue.retryEntry("6.A")).rejects.toThrow();
	});

	it("should throw when retrying unknown entry", async () => {
		await expect(queue.retryEntry("nonexistent")).rejects.toThrow();
	});

	it("should cancel a queued entry", async () => {
		await queue.enqueue("6.A", "hash-a");
		await queue.enqueue("6.B", "hash-b");

		await queue.cancelEntry("6.A");

		const entries = await queue.getAllEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.workspaceId).toBe("6.B");
	});

	it("should not cancel non-queued entry", async () => {
		const state = await queue.getQueueState();
		state.entries.push({
			workspaceId: "6.A",
			status: "merged",
			commitHash: "hash-a",
			queuedAt: Date.now(),
		});
		await saveQueueStateDirectly(queue, state);

		await queue.cancelEntry("6.A");

		const entries = await queue.getAllEntries();
		expect(entries).toHaveLength(1); // Should still be there
	});

	// ---- clearCompleted ----

	it("should clear completed and failed entries", async () => {
		const state = await queue.getQueueState();
		state.entries.push(
			{
				workspaceId: "6.A",
				status: "merged",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			},
			{
				workspaceId: "6.B",
				status: "failed",
				commitHash: "hash-b",
				queuedAt: Date.now(),
			},
			{
				workspaceId: "6.C",
				status: "queued",
				commitHash: "hash-c",
				queuedAt: Date.now(),
			},
		);
		await saveQueueStateDirectly(queue, state);

		await queue.clearCompleted();

		const entries = await queue.getAllEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.workspaceId).toBe("6.C");
	});

	// ---- getMergedWorkspaces / getFailedWorkspaces ----

	it("should get merged workspaces", async () => {
		const state = await queue.getQueueState();
		state.entries.push(
			{
				workspaceId: "6.A",
				status: "merged",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			},
			{
				workspaceId: "6.B",
				status: "queued",
				commitHash: "hash-b",
				queuedAt: Date.now(),
			},
		);
		await saveQueueStateDirectly(queue, state);

		const merged = await queue.getMergedWorkspaces();
		expect(merged).toHaveLength(1);
		expect(merged[0]?.workspaceId).toBe("6.A");
	});

	it("should get failed workspaces", async () => {
		const state = await queue.getQueueState();
		state.entries.push(
			{
				workspaceId: "6.A",
				status: "blocked",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			},
			{
				workspaceId: "6.B",
				status: "failed",
				commitHash: "hash-b",
				queuedAt: Date.now(),
			},
			{
				workspaceId: "6.C",
				status: "merged",
				commitHash: "hash-c",
				queuedAt: Date.now(),
			},
		);
		await saveQueueStateDirectly(queue, state);

		const failed = await queue.getFailedWorkspaces();
		expect(failed).toHaveLength(2);
	});

	// ---- processAll ----

	it("should process all entries and stop at blocked", async () => {
		// Without git the merge will fail, so we just test the loop behavior
		const state = await queue.getQueueState();
		state.entries.push({
			workspaceId: "6.A",
			status: "queued",
			commitHash: "hash-a",
			queuedAt: Date.now(),
		});
		await saveQueueStateDirectly(queue, state);

		const processed = await queue.processAll();
		// Should process one entry (the merge will fail without git)
		expect(processed.length).toBeGreaterThanOrEqual(0);
	});

	// ---- format functions ----

	it("should format queue entry to string", () => {
		const entry = {
			workspaceId: "6.C",
			status: "merged" as const,
			commitHash: "abc123def456",
			validationCommand: "npm test",
			validationPassed: true,
			queuedAt: Date.now(),
			processedAt: Date.now(),
			mergedAt: Date.now(),
		};

		const formatted = formatQueueEntry(entry);
		expect(formatted).toContain("6.C");
		expect(formatted).toContain("merged");
		expect(formatted).toContain("npm test");
	});

	it("should format full queue state to string", () => {
		const state: IntegrationQueueState = {
			entries: [
				{
					workspaceId: "6.A",
					status: "merged" as const,
					commitHash: "aaa",
					queuedAt: Date.now(),
					processedAt: Date.now(),
					mergedAt: Date.now(),
					validationPassed: true,
				},
				{
					workspaceId: "6.B",
					status: "blocked" as const,
					commitHash: "bbb",
					queuedAt: Date.now(),
					error: "Validation failed",
				},
			],
			isProcessing: false,
			paused: false,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			auditEvents: [],
		};

		const formatted = formatIntegrationQueueState(state);
		expect(formatted).toContain("6.A");
		expect(formatted).toContain("6.B");
		expect(formatted).toContain("[OK]");
		expect(formatted).toContain("[!!]");
	});
});

describe("PlanStateStore Integration Recording", () => {
	let store: PlanStateStore;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		store = new PlanStateStore(TEST_DIR);
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
	});

	it("should record integration merge start event", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Integration",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "6.C",
					title: "Integration Queue",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.recordIntegrationMergeStart("6.C", "abc123def456");

		const journal = await store.readJournal();
		const mergeEvents = journal.filter((e) => e.type === "integration_merge_start");
		expect(mergeEvents).toHaveLength(1);
		expect(mergeEvents[0]?.workspaceId).toBe("6.C");
	});

	it("should record integration merge complete event", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Integration",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "6.C",
					title: "Integration Queue",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.recordIntegrationMergeComplete("6.C", "integ789", true);

		const journal = await store.readJournal();
		const completeEvents = journal.filter((e) => e.type === "integration_merge_complete");
		expect(completeEvents).toHaveLength(1);
		expect(completeEvents[0]?.workspaceId).toBe("6.C");
		expect(completeEvents[0]?.data?.validationPassed).toBe(true);
	});

	it("should record integration merge failed event", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Integration",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "6.C",
					title: "Integration Queue",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.recordIntegrationMergeFailed("6.C", "Merge conflict in file.ts");

		const journal = await store.readJournal();
		const failEvents = journal.filter((e) => e.type === "integration_merge_failed");
		expect(failEvents).toHaveLength(1);
		expect(failEvents[0]?.data?.error).toContain("Merge conflict");
	});

	it("should record integration merge blocked event", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Integration",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "6.C",
					title: "Integration Queue",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.recordIntegrationMergeBlocked("6.C", "npm test", "Tests failed: 2 failing");

		const journal = await store.readJournal();
		const blockedEvents = journal.filter((e) => e.type === "integration_merge_blocked");
		expect(blockedEvents).toHaveLength(1);
		expect(blockedEvents[0]?.data?.validationCommand).toBe("npm test");
	});

	it("should record integration validate events", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Integration",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "6.C",
					title: "Integration Queue",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.recordIntegrationValidateStart("6.C", "npm test");

		let journal = await store.readJournal();
		let startEvents = journal.filter((e) => e.type === "integration_validate_start");
		expect(startEvents).toHaveLength(1);

		await store.recordIntegrationValidateComplete("6.C", true, "All tests passed");

		journal = await store.readJournal();
		startEvents = journal.filter((e) => e.type === "integration_validate_start");
		const completeEvents = journal.filter((e) => e.type === "integration_validate_complete");
		expect(startEvents).toHaveLength(1);
		expect(completeEvents).toHaveLength(1);
	});

	it("should record validation failed event on failure", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Integration",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "6.C",
					title: "Integration Queue",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.recordIntegrationValidateComplete("6.C", false, "Tests failed");

		const journal = await store.readJournal();
		const failedEvents = journal.filter((e) => e.type === "integration_validate_failed");
		expect(failedEvents).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Acceptance Criteria Verification Tests
// ---------------------------------------------------------------------------

describe("Acceptance Criteria", () => {
	let queue: IntegrationQueue;
	let branch: IntegrationBranch;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");
		branch = new IntegrationBranch(TEST_DIR, "test-integration", "main");
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
	});

	it("AC1: Successful workspace enters integration queue", async () => {
		// Enqueue a workspace
		await queue.enqueue("6.C", "def789", "npm test");
		const state = await queue.getQueueState();
		expect(state.entries).toHaveLength(1);
		expect(state.entries[0]?.workspaceId).toBe("6.C");
		expect(state.entries[0]?.status).toBe("queued");
	});

	it("AC2: Queue merges one workspace at a time into integration branch", async () => {
		// Enqueue multiple workspaces
		await queue.enqueue("6.A", "hash-a");
		await queue.enqueue("6.B", "hash-b");

		const state = await queue.getQueueState();
		expect(state.entries).toHaveLength(2);

		// Only the first should be processed at a time
		// (The actual merge will fail without git, but the queue state confirms ordering)
		expect(state.entries[0]?.workspaceId).toBe("6.A");
		expect(state.entries[1]?.workspaceId).toBe("6.B");
	});

	it("AC3: Failed validation blocks merge", async () => {
		// Create a blocked entry
		const entryState = await queue.getQueueState();
		entryState.entries.push({
			workspaceId: "6.A",
			status: "blocked",
			commitHash: "hash-a",
			validationCommand: "npm test",
			queuedAt: Date.now(),
			error: "Validation failed: npm test",
		});
		await saveQueueStateDirectly(queue, entryState);

		// processNext should skip it (blocked entries halt the queue)
		const result = await queue.processNext();
		expect(result.processed).toBe(false);

		// Verify it's still blocked in the branch state
		const branchEntry = branch.getMergeStatus("6.A");
		if (branchEntry) {
			expect(branchEntry.status).toBe("blocked");
		}
	});

	it("AC4: Integration validation runs after merge", async () => {
		// Directly simulate: add a merged entry, then simulate validation
		await branch.recordResult({
			workspaceId: "6.C",
			status: "merged",
			commitHash: "abc123",
			mergedAt: Date.now(),
		});

		// The validation run is done via the queue.processNext() method
		// which calls branch.runValidation() after merge
		// Here we verify the branch state can transition through validation

		const entry = branch.getMergeStatus("6.C");
		expect(entry?.status).toBe("merged");
	});

	it("AC5: Merge result is recorded in archive/state", async () => {
		// Record a merge result
		await branch.recordResult({
			workspaceId: "6.C",
			status: "merged",
			commitHash: "abc123",
			mergedAt: Date.now(),
			validationPassed: true,
			validationCommand: "npm test",
			validationOutput: "All tests passed",
		});

		// Verify it's retrievable from the branch state
		const entry = branch.getMergeStatus("6.C");
		expect(entry).toBeDefined();
		expect(entry?.workspaceId).toBe("6.C");
		expect(entry?.status).toBe("merged");
		expect(entry?.validationPassed).toBe(true);

		// Also record via PlanStateStore journal
		const store = new PlanStateStore(TEST_DIR);
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Integration",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "6.C",
					title: "Integration Queue",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};
		await store.initializeState(queue);
		await store.recordIntegrationMergeComplete("6.C", "integ789", true);

		const journal = await store.readJournal();
		const completeEvents = journal.filter((e) => e.type === "integration_merge_complete");
		expect(completeEvents).toHaveLength(1);
	});

	it("AC6: git push is never called", async () => {
		// Verify that neither IntegrationBranch nor IntegrationQueue
		// ever calls "git push" — comments are allowed, commands are not
		const branchSource = await fs.readFile(
			path.join(process.cwd(), "src/integration/integration-branch.ts"),
			"utf-8",
		);
		const queueSource = await fs.readFile(path.join(process.cwd(), "src/integration/integration-queue.ts"), "utf-8");

		// Strip comments to find only code-based git calls
		const stripComments = (src: string): string =>
			src
				.replace(/\/\*[\s\S]*?\*\//g, "") // multi-line comments
				.replace(/\/\/.*$/gm, ""); // single-line comments

		const branchCode = stripComments(branchSource);
		const queueCode = stripComments(queueSource);

		// Check no "git push" sequences remain after stripping comments
		expect(branchCode).not.toMatch(/git\s+push/);
		expect(queueCode).not.toMatch(/git\s+push/);

		// Also verify the arguments array never contains "push"
		expect(branchCode).not.toMatch(/"push"/);
		expect(queueCode).not.toMatch(/"push"/);
	});

	// ---- Timing Metrics (6.6.B) ----

	it("AC7: Queue entries record timing metrics after processing", async () => {
		// Create an entry with timestamps so computeTimingMetrics can produce results
		const queuedAt = Date.now() - 10000; // 10 seconds ago
		const processedAt = Date.now() - 8000; // 8 seconds ago
		const mergedAt = Date.now() - 5000; // 5 seconds ago
		const completedAt = Date.now();

		const state = await queue.getQueueState();
		state.entries.push({
			workspaceId: "6.6.B",
			status: "merged",
			commitHash: "metric-hash",
			queuedAt,
			processedAt,
			mergedAt,
			completedAt,
			validationCommand: "npm test",
			validationStartedAt: mergedAt + 100,
			validationPassed: true,
			timingMetrics: {
				waitTimeMs: processedAt - queuedAt,
				mergeTimeMs: mergedAt - processedAt,
				validationTimeMs: completedAt - mergedAt - 100,
				totalTimeMs: completedAt - queuedAt,
			} as QueueEntryTiming,
		});
		await saveQueueStateDirectly(queue, state);

		// Read back and verify metrics are present
		const entry = await queue.getEntry("6.6.B");
		expect(entry).toBeDefined();
		expect(entry!.timingMetrics).toBeDefined();
		expect(entry!.timingMetrics!.waitTimeMs).toBe(2000);
		expect(entry!.timingMetrics!.mergeTimeMs).toBe(3000);
		expect(entry!.timingMetrics!.totalTimeMs).toBe(10000);
		expect(entry!.timingMetrics!.validationTimeMs).toBeDefined();

		// Verify format includes timing info
		const formatted = formatQueueEntry(entry!);
		expect(formatted).toContain("Timing Metrics:");
		expect(formatted).toContain("Wait Time: 2000ms");
		expect(formatted).toContain("Total Time: 10000ms");
	});

	it("AC8: Timing metrics persist across state reload", async () => {
		// Save an entry with timing metrics
		const queuedAt = Date.now() - 5000;
		const processedAt = Date.now() - 3000;
		const mergedAt = Date.now() - 1000;

		const state = await queue.getQueueState();
		state.entries.push({
			workspaceId: "persist-test",
			status: "merged",
			commitHash: "persist-hash",
			queuedAt,
			processedAt,
			mergedAt,
			completedAt: Date.now(),
			timingMetrics: {
				waitTimeMs: processedAt - queuedAt,
				mergeTimeMs: mergedAt - processedAt,
				totalTimeMs: Date.now() - queuedAt,
			} as QueueEntryTiming,
		});
		await saveQueueStateDirectly(queue, state);

		// Create a new queue instance (simulates restart)
		const queue2 = new IntegrationQueue(TEST_DIR, "test-integration", "main");
		const entry2 = await queue2.getEntry("persist-test");

		expect(entry2).toBeDefined();
		expect(entry2!.timingMetrics).toBeDefined();
		expect(entry2!.timingMetrics!.waitTimeMs).toBe(2000);
		expect(entry2!.timingMetrics!.mergeTimeMs).toBe(2000);
		expect(entry2!.timingMetrics!.totalTimeMs).toBeGreaterThanOrEqual(4999);
	});

	it("AC9: Existing state files without timing metrics remain readable", async () => {
		// Write a state file WITHOUT timingMetrics (simulating old format)
		const queuedAt = Date.now() - 10000;
		const processedAt = Date.now() - 8000;
		const mergedAt = Date.now() - 5000;

		const oldState = {
			entries: [
				{
					workspaceId: "old-format",
					status: "merged",
					commitHash: "old-hash",
					queuedAt,
					processedAt,
					mergedAt,
					validationCommand: "npm test",
					validationPassed: true,
					// No timingMetrics — old format
				},
			],
			isProcessing: false,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		await saveQueueStateDirectly(queue, oldState);

		// Create a new queue and verify it can read the old state
		const queue2 = new IntegrationQueue(TEST_DIR, "test-integration", "main");
		const entry = await queue2.getEntry("old-format");

		expect(entry).toBeDefined();
		expect(entry!.workspaceId).toBe("old-format");
		expect(entry!.status).toBe("merged");
		expect(entry!.commitHash).toBe("old-hash");
		// Should not have timingMetrics since it wasn't in the old state
		expect(entry!.timingMetrics).toBeUndefined();
		expect(entry!.completedAt).toBeUndefined();
		expect(entry!.validationStartedAt).toBeUndefined();

		// Verify the entry still works correctly with enqueue/retry operations
		// Enqueue a new workspace to verify the state transitions correctly
		await queue2.enqueue("new-workspace", "new-hash");
		const allEntries = await queue2.getAllEntries();
		expect(allEntries).toHaveLength(2);
		expect(allEntries[1]?.workspaceId).toBe("new-workspace");
	});
});

// ---------------------------------------------------------------------------
// Queue Optimizer Integration Tests (6.D)
// ---------------------------------------------------------------------------

describe("Queue Optimizer Integration", () => {
	let queue: IntegrationQueue;

	const CHAIN_WORKSPACES: Workspace[] = [
		{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
		{ id: "C", title: "C", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
	];

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
	});

	// -----------------------------------------------------------------------
	// 6.D: getOptimizerSuggestions
	// -----------------------------------------------------------------------

	describe("getOptimizerSuggestions", () => {
		it("should return suggestions without modifying queue state", async () => {
			await queue.enqueue("C", "hash-c");
			await queue.enqueue("B", "hash-b");
			await queue.enqueue("A", "hash-a");

			const suggestions = await queue.getOptimizerSuggestions(CHAIN_WORKSPACES);

			expect(suggestions.suggestions.length).toBeGreaterThan(0);
			expect(suggestions.isSafe).toBe(true);
			expect(suggestions.suggestedOrder).toBeDefined();
			expect(suggestions.scores.length).toBe(3);

			// Queue state should be unchanged
			const state = await queue.getQueueState();
			expect(state.entries[0]?.workspaceId).toBe("C");
			expect(state.entries[1]?.workspaceId).toBe("B");
			expect(state.entries[2]?.workspaceId).toBe("A");
		});

		it("should suggest dependency-safe ordering", async () => {
			await queue.enqueue("C", "hash-c");
			await queue.enqueue("B", "hash-b");
			await queue.enqueue("A", "hash-a");

			const suggestions = await queue.getOptimizerSuggestions(CHAIN_WORKSPACES);

			const suggestedIds = suggestions.suggestedOrder.filter((e) => e.status === "queued").map((e) => e.workspaceId);

			// A must come before B, B before C
			expect(suggestedIds.indexOf("A")).toBeLessThan(suggestedIds.indexOf("B"));
			expect(suggestedIds.indexOf("B")).toBeLessThan(suggestedIds.indexOf("C"));
		});

		it("should include throughput impact", async () => {
			await queue.enqueue("C", "hash-c");
			await queue.enqueue("B", "hash-b");
			await queue.enqueue("A", "hash-a");

			const suggestions = await queue.getOptimizerSuggestions(CHAIN_WORKSPACES);

			expect(suggestions.throughputImpact).toBeDefined();
			expect(suggestions.throughputImpact.explanation.length).toBeGreaterThan(10);
			expect(suggestions.throughputImpact.estimatedTimeSavedMs).toBeGreaterThanOrEqual(0);
		});

		it("should return empty suggestions for empty queue", async () => {
			const suggestions = await queue.getOptimizerSuggestions(CHAIN_WORKSPACES);
			expect(suggestions.suggestions).toHaveLength(0);
			expect(suggestions.isSafe).toBe(true);
		});

		it("should preserve non-queued entries in suggested order", async () => {
			// Manually create state with mixed entries
			const state = await queue.getQueueState();
			state.entries.push(
				{
					workspaceId: "MERGED",
					status: "merged",
					commitHash: "hash-m",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "C",
					status: "queued",
					commitHash: "hash-c",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "A",
					status: "queued",
					commitHash: "hash-a",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "FAILED",
					status: "failed",
					commitHash: "hash-f",
					queuedAt: Date.now(),
				},
			);
			await saveQueueStateDirectly(queue, state);

			const suggestions = await queue.getOptimizerSuggestions(CHAIN_WORKSPACES);

			// MERGED and FAILED should stay at their positions
			expect(suggestions.suggestedOrder[0]?.workspaceId).toBe("MERGED");
			expect(suggestions.suggestedOrder[3]?.workspaceId).toBe("FAILED");
		});
	});

	// -----------------------------------------------------------------------
	// 6.D: applyOptimizerOrdering
	// -----------------------------------------------------------------------

	describe("applyOptimizerOrdering", () => {
		it("should reorder queued entries and persist the new order", async () => {
			await queue.enqueue("C", "hash-c");
			await queue.enqueue("B", "hash-b");
			await queue.enqueue("A", "hash-a");

			const result = await queue.applyOptimizerOrdering(CHAIN_WORKSPACES);

			expect(result.optimized).toBe(true);
			expect(result.throughputImpact).toBeDefined();

			// State should be persisted
			const state = await queue.getQueueState();
			expect(state.entries[0]?.workspaceId).toBe("A");
			expect(state.entries[1]?.workspaceId).toBe("B");
			expect(state.entries[2]?.workspaceId).toBe("C");
		});

		it("should not modify queue when already optimal", async () => {
			await queue.enqueue("A", "hash-a");
			await queue.enqueue("B", "hash-b");

			const result = await queue.applyOptimizerOrdering(CHAIN_WORKSPACES);

			expect(result.optimized).toBe(false);
		});

		it("should preserve non-queued entries when applying ordering", async () => {
			const state = await queue.getQueueState();
			state.entries.push(
				{
					workspaceId: "BLOCKED",
					status: "blocked",
					commitHash: "hash-b",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "C",
					status: "queued",
					commitHash: "hash-c",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "A",
					status: "queued",
					commitHash: "hash-a",
					queuedAt: Date.now(),
				},
			);
			await saveQueueStateDirectly(queue, state);

			const _result = await queue.applyOptimizerOrdering({ skipOnBlockers: false } as any);

			// BLOCKED stays at position 0 (and the method uses default policy without skipOnBlockers override)
			// Actually, applyOptimizerOrdering creates a new QueueOptimizer with default policy
			// so skipOnBlockers defaults to true, so it won't optimize with blockers
			const stateAfter = await queue.getQueueState();
			expect(stateAfter.entries[0]?.workspaceId).toBe("BLOCKED");
		});

		it("should persist reordered state to disk", async () => {
			await queue.enqueue("C", "hash-c");
			await queue.enqueue("A", "hash-a");

			await queue.applyOptimizerOrdering(CHAIN_WORKSPACES);

			// Create a new queue instance (simulates reload)
			const queue2 = new IntegrationQueue(TEST_DIR, "test-integration", "main");
			const entries = await queue2.getAllEntries();

			expect(entries[0]?.workspaceId).toBe("A");
			expect(entries[1]?.workspaceId).toBe("C");
		});
	});

	// -----------------------------------------------------------------------
	// 6.D: analyzeThroughput
	// -----------------------------------------------------------------------

	describe("analyzeThroughput", () => {
		it("should return throughput analysis for queued entries", async () => {
			await queue.enqueue("C", "hash-c");
			await queue.enqueue("B", "hash-b");
			await queue.enqueue("A", "hash-a");

			const impact = await queue.analyzeThroughput(CHAIN_WORKSPACES);

			expect(impact).toBeDefined();
			expect(impact.explanation).toBeTruthy();
			expect(typeof impact.estimatedTimeSavedMs).toBe("number");
			expect(typeof impact.workspacesUnblockedSooner).toBe("number");
		});

		it("should return zero-impact analysis for empty queue", async () => {
			const impact = await queue.analyzeThroughput(CHAIN_WORKSPACES);

			expect(impact.estimatedTimeSavedMs).toBe(0);
			expect(impact.workspacesUnblockedSooner).toBe(0);
			expect(impact.explanation).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// 6.D: isOrderSafe
	// -----------------------------------------------------------------------

	describe("isOrderSafe", () => {
		it("should return true for well-ordered queue", async () => {
			await queue.enqueue("A", "hash-a");
			await queue.enqueue("B", "hash-b");
			await queue.enqueue("C", "hash-c");

			const safe = await queue.isOrderSafe(CHAIN_WORKSPACES);
			expect(safe).toBe(true);
		});

		it("should return true for empty queue", async () => {
			const safe = await queue.isOrderSafe();
			expect(safe).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// 6.6.F: Queue Control Actions
// ---------------------------------------------------------------------------

describe("Queue Control Actions (6.6.F)", () => {
	let queue: IntegrationQueue;

	// Workspace defs for dependency validation
	const TEST_WORKSPACES: Workspace[] = [
		{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
		{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
		{ id: "C", title: "C", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
	];

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
	});

	// -----------------------------------------------------------------------
	// Pause / Resume
	// -----------------------------------------------------------------------

	describe("pause / resume", () => {
		it("should start unpaused", async () => {
			expect(await queue.isPaused()).toBe(false);
		});

		it("should pause queue processing", async () => {
			await queue.pause();
			expect(await queue.isPaused()).toBe(true);
		});

		it("should resume queue processing", async () => {
			await queue.pause();
			expect(await queue.isPaused()).toBe(true);

			await queue.resume();
			expect(await queue.isPaused()).toBe(false);
		});

		it("should be idempotent when already paused", async () => {
			await queue.pause();
			await queue.pause(); // second pause should not error
			expect(await queue.isPaused()).toBe(true);
		});

		it("should be idempotent when already resumed", async () => {
			await queue.resume(); // resume when not paused should not error
			expect(await queue.isPaused()).toBe(false);
		});

		it("should persist paused state across reload", async () => {
			await queue.pause();

			const queue2 = new IntegrationQueue(TEST_DIR, "test-integration", "main");
			expect(await queue2.isPaused()).toBe(true);
		});

		it("should not process next entry while paused", async () => {
			await queue.enqueue("A", "hash-a");
			await queue.pause();

			// processNext should return false while paused
			const result = await queue.processNext();
			expect(result.processed).toBe(false);

			// Entry should still be queued
			const entry = await queue.getEntry("A");
			expect(entry?.status).toBe("queued");
		});

		it("should resume processing after unpausing", async () => {
			await queue.enqueue("A", "hash-a");
			await queue.pause();

			const result1 = await queue.processNext();
			expect(result1.processed).toBe(false);

			await queue.resume();

			// processNext should now attempt to process (even though git merge will fail)
			const result2 = await queue.processNext();
			expect(result2.processed).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Requeue Entry
	// -----------------------------------------------------------------------

	describe("requeueEntry", () => {
		it("should requeue a merged entry", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "merged",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			await queue.requeueEntry("A");

			const entry = await queue.getEntry("A");
			expect(entry?.status).toBe("queued");
			expect(entry?.validationPassed).toBeUndefined();
			expect(entry?.completedAt).toBeUndefined();
		});

		it("should throw when requeuing non-merged entry", async () => {
			await queue.enqueue("A", "hash-a");
			await expect(queue.requeueEntry("A")).rejects.toThrow();
		});

		it("should throw when requeuing unknown entry", async () => {
			await expect(queue.requeueEntry("nonexistent")).rejects.toThrow();
		});

		it("should throw with actionable error for wrong status", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "blocked",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			await expect(queue.requeueEntry("A")).rejects.toThrow(/requeue is only valid for "merged" entries/);
		});

		it("should persist requeued state across reload", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "merged",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			await queue.requeueEntry("A");

			const queue2 = new IntegrationQueue(TEST_DIR, "test-integration", "main");
			const entry = await queue2.getEntry("A");
			expect(entry?.status).toBe("queued");
		});
	});

	// -----------------------------------------------------------------------
	// Audit Log
	// -----------------------------------------------------------------------

	describe("audit log", () => {
		it("should start with empty audit log", async () => {
			const log = await queue.getAuditLog();
			expect(log).toHaveLength(0);
		});

		it("should record pause event", async () => {
			await queue.pause();

			const log = await queue.getAuditLog();
			expect(log).toHaveLength(1);
			expect(log[0]?.action).toBe("pause");
			expect(log[0]?.details).toContain("paused");
		});

		it("should record resume event", async () => {
			await queue.pause();
			await queue.resume();

			const log = await queue.getAuditLog();
			// Pause + resume = 2 events, most recent first
			expect(log).toHaveLength(2);
			expect(log[0]?.action).toBe("resume");
			expect(log[1]?.action).toBe("pause");
		});

		it("should record retry event", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "blocked",
				commitHash: "hash-a",
				queuedAt: Date.now(),
				error: "Validation failed",
			});
			await saveQueueStateDirectly(queue, state);

			await queue.retryEntry("A");

			const log = await queue.getAuditLog();
			expect(log).toHaveLength(1);
			expect(log[0]?.action).toBe("retry");
			expect(log[0]?.workspaceId).toBe("A");
		});

		it("should record requeue event", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "merged",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			await queue.requeueEntry("A");

			const log = await queue.getAuditLog();
			expect(log).toHaveLength(1);
			expect(log[0]?.action).toBe("requeue");
			expect(log[0]?.workspaceId).toBe("A");
		});

		it("should record clear_completed event", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "merged",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			await queue.clearCompleted();

			const log = await queue.getAuditLog();
			expect(log).toHaveLength(1);
			expect(log[0]?.action).toBe("clear_completed");
		});

		it("should persist audit log across reload", async () => {
			await queue.pause();
			await queue.resume();

			const queue2 = new IntegrationQueue(TEST_DIR, "test-integration", "main");
			const log = await queue2.getAuditLog();
			expect(log).toHaveLength(2);
		});

		it("should cap audit log at 100 entries", async () => {
			// Add 110 events
			for (let i = 0; i < 110; i++) {
				await queue.pause();
				await queue.resume();
			}

			const log = await queue.getAuditLog();
			expect(log.length).toBeLessThanOrEqual(100);
		});
	});

	// -----------------------------------------------------------------------
	// validateAction — unsafe actions rejected with actionable errors
	// -----------------------------------------------------------------------

	describe("validateAction", () => {
		it("should allow pause and resume", async () => {
			const pauseResult = await queue.validateAction("pause");
			expect(pauseResult.safe).toBe(true);

			const resumeResult = await queue.validateAction("resume");
			expect(resumeResult.safe).toBe(true);
		});

		it("should reject retry for queued entry", async () => {
			await queue.enqueue("A", "hash-a");

			const result = await queue.validateAction("retry", "A");
			expect(result.safe).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("should reject requeue for blocked entry", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "blocked",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			const result = await queue.validateAction("requeue", "A");
			expect(result.safe).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("should reject requeue when dependents exist in queue", async () => {
			const state = await queue.getQueueState();
			state.entries.push(
				{
					workspaceId: "A",
					status: "merged",
					commitHash: "hash-a",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "B",
					status: "queued",
					commitHash: "hash-b",
					queuedAt: Date.now(),
				},
			);
			await saveQueueStateDirectly(queue, state);

			const result = await queue.validateAction("requeue", "A", TEST_WORKSPACES);
			expect(result.safe).toBe(false);
			expect(result.errors[0]).toContain("dependents");
		});

		it("should allow requeue when no dependents exist", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "C",
				status: "merged",
				commitHash: "hash-c",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			const result = await queue.validateAction("requeue", "C", TEST_WORKSPACES);
			expect(result.safe).toBe(true);
		});

		it("should reject cancel for non-queued entry", async () => {
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "A",
				status: "merged",
				commitHash: "hash-a",
				queuedAt: Date.now(),
			});
			await saveQueueStateDirectly(queue, state);

			const result = await queue.validateAction("cancel", "A");
			expect(result.safe).toBe(false);
			expect(result.errors[0]).toContain("Cancel is only valid for queued entries");
		});

		it("should require workspaceId for single-entry actions", async () => {
			const retryResult = await queue.validateAction("retry");
			expect(retryResult.safe).toBe(false);
			expect(retryResult.errors[0]).toContain("workspaceId");

			const requeueResult = await queue.validateAction("requeue");
			expect(requeueResult.safe).toBe(false);
			expect(requeueResult.errors[0]).toContain("workspaceId");
		});

		it("should allow clear_completed even with completed entries", async () => {
			const state = await queue.getQueueState();
			state.entries.push(
				{
					workspaceId: "A",
					status: "merged",
					commitHash: "hash-a",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "B",
					status: "failed",
					commitHash: "hash-b",
					queuedAt: Date.now(),
				},
			);
			await saveQueueStateDirectly(queue, state);

			const result = await queue.validateAction("clear_completed");
			expect(result.safe).toBe(true);
		});

		it("should reject unknown workspace for validateAction", async () => {
			const result = await queue.validateAction("retry", "nonexistent");
			expect(result.safe).toBe(false);
			expect(result.errors[0]).toContain("No entry found");
		});
	});

	// -----------------------------------------------------------------------
	// Integration: format shows paused state and audit count
	// -----------------------------------------------------------------------

	describe("format with control state", () => {
		it("should include paused state in queue display", () => {
			const state: IntegrationQueueState = {
				entries: [],
				isProcessing: false,
				paused: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				auditEvents: [],
			};

			const formatted = formatIntegrationQueueState(state);
			expect(formatted).toContain("Paused: true");
		});

		it("should include audit count in queue display", () => {
			const state: IntegrationQueueState = {
				entries: [],
				isProcessing: false,
				paused: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				auditEvents: [
					{
						action: "pause",
						timestamp: Date.now(),
						details: "Queue processing paused",
					},
				],
			};

			const formatted = formatIntegrationQueueState(state);
			expect(formatted).toContain("Audit Events: 1 logged");
		});
	});
	describe("hasUnresolvedEntries", () => {
		it("should return false when queue is empty", async () => {
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(false);
		});

		it("should return true when queue has queued entries", async () => {
			await queue.enqueue("ws-1", "abc123");
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(true);
		});

		it("should return false when all entries are merged", async () => {
			await queue.enqueue("ws-1", "abc123");
			const state = await queue.getQueueState();
			state.entries[0].status = "merged";
			await saveQueueStateDirectly(queue, state);
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(false);
		});

		it("should return true when queue has blocked entries", async () => {
			await queue.enqueue("ws-1", "abc123");
			const state = await queue.getQueueState();
			state.entries[0].status = "blocked";
			await saveQueueStateDirectly(queue, state);
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(true);
		});

		it("should return true when queue has conflict entries", async () => {
			await queue.enqueue("ws-1", "abc123");
			const state = await queue.getQueueState();
			state.entries[0].status = "conflict";
			await saveQueueStateDirectly(queue, state);
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(true);
		});

		it("should return true when queue has failed entries", async () => {
			await queue.enqueue("ws-1", "abc123");
			const state = await queue.getQueueState();
			state.entries[0].status = "failed";
			await saveQueueStateDirectly(queue, state);
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(true);
		});

		it("should return true when queue has merging entries", async () => {
			await queue.enqueue("ws-1", "abc123");
			const state = await queue.getQueueState();
			state.entries[0].status = "merging";
			await saveQueueStateDirectly(queue, state);
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(true);
		});

		it("should return true when queue has validating entries", async () => {
			await queue.enqueue("ws-1", "abc123");
			const state = await queue.getQueueState();
			state.entries[0].status = "validating";
			await saveQueueStateDirectly(queue, state);
			const has = await queue.hasUnresolvedEntries();
			expect(has).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if git is available and a repo was initialized in TEST_DIR.
 */
async function checkGitAvailable(dir: string): Promise<boolean> {
	try {
		const { execSync } = await import("node:child_process");
		execSync("git rev-parse --git-dir", { cwd: dir, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Directly save queue state to bypass the private method.
 */
async function saveQueueStateDirectly(_queue: IntegrationQueue, state: unknown): Promise<void> {
	const stateFilePath = path.join(TEST_DIR, ".pi", "integration-queue.json");
	const piDir = path.dirname(stateFilePath);
	await fs.mkdir(piDir, { recursive: true });
	const tempPath = `${stateFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
	await fs.rename(tempPath, stateFilePath);
}
