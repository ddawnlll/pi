/**
 * Web Server - P2 Phase 1 Multi-Project Dashboard API
 *
 * Provides REST API for plan execution monitoring and control.
 * Supports both JSON (legacy file-based) and PostgreSQL backends.
 *
 * Endpoints:
 *   GET    /api/plan-state                    Legacy: poll plan state
 *   GET    /api/events                        Legacy: SSE stream of execution journal
 *   GET    /api/logs/:workspaceId/:attempt/:stream  Legacy: SSE stream of worker logs
 *   POST   /api/control                       Legacy: send control command
 *
 *   GET    /api/projects                      List projects
 *   POST   /api/projects                      Create project
 *   GET    /api/projects/:projectId/plans     List plan executions for project
 *   GET    /api/projects/:projectId/plans/:planExecId  Get plan execution detail
 *   GET    /api/projects/:projectId/plans/:planExecId/events  SSE: plan events
 *
 *   POST   /api/projects/:projectId/plans/validate  Validate plan content
 *   POST   /api/projects/:projectId/plans/run       Upload and run a plan
 *   GET    /api/projects/:projectId/active          Get active execution info
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { readFile, watch, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getModels, getProviders } from "@earendil-works/pi-ai";
import {
	createSafetyDoctor,
	detectStateStoreBackend,
	JsonStateStore,
	parsePlan,
} from "@earendil-works/pi-coding-agent";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { getActiveExecution, getActiveExecutions, resumeStrandedExecutions, runPlan } from "./plan-runner.js";
import { getSettingsManager, getStateStore, getWorkspaceRoot } from "./state-store-provider.js";

// ── helpers for enriching workspace data ────────────────────────────────────

const DEFAULT_CONTEXT_LIMIT = 128_000;

/**
 * Parse a workspace execution log to extract token usage and metadata.
 */
function parseWorkspaceLog(logContent: string): {
	promptLength?: number;
	messages?: number;
	provider?: string;
	model?: string;
} {
	const result: { promptLength?: number; messages?: number; provider?: string; model?: string } = {};
	for (const line of logContent.split("\n")) {
		const promptMatch = line.match(/Prompt length: (\d+) characters/);
		if (promptMatch) result.promptLength = Number(promptMatch[1]);
		const msgMatch = line.match(/Total messages in session: (\d+)/);
		if (msgMatch) result.messages = Number(msgMatch[1]);
		const provMatch = line.match(/Provider: (.+)/);
		if (provMatch) result.provider = provMatch[1].trim();
		const modelMatch = line.match(/Model: (.+)/);
		if (modelMatch) result.model = modelMatch[1].trim();
	}
	return result;
}

/**
 * Estimate context used based on prompt length.
 * Uses the chars/4 heuristic from token-metering.ts.
 */
function estimateContextUsed(logContent: string): number {
	const parsed = parseWorkspaceLog(logContent);
	if (parsed.promptLength) {
		return Math.ceil(parsed.promptLength / 4);
	}
	// Fallback: total log characters / 4
	return Math.ceil(logContent.length / 4);
}

/**
 * Get git info for a workspace by checking its working directory.
 */
