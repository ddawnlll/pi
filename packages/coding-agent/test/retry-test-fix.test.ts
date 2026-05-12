/**
 * Tests for Retry/Test/Fix Behavior - P2 Workstream 7.H
 *
 * Tests retry escalation and integration with autonomous executor.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AutonomousExecutor, createAutonomousExecutor } from "../src/core/autonomous-executor.js";
import { FailureType, RetryStage } from "../src/core/retry-handler.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-retry-behavior");

describe("Retry/Test/Fix Behavior", () => {
	let executor: AutonomousExecutor;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		executor = createAutonomousExecutor(TEST_DIR, 3);
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	describe("retry escalation stages", () => {
		it("should use worker packet for attempts 1-3", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);

			// Simulate failure on first attempt
			const result1 = await executor.executeWorkspace(queue.workspaces[0], true);
			expect(result1.success).toBe(false);
			expect(result1.verdict).toBe("BLOCKED"); // Should retry

			const state1 = executor.getState()!;
			const wsState1 = state1.workspaces.get("7.A")!;
			expect(wsState1.attempts).toBe(1);
			expect(wsState1.stage).toBe(WorkspaceStage.Pending); // Ready for retry

			// Check retry stage
			const retryHandler = executor.getRetryHandler();
			expect(retryHandler.getRetryStage(2)).toBe(RetryStage.Worker);
		});

		it("should escalate to flash packet for attempts 4-6", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Manually set attempts to 3
			state.workspaces.get("7.A")!.attempts = 3;

			// Next attempt should use flash
			const retryHandler = executor.getRetryHandler();
			expect(retryHandler.getRetryStage(4)).toBe(RetryStage.Flash);
		});

		it("should escalate to reviewer packet for attempts 7-9", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Manually set attempts to 6
			state.workspaces.get("7.A")!.attempts = 6;

			// Next attempt should use reviewer
			const retryHandler = executor.getRetryHandler();
			expect(retryHandler.getRetryStage(7)).toBe(RetryStage.Reviewer);
		});

		it("should mark as final for attempt 10", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Manually set attempts to 9
			state.workspaces.get("7.A")!.attempts = 9;

			// Next attempt should be final
			const retryHandler = executor.getRetryHandler();
			expect(retryHandler.getRetryStage(10)).toBe(RetryStage.Final);
		});
	});

	describe("retry limit enforcement", () => {
		it("should allow up to 10 retries for test failures", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Set to 9 attempts
			state.workspaces.get("7.A")!.attempts = 9;
			state.workspaces.get("7.A")!.error = "Test failed";

			// Should allow one more retry
			const retryHandler = executor.getRetryHandler();
			const wsState = state.workspaces.get("7.A")!;
			const decision = retryHandler.shouldRetry(queue.workspaces[0], wsState, FailureType.Test);

			expect(decision.shouldRetry).toBe(true);
			expect(decision.nextAttempt).toBe(10);
		});

		it("should fail after 10 attempts for test failures", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Set to 10 attempts (exhausted)
			state.workspaces.get("7.A")!.attempts = 10;
			state.workspaces.get("7.A")!.error = "Test failed";

			// Should not allow more retries
			const retryHandler = executor.getRetryHandler();
			const wsState = state.workspaces.get("7.A")!;
			const decision = retryHandler.shouldRetry(queue.workspaces[0], wsState, FailureType.Test);

			expect(decision.shouldRetry).toBe(false);
		});

		it("should limit review failures to 3 retries", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);
			const state = executor.getState()!;

			// Set to 3 attempts
			state.workspaces.get("7.A")!.attempts = 3;
			state.workspaces.get("7.A")!.error = "Review rejected";

			// Should not allow more retries for review failures
			const retryHandler = executor.getRetryHandler();
			const wsState = state.workspaces.get("7.A")!;
			const decision = retryHandler.shouldRetry(queue.workspaces[0], wsState, FailureType.Review);

			expect(decision.shouldRetry).toBe(false);
		});
	});

	describe("retry snapshot persistence", () => {
		it("should save packet snapshot for each retry", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);

			// Execute with failure
			await executor.executeWorkspace(queue.workspaces[0], true);

			// Check that retry snapshot was created
			const retryPath = path.join(TEST_DIR, ".pi", "workspaces", "7.A", "retries", "packet-attempt-1.json");
			const exists = await fs
				.access(retryPath)
				.then(() => true)
				.catch(() => false);

			expect(exists).toBe(true);
		});

		it("should save multiple retry snapshots", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);

			// Execute with failures multiple times
			await executor.executeWorkspace(queue.workspaces[0], true);
			await executor.executeWorkspace(queue.workspaces[0], true);
			await executor.executeWorkspace(queue.workspaces[0], true);

			// Check that all retry snapshots were created
			const retry1 = path.join(TEST_DIR, ".pi", "workspaces", "7.A", "retries", "packet-attempt-1.json");
			const retry2 = path.join(TEST_DIR, ".pi", "workspaces", "7.A", "retries", "packet-attempt-2.json");
			const retry3 = path.join(TEST_DIR, ".pi", "workspaces", "7.A", "retries", "packet-attempt-3.json");

			const exists1 = await fs
				.access(retry1)
				.then(() => true)
				.catch(() => false);
			const exists2 = await fs
				.access(retry2)
				.then(() => true)
				.catch(() => false);
			const exists3 = await fs
				.access(retry3)
				.then(() => true)
				.catch(() => false);

			expect(exists1).toBe(true);
			expect(exists2).toBe(true);
			expect(exists3).toBe(true);
		});
	});

	describe("state and journal updates", () => {
		it("should update state after each retry", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);

			// Execute with failure
			await executor.executeWorkspace(queue.workspaces[0], true);

			const state = executor.getState()!;
			const wsState = state.workspaces.get("7.A")!;

			expect(wsState.attempts).toBe(1);
			expect(wsState.error).toBeDefined();
			expect(wsState.stage).toBe(WorkspaceStage.Pending); // Ready for retry
		});

		it("should record retry events in journal", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);

			// Execute with failure
			await executor.executeWorkspace(queue.workspaces[0], true);

			// Check journal file exists
			const journalPath = path.join(TEST_DIR, ".pi", "execution-journal.ndjson");
			const exists = await fs
				.access(journalPath)
				.then(() => true)
				.catch(() => false);

			expect(exists).toBe(true);

			// Read journal and verify retry event
			const content = await fs.readFile(journalPath, "utf-8");
			expect(content).toContain("retry_attempt");
		});

		it("should persist state to disk", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);

			// Execute with failure
			await executor.executeWorkspace(queue.workspaces[0], true);

			// Check state file exists and contains retry info
			const statePath = path.join(TEST_DIR, ".pi", "plan-state.json");
			const content = await fs.readFile(statePath, "utf-8");
			const state = JSON.parse(content);

			const workspace = state.workspaces.find((w: { workspaceId: string }) => w.workspaceId === "7.A");
			expect(workspace.attempts).toBe(1);
			expect(workspace.error).toBeDefined();
		});
	});

	describe("successful retry after failure", () => {
		it("should complete workspace after successful retry", async () => {
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
						maxRetries: 10,
					},
				],
			};

			await executor.initialize(queue);

			// First attempt fails
			const result1 = await executor.executeWorkspace(queue.workspaces[0], true);
			expect(result1.success).toBe(false);

			// Second attempt succeeds
			const result2 = await executor.executeWorkspace(queue.workspaces[0], false);
			expect(result2.success).toBe(true);
			expect(result2.verdict).toBe("COMPLETE");

			const state = executor.getState()!;
			const wsState = state.workspaces.get("7.A")!;
			expect(wsState.stage).toBe(WorkspaceStage.Complete);
			expect(wsState.attempts).toBe(2);
		});
	});

	describe("exhausted retries", () => {
		it("should mark workspace as failed after exhausting retries", async () => {
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
						maxRetries: 3, // Low limit for testing
					},
				],
			};

			await executor.initialize(queue);

			// Fail 3 times
			await executor.executeWorkspace(queue.workspaces[0], true);
			await executor.executeWorkspace(queue.workspaces[0], true);
			const result3 = await executor.executeWorkspace(queue.workspaces[0], true);

			expect(result3.success).toBe(false);
			expect(result3.verdict).toBe("FAILED");
			expect(result3.report).toContain("Failed after");

			const state = executor.getState()!;
			const wsState = state.workspaces.get("7.A")!;
			expect(wsState.stage).toBe(WorkspaceStage.Failed);
			expect(wsState.attempts).toBe(3);
		});
	});
});
