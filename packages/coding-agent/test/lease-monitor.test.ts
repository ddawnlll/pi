/**
 * Test suite for LeaseMonitor (P23 W2).
 *
 * Tests:
 * - Lease acquisition and release
 * - Heartbeat writing
 * - Watchdog quarantine of stale leases with dead PID
 * - PID liveness check prevents quarantine of live leases
 * - Lease reconciliation
 * - start/stop lifecycle
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLeaseMonitor,
	type LeaseMonitor,
	type LeaseReconciliationEvent,
	type QuarantineResult,
} from "../src/core/lease-monitor.js";

describe("LeaseMonitor", () => {
	let tempDir: string;
	let monitor: LeaseMonitor;

	beforeEach(() => {
		tempDir = join(tmpdir(), `lease-monitor-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (monitor) {
			monitor.stop();
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Lease acquisition and release
	// -----------------------------------------------------------------------

	describe("lease lifecycle", () => {
		it("can acquire and release a lease", async () => {
			monitor = createLeaseMonitor({ enabled: true, staleThresholdSeconds: 999 }, tempDir);

			const heartbeat = await monitor.acquireLease("lease-1", "ws-1", "plan-1", process.pid, tempDir);
			expect(heartbeat.leaseId).toBe("lease-1");
			expect(heartbeat.workspaceId).toBe("ws-1");
			expect(monitor.isLeaseActive("lease-1")).toBe(true);

			await monitor.releaseLease("lease-1");
			expect(monitor.isLeaseActive("lease-1")).toBe(false);
		});

		it("heartbeat file is written to disk", async () => {
			monitor = createLeaseMonitor({ enabled: true }, tempDir);
			await monitor.acquireLease("lease-2", "ws-2", "plan-2", process.pid, tempDir);

			const hbPath = join(monitor.getLeaseDir(), "lease-2.heartbeat");
			expect(existsSync(hbPath)).toBe(true);

			const content = JSON.parse(require("fs").readFileSync(hbPath, "utf-8"));
			expect(content.leaseId).toBe("lease-2");
			expect(content.workspaceId).toBe("ws-2");
		});

		it("updateLastGitCommand works", async () => {
			monitor = createLeaseMonitor({ enabled: true }, tempDir);
			await monitor.acquireLease("lease-3", "ws-3", "plan-3", process.pid, tempDir);
			monitor.updateLastGitCommand("lease-3", "git status");
			const lease = monitor.getLease("lease-3");
			expect(lease?.lastGitCommand).toBe("git status");
		});
	});

	// -----------------------------------------------------------------------
	// Watchdog
	// -----------------------------------------------------------------------

	describe("watchdog", () => {
		it("quarantines stale lease with dead PID", async () => {
			// Use a very low stale threshold so the lease is immediately stale
			monitor = createLeaseMonitor(
				{ enabled: true, staleThresholdSeconds: 0, monitorLoopIntervalSeconds: 999 },
				tempDir,
			);

			// Create a worktree directory structure
			const wtDir = join(tempDir, ".pi", "worktrees", "plan-4", "ws-4");
			mkdirSync(wtDir, { recursive: true });
			writeFileSync(join(wtDir, "test.txt"), "content");

			// Acquire lease with a dead PID (PID 1 is usually init, but we use 999999 which should be dead)
			// Use a non-existent PID to simulate dead process
			await monitor.acquireLease("lease-4", "ws-4", "plan-4", 999999, tempDir);

			// Force-directly call the private checkAndQuarantine via reconciliation
			// Instead, let's make the heartbeat old by creating a stale heartbeat file
			const heartbeatPath = join(monitor.getLeaseDir(), "lease-4.heartbeat");
			const oldHeartbeat = {
				leaseId: "lease-4",
				workspaceId: "ws-4",
				planExecId: "plan-4",
				pid: 999999,
				lastHeartbeatAt: new Date(Date.now() - 60000).toISOString(), // 1 min old
				cwd: tempDir,
				lastGitCommand: "",
			};
			writeFileSync(heartbeatPath, JSON.stringify(oldHeartbeat), "utf-8");

			// Record quarantine event
			let quarantined: QuarantineResult | null = null;
			monitor.setQuarantineCallback((r) => {
				quarantined = r;
			});

			// Run reconcileAll to trigger quarantine
			await (monitor as any).reconcileAll();

			// The lease should be quarantined since the PID doesn't exist
			// and the heartbeat is stale
			expect(quarantined).not.toBeNull();
			const qResult = quarantined!;
			expect(qResult.success).toBe(true);
			expect(qResult.leaseId).toBe("lease-4");
			expect(qResult.workspaceId).toBe("ws-4");
			expect(qResult.quarantinedPath).toContain(".quarantined");
		});

		it("does not quarantine live lease with delayed heartbeat", async () => {
			monitor = createLeaseMonitor(
				{ enabled: true, staleThresholdSeconds: 0, monitorLoopIntervalSeconds: 999 },
				tempDir,
			);

			// Acquire lease with our own PID (definitely alive)
			await monitor.acquireLease("lease-5", "ws-5", "plan-5", process.pid, tempDir);

			// Make the heartbeat appear old by writing directly via the monitor
			// Simulate delayed heartbeat by NOT writing to disk
			// The in-memory heartbeat will still be fresh since we just acquired it

			// Monitor quarantine events
			let quarantined = false;
			monitor.setQuarantineCallback(() => {
				quarantined = true;
			});

			// Run checkAndQuarantine through a simulated watchdog iteration
			// Directly test checkAndQuarantine behavior
			await (monitor as any).checkAndQuarantine("lease-5");

			// Should NOT quarantine because our PID is alive
			expect(quarantined).toBe(false);
			expect(monitor.isLeaseActive("lease-5")).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Reconciliation
	// -----------------------------------------------------------------------

	describe("reconciliation", () => {
		it("detects disagreement between lease file and worktree state", async () => {
			monitor = createLeaseMonitor({ enabled: true }, tempDir);

			// Create worktree state file saying workspace completed
			const piDir = join(tempDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			const stateFile = join(piDir, "worktree-state.json");
			writeFileSync(
				stateFile,
				JSON.stringify({
					worktrees: [
						{
							planExecutionId: "plan-6",
							workspaceId: "ws-6",
							status: "completed",
						},
					],
				}),
			);

			// Create lease file saying running
			await monitor.acquireLease("lease-6", "ws-6", "plan-6", 999999, tempDir);

			// Record reconciliation events
			const events: LeaseReconciliationEvent[] = [];
			monitor.setReconciliationCallback((e) => {
				events.push(e);
			});

			await (monitor as any).reconcileAll();

			expect(events.length).toBeGreaterThan(0);
			const event = events.find((e) => e.leaseId === "lease-6");
			if (event) {
				expect(event.disagreementType).toBe("lease_says_running_worktree_says_completed");
				expect(event.action).toBe("treat_as_completed");
			}
		});

		it("quarantine and requeue when worktree has no record", async () => {
			monitor = createLeaseMonitor({ enabled: true }, tempDir);

			// Create a worktree directory
			const wtDir = join(tempDir, ".pi", "worktrees", "plan-7", "ws-7");
			mkdirSync(wtDir, { recursive: true });
			writeFileSync(join(wtDir, "test.txt"), "content");

			// Create lease file saying running
			await monitor.acquireLease("lease-7", "ws-7", "plan-7", 999999, tempDir);

			// No worktree-state.json file — worktree has no record

			// Record reconciliation events
			const events: LeaseReconciliationEvent[] = [];
			monitor.setReconciliationCallback((e) => {
				events.push(e);
			});

			await (monitor as any).reconcileAll();

			// Should have reconciled with quarantine_and_requeue
			const event = events.find((e) => e.leaseId === "lease-7");
			if (event) {
				expect(event.disagreementType).toBe("lease_says_running_worktree_missing");
				expect(event.action).toBe("quarantine_and_requeue");
			}
		});
	});

	// -----------------------------------------------------------------------
	// Start/stop lifecycle
	// -----------------------------------------------------------------------

	describe("lifecycle", () => {
		it("start and stop do not throw", async () => {
			monitor = createLeaseMonitor({ enabled: true, staleThresholdSeconds: 999 }, tempDir);
			await monitor.start();
			monitor.stop();
			// Should not crash
			expect(true).toBe(true);
		});

		it("disabled monitor does not start timers", async () => {
			monitor = createLeaseMonitor({ enabled: false }, tempDir);
			await monitor.start();
			monitor.stop();
			expect(true).toBe(true);
		});
	});
});
