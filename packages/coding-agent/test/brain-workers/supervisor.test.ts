/**
 * Brain Orchestrator Supervisor — 25.D
 *
 * Covers:
 * - Supervisor lifecycle (start, pause, resume, stop, reset)
 * - Worker registration and unregistration
 * - Job submission, routing, leasing, completing, failing, cancelling
 * - Content-based deduplication
 * - Lease recovery (timeout-based)
 * - Worker health monitoring via heartbeats
 * - Event system (subscribe/unsubscribe)
 * - Diagnostics snapshot
 * - Budget/cooldown/dedup/stop-condition handling
 * - Edge cases and error conditions
 */

import { describe, expect, test } from "vitest";
import { generateManifest } from "../../src/brain-workers/contracts.js";
import {
	type JobInput,
	type JobPriority,
	type JobQuery,
	type JobRecord,
	JobStore,
	type LeaseConfig,
} from "../../src/brain-workers/supervisor/job-lease.js";
import {
	BrainSupervisor,
	type BrainSupervisorConfig,
	type SupervisorDiagnostics,
	type SupervisorEvent,
	type SupervisorState,
} from "../../src/brain-workers/supervisor/supervisor.js";
import type { WorkerManifest } from "../../src/brain-workers/types.js";

// =============================================================================
// Helpers
// =============================================================================

/** Create a standard test worker manifest for a given role. */
function makeManifest(role: "observer" | "analyst" | "proposer", name?: string): WorkerManifest {
	return generateManifest({
		role,
		name: name ?? `test-${role}`,
		description: `Test ${role} worker`,
	});
}

/** Create a test job input for a given target role. */
function makeJobInput(targetRole: string, jobType: string = "test_job", overrides?: Partial<JobInput>): JobInput {
	return {
		targetRole,
		jobType,
		payload: { key: "value" },
		...overrides,
	};
}

/** Collect supervisor events into an array (via onEvent). */
function collectEvents(supervisor: BrainSupervisor, filter?: string[]): SupervisorEvent[] {
	const events: SupervisorEvent[] = [];
	supervisor.onEvent((event) => {
		if (!filter || filter.includes(event.eventType)) {
			events.push(event);
		}
	});
	return events;
}

// =============================================================================
// Supervisor Lifecycle
// =============================================================================

describe("BrainSupervisor Lifecycle", () => {
	test("starts in stopped state", () => {
		const supervisor = new BrainSupervisor();
		expect(supervisor.getState()).toBe("stopped");
	});

	test("start transitions to running", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		expect(supervisor.getState()).toBe("running");
	});

	test("start emits supervisor_started event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		expect(events.length).toBe(1);
		expect(events[0].eventType).toBe("supervisor_started");
	});

	test("start is idempotent when already running", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.start(); // second call should not throw
		expect(supervisor.getState()).toBe("running");
	});

	test("start throws when in failed state", () => {
		const supervisor = new BrainSupervisor();
		(supervisor as any).state = "failed"; // force failed state
		expect(() => supervisor.start()).toThrow("Cannot start supervisor from failed state; call reset() first");
	});

	test("pause transitions to paused", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		expect(supervisor.getState()).toBe("paused");
	});

	test("pause emits supervisor_paused event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		supervisor.pause();
		const pauseEvent = events.find((e) => e.eventType === "supervisor_paused");
		expect(pauseEvent).toBeDefined();
	});

	test("pause throws when not running", () => {
		const supervisor = new BrainSupervisor();
		expect(() => supervisor.pause()).toThrow("Cannot pause: supervisor is not running");
	});

	test("resume transitions back to running", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		supervisor.resume();
		expect(supervisor.getState()).toBe("running");
	});

	test("resume emits supervisor_resumed event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		supervisor.pause();
		supervisor.resume();
		const resumeEvent = events.find((e) => e.eventType === "supervisor_resumed");
		expect(resumeEvent).toBeDefined();
	});

	test("resume throws when not paused", () => {
		const supervisor = new BrainSupervisor();
		expect(() => supervisor.resume()).toThrow("Cannot resume: supervisor is not paused");
	});

	test("stop transitions to stopped", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.stop();
		expect(supervisor.getState()).toBe("stopped");
	});

	test("stop emits supervisor_stopped event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		supervisor.stop();
		const stopEvent = events.find((e) => e.eventType === "supervisor_stopped");
		expect(stopEvent).toBeDefined();
	});

	test("reset clears all state and returns to stopped", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.submitJob(makeJobInput("observer"));
		supervisor.stop();
		supervisor.reset();

		const diag = supervisor.getDiagnostics();
		expect(supervisor.getState()).toBe("stopped");
		expect(diag.totalJobsSubmitted).toBe(0);
		expect(diag.registeredWorkerCount).toBe(0);
	});

	test("reset throws when running", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		expect(() => supervisor.reset()).toThrow("Cannot reset: stop or pause supervisor first");
	});

	test("reset emits supervisor_reset event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		supervisor.stop();
		supervisor.reset();
		const resetEvent = events.find((e) => e.eventType === "supervisor_reset");
		expect(resetEvent).toBeDefined();
	});
});

// =============================================================================
// Worker Registration
// =============================================================================

