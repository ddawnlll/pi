/**
 * Query Handler Tests — Comprehensive read model coverage (P42.01)
 *
 * Covers all ExecutionReadModel methods with data availability sentinels:
 *   - getPlanSummary
 *   - getPlanStats
 *   - getDependencyGraph
 *   - getWorkspaceSummary
 *   - getCommandHistory
 *   - getLeadDirectives
 *   - getLeadEscalations
 *   - getFinalValidationStatus
 *   - getTranscript
 *   - getArtifacts
 *   - getWorkerContext
 *   - getChangedFiles (edge cases)
 *   - getFileTree (edge cases)
 *   - getFileContent (archive-backed)
 *   - getFileDiff (archive-backed)
 */
import { describe, expect, it } from "vitest";
import { createExecutionReadModel } from "../src/query-handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
	seq?: string;
	eventId?: string;
	planExecutionId?: string;
	workspaceId?: string;
	eventType?: string;
	payload?: Record<string, unknown> | null;
	createdAt?: string;
}): any {
	return {
		seq: overrides.seq ?? "1",
		eventId: overrides.eventId ?? "evt-1",
		planExecutionId: overrides.planExecutionId ?? "exec-1",
		workspaceId: overrides.workspaceId ?? "ws-1",
		eventType: overrides.eventType ?? "plan_started",
		payload: overrides.payload ?? null,
		createdAt: overrides.createdAt ?? new Date().toISOString(),
	};
}

