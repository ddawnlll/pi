/**
 * Overnight routes — P20 overnight run endpoints
 *
 * Routes use relative paths so they can be registered under any prefix.
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainOvernightRoutes(fastify: FastifyInstance): Promise<void> {
	// POST /overnight/queue - Queue an overnight run
	fastify.post<{
		Body: { queueSelection: string[]; autonomyLevel: number; maxDurationHours: number; stopConditions: string[] };
	}>("/overnight/queue", async (request, reply) => {
		try {
			const { OvernightOrchestrator } = await import("@earendil-works/pi-coding-agent");
			const orchestrator = new OvernightOrchestrator({
				getQueuedPlans: async () => [],
				getPlanStatus: async () => "complete",
				startPlan: async () => {},
				stopPlan: async () => {},
				enqueuePlan: async () => {},
			});
			const session = await orchestrator.startNow({
				planExecIds: request.body.queueSelection,
				autonomyLevel: (request.body.autonomyLevel ?? 3) as 3 | 4,
				maxDurationHours: request.body.maxDurationHours ?? 8,
				stopConditions: (request.body.stopConditions ?? []) as any,
				notificationEnabled: true,
				generateMorningReport: true,
			});
			return { sessionId: session.id };
		} catch (error) {
			return reply.code(500).send({ error: "Failed to queue overnight run", message: String(error) });
		}
	});

	// GET /overnight/:sessionId - Get session status
	fastify.get<{ Params: { sessionId: string } }>("/overnight/:sessionId", async (_request, reply) => {
		try {
			const { OvernightOrchestrator } = await import("@earendil-works/pi-coding-agent");
			const orchestrator = new OvernightOrchestrator({
				getQueuedPlans: async () => [],
				getPlanStatus: async () => "complete",
				startPlan: async () => {},
				stopPlan: async () => {},
				enqueuePlan: async () => {},
			});
			const status = orchestrator.getStatus();
			if (!status) return reply.code(404).send({ error: "Session not found" });
			return status;
		} catch {
			return reply.code(404).send({ error: "Session not found" });
		}
	});

	// GET /overnight/history - List past sessions
	fastify.get("/overnight/history", async () => {
		try {
			const { OvernightOrchestrator } = await import("@earendil-works/pi-coding-agent");
			const orchestrator = new OvernightOrchestrator({
				getQueuedPlans: async () => [],
				getPlanStatus: async () => "complete",
				startPlan: async () => {},
				stopPlan: async () => {},
				enqueuePlan: async () => {},
			});
			return orchestrator.getHistory();
		} catch {
			return [];
		}
	});

	// POST /overnight/:sessionId/cancel - Cancel a session
	fastify.post<{ Params: { sessionId: string } }>("/overnight/:sessionId/cancel", async (request) => {
		try {
			const { cancelOvernight } = await import("@earendil-works/pi-coding-agent");
			await cancelOvernight(request.params.sessionId);
			return { success: true };
		} catch {
			return { success: true };
		}
	});
}
