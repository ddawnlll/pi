"use strict";
/**
 * Initial schema migration.
 *
 * Creates the core execution hierarchy tables:
 * - projects
 * - plan_executions
 * - workspace_executions
 * - journal_events
 * - workspace_logs
 *
 * Also creates indexes for common query patterns.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
/**
 * Apply the initial migration.
 */
async function up(db) {
    // Projects table
    await db.schema
        .createTable("projects")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn("gen_random_uuid")))
        .addColumn("name", "varchar(255)", (col) => col.notNull())
        .addColumn("description", "text")
        .addColumn("root_path", "text")
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .execute();
    // Plan executions table
    await db.schema
        .createTable("plan_executions")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn("gen_random_uuid")))
        .addColumn("project_id", "uuid", (col) => col.notNull().references("projects.id").onDelete("cascade"))
        .addColumn("phase", "varchar(255)", (col) => col.notNull())
        .addColumn("title", "text", (col) => col.notNull())
        .addColumn("status", "varchar(50)", (col) => col.notNull().defaultTo("running"))
        .addColumn("started_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .addColumn("completed_at", "timestamptz")
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .execute();
    // Workspace executions table
    await db.schema
        .createTable("workspace_executions")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn("gen_random_uuid")))
        .addColumn("plan_execution_id", "uuid", (col) => col.notNull().references("plan_executions.id").onDelete("cascade"))
        .addColumn("workspace_id", "varchar(255)", (col) => col.notNull())
        .addColumn("title", "text", (col) => col.notNull())
        .addColumn("stage", "varchar(50)", (col) => col.notNull().defaultTo("pending"))
        .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
        .addColumn("error_message", "text")
        .addColumn("started_at", "timestamptz")
        .addColumn("completed_at", "timestamptz")
        .addColumn("metadata", "jsonb")
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .execute();
    // Journal events table
    await db.schema
        .createTable("journal_events")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn("gen_random_uuid")))
        .addColumn("plan_execution_id", "uuid", (col) => col.notNull().references("plan_executions.id").onDelete("cascade"))
        .addColumn("workspace_execution_id", "uuid")
        .addColumn("event_type", "varchar(100)", (col) => col.notNull())
        .addColumn("timestamp", "timestamptz", (col) => col.notNull())
        .addColumn("data", "jsonb")
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .execute();
    // Workspace logs table
    await db.schema
        .createTable("workspace_logs")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn("gen_random_uuid")))
        .addColumn("workspace_execution_id", "uuid", (col) => col.notNull().references("workspace_executions.id").onDelete("cascade"))
        .addColumn("stream", "varchar(50)", (col) => col.notNull())
        .addColumn("line_number", "integer", (col) => col.notNull())
        .addColumn("content", "text", (col) => col.notNull())
        .addColumn("timestamp", "timestamptz", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .execute();
    // Performance indexes
    await db.schema.createIndex("idx_plan_executions_project_id").on("plan_executions").column("project_id").execute();
    await db.schema.createIndex("idx_plan_executions_status").on("plan_executions").column("status").execute();
    await db.schema
        .createIndex("idx_workspace_executions_plan_id")
        .on("workspace_executions")
        .column("plan_execution_id")
        .execute();
    await db.schema.createIndex("idx_workspace_executions_stage").on("workspace_executions").column("stage").execute();
    await db.schema.createIndex("idx_journal_events_plan_id").on("journal_events").column("plan_execution_id").execute();
    await db.schema.createIndex("idx_journal_events_timestamp").on("journal_events").column("timestamp").execute();
    await db.schema
        .createIndex("idx_workspace_logs_ws_exec_id")
        .on("workspace_logs")
        .column("workspace_execution_id")
        .execute();
}
/**
 * Rollback the initial migration.
 */
async function down(db) {
    await db.schema.dropTable("workspace_logs").ifExists().execute();
    await db.schema.dropTable("journal_events").ifExists().execute();
    await db.schema.dropTable("workspace_executions").ifExists().execute();
    await db.schema.dropTable("plan_executions").ifExists().execute();
    await db.schema.dropTable("projects").ifExists().execute();
}
