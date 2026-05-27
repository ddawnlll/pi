/**
 * Regression Hunter Worker — 25.L
 *
 * Detects regressions by comparing current outputs, metrics, or behavior
 * against known-good baselines. Produces structured regression findings
 * with evidence chains, severity ratings, and remediation suggestions.
 *
 * Key design:
 * - Each regression hunt is a self-contained session with comparison
 *   and analysis phases.
 * - Budget limits (tokens, runtime, consecutive failures) are enforced
 *   per session.
 * - Deduplication prevents re-hunting the same regression signature
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
import {
	DEFAULT_FAILURE_CLUSTERER_CONFIG,
	type FailureCluster,
	FailureClusterer,
	type FailureClustererConfig,
} from "./failure-clusterer.js";
import {
	DEFAULT_FLAKY_TEST_DETECTOR_CONFIG,
	FlakyTestDetector,
	type FlakyTestDetectorConfig,
	type FlakyTestFinding,
} from "./flaky-test-detector.js";

// ---------------------------------------------------------------------------
// Regression Types
// ---------------------------------------------------------------------------

/**
 * Category of a detected regression.
 */
export type RegressionType =
	| "functional" // Output differs from expected
	| "performance" // Performance metrics degraded
	| "structural" // Code structure changed unexpectedly
	| "type" // Type errors introduced
	| "contract" // API contract violations
	| "visual" // Visual/cosmetic differences
	| "unknown"; // Unclassified

/**
 * All valid RegressionType values for runtime validation.
 */
export const ALL_REGRESSION_TYPES: readonly RegressionType[] = [
	"functional",
	"performance",
	"structural",
	"type",
	"contract",
	"visual",
	"unknown",
] as const;

/**
 * Human-readable labels for each regression type.
 */
export const REGRESSION_TYPE_LABELS: Record<RegressionType, string> = {
	functional: "Functional",
	performance: "Performance",
	structural: "Structural",
	type: "Type",
	contract: "Contract",
	visual: "Visual",
	unknown: "Unknown",
};

// ---------------------------------------------------------------------------
// Regression Severity
// ---------------------------------------------------------------------------

/**
 * Severity of a detected regression.
 */
export type RegressionSeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * All valid RegressionSeverity values for runtime validation.
 */
export const ALL_REGRESSION_SEVERITIES: readonly RegressionSeverity[] = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
] as const;

/**
 * Human-readable labels for each severity level.
 */
export const REGRESSION_SEVERITY_LABELS: Record<RegressionSeverity, string> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
	info: "Info",
};

// ---------------------------------------------------------------------------
// Baseline & Comparison Data
// ---------------------------------------------------------------------------

/**
 * Baseline reference data representing the known-good state.
 *
 * A baseline captures expected outputs, metrics, or structure that
 * current results are compared against to detect regressions.
 */
