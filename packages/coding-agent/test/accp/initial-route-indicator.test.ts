/**
 * AccpTaskEnvelope Tests (P49.23)
 */
import { describe, expect, it } from "vitest";
import { createInitialRouteIndicator } from "../../src/core/accp-initial-route-indicator.js";

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
