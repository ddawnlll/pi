/**
 * Diagnostic Packet and Evidence Model - Workspace 25.E
 *
 * Structured diagnostic packet that carries evidence-backed diagnostics
 * through the workspace execution pipeline. Bridges failure classification,
 * scheduling diagnostics, execution outcomes, and brain observations into
 * a single, self-contained diagnostic unit with budget, cooldown, dedupe,
 * and stop-condition handling.
 *
 * No silent errors — every diagnostic must be backed by at least one
 * piece of evidence. Empty evidence triggers a "placeholder" evidence
 * entry describing the gap.
 *
 * @packageDocumentation
 */

import * as crypto from "node:crypto";
import type { FailureClassification, FailureCategory } from "../failure/failure-classifier.js";
import type { SchedulerDiagnostics, SkipReason } from "./scheduler.js";

// ---------------------------------------------------------------------------
// Evidence Types
// ---------------------------------------------------------------------------

/**
 * Categories of evidence that can back a diagnostic.
 */
export type EvidenceCategory =
	| "file" // File content or file metadata
	| "test_output" // Test run output (stdout/stderr)
	| "log_output" // Execution log entry
	| "git_diff" // Git diff between two refs
	| "git_log" // Git log / commit history
	| "error_message" // Error message or stack trace
	| "scheduling_decision" // Scheduler decision record
	| "failure_classification" // Failure classification result
	| "agent_report" // Agent execution report
	| "system_state" // System state snapshot (memory, CPU, disk)
	| "budget_snapshot" // Budget state at time of diagnostic
	| "policy_evaluation" // Policy engine evaluation result
	| "cooldown_state" // Cooldown state record
	| "placeholder"; // Placeholder when evidence is missing

/**
 * All valid EvidenceCategory values for runtime validation.
 */
export const ALL_EVIDENCE_CATEGORIES: EvidenceCategory[] = [
	"file",
	"test_output",
	"log_output",
	"git_diff",
	"git_log",
	"error_message",
	"scheduling_decision",
	"failure_classification",
	"agent_report",
	"system_state",
	"budget_snapshot",
	"policy_evaluation",
	"cooldown_state",
	"placeholder",
];

/**
 * File-specific evidence data.
 */
export interface FileEvidenceData {
	/** Absolute or relative file path */
	filePath: string;
	/** Content snippet or full content */
	content?: string;
	/** Total file size in bytes */
	fileSizeBytes?: number;
	/** Line range relevant to the diagnostic */
	lineRange?: LineRange;
	/** File modification timestamp (ISO 8601) */
	modifiedAt?: string;
	/** Git commit hash that last modified this file */
	lastCommitHash?: string;
}

/**
 * Test output evidence data.
 */
export interface TestOutputEvidenceData {
	/** Test suite name */
	testSuite?: string;
	/** Test name or identifier */
	testName?: string;
	/** Exit code of the test run */
	exitCode?: number;
	/** Number of passing tests */
	passed?: number;
	/** Number of failing tests */
	failed?: number;
	/** Number of skipped tests */
	skipped?: number;
	/** Raw stdout output */
	stdout?: string;
	/** Raw stderr output */
	stderr?: string;
	/** Duration in milliseconds */
	durationMs?: number;
}

/**
 * Error evidence data.
 */
export interface ErrorEvidenceData {
	/** Error type (e.g., "TypeError", "AssertionError") */
	errorType?: string;
	/** Error message */
	message: string;
	/** Stack trace */
	stackTrace?: string;
	/** Exit code */
	exitCode?: number;
	/** Error code (e.g., "EACCES", "ENOENT") */
	code?: string;
}

/**
 * Git diff evidence data.
 */
export interface GitDiffEvidenceData {
	/** Base ref (commit hash) */
	baseRef: string;
	/** Head ref (commit hash) */
	headRef: string;
	/** Raw diff output */
	diff: string;
	/** Files changed */
	filesChanged?: string[];
	/** Insertions count */
	insertions?: number;
	/** Deletions count */
	deletions?: number;
}

/**
 * Scheduling decision evidence data.
 */
export interface SchedulingEvidenceData {
	/** Workspace ID that was decided upon */
	workspaceId: string;
	/** Decision type */
	decision: "selected" | "skipped" | "blocked" | "idle";
	/** Skip reason if applicable */
	skipReason?: SkipReason;
	/** Batch ID if assigned */
	batchId?: number;
}

/**
 * Failure classification evidence data.
 */
export interface FailureClassificationEvidenceData {
	/** The failure category */
	category: FailureCategory;
	/** Confidence of classification */
	confidence: number;
	/** Whether this failure is recoverable */
	recoverable: boolean;
	/** Human-readable details */
	details?: string;
}

/**
 * Agent report evidence data.
 */
export interface AgentReportEvidenceData {
	/** Verdict from the agent */
	verdict: "COMPLETE" | "BLOCKED" | "FAILED";
	/** Full agent report text */
	report: string;
	/** Number of turns taken */
	turns?: number;
	/** Whether a diff was generated */
	diffGenerated?: boolean;
}

