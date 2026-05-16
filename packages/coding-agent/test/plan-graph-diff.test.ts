/**
 * Tests for Plan Graph Diff and Patch Approval Engine - P11.I
 *
 * Acceptance Criteria:
 * 1. Original and optimized graph diffs can be generated for a plan with
 *    at least ten workspaces.
 * 2. Invalid patches are rejected with actionable reasons.
 * 3. Approved graph hash is persisted and executor uses the approved graph,
 *    not stale authored previews.
 * 4. Approval state transitions are audited.
 */

import { describe, expect, it } from "vitest";
import { analyzeOptimizationOpportunities } from "../src/core/dag-optimizer.js";
import {
	createAddDependencyPatch,
	createDependencyPatchPlan,
	createRemoveDependencyPatch,
} from "../src/core/dependency-patch.js";
import { createGovernanceLedger } from "../src/core/governance-ledger.js";
import {
	computeGraphHash,
	createPatchApprovalSession,
	validatePatchPlanWithGuidance,
	verifyApprovedGraphHash,
} from "../src/core/patch-approval-engine.js";
import {
	formatGraphDiff,
	formatGraphDiffSummary,
	generateGraphDiff,
	generateOptimizedDiff,
} from "../src/core/plan-graph-diff.js";
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
		phase: "P11",
		title: "P11.I Test Plan",
		maxParallelWorkspaces: maxParallel,
		workspaces,
	};
}

// ---------------------------------------------------------------------------
// AC1: Graph diffs for plans with at least ten workspaces
// ---------------------------------------------------------------------------

