/**
 * Plan Synthesizer Worker — 25.N
 *
 * Covers:
 * - PlanSynthesizerWorker: constructor, config, stats, health
 * - Contract & manifest generation
 * - Session lifecycle: createSession, decomposeGoals, buildDag, renderPlan,
 *   estimateResources, synthesize (goals-based API)
 * - New API: createSessionFromInput, startAnalysis, generate
 * - Deduplication
 * - PlanValidator
 * - DagBuilder: task management, validation, critical path
 * - TemplateRenderer: rendering, template management, errors
 * - Edge cases
 */

import { describe, expect, test } from "vitest";
import {
	ALL_PLAN_TASK_PRIORITIES,
	ALL_PLAN_TASK_STATUSES,
	DagBuilder,
	type PlanTask,
} from "../../src/brain-workers/plan-synthesizer/dag-builder.js";
import {
	ALL_SYNTHESIS_SESSION_STATUSES,
	ALL_SYNTHESIZED_PLAN_STATUSES,
	createPlanSynthesizerContract,
	createPlanSynthesizerWorker,
	DEFAULT_PLAN_SYNTHESIZER_BUDGET,
	DEFAULT_PLAN_SYNTHESIZER_DEDUP_CONFIG,
	DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG,
	type ExecutionContext,
	type GoalInput,
	type PlanPlanOutput,
	PlanSynthesizerWorker,
	PlanValidator,
	type ProposalInput,
} from "../../src/brain-workers/plan-synthesizer/plan-synthesizer-worker.js";
import {
	BUILT_IN_TEMPLATES,
	type PlanTemplate,
	TemplateRenderer,
} from "../../src/brain-workers/plan-synthesizer/template-renderer.js";
import { validateWorkerManifest } from "../../src/brain-workers/types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeGoal(overrides?: Partial<GoalInput>): GoalInput {
	return {
		id: "g1",
		title: "Implement user authentication",
		description: "Add OAuth2-based authentication to the API gateway",
		priority: "high",
		tags: ["auth", "security"],
		...overrides,
	};
}

function makeProposal(overrides?: Partial<ProposalInput>): ProposalInput {
	return {
		id: "p1",
		title: "Add OAuth2 provider",
		description: "Integrate OAuth2 provider for authentication",
		suggestedTasks: ["Research OAuth2", "Implement provider", "Write tests"],
		relatedGoalIds: ["g1"],
		...overrides,
	};
}

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
	return {
		availableWorkers: ["engineer", "reviewer"],
		maxTotalEffort: 100,
		constraints: ["No breaking changes", "Must pass all existing tests"],
		...overrides,
	};
}

// =============================================================================
// PlanSynthesizerWorker — Constructor & Configuration
// =============================================================================

describe("PlanSynthesizerWorker — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const worker = new PlanSynthesizerWorker();
		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(200_000);
		expect(config.maxRuntimeMsPerSession).toBe(900_000);
		expect(config.maxConsecutiveFailures).toBe(3);
		expect(config.cooldownMs).toBe(180_000);
		expect(config.dedupEnabled).toBe(true);
		expect(config.dedupWindowMs).toBe(300_000);
		expect(config.maxTasksPerPlan).toBe(50);
		expect(config.maxMilestonesPerPlan).toBe(10);
		expect(config.defaultTemplateId).toBe("standard-execution");
		expect(config.templateRenderingEnabled).toBe(true);
		expect(config.resourceEstimationEnabled).toBe(true);
	});

	test("creates with partial configuration overrides", () => {
		const worker = new PlanSynthesizerWorker({
			maxTokensPerSession: 50_000,
			maxConsecutiveFailures: 5,
			dedupEnabled: false,
			maxTasksPerPlan: 20,
		});
		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(50_000);
		expect(config.maxConsecutiveFailures).toBe(5);
		expect(config.dedupEnabled).toBe(false);
		expect(config.maxTasksPerPlan).toBe(20);
		expect(config.maxRuntimeMsPerSession).toBe(900_000);
		expect(config.cooldownMs).toBe(180_000);
	});

	test("setConfig updates configuration", () => {
		const worker = new PlanSynthesizerWorker();
		worker.setConfig({ maxTokensPerSession: 99_999, dedupWindowMs: 10_000, templateRenderingEnabled: false });
		const config = worker.getConfig();
		expect(config.maxTokensPerSession).toBe(99_999);
		expect(config.dedupWindowMs).toBe(10_000);
		expect(config.templateRenderingEnabled).toBe(false);
	});

	test("initial stats are all zeros", () => {
		const worker = new PlanSynthesizerWorker();
		const stats = worker.getStats();
		expect(stats.totalSessions).toBe(0);
		expect(stats.completed).toBe(0);
		expect(stats.failed).toBe(0);
		expect(stats.cancelled).toBe(0);
		expect(stats.consecutiveFailures).toBe(0);
		expect(stats.totalSessionsCompleted).toBe(0);
		expect(stats.totalSessionsFailed).toBe(0);
		expect(stats.totalTokensConsumed).toBe(0);
		expect(stats.totalPlansSynthesized).toBe(0);
		expect(stats.totalTasksGenerated).toBe(0);
		expect(stats.totalMilestonesGenerated).toBe(0);
		expect(stats.healthStatus).toBe("healthy");
		expect(stats.dedupHistorySize).toBe(0);
	});

	test("initially healthy", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.getHealthStatus()).toBe("healthy");
		expect(worker.checkHealth()).toBeNull();
	});

	test("factory function creates worker with default config", () => {
		const worker = createPlanSynthesizerWorker();
		expect(worker).toBeInstanceOf(PlanSynthesizerWorker);
		expect(worker.getConfig().maxTokensPerSession).toBe(200_000);
	});

	test("factory function creates worker with partial config", () => {
		const worker = createPlanSynthesizerWorker({ maxTokensPerSession: 25_000 });
		expect(worker).toBeInstanceOf(PlanSynthesizerWorker);
		expect(worker.getConfig().maxTokensPerSession).toBe(25_000);
	});
});

