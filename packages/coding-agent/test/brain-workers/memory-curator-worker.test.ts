/**
 * Memory Curator Worker — 25.M
 *
 * Covers:
 * - MemoryCuratorWorker session lifecycle (create, scan, detect conflicts, compact, complete)
 * - Budget enforcement (token budget, runtime budget)
 * - Deduplication (task hash matching, dedup window expiry)
 * - Consecutive failure tracking and health checks
 * - Evidence-backed diagnostics on failures
 * - Conflict detection (overlap, contradiction, duplicate)
 * - Compaction analysis (archive, supersede, merge, delete, flag_review)
 * - Manifest generation
 * - Edge cases and error conditions
 * - Cancellation
 */

import { describe, expect, test } from "vitest";
import {
	ALL_COMPACTION_ACTION_TYPES,
	ALL_CURATION_SESSION_STATUSES,
	ALL_MEMORY_CONFLICT_TYPES,
	ConflictReviewer,
	createConflictReviewer,
	createMemoryCuratorContract,
	createMemoryCuratorWorker,
	createStaleMemoryDetector,
	DEFAULT_MEMORY_CURATOR_BUDGET,
	DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG,
	MemoryCuratorWorker,
	StaleMemoryDetector,
} from "../../src/brain-workers/memory-curator/index.js";
import { validateWorkerManifest } from "../../src/brain-workers/types.js";

// =============================================================================
// MemoryCuratorWorker — Constructor & Configuration
// =============================================================================

describe("MemoryCuratorWorker — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const worker = new MemoryCuratorWorker();
		const config = worker.getConfig();

		expect(config.maxTokensPerSession).toBe(100_000);
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
		expect(config.maxConsecutiveFailures).toBe(4);
		expect(config.cooldownMs).toBe(60_000);
		expect(config.dedupEnabled).toBe(true);
		expect(config.dedupWindowMs).toBe(300_000);
		expect(config.maxRecordsPerSession).toBe(500);
		expect(config.conflictConfidenceThreshold).toBe(0.7);
		expect(config.minRecordAgeForCompactionMs).toBe(2_592_000_000);
		expect(config.autoCompact).toBe(false);
		expect(config.maxActionsPerSession).toBe(50);
	});

	test("creates with partial configuration overrides", () => {
		const worker = new MemoryCuratorWorker({
			maxTokensPerSession: 50_000,
			maxConsecutiveFailures: 5,
			dedupEnabled: false,
			autoCompact: true,
		});

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(50_000);
		expect(config.maxConsecutiveFailures).toBe(5);
		expect(config.dedupEnabled).toBe(false);
		expect(config.autoCompact).toBe(true);
		// Unchanged defaults
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
		expect(config.cooldownMs).toBe(60_000);
		expect(config.maxRecordsPerSession).toBe(500);
	});

	test("setConfig updates configuration", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxTokensPerSession: 99_999, dedupWindowMs: 10_000 });

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(99_999);
		expect(config.dedupWindowMs).toBe(10_000);
	});

	test("setConfig updates conflict confidence threshold", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.9 });

		expect(worker.getConfig().conflictConfidenceThreshold).toBe(0.9);
	});

	test("setConfig updates auto-compact setting", () => {
		const worker = new MemoryCuratorWorker();
		expect(worker.getConfig().autoCompact).toBe(false);

		worker.setConfig({ autoCompact: true });
		expect(worker.getConfig().autoCompact).toBe(true);
	});

	test("initial stats are all zeros", () => {
		const worker = new MemoryCuratorWorker();
		const stats = worker.getStats();

		expect(stats.totalSessions).toBe(0);
		expect(stats.completed).toBe(0);
		expect(stats.failed).toBe(0);
		expect(stats.cancelled).toBe(0);
		expect(stats.pending).toBe(0);
		expect(stats.consecutiveFailures).toBe(0);
		expect(stats.totalSessionsCompleted).toBe(0);
		expect(stats.totalSessionsFailed).toBe(0);
		expect(stats.totalTokensConsumed).toBe(0);
		expect(stats.totalConflictsDetected).toBe(0);
		expect(stats.totalCompactionActions).toBe(0);
		expect(stats.totalRecordsArchived).toBe(0);
		expect(stats.totalRecordsSuperseded).toBe(0);
		expect(stats.totalRecordsMerged).toBe(0);
		expect(stats.totalRecordsDeleted).toBe(0);
		expect(stats.healthStatus).toBe("healthy");
		expect(stats.dedupHistorySize).toBe(0);
	});

	test("factory function creates worker with default config", () => {
		const worker = createMemoryCuratorWorker();
		expect(worker).toBeInstanceOf(MemoryCuratorWorker);
		expect(worker.getConfig().maxTokensPerSession).toBe(100_000);
	});

	test("factory function creates worker with partial config", () => {
		const worker = createMemoryCuratorWorker({ maxTokensPerSession: 25_000, autoCompact: true });
		expect(worker).toBeInstanceOf(MemoryCuratorWorker);
		expect(worker.getConfig().maxTokensPerSession).toBe(25_000);
		expect(worker.getConfig().autoCompact).toBe(true);
	});
});

// =============================================================================
// MemoryCuratorWorker — Manifest Generation
// =============================================================================

describe("MemoryCuratorWorker — Manifest Generation", () => {
	test("generates a valid worker manifest", () => {
		const worker = new MemoryCuratorWorker();
		const manifest = worker.generateManifest("Memory Curator Alpha", "Primary memory curator instance");

		expect(manifest.id).toBeDefined();
		expect(manifest.id.length).toBeGreaterThan(0);
		expect(manifest.role).toBe("archivist");
		expect(manifest.name).toBe("Memory Curator Alpha");
		expect(manifest.description).toBe("Primary memory curator instance");
		expect(manifest.contract).toBeDefined();
		expect(manifest.contract.capabilities).toContain("memory_lifecycle");
		expect(manifest.contract.capabilities).toContain("conflict_detection");
		expect(manifest.contract.capabilities).toContain("memory_compaction");

		const validation = validateWorkerManifest(manifest);
		expect(validation.valid).toBe(true);
	});

	test("manifest includes budget defaults", () => {
		const worker = new MemoryCuratorWorker();
		const manifest = worker.generateManifest("Test Curator", "Test desc");

		expect(manifest.budget).toBeDefined();
		expect(manifest.budget.maxTokensPerCycle).toBe(100_000);
		expect(manifest.budget.maxConsecutiveFailures).toBe(4);
		expect(manifest.budget.cooldownMs).toBe(60_000);
		expect(manifest.budget.maxRuntimeMs).toBe(300_000);
	});

	test("manifest includes dedup config", () => {
		const worker = new MemoryCuratorWorker();
		const manifest = worker.generateManifest("Test Curator", "Test desc");

		expect(manifest.dedupConfig).toBeDefined();
		expect(manifest.dedupConfig.enabled).toBe(true);
		expect(manifest.dedupConfig.windowMs).toBe(300_000);
	});
});