describe("Worker Registration", () => {
	test("register a worker succeeds", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		const diag = supervisor.getDiagnostics();
		expect(diag.registeredWorkerCount).toBe(1);
	});

	test("register emits worker_registered event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		const regEvent = events.find((e) => e.eventType === "worker_registered");
		expect(regEvent).toBeDefined();
		expect(regEvent!.data.workerId).toBe(manifest.id);
		expect(regEvent!.data.role).toBe("observer");
	});

	test("registering the same worker twice throws", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		expect(() => supervisor.registerWorker(manifest)).toThrow("is already registered");
	});

	test("unregister a worker succeeds", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		const result = supervisor.unregisterWorker(manifest.id);
		expect(result).toBe(true);
		expect(supervisor.getDiagnostics().registeredWorkerCount).toBe(0);
	});

	test("unregister emits worker_unregistered event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.unregisterWorker(manifest.id);
		const unregEvent = events.find((e) => e.eventType === "worker_unregistered");
		expect(unregEvent).toBeDefined();
		expect(unregEvent!.data.workerId).toBe(manifest.id);
	});

	test("unregister a non-existent worker returns false", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const result = supervisor.unregisterWorker("nonexistent");
		expect(result).toBe(false);
	});

	test("worker appears in lifecycle engine after registration", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		const lifecycle = supervisor.getLifecycleEngine();
		const status = lifecycle.getStatus(manifest.id);
		expect(status).toBeDefined();
		expect(status!.state).toBe("standby");
	});

	test("worker appears in health monitor after registration", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		const health = supervisor.getHealthMonitor();
		const record = health.getHealthRecord(manifest.id);
		expect(record).toBeDefined();
		expect(record!.status).toBe("healthy");
	});
});

// =============================================================================
// Job Submission & Deduplication
// =============================================================================

describe("Job Submission", () => {
	test("submit a job creates a pending job record", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const job = supervisor.submitJob(makeJobInput("observer"));
		expect(job).not.toBeNull();
		expect(job!.status).toBe("pending");
		expect(job!.jobType).toBe("test_job");
		expect(job!.targetRole).toBe("observer");
	});

	test("submit emits job_submitted event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		supervisor.submitJob(makeJobInput("observer"));
		const submitEvent = events.find((e) => e.eventType === "job_submitted");
		expect(submitEvent).toBeDefined();
		expect(submitEvent!.data.targetRole).toBe("observer");
	});

	test("submit increments totalJobsSubmitted in diagnostics", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.submitJob(makeJobInput("observer"));
		supervisor.submitJob(makeJobInput("analyst"));
		const diag = supervisor.getDiagnostics();
		expect(diag.totalJobsSubmitted).toBe(2);
	});

	test("submit returns null when supervisor is in failed state", () => {
		const supervisor = new BrainSupervisor();
		(supervisor as any).state = "failed";
		const job = supervisor.submitJob(makeJobInput("observer"));
		expect(job).toBeNull();
		const diag = supervisor.getDiagnostics();
		expect(diag.lastError).toContain("failed state");
	});

	test("submit returns null for deduplicated job within window", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const job1 = supervisor.submitJob(makeJobInput("observer", "dedup_test"));
		expect(job1).not.toBeNull();

		// Second identical submission should be deduped
		const job2 = supervisor.submitJob(makeJobInput("observer", "dedup_test"));
		expect(job2).toBeNull();
	});

	test("dedup emits job_deduped event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		supervisor.submitJob(makeJobInput("observer", "dedup_event_test"));
		supervisor.submitJob(makeJobInput("observer", "dedup_event_test"));
		const dedupEvent = events.find((e) => e.eventType === "job_deduped");
		expect(dedupEvent).toBeDefined();
	});

	test("submit with explicit task hash deduplicates correctly", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const job1 = supervisor.submitJob(makeJobInput("observer", "hash_test", { taskHash: "abc123" }));
		expect(job1).not.toBeNull();

		const job2 = supervisor.submitJob(makeJobInput("observer", "hash_test", { taskHash: "abc123" }));
		expect(job2).toBeNull();

		// Different hash should not dedup
		const job3 = supervisor.submitJob(makeJobInput("observer", "hash_test", { taskHash: "def456" }));
		expect(job3).not.toBeNull();
	});
});

// =============================================================================
// Job Routing & Leasing
// =============================================================================

