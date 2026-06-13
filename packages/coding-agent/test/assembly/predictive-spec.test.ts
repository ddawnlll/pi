import { describe, expect, it } from "vitest";
import { freezeSpec, isContractValid, verifyFrozenContract } from "../../src/core/assembly/contract-freeze.js";
import { generatePredictiveSpec } from "../../src/core/assembly/predictive-spec.js";
import type { PredictiveSpec, SpecFactBundle } from "../../src/core/assembly/predictive-spec-input.js";
import { validatePredictiveSpec } from "../../src/core/assembly/predictive-spec-validator.js";

// =============================================================================
// Helpers
// =============================================================================

function makeFacts(overrides?: Partial<SpecFactBundle>): SpecFactBundle {
	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		repoRoot: "/fake/repo",
		targetDir: "src/core/assembly",
		totalFiles: 5,
		totalExports: 10,
		totalRoutes: 0,
		files: [
			{
				path: "src/core/assembly/p45-prerequisite-gate.ts",
				sizeBytes: 1000,
				lastModified: new Date().toISOString(),
				exports: [
					{
						name: "evaluateP45PrerequisiteGate",
						kind: "function",
						file: "src/core/assembly/p45-prerequisite-gate.ts",
						isDefault: false,
					},
				],
			},
			{
				path: "src/core/assembly/spec-quality-ledger.ts",
				sizeBytes: 2000,
				lastModified: new Date().toISOString(),
				exports: [
					{
						name: "SpecQualityLedger",
						kind: "class",
						file: "src/core/assembly/spec-quality-ledger.ts",
						isDefault: false,
					},
				],
			},
			{
				path: "src/core/assembly/contract-coverage-calculator.ts",
				sizeBytes: 1500,
				lastModified: new Date().toISOString(),
				exports: [
					{
						name: "calculateCoverage",
						kind: "function",
						file: "src/core/assembly/contract-coverage-calculator.ts",
						isDefault: false,
					},
				],
			},
			{
				path: "src/core/assembly/predictive-spec-quality-gate.ts",
				sizeBytes: 1800,
				lastModified: new Date().toISOString(),
				exports: [
					{
						name: "evaluateQualityGate",
						kind: "function",
						file: "src/core/assembly/predictive-spec-quality-gate.ts",
						isDefault: false,
					},
				],
			},
			{
				path: "src/core/assembly/semantic-conflict-analyzer.ts",
				sizeBytes: 2200,
				lastModified: new Date().toISOString(),
				exports: [
					{
						name: "SemanticConflictAnalyzer",
						kind: "class",
						file: "src/core/assembly/semantic-conflict-analyzer.ts",
						isDefault: false,
					},
				],
			},
		],
		routes: [],
		namespaceCandidates: [
			["src/core/assembly/p45-prerequisite-gate.ts", "src/core/assembly/spec-quality-ledger.ts"],
			["src/core/assembly/contract-coverage-calculator.ts", "src/core/assembly/predictive-spec-quality-gate.ts"],
			["src/core/assembly/semantic-conflict-analyzer.ts"],
		],
		...overrides,
	};
}

// =============================================================================
// Predictive Spec Tests
// =============================================================================

describe("PredictiveSpec — generation", () => {
	it("generates spec from facts", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		expect(spec.namespaces.length).toBeGreaterThan(0);
		expect(spec.contractPredictions.length).toBeGreaterThan(0);
		expect(spec.factBundleHash).toBeTruthy();
	});

	it("all predictions use static_confirmation", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		for (const pred of spec.contractPredictions) {
			expect(pred.evidenceClass).toBe("static_confirmation");
		}
	});

	it("coverage breakdown reflects all static predictions", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		expect(spec.coverageBreakdown.llmOnlyCount).toBe(0);
		expect(spec.coverageBreakdown.staticCount).toBe(spec.contractPredictions.length);
	});

	it("same facts (excluding generatedAt) produce deterministic spec", () => {
		const facts = makeFacts();
		const spec1 = generatePredictiveSpec(facts);
		const spec2 = generatePredictiveSpec(facts);
		// generatedAt differs, but contract predictions are deterministic
		expect(spec1.contractPredictions.length).toBe(spec2.contractPredictions.length);
		expect(spec1.coverageBreakdown.staticCount).toBe(spec2.coverageBreakdown.staticCount);
		// factBundleHash includes generatedAt from facts, so it differs
		// That's expected — the hash is for traceability, not determinism
	});
});

