/**
 * Telemetry Store tests (25.B).
 *
 * Tests the InMemoryTelemetryStore with buffering, flushing, querying,
 * and diagnostics.
 */

import { describe, expect, it, vi } from "vitest";
import {
	InMemoryTelemetryStore,
	type TelemetryFlushTarget,
} from "../../src/observability/telemetry-store.js";
import { createObservabilityEvent, createTraceContext } from "../../src/observability/index.js";

// Helper to create test events
function createTestEvent(overrides: Partial<{ name: string; eventType: string; source: string; severity: string; status: string }> = {}) {
	const ctx = createTraceContext({ name: overrides.name ?? "test-event" });
	return createObservabilityEvent(ctx, {
		eventType: overrides.eventType ?? "test",
		source: overrides.source ?? "test-suite",
		severity: (overrides.severity ?? "info") as any,
		status: (overrides.status ?? "ok") as any,
	});
}

// ─────────────────────────────────────────────────────────────────────
// Basic operations
// ─────────────────────────────────────────────────────────────────────

describe("InMemoryTelemetryStore", () => {
	it("records and queries events", () => {
		const store = new InMemoryTelemetryStore();
		const event = createTestEvent({ name: "my-event" });

		store.record(event);

		const results = store.query();
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(event.id);
		expect(results[0].name).toBe("my-event");
	});

	it("records multiple events and returns them in desc order by default", () => {
		const store = new InMemoryTelemetryStore();
		const e1 = createTestEvent({ name: "first" });
		const e2 = createTestEvent({ name: "second" });

		// Override timestamps to ensure ordering
		const earlier = { ...e1, timestamp: "2024-01-01T00:00:00.000Z" };
		const later = { ...e2, timestamp: "2024-01-02T00:00:00.000Z" };

		store.record(earlier);
		store.record(later);

		const results = store.query();
		expect(results).toHaveLength(2);
		expect(results[0].timestamp).toBe("2024-01-02T00:00:00.000Z"); // desc order
	});

	it("supports ascending order", () => {
		const store = new InMemoryTelemetryStore();
		const e1 = createTestEvent({ name: "first" });
		const e2 = createTestEvent({ name: "second" });

		const earlier = { ...e1, timestamp: "2024-01-01T00:00:00.000Z" };
		const later = { ...e2, timestamp: "2024-01-02T00:00:00.000Z" };

		store.record(earlier);
		store.record(later);

		const results = store.query({ order: "asc" });
		expect(results[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
	});

	it("supports pagination with offset and limit", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });

		for (let i = 0; i < 10; i++) {
			const event = createTestEvent({ name: `event-${i}` });
			store.record({ ...event, timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` });
		}

		const page1 = store.query({ limit: 3, offset: 0 });
		expect(page1).toHaveLength(3);

		const page2 = store.query({ limit: 3, offset: 3 });
		expect(page2).toHaveLength(3);

		// Ensure no overlap
		const page1Ids = new Set(page1.map((e) => e.id));
		const page2Ids = new Set(page2.map((e) => e.id));
		for (const id of page1Ids) {
			expect(page2Ids.has(id)).toBe(false);
		}
	});

	it("evicts oldest events when buffer exceeds maxBufferSize", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 3 });

		for (let i = 0; i < 5; i++) {
			const event = createTestEvent({ name: `event-${i}` });
			store.record({ ...event, timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` });
		}

		const results = store.query({ order: "asc" });
		expect(results).toHaveLength(3);
		expect(results[0].name).toBe("event-2"); // Oldest 2 evicted
		expect(results[2].name).toBe("event-4");
	});

	it("clears all events", () => {
		const store = new InMemoryTelemetryStore();
		store.record(createTestEvent());
		store.record(createTestEvent());

		expect(store.query()).toHaveLength(2);
		store.clear();
		expect(store.query()).toHaveLength(0);
	});

	it("records batch of events", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		const events = Array.from({ length: 5 }, (_, i) => createTestEvent({ name: `batch-${i}` }));

		store.recordBatch(events);
		expect(store.query()).toHaveLength(5);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Query filtering
// ─────────────────────────────────────────────────────────────────────

describe("InMemoryTelemetryStore filtering", () => {
	it("filters by event type", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		store.record(createTestEvent({ eventType: "span_start", name: "start" }));
		store.record(createTestEvent({ eventType: "span_end", name: "end" }));
		store.record(createTestEvent({ eventType: "tool_call", name: "tool" }));

		const starts = store.query({ eventType: "span_start" });
		expect(starts).toHaveLength(1);
		expect(starts[0].name).toBe("start");
	});

	it("filters by source", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		store.record(createTestEvent({ source: "executor", name: "exec" }));
		store.record(createTestEvent({ source: "trace_manager", name: "trace" }));

		const execs = store.query({ source: "executor" });
		expect(execs).toHaveLength(1);
		expect(execs[0].source).toBe("executor");
	});

	it("filters by severity", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		store.record(createTestEvent({ severity: "info", name: "info-event" }));
		store.record(createTestEvent({ severity: "error", name: "error-event" }));

		const errors = store.query({ severity: "error" });
		expect(errors).toHaveLength(1);
		expect(errors[0].name).toBe("error-event");
	});

	it("filters by status", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		store.record(createTestEvent({ status: "ok", name: "ok-event" }));
		store.record(createTestEvent({ status: "error", name: "error-event" }));

		const errors = store.query({ status: "error" });
		expect(errors).toHaveLength(1);
	});

	it("filters by time range", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		const e1 = createTestEvent({ name: "early" });
		const e2 = createTestEvent({ name: "late" });

		store.record({ ...e1, timestamp: "2024-01-01T00:00:00.000Z" });
		store.record({ ...e2, timestamp: "2024-06-01T00:00:00.000Z" });

		const results = store.query({ since: "2024-03-01T00:00:00.000Z", until: "2024-12-31T00:00:00.000Z" });
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe("late");
	});

	it("counts matching events", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		store.record(createTestEvent({ severity: "info" }));
		store.record(createTestEvent({ severity: "info" }));
		store.record(createTestEvent({ severity: "error" }));

		expect(store.count({ severity: "info" })).toBe(2);
		expect(store.count({ severity: "error" })).toBe(1);
		expect(store.count()).toBe(3);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Flushing
// ─────────────────────────────────────────────────────────────────────

describe("InMemoryTelemetryStore flushing", () => {
	it("flushes events to the flush target", async () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		const flushed: any[] = [];

		const target: TelemetryFlushTarget = {
			flush: async (events) => {
				flushed.push(...events);
				return events.length;
			},
		};

		store.setFlushTarget(target);
		store.record(createTestEvent({ name: "flush-me" }));
		store.record(createTestEvent({ name: "flush-me-too" }));

		const result = await store.flush();

		expect(result.flushed).toBe(2);
		expect(result.failed).toBe(0);
		expect(flushed).toHaveLength(2);
		expect(store.getDiagnostics().bufferSize).toBe(0);
	});

	it("handles flush failures gracefully", async () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100 });
		let callCount = 0;

		const target: TelemetryFlushTarget = {
			flush: async (_events) => {
				callCount++;
				throw new Error("DB connection lost");
			},
		};

		store.setFlushTarget(target);
		store.record(createTestEvent({ name: "fail-event" }));

		const result = await store.flush();

		expect(result.flushed).toBe(0);
		expect(result.failed).toBe(1);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toContain("DB connection lost");

		// Events remain in buffer for retry
		expect(store.getDiagnostics().bufferSize).toBe(1);
	});

	it("returns zero result when no flush target is set", async () => {
		const store = new InMemoryTelemetryStore();
		store.record(createTestEvent());

		const result = await store.flush();
		expect(result.flushed).toBe(0);
		expect(result.failed).toBe(0);
	});

	it("returns zero result when buffer is empty", async () => {
		const store = new InMemoryTelemetryStore();
		const target: TelemetryFlushTarget = {
			flush: async () => 0,
		};
		store.setFlushTarget(target);

		const result = await store.flush();
		expect(result.flushed).toBe(0);
		expect(result.failed).toBe(0);
	});

	it("flushes in batches according to batchSize config", async () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 100, batchSize: 2 });
		const flushCalls: number[] = [];

		const target: TelemetryFlushTarget = {
			flush: async (events) => {
				flushCalls.push(events.length);
				return events.length;
			},
		};

		store.setFlushTarget(target);
		for (let i = 0; i < 5; i++) {
			store.record(createTestEvent({ name: `batch-${i}` }));
		}

		await store.flush();

		// 5 events with batchSize=2 => 3 flush calls (2+2+1)
		expect(flushCalls.length).toBe(3);
		expect(flushCalls[0]).toBe(2);
		expect(flushCalls[1]).toBe(2);
		expect(flushCalls[2]).toBe(1);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────

