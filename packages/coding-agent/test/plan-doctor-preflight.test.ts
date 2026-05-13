/**
 * Tests for Plan Doctor Preflight Gate - P2 Workstream 7.D
 *
 * Acceptance Criteria:
 * 1. preflightRequired blocks execution until review is approved
 * 2. Doctor reports effectiveParallelism, criticalPathLength, and serializedTailLength
 * 3. Doctor warns when effective parallelism is below requested parallelism
 * 4. Doctor fails dependency cycles and invalid workspace references
 */

import { describe, expect, it } from "vitest";
import { computeBatchPlan } from "../src/core/dag-analyzer.js";
import { SafetyDoctor, SafetyIssueType } from "../src/core/safety-doctor.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "7.A",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

function makeQueue(overrides: Partial<WorkspaceQueue> = {}): WorkspaceQueue {
	return {
		phase: "P2",
		title: "Test Plan",
		maxParallelWorkspaces: 3,
		workspaces: [makeWorkspace()],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC1: preflightRequired blocks execution until review is approved
// ---------------------------------------------------------------------------

describe("AC1: preflightRequired blocks execution until review is approved", () => {
	it("should mark workspace with preflightRequired as a critical safety issue", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A", preflightRequired: true })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.safe).toBe(false);
		const preflightIssue = report.critical.find((i) => i.type === SafetyIssueType.PreflightRequired);
		expect(preflightIssue).toBeDefined();
		expect(preflightIssue!.workspaceId).toBe("7.A");
		expect(preflightIssue!.message).toContain("preflight review approval");
	});

	it("should produce critical issues for multiple preflightRequired workspaces", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A", preflightRequired: true }),
				makeWorkspace({ id: "7.B", preflightRequired: true }),
				makeWorkspace({ id: "7.C" }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		const preflightIssues = report.critical.filter((i) => i.type === SafetyIssueType.PreflightRequired);
		expect(preflightIssues).toHaveLength(2);
		expect(preflightIssues.map((i) => i.workspaceId)).toEqual(expect.arrayContaining(["7.A", "7.B"]));
	});

	it("should NOT produce preflightRequired issue for workspaces where preflightRequired is false", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A", preflightRequired: false })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		const preflightIssue = report.critical.find((i) => i.type === SafetyIssueType.PreflightRequired);
		expect(preflightIssue).toBeUndefined();
	});

	it("should NOT produce preflightRequired issue for workspaces without the field", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		const preflightIssue = report.critical.find((i) => i.type === SafetyIssueType.PreflightRequired);
		expect(preflightIssue).toBeUndefined();
	});

	it("should block execution (report safe=false) when preflightRequired is present", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A", preflightRequired: true })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		// The plan should NOT be safe to execute until preflight review is approved
		expect(report.safe).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// AC2: Doctor reports effectiveParallelism, criticalPathLength, and serializedTailLength
// ---------------------------------------------------------------------------

describe("AC2: Doctor reports effectiveParallelism, criticalPathLength, and serializedTailLength", () => {
	it("should report parallelism diagnostics in the safety report", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.parallelism).toBeDefined();
		expect(report.parallelism!.effectiveParallelism).toBe(1);
		expect(report.parallelism!.criticalPathLength).toBe(1);
		expect(report.parallelism!.serializedTailLength).toBe(1);
		expect(report.parallelism!.requestedParallelism).toBe(3);
	});

	it("should report effectiveParallelism = 3 for three independent workspaces", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" }), makeWorkspace({ id: "7.B" }), makeWorkspace({ id: "7.C" })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.parallelism).toBeDefined();
		expect(report.parallelism!.effectiveParallelism).toBe(3);
		expect(report.parallelism!.criticalPathLength).toBe(1);
		expect(report.parallelism!.serializedTailLength).toBe(0); // width is 3, not 1
	});

	it("should report criticalPathLength = 3 for A -> B -> C chain", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.B"] }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.parallelism).toBeDefined();
		expect(report.parallelism!.criticalPathLength).toBe(3);
		expect(report.parallelism!.effectiveParallelism).toBe(1);
		expect(report.parallelism!.serializedTailLength).toBe(3); // all batches are single-width
	});

	it("should report serializedTailLength for diamond with serialized tail", () => {
		// A -> B -> D, A -> C -> D
		// Batch 1: A (1), Batch 2: B, C (2), Batch 3: D (1)
		// Tail has 1 single-width batch at end
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.D", dependencies: ["7.B", "7.C"] }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.parallelism).toBeDefined();
		expect(report.parallelism!.effectiveParallelism).toBe(2);
		expect(report.parallelism!.criticalPathLength).toBe(3);
		expect(report.parallelism!.serializedTailLength).toBe(1); // last batch is single-width D
	});

	it("should report serializedTailLength = 0 for fully parallel plan", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" }), makeWorkspace({ id: "7.B" }), makeWorkspace({ id: "7.C" })],
			maxParallelWorkspaces: 3,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.parallelism).toBeDefined();
		expect(report.parallelism!.serializedTailLength).toBe(0);
	});

	it("should report serializedTailLength for chain with parallel start", () => {
		// A, B -> C -> D -> E
		// Batch 1: A, B (width 2), Batch 2: C (1), Batch 3: D (1), Batch 4: E (1)
		// Tail: 3 (C, D, E)
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B" }),
				makeWorkspace({ id: "7.C", dependencies: ["7.B"] }),
				makeWorkspace({ id: "7.D", dependencies: ["7.C"] }),
				makeWorkspace({ id: "7.E", dependencies: ["7.D"] }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.parallelism).toBeDefined();
		expect(report.parallelism!.effectiveParallelism).toBe(2);
		expect(report.parallelism!.serializedTailLength).toBe(3);
	});

	it("should include parallelism diagnostics in formatted report", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" }), makeWorkspace({ id: "7.B", dependencies: ["7.A"] })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);
		const formatted = doctor.formatReport(report);

		expect(formatted).toContain("PARALLELISM DIAGNOSTICS");
		expect(formatted).toContain("Effective parallelism");
		expect(formatted).toContain("Critical path length");
		expect(formatted).toContain("Serialized tail length");
	});

	it("should NOT include parallelism section when parallelism is not computed", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" })],
		});

		const doctor = new SafetyDoctor();
		// validateQueue (without parallelism) should not produce parallelism diagnostics
		const report = doctor.validateQueue(queue);

		expect(report.parallelism).toBeUndefined();
		const formatted = doctor.formatReport(report);
		expect(formatted).not.toContain("PARALLELISM DIAGNOSTICS");
	});
});

