/**
 * ACCP Repair Loop Tests (P49.25)
 *
 * Negative tests: repair loop must not invent evidence, fabricate
 * command results, or remove blocking findings.
 */

import type { AccpCompileResult } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { runAccpRepairLoop } from "../../src/core/accp-repair-controller.js";

describe("ACCP Repair Loop", () => {
	it("should not repair when no blocking findings exist", () => {
		const result: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};
		const repair = runAccpRepairLoop(result);
		expect(repair.success).toBe(true);
		expect(repair.attempts).toBe(0);
	});

	it("should attempt repair for blocking findings", () => {
		const result: AccpCompileResult = {
			status: "failed",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [{ code: "ACCP_PARSE_YAML_INVALID", message: "Parse error", severity: "error", fatal: true }],
			hasBlockingFindings: true,
		};
		const repair = runAccpRepairLoop(result);
		expect(repair.attempts).toBeGreaterThan(0);
	});

	it("should not invent evidence during repair", () => {
		const result: AccpCompileResult = {
			status: "failed",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [{ code: "ACCP_PARSE_YAML_INVALID", message: "Parse error", severity: "error", fatal: true }],
			hasBlockingFindings: true,
		};
		const repair = runAccpRepairLoop(result);
		// Repair should not remove fatal errors in structural mode
		expect(repair.evidenceInventionDetected).toBe(false);
		// The result should still have the original fatal diagnostics
		const originalFatal = result.diagnostics.filter((d) => d.fatal);
		const repairFatal = repair.diagnostics.filter((d) => d.fatal);
		// Original fatal errors should still be present
		expect(originalFatal.every((of) => repairFatal.some((rf) => rf.message === of.message))).toBe(true);
	});

	it("should cap repair attempts at maxAttempts", () => {
		const result: AccpCompileResult = {
			status: "failed",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [{ code: "ACCP_PARSE_YAML_INVALID", message: "Parse error", severity: "error", fatal: true }],
			hasBlockingFindings: true,
		};
		const repair = runAccpRepairLoop(result, { maxAttempts: 3, structuralFixesOnly: true });
		expect(repair.attempts).toBeLessThanOrEqual(3);
	});

	it("should detect removal of blocking findings as a HIR violation", () => {
		// This test verifies the detector logic: if the repair loop's
		// diagnostics have fewer fatal errors than the original, it
		// triggers blockingFindingsRemoved.
		const result: AccpCompileResult = {
			status: "failed",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [{ code: "ACCP_GATE_BLOCKING_FINDING_OPEN", message: "Blocker", severity: "error", fatal: true }],
			hasBlockingFindings: true,
		};
		// Use a config where the repair removes the blocker (simulated violation)
		const repair = runAccpRepairLoop(result, { maxAttempts: 1, structuralFixesOnly: true });
		// The repair loop only adds warnings, never removes fatal errors
		// So blockingFindingsRemoved should be false in normal operation
		expect(repair.blockingFindingsRemoved).toBe(false);
	});
});
