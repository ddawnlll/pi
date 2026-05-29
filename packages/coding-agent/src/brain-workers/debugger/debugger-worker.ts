/**
 * Debugger Worker — 25.I
 *
 * Orchestrates debug sessions using the EvidenceSummarizer and
 * RootCauseAnalyzer. Integrates with the brain worker lifecycle
 * via a WorkerManifest with budget, cooldown, dedup, and stop-condition
 * handling.
 *
 * Key design:
 * - Each debug session is a self-contained unit with evidence collection,
 *   root cause analysis, and conclusion.
 * - Budget limits (tokens, runtime, consecutive failures) are enforced
 *   per session.
 * - Deduplication prevents re-analyzing the same failure signature
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
import { type EvidenceItem, EvidenceSummarizer, type EvidenceSummary } from "./evidence-summarizer.js";
import { type RootCauseAnalysis, RootCauseAnalyzer, type RootCauseAnalyzerConfig } from "./root-cause-analyzer.js";

// ---------------------------------------------------------------------------
// Debug Session Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a debug session.
 */
export type DebugSessionStatus =
	| "pending" // Session created, awaiting evidence
	| "collecting" // Evidence is being collected
	| "analyzing" // Root cause analysis in progress
	| "completed" // Analysis completed with findings
	| "failed" // Session failed with diagnostic
	| "cancelled"; // Session was cancelled

/**
 * All valid DebugSessionStatus values for runtime validation.
 */
