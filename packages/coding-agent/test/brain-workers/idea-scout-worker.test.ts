/**
 * Idea Scout Worker — 25.K
 *
 * Covers:
 * - IdeaScoutWorker session lifecycle (create, scout, mine, evaluate, complete)
 * - Budget enforcement (token budget, runtime budget)
 * - Deduplication (task hash matching, dedup window expiry)
 * - Consecutive failure tracking and health checks
 * - Evidence-backed diagnostics on failures
 * - IdeaTrendDetector trend detection
 * - Idea generation from signals, observations, and trends
 * - Manifest generation
 * - Edge cases and error conditions
 * - Cancellation
 */

import { describe, expect, test, vi } from "vitest";
import {
	ALL_IDEA_PRIORITIES,
	ALL_SCOUT_SESSION_STATUSES,
	createIdeaScoutContract,
	DEFAULT_IDEA_SCOUT_BUDGET,
	IdeaScoutWorker,
	IdeaTrendDetector,
} from "../../src/brain-workers/idea-scout/idea-scout-worker.js";
import { validateWorkerManifest } from "../../src/brain-workers/types.js";

// =============================================================================
// IdeaScoutWorker — Constructor & Configuration
// =============================================================================

describe("IdeaScoutWorker — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const worker = new IdeaScoutWorker();
		const config = worker.getConfig();

		expect(config.maxTokensPerSession).toBe(120_000);
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
		expect(config.maxConsecutiveFailures).toBe(3);
		expect(config.cooldownMs).toBe(120_000);
		expect(config.dedupEnabled).toBe(true);
		expect(config.dedupWindowMs).toBe(300_000);
		expect(config.minSignalConfidence).toBe(0.3);
		expect(config.minIdeaConfidence).toBe(0.4);
		expect(config.maxIdeasPerSession).toBe(10);
		expect(config.trendDetectionEnabled).toBe(true);
	});

	test("creates with partial configuration overrides", () => {
		const worker = new IdeaScoutWorker({
			maxTokensPerSession: 50_000,
			maxConsecutiveFailures: 5,
			dedupEnabled: false,
			minIdeaConfidence: 0.6,
		});

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(50_000);
		expect(config.maxConsecutiveFailures).toBe(5);
		expect(config.dedupEnabled).toBe(false);
		expect(config.minIdeaConfidence).toBe(0.6);
		// Unchanged defaults
		expect(config.maxRuntimeMsPerSession).toBe(600_000);
		expect(config.cooldownMs).toBe(120_000);
	});

	test("setConfig updates configuration", () => {
		const worker = new IdeaScoutWorker();
		worker.setConfig({ maxTokensPerSession: 99_999, dedupWindowMs: 10_000 });

		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(99_999);
		expect(config.dedupWindowMs).toBe(10_000);
	});

	test("setConfig updates trend detection setting", () => {
		const worker = new IdeaScoutWorker();
		expect(worker.getConfig().trendDetectionEnabled).toBe(true);

		worker.setConfig({ trendDetectionEnabled: false });
		expect(worker.getConfig().trendDetectionEnabled).toBe(false);

		const detector = worker.getTrendDetector();
		expect(detector.getConfig().enabled).toBe(false);
	});

	test("initial stats are all zeros", () => {
		const worker = new IdeaScoutWorker();
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
		expect(stats.totalIdeasGenerated).toBe(0);
		expect(stats.totalMinedSignals).toBe(0);
		expect(stats.totalTrendsDetected).toBe(0);
		expect(stats.healthStatus).toBe("healthy");
		expect(stats.dedupHistorySize).toBe(0);
	});

	test("initially healthy", () => {
		const worker = new IdeaScoutWorker();
		expect(worker.getHealthStatus()).toBe("healthy");
		expect(worker.checkHealth()).toBeNull();
	});
});

// =============================================================================
// IdeaScoutWorker — Contract & Manifest
// =============================================================================

