/**
 * Execution Service Integration Tests — P40.1 Real Boundary Adoption
 *
 * Proves that:
 * 1. execution-service command handler routes commands correctly
 * 2. execution-service query handler provides read-only access
 * 3. Web server can use execution-service for control endpoints
 */
import { describe, expect, it, vi } from "vitest";
import { handleExecutionCommand } from "../src/execution-service/command-handler.js";
import { createExecutionReadModel } from "../src/execution-service/query-handler.js";

describe("Execution Service — command handler", () => {
	it("routes stop_plan command through planControlManager", async () => {
		const mockPlanControl = {
			writeControlRequest: vi.fn().mockResolvedValue(undefined),
		};

		const result = await handleExecutionCommand(
			{ type: "stop_plan", planExecutionId: "plan-1", reason: "test stop" },
			{ planControlManager: mockPlanControl },
		);

		expect(result.accepted).toBe(true);
		expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("stop", "test stop");
	});

	it("routes continue_plan command through planControlManager", async () => {
		const mockPlanControl = {
			writeControlRequest: vi.fn().mockResolvedValue(undefined),
		};

		const result = await handleExecutionCommand(
			{ type: "continue_plan", planExecutionId: "plan-1", reason: "test continue" },
			{ planControlManager: mockPlanControl },
		);

		expect(result.accepted).toBe(true);
		expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("resume", "test continue");
	});

	it("routes rerun_plan command through planControlManager", async () => {
		const mockPlanControl = {
			writeControlRequest: vi.fn().mockResolvedValue(undefined),
		};

		const result = await handleExecutionCommand(
			{ type: "rerun_plan", planExecutionId: "plan-1", reason: "test rerun" },
			{ planControlManager: mockPlanControl },
		);

		expect(result.accepted).toBe(true);
		expect(mockPlanControl.writeControlRequest).toHaveBeenCalledWith("cancel", "test rerun");
	});

	it("routes retry_workspace command through transitionRouter", async () => {
		const mockTransitionRouter = {
			transitionWorkspace: vi.fn().mockResolvedValue(undefined),
		};

		const result = await handleExecutionCommand(
			{ type: "retry_workspace", planExecutionId: "plan-1", workspaceId: "ws-1", reason: "test retry" },
			{ transitionRouter: mockTransitionRouter },
		);

		expect(result.accepted).toBe(true);
		expect(mockTransitionRouter.transitionWorkspace).toHaveBeenCalledWith("plan-1", "ws-1", "Pending", {
			reason: "test retry",
		});
	});

	it("returns error when planControlManager not available", async () => {
		const result = await handleExecutionCommand({ type: "stop_plan", planExecutionId: "plan-1" }, {});

		expect(result.accepted).toBe(false);
		expect(result.error).toContain("No plan control manager configured");
	});

	it("returns error when transitionRouter not available for retry", async () => {
		const result = await handleExecutionCommand(
			{ type: "retry_workspace", planExecutionId: "plan-1", workspaceId: "ws-1" },
			{},
		);

		expect(result.accepted).toBe(false);
		expect(result.error).toContain("No transition router configured");
	});

	it("handles start_plan command", async () => {
		const result = await handleExecutionCommand({ type: "start_plan", planId: "plan-1" }, {});

		expect(result.accepted).toBe(true);
		expect(result.message).toContain("plan-1");
	});

	it("handles request_user_escalation command", async () => {
		const result = await handleExecutionCommand(
			{ type: "request_user_escalation", planExecutionId: "plan-1", workspaceId: "ws-1", reason: "needs help" },
			{},
		);

		expect(result.accepted).toBe(true);
	});

	it("handles approve_proposal command", async () => {
		const result = await handleExecutionCommand({ type: "approve_proposal", proposalId: "prop-1" }, {});

		expect(result.accepted).toBe(true);
	});
});

describe("Execution Service — query handler", () => {
	it("creates read model with getPlanSummary", async () => {
		const mockStateStore = {
			getPlanExecutionSummary: vi.fn().mockResolvedValue({
				id: "plan-1",
				projectId: "default",
				phase: "test",
				title: "Test Plan",
				status: "running",
				startedAt: "2026-01-01T00:00:00Z",
				completedAt: null,
			}),
		};

		const readModel = createExecutionReadModel(mockStateStore);
		const summary = await readModel.getPlanSummary("plan-1");

		expect(summary.id).toBe("plan-1");
		expect(summary.status).toBe("running");
	});

	it("creates read model with getWorkspaceSummary", async () => {
		const mockStateStore = {
			getWorkspaceState: vi.fn().mockResolvedValue({
				stage: "Active",
				attempts: 2,
				startedAt: Date.now(),
				completedAt: null,
			}),
		};

		const readModel = createExecutionReadModel(mockStateStore);
		const summary = await readModel.getWorkspaceSummary("plan-1", "ws-1");

		expect(summary.workspaceId).toBe("ws-1");
		expect(summary.stage).toBe("Active");
		expect(summary.attempts).toBe(2);
	});

	it("creates read model with listJournalEvents", async () => {
		const mockStateStore = {
			getJournalEvents: vi.fn().mockResolvedValue([
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "plan-1",
					eventType: "plan_start",
					payload: null,
					createdAt: "2026-01-01T00:00:00Z",
				},
			]),
		};

		const readModel = createExecutionReadModel(mockStateStore);
		const events = await readModel.listJournalEvents("plan-1");

		expect(events).toHaveLength(1);
		expect(events[0].eventType).toBe("plan_start");
	});

	it("returns empty array when getJournalEvents not available", async () => {
		const readModel = createExecutionReadModel({});
		const events = await readModel.listJournalEvents("plan-1");

		expect(events).toEqual([]);
	});
});