/**
 * Cooldown state evidence data.
 */
export interface CooldownEvidenceData {
	/** Whether cooldown is active */
	isActive: boolean;
	/** Reason for cooldown */
	reason: string;
	/** Cooldown expiration timestamp (ISO 8601) */
	expiresAt: string | null;
	/** Time remaining in milliseconds */
	remainingMs: number;
}

/**
 * Budget snapshot evidence data.
 */
export interface BudgetEvidenceData {
	/** Maximum input tokens */
	maxInputTokens: number;
	/** Estimated tokens consumed */
	estimatedTokens: number;
	/** Usage ratio (0-1) */
	usageRatio: number;
	/** Whether budget is exhausted */
	isExhausted: boolean;
	/** Number of attempts */
	attempts?: number;
	/** Maximum retries */
	maxRetries?: number;
}

/**
 * Line range in a file.
 */
export interface LineRange {
	/** Start line (1-indexed, inclusive) */
	start: number;
	/** End line (1-indexed, inclusive) */
	end: number;
}

/**
 * A single evidence entry backing a diagnostic.
 *
 * Every evidence entry must have at least a category, timestamp,
 * description, and source. Additional structured data is stored
 * in the typed data fields or the generic `data` record.
 */
export interface EvidenceEntry {
	/** Unique identifier (SHA-256 content hash of the evidence) */
	id: string;
	/** Evidence category */
	category: EvidenceCategory;
	/** ISO 8601 timestamp when the evidence was collected */
	timestamp: string;
	/** Human-readable description of this evidence */
	description: string;
	/** Source component that produced this evidence */
	source: string;
	/** Confidence level (0-1) */
	confidence: number;
	/** Content hash for deduplication */
	contentHash: string;
	/** Whether this is a placeholder (evidence gap) */
	isPlaceholder: boolean;
	/** File evidence data (if category === "file") */
	fileData?: FileEvidenceData;
	/** Test output evidence data (if category === "test_output") */
	testData?: TestOutputEvidenceData;
	/** Error evidence data (if category === "error_message") */
	errorData?: ErrorEvidenceData;
	/** Git diff evidence data (if category === "git_diff") */
	gitDiffData?: GitDiffEvidenceData;
	/** Scheduling evidence data (if category === "scheduling_decision") */
	schedulingData?: SchedulingEvidenceData;
	/** Failure classification evidence data (if category === "failure_classification") */
	failureData?: FailureClassificationEvidenceData;
	/** Agent report evidence data (if category === "agent_report") */
	agentReportData?: AgentReportEvidenceData;
	/** Cooldown evidence data (if category === "cooldown_state") */
	cooldownData?: CooldownEvidenceData;
	/** Budget evidence data (if category === "budget_snapshot") */
	budgetData?: BudgetEvidenceData;
	/** Generic structured data for extensibility */
	data: Record<string, unknown>;
}

/**
 * A group of related evidence entries that together support a single
 * diagnostic conclusion.
 */
export interface EvidenceGroup {
	/** Unique identifier (SHA-256 content hash of the group) */
	id: string;
	/** Human-readable label for this group */
	label: string;
	/** ISO 8601 timestamp when the group was created */
	timestamp: string;
	/** Evidence entries in this group */
	entries: EvidenceEntry[];
	/** Whether this group has sufficient evidence to support a conclusion */
	isComplete: boolean;
	/** Confidence that this group supports the diagnostic (0-1) */
	groupConfidence: number;
}

// ---------------------------------------------------------------------------
// Diagnostic Types
// ---------------------------------------------------------------------------

/**
 * Diagnostic severity levels.
 */
export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";

/**
 * All valid DiagnosticSeverity values for runtime validation.
 */
export const ALL_DIAGNOSTIC_SEVERITIES: DiagnosticSeverity[] = ["info", "warning", "error", "critical"];

/**
 * Type of diagnostic this packet represents.
 */
export type DiagnosticType =
	| "failure" // Execution failure
	| "skip" // Scheduling skip
	| "block" // Dependency block
	| "idle" // Scheduler idle
	| "resource_pressure" // Resource pressure
	| "budget_exceeded" // Budget limit exceeded
	| "policy_violation" // Policy engine violation
	| "cooldown_active" // Cooldown is active
	| "dedupe_suppression" // Suppressed as duplicate
	| "stop_condition_triggered" // Stop condition hit
	| "execution_complete" // Execution completed successfully
	| "execution_incomplete" // Execution completed but with issues
	| "observation"; // General observation

/**
 * All valid DiagnosticType values for runtime validation.
 */
export const ALL_DIAGNOSTIC_TYPES: DiagnosticType[] = [
	"failure",
	"skip",
	"block",
	"idle",
	"resource_pressure",
	"budget_exceeded",
	"policy_violation",
	"cooldown_active",
	"dedupe_suppression",
	"stop_condition_triggered",
	"execution_complete",
	"execution_incomplete",
	"observation",
];

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Budget constraints for a diagnostic packet.
 *
 * Prevents unbounded evidence accumulation by enforcing hard limits
 * on evidence entries, groups, and total serialized size.
 */
