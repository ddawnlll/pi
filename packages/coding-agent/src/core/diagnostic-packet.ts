/**
 * Diagnostic Packet and Evidence Model - Workspace 25.E
 *
 * Defines a structured diagnostic packet format that carries evidence-backed
 * diagnostics with built-in budget enforcement, cooldown, deduplication,
 * and stop-condition tracking for autonomous workspace execution.
 *
 * ## Design Principles
 *
 * - No silent errors: every packet carries at least placeholder evidence
 * - Budget limits prevent unbounded evidence accumulation
 * - Cooldown prevents rapid re-emission of duplicate diagnostics
 * - Deduplication via content hashing identifies identical evidence
 * - Stop conditions are tracked explicitly in each packet
 * - Packet integrity is verified via content hashing
 * - Serialization round-trips preserve all fields
 */

import { createHash, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Evidence category for classifying the type of evidence data carried.
 */
export type EvidenceCategory =
	| "file"
	| "test_output"
	| "log_output"
	| "git_diff"
	| "git_log"
	| "error_message"
	| "scheduling_decision"
	| "failure_classification"
	| "agent_report"
	| "system_state"
	| "budget_snapshot"
	| "policy_evaluation"
	| "cooldown_state"
	| "placeholder";

/**
 * Packet severity level.
 */
export type PacketSeverity = "info" | "warning" | "error" | "critical";

/**
 * Diagnostic type categorizing the nature of the diagnostic.
 */
export type DiagnosticType =
	| "failure"
	| "block"
	| "observation"
	| "execution_complete"
	| "resource_pressure"
	| "stop_condition_triggered"
	| "budget_exceeded"
	| "cooldown_active";

/**
 * Agent verdict matching the workspace output contract.
 */
export type AgentVerdict = "COMPLETE" | "BLOCKED" | "FAILED";

// ---------------------------------------------------------------------------
// Evidence entry data structures (category-specific payloads)
// ---------------------------------------------------------------------------

export interface FileData {
	filePath: string;
	content?: string;
	lineRange?: { start: number; end: number };
}

export interface TestData {
	testSuite: string;
	testName?: string;
	exitCode?: number;
	passed?: number;
	failed?: number;
	skipped?: number;
	stdout?: string;
}

export interface ErrorData {
	message: string;
	errorType?: string;
	stackTrace?: string;
	exitCode?: number;
}

export interface SkipReason {
	workspaceId: string;
	category: string;
	reason: string;
	missingDependencyIds?: string[];
}

export interface SchedulingData {
	workspaceId?: string;
	decision: string;
	skipReason?: SkipReason;
}

export interface FailureData {
	category: string;
	confidence: number;
	recoverable: boolean;
	details?: string;
}

export interface AgentReportData {
	verdict: AgentVerdict;
	report: string;
	turns?: number;
	diffGenerated?: boolean;
}

export interface CooldownData {
	isActive: boolean;
	reason?: string;
	expiresAt?: string;
	remainingMs: number;
}

/**
 * Cooldown state tracking for diagnostic packet re-emission prevention.
 */
export interface CooldownState {
	isActive: boolean;
	cooldownUntil: string | null;
	cooldownReason: string | null;
	remainingMs: number;
	durationMs: number;
	emitCount: number;
}

/**
 * Deduplication state tracking for suppressing duplicate diagnostics.
 */
export interface DedupeState {
	dedupeId: string;
	isSuppressed: boolean;
	occurrenceCount: number;
}

/**
 * Stop condition state tracking for execution halts.
 */
export interface StopConditionState {
	triggered: boolean;
	condition: string;
	detail?: string;
	triggeredAt: string | null;
	metadata: Record<string, unknown>;
}

/**
 * Budget tracking for evidence accumulation limits.
 */
export interface PacketBudget {
	maxEvidenceEntries: number;
	maxEvidenceGroups: number;
	currentEvidenceCount: number;
	currentGroupCount: number;
	isOverBudget: boolean;
}

/**
 * Validation result for packet validation.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

// ---------------------------------------------------------------------------
// Evidence entry - the atomic unit of evidence
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence with category-specific structured data.
 *
 * Each entry has a content hash for deduplication and can be flagged
 * as a placeholder when real evidence is unavailable (no silent errors).
 */
export interface EvidenceEntry {
	/** Unique identifier derived from content hash */
	id: string;
	/** SHA-256 content hash for deduplication */
	contentHash: string;
	/** Evidence category (determines which data field carries the payload) */
	category: EvidenceCategory;
	/** Human-readable description */
	description: string;
	/** Source component (e.g., "test-runner", "scheduler", "executor") */
	source: string;
	/** Confidence score (0.0 to 1.0), defaults to 0.8 */
	confidence: number;
	/** Whether this entry is a placeholder (real evidence unavailable) */
	isPlaceholder: boolean;
	/** Generic data payload (for categories without specific data types) */
	data: Record<string, unknown>;
	/** File evidence data */
	fileData?: FileData;
	/** Test output evidence data */
	testData?: TestData;
	/** Error evidence data */
	errorData?: ErrorData;
	/** Scheduling decision evidence data */
	schedulingData?: SchedulingData;
	/** Failure classification evidence data */
	failureData?: FailureData;
	/** Agent report evidence data */
	agentReportData?: AgentReportData;
	/** Cooldown state evidence data */
	cooldownData?: CooldownData;
}

/**
 * A labeled group of related evidence entries.
 */
export interface EvidenceGroup {
	/** Display label for the group */
	label: string;
	/** Evidence entries in this group */
	entries: EvidenceEntry[];
	/** Average confidence of all entries */
	groupConfidence: number;
	/** Whether all entries are non-placeholder (complete) */
	isComplete: boolean;
}

/**
 * A diagnostic packet carrying evidence-backed diagnostics.
 *
 * Every packet includes:
 * - Unique ID and timestamp
 * - Packet hash for integrity verification
 * - Severity and diagnostic type classification
 * - Evidence groups with category-specific structured data
 * - Budget tracking for evidence accumulation limits
 * - Cooldown state preventing rapid re-emission
 * - Dedupe state for identifying duplicate diagnostics
 * - Stop condition tracking for execution halts
 */
export interface DiagnosticPacket {
	/** Unique packet identifier */
	id: string;
	/** ISO timestamp of packet creation */
	timestamp: string;
	/** SHA-256 hash of packet content for integrity verification */
	packetHash: string;
	/** Severity level */
	severity: PacketSeverity;
	/** Diagnostic type classification */
	diagnosticType: DiagnosticType;
	/** Workspace identifier this diagnostic pertains to */
	workspaceId: string;
	/** Short title */
	title: string;
	/** Detailed description */
	description: string;
	/** Evidence groups backing this diagnostic */
	evidence: EvidenceGroup[];
	/** Budget tracking for evidence accumulation */
	budget: PacketBudget;
	/** Cooldown state preventing rapid re-emission */
	cooldown: CooldownState;
	/** Deduplication state */
	dedupe: DedupeState;
	/** Stop condition tracking */
	stopCondition: StopConditionState;
	/** Optional failure classification result */
	failureClassification?: FailureData;
	/** Optional plan execution identifier */
	planExecutionId?: string;
	/** Custom cooldown duration in milliseconds */
	cooldownDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Defaults and constants
// ---------------------------------------------------------------------------

/** Default cooldown duration in milliseconds (5 seconds). */
export const DEFAULT_COOLDOWN_DURATION_MS = 5_000;

/** Default budget limits. */
const DEFAULT_MAX_EVIDENCE_ENTRIES = 50;
const DEFAULT_MAX_EVIDENCE_GROUPS = 10;

/** Default confidence for regular evidence entries. */
const DEFAULT_CONFIDENCE = 0.8;

/** Confidence for placeholder evidence entries. */
const PLACEHOLDER_CONFIDENCE = 0.3;

// ---------------------------------------------------------------------------
// Hashing utilities
// ---------------------------------------------------------------------------

/**
 * Generate a stable JSON representation of an object with sorted keys
 * for deterministic hashing.
 */
function stableStringify(obj: Record<string, unknown>): string {
	return JSON.stringify(obj, stableSortReplacer);
}

/**
 * JSON.stringify replacer that recursively sorts object keys.
 */
function stableSortReplacer(_key: string, value: unknown): unknown {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const keys = Object.keys(value).sort();
		const sorted: Record<string, unknown> = {};
		for (const k of keys) {
			sorted[k] = (value as Record<string, unknown>)[k];
		}
		return sorted;
	}
	return value;
}

/**
 * Compute a SHA-256 hex hash of the given data.
 */
function sha256(data: string): string {
	return createHash("sha256").update(data, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Evidence entry creation
// ---------------------------------------------------------------------------

export interface CreateEvidenceEntryOptions {
	category: EvidenceCategory;
	description: string;
	source: string;
	confidence?: number;
	isPlaceholder?: boolean;
	data?: Record<string, unknown>;
	fileData?: FileData;
	testData?: TestData;
	errorData?: ErrorData;
	schedulingData?: SchedulingData;
	failureData?: FailureData;
	agentReportData?: AgentReportData;
	cooldownData?: CooldownData;
}

/**
 * Compute the content hash for an evidence entry from its category,
 * description, source, and data fields.
 */
function computeEvidenceContentHash(options: CreateEvidenceEntryOptions): string {
	const hashInput: Record<string, unknown> = {
		category: options.category,
		description: options.description,
		source: options.source,
	};
	if (options.fileData) hashInput.fileData = options.fileData;
	if (options.testData) hashInput.testData = options.testData;
	if (options.errorData) hashInput.errorData = options.errorData;
	if (options.schedulingData) hashInput.schedulingData = options.schedulingData;
	if (options.failureData) hashInput.failureData = options.failureData;
	if (options.agentReportData) hashInput.agentReportData = options.agentReportData;
	if (options.cooldownData) hashInput.cooldownData = options.cooldownData;
	if (options.data) hashInput.data = options.data;
	return sha256(stableStringify(hashInput));
}

/**
 * Create an evidence entry with the given options.
 *
 * The entry's ID and contentHash are derived from its content for
 * deterministic deduplication.
 *
 * @param options - Entry creation options
 * @returns A new EvidenceEntry
 */
export function createEvidenceEntry(options: CreateEvidenceEntryOptions): EvidenceEntry {
	const contentHash = computeEvidenceContentHash(options);
	const id = contentHash;
	return {
		id,
		contentHash,
		category: options.category,
		description: options.description,
		source: options.source,
		confidence: options.confidence ?? DEFAULT_CONFIDENCE,
		isPlaceholder: options.isPlaceholder ?? false,
		data: options.data ?? {},
		...(options.fileData !== undefined ? { fileData: options.fileData } : {}),
		...(options.testData !== undefined ? { testData: options.testData } : {}),
		...(options.errorData !== undefined ? { errorData: options.errorData } : {}),
		...(options.schedulingData !== undefined ? { schedulingData: options.schedulingData } : {}),
		...(options.failureData !== undefined ? { failureData: options.failureData } : {}),
		...(options.agentReportData !== undefined ? { agentReportData: options.agentReportData } : {}),
		...(options.cooldownData !== undefined ? { cooldownData: options.cooldownData } : {}),
	};
}

/**
 * Create a placeholder evidence entry indicating that real evidence
 * was unavailable (no silent errors guarantee).
 *
 * @param description - Description of what evidence is missing
 * @param source - Source component
 * @param gapReason - Explanation of why evidence is absent
 * @returns A placeholder EvidenceEntry
 */
export function createPlaceholderEvidenceEntry(description: string, source: string, gapReason: string): EvidenceEntry {
	return createEvidenceEntry({
		category: "placeholder",
		description,
		source,
		confidence: PLACEHOLDER_CONFIDENCE,
		isPlaceholder: true,
		data: { gapReason },
	});
}

// ---------------------------------------------------------------------------
// Evidence group creation
// ---------------------------------------------------------------------------

/**
 * Compute the group confidence as the average of entry confidences.
 */
function computeGroupConfidence(entries: EvidenceEntry[]): number {
	if (entries.length === 0) return 0;
	const sum = entries.reduce((acc, e) => acc + e.confidence, 0);
	return sum / entries.length;
}

/**
 * Determine if the group is complete (no placeholder entries).
 */
function computeGroupIsComplete(entries: EvidenceEntry[]): boolean {
	return entries.every((e) => !e.isPlaceholder);
}

/**
 * Create an evidence group with the given label and entries.
 *
 * Automatically computes group confidence and completeness.
 *
 * @param label - Display label for the group
 * @param entries - Evidence entries
 * @returns A new EvidenceGroup
 */
export function createEvidenceGroup(label: string, entries: EvidenceEntry[]): EvidenceGroup {
	return {
		label,
		entries,
		groupConfidence: computeGroupConfidence(entries),
		isComplete: computeGroupIsComplete(entries),
	};
}

/**
 * Merge two evidence groups with the same label.
 *
 * Deduplicates entries by their content hash. Throws if labels differ.
 *
 * @param a - First evidence group
 * @param b - Second evidence group
 * @returns A new merged EvidenceGroup
 */
export function mergeEvidenceGroups(a: EvidenceGroup, b: EvidenceGroup): EvidenceGroup {
	if (a.label !== b.label) {
		throw new Error("Cannot merge evidence groups with different labels");
	}

	const seen = new Set<string>();
	const mergedEntries: EvidenceEntry[] = [];

	for (const entry of [...a.entries, ...b.entries]) {
		if (!seen.has(entry.contentHash)) {
			seen.add(entry.contentHash);
			mergedEntries.push(entry);
		}
	}

	return createEvidenceGroup(a.label, mergedEntries);
}

// ---------------------------------------------------------------------------
// Packet budget
// ---------------------------------------------------------------------------

export interface CreatePacketBudgetOptions {
	evidence: EvidenceGroup[];
	maxEvidenceEntries?: number;
	maxEvidenceGroups?: number;
}

/**
 * Create packet budget state from evidence and optional limits.
 *
 * Computes current counts and over-budget status.
 *
 * @param options - Budget creation options
 * @returns A new PacketBudget
 */
export function createPacketBudget(options: CreatePacketBudgetOptions): PacketBudget {
	const maxEvidenceEntries = options.maxEvidenceEntries ?? DEFAULT_MAX_EVIDENCE_ENTRIES;
	const maxEvidenceGroups = options.maxEvidenceGroups ?? DEFAULT_MAX_EVIDENCE_GROUPS;
	const currentEvidenceCount = options.evidence.reduce((acc, g) => acc + g.entries.length, 0);
	const currentGroupCount = options.evidence.length;
	const isOverBudget = currentEvidenceCount > maxEvidenceEntries || currentGroupCount > maxEvidenceGroups;

	return {
		maxEvidenceEntries,
		maxEvidenceGroups,
		currentEvidenceCount,
		currentGroupCount,
		isOverBudget,
	};
}

/**
 * Check whether a packet is within its budget limits.
 *
 * @param packet - The diagnostic packet
 * @returns True if within budget
 */
export function isPacketWithinBudget(packet: DiagnosticPacket): boolean {
	return !packet.budget.isOverBudget;
}

/**
 * Compact a diagnostic packet to fit within its budget.
 *
 * Compaction strategy:
 * 1. Remove placeholder entries first
 * 2. If still over budget by entries, remove excess groups (least confident last)
 *
 * Returns the same packet reference if already within budget.
 *
 * @param packet - The diagnostic packet to compact
 * @returns The compacted packet (may be the same reference)
 */
export function compactDiagnosticPacket(packet: DiagnosticPacket): DiagnosticPacket {
	if (!packet.budget.isOverBudget) {
		return packet;
	}

	const maxEntries = packet.budget.maxEvidenceEntries;
	const maxGroups = packet.budget.maxEvidenceGroups;

	// Strategy 1: Remove placeholder entries from all groups
	const compactedGroups: EvidenceGroup[] = [];
	for (const group of packet.evidence) {
		const nonPlaceholder = group.entries.filter((e) => !e.isPlaceholder);
		compactedGroups.push(createEvidenceGroup(group.label, nonPlaceholder));
	}

	// Recalculate counts after placeholder removal
	let totalEntries = compactedGroups.reduce((acc, g) => acc + g.entries.length, 0);
	let totalGroups = compactedGroups.length;

	// Strategy 2: If still over max entries, trim groups (keep highest confidence)
	if (totalEntries > maxEntries) {
		// Sort groups by average confidence descending, keep best ones
		const sortedGroups = [...compactedGroups].sort((a, b) => b.groupConfidence - a.groupConfidence);

		const trimmedGroups: EvidenceGroup[] = [];
		let entryCount = 0;

		for (const group of sortedGroups) {
			if (entryCount + group.entries.length <= maxEntries) {
				trimmedGroups.push(group);
				entryCount += group.entries.length;
			} else {
				// Partially include the group up to the limit
				const remaining = maxEntries - entryCount;
				if (remaining > 0) {
					const partialEntries = group.entries.slice(0, remaining);
					trimmedGroups.push(createEvidenceGroup(group.label, partialEntries));
					entryCount += remaining;
				}
				break;
			}
		}

		compactedGroups.length = 0;
		compactedGroups.push(...trimmedGroups);
		totalEntries = entryCount;
		totalGroups = compactedGroups.length;
	}

	// Strategy 3: If still over max groups, trim groups
	if (totalGroups > maxGroups) {
		const sortedGroups = [...compactedGroups].sort((a, b) => b.groupConfidence - a.groupConfidence);
		compactedGroups.length = 0;
		compactedGroups.push(...sortedGroups.slice(0, maxGroups));
		totalGroups = compactedGroups.length;
	}

	// Recalculate
	const isOverBudget = totalEntries > maxEntries || totalGroups > maxGroups;

	packet.evidence = compactedGroups;
	packet.budget.currentEvidenceCount = totalEntries;
	packet.budget.currentGroupCount = totalGroups;
	packet.budget.isOverBudget = isOverBudget;

	return packet;
}

// ---------------------------------------------------------------------------
// Cooldown state
// ---------------------------------------------------------------------------

export interface CreateCooldownStateOptions {
	isActive?: boolean;
	cooldownUntil?: string | null;
	cooldownReason?: string | null;
	remainingMs?: number;
	durationMs?: number;
	emitCount?: number;
}

/**
 * Create a cooldown state, defaulting to inactive.
 *
 * @param options - Optional cooldown state overrides
 * @returns A new CooldownState
 */
export function createCooldownState(options: CreateCooldownStateOptions = {}): CooldownState {
	return {
		isActive: options.isActive ?? false,
		cooldownUntil: options.cooldownUntil ?? null,
		cooldownReason: options.cooldownReason ?? null,
		remainingMs: options.remainingMs ?? 0,
		durationMs: options.durationMs ?? DEFAULT_COOLDOWN_DURATION_MS,
		emitCount: options.emitCount ?? 0,
	};
}

/**
 * Activate cooldown with the given reason.
 *
 * Sets the cooldown duration and increments the emit count.
 *
 * @param state - Current cooldown state
 * @param reason - Reason for cooldown activation
 * @returns A new CooldownState with cooldown activated
 */
export function activateCooldown(state: CooldownState, reason: string): CooldownState {
	const cooldownUntil = new Date(Date.now() + state.durationMs).toISOString();
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
 * Check if cooldown has expired and clear it if so.
 *
 * Returns the same reference if cooldown is already inactive.
 *
 * @param state - Current cooldown state
 * @returns Updated CooldownState (may be same reference if inactive)
 */
export function checkAndClearCooldown(state: CooldownState): CooldownState {
	if (!state.isActive) {
		return state;
	}

	if (!state.cooldownUntil) {
		return state;
	}

	const now = Date.now();
	const expiryTime = new Date(state.cooldownUntil).getTime();
	const remainingMs = Math.max(0, expiryTime - now);

	if (remainingMs <= 0) {
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
		remainingMs,
	};
}

// ---------------------------------------------------------------------------
// Deduplication state
// ---------------------------------------------------------------------------

export interface CreateDedupeStateOptions {
	isSuppressed?: boolean;
	occurrenceCount?: number;
}

/**
 * Create a deduplication state for the given dedupe ID.
 *
 * @param dedupeId - Unique identifier for deduplication
 * @param options - Optional overrides
 * @returns A new DedupeState
 */
export function createDedupeState(dedupeId: string, options: CreateDedupeStateOptions = {}): DedupeState {
	return {
		dedupeId,
		isSuppressed: options.isSuppressed ?? false,
		occurrenceCount: options.occurrenceCount ?? 1,
	};
}

// ---------------------------------------------------------------------------
// Stop condition state
// ---------------------------------------------------------------------------

export interface CreateStopConditionStateOptions {
	triggered?: boolean;
	condition?: string;
	detail?: string;
	triggeredAt?: string | null;
	metadata?: Record<string, unknown>;
}

/**
 * Create a stop condition state, defaulting to inactive.
 *
 * @param options - Optional stop condition overrides
 * @returns A new StopConditionState
 */
export function createStopConditionState(options: CreateStopConditionStateOptions = {}): StopConditionState {
	return {
		triggered: options.triggered ?? false,
		condition: options.condition ?? "",
		detail: options.detail,
		triggeredAt: options.triggeredAt ?? null,
		metadata: options.metadata ?? {},
	};
}

// ---------------------------------------------------------------------------
// Packet hash computation
// ---------------------------------------------------------------------------

/**
 * Compute the packet hash from the packet's content fields (excluding
 * the packetHash itself for integrity verification).
 */
function computePacketHash(packet: Omit<DiagnosticPacket, "packetHash">): string {
	const hashInput: Record<string, unknown> = {
		id: packet.id,
		timestamp: packet.timestamp,
		severity: packet.severity,
		diagnosticType: packet.diagnosticType,
		workspaceId: packet.workspaceId,
		title: packet.title,
		description: packet.description,
		evidence: packet.evidence.map((g) => ({
			label: g.label,
			entries: g.entries.map((e) => ({
				id: e.id,
				contentHash: e.contentHash,
				category: e.category,
				description: e.description,
				source: e.source,
				confidence: e.confidence,
				isPlaceholder: e.isPlaceholder,
				data: e.data,
				fileData: e.fileData,
				testData: e.testData,
				errorData: e.errorData,
				schedulingData: e.schedulingData,
				failureData: e.failureData,
				agentReportData: e.agentReportData,
				cooldownData: e.cooldownData,
			})),
		})),
	};

	return sha256(stableStringify(hashInput));
}

/**
 * Derive a deduplication ID from diagnostic properties.
 */
function deriveDedupeId(
	diagnosticType: DiagnosticType,
	workspaceId: string,
	title: string,
	evidence: EvidenceGroup[],
): string {
	const hashInput: Record<string, unknown> = {
		diagnosticType,
		workspaceId,
		title,
		evidenceHashes: evidence.map((g) => g.entries.map((e) => e.contentHash)),
	};
	return sha256(stableStringify(hashInput));
}

// ---------------------------------------------------------------------------
// Diagnostic packet creation
// ---------------------------------------------------------------------------

export interface CreateDiagnosticPacketOptions {
	severity: PacketSeverity;
	diagnosticType: DiagnosticType;
	workspaceId: string;
	title: string;
	description: string;
	evidence: EvidenceGroup[];
	stopCondition?: Partial<StopConditionState>;
	cooldownDurationMs?: number;
	failureClassification?: FailureData;
	planExecutionId?: string;
}

/**
 * Create a diagnostic packet with the given options.
 *
 * Automatically generates:
 * - Unique ID
 * - ISO timestamp
 * - Content hash for integrity verification
 * - Budget state
 * - Cooldown state
 * - Dedupe state
 * - Stop condition state
 * - Placeholder evidence if no evidence is provided (no silent errors)
 *
 * @param options - Packet creation options
 * @returns A new DiagnosticPacket
 */
export function createDiagnosticPacket(options: CreateDiagnosticPacketOptions): DiagnosticPacket {
	const id = randomUUID();
	const timestamp = new Date().toISOString();

	// Auto-create placeholder evidence if none provided (no silent errors)
	let evidence = options.evidence;
	if (evidence.length === 0) {
		const placeholder = createPlaceholderEvidenceEntry(
			"No evidence collected",
			"diagnostic-packet",
			"Diagnostic was created without evidence; auto-generated placeholder to avoid silent error",
		);
		evidence = [createEvidenceGroup("Missing Evidence", [placeholder])];
	}

	const budget = createPacketBudget({ evidence });
	const cooldown = createCooldownState({
		durationMs: options.cooldownDurationMs ?? DEFAULT_COOLDOWN_DURATION_MS,
	});
	const dedupeId = deriveDedupeId(options.diagnosticType, options.workspaceId, options.title, evidence);
	const dedupe = createDedupeState(dedupeId);
	const stopCondition = createStopConditionState(options.stopCondition);

	const basePacket: Omit<DiagnosticPacket, "packetHash"> = {
		id,
		timestamp,
		severity: options.severity,
		diagnosticType: options.diagnosticType,
		workspaceId: options.workspaceId,
		title: options.title,
		description: options.description,
		evidence,
		budget,
		cooldown,
		dedupe,
		stopCondition,
		failureClassification: options.failureClassification,
		planExecutionId: options.planExecutionId,
		cooldownDurationMs: options.cooldownDurationMs,
	};

	const packetHash = computePacketHash(basePacket);

	return {
		...basePacket,
		packetHash,
	};
}

// ---------------------------------------------------------------------------
// Packet validation
// ---------------------------------------------------------------------------

/**
 * Validate a diagnostic packet structure.
 *
 * Checks for required fields and returns a validation result with
 * error messages.
 *
 * @param packet - The packet to validate
 * @returns Validation result
 */
export function validateDiagnosticPacket(packet: unknown): ValidationResult {
	const errors: string[] = [];

	if (!packet || typeof packet !== "object") {
		errors.push("Missing or invalid packet: must be an object");
		return { valid: false, errors };
	}

	const p = packet as Record<string, unknown>;

	if (!p.id || typeof p.id !== "string") {
		errors.push("Missing or invalid 'id': must be a non-empty string");
	}
	if (!p.timestamp || typeof p.timestamp !== "string") {
		errors.push("Missing or invalid 'timestamp': must be a non-empty string");
	}
	if (!p.packetHash || typeof p.packetHash !== "string") {
		errors.push("Missing or invalid 'packetHash': must be a non-empty string");
	}
	if (!p.severity || typeof p.severity !== "string") {
		errors.push("Missing or invalid 'severity': must be a non-empty string");
	}
	if (!p.diagnosticType || typeof p.diagnosticType !== "string") {
		errors.push("Missing or invalid 'diagnosticType': must be a non-empty string");
	}
	if (!p.workspaceId || typeof p.workspaceId !== "string") {
		errors.push("Missing or invalid 'workspaceId': must be a non-empty string");
	}
	if (!p.title || typeof p.title !== "string") {
		errors.push("Missing or invalid 'title': must be a non-empty string");
	}
	if (!p.description || typeof p.description !== "string") {
		errors.push("Missing or invalid 'description': must be a non-empty string");
	}
	if (!Array.isArray(p.evidence)) {
		errors.push("Missing or invalid 'evidence': must be an array");
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

// ---------------------------------------------------------------------------
// Serialization and deserialization
// ---------------------------------------------------------------------------

/**
 * Serialize a diagnostic packet to a JSON string.
 *
 * @param packet - The diagnostic packet
 * @returns JSON string representation
 */
export function serializeDiagnosticPacket(packet: DiagnosticPacket): string {
	return JSON.stringify(packet, null, 2);
}

/**
 * Deserialize a diagnostic packet from a JSON string.
 *
 * Validates the structure and throws if the JSON is invalid or
 * the packet structure doesn't match the expected format.
 *
 * @param json - JSON string representation
 * @returns The deserialized DiagnosticPacket
 * @throws If JSON is malformed or packet structure is invalid
 */
export function deserializeDiagnosticPacket(json: string): DiagnosticPacket {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("Invalid JSON: cannot parse diagnostic packet");
	}

	// Basic structural validation
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Invalid DiagnosticPacket: must be an object");
	}

	const obj = parsed as Record<string, unknown>;

	if (!obj.id || !obj.timestamp || !obj.packetHash || !obj.severity) {
		throw new Error("Invalid DiagnosticPacket: missing required fields");
	}

	if (!Array.isArray(obj.evidence)) {
		throw new Error("Invalid DiagnosticPacket: evidence must be an array");
	}

	return parsed as DiagnosticPacket;
}

// ---------------------------------------------------------------------------
// Integrity verification
// ---------------------------------------------------------------------------

/**
 * Verify the integrity of a diagnostic packet by recomputing its hash.
 *
 * @param packet - The diagnostic packet
 * @returns True if the packet hash matches the recomputed hash
 */
export function verifyPacketIntegrity(packet: DiagnosticPacket): boolean {
	if (!packet.packetHash) return false;

	// Build the same hash input as computePacketHash, but with the packet's current values
	const hashInput: Record<string, unknown> = {
		id: packet.id,
		timestamp: packet.timestamp,
		severity: packet.severity,
		diagnosticType: packet.diagnosticType,
		workspaceId: packet.workspaceId,
		title: packet.title,
		description: packet.description,
		evidence: packet.evidence.map((g) => ({
			label: g.label,
			entries: g.entries.map((e) => ({
				id: e.id,
				contentHash: e.contentHash,
				category: e.category,
				description: e.description,
				source: e.source,
				confidence: e.confidence,
				isPlaceholder: e.isPlaceholder,
				data: e.data,
				fileData: e.fileData,
				testData: e.testData,
				errorData: e.errorData,
				schedulingData: e.schedulingData,
				failureData: e.failureData,
				agentReportData: e.agentReportData,
				cooldownData: e.cooldownData,
			})),
		})),
	};

	const recomputed = sha256(stableStringify(hashInput));
	return recomputed === packet.packetHash;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a diagnostic packet for human-readable output.
 *
 * @param packet - The diagnostic packet
 * @returns Formatted string representation
 */
export function formatDiagnosticPacket(packet: DiagnosticPacket): string {
	const lines: string[] = [];
	lines.push("=".repeat(60));
	lines.push("DIAGNOSTIC PACKET");
	lines.push("=".repeat(60));
	lines.push(`ID:          ${packet.id}`);
	lines.push(`Timestamp:   ${packet.timestamp}`);
	lines.push(`Workspace:   ${packet.workspaceId}`);
	lines.push(`Severity:    ${packet.severity}`);
	lines.push(`Type:        ${packet.diagnosticType}`);
	lines.push(`Title:       ${packet.title}`);
	lines.push(`Description: ${packet.description}`);
	lines.push("");

	if (packet.failureClassification) {
		lines.push("Failure Classification:");
		lines.push(`  Category:    ${packet.failureClassification.category}`);
		lines.push(`  Confidence:  ${packet.failureClassification.confidence}`);
		lines.push(`  Recoverable: ${packet.failureClassification.recoverable}`);
		lines.push("");
	}

	lines.push("Evidence:");
	for (const group of packet.evidence) {
		lines.push(`  [${group.label}] (confidence: ${group.groupConfidence.toFixed(2)}, complete: ${group.isComplete})`);
		for (const entry of group.entries) {
			const placeholder = entry.isPlaceholder ? " [PLACEHOLDER]" : "";
			lines.push(`    - [${entry.category}] ${entry.description} (source: ${entry.source})${placeholder}`);
		}
	}
	lines.push("");

	lines.push(
		`Budget:      ${packet.budget.currentEvidenceCount}/${packet.budget.maxEvidenceEntries} entries, ${packet.budget.currentGroupCount}/${packet.budget.maxEvidenceGroups} groups${packet.budget.isOverBudget ? " [OVER BUDGET]" : ""}`,
	);
	lines.push(
		`Cooldown:    ${packet.cooldown.isActive ? `Active (${packet.cooldown.remainingMs}ms remaining, reason: ${packet.cooldown.cooldownReason})` : "Inactive"}`,
	);
	lines.push(`Dedupe:      ${packet.dedupe.dedupeId}${packet.dedupe.isSuppressed ? " [SUPPRESSED]" : ""}`);
	lines.push(
		`Stop Cond:   ${packet.stopCondition.triggered ? `Triggered: ${packet.stopCondition.condition}` : "Not triggered"}`,
	);
	lines.push(`Packet Hash: ${packet.packetHash.substring(0, 16)}...`);
	lines.push("=".repeat(60));

	return lines.join("\n");
}
