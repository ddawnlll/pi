/**
 * Idea Deduper — 25.K
 *
 * Deduplication engine for preventing redundant idea scouting sessions.
 * Uses content-based SHA-256 hashing with configurable similarity matching
 * and dedup window expiry.
 *
 * Key design:
 * - Each session's signal signature is hashed deterministically.
 * - Hashes are tracked with timestamps in an internal Map.
 * - A duplicate is detected if the same hash appears within the window.
 * - Pruning removes expired entries; clear resets all state.
 * - Disabling dedup bypasses all checks.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the IdeaDeduper.
 */
export interface IdeaDeduperConfig {
	/**
	 * Whether deduplication is enabled.
	 * Default: true
	 */
	enabled: boolean;

	/**
	 * Time window in milliseconds within which duplicate work is suppressed.
	 * Default: 300_000 (5 minutes)
	 */
	windowMs: number;
}

/**
 * Default configuration for IdeaDeduper.
 */
export const DEFAULT_IDEA_DEDUPER_CONFIG: IdeaDeduperConfig = {
	enabled: true,
	windowMs: 300_000,
};

// ---------------------------------------------------------------------------
// Runtime Statistics
// ---------------------------------------------------------------------------

/**
 * Runtime statistics for the IdeaDeduper.
 */
export interface IdeaDeduperStats {
	/** Number of tracked entries in the history */
	historySize: number;
	/** Total number of duplicate detections */
	totalDeduped: number;
	/** Whether dedup is enabled */
	enabled: boolean;
	/** The dedup window in milliseconds */
	windowMs: number;
}

// ---------------------------------------------------------------------------
// Idea Deduper
// ---------------------------------------------------------------------------

/**
 * Prevents redundant idea scouting sessions by tracking content hashes
 * and suppressing duplicates within a configurable time window.
 *
 * Uses SHA-256 hashing for deterministic content signature computation.
 * Supports enable/disable toggling, window-based expiry, and pruning
 * of stale entries.
 */
export class IdeaDeduper {
	private config: IdeaDeduperConfig;
	private history: Map<string, number>; // hash -> timestamp
	private totalDeduped: number;

	/**
	 * Create a new IdeaDeduper.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<IdeaDeduperConfig>) {
		this.config = {
			enabled: config?.enabled ?? DEFAULT_IDEA_DEDUPER_CONFIG.enabled,
			windowMs: config?.windowMs ?? DEFAULT_IDEA_DEDUPER_CONFIG.windowMs,
		};
		this.history = new Map();
		this.totalDeduped = 0;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the deduper configuration.
	 */
	setConfig(config: Partial<IdeaDeduperConfig>): void {
		if (config.enabled !== undefined) this.config.enabled = config.enabled;
		if (config.windowMs !== undefined) this.config.windowMs = config.windowMs;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): IdeaDeduperConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Hashing
	// -----------------------------------------------------------------------

	/**
	 * Compute a deterministic content hash for deduplication.
	 *
	 * @param content - String content to hash.
	 * @returns SHA-256 hex hash.
	 */
	computeHash(content: string): string {
		return createHash("sha256").update(content).digest("hex");
	}

	// -----------------------------------------------------------------------
	// Dedup Operations
	// -----------------------------------------------------------------------

	/**
	 * Check if a given hash is a duplicate within the dedup window,
	 * and record it if it passes (not a duplicate or window expired).
	 *
	 * If dedup is disabled, always returns false and records the hash.
	 *
	 * @param hash - The hash to check and record.
	 * @returns true if this is a duplicate within the dedup window.
	 */
	checkAndRecord(hash: string): boolean {
		if (!this.config.enabled) {
			this.history.set(hash, Date.now());
			return false;
		}

		const now = Date.now();
		const existingTimestamp = this.history.get(hash);

		if (existingTimestamp !== undefined) {
			const age = now - existingTimestamp;
			if (age < this.config.windowMs) {
				this.totalDeduped++;
				return true; // Duplicate within window
			}
		}

		// Record or update timestamp
		this.history.set(hash, now);
		return false;
	}

	/**
	 * Check if a given hash is a duplicate within the dedup window,
	 * without recording it.
	 *
	 * @param hash - The hash to check.
	 * @returns true if this hash exists within the dedup window.
	 */
	isDuplicate(hash: string): boolean {
		if (!this.config.enabled) return false;
		const timestamp = this.history.get(hash);
		if (timestamp === undefined) return false;
		return Date.now() - timestamp < this.config.windowMs;
	}

	/**
	 * Record a hash with the current timestamp.
	 *
	 * @param hash - The hash to record.
	 */
	record(hash: string): void {
		if (!this.config.enabled) return;
		this.history.set(hash, Date.now());
	}

	// -----------------------------------------------------------------------
	// Maintenance
	// -----------------------------------------------------------------------

	/**
	 * Prune expired entries from the dedup history.
	 *
	 * Removes all entries whose age exceeds the dedup window.
	 */
	prune(): void {
		const now = Date.now();
		for (const [hash, timestamp] of this.history) {
			if (now - timestamp >= this.config.windowMs) {
				this.history.delete(hash);
			}
		}
	}

	/**
	 * Clear all history and reset counters.
	 */
	clear(): void {
		this.history.clear();
		this.totalDeduped = 0;
	}

	// -----------------------------------------------------------------------
	// Observability
	// -----------------------------------------------------------------------

	/**
	 * Get the number of tracked entries in the history.
	 */
	get size(): number {
		return this.history.size;
	}

	/**
	 * Get runtime statistics.
	 */
	getStats(): IdeaDeduperStats {
		return {
			historySize: this.history.size,
			totalDeduped: this.totalDeduped,
			enabled: this.config.enabled,
			windowMs: this.config.windowMs,
		};
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an IdeaDeduper with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new IdeaDeduper instance.
 */
export function createIdeaDeduper(config?: Partial<IdeaDeduperConfig>): IdeaDeduper {
	return new IdeaDeduper(config);
}
