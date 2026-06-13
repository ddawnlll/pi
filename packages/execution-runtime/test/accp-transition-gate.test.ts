/**
 * ACCP Transition Gate Tests (P49.29)
 *
 * End-to-end gauntlets verifying the ACCP transition gate pipeline:
 * - Admission gate decisions with ACCP promotion gate satisfaction
 * - Guard execution entrypoint routing through ACCP admission
 * - Promotion evaluation across multiple gate verdicts
 * - Full native flow: admission → gate read → transition → promotion
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateAccpGateForTransition } from "../src/accp-gate-reader.js";
import { evaluateAccpPromotion } from "../src/accp-promotion-evaluator.js";
import { admitExecution } from "../src/admission-gate.js";
import { guardExecutionEntrypoint, listAdmissionDecisions, resetAdmissionDecisions } from "../src/admission-guard.js";

// =============================================================================
// Test fixtures
// =============================================================================

/** A valid gate verdict with no blocking issues. */
function validVerdict(reportId = "TEST_001", reportType: "TVR" | "PRR" = "TVR"): AccpGateVerdict {
	return {
		reportId,
		reportType,
		valid: true,
		fatalErrors: [],
		warnings: [],
		blockingFindings: [],
		findingCount: 0,
		promotionReady: true,
		evidenceStatus: "complete",
	};
}

/** An invalid gate verdict with fatal errors and blocking findings. */
function invalidVerdict(reportId = "TEST_001", reportType: "TVR" | "PRR" = "TVR"): AccpGateVerdict {
	return {
		reportId,
		reportType,
		valid: false,
		fatalErrors: ["ACCP_GATE_FATAL: compilation failure"],
		warnings: [],
		blockingFindings: ["ACCP_GATE_BLOCKING_FINDING_OPEN: unresolved reference"],
		findingCount: 2,
		promotionReady: false,
		evidenceStatus: "complete",
	};
}

/** An incomplete-evidence verdict. */
function missingEvidenceVerdict(reportId = "TEST_001"): AccpGateVerdict {
	return {
		reportId,
		reportType: "TVR",
		valid: false,
		fatalErrors: [],
		warnings: [],
		blockingFindings: ["ACCP_GATE_EVIDENCE_MISSING: command results not found"],
		findingCount: 1,
		promotionReady: false,
		evidenceStatus: "missing",
	};
}

// =============================================================================
// Gauntlet 1: Admission gate with ACCP promotion gate satisfaction
// =============================================================================

