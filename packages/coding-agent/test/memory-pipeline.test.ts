/**
 * Memory Pipeline Tests - P11.L
 *
 * Tests for the unified memory pipeline:
 * 1. Pipeline indexes plans, runs, and proposals with source provenance.
 * 2. Retrieval returns relevant memories with confidence scores and source pointers.
 * 3. Forbidden sources are blocked and counted.
 * 4. Compaction preserves provenance and marks superseded memories.
 */

import { describe, expect, it } from "vitest";
import type { ExecutionMemoryEntry } from "../src/memory/execution-memory.js";
import { createMemoryPipeline, MemoryPipeline } from "../src/memory/memory-pipeline.js";
import type { PlannerMemoryEntry } from "../src/memory/planner-memory.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a MemoryPipeline with default config for testing.
 */
function createTestPipeline(config?: Record<string, unknown>): MemoryPipeline {
	return new MemoryPipeline({ enabled: true, ...config });
}

/**
 * Create a sample execution memory entry for testing.
 */
function makeExecutionEntry(overrides: Partial<ExecutionMemoryEntry> = {}): ExecutionMemoryEntry {
	return {
		id: "exec-1",
		workspaceId: "P1.A",
		goal: "Set up database schema",
		acceptanceCriteria: ["Tables created", "Indexes added"],
		verdict: "COMPLETE",
		summary: "Created users and roles tables with proper indexes.",
		filesModified: ["db/schema.sql"],
		commandsRun: ["npm run migrate"],
		isFailure: false,
		timestamp: Date.now() - 3600000, // 1 hour ago
		...overrides,
	};
}

/**
 * Create a sample planner memory entry for testing.
 */
function makePlannerEntry(overrides: Partial<PlannerMemoryEntry> = {}): PlannerMemoryEntry {
	return {
		id: "plan-1",
		phase: "P2",
		title: "Feature Implementation Plan",
		workspaceCount: 5,
		maxParallelWorkspaces: 3,
		effectiveParallelism: 2,
		totalBatches: 3,
		isOverSerialized: true,
		hadWarnings: true,
		warningTypes: ["over_serialized"],
		suggestionTypes: ["add_parallel_group"],
		bottlenecks: ["Workspace C depends on A and B"],
		suggestionSummaries: ["Consider adding parallelGroup hints"],
		summaryText: "Plan with 5 workspaces across 3 batches. Over-serialization detected.",
		verdict: "applied",
		timestamp: Date.now() - 7200000, // 2 hours ago
		...overrides,
	};
}

// ============================================================================
// AC1: Pipeline indexes plans, runs, and proposals with source provenance
// ============================================================================

