/**
 * Audit routes — P18 audit endpoints for the Brain API client
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainAuditRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /api/brain/audit - List audit entries
	fastify.get<{
		Querystring: { limit?: string; offset?: string; action?: string };
	}>("/api/brain/audit", async (request, _reply) => {
		try {
			const { getAuditEntries } = await import("@earendil-works/pi-coding-agent");
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const result = await getAuditEntries({ limit, offset, action: request.query.action });
			return result;
		} catch {
			return { entries: [], total: 0 };
		}
	});

	// GET /api/brain/audit/stats - Audit stats
	fastify.get("/api/brain/audit/stats", async () => {
		try {
			const { getAuditStats } = await import("@earendil-works/pi-coding-agent");
			return await getAuditStats();
		} catch {
			return { total: 0, today: 0, byAction: {}, approvalRate: 1 };
		}
	});

	// GET /api/brain/audit/provenance/:targetId
	fastify.get<{ Params: { targetId: string } }>("/api/brain/audit/provenance/:targetId", async (request, reply) => {
		try {
			const { getProvenance } = await import("@earendil-works/pi-coding-agent");
			return await getProvenance(request.params.targetId);
		} catch {
			return reply.code(404).send({ error: "Provenance not found" });
		}
	});

	// GET /api/brain/audit/explain/:targetId
	fastify.get<{ Params: { targetId: string } }>("/api/brain/audit/explain/:targetId", async (request, reply) => {
		try {
			const { explainDecision } = await import("@earendil-works/pi-coding-agent");
			const explanation = await explainDecision(request.params.targetId);
			return { explanation };
		} catch {
			return reply.code(404).send({ error: "Explanation not found" });
		}
	});
}
