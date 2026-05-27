/**
 * Regression Hunter Worker — 25.L
 *
 * Covers:
 * - RegressionHunterWorker session lifecycle (create, compare, analyze, complete)
 * - Budget enforcement (token budget, runtime budget)
 * - Deduplication (task hash matching, dedup window expiry)
 * - Consecutive failure tracking and health checks
 * - Evidence-backed diagnostics on failures
 * - Comparison logic (expectations, metrics, new values, missing values)
 * - Manifest generation
 * - Edge cases and error conditions
 * - Cancellation
 */

import { describe, expect, test } from "vitest";
import type {
	BaselineSnapshot,
	CurrentSnapshot,
} from "../../src/brain-workers/regression-hunter/regression-hunter-worker.js";
import {
	ALL_REGRESSION_SESSION_STATUSES,
	ALL_REGRESSION_SEVERITIES,
	ALL_REGRESSION_TYPES,
	createRegressionHunterContract,
	DEFAULT_REGRESSION_HUNTER_BUDGET,
	DEFAULT_REGRESSION_HUNTER_CONFIG,
	DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG,
	REGRESSION_SEVERITY_LABELS,
	REGRESSION_TYPE_LABELS,
	RegressionHunterWorker,
} from "../../src/brain-workers/regression-hunter/regression-hunter-worker.js";
import { createWorkerDiagnostic, validateWorkerManifest } from "../../src/brain-workers/types.js";

// =============================================================================
// Helper: create a baseline snapshot
// =============================================================================

function makeBaseline(overrides?: Partial<BaselineSnapshot>): BaselineSnapshot {
	return {
		id: "baseline-001",
		label: "v1.0.0 release",
		source: "release:v1.0.0",
		capturedAt: "2026-01-15T00:00:00.000Z",
		metrics: {
			bundleSize: 250_000,
			apiLatencyMs: 120,
			testCoverage: 85,
			fileCount: 42,
		},
		expectations: [
			{
				path: "api/greeting.response",
				expected: "Hello, World!",
				description: "Greeting endpoint response",
			},
			{
				path: "api/status.code",
				expected: 200,
				description: "Status endpoint returns 200",
			},
			{
				path: "api/users.count",
				expected: 5,
				description: "Users endpoint returns list of users",
			},
		],
		metadata: {},
		...overrides,
	};
}

// =============================================================================
// Helper: create a current snapshot
// =============================================================================

function makeCurrent(overrides?: Partial<CurrentSnapshot>): CurrentSnapshot {
	return {
		id: "current-001",
		label: "feature/foo branch",
		source: "branch:feature/foo",
		capturedAt: "2026-05-25T00:00:00.000Z",
		metrics: {
			bundleSize: 250_000,
			apiLatencyMs: 120,
			testCoverage: 85,
			fileCount: 42,
		},
		values: [
			{
				path: "api/greeting.response",
				value: "Hello, World!",
				description: "Greeting endpoint response",
			},
			{
				path: "api/status.code",
				value: 200,
				description: "Status endpoint returns 200",
			},
			{
				path: "api/users.count",
				value: 5,
				description: "Users endpoint returns list of users",
			},
		],
		metadata: {},
		...overrides,
	};
}

// =============================================================================
// RegressionHunterWorker — Constructor & Configuration
// =============================================================================

describe("RegressionHunterWorker — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const worker = new RegressionHunterWorker();
		const config = worker.getConfig();

		expect(config.maxTokensPerSession).toBe(150_000);
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
		expect(config.maxConsecutiveFailures).toBe(3);
		expect(config.cooldownMs).toBe(120_000);
		expect(config.dedupEnabled).toBe(true);
		expect(config.dedupWindowMs).toBe(300_000);
		expect(config.minConfidence).toBe(0.3);
		expect(config.flagMissingExpectations).toBe(true);
		expect(config.flagNewValues).toBe(true);
		expect(config.maxFindings).toBe(100);
		expect(config.enabledTypes).toEqual([]);
	});

	test("creates with partial configuration overrides", () => {
		const worker = new RegressionHunterWorker({
			maxTokensPerSession: 50_000,
			maxConsecutiveFailures: 5,
			dedupEnabled: false,
			minConfidence: 0.5,
		});

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(50_000);
		expect(config.maxConsecutiveFailures).toBe(5);
		expect(config.dedupEnabled).toBe(false);
		expect(config.minConfidence).toBe(0.5);
		// Unchanged defaults
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
	});

	test("setConfig updates configuration", () => {
		const worker = new RegressionHunterWorker();
		worker.setConfig({ maxTokensPerSession: 99_999, dedupWindowMs: 10_000 });

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(99_999);
		expect(config.dedupWindowMs).toBe(10_000);
	});

	test("initial stats are all zeros", () => {
		const worker = new RegressionHunterWorker();
		const stats = worker.getStats();

		expect(stats.totalSessions).toBe(0);
		expect(stats.completed).toBe(0);
		expect(stats.failed).toBe(0);
		expect(stats.cancelled).toBe(0);
		expect(stats.pending).toBe(0);
		expect(stats.consecutiveFailures).toBe(0);
		expect(stats.totalSessionsCompleted).toBe(0);
		expect(stats.totalSessionsFailed).toBe(0);
		expect(stats.totalTokensConsumed).toBe(0);
		expect(stats.totalRegressionsFound).toBe(0);
		expect(stats.healthStatus).toBe("healthy");
		expect(stats.dedupHistorySize).toBe(0);
	});

	test("initially healthy", () => {
		const worker = new RegressionHunterWorker();
		expect(worker.getHealthStatus()).toBe("healthy");
		expect(worker.checkHealth()).toBeNull();
	});
});

