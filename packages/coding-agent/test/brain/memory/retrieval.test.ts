/**
 * Memory Retrieval V2 — V5.03 tests.
 *
 * Covers the acceptance criteria:
 * AC1: A retry-hotspot query retrieves relevant failure_memory records with source refs.
 * AC2: Rejected/superseded memories cannot silently influence planning context.
 * AC3: Retrieval output is stable enough to display in a UI report.
 * AC4: The retrieval layer never writes memory by itself.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { MemoryRetrievalV2 } from "../../../src/brain/memory/retrieval.js";
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

function createProvenanceWithSource(sourcePath: string): MemoryProvenance {
	return {
		sourceRefs: [
			{
				type: "observation",
				path: sourcePath,
				id: `obs-${sourcePath.replace(/[^a-zA-Z0-9]/g, "-")}`,
				timestamp: "2026-05-21T00:00:00.000Z",
			},
		],
		validatedBy: "system",
	};
}

// ---------------------------------------------------------------------------
// Test Environment
// ---------------------------------------------------------------------------

interface TestContext {
	store: MemoryStore;
	retrieval: MemoryRetrievalV2;
	tmpDir: string;
}

async function createTestContext(): Promise<TestContext> {
	const tmpDir = await mkdtemp(join(tmpdir(), "memory-retrieval-test-"));
	const store = new MemoryStore({ basePath: join(tmpDir, "brain", "memory") });
	await store.initialize();
	const retrieval = new MemoryRetrievalV2(store);
	return { store, retrieval, tmpDir };
}

describe("MemoryRetrievalV2", () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestContext();
	});

	// -------------------------------------------------------------------
	// AC1: Retry-hotspot query retrieves relevant failure_memory with source refs
	// -------------------------------------------------------------------

	test("AC1: queryByRetryHotspot retrieves failure_memory records with source refs", async () => {
		const { store, retrieval } = ctx;

		// Create failure memory records
		const failure1 = createMemoryRecord({
			type: "failure_memory",
			title: "Docker build failure",
			content: "Build failed due to missing dependency in workspace ws-docker-1",
			provenance: createProvenanceWithSource("workspaces/ws-docker-1/execution.log"),
			tags: ["docker", "ws-docker-1", "build-failure"],
			confidence: 0.85,
			lifecycle: "active",
		});
		await store.create(failure1);

		const failure2 = createMemoryRecord({
			type: "failure_memory",
			title: "Network timeout in API calls",
			content: "API requests timing out in ws-api-2 after 30s",
			provenance: createProvenanceWithSource("workspaces/ws-api-2/execution.log"),
			tags: ["network", "ws-api-2", "timeout"],
			confidence: 0.75,
			lifecycle: "active",
		});
		await store.create(failure2);

		// Query by workspace ID
		const result = await retrieval.queryByRetryHotspot({
			workspaceId: "ws-docker-1",
		});

		expect(result.success).toBe(true);
		expect(result.report).toBeDefined();
		expect(result.report!.entries.length).toBeGreaterThanOrEqual(1);

		const entry = result.report!.entries[0];
		expect(entry.type).toBe("failure_memory");
		expect(entry.title).toBe("Docker build failure");
		expect(entry.sourceRefs.length).toBeGreaterThanOrEqual(1);
		expect(entry.sourceRefs[0].path).toContain("ws-docker-1");
	});

	test("AC1: queryByRetryHotspot matches by error text", async () => {
		const { store, retrieval } = ctx;

		const failure1 = createMemoryRecord({
			type: "failure_memory",
			title: "Docker build failure",
			content: "Build failed due to missing dependency in workspace ws-docker-1",
			provenance: createDefaultProvenance(),
			tags: ["docker", "build-failure"],
			confidence: 0.85,
			lifecycle: "active",
		});
		await store.create(failure1);

		const failure2 = createMemoryRecord({
			type: "failure_memory",
			title: "Network timeout in API calls",
			content: "API requests timing out after 30s",
			provenance: createDefaultProvenance(),
			tags: ["network", "timeout"],
			confidence: 0.75,
			lifecycle: "active",
		});
		await store.create(failure2);

		// Query by error text
		const result = await retrieval.queryByRetryHotspot({
			errorText: "missing dependency",
		});

		expect(result.success).toBe(true);
		expect(result.report).toBeDefined();
		expect(result.report!.entries.length).toBe(1);
		expect(result.report!.entries[0].title).toBe("Docker build failure");
	});

	test("AC1: queryByRetryHotspot returns empty for no matches", async () => {
		const { store, retrieval } = ctx;

		const failure = createMemoryRecord({
			type: "failure_memory",
			title: "Docker build failure",
			content: "Build failed issue",
			provenance: createDefaultProvenance(),
			tags: ["docker"],
			confidence: 0.85,
			lifecycle: "active",
		});
		await store.create(failure);

		const result = await retrieval.queryByRetryHotspot({
			workspaceId: "non-existent-workspace",
		});

		expect(result.success).toBe(true);
		expect(result.report).toBeDefined();
		expect(result.report!.entries.length).toBe(0);
		expect(result.report!.total).toBe(0);
	});

	// -------------------------------------------------------------------
	// AC2: Rejected/superseded memories cannot silently influence planning context
	// -------------------------------------------------------------------

	test("AC2: rejected failure_memories are excluded from results", async () => {
		const { store, retrieval } = ctx;

		const activeFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Active failure",
			content: "This is an active failure memory",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.8,
			lifecycle: "active",
		});
		await store.create(activeFailure);

		const rejectedFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Rejected failure",
			content: "This was rejected and should not appear",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.9,
			lifecycle: "rejected_by_user",
		});
		await store.create(rejectedFailure);

		const result = await retrieval.queryByRetryHotspot({});

		expect(result.success).toBe(true);
		expect(result.report).toBeDefined();
		expect(result.report!.entries.length).toBe(1);
		expect(result.report!.entries[0].title).toBe("Active failure");
		expect(result.report!.filteredByLifecycle).toBe(1);
	});

	test("AC2: superseded failure_memories are excluded from results", async () => {
		const { store, retrieval } = ctx;

		const activeFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Active failure",
			content: "This is an active failure memory",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.8,
			lifecycle: "active",
		});
		await store.create(activeFailure);

		const supersededFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Superseded failure",
			content: "This was superseded and should not appear",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.9,
			lifecycle: "superseded",
			supersededBy: "replacement-id",
		});
		await store.create(supersededFailure);

		const result = await retrieval.queryByRetryHotspot({});

		expect(result.success).toBe(true);
		expect(result.report!.entries.length).toBe(1);
		expect(result.report!.entries[0].title).toBe("Active failure");
		expect(result.report!.filteredByLifecycle).toBe(1);
	});

	test("AC2: expired failure_memories are excluded from results", async () => {
		const { store, retrieval } = ctx;

		const activeFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Active failure",
			content: "This is an active failure memory",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.8,
			lifecycle: "active",
		});
		await store.create(activeFailure);

		const expiredFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Expired failure",
			content: "This expired and should not appear",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.9,
			lifecycle: "expired",
		});
		await store.create(expiredFailure);

		const result = await retrieval.queryByRetryHotspot({});

		expect(result.success).toBe(true);
		expect(result.report!.entries.length).toBe(1);
		expect(result.report!.entries[0].title).toBe("Active failure");
		expect(result.report!.filteredByLifecycle).toBe(1);
	});

	test("AC2: disputed failure_memories are excluded from results", async () => {
		const { store, retrieval } = ctx;

		const activeFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Active failure",
			content: "This is an active failure memory",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.8,
			lifecycle: "active",
		});
		await store.create(activeFailure);

		const disputedFailure = createMemoryRecord({
			type: "failure_memory",
			title: "Disputed failure",
			content: "This is disputed and should not appear",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.9,
			lifecycle: "disputed",
		});
		await store.create(disputedFailure);

		const result = await retrieval.queryByRetryHotspot({});

		expect(result.success).toBe(true);
		expect(result.report!.entries.length).toBe(1);
		expect(result.report!.entries[0].title).toBe("Active failure");
		expect(result.report!.filteredByLifecycle).toBe(1);
	});

	test("AC2: all rejected/superseded/expired/disputed states are excluded at once", async () => {
		const { store, retrieval } = ctx;

		// Create one record in each lifecycle state
		const lifecycles: Array<{ lifecycle: string; title: string }> = [
			{ lifecycle: "active", title: "Active memory" },
			{ lifecycle: "candidate", title: "Candidate memory" },
			{ lifecycle: "needs_review", title: "Needs review memory" },
			{ lifecycle: "rejected_by_user", title: "Rejected memory" },
			{ lifecycle: "superseded", title: "Superseded memory" },
			{ lifecycle: "expired", title: "Expired memory" },
			{ lifecycle: "disputed", title: "Disputed memory" },
		];

		for (const lc of lifecycles) {
			const record = createMemoryRecord({
				type: "failure_memory",
				title: lc.title,
				content: `Failure memory in state ${lc.lifecycle}`,
				provenance: createDefaultProvenance(),
				tags: ["test"],
				confidence: 0.8,
				lifecycle: lc.lifecycle as MemoryRecord["lifecycle"],
			});
			await store.create(record);
		}

		const result = await retrieval.queryByRetryHotspot({});

		expect(result.success).toBe(true);
		expect(result.report).toBeDefined();

		// Only active, candidate, and needs_review should appear
		expect(result.report!.entries.length).toBe(3);
		expect(result.report!.filteredByLifecycle).toBe(4);

		const titles = result.report!.entries.map((e) => e.title);
		expect(titles).toContain("Active memory");
		expect(titles).toContain("Candidate memory");
		expect(titles).toContain("Needs review memory");
		expect(titles).not.toContain("Rejected memory");
		expect(titles).not.toContain("Superseded memory");
		expect(titles).not.toContain("Expired memory");
		expect(titles).not.toContain("Disputed memory");

		// Verify breakdown
		expect(result.report!.filteredByLifecycleBreakdown).toHaveProperty("rejected_by_user");
		expect(result.report!.filteredByLifecycleBreakdown).toHaveProperty("superseded");
		expect(result.report!.filteredByLifecycleBreakdown).toHaveProperty("expired");
		expect(result.report!.filteredByLifecycleBreakdown).toHaveProperty("disputed");
	});

	// -------------------------------------------------------------------
	// AC3: Retrieval output is stable enough to display in a UI report
	// -------------------------------------------------------------------

	test("AC3: retrieval report has stable, serialisable structure", async () => {
		const { store, retrieval } = ctx;

		const failure = createMemoryRecord({
			type: "failure_memory",
			title: "UI Test failure",
			content: "This failure is for UI display testing",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.85,
			lifecycle: "active",
		});
		await store.create(failure);

		const result = await retrieval.queryByRetryHotspot({ workspaceId: "test" });

		expect(result.success).toBe(true);
		const report = result.report!;

		// Report must be JSON-serialisable (no undefined values, no functions)
		const serialised = JSON.stringify(report);
		const parsed = JSON.parse(serialised);

		expect(parsed).toHaveProperty("query");
		expect(parsed).toHaveProperty("total");
		expect(parsed).toHaveProperty("entries");
		expect(parsed).toHaveProperty("filteredByLifecycle");
		expect(parsed).toHaveProperty("filteredByLifecycleBreakdown");
		expect(parsed).toHaveProperty("summary");
		expect(parsed).toHaveProperty("generatedAt");

		// Each entry must be serialisable
		const entry = parsed.entries[0];
		expect(entry).toHaveProperty("id");
		expect(entry).toHaveProperty("type");
		expect(entry).toHaveProperty("title");
		expect(entry).toHaveProperty("summary");
		expect(entry).toHaveProperty("content");
		expect(entry).toHaveProperty("lifecycle");
		expect(entry).toHaveProperty("confidence");
		expect(entry).toHaveProperty("sourceRefs");
		expect(entry).toHaveProperty("createdAt");
		expect(entry).toHaveProperty("updatedAt");
		expect(entry).toHaveProperty("tags");

		// Source refs must be included
		expect(Array.isArray(entry.sourceRefs)).toBe(true);
		expect(entry.sourceRefs.length).toBeGreaterThanOrEqual(1);
	});

	test("AC3: summary is human-readable", async () => {
		const { store, retrieval } = ctx;

		const failure = createMemoryRecord({
			type: "failure_memory",
			title: "Summary test failure",
			content: "Testing summary generation",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.85,
			lifecycle: "active",
		});
		await store.create(failure);

		const result = await retrieval.queryByRetryHotspot({ workspaceId: "test-workspace" });

		expect(result.success).toBe(true);
		expect(result.report!.summary).toBeTruthy();
		expect(typeof result.report!.summary).toBe("string");
		expect(result.report!.summary.length).toBeGreaterThan(10);
	});

	test("AC3: listFailureMemories returns stable output", async () => {
		const { store, retrieval } = ctx;

		// Create multiple failure memories
		for (let i = 0; i < 5; i++) {
			const failure = createMemoryRecord({
				type: "failure_memory",
				title: `Failure ${i}`,
				content: `Content for failure ${i}`,
				provenance: createDefaultProvenance(),
				tags: ["test"],
				confidence: 0.5 + i * 0.1,
				lifecycle: "active",
			});
			await store.create(failure);
		}

		const result = await retrieval.listFailureMemories(3, 0);

		expect(result.success).toBe(true);
		expect(result.report).toBeDefined();
		expect(result.report!.entries.length).toBeLessThanOrEqual(3);
		expect(result.report!.total).toBe(5);

		// Entries should be sorted by confidence descending
		for (let i = 1; i < result.report!.entries.length; i++) {
			expect(result.report!.entries[i - 1].confidence).toBeGreaterThanOrEqual(result.report!.entries[i].confidence);
		}
	});

	// -------------------------------------------------------------------
	// AC4: The retrieval layer never writes memory by itself
	// -------------------------------------------------------------------

	test("AC4: retrieval never calls store mutation methods", async () => {
		const { store, retrieval } = ctx;

		// Store should have no records initially
		const initialStats = await store.getStats();
		expect(initialStats.totalMemories).toBe(0);

		// Perform read operations
		const result = await retrieval.queryByRetryHotspot({ workspaceId: "does-not-exist" });
		expect(result.success).toBe(true);
		expect(result.report!.entries.length).toBe(0);

		// Verify no records were created
		const statsAfter = await store.getStats();
		expect(statsAfter.totalMemories).toBe(0);

		// Verify no files were written to disk
		const { readdir } = await import("node:fs/promises");
		const memoryDir = join(ctx.tmpDir, "brain", "memory");
		let memoryFiles: string[];
		try {
			memoryFiles = await readdir(memoryDir);
		} catch {
			memoryFiles = [];
		}
		// Only index.json might exist (auto-created by store init), no record files
		const recordFiles = memoryFiles.filter((f) => f.endsWith(".json") && f !== "index.json");
		expect(recordFiles.length).toBe(0);
	});

	test("AC4: MemoryRetrievalV2 only exposes read methods", () => {
		// Verify that the class has no write-like methods
		const proto = Object.getOwnPropertyNames(MemoryRetrievalV2.prototype);
		const writeLikeMethods = proto.filter(
			(name) =>
				name !== "constructor" &&
				typeof (MemoryRetrievalV2.prototype as unknown as Record<string, unknown>)[name] === "function" &&
				!name.startsWith("_") &&
				!name.startsWith("to") &&
				!name.startsWith("build") &&
				!name.startsWith("compute") &&
				!name.startsWith("validate") &&
				!name.startsWith("apply") &&
				name !== "queryByRetryHotspot" &&
				name !== "listFailureMemories" &&
				name !== "queryMemories",
		);

		// There should be no write-like public methods
		expect(writeLikeMethods).toEqual([]);
	});

	// -------------------------------------------------------------------
	// Additional: queryMemories generic method
	// -------------------------------------------------------------------

	test("queryMemories filters by lifecycle state", async () => {
		const { store, retrieval } = ctx;

		const decisionActive = createMemoryRecord({
			type: "decision_memory",
			title: "Active decision",
			content: "This decision is active",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.8,
			lifecycle: "active",
		});
		await store.create(decisionActive);

		const decisionRejected = createMemoryRecord({
			type: "decision_memory",
			title: "Rejected decision",
			content: "This was rejected",
			provenance: createDefaultProvenance(),
			tags: ["test"],
			confidence: 0.9,
			lifecycle: "rejected_by_user",
		});
		await store.create(decisionRejected);

		const result = await retrieval.queryMemories({ types: ["decision_memory"] });

		expect(result.success).toBe(true);
		expect(result.report!.entries.length).toBe(1);
		expect(result.report!.entries[0].title).toBe("Active decision");
	});

	test("queryMemories supports search text", async () => {
		const { store, retrieval } = ctx;

		const failure = createMemoryRecord({
			type: "failure_memory",
			title: "Docker failure",
			content: "The Docker daemon failed to start",
			provenance: createDefaultProvenance(),
			tags: ["docker"],
			confidence: 0.8,
			lifecycle: "active",
		});
		await store.create(failure);

		const result = await retrieval.queryMemories({ searchText: "Docker" });

		expect(result.success).toBe(true);
		expect(result.report!.entries.length).toBe(1);
		expect(result.report!.entries[0].title).toBe("Docker failure");
	});

	// -------------------------------------------------------------------
	// Error handling
	// -------------------------------------------------------------------

	test("queryByRetryHotspot rejects invalid limit", async () => {
		const result = await ctx.retrieval.queryByRetryHotspot({
			limit: 999,
		});

		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
	});

	test("queryByRetryHotspot rejects invalid offset", async () => {
		const result = await ctx.retrieval.queryByRetryHotspot({
			offset: -1,
		});

		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
	});
});
