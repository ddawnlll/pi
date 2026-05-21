/**
 * Memory Scoring Engine — P14.D tests.
 *
 * Covers:
 * - Configuration defaults and merging
 * - Confidence calculation
 * - Recency score (decay over time)
 * - Relevance scoring against queries
 * - Conflict scoring between two records
 * - Batch scoring
 * - Edge cases (missing fields, extreme values)
 */

import { describe, expect, test } from "vitest";
import { DEFAULT_SCORING_CONFIG, MemoryScoringEngine } from "../../../src/brain/memory/scoring.js";
import { createMemoryRecord, type MemoryQuery, type MemoryRecord } from "../../../src/brain/memory/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProvenance() {
	return {
		sourceRefs: [
			{
				type: "observation" as const,
				path: "src/test.ts",
				id: "obs-test-001",
				lineStart: 1,
				lineEnd: 10,
				timestamp: "2026-05-21T00:00:00.000Z",
			},
		],
		validatedBy: "system" as const,
	};
}

function makeRecord(overrides?: Partial<MemoryRecord>): MemoryRecord {
	return createMemoryRecord({
		type: overrides?.type ?? "project_memory",
		title: overrides?.title ?? "Test memory",
		content: overrides?.content ?? "Test memory content for scoring",
		provenance: overrides?.provenance ?? createDefaultProvenance(),
		lifecycle: overrides?.lifecycle,
		confidence: overrides?.confidence,
		tags: overrides?.tags,
		summary: overrides?.summary,
	});
}

/**
 * Create a record with precise createdAt for recency tests.
 */
