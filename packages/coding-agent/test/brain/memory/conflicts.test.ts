/**
 * Conflict Detection Engine — P14.E tests.
 *
 * Covers the acceptance criteria:
 * - Contradictory memories detected
 * - Duplicate detection works
 * - Stale memory flags old active memories
 * - Disputed state triggers correctly
 * - Conflict resolution workflow complete
 * - Conflict records persist
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type ConflictConfig, ConflictDetectionEngine } from "../../../src/brain/memory/conflicts.js";
import { MemoryScoringEngine } from "../../../src/brain/memory/scoring.js";
import { MemoryStore } from "../../../src/brain/memory/store.js";
import { createMemoryRecord, type MemoryProvenance, type MemoryRecord } from "../../../src/brain/memory/types.js";

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

/**
 * Create a memory record with the given properties.
 */
function makeRecord(
	overrides: Partial<MemoryRecord> & {
		type: MemoryRecord["type"];
		title: string;
		content: string;
	},
): MemoryRecord {
	return createMemoryRecord({
		type: overrides.type,
		title: overrides.title,
		content: overrides.content,
		summary: overrides.summary,
		provenance: overrides.provenance ?? createDefaultProvenance(),
		lifecycle: overrides.lifecycle ?? "active",
		confidence: overrides.confidence ?? 0.8,
		tags: overrides.tags ?? ["test"],
	});
}

/**
 * Create a record with a specific age (for staleness tests).
 */
function makeAgedRecord(
	ageDays: number,
	overrides: Partial<MemoryRecord> & {
		type: MemoryRecord["type"];
		title: string;
		content: string;
	},
): MemoryRecord {
	const record = makeRecord(overrides);
	const createdAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
	return { ...record, createdAt };
}

/**
 * Create a temp directory and return a store + engine configured to use it.
 */
async function createTestEnvironment(config?: Partial<ConflictConfig>): Promise<{
	store: MemoryStore;
	engine: ConflictDetectionEngine;
	scoring: MemoryScoringEngine;
	basePath: string;
}> {
	const basePath = await mkdtemp(join(tmpdir(), "memory-conflict-test-"));
	const store = new MemoryStore({ basePath });
	await store.initialize();
	const scoring = new MemoryScoringEngine();
	const engine = new ConflictDetectionEngine(store, config);
	return { store, engine, scoring, basePath };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConflictDetectionEngine - configuration", () => {
	test("uses default config when no config provided", async () => {
		const { engine } = await createTestEnvironment();
		const config = engine.getConfig();

		expect(config.contradictionThreshold).toBe(0.7);
		expect(config.duplicateSimilarityThreshold).toBe(0.9);
		expect(config.stalenessThresholdDays).toBe(180);
		expect(config.autoResolve).toBe(false);
	});

	test("merges partial config with defaults", async () => {
		const { engine } = await createTestEnvironment({
			contradictionThreshold: 0.8,
			autoResolve: true,
		});
		const config = engine.getConfig();

		expect(config.contradictionThreshold).toBe(0.8);
		expect(config.duplicateSimilarityThreshold).toBe(0.9); // default
		expect(config.stalenessThresholdDays).toBe(180); // default
		expect(config.autoResolve).toBe(true);
	});

	test("setConfig updates only provided fields", async () => {
		const { engine } = await createTestEnvironment();
		engine.setConfig({ duplicateSimilarityThreshold: 0.95 });

		const config = engine.getConfig();
		expect(config.duplicateSimilarityThreshold).toBe(0.95);
		expect(config.contradictionThreshold).toBe(0.7); // unchanged
		expect(config.stalenessThresholdDays).toBe(180); // unchanged
		expect(config.autoResolve).toBe(false); // unchanged
	});
});

