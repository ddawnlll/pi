/**
 * ACCP Gate Reader and Transition Guard Tests (P49.19)
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { evaluateAccpGateForTransition } from "../src/accp-gate-reader.js";
import { evaluateAccpPromotion } from "../src/accp-promotion-evaluator.js";

describe("ACCP Gate Reader", () => {
	it("should allow transition when mode is not required", () => {
		const result = evaluateAccpGateForTransition(undefined, false);
		expect(result.allowed).toBe(true);
	});

	it("should allow transition when no verdict and mode is required", () => {
		const result = evaluateAccpGateForTransition(undefined, true);
		expect(result.allowed).toBe(true);
	});

	it("should block transition when verdict is invalid and mode is required", () => {
		const verdict: AccpGateVerdict = {
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
		const result = evaluateAccpGateForTransition(verdict, true);
		expect(result.allowed).toBe(false);
		expect(result.blockingReasons.length).toBeGreaterThan(0);
	});

	it("should allow transition when verdict is valid and mode is required", () => {
		const verdict: AccpGateVerdict = {
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
		const result = evaluateAccpGateForTransition(verdict, true);
		expect(result.allowed).toBe(true);
	});
});

describe("ACCP Promotion Evaluator (Runtime)", () => {
	it("should report ready with empty verdicts", () => {
		const result = evaluateAccpPromotion([]);
		expect(result.ready).toBe(true);
	});

	it("should report ready with all valid verdicts", () => {
		const verdict: AccpGateVerdict = {
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
		const result = evaluateAccpPromotion([verdict]);
		expect(result.ready).toBe(true);
	});

	it("should report blocking for invalid verdict", () => {
		const verdict: AccpGateVerdict = {
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
		const result = evaluateAccpPromotion([verdict]);
		expect(result.ready).toBe(false);
		expect(result.blockingReasons.length).toBeGreaterThan(0);
	});
});
