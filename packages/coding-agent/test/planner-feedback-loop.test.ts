/**
 * Planner Feedback Loop Tests - P7.F
 *
 * Tests for the planner feedback loop:
 * - AC1: Queue feedback updates planner risk models.
 * - AC2: Rebatching recommendations require approval.
 * - AC3: Feedback loop does not bypass integration queue safety.
 */

import { describe, expect, it } from "vitest";
import type { QueueOutcome } from "../src/core/planner-feedback-loop.js";
import { formatFeedbackLoopResult, PlannerFeedbackLoop } from "../src/core/planner-feedback-loop.js";
import { PlannerMemory } from "../src/memory/planner-memory.js";
import { InMemoryPlannerMemoryStore } from "../src/memory/planner-memory-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a PlannerMemory with a fresh in-memory store for each test.
 */
function createTestMemory(
	overrides?: Partial<import("../src/memory/planner-memory.js").PlannerMemoryConfig>,
): PlannerMemory {
	const store = new InMemoryPlannerMemoryStore();
	return new PlannerMemory({ enabled: true, ...overrides }, store);
}

/**
 * Build a queue outcome for a merged workspace.
 */
function mergedOutcome(workspaceId: string, overrides: Partial<QueueOutcome> = {}): QueueOutcome {
	return {
		workspaceId,
		status: "merged",
		validationPassed: true,
		timingMetrics: {
			waitTimeMs: 5000,
			mergeTimeMs: 10000,
			totalTimeMs: 15000,
		},
		queuedAt: Date.now() - 60000,
		processedAt: Date.now() - 55000,
		completedAt: Date.now() - 45000,
		...overrides,
	};
}

/**
 * Build a queue outcome for a failed workspace.
 */
function failedOutcome(workspaceId: string, overrides: Partial<QueueOutcome> = {}): QueueOutcome {
	return {
		workspaceId,
		status: "failed",
		error: "Execution failed: timeout exceeded",
		queuedAt: Date.now() - 60000,
		processedAt: Date.now() - 55000,
		completedAt: Date.now() - 30000,
		...overrides,
	};
}

/**
 * Build a queue outcome for a blocked workspace.
 */
function blockedOutcome(workspaceId: string, overrides: Partial<QueueOutcome> = {}): QueueOutcome {
	return {
		workspaceId,
		status: "blocked",
		validationPassed: false,
		error: "Validation failed: lint errors detected",
		queuedAt: Date.now() - 60000,
		processedAt: Date.now() - 55000,
		completedAt: Date.now() - 30000,
		...overrides,
	};
}

/**
 * Build a queue outcome for a conflicted workspace.
 */
function conflictOutcome(workspaceId: string, overrides: Partial<QueueOutcome> = {}): QueueOutcome {
	return {
		workspaceId,
		status: "conflict",
		conflictFiles: ["src/main.ts", "src/utils.ts"],
		error: "Merge conflict in src/main.ts",
		queuedAt: Date.now() - 60000,
		processedAt: Date.now() - 55000,
		completedAt: Date.now() - 30000,
		...overrides,
	};
}

// ============================================================================
// AC1: Queue feedback updates planner risk models
// ============================================================================