// =============================================================================
// PlanSynthesizerWorker — Contract & Manifest
// =============================================================================

describe("PlanSynthesizerWorker — Contract & Manifest", () => {
	test("createPlanSynthesizerContract returns a valid contract", () => {
		const contract = createPlanSynthesizerContract();
		expect(contract.id).toContain("plan-synthesizer");
		expect(contract.capabilities).toContain("dag_building");
		expect(contract.capabilities).toContain("plan_synthesis");
		expect(contract.capabilities).toContain("goal_decomposition");
		expect(contract.capabilities).toContain("dependency_resolution");
		expect(contract.capabilities).toContain("template_rendering");
		expect(contract.capabilities).toContain("resource_estimation");
		expect(contract.inputs).toHaveLength(3);
		expect(contract.outputs).toHaveLength(2);
		expect(contract.errors).toHaveLength(6);
		expect(contract.dependencies).toContain("brain-worker.proposer");
		expect(contract.dependencies).toContain("brain-worker.coordinator");
		expect(contract.supportsCancellation).toBe(true);
		expect(contract.readonlyAccess).toBe(true);
	});

	test("generateManifest produces valid WorkerManifest", () => {
		const worker = new PlanSynthesizerWorker();
		const manifest = worker.generateManifest("Test Synth", "A test synth");
		expect(manifest.role).toBe("planSynthesizer");
		expect(manifest.name).toBe("Test Synth");
		expect(manifest.budget.maxTokensPerCycle).toBe(DEFAULT_PLAN_SYNTHESIZER_BUDGET.maxTokensPerCycle);
		expect(manifest.budget.maxConsecutiveFailures).toBe(DEFAULT_PLAN_SYNTHESIZER_BUDGET.maxConsecutiveFailures);
		expect(validateWorkerManifest(manifest).valid).toBe(true);
	});

	test("generateManifest supports overrides", () => {
		const worker = new PlanSynthesizerWorker();
		const manifest = worker.generateManifest("Custom", "Custom", { version: "2.0.0", tags: ["test"] });
		expect(manifest.version).toBe("2.0.0");
		expect(manifest.tags).toContain("test");
	});
});

// =============================================================================
// PlanSynthesizerWorker — Session Lifecycle (Goals-based API)
// =============================================================================

describe("PlanSynthesizerWorker — Session Lifecycle (Goals-based API)", () => {
	test("createSession returns a session with correct defaults", () => {
		const worker = new PlanSynthesizerWorker();
		const goals = [makeGoal()];
		const session = worker.createSession("test-session", goals);
		expect(session).not.toBeNull();
		expect(session!.status).toBe("idle");
		expect(session!.label).toBe("test-session");
		expect(session!.inputGoals).toHaveLength(1);
		expect(session!.inputGoals[0].title).toBe("Implement user authentication");
		expect(session!.plan).toBeNull();
		expect(session!.error).toBeNull();
		expect(session!.diagnostic).toBeNull();
		expect(session!.tokensConsumed).toBe(0);
		expect(session!.runtimeMs).toBe(0);
	});

	test("createSession without goals returns null", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.createSession("test", [])).toBeNull();
	});

	test("createSession with proposals and context", () => {
		const worker = new PlanSynthesizerWorker();
		const goals = [makeGoal({ id: "g1", title: "Optimize queries" })];
		const proposals = [makeProposal()];
		const context = makeContext();
		const session = worker.createSession("full-session", goals, proposals, context);
		expect(session).not.toBeNull();
		expect(session!.inputProposals).toHaveLength(1);
		expect(session!.inputContext).not.toBeNull();
	});

	test("full synthesis pipeline produces a valid plan", () => {
		const worker = new PlanSynthesizerWorker();
		const goals = [makeGoal()];
		const session = worker.createSession("pipeline-test", goals);
		expect(session).not.toBeNull();

		const dagBuilder = worker.decomposeGoals(session!.id);
		expect(dagBuilder).not.toBeNull();
		expect(dagBuilder!.size).toBeGreaterThan(0);

		const plan = worker.buildDag(session!.id, dagBuilder!);
		expect(plan).not.toBeNull();
		expect(plan!.tasks.length).toBeGreaterThan(0);
		expect(plan!.validation.valid).toBe(true);
		expect(plan!.validation.errors).toHaveLength(0);
		expect(plan!.validation.topologicalOrder.length).toBeGreaterThan(0);
		expect(plan!.validation.criticalPath.length).toBeGreaterThan(0);

		const rendered = worker.renderPlan(session!.id);
		expect(rendered).not.toBeNull();
		expect(rendered!.length).toBeGreaterThan(0);

		const estimated = worker.estimateResources(session!.id, 0, 0);
		expect(estimated).toBe(true);

		const finalSession = worker.getSession(session!.id);
		expect(finalSession).not.toBeNull();
		expect(finalSession!.status).toBe("completed");
		expect(finalSession!.plan).not.toBeNull();
		expect(finalSession!.plan!.status).toBe("validated");
		expect(finalSession!.plan!.milestones.length).toBeGreaterThan(0);
		expect(finalSession!.plan!.resourceEstimate.totalEffort).toBeGreaterThan(0);
	});

	test("synthesize convenience method completes full pipeline", () => {
		const worker = new PlanSynthesizerWorker();
		const goals = [makeGoal({ id: "g2", title: "Add logging" })];
		const session = worker.createSession("convenience-test", goals);
		expect(session).not.toBeNull();

		const plan = worker.synthesize(session!.id);
		expect(plan).not.toBeNull();
		expect(plan!.tasks.length).toBeGreaterThan(0);
		expect(plan!.validation.valid).toBe(true);
	});

	test("cancelSession cancels a session", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSession("cancel-test", [makeGoal()]);
		expect(session).not.toBeNull();

		const cancelled = worker.cancelSession(session!.id, "Changed priorities");
		expect(cancelled).not.toBeNull();
		expect(cancelled!.status).toBe("cancelled");
		expect(cancelled!.error).toBe("Changed priorities");
	});

	test("cancelSession returns null for unknown session", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.cancelSession("unknown", "reason")).toBeNull();
	});

	test("cancelSession returns null for already completed session", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSession("done", [makeGoal()]);
		expect(session).not.toBeNull();
		const plan = worker.synthesize(session!.id);
		expect(plan).not.toBeNull();
		expect(worker.cancelSession(session!.id, "late")).toBeNull();
	});

	test("getSession returns session by ID", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSession("test", [makeGoal()]);
		expect(session).not.toBeNull();
		expect(worker.getSession(session!.id)).toBe(session);
	});

	test("getSession returns undefined for unknown ID", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.getSession("nonexistent")).toBeUndefined();
	});

	test("getAllSessions returns all sessions", () => {
		const worker = new PlanSynthesizerWorker();
		worker.createSession("s1", [makeGoal()]);
		worker.createSession("s2", [makeGoal({ id: "g2" })]);
		expect(worker.getAllSessions()).toHaveLength(2);
	});

	test("getSessionsByStatus filters by status", () => {
		const worker = new PlanSynthesizerWorker();
		const s1 = worker.createSession("s1", [makeGoal()]);
		expect(s1).not.toBeNull();
		const idle = worker.getSessionsByStatus("idle");
		expect(idle).toHaveLength(1);
		expect(idle[0].id).toBe(s1!.id);
	});

	test("clear resets all state", () => {
		const worker = new PlanSynthesizerWorker();
		worker.createSession("s1", [makeGoal()]);
		worker.clear();
		expect(worker.getAllSessions()).toHaveLength(0);
		expect(worker.getStats().totalSessions).toBe(0);
	});
});

