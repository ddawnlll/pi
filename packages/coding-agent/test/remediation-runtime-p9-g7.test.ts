/**
 * P9.G7 Governance Ledger Integration & Audit Trail Wiring
 *
 * Acceptance Criteria:
 * 1. All G1-G6 components are wired into a single coherent audit trail.
 * 2. Completion gate requires complete ledger entry before marking plan done.
 * 3. End-to-end audit flow is validated with integration tests.
 *
 * The governance ledger collects events from:
 *   G1 — Remediation Runtime (state transitions, journal)
 *   G2 — Proposal/Execution DB (proposal submissions, execution records)
 *   G3 — Approval & Budget Recording (approvals, change requests, self-mod)
 *   G4 — Dry-Run & Validation Recording (assumptions, outcomes, failures)
 *   G5 — Budget Enforcer & Policy Engine (budget snapshots, policy checks)
 *   G6 — Safety Doctor / Simulation / Queue (safety reports, forecasts, audits)
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	createGovernanceLedger,
	type GovernanceLedger,
	LEDGER_SOURCE_LABELS,
	type LedgerSource,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// G7 Types — Governance Ledger Integration
// ---------------------------------------------------------------------------

/**
 * An audit trail summary that demonstrates all G1-G6 component events
 * are wired into the governance ledger.
 */
interface AuditTrailSummary {
	/** Total entries across all sources */
	totalEntries: number;
	/** Entry count per source component */
	byComponent: Partial<Record<LedgerSource, number>>;
	/** Entry count by category */
	byCategory: Record<string, number>;
	/** Whether the completion gate was passed */
	completionGatePassed: boolean;
	/** Block reasons if gate not passed */
	blockReasons: string[];
}

/**
 * Simulate a complete G1-G7 lifecycle on the governance ledger.
 * Returns the ledger and a summary of what was recorded.
 */
function simulateFullLifecycle(ledger: GovernanceLedger): AuditTrailSummary {
	// G1 — Remediation Runtime: State transitions
	ledger.recordStateTransition("idle", "scanning", "Initiated repository scan");
	ledger.recordStateTransition("scanning", "scan_complete", "Scan completed with 3 proposals");
	ledger.recordStateTransition("scan_complete", "planning_approval_pending", "Awaiting planning approval");

	// G2 — Proposal/Execution DB: Proposal submission and execution tracking
	ledger.recordProposal("submitted", "prop-001", "Proposal submitted for code formatting fix");
	ledger.recordProposal("submitted", "prop-002", "Proposal submitted for dependency update");
	ledger.recordExecutionRecord("started", "exec-001", "Execution started for proposal prop-001");
	ledger.recordExecutionRecord("completed", "exec-001", "Execution completed for proposal prop-001");

	// G3 — Approval & Budget Recording: Approvals, change requests, self-modification
	ledger.recordApproval("planning", "approved", "Planning approved for proposal set", {
		reviewer: "test-reviewer",
		proposalId: "prop-001",
	});
	ledger.recordApproval("execution", "approved", "Execution approved after successful dry-run", {
		reviewer: "test-reviewer",
		proposalId: "prop-001",
	});
	ledger.recordChangeRequest("submitted", "cr-001", "Change request for additional scope");
	ledger.recordChangeRequest("approved", "cr-001", "Change request approved");
	ledger.recordSelfModification(
		true,
		["packages/coding-agent/src/core"],
		"Self-modification approved for audit wiring",
	);

	// G4 — Dry-Run & Validation Recording: Assumptions, outcomes, failures
	ledger.recordDryRun("started", "Dry-run simulation started for 3 proposals", {
		totalProposals: 3,
	});
	ledger.recordDryRun("completed", "Dry-run simulation completed successfully", {
		totalProposals: 3,
		mutationsPredicted: 2,
	});
	ledger.recordValidation("passed", "targeted-validation", "Targeted validation passed");
	ledger.recordValidation("passed", "integration-validation", "Integration validation passed");

	// G5 — Budget Enforcer & Policy Engine: Policy checks, budget snapshots
	ledger.recordBudgetSnapshot(
		{ maxInputTokens: 12000, estimatedInputTokens: 4500, maxFiles: 10 },
		"Budget snapshot captured at planning approval",
	);
	ledger.recordPolicyCheck("max-files", true, true, "Max files check passed");
	ledger.recordPolicyCheck("allowed-paths", true, true, "Allowed paths check passed");
	ledger.recordAutonomyClassification("supervised", "low", "Proposal classified as supervised with low risk");

	// G6 — Safety Doctor / Simulation / Queue: Safety, forecasts, queue audits
	ledger.recordSafetyReport(0, 0, "Safety check passed with no issues");
	ledger.recordSimulationForecast(3, 0.85, "Simulation forecast: 3 batches, 85% utilization");
	ledger.recordQueueAudit("pause", undefined, "Queue paused for review");
	ledger.recordQueueAudit("resume", "ws-001", "Queue resumed for workspace ws-001");

	// Build summary
	const byComponent: Partial<Record<LedgerSource, number>> = {};
	const byCategory: Record<string, number> = {};

	for (const entry of ledger.entries) {
		byComponent[entry.source] = (byComponent[entry.source] ?? 0) + 1;
		byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
	}

	return {
		totalEntries: ledger.entries.length,
		byComponent,
		byCategory,
		completionGatePassed: false, // not yet evaluated
		blockReasons: [],
	};
}

