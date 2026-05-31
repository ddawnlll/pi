/**
 * Execution Commands — P40 Platform / Agent Separation
 *
 * Canonical command types for the execution platform boundary.
 * Only Execution may transition state; these commands are requests.
 */

// ---------------------------------------------------------------------------
// ExecutionCommand union
// ---------------------------------------------------------------------------

export type ExecutionCommand =
	| ExecutionCommandStartPlan
	| ExecutionCommandStopPlan
	| ExecutionCommandContinuePlan
	| ExecutionCommandRerunPlan
	| ExecutionCommandRetryWorkspace
	| ExecutionCommandRequestUserEscalation
	| ExecutionCommandApproveProposal;

// ---------------------------------------------------------------------------
// Command variants
// ---------------------------------------------------------------------------

export interface ExecutionCommandStartPlan {
	type: "start_plan";
	planId: string;
}

export interface ExecutionCommandStopPlan {
	type: "stop_plan";
	planExecutionId: string;
	reason?: string;
}

export interface ExecutionCommandContinuePlan {
	type: "continue_plan";
	planExecutionId: string;
	reason?: string;
}

export interface ExecutionCommandRerunPlan {
	type: "rerun_plan";
	planExecutionId: string;
	reason?: string;
}

export interface ExecutionCommandRetryWorkspace {
	type: "retry_workspace";
	planExecutionId: string;
	workspaceId: string;
	reason?: string;
}

export interface ExecutionCommandRequestUserEscalation {
	type: "request_user_escalation";
	planExecutionId: string;
	workspaceId: string;
	reason?: string;
}

export interface ExecutionCommandApproveProposal {
	type: "approve_proposal";
	proposalId: string;
}
