/**
 * Observability tests for TraceManager, CorrelationModel, and event schema (25.A).
 *
 * Tests the runtime observability primitives including:
 * - Trace/span lifecycle management
 * - Correlation model propagation
 * - Event schema validation
 * - Event handler integration
 * - Duration tracking
 */

import { describe, expect, it } from "vitest";
import {
	ALL_OBSERVABILITY_SEVERITIES,
	ALL_OBSERVABILITY_STATUSES,
	createObservabilityEvent,
	createTraceContext,
	deserializeObservabilityEvent,
	EMPTY_CORRELATION,
	isValidSeverity,
	isValidStatus,
	isValidTimestamp,
	serializeObservabilityEvent,
	TraceManager,
	validateObservabilityEvent,
} from "../src/core/observability.js";

// ─────────────────────────────────────────────────────────────────────
// Basic types and validation
// ─────────────────────────────────────────────────────────────────────

describe("Observability types", () => {
	it("has all severity levels", () => {
		expect(ALL_OBSERVABILITY_SEVERITIES).toEqual(["debug", "info", "warning", "error", "critical"]);
	});

	it("has all status values", () => {
		expect(ALL_OBSERVABILITY_STATUSES).toEqual(["ok", "error", "running", "unknown"]);
	});

	it("validates severity correctly", () => {
		expect(isValidSeverity("info")).toBe(true);
		expect(isValidSeverity("error")).toBe(true);
		expect(isValidSeverity("critical")).toBe(true);
		expect(isValidSeverity("invalid")).toBe(false);
		expect(isValidSeverity(42)).toBe(false);
	});

	it("validates status correctly", () => {
		expect(isValidStatus("ok")).toBe(true);
		expect(isValidStatus("error")).toBe(true);
		expect(isValidStatus("running")).toBe(true);
		expect(isValidStatus("unknown")).toBe(true);
		expect(isValidStatus("invalid")).toBe(false);
	});

	it("validates timestamps", () => {
		expect(isValidTimestamp("2024-01-15T10:30:00.000Z")).toBe(true);
		expect(isValidTimestamp("2024-01-15")).toBe(false);
		expect(isValidTimestamp("")).toBe(false);
		expect(isValidTimestamp(123)).toBe(false);
	});

	it("EMPTY_CORRELATION has all null fields", () => {
		expect(EMPTY_CORRELATION).toEqual({
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});
	});
});

// ─────────────────────────────────────────────────────────────────────
// TraceContext factory
// ─────────────────────────────────────────────────────────────────────

describe("createTraceContext", () => {
	it("creates a basic trace context", () => {
		const ctx = createTraceContext({ name: "test-trace" });
		expect(ctx.traceId).toBeTruthy();
		expect(ctx.spanId).toBeTruthy();
		expect(ctx.parentSpanId).toBeNull();
		expect(ctx.name).toBe("test-trace");
		expect(ctx.startTime).toBeTruthy();
		expect(typeof ctx.startTime).toBe("string");
		expect(ctx.correlationId).toBeNull();
		expect(ctx.projectId).toBeNull();
		expect(ctx.planExecutionId).toBeNull();
		expect(ctx.workspaceExecutionId).toBeNull();
		expect(ctx.metadata).toEqual({});
	});

	it("accepts explicit traceId and spanId", () => {
		const ctx = createTraceContext({
			traceId: "abc-123",
			spanId: "def-456",
			name: "explicit-ids",
		});
		expect(ctx.traceId).toBe("abc-123");
		expect(ctx.spanId).toBe("def-456");
	});

	it("accepts correlation model fields", () => {
		const ctx = createTraceContext({
			name: "correlated",
			correlationId: "req-1",
			projectId: "proj-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
		});
		expect(ctx.correlationId).toBe("req-1");
		expect(ctx.projectId).toBe("proj-1");
		expect(ctx.planExecutionId).toBe("plan-1");
		expect(ctx.workspaceExecutionId).toBe("ws-1");
	});

	it("accepts parentSpanId for child spans", () => {
		const ctx = createTraceContext({
			name: "child",
			parentSpanId: "parent-123",
		});
		expect(ctx.parentSpanId).toBe("parent-123");
	});

	it("accepts metadata", () => {
		const ctx = createTraceContext({
			name: "with-meta",
			metadata: { env: "test", version: 1 },
		});
		expect(ctx.metadata).toEqual({ env: "test", version: 1 });
	});
});

// ─────────────────────────────────────────────────────────────────────
// ObservabilityEvent factory
// ─────────────────────────────────────────────────────────────────────

