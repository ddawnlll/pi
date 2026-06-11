import { describe, expect, it } from "vitest";
import { createReportMapping } from "../../src/core/accp/tvr-prr-mapping.js";

describe("createReportMapping", () => {
	it("creates TVR mapping with correct path", () => {
		const mapping = createReportMapping("TVR", "P44.6.01");
		expect(mapping.kind).toBe("TVR");
		expect(mapping.artifactPath).toContain("P44_6_01_TVR");
	});
});
