/**
 * Regression Hunter Worker — Flaky Test Detector — 25.L
 *
 * Detects flaky tests by analyzing historical test execution outcomes
 * (pass/fail) and identifying patterns of instability: frequent
 * alternation between pass and fail, high variance over time, or
 * consistent failures after a change.
 *
 * Key design:
 * - Each tracked test has an execution history window.
 * - Flakiness scores are computed from outcome transitions, variance,
 *   and recent stability.
 * - A test is flagged as flaky when its flakiness score exceeds the
 *   configured threshold and it was not recently reported.
 * - Deduplication prevents re-reporting the same flaky test within
 *   a configurable window.
 * - All failures surface evidence-backed diagnostics.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { WorkerDiagnostic } from "../types.js";

// ---------------------------------------------------------------------------
// Test Outcome Types
// ---------------------------------------------------------------------------

/**
 * Outcome of a single test execution.
 */
export type TestOutcome = "pass" | "fail" | "error" | "skip" | "flaky";

/**
 * All valid TestOutcome values for runtime validation.
 */
export const ALL_TEST_OUTCOMES: readonly TestOutcome[] = ["pass", "fail", "error", "skip", "flaky"] as const;

/**
 * Human-readable labels for test outcomes.
 */
export const TEST_OUTCOME_LABELS: Record<TestOutcome, string> = {
	pass: "Pass",
	fail: "Fail",
	error: "Error",
	skip: "Skip",
	flaky: "Flaky",
};

// ---------------------------------------------------------------------------
// Test Execution Record
// ---------------------------------------------------------------------------

/**
 * A single recorded execution of a test.
 */
export interface TestExecution {
	/** Unique identifier for this execution (UUID v4). */
	id: string;
	/** File path of the test file. */
	filePath: string;
	/** Name of the test that was executed. */
	testName: string;
	/** Outcome of this execution. */
	outcome: TestOutcome;
	/** Duration in milliseconds (0 if unknown). */
	durationMs: number;
	/** ISO 8601 timestamp of execution. */
	timestamp: string;
	/** Optional error message on failure/error. */
	errorMessage?: string;
	/** Optional stack trace on failure/error. */
	stackTrace?: string;
	/** Arbitrary metadata for extensibility. */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Flaky Test Finding
// ---------------------------------------------------------------------------

/**
 * Result of flagging a test as flaky.
 */
export interface FlakyTestFinding {
	/** Unique finding identifier (UUID v4). */
	id: string;
	/** File path of the flaky test. */
	filePath: string;
	/** Name of the flaky test. */
	testName: string;
	/** Computed flakiness score (0-1). */
	flakinessScore: number;
	/** Total number of executions in the analysis window. */
	totalExecutions: number;
	/** Number of failures in the analysis window. */
	failureCount: number;
	/** Number of passes in the analysis window. */
	passCount: number;
	/** Number of outcome transitions (pass->fail, fail->pass, etc.). */
	transitionCount: number;
	/** Most recent outcome. */
	lastOutcome: TestOutcome;
	/** ISO 8601 timestamp of most recent execution. */
	lastRunAt: string;
	/** Consecutive failure count (0 if last was pass). */
	consecutiveFailures: number;
	/** Whether this test is currently failing consistently. */
	isConsistentlyFailing: boolean;
	/** Suggested action, if determinable. */
	suggestedAction: string;
	/** Evidence refs pointing to source artifacts. */
	evidenceRefs: string[];
	/** ISO 8601 timestamp when this finding was created. */
	createdAt: string;
	/** Arbitrary metadata for extensibility. */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Flaky Test Report
// ---------------------------------------------------------------------------

/**
 * Cumulative report of all flaky test detections in a session.
 */
export interface FlakyTestReport {
	/** Unique report identifier (UUID v4). */
	id: string;
	/** All flaky test findings. */
	findings: FlakyTestFinding[];
	/** Number of tests analyzed. */
	totalTestsAnalyzed: number;
	/** Number of tests flagged as flaky. */
	flakyTestCount: number;
	/** Number of consistently failing tests. */
	consistentlyFailingCount: number;
	/** Average flakiness score across all flagged tests. */
	averageFlakiness: number;
	/** ISO 8601 timestamp of report creation. */
	generatedAt: string;
	/** Diagnostic if the detector failed. */
	diagnostic: WorkerDiagnostic | null;
}

// ---------------------------------------------------------------------------
// FlakyTestResult (back-compat alias for FlakyTestFinding)
// ---------------------------------------------------------------------------

/**
 * Backward-compatible alias for FlakyTestFinding.
 */
export type FlakyTestResult = FlakyTestFinding;

// ---------------------------------------------------------------------------
// Flaky Test Detector Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the FlakyTestDetector.
 */
export interface FlakyTestDetectorConfig {
	/**
	 * Minimum execution count required before a test can be assessed for flakiness.
	 * Default: 3.
	 */
	minRunsForClassification: number;