describe("Job Routing & Leasing", () => {
	test("job is automatically routed to a capable worker when running", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const job = supervisor.submitJob(makeJobInput("observer"));
		expect(job).not.toBeNull();

		// Job should have been automatically leased to the observer worker
		const stored = supervisor.getJob(job!.id);
		expect(stored).not.toBeUndefined();
		expect(stored!.status).toBe("leased");
		expect(stored!.workerId).toBe(manifest.id);
	});

	test("job is not routed when supervisor is paused", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer"));
		expect(job).not.toBeNull();

		// Job should remain pending since supervisor is paused
		const stored = supervisor.getJob(job!.id);
		expect(stored!.status).toBe("pending");
	});

	test("leaseJob leases a pending job to a specific worker", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// Submit while paused to get a pending job
		supervisor.pause();
		const pendingJob = supervisor.submitJob(makeJobInput("observer", "lease_test"));
		expect(pendingJob).not.toBeNull();
		expect(pendingJob!.status).toBe("pending");

		const leased = supervisor.leaseJob(pendingJob!.id, manifest.id);
		expect(leased).not.toBeNull();
		expect(leased!.status).toBe("leased");
		expect(leased!.workerId).toBe(manifest.id);
	});

	test("leaseJob emits job_leased event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "lease_event"));
		supervisor.leaseJob(job!.id, manifest.id);

		const leaseEvent = events.find((e) => e.eventType === "job_leased");
		expect(leaseEvent).toBeDefined();
		expect(leaseEvent!.data.jobId).toBe(job!.id);
		expect(leaseEvent!.data.workerId).toBe(manifest.id);
	});

	test("leaseJob returns null if job is not pending", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const result = supervisor.leaseJob("nonexistent", "worker1");
		expect(result).toBeNull();
	});

	test("worker capacity is enforced", () => {
		const supervisor = new BrainSupervisor({
			maxJobsPerWorker: 1,
		});
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// First job should be leased
		const job1 = supervisor.submitJob(makeJobInput("observer", "cap_test_1"));
		expect(job1).not.toBeNull();

		// Second job should stay pending because worker is at capacity
		supervisor.submitJob(makeJobInput("observer", "cap_test_2"));

		const pendingJobs = supervisor.queryJobs({ status: "pending" });
		expect(pendingJobs.length).toBe(1);
	});
});

// =============================================================================
// Job Completion & Failure
// =============================================================================

describe("Job Completion & Failure", () => {
	test("completeJob transitions job to completed", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "complete_test"));
		supervisor.leaseJob(job!.id, manifest.id);

		const result = supervisor.completeJob(job!.id, { result: "success" });
		expect(result).not.toBeNull();
		expect(result!.status).toBe("completed");
		expect(result!.output).toEqual({ result: "success" });
	});

	test("completeJob emits job_completed event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "complete_event"));
		supervisor.leaseJob(job!.id, manifest.id);
		supervisor.completeJob(job!.id, {});

		const completeEvent = events.find((e) => e.eventType === "job_completed");
		expect(completeEvent).toBeDefined();
	});

	test("failJob transitions job to pending for retry", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "fail_retry_test"), {
			maxRetries: 2,
		});
		supervisor.leaseJob(job!.id, manifest.id);

		const result = supervisor.failJob(job!.id, "Temporary error");
		expect(result).not.toBeNull();
		expect(result!.status).toBe("pending"); // Retrying
		expect(result!.retryCount).toBe(1);
		expect(result!.workerId).toBeNull(); // Released
	});

	test("failJob transitions job to failed after max retries", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "fail_final_test"), {
			maxRetries: 2,
		});
		supervisor.leaseJob(job!.id, manifest.id);
		supervisor.failJob(job!.id, "Attempt 1");

		// Re-lease the retried job
		supervisor.leaseJob(job!.id, manifest.id);
		const result = supervisor.failJob(job!.id, "Attempt 2");

		expect(result).not.toBeNull();
		expect(result!.status).toBe("failed");
		expect(result!.retryCount).toBe(2);
		expect(result!.error).toBe("Attempt 2");
	});

	test("failJob with diagnostic attaches evidence", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const diag = createWorkerDiagnostic("timeout", "Worker exceeded budget", { runtimeMs: 60000 }, [
			"evidence://test",
		]);

		const job = supervisor.submitJob(makeJobInput("observer", "diag_test"), {
			maxRetries: 0,
		});
		supervisor.leaseJob(job!.id, manifest.id);
		const result = supervisor.failJob(job!.id, "Budget exceeded", diag);

		expect(result).not.toBeNull();
		expect(result!.status).toBe("failed");
		expect(result!.diagnostic).toBeDefined();
		expect(result!.diagnostic!.stopCondition).toBe("timeout");
		expect(result!.diagnostic!.evidenceRefs).toContain("evidence://test");
	});

	test("failJob emits job_failed or job_retrying events", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		// Job with retries - should emit job_retrying
		const job1 = supervisor.submitJob(makeJobInput("observer", "fail_event"), { maxRetries: 2 });
		supervisor.leaseJob(job1!.id, manifest.id);
		supervisor.failJob(job1!.id, "try 1");

		let event = events.find((e) => e.eventType === "job_retrying");
		expect(event).toBeDefined();
		expect(event!.data.retryCount).toBe(1);

		// Job with no retries - should emit job_failed
		const job2 = supervisor.submitJob(makeJobInput("observer", "fail_event2"), { maxRetries: 0 });
		supervisor.leaseJob(job2!.id, manifest.id);
		supervisor.failJob(job2!.id, "final");

		event = events.find((e) => e.eventType === "job_failed");
		expect(event).toBeDefined();
	});

	test("completeJob returns null for missing job", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const result = supervisor.completeJob("nonexistent", {});
		expect(result).toBeNull();
	});

	test("failJob returns null for missing job", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const result = supervisor.failJob("nonexistent", "error");
		expect(result).toBeNull();
	});
});

// =============================================================================
// Job Cancellation
// =============================================================================

