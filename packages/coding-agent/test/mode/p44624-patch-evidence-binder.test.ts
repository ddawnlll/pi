import { describe, expect, it } from "vitest";
import { bindEvidence } from "../../src/core/smart-edit/patch-evidence-binder.js";

describe("bindEvidence", () => {
	it("binds evidence to target IDs", () => {
		const result = bindEvidence(["AC-001", "F-001"], "diff_hunk", "@@ -1,3 +1,5 @@", "src/a.ts");
		expect(result.bindings).toHaveLength(1);
		expect(result.bindings[0].targetIds).toContain("AC-001");
	});

	it("warns on empty target IDs", () => {
		const result = bindEvidence([], "command_output", "All tests pass");
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});
});
