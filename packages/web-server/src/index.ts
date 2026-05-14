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
 *   GET    /api/logs/v2/:planExecId/:workspaceId/:stream  Logs v2: raw/structured/narrative/audit/decision SSE
 *
 *   GET    /api/transcript/:planExecId/:workspaceId     SSE: worker transcript events
 *
 *   GET    /api/projects                      List projects
 *   POST   /api/projects                      Create project
 *   GET    /api/projects/:projectId/plans     List plan executions for project
 *   GET    /api/projects/:projectId/plans/:planExecId  Get plan execution detail
 *   GET    /api/projects/:projectId/plans/:planExecId/events  SSE: plan events
 *
 *   POST   /api/projects/:projectId/plans/validate  Validate plan content (returns dependency graph, batches, warnings, suggested fixes)
 *   PATCH  /api/projects/:projectId/plans/preview   Apply dependency patches without starting execution
 *   POST   /api/projects/:projectId/plans/run       Upload and run a plan (refuses unapproved interactive plans)
 *   GET    /api/projects/:projectId/active          Get active execution info
 *
 *   GET    /api/projects/:projectId/queue           Get plan queue for project
 *   POST   /api/projects/:projectId/queue/enqueue  Add plan(s) to queue
 *   POST   /api/projects/:projectId/queue/reorder   Reorder queued plans
 *   POST   /api/projects/:projectId/queue/:entryId/skip    Skip a queued plan
 *   DELETE /api/projects/:projectId/queue/:entryId  Remove a queued plan
 *   POST   /api/projects/:projectId/queue/:entryId/move-to-top  Move entry to top
 *   POST   /api/projects/:projectId/queue/run-next   Run next queued plan
 *   POST   /api/projects/:projectId/queue/pause      Pause queue processing
 *   POST   /api/projects/:projectId/queue/resume     Resume queue processing
 *   POST   /api/projects/:projectId/queue/stop-after-current  Stop after current plan
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { registerArtifactRoutes } from "./artifact-routes.js";
import { registerLogStreamRoutes } from "./log-stream-routes.js";
import { registerPerformanceRoutes } from "./performance-routes.js";
import {
	applyDependencyPatches,
	computeBatchPlan,
	type DependencyPatch,
	generateSuggestedFixes,
	requiresInteractiveApproval,
} from "./plan-preview.js";
import {
	getActiveExecution,
	getActiveExecutions,
	resumeStrandedExecutions,
	runPlan,
	signalExecutionEvent,
} from "./plan-runner.js";
import { registerScaleRoutes } from "./scale-routes.js";
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

interface GitFileChange {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged";
	additions: number;
	deletions: number;
}

interface GitFilePatch {
	path: string;
	status: GitFileChange["status"];
	patch: string;
	truncated: boolean;
	truncatedLines: number;
}

const MAX_DIFF_LINES_PER_FILE = 500;

/**
 * Get git diff patches for a workspace, returning unified diff content per file.
 * Caps at MAX_DIFF_LINES_PER_FILE lines per file.
 */
function getGitDiffPatches(workspaceRoot: string): { patches: GitFilePatch[]; error?: string } {
	try {
		// Check if git is available and the directory is a git repo
		execSync("git rev-parse --git-dir", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		});

		// Get name-status first so we know file statuses
		const nameStatus = execSync("git diff --name-status HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const stagedNameStatus = execSync("git diff --cached --name-status HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const statusMap = new Map<string, string>();
		for (const line of [...nameStatus.split("\n"), ...stagedNameStatus.split("\n")]) {
			if (!line.trim()) continue;
			const match = line.match(/^(\S+)\t(.+)$/);
			if (match) {
				const [, statusChar, filePath] = match;
				if (!statusMap.has(filePath)) {
					statusMap.set(filePath, statusChar);
				}
			}
		}

		// Get unified diff (unstaged + staged combined)
		const diffOutput = execSync("git diff HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		if (!diffOutput) {
			return { patches: [] };
		}

		const statusCharToLabel: Record<string, GitFileChange["status"]> = {
			A: "added",
			M: "modified",
			D: "deleted",
			R: "renamed",
			C: "copied",
			U: "unmerged",
		};

		// Parse unified diff into per-file patches
		const patches: GitFilePatch[] = [];
		const fileSections = diffOutput.split(/\ndiff --git /);

		for (let i = 0; i < fileSections.length; i++) {
			let section = fileSections[i];
			if (i > 0) {
				section = `diff --git ${section}`;
			}
			if (!section.trim()) continue;

			// Extract file path from "diff --git a/path b/path"
			const pathMatch = section.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
			if (!pathMatch) continue;
			const filePath = pathMatch[2];

			const statusChar = statusMap.get(filePath) || "M";
			const status = statusCharToLabel[statusChar] || "modified";

			// Count lines and cap
			const lines = section.split("\n");
			let truncated = false;
			let truncatedLines = 0;
			let patchContent: string;

			if (lines.length > MAX_DIFF_LINES_PER_FILE) {
				patchContent = lines.slice(0, MAX_DIFF_LINES_PER_FILE).join("\n");
				truncated = true;
				truncatedLines = lines.length - MAX_DIFF_LINES_PER_FILE;
			} else {
				patchContent = section;
			}

			patches.push({ path: filePath, status, patch: patchContent, truncated, truncatedLines });
		}

		// Sort by path
		patches.sort((a, b) => a.path.localeCompare(b.path));

		return { patches };
	} catch (error) {
		return { patches: [], error: String(error) };
	}
}

/**
 * Get git diff for a workspace, returning a list of changed files.
 * Runs git diff --numstat against HEAD to get additions/deletions per file.
 */
