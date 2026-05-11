/**
 * Kysely type-safe query layer configuration.
 *
 * Sets up Kysely with the PostgreSQL pool for type-safe database access.
 */

import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DbConfig } from "./config.js";
import { loadDbConfig } from "./config.js";
import type { Database } from "./types.js";

const { Pool } = pg;

let db: Kysely<Database> | null = null;

/**
 * Get or create the Kysely database instance.
 *
 * @param config - Database configuration (optional)
 * @returns Kysely database instance
 */
export function getKysely(config?: DbConfig): Kysely<Database> {
	if (db) return db;

	const cfg = config ?? loadDbConfig();

	const dialect = new PostgresDialect({
		pool: new Pool({
			host: cfg.host,
			port: cfg.port,
			database: cfg.database,
			user: cfg.user,
			password: cfg.password,
			max: cfg.poolMax,
			idleTimeoutMillis: cfg.idleTimeoutMs,
			connectionTimeoutMillis: cfg.connectionTimeoutMs,
			ssl: cfg.ssl,
		}),
	});

	db = new Kysely<Database>({ dialect });

	return db;
}

/**
 * Close the Kysely database instance.
 */
export async function closeKysely(): Promise<void> {
	if (db) {
		await db.destroy();
		db = null;
	}
}

/**
 * Reset the Kysely instance (useful for testing).
 */
export function resetKysely(): void {
	db = null;
}
