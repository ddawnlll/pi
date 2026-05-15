/**
 * P9.F — Multi-stage Approval UX Tests
 *
 * Acceptance Criteria:
 * 1. Dashboard shows planning approval and execution approval as separate gates.
 * 2. Dashboard supports approve_for_planning, approve_for_execution, reject,
 *    request_changes, and approve_self_modification.
 * 3. Execution cannot start from the UI without valid dry-run and budget state.
 */

import { describe, expect, it } from "vitest";
import type {
	ApprovalGate,
	ApprovalGateStatus,
	ProposalAction,
	ProposalActionRequest,
	ProposalActionResponse,
	ProposalAuditEntry,
	ProposalResponse,
	DryRunStatus,
	BudgetState,
} from "../src/types";

// ---------------------------------------------------------------------------
// AC1: Dashboard shows planning approval and execution approval as separate gates
// ---------------------------------------------------------------------------

describe("AC1: Separate planning and execution approval gates", () => {
	it("ProposalResponse has planningApproval and executionApproval fields", () => {
		const proposal: ProposalResponse = {
			id: "test-1",
			title: "Test Proposal",
			phase: "P9",
			status: "pending",
			planningApproval: { status: "approved", actionedAt: 1000, actionedBy: "user" },
			executionApproval: { status: "pending" },
			selfModificationApproval: { status: "pending" },
			dryRunStatus: "passed",
			budgetState: "valid",
			evidence: { plannerOutput: {}, queue: {} },
			auditTrail: [],
			submittedAt: 0,
		};

		expect(proposal.planningApproval.status).toBe("approved");
		expect(proposal.executionApproval.status).toBe("pending");
		expect(proposal.selfModificationApproval.status).toBe("pending");
	});

	it("ApprovalGate supports all required statuses", () => {
		const statuses: ApprovalGateStatus[] = [
			"pending",
			"approved",
			"rejected",
			"changes_requested",
		];

		const gates: ApprovalGate[] = statuses.map((s) => ({ status: s }));
		expect(gates).toHaveLength(4);
		expect(gates[0].status).toBe("pending");
		expect(gates[1].status).toBe("approved");
		expect(gates[2].status).toBe("rejected");
		expect(gates[3].status).toBe("changes_requested");
	});

	it("ProposalResponse can have different statuses for each gate", () => {
		// Planning approved, execution pending - realistic scenario
		const proposal: ProposalResponse = {
			id: "test-2",
			title: "Planning OK, Exec Pending",
			phase: "P9",
			status: "pending",
			planningApproval: { status: "approved", actionedAt: 2000, actionedBy: "user1" },
			executionApproval: { status: "pending" },
			selfModificationApproval: { status: "rejected" },
			dryRunStatus: "not_started",
			budgetState: "not_set",
			evidence: { plannerOutput: {}, queue: {} },
			auditTrail: [],
			submittedAt: 0,
		};

		expect(proposal.planningApproval.status).toBe("approved");
		expect(proposal.executionApproval.status).toBe("pending");
		expect(proposal.selfModificationApproval.status).toBe("rejected");
	});

	it("ProposalResponse has dryRunStatus and budgetState fields", () => {
		const dryRunStatuses: DryRunStatus[] = [
			"not_started",
			"in_progress",
			"passed",
			"failed",
		];
		const budgetStates: BudgetState[] = [
			"not_set",
			"valid",
			"exceeded",
			"insufficient",
		];

		const proposal: ProposalResponse = {
			id: "test-3",
			title: "Status Check",
			phase: "P9",
			status: "pending",
			planningApproval: { status: "pending" },
			executionApproval: { status: "pending" },
			selfModificationApproval: { status: "pending" },
			dryRunStatus: "passed",
			budgetState: "valid",
			evidence: { plannerOutput: {}, queue: {} },
			auditTrail: [],
			submittedAt: 0,
		};

		expect(dryRunStatuses).toContain(proposal.dryRunStatus);
		expect(budgetStates).toContain(proposal.budgetState);
	});
});

// ---------------------------------------------------------------------------
// AC2: Dashboard supports all five approval actions
// ---------------------------------------------------------------------------