describe("ConflictDetectionEngine - contradiction detection", () => {
	test("detects contradiction between same-type records with similar content but different confidence", async () => {
		const { store, engine } = await createTestEnvironment({
			contradictionThreshold: 0.5,
		});

		const record1 = makeRecord({
			type: "project_memory",
			title: "Build tool: npm",
			content: "The project uses npm as the package manager. This was decided early on.",
			confidence: 0.9,
		});
		const record2 = makeRecord({
			type: "project_memory",
			title: "Build tool: npm or pnpm?",
			content: "The project uses npm as the package manager. Actually it might be pnpm now.",
			confidence: 0.3,
		});

		await store.create(record1);
		await store.create(record2);

		const analyses = await engine.detectConflicts(record2);

		expect(analyses.length).toBeGreaterThanOrEqual(1);
		const analysis = analyses.find((a) => a.memoryId === record1.id);
		expect(analysis).toBeDefined();
		expect(analysis!.conflictTypes).toContain("contradiction");
	});

	test("does not flag same-content records with similar confidence as contradiction", async () => {
		const { store, engine } = await createTestEnvironment();

		const record1 = makeRecord({
			type: "project_memory",
			title: "Uses npm",
			content: "The project uses npm.",
			confidence: 0.8,
		});
		const record2 = makeRecord({
			type: "project_memory",
			title: "Uses npm too",
			content: "The project uses npm as its package manager.",
			confidence: 0.75,
		});

		await store.create(record1);
		await store.create(record2);

		const analyses = await engine.detectConflicts(record2);
		const contradiction = analyses.filter((a) => a.conflictTypes.includes("contradiction"));
		expect(contradiction.length).toBe(0);
	});

	test("does not flag records of different types", async () => {
		const { store, engine } = await createTestEnvironment({
			contradictionThreshold: 0.3,
		});

		const record1 = makeRecord({
			type: "project_memory",
			title: "Uses npm",
			content: "The project uses npm",
			confidence: 0.9,
		});
		const record2 = makeRecord({
			type: "architecture_memory",
			title: "Uses npm",
			content: "The project uses npm",
			confidence: 0.2,
		});

		await store.create(record1);
		await store.create(record2);

		const analyses = await engine.detectConflicts(record2);
		expect(analyses.length).toBe(0);
	});
});

describe("ConflictDetectionEngine - duplicate detection", () => {
	test("detects duplicate records with near-identical content", async () => {
		const { store, engine } = await createTestEnvironment({
			duplicateSimilarityThreshold: 0.5,
		});

		const record1 = makeRecord({
			type: "decision_memory",
			title: "Use TypeScript strict mode",
			content: "We decided to enable TypeScript strict mode for all packages.",
		});
		const record2 = makeRecord({
			type: "decision_memory",
			title: "Use TypeScript strict mode - copy",
			content: "We decided to enable TypeScript strict mode for all packages in the monorepo.",
		});

		await store.create(record1);
		await store.create(record2);

		const analyses = await engine.detectConflicts(record2);

		expect(analyses.length).toBeGreaterThanOrEqual(1);
		const analysis = analyses.find((a) => a.memoryId === record1.id);
		expect(analysis).toBeDefined();
		expect(analysis!.conflictTypes).toContain("duplicate");
	});

	test("does not flag different-content records as duplicate", async () => {
		const { store, engine } = await createTestEnvironment();

		const record1 = makeRecord({
			type: "execution_memory",
			title: "Build succeeded",
			content: "The build completed successfully.",
		});
		const record2 = makeRecord({
			type: "execution_memory",
			title: "Tests failed",
			content: "The test suite encountered failures in the async module.",
		});

		await store.create(record1);
		await store.create(record2);

		const analyses = await engine.detectConflicts(record2);
		const duplicates = analyses.filter((a) => a.conflictTypes.includes("duplicate"));
		expect(duplicates.length).toBe(0);
	});
});

describe("ConflictDetectionEngine - staleness detection", () => {
	test("flags active records older than threshold as stale", async () => {
		const { store, engine } = await createTestEnvironment({
			stalenessThresholdDays: 10,
		});

		const staleRecord = makeAgedRecord(15, {
			type: "project_memory",
			title: "Old architecture decision",
			content: "We decided to use microservices.",
			lifecycle: "active",
			confidence: 0.7,
		});
		await store.create(staleRecord);

		const conflicts = await engine.runFullDetection();

		const staleConflicts = conflicts.filter((c) => c.conflictType === "staleness");
		expect(staleConflicts.length).toBe(1);
		expect(staleConflicts[0].recordIds).toContain(staleRecord.id);
	});

	test("does not flag young records as stale", async () => {
		const { store, engine } = await createTestEnvironment({
			stalenessThresholdDays: 30,
		});

		const youngRecord = makeAgedRecord(5, {
			type: "project_memory",
			title: "Recent decision",
			content: "We decided to use React.",
			lifecycle: "active",
			confidence: 0.8,
		});
		await store.create(youngRecord);

		const conflicts = await engine.runFullDetection();

		const staleConflicts = conflicts.filter((c) => c.conflictType === "staleness");
		expect(staleConflicts.length).toBe(0);
	});
});

