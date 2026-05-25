/**
 * Diagnostics Module - Workspace 25.E
 *
 * Barrel export for the diagnostics module, providing:
 * - Diagnostic packet types and creation
 * - Evidence model with category-specific structured data
 * - Root cause analysis
 * - Diagnostic collector for building packets from execution context
 */

export {
	type AgentResult,
	type CollectorRegistry,
	createDiagnosticCollector,
	DiagnosticCollector,
	type DiagnosticCollectorOptions,
	EvidenceCollector,
	type FailureContext,
	type SchedulerDiagnostics,
} from "../core/diagnostic-collector.js";
export {
	type AgentReportData,
	type AgentVerdict,
	activateCooldown,
	type CooldownData,
	type CooldownState,
	type CreateDiagnosticPacketOptions,
	type CreateEvidenceEntryOptions,
	checkAndClearCooldown,
	compactDiagnosticPacket,
	createCooldownState,
	createDedupeState,
	createDiagnosticPacket,
	createEvidenceEntry,
	createEvidenceGroup,
	createPacketBudget,
	createPlaceholderEvidenceEntry,
	createStopConditionState,
	DEFAULT_COOLDOWN_DURATION_MS,
	type DedupeState,
	type DiagnosticPacket,
	type DiagnosticType,
	deserializeDiagnosticPacket,
	type ErrorData,
	type EvidenceCategory,
	type EvidenceEntry,
	type EvidenceGroup,
	type FailureData,
	type FileData,
	formatDiagnosticPacket,
	isPacketWithinBudget,
	mergeEvidenceGroups,
	type PacketBudget,
	type PacketSeverity,
	type SchedulingData,
	type SkipReason,
	type StopConditionState,
	serializeDiagnosticPacket,
	type TestData,
	type ValidationResult,
	validateDiagnosticPacket,
	verifyPacketIntegrity,
} from "./diagnostic-packet.js";

export {
	createEvidenceEntry as createEvidence,
	createEvidenceGroup as createGroup,
	mergeEvidenceGroups as mergeGroups,
} from "./evidence.js";
export {
	analyzeRootCause,
	createEvidenceFromRootCauseAnalysis,
	type RootCause,
	type RootCauseAnalysis,
	type RootCauseCategory,
} from "./root-cause.js";
