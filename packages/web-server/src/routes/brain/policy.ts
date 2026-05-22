/**
 * Policy routes — P18 policy rules endpoints
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainPolicyRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /api/brain/policy/rules - List policy rules
	fastify.get("/api/brain/policy/rules", async () => {
		try {
			const { getPolicyRules } = await import("@earendil-works/pi-coding-agent");
			return await getPolicyRules();
		} catch {
			return [];
		}
	});

	// POST /api/brain/policy/rules/:id/toggle - Toggle a rule
	fastify.post<{ Params: { id: string } }>("/api/brain/policy/rules/:id/toggle", async (request, reply) => {
		try {
			const { toggleRule } = await import("@earendil-works/pi-coding-agent");
			return await toggleRule(request.params.id);
		} catch {
			return reply.code(404).send({ error: "Rule not found" });
		}
	});

	// POST /api/brain/policy/evaluate - Evaluate an action against policy
	fastify.post<{ Body: { action: string; context?: Record<string, unknown> } }>(
		"/api/brain/policy/evaluate",
		async (request, reply) => {
			try {
				const { evaluateAction } = await import("@earendil-works/pi-coding-agent");
				return await evaluateAction(request.body.action, request.body.context);
			} catch (error) {
				return reply.code(500).send({ error: "Failed to evaluate action", message: String(error) });
			}
		},
	);
}
