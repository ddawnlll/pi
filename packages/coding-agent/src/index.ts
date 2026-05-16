// Platform shared types and contracts
export {
	AuditLevel,
	CapabilityLevel,
	CapabilityPermission,
	CURRENT_PLATFORM_VERSION,
	DEFAULT_AUDIT_SPEC,
	DependencyType,
	PlanExecutionStatus,
	PlatformComponent,
	PlatformVersion,
	WorkerStage,
	WorkspaceStage,
	ValidationIssueSeverity,
	type AuditSpec,
	type CapabilityHook,
	type CapabilityManifest,
	type CapabilityVersion,
	type CompatibilitySpec,
	type ComponentManifest,
	type ManifestValidationResult,
	type PlatformManifest,
	type ValidationIssue,
	validateCapabilityManifest,
	validatePlatformManifest,
} from "./platform/index.js";

// State store interface and implementations

export {
	AutoCommit,
	type CommitResult,
	type CommitValidation,
	createAutoCommit,
} from "./core/auto-commit.js";
// P2 Plan execution
export {
	AutonomousExecutor,
	type AutonomousExecutorConfig,
	createAutonomousExecutor,
	type WorkspaceExecutionResult,
} from "./core/autonomous-executor.js";
export { type CleanupReviewConfig, type CleanupReviewResult, runCleanupReview } from "./core/cleanup-review.js";
// P9.G7 — Completion gate governance ledger integration
export {
	evaluateGovernanceLedgerCompliance,
	evaluatePlanCompletionWithGovernance,
	evaluateWorkspaceCompletionWithGovernance,
	type GovernanceLedgerCompletionResult,
} from "./core/completion-gate.js";
export { DatabaseStateStore, type DatabaseStateStoreConfig } from "./core/database-state-store.js";
export {
	type ArchiveInitResult,
	archiveDryRunReport,
	archiveOriginalPlan,
	archiveParsedContract,
	archiveWorkspaceDAG,
	type DAGNode,
	initExecutionArchive,
} from "./core/execution-archive.js";
export {
	type BatchContention,
	type DAGComparison,
	dagComparisonToJSON,
	ExecutionSimulator,
	formatDAGComparison,
	formatMutationGuardResult,
	formatSimulationForecast,
	type MutationGuardResult,
	type SimulationForecast,
	type SimulationSlot,
	type WorkerTimelineEntry,
} from "./core/execution-simulator.js";
// P9.G7 Governance Ledger — audit trail wiring for G1-G6 components
// Integrates with completion gate to require ledger entry before marking done
export {
	type CompletionGateRecord,
	createGovernanceLedger,
	type GovernanceLedger,
	type GovernanceLedgerSnapshot,
	LEDGER_SOURCE_LABELS,
	type LedgerEntry,
	type LedgerEventCategory,
	type LedgerEventSeverity,
	type LedgerSource,
	type LedgerSummary,
} from "./core/governance-ledger.js";
export { JsonStateStore, type JsonStateStoreConfig } from "./core/json-state-store.js";
export { createPlanControlManager, PlanControlManager } from "./core/plan-control.js";
export { formatParseResult, loadPlan, type ParseOptions, type ParseResult, parsePlan } from "./core/plan-parser.js";
export {
	buildTranscriptSummary,
	createWorkerTranscriptEvent,
	generateWorkspaceReport,
	type JournalEventType,
	PlanStateStore,
	sanitizeTranscriptData,
	type WorkerTranscriptEvent,
	type WorkerTranscriptEventType,
} from "./core/plan-state.js";
export {
	createProductionReadinessDoctor,
	formatProductionReadinessReport,
	isBroadScope,
	isGitDirty,
	isGitRepo,
	type ProductionReadinessCategory,
	type ProductionReadinessCheck,
	ProductionReadinessDoctor,
	type ProductionReadinessReport,
	type ProductionReadinessVerdict,
} from "./core/production-readiness-doctor.js";
// Remediation runtime (P9.A) — also exports P9.G3 approvals & budget recording
// P9.G3 adds: ApprovalChain, ApprovalChainEntry, ChangeRequest,
// SelfModificationApproval, budgetSnapshot on events, approval chain tracing
export {
	type ApprovalChain,
	type ApprovalChainEntry,
	type ApprovalEvent,
	type ApprovalStatus,
	type ChangeRequest,
	createRemediationRuntime,
	type DryRunReport,
	InvalidTransitionError,
	PreconditionError,
	REMEDIATION_STATE_LABELS,
	RemediationRuntime,
	type RemediationRuntimeConfig,
	type RemediationScanResult,
	type RemediationSnapshot,
	type RemediationState,
	type SelfModificationApproval,
} from "./core/remediation-runtime.js";
export {
	createSafetyDoctor,
	SafetyDoctor,
	type SafetyIssue,
	SafetyIssueSeverity,
	SafetyIssueType,
	type SafetyReport,
} from "./core/safety-doctor.js";
export {
	type ControlAction,
	createStateStore,
	detectStateStoreBackend,
	type IStateStore,
	type PlanControlState,
	type PlanExecutionSummary,
	type PlanStatus,
	type ProjectSummary,
	type StateStoreBackend,
	type StateStoreConfig,
	type WorkspaceAttempt,
} from "./core/state-store.js";
export {
	DEFAULT_WORKERS,
	isExperimentalWorkerCount,
	isStableWorkerCount,
	MAX_EXPERIMENTAL_WORKERS,
	MAX_STABLE_WORKERS,
	MIN_STABLE_WORKERS,
	requiresExperimentalMode,
	resolveEffectiveWorkerCount,
	validateWorkerConcurrency,
	type WorkerConcurrencySettings,
	type WorkerConcurrencyValidationResult,
} from "./core/worker-concurrency.js";
export {
	canStartWorker,
	configureMemoryGuard,
	formatBytes,
	formatMemorySnapshot,
	getLastSnapshot,
	getMemoryGuardConfig,
	getMemorySnapshot,
	type MemorySnapshot,
	setSystemMemoryLimitBytes,
	WORKER_MEMORY_LIMIT_BYTES,
	waitForMemoryAvailable,
} from "./core/worker-memory-guard.js";
export {
	type AgentExecutionResult,
	WorkspaceAgentExecutor,
	type WorkspaceAgentExecutorConfig,
} from "./core/workspace-agent-executor.js";
export {
	ACCEPTED_SCHEMA_VERSIONS,
	type ApprovedPreviewMetadata,
	CONTRACT_SCHEMA_VERSION,
	isAcceptedSchemaVersion,
	type ParallelismReview,
	type PlanExecutionConfig,
	type PlanExecutionScale,
	type PlanExecutionValidation,
	type TopologicalBatch,
	validateWorkspaceQueue,
	type Workspace,
	type WorkspaceCapabilityManifest,
	type WorkspaceQueue,
} from "./core/workspace-schema.js";
export {
	type AuditEntry,
	IntegrationQueue,
	type IntegrationQueueState,
	type QueueEntry,
} from "./integration/integration-queue.js";
// Repo scanning and analysis
export {
	createRepoHealthScanner,
	formatScanResult,
	formatScanResultJson,
	type HealthCategory,
	type HealthSignal,
	RepoHealthScanner,
	type ScanResult,
	type ScanSummary,
	type SignalEvidence,
	type SignalProposal,
	type SignalSeverity,
} from "./repo-scanner/index.js";

