/**
 * P49 E2E ACCP Native Flow Tests (P49.29)
 *
 * End-to-end gauntlets verifying the complete ACCP pipeline:
 * - Invalid YAML rejection
 * - Route signal without authority
 * - Repair loop that cannot invent evidence
 * - Promotion with open blockers
 */

import {
	checkRoutePolicy,
	compileAccpSource,
	compileGateVerdict,
	compileRouteSignal,
	evaluatePromotion,
	parseAccpYaml,
} from "@earendil-works/pi-accp-compiler";
import type { AccpCompileResult } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { runAccpRepairLoop } from "../../src/core/accp-repair-controller.js";

describe("P49 E2E Gauntlet: Invalid YAML", () => {
	it("should reject YAML that does not start with accp_version", () => {
		const result = compileAccpSource("foo: bar\nbaz: qux\n");
		expect(result.status).toBe("failed");
		expect(result.hasBlockingFindings).toBe(true);
	});

	it("should reject empty input", () => {
		const result = compileAccpSource("");
		expect(result.status).toBe("failed");
	});

	it("should reject whitespace-only input", () => {
		const result = compileAccpSource("   \n  \n");
		expect(result.status).toBe("failed");
	});

	it("should reject wrong source_format via parser", () => {
		const yaml =
			'accp_version: "2.0.0"\nsource_format: "MARKDOWN"\n\nreport:\n  id: "T001"\n  type: "TVR"\n  family: "core"';
		const { parsed } = parseAccpYaml(yaml);
		expect(parsed).toBeNull();
	});
});

describe("P49 E2E Gauntlet: Route Signal Without Authority", () => {
	it("should always produce advisory route signals", () => {
		const { signal } = compileRouteSignal("TEST_001", "TVR", []);
		expect(signal.isAdvisory).toBe(true);
	});

	it("should not allow route signal to auto-advance mutation routes without authority check", () => {
		const { signal } = compileRouteSignal("TEST_001", "PRR", []);
		const policy = checkRoutePolicy(signal);
		// PRR with no blocking findings leads to promotion which has no resolved target
		expect(policy.canAutoAdvance).toBe(false);
	});

	it("should require HIR for unresolved route targets", () => {
		const { signal } = compileRouteSignal("TEST_001", "FCR" as any, []);
		const policy = checkRoutePolicy(signal);
		expect(policy.hirRequired).toBe(true);
	});
});

describe("P49 E2E Gauntlet: Repair Loop Cannot Invent Evidence", () => {
	it("should not remove blocking findings during repair", () => {
		const result: AccpCompileResult = {
			status: "failed",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [{ code: "ACCP_PARSE_YAML_INVALID", message: "Original error", severity: "error", fatal: true }],
			hasBlockingFindings: true,
		};
		const repair = runAccpRepairLoop(result);
		// The original fatal error should still be present
		const stillHasOriginal = repair.diagnostics.some((d) => d.fatal && d.message === "Original error");
		expect(stillHasOriginal).toBe(true);
	});

	it("should not invent new evidence entries", () => {
		const result: AccpCompileResult = {
			status: "failed",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [{ code: "ACCP_PARSE_YAML_INVALID", message: "Parse error", severity: "error", fatal: true }],
			hasBlockingFindings: true,
		};
		const repair = runAccpRepairLoop(result);
		expect(repair.evidenceInventionDetected).toBe(false);
		expect(repair.blockingFindingsRemoved).toBe(false);
	});
});

describe("P49 E2E Gauntlet: Promotion With Open Blockers", () => {
	it("should not allow promotion when gate verdict has fatal errors", () => {
		const verdict = compileGateVerdict(
			"TEST_001",
			"PRR",
			[{ code: "ACCP_GATE_BLOCKING_FINDING_OPEN", message: "Blocker still open", severity: "error", fatal: true }],
			"complete",
		);
		const promotion = evaluatePromotion(verdict);
		expect(promotion.ready).toBe(false);
		expect(promotion.blockingReasons.length).toBeGreaterThan(0);
	});

	it("should not allow promotion when evidence is missing", () => {
		const verdict = compileGateVerdict("TEST_001", "PRR", [], "missing");
		const promotion = evaluatePromotion(verdict);
		expect(promotion.ready).toBe(false);
		expect(promotion.blockingReasons).toContain("Evidence is missing");
	});

	it("should allow promotion when gate passes with complete evidence", () => {
		const verdict = compileGateVerdict("TEST_001", "PRR", [], "complete");
		const promotion = evaluatePromotion(verdict);
		expect(promotion.ready).toBe(true);
	});
});
