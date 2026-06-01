/**
 * Execution Core — P40 Platform / Agent Separation
 *
 * Public API surface for the execution platform boundary.
 * This package contains canonical contracts only — no runtime implementation.
 * Must NOT import from @earendil-works/pi-coding-agent.
 */

// Commands
export type {
	ExecutionCommandApproveProposal,
	ExecutionCommandContinuePlan,
	ExecutionCommandRequestUserEscalation,
	ExecutionCommandRerunPlan,
	ExecutionCommandRetryWorkspace,
	ExecutionCommandStartPlan,
	ExecutionCommandStopPlan,
} from "./commands.js";
// Event store
export type { IEventStore } from "./event-store.js";
export { EventStoreError, InMemoryEventStore } from "./event-store.js";
// Events
export type {
	BrainApprovedPayload,
	BrainProposedPayload,
	BrainRejectedPayload,
	CommandFinishedPayload,
	CommandStartedPayload,
	ExecutionEvent,
	ExecutionEventPayloadMap,
	ExecutionEventType,
	GovernanceApprovedPayload,
	GovernanceCheckStartedPayload,
	GovernanceEscalatedPayload,
	GovernanceRejectedPayload,
	PlanCancelledPayload,
	PlanCompletedPayload,
	PlanFailedPayload,
	PlanPausedPayload,
	PlanResumedPayload,
	PlanStartedPayload,
	PlanStoppedPayload,
	SystemErrorPayload,
	SystemInfoPayload,
	SystemWarningPayload,
	WorkerCancelledPayload,
	WorkerCompletedPayload,
	WorkerFailedPayload,
	WorkerStartedPayload,
	WorkerTimedOutPayload,
	WorkspaceExecutionStage,
	WorkspaceStageChangedPayload,
} from "./events.js";
export {
	createExecutionEvent,
	EXECUTION_EVENT_TYPES,
	isBrainEventType,
	isCommandEventType,
	isGovernanceEventType,
	isPlanEventType,
	isSystemEventType,
	isWorkerEventType,
	isWorkspaceEventType,
	mapWorkspaceStageToExecutionStage,
	workspaceStageToEventType,
} from "./events.js";
export type { LogEntry, LogLevel } from "./logger.js";
// Logger utility (standalone, zero coding-agent deps)
export { PiLogger } from "./logger.js";
// Process killer utility (standalone, zero coding-agent deps)
export { killPlanProcesses, killTrackedDetachedChildren } from "./process-killer.js";
// Read model
export type {
	CommandHistoryView,
	ExecutionReadModel,
	FinalValidationView,
	JournalEventEnvelope,
	JournalQuery,
	LeadDirectiveView,
	PlanExecutionSummary,
	WorkspaceExecutionSummary,
} from "./read-model.js";
// Runtime event emitter
export { RuntimeEventEmitter } from "./runtime-emitter.js";
// P40.2C Dirty Runtime Dependency Ports
// P40.2 Dependency Inversion Interfaces
export type {
	AgentRuntime,
	AgentRuntimeConfig,
	AgentRuntimeResult,
	BrainProposal,
	BudgetPolicyLike,
	CompletionGateDeps,
	ExecutionCommand,
	FailureDetectorLike,
	FailureSignalLike,
	GovernanceLedgerLike,
	GovernanceProvider,
	InfrastructureProvider,
	IStateStore,
	PlanStatus,
	SkillProvider,
	StateStoreBackendFactoryLike,
	StorageProvider,
	WatchModeGuardLike,
} from "./types.js";
// Shared types
export { WorkspaceStage } from "./types.js";
// Worker adapter
export type {
	WorkerAdapter,
	WorkerAdapterCapabilities,
	WorkerCommandHistoryEntry,
	WorkerEvent,
	WorkerRunRequest,
	WorkerRunResult,
	WorkerVerdict,
} from "./worker-adapter.js";
export type { WorkerConcurrencySettings, WorkerConcurrencyValidationResult } from "./worker-concurrency.js";
export {
	checkPromotionGates,
	DEFAULT_WORKERS,
	formatWorkerConcurrencyValidation,
	isExperimentalWorkerCount,
	isStableWorkerCount,
	MAX_EXPERIMENTAL_WORKERS,
	MAX_STABLE_WORKERS,
	MIN_EXPERIMENTAL_WORKERS,
	MIN_STABLE_WORKERS,
	PROMOTION_GATES,
	requiresExperimentalMode,
	resolveEffectiveWorkerCount,
	validateWorkerConcurrency,
} from "./worker-concurrency.js";
// Worker Transcript Capture (P41.04)
export type {
	IWorkerTranscriptStore,
	JournalEvent,
	WorkerTranscriptEvent,
	WorkerTranscriptEventType,
} from "./worker-transcript.js";
export {
	buildTranscriptSummary,
	createWorkerTranscriptEvent,
	InMemoryWorkerTranscriptStore,
	PRIVATE_DATA_KEYS,
	sanitizeTranscriptData,
} from "./worker-transcript.js";
export type {
	WorktreeCleanupResult,
	WorktreeConfig,
	WorktreeCreateResult,
	WorktreeDiffArtifact,
	WorktreeExecutionResult,
	WorktreeExecutorConfig,
	WorktreeListEntry,
	WorktreeState,
	WorktreeStatus,
} from "./worktree-types.js";
export { DEFAULT_WORKTREE_CONFIG, DEFAULT_WORKTREE_ROOT } from "./worktree-types.js";
