/**
 * Notification Service — 24.H
 *
 * Manages notification channels and delivery preferences.
 *
 * Supports three delivery channels:
 *   - email:  Email delivery (requires SMTP configuration)
 *   - inbox:  Pi inbox messages
 *   - system: System/desktop notifications
 *
 * Each notification type can be routed to any combination of channels.
 * Users can enable/disable individual channels and configure per-type
 * routing rules.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Available notification delivery channels. */
export type NotificationChannel = "email" | "inbox" | "system";

/** Notification types that users can receive. */
export type NotificationType =
	| "plan_completed"
	| "plan_failed"
	| "task_completed"
	| "task_failed"
	| "approval_required"
	| "proposal_generated"
	| "goal_drift"
	| "memory_conflict"
	| "daemon_alert"
	| "brain_observation"
	| "warning"
	| "info";

/** All known notification types. */
export const ALL_NOTIFICATION_TYPES: NotificationType[] = [
	"plan_completed",
	"plan_failed",
	"task_completed",
	"task_failed",
	"approval_required",
	"proposal_generated",
	"goal_drift",
	"memory_conflict",
	"daemon_alert",
	"brain_observation",
	"warning",
	"info",
];

/** All available delivery channels. */
export const ALL_NOTIFICATION_CHANNELS: NotificationChannel[] = ["email", "inbox", "system"];

/** Per-channel routing rule for a notification type. */
export interface ChannelRule {
	email?: boolean;
	inbox?: boolean;
	system?: boolean;
}

/**
 * User notification preferences.
 *
 * The `channels` map controls whether each delivery channel is globally
 * enabled. The `rules` map provides per-type overrides. A notification
 * is delivered via a channel only when:
 *   1. The channel is globally enabled (channels[channel] === true), AND
 *   2. Either the type has no specific rule for that channel, or the type
 *      rule explicitly enables the channel (rules[type]?.[channel] !== false).
 */
export interface NotificationPreferences {
	/** Global enabled state — when false, no notifications are sent. */
	enabled: boolean;
	/** Per-channel global enablement. */
	channels: Record<NotificationChannel, boolean>;
	/** Per-type routing rule overrides. */
	rules: Partial<Record<NotificationType, ChannelRule>>;
}

/**
 * Partial notification preferences (for updates).
 * All fields are optional so callers only send what they want to change.
 */
export interface NotificationPreferencesUpdate {
	enabled?: boolean;
	channels?: Partial<Record<NotificationChannel, boolean>>;
	rules?: Partial<Record<NotificationType, Partial<Record<NotificationChannel, boolean>>>>;
}

/** A notification payload ready to be dispatched. */
export interface NotificationPayload {
	type: NotificationType;
	title: string;
	body: string;
	source?: string;
	actionUrl?: string;
	metadata?: Record<string, unknown>;
}

/** Default preferences when none have been saved yet. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
	enabled: true,
	channels: {
		email: false,
		inbox: true,
		system: true,
	},
	rules: {},
};

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

/**
 * NotificationService manages user notification preferences and dispatches
 * notifications through configured channels.
 */
export class NotificationService {
	private preferences: NotificationPreferences;

	constructor(initial?: Partial<NotificationPreferences>) {
		this.preferences = {
			...DEFAULT_NOTIFICATION_PREFERENCES,
			...initial,
			channels: {
				...DEFAULT_NOTIFICATION_PREFERENCES.channels,
				...initial?.channels,
			},
			rules: {
				...DEFAULT_NOTIFICATION_PREFERENCES.rules,
				...initial?.rules,
			},
		};
	}

	// ── Preferences ──────────────────────────────────────────────────

	/**
	 * Get a copy of the current notification preferences.
	 */
	getPreferences(): NotificationPreferences {
		return { ...this.preferences, channels: { ...this.preferences.channels }, rules: { ...this.preferences.rules } };
	}

	/**
	 * Update notification preferences (deep merge).
	 */
	updatePreferences(updates: NotificationPreferencesUpdate): NotificationPreferences {
		if (updates.enabled !== undefined) {
			this.preferences.enabled = updates.enabled;
		}
		if (updates.channels) {
			for (const [channel, enabled] of Object.entries(updates.channels)) {
				if (ALL_NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) {
					this.preferences.channels[channel as NotificationChannel] = enabled as boolean;
				}
			}
		}
		if (updates.rules) {
			for (const [type, rule] of Object.entries(updates.rules)) {
				if (ALL_NOTIFICATION_TYPES.includes(type as NotificationType)) {
					if (rule) {
						this.preferences.rules[type as NotificationType] = {
							...this.preferences.rules[type as NotificationType],
							...rule,
						};
					}
				}
			}
		}
		return this.getPreferences();
	}

	/**
	 * Reset preferences to defaults.
	 */
	resetPreferences(): NotificationPreferences {
		this.preferences = {
			...DEFAULT_NOTIFICATION_PREFERENCES,
			channels: { ...DEFAULT_NOTIFICATION_PREFERENCES.channels },
			rules: { ...DEFAULT_NOTIFICATION_PREFERENCES.rules },
		};
		return this.getPreferences();
	}

	// ── Channel Status ───────────────────────────────────────────────

	/**
	 * Get the list of available channels with their configuration status.
	 */
	getChannelStatus(): Array<{
		channel: NotificationChannel;
		name: string;
		description: string;
		enabled: boolean;
		configured: boolean;
	}> {
		return [
			{
				channel: "email",
				name: "Email",
				description: "Receive notifications via email",
				enabled: this.preferences.channels.email,
				configured: false, // Requires SMTP config — placeholder
			},
			{
				channel: "inbox",
				name: "Pi Inbox",
				description: "Receive notifications in the Pi inbox",
				enabled: this.preferences.channels.inbox,
				configured: true,
			},
			{
				channel: "system",
				name: "System Notification",
				description: "Receive desktop/system notifications",
				enabled: this.preferences.channels.system,
				configured: true,
			},
		];
	}

	// ── Dispatch ─────────────────────────────────────────────────────

	/**
	 * Determine which channels a notification should be delivered through
	 * based on current preferences.
	 */
	getActiveChannels(type: NotificationType): NotificationChannel[] {
		if (!this.preferences.enabled) {
			return [];
		}

		const typeRule = this.preferences.rules[type];

		return ALL_NOTIFICATION_CHANNELS.filter((channel) => {
			// Channel must be globally enabled
			if (!this.preferences.channels[channel]) {
				return false;
			}
			// If there's a per-type rule for this channel, respect it
			if (typeRule && typeRule[channel] !== undefined) {
				return typeRule[channel] === true;
			}
			// Default: deliver if channel is globally enabled
			return true;
		});
	}

	/**
	 * Dispatch a notification through all eligible channels.
	 * Returns the list of channels the notification was delivered to.
	 *
	 * In a production system, this would integrate with an email service
	 * (e.g., Nodemailer), write to the Pi inbox store, and send system
	 * notifications via the OS notification system or WebSocket.
	 */
	dispatch(payload: NotificationPayload): { channels: NotificationChannel[] } {
		const activeChannels = this.getActiveChannels(payload.type);

		for (const channel of activeChannels) {
			switch (channel) {
				case "email":
					// Placeholder: would send via SMTP/Nodemailer
					// Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS config
					break;
				case "inbox":
					// Placeholder: would write to PiInboxStore.push()
					break;
				case "system":
					// Placeholder: would emit via WebSocket or desktop notification
					break;
			}
		}

		return { channels: activeChannels };
	}
}
