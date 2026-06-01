/**
 * Brain Boundary tests — P41.09 Lead Agent Escalation Surface
 *
 * Tests for BrainBoundary covering:
 * - createEscalationProposal
 * - createDirectiveProposal
 * - createInvestigateProposal
 * - getDirectives / getEscalations
 */

import type { ExecutionReadModel, LeadDirectiveView, LeadEscalationView } from "@earendil-works/pi-execution-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrainBoundary } from "../src/boundary.js";

// -----------------------------------------------------------------------
// Mock ExecutionReadModel
// -----------------------------------------------------------------------

function createMockReadModel(): ExecutionReadModel {
	return {
		getPlanSummary: vi.fn(),
		getWorkspaceSummary: vi.fn(),
		listJournalEvents: vi.fn(),
		getCommandHistory: vi.fn(),
		getLeadDirectives: vi.fn(),
		getLeadEscalations: vi.fn(),
		getFinalValidationStatus: vi.fn(),
		getChangedFiles: vi.fn(),
		getFileTree: vi.fn(),
		getFileContent: vi.fn(),
		getFileDiff: vi.fn(),
	} as unknown as ExecutionReadModel;
}

describe("BrainBoundary", () => {
	let mockReadModel: ExecutionReadModel;
	let boundary: BrainBoundary;

	beforeEach(() => {
		mockReadModel = createMockReadModel();
		boundary = new BrainBoundary({ executionReadModel: mockReadModel });
	});

	// -----------------------------------------------------------------------
	// createEscalationProposal
	// -----------------------------------------------------------------------

	describe("createEscalationProposal", () => {
		it("should create a notify-type proposal with escalation details", () => {
			const proposal = boundary.createEscalationProposal({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				summary: "Workspace stuck after 3 retries",
				rationale: "All retries failed with same completion gate block",
				evidenceRefs: ["run-1", "run-2", "run-3"],
				title: "Workspace ws-1 requires human intervention",
				whatHappened: "Worker failed 3 consecutive attempts",
				whyStuck: "Target command always fails with same error signature",
				options: [
					{ id: "opt-1", label: "Retry with fix", risk: "low" },
					{ id: "opt-2", label: "Skip workspace", risk: "medium", description: "Mark as skipped" },
				],
				recommendedOptionId: "opt-1",
				logsToInspect: ["/logs/ws-1/attempt-3.log"],
			});

			expect(proposal.type).toBe("notify");
			expect(proposal.summary).toBe("Workspace stuck after 3 retries");
			expect(proposal.rationale).toBe("All retries failed with same completion gate block");
			expect(proposal.evidenceRefs).toEqual(["run-1", "run-2", "run-3"]);
			expect(proposal.id).toBeDefined();
			expect(proposal.id).toMatch(/^proposal-/);
		});

		it("should include a request_user_escalation command in the proposal", () => {
			const proposal = boundary.createEscalationProposal({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				summary: "Need human help",
				rationale: "Cannot proceed automatically",
				evidenceRefs: [],
				title: "Help needed",
				whatHappened: "Something went wrong",
				whyStuck: "We don't know how to fix this",
				options: [{ id: "opt-1", label: "Manual fix", risk: "low" }],
				recommendedOptionId: "opt-1",
				logsToInspect: [],
			});

			expect(proposal.proposedCommand).toBeDefined();
			expect(proposal.proposedCommand!.type).toBe("request_user_escalation");
			expect((proposal.proposedCommand! as any).planExecutionId).toBe("exec-1");
			expect((proposal.proposedCommand! as any).workspaceId).toBe("ws-1");
		});
	});

	// -----------------------------------------------------------------------
	// createDirectiveProposal
	// -----------------------------------------------------------------------

	describe("createDirectiveProposal", () => {
		it("should create a draft_plan-type proposal with directive constraints", () => {
			const proposal = boundary.createDirectiveProposal({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				summary: "Retry build step with limited tool access",
				rationale: "Previous failure due to unintended dependency install",
				evidenceRefs: ["run-2"],
				directive: "Only run npm build, do not install new packages",
				allowedActions: ["inspect_file", "run_npm_build"],
				forbiddenActions: ["install_new_deps", "modify_package_json"],
				maxAdditionalRetries: 2,
				escalateAfter: 3,
			});

			expect(proposal.type).toBe("draft_plan");
			expect(proposal.summary).toBe("Retry build step with limited tool access");
			expect(proposal.rationale).toBe("Previous failure due to unintended dependency install");
			expect(proposal.evidenceRefs).toEqual(["run-2"]);
			expect(proposal.id).toBeDefined();
			expect(proposal.id).toMatch(/^proposal-/);
		});

		it("should include a continue_plan command in the proposal", () => {
			const proposal = boundary.createDirectiveProposal({
				planExecutionId: "exec-1",
				workspaceId: "ws-1",
				summary: "Continue with caution",
				rationale: "Failure was transient",
				evidenceRefs: [],
				directive: "Proceed with original plan",
				allowedActions: [],
				forbiddenActions: [],
				maxAdditionalRetries: 1,
				escalateAfter: 2,
			});

			expect(proposal.proposedCommand).toBeDefined();
			expect(proposal.proposedCommand!.type).toBe("continue_plan");
			expect((proposal.proposedCommand! as any).planExecutionId).toBe("exec-1");
		});
	});

	// -----------------------------------------------------------------------
	// createInvestigateProposal
	// -----------------------------------------------------------------------

	describe("createInvestigateProposal", () => {
		it("should create an investigate-type proposal", () => {
			const proposal = boundary.createInvestigateProposal({
				summary: "Need more info before deciding",
				rationale: "Failure cause is ambiguous",
				evidenceRefs: ["run-1", "run-2"],
			});

			expect(proposal.type).toBe("investigate");
			expect(proposal.summary).toBe("Need more info before deciding");
			expect(proposal.rationale).toBe("Failure cause is ambiguous");
			expect(proposal.evidenceRefs).toEqual(["run-1", "run-2"]);
			expect(proposal.id).toBeDefined();
		});

		it("should not include a proposed command for investigate proposals", () => {
			const proposal = boundary.createInvestigateProposal({
				summary: "Investigate failure",
				rationale: "Unknown error",
				evidenceRefs: [],
			});

			expect(proposal.proposedCommand).toBeUndefined();
		});
	});

	// -----------------------------------------------------------------------
	// getDirectives
	// -----------------------------------------------------------------------

	describe("getDirectives", () => {
		it("should delegate to the execution read model", async () => {
			const expectedDirectives: LeadDirectiveView[] = [
				{
					workspaceId: "ws-1",
					directiveId: "dir-1",
					directiveType: "retry_with_constraints",
					attemptNumber: 2,
					severity: "high",
					summary: "Fix build script",
					directive: "Update package.json scripts",
					allowedActions: ["inspect_file"],
					forbiddenActions: ["install_deps"],
					retryBudget: 2,
					escalateAfter: 3,
					status: "issued",
					createdAt: new Date().toISOString(),
				},
			];

			(mockReadModel.getLeadDirectives as any).mockResolvedValue(expectedDirectives);

			const result = await boundary.getDirectives("exec-1", "ws-1");

			expect(result).toEqual(expectedDirectives);
			expect(mockReadModel.getLeadDirectives).toHaveBeenCalledWith("exec-1", "ws-1");
		});

		it("should return empty array when no directives exist", async () => {
			(mockReadModel.getLeadDirectives as any).mockResolvedValue([]);

			const result = await boundary.getDirectives("exec-1", "ws-1");

			expect(result).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// getEscalations
	// -----------------------------------------------------------------------

	describe("getEscalations", () => {
		it("should delegate to the execution read model", async () => {
			const expectedEscalations: LeadEscalationView[] = [
				{
					escalationId: "esc-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					severity: "blocking",
					title: "Workspace stuck",
					summary: "Failed 3 times",
					whatHappened: "All attempts failed",
					whyStuck: "Same error each time",
					options: [{ id: "opt-1", label: "Retry", risk: "low" }],
					recommendedOptionId: "opt-1",
					evidenceRefs: ["run-3"],
					logsToInspect: ["/logs/attempt-3.log"],
					status: "awaiting_user",
					createdAt: new Date().toISOString(),
				},
			];

			(mockReadModel.getLeadEscalations as any).mockResolvedValue(expectedEscalations);

			const result = await boundary.getEscalations("exec-1", "ws-1");

			expect(result).toEqual(expectedEscalations);
			expect(mockReadModel.getLeadEscalations).toHaveBeenCalledWith("exec-1", "ws-1");
		});

		it("should return empty array when no escalations exist", async () => {
			(mockReadModel.getLeadEscalations as any).mockResolvedValue([]);

			const result = await boundary.getEscalations("exec-1", "ws-1");

			expect(result).toEqual([]);
		});
	});
});