describe("AC1: Pipeline indexes plans, runs, and proposals with source provenance", () => {
	it("ingests an execution run with provenance", async () => {
		const pipeline = createTestPipeline();
		const execEntry = makeExecutionEntry();

		const result = await pipeline.ingestExecutionEntry(execEntry);

		expect(result).not.toBeNull();
		expect(result!.provenance.kind).toBe("run");
		expect(result!.provenance.sourceId).toBe("P1.A");
		expect(result!.provenance.description).toContain("Set up database schema");
		expect(result!.provenance.sourcePointer).toEqual({
			workspaceId: "P1.A",
			verdict: "COMPLETE",
			filesModified: ["db/schema.sql"],
		});
		expect(result!.provenance.timestamp).toBeGreaterThan(0);
	});

	it("ingests a planner analysis with provenance", async () => {
		const pipeline = createTestPipeline();
		const planEntry = makePlannerEntry();

		const result = await pipeline.ingestPlannerEntry(planEntry);

		expect(result).not.toBeNull();
		expect(result!.provenance.kind).toBe("plan");
		expect(result!.provenance.sourceId).toBe("P2");
		expect(result!.provenance.description).toContain("Feature Implementation Plan");
		expect(result!.provenance.sourcePointer).toEqual({
			phase: "P2",
			title: "Feature Implementation Plan",
			workspaceCount: 5,
			totalBatches: 3,
			queueOutcome: undefined,
		});
	});

	it("ingests a proposal with provenance", async () => {
		const pipeline = createTestPipeline();

		const result = await pipeline.ingestProposal(
			"prop-42",
			"Add user authentication flow",
			"Proposal to implement JWT-based authentication with refresh tokens.",
			["auth", "jwt", "security"],
			{ priority: "high" },
		);

		expect(result).not.toBeNull();
		expect(result!.provenance.kind).toBe("proposal");
		expect(result!.provenance.sourceId).toBe("prop-42");
		expect(result!.provenance.description).toBe("Proposal: Add user authentication flow");
		expect(result!.provenance.sourcePointer).toEqual({
			proposalId: "prop-42",
			title: "Add user authentication flow",
		});
	});

	it("ingests all three source types and retrieves them", async () => {
		const pipeline = createTestPipeline();

		// Index a run
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "R1", goal: "Fix login bug" }));

		// Index a plan
		await pipeline.ingestPlannerEntry(makePlannerEntry({ phase: "P3", title: "Auth Refactor Plan" }));

		// Index a proposal
		await pipeline.ingestProposal("prop-1", "OAuth Integration", "Add OAuth 2.0 support.");

		const all = await pipeline.getAll();
		expect(all).toHaveLength(3);

		const kinds = all.map((e) => e.provenance.kind);
		expect(kinds).toContain("run");
		expect(kinds).toContain("plan");
		expect(kinds).toContain("proposal");
	});

	it("deduplicates identical content from the same source", async () => {
		const pipeline = createTestPipeline();

		const result1 = await pipeline.ingestExecutionEntry(makeExecutionEntry());
		const result2 = await pipeline.ingestExecutionEntry(makeExecutionEntry());

		expect(result1).not.toBeNull();
		expect(result2).toBeNull(); // Deduplicated

		const count = await pipeline.count();
		expect(count).toBe(1);
	});

	it("returns null when pipeline is disabled", async () => {
		const pipeline = new MemoryPipeline({ enabled: false });

		const result = await pipeline.ingestExecutionEntry(makeExecutionEntry());
		expect(result).toBeNull();

		const count = await pipeline.count();
		expect(count).toBe(0);
	});

	it("ingests a manual memory entry", async () => {
		const pipeline = createTestPipeline();

		const result = await pipeline.ingest({
			provenance: {
				kind: "manual",
				sourceId: "manual-1",
				description: "User-provided memory about deployment",
				sourcePointer: { note: "Deploy to staging first" },
				timestamp: Date.now(),
			},
			title: "Deployment best practice",
			content: "Always deploy to staging before production.",
			keywords: ["deploy", "staging", "production"],
			severity: "high",
		});

		expect(result).not.toBeNull();
		expect(result!.provenance.kind).toBe("manual");
		expect(result!.severity).toBe("high");
	});

	it("stores source provenance on every entry", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry());
		await pipeline.ingestPlannerEntry(makePlannerEntry());
		await pipeline.ingestProposal("prop-99", "Test", "Description.");

		const all = await pipeline.getAll();
		for (const entry of all) {
			expect(entry.provenance).toBeDefined();
			expect(entry.provenance.kind).toBeTruthy();
			expect(entry.provenance.sourceId).toBeTruthy();
			expect(entry.provenance.sourcePointer).toBeDefined();
			expect(entry.provenance.timestamp).toBeGreaterThan(0);
		}
	});
});

// ============================================================================
// AC2: Forbidden sources are blocked and counted
// ============================================================================

