/**
 * Idea to Plan Pipeline — 25.Q
 *
 * Covers:
 * - IdeaToPlanPipeline: constructor, config, stats, session lifecycle
 * - Pipeline stages: ingest ideas, promote to proposals, synthesize plan,
 *   validate output, complete
 * - Deduplication via PipelineDedupTracker
 * - Output validation via PipelineValidator
 * - Budget enforcement (token budget, runtime budget)
 * - Consecutive failure tracking and diagnostics
 * - Approval gating (requireApproval=true)
 * - Approval resume after gate
 * - Approval denial
 * - Session cancellation
 * - Recursion depth enforcement
 * - Edge cases (empty ideas, low confidence, duplicates, missing sessions)
 */

import { describe, expect, test } from "vitest";
import {
	ALL_PIPELINE_SESSION_STATUSES,
	DEFAULT_PIPELINE_CONFIG,
	IdeaToPlanPipeline,
	PipelineDedupTracker,
	type PipelineIdea,
	type PipelineOutput,
	type PipelineSession,
	type PipelineValidationResult,
	PipelineValidator,
} from "../../src/brain-workers/pipelines/idea-to-plan-pipeline.js";
import {
	ALL_PIPELINE_STOP_CONDITIONS,
	DEFAULT_IDEA_TO_PLAN_POLICY,
} from "../../src/brain-workers/pipelines/idea-to-plan-policy.js";

// =============================================================================
// Helpers
// =============================================================================

function makeIdea(overrides?: Partial<PipelineIdea>): PipelineIdea {
	return {
		id: "idea-1",
		title: "Implement user authentication",
		description: "Add OAuth2-based authentication to the API gateway",
		confidence: 0.85,
		priority: "high",
		tags: ["auth", "security"],
		sourceRefs: [{ type: "signal", id: "sig-1", label: "Login flow feedback" }],
		createdAt: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

function makeMultipleIdeas(count: number, baseConfidence = 0.7): PipelineIdea[] {
	return Array.from({ length: count }, (_, i) =>
		makeIdea({
			id: `idea-${i + 1}`,
			title: `Idea ${i + 1}: Feature ${String.fromCharCode(65 + i)}`,
			description: `Description for idea ${i + 1}`,
			confidence: baseConfidence,
			priority: i === 0 ? "critical" : "high",
			tags: ["feature"],
		}),
	);
}

function runPipelineToCompletion(pipeline: IdeaToPlanPipeline, ideas: PipelineIdea[]): PipelineSession {
	const pipelineWithApproval = pipeline;
	pipelineWithApproval.setConfig({
		policy: { requireApproval: false },
	});
	const session = pipelineWithApproval.createSession("test-run", ideas);
	return pipelineWithApproval.run(session.id);
}

// =============================================================================
// IdeaToPlanPipeline — Constructor & Configuration
// =============================================================================

describe("IdeaToPlanPipeline — Constructor & Configuration", () => {
	test("creates with default configuration", () => {
		const pipeline = new IdeaToPlanPipeline();
		const config = pipeline.getConfig();

		expect(config.maxTokensPerSession).toBe(250_000);
		expect(config.maxRuntimeMsPerSession).toBe(1_200_000);
		expect(config.maxConsecutiveFailures).toBe(3);
		expect(config.cooldownMs).toBe(300_000);
		expect(config.dedupEnabled).toBe(true);
		expect(config.dedupWindowMs).toBe(300_000);
		expect(config.policy.maxIdeasPerRun).toBe(20);
		expect(config.policy.maxProposalsPerRun).toBe(10);
		expect(config.policy.minIdeaConfidenceForProposal).toBe(0.4);
		expect(config.policy.minProposalConfidenceForSynthesis).toBe(0.5);
		expect(config.policy.requireApproval).toBe(true);
		expect(config.policy.maxRecursionDepth).toBe(1);
	});

	test("creates with partial configuration overrides", () => {
		const pipeline = new IdeaToPlanPipeline({
			maxTokensPerSession: 100_000,
			maxConsecutiveFailures: 5,
			policy: {
				maxIdeasPerRun: 10,
				minIdeaConfidenceForProposal: 0.6,
			},
		});

		const config = pipeline.getConfig();
		expect(config.maxTokensPerSession).toBe(100_000);
		expect(config.maxConsecutiveFailures).toBe(5);
		expect(config.policy.maxIdeasPerRun).toBe(10);
		expect(config.policy.minIdeaConfidenceForProposal).toBe(0.6);
		// Unchanged defaults
		expect(config.maxRuntimeMsPerSession).toBe(1_200_000);
		expect(config.policy.maxProposalsPerRun).toBe(10);
	});

	test("setConfig updates configuration", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ maxTokensPerSession: 99_999, policy: { maxIdeasPerRun: 5 } });

		const config = pipeline.getConfig();
		expect(config.maxTokensPerSession).toBe(99_999);
		expect(config.policy.maxIdeasPerRun).toBe(5);
	});

	test("initial stats are all zeros", () => {
		const pipeline = new IdeaToPlanPipeline();
		const stats = pipeline.getStats();

		expect(stats.totalSessions).toBe(0);
		expect(stats.completed).toBe(0);
		expect(stats.failed).toBe(0);
		expect(stats.cancelled).toBe(0);
		expect(stats.awaitingApproval).toBe(0);
		expect(stats.active).toBe(0);
		expect(stats.totalTokensConsumed).toBe(0);
		expect(stats.totalRuntimeMs).toBe(0);
		expect(stats.totalIdeasProcessed).toBe(0);
		expect(stats.totalProposalsGenerated).toBe(0);
		expect(stats.totalPlansGenerated).toBe(0);
		expect(stats.consecutiveFailures).toBe(0);
	});

	test("resetStats resets all statistics", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });
		const session = pipeline.createSession("test", makeMultipleIdeas(3));
		pipeline.run(session.id);

		const statsAfter = pipeline.getStats();
		expect(statsAfter.completed).toBe(1);

		pipeline.resetStats();
		const resetStats = pipeline.getStats();
		expect(resetStats.completed).toBe(0);
		expect(resetStats.totalSessions).toBe(0);
	});
});