describe("createObservabilityEvent", () => {
	it("creates an event from a trace context", () => {
		const ctx = createTraceContext({ name: "my-span" });
		const event = createObservabilityEvent(ctx, {
			eventType: "workspace_start",
			source: "test-suite",
			severity: "info",
			status: "running",
			message: "Starting workspace",
		});

		expect(event.id).toBeTruthy();
		expect(event.traceId).toBe(ctx.traceId);
		expect(event.spanId).toBe(ctx.spanId);
		expect(event.parentSpanId).toBeNull();
		expect(event.eventType).toBe("workspace_start");
		expect(event.source).toBe("test-suite");
		expect(event.severity).toBe("info");
		expect(event.status).toBe("running");
		expect(event.name).toBe("my-span");
		expect(event.message).toBe("Starting workspace");
		expect(event.correlationId).toBeNull();
		expect(event.data).toEqual({});
		expect(event.error).toBeNull();
		expect(event.durationMs).toBeNull();
	});

	it("includes correlation model from context", () => {
		const ctx = createTraceContext({
			name: "correlated-event",
			correlationId: "req-42",
			projectId: "proj-7",
		});

		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
		});

		expect(event.correlationId).toBe("req-42");
		expect(event.projectId).toBe("proj-7");
	});

	it("includes duration and data when provided", () => {
		const ctx = createTraceContext({ name: "timed-span" });
		const event = createObservabilityEvent(ctx, {
			eventType: "tool_call",
			source: "executor",
			severity: "info",
			status: "ok",
			durationMs: 150,
			data: { tool: "read", file: "test.ts" },
			error: null,
		});

		expect(event.durationMs).toBe(150);
		expect(event.data).toEqual({ tool: "read", file: "test.ts" });
	});

	it("includes error information when status is error", () => {
		const ctx = createTraceContext({ name: "failed-span" });
		const event = createObservabilityEvent(ctx, {
			eventType: "tool_call",
			source: "executor",
			severity: "error",
			status: "error",
			error: "File not found",
			data: { tool: "read", file: "missing.ts" },
		});

		expect(event.severity).toBe("error");
		expect(event.status).toBe("error");
		expect(event.error).toBe("File not found");
	});
});

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

describe("validateObservabilityEvent", () => {
	it("validates a well-formed event", () => {
		const ctx = createTraceContext({ name: "valid" });
		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
		});

		const result = validateObservabilityEvent(event);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("rejects null input", () => {
		const result = validateObservabilityEvent(null);
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("rejects missing required fields", () => {
		const result = validateObservabilityEvent({});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("rejects invalid severity", () => {
		const ctx = createTraceContext({ name: "bad-severity" });
		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
			severity: "invalid" as any,
			status: "ok",
		});

		const result = validateObservabilityEvent(event);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("severity"))).toBe(true);
	});

	it("rejects invalid status", () => {
		const ctx = createTraceContext({ name: "bad-status" });
		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
			severity: "info",
			status: "invalid" as any,
		});

		const result = validateObservabilityEvent(event);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("status"))).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────

describe("ObservabilityEvent serialization", () => {
	it("round-trips through JSON", () => {
		const ctx = createTraceContext({ name: "serialize-test" });
		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
		});

		const json = serializeObservabilityEvent(event);
		expect(typeof json).toBe("string");

		const deserialized = deserializeObservabilityEvent(json);
		expect(deserialized.id).toBe(event.id);
		expect(deserialized.traceId).toBe(event.traceId);
		expect(deserialized.spanId).toBe(event.spanId);
		expect(deserialized.eventType).toBe(event.eventType);
		expect(deserialized.severity).toBe(event.severity);
		expect(deserialized.status).toBe(event.status);
	});

	it("throws on invalid JSON during deserialization", () => {
		expect(() => deserializeObservabilityEvent("{invalid}")).toThrow();
	});

	it("throws on valid JSON with invalid event data", () => {
		expect(() => deserializeObservabilityEvent('{"id": 123}')).toThrow();
	});
});

// ─────────────────────────────────────────────────────────────────────
// TraceManager
// ─────────────────────────────────────────────────────────────────────

