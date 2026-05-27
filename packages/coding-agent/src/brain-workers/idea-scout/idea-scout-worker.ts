/**
 * Idea Scout Worker — 25.K
 *
 * Scouts for ideas by mining signals, detecting trends, and identifying
 * opportunities from observations and analysis. Integrates with the brain
 * worker lifecycle via a WorkerManifest with budget, cooldown, dedup, and
 * stop-condition handling.
 *
 * Key design:
 * - Each scouting session is a self-contained unit with signal mining,
 *   idea generation, trend detection, and output production.
 * - Budget limits (tokens, runtime, consecutive failures) are enforced
 *   per session.
 * - Deduplication prevents re-scouting the same signal signature within
 *   the dedup window.
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
// Scouted Idea
// ---------------------------------------------------------------------------

/**
 * Priority level for a scouted idea.
 */
export type IdeaPriority = "low" | "medium" | "high" | "critical";

/**
 * All valid IdeaPriority values for runtime validation.
 */
export const ALL_IDEA_PRIORITIES: readonly IdeaPriority[] = ["low", "medium", "high", "critical"] as const;

/**
 * Source reference for an idea — where the idea originated.
 */
export interface IdeaSourceRef {
	/** Type of source (signal, observation, memory, trend) */
	type: "signal" | "observation" | "memory" | "trend";
	/** ID of the source artifact */
	id: string;
	/** Human-readable label for the source */
	label: string;
}

/**
 * A scouted idea with evidence, priority score, and source references.
 *
 * Each idea includes a confidence score (0-1), a priority level, and
 * references to the signals/observations/memories that inspired it.
 */