// ---------------------------------------------------------------------------
// AC3: Doctor warns when effective parallelism is below requested parallelism
// ---------------------------------------------------------------------------

describe("AC3: Doctor warns when effective parallelism is below requested parallelism", () => {
	it("should warn when effective parallelism is below requested", () => {
		// 3 workspaces fully serialized with maxParallel = 5
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.B"] }),
			],
			maxParallelWorkspaces: 5,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		const parallelismWarning = report.warnings.find((i) => i.type === SafetyIssueType.LowEffectiveParallelism);
		expect(parallelismWarning).toBeDefined();
		expect(parallelismWarning!.message).toContain("Effective parallelism");
		expect(parallelismWarning!.message).toContain("below requested");
		expect(parallelismWarning!.context).toBeDefined();
		expect((parallelismWarning!.context as Record<string, unknown>).effectiveParallelism).toBe(1);
		expect((parallelismWarning!.context as Record<string, unknown>).requestedParallelism).toBe(5);
	});

	it("should not warn when effective parallelism equals requested", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" }), makeWorkspace({ id: "7.B" }), makeWorkspace({ id: "7.C" })],
			maxParallelWorkspaces: 3,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		const parallelismWarning = report.warnings.find((i) => i.type === SafetyIssueType.LowEffectiveParallelism);
		expect(parallelismWarning).toBeUndefined();
	});

	it("should not warn when effective parallelism exceeds requested", () => {
		// 5 independent workspaces but only maxParallel = 3
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B" }),
				makeWorkspace({ id: "7.C" }),
				makeWorkspace({ id: "7.D" }),
				makeWorkspace({ id: "7.E" }),
			],
			maxParallelWorkspaces: 3,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		// effective = 5 > requested = 3, so no warning about being below
		const parallelismWarning = report.warnings.find((i) => i.type === SafetyIssueType.LowEffectiveParallelism);
		expect(parallelismWarning).toBeUndefined();
	});

	it("should warn when diamond graph has effective < requested", () => {
		// effective = 2, requested = 5
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.D", dependencies: ["7.B", "7.C"] }),
			],
			maxParallelWorkspaces: 5,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		const parallelismWarning = report.warnings.find((i) => i.type === SafetyIssueType.LowEffectiveParallelism);
		expect(parallelismWarning).toBeDefined();
		expect((parallelismWarning!.context as Record<string, unknown>).effectiveParallelism).toBe(2);
		expect((parallelismWarning!.context as Record<string, unknown>).requestedParallelism).toBe(5);
	});

	it("should report parallelismDelta in context", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" }), makeWorkspace({ id: "7.B", dependencies: ["7.A"] })],
			maxParallelWorkspaces: 5,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		const parallelismWarning = report.warnings.find((i) => i.type === SafetyIssueType.LowEffectiveParallelism);
		expect(parallelismWarning).toBeDefined();
		expect((parallelismWarning!.context as Record<string, unknown>).parallelismDelta).toBe(4); // 5 - 1
	});
});