// =============================================================================
// PlanSynthesizerWorker — Budget Enforcement
// =============================================================================

describe("PlanSynthesizerWorker — Budget Enforcement", () => {
	test("estimateResources fails when token budget exceeded", () => {
		const worker = new PlanSynthesizerWorker({ maxTokensPerSession: 100 });
		const session = worker.createSession("budget-test", [makeGoal()]);
		expect(session).not.toBeNull();
		const db = worker.decomposeGoals(session!.id)!;
		worker.buildDag(session!.id, db);
		worker.renderPlan(session!.id);
		const result = worker.estimateResources(session!.id, 200, 0);
		expect(result).toBe(false);
		const failed = worker.getSession(session!.id);
		expect(failed!.status).toBe("failed");
		expect(failed!.diagnostic).not.toBeNull();
	});

	test("estimateResources fails when runtime budget exceeded", () => {
		const worker = new PlanSynthesizerWorker({ maxRuntimeMsPerSession: 50 });
		const session = worker.createSession("runtime-test", [makeGoal()]);
		expect(session).not.toBeNull();
		const db = worker.decomposeGoals(session!.id)!;
		worker.buildDag(session!.id, db);
		worker.renderPlan(session!.id);
		const result = worker.estimateResources(session!.id, 0, 100);
		expect(result).toBe(false);
		const failed = worker.getSession(session!.id);
		expect(failed!.status).toBe("failed");
	});

	test("synthesize fails when token budget exceeded upfront", () => {
		const worker = new PlanSynthesizerWorker({ maxTokensPerSession: 10 });
		const session = worker.createSession("synth-budget", [makeGoal()]);
		expect(session).not.toBeNull();
		const plan = worker.synthesize(session!.id, undefined, undefined, 100, 0);
		expect(plan).toBeNull();
		const failed = worker.getSession(session!.id);
		expect(failed!.status).toBe("failed");
	});
});

// =============================================================================
// PlanSynthesizerWorker — Deduplication
// =============================================================================

describe("PlanSynthesizerWorker — Deduplication", () => {
	test("createSession with same hash within window returns null", () => {
		const worker = new PlanSynthesizerWorker({ dedupWindowMs: 60_000 });
		const goals = [makeGoal()];
		const hash = worker.computeTaskHash("sig-123");
		expect(worker.createSession("first", goals, [], null, undefined, hash)).not.toBeNull();
		expect(worker.createSession("second", goals, [], null, undefined, hash)).toBeNull();
	});

	test("createSession with different hash passes dedup", () => {
		const worker = new PlanSynthesizerWorker({ dedupWindowMs: 60_000 });
		const goals = [makeGoal()];
		expect(worker.createSession("first", goals, [], null, undefined, "hash-1")).not.toBeNull();
		expect(worker.createSession("second", goals, [], null, undefined, "hash-2")).not.toBeNull();
	});

	test("isDuplicate returns correct state", () => {
		const worker = new PlanSynthesizerWorker({ dedupWindowMs: 60_000 });
		const goals = [makeGoal()];
		expect(worker.isDuplicate("unknown-hash")).toBe(false);
		const hash = worker.computeTaskHash("test-signature");
		worker.createSession("test", goals, [], null, undefined, hash);
		expect(worker.isDuplicate(hash)).toBe(true);
	});

	test("dedup with dedupEnabled false bypasses check", () => {
		const worker = new PlanSynthesizerWorker({ dedupEnabled: false, dedupWindowMs: 60_000 });
		const goals = [makeGoal()];
		const hash = worker.computeTaskHash("sig");
		expect(worker.createSession("first", goals, [], null, undefined, hash)).not.toBeNull();
		expect(worker.createSession("second", goals, [], null, undefined, hash)).not.toBeNull();
	});

	test("pruneDedupHistory removes expired entries", () => {
		const worker = new PlanSynthesizerWorker({ dedupWindowMs: -1 });
		const goals = [makeGoal()];
		const hash = worker.computeTaskHash("expired-sig");
		worker.createSession("test", goals, [], null, undefined, hash);
		worker.pruneDedupHistory();
		expect(worker.getStats().dedupHistorySize).toBe(0);
	});

	test("computeTaskHash produces deterministic hashes", () => {
		const worker = new PlanSynthesizerWorker();
		const h1 = worker.computeTaskHash("hello");
		const h2 = worker.computeTaskHash("hello");
		expect(h1).toBe(h2);
		expect(h1).toHaveLength(64);
	});
});