// ---------------------------------------------------------------------------
// AC1: All G1-G6 components are wired into a single coherent audit trail
// ---------------------------------------------------------------------------

describe("P9.G7 AC1: All G1-G6 components wired into coherent audit trail", () => {
	let ledger: GovernanceLedger;

	beforeEach(() => {
		ledger = createGovernanceLedger();
	});

	it("governance ledger starts empty", () => {
		const snapshot = ledger.snapshot();
		expect(snapshot.entries).toHaveLength(0);
		expect(snapshot.summary.totalEntries).toBe(0);
	});

	it("G1 events (remediation runtime) are recorded correctly", () => {
		const entry1 = ledger.recordStateTransition("idle", "scanning", "Initiated scan");
		expect(entry1.source).toBe("g1_remediation_runtime");
		expect(entry1.category).toBe("state_transition");
		expect(entry1.severity).toBe("info");
		expect(entry1.detail?.from).toBe("idle");
		expect(entry1.detail?.to).toBe("scanning");

		const entry2 = ledger.recordStateTransition("scanning", "scan_complete", "Scan done");
		expect(entry2.source).toBe("g1_remediation_runtime");

		expect(ledger.entries).toHaveLength(2);
	});

	it("G2 events (proposal/execution DB) are recorded correctly", () => {
		ledger.recordProposal("submitted", "prop-001", "Proposal submitted");
		ledger.recordExecutionRecord("started", "exec-001", "Execution started");

		const entries = ledger.entries;
		expect(entries).toHaveLength(2);

		const proposalEntry = entries[0];
		expect(proposalEntry.source).toBe("g2_proposal_db");
		expect(proposalEntry.category).toBe("proposal");
		expect(proposalEntry.detail?.proposalId).toBe("prop-001");

		const execEntry = entries[1];
		expect(execEntry.source).toBe("g2_proposal_db");
		expect(execEntry.category).toBe("execution_record");
		expect(execEntry.detail?.executionId).toBe("exec-001");
	});

	it("G3 events (approval & budget) are recorded correctly", () => {
		ledger.recordApproval("planning", "approved", "Plan approved", { reviewer: "alice" });
		ledger.recordChangeRequest("submitted", "cr-001", "Change request for extra work");
		ledger.recordChangeRequest("approved", "cr-001", "Change request approved");
		ledger.recordSelfModification(true, ["src/core/"], "Self-mod allowed");

		expect(ledger.entries).toHaveLength(4);

		const approvalEntry = ledger.entries[0];
		expect(approvalEntry.source).toBe("g3_approval_budget");
		expect(approvalEntry.category).toBe("approval");
		expect(approvalEntry.detail?.approvalType).toBe("planning");
		expect(approvalEntry.detail?.decision).toBe("approved");

		const changeEntry = ledger.entries[2];
		expect(changeEntry.source).toBe("g3_approval_budget");
		expect(changeEntry.category).toBe("change_request");
		expect(changeEntry.detail?.action).toBe("approved");
	});

	it("G4 events (dry-run & validation) are recorded correctly", () => {
		ledger.recordDryRun("started", "Dry-run starting");
		ledger.recordDryRun("completed", "Dry-run done", {
			totalProposals: 5,
			mutationsPredicted: 3,
		});
		ledger.recordValidation("passed", "test-suite-1", "All tests passed");
		ledger.recordValidationFailure("File not found", { path: "/missing.ts" }, "Validation failure recorded");

		expect(ledger.entries).toHaveLength(4);

		const dryRunEntry = ledger.entries[1];
		expect(dryRunEntry.source).toBe("g4_dry_run_validation");
		expect(dryRunEntry.category).toBe("dry_run");
		expect(dryRunEntry.detail?.totalProposals).toBe(5);

		const failureEntry = ledger.entries[3];
		expect(failureEntry.source).toBe("g4_dry_run_validation");
		expect(failureEntry.category).toBe("validation_failure");
		expect(failureEntry.severity).toBe("error");
	});

	it("G5 events (budget & policy) are recorded correctly", () => {
		ledger.recordBudgetSnapshot({ maxTokens: 10000 }, "Budget captured");
		ledger.recordPolicyCheck("max-files", true, true, "Passed");
		ledger.recordPolicyCheck("forbidden-paths", false, true, "Blocked!");
		ledger.recordAutonomyClassification("manual", "high", "Manual classification");

		expect(ledger.entries).toHaveLength(4);

		const blockingEntry = ledger.entries[2];
		expect(blockingEntry.source).toBe("g5_budget_policy_engine");
		expect(blockingEntry.category).toBe("policy_check");
		expect(blockingEntry.severity).toBe("critical"); // blocking failure
		expect(blockingEntry.detail?.passed).toBe(false);
		expect(blockingEntry.detail?.isBlocking).toBe(true);
	});

	it("G6 events (safety, simulation, queue) are recorded correctly", () => {
		ledger.recordSafetyReport(2, 1, "Safety issues found");
		ledger.recordSimulationForecast(4, 0.75, "Simulation done");
		ledger.recordQueueAudit("reorder", "ws-002", "Queue reordered");

		expect(ledger.entries).toHaveLength(3);

		const safetyEntry = ledger.entries[0];
		expect(safetyEntry.source).toBe("g6_safety_simulation_queue");
		expect(safetyEntry.category).toBe("safety_report");
		expect(safetyEntry.severity).toBe("critical"); // criticalCount > 0

		const queueEntry = ledger.entries[2];
		expect(queueEntry.source).toBe("g6_safety_simulation_queue");
		expect(queueEntry.category).toBe("queue_audit");
		expect(queueEntry.detail?.queueAction).toBe("reorder");
	});

	it("full G1-G7 lifecycle records entries from all six sources", () => {
		const summary = simulateFullLifecycle(ledger);

		// Verify at least one entry from each G1-G6 source
		expect(summary.byComponent.g1_remediation_runtime).toBeGreaterThanOrEqual(1);
		expect(summary.byComponent.g2_proposal_db).toBeGreaterThanOrEqual(1);
		expect(summary.byComponent.g3_approval_budget).toBeGreaterThanOrEqual(1);
		expect(summary.byComponent.g4_dry_run_validation).toBeGreaterThanOrEqual(1);
		expect(summary.byComponent.g5_budget_policy_engine).toBeGreaterThanOrEqual(1);
		expect(summary.byComponent.g6_safety_simulation_queue).toBeGreaterThanOrEqual(1);

		// Verify all sources combined produce a single coherent ledger
		expect(summary.totalEntries).toBeGreaterThanOrEqual(6);
		expect(ledger.entries.length).toBe(summary.totalEntries);

		// Verify completion gate not yet evaluated
		expect(ledger.hasPassedCompletionGate).toBe(false);
	});

	it("ledger summary has correct breakdown by source and severity", () => {
		simulateFullLifecycle(ledger);

		const summary = ledger.summary;

		// All 6 sources should appear
		const sourceKeys = Object.keys(summary.bySource);
		expect(sourceKeys.length).toBeGreaterThanOrEqual(6);

		// Verify total entry count matches
		expect(summary.totalEntries).toBe(ledger.entries.length);

		// Verify severity counts sum to total
		const severityTotal = Object.values(summary.bySeverity).reduce((a, b) => a + b, 0);
		expect(severityTotal).toBe(summary.totalEntries);
	});

	it("LEDGER_SOURCE_LABELS has labels for all components", () => {
		const sources: LedgerSource[] = [
			"g1_remediation_runtime",
			"g2_proposal_db",
			"g3_approval_budget",
			"g4_dry_run_validation",
			"g5_budget_policy_engine",
			"g6_safety_simulation_queue",
			"g7_governance_ledger",
		];

		for (const source of sources) {
			expect(LEDGER_SOURCE_LABELS[source]).toBeDefined();
			expect(LEDGER_SOURCE_LABELS[source].length).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// AC2: Completion gate requires complete ledger entry before marking plan done
// ---------------------------------------------------------------------------

describe("P9.G7 AC2: Completion gate requires complete ledger entry", () => {
	let ledger: GovernanceLedger;

	beforeEach(() => {
		ledger = createGovernanceLedger();
	});

	it("rejects completion when ledger is empty", () => {
		const result = ledger.checkCompletionGate();
		expect(result.passed).toBe(false);
		expect(result.blockReasons.length).toBeGreaterThan(0);
		expect(result.blockReasons.some((r) => r.includes("empty"))).toBe(true);
	});

	it("rejects completion when only G1 entries exist (no G3/G4)", () => {
		ledger.recordStateTransition("idle", "scanning", "Started scan");

		const result = ledger.checkCompletionGate();
		expect(result.passed).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("G3"))).toBe(true);
		expect(result.blockReasons.some((r) => r.includes("G4"))).toBe(true);
	});

	it("rejects completion when validation failures exist", () => {
		ledger.recordStateTransition("idle", "scanning", "Started scan");
		ledger.recordApproval("planning", "approved", "Plan approved", { reviewer: "test" });
		ledger.recordValidation("failed", "unit-tests", "Unit tests failed");
		ledger.recordValidationFailure("TypeError: cannot read property", { file: "test.ts" }, "Validation error");

		const result = ledger.checkCompletionGate();
		expect(result.passed).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("validation"))).toBe(true);
	});

	it("rejects completion when critical/error entries exist", () => {
		ledger.recordPolicyCheck("forbidden-paths", false, true, "Blocked attempt to access secrets", {
			detail: { path: ".env" },
		});
		ledger.recordApproval("planning", "approved", "Plan approved", { reviewer: "test" });
		ledger.recordValidation("passed", "tests", "Tests passed");

		const result = ledger.checkCompletionGate();
		expect(result.passed).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("critical") || r.includes("error"))).toBe(true);
	});

	it("accepts completion when all requirements are met", () => {
		// G1 events
		ledger.recordStateTransition("idle", "scanning", "Scan started");
		ledger.recordStateTransition("scanning", "scan_complete", "Scan done");
		ledger.recordStateTransition("scan_complete", "planning_approval_pending", "Pending approval");

		// G2 events
		ledger.recordProposal("submitted", "prop-001", "Proposal submitted");

		// G3 events
		ledger.recordApproval("planning", "approved", "Plan approved", { reviewer: "admin" });
		ledger.recordApproval("execution", "approved", "Execution approved", { reviewer: "admin" });

		// G4 events
		ledger.recordDryRun("completed", "Dry-run successful", { totalProposals: 1 });
		ledger.recordValidation("passed", "all-tests", "All validations passed");

		// G5 events
		ledger.recordBudgetSnapshot({ maxTokens: 10000 }, "Budget captured");
		ledger.recordPolicyCheck("safety-check", true, true, "All policy checks passed");
		ledger.recordAutonomyClassification("supervised", "low", "Low risk");

		// G6 events
		ledger.recordSafetyReport(0, 0, "No safety issues");
		ledger.recordSimulationForecast(2, 0.9, "Good utilization");
		ledger.recordQueueAudit("retry", "ws-003", "Retried workspace");

		const result = ledger.checkCompletionGate();
		expect(result.passed).toBe(true);
		expect(result.blockReasons).toHaveLength(0);
	});

	it("records completion gate evaluation in ledger", () => {
		// Add entries that will fail the gate: G3 entries exist but no approval,
		// and G4 entries exist but no validation outcome
		ledger.recordStateTransition("idle", "scanning", "Scan started");
		ledger.recordChangeRequest("submitted", "cr-001", "Change request submitted");
		ledger.recordValidationFailure("TypeError: null reference", { file: "test.ts" }, "Validation error");

		// Check gate (will fail because: validation failures exist, G3 has no approvals, G4 has no validations)
		const result = ledger.checkCompletionGate();
		expect(result.passed).toBe(false);

		// Completion gate not recorded until recordCompletionGate is called
		expect(ledger.completionGate).toBeUndefined();
		expect(ledger.hasPassedCompletionGate).toBe(false);

		// Now record it
		const gateRecord = ledger.recordCompletionGate(false, result.blockReasons);
		expect(gateRecord.passed).toBe(false);
		expect(gateRecord.blockReasons.length).toBeGreaterThan(0);
		expect(ledger.completionGate).toBeDefined();
		expect(ledger.hasPassedCompletionGate).toBe(false);
		expect(ledger.entries.length).toBe(4); // 3 original + 1 gate entry

		// Verify the gate entry
		const gateEntry = ledger.entries[3];
		expect(gateEntry.source).toBe("g7_governance_ledger");
		expect(gateEntry.category).toBe("completion_gate");
		expect(gateEntry.severity).toBe("error");
	});

	it("passing completion gate records a passing entry", () => {
		// Build sufficient ledger state
		ledger.recordStateTransition("idle", "scanning", "Start");
		ledger.recordProposal("submitted", "prop-001", "Prop");
		ledger.recordApproval("planning", "approved", "Approved", { reviewer: "admin" });
		ledger.recordApproval("execution", "approved", "Exec approved", { reviewer: "admin" });
		ledger.recordDryRun("completed", "Dry run done");
		ledger.recordValidation("passed", "all", "All good");
		ledger.recordSafetyReport(0, 0, "Safe");

		const result = ledger.checkCompletionGate();
		expect(result.passed).toBe(true);

		const gateRecord = ledger.recordCompletionGate(true, []);
		expect(gateRecord.passed).toBe(true);
		expect(ledger.hasPassedCompletionGate).toBe(true);

		// Gate entry should be severity "info" for passing
		const entries = ledger.entries;
		const gateEntry = entries[entries.length - 1];
		expect(gateEntry.severity).toBe("info");
	});
});

