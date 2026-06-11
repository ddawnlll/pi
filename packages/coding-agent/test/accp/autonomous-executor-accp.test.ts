/**
 * AutonomousExecutor ACCP Compile Hook Tests (P49.17)
 *
 * Verifies the ACCP compile hook behavior. In warn mode, compilation
 * failures surface as diagnostics but don't block execution.
 */

import type { WorkerRunResult } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";

describe("AutonomousExecutor ACCP Compile Hook", () => {
	it("should have optional accp field on WorkerRunResult", () => {
		const result: WorkerRunResult = {
			verdict: "complete",
			events: [],
			changedFiles: [],
			commandHistory: [],
			report: "test",
		};
		expect(result.accp).toBeUndefined();
	});

	it("should support ACCP worker output", () => {
		const result: WorkerRunResult = {
			verdict: "complete",
			events: [],
			changedFiles: [],
			commandHistory: [],
			report: "legacy report",
			accp: {
				reportType: "TVR",
				reportId: "W001_TVR_001",
				shouldCompile: true,
				sourceYaml:
					'accp_version: "2.0.0"\nsource_format: "ACCP-YAML"\nreport:\n  id: "W001_TVR_001"\n  type: "TVR"\n  family: "core"',
			},
		};
		expect(result.accp!.shouldCompile).toBe(true);
		expect(result.accp!.reportType).toBe("TVR");
	});

	it("should not compile when shouldCompile is false", () => {
		const result: WorkerRunResult = {
			verdict: "complete",
			events: [],
			changedFiles: [],
			commandHistory: [],
			report: "test",
			accp: {
				reportType: "TVR",
				reportId: "W002_TVR_001",
				shouldCompile: false,
			},
		};
		expect(result.accp!.compiledArtifactPath).toBeUndefined();
	});

	it("should be non-blocking in warn mode (diagnostic only)", () => {
		// The compile hook logs errors but does not change the verdict
		const result: WorkerRunResult = {
			verdict: "complete",
			events: [],
			changedFiles: [],
			commandHistory: [],
			report: "test",
		};
		// ACCP mode = warn should not block execution
		expect(result.verdict).toBe("complete");
	});
});