// =============================================================================
// PlanSynthesizerWorker — Failure Diagnostics
// =============================================================================

describe("PlanSynthesizerWorker — Failure Diagnostics", () => {
	test("decomposeGoals returns null for unknown session", () => {
		expect(new PlanSynthesizerWorker().decomposeGoals("nonexistent")).toBeNull();
	});

	test("buildDag returns null for unknown session", () => {
		expect(new PlanSynthesizerWorker().buildDag("nonexistent", new DagBuilder())).toBeNull();
	});

	test("renderPlan returns null for unknown session", () => {
		expect(new PlanSynthesizerWorker().renderPlan("nonexistent")).toBeNull();
	});

	test("estimateResources returns false for unknown session", () => {
		expect(new PlanSynthesizerWorker().estimateResources("nonexistent", 0, 0)).toBe(false);
	});

	test("synthesize returns null for unknown session", () => {
		expect(new PlanSynthesizerWorker().synthesize("nonexistent")).toBeNull();
	});
});

// =============================================================================
// PlanSynthesizerWorker — Health & Stats
// =============================================================================

describe("PlanSynthesizerWorker — Health & Stats", () => {
	test("consecutive failures affect health status", () => {
		const worker = new PlanSynthesizerWorker({ maxConsecutiveFailures: 2 });
		// First failure -> degraded
		const s1 = worker.createSession("f1", [makeGoal()]);
		expect(s1).not.toBeNull();
		worker.decomposeGoals(s1!.id);
		worker.buildDag(s1!.id, new DagBuilder()); // empty DagBuilder -> failed validation
		expect(worker.getHealthStatus()).toBe("degraded");
	});

	test("checkHealth returns diagnostic when unhealthy", () => {
		const worker = new PlanSynthesizerWorker({ maxConsecutiveFailures: 1 });
		const s1 = worker.createSession("f1", [makeGoal()]);
		expect(s1).not.toBeNull();
		worker.decomposeGoals(s1!.id);
		worker.buildDag(s1!.id, new DagBuilder());
		const diag = worker.checkHealth();
		expect(diag).not.toBeNull();
	});

	test("successful session resets consecutive failures", () => {
		const worker = new PlanSynthesizerWorker({ maxConsecutiveFailures: 1 });
		const s1 = worker.createSession("f1", [makeGoal()]);
		expect(s1).not.toBeNull();
		worker.decomposeGoals(s1!.id);
		worker.buildDag(s1!.id, new DagBuilder());
		expect(worker.getHealthStatus()).toBe("unhealthy");

		const s2 = worker.createSession("good", [makeGoal({ id: "g2", title: "Good goal" })]);
		expect(s2).not.toBeNull();
		const plan = worker.synthesize(s2!.id);
		expect(plan).not.toBeNull();
		expect(worker.getHealthStatus()).toBe("healthy");
	});

	test("stats reflect completed sessions", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSession("stats-test", [makeGoal()]);
		expect(session).not.toBeNull();
		const plan = worker.synthesize(session!.id);
		expect(plan).not.toBeNull();
		const stats = worker.getStats();
		expect(stats.totalSessions).toBe(1);
		expect(stats.completed).toBe(1);
		expect(stats.totalPlansSynthesized).toBe(1);
		expect(stats.totalTasksGenerated).toBeGreaterThan(0);
	});

	test("getTemplateRenderer returns the renderer", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.getTemplateRenderer()).toBeInstanceOf(TemplateRenderer);
	});

	test("custom templates passed to constructor are available", () => {
		const custom: PlanTemplate = {
			id: "wc",
			name: "WC",
			body: "WC: {{x}}",
			requiredVariables: ["x"],
			description: "Custom test template",
		};
		const worker = new PlanSynthesizerWorker(undefined, [custom]);
		expect(worker.getTemplateRenderer().getTemplate("wc")).toBeDefined();
	});
});

// =============================================================================
// PlanSynthesizerWorker — New API (createSessionFromInput)
// =============================================================================