export const ALL_DEBUG_SESSION_STATUSES: readonly DebugSessionStatus[] = [
	"pending",
	"collecting",
	"analyzing",
	"completed",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Debug Session
// ---------------------------------------------------------------------------

/**
 * A single debug session managed by the DebuggerWorker.
 *
 * Each session collects evidence, runs root cause analysis, and
 * produces a conclusion with diagnostics.
 */
export interface DebugSession {
	/** Unique session identifier (UUID v4) */
	id: string;

	/** Session status */
	status: DebugSessionStatus;

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

	/** Evidence summary (set after collection phase) */
	evidenceSummary: EvidenceSummary | null;

	/** Root cause analysis (set after analysis phase) */
	rootCauseAnalysis: RootCauseAnalysis | null;

	/** Observability trace identifier for distributed tracing */
	traceId: string | null;

	/** Observability correlation identifier for grouping related jobs */
	correlationId: string | null;

	/** Diagnostic on failure, if any */
	diagnostic: WorkerDiagnostic | null;

	/** Error message if the session failed */
	error: string | null;

	/** Session metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Debugger Worker Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Debugger Worker.
 */
export interface DebuggerWorkerConfig {
	/**
	 * Maximum tokens per debug session.
	 * Default: 150_000
	 */
	maxTokensPerSession: number;

	/**
	 * Maximum runtime per debug session in milliseconds.
	 * Default: 600_000 (10 minutes)
	 */
	maxRuntimeMsPerSession: number;

	/**
	 * Maximum consecutive failures before the worker stops.
	 * Default: 3
	 */
	maxConsecutiveFailures: number;

	/**
	 * Cooldown period after a session in milliseconds.
	 * Default: 120_000 (2 minutes)
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
	 * Evidence summarizer configuration.
	 */
	summarizerConfig: {
		maxEvidenceItems: number;
		maxKeyFindings: number;
		topEvidenceCount: number;
		flagGaps: boolean;
		requiredTypes: Array<"error_message" | "stack_trace" | "execution_log" | "worker_diagnostic">;
	};

	/**
	 * Root cause analyzer configuration.
	 */
	analyzerConfig: RootCauseAnalyzerConfig;
}

/**
 * Default configuration for the Debugger Worker.
 */
export const DEFAULT_DEBUGGER_WORKER_CONFIG: DebuggerWorkerConfig = {
	maxTokensPerSession: 150_000,
	maxRuntimeMsPerSession: 600_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 120_000,
	dedupWindowMs: 300_000,
	dedupEnabled: true,
	summarizerConfig: {
		maxEvidenceItems: 200,
		maxKeyFindings: 20,
		topEvidenceCount: 10,
		flagGaps: true,
		requiredTypes: ["error_message", "stack_trace", "execution_log", "worker_diagnostic"],
	},
	analyzerConfig: {
		minConfidence: 0.3,
		maxFindings: 10,
		speculativeThreshold: 0.5,
		enablePatternMatching: true,
	},
};

/**
 * Default dedup config for the Debugger Worker.
 */
export const DEFAULT_DEBUGGER_DEDUP_CONFIG: WorkerDedupConfig = {
	enabled: true,
	windowMs: 300_000,
	useSimilarity: true,
	similarityThreshold: 0.85,
};

/**
 * Default debugger worker budget values.
 */
/**
 * Default debugger worker budget values matching the diagnostician role.
 */
export const DEFAULT_DEBUGGER_BUDGET = {
	maxTokensPerCycle: 150_000,
	maxConsecutiveFailures: 2,
	cooldownMs: 120_000,
	maxRuntimeMs: 600_000,
};

// ---------------------------------------------------------------------------
// Debug Contract
// ---------------------------------------------------------------------------

/**
 * Standard contract for the debugger worker role.
 *
 * The debugger worker is a specialist "diagnostician" role that
 * consumes failure evidence and produces root cause analyses.
 */
export function createDebuggerContract(version: string = "1.0.0"): WorkerContract {
	return {
		id: `brain-worker.debugger.v${version}`,
		name: "Debugger Worker Contract",
		description:
			"Collects failure evidence, performs root cause analysis, and produces actionable diagnostic reports with evidence chains and remediation suggestions.",
		version,
		readonlyAccess: true,
		capabilities: [
			"collect_evidence",
			"analyze_root_cause",
			"produce_diagnostics",
			"pattern_match_failures",
			"evidence_chain_tracing",
		],
		inputs: [
			{
				name: "failure_event",
				description: "Failure event triggering the debug session",
				type: "FailureEvent",
				required: true,
				sources: ["supervisor", "worker-lifecycle", "autonomous-executor"],
			},
			{
				name: "evidence_items",
				description: "Evidence items collected from the failure context",
				type: "EvidenceItem[]",
				required: false,
				sources: ["evidence-summarizer", "failure-collector"],
			},
			{
				name: "worker_diagnostics",
				description: "Diagnostics from related workers",
				type: "WorkerDiagnostic[]",
				required: false,
				sources: ["worker-lifecycle", "supervisor"],
			},
		],
		outputs: [
			{
				name: "root_cause_analysis",
				description: "Root cause analysis with evidence chains and remediation",
				type: "RootCauseAnalysis",
				destinations: ["supervisor", "plan-executor", "remediation-engine"],
			},
			{
				name: "diagnostic_report",
				description: "Evidence-backed diagnostic report",
				type: "WorkerDiagnostic",
				destinations: ["worker-lifecycle", "observability"],
			},
		],
		errors: [
			{
				code: "NO_EVIDENCE",
				description: "No evidence was collected for the debug session",
				severity: "warning",
				remediation: "Ensure evidence sources are configured and available before starting a debug session",
			},
			{
				code: "ANALYSIS_FAILED",
				description: "Root cause analysis failed unexpectedly",
				severity: "critical",
				remediation: "Check the evidence summary for completeness and retry the analysis",
			},
			{
				code: "BUDGET_EXCEEDED",
				description: "Token or runtime budget was exceeded during the session",
				severity: "warning",
				remediation: "Consider increasing the debug session budget or optimizing evidence collection",
			},
			{
				code: "DUP_SESSION",
				description: "A duplicate debug session was detected and suppressed",
				severity: "info",
				remediation: "Verify that the failure signature is new or wait for the dedup window to expire",
			},
		],
		dependencies: ["evidence-summarizer", "root-cause-analyzer"],
		supportsStreaming: false,
		supportsCancellation: true,
	};
}

// ---------------------------------------------------------------------------
// Debugger Worker
// ---------------------------------------------------------------------------

/**
 * Orchestrates debug sessions: evidence collection, root cause analysis,
 * and diagnostic production.
 *
 * Features:
 * - Session lifecycle management (create, collect, analyze, conclude)
 * - Budget enforcement (tokens, runtime, consecutive failures)
 * - Deduplication by failure signature hash
 * - Evidence-backed diagnostics on all failures
 * - Worker manifest generation for lifecycle integration
 */
export class DebuggerWorker {
	private config: DebuggerWorkerConfig;
	private sessions: Map<string, DebugSession>;
	private dedupHistory: Map<string, number>; // taskHash -> timestamp
	private consecutiveFailures: number;
	private totalSessionsCompleted: number;
	private totalSessionsFailed: number;
	private totalTokensConsumed: number;
	private summarizer: EvidenceSummarizer;
	private analyzer: RootCauseAnalyzer;

	/**
	 * Create a new DebuggerWorker.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<DebuggerWorkerConfig>) {
		this.config = {
			maxTokensPerSession: config?.maxTokensPerSession ?? DEFAULT_DEBUGGER_WORKER_CONFIG.maxTokensPerSession,
			maxRuntimeMsPerSession:
				config?.maxRuntimeMsPerSession ?? DEFAULT_DEBUGGER_WORKER_CONFIG.maxRuntimeMsPerSession,
			maxConsecutiveFailures:
				config?.maxConsecutiveFailures ?? DEFAULT_DEBUGGER_WORKER_CONFIG.maxConsecutiveFailures,
			cooldownMs: config?.cooldownMs ?? DEFAULT_DEBUGGER_WORKER_CONFIG.cooldownMs,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_DEBUGGER_WORKER_CONFIG.dedupWindowMs,
			dedupEnabled: config?.dedupEnabled ?? DEFAULT_DEBUGGER_WORKER_CONFIG.dedupEnabled,
			summarizerConfig: {
				...DEFAULT_DEBUGGER_WORKER_CONFIG.summarizerConfig,
				...config?.summarizerConfig,
			},
			analyzerConfig: {
				...DEFAULT_DEBUGGER_WORKER_CONFIG.analyzerConfig,
				...config?.analyzerConfig,
			},
		};

		this.sessions = new Map();
		this.dedupHistory = new Map();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.summarizer = new EvidenceSummarizer(this.config.summarizerConfig);
		this.analyzer = new RootCauseAnalyzer(this.config.analyzerConfig);
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the worker configuration.
	 */
	setConfig(config: Partial<DebuggerWorkerConfig>): void {
		if (config.maxTokensPerSession !== undefined) this.config.maxTokensPerSession = config.maxTokensPerSession;
		if (config.maxRuntimeMsPerSession !== undefined)
			this.config.maxRuntimeMsPerSession = config.maxRuntimeMsPerSession;
		if (config.maxConsecutiveFailures !== undefined)
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		if (config.cooldownMs !== undefined) this.config.cooldownMs = config.cooldownMs;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
		if (config.dedupEnabled !== undefined) this.config.dedupEnabled = config.dedupEnabled;
		if (config.summarizerConfig !== undefined) {
			this.config.summarizerConfig = { ...this.config.summarizerConfig, ...config.summarizerConfig };
			this.summarizer.setConfig(this.config.summarizerConfig);
		}
		if (config.analyzerConfig !== undefined) {
			this.config.analyzerConfig = { ...this.config.analyzerConfig, ...config.analyzerConfig };
			this.analyzer.setConfig(this.config.analyzerConfig);
		}
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): DebuggerWorkerConfig {
		return {
			...this.config,
			summarizerConfig: { ...this.config.summarizerConfig },
			analyzerConfig: { ...this.config.analyzerConfig },
		};
	}

	// -----------------------------------------------------------------------
	// Manifest Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate a WorkerManifest for this debugger worker instance.
	 *
	 * The manifest allows the debugger to register with the lifecycle
	 * engine and the supervisor for job routing.
	 *
	 * @param name - Human-readable name for this worker instance.
	 * @param description - Description of this worker instance.
	 * @param overrides - Optional manifest overrides.
	 * @returns A WorkerManifest configured for the debugger role.
	 */
	generateManifest(
		name: string,
		description: string,
		overrides?: Partial<
			Omit<WorkerManifest, "id" | "role" | "name" | "description" | "contract" | "budget" | "dedupConfig">
		>,
	): WorkerManifest {
		return createWorkerManifest({
			role: "diagnostician",
			name,
			description,
			contract: createDebuggerContract(),
			...overrides,
		});
	}

	// -----------------------------------------------------------------------
	// Session Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Create a new debug session.
	 *
	 * Performs dedup check against recent sessions with the same
	 * failure signature. Returns null if a duplicate is detected
	 * within the dedup window.
	 *
	 * @param label - Human-readable label for this session.
	 * @param metadata - Optional session metadata.
	 * @param taskHash - Optional content hash for deduplication.
	 * @param traceId - Optional trace ID for observability linkage.
	 * @param correlationId - Optional correlation ID for grouping.
	 * @returns The created DebugSession, or null if deduped.
	 */
	createSession(
		label: string,
		metadata?: Record<string, unknown>,
		taskHash?: string,
		traceId?: string,
		correlationId?: string,
	): DebugSession | null {
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

		const session: DebugSession = {
			id: randomUUID(),
			status: "pending",
			label,
			createdAt: now,
			updatedAt: now,
			tokensConsumed: 0,
			runtimeMs: 0,
			evidenceSummary: null,
			rootCauseAnalysis: null,
			diagnostic: null,
			error: null,
			traceId: traceId ?? null,
			correlationId: correlationId ?? null,
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
	 * Start evidence collection for a session.
	 *
	 * Transitions the session from pending to collecting status.
	 *
	 * @param sessionId - The session ID to start.
	 * @returns The updated session, or null if not found.
	 */
	startCollection(sessionId: string): DebugSession | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "pending") return null;

		session.status = "collecting";
		session.updatedAt = new Date().toISOString();
		return session;
	}

	/**
	 * Add evidence to a session and to the internal summarizer.
	 *
	 * The session must be in "collecting" status.
	 *
	 * @param sessionId - The session ID.
	 * @param evidence - Evidence item to add.
	 * @returns The stored evidence item, or null if session not found or not in collecting status.
	 */
	addEvidence(
		sessionId: string,
		evidence: Omit<EvidenceItem, "id" | "timestamp"> & { id?: string; timestamp?: string },
	): EvidenceItem | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "collecting") return null;

		const item = this.summarizer.addEvidence(evidence);
		session.updatedAt = new Date().toISOString();
		return item;
	}

	/**
	 * Add multiple evidence items at once.
	 *
	 * @param sessionId - The session ID.
	 * @param items - Array of evidence items to add.
	 * @returns Number of items added, or -1 if session not found or not collecting.
	 */
	addEvidenceBatch(
		sessionId: string,
		items: Array<Omit<EvidenceItem, "id" | "timestamp"> & { id?: string; timestamp?: string }>,
	): number {
		const session = this.sessions.get(sessionId);
		if (!session) return -1;
		if (session.status !== "collecting") return -1;

		const count = this.summarizer.addEvidenceBatch(items);
		session.updatedAt = new Date().toISOString();
		return count;
	}

	/**
	 * Run root cause analysis on the collected evidence.
	 *
	 * Transitions the session from collecting to analyzing, builds the
	 * evidence summary, and runs the root cause analyzer.
	 *
	 * Budget enforcement:
	 * - Tokens consumed are tracked against maxTokensPerSession.
	 * - Runtime is tracked against maxRuntimeMsPerSession.
	 *
	 * @param sessionId - The session ID to analyze.
	 * @param tokensConsumed - Number of tokens consumed during collection/analysis.
	 * @param runtimeMs - Runtime in milliseconds for the analysis.
	 * @returns The root cause analysis result, or null if session not found.
	 */
	analyze(sessionId: string, tokensConsumed: number = 0, runtimeMs: number = 0): RootCauseAnalysis | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "collecting") return null;

		// Check token budget
		session.tokensConsumed += tokensConsumed;
		if (session.tokensConsumed > this.config.maxTokensPerSession) {
			return this.failSession(
				sessionId,
				"Token budget exceeded",
				createWorkerDiagnostic(
					"token_budget_exhausted",
					`Debug session exceeded token budget: ${session.tokensConsumed} > ${this.config.maxTokensPerSession}`,
					{
						sessionId,
						tokensConsumed: session.tokensConsumed,
						maxTokensPerSession: this.config.maxTokensPerSession,
					},
					[`debugger://sessions/${sessionId}`],
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
					`Debug session exceeded runtime budget: ${session.runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms`,
					{
						sessionId,
						runtimeMs: session.runtimeMs,
						maxRuntimeMsPerSession: this.config.maxRuntimeMsPerSession,
					},
					[`debugger://sessions/${sessionId}`],
				),
			);
		}

		session.status = "analyzing";
		session.updatedAt = new Date().toISOString();

		try {
			// Build evidence summary
			const evidenceSummary = this.summarizer.buildSummary(sessionId);

			// Run root cause analysis
			const analysis = this.analyzer.analyze(evidenceSummary);

			// Update session
			session.evidenceSummary = evidenceSummary;
			session.rootCauseAnalysis = analysis;
			session.status = "completed";
			session.updatedAt = new Date().toISOString();
			session.runtimeMs += runtimeMs;

			this.totalSessionsCompleted++;
			this.consecutiveFailures = 0;
			this.totalTokensConsumed += tokensConsumed;

			return analysis;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Root cause analysis failed: ${errorMessage}`,
				{
					sessionId,
					tokensConsumed: session.tokensConsumed,
					runtimeMs: session.runtimeMs,
				},
				[`debugger://sessions/${sessionId}`],
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
	cancelSession(sessionId: string, reason: string): DebugSession | null {
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
	getSession(sessionId: string): DebugSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get all sessions.
	 */
	getAllSessions(): DebugSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get sessions filtered by status.
	 *
	 * @param status - Status to filter by.
	 * @returns Matching sessions, sorted by creation date descending.
	 */
	getSessionsByStatus(status: DebugSessionStatus): DebugSession[] {
		return Array.from(this.sessions.values())
			.filter((s) => s.status === status)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	}

	/**
	 * Clear all sessions and evidence (for testing or reset).
	 */
	clear(): void {
		this.sessions.clear();
		this.dedupHistory.clear();
		this.summarizer.clearEvidence();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
	}

	// -----------------------------------------------------------------------
	// Handoff Emission
	// -----------------------------------------------------------------------

	/**
	 * Emit session findings as a structured result bundle suitable
	 * for handoff inbox consumption.
	 *
	 * The debugger worker is read-only: it collects evidence, analyzes
	 * root causes, and emits findings without modifying execution state.
	 * Callers (supervisor, handoff queue) consume the returned bundle
	 * to route diagnostics to downstream workers.
	 *
	 * @param sessionId - The session ID to emit findings for.
	 * @returns A handoff result bundle, or null if the session does not exist.
	 */
	emitFindings(sessionId: string): DebuggerHandoffResult | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;

		return {
			sessionId: session.id,
			label: session.label,
			status: session.status,
			traceId: session.traceId,
			correlationId: session.correlationId,
			rootCauseAnalysis: session.rootCauseAnalysis,
			evidenceSummary: session.evidenceSummary,
			diagnostic: session.diagnostic,
			error: session.error,
			workerStats: this.getStats(),
			emittedAt: new Date().toISOString(),
		};
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
	 * @returns null (for convenience in callers that return the analysis result).
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
	 * 2. Overall health status
	 *
	 * @returns A diagnostic if the worker is unhealthy, or null if healthy.
	 */
	checkHealth(): WorkerDiagnostic | null {
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			return createWorkerDiagnostic(
				"consecutive_failures_exceeded",
				`Debugger worker has ${this.consecutiveFailures} consecutive failures (max: ${this.config.maxConsecutiveFailures})`,
				{
					consecutiveFailures: this.consecutiveFailures,
					maxConsecutiveFailures: this.config.maxConsecutiveFailures,
					totalSessionsCompleted: this.totalSessionsCompleted,
					totalSessionsFailed: this.totalSessionsFailed,
				},
				["debugger://health"],
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
	getStats(): DebuggerWorkerStats {
		const allSessions = Array.from(this.sessions.values());
		const completed = allSessions.filter((s) => s.status === "completed");
		const failed = allSessions.filter((s) => s.status === "failed");
		const cancelled = allSessions.filter((s) => s.status === "cancelled");
		const pending = allSessions.filter(
			(s) => s.status === "pending" || s.status === "collecting" || s.status === "analyzing",
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
			healthStatus: this.getHealthStatus(),
			dedupHistorySize: this.dedupHistory.size,
		};
	}

	// -----------------------------------------------------------------------
	// Dedup Management
	// -----------------------------------------------------------------------

	/**
	 * Compute a deterministic content hash for deduplication from a
	 * failure signature.
	 *
	 * @param failureSignature - String describing the failure.
	 * @returns SHA-256 hex hash.
	 */
	computeTaskHash(failureSignature: string): string {
		return createHash("sha256").update(failureSignature).digest("hex");
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
	// Summarizer / Analyzer Access
	// -----------------------------------------------------------------------

	/**
	 * Get the internal EvidenceSummarizer instance.
	 */
	getSummarizer(): EvidenceSummarizer {
		return this.summarizer;
	}

	/**
	 * Get the internal RootCauseAnalyzer instance.
	 */
	getAnalyzer(): RootCauseAnalyzer {
		return this.analyzer;
	}
}

// ---------------------------------------------------------------------------
// Debugger Worker Stats
// ---------------------------------------------------------------------------

/**
 * Result bundle emitted for handoff inbox consumption.
 *
 * Contains the session identity, root cause analysis findings,
 * evidence summary, trace identifiers, and a snapshot of worker
 * stats at the time of emission.
 */
export interface DebuggerHandoffResult {
	sessionId: string;
	label: string;
	status: DebugSessionStatus;
	traceId: string | null;
	correlationId: string | null;
	rootCauseAnalysis: RootCauseAnalysis | null;
	evidenceSummary: EvidenceSummary | null;
	diagnostic: WorkerDiagnostic | null;
	error: string | null;
	workerStats: DebuggerWorkerStats;
	emittedAt: string;
}

/**
 * Runtime statistics for the DebuggerWorker.
 */
export interface DebuggerWorkerStats {
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
	healthStatus: "healthy" | "degraded" | "unhealthy";
	dedupHistorySize: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a DebuggerWorker with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new DebuggerWorker instance.
 */
export function createDebuggerWorker(config?: Partial<DebuggerWorkerConfig>): DebuggerWorker {
	return new DebuggerWorker(config);
}
