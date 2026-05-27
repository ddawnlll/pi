/**
 * Worker Budget Controls — 25.R
 *
 * Standalone budget enforcement utilities for brain worker resource
 * management. Supports token budgeting, runtime budgeting, consecutive
 * failure tracking, and evidence-backed diagnostics for all budget
 * violations.
 *
 * These functions can be used independently of the full lifecycle engine
 * wherever budget enforcement is needed.
 *
 * Dependencies: ../types.ts (WorkerBudget, WorkerDiagnostic, WorkerStopCondition)
 *
 * @packageDocumentation
 */

import { createWorkerDiagnostic, type WorkerBudget, type WorkerDiagnostic } from "../types.js";

// ---------------------------------------------------------------------------
// Budget Check Result
// ---------------------------------------------------------------------------

/**
 * Result of a budget check.
 *
 * Provides both a boolean pass/fail indicator and detailed diagnostic
 * information when a budget violation is detected.
 */
export interface BudgetCheckResult {
	/** Whether the budget check passed (no violation). */
	passed: boolean;
	/** The type of budget that was exceeded, if any. */
	violation?: "token" | "runtime" | "consecutive_failures";
	/** Human-readable message explaining the result. */
	message: string;
	/** Diagnostic with evidence references, if a violation occurred. */
	diagnostic?: WorkerDiagnostic;
	/** Current consumption snapshot at time of check. */
	consumption: BudgetConsumption;
}

/**
 * Snapshot of current budget consumption.
 */
export interface BudgetConsumption {
	/** Tokens consumed in the current cycle. */
	currentCycleTokens: number;
	/** Total tokens consumed across all cycles. */
	totalTokens: number;
	/** Current cycle runtime in milliseconds. */
	currentCycleRuntimeMs: number;
	/** Current consecutive failure count. */
	consecutiveFailures: number;
}

// ---------------------------------------------------------------------------
// Check Helpers
// ---------------------------------------------------------------------------

/**
 * Check token budget against consumption.
 *
 * @param budget - The worker's budget configuration.
 * @param consumption - Current consumption snapshot.
 * @param evidenceRefs - Optional evidence references for diagnostics.
 * @returns A BudgetCheckResult with diagnostic if violated.
 */
export function checkTokenBudget(
	budget: WorkerBudget,
	consumption: Pick<BudgetConsumption, "currentCycleTokens">,
	evidenceRefs: string[] = [],
): BudgetCheckResult {
	if (budget.maxTokensPerCycle === 0) {
		return {
			passed: true,
			message: "Token budget is disabled (maxTokensPerCycle=0)",
			consumption: { ...consumption, totalTokens: 0, currentCycleRuntimeMs: 0, consecutiveFailures: 0 },
		};
	}

	if (consumption.currentCycleTokens > budget.maxTokensPerCycle) {
		return {
			passed: false,
			violation: "token",
			message: `Token budget exceeded: ${consumption.currentCycleTokens} / ${budget.maxTokensPerCycle}`,
			diagnostic: createWorkerDiagnostic(
				"token_budget_exhausted",
				`Worker exceeded maxTokensPerCycle budget: ${consumption.currentCycleTokens} > ${budget.maxTokensPerCycle}`,
				{
					currentCycleTokens: consumption.currentCycleTokens,
					maxTokensPerCycle: budget.maxTokensPerCycle,
				},
				evidenceRefs,
			),
			consumption: { ...consumption, totalTokens: 0, currentCycleRuntimeMs: 0, consecutiveFailures: 0 },
		};
	}

	return {
		passed: true,
		message: `Token budget OK: ${consumption.currentCycleTokens} / ${budget.maxTokensPerCycle}`,
		consumption: { ...consumption, totalTokens: 0, currentCycleRuntimeMs: 0, consecutiveFailures: 0 },
	};
}

/**
 * Check runtime budget against elapsed time.
 *
 * @param budget - The worker's budget configuration.
 * @param elapsedMs - Elapsed wall-clock time for the current cycle.
 * @param evidenceRefs - Optional evidence references for diagnostics.
 * @returns A BudgetCheckResult with diagnostic if violated.
 */
export function checkRuntimeBudget(
	budget: WorkerBudget,
	elapsedMs: number,
	evidenceRefs: string[] = [],
): BudgetCheckResult {
	if (budget.maxRuntimeMs === 0) {
		return {
			passed: true,
			message: "Runtime budget is disabled (maxRuntimeMs=0)",
			consumption: {
				currentCycleTokens: 0,
				totalTokens: 0,
				currentCycleRuntimeMs: elapsedMs,
				consecutiveFailures: 0,
			},
		};
	}

	if (elapsedMs > budget.maxRuntimeMs) {
		return {
			passed: false,
			violation: "runtime",
			message: `Runtime budget exceeded: ${elapsedMs}ms / ${budget.maxRuntimeMs}ms`,
			diagnostic: createWorkerDiagnostic(
				"timeout",
				`Worker cycle exceeded maxRuntimeMs budget: ${elapsedMs}ms > ${budget.maxRuntimeMs}ms`,
				{
					currentCycleRuntimeMs: elapsedMs,
					maxRuntimeMs: budget.maxRuntimeMs,
				},
				evidenceRefs,
			),
			consumption: {
				currentCycleTokens: 0,
				totalTokens: 0,
				currentCycleRuntimeMs: elapsedMs,
				consecutiveFailures: 0,
			},
		};
	}

	return {
		passed: true,
		message: `Runtime budget OK: ${elapsedMs}ms / ${budget.maxRuntimeMs}ms`,
		consumption: { currentCycleTokens: 0, totalTokens: 0, currentCycleRuntimeMs: elapsedMs, consecutiveFailures: 0 },
	};
}

