import { describe, expect, it } from "vitest";
import { requireCAR } from "../../src/core/accp/car-correction-path.js";

describe("requireCAR", () => {
	it("creates CAR for malformed report", () => {
		const result = requireCAR("malformed_report", "Report is empty", "TVR-001");
		expect(result.requiresCAR).toBe(true);
		expect(result.car?.reason).toBe("malformed_report");
		expect(result.car?.resolved).toBe(false);
	});
});
