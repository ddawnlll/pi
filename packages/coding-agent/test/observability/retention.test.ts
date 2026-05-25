/**
 * Retention engine tests (25.B).
 *
 * Tests the RetentionEngine with TTL pruning, count limits, deduplication,
 * budget/cooldown enforcement, and diagnostic reporting.
 */

import { describe, expect, it } from "vitest";
import { createObservabilityEvent, createTraceContext } from "../../src/observability/index.js";
import { RetentionEngine } from "../../src/observability/retention.js";

// Helper to create test events with controlled timestamps
function createEvent(overrides: {
	name?: string;
	eventType?: string;
	source?: string;
	severity?: string;
	status?: string;
	timestamp?: string;
	durationMs?: number | null;
}) {
	const ctx = createTraceContext({ name: overrides.name ?? "test" });
	const event = createObservabilityEvent(ctx, {
		eventType: overrides.eventType ?? "test",
		source: overrides.source ?? "test-suite",
		severity: (overrides.severity ?? "info") as any,
		status: (overrides.status ?? "ok") as any,
		durationMs: overrides.durationMs ?? null,
	});
	if (overrides.timestamp) {
		event.timestamp = overrides.timestamp;
	}
	return event;
}

// ─────────────────────────────────────────────────────────────────────
// Basic pruning by TTL
// ─────────────────────────────────────────────────────────────────────

describe("RetentionEngine — TTL pruning", () => {
	it("removes events older than maxAgeMs", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "test-ttl",
					severity: "all",
					maxAgeMs: 86_400_000, // 1 day
					maxCount: 0,
					priority: 10,
				},
			],
			globalMaxCount: 0,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const oldEvent = createEvent({
			name: "old",
			timestamp: new Date(now - 2 * 86_400_000).toISOString(), // 2 days ago
		});
		const recentEvent = createEvent({
			name: "recent",
			timestamp: new Date(now - 3600_000).toISOString(), // 1 hour ago
		});

		const { retained, result } = engine.prune([oldEvent, recentEvent]);

		expect(retained).toHaveLength(1);
		expect(retained[0].name).toBe("recent");
		expect(result.eventsPruned).toBe(1);
		expect(result.prunedByAge).toBe(1);
		expect(result.prunedByCount).toBe(0);
	});

	it("keeps all events when all are within TTL", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "keep-all",
					severity: "all",
					maxAgeMs: 86_400_000,
					maxCount: 0,
					priority: 10,
				},
			],
			globalMaxCount: 0,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const events = Array.from({ length: 3 }, (_, i) =>
			createEvent({
				name: `event-${i}`,
				timestamp: new Date(now - i * 3600_000).toISOString(),
			}),
		);

		const { retained, result } = engine.prune(events);

		expect(retained).toHaveLength(3);
		expect(result.eventsPruned).toBe(0);
	});

	it("handles empty event list", () => {
		const engine = new RetentionEngine();
		const { retained, result } = engine.prune([]);

		expect(retained).toHaveLength(0);
		expect(result.eventsPruned).toBe(0);
		expect(result.eventsEvaluated).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Count-based limits
// ─────────────────────────────────────────────────────────────────────

describe("RetentionEngine — count limits", () => {
	it("removes oldest events when exceeding maxCount per rule", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "limit-count",
					severity: "all",
					maxAgeMs: 86_400_000 * 30, // 30 days
					maxCount: 3,
					priority: 10,
				},
			],
			globalMaxCount: 0,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const events = Array.from({ length: 5 }, (_, i) =>
			createEvent({
				name: `event-${i}`,
				timestamp: new Date(now - i * 1000).toISOString(),
			}),
		);

		const { retained, result } = engine.prune(events);

		expect(retained).toHaveLength(3);
		expect(result.eventsPruned).toBe(2);
		expect(result.prunedByCount).toBe(2);

		// The 3 most recent should be kept: event-2 (now - 2s), event-1 (now - 1s), event-0 (now)
		// When sorted ascending by timestamp: event-4 (oldest), event-3, event-2, event-1, event-0 (newest)
		// Count limit keeps the last 3 (most recent): event-2, event-1, event-0
		expect(retained.map((e) => e.name)).toEqual(["event-2", "event-1", "event-0"]);
	});

	it("enforces globalMaxCount", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "no-limit",
					severity: "all",
					maxAgeMs: 86_400_000 * 30,
					maxCount: 0, // No per-rule limit
					priority: 10,
				},
			],
			globalMaxCount: 2,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const events = Array.from({ length: 5 }, (_, i) =>
			createEvent({
				name: `event-${i}`,
				timestamp: new Date(now - i * 1000).toISOString(),
			}),
		);

		const { retained } = engine.prune(events);

		expect(retained).toHaveLength(2);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Rule filtering
