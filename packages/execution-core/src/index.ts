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

// P40.2C Dirty Runtime Dependency Ports
export type {
	GovernanceLedgerLike,
	FailureDetectorLike,
	FailureSignalLike,
	WatchModeGuardLike,
	StateStoreBackendFactoryLike,
	BudgetPolicyLike,
	CompletionGateDeps,
} from "./types.js";

// P40.2 Dependency Inversion Interfaces
export type {
	AgentRuntime,
	AgentRuntimeConfig,
	AgentRuntimeResult,
	GovernanceProvider,
	StorageProvider,
	InfrastructureProvider,
	SkillProvider,
} from "./types.js";

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

export type { WorkerConcurrencySettings, WorkerConcurrencyValidationResult } from "./worker-concurrency.js";
export {
	MIN_STABLE_WORKERS, MAX_STABLE_WORKERS, MIN_EXPERIMENTAL_WORKERS,
	MAX_EXPERIMENTAL_WORKERS, DEFAULT_WORKERS, PROMOTION_GATES,
	checkPromotionGates, isStableWorkerCount, isExperimentalWorkerCount,
	requiresExperimentalMode, validateWorkerConcurrency,
	resolveEffectiveWorkerCount, formatWorkerConcurrencyValidation,
} from "./worker-concurrency.js";
export type { WorktreeConfig, WorktreeState, WorktreeStatus, WorktreeExecutorConfig, WorktreeCreateResult, WorktreeExecutionResult, WorktreeListEntry, WorktreeDiffArtifact, WorktreeCleanupResult } from "./worktree-types.js";
export { DEFAULT_WORKTREE_ROOT, DEFAULT_WORKTREE_CONFIG } from "./worktree-types.js";
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
