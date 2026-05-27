import { describe, expect, it } from "vitest";
import { canRerunCleanup } from "../src/core/cleanup-review.js";

describe("P29 cleanup review admission gate", () => {
	it("allows rerun when admission gate allows execution", () => {
		expect(
			canRerunCleanup({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: true,
				autonomousMode: true,
				promotionGateSatisfied: true,
			}),
		).toBe(true);
	});

	it("rejects rerun when admission gate rejects execution", () => {
		expect(
			canRerunCleanup({
				postgresAvailable: false,
				production: false,
				jsonFallback: false,
				repairMode: true,
				autonomousMode: true,
				promotionGateSatisfied: true,
			}),
		).toBe(false);
	});
});