describe("ConflictDetectionEngine - full detection", () => {
	test("runFullDetection creates conflict records in store", async () => {
		const { store, engine } = await createTestEnvironment({
			contradictionThreshold: 0.4,
			duplicateSimilarityThreshold: 0.5,
			stalenessThresholdDays: 5,
		});

		// Create contradicting records
		const record1 = makeRecord({
			type: "decision_memory",
			title: "Use SQL",
			content: "The team decided to use SQLite.",
			confidence: 0.9,
		});
		const record2 = makeRecord({
			type: "decision_memory",
			title: "Use SQL or NoSQL?",
			content: "The team decided to use SQLite. Maybe switch to PostgreSQL.",
			confidence: 0.3,
		});

		// Create duplicate records
		const record3 = makeRecord({
			type: "project_memory",
			title: "Port 8080",
			content: "The dev server runs on port 8080.",
		});
		const record4 = makeRecord({
			type: "project_memory",
			title: "Port 8080 duplicate",
			content: "The dev server runs on port 8080 for all environments.",
		});

		// Create stale record
		const staleRecord = makeAgedRecord(10, {
			type: "execution_memory",
			title: "Old execution log",
			content: "Build #100 completed.",
			lifecycle: "active",
			confidence: 0.5,
		});

		await store.create(record1);
		await store.create(record2);
		await store.create(record3);
		await store.create(record4);
		await store.create(staleRecord);

		const conflicts = await engine.runFullDetection();

		// Should have at least 3 conflicts (contradiction, duplicate, staleness)
		expect(conflicts.length).toBeGreaterThanOrEqual(3);

		const conflictTypes = conflicts.map((c) => c.conflictType);
		expect(conflictTypes).toContain("contradiction");
		expect(conflictTypes).toContain("duplicate");
		expect(conflictTypes).toContain("staleness");

		// Verify conflict records are persisted
		for (const conflict of conflicts) {
			const persisted = await engine.getConflict(conflict.id);
			expect(persisted).toBeDefined();
			expect(persisted!.id).toBe(conflict.id);
		}
	});
});

describe("ConflictDetectionEngine - conflict management", () => {
	test("getConflicts returns all persisted conflicts", async () => {
		const { store, engine } = await createTestEnvironment({
			contradictionThreshold: 0.4,
		});

		const record1 = makeRecord({
			type: "plan_memory",
			title: "Plan A",
			content: "Execute phase one immediately.",
			confidence: 0.9,
		});
		const record2 = makeRecord({
			type: "plan_memory",
			title: "Plan B",
			content: "Execute phase one after review. Actually not.",
			confidence: 0.2,
		});

		await store.create(record1);
		await store.create(record2);

		await engine.runFullDetection();

		const conflicts = await engine.getConflicts();
		expect(conflicts.length).toBeGreaterThanOrEqual(1);
	});

	test("getConflict returns specific conflict by ID", async () => {
		const { store, engine } = await createTestEnvironment({
			contradictionThreshold: 0.3,
		});

		const record1 = makeRecord({
			type: "failure_memory",
			title: "Memory leak fixed",
			content: "Fixed the memory leak in the worker pool.",
			confidence: 0.95,
		});
		const record2 = makeRecord({
			type: "failure_memory",
			title: "Memory leak persists",
			content: "Fixed the memory leak in the worker pool. Actually it persists.",
			confidence: 0.25,
		});

		await store.create(record1);
		await store.create(record2);

		const conflicts = await engine.runFullDetection();
		expect(conflicts.length).toBeGreaterThanOrEqual(1);

		const fetched = await engine.getConflict(conflicts[0].id);
		expect(fetched).toBeDefined();
		expect(fetched!.id).toBe(conflicts[0].id);
		expect(fetched!.recordIds).toEqual(expect.arrayContaining([record1.id, record2.id]));
	});

	test("getConflict returns null for non-existent conflict", async () => {
		const { engine } = await createTestEnvironment();
		const result = await engine.getConflict("non-existent-id");
		expect(result).toBeNull();
	});
});

