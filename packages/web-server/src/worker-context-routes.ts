/**
 * Worker Context Routes — P41.08 Worker Context Inspector
 *
 * REST API for retrieving the full worker context for a workspace,
 * including role packet, allowed/touched files, command history,
 * Lead Agent directives, escalations, human directives, and
 * a link to the live transcript SSE stream.
 *
 * Endpoints:
 *   GET /api/projects/:projectId/worker-context/:planExecId/:workspaceId
 *       Returns the full WorkerContextView for the given workspace.
 *
 *   GET /api/worker-context/:planExecId/:workspaceId
 *       Same as above, without projectId scope (legacy/global).
 *
 * The context is assembled from:
 *   - Workspace state (from the state store)
 *   - Role packet (from the execution archive)
 *   - Touched files (from archive files-touched.json)
 *   - Command history (from the state store / read model)
 *   - Lead Agent directives and escalations (from the read model)
 *   - Human directive (from the workspace state / control request)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LeadDirectiveView, LeadEscalationView, WorkerContextView } from "@earendil-works/pi-execution-contracts";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

/**
 * Register worker context routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param getPiDir - Function returning the .pi directory path
 * @param getWorkspaceRoot - Function returning the project workspace root path
 * @param getStateStore - Function returning the state store instance
 */
export function registerWorkerContextRoutes(
	fastify: FastifyInstance,
	getPiDir: () => string,
	getWorkspaceRoot: () => string,
	getStateStore: () => any,
): void {
	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/worker-context/:planExecId/:workspaceId
	// Get the full worker context for a workspace within a project.
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string; workspaceId: string };
	}>("/api/projects/:projectId/worker-context/:planExecId/:workspaceId", async (request, reply) => {
		const { planExecId, workspaceId } = request.params;
		return handleWorkerContextRequest(planExecId, workspaceId, getPiDir, getWorkspaceRoot, getStateStore, reply);
	});

	// -----------------------------------------------------------------------
	// GET /api/worker-context/:planExecId/:workspaceId
	// Same as above, but scoped globally (legacy/projectless endpoint).
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string; workspaceId: string };
	}>("/api/worker-context/:planExecId/:workspaceId", async (request, reply) => {
		const { planExecId, workspaceId } = request.params;
		return handleWorkerContextRequest(planExecId, workspaceId, getPiDir, getWorkspaceRoot, getStateStore, reply);
	});
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleWorkerContextRequest(
	planExecId: string,
	workspaceId: string,
	_getPiDir: () => string,
	getWorkspaceRoot: () => string,
	getStateStore: () => any,
	reply: any,
) {
	try {
		const stateStore = getStateStore();
		const workspaceRoot = getWorkspaceRoot();

		// 1. Workspace state
		const ws = await stateStore.getWorkspaceState(planExecId, workspaceId);
		if (!ws) {
			return reply.code(404).send({ error: "Workspace not found" });
		}

		// 2. Extract goal from the workspace definition in the state
		const goal = extractGoal(stateStore, planExecId, workspaceId, ws);

		// 3. Load role packet from the execution archive
		const rolePacketContent = loadRolePacket(workspaceRoot, planExecId, workspaceId);

		// 4. Build context packet summary (excerpt from the packet)
		const contextPacketSummary = rolePacketContent ? buildContextSummary(rolePacketContent) : undefined;

		// 5. Load touched files from the archive
		const touchedFiles = loadTouchedFiles(workspaceRoot, planExecId, workspaceId);

		// 6. Load allowed files (from workspace definition in state)
		const allowedFiles = extractAllowedFiles(stateStore, planExecId, workspaceId, ws);

		// 7. Load command history (last command)
		const lastCommand = await extractLastCommand(stateStore, planExecId, workspaceId);

		// 8. Load log summary (recent stdout/stderr lines)
		const logSummary = await extractLogSummary(workspaceRoot, planExecId, workspaceId);

		// 9. Load Lead Agent directives
		const activeDirectives = await extractActiveDirectives(stateStore, planExecId, workspaceId);

		// 10. Load escalations
		const activeEscalations = await extractActiveEscalations(stateStore, planExecId, workspaceId);

		// 11. Load human directive (from control request or workspace meta)
		const humanDirective = await extractHumanDirective(stateStore, planExecId, workspaceId);

		// 12. Build transcript URL
		const transcriptUrl = `/api/transcript/${planExecId}/${workspaceId}`;

		// 13. Determine role
		const role = extractRole(ws);

		const contextView: WorkerContextView = {
			workspaceId,
			planExecutionId: planExecId,
			stage: ws.stage ?? "unknown",
			attempts: ws.attempts ?? 0,
			error: ws.error ?? undefined,
			startedAt: ws.startedAt ? new Date(ws.startedAt).toISOString() : undefined,
			completedAt: ws.completedAt ? new Date(ws.completedAt).toISOString() : undefined,
			goal,
			role,
			rolePacketContent,
			contextPacketSummary,
			allowedFiles,
			touchedFiles,
			lastCommand,
			logSummary,
			activeDirectives,
			activeEscalations,
			humanDirective,
			transcriptUrl,
		};

		return reply.send({
			success: true,
			context: contextView,
		});
	} catch (error) {
		requestLog.error({ error, planExecId, workspaceId }, "Failed to get worker context");
		return reply.code(500).send({
			success: false,
			error: "Failed to get worker context",
			message: String(error),
		});
	}
}

