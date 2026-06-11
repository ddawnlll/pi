import { describe, expect, it } from "vitest";
import { selectSchema } from "../../src/core/smart-write/artifact-schema-selector.js";

describe("selectSchema", () => {
	it("selects artifact schema by default", () => {
		const result = selectSchema("create a new component");
		expect(result.schema).toBe("artifact");
	});

	it("selects planspec_v5 for plan-like prompts", () => {
		const result = selectSchema("create an implementation plan for phase 2");
		expect(result.schema).toBe("planspec_v5");
	});

	it("selects report for report-like prompts", () => {
		const result = selectSchema("generate a TVR report for workspace 3");
		expect(result.schema).toBe("report");
	});

	it("rejects markdown-only targets", () => {
		const result = selectSchema("plan something", "output.md");
		expect(result.markdownRejected).toBe(true);
		expect(result.schema).toBe("unknown");
	});
});
