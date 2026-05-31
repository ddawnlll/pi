/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * This file re-exports types from the new @earendil-works/pi-execution-core package
 * for backward compatibility with existing code imports.
 *
 * Types from execution-kernel and lead-agent remain here as they are not yet extracted.
 *
 * @deprecated Import from @earendil-works/pi-execution-core where possible
 */

// Re-export canonical types from the new execution-core package
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
	WorkspaceExecutionStage,
	WorkerAdapter,
	WorkerRunRequest,
	WorkerRunResult,
	WorkerVerdict,
	WorkerEvent,
	WorkerCommandHistoryEntry,
	WorkerAdapterCapabilities,
} from "@earendil-works/pi-execution-core";

// Re-export types still inside coding-agent (not yet extracted)
export type {
	AttemptState,
	AttemptEventType,
	StateAuthorityToken,
	AttemptRow,
	AttemptEventRow,
	AttemptTransitionRow,
} from "../execution-kernel/types.js";
export type {
	LeadDirective,
	UserEscalation,
	FailureClass,
	FailureSignature,
} from "../core/lead-agent/types.js";
