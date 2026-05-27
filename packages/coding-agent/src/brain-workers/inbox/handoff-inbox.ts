/**
 * Worker Handoff Inbox — 25.O
 *
 * Manages handoff entries from brain workers to other workers.
 * When a worker completes a task that needs continuation by another
 * worker, it creates a handoff entry in the inbox. The triage router
 * reads the inbox and dispatches each handoff to the appropriate
 * worker based on role/task type.
 *
 * Supports budget, cooldown, dedup, and stop-condition handling
 * for autonomous operation. All failures surface evidence-backed
 * diagnostics rather than silent errors.
 *
 * File scope: HandoffInbox class, types, and helpers.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { createWorkerDiagnostic, type WorkerDiagnostic } from "../types.js";

// ---------------------------------------------------------------------------
// Handoff Entry Types
// ---------------------------------------------------------------------------

/**
 * Priority of a handoff entry.
 */
export type HandoffPriority = "low" | "normal" | "high" | "critical";

/**
 * All valid HandoffPriority values.
 */
export const ALL_HANDOFF_PRIORITIES: readonly HandoffPriority[] = ["low", "normal", "high", "critical"] as const;

/**
 * Status of a handoff entry.
 */
export type HandoffEntryStatus =
	| "pending" // Waiting to be triaged and routed
	| "routing" // Currently being routed to a worker
	| "dispatched" // Successfully dispatched to a worker
	| "completed" // Worker completed the handoff task
	| "failed" // Routing or execution failed
	| "cancelled"; // Cancelled before dispatch

/**
 * All valid HandoffEntryStatus values.
 */
export const ALL_HANDOFF_ENTRY_STATUSES: readonly HandoffEntryStatus[] = [
	"pending",
	"routing",
	"dispatched",
	"completed",
	"failed",
	"cancelled",
] as const;

/**
 * A handoff entry — a task handed off from one worker to another.
 */
export interface HandoffEntry {
	/** Unique entry ID (UUID v4). */
	id: string;
	/** Priority of this handoff. */
	priority: HandoffPriority;
	/** Current status. */
	status: HandoffEntryStatus;
	/** ISO 8601 timestamp of creation. */
	createdAt: string;
	/** ISO 8601 timestamp of last status change. */
	updatedAt: string;
	/** ID of the source worker that created this handoff. */
	sourceWorkerId: string;
	/** Role of the source worker. */
	sourceWorkerRole: string;
	/** ID of the target worker this should be routed to (optional, can be determined by triage). */
	targetWorkerId?: string;
	/** Role of the target worker. */
	targetWorkerRole: string;
	/** Human-readable title for this handoff. */
	title: string;
	/** Detailed description of the handoff task. */
	description: string;
	/** Input data for the target worker. */
	input: Record<string, unknown>;
	/** Output data produced by the source worker (context for the handoff). */
	output: Record<string, unknown>;
	/** Handoff-specific dedup key for deduplication checks. */
	dedupKey: string;
	/** Tags for categorization and querying. */
	tags: string[];
	/** Evidence references supporting this handoff. */
	evidenceRefs: string[];
	/** Error message if status is "failed". */
	error?: string;
	/** Diagnostics for failed or cancelled handoffs. */
	diagnostics: WorkerDiagnostic[];
	/** Arbitrary metadata. */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Inbox Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the HandoffInbox.
 */
export interface HandoffInboxConfig {
	/**
	 * Maximum number of pending entries allowed at once.
	 * Default: 500.
	 */
	maxPendingEntries: number;

	/**
	 * Maximum number of completed entries to retain.
	 * Default: 1000.
	 */
	maxCompletedEntries: number;

	/**
	 * Maximum age of entries in milliseconds before auto-expiry.
	 * Completed entries older than this are pruned. Default: 86400000 (24h).
	 */
	entryTtlMs: number;

	/**
	 * Whether deduplication is enabled.
	 * Default: true.
	 */
	enableDeduplication: boolean;