describe("P49.29 E2E: Admission Gate Gauntlet", () => {
	it("should reject execution when postgres is not available", () => {
		const decision = admitExecution({
			postgresAvailable: false,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("reject");
	});

	it("should reject execution when production uses json fallback", () => {
		const decision = admitExecution({
			postgresAvailable: true,
			production: true,
			jsonFallback: true,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("reject");
	});

	it("should reject execution when repair mode does not match autonomous mode", () => {
		const decision = admitExecution({
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: true,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("reject");
	});

	it("should reject execution when promotion gate is not satisfied", () => {
		const decision = admitExecution({
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: false,
		});
		expect(decision).toBe("reject");
	});

	it("should allow execution when all conditions are met", () => {
		const decision = admitExecution({
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("allow");
	});

	it("should allow execution with repair + autonomous mode matching", () => {
		const decision = admitExecution({
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: true,
			autonomousMode: true,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("allow");
	});
});

// =============================================================================
// Gauntlet 2: Guard execution entrypoint routing
// =============================================================================

describe("P49.29 E2E: Admission Guard Entrypoint Gauntlet", () => {
	beforeEach(() => {
		resetAdmissionDecisions();
	});

	it("should record admission decisions per entrypoint", () => {
		const record = guardExecutionEntrypoint("cli_plan_run", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(record.decision).toBe("allow");
		expect(record.entrypoint).toBe("cli_plan_run");
		expect(record.reason).toBe("allowed");

		const decisions = listAdmissionDecisions();
		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toEqual(record);
	});

	it("should record rejection with reason for unsatisfied promotion gate", () => {
		const record = guardExecutionEntrypoint("brain_worker_trigger", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: false,
		});
		expect(record.decision).toBe("reject");
		expect(record.reason).toBe("promotion_gate_unsatisfied");
	});

	it("should record rejection with reason for postgres unavailable", () => {
		const record = guardExecutionEntrypoint("dashboard_run", {
			postgresAvailable: false,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(record.decision).toBe("reject");
		expect(record.reason).toBe("postgres_unavailable");
	});

	it("should accumulate multiple admission decision records", () => {
		guardExecutionEntrypoint("cli_plan_run", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		guardExecutionEntrypoint("api_plan_run", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: true,
			autonomousMode: true,
			promotionGateSatisfied: true,
		});
		guardExecutionEntrypoint("retry_endpoint", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: false,
		});

		const decisions = listAdmissionDecisions();
		expect(decisions).toHaveLength(3);
		expect(decisions[0].decision).toBe("allow");
		expect(decisions[1].decision).toBe("allow");
		expect(decisions[2].decision).toBe("reject");
	});

	it("should clear decisions on reset", () => {
		guardExecutionEntrypoint("cli_plan_run", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(listAdmissionDecisions()).toHaveLength(1);
		resetAdmissionDecisions();
		expect(listAdmissionDecisions()).toHaveLength(0);
	});
});

// =============================================================================
// Gauntlet 3: ACCP gate verdict → transition decision
// =============================================================================

describe("P49.29 E2E: Gate Verdict → Transition Decision Gauntlet", () => {
	it("should allow transition when ACCP mode is warn (not required)", () => {
		const result = evaluateAccpGateForTransition(invalidVerdict(), false);
		expect(result.allowed).toBe(true);
		expect(result.blockingReasons).toHaveLength(0);
	});

	it("should block transition when ACCP mode is required and verdict is invalid", () => {
		const result = evaluateAccpGateForTransition(invalidVerdict(), true);
		expect(result.allowed).toBe(false);
		expect(result.blockingReasons.length).toBeGreaterThan(0);
	});

	it("should include fatal errors in blocking reasons when blocked", () => {
		const result = evaluateAccpGateForTransition(invalidVerdict(), true);
		expect(result.blockingReasons).toContain("ACCP_GATE_FATAL: compilation failure");
	});

	it("should include blocking findings in blocking reasons when blocked", () => {
		const result = evaluateAccpGateForTransition(invalidVerdict(), true);
		expect(result.blockingReasons.some((r) => r.includes("ACCP_GATE_BLOCKING_FINDING_OPEN"))).toBe(true);
	});

	it("should handle undefined verdict gracefully", () => {
		const result = evaluateAccpGateForTransition(undefined, true);
		expect(result.allowed).toBe(true);
		expect(result.verdict).toBeUndefined();
	});

	it("should allow transition when verdict is valid with no findings", () => {
		const result = evaluateAccpGateForTransition(validVerdict(), true);
		expect(result.allowed).toBe(true);
	});
});

// =============================================================================
// Gauntlet 4: Promotion evaluation across multiple gate verdicts
// =============================================================================

describe("P49.29 E2E: Promotion Evaluation Gauntlet", () => {
	it("should report ready with empty verdicts array", () => {
		const result = evaluateAccpPromotion([]);
		expect(result.ready).toBe(true);
		expect(result.blockingReasons).toHaveLength(0);
	});

	it("should report ready with a single valid verdict", () => {
		const result = evaluateAccpPromotion([validVerdict("PRR_001", "PRR")]);
		expect(result.ready).toBe(true);
	});

	it("should report not ready with a single invalid verdict", () => {
		const result = evaluateAccpPromotion([invalidVerdict("PRR_001", "PRR")]);
		expect(result.ready).toBe(false);
		expect(result.blockingReasons.length).toBeGreaterThan(0);
	});

	it("should report not ready when any verdict in a batch is invalid", () => {
		const verdicts = [
			validVerdict("PRR_001", "PRR"),
			validVerdict("TVR_001", "TVR"),
			invalidVerdict("TVR_002", "TVR"),
		];
		const result = evaluateAccpPromotion(verdicts);
		expect(result.ready).toBe(false);
	});

	it("should report ready when all verdicts are valid", () => {
		const verdicts = [validVerdict("PRR_001", "PRR"), validVerdict("TVR_001", "TVR"), validVerdict("TVR_002", "TVR")];
		const result = evaluateAccpPromotion(verdicts);
		expect(result.ready).toBe(true);
	});

	it("should include report ID context in blocking reasons", () => {
		const result = evaluateAccpPromotion([invalidVerdict("PRR_001", "PRR")]);
		expect(result.blockingReasons.some((r) => r.includes("PRR_001"))).toBe(true);
	});

	it("should report not ready for missing evidence verdicts", () => {
		const result = evaluateAccpPromotion([missingEvidenceVerdict("TVR_EVIDENCE_GAP")]);
		expect(result.ready).toBe(false);
	});
});

// =============================================================================
// Gauntlet 5: Full native flow — admission → gate → transition → promotion
// =============================================================================

describe("P49.29 E2E: Full Native Flow Gauntlet", () => {
	beforeEach(() => {
		resetAdmissionDecisions();
	});

	/**
	 * Full pipeline simulation:
	 * 1. Admission gate check
	 * 2. Gate verdict read
	 * 3. Transition decision
	 * 4. Promotion evaluation
	 */
	it("should pass full native flow with all gates satisfied", () => {
		// Step 1: Admission — promotion gate must be satisfied
		const admissionInput = {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		};
		const admissionDecision = admitExecution(admissionInput);
		expect(admissionDecision).toBe("allow");

		// Step 2: Gate verdict — compiled from ACCP report
		const verdict = validVerdict("P49_TVR_001", "TVR");

		// Step 3: Transition decision — ACCP mode is required
		const transitionResult = evaluateAccpGateForTransition(verdict, true);
		expect(transitionResult.allowed).toBe(true);

		// Step 4: Promotion evaluation — check readiness
		const promotionResult = evaluateAccpPromotion([verdict]);
		expect(promotionResult.ready).toBe(true);
	});

	it("should block at admission when promotion gate is unsatisfied", () => {
		const admissionDecision = admitExecution({
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: false,
		});
		expect(admissionDecision).toBe("reject");
	});

	it("should block at transition gate when verdict is invalid in required mode", () => {
		// Admission passes
		const admissionDecision = admitExecution({
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(admissionDecision).toBe("allow");

		// Transition gate blocks
		const verdict = invalidVerdict("P49_TVR_FAILED", "TVR");
		const transitionResult = evaluateAccpGateForTransition(verdict, true);
		expect(transitionResult.allowed).toBe(false);

		// Promotion fails
		const promotionResult = evaluateAccpPromotion([verdict]);
		expect(promotionResult.ready).toBe(false);
	});

	it("should pass transition gate in warn mode even with invalid verdict", () => {
		const admissionDecision = admitExecution({
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(admissionDecision).toBe("allow");

		// In warn mode, the transition is not blocked by gate verdict
		const verdict = invalidVerdict("P49_TVR_WARN", "TVR");
		const transitionResult = evaluateAccpGateForTransition(verdict, false);
		expect(transitionResult.allowed).toBe(true);
	});

	it("should handle multi-wave promotion with mixed verdicts", () => {
		// Simulate W1-W8 all passing except W5
		const waveVerdicts: AccpGateVerdict[] = [
			validVerdict("TVR_WAVE_W1", "TVR"),
			validVerdict("TVR_WAVE_W2", "TVR"),
			validVerdict("TVR_WAVE_W3", "TVR"),
			validVerdict("TVR_WAVE_W4", "TVR"),
			invalidVerdict("TVR_WAVE_W5", "TVR"),
			validVerdict("TVR_WAVE_W6", "TVR"),
			validVerdict("TVR_WAVE_W7", "TVR"),
			validVerdict("TVR_WAVE_W8", "TVR"),
		];

		// Overall promotion should be blocked by W5
		const promotionResult = evaluateAccpPromotion(waveVerdicts);
		expect(promotionResult.ready).toBe(false);
		expect(promotionResult.blockingReasons.some((r) => r.includes("TVR_WAVE_W5"))).toBe(true);

		// Each individual wave gate transition in required mode:
		// Waves 1-4 and 6-8 should pass
		for (const v of waveVerdicts) {
			const transitionResult = evaluateAccpGateForTransition(v, true);
			if (v.reportId === "TVR_WAVE_W5") {
				expect(transitionResult.allowed).toBe(false);
			} else {
				expect(transitionResult.allowed).toBe(true);
			}
		}
	});

	it("should record admission guard entrypoint throughout flow lifecycle", () => {
		// Initial admission
		guardExecutionEntrypoint("cli_plan_run", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});

		// Retry after repair
		guardExecutionEntrypoint("retry_endpoint", {
			postgresAvailable: true,
			production: false,
			jsonFallback: false,
			repairMode: true,
			autonomousMode: true,
			promotionGateSatisfied: true,
		});

		const decisions = listAdmissionDecisions();
		expect(decisions).toHaveLength(2);
		expect(decisions[0].entrypoint).toBe("cli_plan_run");
		expect(decisions[0].decision).toBe("allow");
		expect(decisions[1].entrypoint).toBe("retry_endpoint");
		expect(decisions[1].decision).toBe("allow");
	});
});
