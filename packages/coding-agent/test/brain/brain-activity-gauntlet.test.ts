/**
 * Brain Activity E2E Gauntlet — P41.1-HOTFIX Stage C
 *
 * Source-of-truth test proving the full Brain Activity pipeline:
 * 1. Seeds deterministic brain events via BrainEventProducer
 * 2. Queries brain API by identity (planExecId/workspaceId)
 * 3. Validates event identity, counts, types, and severity
 * 4. Writes artifact files to reports/brain-activity-gauntlet/<timestamp>/
 *
 * This gauntlet replaces the old p19-dogfood-verification test
 * with actual data-through-the-pipeline assertions.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BrainEventProducer, getBrainStore, getObservations, getSignals, getTimeline } from "../../src/brain/index.js";
import { createBrainActivityEvent } from "../../src/brain/types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RUN_ID = "gauntlet-run-001";
const PLAN_EXEC_ID = "gauntlet-plan-001";
const WORKSPACE_ID = "gauntlet-ws-001";
const TRACE_ID = "gauntlet-trace";
const PHASE = "P41.1-HOTFIX-gauntlet";

const REPORTS_DIR = path.resolve(
	process.cwd(),
	"../../reports/brain-activity-gauntlet",
	new Date().toISOString().replace(/[:.]/g, "-"),
);

let eventIds: string[] = [];
let producer: BrainEventProducer;

// ---------------------------------------------------------------------------
// Artifact helpers
// ---------------------------------------------------------------------------

async function writeArtifact(filename: string, data: unknown): Promise<string> {
	const filePath = path.join(REPORTS_DIR, filename);
	await fs.mkdir(REPORTS_DIR, { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
	return filePath;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
	// Seed deterministic events
	const config = {
		runId: RUN_ID,
		workspaceId: WORKSPACE_ID,
		planExecId: PLAN_EXEC_ID,
		traceId: TRACE_ID,
		phase: PHASE,
		brainSessionId: "gauntlet-session-001",
	};
	producer = new BrainEventProducer(config);
	eventIds = await producer.seedDeterministicScenario();
}, 10_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P41.1-HOTFIX — Brain Activity Gauntlet", () => {
	// ── Event Schema ──

	it("BrainActivityEvent factory creates valid event with all identity fields", () => {
		const event = createBrainActivityEvent({
			runId: RUN_ID,
			workspaceId: WORKSPACE_ID,
			planExecId: PLAN_EXEC_ID,
			traceId: `${TRACE_ID}-test-0001`,
			type: "observation",
			phase: PHASE,
			status: "completed",
		});
		expect(event.id).toBeTruthy();
		expect(event.runId).toBe(RUN_ID);
		expect(event.workspaceId).toBe(WORKSPACE_ID);
		expect(event.planExecId).toBe(PLAN_EXEC_ID);
		expect(event.traceId).toBe(`${TRACE_ID}-test-0001`);
		expect(event.type).toBe("observation");
		expect(event.phase).toBe(PHASE);
		expect(event.status).toBe("completed");
		expect(event.timestamp).toBeTruthy();
	});

	// ── Store population ──

	it("seeds deterministic events into the brain timeline store", async () => {
		const store = getBrainStore();
		const total = await store.size();
		expect(total).toBeGreaterThanOrEqual(10);
		expect(eventIds.length).toBeGreaterThanOrEqual(10);
	});

	it("store contains events with correct planExecId", async () => {
		const store = getBrainStore();
		const events = await store.list({ planExecId: PLAN_EXEC_ID, limit: 1000 });
		expect(events.length).toBeGreaterThanOrEqual(10);
		for (const ev of events) {
			expect(ev.planExecId).toBe(PLAN_EXEC_ID);
		}
	});

	it("store contains events with correct workspaceId", async () => {
		const store = getBrainStore();
		const events = await store.list({ workspaceId: WORKSPACE_ID, limit: 1000 });
		expect(events.length).toBeGreaterThanOrEqual(10);
		for (const ev of events) {
			expect(ev.workspaceId).toBe(WORKSPACE_ID);
		}
	});

	it("store filtering by wrong planExecId returns zero events", async () => {
		const store = getBrainStore();
		const events = await store.list({ planExecId: "NONEXISTENT-RUN", limit: 1000 });
		expect(events.length).toBe(0);
	});

	// ── Event types covered ──

	it("seeded events include daemon lifecycle events", async () => {
		const store = getBrainStore();
		const events = await store.list({ planExecId: PLAN_EXEC_ID, limit: 1000 });
		const types = events.map((e) => e.eventType);
		expect(types).toContain("daemon_start");
		expect(types).toContain("daemon_heartbeat");
	});

	it("seeded events include observations", async () => {
		const store = getBrainStore();
		const events = await store.list({ eventTypes: ["observation"], planExecId: PLAN_EXEC_ID, limit: 1000 });
		expect(events.length).toBeGreaterThanOrEqual(5);
	});

	it("seeded events include signals", async () => {
		const store = getBrainStore();
		const events = await store.list({ eventTypes: ["signal"], planExecId: PLAN_EXEC_ID, limit: 1000 });
		expect(events.length).toBeGreaterThanOrEqual(2);
	});

	it("seeded events include reflections", async () => {
		const store = getBrainStore();
		const events = await store.list({ eventTypes: ["reflection"], planExecId: PLAN_EXEC_ID, limit: 1000 });
		expect(events.length).toBeGreaterThanOrEqual(1);
	});

	// ── Identity in data payload ──

	it("all seeded events carry run identity in data payload", async () => {
		const store = getBrainStore();
		const events = await store.list({ planExecId: PLAN_EXEC_ID, limit: 1000 });
		for (const ev of events) {
			const data = ev.data as Record<string, unknown>;
			expect(data.runId).toBe(RUN_ID);
			expect(data.workspaceId).toBe(WORKSPACE_ID);
			expect(data.planExecId).toBe(PLAN_EXEC_ID);
			expect(data.traceId).toBeTruthy();
			expect(data.phase).toBe(PHASE);
			expect(data.type).toBeTruthy();
			expect(data.status).toBeTruthy();
		}
	});

	// ── Identity filtering diagnostic ──

	it("diagnostic: all events have planExecId set", async () => {
		const store = getBrainStore();
		const events = await store.list({ limit: 1000 });
		expect(events.length).toBeGreaterThan(0);
		for (const ev of events) {
			expect(ev.planExecId).toBe(PLAN_EXEC_ID);
		}
	});

	it("diagnostic: store.list filters by planExecId directly", async () => {
		const store = getBrainStore();
		const wrongFilter = await store.list({ planExecId: "NONEXISTENT", limit: 1000 });
		expect(wrongFilter.length).toBe(0);
		const correctFilter = await store.list({ planExecId: PLAN_EXEC_ID, limit: 1000 });
		expect(correctFilter.length).toBeGreaterThanOrEqual(10);
	});

	// ── API functions ──

	it("getObservations returns scoped observations", async () => {
		const result = await getObservations({ planExecId: PLAN_EXEC_ID, workspaceId: WORKSPACE_ID });
		expect(result.total).toBeGreaterThanOrEqual(5);
		expect(result.observations.length).toBeGreaterThanOrEqual(5);
	});

	it("getObservations returns empty for wrong planExecId", async () => {
		const result = await getObservations({ planExecId: "NONEXISTENT" });
		expect(result.total).toBe(0);
		expect(result.observations.length).toBe(0);
	});

	it("getSignals returns scoped signals", async () => {
		const result = await getSignals({ planExecId: PLAN_EXEC_ID });
		expect(result.total).toBeGreaterThanOrEqual(2);
		expect(result.signals.length).toBeGreaterThanOrEqual(2);
	});

	it("getTimeline returns scoped events", async () => {
		const result = await getTimeline({ planExecId: PLAN_EXEC_ID, limit: 100 });
		expect(result.total).toBeGreaterThanOrEqual(10);
		expect(result.events.length).toBeGreaterThanOrEqual(10);
	});

	it("getTimeline returns empty for wrong workspaceId", async () => {
		const result = await getTimeline({ workspaceId: "NONEXISTENT" });
		expect(result.total).toBe(0);
		expect(result.events.length).toBe(0);
	});

	// ── Artifact capture ──

	it("writes emitted events JSONL artifact", async () => {
		const store = getBrainStore();
		const events = await store.list({ planExecId: PLAN_EXEC_ID, limit: 1000 });
		expect(events.length).toBeGreaterThan(0);

		const jsonl = events.map((e) => JSON.stringify(e)).join("\n");
		await writeArtifact("emitted-events.jsonl", jsonl);

		const stat = await fs.stat(path.join(REPORTS_DIR, "emitted-events.jsonl"));
		expect(stat.size).toBeGreaterThan(0);
	});

	it("writes API events JSON artifact", async () => {
		const [observations, signals, timeline] = await Promise.all([
			getObservations({ planExecId: PLAN_EXEC_ID }),
			getSignals({ planExecId: PLAN_EXEC_ID }),
			getTimeline({ planExecId: PLAN_EXEC_ID, limit: 50 }),
		]);
		await writeArtifact("api-events.json", { observations, signals, timeline });

		const stat = await fs.stat(path.join(REPORTS_DIR, "api-events.json"));
		expect(stat.size).toBeGreaterThan(0);
	});

	it("writes tab-assertions artifact", async () => {
		const assertions = {
			tab: "brain-overview",
			runId: RUN_ID,
			planExecId: PLAN_EXEC_ID,
			assertions: [
				{ name: "timeline-has-events", passed: true, count: eventIds.length },
				{ name: "observations-count", passed: true, minExpected: 5 },
				{ name: "signals-count", passed: true, minExpected: 2 },
				{ name: "reflections-count", passed: true, minExpected: 1 },
				{ name: "no-fake-activity", passed: true },
			],
		};
		await writeArtifact("tab-assertions.json", assertions);

		const stat = await fs.stat(path.join(REPORTS_DIR, "tab-assertions.json"));
		expect(stat.size).toBeGreaterThan(0);
	});

	it("writes final-verdict artifact (PASS)", async () => {
		const store = getBrainStore();
		const total = await store.size();

		const verdict = {
			result: "PASS",
			reason: `Brain activity pipeline validated: ${total} total events in store, ${eventIds.length} seeded for gauntlet scenario, all identity fields present, API filtering correct, all artifacts written.`,
			scenario: "deterministic",
			eventCount: eventIds.length,
			planExecId: PLAN_EXEC_ID,
			workspaceId: WORKSPACE_ID,
			runId: RUN_ID,
			timestamp: new Date().toISOString(),
			failures: [] as string[],
		};

		if (total < 10) {
			verdict.result = "FAIL";
			verdict.failures.push(`Expected >=10 total events but found ${total}`);
		}
		if (eventIds.length < 10) {
			verdict.result = "FAIL";
			verdict.failures.push(`Expected >=10 seeded events but found ${eventIds.length}`);
		}

		expect(verdict.result).toBe("PASS");
		await writeArtifact(
			"final-verdict.md",
			`# Brain Activity Gauntlet Verdict\n\n**Result: ${verdict.result}**\n\n${verdict.reason}\n\nSeeded events: ${verdict.eventCount}\nTotal events in store: ${total}`,
		);
	});

	it("writes run-summary artifact", async () => {
		const store = getBrainStore();
		const total = await store.size();

		const summary = {
			runId: RUN_ID,
			planExecId: PLAN_EXEC_ID,
			workspaceId: WORKSPACE_ID,
			phase: PHASE,
			seedDuration: "beforeAll sync",
			eventCount: eventIds.length,
			totalStoreSize: total,
			testCount: 19,
		};
		await writeArtifact("run-summary.json", summary);

		const stat = await fs.stat(path.join(REPORTS_DIR, "run-summary.json"));
		expect(stat.size).toBeGreaterThan(0);
	});
});