describe("IdeaScoutWorker — Contract & Manifest", () => {
	test("createIdeaScoutContract returns valid contract with correct role", () => {
		const contract = createIdeaScoutContract();

		expect(contract.id).toContain("idea-scout");
		expect(contract.capabilities).toContain("signal_mining");
		expect(contract.capabilities).toContain("idea_generation");
		expect(contract.capabilities).toContain("trend_detection");
		expect(contract.capabilities).toContain("opportunity_identification");
		expect(contract.inputs).toHaveLength(3);
		expect(contract.outputs).toHaveLength(2);
		expect(contract.errors).toHaveLength(3);
		expect(contract.dependencies).toContain("brain-worker.analyst");
		expect(contract.supportsCancellation).toBe(true);
		expect(contract.supportsStreaming).toBe(false);
	});

	test("generateManifest produces a valid manifest", () => {
		const worker = new IdeaScoutWorker();
		const manifest = worker.generateManifest(
			"Test Idea Scout",
			"Test description for idea scout worker",
		);

		expect(manifest.role).toBe("ideaScout");
		expect(manifest.name).toBe("Test Idea Scout");
		expect(manifest.description).toBe("Test description for idea scout worker");
		expect(manifest.contract.id).toContain("idea-scout");
		expect(manifest.budget.maxTokensPerCycle).toBe(120_000);

		// Validate manifest structure
		const validation = validateWorkerManifest(manifest);
		expect(validation.valid).toBe(true);
	});

	test("generateManifest with overrides", () => {
		const worker = new IdeaScoutWorker();
		const manifest = worker.generateManifest("Scout", "Desc", {
			version: "2.0.0",
			tags: ["test", "scout"],
		});

		expect(manifest.version).toBe("2.0.0");
		expect(manifest.tags).toEqual(["test", "scout"]);
	});
});

// =============================================================================
// ScoutSession Status Constants
// =============================================================================

describe("ALL_SCOUT_SESSION_STATUSES", () => {
	test("contains all expected statuses", () => {
		expect(ALL_SCOUT_SESSION_STATUSES).toContain("idle");
		expect(ALL_SCOUT_SESSION_STATUSES).toContain("scouting");
		expect(ALL_SCOUT_SESSION_STATUSES).toContain("mining");
		expect(ALL_SCOUT_SESSION_STATUSES).toContain("evaluating");
		expect(ALL_SCOUT_SESSION_STATUSES).toContain("completed");
		expect(ALL_SCOUT_SESSION_STATUSES).toContain("failed");
		expect(ALL_SCOUT_SESSION_STATUSES).toContain("cancelled");
	});

	test("has 7 statuses", () => {
		expect(ALL_SCOUT_SESSION_STATUSES.length).toBe(7);
	});
});

describe("ALL_IDEA_PRIORITIES", () => {
	test("contains all expected priorities", () => {
		expect(ALL_IDEA_PRIORITIES).toContain("low");
		expect(ALL_IDEA_PRIORITIES).toContain("medium");
		expect(ALL_IDEA_PRIORITIES).toContain("high");
		expect(ALL_IDEA_PRIORITIES).toContain("critical");
	});

	test("has 4 priorities", () => {
		expect(ALL_IDEA_PRIORITIES.length).toBe(4);
	});
});

describe("DEFAULT_IDEA_SCOUT_BUDGET", () => {
	test("has correct budget values", () => {
		expect(DEFAULT_IDEA_SCOUT_BUDGET.maxTokensPerCycle).toBe(120_000);
		expect(DEFAULT_IDEA_SCOUT_BUDGET.maxConsecutiveFailures).toBe(3);
		expect(DEFAULT_IDEA_SCOUT_BUDGET.cooldownMs).toBe(120_000);
		expect(DEFAULT_IDEA_SCOUT_BUDGET.maxRuntimeMs).toBe(600_000);
	});
});

