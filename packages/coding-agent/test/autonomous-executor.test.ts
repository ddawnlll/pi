/**
 * Tests for Autonomous Execution Loop - P2 Workstream 7.F
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AutonomousExecutor, createAutonomousExecutor } from "../src/core/autonomous-executor.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-autonomous-executor");

describe("AutonomousExecutor", () => {
	let executor: AutonomousExecutor;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		executor = new AutonomousExecutor(TEST_DIR, 3);
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	describe("initialization", () => {
		it("should initialize with a workspace queue", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			const state = executor.getState();
			expect(state).toBeDefined();
			expect(state?.phase).toBe("P2");
			expect(state?.workspaces.size).toBe(1);
		});
	});

	describe("workspace execution", () => {
		it("should execute a workspace", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			const result = await executor.executeWorkspace(queue.workspaces[0]);

			expect(result.success).toBe(true);
			expect(result.verdict).toBe("COMPLETE");
			expect(result.workspaceId).toBe("7.A");
		});

		it("should create workspace snapshot directory", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);
			await executor.executeWorkspace(queue.workspaces[0]);

			const snapshotDir = path.join(TEST_DIR, ".pi", "workspaces", "7.A");
			const exists = await fs
				.access(snapshotDir)
				.then(() => true)
				.catch(() => false);

			expect(exists).toBe(true);
		});

		it("should save packet snapshot", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);
			await executor.executeWorkspace(queue.workspaces[0]);

			const packetPath = path.join(TEST_DIR, ".pi", "workspaces", "7.A", "packet.json");
			const packetContent = await fs.readFile(packetPath, "utf-8");
			const packet = JSON.parse(packetContent);

			expect(packet.packet).toBeDefined();
			expect(packet.hash).toBeDefined();
			expect(packet.packet.workspaceId).toBe("7.A");
		});

		it("should save workspace report", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);
			await executor.executeWorkspace(queue.workspaces[0]);

			const reportPath = path.join(TEST_DIR, ".pi", "workspaces", "7.A", "report.md");
			const reportContent = await fs.readFile(reportPath, "utf-8");

			expect(reportContent).toContain("# Workspace 7.A");
			expect(reportContent).toContain("Task A");
		});

		it("should transition workspace state correctly", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			const stateBefore = executor.getState();
			expect(stateBefore?.workspaces.get("7.A")?.stage).toBe(WorkspaceStage.Pending);

			await executor.executeWorkspace(queue.workspaces[0]);

			const stateAfter = executor.getState();
			expect(stateAfter?.workspaces.get("7.A")?.stage).toBe(WorkspaceStage.Complete);
		});
	});

	describe("scheduling", () => {
		it("should get next eligible workspaces", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.B",
						title: "Task B",
						dependencies: ["7.A"],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			const eligible = executor.getNextWorkspaces(queue.workspaces);

			// Only 7.A should be eligible (7.B depends on 7.A)
			expect(eligible).toHaveLength(1);
			expect(eligible[0].id).toBe("7.A");
		});

		it("should schedule dependent workspace after dependency completes", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.B",
						title: "Task B",
						dependencies: ["7.A"],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			// Execute 7.A
			await executor.executeWorkspace(queue.workspaces[0]);

			// Now 7.B should be eligible
			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible).toHaveLength(1);
			expect(eligible[0].id).toBe("7.B");
		});
	});

	describe("execution completion", () => {
		it("should detect when execution is complete", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			expect(executor.isExecutionComplete()).toBe(false);

			await executor.executeWorkspace(queue.workspaces[0]);

			expect(executor.isExecutionComplete()).toBe(true);
		});

		it("should complete plan execution", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);
			await executor.executeWorkspace(queue.workspaces[0]);
			await executor.completePlan();

			const state = executor.getState();
			expect(state?.status).toBe("complete");
		});
	});

	describe("statistics", () => {
		it("should provide execution statistics", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.B",
						title: "Task B",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			const stats = executor.getStatistics();
			expect(stats).toBeDefined();
			expect(stats?.total).toBe(2);
			expect(stats?.pending).toBe(2);
			expect(stats?.complete).toBe(0);
		});
	});

	describe("state persistence", () => {
		it("should load state from disk", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);
			await executor.executeWorkspace(queue.workspaces[0]);

			// Create new executor and load state
			const newExecutor = new AutonomousExecutor(TEST_DIR, 3);
			const loaded = await newExecutor.loadState();

			expect(loaded).toBe(true);

			const state = newExecutor.getState();
			expect(state?.workspaces.get("7.A")?.stage).toBe(WorkspaceStage.Complete);
		});
	});

	describe("createAutonomousExecutor", () => {
		it("should create executor instance", () => {
			const executor = createAutonomousExecutor(TEST_DIR);

			expect(executor).toBeInstanceOf(AutonomousExecutor);
		});

		it("should accept custom max workers", () => {
			const executor = createAutonomousExecutor(TEST_DIR, 5);

			expect(executor).toBeInstanceOf(AutonomousExecutor);
		});
	});
});
