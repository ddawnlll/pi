/**
 * LISTEN/NOTIFY infrastructure migration.
 *
 * Creates PostgreSQL triggers and functions for real-time event streaming.
 * When journal events are inserted, a NOTIFY is sent to the
 * "plan_events" channel for SSE forwarding.
 */

import { type Kysely, sql } from "kysely";
import type { Database } from "../types.js";

/**
 * Apply the LISTEN/NOTIFY migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	// Create NOTIFY function for journal events
	await sql`
	     CREATE OR REPLACE FUNCTION notify_journal_event()
	     RETURNS trigger AS $$
	     BEGIN
	       PERFORM pg_notify(
	         'plan_events',
	         json_build_object(
	           'id', NEW.id,
	           'plan_execution_id', NEW.plan_execution_id,
	           'workspace_execution_id', NEW.workspace_execution_id,
	           'event_type', NEW.event_type,
	           'timestamp', NEW.timestamp,
	           'data', NEW.data
	         )::text
	       );
	       RETURN NEW;
	     END;
	     $$ LANGUAGE plpgsql;
	   `.execute(db);

	// Create trigger on journal_events table
	await sql`
	     CREATE TRIGGER journal_event_notify
	     AFTER INSERT ON journal_events
	     FOR EACH ROW
	     EXECUTE FUNCTION notify_journal_event();
	   `.execute(db);

	// Create NOTIFY function for workspace log events
	await sql`
	     CREATE OR REPLACE FUNCTION notify_workspace_log()
	     RETURNS trigger AS $$
	     BEGIN
	       PERFORM pg_notify(
	         'workspace_logs',
	         json_build_object(
	           'id', NEW.id,
	           'workspace_execution_id', NEW.workspace_execution_id,
	           'stream', NEW.stream,
	           'line_number', NEW.line_number,
	           'content', NEW.content,
	           'timestamp', NEW.timestamp
	         )::text
	       );
	       RETURN NEW;
	     END;
	     $$ LANGUAGE plpgsql;
	   `.execute(db);

	// Create trigger on workspace_logs table
	await sql`
	     CREATE TRIGGER workspace_log_notify
	     AFTER INSERT ON workspace_logs
	     FOR EACH ROW
	     EXECUTE FUNCTION notify_workspace_log();
	   `.execute(db);
}

/**
 * Rollback the LISTEN/NOTIFY migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await sql`DROP TRIGGER IF EXISTS journal_event_notify ON journal_events`.execute(db);
	await sql`DROP FUNCTION IF EXISTS notify_journal_event()`.execute(db);
	await sql`DROP TRIGGER IF EXISTS workspace_log_notify ON workspace_logs`.execute(db);
	await sql`DROP FUNCTION IF EXISTS notify_workspace_log()`.execute(db);
}
