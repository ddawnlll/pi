/**
 * Core modules shared between all run modes.
 */

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
export type { CompactionResult } from "./compaction/index.js";
export {
	CompletionGateRegistry,
	createWorkspaceValidationState,
	evaluatePlanCompletion,
	evaluateWorkspaceCompletion,
	isWorkspaceLegitimatelyComplete,
	mergeFailureSignals,
	type PlanCompletionResult,
	recordCommandCompletion,
	recordValidationCommand,
	type WorkspaceCompletionResult,
	type WorkspaceValidationState,
} from "./completion-gate.js";
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
export { createSyntheticSourceInfo } from "./source-info.js";
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
