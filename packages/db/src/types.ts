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
	execution_log: string | null;
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
 * Audit event entry for the Platform Audit Ledger (P11.M).
 *
 * Records platform action evaluations with flexible filtering
 * dimensions and extensible enterprise export support.
 */
export interface AuditEventRow {
	id: string;
	action: string;
	status: "allowed" | "denied" | "pending-approval" | "approved" | "rejected" | "rollback";
	domain: string;
	actor: string | null;
	project_id: string | null;
	capability: string | null;
	workspace_id: string | null;
	proposal_id: string | null;
	extension_id: string | null;
	skill_id: string | null;
	memory_source: string | null;
	reason: string | null;
	data: Record<string, unknown>;
	timestamp: string;
	created_at: string;
}

/**
 * Chat message entry
 */
export interface ChatMessageRow {
	id: string;
	project_id: string;
	role: "user" | "assistant";
	content: string;
	message_index: number;
	session_id: string;
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
// Proposal row (P8.B)
// =============================================================================

/**
 * Raw proposal row from the database.
 */
export interface ProposalRow {
	id: string;
	project_id: string;
	proposal_key: string;
	title: string;
	phase: string;
	status: string;
	evidence: Record<string, unknown>;
	audit_trail: Record<string, unknown>[];
	submitted_at: string;
	actioned_at: string | null;
	rejection_reason: string | null;
	metadata: Record<string, unknown> | null;
	source_artifacts: Record<string, unknown>[];
	source_recorded_at: string | null;
	created_at: string;
	updated_at: string;
}

// =============================================================================
// Kysely table definitions
// =============================================================================

// =============================================================================
// Memory vector row (P11.F)
// =============================================================================

/**
 * Raw memory vector row from the database.
 */
export interface MemoryVectorRow {
	id: string;
	project_id: string;
	plan_execution_id: string | null;
	workspace_id: string | null;
	capability: string | null;
	content: string;
	content_hash: string;
	embedding: number[] | null;
	embedding_model: string | null;
	source_pointer: Record<string, unknown>;
	freshness: string;
	safety_classification: string;
	metadata: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
}

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

export interface ProposalTable {
	id: Generated<string>;
	project_id: string;
	proposal_key: string;
	title: string;
	phase: string;
	status: string;
	evidence: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
	audit_trail: ColumnType<Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]>;
	submitted_at: ColumnType<string, string, string | undefined>;
	actioned_at: string | null;
	rejection_reason: string | null;
	metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
	source_artifacts: ColumnType<Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]>;
	source_recorded_at: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface MemoryVectorTable {
	id: Generated<string>;
	project_id: string;
	plan_execution_id: string | null;
	workspace_id: string | null;
	capability: string | null;
	content: string;
	content_hash: string;
	embedding: ColumnType<number[] | null, number[] | null, number[] | null>;
	embedding_model: string | null;
	source_pointer: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
	freshness: ColumnType<string, string, string | undefined>;
	safety_classification: ColumnType<string, string, string>;
	metadata: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface AuditEventTable {
	id: Generated<string>;
	action: string;
	status: string;
	domain: string;
	actor: string | null;
	project_id: string | null;
	capability: string | null;
	workspace_id: string | null;
	proposal_id: string | null;
	extension_id: string | null;
	skill_id: string | null;
	memory_source: string | null;
	reason: string | null;
	data: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
	timestamp: string;
	created_at: Generated<string>;
}

export interface Database {
	projects: ProjectTable;
	plan_executions: PlanExecutionTable;
	workspace_executions: WorkspaceExecutionTable;
	journal_events: JournalEventTable;
	workspace_logs: WorkspaceLogTable;
	chat_messages: ChatMessageTable;
	proposals: ProposalTable;
	plan_revisions: PlanRevisionTable;
	memory_vectors: MemoryVectorTable;
	audit_events: AuditEventTable;
	_migrations: MigrationsTable;
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
	proposal_id: string | null;
	phase: string;
	title: string;
	status: string;
	started_at: ColumnType<string, string, string | undefined>;
	completed_at: string | null;
	execution_log: string | null;
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

export interface ChatMessageTable {
	id: Generated<string>;
	project_id: string;
	role: string;
	content: string;
	message_index: number;
	session_id: string;
	created_at: Generated<string>;
}

export interface PlanRevisionTable {
	id: Generated<string>;
	plan_execution_id: string;
	version_number: number;
	title: string;
	content: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
	status: string;
	diff_summary: string | null;
	created_by: string | null;
	created_at: Generated<string>;
}

export interface MigrationsTable {
	version: number;
	name: string;
	applied_at: Generated<string>;
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

export type Proposal = Selectable<ProposalTable>;
export type NewProposal = Insertable<ProposalTable>;
export type ProposalUpdate = Updateable<ProposalTable>;

export type PlanRevision = Selectable<PlanRevisionTable>;
export type NewPlanRevision = Insertable<PlanRevisionTable>;

export type MemoryVector = Selectable<MemoryVectorTable>;
export type NewMemoryVector = Insertable<MemoryVectorTable>;
export type MemoryVectorUpdate = Updateable<MemoryVectorTable>;

export type AuditEvent = Selectable<AuditEventTable>;
export type NewAuditEvent = Insertable<AuditEventTable>;
export type AuditEventUpdate = Updateable<AuditEventTable>;

export type ChatMessage = Selectable<ChatMessageTable>;
export type NewChatMessage = Insertable<ChatMessageTable>;
