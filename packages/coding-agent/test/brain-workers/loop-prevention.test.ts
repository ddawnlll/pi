/**
 * Worker Loop Prevention — 25.R
 *
 * Covers:
 * - LoopPreventionEngine configuration
 * - Content-based loop detection
 * - Cycle-based loop detection
 * - Stall detection
 * - Recursion depth tracking
 * - Combined checkForLoop
 * - Edge cases (empty history, disabled detection, similarity matching)
 * - Evidence-backed diagnostics on loop detection
 * - Budget/cooldown integration
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import {
	type CycleSignature,
	DEFAULT_LOOP_PREVENTION_CONFIG,
	LoopPreventionEngine,
} from "../../src/brain-workers/runtime/loop-prevention.js";

// =============================================================================
// Helpers
// =============================================================================

/** Create a standard cycle signature for testing. */
function makeSignature(
	overrides: Partial<CycleSignature> & { content: string },
): Omit<CycleSignature, "contentHash"> & { contentHash?: string } {
	return {
		timestamp: new Date().toISOString(),
		outcome: "completed",
		producedEvidence: true,
		context: {},
		...overrides,
	};
}

/** Create a set of consecutive identical signatures to simulate a loop. */
function makeIdenticalCycles(
	count: number,
	content: string,
	outcome: string = "completed",
): Omit<CycleSignature, "contentHash">[] {
	const now = Date.now();
	return Array.from({ length: count }, (_, i) => ({
		timestamp: new Date(now - i * 10_000).toISOString(), // 10s apart
		content,
		outcome,
		producedEvidence: i === 0, // Only the first one produced evidence
		context: {},
	}));
}

/** Create a set of cycles with no evidence for stall detection. */
function makeStalledCycles(count: number, content: string): Omit<CycleSignature, "contentHash">[] {
	const now = Date.now();
	return Array.from({ length: count }, (_, i) => ({
		timestamp: new Date(now - i * 10_000).toISOString(),
		content: `${content}-v${i}`,
		outcome: i % 2 === 0 ? "completed" : "partial",
		producedEvidence: false,
		context: {},
	}));
}

/** Create cycles with varying outcomes for cycle loop detection. */
function makeOutcomeCycles(count: number, outcome: string): Omit<CycleSignature, "contentHash">[] {
	const now = Date.now();
	return Array.from({ length: count }, (_, i) => ({
		timestamp: new Date(now - i * 10_000).toISOString(),
		content: `task-v${i}`,
		outcome,
		producedEvidence: true,
		context: {},
	}));
}

// =============================================================================
// Default Config
// =============================================================================

describe("LoopPreventionEngine defaults", () => {
	test("creates with default configuration", () => {
		const engine = new LoopPreventionEngine();
		const config = engine.getConfig();
		expect(config.enabled).toBe(true);
		expect(config.maxConsecutiveIdenticalCycles).toBe(5);
		expect(config.maxConsecutiveStalledCycles).toBe(8);
		expect(config.maxRecursionDepth).toBe(3);
		expect(config.dedupWindowMs).toBe(300_000);
		expect(config.enableSimilarityMatching).toBe(true);
		expect(config.similarityThreshold).toBe(0.85);
		expect(config.autoStopOnLoop).toBe(true);
	});

	test("accepts partial config overrides", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3, maxRecursionDepth: 5 });
		const config = engine.getConfig();
		expect(config.maxConsecutiveIdenticalCycles).toBe(3);
		expect(config.maxRecursionDepth).toBe(5);
		expect(config.maxConsecutiveStalledCycles).toBe(DEFAULT_LOOP_PREVENTION_CONFIG.maxConsecutiveStalledCycles);
	});

	test("setConfig updates only provided fields", () => {
		const engine = new LoopPreventionEngine();
		engine.setConfig({ enabled: false });
		const config = engine.getConfig();
		expect(config.enabled).toBe(false);
		expect(config.maxConsecutiveIdenticalCycles).toBe(DEFAULT_LOOP_PREVENTION_CONFIG.maxConsecutiveIdenticalCycles);
	});
});

// =============================================================================
// Cycle Recording
// =============================================================================

