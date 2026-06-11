import { describe, expect, it } from "vitest";
import { createFinding } from "../../src/core/smart-edit/audit-finding.js";
import { compilePatchScopes } from "../../src/core/smart-edit/patch-scope-compiler.js";

describe("compilePatchScopes", () => {
	it("compiles warning findings into patch scopes", () => {
		const findings = [createFinding("F-001", "warning", "src/a.ts", "Fix A", "A")];
		const result = compilePatchScopes(findings);
		expect(result.scopes).toHaveLength(1);
		expect(result.scopes[0].findingId).toBe("F-001");
	});

	it("rejects blocker findings", () => {
		const findings = [createFinding("F-001", "blocker", "src/a.ts", "Block A", "A")];
		const result = compilePatchScopes(findings);
		expect(result.scopes).toHaveLength(0);
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});
});