describe("InMemoryTelemetryStore configuration", () => {
	it("uses default config when no overrides provided", () => {
		const store = new InMemoryTelemetryStore();
		const config = store.getConfig();

		expect(config.maxBufferSize).toBe(1000);
		expect(config.batchSize).toBe(100);
		expect(config.flushIntervalMs).toBe(10000);
		expect(config.autoFlush).toBe(true);
	});

	it("accepts partial config overrides", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 50, autoFlush: false });
		const config = store.getConfig();

		expect(config.maxBufferSize).toBe(50);
		expect(config.autoFlush).toBe(false);
		expect(config.batchSize).toBe(100); // default
	});

	it("updates config at runtime", () => {
		const store = new InMemoryTelemetryStore();
		store.updateConfig({ maxBufferSize: 200, batchSize: 50 });

		const config = store.getConfig();
		expect(config.maxBufferSize).toBe(200);
		expect(config.batchSize).toBe(50);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────

describe("InMemoryTelemetryStore diagnostics", () => {
	it("returns diagnostic info", () => {
		const store = new InMemoryTelemetryStore({ autoFlush: false });
		store.record(createTestEvent());
		store.record(createTestEvent());

		const diag = store.getDiagnostics();

		expect(diag.bufferSize).toBe(2);
		expect(diag.totalRecorded).toBe(2);
		expect(diag.totalFlushed).toBe(0);
		expect(diag.totalFlushFailures).toBe(0);
		expect(diag.evictionCount).toBe(0);
		expect(diag.autoFlushActive).toBe(false);
		expect(diag.timeSinceLastFlushMs).toBeNull();
	});

	it("tracks eviction count", () => {
		const store = new InMemoryTelemetryStore({ maxBufferSize: 2, autoFlush: false });

		for (let i = 0; i < 5; i++) {
			store.record(createTestEvent({ name: `e-${i}` }));
		}

		const diag = store.getDiagnostics();
		expect(diag.evictionCount).toBe(3); // 5 - 2 = 3 evicted
		expect(diag.bufferSize).toBe(2);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────

describe("InMemoryTelemetryStore lifecycle", () => {
	it("starts and stops auto-flush timer", async () => {
		const store = new InMemoryTelemetryStore({ autoFlush: true, flushIntervalMs: 50, maxBufferSize: 100 });
		const flushed: any[] = [];

		const target: TelemetryFlushTarget = {
			flush: async (events) => {
				flushed.push(...events);
				return events.length;
			},
		};

		store.setFlushTarget(target);
		store.start();

		store.record(createTestEvent({ name: "auto-flush-test" }));

		// Wait for auto-flush
		await new Promise((resolve) => setTimeout(resolve, 150));

		await store.stop(true);

		// Should have flushed
		expect(flushed.length).toBeGreaterThanOrEqual(1);
		expect(store.getDiagnostics().bufferSize).toBe(0);
	});

	it("stop with flushRemaining=false leaves buffer intact", async () => {
		const store = new InMemoryTelemetryStore({ autoFlush: false });
		store.record(createTestEvent());

		await store.stop(false);
		expect(store.getDiagnostics().bufferSize).toBe(1);
	});
});