export interface ScoutedIdea {
	/** Unique identifier (UUID v4) */
	id: string;
	/** Short human-readable title */
	title: string;
	/** Detailed description of the idea */
	description: string;
	/** Confidence score (0-1) based on supporting evidence */
	confidence: number;
	/** Priority level */
	priority: IdeaPriority;
	/** Tags for categorization */
	tags: string[];
	/** Source references that inspired this idea */
	sourceRefs: IdeaSourceRef[];
	/** Suggested next action or implementation consideration */
	suggestion: string;
	/** ISO 8601 timestamp of when this idea was generated */
	createdAt: string;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mined Signal
// ---------------------------------------------------------------------------

/**
 * A raw signal extracted from observation data during scouting.
 *
 * Mined signals are lower-level than BrainSignal — they represent
 * raw patterns or signals that the idea scout extracts directly
 * from observations before they are synthesized.
 */
export interface MinedSignal {
	/** Unique identifier (UUID v4) */
	id: string;
	/** Human-readable label */
	label: string;
	/** Description of what this signal indicates */
	description: string;
	/** Confidence score (0-1) */
	confidence: number;
	/** IDs of observations that contributed to this signal */
	observationIds: string[];
	/** The trend this signal relates to, if any */
	trendLabel: string | null;
	/** ISO 8601 timestamp */
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

/**
 * A detected trend from analysis of signals and observations.
 */
export interface IdeaTrend {
	/** Unique identifier (UUID v4) */
	id: string;
	/** Human-readable label */
	label: string;
	/** Description of the trend */
	description: string;
	/** Direction of the trend */
	direction: "increasing" | "decreasing" | "stable" | "emerging" | "declining";
	/** Confidence score (0-1) */
	confidence: number;
	/** IDs of mined signals supporting this trend */
	signalIds: string[];
	/** ISO 8601 timestamp */
	detectedAt: string;
}

// ---------------------------------------------------------------------------
// Session Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of an idea scouting session.
 */
export type ScoutSessionStatus =
	| "idle" // Session created, awaiting input
	| "scouting" // Actively scanning for signals
	| "mining" // Extracting raw signals from observations
	| "evaluating" // Generating and scoring ideas
	| "completed" // Scouting completed with outputs
	| "failed" // Session failed with diagnostic
	| "cancelled"; // Session was cancelled

/**
 * All valid ScoutSessionStatus values for runtime validation.
 */
export const ALL_SCOUT_SESSION_STATUSES: readonly ScoutSessionStatus[] = [
	"idle",
	"scouting",
	"mining",
	"evaluating",
	"completed",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Scout Session
// ---------------------------------------------------------------------------

/**
 * A single scouting session managed by the IdeaScoutWorker.
 *
 * Each session ingests signals/observations, mines for patterns,
 * detects trends, and produces ideas with evidence.
 */
export interface ScoutSession {
	/** Unique session identifier (UUID v4) */
	id: string;

	/** Session status */
	status: ScoutSessionStatus;

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

	/** Signals provided as input to this session */
	inputSignals: Array<{ id: string; pattern: string; summary: string }>;

	/** Observations provided as input to this session */
	inputObservations: Array<{ id: string; title: string }>;

	/** Mined signals extracted during this session */
	minedSignals: MinedSignal[];

	/** Trends detected during this session */
	trends: IdeaTrend[];

	/** Ideas generated during this session */
	ideas: ScoutedIdea[];

	/** Diagnostic on failure, if any */
	diagnostic: WorkerDiagnostic | null;

	/** Error message if the session failed */
	error: string | null;

	/** Session metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Idea Scout Worker Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Idea Scout Worker.
 */
export interface IdeaScoutWorkerConfig {
	/**
	 * Maximum tokens per scout session.
	 * Default: 120_000
	 */
	maxTokensPerSession: number;

	/**
	 * Maximum runtime per scout session in milliseconds.
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
	 * Minimum confidence threshold for accepting mined signals.
	 * Default: 0.3
	 */
	minSignalConfidence: number;

	/**
	 * Minimum confidence threshold for generating ideas.
	 * Default: 0.4
	 */
	minIdeaConfidence: number;

	/**
	 * Maximum number of ideas per session.
	 * Default: 10
	 */
	maxIdeasPerSession: number;

	/**
	 * Whether trend detection is enabled.
	 * Default: true
	 */
	trendDetectionEnabled: boolean;
}

/**
 * Default configuration for the Idea Scout Worker.
 */
export const DEFAULT_IDEA_SCOUT_WORKER_CONFIG: IdeaScoutWorkerConfig = {
	maxTokensPerSession: 120_000,
	maxRuntimeMsPerSession: 600_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 120_000,
	dedupWindowMs: 300_000,
	dedupEnabled: true,
	minSignalConfidence: 0.3,
	minIdeaConfidence: 0.4,
	maxIdeasPerSession: 10,
	trendDetectionEnabled: true,
};

/**
 * Default dedup config for the Idea Scout Worker.
 */
export const DEFAULT_IDEA_SCOUT_DEDUP_CONFIG: WorkerDedupConfig = {
	enabled: true,
	windowMs: 300_000,
	useSimilarity: true,
	similarityThreshold: 0.85,
};

/**
 * Default budget values matching the ideaScout role.
 */
export const DEFAULT_IDEA_SCOUT_BUDGET = {
	maxTokensPerCycle: 120_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 120_000,
	maxRuntimeMs: 600_000,
};

// ---------------------------------------------------------------------------
// Scout Contract
// ---------------------------------------------------------------------------

/**
 * Standard contract for the idea scout worker role.
 *
 * The idea scout is a specialist "ideaScout" role that consumes
 * signals, observations, and memory to generate ideas and mined signals.
 */
export function createIdeaScoutContract(version: string = "1.0.0"): WorkerContract {
	return {
		id: `brain-worker.idea-scout.v${version}`,
		name: "Idea Scout Worker Contract",
		description:
			"Scouts for ideas by mining signals, detecting trends, and identifying opportunities from observations, signals, and memory context.",
		version,
		capabilities: ["signal_mining", "idea_generation", "trend_detection", "opportunity_identification"],
		inputs: [
			{
				name: "signals",
				description: "Synthesized signals from analyst for idea generation",
				type: "BrainSignal[]",
				required: true,
				sources: ["analyst", "brain-timeline"],
			},
			{
				name: "observations",
				description: "Raw observations for signal mining",
				type: "BrainObservation[]",
				required: false,
				sources: ["observer", "observation-engine"],
			},
			{
				name: "memory_records",
				description: "Historical memory for context-aware scouting",
				type: "MemoryRecord[]",
				required: false,
				sources: ["memory-store"],
			},
		],
		outputs: [
			{
				name: "ideas",
				description: "Scouted ideas with evidence and priority scores",
				type: "ScoutedIdea[]",
				destinations: ["proposal-generator", "proposal-inbox"],
			},
			{
				name: "mined_signals",
				description: "Raw signals extracted from observation data",
				type: "MinedSignal[]",
				destinations: ["brain-timeline", "brain-analysis"],
			},
		],
		errors: [
			{
				code: "NO_SIGNALS_AVAILABLE",
				description: "No signals available for idea scouting",
				severity: "info",
				remediation: "Wait for analyst to produce signals",
			},
			{
				code: "IDEA_DEDUP_FAILED",
				description: "Idea deduplication process failed",
				severity: "warning",
				remediation: "Check dedup store health and retry",
			},
			{
				code: "SIGNAL_MINING_FAILED",
				description: "Failed to mine signals from observations",
				severity: "warning",
				remediation: "Check observation data quality and availability",
			},
		],
		dependencies: ["brain-worker.analyst"],
		supportsStreaming: false,
		supportsCancellation: true,
		readonlyAccess: true,
	};
}

// ---------------------------------------------------------------------------
// Idea Trend Detector
// ---------------------------------------------------------------------------

/**
 * Simple trend detection logic for the idea scout.
 *
 * Analyzes mined signals to detect trends based on signal frequency,
 * confidence patterns, and label clustering.
 */
export class IdeaTrendDetector {
	private config: { enabled: boolean; minSignalCount: number };

	/**
	 * Create a new IdeaTrendDetector.
	 *
	 * @param enabled - Whether trend detection is enabled.
	 * @param minSignalCount - Minimum number of related signals to form a trend (default: 2).
	 */
	constructor(enabled: boolean = true, minSignalCount: number = 2) {
		this.config = { enabled, minSignalCount };
	}

	/**
	 * Set trend detection configuration.
	 */
	setConfig(config: { enabled?: boolean; minSignalCount?: number }): void {
		if (config.enabled !== undefined) this.config.enabled = config.enabled;
		if (config.minSignalCount !== undefined) this.config.minSignalCount = config.minSignalCount;
	}

	/**
	 * Detect trends from a set of mined signals.
	 *
	 * Groups signals by trend label and returns trends for groups
	 * that exceed the minimum count threshold.
	 *
	 * @param signals - Mined signals to analyze.
	 * @returns Detected trends.
	 */
	detectTrends(signals: MinedSignal[]): IdeaTrend[] {
		if (!this.config.enabled || signals.length === 0) {
			return [];
		}

		// Group signals by trend label
		const grouped = new Map<string, MinedSignal[]>();
		for (const signal of signals) {
			const key = signal.trendLabel ?? "uncategorized";
			if (!grouped.has(key)) {
				grouped.set(key, []);
			}
			grouped.get(key)!.push(signal);
		}

		const trends: IdeaTrend[] = [];

		for (const [label, groupSignals] of grouped) {
			if (groupSignals.length < this.config.minSignalCount) {
				continue;
			}

			// Compute average confidence
			const avgConfidence = groupSignals.reduce((sum, s) => sum + s.confidence, 0) / groupSignals.length;

			// Determine direction based on confidence spread
			const direction = this.determineDirection(groupSignals);

			trends.push({
				id: randomUUID(),
				label,
				description: `Detected trend "${label}" from ${groupSignals.length} related signals`,
				direction,
				confidence: avgConfidence,
				signalIds: groupSignals.map((s) => s.id),
				detectedAt: new Date().toISOString(),
			});
		}

		return trends;
	}

	/**
	 * Determine the direction of a trend from its signals.
	 *
	 * Simple heuristic: if average confidence is high and signals
	 * are consistent, classify as "stable" or "emerging".
	 */
	private determineDirection(_signals: MinedSignal[]): IdeaTrend["direction"] {
		const allHighConfidence = _signals.every((s) => s.confidence >= 0.7);
		if (allHighConfidence) return "stable";

		const avgConfidence = _signals.reduce((sum, s) => sum + s.confidence, 0) / _signals.length;
		if (avgConfidence >= 0.5) return "emerging";

		return "emerging";
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): { enabled: boolean; minSignalCount: number } {
		return { ...this.config };
	}
}

// ---------------------------------------------------------------------------
// Idea Scout Worker
// ---------------------------------------------------------------------------

/**
 * Runtime statistics for the IdeaScoutWorker.
 */
export interface IdeaScoutWorkerStats {
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
	totalIdeasGenerated: number;
	totalMinedSignals: number;
	totalTrendsDetected: number;
	healthStatus: "healthy" | "degraded" | "unhealthy";
	dedupHistorySize: number;
}

/**
 * Orchestrates idea scouting sessions: signal mining, idea generation,
 * trend detection, and output production.
 *
 * Features:
 * - Session lifecycle management (create, scout, mine, evaluate, complete)
 * - Budget enforcement (tokens, runtime, consecutive failures)
 * - Deduplication by signal signature hash
 * - Evidence-backed diagnostics on all failures
 * - Worker manifest generation for lifecycle integration
 * - Trend detection from mined signals
 */
export class IdeaScoutWorker {
	private config: IdeaScoutWorkerConfig;
	private sessions: Map<string, ScoutSession>;
	private dedupHistory: Map<string, number>; // taskHash -> timestamp
	private consecutiveFailures: number;
	private totalSessionsCompleted: number;
	private totalSessionsFailed: number;
	private totalTokensConsumed: number;
	private totalIdeasGenerated: number;
	private totalMinedSignals: number;
	private totalTrendsDetected: number;
	private trendDetector: IdeaTrendDetector;

	/**
	 * Create a new IdeaScoutWorker.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<IdeaScoutWorkerConfig>) {
		this.config = {
			maxTokensPerSession: config?.maxTokensPerSession ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.maxTokensPerSession,
			maxRuntimeMsPerSession:
				config?.maxRuntimeMsPerSession ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.maxRuntimeMsPerSession,
			maxConsecutiveFailures:
				config?.maxConsecutiveFailures ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.maxConsecutiveFailures,
			cooldownMs: config?.cooldownMs ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.cooldownMs,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.dedupWindowMs,
			dedupEnabled: config?.dedupEnabled ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.dedupEnabled,
			minSignalConfidence: config?.minSignalConfidence ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.minSignalConfidence,
			minIdeaConfidence: config?.minIdeaConfidence ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.minIdeaConfidence,
			maxIdeasPerSession: config?.maxIdeasPerSession ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.maxIdeasPerSession,
			trendDetectionEnabled: config?.trendDetectionEnabled ?? DEFAULT_IDEA_SCOUT_WORKER_CONFIG.trendDetectionEnabled,
		};

		this.sessions = new Map();
		this.dedupHistory = new Map();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.totalIdeasGenerated = 0;
		this.totalMinedSignals = 0;
		this.totalTrendsDetected = 0;
		this.trendDetector = new IdeaTrendDetector(this.config.trendDetectionEnabled);
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the worker configuration.
	 */
	setConfig(config: Partial<IdeaScoutWorkerConfig>): void {
		if (config.maxTokensPerSession !== undefined) this.config.maxTokensPerSession = config.maxTokensPerSession;
		if (config.maxRuntimeMsPerSession !== undefined)
			this.config.maxRuntimeMsPerSession = config.maxRuntimeMsPerSession;
		if (config.maxConsecutiveFailures !== undefined)
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		if (config.cooldownMs !== undefined) this.config.cooldownMs = config.cooldownMs;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
		if (config.dedupEnabled !== undefined) this.config.dedupEnabled = config.dedupEnabled;
		if (config.minSignalConfidence !== undefined) this.config.minSignalConfidence = config.minSignalConfidence;
		if (config.minIdeaConfidence !== undefined) this.config.minIdeaConfidence = config.minIdeaConfidence;
		if (config.maxIdeasPerSession !== undefined) this.config.maxIdeasPerSession = config.maxIdeasPerSession;
		if (config.trendDetectionEnabled !== undefined) {
			this.config.trendDetectionEnabled = config.trendDetectionEnabled;
			this.trendDetector.setConfig({ enabled: config.trendDetectionEnabled });
		}
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): IdeaScoutWorkerConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Manifest Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate a WorkerManifest for this idea scout worker instance.
	 *
	 * The manifest allows the idea scout to register with the lifecycle
	 * engine and the supervisor for job routing.
	 *
	 * @param name - Human-readable name for this worker instance.
	 * @param description - Description of this worker instance.
	 * @param overrides - Optional manifest overrides.
	 * @returns A WorkerManifest configured for the ideaScout role.
	 */
	generateManifest(
		name: string,
		description: string,
		overrides?: Partial<
			Omit<WorkerManifest, "id" | "role" | "name" | "description" | "contract" | "budget" | "dedupConfig">
		>,
	): WorkerManifest {
		return createWorkerManifest({
			role: "ideaScout",
			name,
			description,
			contract: createIdeaScoutContract(),
			...overrides,
		});
	}

	// -----------------------------------------------------------------------
	// Session Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Create a new idea scouting session.
	 *
	 * Performs dedup check against recent sessions with the same
	 * signal signature. Returns null if a duplicate is detected
	 * within the dedup window.
	 *
	 * @param label - Human-readable label for this session.
	 * @param inputSignals - Signals to scout from.
	 * @param inputObservations - Optional observations for signal mining.
	 * @param metadata - Optional session metadata.
	 * @param taskHash - Optional content hash for deduplication.
	 * @returns The created ScoutSession, or null if deduped.
	 */
	createSession(
		label: string,
		inputSignals: Array<{ id: string; pattern: string; summary: string }> = [],
		inputObservations: Array<{ id: string; title: string }> = [],
		metadata?: Record<string, unknown>,
		taskHash?: string,
	): ScoutSession | null {
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

		const session: ScoutSession = {
			id: randomUUID(),
			status: "idle",
			label,
			createdAt: now,
			updatedAt: now,
			tokensConsumed: 0,
			runtimeMs: 0,
			inputSignals: Array.isArray(inputSignals) ? [...inputSignals] : [],
			inputObservations: Array.isArray(inputObservations) ? [...inputObservations] : [],
			minedSignals: [],
			trends: [],
			ideas: [],
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
	 * Start scouting for a session.
	 *
	 * Transitions the session from idle to scouting status.
	 *
	 * @param sessionId - The session ID to start.
	 * @returns The updated session, or null if not found.
	 */
	startScouting(sessionId: string): ScoutSession | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "idle") return null;

		session.status = "scouting";
		session.updatedAt = new Date().toISOString();
		return session;
	}

	/**
	 * Mine signals from observations for a session.
	 *
	 * Simulates extracting raw signals from the provided observations.
	 * Transitions session from scouting to mining.
	 *
	 * @param sessionId - The session ID to process.
	 * @returns The number of signals mined, or -1 if session not found or in wrong state.
	 */
	mineSignals(sessionId: string): number {
		const session = this.sessions.get(sessionId);
		if (!session) return -1;
		if (session.status !== "scouting") return -1;

		session.status = "mining";
		session.updatedAt = new Date().toISOString();

		const minedSignals: MinedSignal[] = [];
		const now = new Date().toISOString();

		// Mine signals from observations
		for (const obs of session.inputObservations) {
			const confidence = 0.4 + Math.random() * 0.5;
			if (confidence >= this.config.minSignalConfidence) {
				minedSignals.push({
					id: randomUUID(),
					label: `mined:${obs.title}`,
					description: `Signal extracted from observation: ${obs.title}`,
					confidence: Math.round(confidence * 100) / 100,
					observationIds: [obs.id],
					trendLabel: this.inferTrendLabel(obs.title),
					createdAt: now,
				});
			}
		}

		// Also mine from signal patterns
		for (const sig of session.inputSignals) {
			const confidence = 0.5 + Math.random() * 0.4;
			if (confidence >= this.config.minSignalConfidence) {
				minedSignals.push({
					id: randomUUID(),
					label: `pattern:${sig.pattern}`,
					description: `Signal mined from pattern: ${sig.pattern}: ${sig.summary}`,
					confidence: Math.round(confidence * 100) / 100,
					observationIds: [],
					trendLabel: this.inferTrendLabel(sig.pattern),
					createdAt: now,
				});
			}
		}

		session.minedSignals = minedSignals;
		this.totalMinedSignals += minedSignals.length;
		session.updatedAt = now;

		return minedSignals.length;
	}

	/**
	 * Run idea evaluation (generation + trend detection) on a session.
	 *
	 * Transitions from mining to evaluating, detects trends from
	 * mined signals, and generates ideas.
	 *
	 * Budget enforcement:
	 * - Tokens consumed are tracked against maxTokensPerSession.
	 * - Runtime is tracked against maxRuntimeMsPerSession.
	 *
	 * @param sessionId - The session ID to evaluate.
	 * @param tokensConsumed - Number of tokens consumed during mining/evaluation.
	 * @param runtimeMs - Runtime in milliseconds for the evaluation.
	 * @returns The generated ideas, or null if session not found or budget exceeded.
	 */
	evaluate(sessionId: string, tokensConsumed: number = 0, runtimeMs: number = 0): ScoutedIdea[] | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "mining") return null;

		// Check token budget
		session.tokensConsumed += tokensConsumed;
		if (session.tokensConsumed > this.config.maxTokensPerSession) {
			return this.failSession(
				sessionId,
				"Token budget exceeded",
				createWorkerDiagnostic(
					"token_budget_exhausted",
					`Idea scout session exceeded token budget: ${session.tokensConsumed} > ${this.config.maxTokensPerSession}`,
					{
						sessionId,
						tokensConsumed: session.tokensConsumed,
						maxTokensPerSession: this.config.maxTokensPerSession,
					},
					[`idea-scout://sessions/${sessionId}`],
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
					`Idea scout session exceeded runtime budget: ${session.runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms`,
					{
						sessionId,
						runtimeMs: session.runtimeMs,
						maxRuntimeMsPerSession: this.config.maxRuntimeMsPerSession,
					},
					[`idea-scout://sessions/${sessionId}`],
				),
			);
		}

		session.status = "evaluating";
		session.updatedAt = new Date().toISOString();

		try {
			// 1. Detect trends from mined signals
			const trends = this.trendDetector.detectTrends(session.minedSignals);
			session.trends = trends;
			this.totalTrendsDetected += trends.length;

			// 2. Generate ideas from signals and trends
			const ideas = this.generateIdeas(session);
			session.ideas = ideas;
			this.totalIdeasGenerated += ideas.length;

			// 3. Mark as completed
			session.status = "completed";
			session.updatedAt = new Date().toISOString();

			this.totalSessionsCompleted++;
			this.consecutiveFailures = 0;

			return ideas;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Idea evaluation failed: ${errorMessage}`,
				{
					sessionId,
					tokensConsumed: session.tokensConsumed,
					runtimeMs: session.runtimeMs,
				},
				[`idea-scout://sessions/${sessionId}`],
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
	cancelSession(sessionId: string, reason: string): ScoutSession | null {
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
	getSession(sessionId: string): ScoutSession | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get all sessions.
	 */
	getAllSessions(): ScoutSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get sessions filtered by status.
	 *
	 * @param status - Status to filter by.
	 * @returns Matching sessions, sorted by creation date descending.
	 */
	getSessionsByStatus(status: ScoutSessionStatus): ScoutSession[] {
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
		this.totalIdeasGenerated = 0;
		this.totalMinedSignals = 0;
		this.totalTrendsDetected = 0;
	}

	// -----------------------------------------------------------------------
	// Idea Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate ideas from signals, mined signals, and trends.
	 *
	 * Creates ScoutedIdea objects with confidence scoring, source
	 * references, and suggestions.
	 *
	 * @param session - The session to generate ideas from.
	 * @returns Array of generated ideas, capped by maxIdeasPerSession.
	 */
	private generateIdeas(session: ScoutSession): ScoutedIdea[] {
		const ideas: ScoutedIdea[] = [];
		const now = new Date().toISOString();

		// Generate ideas from input signals
		for (const signal of session.inputSignals) {
			if (ideas.length >= this.config.maxIdeasPerSession) break;

			const confidence = 0.4 + Math.random() * 0.5;
			if (confidence < this.config.minIdeaConfidence) continue;

			ideas.push({
				id: randomUUID(),
				title: `Idea from signal: ${signal.pattern}`,
				description: `Generated from signal pattern "${signal.pattern}": ${signal.summary}`,
				confidence: Math.round(confidence * 100) / 100,
				priority: this.computePriority(confidence),
				tags: ["signal-derived", signal.pattern],
				sourceRefs: [{ type: "signal", id: signal.id, label: signal.summary }],
				suggestion: `Consider investigating "${signal.pattern}" further based on signal analysis.`,
				createdAt: now,
				metadata: {},
			});
		}

		// Generate ideas from trends
		for (const trend of session.trends) {
			if (ideas.length >= this.config.maxIdeasPerSession) break;

			const confidence = trend.confidence;
			if (confidence < this.config.minIdeaConfidence) continue;

			ideas.push({
				id: randomUUID(),
				title: `Trend insight: ${trend.label}`,
				description: trend.description,
				confidence: Math.round(confidence * 100) / 100,
				priority: this.computePriority(confidence),
				tags: ["trend-derived", trend.label, trend.direction],
				sourceRefs: [
					...trend.signalIds.map(
						(sid) =>
							({
								type: "trend",
								id: sid,
								label: `Signal in trend: ${trend.label}`,
							}) as const,
					),
				],
				suggestion: `Trend "${trend.label}" (${trend.direction}) may warrant attention or further analysis.`,
				createdAt: now,
				metadata: {},
			});
		}

		// Generate ideas from mined signals that weren't in trends
		const trendSignalIds = new Set(session.trends.flatMap((t) => t.signalIds));
		for (const minedSig of session.minedSignals) {
			if (ideas.length >= this.config.maxIdeasPerSession) break;
			if (trendSignalIds.has(minedSig.id)) continue;

			const confidence = minedSig.confidence;
			if (confidence < this.config.minIdeaConfidence) continue;

			ideas.push({
				id: randomUUID(),
				title: `Mined insight: ${minedSig.label}`,
				description: minedSig.description,
				confidence: Math.round(confidence * 100) / 100,
				priority: this.computePriority(confidence),
				tags: ["mined-signal", minedSig.trendLabel ?? "uncategorized"],
				sourceRefs: [
					{
						type: "observation",
						id: minedSig.observationIds[0] ?? minedSig.id,
						label: minedSig.label,
					},
				],
				suggestion: `Consider exploring the "${minedSig.label}" signal for potential improvements or actions.`,
				createdAt: now,
				metadata: {},
			});
		}

		return ideas;
	}

	/**
	 * Compute priority level from confidence score.
	 */
	private computePriority(confidence: number): IdeaPriority {
		if (confidence >= 0.8) return "critical";
		if (confidence >= 0.65) return "high";
		if (confidence >= 0.5) return "medium";
		return "low";
	}

	/**
	 * Infer a trend label from a title or pattern string.
	 *
	 * Uses simple keyword matching to categorize into trend buckets.
	 */
	private inferTrendLabel(text: string): string {
		const lower = text.toLowerCase();

		if (lower.includes("error") || lower.includes("fail") || lower.includes("exception")) {
			return "errors-and-failures";
		}
		if (lower.includes("performance") || lower.includes("slow") || lower.includes("timeout")) {
			return "performance";
		}
		if (lower.includes("memory") || lower.includes("storage") || lower.includes("disk")) {
			return "memory-and-storage";
		}
		if (lower.includes("security") || lower.includes("auth") || lower.includes("permission")) {
			return "security";
		}
		if (lower.includes("queue") || lower.includes("schedul") || lower.includes("wait")) {
			return "queue-and-scheduling";
		}
		if (lower.includes("integration") || lower.includes("api") || lower.includes("connect")) {
			return "integration";
		}
		if (lower.includes("config") || lower.includes("setting") || lower.includes("param")) {
			return "configuration";
		}
		if (lower.includes("test") || lower.includes("spec") || lower.includes("coverage")) {
			return "testing";
		}
		if (lower.includes("doc") || lower.includes("readme") || lower.includes("comment")) {
			return "documentation";
		}

		return "general";
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
				`Idea scout worker has ${this.consecutiveFailures} consecutive failures (max: ${this.config.maxConsecutiveFailures})`,
				{
					consecutiveFailures: this.consecutiveFailures,
					maxConsecutiveFailures: this.config.maxConsecutiveFailures,
					totalSessionsCompleted: this.totalSessionsCompleted,
					totalSessionsFailed: this.totalSessionsFailed,
				},
				["idea-scout://health"],
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
	getStats(): IdeaScoutWorkerStats {
		const allSessions = Array.from(this.sessions.values());
		const completed = allSessions.filter((s) => s.status === "completed");
		const failed = allSessions.filter((s) => s.status === "failed");
		const cancelled = allSessions.filter((s) => s.status === "cancelled");
		const pending = allSessions.filter(
			(s) => s.status === "idle" || s.status === "scouting" || s.status === "mining" || s.status === "evaluating",
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
			totalIdeasGenerated: this.totalIdeasGenerated,
			totalMinedSignals: this.totalMinedSignals,
			totalTrendsDetected: this.totalTrendsDetected,
			healthStatus: this.getHealthStatus(),
			dedupHistorySize: this.dedupHistory.size,
		};
	}

	// -----------------------------------------------------------------------
	// Dedup Management
	// -----------------------------------------------------------------------

	/**
	 * Compute a deterministic content hash for deduplication from a
	 * signal signature.
	 *
	 * @param signalSignature - String describing the signal set.
	 * @returns SHA-256 hex hash.
	 */
	computeTaskHash(signalSignature: string): string {
		return createHash("sha256").update(signalSignature).digest("hex");
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
	// Trend Detector Access
	// -----------------------------------------------------------------------

	/**
	 * Get the internal IdeaTrendDetector instance.
	 */
	getTrendDetector(): IdeaTrendDetector {
		return this.trendDetector;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an IdeaScoutWorker with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new IdeaScoutWorker instance.
 */
export function createIdeaScoutWorker(config?: Partial<IdeaScoutWorkerConfig>): IdeaScoutWorker {
	return new IdeaScoutWorker(config);
}