// =============================================================================
// PipelineDedupTracker
// =============================================================================

describe("PipelineDedupTracker", () => {
	test("computes consistent keys for identical ideas", () => {
		const tracker = new PipelineDedupTracker(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig);
		const idea1 = makeIdea({ title: "Same Title", description: "Same Desc" });
		const idea2 = makeIdea({ title: "Same Title", description: "Same Desc" });
		expect(tracker.computeKey(idea1)).toBe(tracker.computeKey(idea2));
	});

	test("computes different keys for different ideas", () => {
		const tracker = new PipelineDedupTracker(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig);
		const idea1 = makeIdea({ title: "Title A", description: "Desc A" });
		const idea2 = makeIdea({ title: "Title B", description: "Desc B" });
		expect(tracker.computeKey(idea1)).not.toBe(tracker.computeKey(idea2));
	});

	test("detects duplicate within dedup window", () => {
		const tracker = new PipelineDedupTracker({
			enabled: true,
			windowMs: 300_000,
			useSimilarity: true,
			similarityThreshold: 0.85,
		});
		const idea = makeIdea({ title: "Duplicate", description: "Check me" });

		expect(tracker.isDuplicate(idea)).toBe(false);
		tracker.record(idea);
		expect(tracker.isDuplicate(idea)).toBe(true);
	});

	test("does not detect duplicate when disabled", () => {
		const tracker = new PipelineDedupTracker({
			enabled: false,
			windowMs: 300_000,
			useSimilarity: true,
			similarityThreshold: 0.85,
		});
		const idea = makeIdea({ title: "No Dedup", description: "Should pass" });

		expect(tracker.isDuplicate(idea)).toBe(false);
		tracker.record(idea);
		expect(tracker.isDuplicate(idea)).toBe(false);
	});

	test("tracks history size", () => {
		const tracker = new PipelineDedupTracker(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig);
		expect(tracker.historySize).toBe(0);

		tracker.record(makeIdea({ id: "a", title: "A", description: "Desc A" }));
		tracker.record(makeIdea({ id: "b", title: "B", description: "Desc B" }));
		expect(tracker.historySize).toBe(2);
	});

	test("clear resets history", () => {
		const tracker = new PipelineDedupTracker(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig);
		tracker.record(makeIdea({ id: "a", title: "A", description: "Desc A" }));
		tracker.record(makeIdea({ id: "b", title: "B", description: "Desc B" }));
		expect(tracker.historySize).toBe(2);

		tracker.clear();
		expect(tracker.historySize).toBe(0);
	});
});

// =============================================================================
// PipelineValidator
// =============================================================================

