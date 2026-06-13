import { describe, expect, it } from "vitest";
import type { ContractPrediction } from "../../src/core/assembly/predictive-spec-input.js";
import { validateObservation, validateObservations } from "../../src/core/assembly/strict-observation.js";
import { analyzeDependencyElimination } from "../../src/core/assembly/strict-observation-validator.js";

describe("StrictObservationValidator", () => {
	it("accepts static_analysis evidence for removal", () => {
		const pred: ContractPrediction = {
			contract: "a.ts",
			namespace: "ns",
			predictedOutcome: "matched",
			evidenceClass: "static_confirmation",
			confidence: 1.0,
			source: "test",
		};
		const result = validateObservation(pred, {
			contract: "a.ts",
			kind: "export_removed",
			evidenceSource: "static_analysis",
			detail: "No imports found",
		});
		expect(result.valid).toBe(true);
	});

	it("rejects declared-only evidence for removal", () => {
		const pred: ContractPrediction = {
			contract: "a.ts",
			namespace: "ns",
			predictedOutcome: "matched",
			evidenceClass: "static_confirmation",
			confidence: 1.0,
			source: "test",
		};
		const result = validateObservation(pred, {
			contract: "a.ts",
			kind: "export_removed",
			evidenceSource: "declared",
			detail: "I think it's unused",
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("declaration only");
	});

	it("rejects weak evidence for static_confirmation removal", () => {
		const pred: ContractPrediction = {
			contract: "a.ts",
			namespace: "ns",
			predictedOutcome: "matched",
			evidenceClass: "static_confirmation",
			confidence: 1.0,
			source: "test",
		};
		const result = validateObservation(pred, {
			contract: "a.ts",
			kind: "import_removed",
			evidenceSource: "test_coverage",
			detail: "Not covered",
		});
		expect(result.valid).toBe(false);
	});

	it("accepts compiler_output evidence for static contract", () => {
		const pred: ContractPrediction = {
			contract: "a.ts",
			namespace: "ns",
			predictedOutcome: "matched",
			evidenceClass: "static_confirmation",
			confidence: 1.0,
			source: "test",
		};
		const result = validateObservation(pred, {
			contract: "a.ts",
			kind: "type_unused",
			evidenceSource: "compiler_output",
			detail: "TS6133: declared but never used",
		});
		expect(result.valid).toBe(true);
	});

	it("batch validates multiple observations", () => {
		const preds: ContractPrediction[] = [
			{
				contract: "a.ts",
				namespace: "ns",
				predictedOutcome: "matched",
				evidenceClass: "static_confirmation",
				confidence: 1.0,
				source: "test",
			},
			{
				contract: "b.ts",
				namespace: "ns",
				predictedOutcome: "matched",
				evidenceClass: "llm_only",
				confidence: 0.5,
				source: "test",
			},
		];
		const result = validateObservations(preds, [
			{ contract: "a.ts", kind: "export_removed", evidenceSource: "declared", detail: "unused" },
			{ contract: "b.ts", kind: "export_removed", evidenceSource: "static_analysis", detail: "no refs" },
		]);
		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(1);
	});

	it("warns about observations for unknown contracts", () => {
		const preds: ContractPrediction[] = [];
		const result = validateObservations(preds, [
			{ contract: "unknown.ts", kind: "export_removed", evidenceSource: "static_analysis", detail: "test" },
		]);
		expect(result.warnings.length).toBe(1);
	});
});

describe("DependencyEliminationOptimizer", () => {
	it("blocks elimination of static_confirmation contracts", () => {
		const preds: ContractPrediction[] = [
			{
				contract: "a.ts",
				namespace: "ns",
				predictedOutcome: "matched",
				evidenceClass: "static_confirmation",
				confidence: 1.0,
				source: "test",
			},
		];
		const result = analyzeDependencyElimination(preds);
		expect(result[0].canEliminate).toBe(false);
	});

	it("allows elimination of llm_only contracts", () => {
		const preds: ContractPrediction[] = [
			{
				contract: "b.ts",
				namespace: "ns",
				predictedOutcome: "matched",
				evidenceClass: "llm_only",
				confidence: 0.5,
				source: "test",
			},
		];
		const result = analyzeDependencyElimination(preds);
		expect(result[0].canEliminate).toBe(true);
	});
});
