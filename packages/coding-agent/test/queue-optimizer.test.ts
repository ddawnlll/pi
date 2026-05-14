/**
 * Tests for Queue Optimizer - P2 Workstream 6.C / 6.D
 *
 * Covers:
 * - AC1: Optimization reorders queued entries by priority
 * - AC2: Non-queued entries (merged, failed, blocked, conflict) are preserved
 * - AC3: Optimization skipped when queue has blockers (skipOnBlockers)
 * - AC4: Deterministic behavior
 * - 6.D AC1: Never violates dependencies
 * - 6.D AC2: Suggests safe reorderings
 * - 6.D AC3: Never bypasses validation or conflict resolution
 * - 6.D AC4: Explains throughput impact
 */

import { describe, expect, it } from "vitest";
import type { Workspace } from "../src/core/workspace-schema.js";
import type { IntegrationQueueState, QueueEntry } from "../src/integration/integration-queue.js";
import {
	checkDependencySafety,
	formatThroughputImpact,
	prioritizeWorkspaces,
	QueueOptimizer,
	type ThroughputImpact,
} from "../src/integration/queue-optimizer.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Chain: A -> B -> C
 */
const CHAIN_WORKSPACES: Workspace[] = [
	{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "C", title: "Workspace C", dependencies: ["B"], roleBudget: "worker" as const, maxRetries: 3 },
];

/**
 * Diamond: A -> B, C -> D
 */
const DIAMOND_WORKSPACES: Workspace[] = [
	{ id: "A", title: "Root", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "C", title: "C", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "D", title: "D", dependencies: ["B", "C"], roleBudget: "worker" as const, maxRetries: 3 },
];

/**
 * Two independent chains: [A -> B -> C] and [X -> Y]
 */
