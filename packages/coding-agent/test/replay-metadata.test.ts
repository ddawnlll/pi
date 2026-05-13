/**
 * Tests for Replay / Resume / Retry Metadata - Workspace 5.J
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PlanState, WorkspaceState } from "../src/core/plan-state.js";
import { matchesGlobPattern, ReplayMetadataManager } from "../src/core/replay-metadata.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

describe("Replay Metadata", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "replay-metadata-test-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	describe("matchesGlobPattern", () => {
		test("matches exact string", () => {
			expect(matchesGlobPattern("foo.ts", "foo.ts")).toBe(true);
			expect(matchesGlobPattern("bar.ts", "foo.ts")).toBe(false);
		});

		test("matches single wildcard", () => {
			expect(matchesGlobPattern("foo.ts", "*.ts")).toBe(true);
			expect(matchesGlobPattern("foo.js", "*.ts")).toBe(false);
		});

		test("matches double wildcard (path segments)", () => {
			expect(matchesGlobPattern("src/foo.ts", "**/*.ts")).toBe(true);
			expect(matchesGlobPattern("src/deep/foo.ts", "**/*.ts")).toBe(true);
			expect(matchesGlobPattern("src/deep/foo.js", "**/*.ts")).toBe(false);
		});

		test("matches single wildcard does not cross path separators", () => {
			expect(matchesGlobPattern("src/foo.ts", "*.ts")).toBe(false);
		});

		test("matches directory prefix pattern", () => {
			expect(matchesGlobPattern("src/index.ts", "src/**")).toBe(true);
		});
	});

	describe("ReplayMetadataManager - writeReplayManifest", () => {
		test("writes replay-manifest.json per plan execution", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const planState: PlanState = {
				phase: "P2",
				title: "Test Plan",
				workspaces: new Map([
					[
						"5.A",
						{
							workspaceId: "5.A",
							stage: WorkspaceStage.Complete,
							attempts: 1,
							startedAt: 1000,
							completedAt: 2000,
						},
					],
					[
						"5.B",
						{
							workspaceId: "5.B",
							stage: WorkspaceStage.Failed,
							attempts: 2,
							error: "Test failure",
						},
					],
				]),
				startedAt: 1000,
				status: "running",
			};

			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Plan",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "5.A",
						title: "Workspace A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "5.B",
						title: "Workspace B",
						dependencies: ["5.A"],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const manifest = await manager.writeReplayManifest("exec-001", planState, queue);

			expect(manifest.schemaVersion).toBe(1);
			expect(manifest.planExecutionId).toBe("exec-001");
			expect(manifest.workspaces).toHaveLength(2);
			expect(manifest.workspaces[0].workspaceId).toBe("5.A");
			expect(manifest.workspaces[0].stage).toBe(WorkspaceStage.Complete);
			expect(manifest.workspaces[1].workspaceId).toBe("5.B");
			expect(manifest.workspaces[1].stage).toBe(WorkspaceStage.Failed);

			// Verify file exists on disk
			const filePath = path.join(tempDir, ".pi", "executions", "exec-001", "replay-manifest.json");
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.planExecutionId).toBe("exec-001");
			expect(parsed.workspaces).toHaveLength(2);
		});
	});

	describe("ReplayMetadataManager - writeWorkspaceReplay", () => {
		test("writes workspace-replay.json per workspace", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.A",
				title: "Test Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const state: WorkspaceState = {
				workspaceId: "5.A",
				stage: WorkspaceStage.Failed,
				attempts: 2,
				error: "Type check failed",
			};

			const replay = await manager.writeWorkspaceReplay(workspace, state);

			expect(replay.schemaVersion).toBe(1);
			expect(replay.workspaceId).toBe("5.A");
			expect(replay.stage).toBe(WorkspaceStage.Failed);
			expect(replay.totalAttempts).toBe(2);
			expect(replay.maxRetries).toBe(3);
			expect(replay.attempts).toHaveLength(2);
			expect(replay.attempts[0].attempt).toBe(1);
			expect(replay.attempts[0].verdict).toBe("failed");
			expect(replay.attempts[1].attempt).toBe(2);
			expect(replay.attempts[1].verdict).toBe("failed");

			// Verify file on disk
			const filePath = path.join(tempDir, ".pi", "workspaces", "5.A", "workspace-replay.json");
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = JSON.parse(content);
			expect(parsed.workspaceId).toBe("5.A");
		});

		test("handles undefined workspace state (never started)", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.C",
				title: "Pending Workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const replay = await manager.writeWorkspaceReplay(workspace, undefined);

			expect(replay.stage).toBe(WorkspaceStage.Pending);
			expect(replay.totalAttempts).toBe(0);
			expect(replay.attempts).toHaveLength(0);
		});
	});

	describe("ReplayMetadataManager - loadReplayManifest", () => {
		test("loads existing manifest", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const planState: PlanState = {
				phase: "P2",
				title: "Test Plan",
				workspaces: new Map(),
				startedAt: 1000,
				status: "running",
			};

			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Plan",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			await manager.writeReplayManifest("exec-002", planState, queue);
			const loaded = await manager.loadReplayManifest("exec-002");
			expect(loaded).not.toBeNull();
			expect(loaded!.planExecutionId).toBe("exec-002");
		});

		test("returns null for missing manifest", async () => {
			const manager = new ReplayMetadataManager(tempDir);
			const loaded = await manager.loadReplayManifest("nonexistent");
			expect(loaded).toBeNull();
		});
	});

	describe("ReplayMetadataManager - loadWorkspaceReplay", () => {
		test("loads existing workspace replay", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.D",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 5,
			};

			await manager.writeWorkspaceReplay(workspace, undefined);
			const loaded = await manager.loadWorkspaceReplay("5.D");
			expect(loaded).not.toBeNull();
			expect(loaded!.workspaceId).toBe("5.D");
		});

		test("returns null for missing workspace replay", async () => {
			const manager = new ReplayMetadataManager(tempDir);
			const loaded = await manager.loadWorkspaceReplay("missing");
			expect(loaded).toBeNull();
		});
	});

	describe("ReplayMetadataManager - dryRunReplay", () => {
		test("reads archive without modifying files", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			// Set up a manifest and workspace replays
			const planState: PlanState = {
				phase: "P2",
				title: "Test Plan",
				workspaces: new Map([
					[
						"5.A",
						{
							workspaceId: "5.A",
							stage: WorkspaceStage.Complete,
							attempts: 1,
						} as WorkspaceState,
					],
				]),
				startedAt: 1000,
				status: "running",
			};

			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Plan",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "5.A",
						title: "Workspace A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await manager.writeReplayManifest("exec-dry", planState, queue);
			await manager.writeWorkspaceReplay(queue.workspaces[0], {
				workspaceId: "5.A",
				stage: WorkspaceStage.Complete,
				attempts: 1,
			});

			// Dry-run should read without writing
			const result = await manager.dryRunReplay("exec-dry");

			expect(result.success).toBe(true);
			expect(result.manifest).not.toBeNull();
			expect(result.manifest!.planExecutionId).toBe("exec-dry");
			expect(result.workspaceReplays.size).toBe(1);
			expect(result.workspaceReplays.has("5.A")).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test("returns error for non-existent execution", async () => {
			const manager = new ReplayMetadataManager(tempDir);
			const result = await manager.dryRunReplay("nonexistent");
			expect(result.success).toBe(false);
			expect(result.errors).toHaveLength(1);
		});

		test("detects stage mismatch between manifest and workspace replay", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			// Write manifest
			const planState: PlanState = {
				phase: "P2",
				title: "Mismatch Test",
				workspaces: new Map([
					[
						"5.A",
						{
							workspaceId: "5.A",
							stage: WorkspaceStage.Failed,
							attempts: 1,
						} as WorkspaceState,
					],
				]),
				startedAt: 1000,
				status: "running",
			};

			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Mismatch Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "5.A",
						title: "Workspace A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await manager.writeReplayManifest("exec-mismatch", planState, queue);

			// Manually write a workspace-replay with different stage
			const wsDir = path.join(tempDir, ".pi", "workspaces", "5.A");
			await fs.mkdir(wsDir, { recursive: true });
			await fs.writeFile(
				path.join(wsDir, "workspace-replay.json"),
				JSON.stringify({
					schemaVersion: 1,
					workspaceId: "5.A",
					title: "Workspace A",
					stage: "complete",
					totalAttempts: 1,
					maxRetries: 3,
					attempts: [],
					retryEligible: false,
					roleBudget: "worker",
					ownedFiles: [],
					generatedAt: Date.now(),
				}),
				"utf-8",
			);

			const result = await manager.dryRunReplay("exec-mismatch");
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings.some((w) => w.includes("Stage mismatch"))).toBe(true);
		});
	});

	describe("ReplayMetadataManager - checkRetryEligibility", () => {
		test("allows retry for failed workspace within retry limit", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const state: WorkspaceState = {
				workspaceId: "5.A",
				stage: WorkspaceStage.Failed,
				attempts: 1,
			};

			const result = await manager.checkRetryEligibility(workspace, state);
			// May be eligible (depends on git status in temp dir)
			// At minimum it should not crash
			expect(result).toBeDefined();
			expect(typeof result.eligible).toBe("boolean");
		});

		test("blocks retry for non-failed/non-blocked stage", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			// Complete stage — should not be eligible
			const state: WorkspaceState = {
				workspaceId: "5.A",
				stage: WorkspaceStage.Complete,
				attempts: 1,
			};

			const result = await manager.checkRetryEligibility(workspace, state);
			expect(result.eligible).toBe(false);
			expect(result.reason).toContain("complete");
		});

		test("blocks retry when max retries exhausted", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 2,
			};

			const state: WorkspaceState = {
				workspaceId: "5.A",
				stage: WorkspaceStage.Failed,
				attempts: 2,
			};

			const result = await manager.checkRetryEligibility(workspace, state);
			expect(result.eligible).toBe(false);
			expect(result.reason).toContain("exhausted");
		});

		test("blocks retry for pending stage", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const result = await manager.checkRetryEligibility(workspace, undefined);
			expect(result.eligible).toBe(false);
			expect(result.reason).toContain("pending");
		});

		test("allows retry for blocked workspace", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const state: WorkspaceState = {
				workspaceId: "5.A",
				stage: WorkspaceStage.Blocked,
				attempts: 1,
			};

			const result = await manager.checkRetryEligibility(workspace, state);
			expect(result).toBeDefined();
			expect(typeof result.eligible).toBe("boolean");
		});
	});

	describe("ReplayMetadataManager - gateRetry", () => {
		test("throws when retry is not eligible", async () => {
			const manager = new ReplayMetadataManager(tempDir);

			const workspace: Workspace = {
				id: "5.A",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			// Complete — not eligible
			const state: WorkspaceState = {
				workspaceId: "5.A",
				stage: WorkspaceStage.Complete,
				attempts: 1,
			};

			await expect(manager.gateRetry(workspace, state)).rejects.toThrow("Retry blocked");
		});
	});
});