export interface PacketBudget {
	/** Maximum number of evidence entries per packet */
	maxEvidenceEntries: number;
	/** Current number of evidence entries in the packet */
	currentEvidenceCount: number;
	/** Maximum number of evidence groups per packet */
	maxEvidenceGroups: number;
	/** Current number of evidence groups in the packet */
	currentGroupCount: number;
	/** Maximum serialized size in bytes */
	maxPacketSizeBytes: number;
	/** Estimated serialized size in bytes */
	estimatedSizeBytes: number;
	/** Whether the budget has been exceeded */
	isOverBudget: boolean;
}

/**
 * Default budget constraints.
 */
export const DEFAULT_PACKET_BUDGET: Omit<PacketBudget, "currentEvidenceCount" | "currentGroupCount" | "estimatedSizeBytes" | "isOverBudget"> = {
	maxEvidenceEntries: 50,
	maxEvidenceGroups: 10,
	maxPacketSizeBytes: 1_000_000, // 1 MB
};

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

/**
 * Cooldown state for a diagnostic.
 *
 * Prevents the same diagnostic from being re-emitted within a
 * configurable time window.
 */
export interface CooldownState {
	/** Whether cooldown is currently active */
	isActive: boolean;
	/** ISO 8601 timestamp when cooldown expires, or null */
	cooldownUntil: string | null;
	/** Human-readable reason for cooldown */
	cooldownReason: string | null;
	/** Remaining cooldown time in milliseconds */
	remainingMs: number;
	/** Cooldown duration in milliseconds */
	durationMs: number;
	/** Number of times this diagnostic has been emitted */
	emitCount: number;
}

/**
 * Default cooldown duration in milliseconds (5 minutes).
 */
export const DEFAULT_COOLDOWN_DURATION_MS = 5 * 60 * 1000;

/**
 * Minimum cooldown duration (30 seconds).
 */
export const MIN_COOLDOWN_DURATION_MS = 30_000;

/**
 * Maximum cooldown duration (1 hour).
 */
export const MAX_COOLDOWN_DURATION_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplication identifier and state.
 *
 * Two diagnostics are considered duplicates if they share the same
 * dedupeId. The dedupeId should be derived from the diagnostic's
 * essential properties (category, workspace ID, failure details, etc.).
 */