function getGitDiff(workspaceRoot: string): { filesChanged: GitFileChange[]; error?: string } {
	try {
		// Check if git is available and the directory is a git repo
		execSync("git rev-parse --git-dir", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		});

		// Get numstat output: additions, deletions, path (tab-separated)
		const numstat = execSync("git diff --numstat HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		// Also get diff --name-status to determine file status (M/A/D/R/C/U)
		const nameStatus = execSync("git diff --name-status HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		// Include staged changes too
		const stagedNumstat = execSync("git diff --cached --numstat HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const stagedNameStatus = execSync("git diff --cached --name-status HEAD", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		// Parse name-status lines: "M\tpath/to/file"
		const statusMap = new Map<string, string>();
		for (const line of [...nameStatus.split("\n"), ...stagedNameStatus.split("\n")]) {
			if (!line.trim()) continue;
			const match = line.match(/^(\S+)\t(.+)$/);
			if (match) {
				const [, statusChar, filePath] = match;
				// Prefer the first status we see for each file
				if (!statusMap.has(filePath)) {
					statusMap.set(filePath, statusChar);
				}
			}
		}

		// Merge numstat results, handling duplicates (unstaged + staged)
		const fileMap = new Map<string, { additions: number; deletions: number }>();
		for (const numstatLines of [numstat, stagedNumstat]) {
			for (const line of numstatLines.split("\n")) {
				if (!line.trim()) continue;
				const parts = line.split("\t");
				if (parts.length < 3) continue;
				const [addStr, delStr, ...pathParts] = parts;
				const filePath = pathParts.join("\t");
				const additions = Number(addStr) || 0;
				const deletions = Number(delStr) || 0;
				const existing = fileMap.get(filePath);
				if (existing) {
					existing.additions += additions;
					existing.deletions += deletions;
				} else {
					fileMap.set(filePath, { additions, deletions });
				}
			}
		}

		const statusCharToLabel: Record<string, GitFileChange["status"]> = {
			A: "added",
			M: "modified",
			D: "deleted",
			R: "renamed",
			C: "copied",
			U: "unmerged",
		};

		const filesChanged: GitFileChange[] = [];
		for (const [filePath, { additions, deletions }] of fileMap) {
			const statusChar = statusMap.get(filePath) || "M";
			const status = statusCharToLabel[statusChar] || "modified";
			filesChanged.push({ path: filePath, status, additions, deletions });
		}

		// Sort by path for deterministic output
		filesChanged.sort((a, b) => a.path.localeCompare(b.path));

		return { filesChanged };
	} catch (error) {
		return { filesChanged: [], error: String(error) };
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

// Serve static dashboard files (built from packages/web-ui/dashboard)
const dashboardDist = resolve(process.cwd(), "../web-ui/dashboard/dist");
if (existsSync(dashboardDist)) {
	await fastify.register(fastifyStatic, {
		root: dashboardDist,
		prefix: "/",
	});
} else {
	fastify.log.warn(`Dashboard dist not found at ${dashboardDist}, API-only mode`);
}

// ---------------------------------------------------------------------------
// State store initialization (delegated to state-store-provider.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// State store initialization (delegated to state-store-provider.ts)
// ---------------------------------------------------------------------------

/**
 * Sanitize a journal event before sending over SSE.
 *
 * Removes large payloads (file contents, full tool input/output) to keep
 * the SSE stream lightweight. Only tool_name and a truncated preview
 * are preserved for tool_call events.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeSseEvent(event: any): any {
	const type = String(event.type ?? event.event_type ?? "");

	// Only tool_call events have massive payloads
	if (type === "tool_call") {
		const data = event.data as Record<string, unknown> | undefined;
		if (data && typeof data === "object") {
			const sanitized: Record<string, any> = {};
			// Keep toolName
			if (data.toolName) sanitized.toolName = data.toolName;
			// Truncate input to 200 chars
			if (typeof data.input === "string") {
				sanitized.input = data.input.length > 200 ? `${data.input.slice(0, 200)}...` : data.input;
			} else if (data.input !== undefined) {
				const json = JSON.stringify(data.input);
				sanitized.input = json.length > 200 ? `${json.slice(0, 200)}...` : json;
			}
			// Drop result entirely (can be huge file contents)
			return { ...event, data: sanitized };
		}
	}

	return event;
}

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
			const planExecutionId = jsonStore.getCurrentPlanExecutionId();

			if (planState && (planState.status === "stopped" || planState.status === "paused")) {
				// No active loop, execute cancel immediately
				const execId = planExecutionId ?? "current-exec-id";
				await stateStore.cancelPlan(execId);
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

	// Send existing journal events (lightweight — truncate large tool_call payloads)
	try {
		const stateStore = getStateStore();
		const journal = await stateStore.readJournal(planExecId);
		const recentEvents = journal.slice(-100);
		for (const event of recentEvents) {
			reply.raw.write(`data: ${JSON.stringify(sanitizeSseEvent(event))}\n\n`);
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
					reply.raw.write(`data: ${JSON.stringify(sanitizeSseEvent(event))}\n\n`);
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
 * GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/attempts - Get workspace attempt history
 */
fastify.get<{
	Params: { projectId: string; planExecId: string; workspaceId: string };
}>("/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/attempts", async (request, reply) => {
	const { planExecId, workspaceId } = request.params;

	try {
		const stateStore = getStateStore();
		const attempts = await stateStore.getWorkspaceAttempts(planExecId, workspaceId);

		return { attempts };
	} catch (error) {
		fastify.log.error({ error }, "Failed to get workspace attempts");
		return reply.code(500).send({ error: "Failed to get workspace attempts", message: String(error) });
	}
});

/**
 * GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/git-diff - Get git diff for workspace
 *
 * When ?format=patch, returns per-file unified diff content (capped at 500 lines/file).
 * Otherwise returns files changed (unstaged + staged) with per-file stats.
 * Gracefully handles git not being initialized.
 */
fastify.get<{
	Params: { projectId: string; planExecId: string; workspaceId: string };
	Querystring: { format?: string };
}>("/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/git-diff", async (request, reply) => {
	const { planExecId, workspaceId } = request.params;
	const { format } = request.query;

	try {
		const stateStore = getStateStore();
		const ws = await stateStore.getWorkspaceState(planExecId, workspaceId);

		if (!ws) {
			return reply.code(404).send({ error: "Workspace not found" });
		}

		const workspaceRoot = getWorkspaceRoot();

		if (format === "patch") {
			const patchResult = getGitDiffPatches(workspaceRoot);

			if (patchResult.error && !patchResult.patches.length) {
				return { patches: [], error: "Git not initialized or not available" };
			}

			return { patches: patchResult.patches };
		}

		const diff = getGitDiff(workspaceRoot);

		if (diff.error && !diff.filesChanged.length) {
			// Graceful: git not initialized or other issue
			return { filesChanged: [], error: "Git not initialized or not available" };
		}

		return { filesChanged: diff.filesChanged };
	} catch (error) {
		fastify.log.error({ error }, "Failed to get git diff for workspace");
		return reply.code(500).send({ error: "Failed to get git diff", message: String(error) });
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

	// Track which source fed the last fetch to prevent cursor corruption
	// across fallback tiers (fix #4: lastSentCount corruption).
	let lastSource: "buffer" | "file" = "buffer";

	// Ping/pong keepalive to prevent proxies from killing idle connections
	// during long workspaces with infrequent log output (fix #3).
	const pingInterval = setInterval(() => {
		if (socket.readyState === socket.OPEN) {
			socket.ping();
		}
	}, 20_000);

	// Poll for new logs. Uses .then()/.catch() instead of an async callback
	// so that any thrown error in the interval body becomes a handled rejection
	// rather than killing the connection (fix #2).
	const pollInterval = setInterval(() => {
		// Skip if socket is closing/closed — interval will be cleared on close
		if (socket.readyState !== socket.OPEN) return;

		const fetchAndSend = async () => {
			const stateStore = getStateStore();
			let logs: string[] = [];
			let source: "buffer" | "file" = "file";

			// 1. Try in-memory buffer (fast, real-time)
			if ("getRecentWorkspaceLogs" in stateStore) {
				const fn = (stateStore as any).getRecentWorkspaceLogs;
				if (typeof fn === "function") {
					const bufferLogs = fn.call(stateStore, planExecId, workspaceId, 5000) as string[];
					if (bufferLogs.length > 0) {
						logs = bufferLogs;
						source = "buffer";
					}
				}
			}

			// 2. Fall back to persisted storage only when the buffer is empty.
			//    Once we've switched to file-based tracking, keep using file so
			//    the cursor doesn't reset (fix #4).
			if (logs.length === 0 && "loadWorkspaceLog" in stateStore) {
				const fn = (stateStore as any).loadWorkspaceLog;
				if (typeof fn === "function") {
					const logContent = (await fn.call(stateStore, planExecId, workspaceId)) as string | null;
					if (logContent) {
						logs = logContent.split("\n").filter(Boolean);
					}
				}
			}

			// 3. Fallback: read from workspace execution log file on disk
			if (logs.length === 0) {
				for (let a = 1; a <= 10; a++) {
					try {
						const wsLogFile = join(getPiDir(), "workspaces", workspaceId, `execution-${a}.log`);
						if (existsSync(wsLogFile)) {
							const content = await readFile(wsLogFile, "utf-8");
							const lines = content.split("\n").filter(Boolean);
							if (lines.length > 0) {
								logs = lines;
								break;
							}
						}
					} catch {
						// Ignore fallback errors
					}
				}
			}

			// If we switched sources, reset the cursor — the new source starts fresh
			if (source !== lastSource) {
				lastSentCount = 0;
				lastSource = source;
			}

			if (logs.length > lastSentCount) {
				const newLogs = logs.slice(lastSentCount);
				for (const line of newLogs) {
					if (socket.readyState === socket.OPEN) {
						socket.send(JSON.stringify({ type: "log", data: line }));
					}
				}
				lastSentCount = logs.length;
			}
		};

		fetchAndSend().catch((err: unknown) => {
			fastify.log.error({ err }, "Log poll error");
			// Don't close the socket — let the next poll retry
		});
	}, 1000);

	const cleanup = () => {
		clearInterval(pollInterval);
		clearInterval(pingInterval);
	};

	socket.on("close", () => {
		cleanup();
		fastify.log.info({ planExecId, workspaceId }, "WebSocket log stream disconnected");
	});

	socket.on("error", (_error: Error) => {
		cleanup();
		// socket.close() is not called here — the error event is terminal and
		// close will fire shortly after. Calling close(1011) can race with the
		// underlying transport teardown and cause cascading failures (#1).
	});
});

// ---------------------------------------------------------------------------
// Logs v2: Narrative, Audit, Decision Streams
// ---------------------------------------------------------------------------

/** Valid v2 log stream names */
const V2_LOG_STREAMS = ["raw", "structured", "narrative", "audit", "decision"] as const;
type V2LogStream = (typeof V2_LOG_STREAMS)[number];

/** Map v2 stream names to archive file names */
const V2_STREAM_FILE_MAP: Record<V2LogStream, string> = {
	raw: "raw.log",
	structured: "structured.ndjson",
	narrative: "narrative.ndjson",
	audit: "audit.ndjson",
	decision: "decisions.ndjson",
};

/** Map legacy stream names for backward compatibility in v2 endpoint */
const V2_LEGACY_STREAM_MAP: Record<string, string> = {
	stdout: "raw.log",
	stderr: "raw.log",
	error: "raw.log",
	test: "raw.log",
};

/**
 * Read a v2 log stream file from the execution archive.
 *
 * Reads from .pi/executions/{planExecId}/workspaces/{workspaceId}/{filename}
 * and returns lines suitable for SSE streaming.
 */
function readV2LogStream(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	stream: V2LogStream,
): string[] {
	const fileName = V2_STREAM_FILE_MAP[stream];
	const filePath = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, fileName);

	if (!existsSync(filePath)) {
		return [];
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		if (stream === "raw") {
			return content.split("\n").filter(Boolean);
		}
		// For ndjson streams, return pretty-printed JSON lines
		return content
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.stringify(JSON.parse(line), null, 2);
				} catch {
					return line;
				}
			});
	} catch {
		return [];
	}
}

/** Also try the legacy workspace log as fallback for "raw" stream */
function readV2RawFromLegacy(workspaceRoot: string, _planExecId: string, workspaceId: string): string[] {
	// Try state store first
	const stateStore = getStateStore();
	if (typeof (stateStore as any).loadWorkspaceLog === "function") {
		try {
			// Synchronous attempts only — the state store may be async
		} catch {
			// Ignore
		}
	}

	// Try legacy workspace execution log files
	for (let a = 1; a <= 10; a++) {
		const wsLogFile = join(workspaceRoot, ".pi", "workspaces", workspaceId, `execution-${a}.log`);
		if (existsSync(wsLogFile)) {
			try {
				const content = readFileSync(wsLogFile, "utf-8");
				const lines = content.split("\n").filter(Boolean);
				if (lines.length > 0) {
					return lines;
				}
			} catch {
				// Ignore
			}
		}
	}

	return [];
}

/** readFileSync wrapper for use in sync contexts */
import { readFileSync, watch as watchSync } from "node:fs";

/**
 * GET /api/logs/v2/:planExecId/:workspaceId/:stream - SSE stream of v2 log streams
 *
 * Supported streams: raw, structured, narrative, audit, decision
 * Also accepts legacy stream names (stdout, stderr, error, test) which map to raw.
 */
fastify.get<{
	Params: { planExecId: string; workspaceId: string; stream: string };
}>("/api/logs/v2/:planExecId/:workspaceId/:stream", async (request, reply) => {
	const { planExecId, workspaceId, stream } = request.params;

	// Resolve stream name
	let resolvedStream: V2LogStream;
	if (V2_LOG_STREAMS.includes(stream as V2LogStream)) {
		resolvedStream = stream as V2LogStream;
	} else if (stream in V2_LEGACY_STREAM_MAP) {
		resolvedStream = "raw";
	} else {
		reply.code(400).send({ error: `Unknown log stream: ${stream}` });
		return;
	}

	const workspaceRoot = getWorkspaceRoot();

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	// Read the v2 log stream file
	let lines = readV2LogStream(workspaceRoot, planExecId, workspaceId, resolvedStream);

	// Fallback for raw stream: try legacy log files
	if (lines.length === 0 && resolvedStream === "raw") {
		lines = readV2RawFromLegacy(workspaceRoot, planExecId, workspaceId);
	}

	// Also try the in-memory state store log buffer
	if (lines.length === 0 && resolvedStream === "raw") {
		const stateStore = getStateStore();
		if ("getRecentWorkspaceLogs" in stateStore) {
			const fn = (stateStore as any).getRecentWorkspaceLogs;
			if (typeof fn === "function") {
				try {
					const bufferLogs = fn.call(stateStore, planExecId, workspaceId, 5000) as string[];
					if (bufferLogs.length > 0) {
						lines = bufferLogs;
					}
				} catch {
					// Ignore
				}
			}
		}
	}

	// Send existing lines
	for (const line of lines) {
		reply.raw.write(`data: ${line}\n\n`);
	}

	if (lines.length === 0) {
		reply.raw.write(`data: __NO_LOGS__\n\n`);
		reply.raw.end();
		return;
	}

	// Watch for new lines on the v2 log file (live updates)
	const fileName = V2_STREAM_FILE_MAP[resolvedStream];
	const filePath = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, fileName);

	if (!existsSync(filePath)) {
		// No file to watch — end the stream after sending buffered lines
		reply.raw.end();
		return;
	}

	let lastLineCount = lines.length;
	const abortController = new AbortController();
	request.raw.on("close", () => abortController.abort());

	try {
		const watcher = watch(filePath, { signal: abortController.signal });
		for await (const event of watcher) {
			if (event.eventType === "change") {
				try {
					const content = readFileSync(filePath, "utf-8");
					const allLines = content.split("\n").filter(Boolean);
					if (resolvedStream !== "raw") {
						// For ndjson streams, pretty-print and send only new entries
						for (let i = lastLineCount; i < allLines.length; i++) {
							try {
								reply.raw.write(`data: ${JSON.stringify(JSON.parse(allLines[i]), null, 2)}\n\n`);
							} catch {
								reply.raw.write(`data: ${allLines[i]}\n\n`);
							}
						}
					} else {
						// For raw log, send last line (simple append)
						const newLine = allLines[allLines.length - 1];
						if (newLine) {
							reply.raw.write(`data: ${newLine}\n\n`);
						}
					}
					lastLineCount = allLines.length;
				} catch {
					// Ignore read errors
				}
			}
		}
	} catch {
		// Watcher aborted or file doesn't exist
	}
});

