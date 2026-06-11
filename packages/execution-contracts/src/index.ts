/**
 * Execution Core — P40 Platform / Agent Separation
 *
 * Public API surface for the execution platform boundary.
 * This package contains canonical contracts only — no runtime implementation.
 * Must NOT import from @earendil-works/pi-coding-agent.
 */

export type {
	AccpCompileCompletedEvent,
	AccpCompileStartedEvent,
	AccpEventKind,
	AccpFindingRecordedEvent,
	AccpGateVerdictEmittedEvent,
	AccpLifecycleEvent,
	AccpRouteSignalEmittedEvent,
} from "./accp-events.js";
// ACCP v2.0 package reference (P49.01)
export {
	ACCP_V2_PACKAGE_DESCRIPTION,
	ACCP_V2_PACKAGE_DOCS,
	ACCP_V2_PACKAGE_EXAMPLES,
	ACCP_V2_PACKAGE_PATHS,
	ACCP_V2_PACKAGE_PROMPTS,
	ACCP_V2_PACKAGE_README,
	ACCP_V2_PACKAGE_REGISTRY,
	ACCP_V2_PACKAGE_ROOT,
	ACCP_V2_PACKAGE_SCHEMAS,
} from "./accp-package-reference.js";
// ACCP v2.0 type system foundation (P49.03)
export type {
	AccpArtifactRef,
	AccpCompileResult,
	AccpCompileStatus,
	AccpDiagnostic,
	AccpFinding,
	AccpGateVerdict,
	AccpIntermediateRepresentation,
	AccpReportFamily,
	AccpReportType,
	AccpRouteSignal,
	AccpSupportLevel,
	AccpTaskEnvelope,
	AccpWorkerOutput,
	InitialRouteIndicator,
} from "./accp-types.js";
// Live command log stream (P41.05)
export type { CommandLogEntry, CommandLogSubscriber, ICommandLogStream } from "./command-log-stream.js";
export { InMemoryCommandLogStream } from "./command-log-stream.js";
// Commands
export type {
	ExecutionCommandAcknowledgeDirective,
	ExecutionCommandApproveProposal,
	ExecutionCommandContinuePlan,
	ExecutionCommandInterveneWorkspace,
	ExecutionCommandIssueHumanDirective,
	ExecutionCommandRequestUserEscalation,
	ExecutionCommandRerunPlan,
	ExecutionCommandResolveEscalation,
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
	CommandOutputPayload,
	CommandStartedPayload,
	ExecutionEvent,
	ExecutionEventPayloadMap,
	ExecutionEventType,
	GovernanceApprovedPayload,
	GovernanceCheckStartedPayload,
	GovernanceEscalatedPayload,
	GovernanceRejectedPayload,
	HumanDirectiveAcknowledgedPayload,
	HumanDirectiveIssuedPayload,
	HumanInterventionRequestedPayload,
	LeadAgentDirectiveAcknowledgedPayload,
	LeadAgentDirectiveIssuedPayload,
	LeadAgentEscalationInitiatedPayload,
	LeadAgentEscalationResolvedPayload,
	LeadAgentReviewStartedPayload,
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
	isCommandOutputEventType,
	isGovernanceEventType,
	isLeadAgentEventType,
	isPlanEventType,
	isSystemEventType,
	isWorkerEventType,
	isWorkspaceEventType,
	mapWorkspaceStageToExecutionStage,
	workspaceStageToEventType,
} from "./events.js";
// File tree utilities (P41.06)
export {
	buildFileTreeFromEntries,
	flattenFileTree,
	getFileExt,
} from "./file-tree.js";
export type { LogEntry, LogLevel } from "./logger.js";
// Logger utility (standalone, zero coding-agent deps)
export { PiLogger } from "./logger.js";
// PlanSpec ACCP v2.0 authority boundary types (P49.02)
export type {
	AccpMode,
	AccpModePolicy,
	AccpReportProtocol,
	PlanSpecAccpExtension,
	PlanSpecAccpRequirements,
	PlanSpecReportRequirements,
} from "./planspec/accp-planspec-types.js";
export {
	DEFAULT_ACCP_EXTENSION,
	DEFAULT_ACCP_MODE_POLICY,
	DEFAULT_ACCP_PROTOCOL,
	DEFAULT_ACCP_REQUIREMENTS,
	DEFAULT_REPORT_REQUIREMENTS,
} from "./planspec/accp-planspec-types.js";
// Process killer utility (standalone, zero coding-agent deps)
export { killPlanProcesses, killTrackedDetachedChildren } from "./process-killer.js";
// Read model
export type {
	ArtifactEntry,
	ChangedFileEntry,
	CommandHistoryView,
	CompletionStatusView,
	DataAvailability,
	DependencyGraphNode,
	DependencyGraphView,
	ExecutionReadModel,
	FileChangeStatus,
	FileContentView,
	FileDiffView,
	FileTreeNode,
	FileTreeQuery,
	FinalValidationView,
	JournalEventEnvelope,
	JournalQuery,
	LeadDirectiveView,
	LeadEscalationView,
	PlanExecutionStats,
	PlanExecutionSummary,
	WorkerContextView,
	WorkspaceExecutionSummary,
	WorkspaceTruthStatusView,
} from "./read-model.js";
// Runtime event emitter
export { RuntimeEventEmitter } from "./runtime-emitter.js";
// Snapshot Artifacts (P41.07)
export type {
	FileSnapshot,
	ISnapshotArtifactStore,
	SnapshotArtifact,
	SnapshotArtifactSummary,
	SnapshotDiff,
	SnapshotSource,
	WorkspaceSnapshot,
} from "./snapshot-artifact.js";
export {
	computeContentHash,
	computeSnapshotDiff,
	computeSnapshotSummary,
	createFileSnapshot,
	createSnapshotArtifact,
	createWorkspaceSnapshot,
	InMemorySnapshotArtifactStore,
} from "./snapshot-artifact.js";
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
