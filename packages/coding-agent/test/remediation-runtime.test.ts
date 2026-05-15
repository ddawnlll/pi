/**
 * Remediation Runtime Tests - P9.A Approval-Gated Remediation Runtime
 *
 * Acceptance Criteria:
 * 1. Remediation runtime state machine exists.
 * 2. Runtime separates planning approval from execution approval.
 * 3. Runtime cannot execute without dry-run and explicit execution approval.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	createRemediationRuntime,
	type DryRunReport,
	PreconditionError,
	type RemediationRuntime,
	type RemediationScanResult,
} from "../src/index.js";
import type { HealthSignal } from "../src/repo-scanner/repo-health-signal.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal scan result for testing.
 */
function makeScanResult(options: {
	proposals?: number;
	totalProposals?: number;
	completedAt?: string;
}): RemediationScanResult {
	const numProposals = options.proposals ?? 1;
	const signals: HealthSignal[] = [
		{
			id: "signal-001",
			title: "Test Signal",
			description: "A test health signal",
			severity: "warning",
			category: "typecheck",
			scope: "test",
			evidence: [],
			proposals: Array.from({ length: numProposals }, (_, i) => ({
				description: `Proposal ${i + 1}`,
				targetFiles: [`file-${i + 1}.ts`],
				effort: "small" as const,
				autoFixable: true,
			})),
			verified: false,
			timestamp: new Date().toISOString(),
		},
	];

	return {
		signals,
		totalProposals: options.totalProposals ?? numProposals,
		proposals: signals.flatMap((s) => s.proposals),
		completedAt: options.completedAt ?? new Date().toISOString(),
	};
}

/**
 * Create a successful dry-run report.
 */
function makeDryRunReport(overrides?: Partial<DryRunReport>): DryRunReport {
	return {
		timestamp: new Date().toISOString(),
		totalProposals: 1,
		mutationsPredicted: 1,
		expectedFileChanges: ["file-1.ts"],
		success: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC1: State machine exists and transitions correctly
// ---------------------------------------------------------------------------

describe("AC1: Remediation runtime state machine exists", () => {
	let runtime: RemediationRuntime;

	beforeEach(() => {
		runtime = createRemediationRuntime({ reviewer: "test-runner" });
	});

	it("starts in idle state", () => {
		expect(runtime.state).toBe("idle");
		expect(runtime.isTerminal).toBe(false);
	});

	it("transitions through scan lifecycle", async () => {
		expect(runtime.state).toBe("idle");

		// plan -> scanning -> scan_complete -> planning_approval_pending
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 2 })));

		expect(runtime.state).toBe("planning_approval_pending");
		expect(runtime.scanResult).toBeDefined();
		expect(runtime.scanResult!.totalProposals).toBe(2);
		expect(runtime.journal.length).toBeGreaterThanOrEqual(2); // scanning, scan_complete, planning_approval_pending
	});

	it("skips to planning_rejected when scan finds no proposals", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 0 })));

		expect(runtime.state).toBe("planning_rejected");
	});

	it("transitions to failed when scan throws", async () => {
		await runtime.plan(() => Promise.reject(new Error("Scanner crashed")));

		expect(runtime.state).toBe("failed");
		expect(runtime.error).toContain("Scanner crashed");
	});

	it("records transitions in journal", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

		const journal = runtime.journal;
		expect(journal.length).toBeGreaterThanOrEqual(2);

		// First transition should be idle -> scanning
		expect(journal[0].from).toBe("idle");
		expect(journal[0].to).toBe("scanning");
	});

	it("transitions through full lifecycle", async () => {
		// Plan and scan
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		expect(runtime.state).toBe("planning_approval_pending");

		// Gate 1: Approve plan
		await runtime.approvePlan("Looks good");
		expect(runtime.state).toBe("planning_approved");
		expect(runtime.approvalStatus.planning.approved).toBe(true);

		// Request dry-run
		await runtime.requestDryRun();
		expect(runtime.state).toBe("dry_run_pending");

		// Run dry-run
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		expect(runtime.state).toBe("dry_run_complete");
		expect(runtime.dryRunReport).toBeDefined();
		expect(runtime.dryRunReport!.success).toBe(true);

		// Gate 2: Approve execution
		await runtime.approveExecution("Ready to go");
		expect(runtime.state).toBe("execution_approved");
		expect(runtime.approvalStatus.execution.approved).toBe(true);

		// Execute
		let executed = false;
		await runtime.execute(() => {
			executed = true;
			return Promise.resolve();
		});
		expect(executed).toBe(true);
		expect(runtime.state).toBe("complete");
	});

	it("can reset from complete state", async () => {
		// Complete full lifecycle
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.approveExecution();
		await runtime.execute(() => Promise.resolve());

		expect(runtime.state).toBe("complete");

		// Reset
		await runtime.reset();
		expect(runtime.state).toBe("idle");
		expect(runtime.scanResult).toBeUndefined();
		expect(runtime.dryRunReport).toBeUndefined();
		expect(runtime.error).toBeUndefined();
	});

	it("blocks invalid transitions", async () => {
		// Cannot approve plan without scanning
		await expect(runtime.approvePlan()).rejects.toThrow(PreconditionError);

		// Cannot run dry-run without planning approval
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await expect(runtime.runDryRun(() => Promise.resolve(makeDryRunReport()))).rejects.toThrow(PreconditionError);

		// Cannot execute without dry-run and execution approval
		await runtime.approvePlan();
		await expect(runtime.execute(() => Promise.resolve())).rejects.toThrow(PreconditionError);
	});
});

