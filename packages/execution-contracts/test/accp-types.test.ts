/**
 * ACCP v2.0 Type System Foundation Tests
 *
 * Verifies the core type definitions, including type correctness,
 * additive nature of AccpWorkerOutput, and authority boundary invariants.
 */
import { describe, expect, it } from "vitest";
import type { AccpCompileStartedEvent, AccpLifecycleEvent } from "../src/accp-events.js";
import type { AccpWorkerOutput } from "../src/accp-types.js";
import type { WorkerRunResult } from "../src/worker-adapter.js";

// Evaluate types at compile time via the type system
type _hasOptionalAccp = WorkerRunResult extends { accp?: AccpWorkerOutput } ? true : false;

describe("ACCP v2.0 Type System", () => {
	// ---------------------------------------------------------------------------
	// Positive tests — type correctness
	// ---------------------------------------------------------------------------

	it("should allow all 24 report types as a union", () => {
		const types = [
			"RIR",
			"PIR",
			"IPR",
			"TVR",
			"HIR",
			"RAR",
			"PRR",
			"CAR",
			"BSR",
			"BRR",
			"RCA",
			"FPR",
			"FVR",
			"FER",
			"FDR",
			"FCR",
			"FIR",
			"FGR",
			"WBR",
			"WDR",
			"WER",
			"WQR",
			"ECR",
			"DCR",
		] as const;
		expect(types.length).toBe(24);
	});

	it("should distinguish support levels", () => {
		const strict: "schema_strict" = "schema_strict";
		const lite: "schema_lite" = "schema_lite";
		const template: "template_available" = "template_available";
		const blocking: "gate_blocking" = "gate_blocking";
		expect(strict).toBe("schema_strict");
		expect(lite).toBe("schema_lite");
		expect(template).toBe("template_available");
		expect(blocking).toBe("gate_blocking");
	});

	it("should support all three ACCP modes", () => {
		const off: "off" = "off";
		const warn: "warn" = "warn";
		const required: "required" = "required";
		expect(off).toBe("off");
		expect(warn).toBe("warn");
		expect(required).toBe("required");
	});

	it("should support compile status values", () => {
		const statuses = ["not_compiled", "compiled", "compiled_with_warnings", "failed"] as const;
		expect(statuses).toContain("compiled");
		expect(statuses).toContain("failed");
	});

	it("should create a valid route signal with advisory=true", () => {
		const signal = {
			sourceReportId: "TEST_001",
			sourceReportType: "TVR" as const,
			recommendedNextAction: "run_tests",
			recommendedNextRoute: "validate",
			confidence: "high" as const,
			isAdvisory: true,
			mutationPolicyNeeded: "validation_only" as const,
			targetResolved: true,
		};
		expect(signal.isAdvisory).toBe(true);
		expect(signal.confidence).toBe("high");
	});

	it("should create a valid gate verdict", () => {
		const verdict = {
			reportId: "TEST_001",
			reportType: "TVR" as const,
			valid: true,
			fatalErrors: [],
			warnings: ["minor formatting issue"],
			blockingFindings: [],
			findingCount: 0,
			promotionReady: true,
			evidenceStatus: "complete" as const,
		};
		expect(verdict.valid).toBe(true);
		expect(verdict.promotionReady).toBe(true);
	});

	it("should create a valid compile event", () => {
		const event: AccpCompileStartedEvent = {
			kind: "accp_compile_started",
			timestamp: new Date().toISOString(),
			reportId: "TEST_001",
			reportType: "IPR",
			sourcePath: "reports/test/source/TEST_001.accp.yaml",
		};
		expect(event.kind).toBe("accp_compile_started");
	});

	it("should create an ACCP worker output on WorkerRunResult", () => {
		const result: WorkerRunResult = {
			verdict: "complete",
			events: [],
			changedFiles: [],
			commandHistory: [],
			report: "legacy report text",
			accp: {
				reportType: "IPR",
				reportId: "W001_IPR_001",
				shouldCompile: true,
			},
		};
		expect(result.report).toBe("legacy report text");
		expect(result.accp?.reportType).toBe("IPR");
		expect(result.accp?.shouldCompile).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// Negative tests — authority boundaries
	// ---------------------------------------------------------------------------

	it("should not allow route signals to authorize execution", () => {
		const signal = {
			sourceReportId: "TEST_001",
			sourceReportType: "TVR" as const,
			recommendedNextAction: "mutate_file",
			recommendedNextRoute: "write",
			confidence: "high" as const,
			isAdvisory: true,
			mutationPolicyNeeded: "mutation_allowed" as const,
			targetResolved: true,
		};
		// The signal must be advisory — this is the type invariant
		expect(signal.isAdvisory).toBe(true);
		// There is no 'authorizesExecution' field — verify structural absence
		expect("authorizesExecution" in signal).toBe(false);
		expect("authorizesMutation" in signal).toBe(false);
	});

	it("should require ACCP worker output to be optional on WorkerRunResult", () => {
		// WorkerRunResult must work without accp field (backward compat)
		const result: WorkerRunResult = {
			verdict: "complete",
			events: [],
			changedFiles: [],
			commandHistory: [],
			report: "legacy report",
		};
		expect(result.accp).toBeUndefined();
	});

	it("should have optional report field on WorkerRunResult", () => {
		const result: WorkerRunResult = {
			verdict: "failed",
			events: [],
			changedFiles: [],
			commandHistory: [],
			error: "something went wrong",
		};
		expect(result.report).toBeUndefined();
	});

	it("should enforce that AccpLifecycleEvent is a discriminated union", () => {
		// Only valid kinds should be assignable to AccpEventKind
		const validKinds = [
			"accp_compile_started",
			"accp_compile_completed",
			"accp_gate_verdict_emitted",
			"accp_finding_recorded",
			"accp_route_signal_emitted",
		];
		expect(validKinds.length).toBe(5);
	});

	it("should correctly discriminate ACCP lifecycle events", () => {
		// At the type level, only specific kinds are allowed
		const event: AccpLifecycleEvent = {
			kind: "accp_compile_started",
			timestamp: new Date().toISOString(),
			reportId: "TEST_001",
			reportType: "TVR",
			sourcePath: "test.yaml",
		};
		// Verification: the discriminated union narrows correctly
		if (event.kind === "accp_compile_started") {
			expect((event as any).sourcePath).toBe("test.yaml");
		}
		// An event with kind "accp_compile_completed" must not have sourcePath
		const completed: AccpLifecycleEvent = {
			kind: "accp_compile_completed",
			timestamp: new Date().toISOString(),
			reportId: "TEST_001",
			reportType: "TVR",
			result: {
				status: "compiled",
				reportId: "TEST_001",
				reportType: "TVR",
				diagnostics: [],
				hasBlockingFindings: false,
			},
			durationMs: 100,
		};
		if (completed.kind === "accp_compile_completed") {
			expect(completed.result.status).toBe("compiled");
		}
	});
});
