/**
 * Debugger Worker — 25.I
 *
 * Covers:
 * - DebuggerWorker session lifecycle (create, collect, analyze, complete)
 * - Budget enforcement (token budget, runtime budget)
 * - Deduplication (task hash matching, dedup window expiry)
 * - Consecutive failure tracking and health checks
 * - Evidence-backed diagnostics on failures
 * - RootCauseAnalyzer pattern matching
 * - EvidenceSummarizer integration
 * - Manifest generation
 * - Edge cases and error conditions
 * - Cancellation
 */

import { describe, expect, test } from "vitest";
import {
	ALL_DEBUG_SESSION_STATUSES,
	createDebuggerContract,
	DEFAULT_DEBUGGER_BUDGET,
	DebuggerWorker,
} from "../../src/brain-workers/debugger/debugger-worker.js";
import {
	ALL_EVIDENCE_CONFIDENCES,
	ALL_EVIDENCE_TYPES,
	createEvidenceSummarizer,
} from "../../src/brain-workers/debugger/evidence-summarizer.js";
import {
	ALL_ROOT_CAUSE_CATEGORIES,
	createRootCauseAnalyzer,
	ROOT_CAUSE_CATEGORY_LABELS,
	ROOT_CAUSE_REMEDIATIONS,
} from "../../src/brain-workers/debugger/root-cause-analyzer.js";
import { validateWorkerManifest } from "../../src/brain-workers/types.js";

// =============================================================================
// DebuggerWorker — Constructor & Configuration
// =============================================================================

describe("DebuggerWorker — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const worker = new DebuggerWorker();
		const config = worker.getConfig();

		expect(config.maxTokensPerSession).toBe(150_000);
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
		expect(config.maxConsecutiveFailures).toBe(3);
		expect(config.cooldownMs).toBe(120_000);
		expect(config.dedupEnabled).toBe(true);
		expect(config.dedupWindowMs).toBe(300_000);
	});

	test("creates with partial configuration overrides", () => {
		const worker = new DebuggerWorker({
			maxTokensPerSession: 50_000,
			maxConsecutiveFailures: 5,
			dedupEnabled: false,
		});

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(50_000);
		expect(config.maxConsecutiveFailures).toBe(5);
		expect(config.dedupEnabled).toBe(false);
		// Unchanged defaults
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
	});

	test("setConfig updates configuration", () => {
		const worker = new DebuggerWorker();
		worker.setConfig({ maxTokensPerSession: 99_999, dedupWindowMs: 10_000 });

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(99_999);
		expect(config.dedupWindowMs).toBe(10_000);
	});

	test("initial stats are all zeros", () => {
		const worker = new DebuggerWorker();
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
		expect(stats.healthStatus).toBe("healthy");
		expect(stats.dedupHistorySize).toBe(0);
	});

	test("initially healthy", () => {
		const worker = new DebuggerWorker();
		expect(worker.getHealthStatus()).toBe("healthy");
		expect(worker.checkHealth()).toBeNull();
	});
});

// =============================================================================
// DebuggerWorker — Session Lifecycle
// =============================================================================