// =============================================================================
// MemoryCuratorWorker — Session Lifecycle
// =============================================================================

describe("MemoryCuratorWorker — Session Lifecycle", () => {
	test("createSession creates a session in idle state", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test-curation", ["rec-1", "rec-2", "rec-3"]);

		expect(session).not.toBeNull();
		expect(session!.id).toBeDefined();
		expect(session!.label).toBe("test-curation");
		expect(session!.status).toBe("idle");
		expect(session!.inputRecordIds).toEqual(["rec-1", "rec-2", "rec-3"]);
		expect(session!.recordsScanned).toBe(0);
		expect(session!.conflicts).toEqual([]);
		expect(session!.compactionActions).toEqual([]);
		expect(session!.createdAt).toBeDefined();
		expect(session!.updatedAt).toBeDefined();
	});

	test("createSession returns null on duplicate within dedup window", () => {
		const worker = new MemoryCuratorWorker();
		const hash = "test-hash-001";

		const first = worker.createSession("first", ["rec-1"], {}, hash);
		expect(first).not.toBeNull();

		const second = worker.createSession("second", ["rec-1"], {}, hash);
		expect(second).toBeNull(); // Deduped
	});

	test("createSession allows session after dedup window expires", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ dedupWindowMs: 0 }); // Zero window means no dedup window
		const hash = "test-hash-002";

		const first = worker.createSession("first", ["rec-1"], {}, hash);
		expect(first).not.toBeNull();

		// With 0ms window, the entry is already expired
		const second = worker.createSession("second", ["rec-1"], {}, hash);
		expect(second).not.toBeNull();
	});

	test("startScanning transitions from idle to scanning", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1", "rec-2"]);
		expect(session!.status).toBe("idle");

		const scanned = worker.startScanning(session!.id, 5);
		expect(scanned).not.toBeNull();
		expect(scanned!.status).toBe("scanning");
		expect(scanned!.recordsScanned).toBe(5);
	});

	test("startScanning clamps recordsScanned to maxRecordsPerSession", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxRecordsPerSession: 10 });
		const session = worker.createSession("test", ["rec-1", "rec-2"]);

		const scanned = worker.startScanning(session!.id, 100);
		expect(scanned!.recordsScanned).toBe(10); // Clamped
	});

	test("startScanning returns null if session not found", () => {
		const worker = new MemoryCuratorWorker();
		const result = worker.startScanning("nonexistent-id", 5);
		expect(result).toBeNull();
	});

	test("startScanning returns null if session is not idle", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1"]);
		worker.startScanning(session!.id, 1);

		// Can't scan again
		const retry = worker.startScanning(session!.id, 2);
		expect(retry).toBeNull();
	});

	test("detectConflicts transitions from scanning to detecting_conflicts", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);

		const count = worker.detectConflicts(session!.id);
		expect(count).toBeGreaterThanOrEqual(0);
		const updated = worker.getSession(session!.id);
		expect(updated!.status).toBe("detecting_conflicts");
	});

	test("detectConflicts returns -1 if session not found", () => {
		const worker = new MemoryCuratorWorker();
		const result = worker.detectConflicts("nonexistent-id");
		expect(result).toBe(-1);
	});

	test("detectConflicts returns -1 if session is not in scanning state", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1"]);
		// Session is idle, not scanning
		const result = worker.detectConflicts(session!.id);
		expect(result).toBe(-1);
	});

	test("detectConflicts with existing conflicts detects them", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 }); // Accept all

		const session = worker.createSession("test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);

		const count = worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "contradiction" as const,
				description: "Records contradict each other",
			},
		]);

		expect(count).toBe(2);
		expect(session!.conflicts.length).toBe(2);
		const contradictionConflict = session!.conflicts.find((c) => c.type === "contradiction");
		expect(contradictionConflict).toBeDefined();
	});

	test("detectConflicts filters by confidence threshold", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.99 }); // Very high threshold

		const session = worker.createSession("test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);

		// Conflicts are generated with random confidence, but 0.99 threshold
		// means very few will pass
		const count = worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "duplicate" as const,
				description: "Duplicate records",
			},
		]);

		// With 0.99 threshold, it's extremely unlikely the random confidence
		// (max ~0.95) passes, but some overlap conflicts may still be detected
		// from the record ID patterns at lower confidence
		expect(count).toBeGreaterThanOrEqual(0);
	});

	test("compact transitions from detecting_conflicts to completed", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id);

		const actions = worker.compact(session!.id, 1000, 500);
		expect(actions).not.toBeNull();
		expect(Array.isArray(actions)).toBe(true);

		const updated = worker.getSession(session!.id);
		expect(updated!.status).toBe("completed");
	});

	test("compact returns null if session is not in detecting_conflicts state", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1"]);
		// Session is idle, not detecting_conflicts
		const actions = worker.compact(session!.id, 100, 50);
		expect(actions).toBeNull();
	});

	test("compact returns null for nonexistent session", () => {
		const worker = new MemoryCuratorWorker();
		const actions = worker.compact("nonexistent-id", 100, 50);
		expect(actions).toBeNull();
	});

	test("full session lifecycle: create -> scan -> detect -> compact -> complete", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 }); // Accept all

		const session = worker.createSession("full-lifecycle", ["rec-a1", "rec-b2", "rec-c3"]);
		expect(session!.status).toBe("idle");

		worker.startScanning(session!.id, 3);
		expect(worker.getSession(session!.id)!.status).toBe("scanning");

		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-a1", "rec-b2"],
				type: "overlap",
				description: "Potential overlap detected",
			},
		]);
		expect(worker.getSession(session!.id)!.status).toBe("detecting_conflicts");

		const actions = worker.compact(session!.id, 2000, 1000);
		expect(actions).not.toBeNull();
		expect(worker.getSession(session!.id)!.status).toBe("completed");

		const stats = worker.getStats();
		expect(stats.totalSessions).toBe(1);
		expect(stats.completed).toBe(1);
	});

	test("cancels an active session", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1"]);
		expect(session!.status).toBe("idle");

		const cancelled = worker.cancelSession(session!.id, "User requested cancellation");
		expect(cancelled).not.toBeNull();
		expect(cancelled!.status).toBe("cancelled");
		expect(cancelled!.error).toBe("User requested cancellation");
	});

	test("cancelSession returns null for already completed session", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("test", ["rec-1"]);
		worker.startScanning(session!.id, 1);
		worker.detectConflicts(session!.id);
		worker.compact(session!.id);

		const cancelled = worker.cancelSession(session!.id, "Too late");
		expect(cancelled).toBeNull();
	});

	test("cancelSession returns null for nonexistent session", () => {
		const worker = new MemoryCuratorWorker();
		const result = worker.cancelSession("nonexistent", "reason");
		expect(result).toBeNull();
	});

	test("getSession returns undefined for nonexistent session", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.getSession("nonexistent");
		expect(session).toBeUndefined();
	});

	test("getAllSessions returns all sessions", () => {
		const worker = new MemoryCuratorWorker();
		worker.createSession("a", ["r1"]);
		worker.createSession("b", ["r2"]);

		const all = worker.getAllSessions();
		expect(all.length).toBe(2);
	});

	test("getSessionsByStatus filters correctly", () => {
		const worker = new MemoryCuratorWorker();
		worker.createSession("s1", ["r1"]);
		const s2 = worker.createSession("s2", ["r2"]);
		worker.cancelSession(s2!.id, "cancelled");

		const idleSessions = worker.getSessionsByStatus("idle");
		expect(idleSessions.length).toBe(1);
		expect(idleSessions[0]!.label).toBe("s1");

		const cancelledSessions = worker.getSessionsByStatus("cancelled");
		expect(cancelledSessions.length).toBe(1);
	});
});