export interface DedupeState {
	/** Deduplication identifier */
	dedupeId: string;
	/** Whether this packet was suppressed as a duplicate */
	isSuppressed: boolean;
	/** ISO 8601 timestamp of the original (first) occurrence */
	originalTimestamp: string | null;
	/** Number of times this dedupeId has been seen */
	occurrenceCount: number;
	/** ISO 8601 timestamp when this dedupe entry expires */
	expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Stop Conditions
// ---------------------------------------------------------------------------

/**
 * Stop condition that triggered for this diagnostic.
 *
 * Stop conditions are used by autonomous execution to determine
 * when to halt activity (e.g., night protocol, max duration exceeded).
 * Each diagnostic that triggers a stop condition records which condition
 * fired and when.
 */
export interface StopConditionState {
	/** Whether a stop condition was triggered */
	triggered: boolean;
	/** The stop condition that fired */
	condition: string;
	/** ISO 8601 timestamp when the condition triggered */
	triggeredAt: string | null;
	/** Human-readable detail about the condition */
	detail: string;
	/** Arbitrary metadata about the stop condition */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Diagnostic Packet
// ---------------------------------------------------------------------------

/**
 * A self-contained diagnostic packet.
 *
 * Carries structured, evidence-backed diagnostics through the execution
 * pipeline. Every packet must have at least one evidence group with at
 * least one evidence entry. If no evidence is available, a placeholder
 * entry must be created describing the gap.
 *
 * Key design properties:
 * - No silent errors: every diagnostic is backed by evidence
 * - Budget enforcement: bounded number of entries and groups
 * - Cooldown: prevents rapid re-emission of identical diagnostics
 * - Dedupe: content-based deduplication across the execution pipeline
 * - Stop condition: records when autonomous halts are triggered
 * - Evidence-chain: groups link related evidence for auditability
 */
export interface DiagnosticPacket {
	/** Unique identifier (UUID v4) */
	id: string;
	/** ISO 8601 timestamp of packet creation */
	timestamp: string;
	/** Content hash for integrity verification */
	packetHash: string;
	/** Diagnostic severity */
	severity: DiagnosticSeverity;
	/** Type of diagnostic */
	diagnosticType: DiagnosticType;
	/** Workspace ID this diagnostic relates to */
	workspaceId: string;
	/** Plan execution ID this diagnostic relates to (optional) */
	planExecutionId?: string;
	/** Human-readable title */
	title: string;
	/** Human-readable description */
	description: string;
	/** Evidence groups backing this diagnostic (must be non-empty) */
	evidence: EvidenceGroup[];
	/** Failure classification, if applicable */
	failureClassification?: FailureClassification;
	/** Scheduling diagnostics snapshot, if applicable */
	schedulingDiagnostics?: SchedulerDiagnostics;
	/** Budget state */
	budget: PacketBudget;
	/** Cooldown state */
	cooldown: CooldownState;
	/** Deduplication state */
	dedupe: DedupeState;
	/** Stop condition state */
	stopCondition: StopConditionState;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Factory: EvidenceEntry
// ---------------------------------------------------------------------------

/**
 * Input for creating an EvidenceEntry.
 */
export interface EvidenceEntryInput {
	category: EvidenceCategory;
	description: string;
	source: string;
	confidence?: number;
	isPlaceholder?: boolean;
	fileData?: FileEvidenceData;
	testData?: TestOutputEvidenceData;
	errorData?: ErrorEvidenceData;
	gitDiffData?: GitDiffEvidenceData;
	schedulingData?: SchedulingEvidenceData;
	failureData?: FailureClassificationEvidenceData;
	agentReportData?: AgentReportEvidenceData;
	cooldownData?: CooldownEvidenceData;
	budgetData?: BudgetEvidenceData;
	data?: Record<string, unknown>;
}

/**
 * Create an EvidenceEntry with defaults applied.
 *
 * Generates a content-hash-based ID for deduplication.
 * If no confidence is provided, defaults to 1.0 for concrete evidence
 * and 0.3 for placeholders.
 */
export function createEvidenceEntry(input: EvidenceEntryInput): EvidenceEntry {
	const timestamp = new Date().toISOString();
	const confidence = input.confidence ?? (input.isPlaceholder ? 0.3 : 1.0);

	// Build a content hash from the essential properties for deduplication
	const hashContent = JSON.stringify({
		category: input.category,
		description: input.description,
		source: input.source,
		fileData: input.fileData,
		errorData: input.errorData ? { message: input.errorData.message, errorType: input.errorData.errorType } : undefined,
		testData: input.testData ? { testSuite: input.testData.testSuite, testName: input.testData.testName } : undefined,
		schedulingData: input.schedulingData
			? { workspaceId: input.schedulingData.workspaceId, decision: input.schedulingData.decision }
			: undefined,
	});
	const contentHash = crypto.createHash("sha256").update(hashContent).digest("hex");
	const id = contentHash; // Use content hash as ID for natural deduplication

	return {
		id,
		category: input.category,
		timestamp,
		description: input.description,
		source: input.source,
		confidence,
		contentHash,
		isPlaceholder: input.isPlaceholder ?? false,
		fileData: input.fileData,
		testData: input.testData,
		errorData: input.errorData,
		gitDiffData: input.gitDiffData,
		schedulingData: input.schedulingData,
		failureData: input.failureData,
		agentReportData: input.agentReportData,
		cooldownData: input.cooldownData,
		budgetData: input.budgetData,
		data: input.data ?? {},
	};
}

/**
 * Create a placeholder evidence entry.
 *
 * Placeholders are used when diagnostic packets must be created
 * but no concrete evidence is available. This prevents silent errors
 * by explicitly documenting the evidence gap.
 */
export function createPlaceholderEvidenceEntry(
	description: string,
	source: string,
	gapReason: string,
): EvidenceEntry {
	return createEvidenceEntry({
		category: "placeholder",
		description,
		source,
		confidence: 0.3,
		isPlaceholder: true,
		data: { gapReason },
	});
}

// ---------------------------------------------------------------------------
// Factory: EvidenceGroup
// ---------------------------------------------------------------------------

/**
 * Create an EvidenceGroup from entries.
 */
export function createEvidenceGroup(label: string, entries: EvidenceEntry[]): EvidenceGroup {
	const timestamp = new Date().toISOString();

	// Compute group confidence as the average of entry confidences
	const groupConfidence =
		entries.length > 0
			? entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length
			: 0;

	// A group is complete if it has at least one non-placeholder entry
	const isComplete = entries.some((e) => !e.isPlaceholder);

	// Generate group ID from sorted entry content hashes
	const hashContent = entries
		.map((e) => e.contentHash)
		.sort()
		.join("::");
	const id = crypto.createHash("sha256").update(hashContent).digest("hex");

	return {
		id,
		label,
		timestamp,
		entries,
		isComplete,
		groupConfidence,
	};
}

/**
 * Merge two evidence groups with the same label by combining their
 * entries (deduplicating by content hash).
 */
export function mergeEvidenceGroups(a: EvidenceGroup, b: EvidenceGroup): EvidenceGroup {
	if (a.label !== b.label) {
		throw new Error(`Cannot merge groups with different labels: "${a.label}" vs "${b.label}"`);
	}

	const seen = new Set<string>();
	const merged: EvidenceEntry[] = [];

	for (const entry of [...a.entries, ...b.entries]) {
		if (!seen.has(entry.contentHash)) {
			seen.add(entry.contentHash);
			merged.push(entry);
		}
	}

	return createEvidenceGroup(a.label, merged);
}

// ---------------------------------------------------------------------------
// Factory: PacketBudget
// ---------------------------------------------------------------------------

/**
 * Create a PacketBudget from configuration, counting current entries and groups.
 */
export function createPacketBudget(
	config: Partial<PacketBudget> & { evidence: EvidenceGroup[] },
): PacketBudget {
	const currentEvidenceCount = config.evidence.reduce((sum, g) => sum + g.entries.length, 0);

	const budget: PacketBudget = {
		maxEvidenceEntries: config.maxEvidenceEntries ?? DEFAULT_PACKET_BUDGET.maxEvidenceEntries,
		currentEvidenceCount,
		maxEvidenceGroups: config.maxEvidenceGroups ?? DEFAULT_PACKET_BUDGET.maxEvidenceGroups,
		currentGroupCount: config.evidence.length,
		maxPacketSizeBytes: config.maxPacketSizeBytes ?? DEFAULT_PACKET_BUDGET.maxPacketSizeBytes,
		estimatedSizeBytes: 0,
		isOverBudget: false,
	};

	// Estimate size by serializing a minimal representation
	budget.estimatedSizeBytes = estimatePacketSize(config.evidence);
	budget.isOverBudget =
		budget.currentEvidenceCount > budget.maxEvidenceEntries ||
		budget.currentGroupCount > budget.maxEvidenceGroups ||
		budget.estimatedSizeBytes > budget.maxPacketSizeBytes;

	return budget;
}

// ---------------------------------------------------------------------------
// Factory: CooldownState
// ---------------------------------------------------------------------------

/**
 * Create a CooldownState.
 */
export function createCooldownState(
	overrides?: Partial<CooldownState>,
): CooldownState {
	const now = Date.now();
	const durationMs = overrides?.durationMs ?? DEFAULT_COOLDOWN_DURATION_MS;
	const emitCount = overrides?.emitCount ?? 0;

	if (overrides?.isActive && overrides?.cooldownUntil) {
		const remaining = Math.max(0, new Date(overrides.cooldownUntil).getTime() - now);
		return {
			isActive: true,
			cooldownUntil: overrides.cooldownUntil,
			cooldownReason: overrides.cooldownReason ?? "Cooldown active",
			remainingMs: remaining,
			durationMs,
			emitCount,
		};
	}

	// If isActive is requested but no cooldownUntil, auto-calculate it
	if (overrides?.isActive) {
		const cooldownUntil = new Date(now + (overrides.remainingMs ?? durationMs)).toISOString();
		return {
			isActive: true,
			cooldownUntil,
			cooldownReason: overrides.cooldownReason ?? "Cooldown active",
			remainingMs: overrides.remainingMs ?? durationMs,
			durationMs,
			emitCount,
		};
	}

	return {
		isActive: false,
		cooldownUntil: null,
		cooldownReason: null,
		remainingMs: 0,
		durationMs,
		emitCount,
	};
}

/**
 * Activate cooldown for a given state, setting the expiration time.
 */
export function activateCooldown(
	state: CooldownState,
	reason: string,
	now: number = Date.now(),
): CooldownState {
	const cooldownUntil = new Date(now + state.durationMs).toISOString();
	return {
		...state,
		isActive: true,
		cooldownUntil,
		cooldownReason: reason,
		remainingMs: state.durationMs,
		emitCount: state.emitCount + 1,
	};
}

/**
 * Check if a cooldown has expired and deactivate it if so.
 */
export function checkAndClearCooldown(
	state: CooldownState,
	now: number = Date.now(),
): CooldownState {
	if (!state.isActive || !state.cooldownUntil) {
		return state;
	}

	const expiryTime = new Date(state.cooldownUntil).getTime();
	if (now >= expiryTime) {
		return {
			...state,
			isActive: false,
			cooldownUntil: null,
			cooldownReason: null,
			remainingMs: 0,
		};
	}

	return {
		...state,
		remainingMs: Math.max(0, expiryTime - now),
	};
}

// ---------------------------------------------------------------------------
// Factory: DedupeState
// ---------------------------------------------------------------------------

/**
 * Create a DedupeState.
 */
export function createDedupeState(
	dedupeId: string,
	overrides?: Partial<DedupeState>,
): DedupeState {
	return {
		dedupeId,
		isSuppressed: overrides?.isSuppressed ?? false,
		originalTimestamp: overrides?.originalTimestamp ?? null,
		occurrenceCount: overrides?.occurrenceCount ?? 1,
		expiresAt: overrides?.expiresAt ?? null,
	};
}

// ---------------------------------------------------------------------------
// Factory: StopConditionState
// ---------------------------------------------------------------------------

/**
 * Create a StopConditionState.
 */
export function createStopConditionState(overrides?: Partial<StopConditionState>): StopConditionState {
	return {
		triggered: overrides?.triggered ?? false,
		condition: overrides?.condition ?? "",
		triggeredAt: overrides?.triggeredAt ?? null,
		detail: overrides?.detail ?? "",
		metadata: overrides?.metadata ?? {},
	};
}

// ---------------------------------------------------------------------------
// Factory: DiagnosticPacket
// ---------------------------------------------------------------------------

/**
 * Input for creating a DiagnosticPacket.
 */
export interface DiagnosticPacketInput {
	severity: DiagnosticSeverity;
	diagnosticType: DiagnosticType;
	workspaceId: string;
	title: string;
	description: string;
	evidence: EvidenceGroup[];
	planExecutionId?: string;
	failureClassification?: FailureClassification;
	schedulingDiagnostics?: SchedulerDiagnostics;
	cooldownDurationMs?: number;
	dedupeId?: string;
	stopCondition?: Partial<StopConditionState>;
	metadata?: Record<string, unknown>;
}

/**
 * Create a DiagnosticPacket from input.
 *
 * Enforces the "no silent errors" rule: if evidence is empty,
 * a placeholder group is automatically created.
 */
export function createDiagnosticPacket(input: DiagnosticPacketInput): DiagnosticPacket {
	const id = crypto.randomUUID();
	const timestamp = new Date().toISOString();

	// Ensure at least one evidence group exists (no silent errors)
	let evidence = input.evidence;
	if (evidence.length === 0) {
		evidence = [
			createEvidenceGroup("Missing Evidence", [
				createPlaceholderEvidenceEntry(
					`No evidence provided for diagnostic: ${input.title}`,
					"diagnostic-packet-factory",
					"No evidence groups were provided in the input. This diagnostic was created without supporting evidence, which violates the no-silent-errors rule.",
				),
			]),
		];
	}

	// Budget
	const budget = createPacketBudget({ evidence });

	// Cooldown
	const cooldown = createCooldownState({
		durationMs: input.cooldownDurationMs ?? DEFAULT_COOLDOWN_DURATION_MS,
	});

	// Dedupe
	const dedupeContent = JSON.stringify({
		diagnosticType: input.diagnosticType,
		workspaceId: input.workspaceId,
		title: input.title,
		failureCategory: input.failureClassification?.category,
	});
	const defaultDedupeId = crypto.createHash("sha256").update(dedupeContent).digest("hex");
	const dedupe = createDedupeState(input.dedupeId ?? defaultDedupeId);

	// Stop condition
	const stopCondition = createStopConditionState(input.stopCondition);

	// Packet hash (content integrity)
	const hashContent = JSON.stringify({
		id,
		timestamp,
		severity: input.severity,
		diagnosticType: input.diagnosticType,
		workspaceId: input.workspaceId,
		title: input.title,
		description: input.description,
		evidenceCount: evidence.reduce((sum, g) => sum + g.entries.length, 0),
		groupCount: evidence.length,
		budget,
		dedupeId: defaultDedupeId,
	});
	const packetHash = crypto.createHash("sha256").update(hashContent).digest("hex");

	return {
		id,
		timestamp,
		packetHash,
		severity: input.severity,
		diagnosticType: input.diagnosticType,
		workspaceId: input.workspaceId,
		planExecutionId: input.planExecutionId,
		title: input.title,
		description: input.description,
		evidence,
		failureClassification: input.failureClassification,
		schedulingDiagnostics: input.schedulingDiagnostics,
		budget,
		cooldown,
		dedupe,
		stopCondition,
		metadata: input.metadata ?? {},
	};
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Result of a diagnostic packet validation.
 */
export interface PacketValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Validate a DiagnosticPacket for structural correctness.
 */
export function validateDiagnosticPacket(packet: unknown): PacketValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!packet || typeof packet !== "object") {
		return { valid: false, errors: ["Packet must be a non-null object"], warnings: [] };
	}

