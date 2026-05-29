/**
 * Worker Budget Controls — 25.R
 *
 * Covers:
 * - BudgetCheckResult and BudgetConsumption types
 * - checkTokenBudget (disabled, within limit, exceeded)
 * - checkRuntimeBudget (disabled, within limit, exceeded)
 * - checkConsecutiveFailures (within limit, exceeded)
 * - checkAllBudgets (all pass, token violation, runtime violation, failure violation)
 * - Accumulator functions (accumulateTokens, recordCycleRuntime, incrementFailureCount, etc.)
 * - Reset functions (resetFailureCount, resetCycleCounters)
 * - createBudgetConsumption
 * - Evidence-backed diagnostics on violations
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import {
	accumulateTokens,
	type BudgetConsumption,
	checkAllBudgets,
	checkConsecutiveFailures,
	checkRuntimeBudget,
	checkTokenBudget,
	createBudgetConsumption,
	incrementFailureCount,
	recordCycleRuntime,
	resetCycleCounters,
	resetFailureCount,
} from "../../src/brain-workers/runtime/budget-controls.js";
import type { WorkerBudget } from "../../src/brain-workers/types.js";

// =============================================================================
// Helpers
// =============================================================================

/** Create a standard budget for testing. */
function makeBudget(overrides: Partial<WorkerBudget> = {}): WorkerBudget {
	return {
		maxTokensPerCycle: 50_000,
		maxConsecutiveFailures: 5,
		cooldownMs: 60_000,
		maxRuntimeMs: 300_000,
		...overrides,
	};
}

/** Create a consumption snapshot for testing. */
function makeConsumption(overrides: Partial<BudgetConsumption> = {}): BudgetConsumption {
	return {
		currentCycleTokens: 0,
		totalTokens: 0,
		currentCycleRuntimeMs: 0,
		consecutiveFailures: 0,
		...overrides,
	};
}

// =============================================================================
// BudgetConsumption / createBudgetConsumption
// =============================================================================

describe("createBudgetConsumption", () => {
	test("creates a zeroed consumption snapshot", () => {
		const c = createBudgetConsumption();
		expect(c.currentCycleTokens).toBe(0);
		expect(c.totalTokens).toBe(0);
		expect(c.currentCycleRuntimeMs).toBe(0);
		expect(c.consecutiveFailures).toBe(0);
	});
});

// =============================================================================
// Accumulator Functions
// =============================================================================

describe("accumulateTokens", () => {
	test("adds tokens to current cycle and total", () => {
		const c = createBudgetConsumption();
		accumulateTokens(c, 1000);
		expect(c.currentCycleTokens).toBe(1000);
		expect(c.totalTokens).toBe(1000);
	});

	test("accumulates multiple calls", () => {
		const c = createBudgetConsumption();
		accumulateTokens(c, 500);
		accumulateTokens(c, 1500);
		expect(c.currentCycleTokens).toBe(2000);
		expect(c.totalTokens).toBe(2000);
	});

	test("returns the same reference", () => {
		const c = createBudgetConsumption();
		const result = accumulateTokens(c, 100);
		expect(result).toBe(c);
	});
});

describe("recordCycleRuntime", () => {
	test("records runtime in milliseconds", () => {
		const c = createBudgetConsumption();
		recordCycleRuntime(c, 150_000);
		expect(c.currentCycleRuntimeMs).toBe(150_000);
	});

	test("overwrites previous runtime value", () => {
		const c = createBudgetConsumption();
		recordCycleRuntime(c, 100_000);
		recordCycleRuntime(c, 200_000);
		expect(c.currentCycleRuntimeMs).toBe(200_000);
	});

	test("returns the same reference", () => {
		const c = createBudgetConsumption();
		const result = recordCycleRuntime(c, 100);
		expect(result).toBe(c);
	});
});

describe("incrementFailureCount", () => {
	test("increments consecutive failures by 1", () => {
		const c = createBudgetConsumption();
		incrementFailureCount(c);
		expect(c.consecutiveFailures).toBe(1);
	});

	test("increments from non-zero", () => {
		const c = makeConsumption({ consecutiveFailures: 3 });
		incrementFailureCount(c);
		expect(c.consecutiveFailures).toBe(4);
	});

	test("returns the same reference", () => {
		const c = createBudgetConsumption();
		const result = incrementFailureCount(c);
		expect(result).toBe(c);
	});
});