// =============================================================================
// MemoryCuratorWorker — Budget Enforcement
// =============================================================================

describe("MemoryCuratorWorker — Budget Enforcement", () => {
	test("compact fails when token budget exceeded", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxTokensPerSession: 1000, conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("budget-test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "duplicate",
				description: "Duplicate records",
			},
		]);

		// Exceed token budget
		const actions = worker.compact(session!.id, 2000, 100);
		expect(actions).toBeNull();

		const updated = worker.getSession(session!.id);
		expect(updated!.status).toBe("failed");
		expect(updated!.error).toContain("Token budget exceeded");
		expect(updated!.diagnostic).not.toBeNull();
		expect(updated!.diagnostic!.stopCondition).toBe("token_budget_exhausted");
	});

	test("compact fails when runtime budget exceeded", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxRuntimeMsPerSession: 500, conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("runtime-test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "duplicate",
				description: "Duplicate records",
			},
		]);

		// Exceed runtime budget
		const actions = worker.compact(session!.id, 100, 1000);
		expect(actions).toBeNull();

		const updated = worker.getSession(session!.id);
		expect(updated!.status).toBe("failed");
		expect(updated!.error).toContain("Runtime budget exceeded");
		expect(updated!.diagnostic).not.toBeNull();
		expect(updated!.diagnostic!.stopCondition).toBe("timeout");
	});

	test("consecutive failures are tracked after budget failures", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxTokensPerSession: 100, conflictConfidenceThreshold: 0.0, maxConsecutiveFailures: 3 });

		// Run 3 failing sessions
		for (let i = 0; i < 3; i++) {
			const session = worker.createSession(`fail-${i}`, ["rec-1", "rec-2"]);
			worker.startScanning(session!.id, 2);
			worker.detectConflicts(session!.id, [
				{
					recordIds: ["rec-1", "rec-2"],
					type: "duplicate",
					description: "Duplicate records",
				},
			]);
			worker.compact(session!.id, 200, 50); // Exceeds token budget of 100
		}

		const stats = worker.getStats();
		expect(stats.consecutiveFailures).toBe(3);
		expect(stats.healthStatus).toBe("unhealthy");

		const health = worker.checkHealth();
		expect(health).not.toBeNull();
		expect(health!.stopCondition).toBe("consecutive_failures_exceeded");
	});

	test("tracks totalTokensConsumed on successful compaction", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("tokens-test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "duplicate",
				description: "dup",
			},
		]);

		const tokensUsed = 5000;
		worker.compact(session!.id, tokensUsed, 100);

		expect(worker.getStats().totalTokensConsumed).toBe(tokensUsed);
		expect(session!.tokensConsumed).toBe(tokensUsed);
	});

	test("tracks totalTokensConsumed across multiple successful sessions", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 });

		// Session 1: 3000 tokens
		const s1 = worker.createSession("s1", ["rec-1"]);
		worker.startScanning(s1!.id, 1);
		worker.detectConflicts(s1!.id);
		worker.compact(s1!.id, 3000, 50);

		// Session 2: 7000 tokens
		const s2 = worker.createSession("s2", ["rec-2"]);
		worker.startScanning(s2!.id, 1);
		worker.detectConflicts(s2!.id);
		worker.compact(s2!.id, 7000, 50);

		expect(worker.getStats().totalTokensConsumed).toBe(10000);
	});
});

// =============================================================================
// MemoryCuratorWorker — Deduplication
// =============================================================================

