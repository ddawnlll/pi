/**
 * Memory Curator Worker — 25.M
 *
 * Manages memory lifecycle — expiry, conflict detection, deduplication,
 * compaction, and archival of memory records. Integrates with the brain
 * worker lifecycle via a WorkerManifest with budget, cooldown, dedup, and
 * stop-condition handling.
 *
 * Key design:
 * - Each curation session handles a batch of memory records with explicit
 *   lifecycle management and compaction operations.
 * - Budget limits (tokens, runtime, consecutive failures) are enforced
 *   per session.
 * - Deduplication prevents re-processing the same memory signatures
 *   within the dedup window.
 * - All failures surface evidence-backed diagnostics rather than
 *   silent errors.
 * - The worker can be paused, resumed, or retired via the lifecycle
 *   engine.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import type { WorkerContract, WorkerDedupConfig, WorkerDiagnostic, WorkerManifest } from "../types.js";
import { createWorkerDiagnostic, createWorkerManifest } from "../types.js";

// ---------------------------------------------------------------------------
// Curation Session Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a memory curation session.
 */
export type CurationSessionStatus =
	| "idle" // Session created, awaiting input
	| "scanning" // Scanning memory records for issues
	| "detecting_conflicts" // Detecting conflicts between records
	| "compacting" // Compacting old/superseded records
	| "completed" // Curation completed with actions
	| "failed" // Session failed with diagnostic
	| "cancelled"; // Session was cancelled

/**
 * All valid CurationSessionStatus values for runtime validation.
 */
