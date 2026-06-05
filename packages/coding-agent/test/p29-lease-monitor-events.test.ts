import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeaseMonitor } from "../src/core/lease-monitor.js";
import { InMemoryActorEventSink } from "../src/execution-runtime/actor-events.js";

describe("P29 lease monitor event-only", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `p29-lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("emits stale and quarantine requested events", async () => {
		const sink = new InMemoryActorEventSink();
		const monitor = createLeaseMonitor({ enabled: true, staleThresholdSeconds: 0 }, tempDir, sink);
		const wtDir = join(tempDir, ".pi", "worktrees", "plan-1", "ws-1");
		mkdirSync(wtDir, { recursive: true });
		writeFileSync(join(wtDir, "test.txt"), "x");
		await monitor.acquireLease("lease-1", "ws-1", "plan-1", 999999, tempDir);
		writeFileSync(
			join(monitor.getLeaseDir(), "lease-1.heartbeat"),
			JSON.stringify({
				leaseId: "lease-1",
				workspaceId: "ws-1",
				planExecId: "plan-1",
				pid: 999999,
				lastHeartbeatAt: new Date(Date.now() - 60000).toISOString(),
				cwd: tempDir,
				lastGitCommand: "",
			}),
		);

		await (monitor as any).checkAndQuarantine("lease-1");

		expect(sink.events.some((e) => e.type === "lease_stale_detected")).toBe(true);
		expect(sink.events.some((e) => e.type === "lease_quarantine_requested")).toBe(true);
	});
});
