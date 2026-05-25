/**
 * Brain state routes — P13 brain daemon status, observations, signals, timeline
 *
 * Routes use relative paths so they can be registered under any prefix:
 * - Globally: prefix "/api/brain" → /api/brain/state
 * - Per-project: prefix "/api/projects/:projectId/brain" → /api/projects/:projectId/brain/state
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * Resolve the .pi directory the same way the orchestrator routes do.
 */
function resolvePiDir(): string {
	let piDir = resolve(process.cwd(), ".pi");
	if (!existsSync(piDir)) piDir = resolve(process.cwd(), "../..", ".pi");
	if (!existsSync(piDir)) piDir = resolve(process.cwd(), "../../..", ".pi");
	return piDir;
}

export async function registerBrainStateRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /state - Brain daemon status summary
	fastify.get("/state", async (request, reply) => {
		try {
			const { getBrainState } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const piDir = resolvePiDir();
			const state = await getBrainState(projectId, piDir);
			return state;
		} catch {
			return reply.code(500).send({
				error: "Failed to get brain state",
				daemon: { state: "stopped", uptime: "0s", observationCount: 0 },
				observationStats: { total: 0, bySeverity: {} },
				signalStats: { total: 0, active: 0, resolved: 0, byType: {} },
			});
		}
	});

	// GET /observations - List observations
	fastify.get<{
		Querystring: { limit?: string; offset?: string; severity?: string };
	}>("/observations", async (request, _reply) => {
		try {
			const { getObservations } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const result = await getObservations({ limit, offset, severity: request.query.severity }, projectId);
			return result;
		} catch {
			return { observations: [], total: 0 };
		}
	});

	// GET /signals - List signals
	fastify.get<{
		Querystring: { limit?: string; offset?: string; resolved?: string };
	}>("/signals", async (request, _reply) => {
		try {
			const { getSignals } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const resolved = request.query.resolved !== undefined ? request.query.resolved === "true" : undefined;
			const result = await getSignals({ limit, offset, resolved }, projectId);
			return result;
		} catch {
			return { signals: [], total: 0 };
		}
	});

	// GET /timeline - Get timeline events
	fastify.get<{
		Querystring: { limit?: string; offset?: string; severity?: string };
	}>("/timeline", async (request, _reply) => {
		try {
			const { getTimeline } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const limit = Number(request.query.limit) || 50;
			const offset = Number(request.query.offset) || 0;
			const result = await getTimeline({ limit, offset, severity: request.query.severity }, projectId);
			return result;
		} catch {
			return { events: [], total: 0 };
		}
	});
}
