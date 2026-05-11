/**
 * PostgreSQL connection pool management.
 *
 * Provides a singleton pool manager with lifecycle hooks
 * and configurable pool sizing from environment variables.
 */

import pg from "pg";
import type { DbConfig } from "./config.js";
import { loadDbConfig } from "./config.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Get or create the connection pool.
 *
 * @param config - Database configuration (optional, loads from env if omitted)
 * @returns PostgreSQL connection pool
 */
export function getPool(config?: DbConfig): pg.Pool {
	if (pool) return pool;

	const cfg = config ?? loadDbConfig();

	pool = new Pool({
		host: cfg.host,
		port: cfg.port,
		database: cfg.database,
		user: cfg.user,
		password: cfg.password,
		max: cfg.poolMax,
		idleTimeoutMillis: cfg.idleTimeoutMs,
		connectionTimeoutMillis: cfg.connectionTimeoutMs,
		ssl: cfg.ssl,
	});

	// Log pool errors (don't crash)
	pool.on("error", (err: Error) => {
		console.error("[db] Unexpected pool error:", err.message);
	});

	return pool;
}

/**
 * Close the connection pool.
 */
export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

/**
 * Get a client from the pool for transaction usage.
 *
 * @returns Pool client with release method
 */
export async function getClient(): Promise<pg.PoolClient> {
	const p = getPool();
	return p.connect();
}

/**
 * Reset the pool (useful for testing).
 */
export function resetPool(): void {
	pool = null;
}

/**
 * Check if pool is healthy by running a simple query.
 *
 * @returns True if database is reachable
 */
export async function healthCheck(): Promise<boolean> {
	try {
		const p = getPool();
		const result = await p.query("SELECT 1 AS ok");
		return result.rows[0]?.ok === 1;
	} catch {
		return false;
	}
}
