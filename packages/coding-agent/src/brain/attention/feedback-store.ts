/**
 * Feedback Store — 24.J
 *
 * In-memory store for user feedback on brain-generated items (digest
 * entries, signals, observations, proposals). Each feedback item records
 * a rating (thumbs up/down) and an optional corrective comment that can
 * be used to "teach" Pi what to do differently.
 *
 * The store supports CRUD operations and querying by item type, rating,
 * and recency. Feedback entries can be aggregated to show trends.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Rating for a feedback entry.
 * - 1: positive (thumbs up) — "this was good, do more of this"
 * - -1: negative (thumbs down) — "this was wrong, do less of this"
 */
export type FeedbackRating = 1 | -1;

/**
 * The type of item being rated.
 */
export type FeedbackItemType =
	| "digest_entry"
	| "signal"
	| "observation"
	| "proposal"
	| "goal"
	| "memory"
	| "reflection"
	| "plan_result";

/**
 * A single feedback entry submitted by the user.
 */
export interface FeedbackEntry {
	/** Unique identifier (UUID v4). */
	id: string;
	/** The type of item being rated. */
	itemType: FeedbackItemType;
	/** Reference ID of the item being rated (e.g., signal ID, observation ID). */
	itemId: string;
	/** Item title for display and context. */
	itemTitle: string;
	/** Rating: 1 (positive) or -1 (negative). */
	rating: FeedbackRating;
	/** Optional corrective comment explaining the rating. */
	comment: string;
	/** Whether this feedback has been "applied" by the learning system. */
	applied: boolean;
	/** ISO 8601 timestamp of when the feedback was created. */
	createdAt: string;
	/** ISO 8601 timestamp of when the feedback was last updated. */
	updatedAt: string;
}

/**
 * Aggregate stats for a collection of feedback entries.
 */
export interface FeedbackStats {
	/** Total feedback entries. */
	total: number;
	/** Positive feedback count. */
	positive: number;
	/** Negative feedback count. */
	negative: number;
	/** Unapplied feedback count (not yet consumed by learning system). */
	unapplied: number;
	/** Breakdown by item type. */
	byType: Record<string, { total: number; positive: number; negative: number }>;
}

/**
 * Query options for listing feedback entries.
 */
export interface FeedbackQuery {
	itemType?: FeedbackItemType;
	itemId?: string;
	rating?: FeedbackRating;
	applied?: boolean;
	limit?: number;
	offset?: number;
	sortBy?: "createdAt" | "updatedAt" | "rating";
	sortDir?: "asc" | "desc";
}

/**
 * Result of a feedback query.
 */
