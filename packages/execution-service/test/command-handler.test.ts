/**
 * Command Handler Tests — P41.11 Control Actions API
 *
 * Tests for the full set of ExecutionCommand handlers.
 * Every command type defined in execution-contracts's commands.ts must be handled.
 */
import { describe, expect, it, vi } from "vitest";
import { handleExecutionCommand } from "../src/command-handler.js";

describe("handleExecutionCommand — Control Actions API", () => {
	describe("start_plan", () => {
		it("accepts start_plan without deps", async () => {
			const result = await handleExecutionCommand({ type: "start_plan", planId: "plan-1" }, {});
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("plan-1");
		});
	});

	describe("stop_plan", () => {
		it("routes through planControlManager when available", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{ type: "stop_plan", planExecutionId: "plan-1", reason: "stop it" },
				{ planControlManager: mockPlanControl },
			);
			expect(result.accepted).toBe(true);
			expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("stop", "stop it");
		});

		it("returns error when planControlManager not available", async () => {
			const result = await handleExecutionCommand({ type: "stop_plan", planExecutionId: "plan-1" }, {});
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No plan control manager configured");
		});
	});

	describe("continue_plan", () => {
		it("routes through planControlManager when available", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{ type: "continue_plan", planExecutionId: "plan-1", reason: "resume it" },
				{ planControlManager: mockPlanControl },
			);
			expect(result.accepted).toBe(true);
			expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("resume", "resume it");
		});

		it("returns error when planControlManager not available", async () => {
			const result = await handleExecutionCommand({ type: "continue_plan", planExecutionId: "plan-1" }, {});
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No plan control manager configured");
		});
	});

	describe("rerun_plan", () => {
		it("routes through planControlManager when available", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{ type: "rerun_plan", planExecutionId: "plan-1", reason: "rerun it" },
				{ planControlManager: mockPlanControl },
			);
			expect(result.accepted).toBe(true);
			expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("cancel", "rerun it");
		});

		it("uses default reason when not provided", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			await handleExecutionCommand(
				{ type: "rerun_plan", planExecutionId: "plan-1" },
				{ planControlManager: mockPlanControl },
			);
			expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("cancel", "rerun requested");
		});

		it("returns error when planControlManager not available", async () => {
			const result = await handleExecutionCommand({ type: "rerun_plan", planExecutionId: "plan-1" }, {});
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No plan control manager configured");
		});
	});

	describe("retry_workspace", () => {
		it("routes through transitionRouter when available", async () => {
			const mockTransitionRouter = {
				transitionWorkspace: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{ type: "retry_workspace", planExecutionId: "plan-1", workspaceId: "ws-1", reason: "retry it" },
				{ transitionRouter: mockTransitionRouter },
			);
			expect(result.accepted).toBe(true);
			expect(mockTransitionRouter.transitionWorkspace).toHaveBeenCalledWith("plan-1", "ws-1", "Pending", {
				reason: "retry it",
			});
		});

		it("returns error when transitionRouter not available", async () => {
			const result = await handleExecutionCommand(
				{ type: "retry_workspace", planExecutionId: "plan-1", workspaceId: "ws-1" },
				{},
			);
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No transition router configured");
		});
	});

	describe("request_user_escalation", () => {
		it("accepts without deps", async () => {
			const result = await handleExecutionCommand(
				{ type: "request_user_escalation", planExecutionId: "plan-1", workspaceId: "ws-1", reason: "stuck" },
				{},
			);
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("ws-1");
		});
	});

	describe("approve_proposal", () => {
		it("accepts without deps", async () => {
			const result = await handleExecutionCommand({ type: "approve_proposal", proposalId: "prop-1" }, {});
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("prop-1");
		});
	});

	describe("acknowledge_directive", () => {
		it("routes through directiveManager when available", async () => {
			const mockDirectiveManager = {
				acknowledgeDirective: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{
					type: "acknowledge_directive",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					directiveId: "dir-1",
					attemptNumber: 2,
				},
				{ directiveManager: mockDirectiveManager },
			);
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("dir-1");
			expect(result.message).toContain("ws-1");
			expect(mockDirectiveManager.acknowledgeDirective).toHaveBeenCalledWith("plan-1", "ws-1", "dir-1", 2);
		});

		it("returns error when directiveManager not available", async () => {
			const result = await handleExecutionCommand(
				{
					type: "acknowledge_directive",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					directiveId: "dir-1",
					attemptNumber: 1,
				},
				{},
			);
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No directive manager configured");
		});
	});

	describe("resolve_escalation", () => {
		it("routes through escalationManager when available", async () => {
			const mockEscalationManager = {
				resolveEscalation: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{
					type: "resolve_escalation",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					escalationId: "esc-1",
					chosenOptionId: "opt-retry",
					userResponse: "Please retry with more caution",
				},
				{ escalationManager: mockEscalationManager },
			);
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("esc-1");
			expect(result.message).toContain("opt-retry");
			expect(mockEscalationManager.resolveEscalation).toHaveBeenCalledWith(
				"plan-1",
				"ws-1",
				"esc-1",
				"opt-retry",
				"Please retry with more caution",
			);
		});

		it("handles resolve_escalation without userResponse", async () => {
			const mockEscalationManager = {
				resolveEscalation: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{
					type: "resolve_escalation",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					escalationId: "esc-2",
					chosenOptionId: "opt-cancel",
				},
				{ escalationManager: mockEscalationManager },
			);
			expect(result.accepted).toBe(true);
			expect(mockEscalationManager.resolveEscalation).toHaveBeenCalledWith(
				"plan-1",
				"ws-1",
				"esc-2",
				"opt-cancel",
				undefined,
			);
		});

		it("returns error when escalationManager not available", async () => {
			const result = await handleExecutionCommand(
				{
					type: "resolve_escalation",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					escalationId: "esc-1",
					chosenOptionId: "opt-retry",
				},
				{},
			);
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No escalation manager configured");
		});
	});

	describe("issue_human_directive", () => {
		it("routes through planControlManager when available", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{
					type: "issue_human_directive",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					directive: "Do not touch src/config.ts",
					severity: "high",
					directiveId: "hd-1",
				},
				{ planControlManager: mockPlanControl },
			);
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("ws-1");

			// Verify the control request was written with the directive payload
			const callArg = mockPlanControl.writeControlRequest.mock.calls[0];
			expect(callArg[0]).toBe("human_directive");
			const parsedPayload = JSON.parse(callArg[1]);
			expect(parsedPayload.workspaceId).toBe("ws-1");
			expect(parsedPayload.directive).toBe("Do not touch src/config.ts");
			expect(parsedPayload.severity).toBe("high");
			expect(parsedPayload.directiveId).toBe("hd-1");
		});

		it("uses default severity when not provided", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			await handleExecutionCommand(
				{
					type: "issue_human_directive",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					directive: "Be careful",
				},
				{ planControlManager: mockPlanControl },
			);
			const callArg = mockPlanControl.writeControlRequest.mock.calls[0];
			const parsedPayload = JSON.parse(callArg[1]);
			expect(parsedPayload.severity).toBe("medium");
		});

		it("returns error when planControlManager not available", async () => {
			const result = await handleExecutionCommand(
				{
					type: "issue_human_directive",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					directive: "Be careful",
				},
				{},
			);
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No plan control manager configured");
		});
	});

	describe("intervene_workspace", () => {
		it("routes through planControlManager when available", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{
					type: "intervene_workspace",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					action: "stop",
					reason: "User requested stop",
				},
				{ planControlManager: mockPlanControl },
			);
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("stop");
			expect(result.message).toContain("ws-1");

			const callArg = mockPlanControl.writeControlRequest.mock.calls[0];
			expect(callArg[0]).toBe("stop");
			const parsedPayload = JSON.parse(callArg[1]);
			expect(parsedPayload.workspaceId).toBe("ws-1");
			expect(parsedPayload.reason).toBe("User requested stop");
		});

		it("handles pause intervention", async () => {
			const mockPlanControl = {
				writeControlRequest: vi.fn().mockResolvedValue(undefined),
			};
			const result = await handleExecutionCommand(
				{
					type: "intervene_workspace",
					planExecutionId: "plan-1",
					workspaceId: "ws-2",
					action: "pause",
				},
				{ planControlManager: mockPlanControl },
			);
			expect(result.accepted).toBe(true);
			expect(result.message).toContain("pause");
			expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("pause", expect.any(String));
		});

		it("returns error when planControlManager not available", async () => {
			const result = await handleExecutionCommand(
				{
					type: "intervene_workspace",
					planExecutionId: "plan-1",
					workspaceId: "ws-1",
					action: "stop",
				},
				{},
			);
			expect(result.accepted).toBe(false);
			expect(result.error).toContain("No plan control manager configured");
		});
	});

	describe("unknown command type", () => {
		it("returns error for unrecognized command type", async () => {
			const result = await handleExecutionCommand({ type: "nonexistent_command" as any, planId: "x" }, {});
			expect(result.accepted).toBe(false);
			expect(result.error).toBe("Unhandled command type");
		});
	});
});
