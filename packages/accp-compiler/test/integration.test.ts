/**
 * ACCP Compiler Integration Tests (P49.29)
 *
 * Verifies the full compiler pipeline from parse to emit.
 */
import { describe, expect, it } from "vitest";
import { compileAccpSource } from "../src/compiler.js";
import { compileGateVerdict } from "../src/emit/emit-gate-verdict.js";
import { compileRouteSignal } from "../src/emit/emit-route-signal.js";
import { evaluatePromotion } from "../src/gate/promotion-evaluator.js";
import { parseAccpYaml } from "../src/parser/yaml-parser.js";
import { validateCommonSchema } from "../src/validation/common-schema-validator.js";

describe("ACCP Compiler Integration", () => {
	it("should compile valid YAML end-to-end", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "INT_TEST_001"\n  type: "TVR"\n  family: "core"';
		const result = compileAccpSource(yaml);
		expect(result.status).toBe("compiled");
		expect(result.reportId).toBe("PARSED");
		expect(result.hasBlockingFindings).toBe(false);
	});

	it("should parse, validate, and produce route signal", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\n\nreport:\n  id: "INT_TEST_002"\n  type: "TVR"\n  family: "core"';
		const { parsed } = parseAccpYaml(yaml);
		expect(parsed).not.toBeNull();

		if (parsed) {
			const schemaDiags = validateCommonSchema(parsed);
			expect(schemaDiags).toHaveLength(0);

			const { signal } = compileRouteSignal(parsed.report.id, parsed.report.type, []);
			expect(signal.isAdvisory).toBe(true);
			expect(signal.recommendedNextRoute).toBe("PRR");
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
