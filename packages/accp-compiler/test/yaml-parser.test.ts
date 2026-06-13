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
		expect(parsed!.report.id).toBe("TEST_002");
		expect(parsed!.report.type).toBe("BSR");
		expect(parsed!.report.family).toBe("bugfix");
	});

	it("should parse a YAML with all common sections", () => {
		const yaml = readFileSync(resolve(import.meta.dirname, "fixtures", "valid_tvr.accp.yaml"), "utf-8");
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();
		expect(diagnostics).toHaveLength(0);
		expect(parsed!.meta).toBeDefined();
		expect(parsed!.report.kind).toBe("test_validation");
	});

	it("should parse nested YAML structures", () => {
		const yaml = `accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "NESTED_001"\n  type: "IPR"\n  family: "core"\n  kind: "implementation"\n  status: "draft"\n\nmeta:\n  plan_id: "P49"\n  workspace_id: "W001"\n  nested:\n    level1:\n      level2: "deep value"\n\nevidence:\n  - name: "test_result"\n    status: "pass"\n  - name: "lint_output"\n    status: "pass"\n\nreferences:\n  - "P49_IPR_001"\n  - "P49_FPR_002"`;
		const { parsed, diagnostics } = parseAccpYaml(yaml);

		expect(parsed).not.toBeNull();
		expect(diagnostics).toHaveLength(0);
		expect(parsed!.report.kind).toBe("implementation");
		expect(parsed!.report.status).toBe("draft");

		const meta = parsed!.meta as Record<string, unknown>;
		expect(meta).toBeDefined();
		expect(meta.plan_id).toBe("P49");
		const nested = meta.nested as Record<string, unknown>;
		expect(nested).toBeDefined();
		const level1 = nested.level1 as Record<string, unknown>;
		expect(level1.level2).toBe("deep value");
	});

	it("should parse all 24 report types without error", () => {
		const allTypes = [
			// Core
			{ type: "RIR", family: "core" },
			{ type: "PIR", family: "core" },
			{ type: "IPR", family: "core" },
			{ type: "TVR", family: "core" },
			{ type: "HIR", family: "core" },
			{ type: "RAR", family: "core" },
			{ type: "PRR", family: "core" },
			{ type: "CAR", family: "core" },
			// Bugfix
			{ type: "BSR", family: "bugfix" },
			{ type: "BRR", family: "bugfix" },
			{ type: "RCA", family: "bugfix" },
			{ type: "FPR", family: "bugfix" },
			{ type: "FVR", family: "bugfix" },
			// Feature
			{ type: "FER", family: "feature" },
			{ type: "FDR", family: "feature" },
			{ type: "FCR", family: "feature" },
			{ type: "FIR", family: "feature" },
			{ type: "FGR", family: "feature" },
			// Writing
			{ type: "WBR", family: "writing" },
			{ type: "WDR", family: "writing" },
			{ type: "WER", family: "writing" },
			{ type: "WQR", family: "writing" },
			// Coordination
			{ type: "ECR", family: "coordination" },
			{ type: "DCR", family: "coordination" },
		];

		for (const { type, family } of allTypes) {
			const yaml = `accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "TEST_${type}"\n  type: "${type}"\n  family: "${family}"`;
			const { parsed, diagnostics } = parseAccpYaml(yaml);
			expect(parsed).not.toBeNull();
			expect(diagnostics).toHaveLength(0);
			expect(parsed!.report.type).toBe(type);
			expect(parsed!.report.family).toBe(family);
		}
	});

	it("should parse examples from accp_v2_0_package without fatal errors", () => {
		const exampleFiles = [
			"tvr_minimal.accp.yaml",
			"bsr_minimal.accp.yaml",
			"fpr_minimal.accp.yaml",
			"prr_minimal.accp.yaml",
		];

		for (const filename of exampleFiles) {
			const yaml = readFileSync(
				resolve(import.meta.dirname, "..", "..", "..", "accp_v2_0_package", "examples", filename),
				"utf-8",
			);
			const { parsed, diagnostics } = parseAccpYaml(yaml);
			const fatals = diagnostics.filter((d) => d.fatal);
			expect(parsed).not.toBeNull();
			expect(fatals).toHaveLength(0);
		}
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

	it("should extract YAML from ```yaml fenced block (no space)", () => {
		const text =
			'```yaml\naccp_version: "2.0.0"\nsource_format: "ACCP-YAML"\nreport:\n  id: "E003"\n  type: "RIR"\n  family: "core"\n```';
		const result = extractAccpYaml(text);
		expect(result.yaml).not.toBeNull();
		expect(result.yaml).toContain('accp_version: "2.0.0"');
	});

	it("should reject XML-like wrappers via extractor", () => {
		const text = "<accp_report>\n  <accp_version>2.0.0</accp_version>\n</accp_report>";
		const result = extractAccpYaml(text);
		expect(result.yaml).toBeNull();
		expect(result.diagnostics.some((d) => d.fatal)).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// Strict Source Profile tests
	// ---------------------------------------------------------------------------

	it("should reject accp_version that is not 2.0.0", () => {
		const yaml =
			'accp_version: "1.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "T001"\n  type: "TVR"\n  family: "core"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
	});

	it("should warn when family does not match type (type-safe)", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "T001"\n  type: "TVR"\n  family: "bugfix"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();
		expect(diagnostics.some((d) => d.code === "ACCP_SCHEMA_FAMILY_TYPE_MISMATCH")).toBe(true);
	});

	it("should reject unknown report types", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "T001"\n  type: "XYZ"\n  family: "core"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.code === "ACCP_SCHEMA_INVALID_REPORT_TYPE")).toBe(true);
	});

	it("should reject unknown family values", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "T001"\n  type: "TVR"\n  family: "unknown_family"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.code === "ACCP_SCHEMA_INVALID_FAMILY")).toBe(true);
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
		expect(diagnostics.some((d) => d.code === "ACCP_PARSE_SOURCE_INVALID")).toBe(true);
	});

	it("should reject YAML with wrong source_format", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "MARKDOWN"\n\nreport:\n  id: "T001"\n  type: "TVR"\n  family: "core"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.code === "ACCP_SCHEMA_INVALID_SOURCE_FORMAT")).toBe(true);
	});

	it("should reject YAML missing report.id", () => {
		const yaml = 'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  type: "TVR"\n  family: "core"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.length).toBeGreaterThan(0);
	});

	it("should reject multiple YAML documents", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "T001"\n  type: "TVR"\n  family: "core"\n\n---\n\naccp_version: "2.0.0"\nsource_format: "ACCP-YAML"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
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

	// ---------------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------------

	it("should handle boolean and numeric values", () => {
		const yaml = `accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "EDGE_001"\n  type: "TVR"\n  family: "core"\n\nmeta:\n  enabled: true\n  count: 42\n  ratio: 0.75`;
		const { parsed } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();
		const meta = parsed!.meta as Record<string, unknown>;
		expect(meta.enabled).toBe(true);
		expect(meta.count).toBe(42);
		expect(meta.ratio).toBe(0.75);
	});

	it("should handle quoted strings with internal colons", () => {
		const yaml = `accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "EDGE_002"\n  type: "TVR"\n  family: "core"\n\nmeta:\n  message: "value: with: colons"`;
		const { parsed } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();
		const meta = parsed!.meta as Record<string, unknown>;
		expect(meta.message).toBe("value: with: colons");
	});

	it("should handle empty sections", () => {
		const yaml = `accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "EDGE_003"\n  type: "FCR"\n  family: "feature"\n\nreferences:\n`;
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();
		expect(diagnostics).toHaveLength(0);
	});

	it("should handle YAML with comment lines", () => {
		const yaml = `# My ACCP Report\naccp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\n# Report section\nreport:\n  # The report ID\n  id: "EDGE_004"\n  type: "TVR"\n  family: "core"`;
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();
		expect(parsed!.report.id).toBe("EDGE_004");
		expect(diagnostics).toHaveLength(0);
	});
});
