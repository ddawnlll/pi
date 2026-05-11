/**
 * Transaction helpers with retry semantics.
 *
 * Provides transaction execution with configurable retry logic
 * for handling serialization failures under concurrent writes.
 */

import type { Kysely, Transaction } from "kysely";
import { type DbConfig, loadDbConfig } from "./config.js";
import type { Database } from "./types.js";

/**
 * Execute a function within a transaction with retry logic.
 *
 * Retries on serialization failures (40001) with exponential backoff.
 *
 * @param db - Kysely database instance
 * @param fn - Function to execute within transaction
 * @param config - Optional DB config for retry settings
 * @returns Result of the function
 */
export async function withTransaction<T>(
	db: Kysely<Database>,
	fn: (trx: Transaction<Database>) => Promise<T>,
	config?: DbConfig,
): Promise<T> {
	const cfg = config ?? loadDbConfig();
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
		try {
			return await db.transaction().execute(fn);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Only retry on serialization failures (40001) or deadlock (40P01)
			const pgError = error as { code?: string };
			if (pgError.code !== "40001" && pgError.code !== "40P01") {
				throw error;
			}

			if (attempt < cfg.maxRetries) {
				const delay = Math.min(cfg.retryBaseDelayMs * 2 ** (attempt - 1), cfg.retryMaxDelayMs);
				await sleep(delay);
			}
		}
	}

	throw lastError ?? new Error("Transaction failed after retries");
}

/**
 * Sleep for a given duration.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a UUID v4.
 *
 * @returns UUID string
 */
export function generateId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	// Lazy import uuid for older Node versions
	const _id = 0;
	const hex = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
	return hex.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Get current ISO timestamp.
 *
 * @returns ISO 8601 timestamp string
 */
export function now(): string {
	return new Date().toISOString();
}