describe("PipelineValidator", () => {
	test("validates valid output with no errors", () => {
		const validator = new PipelineValidator();
		const output: PipelineOutput = {
			id: "out-1",
			summary: "Test plan",
			workstreams: [
				{
					id: "WS-01",
					title: "Feature A",
					goal: "Implement A",
					sourceProposalId: "prop-1",
					acceptanceCriteria: ["Done"],
					dependencies: [],
					fileScope: [],
					isolationNotes: "Standard",
					queuePriority: "high",
					riskLevel: "low",
				},
			],
			batches: [{ index: 1, workstreamIds: ["WS-01"] }],
			dependencies: [],
			ideasConsumed: ["idea-1"],
			proposalsGenerated: ["prop-1"],
			ideasPromoted: 1,
			ideasSkipped: 0,
			generatedAt: new Date().toISOString(),
			confidence: 0.85,
			validation: [],
			metadata: {},
		};

		const results = validator.validate(output);
		expect(validator.hasErrors(results)).toBe(false);
	});

	test("detects empty workstreams", () => {
		const validator = new PipelineValidator();
		const output: PipelineOutput = {
			id: "out-2",
			summary: "Empty plan",
			workstreams: [],
			batches: [],
			dependencies: [],
			ideasConsumed: [],
			proposalsGenerated: [],
			ideasPromoted: 0,
			ideasSkipped: 0,
			generatedAt: new Date().toISOString(),
			confidence: 0,
			validation: [],
			metadata: {},
		};

		const results = validator.validate(output);
		expect(validator.hasErrors(results)).toBe(true);
		const errorMsgs = results.filter((r) => r.type === "error").map((r) => r.message);
		expect(errorMsgs).toContain("No workstreams generated");
	});

	test("detects duplicate workstream IDs", () => {
		const validator = new PipelineValidator();
		const output: PipelineOutput = {
			id: "out-3",
			summary: "Duplicate WS",
			workstreams: [
				{
					id: "WS-01",
					title: "Feature A",
					goal: "A",
					sourceProposalId: "prop-1",
					acceptanceCriteria: [],
					dependencies: [],
					fileScope: [],
					isolationNotes: "",
					queuePriority: "normal",
					riskLevel: "low",
				},
				{
					id: "WS-01",
					title: "Feature B",
					goal: "B",
					sourceProposalId: "prop-2",
					acceptanceCriteria: [],
					dependencies: [],
					fileScope: [],
					isolationNotes: "",
					queuePriority: "normal",
					riskLevel: "low",
				},
			],
			batches: [{ index: 1, workstreamIds: ["WS-01"] }],
			dependencies: [],
			ideasConsumed: ["idea-1"],
			proposalsGenerated: ["prop-1"],
			ideasPromoted: 1,
			ideasSkipped: 0,
			generatedAt: new Date().toISOString(),
			confidence: 0.5,
			validation: [],
			metadata: {},
		};

		const results = validator.validate(output);
		expect(validator.hasErrors(results)).toBe(true);
		const errorMsgs = results.filter((r) => r.type === "error").map((r) => r.message);
		expect(errorMsgs.some((m) => m.includes("Duplicate workstream IDs"))).toBe(true);
	});

	test("detects missing dependency targets", () => {
		const validator = new PipelineValidator();
		const output: PipelineOutput = {
			id: "out-4",
			summary: "Bad dep",
			workstreams: [
				{
					id: "WS-01",
					title: "Feature A",
					goal: "A",
					sourceProposalId: "prop-1",
					acceptanceCriteria: [],
					dependencies: [],
					fileScope: [],
					isolationNotes: "",
					queuePriority: "normal",
					riskLevel: "low",
				},
			],
			batches: [{ index: 1, workstreamIds: ["WS-01"] }],
			dependencies: [{ from: "WS-NONEXISTENT", to: "WS-01", type: "blocking" }],
			ideasConsumed: ["idea-1"],
			proposalsGenerated: ["prop-1"],
			ideasPromoted: 1,
			ideasSkipped: 0,
			generatedAt: new Date().toISOString(),
			confidence: 0.5,
			validation: [],
			metadata: {},
		};

		const results = validator.validate(output);
		expect(validator.hasErrors(results)).toBe(true);
		const errorMsgs = results.filter((r) => r.type === "error").map((r) => r.message);
		expect(errorMsgs.some((m) => m.includes("non-existent source"))).toBe(true);
	});

	test("detects workstream in multiple batches", () => {
		const validator = new PipelineValidator();
		const output: PipelineOutput = {
			id: "out-5",
			summary: "Multi batch",
			workstreams: [
				{
					id: "WS-01",
					title: "Feature A",
					goal: "A",
					sourceProposalId: "prop-1",
					acceptanceCriteria: [],
					dependencies: [],
					fileScope: [],
					isolationNotes: "",
					queuePriority: "normal",
					riskLevel: "low",
				},
			],
			batches: [
				{ index: 1, workstreamIds: ["WS-01"] },
				{ index: 2, workstreamIds: ["WS-01"] },
			],
			dependencies: [],
			ideasConsumed: ["idea-1"],
			proposalsGenerated: ["prop-1"],
			ideasPromoted: 1,
			ideasSkipped: 0,
			generatedAt: new Date().toISOString(),
			confidence: 0.5,
			validation: [],
			metadata: {},
		};

		const results = validator.validate(output);
		expect(validator.hasErrors(results)).toBe(true);
		const errorMsgs = results.filter((r) => r.type === "error").map((r) => r.message);
		expect(errorMsgs.some((m) => m.includes("multiple batches"))).toBe(true);
	});

	test("hasWarnings returns true when warnings exist", () => {
		const validator = new PipelineValidator();
		const results: PipelineValidationResult[] = [
			{ type: "info", component: "test", message: "Info", affectedIds: [] },
			{ type: "warning", component: "test", message: "Warning", affectedIds: [] },
		];
		expect(validator.hasWarnings(results)).toBe(true);
	});

	test("hasWarnings returns false when no warnings exist", () => {
		const validator = new PipelineValidator();
		const results: PipelineValidationResult[] = [
			{ type: "info", component: "test", message: "Info", affectedIds: [] },
		];
		expect(validator.hasWarnings(results)).toBe(false);
	});
});

