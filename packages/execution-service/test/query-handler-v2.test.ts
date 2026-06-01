/**
 * Query Handler V2 Tests — P42.01 Read Model Harden
 *
 * Tests for:
 *   - getPlanStats (computed from journal events)
 *   - getDependencyGraph (extracted from plan_started payload)
 *   - getCommandHistory (extracted from command_started/finished events)
 *   - getLeadDirectives (extracted from lead_agent_directive_issued events)
 *   - getLeadEscalations (extracted from lead_agent_escalation_initiated events)
 *   - getFinalValidationStatus (from governance events)
 *   - getPlanSummary from plan_started event fallback
 *   - getWorkspaceSummary from workspace events fallback
 *   - getArtifacts (explicit unavailable)
 */

import type { JournalEventEnvelope } from "@earendil-works/pi-execution-core";
import { describe, expect, it } from "vitest";
import { createExecutionReadModel } from "../src/query-handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
	seq: string,
	eventType: string,
	workspaceId: string | undefined,
	payload: Record<string, unknown> | null,
	createdAt?: string,
): JournalEventEnvelope {
	return {
		seq,
		eventId: `evt-${seq}`,
		planExecutionId: "exec-1",
		workspaceId,
		eventType,
		payload,
		createdAt: createdAt ?? new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// getPlanStats
// ---------------------------------------------------------------------------

describe("getPlanStats", () => {
	it("should return unavailable state when no events exist", async () => {
		const model = createExecutionReadModel({});
		const stats = await model.getPlanStats("exec-1");

		expect(stats.planExecutionId).toBe("exec-1");
		expect(stats.dataSource).toBe("unavailable");
		expect(stats.totalWorkspaces).toBe(0);
		expect(stats.completedWorkspaces).toBe(0);
		expect(stats.failedWorkspaces).toBe(0);
		expect(stats.durationMs).toBeNull();
	});

	it("should count workspace stages from events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "plan_started", undefined, { totalWorkspaces: 3 }),
				makeEvent("2", "workspace_running", "ws-1", null),
				makeEvent("3", "workspace_completed", "ws-1", null),
				makeEvent("4", "workspace_running", "ws-2", null),
				makeEvent("5", "workspace_failed", "ws-2", null),
				makeEvent("6", "workspace_running", "ws-3", null),
				makeEvent("7", "workspace_blocked", "ws-3", null),
			],
		});

		const stats = await model.getPlanStats("exec-1");

		expect(stats.totalWorkspaces).toBe(3);
		expect(stats.completedWorkspaces).toBe(1);
		expect(stats.failedWorkspaces).toBe(1);
		expect(stats.blockedWorkspaces).toBe(1);
		expect(stats.runningWorkspaces).toBe(0); // all resolved
		expect(stats.pendingWorkspaces).toBe(0);
		expect(stats.cancelledWorkspaces).toBe(0);
		expect(stats.skippedWorkspaces).toBe(0);
		expect(stats.dataSource).toBe("events");
	});

	it("should compute duration from first worker start to last completion", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "plan_started", undefined, { totalWorkspaces: 1 }, "2026-01-01T00:00:00Z"),
				makeEvent("2", "worker_started", "ws-1", {}, "2026-01-01T00:01:00Z"),
				makeEvent("3", "workspace_completed", "ws-1", null, "2026-01-01T00:02:30Z"),
			],
		});

		const stats = await model.getPlanStats("exec-1");

		expect(stats.durationMs).toBe(90_000); // 1m30s
	});

	it("should handle cancelled and skipped workspaces", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "plan_started", undefined, { totalWorkspaces: 4 }),
				makeEvent("2", "workspace_running", "ws-1", null),
				makeEvent("3", "workspace_completed", "ws-1", null),
				makeEvent("4", "workspace_running", "ws-2", null),
				makeEvent("5", "workspace_cancelled", "ws-2", null),
				makeEvent("6", "workspace_pending", "ws-3", null),
				makeEvent("7", "workspace_skipped", "ws-3", null),
			],
		});

		const stats = await model.getPlanStats("exec-1");

		expect(stats.completedWorkspaces).toBe(1);
		expect(stats.cancelledWorkspaces).toBe(1);
		expect(stats.skippedWorkspaces).toBe(1);
		expect(stats.dataSource).toBe("events");
	});
});