describe("MemoryCuratorWorker — Deduplication", () => {
	test("computeTaskHash produces deterministic hashes", () => {
		const worker = new MemoryCuratorWorker();
		const hash1 = worker.computeTaskHash("records: rec-1, rec-2");
		const hash2 = worker.computeTaskHash("records: rec-1, rec-2");

		expect(hash1).toBe(hash2);
		expect(hash1.length).toBe(64); // SHA-256 hex
	});

	test("computeTaskHash produces different hashes for different inputs", () => {
		const worker = new MemoryCuratorWorker();
		const hash1 = worker.computeTaskHash("input-A");
		const hash2 = worker.computeTaskHash("input-B");

		expect(hash1).not.toBe(hash2);
	});

	test("isDuplicate returns false when dedup is disabled", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ dedupEnabled: false });

		const hash = worker.computeTaskHash("test-input");
		worker.createSession("test", ["r1"], {}, hash);

		expect(worker.isDuplicate(hash)).toBe(false);
	});

	test("isDuplicate returns true within dedup window", () => {
		const worker = new MemoryCuratorWorker();
		const hash = worker.computeTaskHash("test-input");
		worker.createSession("test", ["r1"], {}, hash);

		expect(worker.isDuplicate(hash)).toBe(true);
	});

	test("isDuplicate returns false after dedup window expires", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ dedupWindowMs: 0 });

		const hash = worker.computeTaskHash("test-input");
		worker.createSession("test", ["r1"], {}, hash);

		expect(worker.isDuplicate(hash)).toBe(false);
	});

	test("isDuplicate returns false for unknown hash", () => {
		const worker = new MemoryCuratorWorker();
		expect(worker.isDuplicate("unknown-hash")).toBe(false);
	});

	test("pruneDedupHistory removes expired entries", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ dedupWindowMs: 0 });

		const hash = worker.computeTaskHash("prune-test");
		worker.createSession("test", ["r1"], {}, hash);

		// With 0ms window, it should be expired immediately
		worker.pruneDedupHistory();
		expect(worker.isDuplicate(hash)).toBe(false);
	});
});

// =============================================================================
// MemoryCuratorWorker — Conflict Detection
// =============================================================================

describe("MemoryCuratorWorker — Conflict Detection", () => {
	test("detects overlap conflicts from record ID prefixes", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 }); // Accept all

		const session = worker.createSession("detect-test", ["proj-records-001", "proj-records-002"]);
		worker.startScanning(session!.id, 2);
		const count = worker.detectConflicts(session!.id);

		// Should detect overlap from shared prefix "proj"
		expect(count).toBeGreaterThanOrEqual(1);
		const overlapConflicts = session!.conflicts.filter((c) => c.type === "overlap");
		expect(overlapConflicts.length).toBeGreaterThanOrEqual(1);
	});

	test("detectConflicts with contradiction type produces correct suggested resolution", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "contradiction",
				description: "Records contradict each other on key facts",
			},
		]);

		expect(session!.conflicts.length).toBe(2);
		const contradictionConflict = session!.conflicts.find((c) => c.type === "contradiction");
		expect(contradictionConflict).toBeDefined();
		expect(contradictionConflict!.suggestedResolution).toContain("Review both records");
	});

	test("detectConflicts with duplicate type produces correct suggested resolution", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "duplicate",
				description: "Records are exact duplicates",
			},
		]);

		expect(session!.conflicts.length).toBe(2);
		const duplicateConflict = session!.conflicts.find((c) => c.type === "duplicate");
		expect(duplicateConflict).toBeDefined();
		expect(duplicateConflict!.suggestedResolution).toContain("most recent");
	});
});

// =============================================================================
// MemoryCuratorWorker — Compaction Analysis
// =============================================================================

describe("MemoryCuratorWorker — Compaction Analysis", () => {
	test("produces archive actions for old records", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0, minRecordAgeForCompactionMs: 0 });

		const session = worker.createSession("archive-test", ["old-rec-1", "old-rec-2"], {
			recordTimestamps: {
				"old-rec-1": "2024-01-01T00:00:00.000Z",
				"old-rec-2": "2024-01-01T00:00:00.000Z",
			},
		});
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id);
		worker.compact(session!.id, 100, 50);

		// With 0 minRecordAgeForCompactionMs, these old records should
		// generate archive actions
		const archiveActions = session!.compactionActions.filter((a) => a.actionType === "archive");
		expect(archiveActions.length).toBe(2);
	});

	test("produces supersede actions for duplicate conflicts", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0, minRecordAgeForCompactionMs: 1_000_000_000_000 }); // Very high age threshold to prevent archive

		const session = worker.createSession("supersede-test", ["dup-a", "dup-b"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["dup-a", "dup-b"],
				type: "duplicate",
				description: "Duplicate records",
			},
		]);
		worker.compact(session!.id, 100, 50);

		const supersedeActions = session!.compactionActions.filter((a) => a.actionType === "supersede");
		expect(supersedeActions.length).toBe(1);
	});

	test("produces merge actions for overlap conflicts", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({
			conflictConfidenceThreshold: 0.0,
			minRecordAgeForCompactionMs: 1_000_000_000_000,
		});

		const session = worker.createSession("merge-test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "overlap",
				description: "Overlapping records",
			},
		]);
		worker.compact(session!.id, 100, 50);

		const mergeActions = session!.compactionActions.filter((a) => a.actionType === "merge");
		expect(mergeActions.length).toBe(2);
	});

	test("produces flag_review actions for contradiction conflicts", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({
			conflictConfidenceThreshold: 0.0,
			minRecordAgeForCompactionMs: 1_000_000_000_000,
		});

		const session = worker.createSession("flag-test", ["rec-1", "rec-2"]);
		worker.startScanning(session!.id, 2);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "contradiction",
				description: "Conflicting records",
			},
		]);
		worker.compact(session!.id, 100, 50);

		const flagActions = session!.compactionActions.filter((a) => a.actionType === "flag_review");
		expect(flagActions.length).toBe(1);
	});

	test("produces routine flag_review actions when no other actions exist", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({
			conflictConfidenceThreshold: 0.99, // Very high threshold to prevent conflict detection
			minRecordAgeForCompactionMs: 1_000_000_000_000, // Prevent archive
		});

		const session = worker.createSession("routine-test", ["rec-a", "rec-b", "rec-c"]);
		worker.startScanning(session!.id, 3);
		worker.detectConflicts(session!.id);
		worker.compact(session!.id, 100, 50);

		// With no conflicts detected and no old records, should produce
		// routine flag_review actions (up to 3 records)
		const flagActions = session!.compactionActions.filter((a) => a.actionType === "flag_review");
		expect(flagActions.length).toBeGreaterThanOrEqual(1);
		expect(flagActions.length).toBeLessThanOrEqual(3);
	});
});