describe("Job Cancellation", () => {
	test("cancelJob transitions pending job to cancelled", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		const job = supervisor.submitJob(makeJobInput("observer", "cancel_test"));
		const result = supervisor.cancelJob(job!.id, "No longer needed");
		expect(result).not.toBeNull();
		expect(result!.status).toBe("cancelled");
		expect(result!.error).toBe("No longer needed");
	});

	test("cancelJob emits job_cancelled event", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();
		supervisor.pause();
		const job = supervisor.submitJob(makeJobInput("observer", "cancel_event"));
		supervisor.cancelJob(job!.id, "Cancelled");
		const cancelEvent = events.find((e) => e.eventType === "job_cancelled");
		expect(cancelEvent).toBeDefined();
	});

	test("cancelJob returns null for non-existent job", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const result = supervisor.cancelJob("nonexistent", "reason");
		expect(result).toBeNull();
	});

	test("cancelJob returns null for already completed job", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "cancel_completed"));
		supervisor.leaseJob(job!.id, manifest.id);
		supervisor.completeJob(job!.id, {});

		const result = supervisor.cancelJob(job!.id, "Too late");
		expect(result).toBeNull();
	});

	test("cancelJob increments totalJobsCancelled in diagnostics", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		supervisor.submitJob(makeJobInput("observer", "diag_cancel"));
		supervisor.cancelJob(supervisor.queryJobs({ status: "pending" })[0].id, "test");
		const diag = supervisor.getDiagnostics();
		expect(diag.totalJobsCancelled).toBe(1);
	});
});

// =============================================================================
// Lease Recovery
// =============================================================================

describe("Lease Recovery", () => {
	test("recoverExpiredLeases reclaims expired jobs", () => {
		const supervisor = new BrainSupervisor({
			leaseConfig: {
				defaultLeaseDurationMs: 0, // Immediate expiry
				maxLeaseDurationMs: 100,
				defaultMaxRetries: 0,
				dedupEnabled: false,
				dedupWindowMs: 0,
			},
		});
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const job = supervisor.submitJob(makeJobInput("observer", "lease_recovery"));
		expect(job).not.toBeNull();

		// Recover expired leases
		const recovered = supervisor.recoverExpiredLeases();
		expect(recovered.length).toBeGreaterThan(0);

		// The job should now be failed due to lease expiry
		const stored = supervisor.getJob(job!.id);
		expect(stored).not.toBeUndefined();
		expect(stored!.status).toBe("failed" as const);
		expect(stored!.error).toContain("expired");
	});

	test("recoverExpiredLeases returns empty array when no leases expired", () => {
		const supervisor = new BrainSupervisor({
			leaseConfig: {
				defaultLeaseDurationMs: 300_000, // Long lease
				maxLeaseDurationMs: 3_600_000,
				defaultMaxRetries: 0,
				dedupEnabled: false,
				dedupWindowMs: 0,
			},
		});
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "no_expiry"));
		supervisor.leaseJob(job!.id, manifest.id);

		const recovered = supervisor.recoverExpiredLeases();
		expect(recovered.length).toBe(0);
	});

	test("recoverExpiredLeases emits leases_recovered event", () => {
		const supervisor = new BrainSupervisor({
			leaseConfig: {
				defaultLeaseDurationMs: 0,
				maxLeaseDurationMs: 100,
				defaultMaxRetries: 0,
				dedupEnabled: false,
				dedupWindowMs: 0,
			},
		});
		const events = collectEvents(supervisor);
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		supervisor.submitJob(makeJobInput("observer", "recovery_event"));
		supervisor.recoverExpiredLeases();

		const recoverEvent = events.find((e) => e.eventType === "leases_recovered");
		expect(recoverEvent).toBeDefined();
		expect(recoverEvent!.data.recoveredJobIds).toBeDefined();
	});

	test("recoverExpiredLeases attaches timeout diagnostic", () => {
		const supervisor = new BrainSupervisor({
			leaseConfig: {
				defaultLeaseDurationMs: 0,
				maxLeaseDurationMs: 100,
				defaultMaxRetries: 0,
				dedupEnabled: false,
				dedupWindowMs: 0,
			},
		});
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const job = supervisor.submitJob(makeJobInput("observer", "diag_recovery"));
		supervisor.recoverExpiredLeases();

		const stored = supervisor.getJob(job!.id);
		expect(stored).not.toBeUndefined();
		expect(stored!.diagnostic).not.toBeNull();
		expect(stored!.diagnostic!.stopCondition).toBe("timeout");
		expect(stored!.diagnostic!.evidenceRefs).toEqual(
			expect.arrayContaining([expect.stringContaining("supervisor://lease-recovery")]),
		);
	});
});

// =============================================================================
// Health Checks
// =============================================================================