	/**
	 * Dedup window in milliseconds within which duplicate handoffs
	 * are suppressed. Default: 300000 (5 min).
	 */
	dedupWindowMs: number;
}

/**
 * Default inbox configuration.
 */
export const DEFAULT_HANDOFF_INBOX_CONFIG: HandoffInboxConfig = {
	maxPendingEntries: 500,
	maxCompletedEntries: 1000,
	entryTtlMs: 86_400_000, // 24h
	enableDeduplication: true,
	dedupWindowMs: 300_000, // 5 min
};

// ---------------------------------------------------------------------------
// Inbox Statistics
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics for the handoff inbox.
 */
export interface HandoffInboxStats {
	total: number;
	pending: number;
	routing: number;
	dispatched: number;
	completed: number;
	failed: number;
	cancelled: number;
	byPriority: Record<HandoffPriority, number>;
	oldestEntryAgeMs: number;
	lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Inbox Query Options
// ---------------------------------------------------------------------------

/**
 * Options for querying handoff entries.
 */
export interface HandoffInboxQuery {
	status?: HandoffEntryStatus | HandoffEntryStatus[];
	priority?: HandoffPriority | HandoffPriority[];
	sourceWorkerId?: string;
	targetWorkerRole?: string;
	targetWorkerId?: string;
	tags?: string[];
	limit?: number;
	offset?: number;
	sortBy?: "createdAt" | "updatedAt" | "priority";
	sortDir?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// HandoffInbox Class
// ---------------------------------------------------------------------------

/**
 * Handoff inbox for brain workers.
 *
 * Manages handoff entries with support for:
 * - CRUD operations on handoff entries
 * - Deduplication within configurable window
 * - Auto-expiry of old entries
 * - Priority-based sorting and filtering
 * - Evidence-backed diagnostics on failures
 * - Statistics and querying
 */
export class HandoffInbox {
	private entries: Map<string, HandoffEntry> = new Map();
	private config: HandoffInboxConfig;

