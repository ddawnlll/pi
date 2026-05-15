/**
 * Tests for Proposal Execution Pipeline - P9.B
 *
 * Acceptance Criteria:
 * 1. Approved proposals can generate remediation plan drafts (AC1).
 * 2. Planning approval does not imply execution approval (AC2).
 * 3. Generated plans can be submitted to planner optimization (AC3).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlannerOutput } from "../src/core/planner.js";
import {
	createProposalExecutionPipeline,
	formatPipelineStageEntry,
	formatPipelineStageHistory,
	ProposalExecutionPipeline,
} from "../src/core/proposal-execution-pipeline.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-proposal-execution-pipeline");

/**
 * Create a minimal valid planner output for testing.
 */
function createMinimalPlannerOutput(overrides?: Partial<PlannerOutput>): PlannerOutput {
	return {
		success: true,
		optimizedBatches: [
			{
				batchIndex: 1,
				workspaceIds: ["9.B.1", "9.B.2"],
				width: 2,
				optimizationNotes: [],
				isBottleneck: false,
				isAtCapacity: true,
			},
		],
		criticalPath: {
			path: ["9.B.1"],
			length: 1,
			dependencies: {},
			batchCount: 1,
			bottleneckImpact: "No bottleneck",
		},
		plannerWarnings: [],
		plannerSuggestions: [],
		predictedParallelism: {
			requested: 3,
			effective: 2,
			totalBatches: 1,
			resourceUtilizationPercent: 66,
			bottlenecks: [],
			parallelismHeadroom: false,
			saturationPoint: 2,
		},
		summary: "Pipeline test plan",
		...overrides,
	};
}

/**
 * Create a minimal valid workspace queue for testing.
 */
