/**
 * Audit routes — P18 audit endpoints for the Brain API client
 *
 * Routes use relative paths so they can be registered under any prefix.
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainAuditRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /audit - List audit entries
	fastify.get<{
		Querystring: { limit?: string; offset?: string; action?: string };
	}>("/audit", async (request, _reply) => {
		try {
			const { getAuditEntries } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const result = await getAuditEntries({ limit, offset, action: request.query.action }, projectId);
			return result;
		} catch {
			return { entries: [], total: 0 };
		}
	});

	// GET /audit/stats - Audit stats
	fastify.get("/audit/stats", async (request) => {
		try {
			const { getAuditStats } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await getAuditStats(projectId);
		} catch {
			return { total: 0, today: 0, byAction: {}, approvalRate: 1 };
		}
	});

	// GET /audit/provenance/:targetId
	fastify.get<{ Params: { targetId: string } }>("/audit/provenance/:targetId", async (request, reply) => {
		try {
			const { getProvenance } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await getProvenance(request.params.targetId, projectId);
		} catch {
			return reply.code(404).send({ error: "Provenance not found" });
		}
	});

	// GET /audit/explain/:targetId
	fastify.get<{ Params: { targetId: string } }>("/audit/explain/:targetId", async (request, reply) => {
		try {
			const { explainDecision } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const explanation = await explainDecision(request.params.targetId, projectId);
			return { explanation };
		} catch {
			return reply.code(404).send({ error: "Explanation not found" });
		}
	});
}
