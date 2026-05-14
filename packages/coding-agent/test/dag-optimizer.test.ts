/**
 * Tests for DAG Optimizer - P7.B
 *
 * Acceptance criteria:
 * 1. Optimizer identifies critical path and bottlenecks.
 * 2. Optimizer proposes workspace splits and dependency reductions with evidence.
 * 3. Dependency changes require approval before becoming executable.
 */

import { describe, expect, it } from "vitest";
import {
	analyzeOptimizationOpportunities,
	applyApprovedProposals,
	approveProposal,
	createPatchPlanFromApprovedProposals,
	formatOptimizationResult,
	previewApprovedProposals,
	rejectProposal,
} from "../src/core/dag-optimizer.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal workspace with given id and dependencies */
function ws(id: string, deps: string[] = [], extra?: Partial<Workspace>): Workspace {
	return {
		id,
		title: `Task ${id}`,
		dependencies: deps,
		roleBudget: "worker",
		maxRetries: 3,
		...extra,
	};
}

/** Create a workspace queue from workspaces */
function queue(workspaces: Workspace[], maxParallel = 3): WorkspaceQueue {
	return {
		phase: "5.4",
		title: "Test Plan",
		maxParallelWorkspaces: maxParallel,
		workspaces,
	};
}

// ---------------------------------------------------------------------------
// AC1: Optimizer identifies critical path and bottlenecks
// ---------------------------------------------------------------------------

