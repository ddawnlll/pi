/**
 * Migration 010: Add proposal scoring tables.
 *
 * Creates the proposal_rubrics and proposal_scores tables for
 * the Proposal Scoring Engine (P16.C).
 *
 * proposal_rubrics stores scoring rubrics with named criteria,
 * each having a weight and max score. proposal_scores stores
 * evaluation results linking a proposal to a rubric with
 * individual criterion scores and computed totals.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	// ── proposal_rubrics ──────────────────────────────────────────────

	await db.schema
		.createTable("proposal_rubrics")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("project_id", "uuid", (col) => col.notNull().references("projects.id").onDelete("cascade"))
		.addColumn("name", "varchar(255)", (col) => col.notNull())
		.addColumn("description", "text")
		.addColumn("criteria", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema.createIndex("idx_proposal_rubrics_project_id").on("proposal_rubrics").column("project_id").execute();

	await db.schema.createIndex("idx_proposal_rubrics_name").on("proposal_rubrics").column("name").execute();

	// ── proposal_scores ───────────────────────────────────────────────

	await db.schema
		.createTable("proposal_scores")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("proposal_id", "uuid", (col) => col.notNull().references("proposals.id").onDelete("cascade"))
		.addColumn("rubric_id", "uuid", (col) => col.notNull().references("proposal_rubrics.id").onDelete("cascade"))
		.addColumn("scores", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
		.addColumn("total_score", "real", (col) => col.notNull())
		.addColumn("max_score", "real", (col) => col.notNull())
		.addColumn("summary", "text")
		.addColumn("scored_by", "varchar(100)", (col) => col.notNull().defaultTo("system"))
		.addColumn("scored_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema.createIndex("idx_proposal_scores_proposal_id").on("proposal_scores").column("proposal_id").execute();

	await db.schema.createIndex("idx_proposal_scores_rubric_id").on("proposal_scores").column("rubric_id").execute();

	// Unique constraint: one score entry per proposal per rubric
	await db.schema
		.createIndex("idx_proposal_scores_unique_proposal_rubric")
		.on("proposal_scores")
		.columns(["proposal_id", "rubric_id"])
		.unique()
		.execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropTable("proposal_scores").ifExists().execute();
	await db.schema.dropTable("proposal_rubrics").ifExists().execute();
}