describe("DebuggerWorker — Session Lifecycle", () => {
	test("createSession creates a pending session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("test-session", { source: "test" });

		expect(session).not.toBeNull();
		expect(session!.status).toBe("pending");
		expect(session!.label).toBe("test-session");
		expect(session!.metadata).toEqual({ source: "test" });
		expect(session!.id).toBeDefined();
		expect(session!.createdAt).toBeDefined();
		expect(session!.evidenceSummary).toBeNull();
		expect(session!.rootCauseAnalysis).toBeNull();
		expect(session!.diagnostic).toBeNull();
	});

	test("createSession without metadata uses empty object", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("minimal");
		expect(session!.metadata).toEqual({});
	});

	test("startCollection transitions from pending to collecting", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("collect-test");
		expect(session!.status).toBe("pending");

		const updated = worker.startCollection(session!.id);
		expect(updated!.status).toBe("collecting");
	});

	test("startCollection returns null for unknown session", () => {
		const worker = new DebuggerWorker();
		expect(worker.startCollection("nonexistent")).toBeNull();
	});

	test("startCollection returns null for non-pending session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("test");
		worker.startCollection(session!.id);
		// Already collecting, cannot start again
		expect(worker.startCollection(session!.id)).toBeNull();
	});

	test("addEvidence adds evidence to a collecting session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("evidence-test");
		worker.startCollection(session!.id);

		const item = worker.addEvidence(session!.id, {
			type: "error_message",
			label: "Test error",
			content: "Error: Something went wrong",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		expect(item).not.toBeNull();
		expect(item!.type).toBe("error_message");
		expect(item!.id).toBeDefined();
	});

	test("addEvidence returns null for non-collecting session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("not-collecting");
		// Session is still pending
		const item = worker.addEvidence(session!.id, {
			type: "error_message",
			label: "Test",
			content: "Error",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		expect(item).toBeNull();
	});

	test("addEvidenceBatch adds multiple items", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("batch-test");
		worker.startCollection(session!.id);

		const count = worker.addEvidenceBatch(session!.id, [
			{
				type: "error_message",
				label: "Error 1",
				content: "Error: First error",
				confidence: "high",
				source: "test",
				refs: [],
				metadata: {},
			},
			{
				type: "stack_trace",
				label: "Stack 1",
				content: "TypeError: x is undefined\n    at foo (test.js:1:1)",
				confidence: "high",
				source: "test",
				refs: [],
				metadata: {},
			},
		]);

		expect(count).toBe(2);
	});

	test("addEvidenceBatch returns -1 for non-collecting session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("batch-not-collecting");
		const count = worker.addEvidenceBatch(session!.id, []);
		expect(count).toBe(-1);
	});

	test("full flow: create → collect → analyze → completed", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("full-flow");
		worker.startCollection(session!.id);

		// Add evidence covering required types to avoid gap limitations
		worker.addEvidence(session!.id, {
			type: "error_message",
			label: "Module not found",
			content: "Error: Cannot find module 'express'",
			confidence: "high",
			source: "test-app",
			refs: ["file:///app/server.js:1"],
			metadata: { code: "MODULE_NOT_FOUND" },
		});

		worker.addEvidence(session!.id, {
			type: "stack_trace",
			label: "Stack trace",
			content: "Error: Cannot find module 'express'\n    at require (internal/modules/cjs/helpers.js:1:1)",
			confidence: "high",
			source: "test-app",
			refs: [],
			metadata: {},
		});

		worker.addEvidence(session!.id, {
			type: "execution_log",
			label: "Execution log",
			content: "[ERROR] Failed to start server: module not found",
			confidence: "high",
			source: "test-app",
			refs: [],
			metadata: {},
		});

		worker.addEvidence(session!.id, {
			type: "worker_diagnostic",
			label: "Worker diagnostic",
			content: "Worker stopped: dependency_unavailable",
			confidence: "high",
			source: "test-app",
			refs: [],
			metadata: {},
		});

		// Analyze
		const analysis = worker.analyze(session!.id);

		expect(analysis).not.toBeNull();
		expect(analysis!.findings.length).toBeGreaterThanOrEqual(1);
		expect(analysis!.primaryCause).not.toBeNull();
		expect(analysis!.actionable).toBe(true);

		// Verify session state
		const updatedSession = worker.getSession(session!.id);
		expect(updatedSession!.status).toBe("completed");
		expect(updatedSession!.evidenceSummary).not.toBeNull();
		expect(updatedSession!.rootCauseAnalysis).not.toBeNull();
	});

	test("analyze handles session with no evidence", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("no-evidence");
		worker.startCollection(session!.id);

		const analysis = worker.analyze(session!.id);
		expect(analysis).not.toBeNull();
		// With no evidence, 4 required types are all missing (>2), so a coverage gap finding is produced
		expect(analysis!.findings.length).toBeGreaterThanOrEqual(1);
		expect(analysis!.findings[0].category).toBe("unknown");
		expect(analysis!.actionable).toBe(false);
	});

	test("analyze returns null for unknown session", () => {
		const worker = new DebuggerWorker();
		expect(worker.analyze("nonexistent")).toBeNull();
	});

	test("analyze returns null for non-collecting session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("not-collecting");
		expect(worker.analyze(session!.id)).toBeNull();
	});

	test("cancelSession cancels a pending session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("cancellable");
		const cancelled = worker.cancelSession(session!.id, "User cancelled");

		expect(cancelled!.status).toBe("cancelled");
		expect(cancelled!.error).toBe("User cancelled");
	});

	test("cancelSession returns null for already completed session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("already-done");
		worker.startCollection(session!.id);
		worker.analyze(session!.id);

		expect(worker.cancelSession(session!.id, "Too late")).toBeNull();
	});

	test("cancelSession returns null for unknown session", () => {
		const worker = new DebuggerWorker();
		expect(worker.cancelSession("nonexistent", "reason")).toBeNull();
	});

	test("getAllSessions returns all sessions", () => {
		const worker = new DebuggerWorker();
		worker.createSession("session-1");
		worker.createSession("session-2");

		const all = worker.getAllSessions();
		expect(all).toHaveLength(2);
	});

	test("getSessionsByStatus filters correctly", () => {
		const worker = new DebuggerWorker();
		const _s1 = worker.createSession("pending-one");
		const s2 = worker.createSession("pending-two");
		worker.startCollection(s2!.id);

		const pending = worker.getSessionsByStatus("pending");
		expect(pending).toHaveLength(1);

		const collecting = worker.getSessionsByStatus("collecting");
		expect(collecting).toHaveLength(1);
	});
});