describe("Cycle recording", () => {
	test("records a cycle signature", () => {
		const engine = new LoopPreventionEngine();
		engine.recordCycle("worker-1", makeSignature({ content: "analyze queue depth" }));
		const history = engine.getCycleHistory("worker-1");
		expect(history.length).toBe(1);
		expect(history[0].content).toBe("analyze queue depth");
		expect(history[0].contentHash).toBeTruthy();
	});

	test("records multiple cycles and returns most recent first", () => {
		const engine = new LoopPreventionEngine();
		engine.recordCycle("worker-1", makeSignature({ content: "first" }));
		engine.recordCycle("worker-1", makeSignature({ content: "second" }));
		const history = engine.getCycleHistory("worker-1");
		expect(history.length).toBe(2);
		expect(history[0].content).toBe("second");
		expect(history[1].content).toBe("first");
	});

	test("limits history to MAX_CYCLE_HISTORY entries", () => {
		const engine = new LoopPreventionEngine();
		// Insert 51 entries (MAX is 50)
		for (let i = 0; i < 51; i++) {
			engine.recordCycle("worker-1", makeSignature({ content: `entry-${i}` }));
		}
		const history = engine.getCycleHistory("worker-1");
		expect(history.length).toBeLessThanOrEqual(50);
	});

	test("returns empty history for unknown worker", () => {
		const engine = new LoopPreventionEngine();
		expect(engine.getCycleHistory("unknown")).toEqual([]);
	});

	test("clearHistory removes all data for a worker", () => {
		const engine = new LoopPreventionEngine();
		engine.recordCycle("worker-1", makeSignature({ content: "test" }));
		engine.recordStallEvidence("worker-1", "no output");
		engine.clearHistory("worker-1");
		expect(engine.getCycleHistory("worker-1")).toEqual([]);
		expect(engine.getStallEvidence("worker-1")).toEqual([]);
	});

	test("stall evidence recording and retrieval", () => {
		const engine = new LoopPreventionEngine();
		engine.recordStallEvidence("worker-1", "no new observations");
		engine.recordStallEvidence("worker-1", "duplicate queue state");
		const evidence = engine.getStallEvidence("worker-1");
		expect(evidence.length).toBe(2);
		expect(evidence[0]).toBe("duplicate queue state");
	});
});

// =============================================================================
// Content Loop Detection
// =============================================================================

describe("Content loop detection", () => {
	test("detects content loop when consecutive identical content exceeds threshold", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeIdenticalCycles(3, "analyze the same queue state");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkContentLoop("worker-1", "analyze the same queue state");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("content_loop");
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic?.stopCondition).toBe("dag_validation_failed");
	});

	test("does not detect content loop when below threshold", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 5 });
		const cycles = makeIdenticalCycles(3, "analyze the same queue state"); // Only 3, threshold is 5
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkContentLoop("worker-1", "analyze the same queue state");
		expect(result.detected).toBe(false);
	});

	test("does not detect content loop when content changes between cycles", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const now = Date.now();
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 20_000).toISOString(),
			content: "task A",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 10_000).toISOString(),
			content: "task B", // Different content
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});
		const result = engine.checkContentLoop("worker-1", "task C"); // Also different
		expect(result.detected).toBe(false);
	});

	test("returns no detection when engine is disabled", () => {
		const engine = new LoopPreventionEngine({ enabled: false });
		const cycles = makeIdenticalCycles(10, "repeated task");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkContentLoop("worker-1", "repeated task");
		expect(result.detected).toBe(false);
	});

	test("returns no detection with insufficient history", () => {
		const engine = new LoopPreventionEngine();
		// No cycles recorded
		const result = engine.checkContentLoop("worker-1", "some task");
		expect(result.detected).toBe(false);
		expect(result.message).toContain("Insufficient history");
	});
});

// =============================================================================
// Similarity Matching
// =============================================================================

