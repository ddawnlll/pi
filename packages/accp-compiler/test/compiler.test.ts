/**
 * ACCP Compiler Scaffold Tests
 *
 * Verifies the basic compiler pipeline scaffold works:
 * - Pipeline accepts valid YAML and returns a result
 * - Pipeline rejects empty input
 * - Pipeline rejects non-YAML input
 */
import { describe, expect, it } from "vitest";
import { compileAccpSource } from "../src/compiler.js";

describe("ACCP Compiler Scaffold", () => {
	// ---------------------------------------------------------------------------
	// Positive tests
	// ---------------------------------------------------------------------------

	it("should accept valid ACCP YAML with accp_version header", () => {
		const result = compileAccpSource("accp_version: 2.0.0\nreport_id: TEST_001\n");
		expect(result.status).toBe("compiled");
		expect(result.diagnostics).toHaveLength(0);
		expect(result.hasBlockingFindings).toBe(false);
	});

	it("should return a report ID from parsed YAML", () => {
		const result = compileAccpSource("accp_version: 2.0.0\nreport_id: TEST_002\n");
		expect(result.reportId).toBe("PARSED");
	});

	// ---------------------------------------------------------------------------
	// Negative tests
	// ---------------------------------------------------------------------------

	it("should reject empty source YAML", () => {
		const result = compileAccpSource("");
		expect(result.status).toBe("failed");
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.diagnostics[0].code).toBe("ACCP_PARSE_YAML_INVALID");
		expect(result.hasBlockingFindings).toBe(true);
	});

	it("should reject source that does not start with accp_version", () => {
		const result = compileAccpSource("foo: bar\nbaz: qux\n");
		expect(result.status).toBe("failed");
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.diagnostics[0].code).toBe("ACCP_PARSE_YAML_INVALID");
	});

	it("should reject whitespace-only input", () => {
		const result = compileAccpSource("   \n  \n   ");
		expect(result.status).toBe("failed");
	});
});
