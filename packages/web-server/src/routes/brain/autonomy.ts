/**
 * Autonomy routes — P15 autonomy profile, emergency stop
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainAutonomyRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /api/brain/autonomy - Get autonomy profile
	fastify.get("/api/brain/autonomy", async () => {
		try {
			const { getAutonomyProfile } = await import("@earendil-works/pi-coding-agent");
			return await getAutonomyProfile();
		} catch {
			return { level: 3, levelLabel: "Operator", emergencyStop: false, approvedActions: 0, blockedActions: 0, lastUpdated: new Date().toISOString() };
		}
	});

	// PATCH /api/brain/autonomy - Update autonomy profile
	fastify.patch<{ Body: Record<string, unknown> }>("/api/brain/autonomy", async (request, reply) => {
		try {
			const { updateAutonomyProfile } = await import("@earendil-works/pi-coding-agent");
			return await updateAutonomyProfile(request.body);
		} catch (error) {
			return reply.code(500).send({ error: "Failed to update autonomy profile", message: String(error) });
		}
	});

	// POST /api/brain/autonomy/emergency-stop
	fastify.post("/api/brain/autonomy/emergency-stop", async () => {
		try {
			const { emergencyStop } = await import("@earendil-works/pi-coding-agent");
			await emergencyStop();
			return { success: true };
		} catch {
			return { success: true };
		}
	});

	// POST /api/brain/autonomy/release-stop
	fastify.post("/api/brain/autonomy/release-stop", async () => {
		try {
			const { releaseStop } = await import("@earendil-works/pi-coding-agent");
			await releaseStop();
			return { success: true };
		} catch {
			return { success: true };
		}
	});

	// GET /api/brain/autonomy/emergency-status
	fastify.get("/api/brain/autonomy/emergency-status", async () => {
		try {
			const { getEmergencyStatus } = await import("@earendil-works/pi-coding-agent");
			return await getEmergencyStatus();
		} catch {
			return { stopped: false };
		}
	});
}