	/**
	 * Flakiness score threshold (0-1) above which a test is reported as flaky.
	 * Default: 0.9.
	 */
	flakinessThreshold: number;

	/**
	 * Weight of transition frequency in the flakiness score (0-1).
	 * Default: 0.4.
	 */
	transitionWeight: number;

	/**
	 * Weight of failure ratio in the flakiness score (0-1).
	 * Default: 0.3.
	 */
	failureRatioWeight: number;

	/**
	 * Weight of outcome variance (alternation) in the flakiness score (0-1).
	 * Default: 0.3.
	 */
	varianceWeight: number;

	/**
	 * Number of recent executions to consider for variance analysis.
	 * Default: 10.
	 */
	varianceWindowSize: number;

	/**
	 * Maximum number of flaky test findings per report.
	 * Default: 50.
	 */
	maxResultsPerTest: number;

	/**
	 * Maximum number of tests to track.
	 * Default: 100.
	 */
	maxTests: number;

	/**
	 * Whether deduplication is enabled for re-reporting flaky tests.
	 * Default: true.
	 */
	dedupEnabled: boolean;

	/**
	 * Dedup window in milliseconds for re-reporting the same test.
	 * Default: 3600_000 (1 hour).
	 */
	dedupWindowMs: number;

	/**
	 * Maximum consecutive failures before a test is considered consistently failing.
	 * Default: 3.
	 */
	maxConsecutiveFailures: number;

	/**
	 * Whether to flag timeouts as potential flakiness.
	 * Default: true.
	 */
	flagTimeoutsAsFlaky: boolean;

	/**
	 * Whether to flag skipped tests as potential flakiness.
	 * Default: false.
	 */
	flagSkipsAsFlaky: boolean;
}

/**
 * Default configuration for the FlakyTestDetector.
 */
export const DEFAULT_FLAKY_TEST_DETECTOR_CONFIG: FlakyTestDetectorConfig = {
	minRunsForClassification: 3,
	flakinessThreshold: 0.9,
	transitionWeight: 0.4,
	failureRatioWeight: 0.3,
	varianceWeight: 0.3,
	varianceWindowSize: 10,
	maxResultsPerTest: 50,
	maxTests: 100,
	dedupEnabled: true,
	dedupWindowMs: 3_600_000,
	maxConsecutiveFailures: 3,
	flagTimeoutsAsFlaky: true,
	flagSkipsAsFlaky: false,
};

// ---------------------------------------------------------------------------
// Flaky Test Detector
// ---------------------------------------------------------------------------

/**
 * Analyzes test execution histories to detect flaky tests.
 *
 * Features:
 * - Computes flakiness scores from outcome transitions, failure ratios,
 *   and outcome variance.
 * - Flags tests whose flakiness exceeds the configured threshold.
 * - Deduplicates recently reported flaky tests.
 * - Identifies consistently failing tests vs. intermittently flaky ones.
 * - Produces evidence-backed diagnostics on analysis failures.
 */
export class FlakyTestDetector {
	private config: FlakyTestDetectorConfig;
	private executions: Map<string, TestExecution[]>;
	private reportedTests: Map<string, number>; // testName -> timestamp of last report
	private allFindings: FlakyTestFinding[];

