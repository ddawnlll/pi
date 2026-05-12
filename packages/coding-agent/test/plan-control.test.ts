/**
 * Plan Control Tests
 *
 * Tests for plan execution control commands (pause, stop, cancel).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlanControlManager } from "../src/core/plan-control.js";
import { PlanStateStore } from "../src/core/plan-state.js";
import { type WorkspaceQueue, WorkspaceStage } from "../src/core/workspace-schema.js";

describe("PlanControlManager", () => {
	let tempDir: string;
	let controlManager: ReturnType<typeof createPlanControlManager>;

	beforeEach(async () => {
		// Create temp directory
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-control-test-"));
		controlManager = createPlanControlManager(tempDir);
	});

	afterEach(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should write and read pause control request", async () => {
		await controlManager.writeControlRequest("pause", "Test pause");

		const control = await controlManager.readControlRequest();
		expect(control).toBeDefined();
		expect(control?.action).toBe("pause");
		expect(control?.reason).toBe("Test pause");
		expect(control?.requestedAt).toBeGreaterThan(0);
	});

	it("should write and read stop control request", async () => {
		await controlManager.writeControlRequest("stop", "Test stop");

		const control = await controlManager.readControlRequest();
		expect(control).toBeDefined();
		expect(control?.action).toBe("stop");
		expect(control?.reason).toBe("Test stop");
	});

	it("should write and read cancel control request", async () => {
		await controlManager.writeControlRequest("cancel", "Test cancel");

		const control = await controlManager.readControlRequest();
		expect(control).toBeDefined();
		expect(control?.action).toBe("cancel");
		expect(control?.reason).toBe("Test cancel");
	});

	it("should return null when no control request exists", async () => {
		const control = await controlManager.readControlRequest();
		expect(control).toBeNull();
	});

	it("should clear control request", async () => {
		await controlManager.writeControlRequest("pause");

		let control = await controlManager.readControlRequest();
		expect(control).toBeDefined();

		await controlManager.clearControlRequest();

		control = await controlManager.readControlRequest();
		expect(control).toBeNull();
	});

	it("should check if control request exists", async () => {
		let hasControl = await controlManager.hasControlRequest();
		expect(hasControl).toBe(false);

		await controlManager.writeControlRequest("stop");

		hasControl = await controlManager.hasControlRequest();
		expect(hasControl).toBe(true);
	});

	it("should overwrite existing control request", async () => {
		await controlManager.writeControlRequest("pause", "First");
		await controlManager.writeControlRequest("stop", "Second");

		const control = await controlManager.readControlRequest();
		expect(control?.action).toBe("stop");
		expect(control?.reason).toBe("Second");
	});
});

describe("PlanStateStore control methods", () => {
	let tempDir: string;
	let stateStore: PlanStateStore;

	beforeEach(async () => {
		// Create temp directory
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-state-control-test-"));
		stateStore = new PlanStateStore(tempDir);

		// Initialize with a test queue
		const queue: WorkspaceQueue = {
			phase: "test",
			title: "Test Plan",
			workspaces: [
				{
					id: "ws1",
					title: "Workspace 1",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
			maxParallelWorkspaces: 1,
		};

		await stateStore.initializeState(queue);
	});

	afterEach(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should pause plan", async () => {
		await stateStore.pausePlan("Test pause");

		const state = stateStore.getState();
		expect(state?.status).toBe("paused");

		// Check journal
		const journal = await stateStore.readJournal();
		const pauseEvent = journal.find((e) => e.type === "plan_paused");
		expect(pauseEvent).toBeDefined();
		expect(pauseEvent?.data?.reason).toBe("Test pause");
	});

	it("should stop plan", async () => {
		await stateStore.stopPlan("Test stop");

		const state = stateStore.getState();
		expect(state?.status).toBe("stopped");
		expect(state?.completedAt).toBeGreaterThan(0);

		// Check journal
		const journal = await stateStore.readJournal();
		const stopEvent = journal.find((e) => e.type === "plan_stopped");
		expect(stopEvent).toBeDefined();
		expect(stopEvent?.data?.reason).toBe("Test stop");
	});

	it("should cancel plan and mark active workspaces as failed", async () => {
		// Transition workspace to active
		await stateStore.transitionWorkspace("ws1", WorkspaceStage.Active);

		await stateStore.cancelPlan("Test cancel");

		const state = stateStore.getState();
		expect(state?.status).toBe("cancelled");
		expect(state?.completedAt).toBeGreaterThan(0);

		// Check workspace was marked as failed
		const ws = state?.workspaces.get("ws1");
		expect(ws?.stage).toBe(WorkspaceStage.Failed);
		expect(ws?.error).toBe("Cancelled by user");

		// Check journal
		const journal = await stateStore.readJournal();
		const cancelEvent = journal.find((e) => e.type === "plan_cancelled");
		expect(cancelEvent).toBeDefined();
		expect(cancelEvent?.data?.reason).toBe("Test cancel");
	});

	it("should resume plan from paused state", async () => {
		await stateStore.pausePlan();
		await stateStore.resumePlan();

		const state = stateStore.getState();
		expect(state?.status).toBe("running");

		// Check journal
		const journal = await stateStore.readJournal();
		const resumeEvent = journal.find((e) => e.type === "plan_resumed");
		expect(resumeEvent).toBeDefined();
	});

	it("should resume plan from stopped state", async () => {
		await stateStore.stopPlan();
		await stateStore.resumePlan();

		const state = stateStore.getState();
		expect(state?.status).toBe("running");
	});

	it("should throw error when resuming cancelled plan without force", async () => {
		await stateStore.cancelPlan();

		await expect(stateStore.resumePlan()).rejects.toThrow("Cannot resume cancelled plan without --force");
	});
});

describe("Autonomous executor control integration", () => {
	let tempDir: string;

	beforeEach(async () => {
		// Create temp directory
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "executor-control-test-"));
	});

	afterEach(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should detect pause control request", async () => {
		const { createAutonomousExecutor } = await import("../src/core/autonomous-executor.js");
		const executor = createAutonomousExecutor(tempDir);

		// Initialize executor
		const queue: WorkspaceQueue = {
			phase: "test",
			title: "Test Plan",
			workspaces: [
				{
					id: "ws1",
					title: "Workspace 1",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
			maxParallelWorkspaces: 1,
		};

		await executor.initialize(queue);

		// Write pause control request
		const { createPlanControlManager } = await import("../src/core/plan-control.js");
		const controlManager = createPlanControlManager(tempDir);
		await controlManager.writeControlRequest("pause", "Test pause");

		// Check control request
		const control = await executor.checkControlRequest();
		expect(control).toBeDefined();
		expect(control?.action).toBe("pause");
	});

	it("should not schedule new workspaces when paused", async () => {
		const { createAutonomousExecutor } = await import("../src/core/autonomous-executor.js");
		const executor = createAutonomousExecutor(tempDir);

		// Initialize executor
		const queue: WorkspaceQueue = {
			phase: "test",
			title: "Test Plan",
			workspaces: [
				{
					id: "ws1",
					title: "Workspace 1",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
			maxParallelWorkspaces: 1,
		};

		await executor.initialize(queue);

		// Write pause control request
		const { createPlanControlManager } = await import("../src/core/plan-control.js");
		const controlManager = createPlanControlManager(tempDir);
		await controlManager.writeControlRequest("pause");

		// Try to get next workspaces
		const nextWorkspaces = await executor.getNextWorkspaces(queue.workspaces);
		expect(nextWorkspaces).toHaveLength(0);
	});

	it("should not schedule new workspaces when stopped", async () => {
		const { createAutonomousExecutor } = await import("../src/core/autonomous-executor.js");
		const executor = createAutonomousExecutor(tempDir);

		// Initialize executor
		const queue: WorkspaceQueue = {
			phase: "test",
			title: "Test Plan",
			workspaces: [
				{
					id: "ws1",
					title: "Workspace 1",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
			maxParallelWorkspaces: 1,
		};

		await executor.initialize(queue);

		// Write stop control request
		const { createPlanControlManager } = await import("../src/core/plan-control.js");
		const controlManager = createPlanControlManager(tempDir);
		await controlManager.writeControlRequest("stop");

		// Try to get next workspaces
		const nextWorkspaces = await executor.getNextWorkspaces(queue.workspaces);
		expect(nextWorkspaces).toHaveLength(0);
	});
});