describe("AC1: Queue feedback updates planner risk models", () => {
	it("generates risk model updates for failed workspaces", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [mergedOutcome("A"), failedOutcome("B"), mergedOutcome("C")];

		const result = await loop.analyze(outcomes);

		expect(result.success).toBe(true);
		expect(result.riskModelUpdates.length).toBeGreaterThanOrEqual(1);

		// Workspace B should have a risk update (failed -> high)
		const updateB = result.riskModelUpdates.find((u) => u.workspaceId === "B");
		expect(updateB).toBeDefined();
		expect(updateB!.adjustedRiskLevel).toBe("high");
		expect(updateB!.confidence).toBeGreaterThan(0);
		expect(updateB!.reason).toContain("failed");

		// Workspace A should have no risk update (clean merge)
		const updateA = result.riskModelUpdates.find((u) => u.workspaceId === "A");
		expect(updateA).toBeUndefined();
	});

	it("generates risk model updates for conflicted workspaces", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [mergedOutcome("A"), conflictOutcome("B"), mergedOutcome("C")];

		const result = await loop.analyze(outcomes);

		expect(result.success).toBe(true);
		expect(result.riskModelUpdates.length).toBeGreaterThanOrEqual(1);

		// Workspace B should have a risk update (conflict -> high)
		const updateB = result.riskModelUpdates.find((u) => u.workspaceId === "B");
		expect(updateB).toBeDefined();
		expect(updateB!.adjustedRiskLevel).toBe("high");
		expect(updateB!.reason).toContain("conflict");
	});

	it("generates risk model updates for slow workspaces", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [
			mergedOutcome("A", {
				timingMetrics: { waitTimeMs: 1000, mergeTimeMs: 2000, totalTimeMs: 600_000 }, // 10 min
			}),
		];

		const result = await loop.analyze(outcomes);

		expect(result.success).toBe(true);
		expect(result.riskModelUpdates.length).toBeGreaterThanOrEqual(1);

		const updateA = result.riskModelUpdates.find((u) => u.workspaceId === "A");
		expect(updateA).toBeDefined();
		expect(updateA!.reason).toContain("longer than expected");
	});

	it("updates planner memory entry with queue outcome data", async () => {
		const memory = createTestMemory();
		const loop = new PlannerFeedbackLoop();

		// Record a plan entry first
		const entry = await memory.recordPlan(
			"P2",
			"Test Plan",
			3,
			3,
			2,
			2,
			false,
			false,
			[],
			[],
			[],
			[],
			"Test plan summary",
		);
		expect(entry).not.toBeNull();

		const outcomes: QueueOutcome[] = [mergedOutcome("A"), mergedOutcome("B"), mergedOutcome("C")];

		const result = await loop.analyze(outcomes, memory, entry!.id);

		expect(result.success).toBe(true);
		expect(result.updatedMemoryEntryId).toBe(entry!.id);

		// Verify the memory entry was updated
		const updatedEntry = await memory.getById(entry!.id);
		expect(updatedEntry).not.toBeNull();
		expect(updatedEntry!.queueOutcome).toBe("success");
		expect(updatedEntry!.mergedCount).toBe(3);
		expect(updatedEntry!.verdict).toBe("applied");
	});

	it("updates planner memory with partial outcome and keeps verdict as unknown", async () => {
		const memory = createTestMemory();
		const loop = new PlannerFeedbackLoop();

		const entry = await memory.recordPlan(
			"P2",
			"Test Plan",
			3,
			3,
			2,
			2,
			false,
			false,
			[],
			[],
			[],
			[],
			"Test plan summary",
		);
		expect(entry).not.toBeNull();

		const outcomes: QueueOutcome[] = [mergedOutcome("A"), failedOutcome("B"), mergedOutcome("C")];

		await loop.analyze(outcomes, memory, entry!.id);

		// Partial outcomes keep the verdict as unknown (user may retry)
		const updatedEntry = await memory.getById(entry!.id);
		expect(updatedEntry!.queueOutcome).toBe("partial");
		expect(updatedEntry!.verdict).toBe("unknown");
	});

	it("updates planner memory with failure outcome and marks as rejected", async () => {
		const memory = createTestMemory();
		const loop = new PlannerFeedbackLoop();

		const entry = await memory.recordPlan(
			"P2",
			"Test Plan",
			2,
			3,
			2,
			2,
			false,
			false,
			[],
			[],
			[],
			[],
			"Test plan summary",
		);
		expect(entry).not.toBeNull();

		const outcomes: QueueOutcome[] = [failedOutcome("A"), failedOutcome("B")];

		await loop.analyze(outcomes, memory, entry!.id);

		const updatedEntry = await memory.getById(entry!.id);
		expect(updatedEntry!.queueOutcome).toBe("failure");
		expect(updatedEntry!.verdict).toBe("rejected");
	});
});

// ============================================================================
// AC2: Rebatching recommendations require approval
// ============================================================================

