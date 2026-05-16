/**
 * Migration 008: Add audit_events table.
 *
 * Creates the audit_events table for the Platform Audit Ledger (P11.M).
 *
 * The audit_events table records all platform action evaluations:
 * allowed, denied, pending-approval, approved, rejected, and rollback.
 * Events can be filtered by project, capability, workspace, proposal,
 * extension, skill, and memory source.
 *
 * The schema uses a flexible `data` JSONB column to support future
 * enterprise export without changing core event semantics.
 */

import type { Kysely } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema
		.createTable("audit_events")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn<any>("gen_random_uuid")))
		.addColumn("action", "varchar(255)", (col) => col.notNull())
		.addColumn("status", "varchar(50)", (col) => col.notNull())
		.addColumn("domain", "varchar(50)", (col) => col.notNull())
		.addColumn("actor", "varchar(255)")
		.addColumn("project_id", "uuid", (col) => col.references("projects.id").onDelete("set null"))
		.addColumn("capability", "varchar(255)")
		.addColumn("workspace_id", "varchar(255)")
		.addColumn("proposal_id", "uuid", (col) => col.references("proposals.id").onDelete("set null"))
		.addColumn("extension_id", "varchar(255)")
		.addColumn("skill_id", "varchar(255)")
		.addColumn("memory_source", "varchar(255)")
		.addColumn("reason", "text")
		.addColumn("data", "jsonb", (col) => col.notNull().defaultTo("{}"))
		.addColumn("timestamp", "timestamptz", (col) => col.notNull())
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn<any>("now")))
		.execute();

	// Indexes for common query patterns
	await db.schema.createIndex("idx_audit_events_action").on("audit_events").column("action").execute();
	await db.schema.createIndex("idx_audit_events_status").on("audit_events").column("status").execute();
	await db.schema.createIndex("idx_audit_events_domain").on("audit_events").column("domain").execute();
	await db.schema.createIndex("idx_audit_events_project_id").on("audit_events").column("project_id").execute();
	await db.schema.createIndex("idx_audit_events_capability").on("audit_events").column("capability").execute();
	await db.schema.createIndex("idx_audit_events_workspace_id").on("audit_events").column("workspace_id").execute();
	await db.schema.createIndex("idx_audit_events_proposal_id").on("audit_events").column("proposal_id").execute();
	await db.schema.createIndex("idx_audit_events_extension_id").on("audit_events").column("extension_id").execute();
	await db.schema.createIndex("idx_audit_events_skill_id").on("audit_events").column("skill_id").execute();
	await db.schema.createIndex("idx_audit_events_memory_source").on("audit_events").column("memory_source").execute();
	await db.schema.createIndex("idx_audit_events_timestamp").on("audit_events").column("timestamp").execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropTable("audit_events").ifExists().execute();
}