describe("DAG Optimizer — AC1: critical path and bottlenecks", () => {
	it("identifies critical path length from batch plan", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"]), ws("D", ["C"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		// Critical path length = number of batches = 4
		expect(result.beforeBatchPlan.criticalPathLength).toBe(4);
		expect(result.beforeBatchPlan.totalBatches).toBe(4);
		expect(result.beforeBatchPlan.effectiveParallelism).toBe(1);
		expect(result.beforeBatchPlan.isOverSerialized).toBe(true);
	});

	it("identifies bottlenecks from single-width batches", () => {
		// A, B are parallel; C depends on both; D depends on C
		// Batch 1: [A, B], Batch 2: [C], Batch 3: [D]
		// Batch 2 (C) is a bottleneck — single width in the middle
		const workspaces = [ws("A"), ws("B"), ws("C", ["A", "B"]), ws("D", ["C"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		expect(result.beforeBatchPlan.totalBatches).toBe(3);
		// Batch 2 has width 1 — identified as serialization bottleneck
		const batch2 = result.beforeBatchPlan.batches.find((b) => b.batchIndex === 2);
		expect(batch2).toBeDefined();
		expect(batch2!.width).toBe(1);
	});

	it("identifies bottlenecks via over-serialization detection", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces, 5));

		expect(result.beforeBatchPlan.isOverSerialized).toBe(true);
		expect(result.beforeBatchPlan.effectiveParallelism).toBe(1);
		expect(result.beforeBatchPlan.requestedParallelism).toBe(5);
	});

	it("includes batch plan metrics in the result", () => {
		const workspaces = [ws("A"), ws("B"), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		expect(result.beforeBatchPlan).toBeDefined();
		expect(result.beforeBatchPlan.batches.length).toBeGreaterThan(0);
		expect(result.beforeBatchPlan.effectiveParallelism).toBeGreaterThanOrEqual(1);
		expect(result.beforeBatchPlan.totalBatches).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// AC2: Optimizer proposes workspace splits and dependency reductions
// ---------------------------------------------------------------------------

describe("DAG Optimizer — AC2: workspace splits and dependency reductions", () => {
	describe("Dependency reduction proposals", () => {
		it("proposes removal of transitive dependencies", () => {
			// A -> B -> C. C depends on both B and A.
			// A->C is transitive since B->C already ensures A completes before C.
			const workspaces = [
				ws("A"),
				ws("B", ["A"]),
				ws("C", ["A", "B"]), // A is transitive (B already depends on A)
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const removalProposals = result.proposals.filter((p) => p.kind === "remove_dependency");
			expect(removalProposals.length).toBeGreaterThanOrEqual(1);

			// Should identify A as transitive for C
			const transitiveProposal = removalProposals.find(
				(p) =>
					p.removalDetail?.workspaceId === "C" &&
					p.removalDetail?.dependencyId === "A" &&
					p.removalDetail?.rationale === "transitive",
			);
			expect(transitiveProposal).toBeDefined();
			expect(transitiveProposal!.evidence.afterBatchCount).toBeLessThanOrEqual(
				transitiveProposal!.evidence.beforeBatchCount,
			);
		});

		it("proposes removal of redundant same-batch dependencies", () => {
			// A and B are parallel (both in batch 1)
			// C depends on both A and B — both complete at same time, so one is redundant
			const workspaces = [ws("A"), ws("B"), ws("C", ["A", "B"])];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const removalProposals = result.proposals.filter((p) => p.kind === "remove_dependency");
			// Should find at least one redundant dependency
			expect(removalProposals.length).toBeGreaterThanOrEqual(1);

			const redundantProposal = removalProposals.find((p) => p.removalDetail?.rationale === "redundant");
			expect(redundantProposal).toBeDefined();
		});

		it("does not propose removal when a dep is required for ordering", () => {
			// A -> B -> C. C only depends on B (not directly on A).
			// No transitive dependency to remove.
			const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const removalProposals = result.proposals.filter((p) => p.kind === "remove_dependency");
			expect(removalProposals).toHaveLength(0);
		});

		it("proposal includes before/after evidence with parallelism metrics", () => {
			// A -> B -> C. C depends on A and B (A is transitive)
			const workspaces = [
				ws("A"),
				ws("B", ["A"]),
				ws("C", ["A", "B"]), // A is transitive
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const proposal = result.proposals.find(
				(p) =>
					p.kind === "remove_dependency" &&
					p.removalDetail?.workspaceId === "C" &&
					p.removalDetail?.dependencyId === "A",
			);
			expect(proposal).toBeDefined();
			expect(proposal!.evidence).toBeDefined();
			expect(proposal!.evidence.beforeParallelism).toBeGreaterThanOrEqual(0);
			expect(proposal!.evidence.afterParallelism).toBeGreaterThanOrEqual(0);
			expect(proposal!.evidence.beforeBatchCount).toBeGreaterThan(0);
			expect(proposal!.evidence.afterBatchCount).toBeGreaterThan(0);
		});
	});

	describe("Workspace split proposals", () => {
		it("proposes splitting workspaces with multiple acceptance criteria in serial batches", () => {
			// A is a single-width workspace in the middle with many ACs
			const workspaces = [
				ws("A"),
				ws("B", ["A"], {
					title: "Task B",
					acceptanceCriteria: [
						"Implement feature X",
						"Add tests for X",
						"Write docs for X",
						"Review X implementation",
					],
				}),
				ws("C", ["B"]),
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const splitProposals = result.proposals.filter((p) => p.kind === "split_workspace");
			expect(splitProposals.length).toBeGreaterThanOrEqual(1);

			const bSplit = splitProposals.find((p) => p.splitDetail?.workspaceId === "B");
			expect(bSplit).toBeDefined();
			expect(bSplit!.splitDetail!.proposedWorkspaceIds).toEqual(["B.part1", "B.part2", "B.part3", "B.part4"]);
			expect(bSplit!.splitDetail!.splitRationale).toHaveLength(4);
		});

		it("proposes splitting when workspace has multiple ACs and downstream dependents", () => {
			// B is a bottleneck with many ACs and downstream dependents
			const workspaces = [
				ws("A"),
				ws("B", ["A"], {
					title: "Task B",
					acceptanceCriteria: ["Write schema", "Write queries", "Write mutations"],
				}),
				ws("C", ["B"]),
				ws("D", ["B"]),
				ws("E", ["C", "D"]),
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const bSplit = result.proposals.find(
				(p) => p.kind === "split_workspace" && p.splitDetail?.workspaceId === "B",
			);
			expect(bSplit).toBeDefined();
			expect(bSplit!.affectedWorkspaceIds).toContain("B.part1");
			expect(bSplit!.affectedWorkspaceIds).toContain("B.part2");
			expect(bSplit!.affectedWorkspaceIds).toContain("B.part3");
		});

		it("does not propose splitting workspaces without acceptance criteria", () => {
			const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const splitProposals = result.proposals.filter((p) => p.kind === "split_workspace");
			expect(splitProposals).toHaveLength(0);
		});

		it("does not propose splitting workspaces in multi-width batches", () => {
			const workspaces = [
				ws("A", [], {
					acceptanceCriteria: ["Do X", "Do Y"],
				}),
				ws("B", [], {
					acceptanceCriteria: ["Do Z"],
				}),
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			// A is in a multi-width batch (batch 1 with B), not a bottleneck
			const splitProposals = result.proposals.filter((p) => p.kind === "split_workspace");
			expect(splitProposals).toHaveLength(0);
		});

		it("split proposal includes distribution of acceptance criteria", () => {
			const workspaces = [
				ws("A"),
				ws("B", ["A"], {
					acceptanceCriteria: ["Task 1", "Task 2"],
				}),
				ws("C", ["B"]), // B has a dependent, so split is proposed
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const bSplit = result.proposals.find(
				(p) => p.kind === "split_workspace" && p.splitDetail?.workspaceId === "B",
			);
			expect(bSplit).toBeDefined();
			expect(bSplit!.splitDetail!.acceptanceCriteriaDistribution).toBeDefined();
			expect(bSplit!.splitDetail!.acceptanceCriteriaDistribution!.B).toEqual(["Task 1", "Task 2"]);
			expect(bSplit!.splitDetail!.acceptanceCriteriaDistribution!["B.part1"]).toEqual(["Task 1"]);
			expect(bSplit!.splitDetail!.acceptanceCriteriaDistribution!["B.part2"]).toEqual(["Task 2"]);
		});
	});

	describe("Dependency addition proposals (serialization)", () => {
		it("proposes adding dependencies for file-overlapping workspaces", () => {
			const workspaces = [
				ws("A", [], {
					capabilities: {
						canEdit: ["src/core.ts"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
				}),
				ws("B", [], {
					capabilities: {
						canEdit: ["src/core.ts"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
				}),
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const additionProposals = result.proposals.filter((p) => p.kind === "add_dependency");
			expect(additionProposals.length).toBeGreaterThanOrEqual(1);

			const fileOverlapProposal = additionProposals.find((p) => p.additionDetail?.rationale === "file_overlap");
			expect(fileOverlapProposal).toBeDefined();
			expect(fileOverlapProposal!.additionDetail!.explanation).toContain("src/core.ts");
		});

		it("does not propose dependency addition if already serialized via existing deps", () => {
			const workspaces = [
				ws("A", [], {
					capabilities: {
						canEdit: ["src/core.ts"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
				}),
				ws("B", ["A"], {
					capabilities: {
						canEdit: ["src/core.ts"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
				}),
			];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			const additionProposals = result.proposals.filter((p) => p.kind === "add_dependency");
			// B already depends on A, so no addition needed
			expect(additionProposals).toHaveLength(0);
		});
	});

	describe("Proposal evidence", () => {
		it("every proposal includes before/after batch plan", () => {
			const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			for (const proposal of result.proposals) {
				expect(proposal.beforeBatchPlan).toBeDefined();
				expect(proposal.afterBatchPlan).toBeDefined();
				expect(proposal.evidence).toBeDefined();
			}
		});

		it("every proposal includes parallelism metrics in evidence", () => {
			const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
			const result = analyzeOptimizationOpportunities(queue(workspaces));

			for (const proposal of result.proposals) {
				expect(typeof proposal.evidence.beforeParallelism).toBe("number");
				expect(typeof proposal.evidence.afterParallelism).toBe("number");
				expect(typeof proposal.evidence.beforeBatchCount).toBe("number");
				expect(typeof proposal.evidence.afterBatchCount).toBe("number");
				expect(typeof proposal.evidence.description).toBe("string");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// AC3: Dependency changes require approval before becoming executable
// ---------------------------------------------------------------------------

describe("DAG Optimizer — AC3: approval flow", () => {
	it("proposals start in pending status", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		for (const proposal of result.proposals) {
			expect(proposal.approvalStatus).toBe("pending");
		}
	});

	it("approveProposal changes status to approved", () => {
		const workspaces = [
			ws("A"),
			ws("B", ["A"]),
			ws("C", ["A", "B"]), // A is transitive
		];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		const removal = result.proposals.find((p) => p.kind === "remove_dependency");
		expect(removal).toBeDefined();

		const approved = approveProposal(removal!);
		expect(approved.approvalStatus).toBe("approved");
		expect(approved.id).toBe(removal!.id); // Same proposal identity
	});

	it("rejectProposal changes status to rejected with reason", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		const removal = result.proposals.find((p) => p.kind === "remove_dependency");
		expect(removal).toBeDefined();

		const rejected = rejectProposal(removal!, "This dependency is intentionally transitive for safety");
		expect(rejected.approvalStatus).toBe("rejected");
		expect(rejected.rejectionReason).toBe("This dependency is intentionally transitive for safety");
	});

	it("createPatchPlanFromApprovedProposals requires all proposals with patches to be approved", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		// Try to create a patch plan without approving any proposals
		expect(() => createPatchPlanFromApprovedProposals(result.proposals, result.queue)).toThrow(/not been approved/);
	});

	it("createPatchPlanFromApprovedProposals succeeds when all patchable proposals are approved", () => {
		const workspaces = [
			ws("A"),
			ws("B", ["A"]),
			ws("C", ["A", "B"]), // A is transitive
		];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		const removal = result.proposals.find(
			(p) =>
				p.kind === "remove_dependency" &&
				p.removalDetail?.workspaceId === "C" &&
				p.removalDetail?.dependencyId === "A",
		);
		expect(removal).toBeDefined();

		const approved = approveProposal(removal!);
		const plan = createPatchPlanFromApprovedProposals([approved], result.queue);

		expect(plan).toBeDefined();
		expect(plan.patches).toHaveLength(1);
		expect(plan.patches[0].workspaceId).toBe("C");
		expect(plan.patches[0].dependencyId).toBe("A");
		expect(plan.patches[0].kind).toBe("remove_dependency");
	});

	it("previewApprovedProposals shows before/after state", () => {
		const workspaces = [
			ws("A"),
			ws("B", ["A"]),
			ws("C", ["A", "B"]), // A is transitive
		];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		const removal = result.proposals.find(
			(p) =>
				p.kind === "remove_dependency" &&
				p.removalDetail?.workspaceId === "C" &&
				p.removalDetail?.dependencyId === "A",
		);
		expect(removal).toBeDefined();

		const approved = approveProposal(removal!);
		const preview = previewApprovedProposals([approved], result.queue);

		expect(preview).toBeDefined();
		expect(preview.snapshots).toHaveLength(1);
		expect(preview.snapshots[0].workspaceId).toBe("C");
		expect(preview.snapshots[0].before).toContain("A");
		expect(preview.snapshots[0].after).not.toContain("A");
	});

	it("applyApprovedProposals applies approved changes to queue", () => {
		const workspaces = [
			ws("A"),
			ws("B", ["A"]),
			ws("C", ["A", "B"]), // A is transitive
		];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		const removal = result.proposals.find(
			(p) =>
				p.kind === "remove_dependency" &&
				p.removalDetail?.workspaceId === "C" &&
				p.removalDetail?.dependencyId === "A",
		);
		expect(removal).toBeDefined();

		const approved = approveProposal(removal!);
		const newQueue = applyApprovedProposals([approved], result.queue);

		// Verify C's dependencies no longer include A
		const cWs = newQueue.workspaces.find((w) => w.id === "C");
		expect(cWs).toBeDefined();
		expect(cWs!.dependencies).not.toContain("A");
		expect(cWs!.dependencies).toContain("B"); // B is still there
	});

	it("does not allow creating patch plan from rejected proposals", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		const removal = result.proposals.find((p) => p.kind === "remove_dependency");
		expect(removal).toBeDefined();

		const rejected = rejectProposal(removal!, "Not needed");
		expect(() => createPatchPlanFromApprovedProposals([rejected], result.queue)).toThrow(/not been approved/);
	});

	it("summary indicates pending proposals requiring approval", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		expect(result.hasPendingProposals).toBe(true);
		expect(result.summary.text).toContain("optimization opportunities");
	});
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatOptimizationResult", () => {
	it("produces readable output with proposals", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));
		const formatted = formatOptimizationResult(result);

		expect(formatted).toContain("DAG Optimization Analysis");
		expect(formatted).toContain("Current Batch Plan");
		expect(formatted).toContain("Proposals");
	});

	it("includes approval reminder when proposals are pending", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));
		const formatted = formatOptimizationResult(result);

		expect(formatted).toContain("require approval");
		expect(formatted).toContain("Dependency changes are NOT executable until approved");
	});

	it("output shows proposal status symbols", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));
		const formatted = formatOptimizationResult(result);

		expect(formatted).toContain("[PENDING]");
	});

	it("shows empty state when no proposals generated", () => {
		const workspaces = [ws("A"), ws("B"), ws("C")];
		const result = analyzeOptimizationOpportunities(queue(workspaces));
		const formatted = formatOptimizationResult(result);

		expect(formatted).toContain("No optimization proposals generated");
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("DAG Optimizer — edge cases", () => {
	it("handles empty queue gracefully", () => {
		const result = analyzeOptimizationOpportunities(queue([], 3));

		expect(result.beforeBatchPlan).toBeDefined();
		expect(result.proposals).toHaveLength(0);
		expect(result.beforeBatchPlan.errors.length).toBeGreaterThan(0);
	});

	it("handles single workspace", () => {
		const result = analyzeOptimizationOpportunities(queue([ws("SOLO")]));

		expect(result.proposals).toHaveLength(0);
		expect(result.beforeBatchPlan.totalBatches).toBe(1);
	});

	it("handles maxParallelWorkspaces = 0", () => {
		const workspaces = [ws("A"), ws("B")];
		const result = analyzeOptimizationOpportunities(queue(workspaces, 0));

		expect(result.beforeBatchPlan).toBeDefined();
		expect(result.proposals).toHaveLength(0);
	});

	it("handles workspace with no acceptance criteria (no split proposal)", () => {
		// Workspace in single-width batch but no ACs — should not propose split
		const workspaces = [
			ws("A"),
			ws("B", ["A"]), // No acceptanceCriteria
			ws("C", ["B"]),
		];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		const splitProposals = result.proposals.filter((p) => p.kind === "split_workspace");
		expect(splitProposals).toHaveLength(0);
	});

	it("handles fully parallel workspace set (no optimization needed)", () => {
		const workspaces = [ws("A"), ws("B"), ws("C"), ws("D")];
		const result = analyzeOptimizationOpportunities(queue(workspaces, 10));

		// No transitive deps, no splits needed, no single-width bottlenecks
		expect(result.summary.totalProposals).toBe(0);
	});

	it("generates summary with correct counts", () => {
		// Set up a complex scenario that triggers multiple proposal types
		const workspaces = [
			// A -> B -> C (chain for bottleneck detection)
			ws("A"),
			ws("B", ["A"]),
			ws("C", ["A", "B"], {
				acceptanceCriteria: ["Task 1", "Task 2", "Task 3"],
			}),
			// D, E parallel (file overlap)
			ws("D", [], {
				capabilities: {
					canEdit: ["src/shared.ts"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			}),
			ws("E", [], {
				capabilities: {
					canEdit: ["src/shared.ts"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			}),
		];
		const result = analyzeOptimizationOpportunities(queue(workspaces, 5));

		expect(result.summary.totalProposals).toBeGreaterThanOrEqual(1);

		// The summary text should mention type breakdown
		const formatted = formatOptimizationResult(result);
		if (result.summary.splitProposals > 0) {
			expect(formatted).toContain("Workspace Splits");
		}
		if (result.summary.dependencyRemovalProposals > 0) {
			expect(formatted).toContain("Dependency Removals");
		}
		if (result.summary.dependencyAdditionProposals > 0) {
			expect(formatted).toContain("Dependency Additions");
		}
	});

	it("hasPendingProposals reflects actual pending count", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])];
		const result = analyzeOptimizationOpportunities(queue(workspaces));

		expect(result.hasPendingProposals).toBe(result.proposals.some((p) => p.approvalStatus === "pending"));

		// After approving all, hasPendingProposals should be false
		const allApproved = result.proposals.map((p) => approveProposal(p));
		const hasPending = allApproved.some((p) => p.approvalStatus === "pending");
		expect(hasPending).toBe(false);
	});
});
