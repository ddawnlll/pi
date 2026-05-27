/**
 * Fix Strategist Worker — 25.J
 *
 * Analyzes debug evidence to generate fix strategies, patch plans,
 * and test plans for resolving identified issues.
 *
 * The Fix Strategist Worker is a brain worker that:
 * 1. Accepts evidence summaries from the debugger/diagnostician workers
 * 2. Analyzes evidence to identify root causes
 * 3. Generates patch strategies with ranking and risk assessment
 * 4. Generates test plans for fix verification
 * 5. Supports budget/cooldown/dedup/stop-condition handling
 * 6. Surfaces evidence-backed diagnostics on all failures
 *
 * Dependencies:
 * - PatchStrategyGenerator (./patch-strategy.ts) — strategy generation
 * - TestPlanGenerator (./test-plan-generator.ts) — test plan generation
 * - WorkerLifecycleEngine (../lifecycle.ts) — lifecycle management
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import {
	createWorkerDiagnostic,
	DEFAULT_WORKER_DEDUP_CONFIG,
	type WorkerContract,
	type WorkerDedupConfig,
	type WorkerDiagnostic,
	type WorkerStopCondition,
} from "../types.js";
import { type FixRootCauseFinding, type PatchStrategy, PatchStrategyGenerator } from "./patch-strategy.js";
import { type TestPlan, TestPlanGenerator } from "./test-plan-generator.js";

// ---------------------------------------------------------------------------
// Evidence Input — simplified evidence format
// ---------------------------------------------------------------------------

/**
 * A single evidence item for the fix strategist.
 *
 * Represents a piece of debug evidence that the strategist analyzes
 * to generate fix strategies.
 */
export interface FixEvidenceItem {
	/** Human-readable label */
	label: string;

	/** Evidence content (error message, log, etc.) */
	content: string;

	/** Evidence type indicator */
	type?: string;

	/** Confidence level */
	confidence?: string;
}

/**
 * Context about the failure environment.
 */
export interface FailureContext {
	/** Project or workspace path */
	projectPath?: string;

	/** Git branch or commit hash */
	gitRef?: string;

	/** Environment details (OS, Node version, etc.) */
	environment?: Record<string, string>;

	/** Whether the issue is reproducible */
	reproducible?: boolean;

	/** Steps to reproduce (free text) */
	reproductionSteps?: string;

	/** Whether the fix should be eligible for autonomous execution */
	allowAutonomous?: boolean;
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a fix strategist analysis session.
 */
export type FixStrategistSessionStatus =
	| "pending" // Session created, awaiting analysis
	| "analyzing" // Analysis in progress
	| "completed" // Analysis completed successfully
	| "failed" // Analysis failed
	| "cancelled"; // Analysis cancelled

/**
 * An analysis session for the fix strategist worker.
 *
 * Tracks runtime, token consumption, and diagnostics throughout
 * a single analysis cycle for budget enforcement.
 */
export interface FixStrategistSession {
	/** Unique session identifier */
	id: string;

	/** ISO 8601 timestamp of session creation */
	createdAt: string;

	/** ISO 8601 timestamp of last activity, or null */
	lastActivityAt: string | null;

	/** Current session status */
	status: FixStrategistSessionStatus;

	/** Tokens consumed during this session */
	tokensConsumed: number;

	/** Runtime in milliseconds */
	runtimeMs: number;

	/** Session label for display */
	label: string;

	/** Evidence items analyzed in this session */
	evidenceCount: number;

	/** Strategies generated in this session */
	strategyCount: number;

	/** Diagnostics recorded during this session */
	diagnostics: WorkerDiagnostic[];

	/** Error message if the session failed */
	error: string | null;
}

/**
 * Create a new FixStrategistSession with default values.
 */
function createSession(label: string, existingId?: string): FixStrategistSession {
	return {
		id: existingId ?? randomUUID(),
		createdAt: new Date().toISOString(),
		lastActivityAt: null,
		status: "pending",
		tokensConsumed: 0,
		runtimeMs: 0,
		label,
		evidenceCount: 0,
		strategyCount: 0,
		diagnostics: [],
		error: null,
	};
}

// ---------------------------------------------------------------------------
// Fix Strategy Output
// ---------------------------------------------------------------------------

/**
 * Result of a complete fix strategist analysis cycle.
 */
export interface FixStrategyResult {
	/** Unique result identifier */
	id: string;

	/** ISO 8601 timestamp */
	createdAt: string;

	/** Session identifier */
	sessionId: string;

	/** Generated patch strategies (ranked) */
	strategies: PatchStrategy[];

	/** Generated test plans (one per strategy) */
	testPlans: TestPlan[];

	/** Whether the analysis was successful */
	success: boolean;

	/** Diagnostics generated during analysis */
	diagnostics: WorkerDiagnostic[];

	/** Summary of what was produced */
	summary: string;
}

// ---------------------------------------------------------------------------
// Fix Strategist Worker Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the FixStrategistWorker.
 *
 * Controls all aspects of the worker's behavior including evidence
 * analysis, strategy generation, test plan generation, and budget/
 * cooldown/dedup enforcement.
 */
export interface FixStrategistWorkerConfig {
	/** Maximum evidence items to process per cycle. Default: 200. */
	maxEvidenceItems: number;