describe("Similarity matching (fuzzy dedup)", () => {
	test("detects content loop with similar but not identical content", () => {
		const engine = new LoopPreventionEngine({
			maxConsecutiveIdenticalCycles: 3,
			enableSimilarityMatching: true,
			similarityThreshold: 0.5,
		});
		const now = Date.now();

		// Record cycles with very similar content
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 30_000).toISOString(),
			content: "analyze the queue depth and report",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 20_000).toISOString(),
			content: "analyze the queue depth and report findings",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 10_000).toISOString(),
			content: "analyze the queue depth and report",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});

		const result = engine.checkContentLoop("worker-1", "analyze the queue depth and report results");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("content_loop");
	});

	test("does not detect loop with dissimilar content", () => {
		const engine = new LoopPreventionEngine({
			maxConsecutiveIdenticalCycles: 3,
			enableSimilarityMatching: true,
			similarityThreshold: 0.9,
		});
		const now = Date.now();

		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 20_000).toISOString(),
			content: "analyze queue depth",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 10_000).toISOString(),
			content: "analyze queue depth",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});

		const result = engine.checkContentLoop("worker-1", "fix syntax error in source file");
		expect(result.detected).toBe(false);
	});
});

// =============================================================================
// Cycle Loop Detection
// =============================================================================

describe("Cycle loop detection", () => {
	test("detects cycle loop when consecutive identical outcomes exceed threshold", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeOutcomeCycles(3, "analysis_complete_no_change");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkCycleLoop("worker-1");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("cycle_loop");
		expect(result.diagnostic).toBeDefined();
	});

	test("does not detect cycle loop when outcomes vary", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const now = Date.now();
		// Different outcomes
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 30_000).toISOString(),
			content: "task-1",
			outcome: "found_changes",
			producedEvidence: true,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 20_000).toISOString(),
			content: "task-2",
			outcome: "no_changes",
			producedEvidence: true,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 10_000).toISOString(),
			content: "task-3",
			outcome: "found_changes",
			producedEvidence: true,
			context: {},
		});
		const result = engine.checkCycleLoop("worker-1");
		expect(result.detected).toBe(false);
	});

	test("detects cycle loop with more than threshold identical outcomes", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeOutcomeCycles(5, "error_retry");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkCycleLoop("worker-1");
		expect(result.detected).toBe(true);
	});
});

// =============================================================================
// Stall Detection
// =============================================================================

describe("Stall detection", () => {
	test("detects stall when consecutive cycles produce no evidence", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveStalledCycles: 3 });
		const cycles = makeStalledCycles(3, "stalled task");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkStall("worker-1");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("stall");
		expect(result.diagnostic).toBeDefined();
	});

	test("does not detect stall when evidence is produced", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveStalledCycles: 3 });
		const now = Date.now();

		// Two stalled, one with evidence
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 30_000).toISOString(),
			content: "task-1",
			outcome: "completed",
			producedEvidence: true, // This one produced evidence
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 20_000).toISOString(),
			content: "task-2",
			outcome: "completed",
			producedEvidence: false,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 10_000).toISOString(),
			content: "task-3",
			outcome: "completed",
			producedEvidence: false,
			context: {},
		});

		const result = engine.checkStall("worker-1");
		// Stalled count is 2 (tasks 2 and 3), threshold is 3
		expect(result.detected).toBe(false);
	});

	test("stall detection with evidence logging", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveStalledCycles: 2 });
		const cycles = makeStalledCycles(2, "stalled task");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		engine.recordStallEvidence("worker-1", "no new observations produced");
		const result = engine.checkStall("worker-1");
		expect(result.detected).toBe(true);
	});
});

// =============================================================================
// Combined checkForLoop
// =============================================================================

describe("checkForLoop combined detection", () => {
	test("detects content loop via checkForLoop", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeIdenticalCycles(3, "repeated analysis task");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkForLoop("worker-1", "repeated analysis task");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("content_loop");
	});

	test("detects cycle loop via checkForLoop", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeOutcomeCycles(3, "same_outcome_every_time");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkForLoop("worker-1");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("cycle_loop");
	});

	test("detects stall via checkForLoop", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveStalledCycles: 3 });
		const cycles = makeStalledCycles(3, "stalled");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkForLoop("worker-1");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("stall");
	});

	test("returns no detection when all checks pass", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 5, maxConsecutiveStalledCycles: 8 });
		const now = Date.now();

		// Mix of different tasks with different outcomes, producing evidence
		for (let i = 0; i < 3; i++) {
			engine.recordCycle("worker-1", {
				timestamp: new Date(now - i * 10_000).toISOString(),
				content: `different-task-${i}`,
				outcome: `outcome-${i}`,
				producedEvidence: true,
				context: {},
			});
		}

		const result = engine.checkForLoop("worker-1");
		expect(result.detected).toBe(false);
	});
});

