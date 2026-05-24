/**
 * Policy routes — P18 policy rules endpoints
 *
 * Routes use relative paths so they can be registered under any prefix.
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainPolicyRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /policy/rules - List policy rules
	fastify.get("/policy/rules", async (request) => {
		try {
			const { getPolicyRules } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await getPolicyRules(projectId);
		} catch {
			return [];
		}
	});

	// POST /policy/rules/:id/toggle - Toggle a rule
	fastify.post<{ Params: { id: string } }>("/policy/rules/:id/toggle", async (request, reply) => {
		try {
			const { toggleRule } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await toggleRule(request.params.id, projectId);
		} catch {
			return reply.code(404).send({ error: "Rule not found" });
		}
	});

	// POST /policy/evaluate - Evaluate an action against policy
	fastify.post<{ Body: { action: string; context?: Record<string, unknown> } }>(
		"/policy/evaluate",
		async (request, reply) => {
			try {
				const { evaluateAction } = await import("@earendil-works/pi-coding-agent");
				const { projectId } = request.params as { projectId?: string };
				return await evaluateAction(request.body.action, request.body.context, projectId);
			} catch (error) {
				return reply.code(500).send({ error: "Failed to evaluate action", message: String(error) });
			}
		},
	);
}