function createMinimalQueue(overrides?: Partial<WorkspaceQueue>): WorkspaceQueue {
	return {
		phase: "P9",
		title: "Pipeline Test Phase",
		maxParallelWorkspaces: 3,
		workspaces: [
			{
				id: "9.B.1",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "9.B.2",
				title: "Task B",
				dependencies: ["9.B.1"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
		...overrides,
	};
}

describe("ProposalExecutionPipeline", () => {
	let pipeline: ProposalExecutionPipeline;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		pipeline = createProposalExecutionPipeline({ workspaceRoot: TEST_DIR });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	// =========================================================================
	// Basic Pipeline Operations
	// =========================================================================

	describe("Basic pipeline operations", () => {
		it("should initialize and submit a proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await pipeline.submitProposal("Test Proposal", "P9", queue, plannerOutput);

			expect(result.success).toBe(true);
			expect(result.proposal).toBeDefined();
			expect(result.proposal!.status).toBe("pending");
			expect(result.proposal!.id).toMatch(/^prop-/);
		});

		it("should track pipeline stage after proposal submission", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await pipeline.submitProposal("Stage Test", "P9", queue, plannerOutput);
			const stage = pipeline.getPipelineStage(result.proposal!.id);

			expect(stage).toBe("proposal_submitted");
		});

		it("should track pipeline stage after proposal approval", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Approval Stage", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const stage = pipeline.getPipelineStage(submitResult.proposal!.id);
			expect(stage).toBe("proposal_approved");
		});

		it("should have stage history entries", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("History", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const history = pipeline.getPipelineStageHistory(submitResult.proposal!.id);
			expect(history).toBeDefined();
			expect(history!.length).toBe(2);
			expect(history![0].stage).toBe("proposal_submitted");
			expect(history![1].stage).toBe("proposal_approved");
		});

		it("should delegate rejectProposal to inbox", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Reject Test", "P9", queue, plannerOutput);
			const rejectResult = await pipeline.rejectProposal(submitResult.proposal!.id, "Not needed");

			expect(rejectResult.success).toBe(true);
			expect(rejectResult.proposal!.status).toBe("rejected");
		});

		it("should list proposals", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			await pipeline.submitProposal("Listable", "P9", queue, plannerOutput);
			const proposals = await pipeline.listProposals();

			expect(proposals).toHaveLength(1);
			expect(proposals[0].title).toBe("Listable");
		});

		it("should get proposal by ID", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const result = await pipeline.submitProposal("Fetchable", "P9", queue, plannerOutput);
			const proposal = await pipeline.getProposal(result.proposal!.id);

			expect(proposal).toBeDefined();
			expect(proposal!.title).toBe("Fetchable");
		});
	});

	// =========================================================================
	// AC1: Approved proposals can generate remediation plan drafts
	// =========================================================================

	describe("AC1: Approved proposals can generate remediation plan drafts", () => {
		it("should reject remediation draft generation from non-approved proposals", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Not Approved", "P9", queue, plannerOutput);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: {
					kind: "user_initiated",
					description: "Test remediation",
					timestamp: Date.now(),
				},
				leadAgentId: "agent-1",
			});

			expect(draftResult.success).toBe(false);
			expect(draftResult.error).toContain("non-approved");
		});

		it("should generate remediation draft from approved proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Draftable", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: {
					kind: "user_initiated",
					description: "Fix defect found in scan",
					timestamp: Date.now(),
				},
				leadAgentId: "agent-1",
			});

			expect(draftResult.success).toBe(true);
			expect(draftResult.remediationDraft).toBeDefined();
			expect(draftResult.remediationDraft!.remediationType).toBe("defect_fix");
			expect(draftResult.remediationDraft!.source.kind).toBe("user_initiated");
			expect(draftResult.remediationDraft!.source.description).toBe("Fix defect found in scan");
			expect(draftResult.remediationDraft!.draftMeta.leadAgentId).toBe("agent-1");
			expect(draftResult.remediationDraft!.draftMeta.id).toMatch(/^draft-/);
			expect(draftResult.remediationDraft!.planningApproved).toBe(false);
			expect(draftResult.remediationDraft!.executionApproved).toBe(false);
		});

		it("should support all remediation types", async () => {
			const types = [
				"defect_fix",
				"conflict_resolution",
				"performance_optimization",
				"dependency_repair",
				"safety_remediation",
				"general",
			] as const;

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Types Test", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			for (const remediationType of types) {
				const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
					remediationType,
					source: {
						kind: "user_initiated",
						description: `Testing type: ${remediationType}`,
						timestamp: Date.now(),
					},
					leadAgentId: "agent-1",
				});

				expect(draftResult.success).toBe(true);
				expect(draftResult.remediationDraft!.remediationType).toBe(remediationType);
			}
		});

		it("should support all source kinds", async () => {
			const kinds = ["detection_output", "feedback_loop", "user_initiated", "scheduled", "health_signal"] as const;

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Sources Test", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			for (const kind of kinds) {
				const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
					remediationType: "general",
					source: {
						kind,
						description: `Source: ${kind}`,
						timestamp: Date.now(),
					},
					leadAgentId: "agent-1",
				});

				expect(draftResult.success).toBe(true);
				expect(draftResult.remediationDraft!.source.kind).toBe(kind);
			}
		});

		it("should reject draft generation without lead agent ID", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("No Agent", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "general",
				source: {
					kind: "user_initiated",
					description: "Test",
					timestamp: Date.now(),
				},
				leadAgentId: "",
			});

			expect(draftResult.success).toBe(false);
			expect(draftResult.error).toContain("leadAgentId");
		});

		it("should reject draft generation without source", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("No Source", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			// Missing source
			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "general",
				source: undefined as any,
				leadAgentId: "agent-1",
			});

			expect(draftResult.success).toBe(false);
		});

		it("should track pipeline stage after draft generation", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Stage Draft", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: {
					kind: "detection_output",
					description: "Detection findings",
					timestamp: Date.now(),
				},
				leadAgentId: "agent-1",
			});

			expect(draftResult.success).toBe(true);

			const stage = pipeline.getPipelineStage(submitResult.proposal!.id);
			expect(stage).toBe("remediation_draft_ready");

			const history = pipeline.getPipelineStageHistory(submitResult.proposal!.id);
			expect(history!.length).toBe(4); // submitted -> approved -> remediation_drafting -> remediation_draft_ready
		});
	});

	// =========================================================================
	// AC2: Planning approval does not imply execution approval
	// =========================================================================

	describe("AC2: Planning approval does not imply execution approval", () => {
		async function setupPipelineWithDraft(): Promise<{
			pipeline: ProposalExecutionPipeline;
			proposalId: string;
			draftId: string;
		}> {
			const p = new ProposalExecutionPipeline({ workspaceRoot: TEST_DIR });
			await p.initialize();

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await p.submitProposal("AC2 Base", "P9", queue, plannerOutput);
			await p.approveProposal(submitResult.proposal!.id);

			const draftResult = await p.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: { kind: "user_initiated", description: "AC2 test", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			return {
				pipeline: p,
				proposalId: submitResult.proposal!.id,
				draftId: draftResult.remediationDraft!.draftMeta.id,
			};
		}

		it("should allow planning approval without execution approval", async () => {
			const { pipeline: pl, draftId } = await setupPipelineWithDraft();

			// Plan approval should work (Gate 1)
			const planApproval = await pl.approvePlanning(draftId, {
				actor: "reviewer",
				reason: "Plan looks good",
			});

			expect(planApproval.success).toBe(true);
			expect(planApproval.remediationDraft!.planningApproved).toBe(true);
			expect(planApproval.remediationDraft!.executionApproved).toBe(false);

			// AC2: Planning approval does not imply execution approval
			expect(pl.isExecutionApproved(draftId)).toBe(false);
		});

		it("should require planning approval before execution approval", async () => {
			const { pipeline: pl, draftId } = await setupPipelineWithDraft();

			// Attempt execution approval directly — should fail (no planning approval)
			const execApproval = await pl.approveExecution(draftId, {
				actor: "reviewer",
				reason: "Let's execute",
			});

			expect(execApproval.success).toBe(false);
			expect(execApproval.error).toContain("planning approval");
			expect(execApproval.error).toContain("Gate 1");
		});

		it("should require both gates for execution approval", async () => {
			const { pipeline: pl, draftId } = await setupPipelineWithDraft();

			// Gate 1: planning approval
			await pl.approvePlanning(draftId, { actor: "reviewer", reason: "Plan approved" });
			expect(pl.isExecutionApproved(draftId)).toBe(false);

			// Gate 2: execution approval
			const execApproval = await pl.approveExecution(draftId, { actor: "reviewer", reason: "Execute" });

			expect(execApproval.success).toBe(true);
			expect(execApproval.remediationDraft!.planningApproved).toBe(true);
			expect(execApproval.remediationDraft!.executionApproved).toBe(true);
			expect(pl.isExecutionApproved(draftId)).toBe(true);
		});

		it("should prevent duplicate planning approval", async () => {
			const { pipeline: pl, draftId } = await setupPipelineWithDraft();

			await pl.approvePlanning(draftId);

			const duplicate = await pl.approvePlanning(draftId);
			expect(duplicate.success).toBe(false);
			expect(duplicate.error).toContain("already");
		});

		it("should prevent duplicate execution approval", async () => {
			const { pipeline: pl, draftId } = await setupPipelineWithDraft();

			await pl.approvePlanning(draftId);
			await pl.approveExecution(draftId);

			const duplicate = await pl.approveExecution(draftId);
			expect(duplicate.success).toBe(false);
			expect(duplicate.error).toContain("already");
		});

		it("should provide execution block reason when gates not passed", async () => {
			const { pipeline: pl, draftId } = await setupPipelineWithDraft();

			// Both gates not passed
			const reason1 = pl.getExecutionBlockReason(draftId);
			expect(reason1).toBeDefined();
			expect(reason1).toContain("Planning approval");
			expect(reason1).toContain("Execution approval");

			// Only planning passed
			await pl.approvePlanning(draftId);
			const reason2 = pl.getExecutionBlockReason(draftId);
			expect(reason2).toBeDefined();
			expect(reason2).toContain("Execution approval");
			expect(reason2).toContain("Gate 2");

			// Both passed
			await pl.approveExecution(draftId);
			const reason3 = pl.getExecutionBlockReason(draftId);
			expect(reason3).toBeUndefined();
		});

		it("assertExecutionApproved should throw when gates not passed", async () => {
			const { pipeline: pl, draftId } = await setupPipelineWithDraft();

			expect(() => pl.assertExecutionApproved(draftId)).toThrow("cannot be executed");

			await pl.approvePlanning(draftId);
			expect(() => pl.assertExecutionApproved(draftId)).toThrow("cannot be executed");

			await pl.approveExecution(draftId);
			expect(() => pl.assertExecutionApproved(draftId)).not.toThrow();
		});

		it("should track pipeline stages through both gates", async () => {
			const { pipeline: pl, proposalId, draftId } = await setupPipelineWithDraft();

			// After draft generation
			let stage = pl.getPipelineStage(proposalId);
			expect(stage).toBe("remediation_draft_ready");

			// After planning approval
			await pl.approvePlanning(draftId);
			stage = pl.getPipelineStage(proposalId);
			expect(stage).toBe("planning_approved");

			// After execution approval
			await pl.approveExecution(draftId);
			stage = pl.getPipelineStage(proposalId);
			expect(stage).toBe("execution_approved");
		});
	});

	// =========================================================================
	// AC3: Generated plans can be submitted to planner optimization
	// =========================================================================

	describe("AC3: Generated plans can be submitted to planner optimization", () => {
		it("should require feedback loop to be configured", async () => {
			// Pipeline without feedback loop
			// Pipeline without feedback loop - use the pipeline directly, which has no feedback loop configured
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Opt NoLoop", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: { kind: "user_initiated", description: "Opt test", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const draftId = draftResult.remediationDraft!.draftMeta.id;

			const optResult = await pipeline.submitToOptimization(draftId, []);
			expect(optResult.success).toBe(false);
			expect(optResult.error).toContain("feedback loop");
		});

		it("should require execution outcomes for optimization", async () => {
			const { PlannerFeedbackLoop } = await import("../src/core/planner-feedback-loop.js");
			const feedbackLoop = new PlannerFeedbackLoop();

			const pipeline = new ProposalExecutionPipeline({
				workspaceRoot: TEST_DIR,
				feedbackLoop,
			});

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Opt Outcomes", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: { kind: "detection_output", description: "Detection", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const draftId = draftResult.remediationDraft!.draftMeta.id;

			// Empty outcomes — should fail
			const optResult = await pipeline.submitToOptimization(draftId, []);
			expect(optResult.success).toBe(false);
			expect(optResult.error).toContain("outcomes");
		});

		it("should submit outcomes to feedback loop and get results", async () => {
			const { PlannerFeedbackLoop } = await import("../src/core/planner-feedback-loop.js");
			const feedbackLoop = new PlannerFeedbackLoop();
			const pipeline = new ProposalExecutionPipeline({
				workspaceRoot: TEST_DIR,
				feedbackLoop,
			});
			await pipeline.initialize();

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Opt Success", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "performance_optimization",
				source: { kind: "feedback_loop", description: "From feedback loop", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const draftId = draftResult.remediationDraft!.draftMeta.id;

			// Create some execution outcomes
			const outcomes = [
				{
					workspaceId: "9.B.1",
					status: "merged" as const,
					validationPassed: true,
					timingMetrics: {
						waitTimeMs: 5000,
						mergeTimeMs: 10000,
						totalTimeMs: 15000,
					},
					queuedAt: Date.now() - 60000,
					processedAt: Date.now() - 55000,
					completedAt: Date.now() - 45000,
				},
				{
					workspaceId: "9.B.2",
					status: "merged" as const,
					validationPassed: true,
					timingMetrics: {
						waitTimeMs: 3000,
						mergeTimeMs: 8000,
						totalTimeMs: 11000,
					},
					queuedAt: Date.now() - 60000,
					processedAt: Date.now() - 55000,
					completedAt: Date.now() - 47000,
				},
			];

			const optResult = await pipeline.submitToOptimization(draftId, outcomes);
			expect(optResult.success).toBe(true);
			expect(optResult.feedbackResult).toBeDefined();
			expect(optResult.feedbackResult!.success).toBe(true);

			// Should have risk model updates or recommendations
			expect(optResult.feedbackResult!.riskModelUpdates).toBeDefined();
			expect(optResult.feedbackResult!.rebatchingRecommendations).toBeDefined();
		});

		it("should detect failure patterns in outcomes", async () => {
			const { PlannerFeedbackLoop } = await import("../src/core/planner-feedback-loop.js");
			const feedbackLoop = new PlannerFeedbackLoop();
			const pipeline = new ProposalExecutionPipeline({
				workspaceRoot: TEST_DIR,
				feedbackLoop,
			});
			await pipeline.initialize();

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Opt Failure", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: { kind: "detection_output", description: "Failure scan", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const draftId = draftResult.remediationDraft!.draftMeta.id;

			// Outcomes with failures
			const outcomes = [
				{
					workspaceId: "9.B.1",
					status: "failed" as const,
					error: "Execution failed: timeout exceeded",
					queuedAt: Date.now() - 60000,
					completedAt: Date.now() - 30000,
				},
				{
					workspaceId: "9.B.2",
					status: "blocked" as const,
					validationPassed: false,
					error: "Validation failed: lint errors",
					queuedAt: Date.now() - 60000,
					completedAt: Date.now() - 30000,
				},
			];

			const optResult = await pipeline.submitToOptimization(draftId, outcomes);
			expect(optResult.success).toBe(true);

			// Should have risk model updates for failures
			expect(optResult.feedbackResult!.riskModelUpdates.length).toBeGreaterThan(0);
			expect(optResult.feedbackResult!.summary).toContain("Risk Model Updates");

			// AC3: optimization result is stored on the draft
			expect(pipeline.isSubmittedToOptimization(draftId)).toBe(true);
		});

		it("should update pipeline stage after optimization submission", async () => {
			const { PlannerFeedbackLoop } = await import("../src/core/planner-feedback-loop.js");
			const feedbackLoop = new PlannerFeedbackLoop();
			const pipeline = new ProposalExecutionPipeline({
				workspaceRoot: TEST_DIR,
				feedbackLoop,
			});
			await pipeline.initialize();

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Opt Stage", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "performance_optimization",
				source: { kind: "feedback_loop", description: "Stage test", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const draftId = draftResult.remediationDraft!.draftMeta.id;

			const outcomes = [
				{
					workspaceId: "9.B.1",
					status: "merged" as const,
					validationPassed: true,
					timingMetrics: { waitTimeMs: 1000, mergeTimeMs: 5000, totalTimeMs: 6000 },
					queuedAt: Date.now() - 60000,
					processedAt: Date.now() - 55000,
					completedAt: Date.now() - 54000,
				},
			];

			await pipeline.submitToOptimization(draftId, outcomes);

			const stage = pipeline.getPipelineStage(submitResult.proposal!.id);
			expect(stage).toBe("optimization_submitted");
		});

		it("should retrieve optimization result from pipeline", async () => {
			const { PlannerFeedbackLoop } = await import("../src/core/planner-feedback-loop.js");
			const feedbackLoop = new PlannerFeedbackLoop();
			const pipeline = new ProposalExecutionPipeline({
				workspaceRoot: TEST_DIR,
				feedbackLoop,
			});
			await pipeline.initialize();

			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Opt Retrieve", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "general",
				source: { kind: "user_initiated", description: "Retrieve test", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const draftId = draftResult.remediationDraft!.draftMeta.id;

			const outcomes = [
				{
					workspaceId: "9.B.1",
					status: "merged" as const,
					validationPassed: true,
					timingMetrics: { waitTimeMs: 1000, mergeTimeMs: 5000, totalTimeMs: 6000 },
					queuedAt: Date.now() - 60000,
					processedAt: Date.now() - 55000,
					completedAt: Date.now() - 54000,
				},
			];

			await pipeline.submitToOptimization(draftId, outcomes);

			const result = pipeline.getOptimizationResult(draftId);
			expect(result).toBeDefined();
			expect(result!.success).toBe(true);
		});
	});

	// =========================================================================
	// Remediation Draft Management
	// =========================================================================

	describe("Remediation draft management", () => {
		it("should list remediation drafts for a proposal", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("List Drafts", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "defect_fix",
				source: { kind: "user_initiated", description: "Draft 1", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const drafts = pipeline.listRemediationDrafts(submitResult.proposal!.id);
			expect(drafts).toHaveLength(1);
			expect(drafts[0].remediationType).toBe("defect_fix");
		});

		it("should get a remediation draft by ID", async () => {
			const queue = createMinimalQueue();
			const plannerOutput = createMinimalPlannerOutput();

			const submitResult = await pipeline.submitProposal("Get Draft", "P9", queue, plannerOutput);
			await pipeline.approveProposal(submitResult.proposal!.id);

			const draftResult = await pipeline.generateRemediationDraft(submitResult.proposal!.id, {
				remediationType: "safety_remediation",
				source: { kind: "health_signal", description: "Health check", timestamp: Date.now() },
				leadAgentId: "agent-1",
			});

			const draftId = draftResult.remediationDraft!.draftMeta.id;
			const draft = pipeline.getRemediationDraft(draftId);
			expect(draft).toBeDefined();
			expect(draft!.remediationType).toBe("safety_remediation");
			expect(draft!.source.kind).toBe("health_signal");
		});

		it("should return undefined for non-existent draft", async () => {
			const draft = pipeline.getRemediationDraft("non-existent-draft");
			expect(draft).toBeUndefined();
		});
	});

	// =========================================================================
	// Formatting
	// =========================================================================

	describe("Formatting", () => {
		it("should format pipeline stage label", () => {
			const label = pipeline.formatPipelineStage("proposal_approved");
			expect(label).toContain("Proposal approved");
		});

		it("should format pipeline stage entry", () => {
			const entry = {
				stage: "proposal_approved" as const,
				timestamp: 1700000000000,
				reason: "Looks good",
				actor: "reviewer",
			};
			const formatted = formatPipelineStageEntry(entry);
			expect(formatted).toContain("proposal_approved");
			expect(formatted).toContain("reviewer");
			expect(formatted).toContain("Looks good");
		});

		it("should format pipeline stage history", () => {
			const entries = [
				{
					stage: "proposal_submitted" as const,
					timestamp: 1700000000000,
					reason: "Submitted",
				},
				{
					stage: "proposal_approved" as const,
					timestamp: 1700000000100,
					reason: "Approved",
					actor: "reviewer",
				},
			];
			const formatted = formatPipelineStageHistory(entries);
			expect(formatted).toContain("proposal_submitted");
			expect(formatted).toContain("proposal_approved");
		});

		it("should format empty history", () => {
			expect(formatPipelineStageHistory([])).toBe("No pipeline stage history.");
		});
	});
});

// =========================================================================
// Helpers (used internally above)
// =========================================================================
