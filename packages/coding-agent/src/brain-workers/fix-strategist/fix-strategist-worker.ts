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
	type WorkerDedupConfig,
	type WorkerDiagnostic,
	type WorkerStopCondition,
} from "../types.js";
import { type PatchStrategy, PatchStrategyGenerator } from "./patch-strategy.js";
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
};

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
	private cycleCount: number;
	private consecutiveFailures: number;
	private isCoolingDown: boolean;
	private cooldownEndsAt: string | null;

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
		};

		this.strategyGenerator = new PatchStrategyGenerator({
			maxStrategies: this.config.maxStrategies,
		});
		this.testPlanGenerator = new TestPlanGenerator();
		this.diagnostics = [];
		this.results = new Map();
		this.dedupHistory = new Map();
		this.cycleCount = 0;
		this.consecutiveFailures = 0;
		this.isCoolingDown = false;
		this.cooldownEndsAt = null;
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
	 * @param maxConsecutiveFailures - Maximum allowed consecutive failures.
	 * @returns A stop condition if the worker should stop, or null if it should continue.
	 */
	checkStopCondition(maxConsecutiveFailures: number = 3): WorkerStopCondition | null {
		if (this.consecutiveFailures >= maxConsecutiveFailures) {
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
	 * 4. Generates patch strategies
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
		const cycleDiagnostics: WorkerDiagnostic[] = [];
		const strategies: PatchStrategy[] = [];
		const testPlans: TestPlan[] = [];

		this.cycleCount++;

		// 1. Validate evidence
		const validationErrors = this.validateEvidence(evidence);
		if (validationErrors.length > 0) {
			for (const err of validationErrors) {
				this.recordDiagnostic("unknown_error", err, { sessionId: sid }, [], "Validation error");
				cycleDiagnostics.push(createWorkerDiagnostic("unknown_error", err, { sessionId: sid }, []));
			}

			// If there are critical validation failures, return early
			if (evidence.length === 0) {
				this.consecutiveFailures++;
				const result: FixStrategyResult = {
					id: resultId,
					createdAt: now,
					sessionId: sid,
					strategies: [],
					testPlans: [],
					success: false,
					diagnostics: cycleDiagnostics,
					summary: `Analysis failed: ${validationErrors.join("; ")}`,
				};
				this.results.set(resultId, result);
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
			cycleDiagnostics.push(
				createWorkerDiagnostic("completed", "Duplicate input — analysis skipped", {
					sessionId: sid,
					hash: inputHash,
				}),
			);

			const result: FixStrategyResult = {
				id: resultId,
				createdAt: now,
				sessionId: sid,
				strategies: [],
				testPlans: [],
				success: true,
				diagnostics: cycleDiagnostics,
				summary: "Analysis skipped — duplicate input (dedup)",
			};
			this.results.set(resultId, result);
			return result;
		}

		// 3. Filter evidence by confidence
		const filteredEvidence = this.filterEvidenceByConfidence(evidence);
		if (filteredEvidence.length === 0) {
			const msg = "All evidence filtered out by confidence threshold";
			this.recordDiagnostic("completed", msg, { sessionId: sid, threshold: this.config.minEvidenceConfidence });
			cycleDiagnostics.push(
				createWorkerDiagnostic("completed", msg, {
					sessionId: sid,
					threshold: this.config.minEvidenceConfidence,
				}),
			);

			const result: FixStrategyResult = {
				id: resultId,
				createdAt: now,
				sessionId: sid,
				strategies: [],
				testPlans: [],
				success: true,
				diagnostics: cycleDiagnostics,
				summary: msg,
			};
			this.results.set(resultId, result);
			return result;
		}

		// 4. Extract root causes from evidence
		const rootCauses = this.strategyGenerator.extractRootCauses(
			filteredEvidence.map((e) => ({
				label: e.label,
				content: e.content,
				type: e.type,
				confidence: e.confidence,
			})),
			sid,
		);

		// 5. Generate patch strategies
		if (rootCauses.length > 0) {
			const primaryStrategy = this.strategyGenerator.generateStrategy(
				`Fix: ${rootCauses[0]!.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
				`Strategy addressing ${rootCauses.length} root cause(s) derived from ${filteredEvidence.length} evidence item(s)`,
				rootCauses,
				[], // Actions will be empty since we're not implementing actual LLM-based generation
				[sid],
				sid,
			);
			strategies.push(primaryStrategy);
		}

		// 6. Generate test plans (if enabled)
		if (this.config.autoGenerateTestPlans) {
			for (const strategy of strategies) {
				const plan = this.testPlanGenerator.generatePlan(strategy);
				testPlans.push(plan);
			}
		}

		// 7. Handle stop condition
		const stopCondition = this.checkStopCondition();
		if (stopCondition) {
			this.recordDiagnostic(
				stopCondition,
				`Worker stopped: ${stopCondition} (${this.consecutiveFailures} consecutive failures)`,
				{ sessionId: sid, consecutiveFailures: this.consecutiveFailures },
			);
			cycleDiagnostics.push(
				createWorkerDiagnostic(stopCondition, `Consecutive failure limit reached`, {
					sessionId: sid,
					consecutiveFailures: this.consecutiveFailures,
				}),
			);
		}

		// 8. Record dedup and reset failures
		this.recordDedup(inputHash);
		this.consecutiveFailures = 0;

		// 9. Compose result
		const success = strategies.length > 0 || rootCauses.length === 0;
		const summary = success
			? `Generated ${strategies.length} strategy(ies) and ${testPlans.length} test plan(s) from ${filteredEvidence.length} evidence item(s) with ${rootCauses.length} root cause(s)`
			: `Analysis completed with issues: ${rootCauses.length} root cause(s) but no strategies generated`;

		const result: FixStrategyResult = {
			id: resultId,
			createdAt: now,
			sessionId: sid,
			strategies,
			testPlans,
			success,
			diagnostics: [...this.getDiagnostics(), ...cycleDiagnostics],
			summary,
		};

		this.results.set(resultId, result);
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
	}
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