export interface BaselineSnapshot {
	/** Unique identifier for this baseline */
	id: string;
	/** Human-readable label for this baseline */
	label: string;
	/** Source or origin of the baseline (e.g., "commit:abc123", "release:v1.2.3") */
	source: string;
	/** ISO 8601 timestamp when the baseline was captured */
	capturedAt: string;
	/** Key-value pairs of baseline metrics or expectations */
	metrics: Record<string, number | string | boolean>;
	/** Structured expectations for comparison (e.g., output shape, types, contracts) */
	expectations: Array<{
		path: string;
		expected: unknown;
		description: string;
	}>;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

/**
 * Current data snapshot to compare against a baseline.
 *
 * Represents the current state being evaluated for regressions.
 */
export interface CurrentSnapshot {
	/** Unique identifier for this snapshot */
	id: string;
	/** Human-readable label for this snapshot */
	label: string;
	/** Source or origin (e.g., "commit:def456", "branch:feature/foo") */
	source: string;
	/** ISO 8601 timestamp when the snapshot was captured */
	capturedAt: string;
	/** Key-value pairs of current metrics */
	metrics: Record<string, number | string | boolean>;
	/** Structured current values for comparison */
	values: Array<{
		path: string;
		value: unknown;
		description: string;
	}>;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Regression Finding
// ---------------------------------------------------------------------------

/**
 * A single regression finding with evidence chain.
 *
 * Each finding links back to the specific baseline expectation and
 * current value that produced the delta.
 */
export interface RegressionFinding {
	/** Unique finding identifier (UUID v4) */
	id: string;
	/** Category of regression */
	type: RegressionType;
	/** Severity of the regression */
	severity: RegressionSeverity;
	/** Human-readable title for this finding */
	label: string;
	/** Detailed description of the discrepancy */
	description: string;
	/** The path in the comparison data where this regression was found */
	path: string;
	/** The expected (baseline) value */
	expectedValue: string;
	/** The actual (current) value */
	actualValue: string;
	/** Human-readable delta description */
	delta: string;
	/** Confidence score 0-1 for this finding */
	confidence: number;
	/** References to source artifacts that support this finding */
	evidenceRefs: string[];
	/** Suggested remediation, if known */
	suggestedFix?: string;
	/** File path where the regression was detected, if applicable */
	filePath?: string;
	/** Line number where the regression was detected, if applicable */
	lineNumber?: number;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Regression Analysis
// ---------------------------------------------------------------------------

/**
 * The complete result of a regression hunt session.
 *
 * Contains all findings, summary statistics, and diagnostics
 * produced by comparing current data against a baseline.
 */
export interface RegressionAnalysis {
	/** The baseline snapshot used for comparison */
	baseline: BaselineSnapshot;
	/** The current snapshot compared */
	current: CurrentSnapshot;
	/** All identified regression findings */
	findings: RegressionFinding[];
	/** Number of regressions by severity */
	summary: {
		total: number;
		critical: number;
		high: number;
		medium: number;
		low: number;
		info: number;
	};
	/** Number of regressions by type */
	byType: Partial<Record<RegressionType, number>>;
	/** Overall verdict: true if regressions were found */
	hasRegressions: boolean;
	/** Overall change ratio (0 = no change, 1 = completely different) */
	changeRatio: number;
	/** ISO 8601 timestamp when the analysis was completed */
	completedAt: string;
}

// ---------------------------------------------------------------------------
// Regression Session Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a regression hunt session.
 */
export type RegressionSessionStatus =
	| "pending" // Session created, awaiting data
	| "comparing" // Comparison in progress
	| "analyzing" // Analyzing deltas for regressions
	| "completed" // Analysis completed with findings
	| "failed" // Session failed with diagnostic
	| "cancelled"; // Session was cancelled

/**
 * All valid RegressionSessionStatus values for runtime validation.
 */
export const ALL_REGRESSION_SESSION_STATUSES: readonly RegressionSessionStatus[] = [
	"pending",
	"comparing",
	"analyzing",
	"completed",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Regression Session
// ---------------------------------------------------------------------------

/**
 * A single regression hunt session managed by the RegressionHunterWorker.
 *
 * Each session ingests a baseline and current snapshot, performs
 * comparison, and produces regression findings with evidence chains.
 */
export interface RegressionSession {
	/** Unique session identifier (UUID v4) */
	id: string;
	/** Session status */
	status: RegressionSessionStatus;
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
	/** Baseline snapshot (set before compare phase) */
	baseline: BaselineSnapshot | null;
	/** Current snapshot (set before compare phase) */
	current: CurrentSnapshot | null;
	/** Regression analysis (set after analysis phase) */
	analysis: RegressionAnalysis | null;
	/** Diagnostic on failure, if any */
	diagnostic: WorkerDiagnostic | null;
	/** Error message if the session failed */
	error: string | null;
	/** Session metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Regression Hunter Worker Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Regression Hunter Worker.
 */
export interface RegressionHunterConfig {
	/**
	 * Maximum tokens per regression session.
	 * Default: 150_000
	 */
	maxTokensPerSession: number;

	/**
	 * Maximum runtime per regression session in milliseconds.
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
	 * Minimum confidence threshold for reporting findings.
	 * Range: 0-1. Default: 0.3.
	 */
	minConfidence: number;

	/**
	 * Whether to flag missing baseline expectations as potential regressions.
	 * Default: true.
	 */
	flagMissingExpectations: boolean;

	/**
	 * Whether to flag new (unexpected) values as potential regressions.
	 * Default: true.
	 */
	flagNewValues: boolean;

	/**
	 * Failure clusterer configuration.
	 * Accepts partial config; missing values use defaults.
	 */
	failureClustererConfig: Partial<FailureClustererConfig>;

	/**
	 * Flaky test detector configuration.
	 * Accepts partial config; missing values use defaults.
	 */
	flakyTestDetectorConfig: Partial<FlakyTestDetectorConfig>;

	/**
	 * Maximum number of findings to report per session.
	 * Default: 100.
	 */
	maxFindings: number;

	/**
	 * Types of regressions to detect. Empty array means all types.
	 * Default: [] (all types).
	 */
	enabledTypes: RegressionType[];
}

/**
 * Default configuration for the Regression Hunter Worker.
 */
export const DEFAULT_REGRESSION_HUNTER_CONFIG: RegressionHunterConfig = {
	maxTokensPerSession: 150_000,
	maxRuntimeMsPerSession: 600_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 120_000,
	dedupWindowMs: 300_000,
	dedupEnabled: true,
	minConfidence: 0.3,
	flagMissingExpectations: true,
	flagNewValues: true,
	maxFindings: 100,
	enabledTypes: [],
	failureClustererConfig: { ...DEFAULT_FAILURE_CLUSTERER_CONFIG },
	flakyTestDetectorConfig: { ...DEFAULT_FLAKY_TEST_DETECTOR_CONFIG },
};

/**
 * Default dedup config for the Regression Hunter Worker.
 */
export const DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG: WorkerDedupConfig = {
	enabled: true,
	windowMs: 300_000,
	useSimilarity: true,
	similarityThreshold: 0.85,
};

/**
 * Default regression hunter worker budget values.
 */
export const DEFAULT_REGRESSION_HUNTER_BUDGET = {
	maxTokensPerCycle: 150_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 120_000,
	maxRuntimeMs: 600_000,
};

// ---------------------------------------------------------------------------
// Regression Hunter Contract
// ---------------------------------------------------------------------------

/**
 * Standard contract for the regression hunter worker role.
 *
 * The regression hunter worker is a specialist "regressionHunter" role
 * that consumes baseline and current snapshots and produces regression
 * analyses with evidence chains and remediation suggestions.
 */
export function createRegressionHunterContract(version: string = "1.0.0"): WorkerContract {
	return {
		id: `brain-worker.regressionHunter.v${version}`,
		name: "Regression Hunter Worker Contract",
		description:
			"Compares current outputs, metrics, and behavior against known-good baselines to detect regressions, producing structured findings with severity ratings, evidence chains, and remediation suggestions.",
		version,
		capabilities: [
			"compare_baselines",
			"detect_regressions",
			"classify_severity",
			"produce_findings",
			"evidence_chain_tracing",
		],
		inputs: [
			{
				name: "baseline_snapshot",
				description: "Known-good baseline reference data",
				type: "BaselineSnapshot",
				required: true,
				sources: ["baseline-store", "test-runner", "ci-pipeline"],
			},
			{
				name: "current_snapshot",
				description: "Current data to compare against the baseline",
				type: "CurrentSnapshot",
				required: true,
				sources: ["test-runner", "ci-pipeline", "build-system"],
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
				name: "regression_analysis",
				description: "Full regression analysis with findings and evidence chains",
				type: "RegressionAnalysis",
				destinations: ["supervisor", "plan-executor", "remediation-engine"],
			},
			{
				name: "diagnostic_report",
				description: "Evidence-backed diagnostic report on failures",
				type: "WorkerDiagnostic",
				destinations: ["worker-lifecycle", "observability"],
			},
		],
		errors: [
			{
				code: "NO_BASELINE",
				description: "No baseline snapshot was provided for comparison",
				severity: "warning",
				remediation:
					"Ensure a baseline snapshot is captured and provided before starting a regression hunt session",
			},
			{
				code: "NO_CURRENT_DATA",
				description: "No current snapshot was provided for comparison",
				severity: "warning",
				remediation: "Ensure current data is collected and provided before starting a regression hunt session",
			},
			{
				code: "ANALYSIS_FAILED",
				description: "Regression analysis failed unexpectedly",
				severity: "critical",
				remediation: "Check the comparison data for consistency and retry the analysis",
			},
			{
				code: "BUDGET_EXCEEDED",
				description: "Token or runtime budget was exceeded during the session",
				severity: "warning",
				remediation: "Consider increasing the regression hunt budget or reducing the scope of comparison",
			},
			{
				code: "DUP_SESSION",
				description: "A duplicate regression hunt session was detected and suppressed",
				severity: "info",
				remediation: "Verify that the regression signature is new or wait for the dedup window to expire",
			},
			{
				code: "TOO_MANY_FINDINGS",
				description: "Number of findings exceeded maxFindings limit",
				severity: "info",
				remediation: "Increase maxFindings or narrow the comparison scope",
			},
		],
		dependencies: ["baseline-store"],
		supportsStreaming: false,
		supportsCancellation: true,
		readonlyAccess: true,
	};
}

// ---------------------------------------------------------------------------
// Regression Hunter Worker
// ---------------------------------------------------------------------------

/**
 * Worker stats for the Regression Hunter.
 */
export interface RegressionHunterWorkerStats {
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
	totalRegressionsFound: number;
	healthStatus: "healthy" | "degraded" | "unhealthy";
	dedupHistorySize: number;
}

/**
 * Orchestrates regression hunt sessions: baseline comparison, delta
 * analysis, and finding production.
 *
 * Features:
 * - Session lifecycle management (create, compare, analyze, conclude)
 * - Budget enforcement (tokens, runtime, consecutive failures)
 * - Deduplication by regression signature hash
 * - Evidence-backed diagnostics on all failures
 * - Worker manifest generation for lifecycle integration
 */
export class RegressionHunterWorker {
	private config: RegressionHunterConfig;
	private sessions: Map<string, RegressionSession>;
	private dedupHistory: Map<string, number>; // taskHash -> timestamp
	private consecutiveFailures: number;
	private totalSessionsCompleted: number;
	private totalSessionsFailed: number;
	private totalTokensConsumed: number;
	private totalRegressionsFound: number;
	private failureClusterer: FailureClusterer;
	private flakyTestDetector: FlakyTestDetector;

	/**
	 * Create a new RegressionHunterWorker.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<RegressionHunterConfig>) {
		this.config = {
			maxTokensPerSession: config?.maxTokensPerSession ?? DEFAULT_REGRESSION_HUNTER_CONFIG.maxTokensPerSession,
			maxRuntimeMsPerSession:
				config?.maxRuntimeMsPerSession ?? DEFAULT_REGRESSION_HUNTER_CONFIG.maxRuntimeMsPerSession,
			maxConsecutiveFailures:
				config?.maxConsecutiveFailures ?? DEFAULT_REGRESSION_HUNTER_CONFIG.maxConsecutiveFailures,
			cooldownMs: config?.cooldownMs ?? DEFAULT_REGRESSION_HUNTER_CONFIG.cooldownMs,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_REGRESSION_HUNTER_CONFIG.dedupWindowMs,
			dedupEnabled: config?.dedupEnabled ?? DEFAULT_REGRESSION_HUNTER_CONFIG.dedupEnabled,
			minConfidence: config?.minConfidence ?? DEFAULT_REGRESSION_HUNTER_CONFIG.minConfidence,
			flagMissingExpectations:
				config?.flagMissingExpectations ?? DEFAULT_REGRESSION_HUNTER_CONFIG.flagMissingExpectations,
			flagNewValues: config?.flagNewValues ?? DEFAULT_REGRESSION_HUNTER_CONFIG.flagNewValues,
			maxFindings: config?.maxFindings ?? DEFAULT_REGRESSION_HUNTER_CONFIG.maxFindings,
			enabledTypes: config?.enabledTypes ?? [...DEFAULT_REGRESSION_HUNTER_CONFIG.enabledTypes],
			failureClustererConfig: {
				...DEFAULT_FAILURE_CLUSTERER_CONFIG,
				...config?.failureClustererConfig,
			},
			flakyTestDetectorConfig: {
				...DEFAULT_FLAKY_TEST_DETECTOR_CONFIG,
				...config?.flakyTestDetectorConfig,
			},
		};

		this.sessions = new Map();
		this.dedupHistory = new Map();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.totalRegressionsFound = 0;
		this.failureClusterer = new FailureClusterer(this.config.failureClustererConfig);
		this.flakyTestDetector = new FlakyTestDetector(this.config.flakyTestDetectorConfig);
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the worker configuration.
	 */
	setConfig(config: Partial<RegressionHunterConfig>): void {
		if (config.maxTokensPerSession !== undefined) this.config.maxTokensPerSession = config.maxTokensPerSession;
		if (config.maxRuntimeMsPerSession !== undefined)
			this.config.maxRuntimeMsPerSession = config.maxRuntimeMsPerSession;
		if (config.maxConsecutiveFailures !== undefined)
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		if (config.cooldownMs !== undefined) this.config.cooldownMs = config.cooldownMs;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
		if (config.dedupEnabled !== undefined) this.config.dedupEnabled = config.dedupEnabled;
		if (config.minConfidence !== undefined) this.config.minConfidence = config.minConfidence;
		if (config.flagMissingExpectations !== undefined)
			this.config.flagMissingExpectations = config.flagMissingExpectations;
		if (config.flagNewValues !== undefined) this.config.flagNewValues = config.flagNewValues;
		if (config.maxFindings !== undefined) this.config.maxFindings = config.maxFindings;
		if (config.enabledTypes !== undefined) this.config.enabledTypes = [...config.enabledTypes];
		if (config.failureClustererConfig !== undefined) {
			this.config.failureClustererConfig = {
				...this.config.failureClustererConfig,
				...config.failureClustererConfig,
			};
			this.failureClusterer.setConfig(this.config.failureClustererConfig);
		}
		if (config.flakyTestDetectorConfig !== undefined) {
			this.config.flakyTestDetectorConfig = {
				...this.config.flakyTestDetectorConfig,
				...config.flakyTestDetectorConfig,
			};
			this.flakyTestDetector.setConfig(this.config.flakyTestDetectorConfig);
		}
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): RegressionHunterConfig {
		return {
			...this.config,
			enabledTypes: [...this.config.enabledTypes],
			failureClustererConfig: { ...this.config.failureClustererConfig },
			flakyTestDetectorConfig: { ...this.config.flakyTestDetectorConfig },
		};
	}

	// -----------------------------------------------------------------------
	// Manifest Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate a WorkerManifest for this regression hunter worker instance.
	 *
	 * The manifest allows the worker to register with the lifecycle
	 * engine and the supervisor for job routing.
	 *
	 * @param name - Human-readable name for this worker instance.
	 * @param description - Description of this worker instance.
	 * @param overrides - Optional manifest overrides.
	 * @returns A WorkerManifest configured for the regression hunter role.
	 */
	generateManifest(
		name: string,
		description: string,
		overrides?: Partial<
			Omit<WorkerManifest, "id" | "role" | "name" | "description" | "contract" | "budget" | "dedupConfig">
		>,
	): WorkerManifest {
		return createWorkerManifest({
			role: "regressionHunter",
			name,
			description,
			contract: createRegressionHunterContract(),
			...overrides,
		});
	}

	// -----------------------------------------------------------------------
	// Session Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Create a new regression hunt session.
	 *
	 * Performs dedup check against recent sessions with the same
	 * regression signature. Returns null if a duplicate is detected
	 * within the dedup window.
	 *
	 * @param label - Human-readable label for this session.
	 * @param metadata - Optional session metadata.
	 * @param taskHash - Optional content hash for deduplication.
	 * @returns The created RegressionSession, or null if deduped.
	 */
	createSession(label: string, metadata?: Record<string, unknown>, taskHash?: string): RegressionSession | null {
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

		const session: RegressionSession = {
			id: randomUUID(),
			status: "pending",
			label,
			createdAt: now,
			updatedAt: now,
			tokensConsumed: 0,
			runtimeMs: 0,
			baseline: null,
			current: null,
			analysis: null,
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
	 * Set baseline and current data for a session and transition to comparing.
	 *
	 * @param sessionId - The session ID.
	 * @param baseline - Baseline snapshot to compare against.
	 * @param current - Current snapshot to evaluate.
	 * @returns The updated session, or null if not found or not pending.
	 */
	startComparison(sessionId: string, baseline: BaselineSnapshot, current: CurrentSnapshot): RegressionSession | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "pending") return null;

		session.baseline = baseline;
		session.current = current;
		session.status = "comparing";
		session.updatedAt = new Date().toISOString();
		return session;
	}

	/**
	 * Run the full regression analysis: compare baseline to current,
	 * detect regressions, classify severity, produce findings.
	 *
	 * Transitions the session from comparing to analyzing, performs
	 * the comparison, and transitions to completed with findings.
	 *
	 * Budget enforcement:
	 * - Tokens consumed are tracked against maxTokensPerSession.
	 * - Runtime is tracked against maxRuntimeMsPerSession.
	 *
	 * @param sessionId - The session ID to analyze.
	 * @param tokensConsumed - Number of tokens consumed during comparison/analysis.
	 * @param runtimeMs - Runtime in milliseconds for the analysis.
	 * @returns The RegressionAnalysis result, or null if session not found.
	 */
	analyze(sessionId: string, tokensConsumed: number = 0, runtimeMs: number = 0): RegressionAnalysis | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "comparing") return null;

		// Check token budget
		session.tokensConsumed += tokensConsumed;
		if (session.tokensConsumed > this.config.maxTokensPerSession) {
			return this.failSession(
				sessionId,
				"Token budget exceeded",
				createWorkerDiagnostic(
					"token_budget_exhausted",
					`Regression session exceeded token budget: ${session.tokensConsumed} > ${this.config.maxTokensPerSession}`,
					{
						sessionId,
						tokensConsumed: session.tokensConsumed,
						maxTokensPerSession: this.config.maxTokensPerSession,
					},
					[`regression-hunter://sessions/${sessionId}`],
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
					`Regression session exceeded runtime budget: ${session.runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms`,
					{
						sessionId,
						runtimeMs: session.runtimeMs,
						maxRuntimeMsPerSession: this.config.maxRuntimeMsPerSession,
					},
					[`regression-hunter://sessions/${sessionId}`],
				),
			);
		}

		// Validate baseline and current data exist
		if (!session.baseline || !session.current) {
			const missing = !session.baseline ? "baseline" : "current";
			return this.failSession(
				sessionId,
				`Missing ${missing} data for comparison`,
				createWorkerDiagnostic(
					"dependency_unavailable",
					`Cannot perform regression analysis: ${missing} data is null`,
					{
						sessionId,
						hasBaseline: !!session.baseline,
						hasCurrent: !!session.current,
					},
					[`regression-hunter://sessions/${sessionId}`],
				),
			);
		}

		session.status = "analyzing";
		session.updatedAt = new Date().toISOString();

		try {
			// Perform comparison and generate findings
			const analysis = this.performComparison(session.baseline, session.current);

			// Update session
			session.analysis = analysis;
			session.status = "completed";
			session.updatedAt = new Date().toISOString();
			session.runtimeMs += runtimeMs;

			this.totalSessionsCompleted++;
			this.consecutiveFailures = 0;
			this.totalTokensConsumed += tokensConsumed;
			this.totalRegressionsFound += analysis.findings.length;

			return analysis;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Regression analysis failed: ${errorMessage}`,
				{
					sessionId,
					tokensConsumed: session.tokensConsumed,
					runtimeMs: session.runtimeMs,
				},
				[`regression-hunter://sessions/${sessionId}`],
				errorMessage,
			);
			this.failSession(sessionId, errorMessage, diagnostic);
			return null;
		}
	}