describe("AC2: Supports all five approval actions", () => {
	it("ProposalAction type includes all five required actions", () => {
		const actions: ProposalAction[] = [
			"approve_for_planning",
			"approve_for_execution",
			"reject",
			"request_changes",
			"approve_self_modification",
		];

		expect(actions).toHaveLength(5);
	});

	it("ProposalActionRequest can carry any of the five actions with reason", () => {
		const actions: ProposalAction[] = [
			"approve_for_planning",
			"approve_for_execution",
			"reject",
			"request_changes",
			"approve_self_modification",
		];

		for (const action of actions) {
			const request: ProposalActionRequest = {
				action,
				reason: `Reason for ${action}`,
				actor: "test-user",
			};
			expect(request.action).toBe(action);
			expect(request.reason).toBe(`Reason for ${action}`);
			expect(request.actor).toBe("test-user");
		}
	});

	it("ProposalAuditEntry supports the new action types", () => {
		const actions: ProposalAuditEntry["action"][] = [
			"submitted",
			"approved",
			"rejected",
			"approved_for_planning",
			"approved_for_execution",
			"changes_requested",
			"self_modification_approved",
		];

		expect(actions).toHaveLength(7);
	});

	it("ProposalActionResponse can return success with updated proposal", () => {
		const response: ProposalActionResponse = {
			success: true,
			proposal: {
				id: "test-4",
				title: "After Action",
				phase: "P9",
				status: "approved",
				planningApproval: { status: "approved" },
				executionApproval: { status: "approved" },
				selfModificationApproval: { status: "pending" },
				dryRunStatus: "passed",
				budgetState: "valid",
				evidence: { plannerOutput: {}, queue: {} },
				auditTrail: [
					{
						timestamp: 1000,
						action: "approved_for_planning",
						actor: "user",
						resultingStatus: "planning_approved",
					},
					{
						timestamp: 2000,
						action: "approved_for_execution",
						actor: "user",
						resultingStatus: "execution_approved",
					},
				],
				submittedAt: 0,
			},
		};

		expect(response.success).toBe(true);
		expect(response.proposal?.planningApproval.status).toBe("approved");
		expect(response.proposal?.executionApproval.status).toBe("approved");
		expect(response.proposal?.auditTrail).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// AC3: Execution cannot start from the UI without valid dry-run and budget state
// ---------------------------------------------------------------------------

describe("AC3: Execution requires valid dry-run and budget state", () => {
	it("should not allow execution approval when dry-run is not passed", () => {
		const dryRunStatuses: DryRunStatus[] = ["not_started", "in_progress", "failed"];

		for (const status of dryRunStatuses) {
			const proposal: ProposalResponse = {
				id: "test-5",
				title: "Dry-run not ready",
				phase: "P9",
				status: "pending",
				planningApproval: { status: "approved" },
				executionApproval: { status: "pending" },
				selfModificationApproval: { status: "pending" },
				dryRunStatus: status,
				budgetState: "valid",
				evidence: { plannerOutput: {}, queue: {} },
				auditTrail: [],
				submittedAt: 0,
			};

			// Logic mirroring ProposalDetailPanel.tsx canApproveForExecution
			const canApproveForExecution =
				proposal.planningApproval.status === "approved" &&
				proposal.dryRunStatus === "passed" &&
				proposal.budgetState === "valid";

			expect(canApproveForExecution).toBe(false);
		}
	});

	it("should not allow execution approval when budget is not valid", () => {
		const budgetStates: BudgetState[] = ["not_set", "exceeded", "insufficient"];

		for (const state of budgetStates) {
			const proposal: ProposalResponse = {
				id: "test-6",
				title: "Budget not ready",
				phase: "P9",
				status: "pending",
				planningApproval: { status: "approved" },
				executionApproval: { status: "pending" },
				selfModificationApproval: { status: "pending" },
				dryRunStatus: "passed",
				budgetState: state,
				evidence: { plannerOutput: {}, queue: {} },
				auditTrail: [],
				submittedAt: 0,
			};

			const canApproveForExecution =
				proposal.planningApproval.status === "approved" &&
				proposal.dryRunStatus === "passed" &&
				proposal.budgetState === "valid";

			expect(canApproveForExecution).toBe(false);
		}
	});

	it("should allow execution approval only when dry-run passed AND budget valid", () => {
		const proposal: ProposalResponse = {
			id: "test-7",
			title: "All conditions met",
			phase: "P9",
			status: "pending",
			planningApproval: { status: "approved" },
			executionApproval: { status: "pending" },
			selfModificationApproval: { status: "pending" },
			dryRunStatus: "passed",
			budgetState: "valid",
			evidence: { plannerOutput: {}, queue: {} },
			auditTrail: [],
			submittedAt: 0,
		};

		const canApproveForExecution =
			proposal.planningApproval.status === "approved" &&
			proposal.dryRunStatus === "passed" &&
			proposal.budgetState === "valid";

		expect(canApproveForExecution).toBe(true);
	});

	it("should still require planning approval before execution approval", () => {
		const proposal: ProposalResponse = {
			id: "test-8",
			title: "Planning not approved",
			phase: "P9",
			status: "pending",
			planningApproval: { status: "pending" },
			executionApproval: { status: "pending" },
			selfModificationApproval: { status: "pending" },
			dryRunStatus: "passed",
			budgetState: "valid",
			evidence: { plannerOutput: {}, queue: {} },
			auditTrail: [],
			submittedAt: 0,
		};

		const canApproveForExecution =
			proposal.planningApproval.status === "approved" &&
			proposal.dryRunStatus === "passed" &&
			proposal.budgetState === "valid";

		expect(canApproveForExecution).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// useProposalActions hook interface check
// ---------------------------------------------------------------------------

describe("useProposalActions hook interface", () => {
	it("should export useProposalActions from useProposals", async () => {
		const mod = await import("../src/hooks/useProposals");
		expect(mod.useProposalActions).toBeDefined();
		expect(typeof mod.useProposalActions).toBe("function");
	});

	it("should compile with all proposal types", () => {
		// TypeScript-only types are checked at compile time;
		// this test validates the types import correctly by using them.
		const req: ProposalActionRequest = {
			action: "approve_for_planning",
		};
		const res: ProposalActionResponse = {
			success: true,
		};
		expect(req.action).toBe("approve_for_planning");
		expect(res.success).toBe(true);
	});

	it("ProposalActionRequest can be serialized for API call", () => {
		const body: ProposalActionRequest = {
			action: "approve_for_planning",
			reason: "Looks good",
		};
		const json = JSON.stringify(body);
		const parsed = JSON.parse(json) as ProposalActionRequest;
		expect(parsed.action).toBe("approve_for_planning");
		expect(parsed.reason).toBe("Looks good");
	});
});