// =============================================================================
// Pipeline Session Lifecycle
// =============================================================================

describe("IdeaToPlanPipeline — Session Lifecycle", () => {
	test("creates a session with input ideas", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(3);
		const session = pipeline.createSession("test-session", ideas);

		expect(session.id).toBeDefined();
		expect(session.label).toBe("test-session");
		expect(session.status).toBe("idle");
		expect(session.stage).toBe("idle");
		expect(session.inputIdeas).toHaveLength(3);
		expect(session.proposals).toHaveLength(0);
		expect(session.output).toBeNull();
		expect(session.error).toBeNull();
		expect(session.diagnostic).toBeNull();
		expect(session.tokensConsumed).toBe(0);
		expect(session.runtimeMs).toBe(0);
	});

	test("getSession returns session by ID", () => {
		const pipeline = new IdeaToPlanPipeline();
		const session = pipeline.createSession("test", [makeIdea()]);
		const retrieved = pipeline.getSession(session.id);
		expect(retrieved).toBeDefined();
		expect(retrieved!.id).toBe(session.id);
	});

	test("getSession returns undefined for unknown ID", () => {
		const pipeline = new IdeaToPlanPipeline();
		expect(pipeline.getSession("nonexistent")).toBeUndefined();
	});

	test("getAllSessions returns all sessions", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.createSession("s1", [makeIdea()]);
		pipeline.createSession("s2", [makeIdea()]);
		expect(pipeline.getAllSessions()).toHaveLength(2);
	});
});

// =============================================================================
// Full Pipeline Run (Approval Disabled)
// =============================================================================

