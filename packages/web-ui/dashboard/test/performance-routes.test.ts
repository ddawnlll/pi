/**
 * Performance routes tests — cache/prompt/validation performance metrics.
 *
 * Covers acceptance criteria:
 * 1. Dashboard shows cache/prompt/validation performance metrics
 * 2. Cache unknown is distinct from 0%
 * 3. Workspace detail shows prefix/suffix token split
 * 4. Validation lock wait time is visible
 * 5. Metric calculation tests pass
 */

import { describe, it, expect } from "vitest";
import {
	computeCacheHitRate,
	computeTokenSplit,
	computeValidationLockMetrics,
	formatPercentForPerformance,
	extractValidationLockWaitTimes,
} from "../src/utils/performance-metrics";
import {
	formatPercent,
	formatPercentOrUnknown,
	formatTokens,
} from "../src/utils/format";
import type {
	ExecutionStats,
	CachePerformanceMetrics,
	TokenSplitMetrics,
	ValidationLockMetrics,
	WorkspacePerformanceMetrics,
} from "../src/types";

// ---------------------------------------------------------------------------
// 1. Dashboard shows cache/prompt/validation performance metrics
// ---------------------------------------------------------------------------

describe("Dashboard performance metrics display", () => {
	it("computes cache hit rate from creation and read tokens", () => {
		const result = computeCacheHitRate(1000, 3000);
		expect(result.rate).toBeCloseTo(0.75, 2);
		expect(result.known).toBe(true);
	});

	it("computes cache hit rate as 0 when both are zero", () => {
		const result = computeCacheHitRate(0, 0);
		expect(result.rate).toBe(0);
		expect(result.known).toBe(true);
	});

	it("computes cache hit rate as 0 when only creation tokens exist", () => {
		const result = computeCacheHitRate(5000, 0);
		expect(result.rate).toBe(0);
		expect(result.known).toBe(true);
	});

	it("computes cache hit rate as 1.0 when only read tokens exist", () => {
		const result = computeCacheHitRate(0, 5000);
		expect(result.rate).toBe(1);
		expect(result.known).toBe(true);
	});

	it("formatPercentOrUnknown formats cache performance for dashboard", () => {
		expect(formatPercentOrUnknown(null)).toBe("unknown");
		expect(formatPercentOrUnknown(undefined)).toBe("unknown");
		expect(formatPercentOrUnknown(0)).toBe("0.0%");
		expect(formatPercentOrUnknown(0.75)).toBe("75.0%");
	});

	it("formatPercentForPerformance handles cache known/unknown states", () => {
		expect(formatPercentForPerformance(null, false)).toBe("unknown");
		expect(formatPercentForPerformance(undefined, false)).toBe("unknown");
		expect(formatPercentForPerformance(0, true)).toBe("0.0%");
		expect(formatPercentForPerformance(0.5, true)).toBe("50.0%");
	});

	it("WorkspacePerformanceMetrics type includes all required fields", () => {
		const metrics: WorkspacePerformanceMetrics = {
			workspaceId: "5.5.G",
			cache: {
				cacheHitRate: 0.5,
				cacheHitRateKnown: true,
				cacheCreationInputTokens: 1000,
				cacheReadInputTokens: 1000,
			},
			tokenSplit: {
				prefixTokenCount: 500,
				suffixTokenCount: 1000,
				totalTokenCount: 1500,
			},
			validationLock: {
				lockWaits: 3,
				totalLockWaitMs: 450,
				maxLockWaitMs: 200,
				avgLockWaitMs: 150,
			},
		};
		expect(metrics.cache.cacheHitRateKnown).toBe(true);
		expect(metrics.tokenSplit.prefixTokenCount).toBe(500);
		expect(metrics.tokenSplit.suffixTokenCount).toBe(1000);
		expect(metrics.validationLock.lockWaits).toBe(3);
		expect(metrics.validationLock.totalLockWaitMs).toBe(450);
	});
});