	/**
	 * Perform the actual comparison between baseline and current data.
	 *
	 * Compares expectations to values, matches metrics, and generates
	 * findings for each detected regression.
	 *
	 * @param baseline - The baseline snapshot.
	 * @param current - The current snapshot.
	 * @returns A RegressionAnalysis with all findings.
	 */
	private performComparison(baseline: BaselineSnapshot, current: CurrentSnapshot): RegressionAnalysis {
		const findings: RegressionFinding[] = [];

		// --- Compare expectations vs values ---

		// Build a map of current values by path for quick lookup
		const currentValuesByPath = new Map<string, (typeof current.values)[0]>();
		for (const v of current.values) {
			currentValuesByPath.set(v.path, v);
		}

		// Check each baseline expectation
		for (const expectation of baseline.expectations) {
			const currentValue = currentValuesByPath.get(expectation.path);

			if (currentValue === undefined) {
				// Missing expectation in current data — potential regression
				if (!this.config.flagMissingExpectations) continue;

				const finding = this.createFinding({
					type: "functional",
					severity: "high",
					label: `Missing expected value: ${expectation.path}`,
					description: `Expected value at path "${expectation.path}" was not found in current snapshot. This may indicate a missing feature or structural change.`,
					path: expectation.path,
					expectedValue: String(expectation.expected),
					actualValue: "<missing>",
					delta: `Expected "${expectation.path}" but it was not present in the current snapshot`,
					confidence: 0.8,
					evidenceRefs: [`baseline://expectations/${expectation.path}`, `current://missing/${expectation.path}`],
					metadata: {
						expectationDescription: expectation.description,
					},
				});

				findings.push(finding);
				continue;
			}

			// Compare values
			const expected = expectation.expected;
			const actual = currentValue.value;

			if (!this.valuesEqual(expected, actual)) {
				const finding = this.createFindingFromDelta({
					path: expectation.path,
					expected,
					actual,
					description: expectation.description,
					baseline,
				});

				if (finding) {
					findings.push(finding);
				}
			}
		}

		// --- Detect new values not in baseline ---
		if (this.config.flagNewValues) {
			const baselinePaths = new Set(baseline.expectations.map((e) => e.path));

			for (const val of current.values) {
				if (!baselinePaths.has(val.path)) {
					const finding = this.createFinding({
						type: "functional",
						severity: "low",
						label: `New value found: ${val.path}`,
						description: `Path "${val.path}" exists in current snapshot but has no baseline expectation. This may be a new feature or an unintended addition.`,
						path: val.path,
						expectedValue: "<no baseline>",
						actualValue: String(val.value),
						delta: `New value "${val.path}" = ${String(val.value)} was not present in the baseline`,
						confidence: 0.3,
						evidenceRefs: [`current://values/${val.path}`, `baseline://missing/${val.path}`],
						metadata: {
							valueDescription: val.description,
						},
					});

					findings.push(finding);
				}
			}
		}

		// --- Compare metrics ---
		for (const [metricKey, expectedMetric] of Object.entries(baseline.metrics)) {
			const actualMetric = current.metrics[metricKey];

			if (actualMetric === undefined) {
				if (!this.config.flagMissingExpectations) continue;

				const finding = this.createFinding({
					type: "performance",
					severity: "medium",
					label: `Missing metric: ${metricKey}`,
					path: `metrics.${metricKey}`,
					expectedValue: String(expectedMetric),
					actualValue: "<missing>",
					delta: `Metric "${metricKey}" was present in baseline but missing from current snapshot`,
					confidence: 0.7,
					description: `Baseline metric "${metricKey}" = ${String(expectedMetric)} was not found in the current snapshot.`,
					evidenceRefs: [`baseline://metrics/${metricKey}`, `current://missing/metrics/${metricKey}`],
					metadata: {},
				});

				findings.push(finding);
				continue;
			}

			if (!this.valuesEqual(expectedMetric, actualMetric)) {
				// Determine regression type based on metric key heuristics
				const type = this.inferMetricType(metricKey);

				const finding = this.createFinding({
					type,
					severity: this.inferMetricSeverity(metricKey, expectedMetric, actualMetric),
					label: `Metric changed: ${metricKey}`,
					path: `metrics.${metricKey}`,
					expectedValue: String(expectedMetric),
					actualValue: String(actualMetric),
					delta: `Changed from ${String(expectedMetric)} to ${String(actualMetric)}`,
					confidence: 0.9,
					description: `Metric "${metricKey}" changed from ${String(expectedMetric)} to ${String(actualMetric)}.`,
					evidenceRefs: [`baseline://metrics/${metricKey}`, `current://metrics/${metricKey}`],
					metadata: {
						baselineMetric: expectedMetric,
						currentMetric: actualMetric,
					},
				});

				findings.push(finding);
			}
		}

		// Sort findings by severity (critical first)
		const severityOrder: Record<RegressionSeverity, number> = {
			critical: 0,
			high: 1,
			medium: 2,
			low: 3,
			info: 4,
		};
		findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

		// Enforce maxFindings limit
		const truncatedFindings = findings.slice(0, this.config.maxFindings);

		// Compute summary
		const summary = {
			total: truncatedFindings.length,
			critical: truncatedFindings.filter((f) => f.severity === "critical").length,
			high: truncatedFindings.filter((f) => f.severity === "high").length,
			medium: truncatedFindings.filter((f) => f.severity === "medium").length,
			low: truncatedFindings.filter((f) => f.severity === "low").length,
			info: truncatedFindings.filter((f) => f.severity === "info").length,
		};

		// Compute by type counts
		const byType: Partial<Record<RegressionType, number>> = {};
		for (const finding of truncatedFindings) {
			byType[finding.type] = (byType[finding.type] || 0) + 1;
		}

		// Compute change ratio
		const totalComparisons = baseline.expectations.length + Object.keys(baseline.metrics).length;
		const changedCount = truncatedFindings.length;
		const changeRatio = totalComparisons > 0 ? Math.min(changedCount / totalComparisons, 1) : 0;

		return {
			baseline,
			current,
			findings: truncatedFindings,
			summary,
			byType,
			hasRegressions: truncatedFindings.length > 0,
			changeRatio,
			completedAt: new Date().toISOString(),
		};
	}