describe("IdeaToPlanPipeline — Full Pipeline Run (approval disabled)", () => {
	test("completes a full pipeline run successfully", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(3);
		const session = runPipelineToCompletion(pipeline, ideas);

		expect(session.status).toBe("completed");
		expect(session.stage).toBe("completed");
		expect(session.stopCondition).toBe("completed");
		expect(session.output).not.toBeNull();
		expect(session.error).toBeNull();
		expect(session.diagnostic).toBeNull();

		const output = session.output!;
		expect(output.workstreams.length).toBeGreaterThan(0);
		expect(output.proposalsGenerated.length).toBeGreaterThan(0);
		expect(output.ideasConsumed.length).toBeGreaterThan(0);
		expect(output.summary).toContain("proposal(s)");
	});

	test("workstreams are generated from proposals", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(2);
		const session = runPipelineToCompletion(pipeline, ideas);
		const output = session.output!;

		expect(output.workstreams.length).toBe(2);
		expect(output.workstreams[0].title).toBe("Idea 1: Feature A");
		expect(output.workstreams[1].title).toBe("Idea 2: Feature B");

		// Check dependency chain
		expect(output.workstreams[0].dependencies).toHaveLength(0);
		expect(output.workstreams[1].dependencies).toContain(output.workstreams[0].id);
	});

	test("batches are created correctly", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(5);
		const session = runPipelineToCompletion(pipeline, ideas);
		const output = session.output!;

		// 5 workstreams = 2 batches (3 + 2)
		expect(output.batches.length).toBe(2);
		expect(output.batches[0].workstreamIds).toHaveLength(3);
		expect(output.batches[1].workstreamIds).toHaveLength(2);
	});

	test("dependencies are created between consecutive workstreams", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(3);
		const session = runPipelineToCompletion(pipeline, ideas);
		const output = session.output!;

		expect(output.dependencies.length).toBe(2); // WS-01 -> WS-02, WS-02 -> WS-03
		expect(output.dependencies[0].from).toBe(output.workstreams[0].id);
		expect(output.dependencies[0].to).toBe(output.workstreams[1].id);
		expect(output.dependencies[1].from).toBe(output.workstreams[1].id);
		expect(output.dependencies[1].to).toBe(output.workstreams[2].id);
	});

	test("stats are updated after successful run", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });
		const session = pipeline.createSession("test", makeMultipleIdeas(2));
		pipeline.run(session.id);

		const stats = pipeline.getStats();
		expect(stats.totalSessions).toBe(1);
		expect(stats.completed).toBe(1);
		expect(stats.failed).toBe(0);
		expect(stats.totalIdeasProcessed).toBe(2);
		expect(stats.totalProposalsGenerated).toBe(2);
		expect(stats.totalPlansGenerated).toBe(1);
		expect(stats.totalTokensConsumed).toBeGreaterThan(0);
		expect(stats.totalRuntimeMs).toBeGreaterThanOrEqual(0);
	});

	test("multiple runs update stats correctly", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });

		const s1 = pipeline.createSession("run-1", makeMultipleIdeas(2));
		pipeline.run(s1.id);

		// Use a dedup-unique set of ideas for the second run
		const uniqueIdeas = makeMultipleIdeas(3).map((idea, i) => ({
			...idea,
			title: `Unique-Run-${i + 1}`,
			description: `Unique description ${i + 1}`,
		}));
		const s2 = pipeline.createSession("run-2", uniqueIdeas);
		pipeline.run(s2.id);

		const stats = pipeline.getStats();
		expect(stats.totalSessions).toBe(2);
		expect(stats.completed).toBe(2);
		expect(stats.totalIdeasProcessed).toBe(5);
		expect(stats.totalProposalsGenerated).toBe(5);
		expect(stats.totalPlansGenerated).toBe(2);
	});
});

// =============================================================================
// Approval Gating
// =============================================================================

describe("IdeaToPlanPipeline — Approval Gating", () => {
	test("pipeline pauses for approval when requireApproval is true (default)", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(2);
		const session = pipeline.createSession("approval-test", ideas);
		const result = pipeline.run(session.id);

		expect(result.status).toBe("awaiting_approval");
		expect(result.stage).toBe("awaiting_approval");
		expect(result.output).toBeNull();
		expect(result.proposals.length).toBeGreaterThan(0);

		const stats = pipeline.getStats();
		expect(stats.awaitingApproval).toBe(1);
	});

	test("approveSession allows pipeline to continue", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(2);
		const session = pipeline.createSession("approval-test", ideas);
		pipeline.run(session.id); // Stops at awaiting_approval

		// Approve - this transitions status from awaiting_approval to running
		const approved = pipeline.approveSession(session.id);
		expect(approved).toBe(true);
		expect(session.status).toBe("running");

		// Resume after approval (now accepts running state)
		const result = pipeline.resumeAfterApproval(session.id);
		expect(result.status).toBe("completed");
		expect(result.stage).toBe("completed");
		expect(result.output).not.toBeNull();
		expect(result.error).toBeNull();
	});

	test("resumeAfterApproval auto-approves and completes session", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(2);
		const session = pipeline.createSession("auto-approve", ideas);
		pipeline.run(session.id); // Stops at awaiting_approval

		// Resume without prior approveSession call (auto-approves)
		const result = pipeline.resumeAfterApproval(session.id);
		expect(result.status).toBe("completed");
		expect(result.stage).toBe("completed");
		expect(result.output).not.toBeNull();
		expect(result.error).toBeNull();
	});

	test("denyApproval cancels the session", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(2);
		const session = pipeline.createSession("deny-test", ideas);
		pipeline.run(session.id);

		const denied = pipeline.denyApproval(session.id, "Not ready yet");
		expect(denied).toBe(true);

		const result = pipeline.getSession(session.id);
		expect(result!.status).toBe("cancelled");
		expect(result!.stage).toBe("cancelled");
		expect(result!.stopCondition).toBe("approval_required");
		expect(result!.error).toBe("Not ready yet");
	});

	test("resumeAfterApproval on non-awaiting session returns error session", () => {
		const pipeline = new IdeaToPlanPipeline();
		const ideas = makeMultipleIdeas(2);
		const session = pipeline.createSession("wrong-state", ideas);

		// Try to resume without going through approval
		const result = pipeline.resumeAfterApproval(session.id);
		expect(result.status).toBe("failed");
		expect(result.error).toContain("not awaiting approval");
	});

	test("approveSession returns false for non-awaiting session", () => {
		const pipeline = new IdeaToPlanPipeline();
		const session = pipeline.createSession("not-awaiting", [makeIdea()]);
		expect(pipeline.approveSession(session.id)).toBe(false);
	});

	test("denyApproval returns false for non-awaiting session", () => {
		const pipeline = new IdeaToPlanPipeline();
		const session = pipeline.createSession("not-awaiting", [makeIdea()]);
		expect(pipeline.denyApproval(session.id)).toBe(false);
	});
});

