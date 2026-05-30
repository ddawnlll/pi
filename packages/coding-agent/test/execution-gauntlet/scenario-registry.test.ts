/**
 * Scenario Registry Tests — P38.1
 *
 * Verifies:
 * - Registry includes all required plans (G1–G12)
 * - Filtering by execution mode and category works
 * - Required plans check returns empty for complete registry
 */
import { describe, expect, it } from "vitest";
import { ScenarioRegistry } from "../../src/core/execution-gauntlet/scenario-registry.js";

describe("ScenarioRegistry", () => {
	it("registers all required G1–G12 plans", () => {
		const registry = new ScenarioRegistry();
		const missing = registry.requires();
		expect(missing).toEqual([]);
	});

	it("has exactly 12 scenarios", () => {
		const registry = new ScenarioRegistry();
		expect(registry.count).toBe(12);
	});

	it("get returns scenario by ID", () => {
		const registry = new ScenarioRegistry();
		const g1 = registry.get("G1");
		expect(g1).toBeDefined();
		expect(g1!.id).toBe("G1");
		expect(g1!.plan.name).toBe("hello_success");
		expect(g1!.executionMode).toBe("stable_3");
	});

	it("returns undefined for unknown plan", () => {
		const registry = new ScenarioRegistry();
		expect(registry.get("G99")).toBeUndefined();
	});

	it("filters by execution mode stable_3", () => {
		const registry = new ScenarioRegistry();
		const stable3 = registry.getFiltered({ executionMode: "stable_3" });
		// G1, G2, G5, G6, G7, G8, G9, G10, G11, G12 — 10 stable_3 plans
		expect(stable3.length).toBeGreaterThanOrEqual(8);
		for (const s of stable3) {
			expect(s.executionMode).toBe("stable_3");
		}
	});

	it("filters by execution mode patch_transaction", () => {
		const registry = new ScenarioRegistry();
		const pt = registry.getFiltered({ executionMode: "patch_transaction" });
		// G3, G4 — 2 patch_transaction plans
		expect(pt.length).toBeGreaterThanOrEqual(2);
		for (const s of pt) {
			expect(s.executionMode).toBe("patch_transaction");
		}
	});

	it("filters by completion gate tests", () => {
		const registry = new ScenarioRegistry();
		const cg = registry.getFiltered({ testsCompletionGate: true });
		expect(cg.length).toBeGreaterThanOrEqual(3); // G5, G6, G12
		for (const s of cg) {
			expect(s.testsCompletionGate).toBe(true);
		}
	});

	it("filters by lead agent tests", () => {
		const registry = new ScenarioRegistry();
		const lead = registry.getFiltered({ testsLeadAgent: true });
		expect(lead.length).toBeGreaterThanOrEqual(2); // G5, G7
		for (const s of lead) {
			expect(s.testsLeadAgent).toBe(true);
		}
	});

	it("filters by patch transaction tests", () => {
		const registry = new ScenarioRegistry();
		const pt = registry.getFiltered({ testsPatchTransaction: true });
		expect(pt.length).toBeGreaterThanOrEqual(2); // G3, G4
		for (const s of pt) {
			expect(s.testsPatchTransaction).toBe(true);
		}
	});

	it("filters by expectsSuccess", () => {
		const registry = new ScenarioRegistry();
		const success = registry.getFiltered({ expectsSuccess: true });
		const failure = registry.getFiltered({ expectsSuccess: false });

		expect(success.length).toBeGreaterThan(0);
		expect(failure.length).toBeGreaterThan(0);

		for (const s of success) {
			expect(s.expectsSuccess).toBe(true);
		}
		for (const s of failure) {
			expect(s.expectsSuccess).toBe(false);
		}
	});

	it("G1 is a happy-path scenario expecting success", () => {
		const registry = new ScenarioRegistry();
		const g1 = registry.get("G1")!;
		expect(g1.expectsSuccess).toBe(true);
		expect(g1.plan.category).toBe("happy-path");
	});

	it("G7 tests Lead Agent with escalation", () => {
		const registry = new ScenarioRegistry();
		const g7 = registry.get("G7")!;
		expect(g7.testsLeadAgent).toBe(true);
		expect(g7.expectsSuccess).toBe(false);
	});

	it("G9 tests stop-continue", () => {
		const registry = new ScenarioRegistry();
		const g9 = registry.get("G9")!;
		expect(g9.testsStopContinue).toBe(true);
	});
});
