/**
 * Core modules shared between all run modes.
 */

// Planner Memory — Heuristics and Memory (P7.E)
export {
	createPlannerMemory,
	InMemoryPlannerMemoryStore,
	PlannerMemory,
	type PlannerMemoryConfig,
	type PlannerMemoryEntry,
	type PlannerMemoryStore,
} from "../memory/planner-memory.js";
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type PromptOptions,
	type SessionStats,
} from "./agent-session.js";
export {
	AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	type CreateAgentSessionRuntimeResult,
	createAgentSessionRuntime,
} from "./agent-session-runtime.js";
export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.js";
export { type BashExecutorOptions, type BashResult, executeBashWithOperations } from "./bash-executor.js";
// P11.G Capability Policy Engine
export {
	ACTION_LABELS,
	type ActionCategory,
	type ActionCategoryMap,
	type ActionDomain,
	type ApprovalRecord,
	CapabilityPolicyEngine,
	type CapabilityPolicyEngineConfig,
	type CapabilityPolicyResult,
	type CapabilityRule,
	createCapabilityPolicyEngine,
	DEFAULT_CAPABILITY_RULES,
	type ExtensionActionCategory,
	type MemoryActionCategory,
	type OptimizerActionCategory,
	type OrchestratorActionCategory,
	type PermissionVerdict,
	type ProtectionLevel,
	type SkillActionCategory,
	VERDICT_LABELS,
} from "./capability-policy-engine.js";
export type { CompactionResult } from "./compaction/index.js";
export {
	CompletionGateRegistry,
	createWorkspaceValidationState,
	evaluateGovernanceLedgerCompliance,
	evaluatePlanCompletion,
	evaluatePlanCompletionWithGovernance,
	evaluateWorkspaceCompletion,
	evaluateWorkspaceCompletionWithGovernance,
	type GovernanceLedgerCompletionResult,
	isWorkspaceLegitimatelyComplete,
	mergeFailureSignals,
	type PlanCompletionResult,
	recordCommandCompletion,
	recordValidationCommand,
	type WorkspaceCompletionResult,
	type WorkspaceValidationState,
} from "./completion-gate.js";
// DAG Optimizer — P7.B
export {
	type ApprovalStatus,
	analyzeOptimizationOpportunities,
	applyApprovedProposals,
	approveProposal,
	createPatchPlanFromApprovedProposals,
	type DagOptimizationResult,
	type DependencyAdditionProposal,
	type DependencyRemovalProposal,
	formatOptimizationResult,
	type OptimizationEvidence,
	type OptimizationKind,
	type OptimizationProposal,
	type OptimizationSummary,
	previewApprovedProposals,
	rejectProposal,
	type SplitProposal,
} from "./dag-optimizer.js";
// Detection Engine — P8.D
export {
	createDetectionEngine,
	DetectionEngine,
	type DetectionEngineConfig,
	type ScannerInput,
} from "./detection-engine.js";
// Detection Types — P8.D
export {
	type ConfidenceLevel,
	confidenceLevelToScore,
	type DetectionCategory,
	type DetectionEvidenceItem,
	type DetectionOutput,
	type DetectionResult,
	type FalsePositiveInfo,
	type FalsePositiveSummary,
	generateDetectionId,
	type RiskLevel,
	riskLevelToScore,
	scoreToConfidenceLevel,
	scoreToRiskLevel,
	type UnsafeCheckResult,
	type UnsafeReason,
} from "./detection-types.js";
// Draft Planner — P8.E
export {
	assertNotDraftPlan,
	canAgentEnqueuePlan,
	canAgentExecutePlan,
	checkDraftGates,
	createDraftPlanner,
	type DraftGateResult,
	type DraftPlanMeta,
	DraftPlanner,
	type DraftPlannerConfig,
	formatDraftGateResult,
	formatDraftPlanList,
	formatDraftPlanMeta,
	type GenerateDraftPlanResult,
	isDraftPlan,
	setDraftLeadAgent,
} from "./draft-planner.js";
export { createEventBus, type EventBus, type EventBusController } from "./event-bus.js";
// Extensions system
export {
	type AgentEndEvent,
	type AgentStartEvent,
	type AgentToolResult,
	type AgentToolUpdateCallback,
	type BeforeAgentStartEvent,
	type BeforeAgentStartEventResult,
	type BuildSystemPromptOptions,
	type ContextEvent,
	defineTool,
	discoverAndLoadExtensions,
	type ExecOptions,
	type ExecResult,
	type Extension,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ExtensionError,
	type ExtensionEvent,
	type ExtensionFactory,
	type ExtensionFlag,
	type ExtensionHandler,
	ExtensionRunner,
	type ExtensionShortcut,
	type ExtensionUIContext,
	type LoadExtensionsResult,
	type MessageRenderer,
	type RegisteredCommand,
	type SessionBeforeCompactEvent,
	type SessionBeforeForkEvent,
	type SessionBeforeSwitchEvent,
	type SessionBeforeTreeEvent,
	type SessionCompactEvent,
	type SessionShutdownEvent,
	type SessionStartEvent,
	type SessionTreeEvent,
	type ToolCallEvent,
	type ToolCallEventResult,
	type ToolDefinition,
	type ToolRenderResultOptions,
	type ToolResultEvent,
	type TurnEndEvent,
	type TurnStartEvent,
	type WorkingIndicatorOptions,
} from "./extensions/index.js";
// False-Positive Tracker — P8.D
export {
	createFalsePositiveTracker,
	type FalsePositiveRecord,
	FalsePositiveTracker,
	type FalsePositiveTrackerConfig,
	type SuppressionPattern,
} from "./false-positive-tracker.js";
// P9.G7 Governance Ledger
export {
	type CompletionGateRecord,
	createGovernanceLedger,
	GovernanceLedger,
	type GovernanceLedgerSnapshot,
	LEDGER_SOURCE_LABELS,
	type LedgerEntry,
	type LedgerEventCategory,
	type LedgerEventSeverity,
	type LedgerSource,
	type LedgerSummary,
} from "./governance-ledger.js";
export {
	detectFailureSignals,
	type FailureSignal,
	FailureSignalCategory,
	type LogScanResult,
	recordExitCodeFailure,
	scanLogLines,
} from "./log-failure-detector.js";
export {
	findMissingWorkspaceLabels,
	type ParsedSource,
	scanMarkdownWorkstreamHeadings,
} from "./plan-parser.js";
// Planner — Autonomous Planner Core
export {
	type CriticalPathInfo,
	formatCriticalPath,
	formatPlannerOutput,
	type OptimizedBatch,
	Planner,
	type PlannerOptions,
	type PlannerOutput,
	type PlannerSuggestion,
	type PlannerWarning,
	type PredictedParallelism,
	planExecution,
} from "./planner.js";
// Planner Feedback Loop — Queue feedback updates planner risk models (P7.F)
export {
	analyzeQueueFeedback,
	type FeedbackLoopResult,
	formatFeedbackLoopResult,
	PlannerFeedbackLoop,
	type PlannerFeedbackLoopConfig,
	type QueueOutcome,
	type RebatchingRecommendation,
	type RiskModelUpdate,
} from "./planner-feedback-loop.js";
// Proposal Inbox — P8.B
export {
	type ActionProposalResult,
	formatProposal,
	formatProposalList,
	type Proposal,
	type ProposalAuditEntry,
	type ProposalEvidence,
	type ProposalFilter,
	ProposalInbox,
	type ProposalStatus,
	type SubmitProposalResult,
} from "./proposal-inbox.js";
// Safety profiles
export {
	BALANCED_PROFILE,
	type CommandCheckResult,
	checkCommand,
	checkFileOperation,
	DEFAULT_SAFETY_PROFILE,
	describePermissions,
	type EffectivePermissions,
	type FileCheckResult,
	type FilePermissionRule,
	FULL_AUTO_PROFILE,
	fullAutoRequiresConfirmation,
	getAvailableProfiles,
	getEffectivePermissions,
	getProfileDescription,
	isGitPushBlocked,
	isRmRfBlocked,
	type PermissionLevel,
	type PermissionRule,
	requiresExplicitConfirmation,
	type SafetyProfileName,
	STRICT_PROFILE,
} from "./safety-profile.js";
// Self-Modification Firewall — P8.F
export {
	BUILT_IN_PROTECTED_SYSTEMS,
	createSelfModificationFirewall,
	type ProtectedSystem,
	type SelfModificationCheckResult,
	SelfModificationFirewall,
	type SelfModificationFirewallConfig,
	type SelfModificationReport,
} from "./self-modification-firewall.js";
export { createSyntheticSourceInfo } from "./source-info.js";
// Unsafe Suggestion Guard — P8.D
export {
	createUnsafeSuggestionGuard,
	UnsafeSuggestionGuard,
} from "./unsafe-suggestion-guard.js";
export {
	getGlobalValidationLock,
	isValidationCommand,
	resetGlobalValidationLock,
	VALIDATION_LOCK_ACQUIRED,
	VALIDATION_LOCK_RELEASED,
	VALIDATION_LOCK_WAITING,
	type ValidationLockEventPayload,
	withValidationLock,
} from "./validation-lock.js";
export {
	buildPlanValidationResult,
	buildWorkspaceValidationResult,
	type PlanValidationResult,
	type ValidationCriterionResult,
	ValidationStatus,
	type WorkspaceValidationResult,
} from "./validation-result.js";
export {
	type CommandValidationResult,
	isValidationLikeCommand,
	isWatchModeCommand,
	rewriteToNonWatch,
	validateCommand,
} from "./watch-mode-guard.js";
