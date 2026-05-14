/**
 * Execution Memory Store
 *
 * Storage backend for execution memory entries.
 * Provides an in-memory implementation that can be extended
 * for persistent storage backends (e.g., JSON file, SQLite).
 */

import type { ExecutionMemoryEntry } from "./execution-memory.js";

/**
 * Execution memory store interface.
 *
 * Defines the contract for persisting and retrieving
 * execution memory entries across workspace runs.
 */
export interface ExecutionMemoryStore {
	/**
	 * Store a memory entry.
	 *
	 * @param entry - The memory entry to store
	 */
	store(entry: ExecutionMemoryEntry): Promise<void>;

	/**
	 * Retrieve all memory entries.
	 *
	 * @returns All stored memory entries
	 */
	getAll(): Promise<ExecutionMemoryEntry[]>;

	/**
	 * Retrieve a memory entry by its ID.
	 *
	 * @param id - Entry ID
	 * @returns The memory entry, or null if not found
	 */
	getById(id: string): Promise<ExecutionMemoryEntry | null>;

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
 * In-memory implementation of ExecutionMemoryStore.
 *
 * Stores entries in a Map for fast lookup.
 * Suitable for testing and single-run scenarios.
 */
export class InMemoryExecutionMemoryStore implements ExecutionMemoryStore {
	private entries: Map<string, ExecutionMemoryEntry> = new Map();

	async store(entry: ExecutionMemoryEntry): Promise<void> {
		this.entries.set(entry.id, entry);
	}

	async getAll(): Promise<ExecutionMemoryEntry[]> {
		return Array.from(this.entries.values()).sort((a, b) => b.timestamp - a.timestamp);
	}

	async getById(id: string): Promise<ExecutionMemoryEntry | null> {
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
