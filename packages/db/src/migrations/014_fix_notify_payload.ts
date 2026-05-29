/**
 * Fix NOTIFY payload — small envelope only, full data stays in table.
 *
 * The previous notify_journal_event() function included NEW.data in the
 * pg_notify payload. When journal events contain large tool_call payloads
 * (>8000 bytes), the NOTIFY fails with "payload string too long".
 *
 * Fix: notify only the event envelope (id, plan_execution_id,
 * workspace_execution_id, event_type, timestamp). Consumers can fetch
 * the full payload by id from the journal_events table.
 */

import { type Kysely, sql } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
	// Replace notify_journal_event to exclude NEW.data from NOTIFY
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
	           'timestamp', NEW.timestamp
	         )::text
	       );
	       RETURN NEW;
	     END;
	     $$ LANGUAGE plpgsql;
	   `.execute(db);

	// Also fix workspace_log notify to limit content length
	await sql`
	     CREATE OR REPLACE FUNCTION notify_workspace_log()
	     RETURNS trigger AS $$
	     DECLARE
	       truncated_content text;
	     BEGIN
	       truncated_content := left(NEW.content, 1024);
	       PERFORM pg_notify(
	         'workspace_logs',
	         json_build_object(
	           'id', NEW.id,
	           'workspace_execution_id', NEW.workspace_execution_id,
	           'stream', NEW.stream,
	           'line_number', NEW.line_number,
	           'content', truncated_content,
	           'timestamp', NEW.timestamp
	         )::text
	       );
	       RETURN NEW;
	     END;
	     $$ LANGUAGE plpgsql;
	   `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
	// Restore original notify_journal_event (with data field)
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

	// Restore original workspace_log notify (no truncation)
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
}