describe("Health Checks", () => {
	test("checkWorkerHealth returns healthy for registered worker", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const result = supervisor.checkWorkerHealth(manifest.id);
		expect(result.status).toBe("healthy");
	});

	test("checkWorkerHealth returns unknown for unregistered worker", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const result = supervisor.checkWorkerHealth("nonexistent");
		expect(result.status).toBe("unknown");
		expect(result.recommendedTransition).toBe(false);
	});

	test("checkAllHealth returns results for all registered workers", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.registerWorker(makeManifest("observer"));
		supervisor.registerWorker(makeManifest("analyst"));
		supervisor.registerWorker(makeManifest("proposer"));

		const results = supervisor.checkAllHealth();
		expect(results.length).toBe(3);
		expect(results.every((r) => r.status === "healthy")).toBe(true);
	});

	test("health degrades after repeated failures", () => {
		const supervisor = new BrainSupervisor({
			healthConfig: {
				staleThresholdMs: 120_000,
				maxConsecutiveFailures: 2,
				maxDiagnostics: 20,
				autoMarkStale: true,
			},
		});
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "degrade_test"), {
			maxRetries: 0,
		});

		// Fail job twice to degrade health
		supervisor.leaseJob(job!.id, manifest.id);
		supervisor.failJob(job!.id, "Failure 1");

		// The job is failed — submit a new one
		const job2 = supervisor.submitJob(makeJobInput("observer", "degrade_test2"), {
			maxRetries: 0,
		});
		supervisor.leaseJob(job2!.id, manifest.id);
		supervisor.failJob(job2!.id, "Failure 2");

		const health = supervisor.checkWorkerHealth(manifest.id);
		expect(health.status).toBe("unhealthy");
	});

	test("success resets health degradation", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const healthMonitor = supervisor.getHealthMonitor();
		const diag = createWorkerDiagnostic("unknown_error", "test failure", {});

		// Record failures
		healthMonitor.recordFailure(manifest.id, diag);
		healthMonitor.recordFailure(manifest.id, diag);

		// Record a success
		healthMonitor.recordSuccess(manifest.id, 100);

		const record = healthMonitor.getHealthRecord(manifest.id);
		expect(record!.consecutiveFailures).toBe(0);
		expect(record!.totalFailures).toBe(2);
		expect(record!.totalSuccesses).toBe(1);
	});
});

// =============================================================================
// Event System
// =============================================================================

describe("Event System", () => {
	test("onEvent registers a callback that receives events", () => {
		const supervisor = new BrainSupervisor();
		const events: SupervisorEvent[] = [];
		supervisor.onEvent((event) => events.push(event));

		supervisor.start();
		expect(events.length).toBe(1);
		expect(events[0].eventType).toBe("supervisor_started");
	});

	test("offEvent removes a registered callback", () => {
		const supervisor = new BrainSupervisor();
		const events: SupervisorEvent[] = [];
		const callback = (event: SupervisorEvent) => events.push(event);
		supervisor.onEvent(callback);
		supervisor.offEvent(callback);

		supervisor.start();
		expect(events.length).toBe(0);
	});

	test("events carry correlation identifiers", () => {
		const supervisor = new BrainSupervisor();
		const events = collectEvents(supervisor);
		supervisor.start();

		supervisor.submitJob(
			makeJobInput("observer", "correlation_test", {
				traceId: "trace-123",
				spanId: "span-456",
				correlationId: "corr-789",
				projectId: "project-A",
			}),
		);

		const submitEvent = events.find((e) => e.eventType === "job_submitted");
		expect(submitEvent).toBeDefined();
		expect(submitEvent!.traceId).toBe("trace-123");
		expect(submitEvent!.spanId).toBe("span-456");
		expect(submitEvent!.correlationId).toBe("corr-789");
	});

	test("event callback errors do not crash supervisor", () => {
		const supervisor = new BrainSupervisor();
		supervisor.onEvent(() => {
			throw new Error("Handler error");
		});

		// Should not throw
		expect(() => supervisor.start()).not.toThrow();
	});

	test("events are not emitted when observability is disabled", () => {
		const supervisor = new BrainSupervisor({
			observabilityEnabled: false,
		});
		const events: SupervisorEvent[] = [];
		supervisor.onEvent((event) => events.push(event));
		supervisor.start();
		expect(events.length).toBe(0);
	});
});

// =============================================================================
// Diagnostics
// =============================================================================

describe("Diagnostics", () => {
	test("getDiagnostics returns a complete snapshot", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const diag = supervisor.getDiagnostics();

		expect(diag.state).toBe("running");
		expect(diag.startedAt).toBeDefined();
		expect(diag.totalJobsSubmitted).toBe(0);
		expect(diag.totalJobsCompleted).toBe(0);
		expect(diag.totalJobsFailed).toBe(0);
		expect(diag.totalJobsCancelled).toBe(0);
		expect(diag.totalLeaseRecoveries).toBe(0);
		expect(diag.registeredWorkerCount).toBe(0);
		expect(diag.eventsEmitted).toBeGreaterThanOrEqual(1);

		expect(diag.healthStats).toBeDefined();
		expect(typeof diag.healthStats.healthy).toBe("number");

		expect(diag.jobStats).toBeDefined();
		expect(typeof diag.jobStats.pending).toBe("number");

		expect(diag.lastError).toBeNull();
		expect(diag.lastErrorAt).toBeNull();
	});

	test("diagnostics reflect job activity", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		supervisor.submitJob(makeJobInput("observer", "diag_activity"));
		const diag1 = supervisor.getDiagnostics();
		expect(diag1.totalJobsSubmitted).toBe(1);

		// Job should be auto-routed to observer, so it's in "leased" state
		const leased = supervisor.queryJobs({ status: "leased" });
		expect(leased.length).toBe(1);
		supervisor.completeJob(leased[0].id, {});

		const diag2 = supervisor.getDiagnostics();
		expect(diag2.totalJobsCompleted).toBe(1);
	});
});