// Core session management

// P1 Token Budget and Safety - CLI and Reporting
export {
	checkLargeEditableFiles,
	type DoctorCategory,
	type DoctorCheck,
	type DoctorResults,
	type EditableFileInfo,
	formatDoctorResults,
	formatDoctorResultsJson,
	getDoctorExitCode,
	getModeThresholds,
	runDoctor,
} from "./cli/doctor.js";
export {
	createSummaryReport,
	createTokenReport,
	formatBudgetCheckResult,
	formatFileTokenEstimate,
	formatSummaryReportHuman,
	formatTokenReportHuman,
	formatTokenReportJson,
	type TokenReport,
	type TokenSummaryReport,
} from "./cli/token-report.js";
// Config paths
export { getAgentDir, VERSION } from "./config.js";
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type ParsedSkillBlock,
	type PromptOptions,
	parseSkillBlock,
	type SessionStats,
} from "./core/agent-session.js";
// Auth and model registry
export {
	type ApiKeyCredential,
	type AuthCredential,
	type AuthStatus,
	AuthStorage,
	type AuthStorageBackend,
	FileAuthStorageBackend,
	InMemoryAuthStorageBackend,
	type OAuthCredential,
} from "./core/auth-storage.js";
// P9.E Budget & Blast-Radius Enforcement
export {
	type BlastRadiusConfig,
	type BudgetConfig,
	BudgetEnforcer,
	type BudgetSummary,
	BudgetViolation,
	createWorkspaceBudgetEnforcer,
} from "./core/budget-enforcer.js";
// Compaction
export {
	type BranchPreparation,
	type BranchSummaryResult,
	type CollectEntriesResult,
	type CompactionResult,
	type CutPointResult,
	calculateContextTokens,
	collectEntriesForBranchSummary,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	type FileOperations,
	findCutPoint,
	findTurnStartIndex,
	type GenerateBranchSummaryOptions,
	generateBranchSummary,
	generateSummary,
	getLastAssistantUsage,
	prepareBranchEntries,
	serializeConversation,
	shouldCompact,
} from "./core/compaction/index.js";
// P1 Token Budget and Safety - Core Modules
export {
	BudgetExceededError,
	type ContextBudgetEnforcer,
	type ContextBudgetSettings,
	createBudgetEnforcer,
	DEFAULT_CONTEXT_BUDGETS,
} from "./core/context-budget.js";
export {
	type AcceptanceCriterion,
	createPacketBuilder,
	PacketBuilder,
	type RelevantSnippet,
	type WorkspacePacket,
	type WorkspaceSpec,
} from "./core/context-packet.js";
export { createEventBus, type EventBus, type EventBusController } from "./core/event-bus.js";
// Extension system
export type {
	AgentEndEvent,
	AgentStartEvent,
	AgentToolResult,
	AgentToolUpdateCallback,
	AppKeybinding,
	AutocompleteProviderFactory,
	BashToolCallEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeProviderRequestEvent,
	BeforeProviderRequestEventResult,
	BuildSystemPromptOptions,
	CompactOptions,
	ContextEvent,
	ContextUsage,
	CustomToolCallEvent,
	EditToolCallEvent,
	ExecOptions,
	ExecResult,
	Extension,
	ExtensionActions,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionEvent,
	ExtensionFactory,
	ExtensionFlag,
	ExtensionHandler,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	FindToolCallEvent,
	GrepToolCallEvent,
	InputEvent,
	InputEventResult,
	InputSource,
	KeybindingsManager,
	LoadExtensionsResult,
	LsToolCallEvent,
	MessageRenderer,
	MessageRenderOptions,
	ProviderConfig,
	ProviderModelConfig,
	ReadToolCallEvent,
	RegisteredCommand,
	RegisteredTool,
	ResolvedCommand,
	SessionBeforeCompactEvent,
	SessionBeforeForkEvent,
	SessionBeforeSwitchEvent,
	SessionBeforeTreeEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
	SlashCommandInfo,
	SlashCommandSource,
	SourceInfo,
	TerminalInputHandler,
	ToolCallEvent,
	ToolCallEventResult,
	ToolDefinition,
	ToolExecutionMode,
	ToolInfo,
	ToolRenderResultOptions,
	ToolResultEvent,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashEventResult,
	WidgetPlacement,
	WorkingIndicatorOptions,
	WriteToolCallEvent,
} from "./core/extensions/index.js";
export {
	createExtensionRuntime,
	defineTool,
	discoverAndLoadExtensions,
	ExtensionRunner,
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isLsToolResult,
	isReadToolResult,
	isToolCallEventType,
	isWriteToolResult,
	wrapRegisteredTool,
	wrapRegisteredTools,
} from "./core/extensions/index.js";
export {
	createFilePolicy,
	DEFAULT_FILE_POLICY,
	type FileChunk,
	type FileClassification,
	type FileOutline,
	type FilePolicy,
	type FilePolicyCheckResult,
	type FilePolicySettings,
} from "./core/file-policy.js";
// Footer data provider (git branch + extension statuses - data not otherwise available to extensions)
export type { ReadonlyFooterDataProvider } from "./core/footer-data-provider.js";
export { convertToLlm } from "./core/messages.js";
export { ModelRegistry } from "./core/model-registry.js";
export type {
	PackageManager,
	PathMetadata,
	ProgressCallback,
	ProgressEvent,
	ResolvedPaths,
	ResolvedResource,
} from "./core/package-manager.js";
export { DefaultPackageManager } from "./core/package-manager.js";
export {
	AUTONOMY_LEVEL_RANK,
	type AutonomyClassification,
	type BatchPolicyResult,
	createRemediationPolicyEngine,
	DEFAULT_REMEDIATION_POLICY_CONFIG,
	REMEDIATION_AUTONOMY_LABELS,
	type RemediationAutonomyLevel,
	type RemediationPolicyCheck,
	RemediationPolicyEngine,
	type RemediationPolicyEngineConfig,
	type RemediationPolicyResult,
	type RemediationRiskProfile,
} from "./core/remediation-policy-engine.js";
export type { ResourceCollision, ResourceDiagnostic, ResourceLoader } from "./core/resource-loader.js";
export { DefaultResourceLoader, loadProjectContextFiles } from "./core/resource-loader.js";
// SDK for programmatic usage
export {
	AgentSessionRuntime,
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	type CreateAgentSessionRuntimeFactory,
	type CreateAgentSessionRuntimeResult,
	type CreateAgentSessionServicesOptions,
	// Factory
	createAgentSession,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createBashTool,
	// Tool factories (for custom cwd)
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	type PromptTemplate,
} from "./core/sdk.js";
export {
	type BranchSummaryEntry,
	buildSessionContext,
	type CompactionEntry,
	CURRENT_SESSION_VERSION,
	type CustomEntry,
	type CustomMessageEntry,
	type FileEntry,
	getLatestCompactionEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	type NewSessionOptions,
	parseSessionEntries,
	type SessionContext,
	type SessionEntry,
	type SessionEntryBase,
	type SessionHeader,
	type SessionInfo,
	type SessionInfoEntry,
	SessionManager,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "./core/session-manager.js";
export {
	type BranchSummarySettings,
	type CompactionSettings,
	FileSettingsStorage,
	type ImageSettings,
	InMemorySettingsStorage,
	type MarkdownSettings,
	type PackageSource,
	type ProviderRetrySettings,
	type RetrySettings,
	type Settings,
	type SettingsError,
	SettingsManager,
	type SettingsScope,
	type SettingsStorage,
	type TerminalSettings,
	type ThinkingBudgetsSettings,
	type TransportSetting,
	type WarningSettings,
} from "./core/settings-manager.js";
// Skills
export {
	formatSkillsForPrompt,
	type LoadSkillsFromDirOptions,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
	type SkillFrontmatter,
} from "./core/skills.js";
// P11.E Skill Package Format
export {
	createSkillPackage,
	loadSkillPackage,
	type SkillPackage,
	type SkillPackageDependency,
	type SkillPackageManifest,
	type SkillPackageValidationError,
	validateSkillPackageManifest,
	validateSkillPackageStructure,
	SKILL_PACKAGE_METADATA_FILE,
} from "./core/skill-package.js";
// P11.E Skill Runner
export {
	checkCommandCapability,
	checkFileCapability,
	executeSkill,
	type SkillExecutionContext,
	type SkillExecutionOutput,
	type SkillPolicyCheckResult,
	type SkillPolicyConstraints,
	substituteVariables,
	validateSkillCommand,
	validateSkillFileOperation,
} from "./core/skill-runner.js";
// P11.E Skill Quality Metadata
export {
	formatSkillQualityTable,
	type ReliabilityRating,
	type ReliabilityScore,
	scoreToRating,
	type SkillQualityApiEntry,
	type SkillQualityApiResponse,
	type SkillQualityRecord,
	type SkillQualitySummary,
	SkillQualityStore,
	type SkillTestResult,
	type SkillTestRun,
	type SkillUsageStats,
} from "./core/skill-quality.js";
// P11.E Skill Output Artifacts
export {
	type PlanIntakeSkillArtifact,
	type ProposalSkillArtifact,
	type RemediationSkillArtifact,
	type SkillArtifactStatus,
	type SkillArtifactType,
	type SkillOutputArtifact,
	SkillOutputArtifactStore,
} from "./core/skill-output-artifact.js";
// P11.E Skill Package Manager
export {
	createSkillPackageManager,
	formatSkillInvokeResult,
	formatSkillPackageList,
	type SkillInvokeResult,
	type SkillPackageInstallResult,
	type SkillPackageListEntry,
	SkillPackageManager,
	type SkillPackageManagerConfig,
	type SkillPackageStatus,
	type SkillTestResultSummary,
} from "./core/skill-package-manager.js";
export { createSyntheticSourceInfo } from "./core/source-info.js";
export {
	estimateTokensFromMessage,
	estimateTokensFromMessages,
	estimateTokensFromString,
	type TokenRole,
	type TokenUsage,
	TokenUsageRecorder,
} from "./core/token-metering.js";
// Tools
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLocalBashOperations,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	formatSize,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	type ToolsOptions,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
	withFileMutationQueue,
} from "./core/tools/index.js";
// Main entry point
export { type MainOptions, main } from "./main.js";
// Run modes for programmatic SDK usage
export {
	InteractiveMode,
	type InteractiveModeOptions,
	type ModelInfo,
	type PrintModeOptions,
	RpcClient,
	type RpcClientOptions,
	type RpcCommand,
	type RpcEventListener,
	type RpcResponse,
	type RpcSessionState,
	runPrintMode,
	runRpcMode,
} from "./modes/index.js";
// UI components for extensions
export {
	ArminComponent,
	AssistantMessageComponent,
	BashExecutionComponent,
	BorderedLoader,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomEditor,
	CustomMessageComponent,
	DynamicBorder,
	ExtensionEditorComponent,
	ExtensionInputComponent,
	ExtensionSelectorComponent,
	FooterComponent,
	keyHint,
	keyText,
	LoginDialogComponent,
	ModelSelectorComponent,
	OAuthSelectorComponent,
	type RenderDiffOptions,
	rawKeyHint,
	renderDiff,
	SessionSelectorComponent,
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
	ShowImagesSelectorComponent,
	SkillInvocationMessageComponent,
	ThemeSelectorComponent,
	ThinkingSelectorComponent,
	ToolExecutionComponent,
	type ToolExecutionOptions,
	TreeSelectorComponent,
	truncateToVisualLines,
	UserMessageComponent,
	UserMessageSelectorComponent,
	type VisualTruncateResult,
} from "./modes/interactive/components/index.js";
// Theme utilities for custom tools and extensions
export {
	getLanguageFromPath,
	getMarkdownTheme,
	getSelectListTheme,
	getSettingsListTheme,
	highlightCode,
	initTheme,
	Theme,
	type ThemeColor,
} from "./modes/interactive/theme/theme.js";
// Clipboard utilities
export { copyToClipboard } from "./utils/clipboard.js";
export { parseFrontmatter, stripFrontmatter } from "./utils/frontmatter.js";
export { type LogEntry, type LogLevel, PiLogger } from "./utils/logger.js";
// Shell utilities
export { getShellConfig } from "./utils/shell.js";