	/**
	 * Deep-compare two values for equality.
	 */
	private valuesEqual(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		if (a == null || b == null) return a === b;

		if (typeof a !== typeof b) return false;

		if (typeof a === "object" && typeof b === "object") {
			return JSON.stringify(a) === JSON.stringify(b);
		}

		return a === b;
	}

	/**
	 * Create a regression finding from a value delta.
	 */
	private createFindingFromDelta(params: {
		path: string;
		expected: unknown;
		actual: unknown;
		description: string;
		baseline: BaselineSnapshot;
	}): RegressionFinding | null {
		const { path, expected, actual, description, baseline } = params;

		const deltaDesc = this.describeDelta(expected, actual);
		const type = this.inferTypeFromDelta(expected, actual, path);
		const severity = this.inferSeverityFromDelta(expected, actual, type, path);

		const confidence = this.computeConfidence(expected, actual, type);

		if (confidence < this.config.minConfidence) {
			return null; // Below confidence threshold
		}

		return this.createFinding({
			type,
			severity,
			label: `Regression at ${path}: ${deltaDesc.short}`,
			path,
			expectedValue: String(expected),
			actualValue: String(actual),
			delta: deltaDesc.long,
			confidence,
			description: `At path "${path}": ${description}. Expected ${String(expected)} but got ${String(actual)}.`,
			evidenceRefs: [
				`baseline://expectations/${path}`,
				`current://values/${path}`,
				`baseline://snapshots/${baseline.id}`,
			],
			metadata: {
				expected,
				actual,
				path,
			},
		});
	}

