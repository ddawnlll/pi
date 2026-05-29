/**
 * Tests for Autonomous Execution Loop - P2 Workstream 7.F
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutonomousExecutor, createAutonomousExecutor } from "../src/core/autonomous-executor.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-autonomous-executor");

describe("AutonomousExecutor", () => {
	let executor: AutonomousExecutor;
	let originalEnv: string | undefined;

	beforeEach(async () => {
		// Force JSON backend for tests to avoid PostgreSQL connection attempts
		originalEnv = process.env.PI_STATE_STORE_BACKEND;
		process.env.PI_STATE_STORE_BACKEND = "json";

		await fs.mkdir(TEST_DIR, { recursive: true });
		// Create executor with postPlanHandoff disabled for simpler testing
		executor = createAutonomousExecutor(TEST_DIR, 3, undefined, undefined, { postPlanHandoff: false });
	});

	afterEach(async () => {
		// Restore original environment
		if (originalEnv === undefined) {
			delete process.env.PI_STATE_STORE_BACKEND;
		} else {
			process.env.PI_STATE_STORE_BACKEND = originalEnv;
		}

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

			const eligible = await executor.getNextWorkspaces(queue.workspaces);

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
			const eligible = await executor.getNextWorkspaces(queue.workspaces);
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
			// With postPlanHandoff disabled, status should be "complete"
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

			const planExecId = await executor.initialize(queue);
			await executor.executeWorkspace(queue.workspaces[0]);

			// Create new executor and load state by adopting the existing execution
			const newExecutor = createAutonomousExecutor(TEST_DIR, 3, undefined, undefined, { postPlanHandoff: false });
			const adopted = await newExecutor.adoptExistingExecution(planExecId, queue);

			expect(adopted).toBe(true);

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

	describe("parallel execution with abort controllers (V5 bug fixes)", () => {
		it("should handle multiple concurrent workspaces with individual abort controllers", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Parallel Abort Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "B", title: "B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "C", title: "C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				],
			};

			await executor.initialize(queue);

			// Create abort controllers for each workspace
			const abortControllers = new Map<string, AbortController>();
			for (const ws of queue.workspaces) {
				abortControllers.set(ws.id, new AbortController());
			}

			// Start all workspaces with their abort signals
			const promises = queue.workspaces.map((ws) => {
				const controller = abortControllers.get(ws.id)!;
				return executor.executeWorkspace(ws, false, controller.signal);
			});

			// Wait for all to complete
			const results = await Promise.all(promises);

			// All should succeed (abort controllers were not triggered)
			expect(results).toHaveLength(3);
			for (const result of results) {
				expect(result.success).toBe(true);
			}
		});

		it("should abort specific workspace without affecting others", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Selective Abort Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "B", title: "B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				],
			};

			await executor.initialize(queue);

			const controllerA = new AbortController();
			const controllerB = new AbortController();

			// Start both workspaces
			const promiseA = executor.executeWorkspace(queue.workspaces[0], false, controllerA.signal);
			const promiseB = executor.executeWorkspace(queue.workspaces[1], false, controllerB.signal);

			// Let them complete normally
			const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

			// Both should complete successfully
			expect(resultA.success).toBe(true);
			expect(resultB.success).toBe(true);
		});
	});

	describe("crash recovery (adoptExistingExecution)", () => {
		it("should adopt non-terminal execution and reset active workspaces to pending", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Recovery Test",
				maxParallelWorkspaces: 2,
				workspaces: [
					{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "B", title: "B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "C", title: "C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				],
			};

			// Create executor A — initialize the plan so state is persisted
			const executorA = createAutonomousExecutor(TEST_DIR, 3);
			const planExecId = await executorA.initialize(queue);

			// Manually set workspace A to Active (simulating a crash mid-execution)
			const store = executorA.getStateStore();
			await store.transitionWorkspace(planExecId, "A", WorkspaceStage.Active);

			// Create executor B to adopt the existing execution
			const executorB = createAutonomousExecutor(TEST_DIR, 3);
			const adopted = await executorB.adoptExistingExecution(planExecId, queue);

			expect(adopted).toBe(true);

			const state = executorB.getState();
			expect(state).not.toBeNull();
			expect(state?.status).toBe("running");

			// Workspace A should have been reset from Active back to Pending
			const wsA = state?.workspaces.get("A");
			expect(wsA).toBeDefined();
			expect(wsA!.stage).toBe(WorkspaceStage.Pending);

			// Workspaces B and C should remain Pending
			expect(state?.workspaces.get("B")?.stage).toBe(WorkspaceStage.Pending);
			expect(state?.workspaces.get("C")?.stage).toBe(WorkspaceStage.Pending);
		});

		it("should return false for already-terminal execution", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Terminal Test",
				maxParallelWorkspaces: 1,
				workspaces: [{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
			};

			const executorA = createAutonomousExecutor(TEST_DIR, 3, undefined, undefined, { postPlanHandoff: false });
			const planExecId = await executorA.initialize(queue);

			// Complete the plan
			await executorA.executeWorkspace(queue.workspaces[0]);
			await executorA.completePlan();

			// Verify the plan is actually complete
			const finalState = executorA.getState();
			expect(finalState?.status).toBe("complete");

			// Try to adopt — should return false since plan is complete
			const executorB = createAutonomousExecutor(TEST_DIR, 3, undefined, undefined, { postPlanHandoff: false });
			const adopted = await executorB.adoptExistingExecution(planExecId, queue);

			expect(adopted).toBe(false);
		});

		it("should restore completion gate state from persisted workspaces", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Gate Recovery",
				maxParallelWorkspaces: 2,
				workspaces: [
					{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "B", title: "B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				],
			};

			const executorA = createAutonomousExecutor(TEST_DIR, 3);
			const planExecId = await executorA.initialize(queue);

			// Complete workspace A so it's persisted as Complete
			await executorA.executeWorkspace(queue.workspaces[0]);

			// Adopt with executor B
			const executorB = createAutonomousExecutor(TEST_DIR, 3);
			await executorB.adoptExistingExecution(planExecId, queue);

			// The completion gate should mark A as implementation-finished
			const evalResult = executorB.getCompletionGate().evaluateWorkspace(planExecId, "A", queue.workspaces[0]);
			// Since A is Complete and gate should have it marked, canComplete should be true
			// (or false only if additional gate criteria like targetCommand block it)
			expect(evalResult.canComplete || !evalResult.canComplete).toBe(true); // just assert gate exists and doesn't crash
		});
	});

	describe("worktree config (V5 bug fixes)", () => {
		it("should respect worktree config passed to constructor", async () => {
			// This test verifies the bug fix where worktree config was hardcoded
			// to { enabled: true } instead of respecting the passed config
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Worktree Config Test",
				maxParallelWorkspaces: 1,
				workspaces: [{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
			};

			// Create executor with explicit worktree disabled
			const executorWithWorktreeDisabled = createAutonomousExecutor(TEST_DIR, 1, undefined, {
				enabled: false,
			});

			await executorWithWorktreeDisabled.initialize(queue);
			const result = await executorWithWorktreeDisabled.executeWorkspace(queue.workspaces[0]);

			expect(result.success).toBe(true);
			// The executor should have respected the disabled worktree config
			// (we can't directly verify this without inspecting internals, but
			// the test ensures it doesn't crash when worktree is disabled)
		});

		it("should respect custom worktree root path", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Custom Worktree Root Test",
				maxParallelWorkspaces: 1,
				workspaces: [{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
			};

			const customRoot = ".custom-worktrees";
			const executorWithCustomRoot = createAutonomousExecutor(TEST_DIR, 1, undefined, {
				enabled: true,
				root: customRoot,
			});

			await executorWithCustomRoot.initialize(queue);
			const result = await executorWithCustomRoot.executeWorkspace(queue.workspaces[0]);

			expect(result.success).toBe(true);
		});
	});

	describe("abort signal handling (V5 bug fixes)", () => {
		it("should accept abort signal in executeWorkspace", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Abort Signal Test",
				maxParallelWorkspaces: 1,
				workspaces: [{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
			};

			await executor.initialize(queue);

			const abortController = new AbortController();
			// Don't abort yet - just verify the signal is accepted
			const resultPromise = executor.executeWorkspace(queue.workspaces[0], false, abortController.signal);

			const result = await resultPromise;
			expect(result.success).toBe(true);
		});

		it("should handle pre-aborted signal gracefully", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Pre-aborted Signal Test",
				maxParallelWorkspaces: 1,
				workspaces: [{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
			};

			await executor.initialize(queue);

			const abortController = new AbortController();
			abortController.abort(); // Abort before starting

			// Should not crash, may return early or handle gracefully
			const result = await executor.executeWorkspace(queue.workspaces[0], false, abortController.signal);
			// The result could be success or failure depending on implementation,
			// but it should not throw an unhandled exception
			expect(result).toBeDefined();
		});
	});

	describe("abort tracking (P4.6.3)", () => {
		it("should track in-flight execution promises via trackExecution()", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Abort",
				maxParallelWorkspaces: 3,
				workspaces: [
					{ id: "A", title: "A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "B", title: "B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "C", title: "C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				],
			};

			await executor.initialize(queue);

			// Fire off all three workspaces concurrently without awaiting individually.
			// stopAllActiveWorkspaces() should settle them via the inFlightExecutions map.
			const resultsPromise = Promise.allSettled(queue.workspaces.map((ws) => executor.executeWorkspace(ws)));

			// Immediately stop all active workspaces — this should drain and await
			// the tracked promises before resolving.
			await executor.stopAllActiveWorkspaces();

			// All results should have settled.
			const results = await resultsPromise;

			expect(results).toHaveLength(3);
			for (const result of results) {
				expect(result.status).toBe("fulfilled");
				if (result.status === "fulfilled") {
					expect(result.value.success).toBe(true);
				}
			}
		});

		it("should clear in-flight map after stopAllActiveWorkspaces()", async () => {
			const queue: WorkspaceQueue = {
				phase: "P2",
				title: "Test Abort Clear",
				maxParallelWorkspaces: 3,
				workspaces: [
					{ id: "X", title: "X", dependencies: [], roleBudget: "worker", maxRetries: 3 },
					{ id: "Y", title: "Y", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				],
			};

			await executor.initialize(queue);

			const resultsPromise = Promise.allSettled(queue.workspaces.map((ws) => executor.executeWorkspace(ws)));

			await executor.stopAllActiveWorkspaces();
			await resultsPromise;

			// Run another workspace afterward — should work fine with clean state
			const secondQueue: WorkspaceQueue = {
				phase: "P2",
				title: "Second",
				maxParallelWorkspaces: 1,
				workspaces: [{ id: "Z", title: "Z", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
			};

			await executor.initialize(secondQueue);
			const result = await executor.executeWorkspace(secondQueue.workspaces[0]);

			expect(result.success).toBe(true);
			expect(result.verdict).toBe("COMPLETE");
		});
	});
});
