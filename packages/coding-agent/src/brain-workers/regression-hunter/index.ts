/**
 * Regression Hunter Worker — 25.L
 *
 * Barrel file re-exporting all regression hunter modules.
 *
 * @packageDocumentation
 */

export {
	createFailureClusterer,
	DEFAULT_FAILURE_CLUSTERER_CONFIG,
	type FailureCluster,
	FailureClusterer,
	type FailureClustererConfig,
} from "./failure-clusterer.js";

export {
	ALL_TEST_OUTCOMES,
	createFlakyTestDetector,
	DEFAULT_FLAKY_TEST_DETECTOR_CONFIG,
	FlakyTestDetector,
	type FlakyTestDetectorConfig,
	type FlakyTestFinding,
	type FlakyTestReport,
	type FlakyTestResult,
	TEST_OUTCOME_LABELS,
	type TestExecution,
	type TestOutcome,
} from "./flaky-test-detector.js";

export {
	ALL_REGRESSION_SESSION_STATUSES,
	ALL_REGRESSION_SEVERITIES,
	ALL_REGRESSION_TYPES,
	type BaselineSnapshot,
	type CurrentSnapshot,
	createRegressionHunterContract,
	createRegressionHunterWorker,
	DEFAULT_REGRESSION_HUNTER_BUDGET,
	DEFAULT_REGRESSION_HUNTER_CONFIG,
	DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG,
	type RegressionAnalysis,
	type RegressionFinding,
	type RegressionHunterConfig,
	type RegressionHunterHandoffResult,
	RegressionHunterWorker,
	type RegressionHunterWorkerStats,
	type RegressionSession,
	type RegressionSessionStatus,
	type RegressionSeverity,
	type RegressionType,
} from "./regression-hunter-worker.js";
