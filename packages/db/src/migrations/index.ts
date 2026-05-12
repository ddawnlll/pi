/**
 * Migration runner.
 *
 * Manages schema migrations with ordered execution and rollback support.
 * Tracks applied migrations in a `_migrations` table.
 */

import type { Kysely } from "kysely";
import type { Database } from "../types.js";

/**
 * Migration definition
 */
export interface Migration {
	/** Migration version number */
	version: number;
	/** Human-readable name */
	name: string;
	/** Apply migration */
	up: (db: Kysely<Database>) => Promise<void>;
	/** Rollback migration */
	down: (db: Kysely<Database>) => Promise<void>;
}

// Import migrations
import * as m001 from "./001_initial.js";
import * as m002 from "./002_listen_notify.js";
import * as m003 from "./003_add_execution_log.js";

/**
 * All registered migrations in version order.
 */
const migrations: Migration[] = [
	{ version: 1, name: "initial", up: m001.up, down: m001.down },
	{ version: 2, name: "listen_notify", up: m002.up, down: m002.down },
	{ version: 3, name: "add_execution_log", up: m003.up, down: m003.down },
];

/**
 * Run all pending migrations.
 *
 * @param db - Kysely database instance
 */
export async function runMigrations(db: Kysely<Database>): Promise<void> {
	// Ensure migrations tracking table exists
	await db.schema
		.createTable("_migrations")
		.ifNotExists()
		.addColumn("version", "integer", (col) => col.primaryKey())
		.addColumn("name", "varchar(255)", (col) => col.notNull())
		.addColumn("applied_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn<any>("now")))
		.execute();

	// Get applied versions
	const applied = await db.selectFrom("_migrations").select("version").execute();
	const appliedVersions = new Set(applied.map((r) => r.version));

	// Run pending migrations in order
	for (const migration of migrations) {
		if (!appliedVersions.has(migration.version)) {
			console.log(`[db] Running migration ${migration.version}: ${migration.name}`);
			await migration.up(db);
			await db.insertInto("_migrations").values({ version: migration.version, name: migration.name }).execute();
			console.log(`[db] Migration ${migration.version} applied`);
		}
	}
}

/**
 * Rollback the last N migrations.
 *
 * @param db - Kysely database instance
 * @param steps - Number of migrations to rollback (default: 1)
 */
export async function rollbackMigrations(db: Kysely<Database>, steps = 1): Promise<void> {
	const applied = await db.selectFrom("_migrations").selectAll().orderBy("version", "desc").limit(steps).execute();

	for (const row of applied.reverse()) {
		const migration = migrations.find((m) => m.version === row.version);
		if (!migration) {
			console.warn(`[db] Unknown migration version ${row.version}, skipping rollback`);
			continue;
		}

		console.log(`[db] Rolling back migration ${migration.version}: ${migration.name}`);
		await migration.down(db);
		await db.deleteFrom("_migrations").where("version", "=", row.version).execute();
		console.log(`[db] Migration ${migration.version} rolled back`);
	}
}

/**
 * Get the list of applied migrations.
 *
 * @param db - Kysely database instance
 * @returns Array of applied migration info
 */
export async function getAppliedMigrations(
	db: Kysely<Database>,
): Promise<{ version: number; name: string; appliedAt: string }[]> {
	try {
		return await db
			.selectFrom("_migrations")
			.select(["version", "name", "applied_at as appliedAt"])
			.orderBy("version", "asc")
			.execute();
	} catch {
		return [];
	}
}

export { migrations };