	/**
	 * Create a new FlakyTestDetector.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<FlakyTestDetectorConfig>) {
		this.config = {
			minRunsForClassification:
				config?.minRunsForClassification ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.minRunsForClassification,
			flakinessThreshold: config?.flakinessThreshold ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.flakinessThreshold,
			transitionWeight: config?.transitionWeight ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.transitionWeight,
			failureRatioWeight: config?.failureRatioWeight ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.failureRatioWeight,
			varianceWeight: config?.varianceWeight ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.varianceWeight,
			varianceWindowSize: config?.varianceWindowSize ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.varianceWindowSize,
			maxResultsPerTest: config?.maxResultsPerTest ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.maxResultsPerTest,
			maxTests: config?.maxTests ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.maxTests,
			dedupEnabled: config?.dedupEnabled ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.dedupEnabled,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.dedupWindowMs,
			maxConsecutiveFailures:
				config?.maxConsecutiveFailures ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.maxConsecutiveFailures,
			flagTimeoutsAsFlaky: config?.flagTimeoutsAsFlaky ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.flagTimeoutsAsFlaky,
			flagSkipsAsFlaky: config?.flagSkipsAsFlaky ?? DEFAULT_FLAKY_TEST_DETECTOR_CONFIG.flagSkipsAsFlaky,
		};

		this.executions = new Map();
		this.reportedTests = new Map();
		this.allFindings = [];
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the detector configuration.
	 */
	setConfig(config: Partial<FlakyTestDetectorConfig>): void {
		if (config.minRunsForClassification !== undefined)
			this.config.minRunsForClassification = config.minRunsForClassification;
		if (config.flakinessThreshold !== undefined) this.config.flakinessThreshold = config.flakinessThreshold;
		if (config.transitionWeight !== undefined) this.config.transitionWeight = config.transitionWeight;
		if (config.failureRatioWeight !== undefined) this.config.failureRatioWeight = config.failureRatioWeight;
		if (config.varianceWeight !== undefined) this.config.varianceWeight = config.varianceWeight;
		if (config.varianceWindowSize !== undefined) this.config.varianceWindowSize = config.varianceWindowSize;
		if (config.maxResultsPerTest !== undefined) this.config.maxResultsPerTest = config.maxResultsPerTest;
		if (config.maxTests !== undefined) this.config.maxTests = config.maxTests;
		if (config.dedupEnabled !== undefined) this.config.dedupEnabled = config.dedupEnabled;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
		if (config.maxConsecutiveFailures !== undefined)
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		if (config.flagTimeoutsAsFlaky !== undefined) this.config.flagTimeoutsAsFlaky = config.flagTimeoutsAsFlaky;
		if (config.flagSkipsAsFlaky !== undefined) this.config.flagSkipsAsFlaky = config.flagSkipsAsFlaky;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): FlakyTestDetectorConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Execution Recording
	// -----------------------------------------------------------------------

	/**
	 * Record a single test execution outcome.
	 *
	 * Stores the execution in the test's history for later analysis.
	 *
	 * @param execution - Execution record object.
	 * @returns The recorded TestExecution.
	 */
	recordExecution(execution: {
		id: string;
		filePath: string;
		testName: string;
		outcome: TestOutcome;
		durationMs: number;
		timestamp: string;
		errorMessage?: string;
		stackTrace?: string;
		metadata: Record<string, unknown>;
	}): TestExecution {
		const fullExecution: TestExecution = {
			id: execution.id,
			filePath: execution.filePath,
			testName: execution.testName,
			outcome: execution.outcome,
			durationMs: execution.durationMs,
			timestamp: execution.timestamp,
			errorMessage: execution.errorMessage,
			stackTrace: execution.stackTrace,
			metadata: execution.metadata,
		};

		const history = this.executions.get(execution.testName) ?? [];
		history.push(fullExecution);
		this.executions.set(execution.testName, history);

		return fullExecution;
	}

	/**
	 * Record multiple test execution outcomes at once.
	 *
	 * @param executions - Array of execution records to record.
	 * @returns The total number of executions recorded.
	 */
	recordExecutions(
		executions: Array<{
			id: string;
			filePath: string;
			testName: string;
			outcome: TestOutcome;
			durationMs: number;
			timestamp: string;
			errorMessage?: string;
			stackTrace?: string;
			metadata: Record<string, unknown>;
		}>,
	): number {
		let count = 0;
		for (const exec of executions) {
			this.recordExecution(exec);
			count++;
		}
		return count;
	}