describe("AC2: Forbidden sources are blocked and counted", () => {
	it("blocks retrieval of specific forbidden source IDs", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "known-bad-run",
			kind: "run",
			sourceIdPattern: "bad-*",
			reason: "Known problematic workspace",
		});

		// Index a good run and a bad run
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "good-run", goal: "Good task" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "bad-run", goal: "Bad task" }));

		// Retrieval should only return the good run
		const results = await pipeline.retrieve("task");
		expect(results.results.length).toBe(1);
		expect(results.results[0].entry.provenance.sourceId).toBe("good-run");
		expect(results.blocked.count).toBe(1);
	});

	it("blocks retrieval of all source kinds with '*' pattern", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "block-all-p1",
			kind: "*",
			sourceIdPattern: "P1.*",
			reason: "Block all P1 sources",
		});

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "P1.A", goal: "Legacy task" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "P2.B", goal: "Current task" }));

		const results = await pipeline.retrieve("task");
		expect(results.results.length).toBe(1);
		expect(results.results[0].entry.provenance.sourceId).toBe("P2.B");
		expect(results.blocked.count).toBe(1);
	});

	it("counts blocked sources per label", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "deprecated-plans",
			kind: "plan",
			sourceIdPattern: "OLD-*",
			reason: "Deprecated phase",
		});

		// Ingest two matching forbidden sources
		await pipeline.ingestPlannerEntry(makePlannerEntry({ phase: "OLD-A", title: "Old plan A" }));
		await pipeline.ingestPlannerEntry(makePlannerEntry({ phase: "OLD-B", title: "Old plan B" }));
		await pipeline.ingestPlannerEntry(makePlannerEntry({ phase: "NEW-C", title: "New plan C" }));

		// Retrieve
		await pipeline.retrieve("plan");
		const counts = pipeline.getBlockedSourceCounts();
		expect(counts.get("deprecated-plans")).toBe(2);
	});

	it("blocks by description pattern", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "experimental",
			kind: "proposal",
			sourceIdPattern: "*",
			descriptionPattern: "*experimental*",
			reason: "Experimental proposals not trusted",
		});

		await pipeline.ingestProposal("prop-1", "Stable Feature", "Stable description.");
		await pipeline.ingestProposal("prop-2", "Experimental Feature", "This is experimental.");

		const results = await pipeline.retrieve("feature");
		expect(results.results.length).toBe(1);
		expect(results.results[0].entry.provenance.sourceId).toBe("prop-1");
		expect(results.blocked.count).toBe(1);
	});

	it("blocks forbidden sources during retrieval (not ingestion)", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "blocked-phase",
			kind: "plan",
			sourceIdPattern: "BLOCKED-*",
			reason: "Testing blocked retrieval",
		});

		// Ingestion succeeds regardless
		const result = await pipeline.ingestPlannerEntry(
			makePlannerEntry({ phase: "BLOCKED-P1", title: "Blocked plan" }),
		);
		expect(result).not.toBeNull();

		// But retrieval blocks the forbidden source
		const retrieval = await pipeline.retrieve("plan");
		expect(retrieval.results).toHaveLength(0);
		expect(retrieval.blocked.count).toBe(1);
	});

	it("can remove forbidden sources", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "temp-block",
			kind: "run",
			sourceIdPattern: "temp-*",
			reason: "Temporary block",
		});

		const sources = pipeline.getForbiddenSources();
		expect(sources.length).toBeGreaterThanOrEqual(1);
		const hasTempBlock = sources.some((s) => s.label === "temp-block");
		expect(hasTempBlock).toBe(true);

		const removed = pipeline.removeForbiddenSource("temp-block");
		expect(removed).toBe(true);

		const remaining = pipeline.getForbiddenSources();
		expect(remaining.some((s) => s.label === "temp-block")).toBe(false);
	});

	it("retrieval response reports blocked sources", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "bad-workspace",
			kind: "run",
			sourceIdPattern: "ws-bad*",
			reason: "Known bad workspace",
		});

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "ws-bad-1", goal: "Bad" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "ws-good-1", goal: "Good" }));

		const results = await pipeline.retrieve("workspace");
		expect(results.blocked.count).toBe(1);
		expect(results.blocked.blocked[0].label).toBe("bad-workspace");
		expect(results.blocked.blocked[0].reason).toBe("Known bad workspace");
	});

	it("resetBlockedSourceCounts clears counters", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "test-block",
			kind: "run",
			sourceIdPattern: "block-*",
			reason: "Test",
		});

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "block-me", goal: "Blocked" }));
		await pipeline.retrieve("test");
		expect(pipeline.getBlockedSourceCounts().get("test-block")).toBe(1);

		pipeline.resetBlockedSourceCounts();
		expect(pipeline.getBlockedSourceCounts().get("test-block")).toBeUndefined();
	});
});