// =============================================================================
// RegressionHunterWorker — Session Lifecycle
// =============================================================================

describe("RegressionHunterWorker — Session Lifecycle", () => {
	test("createSession creates a pending session", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("test-session", { source: "test" });

		expect(session).not.toBeNull();
		expect(session!.status).toBe("pending");
		expect(session!.label).toBe("test-session");
		expect(session!.metadata).toEqual({ source: "test" });
		expect(session!.id).toBeDefined();
		expect(session!.createdAt).toBeDefined();
		expect(session!.baseline).toBeNull();
		expect(session!.current).toBeNull();
		expect(session!.analysis).toBeNull();
		expect(session!.diagnostic).toBeNull();
	});

	test("createSession without metadata uses empty object", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("minimal");
		expect(session!.metadata).toEqual({});
	});

	test("startComparison transitions from pending to comparing", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("compare-test");
		expect(session!.status).toBe("pending");

		const baseline = makeBaseline();
		const current = makeCurrent();
		const updated = worker.startComparison(session!.id, baseline, current);
		expect(updated!.status).toBe("comparing");
		expect(updated!.baseline).toBe(baseline);
		expect(updated!.current).toBe(current);
	});

	test("startComparison returns null for unknown session", () => {
		const worker = new RegressionHunterWorker();
		const baseline = makeBaseline();
		const current = makeCurrent();
		expect(worker.startComparison("nonexistent", baseline, current)).toBeNull();
	});

	test("startComparison returns null for non-pending session", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("test");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);
		// Already comparing, cannot start again
		expect(worker.startComparison(session!.id, baseline, current)).toBeNull();
	});

	test("full flow: create -> compare -> analyze -> completed with findings", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("full-flow");
		const baseline = makeBaseline();
		// Create a current snapshot with regressions
		const current = makeCurrent({
			metrics: {
				bundleSize: 350_000, // Increased by 40% — critical
				apiLatencyMs: 250, // Increased by ~108% — critical
				testCoverage: 80, // Decreased — regression
				fileCount: 42, // Same — no regression
			},
			values: [
				{
					path: "api/greeting.response",
					value: "Bonjour, World!", // Changed — functional
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 500, // Changed — critical functional
					description: "Status endpoint returns 500",
				},
				{
					path: "api/users.count",
					value: 5, // Same
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);

		const analysis = worker.analyze(session!.id);
		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(true);
		expect(analysis!.findings.length).toBeGreaterThanOrEqual(1);

		// Verify session state
		const updatedSession = worker.getSession(session!.id);
		expect(updatedSession!.status).toBe("completed");
		expect(updatedSession!.analysis).not.toBeNull();
		expect(updatedSession!.analysis!.hasRegressions).toBe(true);
	});

	test("full flow with no regressions", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("no-regressions");
		const baseline = makeBaseline();
		const current = makeCurrent(); // Default matches baseline

		worker.startComparison(session!.id, baseline, current);

		const analysis = worker.analyze(session!.id);
		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(false);
		expect(analysis!.findings.length).toBe(0);
	});

	test("analyze returns null for unknown session", () => {
		const worker = new RegressionHunterWorker();
		expect(worker.analyze("nonexistent")).toBeNull();
	});

	test("analyze returns null for non-comparing session", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("not-comparing");
		// Session is still pending
		expect(worker.analyze(session!.id)).toBeNull();
	});

	test("cancelSession cancels a pending session", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("cancellable");
		const cancelled = worker.cancelSession(session!.id, "User cancelled");

		expect(cancelled!.status).toBe("cancelled");
		expect(cancelled!.error).toBe("User cancelled");
	});

	test("cancelSession returns null for already completed session", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("already-done");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);
		worker.analyze(session!.id);

		expect(worker.cancelSession(session!.id, "Too late")).toBeNull();
	});

	test("cancelSession returns null for unknown session", () => {
		const worker = new RegressionHunterWorker();
		expect(worker.cancelSession("nonexistent", "reason")).toBeNull();
	});

	test("getAllSessions returns all sessions", () => {
		const worker = new RegressionHunterWorker();
		worker.createSession("session-1");
		worker.createSession("session-2");

		const all = worker.getAllSessions();
		expect(all).toHaveLength(2);
	});

	test("getSessionsByStatus filters correctly", () => {
		const worker = new RegressionHunterWorker();
		const _s1 = worker.createSession("pending-one");
		const s2 = worker.createSession("pending-two");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(s2!.id, baseline, current);

		const pending = worker.getSessionsByStatus("pending");
		expect(pending).toHaveLength(1);

		const comparing = worker.getSessionsByStatus("comparing");
		expect(comparing).toHaveLength(1);
	});
});

