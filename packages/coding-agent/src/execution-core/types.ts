/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports canonical execution types from @earendil-works/pi-execution-core.
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from @earendil-works/pi-execution-core.
 *
 * @deprecated Import from @earendil-works/pi-execution-core instead
 */
export type {
	ExecutionCommand,
	ExecutionCommandStartPlan,
	ExecutionCommandStopPlan,
	ExecutionCommandContinuePlan,
	ExecutionCommandRerunPlan,
	ExecutionCommandRetryWorkspace,
	ExecutionCommandRequestUserEscalation,
	ExecutionCommandApproveProposal,
	ExecutionReadModel,
	PlanExecutionSummary,
	WorkspaceExecutionSummary,
	JournalEventEnvelope,
	JournalQuery,
	PlanStatus,
	CommandHistoryView,
	LeadDirectiveView,
	FinalValidationView,
	BrainProposal,
} from "@earendil-works/pi-execution-core";
