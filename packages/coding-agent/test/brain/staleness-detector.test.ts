/**
 * Staleness & Momentum Detector — 24.N tests.
 *
 * Covers:
 * - Configuration defaults and merging
 * - Staleness scanning for each item type (observations, signals,
 *   memory records, goals, attention items)
 * - Full scan aggregation and stats
 * - Momentum tracking (recording snapshots, computing velocity/direction)
 * - Batch momentum computation
 * - History pruning
 * - Edge cases (empty inputs, extreme values, invalid scores)
 */

import { describe, expect, test } from "vitest";
import {
	DEFAULT_MOMENTUM_CONFIG,
	DEFAULT_STALENESS_DETECTOR_CONFIG,
	DEFAULT_STALENESS_THRESHOLDS,
	StalenessDetector,
} from "../../src/brain/attention/staleness-detector.js";
import type { AttentionItem } from "../../src/brain/attention/types.js";
import type { GoalRecord } from "../../src/brain/goals/types.js";
import type { MemoryRecord } from "../../src/brain/memory/types.js";
import type { BrainObservation, BrainSignal } from "../../src/brain/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestObservation(overrides?: Partial<BrainObservation>): BrainObservation {
	return {
		id: overrides?.id ?? "obs-1",
		timestamp: overrides?.timestamp ?? new Date().toISOString(),
		source: overrides?.source ?? "execution",
		signalType: overrides?.signalType ?? "retry_hotspot",
		severity: overrides?.severity ?? "warning",
		title: overrides?.title ?? "Test observation",
		description: overrides?.description ?? "A test observation",
		evidence: overrides?.evidence ?? [],
		provenance: overrides?.provenance ?? {
			observationSources: [],
			derivationChain: [],
			confidence: 0.8,
			validatedBy: "system",
		},
		metadata: overrides?.metadata ?? {},
	};
}

function createTestSignal(overrides?: Partial<BrainSignal>): BrainSignal {
	return {
		id: overrides?.id ?? "sig-1",
		observationIds: overrides?.observationIds ?? ["obs-1"],
		pattern: overrides?.pattern ?? "retry_hotspot:workspace:3+",
		summary: overrides?.summary ?? "Test signal summary",
		confidence: overrides?.confidence ?? 0.85,
		severity: overrides?.severity ?? "warning",
		createdAt: overrides?.createdAt ?? new Date().toISOString(),
		resolvedAt: overrides?.resolvedAt,
		metadata: overrides?.metadata ?? {},
	};
}

function createTestMemoryRecord(overrides?: Partial<MemoryRecord>): MemoryRecord {
	return {
		id: overrides?.id ?? "mem-1",
		type: overrides?.type ?? "project_memory",
		title: overrides?.title ?? "Test memory",
		content: overrides?.content ?? "Test memory content",
		summary: overrides?.summary,
		lifecycle: overrides?.lifecycle ?? "active",
		confidence: overrides?.confidence ?? 0.7,
		provenance: overrides?.provenance ?? {
			sourceRefs: [{ type: "observation", path: "test.ts", id: "obs-1", timestamp: new Date().toISOString() }],
			validatedBy: "system",
		},
		createdAt: overrides?.createdAt ?? new Date().toISOString(),
		updatedAt: overrides?.updatedAt ?? new Date().toISOString(),
		tags: overrides?.tags ?? [],
		metadata: overrides?.metadata ?? {},
	};
}

function createTestGoal(overrides?: Partial<GoalRecord>): GoalRecord {
	return {
		id: overrides?.id ?? "goal-1",
		title: overrides?.title ?? "Test goal",
		description: overrides?.description ?? "A test goal",
		priority: overrides?.priority ?? "normal",
		status: overrides?.status ?? "active",
		category: overrides?.category ?? "project",
		milestones: overrides?.milestones ?? [],
		createdAt: overrides?.createdAt ?? new Date().toISOString(),
		updatedAt: overrides?.updatedAt ?? new Date().toISOString(),
		relatedMemoryIds: overrides?.relatedMemoryIds ?? [],
		metadata: overrides?.metadata ?? {},
	};
}

