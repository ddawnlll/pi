/**
 * Performance routes tests — server-side pure function tests.
 *
 * Tests the metric calculation helpers and lock extraction logic from
 * performance-routes.ts. These are pure functions with no Fastify/HTTP
 * dependency, so they can be tested directly without spinning up a server.
 *
 * Covers acceptance criteria:
 * 1. Dashboard shows cache/prompt/validation performance metrics
 * 2. Cache unknown is distinct from 0%
 * 3. Workspace detail shows prefix/suffix token split
 * 4. Validation lock wait time is visible
 * 5. Metric calculation tests pass
 */

import { describe, expect, it } from "vitest";
import {
	computeCacheHitRate,
	computeTokenSplit,
	computeValidationLockMetrics,
	extractValidationLockWaitTimes,
	formatPercentForPerformance,
} from "../src/performance-routes.js";

// ---------------------------------------------------------------------------
// 1. Cache hit rate computation
// ---------------------------------------------------------------------------

describe("computeCacheHitRate", () => {
	it("returns unknown when both inputs are null", () => {
		const result = computeCacheHitRate(null, null);
		expect(result.rate).toBeNull();
		expect(result.known).toBe(false);
	});

	it("returns unknown when both inputs are undefined", () => {
		const result = computeCacheHitRate(undefined, undefined);
		expect(result.rate).toBeNull();
		expect(result.known).toBe(false);
	});

	it("returns 0 (known) when both are zero", () => {
		const result = computeCacheHitRate(0, 0);
		expect(result.rate).toBe(0);
		expect(result.known).toBe(true);
	});

	it("returns 0 when creation tokens exist but no read tokens", () => {
		const result = computeCacheHitRate(5000, 0);
		expect(result.rate).toBe(0);
		expect(result.known).toBe(true);
	});

	it("returns 1.0 when only read tokens exist", () => {
		const result = computeCacheHitRate(0, 5000);
		expect(result.rate).toBe(1);
		expect(result.known).toBe(true);
	});

	it("computes correct ratio for mixed values", () => {
		const result = computeCacheHitRate(1000, 3000);
		expect(result.rate).toBeCloseTo(0.75, 2);
		expect(result.known).toBe(true);
	});

	it("handles one null with one defined (creation null)", () => {
		const result = computeCacheHitRate(null, 1000);
		expect(result.rate).toBe(1);
		expect(result.known).toBe(true);
	});

	it("handles one null with one defined (read null)", () => {
		const result = computeCacheHitRate(1000, null);
		expect(result.rate).toBe(0);
		expect(result.known).toBe(true);
	});

	it("handles one undefined with one defined", () => {
		const result = computeCacheHitRate(undefined, 2000);
		expect(result.rate).toBe(1);
		expect(result.known).toBe(true);
	});

	it("handles very small values", () => {
		const result = computeCacheHitRate(1, 1);
		expect(result.rate).toBeCloseTo(0.5, 5);
		expect(result.known).toBe(true);
	});

	it("handles realistic Anthropic-style values (60% hit)", () => {
		const result = computeCacheHitRate(4000, 6000);
		expect(result.rate).toBeCloseTo(0.6, 3);
		expect(result.known).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 2. Cache unknown vs 0% distinction
// ---------------------------------------------------------------------------

describe("formatPercentForPerformance — unknown vs 0% distinction", () => {
	it("returns 'unknown' when value is null and known is false", () => {
		expect(formatPercentForPerformance(null, false)).toBe("unknown");
	});

	it("returns 'unknown' when value is undefined and known is false", () => {
		expect(formatPercentForPerformance(undefined, false)).toBe("unknown");
	});

	it("returns '0.0%' when value is 0 and known is true", () => {
		expect(formatPercentForPerformance(0, true)).toBe("0.0%");
	});

	it("returns '50.0%' for known 0.5", () => {
		expect(formatPercentForPerformance(0.5, true)).toBe("50.0%");
	});

	it("returns '100.0%' for known 1.0", () => {
		expect(formatPercentForPerformance(1.0, true)).toBe("100.0%");
	});

	it("unknown is not same string as 0%", () => {
		expect(formatPercentForPerformance(null, false)).not.toBe("0.0%");
		expect(formatPercentForPerformance(0, true)).not.toBe("unknown");
	});

	it("returns 'unknown' when known is true but value is null", () => {
		expect(formatPercentForPerformance(null, true)).toBe("unknown");
	});
});

// ---------------------------------------------------------------------------
// 3. Token split computation
// ---------------------------------------------------------------------------

describe("computeTokenSplit", () => {
	it("returns nulls when both inputs are null", () => {
		const result = computeTokenSplit(null, null);
		expect(result.prefixTokenCount).toBeNull();
		expect(result.suffixTokenCount).toBeNull();
		expect(result.totalTokenCount).toBeNull();
	});

	it("returns nulls when both inputs are undefined", () => {
		const result = computeTokenSplit(undefined, undefined);
		expect(result.prefixTokenCount).toBeNull();
		expect(result.suffixTokenCount).toBeNull();
		expect(result.totalTokenCount).toBeNull();
	});

	it("computes token counts using chars/4 heuristic", () => {
		const result = computeTokenSplit(4000, 8000);
		expect(result.prefixTokenCount).toBe(1000);
		expect(result.suffixTokenCount).toBe(2000);
		expect(result.totalTokenCount).toBe(3000);
	});

	it("uses ceiling for chars/4 conversion", () => {
		expect(computeTokenSplit(1, 1).prefixTokenCount).toBe(1);
		expect(computeTokenSplit(4, 4).prefixTokenCount).toBe(1);
		expect(computeTokenSplit(5, 5).prefixTokenCount).toBe(2);
		expect(computeTokenSplit(5, 5).suffixTokenCount).toBe(2);
	});

	it("prefix only (suffix null) returns suffix 0", () => {
		const result = computeTokenSplit(4000, null);
		expect(result.prefixTokenCount).toBe(1000);
		expect(result.suffixTokenCount).toBe(0);
		expect(result.totalTokenCount).toBe(1000);
	});

	it("suffix only (prefix null) returns prefix 0", () => {
		const result = computeTokenSplit(null, 8000);
		expect(result.prefixTokenCount).toBe(0);
		expect(result.suffixTokenCount).toBe(2000);
		expect(result.totalTokenCount).toBe(2000);
	});

	it("zero chars gives zero tokens", () => {
		const result = computeTokenSplit(0, 0);
		expect(result.prefixTokenCount).toBe(0);
		expect(result.suffixTokenCount).toBe(0);
		expect(result.totalTokenCount).toBe(0);
	});

	it("handles large values", () => {
		const result = computeTokenSplit(200000, 50000);
		expect(result.prefixTokenCount).toBe(50000);
		expect(result.suffixTokenCount).toBe(12500);
		expect(result.totalTokenCount).toBe(62500);
	});
});

// ---------------------------------------------------------------------------
// 4. Validation lock metrics
// ---------------------------------------------------------------------------

describe("computeValidationLockMetrics", () => {
	it("returns all null for empty array", () => {
		const result = computeValidationLockMetrics([]);
		expect(result.lockWaits).toBe(0);
		expect(result.totalLockWaitMs).toBeNull();
		expect(result.maxLockWaitMs).toBeNull();
		expect(result.avgLockWaitMs).toBeNull();
	});

	it("handles single wait", () => {
		const result = computeValidationLockMetrics([200]);
		expect(result.lockWaits).toBe(1);
		expect(result.totalLockWaitMs).toBe(200);
		expect(result.maxLockWaitMs).toBe(200);
		expect(result.avgLockWaitMs).toBe(200);
	});

	it("handles multiple waits", () => {
		const result = computeValidationLockMetrics([100, 200, 300]);
		expect(result.lockWaits).toBe(3);
		expect(result.totalLockWaitMs).toBe(600);
		expect(result.maxLockWaitMs).toBe(300);
		expect(result.avgLockWaitMs).toBe(200);
	});

	it("handles zero wait", () => {
		const result = computeValidationLockMetrics([0]);
		expect(result.lockWaits).toBe(1);
		expect(result.totalLockWaitMs).toBe(0);
		expect(result.maxLockWaitMs).toBe(0);
		expect(result.avgLockWaitMs).toBe(0);
	});

	it("handles mixed waits including zero", () => {
		const result = computeValidationLockMetrics([0, 100, 500, 2000]);
		expect(result.lockWaits).toBe(4);
		expect(result.totalLockWaitMs).toBe(2600);
		expect(result.maxLockWaitMs).toBe(2000);
		expect(result.avgLockWaitMs).toBe(650);
	});
});

// ---------------------------------------------------------------------------
// 5. Validation lock wait time extraction from journal events
// ---------------------------------------------------------------------------

describe("extractValidationLockWaitTimes", () => {
	it("extracts wait/acquired pairs by command", () => {
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" } },
			{ type: "validation_lock_acquired", timestamp: 1150, data: { command: "npm test" } },
			{ type: "validation_lock_waiting", timestamp: 2000, data: { command: "vitest" } },
			{ type: "validation_lock_acquired", timestamp: 2500, data: { command: "vitest" } },
		];
		const waitTimes = extractValidationLockWaitTimes(events);
		expect(waitTimes).toEqual([150, 500]);
	});

	it("ignores non-lock events", () => {
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" } },
			{ type: "other_event", timestamp: 2000 },
			{ type: "validation_lock_acquired", timestamp: 2500, data: { command: "unknown" } },
		];
		const waitTimes = extractValidationLockWaitTimes(events);
		expect(waitTimes).toEqual([]);
	});

	it("handles unmatched waiting without acquired", () => {
		const events = [{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" } }];
		const waitTimes = extractValidationLockWaitTimes(events);
		expect(waitTimes).toEqual([]);
	});

	it("handles unmatched acquired without waiting", () => {
		const events = [{ type: "validation_lock_acquired", timestamp: 1000, data: { command: "npm test" } }];
		const waitTimes = extractValidationLockWaitTimes(events);
		expect(waitTimes).toEqual([]);
	});

	it("handles interleaved commands", () => {
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000, data: { command: "npm test" } },
			{ type: "validation_lock_waiting", timestamp: 1100, data: { command: "vitest" } },
			{ type: "validation_lock_acquired", timestamp: 1200, data: { command: "npm test" } },
			{ type: "validation_lock_released", timestamp: 1300, data: { command: "npm test" } },
			{ type: "validation_lock_acquired", timestamp: 1400, data: { command: "vitest" } },
			{ type: "validation_lock_released", timestamp: 1500, data: { command: "vitest" } },
		];
		const waitTimes = extractValidationLockWaitTimes(events);
		expect(waitTimes).toEqual([200, 300]);
	});

	it("handles events with no data field", () => {
		const events = [
			{ type: "validation_lock_waiting", timestamp: 1000 },
			{ type: "validation_lock_acquired", timestamp: 1200 },
		];
		const waitTimes = extractValidationLockWaitTimes(events);
		// Both default to "unknown" command key, so they match
		expect(waitTimes).toEqual([200]);
	});

	it("handles empty events array", () => {
		const waitTimes = extractValidationLockWaitTimes([]);
		expect(waitTimes).toEqual([]);
	});
});
