/**
 * Migration 009: Schema alignment with new architecture.
 *
 * Adds columns and tables required by the redesigned state store:
 * - plan_executions: handoff_started_at, error_message
 * - control_requests: persistent pause/stop/cancel/resume requests
 * - transcript_events: worker transcript events (was in-memory only)
 * - Denormalized project_id columns for faster multi-project queries
 * - workspace_logs: plan_execution_id denorm column
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	// ── plan_executions ──────────────────────────────────────────────────

	// Add handoff_started_at for awaiting_handoff tracking
	await db.schema.alterTable("plan_executions").addColumn("handoff_started_at", "timestamptz").execute();

	// Add error_message
	await db.schema.alterTable("plan_executions").addColumn("error_message", "text").execute();

	// ── control_requests ────────────────────────────────────────────────

	await db.schema
		.createTable("control_requests")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("plan_execution_id", "uuid", (col) =>
			col.notNull().references("plan_executions.id").onDelete("cascade"),
		)
		.addColumn("project_id", "uuid", (col) => col.notNull().references("projects.id").onDelete("cascade"))
		.addColumn("type", "varchar(50)", (col) => col.notNull())
		.addColumn("reason", "text")
		.addColumn("requested_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn("acknowledged", "boolean", (col) => col.notNull().defaultTo(false))
		.addColumn("acknowledged_at", "timestamptz")
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createIndex("idx_control_requests_plan_exec_id")
		.on("control_requests")
		.column("plan_execution_id")
		.execute();

	await db.schema
		.createIndex("idx_control_requests_pending")
		.on("control_requests")
		.columns(["plan_execution_id", "acknowledged"])
		.execute();

	// ── transcript_events ───────────────────────────────────────────────

	await db.schema
		.createTable("transcript_events")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("workspace_execution_id", "uuid", (col) =>
			col.notNull().references("workspace_executions.id").onDelete("cascade"),
		)
		.addColumn("plan_execution_id", "uuid", (col) =>
			col.notNull().references("plan_executions.id").onDelete("cascade"),
		)
		.addColumn("project_id", "uuid", (col) => col.notNull().references("projects.id").onDelete("cascade"))
		.addColumn("role", "varchar(50)", (col) => col.notNull())
		.addColumn("content", "text", (col) => col.notNull())
		.addColumn("token_count", "integer")
		.addColumn("metadata", "jsonb")
		.addColumn("sequence", "integer", (col) => col.notNull())
		.addColumn("timestamp", "timestamptz", (col) => col.notNull())
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createIndex("idx_transcript_ws_exec_id")
		.on("transcript_events")
		.column("workspace_execution_id")
		.execute();

	await db.schema
		.createIndex("idx_transcript_plan_exec_id")
		.on("transcript_events")
		.column("plan_execution_id")
		.execute();

	// ── Denormalized project_id columns ─────────────────────────────────

	// workspace_executions: add project_id (denorm for fast filtering)
	await db.schema
		.alterTable("workspace_executions")
		.addColumn("project_id", "uuid", (col) => col.references("projects.id").onDelete("cascade"))
		.execute();

	// journal_events: add project_id
	await db.schema
		.alterTable("journal_events")
		.addColumn("project_id", "uuid", (col) => col.references("projects.id").onDelete("cascade"))
		.execute();

	// workspace_logs: add project_id and plan_execution_id
	await db.schema
		.alterTable("workspace_logs")
		.addColumn("project_id", "uuid", (col) => col.references("projects.id").onDelete("cascade"))
		.execute();

	await db.schema
		.alterTable("workspace_logs")
		.addColumn("plan_execution_id", "uuid", (col) => col.references("plan_executions.id").onDelete("cascade"))
		.execute();

	// ── Indexes on new denorm columns ───────────────────────────────────

	await db.schema
		.createIndex("idx_workspace_executions_project_id")
		.on("workspace_executions")
		.column("project_id")
		.execute();

	await db.schema.createIndex("idx_journal_events_project_id").on("journal_events").column("project_id").execute();

	await db.schema.createIndex("idx_workspace_logs_project_id").on("workspace_logs").column("project_id").execute();

	await db.schema
		.createIndex("idx_workspace_logs_plan_exec_id")
		.on("workspace_logs")
		.column("plan_execution_id")
		.execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	// Remove indexes
	await db.schema.dropIndex("idx_workspace_logs_plan_exec_id").ifExists().execute();
	await db.schema.dropIndex("idx_workspace_logs_project_id").ifExists().execute();
	await db.schema.dropIndex("idx_journal_events_project_id").ifExists().execute();
	await db.schema.dropIndex("idx_workspace_executions_project_id").ifExists().execute();
	await db.schema.dropIndex("idx_transcript_plan_exec_id").ifExists().execute();
	await db.schema.dropIndex("idx_transcript_ws_exec_id").ifExists().execute();
	await db.schema.dropIndex("idx_control_requests_pending").ifExists().execute();
	await db.schema.dropIndex("idx_control_requests_plan_exec_id").ifExists().execute();

	// Drop denorm columns
	await db.schema.alterTable("workspace_logs").dropColumn("plan_execution_id").execute();
	await db.schema.alterTable("workspace_logs").dropColumn("project_id").execute();
	await db.schema.alterTable("journal_events").dropColumn("project_id").execute();
	await db.schema.alterTable("workspace_executions").dropColumn("project_id").execute();

	// Drop tables
	await db.schema.dropTable("transcript_events").ifExists().execute();
	await db.schema.dropTable("control_requests").ifExists().execute();

	// Drop columns from plan_executions
	await db.schema.alterTable("plan_executions").dropColumn("error_message").execute();
	await db.schema.alterTable("plan_executions").dropColumn("handoff_started_at").execute();
}