	/** Maximum strategies to generate per cycle. Default: 5. */
	maxStrategies: number;

	/** Whether to auto-generate test plans. Default: true. */
	autoGenerateTestPlans: boolean;

	/** Whether to enable autonomous execution eligibility. Default: false. */
	enableAutonomous: boolean;

	/** Dedup configuration. */
	dedupConfig: WorkerDedupConfig;

	/** Minimum confidence threshold (0-1) for evidence processing. Default: 0.3. */
	minEvidenceConfidence: number;

	/** Whether to allow partial evidence (missing types). Default: true. */
	allowPartialEvidence: boolean;

	/** Whether diagnostics are enabled. Default: true. */
	diagnosticsEnabled: boolean;

	/**
	 * Maximum tokens per analysis session.
	 * Default: 200_000.
	 */
	maxTokensPerSession: number;

	/**
	 * Maximum runtime per analysis session in milliseconds.
	 * Default: 900_000 (15 minutes).
	 */
	maxRuntimeMsPerSession: number;

	/**
	 * Maximum consecutive failures before the worker stops.
	 * Default: 3.
	 */
	maxConsecutiveFailures: number;

	/**
	 * Cooldown period in milliseconds after a failure.
	 * Default: 180_000 (3 minutes).
	 */
	cooldownMs: number;
}

/**
 * Default configuration for the FixStrategistWorker.
 */
export const DEFAULT_FIX_STRATEGIST_WORKER_CONFIG: FixStrategistWorkerConfig = {
	maxEvidenceItems: 200,
	maxStrategies: 5,
	autoGenerateTestPlans: true,
	enableAutonomous: false,
	dedupConfig: { ...DEFAULT_WORKER_DEDUP_CONFIG },
	minEvidenceConfidence: 0.3,
	allowPartialEvidence: true,
	diagnosticsEnabled: true,
	maxTokensPerSession: 200_000,
	maxRuntimeMsPerSession: 900_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 180_000,
};

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/**
 * Standard contract for the fix strategist worker role.
 *
 * The fix strategist is a specialist "fixStrategist" role that
 * consumes debug evidence and produces fix strategies with patch
 * plans, test plans, and diagnostic reports.
 */
export function createFixStrategistContract(version: string = "1.0.0"): WorkerContract {
	return {
		id: `brain-worker.fix-strategist.v${version}`,
		name: "Fix Strategist Worker Contract",
		description:
			"Analyzes debug evidence to generate fix strategies, patch plans, and test plans for resolving identified issues. Supports budget, cooldown, dedup, and stop-condition handling with evidence-backed diagnostics on all failures.",
		version,
		capabilities: [
			"evidence_analysis",
			"root_cause_identification",
			"patch_strategy_generation",
			"test_plan_generation",
			"strategy_ranking",
			"risk_assessment",
		],
		inputs: [
			{
				name: "evidence_items",
				description: "Debug evidence items including error messages, stack traces, diagnostics, and execution logs",
				type: "FixEvidenceItem[]",
				required: true,
				sources: ["debugger", "diagnostician", "execution-monitor"],
			},
			{
				name: "failure_context",
				description: "Context about the failure environment (project path, git ref, reproduction steps)",
				type: "FailureContext",
				required: false,
				sources: ["debugger", "diagnostician"],
			},
		],
		outputs: [
			{
				name: "fix_strategies",
				description: "Ranked patch strategies with root cause analysis, actions, and risk assessment",
				type: "PatchStrategy[]",
				destinations: ["fix-executor", "plan-synthesizer"],
			},
			{
				name: "test_plans",
				description: "Test plans for fix verification with coverage analysis",
				type: "TestPlan[]",
				destinations: ["test-executor", "plan-synthesizer"],
			},
			{
				name: "strategy_diagnostics",
				description:
					"Diagnostics about the strategy generation process including validation failures and resource constraints",
				type: "WorkerDiagnostic[]",
				destinations: ["brain-timeline", "brain-audit"],
			},
		],
		errors: [
			{
				code: "NO_EVIDENCE_PROVIDED",
				description: "No evidence items were provided for analysis",
				severity: "critical",
				remediation: "Provide at least one evidence item with content before starting analysis",
			},
			{
				code: "EVIDENCE_VALIDATION_FAILED",
				description: "Evidence items failed validation (empty content, insufficient confidence)",
				severity: "warning",
				remediation:
					"Review evidence items and ensure they have non-empty content and meet minimum confidence threshold",
			},
			{
				code: "ROOT_CAUSE_EXTRACTION_FAILED",
				description: "Failed to extract any root cause findings from evidence",
				severity: "warning",
				remediation: "Provide more detailed evidence with error messages, stack traces, or diagnostics",
			},
			{
				code: "STRATEGY_GENERATION_FAILED",
				description: "Failed to generate any patch strategies from root cause findings",
				severity: "warning",
				remediation: "Check root cause extraction results and retry with additional evidence",
			},
			{
				code: "BUDGET_EXCEEDED",
				description: "Token or runtime budget was exceeded during analysis",
				severity: "warning",
				remediation: "Consider increasing the analysis budget or reducing the evidence scope",
			},
		],
		dependencies: ["brain-worker.debugger", "brain-worker.diagnostician"],
		supportsStreaming: false,
		supportsCancellation: true,
		readonlyAccess: true,
	};
}

// ---------------------------------------------------------------------------
// Fix Strategist Worker
// ---------------------------------------------------------------------------

/**
 * The Fix Strategist Brain Worker.
 *
 * Main entry point for fix strategy generation. Consumes evidence
 * from the debugger pipeline and produces ranked fix strategies
 * with associated test plans.
 *
 * Supports:
 * - Evidence analysis and root cause identification
 * - Patch strategy generation and ranking
 * - Test plan generation for fix verification
 * - Budget/cooldown/dedup/stop-condition lifecycle integration
 * - Evidence-backed diagnostics on all failures
 */
export class FixStrategistWorker {
	private config: FixStrategistWorkerConfig;
	private strategyGenerator: PatchStrategyGenerator;
	private testPlanGenerator: TestPlanGenerator;
	private diagnostics: WorkerDiagnostic[];
	private results: Map<string, FixStrategyResult>;
	private dedupHistory: Map<string, { hash: string; timestamp: string }>;
	private sessions: Map<string, FixStrategistSession>;
	private cycleCount: number;
	private consecutiveFailures: number;
	private isCoolingDown: boolean;
	private cooldownEndsAt: string | null;
	private totalAnalysisCycles: number;
	private totalProposalsEmitted: number;
	private totalDiagnosticsGenerated: number;
	private totalCyclesCompleted: number;
	private totalCyclesFailed: number;