	/**
	 * Describe the delta between expected and actual values.
	 */
	private describeDelta(expected: unknown, actual: unknown): { short: string; long: string } {
		if (typeof expected === "number" && typeof actual === "number") {
			const diff = actual - expected;
			const pct = expected !== 0 ? Math.round((diff / expected) * 100) : 0;
			const sign = diff >= 0 ? "+" : "";
			return {
				short: `${String(expected)} -> ${String(actual)} (${sign}${diff}, ${sign}${pct}%)`,
				long: `Value changed from ${String(expected)} to ${String(actual)} (delta: ${sign}${diff}, ${sign}${pct}%)`,
			};
		}

		if (typeof expected === "string" && typeof actual === "string") {
			return {
				short: `"${expected.substring(0, 50)}" -> "${actual.substring(0, 50)}"`,
				long: `String value changed from "${expected}" to "${actual}"`,
			};
		}

		return {
			short: `${String(expected)} -> ${String(actual)}`,
			long: `Value changed from ${JSON.stringify(expected)} to ${JSON.stringify(actual)}`,
		};
	}

	/**
	 * Infer regression type from the nature of the delta.
	 */
	private inferTypeFromDelta(_expected: unknown, _actual: unknown, path: string): RegressionType {
		const pathLower = path.toLowerCase();

		if (pathLower.includes("type") || pathLower.includes("typescript") || pathLower.includes("ts-")) {
			return "type";
		}
		if (
			pathLower.includes("perf") ||
			pathLower.includes("performance") ||
			pathLower.includes("latency") ||
			pathLower.includes("speed")
		) {
			return "performance";
		}
		if (pathLower.includes("contract") || pathLower.includes("interface")) {
			return "contract";
		}
		if (
			pathLower.includes("visual") ||
			pathLower.includes("css") ||
			pathLower.includes("style") ||
			pathLower.includes("ui-")
		) {
			return "visual";
		}
		if (pathLower.includes("struct") || pathLower.includes("shape") || pathLower.includes("schema")) {
			return "structural";
		}

		return "functional";
	}

