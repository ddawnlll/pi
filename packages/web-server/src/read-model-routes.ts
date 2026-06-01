/**
 * Read Model Routes — P42.01 Read Model API Endpoints
 *
 * REST API endpoints that expose ExecutionReadModel data to the dashboard.
 * Unlike the direct state store endpoints in index.ts, these endpoints
 * go through the read model, ensuring proper data availability sentinels
 * and consistent typed contracts.
 *
 * Endpoints:
 *   GET /api/projects/:projectId/plans/:planExecId/summary
 *       → Plan execution summary (read model)
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/commands
 *       → Command history for a workspace
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/directives
 *       → Lead Agent directives for a workspace
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/escalations
 *       → Lead Agent escalations for a workspace
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/validation
 *       → Final validation status for a workspace
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/changed-files
 *       → Changed files for a workspace
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-tree
 *       → File tree (hierarchical) for a workspace
 *       Query: ?flat=true for flat list
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-content
 *       → File content for a specific file
 *       Query: ?path=src/index.ts
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-diff
 *       → File diff(s) for a workspace
 *       Query: ?path=src/index.ts for single file diff
 *              ?maxDiffLines=200 to truncate
 *
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/transcript
 *       → Transcript events for a workspace
 *
 *   GET /api/projects/:projectId/plans/:planExecId/artifacts
 *       → List available artifacts for a plan execution
 *
 *   GET /api/projects/:projectId/plans/:planExecId/dependency-graph
 *       → Dependency graph for a plan execution
 *
 *   GET /api/projects/:projectId/plans/:planExecId/stats-verbose
 *       → Plan statistics with data source info
 */

import { createExecutionReadModel } from "@earendil-works/pi-execution-service";
import type { FastifyInstance } from "fastify";
import { createReadModelAdapter } from "./read-model-adapter.js";

// ---------------------------------------------------------------------------
// Minimal logger
// ---------------------------------------------------------------------------

const log = {
	error: (obj: Record<string, unknown>, msg: string) => {
		console.error(`[read-model-routes] ${msg}`, obj);
	},
};

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

/**
 * Register read model API routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param getStateStore - Function returning the IStateStore instance
 * @param getWorkspaceRoot - Function returning the project workspace root path
 */