export interface FeedbackQueryResult {
	entries: FeedbackEntry[];
	total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valid FeedbackItemType values for runtime validation. */
export const ALL_FEEDBACK_ITEM_TYPES: FeedbackItemType[] = [
	"digest_entry",
	"signal",
	"observation",
	"proposal",
	"goal",
	"memory",
	"reflection",
	"plan_result",
];

/**
 * Create a new FeedbackEntry with defaults applied.
 */
export function createFeedbackEntry(
	overrides: Omit<FeedbackEntry, "id" | "createdAt" | "updatedAt" | "applied">,
): FeedbackEntry {
	return {
		id: randomUUID(),
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		applied: false,
		...overrides,
	};
}

/**
 * Validate a feedback entry for required fields.
 */
export function validateFeedbackEntry(value: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const entry = value as Record<string, unknown>;

	if (typeof entry.itemType !== "string" || !ALL_FEEDBACK_ITEM_TYPES.includes(entry.itemType as FeedbackItemType)) {
		errors.push(`itemType must be one of: ${ALL_FEEDBACK_ITEM_TYPES.join(", ")}`);
	}
	if (typeof entry.itemId !== "string" || entry.itemId.length === 0) {
		errors.push("itemId must be a non-empty string");
	}
	if (typeof entry.itemTitle !== "string" || entry.itemTitle.length === 0) {
		errors.push("itemTitle must be a non-empty string");
	}
	if (entry.rating !== 1 && entry.rating !== -1) {
		errors.push("rating must be 1 (positive) or -1 (negative)");
	}
	if (entry.comment !== undefined && typeof entry.comment !== "string") {
		errors.push("comment must be a string if provided");
	}

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// FeedbackStore
// ---------------------------------------------------------------------------

/**
 * In-memory store for feedback entries.
 *
 * Provides CRUD operations and querying. Entries are stored in memory
 * and can be exported/imported for persistence.
 */
export class FeedbackStore {
	private entries: Map<string, FeedbackEntry> = new Map();

	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	/**
	 * Add a new feedback entry.
	 *
	 * @returns The created FeedbackEntry.
	 */
	add(overrides: Omit<FeedbackEntry, "id" | "createdAt" | "updatedAt" | "applied">): FeedbackEntry {
		const entry = createFeedbackEntry(overrides);
		this.entries.set(entry.id, entry);

		return entry;
	}

	/**
	 * Get a feedback entry by ID.
	 *
	 * @returns The FeedbackEntry or undefined if not found.
	 */
	get(id: string): FeedbackEntry | undefined {
		return this.entries.get(id);
	}

	/**
	 * Update an existing feedback entry.
	 *
	 * @returns The updated FeedbackEntry, or undefined if not found.
	 */
	update(
		id: string,
		updates: Partial<Pick<FeedbackEntry, "rating" | "comment" | "applied">>,
	): FeedbackEntry | undefined {
		const existing = this.entries.get(id);
		if (!existing) return undefined;

		const updated: FeedbackEntry = {
			...existing,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		this.entries.set(id, updated);
		return updated;
	}

	/**
	 * Delete a feedback entry by ID.
	 *
	 * @returns true if the entry existed and was deleted, false otherwise.
	 */
	delete(id: string): boolean {
		return this.entries.delete(id);
	}

	/**
	 * Remove all feedback entries from the store. Useful for testing.
	 */
	clear(): void {
		this.entries.clear();
	}

	/**
	 * Get the total number of entries in the store.
	 */
	get size(): number {
		return this.entries.size;
	}

	// -----------------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------------

	/**
	 * Query feedback entries with optional filters.
	 */
	query(query?: FeedbackQuery): FeedbackQueryResult {
		let results = Array.from(this.entries.values());

		if (query) {
			if (query.itemType) {
				results = results.filter((e) => e.itemType === query.itemType);
			}
			if (query.itemId) {
				results = results.filter((e) => e.itemId === query.itemId);
			}
			if (query.rating) {
				results = results.filter((e) => e.rating === query.rating);
			}
			if (query.applied !== undefined) {
				results = results.filter((e) => e.applied === query.applied);
			}

			// Sort
			const sortBy = query.sortBy ?? "createdAt";
			const sortDir = query.sortDir ?? "desc";
			results.sort((a, b) => {
				let cmp = 0;
				if (sortBy === "createdAt" || sortBy === "updatedAt") {
					cmp = new Date(a[sortBy]).getTime() - new Date(b[sortBy]).getTime();
				} else if (sortBy === "rating") {
					cmp = a.rating - b.rating;
				}
				return sortDir === "asc" ? cmp : -cmp;
			});

			// Pagination
			const offset = query.offset ?? 0;
			const limit = query.limit ?? 50;
			results = results.slice(offset, offset + limit);
		}

		return {
			entries: results,
			total: this.entries.size,
		};
	}

	// -----------------------------------------------------------------------
	// Aggregation
	// -----------------------------------------------------------------------

	/**
	 * Compute aggregate statistics across all feedback entries.
	 */
	getStats(): FeedbackStats {
		const entries = Array.from(this.entries.values());
		const positive = entries.filter((e) => e.rating === 1).length;
		const negative = entries.filter((e) => e.rating === -1).length;
		const unapplied = entries.filter((e) => !e.applied).length;

		const byType: Record<string, { total: number; positive: number; negative: number }> = {};
		for (const entry of entries) {
			if (!byType[entry.itemType]) {
				byType[entry.itemType] = { total: 0, positive: 0, negative: 0 };
			}
			byType[entry.itemType].total++;
			if (entry.rating === 1) {
				byType[entry.itemType].positive++;
			} else {
				byType[entry.itemType].negative++;
			}
		}

		return {
			total: entries.length,
			positive,
			negative,
			unapplied,
			byType,
		};
	}

	/**
	 * Get all unapplied negative feedback entries — these are the most
	 * actionable items for the learning/teaching system.
	 */
	getUnappliedNegative(): FeedbackEntry[] {
		return Array.from(this.entries.values()).filter((e) => !e.applied && e.rating === -1);
	}

	/**
	 * Export all entries as a plain array (for serialization).
	 */
	toArray(): FeedbackEntry[] {
		return Array.from(this.entries.values());
	}

	/**
	 * Import entries from an array (for deserialization / testing).
	 */
	fromArray(entries: FeedbackEntry[]): void {
		for (const entry of entries) {
			this.entries.set(entry.id, entry);
		}
	}
}
