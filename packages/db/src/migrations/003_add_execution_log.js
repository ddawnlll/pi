"use strict";
/**
 * Add execution_log column to plan_executions table.
 *
 * This column stores the execution log content for each plan execution,
 * allowing logs to persist across system restarts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
/**
 * Apply the migration.
 */
async function up(db) {
    await db.schema
        .alterTable("plan_executions")
        .addColumn("execution_log", "text")
        .execute();
}
/**
 * Rollback the migration.
 */
async function down(db) {
    await db.schema
        .alterTable("plan_executions")
        .dropColumn("execution_log")
        .execute();
}