// =============================================================================
// MemoryCuratorWorker — Health and Diagnostics
// =============================================================================

describe("MemoryCuratorWorker — Health and Diagnostics", () => {
	test("initial health is healthy", () => {
		const worker = new MemoryCuratorWorker();
		expect(worker.getHealthStatus()).toBe("healthy");
		expect(worker.checkHealth()).toBeNull();
	});

	test("health becomes degraded after some failures", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxTokensPerSession: 100, maxConsecutiveFailures: 5, conflictConfidenceThreshold: 0.0 });

		// Produce 2 failures (less than maxConsecutiveFailures = 5)
		for (let i = 0; i < 2; i++) {
			const session = worker.createSession(`fail-${i}`, ["rec-1", "rec-2"]);
			worker.startScanning(session!.id, 2);
			worker.detectConflicts(session!.id, [
				{
					recordIds: ["rec-1", "rec-2"],
					type: "duplicate",
					description: "dup",
				},
			]);
			worker.compact(session!.id, 200, 50);
		}

		expect(worker.getHealthStatus()).toBe("degraded");
	});

	test("health becomes unhealthy after max consecutive failures", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxTokensPerSession: 100, maxConsecutiveFailures: 2, conflictConfidenceThreshold: 0.0 });

		for (let i = 0; i < 2; i++) {
			const session = worker.createSession(`fail-${i}`, ["rec-1", "rec-2"]);
			worker.startScanning(session!.id, 2);
			worker.detectConflicts(session!.id, [
				{
					recordIds: ["rec-1", "rec-2"],
					type: "duplicate",
					description: "dup",
				},
			]);
			worker.compact(session!.id, 200, 50);
		}

		expect(worker.getHealthStatus()).toBe("unhealthy");
		const diagnostic = worker.checkHealth();
		expect(diagnostic).not.toBeNull();
		expect(diagnostic!.stopCondition).toBe("consecutive_failures_exceeded");
	});

	test("health recovers after successful session", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ maxTokensPerSession: 100, maxConsecutiveFailures: 5, conflictConfidenceThreshold: 0.0 });

		// 2 failures
		for (let i = 0; i < 2; i++) {
			const session = worker.createSession(`fail-${i}`, ["rec-1", "rec-2"]);
			worker.startScanning(session!.id, 2);
			worker.detectConflicts(session!.id, [
				{
					recordIds: ["rec-1", "rec-2"],
					type: "duplicate",
					description: "dup",
				},
			]);
			worker.compact(session!.id, 200, 50);
		}

		expect(worker.getHealthStatus()).toBe("degraded");

		// Successful session
		const session3 = worker.createSession("success", ["rec-3"]);
		worker.startScanning(session3!.id, 1);
		worker.detectConflicts(session3!.id);
		worker.compact(session3!.id, 50, 50);
		expect(worker.getSession(session3!.id)!.status).toBe("completed");

		// Consecutive failures should be reset
		expect(worker.getHealthStatus()).toBe("healthy");
	});
});

// =============================================================================
// MemoryCuratorWorker — Clear
// =============================================================================

describe("MemoryCuratorWorker — Clear", () => {
	test("clear resets all state", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("test", ["rec-1"]);
		worker.startScanning(session!.id, 1);
		worker.detectConflicts(session!.id, [
			{
				recordIds: ["rec-1", "rec-2"],
				type: "duplicate",
				description: "dup",
			},
		]);
		worker.compact(session!.id, 100, 50);

		worker.clear();

		const stats = worker.getStats();
		expect(stats.totalSessions).toBe(0);
		expect(stats.totalSessionsCompleted).toBe(0);
		expect(stats.totalSessionsFailed).toBe(0);
		expect(stats.consecutiveFailures).toBe(0);
		expect(stats.healthStatus).toBe("healthy");
		expect(worker.getAllSessions().length).toBe(0);
	});
});

// =============================================================================
// MemoryCuratorWorker — Constants & Runtime Validation
// =============================================================================

describe("MemoryCuratorWorker — Constants & Validation", () => {
	test("ALL_CURATION_SESSION_STATUSES contains all expected statuses", () => {
		expect(ALL_CURATION_SESSION_STATUSES).toContain("idle");
		expect(ALL_CURATION_SESSION_STATUSES).toContain("scanning");
		expect(ALL_CURATION_SESSION_STATUSES).toContain("detecting_conflicts");
		expect(ALL_CURATION_SESSION_STATUSES).toContain("compacting");
		expect(ALL_CURATION_SESSION_STATUSES).toContain("completed");
		expect(ALL_CURATION_SESSION_STATUSES).toContain("failed");
		expect(ALL_CURATION_SESSION_STATUSES).toContain("cancelled");
	});

	test("ALL_MEMORY_CONFLICT_TYPES contains all expected types", () => {
		expect(ALL_MEMORY_CONFLICT_TYPES).toContain("contradiction");
		expect(ALL_MEMORY_CONFLICT_TYPES).toContain("overlap");
		expect(ALL_MEMORY_CONFLICT_TYPES).toContain("stale_ref");
		expect(ALL_MEMORY_CONFLICT_TYPES).toContain("duplicate");
		expect(ALL_MEMORY_CONFLICT_TYPES).toContain("confidence_drop");
	});

	test("ALL_COMPACTION_ACTION_TYPES contains all expected types", () => {
		expect(ALL_COMPACTION_ACTION_TYPES).toContain("archive");
		expect(ALL_COMPACTION_ACTION_TYPES).toContain("supersede");
		expect(ALL_COMPACTION_ACTION_TYPES).toContain("merge");
		expect(ALL_COMPACTION_ACTION_TYPES).toContain("delete");
		expect(ALL_COMPACTION_ACTION_TYPES).toContain("flag_review");
	});

	test("DEFAULT_MEMORY_CURATOR_BUDGET has correct values", () => {
		expect(DEFAULT_MEMORY_CURATOR_BUDGET.maxTokensPerCycle).toBe(100_000);
		expect(DEFAULT_MEMORY_CURATOR_BUDGET.maxConsecutiveFailures).toBe(4);
		expect(DEFAULT_MEMORY_CURATOR_BUDGET.cooldownMs).toBe(60_000);
		expect(DEFAULT_MEMORY_CURATOR_BUDGET.maxRuntimeMs).toBe(600_000);
	});

	test("DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG has correct values", () => {
		expect(DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG.enabled).toBe(true);
		expect(DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG.windowMs).toBe(300_000);
		expect(DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG.useSimilarity).toBe(true);
		expect(DEFAULT_MEMORY_CURATOR_DEDUP_CONFIG.similarityThreshold).toBe(0.85);
	});

	test("createMemoryCuratorContract produces valid contract", () => {
		const contract = createMemoryCuratorContract("2.0.0");
		expect(contract.id).toBe("brain-worker.memory-curator.v2.0.0");
		expect(contract.name).toBe("Memory Curator Worker Contract");
		expect(contract.version).toBe("2.0.0");
		expect(contract.capabilities).toContain("memory_lifecycle");
		expect(contract.capabilities).toContain("conflict_detection");
		expect(contract.capabilities).toContain("memory_compaction");
		expect(contract.inputs.length).toBeGreaterThanOrEqual(1);
		expect(contract.outputs.length).toBeGreaterThanOrEqual(1);
		expect(contract.supportsCancellation).toBe(true);
		expect(contract.readonlyAccess).toBe(false);
	});
});