	/**
	 * Create a new FixStrategistWorker.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<FixStrategistWorkerConfig>) {
		this.config = {
			maxEvidenceItems: config?.maxEvidenceItems ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.maxEvidenceItems,
			maxStrategies: config?.maxStrategies ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.maxStrategies,
			autoGenerateTestPlans:
				config?.autoGenerateTestPlans ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.autoGenerateTestPlans,
			enableAutonomous: config?.enableAutonomous ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.enableAutonomous,
			dedupConfig: {
				enabled: config?.dedupConfig?.enabled ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.dedupConfig.enabled,
				windowMs: config?.dedupConfig?.windowMs ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.dedupConfig.windowMs,
				useSimilarity:
					config?.dedupConfig?.useSimilarity ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.dedupConfig.useSimilarity,
				similarityThreshold:
					config?.dedupConfig?.similarityThreshold ??
					DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.dedupConfig.similarityThreshold,
			},
			minEvidenceConfidence:
				config?.minEvidenceConfidence ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.minEvidenceConfidence,
			allowPartialEvidence:
				config?.allowPartialEvidence ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.allowPartialEvidence,
			diagnosticsEnabled: config?.diagnosticsEnabled ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.diagnosticsEnabled,
			maxTokensPerSession: config?.maxTokensPerSession ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.maxTokensPerSession,
			maxRuntimeMsPerSession:
				config?.maxRuntimeMsPerSession ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.maxRuntimeMsPerSession,
			maxConsecutiveFailures:
				config?.maxConsecutiveFailures ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.maxConsecutiveFailures,
			cooldownMs: config?.cooldownMs ?? DEFAULT_FIX_STRATEGIST_WORKER_CONFIG.cooldownMs,
		};

		this.strategyGenerator = new PatchStrategyGenerator({
			maxStrategies: this.config.maxStrategies,
		});
		this.testPlanGenerator = new TestPlanGenerator();
		this.diagnostics = [];
		this.results = new Map();
		this.dedupHistory = new Map();
		this.sessions = new Map();
		this.cycleCount = 0;
		this.consecutiveFailures = 0;
		this.isCoolingDown = false;
		this.cooldownEndsAt = null;
		this.totalAnalysisCycles = 0;
		this.totalProposalsEmitted = 0;
		this.totalDiagnosticsGenerated = 0;
		this.totalCyclesCompleted = 0;
		this.totalCyclesFailed = 0;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the worker configuration.
	 */
	setConfig(config: Partial<FixStrategistWorkerConfig>): void {
		if (config.maxEvidenceItems !== undefined) this.config.maxEvidenceItems = config.maxEvidenceItems;
		if (config.maxStrategies !== undefined) {
			this.config.maxStrategies = config.maxStrategies;
			this.strategyGenerator.setConfig({ maxStrategies: config.maxStrategies });
		}
		if (config.autoGenerateTestPlans !== undefined) this.config.autoGenerateTestPlans = config.autoGenerateTestPlans;
		if (config.enableAutonomous !== undefined) this.config.enableAutonomous = config.enableAutonomous;
		if (config.dedupConfig !== undefined) {
			this.config.dedupConfig = { ...this.config.dedupConfig, ...config.dedupConfig };
		}
		if (config.minEvidenceConfidence !== undefined) this.config.minEvidenceConfidence = config.minEvidenceConfidence;
		if (config.allowPartialEvidence !== undefined) this.config.allowPartialEvidence = config.allowPartialEvidence;
		if (config.diagnosticsEnabled !== undefined) this.config.diagnosticsEnabled = config.diagnosticsEnabled;
		if (config.maxTokensPerSession !== undefined) this.config.maxTokensPerSession = config.maxTokensPerSession;
		if (config.maxRuntimeMsPerSession !== undefined)
			this.config.maxRuntimeMsPerSession = config.maxRuntimeMsPerSession;
		if (config.maxConsecutiveFailures !== undefined)
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		if (config.cooldownMs !== undefined) this.config.cooldownMs = config.cooldownMs;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): FixStrategistWorkerConfig {
		return { ...this.config, dedupConfig: { ...this.config.dedupConfig } };
	}

