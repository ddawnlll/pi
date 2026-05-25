/**
 * Diagnostic Packet and Evidence Model - Workspace 25.E
 *
 * Defines a structured diagnostic packet format that carries evidence-backed
 * diagnostics with built-in budget enforcement, cooldown, deduplication,
 * and stop-condition tracking for autonomous workspace execution.
 *
 * Re-exports from the core implementation.
 */

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
} from "../core/diagnostic-packet.js";
