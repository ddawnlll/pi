/**
 * P26.A — Repair-mode lockdown and promotion guard
 *
 * Tests:
 * - SafetyDoctor detects autonomous execution during repair mode
 * - SafetyDoctor detects promotion gate failures
 * - Worker concurrency validation checks promotion gates
 * - Plan commands block repair-mode autonomous execution
 */

import { describe, expect, it } from "vitest";
import { SafetyDoctor, SafetyIssueSeverity, SafetyIssueType } from "../src/core/safety-doctor.js";
import { checkPromotionGates, PROMOTION_GATES, validateWorkerConcurrency } from "../src/core/worker-concurrency.js";
import type { ExecutionAutomation, PromotionGates, RepairMode, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalQueue(
	overrides?: Partial<WorkspaceQueue>,
	executionAutomation?: ExecutionAutomation,
	repairMode?: RepairMode,
	promotionGates?: PromotionGates,
): WorkspaceQueue {
	return {
		phase: "P26",
		title: "Test Plan",
		maxParallelWorkspaces: 1,
		workspaces: [
			{
				id: "P26.A",
				title: "Test workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 0,
			},
		],
		executionAutomation,
		repairMode,
		promotionGates,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// SafetyDoctor — repair mode detection
// ---------------------------------------------------------------------------

describe("SafetyDoctor — repair mode detection", () => {
	it("should detect autonomousExecutionEnabled=false as critical", () => {
		const doctor = new SafetyDoctor(1);
		const queue = makeMinimalQueue(
			{},
			{
				autonomousExecutionEnabled: false,
				agentMayMutateRepo: false,
				agentMayRunCommands: false,
				manualPatchApplicationRequired: true,
				humanApprovalRequiredForEveryPatch: true,
			},
		);

		const report = doctor.validateQueue(queue);

		expect(report.safe).toBe(false);
		const repairIssues = report.critical.filter((i) => i.type === SafetyIssueType.AutonomousExecutionDuringRepair);
		expect(repairIssues.length).toBe(1);
		expect(repairIssues[0].severity).toBe(SafetyIssueSeverity.Critical);
		expect(repairIssues[0].message).toContain("autonomous_execution_requested_during_repair_mode");
	});

	it("should not block normal plans without executionAutomation", () => {
		const doctor = new SafetyDoctor(1);
		const queue = makeMinimalQueue();

		const report = doctor.validateQueue(queue);

		expect(report.safe).toBe(true);
		const repairIssues = report.critical.filter((i) => i.type === SafetyIssueType.AutonomousExecutionDuringRepair);
		expect(repairIssues.length).toBe(0);
	});

	it("should not block plans with autonomousExecutionEnabled=true", () => {
		const doctor = new SafetyDoctor(1);
		const queue = makeMinimalQueue(
			{},
			{
				autonomousExecutionEnabled: true,
			},
		);

		const report = doctor.validateQueue(queue);

		expect(report.safe).toBe(true);
	});

	it("should detect promotion_gate_failed_or_missing when gates are pending", () => {
		const doctor = new SafetyDoctor(6);
		const queue = makeMinimalQueue({}, undefined, undefined, {
			initialMode: "manual_1",
			targetMode: "stable_6",
			gates: [
				{ id: "executor_isolation_passed", requiredFor: ["stable_1", "stable_3", "stable_6"], status: "pending" },
				{ id: "abort_signal_chain_passed", requiredFor: ["stable_1", "stable_3", "stable_6"], status: "pending" },
			],
		});

		const report = doctor.validateQueue(queue);

		expect(report.safe).toBe(false);
		const gateIssues = report.critical.filter((i) => i.type === SafetyIssueType.PromotionGateFailedOrMissing);
		expect(gateIssues.length).toBeGreaterThanOrEqual(1);
		expect(gateIssues[0].message).toContain("promotion_gate_failed_or_missing");
	});

	it("should detect stable_6 blocked when promotion gates pending", () => {
		const doctor = new SafetyDoctor(6);
		const queue = makeMinimalQueue({ maxParallelWorkspaces: 6 }, undefined, undefined, {
			initialMode: "manual_1",
			targetMode: "stable_6",
			gates: [
				{ id: "executor_isolation_passed", requiredFor: ["stable_1", "stable_3", "stable_6"], status: "pending" },
				{ id: "stable_6_stress_passed", requiredFor: ["stable_6"], status: "pending" },
			],
		});

		const report = doctor.validateQueue(queue);

		const blockedIssues = report.critical.filter((i) => i.type === SafetyIssueType.ScaleModeBlockedByPromotionGates);
		expect(blockedIssues.length).toBeGreaterThanOrEqual(1);
		expect(blockedIssues[0].message).toContain("stable_6");
	});

	it("should allow stable_1 when all required gates passed", () => {
		const doctor = new SafetyDoctor(1);
		const queue = makeMinimalQueue({ maxParallelWorkspaces: 1 }, undefined, undefined, {
			initialMode: "manual_1",
			targetMode: "stable_6",
			gates: [
				{ id: "executor_isolation_passed", requiredFor: ["stable_1", "stable_3", "stable_6"], status: "passed" },
				{ id: "abort_signal_chain_passed", requiredFor: ["stable_1", "stable_3", "stable_6"], status: "passed" },
				{ id: "stable_6_stress_passed", requiredFor: ["stable_6"], status: "pending" },
			],
		});

		const report = doctor.validateQueue(queue);

		// stable_1 is fine (1 worker, gates passed) — only stable_6 gates are pending
		const criticalGateIssues = report.critical.filter(
			(i) =>
				i.type === SafetyIssueType.PromotionGateFailedOrMissing ||
				i.type === SafetyIssueType.ScaleModeBlockedByPromotionGates,
		);
		// With 1 worker, stable_6 is not required
		expect(criticalGateIssues.length).toBe(0);
	});

	it("should include repair mode issues in validateQueueWithParallelism", () => {
		const doctor = new SafetyDoctor(1);
		const queue = makeMinimalQueue(
			{},
			{
				autonomousExecutionEnabled: false,
			},
		);

		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.safe).toBe(false);
		const repairIssues = report.critical.filter((i) => i.type === SafetyIssueType.AutonomousExecutionDuringRepair);
		expect(repairIssues.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// checkPromotionGates
// ---------------------------------------------------------------------------

describe("checkPromotionGates", () => {
	const gates = [
		{ id: "executor_isolation_passed", status: "passed" as const, requiredFor: ["stable_1"] },
		{ id: "abort_signal_chain_passed", status: "passed" as const, requiredFor: ["stable_1"] },
		{ id: "validation_hang_kill_passed", status: "pending" as const, requiredFor: ["stable_3"] },
	];

	it("should pass when all required gates are passed", () => {
		const result = checkPromotionGates(gates, ["executor_isolation_passed", "abort_signal_chain_passed"]);
		expect(result.passed).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(result.pending).toEqual([]);
	});

	it("should fail when a required gate is pending", () => {
		const result = checkPromotionGates(gates, ["executor_isolation_passed", "validation_hang_kill_passed"]);
		expect(result.passed).toBe(false);
		expect(result.pending).toContain("validation_hang_kill_passed");
	});

	it("should fail when a required gate is missing", () => {
		const result = checkPromotionGates(gates, ["executor_isolation_passed", "nonexistent_gate"]);
		expect(result.passed).toBe(false);
		expect(result.missing).toContain("nonexistent_gate");
	});

	it("should fail when a required gate has failed status", () => {
		const gatesWithFailed = [
			...gates,
			{ id: "crash_recovery_passed", status: "failed" as const, requiredFor: ["stable_3"] },
		];
		const result = checkPromotionGates(gatesWithFailed, ["executor_isolation_passed", "crash_recovery_passed"]);
		expect(result.passed).toBe(false);
		expect(result.failed).toContain("crash_recovery_passed");
	});

	it("should check against PROMOTION_GATES.STABLE_6 correctly", () => {
		const allPassed = PROMOTION_GATES.STABLE_6.map((id) => ({
			id,
			status: "passed" as const,
		}));
		const result = checkPromotionGates(allPassed, PROMOTION_GATES.STABLE_6);
		expect(result.passed).toBe(true);
	});

	it("should detect missing stable_6 gates", () => {
		const onlyPartial = PROMOTION_GATES.STABLE_6.slice(0, 3).map((id) => ({
			id,
			status: "passed" as const,
		}));
		const result = checkPromotionGates(onlyPartial, PROMOTION_GATES.STABLE_6);
		expect(result.passed).toBe(false);
		expect(result.missing.length).toBe(PROMOTION_GATES.STABLE_6.length - 3);
	});
});

// ---------------------------------------------------------------------------
// validateWorkerConcurrency — backward compat
// ---------------------------------------------------------------------------

describe("validateWorkerConcurrency — backward compat", () => {
	it("should still validate stable worker counts", () => {
		const result = validateWorkerConcurrency({ maxWorkers: 3 });
		expect(result.valid).toBe(true);
		expect(result.effectiveWorkers).toBe(3);
	});

	it("should still reject experimental without flag", () => {
		const result = validateWorkerConcurrency({ maxWorkers: 4 });
		expect(result.valid).toBe(false);
		expect(result.isExperimental).toBe(false);
		expect(result.effectiveWorkers).toBe(3);
	});

	it("should still accept experimental with flag and prereqs", () => {
		const result = validateWorkerConcurrency(
			{ maxWorkers: 4, experimentalModeEnabled: true },
			{ archiveEnabled: true, stopOnFailureEnabled: true },
		);
		expect(result.valid).toBe(true);
		expect(result.isExperimental).toBe(true);
		expect(result.effectiveWorkers).toBe(4);
	});
});