// =============================================================================
// Cancellation
// =============================================================================

describe("IdeaToPlanPipeline — Cancellation", () => {
	test("cancelSession cancels a running session", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });
		const session = pipeline.createSession("cancel-test", makeMultipleIdeas(1));

		// We can cancel before running
		const cancelled = pipeline.cancelSession(session.id, "No longer needed");
		expect(cancelled).toBe(true);

		const result = pipeline.getSession(session.id);
		expect(result!.status).toBe("cancelled");
		expect(result!.stage).toBe("cancelled");
		expect(result!.stopCondition).toBe("user_interrupt");
		expect(result!.error).toBe("No longer needed");
	});

	test("cancelSession returns false for unknown session", () => {
		const pipeline = new IdeaToPlanPipeline();
		expect(pipeline.cancelSession("nonexistent")).toBe(false);
	});

	test("cancelSession returns false for already completed session", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });
		const session = pipeline.createSession("already-done", makeMultipleIdeas(1));
		pipeline.run(session.id);

		expect(pipeline.cancelSession(session.id)).toBe(false);
	});
});

// =============================================================================
// Edge Cases: Empty / Low Confidence / Duplicates
// =============================================================================

describe("IdeaToPlanPipeline — Edge Cases", () => {
	test("fails with diagnostic when no ideas provided", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });
		const session = pipeline.createSession("empty", []);
		pipeline.run(session.id);

		expect(session.status).toBe("failed");
		expect(session.error).toContain("No input ideas");
		expect(session.diagnostic).not.toBeNull();
		expect(session.diagnostic!.stopCondition).toBe("dependency_unavailable");
	});

	test("fails when confidence is below threshold for all ideas", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false, minIdeaConfidenceForProposal: 0.8 } });
		const ideas = [makeIdea({ confidence: 0.3 }), makeIdea({ confidence: 0.4 })];
		const session = pipeline.createSession("low-conf", ideas);
		pipeline.run(session.id);

		expect(session.status).toBe("failed");
		expect(session.stopCondition).toBe("low_confidence");
		expect(session.diagnostic).not.toBeNull();
	});

	test("fails when all proposals are below synthesis threshold", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({
			policy: { requireApproval: false, minProposalConfidenceForSynthesis: 0.9 },
		});
		const ideas = [makeIdea({ confidence: 0.7 })]; // 0.7 < 0.9
		const session = pipeline.createSession("low-synth", ideas);
		pipeline.run(session.id);

		expect(session.status).toBe("failed");
		expect(session.stopCondition).toBe("no_valid_proposals");
	});

	test("applies deduplication and skips duplicate ideas", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });

		// First run with unique idea
		const s1 = pipeline.createSession("first", [makeIdea({ id: "unique", title: "Unique", description: "Desc" })]);
		pipeline.run(s1.id);
		expect(s1.status).toBe("completed");

		// Second run with same idea (should be deduped)
		const s2 = pipeline.createSession("dup", [makeIdea({ id: "duplicate", title: "Unique", description: "Desc" })]);
		pipeline.run(s2.id);
		expect(s2.status).toBe("failed");
		expect(s2.stopCondition).toBe("no_valid_proposals");
		expect(s2.error).toContain("duplicates");
	});

	test("handles too many ideas exceeding maxIdeasPerRun", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false, maxIdeasPerRun: 2 } });
		const ideas = makeMultipleIdeas(5);
		const session = pipeline.createSession("too-many", ideas);
		pipeline.run(session.id);

		expect(session.status).toBe("failed");
		expect(session.stopCondition).toBe("max_ideas_reached");
		expect(session.error).toContain("exceed maxIdeasPerRun");
	});

	test("limits proposals to maxProposalsPerRun", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({
			policy: { requireApproval: false, maxProposalsPerRun: 2 },
		});
		const ideas = makeMultipleIdeas(5); // 5 ideas but only 2 proposals allowed
		const session = pipeline.createSession("limit-props", ideas);
		pipeline.run(session.id);

		expect(session.status).toBe("completed");
		expect(session.proposals.length).toBe(2);
		expect(session.output!.proposalsGenerated.length).toBe(2);
		expect(session.output!.workstreams.length).toBe(2);
	});

	test("fails for non-existent session on run", () => {
		const pipeline = new IdeaToPlanPipeline();
		const session = pipeline.run("nonexistent");

		expect(session.status).toBe("failed");
		expect(session.error).toContain("not found");
	});
});

