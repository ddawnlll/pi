import { describe, expect, it } from "vitest";
import { exportP495Handoff } from "../../src/core/bridge/p495-artifact-export.js";
import { evaluateP495Readiness } from "../../src/core/bridge/p495-readiness-guard.js";

describe("P49.5 Bridge", () => {
	it("exports handoff artifact with correct phase", () => {
		const handoff = exportP495Handoff();
		expect(handoff.phaseId).toBe("P44.6");
		expect(handoff.p45BoundaryRespected).toBe(true);
	});

	it("evaluates readiness as ready when all checks pass", () => {
		const result = evaluateP495Readiness(true, true, true, true);
		expect(result.ready).toBe(true);
	});

	it("evaluates readiness as not ready when checks fail", () => {
		const result = evaluateP495Readiness(true, false, true, true);
		expect(result.ready).toBe(false);
	});
});