// ---------------------------------------------------------------------------
// Plan Management Endpoints (upload, validate, run)
// ---------------------------------------------------------------------------

/**
 * POST /api/projects/:projectId/plans/validate - Validate plan content
 *
 * Parses and validates plan content without executing it.
 * Returns dependency graph, batches, warnings, safety report, and suggested fixes.
 * Accepts plan content as a JSON body or multipart file upload.
 * Backward compatible: still returns parseResult, safety, and warnings.
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

		// Compute batch plan (dependency graph, batches, parallelism)
		const batchPlan = computeBatchPlan(queue);

		// Generate suggested fixes
		const suggestedFixes = generateSuggestedFixes(queue, batchPlan);

		return {
			success: true,
			parseResult: {
				title: queue.title,
				phase: queue.phase,
				workspaceCount: queue.workspaces.length,
				maxParallel: queue.maxParallelWorkspaces,
			},
			safety: safetyReport,
			batchPlan: {
				dependencyGraph: batchPlan.dependencyGraph,
				batches: batchPlan.batches,
				totalBatches: batchPlan.totalBatches,
				effectiveParallelism: batchPlan.effectiveParallelism,
				requestedParallelism: batchPlan.requestedParallelism,
				parallelismDelta: batchPlan.parallelismDelta,
				isOverSerialized: batchPlan.isOverSerialized,
				warnings: batchPlan.warnings,
				errors: batchPlan.errors,
			},
			suggestedFixes,
			warnings: parseResult.warnings,
			requiresApproval: requiresInteractiveApproval(queue),
		};
	} catch (error) {
		fastify.log.error({ error }, "Failed to validate plan");
		return reply.code(500).send({ error: "Failed to validate plan", message: String(error) });
	}
});

/**
 * PATCH /api/projects/:projectId/plans/preview - Apply dependency patches without execution
 *
 * Accepts plan content and an array of dependency patches, applies them
 * to a copy of the workspace queue, and returns the preview without
 * starting execution. Useful for "what-if" analysis.
 */