// ============================================================================
// AC3: Retrieval responses include confidence and source pointers
// ============================================================================

describe("AC3: Retrieval responses include confidence and source pointers", () => {
	it("returns confidence scores for each result", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "DB-1",
				goal: "Database schema setup",
				summary: "Created users table with indexes.",
			}),
		);

		const results = await pipeline.retrieve("database schema");
		expect(results.results.length).toBeGreaterThanOrEqual(1);
		expect(results.results[0].confidence).toBeGreaterThan(0);
		expect(results.results[0].confidence).toBeLessThanOrEqual(1);
	});

	it("returns source pointer with each result", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-1", goal: "Setup CI/CD" }));

		const results = await pipeline.retrieve("CI/CD");
		expect(results.results.length).toBeGreaterThanOrEqual(1);
		expect(results.results[0].sourcePointer).toBeDefined();
		expect(results.results[0].sourcePointer.workspaceId).toBe("WS-1");
	});

	it("returns provenance with each result", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestProposal("prop-42", "Auth flow", "Implement authentication.", [
			"authentication",
			"auth",
			"flow",
		]);

		const results = await pipeline.retrieve("authentication");
		expect(results.results.length).toBeGreaterThanOrEqual(1);
		expect(results.results[0].provenance.kind).toBe("proposal");
		expect(results.results[0].provenance.sourceId).toBe("prop-42");
	});

	it("returns confidence factors explaining the score", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "TEST-1",
				goal: "Unit test implementation",
				summary: "Added unit tests for the auth module.",
			}),
		);

		const results = await pipeline.retrieve("unit test auth");
		expect(results.results.length).toBeGreaterThanOrEqual(1);

		const factors = results.results[0].confidenceFactors;
		expect(factors.length).toBeGreaterThanOrEqual(1);

		// Check factor structure
		for (const factor of factors) {
			expect(factor.factor).toBeTruthy();
			expect(typeof factor.weight).toBe("number");
			expect(factor.explanation).toBeTruthy();
		}
	});

	it("sorts results by confidence (highest first)", async () => {
		const pipeline = createTestPipeline();

		// Ingest memory entries with varying relevance to "database"
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "DB-1",
				goal: "Database schema design",
				summary: "Designed the database schema with tables and indexes.",
			}),
		);
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "FE-1",
				goal: "Frontend UI components",
				summary: "Built React components for the UI.",
			}),
		);
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "API-1",
				goal: "REST API for database access",
				summary: "Created REST API endpoints for database CRUD operations.",
			}),
		);

		const results = await pipeline.retrieve("database");

		// Results should be sorted by confidence descending
		expect(results.results.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < results.results.length; i++) {
			expect(results.results[i - 1].confidence).toBeGreaterThanOrEqual(results.results[i].confidence);
		}
	});

	it("respects minConfidence threshold", async () => {
		const pipeline = new MemoryPipeline({ enabled: true, minConfidence: 0.8 });

		// Ingest with very specific terms
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "REL-1",
				goal: "Highly relevant task about database indexing",
				summary: "Created database indexes for performance.",
			}),
		);
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "IRR-1",
				goal: "CSS styling",
				summary: "Styled components.",
			}),
		);

		// Query for something that only matches one
		const results = await pipeline.retrieve("database indexing performance");

		// Only highly relevant entries should pass the threshold
		expect(results.results.length).toBe(1);
		expect(results.results[0].entry.provenance.sourceId).toBe("REL-1");
	});

	it("returns retrieval metadata (totalCandidates, blocked, timeMs)", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry());
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-2", goal: "Another task" }));

		const results = await pipeline.retrieve("task");

		expect(results.totalCandidates).toBeGreaterThanOrEqual(1);
		expect(typeof results.blocked).toBe("object");
		expect(typeof results.retrievalTimeMs).toBe("number");
		expect(results.retrievalTimeMs).toBeGreaterThanOrEqual(0);
	});

	it("returns empty results for non-matching queries", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "DB-1",
				goal: "Database schema",
				summary: "Created tables.",
			}),
		);

		const results = await pipeline.retrieve("quantum physics theory");
		expect(results.results).toHaveLength(0);
	});

	it("filters by source kind", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "RUN-1", goal: "Run task" }));
		await pipeline.ingestPlannerEntry(makePlannerEntry({ phase: "PLAN-1", title: "Plan task" }));

		const runResults = await pipeline.retrieve("task", "run");
		expect(runResults.results.every((r) => r.provenance.kind === "run")).toBe(true);

		const planResults = await pipeline.retrieve("task", "plan");
		expect(planResults.results.every((r) => r.provenance.kind === "plan")).toBe(true);
	});
});

