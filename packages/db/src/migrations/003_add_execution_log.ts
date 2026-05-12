/**
 * Add execution_log column to plan_executions table.
 *
 * This column stores the execution log content for each plan execution,
 * allowing logs to persist across system restarts.
 */

import type { Kysely } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema.alterTable("plan_executions").addColumn("execution_log", "text").execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.alterTable("plan_executions").dropColumn("execution_log").execute();
}