	// -----------------------------------------------------------------------
	// Deduplication
	// -----------------------------------------------------------------------

	/**
	 * Compute a hash of the input evidence for dedup comparison.
	 */
	private computeInputHash(evidence: FixEvidenceItem[], context?: FailureContext): string {
		const content = evidence
			.map((e) => `${e.label}:${e.content.slice(0, 200)}`)
			.sort()
			.join("|");
		const contextStr = context ? JSON.stringify(context) : "";
		return createHash("sha256")
			.update(content + contextStr)
			.digest("hex");
	}

	/**
	 * Check if a set of evidence has already been processed (dedup).
	 *
	 * @param hash - The input hash to check.
	 * @returns true if this input has been processed within the dedup window.
	 */
	isDuplicate(hash: string): boolean {
		if (!this.config.dedupConfig.enabled) return false;

		const existing = this.dedupHistory.get(hash);
		if (!existing) return false;

		const age = Date.now() - new Date(existing.timestamp).getTime();
		return age < this.config.dedupConfig.windowMs;
	}

	/**
	 * Record a processed input hash for dedup tracking.
	 */
	private recordDedup(hash: string): void {
		this.dedupHistory.set(hash, {
			hash,
			timestamp: new Date().toISOString(),
		});

		// Clean old entries
		const cutoff = Date.now() - this.config.dedupConfig.windowMs;
		for (const [key, value] of this.dedupHistory) {
			if (new Date(value.timestamp).getTime() < cutoff) {
				this.dedupHistory.delete(key);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Diagnostics
	// -----------------------------------------------------------------------

	/**
	 * Record a diagnostic event.
	 */
	private recordDiagnostic(
		stopCondition: WorkerStopCondition,
		message: string,
		context: Record<string, unknown> = {},
		evidenceRefs: string[] = [],
		errorDetail?: string,
	): void {
		if (!this.config.diagnosticsEnabled) return;

		const diagnostic = createWorkerDiagnostic(stopCondition, message, context, evidenceRefs, errorDetail);
		this.diagnostics.push(diagnostic);
		this.totalDiagnosticsGenerated++;
	}

	/**
	 * Get all recorded diagnostics.
	 */
	getDiagnostics(): WorkerDiagnostic[] {
		return [...this.diagnostics];
	}

	/**
	 * Clear all recorded diagnostics.
	 */
	clearDiagnostics(): void {
		this.diagnostics = [];
	}

	// -----------------------------------------------------------------------
	// Cooldown
	// -----------------------------------------------------------------------

	/**
	 * Check if the worker is currently in cooldown.
	 */
	isInCooldown(): boolean {
		if (!this.isCoolingDown || !this.cooldownEndsAt) return false;
		return Date.now() < new Date(this.cooldownEndsAt).getTime();
	}

	/**
	 * Get cooldown status.
	 */
	getCooldownStatus(): { cooling: boolean; endsAt: string | null; remainingMs: number } {
		if (!this.isCoolingDown || !this.cooldownEndsAt) {
			return { cooling: false, endsAt: null, remainingMs: 0 };
		}

		const remaining = Math.max(0, new Date(this.cooldownEndsAt).getTime() - Date.now());
		return { cooling: true, endsAt: this.cooldownEndsAt, remainingMs: remaining };
	}

	/**
	 * Start a cooldown period.
	 *
	 * @param durationMs - Duration in milliseconds. Defaults to the configured dedup window + buffer.
	 */
	startCooldown(durationMs?: number): void {
		const cooldownMs = durationMs ?? this.config.dedupConfig.windowMs + 30_000;
		this.isCoolingDown = true;
		this.cooldownEndsAt = new Date(Date.now() + cooldownMs).toISOString();
	}

	/**
	 * End the cooldown period early.
	 */
	endCooldown(): void {
		this.isCoolingDown = false;
		this.cooldownEndsAt = null;
	}

	// -----------------------------------------------------------------------
	// Stop Conditions
	// -----------------------------------------------------------------------

	/**
	 * Check if the worker should stop based on budget/consecutive failures.
	 *
	 * Uses the configured maxConsecutiveFailures from the worker config.
	 * @returns A stop condition if the worker should stop, or null if it should continue.
	 */
	checkStopCondition(): WorkerStopCondition | null {
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			return "consecutive_failures_exceeded";
		}
		return null;
	}

	/**
	 * Get the current consecutive failure count.
	 */
	get consecutiveFailureCount(): number {
		return this.consecutiveFailures;
	}

	/**
	 * Get the total cycle count.
	 */
	get totalCycles(): number {
		return this.cycleCount;
	}

	// -----------------------------------------------------------------------
	// Generator Accessors
	// -----------------------------------------------------------------------

	/**
	 * Get the internal PatchStrategyGenerator instance.
	 * Useful for testing and inspection.
	 */
	getStrategyGenerator(): PatchStrategyGenerator {
		return this.strategyGenerator;
	}

	/**
	 * Get the internal TestPlanGenerator instance.
	 * Useful for testing and inspection.
	 */
	getTestPlanGenerator(): TestPlanGenerator {
		return this.testPlanGenerator;
	}

	// -----------------------------------------------------------------------
	// Evidence Processing
	// -----------------------------------------------------------------------

	/**
	 * Validate input evidence.
	 *
	 * Checks that evidence items meet minimum quality requirements
	 * and that required evidence types are present (if configured).
	 *
	 * @param evidence - Evidence items to validate.
	 * @returns Array of validation error messages (empty if valid).
	 */
	validateEvidence(evidence: FixEvidenceItem[]): string[] {
		const errors: string[] = [];

		if (!evidence || evidence.length === 0) {
			errors.push("No evidence provided");
			return errors;
		}

		if (evidence.length > this.config.maxEvidenceItems) {
			errors.push(`Evidence count (${evidence.length}) exceeds maximum (${this.config.maxEvidenceItems})`);
		}

		// Check for content quality
		const emptyItems = evidence.filter((e) => !e.content || e.content.trim().length === 0);
		if (emptyItems.length > 0) {
			errors.push(`${emptyItems.length} evidence item(s) have empty content`);
		}

		// Check for required types
		if (!this.config.allowPartialEvidence) {
			const hasError = evidence.some((e) => e.type === "error_message" || e.label.toLowerCase().includes("error"));
			const hasSource = evidence.some((e) => e.type === "stack_trace" || e.label.toLowerCase().includes("stack"));
			if (!hasError) {
				errors.push("No error message evidence found (required when allowPartialEvidence is false)");
			}
			if (!hasSource) {
				errors.push("No stack trace evidence found (required when allowPartialEvidence is false)");
			}
		}

		return errors;
	}

	/**
	 * Filter evidence by minimum confidence.
	 *
	 * Removes evidence items below the configured confidence threshold.
	 * Uses a simple scoring: high=1.0, medium=0.7, low=0.3, speculative=0.1
	 */
	filterEvidenceByConfidence(evidence: FixEvidenceItem[]): FixEvidenceItem[] {
		const confidenceScores: Record<string, number> = {
			high: 1.0,
			medium: 0.7,
			low: 0.3,
			speculative: 0.1,
		};

		return evidence.filter((e) => {
			const confidence = e.confidence ?? "medium";
			const score = confidenceScores[confidence] ?? 0.5;
			return score >= this.config.minEvidenceConfidence;
		});
	}

	// -----------------------------------------------------------------------
	// Analysis Cycle
	// -----------------------------------------------------------------------

	/**
	 * Run a complete fix analysis cycle.
	 *
	 * This is the main entry point for the worker. It:
	 * 1. Validates and filters input evidence
	 * 2. Checks dedup
	 * 3. Extracts root causes from evidence
	 * 4. Generates patch strategies with auto-generated actions
	 * 5. Generates test plans (if enabled)
	 * 6. Ranks strategies
	 * 7. Produces a FixStrategyResult with diagnostics
	 *
	 * @param evidence - Array of evidence items to analyze.
	 * @param context - Optional failure context.
	 * @param sessionId - Optional session identifier.
	 * @returns The FixStrategyResult containing strategies, plans, and diagnostics.
	 */
	analyze(evidence: FixEvidenceItem[], context?: FailureContext, sessionId?: string): FixStrategyResult {
		const resultId = randomUUID();
		const now = new Date().toISOString();
		const sid = sessionId ?? `fix-${randomUUID().slice(0, 8)}`;
		const strategies: PatchStrategy[] = [];
		const testPlans: TestPlan[] = [];
		const startTime = Date.now();

		this.cycleCount++;

		// 0. Create and track session
		const session = createSession(`Analysis cycle ${this.cycleCount}`, sid);
		session.status = "analyzing";
		session.lastActivityAt = new Date().toISOString();
		this.sessions.set(sid, session);

		// 1. Validate evidence
		const validationErrors = this.validateEvidence(evidence);
		if (validationErrors.length > 0) {
			for (const err of validationErrors) {
				this.recordDiagnostic("unknown_error", err, { sessionId: sid }, [], "Validation error");
			}

			// If there are critical validation failures, return early
			if (evidence.length === 0) {
				this.consecutiveFailures++;
				session.status = "failed";
				session.runtimeMs = Date.now() - startTime;
				session.error = validationErrors.join("; ");
				const result: FixStrategyResult = {
					id: resultId,
					createdAt: now,
					sessionId: sid,
					strategies: [],
					testPlans: [],
					success: false,
					diagnostics: this.getDiagnostics(),
					summary: `Analysis failed: ${validationErrors.join("; ")}`,
				};
				this.results.set(resultId, result);
				this.totalAnalysisCycles++;
				this.totalCyclesFailed++;
				return result;
			}
		}

		// 2. Check dedup
		const inputHash = this.computeInputHash(evidence, context);
		if (this.isDuplicate(inputHash)) {
			this.recordDiagnostic("completed", "Duplicate input — analysis skipped", {
				sessionId: sid,
				hash: inputHash,
			});

			session.status = "completed";
			session.runtimeMs = Date.now() - startTime;
			const result: FixStrategyResult = {
				id: resultId,
				createdAt: now,
				sessionId: sid,
				strategies: [],
				testPlans: [],
				success: true,
				diagnostics: this.getDiagnostics(),
				summary: "Analysis skipped — duplicate input (dedup)",
			};
			this.results.set(resultId, result);
			this.totalAnalysisCycles++;
			this.totalCyclesCompleted++;
			return result;
		}

		// 3. Filter evidence by confidence
		const filteredEvidence = this.filterEvidenceByConfidence(evidence);
		session.evidenceCount = filteredEvidence.length;
		if (filteredEvidence.length === 0) {
			const msg = "All evidence filtered out by confidence threshold";
			this.recordDiagnostic("completed", msg, { sessionId: sid, threshold: this.config.minEvidenceConfidence });

			session.status = "completed";
			session.runtimeMs = Date.now() - startTime;
			const result: FixStrategyResult = {
				id: resultId,
				createdAt: now,
				sessionId: sid,
				strategies: [],
				testPlans: [],
				success: true,
				diagnostics: this.getDiagnostics(),
				summary: msg,
			};
			this.results.set(resultId, result);
			this.totalAnalysisCycles++;
			this.totalCyclesCompleted++;
			return result;
		}

		// 4. Check token budget before proceeding
		const estimatedTokens = filteredEvidence.reduce((sum, e) => sum + e.content.length + (e.label?.length ?? 0), 0);
		session.tokensConsumed = estimatedTokens;
		if (estimatedTokens > this.config.maxTokensPerSession) {
			this.recordDiagnostic(
				"token_budget_exhausted",
				`Token budget exceeded: estimated ${estimatedTokens} tokens exceeds limit of ${this.config.maxTokensPerSession}`,
				{
					sessionId: sid,
					estimatedTokens,
					maxTokens: this.config.maxTokensPerSession,
					evidenceCount: filteredEvidence.length,
				},
			);

			this.consecutiveFailures++;
			session.status = "failed";
			session.runtimeMs = Date.now() - startTime;
			session.error = `Token budget exceeded: ${estimatedTokens} > ${this.config.maxTokensPerSession}`;
			this.totalAnalysisCycles++;
			this.totalCyclesFailed++;

			// Check stop condition after budget failure
			const stopCondition = this.checkStopCondition();
			if (stopCondition) {
				this.recordDiagnostic(
					stopCondition,
					`Worker stopped: ${stopCondition} (${this.consecutiveFailures} consecutive failures)`,
					{ sessionId: sid, consecutiveFailures: this.consecutiveFailures },
				);
			}

			return {
				id: resultId,
				createdAt: now,
				sessionId: sid,
				strategies: [],
				testPlans: [],
				success: false,
				diagnostics: this.getDiagnostics(),
				summary: `Analysis failed: token budget exceeded (${estimatedTokens} > ${this.config.maxTokensPerSession})`,
			};
		}

		// 5. Check runtime budget
		const runtimeMs = Date.now() - startTime;
		if (runtimeMs > this.config.maxRuntimeMsPerSession) {
			this.recordDiagnostic(
				"timeout",
				`Runtime budget exceeded: ${runtimeMs}ms exceeds limit of ${this.config.maxRuntimeMsPerSession}ms`,
				{
					sessionId: sid,
					runtimeMs,
					maxRuntimeMs: this.config.maxRuntimeMsPerSession,
				},
			);

			this.consecutiveFailures++;
			session.status = "failed";
			session.runtimeMs = runtimeMs;
			session.error = `Runtime budget exceeded: ${runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms`;
			this.totalAnalysisCycles++;
			this.totalCyclesFailed++;

			// Check stop condition after timeout failure
			const stopCondition = this.checkStopCondition();
			if (stopCondition) {
				this.recordDiagnostic(
					stopCondition,
					`Worker stopped: ${stopCondition} (${this.consecutiveFailures} consecutive failures)`,
					{ sessionId: sid, consecutiveFailures: this.consecutiveFailures },
				);
			}

			return {
				id: resultId,
				createdAt: now,
				sessionId: sid,
				strategies: [],
				testPlans: [],
				success: false,
				diagnostics: this.getDiagnostics(),
				summary: `Analysis failed: runtime budget exceeded (${runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms)`,
			};
		}

		// 6. Extract root causes from evidence
		const rootCauses = this.strategyGenerator.extractRootCauses(
			filteredEvidence.map((e) => ({
				label: e.label,
				content: e.content,
				type: e.type,
				confidence: e.confidence,
			})),
			sid,
		);

		// 7. Generate patch strategies (up to maxStrategies, one per unique category)
		if (rootCauses.length > 0) {
			// Group root causes by category for diversified strategies
			const byCategory = new Map<FixRootCauseFinding["category"], FixRootCauseFinding[]>();
			for (const rc of rootCauses) {
				const existing = byCategory.get(rc.category) ?? [];
				existing.push(rc);
				byCategory.set(rc.category, existing);
			}

			const categoryEntries = Array.from(byCategory.entries());
			const maxStrat = Math.min(categoryEntries.length, this.config.maxStrategies);

			for (let i = 0; i < maxStrat; i++) {
				const [category, causes] = categoryEntries[i]!;
				const title = `Fix: ${category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
				const description = `Strategy addressing ${causes.length} root cause(s) of category "${category}" derived from ${filteredEvidence.length} evidence item(s)`;

				// Auto-generate actions from root causes
				const actions = this.strategyGenerator.toActions(causes, [sid]);

				const strategy = this.strategyGenerator.generateStrategy(title, description, causes, actions, [sid], sid);
				strategies.push(strategy);
			}
		}

		// 8. Generate test plans (if enabled)
		if (this.config.autoGenerateTestPlans) {
			for (const strategy of strategies) {
				const plan = this.testPlanGenerator.generatePlan(strategy);
				testPlans.push(plan);
			}
		}

		// 9. Handle stop condition (checked at start — if we reach here after
		// successful strategy generation, reset failures instead of stopping)
		// All budget failures are handled in steps 4-5 with early returns.
		// If strategies were generated, the analysis succeeded regardless of
		// prior failure history.
		if (strategies.length > 0) {
			// Successful generation resets the failure counter
			this.consecutiveFailures = 0;
		} else {
			const stopCondition = this.checkStopCondition();
			if (stopCondition) {
				this.recordDiagnostic(
					stopCondition,
					`Worker stopped: ${stopCondition} (${this.consecutiveFailures} consecutive failures)`,
					{ sessionId: sid, consecutiveFailures: this.consecutiveFailures },
				);

				this.consecutiveFailures++;
				session.status = "failed";
				session.runtimeMs = Date.now() - startTime;
				session.error = `Worker stopped: ${stopCondition}`;
				this.totalAnalysisCycles++;
				this.totalCyclesFailed++;

				const result: FixStrategyResult = {
					id: resultId,
					createdAt: now,
					sessionId: sid,
					strategies,
					testPlans,
					success: false,
					diagnostics: this.getDiagnostics(),
					summary: `Analysis stopped: ${stopCondition} after prior failures`,
				};
				this.results.set(resultId, result);
				return result;
			}
		}

		// 10. Record dedup and reset failures
		this.recordDedup(inputHash);
		this.consecutiveFailures = 0;

		// 11. Compose result
		const success = strategies.length > 0 || rootCauses.length === 0;
		const summary = success
			? `Generated ${strategies.length} strategy(ies) and ${testPlans.length} test plan(s) from ${filteredEvidence.length} evidence item(s) with ${rootCauses.length} root cause(s)`
			: `Analysis completed with issues: ${rootCauses.length} root cause(s) but no strategies generated`;

		session.status = success ? "completed" : "failed";
		session.runtimeMs = Date.now() - startTime;
		session.strategyCount = strategies.length;
		session.diagnostics = this.getDiagnostics();
		if (!success) {
			session.error = `Analysis completed with issues: ${rootCauses.length} root cause(s) but no strategies generated`;
		}

		const result: FixStrategyResult = {
			id: resultId,
			createdAt: now,
			sessionId: sid,
			strategies,
			testPlans,
			success,
			diagnostics: this.getDiagnostics(),
			summary,
		};

		this.results.set(resultId, result);
		this.totalAnalysisCycles++;
		if (success) {
			this.totalCyclesCompleted++;
		} else {
			this.totalCyclesFailed++;
		}
		return result;
	}

	// -----------------------------------------------------------------------
	// Result Management
	// -----------------------------------------------------------------------

	/**
	 * Get a result by ID.
	 */
	getResult(id: string): FixStrategyResult | undefined {
		return this.results.get(id);
	}

	/**
	 * Get all results.
	 */
	getAllResults(): FixStrategyResult[] {
		return Array.from(this.results.values());
	}

	/**
	 * Clear all results.
	 */
	clearResults(): void {
		this.results.clear();
	}

	/**
	 * Get the count of results.
	 */
	get resultCount(): number {
		return this.results.size;
	}

	// -----------------------------------------------------------------------
	// Handoff Emission
	// -----------------------------------------------------------------------

	/**
	 * Emit a proposal bundle for handoff inbox consumption.
	 *
	 * Produces a structured result bundle containing the fix strategy,
	 * test plan, evidence-backed diagnostics, and worker stats snapshot.
	 * The FixStrategistWorker is read-only — it does not modify execution
	 * state; proposals are emitted into the handoff inbox for downstream
	 * workers (e.g., fix-executor, plan-synthesizer) to consume.
	 *
	 * @param resultId - The result ID to emit.
	 * @returns A handoff result bundle, or null if the result does not exist.
	 */
	emitProposal(resultId: string): FixStrategistHandoffResult | null {
		const result = this.results.get(resultId);
		if (!result) return null;

		this.totalProposalsEmitted++;

		return {
			resultId: result.id,
			createdAt: result.createdAt,
			sessionId: result.sessionId,
			strategies: result.strategies,
			testPlans: result.testPlans,
			success: result.success,
			summary: result.summary,
			diagnostics: result.diagnostics,
			workerStats: this.getStats(),
			emittedAt: new Date().toISOString(),
		};
	}

	// -----------------------------------------------------------------------
	// Session Management
	// -----------------------------------------------------------------------

	/**
	 * Get a session by ID.
	 */
	getSession(id: string): FixStrategistSession | undefined {
		return this.sessions.get(id);
	}

	/**
	 * Get all tracked sessions.
	 */
	getAllSessions(): FixStrategistSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Clear all tracked sessions.
	 */
	clearSessions(): void {
		this.sessions.clear();
	}

	// -----------------------------------------------------------------------
	// Health & Stats
	// -----------------------------------------------------------------------

	/**
	 * Check if the worker is healthy based on consecutive failures.
	 *
	 * Evaluates the current consecutive failure count to determine
	 * health status. 0 failures = healthy, 1-4 = degraded, 5+ = unhealthy.
	 *
	 * @returns "healthy", "degraded", or "unhealthy".
	 */
	getHealthStatus(): "healthy" | "degraded" | "unhealthy" {
		if (this.consecutiveFailures === 0) {
			return "healthy";
		}
		if (this.consecutiveFailures < 5) {
			return "degraded";
		}
		return "unhealthy";
	}

	/**
	 * Get runtime stats for this worker.
	 *
	 * Returns a snapshot of all tracked metrics including cycle counts,
	 * proposal emission, diagnostics, strategies, and dedup history.
	 */
	getStats(): FixStrategistWorkerStats {
		const allResults = this.getAllResults();
		const completed = allResults.filter((r) => r.success);
		const failed = allResults.filter((r) => !r.success);

		return {
			totalCycles: this.totalAnalysisCycles,
			completed: completed.length,
			failed: failed.length,
			consecutiveFailures: this.consecutiveFailures,
			totalCyclesCompleted: this.totalCyclesCompleted,
			totalCyclesFailed: this.totalCyclesFailed,
			totalProposalsEmitted: this.totalProposalsEmitted,
			totalDiagnosticsGenerated: this.totalDiagnosticsGenerated,
			totalStrategiesGenerated: this.strategyGenerator.strategyCount,
			totalTestPlansGenerated: this.testPlanGenerator.planCount,
			dedupHistorySize: this.dedupHistory.size,
			healthStatus: this.getHealthStatus(),
		};
	}

	// -----------------------------------------------------------------------
	// Reset
	// -----------------------------------------------------------------------

	/**
	 * Reset the worker to its initial state.
	 *
	 * Clears all diagnostics, dedup history, results, and resets
	 * cycle/failure counters and cooldown state.
	 */
	reset(): void {
		this.diagnostics = [];
		this.results.clear();
		this.dedupHistory.clear();
		this.strategyGenerator.clearStrategies();
		this.testPlanGenerator.clearPlans();
		this.cycleCount = 0;
		this.consecutiveFailures = 0;
		this.isCoolingDown = false;
		this.cooldownEndsAt = null;
		this.totalAnalysisCycles = 0;
		this.totalProposalsEmitted = 0;
		this.totalDiagnosticsGenerated = 0;
		this.totalCyclesCompleted = 0;
		this.totalCyclesFailed = 0;
	}
}

// ---------------------------------------------------------------------------
// Fix Strategist Worker Stats & Handoff
// ---------------------------------------------------------------------------

/**
 * Result bundle emitted for handoff inbox consumption.
 *
 * Contains the analysis result, generated strategies, test plans,
 * diagnostics, and a snapshot of worker stats at the time of emission.
 *
 * The FixStrategistWorker is read-only for execution state; proposals
 * are emitted into the handoff inbox via emitProposal() for downstream
 * workers (fix-executor, plan-synthesizer, etc.) to consume.
 */
export interface FixStrategistHandoffResult {
	/** Result ID this handoff is based on */
	resultId: string;
	/** ISO 8601 timestamp of the original analysis */
	createdAt: string;
	/** Session identifier */
	sessionId: string;
	/** Generated patch strategies */
	strategies: PatchStrategy[];
	/** Generated test plans */
	testPlans: TestPlan[];
	/** Whether the analysis was successful */
	success: boolean;
	/** Summary of what was produced */
	summary: string;
	/** Evidence-backed diagnostics from the analysis cycle */
	diagnostics: WorkerDiagnostic[];
	/** Snapshot of worker stats at emission time */
	workerStats: FixStrategistWorkerStats;
	/** ISO 8601 timestamp of emission */
	emittedAt: string;
}

/**
 * Runtime statistics for the FixStrategistWorker.
 */
export interface FixStrategistWorkerStats {
	/** Total analysis cycles run */
	totalCycles: number;
	/** Number of completed (successful) cycles */
	completed: number;
	/** Number of failed cycles */
	failed: number;
	/** Current consecutive failure count */
	consecutiveFailures: number;
	/** Total successful cycles */
	totalCyclesCompleted: number;
	/** Total failed cycles */
	totalCyclesFailed: number;
	/** Total proposals emitted via emitProposal() */
	totalProposalsEmitted: number;
	/** Total diagnostics generated */
	totalDiagnosticsGenerated: number;
	/** Total strategies generated across all cycles */
	totalStrategiesGenerated: number;
	/** Total test plans generated across all cycles */
	totalTestPlansGenerated: number;
	/** Number of entries in dedup history */
	dedupHistorySize: number;
	/** Health status based on consecutive failures */
	healthStatus: "healthy" | "degraded" | "unhealthy";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a FixStrategistWorker with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new FixStrategistWorker instance.
 */
export function createFixStrategistWorker(config?: Partial<FixStrategistWorkerConfig>): FixStrategistWorker {
	return new FixStrategistWorker(config);
}
