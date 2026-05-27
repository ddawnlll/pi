/**
 * Signal Miner — 25.K
 *
 * Covers:
 * - SignalMiner construction and configuration
 * - Mining signals from observations
 * - Mining signals from signal patterns
 * - Mining signals from both inputs
 * - Minimum confidence threshold filtering
 * - Trend label inference (all keyword categories)
 * - Empty input handling
 * - createSignalMiner factory
 * - setConfig and getConfig
 * - Edge cases (low confidence, mixed inputs)
 */

import { describe, expect, test } from "vitest";
import {
	createSignalMiner,
	DEFAULT_SIGNAL_MINER_CONFIG,
	SignalMiner,
} from "../../src/brain-workers/idea-scout/signal-miner.js";

// =============================================================================
// SignalMiner — Constructor & Configuration
// =============================================================================

describe("SignalMiner — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const miner = new SignalMiner();
		const config = miner.getConfig();
		expect(config.minConfidence).toBe(DEFAULT_SIGNAL_MINER_CONFIG.minConfidence);
	});

	test("creates with partial configuration overrides", () => {
		const miner = new SignalMiner({ minConfidence: 0.6 });
		expect(miner.getConfig().minConfidence).toBe(0.6);
	});

	test("setConfig updates minimum confidence", () => {
		const miner = new SignalMiner();
		miner.setConfig({ minConfidence: 0.8 });
		expect(miner.getConfig().minConfidence).toBe(0.8);
	});

	test("createSignalMiner factory works", () => {
		const miner = createSignalMiner({ minConfidence: 0.5 });
		expect(miner).toBeInstanceOf(SignalMiner);
		expect(miner.getConfig().minConfidence).toBe(0.5);
	});
});

// =============================================================================
// SignalMiner — Mining Operations
// =============================================================================

describe("SignalMiner — Mining Operations", () => {
	test("mines signals from observations", () => {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		const mined = miner.mine([{ id: "obs-1", title: "error spike detected" }], []);
		expect(mined.length).toBeGreaterThanOrEqual(1);
		expect(mined[0].label).toContain("mined:");
		expect(mined[0].observationIds).toContain("obs-1");
	});

	test("mines signals from signal patterns", () => {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		const mined = miner.mine([], [{ id: "sig-1", pattern: "memory_pressure", summary: "Memory is high" }]);
		expect(mined.length).toBeGreaterThanOrEqual(1);
		expect(mined[0].label).toContain("pattern:");
	});

	test("mines signals from both observations and patterns", () => {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		const mined = miner.mine(
			[{ id: "obs-1", title: "queue blocked" }],
			[{ id: "sig-1", pattern: "integration_failure", summary: "API failing" }],
		);
		expect(mined.length).toBeGreaterThanOrEqual(2);
		const obsMined = mined.filter((m) => m.label.startsWith("mined:"));
		const patMined = mined.filter((m) => m.label.startsWith("pattern:"));
		expect(obsMined.length).toBeGreaterThanOrEqual(1);
		expect(patMined.length).toBeGreaterThanOrEqual(1);
	});

	test("returns empty array when no inputs provided", () => {
		const miner = new SignalMiner();
		const mined = miner.mine([], []);
		expect(mined).toEqual([]);
	});

	test("respects minimum confidence threshold", () => {
		// Use very high threshold so all signals are filtered out
		const miner = new SignalMiner({ minConfidence: 0.99 });
		const mined = miner.mine(
			[
				{ id: "obs-1", title: "test observation" },
				{ id: "obs-2", title: "another observation" },
			],
			[{ id: "sig-1", pattern: "test_pattern", summary: "Test signal" }],
		);
		expect(mined.length).toBe(0);
	});

	test("mined signals have valid structure", () => {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		const mined = miner.mine(
			[{ id: "obs-1", title: "error spike" }],
			[{ id: "sig-1", pattern: "slow_response", summary: "Slow API" }],
		);

		for (const signal of mined) {
			expect(signal.id).toBeDefined();
			expect(typeof signal.id).toBe("string");
			expect(signal.label).toBeDefined();
			expect(signal.description).toBeDefined();
			expect(signal.confidence).toBeGreaterThanOrEqual(0);
			expect(signal.confidence).toBeLessThanOrEqual(1);
			expect(Array.isArray(signal.observationIds)).toBe(true);
			expect(signal.trendLabel).toBeDefined();
			expect(signal.createdAt).toBeDefined();
		}
	});
});

// =============================================================================
// SignalMiner — Trend Label Inference
// =============================================================================

