/**
 * ACCP Gate Evaluator Tests
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { compileGateVerdict } from "../src/emit/emit-gate-verdict.js";
import { evaluateGate } from "../src/gate/gate-evaluator.js";
import { evaluatePromotion } from "../src/gate/promotion-evaluator.js";

describe("ACCP Gate Verdict Compiler", () => {
	it("should pass a gate with no diagnostics and complete evidence", () => {
		const verdict = compileGateVerdict("TEST_001", "TVR", [], "complete");
		expect(verdict.valid).toBe(true);
		expect(verdict.promotionReady).toBe(true);
		expect(verdict.findingCount).toBe(0);
	});

	it("should fail a gate with fatal errors", () => {
		const diagnostics: AccpDiagnostic[] = [
			{ code: "ACCP_PARSE_YAML_INVALID", message: "Invalid YAML", severity: "error", fatal: true },
		];
		const verdict = compileGateVerdict("TEST_001", "TVR", diagnostics, "complete");
		expect(verdict.valid).toBe(false);
		expect(verdict.fatalErrors.length).toBe(1);
		expect(verdict.findingCount).toBe(1);
	});

	it("should not be promotion-ready with partial evidence", () => {
		const verdict = compileGateVerdict("TEST_001", "TVR", [], "partial");
		expect(verdict.valid).toBe(true);
		expect(verdict.promotionReady).toBe(false);
	});

	it("should fail gate with missing evidence", () => {
		const verdict = compileGateVerdict("TEST_001", "TVR", [], "missing");
		expect(verdict.valid).toBe(false);
	});

	it("should pass gate with warnings but no fatal errors", () => {
		const diagnostics: AccpDiagnostic[] = [
			{ code: "ACCP_PARSE_YAML_INVALID", message: "Minor warning", severity: "warning", fatal: false },
		];
		const verdict = compileGateVerdict("TEST_001", "TVR", diagnostics, "complete");
		expect(verdict.valid).toBe(true);
		expect(verdict.warnings.length).toBe(1);
	});

	it("should include blocking findings in verdict", () => {
		const diagnostics: AccpDiagnostic[] = [
			{ code: "ACCP_PARSE_YAML_INVALID", message: "Fatal parse error", severity: "error", fatal: true },
		];
		const verdict = compileGateVerdict("TEST_001", "TVR", diagnostics);
		expect(verdict.blockingFindings).toContain("Fatal parse error");
	});
});

describe("ACCP Gate Evaluator", () => {
	it("should evaluate gate via evaluateGate", () => {
		const verdict = evaluateGate("TEST_001", "TVR", [], "complete");
		expect(verdict.valid).toBe(true);
	});
});

describe("ACCP Promotion Evaluator", () => {
	it("should report promotion ready when gate passes with complete evidence", () => {
		const verdict = compileGateVerdict("TEST_002", "PRR", [], "complete");
		const result = evaluatePromotion(verdict);
		expect(result.ready).toBe(true);
		expect(result.blockingReasons).toHaveLength(0);
	});

	it("should report blocking reasons when gate fails", () => {
		const diagnostics: AccpDiagnostic[] = [
			{ code: "ACCP_GATE_BLOCKING_FINDING_OPEN", message: "Blocker still open", severity: "error", fatal: true },
		];
		const verdict = compileGateVerdict("TEST_002", "PRR", diagnostics, "complete");
		const result = evaluatePromotion(verdict);
		expect(result.ready).toBe(false);
		expect(result.blockingReasons.length).toBeGreaterThan(0);
	});

	it("should not promote when evidence is missing", () => {
		const verdict = compileGateVerdict("TEST_003", "TVR", [], "missing");
		const result = evaluatePromotion(verdict);
		expect(result.ready).toBe(false);
		expect(result.blockingReasons).toContain("Evidence is missing");
	});
});
