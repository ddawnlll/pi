/**
 * Event Store / Event Spine — P41.02
 *
 * Write-side event store interface and in-memory implementation.
 * Execution events are appended to the store and surfaced as JournalEventEnvelope
 * for consumption by the ExecutionReadModel.
 *
 * Consumption path: Worker → WorkerAdapter emits WorkerEvent →
 * Execution journals typed ExecutionEvent → EventStore.appendEvent() →
 * Read Model surfaces JournalEventEnvelope via listJournalEvents().
 */

import { randomUUID } from "node:crypto";
import type { ExecutionEvent } from "./events.js";
import type { JournalEventEnvelope, JournalQuery } from "./read-model.js";

// ---------------------------------------------------------------------------
// IEventStore — Event Spine write interface
// ---------------------------------------------------------------------------

/**
 * Event store contract for the execution platform.
 *
 * Responsibilities:
 * - Append typed ExecutionEvent objects with auto-generated sequencing
 * - Query stored events as JournalEventEnvelope views (filtered, paginated)
 * - Provide per-event retrieval by eventId
 *
 * Implementations may be in-memory, SQLite, or backed by any storage.
 */
export interface IEventStore {
	/**
	 * Append a single execution event to the store.
	 * Returns the generated eventId (UUID).
	 *
	 * @param planExecutionId - The plan execution this event belongs to
	 * @param event - The typed ExecutionEvent to store
	 * @param workspaceId - Optional workspace scope for the event
	 */
	appendEvent(planExecutionId: string, event: ExecutionEvent, workspaceId?: string): Promise<string>;

	/**
	 * Query events for a plan execution, with optional filtering and pagination.
	 * Events are returned in insertion order (oldest first).
	 *
	 * @param planExecutionId - The plan execution to query
	 * @param options - Optional filters: limit, offset, eventType, workspaceId
	 */
	queryEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]>;

	/**
	 * Retrieve a single event by its eventId (UUID).
	 * Returns null if no event with that ID exists.
	 */
	getEvent(eventId: string): Promise<JournalEventEnvelope | null>;

	/**
	 * Return the total count of stored events for a plan execution.
	 * Useful for consumers that need pagination metadata.
	 */
	countEvents(planExecutionId: string): Promise<number>;

	/**
	 * Clear all events (primarily for testing).
	 */
	clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// EventStoreError
// ---------------------------------------------------------------------------

/**
 * Error type for event store operations.
 */
export class EventStoreError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "EventStoreError";
	}
}

// ---------------------------------------------------------------------------
// InMemoryEventStore — ephemeral event store
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of IEventStore.
 *
 * Events are stored in insertion order in a Map<string, JournalEventEnvelope>
 * keyed by eventId. Per-plan-execution indices are maintained for efficient
 * querying without scanning the entire store.
 *
 * Thread-safety note: All operations are async but synchronous in practice
 * since JavaScript is single-threaded. If shared across workers, use a
 * persistent backend instead (future work).
 */
export class InMemoryEventStore implements IEventStore {
	/**
	 * Primary store: eventId → JournalEventEnvelope
	 */
	private readonly store: Map<string, JournalEventEnvelope> = new Map();

	/**
	 * Ordered list of eventIds per plan execution (insertion order).
	 * planExecutionId → eventId[]
	 */
	private readonly planIndex: Map<string, string[]> = new Map();

	/**
	 * Sequence counter per plan execution for human-readable seq strings.
	 */
	private readonly seqCounters: Map<string, number> = new Map();

	// -----------------------------------------------------------------------
	// IEventStore implementation
	// -----------------------------------------------------------------------

	async appendEvent(planExecutionId: string, event: ExecutionEvent, workspaceId?: string): Promise<string> {
		if (!planExecutionId) {
			throw new EventStoreError("planExecutionId is required", "INVALID_ARGUMENT", { planExecutionId });
		}

		// Generate unique event ID and sequence
		const eventId = randomUUID();
		const seq = this.nextSeq(planExecutionId);

		// Build the envelope
		const envelope: JournalEventEnvelope = {
			seq: `${planExecutionId}:${seq}`,
			eventId,
			planExecutionId,
			workspaceId,
			eventType: event.type,
			payload: event.payload as unknown as Record<string, unknown>,
			createdAt: new Date(event.timestamp).toISOString(),
		};

		// Store the envelope
		this.store.set(eventId, envelope);

		// Index by plan execution
		const planEvents = this.planIndex.get(planExecutionId);
		if (planEvents) {
			planEvents.push(eventId);
		} else {
			this.planIndex.set(planExecutionId, [eventId]);
		}

		return eventId;
	}

	async queryEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]> {
		const planEvents = this.planIndex.get(planExecutionId);
		if (!planEvents || planEvents.length === 0) {
			return [];
		}

		// Resolve all envelopes for this plan
		let results: JournalEventEnvelope[] = [];
		for (const eventId of planEvents) {
			const envelope = this.store.get(eventId);
			if (envelope) {
				results.push(envelope);
			}
		}

		// Apply workspaceId filter
		if (options?.workspaceId) {
			results = results.filter((e) => e.workspaceId === options!.workspaceId);
		}

		// Apply eventType filter
		if (options?.eventType) {
			results = results.filter((e) => e.eventType === options!.eventType);
		}

		// Apply offset
		const offset = options?.offset ?? 0;

		// Apply limit (or default to all)
		const limit = options?.limit ?? results.length;

		return results.slice(offset, offset + limit);
	}

	async getEvent(eventId: string): Promise<JournalEventEnvelope | null> {
		return this.store.get(eventId) ?? null;
	}

	async countEvents(planExecutionId: string): Promise<number> {
		const planEvents = this.planIndex.get(planExecutionId);
		return planEvents?.length ?? 0;
	}

	async clear(): Promise<void> {
		this.store.clear();
		this.planIndex.clear();
		this.seqCounters.clear();
	}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Get the next sequence number for a plan execution (1-based).
	 */
	private nextSeq(planExecutionId: string): number {
		const current = this.seqCounters.get(planExecutionId) ?? 0;
		const next = current + 1;
		this.seqCounters.set(planExecutionId, next);
		return next;
	}
}