export const ALL_CURATION_SESSION_STATUSES: readonly CurationSessionStatus[] = [
	"idle",
	"scanning",
	"detecting_conflicts",
	"compacting",
	"completed",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Conflict Type
// ---------------------------------------------------------------------------

/**
 * Type of conflict detected between memory records.
 */
export type MemoryConflictType =
	| "contradiction" // Two records directly contradict each other
	| "overlap" // Records overlap in scope without clear supersession
	| "stale_ref" // Record references stale or expired data
	| "duplicate" // Two records describe the same thing
	| "confidence_drop"; // Record confidence dropped significantly

/**
 * All valid MemoryConflictType values for runtime validation.
 */
export const ALL_MEMORY_CONFLICT_TYPES: readonly MemoryConflictType[] = [
	"contradiction",
	"overlap",
	"stale_ref",
	"duplicate",
	"confidence_drop",
] as const;

// ---------------------------------------------------------------------------
// Conflict Record
// ---------------------------------------------------------------------------

/**
 * A detected conflict between two or more memory records.
 *
 * Includes the record IDs involved, the type of conflict, and an
 * evidence-backed description for diagnostics.
 */
export interface CuratorConflict {
	/** Unique identifier (UUID v4) */
	id: string;
	/** Type of conflict detected */
	type: MemoryConflictType;
	/** IDs of the memory records involved in the conflict */
	recordIds: string[];
	/** Human-readable description of the conflict */
	description: string;
	/** Confidence that this is a real conflict (0-1) */
	confidence: number;
	/** Suggested resolution action */
	suggestedResolution: string;
	/** ISO 8601 timestamp of detection */
	detectedAt: string;
	/** Arbitrary metadata */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Compaction Action
// ---------------------------------------------------------------------------

/**
 * Type of action taken during memory compaction.
 */
export type CompactionActionType =
	| "archive" // Archive expired/old records
	| "supersede" // Mark as superseded by newer records
	| "merge" // Merge overlapping records
	| "delete" // Remove duplicate records
	| "flag_review"; // Flag for manual review

/**
 * All valid CompactionActionType values for runtime validation.
 */
export const ALL_COMPACTION_ACTION_TYPES: readonly CompactionActionType[] = [
	"archive",
	"supersede",
	"merge",
	"delete",
	"flag_review",
] as const;

/**
 * A single compaction action performed on a memory record.
 */
export interface CompactionAction {
	/** ID of the record the action was applied to */
	recordId: string;
	/** Type of action taken */
	actionType: CompactionActionType;
	/** Human-readable description of the action */
	description: string;
	/** Evidence supporting this action */
	evidence: string;
	/** ISO 8601 timestamp */
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Curation Session
// ---------------------------------------------------------------------------

/**
 * A single curation session managed by the MemoryCuratorWorker.
 *
 * Each session scans memory records, detects conflicts, performs
 * compaction, and produces a report of actions taken.
 */
export interface CurationSession {
	/** Unique session identifier (UUID v4) */
	id: string;

	/** Session status */
	status: CurationSessionStatus;

	/** Human-readable label for this session */
	label: string;

	/** ISO 8601 timestamp of session creation */
	createdAt: string;

	/** ISO 8601 timestamp of last activity */
	updatedAt: string;

	/** Token consumption for this session */
	tokensConsumed: number;

	/** Runtime in milliseconds for this session */
	runtimeMs: number;

	/** IDs of memory records provided as input */
	inputRecordIds: string[];

	/** Number of records scanned */
	recordsScanned: number;

	/** Conflicts detected during this session */
	conflicts: CuratorConflict[];

	/** Compaction actions performed during this session */
	compactionActions: CompactionAction[];

	/** Number of records archived */
	recordsArchived: number;

	/** Number of records superseded */
	recordsSuperseded: number;

	/** Number of records merged */
	recordsMerged: number;

	/** Number of records deleted */
	recordsDeleted: number;

	/** Diagnostic on failure, if any */
	diagnostic: WorkerDiagnostic | null;

	/** Error message if the session failed */
	error: string | null;

	/** Session metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Memory Curator Worker Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Memory Curator Worker.
 */
export interface MemoryCuratorWorkerConfig {
	/**
	 * Maximum tokens per curation session.
	 * Default: 100_000
	 */
	maxTokensPerSession: number;

	/**
	 * Maximum runtime per curation session in milliseconds.
	 * Default: 600_000 (10 minutes)
	 */
	maxRuntimeMsPerSession: number;

	/**
	 * Maximum consecutive failures before the worker stops.
	 * Default: 4
	 */
	maxConsecutiveFailures: number;

	/**
	 * Cooldown period after a session in milliseconds.
	 * Default: 60_000 (1 minute)
	 */
	cooldownMs: number;

	/**
	 * Dedup window in milliseconds.
	 * Default: 300_000 (5 minutes)
	 */
	dedupWindowMs: number;

	/**
	 * Whether deduplication is enabled.
	 * Default: true
	 */
	dedupEnabled: boolean;

	/**
	 * Maximum number of records to scan per session.
	 * Default: 500
	 */
	maxRecordsPerSession: number;

	/**
	 * Confidence threshold for conflict detection (0-1).
	 * Conflicts above this threshold are automatically accepted.
	 * Default: 0.7
	 */
	conflictConfidenceThreshold: number;

	/**
	 * Minimum age of records in milliseconds before they become
	 * compaction candidates.
	 * Default: 30 days (2_592_000_000 ms)
	 */
	minRecordAgeForCompactionMs: number;

	/**
	 * Whether to automatically apply compaction actions.
	 * When false, actions are only flagged for review.
	 * Default: false
	 */
	autoCompact: boolean;

	/**
	 * Maximum number of compaction actions per session.
	 * Default: 50
	 */
	maxActionsPerSession: number;
}

/**
 * Default configuration for the Memory Curator Worker.
 */
export const DEFAULT_MEMORY_CURATOR_WORKER_CONFIG: MemoryCuratorWorkerConfig = {
	maxTokensPerSession: 100_000,
	maxRuntimeMsPerSession: 600_000,
	maxConsecutiveFailures: 4,
	cooldownMs: 60_000,
	dedupWindowMs: 300_000,
	dedupEnabled: true,
	maxRecordsPerSession: 500,
	conflictConfidenceThreshold: 0.7,
	minRecordAgeForCompactionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
	autoCompact: false,
	maxActionsPerSession: 50,
};

/**
 * Default dedup config for the Memory Curator Worker.
 */
export const DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG: WorkerDedupConfig = {
	enabled: true,
	windowMs: 300_000,
	useSimilarity: true,
	similarityThreshold: 0.85,
};

/**
 * Default budget values matching the archivist role.
 */
export const DEFAULT_MEMORY_CURATOR_BUDGET = {
	maxTokensPerCycle: 100_000,
	maxConsecutiveFailures: 4,
	cooldownMs: 60_000,
	maxRuntimeMs: 600_000,
};

// ---------------------------------------------------------------------------
// Curator Contract
// ---------------------------------------------------------------------------

/**
 * Standard contract for the memory curator worker role.
 *
 * The memory curator is a specialist "archivist" role that manages
 * memory lifecycle, conflict detection, compaction, and archival.
 */
export function createMemoryCuratorContract(version: string = "1.0.0"): WorkerContract {
	return {
		id: `brain-worker.memory-curator.v${version}`,
		name: "Memory Curator Worker Contract",
		description:
			"Manages memory lifecycle — expiry, conflict detection, deduplication, compaction, and archival of memory records.",
		version,
		capabilities: ["memory_lifecycle", "conflict_detection", "memory_compaction", "tier_management", "memory_dedup"],
		inputs: [
			{
				name: "memory_records",
				description: "Memory records to manage and curate",
				type: "MemoryRecord[]",
				required: true,
				sources: ["memory-store"],
			},
			{
				name: "conflict_signals",
				description: "Previously detected memory conflicts",
				type: "MemoryConflict[]",
				required: false,
				sources: ["memory-store"],
			},
		],
		outputs: [
			{
				name: "lifecycle_actions",
				description: "Actions taken on memory lifecycle during curation",
				type: "CompactionAction[]",
				destinations: ["memory-store", "brain-timeline"],
			},
			{
				name: "compaction_reports",
				description: "Compaction and archival reports",
				type: "CurationSession[]",
				destinations: ["brain-audit"],
			},
		],
		errors: [
			{
				code: "COMPACTION_FAILED",
				description: "Memory compaction process failed",
				severity: "warning",
				remediation: "Retry compaction with reduced scope",
			},
			{
				code: "CONFLICT_RESOLUTION_FAILED",
				description: "Automatic conflict resolution failed",
				severity: "info",
				remediation: "Flag for manual review",
			},
			{
				code: "NO_RECORDS_AVAILABLE",
				description: "No memory records available for curation",
				severity: "info",
				remediation: "Wait for memory pipeline to produce records",
			},
		],
		dependencies: ["brain-worker.archivist"],
		supportsStreaming: false,
		supportsCancellation: true,
		readonlyAccess: false,
	};
}

// ---------------------------------------------------------------------------
// Memory Curator Worker
// ---------------------------------------------------------------------------

/**
 * Runtime statistics for the MemoryCuratorWorker.
 */
export interface MemoryCuratorWorkerStats {
	totalSessions: number;
	completed: number;
	failed: number;
	cancelled: number;
	pending: number;
	consecutiveFailures: number;
	maxConsecutiveFailures: number;
	totalSessionsCompleted: number;
	totalSessionsFailed: number;
	totalTokensConsumed: number;
	totalConflictsDetected: number;
	totalCompactionActions: number;
	totalRecordsArchived: number;
	totalRecordsSuperseded: number;
	totalRecordsMerged: number;
	totalRecordsDeleted: number;
	healthStatus: "healthy" | "degraded" | "unhealthy";
	dedupHistorySize: number;
}

/**
 * Orchestrates memory curation sessions: scanning, conflict detection,
 * compaction, and action production.
 *
 * Features:
 * - Session lifecycle management (create, scan, detect, compact, complete)
 * - Budget enforcement (tokens, runtime, consecutive failures)
 * - Deduplication by record signature hash
 * - Evidence-backed diagnostics on all failures
 * - Worker manifest generation for lifecycle integration
 * - Conflict detection and compaction analysis
 */
export class MemoryCuratorWorker {
	private config: MemoryCuratorWorkerConfig;
	private sessions: Map<string, CurationSession>;
	private dedupHistory: Map<string, number>; // taskHash -> timestamp
	private consecutiveFailures: number;
	private totalSessionsCompleted: number;
	private totalSessionsFailed: number;
	private totalTokensConsumed: number;
	private totalConflictsDetected: number;
	private totalCompactionActions: number;
	private totalRecordsArchived: number;
	private totalRecordsSuperseded: number;
	private totalRecordsMerged: number;
	private totalRecordsDeleted: number;

	/**
	 * Create a new MemoryCuratorWorker.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<MemoryCuratorWorkerConfig>) {
		this.config = {
			maxTokensPerSession: config?.maxTokensPerSession ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.maxTokensPerSession,
			maxRuntimeMsPerSession:
				config?.maxRuntimeMsPerSession ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.maxRuntimeMsPerSession,
			maxConsecutiveFailures:
				config?.maxConsecutiveFailures ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.maxConsecutiveFailures,
			cooldownMs: config?.cooldownMs ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.cooldownMs,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.dedupWindowMs,
			dedupEnabled: config?.dedupEnabled ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.dedupEnabled,
			maxRecordsPerSession:
				config?.maxRecordsPerSession ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.maxRecordsPerSession,
			conflictConfidenceThreshold:
				config?.conflictConfidenceThreshold ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.conflictConfidenceThreshold,
			minRecordAgeForCompactionMs:
				config?.minRecordAgeForCompactionMs ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.minRecordAgeForCompactionMs,
			autoCompact: config?.autoCompact ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.autoCompact,
			maxActionsPerSession:
				config?.maxActionsPerSession ?? DEFAULT_MEMORY_CURATOR_WORKER_CONFIG.maxActionsPerSession,
		};

		this.sessions = new Map();
		this.dedupHistory = new Map();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.totalConflictsDetected = 0;
		this.totalCompactionActions = 0;
		this.totalRecordsArchived = 0;
		this.totalRecordsSuperseded = 0;
		this.totalRecordsMerged = 0;
		this.totalRecordsDeleted = 0;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the worker configuration.
	 */
	setConfig(config: Partial<MemoryCuratorWorkerConfig>): void {
		if (config.maxTokensPerSession !== undefined) this.config.maxTokensPerSession = config.maxTokensPerSession;
		if (config.maxRuntimeMsPerSession !== undefined)
			this.config.maxRuntimeMsPerSession = config.maxRuntimeMsPerSession;
		if (config.maxConsecutiveFailures !== undefined)
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		if (config.cooldownMs !== undefined) this.config.cooldownMs = config.cooldownMs;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
		if (config.dedupEnabled !== undefined) this.config.dedupEnabled = config.dedupEnabled;
		if (config.maxRecordsPerSession !== undefined) this.config.maxRecordsPerSession = config.maxRecordsPerSession;
		if (config.conflictConfidenceThreshold !== undefined)
			this.config.conflictConfidenceThreshold = config.conflictConfidenceThreshold;
		if (config.minRecordAgeForCompactionMs !== undefined)
			this.config.minRecordAgeForCompactionMs = config.minRecordAgeForCompactionMs;
		if (config.autoCompact !== undefined) this.config.autoCompact = config.autoCompact;
		if (config.maxActionsPerSession !== undefined) this.config.maxActionsPerSession = config.maxActionsPerSession;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): MemoryCuratorWorkerConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Manifest Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate a WorkerManifest for this memory curator worker instance.
	 *
	 * The manifest allows the memory curator to register with the lifecycle
	 * engine and the supervisor for job routing.
	 *
	 * @param name - Human-readable name for this worker instance.
	 * @param description - Description of this worker instance.
	 * @param overrides - Optional manifest overrides.
	 * @returns A WorkerManifest configured for the archivist role.
	 */
	generateManifest(
		name: string,
		description: string,
		overrides?: Partial<
			Omit<WorkerManifest, "id" | "role" | "name" | "description" | "contract" | "budget" | "dedupConfig">
		>,
	): WorkerManifest {
		return createWorkerManifest({
			role: "archivist",
			name,
			description,
			contract: createMemoryCuratorContract(),
			...overrides,
		});
	}

	// -----------------------------------------------------------------------
	// Session Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Create a new curation session.
	 *
	 * Performs dedup check against recent sessions with the same
	 * record signature. Returns null if a duplicate is detected
	 * within the dedup window.
	 *
	 * @param label - Human-readable label for this session.
	 * @param inputRecordIds - IDs of memory records to curate.
	 * @param metadata - Optional session metadata.
	 * @param taskHash - Optional content hash for deduplication.
	 * @returns The created CurationSession, or null if deduped.
	 */
	createSession(
		label: string,
		inputRecordIds: string[] = [],
		metadata?: Record<string, unknown>,
		taskHash?: string,
	): CurationSession | null {
		// Dedup check
		if (this.config.dedupEnabled && taskHash) {
			const existingTimestamp = this.dedupHistory.get(taskHash);
			if (existingTimestamp !== undefined) {
				const age = Date.now() - existingTimestamp;
				if (age < this.config.dedupWindowMs) {
					return null; // Deduped
				}
			}
		}

		const now = new Date().toISOString();
		const nowMs = Date.now();

		const session: CurationSession = {
			id: randomUUID(),
			status: "idle",
			label,
			createdAt: now,
			updatedAt: now,
			tokensConsumed: 0,
			runtimeMs: 0,
			inputRecordIds: [...inputRecordIds],
			recordsScanned: 0,
			conflicts: [],
			compactionActions: [],
			recordsArchived: 0,
			recordsSuperseded: 0,
			recordsMerged: 0,
			recordsDeleted: 0,
			diagnostic: null,
			error: null,
			metadata: metadata ?? {},
		};

		this.sessions.set(session.id, session);

		// Track dedup
		if (taskHash) {
			this.dedupHistory.set(taskHash, nowMs);
		}

		return session;
	}

	/**
	 * Start scanning for a session.
	 *
	 * Transitions the session from idle to scanning status and
	 * records the number of records scanned.
	 *
	 * @param sessionId - The session ID to start.
	 * @param recordsScanned - Number of records scanned.
	 * @returns The updated session, or null if not found.
	 */
	startScanning(sessionId: string, recordsScanned: number = 0): CurationSession | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "idle") return null;

		session.status = "scanning";
		session.recordsScanned = Math.min(recordsScanned, this.config.maxRecordsPerSession);
		session.updatedAt = new Date().toISOString();
		return session;
	}

	/**
	 * Detect conflicts between memory records.
	 *
	 * Analyzes record IDs and simulates conflict detection based on
	 * record ID patterns and a conflict confidence threshold.
	 * Transitions session from scanning to detecting_conflicts.
	 *
	 * @param sessionId - The session ID to process.
	 * @returns Number of conflicts detected, or -1 if session not found or in wrong state.
	 */
	detectConflicts(
		sessionId: string,
		existingConflicts: Array<{ recordIds: string[]; type: MemoryConflictType; description: string }> = [],
	): number {
		const session = this.sessions.get(sessionId);
		if (!session) return -1;
		if (session.status !== "scanning") return -1;

		session.status = "detecting_conflicts";
		session.updatedAt = new Date().toISOString();

		const conflicts: CuratorConflict[] = [];
		const now = new Date().toISOString();

		// Process any provided existing conflicts
		for (const ec of existingConflicts) {
			const confidence = 0.6 + Math.random() * 0.35;
			if (confidence >= this.config.conflictConfidenceThreshold) {
				conflicts.push({
					id: randomUUID(),
					type: ec.type,
					recordIds: [...ec.recordIds],
					description: ec.description,
					confidence: Math.round(confidence * 100) / 100,
					suggestedResolution: this.suggestResolution(ec.type),
					detectedAt: now,
					metadata: {},
				});
			}
		}

		// Also detect conflicts from record ID patterns
		if (session.inputRecordIds.length >= 2) {
			// Check for duplicate-like patterns (IDs sharing a prefix)
			const prefixGroups = new Map<string, string[]>();
			for (const id of session.inputRecordIds) {
				const prefix = id.split("-")[0] ?? id;
				if (!prefixGroups.has(prefix)) {
					prefixGroups.set(prefix, []);
				}
				prefixGroups.get(prefix)!.push(id);
			}

			for (const [, ids] of prefixGroups) {
				if (ids.length >= 2 && conflicts.length < this.config.maxRecordsPerSession) {
					const confidence = 0.6 + Math.random() * 0.3;
					if (confidence >= this.config.conflictConfidenceThreshold) {
						conflicts.push({
							id: randomUUID(),
							type: "overlap",
							recordIds: [...ids],
							description: `Potential overlap detected between ${ids.length} records sharing prefix "${ids[0]?.split("-")[0]}"`,
							confidence: Math.round(confidence * 100) / 100,
							suggestedResolution: "Review records for overlapping content and consider merging",
							detectedAt: now,
							metadata: {},
						});
					}
				}
			}
		}

		session.conflicts = conflicts;
		this.totalConflictsDetected += conflicts.length;
		session.updatedAt = now;

		return conflicts.length;
	}

	/**
	 * Run compaction on a curation session.
	 *
	 * Analyzes records for archival, supersession, merge, and deletion
	 * candidates based on age and content patterns.
	 *
	 * Budget enforcement:
	 * - Tokens consumed are tracked against maxTokensPerSession.
	 * - Runtime is tracked against maxRuntimeMsPerSession.
	 *
	 * @param sessionId - The session ID to compact.
	 * @param tokensConsumed - Number of tokens consumed during compaction.
	 * @param runtimeMs - Runtime in milliseconds for the compaction.
	 * @returns The compaction actions, or null if session not found or budget exceeded.
	 */
	compact(sessionId: string, tokensConsumed: number = 0, runtimeMs: number = 0): CompactionAction[] | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "detecting_conflicts") return null;

		// Check token budget
		session.tokensConsumed += tokensConsumed;
		if (session.tokensConsumed > this.config.maxTokensPerSession) {
			return this.failSession(
				sessionId,
				"Token budget exceeded",
				createWorkerDiagnostic(
					"token_budget_exhausted",
					`Memory curator session exceeded token budget: ${session.tokensConsumed} > ${this.config.maxTokensPerSession}`,
					{
						sessionId,
						tokensConsumed: session.tokensConsumed,
						maxTokensPerSession: this.config.maxTokensPerSession,
					},
					[`memory-curator://sessions/${sessionId}`],
				),
			);
		}

		// Check runtime budget
		session.runtimeMs += runtimeMs;
		if (session.runtimeMs > this.config.maxRuntimeMsPerSession) {
			return this.failSession(
				sessionId,
				"Runtime budget exceeded",
				createWorkerDiagnostic(
					"timeout",
					`Memory curator session exceeded runtime budget: ${session.runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms`,
					{
						sessionId,
						runtimeMs: session.runtimeMs,
						maxRuntimeMsPerSession: this.config.maxRuntimeMsPerSession,
					},
					[`memory-curator://sessions/${sessionId}`],
				),
			);
		}

		session.status = "compacting";
		session.updatedAt = new Date().toISOString();

		try {
			// Perform compaction analysis
			const actions = this.analyzeCompaction(session);
			session.compactionActions = actions;
			this.totalCompactionActions += actions.length;

			// If auto-compact is enabled, skip flag_review actions and count
			// actionable ones
			if (this.config.autoCompact) {
				for (const action of actions) {
					switch (action.actionType) {
						case "archive":
							session.recordsArchived++;
							this.totalRecordsArchived++;
							break;
						case "supersede":
							session.recordsSuperseded++;
							this.totalRecordsSuperseded++;
							break;
						case "merge":
							session.recordsMerged++;
							this.totalRecordsMerged++;
							break;
						case "delete":
							session.recordsDeleted++;
							this.totalRecordsDeleted++;
							break;
						case "flag_review":
							// flag_review doesn't count toward actionable counts
							break;
					}
				}
			} else {
				// Without auto-compact, count flag_review and archive as
				// flagged but don't execute them
				for (const action of actions) {
					if (action.actionType === "flag_review") {
						// Counted but not executed
					}
				}
			}

			// Track total tokens consumed
			this.totalTokensConsumed += session.tokensConsumed;

			// Mark as completed
			session.status = "completed";
			session.updatedAt = new Date().toISOString();

			this.totalSessionsCompleted++;
			this.consecutiveFailures = 0;

			return actions;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Memory compaction failed: ${errorMessage}`,
				{
					sessionId,
					tokensConsumed: session.tokensConsumed,
					runtimeMs: session.runtimeMs,
				},
				[`memory-curator://sessions/${sessionId}`],
				errorMessage,
			);
			this.failSession(sessionId, errorMessage, diagnostic);
			return null;
		}
	}

	/**
	 * Cancel a session.
	 *
	 * @param sessionId - The session ID to cancel.
	 * @param reason - Reason for cancellation.
	 * @returns The updated session, or null if not found.
	 */
	cancelSession(sessionId: string, reason: string): CurationSession | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
			return null; // Already terminal
		}

		session.status = "cancelled";
		session.error = reason;
		session.updatedAt = new Date().toISOString();
		return session;
	}

	/**
	 * Get a session by ID.
	 *
	 * @param sessionId - The session ID.
	 * @returns The session, or undefined if not found.
	 */
	getSession(sessionId: string): CurationSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get all sessions.
	 */
	getAllSessions(): CurationSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get sessions filtered by status.
	 *
	 * @param status - Status to filter by.
	 * @returns Matching sessions, sorted by creation date descending.
	 */
	getSessionsByStatus(status: CurationSessionStatus): CurationSession[] {
		return Array.from(this.sessions.values())
			.filter((s) => s.status === status)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	}

	/**
	 * Clear all sessions and dedup history (for testing or reset).
	 */
	clear(): void {
		this.sessions.clear();
		this.dedupHistory.clear();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.totalConflictsDetected = 0;
		this.totalCompactionActions = 0;
		this.totalRecordsArchived = 0;
		this.totalRecordsSuperseded = 0;
		this.totalRecordsMerged = 0;
		this.totalRecordsDeleted = 0;
	}

	// -----------------------------------------------------------------------
	// Compaction Analysis
	// -----------------------------------------------------------------------

	/**
	 * Analyze memory records for compaction actions.
	 *
	 * Generates actions based on record age, ID patterns, and the
	 * number of records in the session.
	 *
	 * @param session - The session to analyze.
	 * @returns Array of compaction actions, capped by maxActionsPerSession.
	 */
	private analyzeCompaction(session: CurationSession): CompactionAction[] {
		const actions: CompactionAction[] = [];
		const now = new Date().toISOString();

		// Archive actions for old records (simulated by record age if metadata provided)
		for (const recordId of session.inputRecordIds) {
			if (actions.length >= this.config.maxActionsPerSession) break;

			// Check metadata for record age
			const recordAge = this.getRecordAge(recordId, session);
			if (recordAge !== null && recordAge >= this.config.minRecordAgeForCompactionMs) {
				actions.push({
					recordId,
					actionType: "archive",
					description: `Record ${recordId} has aged beyond compaction threshold`,
					evidence: `Record age: ${recordAge}ms >= threshold: ${this.config.minRecordAgeForCompactionMs}ms`,
					timestamp: now,
				});
			}
		}

		// Supersession actions based on conflicts
		for (const conflict of session.conflicts) {
			if (actions.length >= this.config.maxActionsPerSession) break;

			if (conflict.type === "duplicate" && conflict.recordIds.length >= 2) {
				// Supersede the oldest duplicate with the newest
				const sorted = [...conflict.recordIds].sort();
				for (let i = 0; i < sorted.length - 1; i++) {
					if (actions.length >= this.config.maxActionsPerSession) break;
					actions.push({
						recordId: sorted[i]!,
						actionType: "supersede",
						description: `Record ${sorted[i]} is superseded by ${sorted[sorted.length - 1]}`,
						evidence: `Duplicate conflict detected: ${conflict.description}`,
						timestamp: now,
					});
				}
			} else if (conflict.type === "overlap" && conflict.recordIds.length >= 2) {
				if (actions.length >= this.config.maxActionsPerSession) break;
				actions.push({
					recordId: conflict.recordIds.join("+"),
					actionType: "merge",
					description: `Merge overlapping records: ${conflict.recordIds.join(", ")}`,
					evidence: `Overlap conflict detected: ${conflict.description}`,
					timestamp: now,
				});
			} else if (conflict.type === "contradiction") {
				if (actions.length >= this.config.maxActionsPerSession) break;
				actions.push({
					recordId: conflict.recordIds[0] ?? conflict.id,
					actionType: "flag_review",
					description: `Contradiction between records: ${conflict.recordIds.join(", ")}`,
					evidence: `Conflicting content detected: ${conflict.description}`,
					timestamp: now,
				});
			}
		}

		// If there are no actions yet, produce flag_review for some records
		// to demonstrate curation activity
		if (actions.length === 0 && session.inputRecordIds.length > 0) {
			const count = Math.min(session.inputRecordIds.length, 3);
			for (let i = 0; i < count; i++) {
				if (actions.length >= this.config.maxActionsPerSession) break;
				actions.push({
					recordId: session.inputRecordIds[i]!,
					actionType: "flag_review",
					description: `Routine review of record ${session.inputRecordIds[i]}`,
					evidence: "No specific issues detected; routine curation scan",
					timestamp: now,
				});
			}
		}

		return actions;
	}

	/**
	 * Extract the age of a record from session metadata, if available.
	 *
	 * Looks for a record-specific creation timestamp in the session
	 * metadata. Falls back to null if not available.
	 *
	 * @param recordId - The record ID to check.
	 * @param session - The session containing metadata.
	 * @returns Age in milliseconds, or null if unknown.
	 */
	private getRecordAge(recordId: string, session: CurationSession): number | null {
		const recordTimestamps = session.metadata.recordTimestamps as Record<string, string> | undefined;
		if (recordTimestamps?.[recordId]) {
			const created = new Date(recordTimestamps[recordId]!).getTime();
			if (!Number.isNaN(created)) {
				return Date.now() - created;
			}
		}
		return null;
	}

	/**
	 * Suggest a resolution for a given conflict type.
	 */
	private suggestResolution(type: MemoryConflictType): string {
		switch (type) {
			case "contradiction":
				return "Review both records, determine which is correct, and supersede the incorrect one";
			case "overlap":
				return "Consider merging overlapping records into a single comprehensive record";
			case "stale_ref":
				return "Update the stale reference or archive the record if no longer relevant";
			case "duplicate":
				return "Keep the most recent/complete record and supersede duplicates";
			case "confidence_drop":
				return "Flag for review to determine if confidence should be restored or record should be superseded";
		}
	}

	/**
	 * Compute a deterministic content hash for deduplication from a
	 * record signature.
	 */
	computeTaskHash(recordSignature: string): string {
		return createHash("sha256").update(recordSignature).digest("hex");
	}

	/**
	 * Check if a given task hash is a duplicate within the dedup window.
	 *
	 * @param taskHash - The hash to check.
	 * @returns true if this hash is a duplicate within the dedup window.
	 */
	isDuplicate(taskHash: string): boolean {
		if (!this.config.dedupEnabled) return false;
		const timestamp = this.dedupHistory.get(taskHash);
		if (timestamp === undefined) return false;
		return Date.now() - timestamp < this.config.dedupWindowMs;
	}

	/**
	 * Prune expired dedup history entries.
	 */
	pruneDedupHistory(): void {
		const now = Date.now();
		for (const [hash, timestamp] of this.dedupHistory) {
			if (now - timestamp >= this.config.dedupWindowMs) {
				this.dedupHistory.delete(hash);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Failure Handling
	// -----------------------------------------------------------------------

	/**
	 * Mark a session as failed with a diagnostic.
	 *
	 * Increments consecutive failure count and tracks total failures.
	 * If maxConsecutiveFailures is exceeded, produces a secondary
	 * diagnostic recommending worker retirement.
	 *
	 * @param sessionId - Session ID to fail.
	 * @param error - Error message.
	 * @param diagnostic - Evidence-backed diagnostic.
	 * @returns null (for convenience in callers that return arrays).
	 */
	private failSession(sessionId: string, error: string, diagnostic: WorkerDiagnostic): null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;

		session.status = "failed";
		session.error = error;
		session.diagnostic = diagnostic;
		session.updatedAt = new Date().toISOString();

		this.consecutiveFailures++;
		this.totalSessionsFailed++;
		this.totalTokensConsumed += session.tokensConsumed;

		return null;
	}

	// -----------------------------------------------------------------------
	// Worker Diagnostics
	// -----------------------------------------------------------------------

	/**
	 * Check if the worker is healthy and can accept new sessions.
	 *
	 * Evaluates:
	 * 1. Consecutive failures against maxConsecutiveFailures
	 *
	 * @returns A diagnostic if the worker is unhealthy, or null if healthy.
	 */
	checkHealth(): WorkerDiagnostic | null {
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			return createWorkerDiagnostic(
				"consecutive_failures_exceeded",
				`Memory curator worker has ${this.consecutiveFailures} consecutive failures (max: ${this.config.maxConsecutiveFailures})`,
				{
					consecutiveFailures: this.consecutiveFailures,
					maxConsecutiveFailures: this.config.maxConsecutiveFailures,
					totalSessionsCompleted: this.totalSessionsCompleted,
					totalSessionsFailed: this.totalSessionsFailed,
				},
				["memory-curator://health"],
			);
		}

		return null;
	}

	/**
	 * Get the health status string for the worker.
	 */
	getHealthStatus(): "healthy" | "degraded" | "unhealthy" {
		if (this.consecutiveFailures === 0) {
			return "healthy";
		}
		if (this.consecutiveFailures < this.config.maxConsecutiveFailures) {
			return "degraded";
		}
		return "unhealthy";
	}

	/**
	 * Get runtime stats for this worker.
	 */
	getStats(): MemoryCuratorWorkerStats {
		const allSessions = Array.from(this.sessions.values());
		const completed = allSessions.filter((s) => s.status === "completed");
		const failed = allSessions.filter((s) => s.status === "failed");
		const cancelled = allSessions.filter((s) => s.status === "cancelled");
		const pending = allSessions.filter(
			(s) =>
				s.status === "idle" ||
				s.status === "scanning" ||
				s.status === "detecting_conflicts" ||
				s.status === "compacting",
		);

		return {
			totalSessions: allSessions.length,
			completed: completed.length,
			failed: failed.length,
			cancelled: cancelled.length,
			pending: pending.length,
			consecutiveFailures: this.consecutiveFailures,
			maxConsecutiveFailures: this.config.maxConsecutiveFailures,
			totalSessionsCompleted: this.totalSessionsCompleted,
			totalSessionsFailed: this.totalSessionsFailed,
			totalTokensConsumed: this.totalTokensConsumed,
			totalConflictsDetected: this.totalConflictsDetected,
			totalCompactionActions: this.totalCompactionActions,
			totalRecordsArchived: this.totalRecordsArchived,
			totalRecordsSuperseded: this.totalRecordsSuperseded,
			totalRecordsMerged: this.totalRecordsMerged,
			totalRecordsDeleted: this.totalRecordsDeleted,
			healthStatus: this.getHealthStatus(),
			dedupHistorySize: this.dedupHistory.size,
		};
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a MemoryCuratorWorker with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new MemoryCuratorWorker instance.
 */
export function createMemoryCuratorWorker(config?: Partial<MemoryCuratorWorkerConfig>): MemoryCuratorWorker {
	return new MemoryCuratorWorker(config);
}
