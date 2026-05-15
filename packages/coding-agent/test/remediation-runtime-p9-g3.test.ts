/**
 * P9.G3 Approval & Budget Recording Tests
 *
 * Acceptance Criteria:
 * 1. Planning approval, execution approval, rejections, change requests,
 *    and self-modification approvals are recorded.
 * 2. Budget snapshots at approval time are persisted.
 * 3. Approval chain is traceable from proposal to execution.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBudgetEnforcer } from "../src/core/budget-enforcer.js";
import {
	createRemediationRuntime,
	type DryRunReport,
	type RemediationRuntime,
	type RemediationScanResult,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeScanResult(options: {
	proposals?: number;
	totalProposals?: number;
	completedAt?: string;
}): RemediationScanResult {
	const numProposals = options.proposals ?? 1;
	const signals = [
		{
			id: "signal-001",
			title: "Test Signal",
			description: "A test health signal",
			severity: "warning" as const,
			category: "typecheck" as const,
			scope: "test",
			evidence: [] as Array<{ description: string; filePath?: string; lineNumber?: number; code?: string }>,
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
// AC1: Planning approval, execution approval, rejections, change requests,
//      and self-modification approvals are recorded
// ---------------------------------------------------------------------------

describe("P9.G3 AC1: Approval and change request recording", () => {
	let runtime: RemediationRuntime;

	beforeEach(() => {
		runtime = createRemediationRuntime({ reviewer: "p9-g3-test" });
	});

	describe("Planning approvals and rejections are recorded", () => {
		it("records planning approval event", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan("Good plan");

			expect(runtime.approvalStatus.planning.approved).toBe(true);
			expect(runtime.approvalStatus.planning.event).toBeDefined();
			expect(runtime.approvalStatus.planning.event!.type).toBe("planning");
			expect(runtime.approvalStatus.planning.event!.decision).toBe("approved");
			expect(runtime.approvalStatus.planning.event!.reviewer).toBe("p9-g3-test");
			expect(runtime.approvalStatus.planning.event!.reason).toBe("Good plan");
			expect(runtime.approvalStatus.planning.event!.timestamp).toBeDefined();
		});

		it("records planning rejection event", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.rejectPlan("Not acceptable");

			expect(runtime.approvalStatus.planning.rejected).toBe(true);
			expect(runtime.approvalStatus.planning.approved).toBe(false);
			expect(runtime.approvalStatus.planning.event).toBeDefined();
			expect(runtime.approvalStatus.planning.event!.type).toBe("planning");
			expect(runtime.approvalStatus.planning.event!.decision).toBe("rejected");
			expect(runtime.approvalStatus.planning.event!.reason).toBe("Not acceptable");
		});
	});

	describe("Execution approvals and rejections are recorded", () => {
		it("records execution approval event", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan();
			await runtime.requestDryRun();
			await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
			await runtime.approveExecution("Ready to proceed");

			expect(runtime.approvalStatus.execution.approved).toBe(true);
			expect(runtime.approvalStatus.execution.event).toBeDefined();
			expect(runtime.approvalStatus.execution.event!.type).toBe("execution");
			expect(runtime.approvalStatus.execution.event!.decision).toBe("approved");
			expect(runtime.approvalStatus.execution.event!.reason).toBe("Ready to proceed");
		});

		it("records execution rejection event", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan();
			await runtime.requestDryRun();
			await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
			await runtime.rejectExecution("Too risky");

			expect(runtime.approvalStatus.execution.rejected).toBe(true);
			expect(runtime.approvalStatus.execution.approved).toBe(false);
			expect(runtime.approvalStatus.execution.event).toBeDefined();
			expect(runtime.approvalStatus.execution.event!.type).toBe("execution");
			expect(runtime.approvalStatus.execution.event!.decision).toBe("rejected");
			expect(runtime.approvalStatus.execution.event!.reason).toBe("Too risky");
		});
	});

	describe("Change requests are recorded", () => {
		it("creates a change request with all required fields", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const cr = await runtime.requestChange(
				"Modify plan scope",
				"Discovered additional files that need remediation",
				{
					currentState: "Plan covers src/ only",
					proposedState: "Plan covers both src/ and tests/",
					riskAssessment: "Low risk — tests/ files are unit tests",
					requestedBy: "dev-user",
				},
			);

			expect(cr).toBeDefined();
			expect(cr.id).toMatch(/^cr-/);
			expect(cr.description).toBe("Modify plan scope");
			expect(cr.rationale).toBe("Discovered additional files that need remediation");
			expect(cr.currentState).toBe("Plan covers src/ only");
			expect(cr.proposedState).toBe("Plan covers both src/ and tests/");
			expect(cr.riskAssessment).toBe("Low risk — tests/ files are unit tests");
			expect(cr.requestedBy).toBe("dev-user");
			expect(cr.status).toBe("pending");
			expect(cr.requestedAt).toBeDefined();
			expect(cr.resolution).toBeUndefined();
		});

		it("records change request in approval status", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			await runtime.requestChange("Change scope", "Need broader coverage");

			expect(runtime.approvalStatus.changeRequest).toBeDefined();
			expect(runtime.approvalStatus.changeRequest!.active).toBe(true);
			expect(runtime.approvalStatus.changeRequest!.requests).toHaveLength(1);
			expect(runtime.approvalStatus.changeRequest!.requests[0].status).toBe("pending");
		});

		it("maintains list of all change requests", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			await runtime.requestChange("Change A", "First change");
			await runtime.requestChange("Change B", "Second change");

			expect(runtime.changeRequests).toHaveLength(2);
			expect(runtime.changeRequests[0].description).toBe("Change A");
			expect(runtime.changeRequests[1].description).toBe("Change B");
		});

		it("allows approving a change request", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const cr = await runtime.requestChange("Modify plan", "Additional files detected");
			expect(cr.status).toBe("pending");

			await runtime.approveChange(cr.id, "Change looks reasonable");

			expect(runtime.changeRequests[0].status).toBe("approved");
			expect(runtime.changeRequests[0].resolution).toBeDefined();
			expect(runtime.changeRequests[0].resolution!.type).toBe("change_request");
			expect(runtime.changeRequests[0].resolution!.decision).toBe("approved");
			expect(runtime.changeRequests[0].resolution!.reason).toBe("Change looks reasonable");
		});

		it("allows rejecting a change request", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const cr = await runtime.requestChange("Revert changes", "Not needed");
			expect(cr.status).toBe("pending");

			await runtime.rejectChange(cr.id, "Change is outside scope");

			expect(runtime.changeRequests[0].status).toBe("rejected");
			expect(runtime.changeRequests[0].resolution).toBeDefined();
			expect(runtime.changeRequests[0].resolution!.type).toBe("change_request");
			expect(runtime.changeRequests[0].resolution!.decision).toBe("rejected");
			expect(runtime.changeRequests[0].resolution!.reason).toBe("Change is outside scope");
		});

		it("blocks approving already-resolved change requests", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const cr = await runtime.requestChange("Test", "Test");
			await runtime.approveChange(cr.id, "OK");

			await expect(runtime.approveChange(cr.id, "Again")).rejects.toThrow(/already approved/);
		});

		it("blocks rejecting already-resolved change requests", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const cr = await runtime.requestChange("Test", "Test");
			await runtime.rejectChange(cr.id, "No");

			await expect(runtime.rejectChange(cr.id, "Again")).rejects.toThrow(/already rejected/);
		});

		it("rejects change request with invalid ID", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await expect(runtime.approveChange("invalid-id", "Nope")).rejects.toThrow(/not found/);
			await expect(runtime.rejectChange("invalid-id", "Nope")).rejects.toThrow(/not found/);
		});

		it("rejects change request from invalid states", async () => {
			// Cannot request change from idle state
			await expect(runtime.requestChange("Test", "Test")).rejects.toThrow(/Cannot request change/);
		});
	});

	describe("Self-modification approvals are recorded", () => {
		it("records a self-modification approval", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const record = await runtime.recordSelfModificationApproval(true, [".pi/agent/"], "Approved for fix");

			expect(record).toBeDefined();
			expect(record.approved).toBe(true);
			expect(record.affectedPaths).toEqual([".pi/agent/"]);
			expect(record.reason).toBe("Approved for fix");
			expect(record.timestamp).toBeDefined();
			expect(record.event).toBeDefined();
			expect(record.event!.type).toBe("self_modification");
			expect(record.event!.decision).toBe("approved");
		});

		it("records a self-modification denial", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const record = await runtime.recordSelfModificationApproval(
				false,
				["packages/"],
				"Self-modification not permitted",
			);

			expect(record.approved).toBe(false);
			expect(record.affectedPaths).toEqual(["packages/"]);
			expect(record.reason).toBe("Self-modification not permitted");
			expect(record.event!.decision).toBe("rejected");
		});

		it("records multiple self-modification decisions", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			await runtime.recordSelfModificationApproval(true, [".pi/agent/"], "First approval");
			await runtime.recordSelfModificationApproval(false, ["packages/coding-agent/"], "Second denied");

			expect(runtime.selfModificationApprovals).toHaveLength(2);
			expect(runtime.selfModificationApprovals[0].approved).toBe(true);
			expect(runtime.selfModificationApprovals[1].approved).toBe(false);
		});

		it("updates approval status with self-modification state", async () => {
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.recordSelfModificationApproval(true, [".pi/agent/"], "Approved");

			expect(runtime.approvalStatus.selfModification).toBeDefined();
			expect(runtime.approvalStatus.selfModification!.approved).toBe(true);
			expect(runtime.approvalStatus.selfModification!.event).toBeDefined();
		});
	});
});

// ---------------------------------------------------------------------------
// AC2: Budget snapshots at approval time are persisted
// ---------------------------------------------------------------------------

describe("P9.G3 AC2: Budget snapshots at approval time", () => {
	let runtime: RemediationRuntime;

	beforeEach(() => {
		const budgetEnforcer = createWorkspaceBudgetEnforcer(
			{
				maxFiles: 10,
				maxLines: 500,
				allowedPaths: ["src/**"],
				forbiddenPaths: ["**/.env*"],
				approvalExpiry: 300_000,
			},
			{ maxInputTokens: 10000 },
		);
		runtime = createRemediationRuntime({
			reviewer: "budget-test",
			budgetEnforcer,
		});
	});

	it("captures budget snapshot on planning approval", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan("Plan looks good");

		// Budget snapshot should be on the approval event
		const event = runtime.approvalStatus.planning.event;
		expect(event).toBeDefined();
		expect(event!.budgetSnapshot).toBeDefined();
		expect(event!.budgetSnapshot!.maxInputTokens).toBe(10000);
		expect(event!.budgetSnapshot!.maxFiles).toBe(10);
		expect(event!.budgetSnapshot!.maxLines).toBe(500);

		// Budget snapshot should also be available from the runtime
		expect(runtime.budgetSnapshot).toBeDefined();
		expect(runtime.budgetSnapshot!.maxInputTokens).toBe(10000);
	});

	it("captures budget snapshot on planning rejection", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.rejectPlan("Not acceptable");

		const event = runtime.approvalStatus.planning.event;
		expect(event).toBeDefined();
		expect(event!.budgetSnapshot).toBeDefined();
	});

	it("captures budget snapshot on execution approval", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.approveExecution("Go ahead");

		const event = runtime.approvalStatus.execution.event;
		expect(event).toBeDefined();
		expect(event!.budgetSnapshot).toBeDefined();
		expect(event!.budgetSnapshot!.maxInputTokens).toBe(10000);
	});

	it("captures budget snapshot on execution rejection", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.rejectExecution("Blocked");

		const event = runtime.approvalStatus.execution.event;
		expect(event).toBeDefined();
		expect(event!.budgetSnapshot).toBeDefined();
	});

	it("captures budget snapshot on change request resolution", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

		const cr = await runtime.requestChange("Update scope", "Need more files");
		await runtime.approveChange(cr.id, "Approved");

		expect(cr.resolution).toBeDefined();
		expect(cr.resolution!.budgetSnapshot).toBeDefined();
		expect(cr.resolution!.budgetSnapshot!.maxInputTokens).toBe(10000);
	});

	it("captures budget snapshot on self-modification approval", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

		const record = await runtime.recordSelfModificationApproval(true, ["packages/"], "Approved");

		expect(record.event).toBeDefined();
		expect(record.event!.budgetSnapshot).toBeDefined();
		expect(record.event!.budgetSnapshot!.maxInputTokens).toBe(10000);
	});

	it("does not capture budget snapshot when no budget enforcer is configured", async () => {
		const runtimeNoBudget = createRemediationRuntime({ reviewer: "no-budget" });
		await runtimeNoBudget.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtimeNoBudget.approvePlan();

		const event = runtimeNoBudget.approvalStatus.planning.event;
		expect(event!.budgetSnapshot).toBeUndefined();
		expect(runtimeNoBudget.budgetSnapshot).toBeUndefined();
	});

	it("includes budget snapshot in snapshot", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan("Approved");

		const snap = runtime.snapshot();
		expect(snap.budgetSnapshot).toBeDefined();
		expect(snap.budgetSnapshot!.maxInputTokens).toBe(10000);
		expect(snap.budgetSnapshot!.withinBudget).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC3: Approval chain is traceable from proposal to execution
// ---------------------------------------------------------------------------

describe("P9.G3 AC3: Approval chain traceability", () => {
	describe("Approval chain with proposal ID", () => {
		it("traces full chain from proposal to execution", async () => {
			const runtime = createRemediationRuntime({
				reviewer: "chain-test",
				proposalId: "prop-001",
			});

			// Chain should start with proposal submission
			expect(runtime.approvalChain).toHaveLength(1);
			expect(runtime.approvalChain[0].step).toBe(1);
			expect(runtime.approvalChain[0].gate).toBe("proposal");
			expect(runtime.approvalChain[0].decision).toBe("submitted");
			expect(runtime.approvalChain[0].referenceId).toBe("prop-001");

			// Plan and approve
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan("Plan approved");

			// Chain should have planning approval entry
			expect(runtime.approvalChain.length).toBeGreaterThanOrEqual(2);
			const planningEntry = runtime.approvalChain[runtime.approvalChain.length - 1];
			expect(planningEntry.gate).toBe("planning");
			expect(planningEntry.decision).toBe("approved");
			expect(planningEntry.referenceId).toBe("prop-001");

			// Dry-run and execute approval
			await runtime.requestDryRun();
			await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
			await runtime.approveExecution("Exec approved");

			// Chain should have execution approval entry
			const execEntry = runtime.approvalChain[runtime.approvalChain.length - 1];
			expect(execEntry.gate).toBe("execution");
			expect(execEntry.decision).toBe("approved");
			expect(execEntry.referenceId).toBe("prop-001");
		});

		it("includes budget snapshots in each chain entry", async () => {
			const budgetEnforcer = createWorkspaceBudgetEnforcer({ maxFiles: 5 }, { maxInputTokens: 8000 });
			const runtime = createRemediationRuntime({
				reviewer: "chain-budget",
				proposalId: "prop-002",
				budgetEnforcer,
			});

			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan("OK");

			// The planning approval chain entry should have a budget snapshot
			const planningEntry = runtime.approvalChain[runtime.approvalChain.length - 1];
			expect(planningEntry.budgetSnapshot).toBeDefined();
			expect(planningEntry.budgetSnapshot!.maxInputTokens).toBe(8000);
			expect(planningEntry.budgetSnapshot!.maxFiles).toBe(5);
		});

		it("chains change request entries", async () => {
			const runtime = createRemediationRuntime({
				reviewer: "chain-cr",
				proposalId: "prop-003",
			});

			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			const cr = await runtime.requestChange("Expand scope", "Need more files");

			// Change request should have chain entry
			const crEntry = runtime.approvalChain[runtime.approvalChain.length - 1];
			expect(crEntry.gate).toBe("change_request");
			expect(crEntry.decision).toBe("requested");
			expect(crEntry.referenceId).toBe(cr.id);

			// Approve the change
			await runtime.approveChange(cr.id, "Approved");

			// Approval should have chain entry
			const approveEntry = runtime.approvalChain[runtime.approvalChain.length - 1];
			expect(approveEntry.gate).toBe("change_request");
			expect(approveEntry.decision).toBe("approved");
			expect(approveEntry.referenceId).toBe(cr.id);
		});

		it("chains self-modification entries", async () => {
			const runtime = createRemediationRuntime({
				reviewer: "chain-sm",
				proposalId: "prop-004",
			});

			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));

			await runtime.recordSelfModificationApproval(true, [".pi/agent/"], "Approved for fix");

			const smEntry = runtime.approvalChain[runtime.approvalChain.length - 1];
			expect(smEntry.gate).toBe("self_modification");
			expect(smEntry.decision).toBe("approved");
			expect(smEntry.referenceId).toBe("prop-004");
		});

		it("snapshot contains full approval chain", async () => {
			const runtime = createRemediationRuntime({
				reviewer: "chain-snap",
				proposalId: "prop-005",
			});

			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan("Approved");
			await runtime.requestDryRun();
			await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
			await runtime.approveExecution("Executed");

			const snap = runtime.snapshot();
			expect(snap.approvalChain).toBeDefined();
			expect(snap.approvalChain!.proposalId).toBe("prop-005");
			expect(snap.approvalChain!.entries.length).toBeGreaterThanOrEqual(3); // proposal + planning + execution
			expect(snap.approvalChain!.startedAt).toBeDefined();
			expect(snap.approvalChain!.completedAt).toBeUndefined(); // Not complete yet

			// Execute to complete
			await runtime.execute(() => Promise.resolve());

			const snapComplete = runtime.snapshot();
			expect(snapComplete.approvalChain!.completedAt).toBeDefined();
		});
	});

	describe("Approval chain without proposal ID", () => {
		it("starts empty when no proposal ID is provided", () => {
			const runtime = createRemediationRuntime({ reviewer: "no-prop" });
			expect(runtime.approvalChain).toHaveLength(0);
		});

		it("builds chain entries without reference IDs", async () => {
			const runtime = createRemediationRuntime({ reviewer: "no-prop" });
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan("OK");

			expect(runtime.approvalChain.length).toBeGreaterThanOrEqual(1);
			const entry = runtime.approvalChain[runtime.approvalChain.length - 1];
			expect(entry.gate).toBe("planning");
			expect(entry.referenceId).toBeUndefined();
		});

		it("snapshot chain has no proposalId when not configured", async () => {
			const runtime = createRemediationRuntime({ reviewer: "no-prop" });
			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan("OK");

			const snap = runtime.snapshot();
			expect(snap.approvalChain).toBeDefined();
			expect(snap.approvalChain!.proposalId).toBeUndefined();
		});
	});

	describe("Chain entries have sequential steps", () => {
		it("increments step numbers correctly", async () => {
			const runtime = createRemediationRuntime({
				reviewer: "step-test",
				proposalId: "prop-006",
			});

			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.approvePlan();

			const steps = runtime.approvalChain.map((e) => e.step);
			expect(steps).toEqual([1, 2]); // proposal submitted, planning approved
		});

		it("resets steps on reset", async () => {
			const runtime = createRemediationRuntime({
				reviewer: "reset-test",
				proposalId: "prop-007",
			});

			await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
			await runtime.rejectPlan("Not needed");
			await runtime.reset();

			expect(runtime.approvalChain).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// Edge Cases — Integration with existing runtime
// ---------------------------------------------------------------------------

describe("P9.G3 Integration with existing runtime", () => {
	it("does not affect existing transition behavior", async () => {
		const runtime = createRemediationRuntime({ reviewer: "existing-test" });
		expect(runtime.state).toBe("idle");

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		expect(runtime.state).toBe("planning_approval_pending");

		await runtime.approvePlan();
		expect(runtime.state).toBe("planning_approved");
	});

	it("survives full lifecycle with P9.G3 features", async () => {
		const budgetEnforcer = createWorkspaceBudgetEnforcer({ maxFiles: 20, maxLines: 1000 }, { maxInputTokens: 15000 });
		const runtime = createRemediationRuntime({
			reviewer: "full-lifecycle",
			proposalId: "prop-full-001",
			budgetEnforcer,
		});

		// Proposal submitted (initial chain entry)
		expect(runtime.approvalChain).toHaveLength(1);

		// Scan and approve plan
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 2 })));
		await runtime.approvePlan("Plan looks good");

		// Submit and approve a change request
		const cr = await runtime.requestChange("Add test coverage", "Tests need updating too");
		await runtime.approveChange(cr.id, "Good addition");

		// Record self-modification approval
		await runtime.recordSelfModificationApproval(true, [".pi/settings.json"], "Allowed");

		// Dry-run and execute
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));
		await runtime.approveExecution("Execute");
		await runtime.execute(() => Promise.resolve());

		// Verify all states
		expect(runtime.state).toBe("complete");
		expect(runtime.approvalStatus.planning.approved).toBe(true);
		expect(runtime.approvalStatus.execution.approved).toBe(true);

		// Verify budget snapshots on all approval events
		expect(runtime.approvalStatus.planning.event!.budgetSnapshot).toBeDefined();
		expect(runtime.approvalStatus.execution.event!.budgetSnapshot).toBeDefined();

		// Verify approval chain is complete
		const snap = runtime.snapshot();
		expect(snap.approvalChain).toBeDefined();
		expect(snap.approvalChain!.proposalId).toBe("prop-full-001");
		expect(snap.approvalChain!.entries.length).toBeGreaterThanOrEqual(5); // proposal + planning + change_req + change_approved + self_mod + execution
		expect(snap.approvalChain!.completedAt).toBeDefined();
		expect(snap.approvalChain!.startedAt).toBeDefined();

		// Verify change requests recorded
		expect(snap.changeRequests).toHaveLength(1);
		expect(snap.changeRequests![0].status).toBe("approved");

		// Verify self-modification approvals recorded
		expect(snap.selfModificationApprovals).toHaveLength(1);
		expect(snap.selfModificationApprovals![0].approved).toBe(true);
	});

	it("reset clears P9.G3 state", async () => {
		const budgetEnforcer = createWorkspaceBudgetEnforcer({}, { maxInputTokens: 5000 });
		const runtime = createRemediationRuntime({
			reviewer: "reset-p9g3",
			proposalId: "prop-reset-001",
			budgetEnforcer,
		});

		// Set up P9.G3 state in valid states
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.requestChange("Test", "Testing");
		await runtime.recordSelfModificationApproval(true, [".pi/"], "Allowed");

		// Now reject the plan to reach a resettable state
		await runtime.rejectPlan("Redo");

		// Reset
		await runtime.reset();

		expect(runtime.approvalChain).toHaveLength(0);
		expect(runtime.changeRequests).toHaveLength(0);
		expect(runtime.selfModificationApprovals).toHaveLength(0);
		expect(runtime.budgetSnapshot).toBeUndefined();
	});
});