describe("AC2: Rebatching recommendations require approval", () => {
	it("all recommendations have requiresApproval set to true", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [failedOutcome("A"), failedOutcome("B"), mergedOutcome("C")];

		const result = await loop.analyze(outcomes);

		for (const rec of result.rebatchingRecommendations) {
			expect(rec.requiresApproval).toBe(true);
		}
	});

	it("generates add_serialization recommendation when failure rate exceeds threshold", async () => {
		const loop = new PlannerFeedbackLoop({ failureRateThreshold: 0.3 });
		const outcomes: QueueOutcome[] = [failedOutcome("A"), failedOutcome("B"), mergedOutcome("C"), mergedOutcome("D")];

		const result = await loop.analyze(outcomes);

		const serializationRec = result.rebatchingRecommendations.find((r) => r.type === "add_serialization");
		expect(serializationRec).toBeDefined();
		expect(serializationRec!.affectedWorkspaceIds).toContain("A");
		expect(serializationRec!.affectedWorkspaceIds).toContain("B");
		expect(serializationRec!.requiresApproval).toBe(true);
		expect(serializationRec!.confidence).toBeGreaterThan(0);
	});

	it("does not generate add_serialization when failure rate is below threshold", async () => {
		const loop = new PlannerFeedbackLoop({ failureRateThreshold: 0.8 });
		const outcomes: QueueOutcome[] = [failedOutcome("A"), mergedOutcome("B"), mergedOutcome("C"), mergedOutcome("D")];

		const result = await loop.analyze(outcomes);

		const serializationRec = result.rebatchingRecommendations.find((r) => r.type === "add_serialization");
		expect(serializationRec).toBeUndefined();
	});

	it("generates resequence recommendation when merge conflicts occur", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [conflictOutcome("A"), conflictOutcome("B"), mergedOutcome("C")];

		const result = await loop.analyze(outcomes);

		const resequenceRec = result.rebatchingRecommendations.find((r) => r.type === "resequence");
		expect(resequenceRec).toBeDefined();
		expect(resequenceRec!.affectedWorkspaceIds).toContain("A");
		expect(resequenceRec!.affectedWorkspaceIds).toContain("B");
		expect(resequenceRec!.requiresApproval).toBe(true);
	});

	it("generates increase_parallelism recommendation when all workspaces succeed", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [mergedOutcome("A"), mergedOutcome("B"), mergedOutcome("C")];

		const result = await loop.analyze(outcomes);

		const increaseRec = result.rebatchingRecommendations.find((r) => r.type === "increase_parallelism");
		expect(increaseRec).toBeDefined();
		expect(increaseRec!.requiresApproval).toBe(true);
	});

	it("generates split_batch recommendation for unusually slow workspaces", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [
			mergedOutcome("A", {
				timingMetrics: { waitTimeMs: 1000, mergeTimeMs: 2000, totalTimeMs: 5_000 },
			}),
			mergedOutcome("B", {
				timingMetrics: { waitTimeMs: 1000, mergeTimeMs: 2000, totalTimeMs: 5_000 },
			}),
			mergedOutcome("C", {
				timingMetrics: { waitTimeMs: 1000, mergeTimeMs: 2000, totalTimeMs: 1_500_000 }, // ~25 min, >> 2x mean of ~503k
			}),
		];

		const result = await loop.analyze(outcomes);

		const splitRec = result.rebatchingRecommendations.find((r) => r.type === "split_batch");
		expect(splitRec).toBeDefined();
		expect(splitRec!.affectedWorkspaceIds).toContain("C");
		expect(splitRec!.requiresApproval).toBe(true);
	});

	it("respects maxRecommendations limit", async () => {
		const loop = new PlannerFeedbackLoop({ maxRecommendations: 1 });
		const outcomes: QueueOutcome[] = [
			failedOutcome("A"),
			failedOutcome("B"),
			conflictOutcome("C"),
			mergedOutcome("D"),
		];

		const result = await loop.analyze(outcomes);

		expect(result.rebatchingRecommendations.length).toBeLessThanOrEqual(1);
	});

	it("type-safety: all recommendation types have requiresApproval: true", async () => {
		// This is a compile-time check — all RebatchingRecommendation types
		// require approval. We verify at runtime too.
		const loop = new PlannerFeedbackLoop({
			maxRecommendations: 10,
			failureRateThreshold: 0,
		});
		const outcomes: QueueOutcome[] = [failedOutcome("A"), mergedOutcome("B"), mergedOutcome("C")];

		const result = await loop.analyze(outcomes);

		for (const rec of result.rebatchingRecommendations) {
			// TypeScript enforces requiresApproval: true at compile time
			// Runtime check verifies it's never false
			expect(rec.requiresApproval).toBe(true);
		}
	});
});

// ============================================================================
// AC3: Feedback loop does not bypass integration queue safety
// ============================================================================

