import { describe, expect, it } from "vitest";
import { admitExecution } from "../../src/execution-runtime/admission-gate.js";

describe("admission-gate", () => {
	it("allows when all gates pass", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
			}),
		).toBe("allow");
	});

	it("rejects postgres unavailable", () => {
		expect(
			admitExecution({
				postgresAvailable: false,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
			}),
		).toBe("reject");
	});

	it("rejects json fallback in production", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: true,
				jsonFallback: true,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
			}),
		).toBe("reject");
	});

	it("allows json fallback when not production", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: true,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
			}),
		).toBe("allow");
	});

	it("rejects repair/autonomous mismatch", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: true,
				autonomousMode: false,
				promotionGateSatisfied: true,
			}),
		).toBe("reject");
	});

	it("allows matching repair and autonomous", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: true,
				autonomousMode: true,
				promotionGateSatisfied: true,
			}),
		).toBe("allow");
	});

	it("allows autonomous mode without repair mode", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: true,
				promotionGateSatisfied: true,
			}),
		).toBe("allow");
	});

	it("rejects missing promotion gates", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: false,
			}),
		).toBe("reject");
	});

	// --- P44 active_safe admission tests ---

	it("rejects when tokenContext enabled=false", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: false,
				tokenContextMode: "active_safe",
			}),
		).toBe("reject");
	});

	it("rejects when tokenContext mode=observe_only", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: true,
				tokenContextMode: "observe_only",
			}),
		).toBe("reject");
	});

	it("rejects when tokenContext mode=shadow", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: true,
				tokenContextMode: "shadow",
			}),
		).toBe("reject");
	});

	it("rejects when tokenContext mode=disabled", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: true,
				tokenContextMode: "disabled",
			}),
		).toBe("reject");
	});

	it("accepts when tokenContext enabled=true mode=active_safe", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: true,
				tokenContextMode: "active_safe",
			}),
		).toBe("allow");
	});

	it("accepts when tokenContext not provided (defaults to enabled active_safe)", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
			}),
		).toBe("allow");
	});
});
