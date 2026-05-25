/**
 * Observability schema and correlation model tests (25.A).
 *
 * Tests the modular observability API from src/observability/:
 * - Correlation model helpers (create, merge, extract, format)
 * - Event schema factory (edge cases, nested patterns)
 * - Module re-exports
 * - Cross-module integration
 */

import { describe, expect, it } from "vitest";
import {
	correlationFromTraceContext,
	createCorrelation,
	createObservabilityEvent,
	createTraceContext,
	EMPTY_CORRELATION,
	formatCorrelation,
	isCorrelationEmpty,
	isCorrelationPopulated,
	mergeCorrelation,
} from "../../src/observability/index.js";
import {
	ALL_OBSERVABILITY_SEVERITIES,
	ALL_OBSERVABILITY_STATUSES,
	isValidSeverity,
	isValidStatus,
	isValidTimestamp,
	validateObservabilityEvent,
} from "../../src/observability/index.js";

// ─────────────────────────────────────────────────────────────────────
// Correlation model helpers
// ─────────────────────────────────────────────────────────────────────

describe("createCorrelation", () => {
	it("creates an empty correlation with no args", () => {
		const c = createCorrelation();
		expect(c).toEqual(EMPTY_CORRELATION);
	});

	it("creates a correlation with partial fields", () => {
		const c = createCorrelation({ correlationId: "req-1", projectId: "proj-1" });
		expect(c.correlationId).toBe("req-1");
		expect(c.projectId).toBe("proj-1");
		expect(c.planExecutionId).toBeNull();
		expect(c.workspaceExecutionId).toBeNull();
	});

	it("creates a fully populated correlation", () => {
		const c = createCorrelation({
			correlationId: "req-1",
			projectId: "proj-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
		});
		expect(c.correlationId).toBe("req-1");
		expect(c.projectId).toBe("proj-1");
		expect(c.planExecutionId).toBe("plan-1");
		expect(c.workspaceExecutionId).toBe("ws-1");
	});
});

describe("mergeCorrelation", () => {
	it("returns base when override is empty", () => {
		const base = createCorrelation({
			correlationId: "req-1",
			projectId: "proj-1",
		});
		const merged = mergeCorrelation(base, {});
		expect(merged.correlationId).toBe("req-1");
		expect(merged.projectId).toBe("proj-1");
	});

	it("overrides non-null fields", () => {
		const base = createCorrelation({
			correlationId: "req-1",
			projectId: "proj-1",
		});
		const merged = mergeCorrelation(base, {
			correlationId: "req-2",
			planExecutionId: "plan-99",
		});
		expect(merged.correlationId).toBe("req-2");
		expect(merged.projectId).toBe("proj-1");
		expect(merged.planExecutionId).toBe("plan-99");
	});

	it("does not override with null values", () => {
		const base = createCorrelation({
			correlationId: "req-1",
			projectId: "proj-1",
		});
		const merged = mergeCorrelation(base, {
			correlationId: null,
			projectId: null,
		});
		expect(merged.correlationId).toBe("req-1");
		expect(merged.projectId).toBe("proj-1");
	});
});

describe("correlationFromTraceContext", () => {
	it("extracts correlation from a trace context", () => {
		const ctx = createTraceContext({
			name: "test",
			correlationId: "req-1",
			projectId: "proj-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
		});
		const corr = correlationFromTraceContext(ctx);
		expect(corr).toEqual({
			correlationId: "req-1",
			projectId: "proj-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
		});
	});

	it("extracts null fields when context has none", () => {
		const ctx = createTraceContext({ name: "test" });
		const corr = correlationFromTraceContext(ctx);
		expect(corr).toEqual(EMPTY_CORRELATION);
	});
});

describe("isCorrelationPopulated / isCorrelationEmpty", () => {
	it("returns false for empty correlation", () => {
		expect(isCorrelationPopulated(EMPTY_CORRELATION)).toBe(false);
		expect(isCorrelationEmpty(EMPTY_CORRELATION)).toBe(true);
	});

	it("returns true for populated correlation", () => {
		const c = createCorrelation({ correlationId: "req-1" });
		expect(isCorrelationPopulated(c)).toBe(true);
		expect(isCorrelationEmpty(c)).toBe(false);
	});

	it("returns true if any field is non-null", () => {
		const c = createCorrelation({ projectId: "proj-1" });
		expect(isCorrelationPopulated(c)).toBe(true);
	});
});

describe("formatCorrelation", () => {
	it("formats a fully populated model", () => {
		const c = createCorrelation({
			correlationId: "req-1",
			projectId: "proj-1",
			planExecutionId: "plan-1",
			workspaceExecutionId: "ws-1",
		});
		expect(formatCorrelation(c)).toBe("corr=req-1 proj=proj-1 plan=plan-1 ws=ws-1");
	});

	it('returns "(empty)" for null fields', () => {
		expect(formatCorrelation(EMPTY_CORRELATION)).toBe("(empty)");
	});

	it("formats partial model with only some fields", () => {
		const c = createCorrelation({ correlationId: "req-1" });
		expect(formatCorrelation(c)).toBe("corr=req-1");
	});
});

