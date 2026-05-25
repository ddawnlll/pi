/**
 * Migration 011: Observability Events (25.A).
 *
 * Creates the observability_events table with trace IDs, span IDs,
 * and correlation model for distributed tracing across the execution
 * hierarchy.
 *
 * This table complements journal_events with structured trace/span/correlation
 * data for observability and debugging. Unlike journal_events which captures
 * execution progress, observability_events is designed for distributed tracing
 * with parent-child span relationships.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	// ── observability_events ──────────────────────────────────────────

	await db.schema
		.createTable("observability_events")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		// Trace identifiers for distributed tracing
		.addColumn("trace_id", "uuid", (col) => col.notNull())
		.addColumn("span_id", "uuid", (col) => col.notNull())
		.addColumn("parent_span_id", "uuid")
		// Cross-cutting correlation identifier
		.addColumn("correlation_id", "varchar(255)")
		// Event metadata
		.addColumn("event_type", "varchar(100)", (col) => col.notNull())
		.addColumn("source", "varchar(100)", (col) => col.notNull())
		.addColumn("severity", "varchar(20)", (col) => col.notNull().defaultTo("info"))
		.addColumn("status", "varchar(20)", (col) => col.notNull().defaultTo("unknown"))
		.addColumn("name", "varchar(255)", (col) => col.notNull())
		.addColumn("message", "text")
		// Execution hierarchy correlation
		.addColumn("project_id", "uuid")
		.addColumn("plan_execution_id", "uuid")
		.addColumn("workspace_execution_id", "uuid")
		// Performance data
		.addColumn("duration_ms", "integer")
		// Flexible payload and error info
		.addColumn("data", "jsonb")
		.addColumn("error", "text")
		// Timestamps
		.addColumn("timestamp", "timestamptz", (col) => col.notNull())
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	// ── Indexes ───────────────────────────────────────────────────────

	// Trace lookup: find all spans for a trace
	await db.schema.createIndex("idx_observability_trace_id").on("observability_events").column("trace_id").execute();

	// Span lookup by ID
	await db.schema.createIndex("idx_observability_span_id").on("observability_events").column("span_id").execute();

	// Parent span traversal
	await db.schema
		.createIndex("idx_observability_parent_span_id")
		.on("observability_events")
		.column("parent_span_id")
		.execute();

	// Correlation ID queries
	await db.schema
		.createIndex("idx_observability_correlation_id")
		.on("observability_events")
		.column("correlation_id")
		.execute();

	// Event type filtering
	await db.schema
		.createIndex("idx_observability_event_type")
		.on("observability_events")
		.column("event_type")
		.execute();

	// Source filtering
	await db.schema.createIndex("idx_observability_source").on("observability_events").column("source").execute();

	// Execution hierarchy queries
	await db.schema
		.createIndex("idx_observability_project_id")
		.on("observability_events")
		.column("project_id")
		.execute();

	await db.schema
		.createIndex("idx_observability_plan_exec_id")
		.on("observability_events")
		.column("plan_execution_id")
		.execute();

	await db.schema
		.createIndex("idx_observability_ws_exec_id")
		.on("observability_events")
		.column("workspace_execution_id")
		.execute();

	// Temporal queries
	await db.schema.createIndex("idx_observability_timestamp").on("observability_events").column("timestamp").execute();

	// Composite: trace + timestamp for ordered trace retrieval
	await db.schema
		.createIndex("idx_observability_trace_ts")
		.on("observability_events")
		.columns(["trace_id", "timestamp"])
		.execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropIndex("idx_observability_trace_ts").ifExists().execute();
	await db.schema.dropIndex("idx_observability_timestamp").ifExists().execute();
	await db.schema.dropIndex("idx_observability_ws_exec_id").ifExists().execute();
	await db.schema.dropIndex("idx_observability_plan_exec_id").ifExists().execute();
	await db.schema.dropIndex("idx_observability_project_id").ifExists().execute();
	await db.schema.dropIndex("idx_observability_source").ifExists().execute();
	await db.schema.dropIndex("idx_observability_event_type").ifExists().execute();
	await db.schema.dropIndex("idx_observability_correlation_id").ifExists().execute();
	await db.schema.dropIndex("idx_observability_parent_span_id").ifExists().execute();
	await db.schema.dropIndex("idx_observability_span_id").ifExists().execute();
	await db.schema.dropIndex("idx_observability_trace_id").ifExists().execute();
	await db.schema.dropTable("observability_events").ifExists().execute();
}
