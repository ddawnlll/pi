/**
 * Notification Routes — 24.H
 *
 * REST API for notification channel configuration and delivery preferences.
 *
 * Endpoints:
 *   GET    /api/notifications/preferences      — Get current notification preferences
 *   PUT    /api/notifications/preferences      — Update notification preferences
 *   POST   /api/notifications/preferences/reset — Reset preferences to defaults
 *   GET    /api/notifications/channels         — List available notification channels
 *   POST   /api/notifications/dispatch         — Dispatch a notification (system use)
 *
 * Error states:
 *   - 400: Invalid request body (validation errors)
 *   - 500: Internal server error
 */

import type { FastifyInstance } from "fastify";
import type { NotificationChannel, NotificationType } from "./notification-service.js";
import { ALL_NOTIFICATION_CHANNELS, ALL_NOTIFICATION_TYPES, NotificationService } from "./notification-service.js";
import type { NotificationPreferencesUpdate } from "./notification-service.js";

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let service: NotificationService | null = null;

function getService(): NotificationService {
	if (!service) {
		service = new NotificationService();
	}
	return service;
}

/**
 * Reset the singleton service (useful for testing).
 */
export function resetNotificationService(): void {
	service = null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateChannel(value: unknown): value is NotificationChannel {
	return ALL_NOTIFICATION_CHANNELS.includes(value as NotificationChannel);
}

function validateType(value: unknown): value is NotificationType {
	return ALL_NOTIFICATION_TYPES.includes(value as NotificationType);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerNotificationRoutes(fastify: FastifyInstance): Promise<void> {
	const svc = getService();

	// -----------------------------------------------------------------------
	// GET /api/notifications/preferences — Get current preferences
	// -----------------------------------------------------------------------

	fastify.get("/api/notifications/preferences", async (_request, reply) => {
		try {
			const preferences = svc.getPreferences();
			return reply.send({ success: true, preferences });
		} catch (error) {
			fastify.log.error({ error }, "Failed to get notification preferences");
			return reply.code(500).send({
				success: false,
				error: "Failed to get notification preferences",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// PUT /api/notifications/preferences — Update preferences
	// -----------------------------------------------------------------------

	fastify.put<{
		Body: NotificationPreferencesUpdate;
	}>("/api/notifications/preferences", async (request, reply) => {
		try {
			const { enabled, channels, rules } = request.body;

			// Validate channel keys if provided
			if (channels) {
				for (const ch of Object.keys(channels)) {
					if (!validateChannel(ch)) {
						return reply.code(400).send({
							success: false,
							error: `Invalid channel: "${ch}". Valid channels: ${ALL_NOTIFICATION_CHANNELS.join(", ")}`,
						});
					}
				}
			}

			// Validate type keys if provided
			if (rules) {
				for (const nt of Object.keys(rules)) {
					if (!validateType(nt)) {
						return reply.code(400).send({
							success: false,
							error: `Invalid notification type: "${nt}". Valid types: ${ALL_NOTIFICATION_TYPES.join(", ")}`,
						});
					}
				}
			}

			const update: NotificationPreferencesUpdate = {};
			if (enabled !== undefined) update.enabled = enabled;
			if (channels !== undefined) update.channels = channels;
			if (rules !== undefined) update.rules = rules;
			const updated = svc.updatePreferences(update);

			return reply.send({ success: true, preferences: updated });
		} catch (error) {
			fastify.log.error({ error }, "Failed to update notification preferences");
			return reply.code(500).send({
				success: false,
				error: "Failed to update notification preferences",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/notifications/preferences/reset — Reset to defaults
	// -----------------------------------------------------------------------

	fastify.post("/api/notifications/preferences/reset", async (_request, reply) => {
		try {
			const preferences = svc.resetPreferences();
			return reply.send({ success: true, preferences });
		} catch (error) {
			fastify.log.error({ error }, "Failed to reset notification preferences");
			return reply.code(500).send({
				success: false,
				error: "Failed to reset notification preferences",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/notifications/channels — List available channels
	// -----------------------------------------------------------------------

	fastify.get("/api/notifications/channels", async (_request, reply) => {
		try {
			const channels = svc.getChannelStatus();
			return reply.send({ success: true, channels });
		} catch (error) {
			fastify.log.error({ error }, "Failed to get notification channels");
			return reply.code(500).send({
				success: false,
				error: "Failed to get notification channels",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/notifications/dispatch — Dispatch a notification
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			type: NotificationType;
			title: string;
			body: string;
			source?: string;
			actionUrl?: string;
			metadata?: Record<string, unknown>;
		};
	}>("/api/notifications/dispatch", async (request, reply) => {
		try {
			const { type, title, body, source, actionUrl, metadata } = request.body;

			// Validate required fields
			if (!type || !title || !body) {
				return reply.code(400).send({
					success: false,
					error: "Missing required fields: type, title, body",
				});
			}

			if (!validateType(type)) {
				return reply.code(400).send({
					success: false,
					error: `Invalid notification type: "${type}". Valid types: ${ALL_NOTIFICATION_TYPES.join(", ")}`,
				});
			}

			const result = svc.dispatch({ type, title, body, source, actionUrl, metadata });
			return reply.send({
				success: true,
				channels: result.channels,
				message: result.channels.length > 0
					? `Notification dispatched via: ${result.channels.join(", ")}`
					: "Notification was not dispatched — no active channels or notifications are disabled",
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to dispatch notification");
			return reply.code(500).send({
				success: false,
				error: "Failed to dispatch notification",
				message: String(error),
			});
		}
	});
}
