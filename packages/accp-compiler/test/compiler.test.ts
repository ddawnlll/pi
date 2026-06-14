/**
 * ACCP Compiler V2 Tests
 *
 * Verifies the compiler pipeline V2:
 * - Pipeline accepts valid ACCP YAML and returns real report id/type
 * - Pipeline rejects empty input
 * - Pipeline rejects non-ACCP input
 * - Fenced YAML extracts and compiles with warning
 */
import { describe, expect, it } from "vitest";
import { compileAccpSource } from "../src/compiler.js";

const validRir = `accp_version: "2.0.0"
source_format: "ACCP-YAML"

report:
  id: "TEST_001"
  type: "RIR"
  family: "core"

scope:
  target: "test"

evidence:
  - id: "EV001"
    type: "file"
    path: "packages/accp-compiler/src/compiler.ts"`;

describe("ACCP Compiler V2", () => {
	// ---------------------------------------------------------------------------
	// Positive tests
	// ---------------------------------------------------------------------------

	it("should accept valid ACCP YAML and extract real report id/type", () => {
		const result = compileAccpSource(validRir);
		expect(result.status).toBe("compiled");
		expect(result.reportId).toBe("TEST_001");
		expect(result.reportType).toBe("RIR");
		expect(result.hasBlockingFindings).toBe(false);
	});

	it("should compile fenced YAML with extraction warning", () => {
		const fenced = `Here is the report:\n\`\`\`yaml\n${validRir}\n\`\`\``;
		const result = compileAccpSource(fenced);
		expect(result.reportId).toBe("TEST_001");
		expect(result.reportType).toBe("RIR");
		expect(result.diagnostics.some((d) => d.code === "ACCP_EXTRACT_FENCED_YAML")).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// Negative tests
	// ---------------------------------------------------------------------------

	it("should reject empty source YAML", () => {
		const result = compileAccpSource("");
		expect(result.status).toBe("failed");
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.diagnostics[0].code).toBe("ACCP_EXTRACT_NO_DOCUMENT");
		expect(result.hasBlockingFindings).toBe(true);
	});

	it("should reject source that does not contain ACCP YAML", () => {
		const result = compileAccpSource("foo: bar\nbaz: qux\n");
		expect(result.status).toBe("failed");
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.diagnostics[0].code).toBe("ACCP_EXTRACT_NO_DOCUMENT");
	});

	it("should reject whitespace-only input", () => {
		const result = compileAccpSource("   \n  \n   ");
		expect(result.status).toBe("failed");
	});

	it("should reject invalid YAML", () => {
		const result = compileAccpSource('accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\nreport: {unclosed');
		expect(result.status).toBe("failed");
		expect(result.diagnostics.some((d) => d.code === "ACCP_PARSE_YAML_INVALID")).toBe(true);
	});

	it("should reject multiple ACCP documents", () => {
		const multiple = `${validRir}\n---\naccp_version: "2.0.0"\nsource_format: "ACCP-YAML"`;
		const result = compileAccpSource(multiple);
		expect(result.status).toBe("failed");
		expect(
			result.diagnostics.some(
				(d) => d.code === "ACCP_EXTRACT_MULTIPLE_DOCUMENTS" || d.code === "ACCP_PARSE_MULTIDOC_NOT_ALLOWED",
			),
		).toBe(true);
	});
});