// ---------------------------------------------------------------------------
// getDependencyGraph
// ---------------------------------------------------------------------------

describe("getDependencyGraph", () => {
	it("should return unavailable state when no events exist", async () => {
		const model = createExecutionReadModel({});
		const graph = await model.getDependencyGraph("exec-1");

		expect(graph.planExecutionId).toBe("exec-1");
		expect(graph.dataAvailability.available).toBe(false);
		expect(graph.nodes).toEqual([]);
		expect(graph.totalBatches).toBe(0);
	});

	it("should extract workspace nodes from plan_started payload", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "plan_started", undefined, {
					workspaces: [
						{ id: "ws-1", title: "Setup", dependencies: [], batch: 0 },
						{ id: "ws-2", title: "Build", dependencies: ["ws-1"], batch: 1 },
						{ id: "ws-3", title: "Test", dependencies: ["ws-2"], batch: 2 },
					],
				}),
			],
		});

		const graph = await model.getDependencyGraph("exec-1");

		expect(graph.dataAvailability.available).toBe(true);
		expect(graph.nodes).toHaveLength(3);
		expect(graph.totalBatches).toBe(3);

		expect(graph.nodes[0].id).toBe("ws-1");
		expect(graph.nodes[0].dependsOn).toEqual([]);
		expect(graph.nodes[0].batch).toBe(0);

		expect(graph.nodes[1].id).toBe("ws-2");
		expect(graph.nodes[1].dependsOn).toEqual(["ws-1"]);
		expect(graph.nodes[1].batch).toBe(1);

		expect(graph.nodes[2].id).toBe("ws-3");
		expect(graph.nodes[2].dependsOn).toEqual(["ws-2"]);
		expect(graph.nodes[2].batch).toBe(2);
	});

	it("should reconstruct from workspace events when no plan_started payload", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "workspace_running", "ws-1", null),
				makeEvent("2", "workspace_running", "ws-2", { dependencies: ["ws-1"] }),
				makeEvent("3", "workspace_completed", "ws-1", null),
				makeEvent("4", "workspace_completed", "ws-2", null),
			],
		});

		const graph = await model.getDependencyGraph("exec-1");

		// Should have reconstructed from workspace events
		expect(graph.nodes).toHaveLength(2);
		expect(graph.nodes.find((n) => n.id === "ws-1")).toBeDefined();
		expect(graph.nodes.find((n) => n.id === "ws-2")).toBeDefined();
		expect(graph.dataAvailability.available).toBe(true);
		expect(graph.dataAvailability.reason).toContain("Reconstructed");
	});
});

// ---------------------------------------------------------------------------
// getCommandHistory
// ---------------------------------------------------------------------------