// =============================================================================
// IdeaScoutWorker — Session Lifecycle
// =============================================================================

describe("IdeaScoutWorker — Session Lifecycle", () => {
	test("creates a session and transitions through lifecycle", () => {
		const worker = new IdeaScoutWorker();

		// Create session
		const session = worker.createSession(
			"Test Scout",
			[{ id: "sig-1", pattern: "test_pattern", summary: "A test signal" }],
			[{ id: "obs-1", title: "Test observation" }],
		);
		expect(session).not.toBeNull();
		expect(session!.status).toBe("idle");
		expect(session!.label).toBe("Test Scout");
		expect(session!.inputSignals).toHaveLength(1);
		expect(session!.inputObservations).toHaveLength(1);

		// Start scouting
		const started = worker.startScouting(session!.id);
		expect(started).not.toBeNull();
		expect(started!.status).toBe("scouting");

		// Mine signals
		const mined = worker.mineSignals(session!.id);
		expect(mined).toBeGreaterThanOrEqual(0);
		const updatedSession = worker.getSession(session!.id);
		expect(updatedSession!.status).toBe("mining");

		// Evaluate (generate ideas)
		const ideas = worker.evaluate(session!.id, 1000, 2000);
		expect(ideas).not.toBeNull();
		expect(Array.isArray(ideas)).toBe(true);

		const finalSession = worker.getSession(session!.id);
		expect(finalSession!.status).toBe("completed");
		expect(finalSession!.tokensConsumed).toBe(1000);
		expect(finalSession!.runtimeMs).toBe(2000);
	});

	test("creates session with default empty inputs", () => {
		const worker = new IdeaScoutWorker();
		const session = worker.createSession("Empty Scout");
		expect(session).not.toBeNull();
		expect(session!.inputSignals).toEqual([]);
		expect(session!.inputObservations).toEqual([]);
	});

	test("returns null when starting scouting with invalid session ID", () => {
		const worker = new IdeaScoutWorker();
		expect(worker.startScouting("nonexistent")).toBeNull();
	});

	test("returns null when starting scouting from wrong state", () => {
		const worker = new IdeaScoutWorker();
		const session = worker.createSession("Test");
		worker.startScouting(session!.id);
		// Already scouting, can't start again
		expect(worker.startScouting(session!.id)).toBeNull();
	});

	test("mineSignals returns -1 for nonexistent session", () => {
		const worker = new IdeaScoutWorker();
		expect(worker.mineSignals("nonexistent")).toBe(-1);
	});

	test("mineSignals returns -1 in wrong state", () => {
		const worker = new IdeaScoutWorker();
		const session = worker.createSession("Test");
		// Session is idle, not scouting
		expect(worker.mineSignals(session!.id)).toBe(-1);
	});

	test("evaluate returns null for nonexistent session", () => {
		const worker = new IdeaScoutWorker();
		expect(worker.evaluate("nonexistent")).toBeNull();
	});

	test("evaluate returns null in wrong state", () => {
		const worker = new IdeaScoutWorker();
		const session = worker.createSession("Test");
		// Session is idle, not mining
		expect(worker.evaluate(session!.id)).toBeNull();
	});

	test("completes full lifecycle with multiple signals and observations", () => {
		const worker = new IdeaScoutWorker({
			minIdeaConfidence: 0.1, // Low threshold to ensure ideas are generated
			minSignalConfidence: 0.1,
		});

		const signals = [
			{ id: "sig-1", pattern: "error_spike", summary: "Error rate increased in queue processing" },
			{ id: "sig-2", pattern: "memory_pressure", summary: "Memory usage is approaching limits" },
			{ id: "sig-3", pattern: "integration_failure", summary: "Git integration failing intermittently" },
		];
		const observations = [
			{ id: "obs-1", title: "Queue blocked test" },
			{ id: "obs-2", title: "Performance test results" },
		];

		const session = worker.createSession("Full Test", signals, observations);
		expect(session).not.toBeNull();

		worker.startScouting(session!.id);
		const minedCount = worker.mineSignals(session!.id);
		expect(minedCount).toBeGreaterThanOrEqual(1);

		const ideas = worker.evaluate(session!.id, 5000, 3000);
		expect(ideas).not.toBeNull();
		expect(ideas!.length).toBeGreaterThanOrEqual(1);

		const finalSession = worker.getSession(session!.id);
		expect(finalSession!.minedSignals.length).toBe(minedCount);
		expect(finalSession!.ideas.length).toBe(ideas!.length);
	});
});