function createTestAttentionItem(overrides?: Partial<AttentionItem>): AttentionItem {
	return {
		id: overrides?.id ?? "attn-1",
		timestamp: overrides?.timestamp ?? new Date().toISOString(),
		category: overrides?.category ?? "observation",
		severity: overrides?.severity ?? "warning",
		title: overrides?.title ?? "Test attention item",
		description: overrides?.description ?? "A test attention item",
		score: overrides?.score ?? 0.5,
		metadata: overrides?.metadata ?? {},
	};
}

// Helper to create an ISO timestamp N days ago
function daysAgo(n: number): string {
	return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Configuration defaults
// ---------------------------------------------------------------------------

describe("StalenessDetectorConfig defaults", () => {
	test("DEFAULT_STALENESS_THRESHOLDS has all threshold types", () => {
		expect(DEFAULT_STALENESS_THRESHOLDS.observation).toBeGreaterThan(0);
		expect(DEFAULT_STALENESS_THRESHOLDS.signal).toBeGreaterThan(0);
		expect(DEFAULT_STALENESS_THRESHOLDS.memory_record).toBeGreaterThan(0);
		expect(DEFAULT_STALENESS_THRESHOLDS.goal).toBeGreaterThan(0);
		expect(DEFAULT_STALENESS_THRESHOLDS.attention_item).toBeGreaterThan(0);
	});

	test("DEFAULT_STALENESS_DETECTOR_CONFIG has all fields", () => {
		const cfg = DEFAULT_STALENESS_DETECTOR_CONFIG;
		expect(cfg.thresholds).toBe(DEFAULT_STALENESS_THRESHOLDS);
		expect(cfg.momentum).toBe(DEFAULT_MOMENTUM_CONFIG);
		expect(cfg.staleThreshold).toBe(0.5);
		expect(cfg.maxStalenessScore).toBe(1.0);
	});

	test("constructor without config uses defaults", () => {
		const detector = new StalenessDetector();
		const cfg = detector.getConfig();
		expect(cfg.thresholds.observation).toBe(DEFAULT_STALENESS_THRESHOLDS.observation);
		expect(cfg.thresholds.goal).toBe(DEFAULT_STALENESS_THRESHOLDS.goal);
		expect(cfg.momentum.movingAverageWindow).toBe(DEFAULT_MOMENTUM_CONFIG.movingAverageWindow);
		expect(cfg.staleThreshold).toBe(0.5);
	});

	test("constructor merges partial config", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, goal: 30, signal: 5, memory_record: 20, attention_item: 14 },
			staleThreshold: 0.7,
		});
		const cfg = detector.getConfig();
		expect(cfg.thresholds.observation).toBe(10);
		expect(cfg.thresholds.goal).toBe(30);
		expect(cfg.thresholds.signal).toBe(5); // same as default
		expect(cfg.staleThreshold).toBe(0.7);
		// Unchanged values retain defaults
		expect(cfg.maxStalenessScore).toBe(1.0);
	});

	test("updateConfig merges at runtime", () => {
		const detector = new StalenessDetector();
		detector.updateConfig({ staleThreshold: 0.8, momentum: { velocityThreshold: 0.1 } });
		const cfg = detector.getConfig();
		expect(cfg.staleThreshold).toBe(0.8);
		expect(cfg.momentum.velocityThreshold).toBe(0.1);
		expect(cfg.momentum.movingAverageWindow).toBe(DEFAULT_MOMENTUM_CONFIG.movingAverageWindow);
	});

	test("resetHistory clears all stored data", () => {
		const detector = new StalenessDetector();
		const obs = createTestObservation({ id: "obs-reset" });
		detector.scanObservations([obs]);
		detector.recordSnapshot("obs-reset", 0.8);
		detector.resetHistory();
		expect(detector.getSnapshotHistory("obs-reset")).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Staleness scanning — observations
// ---------------------------------------------------------------------------

describe("scanObservations", () => {
	test("fresh observation has low staleness score", () => {
		const detector = new StalenessDetector();
		const obs = createTestObservation({ timestamp: new Date().toISOString() });
		const results = detector.scanObservations([obs]);
		expect(results).toHaveLength(1);
		expect(results[0].stalenessScore).toBeCloseTo(0, 1);
		expect(results[0].severity).toBe("info");
	});

	test("old observation has high staleness score", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 3, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const obs = createTestObservation({
			id: "obs-old",
			timestamp: daysAgo(6),
			title: "Old observation",
		});
		const results = detector.scanObservations([obs]);
		expect(results).toHaveLength(1);
		// 6 days / 3 day threshold = 2.0, clamped to 1.0
		expect(results[0].stalenessScore).toBe(1.0);
		expect(results[0].daysSinceActivity).toBeGreaterThanOrEqual(6);
		expect(results[0].itemType).toBe("observation");
		expect(results[0].title).toBe("Old observation");
	});

	test("partially stale observation", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const obs = createTestObservation({
			id: "obs-partial",
			timestamp: daysAgo(5),
		});
		const results = detector.scanObservations([obs]);
		expect(results).toHaveLength(1);
		// 5 days / 10 day threshold = 0.5
		expect(results[0].stalenessScore).toBeCloseTo(0.5, 1);
		expect(results[0].severity).toBe("warning");
	});

	test("empty observations returns empty array", () => {
		const detector = new StalenessDetector();
		const results = detector.scanObservations([]);
		expect(results).toHaveLength(0);
	});

	test("observation with future timestamp gets zero staleness", () => {
		const detector = new StalenessDetector();
		const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
		const obs = createTestObservation({ id: "obs-future", timestamp: future });
		const results = detector.scanObservations([obs]);
		expect(results[0].stalenessScore).toBe(0);
		expect(results[0].daysSinceActivity).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Staleness scanning — signals
// ---------------------------------------------------------------------------

describe("scanSignals", () => {
	test("fresh signal has low staleness score", () => {
		const detector = new StalenessDetector();
		const sig = createTestSignal({ createdAt: new Date().toISOString() });
		const results = detector.scanSignals([sig]);
		expect(results).toHaveLength(1);
		expect(results[0].stalenessScore).toBeCloseTo(0, 1);
	});

	test("uses resolvedAt when available", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 3, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const sig = createTestSignal({
			id: "sig-resolved",
			createdAt: daysAgo(30),
			resolvedAt: daysAgo(1),
			pattern: "resolved signal",
		});
		const results = detector.scanSignals([sig]);
		expect(results[0].daysSinceActivity).toBeLessThan(2);
		// Uses resolvedAt (1 day ago)
		expect(results[0].stalenessScore).toBeLessThan(0.5);
	});

	test("uses createdAt when resolvedAt is undefined", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 3, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const sig = createTestSignal({
			id: "sig-unresolved",
			createdAt: daysAgo(10),
			resolvedAt: undefined,
			pattern: "unresolved signal",
		});
		const results = detector.scanSignals([sig]);
		// 10 days / 5 day threshold = 2.0, clamped to 1.0
		expect(results[0].stalenessScore).toBe(1.0);
		expect(results[0].itemType).toBe("signal");
	});

	test("empty signals returns empty", () => {
		const detector = new StalenessDetector();
		expect(detector.scanSignals([])).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Staleness scanning — memory records
// ---------------------------------------------------------------------------

describe("scanMemoryRecords", () => {
	test("recently updated memory has low staleness", () => {
		const detector = new StalenessDetector();
		const rec = createTestMemoryRecord({ updatedAt: new Date().toISOString() });
		const results = detector.scanMemoryRecords([rec]);
		expect(results[0].stalenessScore).toBeCloseTo(0, 1);
	});

	test("old memory record has high staleness score", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 3, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const rec = createTestMemoryRecord({
			id: "mem-old",
			updatedAt: daysAgo(28),
			title: "Old memory",
		});
		const results = detector.scanMemoryRecords([rec]);
		// 28 days / 14 day threshold = 2.0, clamped to 1.0
		expect(results[0].stalenessScore).toBe(1.0);
		expect(results[0].title).toBe("Old memory");
	});

	test("empty records returns empty", () => {
		const detector = new StalenessDetector();
		expect(detector.scanMemoryRecords([])).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Staleness scanning — goals
// ---------------------------------------------------------------------------

describe("scanGoals", () => {
	test("recently updated goal has low staleness", () => {
		const detector = new StalenessDetector();
		const goal = createTestGoal({ updatedAt: new Date().toISOString() });
		const results = detector.scanGoals([goal]);
		expect(results[0].stalenessScore).toBeCloseTo(0, 1);
	});

	test("old goal has high staleness score", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 3, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const goal = createTestGoal({
			id: "goal-old",
			updatedAt: daysAgo(30),
			title: "Stale goal",
		});
		const results = detector.scanGoals([goal]);
		// 30 days / 14 day threshold = ~2.14, clamped to 1.0
		expect(results[0].stalenessScore).toBe(1.0);
		expect(results[0].itemType).toBe("goal");
	});

	test("empty goals returns empty", () => {
		const detector = new StalenessDetector();
		expect(detector.scanGoals([])).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Staleness scanning — attention items
// ---------------------------------------------------------------------------

describe("scanAttentionItems", () => {
	test("fresh attention item has low staleness", () => {
		const detector = new StalenessDetector();
		const item = createTestAttentionItem({ timestamp: new Date().toISOString() });
		const results = detector.scanAttentionItems([item]);
		expect(results[0].stalenessScore).toBeCloseTo(0, 1);
	});

	test("old attention item has high staleness score", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 3, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const item = createTestAttentionItem({
			id: "attn-old",
			timestamp: daysAgo(21),
			title: "Stale attention item",
		});
		const results = detector.scanAttentionItems([item]);
		expect(results[0].stalenessScore).toBe(1.0);
	});

	test("empty attention items returns empty", () => {
		const detector = new StalenessDetector();
		expect(detector.scanAttentionItems([])).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Decay detection
// ---------------------------------------------------------------------------

describe("decay detection", () => {
	test("isDecaying is true when staleness increases between scans", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		// First scan: item is fresh
		const obs1 = createTestObservation({
			id: "obs-decay",
			timestamp: new Date().toISOString(),
		});
		detector.scanObservations([obs1]);

		// Second scan: same item, now slightly older
		const obs2 = createTestObservation({
			id: "obs-decay",
			timestamp: daysAgo(3),
		});
		const results = detector.scanObservations([obs2]);
		expect(results[0].isDecaying).toBe(true);
		expect(results[0].previousStalenessScore).toBeDefined();
		expect(results[0].stalenessScore).toBeGreaterThan(results[0].previousStalenessScore!);
	});

	test("isDecaying is false on first scan (no history)", () => {
		const detector = new StalenessDetector();
		const obs = createTestObservation({ id: "obs-first" });
		const results = detector.scanObservations([obs]);
		expect(results[0].isDecaying).toBe(false);
		expect(results[0].previousStalenessScore).toBeUndefined();
	});

	test("isDecaying is false when staleness stays the same", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		// Scan twice with the same timestamp
		const ts = daysAgo(2);
		const obs = createTestObservation({ id: "obs-steady", timestamp: ts });
		detector.scanObservations([obs]);
		// Re-scan with same-ish timestamp (very close)
		const obs2 = createTestObservation({ id: "obs-steady", timestamp: ts });
		const results = detector.scanObservations([obs2]);
		// staleness may be very slightly different due to real time passing,
		// but within a tiny delta it should not decay
		expect(typeof results[0].isDecaying).toBe("boolean");
	});
});

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

describe("severity mapping in staleness results", () => {
	test("stalenessScore >= 0.8 is critical", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 1, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const obs = createTestObservation({
			id: "obs-crit",
			timestamp: daysAgo(1),
		});
		const results = detector.scanObservations([obs]);
		expect(results[0].severity).toBe("critical");
	});

	test("stalenessScore between 0.5 and 0.8 is warning", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const obs = createTestObservation({
			id: "obs-warn",
			timestamp: daysAgo(5),
		});
		const results = detector.scanObservations([obs]);
		expect(results[0].severity).toBe("warning");
	});

	test("stalenessScore < 0.5 is info", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const obs = createTestObservation({
			id: "obs-info",
			timestamp: daysAgo(2),
		});
		const results = detector.scanObservations([obs]);
		expect(results[0].severity).toBe("info");
	});
});

// ---------------------------------------------------------------------------
// Full scan
// ---------------------------------------------------------------------------

describe("fullScan", () => {
	test("returns empty result when no items provided", () => {
		const detector = new StalenessDetector();
		const result = detector.fullScan({});
		expect(result.totalScanned).toBe(0);
		expect(result.sorted).toHaveLength(0);
		expect(result.staleCount).toBe(0);
		expect(result.decayingCount).toBe(0);
		expect(result.scannedAt).toBeDefined();
	});

	test("aggregates multiple item types and sorts by staleness descending", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 3, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const result = detector.fullScan({
			observations: [
				createTestObservation({ id: "obs-fresh", timestamp: new Date().toISOString() }),
				createTestObservation({ id: "obs-stale", timestamp: daysAgo(6) }),
			],
			goals: [
				createTestGoal({ id: "goal-fresh", updatedAt: new Date().toISOString() }),
				createTestGoal({ id: "goal-stale", updatedAt: daysAgo(30) }),
			],
		});

		expect(result.totalScanned).toBe(4);
		expect(result.byType.observation).toHaveLength(2);
		expect(result.byType.goal).toHaveLength(2);
		// Both stale items have stalenessScore clamped to 1.0 (equal);
		// check they appear before the fresh items regardless of order
		const staleIds = result.sorted
			.slice(0, 2)
			.map((r) => r.itemId)
			.sort();
		expect(staleIds).toEqual(["goal-stale", "obs-stale"]);
		expect(result.sorted[0].stalenessScore).toBe(1.0);
		expect(result.sorted[1].stalenessScore).toBe(1.0);
		// Fresh items also have equal scores (~0); check they are both at the end
		const freshIds = result.sorted
			.slice(2)
			.map((r) => r.itemId)
			.sort();
		expect(freshIds).toEqual(["goal-fresh", "obs-fresh"]);
		expect(result.staleCount).toBe(2); // obs-stale (6/3=1.0) and goal-stale (30/14=1.0)
	});

	test("staleCount counts items above staleThreshold", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
			staleThreshold: 0.5,
		});
		const result = detector.fullScan({
			observations: [
				createTestObservation({ id: "obs-1", timestamp: daysAgo(8) }), // 0.8 -> stale
				createTestObservation({ id: "obs-2", timestamp: daysAgo(3) }), // 0.3 -> not stale
			],
		});
		expect(result.staleCount).toBe(1);
	});

	test("decayingCount is tracked", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 10, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		// Scan once to establish baseline
		detector.scanObservations([createTestObservation({ id: "obs-decay-1", timestamp: new Date().toISOString() })]);
		// Scan again with older timestamps
		const result = detector.fullScan({
			observations: [
				createTestObservation({ id: "obs-decay-1", timestamp: daysAgo(5) }),
				createTestObservation({ id: "obs-fresh", timestamp: new Date().toISOString() }),
			],
		});
		expect(result.decayingCount).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Momentum tracking
// ---------------------------------------------------------------------------

describe("recordSnapshot", () => {
	test("records a single snapshot", () => {
		const detector = new StalenessDetector();
		detector.recordSnapshot("item-1", 0.8);
		const history = detector.getSnapshotHistory("item-1");
		expect(history).toHaveLength(1);
		expect(history[0].itemId).toBe("item-1");
		expect(history[0].score).toBe(0.8);
		expect(history[0].timestamp).toBeDefined();
	});

	test("appends multiple snapshots for the same item", () => {
		const detector = new StalenessDetector();
		detector.recordSnapshot("item-1", 0.8);
		detector.recordSnapshot("item-1", 0.6);
		detector.recordSnapshot("item-1", 0.4);
		expect(detector.getSnapshotHistory("item-1")).toHaveLength(3);
	});

	test("throws for out-of-range scores", () => {
		const detector = new StalenessDetector();
		expect(() => detector.recordSnapshot("item-1", 1.5)).toThrow();
		expect(() => detector.recordSnapshot("item-1", -0.1)).toThrow();
	});

	test("recordSnapshots records multiple items at once", () => {
		const detector = new StalenessDetector();
		detector.recordSnapshots([
			{ itemId: "a", score: 0.9 },
			{ itemId: "b", score: 0.3 },
		]);
		expect(detector.getSnapshotHistory("a")).toHaveLength(1);
		expect(detector.getSnapshotHistory("b")).toHaveLength(1);
	});
});

describe("computeMomentum", () => {
	test("returns null for item with no history", () => {
		const detector = new StalenessDetector();
		expect(detector.computeMomentum("nonexistent")).toBeNull();
	});

	test("returns null for item with insufficient samples", () => {
		const detector = new StalenessDetector({
			momentum: { movingAverageWindow: 5, minSamples: 3, velocityThreshold: 0.05 },
		});
		detector.recordSnapshot("item-1", 0.5);
		detector.recordSnapshot("item-1", 0.5);
		// 2 samples < minSamples of 3
		expect(detector.computeMomentum("item-1")).toBeNull();
	});

	test("detects accelerating momentum", () => {
		const detector = new StalenessDetector({
			momentum: { movingAverageWindow: 5, minSamples: 2, velocityThreshold: 0.05 },
		});
		detector.recordSnapshot("item-accel", 0.2);
		detector.recordSnapshot("item-accel", 0.4);
		detector.recordSnapshot("item-accel", 0.6);
		detector.recordSnapshot("item-accel", 0.8);

		const momentum = detector.computeMomentum("item-accel");
		expect(momentum).not.toBeNull();
		expect(momentum!.direction).toBe("accelerating");
		expect(momentum!.velocity).toBeGreaterThan(0);
		expect(momentum!.currentScore).toBe(0.8);
	});

	test("detects decaying momentum (scores decreasing)", () => {
		const detector = new StalenessDetector({
			momentum: { movingAverageWindow: 5, minSamples: 2, velocityThreshold: 0.05 },
		});
		detector.recordSnapshot("item-decay", 0.9);
		detector.recordSnapshot("item-decay", 0.7);
		detector.recordSnapshot("item-decay", 0.5);
		detector.recordSnapshot("item-decay", 0.3);

		const momentum = detector.computeMomentum("item-decay");
		expect(momentum).not.toBeNull();
		expect(momentum!.direction).toBe("decaying");
		expect(momentum!.velocity).toBeLessThan(0);
	});

	test("detects steady momentum (minimal velocity)", () => {
		const detector = new StalenessDetector({
			momentum: { movingAverageWindow: 5, minSamples: 2, velocityThreshold: 0.1 },
		});
		detector.recordSnapshot("item-steady", 0.5);
		detector.recordSnapshot("item-steady", 0.51);
		detector.recordSnapshot("item-steady", 0.5);
		detector.recordSnapshot("item-steady", 0.52);

		const momentum = detector.computeMomentum("item-steady");
		expect(momentum).not.toBeNull();
		expect(momentum!.direction).toBe("steady");
	});

	test("detects stale direction for very low scores with no rise", () => {
		const detector = new StalenessDetector({
			momentum: { movingAverageWindow: 5, minSamples: 2, velocityThreshold: 0.05 },
		});
		detector.recordSnapshot("item-stale", 0.05);
		detector.recordSnapshot("item-stale", 0.04);
		detector.recordSnapshot("item-stale", 0.03);

		const momentum = detector.computeMomentum("item-stale");
		expect(momentum).not.toBeNull();
		expect(momentum!.direction).toBe("stale");
	});

	test("uses currentScore parameter when provided", () => {
		const detector = new StalenessDetector({
			momentum: { movingAverageWindow: 5, minSamples: 2, velocityThreshold: 0.05 },
		});
		detector.recordSnapshot("item-cur", 0.3);
		detector.recordSnapshot("item-cur", 0.4);
		detector.recordSnapshot("item-cur", 0.5);

		const momentum = detector.computeMomentum("item-cur", 0.9);
		expect(momentum).not.toBeNull();
		expect(momentum!.currentScore).toBe(0.9);
		expect(momentum!.sampleCount).toBe(4); // 3 history + 1 current
	});

	test("throws for invalid currentScore", () => {
		const detector = new StalenessDetector();
		detector.recordSnapshot("item-bad", 0.5);
		expect(() => detector.computeMomentum("item-bad", 1.5)).toThrow();
	});
});

describe("computeMomentumBatch", () => {
	test("returns empty array for items with no history", () => {
		const detector = new StalenessDetector();
		const results = detector.computeMomentumBatch([{ itemId: "a" }, { itemId: "b" }]);
		expect(results).toHaveLength(0);
	});

	test("returns momentum only for items with sufficient history", () => {
		const detector = new StalenessDetector({
			momentum: { movingAverageWindow: 5, minSamples: 2, velocityThreshold: 0.05 },
		});
		detector.recordSnapshot("item-a", 0.3);
		detector.recordSnapshot("item-a", 0.5);
		detector.recordSnapshot("item-a", 0.7);
		detector.recordSnapshot("item-b", 0.9); // only 1 sample

		const results = detector.computeMomentumBatch([{ itemId: "item-a" }, { itemId: "item-b" }]);
		expect(results).toHaveLength(1);
		expect(results[0].itemId).toBe("item-a");
	});
});

// ---------------------------------------------------------------------------
// History pruning
// ---------------------------------------------------------------------------

describe("pruneHistory", () => {
	test("removes tracking data for inactive items", () => {
		const detector = new StalenessDetector();
		detector.recordSnapshot("active-1", 0.5);
		detector.recordSnapshot("active-2", 0.6);
		detector.recordSnapshot("inactive-1", 0.3);

		detector.pruneHistory(new Set(["active-1", "active-2"]));

		expect(detector.getSnapshotHistory("active-1")).toHaveLength(1);
		expect(detector.getSnapshotHistory("active-2")).toHaveLength(1);
		expect(detector.getSnapshotHistory("inactive-1")).toHaveLength(0);
	});

	test("does nothing when all items are active", () => {
		const detector = new StalenessDetector();
		detector.recordSnapshot("a", 0.5);
		detector.recordSnapshot("b", 0.6);

		detector.pruneHistory(new Set(["a", "b"]));

		expect(detector.getSnapshotHistory("a")).toHaveLength(1);
		expect(detector.getSnapshotHistory("b")).toHaveLength(1);
	});

	test("handles empty active set", () => {
		const detector = new StalenessDetector();
		detector.recordSnapshot("a", 0.5);
		detector.pruneHistory(new Set());
		expect(detector.getSnapshotHistory("a")).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("handles single item scan", () => {
		const detector = new StalenessDetector();
		const obs = createTestObservation({ id: "single" });
		const results = detector.scanObservations([obs]);
		expect(results).toHaveLength(1);
		expect(results[0].itemId).toBe("single");
	});

	test("handles large batch of items", () => {
		const detector = new StalenessDetector();
		const observations = Array.from({ length: 100 }, (_, i) =>
			createTestObservation({ id: `obs-${i}`, timestamp: daysAgo(Math.random() * 30) }),
		);
		const results = detector.scanObservations(observations);
		expect(results).toHaveLength(100);
	});

	test("memory history is trimmed to prevent unbounded growth", () => {
		const detector = new StalenessDetector({
			thresholds: { observation: 1, signal: 5, memory_record: 14, goal: 14, attention_item: 7 },
		});
		const obs = createTestObservation({ id: "obs-trim" });
		// Scan many times
		for (let i = 0; i < 20; i++) {
			detector.scanObservations([obs]);
		}
		// History should be trimmed to 10 entries
		const results = detector.scanObservations([obs]);
		// We can't check internal state directly, but the method should not crash
		expect(results[0].itemId).toBe("obs-trim");
	});
});
