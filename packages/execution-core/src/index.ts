/**
 * Execution Core — P40 Platform / Agent Separation
 *
 * Public API surface for the execution platform boundary.
 * This package contains canonical contracts only — no runtime implementation.
 * Must NOT import from @earendil-works/pi-coding-agent.
 */

// Logger utility (standalone, zero coding-agent deps)
export { PiLogger } from "./logger.js";
export type { LogLevel, LogEntry } from "./logger.js";

// Process killer utility (standalone, zero coding-agent deps)
export { killPlanProcesses, killTrackedDetachedChildren } from "./process-killer.js";

// Shared types
export { WorkspaceStage } from "./types.js";
export type { IStateStore } from "./types.js";
export type { PlanStatus, BrainProposal } from "./types.js";
export type { ExecutionCommand } from "./types.js";

// Commands
export type {
	ExecutionCommandStartPlan,
	ExecutionCommandStopPlan,
	ExecutionCommandContinuePlan,
	ExecutionCommandRerunPlan,
	ExecutionCommandRetryWorkspace,
	ExecutionCommandRequestUserEscalation,
	ExecutionCommandApproveProposal,
} from "./commands.js";

// Read model
export type {
	ExecutionReadModel,
	PlanExecutionSummary,
	WorkspaceExecutionSummary,
	JournalEventEnvelope,
	JournalQuery,
	CommandHistoryView,
	LeadDirectiveView,
	FinalValidationView,
} from "./read-model.js";

// Events
export type { WorkspaceExecutionStage } from "./events.js";

// Worker adapter
export type {
	WorkerAdapter,
	WorkerRunRequest,
	WorkerRunResult,
	WorkerVerdict,
	WorkerEvent,
	WorkerCommandHistoryEntry,
	WorkerAdapterCapabilities,
} from "./worker-adapter.js";