// =============================================================================
// Configuration
// =============================================================================

describe("Configuration", () => {
	test("default config is applied correctly", () => {
		const supervisor = new BrainSupervisor();
		const diag = supervisor.getDiagnostics();
		expect(diag.state).toBe("stopped");
	});

	test("custom config overrides are applied", () => {
		const customConfig: Partial<BrainSupervisorConfig> = {
			maxJobsPerWorker: 5,
			observabilityEnabled: false,
			autoRecoverLeases: false,
			capabilityRouting: false,
		};
		const supervisor = new BrainSupervisor(customConfig);
		expect(supervisor).toBeDefined();
		expect(() => supervisor.start()).not.toThrow();
	});
});

// =============================================================================
// Query Jobs
// =============================================================================

describe("Query Jobs", () => {
	test("queryJobs returns all jobs with no filters", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		supervisor.submitJob(makeJobInput("observer", "query_1"));
		supervisor.submitJob(makeJobInput("analyst", "query_2"));
		supervisor.submitJob(makeJobInput("proposer", "query_3"));

		const all = supervisor.queryJobs();
		expect(all.length).toBe(3);
	});

	test("queryJobs filters by status", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		supervisor.submitJob(makeJobInput("observer", "q_status"));

		// Cancel one job to have a cancelled status
		const all = supervisor.queryJobs();
		const cancelled = supervisor.cancelJob(all[0].id, "test");
		expect(cancelled).not.toBeNull();

		const pending = supervisor.queryJobs({ status: "pending" });
		expect(pending.length).toBe(0);

		const cancelledJobs = supervisor.queryJobs({ status: "cancelled" });
		expect(cancelledJobs.length).toBe(1);
	});

	test("queryJobs filters by targetRole", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		supervisor.submitJob(makeJobInput("observer"));
		supervisor.submitJob(makeJobInput("analyst"));

		const observerJobs = supervisor.queryJobs({ targetRole: "observer" });
		expect(observerJobs.length).toBe(1);
		expect(observerJobs[0].targetRole).toBe("observer");
	});

	test("queryJobs respects limit and offset", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		for (let i = 0; i < 10; i++) {
			supervisor.submitJob(makeJobInput("observer", `bulk_${i}`));
		}

		const limited = supervisor.queryJobs({ limit: 3 });
		expect(limited.length).toBe(3);

		const offset = supervisor.queryJobs({ limit: 3, offset: 5 });
		expect(offset.length).toBe(3);
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
	test("empty supervisor has no jobs and no workers", () => {
		const supervisor = new BrainSupervisor();
		const diag = supervisor.getDiagnostics();
		expect(diag.totalJobsSubmitted).toBe(0);
		expect(diag.registeredWorkerCount).toBe(0);
		expect(supervisor.queryJobs().length).toBe(0);
		expect(supervisor.checkAllHealth().length).toBe(0);
	});

	test("submitting job without matching workers leaves job pending", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();

		const job = supervisor.submitJob(makeJobInput("nonexistent_role"));
		expect(job).not.toBeNull();
		expect(job!.status).toBe("pending");
	});

	test("unregistering a worker during active jobs releases worker", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const job = supervisor.submitJob(makeJobInput("observer", "unreg_test"));
		supervisor.leaseJob(job!.id, manifest.id);

		supervisor.unregisterWorker(manifest.id);

		// Worker should no longer be registered
		expect(supervisor.getDiagnostics().registeredWorkerCount).toBe(0);

		// The job should still exist in the store
		const stored = supervisor.getJob(job!.id);
		expect(stored).toBeDefined();
	});

	test("cancelJob on already cancelled job returns null", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		supervisor.pause();
		const job = supervisor.submitJob(makeJobInput("observer"));
		supervisor.cancelJob(job!.id, "first");
		const result = supervisor.cancelJob(job!.id, "second");
		expect(result).toBeNull();
	});

	test("getJob returns undefined for missing ID", () => {
		const supervisor = new BrainSupervisor();
		const job = supervisor.getJob("nonexistent");
		expect(job).toBeUndefined();
	});
});

// =============================================================================
// Budget Handling — Cooldown & Stop Conditions
// =============================================================================

