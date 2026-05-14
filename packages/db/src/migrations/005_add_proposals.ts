/**
 * Migration 005: Add proposals table.
 *
 * Creates the proposals table for the Proposal Inbox (P8.B).
 *
 * The proposals table stores plan proposals with their evidence
 * and audit trail, enabling persistence, review, and approval
 * gating before execution.
 */

import type { Kysely } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema
		.createTable("proposals")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn<any>("gen_random_uuid")))
		.addColumn("project_id", "uuid", (col) => col.notNull().references("projects.id").onDelete("cascade"))
		.addColumn("proposal_key", "varchar(255)", (col) => col.notNull().unique())
		.addColumn("title", "text", (col) => col.notNull())
		.addColumn("phase", "varchar(100)", (col) => col.notNull())
		.addColumn("status", "varchar(20)", (col) => col.notNull().defaultTo("pending"))
		.addColumn("evidence", "jsonb", (col) => col.notNull())
		.addColumn("audit_trail", "jsonb", (col) => col.notNull().defaultTo("[]"))
		.addColumn("submitted_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn<any>("now")))
		.addColumn("actioned_at", "timestamptz")
		.addColumn("rejection_reason", "text")
		.addColumn("metadata", "jsonb")
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn<any>("now")))
		.addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn<any>("now")))
		.execute();

	// Indexes for common query patterns
	await db.schema.createIndex("idx_proposals_project_id").on("proposals").column("project_id").execute();
	await db.schema.createIndex("idx_proposals_status").on("proposals").column("status").execute();
	await db.schema.createIndex("idx_proposals_phase").on("proposals").column("phase").execute();
	await db.schema.createIndex("idx_proposals_submitted_at").on("proposals").column("submitted_at").execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropTable("proposals").ifExists().execute();
}
