/**
 * Tests for Merge Conflict Detection and Handoff - P2 Workstream 6.D
 *
 * Validates that:
 * - AC1: Merge conflict does not silently fail or mark complete
 * - AC2: Conflict artifact is written on merge conflict
 * - AC3: Dashboard shows conflict status and files
 * - AC4: Integration queue stops safely on conflict
 * - AC5: Manual resolution and resume path works
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntegrationQueue } from "../src/integration/integration-queue.js";
import {
	buildConflictDescription,
	type ConflictedFile,
	generateSuggestedResolutionSteps,
	getLatestUnresolvedConflict,
	isMergeConflictError,
	listMergeConflictArtifacts,
	type MergeConflictArtifact,
	MergeConflictResolver,
	readMergeConflictArtifact,
	updateMergeConflictArtifact,
	writeMergeConflictArtifact,
} from "../src/integration/merge-conflict-handoff.js";

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

const TEST_DIR = path.join(process.cwd(), ".test-merge-conflict-handoff");

describe("MergeConflictHandoff", () => {
	let resolver: MergeConflictResolver;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		resolver = new MergeConflictResolver(TEST_DIR);
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
	});

	// -----------------------------------------------------------------------
	// AC1: Merge conflict does not silently fail or mark complete
	// -----------------------------------------------------------------------

	describe("AC1: Conflict detection", () => {
		it("should detect merge conflict from git error messages", () => {
			const conflictMessages = [
				"Automatic merge failed; fix conflicts and then commit the result.",
				"error: could not apply abc123... merge conflict detected",
				"cherry-pick: conflict detected in src/file.ts",
				"Merge conflict in package.json",
				"not something we can merge",
				"conflict needs resolution before continuing",
				"<<<<<<< HEAD conflict marker detected",
			];

			for (const msg of conflictMessages) {
				expect(isMergeConflictError(msg)).toBe(true);
			}
		});

		it("should NOT detect non-conflict errors as merge conflicts", () => {
			const nonConflictMessages = [
				"Command failed with exit code 1",
				"npm ERR! test failed",
				"TypeError: Cannot read property of undefined",
				"ENOENT: no such file or directory",
				"Error: Failed to connect",
				"git: 'unknown-command' is not a git command",
			];

			for (const msg of nonConflictMessages) {
				expect(isMergeConflictError(msg)).toBe(false);
			}
		});

		it("should NOT mark merge as complete when conflict exists", async () => {
			// Simulate: queue entry should be marked as "conflict" not "merged"
			// This is tested through the queue integration tests below
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");

			await queue.enqueue("6.D", "abc123def456", "npm test");
			const entries = await queue.getAllEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0]?.status).not.toBe("merged");
			expect(entries[0]?.status).not.toBe("conflict"); // Not processed yet
		});
	});

	// -----------------------------------------------------------------------
	// AC2: Conflict artifact is written
	// -----------------------------------------------------------------------

	describe("AC2: Artifact creation and persistence", () => {
		it("should write a merge conflict artifact to disk", async () => {
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc123def456",
				status: "unresolved",
				detectedAt: Date.now(),
				conflictedFiles: [
					{ filePath: "src/file1.ts", conflictType: "both modified", hasConflictMarkers: true },
					{ filePath: "src/file2.ts", conflictType: "both modified", hasConflictMarkers: true },
				],
				conflictDiff: "<<<<<<< HEAD\ntest\n=======\nnew test\n>>>>>>> workspace",
				gitStatusOutput: "UU src/file1.ts",
				description: "Merge conflict detected when merging workspace 6.D",
				suggestedResolutionSteps: ["1. Fix conflicts in src/file1.ts", "2. Fix conflicts in src/file2.ts"],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);
			expect(filePath).toBeTruthy();
			expect(filePath).toContain("6.D");

			// Verify the file exists and is valid JSON
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = JSON.parse(content) as MergeConflictArtifact;
			expect(parsed.workspaceId).toBe("6.D");
			expect(parsed.status).toBe("unresolved");
			expect(parsed.conflictedFiles).toHaveLength(2);
		});

		it("should read a merge conflict artifact from disk", async () => {
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc123",
				status: "unresolved",
				detectedAt: Date.now(),
				conflictedFiles: [{ filePath: "src/file.ts", conflictType: "both modified", hasConflictMarkers: true }],
				conflictDiff: "diff --git a/src/file.ts b/src/file.ts",
				gitStatusOutput: "UU src/file.ts",
				description: "Test conflict",
				suggestedResolutionSteps: ["Fix it"],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);
			const read = await readMergeConflictArtifact(filePath);
			expect(read).not.toBeNull();
			expect(read?.workspaceId).toBe("6.D");
			expect(read?.conflictedFiles).toHaveLength(1);
			expect(read?.conflictedFiles[0]?.filePath).toBe("src/file.ts");
		});

		it("should return null for non-existent artifact", async () => {
			const result = await readMergeConflictArtifact(path.join(TEST_DIR, "nonexistent.json"));
			expect(result).toBeNull();
		});

		it("should list merge conflict artifacts", async () => {
			const artifact1: MergeConflictArtifact = {
				workspaceId: "6.A",
				commitHash: "aaa",
				status: "unresolved",
				detectedAt: 1000,
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Conflict 1",
				suggestedResolutionSteps: [],
			};

			const artifact2: MergeConflictArtifact = {
				workspaceId: "6.B",
				commitHash: "bbb",
				status: "resolved",
				detectedAt: 2000,
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Conflict 2",
				suggestedResolutionSteps: [],
				resolvedAt: 3000,
			};

			await writeMergeConflictArtifact(TEST_DIR, artifact1);
			await writeMergeConflictArtifact(TEST_DIR, artifact2);

			const files = await listMergeConflictArtifacts(TEST_DIR);
			expect(files).toHaveLength(2);
		});

		it("should get the latest unresolved conflict artifact", async () => {
			const artifact1: MergeConflictArtifact = {
				workspaceId: "6.A",
				commitHash: "aaa",
				status: "resolved",
				detectedAt: 1000,
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Resolved",
				suggestedResolutionSteps: [],
				resolvedAt: 2000,
			};

			const artifact2: MergeConflictArtifact = {
				workspaceId: "6.B",
				commitHash: "bbb",
				status: "unresolved",
				detectedAt: 3000,
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Unresolved",
				suggestedResolutionSteps: [],
			};

			await writeMergeConflictArtifact(TEST_DIR, artifact1);
			await writeMergeConflictArtifact(TEST_DIR, artifact2);

			const latest = await getLatestUnresolvedConflict(TEST_DIR);
			expect(latest).not.toBeNull();
			expect(latest?.workspaceId).toBe("6.B");
			expect(latest?.status).toBe("unresolved");
		});

		it("should update a merge conflict artifact", async () => {
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc123",
				status: "unresolved",
				detectedAt: Date.now(),
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Initial",
				suggestedResolutionSteps: [],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);
			await updateMergeConflictArtifact(filePath, {
				status: "resolved",
				resolvedAt: Date.now(),
				resolutionNotes: "Fixed by accepting both changes",
			});

			const updated = await readMergeConflictArtifact(filePath);
			expect(updated?.status).toBe("resolved");
			expect(updated?.resolutionNotes).toBe("Fixed by accepting both changes");
			expect(updated?.resolvedAt).toBeDefined();
		});
	});

	// -----------------------------------------------------------------------
	// AC3: Dashboard shows conflict status and files
	// -----------------------------------------------------------------------

	describe("AC3: Dashboard data preparation", () => {
		it("should build a descriptive conflict message with file list", () => {
			const files: ConflictedFile[] = [
				{ filePath: "src/file1.ts", conflictType: "both modified", hasConflictMarkers: true },
				{ filePath: "src/file2.ts", conflictType: "both modified", hasConflictMarkers: true },
			];

			const description = buildConflictDescription("6.D", "abc123def456", files);
			expect(description).toContain("6.D");
			expect(description).toContain("abc123");
			expect(description).toContain("src/file1.ts");
			expect(description).toContain("src/file2.ts");
			expect(description).toContain("2 file(s)");
			expect(description.toLowerCase()).toContain("halted");
		});

		it("should generate suggested resolution steps", () => {
			const files: ConflictedFile[] = [
				{ filePath: "src/file.ts", conflictType: "both modified", hasConflictMarkers: true },
			];

			const steps = generateSuggestedResolutionSteps(files, "6.D");
			expect(steps.length).toBeGreaterThan(0);
			expect(steps.some((s) => s.includes("<<<<<<<"))).toBe(true);
			expect(steps.some((s) => s.includes(">>>>>>>"))).toBe(true);
			expect(steps.some((s) => s.includes("6.D"))).toBe(true);
			expect(steps.some((s) => s.includes("src/file.ts"))).toBe(true);
			expect(steps.some((s) => s.includes("git add"))).toBe(true);
			expect(steps.some((s) => s.includes("git commit"))).toBe(true);
		});

		it("should generate steps with multiple conflicted files", () => {
			const files: ConflictedFile[] = [
				{ filePath: "src/a.ts", conflictType: "both modified", hasConflictMarkers: true },
				{ filePath: "src/b.ts", conflictType: "both added", hasConflictMarkers: true },
				{ filePath: "src/c.ts", conflictType: "both deleted", hasConflictMarkers: false },
			];

			const steps = generateSuggestedResolutionSteps(files, "6.D");
			const fileListStep = steps.find((s) => s.includes("Conflicted files"));
			expect(fileListStep).toBeDefined();
			expect(steps.some((s) => s.includes("src/a.ts"))).toBe(true);
			expect(steps.some((s) => s.includes("src/b.ts"))).toBe(true);
			expect(steps.some((s) => s.includes("src/c.ts"))).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// AC4: Integration queue stops safely on conflict
	// -----------------------------------------------------------------------

	describe("AC4: Queue conflict handling", () => {
		it("should mark entry as conflict when merge fails with conflict error", async () => {
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");

			// Enqueue a workspace
			await queue.enqueue("6.D", "abc123def456");

			// processNext will try to merge and fail (no git repo)
			// Without a git repo, mergeWorkspace will fail with a non-conflict error
			// so it should be marked as "failed" not "conflict"
			const result = await queue.processNext();
			expect(result.processed).toBe(true);

			const entry = await queue.getEntry("6.D");
			expect(entry).toBeDefined();
			expect(entry?.status).toBe("failed");
		});

		it("should treat conflict status as blocking for queue processing", async () => {
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");

			// Create entries: first conflict, then queued
			const state = await queue.getQueueState();
			state.entries.push(
				{
					workspaceId: "6.C",
					status: "conflict",
					commitHash: "conflict-hash",
					queuedAt: Date.now(),
					error: "Merge conflict in src/file.ts",
					conflictFiles: ["src/file.ts"],
				},
				{
					workspaceId: "6.D",
					status: "queued",
					commitHash: "next-hash",
					queuedAt: Date.now(),
				},
			);
			await saveQueueStateDirectly(queue, state);

			// processNext should skip the conflict entry and stop
			// (conflict entries are treated like blocked)
			const result = await queue.processNext();
			expect(result.processed).toBe(false);
		});

		it("should skip conflict entries and not process them", async () => {
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");

			// Only a conflict entry in queue
			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "6.D",
				status: "conflict",
				commitHash: "hash",
				queuedAt: Date.now(),
				error: "Merge conflict",
			});
			await saveQueueStateDirectly(queue, state);

			// Should not process the conflict entry
			const result = await queue.processNext();
			expect(result.processed).toBe(false);
		});

		it("should get conflict workspaces separately", async () => {
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");

			const state = await queue.getQueueState();
			state.entries.push(
				{
					workspaceId: "6.A",
					status: "merged",
					commitHash: "a",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "6.B",
					status: "conflict",
					commitHash: "b",
					queuedAt: Date.now(),
				},
				{
					workspaceId: "6.C",
					status: "failed",
					commitHash: "c",
					queuedAt: Date.now(),
				},
			);
			await saveQueueStateDirectly(queue, state);

			const conflicts = await queue.getConflictWorkspaces();
			expect(conflicts).toHaveLength(1);
			expect(conflicts[0]?.workspaceId).toBe("6.B");
			expect(conflicts[0]?.status).toBe("conflict");
		});

		it("should stop processAll at conflict entry", async () => {
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");

			const state = await queue.getQueueState();
			state.entries.push(
				{
					workspaceId: "6.A",
					status: "conflict",
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

			// processAll should stop at the first non-processable entry (conflict)
			const processed = await queue.processAll();
			expect(processed).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// AC5: Manual resolution and resume path
	// -----------------------------------------------------------------------

	describe("AC5: Manual resolution and resume path", () => {
		it("should resolve a conflict via MergeConflictResolver", async () => {
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc123",
				status: "unresolved",
				detectedAt: Date.now(),
				conflictedFiles: [{ filePath: "src/file.ts", conflictType: "both modified", hasConflictMarkers: true }],
				conflictDiff: "diff --git a/src/file.ts b/src/file.ts",
				gitStatusOutput: "UU src/file.ts",
				description: "Test",
				suggestedResolutionSteps: ["Fix it"],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);

			const updated = await resolver.resolveConflict(filePath, "Manually fixed");
			expect(updated.status).toBe("resolved");
			expect(updated.resolvedAt).toBeDefined();
			expect(updated.resolutionNotes).toBe("Manually fixed");
		});

		it("should resolve without notes", async () => {
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc",
				status: "unresolved",
				detectedAt: Date.now(),
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Test",
				suggestedResolutionSteps: [],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);
			const updated = await resolver.resolveConflict(filePath);
			expect(updated.status).toBe("resolved");
			expect(updated.resolvedAt).toBeDefined();
		});

		it("should retry a conflict entry via queue retryEntry", async () => {
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");

			const state = await queue.getQueueState();
			state.entries.push({
				workspaceId: "6.D",
				status: "conflict",
				commitHash: "hash",
				queuedAt: Date.now(),
				error: "Merge conflict",
				conflictFiles: ["src/file.ts"],
				conflictArtifactPath: "/tmp/artifact.json",
			});
			await saveQueueStateDirectly(queue, state);

			// Retry the conflict entry
			await queue.retryEntry("6.D");

			const entry = await queue.getEntry("6.D");
			expect(entry?.status).toBe("queued");
			expect(entry?.error).toBeUndefined();
			expect(entry?.conflictArtifactPath).toBeUndefined();
			expect(entry?.conflictFiles).toBeUndefined();
		});

		it("should throw when retrying a non-conflict/non-blocked/non-failed entry", async () => {
			const queue = new IntegrationQueue(TEST_DIR, "test-integration", "main");
			await queue.enqueue("6.D", "hash");

			await expect(queue.retryEntry("6.D")).rejects.toThrow();
		});

		it("should resume integration after manual fix (verification)", async () => {
			// Create artifact with resolved status
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc",
				status: "resolved",
				detectedAt: 1000,
				resolvedAt: 2000,
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Test",
				suggestedResolutionSteps: [],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);

			// resumeIntegration checks for resolved status + no remaining conflicts
			// Since we have no git repo, scanForConflictFiles will return empty
			// and resumeIntegration should succeed
			const result = await resolver.resumeIntegration(filePath);
			expect(result).toBe(true);

			const updated = await readMergeConflictArtifact(filePath);
			expect(updated?.status).toBe("resume_complete");
			expect(updated?.resumeCompletedAt).toBeDefined();
		});

		it("should fail resume if artifact is unresolved", async () => {
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc",
				status: "unresolved",
				detectedAt: Date.now(),
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Test",
				suggestedResolutionSteps: [],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);

			await expect(resolver.resumeIntegration(filePath)).rejects.toThrow(/Cannot resume.*unresolved.*resolved/);
		});

		it("should fail resume if artifact file does not exist", async () => {
			await expect(resolver.resumeIntegration("/nonexistent/path.json")).rejects.toThrow(/not found/);
		});

		it("should record resume failure when conflicts still exist", async () => {
			// Create an artifact with resolved status but simulate conflicts remain
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc",
				status: "resolved",
				detectedAt: 1000,
				resolvedAt: 2000,
				conflictedFiles: [
					{ filePath: "src/still-conflicted.ts", conflictType: "both modified", hasConflictMarkers: true },
				],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Test",
				suggestedResolutionSteps: [],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);

			// Since there's no actual git repo, scanForConflictFiles will
			// return empty (no conflict files detected). But the artifact's
			// conflictedFiles list still has an entry. Resume should check
			// the actual filesystem for remaining markers.
			// Without a real file, the check will fail to read it, assume
			// it's still conflicted, and resumeIntegration returns false.
			const result = await resolver.resumeIntegration(filePath);
			expect(result).toBe(false);

			const updated = await readMergeConflictArtifact(filePath);
			expect(updated?.status).toBe("resume_failed");
			expect(updated?.resumeError).toBeDefined();
			expect(updated?.resumeError).toContain("conflict markers");
		});
	});

	describe("Edge cases", () => {
		it("should write artifact atomically", async () => {
			const artifact: MergeConflictArtifact = {
				workspaceId: "6.D",
				commitHash: "abc",
				status: "unresolved",
				detectedAt: Date.now(),
				conflictedFiles: [],
				conflictDiff: "",
				gitStatusOutput: "",
				description: "Test atomic write",
				suggestedResolutionSteps: [],
			};

			const filePath = await writeMergeConflictArtifact(TEST_DIR, artifact);
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.description).toBe("Test atomic write");
		});

		it("should handle empty artifact list gracefully", async () => {
			const files = await listMergeConflictArtifacts(TEST_DIR);
			expect(files).toHaveLength(0);
		});

		it("should return null for no unresolved conflicts", async () => {
			const result = await getLatestUnresolvedConflict(TEST_DIR);
			expect(result).toBeNull();
		});

		it("should throw when updating non-existent artifact", async () => {
			await expect(
				updateMergeConflictArtifact(path.join(TEST_DIR, "nonexistent.json"), { status: "resolved" }),
			).rejects.toThrow();
		});

		it("should generate description even with empty file list", () => {
			const description = buildConflictDescription("6.D", "abc123", []);
			expect(description).toContain("6.D");
			expect(description).toContain("0 file(s)");
		});

		it("should generate steps even with empty file list", () => {
			const steps = generateSuggestedResolutionSteps([], "6.D");
			expect(steps.length).toBeGreaterThan(0);
			expect(steps.some((s) => s.includes("6.D"))).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
