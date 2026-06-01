/**
 * Read Model Routes Tests — P42.01 Read Model API Endpoints
 *
 * Tests for all read model HTTP endpoints registered by registerReadModelRoutes().
 *
 * Covers:
 *   - GET /plan-summary
 *   - GET /stats-verbose
 *   - GET /dependency-graph
 *   - GET /workspace-summary
 *   - GET /commands
 *   - GET /directives
 *   - GET /escalations
 *   - GET /validation
 *   - GET /changed-files
 *   - GET /file-tree
 *   - GET /file-content
 *   - GET /file-diff
 *   - GET /transcript
 *   - GET /artifacts
 *   - Error handling (404, 500, missing params)
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerReadModelRoutes } from "../src/read-model-routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
	const dir = join(tmpdir(), `read-model-routes-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Create a minimal Fastify app with read model routes.
 */
async function createApp(workspaceRoot: string, stateStore: any = {}, adapterOverrides?: Record<string, any>) {
	const app = Fastify({ logger: false });

	// We need to override the adapter creation to inject mocks.
	// The read-model-routes uses createReadModelAdapter inside each handler.
	// Instead, we'll mock createExecutionReadModel at the module level.
	// But that changes module-level state. Let's use a different approach:
	// we provide stateStore and workspaceRoot which the adapter uses.

	registerReadModelRoutes(
		app,
		() => stateStore,
		() => workspaceRoot,
	);
	await app.ready();
	return app;
}

/**
 * Create a basic state store mock with a readJournal implementation.
 */
function createStateStore(events: any[] = []): any {
	return {
		loadState: vi.fn().mockResolvedValue(null),
		readJournal: vi.fn().mockResolvedValue(events),
		getWorkspaceState: vi.fn().mockResolvedValue(null),
	};
}