	/**
	 * Infer severity from the nature of the delta.
	 */
	private inferSeverityFromDelta(
		expected: unknown,
		actual: unknown,
		type: RegressionType,
		_path: string,
	): RegressionSeverity {
		// Type regressions are always at least high
		if (type === "type" || type === "contract") {
			return "high";
		}

		// Numeric regressions can be quantified
		if (typeof expected === "number" && typeof actual === "number") {
			const ratio = expected !== 0 ? Math.abs(actual - expected) / Math.abs(expected) : Math.abs(actual);
			if (ratio > 0.5) return "critical";
			if (ratio > 0.2) return "high";
			if (ratio > 0.1) return "medium";
			return "low";
		}

		if (type === "performance") return "medium";
		if (type === "visual") return "low";

		return "medium";
	}

	/**
	 * Compute confidence score for a finding.
	 */
	private computeConfidence(expected: unknown, actual: unknown, type: RegressionType): number {
		// Exact type mismatches are high confidence
		if (typeof expected !== typeof actual && expected !== null && actual !== null) {
			return 0.95;
		}

		// Numeric deltas are high confidence
		if (typeof expected === "number" && typeof actual === "number") {
			return expected !== 0 ? 0.9 : 0.8;
		}

		// Type/contract regressions are reliable
		if (type === "type" || type === "contract") {
			return 0.85;
		}

		// String deltas are moderate confidence
		if (typeof expected === "string" && typeof actual === "string") {
			return 0.75;
		}

		return 0.6;
	}

