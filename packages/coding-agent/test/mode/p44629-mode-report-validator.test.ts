import { describe, expect, it } from "vitest";
import { validateModeReport } from "../../src/core/accp/mode-report-validator.js";

describe("validateModeReport", () => {
	it("validates a proper evidence-only report", () => {
		const result = validateModeReport("This report contains evidence entries only.", "TVR");
		expect(result.verdict).toBe("valid");
	});

	it("rejects report with execution authorization", () => {
		const result = validateModeReport("mode_transition_authorized: write", "IPR");
		expect(result.verdict).toBe("not_evidence_only");
	});

	it("rejects empty report as malformed", () => {
		const result = validateModeReport("", "IPR");
		expect(result.verdict).toBe("malformed");
	});
});