// =============================================================================
// DebuggerWorker — Budget Enforcement
// =============================================================================

describe("DebuggerWorker — Budget Enforcement", () => {
	test("token budget exceeded causes failure", () => {
		const worker = new DebuggerWorker({
			maxTokensPerSession: 100, // Very small budget
		});

		const session = worker.createSession("token-budget-test");
		worker.startCollection(session!.id);

		const analysis = worker.analyze(session!.id, 200, 0);
		expect(analysis).toBeNull();

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.status).toBe("failed");
		expect(failedSession!.error).toContain("Token budget exceeded");
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.stopCondition).toBe("token_budget_exhausted");
	});

	test("runtime budget exceeded causes failure", () => {
		const worker = new DebuggerWorker({
			maxRuntimeMsPerSession: 50, // Very small budget
		});

		const session = worker.createSession("runtime-budget-test");
		worker.startCollection(session!.id);

		const analysis = worker.analyze(session!.id, 0, 100);
		expect(analysis).toBeNull();

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.status).toBe("failed");
		expect(failedSession!.error).toContain("Runtime budget exceeded");
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.stopCondition).toBe("timeout");
	});

	test("budget enforcement produces evidence-backed diagnostics", () => {
		const worker = new DebuggerWorker({
			maxTokensPerSession: 50,
		});

		const session = worker.createSession("budget-diagnostics");
		worker.startCollection(session!.id);
		worker.analyze(session!.id, 100, 0);

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.context).toHaveProperty("tokensConsumed");
		expect(failedSession!.diagnostic!.context).toHaveProperty("maxTokensPerSession");
		expect(failedSession!.diagnostic!.evidenceRefs).toContain(`debugger://sessions/${session!.id}`);
	});
});

// =============================================================================
// DebuggerWorker — Deduplication
// =============================================================================