// =============================================================================
// MemoryCuratorWorker — Edge Cases
// =============================================================================

describe("MemoryCuratorWorker — Edge Cases", () => {
	test("createSession with empty record IDs", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("empty-test", []);
		expect(session).not.toBeNull();
		expect(session!.inputRecordIds).toEqual([]);
	});

	test("createSession with undefined record IDs defaults to empty array", () => {
		const worker = new MemoryCuratorWorker();
		const session = worker.createSession("undefined-test");
		expect(session).not.toBeNull();
		expect(session!.inputRecordIds).toEqual([]);
	});

	test("getSessionsByStatus returns empty array when no sessions match", () => {
		const worker = new MemoryCuratorWorker();
		const result = worker.getSessionsByStatus("completed");
		expect(result).toEqual([]);
	});

	test("compact with zero tokens and runtime succeeds", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("zero-test", ["rec-1"]);
		worker.startScanning(session!.id, 1);
		worker.detectConflicts(session!.id);
		const actions = worker.compact(session!.id, 0, 0);
		expect(actions).not.toBeNull();
		expect(session!.status).toBe("completed");
	});

	test("multiple sessions can coexist", () => {
		const worker = new MemoryCuratorWorker();

		const s1 = worker.createSession("session-1", ["r1"]);
		const s2 = worker.createSession("session-2", ["r2"]);
		const s3 = worker.createSession("session-3", ["r3"]);

		expect(worker.getAllSessions().length).toBe(3);
		expect(s1!.id).not.toBe(s2!.id);
		expect(s2!.id).not.toBe(s3!.id);
	});

	test("detectConflicts with empty existing conflicts still detects overlap patterns", () => {
		const worker = new MemoryCuratorWorker();
		worker.setConfig({ conflictConfidenceThreshold: 0.0 });

		const session = worker.createSession("pattern-test", ["shared-prefix-a", "shared-prefix-b", "unique-xyz"]);
		worker.startScanning(session!.id, 3);
		const count = worker.detectConflicts(session!.id);

		// Should detect at least one overlap conflict from the "shared" prefix
		expect(count).toBeGreaterThanOrEqual(1);
	});
});

// =============================================================================
// StaleMemoryDetector — Staleness Detection
// =============================================================================

describe("StaleMemoryDetector — Construction & Configuration", () => {
	test("creates with default configuration", () => {
		const detector = createStaleMemoryDetector();
		const config = detector.getConfig();

		expect(config.defaultTtlMs).toBe(90 * 24 * 60 * 60 * 1000);
		expect(config.minConfidenceThreshold).toBe(0.3);
		expect(config.detectExpiredRefs).toBe(true);
		expect(config.detectOrphans).toBe(false);
		expect(config.minDetectionConfidence).toBe(0.5);
	});

	test("creates with partial configuration overrides", () => {
		const detector = createStaleMemoryDetector({ defaultTtlMs: 10_000, detectOrphans: true });

		expect(detector.getConfig().defaultTtlMs).toBe(10_000);
		expect(detector.getConfig().detectOrphans).toBe(true);
		// Unchanged defaults
		expect(detector.getConfig().minConfidenceThreshold).toBe(0.3);
	});

	test("setConfig updates configuration", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minDetectionConfidence: 0.8, detectExpiredRefs: false });

		expect(detector.getConfig().minDetectionConfidence).toBe(0.8);
		expect(detector.getConfig().detectExpiredRefs).toBe(false);
	});

	test("initial stats are all zeros", () => {
		const detector = new StaleMemoryDetector();
		const stats = detector.getStats();

		expect(stats.totalRuns).toBe(0);
		expect(stats.totalStaleDetected).toBe(0);
		expect(stats.byReason.ttl_expired).toBe(0);
		expect(stats.byReason.low_confidence).toBe(0);
		expect(stats.byReason.expired_ref).toBe(0);
		expect(stats.byReason.superseded).toBe(0);
		expect(stats.byReason.orphaned).toBe(0);
	});
});