	/**
	 * Get execution history for a specific test.
	 *
	 * @param testName - The test name.
	 * @returns Array of TestExecution records, sorted by timestamp ascending.
	 */
	getExecutionHistory(testName: string): TestExecution[] {
		const history = this.executions.get(testName) ?? [];
		return [...history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	}

	/**
	 * Get all tracked test names.
	 */
	getTrackedTests(): string[] {
		return Array.from(this.executions.keys());
	}

	/**
	 * Number of distinct tests currently tracked.
	 */
	get trackedTestCount(): number {
		return this.executions.size;
	}

	// -----------------------------------------------------------------------
	// Flakiness Analysis
	// -----------------------------------------------------------------------

	/**
	 * Run flakiness analysis on all tracked tests and produce a report.
	 *
	 * @returns A FlakyTestReport with findings.
	 */
	analyze(): FlakyTestReport {
		const findings: FlakyTestFinding[] = [];

		for (const [testName, history] of this.executions) {
			// Skip tests with insufficient execution history
			if (history.length < this.config.minRunsForClassification) {
				continue;
			}

			try {
				const finding = this.analyzeTest(testName, history);
				if (finding) {
					// Dedup check
					if (this.isDuplicate(testName)) {
						continue;
					}
					findings.push(finding);
					this.reportedTests.set(testName, Date.now());
				}
			} catch {
				// Individual test analysis failure does not abort the entire report.
				continue;
			}

			// Enforce max results limit
			if (findings.length >= this.config.maxResultsPerTest) {
				break;
			}
		}

		const consistentlyFailing = findings.filter((f) => f.isConsistentlyFailing);
		this.allFindings = findings;

		const report: FlakyTestReport = {
			id: randomUUID(),
			findings,
			totalTestsAnalyzed: this.executions.size,
			flakyTestCount: findings.length,
			consistentlyFailingCount: consistentlyFailing.length,
			averageFlakiness:
				findings.length > 0 ? findings.reduce((sum, f) => sum + f.flakinessScore, 0) / findings.length : 0,
			generatedAt: new Date().toISOString(),
			diagnostic: null,
		};

		return report;
	}

	/**
	 * Get all findings from the last analysis run.
	 */
	getAllFindings(): FlakyTestFinding[] {
		return this.allFindings;
	}

	/**
	 * Analyze a single test's execution history for flakiness.
	 *
	 * @param testName - The test name.
	 * @param history - Full execution history.
	 * @returns A FlakyTestFinding if flaky, or null.
	 */
	private analyzeTest(testName: string, history: TestExecution[]): FlakyTestFinding | null {
		const sorted = [...history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		// Count pass/fail outcomes
		const passCount = sorted.filter((e) => e.outcome === "pass").length;
		const failCount = sorted.filter((e) => e.outcome === "fail" || e.outcome === "error").length;
		const timeoutCount = sorted.filter((e) => e.outcome === "flaky" && this.config.flagTimeoutsAsFlaky).length;
		const skipCount = sorted.filter((e) => e.outcome === "skip" && this.config.flagSkipsAsFlaky).length;

		// Count transitions between pass and non-pass states
		let transitionCount = 0;
		for (let i = 1; i < sorted.length; i++) {
			const prevPass = sorted[i - 1].outcome === "pass";
			const currPass = sorted[i].outcome === "pass";
			if (prevPass !== currPass) {
				transitionCount++;
			}
		}

		// Compute outcome variance from the recent window
		const windowed = sorted.slice(-this.config.varianceWindowSize);
		const varianceScore = this.computeOutcomeVariance(windowed);

		// Failure ratio: non-pass outcomes / total outcomes
		const nonPassCount = sorted.length - passCount;
		const failureRatio = sorted.length > 0 ? nonPassCount / sorted.length : 0;

		// Transition rate: transitions / (total outcomes - 1)
		const maxTransitions = Math.max(sorted.length - 1, 1);
		const transitionRate = transitionCount / maxTransitions;

		// Compute weighted flakiness score
		const flakinessScore =
			this.config.transitionWeight * transitionRate +
			this.config.failureRatioWeight * failureRatio +
			this.config.varianceWeight * varianceScore;

		// Determine if flaky threshold is met
		if (flakinessScore < this.config.flakinessThreshold) {
			return null;
		}

		// Determine consecutive failures (from the end)
		let consecutiveFailures = 0;
		for (let i = sorted.length - 1; i >= 0; i--) {
			if (sorted[i].outcome === "fail" || sorted[i].outcome === "error") {
				consecutiveFailures++;
			} else if (sorted[i].outcome === "pass") {
				break;
			}
		}

		const isConsistentlyFailing = consecutiveFailures >= this.config.maxConsecutiveFailures;
		const lastExecution = sorted[sorted.length - 1];

		// Build evidence refs
		const evidenceRefs = [
			`test-runner://tests/${encodeURIComponent(testName)}`,
			`flaky-detector://history/${encodeURIComponent(testName)}`,
		];

		// Derive suggested action
		let suggestedAction: string;
		if (isConsistentlyFailing) {
			suggestedAction = "Test is consistently failing. Investigate and fix the root cause immediately.";
		} else if (transitionRate > 0.5) {
			suggestedAction =
				"Test frequently alternates between pass and fail. Consider isolating shared state or ordering dependencies.";
		} else if (failureRatio > 0.3) {
			suggestedAction =
				"Test has a high failure rate. Review test logic and consider splitting into focused sub-tests.";
		} else {
			suggestedAction =
				"Test shows mild flakiness. Monitor and consider adding retry logic or improving test isolation.";
		}

		const lastKnownFilePath = lastExecution.filePath;

		return {
			id: randomUUID(),
			filePath: lastKnownFilePath,
			testName,
			flakinessScore: Math.round(flakinessScore * 1000) / 1000,
			totalExecutions: sorted.length,
			failureCount: failCount + timeoutCount + skipCount,
			passCount,
			transitionCount,
			lastOutcome: lastExecution.outcome,
			lastRunAt: lastExecution.timestamp,
			consecutiveFailures,
			isConsistentlyFailing,
			suggestedAction,
			evidenceRefs,
			createdAt: new Date().toISOString(),
			metadata: {
				transitionRate: Math.round(transitionRate * 1000) / 1000,
				failureRatio: Math.round(failureRatio * 1000) / 1000,
				varianceScore: Math.round(varianceScore * 1000) / 1000,
			},
		};
	}

	/**
	 * Compute outcome variance within a window of executions.
	 *
	 * Measures how much the outcomes alternate. High alternation =
	 * high variance = flaky indicator.
	 *
	 * @param executions - Recent execution window.
	 * @returns Variance score 0-1.
	 */
	private computeOutcomeVariance(executions: TestExecution[]): number {
		if (executions.length < 2) return 0;

		// Count runs of consecutive same outcomes
		let runs = 1;
		for (let i = 1; i < executions.length; i++) {
			const prevPass = executions[i - 1].outcome === "pass";
			const currPass = executions[i].outcome === "pass";
			if (prevPass !== currPass) {
				runs++;
			}
		}

		// More runs = higher variance (alternating)
		// Normalize: max runs = executions.length (fully alternating)
		const maxRuns = executions.length;
		return runs / maxRuns;
	}

	// -----------------------------------------------------------------------
	// Deduplication
	// -----------------------------------------------------------------------

	/**
	 * Check if a test has been reported as flaky within the dedup window.
	 *
	 * @param testName - The test name to check.
	 * @returns true if recently reported and within dedup window.
	 */
	isDuplicate(testName: string): boolean {
		if (!this.config.dedupEnabled) return false;
		const lastReported = this.reportedTests.get(testName);
		if (lastReported === undefined) return false;
		return Date.now() - lastReported < this.config.dedupWindowMs;
	}

	/**
	 * Prune expired dedup history entries.
	 */
	pruneDedupHistory(): void {
		const now = Date.now();
		for (const [testName, timestamp] of this.reportedTests) {
			if (now - timestamp >= this.config.dedupWindowMs) {
				this.reportedTests.delete(testName);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Stats & State
	// -----------------------------------------------------------------------

	/**
	 * Get current detector stats.
	 */
	getStats(): {
		totalTestsTracked: number;
		totalExecutionsRecorded: number;
		testsWithSufficientHistory: number;
		reportedTestCount: number;
	} {
		const totalExecutionsRecorded = Array.from(this.executions.values()).reduce((sum, h) => sum + h.length, 0);
		const testsWithSufficientHistory = Array.from(this.executions.values()).filter(
			(h) => h.length >= this.config.minRunsForClassification,
		).length;

		return {
			totalTestsTracked: this.executions.size,
			totalExecutionsRecorded,
			testsWithSufficientHistory,
			reportedTestCount: this.reportedTests.size,
		};
	}

	/**
	 * Clear all execution history, dedup state, and reported tests.
	 */
	clear(): void {
		this.executions.clear();
		this.reportedTests.clear();
		this.allFindings = [];
	}

	/**
	 * Clear execution history for a specific test.
	 *
	 * @param testName - The test name to clear history for.
	 */
	clearExecutionHistory(testName: string): void {
		this.executions.delete(testName);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a FlakyTestDetector with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new FlakyTestDetector instance.
 */
export function createFlakyTestDetector(config?: Partial<FlakyTestDetectorConfig>): FlakyTestDetector {
	return new FlakyTestDetector(config);
}
