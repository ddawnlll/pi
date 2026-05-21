/**
 * Memory Domain Model — type definitions, validation, and serialization tests.
 *
 * Covers P14.A acceptance criteria:
 * - All types compile without errors
 * - Lifecycle enum has all required states
 * - Every memory requires source refs
 * - Serialization/deserialization works
 * - Test fixtures cover all types
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	ALL_CONFLICT_TYPES,
	ALL_MEMORY_LIFECYCLES,
	ALL_MEMORY_SOURCE_REF_TYPES,
	ALL_MEMORY_TYPES,
	ALL_RESOLUTION_TYPES,
	ALL_VALIDATED_BY,
	computeMemoryScore,
	computeMemoryStats,
	createMemoryConflict,
	createMemoryRecord,
	deserializeMemoryConflict,
	deserializeMemoryRecord,
	type MemoryConflict,
	type MemoryProvenance,
	type MemoryQuery,
	type MemoryRecord,
	type MemoryScore,
	serializeMemoryConflict,
	serializeMemoryRecord,
	validateMemoryConflict,
	validateMemoryQuery,
	validateMemoryRecord,
} from "../../../src/brain/memory/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProvenance(): MemoryProvenance {
	return {
		sourceRefs: [
			{
				type: "observation",
				path: "src/test.ts",
				id: "obs-test-001",
				lineStart: 1,
				lineEnd: 10,
				timestamp: "2026-05-21T00:00:00.000Z",
			},
		],
		validatedBy: "system",
	};
}

function makeValidRecordOverrides() {
	return {
		type: "project_memory" as const,
		title: "Test memory record",
		content: "This is a test memory record for unit testing",
		provenance: createDefaultProvenance(),
	};
}

// ---------------------------------------------------------------------------
// Enum / Const Lists
// ---------------------------------------------------------------------------

describe("enum constant lists", () => {
	test("ALL_MEMORY_TYPES contains all 8 expected values", () => {
		expect(ALL_MEMORY_TYPES).toContain("project_memory");
		expect(ALL_MEMORY_TYPES).toContain("architecture_memory");
		expect(ALL_MEMORY_TYPES).toContain("plan_memory");
		expect(ALL_MEMORY_TYPES).toContain("failure_memory");
		expect(ALL_MEMORY_TYPES).toContain("decision_memory");
		expect(ALL_MEMORY_TYPES).toContain("execution_memory");
		expect(ALL_MEMORY_TYPES).toContain("idea_memory");
		expect(ALL_MEMORY_TYPES).toContain("user_preference_memory");
		expect(ALL_MEMORY_TYPES.length).toBe(8);
	});

	test("ALL_MEMORY_LIFECYCLES contains all 7 required states", () => {
		expect(ALL_MEMORY_LIFECYCLES).toContain("candidate");
		expect(ALL_MEMORY_LIFECYCLES).toContain("active");
		expect(ALL_MEMORY_LIFECYCLES).toContain("disputed");
		expect(ALL_MEMORY_LIFECYCLES).toContain("superseded");
		expect(ALL_MEMORY_LIFECYCLES).toContain("expired");
		expect(ALL_MEMORY_LIFECYCLES).toContain("rejected_by_user");
		expect(ALL_MEMORY_LIFECYCLES).toContain("needs_review");
		expect(ALL_MEMORY_LIFECYCLES.length).toBe(7);
	});

	test("ALL_MEMORY_SOURCE_REF_TYPES contains all expected values", () => {
		expect(ALL_MEMORY_SOURCE_REF_TYPES).toContain("observation");
		expect(ALL_MEMORY_SOURCE_REF_TYPES).toContain("journal");
		expect(ALL_MEMORY_SOURCE_REF_TYPES).toContain("plan");
		expect(ALL_MEMORY_SOURCE_REF_TYPES).toContain("reflection");
		expect(ALL_MEMORY_SOURCE_REF_TYPES).toContain("user");
		expect(ALL_MEMORY_SOURCE_REF_TYPES).toContain("external");
		expect(ALL_MEMORY_SOURCE_REF_TYPES.length).toBe(6);
	});

	test("ALL_CONFLICT_TYPES contains all expected values", () => {
		expect(ALL_CONFLICT_TYPES).toContain("contradiction");
		expect(ALL_CONFLICT_TYPES).toContain("duplicate");
		expect(ALL_CONFLICT_TYPES).toContain("staleness");
		expect(ALL_CONFLICT_TYPES.length).toBe(3);
	});

	test("ALL_RESOLUTION_TYPES contains all expected values", () => {
		expect(ALL_RESOLUTION_TYPES).toContain("auto_resolved");
		expect(ALL_RESOLUTION_TYPES).toContain("user_selected");
		expect(ALL_RESOLUTION_TYPES).toContain("pending");
		expect(ALL_RESOLUTION_TYPES.length).toBe(3);
	});

	test("ALL_VALIDATED_BY contains all expected values", () => {
		expect(ALL_VALIDATED_BY).toContain("system");
		expect(ALL_VALIDATED_BY).toContain("user");
		expect(ALL_VALIDATED_BY).toContain("llm_validated");
		expect(ALL_VALIDATED_BY.length).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

describe("createMemoryRecord", () => {
	test("creates a valid memory record with required fields", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());

		expect(record.id).toBeDefined();
		expect(typeof record.id).toBe("string");
		expect(record.type).toBe("project_memory");
		expect(record.title).toBe("Test memory record");
		expect(record.content).toBe("This is a test memory record for unit testing");
		expect(record.lifecycle).toBe("candidate"); // default
		expect(record.confidence).toBe(0.5); // default
		expect(record.provenance.sourceRefs).toHaveLength(1);
		expect(record.provenance.validatedBy).toBe("system");
		expect(record.createdAt).toBeDefined();
		expect(record.updatedAt).toBeDefined();
		expect(record.tags).toEqual([]); // default
		expect(record.metadata).toEqual({}); // default
	});

	test("passes validation after creation", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	test("accepts all optional overrides", () => {
		const record = createMemoryRecord({
			...makeValidRecordOverrides(),
			type: "failure_memory",
			lifecycle: "active",
			confidence: 0.85,
			summary: "A brief summary",
			expiresAt: "2026-08-21T00:00:00.000Z",
			supersededBy: "mem-other-001",
			affectedBy: ["mem-related-001"],
			tags: ["test", "unit-testing"],
			category: "testing",
			metadata: { key: "value" },
		});

		expect(record.type).toBe("failure_memory");
		expect(record.lifecycle).toBe("active");
		expect(record.confidence).toBe(0.85);
		expect(record.summary).toBe("A brief summary");
		expect(record.expiresAt).toBe("2026-08-21T00:00:00.000Z");
		expect(record.supersededBy).toBe("mem-other-001");
		expect(record.affectedBy).toEqual(["mem-related-001"]);
		expect(record.tags).toEqual(["test", "unit-testing"]);
		expect(record.category).toBe("testing");
		expect(record.metadata).toEqual({ key: "value" });
	});

	test("creates records for all memory types", () => {
		for (const type of ALL_MEMORY_TYPES) {
			const record = createMemoryRecord({
				...makeValidRecordOverrides(),
				type,
			});
			expect(record.type).toBe(type);
			const result = validateMemoryRecord(record);
			expect(result.valid).toBe(true);
		}
	});

	test("creates records for all lifecycle states", () => {
		for (const lifecycle of ALL_MEMORY_LIFECYCLES) {
			const record = createMemoryRecord({
				...makeValidRecordOverrides(),
				lifecycle,
			});
			expect(record.lifecycle).toBe(lifecycle);
			const result = validateMemoryRecord(record);
			expect(result.valid).toBe(true);
		}
	});
});

describe("createMemoryConflict", () => {
	test("creates a valid conflict with required fields", () => {
		const conflict = createMemoryConflict({
			recordIds: ["rec-001", "rec-002"],
			conflictType: "contradiction",
			scores: { "rec-001": 0.9, "rec-002": 0.6 },
		});

		expect(conflict.id).toBeDefined();
		expect(conflict.recordIds).toEqual(["rec-001", "rec-002"]);
		expect(conflict.conflictType).toBe("contradiction");
		expect(conflict.scores["rec-001"]).toBe(0.9);
		expect(conflict.scores["rec-002"]).toBe(0.6);
	});

	test("passes validation after creation", () => {
		const conflict = createMemoryConflict({
			recordIds: ["rec-001", "rec-002"],
			conflictType: "duplicate",
			scores: { "rec-001": 0.8, "rec-002": 0.7 },
		});
		const result = validateMemoryConflict(conflict);
		expect(result.valid).toBe(true);
	});

	test("accepts optional resolution fields", () => {
		const conflict = createMemoryConflict({
			recordIds: ["rec-001", "rec-002"],
			conflictType: "staleness",
			scores: { "rec-001": 0.5, "rec-002": 0.9 },
			resolution: "user_selected",
			resolvedBy: "rec-002",
			resolvedAt: "2026-05-21T00:00:00.000Z",
			evidence: "User confirmed rec-002 is more recent",
		});

		expect(conflict.resolution).toBe("user_selected");
		expect(conflict.resolvedBy).toBe("rec-002");
		expect(conflict.resolvedAt).toBe("2026-05-21T00:00:00.000Z");
		expect(conflict.evidence).toBe("User confirmed rec-002 is more recent");
	});
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateMemoryRecord", () => {
	test("rejects null/undefined", () => {
		expect(validateMemoryRecord(null).valid).toBe(false);
		expect(validateMemoryRecord(undefined).valid).toBe(false);
		expect(validateMemoryRecord("string").valid).toBe(false);
	});

	test("rejects missing required fields", () => {
		const result = validateMemoryRecord({});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	test("rejects invalid type", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		(record as unknown as Record<string, unknown>).type = "invalid_type";
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("type"))).toBe(true);
	});

	test("rejects invalid lifecycle", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		(record as unknown as Record<string, unknown>).lifecycle = "unknown_state";
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("lifecycle"))).toBe(true);
	});

	test("rejects invalid confidence", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		record.confidence = 1.5;
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("confidence"))).toBe(true);
	});

	test("rejects missing source refs (empty array)", () => {
		const record = createMemoryRecord({
			...makeValidRecordOverrides(),
			provenance: { sourceRefs: [], validatedBy: "system" },
		});
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("sourceRefs"))).toBe(true);
	});

	test("rejects missing provenance entirely", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		(record as unknown as Record<string, unknown>).provenance = null;
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("provenance"))).toBe(true);
	});

	test("rejects invalid validatedBy", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		record.provenance.validatedBy = "unknown" as never;
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("validatedBy"))).toBe(true);
	});

	test("rejects invalid source ref type", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		record.provenance.sourceRefs[0].type = "invalid_ref" as never;
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("type"))).toBe(true);
	});

	test("rejects empty title", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		record.title = "";
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("title"))).toBe(true);
	});

	test("rejects invalid expiresAt", () => {
		const record = createMemoryRecord({
			...makeValidRecordOverrides(),
			expiresAt: "",
		});
		const result = validateMemoryRecord(record);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("expiresAt"))).toBe(true);
	});
});

describe("validateMemoryConflict", () => {
	test("rejects null/undefined", () => {
		expect(validateMemoryConflict(null).valid).toBe(false);
	});

	test("rejects invalid recordIds length", () => {
		const result = validateMemoryConflict({
			id: "test",
			recordIds: ["only-one"],
			conflictType: "contradiction",
			scores: {},
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("recordIds"))).toBe(true);
	});

	test("rejects invalid conflictType", () => {
		const conflict = createMemoryConflict({
			recordIds: ["a", "b"],
			conflictType: "contradiction",
			scores: { a: 1, b: 0.5 },
		});
		(conflict as unknown as Record<string, unknown>).conflictType = "invalid";
		const result = validateMemoryConflict(conflict);
		expect(result.valid).toBe(false);
	});

	test("rejects invalid resolution", () => {
		const conflict = createMemoryConflict({
			recordIds: ["a", "b"],
			conflictType: "contradiction",
			scores: { a: 1, b: 0.5 },
		});
		(conflict as unknown as Record<string, unknown>).resolution = "invalid_resolution";
		const result = validateMemoryConflict(conflict);
		expect(result.valid).toBe(false);
	});
});

describe("validateMemoryQuery", () => {
	test("accepts empty query", () => {
		const result = validateMemoryQuery({});
		expect(result.valid).toBe(true);
	});

	test("accepts valid query with all fields", () => {
		const query: MemoryQuery = {
			types: ["project_memory", "architecture_memory"],
			lifecycle: ["active"],
			tags: ["typescript"],
			searchText: "monorepo",
			minConfidence: 0.5,
			minRelevance: 0.3,
			limit: 10,
			offset: 0,
			sortBy: "confidence",
			sortOrder: "desc",
		};
		const result = validateMemoryQuery(query);
		expect(result.valid).toBe(true);
	});

	test("rejects invalid type in types array", () => {
		const result = validateMemoryQuery({ types: ["invalid_type"] });
		expect(result.valid).toBe(false);
	});

	test("rejects invalid lifecycle", () => {
		const result = validateMemoryQuery({ lifecycle: ["unknown"] });
		expect(result.valid).toBe(false);
	});

	test("rejects limit beyond max", () => {
		const result = validateMemoryQuery({ limit: 200 });
		expect(result.valid).toBe(false);
	});

	test("rejects negative offset", () => {
		const result = validateMemoryQuery({ offset: -1 });
		expect(result.valid).toBe(false);
	});

	test("rejects invalid sortBy", () => {
		const result = validateMemoryQuery({ sortBy: "invalid" });
		expect(result.valid).toBe(false);
	});

	test("rejects invalid sortOrder", () => {
		const result = validateMemoryQuery({ sortOrder: "sideways" });
		expect(result.valid).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("computeMemoryScore", () => {
	test("returns a valid score object", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		const score = computeMemoryScore(record);

		expect(score.confidence).toBe(0.5);
		expect(score.relevance).toBeGreaterThanOrEqual(0);
		expect(score.relevance).toBeLessThanOrEqual(1);
		expect(score.recency).toBeGreaterThanOrEqual(0);
		expect(score.recency).toBeLessThanOrEqual(1);
		expect(score.evidenceQuality).toBeGreaterThanOrEqual(0);
		expect(score.evidenceQuality).toBeLessThanOrEqual(1);
		expect(score.total).toBeGreaterThanOrEqual(0);
		expect(score.total).toBeLessThanOrEqual(1);
	});

	test("high confidence records score higher", () => {
		const low = createMemoryRecord({ ...makeValidRecordOverrides(), confidence: 0.2 });
		const high = createMemoryRecord({ ...makeValidRecordOverrides(), confidence: 0.9 });

		const lowScore = computeMemoryScore(low);
		const highScore = computeMemoryScore(high);

		expect(highScore.total).toBeGreaterThan(lowScore.total);
	});

	test("relevance increases with matching query type", () => {
		const record = createMemoryRecord({ ...makeValidRecordOverrides(), type: "failure_memory" });
		const matchingQuery: MemoryQuery = { types: ["failure_memory"] };
		const nonMatchingQuery: MemoryQuery = { types: ["architecture_memory"] };

		const matchScore = computeMemoryScore(record, matchingQuery);
		const nonMatchScore = computeMemoryScore(record, nonMatchingQuery);

		expect(matchScore.relevance).toBeGreaterThan(nonMatchScore.relevance);
	});

	test("relevance increases with matching lifecycle", () => {
		const record = createMemoryRecord({ ...makeValidRecordOverrides(), lifecycle: "active" });
		const score = computeMemoryScore(record, { lifecycle: ["active"] });
		// Single matching factor (lifecycle) gives 0.3, which is above baseline 0
		expect(score.relevance).toBeGreaterThan(0.25);
	});

	test("relevance increases with matching tags", () => {
		const record = createMemoryRecord({ ...makeValidRecordOverrides(), tags: ["typescript", "monorepo"] });
		const score = computeMemoryScore(record, { tags: ["typescript"] });
		// Single matching factor (tags) gives 0.3, which is above baseline 0
		expect(score.relevance).toBeGreaterThan(0.25);
	});

	test("relevance increases with search text in title", () => {
		const record = createMemoryRecord({
			...makeValidRecordOverrides(),
			title: "Memory type definitions",
		});
		const score = computeMemoryScore(record, { searchText: "Memory type" });
		// Single matching factor (title match) gives 0.3, which is above baseline 0
		expect(score.relevance).toBeGreaterThan(0.25);
	});

	test("evidence quality increases with more source refs", () => {
		const oneRef = createMemoryRecord(makeValidRecordOverrides());
		const threeRefs = createMemoryRecord({
			...makeValidRecordOverrides(),
			provenance: {
				sourceRefs: [
					{ type: "observation", path: "a.ts", id: "obs-1" },
					{ type: "observation", path: "b.ts", id: "obs-2" },
					{ type: "observation", path: "c.ts", id: "obs-3" },
				],
				validatedBy: "system",
			},
		});

		const oneScore = computeMemoryScore(oneRef);
		const threeScore = computeMemoryScore(threeRefs);

		expect(threeScore.evidenceQuality).toBeGreaterThanOrEqual(oneScore.evidenceQuality);
	});
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe("computeMemoryStats", () => {
	test("computes correct stats for empty store", () => {
		const stats = computeMemoryStats([], []);
		expect(stats.totalMemories).toBe(0);
		expect(stats.avgConfidence).toBe(0);
		expect(stats.conflictCount).toBe(0);
		expect(stats.expiredCount).toBe(0);
	});

	test("computes correct stats for populated store", () => {
		const records = [
			createMemoryRecord({ ...makeValidRecordOverrides(), type: "project_memory", confidence: 0.9 }),
			createMemoryRecord({
				...makeValidRecordOverrides(),
				type: "architecture_memory",
				confidence: 0.8,
				lifecycle: "active",
			}),
			createMemoryRecord({
				...makeValidRecordOverrides(),
				type: "failure_memory",
				confidence: 0.5,
				lifecycle: "expired",
			}),
		];

		const conflicts = [
			{
				id: "c1",
				recordIds: ["a", "b"] as [string, string],
				conflictType: "contradiction" as const,
				scores: { a: 0.9, b: 0.6 },
			},
		];

		const stats = computeMemoryStats(records, conflicts);

		expect(stats.totalMemories).toBe(3);
		expect(stats.byType.project_memory).toBe(1);
		expect(stats.byType.architecture_memory).toBe(1);
		expect(stats.byType.failure_memory).toBe(1);
		expect(stats.byLifecycle.candidate).toBe(1); // default
		expect(stats.byLifecycle.active).toBe(1);
		expect(stats.byLifecycle.expired).toBe(1);
		expect(stats.avgConfidence).toBeCloseTo((0.9 + 0.8 + 0.5) / 3, 5);
		expect(stats.expiredCount).toBe(1);
		expect(stats.conflictCount).toBe(1); // no resolution = pending
	});

	test("resolved conflicts are not counted", () => {
		const conflicts: MemoryConflict[] = [
			{
				id: "c1",
				recordIds: ["a", "b"],
				conflictType: "contradiction",
				scores: { a: 0.9, b: 0.6 },
				resolution: "auto_resolved",
				resolvedBy: "a",
				resolvedAt: "2026-05-21T00:00:00.000Z",
			},
		];

		const stats = computeMemoryStats([], conflicts);
		expect(stats.conflictCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Serialization / Deserialization
// ---------------------------------------------------------------------------

describe("serialization round-trip", () => {
	test("MemoryRecord serializes and deserializes correctly", () => {
		const record = createMemoryRecord(makeValidRecordOverrides());
		const json = serializeMemoryRecord(record);
		const parsed = deserializeMemoryRecord(json);

		expect(parsed).toEqual(record);
		expect(typeof json).toBe("string");
	});

	test("MemoryConflict serializes and deserializes correctly", () => {
		const conflict = createMemoryConflict({
			recordIds: ["a", "b"],
			conflictType: "contradiction",
			scores: { a: 0.9, b: 0.6 },
			evidence: "Evidence text",
		});
		const json = serializeMemoryConflict(conflict);
		const parsed = deserializeMemoryConflict(json);

		expect(parsed).toEqual(conflict);
	});
});

describe("deserialization rejects invalid data", () => {
	test("deserializeMemoryRecord throws on invalid JSON", () => {
		expect(() => deserializeMemoryRecord("not json")).toThrow();
	});

	test("deserializeMemoryRecord throws on valid JSON but invalid structure", () => {
		expect(() => deserializeMemoryRecord(JSON.stringify({}))).toThrow();
	});

	test("deserializeMemoryConflict throws on invalid JSON", () => {
		expect(() => deserializeMemoryConflict("not json")).toThrow();
	});

	test("deserializeMemoryConflict throws on valid JSON but invalid structure", () => {
		expect(() => deserializeMemoryConflict(JSON.stringify({ id: "test" }))).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Fixture Integration
// ---------------------------------------------------------------------------

describe("fixture deserialization — memory records", () => {
	const fixtureDir = join(__dirname, "../../fixtures/brain/memory");

	const recordFixtures = [
		{ file: "memory-record-project.json", type: "project_memory" as const, id: "mem-project-001" },
		{ file: "memory-record-architecture.json", type: "architecture_memory" as const, id: "mem-arch-001" },
		{ file: "memory-record-plan.json", type: "plan_memory" as const, id: "mem-plan-001" },
		{ file: "memory-record-failure.json", type: "failure_memory" as const, id: "mem-failure-001" },
		{ file: "memory-record-decision.json", type: "decision_memory" as const, id: "mem-decision-001" },
		{ file: "memory-record-execution.json", type: "execution_memory" as const, id: "mem-exec-001" },
		{ file: "memory-record-idea.json", type: "idea_memory" as const, id: "mem-idea-001" },
		{ file: "memory-record-preference.json", type: "user_preference_memory" as const, id: "mem-pref-001" },
	];

	for (const { file, type, id } of recordFixtures) {
		test(`${file} deserializes as a valid ${type} record`, () => {
			const fixturePath = join(fixtureDir, file);
			const json = readFileSync(fixturePath, "utf-8");
			const record = deserializeMemoryRecord(json);

			expect(record.id).toBe(id);
			expect(record.type).toBe(type);
			expect(record.provenance.sourceRefs.length).toBeGreaterThan(0);
			expect(record.tags.length).toBeGreaterThan(0);
			expect(typeof record.content).toBe("string");
			expect(typeof record.title).toBe("string");

			// Verify validation passes
			const result = validateMemoryRecord(record);
			expect(result.valid).toBe(true);
		});
	}
});

describe("fixture deserialization — conflicts", () => {
	const fixtureDir = join(__dirname, "../../fixtures/brain/memory");

	test("memory-conflict-contradiction.json deserializes correctly", () => {
		const fixturePath = join(fixtureDir, "memory-conflict-contradiction.json");
		const json = readFileSync(fixturePath, "utf-8");
		const conflict = deserializeMemoryConflict(json);

		expect(conflict.id).toBe("conflict-001");
		expect(conflict.recordIds).toHaveLength(2);
		expect(conflict.conflictType).toBe("contradiction");
		expect(conflict.resolution).toBe("pending");
		expect(conflict.evidence).toBeDefined();
		expect(typeof conflict.scores["mem-arch-001"]).toBe("number");

		const result = validateMemoryConflict(conflict);
		expect(result.valid).toBe(true);
	});

	test("memory-conflict-duplicate.json deserializes correctly", () => {
		const fixturePath = join(fixtureDir, "memory-conflict-duplicate.json");
		const json = readFileSync(fixturePath, "utf-8");
		const conflict = deserializeMemoryConflict(json);

		expect(conflict.id).toBe("conflict-002");
		expect(conflict.conflictType).toBe("duplicate");
		expect(conflict.resolution).toBe("auto_resolved");
		expect(conflict.resolvedBy).toBe("mem-exec-001");
		expect(conflict.resolvedAt).toBeDefined();

		const result = validateMemoryConflict(conflict);
		expect(result.valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Type-level correctness (compile-time checks only)
// ---------------------------------------------------------------------------

describe("type correctness (compile-time)", () => {
	test("MemoryRecord can be created with all fields", () => {
		const record: MemoryRecord = {
			id: "test-id",
			type: "decision_memory",
			title: "Test decision",
			content: "We decided X",
			summary: "Summary of decision",
			lifecycle: "active",
			confidence: 0.9,
			provenance: {
				sourceRefs: [
					{
						type: "observation",
						path: "/path/to/source",
						id: "ref-001",
						lineStart: 1,
						lineEnd: 10,
						timestamp: "2026-05-21T00:00:00.000Z",
					},
				],
				derivedFrom: ["parent-001"],
				validatedBy: "user",
			},
			createdAt: "2026-05-21T00:00:00.000Z",
			updatedAt: "2026-05-21T00:00:00.000Z",
			expiresAt: "2026-08-21T00:00:00.000Z",
			supersededBy: "newer-id",
			affectedBy: ["related-id"],
			tags: ["tag1", "tag2"],
			category: "test-category",
			metadata: { key: "value" },
		};
		expect(record.type).toBe("decision_memory");
		expect(record.provenance.derivedFrom).toContain("parent-001");
	});

	test("MemoryScore has all required dimensions", () => {
		const score: MemoryScore = {
			confidence: 0.8,
			relevance: 0.7,
			recency: 0.9,
			evidenceQuality: 0.6,
			total: 0.75,
		};
		expect(score.total).toBeGreaterThan(0);
	});

	test("MemoryQuery can have all optional fields", () => {
		const query: MemoryQuery = {
			types: ["project_memory"],
			lifecycle: ["active"],
			tags: ["important"],
			searchText: "search term",
			minConfidence: 0.5,
			minRelevance: 0.3,
			limit: 10,
			offset: 0,
			sortBy: "createdAt",
			sortOrder: "desc",
		};
		expect(query.sortBy).toBe("createdAt");
		expect(query.sortOrder).toBe("desc");
	});

	test("ALL_MEMORY_TYPES values are assignable to MemoryType", () => {
		const types: string[] = ALL_MEMORY_TYPES;
		expect(types).toContain("project_memory");
		expect(types).toContain("user_preference_memory");
	});

	test("ALL_MEMORY_LIFECYCLES values are assignable to MemoryLifecycle", () => {
		const lifecycles: string[] = ALL_MEMORY_LIFECYCLES;
		expect(lifecycles).toContain("candidate");
		expect(lifecycles).toContain("needs_review");
	});
});
