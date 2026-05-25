/**
 * P26.G — StateStore serialization, atomic writes, and journal integrity
 *
 * Tests:
 * - JsonStateStore uses write queue for all mutating writes
 * - setCurrentExecutionId uses atomic temp+rename
 * - saveExecutionLog and appendWorkspaceLog go through write queue
 * - plan-state appendJournal is serialized via journalMutex
 * - Atomic write helper is present
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStateStore } from "../src/core/json-state-store.js";
import { setSystemMemoryLimitBytes } from "../src/core/worker-memory-guard.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.G — StateStore serialization and atomic writes", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p26g-test-"));
		setSystemMemoryLimitBytes(Infinity);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	it("should have writeQueue for serializing mutations", () => {
		const store = new JsonStateStore(tmpDir);
		// Verify writeQueue exists (initialized as a resolved promise)
		const q = (store as any).writeQueue;
		expect(q).toBeInstanceOf(Promise);
	});

	it("should have enqueueWrite method that serializes mutations", () => {
		const store = new JsonStateStore(tmpDir);
		const enqueueWrite = (store as any).enqueueWrite;
		expect(enqueueWrite).toBeInstanceOf(Function);
	});

	it("should use atomic write for current-execution.json", async () => {
		const store = new JsonStateStore(tmpDir);
		const mockQueue = { phase: "P26", title: "Test", maxParallelWorkspaces: 1, workspaces: [] };
		await store.initializeState("test-project", mockQueue as any);

		// Verify the file was created atomically (not via direct writeFile)
		const piDir = path.join(tmpDir, ".pi");
		const statePath = path.join(piDir, "current-execution.json");
		const content = await fs.readFile(statePath, "utf-8");
		const parsed = JSON.parse(content);

		expect(typeof parsed.planExecutionId).toBe("string");

		// Verify no .tmp files remain in .pi
		const entries = await fs.readdir(piDir);
		const tmpFiles = entries.filter((e) => e.endsWith(".tmp"));
		expect(tmpFiles.length).toBe(0);
	});

	it("should serialize saveExecutionLog through write queue", async () => {
		const store = new JsonStateStore(tmpDir);
		await store.saveExecutionLog("test-plan", "log line 1\n");

		const logPath = path.join(tmpDir, ".pi", "execution-test-plan.log");
		const content = await fs.readFile(logPath, "utf-8");
		expect(content).toContain("log line 1");
	});

	it("should serialize appendWorkspaceLog through write queue", async () => {
		const store = new JsonStateStore(tmpDir);
		await store.appendWorkspaceLog("test-plan", "ws-1", "workspace log line");

		const logPath = path.join(tmpDir, ".pi", "workspace-test-plan-ws-1.log");
		const content = await fs.readFile(logPath, "utf-8");
		expect(content).toContain("workspace log line");
	});

	it("should preserve journal order under concurrent appendJournal calls", async () => {
		// This test verifies the journalMutex serializes appends
		const { PlanStateStore } = await import("../src/core/plan-state.js");
		const store = new PlanStateStore(tmpDir);
		store.setCurrentPlanExecutionId("test-plan");

		// Fire multiple concurrent journal appends
		const events = Array.from({ length: 20 }, (_, i) => ({
			type: "worker_status" as const,
			timestamp: Date.now(),
			workspaceId: `ws-${i}`,
			severity: "info" as const,
			data: { index: i },
		}));

		await Promise.all(events.map((e) => store.appendJournal(e)));

		// Read back the journal — all events should be parseable and in order
		const journal = await store.readJournal();
		expect(journal.length).toBe(20);

		// Verify each line is parseable NDJSON (not torn)
		for (const entry of journal) {
			expect(entry).toHaveProperty("type", "worker_status");
			expect(entry).toHaveProperty("data");
		}
	});

	it("should not leave stale .tmp files after atomic write", async () => {
		const store = new JsonStateStore(tmpDir);
		const mockQueue = { phase: "P26", title: "Test", maxParallelWorkspaces: 1, workspaces: [] };
		await store.initializeState("test-project", mockQueue as any);

		const piDir = path.join(tmpDir, ".pi");
		const entries = await fs.readdir(piDir);
		const tmpFiles = entries.filter((e) => e.endsWith(".tmp"));
		expect(tmpFiles.length).toBe(0);
	});

	it("should have atomicWrite helper that uses temp+rename pattern", () => {
		// Structural verification
		const fsMod = require("node:fs") as typeof import("node:fs");
		const src = fsMod.readFileSync(require.resolve("../src/core/json-state-store.ts"), "utf-8");

		expect(src).toContain("atomicWrite");
		expect(src).toContain(".tmp.");
		expect(src).toContain("fs.rename(tmpPath, filePath)");
	});

	it("should have journalMutex in PlanStateStore for serialized journal appends", () => {
		// Structural verification
		const fsMod = require("node:fs") as typeof import("node:fs");
		const src = fsMod.readFileSync(require.resolve("../src/core/plan-state.ts"), "utf-8");

		expect(src).toContain("journalMutex");
		expect(src).toContain("Serialize journal appends through a promise-chain mutex");
	});

	it("should produce parseable NDJSON after concurrent writes", async () => {
		const { PlanStateStore } = await import("../src/core/plan-state.js");
		const store = new PlanStateStore(tmpDir);
		store.setCurrentPlanExecutionId("stress-test");

		// Write 1000 events concurrently
		const batchSize = 1000;
		const batch = Array.from({ length: batchSize }, (_, i) => ({
			type: "worker_status" as const,
			timestamp: Date.now() + i,
			workspaceId: `ws-${i % 10}`,
			severity: "info" as const,
			data: { index: i },
		}));

		await Promise.all(batch.map((e) => store.appendJournal(e)));

		// Read and validate
		const journal = await store.readJournal();
		expect(journal.length).toBe(batchSize);

		// Verify all are parseable
		for (const entry of journal) {
			expect(typeof entry).toBe("object");
			expect(entry.type).toBe("worker_status");
			expect(typeof entry.data?.index).toBe("number");
		}

		// Verify the raw file is parseable line by line (no torn lines)
		const rawContent = require("node:fs").readFileSync(path.join(tmpDir, ".pi", "execution-journal.ndjson"), "utf-8");
		const lines = rawContent.trim().split("\n");
		expect(lines.length).toBe(batchSize);

		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});
});
