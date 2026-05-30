/**
 * Execution Service — P40 Platform / Agent Separation
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
} from "../execution-core/types.js";
export { handleExecutionCommand } from "./command-handler.js";
export { createExecutionReadModel } from "./query-handler.js";
