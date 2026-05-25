/**
 * P26.B — Per-workspace executor isolation
 *
 * Tests:
 * - AutonomousExecutor no longer stores a singleton WorkspaceAgentExecutor
 * - Each executeWorkspace call creates a workspace-scoped executor
 * - activeAgentExecutors tracks workspaceId -> executor
 * - Concurrent workspaces cannot overwrite each other's executor instance
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutonomousExecutor } from "../src/core/autonomous-executor.js";
import { setSystemMemoryLimitBytes } from "../src/core/worker-memory-guard.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueue(workspaces: Workspace[]): WorkspaceQueue {
	return {
		phase: "P26",
		title: "Test Plan",
		maxParallelWorkspaces: workspaces.length,
		workspaces,
	};
}

function makeWorkspace(id: string, deps: string[] = []): Workspace {
	return {
		id,
		title: `Workspace ${id}`,
		dependencies: deps,
		roleBudget: "worker",
		maxRetries: 0,
		capabilities: {
			canEdit: ["src/**"],
			canRun: ["echo"],
		},
		targetCommand: "echo done",
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.B — Per-workspace executor isolation", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p26b-test-"));
		// Disable memory guard for tests
		setSystemMemoryLimitBytes(Infinity);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	it("should not have a singleton agentExecutor property", () => {
		const executor = new AutonomousExecutor(
			// @ts-expect-error - use minimal IStateStore mock
			{},
			{
				workspaceRoot: tmpDir,
				maxWorkers: 1,
				enableRealExecution: false,
			},
		);

		expect((executor as any).agentExecutor).toBeUndefined();
	});

	it("should create workspace-scoped executors and track them in activeAgentExecutors", async () => {
		const { JsonStateStore } = await import("../src/core/json-state-store.js");
		const stateStore = new JsonStateStore(tmpDir);

		const queue = makeQueue([makeWorkspace("P26.B.1"), makeWorkspace("P26.B.2")]);
		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: tmpDir,
			maxWorkers: 2,
			enableRealExecution: false,
		});

		await executor.initialize(queue);

		const ws1 = queue.workspaces[0];
		const ws2 = queue.workspaces[1];

		const result1 = await executor.executeWorkspace(ws1);
		expect(result1.success).toBe(true);
		expect(result1.workspaceId).toBe(ws1.id);

		const result2 = await executor.executeWorkspace(ws2);
		expect(result2.success).toBe(true);
		expect(result2.workspaceId).toBe(ws2.id);

		// After execution completes, activeAgentExecutors should be empty
		// (executors cleaned up in the success path)
		const activeMap = (executor as any).activeAgentExecutors as Map<string, any>;
		expect(activeMap.size).toBe(0);
	});

	it("should track different executor instances for different workspaces", async () => {
		const { JsonStateStore } = await import("../src/core/json-state-store.js");
		const stateStore = new JsonStateStore(tmpDir);

		const queue = makeQueue([makeWorkspace("A"), makeWorkspace("B")]);
		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: tmpDir,
			maxWorkers: 2,
			enableRealExecution: true,
			model: undefined,
			worktree: { enabled: false },
		});

		await executor.initialize(queue);

		const activeMap = (executor as any).activeAgentExecutors as Map<string, any>;
		const createExecutor = (executor as any).createWorkspaceExecutor.bind(executor);

		const execA = createExecutor("A");
		const execB = createExecutor("B");

		// Should be different instances
		expect(execA).not.toBeNull();
		expect(execB).not.toBeNull();
		expect(execA).not.toBe(execB);

		// Both should be in the active map
		expect(activeMap.has("A")).toBe(true);
		expect(activeMap.has("B")).toBe(true);

		// Cleanup
		activeMap.clear();
	});

	it("should abort all active executors on stopAllActiveWorkspaces", async () => {
		const { JsonStateStore } = await import("../src/core/json-state-store.js");
		const stateStore = new JsonStateStore(tmpDir);

		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: tmpDir,
			maxWorkers: 2,
			enableRealExecution: false,
		});

		const activeMap = (executor as any).activeAgentExecutors as Map<string, any>;

		const aborted: string[] = [];
		const mockExecA = { abort: () => aborted.push("A") };
		const mockExecB = { abort: () => aborted.push("B") };

		activeMap.set("A", mockExecA);
		activeMap.set("B", mockExecB);

		await executor.stopAllActiveWorkspaces();

		expect(aborted).toContain("A");
		expect(aborted).toContain("B");

		// Map should be empty after abort
		expect(activeMap.size).toBe(0);
	});

	it("should clean up executor on failure", async () => {
		const { JsonStateStore } = await import("../src/core/json-state-store.js");
		const stateStore = new JsonStateStore(tmpDir);

		const queue = makeQueue([makeWorkspace("FAIL")]);
		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: tmpDir,
			maxWorkers: 1,
			enableRealExecution: false,
		});

		await executor.initialize(queue);

		const ws = queue.workspaces[0];
		const result = await executor.executeWorkspace(ws, true);

		expect(result.success).toBe(false);
		expect(result.verdict).toBe("FAILED");

		const activeMap = (executor as any).activeAgentExecutors as Map<string, any>;
		expect(activeMap.has("FAIL")).toBe(false);
	});

	it("should update all active executors when plan execution ID is set", async () => {
		const { JsonStateStore } = await import("../src/core/json-state-store.js");
		const stateStore = new JsonStateStore(tmpDir);

		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: tmpDir,
			maxWorkers: 1,
			enableRealExecution: false,
		});

		const activeMap = (executor as any).activeAgentExecutors as Map<string, any>;
		const planIds: string[] = [];

		const mockExec = {
			setPlanExecutionId: (id: string) => planIds.push(id),
		};

		activeMap.set("A", mockExec);

		(executor as any).planExecutionId = "exec-123";
		(executor as any).updateAgentExecutorContext();

		expect(planIds).toContain("exec-123");
	});

	it("should return null from createWorkspaceExecutor when real execution is disabled", async () => {
		const { JsonStateStore } = await import("../src/core/json-state-store.js");
		const stateStore = new JsonStateStore(tmpDir);

		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: tmpDir,
			maxWorkers: 1,
			enableRealExecution: false,
		});

		const createExecutor = (executor as any).createWorkspaceExecutor.bind(executor);
		const exec = createExecutor("NO_REAL");
		expect(exec).toBeNull();
	});

	it("should preserve worktree artifacts from all active executors", async () => {
		const { JsonStateStore } = await import("../src/core/json-state-store.js");
		const stateStore = new JsonStateStore(tmpDir);

		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: tmpDir,
			maxWorkers: 2,
			enableRealExecution: false,
		});

		const activeMap = (executor as any).activeAgentExecutors as Map<string, any>;
		const saved: string[] = [];

		const mockExecA = {
			isWorktreeModeEnabled: true,
			saveWorktreeArtifactsBeforeStop: async () => {
				saved.push("A");
				return { workspaceId: "A" } as any;
			},
		};
		const mockExecB = {
			isWorktreeModeEnabled: true,
			saveWorktreeArtifactsBeforeStop: async () => {
				saved.push("B");
				return { workspaceId: "B" } as any;
			},
		};

		activeMap.set("A", mockExecA);
		activeMap.set("B", mockExecB);

		const count = await executor.saveAllWorktreeArtifactsBeforeStop();

		expect(count).toBe(2);
		expect(saved).toContain("A");
		expect(saved).toContain("B");
	});
});
