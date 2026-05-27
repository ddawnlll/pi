import { describe, expect, it } from "vitest";
import { admitExecution } from "../../src/execution-kernel/admission-gate.js";

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
});
