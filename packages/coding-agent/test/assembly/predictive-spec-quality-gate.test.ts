import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../src/core/assembly/contract-coverage-calculator.js";
import {
	DEFAULT_QUALITY_GATE_THRESHOLDS,
	evaluateQualityGate,
	type QualityGateInput,
	type QualityGateThresholds,
} from "../../src/core/assembly/predictive-spec-quality-gate.js";
import { createSpecQualityHistoryStore } from "../../src/core/assembly/spec-quality-history.js";
import { createSpecQualityLedger } from "../../src/core/assembly/spec-quality-ledger.js";

// =============================================================================
// Helpers
// =============================================================================

function greenInput(overrides?: Partial<QualityGateInput>): QualityGateInput {
	const coverage = calculateCoverage([
		{ contract: "a.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "b.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "c.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "d.ts", evidenceClass: "human_approval", required: true },
		{ contract: "e.ts", evidenceClass: "static_confirmation", required: true },
	]);
	return {
		coverage,
		ledgerReliable: true,
		...overrides,
	};
}

function blockedInput(): QualityGateInput {
	const coverage = calculateCoverage([
		{ contract: "a.ts", evidenceClass: "llm_only", required: true },
		{ contract: "b.ts", evidenceClass: "llm_only", required: true },
	]);
	return { coverage, ledgerReliable: false };
}

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("PredictiveSpecQualityGate — positive path", () => {
	it("all-green input with low risk allows freeze at max parallelism", () => {
		const verdict = evaluateQualityGate(greenInput());
		expect(verdict.decision).toBe("allow");
		expect(verdict.freezePermitted).toBe(true);
		expect(verdict.blockingReasons).toHaveLength(0);
		expect(verdict.hirRequired).toBe(false);
		expect(verdict.recommendedMaxWorkers).toBeGreaterThanOrEqual(6);
	});

	it("low risk trend allows higher recommended workers", () => {
		const ledger = createSpecQualityLedger();
		for (let i = 0; i < 20; i++) {
			ledger.record({
				id: `m${i}`,
				contract: `c${i}.ts`,
				namespace: "ns",
				predictedOutcome: "matched",
				actualOutcome: "matched",
				evidenceClass: "static_confirmation",
				recordedAt: new Date().toISOString(),
			});
		}
		const store = createSpecQualityHistoryStore(ledger);
		const trend = store.analyzeTrend(new Date().toISOString());

		const input = greenInput({ trend, ledgerReliable: true });
		const verdict = evaluateQualityGate(input);
		expect(verdict.decision).toBe("allow");
		expect(verdict.recommendedMaxWorkers).toBeGreaterThanOrEqual(6);
	});

	it("insufficient history with allow_freeze policy", () => {
		// Override thresholds to not force downgrade
		const thresholds: QualityGateThresholds = {
			...DEFAULT_QUALITY_GATE_THRESHOLDS,
			insufficientHistoryForcesDowngrade: false,
		};
		const input = greenInput({ ledgerReliable: false });
		const verdict = evaluateQualityGate(input, thresholds);
		expect(verdict.decision).toBe("allow");
		expect(verdict.freezePermitted).toBe(true);
	});

	it("produces suggested action for each decision type", () => {
		const allow = evaluateQualityGate(greenInput());
		expect(allow.suggestedAction).toContain("permitted");

		const hold = evaluateQualityGate({
			...greenInput(),
			trend: { direction: "degrading", current: null, previous: null, sampleSize: 0, riskScore: 0.5 },
		});
		expect(hold.suggestedAction).toContain("hold");
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("PredictiveSpecQualityGate — negative path", () => {
	it("blocked coverage blocks the gate", () => {
		const verdict = evaluateQualityGate(blockedInput());
		expect(verdict.decision).toBe("block");
		expect(verdict.freezePermitted).toBe(false);
		expect(verdict.hirRequired).toBe(true);
		expect(verdict.blockingReasons.length).toBeGreaterThan(0);
	});

	it("high risk score (>= 0.8) causes hard block", () => {
		const input = greenInput({
			trend: { direction: "degrading", current: null, previous: null, sampleSize: 10, riskScore: 0.85 },
		});
		const verdict = evaluateQualityGate(input);
		expect(verdict.decision).toBe("block");
		expect(verdict.hirRequired).toBe(true);
	});

	it("moderate risk score (0.4-0.8) causes hold", () => {
		const input = greenInput({
			trend: { direction: "stable", current: null, previous: null, sampleSize: 10, riskScore: 0.5 },
		});
		const verdict = evaluateQualityGate(input);
		expect(verdict.decision).toBe("hold");
		expect(verdict.freezePermitted).toBe(false);
		expect(verdict.hirRequired).toBe(true);
		expect(verdict.recommendedMaxWorkers).toBe(3);
	});

	it("degrading trend forces hold", () => {
		const input = greenInput({
			trend: { direction: "degrading", current: null, previous: null, sampleSize: 10, riskScore: 0.3 },
		});
		const verdict = evaluateQualityGate(input);
		expect(verdict.decision).toBe("hold");
	});

	it("insufficient history forces downgrade by default", () => {
		const input = greenInput({ ledgerReliable: false });
		const verdict = evaluateQualityGate(input);
		expect(verdict.decision).toBe("downgrade");
		expect(verdict.freezePermitted).toBe(true);
		expect(verdict.recommendedMaxWorkers).toBeLessThan(6);
	});

	it("llm_only coverage violation sets DCR", () => {
		const coverage = calculateCoverage([
			{ contract: "a.ts", evidenceClass: "static_confirmation", required: true },
			{ contract: "b.ts", evidenceClass: "llm_only", required: true },
			{ contract: "c.ts", evidenceClass: "llm_only", required: true },
			{ contract: "d.ts", evidenceClass: "llm_only", required: true },
		]);
		// Hard = 1/4 = 0.25, llm = 3/4 = 0.75
		expect(coverage.admitted).toBe(false);
		const verdict = evaluateQualityGate({ coverage, ledgerReliable: true });
		expect(verdict.dcrRequired).toBe(true);
		expect(verdict.decision).toBe("block");
	});

	it("unknown required contracts set DCR", () => {
		const coverage = calculateCoverage([
			{ contract: "a.ts", evidenceClass: "static_confirmation", required: true },
			{ contract: "b.ts", evidenceClass: "unknown", required: true },
		]);
		const verdict = evaluateQualityGate({ coverage, ledgerReliable: false });
		expect(verdict.decision).toBe("block");
		expect(verdict.dcrRequired).toBe(true);
	});

	it("block decision recommends zero workers", () => {
		const input = greenInput({
			trend: { direction: "degrading", current: null, previous: null, sampleSize: 10, riskScore: 0.9 },
		});
		const verdict = evaluateQualityGate(input);
		expect(verdict.decision).toBe("block");
		expect(verdict.recommendedMaxWorkers).toBe(0);
	});
});
