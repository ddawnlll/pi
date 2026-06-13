import { describe, expect, it } from "vitest";
import { DriftBudgetGate } from "../../src/core/assembly/drift-budget-gate.js";

describe("DriftBudgetGate — positive path", () => {
	it("new gate has full budget", () => {
		const gate = new DriftBudgetGate();
		const verdict = gate.evaluate();
		expect(verdict.canContinue).toBe(true);
		expect(verdict.budget.remainingDrift).toBe(20);
		expect(verdict.budget.remainingBreakingDrift).toBe(5);
		expect(verdict.hardStop).toBe(false);
	});

	it("records compatible drift without exhausting budget", () => {
		const gate = new DriftBudgetGate();
		for (let i = 0; i < 10; i++) {
			gate.recordDrift({
				kind: "compatible",
				contract: `c${i}.ts`,
				namespace: "ns",
				detectedAt: new Date().toISOString(),
				specVersion: "v1",
				description: "compatible drift",
			});
		}
		const verdict = gate.evaluate();
		expect(verdict.canContinue).toBe(true);
		expect(verdict.budget.consumedDrift).toBe(10);
		expect(verdict.budget.remainingDrift).toBe(10);
		expect(verdict.hardStop).toBe(false);
	});

	it("hold is recommended at 50% budget", () => {
		const gate = new DriftBudgetGate({ maxDriftEvents: 10, maxBreakingDriftEvents: 3, holdAtHalfBudget: true });
		for (let i = 0; i < 5; i++) {
			gate.recordDrift({
				kind: "compatible",
				contract: `c${i}.ts`,
				namespace: "ns",
				detectedAt: new Date().toISOString(),
				specVersion: "v1",
				description: "drift",
			});
		}
		const verdict = gate.evaluate();
		expect(verdict.holdRecommended).toBe(true);
		expect(verdict.canContinue).toBe(true);
	});

	it("resolving drift events replenishes budget", () => {
		const gate = new DriftBudgetGate({ maxDriftEvents: 10, maxBreakingDriftEvents: 3, holdAtHalfBudget: false });
		for (let i = 0; i < 8; i++) {
			const event = gate.recordDrift({
				kind: "compatible",
				contract: `c${i}.ts`,
				namespace: "ns",
				detectedAt: new Date().toISOString(),
				specVersion: "v1",
				description: "drift",
			});
			if (i < 5) gate.resolveDrift(event.id);
		}
		const verdict = gate.evaluate();
		expect(verdict.budget.consumedDrift).toBe(3);
		expect(verdict.budget.remainingDrift).toBe(7);
	});

	it("getUnresolvedDrifts returns only unresolved", () => {
		const gate = new DriftBudgetGate();
		const e1 = gate.recordDrift({
			kind: "compatible",
			contract: "a.ts",
			namespace: "ns",
			detectedAt: new Date().toISOString(),
			specVersion: "v1",
			description: "d1",
		});
		gate.recordDrift({
			kind: "compatible",
			contract: "b.ts",
			namespace: "ns",
			detectedAt: new Date().toISOString(),
			specVersion: "v1",
			description: "d2",
		});
		gate.resolveDrift(e1.id);
		expect(gate.getUnresolvedDrifts()).toHaveLength(1);
	});
});

describe("DriftBudgetGate — negative path", () => {
	it("total drift budget exhaustion blocks", () => {
		const gate = new DriftBudgetGate({ maxDriftEvents: 5, maxBreakingDriftEvents: 3, holdAtHalfBudget: false });
		for (let i = 0; i < 5; i++) {
			gate.recordDrift({
				kind: "compatible",
				contract: `c${i}.ts`,
				namespace: "ns",
				detectedAt: new Date().toISOString(),
				specVersion: "v1",
				description: "drift",
			});
		}
		const verdict = gate.evaluate();
		expect(verdict.budget.budgetExhausted).toBe(true);
	});

	it("breaking drift budget exhaustion requires hard stop", () => {
		const gate = new DriftBudgetGate({ maxDriftEvents: 20, maxBreakingDriftEvents: 3, holdAtHalfBudget: false });
		for (let i = 0; i < 3; i++) {
			gate.recordDrift({
				kind: "breaking",
				contract: `c${i}.ts`,
				namespace: "ns",
				detectedAt: new Date().toISOString(),
				specVersion: "v1",
				description: "breaking drift",
			});
		}
		const verdict = gate.evaluate();
		expect(verdict.hardStop).toBe(true);
		expect(verdict.canContinue).toBe(false);
		expect(verdict.blockingReasons.length).toBeGreaterThan(0);
	});

	it("resolveDrift returns false for unknown ID", () => {
		const gate = new DriftBudgetGate();
		expect(gate.resolveDrift("nonexistent")).toBe(false);
	});

	it("clear resets all drift events", () => {
		const gate = new DriftBudgetGate();
		gate.recordDrift({
			kind: "breaking",
			contract: "x.ts",
			namespace: "ns",
			detectedAt: new Date().toISOString(),
			specVersion: "v1",
			description: "test",
		});
		gate.clear();
		const verdict = gate.evaluate();
		expect(verdict.budget.consumedDrift).toBe(0);
		expect(verdict.canContinue).toBe(true);
	});

	it("holdRecommended is false when holdAtHalfBudget is disabled", () => {
		const gate = new DriftBudgetGate({ maxDriftEvents: 10, maxBreakingDriftEvents: 5, holdAtHalfBudget: false });
		for (let i = 0; i < 6; i++) {
			gate.recordDrift({
				kind: "compatible",
				contract: `c${i}.ts`,
				namespace: "ns",
				detectedAt: new Date().toISOString(),
				specVersion: "v1",
				description: "drift",
			});
		}
		expect(gate.evaluate().holdRecommended).toBe(false);
	});
});