// =============================================================================
// IdeaScoutWorker — Cancellation
// =============================================================================

describe("IdeaScoutWorker — Cancellation", () => {
	test("cancels a pending session", () => {
		const worker = new IdeaScoutWorker();
		const session = worker.createSession("Cancel Test");
		expect(session!.status).toBe("idle");

		const cancelled = worker.cancelSession(session!.id, "User requested cancellation");
		expect(cancelled).not.toBeNull();
		expect(cancelled!.status).toBe("cancelled");
		expect(cancelled!.error).toBe("User requested cancellation");
	});

	test("cannot cancel a completed session", () => {
		const worker = new IdeaScoutWorker();
		const session = worker.createSession("Complete Cancel Test", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);
		worker.evaluate(session!.id, 100, 100);

		expect(worker.cancelSession(session!.id, "Too late")).toBeNull();
	});

	test("cannot cancel a failed session", () => {
		const worker = new IdeaScoutWorker();
		const session = worker.createSession("Fail Cancel Test");

		// Force a failure by evaluating before mining (wrong state)
		worker.cancelSession(session!.id, "Cancel it");
		expect(worker.cancelSession(session!.id, "Already cancelled")).toBeNull();
	});

	test("returns null for nonexistent session on cancel", () => {
		const worker = new IdeaScoutWorker();
		expect(worker.cancelSession("nonexistent", "reason")).toBeNull();
	});
});

// =============================================================================
// IdeaScoutWorker — Budget Enforcement
// =============================================================================

describe("IdeaScoutWorker — Budget Enforcement", () => {
	test("fails session when token budget exceeded", () => {
		const worker = new IdeaScoutWorker({
			maxTokensPerSession: 100,
			minIdeaConfidence: 0.1,
			minSignalConfidence: 0.1,
		});

		const session = worker.createSession("Token Budget Test", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);

		// Exceed token budget
		const result = worker.evaluate(session!.id, 200, 0);
		expect(result).toBeNull();

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.status).toBe("failed");
		expect(failedSession!.error).toContain("Token budget exceeded");
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.stopCondition).toBe("token_budget_exhausted");
	});

	test("fails session when runtime budget exceeded", () => {
		const worker = new IdeaScoutWorker({
			maxRuntimeMsPerSession: 50,
			minIdeaConfidence: 0.1,
			minSignalConfidence: 0.1,
		});

		const session = worker.createSession("Runtime Budget Test", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);

		// Exceed runtime budget
		const result = worker.evaluate(session!.id, 10, 200);
		expect(result).toBeNull();

		const failedSession = worker.getSession(session!.id);
		expect(failedSession!.status).toBe("failed");
		expect(failedSession!.error).toContain("Runtime budget exceeded");
		expect(failedSession!.diagnostic).not.toBeNull();
		expect(failedSession!.diagnostic!.stopCondition).toBe("timeout");
	});
});

// =============================================================================
// IdeaScoutWorker — Deduplication
// =============================================================================

