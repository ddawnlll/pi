/**
 * Brain Timeline Store — test suite.
 *
 * Covers:
 * - Appending single and batch events with validation
 * - Retrieving events by ID
 * - Listing with filters, sort, pagination
 * - Counting, pruning, clearing
 * - JSON file persistence (save/load)
 * - Store metadata (size, earliest/latest timestamps)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	type BrainTimelineEvent,
	createBrainTimelineEvent,
	InMemoryBrainTimelineStore,
} from "../../src/brain/index.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makeHeartbeat(overrides?: Partial<BrainTimelineEvent>): BrainTimelineEvent {
	return createBrainTimelineEvent({
		eventType: "daemon_heartbeat",
		severity: "info",
		data: { uptimeMs: 1000 },
		...overrides,
	});
}

function makeObservation(overrides?: Partial<BrainTimelineEvent>): BrainTimelineEvent {
	return createBrainTimelineEvent({
		eventType: "observation",
		severity: "warning",
		data: { signalType: "queue_blocked", title: "Queue blocked" },
		...overrides,
	});
}

function makeSignal(overrides?: Partial<BrainTimelineEvent>): BrainTimelineEvent {
	return createBrainTimelineEvent({
		eventType: "signal",
		severity: "critical",
		data: { pattern: "retry_hotspot", summary: "Retry hotspot detected" },
		...overrides,
	});
}

/** Create a fully deterministic event for predictable tests. */
function fixedEvent(
	overrides: Partial<BrainTimelineEvent> & {
		eventType: BrainTimelineEvent["eventType"];
		severity: BrainTimelineEvent["severity"];
		id: string;
		timestamp: string;
	},
): BrainTimelineEvent {
	return {
		id: overrides.id,
		timestamp: overrides.timestamp,
		eventType: overrides.eventType,
		severity: overrides.severity,
		data: overrides.data ?? {},
		workspaceId: overrides.workspaceId,
		planExecId: overrides.planExecId,
	};
}

// ── Setup / Teardown ───────────────────────────────────────────────────

let store: InMemoryBrainTimelineStore;
let tmpDir: string;

