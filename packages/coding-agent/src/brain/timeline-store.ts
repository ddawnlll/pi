/**
 * Brain Timeline Store
 *
 * Persistence layer for the brain timeline append-only event log.
 *
 * Provides an in-memory implementation with optional JSON file persistence
 * so that timeline events survive process restarts.
 *
 * Timeline events are stored in chronological order and support
 * querying by event type, severity, time range, and workspace context.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BrainTimelineEvent, Severity, TimelineEventType } from "./types.js";
import { validateBrainTimelineEvent } from "./types.js";

// ─────────────────────────────────────────────────────────────────────
// Query options
// ─────────────────────────────────────────────────────────────────────

/**
 * Options for querying timeline events.
 */
export interface TimelineQueryOptions {
	/** Filter by one or more event types. */
	eventTypes?: TimelineEventType[];
	/** Filter by one or more severities. */
	severities?: Severity[];
	/** Only events at or after this ISO 8601 timestamp. */
	since?: string;
	/** Only events at or before this ISO 8601 timestamp. */
	until?: string;
	/** Only events for this workspace ID. */
	workspaceId?: string;
	/** Only events for this plan execution ID. */
	planExecId?: string;
	/** Maximum number of events to return (default: 100). */
	limit?: number;
	/** Number of events to skip (default: 0). */
	offset?: number;
	/** Sort order by timestamp (default: "desc"). */
	order?: "asc" | "desc";
}

// ─────────────────────────────────────────────────────────────────────
// Store interface
// ─────────────────────────────────────────────────────────────────────

/**
 * Brain timeline store interface.
 *
 * Defines the contract for persisting and retrieving
 * brain timeline events.
 */
export interface BrainTimelineStore {
	/**
	 * Append a new event to the timeline.
	 * Events are stored in chronological order.
	 *
	 * @param event - The timeline event to append
	 */
	append(event: BrainTimelineEvent): Promise<void>;

	/**
	 * Append multiple events atomically.
	 *
	 * @param events - The timeline events to append
	 */
	appendBatch(events: BrainTimelineEvent[]): Promise<void>;

	/**
	 * Retrieve a single event by its ID.
	 *
	 * @param id - Event UUID
	 * @returns The event, or null if not found
	 */
	get(id: string): Promise<BrainTimelineEvent | null>;

	/**
	 * Query timeline events with optional filters.
	 *
	 * @param options - Query options (filters, pagination, sort)
	 * @returns Array of matching events
	 */
	list(options?: TimelineQueryOptions): Promise<BrainTimelineEvent[]>;

	/**
	 * Count events matching the given filters.
	 *
	 * @param options - Query options (only filter fields are used)
	 * @returns Event count
	 */
	count(options?: Omit<TimelineQueryOptions, "limit" | "offset" | "order">): Promise<number>;

	/**
	 * Remove all events from the timeline.
	 */
	clear(): Promise<void>;

	/**
	 * Remove events older than the given timestamp.
	 *
	 * @param olderThan - ISO 8601 timestamp; events with timestamp < this are removed
	 * @returns Number of events pruned
	 */
	prune(olderThan: string): Promise<number>;

	/**
	 * Persist the current in-memory state to a JSON file.
	 *
	 * @param filePath - Path to the output JSON file
	 */
	saveToFile(filePath: string): Promise<void>;

	/**
	 * Load timeline events from a JSON file into memory.
	 * Replaces any existing in-memory events.
	 *
	 * @param filePath - Path to the JSON file
	 * @returns Number of events loaded
	 */
	loadFromFile(filePath: string): Promise<number>;

	/**
	 * Get the total number of events in the store.
	 *
	 * @returns Event count
	 */
	size(): Promise<number>;

	/**
	 * Get the earliest event timestamp, or null if empty.
	 *
	 * @returns ISO 8601 timestamp string or null
	 */
	earliestTimestamp(): Promise<string | null>;

	/**
	 * Get the latest event timestamp, or null if empty.
	 *
	 * @returns ISO 8601 timestamp string or null
	 */
	latestTimestamp(): Promise<string | null>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory implementation
// ─────────────────────────────────────────────────────────────────────

/**
 * In-memory implementation of BrainTimelineStore.
 *
 * Stores events in an array for chronological ordering.
 * Supports optional JSON file persistence via saveToFile/loadFromFile.
 *
 * Thread-safe for single-process usage. Not designed for multi-process
 * concurrent access without external file locking.
 */
export class InMemoryBrainTimelineStore implements BrainTimelineStore {
	private events: BrainTimelineEvent[] = [];

	async append(event: BrainTimelineEvent): Promise<void> {
		const validation = validateBrainTimelineEvent(event);
		if (!validation.valid) {
			throw new Error(`Invalid BrainTimelineEvent: ${validation.errors.join("; ")}`);
		}
		this.events.push(event);
	}

	async appendBatch(events: BrainTimelineEvent[]): Promise<void> {
		for (const event of events) {
			const validation = validateBrainTimelineEvent(event);
			if (!validation.valid) {
				throw new Error(`Invalid BrainTimelineEvent in batch (id=${event.id}): ${validation.errors.join("; ")}`);
			}
		}
		this.events.push(...events);
	}

