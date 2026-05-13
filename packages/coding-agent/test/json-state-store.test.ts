/**
 * JsonStateStore unit tests.
 *
 * Tests the JSON-backed IStateStore implementation with temp directory fixtures.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStateStore } from "../src/core/json-state-store.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-json-state-store");

describe("JsonStateStore", () => {
	let store: JsonStateStore;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		store = new JsonStateStore(TEST_DIR, { piDir: ".pi" });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	describe("getBackendType", () => {
		it("returns 'json'", () => {
			expect(store.getBackendType()).toBe("json");
		});
	});

	describe("project management", () => {
		it("lists projects (initially empty)", async () => {
			const projects = await store.listProjects();
			expect(projects).toEqual([]);
		});

		it("creates a new project", async () => {
			const project = await store.findOrCreateProject("test-project", "/tmp/test");
			expect(project.name).toBe("test-project");
			expect(project.rootPath).toBe("/tmp/test");
			expect(project.id).toBeDefined();
			expect(project.createdAt).toBeDefined();
		});

		it("findOrCreateProject is idempotent", async () => {
			const p1 = await store.findOrCreateProject("unique", "/tmp/a");
			const p2 = await store.findOrCreateProject("unique", "/tmp/b");
			expect(p2.id).toBe(p1.id);
			// Second call should not overwrite rootPath
			expect(p2.rootPath).toBe(p1.rootPath);
		});

		it("lists created projects", async () => {
			await store.findOrCreateProject("alpha");
			await store.findOrCreateProject("beta");
			const projects = await store.listProjects();
			expect(projects).toHaveLength(2);
			const names = projects.map((p) => p.name).sort();
			expect(names).toEqual(["alpha", "beta"]);
		});
	});

	describe("plan execution lifecycle", () => {
		it("initializes state and returns execution ID", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test Execution",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "Workspace 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const execId = await store.initializeState("project-1", queue);
			expect(execId).toBeDefined();
			expect(typeof execId).toBe("string");
		});

		it("lists plan executions after initializing", async () => {
			await store.findOrCreateProject("p1");

			const queue: WorkspaceQueue = {
				phase: "alpha",
				title: "Alpha Run",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			const executions = await store.listPlanExecutions("p1");
			expect(executions).toHaveLength(1);
			expect(executions[0].id).toBe(execId);
			expect(executions[0].status).toBe("running");
		});

		it("loads state after initialization", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "WS 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const execId = await store.initializeState("p1", queue);
			const state = await store.loadState(execId);
			expect(state).toBeDefined();
			expect(state?.phase).toBe("test");
			expect(state?.workspaces.size).toBe(1);
		});

		it("returns null loading non-existent state", async () => {
			const state = await store.loadState("nonexistent");
			expect(state).toBeNull();
		});
	});

	describe("workspace state", () => {
		it("updates workspace state", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "WS 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const execId = await store.initializeState("p1", queue);
			await store.updateWorkspaceState(execId, "ws1", { attempts: 5 });

			const state = await store.loadState(execId);
			expect(state?.workspaces.get("ws1")?.attempts).toBe(5);
		});

		it("transitions workspace stage", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "WS 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const { WorkspaceStage } = await import("../src/core/workspace-schema.js");
			const execId = await store.initializeState("p1", queue);
			await store.transitionWorkspace(execId, "ws1", WorkspaceStage.Active);

			const state = await store.loadState(execId);
			expect(state?.workspaces.get("ws1")?.stage).toBe(WorkspaceStage.Active);
		});

		it("increments retry attempts", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "WS 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const execId = await store.initializeState("p1", queue);
			await store.incrementRetryAttempt(execId, "ws1");
			await store.incrementRetryAttempt(execId, "ws1");

			const state = await store.loadState(execId);
			expect(state?.workspaces.get("ws1")?.attempts).toBe(2);
		});

		it("acquires and releases file locks", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "WS 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const execId = await store.initializeState("p1", queue);
			await store.acquireFileLocks(execId, "ws1", ["file1.ts", "file2.ts"]);

			const state = await store.loadState(execId);
			expect(state?.workspaces.get("ws1")?.ownedFiles).toEqual(["file1.ts", "file2.ts"]);

			await store.releaseFileLocks(execId, "ws1");
			const state2 = await store.loadState(execId);
			expect(state2?.workspaces.get("ws1")?.ownedFiles).toEqual([]);
		});
	});

	describe("journal", () => {
		it("appends and reads journal events", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			await store.appendJournal(execId, {
				type: "plan_start",
				timestamp: Date.now(),
				data: { phase: "test" },
			});

			const journal = await store.readJournal(execId);
			expect(journal.length).toBeGreaterThan(0);
			expect(journal.some((e) => e.type === "plan_start")).toBe(true);
		});

		it("appends tool_call events via appendJournalEvent", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);

			// Normal tool call
			await store.appendJournalEvent(execId, "read", { path: "/tmp/test.txt" });

			// MCP tool call
			await store.appendJournalEvent(
				execId,
				"list_tools",
				{},
				{
					isMcp: true,
					mcpServer: "filesystem",
				},
			);

			// Tool call with error
			await store.appendJournalEvent(
				execId,
				"write",
				{ path: "/root/forbidden" },
				{
					isError: true,
					errorMessage: "Permission denied",
				},
			);

			// Tool call with large input (truncation)
			const largeInput: Record<string, unknown> = {
				data: "x".repeat(3000),
			};
			await store.appendJournalEvent(execId, "bash", largeInput);

			const journal = await store.readJournal(execId);
			const toolCallEvents = journal.filter((e) => e.type === "tool_call");
			expect(toolCallEvents.length).toBe(4);

			// Verify normal tool call
			const readEvent = toolCallEvents.find((e) => (e.data as any)?.toolName === "read");
			expect(readEvent).toBeDefined();
			expect((readEvent!.data as any).input).toContain("/tmp/test.txt");

			// Verify MCP prefix
			const mcpEvent = toolCallEvents.find((e) => (e.data as any)?.toolName === "mcp:filesystem:list_tools");
			expect(mcpEvent).toBeDefined();

			// Verify error result
			const errorEvent = toolCallEvents.find((e) => (e.data as any)?.toolName === "write");
			expect(errorEvent).toBeDefined();
			expect((errorEvent!.data as any).result).toBe("error");
			expect((errorEvent!.data as any).errorMessage).toBe("Permission denied");

			// Verify truncation
			const bashEvent = toolCallEvents.find((e) => (e.data as any)?.toolName === "bash");
			expect(bashEvent).toBeDefined();
			expect((bashEvent!.data as any).input).toContain("...(truncated)");
			expect((bashEvent!.data as any).input.length).toBeLessThan(3000); // should be truncated from 3000-char value
		});
	});

	describe("plan lifecycle", () => {
		it("completes plan", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			await store.completePlan(execId);

			const executions = await store.listPlanExecutions("p1");
			const exec = executions.find((e) => e.id === execId);
			expect(exec?.status).toBe("complete");

			const journal = await store.readJournal(execId);
			expect(journal.some((e) => e.type === "plan_complete")).toBe(true);
		});

		it("fails plan", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			await store.failPlan(execId, "Something went wrong");

			const executions = await store.listPlanExecutions("p1");
			const exec = executions.find((e) => e.id === execId);
			expect(exec?.status).toBe("failed");

			const journal = await store.readJournal(execId);
			expect(journal.some((e) => e.type === "plan_failed")).toBe(true);
		});

		it("pauses plan", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			await store.pausePlan(execId, "Coffee break");

			const executions = await store.listPlanExecutions("p1");
			const exec = executions.find((e) => e.id === execId);
			expect(exec?.status).toBe("paused");
		});

		it("stops plan", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			await store.stopPlan(execId, "Manual stop");

			const executions = await store.listPlanExecutions("p1");
			const exec = executions.find((e) => e.id === execId);
			expect(exec?.status).toBe("stopped");
		});
	});

	describe("control requests", () => {
		it("writes and reads control request", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			await store.writeControlRequest(execId, "pause", "Testing pause");

			const control = await store.readControlRequest(execId);
			expect(control).toBeDefined();
			expect(control?.action).toBe("pause");
			expect(control?.reason).toBe("Testing pause");
		});

		it("clears control request", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [],
			};

			const execId = await store.initializeState("p1", queue);
			await store.writeControlRequest(execId, "stop");
			await store.clearControlRequest(execId);

			const control = await store.readControlRequest(execId);
			expect(control).toBeNull();
		});
	});

	describe("workspace state and statistics", () => {
		it("returns workspace state", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "WS 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const execId = await store.initializeState("p1", queue);
			const ws = await store.getWorkspaceState(execId, "ws1");
			expect(ws).toBeDefined();
			expect(ws?.workspaceId).toBe("ws1");
		});

		it("returns statistics", async () => {
			const queue: WorkspaceQueue = {
				phase: "test",
				title: "Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "ws1",
						title: "WS 1",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
					{
						id: "ws2",
						title: "WS 2",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const execId = await store.initializeState("p1", queue);
			const stats = await store.getStatistics(execId);
			expect(stats).toBeDefined();
			expect(stats?.total).toBe(2);
			expect(stats?.pending).toBe(2);
		});
	});
});