// =============================================================================
// Recursion Depth Tracking
// =============================================================================

describe("Recursion depth tracking", () => {
	test("initial recursion depth is 0", () => {
		const engine = new LoopPreventionEngine();
		expect(engine.getRecursionDepth("worker-1")).toBe(0);
	});

	test("pushRecursionFrame increases depth", () => {
		const engine = new LoopPreventionEngine();
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-2",
			role: "observer",
			timestamp: new Date().toISOString(),
			reason: "Delegating observation task",
		});
		expect(engine.getRecursionDepth("worker-1")).toBe(1);
	});

	test("popRecursionFrame decreases depth", () => {
		const engine = new LoopPreventionEngine();
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-2",
			role: "observer",
			timestamp: new Date().toISOString(),
			reason: "Delegating observation task",
		});
		engine.popRecursionFrame("worker-1");
		expect(engine.getRecursionDepth("worker-1")).toBe(0);
	});

	test("popRecursionFrame on empty stack does not throw", () => {
		const engine = new LoopPreventionEngine();
		expect(() => engine.popRecursionFrame("worker-1")).not.toThrow();
	});

	test("throws when recursion depth exceeds maxRecursionDepth", () => {
		const engine = new LoopPreventionEngine({ maxRecursionDepth: 2 });
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-2",
			role: "observer",
			timestamp: new Date().toISOString(),
			reason: "Frame 1",
		});
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-3",
			role: "analyst",
			timestamp: new Date().toISOString(),
			reason: "Frame 2",
		});
		expect(() =>
			engine.pushRecursionFrame("worker-1", {
				workerId: "worker-4",
				role: "proposer",
				timestamp: new Date().toISOString(),
				reason: "Frame 3 – exceeds max depth",
			}),
		).toThrow("Recursion depth exceeded");
	});

	test("checkRecursionDepth returns detection when depth exceeded", () => {
		const engine = new LoopPreventionEngine({ maxRecursionDepth: 1 });
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-2",
			role: "observer",
			timestamp: new Date().toISOString(),
			reason: "Frame 1",
		});
		const result = engine.checkRecursionDepth("worker-1");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("recursion_exceeded");
	});

	test("checkRecursionDepth returns no detection when depth OK", () => {
		const engine = new LoopPreventionEngine({ maxRecursionDepth: 3 });
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-2",
			role: "observer",
			timestamp: new Date().toISOString(),
			reason: "Frame 1",
		});
		const result = engine.checkRecursionDepth("worker-1");
		expect(result.detected).toBe(false);
	});

	test("getRecursionStack returns frames in order", () => {
		const engine = new LoopPreventionEngine();
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-2",
			role: "observer",
			timestamp: "2026-01-01T00:00:00Z",
			reason: "First",
		});
		engine.pushRecursionFrame("worker-1", {
			workerId: "worker-3",
			role: "analyst",
			timestamp: "2026-01-01T00:01:00Z",
			reason: "Second",
		});
		const stack = engine.getRecursionStack("worker-1");
		expect(stack.length).toBe(2);
		expect(stack[0].workerId).toBe("worker-2");
		expect(stack[1].workerId).toBe("worker-3");
	});

	test("getRecursionStack returns empty for unknown worker", () => {
		const engine = new LoopPreventionEngine();
		expect(engine.getRecursionStack("unknown")).toEqual([]);
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge cases", () => {
	test("checkContentLoop with empty content produces hash", () => {
		const engine = new LoopPreventionEngine();
		engine.recordCycle("worker-1", makeSignature({ content: "" }));
		const history = engine.getCycleHistory("worker-1");
		expect(history[0].contentHash).toBeTruthy();
		expect(history[0].contentHash).toHaveLength(64); // SHA-256 hex length
	});

	test("checkContentLoop with zero maxConsecutiveIdenticalCycles is detected", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 0 });
		const cycles = makeIdenticalCycles(3, "repeated task");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		// 0 threshold means zero tolerance — any identical cycle is a loop
		const result = engine.checkContentLoop("worker-1", "repeated task");
		expect(result.detected).toBe(true);
		expect(result.condition).toBe("content_loop");
	});

	test("multiple workers have independent histories", () => {
		const engine = new LoopPreventionEngine();
		engine.recordCycle("worker-1", makeSignature({ content: "worker-1 task" }));
		engine.recordCycle("worker-2", makeSignature({ content: "worker-2 task" }));
		expect(engine.getCycleHistory("worker-1").length).toBe(1);
		expect(engine.getCycleHistory("worker-2").length).toBe(1);
	});

	test("dedup window boundaries — old entries outside window are ignored", () => {
		const engine = new LoopPreventionEngine({
			maxConsecutiveIdenticalCycles: 2,
			dedupWindowMs: 5_000, // 5 second window
		});
		const farPast = Date.now() - 60_000; // 60 seconds ago — well outside window

		// Old entry outside window
		engine.recordCycle("worker-1", {
			timestamp: new Date(farPast).toISOString(),
			content: "same task",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});

		// Recent entry inside window
		engine.recordCycle("worker-1", {
			timestamp: new Date().toISOString(),
			content: "same task",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});

		// Only one match within window, threshold is 2, so no detection
		const result = engine.checkContentLoop("worker-1", "same task");
		expect(result.detected).toBe(false);
	});

	test("similarity matching with disabled config falls back to exact match only", () => {
		const engine = new LoopPreventionEngine({
			maxConsecutiveIdenticalCycles: 3,
			enableSimilarityMatching: false,
		});

		const now = Date.now();
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 20_000).toISOString(),
			content: "analyze queue depth",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});
		engine.recordCycle("worker-1", {
			timestamp: new Date(now - 10_000).toISOString(),
			content: "analyze queue depth",
			outcome: "completed",
			producedEvidence: true,
			context: {},
		});

		// Similar but not identical content — should NOT match without similarity
		const result = engine.checkContentLoop("worker-1", "analyze queue depth please");
		expect(result.detected).toBe(false);
	});

	test("autoStopOnLoop flag does not affect detection", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3, autoStopOnLoop: false });
		const cycles = makeIdenticalCycles(3, "repeated task");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkContentLoop("worker-1", "repeated task");
		expect(result.detected).toBe(true);
	});

	test("diagnostic contains evidence references", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeIdenticalCycles(3, "repeated task");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkContentLoop("worker-1", "repeated task");
		expect(result.diagnostic).toBeDefined();
		expect(result.diagnostic!.evidenceRefs).toContain("cycle:worker-1");
		expect(result.diagnostic!.stopCondition).toBe("dag_validation_failed");
	});
});

