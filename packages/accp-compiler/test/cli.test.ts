/**
 * ACCP Compiler CLI Tests
 */
import { describe, expect, it } from "vitest";
import { parseAccpYaml } from "../src/parser/yaml-parser.js";
import { validateCommonSchema } from "../src/validation/common-schema-validator.js";

describe("ACCP CLI Compile Path", () => {
	it("should compile valid YAML through the full pipeline", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "CLI_TEST_001"\n  type: "TVR"\n  family: "core"';
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();

		const schemaDiags = parsed ? validateCommonSchema(parsed) : [];
		const allDiags = [...diagnostics, ...schemaDiags];
		expect(allDiags.filter((d) => d.fatal)).toHaveLength(0);
	});

	it("should reject invalid YAML through the pipeline", () => {
		const yaml = "not_yaml: true\nnope: true";
		const { parsed, diagnostics } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
		expect(diagnostics.length).toBeGreaterThan(0);
	});
});