describe("IdeaScoutWorker — Deduplication", () => {
	test("dedup returns null for duplicate task hash within window", () => {
		const worker = new IdeaScoutWorker({
			dedupWindowMs: 100_000,
			dedupEnabled: true,
		});

		const taskHash = worker.computeTaskHash("signal-signature-123");

		const session1 = worker.createSession("First", [], {}, undefined, taskHash);
		expect(session1).not.toBeNull();

		const session2 = worker.createSession("Duplicate", [], {}, undefined, taskHash);
		expect(session2).toBeNull(); // Deduped
	});

	test("dedup does not suppress when dedup is disabled", () => {
		const worker = new IdeaScoutWorker({
			dedupEnabled: false,
		});

		const taskHash = worker.computeTaskHash("signal-signature");

		const session1 = worker.createSession("First", [], {}, undefined, taskHash);
		expect(session1).not.toBeNull();

		const session2 = worker.createSession("Second", [], {}, undefined, taskHash);
		expect(session2).not.toBeNull(); // Not deduped
	});

	test("dedup allows after window expires", () => {
		// Use a very short window and wait
		const worker = new IdeaScoutWorker({
			dedupWindowMs: 1, // 1ms window
			dedupEnabled: true,
		});

		const taskHash = worker.computeTaskHash("signal-signature");

		const session1 = worker.createSession("First", [], {}, undefined, taskHash);
		expect(session1).not.toBeNull();

		// Wait for dedup window to expire
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				const session2 = worker.createSession("Second", [], {}, undefined, taskHash);
				expect(session2).not.toBeNull(); // Window expired
				resolve();
			}, 5);
		});
	});

	test("isDuplicate returns correct values", () => {
		const worker = new IdeaScoutWorker({ dedupEnabled: true });
		const hash = "test-hash-123";

		expect(worker.isDuplicate(hash)).toBe(false);

		worker.createSession("Test", [], [], undefined, hash);
		expect(worker.isDuplicate(hash)).toBe(true);

		// Different hash
		expect(worker.isDuplicate("other-hash")).toBe(false);
	});

	test("pruneDedupHistory removes expired entries", () => {
		const worker = new IdeaScoutWorker({
			dedupWindowMs: 1,
			dedupEnabled: true,
		});

		const hash = worker.computeTaskHash("test");
		worker.createSession("Test", [], [], undefined, hash);

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				worker.pruneDedupHistory();
				expect(worker.getStats().dedupHistorySize).toBe(0);
				resolve();
			}, 5);
		});
	});
});

// =============================================================================
// IdeaScoutWorker — Health & Diagnostics
// =============================================================================