describe("getCommandHistory", () => {
	it("should return empty array when no command events exist", async () => {
		const model = createExecutionReadModel({});
		const history = await model.getCommandHistory("exec-1", "ws-1");
		expect(history).toEqual([]);
	});

	it("should pair command_started and command_finished events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async (_pid, options) => {
				expect(options?.workspaceId).toBe("ws-1");
				return [
					makeEvent(
						"1",
						"command_started",
						"ws-1",
						{
							command: "npm run build",
							cwd: "/project",
						},
						"2026-01-01T00:01:00Z",
					),
					makeEvent(
						"2",
						"command_finished",
						"ws-1",
						{
							command: "npm run build",
							cwd: "/project",
							exitCode: 0,
							outputSummary: "Build succeeded",
						},
						"2026-01-01T00:01:30Z",
					),
				];
			},
		});

		const history = await model.getCommandHistory("exec-1", "ws-1");

		expect(history).toHaveLength(1);
		expect(history[0].command).toBe("npm run build");
		expect(history[0].cwd).toBe("/project");
		expect(history[0].exitCode).toBe(0);
		expect(history[0].outputSummary).toBe("Build succeeded");
		expect(history[0].startedAt).toBeLessThan(history[0].finishedAt);
	});

	it("should return multiple commands in order", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "command_started", "ws-1", { command: "echo first", cwd: "/p" }, "2026-01-01T00:01:00Z"),
				makeEvent(
					"2",
					"command_finished",
					"ws-1",
					{ command: "echo first", cwd: "/p", exitCode: 0 },
					"2026-01-01T00:01:01Z",
				),
				makeEvent("3", "command_started", "ws-1", { command: "echo second", cwd: "/p" }, "2026-01-01T00:02:00Z"),
				makeEvent(
					"4",
					"command_finished",
					"ws-1",
					{ command: "echo second", cwd: "/p", exitCode: 0 },
					"2026-01-01T00:02:05Z",
				),
			],
		});

		const history = await model.getCommandHistory("exec-1", "ws-1");

		expect(history).toHaveLength(2);
		expect(history[0].command).toBe("echo first");
		expect(history[1].command).toBe("echo second");
		expect(history[1].startedAt).toBeGreaterThan(history[0].startedAt);
	});
});

// ---------------------------------------------------------------------------
// getLeadDirectives
// ---------------------------------------------------------------------------

describe("getLeadDirectives", () => {
	it("should return empty array when no directive events exist", async () => {
		const model = createExecutionReadModel({});
		const directives = await model.getLeadDirectives("exec-1", "ws-1");
		expect(directives).toEqual([]);
	});

	it("should extract directives from lead_agent_directive_issued events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "lead_agent_directive_issued", "ws-1", {
					directiveId: "dir-1",
					workspaceId: "ws-1",
					attemptNumber: 2,
					severity: "high",
					summary: "Build failed due to missing deps",
					directive: "Run npm install before build",
					allowedActions: ["run_command", "edit_file"],
					forbiddenActions: ["delete_file"],
					maxAdditionalRetries: 3,
					escalateAfter: 5,
				}),
			],
		});

		const directives = await model.getLeadDirectives("exec-1", "ws-1");

		expect(directives).toHaveLength(1);
		expect(directives[0].directiveId).toBe("dir-1");
		expect(directives[0].severity).toBe("high");
		expect(directives[0].summary).toBe("Build failed due to missing deps");
		expect(directives[0].allowedActions).toContain("run_command");
		expect(directives[0].status).toBe("issued");
	});

	it("should mark directives as acknowledged when followed by ack event", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "lead_agent_directive_issued", "ws-1", {
					directiveId: "dir-1",
					workspaceId: "ws-1",
					attemptNumber: 1,
					severity: "medium",
					summary: "Fix lint errors",
					directive: "Run linter",
					allowedActions: ["run_command"],
					forbiddenActions: [],
					maxAdditionalRetries: 2,
					escalateAfter: 3,
				}),
				makeEvent("2", "lead_agent_directive_acknowledged", "ws-1", {
					directiveId: "dir-1",
					attemptNumber: 1,
				}),
			],
		});

		const directives = await model.getLeadDirectives("exec-1", "ws-1");

		expect(directives).toHaveLength(1);
		expect(directives[0].status).toBe("acknowledged");
	});
});

// ---------------------------------------------------------------------------
// getLeadEscalations
// ---------------------------------------------------------------------------