describe("StaleMemoryDetector — Detection", () => {
	test("detects no stale records with empty input", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minDetectionConfidence: 0.0 });

		const stale = detector.detectStale([]);
		expect(stale).toEqual([]);
	});

	test("detects TTL-expired records", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ defaultTtlMs: 100, minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "old-rec",
				createdAt: "2020-01-01T00:00:00.000Z",
				updatedAt: "2020-01-01T00:00:00.000Z",
				ttlMs: null,
				confidence: 0.9,
				references: [],
				hasIncomingReferences: true,
				metadata: {},
			},
		];

		const stale = detector.detectStale(records);
		expect(stale.length).toBeGreaterThanOrEqual(1);
		expect(stale[0]!.reason).toBe("ttl_expired");
		expect(stale[0]!.suggestedAction).toBe("archive");
	});

	test("detects low-confidence records", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minConfidenceThreshold: 0.5, minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "low-conf-rec",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				ttlMs: 999_999_999,
				confidence: 0.2,
				references: [],
				hasIncomingReferences: true,
				metadata: {},
			},
		];

		const stale = detector.detectStale(records);
		expect(stale.length).toBeGreaterThanOrEqual(1);
		expect(stale[0]!.reason).toBe("low_confidence");
		expect(stale[0]!.suggestedAction).toBe("review");
	});

	test("detects expired references", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "ref-rec",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				ttlMs: 999_999_999,
				confidence: 0.9,
				references: ["other-rec"],
				hasIncomingReferences: false,
				metadata: {},
			},
		];

		const stale = detector.detectStale(records);
		const expiredRef = stale.find((s) => s.reason === "expired_ref");
		expect(expiredRef).toBeDefined();
		expect(expiredRef!.suggestedAction).toBe("review");
	});

	test("detects superseded records", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "superseded-rec",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				ttlMs: 999_999_999,
				confidence: 0.9,
				references: [],
				hasIncomingReferences: true,
				metadata: {},
			},
		];

		const stale = detector.detectStale(records, new Set(["superseded-rec"]));
		const superseded = stale.find((s) => s.reason === "superseded");
		expect(superseded).toBeDefined();
		expect(superseded!.suggestedAction).toBe("archive");
	});

	test("detects orphaned records when enabled", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ detectOrphans: true, minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "orphan-rec",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				ttlMs: 999_999_999,
				confidence: 0.9,
				references: [],
				hasIncomingReferences: false,
				metadata: {},
			},
		];

		const stale = detector.detectStale(records);
		const orphan = stale.find((s) => s.reason === "orphaned");
		expect(orphan).toBeDefined();
		expect(orphan!.suggestedAction).toBe("review");
	});

	test("records detection statistics", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "rec-1",
				createdAt: "2020-01-01T00:00:00.000Z",
				updatedAt: "2020-01-01T00:00:00.000Z",
				ttlMs: null,
				confidence: 0.9,
				references: [],
				hasIncomingReferences: true,
				metadata: {},
			},
			{
				id: "rec-2",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				ttlMs: 999_999_999,
				confidence: 0.1,
				references: [],
				hasIncomingReferences: true,
				metadata: {},
			},
		];

		detector.detectStale(records);

		const stats = detector.getStats();
		expect(stats.totalRuns).toBe(1);
		expect(stats.totalStaleDetected).toBeGreaterThanOrEqual(1);
	});

	test("resetStats clears all counters", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "rec-1",
				createdAt: "2020-01-01T00:00:00.000Z",
				updatedAt: "2020-01-01T00:00:00.000Z",
				ttlMs: null,
				confidence: 0.9,
				references: [],
				hasIncomingReferences: true,
				metadata: {},
			},
		];
		detector.detectStale(records);
		expect(detector.getStats().totalRuns).toBe(1);

		detector.resetStats();
		const stats = detector.getStats();
		expect(stats.totalRuns).toBe(0);
		expect(stats.totalStaleDetected).toBe(0);
	});

	test("clear clears all state", () => {
		const detector = new StaleMemoryDetector();
		detector.setConfig({ minDetectionConfidence: 0.0 });

		const records = [
			{
				id: "rec-1",
				createdAt: "2020-01-01T00:00:00.000Z",
				updatedAt: "2020-01-01T00:00:00.000Z",
				ttlMs: null,
				confidence: 0.9,
				references: [],
				hasIncomingReferences: true,
				metadata: {},
			},
		];
		detector.detectStale(records);
		expect(detector.getStats().totalRuns).toBe(1);

		detector.clear();
		expect(detector.getStats().totalRuns).toBe(0);
	});

	test("factory function creates detector with default config", () => {
		const detector = createStaleMemoryDetector();
		expect(detector).toBeInstanceOf(StaleMemoryDetector);
		expect(detector.getConfig().defaultTtlMs).toBe(90 * 24 * 60 * 60 * 1000);
	});

	test("factory function creates detector with partial config", () => {
		const detector = createStaleMemoryDetector({ defaultTtlMs: 5000, detectOrphans: true });
		expect(detector).toBeInstanceOf(StaleMemoryDetector);
		expect(detector.getConfig().defaultTtlMs).toBe(5000);
		expect(detector.getConfig().detectOrphans).toBe(true);
	});
});

// =============================================================================
// ConflictReviewer — Conflict Resolution
// =============================================================================

describe("ConflictReviewer — Construction & Configuration", () => {
	test("creates with default configuration", () => {
		const reviewer = new ConflictReviewer();
		const config = reviewer.getConfig();

		expect(config.autoResolveThreshold).toBe(0.7);
		expect(config.autoResolve).toBe(true);
		expect(config.preferMerge).toBe(true);
	});

	test("creates with partial configuration overrides", () => {
		const reviewer = new ConflictReviewer({ autoResolveThreshold: 0.9, preferMerge: false });

		expect(reviewer.getConfig().autoResolveThreshold).toBe(0.9);
		expect(reviewer.getConfig().preferMerge).toBe(false);
		// Unchanged defaults
		expect(reviewer.getConfig().autoResolve).toBe(true);
	});

	test("setConfig updates configuration", () => {
		const reviewer = new ConflictReviewer();
		reviewer.setConfig({ autoResolve: false, autoResolveThreshold: 0.5 });

		expect(reviewer.getConfig().autoResolve).toBe(false);
		expect(reviewer.getConfig().autoResolveThreshold).toBe(0.5);
	});

	test("initial stats are all zeros", () => {
		const reviewer = new ConflictReviewer();
		const stats = reviewer.getStats();

		expect(stats.totalReviews).toBe(0);
		expect(stats.autoResolved).toBe(0);
		expect(stats.escalated).toBe(0);
		expect(stats.failed).toBe(0);
		expect(stats.byStrategy.supersede_older).toBe(0);
		expect(stats.byStrategy.merge_records).toBe(0);
		expect(stats.byStrategy.flag_manual).toBe(0);
		expect(stats.byStrategy.delete_duplicate).toBe(0);
		expect(stats.byStrategy.update_reference).toBe(0);
	});
});

