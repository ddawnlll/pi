/**
 * Brain state routes — P13 brain daemon status, observations, signals, timeline
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainStateRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /api/brain/state - Brain daemon status summary
	fastify.get("/api/brain/state", async (_request, reply) => {
		try {
			const { getBrainState } = await import("@earendil-works/pi-coding-agent");
			const state = await getBrainState();
			return state;
		} catch {
			return reply.code(500).send({ error: "Failed to get brain state", daemon: { state: "stopped", uptime: "0s", observationCount: 0 }, observationStats: { total: 0, bySeverity: {} }, signalStats: { total: 0, active: 0, resolved: 0, byType: {} } });
		}
	});

	// GET /api/brain/observations - List observations
	fastify.get<{
		Querystring: { limit?: string; offset?: string; severity?: string };
	}>("/api/brain/observations", async (request, reply) => {
		try {
			const { getObservations } = await import("@earendil-works/pi-coding-agent");
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const result = await getObservations({ limit, offset, severity: request.query.severity });
			return result;
		} catch {
			return { observations: [], total: 0 };
		}
	});

	// GET /api/brain/signals - List signals
	fastify.get<{
		Querystring: { limit?: string; offset?: string; resolved?: string };
	}>("/api/brain/signals", async (request, reply) => {
		try {
			const { getSignals } = await import("@earendil-works/pi-coding-agent");
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const resolved = request.query.resolved !== undefined ? request.query.resolved === "true" : undefined;
			const result = await getSignals({ limit, offset, resolved });
			return result;
		} catch {
			return { signals: [], total: 0 };
		}
	});

	// GET /api/brain/timeline - Get timeline events
	fastify.get<{
		Querystring: { limit?: string; offset?: string; severity?: string };
	}>("/api/brain/timeline", async (request, reply) => {
		try {
			const { getTimeline } = await import("@earendil-works/pi-coding-agent");
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const result = await getTimeline({ limit, offset, severity: request.query.severity });
			return result;
		} catch {
			return { events: [], total: 0 };
		}
	});
}