describe("getLeadEscalations", () => {
	it("should return empty array when no escalation events exist", async () => {
		const model = createExecutionReadModel({});
		const escalations = await model.getLeadEscalations("exec-1", "ws-1");
		expect(escalations).toEqual([]);
	});

	it("should extract escalations from lead_agent_escalation_initiated events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "lead_agent_escalation_initiated", "ws-1", {
					escalationId: "esc-1",
					workspaceId: "ws-1",
					severity: "blocking",
					title: "Cannot install package",
					summary: "Package X requires auth token",
					whatHappened: "npm install failed with 401",
					whyStuck: "Auth token not configured",
					options: [{ id: "opt-1", label: "Configure token", risk: "low", description: "Add auth token" }],
					recommendedOptionId: "opt-1",
					evidenceRefs: ["npm-debug.log"],
					logsToInspect: ["install.log"],
				}),
			],
		});

		const escalations = await model.getLeadEscalations("exec-1", "ws-1");

		expect(escalations).toHaveLength(1);
		expect(escalations[0].escalationId).toBe("esc-1");
		expect(escalations[0].severity).toBe("blocking");
		expect(escalations[0].title).toBe("Cannot install package");
		expect(escalations[0].status).toBe("awaiting_user");
		expect(escalations[0].options).toHaveLength(1);
	});

	it("should mark escalations as resolved when resolution event exists", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "lead_agent_escalation_initiated", "ws-1", {
					escalationId: "esc-1",
					workspaceId: "ws-1",
					severity: "blocking",
					title: "Stuck",
					summary: "Stuck on build",
					whatHappened: "Build fails",
					whyStuck: "No output",
					options: [{ id: "opt-1", label: "Fix", risk: "low" }],
					recommendedOptionId: "opt-1",
					evidenceRefs: [],
					logsToInspect: [],
				}),
				makeEvent("2", "lead_agent_escalation_resolved", "ws-1", {
					escalationId: "esc-1",
					chosenOptionId: "opt-1",
					userResponse: "Go ahead",
				}),
			],
		});

		const escalations = await model.getLeadEscalations("exec-1", "ws-1");

		expect(escalations).toHaveLength(1);
		expect(escalations[0].status).toBe("resolved");
		expect(escalations[0].userChoice).toBe("opt-1");
		expect(escalations[0].userResponse).toBe("Go ahead");
		expect(escalations[0].resolvedAt).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// getFinalValidationStatus
// ---------------------------------------------------------------------------

describe("getFinalValidationStatus", () => {
	it("should return default state when no governance events exist", async () => {
		const model = createExecutionReadModel({});
		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.required).toBe(true);
		expect(status.passed).toBeNull();
		expect(status.blocked).toBe(false);
		expect(status.blockReasons).toEqual([]);
	});

	it("should detect governance approval", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async (_pid, options) => {
				expect(options?.workspaceId).toBe("ws-1");
				return [makeEvent("1", "governance_approved", "ws-1", {})];
			},
		});

		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.passed).toBe(true);
		expect(status.blocked).toBe(false);
	});

	it("should detect governance rejection", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [makeEvent("1", "governance_rejected", "ws-1", { reason: "Lint errors > 10" })],
		});

		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.passed).toBe(false);
		expect(status.blocked).toBe(true);
		expect(status.blockReasons).toContain("Lint errors > 10");
	});

	it("should detect governance escalation", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "governance_escalated", "ws-1", { reason: "Requires manual review" }),
			],
		});

		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.passed).toBeNull();
		expect(status.blocked).toBe(true);
		expect(status.blockReasons).toContain("Requires manual review");
	});

	it("should use the latest event when multiple exist", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "governance_rejected", "ws-1", { reason: "First rejection" }, "2026-01-01T00:01:00Z"),
				makeEvent("2", "governance_approved", "ws-1", { reason: "Approved after fix" }, "2026-01-01T00:02:00Z"),
			],
		});

		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.passed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// getPlanSummary from events
// ---------------------------------------------------------------------------

describe("getPlanSummary from events", () => {
	it("should reconstruct plan summary from plan_started event", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent(
					"1",
					"plan_started",
					undefined,
					{
						projectId: "proj-1",
						phase: "p42",
						title: "Dashboard V3",
					},
					"2026-01-01T00:00:00Z",
				),
			],
		});

		const summary = await model.getPlanSummary("exec-1");
		expect(summary.id).toBe("exec-1");
		expect(summary.projectId).toBe("proj-1");
		expect(summary.phase).toBe("p42");
		expect(summary.title).toBe("Dashboard V3");
		expect(summary.status).toBe("running");
	});

	it("should mark plan as complete when plan_completed event exists", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "plan_started", undefined, { title: "Test" }, "2026-01-01T00:00:00Z"),
				makeEvent("2", "plan_completed", undefined, {}, "2026-01-01T00:10:00Z"),
			],
		});

		const summary = await model.getPlanSummary("exec-1");
		expect(summary.status).toBe("complete");
		expect(summary.completedAt).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// getWorkspaceSummary from events