	constructor(config: Partial<HandoffInboxConfig> = {}) {
		this.config = { ...DEFAULT_HANDOFF_INBOX_CONFIG, ...config };
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the current inbox configuration.
	 */
	getConfig(): Readonly<HandoffInboxConfig> {
		return { ...this.config };
	}

	/**
	 * Update the inbox configuration.
	 */
	updateConfig(updates: Partial<HandoffInboxConfig>): void {
		this.config = { ...this.config, ...updates };
	}

	// -----------------------------------------------------------------------
	// CRUD Operations
	// -----------------------------------------------------------------------

	/**
	 * Create a new handoff entry.
	 *
	 * Returns the created entry, or null if the entry was deduplicated
	 * (suppressed as duplicate within dedup window). When deduplicated,
	 * the existing duplicate entry's ID is included in the result metadata.
	 *
	 * Throws if:
	 * - maxPendingEntries is exceeded
	 * - Required fields are missing
	 * - Dedup check finds an exact match within the window (returns null)
	 */
	create(
		input: Pick<
			HandoffEntry,
			"sourceWorkerId" | "sourceWorkerRole" | "targetWorkerRole" | "title" | "description" | "dedupKey"
		> &
			Partial<
				Pick<
					HandoffEntry,
					"priority" | "input" | "output" | "tags" | "evidenceRefs" | "metadata" | "targetWorkerId"
				>
			>,
	):
		| { entry: HandoffEntry }
		| { duplicate: HandoffEntry; reason: string }
		| { error: string; diagnostics: WorkerDiagnostic[] } {
		// Validate required fields
		const missing: string[] = [];
		if (!input.sourceWorkerId) missing.push("sourceWorkerId");
		if (!input.sourceWorkerRole) missing.push("sourceWorkerRole");
		if (!input.targetWorkerRole) missing.push("targetWorkerRole");
		if (!input.title) missing.push("title");
		if (!input.description) missing.push("description");
		if (!input.dedupKey) missing.push("dedupKey");

		if (missing.length > 0) {
			const diag = createWorkerDiagnostic(
				"unknown_error",
				`Handoff creation failed: missing required fields: ${missing.join(", ")}`,
				{ missing },
			);
			return { error: `Missing required fields: ${missing.join(", ")}`, diagnostics: [diag] };
		}

		// Prune old entries before checking capacity
		this.prune();

		// Check dedup
		if (this.config.enableDeduplication) {
			const duplicate = this.findDuplicate(input.dedupKey);
			if (duplicate) {
				return {
					duplicate,
					reason: `Duplicate handoff within dedup window (${this.config.dedupWindowMs}ms). Existing entry: ${duplicate.id}`,
				};
			}
		}

		// Check capacity
		const pendingCount = this.countByStatus("pending");
		if (pendingCount >= this.config.maxPendingEntries) {
			const diag = createWorkerDiagnostic(
				"policy_blocked",
				`Handoff creation blocked: pending entries (${pendingCount}) exceeds max (${this.config.maxPendingEntries})`,
				{ pendingCount, maxPendingEntries: this.config.maxPendingEntries },
			);
			return {
				error: `Pending entry limit reached (${pendingCount}/${this.config.maxPendingEntries})`,
				diagnostics: [diag],
			};
		}

		const now = new Date().toISOString();
		const entry: HandoffEntry = {
			id: randomUUID(),
			priority: input.priority ?? "normal",
			status: "pending",
			createdAt: now,
			updatedAt: now,
			sourceWorkerId: input.sourceWorkerId,
			sourceWorkerRole: input.sourceWorkerRole,
			targetWorkerId: input.targetWorkerId,
			targetWorkerRole: input.targetWorkerRole,
			title: input.title,
			description: input.description,
			input: input.input ?? {},
			output: input.output ?? {},
			dedupKey: input.dedupKey,
			tags: input.tags ?? [],
			evidenceRefs: input.evidenceRefs ?? [],
			diagnostics: [],
			metadata: input.metadata ?? {},
		};

		this.entries.set(entry.id, entry);
		return { entry };
	}

	/**
	 * Get a single handoff entry by ID.
	 */
	get(id: string): HandoffEntry | undefined {
		return this.entries.get(id);
	}

	/**
	 * Update a handoff entry's status and metadata.
	 *
	 * Returns the updated entry, or an error diagnostic if the entry
	 * doesn't exist or the transition is invalid.
	 */
	update(
		id: string,
		updates: Partial<
			Pick<HandoffEntry, "status" | "targetWorkerId" | "error" | "output" | "tags" | "evidenceRefs" | "metadata">
		> & { diagnostics?: WorkerDiagnostic[] },
	): { entry: HandoffEntry } | { error: string; diagnostics: WorkerDiagnostic[] } {
		const existing = this.entries.get(id);
		if (!existing) {
			const diag = createWorkerDiagnostic("unknown_error", `Handoff update failed: entry not found: ${id}`, {
				entryId: id,
			});
			return { error: `Handoff entry not found: ${id}`, diagnostics: [diag] };
		}

		// Validate status transitions
		if (updates.status) {
			const transitionResult = this.validateTransition(existing.status, updates.status);
			if (!transitionResult.valid) {
				const diag = createWorkerDiagnostic("policy_blocked", transitionResult.reason!, {
					from: existing.status,
					to: updates.status,
					entryId: id,
				});
				return { error: transitionResult.reason!, diagnostics: [diag] };
			}
		}

		const now = new Date().toISOString();
		const updated: HandoffEntry = {
			...existing,
			...updates,
			status: updates.status ?? existing.status,
			updatedAt: now,
			diagnostics: [...existing.diagnostics, ...(updates.diagnostics ?? [])],
		};

		this.entries.set(id, updated);
		return { entry: updated };
	}

	/**
	 * Remove a handoff entry by ID.
	 * Returns true if the entry was removed, false if not found.
	 */
	delete(id: string): boolean {
		return this.entries.delete(id);
	}

	/**
	 * Cancel a pending or routing handoff entry.
	 *
	 * Returns the cancelled entry, or an error if the entry cannot be cancelled
	 * (e.g., it is already completed or dispatched).
	 */
	cancel(id: string, reason?: string): { entry: HandoffEntry } | { error: string; diagnostics: WorkerDiagnostic[] } {
		const existing = this.entries.get(id);
		if (!existing) {
			const diag = createWorkerDiagnostic("unknown_error", `Handoff cancel failed: entry not found: ${id}`, {
				entryId: id,
			});
			return { error: `Handoff entry not found: ${id}`, diagnostics: [diag] };
		}

		if (existing.status !== "pending" && existing.status !== "routing") {
			const diag = createWorkerDiagnostic(
				"policy_blocked",
				`Cannot cancel handoff in status "${existing.status}". Only pending or routing entries can be cancelled.`,
				{ entryId: id, currentStatus: existing.status },
			);
			return { error: `Cannot cancel handoff in status "${existing.status}".`, diagnostics: [diag] };
		}

		const now = new Date().toISOString();
		const diag = createWorkerDiagnostic("user_interrupt", reason ?? "Handoff cancelled by user or policy", {
			entryId: id,
			previousStatus: existing.status,
		});

		const updated: HandoffEntry = {
			...existing,
			status: "cancelled",
			updatedAt: now,
			diagnostics: [...existing.diagnostics, diag],
		};

		this.entries.set(id, updated);
		return { entry: updated };
	}

	// -----------------------------------------------------------------------
	// Querying
	// -----------------------------------------------------------------------

	/**
	 * List handoff entries matching the given query.
	 */
	list(query: HandoffInboxQuery = {}): HandoffEntry[] {
		this.prune();

		let results = Array.from(this.entries.values());

		// Filter by status
		if (query.status) {
			const statuses = Array.isArray(query.status) ? query.status : [query.status];
			results = results.filter((e) => statuses.includes(e.status));
		}

		// Filter by priority
		if (query.priority) {
			const priorities = Array.isArray(query.priority) ? query.priority : [query.priority];
			results = results.filter((e) => priorities.includes(e.priority));
		}

		// Filter by source worker
		if (query.sourceWorkerId) {
			results = results.filter((e) => e.sourceWorkerId === query.sourceWorkerId);
		}

		// Filter by target worker role
		if (query.targetWorkerRole) {
			results = results.filter((e) => e.targetWorkerRole === query.targetWorkerRole);
		}

		// Filter by target worker ID
		if (query.targetWorkerId) {
			results = results.filter((e) => e.targetWorkerId === query.targetWorkerId);
		}

		// Filter by tags (matches any)
		if (query.tags && query.tags.length > 0) {
			results = results.filter((e) => query.tags!.some((t) => e.tags.includes(t)));
		}

		// Sort
		const sortBy = query.sortBy ?? "createdAt";
		const sortDir = query.sortDir ?? "desc";
		results.sort((a, b) => {
			let cmp: number;
			if (sortBy === "priority") {
				const priorityOrder: Record<HandoffPriority, number> = {
					low: 0,
					normal: 1,
					high: 2,
					critical: 3,
				};
				cmp = priorityOrder[a.priority] - priorityOrder[b.priority];
			} else {
				cmp = new Date(a[sortBy]).getTime() - new Date(b[sortBy]).getTime();
			}
			return sortDir === "asc" ? cmp : -cmp;
		});

		// Paginate
		const offset = query.offset ?? 0;
		const limit = query.limit ?? 50;
		return results.slice(offset, offset + limit);
	}

	/**
	 * Get aggregate statistics for the inbox.
	 */
	stats(): HandoffInboxStats {
		this.prune();

		const all = Array.from(this.entries.values());
		const now = Date.now();
		let oldestTs = now;

		const byPriority: Record<HandoffPriority, number> = {
			low: 0,
			normal: 0,
			high: 0,
			critical: 0,
		};

		for (const entry of all) {
			const entryTs = new Date(entry.createdAt).getTime();
			if (entryTs < oldestTs) oldestTs = entryTs;

			byPriority[entry.priority] = (byPriority[entry.priority] ?? 0) + 1;
		}

		return {
			total: all.length,
			pending: all.filter((e) => e.status === "pending").length,
			routing: all.filter((e) => e.status === "routing").length,
			dispatched: all.filter((e) => e.status === "dispatched").length,
			completed: all.filter((e) => e.status === "completed").length,
			failed: all.filter((e) => e.status === "failed").length,
			cancelled: all.filter((e) => e.status === "cancelled").length,
			byPriority,
			oldestEntryAgeMs: all.length > 0 ? now - oldestTs : 0,
			lastUpdated: new Date().toISOString(),
		};
	}

	/**
	 * Get the number of entries with a specific status.
	 */
	countByStatus(status: HandoffEntryStatus): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.status === status) count++;
		}
		return count;
	}