// =============================================================================
// RegressionHunterWorker — Budget Enforcement
// =============================================================================

describe("RegressionHunterWorker — Budget Enforcement", () => {
	test("token budget exceeded causes failure", () => {
		const worker = new RegressionHunterWorker({
			maxTokensPerSession: 100, // Very small budget
		});

		const session = worker.createSession("token-budget-test");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);

		const analysis = worker.analyze(session!.id, 200, 0);
		expect(analysis).toBeNull();

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.status).toBe("failed");
		expect(failedSession!.error).toContain("Token budget exceeded");
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.stopCondition).toBe("token_budget_exhausted");
	});

	test("runtime budget exceeded causes failure", () => {
		const worker = new RegressionHunterWorker({
			maxRuntimeMsPerSession: 50, // Very small budget
		});

		const session = worker.createSession("runtime-budget-test");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);

		const analysis = worker.analyze(session!.id, 0, 100);
		expect(analysis).toBeNull();

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.status).toBe("failed");
		expect(failedSession!.error).toContain("Runtime budget exceeded");
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.stopCondition).toBe("timeout");
	});

	test("budget enforcement produces evidence-backed diagnostics", () => {
		const worker = new RegressionHunterWorker({
			maxTokensPerSession: 50,
		});

		const session = worker.createSession("budget-diagnostics");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);
		worker.analyze(session!.id, 100, 0);

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.context).toHaveProperty("tokensConsumed");
		expect(failedSession!.diagnostic!.context).toHaveProperty("maxTokensPerSession");
		expect(failedSession!.diagnostic!.evidenceRefs).toContain(`regression-hunter://sessions/${session!.id}`);
	});
});

// =============================================================================
// RegressionHunterWorker — Deduplication
// =============================================================================

describe("RegressionHunterWorker — Deduplication", () => {
	test("createSession with same taskHash returns null within dedup window", () => {
		const worker = new RegressionHunterWorker({
			dedupWindowMs: 60_000, // 1 minute window
		});

		const hash = worker.computeTaskHash("api-greeting-response-changed");

		const s1 = worker.createSession("first", {}, hash);
		expect(s1).not.toBeNull();

		// Duplicate within window
		const s2 = worker.createSession("duplicate", {}, hash);
		expect(s2).toBeNull();
	});

	test("createSession returns new session when dedup disabled", () => {
		const worker = new RegressionHunterWorker({
			dedupEnabled: false,
		});

		const hash = worker.computeTaskHash("SameSignature");

		const s1 = worker.createSession("first", {}, hash);
		expect(s1).not.toBeNull();

		// Not deduped because dedup is disabled
		const s2 = worker.createSession("second", {}, hash);
		expect(s2).not.toBeNull();
	});

	test("createSession returns new session when no taskHash provided", () => {
		const worker = new RegressionHunterWorker();

		const s1 = worker.createSession("first");
		const s2 = worker.createSession("second");
		// Both should be created since no hash for dedup
		expect(s1).not.toBeNull();
		expect(s2).not.toBeNull();
	});

	test("isDuplicate returns true within dedup window", () => {
		const worker = new RegressionHunterWorker();
		const hash = worker.computeTaskHash("TestRegression");

		worker.createSession("first", {}, hash);
		expect(worker.isDuplicate(hash)).toBe(true);
	});

	test("isDuplicate returns false for unknown hash", () => {
		const worker = new RegressionHunterWorker();
		expect(worker.isDuplicate("unknown-hash")).toBe(false);
	});

	test("pruneDedupHistory removes expired entries", () => {
		const worker = new RegressionHunterWorker({
			dedupWindowMs: 1, // 1ms window (immediately expires)
		});

		const hash = worker.computeTaskHash("QuickExpiry");
		worker.createSession("first", {}, hash);

		// Wait for window to expire
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				worker.pruneDedupHistory();
				expect(worker.isDuplicate(hash)).toBe(false);
				resolve();
			}, 10);
		});
	});
});

// =============================================================================
// RegressionHunterWorker — Consecutive Failures & Health
// =============================================================================