// ---------------------------------------------------------------------------
// AC2: Runtime separates planning approval from execution approval
// ---------------------------------------------------------------------------

describe("AC2: Runtime separates planning approval from execution approval", () => {
	let runtime: RemediationRuntime;

	beforeEach(() => {
		runtime = createRemediationRuntime({ reviewer: "test-runner" });
	});

	it("has distinct planning and execution approval gates", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

		// Approval status defaults
		expect(runtime.approvalStatus.planning.approved).toBe(false);
		expect(runtime.approvalStatus.planning.rejected).toBe(false);
		expect(runtime.approvalStatus.execution.approved).toBe(false);
		expect(runtime.approvalStatus.execution.rejected).toBe(false);

		// Gate 1: approve plan
		await runtime.approvePlan("Plan approved by reviewer");
		expect(runtime.approvalStatus.planning.approved).toBe(true);
		expect(runtime.approvalStatus.execution.approved).toBe(false); // Still false

		// Dry-run
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// Gate 2: approve execution
		await runtime.approveExecution("Exec approved by reviewer");
		expect(runtime.approvalStatus.execution.approved).toBe(true);

		// Planning approval remains true
		expect(runtime.approvalStatus.planning.approved).toBe(true);
	});

	it("records separate approval events for each gate", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

		// Gate 1 approval event
		await runtime.approvePlan("Good plan");
		expect(runtime.approvalStatus.planning.event).toBeDefined();
		expect(runtime.approvalStatus.planning.event!.type).toBe("planning");
		expect(runtime.approvalStatus.planning.event!.decision).toBe("approved");
		expect(runtime.approvalStatus.planning.event!.reviewer).toBe("test-runner");

		// Dry-run
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// Gate 2 approval event
		await runtime.approveExecution("Good dry-run results");
		expect(runtime.approvalStatus.execution.event).toBeDefined();
		expect(runtime.approvalStatus.execution.event!.type).toBe("execution");
		expect(runtime.approvalStatus.execution.event!.decision).toBe("approved");
		expect(runtime.approvalStatus.execution.event!.reviewer).toBe("test-runner");

		// Events are distinct — timestamps may be the same if both occur within the same ms,
		// but the type and decision should differ
		expect(runtime.approvalStatus.planning.event!.type).not.toBe(runtime.approvalStatus.execution.event!.type);
	});

	it("allows rejecting plan at Gate 1", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.rejectPlan("Not ready");

		expect(runtime.state).toBe("planning_rejected");
		expect(runtime.approvalStatus.planning.rejected).toBe(true);
		expect(runtime.approvalStatus.planning.approved).toBe(false);
	});

	it("allows rejecting execution at Gate 2", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.rejectExecution("Dry-run showed too many changes");

		expect(runtime.state).toBe("execution_rejected");
		expect(runtime.approvalStatus.execution.rejected).toBe(true);
		expect(runtime.approvalStatus.execution.approved).toBe(false);
	});

	it("allows revising plan after dry-run", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 2 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// Revise: go back to planning approval
		await runtime.revisePlan("Need to adjust proposals based on dry-run");
		expect(runtime.state).toBe("planning_approval_pending");

		// Dry-run report should be cleared
		expect(runtime.dryRunReport).toBeUndefined();

		// Execution approval should be reset
		expect(runtime.approvalStatus.execution.approved).toBe(false);
		expect(runtime.approvalStatus.execution.rejected).toBe(false);

		// Planning approval should still be intact (we can re-approve)
	});
});

// ---------------------------------------------------------------------------
// AC3: Runtime cannot execute without dry-run and explicit execution approval
// ---------------------------------------------------------------------------

