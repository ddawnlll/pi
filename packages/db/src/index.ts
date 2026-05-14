/**
 * Database package public API.
 *
 * Provides PostgreSQL-backed persistence for execution state,
 * including connection management, typed repositories, migrations,
 * and LISTEN/NOTIFY event streaming.
 */

// Configuration
export { type DbConfig, DEFAULT_DB_CONFIG, loadDbConfig } from "./config.js";

// Connection management
export { closePool, getClient, getPool, healthCheck, resetPool } from "./connection.js";
// Transaction helpers
export { generateId, now, withTransaction } from "./helpers.js";
// Kysely query layer
export { closeKysely, getKysely, resetKysely } from "./kysely.js";

// Migrations
export {
	getAppliedMigrations,
	type Migration,
	migrations,
	rollbackMigrations,
	runMigrations,
} from "./migrations/index.js";
// Listen/Notify
export { NotifyClient, type NotifyEventHandler } from "./notify.js";
// Repositories
export {
	JournalEventRepository,
	PlanExecutionRepository,
	ProjectRepository,
	ProposalRepository,
	WorkspaceExecutionRepository,
	WorkspaceLogRepository,
} from "./repositories/index.js";

// Types
export type {
	ChatMessage,
	ChatMessageRow,
	ChatMessageTable,
	Database,
	JournalEvent,
	JournalEventRow,
	JournalEventTable,
	NewChatMessage,
	NewJournalEvent,
	NewPlanExecution,
	NewProject,
	NewProposal,
	NewWorkspaceExecution,
	NewWorkspaceLog,
	PlanExecution,
	PlanExecutionRow,
	PlanExecutionTable,
	Project,
	ProjectRow,
	ProjectTable,
	ProjectUpdate,
	Proposal,
	ProposalRow,
	ProposalTable,
	ProposalUpdate,
	WorkspaceExecution,
	WorkspaceExecutionRow,
	WorkspaceExecutionTable,
	WorkspaceExecutionUpdate,
	WorkspaceLog,
	WorkspaceLogRow,
	WorkspaceLogTable,
} from "./types.js";