export function registerReadModelRoutes(
	fastify: FastifyInstance,
	getStateStore: () => any,
	getWorkspaceRoot: () => string,
): void {
	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/plan-summary
	// Plan execution summary via read model
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string };
	}>("/api/projects/:projectId/plans/:planExecId/plan-summary", async (request, reply) => {
		const { planExecId } = request.params;
		try {
			const stateStore = getStateStore();
			const workspaceRoot = getWorkspaceRoot();
			const adapter = createReadModelAdapter(stateStore, workspaceRoot);
			const readModel = createExecutionReadModel(adapter);
			const summary = await readModel.getPlanSummary(planExecId);
			return { success: true, summary };
		} catch (error) {
			log.error({ error, planExecId }, "Failed to get plan summary from read model");
			return reply.code(500).send({ success: false, error: String(error) });
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/stats-verbose
	// Plan statistics with dataSource info from read model
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string };
	}>("/api/projects/:projectId/plans/:planExecId/stats-verbose", async (request, reply) => {
		const { planExecId } = request.params;
		try {
			const stateStore = getStateStore();
			const workspaceRoot = getWorkspaceRoot();
			const adapter = createReadModelAdapter(stateStore, workspaceRoot);
			const readModel = createExecutionReadModel(adapter);
			const stats = await readModel.getPlanStats(planExecId);
			return { success: true, stats };
		} catch (error) {
			log.error({ error, planExecId }, "Failed to get plan stats from read model");
			return reply.code(500).send({ success: false, error: String(error) });
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/dependency-graph
	// Dependency graph for a plan execution
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string };
	}>("/api/projects/:projectId/plans/:planExecId/dependency-graph", async (request, reply) => {
		const { planExecId } = request.params;
		try {
			const stateStore = getStateStore();
			const workspaceRoot = getWorkspaceRoot();
			const adapter = createReadModelAdapter(stateStore, workspaceRoot);
			const readModel = createExecutionReadModel(adapter);
			const graph = await readModel.getDependencyGraph(planExecId);
			return { success: true, graph };
		} catch (error) {
			log.error({ error, planExecId }, "Failed to get dependency graph from read model");
			return reply.code(500).send({ success: false, error: String(error) });
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/commands
	// Command history for a workspace
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
	}>(
		"/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/commands",
		async (request, reply) => {
			const { planExecId, workspaceId } = request.params;
			try {
				const stateStore = getStateStore();
				const workspaceRoot = getWorkspaceRoot();
				const adapter = createReadModelAdapter(stateStore, workspaceRoot);
				const readModel = createExecutionReadModel(adapter);
				const history = await readModel.getCommandHistory(planExecId, workspaceId);
				return { success: true, commands: history };
			} catch (error) {
				log.error({ error, planExecId, workspaceId }, "Failed to get command history");
				return reply.code(500).send({ success: false, error: String(error) });
			}
		},
	);

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/directives
	// Lead Agent directives for a workspace
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
	}>(
		"/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/directives",
		async (request, reply) => {
			const { planExecId, workspaceId } = request.params;
			try {
				const stateStore = getStateStore();
				const workspaceRoot = getWorkspaceRoot();
				const adapter = createReadModelAdapter(stateStore, workspaceRoot);
				const readModel = createExecutionReadModel(adapter);
				const directives = await readModel.getLeadDirectives(planExecId, workspaceId);
				return { success: true, directives };
			} catch (error) {
				log.error({ error, planExecId, workspaceId }, "Failed to get lead directives");
				return reply.code(500).send({ success: false, error: String(error) });
			}
		},
	);

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/escalations
	// Lead Agent escalations for a workspace
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
	}>(
		"/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/escalations",
		async (request, reply) => {
			const { planExecId, workspaceId } = request.params;
			try {
				const stateStore = getStateStore();
				const workspaceRoot = getWorkspaceRoot();
				const adapter = createReadModelAdapter(stateStore, workspaceRoot);
				const readModel = createExecutionReadModel(adapter);
				const escalations = await readModel.getLeadEscalations(planExecId, workspaceId);
				return { success: true, escalations };
			} catch (error) {
				log.error({ error, planExecId, workspaceId }, "Failed to get lead escalations");
				return reply.code(500).send({ success: false, error: String(error) });
			}
		},
	);

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/validation
	// Final validation status for a workspace
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
	}>(
		"/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/validation",
		async (request, reply) => {
			const { planExecId, workspaceId } = request.params;
			try {
				const stateStore = getStateStore();
				const workspaceRoot = getWorkspaceRoot();
				const adapter = createReadModelAdapter(stateStore, workspaceRoot);
				const readModel = createExecutionReadModel(adapter);
				const status = await readModel.getFinalValidationStatus(planExecId, workspaceId);
				return { success: true, validation: status };
			} catch (error) {
				log.error({ error, planExecId, workspaceId }, "Failed to get final validation status");
				return reply.code(500).send({ success: false, error: String(error) });
			}
		},
	);

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/changed-files
	// Changed files for a workspace
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
	}>(
		"/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/changed-files",
		async (request, reply) => {
			const { planExecId, workspaceId } = request.params;
			try {
				const stateStore = getStateStore();
				const workspaceRoot = getWorkspaceRoot();
				const adapter = createReadModelAdapter(stateStore, workspaceRoot);
				const readModel = createExecutionReadModel(adapter);
				const files = await readModel.getChangedFiles(planExecId, workspaceId);
				return { success: true, files };
			} catch (error) {
				log.error({ error, planExecId, workspaceId }, "Failed to get changed files");
				return reply.code(500).send({ success: false, error: String(error) });
			}
		},
	);

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-tree
	// File tree (hierarchical) for a workspace
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
		Querystring: { flat?: string };
	}>(
		"/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-tree",
		async (request, reply) => {
			const { planExecId, workspaceId } = request.params;
			const flat = request.query.flat === "true";
			try {
				const stateStore = getStateStore();
				const workspaceRoot = getWorkspaceRoot();
				const adapter = createReadModelAdapter(stateStore, workspaceRoot);
				const readModel = createExecutionReadModel(adapter);
				const tree = await readModel.getFileTree(planExecId, workspaceId, { flat });
				return { success: true, tree };
			} catch (error) {
				log.error({ error, planExecId, workspaceId }, "Failed to get file tree");
				return reply.code(500).send({ success: false, error: String(error) });
			}
		},
	);

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/transcript
	// Transcript events for a workspace
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
	}>(
		"/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/transcript",
		async (request, reply) => {
			const { planExecId, workspaceId } = request.params;
			try {
				const stateStore = getStateStore();
				const workspaceRoot = getWorkspaceRoot();
				const adapter = createReadModelAdapter(stateStore, workspaceRoot);
				const readModel = createExecutionReadModel(adapter);
				const events = await readModel.getTranscript(planExecId, workspaceId);
				return { success: true, events };
			} catch (error) {
				log.error({ error, planExecId, workspaceId }, "Failed to get transcript events");
				return reply.code(500).send({ success: false, error: String(error) });
			}
		},
	);

	// -----------------------------------------------------------------------
	// GET /api/projects/:projectId/plans/:planExecId/artifacts
	// List available artifacts for a plan execution
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { projectId: string; planExecId: string };
	}>("/api/projects/:projectId/plans/:planExecId/artifacts", async (request, reply) => {
		const { planExecId } = request.params;
		try {
			const stateStore = getStateStore();
			const workspaceRoot = getWorkspaceRoot();
			const adapter = createReadModelAdapter(stateStore, workspaceRoot);
			const readModel = createExecutionReadModel(adapter);
			const artifacts = await readModel.getArtifacts(planExecId);
			return { success: true, artifacts };
		} catch (error) {
			log.error({ error, planExecId }, "Failed to list artifacts");
			return reply.code(500).send({ success: false, error: String(error) });
		}
	});
}
