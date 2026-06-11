/**
 * CompletionGateV2 ACCP Verdict Integration Tests (P49.18)
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { runAccpGateStage } from "../../src/core/accp-gate-stage-runner.js";

describe("ACCP Gate Stage Runner", () => {
	it("should pass when mode is not required (advisory only)", () => {
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: false });
		expect(verdict.passed).toBe(true);
		expect(verdict.detail).toHaveProperty("note", "ACCP mode is not required — gate is advisory");
	});

	it("should pass with warning when no verdict provided", () => {
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: true });
		expect(verdict.passed).toBe(true);
		expect(verdict.warning).toBe(true);
	});

	it("should block when verdict is invalid and mode is required", () => {
		const gateVerdict: AccpGateVerdict = {
			reportId: "TEST_001",
			reportType: "TVR",
			valid: false,
			fatalErrors: ["Fatal parse error"],
			warnings: [],
			blockingFindings: ["Parse error"],
			findingCount: 1,
			promotionReady: false,
			evidenceStatus: "complete",
		};
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: true, verdict: gateVerdict });
		expect(verdict.passed).toBe(false);
		expect(verdict.blockReasons.length).toBeGreaterThan(0);
	});

	it("should pass with warnings when verdict has warnings but mode is required", () => {
		const gateVerdict: AccpGateVerdict = {
			reportId: "TEST_001",
			reportType: "TVR",
			valid: true,
			fatalErrors: [],
			warnings: ["Minor formatting issue"],
			blockingFindings: [],
			findingCount: 1,
			promotionReady: true,
			evidenceStatus: "complete",
		};
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: true, verdict: gateVerdict });
		expect(verdict.passed).toBe(true);
		expect(verdict.warning).toBe(true);
	});

	it("should clean pass with clean verdict", () => {
		const gateVerdict: AccpGateVerdict = {
			reportId: "TEST_001",
			reportType: "TVR",
			valid: true,
			fatalErrors: [],
			warnings: [],
			blockingFindings: [],
			findingCount: 0,
			promotionReady: true,
			evidenceStatus: "complete",
		};
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: true, verdict: gateVerdict });
		expect(verdict.passed).toBe(true);
		expect(verdict.warning).toBe(false);
	});

	// ---------------------------------------------------------------------------
	// Mode ordering tests: mode check MUST precede verdict evaluation
	// ---------------------------------------------------------------------------

	it("should NOT block when mode=off even with BLOCK verdict (mode-first ordering)", () => {
		const blockingVerdict: AccpGateVerdict = {
			reportId: "TEST_001",
			reportType: "TVR",
			valid: false,
			fatalErrors: ["Fatal error"],
			warnings: [],
			blockingFindings: ["Blocker"],
			findingCount: 1,
			promotionReady: false,
			evidenceStatus: "complete",
		};
		// modeRequired=false means mode=off or mode=warn — gate must NOT block
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: false, verdict: blockingVerdict });
		expect(verdict.passed).toBe(true);
		expect(verdict.detail).toHaveProperty("note", "ACCP mode is not required — gate is advisory");
	});

	it("should pass in warn mode even with BLOCK verdict (non-blocking)", () => {
		const blockingVerdict: AccpGateVerdict = {
			reportId: "TEST_001",
			reportType: "TVR",
			valid: false,
			fatalErrors: ["Fatal error"],
			warnings: [],
			blockingFindings: ["Blocker"],
			findingCount: 1,
			promotionReady: false,
			evidenceStatus: "complete",
		};
		// modeRequired=false simulates warn mode
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: false, verdict: blockingVerdict });
		expect(verdict.passed).toBe(true);
	});

	it("should block in required mode with BLOCK verdict", () => {
		const blockingVerdict: AccpGateVerdict = {
			reportId: "TEST_001",
			reportType: "TVR",
			valid: false,
			fatalErrors: ["Fatal error"],
			warnings: [],
			blockingFindings: ["Blocker"],
			findingCount: 1,
			promotionReady: false,
			evidenceStatus: "complete",
		};
		const verdict = runAccpGateStage("AccpGate", null, { modeRequired: true, verdict: blockingVerdict });
		expect(verdict.passed).toBe(false);
	});
});