	async get(id: string): Promise<BrainTimelineEvent | null> {
		return this.events.find((e) => e.id === id) ?? null;
	}

	async list(options?: TimelineQueryOptions): Promise<BrainTimelineEvent[]> {
		const filtered = this.applyFilters(this.events, options);

		// Sort by timestamp
		const order = options?.order ?? "desc";
		filtered.sort((a, b) => {
			const cmp = a.timestamp.localeCompare(b.timestamp);
			return order === "asc" ? cmp : -cmp;
		});

		// Paginate
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? 100;

		return filtered.slice(offset, offset + limit);
	}

	async count(options?: Omit<TimelineQueryOptions, "limit" | "offset" | "order">): Promise<number> {
		return this.applyFilters(this.events, options).length;
	}

	async clear(): Promise<void> {
		this.events = [];
	}

	async prune(olderThan: string): Promise<number> {
		const before = this.events.length;
		this.events = this.events.filter((e) => e.timestamp >= olderThan);
		return before - this.events.length;
	}

	async saveToFile(filePath: string): Promise<void> {
		const dir = path.dirname(filePath);
		await fs.mkdir(dir, { recursive: true });
		const json = JSON.stringify(this.events, null, 2);
		await fs.writeFile(filePath, json, "utf-8");
	}

	async loadFromFile(filePath: string): Promise<number> {
		const json = await fs.readFile(filePath, "utf-8");
		let parsed: unknown;
		try {
			parsed = JSON.parse(json);
		} catch (e) {
			throw new Error(`Failed to parse timeline file: ${(e as Error).message}`);
		}

		if (!Array.isArray(parsed)) {
			throw new Error("Timeline file must contain a JSON array of events");
		}

		const events: BrainTimelineEvent[] = [];
		for (const item of parsed) {
			const validation = validateBrainTimelineEvent(item);
			if (!validation.valid) {
				throw new Error(`Invalid event in timeline file: ${validation.errors.join("; ")}`);
			}
			events.push(item as BrainTimelineEvent);
		}

		this.events = events;
		return events.length;
	}

	async size(): Promise<number> {
		return this.events.length;
	}

	async earliestTimestamp(): Promise<string | null> {
		if (this.events.length === 0) return null;
		let earliest = this.events[0].timestamp;
		for (let i = 1; i < this.events.length; i++) {
			if (this.events[i].timestamp < earliest) {
				earliest = this.events[i].timestamp;
			}
		}
		return earliest;
	}

	async latestTimestamp(): Promise<string | null> {
		if (this.events.length === 0) return null;
		let latest = this.events[0].timestamp;
		for (let i = 1; i < this.events.length; i++) {
			if (this.events[i].timestamp > latest) {
				latest = this.events[i].timestamp;
			}
		}
		return latest;
	}

	/**
	 * Apply query filters to an array of events.
	 */
	private applyFilters(events: BrainTimelineEvent[], options?: TimelineQueryOptions): BrainTimelineEvent[] {
		if (!options) return [...events];

		return events.filter((e) => {
			if (options.eventTypes && options.eventTypes.length > 0) {
				if (!options.eventTypes.includes(e.eventType)) return false;
			}
			if (options.severities && options.severities.length > 0) {
				if (!options.severities.includes(e.severity)) return false;
			}
			if (options.since && e.timestamp < options.since) return false;
			if (options.until && e.timestamp > options.until) return false;
			if (options.workspaceId && e.workspaceId !== options.workspaceId) return false;
			if (options.planExecId && e.planExecId !== options.planExecId) return false;
			return true;
		});
	}
}

// ─────────────────────────────────────────────────────────────────────
// Additional exports expected by the brain barrel module
// ─────────────────────────────────────────────────────────────────────

/**
 * Result of appending an event to the timeline store.
 */
export interface AppendEventResult {
	success: boolean;
	error?: string;
}

/**
 * Configuration options for BrainTimelineStore.
 */
export interface BrainTimelineStoreConfig {
	/** Path to the JSON persistence file */
	persistencePath?: string;
	/** Maximum number of archived timeline files to keep */
	maxArchives?: number;
	/** Maximum size of a timeline file before archiving (in bytes) */
	maxTimelineFileSize?: number;
}

/**
 * Maximum number of archived timeline files to retain.
 */
export const MAX_ARCHIVES = 10;

/**
 * Maximum size of a timeline file before it is rotated and archived.
 */
export const MAX_TIMELINE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Result of a timeline query.
 */
export interface TimelineQueryResult {
	events: BrainTimelineEvent[];
	total: number;
	offset: number;
	limit: number;
}

/**
 * Aggregate statistics for the timeline store.
 */
export interface TimelineStoreStats {
	totalEvents: number;
	totalArchives: number;
	oldestEvent: string | null;
	newestEvent: string | null;
	eventTypeCounts: Record<string, number>;
	severityCounts: Record<string, number>;
}
