import { describe, expect, it } from "vitest";
import { evaluatePromotion, generatePrrReport, DEFAULT_EVIDENCE } from "../../src/core/assembly/final-promotion.js";
import { buildOperatorDashboard } from "../../src/core/assembly/operator-dashboard.js";

describe("FinalPromotion", () => {
	it("green dashboard with all evidence passes promotes stable_6", () => {
		const dashboard = buildOperatorDashboard({});
		const verdict = evaluatePromotion(dashboard, {
			...DEFAULT_EVIDENCE,
			waveGates: { W0: { passed: true, commandCount: 11 }, W1: { passed: true, commandCount: 1 }, W2: { passed: true, commandCount: 2 } },
		});
		expect(verdict.decision).toBe("promote");
		expect(verdict.tiers.stable_6).toBe("ready");
	});

	it("failed tests blocks promotion", () => {
		const dashboard = buildOperatorDashboard({});
		const verdict = evaluatePromotion(dashboard, {
			...DEFAULT_EVIDENCE, failedTests: 1,
		});
		expect(verdict.decision).toBe("block");
	});

	it("failed typecheck blocks promotion", () => {
		const dashboard = buildOperatorDashboard({});
		const verdict = evaluatePromotion(dashboard, {
			...DEFAULT_EVIDENCE, typecheckPassed: false,
		});
		expect(verdict.decision).toBe("block");
	});

	it("unbounded_logical is always dry_run_only", () => {
		const dashboard = buildOperatorDashboard({});
		const verdict = evaluatePromotion(dashboard, {
			...DEFAULT_EVIDENCE,
			waveGates: {
				W0: { passed: true, commandCount: 11 },
				W1: { passed: true, commandCount: 1 },
				W2: { passed: true, commandCount: 2 },
				W3: { passed: true, commandCount: 2 },
				W4: { passed: true, commandCount: 3 },
				W5: { passed: true, commandCount: 4 },
			},
		});
		expect(verdict.tiers.unbounded_logical).toBe("dry_run_only");
	});

	it("generates PRR markdown report", () => {
		const dashboard = buildOperatorDashboard({});
		const verdict = evaluatePromotion(dashboard, DEFAULT_EVIDENCE);
		const report = generatePrrReport(verdict);
		expect(report).toContain("P45 Promotion Readiness Report");
		expect(report).toContain(verdict.decision.toUpperCase());
		expect(report).toContain("stable_6");
		expect(report).toContain("stable_8");
	});

	it("remaining evidence lists wave gates not yet passed", () => {
		const dashboard = buildOperatorDashboard({});
		const verdict = evaluatePromotion(dashboard, DEFAULT_EVIDENCE);
		expect(verdict.remainingEvidence.length).toBeGreaterThan(0);
		expect(verdict.remainingEvidence.some((e) => e.includes("W3"))).toBe(true);
	});
});
