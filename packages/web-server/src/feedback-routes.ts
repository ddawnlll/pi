/**
 * Feedback Routes — 24.J
 *
 * REST API for user feedback on brain-generated items: ratings (thumbs
 * up/down) and corrective comments that can teach Pi what to do
 * differently.
 *
 * Endpoints:
 *   POST   /api/brain/feedback          — Submit feedback
 *   GET    /api/brain/feedback          — List feedback with optional filters
 *   GET    /api/brain/feedback/stats    — Aggregate feedback statistics
 *   GET    /api/brain/feedback/:id      — Get single feedback entry
 *   PATCH  /api/brain/feedback/:id      — Update feedback entry
 *   DELETE /api/brain/feedback/:id      — Delete a feedback entry
 *
 * All routes are safe to register under any prefix. When registered under
 * /api/brain, they become /api/brain/feedback/.... When registered under
 * /api/projects/:projectId/brain, they become
 * /api/projects/:projectId/brain/feedback/...
 *
 * Error states:
 * - 400: Invalid request body (validation errors)
 * - 404: Feedback entry not found
 * - 500: Internal server error
 */

import type { FeedbackEntry, FeedbackQuery } from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// In-memory store singleton imported lazily to avoid eager initialization
// ---------------------------------------------------------------------------

let store: import("@earendil-works/pi-coding-agent").FeedbackStore | null = null;

async function getStore(): Promise<import("@earendil-works/pi-coding-agent").FeedbackStore> {
	if (!store) {
		const { FeedbackStore } = await import("@earendil-works/pi-coding-agent");
		store = new FeedbackStore();
	}
	return store;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerFeedbackRoutes(fastify: FastifyInstance): Promise<void> {
	// POST /feedback — Submit feedback
	fastify.post<{
		Body: {
			itemType: string;
			itemId: string;
			itemTitle: string;
			rating: 1 | -1;
			comment?: string;
		};
	}>("/feedback", async (request, reply) => {
		try {
			const { itemType, itemId, itemTitle, rating, comment } = request.body;

			if (!itemType || !itemId || !itemTitle || (rating !== 1 && rating !== -1)) {
				return reply.code(400).send({
					error: "Invalid feedback data",
					details: "itemType, itemId, itemTitle, and rating (1 or -1) are required",
				});
			}

			const s = await getStore();
			const entry = s.add({
				itemType: itemType as import("@earendil-works/pi-coding-agent").FeedbackItemType,
				itemId,
				itemTitle,
				rating,
				comment: comment ?? "",
			});

			return reply.code(201).send(entry);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to submit feedback", details: message });
		}
	});

	// GET /feedback — List feedback entries with optional filters
	fastify.get<{
		Querystring: {
			itemType?: string;
			itemId?: string;
			rating?: string;
			applied?: string;
			limit?: string;
			offset?: string;
			sortBy?: string;
			sortDir?: string;
		};
	}>("/feedback", async (request, reply) => {
		try {
			const s = await getStore();

			const query: FeedbackQuery = {};
			if (request.query.itemType) query.itemType = request.query.itemType as any;
			if (request.query.itemId) query.itemId = request.query.itemId;
			if (request.query.rating) query.rating = Number(request.query.rating) as 1 | -1;
			if (request.query.applied !== undefined) query.applied = request.query.applied === "true";
			if (request.query.limit) query.limit = Number(request.query.limit);
			if (request.query.offset) query.offset = Number(request.query.offset);
			if (request.query.sortBy) query.sortBy = request.query.sortBy as "createdAt" | "updatedAt" | "rating";
			if (request.query.sortDir) query.sortDir = request.query.sortDir as "asc" | "desc";

			const result = s.query(query);
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to query feedback", details: message });
		}
	});

	// GET /feedback/stats — Aggregate feedback statistics
	fastify.get("/feedback/stats", async (_request, reply) => {
		try {
			const s = await getStore();
			return s.getStats();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to get feedback stats", details: message });
		}
	});

	// GET /feedback/:id — Get a single feedback entry
	fastify.get<{
		Params: { id: string };
	}>("/feedback/:id", async (request, reply) => {
		try {
			const s = await getStore();
			const entry = s.get(request.params.id);

			if (!entry) {
				return reply.code(404).send({ error: "Feedback entry not found" });
			}

			return entry;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to get feedback", details: message });
		}
	});

	// PATCH /feedback/:id — Update a feedback entry
	fastify.patch<{
		Params: { id: string };
		Body: {
			rating?: 1 | -1;
			comment?: string;
			applied?: boolean;
		};
	}>("/feedback/:id", async (request, reply) => {
		try {
			const s = await getStore();
			const updates: Partial<Pick<FeedbackEntry, "rating" | "comment" | "applied">> = {};

			if (request.body.rating !== undefined) {
				if (request.body.rating !== 1 && request.body.rating !== -1) {
					return reply.code(400).send({ error: "rating must be 1 or -1" });
				}
				updates.rating = request.body.rating;
			}
			if (request.body.comment !== undefined) {
				updates.comment = request.body.comment;
			}
			if (request.body.applied !== undefined) {
				updates.applied = request.body.applied;
			}

			const updated = s.update(request.params.id, updates);
			if (!updated) {
				return reply.code(404).send({ error: "Feedback entry not found" });
			}

			return updated;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to update feedback", details: message });
		}
	});

	// DELETE /feedback/:id — Delete a feedback entry
	fastify.delete<{
		Params: { id: string };
	}>("/feedback/:id", async (request, reply) => {
		try {
			const s = await getStore();
			const deleted = s.delete(request.params.id);

			if (!deleted) {
				return reply.code(404).send({ error: "Feedback entry not found" });
			}

			return reply.code(204).send();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return reply.code(500).send({ error: "Failed to delete feedback", details: message });
		}
	});
}
