/**
 * ACCP Compiler Integration Tests (P49.29 / V2)
 *
 * Verifies the full Compiler V2 pipeline from parse to emit.
 */
import { describe, expect, it } from "vitest";
import { compileAccpSource } from "../src/compiler.js";
import { compileGateVerdict } from "../src/emit/emit-gate-verdict.js";
import { compileRouteSignal } from "../src/emit/emit-route-signal.js";
import { evaluatePromotion } from "../src/gate/promotion-evaluator.js";
import { parseAccpYaml } from "../src/parser/yaml-parser.js";
import { validateCommonSchema } from "../src/validation/common-schema-validator.js";

const validRir = `accp_version: "2.0.0"
source_format: "ACCP-YAML"

report:
  id: "INT_TEST_001"
  type: "RIR"
  family: "core"

scope:
  target: "test"

evidence:
  - id: "EV001"
    type: "file"
    path: "packages/accp-compiler/src/compiler.ts"`;

describe("ACCP Compiler Integration", () => {
	it("should compile valid YAML end-to-end", () => {
		const result = compileAccpSource(validRir);
		expect(result.status).toBe("compiled");
		expect(result.reportId).toBe("INT_TEST_001");
		expect(result.reportType).toBe("RIR");
		expect(result.hasBlockingFindings).toBe(false);
	});

	it("should parse, validate, and produce route signal", () => {
		const { parsed } = parseAccpYaml(validRir);
		expect(parsed).not.toBeNull();

		if (parsed) {
			const schemaDiags = validateCommonSchema(parsed);
			expect(schemaDiags).toHaveLength(0);

			const { signal } = compileRouteSignal(parsed.report.id, parsed.report.type, []);
			expect(signal.isAdvisory).toBe(true);
			expect(signal.sourceReportType).toBe("RIR");
		}
	});

	it("should compile gate verdict and evaluate promotion", () => {
		const verdict = compileGateVerdict("INT_TEST_003", "PRR", [], "complete");
		expect(verdict.valid).toBe(true);
		expect(verdict.promotionReady).toBe(true);

		const promotion = evaluatePromotion(verdict);
		expect(promotion.ready).toBe(true);
	});
});