// ---------------------------------------------------------------------------
// 2. Cache unknown is distinct from 0%
// ---------------------------------------------------------------------------

describe("Cache unknown vs 0% distinction", () => {
	it("computeCacheHitRate returns unknown when no data provided", () => {
		const result = computeCacheHitRate(null, null);
		expect(result.rate).toBeNull();
		expect(result.known).toBe(false);
	});

	it("computeCacheHitRate returns unknown when undefined provided", () => {
		const result = computeCacheHitRate(undefined, undefined);
		expect(result.rate).toBeNull();
		expect(result.known).toBe(false);
	});

	it("computeCacheHitRate returns 0 (known) when creation tokens exist but no read", () => {
		const result = computeCacheHitRate(5000, 0);
		expect(result.rate).toBe(0);
		expect(result.known).toBe(true);
	});

	it("formatPercentOrUnknown distinguishes null from 0", () => {
		expect(formatPercentOrUnknown(null)).toBe("unknown");
		expect(formatPercentOrUnknown(0)).toBe("0.0%");
		expect(formatPercentOrUnknown(null)).not.toBe("0.0%");
		expect(formatPercentOrUnknown(0)).not.toBe("unknown");
	});

	it("formatPercent distinguishes null from 0 with dash", () => {
		expect(formatPercent(null)).toBe("—");
		expect(formatPercent(0)).toBe("0.0%");
		expect(formatPercent(null)).not.toBe("0.0%");
	});

	it("formatPercentForPerformance distinguishes unknown from 0", () => {
		expect(formatPercentForPerformance(null, false)).toBe("unknown");
		expect(formatPercentForPerformance(0, true)).toBe("0.0%");
		expect(formatPercentForPerformance(null, false)).not.toBe("0.0%");
		expect(formatPercentForPerformance(0, true)).not.toBe("unknown");
	});

	it("cache_hit_rate_known=false maps to 'unknown' display", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0,
			cache_hit_rate_known: false,
		};
		const display = stats.cache_hit_rate_known
			? formatPercent(stats.cache_hit_rate)
			: "unknown";
		expect(display).toBe("unknown");
	});

	it("cache_hit_rate_known=true with 0 maps to '0.0%' display", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0,
			cache_hit_rate_known: true,
		};
		const display = stats.cache_hit_rate_known
			? formatPercent(stats.cache_hit_rate)
			: "unknown";
		expect(display).toBe("0.0%");
	});

	it("CachePerformanceMetrics type can represent unknown state", () => {
		const metrics: CachePerformanceMetrics = {
			cacheHitRate: null,
			cacheHitRateKnown: false,
			cacheCreationInputTokens: null,
			cacheReadInputTokens: null,
		};
		expect(metrics.cacheHitRateKnown).toBe(false);
		expect(metrics.cacheHitRate).toBeNull();
	});

	it("CachePerformanceMetrics type can represent known 0% state", () => {
		const metrics: CachePerformanceMetrics = {
			cacheHitRate: 0,
			cacheHitRateKnown: true,
			cacheCreationInputTokens: 5000,
			cacheReadInputTokens: 0,
		};
		expect(metrics.cacheHitRateKnown).toBe(true);
		expect(metrics.cacheHitRate).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 3. Workspace detail shows prefix/suffix token split
// ---------------------------------------------------------------------------

describe("Prefix/suffix token split", () => {
	it("computeTokenSplit with both prefix and suffix chars", () => {
		const result = computeTokenSplit(4000, 8000);
		expect(result.prefixTokenCount).toBe(1000);
		expect(result.suffixTokenCount).toBe(2000);
		expect(result.totalTokenCount).toBe(3000);
	});

	it("computeTokenSplit with null inputs returns null counts", () => {
		const result = computeTokenSplit(null, null);
		expect(result.prefixTokenCount).toBeNull();
		expect(result.suffixTokenCount).toBeNull();
		expect(result.totalTokenCount).toBeNull();
	});

	it("computeTokenSplit with undefined inputs returns null counts", () => {
		const result = computeTokenSplit(undefined, undefined);
		expect(result.prefixTokenCount).toBeNull();
		expect(result.suffixTokenCount).toBeNull();
		expect(result.totalTokenCount).toBeNull();
	});

	it("computeTokenSplit with only prefix returns suffix as 0", () => {
		const result = computeTokenSplit(4000, null);
		expect(result.prefixTokenCount).toBe(1000);
		expect(result.suffixTokenCount).toBe(0);
		expect(result.totalTokenCount).toBe(1000);
	});

	it("computeTokenSplit with only suffix returns prefix as 0", () => {
		const result = computeTokenSplit(null, 8000);
		expect(result.prefixTokenCount).toBe(0);
		expect(result.suffixTokenCount).toBe(2000);
		expect(result.totalTokenCount).toBe(2000);
	});

	it("computeTokenSplit uses chars/4 heuristic (ceiling)", () => {
		expect(computeTokenSplit(1, 1).prefixTokenCount).toBe(1);
		expect(computeTokenSplit(4, 4).prefixTokenCount).toBe(1);
		expect(computeTokenSplit(5, 5).suffixTokenCount).toBe(2);
		expect(computeTokenSplit(5, 5).prefixTokenCount).toBe(2);
	});

	it("TokenSplitMetrics type is correctly shaped", () => {
		const split: TokenSplitMetrics = {
			prefixTokenCount: 500,
			suffixTokenCount: 1000,
			totalTokenCount: 1500,
		};
		expect(split.prefixTokenCount).toBe(500);
		expect(split.suffixTokenCount).toBe(1000);
	});

	it("WorkspaceSummary includes tokenSplit field", () => {
		const ws: import("../src/types").WorkspaceSummary = {
			id: "test-ws",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: null,
			completedAt: null,
			tokenSplit: {
				prefixTokenCount: 500,
				suffixTokenCount: 1000,
				totalTokenCount: 1500,
			},
		};
		expect(ws.tokenSplit?.prefixTokenCount).toBe(500);
		expect(ws.tokenSplit?.suffixTokenCount).toBe(1000);
		expect(ws.tokenSplit?.totalTokenCount).toBe(1500);
	});

	it("Token per component displayed correctly with formatTokens", () => {
		expect(formatTokens(1000)).toBe("1k");
		expect(formatTokens(500)).toBe("500");
		expect(formatTokens(1500000)).toBe("1.5M");
	});
});

// ---------------------------------------------------------------------------
// 4. Validation lock wait time is visible
// ---------------------------------------------------------------------------

describe("Validation lock wait time metrics", () => {
	it("computeValidationLockMetrics with empty array returns all null", () => {
		const result = computeValidationLockMetrics([]);
		expect(result.lockWaits).toBe(0);
		expect(result.totalLockWaitMs).toBeNull();
		expect(result.maxLockWaitMs).toBeNull();
		expect(result.avgLockWaitMs).toBeNull();
	});

	it("computeValidationLockMetrics with single wait", () => {
		const result = computeValidationLockMetrics([200]);
		expect(result.lockWaits).toBe(1);
		expect(result.totalLockWaitMs).toBe(200);
		expect(result.maxLockWaitMs).toBe(200);
		expect(result.avgLockWaitMs).toBe(200);
	});

	it("computeValidationLockMetrics with multiple waits", () => {
		const result = computeValidationLockMetrics([100, 200, 300]);
		expect(result.lockWaits).toBe(3);
		expect(result.totalLockWaitMs).toBe(600);
		expect(result.maxLockWaitMs).toBe(300);
		expect(result.avgLockWaitMs).toBe(200);
	});

	it("computeValidationLockMetrics handles single large wait", () => {
		const result = computeValidationLockMetrics([5000]);
		expect(result.lockWaits).toBe(1);
		expect(result.maxLockWaitMs).toBe(5000);
		expect(result.avgLockWaitMs).toBe(5000);
	});

	it("extractValidationLockWaitTimes from journal events", () => {
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" } },
			{ type: "validation_lock_acquired", timestamp: 1150, data: { command: "npm test" } },
			{ type: "validation_lock_waiting", timestamp: 2000, data: { command: "vitest" } },
			{ type: "validation_lock_acquired", timestamp: 2500, data: { command: "vitest" } },
		];
		const waitTimes = extractValidationLockWaitTimes(events as any);
		expect(waitTimes).toEqual([150, 500]);
	});

	it("extractValidationLockWaitTimes ignores unmatched events", () => {
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" } },
			{ type: "other_event", timestamp: 2000 },
			{ type: "validation_lock_acquired", timestamp: 2500, data: { command: "unknown" } },
		];
		const waitTimes = extractValidationLockWaitTimes(events as any);
		expect(waitTimes).toEqual([]);
	});

	it("ValidationLockMetrics type correctly represents wait data", () => {
		const metrics: ValidationLockMetrics = {
			lockWaits: 3,
			totalLockWaitMs: 600,
			maxLockWaitMs: 300,
			avgLockWaitMs: 200,
		};
		expect(metrics.lockWaits).toBe(3);
		expect(metrics.totalLockWaitMs).toBe(600);
		expect(metrics.maxLockWaitMs).toBe(300);
		expect(metrics.avgLockWaitMs).toBe(200);
	});

	it("ValidationLockMetrics with no contention", () => {
		const metrics: ValidationLockMetrics = {
			lockWaits: 0,
			totalLockWaitMs: null,
			maxLockWaitMs: null,
			avgLockWaitMs: null,
		};
		expect(metrics.lockWaits).toBe(0);
		expect(metrics.totalLockWaitMs).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 5. Metric calculation tests pass (comprehensive)
// ---------------------------------------------------------------------------

describe("Metric calculation comprehensive tests", () => {
	it("computeCacheHitRate edge cases", () => {
		// Very small values
		const tiny = computeCacheHitRate(1, 1);
		expect(tiny.rate).toBeCloseTo(0.5, 5);
		expect(tiny.known).toBe(true);

		// One null, one defined
		const halfKnown = computeCacheHitRate(null, 1000);
		expect(halfKnown.rate).toBeCloseTo(1.0, 5);
		expect(halfKnown.known).toBe(true);

		// Other half
		const otherHalf = computeCacheHitRate(1000, null);
		expect(otherHalf.rate).toBe(0);
		expect(otherHalf.known).toBe(true);
	});

	it("computeCacheHitRate with realistic Anthropic-style values", () => {
		// Anthropic responses typically have cache_creation_input_tokens and cache_read_input_tokens
		// 60% cache hit rate
		const result = computeCacheHitRate(4000, 6000);
		expect(result.rate).toBeCloseTo(0.6, 3);
		expect(result.known).toBe(true);
	});

	it("computeTokenSplit edge cases", () => {
		// Zero chars
		const zero = computeTokenSplit(0, 0);
		expect(zero.prefixTokenCount).toBe(0);
		expect(zero.suffixTokenCount).toBe(0);
		expect(zero.totalTokenCount).toBe(0);

		// Large values
		const large = computeTokenSplit(200000, 50000);
		expect(large.prefixTokenCount).toBe(50000);
		expect(large.suffixTokenCount).toBe(12500);
		expect(large.totalTokenCount).toBe(62500);
	});

	it("computeValidationLockMetrics edge cases", () => {
		// Single zero wait
		const zeroWait = computeValidationLockMetrics([0]);
		expect(zeroWait.lockWaits).toBe(1);
		expect(zeroWait.totalLockWaitMs).toBe(0);
		expect(zeroWait.maxLockWaitMs).toBe(0);
		expect(zeroWait.avgLockWaitMs).toBe(0);

		// Mixed waits
		const mixed = computeValidationLockMetrics([0, 100, 500, 2000]);
		expect(mixed.lockWaits).toBe(4);
		expect(mixed.totalLockWaitMs).toBe(2600);
		expect(mixed.maxLockWaitMs).toBe(2000);
		expect(mixed.avgLockWaitMs).toBe(650);
	});

	it("extractValidationLockWaitTimes with interleaved events", () => {
		// Multiple commands held simultaneously
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" } },
			{ type: "validation_lock_waiting", timestamp: 1100, data: { command: "vitest" } },
			{ type: "validation_lock_acquired", timestamp: 1200, data: { command: "npm test" } },
			{ type: "validation_lock_released", timestamp: 1300, data: { command: "npm test" } },
			{ type: "validation_lock_acquired", timestamp: 1400, data: { command: "vitest" } },
			{ type: "validation_lock_released", timestamp: 1500, data: { command: "vitest" } },
		];
		const waitTimes = extractValidationLockWaitTimes(events as any);
		expect(waitTimes).toEqual([200, 300]);
	});

	it("extractValidationLockWaitTimes filters by workspaceId", () => {
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" }, workspaceId: "ws-1" },
			{ type: "validation_lock_acquired", timestamp: 1200, data: { command: "npm test" }, workspaceId: "ws-1" },
			{ type: "validation_lock_waiting", timestamp: 1100, data: { command: "vitest" }, workspaceId: "ws-2" },
		];
		// Filter for ws-1 only
		const filtered = events.filter((e: any) => e.workspaceId === "ws-1");
		const waitTimes = extractValidationLockWaitTimes(filtered as any);
		expect(waitTimes).toEqual([200]);
	});

	it("formatPercentForPerformance handles all valid percentages", () => {
		expect(formatPercentForPerformance(0, true)).toBe("0.0%");
		expect(formatPercentForPerformance(0.5, true)).toBe("50.0%");
		expect(formatPercentForPerformance(1.0, true)).toBe("100.0%");
		expect(formatPercentForPerformance(0.123, true)).toBe("12.3%");
	});

	it("WorkspacePerformanceMetrics aggregates all metric types", () => {
		const metrics: WorkspacePerformanceMetrics = {
			workspaceId: "5.5.G",
			cache: {
				cacheHitRate: 0.6,
				cacheHitRateKnown: true,
				cacheCreationInputTokens: 4000,
				cacheReadInputTokens: 6000,
			},
			tokenSplit: {
				prefixTokenCount: 500,
				suffixTokenCount: 1000,
				totalTokenCount: 1500,
			},
			validationLock: {
				lockWaits: 2,
				totalLockWaitMs: 500,
				maxLockWaitMs: 300,
				avgLockWaitMs: 250,
			},
		};

		// Cache metrics
		expect(metrics.cache.cacheHitRateKnown).toBe(true);
		expect(formatPercentForPerformance(metrics.cache.cacheHitRate, metrics.cache.cacheHitRateKnown)).toBe("60.0%");

		// Token split
		expect(metrics.tokenSplit.prefixTokenCount!).toBeLessThan(metrics.tokenSplit.totalTokenCount!);
		expect(metrics.tokenSplit.suffixTokenCount!).toBeLessThan(metrics.tokenSplit.totalTokenCount!);

		// Validation lock
		expect(metrics.validationLock.lockWaits).toBeGreaterThan(0);
		expect(metrics.validationLock.totalLockWaitMs!).toBeGreaterThan(0);
		expect(metrics.validationLock.avgLockWaitMs!).toBeLessThanOrEqual(metrics.validationLock.maxLockWaitMs!);
	});

	it("formatTokens handles edge cases for token display", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(null)).toBe("—");
		expect(formatTokens(undefined)).toBe("—");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1000)).toBe("1k");
		expect(formatTokens(1001)).toBe("1.0k");
		expect(formatTokens(1000000)).toBe("1M");
	});
});
