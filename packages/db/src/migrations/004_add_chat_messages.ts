/**
 * Migration: add chat_messages table.
 *
 * Stores chat messages sent via the dashboard chat panel,
 * linked to projects for context.
 */

import type { Kysely } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	// Chat messages table
	await db.schema
		.createTable("chat_messages")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(db.fn<any>("gen_random_uuid")))
		.addColumn("project_id", "uuid", (col) => col.notNull().references("projects.id").onDelete("cascade"))
		.addColumn("role", "varchar(50)", (col) => col.notNull()) // "user" | "assistant"
		.addColumn("content", "text", (col) => col.notNull())
		.addColumn("message_index", "integer", (col) => col.notNull()) // ordering within a session
		.addColumn("session_id", "uuid", (col) => col.notNull()) // groups messages into chat sessions
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn<any>("now")))
		.execute();

	// Indexes for common queries
	await db.schema
		.createIndex("idx_chat_messages_project_session")
		.on("chat_messages")
		.columns(["project_id", "session_id"])
		.execute();

	await db.schema
		.createIndex("idx_chat_messages_session_index")
		.on("chat_messages")
		.columns(["session_id", "message_index"])
		.execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropTable("chat_messages").ifExists().execute();
}
