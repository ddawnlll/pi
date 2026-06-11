/**
 * ACCP Route Signal Compiler Tests
 */

import type { AccpDiagnostic, AccpReportType } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { compileRouteSignal } from "../src/emit/emit-route-signal.js";
import { checkRoutePolicy } from "../src/gate/route-policy.js";

describe("ACCP Route Signal Compiler", () => {
	// ---------------------------------------------------------------------------
	// Positive tests
	// ---------------------------------------------------------------------------

	it("should compile a route signal from a passing TVR", () => {
		const findings: AccpDiagnostic[] = [];
		const { signal } = compileRouteSignal("P49_TVR_001", "TVR", findings);

		expect(signal.sourceReportId).toBe("P49_TVR_001");
		expect(signal.sourceReportType).toBe("TVR");
		expect(signal.recommendedNextRoute).toBe("PRR");
		expect(signal.recommendedNextAction).toBe("promotion_readiness");
		expect(signal.isAdvisory).toBe(true);
		expect(signal.targetResolved).toBe(true);
		expect(signal.confidence).toBe("high");
	});

	it("should compile a route signal from a failing TVR", () => {
		const findings: AccpDiagnostic[] = [
			{ code: "ACCP_PARSE_YAML_INVALID", message: "fail", severity: "error", fatal: true },
		];
		const { signal } = compileRouteSignal("P49_TVR_002", "TVR", findings);

		expect(signal.recommendedNextRoute).toBe("BSR");
		expect(signal.mutationPolicyNeeded).toBe("read_only");
		expect(signal.confidence).toBe("high");
	});

	it("should compile a route signal from a passing IPR", () => {
		const { signal } = compileRouteSignal("P49_IPR_001", "IPR", []);
		expect(signal.recommendedNextRoute).toBe("TVR");
		expect(signal.mutationPolicyNeeded).toBe("validation_only");
	});

	it("should compile a route signal from a HIR", () => {
		const { signal } = compileRouteSignal("P49_HIR_001", "HIR", []);
		expect(signal.recommendedNextRoute).toBe("BSR");
		expect(signal.confidence).toBe("medium");
	});

	// ---------------------------------------------------------------------------
	// Negative tests — advisory authority
	// ---------------------------------------------------------------------------

	it("should always mark route signals as advisory", () => {
		const { signal } = compileRouteSignal("TEST_001", "TVR", []);
		expect(signal.isAdvisory).toBe(true);
	});

	it("should not set isAdvisory to false under any condition", () => {
		// Even with empty findings and perfect state, signals are advisory
		const tests: AccpReportType[] = ["TVR", "BSR", "PRR", "IPR", "FPR", "HIR", "CAR"];
		for (const rt of tests) {
			const { signal } = compileRouteSignal("TEST_001", rt, []);
			expect(signal.isAdvisory).toBe(true);
		}
	});

	it("should produce unresolved target for unknown report types", () => {
		const { signal, diagnostics } = compileRouteSignal("TEST_001", "FCR" as AccpReportType, []);
		expect(signal.targetResolved).toBe(false);
		expect(diagnostics.length).toBeGreaterThan(0);
	});

	// ---------------------------------------------------------------------------
	// Route policy tests
	// ---------------------------------------------------------------------------

	it("should auto-advance read-only routes with high confidence", () => {
		const { signal } = compileRouteSignal("TEST_001", "BSR", []);
		const policy = checkRoutePolicy(signal);
		expect(policy.canAutoAdvance).toBe(true);
		expect(policy.hirRequired).toBe(false);
	});

	it("should require HIR for promotion route (no target — runtime decision)", () => {
		const { signal } = compileRouteSignal("TEST_001", "PRR", []);
		// PRR with passing findings has no route target — promotion is a runtime decision
		const policy = checkRoutePolicy(signal);
		expect(policy.canAutoAdvance).toBe(false);
		expect(policy.hirRequired).toBe(true);
	});

	it("should require HIR for unresolved targets", () => {
		const { signal } = compileRouteSignal("TEST_001", "FCR" as AccpReportType, []);
		const policy = checkRoutePolicy(signal);
		expect(policy.hirRequired).toBe(true);
	});

	it("should block validation routes when validation commands not allowed", () => {
		const { signal } = compileRouteSignal("TEST_001", "IPR", []);
		const policy = checkRoutePolicy(signal, false);
		expect(policy.canAutoAdvance).toBe(false);
	});

	it("should allow validation routes when validation commands are allowed", () => {
		const { signal } = compileRouteSignal("TEST_001", "IPR", []);
		const policy = checkRoutePolicy(signal, true);
		expect(policy.canAutoAdvance).toBe(true);
	});
});
