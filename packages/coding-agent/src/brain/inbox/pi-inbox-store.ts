/**
 * PiInboxStore — In-memory store for Pi inbox messages.
 *
 * Provides CRUD operations for managing inbox messages:
 * - Push new messages from system components
 * - List messages with optional filters (type, priority, read status)
 * - Mark individual messages or all messages as read
 * - Delete individual messages or purge read messages
 * - Aggregate statistics
 */

import { randomUUID } from "node:crypto";
import type {
	PiInboxMessage,
	PiInboxMessagePriority,
	PiInboxMessageType,
	PiInboxStats,
} from "./types.js";
import { createPiInboxMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Query options for listing inbox messages. */
export interface PiInboxQuery {
	type?: PiInboxMessageType;
	priority?: PiInboxMessagePriority;
	read?: boolean;
	limit?: number;
	offset?: number;
	sortBy?: "createdAt" | "priority";
	sortDir?: "asc" | "desc";
}

/** Result of a list query. */
export interface PiInboxListResult {
	messages: PiInboxMessage[];
	total: number;
	unread: number;
}

/** Store configuration. */
export interface PiInboxStoreConfig {
	/** Maximum number of messages to retain (0 = unlimited). */
	maxMessages?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_MESSAGES = 1000;

// ---------------------------------------------------------------------------
// Priority weight for sorting
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<PiInboxMessagePriority, number> = {
	low: 0,
	normal: 1,
	high: 2,
	critical: 3,
};

// ---------------------------------------------------------------------------
// PiInboxStore
// ---------------------------------------------------------------------------

export class PiInboxStore {
	private messages: PiInboxMessage[] = [];
	private config: PiInboxStoreConfig;

	constructor(config: PiInboxStoreConfig = {}) {
		this.config = {
			maxMessages: config.maxMessages ?? DEFAULT_MAX_MESSAGES,
		};
	}

	// ── Push ──────────────────────────────────────────────────────────

	/**
	 * Push a new message into the inbox.
	 * If maxMessages is exceeded, the oldest messages are evicted.
	 *
	 * @param input - Message fields (type, title, body required, others optional)
	 * @returns The created message
	 */
	push(
		input: {
			type: PiInboxMessageType;
			title: string;
			body: string;
			priority?: PiInboxMessagePriority;
			source?: string;
			actionUrl?: string;
			metadata?: Record<string, unknown>;
		},
	): PiInboxMessage {
		const message = createPiInboxMessage({
			id: randomUUID(),
			type: input.type,
			title: input.title,
			body: input.body,
			priority: input.priority,
			source: input.source,
			actionUrl: input.actionUrl,
			metadata: input.metadata,
		});

		this.messages.unshift(message);

		// Evict oldest if over max
		const max = this.config.maxMessages ?? DEFAULT_MAX_MESSAGES;
		if (max > 0 && this.messages.length > max) {
			this.messages = this.messages.slice(0, max);
		}

		return message;
	}

	// ── List ──────────────────────────────────────────────────────────

	/**
	 * List messages with optional filtering, sorting, and pagination.
	 */
	list(query: PiInboxQuery = {}): PiInboxListResult {
		let filtered = [...this.messages];

		// Filter by type
		if (query.type) {
			filtered = filtered.filter((m) => m.type === query.type);
		}

		// Filter by priority
		if (query.priority) {
			filtered = filtered.filter((m) => m.priority === query.priority);
		}

		// Filter by read status
		if (query.read !== undefined) {
			filtered = filtered.filter((m) => m.read === query.read);
		}

		// Sort
		const sortBy = query.sortBy ?? "createdAt";
		const sortDir = query.sortDir ?? "desc";
		filtered.sort((a, b) => {
			let cmp: number;
			if (sortBy === "priority") {
				cmp = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
			} else {
				cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
			}
			return sortDir === "desc" ? -cmp : cmp;
		});

		const total = filtered.length;
		const unread = filtered.filter((m) => !m.read).length;

		// Paginate
		const offset = query.offset ?? 0;
		const limit = query.limit ?? 50;
		const messages = filtered.slice(offset, offset + limit);

		return { messages, total, unread };
	}

	// ── Get by ID ─────────────────────────────────────────────────────

	/**
	 * Get a single message by ID.
	 * Returns undefined if not found.
	 */
	get(id: string): PiInboxMessage | undefined {
		return this.messages.find((m) => m.id === id);
	}

	// ── Mark as Read ──────────────────────────────────────────────────

	/**
	 * Mark a single message as read.
	 * Returns the updated message, or undefined if not found.
	 */
	markRead(id: string): PiInboxMessage | undefined {
		const message = this.messages.find((m) => m.id === id);
		if (!message) return undefined;
		if (!message.read) {
			message.read = true;
			message.readAt = new Date().toISOString();
		}
		return message;
	}

	// ── Mark All as Read ──────────────────────────────────────────────

	/**
	 * Mark all messages as read.
	 * Returns the number of messages that were marked read.
	 */
	markAllRead(): number {
		let count = 0;
		const now = new Date().toISOString();
		for (const message of this.messages) {
			if (!message.read) {
				message.read = true;
				message.readAt = now;
				count++;
			}
		}
		return count;
	}

	// ── Delete ────────────────────────────────────────────────────────

	/**
	 * Delete a single message by ID.
	 * Returns true if the message was deleted, false if not found.
	 */
	delete(id: string): boolean {
		const idx = this.messages.findIndex((m) => m.id === id);
		if (idx === -1) return false;
		this.messages.splice(idx, 1);
		return true;
	}

	// ── Purge Read ────────────────────────────────────────────────────

	/**
	 * Delete all read messages.
	 * Returns the number of messages purged.
	 */
	purgeRead(): number {
		const before = this.messages.length;
		this.messages = this.messages.filter((m) => !m.read);
		return before - this.messages.length;
	}

	// ── Clear All ─────────────────────────────────────────────────────

	/**
	 * Delete all messages from the inbox.
	 */
	clear(): void {
		this.messages = [];
	}

	// ── Stats ─────────────────────────────────────────────────────────

	/**
	 * Get aggregate statistics for the inbox.
	 */
	stats(): PiInboxStats {
		const byType: Record<string, number> = {};
		const byPriority: Record<string, number> = {};
		let unread = 0;

		for (const message of this.messages) {
			byType[message.type] = (byType[message.type] ?? 0) + 1;
			byPriority[message.priority] = (byPriority[message.priority] ?? 0) + 1;
			if (!message.read) unread++;
		}

		return {
			total: this.messages.length,
			unread,
			byType,
			byPriority,
		};
	}

	// ── Seed (for development/testing) ────────────────────────────────

	/**
	 * Seed the inbox with sample messages.
	 * Only adds messages if the inbox is empty.
	 */
	seed(): void {
		if (this.messages.length > 0) return;

		const sampleMessages: Array<{
			type: PiInboxMessageType;
			title: string;
			body: string;
			priority: PiInboxMessagePriority;
			source?: string;
		}> = [
			{
				type: "info",
				title: "Welcome to Pi Inbox",
				body: "This is your message center. System notifications, alerts, and updates will appear here.",
				priority: "normal",
				source: "system",
			},
			{
				type: "daemon_alert",
				title: "Brain daemon started",
				body: "The brain observation engine has started and is monitoring system state.",
				priority: "normal",
				source: "brain",
			},
			{
				type: "plan_completed",
				title: "Plan execution completed",
				body: 'Plan "Refactor auth module" has completed successfully. All workspaces finished without errors.',
				priority: "normal",
				source: "execution",
			},
			{
				type: "memory_conflict",
				title: "Memory conflict detected",
				body: "Two memory records with conflicting information were found. Review recommended.",
				priority: "high",
				source: "brain",
			},
			{
				type: "proposal_generated",
				title: "New proposal: Add rate limiting",
				body: "The brain has generated a proposal to add rate limiting to the API gateway. Score: 0.85.",
				priority: "low",
				source: "brain",
			},
		];

		for (const msg of sampleMessages) {
			this.push(msg);
		}
	}
}