describe("SignalMiner — Trend Label Inference", () => {
	// We test trend labels indirectly by providing known keywords.
	// The confidence threshold is very low to ensure signals are produced.

	function getTrendLabel(title: string): string | null {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		const mined = miner.mine([{ id: "obs-1", title }], []);
		if (mined.length === 0) return null;
		return mined[0].trendLabel;
	}

	test('infers "errors-and-failures" for error keywords', () => {
		expect(getTrendLabel("error occurred")).toBe("errors-and-failures");
		expect(getTrendLabel("failed request")).toBe("errors-and-failures");
		expect(getTrendLabel("exception thrown")).toBe("errors-and-failures");
	});

	test('infers "performance" for performance keywords', () => {
		expect(getTrendLabel("performance degraded")).toBe("performance");
		expect(getTrendLabel("slow response time")).toBe("performance");
		expect(getTrendLabel("request timeout")).toBe("performance");
	});

	test('infers "memory-and-storage" for memory/storage keywords', () => {
		expect(getTrendLabel("memory leak")).toBe("memory-and-storage");
		expect(getTrendLabel("disk full")).toBe("memory-and-storage");
		expect(getTrendLabel("storage quota")).toBe("memory-and-storage");
	});

	test('infers "security" for security keywords', () => {
		expect(getTrendLabel("security breach")).toBe("security");
		expect(getTrendLabel("auth denied")).toBe("security");
		expect(getTrendLabel("permission denied")).toBe("security");
	});

	test('infers "queue-and-scheduling" for queue keywords', () => {
		expect(getTrendLabel("queue full")).toBe("queue-and-scheduling");
		expect(getTrendLabel("scheduling delay")).toBe("queue-and-scheduling");
		expect(getTrendLabel("wait time high")).toBe("queue-and-scheduling");
	});

	test('infers "integration" for integration keywords', () => {
		expect(getTrendLabel("integration test")).toBe("integration");
		expect(getTrendLabel("API rate limit")).toBe("integration");
		expect(getTrendLabel("connection lost")).toBe("integration");
	});

	test('infers "configuration" for config keywords', () => {
		expect(getTrendLabel("config mismatch")).toBe("configuration");
		expect(getTrendLabel("setting override")).toBe("configuration");
		expect(getTrendLabel("parameter update")).toBe("configuration");
	});

	test('infers "testing" for test keywords', () => {
		expect(getTrendLabel("test runner")).toBe("testing");
		expect(getTrendLabel("spec validation")).toBe("testing");
		expect(getTrendLabel("coverage report")).toBe("testing");
	});

	test('infers "documentation" for doc keywords', () => {
		expect(getTrendLabel("doc generation")).toBe("documentation");
		expect(getTrendLabel("readme update")).toBe("documentation");
		expect(getTrendLabel("code comment")).toBe("documentation");
	});

	test('infers "general" for unrecognized text', () => {
		expect(getTrendLabel("something completely different")).toBe("general");
		expect(getTrendLabel("random text here")).toBe("general");
	});
});

// =============================================================================
// SignalMiner — Edge Cases
// =============================================================================

describe("SignalMiner — Edge Cases", () => {
	test("handles large number of observations gracefully", () => {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		const observations = Array.from({ length: 100 }, (_, i) => ({
			id: `obs-${i}`,
			title: `observation ${i}`,
		}));
		const mined = miner.mine(observations, []);
		// With minConfidence 0.1, most should pass (confidence range is 0.4-0.9)
		expect(mined.length).toBe(100);
	});

	test("produces deterministic structure for same inputs (non-random at type level)", () => {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		// Run twice with same inputs
		const mined1 = miner.mine([{ id: "obs-1", title: "test" }], [{ id: "sig-1", pattern: "test", summary: "test" }]);
		const mined2 = miner.mine([{ id: "obs-1", title: "test" }], [{ id: "sig-1", pattern: "test", summary: "test" }]);
		// Both should produce the same number of results (though confidence is random)
		expect(mined1.length).toBe(mined2.length);
		// Labels should be the same
		for (let i = 0; i < mined1.length; i++) {
			expect(mined1[i].label).toBe(mined2[i].label);
		}
	});

	test("each mined signal has a unique ID", () => {
		const miner = new SignalMiner({ minConfidence: 0.1 });
		const mined = miner.mine(
			[
				{ id: "obs-1", title: "one" },
				{ id: "obs-2", title: "two" },
				{ id: "obs-3", title: "three" },
			],
			[
				{ id: "sig-1", pattern: "a", summary: "a" },
				{ id: "sig-2", pattern: "b", summary: "b" },
			],
		);
		const ids = new Set(mined.map((m) => m.id));
		expect(ids.size).toBe(mined.length);
	});
});