// ---------------------------------------------------------------------------
// AC4: Doctor fails dependency cycles and invalid workspace references
// ---------------------------------------------------------------------------

describe("AC4: Doctor fails dependency cycles and invalid workspace references", () => {
	it("should fail dependency cycles with critical issue", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A", dependencies: ["7.B"] }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.safe).toBe(false);
		const cycleIssue = report.critical.find((i) => i.type === SafetyIssueType.DependencyCycle);
		expect(cycleIssue).toBeDefined();
		expect(cycleIssue!.message).toContain("cycle");
	});

	it("should fail three-way dependency cycle", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A", dependencies: ["7.B"] }),
				makeWorkspace({ id: "7.B", dependencies: ["7.C"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.A"] }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.safe).toBe(false);
		const cycleIssue = report.critical.find((i) => i.type === SafetyIssueType.DependencyCycle);
		expect(cycleIssue).toBeDefined();
	});

	it("should fail invalid workspace references", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A", dependencies: ["7.Z"] })],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.safe).toBe(false);
		const invalidRefIssue = report.critical.find((i) => i.type === SafetyIssueType.InvalidConfig);
		expect(invalidRefIssue).toBeDefined();
		expect(invalidRefIssue!.message).toContain("7.Z");
	});

	it("should fail both cycles and invalid references simultaneously", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A", dependencies: ["7.B"] }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.MISSING"] }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.safe).toBe(false);
		const cycleIssue = report.critical.find((i) => i.type === SafetyIssueType.DependencyCycle);
		expect(cycleIssue).toBeDefined();

		const invalidRefIssue = report.critical.find(
			(i) => i.type === SafetyIssueType.InvalidConfig && i.message.includes("MISSING"),
		);
		expect(invalidRefIssue).toBeDefined();
	});

	it("should not produce parallelism diagnostics when cycle is present", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A", dependencies: ["7.B"] }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
			],
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		// Parallelism can't be computed when there's a cycle
		expect(report.parallelism).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// DAG Analyzer: criticalPathLength and serializedTailLength
// ---------------------------------------------------------------------------