describe("RegressionHunterWorker — Consecutive Failures & Health", () => {
	test("consecutive failures tracked and health degrades", () => {
		const worker = new RegressionHunterWorker({
			maxTokensPerSession: 1, // Force failure on token budget
		});

		// First session fails
		const s1 = worker.createSession("fail-1");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(s1!.id, baseline, current);
		worker.analyze(s1!.id, 100, 0);
		expect(worker.getHealthStatus()).toBe("degraded");
		expect(worker.getStats().consecutiveFailures).toBe(1);

		// Second session fails
		const s2 = worker.createSession("fail-2");
		const baseline2 = makeBaseline();
		const current2 = makeCurrent();
		worker.startComparison(s2!.id, baseline2, current2);
		worker.analyze(s2!.id, 100, 0);
		expect(worker.getHealthStatus()).toBe("degraded");
		expect(worker.getStats().consecutiveFailures).toBe(2);

		// Third session fails — hits maxConsecutiveFailures=3
		const s3 = worker.createSession("fail-3");
		const baseline3 = makeBaseline();
		const current3 = makeCurrent();
		worker.startComparison(s3!.id, baseline3, current3);
		worker.analyze(s3!.id, 100, 0);
		expect(worker.getHealthStatus()).toBe("unhealthy");
		expect(worker.getStats().consecutiveFailures).toBe(3);

		// Health check returns diagnostic
		const diagnostic = worker.checkHealth();
		expect(diagnostic).not.toBeNull();
		expect(diagnostic!.stopCondition).toBe("consecutive_failures_exceeded");
		expect(diagnostic!.context.consecutiveFailures).toBe(3);
	});

	test("consecutive failures reset after successful session", () => {
		const worker = new RegressionHunterWorker({
			maxTokensPerSession: 10, // Small but enough for empty comparison
		});

		// First session fails
		const s1 = worker.createSession("fail-first");
		const baseline = makeBaseline();
		const current = makeCurrent({ values: [], metrics: {} });
		worker.startComparison(s1!.id, baseline, current);
		worker.analyze(s1!.id, 100, 0);
		expect(worker.getStats().consecutiveFailures).toBe(1);

		// Second session succeeds (empty comparison uses no tokens)
		const s2 = worker.createSession("succeed");
		worker.startComparison(s2!.id, baseline, current);
		worker.analyze(s2!.id, 5, 0);
		expect(worker.getStats().consecutiveFailures).toBe(0);
	});

	test("healthy worker has null health check", () => {
		const worker = new RegressionHunterWorker();
		expect(worker.checkHealth()).toBeNull();
		expect(worker.getHealthStatus()).toBe("healthy");
	});
});

// =============================================================================
// RegressionHunterWorker — Comparison Logic
// =============================================================================