describe("resetFailureCount", () => {
	test("resets consecutive failures to 0", () => {
		const c = makeConsumption({ consecutiveFailures: 4 });
		resetFailureCount(c);
		expect(c.consecutiveFailures).toBe(0);
	});

	test("returns the same reference", () => {
		const c = makeConsumption({ consecutiveFailures: 2 });
		const result = resetFailureCount(c);
		expect(result).toBe(c);
	});
});

describe("resetCycleCounters", () => {
	test("resets cycle tokens and runtime to 0", () => {
		const c = makeConsumption({ currentCycleTokens: 10_000, currentCycleRuntimeMs: 120_000 });
		resetCycleCounters(c);
		expect(c.currentCycleTokens).toBe(0);
		expect(c.currentCycleRuntimeMs).toBe(0);
	});

	test("preserves totalTokens and consecutiveFailures", () => {
		const c = makeConsumption({
			currentCycleTokens: 10_000,
			totalTokens: 50_000,
			currentCycleRuntimeMs: 120_000,
			consecutiveFailures: 3,
		});
		resetCycleCounters(c);
		expect(c.totalTokens).toBe(50_000);
		expect(c.consecutiveFailures).toBe(3);
	});

	test("returns the same reference", () => {
		const c = createBudgetConsumption();
		const result = resetCycleCounters(c);
		expect(result).toBe(c);
	});
});

// =============================================================================
// checkTokenBudget
// =============================================================================

describe("checkTokenBudget", () => {
	test("passes when consumption is under limit", () => {
		const budget = makeBudget({ maxTokensPerCycle: 50_000 });
		const result = checkTokenBudget(budget, { currentCycleTokens: 25_000 });
		expect(result.passed).toBe(true);
		expect(result.violation).toBeUndefined();
		expect(result.message).toContain("OK");
	});

	test("passes when consumption equals limit", () => {
		const budget = makeBudget({ maxTokensPerCycle: 50_000 });
		const result = checkTokenBudget(budget, { currentCycleTokens: 50_000 });
		expect(result.passed).toBe(true);
	});

	test("fails when consumption exceeds limit", () => {
		const budget = makeBudget({ maxTokensPerCycle: 50_000 });
		const result = checkTokenBudget(budget, { currentCycleTokens: 50_001 });
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("token");
		expect(result.message).toContain("Token budget exceeded");
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.stopCondition).toBe("token_budget_exhausted");
	});

	test("passes (disabled) when maxTokensPerCycle is 0", () => {
		const budget = makeBudget({ maxTokensPerCycle: 0 });
		const result = checkTokenBudget(budget, { currentCycleTokens: 999_999 });
		expect(result.passed).toBe(true);
		expect(result.message).toContain("disabled");
	});

	test("diagnostic contains context with consumption data", () => {
		const budget = makeBudget({ maxTokensPerCycle: 10_000 });
		const result = checkTokenBudget(budget, { currentCycleTokens: 15_000 }, ["evidence:token-log"]);
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.context.currentCycleTokens).toBe(15_000);
		expect(result.diagnostic!.context.maxTokensPerCycle).toBe(10_000);
		expect(result.diagnostic!.evidenceRefs).toContain("evidence:token-log");
	});
});

// =============================================================================
// checkRuntimeBudget
// =============================================================================

describe("checkRuntimeBudget", () => {
	test("passes when runtime is under limit", () => {
		const budget = makeBudget({ maxRuntimeMs: 300_000 });
		const result = checkRuntimeBudget(budget, 150_000);
		expect(result.passed).toBe(true);
		expect(result.violation).toBeUndefined();
		expect(result.message).toContain("OK");
	});

	test("passes when runtime equals limit", () => {
		const budget = makeBudget({ maxRuntimeMs: 300_000 });
		const result = checkRuntimeBudget(budget, 300_000);
		expect(result.passed).toBe(true);
	});

	test("fails when runtime exceeds limit", () => {
		const budget = makeBudget({ maxRuntimeMs: 300_000 });
		const result = checkRuntimeBudget(budget, 300_001);
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("runtime");
		expect(result.message).toContain("Runtime budget exceeded");
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.stopCondition).toBe("timeout");
	});

	test("passes (disabled) when maxRuntimeMs is 0", () => {
		const budget = makeBudget({ maxRuntimeMs: 0 });
		const result = checkRuntimeBudget(budget, 999_999);
		expect(result.passed).toBe(true);
		expect(result.message).toContain("disabled");
	});

	test("handles zero elapsed time", () => {
		const budget = makeBudget({ maxRuntimeMs: 300_000 });
		const result = checkRuntimeBudget(budget, 0);
		expect(result.passed).toBe(true);
	});

	test("diagnostic contains elapsed and max runtime", () => {
		const budget = makeBudget({ maxRuntimeMs: 10_000 });
		const result = checkRuntimeBudget(budget, 20_000, ["evidence:runtime-trace"]);
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.context.currentCycleRuntimeMs).toBe(20_000);
		expect(result.diagnostic!.context.maxRuntimeMs).toBe(10_000);
		expect(result.diagnostic!.evidenceRefs).toContain("evidence:runtime-trace");
	});
});