// =============================================================================
// Integration: Diagnostics on Loop Detection
// =============================================================================

describe("Evidence-backed diagnostics", () => {
	test("content loop diagnostic includes context and evidence refs", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeIdenticalCycles(3, "loop content");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkContentLoop("worker-1", "loop content");
		expect(result.detected).toBe(true);
		expect(result.diagnostic!.context).toBeDefined();
		expect(result.diagnostic!.context.consecutiveCount).toBe(3);
		expect(result.diagnostic!.context.maxConsecutiveIdenticalCycles).toBe(3);
		expect(result.diagnostic!.evidenceRefs.length).toBeGreaterThan(0);
	});

	test("cycle loop diagnostic includes outcome in context", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveIdenticalCycles: 3 });
		const cycles = makeOutcomeCycles(3, "stuck_outcome");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		const result = engine.checkCycleLoop("worker-1");
		expect(result.detected).toBe(true);
		expect(result.diagnostic!.context.outcome).toBe("stuck_outcome");
	});

	test("stall diagnostic includes stall evidence", () => {
		const engine = new LoopPreventionEngine({ maxConsecutiveStalledCycles: 2 });
		const cycles = makeStalledCycles(2, "stalled");
		for (const cycle of cycles) {
			engine.recordCycle("worker-1", cycle);
		}
		engine.recordStallEvidence("worker-1", "no new evidence for 2 cycles");
		const result = engine.checkStall("worker-1");
		expect(result.detected).toBe(true);
		expect(result.diagnostic!.context.stallEvidence).toBeDefined();
	});
});