// P11 — Orchestrator
// Proposal generation from scan findings and orchestrator types
export { createOrchestratorProposalGenerator, OrchestratorProposalGenerator } from "./orchestrator/index.js";
export type { OrchestratorProposalGeneratorConfig } from "./orchestrator/index.js";
export type {
	OrchestratorProposal,
	PolicyClassification,
	ProposalEvidenceLink,
	ProposalGenerationResult,
	ProposalSourceType,
	SuggestedNextAction,
} from "./orchestrator/index.js";

// P11.C — Plan Intake Analyzer
export {
	analyzePlanIntake,
	approveIntakeProposal,
	formatPlanIntakeAnalysis,
	type IntakeBottleneck,
	type IntakeDiagnostic,
	type IntakeSeverity,
	type IntakeStatus,
	type PlanIntakeAnalysis,
	rejectIntakeProposal,
	type SerializedTailInfo,
} from "./core/plan-intake-analyzer.js";

// P11.I — Graph Diff and Approval Engine
export {
	applyApprovedGraphPatch,
	approveGraph,
	checkApprovalStaleness,
	computeGraphHash,
	createGraphApproval,
	formatApprovalRecord,
	formatGraphDiff,
	generateGraphDiff,
	type GraphApprovalRecord,
	type GraphDiff,
	type GraphDiffEntry,
	type MetricsComparison,
	markApprovalStale,
	rejectGraph,
} from "./core/graph-diff-engine.js";

// P11.M — Platform Audit Ledger
export {
	type AuditEventFilter,
	type AuditSummary,
	type PlatformAuditCategory,
	type PlatformAuditEvent,
	type PlatformAuditOutcome,
	type PlatformAuditSeverity,
	PlatformAuditLedger,
	getPlatformAuditLedger,
	resetPlatformAuditLedger,
} from "./core/platform-audit-ledger.js";