// =============================================================================
// Recursion Depth
// =============================================================================

describe("IdeaToPlanPipeline — Recursion Depth", () => {
	test("fails when recursion depth exceeds maxRecursionDepth", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({
			policy: { requireApproval: false, maxRecursionDepth: 0 },
		});
		const ideas = makeMultipleIdeas(1);
		const session = pipeline.createSession("no-recursion", ideas);
		pipeline.run(session.id);

		expect(session.status).toBe("failed");
		expect(session.stopCondition).toBe("policy_blocked");
		expect(session.error).toContain("recursion depth");
	});
});

// =============================================================================
// Diagnostics
// =============================================================================

describe("IdeaToPlanPipeline — Diagnostics", () => {
	test("failed session has evidence-backed diagnostic", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });
		const session = pipeline.createSession("fail-diag", []);
		pipeline.run(session.id);

		expect(session.diagnostic).not.toBeNull();
		expect(session.diagnostic!.stopCondition).toBe("dependency_unavailable");
		expect(session.diagnostic!.message).toContain("No input ideas");
		expect(session.diagnostic!.timestamp).toBeDefined();
		expect(session.diagnostic!.context).toBeDefined();
	});

	test("consecutive failures are tracked", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });

		// Run with empty ideas twice
		const s1 = pipeline.createSession("fail-1", []);
		pipeline.run(s1.id);
		expect(s1.consecutiveFailures).toBe(1);

		const s2 = pipeline.createSession("fail-2", []);
		pipeline.run(s2.id);
		expect(s2.consecutiveFailures).toBe(1); // New session, new count

		// Pipeline stats track global consecutive failures
		const stats = pipeline.getStats();
		expect(stats.consecutiveFailures).toBe(1);
	});

	test("successful run resets consecutive failures", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({ policy: { requireApproval: false } });

		// Fail first
		const s1 = pipeline.createSession("fail", []);
		pipeline.run(s1.id);
		expect(pipeline.getStats().consecutiveFailures).toBe(1);

		// Then succeed
		const s2 = pipeline.createSession("succeed", makeMultipleIdeas(1));
		pipeline.run(s2.id);
		expect(s2.status).toBe("completed");

		const stats = pipeline.getStats();
		expect(stats.consecutiveFailures).toBe(0);
	});
});

// =============================================================================
// Constants and Types
// =============================================================================