// ---------------------------------------------------------------------------
// AC3: End-to-end audit flow is validated with integration tests
// ---------------------------------------------------------------------------

describe("P9.G7 AC3: End-to-end audit flow", () => {
	let ledger: GovernanceLedger;

	beforeEach(() => {
		ledger = createGovernanceLedger();
	});

	it("captures full remediation lifecycle in governance ledger", async () => {
		// Record G1 events from runtime state machine
		ledger.recordStateTransition("idle", "planning_approval_pending", "Plan ready for approval");
		ledger.recordProposal("submitted", "prop-g7-001", "Governance integration proposal");

		// G3: Planning approval
		ledger.recordApproval("planning", "approved", "Planning approved for G7 integration", {
			reviewer: "test-reviewer",
			proposalId: "prop-g7-001",
		});

		// G3: Change request during planning
		ledger.recordChangeRequest("submitted", "cr-g7-001", "Add dry-run validation step");
		ledger.recordChangeRequest("approved", "cr-g7-001", "Change request approved with modifications");

		// G4: Dry-run simulation
		ledger.recordDryRun("started", "Starting dry-run for G7 audit trail verification", {
			totalProposals: 1,
		});
		ledger.recordDryRun("completed", "Dry-run completed successfully", {
			totalProposals: 1,
			mutationsPredicted: 3,
		});

		// G4: Validation outcomes
		ledger.recordValidation("passed", "targeted-validation", "Targeted validation: all checks passed");
		ledger.recordValidation("passed", "integration-validation", "Integration validation: full audit trail verified");

		// G5: Policy checks
		ledger.recordBudgetSnapshot(
			{ maxInputTokens: 16000, estimatedInputTokens: 7200, maxFiles: 20 },
			"Budget snapshot captured before execution",
		);
		ledger.recordPolicyCheck("blast-radius", true, true, "Blast radius within limits");
		ledger.recordPolicyCheck("self-modification", true, true, "Self-mod firewall passed");

		// G3: Execution approval
		ledger.recordApproval("execution", "approved", "Execution approved after successful validation", {
			reviewer: "test-reviewer",
			proposalId: "prop-g7-001",
		});

		// G2: Execution tracking
		ledger.recordExecutionRecord("started", "exec-g7-001", "Execution started for G7 audit trail");
		ledger.recordExecutionRecord("completed", "exec-g7-001", "Execution completed for G7 audit trail");

		// G6: Safety and queue finalization
		ledger.recordSafetyReport(0, 0, "Safety check: no issues detected");
		ledger.recordSimulationForecast(2, 0.92, "Simulation: 2 batches, 92% utilization");
		ledger.recordQueueAudit("clear_completed", undefined, "Queue cleared after successful execution");

		// --- Completion gate ---
		ledger.recordApproval("change_request", "approved", "All change requests resolved", {
			reviewer: "test-reviewer",
		});
		ledger.recordSelfModification(true, ["packages/coding-agent/src/core"], "G7 audit wiring approved");

		// Verify gate passes with full lifecycle
		const gateResult = ledger.checkCompletionGate();
		expect(gateResult.passed).toBe(true);

		// Record the passing gate
		ledger.recordCompletionGate(true, []);

		// --- Assertions ---
		const summary = ledger.summary;

		// Verify all 7 sources have entries (G1-G6 + G7 for completion gate)
		const sourceCount = Object.keys(summary.bySource).length;
		expect(sourceCount).toBeGreaterThanOrEqual(6); // At least 6 sources

		// G1: state transitions
		expect(summary.bySource.g1_remediation_runtime).toBeGreaterThanOrEqual(1);

		// G2: proposal + execution
		expect(summary.bySource.g2_proposal_db).toBeGreaterThanOrEqual(1);

		// G3: approval + change_request + self_modification
		expect(summary.bySource.g3_approval_budget).toBeGreaterThanOrEqual(1);

		// G4: dry_run + validation
		expect(summary.bySource.g4_dry_run_validation).toBeGreaterThanOrEqual(1);

		// G5: budget_snapshot + policy_check
		expect(summary.bySource.g5_budget_policy_engine).toBeGreaterThanOrEqual(1);

		// G6: safety_report + simulation_forecast + queue_audit
		expect(summary.bySource.g6_safety_simulation_queue).toBeGreaterThanOrEqual(1);

		// Completion gate passed
		expect(summary.completionGatePassed).toBe(true);
		expect(summary.criticalEntries).toBe(0);

		// Verify the snapshot is coherent
		const snapshot = ledger.snapshot();
		expect(snapshot.entries.length).toBe(summary.totalEntries);
		expect(snapshot.completionGate?.passed).toBe(true);
		expect(snapshot.createdAt).toBeDefined();
		expect(snapshot.updatedAt).toBeDefined();
	});

	it("correctly blocks completion when governance violations exist in full flow", async () => {
		// Simulate a lifecycle with a governance violation (blocking policy failure)

		ledger.recordStateTransition("idle", "scanning", "Scan started");
		ledger.recordProposal("submitted", "prop-002", "Proposal with governance risk");
		ledger.recordApproval("planning", "approved", "Plan approved", { reviewer: "test" });

		// G5: Blocking policy failure
		ledger.recordPolicyCheck("forbidden-paths", false, true, "BLOCKED: Attempt to modify forbidden path", {
			detail: { path: ".env", workspaceId: "ws-002" },
		});

		// Try gate — should be blocked
		const gateResult = ledger.checkCompletionGate();
		expect(gateResult.passed).toBe(false);
		expect(gateResult.blockReasons.some((r) => r.includes("critical") || r.includes("error"))).toBe(true);

		// Record the gate
		ledger.recordCompletionGate(false, gateResult.blockReasons, {
			planExecId: "plan-g7-002",
			workspaceId: "ws-002",
		});

		// Verify the gate is recorded correctly
		expect(ledger.hasPassedCompletionGate).toBe(false);
		expect(ledger.completionGate?.passed).toBe(false);

		// Even after adding more entries, gate still fails until issues resolved
		ledger.recordDryRun("completed", "Dry-run done");
		ledger.recordValidation("passed", "tests", "Tests passed");

		const retryGate = ledger.checkCompletionGate();
		expect(retryGate.passed).toBe(false);
	});

	it("snapshot correctly captures full audit trail state", () => {
		simulateFullLifecycle(ledger);

		const snapshot = ledger.snapshot();

		// Verify snapshot structure
		expect(snapshot.entries).toBeDefined();
		expect(snapshot.summary).toBeDefined();
		expect(snapshot.createdAt).toBeDefined();
		expect(snapshot.updatedAt).toBeDefined();

		// Verify entries are ordered (oldest first)
		const timestamps = snapshot.entries.map((e) => e.timestamp);
		for (let i = 1; i < timestamps.length; i++) {
			expect(new Date(timestamps[i]).getTime()).toBeGreaterThanOrEqual(new Date(timestamps[i - 1]).getTime());
		}

		// Verify snapshot is immutable (changes to ledger don't affect snapshot)
		const originalCount = snapshot.entries.length;
		ledger.recordStateTransition("complete", "idle", "Reset");
		expect(snapshot.entries.length).toBe(originalCount);
	});

	it("clear resets ledger state completely", () => {
		simulateFullLifecycle(ledger);
		expect(ledger.entries.length).toBeGreaterThan(0);

		ledger.clear();
		expect(ledger.entries).toHaveLength(0);
		expect(ledger.completionGate).toBeUndefined();
		expect(ledger.hasPassedCompletionGate).toBe(false);
	});

	it("works with CompletionGateRegistry for integrated gate evaluation", async () => {
		// This test verifies that the governance ledger integrates with
		// the CompletionGateRegistry for end-to-end gate evaluation.

		const { CompletionGateRegistry } = await import("../src/core/completion-gate.js");
		const registry = new CompletionGateRegistry();

		// Attach governance ledger
		registry.setGovernanceLedger(ledger);

		// Build ledger state
		ledger.recordStateTransition("idle", "scanning", "Start");
		ledger.recordApproval("planning", "approved", "Approved", { reviewer: "admin" });
		ledger.recordApproval("execution", "approved", "Exec approved", { reviewer: "admin" });
		ledger.recordDryRun("completed", "DR done");
		ledger.recordValidation("passed", "all", "Good");

		// Create a minimal workspace definition for evaluation
		const workspace = {
			id: "ws-g7-001",
			title: "G7 integration test workspace",
			description: "G7 integration test workspace",
			dependencies: [] as string[],
			roleBudget: "unknown" as const,
			maxRetries: 1,
			capabilities: { canEdit: true },
		} as any;

		// Evaluate with governance ledger attached
		// Note: evaluateWorkspace requires a planExecId, workspaceId, and Workspace
		// It will check both standard completion criteria and governance ledger
		const result = registry.evaluateWorkspace("plan-g7-003", "ws-g7-001", workspace);

		// Should be blocked because implementation not finished
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Implementation not finished"))).toBe(true);

		// Mark implementation as finished
		registry.markImplementationFinished("plan-g7-003", "ws-g7-001");

		// Re-evaluate
		const result2 = registry.evaluateWorkspace("plan-g7-003", "ws-g7-001", workspace);
		expect(result2.canComplete).toBe(true);

		// Verify gate was recorded in ledger
		expect(ledger.completionGate).toBeDefined();
		expect(ledger.hasPassedCompletionGate).toBe(true);

		// Check that the gate entry has the correct context
		const gateEntry = ledger.completionGate!;
		expect(gateEntry.passed).toBe(true);
	});
});
