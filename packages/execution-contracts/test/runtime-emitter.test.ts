/**
 * Runtime Event Emitter tests — P41.03
 *
 * Tests for RuntimeEventEmitter covering:
 * - Generic emit method
 * - All typed emit methods (plan, workspace, worker, command, brain, governance, system)
 * - Child derivation
 * - WorkerEvent bridging
 * - Error cases
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandLogEntry } from "../src/command-log-stream.js";
import { InMemoryCommandLogStream } from "../src/command-log-stream.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { RuntimeEventEmitter } from "../src/runtime-emitter.js";
import type { WorkerEvent } from "../src/worker-adapter.js";

describe("RuntimeEventEmitter", () => {
	let store: InMemoryEventStore;
	let emitter: RuntimeEventEmitter;
	const planExecutionId = "exec-1";

	beforeEach(() => {
		store = new InMemoryEventStore();
		emitter = new RuntimeEventEmitter(store, planExecutionId);
	});

	// -----------------------------------------------------------------------
	// Generic emit
	// -----------------------------------------------------------------------

	describe("emit (generic)", () => {
		it("should emit a system_info event and return an eventId", async () => {
			const eventId = await emitter.emit("system_info", {
				message: "hello",
				planExecutionId,
			});

			expect(eventId).toBeDefined();
			expect(typeof eventId).toBe("string");

			const envelope = await store.getEvent(eventId);
			expect(envelope).not.toBeNull();
			expect(envelope!.eventType).toBe("system_info");
			expect(envelope!.payload!.message).toBe("hello");
			expect(envelope!.planExecutionId).toBe(planExecutionId);
		});

		it("should scope events to the emitter's workspaceId", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId, "ws-1");

			const eventId = await wsEmitter.emit("system_info", {
				message: "scoped",
				planExecutionId,
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.workspaceId).toBe("ws-1");
		});

		it("should allow override of workspaceId per emit call", async () => {
			const eventId = await emitter.emit("system_info", { message: "overridden", planExecutionId }, "ws-override");

			const envelope = await store.getEvent(eventId);
			expect(envelope!.workspaceId).toBe("ws-override");
		});

		it("should auto-populate a valid timestamp", async () => {
			const before = Date.now();
			const eventId = await emitter.emit("system_info", {
				message: "timing",
				planExecutionId,
			});
			const after = Date.now();

			const envelope = await store.getEvent(eventId);
			const createdAt = new Date(envelope!.createdAt).getTime();
			expect(createdAt).toBeGreaterThanOrEqual(before);
			expect(createdAt).toBeLessThanOrEqual(after);
		});
	});

	// -----------------------------------------------------------------------
	// Plan events
	// -----------------------------------------------------------------------

	describe("plan event emitters", () => {
		it("should emit plan_started", async () => {
			const eventId = await emitter.emitPlanStarted({
				planId: "plan-1",
				planExecutionId,
				phase: "phase-1",
				title: "Test Plan",
				totalWorkspaces: 3,
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("plan_started");
			expect(envelope!.payload!.totalWorkspaces).toBe(3);
		});

		it("should emit plan_completed", async () => {
			const eventId = await emitter.emitPlanCompleted({
				planExecutionId,
				completedWorkspaces: 3,
				failedWorkspaces: 0,
				durationMs: 15000,
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("plan_completed");
			expect(envelope!.payload!.durationMs).toBe(15000);
		});

		it("should emit plan_failed", async () => {
			const eventId = await emitter.emitPlanFailed({
				planExecutionId,
				reason: "Too many errors",
				failedWorkspaces: 2,
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("plan_failed");
			expect(envelope!.payload!.reason).toBe("Too many errors");
		});

		it("should emit plan_paused", async () => {
			const eventId = await emitter.emitPlanPaused({
				planExecutionId,
				reason: "User interrupt",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("plan_paused");
		});

		it("should emit plan_resumed", async () => {
			const eventId = await emitter.emitPlanResumed({
				planExecutionId,
				reason: "User continue",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("plan_resumed");
		});

		it("should emit plan_cancelled", async () => {
			const eventId = await emitter.emitPlanCancelled({
				planExecutionId,
				reason: "Cancelled by operator",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("plan_cancelled");
		});

		it("should emit plan_stopped", async () => {
			const eventId = await emitter.emitPlanStopped({
				planExecutionId,
				reason: "Shutdown",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("plan_stopped");
		});
	});

	// -----------------------------------------------------------------------
	// Workspace events
	// -----------------------------------------------------------------------

	describe("workspace event emitters", () => {
		const basePayload = {
			planExecutionId,
			workspaceId: "ws-1",
			workspaceExecutionId: "ws-exec-1",
			fromStage: "Pending" as const,
			toStage: "Running" as const,
			attemptNumber: 1,
		};

		it("should emit workspace_running via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("Running", {
				...basePayload,
				toStage: "Running",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_running");
		});

		it("should emit workspace_completed via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("Complete", {
				...basePayload,
				fromStage: "Running",
				toStage: "Complete",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_completed");
		});

		it("should emit workspace_failed via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("Failed", {
				...basePayload,
				fromStage: "Running",
				toStage: "Failed",
				error: "Script error",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_failed");
			expect(envelope!.payload!.error).toBe("Script error");
		});

		it("should emit workspace_blocked via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("Blocked", {
				...basePayload,
				fromStage: "Pending",
				toStage: "Blocked",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_blocked");
		});

		it("should emit workspace_cancelled via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("Cancelled", {
				...basePayload,
				fromStage: "Running",
				toStage: "Cancelled",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_cancelled");
		});

		it("should emit workspace_skipped via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("Skipped", {
				...basePayload,
				fromStage: "Pending",
				toStage: "Skipped",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_skipped");
		});

		it("should emit workspace_paused via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("Paused", {
				...basePayload,
				fromStage: "Running",
				toStage: "Paused",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_paused");
		});

		it("should emit workspace_timed_out via emitWorkspaceTransition", async () => {
			const eventId = await emitter.emitWorkspaceTransition("TimedOut", {
				...basePayload,
				fromStage: "Running",
				toStage: "TimedOut",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_timed_out");
		});

		it("should throw for unmappable WorkspaceExecutionStage", async () => {
			await expect(emitter.emitWorkspaceTransition("UnknownStage" as any, basePayload as any)).rejects.toThrow(
				/No event type mapped/,
			);
		});

		it("should emit workspace_pending via generic emit", async () => {
			const eventId = await emitter.emit("workspace_pending", {
				...basePayload,
				fromStage: "Pending",
				toStage: "Pending",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("workspace_pending");
		});
	});

	// -----------------------------------------------------------------------
	// Worker lifecycle events
	// -----------------------------------------------------------------------

	describe("worker lifecycle emitters", () => {
		const workerPayload = {
			planExecutionId,
			workspaceId: "ws-1",
			workspaceExecutionId: "ws-exec-1",
			runId: "run-1",
			attemptNumber: 1,
		};

		it("should emit worker_started", async () => {
			const eventId = await emitter.emitWorkerStarted(workerPayload);
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("worker_started");
			expect(envelope!.workspaceId).toBe("ws-1");
		});

		it("should emit worker_completed", async () => {
			const eventId = await emitter.emitWorkerCompleted({
				...workerPayload,
				verdict: "complete",
				changedFiles: ["src/foo.ts"],
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("worker_completed");
			expect(envelope!.payload!.verdict).toBe("complete");
		});

		it("should emit worker_failed", async () => {
			const eventId = await emitter.emitWorkerFailed({
				...workerPayload,
				error: "Process crashed",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("worker_failed");
			expect(envelope!.payload!.error).toBe("Process crashed");
		});

		it("should emit worker_timed_out", async () => {
			const eventId = await emitter.emitWorkerTimedOut({
				...workerPayload,
				timeoutMs: 30000,
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("worker_timed_out");
			expect(envelope!.payload!.timeoutMs).toBe(30000);
		});

		it("should emit worker_cancelled", async () => {
			const eventId = await emitter.emitWorkerCancelled({
				...workerPayload,
				reason: "Plan stopped",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("worker_cancelled");
			expect(envelope!.payload!.reason).toBe("Plan stopped");
		});
	});

	// -----------------------------------------------------------------------
	// Command events
	// -----------------------------------------------------------------------

	describe("command event emitters", () => {
		it("should emit command_started", async () => {
			const eventId = await emitter.emitCommandStarted({
				planExecutionId,
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("command_started");
			expect(envelope!.payload!.command).toBe("npm test");
		});

		it("should emit command_finished", async () => {
			const eventId = await emitter.emitCommandFinished({
				planExecutionId,
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				exitCode: 0,
				durationMs: 5000,
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("command_finished");
			expect(envelope!.payload!.exitCode).toBe(0);
			expect(envelope!.payload!.durationMs).toBe(5000);
		});

		it("should emit command_output for stdout chunks", async () => {
			const eventId = await emitter.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stdout",
				data: "PASS\n",
				offset: 0,
				runId: "run-1",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("command_output");
			expect(envelope!.payload!.stream).toBe("stdout");
			expect(envelope!.payload!.data).toBe("PASS\n");
			expect(envelope!.payload!.offset).toBe(0);
			expect(envelope!.payload!.command).toBe("npm test");
			expect(envelope!.workspaceId).toBe("ws-1");
		});

		it("should emit command_output for stderr chunks", async () => {
			const eventId = await emitter.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stderr",
				data: "Error: something failed\n",
				offset: 0,
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("command_output");
			expect(envelope!.payload!.stream).toBe("stderr");
			expect(envelope!.payload!.data).toBe("Error: something failed\n");
		});

		it("should emit command_output with final flag", async () => {
			const eventId = await emitter.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stdout",
				data: "Done",
				offset: 100,
				final: true,
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("command_output");
			expect(envelope!.payload!.final).toBe(true);
			expect(envelope!.payload!.offset).toBe(100);
		});
	});

	// -----------------------------------------------------------------------
	// Brain proposal events
	// -----------------------------------------------------------------------

	describe("brain proposal emitters", () => {
		const proposalPayload = {
			planExecutionId,
			proposalId: "prop-1",
			proposalType: "retry" as const,
			summary: "Retry workspace ws-1",
			rationale: "First attempt failed due to timeout",
			evidenceRefs: ["run-1"],
		};

		it("should emit brain_proposed", async () => {
			const eventId = await emitter.emitBrainProposed(proposalPayload);
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("brain_proposed");
			expect(envelope!.payload!.proposalType).toBe("retry");
		});

		it("should emit brain_approved", async () => {
			const eventId = await emitter.emitBrainApproved({
				planExecutionId,
				proposalId: "prop-1",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("brain_approved");
		});

		it("should emit brain_rejected", async () => {
			const eventId = await emitter.emitBrainRejected({
				planExecutionId,
				proposalId: "prop-1",
				reason: "Invalid approach",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("brain_rejected");
			expect(envelope!.payload!.reason).toBe("Invalid approach");
		});
	});

	// -----------------------------------------------------------------------
	// Lead Agent escalation events (P41.09)
	// -----------------------------------------------------------------------

	describe("lead agent escalation event emitters", () => {
		it("should emit lead_agent_review_started", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId, "ws-1");
			const eventId = await wsEmitter.emitLeadAgentReviewStarted({
				planExecutionId,
				workspaceId: "ws-1",
				attemptNumber: 2,
				failureSummary: "Command timed out",
				errorMessage: "npm test timed out after 30s",
				completionGateBlockReasons: ["target_command_not_executed"],
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("lead_agent_review_started");
			expect(envelope!.workspaceId).toBe("ws-1");
			expect(envelope!.payload!.attemptNumber).toBe(2);
			expect(envelope!.payload!.failureSummary).toBe("Command timed out");
			expect((envelope!.payload as any).completionGateBlockReasons).toEqual(["target_command_not_executed"]);
		});

		it("should emit lead_agent_directive_issued", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId, "ws-1");
			const eventId = await wsEmitter.emitLeadAgentDirectiveIssued({
				planExecutionId,
				workspaceId: "ws-1",
				directiveId: "dir-1",
				attemptNumber: 2,
				severity: "high",
				summary: "Fix test command wiring",
				directive: "Update the test script in package.json",
				allowedActions: ["inspect_file", "change_validation_command"],
				forbiddenActions: ["disable_completion_gate", "bypass_validation"],
				maxAdditionalRetries: 2,
				escalateAfter: 3,
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("lead_agent_directive_issued");
			expect(envelope!.payload!.directiveId).toBe("dir-1");
			expect(envelope!.payload!.severity).toBe("high");
			expect(envelope!.payload!.allowedActions).toContain("inspect_file");
			expect(envelope!.payload!.forbiddenActions).toContain("disable_completion_gate");
			expect(envelope!.payload!.maxAdditionalRetries).toBe(2);
		});

		it("should emit lead_agent_directive_acknowledged", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId, "ws-1");
			const eventId = await wsEmitter.emitLeadAgentDirectiveAcknowledged({
				planExecutionId,
				workspaceId: "ws-1",
				directiveId: "dir-1",
				attemptNumber: 2,
				acknowledgedAt: Date.now(),
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("lead_agent_directive_acknowledged");
			expect(envelope!.payload!.directiveId).toBe("dir-1");
			expect(envelope!.workspaceId).toBe("ws-1");
		});

		it("should emit lead_agent_escalation_initiated", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId, "ws-1");
			const eventId = await wsEmitter.emitLeadAgentEscalationInitiated({
				planExecutionId,
				workspaceId: "ws-1",
				escalationId: "esc-1",
				severity: "blocking",
				title: "Workspace stuck after 3 retries",
				summary: "Workspace ws-1 failed 3 times with same signature",
				whatHappened: "All 3 attempts failed with completion_gate_blocked",
				whyStuck: "The target command keeps failing with the same error",
				options: [
					{ id: "opt-1", label: "Retry with fix", risk: "low" },
					{ id: "opt-2", label: "Skip workspace", risk: "medium" },
				],
				recommendedOptionId: "opt-1",
				evidenceRefs: ["run-1", "run-2", "run-3"],
				logsToInspect: ["/logs/attempt-1.log"],
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("lead_agent_escalation_initiated");
			expect(envelope!.payload!.escalationId).toBe("esc-1");
			expect(envelope!.payload!.severity).toBe("blocking");
			expect(envelope!.payload!.options).toHaveLength(2);
			expect(envelope!.payload!.recommendedOptionId).toBe("opt-1");
		});

		it("should emit lead_agent_escalation_resolved", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId, "ws-1");
			const eventId = await wsEmitter.emitLeadAgentEscalationResolved({
				planExecutionId,
				workspaceId: "ws-1",
				escalationId: "esc-1",
				chosenOptionId: "opt-1",
				userResponse: "Let's retry with the fix",
				resolvedAt: Date.now(),
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("lead_agent_escalation_resolved");
			expect(envelope!.payload!.escalationId).toBe("esc-1");
			expect(envelope!.payload!.chosenOptionId).toBe("opt-1");
			expect(envelope!.payload!.userResponse).toBe("Let's retry with the fix");
		});

		it("should scope lead agent events to workspace", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId);
			const eventId = await wsEmitter.emitLeadAgentDirectiveIssued({
				planExecutionId,
				workspaceId: "ws-override",
				directiveId: "dir-2",
				attemptNumber: 1,
				severity: "low",
				summary: "Info",
				directive: "Inspect file x",
				allowedActions: ["inspect_file"],
				forbiddenActions: [],
				maxAdditionalRetries: 1,
				escalateAfter: 2,
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.workspaceId).toBe("ws-override");
		});
	});

	// -----------------------------------------------------------------------
	// Governance events
	// -----------------------------------------------------------------------

	describe("governance event emitters", () => {
		it("should emit governance_check_started", async () => {
			const eventId = await emitter.emitGovernanceCheckStarted({
				planExecutionId,
				workspaceId: "ws-1",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("governance_check_started");
		});

		it("should emit governance_approved", async () => {
			const eventId = await emitter.emitGovernanceApproved({
				planExecutionId,
				workspaceId: "ws-1",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("governance_approved");
		});

		it("should emit governance_rejected", async () => {
			const eventId = await emitter.emitGovernanceRejected({
				planExecutionId,
				workspaceId: "ws-1",
				reason: "Budget exceeded",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("governance_rejected");
			expect(envelope!.payload!.reason).toBe("Budget exceeded");
		});

		it("should emit governance_escalated", async () => {
			const eventId = await emitter.emitGovernanceEscalated({
				planExecutionId,
				workspaceId: "ws-1",
				reason: "Requires human review",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("governance_escalated");
			expect(envelope!.payload!.reason).toBe("Requires human review");
		});
	});

	// -----------------------------------------------------------------------
	// System events
	// -----------------------------------------------------------------------

	describe("system event emitters", () => {
		it("should emit system_error with optional code and stack", async () => {
			const eventId = await emitter.emitSystemError({
				planExecutionId,
				message: "Something went wrong",
				code: "ERR_BAD_THING",
				stack: "Error: ...",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("system_error");
			expect(envelope!.payload!.code).toBe("ERR_BAD_THING");
		});

		it("should emit system_error without stack", async () => {
			const eventId = await emitter.emitSystemError({
				planExecutionId,
				message: "Minimal error",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("system_error");
			expect(envelope!.payload!.message).toBe("Minimal error");
		});

		it("should emit system_warning", async () => {
			const eventId = await emitter.emitSystemWarning({
				planExecutionId,
				message: "Low disk space",
				code: "LOW_DISK",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("system_warning");
			expect(envelope!.payload!.code).toBe("LOW_DISK");
		});

		it("should emit system_info", async () => {
			const eventId = await emitter.emitSystemInfo({
				planExecutionId,
				message: "Plan started",
				details: { workspaceCount: 5 },
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("system_info");
			expect(envelope!.payload!.details).toEqual({ workspaceCount: 5 });
		});

		it("should emit system_info without planExecutionId", async () => {
			const eventId = await emitter.emitSystemInfo({
				message: "Orphan event",
			});
			const envelope = await store.getEvent(eventId);
			expect(envelope!.eventType).toBe("system_info");
			expect(envelope!.payload!.message).toBe("Orphan event");
		});
	});

	// -----------------------------------------------------------------------
	// WorkerEvent bridge
	// -----------------------------------------------------------------------

	describe("emitWorkerEvents (WorkerEvent bridge)", () => {
		it("should store known worker event types as matching ExecutionEvents", async () => {
			const workerEvents: WorkerEvent[] = [
				{
					type: "worker_started",
					payload: { runId: "run-1" },
					timestamp: Date.now(),
				},
				{
					type: "worker_completed",
					payload: { runId: "run-1", verdict: "complete" },
					timestamp: Date.now(),
				},
			];

			const eventIds = await emitter.emitWorkerEvents(workerEvents, "ws-1");

			expect(eventIds).toHaveLength(2);

			const e0 = await store.getEvent(eventIds[0]);
			expect(e0!.eventType).toBe("worker_started");
			expect(e0!.workspaceId).toBe("ws-1");
			expect((e0!.payload as any).runId).toBe("run-1");

			const e1 = await store.getEvent(eventIds[1]);
			expect(e1!.eventType).toBe("worker_completed");
			expect((e1!.payload as any).verdict).toBe("complete");
		});

		it("should fall back to system_info for unknown worker event types", async () => {
			const workerEvents: WorkerEvent[] = [
				{
					type: "custom_metric",
					payload: { value: 42 },
					timestamp: Date.now(),
				},
			];

			const eventIds = await emitter.emitWorkerEvents(workerEvents);

			expect(eventIds).toHaveLength(1);
			const envelope = await store.getEvent(eventIds[0]);
			expect(envelope!.eventType).toBe("system_info");
			// Original type preserved in payload
			expect((envelope!.payload as any)._sourceWorkerType).toBe("custom_metric");
		});

		it("should handle empty worker events array", async () => {
			const eventIds = await emitter.emitWorkerEvents([]);
			expect(eventIds).toEqual([]);
		});

		it("should use workspaceId from emitter context if not overridden", async () => {
			const wsEmitter = new RuntimeEventEmitter(store, planExecutionId, "ws-context");
			const workerEvents: WorkerEvent[] = [
				{
					type: "system_info",
					payload: { message: "test" },
					timestamp: Date.now(),
				},
			];

			const eventIds = await wsEmitter.emitWorkerEvents(workerEvents);
			const envelope = await store.getEvent(eventIds[0]);
			expect(envelope!.workspaceId).toBe("ws-context");
		});
	});

	// -----------------------------------------------------------------------
	// Child derivation
	// -----------------------------------------------------------------------

	describe("child derivation", () => {
		it("should create a child emitter inheriting context", async () => {
			const parent = new RuntimeEventEmitter(store, "exec-parent", "ws-parent");
			const child = parent.child({ workspaceId: "ws-child" });

			const eventId = await child.emit("system_info", {
				message: "child event",
				planExecutionId: "exec-parent",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.planExecutionId).toBe("exec-parent");
			expect(envelope!.workspaceId).toBe("ws-child");
		});

		it("should allow overriding planExecutionId in child", async () => {
			const parent = new RuntimeEventEmitter(store, "exec-parent");
			const child = parent.child({ planExecutionId: "exec-child" });

			const eventId = await child.emit("system_info", {
				message: "different plan",
				planExecutionId: "exec-child",
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope!.planExecutionId).toBe("exec-child");
		});

		it("should not affect parent when child emits events", async () => {
			const parent = new RuntimeEventEmitter(store, "exec-parent");
			const child = parent.child({ workspaceId: "ws-child" });

			await child.emit("system_info", {
				message: "child event",
				planExecutionId: "exec-parent",
			});

			const parentId = await parent.emit("system_info", {
				message: "parent event",
				planExecutionId: "exec-parent",
			});

			const envelope = await store.getEvent(parentId);
			expect(envelope!.workspaceId).toBeUndefined();
		});
	});

	// -----------------------------------------------------------------------
	// Integration: multi-event sequence
	// -----------------------------------------------------------------------

	describe("multi-event sequence", () => {
		it("should emit events in order and allow querying them back", async () => {
			await emitter.emitPlanStarted({
				planId: "plan-1",
				planExecutionId,
				phase: "dev",
				title: "Development Plan",
				totalWorkspaces: 2,
			});

			await emitter.emitWorkspaceTransition("Running", {
				planExecutionId,
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				fromStage: "Pending",
				toStage: "Running",
				attemptNumber: 1,
			});

			await emitter.emitWorkerStarted({
				planExecutionId,
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				runId: "run-1",
				attemptNumber: 1,
			});

			await emitter.emitWorkerCompleted({
				planExecutionId,
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				runId: "run-1",
				verdict: "complete",
				changedFiles: ["output.txt"],
			});

			await emitter.emitWorkspaceTransition("Complete", {
				planExecutionId,
				workspaceId: "ws-1",
				workspaceExecutionId: "ws-exec-1",
				fromStage: "Running",
				toStage: "Complete",
				attemptNumber: 1,
			});

			const events = await store.queryEvents(planExecutionId);
			expect(events).toHaveLength(5);
			expect(events[0].eventType).toBe("plan_started");
			expect(events[1].eventType).toBe("workspace_running");
			expect(events[2].eventType).toBe("worker_started");
			expect(events[3].eventType).toBe("worker_completed");
			expect(events[4].eventType).toBe("workspace_completed");
		});
	});

	// -----------------------------------------------------------------------
	// Command log stream bridge (P41.05)
	// -----------------------------------------------------------------------

	describe("command log stream bridge", () => {
		it("should publish command output to the log stream when configured", async () => {
			const logStream = new InMemoryCommandLogStream();
			const received: CommandLogEntry[] = [];
			logStream.subscribe(planExecutionId, (e) => received.push(e));

			const emitterWithStream = new RuntimeEventEmitter(
				store,
				planExecutionId,
				"ws-1",
				undefined,
				undefined,
				logStream,
			);

			await emitterWithStream.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "npm build",
				cwd: "/project",
				stream: "stdout",
				data: "Building...\n",
				offset: 0,
				runId: "run-1",
			});

			expect(received).toHaveLength(1);
			expect(received[0].data).toBe("Building...\n");
			expect(received[0].command).toBe("npm build");
			expect(received[0].stream).toBe("stdout");
			expect(received[0].planExecutionId).toBe(planExecutionId);
			expect(received[0].workspaceId).toBe("ws-1");
			expect(received[0].seq).toBe(1);
			expect(received[0].runId).toBe("run-1");
		});

		it("should publish all command output fields to the log stream", async () => {
			const logStream = new InMemoryCommandLogStream();
			const received: CommandLogEntry[] = [];
			logStream.subscribe(planExecutionId, (e) => received.push(e));

			const emitterWithStream = new RuntimeEventEmitter(
				store,
				planExecutionId,
				"ws-1",
				undefined,
				undefined,
				logStream,
			);

			await emitterWithStream.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "echo hello",
				cwd: "/project",
				stream: "stderr",
				data: "warning: something\n",
				offset: 42,
				runId: "run-2",
				final: true,
			});

			expect(received).toHaveLength(1);
			expect(received[0].stream).toBe("stderr");
			expect(received[0].offset).toBe(42);
			expect(received[0].runId).toBe("run-2");
			expect(received[0].final).toBe(true);
		});

		it("should still persist command output to the event store when stream is configured", async () => {
			const logStream = new InMemoryCommandLogStream();
			const emitterWithStream = new RuntimeEventEmitter(
				store,
				planExecutionId,
				"ws-1",
				undefined,
				undefined,
				logStream,
			);

			const eventId = await emitterWithStream.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "npm test",
				cwd: "/project",
				stream: "stdout",
				data: "All tests passed\n",
				offset: 0,
			});

			const envelope = await store.getEvent(eventId);
			expect(envelope).not.toBeNull();
			expect(envelope!.eventType).toBe("command_output");
			expect(envelope!.payload!.data).toBe("All tests passed\n");
		});

		it("should not throw when no log stream is configured", async () => {
			// emitter has no commandLogStream — this is the default case
			await expect(
				emitter.emitCommandOutput({
					planExecutionId,
					workspaceId: "ws-1",
					command: "ls",
					cwd: "/project",
					stream: "stdout",
					data: "file.txt\n",
					offset: 0,
				}),
			).resolves.toBeDefined();
		});

		it("should publish sequential entries with incrementing seq numbers", async () => {
			const logStream = new InMemoryCommandLogStream();
			const received: CommandLogEntry[] = [];
			logStream.subscribe(planExecutionId, (e) => received.push(e));

			const emitterWithStream = new RuntimeEventEmitter(
				store,
				planExecutionId,
				"ws-1",
				undefined,
				undefined,
				logStream,
			);

			await emitterWithStream.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "cmd-1",
				cwd: "/project",
				stream: "stdout",
				data: "chunk-1",
				offset: 0,
			});

			await emitterWithStream.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-1",
				command: "cmd-1",
				cwd: "/project",
				stream: "stdout",
				data: "chunk-2",
				offset: 7,
			});

			expect(received).toHaveLength(2);
			expect(received[0].seq).toBe(1);
			expect(received[1].seq).toBe(2);
		});

		it("should be inherited by child emitters", async () => {
			const logStream = new InMemoryCommandLogStream();
			const received: CommandLogEntry[] = [];
			logStream.subscribe(planExecutionId, (e) => received.push(e));

			const parent = new RuntimeEventEmitter(store, planExecutionId, "ws-parent", undefined, undefined, logStream);
			const child = parent.child({ workspaceId: "ws-child" });

			await child.emitCommandOutput({
				planExecutionId,
				workspaceId: "ws-child",
				command: "child-cmd",
				cwd: "/child",
				stream: "stdout",
				data: "child-output",
				offset: 0,
			});

			expect(received).toHaveLength(1);
			expect(received[0].workspaceId).toBe("ws-child");
			expect(received[0].command).toBe("child-cmd");
		});
	});
});
