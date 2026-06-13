/**
 * AccpTaskEnvelope Tests (P49.23)
 */
import { describe, expect, it } from "vitest";
import { createAccpTaskEnvelope, createInitialRouteIndicator } from "../../src/core/accp-initial-route-indicator.js";

describe("InitialRouteIndicator", () => {
	it("should create an indicator from a user action", () => {
		const indicator = createInitialRouteIndicator("investigate_bug");
		expect(indicator.initialAction).toBe("investigate_bug");
		expect(indicator.confidence).toBe("high");
		expect(indicator.isAdvisory).toBe(false);
		expect(indicator.runtimeAuthorityRequired).toBe(true);
	});

	it("should use default action for empty input", () => {
		const indicator = createInitialRouteIndicator("");
		expect(indicator.initialAction).toBe("explore");
	});

	it("should never be advisory (user selection is explicit intent)", () => {
		const indicator = createInitialRouteIndicator("test");
		expect(indicator.isAdvisory).toBe(false);
	});

	it("should require runtime authority check", () => {
		const indicator = createInitialRouteIndicator("mutate");
		expect(indicator.runtimeAuthorityRequired).toBe(true);
	});
});

describe("createAccpTaskEnvelope", () => {
	it("should create an envelope from an indicator and report types", () => {
		const indicator = createInitialRouteIndicator("investigate_bug");
		const envelope = createAccpTaskEnvelope("task-1", indicator, []);
		expect(envelope.taskId).toBe("task-1");
		expect(envelope.initialRoute).toBe(indicator);
		expect(envelope.targetReportTypes).toEqual([]);
	});

	it("should include target report types when provided", () => {
		const indicator = createInitialRouteIndicator("review");
		const envelope = createAccpTaskEnvelope("task-2", indicator, ["tvr", "prr"] as any);
		expect(envelope.targetReportTypes).toEqual(["tvr", "prr"]);
	});

	it("should preserve the initial route indicator", () => {
		const indicator = createInitialRouteIndicator("inspect");
		const envelope = createAccpTaskEnvelope("task-3", indicator, []);
		expect(envelope.initialRoute.initialAction).toBe("inspect");
		expect(envelope.initialRoute.confidence).toBe("high");
		expect(envelope.initialRoute.isAdvisory).toBe(false);
		expect(envelope.initialRoute.runtimeAuthorityRequired).toBe(true);
	});

	it("should default to explore for unknown initial action", () => {
		const indicator = createInitialRouteIndicator("");
		const envelope = createAccpTaskEnvelope("task-4", indicator, []);
		expect(envelope.initialRoute.initialAction).toBe("explore");
	});
});
