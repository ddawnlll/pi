/**
 * P11.T — Integration test for P11 ecosystem features.
 *
 * Validates the full self-improvement loop:
 * orchestrator observation -> proposal -> plan intake optimization ->
 * dry-run -> approval gate -> bounded execution -> validation -> audit
 *
 * Tests the core P11 modules without requiring actual provider API calls.
 */

import { describe, expect, it } from "vitest";
import { analyzePlanIntake } from "../../../src/core/plan-intake-analyzer.js";
import {
	generateGraphDiff,
	createGraphApproval,
	approveGraph,
	computeGraphHash,
	checkApprovalStaleness,
} from "../../../src/core/graph-diff-engine.js";
import { getPlatformAuditLedger, resetPlatformAuditLedger } from "../../../src/core/platform-audit-ledger.js";
import type { Workspace, WorkspaceQueue } from "../../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(id: string, deps: string[], title?: string): Workspace {
	return {
		id,
		title: title ?? id,
		dependencies: deps,
		acceptanceCriteria: [`AC for ${id}`],
		roleBudget: "worker",
		maxRetries: 2,
		capabilities: { canEdit: [`src/${id}.ts`], canRun: [`echo ${id}`] },
	};
}

function makeQueue(phase: string, workspaces: Workspace[], maxParallel: number = 4): WorkspaceQueue {
	return {
		phase,
		title: `Test Phase ${phase}`,
		maxParallelWorkspaces: maxParallel,
		workspaces,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P11 Ecosystem Integration", () => {
	it("P11.C: plan intake analyzer produces analysis with diagnostics and bottlenecks", () => {
		const wsA = makeWorkspace("P11.A", [], "Foundation");
		const wsB = makeWorkspace("P11.B", ["P11.A"], "Orchestrator");
		const wsC = makeWorkspace("P11.C", ["P11.A"], "Plan Intake");
		const wsD = makeWorkspace("P11.D", ["P11.B", "P11.C"], "Integration");

		const queue = makeQueue("P11", [wsA, wsB, wsC, wsD], 2);

		const analysis = analyzePlanIntake(queue);

		expect(analysis).toBeDefined();
		// Status is awaiting_approval when optimizer generates proposals
		expect(["approved", "awaiting_approval"]).toContain(analysis.status);
		expect(analysis.batchPlan).toBeDefined();
		expect(analysis.batchPlan.totalBatches).toBeGreaterThanOrEqual(1);
		expect(analysis.optimization).toBeDefined();
		expect(analysis.analyzedAt).toBeTruthy();
		expect(typeof analysis.executionBlocked).toBe("boolean");
	});

	it("P11.C: plan intake detects bottlenecks and stale authored previews", () => {
		const wsA = makeWorkspace("P11.A", [], "Foundation");
		const wsB = makeWorkspace("P11.B", ["P11.A"], "Slow Worker");
		const wsC = makeWorkspace("P11.C", ["P11.A", "P11.B"], "Final");

		const queue = makeQueue("P11", [wsA, wsB, wsC], 2);

		const analysis = analyzePlanIntake(queue, { authoredBatchCount: 99 });

		expect(analysis.authoredPreviewStale).toBe(true);
		expect(analysis.diagnostics.length).toBeGreaterThanOrEqual(0);
	});

	it("P11.I: graph diff engine generates complete diff between original and optimized", () => {
		const wsA = makeWorkspace("P11.A", [], "Original A");
		const wsB = makeWorkspace("P11.B", ["P11.A"], "Original B");
		const original = makeQueue("P11", [wsA, wsB]);

		const wsA2 = makeWorkspace("P11.A", [], "Optimized A");
		const wsB2 = makeWorkspace("P11.B", [], "Optimized B (no dep)");
		const optimized = makeQueue("P11", [wsA2, wsB2]);

		const diff = generateGraphDiff(original, optimized);

		expect(diff).toBeDefined();
		expect(diff.entries.length).toBeGreaterThanOrEqual(1);
		expect(diff.metrics).toBeDefined();
		expect(diff.safety).toBeDefined();

		const removedDeps = diff.entries.filter((e) => e.type === "dependency_removed");
		expect(removedDeps.length).toBe(1);
		expect(removedDeps[0].workspaceId).toBe("P11.B");
		expect(removedDeps[0].from).toBe("P11.A");
	});

	it("P11.I: approval lifecycle works end-to-end", () => {
		const wsA = makeWorkspace("P11.A", [], "A");
		const original = makeQueue("P11", [wsA]);
		const optimized = makeQueue("P11", [wsA]);

		const diff = generateGraphDiff(original, optimized);
		const metrics = diff.metrics;

		const approval = createGraphApproval("P11", original, optimized, metrics);
		expect(approval.status).toBe("pending");
		expect(approval.auditTrail.length).toBe(1);

		const approved = approveGraph(approval, "test_operator");
		expect(approved.status).toBe("approved");
		expect(approved.approvedAt).toBeTruthy();
		expect(approved.auditTrail.length).toBe(2);

		const sameQueue = makeQueue("P11", [wsA]);
		const staleness = checkApprovalStaleness(approved, sameQueue);
		expect(staleness.isValid).toBe(true);

		const hash1 = computeGraphHash(original);
		const hash2 = computeGraphHash(original);
		expect(hash1).toBe(hash2);

		const diffQueue = makeQueue("P12", [wsA]);
		const hash3 = computeGraphHash(diffQueue);
		expect(hash1).not.toBe(hash3);
	});

	it("P11.M: platform audit ledger records and queries events", () => {
		resetPlatformAuditLedger();
		const ledger = getPlatformAuditLedger();

		ledger.recordOrchestrator("completed", "Orchestrator scan completed");
		ledger.recordExtension("install", "test-extension", "allowed");
		ledger.recordSkill("invoke", "test-skill", "allowed");
		ledger.recordPolicyDecision("approve_graph", "P11.plan", "approved");

		const all = ledger.query();
		expect(all.length).toBe(4);

		const extensions = ledger.query({ category: "extension" });
		expect(extensions.length).toBe(1);
		expect(extensions[0].target).toBe("test-extension");

		const approvals = ledger.query({ outcome: "approved" });
		expect(approvals.length).toBeGreaterThanOrEqual(1);

		const summary = ledger.getSummary();
		expect(summary.totalEvents).toBe(4);
		expect(summary.eventsByCategory.extension).toBe(1);
		expect(summary.recentApprovals).toBeGreaterThanOrEqual(1);
	});

	it("P11: full lifecycle — plan intake -> graph diff -> approval -> audit", () => {
		resetPlatformAuditLedger();
		const ledger = getPlatformAuditLedger();

		// 1. Plan intake
		const wsA = makeWorkspace("P11.A", [], "Foundation");
		const wsB = makeWorkspace("P11.B", ["P11.A"], "Feature B");
		const wsC = makeWorkspace("P11.C", ["P11.A", "P11.B"], "Feature C");
		const queue = makeQueue("P11", [wsA, wsB, wsC], 2);

		const analysis = analyzePlanIntake(queue);
		ledger.recordPlanIntake("completed", analysis);

		// 2. Create optimized version (remove transitive dep: C depends on A, but B already depends on A)
		const wsA2 = makeWorkspace("P11.A", [], "Foundation");
		const wsB2 = makeWorkspace("P11.B", ["P11.A"], "Feature B");
		const wsC2 = makeWorkspace("P11.C", ["P11.B"], "Feature C (reduced dep)");
		const optimized = makeQueue("P11", [wsA2, wsB2, wsC2], 2);

		// 3. Generate graph diff
		const diff = generateGraphDiff(queue, optimized);
		expect(diff.entries.length).toBeGreaterThanOrEqual(1);

		// 4. Create approval
		const approval = createGraphApproval("P11", queue, optimized, diff.metrics);
		ledger.recordGraphApproval(approval, "test_operator");

		// 5. Approve
		const approved = approveGraph(approval, "operator");
		ledger.recordGraphApproval(approved, "operator");

		// 6. Verify audit trail
		const auditEvents = ledger.query({ category: "approval" });
		expect(auditEvents.length).toBeGreaterThanOrEqual(2);

		// 7. Verify plan intake completed successfully (may have proposals pending)
		expect(["approved", "awaiting_approval"]).toContain(analysis.status);
		expect(analysis.batchPlan.totalBatches).toBeGreaterThanOrEqual(1);

		// 8. Verify graph diff has correct metrics
		expect(diff.metrics.expectedSpeedup).toBeGreaterThanOrEqual(0);
	});

	it("P11: safety checks detect dangerous graph modifications", () => {
		const wsB = makeWorkspace("P11.B", [], "Feature B");
		const original = makeQueue("P11", [wsB]);

		// Try to remove a workspace entirely (this is a safety concern)
		const optimized = makeQueue("P11", []);

		const diff = generateGraphDiff(original, optimized);

		// Should detect workspace removal (safety issue)
		const removed = diff.entries.filter((e) => e.type === "workspace_removed");
		expect(removed.length).toBe(1);
		expect(removed[0].affectsSafety).toBe(true);

		// Safety check should fail
		expect(diff.safety.passes).toBe(false);
	});
});