// ---------------------------------------------------------------------------

describe("getWorkspaceSummary from events", () => {
	it("should reconstruct workspace summary from workspace events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "workspace_running", "ws-1", null, "2026-01-01T00:01:00Z"),
				makeEvent("2", "worker_started", "ws-1", null, "2026-01-01T00:01:00Z"),
				makeEvent("3", "worker_completed", "ws-1", null, "2026-01-01T00:02:00Z"),
				makeEvent("4", "workspace_completed", "ws-1", null, "2026-01-01T00:02:00Z"),
			],
		});

		const summary = await model.getWorkspaceSummary("exec-1", "ws-1");
		expect(summary.stage).toBe("Complete");
		expect(summary.attempts).toBe(1);
		expect(summary.startedAt).toBeDefined();
		expect(summary.completedAt).toBeDefined();
	});

	it("should return default when no events exist", async () => {
		const model = createExecutionReadModel({});
		const summary = await model.getWorkspaceSummary("exec-1", "ws-1");
		expect(summary.stage).toBe("unknown");
		expect(summary.attempts).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// getArtifacts
// ---------------------------------------------------------------------------

describe("getArtifacts", () => {
	it("should return empty array (requires filesystem access)", async () => {
		const model = createExecutionReadModel({});
		const artifacts = await model.getArtifacts("exec-1");
		expect(artifacts).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// getWorkerContext
// ---------------------------------------------------------------------------

describe("getWorkerContext", () => {
	it("should compose from sub-queries without directives or escalations", async () => {
		const model = createExecutionReadModel({});
		const ctx = await model.getWorkerContext("exec-1", "ws-1");

		expect(ctx.workspaceId).toBe("ws-1");
		expect(ctx.planExecutionId).toBe("exec-1");
		expect(ctx.stage).toBe("unknown");
		expect(ctx.activeDirectives).toEqual([]);
		expect(ctx.activeEscalations).toEqual([]);
		expect(ctx.transcriptUrl).toBe("/api/transcript/exec-1/ws-1");
	});

	it("should include active directives from lead agent events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async (_pid, options) => {
				if (options?.workspaceId === "ws-1") {
					return [
						makeEvent("1", "lead_agent_directive_issued", "ws-1", {
							directiveId: "dir-1",
							workspaceId: "ws-1",
							attemptNumber: 1,
							severity: "high",
							summary: "Fix issue",
							directive: "Do X",
							allowedActions: ["run_command"],
							forbiddenActions: [],
							maxAdditionalRetries: 2,
							escalateAfter: 3,
						}),
					];
				}
				return [];
			},
		});

		const ctx = await model.getWorkerContext("exec-1", "ws-1");
		expect(ctx.activeDirectives).toHaveLength(1);
		expect(ctx.activeDirectives[0].directiveId).toBe("dir-1");
	});

	it("should include goal and role from plan_started workspaces", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "plan_started", undefined, {
					workspaces: [
						{ id: "ws-1", title: "Setup", goal: "Initialize project", role: "setup-agent" },
						{ id: "ws-2", title: "Build" },
					],
				}),
				makeEvent("2", "workspace_running", "ws-1", null),
			],
		});

		const ctx = await model.getWorkerContext("exec-1", "ws-1");
		expect(ctx.goal).toBe("Initialize project");
		expect(ctx.role).toBe("setup-agent");
	});

	it("should include lastCommand from command history", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async (_pid, options) => {
				if (options?.workspaceId === "ws-1") {
					return [
						makeEvent("1", "command_started", "ws-1", { command: "npm test", cwd: "/p" }, "2026-01-01T00:01:00Z"),
						makeEvent(
							"2",
							"command_finished",
							"ws-1",
							{ command: "npm test", cwd: "/p", exitCode: 0 },
							"2026-01-01T00:01:30Z",
						),
					];
				}
				return [];
			},
		});

		const ctx = await model.getWorkerContext("exec-1", "ws-1");
		expect(ctx.lastCommand).toBe("npm test");
	});

	it("should include humanDirective from human_directive_issued events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async (_pid, options) => {
				if (options?.workspaceId === "ws-1") {
					return [
						makeEvent("1", "human_directive_issued", "ws-1", {
							directiveId: "hd-1",
							directive: "Please ensure we use pnpm not npm",
							severity: "medium",
						}),
					];
				}
				return [];
			},
		});

		const ctx = await model.getWorkerContext("exec-1", "ws-1");
		expect(ctx.humanDirective).toBe("Please ensure we use pnpm not npm");
	});

	it("should include logSummary from command_finished outputSummaries", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async (_pid, options) => {
				if (options?.workspaceId === "ws-1") {
					return [
						makeEvent("1", "command_started", "ws-1", { command: "npm build", cwd: "/p" }),
						makeEvent("2", "command_finished", "ws-1", {
							command: "npm build",
							cwd: "/p",
							exitCode: 0,
							outputSummary: "Build succeeded (12 modules, 2.3s)",
						}),
					];
				}
				return [];
			},
		});

		const ctx = await model.getWorkerContext("exec-1", "ws-1");
		expect(ctx.logSummary).toContain("Build succeeded");
	});
});

