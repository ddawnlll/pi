/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * This file re-exports types from the new @earendil-works/pi-execution-contracts package
 * for backward compatibility with existing code imports.
 *
 * Types from execution-runtime and lead-agent remain here as they are not yet extracted.
 *
 * @deprecated Import from @earendil-works/pi-execution-contracts where possible
 */

// Re-export canonical types from the new execution-contracts package
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
	WorkerAdapter,
	WorkerAdapterCapabilities,
	WorkerCommandHistoryEntry,
	WorkerEvent,
	WorkerRunRequest,
	WorkerRunResult,
	WorkerVerdict,
	WorkspaceExecutionStage,
	WorkspaceExecutionSummary,
} from "@earendil-works/pi-execution-contracts";
export type {
	FailureClass,
	FailureSignature,
	LeadDirective,
	UserEscalation,
} from "../core/lead-agent/types.js";
// Re-export types still inside coding-agent (not yet extracted)
export type {
	AttemptEventRow,
	AttemptEventType,
	AttemptRow,
	AttemptState,
	AttemptTransitionRow,
	StateAuthorityToken,
} from "../execution-runtime/types.js";
// Re-export Lead Agent escalation types from the new execution-contracts
// (LeadDirectiveView and LeadEscalationView are now available via execution-contracts)