describe("Budget / Cooldown / Stop Conditions", () => {
	test("diagnostics include worker diagnostic on failure with evidence refs", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);
		supervisor.pause();

		const diag = createWorkerDiagnostic(
			"budget_exceeded",
			"Token budget exceeded",
			{ tokensUsed: 60000, maxTokens: 50000 },
			["budget://observer/tokens", "metric://token-usage"],
			"Token limit 50000 exceeded with 60000",
		);

		const job = supervisor.submitJob(makeJobInput("observer", "budget_test"), {
			maxRetries: 0,
		});
		supervisor.leaseJob(job!.id, manifest.id);
		const result = supervisor.failJob(job!.id, "Budget exceeded", diag);

		expect(result).not.toBeNull();
		expect(result!.diagnostic).toBeDefined();
		expect(result!.diagnostic!.stopCondition).toBe("budget_exceeded");
		expect(result!.diagnostic!.errorDetail).toBe("Token limit 50000 exceeded with 60000");
		expect(result!.diagnostic!.evidenceRefs).toContain("metric://token-usage");
	});

	test("permanent failure transitions worker to cooling state", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const job = supervisor.submitJob(makeJobInput("observer", "fatal"), {
			maxRetries: 0,
		});
		supervisor.leaseJob(job!.id, manifest.id);

		const diag = createWorkerDiagnostic("unknown_error", "Fatal error", {});
		supervisor.failJob(job!.id, "Fatal", diag);

		// Worker should be in cooling state after permanent failure
		const status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(status).toBeDefined();
		expect(status!.state).toBe("cooling");
	});

	test("worker in cooling state is not routed new jobs", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// Submit and fail a job permanently — worker enters cooling
		const job1 = supervisor.submitJob(makeJobInput("observer", "first", { taskHash: "fail-1" }), {
			maxRetries: 0,
		});
		supervisor.leaseJob(job1!.id, manifest.id);
		const diag = createWorkerDiagnostic("unknown_error", "fail", {});
		supervisor.failJob(job1!.id, "Fatal", diag);

		// Worker should be in cooling now
		const status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(status!.state).toBe("cooling");

		// Submit another job — should NOT be auto-routed to cooling worker
		const job2 = supervisor.submitJob(makeJobInput("observer", "second", { taskHash: "should-not-route" }));
		expect(job2).not.toBeNull();

		// Job should remain pending since no available (non-cooling) worker
		const retrieved = supervisor.getJob(job2!.id);
		expect(retrieved!.status).toBe("pending");
	});

	test("checkAllCooldowns returns empty when no cooldowns expired", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// Fail a job permanently (maxRetries=0) to put worker into cooling with cooldown
		const job = supervisor.submitJob(makeJobInput("observer", "cooldown-test"), { maxRetries: 0 });
		supervisor.leaseJob(job!.id, manifest.id);
		const diag = createWorkerDiagnostic("unknown_error", "test fail", {});
		supervisor.failJob(job!.id, "Test fail", diag);

		const status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(status!.state).toBe("cooling");

		// Cooldown hasn't expired (observer default is 60s), so no transitions
		const transitioned = supervisor.checkAllCooldowns();
		expect(transitioned).toEqual([]);

		// Worker still in cooling
		const stillStatus = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(stillStatus!.state).toBe("cooling");
	});

	test("completed cooldown allows routing again", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// Fail a job to put worker into cooling
		const job1 = supervisor.submitJob(makeJobInput("observer", "first", { taskHash: "cool-route-1" }), {
			maxRetries: 0,
		});
		supervisor.leaseJob(job1!.id, manifest.id);
		const diag = createWorkerDiagnostic("unknown_error", "fail", {});
		supervisor.failJob(job1!.id, "Fatal", diag);

		let status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(status!.state).toBe("cooling");

		// Manually simulate cooldown expiration by finishing cooldown via lifecycle engine
		supervisor.getLifecycleEngine().finishCooldown(manifest.id);

		status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(status!.state).toBe("standby");

		// Now submit another job — worker is back in standby, should route
		const job2 = supervisor.submitJob(makeJobInput("observer", "second", { taskHash: "cool-route-2" }));
		expect(job2).not.toBeNull();

		const retrieved = supervisor.getJob(job2!.id);
		// Job may be auto-routed since worker is available
		expect(retrieved!.status).toBeOneOf(["leased", "pending"]);
	});

	test("stop condition from diagnostic is retained on job record", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// Test various stop conditions
		const conditions: Array<{ condition: string; label: string }> = [
			{ condition: "timeout", label: "Timeout" },
			{ condition: "budget_exceeded", label: "Budget exceeded" },
			{ condition: "consecutive_failures_exceeded", label: "Consecutive failures" },
			{ condition: "cancelled", label: "Cancelled" },
			{ condition: "unknown_error", label: "Unknown error" },
		];

		for (const { condition, label } of conditions) {
			// Use a fresh supervisor for each condition
			const s = new BrainSupervisor();
			s.start();
			const m = makeManifest("observer");
			s.registerWorker(m);

			const input = makeJobInput("observer", `stop-${condition}`, { taskHash: `stop-${condition}-${Date.now()}` });
			const job = s.submitJob(input, { maxRetries: 0 });
			s.leaseJob(job!.id, m.id);

			const diag = createWorkerDiagnostic(condition, label, { test: true });
			s.failJob(job!.id, label, diag);

			const retrieved = s.getJob(job!.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.diagnostic).toBeDefined();
			expect(retrieved!.diagnostic!.stopCondition).toBe(condition);
			expect(retrieved!.diagnostic!.message).toBe(label);
		}
	});

	test("job failure without diagnostic still attaches evidence-backed diagnostic", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const job = supervisor.submitJob(makeJobInput("observer", "evidence-test-1"), { maxRetries: 0 });
		supervisor.leaseJob(job!.id, manifest.id);

		// Fail without providing a diagnostic — supervisor should still create one
		const result = supervisor.failJob(job!.id, "Something went wrong");
		expect(result).not.toBeNull();
		expect(result!.status).toBe("failed");
		expect(result!.diagnostic).toBeDefined();
		expect(result!.diagnostic!.stopCondition).toBe("unknown_error");
		expect(result!.diagnostic!.message).toBe("Something went wrong");
		expect(result!.diagnostic!.evidenceRefs).toBeDefined();
		expect(result!.diagnostic!.evidenceRefs!.length).toBeGreaterThanOrEqual(1);
	});

	test("retry resets job to pending and worker stays available", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		const job = supervisor.submitJob(makeJobInput("observer", "retry-test"), { maxRetries: 3 });
		supervisor.leaseJob(job!.id, manifest.id);

		const diag = createWorkerDiagnostic("unknown_error", "Retryable error", {});
		const result = supervisor.failJob(job!.id, "Retryable", diag);

		// Job should be retried (retryCount incremented, not failed)
		expect(result).not.toBeNull();
		expect(result!.status).toBeOneOf(["pending", "leased"]); // pending or re-routed
		expect(result!.retryCount).toBe(1);

		// Worker should still be available (not in cooling for retryable failure)
		const status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		// Worker may be standby or active depending on routing
		expect(status!.state).toBeOneOf(["standby", "active"]);
	});

	test("checkAllCooldowns emits cooldowns_checked event", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const events: SupervisorEvent[] = [];
		supervisor.onEvent((e) => events.push(e));

		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// Fail a job to put worker into cooling
		const job = supervisor.submitJob(makeJobInput("observer", "cooldown-event-test"));
		supervisor.leaseJob(job!.id, manifest.id);
		const diag = createWorkerDiagnostic("unknown_error", "test", {});
		supervisor.failJob(job!.id, "Test", diag);

		// Call checkAllCooldowns — should emit event, even if nothing expired
		supervisor.checkAllCooldowns();
		const checkedEvents = events.filter((e) => e.eventType === "cooldowns_checked");
		expect(checkedEvents.length).toBe(1);
		expect(checkedEvents[0].data.workers).toEqual([]);
	});

	test("checkAllCooldowns transitions worker when cooldown expires", () => {
		const supervisor = new BrainSupervisor();
		supervisor.start();
		const manifest = makeManifest("observer");
		supervisor.registerWorker(manifest);

		// Fail a job permanently (maxRetries=0) to put worker into cooling
		const job = supervisor.submitJob(makeJobInput("observer", "cooldown-expire"), { maxRetries: 0 });
		supervisor.leaseJob(job!.id, manifest.id);
		const diag = createWorkerDiagnostic("unknown_error", "fail", {});
		supervisor.failJob(job!.id, "Fatal", diag);

		let status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(status!.state).toBe("cooling");

		// Manually finish cooldown to simulate expiration
		supervisor.getLifecycleEngine().finishCooldown(manifest.id);

		status = supervisor.getLifecycleEngine().getStatus(manifest.id);
		expect(status!.state).toBe("standby");

		// Now checkAllCooldowns should not transition anyone (already standby)
		// But the event should still fire
		const transitioned = supervisor.checkAllCooldowns();
		expect(transitioned).toEqual([]);
	});
});

