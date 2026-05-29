/**
 * Brain — Pi V2 second-brain cognitive OS module.
 *
 * This barrel file re-exports all public types and helpers
 * from the brain sub-modules.
 */

// Brain API helpers — queried by packages/web-server/src/routes/brain/*.ts
export * from "./api.js";
// Approval Queue API (P18.D)
export { ApprovalQueueApi, createApprovalQueueApi } from "./approvals/api.js";
// Approval Gate (P18.C)
export { ApprovalGate, createApprovalGate } from "./approvals/gate.js";
export type {
	FeedbackEntry,
	FeedbackItemType,
	FeedbackQuery,
	FeedbackQueryResult,
	FeedbackRating,
	FeedbackStats,
} from "./attention/feedback-store.js";
// Feedback Store (24.J)
export {
	ALL_FEEDBACK_ITEM_TYPES,
	createFeedbackEntry,
	FeedbackStore,
	validateFeedbackEntry,
} from "./attention/feedback-store.js";
// Audit Ledger (P18.E)
export { AuditLedger, createAuditLedger } from "./audit/ledger.js";
export type {
	ContextBuildOptions,
	ContextPack,
	ContextSource,
	ContextSourceType,
	IgnoredMemoryEntry,
	IgnoredReasonCode,
	InjectionComplianceCheck,
	InjectionComplianceResult,
	InjectionPolicyRules,
	MemoryInjectionInput,
	MemoryInjectionOptions,
	MemoryInjectionRecord,
	MemoryInjectionReport,
	TemporalContext,
} from "./context/index.js";
// Context Builder & Memory Injection (V5.04)
export {
	ALL_CONTEXT_SOURCE_TYPES,
	ALL_IGNORED_REASON_CODES,
	ContextBuilder,
	createContextBuilder,
	createMemoryInjectionEngine,
	DEFAULT_INJECTION_POLICY_RULES,
	MemoryInjectionEngine,
} from "./context/index.js";
export type { EvidenceEventSink } from "./evidence/api.js";
export { createEvidenceApi, EvidenceApi } from "./evidence/api.js";
// Evidence Index (V5.02)
export { createEvidenceIndex, EvidenceIndex } from "./evidence/index.js";
// Brain V5 — V5 Contract, Flags & Safety Doctrine
export type { EvidencePack, EvidencePackGroup, EvidencePackOptions, EvidencePackSummary } from "./evidence/pack.js";
export {
	buildEvidencePack,
	buildEvidencePackSummary,
	createEmptyEvidencePack,
	validateContentHasEvidenceRefs,
} from "./evidence/pack.js";
export type {
	EvidenceAssessment,
	EvidenceConfidenceLevel,
	EvidenceQuery,
	EvidenceQueryResult,
	EvidenceRef,
	EvidenceRefType,
	EvidenceResolution,
	EvidenceSource,
	EvidenceStats,
	IEvidenceIndex,
} from "./evidence/types.js";
export {
	ALL_EVIDENCE_REF_TYPES,
	assessEvidenceConfidence,
	createEvidenceRef,
	createEvidenceSource,
	evidenceRefToSource,
	HIGH_CONFIDENCE_THRESHOLD,
	LOW_CONFIDENCE_THRESHOLD,
	validateEvidenceRef,
	validateEvidenceSource,
} from "./evidence/types.js";
export type {
	V5Answer,
	V5Draft,
	V5MemoryInjection,
	V5MemoryInjectionReport,
	V5OutputBuildOptions,
} from "./evidence/v5-outputs.js";
export {
	buildConfidenceExplanation,
	buildV5Answer,
	buildV5Draft,
	buildV5MemoryInjectionReport,
	evidenceMeetsThreshold,
} from "./evidence/v5-outputs.js";
export type { ClassificationContext, DecisionAuditEntry } from "./goals/decisions.js";
// Decision Classifier (P15.D)
export { DecisionClassifier } from "./goals/decisions.js";
export type { DriftCheckState, DriftDetectorConfig } from "./goals/drift.js";
// Goal Drift Detector (P15.E)
export { GoalDriftDetector } from "./goals/drift.js";
export type {
	AuthorizationEvent,
	AuthorizationResult,
	AutonomyEngineConfig,
	AutonomyEngineEvent,
	ProfileLevelChangeEvent,
} from "./goals/profile-engine.js";
// Autonomy Profile Engine (P15.C)
export { AutonomyEngine, DEFAULT_AUTONOMY_CONFIG, DEFAULT_DECISION_RULES } from "./goals/profile-engine.js";
export type {
	DecisionExplanation,
	NeedsApprovalEntry,
	NightProtocolConfig,
	NightProtocolStopCondition,
	RejectionRecord,
	WhatCompletedEntry,
} from "./goals/protocol.js";
// User Protocol Actions (P15.F)
export {
	ALL_NIGHT_PROTOCOL_STOP_CONDITIONS,
	DEFAULT_NIGHT_MAX_DURATION_HOURS,
	DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS,
	UserProtocol,
} from "./goals/protocol.js";
export type { GoalIndex, GoalIndexEntry, GoalStoreConfig } from "./goals/store.js";
// Goal Store (P15.B)
export { GoalStore } from "./goals/store.js";
// Goal & Preference Domain Model (P15.A)
export type {
	AutonomyCapabilities,
	AutonomyLevel,
	AutonomyProfile,
	ConditionOperator,
	DecisionClass,
	DecisionClassification,
	DecisionCondition,
	DecisionRule,
	DriftIndicator,
	DriftIndicatorType,
	DriftSeverity,
	GoalCreateInput,
	GoalDriftReport,
	GoalPriority,
	GoalRecord,
	GoalStatus,
	GoalsStats,
	GoalUpdateInput,
	Milestone,
	PreferenceCategory,
	PreferenceCreateInput,
	PreferenceRecord,
	PreferenceSource,
} from "./goals/types.js";
export {
	ALL_AUTONOMY_LEVELS,
	ALL_CONDITION_OPERATORS,
	ALL_DECISION_CLASSES,
	ALL_DRIFT_INDICATOR_TYPES,
	ALL_DRIFT_SEVERITIES,
	ALL_GOAL_PRIORITIES,
	ALL_GOAL_STATUSES,
	ALL_PREFERENCE_CATEGORIES,
	ALL_PREFERENCE_SOURCES,
	AUTONOMY_CAPABILITIES,
	computeGoalsStats,
	createAutonomyProfile,
	createDecisionRule,
	createGoalCreateInput,
	createGoalDriftReport,
	createGoalRecord,
	createMilestone,
	createPreferenceCreateInput,
	createPreferenceRecord,
	deserializeAutonomyProfile,
	deserializeGoalDriftReport,
	deserializeGoalRecord,
	deserializePreferenceRecord,
	serializeAutonomyProfile,
	serializeGoalDriftReport,
	serializeGoalRecord,
	serializePreferenceRecord,
	validateAutonomyProfile,
	validateDecisionRule,
	validateGoalDriftReport,
	validateGoalRecord,
	validateMilestone,
	validatePreferenceRecord,
} from "./goals/types.js";
export type { PiInboxListResult, PiInboxQuery, PiInboxStoreConfig } from "./inbox/pi-inbox-store.js";
// Pi Inbox (24.M)
export { PiInboxStore } from "./inbox/pi-inbox-store.js";
export type {
	PiInboxMessage,
	PiInboxMessagePriority,
	PiInboxMessageType,
	PiInboxStats,
	ValidationResult as PiInboxValidationResult,
} from "./inbox/types.js";
export {
	ALL_PI_INBOX_MESSAGE_TYPES,
	ALL_PI_INBOX_PRIORITIES,
	createPiInboxMessage,
	validatePiInboxMessage,
} from "./inbox/types.js";
export type { MemoryCorrectionRecord, MemoryListResult, SupersedeResult } from "./memory/api.js";
// Memory Correction API (P14.F)
export { MemoryCorrectionApi } from "./memory/api.js";
export type { LifecycleConfig, LifecycleTransition } from "./memory/lifecycle.js";
// Memory Lifecycle Engine (P14.C)
export { MemoryLifecycleEngine } from "./memory/lifecycle.js";
export type {
	MemoryRetrievalEntry,
	MemoryRetrievalReport,
	MemoryRetrievalResult,
	RetryHotspotQuery,
} from "./memory/retrieval.js";
// Memory Retrieval V2 (V5.03)
export { createMemoryRetrievalV2, MemoryRetrievalV2 } from "./memory/retrieval.js";
// Memory Scoring Engine (P14.D)
export {
	DEFAULT_SCORING_CONFIG,
	MemoryScoringEngine,
	type ScoringConfig,
	type ScoringWeights,
} from "./memory/scoring.js";
export type { MemoryIndex, MemoryIndexEntry, MemoryStoreConfig } from "./memory/store.js";
// Memory Store (P14.B)
export { MemoryStore } from "./memory/store.js";
// Memory Domain Model (P14.A)
export type {
	MemoryConflict,
	MemoryLifecycle,
	MemoryProvenance,
	MemoryQuery,
	MemoryRecord,
	MemoryScore,
	MemorySourceRef,
	MemoryStats,
	MemoryType,
} from "./memory/types.js";
export {
	ALL_CONFLICT_TYPES,
	ALL_MEMORY_LIFECYCLES,
	ALL_MEMORY_SOURCE_REF_TYPES,
	ALL_MEMORY_TYPES,
	ALL_RESOLUTION_TYPES,
	ALL_VALIDATED_BY,
	computeMemoryScore,
	computeMemoryStats,
	createMemoryConflict,
	createMemoryRecord,
	deserializeMemoryConflict,
	deserializeMemoryRecord,
	MAX_QUERY_LIMIT,
	serializeMemoryConflict,
	serializeMemoryRecord,
	validateMemoryConflict,
	validateMemoryQuery,
	validateMemoryRecord,
} from "./memory/types.js";
export {
	ExecutionJournalObserver,
	ObservationEngine,
	type ObservationEngineConfig,
	type ObservationResult,
	type Observer,
	type ObserverOutput,
	QueueHealthObserver,
	RetryFailureSignalExtractor,
} from "./observation-engine.js";
export type {
	ArtifactLink,
	MorningReport,
	MorningReportAuditLedger,
	MorningReportData,
	MorningReportMemoryStore,
	MorningReportObservationEngine,
	MorningReportReflectionEngine,
	OvernightConfig,
	OvernightStatus,
	OvernightStopCondition,
	PlanQueueRef,
	RunProgress,
	RunSession,
	RunStatus,
	TopProposal,
	ValidationCheck,
	ValidationCheckResult,
	ValidationResult as OvernightValidationResult,
	ValidationScenario,
	WhatRanEntry,
	WhatStoppedEntry,
} from "./overnight/index.js";
// Overnight Run Orchestration (P20.A) & Morning Report Generator (P20.B) & Full Loop Validation (P20.C)
export {
	DEFAULT_OVERNIGHT_CONFIG,
	DogfoodReportGenerator,
	FullLoopValidator,
	MorningReportGenerator,
	OvernightOrchestrator,
	SessionStore,
	TrustAssessor,
} from "./overnight/index.js";
export type { PolicyEngineConfig } from "./policy/engine.js";
// Policy Engine V0 (P18.A)
export { createPolicyEngine, PolicyEngine } from "./policy/engine.js";
// Provenance Tracker (P18.F)
export { createProvenanceTracker, ProvenanceTracker } from "./policy/provenance.js";
export type { PolicyRuleStats, RuleIndex, RuleIndexEntry, RuleQuery } from "./policy/store.js";
// Rule Store (P18.B)
export { RuleStore } from "./policy/store.js";
// Proposal API (P16.F)
export {
	BrainProposalApi,
	type EvidenceDetail,
	type ProposalAcceptResult,
	type ProposalCard,
	type ProposalCardEvidence,
	type ProposalCardRisk,
	type ProposalCorrectResult,
	type ProposalCreateResult,
	type ProposalExecutionReadyResult,
	type ProposalExpireResult,
	type ProposalRejectResult,
	proposalToCard,
} from "./proposals/api.js";
// Proposal Deduplication (P16.D)
export {
	DEFAULT_COOLDOWNS as DEFAULT_PROPOSAL_COOLDOWNS,
	type DedupConfig,
	type DedupConfigInput,
	ProposalDeduplication as DedupEngine,
	type SuppressionLogEntry,
} from "./proposals/dedup.js";
// Proposal Generator (P16.B)
export {
	DEFAULT_GENERATOR_CONFIG,
	type GenerateProposalsResult,
	type GenerationTrigger,
	type GeneratorConfig,
	type ProposalDeduplication,
	ProposalGenerator,
	type ReflectionReport,
} from "./proposals/generator.js";
// Proposal Inbox (P16.E)
export {
	DEFAULT_INBOX_CONFIG,
	type InboxConfig,
	type InboxStats,
	ProposalInbox,
} from "./proposals/inbox.js";
// Proposal Scoring Engine (P16.C)
export {
	DEFAULT_SCORING_CONFIG as DEFAULT_PROPOSAL_SCORING_CONFIG,
	ProposalScoringEngine,
	type ScoringConfig as ProposalScoringConfig,
	type ScoringWeights as ProposalScoringWeights,
} from "./proposals/scoring.js";
// Proposal Store (P16.F)
export { InMemoryProposalStore } from "./proposals/store.js";
// Proposal Domain Model (P16.A)
export type {
	InboxEntry,
	InboxView,
	Proposal,
	ProposalCreateInput,
	ProposalEvidence,
	ProposalQuery,
	ProposalRiskAssessment,
	ProposalScore,
	ProposalStats,
	ProposalStatus,
	ProposalStore,
	ProposalType,
	ProposalUpdateInput,
	RiskLevel,
} from "./proposals/types.js";
export {
	ALL_PROPOSAL_STATUSES,
	ALL_PROPOSAL_TYPES,
	ALL_RISK_LEVELS,
	computeProposalStats,
	createProposal,
	createProposalCreateInput,
	DEFAULT_AUTO_QUEUE_CONFIDENCE_MIN,
	DEFAULT_AUTO_QUEUE_TOTAL_THRESHOLD,
	DEFAULT_PROPOSAL_EXPIRY_DAYS,
	validateProposalCreateInput,
	validateProposalEvidence,
	validateProposalRisk,
} from "./proposals/types.js";
// Reflection API (P17.G) — V5.10: added correction/rejection/audit methods
export {
	type AuditTrailResult,
	BrainReflectionApi,
	type ReflectionCorrectionResult,
	type ReflectionGenerateResult,
	type ReflectionListQuery,
	type ReflectionRejectionResult,
	type ReflectionStats,
} from "./reflection/api.js";
// Reflection Audit (V5.10 AC3)
export {
	InMemoryReflectionAuditStore,
	ReflectionAuditService,
	type ReflectionAuditStore,
} from "./reflection/audit.js";
// Reflection Engine (P17.C)
export { ReflectionEngine } from "./reflection/engine.js";
// Future Phase Suggestion Engine (P17.F)
export { FutureSuggestionEngine, type SuggestionRankingConfig } from "./reflection/future-suggestions.js";
// Memory Proposal Generator (P17.E)
export { MemoryProposalGenerator, type MemoryProposalOutput } from "./reflection/memory-proposals.js";
// Source-Backed Summarizer (P17.D)
export { SourceBackedSummarizer } from "./reflection/summarizer.js";
export type {
	EvidenceClaim,
	ExecutionJournalEntry,
	FuturePhaseSuggestion,
	MemoryProposalSuggestion,
	ProposalSuggestion,
	ReflectionAuditEntry,
	ReflectionConfig,
	ReflectionCorrection,
	ReflectionInput,
	ReflectionRejection,
	ReflectionReport as P17ReflectionReport,
	ValidationResult as ReflectionValidationResult,
	WorkspaceOutcome,
} from "./reflection/types.js";
export { createFailureCorrelator, FailureCorrelator } from "./scanner/failure-correlator.js";
export { createGitDiffScanner, GitDiffScanner } from "./scanner/git-diff-scanner.js";
export { createHotspotDetector, HotspotDetector } from "./scanner/hotspot-detector.js";
export {
	createProposalCandidateGenerator,
	ProposalCandidateGenerator,
} from "./scanner/proposal-candidate-generator.js";
// Repo Scanner v2 (V5.05)
export { createRepoScanner, RepoScanner } from "./scanner/scanner.js";
export { createStaleAreaDetector, StaleAreaDetector } from "./scanner/stale-area-detector.js";
export type {
	FailureCorrelation,
	Hotspot,
	ProposalCandidate,
	RiskyDiff,
	ScannerOptions,
	ScanRequest,
	ScanResult,
	ScanTarget,
	StalePlanArea,
} from "./scanner/types.js";
export { DEFAULT_SCANNER_OPTIONS } from "./scanner/types.js";
// Signal & Anomaly Engine (V5.06)
export { createSignalEngine, SignalEngine } from "./signals/index.js";
export type {
	CooldownConfig,
	DecisionImpactContext,
	FeedRoutingConfig,
	SignalDedupKey,
	SignalEngineConfig,
	SignalEngineState,
	SignalFeedTarget,
	ValidationRepeatConfig,
	ValidationSignature,
} from "./signals/types.js";
export {
	DEFAULT_COOLDOWN_CONFIG,
	DEFAULT_FEED_ROUTING,
	DEFAULT_SIGNAL_ENGINE_CONFIG,
	DEFAULT_VALIDATION_REPEAT_CONFIG,
	formatDedupKey,
	parseDedupKey,
} from "./signals/types.js";
export {
	computePeriodBoundaries,
	computeRollupDeterministicHash,
	DEFAULT_TEMPORAL_ENGINE_CONFIG,
	detectChanges,
	detectRepeatedPatterns,
	detectStuckItems,
	generateRollup,
	InMemoryTemporalJournalStore,
	TemporalEngine,
} from "./temporal/index.js";
// Temporal Journal v2 (V5.01)
export type {
	ChangeItem,
	RepeatedPattern,
	RollupPeriod,
	StuckItem,
	StuckItemsResult,
	TemporalEngineConfig,
	TemporalEntityJournal,
	TemporalEntityType,
	TemporalEvent,
	TemporalEventQuery,
	TemporalEvidenceRef,
	TemporalJournalStore,
	TemporalRollup,
	TemporalRollupQuery,
	TimelineItem,
	WhatChangedSection,
	WhatHappenedSection,
	WhatRepeatedSection,
} from "./temporal/types.js";
export {
	type AppendEventResult,
	type BrainTimelineStore,
	type BrainTimelineStoreConfig,
	InMemoryBrainTimelineStore,
	MAX_ARCHIVES,
	MAX_TIMELINE_FILE_SIZE,
	type TimelineQueryOptions,
	type TimelineQueryResult,
	type TimelineStoreStats,
} from "./timeline-store.js";
export type {
	BrainObservation,
	BrainSignal,
	BrainTimelineEvent,
	EventSource,
	ProvenanceInfo,
	Severity,
	SignalType,
	SourceRef,
	SourceRefType,
	TimelineEventType,
	ValidationResult,
} from "./types.js";
export {
	ALL_EVENT_SOURCES,
	ALL_SEVERITIES,
	ALL_SIGNAL_TYPES,
	ALL_SOURCE_REF_TYPES,
	ALL_TIMELINE_EVENT_TYPES,
	createBrainObservation,
	createBrainSignal,
	createBrainTimelineEvent,
	deserializeBrainObservation,
	deserializeBrainSignal,
	deserializeBrainTimelineEvent,
	serializeBrainObservation,
	serializeBrainSignal,
	serializeBrainTimelineEvent,
	validateBrainObservation,
	validateBrainSignal,
	validateBrainTimelineEvent,
} from "./types.js";
export {
	canV5EmitEvents,
	canV5Push,
	canV5RunOvernight,
	deriveBrainV5Mode,
	isV5Enabled,
	resolveBrainV5Config,
} from "./v5/config.js";
export { V5MutationGuard } from "./v5/mutation-guard.js";
export {
	buildV5DoctorReport,
	checkV5OperatorGates,
	formatV5DoctorSummary,
} from "./v5/plan-doctor.js";

export type {
	BrainV5Config,
	BrainV5Mode,
	V5AllowedEvent,
	V5EmitResult,
	V5EventSink,
	V5OperatorGateStatus,
	V5PlanDoctorReport,
	V5RejectCode,
} from "./v5/types.js";
export {
	BRAIN_V5_MODE_RANK,
	BRAIN_V5_MODES,
	brainV5ModeAtLeast,
	V5_ALLOWED_ACTOR_EVENT_TYPES,
	V5_FORBIDDEN_ACTOR_EVENT_TYPES,
} from "./v5/types.js";
