/**
 * Execution Core Types — P40 Platform / Agent Separation
 *
 * Canonical types for the execution platform boundary.
 * Brain, Web Server, and UI consume these types.
 * Only Execution may transition state.
 */

// ---------------------------------------------------------------------------
// Execution Commands
// ---------------------------------------------------------------------------

export type ExecutionCommand =
	| ExecutionCommandStartPlan
	| ExecutionCommandStopPlan
	| ExecutionCommandContinuePlan
	| ExecutionCommandRerunPlan
	| ExecutionCommandRetryWorkspace
	| ExecutionCommandRequestUserEscalation
	| ExecutionCommandApproveProposal;

export interface ExecutionCommandStartPlan { type: "start_plan"; planId: string; }
export interface ExecutionCommandStopPlan { type: "stop_plan"; planExecutionId: string; reason?: string; }
export interface ExecutionCommandContinuePlan { type: "continue_plan"; planExecutionId: string; reason?: string; }
export interface ExecutionCommandRerunPlan { type: "rerun_plan"; planExecutionId: string; reason?: string; }
export interface ExecutionCommandRetryWorkspace { type: "retry_workspace"; planExecutionId: string; workspaceId: string; reason?: string; }
export interface ExecutionCommandRequestUserEscalation { type: "request_user_escalation"; planExecutionId: string; workspaceId: string; reason?: string; }
export interface ExecutionCommandApproveProposal { type: "approve_proposal"; proposalId: string; }

// ---------------------------------------------------------------------------
// Execution Read Model
// ---------------------------------------------------------------------------

export interface PlanExecutionSummary {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: PlanStatus;
	startedAt: string;
	completedAt: string | null;
}

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

export type PlanStatus = "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled" | "awaiting_handoff";

export interface ExecutionReadModel {
	getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary>;
	getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary>;
	listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]>;
	getCommandHistory(planExecutionId: string, workspaceId: string): Promise<CommandHistoryView[]>;
	getLeadDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]>;
	getFinalValidationStatus(planExecutionId: string, workspaceId: string): Promise<FinalValidationView>;
}

export interface CommandHistoryView {
	command: string;
	cwd: string;
	exitCode: number | null;
	startedAt: number;
	finishedAt: number;
	outputSummary?: string;
	isTargetCommand?: boolean;
}

export interface LeadDirectiveView {
	workspaceId: string;
	directiveType: string;
	allowedActions: string[];
	retryBudget: number;
	escalationOption?: string;
}

export interface FinalValidationView {
	required: boolean;
	passed: boolean | null;
	blocked: boolean;
	blockReasons: string[];
}

// ---------------------------------------------------------------------------
// Brain Proposal
// ---------------------------------------------------------------------------

export interface BrainProposal {
	id: string;
	type: "retry" | "split_workspace" | "draft_plan" | "investigate" | "notify";
	summary: string;
	rationale: string;
	evidenceRefs: string[];
	proposedCommand?: ExecutionCommand;
}
