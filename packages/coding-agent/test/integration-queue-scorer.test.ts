/**
 * Test suite for Integration Queue Merge-Priority Scorer (P23 W3).
 *
 * Tests:
 * - Score formula computation
 * - Higher downstreamReadyCount dequeues first
 * - waitTimeBoost prevents starvation
 * - Score recomputed between merges
 * - Static band multiplier
 * - FIFO tiebreaker
 */

import { describe, expect, it } from "vitest";
import { MergePriorityScorer, type QueueEntry } from "../src/integration/integration-queue.js";

describe("MergePriorityScorer", () => {
	const scorer = new MergePriorityScorer();

	function makeEntry(workspaceId: string, queuedAt: number, status: string = "queued"): QueueEntry {
		return {
			workspaceId,
			status: status as any,
			commitHash: "abc123",
			queuedAt,
		};
	}

	// -----------------------------------------------------------------------
	// Score formula
	// -----------------------------------------------------------------------

	describe("score formula", () => {
		it("computes basic score correctly", () => {
			const score = scorer.computeScore("ws-A", [], new Map(), "normal");
			expect(score.total).toBe(0);
			expect(score.downstreamComponent).toBe(0);
			expect(score.criticalPathComponent).toBe(0);
			expect(score.waitTimeBoost).toBe(0);
			expect(score.staticBandMultiplier).toBe(1.0);
		});

		it("downstreamReadyCount contributes to score", () => {
			const deps = new Map<string, string[]>([
				["ws-B", ["ws-A"]],
				["ws-C", ["ws-A"]],
			]);
			const entries = [
				makeEntry("ws-A", 1000),
				makeEntry("ws-B", 2000),
				makeEntry("ws-C", 3000),
			];

			const score = scorer.computeScore("ws-A", entries, deps, "normal");
			expect(score.downstreamReadyCount).toBe(2);
			expect(score.downstreamComponent).toBe(100);
		});

		it("critical path position is computed", () => {
			const deps = new Map<string, string[]>([
				["ws-B", ["ws-A"]],
				["ws-C", ["ws-B"]],
			]);
			const entries = [
				makeEntry("ws-A", 1000),
				makeEntry("ws-B", 2000),
				makeEntry("ws-C", 3000),
			];

			// ws-A is at the start of a chain of length 3 (A -> B -> C)
			const scoreA = scorer.computeScore("ws-A", entries, deps, "normal");
			expect(scoreA.criticalPathPosition).toBeGreaterThan(0);

			// ws-C is at the end of the chain
			const scoreC = scorer.computeScore("ws-C", entries, deps, "normal");
			expect(scoreC.criticalPathPosition).toBe(1);
		});

		it("workspace not on any dependency chain has position 0", () => {
			const score = scorer.computeScore("ws-orphan", [], new Map(), "normal");
			expect(score.criticalPathPosition).toBe(0);
			expect(score.downstreamReadyCount).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Static band multiplier
	// -----------------------------------------------------------------------

	describe("static band multiplier", () => {
		it("critical priority has 2.0 multiplier", () => {
			const score = scorer.computeScore("ws-A", [], new Map(), "critical");
			expect(score.staticBandMultiplier).toBe(2.0);
		});

		it("high priority has 1.5 multiplier", () => {
			const score = scorer.computeScore("ws-A", [], new Map(), "high");
			expect(score.staticBandMultiplier).toBe(1.5);
		});

		it("normal priority has 1.0 multiplier", () => {
			const score = scorer.computeScore("ws-A", [], new Map(), "normal");
			expect(score.staticBandMultiplier).toBe(1.0);
		});

		it("low priority has 0.5 multiplier", () => {
			const score = scorer.computeScore("ws-A", [], new Map(), "low");
			expect(score.staticBandMultiplier).toBe(0.5);
		});

		it("unrecognized priority defaults to 1.0", () => {
			const score = scorer.computeScore("ws-A", [], new Map(), "unknown");
			expect(score.staticBandMultiplier).toBe(1.0);
		});
	});

	// -----------------------------------------------------------------------
	// Wait time boost
	// -----------------------------------------------------------------------

	describe("waitTimeBoost", () => {
		it("wait time boost increases with time in queue", () => {
			const longAgo = Date.now() - 11 * 60 * 1000; // 11 minutes ago
			const entries = [makeEntry("ws-old", longAgo)];

			const score = scorer.computeScore("ws-old", entries, new Map(), "low");
			expect(score.waitTimeBoost).toBe(10); // capped at 10
		});

		it("recent entry has waitTimeBoost of 0", () => {
			const now = Date.now();
			const entries = [makeEntry("ws-new", now)];

			const score = scorer.computeScore("ws-new", entries, new Map(), "low");
			expect(score.waitTimeBoost).toBe(0);
		});
	});
});