function ts(offsetMs: number): string {
	return new Date(Date.now() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createExecutionReadModel — comprehensive", () => {
	// -----------------------------------------------------------------------
	// getPlanSummary
	// -----------------------------------------------------------------------
	describe("getPlanSummary", () => {
		it("should return unavailable state when no data sources exist", async () => {
			const model = createExecutionReadModel({});
			const summary = await model.getPlanSummary("exec-1");

			expect(summary.id).toBe("exec-1");
			expect(summary.status).toBe("unknown");
			expect(summary.dataAvailability).toBeDefined();
			expect(summary.dataAvailability!.available).toBe(false);
			expect(summary.dataAvailability!.reason).toContain("No plan_started event");
		});

		it("should reconstruct summary from plan_started event", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: { projectId: "proj-1", phase: "dev", title: "My Plan" },
						createdAt: ts(-5000),
					}),
				],
			});

			const summary = await model.getPlanSummary("exec-1");
			expect(summary.projectId).toBe("proj-1");
			expect(summary.phase).toBe("dev");
			expect(summary.title).toBe("My Plan");
			expect(summary.status).toBe("running");
			expect(summary.startedAt).toBeTruthy();
			expect(summary.completedAt).toBeNull();
			expect(summary.dataAvailability!.available).toBe(true);
		});

		it("should detect terminal status from plan_completed event", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: { projectId: "proj-1", phase: "dev", title: "My Plan" },
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						eventType: "plan_completed",
						payload: null,
						createdAt: ts(0),
					}),
				],
			});

			const summary = await model.getPlanSummary("exec-1");
			expect(summary.status).toBe("complete");
			expect(summary.completedAt).toBeTruthy();
		});

		it("should detect plan_failed status", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: { projectId: "proj-1", phase: "dev", title: "My Plan" },
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						eventType: "plan_failed",
						payload: null,
						createdAt: ts(0),
					}),
				],
			});

			const summary = await model.getPlanSummary("exec-1");
			expect(summary.status).toBe("failed");
		});

		it("should detect plan_cancelled status", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: { projectId: "proj-1", phase: "dev", title: "My Plan" },
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						eventType: "plan_cancelled",
						payload: null,
						createdAt: ts(0),
					}),
				],
			});

			const summary = await model.getPlanSummary("exec-1");
			expect(summary.status).toBe("cancelled");
		});

		it("should use state store when available", async () => {
			const model = createExecutionReadModel({
				getPlanExecutionSummary: async (id: string) => ({
					id,
					projectId: "proj-1",
					phase: "test",
					title: "State Plan",
					status: "complete",
					startedAt: new Date(Date.now() - 10000).toISOString(),
					completedAt: new Date().toISOString(),
					dataAvailability: { available: true },
				}),
			});

			const summary = await model.getPlanSummary("exec-1");
			expect(summary.title).toBe("State Plan");
			expect(summary.status).toBe("complete");
		});
	});

	// -----------------------------------------------------------------------
	// getPlanStats
	// -----------------------------------------------------------------------
	describe("getPlanStats", () => {
		it("should return unavailable data source when no events", async () => {
			const model = createExecutionReadModel({});
			const stats = await model.getPlanStats("exec-1");

			expect(stats.totalWorkspaces).toBe(0);
			expect(stats.dataSource).toBe("unavailable");
			expect(stats.durationMs).toBeNull();
		});

		it("should compute stats from workspace lifecycle events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: { totalWorkspaces: 3 },
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
					makeEvent({
						seq: "3",
						workspaceId: "ws-2",
						eventType: "workspace_failed",
						createdAt: ts(0),
					}),
					makeEvent({
						seq: "4",
						workspaceId: "ws-3",
						eventType: "workspace_running",
						createdAt: ts(0),
					}),
				],
			});

			const stats = await model.getPlanStats("exec-1");

			expect(stats.dataSource).toBe("events");
			expect(stats.totalWorkspaces).toBe(3);
			expect(stats.completedWorkspaces).toBe(1);
			expect(stats.failedWorkspaces).toBe(1);
			expect(stats.runningWorkspaces).toBe(1);
			expect(stats.pendingWorkspaces).toBe(0);
			expect(stats.durationMs).not.toBeNull();
		});

		it("should derive total from workspace count when plan_started missing", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-2",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
				],
			});

			const stats = await model.getPlanStats("exec-1");
			expect(stats.totalWorkspaces).toBe(2);
			expect(stats.completedWorkspaces).toBe(2);
		});

		it("should use latest event per workspace for terminal state", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "workspace_running",
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
				],
			});

			const stats = await model.getPlanStats("exec-1");
			expect(stats.completedWorkspaces).toBe(1);
			expect(stats.runningWorkspaces).toBe(0);
		});

		it("should detect blocked and skipped workspaces", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "workspace_blocked",
						createdAt: ts(0),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-2",
						eventType: "workspace_skipped",
						createdAt: ts(0),
					}),
				],
			});

			const stats = await model.getPlanStats("exec-1");
			expect(stats.blockedWorkspaces).toBe(1);
			expect(stats.skippedWorkspaces).toBe(1);
		});

		it("should report state-store data source when no events but state store has data", async () => {
			const model = createExecutionReadModel({
				getPlanExecutionSummary: async () =>
					({
						id: "exec-1",
						projectId: "proj-1",
						phase: "test",
						title: "Test",
						status: "running",
						startedAt: new Date().toISOString(),
						completedAt: null,
					}) as any,
			});

			const stats = await model.getPlanStats("exec-1");
			expect(stats.dataSource).toBe("state-store");
		});
	});

	// -----------------------------------------------------------------------
	// getDependencyGraph
	// -----------------------------------------------------------------------
	describe("getDependencyGraph", () => {
		it("should return unavailable state when no events", async () => {
			const model = createExecutionReadModel({});
			const graph = await model.getDependencyGraph("exec-1");

			expect(graph.nodes).toHaveLength(0);
			expect(graph.dataAvailability.available).toBe(false);
			expect(graph.dataAvailability.reason).toContain("workspace events");
		});

		it("should extract graph from plan_started event payload", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: {
							workspaces: [
								{ id: "ws-1", title: "Setup", dependencies: [], batch: 0 },
								{ id: "ws-2", title: "Build", dependencies: ["ws-1"], batch: 1 },
								{ id: "ws-3", title: "Test", dependencies: ["ws-1"], batch: 1 },
							],
						},
						createdAt: ts(-5000),
					}),
				],
			});

			const graph = await model.getDependencyGraph("exec-1");

			expect(graph.dataAvailability.available).toBe(true);
			expect(graph.nodes).toHaveLength(3);
			expect(graph.totalBatches).toBe(2);

			const ws2 = graph.nodes.find((n) => n.id === "ws-2");
			expect(ws2).toBeDefined();
			expect(ws2!.dependsOn).toEqual(["ws-1"]);
			expect(ws2!.batch).toBe(1);
		});

		it("should reconstruct graph from workspace events when plan_started missing", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "workspace_completed",
						payload: { dependencies: [], batch: 0 },
						createdAt: ts(0),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-2",
						eventType: "workspace_running",
						payload: { dependencies: ["ws-1"], batch: 1 },
						createdAt: ts(0),
					}),
				],
			});

			const graph = await model.getDependencyGraph("exec-1");

			expect(graph.dataAvailability.available).toBe(true);
			expect(graph.nodes).toHaveLength(2);
			expect(graph.totalBatches).toBe(2);
		});

		it("should return unavailable when plan_started payload has no workspaces array", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: { totalWorkspaces: 3 },
						createdAt: ts(-5000),
					}),
				],
			});

			const graph = await model.getDependencyGraph("exec-1");
			expect(graph.dataAvailability.available).toBe(false);
			expect(graph.dataAvailability.reason).toContain("workspace array");
		});

		it("should resolve current stage from workspace events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: {
							workspaces: [{ id: "ws-1", title: "Setup", dependencies: [], batch: 0 }],
						},
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
				],
			});

			const graph = await model.getDependencyGraph("exec-1");
			const ws1 = graph.nodes.find((n) => n.id === "ws-1");
			expect(ws1!.stage).toBe("Complete");
		});
	});

	// -----------------------------------------------------------------------
	// getWorkspaceSummary
	// -----------------------------------------------------------------------
	describe("getWorkspaceSummary", () => {
		it("should return unavailable state when no data sources", async () => {
			const model = createExecutionReadModel({});
			const summary = await model.getWorkspaceSummary("exec-1", "ws-1");

			expect(summary.stage).toBe("unknown");
			expect(summary.attempts).toBe(0);
			expect(summary.dataAvailability).toBeDefined();
			expect(summary.dataAvailability!.available).toBe(false);
		});

		it("should use state store when available", async () => {
			const model = createExecutionReadModel({
				getWorkspaceState: async (pid: string, wsId: string) => ({
					stage: "Complete",
					attempts: 3,
					startedAt: Date.now() - 10000,
					completedAt: Date.now(),
					error: undefined,
					reportPath: ".pi/reports/report.md",
				}),
			});

			const summary = await model.getWorkspaceSummary("exec-1", "ws-1");
			expect(summary.stage).toBe("Complete");
			expect(summary.attempts).toBe(3);
			expect(summary.startedAt).toBeTruthy();
			expect(summary.reportPath).toBe(".pi/reports/report.md");
			expect(summary.dataAvailability!.available).toBe(true);
		});

		it("should reconstruct from workspace events when state store unavailable", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "workspace_running",
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "worker_started",
						payload: { attemptNumber: 1 },
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "3",
						workspaceId: "ws-1",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
				],
			});

			const summary = await model.getWorkspaceSummary("exec-1", "ws-1");
			expect(summary.stage).toBe("Complete");
			expect(summary.attempts).toBe(1);
			expect(summary.dataAvailability!.available).toBe(true);
		});

		it("should extract error from worker_failed event", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "worker_failed",
						payload: { error: "Build failed" },
						createdAt: ts(0),
					}),
					// The workspace_failed event sets the stage
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "workspace_failed",
						payload: { error: "Build failed" },
						createdAt: ts(0),
					}),
				],
			});

			const summary = await model.getWorkspaceSummary("exec-1", "ws-1");
			expect(summary.stage).toBe("Failed");
			expect(summary.error).toBe("Build failed");
		});
	});

	// -----------------------------------------------------------------------
	// getCommandHistory
	// -----------------------------------------------------------------------
	describe("getCommandHistory", () => {
		it("should return empty array when no command events", async () => {
			const model = createExecutionReadModel({});
			const history = await model.getCommandHistory("exec-1", "ws-1");
			expect(history).toEqual([]);
		});

		it("should pair command_started and command_finished events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "npm test", cwd: "/project", runId: "run-1" },
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "npm test", cwd: "/project", runId: "run-1", exitCode: 0, outputSummary: "PASS" },
						createdAt: ts(0),
					}),
				],
			});

			const history = await model.getCommandHistory("exec-1", "ws-1");
			expect(history).toHaveLength(1);
			expect(history[0].command).toBe("npm test");
			expect(history[0].cwd).toBe("/project");
			expect(history[0].exitCode).toBe(0);
			expect(history[0].outputSummary).toBe("PASS");
			expect(history[0].startedAt).toBeLessThan(history[0].finishedAt);
		});

		it("should handle unmatched command_started without finished event", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "npm test", cwd: "/project" },
						createdAt: ts(-5000),
					}),
				],
			});

			const history = await model.getCommandHistory("exec-1", "ws-1");
			expect(history).toHaveLength(0);
		});

		it("should handle unmatched command_finished without started event", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "npm test", cwd: "/project", exitCode: 0 },
						createdAt: ts(0),
					}),
				],
			});

			const history = await model.getCommandHistory("exec-1", "ws-1");
			expect(history).toHaveLength(0);
		});

		it("should disambiguate concurrent commands with runId", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "npm test", cwd: "/project", runId: "run-1" },
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "npm test", cwd: "/project", runId: "run-2" },
						createdAt: ts(-4000),
					}),
					makeEvent({
						seq: "3",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "npm test", cwd: "/project", runId: "run-1", exitCode: 0 },
						createdAt: ts(-1000),
					}),
					makeEvent({
						seq: "4",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "npm test", cwd: "/project", runId: "run-2", exitCode: 1 },
						createdAt: ts(0),
					}),
				],
			});

			const history = await model.getCommandHistory("exec-1", "ws-1");
			expect(history).toHaveLength(2);
			expect(history[0].exitCode).toBe(0);
			expect(history[1].exitCode).toBe(1);
		});

		it("should sort by startedAt ascending", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "echo first", cwd: "/p", runId: "r1" },
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "echo second", cwd: "/p", runId: "r2" },
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "3",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "echo first", cwd: "/p", runId: "r1", exitCode: 0 },
						createdAt: ts(-8000),
					}),
					makeEvent({
						seq: "4",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "echo second", cwd: "/p", runId: "r2", exitCode: 0 },
						createdAt: ts(-2000),
					}),
				],
			});

			const history = await model.getCommandHistory("exec-1", "ws-1");
			expect(history).toHaveLength(2);
			expect(history[0].command).toBe("echo first");
			expect(history[1].command).toBe("echo second");
		});

		it("should handle missing exitCode", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "npm test", cwd: "/project" },
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "npm test", cwd: "/project" },
						createdAt: ts(0),
					}),
				],
			});

			const history = await model.getCommandHistory("exec-1", "ws-1");
			expect(history).toHaveLength(1);
			expect(history[0].exitCode).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// getLeadDirectives
	// -----------------------------------------------------------------------
	describe("getLeadDirectives", () => {
		it("should return empty array when no directive events", async () => {
			const model = createExecutionReadModel({});
			const directives = await model.getLeadDirectives("exec-1", "ws-1");
			expect(directives).toEqual([]);
		});

		it("should extract directives from lead_agent_directive_issued events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "lead_agent_directive_issued",
						payload: {
							directiveId: "dir-1",
							workspaceId: "ws-1",
							attemptNumber: 1,
							severity: "high",
							summary: "Fix the build",
							directive: "Run npm install and fix TypeScript errors",
							allowedActions: ["npm install", "edit *.ts"],
							forbiddenActions: ["git push"],
							maxAdditionalRetries: 3,
							escalateAfter: 2,
						},
						createdAt: ts(0),
					}),
				],
			});

			const directives = await model.getLeadDirectives("exec-1", "ws-1");
			expect(directives).toHaveLength(1);
			expect(directives[0].directiveId).toBe("dir-1");
			expect(directives[0].severity).toBe("high");
			expect(directives[0].status).toBe("issued");
			expect(directives[0].retryBudget).toBe(3);
			expect(directives[0].escalateAfter).toBe(2);
		});

		it("should mark directive as acknowledged when acknowledgement event exists", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "lead_agent_directive_issued",
						payload: {
							directiveId: "dir-1",
							workspaceId: "ws-1",
							summary: "Fix the build",
							directive: "Run fix",
						},
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "lead_agent_directive_acknowledged",
						payload: { directiveId: "dir-1" },
						createdAt: ts(0),
					}),
				],
			});

			const directives = await model.getLeadDirectives("exec-1", "ws-1");
			expect(directives).toHaveLength(1);
			expect(directives[0].status).toBe("acknowledged");
		});

		it("should handle missing optional fields with defaults", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "lead_agent_directive_issued",
						payload: { directiveId: "dir-1", workspaceId: "ws-1" },
						createdAt: ts(0),
					}),
				],
			});

			const directives = await model.getLeadDirectives("exec-1", "ws-1");
			expect(directives).toHaveLength(1);
			expect(directives[0].severity).toBe("medium");
			expect(directives[0].retryBudget).toBe(0);
			expect(directives[0].escalateAfter).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// getLeadEscalations
	// -----------------------------------------------------------------------
	describe("getLeadEscalations", () => {
		it("should return empty array when no escalation events", async () => {
			const model = createExecutionReadModel({});
			const escalations = await model.getLeadEscalations("exec-1", "ws-1");
			expect(escalations).toEqual([]);
		});

		it("should extract escalations from lead_agent_escalation_initiated events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "lead_agent_escalation_initiated",
						payload: {
							escalationId: "esc-1",
							workspaceId: "ws-1",
							severity: "blocking",
							title: "Build failure",
							summary: "Worker cannot fix TypeScript errors",
							whatHappened: "Build failed with 42 errors",
							whyStuck: "Missing type definitions",
							options: [
								{ id: "opt-1", label: "Install @types", risk: "low" },
								{ id: "opt-2", label: "Skip type check", risk: "medium" },
							],
							recommendedOptionId: "opt-1",
							evidenceRefs: ["tsconfig.json", "package.json"],
							logsToInspect: ["build.log"],
						},
						createdAt: ts(0),
					}),
				],
			});

			const escalations = await model.getLeadEscalations("exec-1", "ws-1");
			expect(escalations).toHaveLength(1);
			expect(escalations[0].escalationId).toBe("esc-1");
			expect(escalations[0].severity).toBe("blocking");
			expect(escalations[0].status).toBe("awaiting_user");
			expect(escalations[0].options).toHaveLength(2);
		});

		it("should mark escalation as resolved when resolved event exists", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "lead_agent_escalation_initiated",
						payload: {
							escalationId: "esc-1",
							workspaceId: "ws-1",
							severity: "high",
							title: "Test failure",
							summary: "Tests fail",
							whatHappened: "42 tests fail",
							whyStuck: "Missing mock",
							options: [{ id: "opt-1", label: "Fix", risk: "low" }],
							recommendedOptionId: "opt-1",
						},
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "lead_agent_escalation_resolved",
						payload: {
							escalationId: "esc-1",
							chosenOptionId: "opt-1",
							userResponse: "Go ahead",
						},
						createdAt: ts(0),
					}),
				],
			});

			const escalations = await model.getLeadEscalations("exec-1", "ws-1");
			expect(escalations).toHaveLength(1);
			expect(escalations[0].status).toBe("resolved");
			expect(escalations[0].userChoice).toBe("opt-1");
			expect(escalations[0].userResponse).toBe("Go ahead");
			expect(escalations[0].resolvedAt).toBeTruthy();
		});

		it("should handle missing optional escalation fields with defaults", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "lead_agent_escalation_initiated",
						payload: {
							escalationId: "esc-1",
							workspaceId: "ws-1",
						},
						createdAt: ts(0),
					}),
				],
			});

			const escalations = await model.getLeadEscalations("exec-1", "ws-1");
			expect(escalations).toHaveLength(1);
			expect(escalations[0].severity).toBe("medium");
			expect(escalations[0].options).toEqual([]);
			expect(escalations[0].evidenceRefs).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// getFinalValidationStatus
	// -----------------------------------------------------------------------
	describe("getFinalValidationStatus", () => {
		it("should return default state when no governance events", async () => {
			const model = createExecutionReadModel({});
			const status = await model.getFinalValidationStatus("exec-1", "ws-1");

			expect(status.required).toBe(true);
			expect(status.passed).toBeNull();
			expect(status.blocked).toBe(false);
			expect(status.blockReasons).toEqual([]);
		});

		it("should return passed=true when governance_approved is latest", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "governance_rejected",
						payload: { reason: "Failed lint" },
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "governance_approved",
						payload: null,
						createdAt: ts(0),
					}),
				],
			});

			const status = await model.getFinalValidationStatus("exec-1", "ws-1");
			expect(status.passed).toBe(true);
			expect(status.blocked).toBe(false);
		});

		it("should return blocked when governance_rejected is latest", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "governance_rejected",
						payload: { reason: "Failed lint check" },
						createdAt: ts(0),
					}),
				],
			});

			const status = await model.getFinalValidationStatus("exec-1", "ws-1");
			expect(status.passed).toBe(false);
			expect(status.blocked).toBe(true);
			expect(status.blockReasons).toEqual(["Failed lint check"]);
		});

		it("should return blocked with reason when governance_escalated", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "governance_escalated",
						payload: { reason: "Security concern" },
						createdAt: ts(0),
					}),
				],
			});

			const status = await model.getFinalValidationStatus("exec-1", "ws-1");
			expect(status.passed).toBeNull();
			expect(status.blocked).toBe(true);
			expect(status.blockReasons).toEqual(["Security concern"]);
		});
	});

	// -----------------------------------------------------------------------
	// getTranscript
	// -----------------------------------------------------------------------
	describe("getTranscript", () => {
		it("should return empty array when no events", async () => {
			const model = createExecutionReadModel({});
			const events = await model.getTranscript("exec-1", "ws-1");
			expect(events).toEqual([]);
		});

		it("should use transcript store when available", async () => {
			const model = createExecutionReadModel({
				getTranscriptEvents: async (_pid: string, wsId: string) => [
					{
						type: "workspace_complete" as any,
						timestamp: Date.now(),
						workspaceId: wsId,
						summary: "Workspace completed",
					},
				],
			});

			const events = await model.getTranscript("exec-1", "ws-1");
			expect(events).toHaveLength(1);
			expect(events[0].summary).toBe("Workspace completed");
		});

		it("should fallback to reconstructing from journal events when transcript store unavailable", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "npm test" },
						createdAt: ts(-5000),
					}),
				],
			});

			const events = await model.getTranscript("exec-1", "ws-1");
			expect(events.length).toBeGreaterThan(0);
			expect(events[0].type).toBeTruthy();
			expect(events[0].summary).toBeTruthy();
		});

		it("should return empty array when journal events exist for different workspace", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-other",
						eventType: "workspace_completed",
						createdAt: ts(0),
					}),
				],
			});

			const events = await model.getTranscript("exec-1", "ws-1");
			expect(events).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// getArtifacts
	// -----------------------------------------------------------------------
	describe("getArtifacts", () => {
		it("should return empty array when no archive access", async () => {
			const model = createExecutionReadModel({});
			const artifacts = await model.getArtifacts("exec-1");
			expect(artifacts).toEqual([]);
		});

		it("should return artifacts from archive lister", async () => {
			const model = createExecutionReadModel({
				listArchiveArtifacts: async () => [
					{ path: "plan.md", size: 100, modifiedAt: new Date().toISOString() },
					{ path: "workspaces/ws-1/packet.md", size: 200, modifiedAt: new Date().toISOString() },
				],
			});

			const artifacts = await model.getArtifacts("exec-1");
			expect(artifacts).toHaveLength(2);
			expect(artifacts[0].path).toBe("plan.md");
			expect(artifacts[0].dataAvailability.available).toBe(true);
			expect(artifacts[1].path).toBe("workspaces/ws-1/packet.md");
		});
	});

	// -----------------------------------------------------------------------
	// getFileContent (archive-backed)
	// -----------------------------------------------------------------------
	describe("getFileContent (archive-backed)", () => {
		it("should return file content from readArchiveFile", async () => {
			const model = createExecutionReadModel({
				readArchiveFile: async (pid: string, path: string) => {
					expect(path).toBe("workspaces/ws-1/src/index.ts");
					return "const x = 1;";
				},
			});

			const content = await model.getFileContent("exec-1", "ws-1", "src/index.ts");
			expect(content).not.toBeNull();
			expect(content!.content).toBe("const x = 1;");
			expect(content!.path).toBe("src/index.ts");
			expect(content!.language).toBe("ts");
		});

		it("should return null for path traversal attempts", async () => {
			const model = createExecutionReadModel({
				readArchiveFile: async () => "content",
			});

			const content = await model.getFileContent("exec-1", "ws-1", "../../etc/passwd");
			expect(content).toBeNull();
		});

		it("should return null when readArchiveFile returns null", async () => {
			const model = createExecutionReadModel({
				readArchiveFile: async () => null,
			});

			const content = await model.getFileContent("exec-1", "ws-1", "missing.ts");
			expect(content).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// getFileDiff (archive-backed)
	// -----------------------------------------------------------------------
	describe("getFileDiff (archive-backed)", () => {
		it("should return diff from archive diff.patch", async () => {
			const patchContent = `diff --git a/src/index.ts b/src/index.ts
index abc..def 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old content
+new content`;

			const model = createExecutionReadModel({
				readArchiveFile: async (pid: string, path: string) => {
					expect(path).toBe("workspaces/ws-1/diff.patch");
					return patchContent;
				},
			});

			const diffs = await model.getFileDiff("exec-1", "ws-1");
			expect(diffs).toHaveLength(1);
			expect(diffs[0].additions).toBe(1);
			expect(diffs[0].deletions).toBe(1);
		});

		it("should filter diff by specific file path", async () => {
			const patchContent = `diff --git a/src/index.ts b/src/index.ts
index abc..def 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-old
+new
diff --git a/README.md b/README.md
index 123..456 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# Old
+# New`;

			const model = createExecutionReadModel({
				readArchiveFile: async () => patchContent,
			});

			const diffs = await model.getFileDiff("exec-1", "ws-1", "src/index.ts");
			expect(diffs).toHaveLength(1);
			expect(diffs[0].path).toBe("src/index.ts");
		});

		it("should return empty array when diff.patch not found", async () => {
			const model = createExecutionReadModel({
				readArchiveFile: async () => null,
			});

			const diffs = await model.getFileDiff("exec-1", "ws-1");
			expect(diffs).toEqual([]);
		});

		it("should return empty array when file not found in patch", async () => {
			const patchContent = `diff --git a/other.ts b/other.ts
index abc..def 100644
--- a/other.ts
+++ b/other.ts
@@ -1 +1 @@
-old
+new`;

			const model = createExecutionReadModel({
				readArchiveFile: async () => patchContent,
			});

			const diffs = await model.getFileDiff("exec-1", "ws-1", "missing.ts");
			expect(diffs).toEqual([]);
		});

		it("should truncate diff when maxDiffLines specified", async () => {
			const lines: string[] = [];
			for (let i = 0; i < 100; i++) {
				lines.push(`+line ${i}`);
			}
			const patchContent = `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n${lines.join("\n")}`;

			const model = createExecutionReadModel({
				readArchiveFile: async () => patchContent,
			});

			const diffs = await model.getFileDiff("exec-1", "ws-1", "file.ts", { maxDiffLines: 50 });
			expect(diffs).toHaveLength(1);
			expect(diffs[0].truncated).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// getWorkerContext
	// -----------------------------------------------------------------------
	describe("getWorkerContext", () => {
		it("should return worker context from available data sources", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						eventType: "plan_started",
						payload: {
							workspaces: [{ id: "ws-1", title: "Setup", goal: "Initialize project", role: "coder" }],
						},
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "command_started",
						payload: { command: "npm init", cwd: "/project" },
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "3",
						workspaceId: "ws-1",
						eventType: "command_finished",
						payload: { command: "npm init", cwd: "/project", exitCode: 0, outputSummary: "Done" },
						createdAt: ts(0),
					}),
				],
			});

			const ctx = await model.getWorkerContext("exec-1", "ws-1");
			expect(ctx.workspaceId).toBe("ws-1");
			expect(ctx.goal).toBe("Initialize project");
			expect(ctx.role).toBe("coder");
			expect(ctx.lastCommand).toBe("npm init");
			expect(ctx.transcriptUrl).toBe("/api/transcript/exec-1/ws-1");
		});

		it("should include directives and escalations", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "lead_agent_directive_issued",
						payload: {
							directiveId: "dir-1",
							workspaceId: "ws-1",
							summary: "Fix build",
							directive: "Fix the build",
						},
						createdAt: ts(0),
					}),
				],
			});

			const ctx = await model.getWorkerContext("exec-1", "ws-1");
			expect(ctx.activeDirectives).toHaveLength(1);
			expect(ctx.activeDirectives[0].directiveId).toBe("dir-1");
			expect(ctx.activeEscalations).toEqual([]);
		});

		it("should load touched files from archive when readArchiveFile available", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [],
				readArchiveFile: async (pid: string, path: string) => {
					if (path === "workspaces/ws-1/files-touched.json") {
						return JSON.stringify([
							{ path: "src/index.ts", change: "modified" },
							{ path: "README.md", change: "created" },
						]);
					}
					return null;
				},
			});

			const ctx = await model.getWorkerContext("exec-1", "ws-1");
			expect(ctx.touchedFiles).toHaveLength(2);
			expect(ctx.touchedFiles[0].path).toBe("src/index.ts");
		});

		it("should load role packet from archive", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [],
				readArchiveFile: async (pid: string, path: string) => {
					if (path === "workspaces/ws-1/packet.md") {
						return "# Role Packet\n\nYou are a coder.\n\nFiles to edit: src/index.ts";
					}
					return null;
				},
			});

			const ctx = await model.getWorkerContext("exec-1", "ws-1");
			expect(ctx.rolePacketContent).toBe("# Role Packet\n\nYou are a coder.\n\nFiles to edit: src/index.ts");
			expect(ctx.contextPacketSummary).toBeTruthy();
		});

		it("should handle human directive", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "human_directive_issued",
						payload: { directive: "Skip the lint step" },
						createdAt: ts(0),
					}),
				],
			});

			const ctx = await model.getWorkerContext("exec-1", "ws-1");
			expect(ctx.humanDirective).toBe("Skip the lint step");
		});

		it("should handle cycle-break stage correctly", async () => {
			// Simulating a workspace that went through several stages
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "workspace_running",
						createdAt: ts(-10000),
					}),
					makeEvent({
						seq: "2",
						workspaceId: "ws-1",
						eventType: "workspace_failed",
						createdAt: ts(-5000),
					}),
					makeEvent({
						seq: "3",
						workspaceId: "ws-1",
						eventType: "workspace_running",
						createdAt: ts(-2000),
					}),
				],
			});

			const ctx = await model.getWorkerContext("exec-1", "ws-1");
			expect(ctx.stage).toBe("Running");
		});
	});

	// -----------------------------------------------------------------------
	// File tree edge cases
	// -----------------------------------------------------------------------
	describe("getFileTree edge cases", () => {
		it("should build tree with deeply nested paths", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: {
							changedFiles: ["a/b/c/d/file1.ts", "a/b/c/file2.ts", "a/b/file3.ts", "a/file4.ts"],
						},
						createdAt: ts(0),
					}),
				],
			});

			const tree = await model.getFileTree("exec-1", "ws-1");
			// Root should be "a"
			expect(tree).toHaveLength(1);
			expect(tree[0].path).toBe("a");
			expect(tree[0].isDir).toBe(true);
			// "a" should have "b" child with stats
			// "a" children: "b" (dir) + "file4.ts" (file at root of "a")
			expect(tree[0].children).toHaveLength(2);
			// Verify stats are aggregated
			expect(tree[0].additions).toBe(0); // No addition data
		});

		it("should add orphan files to root level", async () => {
			// File with a directory that has no other files
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					makeEvent({
						seq: "1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: {
							changedFiles: ["src/orphan.ts"],
						},
						createdAt: ts(0),
					}),
				],
			});

			const tree = await model.getFileTree("exec-1", "ws-1");
			expect(tree).toHaveLength(1);
			expect(tree[0].isDir).toBe(true);
			expect(tree[0].path).toBe("src");
			expect(tree[0].children).toHaveLength(1);
			expect(tree[0].children![0].path).toBe("src/orphan.ts");
		});
	});
});