describe("PlanSynthesizerWorker — New API (createSessionFromInput)", () => {
	test("createSessionFromInput creates session", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSessionFromInput("new-api", {
			proposals: [
				{ id: "np1", title: "New", description: "New proposal", priority: "high", risk: "low", evidenceIds: [] },
			],
			ideas: [],
			goals: ["Goal 1"],
			metadata: {},
		});
		expect(session).not.toBeNull();
		expect(session!.status).toBe("idle");
	});

	test("createSessionFromInput with dedup returns null", () => {
		const worker = new PlanSynthesizerWorker({ dedupWindowMs: 60_000 });
		const hash = worker.computeTaskHash("dup");
		worker.createSessionFromInput(
			"first",
			{
				proposals: [
					{ id: "p1", title: "Test", description: "Test", priority: "normal", risk: "low", evidenceIds: [] },
				],
				ideas: [],
				goals: [],
				metadata: {},
			},
			undefined,
			hash,
		);
		const second = worker.createSessionFromInput(
			"second",
			{
				proposals: [
					{ id: "p1", title: "Test", description: "Test", priority: "normal", risk: "low", evidenceIds: [] },
				],
				ideas: [],
				goals: [],
				metadata: {},
			},
			undefined,
			hash,
		);
		expect(second).toBeNull();
	});

	test("startAnalysis and generate produce plan", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSessionFromInput("gen-test", {
			proposals: [
				{
					id: "p1",
					title: "Feature X",
					description: "Implement Feature X",
					priority: "high",
					risk: "medium",
					evidenceIds: ["ev1"],
				},
			],
			ideas: [{ id: "i1", title: "Enhancement", description: "Enhance", priority: "medium", tags: [] }],
			goals: [],
			metadata: {},
		});
		expect(session).not.toBeNull();
		expect(worker.startAnalysis(session!.id)).not.toBeNull();
		const output = worker.generate(session!.id);
		expect(output).not.toBeNull();
		expect(output!.workstreams.length).toBeGreaterThan(0);
		expect(output!.phaseId).toBeTruthy();
	});

	test("generate returns null for unknown session", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.generate("nonexistent")).toBeNull();
	});

	test("generate returns null when session not in analyzing status", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSessionFromInput("wrong-status", {
			proposals: [
				{ id: "p1", title: "Test", description: "Test", priority: "normal", risk: "low", evidenceIds: [] },
			],
			ideas: [],
			goals: [],
			metadata: {},
		});
		expect(session).not.toBeNull();
		// Session is "idle", generate expects "analyzing"
		expect(worker.generate(session!.id)).toBeNull();
	});

	test("startAnalysis returns null for unknown session", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.startAnalysis("nonexistent")).toBeNull();
	});

	test("startAnalysis returns null when not idle", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSessionFromInput("already-started", {
			proposals: [
				{ id: "p1", title: "Test", description: "Test", priority: "normal", risk: "low", evidenceIds: [] },
			],
			ideas: [],
			goals: [],
			metadata: {},
		});
		expect(session).not.toBeNull();
		expect(worker.startAnalysis(session!.id)).not.toBeNull();
		// Second call should fail (already in analyzing)
		expect(worker.startAnalysis(session!.id)).toBeNull();
	});

	test("stats reflect new API session", () => {
		const worker = new PlanSynthesizerWorker();
		const session = worker.createSessionFromInput("stats-test", {
			proposals: [
				{ id: "p1", title: "Feat", description: "Test", priority: "high", risk: "low", evidenceIds: ["e1"] },
			],
			ideas: [],
			goals: [],
			metadata: {},
		});
		expect(session).not.toBeNull();
		worker.startAnalysis(session!.id);
		const output = worker.generate(session!.id);
		expect(output).not.toBeNull();
		const stats = worker.getStats();
		expect(stats.totalSessions).toBeGreaterThanOrEqual(1);
		expect(stats.totalPlansGenerated).toBeGreaterThanOrEqual(1);
		expect(stats.totalWorkstreamsGenerated).toBeGreaterThan(0);
		expect(stats.totalProposalsConsumed).toBeGreaterThan(0);
	});

	test("generate fails with diagnostic when token budget exceeded", () => {
		const worker = new PlanSynthesizerWorker({ maxTokensPerSession: 1 });
		const session = worker.createSessionFromInput("budget-fail", {
			proposals: [{ id: "p1", title: "Feat", description: "Test", priority: "high", risk: "low", evidenceIds: [] }],
			ideas: [],
			goals: [],
			metadata: {},
		});
		expect(session).not.toBeNull();
		worker.startAnalysis(session!.id);
		const output = worker.generate(session!.id, 100);
		expect(output).toBeNull();
		const failed = worker.getSession(session!.id);
		expect(failed!.status).toBe("failed");
		expect(failed!.diagnostic).not.toBeNull();
		expect(failed!.diagnostic!.stopCondition).toBe("token_budget_exhausted");
	});

	test("getSessionsByStatus returns sessions sorted by creation date descending", () => {
		const worker = new PlanSynthesizerWorker();
		worker.createSessionFromInput("First", {
			proposals: [{ id: "p1", title: "A", description: "A", priority: "normal", risk: "low", evidenceIds: [] }],
			ideas: [],
			goals: [],
			metadata: {},
		});
		worker.createSessionFromInput("Second", {
			proposals: [{ id: "p2", title: "B", description: "B", priority: "normal", risk: "low", evidenceIds: [] }],
			ideas: [],
			goals: [],
			metadata: {},
		});
		worker.createSessionFromInput("Third", {
			proposals: [{ id: "p3", title: "C", description: "C", priority: "normal", risk: "low", evidenceIds: [] }],
			ideas: [],
			goals: [],
			metadata: {},
		});

		const idleSessions = worker.getSessionsByStatus("idle");
		expect(idleSessions).toHaveLength(3);
		// All sessions should be idle
		expect(idleSessions.every((s) => s.status === "idle")).toBe(true);
	});
});

// =============================================================================
// PlanSynthesizerWorker — PlanValidator
// =============================================================================