	// -----------------------------------------------------------------------
	// Deduplication
	// -----------------------------------------------------------------------

	/**
	 * Find a duplicate entry for the given dedup key within the dedup window.
	 */
	private findDuplicate(dedupKey: string): HandoffEntry | undefined {
		const now = Date.now();
		const windowMs = this.config.dedupWindowMs;

		for (const entry of this.entries.values()) {
			if (entry.dedupKey !== dedupKey) continue;
			if (entry.status === "cancelled" || entry.status === "failed") continue;

			const entryAge = now - new Date(entry.createdAt).getTime();
			if (entryAge <= windowMs) {
				return entry;
			}
		}

		return undefined;
	}

	// -----------------------------------------------------------------------
	// Lifecycle Management
	// -----------------------------------------------------------------------

	/**
	 * Prune old entries that exceed the TTL or max completed count.
	 */
	prune(): void {
		const now = Date.now();
		const ttlMs = this.config.entryTtlMs;

		// Prune expired entries (any status)
		for (const [id, entry] of this.entries) {
			const age = now - new Date(entry.createdAt).getTime();
			if (age > ttlMs) {
				this.entries.delete(id);
			}
		}

		// Enforce max completed entries
		const completed = Array.from(this.entries.values())
			.filter((e) => e.status === "completed")
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

		if (completed.length > this.config.maxCompletedEntries) {
			const toRemove = completed.slice(this.config.maxCompletedEntries);
			for (const entry of toRemove) {
				this.entries.delete(entry.id);
			}
		}
	}

