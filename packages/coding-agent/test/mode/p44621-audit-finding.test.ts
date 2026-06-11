import { describe, expect, it } from "vitest";
import { createFinding, getFindingsByFile, hasBlockerFindings } from "../../src/core/smart-edit/audit-finding.js";

describe("SmartEditAuditFinding", () => {
	it("creates a finding with required fields", () => {
		const f = createFinding("F-001", "warning", "src/foo.ts", "Unused import detected", "Confirm import is removed");
		expect(f.id).toBe("F-001");
		expect(f.severity).toBe("warning");
	});

	it("detects blocker findings", () => {
		const findings = [createFinding("F-001", "blocker", "src/bar.ts", "Security issue", "Fix required")];
		expect(hasBlockerFindings({ findings, diagnostics: [] })).toBe(true);
	});

	it("filters findings by file", () => {
		const findings = [
			createFinding("F-001", "warning", "src/a.ts", "Issue A", "Fix A"),
			createFinding("F-002", "warning", "src/b.ts", "Issue B", "Fix B"),
		];
		const result = getFindingsByFile({ findings, diagnostics: [] }, "src/a.ts");
		expect(result).toHaveLength(1);
	});
});