describe("ConflictDetectionEngine - conflict resolution", () => {
	test("resolveConflict marks conflict as user_selected", async () => {
		const { store, engine } = await createTestEnvironment({
			duplicateSimilarityThreshold: 0.5,
		});

		const record1 = makeRecord({
			type: "idea_memory",
			title: "Dark mode support",
			content: "Add dark mode support to the UI.",
			confidence: 0.8,
		});
		const record2 = makeRecord({
			type: "idea_memory",
			title: "Dark mode for UI",
			content: "Add dark mode support to the user interface.",
			confidence: 0.9,
		});

		await store.create(record1);
		await store.create(record2);

		const conflicts = await engine.runFullDetection();
		const duplicateConflict = conflicts.find((c) => c.conflictType === "duplicate");
		expect(duplicateConflict).toBeDefined();

		await engine.resolveConflict(
			duplicateConflict!.id,
			record2.id,
			"User confirmed record 2 is the canonical version",
		);

		const resolved = await engine.getConflict(duplicateConflict!.id);
		expect(resolved).toBeDefined();
		expect(resolved!.resolution).toBe("user_selected");
		expect(resolved!.resolvedBy).toBe(record2.id);
		expect(resolved!.resolvedAt).toBeDefined();
	});

	test("resolveConflict throws when winner not in conflict", async () => {
		const { store, engine } = await createTestEnvironment({
			duplicateSimilarityThreshold: 0.5,
		});

		const record1 = makeRecord({
			type: "user_preference_memory",
			title: "Theme: light",
			content: "User prefers light theme.",
			confidence: 0.8,
		});
		const record2 = makeRecord({
			type: "user_preference_memory",
			title: "Theme light mode",
			content: "User prefers light theme mode.",
			confidence: 0.7,
		});

		await store.create(record1);
		await store.create(record2);

		const conflicts = await engine.runFullDetection();
		const dupConflict = conflicts.find((c) => c.conflictType === "duplicate");
		expect(dupConflict).toBeDefined();

		await expect(engine.resolveConflict(dupConflict!.id, "non-existent-id", "This should fail")).rejects.toThrow(
			"not part of conflict",
		);
	});

	test("resolveConflict throws when conflict not found", async () => {
		const { engine } = await createTestEnvironment();

		await expect(engine.resolveConflict("non-existent", "some-id", "Nope")).rejects.toThrow("Conflict not found");
	});

	test("autoResolveConflict picks highest confidence for duplicates", async () => {
		const { store, engine } = await createTestEnvironment({
			duplicateSimilarityThreshold: 0.5,
		});

		const record1 = makeRecord({
			type: "architecture_memory",
			title: "REST API design",
			content: "RESTful API with Express routes.",
			confidence: 0.6,
		});
		const record2 = makeRecord({
			type: "architecture_memory",
			title: "REST API patterns",
			content: "RESTful API with Express route handlers.",
			confidence: 0.95,
		});

		await store.create(record1);
		await store.create(record2);

		const conflicts = await engine.runFullDetection();
		const dupConflict = conflicts.find((c) => c.conflictType === "duplicate");
		expect(dupConflict).toBeDefined();

		await engine.autoResolveConflict(dupConflict!.id);

		const resolved = await engine.getConflict(dupConflict!.id);
		expect(resolved).toBeDefined();
		expect(resolved!.resolution).toBe("auto_resolved");
		expect(resolved!.resolvedBy).toBe(record2.id); // higher confidence
	});

	test("autoResolveConflict does not resolve contradictions", async () => {
		const { store, engine } = await createTestEnvironment({
			contradictionThreshold: 0.4,
		});

		const record1 = makeRecord({
			type: "decision_memory",
			title: "Use Jest",
			content: "We decided to use Jest for testing.",
			confidence: 0.9,
		});
		const record2 = makeRecord({
			type: "decision_memory",
			title: "Switch test framework",
			content: "We decided to use Jest for testing. Actually switch to Vitest.",
			confidence: 0.2,
		});

		await store.create(record1);
		await store.create(record2);

		const conflicts = await engine.runFullDetection();
		const contradictionConflict = conflicts.find((c) => c.conflictType === "contradiction");
		expect(contradictionConflict).toBeDefined();

		await engine.autoResolveConflict(contradictionConflict!.id);

		const resolved = await engine.getConflict(contradictionConflict!.id);
		expect(resolved!.resolution).toBeUndefined();
	});
});