	const p = packet as Record<string, unknown>;

	// Required fields
	if (typeof p.id !== "string" || p.id.length === 0) errors.push("id must be a non-empty string");
	if (typeof p.timestamp !== "string" || p.timestamp.length === 0) errors.push("timestamp must be a non-empty string");
	if (typeof p.packetHash !== "string" || p.packetHash.length === 0) errors.push("packetHash must be a non-empty string");
	if (!ALL_DIAGNOSTIC_SEVERITIES.includes(p.severity as DiagnosticSeverity)) {
		errors.push(`severity must be one of: ${ALL_DIAGNOSTIC_SEVERITIES.join(", ")}`);
	}
	if (!ALL_DIAGNOSTIC_TYPES.includes(p.diagnosticType as DiagnosticType)) {
		errors.push(`diagnosticType must be one of: ${ALL_DIAGNOSTIC_TYPES.join(", ")}`);
	}
	if (typeof p.workspaceId !== "string" || p.workspaceId.length === 0) errors.push("workspaceId must be a non-empty string");
	if (typeof p.title !== "string" || p.title.length === 0) errors.push("title must be a non-empty string");

	// Evidence checks
	if (!Array.isArray(p.evidence)) {
		errors.push("evidence must be an array");
	} else if (p.evidence.length === 0) {
		warnings.push("evidence array is empty — no silent errors rule may be violated");
	} else {
		for (let i = 0; i < p.evidence.length; i++) {
			const group = p.evidence[i] as Record<string, unknown>;
			if (typeof group.label !== "string") errors.push(`evidence[${i}].label must be a string`);
			if (!Array.isArray(group.entries)) {
				errors.push(`evidence[${i}].entries must be an array`);
			} else if (group.entries.length === 0) {
				warnings.push(`evidence[${i}] has no entries`);
			} else {
				for (let j = 0; j < (group.entries as unknown[]).length; j++) {
					const entry = (group.entries as Record<string, unknown>[])[j];
					if (!ALL_EVIDENCE_CATEGORIES.includes(entry.category as EvidenceCategory)) {
						errors.push(`evidence[${i}].entries[${j}].category must be one of: ${ALL_EVIDENCE_CATEGORIES.join(", ")}`);
					}
					if (typeof entry.description !== "string" || entry.description.length === 0) {
						errors.push(`evidence[${i}].entries[${j}].description must be a non-empty string`);
					}
					if (typeof entry.source !== "string" || entry.source.length === 0) {
						errors.push(`evidence[${i}].entries[${j}].source must be a non-empty string`);
					}
				}
			}
		}
	}

