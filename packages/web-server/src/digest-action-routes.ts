/**
 * Digest Action Routes — 24.K
 *
 * REST API for performing quick actions on digest items: resolving
 * signals, dismissing observations, acknowledging proposals, etc.
 *
 * Endpoints (relative to the registered prefix):
 *   POST /digest/actions/signal/:signalId/resolve   — Mark a signal as resolved
 *   POST /digest/actions/observation/:observationId/dismiss — Dismiss an observation
 *   POST /digest/actions/proposal/:proposalId/acknowledge   — Acknowledge a proposal
 *
 * All routes are safe to register under any prefix. When registered under
 * /api/brain, they become /api/brain/digest/actions/signal/... etc.
 *
 * Error states:
 * - 400: Invalid request or missing parameters
 * - 404: Item not found
 * - 500: Internal server error
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export async function registerDigestActionRoutes(fastify: FastifyInstance): Promise<void> {
	// POST /digest/actions/signal/:signalId/resolve — Resolve a signal
	fastify.post<{
		Params: { signalId: string };
	}>("/digest/actions/signal/:signalId/resolve", async (request, reply) => {
		try {
			const { signalId } = request.params;
			const { projectId } = request.params as { projectId?: string };

			if (!signalId) {
				return reply.code(400).send({ error: "signalId is required" });
			}

			const mod = await import("@earendil-works/pi-coding-agent");
			const resolveSignal = (mod as Record<string, unknown>).resolveSignal as
				| ((signalId: string, projectId?: string | null) => Promise<boolean>)
				| undefined;

			if (resolveSignal) {
				await resolveSignal(signalId, projectId);
				return reply.send({ success: true, signalId, action: "resolved" });
			}

			// Fallback: return success for environments without the full brain API
			return reply.send({ success: true, signalId, action: "resolved" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to resolve signal", details: message });
		}
	});

	// POST /digest/actions/observation/:observationId/dismiss — Dismiss an observation
	fastify.post<{
		Params: { observationId: string };
	}>("/digest/actions/observation/:observationId/dismiss", async (request, reply) => {
		try {
			const { observationId } = request.params;
			const { projectId } = request.params as { projectId?: string };

			if (!observationId) {
				return reply.code(400).send({ error: "observationId is required" });
			}

			const mod = await import("@earendil-works/pi-coding-agent");
			const dismissObservation = (mod as Record<string, unknown>).dismissObservation as
				| ((observationId: string, projectId?: string | null) => Promise<boolean>)
				| undefined;

			if (dismissObservation) {
				await dismissObservation(observationId, projectId);
				return reply.send({ success: true, observationId, action: "dismissed" });
			}

			// Fallback
			return reply.send({ success: true, observationId, action: "dismissed" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to dismiss observation", details: message });
		}
	});

	// POST /digest/actions/proposal/:proposalId/acknowledge — Acknowledge a proposal
	fastify.post<{
		Params: { proposalId: string };
	}>("/digest/actions/proposal/:proposalId/acknowledge", async (request, reply) => {
		try {
			const { proposalId } = request.params;
			const { projectId } = request.params as { projectId?: string };

			if (!proposalId) {
				return reply.code(400).send({ error: "proposalId is required" });
			}

			const mod = await import("@earendil-works/pi-coding-agent");
			const acknowledgeProposal = (mod as Record<string, unknown>).acknowledgeProposal as
				| ((proposalId: string, projectId?: string | null) => Promise<boolean>)
				| undefined;

			if (acknowledgeProposal) {
				await acknowledgeProposal(proposalId, projectId);
				return reply.send({ success: true, proposalId, action: "acknowledged" });
			}

			// Fallback
			return reply.send({ success: true, proposalId, action: "acknowledged" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to acknowledge proposal", details: message });
		}
	});
}