describe("ConflictDetectionEngine - scheduled detection", () => {
	test("runScheduledDetection runs full detection and returns conflicts", async () => {
		const { store, engine } = await createTestEnvironment({
			duplicateSimilarityThreshold: 0.4,
			contradictionThreshold: 0.4,
			stalenessThresholdDays: 1,
		});

		// Contradicting pair
		const r1 = makeRecord({
			type: "plan_memory",
			title: "Deploy now",
			content: "Deploy to production immediately.",
			confidence: 0.9,
		});
		const r2 = makeRecord({
			type: "plan_memory",
			title: "Delay deploy",
			content: "Deploy to production immediately. Actually delay.",
			confidence: 0.2,
		});

		// Stale record
		const r3 = makeAgedRecord(10, {
			type: "execution_memory",
			title: "Old run",
			content: "Execution #42.",
			lifecycle: "active",
			confidence: 0.5,
		});

		await store.create(r1);
		await store.create(r2);
		await store.create(r3);

		const conflicts = await engine.runScheduledDetection();
		expect(conflicts.length).toBeGreaterThanOrEqual(2); // at least contradiction + staleness
	});

	test("runScheduledDetection auto-resolves when configured", async () => {
		const { store, engine } = await createTestEnvironment({
			duplicateSimilarityThreshold: 0.4,
			autoResolve: true,
		});

		const r1 = makeRecord({
			type: "idea_memory",
			title: "Dark mode",
			content: "Add dark mode.",
			confidence: 0.7,
		});
		const r2 = makeRecord({
			type: "idea_memory",
			title: "Dark mode feature",
			content: "Add dark mode to the app.",
			confidence: 0.95,
		});

		await store.create(r1);
		await store.create(r2);

		const conflicts = await engine.runScheduledDetection();
		const dupConflicts = conflicts.filter((c) => c.conflictType === "duplicate");
		expect(dupConflicts.length).toBe(1);

		const resolved = await engine.getConflict(dupConflicts[0].id);
		expect(resolved!.resolution).toBe("auto_resolved");
		expect(resolved!.resolvedBy).toBe(r2.id); // highest confidence
	});
});

describe("ConflictDetectionEngine - edge cases", () => {
	test("handles empty store gracefully", async () => {
		const { engine } = await createTestEnvironment();

		const conflicts = await engine.runFullDetection();
		expect(conflicts).toEqual([]);

		const stored = await engine.getConflicts();
		expect(stored).toEqual([]);
	});

	test("handles single record without conflicts", async () => {
		const { store, engine } = await createTestEnvironment();

		const record = makeRecord({
			type: "project_memory",
			title: "Solo record",
			content: "Only one record in the store.",
		});
		await store.create(record);

		const conflicts = await engine.runFullDetection();
		expect(conflicts.length).toBe(0); // no staleness because threshold is 180 days
	});

	test("detectConflicts returns empty array for a record with no conflicts", async () => {
		const { store, engine } = await createTestEnvironment();

		const record1 = makeRecord({
			type: "architecture_memory",
			title: "Event-driven",
			content: "Event-driven architecture with message queues.",
		});
		const record2 = makeRecord({
			type: "failure_memory",
			title: "Timeout bug",
			content: "Timeout error in the queue consumer.",
		});

		await store.create(record1);
		await store.create(record2);

		const analyses = await engine.detectConflicts(record2);
		expect(analyses.length).toBe(0);
	});

	test("persisted conflict records survive across engine instances", async () => {
		const {
			store,
			engine: engine1,
			basePath,
		} = await createTestEnvironment({
			duplicateSimilarityThreshold: 0.4,
		});

		const r1 = makeRecord({
			type: "user_preference_memory",
			title: "Font size 14",
			content: "User prefers font size 14.",
			confidence: 0.8,
		});
		const r2 = makeRecord({
			type: "user_preference_memory",
			title: "Font size 14px",
			content: "User prefers font size 14 pixels.",
			confidence: 0.9,
		});

		await store.create(r1);
		await store.create(r2);

		const conflicts = await engine1.runFullDetection();
		expect(conflicts.length).toBeGreaterThanOrEqual(1);

		// Create a new engine with same store (same basePath)
		const store2 = new MemoryStore({ basePath });
		await store2.initialize();
		const engine2 = new ConflictDetectionEngine(store2);

		const persistedConflicts = await engine2.getConflicts();
		expect(persistedConflicts.length).toBeGreaterThanOrEqual(1);
		expect(persistedConflicts[0].id).toBe(conflicts[0].id);
		expect(persistedConflicts[0].conflictType).toBe("duplicate");
	});
});
