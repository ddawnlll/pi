/**
 * Completion Module — Barrel Export
 *
 * Aggregates all completion sub-system exports:
 * - Acceptance criteria types, registry, and helpers
 * - Evidence types, ledger, and helpers
 * - Traceability schema and helpers
 * - Worker echo extractor
 * - Worker report contract and builder
 * - Completion gate v2 types and function
 * - Completion gate result types
 * - Completion gate adapter
 * - Terminal verdict parser (P44.04)
 * - Terminal verdict reconciler (P44.04)
 * - Post-implementation auditor (P44.07)
 */

export type {
	AcceptanceCriteriaReport,
	AcceptanceCriterion,
	CriterionCategory,
	CriterionLevel,
	CriterionVerificationStatus,
} from "./acceptance-criteria.js";
// Acceptance Criteria
export {
	ACCEPTANCE_CRITERIA_SCHEMA_VERSION,
	AcceptanceCriteriaRegistry,
	aggregateCriterionStatus,
	buildTraceabilityReport,
	createCriterion,
	createRegistryFromPlan,
	formatBlockingReasons,
	formatCriterionId,
	getBlockingCriteria,
	isCriterionBlocking,
	parseRawCriteria,
} from "./acceptance-criteria.js";
// Completion Gate Adapter
export {
	buildEvidenceSatisfactionFromLedger,
	buildLockHashV2Options,
	evaluateCompletionWithAdapter,
	shouldUseV2Mode,
} from "./completion-gate-adapter.js";
// Completion Gate Result Types
export type {
	EvidenceSatisfaction,
	GovernanceLedgerCompletionResult,
	PlanCompletionResult,
	WorkspaceCompletionResult,
} from "./completion-gate-result.js";
export type { WorkspaceCompletionV2Options } from "./completion-gate-v2.js";
// Completion Gate v2
export {
	buildV2Options,
	checkEvidenceSatisfaction,
	evaluateWorkspaceCompletionV2,
} from "./completion-gate-v2.js";
// CompletionGate vNext Orchestrator (P44.5.02)
export type {
	StageExecutionContext,
	StageRunner,
} from "./completion-gate-vnext.js";
export {
	createDefaultStageRegistry,
	runCompletionGateVNext,
	StageRunnerRegistry,
} from "./completion-gate-vnext.js";
// CompletionGate vNext Adapter (P44.5.02)
export type { CompletionGateVNextAdapterOptions } from "./completion-gate-vnext-adapter.js";
export {
	evaluateThroughAdapter,
	shouldBlockForMode,
	shouldUseVNextMode,
} from "./completion-gate-vnext-adapter.js";
// CompletionGate vNext Types (P44.5.01)
export type {
	AgentCompletionClaim,
	BackfillStatus,
	CommitCandidateSet,
	CompletionGateStageName,
	CompletionGateVNextVerdict,
	RecoveryReportType,
	RecoveryRoute,
	RecoveryState,
	RetryPolicy,
	RolloutMode,
	StageFailureKind,
	StageVerdict,
	VerifiedReality,
	WorkspaceDurabilityStatus,
	WorkspaceImplementationStatus,
	WorkspaceRuntimeStatus,
	WorkspaceTruthStatus,
	WorkspaceValidationStatus,
} from "./completion-gate-vnext-types.js";
export {
	COMPLETION_GATE_VNEXT_SCHEMA_VERSION,
	ROLLOUT_MODE_SEQUENCE,
	STAGE_ORDER,
} from "./completion-gate-vnext-types.js";
export type { EvidenceLedgerSnapshot } from "./evidence-ledger.js";
// Evidence Ledger
export { EvidenceLedger } from "./evidence-ledger.js";
export type {
	EvidenceConfidence,
	EvidenceFilter,
	EvidenceLedgerEntry,
	EvidenceSummary,
	EvidenceType,
	EvidenceVerdict,
} from "./evidence-types.js";
// Evidence Types
export {
	computeEvidenceSummary,
	createArtifactEvidence,
	formatEvidenceId,
	meetsMinConfidence,
} from "./evidence-types.js";
// P45 Bridge Exporter (P45.B1)
export type {
	AcceptedWriteSet,
	AcceptedWriteSetOptions,
	OwnershipEntry,
	OwnershipSummary,
	OwnershipSummaryOptions,
} from "./p45-bridge-exporter.js";
export {
	buildAcceptedWriteSet,
	buildOwnershipSummary,
	DEFAULT_ACCEPTED_WRITE_SET_PATH,
	DEFAULT_OWNERSHIP_SUMMARY_PATH,
	formatAcceptedWriteSetReport,
	formatOwnershipSummaryReport,
	P45_BRIDGE_SCHEMA_VERSION,
	serializeAcceptedWriteSet,
	serializeOwnershipSummary,
	toAcceptedWriteSetJSON,
	toOwnershipSummaryJSON,
} from "./p45-bridge-exporter.js";
// Post-Implementation Auditor (P44.07)
export type {
	AuditCompletionGateSummary,
	AuditEvidenceSummary,
	AuditFinding,
	AuditFindingCategory,
	AuditFindingSeverity,
	AuditVerdict,
	AuditWorkerReportSummary,
	AuditWriteSetSummary,
	CompletionGateAuditOptions,
	EvidenceAuditOptions,
	PostImplementationAuditOptions,
	PostImplementationAuditReport,
	WorkerReportAuditOptions,
	WriteSetAuditOptions,
} from "./post-implementation-auditor.js";
export {
	auditCompletionGate,
	auditEvidence,
	auditWorkerReport,
	auditWriteSet,
	buildAuditSummary,
	buildRecommendations,
	createSeverityCounts,
	DEFAULT_COMPLETION_GATE_AUDIT_OPTIONS,
	DEFAULT_EVIDENCE_AUDIT_OPTIONS,
	DEFAULT_WORKER_REPORT_AUDIT_OPTIONS,
	DEFAULT_WRITE_SET_AUDIT_OPTIONS,
	formatAuditReport,
	generateFindingId,
	incrementSeverityCount,
	POST_IMPLEMENTATION_AUDIT_SCHEMA_VERSION,
	performPostImplementationAudit,
	resetFindingSequence,
} from "./post-implementation-auditor.js";
// Terminal Verdict Reconciler (P44.04)
export type {
	AttemptRecord,
	ReconciledWorkspaceResult,
	TerminalReconcilerConfig,
} from "./terminal-reconciler.js";
export {
	reconcileTerminalVerdicts,
	TerminalVerdictReconciler,
} from "./terminal-reconciler.js";
// Terminal Verdict Parser (P44.04)
export type {
	TerminalVerdict,
	TerminalVerdictParseResult,
	TerminalVerdictParserOptions,
	VerdictConfidence,
} from "./terminal-verdict-parser.js";
export {
	getEmptyResponseVerdict,
	isEmptyProviderResponse as isEmptyProviderVerdictResponse,
	parseTerminalVerdict,
} from "./terminal-verdict-parser.js";
export type {
	TraceabilityLink,
	TraceabilityLinkInput,
	TraceabilityRelationship,
	TraceabilityReport,
} from "./traceability-schema.js";
// Traceability Schema
export {
	buildCriterionLinkMap,
	buildEvidenceLinkMap,
	buildReport,
	buildTraceabilityReport as buildTraceabilityReportFromLinks,
	countLinksByRelationship,
	createLink,
	createTraceabilityLink,
	filterLinksByRelationship,
	getLinksForCriterion,
	getLinksForEvidence,
	isValidLink,
	validateLink,
} from "./traceability-schema.js";
export type { WorkerEchoClaim, WorkerEchoExtractionResult } from "./worker-echo-extractor.js";
// Worker Echo Extractor
export { extractWorkerEcho, verifyWorkerEcho } from "./worker-echo-extractor.js";
export type {
	CriterionReportItem,
	MutationSummary,
	WorkerReport,
	WorkerVerdict,
} from "./worker-report-contract.js";
// Worker Report Contract
export {
	buildReportFromCriteria,
	determineVerdict,
	formatReport,
	generateReportId,
	getReportBlockingReasons,
	isReportSuccessful,
	WorkerReportBuilder,
} from "./worker-report-contract.js";
// Workspace Commit Gate (P44.08)
export type {
	CompletionCommitGateResult,
	WorkspaceCommitGateConfig,
	WorkspaceCommitGateResult,
} from "./workspace-commit-gate.js";
export { toCompletionCommitGateResult, WorkspaceCommitGate } from "./workspace-commit-gate.js";
// Workspace Truth Status (P44.5.01)
export type {} from "./workspace-truth-status.js";
export {
	applyVerdictToStatus,
	BLOCKING_ROLLOUT_MODES,
	computeVerifiedComplete,
	createFailedStageVerdict,
	createPassedStageVerdict,
	createRecoveryRoute,
	createWarningStageVerdict,
	createWorkspaceTruthStatus,
	DEFAULT_ROLLOUT_MODE,
	deriveRecoveryState,
	determineBackfillStatus,
	durabilityStatusLabel,
	shouldBlockCompletion,
	validationStatusLabel,
} from "./workspace-truth-status.js";
// Workspace WriteSet (P44.08)
export type {
	WorkspaceWriteSet,
	WriteSetComparisonResult,
	WriteSetFileEntry,
	WriteSetFileStatus,
} from "./workspace-write-set.js";
export {
	buildWorkspaceWriteSet,
	classifyEmpiricalWriteSet,
	compareWriteSets,
	computeEmpiricalWriteSet,
	formatWriteSetComparison,
	isAllowedArtifact,
	isFileInWriteSet,
	WRITE_SET_SCHEMA_VERSION,
} from "./workspace-write-set.js";
