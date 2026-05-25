/**
 * Attention Ranking Engine — 24.I tests.
 *
 * Covers:
 * - Configuration defaults and merging
 * - Score computation for severity, recency, confidence, recurrence
 * - Ranking observations, signals, timeline events, memory records
 * - Mixed ranking (re-ranking existing AttentionItems)
 * - Edge cases (empty inputs, extreme values, missing fields)
 * - Utilities (computeRecencyScore, createAttentionItem, validateAttentionItem)
 */

import { describe, expect, test } from "vitest";
import { AttentionRanker } from "../../src/brain/attention/attention-ranking.js";
import {
	ALL_ATTENTION_CATEGORIES,
	computeRecencyScore,
	createAttentionItem,
	DEFAULT_ATTENTION_RANKING_CONFIG,
	SEVERITY_SCORES,
	validateAttentionItem,
} from "../../src/brain/attention/types.js";
import type { MemoryRecord } from "../../src/brain/memory/types.js";
import type { BrainObservation, BrainSignal, BrainTimelineEvent } from "../../src/brain/types.js";

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
		description: overrides?.description ?? "A test observation for ranking",
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

function createTestTimelineEvent(overrides?: Partial<BrainTimelineEvent>): BrainTimelineEvent {
	return {
		id: overrides?.id ?? "evt-1",
		eventType: overrides?.eventType ?? "observation",
		timestamp: overrides?.timestamp ?? new Date().toISOString(),
		data: overrides?.data ?? {},
		workspaceId: overrides?.workspaceId,
		planExecId: overrides?.planExecId,
		severity: overrides?.severity ?? "info",
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

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

describe("AttentionRankingConfig defaults", () => {
	test("DEFAULT_ATTENTION_RANKING_CONFIG has all required fields", () => {
		expect(DEFAULT_ATTENTION_RANKING_CONFIG.weights.severity).toBeGreaterThan(0);
		expect(DEFAULT_ATTENTION_RANKING_CONFIG.weights.recency).toBeGreaterThan(0);
		expect(DEFAULT_ATTENTION_RANKING_CONFIG.weights.confidence).toBeGreaterThan(0);
		expect(DEFAULT_ATTENTION_RANKING_CONFIG.weights.recurrence).toBeGreaterThan(0);
		expect(DEFAULT_ATTENTION_RANKING_CONFIG.staleAfterDays).toBe(7);
		expect(DEFAULT_ATTENTION_RANKING_CONFIG.maxResults).toBe(50);
	});

	test("constructor without config uses defaults", () => {
		const ranker = new AttentionRanker();
		const cfg = ranker.getConfig();
		expect(cfg.weights.severity).toBe(DEFAULT_ATTENTION_RANKING_CONFIG.weights.severity);
		expect(cfg.weights.recency).toBe(DEFAULT_ATTENTION_RANKING_CONFIG.weights.recency);
		expect(cfg.staleAfterDays).toBe(7);
		expect(cfg.maxResults).toBe(50);
	});

	test("constructor merges partial config", () => {
		const ranker = new AttentionRanker({ staleAfterDays: 14, weights: { severity: 0.6 } });
		const cfg = ranker.getConfig();
		expect(cfg.staleAfterDays).toBe(14);
		expect(cfg.weights.severity).toBe(0.6);
		// Unchanged weights retain defaults
		expect(cfg.weights.recency).toBe(DEFAULT_ATTENTION_RANKING_CONFIG.weights.recency);
	});

	test("updateConfig merges at runtime", () => {
		const ranker = new AttentionRanker();
		ranker.updateConfig({ maxResults: 10, weights: { recency: 0.5 } });
		const cfg = ranker.getConfig();
		expect(cfg.maxResults).toBe(10);
		expect(cfg.weights.recency).toBe(0.5);
		expect(cfg.weights.severity).toBe(DEFAULT_ATTENTION_RANKING_CONFIG.weights.severity);
	});
});

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

describe("score computation", () => {
	test("critical severity produces highest score", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 1.0, recency: 0, confidence: 0, recurrence: 0 },
		});

		const criticalObs = createTestObservation({ severity: "critical" });
		const warningObs = createTestObservation({ severity: "warning" });
		const infoObs = createTestObservation({ severity: "info" });

		const result = ranker.rankObservations([criticalObs, warningObs, infoObs]);
		expect(result.items).toHaveLength(3);
		// All should have different scores due to severity
		expect(result.items[0].score).toBeGreaterThan(result.items[1].score);
		expect(result.items[1].score).toBeGreaterThan(result.items[2].score);
	});

	test("higher confidence yields higher score", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 0, recency: 0, confidence: 1.0, recurrence: 0 },
		});

		const highConf = createTestObservation({
			provenance: { observationSources: [], derivationChain: [], confidence: 0.9, validatedBy: "system" },
		});
		const lowConf = createTestObservation({
			provenance: { observationSources: [], derivationChain: [], confidence: 0.3, validatedBy: "system" },
		});

		const result = ranker.rankObservations([highConf, lowConf]);
		expect(result.items).toHaveLength(2);
		expect(result.items[0].score).toBeGreaterThan(result.items[1].score);
	});

	test("more recent items score higher", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 0, recency: 1.0, confidence: 0, recurrence: 0 },
			staleAfterDays: 30,
		});

		const now = new Date();
		const recent = createTestObservation({ timestamp: now.toISOString() });
		const old = createTestObservation({
			timestamp: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
		});

		const result = ranker.rankObservations([recent, old]);
		expect(result.items).toHaveLength(2);
		expect(result.items[0].score).toBeGreaterThan(result.items[1].score);
	});

	test("recurrence boosts score", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 0, recency: 0, confidence: 0, recurrence: 1.0 },
		});

		const obs = createTestObservation({ signalType: "retry_hotspot" });
		const result = ranker.rankObservations([obs, obs], { retry_hotspot: 10 });
		// With recurrence map, the score should be higher
		const resultLow = ranker.rankObservations([obs, obs], { retry_hotspot: 1 });
		expect(result.items[0].score).toBeGreaterThan(resultLow.items[0].score);
	});

	test("all-zero weights produce zero score", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 0, recency: 0, confidence: 0, recurrence: 0 },
		});
		const obs = createTestObservation({ severity: "critical" });
		const result = ranker.rankObservations([obs]);
		expect(result.items[0].score).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Ranking observations
