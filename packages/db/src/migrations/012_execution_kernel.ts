import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
	await db.schema
		.createTable("attempts")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("workspace_execution_id", "uuid", (col) => col.notNull())
		.addColumn("plan_execution_id", "uuid", (col) => col.notNull())
		.addColumn("project_id", "uuid", (col) => col.notNull())
		.addColumn("current_state", "varchar(64)", (col) => col.notNull())
		.addColumn("version", "integer", (col) => col.notNull().defaultTo(0))
		.addColumn("current_deadline_at", "timestamptz")
		.addColumn("metadata", "jsonb")
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable("attempt_events")
		.addColumn("seq", "bigserial", (col) => col.primaryKey())
		.addColumn("event_id", "uuid", (col) => col.notNull().unique())
		.addColumn("attempt_id", "uuid", (col) => col.notNull())
		.addColumn("plan_execution_id", "uuid", (col) => col.notNull())
		.addColumn("workspace_execution_id", "uuid", (col) => col.notNull())
		.addColumn("event_type", "varchar(128)", (col) => col.notNull())
		.addColumn("event_version", "integer", (col) => col.notNull())
		.addColumn("payload", "jsonb")
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable("attempt_transitions")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("attempt_id", "uuid", (col) => col.notNull())
		.addColumn("from_state", "varchar(64)", (col) => col.notNull())
		.addColumn("to_state", "varchar(64)", (col) => col.notNull())
		.addColumn("expected_version", "integer", (col) => col.notNull())
		.addColumn("next_version", "integer", (col) => col.notNull())
		.addColumn("event_id", "uuid", (col) => col.notNull())
		.addColumn("metadata", "jsonb")
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable("controller_inbox")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("attempt_id", "uuid", (col) => col.notNull())
		.addColumn("plan_execution_id", "uuid", (col) => col.notNull())
		.addColumn("workspace_execution_id", "uuid", (col) => col.notNull())
		.addColumn("message_type", "varchar(128)", (col) => col.notNull())
		.addColumn("payload", "jsonb")
		.addColumn("dedupe_key", "varchar(255)", (col) => col.notNull().unique())
		.addColumn("processed_at", "timestamptz")
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable("controller_leases")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("attempt_id", "uuid", (col) => col.notNull().unique())
		.addColumn("controller_id", "varchar(255)", (col) => col.notNull())
		.addColumn("lease_expires_at", "timestamptz", (col) => col.notNull())
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();

	await db.schema
		.createTable("handoff_queue")
		.addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
		.addColumn("attempt_id", "uuid", (col) => col.notNull())
		.addColumn("plan_execution_id", "uuid", (col) => col.notNull())
		.addColumn("workspace_execution_id", "uuid", (col) => col.notNull())
		.addColumn("status", "varchar(64)", (col) => col.notNull())
		.addColumn("reason", "text")
		.addColumn("required", "boolean", (col) => col.notNull().defaultTo(true))
		.addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropTable("handoff_queue").ifExists().execute();
	await db.schema.dropTable("controller_leases").ifExists().execute();
	await db.schema.dropTable("controller_inbox").ifExists().execute();
	await db.schema.dropTable("attempt_transitions").ifExists().execute();
	await db.schema.dropTable("attempt_events").ifExists().execute();
	await db.schema.dropTable("attempts").ifExists().execute();
}