	/**
	 * Infer metric type from metric key.
	 */
	private inferMetricType(key: string): RegressionType {
		const k = key.toLowerCase();
		if (k.includes("latency") || k.includes("duration") || k.includes("time") || k.includes("speed")) {
			return "performance";
		}
		if (k.includes("size") || k.includes("count") || k.includes("lines")) {
			return "structural";
		}
		if (k.includes("type") || k.includes("coverage")) {
			return "type";
		}
		return "performance";
	}

	/**
	 * Infer severity for a metric change.
	 */
	private inferMetricSeverity(
		_key: string,
		expected: number | string | boolean,
		actual: number | string | boolean,
	): RegressionSeverity {
		if (typeof expected === "number" && typeof actual === "number") {
			const ratio = expected !== 0 ? Math.abs(actual - expected) / Math.abs(expected) : Math.abs(actual);
			if (ratio > 0.5) return "critical";
			if (ratio > 0.2) return "high";
			if (ratio > 0.1) return "medium";
			return "low";
		}

		if (expected !== actual) return "high";
		return "info";
	}

	/**
	 * Create a RegressionFinding with standard defaults.
	 */
	private createFinding(overrides: {
		type: RegressionType;
		severity: RegressionSeverity;
		label: string;
		path: string;
		expectedValue: string;
		actualValue: string;
		delta: string;
		confidence: number;
		description: string;
		evidenceRefs: string[];
		metadata: Record<string, unknown>;
		suggestedFix?: string;
		filePath?: string;
		lineNumber?: number;
	}): RegressionFinding {
		return {
			id: randomUUID(),
			type: overrides.type,
			severity: overrides.severity,
			label: overrides.label,
			path: overrides.path,
			expectedValue: overrides.expectedValue,
			actualValue: overrides.actualValue,
			delta: overrides.delta,
			confidence: overrides.confidence,
			description: overrides.description,
			evidenceRefs: [...overrides.evidenceRefs],
			metadata: { ...overrides.metadata },
			suggestedFix: overrides.suggestedFix,
			filePath: overrides.filePath,
			lineNumber: overrides.lineNumber,
		};
	}