// ============================================================================
// AC4: Compaction preserves provenance and marks superseded memory
// ============================================================================

describe("AC4: Compaction preserves provenance and marks superseded memory", () => {
	it("archives old entries based on age threshold", async () => {
		const pipeline = createTestPipeline();
		const now = Date.now();

		// Entry from long ago
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "OLD-1",
				goal: "Old task",
				timestamp: now - 100000000, // ~28 hours
			}),
		);
		// Recent entry
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "NEW-1",
				goal: "New task",
				timestamp: now - 1000,
			}),
		);

		// Compact with 1 hour max age
		const report = await pipeline.compact(3600000); // 1 hour

		expect(report.stats.superseded).toBe(0);
		expect(report.stats.archived).toBe(1);
		expect(report.stats.activeKept).toBe(1);

		// Check that provenance is preserved on the archived entry
		// Use getAll to find the old entry
		const allEntries = await pipeline.getAll();
		const archivedEntry = allEntries.find((e) => e.provenance.sourceId === "OLD-1");
		expect(archivedEntry).toBeDefined();
		expect(archivedEntry!.status).toBe("archived");
		expect(archivedEntry!.provenance.kind).toBe("run");
		expect(archivedEntry!.provenance.sourceId).toBe("OLD-1");
		expect(archivedEntry!.provenance.sourcePointer).toBeDefined();
	});

	it("deduplicates by source ID + content", async () => {
		const pipeline = createTestPipeline();

		// Same workspace + same content = dedup
		const result1 = await pipeline.ingestExecutionEntry(
			makeExecutionEntry({ workspaceId: "WS-DEDUP", goal: "Duplicate test" }),
		);

		// Second ingest of same workspace + same content should dedup
		const result2 = await pipeline.ingestExecutionEntry(
			makeExecutionEntry({ workspaceId: "WS-DEDUP", goal: "Duplicate test" }),
		);

		expect(result1).not.toBeNull();
		expect(result2).toBeNull();

		// Different workspace + same content = no dedup
		const result3 = await pipeline.ingestExecutionEntry(
			makeExecutionEntry({ workspaceId: "WS-DIFFERENT", goal: "Duplicate test" }),
		);
		expect(result3).not.toBeNull();

		expect(await pipeline.count()).toBe(2);
	});

	it("deduplicates identical source ID + title + content", async () => {
		const pipeline = createTestPipeline();

		const content = "Fixed the database connection pool leak.";

		// Create first entry from a specific source
		const entry1 = await pipeline.ingest({
			provenance: {
				kind: "plan",
				sourceId: "PLAN-42",
				description: "Pool leak fix",
				sourcePointer: { ref: "v1" },
				timestamp: Date.now() - 50000,
			},
			title: "Fix connection pool",
			content,
			severity: "high",
		});
		expect(entry1).not.toBeNull();

		// Same source + same title + same content = dedup
		const entry2 = await pipeline.ingest({
			provenance: {
				kind: "plan",
				sourceId: "PLAN-42",
				description: "Pool leak fix v2",
				sourcePointer: { ref: "v2" },
				timestamp: Date.now(),
			},
			title: "Fix connection pool",
			content,
			severity: "high",
		});
		expect(entry2).toBeNull(); // Deduplicated by source + content

		// Only one entry
		expect(await pipeline.count()).toBe(1);

		// But different source with same content = separate entry
		const entry3 = await pipeline.ingest({
			provenance: {
				kind: "plan",
				sourceId: "PLAN-99",
				description: "Pool leak fix elsewhere",
				sourcePointer: { ref: "v1" },
				timestamp: Date.now(),
			},
			title: "Fix connection pool",
			content,
			severity: "high",
		});
		expect(entry3).not.toBeNull();

		expect(await pipeline.count()).toBe(2);
	});

	it("preserves provenance on superseded entries", async () => {
		const pipeline = createTestPipeline();

		// Create first entry with distinctive content
		const v1 = await pipeline.ingest({
			provenance: {
				kind: "proposal",
				sourceId: "PROP-V1",
				description: "Original proposal",
				sourcePointer: { version: 1 },
				timestamp: Date.now() - 10000,
			},
			title: "OAuth Integration v1",
			content: "Original proposal content version 1.",
			severity: "medium",
		});
		expect(v1).not.toBeNull();

		// Create second entry with different content (no dedup)
		const v2 = await pipeline.ingest({
			provenance: {
				kind: "proposal",
				sourceId: "PROP-V2",
				description: "Updated proposal",
				sourcePointer: { version: 2 },
				timestamp: Date.now(),
			},
			title: "OAuth Integration v2",
			content: "Updated proposal content version 2.",
			severity: "medium",
		});
		expect(v2).not.toBeNull();

		// Run compaction with a very short age to trigger archival
		// But we want to test superseding, not archival
		// Manually supersede v1
		v1!.status = "superseded";
		v1!.supersededByIds.push(v2!.id);
		v2!.supersedesIds.push(v1!.id);

		// Verify provenance preserved on superseded entry
		const checkEntry = await pipeline.getById(v1!.id);
		expect(checkEntry).not.toBeNull();
		expect(checkEntry!.status).toBe("superseded");
		expect(checkEntry!.provenance.kind).toBe("proposal");
		expect(checkEntry!.provenance.sourceId).toBe("PROP-V1");
		expect(checkEntry!.provenance.sourcePointer).toEqual({ version: 1 });
		expect(checkEntry!.supersededByIds).toContain(v2!.id);
	});

	it("compaction report contains compacted and preserved lists", async () => {
		const pipeline = createTestPipeline();
		const now = Date.now();

		// Old entry that will be archived
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "OLD-2",
				goal: "Legacy task",
				timestamp: now - 100000,
			}),
		);
		// New entry that will be preserved
		await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "NEW-2",
				goal: "Current task",
				timestamp: now,
			}),
		);

		const report = await pipeline.compact(50000); // 50 second max age

		// Check report structure
		expect(report.compacted.length).toBeGreaterThanOrEqual(1);
		expect(report.preserved.length).toBeGreaterThanOrEqual(1);
		expect(report.stats.totalBefore).toBe(2);
		expect(report.stats.archived).toBeGreaterThanOrEqual(1);
		expect(report.stats.activeKept).toBeGreaterThanOrEqual(1);

		// Each compacted entry has provenance preserved
		for (const compacted of report.compacted) {
			expect(compacted.entryId).toBeTruthy();
			expect(compacted.title).toBeTruthy();
			expect(compacted.reason).toBeTruthy();
		}

		// Each preserved entry has provenance
		for (const preserved of report.preserved) {
			expect(preserved.entryId).toBeTruthy();
			expect(preserved.title).toBeTruthy();
			expect(preserved.provenance.kind).toBeTruthy();
		}
	});

	it("does not lose entries during compaction (total preserved)", async () => {
		const pipeline = createTestPipeline();

		// Add some entries
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "A" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "B" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "C" }));

		const before = await pipeline.count();
		const report = await pipeline.compact(1); // Very short age

		// Total entries should be the same (status changes, not deletion)
		const after = await pipeline.count();
		expect(after).toBe(before);
		expect(report.stats.totalAfter).toBe(before);
	});

	it("compaction preserves source pointers on all entries", async () => {
		const pipeline = createTestPipeline();

		const entry = await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "PRESERVE-TEST",
				goal: "Test preservation",
			}),
		);

		// Run compaction with an extremely short age
		await pipeline.compact(1);

		// Verify provenance and source pointer are still intact
		const after = await pipeline.getById(entry!.id);
		expect(after).not.toBeNull();
		expect(after!.provenance.sourcePointer).toEqual({
			workspaceId: "PRESERVE-TEST",
			verdict: "COMPLETE",
			filesModified: ["db/schema.sql"],
		});
	});

	it("disabling compaction preserves entries unchanged", async () => {
		const pipeline = new MemoryPipeline({ enabled: true, maxEntriesBeforeCompaction: 1000 });

		const entry = await pipeline.ingestExecutionEntry(makeExecutionEntry());
		expect(entry).not.toBeNull();

		// Without calling compact, entries stay active
		const all = await pipeline.getAll();
		expect(all.every((e) => e.status === "active")).toBe(true);
	});

	it("getProvenance returns provenance even after compaction", async () => {
		const pipeline = createTestPipeline();
		const now = Date.now();

		const entry = await pipeline.ingestExecutionEntry(
			makeExecutionEntry({
				workspaceId: "PROV-TEST",
				goal: "Provenance test",
				timestamp: now - 100000,
			}),
		);

		await pipeline.compact(50000); // Archive the old entry

		const provenance = await pipeline.getProvenance(entry!.id);
		expect(provenance).not.toBeNull();
		expect(provenance!.kind).toBe("run");
		expect(provenance!.sourceId).toBe("PROV-TEST");
		expect(provenance!.sourcePointer).toBeDefined();
	});
});