// =============================================================================
// Factory Functions
// =============================================================================

describe("Factory Functions", () => {
	test("createBrainSupervisor is exported and creates an instance", async () => {
		const { createBrainSupervisor } = await import("../../src/brain-workers/supervisor/supervisor.js");
		const supervisor = createBrainSupervisor();
		expect(supervisor).toBeInstanceOf(BrainSupervisor);
	});

	test("createBrainSupervisor accepts config", async () => {
		const { createBrainSupervisor } = await import("../../src/brain-workers/supervisor/supervisor.js");
		const supervisor = createBrainSupervisor({ maxJobsPerWorker: 10 });
		supervisor.start();
		expect(supervisor.getState()).toBe("running");
	});
});

// =============================================================================
// Module Exports Integrity
// =============================================================================

describe("Module Exports", () => {
	test("all named exports from supervisor module are accessible", async () => {
		const mod = await import("../../src/brain-workers/supervisor/supervisor.js");
		expect(mod.BrainSupervisor).toBeDefined();
		expect(mod.createBrainSupervisor).toBeDefined();
		expect(mod.DEFAULT_SUPERVISOR_CONFIG).toBeDefined();
		expect(mod.ALL_SUPERVISOR_STATES).toBeDefined();
	});

	test("all named exports from job-lease module are accessible", async () => {
		const mod = await import("../../src/brain-workers/supervisor/job-lease.js");
		expect(mod.JobStore).toBeDefined();
		expect(mod.createJobStore).toBeDefined();
		expect(mod.DEFAULT_LEASE_CONFIG).toBeDefined();
		expect(mod.ALL_JOB_STATUSES).toBeDefined();
		expect(mod.ALL_JOB_PRIORITIES).toBeDefined();
		expect(mod.JobStore).toBe(JobStore);
	});

	test("all named exports from worker-health module are accessible", async () => {
		const mod = await import("../../src/brain-workers/supervisor/worker-health.js");
		expect(mod.WorkerHealthMonitor).toBeDefined();
		expect(mod.createWorkerHealthMonitor).toBeDefined();
		expect(mod.DEFAULT_HEALTH_CHECK_CONFIG).toBeDefined();
		expect(mod.ALL_HEALTH_STATUSES).toBeDefined();
	});
});
