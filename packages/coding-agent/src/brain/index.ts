/**
 * Brain — Pi V2 second-brain cognitive OS module.
 *
 * This barrel file re-exports all public types and helpers
 * from the brain sub-modules.
 */

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
export type { MemoryCorrectionRecord, MemoryListResult, SupersedeResult } from "./memory/api.js";
// Memory Correction API (P14.F)
export { MemoryCorrectionApi } from "./memory/api.js";
export type { LifecycleConfig, LifecycleTransition } from "./memory/lifecycle.js";
// Memory Lifecycle Engine (P14.C)
export { MemoryLifecycleEngine } from "./memory/lifecycle.js";
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
	FullLoopValidator,
	MorningReportGenerator,
	OvernightOrchestrator,
	SessionStore,
} from "./overnight/index.js";
// Proposal API (P16.F)
export {
	BrainProposalApi,
	type EvidenceDetail,
	type ProposalAcceptResult,
	type ProposalCorrectResult,
	type ProposalCreateResult,
	type ProposalExpireResult,
	type ProposalRejectResult,
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
// Reflection API (P17.G)
export { BrainReflectionApi, type ReflectionGenerateResult, type ReflectionListQuery, type ReflectionStats } from "./reflection/api.js";
// Reflection Engine (P17.C)
export { ReflectionEngine } from "./reflection/engine.js";
// Memory Proposal Generator (P17.E)
export { MemoryProposalGenerator, type MemoryProposalOutput } from "./reflection/memory-proposals.js";
// Future Phase Suggestion Engine (P17.F)
export { FutureSuggestionEngine, type SuggestionRankingConfig } from "./reflection/future-suggestions.js";
// Source-Backed Summarizer (P17.D)
export { SourceBackedSummarizer } from "./reflection/summarizer.js";
export type {
	ExecutionJournalEntry,
	FuturePhaseSuggestion,
	MemoryProposalSuggestion,
	ProposalSuggestion,
	ReflectionConfig,
	ReflectionInput,
	ReflectionReport as P17ReflectionReport,
	ValidationResult as ReflectionValidationResult,
	WorkspaceOutcome,
} from "./reflection/types.js";
export {
	type AppendEventResult,
	BrainTimelineStore,
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