function getGitInfo(workspaceRoot: string): { branch?: string; dirty?: boolean; recentCommits?: string[] } {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const status = execSync("git status --porcelain", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const dirty = status.length > 0;

		const logOutput = execSync("git log --oneline -5", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const recentCommits = logOutput ? logOutput.split("\n") : [];

		return { branch, dirty, recentCommits };
	} catch {
		return {};
	}
}

const fastify = Fastify({
	logger: true,
});

// CORS for local development
await fastify.register(fastifyCors, {
	origin: true,
});

// WebSocket support
await fastify.register(fastifyWebsocket);

// Serve static dashboard files
const dashboardDist = resolve(process.cwd(), "../web-ui/dist");
await fastify.register(fastifyStatic, {
	root: dashboardDist,
	prefix: "/",
});

// ---------------------------------------------------------------------------
// State store initialization (delegated to state-store-provider.ts)
// ---------------------------------------------------------------------------

function _getJsonStateStore(): JsonStateStore {
	const store = getStateStore();
	if (store instanceof JsonStateStore) {
		return store;
	}
	// Wrap in JsonStateStore for legacy file access
	return new JsonStateStore(getWorkspaceRoot());
}

// ---------------------------------------------------------------------------
// Helper to get .pi directory (legacy)
// ---------------------------------------------------------------------------

function getPiDir(): string {
	const piDir = resolve(process.cwd(), "../../.pi");
	return piDir;
}

// ---------------------------------------------------------------------------
// Legacy Types & Endpoints (backward compatible)
// ---------------------------------------------------------------------------

interface LegacyPlanState {
	title: string;
	phase: string;
	status: "running" | "paused" | "stopped" | "completed" | "failed";
	elapsed: number;
	queue: {
		pending: number;
		active: number;
		blocked: number;
		complete: number;
		failed: number;
	};
	workers: Array<{
		id: string;
		stage: string;
		attempt: number;
		retries: number;
		snapshotPath?: string;
		reportPath?: string;
	}>;
}

interface LegacyControlRequest {
	action: "pause" | "stop" | "cancel" | "resume";
	requestedAt: string;
	requestedBy: string;
}

/**
 * GET /api/plan-state - Poll plan state (legacy)
 */
fastify.get("/api/plan-state", async (_request, reply) => {
	const piDir = getPiDir();
	const stateFile = join(piDir, "plan-state.json");

	fastify.log.info({ piDir, stateFile, exists: existsSync(stateFile) }, "Checking plan state file");

	if (!existsSync(stateFile)) {
		return reply.code(404).send({ error: "Plan state not found", path: stateFile });
	}

	try {
		const content = await readFile(stateFile, "utf-8");
		fastify.log.info({ contentLength: content.length }, "Read plan state file");
		const state: LegacyPlanState = JSON.parse(content);
		return state;
	} catch (error) {
		fastify.log.error({ error }, "Failed to read plan state");
		return reply.code(500).send({ error: "Failed to read plan state", message: String(error) });
	}
});

/**
 * GET /api/events - SSE stream of execution journal (legacy)
 */
fastify.get("/api/events", async (request, reply) => {
	const journalFile = join(getPiDir(), "execution-journal.ndjson");

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	// Send existing events first
	if (existsSync(journalFile)) {
		try {
			const content = await readFile(journalFile, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);

			// Send last 50 events
			const recentLines = lines.slice(-50);
			for (const line of recentLines) {
				reply.raw.write(`data: ${line}\n\n`);
			}
		} catch (_error) {
			// Ignore read errors
		}
	}

	// Watch for new events
	const abortController = new AbortController();

	request.raw.on("close", () => {
		abortController.abort();
	});

	try {
		const watcher = watch(journalFile, { signal: abortController.signal });

		for await (const event of watcher) {
			if (event.eventType === "change") {
				try {
					const content = await readFile(journalFile, "utf-8");
					const lines = content.trim().split("\n").filter(Boolean);
					const lastLine = lines[lines.length - 1];

					if (lastLine) {
						reply.raw.write(`data: ${lastLine}\n\n`);
					}
				} catch (_error) {
					// Ignore read errors
				}
			}
		}
	} catch (_error) {
		// Watcher aborted or file doesn't exist
	}
});

/**
 * GET /api/logs/:workspaceId/:attempt/:stream - SSE stream of worker logs (legacy)
 *
 * First tries the legacy file path (workspaces/:workspaceId/attempts/:attempt/:stream.log).
 * Falls back to the state store if a `planExecId` query param is provided.
 */
fastify.get<{
	Params: { workspaceId: string; attempt: string; stream: string };
	Querystring: { planExecId?: string };
}>("/api/logs/:workspaceId/:attempt/:stream", async (request, reply) => {
	const { workspaceId, attempt, stream } = request.params;
	const { planExecId } = request.query;
	const logFile = join(getPiDir(), "workspaces", workspaceId, "attempts", attempt, `${stream}.log`);

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	let hasLogs = false;

	// 1. Try legacy file path
	if (existsSync(logFile)) {
		try {
			const content = await readFile(logFile, "utf-8");
			const lines = content.split("\n").filter(Boolean);
			for (const line of lines) {
				reply.raw.write(`data: ${line}\n\n`);
			}
			if (lines.length > 0) hasLogs = true;
		} catch {
			// Ignore read errors
		}
	}

	// 2. Fallback: state store (new execution path)
	if (!hasLogs && planExecId) {
		try {
			const stateStore = getStateStore();
			if (typeof (stateStore as any).loadWorkspaceLog === "function") {
				const content = (await (stateStore as any).loadWorkspaceLog(planExecId, workspaceId)) as string | null;
				if (content) {
					const lines = content.split("\n").filter(Boolean);
					for (const line of lines) {
						reply.raw.write(`data: ${line}\n\n`);
					}
					if (lines.length > 0) hasLogs = true;
				}
			}
		} catch {
			// Ignore fallback errors
		}
	}

	// If no logs were found and no file to watch, close the response immediately.
	// This lets the EventSource detect the end and fire onopen/onerror gracefully.
	if (!hasLogs) {
		// Signal the end of stream — no logs available
		reply.raw.write(`data: __NO_LOGS__\n\n`);
		reply.raw.end();
		return;
	}

	// Watch for new log lines on the legacy file (live updates)
	const abortController = new AbortController();
	request.raw.on("close", () => abortController.abort());

	try {
		const watcher = watch(logFile, { signal: abortController.signal });
		for await (const event of watcher) {
			if (event.eventType === "change") {
				try {
					const content = await readFile(logFile, "utf-8");
					const lines = content.split("\n").filter(Boolean);
					const lastLine = lines[lines.length - 1];
					if (lastLine) {
						reply.raw.write(`data: ${lastLine}\n\n`);
					}
				} catch {
					// Ignore read errors
				}
			}
		}
	} catch {
		// Watcher aborted or file doesn't exist
	}
});

/**
 * POST /api/control - Send control command (legacy)
 */
fastify.post<{ Body: LegacyControlRequest }>("/api/control", async (request, reply) => {
	const { action, requestedAt, requestedBy } = request.body;
	const controlFile = join(getPiDir(), "plan-control.json");

	// Validate action
	if (!["pause", "stop", "cancel", "resume"].includes(action)) {
		return reply.code(400).send({ success: false, error: "Invalid action" });
	}

	// Check resume safety
	if (action === "resume") {
		try {
			if (existsSync(controlFile)) {
				const content = await readFile(controlFile, "utf-8");
				const currentControl = JSON.parse(content);

				if (currentControl.action !== "pause") {
					return reply.code(409).send({
						success: false,
						error: `resume not safe: current action is ${currentControl.action}`,
					});
				}
			}
		} catch (_error) {
			// If we can't read current state, allow resume
		}
	}

	// For cancel on a stopped/paused plan with no active loop, execute immediately
	if (action === "cancel") {
		try {
			const stateStore = getStateStore();
			const jsonStore = _getJsonStateStore();
			const planState = jsonStore.getPlanStateStore().getState();

			if (planState && (planState.status === "stopped" || planState.status === "paused")) {
				// No active loop, execute cancel immediately
				await stateStore.cancelPlan("current-exec-id");
				// Clear the control file since we processed it
				try {
					await fs.unlink(controlFile);
				} catch {
					// Ignore if file doesn't exist
				}
				return { success: true, immediate: true };
			}
		} catch (error) {
			// Fall through to write control file
			fastify.log.warn({ error }, "Failed to execute immediate cancel");
		}
	}

	// Write control file for active loop to process
	try {
		const controlData = { action, requestedAt, requestedBy };
		await writeFile(controlFile, JSON.stringify(controlData, null, 2));
		return { success: true };
	} catch (_error) {
		return reply.code(500).send({ success: false, error: "Failed to write control file" });
	}
});

// ---------------------------------------------------------------------------
// New Project CRUD Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/projects - List all projects
 */
fastify.get("/api/projects", async (_request, reply) => {
	try {
		const stateStore = getStateStore();
		const projects = await stateStore.listProjects();
		return { projects };
	} catch (error) {
		fastify.log.error({ error }, "Failed to list projects");
		return reply.code(500).send({ error: "Failed to list projects", message: String(error) });
	}
});

/**
 * POST /api/projects - Create a new project
 */
fastify.post<{
	Body: { name: string; rootPath?: string };
}>("/api/projects", async (request, reply) => {
	const { name, rootPath } = request.body;

	if (!name || typeof name !== "string" || name.trim().length === 0) {
		return reply.code(400).send({ error: "Project name is required" });
	}

	try {
		const stateStore = getStateStore();
		const project = await stateStore.findOrCreateProject(name.trim(), rootPath);
		return reply.code(201).send(project);
	} catch (error) {
		fastify.log.error({ error }, "Failed to create project");
		return reply.code(500).send({ error: "Failed to create project", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Plan Execution Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/projects/:projectId/plans - List plan executions for a project
 */
fastify.get<{
	Params: { projectId: string };
}>("/api/projects/:projectId/plans", async (request, reply) => {
	const { projectId } = request.params;

	try {
		const stateStore = getStateStore();
		const executions = await stateStore.listPlanExecutions(projectId);
		return { executions };
	} catch (error) {
		fastify.log.error({ error }, "Failed to list plan executions");
		return reply.code(500).send({ error: "Failed to list plan executions", message: String(error) });
	}
});

/**
 * GET /api/projects/:projectId/plans/:planExecId - Get plan execution detail
 */
fastify.get<{
	Params: { projectId: string; planExecId: string };
}>("/api/projects/:projectId/plans/:planExecId", async (request, reply) => {
	const { planExecId } = request.params;

	try {
		const stateStore = getStateStore();
		const state = await stateStore.loadState(planExecId);

		if (!state) {
			return reply.code(404).send({ error: "Plan execution not found" });
		}

		const piDir = getPiDir();
		const workspaceRoot = getWorkspaceRoot();
		const workspacesArr: Array<{
			id: string;
			stage: string;
			attempts: number;
			error: string | null;
			startedAt: number | null;
			completedAt: number | null;
			contextUsed?: number;
			contextLimit?: number;
			gitBranch?: string;
			gitDirty?: boolean;
			gitCommits?: string[];
		}> = [];

		for (const [id, ws] of state.workspaces) {
			// Load workspace execution log for token/git enrichment
			let contextUsed: number | undefined;
			try {
				for (let a = ws.attempts; a >= 1; a--) {
					const logFile = join(piDir, "workspaces", id, `execution-${a}.log`);
					if (existsSync(logFile)) {
						const content = await readFile(logFile, "utf-8");
						contextUsed = estimateContextUsed(content);
						break;
					}
				}
			} catch {
				// Log not available
			}

			const _gi = getGitInfo(workspaceRoot);
			const gitBranch = _gi.branch;
			const gitDirty = _gi.dirty;
			const gitCommits = _gi.recentCommits;

			workspacesArr.push({
				id,
				stage: ws.stage,
				attempts: ws.attempts,
				error: (ws as any).error ?? null,
				startedAt: (ws as any).startedAt ?? null,
				completedAt: (ws as any).completedAt ?? null,
				contextUsed,
				contextLimit: DEFAULT_CONTEXT_LIMIT,
				gitBranch,
				gitDirty,
				gitCommits,
			});
		}

		return {
			planExecutionId: planExecId,
			phase: state.phase,
			title: state.title,
			status: state.status,
			startedAt: state.startedAt,
			completedAt: state.completedAt ?? null,
			workspaces: workspacesArr,
		};
	} catch (error) {
		fastify.log.error({ error }, "Failed to get plan execution");
		return reply.code(500).send({ error: "Failed to get plan execution", message: String(error) });
	}
});

/**
 * GET /api/projects/:projectId/plans/:planExecId/events - SSE stream of plan events
 *
 * Uses LISTEN/NOTIFY when PostgreSQL backend is active, falls back to
 * file watching for JSON backend.
 */
fastify.get<{
	Params: { projectId: string; planExecId: string };
}>("/api/projects/:projectId/plans/:planExecId/events", async (request, reply) => {
	const { planExecId } = request.params;

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});

	// Send initial connection event
	reply.raw.write(`data: ${JSON.stringify({ type: "connected", planExecutionId: planExecId })}\n\n`);

	// Send existing journal events
	try {
		const stateStore = getStateStore();
		const journal = await stateStore.readJournal(planExecId);
		const recentEvents = journal.slice(-100);
		for (const event of recentEvents) {
			reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
		}
	} catch (_error) {
		// Ignore read errors
	}

	// For JSON backend, fall back to file watching
	const backendType = getStateStore().getBackendType();

	if (backendType === "json") {
		// File-watching fallback
		const journalFile = join(getPiDir(), "execution-journal.ndjson");
		const abortController = new AbortController();

		request.raw.on("close", () => {
			abortController.abort();
		});

		try {
			const watcher = watch(journalFile, { signal: abortController.signal });
			for await (const event of watcher) {
				if (event.eventType === "change") {
					try {
						const content = await readFile(journalFile, "utf-8");
						const lines = content.trim().split("\n").filter(Boolean);
						const lastLine = lines[lines.length - 1];
						if (lastLine) {
							reply.raw.write(`data: ${lastLine}\n\n`);
						}
					} catch (_error) {
						// Ignore read errors
					}
				}
			}
		} catch (_error) {
			// Watcher aborted
		}
	} else {
		// PostgreSQL backend - use LISTEN/NOTIFY
		try {
			const { NotifyClient } = await import("@earendil-works/pi-db");
			const notifyClient = new NotifyClient();

			(notifyClient as any).on("plan_events", (payload: string) => {
				try {
					const event = JSON.parse(payload);
					reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
				} catch (_error) {
					// Ignore parse errors
				}
			});

			await (notifyClient as any).connect();

			request.raw.on("close", () => {
				(notifyClient as any).disconnect();
			});

			// Keep connection alive
			const keepAlive = setInterval(() => {
				reply.raw.write(": keepalive\n\n");
			}, 15000);

			request.raw.on("close", () => {
				clearInterval(keepAlive);
			});
		} catch (_error) {
			// If NotifyClient is unavailable, just keep the connection open
			fastify.log.warn("LISTEN/NOTIFY unavailable for SSE, using no-op connection");
		}
	}
});

/**
 * GET /api/projects/:projectId/plans/:planExecId/stats - Plan execution statistics
 */
fastify.get<{
	Params: { projectId: string; planExecId: string };
}>("/api/projects/:projectId/plans/:planExecId/stats", async (request, reply) => {
	const { planExecId } = request.params;

	try {
		const stateStore = getStateStore();
		const stats = await stateStore.getStatistics(planExecId);

		if (!stats) {
			return reply.code(404).send({ error: "Plan execution not found" });
		}

		return stats;
	} catch (error) {
		fastify.log.error({ error }, "Failed to get plan statistics");
		return reply.code(500).send({ error: "Failed to get plan statistics", message: String(error) });
	}
});

/**
 * GET /api/projects/:projectId/plans/:planExecId/journal - Read execution journal
 */
fastify.get<{
	Params: { projectId: string; planExecId: string };
	Querystring: { limit?: string; offset?: string };
}>("/api/projects/:projectId/plans/:planExecId/journal", async (request, reply) => {
	const { planExecId } = request.params;
	const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : 100;
	const offset = request.query.offset ? Number.parseInt(request.query.offset, 10) : 0;

	try {
		const stateStore = getStateStore();
		const journal = await stateStore.readJournal(planExecId);

		// Apply pagination
		const paginated = journal.slice(offset, offset + limit);

		return {
			events: paginated,
			total: journal.length,
			limit,
			offset,
		};
	} catch (error) {
		fastify.log.error({ error }, "Failed to read journal");
		return reply.code(500).send({ error: "Failed to read journal", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Workspace Execution Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/projects/:projectId/plans/:planExecId/workspaces - List workspace executions
 */
fastify.get<{
	Params: { projectId: string; planExecId: string };
}>("/api/projects/:projectId/plans/:planExecId/workspaces", async (request, reply) => {
	const { planExecId } = request.params;

	try {
		const stateStore = getStateStore();
		const state = await stateStore.loadState(planExecId);

		if (!state) {
			return reply.code(404).send({ error: "Plan execution not found" });
		}

		const piDir = getPiDir();
		const workspaceRoot = getWorkspaceRoot();
		const workspacesArr: Array<{
			id: string;
			stage: string;
			attempts: number;
			error: string | null;
			startedAt: number | null;
			completedAt: number | null;
			ownedFiles: string[];
			contextUsed?: number;
			contextLimit?: number;
			gitBranch?: string;
			gitDirty?: boolean;
			gitCommits?: string[];
		}> = [];

		for (const [id, ws] of state.workspaces) {
			let contextUsed: number | undefined;

			try {
				for (let a = (ws as any).attempts ?? 1; a >= 1; a--) {
					const logFile = join(piDir, "workspaces", id, `execution-${a}.log`);
					if (existsSync(logFile)) {
						const content = await readFile(logFile, "utf-8");
						contextUsed = estimateContextUsed(content);
						break;
					}
				}
			} catch {
				// Log not available
			}

			const _gi = getGitInfo(workspaceRoot);
			const gitBranch = _gi.branch;
			const gitDirty = _gi.dirty;
			const gitCommits = _gi.recentCommits;

			workspacesArr.push({
				id,
				stage: ws.stage,
				attempts: ws.attempts,
				error: (ws as any).error ?? null,
				startedAt: (ws as any).startedAt ?? null,
				completedAt: (ws as any).completedAt ?? null,
				ownedFiles: (ws as any).ownedFiles ?? [],
				contextUsed,
				contextLimit: DEFAULT_CONTEXT_LIMIT,
				gitBranch,
				gitDirty,
				gitCommits,
			});
		}

		return { workspaces: workspacesArr };
	} catch (error) {
		fastify.log.error({ error }, "Failed to list workspace executions");
		return reply.code(500).send({ error: "Failed to list workspace executions", message: String(error) });
	}
});

/**
 * GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId - Get workspace detail
 */
fastify.get<{
	Params: { projectId: string; planExecId: string; workspaceId: string };
}>("/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId", async (request, reply) => {
	const { planExecId, workspaceId } = request.params;

	try {
		const stateStore = getStateStore();
		const ws = await stateStore.getWorkspaceState(planExecId, workspaceId);

		if (!ws) {
			return reply.code(404).send({ error: "Workspace not found" });
		}

		// Enrich with context + git data
		let contextUsed: number | undefined;
		const piDir = getPiDir();
		for (let a = (ws as any).attempts ?? 1; a >= 1; a--) {
			const logFile = join(piDir, "workspaces", workspaceId, `execution-${a}.log`);
			if (existsSync(logFile)) {
				const content = await readFile(logFile, "utf-8");
				contextUsed = estimateContextUsed(content);
				break;
			}
		}
		const gitInfo = getGitInfo(getWorkspaceRoot());
		return {
			...ws,
			contextUsed,
			contextLimit: DEFAULT_CONTEXT_LIMIT,
			gitBranch: gitInfo.branch,
			gitDirty: gitInfo.dirty,
			gitCommits: gitInfo.recentCommits,
		};
	} catch (error) {
		fastify.log.error({ error }, "Failed to get workspace");
		return reply.code(500).send({ error: "Failed to get workspace", message: String(error) });
	}
});

/**
 * GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/logs - Get recent workspace logs
 */
fastify.get<{
	Params: { projectId: string; planExecId: string; workspaceId: string };
	Querystring: { limit?: string };
}>("/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/logs", async (request, reply) => {
	const { planExecId, workspaceId } = request.params;
	const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : 100;

	try {
		const stateStore = getStateStore();

		// Try to get recent logs from buffer (JSON backend only)
		if ("getRecentWorkspaceLogs" in stateStore) {
			const fn = (stateStore as any).getRecentWorkspaceLogs;
			if (typeof fn === "function") {
				const recentLogs = fn.call(stateStore, planExecId, workspaceId, limit) as string[];
				if (recentLogs.length > 0) {
					return { logs: recentLogs };
				}
			}
		}

		// Fallback to loading from file
		if ("loadWorkspaceLog" in stateStore) {
			const fn = (stateStore as any).loadWorkspaceLog;
			if (typeof fn === "function") {
				const logContent = (await fn.call(stateStore, planExecId, workspaceId)) as string | null;
				if (!logContent) {
					return { logs: [] };
				}

				const lines = logContent.split("\n").filter(Boolean);
				return { logs: lines.slice(-limit) };
			}
		}

		return { logs: [] };
	} catch (error) {
		fastify.log.error({ error }, "Failed to get workspace logs");
		return reply.code(500).send({ error: "Failed to get workspace logs", message: String(error) });
	}
});

/**
 * WebSocket endpoint for live workspace log streaming
 * ws://localhost:3000/api/ws/logs/:planExecId/:workspaceId
 */
fastify.get<{
	Params: { planExecId: string; workspaceId: string };
}>("/api/ws/logs/:planExecId/:workspaceId", { websocket: true }, (socket, request) => {
	const { planExecId, workspaceId } = request.params;

	fastify.log.info({ planExecId, workspaceId }, "WebSocket log stream connected");

	// Track last sent line count to avoid duplicates
	let lastSentCount = 0;

	// Send recent logs immediately
	(async () => {
		try {
			const stateStore = getStateStore();

			// Get recent logs from buffer or file
			let recentLogs: string[] = [];
			if ("getRecentWorkspaceLogs" in stateStore) {
				const fn = (stateStore as any).getRecentWorkspaceLogs;
				if (typeof fn === "function") {
					recentLogs = fn.call(stateStore, planExecId, workspaceId, 100) as string[];
				}
			}

			if (recentLogs.length === 0 && "loadWorkspaceLog" in stateStore) {
				const fn = (stateStore as any).loadWorkspaceLog;
				if (typeof fn === "function") {
					const logContent = (await fn.call(stateStore, planExecId, workspaceId)) as string | null;
					if (logContent) {
						recentLogs = logContent.split("\n").filter(Boolean).slice(-100);
					}
				}
			}

			// 3. Fallback: read from workspace execution log file
			if (recentLogs.length === 0) {
				try {
					// Try attempt 1, then 2, etc.
					for (let a = 1; a <= 10; a++) {
						const wsLogFile = join(getPiDir(), "workspaces", workspaceId, `execution-${a}.log`);
						if (existsSync(wsLogFile)) {
							const content = await readFile(wsLogFile, "utf-8");
							const lines = content.split("\n").filter(Boolean);
							if (lines.length > 0) {
								recentLogs = lines.slice(-100);
								break;
							}
						}
					}
				} catch {
					// Ignore fallback errors
				}
			}

			// Send recent logs
			for (const line of recentLogs) {
				socket.send(JSON.stringify({ type: "log", data: line }));
			}
			lastSentCount = recentLogs.length;

			// Send ready signal
			socket.send(JSON.stringify({ type: "ready" }));
		} catch (error) {
			fastify.log.error({ error }, "Failed to send initial logs");
			try {
				socket.send(JSON.stringify({ type: "error", message: "Failed to load logs" }));
			} catch {
				// Socket may already be closed — ignore
			}
		}
	})();

	// Set up polling for new logs
	// Checks in-memory buffer first, then falls back to persisted log file/DB.
	const pollInterval = setInterval(async () => {
		try {
			const stateStore = getStateStore();

			// Helper: fetch logs from buffer or persistence
			const fetchLogs = async (): Promise<string[]> => {
				// 1. Try in-memory buffer (fast, real-time)
				if ("getRecentWorkspaceLogs" in stateStore) {
					const fn = (stateStore as any).getRecentWorkspaceLogs;
					if (typeof fn === "function") {
						const bufferLogs = fn.call(stateStore, planExecId, workspaceId, 5000) as string[];
						if (bufferLogs.length > 0) {
							return bufferLogs;
						}
					}
				}

				// 2. Fall back to persisted storage (catches buffer misses from
				//    state store instance mismatches or process restarts)
				if ("loadWorkspaceLog" in stateStore) {
					const fn = (stateStore as any).loadWorkspaceLog;
					if (typeof fn === "function") {
						const logContent = (await fn.call(stateStore, planExecId, workspaceId)) as string | null;
						if (logContent) {
							return logContent.split("\n").filter(Boolean);
						}
					}
				}

				// 3. Fallback: read from workspace execution log file
				try {
					for (let a = 1; a <= 10; a++) {
						const wsLogFile = join(getPiDir(), "workspaces", workspaceId, `execution-${a}.log`);
						if (existsSync(wsLogFile)) {
							const content = await readFile(wsLogFile, "utf-8");
							const lines = content.split("\n").filter(Boolean);
							if (lines.length > 0) {
								return lines;
							}
						}
					}
				} catch {
					// Ignore fallback errors
				}

				return [];
			};

			const allLogs = await fetchLogs();
			if (allLogs.length > lastSentCount) {
				const newLogs = allLogs.slice(lastSentCount);
				for (const line of newLogs) {
					socket.send(JSON.stringify({ type: "log", data: line }));
				}
				lastSentCount = allLogs.length;
			}
		} catch (error) {
			fastify.log.error({ error }, "Failed to poll logs");
		}
	}, 1000);

	socket.on("close", () => {
		clearInterval(pollInterval);
		fastify.log.info({ planExecId, workspaceId }, "WebSocket log stream disconnected");
	});

	socket.on("error", (error: Error) => {
		clearInterval(pollInterval);
		fastify.log.error({ error, planExecId, workspaceId }, "WebSocket log stream error");
		// End the socket to propagate a clean close to the client
		try {
			socket.close(1011, "Internal error");
		} catch {
			// Ignore close errors
		}
	});
});

// ---------------------------------------------------------------------------
// Plan Management Endpoints (upload, validate, run)
// ---------------------------------------------------------------------------

/**
 * POST /api/projects/:projectId/plans/validate - Validate plan content
 *
 * Parses and validates plan content without executing it.
 * Accepts plan content as a JSON body or multipart file upload.
 */
fastify.post<{
	Params: { projectId: string };
	Body: { planContent?: string };
}>("/api/projects/:projectId/plans/validate", async (request, reply) => {
	const { planContent } = request.body;

	if (!planContent) {
		return reply.code(400).send({ error: "Plan content is required" });
	}

	try {
		const parseResult = parsePlan(planContent);

		if (!parseResult.success) {
			return reply.code(400).send({
				success: false,
				errors: parseResult.errors,
				warnings: parseResult.warnings,
			});
		}

		// Queue is guaranteed non-null because success is true
		const queue = parseResult.queue!;

		// Run safety doctor
		const doctor = createSafetyDoctor();
		const safetyReport = doctor.validateQueue(queue);

		return {
			success: true,
			parseResult: {
				title: queue.title,
				phase: queue.phase,
				workspaceCount: queue.workspaces.length,
				maxParallel: queue.maxParallelWorkspaces,
			},
			safety: safetyReport,
			warnings: parseResult.warnings,
		};
	} catch (error) {
		fastify.log.error({ error }, "Failed to validate plan");
		return reply.code(500).send({ error: "Failed to validate plan", message: String(error) });
	}
});

/**
 * POST /api/projects/:projectId/plans/run - Upload and run a plan
 *
 * Accepts plan content as a JSON body, parses it, and starts
 * background execution. Returns the execution ID.
 */
fastify.post<{
	Params: { projectId: string };
	Body: { planContent: string; planFileName?: string };
}>("/api/projects/:projectId/plans/run", async (request, reply) => {
	const { projectId } = request.params;
	const { planContent, planFileName } = request.body;

	if (!planContent) {
		return reply.code(400).send({ error: "Plan content is required" });
	}

	try {
		// Get the project from the state store
		const stateStore = getStateStore();
		const projects = await stateStore.listProjects();
		const project = projects.find((p) => p.id === projectId);

		if (!project) {
			return reply.code(404).send({ error: "Project not found" });
		}

		const projectName = project.name;
		// Use project's root_path if set, otherwise fall back to global workspace root
		const workspaceRoot = project.rootPath || getWorkspaceRoot();

		const result = await runPlan({
			planContent,
			projectId,
			projectName,
			workspaceRoot,
			planFileName,
		});

		if (!result.success) {
			return reply.code(400).send({
				success: false,
				errors: result.errors,
				warnings: result.warnings,
			});
		}

		return reply.code(201).send({
			success: true,
			planExecutionId: result.planExecId,
			execution: result.execution,
			warnings: result.warnings,
		});
	} catch (error) {
		fastify.log.error({ error }, "Failed to run plan");
		return reply.code(500).send({ error: "Failed to run plan", message: String(error) });
	}
});

/**
 * GET /api/projects/:projectId/active - Get active execution info
 */
fastify.get<{
	Params: { projectId: string };
}>("/api/projects/:projectId/active", async (request, reply) => {
	const { projectId } = request.params;

	try {
		const executions = getActiveExecutions(projectId);
		return { executions };
	} catch (error) {
		fastify.log.error({ error }, "Failed to get active executions");
		return reply.code(500).send({ error: "Failed to get active executions", message: String(error) });
	}
});

/**
 * GET /api/executions/:planExecId - Get a specific active execution
 */
fastify.get<{
	Params: { planExecId: string };
}>("/api/executions/:planExecId", async (request, reply) => {
	const { planExecId } = request.params;

	try {
		const execution = getActiveExecution(planExecId);
		if (!execution) {
			return reply.code(404).send({ error: "Execution not found" });
		}
		return execution;
	} catch (error) {
		fastify.log.error({ error }, "Failed to get execution");
		return reply.code(500).send({ error: "Failed to get execution", message: String(error) });
	}
});

/**
 * GET /api/executions/:planExecId/log - Get execution log file
 */
fastify.get<{
	Params: { planExecId: string };
}>("/api/executions/:planExecId/log", async (request, reply) => {
	const { planExecId } = request.params;

	try {
		const stateStore = getStateStore();
		const content = await stateStore.loadExecutionLog(planExecId);

		if (content === null) {
			// Fallback to temp file for backward compatibility
			const workspaceRoot = getWorkspaceRoot();
			const logFile = join(workspaceRoot, ".pi", `execution-${planExecId}.log`);

			if (!existsSync(logFile)) {
				return { content: "", exists: false };
			}

			const fileContent = await readFile(logFile, "utf-8");
			return { content: fileContent, exists: true };
		}

		return { content, exists: true };
	} catch (error) {
		fastify.log.error({ error }, "Failed to get execution log");
		return reply.code(500).send({ error: "Failed to get execution log", message: String(error) });
	}
});

/**
 * GET /api/logs/:planExecId/:workspaceId/recent - Get recent workspace logs
 */
fastify.get<{
	Params: { planExecId: string; workspaceId: string };
}>("/api/logs/:planExecId/:workspaceId/recent", async (request, reply) => {
	const { planExecId, workspaceId } = request.params;

	try {
		const stateStore = getStateStore();

		// Try to get recent logs from state store
		if (typeof (stateStore as any).getRecentWorkspaceLogs === "function") {
			const logs = await (stateStore as any).getRecentWorkspaceLogs(planExecId, workspaceId, 100);
			return { logs, count: logs.length };
		}

		// Fallback: return empty if method not available
		return { logs: [], count: 0 };
	} catch (error) {
		fastify.log.error({ error }, "Failed to get workspace logs");
		return reply.code(500).send({ error: "Failed to get workspace logs", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Settings Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/settings - Get merged settings (global + project scope)
 *
 * Returns the full merged settings object the dashboard needs to
 * render the settings form.
 */
fastify.get("/api/settings", async (_request, reply) => {
	try {
		const sm = getSettingsManager();
		return sm.getMergedSettings();
	} catch (error) {
		fastify.log.error({ error }, "Failed to get settings");
		return reply.code(500).send({ error: "Failed to get settings", message: String(error) });
	}
});

/**
 * PUT /api/settings - Update global settings
 *
 * Accepts a partial Settings object and applies it via
 * updateGlobalSettings (deep merge for nested objects).
 */
fastify.put<{
	Body: Record<string, unknown>;
}>("/api/settings", async (request, reply) => {
	try {
		const sm = getSettingsManager();
		sm.updateGlobalSettings(request.body as any);
		return { success: true };
	} catch (error) {
		fastify.log.error({ error }, "Failed to update settings");
		return reply.code(500).send({ error: "Failed to update settings", message: String(error) });
	}
});

/**
 * GET /api/settings/global - Get global-only settings
 */
fastify.get("/api/settings/global", async (_request, reply) => {
	try {
		const sm = getSettingsManager();
		return sm.getGlobalSettings();
	} catch (error) {
		fastify.log.error({ error }, "Failed to get global settings");
		return reply.code(500).send({ error: "Failed to get global settings", message: String(error) });
	}
});

/**
 * GET /api/settings/project - Get project-only settings (stored in .pi/settings.json)
 */
fastify.get("/api/settings/project", async (_request, reply) => {
	try {
		const sm = getSettingsManager();
		return sm.getProjectSettings();
	} catch (error) {
		fastify.log.error({ error }, "Failed to get project settings");
		return reply.code(500).send({ error: "Failed to get project settings", message: String(error) });
	}
});

/**
 * PUT /api/settings/project - Update project-scope settings
 */
fastify.put<{
	Body: Record<string, unknown>;
}>("/api/settings/project", async (request, reply) => {
	try {
		const sm = getSettingsManager();
		sm.updateProjectSettings(request.body as any);
		return { success: true };
	} catch (error) {
		fastify.log.error({ error }, "Failed to update project settings");
		return reply.code(500).send({ error: "Failed to update project settings", message: String(error) });
	}
});

/**
 * GET /api/settings/context-budgets - Get context budget settings only
 */
fastify.get("/api/settings/context-budgets", async (_request, reply) => {
	try {
		const sm = getSettingsManager();
		return sm.getContextBudgets();
	} catch (error) {
		fastify.log.error({ error }, "Failed to get context budgets");
		return reply.code(500).send({ error: "Failed to get context budgets", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// AI Models Endpoint (from @earendil-works/pi-ai)
// ---------------------------------------------------------------------------

/**
 * GET /api/ai-models - List all providers and their available models
 *
 * Returns providers with their display-ready model arrays for
 * provider/model selectors in the settings UI.
 */
fastify.get("/api/ai-models", async (_request, reply) => {
	try {
		const providers = getProviders();
		const result: Array<{ provider: string; models: Array<{ id: string; name: string }> }> = [];

		for (const provider of providers) {
			const models = getModels(provider as any);
			result.push({
				provider,
				models: models.map((m) => ({
					id: m.id,
					name: m.name ?? m.id,
				})),
			});
		}

		return { providers: result };
	} catch (error) {
		fastify.log.error({ error }, "Failed to list AI models");
		return reply.code(500).send({ error: "Failed to list AI models", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Git Info Endpoint
// ---------------------------------------------------------------------------

/**
 * GET /api/git-info - Get git information for the project root
 */
fastify.get("/api/git-info", async (_request, reply) => {
	try {
		const workspaceRoot = getWorkspaceRoot();
		const info = getGitInfo(workspaceRoot);
		const logOutput = execSync("git log --oneline -10", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return { ...info, log: logOutput };
	} catch (error) {
		fastify.log.error({ error }, "Failed to get git info");
		return reply.code(500).send({ error: "Failed to get git info", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Project Update Endpoint
// ---------------------------------------------------------------------------

/**
 * PATCH /api/projects/:projectId - Update project properties
 */
fastify.patch<{
	Params: { projectId: string };
	Body: { name?: string; rootPath?: string };
}>("/api/projects/:projectId", async (request, reply) => {
	const { projectId } = request.params;
	const { name, rootPath } = request.body;

	try {
		await getStateStore().updateProject(projectId, { name, rootPath });
		return { success: true };
	} catch (error) {
		fastify.log.error({ error }, "Failed to update project");
		return reply.code(500).send({ error: "Failed to update project", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Plan Execution Control Endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/executions/:planExecId/control - Send control command to a specific execution
 */
fastify.post<{
	Params: { planExecId: string };
	Body: { action: "pause" | "stop" | "cancel" | "resume" };
}>("/api/executions/:planExecId/control", async (request, reply) => {
	const { planExecId } = request.params;
	const { action } = request.body;

	// Validate action
	if (!["pause", "stop", "cancel", "resume"].includes(action)) {
		return reply.code(400).send({ success: false, error: "Invalid action" });
	}

	try {
		const stateStore = getStateStore();
		const state = await stateStore.loadState(planExecId);

		if (!state) {
			return reply.code(404).send({ success: false, error: "Plan execution not found" });
		}

		// Execute the control action
		switch (action) {
			case "pause":
				await stateStore.pausePlan(planExecId);
				break;
			case "stop":
				await stateStore.stopPlan(planExecId, "Stopped by user");
				break;
			case "cancel":
				await stateStore.cancelPlan(planExecId);
				break;
			case "resume":
				await stateStore.resumePlan(planExecId);
				break;
		}

		return { success: true };
	} catch (error) {
		fastify.log.error({ error, planExecId, action }, "Failed to execute control command");
		return reply.code(500).send({ success: false, error: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Chat / Ad-hoc Workspace Endpoint
// ---------------------------------------------------------------------------

/**
 * POST /api/chat - Send a chat message to the LLM and stream the response
 *
 * Accepts a message and uses the project's default provider/model to
 * generate a streaming response. The response may include structured
 * commands to create and execute workspaces.
 *
 * Body: { projectId, message, history? }
 * Response: SSE stream of text/tool_call events
 */
fastify.post<{
	Body: {
		projectId: string;
		message: string;
		history?: Array<{ role: "user" | "assistant"; content: string }>;
	};
}>("/api/chat", async (request, reply) => {
	const { projectId, message, history = [] } = request.body;

	if (!projectId || !message) {
		return reply.code(400).send({ error: "projectId and message are required" });
	}

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});

	try {
		// Get project info for context
		const stateStore = getStateStore();
		const projects = await stateStore.listProjects();
		const project = projects.find((p) => p.id === projectId);
		if (!project) {
			reply.raw.write(`data: ${JSON.stringify({ type: "error", message: "Project not found" })}\n\n`);
			reply.raw.end();
			return;
		}

		// Get the default provider and model from settings
		const settingsManager = getSettingsManager();
		const settings = settingsManager.getMergedSettings();
		const defaultProvider = (settings as any).defaultProvider ?? "opencode-go";
		const defaultModel = (settings as any).defaultModel ?? "deepseek-v4-flash";

		// Build context with project info
		// Get recent git info for context
		let gitContext = "";
		try {
			const workspaceRoot = getWorkspaceRoot();
			const branch = execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: workspaceRoot,
				encoding: "utf-8",
				timeout: 2000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			const status = execSync("git status --short", {
				cwd: workspaceRoot,
				encoding: "utf-8",
				timeout: 2000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			gitContext = `Current branch: ${branch}\nGit status:\n${status || "(clean)"}`;
		} catch {
			gitContext = "Git not available";
		}

		// Get recent execution context
		const recentExecutions = await stateStore.listPlanExecutions(projectId);
		const lastExec = recentExecutions[recentExecutions.length - 1];
		let execContext = "";
		if (lastExec) {
			execContext = `Last execution: ${lastExec.title} (${lastExec.status}) at ${lastExec.startedAt}`;
		}

		const systemPrompt = `You are Pi, an AI coding assistant integrated into a plan execution dashboard.
You help users understand and fix issues with their plan executions.

Current project: ${project.name}
Project root: ${project.rootPath || "unknown"}
${gitContext}
${execContext}

You can:
1. Answer questions about the project, git state, and execution results
2. Suggest fixes for failed workspaces
3. If the user asks you to make changes, describe what workspaces would be needed

Keep responses concise and technical.`;

		// Build message array
		// Stream the AI response
		const { stream } = await import("@earendil-works/pi-ai");

		const model = {
			api: defaultProvider as any,
			id: defaultModel,
			name: defaultModel,
			provider: defaultProvider,
			contextWindow: 128000,
		} as const;

		// Build chat-style context with history
		const chatMessages = [
			...history.map((h) => ({ role: h.role as any, content: h.content })),
			{ role: "user" as const, content: message },
		];

		const context = {
			systemPrompt,
			messages: chatMessages,
		};

		let _responseText = "";

		try {
			const eventStream = stream(model as any, context as any);

			for await (const event of eventStream) {
				if (request.raw.destroyed) break;

				if (event.type === "text_delta") {
					_responseText += event.delta;
					reply.raw.write(`data: ${JSON.stringify({ type: "text", text: event.delta })}\n\n`);
				} else if (event.type === "toolcall_end") {
					reply.raw.write(`data: ${JSON.stringify({ type: "tool_call", tool: event.toolCall })}\n\n`);
				} else if (event.type === "error") {
					const errMsg = (event as any).error?.message || (event as any).error || "Unknown error";
					reply.raw.write(`data: ${JSON.stringify({ type: "error", message: String(errMsg) })}\n\n`);
				}
			}
		} catch (streamError) {
			fastify.log.error({ streamError }, "Chat stream error");
			reply.raw.write(
				`data: ${JSON.stringify({ type: "error", message: `Stream error: ${String(streamError)}` })}\n\n`,
			);
		}

		// Signal completion
		reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
		reply.raw.end();
	} catch (error) {
		fastify.log.error({ error }, "Chat error");
		reply.raw.write(`data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`);
		reply.raw.end();
	}
});

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/**
 * GET /api/health - Health check
 */
fastify.get("/api/health", async (_request, _reply) => {
	const backendType = getStateStore().getBackendType();

	return {
		status: "ok",
		backend: backendType,
		version: process.env.npm_package_version || "0.0.0",
		uptime: process.uptime(),
	};
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const start = async () => {
	try {
		const port = Number(process.env.PORT) || 3000;

		// Check database connection if using PostgreSQL backend
		const backend = detectStateStoreBackend();
		if (backend === "postgres") {
			console.log("[server] Verifying PostgreSQL connection...");
			const { healthCheck, getKysely, runMigrations } = await import("@earendil-works/pi-db");
			const healthy = await healthCheck();
			if (!healthy) {
				console.error("[server] Failed to connect to PostgreSQL. Check your database configuration.");
				console.error("[server] Required env vars: PGHOST, PGDATABASE, PGUSER, PGPASSWORD");
				process.exit(1);
			}
			console.log("[server] PostgreSQL connection verified");

			// Run migrations
			console.log("[server] Running database migrations...");
			const db = getKysely();
			await runMigrations(db);
			console.log("[server] Database migrations complete");
		}

		// Resume stranded executions from a previous server crash
		const workspaceRoot = getWorkspaceRoot();
		const projectName = process.env.PI_PROJECT_NAME || "hello";
		const recovered = await resumeStrandedExecutions(workspaceRoot, projectName, projectName);
		if (recovered > 0) {
			console.log(`[server] Recovered ${recovered} stranded plan execution(s)`);
		}

		await fastify.listen({ port, host: "127.0.0.1" });
		console.log(`Dashboard server running at http://127.0.0.1:${port}`);
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
};

start();