// ─────────────────────────────────────────────────────────────────────

describe("RetentionEngine — rule filtering", () => {
	it("applies rules only to matching event types", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "trace-ttl",
					eventType: "span_start",
					maxAgeMs: 0, // Remove all matching
					maxCount: 0,
					priority: 10,
				},
			],
			globalMaxCount: 0,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const spanEvent = createEvent({
			eventType: "span_start",
			timestamp: new Date(now - 1000).toISOString(),
		});
		const toolEvent = createEvent({
			eventType: "tool_call",
			timestamp: new Date(now - 1000).toISOString(),
		});

		const { retained } = engine.prune([spanEvent, toolEvent]);

		expect(retained).toHaveLength(1);
		expect(retained[0].eventType).toBe("tool_call");
	});

	it("applies rules only to matching sources", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "executor-ttl",
					source: "executor",
					maxAgeMs: 0, // Remove all
					maxCount: 0,
					priority: 10,
				},
			],
			globalMaxCount: 0,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const execEvent = createEvent({
			source: "executor",
			timestamp: new Date(now - 1000).toISOString(),
		});
		const traceEvent = createEvent({
			source: "trace_manager",
			timestamp: new Date(now - 1000).toISOString(),
		});

		const { retained } = engine.prune([execEvent, traceEvent]);

		expect(retained).toHaveLength(1);
		expect(retained[0].source).toBe("trace_manager");
	});

	it("applies rules only to matching severities", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "debug-ttl",
					severity: "debug",
					maxAgeMs: 0, // Remove all
					maxCount: 0,
					priority: 10,
				},
			],
			globalMaxCount: 0,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const debugEvent = createEvent({
			severity: "debug",
			timestamp: new Date(now - 1000).toISOString(),
		});
		const infoEvent = createEvent({
			severity: "info",
			timestamp: new Date(now - 1000).toISOString(),
		});

		const { retained } = engine.prune([debugEvent, infoEvent]);

		expect(retained).toHaveLength(1);
		expect(retained[0].severity).toBe("info");
	});
});

// ─────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────

