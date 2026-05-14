/**
 * Planner Memory Store
 *
 * Storage backend for planner memory entries.
 * Provides an in-memory implementation that can be extended
 * for persistent storage backends (e.g., JSON file, SQLite).
 */

import type { PlannerMemoryEntry } from "./planner-memory.js";

/**
 * Planner memory store interface.
 *
 * Defines the contract for persisting and retrieving
 * planner memory entries across planning sessions.
 */
export interface PlannerMemoryStore {
	/**
	 * Store a memory entry.
	 *
	 * @param entry - The memory entry to store
	 */
	store(entry: PlannerMemoryEntry): Promise<void>;

	/**
	 * Update an existing memory entry.
	 * Replaces the entry with the same ID if it exists.
	 *
	 * @param entry - The memory entry to update (must have a valid id)
	 */
	update(entry: PlannerMemoryEntry): Promise<void>;

	/**
	 * Retrieve all memory entries.
	 *
	 * @returns All stored memory entries
	 */
	getAll(): Promise<PlannerMemoryEntry[]>;

	/**
	 * Retrieve a memory entry by its ID.
	 *
	 * @param id - Entry ID
	 * @returns The memory entry, or null if not found
	 */
	getById(id: string): Promise<PlannerMemoryEntry | null>;

	/**
	 * Delete a memory entry by its ID.
	 *
	 * @param id - Entry ID to delete
	 */
	deleteById(id: string): Promise<void>;

	/**
	 * Clear all memory entries.
	 */
	clear(): Promise<void>;

	/**
	 * Get the total number of entries.
	 *
	 * @returns Entry count
	 */
	count(): Promise<number>;
}

/**
 * In-memory implementation of PlannerMemoryStore.
 *
 * Stores entries in a Map for fast lookup.
 * Suitable for testing and single-run scenarios.
 */
export class InMemoryPlannerMemoryStore implements PlannerMemoryStore {
	private entries: Map<string, PlannerMemoryEntry> = new Map();

	async store(entry: PlannerMemoryEntry): Promise<void> {
		this.entries.set(entry.id, entry);
	}

	async update(entry: PlannerMemoryEntry): Promise<void> {
		if (!this.entries.has(entry.id)) {
			throw new Error(`Cannot update entry "${entry.id}": not found`);
		}
		this.entries.set(entry.id, entry);
	}

	async getAll(): Promise<PlannerMemoryEntry[]> {
		return Array.from(this.entries.values()).sort((a, b) => b.timestamp - a.timestamp);
	}

	async getById(id: string): Promise<PlannerMemoryEntry | null> {
		return this.entries.get(id) ?? null;
	}

	async deleteById(id: string): Promise<void> {
		this.entries.delete(id);
	}

	async clear(): Promise<void> {
		this.entries.clear();
	}

	async count(): Promise<number> {
		return this.entries.size;
	}
}