function makeJournalEvent(overrides: {
	type?: string;
	timestamp?: number;
	workspaceId?: string;
	data?: Record<string, unknown>;
}): any {
	return {
		type: overrides.type ?? "plan_started",
		timestamp: overrides.timestamp ?? Date.now(),
		workspaceId: overrides.workspaceId,
		data: overrides.data ?? null,
	};
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Read Model Routes", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// GET /plan-summary
	// -----------------------------------------------------------------------
	describe("GET /plan-summary", () => {
		it("should return 200 with plan summary when data available", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "plan_started",
						workspaceId: undefined,
						data: { projectId: "proj-1", phase: "dev", title: "Test Plan" },
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/plan-summary",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.summary.title).toBe("Test Plan");
			expect(body.summary.id).toBe("exec-1");
		});

		it("should return 200 with unavailable state when no plan data", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/plan-summary",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.summary.status).toBe("unknown");
			expect(body.summary.dataAvailability.available).toBe(false);
		});

		it("should return 200 with unavailable state when adapter error occurs", async () => {
			// The read model catches adapter errors internally and returns
			// fallback unavailable state instead of throwing.
			const stateStore = {
				loadState: vi.fn().mockRejectedValue(new Error("Unexpected error")),
				readJournal: vi.fn().mockRejectedValue(new Error("Unexpected error")),
			};
			const app = await createApp(tempDir, stateStore);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/plan-summary",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.summary.status).toBe("unknown");
			expect(body.summary.dataAvailability.available).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// GET /stats-verbose
	// -----------------------------------------------------------------------
	describe("GET /stats-verbose", () => {
		it("should return 200 with stats", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/stats-verbose",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.stats.planExecutionId).toBe("exec-1");
			expect(body.stats.dataSource).toBe("unavailable");
		});

		it("should return stats computed from events", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "plan_started",
						workspaceId: undefined,
						data: { totalWorkspaces: 2 },
					}),
					makeJournalEvent({
						type: "workspace_completed",
						workspaceId: "ws-1",
					}),
					makeJournalEvent({
						type: "workspace_running",
						workspaceId: "ws-2",
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/stats-verbose",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.stats.totalWorkspaces).toBe(2);
			expect(body.stats.completedWorkspaces).toBe(1);
			expect(body.stats.runningWorkspaces).toBe(1);
			expect(body.stats.dataSource).toBe("events");
		});
	});

	// -----------------------------------------------------------------------
	// GET /dependency-graph
	// -----------------------------------------------------------------------
	describe("GET /dependency-graph", () => {
		it("should return 200 with dependency graph", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "plan_started",
						workspaceId: undefined,
						data: {
							workspaces: [
								{ id: "ws-1", dependencies: [], batch: 0 },
								{ id: "ws-2", dependencies: ["ws-1"], batch: 1 },
							],
						},
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/dependency-graph",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.graph.nodes).toHaveLength(2);
			expect(body.graph.totalBatches).toBe(2);
		});

		it("should return unavailable when no data", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/dependency-graph",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.graph.dataAvailability.available).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// GET /workspace-summary
	// -----------------------------------------------------------------------
	describe("GET /workspace-summary", () => {
		it("should return 200 with workspace summary", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "workspace_completed",
						workspaceId: "ws-1",
						timestamp: Date.now() - 1000,
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/workspace-summary",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.summary.workspaceId).toBe("ws-1");
			expect(body.summary.stage).toBe("Complete");
		});

		it("should return unavailable when workspace not found", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/missing/workspace-summary",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.summary.dataAvailability.available).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// GET /commands
	// -----------------------------------------------------------------------
	describe("GET /commands", () => {
		it("should return 200 with command history", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "command_started",
						workspaceId: "ws-1",
						data: { command: "npm test", cwd: "/p" },
						timestamp: Date.now() - 5000,
					}),
					makeJournalEvent({
						type: "command_finished",
						workspaceId: "ws-1",
						data: { command: "npm test", cwd: "/p", exitCode: 0 },
						timestamp: Date.now(),
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/commands",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.commands).toHaveLength(1);
			expect(body.commands[0].command).toBe("npm test");
		});

		it("should return empty array when no commands", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/commands",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.commands).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// GET /directives
	// -----------------------------------------------------------------------
	describe("GET /directives", () => {
		it("should return 200 with directives", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "lead_agent_directive_issued",
						workspaceId: "ws-1",
						data: {
							directiveId: "dir-1",
							workspaceId: "ws-1",
							summary: "Fix build",
							directive: "Fix the build",
						},
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/directives",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.directives).toHaveLength(1);
			expect(body.directives[0].directiveId).toBe("dir-1");
		});

		it("should return empty array when no directives", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/directives",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.directives).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// GET /escalations
	// -----------------------------------------------------------------------
	describe("GET /escalations", () => {
		it("should return 200 with escalations", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "lead_agent_escalation_initiated",
						workspaceId: "ws-1",
						data: {
							escalationId: "esc-1",
							workspaceId: "ws-1",
							severity: "blocking",
							title: "Test failure",
							summary: "Tests fail",
							whatHappened: "42 tests fail",
							whyStuck: "Missing mock",
							options: [{ id: "opt-1", label: "Fix", risk: "low" }],
							recommendedOptionId: "opt-1",
						},
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/escalations",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.escalations).toHaveLength(1);
			expect(body.escalations[0].escalationId).toBe("esc-1");
		});
	});

	// -----------------------------------------------------------------------
	// GET /validation
	// -----------------------------------------------------------------------
	describe("GET /validation", () => {
		it("should return default validation state when no governance events", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/validation",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.validation.required).toBe(true);
			expect(body.validation.passed).toBeNull();
		});

		it("should reflect governance_approved", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "governance_approved",
						workspaceId: "ws-1",
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/validation",
			});

			const body = res.json();
			expect(body.validation.passed).toBe(true);
			expect(body.validation.blocked).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// GET /changed-files
	// -----------------------------------------------------------------------
	describe("GET /changed-files", () => {
		it("should return 200 with changed files", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "worker_completed",
						workspaceId: "ws-1",
						data: { changedFiles: ["src/index.ts", "README.md"] },
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/changed-files",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.files).toHaveLength(2);
			expect(body.files[0].path).toBe("README.md");
		});
	});

	// -----------------------------------------------------------------------
	// GET /file-tree
	// -----------------------------------------------------------------------
	describe("GET /file-tree", () => {
		it("should return 200 with file tree", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "worker_completed",
						workspaceId: "ws-1",
						data: { changedFiles: ["src/index.ts", "src/lib.ts", "README.md"] },
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-tree",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.tree.length).toBeGreaterThan(0);
			// First entry should be 'src' directory
			expect(body.tree[0].isDir).toBe(true);
			expect(body.tree[0].path).toBe("src");
		});

		it("should support ?flat=true", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "worker_completed",
						workspaceId: "ws-1",
						data: { changedFiles: ["src/index.ts"] },
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-tree?flat=true",
			});

			const body = res.json();
			expect(body.tree[0].isDir).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// GET /file-content
	// -----------------------------------------------------------------------
	describe("GET /file-content", () => {
		it("should return 400 when path param missing", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-content",
			});

			expect(res.statusCode).toBe(400);
		});

		it("should return unavailable state when file not found", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-content?path=missing.ts",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.content).toBeNull();
			expect(body.available).toBe(false);
		});

		it("should return file content from archive", async () => {
			const archiveDir = join(tempDir, ".pi", "executions", "exec-1", "workspaces", "ws-1");
			mkdirSync(join(archiveDir, "src"), { recursive: true });
			writeFileSync(join(archiveDir, "src", "index.ts"), "const x = 1;", "utf-8");

			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-content?path=src/index.ts",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.content.content).toBe("const x = 1;");
		});
	});

	// -----------------------------------------------------------------------
	// GET /file-diff
	// -----------------------------------------------------------------------
	describe("GET /file-diff", () => {
		it("should return empty when no diff archive available", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-diff",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.diffs).toEqual([]);
			expect(body.available).toBe(false);
		});

		it("should return diff from archive diff.patch", async () => {
			const archiveDir = join(tempDir, ".pi", "executions", "exec-1", "workspaces", "ws-1");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(
				join(archiveDir, "diff.patch"),
				"diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n",
				"utf-8",
			);

			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-diff",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.diffs.length).toBeGreaterThan(0);
			expect(body.diffs[0].additions).toBe(1);
			expect(body.diffs[0].deletions).toBe(1);
		});

		it("should filter by path param", async () => {
			const archiveDir = join(tempDir, ".pi", "executions", "exec-1", "workspaces", "ws-1");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(
				join(archiveDir, "diff.patch"),
				"diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n",
				"utf-8",
			);

			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/file-diff?path=src/index.ts",
			});

			const body = res.json();
			expect(body.diffs).toHaveLength(1);
			expect(body.diffs[0].path).toBe("src/index.ts");
		});
	});

	// -----------------------------------------------------------------------
	// GET /transcript
	// -----------------------------------------------------------------------
	describe("GET /transcript", () => {
		it("should return 200 with transcript events", async () => {
			const app = await createApp(
				tempDir,
				createStateStore([
					makeJournalEvent({
						type: "workspace_completed",
						workspaceId: "ws-1",
					}),
				]),
			);

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/workspaces/ws-1/transcript",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.events.length).toBeGreaterThan(0);
		});
	});

	// -----------------------------------------------------------------------
	// GET /artifacts
	// -----------------------------------------------------------------------
	describe("GET /artifacts", () => {
		it("should return 200 with artifacts list", async () => {
			const archiveDir = join(tempDir, ".pi", "executions", "exec-1");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(join(archiveDir, "plan.md"), "# Plan", "utf-8");

			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/artifacts",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.success).toBe(true);
			expect(body.artifacts.length).toBeGreaterThan(0);
			expect(body.artifacts[0].dataAvailability.available).toBe(true);
		});

		it("should return empty list when no archive", async () => {
			const app = await createApp(tempDir, createStateStore([]));

			const res = await app.inject({
				method: "GET",
				url: "/api/projects/proj-1/plans/exec-1/artifacts",
			});

			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.artifacts).toEqual([]);
		});
	});
});