describe("RetentionEngine — deduplication", () => {
	it("deduplicates similar events within the time window", () => {
		const engine = new RetentionEngine(
			{
				rules: [
					{
						name: "keep-all",
						severity: "all",
						maxAgeMs: 86_400_000,
						maxCount: 0,
						priority: 10,
					},
				],
				globalMaxCount: 0,
				pruneIntervalMs: 60000,
				autoPrune: false,
			},
			{ enabled: true, windowMs: 10000, maxSimilar: 2 },
		);

		const now = Date.now();
		const events = Array.from({ length: 5 }, (_, i) =>
			createEvent({
				eventType: "same_type",
				source: "same_source",
				name: "same_name",
				timestamp: new Date(now - i * 1000).toISOString(),
			}),
		);

		const { retained } = engine.prune(events);

		// With maxSimilar=2, only 2 events should be kept
		expect(retained).toHaveLength(2);
	});

	it("does not deduplicate different event types", () => {
		const engine = new RetentionEngine(
			{
				rules: [
					{
						name: "keep-all",
						severity: "all",
						maxAgeMs: 86_400_000,
						maxCount: 0,
						priority: 10,
					},
				],
				globalMaxCount: 0,
				pruneIntervalMs: 60000,
				autoPrune: false,
			},
			{ enabled: true, windowMs: 10000, maxSimilar: 2 },
		);

		const now = Date.now();
		const events = [
			createEvent({ eventType: "type_a", source: "src", name: "n", timestamp: new Date(now).toISOString() }),
			createEvent({ eventType: "type_b", source: "src", name: "n", timestamp: new Date(now).toISOString() }),
			createEvent({ eventType: "type_c", source: "src", name: "n", timestamp: new Date(now).toISOString() }),
		];

		const { retained } = engine.prune(events);

		// Different event types should not be deduplicated
		expect(retained).toHaveLength(3);
	});

	it("can disable deduplication", () => {
		const engine = new RetentionEngine(
			{
				rules: [
					{
						name: "keep-all",
						severity: "all",
						maxAgeMs: 86_400_000,
						maxCount: 0,
						priority: 10,
					},
				],
				globalMaxCount: 0,
				pruneIntervalMs: 60000,
				autoPrune: false,
			},
			{ enabled: false, windowMs: 10000, maxSimilar: 2 },
		);

		const now = Date.now();
		const events = Array.from({ length: 5 }, (_, i) =>
			createEvent({
				eventType: "same",
				source: "same",
				name: "same",
				timestamp: new Date(now - i * 1000).toISOString(),
			}),
		);

		const { retained } = engine.prune(events);
		expect(retained).toHaveLength(5);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Budget and cooldown
// ─────────────────────────────────────────────────────────────────────

describe("RetentionEngine — budget and cooldown", () => {
	it("respects cooldown in pruneIfNeeded", async () => {
		const engine = new RetentionEngine(
			{
				rules: [
					{
						name: "remove-all",
						severity: "all",
						maxAgeMs: 0,
						maxCount: 0,
						priority: 10,
					},
				],
				globalMaxCount: 0,
				pruneIntervalMs: 60000,
				autoPrune: false,
			},
			undefined,
			{ maxPrunePerCycle: 100, cooldownMs: 100000, maxTimeMs: 100 },
		);

		const now = Date.now();
		const events = [
			createEvent({
				name: "removable",
				timestamp: new Date(now - 1000).toISOString(),
			}),
		];

		// First call should succeed
		const result1 = await engine.pruneIfNeeded(events);
		expect(result1).not.toBeNull();

		// Second call should be blocked by cooldown
		const result2 = await engine.pruneIfNeeded(events);
		expect(result2).toBeNull();
	});

	it("respects maxPrunePerCycle budget", async () => {
		const engine = new RetentionEngine(
			{
				rules: [
					{
						name: "remove-all",
						severity: "all",
						maxAgeMs: 0,
						maxCount: 0,
						priority: 10,
					},
				],
				globalMaxCount: 0,
				pruneIntervalMs: 60000,
				autoPrune: false,
			},
			undefined,
			{ maxPrunePerCycle: 1, cooldownMs: 0, maxTimeMs: 100 },
		);

		const now = Date.now();
		const events = Array.from({ length: 5 }, (_, i) =>
			createEvent({
				name: `e-${i}`,
				timestamp: new Date(now - i * 1000).toISOString(),
			}),
		);

		// First prune
		await engine.pruneIfNeeded(events);

		// Budget exhausted
		const result = await engine.pruneIfNeeded(events);
		expect(result).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Configuration and policy
// ─────────────────────────────────────────────────────────────────────

describe("RetentionEngine — configuration", () => {
	it("returns default policy", () => {
		const engine = new RetentionEngine();
		const policy = engine.getPolicy();

		expect(policy.name).toBe("default");
		expect(policy.rules.length).toBeGreaterThan(0);
		expect(policy.globalMaxCount).toBe(100_000);
	});

	it("updates policy at runtime", () => {
		const engine = new RetentionEngine();
		engine.setPolicy({ name: "custom", globalMaxCount: 500 });

		const policy = engine.getPolicy();
		expect(policy.name).toBe("custom");
		expect(policy.globalMaxCount).toBe(500);
	});

	it("updates dedupe config at runtime", () => {
		const engine = new RetentionEngine();
		engine.setDedupeConfig({ enabled: false });

		expect(engine.getDedupeConfig().enabled).toBe(false);
	});

	it("updates budget at runtime", () => {
		const engine = new RetentionEngine();
		engine.setBudget({ maxPrunePerCycle: 500 });

		expect(engine.getBudget().maxPrunePerCycle).toBe(500);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────

describe("RetentionEngine — diagnostics", () => {
	it("returns diagnostic info", () => {
		const engine = new RetentionEngine();
		const diag = engine.getDiagnostics();

		expect(diag.policyName).toBe("default");
		expect(diag.rules).toBeGreaterThan(0);
		expect(diag.isPruning).toBe(false);
		expect(diag.totalPruned).toBe(0);
		expect(diag.totalPruneCycles).toBe(0);
		expect(diag.lastPruneTimestamp).toBeNull();
		expect(diag.cooldownRemainingMs).toBeNull();
	});

	it("tracks total pruned count", () => {
		const engine = new RetentionEngine({
			rules: [
				{
					name: "remove-all",
					severity: "all",
					maxAgeMs: 100,
					maxCount: 0,
					priority: 10,
				},
			],
			globalMaxCount: 0,
			pruneIntervalMs: 60000,
			autoPrune: false,
		});

		const now = Date.now();
		const events = Array.from({ length: 3 }, (_, i) =>
			createEvent({
				name: `e-${i}`,
				timestamp: new Date(now - 1000).toISOString(),
			}),
		);

		engine.prune(events);

		const diag = engine.getDiagnostics();
		expect(diag.totalPruned).toBe(3);
		expect(diag.totalPruneCycles).toBe(1);
		expect(diag.lastPruneTimestamp).not.toBeNull();
	});
});
