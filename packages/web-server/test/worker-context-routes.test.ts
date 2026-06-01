/**
 * Worker Context Routes — P41.08 Worker Context Inspector
 *
 * Tests:
 *  1. GET /api/worker-context/:planExecId/:workspaceId returns context
 *  2. 404 when workspace not found
 *  3. Context fields are populated correctly from state store and archive files
 *  4. Project-scoped endpoint also works
 *  5. Empty/edge cases (no role packet, no touched files, etc.)
 *  6. 500 errors are caught and formatted
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerWorkerContextRoutes } from "../src/worker-context-routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
	const dir = join(tmpdir(), `worker-context-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Create the execution archive directory structure for a workspace.
 */
function createArchiveDir(workspaceRoot: string, planExecId: string, workspaceId: string): string {
	const dir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Create a minimal Fastify app with worker context routes.
 */
async function createApp(workspaceRoot: string, stateStore: any = {}) {
	const app = Fastify({ logger: false });
	registerWorkerContextRoutes(
		app,
		() => join(workspaceRoot, ".pi"),
		() => workspaceRoot,
		() => stateStore,
	);
	await app.ready();
	return app;
}

/**
 * Build a state store mock with the given workspace state.
 * Helper is curried to accept workspaceState or a custom getWorkspaceState function.
 */
function createStateStoreMock(workspaceState: any, extraMethods: Record<string, any> = {}): any {
	return {
		getWorkspaceState: async () => workspaceState,
		getCommandHistory: async () => [],
		getLeadDirectives: async () => [],
		getLeadEscalations: async () => [],
		readControlRequest: async () => null,
		loadState: () => null,
		...extraMethods,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("worker-context-routes", () => {
	let workspaceRoot: string;

	beforeEach(() => {
		workspaceRoot = createTempDir();
	});

	afterEach(() => {
		rmSync(workspaceRoot, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Basic endpoint behavior
	// -----------------------------------------------------------------------

	it("returns 404 when workspace not found", async () => {
		const stateStore = createStateStoreMock(null);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		expect(response.statusCode).toBe(404);
		const body = JSON.parse(response.payload);
		expect(body.error).toBe("Workspace not found");
	});

	it("returns worker context for a valid workspace", async () => {
		const planExecId = "plan-1";
		const workspaceId = "ws-1";
		const wsState = {
			stage: "active",
			attempts: 2,
			startedAt: Date.now() - 60000,
			goal: "Implement login feature",
			role: "coder",
			allowedFiles: ["src/auth.ts", "src/login.tsx"],
		};

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: `/api/worker-context/${planExecId}/${workspaceId}`,
		});

		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.payload);
		expect(body.success).toBe(true);
		expect(body.context).toBeDefined();
		expect(body.context.workspaceId).toBe(workspaceId);
		expect(body.context.planExecutionId).toBe(planExecId);
		expect(body.context.stage).toBe("active");
		expect(body.context.attempts).toBe(2);
		expect(body.context.goal).toBe("Implement login feature");
		expect(body.context.role).toBe("coder");
		expect(body.context.allowedFiles).toEqual(["src/auth.ts", "src/login.tsx"]);
		expect(body.context.touchedFiles).toEqual([]);
		expect(body.context.activeDirectives).toEqual([]);
		expect(body.context.activeEscalations).toEqual([]);
		expect(body.context.transcriptUrl).toBe(`/api/transcript/${planExecId}/${workspaceId}`);
	});

	it("returns context via project-scoped endpoint", async () => {
		const planExecId = "plan-1";
		const workspaceId = "ws-1";
		const wsState = { stage: "complete", attempts: 1 };

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: `/api/projects/my-project/worker-context/${planExecId}/${workspaceId}`,
		});

		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.payload);
		expect(body.success).toBe(true);
		expect(body.context.stage).toBe("complete");
	});

	it("includes startedAt and completedAt when present", async () => {
		const wsState = {
			stage: "complete",
			attempts: 1,
			startedAt: 1000000,
			completedAt: 2000000,
		};

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.startedAt).toBe(new Date(1000000).toISOString());
		expect(body.context.completedAt).toBe(new Date(2000000).toISOString());
	});

	it("includes error when workspace has failed", async () => {
		const wsState = {
			stage: "failed",
			attempts: 3,
			error: "Test failure",
		};

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.error).toBe("Test failure");
		expect(body.context.stage).toBe("failed");
		expect(body.context.attempts).toBe(3);
	});

	// -----------------------------------------------------------------------
	// Role packet and context summary
	// -----------------------------------------------------------------------

	it("loads role packet from execution archive", async () => {
		const planExecId = "plan-1";
		const workspaceId = "ws-1";
		const wsState = { stage: "active", attempts: 0 };

		// Create the archive packet file
		const archiveDir = createArchiveDir(workspaceRoot, planExecId, workspaceId);
		writeFileSync(
			join(archiveDir, "packet.md"),
			"# Worker Packet\n\nDo the thing.\n\nMore instructions here.",
			"utf-8",
		);

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: `/api/worker-context/${planExecId}/${workspaceId}`,
		});

		const body = JSON.parse(response.payload);
		expect(body.context.rolePacketContent).toBe("# Worker Packet\n\nDo the thing.\n\nMore instructions here.");
	});

	it("builds context summary from packet content (first 10 non-empty lines)", async () => {
		const planExecId = "plan-1";
		const workspaceId = "ws-1";
		const wsState = { stage: "active", attempts: 0 };

		// Create a packet with many lines
		const lines: string[] = [];
		for (let i = 1; i <= 15; i++) {
			lines.push(`Line ${i}`);
		}
		const packet = lines.join("\n");

		const archiveDir = createArchiveDir(workspaceRoot, planExecId, workspaceId);
		writeFileSync(join(archiveDir, "packet.md"), packet, "utf-8");

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: `/api/worker-context/${planExecId}/${workspaceId}`,
		});

		const body = JSON.parse(response.payload);
		expect(body.context.contextPacketSummary).toContain("Line 1");
		expect(body.context.contextPacketSummary).toContain("Line 10");
		expect(body.context.contextPacketSummary).toContain("... (5 more lines)");
		expect(body.context.contextPacketSummary).not.toContain("Line 11");
	});

	it("returns undefined contextPacketSummary when no role packet exists", async () => {
		const wsState = { stage: "active", attempts: 0 };
		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.rolePacketContent).toBeUndefined();
		expect(body.context.contextPacketSummary).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// Touched files
	// -----------------------------------------------------------------------

	it("loads touched files from archive", async () => {
		const planExecId = "plan-1";
		const workspaceId = "ws-1";
		const wsState = { stage: "complete", attempts: 1 };

		const archiveDir = createArchiveDir(workspaceRoot, planExecId, workspaceId);
		const touchedFiles = [
			{ path: "src/auth.ts", change: "modified" },
			{ path: "src/login.tsx", change: "created" },
			{ path: "src/old.ts", change: "deleted" },
		];
		writeFileSync(join(archiveDir, "files-touched.json"), JSON.stringify(touchedFiles), "utf-8");

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: `/api/worker-context/${planExecId}/${workspaceId}`,
		});

		const body = JSON.parse(response.payload);
		expect(body.context.touchedFiles).toEqual(touchedFiles);
	});

	it("returns empty touched files when file does not exist", async () => {
		const wsState = { stage: "pending", attempts: 0 };
		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.touchedFiles).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// Allowed files from workspace state
	// -----------------------------------------------------------------------

	it("extracts allowedFiles from workspace state", async () => {
		const wsState = {
			stage: "active",
			attempts: 1,
			allowedFiles: ["src/foo.ts", "src/bar.ts"],
		};

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.allowedFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
	});

	it("falls back to canEdit for allowed files", async () => {
		const wsState = {
			stage: "active",
			attempts: 1,
			canEdit: ["src/fallback.ts"],
		};

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.allowedFiles).toEqual(["src/fallback.ts"]);
	});

	// -----------------------------------------------------------------------
	// Command history and log summary
	// -----------------------------------------------------------------------

	it("extracts last command from command history", async () => {
		const wsState = { stage: "active", attempts: 1 };

		const stateStore = createStateStoreMock(wsState, {
			getCommandHistory: async () => [
				{ command: "npx tsc", cwd: ".", exitCode: 0, startedAt: 100, finishedAt: 200 },
				{ command: "npm run build", cwd: ".", exitCode: 0, startedAt: 300, finishedAt: 400 },
			],
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.lastCommand).toBe("npm run build");
	});

	it("extracts log summary from archive raw.log", async () => {
		const planExecId = "plan-1";
		const workspaceId = "ws-1";
		const wsState = { stage: "active", attempts: 1 };

		const archiveDir = createArchiveDir(workspaceRoot, planExecId, workspaceId);
		const lines: string[] = [];
		for (let i = 1; i <= 25; i++) {
			lines.push(`Log line ${i}`);
		}
		writeFileSync(join(archiveDir, "raw.log"), lines.join("\n"), "utf-8");

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: `/api/worker-context/${planExecId}/${workspaceId}`,
		});

		const body = JSON.parse(response.payload);
		expect(body.context.logSummary).toContain("Log line 6");
		expect(body.context.logSummary).toContain("Log line 25");
		// Should have ~20 lines (last 20 of 25)
		const summaryLines = (body.context.logSummary as string).split("\n");
		expect(summaryLines.length).toBe(20);
	});

	// -----------------------------------------------------------------------
	// Directives, escalations, and human directive
	// -----------------------------------------------------------------------

	it("includes active lead agent directives", async () => {
		const wsState = { stage: "active", attempts: 1 };

		const directives = [
			{
				workspaceId: "ws-1",
				directiveId: "dir-1",
				directiveType: "rework",
				attemptNumber: 1,
				severity: "high",
				summary: "Fix type errors",
				directive: "Run tsc --noEmit and fix all errors",
				allowedActions: ["edit", "run"],
				forbiddenActions: ["commit"],
				retryBudget: 3,
				escalateAfter: 5,
				status: "issued",
				createdAt: new Date().toISOString(),
			},
		];

		const stateStore = createStateStoreMock(wsState, {
			getLeadDirectives: async () => directives,
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.activeDirectives).toHaveLength(1);
		expect(body.context.activeDirectives[0].directiveId).toBe("dir-1");
		expect(body.context.activeDirectives[0].severity).toBe("high");
	});

	it("filters out resolved/expired directives", async () => {
		const wsState = { stage: "active", attempts: 1 };

		const directives = [
			{
				workspaceId: "ws-1",
				directiveId: "dir-active",
				directiveType: "rework",
				attemptNumber: 1,
				severity: "medium",
				summary: "Active",
				directive: "Do X",
				allowedActions: ["edit"],
				forbiddenActions: [],
				retryBudget: 3,
				escalateAfter: 5,
				status: "issued",
				createdAt: new Date().toISOString(),
			},
			{
				workspaceId: "ws-1",
				directiveId: "dir-resolved",
				directiveType: "rework",
				attemptNumber: 1,
				severity: "low",
				summary: "Resolved",
				directive: "Do Y",
				allowedActions: ["edit"],
				forbiddenActions: [],
				retryBudget: 3,
				escalateAfter: 5,
				status: "resolved",
				createdAt: new Date().toISOString(),
			},
		];

		const stateStore = createStateStoreMock(wsState, {
			getLeadDirectives: async () => directives,
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.activeDirectives).toHaveLength(1);
		expect(body.context.activeDirectives[0].directiveId).toBe("dir-active");
	});

	it("includes active escalations", async () => {
		const wsState = { stage: "blocked", attempts: 3 };

		const escalations = [
			{
				escalationId: "esc-1",
				planExecutionId: "plan-1",
				workspaceId: "ws-1",
				severity: "blocking",
				title: "Blocked on dependency",
				summary: "Package not found",
				status: "awaiting_user",
				createdAt: new Date().toISOString(),
			},
		];

		const stateStore = createStateStoreMock(wsState, {
			getLeadEscalations: async () => escalations,
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.activeEscalations).toHaveLength(1);
		expect(body.context.activeEscalations[0].escalationId).toBe("esc-1");
	});

	it("filters out non-awaiting escalations", async () => {
		const wsState = { stage: "blocked", attempts: 3 };

		const escalations = [
			{
				escalationId: "esc-active",
				planExecutionId: "plan-1",
				workspaceId: "ws-1",
				severity: "blocking",
				title: "Active",
				summary: "Need input",
				status: "awaiting_user",
				createdAt: new Date().toISOString(),
			},
			{
				escalationId: "esc-resolved",
				planExecutionId: "plan-1",
				workspaceId: "ws-1",
				severity: "low",
				title: "Resolved",
				summary: "Already handled",
				status: "resolved",
				createdAt: new Date().toISOString(),
			},
		];

		const stateStore = createStateStoreMock(wsState, {
			getLeadEscalations: async () => escalations,
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.activeEscalations).toHaveLength(1);
		expect(body.context.activeEscalations[0].escalationId).toBe("esc-active");
	});

	it("extracts human directive from control request", async () => {
		const wsState = { stage: "active", attempts: 1 };

		const stateStore = createStateStoreMock(wsState, {
			readControlRequest: async () => ({
				workspaceId: "ws-1",
				action: "human_directive",
				reason: "Please use async/await syntax",
			}),
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.humanDirective).toBe("Please use async/await syntax");
	});

	it("falls back to workspace state for human directive", async () => {
		const wsState = {
			stage: "active",
			attempts: 1,
			humanDirective: "Use async/await",
		};

		const stateStore = createStateStoreMock(wsState, {
			readControlRequest: async () => null,
			// Force getWorkspaceState to return wsState with humanDirective
			getWorkspaceState: async () => wsState,
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.humanDirective).toBe("Use async/await");
	});

	// -----------------------------------------------------------------------
	// Role extraction
	// -----------------------------------------------------------------------

	it("extracts role from workspace state", async () => {
		const wsState = {
			stage: "active",
			attempts: 1,
			role: "reviewer",
		};

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.role).toBe("reviewer");
	});

	it("defaults role to 'worker' when not specified", async () => {
		const wsState = { stage: "active", attempts: 0 };

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.role).toBe("worker");
	});

	// -----------------------------------------------------------------------
	// Goal extraction fallbacks
	// -----------------------------------------------------------------------

	it("falls back to title for goal", async () => {
		const wsState = {
			stage: "active",
			attempts: 0,
			title: "Implement login",
		};

		const stateStore = createStateStoreMock(wsState);
		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.goal).toBe("Implement login");
	});

	it("falls back to loadState workspaces for goal", async () => {
		const wsState = { stage: "active", attempts: 0 };

		const stateStore = createStateStoreMock(wsState, {
			loadState: () => ({
				workspaces: new Map([["ws-1", { goal: "Goal from loadState" }]]),
			}),
		});

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		const body = JSON.parse(response.payload);
		expect(body.context.goal).toBe("Goal from loadState");
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	it("returns 500 when state store throws", async () => {
		const stateStore = {
			getWorkspaceState: async () => {
				throw new Error("DB connection failed");
			},
		};

		const app = await createApp(workspaceRoot, stateStore);

		const response = await app.inject({
			method: "GET",
			url: "/api/worker-context/plan-1/ws-1",
		});

		expect(response.statusCode).toBe(500);
		const body = JSON.parse(response.payload);
		expect(body.success).toBe(false);
		expect(body.error).toBe("Failed to get worker context");
	});
});