// =============================================================================
// checkConsecutiveFailures
// =============================================================================

describe("checkConsecutiveFailures", () => {
	test("passes when failures are under limit", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 5 });
		const result = checkConsecutiveFailures(budget, 3);
		expect(result.passed).toBe(true);
		expect(result.violation).toBeUndefined();
		expect(result.message).toContain("OK");
	});

	test("passes when failures are exactly at limit minus one", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 5 });
		const result = checkConsecutiveFailures(budget, 4);
		expect(result.passed).toBe(true);
	});

	test("fails when failures equal maxConsecutiveFailures", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 5 });
		const result = checkConsecutiveFailures(budget, 5);
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("consecutive_failures");
		expect(result.message).toContain("Consecutive failure budget exceeded");
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.stopCondition).toBe("consecutive_failures_exceeded");
	});

	test("fails when failures exceed maxConsecutiveFailures", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 5 });
		const result = checkConsecutiveFailures(budget, 7);
		expect(result.passed).toBe(false);
	});

	test("handles zero consecutive failures", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 3 });
		const result = checkConsecutiveFailures(budget, 0);
		expect(result.passed).toBe(true);
	});

	test("diagnostic contains failure count context", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 3 });
		const result = checkConsecutiveFailures(budget, 5, ["evidence:failure-log"]);
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.context.consecutiveFailures).toBe(5);
		expect(result.diagnostic!.context.maxConsecutiveFailures).toBe(3);
		expect(result.diagnostic!.evidenceRefs).toContain("evidence:failure-log");
	});
});

// =============================================================================
// checkAllBudgets
// =============================================================================

describe("checkAllBudgets", () => {
	test("returns pass result when all budgets are within limits", () => {
		const budget = makeBudget();
		const consumption = makeConsumption({
			currentCycleTokens: 25_000,
			totalTokens: 100_000,
			currentCycleRuntimeMs: 150_000,
			consecutiveFailures: 2,
		});
		const result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(true);
		expect(result.message).toBe("All budget checks passed");
	});

	test("detects token budget violation first", () => {
		const budget = makeBudget({ maxTokensPerCycle: 50_000, maxRuntimeMs: 300_000, maxConsecutiveFailures: 5 });
		const consumption = makeConsumption({
			currentCycleTokens: 60_000, // EXCEEDED
			currentCycleRuntimeMs: 400_000, // Also exceeded, but token check runs first
			consecutiveFailures: 0,
		});
		const result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("token");
	});

	test("detects runtime budget violation after token check passes", () => {
		const budget = makeBudget({ maxTokensPerCycle: 50_000, maxRuntimeMs: 300_000, maxConsecutiveFailures: 5 });
		const consumption = makeConsumption({
			currentCycleTokens: 25_000, // OK
			currentCycleRuntimeMs: 400_000, // EXCEEDED
			consecutiveFailures: 0,
		});
		const result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("runtime");
	});

	test("detects consecutive failure violation last", () => {
		const budget = makeBudget({ maxTokensPerCycle: 50_000, maxRuntimeMs: 300_000, maxConsecutiveFailures: 3 });
		const consumption = makeConsumption({
			currentCycleTokens: 25_000, // OK
			currentCycleRuntimeMs: 150_000, // OK
			consecutiveFailures: 5, // EXCEEDED
		});
		const result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("consecutive_failures");
	});

	test("returns consumption snapshot in result", () => {
		const budget = makeBudget();
		const consumption = makeConsumption({ currentCycleTokens: 10_000, consecutiveFailures: 1 });
		const result = checkAllBudgets(budget, consumption);
		expect(result.consumption.currentCycleTokens).toBe(10_000);
		expect(result.consumption.consecutiveFailures).toBe(1);
	});

	test("passes when token and runtime budgets are disabled (0 values) and failures under threshold", () => {
		const budget = makeBudget({ maxTokensPerCycle: 0, maxRuntimeMs: 0, maxConsecutiveFailures: 5 });
		const consumption = makeConsumption({
			currentCycleTokens: 999_999,
			currentCycleRuntimeMs: 999_999,
			consecutiveFailures: 2, // Under maxConsecutiveFailures threshold
		});
		const result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(true);
	});

	test("passes evidence refs through to diagnostics", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 1 });
		const consumption = makeConsumption({ consecutiveFailures: 2 });
		const result = checkAllBudgets(budget, consumption, ["evidence:failure-log"]);
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.evidenceRefs).toContain("evidence:failure-log");
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge cases", () => {
	test("accumulateTokens with zero tokens does not change consumption", () => {
		const c = createBudgetConsumption();
		accumulateTokens(c, 0);
		expect(c.currentCycleTokens).toBe(0);
		expect(c.totalTokens).toBe(0);
	});

	test("accumulateTokens with negative tokens decreases consumption", () => {
		const c = makeConsumption({ currentCycleTokens: 1000, totalTokens: 5000 });
		accumulateTokens(c, -200);
		expect(c.currentCycleTokens).toBe(800);
		expect(c.totalTokens).toBe(4800);
	});

	test("recordCycleRuntime with zero resets runtime", () => {
		const c = makeConsumption({ currentCycleRuntimeMs: 150_000 });
		recordCycleRuntime(c, 0);
		expect(c.currentCycleRuntimeMs).toBe(0);
	});

	test("incrementFailureCount from 0 to 1", () => {
		const c = createBudgetConsumption();
		incrementFailureCount(c);
		expect(c.consecutiveFailures).toBe(1);
	});

	test("resetFailureCount on already zero consumption", () => {
		const c = createBudgetConsumption();
		resetFailureCount(c);
		expect(c.consecutiveFailures).toBe(0);
	});

	test("checkRuntimeBudget with negative elapsed time should pass (elapsed < limit)", () => {
		const budget = makeBudget({ maxRuntimeMs: 1000 });
		const result = checkRuntimeBudget(budget, -1);
		expect(result.passed).toBe(true);
	});

	test("checkConsecutiveFailures with maxConsecutiveFailures = 1", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 1 });

		// 0 failures should pass
		expect(checkConsecutiveFailures(budget, 0).passed).toBe(true);

		// 1 failure should fail
		expect(checkConsecutiveFailures(budget, 1).passed).toBe(false);

		// 2 failures should fail
		expect(checkConsecutiveFailures(budget, 2).passed).toBe(false);
	});
});

