/**
 * ACCP YAML Parser Tests
 *
 * Verifies the YAML parser correctly handles valid and invalid input.
 * Uses test fixtures from test/fixtures/.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractAccpYaml } from "../src/parser/extractor.js";
import { parseAccpYaml } from "../src/parser/yaml-parser.js";

describe("ACCP YAML Parser", () => {
	// ---------------------------------------------------------------------------
	// Positive tests
	// ---------------------------------------------------------------------------

	it("should parse a minimal valid ACCP YAML", () => {
		const yaml = `accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "TEST_001"\n  type: "TVR"\n  family: "core"\n  status: "complete"`;
		const { parsed, diagnostics } = parseAccpYaml(yaml);

		expect(parsed).not.toBeNull();
		expect(diagnostics).toHaveLength(0);
		expect(parsed!.accpVersion).toBe("2.0.0");
		expect(parsed!.sourceFormat).toBe("ACCP-YAML");
		expect(parsed!.report.id).toBe("TEST_001");
		expect(parsed!.report.type).toBe("TVR");
		expect(parsed!.report.family).toBe("core");
	});

	it("should parse a valid TVR fixture file", () => {
		const fixturePath = resolve(import.meta.dirname, "fixtures", "valid_tvr.accp.yaml");
		const yaml = readFileSync(fixturePath, "utf-8");
		const { parsed, diagnostics } = parseAccpYaml(yaml);

		expect(parsed).not.toBeNull();
		expect(diagnostics).toHaveLength(0);
		expect(parsed!.report.id).toBe("FIXTURE_TVR_001");
		expect(parsed!.report.type).toBe("TVR");
	});

	it("should extract report section from valid YAML", () => {
		const yaml = `accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "TEST_002"\n  type: "BSR"\n  family: "bugfix"`;
		const { parsed } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();
		expect(parsed!.sections.report).toBeDefined();
	});

	// ---------------------------------------------------------------------------
	// Extractor tests
	// ---------------------------------------------------------------------------

	it("should return pure YAML unchanged via extractor", () => {
		const yaml = 'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"';
		const result = extractAccpYaml(yaml);
		expect(result.yaml).toBe(yaml);
		expect(result.diagnostics).toHaveLength(0);
	});

	it("should extract YAML from code fence in markdown", () => {
		const text =
			'Some text\n\n```yaml\naccp_version: "2.0.0"\nsource_format: "ACCP-YAML"\nreport:\n  id: "E001"\n  type: "TVR"\n  family: "core"\n```\n\nMore text';
		const result = extractAccpYaml(text);
		expect(result.yaml).not.toBeNull();
		expect(result.yaml).toContain('accp_version: "2.0.0"');
		expect(result.diagnostics.some((d) => d.severity === "warning")).toBe(true);
	});

	it("should extract YAML from text with leading content", () => {
		const text =
			'Here is my report\n\naccp_version: "2.0.0"\nsource_format: "ACCP-YAML"\nreport:\n  id: "E002"\n  type: "IPR"\n  family: "core"';
		const result = extractAccpYaml(text);
		expect(result.yaml).not.toBeNull();
		expect(result.yaml).toContain('accp_version: "2.0.0"');
		expect(result.diagnostics.some((d) => d.severity === "warning")).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// Negative tests
	// ---------------------------------------------------------------------------

	it("should reject empty YAML", () => {
		const { parsed, diagnostics } = parseAccpYaml("");
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
	});

	it("should reject YAML that does not start with accp_version", () => {
		const { parsed, diagnostics } = parseAccpYaml("foo: bar\nbaz: qux");
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.code === "ACCP_PARSE_YAML_INVALID")).toBe(true);
	});

	it("should reject YAML with wrong source_format", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "MARKDOWN"\n\nreport:\n  id: "T001"\n  type: "TVR"\n  family: "core"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.code === "ACCP_SCHEMA_MISSING_REQUIRED_SECTION")).toBe(true);
	});

	it("should reject YAML missing report.id", () => {
		const yaml = 'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  type: "TVR"\n  family: "core"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.length).toBeGreaterThan(0);
	});

	it("should reject whitespace-only input via extractor", () => {
		const result = extractAccpYaml("   \n  ");
		expect(result.yaml).toBeNull();
		expect(result.diagnostics[0].fatal).toBe(true);
	});

	it("should return null from extractor when no YAML is found", () => {
		const result = extractAccpYaml("This is just a regular text message with no YAML content.");
		expect(result.yaml).toBeNull();
		expect(result.diagnostics[0].fatal).toBe(true);
	});
});
