/**
 * Migration 006: Add proposal source artifacts, plan-proposal link, and plan revisions.
 *
 * Enhances proposals with source artifact tracking (P8 output recording),
 * links plan_executions to proposals, and creates a plan_revisions table
 * for revision history tracking (P9.G2).
 */

import type { Kysely } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	// Add source artifact columns to proposals (AC 1: record proposal source)
	await db.schema
		.alterTable("proposals")
		.addColumn("source_artifacts", "jsonb", (col) => col.notNull().defaultTo("[]"))
		.addColumn("source_recorded_at", "timestamptz")
		.execute();

	// Add proposal_id to plan_executions (AC 2: link generated plan to proposal)
	await db.schema
		.alterTable("plan_executions")
		.addColumn("proposal_id", "uuid", (col) => col.references("proposals.id").onDelete("set null"))
		.execute();

	await db.schema.createIndex("idx_plan_executions_proposal_id").on("plan_executions").column("proposal_id").execute();

	// Create plan_revisions table (AC 3: track plan revision history)
	await db.schema
		.createTable("plan_revisions")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn<any>("gen_random_uuid")))
		.addColumn("plan_execution_id", "uuid", (col) =>
			col.notNull().references("plan_executions.id").onDelete("cascade"),
		)
		.addColumn("version_number", "integer", (col) => col.notNull())
		.addColumn("title", "text", (col) => col.notNull())
		.addColumn("content", "jsonb", (col) => col.notNull())
		.addColumn("status", "varchar(20)", (col) => col.notNull().defaultTo("draft"))
		.addColumn("diff_summary", "text")
		.addColumn("created_by", "varchar(255)")
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn<any>("now")))
		.execute();

	await db.schema
		.createIndex("idx_plan_revisions_plan_execution_id")
		.on("plan_revisions")
		.column("plan_execution_id")
		.execute();

	await db.schema
		.createIndex("idx_plan_revisions_version")
		.on("plan_revisions")
		.columns(["plan_execution_id", "version_number"])
		.unique()
		.execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropTable("plan_revisions").ifExists().execute();

	await db.schema.alterTable("plan_executions").dropColumn("proposal_id").execute();

	await db.schema.alterTable("proposals").dropColumn("source_recorded_at").execute();
	await db.schema.alterTable("proposals").dropColumn("source_artifacts").execute();
}