// =============================================================================
// Validator Tests
// =============================================================================

describe("PredictiveSpecValidator — positive", () => {
	it("valid spec with disjoint namespaces passes", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const result = validatePredictiveSpec(spec);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});

describe("PredictiveSpecValidator — negative", () => {
	it("overlapping namespace assignment fails", () => {
		const spec: PredictiveSpec = {
			schemaVersion: "1.0.0",
			generatedAt: new Date().toISOString(),
			factBundleHash: "fake",
			namespaces: [
				{ namespace: "ns-0", files: ["a.ts", "b.ts"], contracts: [] },
				{ namespace: "ns-1", files: ["b.ts", "c.ts"], contracts: [] }, // b.ts overlaps
			],
			sharedIntegrationFiles: [],
			assemblerOnlyFiles: [],
			contractPredictions: [],
			coverageBreakdown: { staticCount: 0, humanCount: 0, historicalCount: 0, llmOnlyCount: 0, unknownCount: 0 },
		};
		const result = validatePredictiveSpec(spec);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.rule === "disjoint_namespaces")).toBe(true);
	});

	it("assembler-only file in namespace fails", () => {
		const spec: PredictiveSpec = {
			schemaVersion: "1.0.0",
			generatedAt: new Date().toISOString(),
			factBundleHash: "fake",
			namespaces: [{ namespace: "ns-0", files: ["index.ts", "a.ts"], contracts: [] }],
			sharedIntegrationFiles: [],
			assemblerOnlyFiles: ["index.ts"],
			contractPredictions: [],
			coverageBreakdown: { staticCount: 0, humanCount: 0, historicalCount: 0, llmOnlyCount: 0, unknownCount: 0 },
		};
		const result = validatePredictiveSpec(spec);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.rule === "assembler_only_violation")).toBe(true);
	});

	it("invalid evidence class fails", () => {
		const spec: PredictiveSpec = {
			schemaVersion: "1.0.0",
			generatedAt: new Date().toISOString(),
			factBundleHash: "fake",
			namespaces: [],
			sharedIntegrationFiles: [],
			assemblerOnlyFiles: [],
			contractPredictions: [
				{
					contract: "a.ts",
					namespace: "ns",
					predictedOutcome: "matched",
					evidenceClass: "invalid" as "static_confirmation",
					confidence: 0.5,
					source: "test",
				},
			],
			coverageBreakdown: { staticCount: 0, humanCount: 0, historicalCount: 0, llmOnlyCount: 0, unknownCount: 0 },
		};
		const result = validatePredictiveSpec(spec);
		expect(result.valid).toBe(false);
	});
});

// =============================================================================
// Contract Freeze Tests
// =============================================================================

describe("ContractFreeze", () => {
	it("freezes spec and produces hash", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const contract = freezeSpec(spec);
		expect(contract.frozen).toBe(true);
		expect(contract.specHash).toBeTruthy();
	});

	it("verifies frozen contract successfully", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const contract = freezeSpec(spec);
		const result = verifyFrozenContract(contract);
		expect(result.success).toBe(true);
	});

	it("detects tampered contract", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const contract = freezeSpec(spec);
		contract.specHash = "tampered";
		const result = verifyFrozenContract(contract);
		expect(result.success).toBe(false);
	});

	it("isContractValid returns false for unfrozen contract", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const contract = freezeSpec(spec);
		(contract as { frozen: boolean }).frozen = false;
		expect(isContractValid(contract)).toBe(false);
	});
});