describe("RegressionHunterWorker — Comparison Logic", () => {
	test("detects changed string expectation", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("string-change");
		const baseline = makeBaseline();
		const current = makeCurrent({
			values: [
				{
					path: "api/greeting.response",
					value: "Bonjour, World!",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 200,
					description: "Status endpoint returns 200",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(true);
		expect(analysis!.findings.length).toBe(1);
		expect(analysis!.findings[0].path).toBe("api/greeting.response");
		expect(analysis!.findings[0].type).toBe("functional");
	});

	test("detects changed numeric expectation", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("numeric-change");
		const baseline = makeBaseline();
		const current = makeCurrent({
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 500,
					description: "Status endpoint returns 500",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(true);
		const statusFinding = analysis!.findings.find((f) => f.path === "api/status.code");
		expect(statusFinding).toBeDefined();
		expect(statusFinding!.expectedValue).toBe("200");
		expect(statusFinding!.actualValue).toBe("500");
	});

	test("detects missing expectation", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("missing-expectation");
		const baseline = makeBaseline();
		const current = makeCurrent({
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				// api/status.code is missing
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(true);
		const missingFinding = analysis!.findings.find((f) => f.path === "api/status.code");
		expect(missingFinding).toBeDefined();
		expect(missingFinding!.actualValue).toBe("<missing>");
	});

	test("detects new value not in baseline", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("new-value");
		const baseline = makeBaseline();
		const current = makeCurrent({
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 200,
					description: "Status endpoint returns 200",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
				{
					path: "api/new-endpoint.response",
					value: "new data",
					description: "New endpoint added",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		const newFinding = analysis!.findings.find((f) => f.path === "api/new-endpoint.response");
		expect(newFinding).toBeDefined();
		expect(newFinding!.expectedValue).toBe("<no baseline>");
		expect(newFinding!.actualValue).toBe("new data");
	});

	test("detects metric regression", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("metric-regression");
		const baseline = makeBaseline();
		// Bundle size increased significantly
		const current = makeCurrent({
			metrics: {
				bundleSize: 500_000, // 100% increase
				apiLatencyMs: 120,
				testCoverage: 85,
				fileCount: 42,
			},
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 200,
					description: "Status endpoint returns 200",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(true);
		const bundleFinding = analysis!.findings.find((f) => f.path === "metrics.bundleSize");
		expect(bundleFinding).toBeDefined();
		expect(bundleFinding!.type).toBe("structural");
		expect(bundleFinding!.severity).toBe("critical");
	});

	test("missing metric is flagged", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("missing-metric");
		const baseline = makeBaseline();
		const current = makeCurrent({
			metrics: {
				// bundleSize is missing
				apiLatencyMs: 120,
				testCoverage: 85,
				fileCount: 42,
			},
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 200,
					description: "Status endpoint returns 200",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(true);
		const metricFinding = analysis!.findings.find((f) => f.path === "metrics.bundleSize");
		expect(metricFinding).toBeDefined();
		expect(metricFinding!.actualValue).toBe("<missing>");
	});

	test("flagMissingExpectations = false suppresses missing-expectation findings", () => {
		const worker = new RegressionHunterWorker({
			flagMissingExpectations: false,
		});
		const session = worker.createSession("no-flag-missing");
		const baseline = makeBaseline();
		const current = makeCurrent({
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				// api/status.code is missing
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		const missingFinding = analysis!.findings.find((f) => f.path === "api/status.code");
		expect(missingFinding).toBeUndefined();
	});

	test("flagNewValues = false suppresses new-value findings", () => {
		const worker = new RegressionHunterWorker({
			flagNewValues: false,
		});
		const session = worker.createSession("no-flag-new");
		const baseline = makeBaseline();
		const current = makeCurrent({
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 200,
					description: "Status endpoint returns 200",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
				{
					path: "api/new-endpoint.response",
					value: "new data",
					description: "New endpoint added",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		const newFinding = analysis!.findings.find((f) => f.path === "api/new-endpoint.response");
		expect(newFinding).toBeUndefined();
	});

	test("findings are sorted by severity (critical first)", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("severity-sort");
		const baseline = makeBaseline();
		// Both metrics change by different amounts
		const current = makeCurrent({
			metrics: {
				bundleSize: 500_000, // 100% increase -> critical
				apiLatencyMs: 130, // ~8% increase -> low
				testCoverage: 85,
				fileCount: 42,
			},
			values: [
				{
					path: "api/greeting.response",
					value: "Hello, World!",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 200,
					description: "Status endpoint returns 200",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.findings.length).toBeGreaterThanOrEqual(2);

		// First finding should be the most severe
		const severityOrder = ["critical", "high", "medium", "low", "info"];
		for (let i = 1; i < analysis!.findings.length; i++) {
			const prevIdx = severityOrder.indexOf(analysis!.findings[i - 1].severity);
			const currIdx = severityOrder.indexOf(analysis!.findings[i].severity);
			expect(prevIdx).toBeLessThanOrEqual(currIdx);
		}
	});

	test("maxFindings limits the number of findings", () => {
		const worker = new RegressionHunterWorker({
			maxFindings: 2,
		});
		const session = worker.createSession("max-findings");
		const baseline = makeBaseline();
		// Change all expectations and metrics
		const current = makeCurrent({
			metrics: {
				bundleSize: 500_000,
				apiLatencyMs: 250,
				testCoverage: 90,
				fileCount: 50,
			},
			values: [
				{
					path: "api/greeting.response",
					value: "Changed",
					description: "Greeting endpoint response",
				},
				{
					path: "api/status.code",
					value: 404,
					description: "Status endpoint returns 404",
				},
				{
					path: "api/users.count",
					value: 10,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.findings.length).toBeLessThanOrEqual(2);
	});
});

// =============================================================================
// RegressionHunterWorker — Types & Constants
// =============================================================================

describe("ALL_REGRESSION_TYPES", () => {
	test("contains all expected types", () => {
		expect(ALL_REGRESSION_TYPES).toContain("functional");
		expect(ALL_REGRESSION_TYPES).toContain("performance");
		expect(ALL_REGRESSION_TYPES).toContain("structural");
		expect(ALL_REGRESSION_TYPES).toContain("type");
		expect(ALL_REGRESSION_TYPES).toContain("contract");
		expect(ALL_REGRESSION_TYPES).toContain("visual");
		expect(ALL_REGRESSION_TYPES).toContain("unknown");
		expect(ALL_REGRESSION_TYPES.length).toBe(7);
	});

	test("every type has a label", () => {
		for (const t of ALL_REGRESSION_TYPES) {
			expect(REGRESSION_TYPE_LABELS[t]).toBeDefined();
			expect(typeof REGRESSION_TYPE_LABELS[t]).toBe("string");
		}
	});
});

describe("ALL_REGRESSION_SEVERITIES", () => {
	test("contains all expected severities", () => {
		expect(ALL_REGRESSION_SEVERITIES).toContain("critical");
		expect(ALL_REGRESSION_SEVERITIES).toContain("high");
		expect(ALL_REGRESSION_SEVERITIES).toContain("medium");
		expect(ALL_REGRESSION_SEVERITIES).toContain("low");
		expect(ALL_REGRESSION_SEVERITIES).toContain("info");
		expect(ALL_REGRESSION_SEVERITIES.length).toBe(5);
	});

	test("every severity has a label", () => {
		for (const s of ALL_REGRESSION_SEVERITIES) {
			expect(REGRESSION_SEVERITY_LABELS[s]).toBeDefined();
			expect(typeof REGRESSION_SEVERITY_LABELS[s]).toBe("string");
		}
	});
});

describe("ALL_REGRESSION_SESSION_STATUSES", () => {
	test("contains all expected statuses", () => {
		expect(ALL_REGRESSION_SESSION_STATUSES).toContain("pending");
		expect(ALL_REGRESSION_SESSION_STATUSES).toContain("comparing");
		expect(ALL_REGRESSION_SESSION_STATUSES).toContain("analyzing");
		expect(ALL_REGRESSION_SESSION_STATUSES).toContain("completed");
		expect(ALL_REGRESSION_SESSION_STATUSES).toContain("failed");
		expect(ALL_REGRESSION_SESSION_STATUSES).toContain("cancelled");
		expect(ALL_REGRESSION_SESSION_STATUSES.length).toBe(6);
	});
});

// =============================================================================
// RegressionHunterWorker — Manifest & Contract
// =============================================================================

describe("RegressionHunterWorker — Manifest & Contract", () => {
	test("generateManifest produces a valid WorkerManifest", () => {
		const worker = new RegressionHunterWorker();
		const manifest = worker.generateManifest("test-regression-hunter", "Test regression hunter");
		expect(manifest).not.toBeNull();
		expect(manifest.role).toBe("regressionHunter");
		expect(manifest.name).toBe("test-regression-hunter");
		expect(manifest.description).toBe("Test regression hunter");

		const validation = validateWorkerManifest(manifest);
		expect(validation.valid).toBe(true);
	});

	test("generateManifest produces manifest with correct contract", () => {
		const worker = new RegressionHunterWorker();
		const manifest = worker.generateManifest("regression-hunter", "Regression hunter instance");

		expect(manifest.contract.id).toContain("brain-worker.regressionHunter");
		expect(manifest.contract.capabilities).toContain("compare_baselines");
		expect(manifest.contract.capabilities).toContain("detect_regressions");
		expect(manifest.contract.capabilities).toContain("classify_severity");
		expect(manifest.contract.capabilities).toContain("produce_findings");
		expect(manifest.contract.capabilities).toContain("evidence_chain_tracing");
	});

	test("generateManifest supports overrides", () => {
		const worker = new RegressionHunterWorker();
		const manifest = worker.generateManifest("overridden", "Description", {
			version: "2.0.0",
			tags: ["test", "regression"],
		});

		expect(manifest.version).toBe("2.0.0");
		expect(manifest.tags).toEqual(["test", "regression"]);
	});

	test("createRegressionHunterContract produces valid contract", () => {
		const contract = createRegressionHunterContract();
		expect(contract).not.toBeNull();
		expect(contract.id).toBe("brain-worker.regressionHunter.v1.0.0");
		expect(contract.name).toBe("Regression Hunter Worker Contract");
		expect(contract.version).toBe("1.0.0");
		expect(contract.dependencies).toContain("baseline-store");
		expect(contract.inputs.length).toBeGreaterThanOrEqual(2);
		expect(contract.outputs.length).toBeGreaterThanOrEqual(1);
		expect(contract.errors.length).toBeGreaterThanOrEqual(1);
	});

	test("DEFAULT_REGRESSION_HUNTER_BUDGET matches regressionHunter role budget", () => {
		expect(DEFAULT_REGRESSION_HUNTER_BUDGET.maxTokensPerCycle).toBe(150_000);
		expect(DEFAULT_REGRESSION_HUNTER_BUDGET.maxConsecutiveFailures).toBe(3);
		expect(DEFAULT_REGRESSION_HUNTER_BUDGET.cooldownMs).toBe(120_000);
		expect(DEFAULT_REGRESSION_HUNTER_BUDGET.maxRuntimeMs).toBe(600_000);
	});

	test("DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG has expected defaults", () => {
		expect(DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG.enabled).toBe(true);
		expect(DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG.windowMs).toBe(300_000);
		expect(DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG.useSimilarity).toBe(true);
		expect(DEFAULT_REGRESSION_HUNTER_DEDUP_CONFIG.similarityThreshold).toBe(0.85);
	});

	test("DEFAULT_REGRESSION_HUNTER_CONFIG has expected defaults", () => {
		expect(DEFAULT_REGRESSION_HUNTER_CONFIG.maxTokensPerSession).toBe(150_000);
		expect(DEFAULT_REGRESSION_HUNTER_CONFIG.minConfidence).toBe(0.3);
		expect(DEFAULT_REGRESSION_HUNTER_CONFIG.maxFindings).toBe(100);
	});
});

// =============================================================================
// RegressionHunterWorker — Clear & Reset
// =============================================================================

describe("RegressionHunterWorker — Clear & Reset", () => {
	test("clear resets all state", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("to-clear");
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);
		worker.analyze(session!.id, 10, 5);

		expect(worker.getStats().totalSessions).toBe(1);
		expect(worker.getStats().totalTokensConsumed).toBe(10);

		worker.clear();
		const stats = worker.getStats();
		expect(stats.totalSessions).toBe(0);
		expect(stats.totalTokensConsumed).toBe(0);
		expect(stats.totalRegressionsFound).toBe(0);
		expect(stats.consecutiveFailures).toBe(0);
		expect(stats.completed).toBe(0);
		expect(stats.failed).toBe(0);
	});
});

// =============================================================================
// RegressionHunterWorker — Edge Cases
// =============================================================================

describe("RegressionHunterWorker — Edge Cases", () => {
	test("analyze with null baseline returns failure", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("no-baseline");
		// Transition to comparing but don't set baseline/current
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);

		// Manually null out baseline
		const s = worker.getSession(session!.id);
		if (s) s.baseline = null;

		// Force status back to comparing for analyze
		if (s) s.status = "comparing";

		const analysis = worker.analyze(session!.id);
		expect(analysis).toBeNull();

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.status).toBe("failed");
		expect(failedSession!.error).toContain("Missing");
	});

	test("multiple sessions tracked independently", () => {
		const worker = new RegressionHunterWorker();

		const s1 = worker.createSession("session-1");
		const s2 = worker.createSession("session-2");

		const baseline = makeBaseline();
		const current = makeCurrent({
			values: [
				{
					path: "api/greeting.response",
					value: "Changed",
					description: "Greeting endpoint response changed",
				},
				{
					path: "api/status.code",
					value: 200,
					description: "Status endpoint returns 200",
				},
				{
					path: "api/users.count",
					value: 5,
					description: "Users endpoint returns list of users",
				},
			],
		});

		worker.startComparison(s1!.id, baseline, current);
		worker.startComparison(s2!.id, baseline, makeCurrent());

		const a1 = worker.analyze(s1!.id);
		const a2 = worker.analyze(s2!.id);

		expect(a1).not.toBeNull();
		expect(a2).not.toBeNull();
		expect(a1!.hasRegressions).toBe(true);
		expect(a2!.hasRegressions).toBe(false);
	});

	test("worker handles empty expectations and metrics", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("empty-data");
		const baseline = makeBaseline({ expectations: [], metrics: {} });
		const current = makeCurrent({ values: [], metrics: {} });

		worker.startComparison(session!.id, baseline, current);
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.hasRegressions).toBe(false);
		expect(analysis!.findings.length).toBe(0);
		expect(analysis!.changeRatio).toBe(0);
	});

	test("worker handles analysis with analysis-level error", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("error-case");
		// Provide null baseline to trigger the missing data path
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);

		// The performComparison method is called inside analyze.
		// Test with missing data via null baseline
		const s = worker.getSession(session!.id);
		if (s) s.baseline = null;
		if (s) s.status = "comparing";

		const analysis = worker.analyze(session!.id);
		expect(analysis).toBeNull();

		const failed = worker.getSession(session!.id);
		expect(failed!.status).toBe("failed");
		expect(failed!.error).toContain("Missing");
	});

	test("computeTaskHash produces deterministic hashes", () => {
		const worker = new RegressionHunterWorker();

		const hash1 = worker.computeTaskHash("api-greeting-changed");
		const hash2 = worker.computeTaskHash("api-greeting-changed");
		const hash3 = worker.computeTaskHash("different-signature");

		expect(hash1).toBe(hash2);
		expect(hash1).not.toBe(hash3);
	});

	test("getSessionsByStatus returns empty array for non-existent status", () => {
		const worker = new RegressionHunterWorker();
		const completed = worker.getSessionsByStatus("completed");
		expect(completed).toEqual([]);
	});
});

// =============================================================================
// RegressionHunterWorker — Expanded Config (failureClustererConfig, flakyTestDetectorConfig)
// =============================================================================

describe("RegressionHunterWorker — Expanded Config", () => {
	test("config includes failureClustererConfig defaults", () => {
		const worker = new RegressionHunterWorker();
		const config = worker.getConfig();

		expect(config.failureClustererConfig).toBeDefined();
		expect(config.failureClustererConfig.messageSimilarityThreshold).toBe(0.6);
		expect(config.failureClustererConfig.maxClusters).toBe(50);
	});

	test("config includes flakyTestDetectorConfig defaults", () => {
		const worker = new RegressionHunterWorker();
		const config = worker.getConfig();

		expect(config.flakyTestDetectorConfig).toBeDefined();
		expect(config.flakyTestDetectorConfig.minRunsForClassification).toBe(3);
		expect(config.flakyTestDetectorConfig.flakinessThreshold).toBe(0.9);
	});

	test("config propagates overrides to sub-component configs", () => {
		const worker = new RegressionHunterWorker({
			failureClustererConfig: { maxClusters: 10 },
			flakyTestDetectorConfig: { minRunsForClassification: 5 },
		});

		const config = worker.getConfig();
		expect(config.failureClustererConfig.maxClusters).toBe(10);
		expect(config.flakyTestDetectorConfig.minRunsForClassification).toBe(5);

		// Verify sub-components received the config
		expect(worker.getFailureClusterer().getConfig().maxClusters).toBe(10);
		expect(worker.getFlakyTestDetector().getConfig().minRunsForClassification).toBe(5);
	});

	test("setConfig propagates to failureClusterer", () => {
		const worker = new RegressionHunterWorker();
		worker.setConfig({ failureClustererConfig: { maxClusters: 5 } });

		expect(worker.getConfig().failureClustererConfig.maxClusters).toBe(5);
		expect(worker.getFailureClusterer().getConfig().maxClusters).toBe(5);
	});

	test("setConfig propagates to flakyTestDetector", () => {
		const worker = new RegressionHunterWorker();
		worker.setConfig({ flakyTestDetectorConfig: { flakinessThreshold: 0.5 } });

		expect(worker.getConfig().flakyTestDetectorConfig.flakinessThreshold).toBe(0.5);
		expect(worker.getFlakyTestDetector().getConfig().flakinessThreshold).toBe(0.5);
	});
});

// =============================================================================
// RegressionHunterWorker — Sub-component Access
// =============================================================================

describe("RegressionHunterWorker — Sub-component Access", () => {
	test("getFailureClusterer returns the internal instance", () => {
		const worker = new RegressionHunterWorker();
		const clusterer = worker.getFailureClusterer();
		expect(clusterer).toBeDefined();
		expect(clusterer.clusterCount).toBe(0);
	});

	test("getFlakyTestDetector returns the internal instance", () => {
		const worker = new RegressionHunterWorker();
		const detector = worker.getFlakyTestDetector();
		expect(detector).toBeDefined();
		expect(detector.trackedTestCount).toBe(0);
	});

	test("sub-components are configured on creation", () => {
		const worker = new RegressionHunterWorker({
			failureClustererConfig: { matchOnErrorCode: false },
			flakyTestDetectorConfig: { minRunsForClassification: 5 },
		});

		expect(worker.getFailureClusterer().getConfig().matchOnErrorCode).toBe(false);
		expect(worker.getFlakyTestDetector().getConfig().minRunsForClassification).toBe(5);
	});

	test("clear resets sub-components", () => {
		const worker = new RegressionHunterWorker();

		// Add data to sub-components
		const clusterer = worker.getFailureClusterer();
		clusterer.ingest([createWorkerDiagnostic("timeout", "Test diagnostic", {}, ["regression-hunter://test"])]);
		expect(clusterer.clusterCount).toBe(1);

		const detector = worker.getFlakyTestDetector();
		detector.recordExecution({
			id: "test-run-1",
			filePath: "test.test.ts",
			testName: "test",
			outcome: "pass",
			durationMs: 100,
			timestamp: new Date().toISOString(),
			metadata: {},
		});
		detector.recordExecution({
			id: "test-run-2",
			filePath: "test.test.ts",
			testName: "test",
			outcome: "fail",
			durationMs: 100,
			timestamp: new Date().toISOString(),
			metadata: {},
		});
		detector.recordExecution({
			id: "test-run-3",
			filePath: "test.test.ts",
			testName: "test",
			outcome: "pass",
			durationMs: 100,
			timestamp: new Date().toISOString(),
			metadata: {},
		});
		expect(detector.trackedTestCount).toBe(1);

		// Clear all
		worker.clear();

		expect(clusterer.clusterCount).toBe(0);
		expect(detector.trackedTestCount).toBe(0);
	});
});

// =============================================================================
// RegressionHunterWorker — emitFindings
// =============================================================================

describe("RegressionHunterWorker — emitFindings", () => {
	test("emitFindings returns null for unknown session", () => {
		const worker = new RegressionHunterWorker();
		expect(worker.emitFindings("nonexistent")).toBeNull();
	});

	test("emitFindings returns result for existing session", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("test-session", { source: "test" });

		const result = worker.emitFindings(session!.id);
		expect(result).not.toBeNull();
		expect(result!.sessionId).toBe(session!.id);
		expect(result!.label).toBe("test-session");
		expect(result!.status).toBe("pending");
		expect(result!.baseline).toBeNull();
		expect(result!.current).toBeNull();
		expect(result!.analysis).toBeNull();
		expect(result!.failureClusters).toEqual([]);
		expect(result!.flakyTests).toEqual([]); // getAllFindings returns []
		expect(result!.workerStats).toBeDefined();
		expect(result!.emittedAt).toBeDefined();
	});

	test("emitFindings includes analysis results when session is completed", () => {
		const worker = new RegressionHunterWorker();
		const session = worker.createSession("completed-test");

		// Create baselines and run analysis
		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);
		worker.analyze(session!.id, 10, 5);

		const result = worker.emitFindings(session!.id);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("completed");
		expect(result!.baseline).not.toBeNull();
		expect(result!.current).not.toBeNull();
		expect(result!.analysis).not.toBeNull();
		expect(result!.workerStats.totalSessions).toBe(1);
	});

	test("emitFindings includes diagnostic for failed session", () => {
		const worker = new RegressionHunterWorker({
			maxTokensPerSession: 50,
		});
		const session = worker.createSession("failed-test");

		const baseline = makeBaseline();
		const current = makeCurrent();
		worker.startComparison(session!.id, baseline, current);
		worker.analyze(session!.id, 100, 0);

		const result = worker.emitFindings(session!.id);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("failed");
		expect(result!.diagnostic).not.toBeNull();
		expect(result!.error).toContain("Token budget exceeded");
	});
});
