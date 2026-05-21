/**
 * Memory Correction API — P14.F tests.
 *
 * Covers the acceptance criteria:
 * - Create, read, update, delete operations
 * - Query with filters, sorting, pagination
 * - Stats computation
 * - Reject action
 * - Supersede action
 * - Activate action
 * - Deactivate action
 * - Restore action
 * - Correction audit trail
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MemoryCorrectionApi } from "../../../src/brain/memory/api.js";
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
 * Create a minimal valid memory record input for the API.
 */
function makeInput(
	type: MemoryRecord["type"],
	title: string,
	content: string,
	overrides: Partial<Record<string, unknown>> = {},
): Parameters<MemoryCorrectionApi["createMemory"]>[0] {
	return {
		type,
		title,
		content,
		provenance: createDefaultProvenance(),
		tags: ["test", type],
		confidence: 0.8,
		...overrides,
	};
}

describe("MemoryCorrectionApi", () => {
	async function createApi(): Promise<MemoryCorrectionApi> {
		const tmpDir = await mkdtemp(join(tmpdir(), "memory-api-test-"));
		const store = new MemoryStore({ basePath: join(tmpDir, "brain", "memory") });
		await store.initialize();
		return new MemoryCorrectionApi(store);
	}

	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	test("createMemory creates a valid record", async () => {
		const api = await createApi();
		const memory = await api.createMemory(makeInput("decision_memory", "Test Decision", "This is a test decision"));

		expect(memory.id).toBeTruthy();
		expect(memory.type).toBe("decision_memory");
		expect(memory.title).toBe("Test Decision");
		expect(memory.content).toBe("This is a test decision");
		expect(memory.lifecycle).toBe("candidate");
		expect(memory.confidence).toBe(0.8);
		expect(memory.provenance.sourceRefs).toHaveLength(1);
		expect(memory.tags).toContain("decision_memory");
	});

	test("createMemory rejects invalid input", async () => {
		const api = await createApi();

		await expect(api.createMemory({} as unknown as Parameters<typeof api.createMemory>[0])).rejects.toThrow(
			"Invalid memory record",
		);
	});

	test("getMemory returns null for non-existent", async () => {
		const api = await createApi();
		const result = await api.getMemory("non-existent-id");
		expect(result).toBeNull();
	});

	test("getMemory returns created record", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("plan_memory", "Test Plan", "Plan content"));

		const fetched = await api.getMemory(created.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.id).toBe(created.id);
		expect(fetched!.title).toBe("Test Plan");
	});

	test("updateMemory modifies record fields", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("failure_memory", "Original Title", "Original content"));

		const updated = await api.updateMemory(created.id, {
			title: "Updated Title",
			confidence: 0.9,
		});

		expect(updated.title).toBe("Updated Title");
		expect(updated.confidence).toBe(0.9);
		expect(updated.content).toBe("Original content"); // unchanged
		expect(updated.updatedAt).not.toBe(created.updatedAt);
	});

	test("updateMemory throws for non-existent", async () => {
		const api = await createApi();
		await expect(api.updateMemory("no-such-id", { title: "x" })).rejects.toThrow("not found");
	});

	test("deleteMemory removes record", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("idea_memory", "Delete me", "Gone"));

		await api.deleteMemory(created.id);
		const fetched = await api.getMemory(created.id);
		expect(fetched).toBeNull();
	});

	test("deleteMemory throws for non-existent", async () => {
		const api = await createApi();
		await expect(api.deleteMemory("no-such-id")).rejects.toThrow("not found");
	});

	// -----------------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------------

	test("listMemories returns all records with total", async () => {
		const api = await createApi();
		await api.createMemory(makeInput("decision_memory", "D1", "Content 1"));
		await api.createMemory(makeInput("plan_memory", "P1", "Content 2"));
		await api.createMemory(makeInput("plan_memory", "P2", "Content 3"));

		const result = await api.listMemories();
		expect(result.memories).toHaveLength(3);
		expect(result.total).toBe(3);
	});

	test("listMemories filters by type", async () => {
		const api = await createApi();
		await api.createMemory(makeInput("decision_memory", "D1", "Content 1"));
		await api.createMemory(makeInput("plan_memory", "P1", "Content 2"));

		const result = await api.listMemories({ types: ["decision_memory"] });
		expect(result.memories).toHaveLength(1);
		expect(result.memories[0].type).toBe("decision_memory");
		expect(result.total).toBe(1);
	});

	test("listMemories filters by lifecycle", async () => {
		const api = await createApi();
		await api.createMemory(makeInput("idea_memory", "Idea", "Idea content"));

		const result = await api.listMemories({ lifecycle: ["active"] });
		expect(result.memories).toHaveLength(0);
		expect(result.total).toBe(0);
	});

	test("listMemories filters by tags", async () => {
		const api = await createApi();
		await api.createMemory(
			makeInput("decision_memory", "Tagged", "Tagged content", { tags: ["important", "urgent"] }),
		);

		const result = await api.listMemories({ tags: ["important"] });
		expect(result.memories).toHaveLength(1);
	});

	test("listMemories paginates correctly", async () => {
		const api = await createApi();
		for (let i = 0; i < 10; i++) {
			await api.createMemory(makeInput("idea_memory", `Idea ${i}`, `Content ${i}`));
		}

		const page1 = await api.listMemories({ limit: 3, offset: 0 });
		expect(page1.memories).toHaveLength(3);
		expect(page1.total).toBe(10);

		const page2 = await api.listMemories({ limit: 3, offset: 3 });
		expect(page2.memories).toHaveLength(3);
	});

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	test("getMemoryStats returns aggregate data", async () => {
		const api = await createApi();
		await api.createMemory(makeInput("decision_memory", "D1", "Content 1"));
		await api.createMemory(makeInput("plan_memory", "P1", "Content 2"));

		const stats = await api.getMemoryStats();
		expect(stats.totalMemories).toBe(2);
		expect(stats.byType.decision_memory).toBe(1);
		expect(stats.byType.plan_memory).toBe(1);
		expect(stats.avgConfidence).toBe(0.8);
	});

	// -----------------------------------------------------------------------
	// Correction Actions
	// -----------------------------------------------------------------------

	test("rejectMemory marks record as rejected_by_user", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("decision_memory", "Reject me", "Bad decision"));

		const rejected = await api.rejectMemory(created.id, "Incorrect analysis");

		expect(rejected.lifecycle).toBe("rejected_by_user");
		expect(rejected.id).toBe(created.id);
	});

	test("rejectMemory creates correction record", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("decision_memory", "Reject me", "Bad"));

		await api.rejectMemory(created.id, "Wrong", "user123");

		const records = api.getCorrectionRecords();
		expect(records).toHaveLength(1);
		expect(records[0].originalMemoryId).toBe(created.id);
		expect(records[0].action).toBe("rejected");
		expect(records[0].createdBy).toBe("user123");
		expect(records[0].reason).toBe("Wrong");
	});

	test("rejectMemory throws for non-existent", async () => {
		const api = await createApi();
		await expect(api.rejectMemory("no-such-id")).rejects.toThrow("not found");
	});

	test("supersedeMemory creates replacement and marks original as superseded", async () => {
		const api = await createApi();
		const original = await api.createMemory(makeInput("decision_memory", "Old Decision", "Old content"));

		const replacement = createMemoryRecord({
			type: "decision_memory",
			title: "Corrected Decision",
			content: "Corrected content",
			provenance: createDefaultProvenance(),
		});

		const result = await api.supersedeMemory(
			original.id,
			{
				type: replacement.type,
				title: replacement.title,
				content: replacement.content,
				provenance: replacement.provenance,
			},
			"Updated with new info",
			"admin",
		);

		expect(result.original.lifecycle).toBe("superseded");
		expect(result.original.supersededBy).toBe(result.replacement.id);
		expect(result.replacement.lifecycle).toBe("candidate");
		expect(result.replacement.title).toBe("Corrected Decision");

		// Correction audit trail
		const records = api.getCorrectionRecords();
		expect(records).toHaveLength(1);
		expect(records[0].originalMemoryId).toBe(original.id);
		expect(records[0].correctedMemoryId).toBe(result.replacement.id);
		expect(records[0].action).toBe("superseded");
		expect(records[0].createdBy).toBe("admin");
	});

	test("supersedeMemory throws for non-existent original", async () => {
		const api = await createApi();
		await expect(
			api.supersedeMemory("no-such-id", {
				type: "decision_memory",
				title: "Replacement",
				content: "Content",
				provenance: createDefaultProvenance(),
			}),
		).rejects.toThrow("not found");
	});

	test("activateMemory promotes candidate to active", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("decision_memory", "Activate me", "Ready", { confidence: 0.9 }));

		const activated = await api.activateMemory(created.id, "High confidence");
		expect(activated.lifecycle).toBe("active");
		expect(activated.expiresAt).toBeTruthy(); // TTL was set
	});

	test("activateMemory routes low-confidence to needs_review", async () => {
		const api = await createApi();
		const created = await api.createMemory(
			makeInput("decision_memory", "Low conf", "Uncertain", { confidence: 0.3 }),
		);

		const result = await api.activateMemory(created.id);
		expect(result.lifecycle).toBe("needs_review");
	});

	test("deactivateMemory moves active back to candidate", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("decision_memory", "Deactivate me", "Old", { confidence: 0.9 }));
		const activated = await api.activateMemory(created.id);

		expect(activated.lifecycle).toBe("active");

		const deactivated = await api.deactivateMemory(created.id, "Needs revision");
		expect(deactivated.lifecycle).toBe("candidate");
	});

	test("restoreMemory moves rejected/expired back to candidate", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("decision_memory", "Restore me", "Good after all"));
		const rejected = await api.rejectMemory(created.id, "Was wrong initially");

		expect(rejected.lifecycle).toBe("rejected_by_user");

		const restored = await api.restoreMemory(created.id, "Re-evaluated and found correct");
		expect(restored.lifecycle).toBe("candidate");
	});

	// -----------------------------------------------------------------------
	// Edge Cases
	// -----------------------------------------------------------------------

	test("getCorrectionRecords returns empty array initially", async () => {
		const api = await createApi();
		const records = api.getCorrectionRecords();
		expect(records).toEqual([]);
	});

	test("listMemories with invalid query throws", async () => {
		const api = await createApi();
		await expect(api.listMemories({ types: ["invalid_type"] as any })).rejects.toThrow("Invalid query");
	});

	test("onTransition callback fires on lifecycle changes", async () => {
		const api = await createApi();
		const created = await api.createMemory(makeInput("idea_memory", "Transition test", "Watch me"));

		const transitions: Array<{ fromState: string; toState: string }> = [];
		api.onTransition((t) => {
			transitions.push({ fromState: t.fromState, toState: t.toState });
		});

		await api.activateMemory(created.id, "Test activation");

		expect(transitions).toHaveLength(1);
		expect(transitions[0].fromState).toBe("candidate");
		expect(transitions[0].toState).toBe("active");
	});
});