describe("computeBatchPlan: criticalPathLength and serializedTailLength", () => {
	it("reports criticalPathLength = totalBatches", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.B"] }),
			],
		});

		const result = computeBatchPlan(queue);
		expect(result.criticalPathLength).toBe(result.totalBatches);
		expect(result.criticalPathLength).toBe(3);
	});

	it("reports serializedTailLength for fully serialized chain", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.B"] }),
			],
		});

		const result = computeBatchPlan(queue);
		expect(result.serializedTailLength).toBe(3);
	});

	it("reports serializedTailLength = 0 for fully parallel plan", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" }), makeWorkspace({ id: "7.B" }), makeWorkspace({ id: "7.C" })],
		});

		const result = computeBatchPlan(queue);
		expect(result.serializedTailLength).toBe(0);
	});

	it("reports serializedTailLength = 1 for diamond with single sink", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.C", dependencies: ["7.A"] }),
				makeWorkspace({ id: "7.D", dependencies: ["7.B", "7.C"] }),
			],
		});

		const result = computeBatchPlan(queue);
		expect(result.serializedTailLength).toBe(1);
	});

	it("reports serializedTailLength for mixed shape: wide start, serialized tail", () => {
		// Batch 1: A, B (width 2)
		// Batch 2: C (width 1, depends on B)
		// Batch 3: D (width 1, depends on C)
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A" }),
				makeWorkspace({ id: "7.B" }),
				makeWorkspace({ id: "7.C", dependencies: ["7.B"] }),
				makeWorkspace({ id: "7.D", dependencies: ["7.C"] }),
			],
		});

		const result = computeBatchPlan(queue);
		expect(result.serializedTailLength).toBe(2); // C and D are single-width at the end
	});

	it("reports criticalPathLength = 0 and serializedTailLength = 0 for empty queue", () => {
		const queue = makeQueue({ workspaces: [] });
		const result = computeBatchPlan(queue);
		expect(result.criticalPathLength).toBe(0);
		expect(result.serializedTailLength).toBe(0);
	});

	it("reports criticalPathLength = 0 and serializedTailLength = 0 for cycle", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A", dependencies: ["7.B"] }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
			],
		});

		const result = computeBatchPlan(queue);
		expect(result.criticalPathLength).toBe(0);
		expect(result.serializedTailLength).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Integration: validateQueueWithParallelism comprehensive scenarios
// ---------------------------------------------------------------------------

describe("validateQueueWithParallelism: comprehensive scenarios", () => {
	it("should produce a safe report for a clean plan with no parallelism warning", () => {
		const queue = makeQueue({
			workspaces: [makeWorkspace({ id: "7.A" }), makeWorkspace({ id: "7.B" }), makeWorkspace({ id: "7.C" })],
			maxParallelWorkspaces: 3,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		expect(report.safe).toBe(true);
		expect(report.parallelism).toBeDefined();
		expect(report.parallelism!.effectiveParallelism).toBe(3);
		expect(report.parallelism!.requestedParallelism).toBe(3);
		expect(report.parallelism!.parallelismDelta).toBe(0);
	});

	it("should combine preflight and parallelism warnings", () => {
		const queue = makeQueue({
			workspaces: [
				makeWorkspace({ id: "7.A", preflightRequired: true }),
				makeWorkspace({ id: "7.B", dependencies: ["7.A"] }),
			],
			maxParallelWorkspaces: 5,
		});

		const doctor = new SafetyDoctor();
		const report = doctor.validateQueueWithParallelism(queue);

		// preflightRequired => unsafe
		expect(report.safe).toBe(false);
		const preflightIssue = report.critical.find((i) => i.type === SafetyIssueType.PreflightRequired);
		expect(preflightIssue).toBeDefined();

		// parallelism warning: effective < requested
		const parallelismWarning = report.warnings.find((i) => i.type === SafetyIssueType.LowEffectiveParallelism);
		expect(parallelismWarning).toBeDefined();
	});
});
