/**
 * Compatibility shim — P40 Platform / Agent Separation
 *
 * Re-exports execution service from @earendil-works/pi-execution-service.
 * This file is a compatibility shim and will be removed in a future phase.
 * New code should import directly from @earendil-works/pi-execution-service.
 *
 * @deprecated Import from @earendil-works/pi-execution-service instead
 */
export type {
	ExecutionCommand,
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
export type { CommandHandlerResult } from "@earendil-works/pi-execution-service";
export { handleExecutionCommand } from "@earendil-works/pi-execution-service";
export { createExecutionReadModel } from "@earendil-works/pi-execution-service";