fastify.patch<{
	Params: { projectId: string };
	Body: { planContent: string; patches: DependencyPatch[] };
}>("/api/projects/:projectId/plans/preview", async (request, reply) => {
	const { planContent, patches } = request.body;

	if (!planContent) {
		return reply.code(400).send({ error: "Plan content is required" });
	}

	if (!Array.isArray(patches)) {
		return reply.code(400).send({ error: "patches must be an array" });
	}

	try {
		const parseResult = parsePlan(planContent);

		if (!parseResult.success || !parseResult.queue) {
			return reply.code(400).send({
				success: false,
				errors: parseResult.errors.length > 0 ? parseResult.errors : ["Failed to parse plan"],
				warnings: parseResult.warnings,
			});
		}

		const queue = parseResult.queue;
		const previewResult = applyDependencyPatches(queue, patches);

		if (!previewResult.success) {
			return reply.code(422).send({
				success: false,
				errors: previewResult.errors,
				warnings: previewResult.warnings,
				appliedPatches: previewResult.appliedPatches,
				rejectedPatches: previewResult.rejectedPatches,
			});
		}

		return {
			success: true,
			previewQueue: {
				phase: previewResult.previewQueue!.phase,
				title: previewResult.previewQueue!.title,
				maxParallelWorkspaces: previewResult.previewQueue!.maxParallelWorkspaces,
				workspaces: previewResult.previewQueue!.workspaces.map((ws) => ({
					id: ws.id,
					title: ws.title,
					dependencies: ws.dependencies,
				})),
			},
			batchPlan: {
				dependencyGraph: previewResult.batchPlan!.dependencyGraph,
				batches: previewResult.batchPlan!.batches,
				totalBatches: previewResult.batchPlan!.totalBatches,
				effectiveParallelism: previewResult.batchPlan!.effectiveParallelism,
				requestedParallelism: previewResult.batchPlan!.requestedParallelism,
				parallelismDelta: previewResult.batchPlan!.parallelismDelta,
				isOverSerialized: previewResult.batchPlan!.isOverSerialized,
				warnings: previewResult.batchPlan!.warnings,
				errors: previewResult.batchPlan!.errors,
			},
			warnings: previewResult.warnings,
			appliedPatches: previewResult.appliedPatches,
			rejectedPatches: previewResult.rejectedPatches,
		};
	} catch (error) {
		fastify.log.error({ error }, "Failed to preview plan patches");
		return reply.code(500).send({ error: "Failed to preview plan patches", message: String(error) });
	}
});

/**
 * POST /api/projects/:projectId/plans/run - Upload and run a plan
 *
 * Accepts plan content as a JSON body, parses it, and starts
 * background execution. Returns the execution ID.
 * Refuses unapproved interactive plans (plans with interactiveParallelismReview
 * or parallelismReview enabled).
 */