// ─────────────────────────────────────────────────────────────────────
// Event schema edge cases
// ─────────────────────────────────────────────────────────────────────

describe("ObservabilityEvent schema edge cases", () => {
	it("creates an event with minimum fields", () => {
		const ctx = createTraceContext({ name: "minimal" });
		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
		});
		expect(event.eventType).toBe("test");
		expect(event.source).toBe("test-suite");
		expect(event.severity).toBe("info");
		expect(event.status).toBe("ok");
		expect(event.message).toBeNull();
		expect(event.durationMs).toBeNull();
		expect(event.data).toEqual({});
		expect(event.error).toBeNull();
	});

	it("preserves event name override", () => {
		const ctx = createTraceContext({ name: "original-name" });
		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
			name: "overridden-name",
		});
		expect(event.name).toBe("overridden-name");
	});

	it("creates events where multiple levels deep with parent inheritance", () => {
		const ctx = createTraceContext({ name: "root" });
		const childCtx = createTraceContext({
			traceId: ctx.traceId,
			parentSpanId: ctx.spanId,
			name: "child",
			correlationId: "req-1",
			projectId: "proj-1",
		});

		const event = createObservabilityEvent(childCtx, {
			eventType: "child_event",
			source: "test-suite",
		});

		expect(event.traceId).toBe(ctx.traceId);
		expect(event.parentSpanId).toBe(ctx.spanId);
		expect(event.correlationId).toBe("req-1");
		expect(event.projectId).toBe("proj-1");
	});

	it("handles empty data and error override", () => {
		const ctx = createTraceContext({ name: "empty-data" });
		const event = createObservabilityEvent(ctx, {
			eventType: "test",
			source: "test-suite",
			data: { nested: { key: "val" } },
			error: "Something went wrong",
		});
		expect(event.data).toEqual({ nested: { key: "val" } });
		expect(event.error).toBe("Something went wrong");
	});
});

// ─────────────────────────────────────────────────────────────────────
// Module re-export verification
// ─────────────────────────────────────────────────────────────────────

describe("observability module re-exports", () => {
	it("exports all severity levels", () => {
		expect(ALL_OBSERVABILITY_SEVERITIES).toContain("debug");
		expect(ALL_OBSERVABILITY_SEVERITIES).toContain("critical");
	});

	it("exports all status values", () => {
		expect(ALL_OBSERVABILITY_STATUSES).toContain("ok");
		expect(ALL_OBSERVABILITY_STATUSES).toContain("unknown");
	});

	it("exports type guard functions", () => {
		expect(isValidSeverity("info")).toBe(true);
		expect(isValidStatus("running")).toBe(true);
		expect(isValidTimestamp("2024-06-01T12:00:00.000Z")).toBe(true);
	});

	it("exports validation function", () => {
		const result = validateObservabilityEvent(null);
		expect(result.valid).toBe(false);
	});

	it("exports EMPTY_CORRELATION", () => {
		expect(EMPTY_CORRELATION.correlationId).toBeNull();
		expect(EMPTY_CORRELATION.projectId).toBeNull();
		expect(EMPTY_CORRELATION.planExecutionId).toBeNull();
		expect(EMPTY_CORRELATION.workspaceExecutionId).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────
// Cross-module integration: correlation in trace context
// ─────────────────────────────────────────────────────────────────────

describe("trace context and correlation integration", () => {
	it("propagates correlation fields from createTraceContext to event", () => {
		const ctx = createTraceContext({
			name: "integration-test",
			correlationId: "req-42",
			projectId: "proj-7",
		});

		const corr = correlationFromTraceContext(ctx);
		expect(corr.correlationId).toBe("req-42");
		expect(corr.projectId).toBe("proj-7");

		const event = createObservabilityEvent(ctx, {
			eventType: "integration_event",
			source: "test",
		});

		expect(event.correlationId).toBe("req-42");
		expect(event.projectId).toBe("proj-7");
	});

	it("merges correlation for child scopes", () => {
		const parentCorr = createCorrelation({
			correlationId: "req-1",
			projectId: "proj-1",
		});

		const childCorr = mergeCorrelation(parentCorr, {
			planExecutionId: "plan-42",
		});

		expect(childCorr.correlationId).toBe("req-1");
		expect(childCorr.projectId).toBe("proj-1");
		expect(childCorr.planExecutionId).toBe("plan-42");

		const ctx = createTraceContext({
			name: "child-scope",
			correlationId: childCorr.correlationId ?? undefined,
			projectId: childCorr.projectId ?? undefined,
			planExecutionId: childCorr.planExecutionId ?? undefined,
		});

		expect(ctx.correlationId).toBe("req-1");
		expect(ctx.projectId).toBe("proj-1");
		expect(ctx.planExecutionId).toBe("plan-42");
	});
});
