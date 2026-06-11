import { describe, expect, it } from "vitest";
import { createFinding } from "../../src/core/smart-edit/audit-finding.js";
import { checkRegression } from "../../src/core/smart-edit/regression-guard.js";

describe("checkRegression", () => {
	it("passes when evidence satisfies required evidence", () => {
		const findings = [createFinding("F-001", "warning", "src/a.ts", "Fix A", "import removed")];
		const evidence = new Map([["F-001", "import removed and tested"]]);
		const result = checkRegression(findings, ["F-001"], evidence);
		expect(result.allResolved).toBe(true);
		expect(result.resolvedFindings).toContain("F-001");
	});

	it("fails when no evidence provided", () => {
		const findings = [createFinding("F-001", "warning", "src/a.ts", "Fix A", "import removed")];
		const result = checkRegression(findings, ["F-001"], new Map());
		expect(result.allResolved).toBe(false);
	});
});