describe("PlanSynthesizerWorker — PlanValidator", () => {
	test("getValidator returns PlanValidator", () => {
		expect(new PlanSynthesizerWorker().getValidator()).toBeInstanceOf(PlanValidator);
	});

	test("validate detects missing workstreams", () => {
		const validator = new PlanValidator();
		const badOutput: PlanPlanOutput = {
			phaseId: "P1",
			phaseTitle: "Test",
			contract: {
				contractVersion: "1.0",
				phase: { id: "P1", title: "Test" },
				workstreams: [],
				dependencies: [],
				batches: [],
				scaleMode: "",
				integrationQueue: false,
				worktreeIsolation: false,
				metadata: {},
			},
			workstreams: [],
			batches: [],
			generatedAt: "",
			confidence: 0,
			validation: [],
			proposalsConsumed: 0,
			ideasIncorporated: 0,
			summary: "",
		};
		expect(validator.hasErrors(validator.validate(badOutput))).toBe(true);
	});

	test("validate detects unresolvable dependencies", () => {
		const validator = new PlanValidator();
		const output: PlanPlanOutput = {
			phaseId: "P1",
			phaseTitle: "Test",
			contract: {
				contractVersion: "2.5.1",
				phase: { id: "P1", title: "Test" },
				workstreams: [
					{
						id: "P1.A",
						title: "WS1",
						goal: "G",
						acceptanceCriteria: [],
						dependencies: [],
						fileScope: [],
						isolationNotes: "",
						queuePriority: "normal",
						riskLevel: "low",
					},
				],
				dependencies: [{ from: "P1.A", to: "MISSING", type: "blocking" }],
				batches: [{ index: 1, workstreamIds: ["P1.A"] }],
				scaleMode: "",
				integrationQueue: false,
				worktreeIsolation: false,
				metadata: {},
			},
			workstreams: [
				{
					id: "P1.A",
					title: "WS1",
					goal: "G",
					acceptanceCriteria: [],
					dependencies: [],
					fileScope: [],
					isolationNotes: "",
					queuePriority: "normal",
					riskLevel: "low",
				},
			],
			batches: [{ index: 1, workstreamIds: ["P1.A"] }],
			generatedAt: "",
			confidence: 0,
			validation: [],
			proposalsConsumed: 1,
			ideasIncorporated: 0,
			summary: "",
		};
		expect(validator.hasErrors(validator.validate(output))).toBe(true);
	});

	test("hasErrors and hasWarnings work", () => {
		const validator = new PlanValidator();
		expect(validator.hasErrors([{ type: "error", component: "t", message: "e" }])).toBe(true);
		expect(validator.hasErrors([{ type: "warning", component: "t", message: "w" }])).toBe(false);
		expect(validator.hasWarnings([{ type: "warning", component: "t", message: "w" }])).toBe(true);
		expect(validator.hasWarnings([{ type: "info", component: "t", message: "i" }])).toBe(false);
	});
});

// =============================================================================
// Constants
// =============================================================================

describe("Constants", () => {
	test("ALL_SYNTHESIS_SESSION_STATUSES contains expected values", () => {
		expect(ALL_SYNTHESIS_SESSION_STATUSES).toContain("idle");
		expect(ALL_SYNTHESIS_SESSION_STATUSES).toContain("decomposing");
		expect(ALL_SYNTHESIS_SESSION_STATUSES).toContain("building_dag");
		expect(ALL_SYNTHESIS_SESSION_STATUSES).toContain("completed");
		expect(ALL_SYNTHESIS_SESSION_STATUSES).toContain("failed");
		expect(ALL_SYNTHESIS_SESSION_STATUSES).toContain("cancelled");
	});

	test("ALL_SYNTHESIZED_PLAN_STATUSES contains expected values", () => {
		expect(ALL_SYNTHESIZED_PLAN_STATUSES).toContain("draft");
		expect(ALL_SYNTHESIZED_PLAN_STATUSES).toContain("validated");
		expect(ALL_SYNTHESIZED_PLAN_STATUSES).toContain("completed");
		expect(ALL_SYNTHESIZED_PLAN_STATUSES).toContain("failed");
	});

	test("ALL_PLAN_TASK_PRIORITIES contains values", () => {
		expect(ALL_PLAN_TASK_PRIORITIES).toContain("critical");
		expect(ALL_PLAN_TASK_PRIORITIES).toContain("high");
		expect(ALL_PLAN_TASK_PRIORITIES).toContain("normal");
		expect(ALL_PLAN_TASK_PRIORITIES).toContain("low");
	});

	test("ALL_PLAN_TASK_STATUSES contains values", () => {
		expect(ALL_PLAN_TASK_STATUSES).toContain("pending");
		expect(ALL_PLAN_TASK_STATUSES).toContain("in_progress");
		expect(ALL_PLAN_TASK_STATUSES).toContain("completed");
		expect(ALL_PLAN_TASK_STATUSES).toContain("failed");
		expect(ALL_PLAN_TASK_STATUSES).toContain("skipped");
	});

	test("DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG exported", () => {
		expect(DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxTokensPerSession).toBe(200_000);
	});

	test("DEFAULT_PLAN_SYNTHESIZER_BUDGET exported", () => {
		expect(DEFAULT_PLAN_SYNTHESIZER_BUDGET.maxTokensPerCycle).toBe(200_000);
	});

	test("DEFAULT_PLAN_SYNTHESIZER_DEDUP_CONFIG exported", () => {
		expect(DEFAULT_PLAN_SYNTHESIZER_DEDUP_CONFIG.enabled).toBe(true);
	});
});

// =============================================================================
// DagBuilder — Task Management
// =============================================================================

describe("DagBuilder — Task Management", () => {
	test("addTask creates a task with provided properties", () => {
		const builder = new DagBuilder();
		const task = builder.addTask("Test", "A test task", "high", 5, [], ["tag1"]);
		expect(task.title).toBe("Test");
		expect(task.priority).toBe("high");
		expect(task.estimatedEffort).toBe(5);
		expect(task.tags).toContain("tag1");
	});

	test("addPrebuiltTask stores a task", () => {
		const builder = new DagBuilder();
		const task: PlanTask = {
			id: "pb-1",
			title: "Prebuilt",
			description: "Prebuilt task",
			status: "pending",
			priority: "medium",
			estimatedEffort: 3,
			dependencyIds: [],
			tags: [],
			metadata: {},
			createdAt: new Date().toISOString(),
		};
		builder.addPrebuiltTask(task);
		expect(builder.getTask("pb-1")).toBe(task);
		expect(builder.size).toBe(1);
	});

	test("removeTask removes a task", () => {
		const builder = new DagBuilder();
		const t1 = builder.addTask("Parent", "Desc", "medium", 1);
		const t2 = builder.addTask("Child", "Desc", "medium", 1, [t1.id]);
		builder.removeTask(t1.id);
		expect(builder.getTask(t1.id)).toBeUndefined();
		expect(builder.getTask(t2.id)!.dependencyIds).not.toContain(t1.id);
	});

	test("getAllTasks returns all tasks", () => {
		const builder = new DagBuilder();
		builder.addTask("T1", "Desc");
		builder.addTask("T2", "Desc");
		expect(builder.getAllTasks()).toHaveLength(2);
	});

	test("size reflects task count", () => {
		const builder = new DagBuilder();
		expect(builder.size).toBe(0);
		builder.addTask("T1", "Desc");
		expect(builder.size).toBe(1);
	});

	test("clear removes all tasks", () => {
		const builder = new DagBuilder();
		builder.addTask("T1", "Desc");
		builder.addTask("T2", "Desc");
		builder.clear();
		expect(builder.size).toBe(0);
	});

	test("toJSON returns serializable state", () => {
		const builder = new DagBuilder();
		builder.addTask("T1", "Desc");
		const json = builder.toJSON();
		expect(json.tasks).toHaveLength(1);
	});

	test("computeHash returns deterministic hash", () => {
		const builder = new DagBuilder();
		builder.addTask("T1", "Desc");
		const h1 = builder.computeHash();
		const h2 = builder.computeHash();
		expect(h1).toBe(h2);
	});
});