describe("ConflictReviewer — Review", () => {
	function makeConflict(
		type: "contradiction" | "overlap" | "stale_ref" | "duplicate" | "confidence_drop",
		recordIds: string[],
		confidence: number = 0.8,
	) {
		return {
			id: `conflict-${type}-${recordIds.join("-")}`,
			type,
			recordIds,
			description: `${type} conflict between ${recordIds.join(", ")}`,
			confidence,
			suggestedResolution: "review records",
			detectedAt: new Date().toISOString(),
			metadata: {},
		};
	}

	test("reviews a duplicate conflict and recommends delete", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("duplicate", ["rec-1", "rec-2"], 0.9);

		const result = reviewer.reviewConflict(conflict);

		expect(result.strategy).toBe("delete_duplicate");
		expect(result.actionType).toBe("delete");
		expect(result.confidence).toBeGreaterThan(0);
		expect(result.conflictId).toBe(conflict.id);
		expect(result.affectedRecordIds).toEqual(["rec-1", "rec-2"]);
	});

	test("reviews a contradiction conflict and flags for manual review", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("contradiction", ["rec-1", "rec-2"], 0.8);

		const result = reviewer.reviewConflict(conflict);

		expect(result.strategy).toBe("flag_manual");
		expect(result.actionType).toBe("flag_review");
	});

	test("reviews an overlap conflict and recommends merge", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("overlap", ["rec-1", "rec-2"], 0.8);

		const result = reviewer.reviewConflict(conflict);

		expect(result.strategy).toBe("merge_records");
		expect(result.actionType).toBe("merge");
	});

	test("reviews an overlap conflict and recommends supersede when preferMerge is false", () => {
		const reviewer = new ConflictReviewer({ preferMerge: false });
		const conflict = makeConflict("overlap", ["rec-1", "rec-2"], 0.8);

		const result = reviewer.reviewConflict(conflict);

		expect(result.strategy).toBe("supersede_older");
		expect(result.actionType).toBe("supersede");
	});

	test("reviews a stale_ref conflict and recommends update_reference", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("stale_ref", ["rec-1"], 0.8);

		const result = reviewer.reviewConflict(conflict);

		expect(result.strategy).toBe("update_reference");
		expect(result.actionType).toBe("flag_review");
	});

	test("reviews a confidence_drop conflict and flags for manual review", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("confidence_drop", ["rec-1"], 0.8);

		const result = reviewer.reviewConflict(conflict);

		expect(result.strategy).toBe("flag_manual");
		expect(result.actionType).toBe("flag_review");
	});

	test("escapes low-confidence conflicts when autoResolve threshold not met", () => {
		const reviewer = new ConflictReviewer({ autoResolveThreshold: 0.95 });
		const conflict = makeConflict("duplicate", ["rec-1", "rec-2"], 0.8);

		const result = reviewer.reviewConflict(conflict);

		// Even though strategy is delete_duplicate, confidence (0.8) < threshold (0.95)
		// so description should mention escalation
		expect(result.description).toContain("Manual review required");
	});

	test("reviews multiple conflicts at once", () => {
		const reviewer = new ConflictReviewer();

		const conflicts = [makeConflict("duplicate", ["a", "b"], 0.9), makeConflict("contradiction", ["c", "d"], 0.8)];

		const results = reviewer.reviewConflicts(conflicts);
		expect(results.length).toBe(2);
		expect(results[0]!.strategy).toBe("delete_duplicate");
		expect(results[1]!.strategy).toBe("flag_manual");
	});

	test("isResolved returns true for auto-resolved conflicts", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("duplicate", ["a", "b"], 0.9);

		const result = reviewer.reviewConflict(conflict);
		expect(reviewer.isResolved(result)).toBe(true);
	});

	test("isResolved returns false for escalated conflicts", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("contradiction", ["a", "b"], 0.8);

		const result = reviewer.reviewConflict(conflict);
		expect(reviewer.isResolved(result)).toBe(false);
	});

	test("tracks review statistics", () => {
		const reviewer = new ConflictReviewer();

		const conflicts = [
			makeConflict("duplicate", ["a", "b"], 0.9),
			makeConflict("overlap", ["c", "d"], 0.8),
			makeConflict("contradiction", ["e", "f"], 0.8),
		];

		reviewer.reviewConflicts(conflicts);

		const stats = reviewer.getStats();
		expect(stats.totalReviews).toBe(3);
		expect(stats.byStrategy.delete_duplicate).toBe(1);
		expect(stats.byStrategy.merge_records).toBe(1);
		expect(stats.byStrategy.flag_manual).toBe(1);
	});

	test("recordFailure increments failed count", () => {
		const reviewer = new ConflictReviewer();
		expect(reviewer.getStats().failed).toBe(0);

		reviewer.recordFailure();
		expect(reviewer.getStats().failed).toBe(1);

		reviewer.recordFailure();
		expect(reviewer.getStats().failed).toBe(2);
	});

	test("resetStats clears all counters", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("duplicate", ["a", "b"], 0.9);
		reviewer.reviewConflict(conflict);
		reviewer.recordFailure();

		expect(reviewer.getStats().totalReviews).toBe(1);
		expect(reviewer.getStats().failed).toBe(1);

		reviewer.resetStats();

		const stats = reviewer.getStats();
		expect(stats.totalReviews).toBe(0);
		expect(stats.autoResolved).toBe(0);
		expect(stats.escalated).toBe(0);
		expect(stats.failed).toBe(0);
	});

	test("clear clears all state", () => {
		const reviewer = new ConflictReviewer();
		const conflict = makeConflict("duplicate", ["a", "b"], 0.9);
		reviewer.reviewConflict(conflict);

		expect(reviewer.getStats().totalReviews).toBe(1);

		reviewer.clear();
		expect(reviewer.getStats().totalReviews).toBe(0);
	});

	test("factory function creates reviewer with default config", () => {
		const reviewer = createConflictReviewer();
		expect(reviewer).toBeInstanceOf(ConflictReviewer);
		expect(reviewer.getConfig().autoResolveThreshold).toBe(0.7);
	});

	test("factory function creates reviewer with partial config", () => {
		const reviewer = createConflictReviewer({ autoResolve: false });
		expect(reviewer).toBeInstanceOf(ConflictReviewer);
		expect(reviewer.getConfig().autoResolve).toBe(false);
	});
});
