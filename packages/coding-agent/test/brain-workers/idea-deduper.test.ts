/**
 * Idea Deduper — 25.K
 *
 * Covers:
 * - IdeaDeduper construction and configuration
 * - Hash computation (deterministic, different for different inputs)
 * - checkAndRecord: duplicate detection within window, bypass when expired
 * - isDuplicate: read-only check
 * - record: explicit recording
 * - Disabled dedup bypasses all checks
 * - Pruning expired entries
 * - Clear/reset
 * - Stats tracking
 * - Edge cases (empty window, window expiry timing)
 */

import { describe, expect, test } from "vitest";
import {
	createIdeaDeduper,
	DEFAULT_IDEA_DEDUPER_CONFIG,
	IdeaDeduper,
} from "../../src/brain-workers/idea-scout/idea-deduper.js";

// =============================================================================
// IdeaDeduper — Constructor & Configuration
// =============================================================================

describe("IdeaDeduper — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const deduper = new IdeaDeduper();
		const config = deduper.getConfig();
		expect(config.enabled).toBe(true);
		expect(config.windowMs).toBe(DEFAULT_IDEA_DEDUPER_CONFIG.windowMs);
	});

	test("creates with partial configuration overrides", () => {
		const deduper = new IdeaDeduper({ enabled: false, windowMs: 10_000 });
		const config = deduper.getConfig();
		expect(config.enabled).toBe(false);
		expect(config.windowMs).toBe(10_000);
	});

	test("setConfig updates configuration", () => {
		const deduper = new IdeaDeduper();
		deduper.setConfig({ enabled: false });
		expect(deduper.getConfig().enabled).toBe(false);

		deduper.setConfig({ windowMs: 60_000 });
		expect(deduper.getConfig().windowMs).toBe(60_000);
	});

	test("createIdeaDeduper factory works", () => {
		const deduper = createIdeaDeduper({ windowMs: 5000 });
		expect(deduper).toBeInstanceOf(IdeaDeduper);
		expect(deduper.getConfig().windowMs).toBe(5000);
	});

	test("initial size is 0", () => {
		const deduper = new IdeaDeduper();
		expect(deduper.size).toBe(0);
	});

	test("initial stats are all zeros", () => {
		const deduper = new IdeaDeduper();
		const stats = deduper.getStats();
		expect(stats.historySize).toBe(0);
		expect(stats.totalDeduped).toBe(0);
		expect(stats.enabled).toBe(true);
		expect(stats.windowMs).toBe(DEFAULT_IDEA_DEDUPER_CONFIG.windowMs);
	});
});

// =============================================================================
// IdeaDeduper — Hash Computation
// =============================================================================

describe("IdeaDeduper — Hash Computation", () => {
	test("computeHash produces deterministic hashes", () => {
		const deduper = new IdeaDeduper();
		const hash1 = deduper.computeHash("same-input");
		const hash2 = deduper.computeHash("same-input");
		expect(hash1).toBe(hash2);
	});

	test("computeHash produces different hashes for different inputs", () => {
		const deduper = new IdeaDeduper();
		const hash1 = deduper.computeHash("input-a");
		const hash2 = deduper.computeHash("input-b");
		expect(hash1).not.toBe(hash2);
	});

	test("computeHash produces hex string of expected length", () => {
		const deduper = new IdeaDeduper();
		const hash = deduper.computeHash("test");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});
});

// =============================================================================
// IdeaDeduper — checkAndRecord
// =============================================================================

describe("IdeaDeduper — checkAndRecord", () => {
	test("returns false for unseen hash", () => {
		const deduper = new IdeaDeduper();
		expect(deduper.checkAndRecord("hash-1")).toBe(false);
	});

	test("returns true for duplicate hash within window", () => {
		const deduper = new IdeaDeduper({ windowMs: 100_000 });
		deduper.checkAndRecord("hash-1");
		expect(deduper.checkAndRecord("hash-1")).toBe(true);
	});

	test("allows duplicate after window expires", () => {
		const deduper = new IdeaDeduper({ windowMs: 1 }); // 1ms window
		deduper.checkAndRecord("hash-1");

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(deduper.checkAndRecord("hash-1")).toBe(false);
				resolve();
			}, 10);
		});
	});

	test("returns false for different hashes", () => {
		const deduper = new IdeaDeduper({ windowMs: 100_000 });
		deduper.checkAndRecord("hash-1");
		expect(deduper.checkAndRecord("hash-2")).toBe(false);
	});

	test("updates stats correctly", () => {
		const deduper = new IdeaDeduper({ windowMs: 100_000 });
		deduper.checkAndRecord("hash-1");
		expect(deduper.getStats().totalDeduped).toBe(0);

		deduper.checkAndRecord("hash-1");
		expect(deduper.getStats().totalDeduped).toBe(1);

		deduper.checkAndRecord("hash-2");
		expect(deduper.getStats().totalDeduped).toBe(1);
	});
});