fastify.post<{
	Params: { projectId: string };
	Body: { planContent: string; planFileName?: string; approved?: boolean };
}>("/api/projects/:projectId/plans/run", async (request, reply) => {
	const { projectId } = request.params;
	const { planContent, planFileName, approved } = request.body;

	if (!planContent) {
		return reply.code(400).send({ error: "Plan content is required" });
	}

	try {
		// Check if plan requires interactive approval before proceeding
		const parseCheck = parsePlan(planContent);
		if (parseCheck.success && parseCheck.queue) {
			if (requiresInteractiveApproval(parseCheck.queue) && !approved) {
				return reply.code(403).send({
					success: false,
					error: "Plan requires interactive approval before execution. Set 'approved: true' in the request body to confirm.",
					requiresApproval: true,
					interactiveParallelismReview: parseCheck.queue.planExecution?.interactiveParallelismReview,
					parallelismReview: parseCheck.queue.parallelismReview
						? { enabled: parseCheck.queue.parallelismReview.enabled }
						: undefined,
				});
			}
		}

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

// ── Plan Queue ────────────────────────────────────────────────────────────

/**
 * In-memory plan queue state per project.
 * Each entry tracks a plan waiting to run or currently running.
 */
interface PlanQueueEntry {
	entryId: string;
	projectId: string;
	planExecId: string | null;
	title: string;
	status: "pending" | "active" | "complete" | "failed" | "skipped" | "blocked";
	queuedAt: number;
	startedAt: number | null;
	completedAt: number | null;
	error: string | null;
	blockReason: string | null;
	/** The raw plan content, stored so startNextInQueue can pass it to runPlan. */
	planContent: string;
	/** Optional plan file name for persistence. */
	planFileName?: string;
}

interface ProjectQueueState {
	entries: PlanQueueEntry[];
	isPaused: boolean;
	stopAfterCurrent: boolean;
}

const projectQueues = new Map<string, ProjectQueueState>();

function getOrCreateQueue(projectId: string): ProjectQueueState {
	if (!projectQueues.has(projectId)) {
		projectQueues.set(projectId, { entries: [], isPaused: false, stopAfterCurrent: false });
	}
	return projectQueues.get(projectId)!;
}

function queueAuditLog(projectId: string, action: string, entryId: string, details: Record<string, unknown> = {}) {
	const workspaceRoot = getWorkspaceRoot();
	const auditEntry = {
		type: "queue_action",
		action,
		entryId,
		projectId,
		timestamp: Date.now(),
		actor: "dashboard",
		...details,
	};
	const dir = join(workspaceRoot, ".pi", "queue-audit");
	const filePath = join(dir, `${projectId}-audit.ndjson`);
	fs.mkdir(dir, { recursive: true })
		.then(() => {
			fs.appendFile(filePath, JSON.stringify(auditEntry) + String.fromCharCode(10), "utf-8").catch(() => {});
		})
		.catch(() => {});
}

/**
 * GET /api/projects/:projectId/queue - Get plan queue for project
 */
fastify.get<{
	Params: { projectId: string };
}>("/api/projects/:projectId/queue", async (request, _reply) => {
	const { projectId } = request.params;
	const queue = getOrCreateQueue(projectId);
	return {
		entries: queue.entries,
		isPaused: queue.isPaused,
		stopAfterCurrent: queue.stopAfterCurrent,
	};
});

/**
 * POST /api/projects/:projectId/queue/enqueue - Add plan(s) to queue
 *
 * Accepts an array of plan contents or a single plan content.
 * Each plan is validated and added as a pending entry.
 */
fastify.post<{
	Params: { projectId: string };
	Body: { plans?: Array<{ planContent: string; planFileName?: string }>; planContent?: string; planFileName?: string };
}>("/api/projects/:projectId/queue/enqueue", async (request, reply) => {
	const { projectId } = request.params;
	const body = request.body;
	const queue = getOrCreateQueue(projectId);

	// Support single or multi-plan upload
	const plans: Array<{ planContent: string; planFileName?: string }> =
		body.plans ?? (body.planContent ? [{ planContent: body.planContent, planFileName: body.planFileName }] : []);
	if (plans.length === 0) {
		return reply.code(400).send({ error: "No plan content provided" });
	}

	const newEntries: PlanQueueEntry[] = [];
	const errors: string[] = [];
	const safetyWarnings: Array<{ planFileName?: string; warnings: string[] }> = [];

	for (const plan of plans) {
		if (!plan.planContent?.trim()) {
			errors.push("Plan content is empty");
			continue;
		}

		// Validate the plan (parse + safety doctor)
		try {
			const parseResult = parsePlan(plan.planContent);
			if (!parseResult.success) {
				errors.push(`Invalid plan: ${(parseResult.errors ?? []).join(", ")}`);
				continue;
			}

			// Run safety doctor before allowing plan into the queue
			if (parseResult.queue) {
				const doctor = createSafetyDoctor();
				const safetyReport = doctor.validateQueue(parseResult.queue);
				if (!safetyReport.safe) {
					const criticalMsgs = safetyReport.critical.map((i) => `[${i.type}] ${i.message}`);
					errors.push(`Safety check failed: ${criticalMsgs.join(", ")}`);
					continue;
				}
				// Collect non-blocking safety warnings to surface in the UI
				if (safetyReport.warnings.length > 0) {
					safetyWarnings.push({
						planFileName: plan.planFileName,
						warnings: safetyReport.warnings.map((i) => `[${i.type}] ${i.message}`),
					});
				}
			}
		} catch (e) {
			errors.push(`Parse error: ${String(e)}`);
			continue;
		}

		const entry: PlanQueueEntry = {
			entryId: `qe-${randomUUID().slice(0, 12)}`,
			projectId,
			planExecId: null,
			title: plan.planFileName ?? `Queued Plan ${queue.entries.length + 1}`,
			status: "pending",
			queuedAt: Date.now(),
			startedAt: null,
			completedAt: null,
			error: null,
			blockReason: null,
			planContent: plan.planContent,
			planFileName: plan.planFileName,
		};
		queue.entries.push(entry);
		newEntries.push(entry);
	}

	// Auto-start next if queue is not paused and no active entry
	if (!queue.isPaused && newEntries.length > 0) {
		const activeEntry = queue.entries.find((e) => e.status === "active");
		if (!activeEntry) {
			void startNextInQueue(projectId);
		}
	}

	return {
		success: true,
		added: newEntries.map((e) => e.entryId),
		errors: errors.length > 0 ? errors : undefined,
		safetyWarnings: safetyWarnings.length > 0 ? safetyWarnings : undefined,
	};
});

/**
 * POST /api/projects/:projectId/queue/reorder - Reorder queued plans
 *
 * Accepts an ordered array of entry IDs for pending entries.
 * Active entries cannot be reordered.
 */
fastify.post<{
	Params: { projectId: string };
	Body: { orderedIds: string[] };
}>("/api/projects/:projectId/queue/reorder", async (request, reply) => {
	const { projectId } = request.params;
	const { orderedIds } = request.body;
	const queue = getOrCreateQueue(projectId);

	if (!Array.isArray(orderedIds)) {
		return reply.code(400).send({ error: "orderedIds must be an array" });
	}

	// Validate: no active entry in the reorder list
	const activeEntry = queue.entries.find((e) => e.status === "active");
	if (activeEntry && orderedIds.includes(activeEntry.entryId)) {
		return reply.code(400).send({ error: "Cannot reorder the active/running plan" });
	}

	const pendingMap = new Map(queue.entries.filter((e) => e.status === "pending").map((e) => [e.entryId, e]));

	// Validate all orderedIds exist in pending
	const unknownIds = orderedIds.filter((id) => !pendingMap.has(id));
	if (unknownIds.length > 0) {
		return reply.code(400).send({ error: `Unknown entry IDs: ${unknownIds.join(", ")}` });
	}

	// Reorder: active entries first, then blocked, then ordered pending, then remaining pending, then terminal
	const orderedPending = orderedIds.map((id) => pendingMap.get(id)!);
	const remainingPending = queue.entries.filter((e) => e.status === "pending" && !orderedIds.includes(e.entryId));
	const terminalEntries = queue.entries.filter(
		(e) => e.status === "complete" || e.status === "failed" || e.status === "skipped",
	);

	queue.entries = [
		...queue.entries.filter((e) => e.status === "active"),
		...queue.entries.filter((e) => e.status === "blocked"),
		...orderedPending,
		...remainingPending,
		...terminalEntries,
	];

	// Audit log
	for (const id of orderedIds) {
		queueAuditLog(projectId, "reorder", id, { newPosition: orderedIds.indexOf(id) });
	}

	return { success: true };
});

/**
 * POST /api/projects/:projectId/queue/:entryId/skip - Skip a queued plan
 */
fastify.post<{
	Params: { projectId: string; entryId: string };
}>("/api/projects/:projectId/queue/:entryId/skip", async (request, reply) => {
	const { projectId, entryId } = request.params;
	const queue = getOrCreateQueue(projectId);
	const entry = queue.entries.find((e) => e.entryId === entryId);

	if (!entry) {
		return reply.code(404).send({ error: "Entry not found" });
	}
	if (entry.status === "active") {
		return reply.code(400).send({ error: "Cannot skip the active/running plan" });
	}
	if (entry.status === "complete" || entry.status === "failed" || entry.status === "skipped") {
		return reply.code(400).send({ error: "Cannot skip a completed/failed/skipped entry" });
	}

	entry.status = "skipped";
	entry.completedAt = Date.now();
	queueAuditLog(projectId, "skip", entryId);

	return { success: true };
});

/**
 * DELETE /api/projects/:projectId/queue/:entryId - Remove a queued plan
 */
fastify.delete<{
	Params: { projectId: string; entryId: string };
}>("/api/projects/:projectId/queue/:entryId", async (request, reply) => {
	const { projectId, entryId } = request.params;
	const queue = getOrCreateQueue(projectId);
	const entry = queue.entries.find((e) => e.entryId === entryId);

	if (!entry) {
		return reply.code(404).send({ error: "Entry not found" });
	}
	if (entry.status === "active") {
		return reply.code(400).send({ error: "Cannot remove the active/running plan" });
	}

	queue.entries = queue.entries.filter((e) => e.entryId !== entryId);
	queueAuditLog(projectId, "remove", entryId);

	return { success: true };
});

/**
 * POST /api/projects/:projectId/queue/:entryId/move-to-top - Move entry to top of queue
 */
fastify.post<{
	Params: { projectId: string; entryId: string };
}>("/api/projects/:projectId/queue/:entryId/move-to-top", async (request, reply) => {
	const { projectId, entryId } = request.params;
	const queue = getOrCreateQueue(projectId);
	const entryIndex = queue.entries.findIndex((e) => e.entryId === entryId);

	if (entryIndex === -1) {
		return reply.code(404).send({ error: "Entry not found" });
	}
	const entry = queue.entries[entryIndex];
	if (entry.status === "active") {
		return reply.code(400).send({ error: "Cannot move the active/running plan" });
	}
	if (entry.status === "complete" || entry.status === "failed" || entry.status === "skipped") {
		return reply.code(400).send({ error: "Cannot move a completed/failed/skipped entry" });
	}

	// Remove and re-insert at the top of the pending section
	queue.entries.splice(entryIndex, 1);
	const activeEnd = queue.entries.findIndex((e) => e.status !== "active" && e.status !== "blocked");
	const insertIdx = activeEnd === -1 ? queue.entries.length : activeEnd;
	queue.entries.splice(insertIdx, 0, entry);

	queueAuditLog(projectId, "move_to_top", entryId);

	return { success: true };
});

/**
 * POST /api/projects/:projectId/queue/run-next - Run next queued plan
 */
fastify.post<{
	Params: { projectId: string };
}>("/api/projects/:projectId/queue/run-next", async (request, reply) => {
	const { projectId } = request.params;
	const queue = getOrCreateQueue(projectId);

	if (queue.isPaused) {
		return reply.code(400).send({ error: "Queue is paused; resume before running next" });
	}

	const result = await startNextInQueue(projectId);
	return { success: result };
});

/**
 * POST /api/projects/:projectId/queue/pause - Pause queue processing
 */
fastify.post<{
	Params: { projectId: string };
}>("/api/projects/:projectId/queue/pause", async (request, _reply) => {
	const { projectId } = request.params;
	const queue = getOrCreateQueue(projectId);
	queue.isPaused = true;
	return { success: true };
});

/**
 * POST /api/projects/:projectId/queue/resume - Resume queue processing
 */
fastify.post<{
	Params: { projectId: string };
}>("/api/projects/:projectId/queue/resume", async (request, _reply) => {
	const { projectId } = request.params;
	const queue = getOrCreateQueue(projectId);
	queue.isPaused = false;
	queue.stopAfterCurrent = false;
	return { success: true };
});

/**
 * POST /api/projects/:projectId/queue/stop-after-current - Stop after current plan
 */
fastify.post<{
	Params: { projectId: string };
}>("/api/projects/:projectId/queue/stop-after-current", async (request, _reply) => {
	const { projectId } = request.params;
	const queue = getOrCreateQueue(projectId);
	queue.stopAfterCurrent = true;
	return { success: true };
});

/**
 * Helper: start the next pending entry in the queue.
 * Returns true if a plan was started, false otherwise.
 */
async function startNextInQueue(projectId: string): Promise<boolean> {
	const queue = getOrCreateQueue(projectId);

	// Don't start if paused or stop-after-current
	if (queue.isPaused || queue.stopAfterCurrent) return false;

	// Don't start if there's already an active entry
	const activeEntry = queue.entries.find((e) => e.status === "active");
	if (activeEntry) return false;

	// Find the next pending entry
	const nextEntry = queue.entries.find((e) => e.status === "pending");
	if (!nextEntry) return false;

	// Mark as active
	nextEntry.status = "active";
	nextEntry.startedAt = Date.now();

	try {
		const stateStore = getStateStore();
		const projects = await stateStore.listProjects();
		const project = projects.find((p) => p.id === projectId);
		const workspaceRoot = project?.rootPath || getWorkspaceRoot();

		const projectName = project?.name || projectId;

		const result = await runPlan({
			planContent: nextEntry.planContent,
			projectId,
			projectName,
			workspaceRoot,
			planFileName: nextEntry.planFileName,
		});

		if (!result.success) {
			nextEntry.status = "failed";
			nextEntry.error = (result.errors ?? []).join("; ");
			nextEntry.completedAt = Date.now();
			return false;
		}

		nextEntry.planExecId = result.planExecId ?? null;
		return true;
	} catch (error) {
		nextEntry.status = "failed";
		nextEntry.error = String(error);
		nextEntry.completedAt = Date.now();
		return false;
	}
}

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
 * GET /api/transcript/:planExecId/:workspaceId - SSE stream of worker transcript events
 *
 * Streams sanitized worker transcript events (worker_status, worker_decision_summary,
 * validation, blocker) in real-time. Raw private chain-of-thought is never emitted.
 *
 * Reads existing transcript.ndjson file first, then watches for new entries.
 */
fastify.get<{
	Params: { planExecId: string; workspaceId: string };
}>("/api/transcript/:planExecId/:workspaceId", async (request, reply) => {
	const { planExecId, workspaceId } = request.params;
	const workspaceRoot = getWorkspaceRoot();

	reply.raw.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	// Read existing transcript events from ndjson file
	const transcriptFilePath = join(
		workspaceRoot,
		".pi",
		"executions",
		planExecId,
		"workspaces",
		workspaceId,
		"transcript.ndjson",
	);

	let existingLines: string[] = [];
	if (existsSync(transcriptFilePath)) {
		try {
			const content = readFileSync(transcriptFilePath, "utf-8");
			existingLines = content.split("\n").filter(Boolean);
		} catch {
			// Ignore read errors
		}
	}

	// Also try the state store for transcript events
	const stateStore = getStateStore();
	if (existingLines.length === 0 && typeof (stateStore as any).readWorkerTranscriptEvents === "function") {
		try {
			const events = await (stateStore as any).readWorkerTranscriptEvents(planExecId, workspaceId);
			if (Array.isArray(events) && events.length > 0) {
				existingLines = events.map((e: any) => JSON.stringify(e));
			}
		} catch {
			// Ignore
		}
	}

	// Send existing events
	for (const line of existingLines) {
		reply.raw.write(`data: ${line}\n\n`);
	}

	if (existingLines.length === 0) {
		reply.raw.write(`data: __NO_TRANSCRIPT__\n\n`);
	}

	// Watch for new transcript entries (file-based live updates)
	if (existsSync(transcriptFilePath)) {
		let lastSentLineCount = existingLines.length;

		const watcher = watchSync(transcriptFilePath, (eventType) => {
			if (eventType === "change") {
				try {
					const content = readFileSync(transcriptFilePath, "utf-8");
					const allLines = content.split("\n").filter(Boolean);
					const newLines = allLines.slice(lastSentLineCount);
					for (const line of newLines) {
						reply.raw.write(`data: ${line}\n\n`);
					}
					lastSentLineCount = allLines.length;
				} catch {
					// Ignore
				}
			}
		});

		request.raw.on("close", () => {
			watcher.close();
		});
	} else {
		// No file yet — poll for the state store transcript events
		let lastSentCount = existingLines.length;

		const pollInterval = setInterval(async () => {
			try {
				if (typeof (stateStore as any).readWorkerTranscriptEvents === "function") {
					const events = await (stateStore as any).readWorkerTranscriptEvents(planExecId, workspaceId);
					if (Array.isArray(events) && events.length > lastSentCount) {
						const newEvents = events.slice(lastSentCount);
						for (const event of newEvents) {
							reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
						}
						lastSentCount = events.length;
					}
				}
			} catch {
				// Ignore poll errors
			}
		}, 2000);

		request.raw.on("close", () => {
			clearInterval(pollInterval);
		});
	}

	// Keep-alive heartbeat
	const heartbeat = setInterval(() => {
		reply.raw.write(": heartbeat\n\n");
	}, 15_000);
	request.raw.on("close", () => {
		clearInterval(heartbeat);
	});
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
				// Wake the background loop so it re-checks pause state at the
				// top of its iteration. A wake signal carries no semantic meaning,
				// so the loop won't try to schedule work on a paused plan.
				signalExecutionEvent(planExecId, "wake");
				break;
			case "stop":
				await stateStore.stopPlan(planExecId, "Stopped by user");
				signalExecutionEvent(planExecId, "stop");
				break;
			case "cancel":
				await stateStore.cancelPlan(planExecId);
				signalExecutionEvent(planExecId, "stop");
				break;
			case "resume":
				await stateStore.resumePlan(planExecId);
				signalExecutionEvent(planExecId, "complete");
				break;
		}

		return { success: true };
	} catch (error) {
		fastify.log.error({ error, planExecId, action }, "Failed to execute control command");
		return reply.code(500).send({ success: false, error: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Plan Summary Endpoint (cleanup/review result)
// ---------------------------------------------------------------------------

/**
 * GET /api/projects/:projectId/plans/:planExecId/summary - Get plan summary from cleanup review
 *
 * Returns the comprehensive plan summary generated by the cleanup/review agent
 * after all workspace workers completed. Includes changed files, test results,
 * issues found, and an overall assessment.
 */
fastify.get<{
	Params: { projectId: string; planExecId: string };
}>("/api/projects/:projectId/plans/:planExecId/summary", async (request, reply) => {
	const { planExecId } = request.params;

	try {
		const workspaceRoot = getWorkspaceRoot();

		// Scope summary per plan execution, like other plan artifacts.
		const summaryPath = join(workspaceRoot, ".pi", "executions", planExecId, "plan-summary.json");

		if (existsSync(summaryPath)) {
			const content = await readFile(summaryPath, "utf-8");
			const summary = JSON.parse(content);
			return { ...summary, planExecutionId: planExecId };
		}

		// Fallback: try to read the plan_summary journal event
		const stateStore = getStateStore();
		const journal = await stateStore.readJournal(planExecId);
		const summaryEvent = journal.find((e) => e.type === "plan_summary");
		if (summaryEvent?.data) {
			return {
				planExecutionId: planExecId,
				...summaryEvent.data,
				source: "journal",
			};
		}

		return reply.code(404).send({ error: "Plan summary not found. Cleanup review may not have completed yet." });
	} catch (error) {
		fastify.log.error({ error }, "Failed to get plan summary");
		return reply.code(500).send({ error: "Failed to get plan summary", message: String(error) });
	}
});

// ---------------------------------------------------------------------------
// Chat Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/projects/:projectId/chat/history - Load chat history for a project
 *
 * Returns all chat messages for the project, grouped by session.
 */
fastify.get<{
	Params: { projectId: string };
}>("/api/projects/:projectId/chat/history", async (request, _reply) => {
	const { projectId } = request.params;

	const dbBackend = detectStateStoreBackend();
	if (dbBackend !== "postgres") {
		return { messages: [] };
	}

	try {
		const { getKysely } = await import("@earendil-works/pi-db");
		const db = getKysely();
		const rows = await db
			.selectFrom("chat_messages")
			.selectAll()
			.where("project_id", "=", projectId)
			.orderBy(["session_id", "message_index"])
			.execute();

		// Return messages for the most recent session
		const sessions = new Map<string, Array<{ role: string; content: string }>>();
		for (const row of rows) {
			if (!sessions.has(row.session_id)) {
				sessions.set(row.session_id, []);
			}
			sessions.get(row.session_id)!.push({ role: row.role, content: row.content });
		}

		// Return the most recent session's messages
		const sessionIds = Array.from(sessions.keys());
		const latestSessionId = sessionIds[sessionIds.length - 1];
		const messages = latestSessionId ? sessions.get(latestSessionId)! : [];

		return { messages };
	} catch (error) {
		fastify.log.error({ error }, "Failed to load chat history");
		return { messages: [] };
	}
});

// ---------------------------------------------------------------------------
// Chat / Ad-hoc Workspace Endpoint (Agent Worker Mode)
// ---------------------------------------------------------------------------

/**
 * POST /api/chat - Send a chat message to the agent and stream the response
 *
 * This endpoint now uses AgentSession with full tool access (read, bash, edit,
 * write, grep, find, ls), enabling the chat to act as an agent worker that can
 * read files, edit code, run commands, and commit changes.
 *
 * Body: { projectId, message, sessionId? }
 * Response: SSE stream of text/tool_call events
 */
fastify.post<{
	Body: {
		projectId: string;
		message: string;
		sessionId?: string;
	};
}>("/api/chat", async (request, reply) => {
	const { projectId, message, sessionId = randomUUID() } = request.body;

	if (!projectId || !message) {
		return reply.code(400).send({ error: "projectId and message are required" });
	}

	// Hijack the reply so Fastify doesn't send its own response (preserves SSE streaming)
	reply.hijack();

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

		const workspaceRoot = project.rootPath || getWorkspaceRoot();

		// Get the default provider and model from settings
		const settingsManager = getSettingsManager();
		const settings = settingsManager.getMergedSettings();
		const defaultProvider = (settings as any).defaultProvider ?? "opencode-go";
		const defaultModelId = (settings as any).defaultModel ?? "deepseek-v4-flash";

		fastify.log.info({ defaultProvider, defaultModelId }, "Chat model");

		// Build agent session imports
		const piAgent = await import("@earendil-works/pi-coding-agent");
		const ai = await import("@earendil-works/pi-ai");

		// Resolve the model
		let model: any;
		const allModels = ai.getModels(defaultProvider as any);
		const found = allModels.find((m: any) => m.id === defaultModelId);
		if (found) {
			model = found;
		} else {
			// Fall back to first available model for this provider
			for (const m of allModels) {
				if (m.provider === defaultProvider) {
					model = m;
					break;
				}
			}
			if (!model) {
				reply.raw.write(
					`data: ${JSON.stringify({ type: "error", message: `No model found for provider: ${defaultProvider}` })}\n\n`,
				);
				reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
				reply.raw.end();
				return;
			}
		}

		// Get recent git info for context
		let gitContext = "";
		try {
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
Project root: ${workspaceRoot}
${gitContext}
${execContext}

You have full access to tools: read files, edit code, write new files, run bash commands, search with grep/find, list directories.

You can:
1. Answer questions about the project, git state, and execution results
2. Read, edit, and write code
3. Run bash commands (git, build tools, etc.)
4. Suggest and implement fixes for failed workspaces
5. Commit and push changes using git commands

Keep responses concise and technical.
Always confirm with the user before making destructive changes.`;

		// Create the agent session with tool access
		const { createAgentSession, SessionManager, SettingsManager, AuthStorage, ModelRegistry } = piAgent;

		const authStorage = AuthStorage.create();
		const modelRegistry = ModelRegistry.create(authStorage);
		const projectSettingsManager = SettingsManager.create(workspaceRoot);
		const sessionManager = SessionManager.inMemory(workspaceRoot);

		let _responseText = "";
		let session: any = null;

		try {
			const result = await createAgentSession({
				cwd: workspaceRoot,
				model,
				authStorage,
				modelRegistry,
				settingsManager: projectSettingsManager,
				sessionManager,
				// Enable all built-in tools: read, bash, edit, write, grep, find, ls
				tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
			});

			session = result.session;

			// Override system prompt
			session.agent.state.systemPrompt = systemPrompt;

			// Subscribe to agent events for SSE streaming
			const unsubscribe = session.subscribe((event: any) => {
				if (reply.raw.writableEnded) return;

				if (event.type === "message_update") {
					// Stream text deltas from assistant messages
					const msg = event.assistantMessageEvent;
					if (msg?.type === "text_delta" && msg.delta) {
						_responseText += msg.delta;
						reply.raw.write(`data: ${JSON.stringify({ type: "text", text: msg.delta })}\n\n`);
					}
				} else if (event.type === "tool_execution_start") {
					// Notify frontend about tool execution
					reply.raw.write(
						`data: ${JSON.stringify({
							type: "tool_call",
							tool: { name: event.toolName, args: event.args, toolCallId: event.toolCallId },
						})}\n\n`,
					);
				} else if (event.type === "tool_execution_update") {
					// Stream partial results from tool execution
					const partial = event.partialResult;
					if (partial) {
						const text = typeof partial === "string" ? partial : JSON.stringify(partial);
						if (text) {
							reply.raw.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
						}
					}
				} else if (event.type === "tool_execution_end") {
					// Show tool execution result
					const resultStr = event.isError
						? `[Tool ${event.toolName} failed: ${String(event.result)}]`
						: `[Tool ${event.toolName} completed]`;
					reply.raw.write(`data: ${JSON.stringify({ type: "text", text: resultStr })}\n\n`);
				} else if (event.type === "error") {
					// Only forward agent errors, not internal events like "auto_retry"
					const ev = event as any;
					if (ev.errorMessage) {
						reply.raw.write(`data: ${JSON.stringify({ type: "error", message: ev.errorMessage })}\n\n`);
					}
				}
			});

			// Send the user message to the agent
			await session.sendUserMessage(message);

			// Wait for agent to finish processing
			await session.agent.waitForIdle();

			unsubscribe();

			// Save assistant response to DB
			const dbBackend = detectStateStoreBackend();
			if (dbBackend === "postgres" && _responseText) {
				try {
					const { getKysely } = await import("@earendil-works/pi-db");
					const db = getKysely();
					await db
						.insertInto("chat_messages")
						.values({
							project_id: projectId,
							role: "assistant",
							content: _responseText,
							message_index: 0,
							session_id: sessionId,
						})
						.execute();
				} catch {
					fastify.log.warn("Failed to save assistant chat message to DB");
				}
			}

			// Signal completion
			reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
		} catch (agentError: any) {
			fastify.log.error({ agentError }, "Chat agent error");
			reply.raw.write(`data: ${JSON.stringify({ type: "error", message: String(agentError) })}\n\n`);
			reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
		} finally {
			if (!reply.raw.writableEnded) {
				reply.raw.end();
			}
		}
	} catch (error) {
		fastify.log.error({ error }, "Chat error");
		reply.raw.write(`data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`);
		reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
		reply.raw.end();
	}
});

// ---------------------------------------------------------------------------
// Artifact Browser Routes (P5 Workstream 5.C)
// ---------------------------------------------------------------------------

await registerArtifactRoutes(fastify);

// ---------------------------------------------------------------------------
// Log Stream Routes (P4.6.D)
// ---------------------------------------------------------------------------

registerLogStreamRoutes(fastify, getWorkspaceRoot, getStateStore);

// ---------------------------------------------------------------------------
// Performance Telemetry Routes (workspace 5.5.G)
// ---------------------------------------------------------------------------

registerPerformanceRoutes(fastify, getPiDir, getWorkspaceRoot);

// ---------------------------------------------------------------------------
// Scale Dashboard Routes (Workspace 6.J)
// ---------------------------------------------------------------------------

await registerScaleRoutes(fastify, getPiDir, getWorkspaceRoot, getSettingsManager);

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

		// Resume stranded executions from a previous server crash.
		// Look up the project by the configured name to get its stable project ID.
		const workspaceRoot = getWorkspaceRoot();
		const projectName = process.env.PI_PROJECT_NAME || "hello";
		const stateStore = getStateStore();
		const projects = await stateStore.listProjects();
		const project = projects.find((p) => p.name === projectName);
		const projectId = project?.id ?? projectName; // fall back to name if not found
		const recovered = await resumeStrandedExecutions(workspaceRoot, projectId, projectName);
		if (recovered > 0) {
			console.log(`[server] Recovered ${recovered} stranded plan execution(s)`);
		}

		await fastify.listen({ port, host: "127.0.0.1" });
		const dashboardUrl = process.env.DASHBOARD_URL || `http://127.0.0.1:5176`;
		console.log(`API server listening at http://127.0.0.1:${port}`);
		console.log(`Dashboard should be opened at ${dashboardUrl}`);
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
};

start();