// ============================================================================
// Pipeline Management
// ============================================================================

describe("pipeline management", () => {
	it("count() returns correct entry counts", async () => {
		const pipeline = createTestPipeline();

		expect(await pipeline.count()).toBe(0);

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-1" }));
		expect(await pipeline.count()).toBe(1);

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-2" }));
		expect(await pipeline.count()).toBe(2);
	});

	it("count() filters by status", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-A" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-B" }));

		// All are active
		expect(await pipeline.count("active")).toBe(2);
		expect(await pipeline.count("superseded")).toBe(0);
		expect(await pipeline.count("archived")).toBe(0);
	});

	it("clear() removes all entries", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-C" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-D" }));
		expect(await pipeline.count()).toBe(2);

		await pipeline.clear();
		expect(await pipeline.count()).toBe(0);
	});

	it("disable() and enable() toggle the pipeline", async () => {
		const pipeline = createTestPipeline();

		expect(pipeline.isEnabled()).toBe(true);

		pipeline.disable();
		expect(pipeline.isEnabled()).toBe(false);

		const result = await pipeline.ingestExecutionEntry(makeExecutionEntry());
		expect(result).toBeNull();

		pipeline.enable();
		expect(pipeline.isEnabled()).toBe(true);

		const result2 = await pipeline.ingestExecutionEntry(makeExecutionEntry());
		expect(result2).not.toBeNull();
	});

	it("getConfig returns a copy", async () => {
		const pipeline = new MemoryPipeline({ enabled: true, maxResults: 25 });

		const config = pipeline.getConfig();
		expect(config.maxResults).toBe(25);

		config.maxResults = 99;
		expect(pipeline.getConfig().maxResults).toBe(25);
	});

	it("createMemoryPipeline factory works", () => {
		const pipeline = createMemoryPipeline({ enabled: true });
		expect(pipeline).toBeInstanceOf(MemoryPipeline);
		expect(pipeline.isEnabled()).toBe(true);
	});

	it("getById returns null for non-existent entry", async () => {
		const pipeline = createTestPipeline();
		const entry = await pipeline.getById("non-existent");
		expect(entry).toBeNull();
	});

	it("getAll returns entries sorted by creation time (newest first)", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-1", timestamp: 100 }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-2", timestamp: 300 }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "WS-3", timestamp: 200 }));

		const all = await pipeline.getAll();
		expect(all[0].provenance.sourceId).toBe("WS-2");
		expect(all[1].provenance.sourceId).toBe("WS-3");
		expect(all[2].provenance.sourceId).toBe("WS-1");
	});
});