// ---------------------------------------------------------------------------
// getTranscript
// ---------------------------------------------------------------------------

describe("getTranscript", () => {
	it("should return empty array when no transcript store and no events", async () => {
		const model = createExecutionReadModel({});
		const events = await model.getTranscript("exec-1", "ws-1");
		expect(events).toEqual([]);
	});

	it("should use transcript store when available", async () => {
		const model = createExecutionReadModel({
			getTranscriptEvents: async (pid, wsId) => [
				{
					type: "workspace_complete",
					timestamp: Date.now(),
					workspaceId: wsId,
					summary: "Workspace completed successfully",
				},
			],
		});

		const events = await model.getTranscript("exec-1", "ws-1");
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("workspace_complete");
		expect(events[0].summary).toBe("Workspace completed successfully");
	});

	it("should fall back to journal event reconstruction when no transcript store", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "workspace_pending", "ws-1", null),
				makeEvent("2", "workspace_running", "ws-1", null),
				makeEvent("3", "workspace_completed", "ws-1", null),
			],
		});

		const events = await model.getTranscript("exec-1", "ws-1");
		// Should reconstruct 3 transcript events from journal events
		expect(events.length).toBeGreaterThanOrEqual(3);
		expect(events[0].summary).toBeDefined();
	});

	it("should return empty array for workspace with no events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [makeEvent("1", "plan_started", undefined, {})],
		});

		const events = await model.getTranscript("exec-1", "ws-1");
		expect(events).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Regressions and Edge Cases
// ---------------------------------------------------------------------------

describe("stats edge cases", () => {
	it("should derive totalWorkspaces from event counts when plan_started missing", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "workspace_completed", "ws-1", null),
				makeEvent("2", "workspace_failed", "ws-2", null),
				makeEvent("3", "workspace_blocked", "ws-3", null),
			],
		});

		const stats = await model.getPlanStats("exec-1");
		expect(stats.totalWorkspaces).toBe(3);
		expect(stats.completedWorkspaces).toBe(1);
		expect(stats.failedWorkspaces).toBe(1);
		expect(stats.blockedWorkspaces).toBe(1);
		expect(stats.dataSource).toBe("events");
	});

	it("should report state-store data source when plan summary exists but no events", async () => {
		const model = createExecutionReadModel({
			getPlanExecutionSummary: async () => ({
				id: "exec-1",
				projectId: "proj-1",
				phase: "p42",
				title: "Test Plan",
				status: "running",
				startedAt: "2026-01-01T00:00:00Z",
				completedAt: null,
			}),
		});

		const stats = await model.getPlanStats("exec-1");
		expect(stats.totalWorkspaces).toBe(0);
		expect(stats.dataSource).toBe("state-store");
	});
});

