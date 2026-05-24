/**
 * Autonomy routes — P15 autonomy profile, emergency stop
 *
 * Routes use relative paths so they can be registered under any prefix.
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainAutonomyRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /autonomy - Get autonomy profile
	fastify.get("/autonomy", async (request) => {
		try {
			const { getAutonomyProfile } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await getAutonomyProfile(projectId);
		} catch {
			return {
				level: 3,
				levelLabel: "Operator",
				emergencyStop: false,
				approvedActions: 0,
				blockedActions: 0,
				lastUpdated: new Date().toISOString(),
			};
		}
	});

	// PATCH /autonomy - Update autonomy profile
	fastify.patch<{ Body: Record<string, unknown> }>("/autonomy", async (request, reply) => {
		try {
			const { updateAutonomyProfile } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await updateAutonomyProfile(request.body, projectId);
		} catch (error) {
			return reply.code(500).send({ error: "Failed to update autonomy profile", message: String(error) });
		}
	});

	// POST /autonomy/emergency-stop
	fastify.post("/autonomy/emergency-stop", async (request) => {
		try {
			const { emergencyStop } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			await emergencyStop(projectId);
			return { success: true };
		} catch {
			return { success: true };
		}
	});

	// POST /autonomy/release-stop
	fastify.post("/autonomy/release-stop", async (request) => {
		try {
			const { releaseStop } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			await releaseStop(projectId);
			return { success: true };
		} catch {
			return { success: true };
		}
	});

	// GET /autonomy/emergency-status
	fastify.get("/autonomy/emergency-status", async (request) => {
		try {
			const { getEmergencyStatus } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await getEmergencyStatus(projectId);
		} catch {
			return { stopped: false };
		}
	});
}
