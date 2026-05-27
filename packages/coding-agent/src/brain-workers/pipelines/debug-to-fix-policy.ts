/**
 * Debug-to-Fix Pipeline Policy — 25.P
 *
 * Defines the policy configuration for the debug-to-fix pipeline,
 * governing budget limits, cooldowns, deduplication, stop conditions,
 * and stage-level timeouts.
 *
 * The pipeline orchestrates the flow from failure evidence through
 * debugger worker analysis to fix strategist worker generation.
 * This policy ensures the pipeline operates autonomously within
 * safe resource boundaries.
 *
 * @packageDocumentation
 */

import type { WorkerBudget, WorkerDedupConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Stage Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a single pipeline stage.
 *
 * Each stage has independent budget, cooldown, dedup, and stop-condition
 * settings so that resource constraints can be tuned per operation.
 */
export interface DebugToFixStageConfig {
	/**
	 * Maximum tokens this stage can consume.
	 * Range: 0 (no token budget) to 500_000+.
	 * Default: 150_000 for debug, 200_000 for fix.
	 */
	maxTokens: number;

	/**
	 * Maximum runtime in milliseconds for this stage.
	 * Range: 30_000 (30s) to 3_600_000 (1h).
	 * Default: 600_000 (10 min) for debug, 900_000 (15 min) for fix.
	 */
	maxRuntimeMs: number;

	/**
	 * Maximum consecutive failures before the stage is blocked.
	 * Range: 1-20.
	 * Default: 3.
	 */
	maxConsecutiveFailures: number;

	/**
	 * Cooldown period in milliseconds after a stage completes or fails.
	 * Default: 120_000 (2 min).
	 */
	cooldownMs: number;

	/**
	 * Whether this stage is enabled.
	 * If disabled, the pipeline skips it.
	 * Default: true.
	 */
	enabled: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline Policy
// ---------------------------------------------------------------------------

/**
 * Policy configuration for the Debug-to-Fix Pipeline.
 *
 * Defines resource budgets, cooldowns, deduplication, and stage-level
 * controls for the entire pipeline.
 */
export interface DebugToFixPolicy {
	/**
	 * Whether the pipeline is enabled. Default: true.
	 */
	enabled: boolean;

	/**
	 * Whether autonomous operation is allowed. When false, the pipeline
	 * requires explicit approval for each stage transition. Default: true.
	 */
	autonomous: boolean;

	/**
	 * Worker budget for the debugger stage.
	 * Applied when the debugger creates sessions and analyzes evidence.
	 */
	debuggerBudget: WorkerBudget;

	/**
	 * Worker budget for the fix strategist stage.
	 * Applied when the fix strategist generates strategies and test plans.
	 */
	fixStrategistBudget: WorkerBudget;

	/**
	 * Dedup configuration for the pipeline.
	 * Prevents re-processing the same failure signature within the
	 * dedup window.
	 */
	dedupConfig: WorkerDedupConfig;

	/**
	 * Stage-level configuration for the debug phase.
	 */
	debugStage: DebugToFixStageConfig;

	/**
	 * Stage-level configuration for the handoff phase.
	 */
	handoffStage: DebugToFixStageConfig;

	/**
	 * Stage-level configuration for the fix strategy phase.
	 */
	fixStage: DebugToFixStageConfig;

	/**
	 * Maximum total pipeline runtime in milliseconds across all stages.
	 * Default: 3_600_000 (1 hour).
	 */
	maxTotalRuntimeMs: number;

	/**
	 * Maximum number of retries for the entire pipeline.
	 * 0 means no retries. Default: 1.
	 */
	maxPipelineRetries: number;

	/**
	 * Whether to pause the pipeline on any stage failure.
	 * When true, a stage failure sets the pipeline to paused state.
	 * Default: true.
	 */
	pauseOnStageFailure: boolean;

	/**
	 * Whether evidence-backed diagnostics are enabled.
	 * Default: true.
	 */
	diagnosticsEnabled: boolean;

	/**
	 * Tags to attach to handoff entries for triage routing.
	 * Default: ["debug-to-fix", "brain-worker-pipeline"].
	 */
	handoffTags: string[];
}

// ---------------------------------------------------------------------------
// Default Policy
// ---------------------------------------------------------------------------

/**
 * Default policy configuration for the Debug-to-Fix Pipeline.
 *
 * Sensible defaults for most use cases:
 * - Debugger: 150K tokens, 10 min runtime, 3 max failures, 2 min cooldown
 * - Fix: 200K tokens, 15 min runtime, 3 max failures, 3 min cooldown
 * - Handoff: 30K tokens, 30s runtime for inbox/triage operations
 * - Dedup: enabled, 5 min window, 85% similarity threshold
 * - Pipeline: max 1 hour total, 1 retry, pause on failure
 */
export const DEFAULT_DEBUG_TO_FIX_POLICY: DebugToFixPolicy = {
	enabled: true,
	autonomous: true,

	debuggerBudget: {
		maxTokensPerCycle: 150_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 120_000,
		maxRuntimeMs: 600_000,
	},

	fixStrategistBudget: {
		maxTokensPerCycle: 200_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 180_000,
		maxRuntimeMs: 900_000,
	},

	dedupConfig: {
		enabled: true,
		windowMs: 300_000,
		useSimilarity: true,
		similarityThreshold: 0.85,
	},

	debugStage: {
		maxTokens: 150_000,
		maxRuntimeMs: 600_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 120_000,
		enabled: true,
	},

	handoffStage: {
		maxTokens: 30_000,
		maxRuntimeMs: 30_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 10_000,
		enabled: true,
	},

	fixStage: {
		maxTokens: 200_000,
		maxRuntimeMs: 900_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 180_000,
		enabled: true,
	},

	maxTotalRuntimeMs: 3_600_000,
	maxPipelineRetries: 1,
	pauseOnStageFailure: true,
	diagnosticsEnabled: true,
	handoffTags: ["debug-to-fix", "brain-worker-pipeline"],
};

// ---------------------------------------------------------------------------
// Policy Validation
// ---------------------------------------------------------------------------

/**
 * Result of policy validation.
 */
export interface PolicyValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Validate a DebugToFixPolicy configuration.
 *
 * Checks all budget values, cooldowns, dedup settings, and stage
 * configurations against expected ranges.
 *
 * @param policy - The policy to validate.
 * @returns Validation result with errors and warnings.
 */
export function validateDebugToFixPolicy(policy: DebugToFixPolicy): PolicyValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Overall policy
	if (policy.maxTotalRuntimeMs < 60_000) {
		errors.push("maxTotalRuntimeMs must be at least 60,000ms (1 minute)");
	}
	if (policy.maxTotalRuntimeMs > 86_400_000) {
		warnings.push("maxTotalRuntimeMs exceeds 24 hours — pipeline may run indefinitely");
	}
	if (policy.maxPipelineRetries < 0) {
		errors.push("maxPipelineRetries must be >= 0");
	}
	if (policy.maxPipelineRetries > 10) {
		warnings.push("maxPipelineRetries exceeds 10 — pipeline may retry excessively");
	}

	// Debugger budget
	if (policy.debuggerBudget.maxTokensPerCycle < 0) {
		errors.push("debugger budget maxTokensPerCycle must be >= 0");
	}
	if (policy.debuggerBudget.maxRuntimeMs < 5_000) {
		errors.push("debugger budget maxRuntimeMs must be at least 5,000ms");
	}
	if (policy.debuggerBudget.maxConsecutiveFailures < 1) {
		errors.push("debugger budget maxConsecutiveFailures must be >= 1");
	}
	if (policy.debuggerBudget.cooldownMs < 1_000) {
		warnings.push("debugger budget cooldownMs is very low (< 1s)");
	}

	// Fix strategist budget
	if (policy.fixStrategistBudget.maxTokensPerCycle < 0) {
		errors.push("fix strategist budget maxTokensPerCycle must be >= 0");
	}
	if (policy.fixStrategistBudget.maxRuntimeMs < 5_000) {
		errors.push("fix strategist budget maxRuntimeMs must be at least 5,000ms");
	}
	if (policy.fixStrategistBudget.maxConsecutiveFailures < 1) {
		errors.push("fix strategist budget maxConsecutiveFailures must be >= 1");
	}
	if (policy.fixStrategistBudget.cooldownMs < 1_000) {
		warnings.push("fix strategist budget cooldownMs is very low (< 1s)");
	}

	// Dedup
	if (policy.dedupConfig.windowMs < 10_000) {
		warnings.push("dedup window is very low (< 10s) — may cause redundant processing");
	}
	if (policy.dedupConfig.similarityThreshold < 0 || policy.dedupConfig.similarityThreshold > 1) {
		errors.push("dedup similarityThreshold must be between 0 and 1");
	}

	// Stage configs
	const stages: Array<{ name: string; config: DebugToFixStageConfig }> = [
		{ name: "debug", config: policy.debugStage },
		{ name: "handoff", config: policy.handoffStage },
		{ name: "fix", config: policy.fixStage },
	];

	for (const { name, config } of stages) {
		if (config.maxTokens < 0) {
			errors.push(`${name} stage: maxTokens must be >= 0`);
		}
		if (config.maxRuntimeMs < 1_000) {
			errors.push(`${name} stage: maxRuntimeMs must be at least 1,000ms`);
		}
		if (config.maxConsecutiveFailures < 1) {
			errors.push(`${name} stage: maxConsecutiveFailures must be >= 1`);
		}
		if (config.cooldownMs < 0) {
			errors.push(`${name} stage: cooldownMs must be >= 0`);
		}

		// Check for suspiciously low values
		if (config.cooldownMs < 1_000 && config.enabled) {
			warnings.push(`${name} stage: cooldownMs is very low (< 1s)`);
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}

/**
 * Create a new DebugToFixPolicy with defaults, optionally overridden.
 *
 * @param overrides - Partial policy overrides.
 * @returns A fully resolved DebugToFixPolicy.
 */
export function createDebugToFixPolicy(overrides?: Partial<DebugToFixPolicy>): DebugToFixPolicy {
	const policy: DebugToFixPolicy = {
		...DEFAULT_DEBUG_TO_FIX_POLICY,
		...overrides,
		debuggerBudget: { ...DEFAULT_DEBUG_TO_FIX_POLICY.debuggerBudget, ...overrides?.debuggerBudget },
		fixStrategistBudget: { ...DEFAULT_DEBUG_TO_FIX_POLICY.fixStrategistBudget, ...overrides?.fixStrategistBudget },
		dedupConfig: { ...DEFAULT_DEBUG_TO_FIX_POLICY.dedupConfig, ...overrides?.dedupConfig },
		debugStage: { ...DEFAULT_DEBUG_TO_FIX_POLICY.debugStage, ...overrides?.debugStage },
		handoffStage: { ...DEFAULT_DEBUG_TO_FIX_POLICY.handoffStage, ...overrides?.handoffStage },
		fixStage: { ...DEFAULT_DEBUG_TO_FIX_POLICY.fixStage, ...overrides?.fixStage },
	};

	if (overrides?.handoffTags) {
		policy.handoffTags = [...overrides.handoffTags];
	}

	return policy;
}

/**
 * Get a WorkBudget from the pipeline policy for a specific stage.
 *
 * Converts the stage's DebugToFixStageConfig into a WorkerBudget
 * suitable for use with the lifecycle engine and budget controls.
 *
 * @param stage - The stage configuration to convert.
 * @returns A WorkerBudget matching the stage limits.
 */
export function stageConfigToWorkerBudget(stage: DebugToFixStageConfig): WorkerBudget {
	return {
		maxTokensPerCycle: stage.maxTokens,
		maxRuntimeMs: stage.maxRuntimeMs,
		maxConsecutiveFailures: stage.maxConsecutiveFailures,
		cooldownMs: stage.cooldownMs,
	};
}
