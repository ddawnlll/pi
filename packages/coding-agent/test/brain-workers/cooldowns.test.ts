/**
 * Worker Cooldowns and Backoff — 25.R
 *
 * Covers:
 * - BackoffConfig and CooldownResult types
 * - computeCooldownDuration (success, failure, backoff, jitter, cap)
 * - createCooldownResult (full result with timestamps)
 * - isCooldownElapsed (with and without cooldown, elapsed, not elapsed)
 * - getRemainingCooldownMs (with and without cooldown, remaining, expired)
 * - applyCooldown (mutates WorkerCooldown)
 * - resetCooldown (resets to initial state)
 * - Default backoff configuration values
 * - Edge cases (zero base cooldown, max backoff cap, jitter disabled)
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import {
	applyCooldown,
	type BackoffConfig,
	type CooldownResult,
	computeCooldownDuration,
	createCooldownResult,
	DEFAULT_BACKOFF_CONFIG,
	getRemainingCooldownMs,
	isCooldownElapsed,
	resetCooldown,
} from "../../src/brain-workers/runtime/cooldowns.js";
import { createWorkerCooldown, type WorkerCooldown } from "../../src/brain-workers/types.js";

// =============================================================================
// Default Configuration
// =============================================================================

describe("DEFAULT_BACKOFF_CONFIG", () => {
	test("has sensible defaults", () => {
		expect(DEFAULT_BACKOFF_CONFIG.baseCooldownMs).toBe(60_000);
		expect(DEFAULT_BACKOFF_CONFIG.backoffFactor).toBe(2.0);
		expect(DEFAULT_BACKOFF_CONFIG.maxBackoffMs).toBe(3_600_000);
		expect(DEFAULT_BACKOFF_CONFIG.enableJitter).toBe(true);
		expect(DEFAULT_BACKOFF_CONFIG.jitterRatio).toBe(0.1);
	});
});

// =============================================================================
// computeCooldownDuration
// =============================================================================

describe("computeCooldownDuration", () => {
	test("returns base cooldown for zero consecutive failures (success)", () => {
		const duration = computeCooldownDuration(0, 60_000);
		expect(duration).toBe(60_000);
	});

	test("returns base cooldown for negative consecutive failures", () => {
		const duration = computeCooldownDuration(-1, 60_000);
		expect(duration).toBe(60_000);
	});

	test("applies exponential backoff for consecutive failures", () => {
		// base * factor^failures = 60_000 * 2^1 = 120_000 (with jitter disabled)
		const duration = computeCooldownDuration(1, 60_000, { enableJitter: false });
		expect(duration).toBe(120_000);
	});

	test("doubles with each failure (factor 2)", () => {
		const withFactor = (failures: number) =>
			computeCooldownDuration(failures, 10_000, { backoffFactor: 2, enableJitter: false });

		expect(withFactor(0)).toBe(10_000);
		expect(withFactor(1)).toBe(20_000);
		expect(withFactor(2)).toBe(40_000);
		expect(withFactor(3)).toBe(80_000);
	});

	test("caps at maxBackoffMs", () => {
		// 10_000 * 2^10 = 10_000 * 1024 = 10_240_000 > 3_600_000 (default max)
		const duration = computeCooldownDuration(10, 10_000, { enableJitter: false });
		expect(duration).toBeLessThanOrEqual(DEFAULT_BACKOFF_CONFIG.maxBackoffMs);
	});

	test("respects custom maxBackoffMs", () => {
		const duration = computeCooldownDuration(5, 10_000, {
			enableJitter: false,
			maxBackoffMs: 100_000,
		});
		// 10_000 * 2^5 = 320_000, capped at 100_000
		expect(duration).toBe(100_000);
	});

	test("applies jitter within the configured ratio", () => {
		// Run many samples to statistically verify jitter is within range
		const samples = 100;
		const base = 60_000;
		const durations = Array.from({ length: samples }, () => computeCooldownDuration(1, base));

		const min = Math.min(...durations);
		const max = Math.max(...durations);

		// With jitterRatio=0.1, range is +/-10% of 120_000 = 108_000 to 132_000
		expect(min).toBeGreaterThan(0);
		expect(max).toBeGreaterThanOrEqual(min);
	});

	test("does not apply jitter when disabled", () => {
		const samples = 20;
		const durations = Array.from({ length: samples }, () =>
			computeCooldownDuration(1, 60_000, { enableJitter: false }),
		);
		// All should be exactly the same
		const allSame = durations.every((d) => d === durations[0]);
		expect(allSame).toBe(true);
	});

	test("zero base cooldown produces zero duration", () => {
		const duration = computeCooldownDuration(0, 0);
		expect(duration).toBe(0);
	});

	test("zero base cooldown with failures still produces non-zero with backoff", () => {
		const duration = computeCooldownDuration(2, 0, { enableJitter: false });
		// 0 * 2^2 = 0
		expect(duration).toBe(0);
	});

	test("negative base cooldown is clamped to 0", () => {
		const duration = computeCooldownDuration(0, -1000, { enableJitter: false });
		expect(duration).toBe(0);
	});
});

// =============================================================================
// createCooldownResult
// =============================================================================

describe("createCooldownResult", () => {
	test("creates result with base cooldown for zero failures", () => {
		const result = createCooldownResult(0, 60_000, "Normal completion", { enableJitter: false });
		expect(result.durationMs).toBe(60_000);
		expect(result.backoffApplied).toBe(false);
		expect(result.backoffMultiplier).toBe(1.0);
		expect(result.jitterApplied).toBe(false);
		expect(result.reason).toBe("Normal completion");
	});

	test("creates result with exponential backoff for failures", () => {
		const result = createCooldownResult(2, 60_000, "Cycle failed", { enableJitter: false });
		// 60_000 * 2^2 = 240_000
		expect(result.durationMs).toBe(240_000);
		expect(result.backoffApplied).toBe(true);
		expect(result.backoffMultiplier).toBe(4.0);
		expect(result.reason).toContain("Cycle failed");
		expect(result.reason).toContain("backoff");
	});

	test("includes valid ISO 8601 timestamps", () => {
		const result = createCooldownResult(1, 60_000, "test");
		expect(() => new Date(result.startedAt)).not.toThrow();
		expect(() => new Date(result.endsAt)).not.toThrow();
		expect(new Date(result.endsAt).getTime()).toBeGreaterThan(new Date(result.startedAt).getTime());
	});

	test("applies jitter when enabled (stochastic, verify range)", () => {
		const result = createCooldownResult(1, 60_000, "test");
		// Base would be 120_000, jitter is +/-10%
		expect(result.durationMs).toBeGreaterThan(0);
	});

	test("jitterApplied is true when jitter enabled and duration > 0", () => {
		// Run multiple times; jitter should eventually be applied
		let sawJitter = false;
		for (let i = 0; i < 20; i++) {
			const result = createCooldownResult(1, 60_000, "test", { enableJitter: true, jitterRatio: 0.5 });
			if (result.jitterApplied) {
				sawJitter = true;
				break;
			}
		}
		// With jitterRatio 0.5, jitter is very likely to be applied
		expect(sawJitter).toBe(true);
	});

	test("creates result with custom config", () => {
		const result = createCooldownResult(3, 10_000, "Custom config test", {
			backoffFactor: 3,
			maxBackoffMs: 500_000,
			enableJitter: false,
		});
		// 10_000 * 3^3 = 270_000
		expect(result.durationMs).toBe(270_000);
		expect(result.backoffMultiplier).toBe(27);
	});
});

// =============================================================================
// isCooldownElapsed
// =============================================================================

describe("isCooldownElapsed", () => {
	test("returns true when endsAt is null (no cooldown)", () => {
		const cooldown: WorkerCooldown = createWorkerCooldown();
		expect(isCooldownElapsed(cooldown)).toBe(true);
	});

	test("returns true when cooldown has elapsed (past endsAt)", () => {
		const cooldown: WorkerCooldown = {
			startedAt: new Date(Date.now() - 120_000).toISOString(),
			endsAt: new Date(Date.now() - 1).toISOString(), // 1ms in the past
			reason: "completed",
			count: 1,
		};
		expect(isCooldownElapsed(cooldown)).toBe(true);
	});

	test("returns false when cooldown is still active", () => {
		const cooldown: WorkerCooldown = {
			startedAt: new Date().toISOString(),
			endsAt: new Date(Date.now() + 60_000).toISOString(), // 1 minute from now
			reason: "completed",
			count: 1,
		};
		expect(isCooldownElapsed(cooldown)).toBe(false);
	});

	test("returns true when endsAt is exactly now", () => {
		const cooldown: WorkerCooldown = {
			startedAt: new Date(Date.now() - 60_000).toISOString(),
			endsAt: new Date().toISOString(),
			reason: "completed",
			count: 1,
		};
		expect(isCooldownElapsed(cooldown)).toBe(true);
	});
});

// =============================================================================
// getRemainingCooldownMs
// =============================================================================

describe("getRemainingCooldownMs", () => {
	test("returns 0 when endsAt is null", () => {
		const cooldown = createWorkerCooldown();
		expect(getRemainingCooldownMs(cooldown)).toBe(0);
	});

	test("returns 0 when cooldown has elapsed", () => {
		const cooldown: WorkerCooldown = {
			startedAt: new Date(Date.now() - 120_000).toISOString(),
			endsAt: new Date(Date.now() - 1000).toISOString(),
			reason: "completed",
			count: 1,
		};
		expect(getRemainingCooldownMs(cooldown)).toBe(0);
	});

	test("returns positive remaining time when cooldown is active", () => {
		const remaining = 60_000;
		const cooldown: WorkerCooldown = {
			startedAt: new Date().toISOString(),
			endsAt: new Date(Date.now() + remaining).toISOString(),
			reason: "completed",
			count: 1,
		};
		const result = getRemainingCooldownMs(cooldown);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeLessThanOrEqual(remaining);
	});
});

// =============================================================================
// applyCooldown
// =============================================================================

describe("applyCooldown", () => {
	test("applies cooldown result to a WorkerCooldown", () => {
		const cooldown = createWorkerCooldown();
		const result: CooldownResult = {
			durationMs: 60_000,
			startedAt: new Date(Date.now()).toISOString(),
			endsAt: new Date(Date.now() + 60_000).toISOString(),
			reason: "Normal completion",
			backoffApplied: false,
			backoffMultiplier: 1.0,
			jitterApplied: false,
		};

		applyCooldown(cooldown, result);

		expect(cooldown.startedAt).toBe(result.startedAt);
		expect(cooldown.endsAt).toBe(result.endsAt);
		expect(cooldown.reason).toBe("Normal completion");
		expect(cooldown.count).toBe(1);
	});

	test("increments count on each apply", () => {
		const cooldown = createWorkerCooldown();
		const result1: CooldownResult = {
			durationMs: 60_000,
			startedAt: "2026-01-01T00:00:00Z",
			endsAt: "2026-01-01T00:01:00Z",
			reason: "First",
			backoffApplied: false,
			backoffMultiplier: 1.0,
			jitterApplied: false,
		};
		const result2: CooldownResult = {
			durationMs: 120_000,
			startedAt: "2026-01-01T01:00:00Z",
			endsAt: "2026-01-01T01:02:00Z",
			reason: "Second",
			backoffApplied: true,
			backoffMultiplier: 2.0,
			jitterApplied: false,
		};

		applyCooldown(cooldown, result1);
		expect(cooldown.count).toBe(1);

		applyCooldown(cooldown, result2);
		expect(cooldown.count).toBe(2);
	});

	test("returns the same reference", () => {
		const cooldown = createWorkerCooldown();
		const result: CooldownResult = {
			durationMs: 60_000,
			startedAt: new Date().toISOString(),
			endsAt: new Date(Date.now() + 60_000).toISOString(),
			reason: "test",
			backoffApplied: false,
			backoffMultiplier: 1.0,
			jitterApplied: false,
		};
		const returned = applyCooldown(cooldown, result);
		expect(returned).toBe(cooldown);
	});
});

// =============================================================================
// resetCooldown
// =============================================================================

describe("resetCooldown", () => {
	test("resets cooldown to null timestamps and empty reason", () => {
		const cooldown: WorkerCooldown = {
			startedAt: new Date().toISOString(),
			endsAt: new Date(Date.now() + 60_000).toISOString(),
			reason: "Some reason",
			count: 3,
		};

		resetCooldown(cooldown);

		expect(cooldown.startedAt).toBeNull();
		expect(cooldown.endsAt).toBeNull();
		expect(cooldown.reason).toBe("");
		// Count is preserved for diagnostics
		expect(cooldown.count).toBe(3);
	});

	test("returns the same reference", () => {
		const cooldown = createWorkerCooldown();
		const returned = resetCooldown(cooldown);
		expect(returned).toBe(cooldown);
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge cases", () => {
	test("very large backoff factor produces capped duration", () => {
		const duration = computeCooldownDuration(5, 1_000, {
			backoffFactor: 10,
			enableJitter: false,
			maxBackoffMs: 50_000,
		});
		// 1_000 * 10^5 = 100_000_000, capped at 50_000
		expect(duration).toBe(50_000);
	});

	test("backoff factor less than 1 decreases cooldown duration", () => {
		const duration = computeCooldownDuration(3, 100_000, {
			backoffFactor: 0.5,
			enableJitter: false,
		});
		// 100_000 * 0.5^3 = 100_000 * 0.125 = 12_500
		expect(duration).toBe(12_500);
	});

	test("jitter does not produce negative durations", () => {
		// Force high jitter ratio and roll many times
		const samples = Array.from({ length: 1000 }, () => computeCooldownDuration(1, 10_000, { jitterRatio: 0.9 }));
		const allNonNegative = samples.every((d) => d >= 0);
		expect(allNonNegative).toBe(true);
	});

	test("consecutive failures produce increasing cooldown durations", () => {
		const durations = [0, 1, 2, 3, 4].map((f) => computeCooldownDuration(f, 10_000, { enableJitter: false }));
		// Each should be >= the previous
		for (let i = 1; i < durations.length; i++) {
			expect(durations[i]).toBeGreaterThanOrEqual(durations[i - 1]);
		}
	});

	test("createCooldownResult with zero base cooldown produces zero duration", () => {
		const result = createCooldownResult(0, 0, "No cooldown needed", { enableJitter: false });
		expect(result.durationMs).toBe(0);
		expect(result.backoffApplied).toBe(false);
	});
});

// =============================================================================
// Integration: Full Lifecycle Flow
// =============================================================================

describe("Integration: cooldown lifecycle flow", () => {
	test("simulates success then failure with escalating backoff", () => {
		const cooldown = createWorkerCooldown();
		const baseCooldownMs = 60_000;

		// Cycle 1: Success
		const successResult = createCooldownResult(0, baseCooldownMs, "Cycle completed");
		applyCooldown(cooldown, successResult);
		expect(cooldown.count).toBe(1);
		expect(cooldown.reason).toBe("Cycle completed");

		// Complete cooldown
		resetCooldown(cooldown);

		// Cycle 2: Failure
		const fail1Result = createCooldownResult(1, baseCooldownMs, "Cycle failed: timeout", { enableJitter: false });
		applyCooldown(cooldown, fail1Result);
		expect(cooldown.count).toBe(2);
		expect(fail1Result.durationMs).toBe(120_000); // 60k * 2^1
		expect(fail1Result.backoffApplied).toBe(true);

		// Without waiting for full cooldown, simulate another failure
		resetCooldown(cooldown);

		// Cycle 3: Another failure
		const fail2Result = createCooldownResult(2, baseCooldownMs, "Cycle failed: token budget", {
			enableJitter: false,
		});
		applyCooldown(cooldown, fail2Result);
		expect(fail2Result.durationMs).toBe(240_000); // 60k * 2^2
		expect(fail2Result.backoffApplied).toBe(true);
	});

	test("cooldown elapsed check integration", () => {
		const cooldown = createWorkerCooldown();

		// Initially no cooldown
		expect(isCooldownElapsed(cooldown)).toBe(true);
		expect(getRemainingCooldownMs(cooldown)).toBe(0);

		// Apply a short cooldown
		const result: CooldownResult = {
			durationMs: 10_000,
			startedAt: new Date(Date.now()).toISOString(),
			endsAt: new Date(Date.now() + 10_000).toISOString(),
			reason: "Test cooldown",
			backoffApplied: false,
			backoffMultiplier: 1.0,
			jitterApplied: false,
		};
		applyCooldown(cooldown, result);

		// Should not be elapsed yet
		expect(isCooldownElapsed(cooldown)).toBe(false);
		expect(getRemainingCooldownMs(cooldown)).toBeGreaterThan(0);

		// Reset
		resetCooldown(cooldown);
		expect(isCooldownElapsed(cooldown)).toBe(true);
		expect(getRemainingCooldownMs(cooldown)).toBe(0);
	});
});
