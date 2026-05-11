/**
 * Database types for the execution persistence layer.
 *
 * Mirrors the execution hierarchy from the architecture plan:
 * Project → PlanExecution → WorkspaceExecution → JournalEvent / WorkspaceLog
 */

/**
 * Project entity
 */
export interface ProjectRow {
	id: string;
	name: string;
	description: string | null;
	root_path: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Plan execution entity
 */
export interface PlanExecutionRow {
	id: string;
	project_id: string;
	phase: string;
	title: string;
	status: "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled";
	started_at: string;
	completed_at: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Workspace execution entity
 */
export interface WorkspaceExecutionRow {
	id: string;
	plan_execution_id: string;
	workspace_id: string;
	title: string;
	stage: "pending" | "active" | "complete" | "blocked" | "failed";
	attempts: number;
	error_message: string | null;
	started_at: string | null;
	completed_at: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
}

/**
 * Journal event entity
 */
export interface JournalEventRow {
	id: string;
	plan_execution_id: string;
	workspace_execution_id: string | null;
	event_type: string;
	timestamp: string;
	data: Record<string, unknown> | null;
	created_at: string;
}

/**
 * Workspace log entry
 */
export interface WorkspaceLogRow {
	id: string;
	workspace_execution_id: string;
	stream: "stdout" | "stderr" | "test" | "error";
	line_number: number;
	content: string;
	timestamp: string;
	created_at: string;
}

// =============================================================================
// Kysely table definitions
// =============================================================================

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

export interface Database {
	projects: ProjectTable;
	plan_executions: PlanExecutionTable;
	workspace_executions: WorkspaceExecutionTable;
	journal_events: JournalEventTable;
	workspace_logs: WorkspaceLogTable;
}

export interface ProjectTable {
	id: Generated<string>;
	name: string;
	description: string | null;
	root_path: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface PlanExecutionTable {
	id: Generated<string>;
	project_id: string;
	phase: string;
	title: string;
	status: string;
	started_at: ColumnType<string, string, string | undefined>;
	completed_at: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface WorkspaceExecutionTable {
	id: Generated<string>;
	plan_execution_id: string;
	workspace_id: string;
	title: string;
	stage: string;
	attempts: Generated<number>;
	error_message: string | null;
	started_at: string | null;
	completed_at: string | null;
	metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface JournalEventTable {
	id: Generated<string>;
	plan_execution_id: string;
	workspace_execution_id: string | null;
	event_type: string;
	timestamp: string;
	data: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
	created_at: Generated<string>;
}

export interface WorkspaceLogTable {
	id: Generated<string>;
	workspace_execution_id: string;
	stream: string;
	line_number: number;
	content: string;
	timestamp: string;
	created_at: Generated<string>;
}

// Helper types for Kysely
export type Project = Selectable<ProjectTable>;
export type NewProject = Insertable<ProjectTable>;
export type ProjectUpdate = Updateable<ProjectTable>;

export type PlanExecution = Selectable<PlanExecutionTable>;
export type NewPlanExecution = Insertable<PlanExecutionTable>;
export type PlanExecutionUpdate = Updateable<PlanExecutionTable>;

export type WorkspaceExecution = Selectable<WorkspaceExecutionTable>;
export type NewWorkspaceExecution = Insertable<WorkspaceExecutionTable>;
export type WorkspaceExecutionUpdate = Updateable<WorkspaceExecutionTable>;

export type JournalEvent = Selectable<JournalEventTable>;
export type NewJournalEvent = Insertable<JournalEventTable>;

export type WorkspaceLog = Selectable<WorkspaceLogTable>;
export type NewWorkspaceLog = Insertable<WorkspaceLogTable>;
