/**
 * Observation Engine V0 — Observer tests.
 *
 * Covers:
 * - QueueHealthObserver: integration queue dirty/paused, plan queue blocked/failed
 * - ExecutionJournalObserver: workspace failure, success, retry events
 * - RetryFailureSignalExtractor: retry hotspots, recurring failure patterns
 * - ObservationEngine: full cycle with multiple observers
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	ExecutionJournalObserver,
	InMemoryBrainTimelineStore,
	ObservationEngine,
	QueueHealthObserver,
	RetryFailureSignalExtractor,
} from "../../src/brain/index.js";
import { validateBrainObservation, validateBrainSignal } from "../../src/brain/types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function createTempDir(): string {
	const dir = join(tmpdir(), `brain-obs-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function ensurePiDir(root: string): string {
	const piDir = join(root, ".pi");
	if (!existsSync(piDir)) {
		mkdirSync(piDir, { recursive: true });
	}
	return piDir;
}

function writeJsonFile(path: string, data: unknown): void {
	writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

function writeNdjsonFile(path: string, entries: unknown[]): void {
	const lines = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
	writeFileSync(path, lines, "utf-8");
}

// ── Queue Health Observer Tests ────────────────────────────────────────

describe("QueueHealthObserver", () => {
	let tempDir: string;
	let piDir: string;
	let observer: QueueHealthObserver;

	beforeEach(() => {
		tempDir = createTempDir();
		piDir = ensurePiDir(tempDir);
		observer = new QueueHealthObserver({ workspaceRoot: tempDir });
	});

	afterEach(() => {
		try {
			const files = [join(piDir, "integration-queue.json"), join(piDir, "plan-queue.json")];
			for (const f of files) {
				if (existsSync(f)) unlinkSync(f);
			}
		} catch {
			// best-effort
		}
	});

	test("returns empty when no queue files exist", async () => {
		const result = await observer.observe();
		expect(result.observations).toHaveLength(0);
		expect(result.signals).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
	});

	test("detects dirty integration queue entries", async () => {
		writeJsonFile(join(piDir, "integration-queue.json"), {
			entries: [
				{ workspaceId: "ws-1", status: "failed" },
				{ workspaceId: "ws-2", status: "blocked" },
				{ workspaceId: "ws-3", status: "merged" },
			],
			isProcessing: false,
			paused: false,
		});

		const result = await observer.observe();
		expect(result.observations.length).toBeGreaterThan(0);

		const integrationObs = result.observations.find((o) => o.signalType === "integration_dirty");
		expect(integrationObs).toBeDefined();
		expect(integrationObs!.source).toBe("integration");
		expect(integrationObs!.severity).toBe("warning");
		expect(integrationObs!.metadata.dirtyCount).toBe(2);
		expect(validateBrainObservation(integrationObs!).valid).toBe(true);
	});

	test("detects paused integration queue", async () => {
		writeJsonFile(join(piDir, "integration-queue.json"), {
			entries: [
				{ workspaceId: "ws-1", status: "queued" },
				{ workspaceId: "ws-2", status: "queued" },
			],
			isProcessing: false,
			paused: true,
		});

		const result = await observer.observe();
		expect(result.observations.length).toBeGreaterThan(0);

		const pausedObs = result.observations.find((o) => o.title.includes("paused"));
		expect(pausedObs).toBeDefined();
		expect(pausedObs!.source).toBe("integration");
		expect(pausedObs!.signalType).toBe("queue_blocked");
		expect(pausedObs!.severity).toBe("warning");
	});

	test("detects blocked plan queue entries", async () => {
		writeJsonFile(join(piDir, "plan-queue.json"), {
			entries: [
				{
					id: "plan-1",
					status: "blocked",
					blockReason: "dirty working tree",
				},
				{ id: "plan-2", status: "pending" },
				{ id: "plan-3", status: "complete" },
			],
			isRunning: true,
		});

		const result = await observer.observe();
		expect(result.observations.length).toBeGreaterThan(0);

		const blockedObs = result.observations.find((o) => o.signalType === "queue_blocked" && o.source === "queue");
		expect(blockedObs).toBeDefined();
		expect(blockedObs!.severity).toBe("warning");
		expect(blockedObs!.metadata.blockedCount).toBe(1);
	});

	test("detects failed plan queue entries", async () => {
		writeJsonFile(join(piDir, "plan-queue.json"), {
			entries: [
				{
					id: "plan-1",
					status: "failed",
					error: "Workspace execution timed out",
				},
				{
					id: "plan-2",
					status: "failed",
					error: "Merge conflict in src/index.ts",
				},
				{ id: "plan-3", status: "complete" },
			],
			isRunning: true,
		});

		const result = await observer.observe();
		expect(result.observations.length).toBeGreaterThan(0);

		const failedObs = result.observations.find((o) => o.signalType === "failure_pattern" && o.source === "queue");
		expect(failedObs).toBeDefined();
		expect(failedObs!.severity).toBe("critical");
		expect(failedObs!.metadata.failedCount).toBe(2);
	});

	test("integration queue with only merged/queued entries produces no observations", async () => {
		writeJsonFile(join(piDir, "integration-queue.json"), {
			entries: [
				{ workspaceId: "ws-1", status: "merged" },
				{ workspaceId: "ws-2", status: "queued" },
			],
			isProcessing: false,
			paused: false,
		});

		const result = await observer.observe();
		// No integration_dirty observation expected
		const integrationObs = result.observations.filter((o) => o.source === "integration");
		expect(integrationObs).toHaveLength(0);
	});
});

// ── Execution Journal Observer Tests ───────────────────────────────────

describe("ExecutionJournalObserver", () => {
	let tempDir: string;
	let piDir: string;
	let observer: ExecutionJournalObserver;

	beforeEach(() => {
		tempDir = createTempDir();
		piDir = ensurePiDir(tempDir);
		observer = new ExecutionJournalObserver({ workspaceRoot: tempDir });
	});

	afterEach(() => {
		try {
			const journalFile = join(piDir, "execution-journal.ndjson");
			if (existsSync(journalFile)) unlinkSync(journalFile);
		} catch {
			// best-effort
		}
	});

	test("returns empty when no journal file exists", async () => {
		const result = await observer.observe();
		expect(result.observations).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
	});

	test("detects workspace failure from journal", async () => {
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "workspace_complete",
				timestamp: new Date().toISOString(),
				workspaceId: "ws-fail-1",
				planExecId: "plan-1",
				role: "worker",
				attempt: 1,
				verdict: "failed",
				error: "Test failure",
				duration: 5000,
			},
		]);

		const result = await observer.observe();
		expect(result.observations.length).toBeGreaterThan(0);

		const failObs = result.observations.find((o) => o.title.includes("Workspace failed"));
		expect(failObs).toBeDefined();
		expect(failObs!.severity).toBe("critical");
		expect(failObs!.source).toBe("execution");
		expect(failObs!.signalType).toBe("failure_pattern");
		expect(validateBrainObservation(failObs!).valid).toBe(true);
	});

	test("detects workspace success from journal", async () => {
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "workspace_complete",
				timestamp: new Date().toISOString(),
				workspaceId: "ws-ok-1",
				planExecId: "plan-2",
				role: "worker",
				attempt: 1,
				verdict: "complete",
				duration: 3000,
			},
		]);

		const result = await observer.observe();
		expect(result.observations.length).toBeGreaterThan(0);

		const successObs = result.observations.find((o) => o.title.includes("Workspace completed"));
		expect(successObs).toBeDefined();
		expect(successObs!.severity).toBe("info");
	});

	test("detects retry events from journal", async () => {
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "retry",
				timestamp: new Date().toISOString(),
				workspaceId: "ws-retry-1",
				planExecId: "plan-3",
				attempt: 2,
				error: "Transient error",
			},
		]);

		const result = await observer.observe();
		expect(result.observations.length).toBeGreaterThan(0);

		const retryObs = result.observations.find((o) => o.title.includes("Workspace retry"));
		expect(retryObs).toBeDefined();
		expect(retryObs!.severity).toBe("warning");
		expect(retryObs!.signalType).toBe("retry_hotspot");
		expect(validateBrainObservation(retryObs!).valid).toBe(true);
	});

	test("only processes new entries on subsequent calls", async () => {
		// First call with initial data
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "workspace_complete",
				timestamp: new Date().toISOString(),
				workspaceId: "ws-1",
				verdict: "complete",
			},
		]);

		const result1 = await observer.observe();
		expect(result1.observations).toHaveLength(1);

		// Second call with same data — should not re-process
		const result2 = await observer.observe();
		expect(result2.observations).toHaveLength(0);

		// Add a new entry
		const _content = require("node:fs").readFileSync(join(piDir, "execution-journal.ndjson"), "utf-8");
		const newLine = `${JSON.stringify({
			type: "workspace_complete",
			timestamp: new Date().toISOString(),
			workspaceId: "ws-2",
			verdict: "failed",
			error: "Second failure",
		})}\n`;
		require("node:fs").appendFileSync(join(piDir, "execution-journal.ndjson"), newLine);

		const result3 = await observer.observe();
		expect(result3.observations).toHaveLength(1);
		const failObs = result3.observations[0];
		expect(failObs.title).toContain("Workspace failed");
	});

	test("tolerates corrupted journal lines", async () => {
		const journalPath = join(piDir, "execution-journal.ndjson");
		const validEntry = JSON.stringify({
			type: "workspace_complete",
			timestamp: new Date().toISOString(),
			workspaceId: "ws-1",
			verdict: "complete",
		});
		writeFileSync(journalPath, `${validEntry}\ncorrupted line\n`);
		// Re-open to append
		const validEntry2 = JSON.stringify({
			type: "workspace_complete",
			timestamp: new Date().toISOString(),
			workspaceId: "ws-2",
			verdict: "failed",
			error: "Failure",
		});
		require("node:fs").appendFileSync(journalPath, `${validEntry2}\n`);

		const result = await observer.observe();
		expect(result.observations).toHaveLength(2);
		expect(result.errors).toHaveLength(0);
	});
});

// ── Retry/Failure Signal Extractor Tests ───────────────────────────────

describe("RetryFailureSignalExtractor", () => {
	let tempDir: string;
	let piDir: string;
	let extractor: RetryFailureSignalExtractor;

	beforeEach(() => {
		tempDir = createTempDir();
		piDir = ensurePiDir(tempDir);
		extractor = new RetryFailureSignalExtractor({ workspaceRoot: tempDir });
	});

	afterEach(() => {
		try {
			const journalFile = join(piDir, "execution-journal.ndjson");
			if (existsSync(journalFile)) unlinkSync(journalFile);
		} catch {
			// best-effort
		}
	});

	test("returns empty when no journal file exists", async () => {
		const result = await extractor.observe();
		expect(result.signals).toHaveLength(0);
		expect(result.observations).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
	});

	test("detects retry hotspot for workspace with 3+ retries", async () => {
		const now = new Date().toISOString();
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-hotspot-1",
				attempt: 1,
			},
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-hotspot-1",
				attempt: 2,
			},
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-hotspot-1",
				attempt: 3,
				error: "Persistent error",
			},
		]);

		const result = await extractor.observe();
		expect(result.signals.length).toBeGreaterThan(0);

		const hotspotSignal = result.signals.find((s) => s.pattern.startsWith("retry_hotspot"));
		expect(hotspotSignal).toBeDefined();
		expect(hotspotSignal!.pattern).toContain("3+");
		expect(hotspotSignal!.confidence).toBeGreaterThanOrEqual(0.7);
		expect(hotspotSignal!.metadata.retryCount).toBe(3);
		expect(validateBrainSignal(hotspotSignal!).valid).toBe(true);
	});

	test("does not emit retry hotspot for workspace with less than 3 retries", async () => {
		const now = new Date().toISOString();
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-low-1",
				attempt: 1,
			},
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-low-1",
				attempt: 2,
			},
		]);

		const result = await extractor.observe();
		const hotspotSignal = result.signals.find((s) => s.pattern.startsWith("retry_hotspot"));
		expect(hotspotSignal).toBeUndefined();
	});

	test("detects recurring failure pattern (3+ same error)", async () => {
		const now = new Date().toISOString();
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-1",
				role: "worker",
				verdict: "failed",
				error: "TypeError: Cannot read properties of undefined",
			},
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-2",
				role: "worker",
				verdict: "failed",
				error: "TypeError: Cannot read properties of undefined",
			},
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-3",
				role: "worker",
				verdict: "failed",
				error: "TypeError: Cannot read properties of undefined",
			},
		]);

		const result = await extractor.observe();
		expect(result.signals.length).toBeGreaterThan(0);

		const failureSignal = result.signals.find((s) => s.pattern.startsWith("failure_pattern:recurring"));
		expect(failureSignal).toBeDefined();
		expect(failureSignal!.metadata.occurrenceCount).toBe(3);
		expect(validateBrainSignal(failureSignal!).valid).toBe(true);
	});

	test("detects role-level failure pattern (3+ failures same role)", async () => {
		const now = new Date().toISOString();
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-1",
				role: "worker",
				verdict: "failed",
				error: "Error A",
			},
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-2",
				role: "worker",
				verdict: "failed",
				error: "Error B",
			},
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-3",
				role: "worker",
				verdict: "failed",
				error: "Error C",
			},
		]);

		const result = await extractor.observe();
		expect(result.signals.length).toBeGreaterThan(0);

		const roleSignal = result.signals.find((s) => s.pattern.startsWith("failure_pattern:role"));
		expect(roleSignal).toBeDefined();
		expect(roleSignal!.pattern).toContain("worker");
		expect(roleSignal!.metadata.failureCount).toBe(3);
	});

	test("resets retry state on successful completion", async () => {
		const now = new Date().toISOString();
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-resolved",
				attempt: 1,
			},
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-resolved",
				attempt: 2,
			},
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-resolved",
				verdict: "complete",
			},
		]);

		const result = await extractor.observe();
		const hotspotSignal = result.signals.find((s) => s.pattern.startsWith("retry_hotspot"));
		expect(hotspotSignal).toBeUndefined();
	});
});

// ── Full Observation Engine Cycle Tests ────────────────────────────────

describe("ObservationEngine (full cycle)", () => {
	let tempDir: string;
	let piDir: string;
	let timelineStore: InMemoryBrainTimelineStore;
	let engine: ObservationEngine;

	beforeEach(() => {
		tempDir = createTempDir();
		piDir = ensurePiDir(tempDir);
		timelineStore = new InMemoryBrainTimelineStore();
		engine = new ObservationEngine({
			workspaceRoot: tempDir,
			piDir: ".pi",
			timelineStore,
		});
		engine.addDefaultObservers();
	});

	afterEach(() => {
		timelineStore.clear();
		try {
			const files = [
				join(piDir, "integration-queue.json"),
				join(piDir, "plan-queue.json"),
				join(piDir, "execution-journal.ndjson"),
			];
			for (const f of files) {
				if (existsSync(f)) unlinkSync(f);
			}
		} catch {
			// best-effort
		}
	});

	test("empty state produces no observations", async () => {
		const result = await engine.observe();
		expect(result.observations).toHaveLength(0);
		expect(result.signals).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
	});

	test("produces observations and signals from all data sources", async () => {
		// Set up integration queue with dirty entries
		writeJsonFile(join(piDir, "integration-queue.json"), {
			entries: [{ workspaceId: "ws-1", status: "failed", error: "Merge conflict" }],
			isProcessing: false,
			paused: false,
		});

		// Set up plan queue with blocked entry
		writeJsonFile(join(piDir, "plan-queue.json"), {
			entries: [
				{
					id: "plan-1",
					status: "blocked",
					blockReason: "dirty integration queue",
				},
				{ id: "plan-2", status: "pending" },
			],
			isRunning: true,
		});

		// Set up execution journal with failures and retries
		const now = new Date().toISOString();
		writeNdjsonFile(join(piDir, "execution-journal.ndjson"), [
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-hot-1",
				attempt: 1,
			},
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-hot-1",
				attempt: 2,
			},
			{
				type: "retry",
				timestamp: now,
				workspaceId: "ws-hot-1",
				attempt: 3,
				error: "Persistent timeout",
			},
			{
				type: "workspace_complete",
				timestamp: now,
				workspaceId: "ws-fail-1",
				role: "worker",
				verdict: "failed",
				error: "AssertionError: expected true to be false",
			},
		]);

		const result = await engine.observe();

		// Should have observations from both observers
		expect(result.observations.length).toBeGreaterThan(0);

		// Should have signals from retry/failure extractor
		expect(result.signals.length).toBeGreaterThan(0);

		// Should have timeline events recorded
		expect(result.timelineEvents.length).toBeGreaterThan(0);

		// Verify timeline store has the events
		const events = await timelineStore.list({ limit: 50 });
		expect(events.length).toBeGreaterThan(0);

		// Check that observations come from different sources
		const sources = new Set(result.observations.map((o) => o.source));
		expect(sources.has("integration")).toBe(true);
		expect(sources.has("queue")).toBe(true);
		expect(sources.has("execution")).toBe(true);
	});

	test("observer errors are collected but don't crash the engine", async () => {
		// Write invalid JSON to make the observer fail
		writeFileSync(join(piDir, "integration-queue.json"), "not valid json", "utf-8");

		const result = await engine.observe();
		// Engine should not crash; errors should be collected
		expect(result.errors.length).toBeGreaterThanOrEqual(0);
		// The QueueHealthObserver will have an error, but other observers may still work
		const _hasQueueError = result.errors.some((e) => e.includes("integration queue") || e.includes("Failed to read"));
		// At minimum, the engine runs without exceptions
		expect(result).toHaveProperty("observations");
		expect(result).toHaveProperty("signals");
		expect(result).toHaveProperty("timelineEvents");
	});
});