// ---------------------------------------------------------------------------

describe("rankObservations", () => {
	test("sorts by descending score", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 1.0, recency: 0, confidence: 0, recurrence: 0 },
		});

		const observations = [
			createTestObservation({ id: "obs-1", severity: "critical", title: "Critical issue" }),
			createTestObservation({ id: "obs-2", severity: "warning", title: "Warning issue" }),
			createTestObservation({ id: "obs-3", severity: "info", title: "Info issue" }),
		];

		const result = ranker.rankObservations(observations);
		expect(result.items).toHaveLength(3);
		expect(result.items[0].title).toBe("Critical issue");
		expect(result.items[1].title).toBe("Warning issue");
		expect(result.items[2].title).toBe("Info issue");
	});

	test("returns empty result for empty input", () => {
		const ranker = new AttentionRanker();
		const result = ranker.rankObservations([]);
		expect(result.items).toHaveLength(0);
		expect(result.totalConsidered).toBe(0);
		expect(result.computedAt).toBeDefined();
	});

	test("respects maxResults config", () => {
		const ranker = new AttentionRanker({ maxResults: 2 });
		const observations = [
			createTestObservation({ id: "obs-1" }),
			createTestObservation({ id: "obs-2" }),
			createTestObservation({ id: "obs-3" }),
		];
		const result = ranker.rankObservations(observations);
		expect(result.items).toHaveLength(2);
		expect(result.totalConsidered).toBe(3);
	});

	test("includes refId and metadata", () => {
		const ranker = new AttentionRanker();
		const obs = createTestObservation({ id: "obs-ref-1" });
		const result = ranker.rankObservations([obs]);
		expect(result.items[0].refId).toBe("obs-ref-1");
		expect(result.items[0].metadata.observationId).toBe("obs-ref-1");
	});
});

// ---------------------------------------------------------------------------
// Ranking signals
// ---------------------------------------------------------------------------

describe("rankSignals", () => {
	test("sorts signals by score descending", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 1.0, recency: 0, confidence: 0, recurrence: 0 },
		});

		const signals = [
			createTestSignal({ id: "sig-1", severity: "critical", pattern: "critical_pattern" }),
			createTestSignal({ id: "sig-2", severity: "info", pattern: "info_pattern" }),
		];

		const result = ranker.rankSignals(signals);
		expect(result.items).toHaveLength(2);
		expect(result.items[0].title).toBe("critical_pattern");
	});

	test("empty signals returns empty result", () => {
		const ranker = new AttentionRanker();
		const result = ranker.rankSignals([]);
		expect(result.items).toHaveLength(0);
		expect(result.totalConsidered).toBe(0);
	});

	test("recurrence map boosts score", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 0, recency: 0, confidence: 0, recurrence: 1.0 },
		});

		const sig = createTestSignal({ pattern: "failure_pattern:test" });
		const resultHigh = ranker.rankSignals([sig], { "failure_pattern:test": 20 });
		const resultLow = ranker.rankSignals([sig], { "failure_pattern:test": 1 });
		expect(resultHigh.items[0].score).toBeGreaterThan(resultLow.items[0].score);
	});
});