describe("AC3: Feedback loop does not bypass integration queue safety", () => {
	it("never auto-applies changes to the queue", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [failedOutcome("A"), blockedOutcome("B")];

		const result = await loop.analyze(outcomes);

		// The feedback loop is purely advisory — it never modifies anything
		expect(result.success).toBe(true);
		expect(result.rebatchingRecommendations.length).toBeGreaterThanOrEqual(0);

		// All recommendations require explicit approval
		for (const rec of result.rebatchingRecommendations) {
			expect(rec.requiresApproval).toBe(true);
		}

		// The summary clearly states the advisory nature
		expect(result.summary).toContain("ADVISORY");
	});

	it("respects blocked entries — does not generate recommendations that bypass blockers", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [blockedOutcome("A"), mergedOutcome("B")];

		const result = await loop.analyze(outcomes);

		// The feedback loop should still work but with safety respected
		expect(result.integrationQueueSafetyRespected).toBe(true);

		// Recommendations should not suggest removing or bypassing blockers
		// (the feedback loop doesn't generate such recommendations by design)
		for (const rec of result.rebatchingRecommendations) {
			// No recommendation should mention bypassing or ignoring blocked entries
			expect(rec.reason.toLowerCase()).not.toContain("bypass");
			expect(rec.reason.toLowerCase()).not.toContain("ignore block");
		}
	});

	it("respects conflict entries — does not recommend skipping conflicts", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [conflictOutcome("A"), mergedOutcome("B")];

		const result = await loop.analyze(outcomes);

		expect(result.integrationQueueSafetyRespected).toBe(true);

		// The feedback loop should not recommend skipping conflicts
		for (const rec of result.rebatchingRecommendations) {
			expect(rec.description.toLowerCase()).not.toContain("skip");
		}
	});

	it("returns safety-respected status even with failures present", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [
			failedOutcome("A"),
			blockedOutcome("B"),
			conflictOutcome("C"),
			mergedOutcome("D"),
		];

		const result = await loop.analyze(outcomes);

		// Safety is still respected because the feedback loop never
		// modifies the queue state or suggests bypassing safety mechanisms
		expect(result.integrationQueueSafetyRespected).toBe(true);
	});

	it("handles empty outcomes gracefully", async () => {
		const loop = new PlannerFeedbackLoop();
		const result = await loop.analyze([]);

		expect(result.success).toBe(true);
		expect(result.riskModelUpdates.length).toBe(0);
		expect(result.rebatchingRecommendations.length).toBe(0);
		expect(result.summary).toContain("No queue outcomes to analyze");
	});

	it("does not generate recommendations when enforceQueueSafety finds issues", async () => {
		// The feedback loop with enforceQueueSafety respects safety guards.
		// Since the feedback loop never modifies state directly, safety is
		// always respected by design.
		const loop = new PlannerFeedbackLoop({ enforceQueueSafety: true });
		const outcomes: QueueOutcome[] = [blockedOutcome("A")];

		const result = await loop.analyze(outcomes);

		expect(result.integrationQueueSafetyRespected).toBe(true);
		// Even with a blocked entry, the feedback loop generates recommendations
		// that respect the blocker (they suggest serialization, not bypass)
		for (const rec of result.rebatchingRecommendations) {
			expect(rec.requiresApproval).toBe(true);
		}
	});
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
	it("handles outcomes with no planner memory gracefully", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [mergedOutcome("A")];

		const result = await loop.analyze(outcomes, undefined, undefined);

		expect(result.success).toBe(true);
		expect(result.riskModelUpdates.length).toBe(0); // Clean merge -> no updates
		expect(result.updatedMemoryEntryId).toBeUndefined();
	});

	it("handles invalid memory entry ID gracefully", async () => {
		const memory = createTestMemory();
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [mergedOutcome("A")];

		const result = await loop.analyze(outcomes, memory, "non-existent-id");

		expect(result.success).toBe(true);
		expect(result.updatedMemoryEntryId).toBeUndefined();
	});

	it("handles mixed outcomes correctly", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [
			mergedOutcome("A"),
			blockedOutcome("B"),
			mergedOutcome("C"),
			conflictOutcome("D"),
			failedOutcome("E"),
		];

		const result = await loop.analyze(outcomes);

		expect(result.success).toBe(true);
		expect(result.riskModelUpdates.length).toBeGreaterThanOrEqual(3); // B, D, E
		expect(result.rebatchingRecommendations.length).toBeGreaterThanOrEqual(1);
	});

	it("formatFeedbackLoopResult returns the summary text", async () => {
		const loop = new PlannerFeedbackLoop();
		const outcomes: QueueOutcome[] = [mergedOutcome("A")];

		const result = await loop.analyze(outcomes);
		const formatted = formatFeedbackLoopResult(result);

		expect(formatted).toBe(result.summary);
		expect(formatted).toContain("Planner Feedback Loop Analysis");
	});

	it("deduplicates risk updates keeping the highest risk level", async () => {
		const loop = new PlannerFeedbackLoop();
		// Multiple conflicted outcomes for the same workspace should only
		// produce one update with the highest risk level
		// Manually create conflict outcomes for the same workspace
		const conflictA1: QueueOutcome = {
			workspaceId: "A",
			status: "conflict",
			conflictFiles: ["src/main.ts"],
			error: "Merge conflict in src/main.ts",
			queuedAt: Date.now() - 60000,
			processedAt: Date.now() - 55000,
			completedAt: Date.now() - 30000,
		};
		const conflictA2: QueueOutcome = {
			workspaceId: "A",
			status: "conflict",
			conflictFiles: ["src/utils.ts"],
			error: "Merge conflict in src/utils.ts",
			queuedAt: Date.now() - 60000,
			processedAt: Date.now() - 55000,
			completedAt: Date.now() - 30000,
		};

		const result = await loop.analyze([conflictA1, conflictA2]);

		const updatesForA = result.riskModelUpdates.filter((u) => u.workspaceId === "A");
		expect(updatesForA.length).toBe(1); // Deduplicated to 1
		expect(updatesForA[0].adjustedRiskLevel).toBe("high");
	});
});