// ---------------------------------------------------------------------------
// Minimal logger for the routes module
// ---------------------------------------------------------------------------

const requestLog = {
	error: (obj: Record<string, unknown>, msg: string) => {
		console.error(`[worker-context] ${msg}`, obj);
	},
};

// ---------------------------------------------------------------------------
// Helper: Extract goal from workspace state
// ---------------------------------------------------------------------------

/**
 * Extract the goal description from the workspace definition.
 * Tries multiple sources in order:
 *   1. The workspace packet content (parsed from archive)
 *   2. The workspace data stored in stateStore
 *   3. A generic fallback based on the workspace ID
 */
function extractGoal(stateStore: any, planExecId: string, workspaceId: string, ws: any): string | undefined {
	// If the workspace data has a goal/title field, use it
	if (ws.goal && typeof ws.goal === "string") return ws.goal;
	if (ws.title && typeof ws.title === "string") return ws.title;
	if (ws.description && typeof ws.description === "string") return ws.description;

	// Try to get the workspace definition from the plan state
	if (typeof stateStore.loadState === "function") {
		try {
			const state = stateStore.loadState(planExecId);
			if (state?.workspaces) {
				for (const [id, w] of state.workspaces) {
					if (id === workspaceId && w.goal) return w.goal;
				}
			}
		} catch {
			// Silently fall through
		}
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Helper: Load role packet from execution archive
// ---------------------------------------------------------------------------

/**
 * Load the workspace packet content from the execution archive.
 *
 * Path: .pi/executions/{planExecId}/workspaces/{workspaceId}/packet.md
 */
function loadRolePacket(workspaceRoot: string, planExecId: string, workspaceId: string): string | undefined {
	try {
		const packetPath = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "packet.md");
		if (existsSync(packetPath)) {
			return readFileSync(packetPath, "utf-8");
		}
	} catch {
		// Packet not available
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Helper: Build context summary from packet content
// ---------------------------------------------------------------------------

/**
 * Build a concise context summary from the packet content.
 * Extracts a few lines or key sections to avoid returning the entire
 * raw prompt in dashboard responses. When full packet content is needed,
 * the rolePacketContent field provides it.
 */
function buildContextSummary(packetContent: string): string {
	// Take the first meaningful lines as a summary
	const lines = packetContent.split("\n").filter((l) => l.trim().length > 0);
	const summaryLines: string[] = [];
	for (const line of lines) {
		summaryLines.push(line);
		if (summaryLines.length >= 10) break;
	}

	if (lines.length > 10) {
		summaryLines.push(`... (${lines.length - 10} more lines)`);
	}

	return summaryLines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper: Load touched files from archive
// ---------------------------------------------------------------------------

interface TouchedFileEntry {
	path: string;
	change: "created" | "modified" | "deleted";
}

/**
 * Load the list of files touched by the worker from the execution archive.
 *
 * Path: .pi/executions/{planExecId}/workspaces/{workspaceId}/files-touched.json
 */
function loadTouchedFiles(workspaceRoot: string, planExecId: string, workspaceId: string): TouchedFileEntry[] {
	try {
		const filePath = join(
			workspaceRoot,
			".pi",
			"executions",
			planExecId,
			"workspaces",
			workspaceId,
			"files-touched.json",
		);
		if (existsSync(filePath)) {
			const content = readFileSync(filePath, "utf-8");
			const entries = JSON.parse(content) as TouchedFileEntry[];
			return entries;
		}
	} catch {
		// File not available or not parseable
	}
	return [];
}

// ---------------------------------------------------------------------------
// Helper: Extract allowed files from workspace definition
// ---------------------------------------------------------------------------

/**
 * Extract the list of files the worker is allowed to edit.
 * Falls back to an empty array if unavailable.
 */
function extractAllowedFiles(_stateStore: any, _planExecId: string, _workspaceId: string, ws: any): string[] {
	// Check common locations where allowed files are stored in workspace state
	if (ws.allowedFiles && Array.isArray(ws.allowedFiles)) return ws.allowedFiles;
	if (ws.canEdit && Array.isArray(ws.canEdit)) return ws.canEdit as string[];
	if (ws.allowedPaths && Array.isArray(ws.allowedPaths)) return ws.allowedPaths;
	return [];
}

// ---------------------------------------------------------------------------
// Helper: Extract last command from command history
// ---------------------------------------------------------------------------

async function extractLastCommand(
	stateStore: any,
	planExecId: string,
	workspaceId: string,
): Promise<string | undefined> {
	try {
		if (typeof stateStore.getCommandHistory === "function") {
			const history = await stateStore.getCommandHistory(planExecId, workspaceId);
			if (Array.isArray(history) && history.length > 0) {
				// Return the most recent command
				return history[history.length - 1].command;
			}
		}
	} catch {
		// Not available
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Helper: Extract log summary
// ---------------------------------------------------------------------------

async function extractLogSummary(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
): Promise<string | undefined> {
	try {
		// Try workspace archive raw.log first
		const logPath = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId, "raw.log");
		if (existsSync(logPath)) {
			const content = readFileSync(logPath, "utf-8");
			const lines = content.split("\n").filter(Boolean);
			// Return the last 20 lines as summary
			const tail = lines.slice(-20);
			return tail.join("\n");
		}

		// Fallback: try the workspace execution log
		const piDir = join(workspaceRoot, ".pi");
		const execLogPath = join(piDir, "workspaces", workspaceId, "execution-1.log");
		if (existsSync(execLogPath)) {
			const content = readFileSync(execLogPath, "utf-8");
			const lines = content.split("\n").filter(Boolean);
			const tail = lines.slice(-20);
			return tail.join("\n");
		}
	} catch {
		// Log not available
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Helper: Extract active Lead Agent directives
// ---------------------------------------------------------------------------

async function extractActiveDirectives(
	stateStore: any,
	planExecId: string,
	workspaceId: string,
): Promise<LeadDirectiveView[]> {
	try {
		if (typeof stateStore.getLeadDirectives === "function") {
			const directives = await stateStore.getLeadDirectives(planExecId, workspaceId);
			if (Array.isArray(directives)) {
				// Return only active (non-resolved, non-expired) directives
				return directives.filter((d: any) => d.status === "issued" || d.status === "acknowledged");
			}
		}
	} catch {
		// Not available
	}
	return [];
}

// ---------------------------------------------------------------------------
// Helper: Extract active escalations
// ---------------------------------------------------------------------------

async function extractActiveEscalations(
	stateStore: any,
	planExecId: string,
	workspaceId: string,
): Promise<LeadEscalationView[]> {
	try {
		if (typeof stateStore.getLeadEscalations === "function") {
			const escalations = await stateStore.getLeadEscalations(planExecId, workspaceId);
			if (Array.isArray(escalations)) {
				// Return active escalations only
				return escalations.filter((e: any) => e.status === "awaiting_user");
			}
		}
	} catch {
		// Not available
	}
	return [];
}

// ---------------------------------------------------------------------------
// Helper: Extract human directive
// ---------------------------------------------------------------------------

async function extractHumanDirective(
	stateStore: any,
	planExecId: string,
	workspaceId: string,
): Promise<string | undefined> {
	try {
		if (typeof stateStore.readControlRequest === "function") {
			const control = await stateStore.readControlRequest(planExecId);
			if (control && control.workspaceId === workspaceId && control.action === "human_directive") {
				return control.reason;
			}
		}

		// Fallback: try to load from workspace metadata
		if (typeof stateStore.getWorkspaceState === "function") {
			const ws = await stateStore.getWorkspaceState(planExecId, workspaceId);
			if (ws && (ws as any).humanDirective) {
				return (ws as any).humanDirective;
			}
		}
	} catch {
		// Not available
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Helper: Extract role from workspace state
// ---------------------------------------------------------------------------

/**
 * Determine the worker role from the workspace definition.
 * Looks for a role field, or infers from context.
 */
function extractRole(ws: any): string | undefined {
	if (ws.role && typeof ws.role === "string") return ws.role;
	if (ws.agentRole && typeof ws.agentRole === "string") return ws.agentRole;
	if (ws.workerRole && typeof ws.workerRole === "string") return ws.workerRole;
	return "worker";
}