// =============================================================================
// IdeaDeduper — isDuplicate
// =============================================================================

describe("IdeaDeduper — isDuplicate", () => {
	test("returns false for unseen hash", () => {
		const deduper = new IdeaDeduper();
		expect(deduper.isDuplicate("unknown")).toBe(false);
	});

	test("returns true for recorded hash within window", () => {
		const deduper = new IdeaDeduper({ windowMs: 100_000 });
		deduper.record("hash-1");
		expect(deduper.isDuplicate("hash-1")).toBe(true);
	});

	test("returns false for expired hash", () => {
		const deduper = new IdeaDeduper({ windowMs: 1 });
		deduper.record("hash-1");

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(deduper.isDuplicate("hash-1")).toBe(false);
				resolve();
			}, 10);
		});
	});

	test("does not mutate state (read-only check)", () => {
		const deduper = new IdeaDeduper();
		deduper.isDuplicate("something");
		expect(deduper.size).toBe(0); // Should not have recorded
	});
});

// =============================================================================
// IdeaDeduper — Disabled Mode
// =============================================================================

describe("IdeaDeduper — Disabled Mode", () => {
	test("checkAndRecord always returns false when disabled", () => {
		const deduper = new IdeaDeduper({ enabled: false, windowMs: 100_000 });
		deduper.checkAndRecord("hash-1");
		expect(deduper.checkAndRecord("hash-1")).toBe(false);
		expect(deduper.checkAndRecord("hash-1")).toBe(false);
	});

	test("isDuplicate always returns false when disabled", () => {
		const deduper = new IdeaDeduper({ enabled: false, windowMs: 100_000 });
		deduper.record("hash-1");
		expect(deduper.isDuplicate("hash-1")).toBe(false);
	});

	test("record does not record when disabled", () => {
		// When dedup is disabled, record returns early without recording
		const deduper = new IdeaDeduper({ enabled: false });
		deduper.record("hash-1");
		expect(deduper.isDuplicate("hash-1")).toBe(false);
		expect(deduper.size).toBe(0);
	});
});

// =============================================================================
// IdeaDeduper — Pruning & Clear
// =============================================================================

describe("IdeaDeduper — Pruning & Clear", () => {
	test("prune removes expired entries", () => {
		const deduper = new IdeaDeduper({ windowMs: 1 });
		deduper.record("hash-1");
		deduper.record("hash-2");

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(deduper.size).toBe(2);
				deduper.prune();
				expect(deduper.size).toBe(0);
				resolve();
			}, 10);
		});
	});

	test("prune keeps non-expired entries", () => {
		const deduper = new IdeaDeduper({ windowMs: 100_000 });
		deduper.record("hash-1");
		deduper.record("hash-2");

		deduper.prune();
		expect(deduper.size).toBe(2);
	});

	test("clear resets all state", () => {
		const deduper = new IdeaDeduper();
		deduper.record("hash-1");
		deduper.record("hash-2");
		deduper.checkAndRecord("hash-1"); // duplicate

		expect(deduper.size).toBe(2);
		expect(deduper.getStats().totalDeduped).toBe(1);

		deduper.clear();
		expect(deduper.size).toBe(0);
		expect(deduper.getStats().totalDeduped).toBe(0);
	});
});

// =============================================================================
// IdeaDeduper — Stats
// =============================================================================

describe("IdeaDeduper — Stats", () => {
	test("stats reflect current state", () => {
		const deduper = new IdeaDeduper({ windowMs: 100_000 });

		deduper.record("hash-1");
		let stats = deduper.getStats();
		expect(stats.historySize).toBe(1);
		expect(stats.totalDeduped).toBe(0);

		deduper.checkAndRecord("hash-1"); // duplicate
		stats = deduper.getStats();
		expect(stats.historySize).toBe(1);
		expect(stats.totalDeduped).toBe(1);

		deduper.checkAndRecord("hash-2"); // new
		stats = deduper.getStats();
		expect(stats.historySize).toBe(2);
		expect(stats.totalDeduped).toBe(1);
	});
});
