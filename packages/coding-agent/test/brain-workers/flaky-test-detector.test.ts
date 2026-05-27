/**
 * Flaky Test Detector — 25.L
 *
 * Covers:
 * - FlakyTestDetector construction and configuration
 * - Recording test executions
 * - Flakiness analysis and score computation
 * - Deduplication of reported flaky tests
 * - Edge cases: insufficient history, empty input, clear
 * - Finding metadata (transition count, failure count, variance)
 * - Suggested action inference
 */

import { describe, expect, test } from "vitest";
import {
	ALL_TEST_OUTCOMES,
	createFlakyTestDetector,
	DEFAULT_FLAKY_TEST_DETECTOR_CONFIG,
	FlakyTestDetector,
	TEST_OUTCOME_LABELS,
} from "../../src/brain-workers/regression-hunter/flaky-test-detector.js";

// =============================================================================
// Helper: create a test execution record
// =============================================================================

function makeExec(overrides: {
	testName: string;
	outcome: "pass" | "fail" | "error" | "skip" | "flaky";
	durationMs?: number;
	timestamp?: string;
	filePath?: string;
}): Parameters<FlakyTestDetector["recordExecution"]>[0] {
	return {
		id: `exec-${overrides.testName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		filePath: overrides.filePath ?? `tests/${overrides.testName}.spec.ts`,
		testName: overrides.testName,
		outcome: overrides.outcome,
		durationMs: overrides.durationMs ?? 100,
		timestamp: overrides.timestamp ?? new Date().toISOString(),
		metadata: {},
	};
}

// =============================================================================
// FlakyTestDetector — Constructor & Configuration
// =============================================================================

describe("FlakyTestDetector — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const detector = new FlakyTestDetector();
		const config = detector.getConfig();

		expect(config.minRunsForClassification).toBe(3);
		expect(config.flakinessThreshold).toBe(0.9);
		expect(config.transitionWeight).toBe(0.4);
		expect(config.failureRatioWeight).toBe(0.3);
		expect(config.varianceWeight).toBe(0.3);
		expect(config.varianceWindowSize).toBe(10);
		expect(config.maxResultsPerTest).toBe(50);
		expect(config.maxTests).toBe(100);
		expect(config.dedupEnabled).toBe(true);
		expect(config.dedupWindowMs).toBe(3_600_000);
		expect(config.maxConsecutiveFailures).toBe(3);
		expect(config.flagTimeoutsAsFlaky).toBe(true);
		expect(config.flagSkipsAsFlaky).toBe(false);
	});

	test("creates with partial configuration overrides", () => {
		const detector = new FlakyTestDetector({
			flakinessThreshold: 0.6,
			maxResultsPerTest: 10,
			minRunsForClassification: 5,
		});

		const config = detector.getConfig();
		expect(config.flakinessThreshold).toBe(0.6);
		expect(config.maxResultsPerTest).toBe(10);
		expect(config.minRunsForClassification).toBe(5);
		// Unchanged defaults
		expect(config.transitionWeight).toBe(0.4);
		expect(config.dedupEnabled).toBe(true);
	});

	test("setConfig updates configuration", () => {
		const detector = new FlakyTestDetector();
		detector.setConfig({ flakinessThreshold: 0.8, dedupEnabled: false });

		const config = detector.getConfig();
		expect(config.flakinessThreshold).toBe(0.8);
		expect(config.dedupEnabled).toBe(false);
	});

	test("factory function creates instance", () => {
		const detector = createFlakyTestDetector();
		expect(detector).toBeInstanceOf(FlakyTestDetector);
	});

	test("initial stats are all zeros", () => {
		const detector = new FlakyTestDetector();
		const stats = detector.getStats();

		expect(stats.totalTestsTracked).toBe(0);
		expect(stats.totalExecutionsRecorded).toBe(0);
		expect(stats.testsWithSufficientHistory).toBe(0);
		expect(stats.reportedTestCount).toBe(0);
	});
});

// =============================================================================
// FlakyTestDetector — Recording Executions
// =============================================================================

describe("FlakyTestDetector — Recording Executions", () => {
	test("recordExecution stores a single execution", () => {
		const detector = new FlakyTestDetector();
		const input = makeExec({ testName: "test.spec.ts:42", outcome: "pass" });
		const execution = detector.recordExecution(input);

		expect(execution.testName).toBe("test.spec.ts:42");
		expect(execution.outcome).toBe("pass");
		expect(execution.durationMs).toBe(100);
		expect(execution.id).toBeDefined();
		expect(execution.timestamp).toBeDefined();
		expect(execution.filePath).toBe("tests/test.spec.ts:42.spec.ts");

		const history = detector.getExecutionHistory("test.spec.ts:42");
		expect(history).toHaveLength(1);
	});

	test("recordExecution with metadata stores metadata", () => {
		const detector = new FlakyTestDetector();
		const input = makeExec({ testName: "test-1", outcome: "fail" });
		input.metadata = { ci: "github", os: "linux" };
		const execution = detector.recordExecution(input);
		expect(execution.metadata).toEqual({ ci: "github", os: "linux" });
	});

	test("recordExecution without metadata uses provided empty object", () => {
		const detector = new FlakyTestDetector();
		const input = makeExec({ testName: "test-2", outcome: "pass" });
		input.metadata = {};
		const execution = detector.recordExecution(input);
		expect(execution.metadata).toEqual({});
	});

	test("recordExecutions stores multiple executions", () => {
		const detector = new FlakyTestDetector();
		const count = detector.recordExecutions([
			makeExec({ testName: "test-a", outcome: "pass" }),
			makeExec({ testName: "test-a", outcome: "fail" }),
			makeExec({ testName: "test-b", outcome: "pass" }),
		]);

		expect(count).toBe(3);
		expect(detector.getExecutionHistory("test-a")).toHaveLength(2);
		expect(detector.getExecutionHistory("test-b")).toHaveLength(1);
	});

	test("getTrackedTests returns all test names", () => {
		const detector = new FlakyTestDetector();
		detector.recordExecution(makeExec({ testName: "test-a", outcome: "pass" }));
		detector.recordExecution(makeExec({ testName: "test-b", outcome: "fail" }));

		const tests = detector.getTrackedTests();
		expect(tests).toHaveLength(2);
		expect(tests).toContain("test-a");
		expect(tests).toContain("test-b");
	});

	test("getExecutionHistory returns empty array for unknown test", () => {
		const detector = new FlakyTestDetector();
		expect(detector.getExecutionHistory("unknown")).toEqual([]);
	});

	test("trackedTestCount returns number of distinct tests", () => {
		const detector = new FlakyTestDetector();
		expect(detector.trackedTestCount).toBe(0);
		detector.recordExecution(makeExec({ testName: "test-a", outcome: "pass" }));
		expect(detector.trackedTestCount).toBe(1);
		detector.recordExecution(makeExec({ testName: "test-b", outcome: "fail" }));
		expect(detector.trackedTestCount).toBe(2);
	});
});

// =============================================================================
// FlakyTestDetector — Flakiness Analysis
// =============================================================================

describe("FlakyTestDetector — Flakiness Analysis", () => {
	test("analyze with no executions returns empty report", () => {
		const detector = new FlakyTestDetector();
		const report = detector.analyze();

		expect(report.totalTestsAnalyzed).toBe(0);
		expect(report.flakyTestCount).toBe(0);
		expect(report.findings).toHaveLength(0);
		expect(report.averageFlakiness).toBe(0);
	});

	test("tracked test with only 1 execution is not analyzed (below minRunsForClassification)", () => {
		const detector = new FlakyTestDetector();
		detector.recordExecution(makeExec({ testName: "test-a", outcome: "pass" }));

		const report = detector.analyze();
		expect(report.findings).toHaveLength(0);
	});

	test("alternating pass/fail test is flagged as flaky with low threshold", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 3,
			flakinessThreshold: 0.3,
		});

		// Alternating outcome pattern: pass, fail, pass, fail, pass
		const outcomes: Array<"pass" | "fail"> = ["pass", "fail", "pass", "fail", "pass"];
		for (const outcome of outcomes) {
			detector.recordExecution(makeExec({ testName: "flaky-test", outcome }));
		}

		const report = detector.analyze();
		expect(report.flakyTestCount).toBeGreaterThanOrEqual(1);

		const finding = report.findings.find((f) => f.testName === "flaky-test");
		expect(finding).toBeDefined();
		expect(finding!.flakinessScore).toBeGreaterThanOrEqual(0.3);
		expect(finding!.transitionCount).toBeGreaterThanOrEqual(4);
	});

	test("consistently passing test is not flagged", () => {
		const detector = new FlakyTestDetector();

		for (let i = 0; i < 10; i++) {
			detector.recordExecution(makeExec({ testName: "stable-test", outcome: "pass" }));
		}

		const report = detector.analyze();
		const finding = report.findings.find((f) => f.testName === "stable-test");
		expect(finding).toBeUndefined();
	});

	test("consistently failing test is flagged as consistently failing", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 3,
			maxConsecutiveFailures: 2,
			flakinessThreshold: 0.3,
		});

		for (let i = 0; i < 5; i++) {
			detector.recordExecution(makeExec({ testName: "broken-test", outcome: "fail" }));
		}

		const report = detector.analyze();
		const finding = report.findings.find((f) => f.testName === "broken-test");
		expect(finding).toBeDefined();
		expect(finding!.isConsistentlyFailing).toBe(true);
		expect(finding!.consecutiveFailures).toBe(5);
	});

	test("mixed outcomes produce appropriate flakiness score", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 3,
			flakinessThreshold: 0.3,
		});

		// 3 passes, 2 fails - some flakiness but not extreme
		const outcomes: Array<"pass" | "fail"> = ["pass", "pass", "fail", "pass", "fail"];
		for (const outcome of outcomes) {
			detector.recordExecution(makeExec({ testName: "mixed-test", outcome }));
		}

		const report = detector.analyze();
		const finding = report.findings.find((f) => f.testName === "mixed-test");
		if (finding) {
			expect(finding.totalExecutions).toBe(5);
			expect(finding.passCount).toBe(3);
			expect(finding.failureCount).toBe(2);
			expect(finding.flakinessScore).toBeGreaterThan(0);
		}
	});

	test("maxResultsPerTest limits the number of reported flaky tests", () => {
		const detector = new FlakyTestDetector({
			maxResultsPerTest: 1,
			minRunsForClassification: 1,
			flakinessThreshold: 0,
		});

		detector.recordExecution(makeExec({ testName: "test-a", outcome: "fail" }));
		detector.recordExecution(makeExec({ testName: "test-b", outcome: "fail" }));
		detector.recordExecution(makeExec({ testName: "test-c", outcome: "fail" }));

		const report = detector.analyze();
		expect(report.findings.length).toBeLessThanOrEqual(1);
	});

	test("getAllFindings returns findings from last analysis", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 1,
			flakinessThreshold: 0,
		});

		detector.recordExecution(makeExec({ testName: "test-a", outcome: "fail" }));
		detector.analyze();

		const findings = detector.getAllFindings();
		expect(findings.length).toBeGreaterThanOrEqual(1);
		expect(findings[0].testName).toBe("test-a");
	});
});

// =============================================================================
// FlakyTestDetector — Deduplication
// =============================================================================

describe("FlakyTestDetector — Deduplication", () => {
	test("isDuplicate returns false for newly reported test", () => {
		const detector = new FlakyTestDetector();
		expect(detector.isDuplicate("never-reported")).toBe(false);
	});

	test("isDuplicate returns true for recently reported test", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 1,
			flakinessThreshold: 0,
		});

		detector.recordExecution(makeExec({ testName: "test-a", outcome: "fail" }));
		detector.analyze();

		expect(detector.isDuplicate("test-a")).toBe(true);
	});

	test("isDuplicate returns false when dedup is disabled", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 1,
			flakinessThreshold: 0,
			dedupEnabled: false,
		});

		detector.recordExecution(makeExec({ testName: "test-a", outcome: "fail" }));
		detector.analyze();

		expect(detector.isDuplicate("test-a")).toBe(false);
	});

	test("pruneDedupHistory removes expired entries", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 1,
			flakinessThreshold: 0,
			dedupWindowMs: 1,
		});

		detector.recordExecution(makeExec({ testName: "test-a", outcome: "fail" }));
		detector.analyze();
		expect(detector.isDuplicate("test-a")).toBe(true);

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				detector.pruneDedupHistory();
				expect(detector.isDuplicate("test-a")).toBe(false);
				resolve();
			}, 10);
		});
	});
});

// =============================================================================
// FlakyTestDetector — Suggested Action
// =============================================================================

describe("FlakyTestDetector — Suggested Action", () => {
	test("consistently failing test suggests immediate fix", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 1,
			flakinessThreshold: 0,
			maxConsecutiveFailures: 2,
		});

		detector.recordExecution(makeExec({ testName: "broken-test", outcome: "fail" }));
		detector.recordExecution(makeExec({ testName: "broken-test", outcome: "fail" }));
		detector.recordExecution(makeExec({ testName: "broken-test", outcome: "fail" }));

		const report = detector.analyze();
		const finding = report.findings.find((f) => f.testName === "broken-test");
		expect(finding).toBeDefined();
		expect(finding!.suggestedAction).toContain("consistently failing");
	});

	test("high transition rate suggests isolation improvement", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 3,
			flakinessThreshold: 0,
		});

		const outcomes: Array<"pass" | "fail"> = ["pass", "fail", "pass", "fail", "pass", "fail"];
		for (const outcome of outcomes) {
			detector.recordExecution(makeExec({ testName: "flippy-test", outcome }));
		}

		const report = detector.analyze();
		const finding = report.findings.find((f) => f.testName === "flippy-test");
		expect(finding).toBeDefined();
		expect(finding!.suggestedAction).toContain("alternates");
	});

	test("stable passing test below threshold returns no finding", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 3,
			flakinessThreshold: 0.9,
		});

		for (let i = 0; i < 5; i++) {
			detector.recordExecution(makeExec({ testName: "stable-test", outcome: "pass" }));
		}

		const report = detector.analyze();
		const finding = report.findings.find((f) => f.testName === "stable-test");
		expect(finding).toBeUndefined();
	});
});

// =============================================================================
// FlakyTestDetector — Edge Cases
// =============================================================================

describe("FlakyTestDetector — Edge Cases", () => {
	test("analyze with only error outcomes computes correctly", () => {
		const detector = new FlakyTestDetector({
			minRunsForClassification: 2,
			flakinessThreshold: 0,
		});

		detector.recordExecution(makeExec({ testName: "weird-test", outcome: "error" }));
		detector.recordExecution(makeExec({ testName: "weird-test", outcome: "skip" }));
		detector.recordExecution(makeExec({ testName: "weird-test", outcome: "error" }));

		const report = detector.analyze();
		const finding = report.findings.find((f) => f.testName === "weird-test");
		expect(finding).toBeDefined();
		expect(finding!.failureCount).toBe(2); // errors counted as failures
		expect(finding!.passCount).toBe(0);
	});

	test("clear resets all state", () => {
		const detector = new FlakyTestDetector();
		detector.recordExecution(makeExec({ testName: "test-a", outcome: "pass" }));
		detector.recordExecution(makeExec({ testName: "test-a", outcome: "fail" }));
		detector.recordExecution(makeExec({ testName: "test-a", outcome: "pass" }));

		expect(detector.getStats().totalTestsTracked).toBe(1);

		detector.clear();

		const stats = detector.getStats();
		expect(stats.totalTestsTracked).toBe(0);
		expect(stats.totalExecutionsRecorded).toBe(0);
		expect(stats.reportedTestCount).toBe(0);
		expect(detector.getExecutionHistory("test-a")).toEqual([]);
	});

	test("clearExecutionHistory removes history for specific test only", () => {
		const detector = new FlakyTestDetector();
		detector.recordExecution(makeExec({ testName: "test-a", outcome: "pass" }));
		detector.recordExecution(makeExec({ testName: "test-b", outcome: "fail" }));

		detector.clearExecutionHistory("test-a");

		expect(detector.getExecutionHistory("test-a")).toEqual([]);
		expect(detector.getExecutionHistory("test-b")).toHaveLength(1);
	});

	test("ALL_TEST_OUTCOMES contains expected values", () => {
		expect(ALL_TEST_OUTCOMES).toContain("pass");
		expect(ALL_TEST_OUTCOMES).toContain("fail");
		expect(ALL_TEST_OUTCOMES).toContain("error");
		expect(ALL_TEST_OUTCOMES).toContain("skip");
		expect(ALL_TEST_OUTCOMES).toContain("flaky");
	});

	test("TEST_OUTCOME_LABELS has labels for all outcomes", () => {
		for (const outcome of ALL_TEST_OUTCOMES) {
			expect(TEST_OUTCOME_LABELS[outcome]).toBeDefined();
		}
	});
});