describe("DebuggerWorker — Deduplication", () => {
	test("createSession with same taskHash returns null within dedup window", () => {
		const worker = new DebuggerWorker({
			dedupWindowMs: 60_000, // 1 minute window
		});

		const hash = worker.computeTaskHash("ModuleNotFound: express");

		const s1 = worker.createSession("first", {}, hash);
		expect(s1).not.toBeNull();

		// Duplicate within window
		const s2 = worker.createSession("duplicate", {}, hash);
		expect(s2).toBeNull();
	});

	test("createSession returns new session when dedup disabled", () => {
		const worker = new DebuggerWorker({
			dedupEnabled: false,
		});

		const hash = worker.computeTaskHash("SameError");

		const s1 = worker.createSession("first", {}, hash);
		expect(s1).not.toBeNull();

		// Not deduped because dedup is disabled
		const s2 = worker.createSession("second", {}, hash);
		expect(s2).not.toBeNull();
	});

	test("createSession returns new session when no taskHash provided", () => {
		const worker = new DebuggerWorker();

		const s1 = worker.createSession("first");
		const s2 = worker.createSession("second");
		// Both should be created since no hash for dedup
		expect(s1).not.toBeNull();
		expect(s2).not.toBeNull();
	});

	test("isDuplicate returns true within dedup window", () => {
		const worker = new DebuggerWorker();
		const hash = worker.computeTaskHash("TestFailure");

		worker.createSession("first", {}, hash);
		expect(worker.isDuplicate(hash)).toBe(true);
	});

	test("isDuplicate returns false for unknown hash", () => {
		const worker = new DebuggerWorker();
		expect(worker.isDuplicate("unknown-hash")).toBe(false);
	});

	test("pruneDedupHistory removes expired entries", () => {
		const worker = new DebuggerWorker({
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
// DebuggerWorker — Consecutive Failures & Health
// =============================================================================

describe("DebuggerWorker — Consecutive Failures & Health", () => {
	test("consecutive failures tracked and health degrades", () => {
		const worker = new DebuggerWorker({
			maxTokensPerSession: 1, // Force failure on token budget
		});

		// First session fails
		const s1 = worker.createSession("fail-1");
		worker.startCollection(s1!.id);
		worker.analyze(s1!.id, 100, 0);
		expect(worker.getHealthStatus()).toBe("degraded");

		// Second consecutive failure
		const s2 = worker.createSession("fail-2");
		worker.startCollection(s2!.id);
		worker.analyze(s2!.id, 100, 0);
		expect(worker.getHealthStatus()).toBe("degraded");

		// Third consecutive failure triggers unhealthy
		const s3 = worker.createSession("fail-3");
		worker.startCollection(s3!.id);
		worker.analyze(s3!.id, 100, 0);
		expect(worker.getHealthStatus()).toBe("unhealthy");
	});

	test("successful analysis resets consecutive failures", () => {
		const worker = new DebuggerWorker({
			maxTokensPerSession: 1, // Force first session to fail
		});

		// First fails
		const s1 = worker.createSession("fail");
		worker.startCollection(s1!.id);
		worker.analyze(s1!.id, 100, 0);
		expect(worker.getHealthStatus()).toBe("degraded");

		// Reset budget and succeed
		worker.setConfig({ maxTokensPerSession: 150_000 });
		const s2 = worker.createSession("success");
		worker.startCollection(s2!.id);
		worker.addEvidence(s2!.id, {
			type: "error_message",
			label: "Error",
			content: "Error: test",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		worker.analyze(s2!.id, 10, 10);

		// Health should be healthy again
		expect(worker.getHealthStatus()).toBe("healthy");
	});

	test("checkHealth returns diagnostic when unhealthy", () => {
		const worker = new DebuggerWorker({
			maxTokensPerSession: 1,
		});

		// Exhaust consecutive failures
		for (let i = 0; i < 3; i++) {
			const s = worker.createSession(`fail-${i}`);
			worker.startCollection(s!.id);
			worker.analyze(s!.id, 100, 0);
		}

		const diagnostic = worker.checkHealth();
		expect(diagnostic).not.toBeNull();
		expect(diagnostic!.stopCondition).toBe("consecutive_failures_exceeded");
		expect(diagnostic!.context.consecutiveFailures).toBe(3);
	});

	test("clear resets all state", () => {
		const worker = new DebuggerWorker();
		worker.createSession("session-1");
		worker.createSession("session-2");
		expect(worker.getAllSessions()).toHaveLength(2);

		worker.clear();
		expect(worker.getAllSessions()).toHaveLength(0);
		expect(worker.getStats().totalSessions).toBe(0);
		expect(worker.getHealthStatus()).toBe("healthy");
	});
});

// =============================================================================
// DebuggerWorker — Manifest Generation
// =============================================================================

describe("DebuggerWorker — Manifest Generation", () => {
	test("generateManifest creates a valid manifest", () => {
		const worker = new DebuggerWorker();
		const manifest = worker.generateManifest("test-debugger", "Debugger for testing");

		expect(manifest.role).toBe("diagnostician");
		expect(manifest.name).toBe("test-debugger");
		expect(manifest.description).toBe("Debugger for testing");
		expect(manifest.contract.id).toContain("brain-worker.debugger");
		expect(manifest.contract.capabilities).toContain("collect_evidence");
		expect(manifest.contract.capabilities).toContain("analyze_root_cause");
		expect(manifest.contract.capabilities).toContain("produce_diagnostics");

		const validation = validateWorkerManifest(manifest);
		expect(validation.valid).toBe(true);
		expect(validation.errors).toEqual([]);
	});

	test("generateManifest uses correct budget defaults", () => {
		const worker = new DebuggerWorker();
		const manifest = worker.generateManifest("debugger", "Debugger");

		expect(manifest.budget.maxTokensPerCycle).toBe(DEFAULT_DEBUGGER_BUDGET.maxTokensPerCycle);
		expect(manifest.budget.maxConsecutiveFailures).toBe(DEFAULT_DEBUGGER_BUDGET.maxConsecutiveFailures);
		expect(manifest.budget.cooldownMs).toBe(DEFAULT_DEBUGGER_BUDGET.cooldownMs);
		expect(manifest.budget.maxRuntimeMs).toBe(DEFAULT_DEBUGGER_BUDGET.maxRuntimeMs);
	});

	test("createDebuggerContract produces expected contract", () => {
		const contract = createDebuggerContract();

		expect(contract.id).toBe("brain-worker.debugger.v1.0.0");
		expect(contract.capabilities).toContain("collect_evidence");
		expect(contract.capabilities).toContain("analyze_root_cause");
		expect(contract.capabilities).toContain("pattern_match_failures");
		expect(contract.capabilities).toContain("evidence_chain_tracing");
		expect(contract.inputs[0].name).toBe("failure_event");
		expect(contract.outputs[0].name).toBe("root_cause_analysis");
		expect(contract.errors[0].code).toBe("NO_EVIDENCE");
		expect(contract.errors[1].code).toBe("ANALYSIS_FAILED");
		expect(contract.errors[2].code).toBe("BUDGET_EXCEEDED");
		expect(contract.errors[3].code).toBe("DUP_SESSION");
	});
});

// =============================================================================
// DebuggerWorker — Trace & Correlation IDs
// =============================================================================

describe("DebuggerWorker — Trace & Correlation IDs", () => {
	test("createSession stores traceId when provided", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("traced", {}, undefined, "trace-abc-123");
		expect(session).not.toBeNull();
		expect(session!.traceId).toBe("trace-abc-123");
		expect(session!.correlationId).toBeNull();
	});

	test("createSession stores correlationId when provided", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("correlated", {}, undefined, undefined, "correl-xyz-789");
		expect(session).not.toBeNull();
		expect(session!.traceId).toBeNull();
		expect(session!.correlationId).toBe("correl-xyz-789");
	});

	test("createSession stores both traceId and correlationId", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("both-ids", {}, "hash", "trace-001", "correl-002");
		expect(session).not.toBeNull();
		expect(session!.traceId).toBe("trace-001");
		expect(session!.correlationId).toBe("correl-002");
	});

	test("traceId and correlationId are null by default", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("no-ids");
		expect(session!.traceId).toBeNull();
		expect(session!.correlationId).toBeNull();
	});

	test("traceId persists through session lifecycle", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("lifecycle-trace", {}, undefined, "trace-persist");
		expect(session!.traceId).toBe("trace-persist");

		worker.startCollection(session!.id);
		const collecting = worker.getSession(session!.id);
		expect(collecting!.traceId).toBe("trace-persist");

		worker.addEvidence(session!.id, {
			type: "error_message",
			label: "Error",
			content: "Error: test",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		worker.analyze(session!.id);
		const completed = worker.getSession(session!.id);
		expect(completed!.traceId).toBe("trace-persist");
	});

	test("correlationId persists through session lifecycle", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("lifecycle-correl", {}, undefined, undefined, "correl-persist");

		worker.startCollection(session!.id);
		worker.addEvidence(session!.id, {
			type: "error_message",
			label: "Error",
			content: "Error: test",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		worker.analyze(session!.id);

		const completed = worker.getSession(session!.id);
		expect(completed!.correlationId).toBe("correl-persist");
	});
});

// =============================================================================
// DebuggerWorker — Handoff Emission
// =============================================================================

describe("DebuggerWorker — Handoff Emission", () => {
	test("emitFindings returns null for unknown session", () => {
		const worker = new DebuggerWorker();
		expect(worker.emitFindings("nonexistent")).toBeNull();
	});

	test("emitFindings returns result bundle for existing session", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("emit-test", {}, undefined, "trace-emit", "correl-emit");
		expect(session).not.toBeNull();

		const result = worker.emitFindings(session!.id);
		expect(result).not.toBeNull();
		expect(result!.sessionId).toBe(session!.id);
		expect(result!.label).toBe("emit-test");
		expect(result!.traceId).toBe("trace-emit");
		expect(result!.correlationId).toBe("correl-emit");
		expect(result!.status).toBe("pending");
		expect(result!.rootCauseAnalysis).toBeNull();
		expect(result!.evidenceSummary).toBeNull();
		expect(result!.diagnostic).toBeNull();
		expect(result!.error).toBeNull();
		expect(result!.workerStats).toBeDefined();
		expect(result!.workerStats.totalSessions).toBe(1);
		expect(result!.emittedAt).toBeDefined();
	});

	test("emitFindings includes analysis after completion", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("completed-emit");
		worker.startCollection(session!.id);
		worker.addEvidence(session!.id, {
			type: "error_message",
			label: "Error",
			content: "Error: Cannot find module 'express'",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		worker.analyze(session!.id);

		const result = worker.emitFindings(session!.id);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("completed");
		expect(result!.rootCauseAnalysis).not.toBeNull();
		expect(result!.rootCauseAnalysis!.findings.length).toBeGreaterThanOrEqual(1);
		expect(result!.evidenceSummary).not.toBeNull();
		expect(result!.workerStats.completed).toBe(1);
	});

	test("emitFindings includes diagnostic after failure", () => {
		const worker = new DebuggerWorker({
			maxTokensPerSession: 1,
		});
		const session = worker.createSession("failed-emit");
		worker.startCollection(session!.id);
		worker.analyze(session!.id, 100, 0);

		const result = worker.emitFindings(session!.id);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("failed");
		expect(result!.diagnostic).not.toBeNull();
		expect(result!.rootCauseAnalysis).toBeNull();
	});

	test("emitFindings respects read-only contract (does not modify session)", () => {
		const worker = new DebuggerWorker();
		const session = worker.createSession("readonly-test");
		worker.startCollection(session!.id);
		worker.addEvidence(session!.id, {
			type: "error_message",
			label: "Error",
			content: "Error: test",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		worker.analyze(session!.id);

		const originalStatus = session!.status;
		const result = worker.emitFindings(session!.id);
		expect(result).not.toBeNull();

		// Session should be unchanged after emission
		const after = worker.getSession(session!.id);
		expect(after!.status).toBe(originalStatus);
		expect(after!.evidenceSummary).toBe(session!.evidenceSummary);
		expect(after!.rootCauseAnalysis).toBe(session!.rootCauseAnalysis);
	});
});

// =============================================================================
// DebuggerWorker — Edge Cases
// =============================================================================

describe("DebuggerWorker — Edge Cases", () => {
	test("getSession returns undefined for unknown session", () => {
		const worker = new DebuggerWorker();
		expect(worker.getSession("nonexistent")).toBeUndefined();
	});

	test("isDuplicate returns false when dedup disabled", () => {
		const worker = new DebuggerWorker({ dedupEnabled: false });
		expect(worker.isDuplicate("any-hash")).toBe(false);
	});

	test("computeTaskHash produces deterministic results", () => {
		const worker = new DebuggerWorker();
		const hash1 = worker.computeTaskHash("ModuleNotFound: express");
		const hash2 = worker.computeTaskHash("ModuleNotFound: express");
		expect(hash1).toBe(hash2);
	});

	test("computeTaskHash produces different results for different inputs", () => {
		const worker = new DebuggerWorker();
		const hash1 = worker.computeTaskHash("Error A");
		const hash2 = worker.computeTaskHash("Error B");
		expect(hash1).not.toBe(hash2);
	});

	test("getStats reflects accurate counts", () => {
		const worker = new DebuggerWorker();

		// Create and complete one session
		const s1 = worker.createSession("session-1");
		worker.startCollection(s1!.id);
		worker.addEvidence(s1!.id, {
			type: "error_message",
			label: "Error",
			content: "Error: test",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		worker.analyze(s1!.id);

		const stats = worker.getStats();
		expect(stats.totalSessions).toBe(1);
		expect(stats.completed).toBe(1);
		expect(stats.failed).toBe(0);
		expect(stats.totalSessionsCompleted).toBe(1);
		expect(stats.totalSessionsFailed).toBe(0);
	});

	test("ALL_DEBUG_SESSION_STATUSES has all expected values", () => {
		expect(ALL_DEBUG_SESSION_STATUSES).toContain("pending");
		expect(ALL_DEBUG_SESSION_STATUSES).toContain("collecting");
		expect(ALL_DEBUG_SESSION_STATUSES).toContain("analyzing");
		expect(ALL_DEBUG_SESSION_STATUSES).toContain("completed");
		expect(ALL_DEBUG_SESSION_STATUSES).toContain("failed");
		expect(ALL_DEBUG_SESSION_STATUSES).toContain("cancelled");
		expect(ALL_DEBUG_SESSION_STATUSES.length).toBe(6);
	});
});

// =============================================================================
// RootCauseAnalyzer
// =============================================================================

describe("RootCauseAnalyzer — Analysis", () => {
	test("matches dependency failure pattern", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Module not found",
			content: "Error: Cannot find module 'express'",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		expect(analysis.findings.length).toBeGreaterThanOrEqual(1);
		expect(analysis.primaryCause?.category).toBe("dependency_failure");
		expect(analysis.primaryCause?.confidence).toBeGreaterThanOrEqual(0.8);
	});

	test("matches permission denied pattern", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Permission error",
			content: "Error: EACCES: permission denied, open '/etc/config'",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		const hasPermissionFinding = analysis.findings.some((f) => f.category === "permission_denied");
		expect(hasPermissionFinding).toBe(true);
	});

	test("matches timeout pattern", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Timeout error",
			content: "Error: Operation timed out after 30000ms",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		const hasTimeout = analysis.findings.some((f) => f.category === "timeout");
		expect(hasTimeout).toBe(true);
	});

	test("matches resource exhaustion pattern", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Memory error",
			content: "FATAL: out of memory - heap allocation failed",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		const hasResource = analysis.findings.some((f) => f.category === "resource_exhaustion");
		expect(hasResource).toBe(true);
	});

	test("matches configuration error pattern", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Config error",
			content: "Error: Missing required environment variable 'DB_URL'",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		const hasConfig = analysis.findings.some((f) => f.category === "configuration_error");
		expect(hasConfig).toBe(true);
	});

	test("matches TypeError from stack traces", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "stack_trace",
			label: "TypeError",
			content: "TypeError: Cannot read properties of undefined (reading 'foo')\n    at bar (test.js:1:1)",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		const hasLogicError = analysis.findings.some((f) => f.category === "logic_error");
		const hasTypeError = analysis.findings.some((f) => f.title.toLowerCase().includes("typeerror"));
		expect(hasLogicError && hasTypeError).toBe(true);
	});

	test("produces findings with evidence chains", () => {
		const summarizer = createEvidenceSummarizer();
		const item1 = summarizer.addEvidence({
			type: "error_message",
			label: "Module not found",
			content: "Error: Cannot find module 'express'",
			confidence: "high",
			source: "test",
			refs: ["file:///app/server.js"],
			metadata: {},
		});
		summarizer.addEvidence({
			type: "stack_trace",
			label: "Stack trace",
			content: "Error: Cannot find module 'express'\n    at require (internal/modules/cjs/helpers.js)",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		expect(analysis.findings.length).toBeGreaterThanOrEqual(1);

		// The dependency_failure finding references only error_message items (the first 3 error messages)
		const depFailure = analysis.findings.find((f) => f.category === "dependency_failure");
		if (depFailure) {
			expect(depFailure.evidenceIds.length).toBeGreaterThanOrEqual(1);
			expect(depFailure.evidenceIds).toContain(item1.id);
		}

		// The logic_error finding (from stack trace TypeError patterns) references stack trace items
		const logicError = analysis.findings.find((f) => f.category === "logic_error");
		if (logicError) {
			expect(logicError.evidenceIds.length).toBeGreaterThanOrEqual(1);
		}
	});

	test("pattern matching disabled produces fewer findings", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Error",
			content: "Error: Cannot find module 'express'",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");

		// With pattern matching enabled
		const analyzerEnabled = createRootCauseAnalyzer({ enablePatternMatching: true });
		const analysisEnabled = analyzerEnabled.analyze(summary);

		// With pattern matching disabled
		const analyzerDisabled = createRootCauseAnalyzer({ enablePatternMatching: false });
		const analysisDisabled = analyzerDisabled.analyze(summary);

		expect(analysisEnabled.findings.length).toBeGreaterThan(analysisDisabled.findings.length);
	});

	test("findings are sorted by confidence descending", () => {
		const summarizer = createEvidenceSummarizer();
		// Add many errors that should trigger multiple findings
		summarizer.addEvidence({
			type: "error_message",
			label: "Error 1",
			content: "Error: Cannot find module 'express'",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});
		summarizer.addEvidence({
			type: "error_message",
			label: "Error 2",
			content: "Error: EACCES: permission denied",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("test-session");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		for (let i = 1; i < analysis.findings.length; i++) {
			expect(analysis.findings[i].confidence).toBeLessThanOrEqual(analysis.findings[i - 1].confidence);
		}
	});

	test("setConfig updates configuration", () => {
		const analyzer = createRootCauseAnalyzer({ minConfidence: 0.5 });
		expect(analyzer.getConfig().minConfidence).toBe(0.5);

		analyzer.setConfig({ minConfidence: 0.8, maxFindings: 5 });
		expect(analyzer.getConfig().minConfidence).toBe(0.8);
		expect(analyzer.getConfig().maxFindings).toBe(5);
	});
});

// =============================================================================
// RootCauseAnalyzer — Configuration & Constants
// =============================================================================

describe("RootCauseAnalyzer — Configuration & Constants", () => {
	test("ALL_ROOT_CAUSE_CATEGORIES has all expected categories", () => {
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("dependency_failure");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("configuration_error");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("runtime_error");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("resource_exhaustion");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("logic_error");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("external_service");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("permission_denied");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("timeout");
		expect(ALL_ROOT_CAUSE_CATEGORIES).toContain("unknown");
		expect(ALL_ROOT_CAUSE_CATEGORIES.length).toBe(9);
	});

	test("every root cause category has a label", () => {
		for (const cat of ALL_ROOT_CAUSE_CATEGORIES) {
			expect(ROOT_CAUSE_CATEGORY_LABELS[cat]).toBeDefined();
			expect(typeof ROOT_CAUSE_CATEGORY_LABELS[cat]).toBe("string");
		}
	});

	test("every root cause category has remediation suggestions", () => {
		for (const cat of ALL_ROOT_CAUSE_CATEGORIES) {
			expect(ROOT_CAUSE_REMEDIATIONS[cat]).toBeDefined();
			expect(ROOT_CAUSE_REMEDIATIONS[cat].length).toBeGreaterThanOrEqual(1);
		}
	});

	test("ALL_EVIDENCE_TYPES has all expected types", () => {
		expect(ALL_EVIDENCE_TYPES).toContain("stack_trace");
		expect(ALL_EVIDENCE_TYPES).toContain("error_message");
		expect(ALL_EVIDENCE_TYPES).toContain("execution_log");
		expect(ALL_EVIDENCE_TYPES).toContain("worker_diagnostic");
		expect(ALL_EVIDENCE_TYPES).toContain("state_snapshot");
		expect(ALL_EVIDENCE_TYPES).toContain("output_diff");
		expect(ALL_EVIDENCE_TYPES.length).toBe(12);
	});

	test("ALL_EVIDENCE_CONFIDENCES has all expected values", () => {
		expect(ALL_EVIDENCE_CONFIDENCES).toContain("high");
		expect(ALL_EVIDENCE_CONFIDENCES).toContain("medium");
		expect(ALL_EVIDENCE_CONFIDENCES).toContain("low");
		expect(ALL_EVIDENCE_CONFIDENCES).toContain("speculative");
		expect(ALL_EVIDENCE_CONFIDENCES.length).toBe(4);
	});
});

// =============================================================================
// EvidenceSummarizer Integration
// =============================================================================

describe("EvidenceSummarizer — Integration", () => {
	test("summarizer collects evidence and builds summary", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Error",
			content: "Error: test",
			confidence: "high",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("session-1");
		expect(summary.evidenceCount).toBe(1);
		expect(summary.sessionId).toBe("session-1");
		expect(summary.isComplete).toBe(false); // Required types not all present
	});

	test("summarizer handles batch evidence addition", () => {
		const summarizer = createEvidenceSummarizer();
		const count = summarizer.addEvidenceBatch([
			{
				type: "error_message",
				label: "Error",
				content: "Error: first",
				confidence: "high",
				source: "test",
				refs: [],
				metadata: {},
			},
			{
				type: "error_message",
				label: "Error 2",
				content: "Error: second",
				confidence: "medium",
				source: "test",
				refs: [],
				metadata: {},
			},
		]);
		expect(count).toBe(2);
		expect(summarizer.evidenceCount).toBe(2);
	});

	test("summarizer enforces max evidence limit", () => {
		const summarizer = createEvidenceSummarizer({
			maxEvidenceItems: 3,
		});

		for (let i = 0; i < 5; i++) {
			summarizer.addEvidence({
				type: "error_message",
				label: `Error ${i}`,
				content: `Error: item ${i}`,
				confidence: "high",
				source: "test",
				refs: [],
				metadata: {},
			});
		}

		expect(summarizer.evidenceCount).toBe(3);
	});

	test("summarizer extractKeyFindings handles error messages", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Critical error",
			content: "FATAL: Kernel panic - out of memory",
			confidence: "high",
			source: "system",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("session-1");
		expect(summary.keyFindings.length).toBeGreaterThanOrEqual(1);
		expect(summary.keyFindings[0]).toContain("FATAL");
	});

	test("summarizer serialization round-trips correctly", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Test",
			content: "Error: test",
			confidence: "high",
			source: "test",
			refs: ["ref-1"],
			metadata: { key: "value" },
		});

		const json = summarizer.serializeEvidence();
		const summarizer2 = createEvidenceSummarizer();
		const loaded = summarizer2.deserializeEvidence(json);

		expect(loaded).toBe(1);
		expect(summarizer2.evidenceCount).toBe(1);
	});

	test("summarizer createLink returns null for unknown evidence", () => {
		const summarizer = createEvidenceSummarizer();
		const link = summarizer.createLink("nonexistent", "supports", "high");
		expect(link).toBeNull();
	});
});

// =============================================================================
// RootCauseAnalyzer — Edge Cases
// =============================================================================

describe("RootCauseAnalyzer — Edge Cases", () => {
	test("analyze with empty summary produces coverage gap finding", () => {
		const summarizer = createEvidenceSummarizer();
		const summary = summarizer.buildSummary("empty");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		// With no evidence, 4 required types are all missing (>2), so a coverage gap finding is produced
		expect(analysis.findings.length).toBe(1);
		expect(analysis.findings[0].category).toBe("unknown");
		expect(analysis.primaryCause).not.toBeNull();
		expect(analysis.actionable).toBe(false);
		expect(analysis.limitations.length).toBeGreaterThanOrEqual(1);
	});

	test("analyze with speculative-only evidence produces low-confidence findings", () => {
		const summarizer = createEvidenceSummarizer();
		summarizer.addEvidence({
			type: "error_message",
			label: "Speculative error",
			content: "Warning: something might be wrong",
			confidence: "speculative",
			source: "test",
			refs: [],
			metadata: {},
		});

		const summary = summarizer.buildSummary("speculative");
		const analyzer = createRootCauseAnalyzer();
		const analysis = analyzer.analyze(summary);

		// Only the catch-all runtime error finding should appear at low confidence
		const highConf = analysis.findings.filter((f) => f.confidence >= 0.7);
		expect(highConf).toHaveLength(0);
	});

	test("default analyzer config has expected values", () => {
		const analyzer = createRootCauseAnalyzer();
		const config = analyzer.getConfig();

		expect(config.minConfidence).toBe(0.3);
		expect(config.maxFindings).toBe(10);
		expect(config.speculativeThreshold).toBe(0.5);
		expect(config.enablePatternMatching).toBe(true);
	});
});