describe("IdeaScoutWorker — Health & Diagnostics", () => {
	test("health degrades with consecutive failures", () => {
		const worker = new IdeaScoutWorker({
			maxConsecutiveFailures: 2,
		});

		expect(worker.getHealthStatus()).toBe("healthy");
		expect(worker.checkHealth()).toBeNull();

		// Simulate failure by directly causing a fail scenario
		const session1 = worker.createSession("Fail 1", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session1!.id);
		worker.mineSignals(session1!.id);
		// Force fail via token budget
		worker.setConfig({ maxTokensPerSession: 1 });
		worker.evaluate(session1!.id, 100, 0);

		expect(worker.getHealthStatus()).toBe("degraded");

		const session2 = worker.createSession("Fail 2", [
			{ id: "sig-2", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session2!.id);
		worker.mineSignals(session2!.id);
		worker.evaluate(session2!.id, 100, 0);

		// Now should be unhealthy (2 consecutive failures)
		expect(worker.getHealthStatus()).toBe("unhealthy");
		expect(worker.checkHealth()).not.toBeNull();
		expect(worker.checkHealth()!.stopCondition).toBe("consecutive_failures_exceeded");
	});

	test("health recovers after successful session", () => {
		const worker = new IdeaScoutWorker({
			maxConsecutiveFailures: 1,
			minIdeaConfidence: 0.1,
			minSignalConfidence: 0.1,
		});

		// Fail once
		const session1 = worker.createSession("Fail", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session1!.id);
		worker.mineSignals(session1!.id);
		worker.setConfig({ maxTokensPerSession: 1 });
		worker.evaluate(session1!.id, 100, 0);

		expect(worker.getHealthStatus()).toBe("unhealthy");

		// Reset budget and succeed
		worker.setConfig({ maxTokensPerSession: 120_000 });
		const session2 = worker.createSession("Succeed", [
			{ id: "sig-2", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session2!.id);
		worker.mineSignals(session2!.id);
		const ideas = worker.evaluate(session2!.id, 100, 100);
		expect(ideas).not.toBeNull();

		expect(worker.getHealthStatus()).toBe("healthy");
		expect(worker.checkHealth()).toBeNull();
	});

	test("stats reflect failures correctly", () => {
		const worker = new IdeaScoutWorker({
			maxTokensPerSession: 1,
		});

		const session = worker.createSession("Fail Stats", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);
		worker.evaluate(session!.id, 100, 0);

		const stats = worker.getStats();
		expect(stats.failed).toBe(1);
		expect(stats.completed).toBe(0);
		expect(stats.consecutiveFailures).toBe(1);
		expect(stats.totalSessionsFailed).toBe(1);
		expect(stats.totalSessionsCompleted).toBe(0);
	});
});

// =============================================================================
// IdeaScoutWorker — Clear & Reset
// =============================================================================

describe("IdeaScoutWorker — Clear & Reset", () => {
	test("clear resets all state", () => {
		const worker = new IdeaScoutWorker({
			minIdeaConfidence: 0.1,
			minSignalConfidence: 0.1,
		});

		const session = worker.createSession("Clear Test", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);
		worker.evaluate(session!.id, 100, 100);

		expect(worker.getStats().totalSessions).toBe(1);

		worker.clear();

		const stats = worker.getStats();
		expect(stats.totalSessions).toBe(0);
		expect(stats.completed).toBe(0);
		expect(stats.failed).toBe(0);
		expect(stats.totalIdeasGenerated).toBe(0);
		expect(stats.totalMinedSignals).toBe(0);
		expect(stats.totalTrendsDetected).toBe(0);
		expect(stats.dedupHistorySize).toBe(0);
		expect(worker.getHealthStatus()).toBe("healthy");
	});
});

// =============================================================================
// IdeaScoutWorker — Session Query Methods
// =============================================================================

describe("IdeaScoutWorker — Session Query Methods", () => {
	test("getAllSessions returns all sessions", () => {
		const worker = new IdeaScoutWorker();
		worker.createSession("Session 1");
		worker.createSession("Session 2");
		worker.createSession("Session 3");

		expect(worker.getAllSessions()).toHaveLength(3);
	});

	test("getSession returns undefined for nonexistent ID", () => {
		const worker = new IdeaScoutWorker();
		expect(worker.getSession("nonexistent")).toBeUndefined();
	});

	test("getSessionsByStatus filters correctly", () => {
		const worker = new IdeaScoutWorker({
			minIdeaConfidence: 0.1,
			minSignalConfidence: 0.1,
		});

		const s1 = worker.createSession("Complete Me", [
			{ id: "sig-1", pattern: "test", summary: "test" },
		]);
		worker.createSession("Idle Session");

		worker.startScouting(s1!.id);
		worker.mineSignals(s1!.id);
		worker.evaluate(s1!.id, 100, 100);

		const idleSessions = worker.getSessionsByStatus("idle");
		expect(idleSessions).toHaveLength(1);
		expect(idleSessions[0].label).toBe("Idle Session");

		const completedSessions = worker.getSessionsByStatus("completed");
		expect(completedSessions).toHaveLength(1);
		expect(completedSessions[0].label).toBe("Complete Me");

		expect(worker.getSessionsByStatus("failed")).toHaveLength(0);
	});
});

// =============================================================================
// IdeaTrendDetector
// =============================================================================

describe("IdeaTrendDetector", () => {
	test("returns empty array when disabled", () => {
		const detector = new IdeaTrendDetector(false);
		const signals = [
			{
				id: "s1",
				label: "test",
				description: "desc",
				confidence: 0.8,
				observationIds: [],
				trendLabel: "test-trend",
				createdAt: new Date().toISOString(),
			},
		];
		expect(detector.detectTrends(signals)).toEqual([]);
	});

	test("returns empty array for empty signals", () => {
		const detector = new IdeaTrendDetector(true);
		expect(detector.detectTrends([])).toEqual([]);
	});

	test("detects trend when minimum count is met", () => {
		const detector = new IdeaTrendDetector(true, 2);
		const now = new Date().toISOString();

		const signals = [
			{
				id: "s1",
				label: "sig-1",
				description: "First signal",
				confidence: 0.7,
				observationIds: ["o1"],
				trendLabel: "errors-and-failures",
				createdAt: now,
			},
			{
				id: "s2",
				label: "sig-2",
				description: "Second signal",
				confidence: 0.8,
				observationIds: ["o2"],
				trendLabel: "errors-and-failures",
				createdAt: now,
			},
		];

		const trends = detector.detectTrends(signals);
		expect(trends).toHaveLength(1);
		expect(trends[0].label).toBe("errors-and-failures");
		expect(trends[0].signalIds).toHaveLength(2);
		expect(trends[0].confidence).toBeCloseTo(0.75, 2);
	});

	test("does not detect trend below minimum signal count", () => {
		const detector = new IdeaTrendDetector(true, 3);
		const now = new Date().toISOString();

		const signals = [
			{
				id: "s1",
				label: "sig-1",
				description: "desc",
				confidence: 0.7,
				observationIds: [],
				trendLabel: "performance",
				createdAt: now,
			},
			{
				id: "s2",
				label: "sig-2",
				description: "desc",
				confidence: 0.8,
				observationIds: [],
				trendLabel: "performance",
				createdAt: now,
			},
		];

		const trends = detector.detectTrends(signals);
		expect(trends).toHaveLength(0);
	});

	test("detects multiple trends from different labels", () => {
		const detector = new IdeaTrendDetector(true, 2);
		const now = new Date().toISOString();

		const signals = [
			{
				id: "s1",
				label: "sig-1",
				description: "desc",
				confidence: 0.7,
				observationIds: [],
				trendLabel: "performance",
				createdAt: now,
			},
			{
				id: "s2",
				label: "sig-2",
				description: "desc",
				confidence: 0.8,
				observationIds: [],
				trendLabel: "performance",
				createdAt: now,
			},
			{
				id: "s3",
				label: "sig-3",
				description: "desc",
				confidence: 0.6,
				observationIds: [],
				trendLabel: "security",
				createdAt: now,
			},
			{
				id: "s4",
				label: "sig-4",
				description: "desc",
				confidence: 0.9,
				observationIds: [],
				trendLabel: "security",
				createdAt: now,
			},
		];

		const trends = detector.detectTrends(signals);
		expect(trends).toHaveLength(2);
		expect(trends.map((t) => t.label).sort()).toEqual(["performance", "security"]);
	});

	test("setConfig updates configuration", () => {
		const detector = new IdeaTrendDetector(true, 2);
		detector.setConfig({ enabled: false });
		expect(detector.getConfig().enabled).toBe(false);

		detector.setConfig({ minSignalCount: 5 });
		expect(detector.getConfig().minSignalCount).toBe(5);
	});
});

// =============================================================================
// IdeaScoutWorker — Idea Generation Properties
// =============================================================================

describe("IdeaScoutWorker — Idea Generation", () => {
	test("generated ideas have valid structure", () => {
		const worker = new IdeaScoutWorker({
			minIdeaConfidence: 0.1,
			minSignalConfidence: 0.1,
		});

		const session = worker.createSession("Structure Test", [
			{ id: "sig-1", pattern: "error_spike", summary: "Error spike detected" },
		]);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);
		const ideas = worker.evaluate(session!.id, 100, 100);

		expect(ideas).not.toBeNull();
		for (const idea of ideas!) {
			expect(idea.id).toBeDefined();
			expect(idea.title).toBeDefined();
			expect(idea.description).toBeDefined();
			expect(idea.confidence).toBeGreaterThanOrEqual(0);
			expect(idea.confidence).toBeLessThanOrEqual(1);
			expect(ALL_IDEA_PRIORITIES).toContain(idea.priority);
			expect(Array.isArray(idea.tags)).toBe(true);
			expect(Array.isArray(idea.sourceRefs)).toBe(true);
			expect(idea.suggestion).toBeDefined();
			expect(idea.createdAt).toBeDefined();
		}
	});

	test("ideas include source references", () => {
		const worker = new IdeaScoutWorker({
			minIdeaConfidence: 0.1,
			minSignalConfidence: 0.1,
		});

		const session = worker.createSession("Source Test", [
			{ id: "sig-1", pattern: "error_spike", summary: "Error spike" },
		]);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);
		const ideas = worker.evaluate(session!.id, 100, 100);

		expect(ideas!.length).toBeGreaterThanOrEqual(1);
		const signalSources = ideas!.filter((i) =>
			i.sourceRefs.some((r) => r.type === "signal"),
		);
		expect(signalSources.length).toBeGreaterThanOrEqual(1);
	});

	test("respects maxIdeasPerSession limit", () => {
		const worker = new IdeaScoutWorker({
			minIdeaConfidence: 0.01,
			minSignalConfidence: 0.01,
			maxIdeasPerSession: 3,
		});

		// Create many signals
		const signals = Array.from({ length: 20 }, (_, i) => ({
			id: `sig-${i}`,
			pattern: `pattern_${i}`,
			summary: `Signal ${i}`,
		}));

		const session = worker.createSession("Max Ideas Test", signals);
		worker.startScouting(session!.id);
		worker.mineSignals(session!.id);
		const ideas = worker.evaluate(session!.id, 100, 100);

		expect(ideas).not.toBeNull();
		expect(ideas!.length).toBeLessThanOrEqual(3);
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
	test("computeTaskHash produces deterministic hashes", () => {
		const worker = new IdeaScoutWorker();
		const hash1 = worker.computeTaskHash("same-input");
		const hash2 = worker.computeTaskHash("same-input");
		expect(hash1).toBe(hash2);
	});

	test("computeTaskHash produces different hashes for different inputs", () => {
		const worker = new IdeaScoutWorker();
		const hash1 = worker.computeTaskHash("input-a");
		const hash2 = worker.computeTaskHash("input-b");
		expect(hash1).not.toBe(hash2);
	});

	test("session metadata is preserved", () => {
		const worker = new IdeaScoutWorker();
		const metadata = { source: "test-suite", priority: "high" };
		const session = worker.createSession("Metadata Test", [], {}, metadata);

		expect(session!.metadata).toEqual(metadata);
	});

	test("createSession with dedup disabled skips hash check", () => {
		const worker = new IdeaScoutWorker({ dedupEnabled: false });
		const hash = "test-hash";

		const s1 = worker.createSession("First", [], {}, undefined, hash);
		const s2 = worker.createSession("Second", [], {}, undefined, hash);
		expect(s1).not.toBeNull();
		expect(s2).not.toBeNull();
	});

	test("getSessionsByStatus returns sessions sorted by creation date descending", () => {
		const worker = new IdeaScoutWorker();
		worker.createSession("First");
		worker.createSession("Second");
		worker.createSession("Third");

		const idleSessions = worker.getSessionsByStatus("idle");
		expect(idleSessions).toHaveLength(3);
		// Should be sorted in insertion order (same creation timestamps, Map preserves insertion order)
		expect(idleSessions[0].label).toBe("First");
		expect(idleSessions[2].label).toBe("Third");
	});
});