	/**
	 * Cancel a session.
	 *
	 * @param sessionId - The session ID to cancel.
	 * @param reason - Reason for cancellation.
	 * @returns The updated session, or null if not found.
	 */
	cancelSession(sessionId: string, reason: string): RegressionSession | null {
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
	getSession(sessionId: string): RegressionSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get all sessions.
	 */
	getAllSessions(): RegressionSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get sessions filtered by status.
	 *
	 * @param status - Status to filter by.
	 * @returns Matching sessions, sorted by creation date descending.
	 */
	getSessionsByStatus(status: RegressionSessionStatus): RegressionSession[] {
		return Array.from(this.sessions.values())
			.filter((s) => s.status === status)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	}

	/**
	 * Clear all sessions and history (for testing or reset).
	 */
	clear(): void {
		this.sessions.clear();
		this.dedupHistory.clear();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.totalRegressionsFound = 0;
		this.failureClusterer.clear();
		this.flakyTestDetector.clear();
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
	 * @returns null (for convenience in callers).
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
				`Regression Hunter worker has ${this.consecutiveFailures} consecutive failures (max: ${this.config.maxConsecutiveFailures})`,
				{
					consecutiveFailures: this.consecutiveFailures,
					maxConsecutiveFailures: this.config.maxConsecutiveFailures,
					totalSessionsCompleted: this.totalSessionsCompleted,
					totalSessionsFailed: this.totalSessionsFailed,
				},
				["regression-hunter://health"],
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
	getStats(): RegressionHunterWorkerStats {
		const allSessions = Array.from(this.sessions.values());
		const completed = allSessions.filter((s) => s.status === "completed");
		const failed = allSessions.filter((s) => s.status === "failed");
		const cancelled = allSessions.filter((s) => s.status === "cancelled");
		const pending = allSessions.filter(
			(s) => s.status === "pending" || s.status === "comparing" || s.status === "analyzing",
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
			totalRegressionsFound: this.totalRegressionsFound,
			healthStatus: this.getHealthStatus(),
			dedupHistorySize: this.dedupHistory.size,
		};
	}

	// -----------------------------------------------------------------------
	// Dedup Management
	// -----------------------------------------------------------------------

	/**
	 * Compute a deterministic content hash for deduplication from a
	 * regression signature.
	 *
	 * @param regressionSignature - String describing the regression context.
	 * @returns SHA-256 hex hash.
	 */
	computeTaskHash(regressionSignature: string): string {
		return createHash("sha256").update(regressionSignature).digest("hex");
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
	// Sub-component Access
	// -----------------------------------------------------------------------

	/**
	 * Get the internal FailureClusterer instance.
	 */
	getFailureClusterer(): FailureClusterer {
		return this.failureClusterer;
	}

	/**
	 * Get the internal FlakyTestDetector instance.
	 */
	getFlakyTestDetector(): FlakyTestDetector {
		return this.flakyTestDetector;
	}

	// -----------------------------------------------------------------------
	// Handoff Emission
	// -----------------------------------------------------------------------

	/**
	 * Emit session findings as a structured result bundle suitable
	 * for handoff inbox consumption.
	 *
	 * The regression hunter worker is read-only: it ingests baselines
	 * and current snapshots, compares them, and emits findings without
	 * modifying execution state. Callers (supervisor, handoff queue)
	 * consume the returned bundle to route diagnostics to downstream
	 * workers.
	 *
	 * @param sessionId - The session ID to emit findings for.
	 * @returns A handoff result bundle, or null if the session does not exist.
	 */
	emitFindings(sessionId: string): RegressionHunterHandoffResult | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;

		return {
			sessionId: session.id,
			label: session.label,
			status: session.status,
			baseline: session.baseline,
			current: session.current,
			analysis: session.analysis,
			diagnostic: session.diagnostic,
			error: session.error,
			failureClusters: this.failureClusterer.getAllClusters(),
			flakyTests: this.flakyTestDetector.getAllFindings(),
			workerStats: this.getStats(),
			emittedAt: new Date().toISOString(),
		};
	}
}

// ---------------------------------------------------------------------------
// Handoff Result
// ---------------------------------------------------------------------------

/**
 * Result bundle emitted for handoff inbox consumption.
 *
 * Contains the session identity, regression analysis findings,
 * failure clusters, flaky test results, worker statistics, and
 * trace identifiers at the time of emission.
 */
export interface RegressionHunterHandoffResult {
	sessionId: string;
	label: string;
	status: RegressionSessionStatus;
	baseline: BaselineSnapshot | null;
	current: CurrentSnapshot | null;
	analysis: RegressionAnalysis | null;
	diagnostic: WorkerDiagnostic | null;
	error: string | null;
	failureClusters: FailureCluster[];
	flakyTests: FlakyTestFinding[];
	workerStats: RegressionHunterWorkerStats;
	emittedAt: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RegressionHunterWorker with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new RegressionHunterWorker instance.
 */
export function createRegressionHunterWorker(config?: Partial<RegressionHunterConfig>): RegressionHunterWorker {
	return new RegressionHunterWorker(config);
}