	/**
	 * Clear all entries from the inbox.
	 */
	clear(): void {
		this.entries.clear();
	}

	// -----------------------------------------------------------------------
	// Status Transition Validation
	// -----------------------------------------------------------------------

	/**
	 * Valid state transitions for handoff entries.
	 *
	 * pending    -> routing, cancelled, failed
	 * routing    -> dispatched, failed, cancelled
	 * dispatched -> completed, failed
	 * completed  -> (terminal)
	 * failed     -> (terminal)
	 * cancelled  -> (terminal)
	 */
	private readonly validTransitions: Record<HandoffEntryStatus, HandoffEntryStatus[]> = {
		pending: ["routing", "cancelled", "failed"],
		routing: ["dispatched", "failed", "cancelled"],
		dispatched: ["completed", "failed"],
		completed: [],
		failed: [],
		cancelled: [],
	};

	/**
	 * Validate a status transition.
	 */
	private validateTransition(
		from: HandoffEntryStatus,
		to: HandoffEntryStatus,
	): { valid: true } | { valid: false; reason: string } {
		if (from === to) return { valid: true };

		const allowed = this.validTransitions[from];
		if (!allowed) {
			return { valid: false, reason: `Unknown source status: "${from}"` };
		}

		if (allowed.includes(to)) {
			return { valid: true };
		}

		return {
			valid: false,
			reason: `Invalid status transition from "${from}" to "${to}". Allowed transitions: ${allowed.join(", ") || "none (terminal state)"}`,
		};
	}
}
