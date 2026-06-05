/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports canonical execution types from @earendil-works/pi-execution-contracts.
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from @earendil-works/pi-execution-contracts.
 *
 * @deprecated Import from @earendil-works/pi-execution-contracts instead
 */
export type {
	BrainProposal,
	CommandHistoryView,
	ExecutionCommand,
	ExecutionCommandAcknowledgeDirective,
	ExecutionCommandApproveProposal,
	ExecutionCommandContinuePlan,
	ExecutionCommandRequestUserEscalation,
	ExecutionCommandRerunPlan,
	ExecutionCommandResolveEscalation,
	ExecutionCommandRetryWorkspace,
	ExecutionCommandStartPlan,
	ExecutionCommandStopPlan,
	ExecutionReadModel,
	FinalValidationView,
	JournalEventEnvelope,
	JournalQuery,
	LeadDirectiveView,
	LeadEscalationView,
	PlanExecutionSummary,
	PlanStatus,
	WorkspaceExecutionSummary,
} from "@earendil-works/pi-execution-contracts";
