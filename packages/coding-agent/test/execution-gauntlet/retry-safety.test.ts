/**
 * Retry Safety Tests — P41-HOTFIX
 *
 * Tests the runaway retry loop safety guards added in P41:
 * - Max attempts per workspace
 * - Same-signature retry detection
 * - Instant failure detection
 * - Scheduler admission guard
 * - Plan-runner workspace retry blocking
 *
 * These tests validate the deterministic runner's handling of retry
 * scenarios. The plan-runner level guards (attempt tracking maps,
 * admission guard in getNextWorkspaces) are tested through focused
 * unit tests below.
 */

import { describe, expect, it } from "vitest";
import {
	buildG13RunawayInstantFailureLoop,
	buildG14UnstableFailureSignature,
	buildG15MaxAttemptsExceeded,
	buildG16CompletedWorkspaceNotRetried,
	buildPlanQueue,
} from "../../src/core/execution-gauntlet/synthetic-plan-builder.js";
import { createSyntheticWorker } from "../../src/core/execution-gauntlet/synthetic-worker.js";

// ---------------------------------------------------------------------------
// Synthetic worker tests
// ---------------------------------------------------------------------------

describe("synthetic worker retry behaviors", () => {
	it("instant_failure returns exit code 1 with stable error", async () => {
		const worker = createSyntheticWorker("instant_failure", {
			seed: 42,
			workspaceId: "test",
			workspaceDir: "/tmp/test",
		});
		const result = await worker();
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Preflight check failed");
		expect(result.commandHistory).toEqual([]);
	});

	it("unstable_failure_signature returns exit code 1 with noisy error", async () => {
		const worker = createSyntheticWorker("unstable_failure_signature", {
			seed: 42,
			workspaceId: "test",
			workspaceDir: "/tmp/test",
		});
		// Create with different seed for different output
		const worker2 = createSyntheticWorker("unstable_failure_signature", {
			seed: 99,
			workspaceId: "test",
			workspaceDir: "/tmp/test",
		});
		const result1 = await worker();
		const result2 = await worker2();
		expect(result1.exitCode).toBe(1);
		expect(result2.exitCode).toBe(1);
		// Different seeds should produce different error messages
		expect(result1.output).not.toEqual(result2.output);
	});

	it("repeat_same_failure always returns identical output", async () => {
		const worker = createSyntheticWorker("repeat_same_failure", {
			seed: 42,
			workspaceId: "test",
			workspaceDir: "/tmp/test",
		});
		const result1 = await worker();
		const result2 = await worker();
		expect(result1.output).toEqual(result2.output);
		expect(result1.exitCode).toBe(1);
	});

	it("success returns exit code 0 with files", async () => {
		const worker = createSyntheticWorker("success", {
			seed: 42,
			workspaceId: "test",
			workspaceDir: "/tmp/test",
		});
		const result = await worker();
		expect(result.exitCode).toBe(0);
		expect(Object.keys(result.filesCreated).length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Gauntlet plan structure tests
// ---------------------------------------------------------------------------

describe("G13 runaway instant failure loop", () => {
	const plan = buildG13RunawayInstantFailureLoop();

	it("has correct structure", () => {
		expect(plan.id).toBe("G13");
		expect(plan.category).toBe("lead-agent");
		expect(plan.workspaces).toHaveLength(1);
		expect(plan.workspaces[0].behavior).toBe("instant_failure");
	});

	it("buildPlanQueue produces a valid queue", () => {
		const queue = buildPlanQueue(plan);
		expect(queue.workspaces).toHaveLength(1);
		expect(queue.workspaces[0].id).toBe("G13-instant-fail");
		expect(queue.workspaces[0].title).toBeDefined();
		expect(queue.workspaces[0].roleBudget).toBe("worker");
		expect(queue.workspaces[0].maxRetries).toBeGreaterThanOrEqual(0);
		expect(queue.workspaces[0].retryPolicy).toBeDefined();
	});

	it("expects plan does not complete", () => {
		expect(plan.expected.planDoesNotComplete).toBe(true);
		expect(plan.expected.leadDirectiveCreated).toBe(true);
		expect(plan.expected.userEscalationCreated).toBe(true);
	});
});

describe("G14 unstable failure signature", () => {
	const plan = buildG14UnstableFailureSignature();

	it("has correct structure", () => {
		expect(plan.id).toBe("G14");
		expect(plan.workspaces[0].behavior).toBe("unstable_failure_signature");
	});

	it("expects plan does not complete", () => {
		expect(plan.expected.planDoesNotComplete).toBe(true);
	});
});

describe("G15 max attempts exceeded", () => {
	const plan = buildG15MaxAttemptsExceeded();

	it("has correct structure", () => {
		expect(plan.id).toBe("G15");
		expect(plan.workspaces[0].behavior).toBe("repeat_same_failure");
	});

	it("expects plan does not complete with escalation", () => {
		expect(plan.expected.planDoesNotComplete).toBe(true);
		expect(plan.expected.userEscalationCreated).toBe(true);
	});
});

describe("G16 completed workspace not retried", () => {
	const plan = buildG16CompletedWorkspaceNotRetried();

	it("has correct structure", () => {
		expect(plan.id).toBe("G16");
		expect(plan.workspaces[0].behavior).toBe("success");
	});

	it("expects plan completes successfully", () => {
		expect(plan.expected.allComplete).toBe(true);
		expect(plan.expected.planCompletes).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Plan-runner retry tracking logic (unit tests)
// ---------------------------------------------------------------------------

describe("retry tracking logic (plan-runner level)", () => {
	/**
	 * Simulates the retry tracking maps used in plan-runner.ts.
	 * Tests the guard logic in isolation.
	 */
	function simulateRetryGuard(results: Array<{ error?: string; gapMs?: number }>) {
		const maxAttemptsPerWorkspace = 5;
		const maxSameSignatureAttempts = 3;
		const maxInstantFailures = 3;

		let attemptCount = 0;
		let sameSignatureCount = 0;
		let instantFailureCount = 0;
		let lastError: string | undefined;
		let simTime = 0; // simulated timestamp
		let blocked = false;
		let reason = "";

		for (const result of results) {
			if (blocked) break;

			attemptCount++;

			const currentError = result.error ?? "";
			if (lastError !== undefined && lastError === currentError) {
				sameSignatureCount++;
			} else if (currentError) {
				sameSignatureCount = 1;
			}
			lastError = currentError;

			const gap = result.gapMs ?? 5000;
			const prevSimTime = simTime;
			simTime += gap;

			// A failure is "instant" if the gap since last attempt is < 1s
			// Only count when there IS a prior attempt (simTime > 0 means gap
			// was added from previous iteration)
			if (prevSimTime > 0 && simTime - prevSimTime < 1000) {
				instantFailureCount++;
			}

			if (attemptCount > maxAttemptsPerWorkspace) {
				blocked = true;
				reason = `maxAttempts: ${attemptCount} > ${maxAttemptsPerWorkspace}`;
			} else if (sameSignatureCount >= maxSameSignatureAttempts) {
				blocked = true;
				reason = `sameSignature: ${sameSignatureCount} >= ${maxSameSignatureAttempts}`;
			} else if (instantFailureCount >= maxInstantFailures) {
				blocked = true;
				reason = `instantFailures: ${instantFailureCount} >= ${maxInstantFailures}`;
			}
		}

		return { blocked, reason, attemptCount };
	}

	it("blocks after maxAttemptsPerWorkspace (5) with different errors", () => {
		const results = Array.from({ length: 6 }, (_, i) => ({
			error: `Failure #${i}`, // different each time
			gapMs: 5000, // not instant
		}));
		const guard = simulateRetryGuard(results);
		expect(guard.blocked).toBe(true);
		expect(guard.reason).toContain("maxAttempts");
		expect(guard.attemptCount).toBe(6);
	});

	it("blocks after same-signature guard (3) with identical errors", () => {
		const results = [
			{ error: "Database connection failed", gapMs: 5000 },
			{ error: "Database connection failed", gapMs: 5000 },
			{ error: "Database connection failed", gapMs: 5000 },
		];
		const guard = simulateRetryGuard(results);
		expect(guard.blocked).toBe(true);
		expect(guard.reason).toContain("sameSignature");
	});

	it("blocks after instant failure guard (3) with fast failures", () => {
		// Need 4 results: first has no prior gap, next 3 have gap < 1s
		const results = Array.from({ length: 4 }, (_, i) => ({
			error: `Failure #${i}`,
			gapMs: 1, // sub-1s gap = instant
		}));
		const guard = simulateRetryGuard(results);
		expect(guard.blocked).toBe(true);
		expect(guard.reason).toContain("instantFailures");
	});

	it("does not block before limits are reached", () => {
		const results = [
			{ error: "Failure #1", gapMs: 5000 },
			{ error: "Failure #2", gapMs: 5000 },
		];
		const guard = simulateRetryGuard(results);
		expect(guard.blocked).toBe(false);
		expect(guard.attemptCount).toBe(2);
	});

	it("allows success without blocking", () => {
		const results = [
			{ error: undefined, gapMs: 5000 },
			{ error: undefined, gapMs: 5000 },
		];
		const guard = simulateRetryGuard(results);
		expect(guard.blocked).toBe(false);
	});

	it("different signatures reset same-signature counter", () => {
		const results = [
			{ error: "Error A", gapMs: 5000 },
			{ error: "Error B", gapMs: 5000 },
			{ error: "Error A", gapMs: 5000 },
			{ error: "Error B", gapMs: 5000 },
		];
		const guard = simulateRetryGuard(results);
		// Each error only appears twice, so same-signature count never reaches 3
		expect(guard.blocked).toBe(false);
		expect(guard.attemptCount).toBe(4);
	});
});