describe("dependency graph stage derivation", () => {
	it("should derive stage from workspace events when plan_started has workspaces", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "plan_started", undefined, {
					workspaces: [
						{ id: "ws-1", dependencies: [], batch: 0 },
						{ id: "ws-2", dependencies: ["ws-1"], batch: 1 },
					],
				}),
				makeEvent("2", "workspace_running", "ws-1", null),
				makeEvent("3", "workspace_completed", "ws-1", null),
				makeEvent("4", "workspace_running", "ws-2", null),
			],
		});

		const graph = await model.getDependencyGraph("exec-1");
		expect(graph.nodes).toHaveLength(2);

		const ws1Node = graph.nodes.find((n) => n.id === "ws-1")!;
		expect(ws1Node.stage).toBe("Complete");

		const ws2Node = graph.nodes.find((n) => n.id === "ws-2")!;
		expect(ws2Node.stage).toBe("Running");
	});

	it("should derive stage from reconstructed workspace events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "workspace_running", "ws-1", null),
				makeEvent("2", "workspace_failed", "ws-1", null),
				makeEvent("3", "workspace_running", "ws-2", null),
			],
		});

		const graph = await model.getDependencyGraph("exec-1");
		expect(graph.nodes).toHaveLength(2);

		const ws1Node = graph.nodes.find((n) => n.id === "ws-1")!;
		expect(ws1Node.stage).toBe("Failed");

		const ws2Node = graph.nodes.find((n) => n.id === "ws-2")!;
		expect(ws2Node.stage).toBe("Running");
	});
});

describe("command history runId disambiguation", () => {
	it("should disambiguate concurrent commands using runId", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent(
					"1",
					"command_started",
					"ws-1",
					{
						command: "npm test",
						cwd: "/p",
						runId: "run-a",
					},
					"2026-01-01T00:01:00Z",
				),
				makeEvent(
					"2",
					"command_started",
					"ws-1",
					{
						command: "npm test",
						cwd: "/p",
						runId: "run-b",
					},
					"2026-01-01T00:01:01Z",
				),
				makeEvent(
					"3",
					"command_finished",
					"ws-1",
					{
						command: "npm test",
						cwd: "/p",
						runId: "run-a",
						exitCode: 0,
					},
					"2026-01-01T00:01:30Z",
				),
				makeEvent(
					"4",
					"command_finished",
					"ws-1",
					{
						command: "npm test",
						cwd: "/p",
						runId: "run-b",
						exitCode: 1,
					},
					"2026-01-01T00:01:35Z",
				),
			],
		});

		const history = await model.getCommandHistory("exec-1", "ws-1");
		expect(history).toHaveLength(2);
		expect(history[0].command).toBe("npm test");
		expect(history[0].exitCode).toBe(0);
		expect(history[1].exitCode).toBe(1);
	});
});

describe("final validation separate queries", () => {
	it("should query governance events without comma-separated eventType filter", async () => {
		let capturedOptions: any = null;
		const model = createExecutionReadModel({
			getJournalEvents: async (_pid, options) => {
				capturedOptions = options;
				return [makeEvent("1", "governance_approved", "ws-1", {})];
			},
		});

		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.passed).toBe(true);
		// Should NOT pass comma-separated eventType
		expect(capturedOptions?.eventType).toBeUndefined();
	});

	it("should handle mixed governance and non-governance events", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("1", "worker_completed", "ws-1", null),
				makeEvent("2", "governance_approved", "ws-1", {}),
				makeEvent("3", "workspace_completed", "ws-1", null),
			],
		});

		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.passed).toBe(true);
		expect(status.blocked).toBe(false);
	});

	it("should use the latest governance event by seq", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				makeEvent("2", "governance_rejected", "ws-1", { reason: "First" }),
				makeEvent("5", "governance_approved", "ws-1", { reason: "Second" }),
			],
		});

		const status = await model.getFinalValidationStatus("exec-1", "ws-1");
		expect(status.passed).toBe(true);
	});
});
