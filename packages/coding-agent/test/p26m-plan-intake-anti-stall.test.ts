/**
 * P26.M — Plan-intake anti-stall analysis and optimizer hardening
 *
 * Tests:
 * - Doctor distinguishes DAG effective parallelism from safe effective parallelism
 * - Plan-intake flags fully serialized graphs, long serialized tails, broad conflict scopes
 * - Anti-stall diagnostics detection
 * - Optimizer proposals remain advisory
 */

import { describe, expect, it } from "vitest";
import type { AntiStallDiagnostics, ParallelismDiagnostics } from "../src/core/safety-doctor.js";
import { createSafetyDoctor, SafetyIssueSeverity, SafetyIssueType } from "../src/core/safety-doctor.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.M — Plan-intake anti-stall analysis", () => {
	// ---- ParallelismDiagnostics ----

	it("should have safeEffectiveParallelism in ParallelismDiagnostics", () => {
		const diag: ParallelismDiagnostics = {
			effectiveParallelism: 3,
			criticalPathLength: 5,
			serializedTailLength: 2,
			requestedParallelism: 6,
			parallelismDelta: -3,
			safeEffectiveParallelism: 2,
		};
		expect(diag.safeEffectiveParallelism).toBe(2);
	});

	// ---- AntiStallDiagnostics ----

	it("should flag fully serialized graphs as warning", () => {
		const doctor = createSafetyDoctor();
		const diagnostics: AntiStallDiagnostics = {
			fullySerialized: true,
			serializedTailLength: 8,
			serializedTailExceedsThreshold: false,
			serializedTailThreshold: 5,
			broadConflictScopeCount: 0,
			validationBottleneckExpected: false,
			recommendations: [],
		};

		const issues = doctor.detectAntiStallIssues(diagnostics);
		expect(issues.length).toBeGreaterThanOrEqual(1);

		const fullySerializedIssue = issues.find((i) => i.type === SafetyIssueType.FullySerializedDag);
		expect(fullySerializedIssue).toBeDefined();
		expect(fullySerializedIssue!.severity).toBe(SafetyIssueSeverity.Warning);
		expect(fullySerializedIssue!.message).toContain("fully_serialized_dag");
	});

	it("should flag long serialized tails as warning", () => {
		const doctor = createSafetyDoctor();
		const diagnostics: AntiStallDiagnostics = {
			fullySerialized: false,
			serializedTailLength: 6,
			serializedTailExceedsThreshold: true,
			serializedTailThreshold: 5,
			broadConflictScopeCount: 0,
			validationBottleneckExpected: false,
			recommendations: [],
		};

		const issues = doctor.detectAntiStallIssues(diagnostics);
		const tailIssue = issues.find((i) => i.type === SafetyIssueType.LongSerializedTail);
		expect(tailIssue).toBeDefined();
		expect(tailIssue!.severity).toBe(SafetyIssueSeverity.Warning);
		expect(tailIssue!.message).toContain("long_serialized_tail");
	});

	it("should flag broad conflict scopes as info", () => {
		const doctor = createSafetyDoctor();
		const diagnostics: AntiStallDiagnostics = {
			fullySerialized: false,
			serializedTailLength: 1,
			serializedTailExceedsThreshold: false,
			serializedTailThreshold: 5,
			broadConflictScopeCount: 3,
			validationBottleneckExpected: false,
			recommendations: [],
		};

		const issues = doctor.detectAntiStallIssues(diagnostics);
		const scopeIssue = issues.find((i) => i.type === SafetyIssueType.BroadConflictScope);
		expect(scopeIssue).toBeDefined();
		expect(scopeIssue!.severity).toBe(SafetyIssueSeverity.Info);
		expect(scopeIssue!.message).toContain("broad conflict scopes");
	});

	it("should flag validation lane bottlenecks as info", () => {
		const doctor = createSafetyDoctor();
		const diagnostics: AntiStallDiagnostics = {
			fullySerialized: false,
			serializedTailLength: 0,
			serializedTailExceedsThreshold: false,
			serializedTailThreshold: 5,
			broadConflictScopeCount: 0,
			validationBottleneckExpected: true,
			recommendations: [],
		};

		const issues = doctor.detectAntiStallIssues(diagnostics);
		const bottleneckIssue = issues.find((i) => i.type === SafetyIssueType.ValidationLaneSaturated);
		expect(bottleneckIssue).toBeDefined();
		expect(bottleneckIssue!.message).toContain("validation_lane_bottleneck_expected");
	});

	it("should include recommendations when present", () => {
		const doctor = createSafetyDoctor();
		const diagnostics: AntiStallDiagnostics = {
			fullySerialized: false,
			serializedTailLength: 0,
			serializedTailExceedsThreshold: false,
			serializedTailThreshold: 5,
			broadConflictScopeCount: 0,
			validationBottleneckExpected: false,
			recommendations: [
				"Consider splitting workspace 4.A into parallel sub-workspaces",
				"Reduce conflict scope for workspace 2.B",
			],
		};

		const issues = doctor.detectAntiStallIssues(diagnostics);
		const recIssue = issues.find((i) => i.type === SafetyIssueType.Placeholder);
		expect(recIssue).toBeDefined();
		expect(recIssue!.message).toContain("Plan optimization recommendations");
		expect(recIssue!.message).toContain("splitting workspace 4.A");
	});

	it("should not flag issues when no anti-stall conditions exist", () => {
		const doctor = createSafetyDoctor();
		const diagnostics: AntiStallDiagnostics = {
			fullySerialized: false,
			serializedTailLength: 1,
			serializedTailExceedsThreshold: false,
			serializedTailThreshold: 5,
			broadConflictScopeCount: 0,
			validationBottleneckExpected: false,
			recommendations: [],
		};

		const issues = doctor.detectAntiStallIssues(diagnostics);
		expect(issues.length).toBe(0);
	});

	// ---- Structural verification ----

	it("should have FullySerializedDag in SafetyIssueType", () => {
		expect(SafetyIssueType.FullySerializedDag).toBe("fully_serialized_dag");
	});

	it("should have LongSerializedTail in SafetyIssueType", () => {
		expect(SafetyIssueType.LongSerializedTail).toBe("long_serialized_tail");
	});

	it("should have BroadConflictScope in SafetyIssueType", () => {
		expect(SafetyIssueType.BroadConflictScope).toBe("broad_conflict_scope");
	});

	it("should export AntiStallDiagnostics interface", () => {
		// Type-only verification — ensure the interface is exported
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/core/safety-doctor.ts"), "utf-8");
		expect(src).toContain("export interface AntiStallDiagnostics");
	});
});