// ---------------------------------------------------------------------------
// Ranking timeline events
// ---------------------------------------------------------------------------

describe("rankTimelineEvents", () => {
	test("sorts events by score descending", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 1.0, recency: 0, confidence: 0, recurrence: 0 },
		});

		const events = [
			createTestTimelineEvent({ id: "evt-1", severity: "critical", eventType: "daemon_error" }),
			createTestTimelineEvent({ id: "evt-2", severity: "info", eventType: "daemon_heartbeat" }),
		];

		const result = ranker.rankTimelineEvents(events);
		expect(result.items).toHaveLength(2);
		expect(result.items[0].title).toBe("daemon_error");
	});

	test("empty events returns empty", () => {
		const ranker = new AttentionRanker();
		const result = ranker.rankTimelineEvents([]);
		expect(result.items).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Ranking memory records
// ---------------------------------------------------------------------------

describe("rankMemoryRecords", () => {
	test("sorts records by score descending", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 1.0, recency: 0, confidence: 0, recurrence: 0 },
		});

		const records = [
			createTestMemoryRecord({ id: "mem-1", lifecycle: "disputed", title: "Disputed record" }),
			createTestMemoryRecord({ id: "mem-2", lifecycle: "active", title: "Active record" }),
		];

		const result = ranker.rankMemoryRecords(records);
		expect(result.items).toHaveLength(2);
		// Disputed should rank higher (critical) than active (info)
		expect(result.items[0].score).toBeGreaterThan(result.items[1].score);
	});

	test("disputed and needs_review are treated as critical", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 1.0, recency: 0, confidence: 0, recurrence: 0 },
		});

		const disputed = createTestMemoryRecord({ lifecycle: "disputed" });
		const needsReview = createTestMemoryRecord({ lifecycle: "needs_review" });
		const active = createTestMemoryRecord({ lifecycle: "active" });

		const result = ranker.rankMemoryRecords([disputed, needsReview, active]);
		expect(result.items[0].score).toBe(1.0);
		expect(result.items[1].score).toBe(1.0);
	});

	test("empty records returns empty", () => {
		const ranker = new AttentionRanker();
		const result = ranker.rankMemoryRecords([]);
		expect(result.items).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Mixed ranking
// ---------------------------------------------------------------------------

describe("rankMixed", () => {
	test("re-ranks mixed attention items by score", () => {
		const ranker = new AttentionRanker();
		const items = [
			createAttentionItem({
				category: "observation",
				severity: "critical",
				title: "A",
				description: "a",
				score: 0.3,
			}),
			createAttentionItem({ category: "signal", severity: "info", title: "B", description: "b", score: 0.9 }),
			createAttentionItem({
				category: "observation",
				severity: "warning",
				title: "C",
				description: "c",
				score: 0.6,
			}),
		];

		const result = ranker.rankMixed(items);
		expect(result.items).toHaveLength(3);
		expect(result.items[0].title).toBe("B");
		expect(result.items[1].title).toBe("C");
		expect(result.items[2].title).toBe("A");
	});

	test("empty input returns empty", () => {
		const ranker = new AttentionRanker();
		const result = ranker.rankMixed([]);
		expect(result.items).toHaveLength(0);
		expect(result.totalConsidered).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("handles single item", () => {
		const ranker = new AttentionRanker();
		const obs = createTestObservation();
		const result = ranker.rankObservations([obs]);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].score).toBeGreaterThan(0);
	});

	test("handles many items beyond maxResults", () => {
		const ranker = new AttentionRanker({ maxResults: 3 });
		const observations = Array.from({ length: 100 }, (_, i) =>
			createTestObservation({ id: `obs-${i}`, severity: "info" }),
		);
		const result = ranker.rankObservations(observations);
		expect(result.items).toHaveLength(3);
		expect(result.totalConsidered).toBe(100);
	});

	test("very old items get minimal recency score", () => {
		const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
		const score = computeRecencyScore(oldDate, 7);
		expect(score).toBe(0.05);
	});

	test("brand new items get recency score of 1.0", () => {
		const score = computeRecencyScore(new Date().toISOString(), 7);
		expect(score).toBe(1.0);
	});

	test("future timestamps still produce valid recency score", () => {
		const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
		const score = computeRecencyScore(future, 7);
		expect(score).toBe(1.0);
	});

	test("negative recurrence count is handled", () => {
		const ranker = new AttentionRanker({
			weights: { severity: 0, recency: 0, confidence: 0, recurrence: 1.0 },
		});
		const obs = createTestObservation();
		const result = ranker.rankObservations([obs], { retry_hotspot: -1 });
		// Should not crash; log2(0) = -Infinity but Math.log2(0+1) = 0
		expect(result.items[0].score).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

describe("computeRecencyScore", () => {
	test("returns 1.0 for current time", () => {
		expect(computeRecencyScore(new Date().toISOString(), 7)).toBe(1.0);
	});

	test("returns 0.05 for stale items", () => {
		const old = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
		expect(computeRecencyScore(old, 7)).toBe(0.05);
	});

	test("linearly decays between 1.0 and 0.05", () => {
		const halfLife = new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000).toISOString();
		const score = computeRecencyScore(halfLife, 7);
		// At half of staleAfterDays, score should be ~0.525
		expect(score).toBeCloseTo(0.525, 2);
	});
});

describe("SEVERITY_SCORES", () => {
	test("maps severities correctly", () => {
		expect(SEVERITY_SCORES.critical).toBe(1.0);
		expect(SEVERITY_SCORES.warning).toBe(0.6);
		expect(SEVERITY_SCORES.info).toBe(0.2);
	});
});

describe("ALL_ATTENTION_CATEGORIES", () => {
	test("contains all expected categories", () => {
		expect(ALL_ATTENTION_CATEGORIES).toContain("observation");
		expect(ALL_ATTENTION_CATEGORIES).toContain("signal");
		expect(ALL_ATTENTION_CATEGORIES).toContain("timeline_event");
		expect(ALL_ATTENTION_CATEGORIES).toContain("memory_record");
		expect(ALL_ATTENTION_CATEGORIES).toContain("proposal");
		expect(ALL_ATTENTION_CATEGORIES).toContain("goal_drift");
	});
});

describe("createAttentionItem", () => {
	test("creates item with defaults", () => {
		const item = createAttentionItem({
			category: "observation",
			severity: "warning",
			title: "Test",
			description: "Desc",
			score: 0.5,
		});
		expect(item.id).toBeDefined();
		expect(item.timestamp).toBeDefined();
		expect(item.category).toBe("observation");
		expect(item.severity).toBe("warning");
		expect(item.title).toBe("Test");
		expect(item.description).toBe("Desc");
		expect(item.score).toBe(0.5);
		expect(item.metadata).toEqual({});
	});

	test("id and timestamp are auto-generated", () => {
		const item1 = createAttentionItem({
			category: "signal",
			severity: "info",
			title: "T1",
			description: "D1",
			score: 0.1,
		});
		const item2 = createAttentionItem({
			category: "signal",
			severity: "info",
			title: "T2",
			description: "D2",
			score: 0.2,
		});
		expect(item1.id).not.toBe(item2.id);
	});
});

describe("validateAttentionItem", () => {
	test("valid item passes validation", () => {
		const item = createAttentionItem({
			category: "observation",
			severity: "warning",
			title: "Test",
			description: "Desc",
			score: 0.5,
		});
		const result = validateAttentionItem(item);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	test("null returns invalid", () => {
		const result = validateAttentionItem(null);
		expect(result.valid).toBe(false);
	});

	test("missing id fails", () => {
		const result = validateAttentionItem({
			category: "observation",
			severity: "warning",
			title: "Test",
			description: "Desc",
			score: 0.5,
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("id"))).toBe(true);
	});

	test("invalid category fails", () => {
		const result = validateAttentionItem({
			id: "1",
			timestamp: new Date().toISOString(),
			category: "invalid",
			severity: "warning",
			title: "Test",
			description: "Desc",
			score: 0.5,
			metadata: {},
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("category"))).toBe(true);
	});

	test("score out of range fails", () => {
		const result = validateAttentionItem({
			id: "1",
			timestamp: new Date().toISOString(),
			category: "observation",
			severity: "warning",
			title: "Test",
			description: "Desc",
			score: 1.5,
			metadata: {},
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("score"))).toBe(true);
	});
});
