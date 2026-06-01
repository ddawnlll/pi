/**
 * Brain Execution Read Client tests — P41.09 Lead Agent Escalation Surface
 *
 * Tests for BrainExecutionReadClient covering:
 * - getLeadDirectives
 * - getLeadEscalations
 * - Delegation to underlying ExecutionReadModel
 */

import type { ExecutionReadModel, LeadDirectiveView, LeadEscalationView } from "@earendil-works/pi-execution-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrainExecutionReadClient } from "../src/execution-read-client.js";

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

describe("BrainExecutionReadClient", () => {
	let mockReadModel: ExecutionReadModel;
	let client: BrainExecutionReadClient;

	beforeEach(() => {
		mockReadModel = createMockReadModel();
		client = new BrainExecutionReadClient(mockReadModel);
	});

	// -----------------------------------------------------------------------
	// getLeadDirectives
	// -----------------------------------------------------------------------

	describe("getLeadDirectives", () => {
		it("should return directives from the read model", async () => {
			const mockDirectives: LeadDirectiveView[] = [
				{
					workspaceId: "ws-1",
					directiveId: "dir-1",
					directiveType: "constrain_tools",
					attemptNumber: 2,
					severity: "medium",
					summary: "Limit write access",
					directive: "Only allow file reads",
					allowedActions: ["read_file"],
					forbiddenActions: ["write_file", "install_deps"],
					retryBudget: 1,
					escalateAfter: 2,
					status: "acknowledged",
					createdAt: new Date().toISOString(),
				},
			];

			(mockReadModel.getLeadDirectives as any).mockResolvedValue(mockDirectives);

			const result = await client.getLeadDirectives("exec-1", "ws-1");

			expect(result).toEqual(mockDirectives);
			expect(mockReadModel.getLeadDirectives).toHaveBeenCalledWith("exec-1", "ws-1");
		});

		it("should return empty array when no directives exist", async () => {
			(mockReadModel.getLeadDirectives as any).mockResolvedValue([]);

			const result = await client.getLeadDirectives("exec-1", "ws-1");

			expect(result).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// getLeadEscalations
	// -----------------------------------------------------------------------

	describe("getLeadEscalations", () => {
		it("should return escalations from the read model", async () => {
			const mockEscalations: LeadEscalationView[] = [
				{
					escalationId: "esc-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					severity: "high",
					title: "Build failure escalation",
					summary: "Build step failed 3 times",
					whatHappened: "npm install fails with EACCES",
					whyStuck: "Permission issue requires manual fix",
					options: [
						{ id: "opt-1", label: "Fix permissions", risk: "low" },
						{ id: "opt-2", label: "Skip workspace", risk: "medium" },
					],
					recommendedOptionId: "opt-1",
					evidenceRefs: ["run-1", "run-2", "run-3"],
					logsToInspect: ["/logs/build.log"],
					status: "awaiting_user",
					createdAt: new Date().toISOString(),
				},
			];

			(mockReadModel.getLeadEscalations as any).mockResolvedValue(mockEscalations);

			const result = await client.getLeadEscalations("exec-1", "ws-1");

			expect(result).toEqual(mockEscalations);
			expect(mockReadModel.getLeadEscalations).toHaveBeenCalledWith("exec-1", "ws-1");
		});

		it("should return empty array when no escalations exist", async () => {
			(mockReadModel.getLeadEscalations as any).mockResolvedValue([]);

			const result = await client.getLeadEscalations("exec-1", "ws-1");

			expect(result).toEqual([]);
		});
	});
});