describe("TraceManager", () => {
	it("starts a trace and creates root span", () => {
		const tm = new TraceManager();
		const ctx = tm.startTrace("plan-execution");

		expect(ctx.traceId).toBeTruthy();
		expect(ctx.spanId).toBeTruthy();
		expect(ctx.parentSpanId).toBeNull();
		expect(ctx.name).toBe("plan-execution");
		expect(tm.isTraceActive(ctx.traceId)).toBe(true);
		expect(tm.activeTraceCount).toBe(1);
	});

	it("starts child spans within a trace", () => {
		const tm = new TraceManager();
		const root = tm.startTrace("root");
		const child = tm.startSpan(root, "workspace-1");

		expect(child.traceId).toBe(root.traceId);
		expect(child.parentSpanId).toBe(root.spanId);
		expect(child.name).toBe("workspace-1");
	});

	it("propagates correlation model to child spans", () => {
		const tm = new TraceManager();
		const root = tm.startTrace("root", {
			correlationId: "req-99",
			projectId: "proj-abc",
		});

		const child = tm.startSpan(root, "child");
		expect(child.correlationId).toBe("req-99");
		expect(child.projectId).toBe("proj-abc");
	});

	it("ends a span and returns duration", () => {
		const tm = new TraceManager();
		const ctx = tm.startTrace("timed-span");
		const duration = tm.endSpan(ctx, "ok", { result: "success" });

		expect(duration).toBeGreaterThanOrEqual(0);
		expect(typeof duration).toBe("number");
	});

	it("ends a span with error status", () => {
		const tm = new TraceManager();
		const ctx = tm.startTrace("failing-span");
		const duration = tm.endSpan(ctx, "error", {}, "Something went wrong");

		expect(duration).toBeGreaterThanOrEqual(0);
	});

	it("ends an entire trace with cleanup", () => {
		const tm = new TraceManager();
		const root = tm.startTrace("trace-to-end");
		const child = tm.startSpan(root, "child-1");
		const _grandchild = tm.startSpan(child, "child-2");

		const duration = tm.endTrace(root, "ok", { completed: true });

		expect(duration).toBeGreaterThanOrEqual(0);
		expect(tm.isTraceActive(root.traceId)).toBe(false);
		expect(tm.activeTraceCount).toBe(0);
	});

	it("gets active spans for a trace", () => {
		const tm = new TraceManager();
		const root = tm.startTrace("root");
		const child1 = tm.startSpan(root, "child-1");
		const _child2 = tm.startSpan(child1, "child-2");

		const active = tm.getActiveSpans(root.traceId);
		expect(active.length).toBe(3); // root, child1, child2
	});

	it("gets current (innermost) span", () => {
		const tm = new TraceManager();
		const root = tm.startTrace("root");
		const child = tm.startSpan(root, "child");

		const current = tm.getCurrentSpan(root.traceId);
		expect(current?.spanId).toBe(child.spanId);
		expect(current?.name).toBe("child");
	});

	it("returns null for current span on inactive trace", () => {
		const tm = new TraceManager();
		expect(tm.getCurrentSpan("nonexistent")).toBeNull();
	});

	it("clears all traces", () => {
		const tm = new TraceManager();
		tm.startTrace("trace-1");
		tm.startTrace("trace-2");

		expect(tm.activeTraceCount).toBe(2);
		tm.clear();
		expect(tm.activeTraceCount).toBe(0);
	});

	it("fires event handler on span start and end", () => {
		const tm = new TraceManager();
		const events: Array<{ type: string; status: string }> = [];

		tm.setEventHandler((event) => {
			events.push({ type: event.eventType, status: event.status });
		});

		const ctx = tm.startTrace("handler-test");
		const child = tm.startSpan(ctx, "child-span");
		tm.endSpan(child, "ok");
		tm.endSpan(ctx, "ok");

		expect(events.length).toBe(4); // 2 starts + 2 ends
		expect(events[0].type).toBe("span_start");
		expect(events[0].status).toBe("running");
		expect(events[1].type).toBe("span_start"); // child
		expect(events[2].type).toBe("span_end"); // child end
		expect(events[3].type).toBe("span_end"); // root end
	});

	it("supports multiple concurrent traces", () => {
		const tm = new TraceManager();
		const traceA = tm.startTrace("trace-A", { correlationId: "corr-A" });
		const traceB = tm.startTrace("trace-B", { correlationId: "corr-B" });

		expect(tm.activeTraceCount).toBe(2);
		expect(tm.isTraceActive(traceA.traceId)).toBe(true);
		expect(tm.isTraceActive(traceB.traceId)).toBe(true);

		const childA = tm.startSpan(traceA, "child-A");
		expect(childA.correlationId).toBe("corr-A");

		tm.endTrace(traceA);
		expect(tm.isTraceActive(traceA.traceId)).toBe(false);
		expect(tm.isTraceActive(traceB.traceId)).toBe(true);
	});

	it("records duration for ended spans", () => {
		const tm = new TraceManager();
		const ctx = tm.startTrace("duration-test");
		const child = tm.startSpan(ctx, "quick-span");

		const childDuration = tm.endSpan(child, "ok");
		expect(childDuration).toBeGreaterThanOrEqual(0);

		const rootDuration = tm.endSpan(ctx, "ok");
		expect(rootDuration).toBeGreaterThanOrEqual(0);
	});
});