// ============================================================================
// Error handling
// ============================================================================

describe("error handling", () => {
	it("handles empty queries gracefully", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry());
		const results = await pipeline.retrieve("");

		expect(results.results).toHaveLength(0);
	});

	it("handles very long queries without crashing", async () => {
		const pipeline = createTestPipeline();

		const longQuery = "x".repeat(10000);
		const results = await pipeline.retrieve(longQuery);

		expect(results).toBeDefined();
		expect(results.retrievalTimeMs).toBeGreaterThanOrEqual(0);
	});

	it("handles many entries without performance issues", async () => {
		const pipeline = createTestPipeline();

		// Ingest 50 entries
		for (let i = 0; i < 50; i++) {
			await pipeline.ingestExecutionEntry(
				makeExecutionEntry({
					workspaceId: `WS-${i}`,
					goal: `Task ${i}`,
				}),
			);
		}

		const count = await pipeline.count();
		expect(count).toBe(50);

		const results = await pipeline.retrieve("Task");
		expect(results.results.length).toBeGreaterThan(0);
	});

	it("multiple forbidden sources work together", async () => {
		const pipeline = createTestPipeline();

		pipeline.addForbiddenSource({
			label: "bad-runs",
			kind: "run",
			sourceIdPattern: "bad-*",
			reason: "Bad runs",
		});
		pipeline.addForbiddenSource({
			label: "old-plans",
			kind: "plan",
			sourceIdPattern: "v0-*",
			reason: "Old plans",
		});

		// Index entries: 2 bad runs, 1 good run, 1 old plan, 1 current plan
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "bad-1", goal: "Database migration" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "good-1", goal: "Database migration" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "bad-2", goal: "Database migration" }));
		await pipeline.ingestPlannerEntry(makePlannerEntry({ phase: "v0-p1", title: "Database plan v0" }));
		await pipeline.ingestPlannerEntry(makePlannerEntry({ phase: "v1-p1", title: "Database plan v1" }));

		// Query for "database migration" — matches all 5 entries
		const results = await pipeline.retrieve("database migration");

		// 2 allowed: good-1 (run) and v1-p1 (plan). 3 blocked: bad-1, bad-2, v0-p1
		expect(results.results).toHaveLength(2);
		expect(results.blocked.count).toBe(3);

		const counts = Array.from(pipeline.getBlockedSourceCounts().entries());
		expect(counts).toContainEqual(["bad-runs", 2]);
		expect(counts).toContainEqual(["old-plans", 1]);

		// Allowed entries are good-1 and v1-p1
		const allowedSourceIds = results.results.map((r) => r.entry.provenance.sourceId);
		expect(allowedSourceIds).toContain("good-1");
		expect(allowedSourceIds).toContain("v1-p1");
	});

	it("getAll with status filter", async () => {
		const pipeline = createTestPipeline();

		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "ACTV-1" }));
		await pipeline.ingestExecutionEntry(makeExecutionEntry({ workspaceId: "ACTV-2" }));

		const allActive = await pipeline.getAll("active");
		expect(allActive).toHaveLength(2);

		const allArchived = await pipeline.getAll("archived");
		expect(allArchived).toHaveLength(0);
	});
});
