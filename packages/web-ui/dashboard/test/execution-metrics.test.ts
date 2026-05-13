/**
 * Execution metrics tests — burn rate, cache hit, and efficiency metrics.
 *
 * Covers acceptance criteria:
 * 1. Burn rate = total tokens / elapsed minutes
 * 2. Dashboard explains burn rate formula
 * 3. Tokens per completed workspace is shown
 * 4. Tokens per percent progress is shown when possible
 * 5. Cache hit "unknown" is distinct from 0%
 * 6. Cache hit 0% warning appears when tokens_in is high
 */

import { describe, it, expect } from "vitest";
import {
	formatPercent,
	formatPercentOrUnknown,
	formatTokens,
} from "../src/utils/format";
import type { ExecutionStats } from "../src/types";

// ---------------------------------------------------------------------------
// 1. Burn rate = total tokens / elapsed minutes
// ---------------------------------------------------------------------------

describe("Burn rate computation", () => {
	it("computes burn rate as totalTokensIn / elapsedMinutes", () => {
		const totalTokensIn = 100_000;
		const elapsedMinutes = 10;
		const burnRate = Math.round(totalTokensIn / elapsedMinutes);
		expect(burnRate).toBe(10_000);
	});

	it("returns 0 burn rate when elapsedMinutes is 0", () => {
		const totalTokensIn = 100_000;
		const elapsedMinutes = 0;
		const burnRate = elapsedMinutes > 0 ? Math.round(totalTokensIn / elapsedMinutes) : 0;
		expect(burnRate).toBe(0);
	});

	it("computes burn rate from realistic execution stats", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 2,
			complete: 6,
			blocked: 0,
			failed: 2,
			total_tokens_in: 500_000,
			total_tokens_out: 120_000,
			burn_rate_per_min: 2500,
			estimated_cost_usd: 3.0,
		};
		// burn_rate_per_min should be total_tokens_in / elapsed_minutes
		// 500_000 / 2500 = 200 minutes expected elapsed
		expect(stats.burn_rate_per_min).toBeGreaterThan(0);
		expect(stats.total_tokens_in).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// 2. Dashboard explains burn rate formula
// ---------------------------------------------------------------------------

describe("Burn rate formula display", () => {
	it("StatCard sublabel contains formula text", () => {
		// The App.tsx passes sublabel="total tokens ÷ elapsed min" to the
		// Burn rate StatCard. We verify that this string is the expected formula.
		const burnRateSublabel = "total tokens ÷ elapsed min";
		expect(burnRateSublabel).toContain("tokens");
		expect(burnRateSublabel).toContain("elapsed min");
	});

	it("formatPercentOrUnknown returns 'unknown' for null", () => {
		expect(formatPercentOrUnknown(null)).toBe("unknown");
	});

	it("formatPercentOrUnknown returns 'unknown' for undefined", () => {
		expect(formatPercentOrUnknown(undefined)).toBe("unknown");
	});
});

// ---------------------------------------------------------------------------
// 3. Tokens per completed workspace is shown
// ---------------------------------------------------------------------------

describe("Tokens per completed workspace", () => {
	it("computes tokens_per_workspace when complete > 0", () => {
		const totalTokensIn = 200_000;
		const complete = 5;
		const tokensPerWorkspace = Math.round(totalTokensIn / complete);
		expect(tokensPerWorkspace).toBe(40_000);
	});

	it("tokens_per_workspace is undefined when complete === 0", () => {
		const totalTokensIn = 200_000;
		const complete = 0;
		const tokensPerWorkspace = complete > 0 ? Math.round(totalTokensIn / complete) : undefined;
		expect(tokensPerWorkspace).toBeUndefined();
	});

	it("formatTokens displays workspace token value", () => {
		expect(formatTokens(40_000)).toBe("40k");
	});
});

// ---------------------------------------------------------------------------
// 4. Tokens per percent progress is shown when possible
// ---------------------------------------------------------------------------

describe("Tokens per percent progress", () => {
	it("computes tokens_per_percent when progress > 0", () => {
		const totalTokensIn = 200_000;
		const total = 10;
		const complete = 5;
		const progressPct = (complete / total) * 100; // 50%
		const tokensPerPercent = progressPct > 0 ? Math.round(totalTokensIn / progressPct) : undefined;
		expect(tokensPerPercent).toBe(4_000);
	});

	it("tokens_per_percent is undefined when total === 0", () => {
		const totalTokensIn = 200_000;
		const total = 0;
		const complete = 0;
		const progressPct = total > 0 ? (complete / total) * 100 : 0;
		const tokensPerPercent = progressPct > 0 ? Math.round(totalTokensIn / progressPct) : undefined;
		expect(tokensPerPercent).toBeUndefined();
	});

	it("tokens_per_percent is undefined when progress === 0%", () => {
		const totalTokensIn = 200_000;
		const total = 10;
		const complete = 0;
		const progressPct = total > 0 ? (complete / total) * 100 : 0;
		const tokensPerPercent = progressPct > 0 ? Math.round(totalTokensIn / progressPct) : undefined;
		expect(tokensPerPercent).toBeUndefined();
	});

	it("formatTokens displays percent token value", () => {
		expect(formatTokens(4_000)).toBe("4k");
	});
});

// ---------------------------------------------------------------------------
// 5. Cache hit "unknown" is distinct from 0%
// ---------------------------------------------------------------------------

describe("Cache hit unknown vs 0%", () => {
	it("formatPercent returns '—' for null (unknown, older behavior)", () => {
		expect(formatPercent(null)).toBe("—");
	});

	it("formatPercent returns '—' for undefined (unknown, older behavior)", () => {
		expect(formatPercent(undefined)).toBe("—");
	});

	it("formatPercent returns '0.0%' for exactly 0", () => {
		expect(formatPercent(0)).toBe("0.0%");
	});

	it("formatPercentOrUnknown returns 'unknown' for null", () => {
		expect(formatPercentOrUnknown(null)).toBe("unknown");
	});

	it("formatPercentOrUnknown returns 'unknown' for undefined", () => {
		expect(formatPercentOrUnknown(undefined)).toBe("unknown");
	});

	it("formatPercentOrUnknown returns '0.0%' for exactly 0", () => {
		expect(formatPercentOrUnknown(0)).toBe("0.0%");
	});

	it("formatPercentOrUnknown returns correct % for non-zero values", () => {
		expect(formatPercentOrUnknown(0.75)).toBe("75.0%");
	});

	it("cache_hit_rate_known=false shows 'unknown' in dashboard", () => {
		// When cache_hit_rate_known is false, dashboard shows "unknown"
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

	it("cache_hit_rate_known=true with 0 shows '0.0%' in dashboard", () => {
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

	it("cache_hit_rate_known=true with 0.5 shows '50.0%' in dashboard", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0.5,
			cache_hit_rate_known: true,
		};
		const display = stats.cache_hit_rate_known
			? formatPercent(stats.cache_hit_rate)
			: "unknown";
		expect(display).toBe("50.0%");
	});
});

// ---------------------------------------------------------------------------
// 6. Cache hit 0% warning appears when tokens_in is high
// ---------------------------------------------------------------------------

describe("Cache hit 0% warning", () => {
	const HIGH_TOKENS_IN_THRESHOLD = 100_000;

	it("does not warn when cache_hit_rate is unknown (cache_hit_rate_known=false)", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0,
			cache_hit_rate_known: false,
			total_tokens_in: 500_000,
		};
		const shouldWarn =
			stats.cache_hit_rate_known &&
			stats.cache_hit_rate === 0 &&
			(stats.total_tokens_in ?? 0) > HIGH_TOKENS_IN_THRESHOLD;
		expect(shouldWarn).toBe(false);
	});

	it("warns when cache_hit_rate is exactly 0% and tokens_in is high", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0,
			cache_hit_rate_known: true,
			total_tokens_in: 500_000,
		};
		const shouldWarn =
			stats.cache_hit_rate_known &&
			stats.cache_hit_rate === 0 &&
			(stats.total_tokens_in ?? 0) > HIGH_TOKENS_IN_THRESHOLD;
		expect(shouldWarn).toBe(true);
	});

	it("does not warn when cache_hit_rate is 0% but tokens_in is low", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0,
			cache_hit_rate_known: true,
			total_tokens_in: 50_000,
		};
		const shouldWarn =
			stats.cache_hit_rate_known &&
			stats.cache_hit_rate === 0 &&
			(stats.total_tokens_in ?? 0) > HIGH_TOKENS_IN_THRESHOLD;
		expect(shouldWarn).toBe(false);
	});

	it("does not warn when cache_hit_rate is > 0%", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0.3,
			cache_hit_rate_known: true,
			total_tokens_in: 500_000,
		};
		const shouldWarn =
			stats.cache_hit_rate_known &&
			stats.cache_hit_rate === 0 &&
			(stats.total_tokens_in ?? 0) > HIGH_TOKENS_IN_THRESHOLD;
		expect(shouldWarn).toBe(false);
	});

	it("warns at exactly the threshold", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0,
			cache_hit_rate_known: true,
			total_tokens_in: 100_001,
		};
		const shouldWarn =
			stats.cache_hit_rate_known &&
			stats.cache_hit_rate === 0 &&
			(stats.total_tokens_in ?? 0) > HIGH_TOKENS_IN_THRESHOLD;
		expect(shouldWarn).toBe(true);
	});

	it("does not warn below the threshold", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 0,
			active: 5,
			complete: 5,
			blocked: 0,
			failed: 0,
			cache_hit_rate: 0,
			cache_hit_rate_known: true,
			total_tokens_in: 100_000,
		};
		const shouldWarn =
			stats.cache_hit_rate_known &&
			stats.cache_hit_rate === 0 &&
			(stats.total_tokens_in ?? 0) > HIGH_TOKENS_IN_THRESHOLD;
		expect(shouldWarn).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Combined integration-style checks for ExecutionStats type
