/**
 * Tests for 3-Worker Scheduling - P2 Workstream 7.H
 *
 * Tests parallel execution with:
 * - Max 3 workers hard cap
 * - Same-file parallelism forbidden
 * - Risky/security workspaces serialized
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutonomousExecutor } from "../src/core/autonomous-executor.js";
import { WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-3-worker-scheduling");

describe("3-Worker Scheduling", () => {
	let executor: AutonomousExecutor;
	let scheduler: WorkspaceScheduler;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		executor = new AutonomousExecutor(TEST_DIR, 3);
		scheduler = new WorkspaceScheduler(3);
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	describe("worker limit enforcement", () => {
		it("should allow up to 3 workspaces to run in parallel", async () => {
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
					{
						id: "7.C",
						title: "Task C",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.D",
						title: "Task D",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			// Get next workspaces - should return 3
			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible.length).toBe(3);
			expect(eligible.map((w) => w.id)).toEqual(["7.A", "7.B", "7.C"]);
		});

		it("should block 4th workspace when 3 are active", async () => {
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
					{
						id: "7.C",
						title: "Task C",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.D",
						title: "Task D",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Manually mark 3 workspaces as active
			state.workspaces.get("7.A")!.stage = WorkspaceStage.Active;
			state.workspaces.get("7.B")!.stage = WorkspaceStage.Active;
			state.workspaces.get("7.C")!.stage = WorkspaceStage.Active;

			// Try to get next workspaces - should return empty
			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible.length).toBe(0);

			// Check statistics
			const stats = executor.getStatistics();
			expect(stats?.active).toBe(3);
			expect(stats?.availableSlots).toBe(0);
		});

		it("should allow new workspace when one completes", async () => {
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
					{
						id: "7.C",
						title: "Task C",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "7.D",
						title: "Task D",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			// Execute first 3 workspaces
			await executor.executeWorkspace(queue.workspaces[0]);
			await executor.executeWorkspace(queue.workspaces[1]);
			await executor.executeWorkspace(queue.workspaces[2]);

			// Now 7.D should be eligible
			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible.length).toBe(1);
			expect(eligible[0].id).toBe("7.D");
		});
	});

	describe("file lock enforcement", () => {
		it("should prevent parallel execution of workspaces editing same file", async () => {
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
						capabilities: {
							canEdit: ["src/app.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					},
					{
						id: "7.B",
						title: "Task B",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
						capabilities: {
							canEdit: ["src/app.ts"], // Same file!
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Mark 7.A as active and acquire its file locks
			state.workspaces.get("7.A")!.stage = WorkspaceStage.Active;
			scheduler.acquireFileLocks(queue.workspaces[0]);

			// Try to schedule 7.B - should be blocked
			const decision = scheduler.getNextWorkspaces(queue.workspaces, state);
			expect(decision.ready.length).toBe(0);
			expect(decision.blocked.length).toBe(1);
			expect(decision.blocked[0].id).toBe("7.B");
			expect(decision.blockReasons.get("7.B")).toContain("File lock conflict");
		});

		it("should allow parallel execution of workspaces editing different files", async () => {
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
						capabilities: {
							canEdit: ["src/app.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					},
					{
						id: "7.B",
						title: "Task B",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
						capabilities: {
							canEdit: ["src/utils.ts"], // Different file
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					},
					{
						id: "7.C",
						title: "Task C",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
						capabilities: {
							canEdit: ["src/config.ts"], // Different file
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					},
				],
			};

			await executor.initialize(queue);

			// All 3 should be eligible since they edit different files
			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible.length).toBe(3);
		});

		it("should release file locks after workspace completes", async () => {
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
						capabilities: {
							canEdit: ["src/app.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					},
					{
						id: "7.B",
						title: "Task B",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
						capabilities: {
							canEdit: ["src/app.ts"],
							cannotEdit: [],
							canRun: [],
							cannotRun: [],
						},
					},
				],
			};

			await executor.initialize(queue);

			// Execute 7.A (acquires and releases lock)
			await executor.executeWorkspace(queue.workspaces[0]);

			// Now 7.B should be able to acquire the lock
			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible.length).toBe(1);
			expect(eligible[0].id).toBe("7.B");
		});
	});

	describe("dependency-based scheduling", () => {
		it("should schedule workspaces with no dependencies first", async () => {
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
					{
						id: "7.C",
						title: "Task C",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible.length).toBe(2);
			expect(eligible.map((w) => w.id)).toEqual(["7.A", "7.C"]);
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
			expect(eligible.length).toBe(1);
			expect(eligible[0].id).toBe("7.B");
		});

		it("should allow parallel execution of independent workspaces", async () => {
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
					{
						id: "7.C",
						title: "Task C",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			await executor.initialize(queue);

			// All 3 should be eligible
			const eligible = executor.getNextWorkspaces(queue.workspaces);
			expect(eligible.length).toBe(3);
		});
	});

	describe("execution statistics", () => {
		it("should track active worker count", async () => {
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
			const state = executor.getState()!;

			// Mark workspaces as active
			state.workspaces.get("7.A")!.stage = WorkspaceStage.Active;
			state.workspaces.get("7.B")!.stage = WorkspaceStage.Active;

			const stats = executor.getStatistics();
			expect(stats?.active).toBe(2);
			expect(stats?.activeSlots).toBe(2);
			expect(stats?.availableSlots).toBe(1);
		});

		it("should track completion progress", async () => {
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

			// Execute both workspaces
			await executor.executeWorkspace(queue.workspaces[0]);
			await executor.executeWorkspace(queue.workspaces[1]);

			const stats = executor.getStatistics();
			expect(stats?.complete).toBe(2);
			expect(stats?.pending).toBe(0);
			expect(stats?.active).toBe(0);
		});
	});
});