/**
 * Check consecutive failure budget.
 *
 * @param budget - The worker's budget configuration.
 * @param consecutiveFailures - Current consecutive failure count.
 * @param evidenceRefs - Optional evidence references for diagnostics.
 * @returns A BudgetCheckResult with diagnostic if violated.
 */
export function checkConsecutiveFailures(
	budget: WorkerBudget,
	consecutiveFailures: number,
	evidenceRefs: string[] = [],
): BudgetCheckResult {
	if (consecutiveFailures >= budget.maxConsecutiveFailures) {
		return {
			passed: false,
			violation: "consecutive_failures",
			message: `Consecutive failure budget exceeded: ${consecutiveFailures} >= ${budget.maxConsecutiveFailures}`,
			diagnostic: createWorkerDiagnostic(
				"consecutive_failures_exceeded",
				`Worker exceeded max consecutive failures: ${consecutiveFailures} >= ${budget.maxConsecutiveFailures}`,
				{
					consecutiveFailures,
					maxConsecutiveFailures: budget.maxConsecutiveFailures,
				},
				evidenceRefs,
			),
			consumption: { currentCycleTokens: 0, totalTokens: 0, currentCycleRuntimeMs: 0, consecutiveFailures },
		};
	}

	return {
		passed: true,
		message: `Consecutive failure budget OK: ${consecutiveFailures} / ${budget.maxConsecutiveFailures}`,
		consumption: { currentCycleTokens: 0, totalTokens: 0, currentCycleRuntimeMs: 0, consecutiveFailures },
	};
}

/**
 * Run all budget checks against a worker's consumption.
 *
 * This is the recommended entry point for comprehensive budget enforcement.
 * Returns the first violation found, or a passing result if all checks pass.
 *
 * @param budget - The worker's budget configuration.
 * @param consumption - Full consumption snapshot.
 * @param evidenceRefs - Optional evidence references for diagnostics.
 * @returns The first failing BudgetCheckResult, or a passing result.
 */
export function checkAllBudgets(
	budget: WorkerBudget,
	consumption: BudgetConsumption,
	evidenceRefs: string[] = [],
): BudgetCheckResult {
	// Check token budget first
	const tokenResult = checkTokenBudget(budget, consumption, evidenceRefs);
	if (!tokenResult.passed) return tokenResult;

	// Check runtime budget
	const runtimeResult = checkRuntimeBudget(budget, consumption.currentCycleRuntimeMs, evidenceRefs);
	if (!runtimeResult.passed) return runtimeResult;

	// Check consecutive failures
	const failureResult = checkConsecutiveFailures(budget, consumption.consecutiveFailures, evidenceRefs);
	if (!failureResult.passed) return failureResult;

	return {
		passed: true,
		message: "All budget checks passed",
		consumption,
	};
}

/**
 * Create a fresh BudgetConsumption from a worker's budget defaults.
 *
 * @returns A zeroed BudgetConsumption.
 */
export function createBudgetConsumption(): BudgetConsumption {
	return {
		currentCycleTokens: 0,
		totalTokens: 0,
		currentCycleRuntimeMs: 0,
		consecutiveFailures: 0,
	};
}

/**
 * Accumulate token usage into a BudgetConsumption.
 *
 * @param consumption - The current consumption to update in-place.
 * @param tokens - Tokens to add.
 * @returns The updated consumption (same reference).
 */
export function accumulateTokens(consumption: BudgetConsumption, tokens: number): BudgetConsumption {
	consumption.currentCycleTokens += tokens;
	consumption.totalTokens += tokens;
	return consumption;
}

/**
 * Record cycle runtime into a BudgetConsumption.
 *
 * @param consumption - The current consumption to update in-place.
 * @param runtimeMs - Runtime in milliseconds for this cycle.
 * @returns The updated consumption (same reference).
 */
export function recordCycleRuntime(consumption: BudgetConsumption, runtimeMs: number): BudgetConsumption {
	consumption.currentCycleRuntimeMs = runtimeMs;
	return consumption;
}

/**
 * Increment consecutive failure counter.
 *
 * @param consumption - The current consumption to update in-place.
 * @returns The updated consumption (same reference).
 */
export function incrementFailureCount(consumption: BudgetConsumption): BudgetConsumption {
	consumption.consecutiveFailures++;
	return consumption;
}

/**
 * Reset consecutive failure counter (on successful cycle).
 *
 * @param consumption - The current consumption to update in-place.
 * @returns The updated consumption (same reference).
 */
export function resetFailureCount(consumption: BudgetConsumption): BudgetConsumption {
	consumption.consecutiveFailures = 0;
	return consumption;
}

/**
 * Reset cycle-specific counters (tokens and runtime) at the start
 * of a new work cycle.
 *
 * @param consumption - The current consumption to update in-place.
 * @returns The updated consumption (same reference).
 */
export function resetCycleCounters(consumption: BudgetConsumption): BudgetConsumption {
	consumption.currentCycleTokens = 0;
	consumption.currentCycleRuntimeMs = 0;
	return consumption;
}