describe("P11.I AC1 — Graph diffs for 10+ workspace plans", () => {
	it("generates graph diff for 10 workspace serial plan", () => {
		const wsList: Workspace[] = [];
		for (let i = 0; i < 10; i++) {
			const id = String.fromCharCode(65 + i);
			const deps = i > 0 ? [String.fromCharCode(64 + i)] : [];
			wsList.push(ws(id, deps));
		}

		const originalQueue = queue(wsList);
		const modifiedQueue = queue([
			ws("A"),
			ws("B", ["A"]),
			ws("C"),
			ws("D", ["C"]),
			ws("E", ["D"]),
			ws("F"),
			ws("G", ["F"]),
			ws("H", ["G"]),
			ws("I", ["H"]),
			ws("J", ["I"]),
		]);

		const diff = generateGraphDiff(originalQueue, modifiedQueue, "Original", "Restructured");
		const formatted = formatGraphDiff(diff);

		expect(diff.beforeBatchPlan.batches.length).toBeGreaterThan(0);
		expect(diff.afterBatchPlan.batches.length).toBeGreaterThan(0);
		expect(diff.dependencyChanges.length).toBeGreaterThan(0);
		expect(formatted).toContain("=== Plan Graph Diff ===");
		expect(formatted).toContain("Restructured");
	});

	it("generates graph diff for 10 workspace plan with parallelism changes", () => {
		// Original: serial chain of 10
		const serialWorkspaces: Workspace[] = [];
		for (let i = 0; i < 10; i++) {
			const id = `WS${i + 1}`;
			const deps = i > 0 ? [`WS${i}`] : [];
			serialWorkspaces.push(ws(id, deps));
		}

		// Optimized: parallel groups
		const parallelWorkspaces: Workspace[] = [
			ws("WS1"),
			ws("WS2"),
			ws("WS3"),
			ws("WS4"),
			ws("WS5"),
			ws("WS6", ["WS1", "WS2"]),
			ws("WS7", ["WS3", "WS4"]),
			ws("WS8", ["WS5"]),
			ws("WS9", ["WS6", "WS7"]),
			ws("WS10", ["WS8", "WS9"]),
		];

		const originalQueue = queue(serialWorkspaces);
		const optimizedQueue = queue(parallelWorkspaces);

		const diff = generateGraphDiff(originalQueue, optimizedQueue, "Authored (serial)", "Optimized (parallel)");

		expect(diff.beforeBatchPlan.totalBatches).toBe(10);
		expect(diff.afterBatchPlan.totalBatches).toBeLessThan(10);
		expect(diff.dependencyChanges.length).toBeGreaterThan(0);
		expect(diff.identical).toBe(false);

		const summary = formatGraphDiffSummary(diff);
		expect(summary).toContain("Batches: 10->");
		expect(summary).toContain("Parallelism: 1->");
	});

	it("detects identical graphs correctly", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
		const q = queue(workspaces);
		const diff = generateGraphDiff(q, q, "Same", "Same");
		expect(diff.identical).toBe(true);
		expect(diff.dependencyChanges).toHaveLength(0);
	});

	it("generates optimized diff from proposals", () => {
		const originalWorkspaces: Workspace[] = [ws("A"), ws("B", ["A"]), ws("C", ["A", "B"]), ws("D")];

		const originalQueue = queue(originalWorkspaces, 3);
		const result = analyzeOptimizationOpportunities(originalQueue);
		const diff = generateOptimizedDiff(originalQueue, result.proposals, "Optimizer Applied");

		expect(diff).toBeDefined();
		expect(diff.metrics).toBeDefined();
		expect(diff.beforeLabel).toBe("Original");
		expect(diff.afterLabel).toBe("Optimizer Applied");
	});

	it("handles optimized diff with no proposals", () => {
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"])];
		const q = queue(workspaces);
		const diff = generateOptimizedDiff(q, [], "No proposals");
		expect(diff.identical).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC2: Invalid patches rejected with actionable reasons
// ---------------------------------------------------------------------------

describe("P11.I AC2 — Invalid patches rejected with actionable reasons", () => {
	it("rejects non-existent workspace with actionable guidance", () => {
		const q = queue([ws("A"), ws("B", ["A"])]);
		const patch = createRemoveDependencyPatch("non_existent", "A", "Remove A from non_existent");
		const plan = createDependencyPatchPlan([patch], "P11");
		const result = validatePatchPlanWithGuidance(plan, q);

		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		const wsError = result.errors.find((e) => e.type === "workspace_not_found");
		expect(wsError).toBeDefined();
		expect(wsError!.actionableGuidance).toContain("Add workspace");
	});

	it("rejects self-dependency with actionable guidance", () => {
		const q = queue([ws("A")]);
		const patch = createAddDependencyPatch("A", "A", "A depends on itself");
		const plan = createDependencyPatchPlan([patch], "P11");
		const result = validatePatchPlanWithGuidance(plan, q);

		expect(result.valid).toBe(false);
		// Self-dependency should produce a cycle_detected error
		const cycleError = result.errors.find(
			(e) => e.type === "cycle_detected" && e.message.includes("cannot depend on itself"),
		);
		expect(cycleError).toBeDefined();
		expect(cycleError!.actionableGuidance).toBeTruthy();
	});

	it("rejects cycle-creating patches with actionable cycle guidance", () => {
		// A -> B -> C, trying to add C -> A (creates cycle)
		const q = queue([ws("A"), ws("B", ["A"]), ws("C", ["B"])]);
		const patch = createAddDependencyPatch("A", "C", "Adding C as dependency of A creates cycle");
		const plan = createDependencyPatchPlan([patch], "P11");
		const result = validatePatchPlanWithGuidance(plan, q);

		expect(result.valid).toBe(false);
		const cycleError = result.errors.find((e) => e.type === "cross_workspace_cycle" || e.type === "cycle_detected");
		expect(cycleError).toBeDefined();
		expect(cycleError!.actionableGuidance).toContain("cycle");
	});

	it("rejects empty patch plan with actionable guidance", () => {
		const q = queue([ws("A")]);
		const plan = createDependencyPatchPlan([], "P11");
		const result = validatePatchPlanWithGuidance(plan, q);

		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		const emptyError = result.errors.find((e) => e.type === "empty_patch_plan");
		expect(emptyError).toBeDefined();
		expect(emptyError!.actionableGuidance).toContain("at least one dependency patch");
	});

	it("rejects duplicate dependency with actionable guidance", () => {
		// A already depends on B - trying to add B again
		const q = queue([ws("A", ["B"]), ws("B")]);
		const patch = createAddDependencyPatch("A", "B", "Duplicate dependency");
		const plan = createDependencyPatchPlan([patch], "P11");
		const result = validatePatchPlanWithGuidance(plan, q);

		expect(result.valid).toBe(false);
		const dupError = result.errors.find((e) => e.type === "dependency_already_exists");
		expect(dupError).toBeDefined();
		expect(dupError!.actionableGuidance).toContain("already depends on");
	});

	it("rejects non-existent dependency removal with actionable guidance", () => {
		// B does not depend on C, trying to remove C from B
		const q = queue([ws("A"), ws("B", ["A"])]);
		const patch = createRemoveDependencyPatch("B", "C", "Remove non-existent dep");
		const plan = createDependencyPatchPlan([patch], "P11");
		const result = validatePatchPlanWithGuidance(plan, q);

		expect(result.valid).toBe(false);
		const depError = result.errors.find(
			(e) => e.type === "dependency_not_found" && e.message.includes("does not depend on"),
		);
		expect(depError).toBeDefined();
		expect(depError!.actionableGuidance).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// AC3: Approved graph hash persisted, executor uses it
// ---------------------------------------------------------------------------

describe("P11.I AC3 — Approved graph hash persistence and verification", () => {
	it("computes deterministic graph hash", () => {
		const q1 = queue([ws("A"), ws("B", ["A"]), ws("C", ["B"])]);
		const q2 = queue([ws("A"), ws("B", ["A"]), ws("C", ["B"])]);

		const hash1 = computeGraphHash(q1);
		const hash2 = computeGraphHash(q2);

		expect(hash1).toBe(hash2);
		expect(hash1.length).toBe(64);
	});

	it("produces different hash for different graphs", () => {
		const q1 = queue([ws("A"), ws("B", ["A"])]);
		const q2 = queue([ws("A"), ws("B")]);

		const hash1 = computeGraphHash(q1);
		const hash2 = computeGraphHash(q2);

		expect(hash1).not.toBe(hash2);
	});

	it("persists approved graph hash in approval session", () => {
		// Use a graph that generates proposals
		const originalQueue = queue([
			ws("A"),
			ws("B", ["A"]),
			ws("C", ["A", "B"]), // A is transitive through B
			ws("D"),
		]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);
		for (const proposal of result.proposals) {
			session.approveProposal(proposal.id, "test-reviewer");
		}

		const metadata = session.commit();
		expect(metadata).toBeDefined();
		expect(metadata.batchAssignment).toBeDefined();
		expect(metadata.effectiveParallelism).toBeGreaterThanOrEqual(1);
		expect(metadata.approvedAt).toBeGreaterThan(0);
		expect(metadata.patchesApplied).toBeDefined();
	});

	it("graph hash persists through session", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"]), ws("D")]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);
		for (const proposal of result.proposals) {
			session.approveProposal(proposal.id);
		}
		session.commit();

		const hash = session.approvedGraphHash;
		expect(hash).toBeTruthy();
		expect(typeof hash).toBe("string");
		expect(hash!.length).toBe(64);

		expect(session.approvedPreviewMetadata).toBeTruthy();
	});

	it("verifyApprovedGraphHash accepts matching queue", () => {
		const q = queue([ws("A"), ws("B", ["A"])]);
		const hash = computeGraphHash(q);
		const result = verifyApprovedGraphHash(q, hash);

		expect(result.valid).toBe(true);
		expect(result.message).toContain("Safe to proceed");
	});

	it("verifyApprovedGraphHash rejects modified queue", () => {
		const originalQ = queue([ws("A"), ws("B", ["A"])]);
		const modifiedQ = queue([ws("A"), ws("B")]);

		const originalHash = computeGraphHash(originalQ);
		const result = verifyApprovedGraphHash(modifiedQ, originalHash);

		expect(result.valid).toBe(false);
		expect(result.message).toContain("HASH MISMATCH");
		expect(result.message).toContain("stale authored preview");
	});

	it("getApprovedQueue returns correctly patched queue after commit", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"]), ws("D")]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);
		for (const proposal of result.proposals) {
			session.approveProposal(proposal.id);
		}
		session.commit();

		const approvedQueue = session.getApprovedQueue();
		expect(approvedQueue.workspaces.length).toBe(originalQueue.workspaces.length);
	});
});

// ---------------------------------------------------------------------------
// AC4: Approval state transitions are audited
// ---------------------------------------------------------------------------

describe("P11.I AC4 — Approval state transitions are audited", () => {
	it("records audit entries for approve/reject/commit", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"]), ws("D")]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);
		expect(session.auditLog.length).toBe(1);
		expect(session.auditLog[0].action).toBe("submitted");

		// Approve all proposals
		for (const proposal of result.proposals) {
			session.approveProposal(proposal.id, "bot-reviewer");
		}

		// Commit
		session.commit();

		const commitEntries = session.auditLog.filter((e) => e.action === "committed");
		const hashEntries = session.auditLog.filter((e) => e.action === "hash_persisted");
		expect(commitEntries.length).toBe(1);
		expect(hashEntries.length).toBe(1);
	});

	it("records rejection in audit log", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"]), ws("D")]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);

		// Reject first proposal
		if (result.proposals.length > 0) {
			session.rejectProposal(result.proposals[0].id, "This optimization is not safe", "human-reviewer");
		}

		const rejectEntries = session.auditLog.filter((e) => e.action === "rejected");
		expect(rejectEntries.length).toBe(1);
		expect(rejectEntries[0].detail?.reason).toBe("This optimization is not safe");
		expect(rejectEntries[0].detail?.reviewer).toBe("human-reviewer");
	});

	it("records state transitions correctly", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"]), ws("D")]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);

		// Initial state: active (pending proposals)
		expect(session.state).toBe("active");

		// With 4 workspaces including a transitive dep, we should have some proposals
		expect(result.proposals.length).toBeGreaterThan(0);

		// Reject all proposals to get some_rejected state
		for (const proposal of result.proposals) {
			session.rejectProposal(proposal.id, "Not needed");
		}

		expect(session.state).toBe("some_rejected");

		// Commit (should work since no pending proposals)
		session.commit();
		expect(session.state).toBe("committed");
	});

	it("cannot modify after commit", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);
		for (const proposal of result.proposals) {
			session.approveProposal(proposal.id);
		}
		session.commit();

		expect(() => session.approveProposal("non-existent")).toThrow("already committed");
	});

	it("rejects commit with pending proposals", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);
		// Don't approve anything - keep proposals pending

		expect(() => session.commit()).toThrow("Cannot commit");
		expect(session.state).toBe("active");
	});

	it("exports audit to governance ledger", () => {
		const originalQueue = queue([ws("A"), ws("B", ["A"]), ws("C", ["A", "B"])]);
		const result = analyzeOptimizationOpportunities(originalQueue);

		const session = createPatchApprovalSession(originalQueue, result.proposals);
		for (const proposal of result.proposals) {
			session.approveProposal(proposal.id);
		}
		session.commit();

		const ledger = createGovernanceLedger();
		session.recordToGovernanceLedger(ledger, "plan-exec-123");

		const approvalEntries = ledger.entries.filter((e) => e.category === "approval");
		expect(approvalEntries.length).toBeGreaterThanOrEqual(session.auditLog.length);
	});
});