function makeRecordWithAge(ageDays: number, overrides?: Partial<MemoryRecord>): MemoryRecord {
	const createdAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
	const record = makeRecord(overrides);
	return {
		...record,
		createdAt,
	};
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

describe("ScoringConfig defaults", () => {
	test("DEFAULT_SCORING_CONFIG has all required fields", () => {
		expect(DEFAULT_SCORING_CONFIG.weights.evidenceCount).toBeTypeOf("number");
		expect(DEFAULT_SCORING_CONFIG.weights.sourceQuality).toBeTypeOf("number");
		expect(DEFAULT_SCORING_CONFIG.weights.recency).toBeTypeOf("number");
		expect(DEFAULT_SCORING_CONFIG.weights.tagMatch).toBeTypeOf("number");
		expect(DEFAULT_SCORING_CONFIG.weights.keywordMatch).toBeTypeOf("number");
		expect(DEFAULT_SCORING_CONFIG.recencyDecayDays).toBe(30);
		expect(DEFAULT_SCORING_CONFIG.sourceQualityScores.system).toBe(1.0);
		expect(DEFAULT_SCORING_CONFIG.sourceQualityScores.user).toBe(0.9);
		expect(DEFAULT_SCORING_CONFIG.sourceQualityScores.llm_validated).toBe(0.8);
	});

	test("constructor without config uses defaults", () => {
		const engine = new MemoryScoringEngine();
		const config = engine.getConfig();
		expect(config.weights.evidenceCount).toBe(DEFAULT_SCORING_CONFIG.weights.evidenceCount);
		expect(config.recencyDecayDays).toBe(DEFAULT_SCORING_CONFIG.recencyDecayDays);
	});

	test("constructor with partial config merges correctly", () => {
		const engine = new MemoryScoringEngine({
			recencyDecayDays: 60,
			weights: { tagMatch: 0.5, keywordMatch: 0.5 },
		});
		const config = engine.getConfig();
		expect(config.recencyDecayDays).toBe(60);
		expect(config.weights.tagMatch).toBe(0.5);
		expect(config.weights.keywordMatch).toBe(0.5);
		// Other weights should keep defaults
		expect(config.weights.evidenceCount).toBe(DEFAULT_SCORING_CONFIG.weights.evidenceCount);
		expect(config.weights.sourceQuality).toBe(DEFAULT_SCORING_CONFIG.weights.sourceQuality);
		expect(config.weights.recency).toBe(DEFAULT_SCORING_CONFIG.weights.recency);
	});

	test("setConfig updates only provided fields", () => {
		const engine = new MemoryScoringEngine();
		engine.setConfig({ recencyDecayDays: 90 });
		expect(engine.getConfig().recencyDecayDays).toBe(90);
		expect(engine.getConfig().weights.evidenceCount).toBe(DEFAULT_SCORING_CONFIG.weights.evidenceCount);
	});

	test("setConfig with source quality overrides", () => {
		const engine = new MemoryScoringEngine();
		engine.setConfig({
			sourceQualityScores: { llm_validated: 0.5 },
		});
		expect(engine.getConfig().sourceQualityScores.llm_validated).toBe(0.5);
		expect(engine.getConfig().sourceQualityScores.system).toBe(1.0); // unchanged
	});
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe("calculateConfidence", () => {
	test("returns a value between 0 and 1", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord();
		const score = engine.calculateConfidence(record);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("higher evidence count increases confidence", () => {
		const engine = new MemoryScoringEngine();
		const lowEvidence = makeRecord();
		const highEvidence = makeRecord({
			provenance: {
				sourceRefs: Array.from({ length: 8 }, (_, i) => ({
					type: "observation" as const,
					path: `src/file${i}.ts`,
					id: `obs-${i}`,
				})),
				validatedBy: "system" as const,
			},
		});

		const low = engine.calculateConfidence(lowEvidence);
		const high = engine.calculateConfidence(highEvidence);
		expect(high).toBeGreaterThan(low);
	});

	test("system-validated memories score higher than llm_validated", () => {
		const engine = new MemoryScoringEngine();
		const systemRecord = makeRecord();
		const llmRecord = makeRecord({
			provenance: {
				sourceRefs: [
					{
						type: "observation" as const,
						path: "src/test.ts",
						id: "obs-llm-001",
					},
				],
				validatedBy: "llm_validated" as const,
			},
		});

		const systemScore = engine.calculateConfidence(systemRecord);
		const llmScore = engine.calculateConfidence(llmRecord);
		expect(systemScore).toBeGreaterThan(llmScore);
	});

	test("unknown validatedBy defaults to 0.3", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({
			provenance: {
				sourceRefs: [
					{
						type: "observation" as const,
						path: "src/test.ts",
						id: "obs-unknown-001",
					},
				],
				validatedBy: "unknown_source" as never,
			},
		});

		const score = engine.calculateConfidence(record);
		// Should be relatively low due to low source quality (0.3)
		expect(score).toBeLessThan(0.7);
	});

	test("newer records get higher confidence due to recency contribution", () => {
		const engine = new MemoryScoringEngine();
		const newRecord = makeRecord();
		const oldRecord = makeRecordWithAge(60); // 60 days old

		const newScore = engine.calculateConfidence(newRecord);
		const oldScore = engine.calculateConfidence(oldRecord);
		expect(newScore).toBeGreaterThan(oldScore);
	});

	test("multiple source refs improve confidence", () => {
		const engine = new MemoryScoringEngine();
		const singleRef = makeRecord();
		const multiRef = makeRecord({
			provenance: {
				sourceRefs: [
					{ type: "observation" as const, path: "a.ts", id: "obs-1" },
					{ type: "observation" as const, path: "b.ts", id: "obs-2" },
					{ type: "observation" as const, path: "c.ts", id: "obs-3" },
					{ type: "observation" as const, path: "d.ts", id: "obs-4" },
					{ type: "observation" as const, path: "e.ts", id: "obs-5" },
				],
				validatedBy: "system" as const,
			},
		});

		const singleScore = engine.calculateConfidence(singleRef);
		const multiScore = engine.calculateConfidence(multiRef);
		expect(multiScore).toBeGreaterThan(singleScore);
	});
});

// ---------------------------------------------------------------------------
// Recency
// ---------------------------------------------------------------------------

describe("calculateRecencyScore", () => {
	test("returns 1.0 for brand new records", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord();
		const score = engine.calculateRecencyScore(record);
		// A record created just now should have near 1.0 recency
		expect(score).toBeGreaterThan(0.99);
	});

	test("decays over time", () => {
		const engine = new MemoryScoringEngine();
		const newRecord = makeRecord();
		const oldRecord = makeRecordWithAge(30); // 30 days old

		const newScore = engine.calculateRecencyScore(newRecord);
		const oldScore = engine.calculateRecencyScore(oldRecord);
		expect(newScore).toBeGreaterThan(oldScore);
		// At exactly recencyDecayDays (30), the score should be 0.5
		expect(oldScore).toBeCloseTo(0.5, 1);
	});

	test("approaches 0 for very old records", () => {
		const engine = new MemoryScoringEngine();
		const veryOldRecord = makeRecordWithAge(30 * 365); // 30 years old
		const score = engine.calculateRecencyScore(veryOldRecord);
		expect(score).toBeLessThan(0.01);
	});

	test("configurable decay days affect the score", () => {
		const fastDecay = new MemoryScoringEngine({ recencyDecayDays: 7 });
		const slowDecay = new MemoryScoringEngine({ recencyDecayDays: 365 });

		const record = makeRecordWithAge(14); // 14 days old

		const fastScore = fastDecay.calculateRecencyScore(record);
		const slowScore = slowDecay.calculateRecencyScore(record);
		// With faster decay, a 14-day-old record should score lower
		expect(fastScore).toBeLessThan(slowScore);
	});

	test("zero or negative recencyDecayDays returns 1.0", () => {
		const engine = new MemoryScoringEngine({ recencyDecayDays: 0 });
		const oldRecord = makeRecordWithAge(100);
		const score = engine.calculateRecencyScore(oldRecord);
		expect(score).toBe(1.0);
	});
});

// ---------------------------------------------------------------------------
// Relevance
// ---------------------------------------------------------------------------

describe("calculateRelevance", () => {
	test("returns 0.5 when no query is provided", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord();
		expect(engine.calculateRelevance(record)).toBe(0.5);
	});

	test("returns 0.5 when query has no filter fields", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord();
		expect(engine.calculateRelevance(record, {})).toBe(0.5);
	});

	test("keyword match boosts relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({ title: "Memory type definitions for pi" });
		const matchingQuery: MemoryQuery = { searchText: "Memory type" };
		const nonMatchingQuery: MemoryQuery = { searchText: "unrelated" };

		const matchScore = engine.calculateRelevance(record, matchingQuery);
		const nonMatchScore = engine.calculateRelevance(record, nonMatchingQuery);
		expect(matchScore).toBeGreaterThan(nonMatchScore);
	});

	test("keyword match in content boosts relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({ content: "This is about TypeScript type definitions" });
		const query: MemoryQuery = { searchText: "TypeScript" };
		const score = engine.calculateRelevance(record, query);
		expect(score).toBe(0.4);
	});

	test("keyword match in summary boosts relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({ summary: "Contains important TypeScript type info" });
		const query: MemoryQuery = { searchText: "important" };
		const score = engine.calculateRelevance(record, query);
		expect(score).toBe(0.4);
	});

	test("type match boosts relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({ type: "failure_memory" });
		const matchingQuery: MemoryQuery = { types: ["failure_memory"] };
		const nonMatchingQuery: MemoryQuery = { types: ["architecture_memory"] };

		const matchScore = engine.calculateRelevance(record, matchingQuery);
		const nonMatchScore = engine.calculateRelevance(record, nonMatchingQuery);
		expect(matchScore).toBeGreaterThan(nonMatchScore);
	});

	test("tag match boosts relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({ tags: ["typescript", "monorepo"] });
		const matchingQuery: MemoryQuery = { tags: ["typescript"] };
		const nonMatchingQuery: MemoryQuery = { tags: ["unrelated-tag"] };

		const matchScore = engine.calculateRelevance(record, matchingQuery);
		const nonMatchScore = engine.calculateRelevance(record, nonMatchingQuery);
		expect(matchScore).toBeGreaterThan(nonMatchScore);
	});

	test("multiple matching factors produce higher relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({
			type: "architecture_memory",
			title: "Project architecture decisions",
			tags: ["architecture", "decision"],
		});
		const fullQuery: MemoryQuery = {
			types: ["architecture_memory"],
			searchText: "architecture",
			tags: ["architecture"],
		};
		const partialQuery: MemoryQuery = {
			types: ["architecture_memory"],
		};

		const fullScore = engine.calculateRelevance(record, fullQuery);
		const partialScore = engine.calculateRelevance(record, partialQuery);
		expect(fullScore).toBeGreaterThan(partialScore);
	});
});

