import { describe, expect, it } from "vitest";
import { evaluateGovernor, type GovernorInput } from "../../src/core/assembly/adaptive-concurrency-governor.js";

// =============================================================================
// Helpers
// =============================================================================

function greenInput(overrides?: Partial<GovernorInput>): GovernorInput {
	return {
		resources: { cpuUsage: 0.2, memoryUsage: 0.3, cpuPressure: false, memoryPressure: false },
		rateLimit: { tokensRemaining: 100, limited: false, provider: "openai" },
		queues: {
			eventJournalDepth: 2,
			accpCompilerDepth: 1,
			artifactAcceptanceDepth: 1,
			assemblerDepth: 1,
			maxDepth: 100,
		},
		failureRate: { failureRate: 0.0, failures: 0, total: 10, throttleThreshold: 0.25 },
		signalStale: false,
		activeWorkers: 2,
		maxWorkersAtTier: 6,
		operatorVisibilityRemaining: 100,
		lastSampleAt: new Date().toISOString(),
		...overrides,
	};
}

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("AdaptiveConcurrencyGovernor — positive path", () => {
	it("all-green input admits workers", () => {
		const verdict = evaluateGovernor(greenInput());
		expect(verdict.signal).toBe("green");
		expect(verdict.canAdmit).toBe(true);
		expect(verdict.blockingReasons).toHaveLength(0);
		expect(verdict.recommendedWorkers).toBeGreaterThanOrEqual(2);
	});

	it("green signal allows incremental worker increase", () => {
		const verdict = evaluateGovernor(greenInput({ activeWorkers: 3, maxWorkersAtTier: 6 }));
		expect(verdict.recommendedWorkers).toBeLessThanOrEqual(6);
		expect(verdict.recommendedWorkers).toBeGreaterThanOrEqual(3);
	});

	it("source status details all green", () => {
		const verdict = evaluateGovernor(greenInput());
		expect(verdict.sourceStatus.resources.signal).toBe("green");
		expect(verdict.sourceStatus.rateLimit.signal).toBe("green");
		expect(verdict.sourceStatus.queues.signal).toBe("green");
		expect(verdict.sourceStatus.failureRate.signal).toBe("green");
		expect(verdict.sourceStatus.stale.signal).toBe("green");
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("AdaptiveConcurrencyGovernor — negative path", () => {
	it("stale signal blocks admission", () => {
		const verdict = evaluateGovernor(greenInput({ signalStale: true }));
		expect(verdict.signal).toBe("red");
		expect(verdict.canAdmit).toBe(false);
		expect(verdict.blockingReasons.some((r) => r.includes("stale"))).toBe(true);
	});

	it("high CPU usage (>80%) turns signal red", () => {
		const verdict = evaluateGovernor(
			greenInput({
				resources: { cpuUsage: 0.85, memoryUsage: 0.3, cpuPressure: true, memoryPressure: false },
			}),
		);
		expect(verdict.signal).toBe("red");
		expect(verdict.canAdmit).toBe(false);
		expect(verdict.sourceStatus.resources.signal).toBe("red");
	});

	it("high memory usage (>85%) turns signal red", () => {
		const verdict = evaluateGovernor(
			greenInput({
				resources: { cpuUsage: 0.2, memoryUsage: 0.9, cpuPressure: false, memoryPressure: true },
			}),
		);
		expect(verdict.signal).toBe("red");
	});

	it("moderate CPU usage (60-80%) turns signal yellow", () => {
		const verdict = evaluateGovernor(
			greenInput({
				resources: { cpuUsage: 0.65, memoryUsage: 0.3, cpuPressure: false, memoryPressure: false },
			}),
		);
		expect(verdict.signal).toBe("yellow");
		expect(verdict.recommendedWorkers).toBeLessThanOrEqual(3);
	});

	it("exhausted rate limit blocks admission", () => {
		const verdict = evaluateGovernor(
			greenInput({
				rateLimit: { tokensRemaining: 0, limited: true, provider: "openai" },
			}),
		);
		expect(verdict.signal).toBe("red");
		expect(verdict.blockingReasons.some((r) => r.includes("rate limit"))).toBe(true);
	});

	it("low rate limit tokens triggers yellow", () => {
		const verdict = evaluateGovernor(
			greenInput({
				rateLimit: { tokensRemaining: 5, limited: true, provider: "openai" },
			}),
		);
		expect(verdict.signal).toBe("yellow");
	});

	it("queue depth exceeding red ratio blocks", () => {
		const verdict = evaluateGovernor(
			greenInput({
				queues: {
					eventJournalDepth: 85,
					accpCompilerDepth: 10,
					artifactAcceptanceDepth: 10,
					assemblerDepth: 10,
					maxDepth: 100,
				},
			}),
		);
		expect(verdict.signal).toBe("red");
	});

	it("queue depth exceeding yellow ratio is yellow", () => {
		const verdict = evaluateGovernor(
			greenInput({
				queues: {
					eventJournalDepth: 55,
					accpCompilerDepth: 10,
					artifactAcceptanceDepth: 10,
					assemblerDepth: 10,
					maxDepth: 100,
				},
			}),
		);
		expect(verdict.signal).toBe("yellow");
	});

	it("high failure rate (>25%) blocks with red", () => {
		const verdict = evaluateGovernor(
			greenInput({
				failureRate: { failureRate: 0.3, failures: 3, total: 10, throttleThreshold: 0.25 },
			}),
		);
		expect(verdict.signal).toBe("red");
		expect(verdict.blockingReasons.some((r) => r.includes("Failure rate"))).toBe(true);
	});

	it("moderate failure rate (10-25%) triggers yellow", () => {
		const verdict = evaluateGovernor(
			greenInput({
				failureRate: { failureRate: 0.15, failures: 3, total: 20, throttleThreshold: 0.25 },
			}),
		);
		expect(verdict.signal).toBe("yellow");
	});

	it("negative operator visibility blocks", () => {
		const verdict = evaluateGovernor(greenInput({ operatorVisibilityRemaining: -1 }));
		expect(verdict.signal).toBe("red");
		expect(verdict.blockingReasons.some((r) => r.includes("Operator visibility"))).toBe(true);
	});

	it("red signal recommends zero workers", () => {
		const verdict = evaluateGovernor(
			greenInput({
				resources: { cpuUsage: 0.9, memoryUsage: 0.9, cpuPressure: true, memoryPressure: true },
			}),
		);
		expect(verdict.recommendedWorkers).toBe(0);
	});

	it("yellow applies backpressure", () => {
		const verdict = evaluateGovernor(
			greenInput({
				resources: { cpuUsage: 0.7, memoryUsage: 0.3, cpuPressure: false, memoryPressure: false },
			}),
		);
		expect(verdict.applyBackpressure).toBe(true);
	});

	it("sourceStatus provides per-source diagnostics", () => {
		const verdict = evaluateGovernor(
			greenInput({
				resources: { cpuUsage: 0.85, memoryUsage: 0.3, cpuPressure: true, memoryPressure: false },
			}),
		);
		expect(verdict.sourceStatus.resources.detail).toContain("CPU");
		expect(verdict.sourceStatus.queues.detail).toContain("EventJournal");
	});
});