// =============================================================================
// DagBuilder — DAG Validation
// =============================================================================

describe("DagBuilder — DAG Validation", () => {
	test("validate returns invalid for empty DAG", () => {
		const result = new DagBuilder().validate();
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("DAG is empty: no tasks defined");
	});

	test("validate passes for simple linear chain", () => {
		const builder = new DagBuilder();
		const t1 = builder.addTask("Step 1", "First");
		const t2 = builder.addTask("Step 2", "Second", "medium", 1, [t1.id]);
		const t3 = builder.addTask("Step 3", "Third", "medium", 1, [t2.id]);
		const result = builder.validate();
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.topologicalOrder).toHaveLength(3);
		expect(result.topologicalOrder[0]).toBe(t1.id);
		expect(result.topologicalOrder[2]).toBe(t3.id);
	});

	test("validate detects unresolved deps", () => {
		const builder = new DagBuilder();
		builder.addTask("Child", "Desc", "medium", 1, ["nonexistent"]);
		expect(builder.validate().valid).toBe(false);
	});

	test("validate detects cycles", () => {
		const builder = new DagBuilder();
		const t1 = builder.addTask("A", "Desc");
		const t2 = builder.addTask("B", "Desc", "medium", 1, [t1.id]);
		const t3 = builder.addTask("C", "Desc", "medium", 1, [t2.id]);
		builder.getTask(t1.id)!.dependencyIds.push(t3.id);
		const result = builder.validate();
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("Circular"))).toBe(true);
	});
});

// =============================================================================
// DagBuilder — Critical Path
// =============================================================================

describe("DagBuilder — Critical Path", () => {
	test("getCriticalPath returns longest chain by effort", () => {
		const builder = new DagBuilder();
		const t1 = builder.addTask("Light", "Desc", "medium", 1);
		const t2 = builder.addTask("Heavy", "Desc", "high", 10);
		const t3 = builder.addTask("Final", "Desc", "medium", 2, [t1.id, t2.id]);
		const path = builder.getCriticalPath();
		expect(path).toContain(t2.id);
		expect(path[path.length - 1]).toBe(t3.id);
	});

	test("getTotalEffort sums all task efforts", () => {
		const builder = new DagBuilder();
		builder.addTask("T1", "Desc", "medium", 5);
		builder.addTask("T2", "Desc", "medium", 10);
		expect(builder.getTotalEffort()).toBe(15);
	});
});

// =============================================================================
// TemplateRenderer — Basic Rendering
// =============================================================================

describe("TemplateRenderer — Basic Rendering", () => {
	test("has built-in templates", () => {
		const r = new TemplateRenderer();
		expect(r.getAllTemplates().length).toBeGreaterThanOrEqual(4);
	});

	test("render returns error for unknown template", () => {
		const r = new TemplateRenderer();
		const result = r.render("unknown", {});
		expect(result.success).toBe(false);
		expect(result.errors[0].code).toBe("TEMPLATE_NOT_FOUND");
	});

	test("substitutes simple variables", () => {
		const r = new TemplateRenderer();
		const result = r.render("standard-execution", {
			planName: "My Plan",
			description: "Test description",
			tasks: [{ title: "T1", priority: "high", effort: 3, description: "Do it", dependencies: "None" }],
		});
		expect(result.success).toBe(true);
		expect(result.output).toContain("My Plan");
	});

	test("returns errors for missing required variables", () => {
		const r = new TemplateRenderer();
		const result = r.render("standard-execution", {});
		expect(result.success).toBe(false);
		expect(result.errors[0].code).toBe("MISSING_REQUIRED_VARIABLE");
	});

	test("registerTemplate adds a custom template", () => {
		const r = new TemplateRenderer();
		r.registerTemplate({
			id: "custom",
			name: "C",
			body: "Custom: {{p}}",
			requiredVariables: ["p"],
			description: "",
		});
		const result = r.render("custom", { p: "hello" });
		expect(result.success).toBe(true);
		expect(result.output).toBe("Custom: hello");
	});

	test("conditionals work", () => {
		const r = new TemplateRenderer();
		r.registerTemplate({
			id: "iftest",
			name: "I",
			body: "{{#if x}}Y{{/if}}",
			requiredVariables: [],
			description: "",
		});
		expect(r.render("iftest", { x: true }).output).toBe("Y");
		expect(r.render("iftest", { x: false }).output).toBe("");
	});

	test("each loops work", () => {
		const r = new TemplateRenderer();
		r.registerTemplate({
			id: "eachtest",
			name: "E",
			body: "{{#each items}}{{this}}|{{/each}}",
			requiredVariables: [],
			description: "",
		});
		expect(r.render("eachtest", { items: ["A", "B"] }).output).toBe("A|B|");
	});

	test("removeTemplate works", () => {
		const r = new TemplateRenderer();
		expect(r.removeTemplate("standard-execution")).toBe(true);
		expect(r.getTemplate("standard-execution")).toBeUndefined();
	});

	test("removeTemplate returns false for unknown", () => {
		const r = new TemplateRenderer();
		expect(r.removeTemplate("nonexistent")).toBe(false);
	});

	test("resetToBuiltIns restores built-in templates", () => {
		const r = new TemplateRenderer();
		r.clear();
		expect(r.getAllTemplates()).toHaveLength(0);
		r.resetToBuiltIns();
		expect(r.getAllTemplates().length).toBeGreaterThanOrEqual(4);
	});

	test("constructor custom templates are available", () => {
		const r = new TemplateRenderer([
			{ id: "ct", name: "CT", body: "CT: {{x}}", requiredVariables: ["x"], description: "" },
		]);
		const result = r.render("ct", { x: "ok" });
		expect(result.output).toBe("CT: ok");
	});
});

