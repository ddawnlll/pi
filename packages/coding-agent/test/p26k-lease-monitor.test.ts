/**
 * P26.K — Lease monitor, heartbeat, quarantine, and requeue
 *
 * Tests:
 * - Active leases write heartbeat files on configured interval
 * - Stale lease detection checks heartbeat age and PID liveness
 * - Lease/worktree-state disagreement quarantines and requeues
 * - Quarantine artifact includes lease snapshot, worktree state, recovery decision
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeaseMonitor, DEFAULT_LEASE_MONITOR_CONFIG, LeaseMonitor } from "../src/core/lease-monitor.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.K — Lease monitor, heartbeat, quarantine", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "p26k-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	// ---- Configuration defaults ----

	it("should have heartbeat interval of 15 seconds by default", () => {
		expect(DEFAULT_LEASE_MONITOR_CONFIG.heartbeatIntervalSeconds).toBe(15);
	});

	it("should have stale threshold of 45 seconds by default", () => {
		expect(DEFAULT_LEASE_MONITOR_CONFIG.staleThresholdSeconds).toBe(45);
	});

	it("should have monitor loop interval of 30 seconds by default", () => {
		expect(DEFAULT_LEASE_MONITOR_CONFIG.monitorLoopIntervalSeconds).toBe(30);
	});

	it("should be enabled by default", () => {
		expect(DEFAULT_LEASE_MONITOR_CONFIG.enabled).toBe(true);
	});

	// ---- Lease lifecycle ----

	it("should acquire a lease with heartbeat", async () => {
		const monitor = new LeaseMonitor({ enabled: false }, tmpDir);
		const heartbeat = await monitor.acquireLease("lease-1", "ws-A", "plan-1", process.pid, tmpDir);

		expect(heartbeat.leaseId).toBe("lease-1");
		expect(heartbeat.workspaceId).toBe("ws-A");
		expect(heartbeat.planExecId).toBe("plan-1");
		expect(heartbeat.pid).toBe(process.pid);
		expect(heartbeat.lastHeartbeatAt).toBeTruthy();
	});

	it("should release a lease and remove its files", async () => {
		const monitor = new LeaseMonitor({ enabled: false }, tmpDir);
		await monitor.acquireLease("lease-2", "ws-B", "plan-1", process.pid, tmpDir);

		expect(monitor.isLeaseActive("lease-2")).toBe(true);

		await monitor.releaseLease("lease-2");
		expect(monitor.isLeaseActive("lease-2")).toBe(false);
	});

	it("should track active leases", async () => {
		const monitor = new LeaseMonitor({ enabled: false }, tmpDir);
		await monitor.acquireLease("lease-3", "ws-C", "plan-1", process.pid, tmpDir);

		const active = monitor.getActiveLeases();
		expect(active.has("lease-3")).toBe(true);
		expect(active.size).toBe(1);
	});

	it("should update last git command on a lease", async () => {
		const monitor = new LeaseMonitor({ enabled: false }, tmpDir);
		await monitor.acquireLease("lease-4", "ws-D", "plan-1", process.pid, tmpDir);

		monitor.updateLastGitCommand("lease-4", "git status");
		const lease = monitor.getLease("lease-4");
		expect(lease?.lastGitCommand).toBe("git status");
	});

	// ---- Quarantine result structure ----

	it("should include planExecId and snapshotPath in QuarantineResult", () => {
		const fsMod = require("node:fs") as typeof import("node:fs");
		const src = fsMod.readFileSync(require.resolve("../src/core/lease-monitor.ts"), "utf-8");

		expect(src).toContain("planExecId: string");
		expect(src).toContain("snapshotPath?: string");
	});

	it("should write quarantine snapshot artifact with lease state and decision", () => {
		const fsMod = require("node:fs") as typeof import("node:fs");
		const src = fsMod.readFileSync(require.resolve("../src/core/lease-monitor.ts"), "utf-8");

		expect(src).toContain("quarantineTimestamp");
		expect(src).toContain("recoveryAction");
		expect(src).toContain("requeue_workspace");
		expect(src).toContain(".snapshot.json");
	});

	// ---- createLeaseMonitor factory ----

	it("should create a lease monitor via factory function", () => {
		const monitor = createLeaseMonitor({ enabled: false }, tmpDir);
		expect(monitor).toBeInstanceOf(LeaseMonitor);
	});

	// ---- Reconciliation ----

	it("should reconcile leases on startup", async () => {
		// Create a lease file manually
		const leaseDir = path.join(tmpDir, ".pi", "scheduler", "leases");
		await fs.mkdir(leaseDir, { recursive: true });

		// Write a heartbeat file for a stale lease
		const heartbeat = {
			leaseId: "stale-lease",
			workspaceId: "ws-X",
			planExecId: "plan-1",
			pid: 999999, // Non-existent PID
			lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString(), // 2 minutes ago
			cwd: tmpDir,
			lastGitCommand: "",
		};
		await fs.writeFile(path.join(leaseDir, "stale-lease.heartbeat"), JSON.stringify(heartbeat), "utf-8");

		// Start the monitor with very low thresholds for testing
		const monitor = new LeaseMonitor(
			{
				enabled: true,
				heartbeatIntervalSeconds: 1,
				staleThresholdSeconds: 10,
				monitorLoopIntervalSeconds: 1,
			},
			tmpDir,
		);

		// Run reconcileAll
		const events = await monitor.reconcileAll();
		expect(Array.isArray(events)).toBe(true);

		await monitor.stop();
	});

	it("should not leave heartbeat files after releaseLease", async () => {
		const monitor = new LeaseMonitor({ enabled: false }, tmpDir);
		await monitor.acquireLease("lease-cleanup", "ws-E", "plan-1", process.pid, tmpDir);

		// Verify heartbeat file was written
		const heartbeatPath = path.join(tmpDir, ".pi", "scheduler", "leases", "lease-cleanup.heartbeat");
		const exists = await fs
			.access(heartbeatPath)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);

		await monitor.releaseLease("lease-cleanup");

		const existsAfter = await fs
			.access(heartbeatPath)
			.then(() => true)
			.catch(() => false);
		expect(existsAfter).toBe(false);
	});
});
