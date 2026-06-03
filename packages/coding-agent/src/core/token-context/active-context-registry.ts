/**
 * P43 Active Context Registry (ACR) - W008
 *
 * Tracks whether content is active, inactive, evicted, dirty, changed, or unknown.
 * State transitions with turn-based eviction and external mutation detection.
 */

import { statSync } from "node:fs";
import type { ACRState, ActiveContextEntry } from "./types.js";

export interface ACROptions {
	/** Max entries before eviction */
	maxEntries?: number;
	/** Max turns before marking inactive */
	maxTurnsInactive?: number;
	/** TTL in ms before marking inactive (overrides turn-based if set) */
	ttlMs?: number;
}

export class ActiveContextRegistry {
	private entries = new Map<string, ActiveContextEntry>();
	private maxEntries: number;
	private maxTurnsInactive: number;
	private ttlMs?: number;
	private currentTurn = 0;

	constructor(options: ACROptions = {}) {
		this.maxEntries = options.maxEntries ?? 100;
		this.maxTurnsInactive = options.maxTurnsInactive ?? 10;
		this.ttlMs = options.ttlMs;
	}

	/**
	 * Mark a file as active (just read or about to be read).
	 */
	markActive(filePath: string, snapshotId?: string): ActiveContextEntry {
		const existing = this.entries.get(filePath);
		const entry: ActiveContextEntry = {
			filePath,
			state: "active",
			lastAccessed: Date.now(),
			created: existing?.created ?? Date.now(),
			snapshotId,
			lastTurn: this.currentTurn,
		};

		// Evict oldest if over capacity
		if (!existing && this.entries.size >= this.maxEntries) {
			this.evictOldest();
		}

		this.entries.set(filePath, entry);
		return entry;
	}

	/**
	 * Mark a file as dirty (content changed by our tools).
	 */
	markDirty(filePath: string): ActiveContextEntry | undefined {
		const entry = this.entries.get(filePath);
		if (entry) {
			entry.state = "dirty";
			entry.lastAccessed = Date.now();
		}
		return entry;
	}

	/**
	 * Mark a file as changed with external mutation detection.
	 */
	markChanged(filePath: string): ActiveContextEntry | undefined {
		const entry = this.entries.get(filePath);
		if (entry) {
			entry.state = "changed";
			entry.externallyModified = true;
			entry.lastAccessed = Date.now();
		}
		return entry;
	}

	/**
	 * Advance to the next turn. Marks inactive entries that haven't been
	 * accessed in maxTurnsInactive turns.
	 */
	advanceTurn(): void {
		this.currentTurn++;

		for (const entry of this.entries.values()) {
			if (
				entry.state === "active" &&
				entry.lastTurn !== undefined &&
				this.currentTurn - entry.lastTurn > this.maxTurnsInactive
			) {
				entry.state = "inactive";
			}
		}

		// TTL-based inactivity
		if (this.ttlMs) {
			const now = Date.now();
			for (const entry of this.entries.values()) {
				if (entry.state === "active" && now - entry.lastAccessed > this.ttlMs) {
					entry.state = "inactive";
				}
			}
		}
	}

	/**
	 * Get the ACR state for a file.
	 */
	getState(filePath: string): ACRState {
		const entry = this.entries.get(filePath);
		if (!entry) return "unknown";
		return entry.state;
	}

	/**
	 * Get the full entry for a file.
	 */
	getEntry(filePath: string): ActiveContextEntry | undefined {
		return this.entries.get(filePath);
	}

	/**
	 * Detect external mutations by comparing current mtime/size with snapshot.
	 * Returns true if externally modified.
	 */
	detectExternalMutation(filePath: string, knownMtimeMs: number, knownSize: number): boolean {
		try {
			const stat = statSync(filePath);
			if (stat.mtimeMs !== knownMtimeMs || stat.size !== knownSize) {
				this.markChanged(filePath);
				return true;
			}
			return false;
		} catch {
			// File may have been deleted
			this.markChanged(filePath);
			return true;
		}
	}

	/**
	 * Evict an entry.
	 */
	evict(filePath: string): void {
		const entry = this.entries.get(filePath);
		if (entry) {
			entry.state = "evicted";
			// Keep the entry but mark as evicted
		}
	}

	/**
	 * Remove an entry entirely.
	 */
	remove(filePath: string): void {
		this.entries.delete(filePath);
	}

	/**
	 * Get all entries.
	 */
	getAllEntries(): ActiveContextEntry[] {
		return Array.from(this.entries.values());
	}

	/**
	 * Clear all entries.
	 */
	clear(): void {
		this.entries.clear();
		this.currentTurn = 0;
	}

	/**
	 * Get the current turn number.
	 */
	getCurrentTurn(): number {
		return this.currentTurn;
	}

	/**
	 * Get entry count.
	 */
	get size(): number {
		return this.entries.size;
	}

	private evictOldest(): void {
		let oldest: ActiveContextEntry | undefined;
		for (const entry of this.entries.values()) {
			if (!oldest || entry.lastAccessed < oldest.lastAccessed) {
				oldest = entry;
			}
		}
		if (oldest) {
			this.evict(oldest.filePath);
		}
	}
}