// =============================================================================
// Integration: Full Cycle Pattern
// =============================================================================

describe("Integration: full cycle budget enforcement", () => {
	test("simulates a complete work cycle with budget tracking", () => {
		const budget = makeBudget({ maxTokensPerCycle: 100_000, maxRuntimeMs: 60_000, maxConsecutiveFailures: 3 });
		const consumption = createBudgetConsumption();

		// Simulate work: accumulate tokens
		accumulateTokens(consumption, 30_000);
		accumulateTokens(consumption, 20_000);

		// Record runtime
		recordCycleRuntime(consumption, 45_000);

		// Check budgets — should all pass
		let result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(true);

		// Simulate more work
		accumulateTokens(consumption, 40_000);
		recordCycleRuntime(consumption, 55_000);

		result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(true); // 90k tokens < 100k, 55s < 60s

		// Exceed runtime
		recordCycleRuntime(consumption, 65_000);
		result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("runtime");
	});

	test("simulates consecutive failure escalation leading to violation", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 3 });
		const consumption = createBudgetConsumption();

		// Simulate 3 failures
		incrementFailureCount(consumption);
		expect(checkAllBudgets(budget, consumption).passed).toBe(true);

		incrementFailureCount(consumption);
		expect(checkAllBudgets(budget, consumption).passed).toBe(true);

		incrementFailureCount(consumption);
		// Third failure: consecutiveFailures = 3 >= maxConsecutiveFailures = 3
		const result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(false);
		expect(result.violation).toBe("consecutive_failures");
	});

	test("reset after failure allows new cycle checks", () => {
		const budget = makeBudget({ maxConsecutiveFailures: 3 });
		const consumption = createBudgetConsumption();

		// 2 failures
		incrementFailureCount(consumption);
		incrementFailureCount(consumption);

		// Success — reset failure count
		resetFailureCount(consumption);

		// Start new cycle — reset cycle counters
		resetCycleCounters(consumption);

		// Should pass
		const result = checkAllBudgets(budget, consumption);
		expect(result.passed).toBe(true);
		expect(consumption.consecutiveFailures).toBe(0);
		expect(consumption.currentCycleTokens).toBe(0);
		expect(consumption.currentCycleRuntimeMs).toBe(0);
	});
});