describe("AC3: Runtime cannot execute without dry-run and explicit execution approval", () => {
	let runtime: RemediationRuntime;

	beforeEach(() => {
		runtime = createRemediationRuntime({ reviewer: "test-runner" });
	});

	it("rejects execute from idle state", async () => {
		await expect(runtime.execute(() => Promise.resolve())).rejects.toThrow(PreconditionError);
	});

	it("rejects execute after plan approval without dry-run", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();

		await expect(runtime.execute(() => Promise.resolve())).rejects.toThrow(PreconditionError);
	});

	it("rejects execute after dry-run without execution approval", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// State is dry_run_complete, no execution approval yet
		expect(runtime.state).toBe("dry_run_complete");
		expect(runtime.canExecute).toBe(false);
		expect(runtime.executionBlockedReason).toBeDefined();

		await expect(runtime.execute(() => Promise.resolve())).rejects.toThrow(PreconditionError);
	});

	it("rejects execute when execution is rejected", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.rejectExecution("Not safe");

		expect(runtime.canExecute).toBe(false);
		await expect(runtime.execute(() => Promise.resolve())).rejects.toThrow(PreconditionError);
	});

	it("allows execute only when both dry-run is complete and execution is approved", async () => {
		// Set up full approvals
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// canExecute is false before execution approval
		expect(runtime.canExecute).toBe(false);
		expect(runtime.executionBlockedReason).toMatch(/Dry-run is complete/);
		expect(runtime.executionBlockedReason).toMatch(/approveExecution/);

		// After execution approval, canExecute is true
		await runtime.approveExecution("Proceed");
		expect(runtime.canExecute).toBe(true);
		expect(runtime.executionBlockedReason).toBeUndefined();

		// Now execute works
		let executed = false;
		await runtime.execute(() => {
			executed = true;
			return Promise.resolve();
		});
		expect(executed).toBe(true);
	});

	it("blocks execute when dry-run failed", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport({ success: false, error: "Simulation error" })));

		// Should transition to failed
		expect(runtime.state).toBe("failed");
		expect(runtime.canExecute).toBe(false);
		await expect(runtime.approveExecution()).rejects.toThrow(PreconditionError);
	});

	it("reports meaningful execution blocked reason", async () => {
		// From idle
		expect(runtime.executionBlockedReason).toMatch(/execution_approved/);

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();

		// After plan approved but no dry-run
		expect(runtime.executionBlockedReason).toMatch(/execution_approved/);
		expect(runtime.executionBlockedReason).toMatch(/planning_approved/);

		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// After dry-run but no execution approval
		expect(runtime.executionBlockedReason).toMatch(/Dry-run is complete/);
		expect(runtime.executionBlockedReason).toMatch(/approveExecution/);
	});

	it("maintains canExecute invariant throughout lifecycle", async () => {
		// canExecute should only be true in execution_approved state with valid dry-run
		expect(runtime.canExecute).toBe(false);

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		expect(runtime.canExecute).toBe(false);

		await runtime.approvePlan();
		expect(runtime.canExecute).toBe(false);

		await runtime.requestDryRun();
		expect(runtime.canExecute).toBe(false);

		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		expect(runtime.canExecute).toBe(false);

		await runtime.approveExecution();
		expect(runtime.canExecute).toBe(true);

		await runtime.execute(() => Promise.resolve());
		expect(runtime.state).toBe("complete");
		expect(runtime.canExecute).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("Remediation runtime edge cases", () => {
	let runtime: RemediationRuntime;

	beforeEach(() => {
		runtime = createRemediationRuntime();
	});

	it("rejects invalid reset from non-terminal states", async () => {
		// Cannot reset from planning_approval_pending
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await expect(runtime.reset()).rejects.toThrow(PreconditionError);
	});

	it("resets from planning_rejected state", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.rejectPlan("Not needed");
		expect(runtime.state).toBe("planning_rejected");

		await runtime.reset();
		expect(runtime.state).toBe("idle");
	});

	it("resets from execution_rejected state", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.rejectExecution("Too risky");
		expect(runtime.state).toBe("execution_rejected");

		await runtime.reset();
		expect(runtime.state).toBe("idle");
	});

	it("resets from failed state", async () => {
		await runtime.plan(() => Promise.reject(new Error("Scanner error")));
		expect(runtime.state).toBe("failed");

		await runtime.reset();
		expect(runtime.state).toBe("idle");
	});

	it("rejects revisePlan from invalid states", async () => {
		await expect(runtime.revisePlan()).rejects.toThrow(PreconditionError);

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		// Can't revise from planning_approval_pending — we need to approve first
		await expect(runtime.revisePlan()).rejects.toThrow(PreconditionError);
	});

	it("rejects requestDryRun from wrong state", async () => {
		await expect(runtime.requestDryRun()).rejects.toThrow(PreconditionError);
	});

	it("rejects runDryRun without requestDryRun", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		// Haven't called requestDryRun
		await expect(runtime.runDryRun(() => Promise.resolve(makeDryRunReport()))).rejects.toThrow(PreconditionError);
	});

	it("snapshot captures full state", async () => {
		const snap1 = runtime.snapshot();
		expect(snap1.state).toBe("idle");
		expect(snap1.journal).toHaveLength(0);

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 2 })));
		await runtime.approvePlan();

		const snap2 = runtime.snapshot();
		expect(snap2.state).toBe("planning_approved");
		expect(snap2.scanResult).toBeDefined();
		expect(snap2.scanResult!.totalProposals).toBe(2);
		expect(snap2.approvalStatus.planning.approved).toBe(true);
		expect(snap2.journal.length).toBeGreaterThanOrEqual(3);
		expect(snap2.createdAt).toBeDefined();
		expect(snap2.updatedAt).toBeDefined();
	});

	it("handles dry-run failure correctly", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.reject(new Error("Dry-run crashed")));

		expect(runtime.state).toBe("failed");
		expect(runtime.error).toContain("Dry-run crashed");
	});

	it("handles execution failure correctly", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.approveExecution();
		await runtime.execute(() => Promise.reject(new Error("Execution error")));

		expect(runtime.state).toBe("failed");
		expect(runtime.error).toContain("Execution error");
	});
});