// ---------------------------------------------------------------------------
// Conflict Scoring
// ---------------------------------------------------------------------------

describe("calculateConflictScore", () => {
	test("returns a value between 0 and 1", () => {
		const engine = new MemoryScoringEngine();
		const recordA = makeRecord({ type: "architecture_memory" });
		const recordB = makeRecord({ type: "architecture_memory" });

		const score = engine.calculateConflictScore(recordA, recordB);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("same-type records score higher than different-type", () => {
		const engine = new MemoryScoringEngine();
		const sameTypeA = makeRecord({ type: "architecture_memory" });
		const sameTypeB = makeRecord({ type: "architecture_memory" });
		const differentType = makeRecord({ type: "failure_memory" });

		const sameScore = engine.calculateConflictScore(sameTypeA, sameTypeB);
		const diffScore = engine.calculateConflictScore(sameTypeA, differentType);
		expect(sameScore).toBeGreaterThan(diffScore);
	});

	test("high-confidence records produce higher conflict scores", () => {
		const engine = new MemoryScoringEngine();
		const highConfA = makeRecord({
			type: "architecture_memory",
			provenance: {
				sourceRefs: Array.from({ length: 8 }, (_, i) => ({
					type: "observation" as const,
					path: `src/file${i}.ts`,
					id: `obs-${i}`,
				})),
				validatedBy: "system" as const,
			},
		});
		// Second high-confidence record: same type, 5 source refs, system-validated
		const highConfB = makeRecord({
			type: "architecture_memory",
			provenance: {
				sourceRefs: Array.from({ length: 5 }, (_, i) => ({
					type: "observation" as const,
					path: `src/file${i}.ts`,
					id: `obs-${i}`,
				})),
				validatedBy: "system" as const,
			},
		});
		// Low-confidence record: same type, single source ref, user-validated
		const lowConfB = makeRecord({
			type: "architecture_memory",
			provenance: {
				sourceRefs: [
					{
						type: "observation" as const,
						path: "src/test.ts",
						id: "obs-low-001",
					},
				],
				validatedBy: "user" as const,
			},
		});

		const highScore = engine.calculateConflictScore(highConfA, highConfB);
		const lowScore = engine.calculateConflictScore(highConfA, lowConfB);
		expect(highScore).toBeGreaterThan(lowScore);
	});
});

// ---------------------------------------------------------------------------
// Batch Scoring
// ---------------------------------------------------------------------------

describe("scoreMemories", () => {
	test("returns Map with all memory IDs as keys", () => {
		const engine = new MemoryScoringEngine();
		const records = [makeRecord({ title: "First" }), makeRecord({ title: "Second" }), makeRecord({ title: "Third" })];

		const scores = engine.scoreMemories(records);
		expect(scores.size).toBe(3);
		for (const record of records) {
			expect(scores.has(record.id)).toBe(true);
		}
	});

	test("each score has all required dimensions", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord();
		const scores = engine.scoreMemories([record]);

		const score = scores.get(record.id);
		expect(score).toBeDefined();
		expect(score!.confidence).toBeGreaterThanOrEqual(0);
		expect(score!.confidence).toBeLessThanOrEqual(1);
		expect(score!.relevance).toBeGreaterThanOrEqual(0);
		expect(score!.relevance).toBeLessThanOrEqual(1);
		expect(score!.recency).toBeGreaterThanOrEqual(0);
		expect(score!.recency).toBeLessThanOrEqual(1);
		expect(score!.evidenceQuality).toBeGreaterThanOrEqual(0);
		expect(score!.evidenceQuality).toBeLessThanOrEqual(1);
		expect(score!.total).toBeGreaterThanOrEqual(0);
		expect(score!.total).toBeLessThanOrEqual(1);
	});

	test("relevance varies with query in batch scoring", () => {
		const engine = new MemoryScoringEngine();
		const matchingRecord = makeRecord({ type: "failure_memory", title: "Past failure" });
		const nonMatchingRecord = makeRecord({ type: "architecture_memory", title: "Architecture decision" });

		const query: MemoryQuery = { types: ["failure_memory"] };
		const scores = engine.scoreMemories([matchingRecord, nonMatchingRecord], query);

		const matchScore = scores.get(matchingRecord.id)!;
		const nonMatchScore = scores.get(nonMatchingRecord.id)!;
		expect(matchScore.relevance).toBeGreaterThan(nonMatchScore.relevance);
	});

	test("empty memory array returns empty map", () => {
		const engine = new MemoryScoringEngine();
		const scores = engine.scoreMemories([]);
		expect(scores.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("memory with zero source refs still scores", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({
			provenance: {
				sourceRefs: [],
				validatedBy: "system" as const,
			},
		});
		const score = engine.calculateConfidence(record);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("lifecycle-only query still produces relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({ lifecycle: "active" });
		const query: MemoryQuery = { lifecycle: ["active"] };
		const score = engine.calculateRelevance(record, query);
		// Lifecycle isn't a scored factor, so no query factors match -> 0.5
		expect(score).toBe(0.5);
	});

	test("tags in query but not on record produces lower relevance", () => {
		const engine = new MemoryScoringEngine();
		const record = makeRecord({ tags: ["typescript"] });
		const query: MemoryQuery = { tags: ["go", "rust"] };
		const score = engine.calculateRelevance(record, query);
		// Tags are scored but don't match
		expect(score).toBeLessThan(0.5);
	});

	test("setConfig can change recencyDecayDays affecting confidence mid-flight", () => {
		const engine = new MemoryScoringEngine();
		// Use a record with some age so recency decay is measurable
		const record = makeRecordWithAge(1); // 1 day old

		const before = engine.calculateConfidence(record);
		// With very short decay (0.001 days), recency drops to ~0
		engine.setConfig({ recencyDecayDays: 0.001 });
		const after = engine.calculateConfidence(record);

		// The score should be different after changing decay days
		expect(after).not.toBe(before);
		expect(after).toBeLessThan(before);
	});

	test("config is immutable after getConfig()", () => {
		const engine = new MemoryScoringEngine();
		const config = engine.getConfig();
		config.recencyDecayDays = 999; // should not affect engine
		expect(engine.getConfig().recencyDecayDays).toBe(DEFAULT_SCORING_CONFIG.recencyDecayDays);
	});
});
