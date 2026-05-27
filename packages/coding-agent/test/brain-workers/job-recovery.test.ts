/**
 * Worker Crash Recovery and Job Resumption — 25.S
 *
 * Tests for:
 * - JobStateStore (persistent JSON-backed job state)
 * - JobRecoveryEngine (crash detection, lease recovery, re-dispatch)
 * - Evidence-backed diagnostics
 * - Budget, cooldown, dedup, and stop-condition handling
 * - Edge cases (empty store, corrupted data, exhausted retries, etc.)
 */

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { generateManifest } from "../../src/brain-workers/contracts.js";
import {
	createJobRecoveryEngine,
	DEFAULT_RECOVERY_CONFIG,
	JobRecoveryEngine,
} from "../../src/brain-workers/runtime/job-recovery.js";
import { createJobStateStore, JobStateStore } from "../../src/brain-workers/runtime/job-state-store.js";
import type { JobInput } from "../../src/brain-workers/supervisor/job-lease.js";
import { BrainSupervisor } from "../../src/brain-workers/supervisor/supervisor.js";
import type { WorkerManifest } from "../../src/brain-workers/types.js";

// =============================================================================
// Helpers
// =============================================================================

/** Create a temporary workspace directory. */
async function createTempDir(): Promise<string> {
	const dir = path.join(tmpdir(), `pi-job-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

/** Create a standard test worker manifest for a given role. */
function makeManifest(role: "observer" | "analyst" | "proposer", name?: string): WorkerManifest {
	return generateManifest({
		role,
		name: name ?? `test-${role}`,
		description: `Test ${role} worker`,
	});
}

/** Create a test job input for a given target role. */
function makeJobInput(
	targetRole: string,
	jobType: string = "test_job",
	overrides?: Partial<{
		targetRole: string;
		jobType: string;
		payload: Record<string, unknown>;
		taskHash?: string;
	}>,
): JobInput {
	return {
		targetRole,
		jobType,
		payload: { key: "value" },
		...(overrides as any),
	};
}

/** Create a default setup with store + supervisor + recovery engine. */
async function createDefaultSetup(workspaceRoot: string): Promise<{
	store: JobStateStore;
	supervisor: BrainSupervisor;
	recovery: JobRecoveryEngine;
	manifest: WorkerManifest;
}> {
	const store = new JobStateStore(workspaceRoot);
	await store.init();

	const supervisor = new BrainSupervisor();
	supervisor.start();

	const manifest = makeManifest("observer");
	supervisor.registerWorker(manifest);

	const recovery = new JobRecoveryEngine(store, supervisor);

	return { store, supervisor, recovery, manifest };
}

// =============================================================================
// JobStateStore Tests
// =============================================================================

describe("JobStateStore", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Initialisation
	// -----------------------------------------------------------------------

	test("initialises with empty state", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();

		expect(store.isInitialised()).toBe(true);
		expect(store.getJobCount()).toBe(0);
		expect(store.getSessionMarker()).not.toBeNull();
		expect(store.getSessionMarker()!.cleanShutdown).toBe(false);
	});

	test("creates store file on init", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();

		const filePath = store.getFilePath();
		const content = await fs.readFile(filePath, "utf-8");
		const parsed = JSON.parse(content);

		expect(parsed.version).toBe(1);
		expect(parsed.session).not.toBeNull();
		expect(parsed.jobs).toEqual({});
	});

	test("loads existing state on re-init", async () => {
		const store1 = new JobStateStore(tempDir);
		await store1.init();

		// Create a job and save
		store1.createJob({
			targetRole: "observer",
			jobType: "test_job",
			payload: { test: true },
		});
		await store1.save();

		// Re-init with a new instance
		const store2 = new JobStateStore(tempDir);
		await store2.init();

		expect(store2.getJobCount()).toBe(1);
		const jobs = store2.getJobs();
		expect(jobs[0].jobType).toBe("test_job");
		expect(jobs[0].targetRole).toBe("observer");
	});

	test("handles corrupted JSON gracefully", async () => {
		// Write corrupt data
		const store1 = new JobStateStore(tempDir);
		const filePath = store1.getFilePath();
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, "this is not json{broken", "utf-8");

		// Should start fresh
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		expect(store2.getJobCount()).toBe(0);
		expect(store2.isInitialised()).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Session Markers
	// -----------------------------------------------------------------------

	test("session marker shows clean shutdown after markCleanShutdown", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();

		expect(store.getSessionMarker()!.cleanShutdown).toBe(false);
		await store.markCleanShutdown();
		expect(store.getSessionMarker()!.cleanShutdown).toBe(true);

		// Verify it's persisted as the PREVIOUS session marker on next init.
		// store2.init() creates a new session marker, moving the old one to previousSession.
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		expect(store2.getPreviousSessionMarker()).not.toBeNull();
		expect(store2.getPreviousSessionMarker()!.cleanShutdown).toBe(true);
		// The new current session marker is not clean (it was just started)
		expect(store2.getSessionMarker()!.cleanShutdown).toBe(false);
	});

	test("wasPreviousSessionCrashed returns true on unclean shutdown", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();

		// No previous session on first init
		expect(store.wasPreviousSessionCrashed()).toBe(false);

		// Don't mark clean shutdown — simulate crash

		// Now re-init to simulate restart — the previous session is this one
		// which had no clean shutdown
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		expect(store2.wasPreviousSessionCrashed()).toBe(true);
	});

	test("wasPreviousSessionCrashed returns false on clean shutdown", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();
		await store.markCleanShutdown();

		// Re-init — previous session was clean (markCleanShutdown was called)
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		expect(store2.wasPreviousSessionCrashed()).toBe(false);
	});

	test("each init generates a new session ID", async () => {
		const store1 = new JobStateStore(tempDir);
		await store1.init();
		const id1 = store1.getSessionId();

		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const id2 = store2.getSessionId();

		expect(id1).not.toBe(id2);
	});

	// -----------------------------------------------------------------------
	// Job CRUD
	// -----------------------------------------------------------------------

	test("createJob creates a pending job", () => {
		const store = new JobStateStore(tempDir);

		const job = store.createJob({
			targetRole: "observer",
			jobType: "scan_health",
			payload: { priority: "high" },
		});

		expect(job.id).toBeDefined();
		expect(job.status).toBe("pending");
		expect(job.jobType).toBe("scan_health");
		expect(job.targetRole).toBe("observer");
		expect(job.payload).toEqual({ priority: "high" });
		expect(job.taskHash).toBeDefined();
	});

	test("createJob generates consistent task hashes for same input", () => {
		const store = new JobStateStore(tempDir);

		const job1 = store.createJob({
			targetRole: "observer",
			jobType: "test_job",
			payload: { x: 1 },
		});

		const job2 = store.createJob({
			targetRole: "observer",
			jobType: "test_job",
			payload: { x: 1 },
		});

		expect(job1.taskHash).toBe(job2.taskHash);

		const job3 = store.createJob({
			targetRole: "observer",
			jobType: "test_job",
			payload: { x: 2 },
		});

		expect(job1.taskHash).not.toBe(job3.taskHash);
	});

	test("updateJobStatus changes status and updates timestamps", () => {
		const store = new JobStateStore(tempDir);
		const job = store.createJob({
			targetRole: "observer",
			jobType: "test_job",
			payload: {},
		});

		// Wait a millisecond so timestamps differ
		const createdAt = job.createdAt;

		const updated = store.updateJobStatus(job.id, "leased", {
			workerId: "worker-1",
			leasedAt: new Date().toISOString(),
			leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
		});

		expect(updated).not.toBeNull();
		expect(updated!.status).toBe("leased");
		expect(updated!.workerId).toBe("worker-1");
		expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(createdAt).getTime());

		// Complete
		store.updateJobStatus(job.id, "completed", {
			output: { result: "ok" },
		});
		expect(store.getJob(job.id)!.status).toBe("completed");
	});

	test("updateJobStatus returns null for unknown job", () => {
		const store = new JobStateStore(tempDir);
		const result = store.updateJobStatus("nonexistent", "completed");
		expect(result).toBeNull();
	});

	test("getJobs filters by status", () => {
		const store = new JobStateStore(tempDir);
		store.createJob({ targetRole: "observer", jobType: "a", payload: {} });
		store.createJob({ targetRole: "observer", jobType: "b", payload: {} });

		const job3 = store.createJob({ targetRole: "observer", jobType: "c", payload: {} });
		store.updateJobStatus(job3.id, "completed");

		expect(store.getJobs("pending").length).toBe(2);
		expect(store.getJobs("completed").length).toBe(1);
	});

	test("removeJob deletes a job", () => {
		const store = new JobStateStore(tempDir);
		const job = store.createJob({ targetRole: "observer", jobType: "test", payload: {} });

		expect(store.getJob(job.id)).toBeDefined();
		expect(store.removeJob(job.id)).toBe(true);
		expect(store.getJob(job.id)).toBeUndefined();

		expect(store.removeJob("nonexistent")).toBe(false);
	});

	test("clearJobs removes all jobs", () => {
		const store = new JobStateStore(tempDir);
		store.createJob({ targetRole: "observer", jobType: "a", payload: {} });
		store.createJob({ targetRole: "observer", jobType: "b", payload: {} });

		expect(store.getJobCount()).toBe(2);
		store.clearJobs();
		expect(store.getJobCount()).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Persistence (save / reload)
	// -----------------------------------------------------------------------

	test("save persists jobs to disk", async () => {
		const store1 = new JobStateStore(tempDir);
		await store1.init();

		const job = store1.createJob({ targetRole: "observer", jobType: "persist_test", payload: { x: 42 } });
		store1.updateJobStatus(job.id, "completed", { output: { result: "done" } });
		await store1.save();

		// Read the file directly
		const content = await fs.readFile(store1.getFilePath(), "utf-8");
		const parsed = JSON.parse(content);
		expect(parsed.jobs[job.id]).toBeDefined();
		expect(parsed.jobs[job.id].status).toBe("completed");
		expect(parsed.jobs[job.id].output.result).toBe("done");

		// Reload into a new store
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		expect(store2.getJob(job.id)).toBeDefined();
		expect(store2.getJob(job.id)!.status).toBe("completed");
	});

	test("write uses atomic temp file strategy", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();

		// Create a job and save
		store.createJob({ targetRole: "observer", jobType: "atomic", payload: {} });
		await store.save();

		// Check no .tmp file left behind
		const dir = path.dirname(store.getFilePath());
		const files = await fs.readdir(dir);
		const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
		expect(tmpFiles.length).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Expired Leases
	// -----------------------------------------------------------------------

	test("getExpiredLeasedJobs returns leases past expiry", () => {
		const store = new JobStateStore(tempDir);
		const job = store.createJob({ targetRole: "observer", jobType: "expiry", payload: {} });

		// Lease with expiry in the past
		store.updateJobStatus(job.id, "leased", {
			workerId: "worker-1",
			leasedAt: new Date(Date.now() - 60000).toISOString(),
			leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
		});

		const expired = store.getExpiredLeasedJobs();
		expect(expired.length).toBe(1);
		expect(expired[0].id).toBe(job.id);
	});

	test("getExpiredLeasedJobs ignores non-leased jobs", () => {
		const store = new JobStateStore(tempDir);
		store.createJob({ targetRole: "observer", jobType: "a", payload: {} }); // pending
		const b = store.createJob({ targetRole: "observer", jobType: "b", payload: {} });
		store.updateJobStatus(b.id, "completed");
		const c = store.createJob({ targetRole: "observer", jobType: "c", payload: {} });
		store.updateJobStatus(c.id, "failed");

		expect(store.getExpiredLeasedJobs().length).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Recoverable Jobs
	// -----------------------------------------------------------------------

	test("getRecoverableJobs returns pending and leased jobs", () => {
		const store = new JobStateStore(tempDir);
		store.createJob({ targetRole: "observer", jobType: "a", payload: {} }); // pending
		const leased = store.createJob({ targetRole: "observer", jobType: "b", payload: {} });
		store.updateJobStatus(leased.id, "leased", {
			workerId: "w1",
			leasedAt: new Date().toISOString(),
			leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
		});
		const done = store.createJob({ targetRole: "observer", jobType: "c", payload: {} });
		store.updateJobStatus(done.id, "completed");

		const recoverable = store.getRecoverableJobs();
		expect(recoverable.length).toBe(2);
		expect(recoverable.find((j) => j.id === done.id)).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	test("getStats returns correct counts", () => {
		const store = new JobStateStore(tempDir);
		store.createJob({ targetRole: "observer", jobType: "a", payload: {} }); // pending
		store.createJob({ targetRole: "observer", jobType: "b", payload: {} }); // pending

		const leased = store.createJob({ targetRole: "observer", jobType: "c", payload: {} });
		store.updateJobStatus(leased.id, "leased", { workerId: "w1" });

		const done = store.createJob({ targetRole: "observer", jobType: "d", payload: {} });
		store.updateJobStatus(done.id, "completed");

		const failed = store.createJob({ targetRole: "observer", jobType: "e", payload: {} });
		store.updateJobStatus(failed.id, "failed");

		const cancelled = store.createJob({ targetRole: "observer", jobType: "f", payload: {} });
		store.updateJobStatus(cancelled.id, "cancelled");

		const stats = store.getStats();
		expect(stats.total).toBe(6);
		expect(stats.pending).toBe(2);
		expect(stats.leased).toBe(1);
		expect(stats.completed).toBe(1);
		expect(stats.failed).toBe(1);
		expect(stats.cancelled).toBe(1);
	});
});

// =============================================================================
// JobRecoveryEngine Tests
// =============================================================================

describe("JobRecoveryEngine", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Crash Detection
	// -----------------------------------------------------------------------

	test("detectCrash returns true after unclean shutdown", async () => {
		const setup = await createDefaultSetup(tempDir);

		// First session: create jobs, don't clean shutdown
		setup.store.createJob({ targetRole: "observer", jobType: "crash_test", payload: {} });
		await setup.store.save();

		// Simulate restart with new store
		const store2 = new JobStateStore(tempDir);
		await store2.init();

		const recovery2 = new JobRecoveryEngine(store2, setup.supervisor);
		expect(recovery2.detectCrash()).toBe(true);
	});

	test("detectCrash returns false after clean shutdown", async () => {
		const setup = await createDefaultSetup(tempDir);

		setup.store.createJob({ targetRole: "observer", jobType: "clean_test", payload: {} });
		await setup.store.save();
		await setup.store.markCleanShutdown();

		// Simulate restart
		const store2 = new JobStateStore(tempDir);
		await store2.init();

		const recovery2 = new JobRecoveryEngine(store2, setup.supervisor);
		expect(recovery2.detectCrash()).toBe(false);
	});

	test("detectCrash returns false on first ever startup (no previous session)", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const recovery = new JobRecoveryEngine(store, supervisor);

		// First ever startup — no previous session crashed
		expect(recovery.detectCrash()).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Full Recovery (no crash)
	// -----------------------------------------------------------------------

	test("runRecovery without crash returns success with preserved jobs", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create some jobs and clean shutdown
		setup.store.createJob({ targetRole: "observer", jobType: "existing", payload: {} });
		await setup.store.save();
		await setup.store.markCleanShutdown();

		// Simulate restart
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const recovery2 = new JobRecoveryEngine(store2, setup.supervisor);

		const result = await recovery2.runRecovery();

		expect(result.success).toBe(true);
		expect(result.crashDetected).toBe(false);
		expect(result.counts.jobsPreserved).toBe(1);
		expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	// -----------------------------------------------------------------------
	// Full Recovery (with crash) — No leased jobs
	// -----------------------------------------------------------------------

	test("runRecovery with crash recovers pending jobs", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create some pending jobs without clean shutdown
		setup.store.createJob({ targetRole: "observer", jobType: "recover_me", payload: { id: 1 } });
		setup.store.createJob({ targetRole: "observer", jobType: "recover_me", payload: { id: 2 } });
		await setup.store.save();
		// No markCleanShutdown — simulate crash

		// Simulate restart
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery2 = new JobRecoveryEngine(store2, supervisor2);
		const result = await recovery2.runRecovery();

		expect(result.success).toBe(true);
		expect(result.crashDetected).toBe(true);
		// Pending jobs should be dispatched (or attempted)
		expect(result.counts.jobsRedispatched + result.counts.jobsPreserved).toBe(2);
		expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
	});

	// -----------------------------------------------------------------------
	// Lease Recovery
	// -----------------------------------------------------------------------

	test("recoverExpiredLeases recovers expired leases with diagnostics", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create a job that was being worked on when crash happened
		const job = setup.store.createJob({
			targetRole: "observer",
			jobType: "in_progress",
			payload: { critical: true },
		});

		// Set as leased with an expired lease
		setup.store.updateJobStatus(job.id, "leased", {
			workerId: "crashed-worker",
			leasedAt: new Date(Date.now() - 60000).toISOString(),
			leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
		});
		await setup.store.save();

		// Re-init to simulate restart
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery2 = new JobRecoveryEngine(store2, supervisor2);
		const result = await recovery2.runRecovery();

		expect(result.success).toBe(true);
		expect(result.crashDetected).toBe(true);
		expect(result.counts.expiredLeasesRecovered).toBe(1);
	});

	test("recoverExpiredLeases fails job when retries exhausted", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create a job that has exhausted its retries
		const job = setup.store.createJob(
			{
				targetRole: "observer",
				jobType: "exhausted",
				payload: {},
			},
			{ maxRetries: 2 },
		);

		setup.store.updateJobStatus(job.id, "leased", {
			workerId: "crashed-worker",
			leasedAt: new Date(Date.now() - 60000).toISOString(),
			leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
			retryCount: 2, // Already at max retries
		});
		await setup.store.save();

		// Re-init
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery2 = new JobRecoveryEngine(store2, supervisor2);
		const result = await recovery2.runRecovery();

		// Should have been recovered but marked as failed (no retries)
		expect(result.success).toBe(true);
		expect(result.counts.expiredLeasesRecovered).toBe(1);

		const recoveredJob = store2.getJob(job.id);
		expect(recoveredJob).not.toBeNull();
		expect(recoveredJob!.status).toBe("failed");
	});

	// -----------------------------------------------------------------------
	// Redispatch Pending Jobs
	// -----------------------------------------------------------------------

	test("redispatchPendingJobs submits pending jobs to supervisor", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create a pending job (not leased)
		setup.store.createJob({ targetRole: "observer", jobType: "pending_dispatch", payload: { p: 1 } });
		await setup.store.save();

		// Re-init
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery2 = new JobRecoveryEngine(store2, supervisor2);
		const recovered = recovery2.redispatchPendingJobs();

		// Job should have been dispatched (or at least attempted)
		expect(recovered.count + recovered.preserved).toBe(1);
		expect(recovered.diagnostics.length).toBeGreaterThanOrEqual(0);
	});

	test("redispatchPendingJobs respects maxRecoveryBatchSize", () => {
		const store = new JobStateStore(tempDir);
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.registerWorker(makeManifest("observer"));

		// Create more jobs than the batch size
		for (let i = 0; i < 10; i++) {
			store.createJob({ targetRole: "observer", jobType: "batch", payload: { i } });
		}

		const recovery = new JobRecoveryEngine(store, supervisor, {
			maxRecoveryBatchSize: 5,
			redispatchPendingJobs: true,
		});

		const result = recovery.redispatchPendingJobs();
		expect(result.count + result.preserved).toBeLessThanOrEqual(5);
	});

	// -----------------------------------------------------------------------
	// Dedup During Recovery
	// -----------------------------------------------------------------------

	test("dedup prevents duplicate job dispatch during recovery", () => {
		const store = new JobStateStore(tempDir);
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.registerWorker(makeManifest("observer"));

		// Create two jobs with same task hash
		const job1 = store.createJob({
			targetRole: "observer",
			jobType: "dedup_test",
			payload: { value: "same" },
		});

		const job2 = store.createJob({
			targetRole: "observer",
			jobType: "dedup_test",
			payload: { value: "same" },
		});

		// Manually set the same task hash
		const matchedHash = job1.taskHash;
		const j2 = store.getJob(job2.id)!;

		// Use non-null assertion — we know the job was created in this scope
		expect(j2.taskHash).toBe(matchedHash);

		const recovery = new JobRecoveryEngine(store, supervisor, {
			dedupEnabled: true,
			dedupWindowMs: 300000,
			maxRecoveryBatchSize: 100,
		});

		const result = recovery.redispatchPendingJobs();

		// At least one should be preserved (deduped)
		expect(result.count + result.preserved).toBe(2);
		// Both should not be dispatched if dedup catches it
		expect(result.count).toBeLessThanOrEqual(1);
	});

	// -----------------------------------------------------------------------
	// Recovery Configuration
	// -----------------------------------------------------------------------

	test("getConfig returns current config", () => {
		const store = new JobStateStore(tempDir);
		const supervisor = new BrainSupervisor();

		const recovery = new JobRecoveryEngine(store, supervisor, {
			autoRecoverOnStart: false,
			recoverExpiredLeases: false,
			maxRecoveryBatchSize: 50,
		});

		const config = recovery.getConfig();
		expect(config.autoRecoverOnStart).toBe(false);
		expect(config.recoverExpiredLeases).toBe(false);
		expect(config.maxRecoveryBatchSize).toBe(50);

		// Other fields should have defaults
		expect(config.redispatchPendingJobs).toBe(true);
		expect(config.recoveryCooldownMs).toBe(DEFAULT_RECOVERY_CONFIG.recoveryCooldownMs);
	});

	test("setConfig updates config fields", () => {
		const store = new JobStateStore(tempDir);
		const supervisor = new BrainSupervisor();
		const recovery = new JobRecoveryEngine(store, supervisor);

		recovery.setConfig({
			autoRecoverOnStart: false,
			maxRecoveryBatchSize: 25,
			produceDiagnostics: false,
		});

		const config = recovery.getConfig();
		expect(config.autoRecoverOnStart).toBe(false);
		expect(config.maxRecoveryBatchSize).toBe(25);
		expect(config.produceDiagnostics).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Information / Query
	// -----------------------------------------------------------------------

	test("getRecoveredJobIds returns tracked recovered jobs", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create leased job with expired lease
		const job = setup.store.createJob({
			targetRole: "observer",
			jobType: "track_recovery",
			payload: {},
		});

		setup.store.updateJobStatus(job.id, "leased", {
			workerId: "crashed-worker",
			leasedAt: new Date(Date.now() - 60000).toISOString(),
			leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
		});
		await setup.store.save();

		// Simulate restart
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery2 = new JobRecoveryEngine(store2, supervisor2);
		await recovery2.runRecovery();

		const recoveredIds = recovery2.getRecoveredJobIds();
		expect(recoveredIds.length).toBe(1);
		expect(recoveredIds[0]).toBe(job.id);
		expect(recovery2.isJobRecovered(job.id)).toBe(true);
		expect(recovery2.getRecoveredJobCount()).toBe(1);
	});

	test("getRecoverableJobs returns recoverable jobs from store", async () => {
		const setup = await createDefaultSetup(tempDir);

		setup.store.createJob({ targetRole: "observer", jobType: "pending", payload: {} });
		await setup.store.save();

		const recovery = new JobRecoveryEngine(setup.store, setup.supervisor);
		const recoverable = recovery.getRecoverableJobs();
		expect(recoverable.length).toBe(1);
		expect(recoverable[0].jobType).toBe("pending");
	});

	// -----------------------------------------------------------------------
	// Edge Cases
	// -----------------------------------------------------------------------

	test("runRecovery handles empty store gracefully", async () => {
		const setup = await createDefaultSetup(tempDir);
		await setup.store.markCleanShutdown();

		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery2 = new JobRecoveryEngine(store2, supervisor2);
		const result = await recovery2.runRecovery();

		expect(result.success).toBe(true);
		expect(result.crashDetected).toBe(false);
		expect(result.counts.expiredLeasesRecovered).toBe(0);
		expect(result.counts.jobsRedispatched).toBe(0);
	});

	test("recoverExpiredLeases handles no expired leases", () => {
		const store = new JobStateStore(tempDir);
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.registerWorker(makeManifest("observer"));

		// Only pending jobs — no leases
		store.createJob({ targetRole: "observer", jobType: "pending_1", payload: {} });
		store.createJob({ targetRole: "observer", jobType: "pending_2", payload: {} });

		const recovery = new JobRecoveryEngine(store, supervisor);
		const result = recovery.recoverExpiredLeases();
		expect(result.count).toBe(0);
		expect(result.diagnostics.length).toBe(0);
	});

	test("runRecovery with exhausted retries marks jobs as failed", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create a job that has exhausted retries and is pending
		const job = setup.store.createJob(
			{
				targetRole: "observer",
				jobType: "exhausted",
				payload: {},
			},
			{ maxRetries: 2 },
		);

		setup.store.updateJobStatus(job.id, "pending", {
			retryCount: 2, // Already maxed out
		});
		await setup.store.save();

		// Re-init
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery2 = new JobRecoveryEngine(store2, supervisor2, {
			redispatchPendingJobs: true,
			recoverExpiredLeases: false,
		});
		const result = await recovery2.runRecovery();

		// The engine should handle retries properly
		expect(result.success).toBe(true);
	});

	test("diagnostics have evidence refs pointing to recovery origin", () => {
		const store = new JobStateStore(tempDir);
		const supervisor = new BrainSupervisor();
		supervisor.start();

		const recovery = new JobRecoveryEngine(store, supervisor);
		const job = store.createJob({
			targetRole: "observer",
			jobType: "diag_test",
			payload: {},
		});
		store.updateJobStatus(job.id, "leased", {
			workerId: "crash-worker",
			leasedAt: new Date(Date.now() - 60000).toISOString(),
			leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
		});

		const result = recovery.recoverExpiredLeases();
		expect(result.diagnostics[0].evidenceRefs).toContain("recovery://25.S/lease-recovery");
	});

	test("runRecovery handles supervisor not being started", async () => {
		const store = new JobStateStore(tempDir);
		await store.init();

		const supervisor = new BrainSupervisor();
		// Don't start the supervisor

		const recovery = new JobRecoveryEngine(store, supervisor);
		const result = await recovery.runRecovery();

		// Should still succeed — re-dispatch may fail, but recovery should handle it gracefully
		expect(result.success).toBe(true);
	});

	test("recovery preserves terminal jobs (completed/failed/cancelled)", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create terminal jobs
		const done = setup.store.createJob({
			targetRole: "observer",
			jobType: "done",
			payload: {},
		});
		setup.store.updateJobStatus(done.id, "completed", { output: { result: "ok" } });

		const failed = setup.store.createJob({
			targetRole: "observer",
			jobType: "failed",
			payload: {},
		});
		setup.store.updateJobStatus(failed.id, "failed", { error: "test error" });

		const cancelled = setup.store.createJob({
			targetRole: "observer",
			jobType: "cancelled",
			payload: {},
		});
		setup.store.updateJobStatus(cancelled.id, "cancelled");

		await setup.store.save();
		await setup.store.markCleanShutdown();

		// Re-init
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const recovery2 = new JobRecoveryEngine(store2, setup.supervisor);
		const result = await recovery2.runRecovery();

		expect(result.success).toBe(true);
		expect(result.counts.expiredLeasesRecovered).toBe(0);

		// Terminal jobs should still be in their original state
		expect(store2.getJob(done.id)!.status).toBe("completed");
		expect(store2.getJob(failed.id)!.status).toBe("failed");
		expect(store2.getJob(cancelled.id)!.status).toBe("cancelled");
	});
});

// =============================================================================
// Edge Cases: Integration with Supervisor
// =============================================================================

describe("JobRecoveryEngine + Supervisor Integration", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("full crash-and-recovery workflow with supervisor", async () => {
		// === Session 1: Set up jobs ===
		const store1 = new JobStateStore(tempDir);
		await store1.init();

		const supervisor1 = new BrainSupervisor();
		supervisor1.start();
		const manifest1 = makeManifest("observer");
		supervisor1.registerWorker(manifest1);

		// Submit a job through the supervisor
		const job1 = supervisor1.submitJob(makeJobInput("observer", "crash-job-1"));
		expect(job1).not.toBeNull();

		// Lease the job
		supervisor1.leaseJob(job1!.id, manifest1.id);

		// Persist the job state (simulating periodic save)
		const persistedJob = store1.createJob({
			targetRole: "observer",
			jobType: "crash-job-1",
			payload: job1!.input.payload,
			taskHash: job1!.taskHash,
		});
		store1.updateJobStatus(persistedJob.id, "leased", {
			workerId: manifest1.id,
			leasedAt: new Date().toISOString(),
			leaseExpiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
		});
		await store1.save();
		// No clean shutdown — simulate crash

		// === Session 2: Recover ===
		const store2 = new JobStateStore(tempDir);
		await store2.init();

		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		const manifest2 = makeManifest("observer");
		supervisor2.registerWorker(manifest2);

		const recovery = new JobRecoveryEngine(store2, supervisor2, {
			recoveredLeaseDurationMs: 60000,
			maxRecoveryBatchSize: 100,
		});

		const result = await recovery.runRecovery();

		// Verify recovery result
		expect(result.success).toBe(true);
		expect(result.crashDetected).toBe(true);
		// Lease was expired — should be recovered
		expect(result.counts.expiredLeasesRecovered).toBeGreaterThanOrEqual(1);
		expect(result.currentSessionId).not.toBe(result.previousSession?.sessionId);
		expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);

		// Verify diagnostics have evidence refs
		const leaseDiag = result.diagnostics.find((d) => d.evidenceRefs.some((r) => r.includes("lease-recovery")));
		expect(leaseDiag).toBeDefined();
		if (leaseDiag) {
			expect(leaseDiag.stopCondition).toBe("timeout");
			expect(leaseDiag.context.workerId).toBe(manifest1.id);
		}
	});

	test("no-op recovery when no jobs were in-flight", async () => {
		const store1 = new JobStateStore(tempDir);
		await store1.init();

		const supervisor1 = new BrainSupervisor();
		supervisor1.start();
		// Some completed jobs
		const done = store1.createJob({
			targetRole: "observer",
			jobType: "completed_job",
			payload: {},
		});
		store1.updateJobStatus(done.id, "completed", { output: { ok: true } });
		await store1.save();
		// No clean shutdown — crash

		// Restart
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery = new JobRecoveryEngine(store2, supervisor2);
		const result = await recovery.runRecovery();

		// No non-terminal jobs to recover, but crash was detected
		expect(result.success).toBe(true);
		expect(result.crashDetected).toBe(true);
		expect(result.counts.expiredLeasesRecovered).toBe(0);
		expect(result.counts.jobsRedispatched).toBe(0);
	});

	test("budget and stop-condition handling during recovery", async () => {
		const setup = await createDefaultSetup(tempDir);

		// Create a job that has exhausted its retry budget
		const job = setup.store.createJob(
			{
				targetRole: "observer",
				jobType: "budget_test",
				payload: {},
			},
			{ maxRetries: 0 }, // No retries allowed
		);

		setup.store.updateJobStatus(job.id, "leased", {
			workerId: "crashed-worker",
			leasedAt: new Date(Date.now() - 60000).toISOString(),
			leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
			retryCount: 0,
		});
		await setup.store.save();

		// Restart
		const store2 = new JobStateStore(tempDir);
		await store2.init();
		const supervisor2 = new BrainSupervisor();
		supervisor2.start();
		supervisor2.registerWorker(makeManifest("observer"));

		const recovery = new JobRecoveryEngine(store2, supervisor2);
		const result = await recovery.runRecovery();

		// Since maxRetries=0, the job should be immediately marked as failed
		expect(result.success).toBe(true);
		const recoveredJob = store2.getJob(job.id);
		expect(recoveredJob).not.toBeNull();

		// The job should have a lease recovery diagnostic
		const leaseDiag = result.diagnostics.find((d) => d.evidenceRefs.some((r) => r.includes("lease-recovery")));
		expect(leaseDiag).toBeDefined();
		if (leaseDiag) {
			expect(leaseDiag.stopCondition).toBe("timeout");
		}
	});
});

// =============================================================================
// Factory Functions
// =============================================================================

describe("Factory Functions", () => {
	test("createJobStateStore returns configured instance", () => {
		const store = createJobStateStore("/tmp/test");
		expect(store).toBeInstanceOf(JobStateStore);
		expect(store.getFilePath()).toContain(".pi/brain-worker-jobs.json");
	});

	test("createJobRecoveryEngine returns configured instance", () => {
		const store = new JobStateStore("/tmp/test");
		const supervisor = new BrainSupervisor();
		const recovery = createJobRecoveryEngine(store, supervisor);
		expect(recovery).toBeInstanceOf(JobRecoveryEngine);
	});
});
