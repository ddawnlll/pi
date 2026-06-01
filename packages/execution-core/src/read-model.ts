/**
 * Execution Read Model — P40 Platform / Agent Separation
 *
 * Read model interfaces for querying execution state.
 * These are the ONLY way external consumers (Brain, Web, UI) should read
 * execution state. Direct access to state-store or DB is forbidden.
 */

// ---------------------------------------------------------------------------
// Plan Execution Summary
// ---------------------------------------------------------------------------

export interface PlanExecutionSummary {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Workspace Execution Summary
// ---------------------------------------------------------------------------

export interface WorkspaceExecutionSummary {
	id: string;
	planExecutionId: string;
	workspaceId: string;
	stage: string;
	attempts: number;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	reportPath?: string;
}

// ---------------------------------------------------------------------------
// Journal / Event Envelope
// ---------------------------------------------------------------------------

export interface JournalEventEnvelope {
	seq: string;
	eventId: string;
	planExecutionId: string;
	workspaceId?: string;
	eventType: string;
	payload: Record<string, unknown> | null;
	createdAt: string;
}

export interface JournalQuery {
	limit?: number;
	offset?: number;
	eventType?: string;
	workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Command History
// ---------------------------------------------------------------------------

export interface CommandHistoryView {
	command: string;
	cwd: string;
	exitCode: number | null;
	startedAt: number;
	finishedAt: number;
	outputSummary?: string;
	isTargetCommand?: boolean;
}

// ---------------------------------------------------------------------------
// Lead Directive View
// ---------------------------------------------------------------------------

export interface LeadDirectiveView {
	workspaceId: string;
	directiveType: string;
	allowedActions: string[];
	retryBudget: number;
	escalationOption?: string;
}

// ---------------------------------------------------------------------------
// Final Validation View
// ---------------------------------------------------------------------------

export interface FinalValidationView {
	required: boolean;
	passed: boolean | null;
	blocked: boolean;
	blockReasons: string[];
}

// ---------------------------------------------------------------------------
// Execution Read Model
// ---------------------------------------------------------------------------

export interface ExecutionReadModel {
	getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary>;
	getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary>;
	listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]>;
	getCommandHistory(planExecutionId: string, workspaceId: string): Promise<CommandHistoryView[]>;
	getLeadDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]>;
	getFinalValidationStatus(planExecutionId: string, workspaceId: string): Promise<FinalValidationView>;
}