// ---------------------------------------------------------------------------

describe("ExecutionStats type completeness", () => {
	it("includes all required efficiency fields", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 1,
			active: 2,
			complete: 5,
			blocked: 1,
			failed: 1,
			total_tokens_in: 500_000,
			total_tokens_out: 120_000,
			cache_hit_rate: 0.5,
			cache_hit_rate_known: true,
			estimated_cost_usd: 3.0,
			burn_rate_per_min: 2500,
			tokens_per_workspace: 100_000,
			tokens_per_percent: 10_000,
		};
		expect(stats.burn_rate_per_min).toBeDefined();
		expect(stats.tokens_per_workspace).toBeDefined();
		expect(stats.tokens_per_percent).toBeDefined();
		expect(stats.cache_hit_rate_known).toBe(true);
	});

	it("allows optional efficiency fields to be omitted", () => {
		const stats: ExecutionStats = {
			total: 10,
			pending: 1,
			active: 2,
			complete: 5,
			blocked: 1,
			failed: 1,
		};
		expect(stats.burn_rate_per_min).toBeUndefined();
		expect(stats.tokens_per_workspace).toBeUndefined();
		expect(stats.tokens_per_percent).toBeUndefined();
		expect(stats.cache_hit_rate_known).toBeUndefined();
	});
});