	// Budget check
	if (p.budget && typeof p.budget === "object") {
		const b = p.budget as Record<string, unknown>;
		if (typeof b.isOverBudget === "boolean" && b.isOverBudget === true) {
			warnings.push("packet is over budget and may need compaction");
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Budget helpers
// ---------------------------------------------------------------------------

/**
 * Estimate the serialized size of evidence in bytes.
 */
function estimatePacketSize(evidence: EvidenceGroup[]): number {
	let size = 0;
	for (const group of evidence) {
		size += group.label.length * 2; // rough UTF-8 estimate
		for (const entry of group.entries) {
			size += entry.description.length * 2;
			size += entry.source.length * 2;
			size += 200; // overhead per entry
		}
		size += 100; // overhead per group
	}
	return size;
}

/**
 * Check whether a packet is within its budget constraints.
 */
export function isPacketWithinBudget(packet: DiagnosticPacket): boolean {
	return !packet.budget.isOverBudget;
}

/**
 * Compress a diagnostic packet by trimming evidence to fit within budget.
 *
 * Strategy (in order):
 * 1. Remove placeholder entries first (lowest value)
 * 2. Merge small groups where possible
 * 3. Truncate long descriptions
 */
export function compactDiagnosticPacket(packet: DiagnosticPacket): DiagnosticPacket {
	if (isPacketWithinBudget(packet)) {
		return packet;
	}

	const compacted = { ...packet, evidence: [...packet.evidence] };
	const targetMaxEntries = packet.budget.maxEvidenceEntries;
	const targetMaxGroups = packet.budget.maxEvidenceGroups;
	const targetMaxSizeBytes = packet.budget.maxPacketSizeBytes;

	// Phase 1: Remove placeholder entries from groups (but keep at least one entry per group)
	for (let i = 0; i < compacted.evidence.length; i++) {
		const group = compacted.evidence[i];
		const nonPlaceholders = group.entries.filter((e) => !e.isPlaceholder);
		if (nonPlaceholders.length > 0) {
			compacted.evidence[i] = { ...group, entries: nonPlaceholders };
		}
	}

	// Phase 2: Recalculate budget
	compacted.budget = createPacketBudget({
		evidence: compacted.evidence,
		maxEvidenceEntries: targetMaxEntries,
		maxEvidenceGroups: targetMaxGroups,
		maxPacketSizeBytes: targetMaxSizeBytes,
	});

	if (isPacketWithinBudget(compacted)) {
		return compacted;
	}

	// Phase 3: Remove excess groups (keep the most confident ones)
	// Use the packet's own budget limits instead of defaults
	while (
		compacted.evidence.length > targetMaxGroups ||
		compacted.evidence.reduce((sum, g) => sum + g.entries.length, 0) > targetMaxEntries
	) {
		// Sort by group confidence ascending, remove least confident
		compacted.evidence.sort((a, b) => a.groupConfidence - b.groupConfidence);
		compacted.evidence.shift();
	}

	compacted.budget = createPacketBudget({
		evidence: compacted.evidence,
		maxEvidenceEntries: targetMaxEntries,
		maxEvidenceGroups: targetMaxGroups,
		maxPacketSizeBytes: targetMaxSizeBytes,
	});

	if (isPacketWithinBudget(compacted)) {
		return compacted;
	}

	// Phase 4: Truncate descriptions to reduce size
	for (const group of compacted.evidence) {
		for (const entry of group.entries) {
			if (entry.description.length > 500) {
				entry.description = entry.description.slice(0, 497) + "...";
			}
		}
	}

	compacted.budget = createPacketBudget({
		evidence: compacted.evidence,
		maxEvidenceEntries: targetMaxEntries,
		maxEvidenceGroups: targetMaxGroups,
		maxPacketSizeBytes: targetMaxSizeBytes,
	});

	return compacted;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a DiagnosticPacket to JSON.
 */
export function serializeDiagnosticPacket(packet: DiagnosticPacket): string {
	return JSON.stringify(packet, null, 2);
}

/**
 * Deserialize a DiagnosticPacket from JSON with validation.
 */
export function deserializeDiagnosticPacket(json: string): DiagnosticPacket {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse DiagnosticPacket JSON: ${(e as Error).message}`);
	}

	const result = validateDiagnosticPacket(parsed);
	if (!result.valid) {
		throw new Error(`Invalid DiagnosticPacket: ${result.errors.join("; ")}`);
	}

	return parsed as DiagnosticPacket;
}

/**
 * Verify a packet's integrity by recomputing its hash.
 */
export function verifyPacketIntegrity(packet: DiagnosticPacket): boolean {
	const hashContent = JSON.stringify({
		id: packet.id,
		timestamp: packet.timestamp,
		severity: packet.severity,
		diagnosticType: packet.diagnosticType,
		workspaceId: packet.workspaceId,
		title: packet.title,
		description: packet.description,
		evidenceCount: packet.evidence.reduce((sum, g) => sum + g.entries.length, 0),
		groupCount: packet.evidence.length,
		budget: packet.budget,
		dedupeId: packet.dedupe.dedupeId,
	});
	const computedHash = crypto.createHash("sha256").update(hashContent).digest("hex");
	return computedHash === packet.packetHash;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Format a DiagnosticPacket for human-readable display.
 */
export function formatDiagnosticPacket(packet: DiagnosticPacket): string {
	const lines: string[] = [];
	const budgetStatus = packet.budget.isOverBudget ? "OVER BUDGET" : "OK";
	const cooldownStatus = packet.cooldown.isActive ? `ACTIVE (${Math.round(packet.cooldown.remainingMs / 1000)}s remaining)` : "inactive";
	const dedupeStatus = packet.dedupe.isSuppressed ? "SUPPRESSED" : "active";
	const stopStatus = packet.stopCondition.triggered ? `TRIGGERED: ${packet.stopCondition.condition}` : "none";

	lines.push("=".repeat(60));
	lines.push(`DIAGNOSTIC PACKET: ${packet.title}`);
	lines.push("=".repeat(60));
	lines.push(`ID: ${packet.id.slice(0, 12)}...`);
	lines.push(`Timestamp: ${packet.timestamp}`);
	lines.push(`Workspace: ${packet.workspaceId}${packet.planExecutionId ? ` [Plan: ${packet.planExecutionId}]` : ""}`);
	lines.push(`Severity: ${packet.severity.toUpperCase()} / Type: ${packet.diagnosticType}`);
	lines.push(`Description: ${packet.description}`);
	lines.push("");
	lines.push("--- Budget ---");
	lines.push(`  Evidence: ${packet.budget.currentEvidenceCount}/${packet.budget.maxEvidenceEntries}`);
	lines.push(`  Groups: ${packet.budget.currentGroupCount}/${packet.budget.maxEvidenceGroups}`);
	lines.push(`  Size: ${(packet.budget.estimatedSizeBytes / 1024).toFixed(1)} KB / ${(packet.budget.maxPacketSizeBytes / 1024).toFixed(1)} KB`);
	lines.push(`  Status: ${budgetStatus}`);
	lines.push("");
	lines.push("--- State ---");
	lines.push(`  Cooldown: ${cooldownStatus}`);
	lines.push(`  Dedupe: ${dedupeStatus} (seen ${packet.dedupe.occurrenceCount}x)`);
	lines.push(`  Stop Condition: ${stopStatus}`);
	lines.push("");

	if (packet.failureClassification) {
		lines.push(`--- Failure Classification ---`);
		lines.push(`  Category: ${packet.failureClassification.category}`);
		lines.push(`  Confidence: ${Math.round(packet.failureClassification.confidence * 100)}%`);
		lines.push(`  Recoverable: ${packet.failureClassification.recoverable ? "yes" : "no"}`);
		lines.push("");
	}

	lines.push(`--- Evidence (${packet.evidence.length} groups) ---`);
	for (const group of packet.evidence) {
		lines.push(`  [${group.isComplete ? "OK" : "INCOMPLETE"}] ${group.label} (confidence: ${Math.round(group.groupConfidence * 100)}%)`);
		for (const entry of group.entries) {
			const placeholder = entry.isPlaceholder ? " [PLACEHOLDER]" : "";
			lines.push(`    - [${entry.category}] ${entry.description}${placeholder}`);
		}
	}

	lines.push("=".repeat(60));
	return lines.join("\n");
}