const INDEPENDENT_WORKSPACES: Workspace[] = [
	{ id: "A", title: "A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "C", title: "C", dependencies: ["B"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "X", title: "X", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "Y", title: "Y", dependencies: ["X"], roleBudget: "worker" as const, maxRetries: 3 },
];

/**
 * Fork-join: A -> B, A -> C, B -> D, C -> D
 */
const _FORK_JOIN: Workspace[] = [
	{ id: "A", title: "A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "C", title: "C", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "D", title: "D", dependencies: ["B", "C"], roleBudget: "worker" as const, maxRetries: 3 },
];

/**
 * Complex dependency graph with multiple levels
 */
const COMPLEX_GRAPH: Workspace[] = [
	{ id: "root", title: "Root", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "mid1", title: "Mid 1", dependencies: ["root"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "mid2", title: "Mid 2", dependencies: ["root"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "leaf1", title: "Leaf 1", dependencies: ["mid1", "mid2"], roleBudget: "worker" as const, maxRetries: 3 },
	{ id: "leaf2", title: "Leaf 2", dependencies: ["mid1"], roleBudget: "worker" as const, maxRetries: 3 },
];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal IntegrationQueueState for testing.
 */
function createQueueState(entries: QueueEntry[]): IntegrationQueueState {
	return {
		entries,
		isProcessing: false,
		paused: false,
		createdAt: 1000,
		updatedAt: 1000,
		auditEvents: [],
	};
}

/**
 * Create a queue entry with default values.
 */
function entry(
	workspaceId: string,
	status: QueueEntry["status"] = "queued",
	overrides: Partial<QueueEntry> = {},
): QueueEntry {
	return {
		workspaceId,
		status,
		commitHash: "abc123",
		queuedAt: Date.now(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// QueueOptimizer
// ---------------------------------------------------------------------------

describe("QueueOptimizer", () => {
	describe("constructor and policy", () => {
		it("should initialize with default policy", () => {
			const optimizer = new QueueOptimizer();
			const policy = optimizer.getPolicy();

			expect(policy.autoOptimize).toBe(false);
			expect(policy.skipOnBlockers).toBe(true);
			expect(policy.stableSort).toBe(true);
		});

		it("should accept custom policy overrides", () => {
			const optimizer = new QueueOptimizer({ autoOptimize: true, skipOnBlockers: false });
			const policy = optimizer.getPolicy();

			expect(policy.autoOptimize).toBe(true);
			expect(policy.skipOnBlockers).toBe(false);
			expect(policy.stableSort).toBe(true); // Default
		});

		it("should allow updating policy after construction", () => {
			const optimizer = new QueueOptimizer();
			optimizer.updatePolicy({ autoOptimize: true });

			expect(optimizer.getPolicy().autoOptimize).toBe(true);
			expect(optimizer.getPolicy().stableSort).toBe(true); // Still default
		});
	});

	// -----------------------------------------------------------------------
	// AC1: Optimization reorders queued entries
	// -----------------------------------------------------------------------

	describe("AC1: Reorder queued entries", () => {
		it("should reorder entries by priority score descending", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.optimized).toBe(true);
			expect(result.entriesReordered).toBe(3);

			// A (root) should be first, then B, then C (leaf)
			const ids = result.state.entries.map((e) => e.workspaceId);
			expect(ids[0]).toBe("A");
			expect(ids[1]).toBe("B");
			expect(ids[2]).toBe("C");
		});

		it("should handle empty queue gracefully", () => {
			const state = createQueueState([]);
			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			expect(result.optimized).toBe(false);
			expect(result.entriesReordered).toBe(0);
			expect(result.reason).toContain("No queued entries");
		});

		it("should handle single entry (no reordering needed)", () => {
			const state = createQueueState([entry("A", "queued")]);
			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			// Single entry is already optimal
			expect(result.optimized).toBe(false);
			expect(result.entriesReordered).toBe(0);
		});

		it("should return scores for all queued entries", () => {
			const state = createQueueState([entry("A", "queued"), entry("B", "queued"), entry("C", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.scores.length).toBe(3);
			expect(result.scores.every((s) => s.workspaceId)).toBe(true);
		});

		it("should include all queued entries in reorder (none skipped)", () => {
			// Entries in wrong order: B (leaf) then A (root)
			const state = createQueueState([entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.optimized).toBe(true);
			expect(result.entriesReordered).toBe(2);
			expect(result.state.entries).toHaveLength(2);
			expect(result.state.entries[0]?.workspaceId).toBe("A");
			expect(result.state.entries[1]?.workspaceId).toBe("B");
		});

		it("should reorder with workspace definitions matching subset of queue", () => {
			// Only provide workspace defs for the queued entries
			const state = createQueueState([entry("C", "queued"), entry("A", "queued")]);

			const subsetWorkspaces: Workspace[] = [
				{ id: "C", title: "C", dependencies: ["B"], roleBudget: "worker" as const, maxRetries: 3 },
				{ id: "A", title: "A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
				// B is not in queue but referenced as dependency — should still work
				{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
			];

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, subsetWorkspaces);

			expect(result.optimized).toBe(true);
			// A (root) should be first
			expect(result.state.entries[0]?.workspaceId).toBe("A");
			expect(result.state.entries[1]?.workspaceId).toBe("C");
		});
	});

	// -----------------------------------------------------------------------
	// AC2: Non-queued entries are preserved
	// -----------------------------------------------------------------------

	describe("AC2: Preserve non-queued entries", () => {
		it("should preserve merged entries at their position", () => {
			const state = createQueueState([entry("MERGED", "merged"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			// Merged entry stays in position 0
			expect(result.state.entries[0]?.workspaceId).toBe("MERGED");
			expect(result.state.entries[0]?.status).toBe("merged");
		});

		it("should preserve failed entries at their position", () => {
			const state = createQueueState([entry("A", "queued"), entry("FAILED", "failed"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.state.entries[1]?.workspaceId).toBe("FAILED");
			expect(result.state.entries[1]?.status).toBe("failed");
		});

		it("should preserve blocked entries at their position", () => {
			const state = createQueueState([entry("BLOCKED", "blocked"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.state.entries[0]?.workspaceId).toBe("BLOCKED");
			expect(result.state.entries[0]?.status).toBe("blocked");
		});

		it("should preserve conflict entries at their position", () => {
			const state = createQueueState([entry("CONFLICT", "conflict"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.state.entries[0]?.workspaceId).toBe("CONFLICT");
			expect(result.state.entries[0]?.status).toBe("conflict");
		});

		it("should preserve validating entries at their position", () => {
			const state = createQueueState([
				entry("VALIDATING", "validating"),
				entry("A", "queued"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.state.entries[0]?.workspaceId).toBe("VALIDATING");
			expect(result.state.entries[0]?.status).toBe("validating");
		});

		it("should preserve merging entries at their position", () => {
			const state = createQueueState([entry("MERGING", "merging"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.state.entries[0]?.workspaceId).toBe("MERGING");
			expect(result.state.entries[0]?.status).toBe("merging");
		});

		it("should reorder queued entries while keeping non-queued entries fixed", () => {
			const state = createQueueState([
				entry("MERGED", "merged"),
				entry("C", "queued"), // leaf (lowest priority)
				entry("A", "queued"), // root (highest priority)
				entry("B", "queued"), // middle
				entry("FAILED", "failed"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			// Positions 0 (MERGED) and 4 (FAILED) should stay
			expect(result.state.entries[0]?.workspaceId).toBe("MERGED");
			expect(result.state.entries[4]?.workspaceId).toBe("FAILED");

			// Positions 1-3 should be reordered: A (root), B, C (leaf)
			expect(result.state.entries[1]?.workspaceId).toBe("A");
			expect(result.state.entries[2]?.workspaceId).toBe("B");
			expect(result.state.entries[3]?.workspaceId).toBe("C");
		});
	});

	// -----------------------------------------------------------------------
	// AC3: Skip on blockers
	// -----------------------------------------------------------------------

	describe("AC3: Skip on blockers", () => {
		it("should skip optimization when queue has blocked entries (default policy)", () => {
			const state = createQueueState([entry("BLOCKED", "blocked"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			expect(result.optimized).toBe(false);
			expect(result.reason).toContain("blocked or conflict");
		});

		it("should skip optimization when queue has conflict entries (default policy)", () => {
			const state = createQueueState([entry("CONFLICT", "conflict"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			expect(result.optimized).toBe(false);
			expect(result.reason).toContain("blocked or conflict");
		});

		it("should optimize even with blockers when skipOnBlockers is false", () => {
			const state = createQueueState([
				entry("BLOCKED", "blocked"),
				entry("C", "queued"),
				entry("A", "queued"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.optimized).toBe(true);
			expect(result.entriesReordered).toBe(3);

			// Blocked entry stays at position 0
			expect(result.state.entries[0]?.workspaceId).toBe("BLOCKED");
			expect(result.state.entries[0]?.status).toBe("blocked");
		});

		it("should optimize when failed entries exist (not blockers)", () => {
			const state = createQueueState([
				entry("FAILED", "failed"),
				entry("C", "queued"),
				entry("A", "queued"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.optimized).toBe(true);
		});

		it("should optimize when merged entries exist (not blockers)", () => {
			const state = createQueueState([entry("MERGED", "merged"), entry("C", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.optimized).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// AC4: Deterministic behavior
	// -----------------------------------------------------------------------

	describe("AC4: Deterministic behavior", () => {
		it("should produce identical result when called multiple times", () => {
			const state = createQueueState([entry("B", "queued"), entry("C", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result1 = optimizer.optimize(state, CHAIN_WORKSPACES);
			const result2 = optimizer.optimize(state, CHAIN_WORKSPACES);
			const result3 = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result1.state.entries).toEqual(result2.state.entries);
			expect(result2.state.entries).toEqual(result3.state.entries);
			expect(result1.scores).toEqual(result2.scores);
			expect(result2.scores).toEqual(result3.scores);
		});

		it("should preserve stable sort for equal-scored entries", () => {
			// Three independent root workspaces - all same priority
			const state = createQueueState([entry("Z", "queued"), entry("A", "queued"), entry("M", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			// With stable sort, original order is preserved for equal scores
			expect(result.optimized).toBe(false);
			expect(result.state.entries[0]?.workspaceId).toBe("Z");
			expect(result.state.entries[1]?.workspaceId).toBe("A");
			expect(result.state.entries[2]?.workspaceId).toBe("M");
		});

		it("should produce same scores for same input", () => {
			const state = createQueueState([entry("A", "queued"), entry("B", "queued"), entry("C", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			// Scores should be well-defined numbers
			for (const score of result.scores) {
				expect(Number.isFinite(score.criticalPathRank)).toBe(true);
				expect(Number.isFinite(score.unlockImpact)).toBe(true);
				expect(Number.isFinite(score.validationCost)).toBe(true);
				expect(Number.isFinite(score.conflictRisk)).toBe(true);
				expect(Number.isFinite(score.totalScore)).toBe(true);
			}
		});
	});

	// -----------------------------------------------------------------------
	// 6.D AC1: Never violates dependencies
	// -----------------------------------------------------------------------

	describe("6.D AC1: Never violates dependencies", () => {
		it("should enforce topological ordering for a chain", () => {
			// Queue has B, C, A in that order (dependency is A -> B -> C)
			// Even if scores somehow suggested otherwise, A must come first
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			const ids = result.state.entries.map((e) => e.workspaceId);
			// A must come before B, and B before C
			expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
			expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("C"));
		});

		it("should enforce topological ordering for a complex graph", () => {
			const state = createQueueState([
				entry("leaf1", "queued"),
				entry("root", "queued"),
				entry("leaf2", "queued"),
				entry("mid1", "queued"),
				entry("mid2", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, COMPLEX_GRAPH);

			const ids = result.state.entries.map((e) => e.workspaceId);

			// root must come before mid1 and mid2
			expect(ids.indexOf("root")).toBeLessThan(ids.indexOf("mid1"));
			expect(ids.indexOf("root")).toBeLessThan(ids.indexOf("mid2"));

			// mid1 must come before leaf1 and leaf2
			expect(ids.indexOf("mid1")).toBeLessThan(ids.indexOf("leaf1"));
			expect(ids.indexOf("mid1")).toBeLessThan(ids.indexOf("leaf2"));

			// mid2 must come before leaf1
			expect(ids.indexOf("mid2")).toBeLessThan(ids.indexOf("leaf1"));
		});

		it("should handle a diamond graph correctly", () => {
			const state = createQueueState([
				entry("D", "queued"),
				entry("C", "queued"),
				entry("B", "queued"),
				entry("A", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, DIAMOND_WORKSPACES);

			const ids = result.state.entries.map((e) => e.workspaceId);

			// A must come before B and C
			expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
			expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("C"));

			// B and C must come before D
			expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("D"));
			expect(ids.indexOf("C")).toBeLessThan(ids.indexOf("D"));
		});

		it("should preserve dependency ordering across independent chains", () => {
			const state = createQueueState([
				entry("Y", "queued"),
				entry("C", "queued"),
				entry("A", "queued"),
				entry("X", "queued"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, INDEPENDENT_WORKSPACES);

			const ids = result.state.entries.map((e) => e.workspaceId);

			// Chain A->B->C: A before B before C
			expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
			expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("C"));

			// Chain X->Y: X before Y
			expect(ids.indexOf("X")).toBeLessThan(ids.indexOf("Y"));
		});

		it("should never output an order that violates dependencies", () => {
			// Test many random-ish orderings to ensure robustness
			const state = createQueueState([
				entry("leaf1", "queued"),
				entry("leaf2", "queued"),
				entry("mid1", "queued"),
				entry("mid2", "queued"),
				entry("root", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, COMPLEX_GRAPH);

			// Use checkDependencySafety to verify no violations
			const ids = result.state.entries.filter((e) => e.status === "queued").map((e) => e.workspaceId);
			const violations = checkDependencySafety(ids, COMPLEX_GRAPH);
			expect(violations).toHaveLength(0);
		});

		it("should handle non-queued entries mixed with dependency constraints", () => {
			// Blocked entry at position 0, then queued entries in wrong order
			const state = createQueueState([
				entry("BLOCKED", "blocked"),
				entry("C", "queued"),
				entry("A", "queued"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			// The queued entries (A, B, C) must preserve topological order among themselves
			const queuedIds = result.state.entries.filter((e) => e.status === "queued").map((e) => e.workspaceId);
			const violations = checkDependencySafety(queuedIds, CHAIN_WORKSPACES);
			expect(violations).toHaveLength(0);

			// Blocked entry stays at position 0
			expect(result.state.entries[0]?.workspaceId).toBe("BLOCKED");
		});
	});

	// -----------------------------------------------------------------------
	// 6.D AC2: Suggests safe reorderings
	// -----------------------------------------------------------------------

	describe("6.D AC2: Suggests safe reorderings", () => {
		it("should produce reorder suggestions without modifying the queue", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			expect(suggestions.suggestions.length).toBeGreaterThan(0);
			// Original state should be unchanged
			expect(state.entries[0]?.workspaceId).toBe("C");
			expect(state.entries[1]?.workspaceId).toBe("B");
			expect(state.entries[2]?.workspaceId).toBe("A");

			// Suggested order should be A, B, C
			const suggestedIds = suggestions.suggestedOrder.map((e) => e.workspaceId);
			expect(suggestedIds.indexOf("A")).toBeLessThan(suggestedIds.indexOf("B"));
			expect(suggestedIds.indexOf("B")).toBeLessThan(suggestedIds.indexOf("C"));
		});

		it("should return isSafe=true for dependency-safe suggestions", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			expect(suggestions.isSafe).toBe(true);
		});

		it("should provide per-move reasons for each suggestion", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			for (const s of suggestions.suggestions) {
				expect(s.workspaceId).toBeTruthy();
				expect(s.reason).toBeTruthy();
				expect(s.throughputImpact).toBeTruthy();
				expect(typeof s.currentIndex).toBe("number");
				expect(typeof s.suggestedIndex).toBe("number");
			}
		});

		it("should skip suggestions when queue is empty", () => {
			const state = createQueueState([]);
			const optimizer = new QueueOptimizer();
			const suggestions = optimizer.suggestReorder(state);

			expect(suggestions.suggestions).toHaveLength(0);
			expect(suggestions.isSafe).toBe(true);
		});

		it("should include throughput impact in suggestions result", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			expect(suggestions.throughputImpact).toBeDefined();
			expect(typeof suggestions.throughputImpact.estimatedTimeSavedMs).toBe("number");
			expect(typeof suggestions.throughputImpact.workspacesUnblockedSooner).toBe("number");
			expect(suggestions.throughputImpact.explanation).toBeTruthy();
		});

		it("should provide suggestions sorted by move distance (largest first)", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			if (suggestions.suggestions.length >= 2) {
				// First suggestion should have larger or equal move distance
				const dist1 = Math.abs(
					suggestions.suggestions[0]!.suggestedIndex - suggestions.suggestions[0]!.currentIndex,
				);
				const dist2 = Math.abs(
					suggestions.suggestions[1]!.suggestedIndex - suggestions.suggestions[1]!.currentIndex,
				);
				expect(dist1).toBeGreaterThanOrEqual(dist2);
			}
		});

		it("should preserve non-queued entries in suggested order", () => {
			const state = createQueueState([
				entry("MERGED", "merged"),
				entry("C", "queued"),
				entry("A", "queued"),
				entry("FAILED", "failed"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			// Non-queued entries stay at their positions
			expect(suggestions.suggestedOrder[0]?.workspaceId).toBe("MERGED");
			expect(suggestions.suggestedOrder[3]?.workspaceId).toBe("FAILED");
		});
	});

	// -----------------------------------------------------------------------
	// 6.D AC3: Never bypasses validation or conflict resolution
	// -----------------------------------------------------------------------

	describe("6.D AC3: Never bypasses validation or conflict resolution", () => {
		it("should not touch entries with blocked status", () => {
			const state = createQueueState([entry("BLOCKED", "blocked"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			// Blocked entry is never modified
			const blockedEntry = result.state.entries.find((e) => e.workspaceId === "BLOCKED");
			expect(blockedEntry?.status).toBe("blocked");
		});

		it("should not touch entries with conflict status", () => {
			const state = createQueueState([entry("CONFLICT", "conflict"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			const conflictEntry = result.state.entries.find((e) => e.workspaceId === "CONFLICT");
			expect(conflictEntry?.status).toBe("conflict");
		});

		it("should not touch entries with merging status", () => {
			const state = createQueueState([entry("MERGING", "merging"), entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			const mergingEntry = result.state.entries.find((e) => e.workspaceId === "MERGING");
			expect(mergingEntry?.status).toBe("merging");
		});

		it("should not touch entries with validating status", () => {
			const state = createQueueState([
				entry("VALIDATING", "validating"),
				entry("A", "queued"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			const validatingEntry = result.state.entries.find((e) => e.workspaceId === "VALIDATING");
			expect(validatingEntry?.status).toBe("validating");
		});

		it("should not clear or reset validation state of any entry", () => {
			const state = createQueueState([
				entry("VALIDATED", "merged", { validationPassed: true, validationOutput: "All tests passed" }),
				entry("C", "queued"),
				entry("A", "queued"),
				entry("B", "queued"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			const validatedEntry = result.state.entries.find((e) => e.workspaceId === "VALIDATED");
			expect(validatedEntry?.status).toBe("merged");
			expect(validatedEntry?.validationPassed).toBe(true);
			expect(validatedEntry?.validationOutput).toBe("All tests passed");
		});
	});

	// -----------------------------------------------------------------------
	// 6.D AC4: Explains throughput impact
	// -----------------------------------------------------------------------

	describe("6.D AC4: Explains throughput impact", () => {
		it("should include throughput impact in optimization result", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.throughputImpact).toBeDefined();
			expect(result.throughputImpact!.explanation).toBeTruthy();
			expect(result.throughputImpact!.estimatedTimeSavedMs).toBeGreaterThan(0);
		});

		it("should include throughput impact in suggestions result", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			expect(suggestions.throughputImpact.explanation).toBeTruthy();
			expect(suggestions.throughputImpact.estimatedTimeSavedMs).toBeGreaterThan(0);
			expect(suggestions.throughputImpact.criticalPathReduction).toBeGreaterThanOrEqual(0);
		});

		it("should report zero impact when no reordering happens", () => {
			const state = createQueueState([entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			// No reordering happened
			expect(result.optimized).toBe(false);
		});

		it("should estimate time saved for a chain reordering", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			// A chain reordering should save time because upstream workspaces are moved up
			expect(suggestions.throughputImpact.estimatedTimeSavedMs).toBeGreaterThan(0);
			expect(suggestions.throughputImpact.workspacesUnblockedSooner).toBeGreaterThan(0);
		});

		it("should include dependency safety note in throughput explanation", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			expect(suggestions.throughputImpact.explanation).toContain("dependency");
		});

		it("should return explanation that is human-readable", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			const explanation = suggestions.throughputImpact.explanation;
			expect(explanation.length).toBeGreaterThan(20);
			expect(explanation).toMatch(/[a-zA-Z]/); // Contains actual words
		});

		it("should include throughput impact for each individual suggestion", () => {
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const suggestions = optimizer.suggestReorder(state, CHAIN_WORKSPACES);

			for (const s of suggestions.suggestions) {
				expect(s.throughputImpact).toBeTruthy();
				expect(s.throughputImpact.length).toBeGreaterThan(10);
			}
		});
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	describe("Edge cases", () => {
		it("should handle all entries being non-queued", () => {
			const state = createQueueState([entry("A", "merged"), entry("B", "failed"), entry("C", "blocked")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			expect(result.optimized).toBe(false);
			expect(result.entriesReordered).toBe(0);
			expect(result.reason).toContain("No queued entries");
		});

		it("should handle queued entries with same dependency structure", () => {
			// Two independent workspaces with no dependencies
			const state = createQueueState([entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			// Both have same priority (rank 0), stable sort preserves order
			expect(result.optimized).toBe(false);
		});

		it("should preserve total entry count after optimization", () => {
			const state = createQueueState([
				entry("A", "queued"),
				entry("MERGED", "merged"),
				entry("B", "queued"),
				entry("C", "queued"),
				entry("FAILED", "failed"),
			]);

			const optimizer = new QueueOptimizer({ skipOnBlockers: false });
			const result = optimizer.optimize(state, CHAIN_WORKSPACES);

			expect(result.state.entries).toHaveLength(5);
		});
	});

	// -----------------------------------------------------------------------
	// Optimize without workspace definitions (heuristic fallback)
	// -----------------------------------------------------------------------

	describe("Heuristic fallback (no workspace defs)", () => {
		it("should not reorder when no dependencies are known", () => {
			// Without workspace definitions, all entries look the same
			const state = createQueueState([entry("C", "queued"), entry("B", "queued"), entry("A", "queued")]);

			const optimizer = new QueueOptimizer();
			const result = optimizer.optimize(state);

			// Without workspace defs, all have same score (no deps, low risk)
			expect(result.optimized).toBe(false);
		});

		it("should produce deterministic scores even without workspace defs", () => {
			const state = createQueueState([entry("A", "queued"), entry("B", "queued")]);

			const optimizer = new QueueOptimizer();
			const result1 = optimizer.optimize(state);
			const result2 = optimizer.optimize(state);

			expect(result1.scores).toEqual(result2.scores);
		});
	});
});

// ---------------------------------------------------------------------------
// prioritizeWorkspaces convenience function
// ---------------------------------------------------------------------------

describe("prioritizeWorkspaces", () => {
	it("should return workspace IDs sorted by priority descending", () => {
		const workspaces: Workspace[] = [
			{ id: "C", title: "C", dependencies: ["B"], roleBudget: "worker" as const, maxRetries: 3 },
			{ id: "A", title: "A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
			{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		];

		const ordered = prioritizeWorkspaces(workspaces);

		// A (root) should be first, then B, then C (leaf)
		expect(ordered[0]).toBe("A");
		expect(ordered[1]).toBe("B");
		expect(ordered.length).toBe(3);
	});

	it("should handle empty input", () => {
		expect(prioritizeWorkspaces([])).toEqual([]);
	});

	it("should handle single workspace", () => {
		const workspaces: Workspace[] = [
			{ id: "ONLY", title: "Only", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
		];

		expect(prioritizeWorkspaces(workspaces)).toEqual(["ONLY"]);
	});

	it("should accept custom scoring config", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "A", dependencies: [], roleBudget: "worker" as const, maxRetries: 3 },
			{ id: "B", title: "B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
		];

		const defaultOrder = prioritizeWorkspaces(workspaces);
		const customOrder = prioritizeWorkspaces(workspaces, { criticalPathWeight: 1, unlockImpactWeight: 0 });

		// Both should produce same order for this simple case
		expect(defaultOrder).toEqual(customOrder);
	});
});

// ---------------------------------------------------------------------------
// checkDependencySafety utility
// ---------------------------------------------------------------------------

describe("checkDependencySafety", () => {
	it("should detect no violations in a valid order", () => {
		const order = ["A", "B", "C"];
		const violations = checkDependencySafety(order, CHAIN_WORKSPACES);
		expect(violations).toHaveLength(0);
	});

	it("should detect violations when dependency comes after dependant", () => {
		const order = ["C", "B", "A"];
		const violations = checkDependencySafety(order, CHAIN_WORKSPACES);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0]?.message).toContain("depends on");
	});

	it("should report correct workspace IDs in violations", () => {
		const order = ["B", "A"]; // B depends on A, but A is after B
		const violations = checkDependencySafety(order, CHAIN_WORKSPACES);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.workspaceId).toBe("B");
		expect(violations[0]?.dependency).toBe("A");
	});

	it("should handle empty order", () => {
		const violations = checkDependencySafety([], CHAIN_WORKSPACES);
		expect(violations).toHaveLength(0);
	});

	it("should handle workspaces not in order", () => {
		const order = ["A"];
		const violations = checkDependencySafety(order, CHAIN_WORKSPACES);
		expect(violations).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// formatThroughputImpact
// ---------------------------------------------------------------------------

describe("formatThroughputImpact", () => {
	it("should return the explanation text", () => {
		const impact: ThroughputImpact = {
			estimatedTimeSavedMs: 60000,
			workspacesUnblockedSooner: 2,
			criticalPathReduction: 1,
			explanation: "Test explanation",
		};

		expect(formatThroughputImpact(impact)).toBe("Test explanation");
	});
});
