/**
 * Pi Inbox Routes — REST API for the Pi inbox and message center (24.M).
 *
 * Endpoints:
 *   GET    /api/pi/inbox         — List inbox messages (with optional filters)
 *   GET    /api/pi/inbox/stats   — Get inbox aggregate statistics
 *   GET    /api/pi/inbox/:id     — Get a single message
 *   POST   /api/pi/inbox         — Push a new message (system use)
 *   POST   /api/pi/inbox/:id/read     — Mark a single message as read
 *   POST   /api/pi/inbox/read-all     — Mark all messages as read
 *   DELETE /api/pi/inbox/:id          — Delete a single message
 *   POST   /api/pi/inbox/purge-read   — Delete all read messages
 *   POST   /api/pi/inbox/clear        — Clear all messages
 */

import type { FastifyInstance } from "fastify";
import type { PiInboxStore } from "@earendil-works/pi-coding-agent";
import type {
	PiInboxMessagePriority,
	PiInboxMessageType,
} from "@earendil-works/pi-coding-agent";

/**
 * Register Pi inbox routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param inboxStore - The PiInboxStore singleton instance
 */
export async function registerPiInboxRoutes(
	fastify: FastifyInstance,
	inboxStore: PiInboxStore,
): Promise<void> {
	// Seed the inbox with sample messages on first use
	inboxStore.seed();

	// -----------------------------------------------------------------------
	// GET /api/pi/inbox — List messages
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			type?: PiInboxMessageType;
			priority?: PiInboxMessagePriority;
			read?: string;
			limit?: string;
			offset?: string;
			sortBy?: "createdAt" | "priority";
			sortDir?: "asc" | "desc";
		};
	}>("/api/pi/inbox", async (request, reply) => {
		try {
			const type = request.query.type as PiInboxMessageType | undefined;
			const priority = request.query.priority as PiInboxMessagePriority | undefined;
			const read = request.query.read !== undefined ? request.query.read === "true" : undefined;
			const limit = request.query.limit ? Math.min(Math.max(Number(request.query.limit), 1), 200) : 50;
			const offset = request.query.offset ? Math.max(Number(request.query.offset), 0) : 0;
			const sortBy = request.query.sortBy ?? "createdAt";
			const sortDir = request.query.sortDir ?? "desc";

			const result = inboxStore.list({
				type,
				priority,
				read,
				limit,
				offset,
				sortBy,
				sortDir,
			});

			return reply.send({
				success: true,
				messages: result.messages,
				total: result.total,
				unread: result.unread,
				limit,
				offset,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list inbox messages");
			return reply.code(500).send({
				success: false,
				error: "Failed to list inbox messages",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/pi/inbox/stats — Get inbox statistics
	// -----------------------------------------------------------------------

	fastify.get("/api/pi/inbox/stats", async (_request, reply) => {
		try {
			const stats = inboxStore.stats();
			return reply.send({
				success: true,
				stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get inbox stats");
			return reply.code(500).send({
				success: false,
				error: "Failed to get inbox stats",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/pi/inbox/:id — Get a single message
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/api/pi/inbox/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const message = inboxStore.get(id);

			if (!message) {
				return reply.code(404).send({
					success: false,
					error: `Message "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
				message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get inbox message");
			return reply.code(500).send({
				success: false,
				error: "Failed to get inbox message",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/pi/inbox — Push a new message
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			type: PiInboxMessageType;
			title: string;
			body: string;
			priority?: PiInboxMessagePriority;
			source?: string;
			actionUrl?: string;
			metadata?: Record<string, unknown>;
		};
	}>("/api/pi/inbox", async (request, reply) => {
		try {
			const { type, title, body, priority, source, actionUrl, metadata } = request.body;

			// Validate required fields
			if (!type || !title || !body) {
				return reply.code(400).send({
					success: false,
					error: "Missing required fields: type, title, body",
				});
			}

			const message = inboxStore.push({
				type,
				title,
				body,
				priority,
				source,
				actionUrl,
				metadata,
			});

			return reply.code(201).send({
				success: true,
				message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to push inbox message");
			return reply.code(500).send({
				success: false,
				error: "Failed to push inbox message",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/pi/inbox/:id/read — Mark a message as read
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
	}>("/api/pi/inbox/:id/read", async (request, reply) => {
		try {
			const { id } = request.params;
			const message = inboxStore.markRead(id);

			if (!message) {
				return reply.code(404).send({
					success: false,
					error: `Message "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
				message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to mark message as read");
			return reply.code(500).send({
				success: false,
				error: "Failed to mark message as read",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/pi/inbox/read-all — Mark all messages as read
	// -----------------------------------------------------------------------

	fastify.post("/api/pi/inbox/read-all", async (_request, reply) => {
		try {
			const count = inboxStore.markAllRead();
			return reply.send({
				success: true,
				count,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to mark all as read");
			return reply.code(500).send({
				success: false,
				error: "Failed to mark all as read",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// DELETE /api/pi/inbox/:id — Delete a message
	// -----------------------------------------------------------------------

	fastify.delete<{
		Params: { id: string };
	}>("/api/pi/inbox/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const deleted = inboxStore.delete(id);

			if (!deleted) {
				return reply.code(404).send({
					success: false,
					error: `Message "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to delete inbox message");
			return reply.code(500).send({
				success: false,
				error: "Failed to delete inbox message",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/pi/inbox/purge-read — Delete all read messages
	// -----------------------------------------------------------------------

	fastify.post("/api/pi/inbox/purge-read", async (_request, reply) => {
		try {
			const count = inboxStore.purgeRead();
			return reply.send({
				success: true,
				count,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to purge read messages");
			return reply.code(500).send({
				success: false,
				error: "Failed to purge read messages",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/pi/inbox/clear — Clear all messages
	// -----------------------------------------------------------------------

	fastify.post("/api/pi/inbox/clear", async (_request, reply) => {
		try {
			inboxStore.clear();
			return reply.send({
				success: true,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to clear inbox");
			return reply.code(500).send({
				success: false,
				error: "Failed to clear inbox",
				message: String(error),
			});
		}
	});
}
