import { describe, expect, it } from "vitest";
import { ProgressiveParallelismRamp, type RampInput } from "../../src/core/assembly/progressive-parallelism-ramp.js";

// =============================================================================
// Helpers
// =============================================================================

function greenInput(overrides?: Partial<RampInput>): RampInput {
	return {
		governorSignal: "green",
		ledgerEntries: 50,
		riskScore: 0.1,
		stableRunCount: 0,
		operatorVisibilityRemaining: 100,
		dryRun: false,
		...overrides,
	};
}

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("ProgressiveParallelismRamp — positive path", () => {
	it("starts at stable_6 with 6 max workers", () => {
		const ramp = new ProgressiveParallelismRamp();
		const state = ramp.getState();
		expect(state.currentTier).toBe("stable_6");
		expect(state.currentMaxWorkers).toBe(6);
	});

	it("records stable runs", () => {
		const ramp = new ProgressiveParallelismRamp();
		ramp.recordStableRun();
		ramp.recordStableRun();
		ramp.recordStableRun();
		expect(ramp.getState().stableRunCount).toBe(3);
	});

	it("promotes to stable_8 after sufficient runs", () => {
		const ramp = new ProgressiveParallelismRamp();
		// Record 3 stable runs
		for (let i = 0; i < 3; i++) ramp.recordStableRun();

		const input = greenInput({ stableRunCount: 3 });
		const evalResult = ramp.evaluatePromotion(input);
		expect(evalResult.canPromote).toBe(true);
		expect(evalResult.nextTier).toBe("stable_8");

		const promoteResult = ramp.promote("evidence-hash-1");
		expect(promoteResult.success).toBe(true);
		expect(ramp.getState().currentTier).toBe("stable_8");
		expect(ramp.getState().currentMaxWorkers).toBe(8);
		expect(ramp.getState().stableRunCount).toBe(0); // reset
	});

	it("promotes through stable_8 to stable_12", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		ramp.promote("h1");

		for (let i = 0; i < 5; i++) ramp.recordStableRun();
		const evalResult = ramp.evaluatePromotion(greenInput({ stableRunCount: 5 }));
		expect(evalResult.canPromote).toBe(true);
		expect(evalResult.nextTier).toBe("stable_12");
	});

	it("stays at stable_6 when governor is not green", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();

		const evalResult = ramp.evaluatePromotion(greenInput({ governorSignal: "yellow" }));
		expect(evalResult.canPromote).toBe(false);
		expect(evalResult.reason).toContain("Governor");
	});

	it("promotion history tracks all promotions", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		ramp.promote("h1");

		for (let i = 0; i < 5; i++) ramp.recordStableRun();
		ramp.promote("h2");

		const state = ramp.getState();
		expect(state.promotionHistory).toHaveLength(2);
		expect(state.promotionHistory[0].tier).toBe("stable_8");
		expect(state.promotionHistory[1].tier).toBe("stable_12");
	});

	it("unbounded requires stable_12 history", () => {
		const ramp = new ProgressiveParallelismRamp();
		// Promote through all tiers
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		ramp.promote("h1");
		for (let i = 0; i < 5; i++) ramp.recordStableRun();
		ramp.promote("h2");
		for (let i = 0; i < 8; i++) ramp.recordStableRun();

		const evalResult = ramp.evaluatePromotion(greenInput({ stableRunCount: 8, dryRun: true }));
		expect(evalResult.canPromote).toBe(true);
		expect(evalResult.nextTier).toBe("unbounded_logical");
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("ProgressiveParallelismRamp — negative path", () => {
	it("cannot promote without sufficient stable runs", () => {
		const ramp = new ProgressiveParallelismRamp();
		ramp.recordStableRun(); // only 1 of 3 needed
		const evalResult = ramp.evaluatePromotion(greenInput({ stableRunCount: 1 }));
		expect(evalResult.canPromote).toBe(false);
		expect(evalResult.reason).toContain("Need 3");
	});

	it("cannot promote with high risk score", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		const evalResult = ramp.evaluatePromotion(greenInput({ riskScore: 0.8 }));
		expect(evalResult.canPromote).toBe(false);
		expect(evalResult.reason).toContain("Risk score");
	});

	it("cannot promote with insufficient ledger entries", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		const evalResult = ramp.evaluatePromotion(greenInput({ ledgerEntries: 5 }));
		expect(evalResult.canPromote).toBe(false);
		expect(evalResult.reason).toContain("ledger entries");
	});

	it("unbounded requires operator visibility", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		ramp.promote("h1");
		for (let i = 0; i < 5; i++) ramp.recordStableRun();
		ramp.promote("h2");
		for (let i = 0; i < 8; i++) ramp.recordStableRun();

		const evalResult = ramp.evaluatePromotion(
			greenInput({
				stableRunCount: 8,
				operatorVisibilityRemaining: -1,
			}),
		);
		expect(evalResult.canPromote).toBe(false);
		expect(evalResult.reason).toContain("visibility");
	});

	it("cannot promote beyond unbounded_logical", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		ramp.promote("h1");
		for (let i = 0; i < 5; i++) ramp.recordStableRun();
		ramp.promote("h2");
		for (let i = 0; i < 8; i++) ramp.recordStableRun();
		ramp.promote("h3");

		const result = ramp.promote("h4");
		expect(result.success).toBe(false);
		expect(result.reason).toContain("highest");
	});

	it("governor red blocks promotion even with enough runs", () => {
		const ramp = new ProgressiveParallelismRamp();
		for (let i = 0; i < 3; i++) ramp.recordStableRun();
		const evalResult = ramp.evaluatePromotion(greenInput({ governorSignal: "red" }));
		expect(evalResult.canPromote).toBe(false);
	});
});
