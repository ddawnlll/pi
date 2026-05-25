/**
 * Pi Inbox Types — Message types for the Pi inbox and message center.
 *
 * The Pi inbox aggregates system messages from various sources:
 * daemon alerts, brain observations, plan completions, proposal
 * generations, memory conflicts, goal drifts, and approval requests.
 *
 * Messages have a type, priority, read/unread state, and optional
 * metadata for routing to specific views.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Enums / Union Types
// ---------------------------------------------------------------------------

/**
 * Categories of messages that can appear in the Pi inbox.
 */
export type PiInboxMessageType =
	| "system_notification"
	| "daemon_alert"
	| "brain_observation"
	| "proposal_generated"
	| "plan_completed"
	| "plan_failed"
	| "task_completed"
	| "memory_conflict"
	| "goal_drift"
	| "approval_required"
	| "warning"
	| "info";

/**
 * Priority levels for inbox messages.
 */
export type PiInboxMessagePriority = "low" | "normal" | "high" | "critical";

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

/**
 * A single message in the Pi inbox.
 */
export interface PiInboxMessage {
	/** Unique identifier (UUID v4). */
	id: string;
	/** Message category type. */
	type: PiInboxMessageType;
	/** Short human-readable title. */
	title: string;
	/** Longer human-readable body content. */
	body: string;
	/** Priority level determining visual prominence. */
	priority: PiInboxMessagePriority;
	/** Whether the message has been read. */
	read: boolean;
	/** ISO 8601 timestamp of when the message was created. */
	createdAt: string;
	/** ISO 8601 timestamp of when the message was read, if applicable. */
	readAt?: string;
	/** Optional arbitrary metadata for context/action routing. */
	metadata?: Record<string, unknown>;
	/** Optional source system component label. */
	source?: string;
	/** Optional URL/path for taking action on this message. */
	actionUrl?: string;
}

/**
 * Aggregate statistics for the Pi inbox.
 */
export interface PiInboxStats {
	/** Total number of messages. */
	total: number;
	/** Number of unread messages. */
	unread: number;
	/** Count of messages grouped by type. */
	byType: Record<string, number>;
	/** Count of messages grouped by priority. */
	byPriority: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid PiInboxMessageType values. */
export const ALL_PI_INBOX_MESSAGE_TYPES: PiInboxMessageType[] = [
	"system_notification",
	"daemon_alert",
	"brain_observation",
	"proposal_generated",
	"plan_completed",
	"plan_failed",
	"task_completed",
	"memory_conflict",
	"goal_drift",
	"approval_required",
	"warning",
	"info",
];

/** All valid PiInboxMessagePriority values. */
export const ALL_PI_INBOX_PRIORITIES: PiInboxMessagePriority[] = [
	"low",
	"normal",
	"high",
	"critical",
];

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a new PiInboxMessage with defaults applied.
 */
export function createPiInboxMessage(
	overrides: Omit<Partial<PiInboxMessage>, "type" | "title" | "body"> & {
		type: PiInboxMessageType;
		title: string;
		body: string;
		priority?: PiInboxMessagePriority;
	},
): PiInboxMessage {
	return {
		id: randomUUID(),
		priority: "normal",
		read: false,
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Result of a type validation check.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate a PiInboxMessage object.
 * Returns a ValidationResult with any errors found.
 */
export function validatePiInboxMessage(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const msg = value as Record<string, unknown>;

	if (typeof msg.id !== "string" || msg.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!ALL_PI_INBOX_MESSAGE_TYPES.includes(msg.type as PiInboxMessageType)) {
		errors.push(`type must be one of: ${ALL_PI_INBOX_MESSAGE_TYPES.join(", ")}`);
	}
	if (typeof msg.title !== "string" || msg.title.length === 0) {
		errors.push("title must be a non-empty string");
	}
	if (typeof msg.body !== "string") {
		errors.push("body must be a string");
	}
	if (!ALL_PI_INBOX_PRIORITIES.includes(msg.priority as PiInboxMessagePriority)) {
		errors.push(`priority must be one of: ${ALL_PI_INBOX_PRIORITIES.join(", ")}`);
	}
	if (typeof msg.read !== "boolean") {
		errors.push("read must be a boolean");
	}

	return { valid: errors.length === 0, errors };
}