beforeEach(async () => {
	store = new InMemoryBrainTimelineStore();
	tmpDir = await fs.mkdtemp("timeline-store-test-");
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// ── Append ─────────────────────────────────────────────────────────────

describe("append", () => {
	test("appends a single valid event", async () => {
		const event = makeHeartbeat();
		await store.append(event);

		expect(await store.size()).toBe(1);
		const retrieved = await store.get(event.id);
		expect(retrieved).toEqual(event);
	});

	test("throws on invalid event (missing eventType)", async () => {
		const invalid = { ...makeHeartbeat(), eventType: undefined };
		await expect(store.append(invalid as unknown as BrainTimelineEvent)).rejects.toThrow("Invalid");
	});

	test("throws on invalid event (bad severity)", async () => {
		const invalid = { ...makeHeartbeat(), severity: "extreme" };
		await expect(store.append(invalid as unknown as BrainTimelineEvent)).rejects.toThrow("Invalid");
	});
});

describe("appendBatch", () => {
	test("appends multiple events", async () => {
		const events = [makeHeartbeat(), makeObservation(), makeSignal()];
		await store.appendBatch(events);

		expect(await store.size()).toBe(3);
	});

	test("throws if any event in batch is invalid", async () => {
		const events = [makeHeartbeat(), { ...makeObservation(), eventType: undefined } as unknown as BrainTimelineEvent];
		await expect(store.appendBatch(events)).rejects.toThrow("Invalid");
		// Entire batch should be rejected
		expect(await store.size()).toBe(0);
	});
});

// ── Get ────────────────────────────────────────────────────────────────

describe("get", () => {
	test("returns null for non-existent id", async () => {
		const result = await store.get("non-existent");
		expect(result).toBeNull();
	});

	test("returns event by id", async () => {
		const event = makeHeartbeat();
		await store.append(event);

		const result = await store.get(event.id);
		expect(result).toBeDefined();
		expect(result!.id).toBe(event.id);
	});
});

// ── List ───────────────────────────────────────────────────────────────

describe("list", () => {
	test("returns empty array when store is empty", async () => {
		const events = await store.list();
		expect(events).toEqual([]);
	});

	test("returns all events sorted by timestamp descending by default", async () => {
		const e1 = fixedEvent({
			id: "1",
			timestamp: "2026-01-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e2 = fixedEvent({
			id: "2",
			timestamp: "2026-01-02T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e3 = fixedEvent({
			id: "3",
			timestamp: "2026-01-03T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		await store.appendBatch([e1, e2, e3]);

		const events = await store.list();
		expect(events.map((e) => e.id)).toEqual(["3", "2", "1"]);
	});

	test("sorts ascending when order is 'asc'", async () => {
		const e1 = fixedEvent({
			id: "1",
			timestamp: "2026-01-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e2 = fixedEvent({
			id: "2",
			timestamp: "2026-01-02T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		await store.appendBatch([e2, e1]);

		const events = await store.list({ order: "asc" });
		expect(events.map((e) => e.id)).toEqual(["1", "2"]);
	});

	test("filters by eventType", async () => {
		await store.appendBatch([makeHeartbeat(), makeObservation(), makeSignal()]);

		const events = await store.list({ eventTypes: ["observation"] });
		expect(events).toHaveLength(1);
		expect(events[0].eventType).toBe("observation");
	});

	test("filters by severity", async () => {
		await store.appendBatch([makeHeartbeat(), makeObservation(), makeSignal()]);

		const events = await store.list({ severities: ["critical"] });
		expect(events).toHaveLength(1);
		expect(events[0].severity).toBe("critical");
	});

	test("filters by workspaceId", async () => {
		const ws1 = makeHeartbeat({ workspaceId: "ws-1" });
		const ws2 = makeObservation({ workspaceId: "ws-2" });
		await store.appendBatch([ws1, ws2]);

		const events = await store.list({ workspaceId: "ws-1" });
		expect(events).toHaveLength(1);
		expect(events[0].workspaceId).toBe("ws-1");
	});

	test("filters by planExecId", async () => {
		const pe1 = makeHeartbeat({ planExecId: "plan-1" });
		const pe2 = makeObservation({ planExecId: "plan-2" });
		await store.appendBatch([pe1, pe2]);

		const events = await store.list({ planExecId: "plan-1" });
		expect(events).toHaveLength(1);
		expect(events[0].planExecId).toBe("plan-1");
	});

	test("filters by time range (since/until)", async () => {
		const e1 = fixedEvent({
			id: "1",
			timestamp: "2026-01-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e2 = fixedEvent({
			id: "2",
			timestamp: "2026-01-15T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e3 = fixedEvent({
			id: "3",
			timestamp: "2026-02-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		await store.appendBatch([e1, e2, e3]);

		const events = await store.list({ since: "2026-01-10T00:00:00.000Z", until: "2026-01-20T00:00:00.000Z" });
		expect(events).toHaveLength(1);
		expect(events[0].id).toBe("2");
	});

	test("supports pagination (offset + limit)", async () => {
		const events = Array.from({ length: 10 }, (_, i) =>
			fixedEvent({
				id: String(i),
				timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
				eventType: "daemon_heartbeat",
				severity: "info",
			}),
		);
		await store.appendBatch(events);

		const page1 = await store.list({ limit: 3, offset: 0, order: "asc" });
		expect(page1.map((e) => e.id)).toEqual(["0", "1", "2"]);

		const page2 = await store.list({ limit: 3, offset: 3, order: "asc" });
		expect(page2.map((e) => e.id)).toEqual(["3", "4", "5"]);
	});

	test("applies multiple filters simultaneously", async () => {
		const e1 = fixedEvent({
			id: "1",
			timestamp: "2026-01-01T00:00:00.000Z",
			eventType: "observation",
			severity: "warning",
			workspaceId: "ws-1",
		});
		const e2 = fixedEvent({
			id: "2",
			timestamp: "2026-01-02T00:00:00.000Z",
			eventType: "observation",
			severity: "critical",
			workspaceId: "ws-1",
		});
		const e3 = fixedEvent({
			id: "3",
			timestamp: "2026-01-03T00:00:00.000Z",
			eventType: "signal",
			severity: "critical",
			workspaceId: "ws-1",
		});
		await store.appendBatch([e1, e2, e3]);

		const events = await store.list({
			eventTypes: ["observation"],
			severities: ["critical"],
			workspaceId: "ws-1",
		});
		expect(events).toHaveLength(1);
		expect(events[0].id).toBe("2");
	});
});

// ── Count ──────────────────────────────────────────────────────────────

describe("count", () => {
	test("returns 0 for empty store", async () => {
		expect(await store.count()).toBe(0);
	});

	test("counts all events", async () => {
		await store.appendBatch([makeHeartbeat(), makeObservation()]);
		expect(await store.count()).toBe(2);
	});

	test("counts with filters", async () => {
		await store.appendBatch([makeHeartbeat(), makeObservation(), makeSignal()]);
		expect(await store.count({ eventTypes: ["observation"] })).toBe(1);
		expect(await store.count({ severities: ["info"] })).toBe(1);
	});
});

// ── Clear ──────────────────────────────────────────────────────────────

describe("clear", () => {
	test("removes all events", async () => {
		await store.appendBatch([makeHeartbeat(), makeObservation()]);
		expect(await store.size()).toBe(2);

		await store.clear();
		expect(await store.size()).toBe(0);
		expect(await store.list()).toEqual([]);
	});
});

// ── Prune ──────────────────────────────────────────────────────────────

describe("prune", () => {
	test("removes events older than the given timestamp", async () => {
		const e1 = fixedEvent({
			id: "1",
			timestamp: "2026-01-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e2 = fixedEvent({
			id: "2",
			timestamp: "2026-01-15T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e3 = fixedEvent({
			id: "3",
			timestamp: "2026-02-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		await store.appendBatch([e1, e2, e3]);

		const pruned = await store.prune("2026-01-10T00:00:00.000Z");
		expect(pruned).toBe(1); // e1 was pruned
		expect(await store.size()).toBe(2);

		const remaining = await store.list({ order: "asc" });
		expect(remaining.map((e) => e.id)).toEqual(["2", "3"]);
	});

	test("returns 0 when nothing to prune", async () => {
		await store.append(makeHeartbeat());
		const pruned = await store.prune("2020-01-01T00:00:00.000Z");
		expect(pruned).toBe(0);
	});
});

// ── Size ───────────────────────────────────────────────────────────────

describe("size", () => {
	test("returns 0 for empty store", async () => {
		expect(await store.size()).toBe(0);
	});

	test("returns correct count after appends", async () => {
		await store.append(makeHeartbeat());
		expect(await store.size()).toBe(1);
		await store.append(makeObservation());
		expect(await store.size()).toBe(2);
	});
});

// ── Timestamp helpers ──────────────────────────────────────────────────

describe("earliestTimestamp / latestTimestamp", () => {
	test("returns null for empty store", async () => {
		expect(await store.earliestTimestamp()).toBeNull();
		expect(await store.latestTimestamp()).toBeNull();
	});

	test("returns correct timestamps", async () => {
		const e1 = fixedEvent({
			id: "1",
			timestamp: "2026-01-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e2 = fixedEvent({
			id: "2",
			timestamp: "2026-01-15T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		const e3 = fixedEvent({
			id: "3",
			timestamp: "2026-02-01T00:00:00.000Z",
			eventType: "daemon_heartbeat",
			severity: "info",
		});
		await store.appendBatch([e2, e3, e1]); // out of order insertion

		expect(await store.earliestTimestamp()).toBe("2026-01-01T00:00:00.000Z");
		expect(await store.latestTimestamp()).toBe("2026-02-01T00:00:00.000Z");
	});
});

// ── JSON File Persistence ──────────────────────────────────────────────

describe("JSON file persistence", () => {
	test("saveToFile writes events as JSON array", async () => {
		const events = [makeHeartbeat(), makeObservation(), makeSignal()];
		await store.appendBatch(events);

		const filePath = path.join(tmpDir, "timeline.json");
		await store.saveToFile(filePath);

		const content = await fs.readFile(filePath, "utf-8");
		const parsed = JSON.parse(content);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(3);
	});

	test("loadFromFile restores events correctly", async () => {
		const events = [
			fixedEvent({
				id: "a",
				timestamp: "2026-01-01T00:00:00.000Z",
				eventType: "daemon_heartbeat",
				severity: "info",
			}),
			fixedEvent({ id: "b", timestamp: "2026-01-02T00:00:00.000Z", eventType: "observation", severity: "warning" }),
		];
		await store.appendBatch(events);

		const filePath = path.join(tmpDir, "timeline.json");
		await store.saveToFile(filePath);

		// Create a new store and load from file
		const store2 = new InMemoryBrainTimelineStore();
		const count = await store2.loadFromFile(filePath);
		expect(count).toBe(2);

		const loaded = await store2.list({ order: "asc" });
		expect(loaded).toHaveLength(2);
		expect(loaded[0].id).toBe("a");
		expect(loaded[1].id).toBe("b");
	});

	test("loadFromFile replaces existing events", async () => {
		await store.append(makeHeartbeat({ id: "original" }));
		expect(await store.size()).toBe(1);

		// Create a file with different events
		const filePath = path.join(tmpDir, "timeline.json");
		const newEvents = [
			fixedEvent({
				id: "x",
				timestamp: "2026-01-01T00:00:00.000Z",
				eventType: "daemon_heartbeat",
				severity: "info",
			}),
		];
		await fs.writeFile(filePath, JSON.stringify(newEvents), "utf-8");

		const count = await store.loadFromFile(filePath);
		expect(count).toBe(1);
		expect(await store.size()).toBe(1);
		expect(await store.get("original")).toBeNull();
		expect(await store.get("x")).toBeDefined();
	});

	test("loadFromFile throws on invalid file", async () => {
		const filePath = path.join(tmpDir, "bad.json");
		await fs.writeFile(filePath, "not json", "utf-8");
		await expect(store.loadFromFile(filePath)).rejects.toThrow();
	});

	test("loadFromFile throws on non-array JSON", async () => {
		const filePath = path.join(tmpDir, "bad.json");
		await fs.writeFile(filePath, JSON.stringify({ id: "test" }), "utf-8");
		await expect(store.loadFromFile(filePath)).rejects.toThrow("must contain a JSON array");
	});

	test("loadFromFile throws on invalid event in array", async () => {
		const filePath = path.join(tmpDir, "bad.json");
		const badEvents = [{ id: "test" }]; // missing required fields
		await fs.writeFile(filePath, JSON.stringify(badEvents), "utf-8");
		await expect(store.loadFromFile(filePath)).rejects.toThrow("Invalid");
	});

	test("saveToFile creates parent directories", async () => {
		const nestedPath = path.join(tmpDir, "nested", "dir", "timeline.json");
		await store.append(makeHeartbeat());
		await store.saveToFile(nestedPath);

		const content = await fs.readFile(nestedPath, "utf-8");
		const parsed = JSON.parse(content);
		expect(parsed).toHaveLength(1);
	});
});