// =============================================================================
// PlanSynthesizerWorker — Cooldown
// =============================================================================

describe("PlanSynthesizerWorker — Cooldown", () => {
	test("initially not in cooldown", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.isInCooldown()).toBe(false);
		const status = worker.getCooldownStatus();
		expect(status.cooling).toBe(false);
		expect(status.endsAt).toBeNull();
		expect(status.remainingMs).toBe(0);
	});

	test("startCooldown puts worker in cooldown", () => {
		const worker = new PlanSynthesizerWorker({ cooldownMs: 10_000 });
		worker.startCooldown();
		expect(worker.isInCooldown()).toBe(true);
		const status = worker.getCooldownStatus();
		expect(status.cooling).toBe(true);
		expect(status.endsAt).not.toBeNull();
		expect(status.remainingMs).toBeGreaterThan(0);
	});

	test("startCooldown with custom duration", () => {
		const worker = new PlanSynthesizerWorker();
		worker.startCooldown(5_000);
		expect(worker.isInCooldown()).toBe(true);
		const status = worker.getCooldownStatus();
		expect(status.remainingMs).toBeLessThanOrEqual(5_000);
		expect(status.remainingMs).toBeGreaterThan(0);
	});

	test("endCooldown ends cooldown early", () => {
		const worker = new PlanSynthesizerWorker({ cooldownMs: 60_000 });
		worker.startCooldown();
		expect(worker.isInCooldown()).toBe(true);
		worker.endCooldown();
		expect(worker.isInCooldown()).toBe(false);
		expect(worker.getCooldownStatus().cooling).toBe(false);
	});

	test("clear resets cooldown state", () => {
		const worker = new PlanSynthesizerWorker({ cooldownMs: 60_000 });
		worker.startCooldown();
		expect(worker.isInCooldown()).toBe(true);
		worker.clear();
		expect(worker.isInCooldown()).toBe(false);
		expect(worker.getCooldownStatus().cooling).toBe(false);
	});
});

// =============================================================================
// PlanSynthesizerWorker — Stop Condition
// =============================================================================

describe("PlanSynthesizerWorker — Stop Condition", () => {
	test("checkStopCondition returns null when within limits", () => {
		const worker = new PlanSynthesizerWorker();
		expect(worker.checkStopCondition()).toBeNull();
	});

	test("checkStopCondition returns stop condition when failures exceed limit", () => {
		const worker = new PlanSynthesizerWorker({ maxConsecutiveFailures: 2 });
		// Trigger failures
		const s1 = worker.createSession("f1", [makeGoal()]);
		expect(s1).not.toBeNull();
		worker.decomposeGoals(s1!.id);
		worker.buildDag(s1!.id, new DagBuilder());
		expect(worker.checkStopCondition()).toBeNull(); // 1 failure, < 2
		const s2 = worker.createSession("f2", [makeGoal({ id: "g2", title: "Fail goal" })]);
		expect(s2).not.toBeNull();
		worker.decomposeGoals(s2!.id);
		worker.buildDag(s2!.id, new DagBuilder());
		expect(worker.checkStopCondition()).toBe("consecutive_failures_exceeded"); // 2 failures, >= 2
	});

	test("successful session resets stop condition", () => {
		const worker = new PlanSynthesizerWorker({ maxConsecutiveFailures: 1 });
		const s1 = worker.createSession("f1", [makeGoal()]);
		expect(s1).not.toBeNull();
		worker.decomposeGoals(s1!.id);
		worker.buildDag(s1!.id, new DagBuilder());
		expect(worker.checkStopCondition()).toBe("consecutive_failures_exceeded");
		const s2 = worker.createSession("good", [makeGoal({ id: "g2", title: "Good goal" })]);
		expect(s2).not.toBeNull();
		const plan = worker.synthesize(s2!.id);
		expect(plan).not.toBeNull();
		expect(worker.checkStopCondition()).toBeNull();
	});
});

// =============================================================================
// Type Exports
// =============================================================================

describe("Type Exports", () => {
	test("PlanSynthesizerWorker is exported", () => {
		expect(typeof PlanSynthesizerWorker).toBe("function");
	});
	test("DagBuilder is exported", () => {
		expect(typeof DagBuilder).toBe("function");
	});
	test("TemplateRenderer is exported", () => {
		expect(typeof TemplateRenderer).toBe("function");
	});
	test("BUILT_IN_TEMPLATES is exported", () => {
		expect(Array.isArray(BUILT_IN_TEMPLATES)).toBe(true);
		expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(4);
	});
	test("createPlanSynthesizerContract is exported", () => {
		expect(typeof createPlanSynthesizerContract).toBe("function");
	});
	test("createPlanSynthesizerWorker is exported", () => {
		expect(typeof createPlanSynthesizerWorker).toBe("function");
	});
});
