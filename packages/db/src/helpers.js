"use strict";
/**
 * Transaction helpers with retry semantics.
 *
 * Provides transaction execution with configurable retry logic
 * for handling serialization failures under concurrent writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTransaction = withTransaction;
exports.generateId = generateId;
exports.now = now;
const config_js_1 = require("./config.js");
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
async function withTransaction(db, fn, config) {
    const cfg = config !== null && config !== void 0 ? config : (0, config_js_1.loadDbConfig)();
    let lastError = null;
    for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
        try {
            return await db.transaction().execute(fn);
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            // Only retry on serialization failures (40001) or deadlock (40P01)
            const pgError = error;
            if (pgError.code !== "40001" && pgError.code !== "40P01") {
                throw error;
            }
            if (attempt < cfg.maxRetries) {
                const delay = Math.min(cfg.retryBaseDelayMs * Math.pow(2, (attempt - 1)), cfg.retryMaxDelayMs);
                await sleep(delay);
            }
        }
    }
    throw lastError !== null && lastError !== void 0 ? lastError : new Error("Transaction failed after retries");
}
/**
 * Sleep for a given duration.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Generate a UUID v4.
 *
 * @returns UUID string
 */
function generateId() {
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
function now() {
    return new Date().toISOString();
}