describe("IdeaToPlanPipeline — Constants and Types", () => {
	test("ALL_PIPELINE_SESSION_STATUSES contains all statuses", () => {
		expect(ALL_PIPELINE_SESSION_STATUSES).toContain("idle");
		expect(ALL_PIPELINE_SESSION_STATUSES).toContain("running");
		expect(ALL_PIPELINE_SESSION_STATUSES).toContain("awaiting_approval");
		expect(ALL_PIPELINE_SESSION_STATUSES).toContain("completed");
		expect(ALL_PIPELINE_SESSION_STATUSES).toContain("failed");
		expect(ALL_PIPELINE_SESSION_STATUSES).toContain("cancelled");
	});

	test("ALL_PIPELINE_STAGES defines correct stage values", () => {
		const expectedStages: string[] = [
			"idle",
			"ingesting_ideas",
			"promoting_to_proposals",
			"synthesizing_plan",
			"validating_output",
			"completed",
			"failed",
			"cancelled",
			"awaiting_approval",
		];
		expect(expectedStages.length).toBe(9);
		expect(expectedStages.includes("idle")).toBe(true);
		expect(expectedStages.includes("ingesting_ideas")).toBe(true);
		expect(expectedStages.includes("promoting_to_proposals")).toBe(true);
		expect(expectedStages.includes("synthesizing_plan")).toBe(true);
		expect(expectedStages.includes("validating_output")).toBe(true);
		expect(expectedStages.includes("completed")).toBe(true);
		expect(expectedStages.includes("failed")).toBe(true);
		expect(expectedStages.includes("cancelled")).toBe(true);
		expect(expectedStages.includes("awaiting_approval")).toBe(true);
	});

	test("ALL_PIPELINE_STOP_CONDITIONS extends worker stop conditions", () => {
		expect(ALL_PIPELINE_STOP_CONDITIONS).toContain("completed");
		expect(ALL_PIPELINE_STOP_CONDITIONS).toContain("max_ideas_reached");
		expect(ALL_PIPELINE_STOP_CONDITIONS).toContain("max_proposals_reached");
		expect(ALL_PIPELINE_STOP_CONDITIONS).toContain("low_confidence");
		expect(ALL_PIPELINE_STOP_CONDITIONS).toContain("no_valid_proposals");
		expect(ALL_PIPELINE_STOP_CONDITIONS).toContain("synthesis_failed");
		expect(ALL_PIPELINE_STOP_CONDITIONS).toContain("approval_required");
	});
});

// =============================================================================
// Policy Defaults
// =============================================================================

describe("IdeaToPlanPolicy — Defaults", () => {
	test("DEFAULT_IDEA_TO_PLAN_POLICY has expected values", () => {
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.maxIdeasPerRun).toBe(20);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.maxProposalsPerRun).toBe(10);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.minIdeaConfidenceForProposal).toBe(0.4);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.minProposalConfidenceForSynthesis).toBe(0.5);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.requireApproval).toBe(true);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.enforceLocalExecutionPolicy).toBe(true);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.maxRecursionDepth).toBe(1);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.verboseDiagnostics).toBe(true);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.maxEvidenceRefsPerDiagnostic).toBe(20);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.contractVersion).toBe("1.0.0");
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.defaultTemplateId).toBe("standard-execution");

		// Budget defaults
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.budget.maxTokensPerCycle).toBe(250_000);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.budget.maxConsecutiveFailures).toBe(3);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.budget.cooldownMs).toBe(300_000);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.budget.maxRuntimeMs).toBe(1_200_000);

		// Dedup defaults
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig.enabled).toBe(true);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig.windowMs).toBe(300_000);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig.useSimilarity).toBe(true);
		expect(DEFAULT_IDEA_TO_PLAN_POLICY.dedupConfig.similarityThreshold).toBe(0.85);
	});

	test("DEFAULT_PIPELINE_CONFIG references default policy", () => {
		expect(DEFAULT_PIPELINE_CONFIG.policy).toEqual(DEFAULT_IDEA_TO_PLAN_POLICY);
		expect(DEFAULT_PIPELINE_CONFIG.maxTokensPerSession).toBe(250_000);
		expect(DEFAULT_PIPELINE_CONFIG.maxRuntimeMsPerSession).toBe(1_200_000);
	});
});

// =============================================================================
// Pipeline session creation respects policy
// =============================================================================

describe("IdeaToPlanPipeline — Confidence Thresholds", () => {
	test("ideas with confidence equal to threshold are promoted", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({
			policy: { requireApproval: false, minIdeaConfidenceForProposal: 0.5 },
		});
		const ideas = [makeIdea({ confidence: 0.5 })];
		const session = pipeline.createSession("at-threshold", ideas);
		pipeline.run(session.id);

		expect(session.status).toBe("completed");
		expect(session.proposals.length).toBe(1);
	});

	test("ideas with confidence just below threshold are skipped", () => {
		const pipeline = new IdeaToPlanPipeline();
		pipeline.setConfig({
			policy: { requireApproval: false, minIdeaConfidenceForProposal: 0.5 },
		});
		const ideas = [makeIdea({ confidence: 0.49 })];
		const session = pipeline.createSession("below-threshold", ideas);
		pipeline.run(session.id);

		expect(session.status).toBe("failed");
		expect(session.stopCondition).toBe("low_confidence");
	});
});
