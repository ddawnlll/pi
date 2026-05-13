/**
 * E2E Tests and Regression Plans - P2 Workstream 7.K
 *
 * Acceptance Criteria:
 * 1. E2E covers fully serialized plan warning
 * 2. E2E covers editing dependencies into 3-wide batches
 * 3. E2E covers rejected cycle edit
 * 4. Regression covers v2.1.0 plan without interactive review
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { computeBatchPlan, computeBlockDetails } from "../src/core/dag-analyzer.js";
import { parsePlan } from "../src/core/plan-parser.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";
import { ACCEPTED_SCHEMA_VERSIONS, detectCycles, validateWorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a workspace queue from workspaces for testing. */
function makeQueue(workspaces: Workspace[], maxParallel: number = 3): WorkspaceQueue {
	return {
		phase: "P2-TEST",
		title: "E2E Test",
		maxParallelWorkspaces: maxParallel,
		workspaces,
	};
}

/** Build a plan markdown string with an embedded JSON Part 3 queue. */
function buildPlanMarkdown(queueObj: Record<string, unknown>): string {
	const queueJson = JSON.stringify(queueObj, null, 2);
	const NL = String.fromCharCode(10);
	const lines: string[] = [
		"# Phase P2-TEST - E2E Plan Test",
		"",
		"**Author:** Test Suite",
		"**Created:** 2026-05-13",
		"**Goal:** E2E testing for batch planning",
		"",
		"---",
		"",
		"# Part 1 - Phase Plan",
		"",
		"## 0. TL;DR",
		"",
		"E2E test plan for workspace 7.K acceptance criteria.",
		"",
		"## 1. Header",
		"",
		"| Field | Value |",
		"|---|---|",
		`| Phase | ${queueObj.phase ?? "P2-TEST"} |`,
		`| Title | ${queueObj.title ?? "E2E Test"} |`,
		"| Status | Testing |",
		"",
		"---",
		"",
		"# Part 3 - Workspace Queue",
		"",
		"```json",
		queueJson,
		"```",
	];
	return lines.join(NL);
}

// ---------------------------------------------------------------------------
// E2E: Fully Serialized Plan Warning
// ---------------------------------------------------------------------------

describe("E2E: Fully serialized plan warning", () => {
	test("detects over-serialization when maxParallel>1 but dependency chain forces serial execution", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "First", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Second", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Third", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
			{ id: "D", title: "Fourth", dependencies: ["C"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(workspaces, 3);
		const result = computeBatchPlan(queue);

		expect(result.isOverSerialized).toBe(true);
		expect(result.effectiveParallelism).toBe(1);
		expect(result.requestedParallelism).toBe(3);
		expect(result.parallelismDelta).toBe(2);

		for (const batch of result.batches) {
			expect(batch.width).toBe(1);
		}
		expect(result.totalBatches).toBe(4);

		const overSerializedWarnings = result.warnings.filter((w) => w.type === "over_serialized");
		expect(overSerializedWarnings.length).toBeGreaterThanOrEqual(1);
		expect(overSerializedWarnings[0].message).toContain("fully serialized");
	});

	test("does not flag over-serialization when parallelism is achieved", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "First", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Second", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Third", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "D", title: "Fourth", dependencies: ["A", "B", "C"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(workspaces, 3);
		const result = computeBatchPlan(queue);

		expect(result.isOverSerialized).toBe(false);
		expect(result.effectiveParallelism).toBe(3);
		expect(result.batches[0].width).toBe(3);
	});

	test("does not flag as over-serialized when maxParallel is 1 (explicit serial request)", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "First", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Second", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(workspaces, 1);
		const result = computeBatchPlan(queue);

		expect(result.isOverSerialized).toBe(false);
	});

	test("over-serialized plan detected through parsePlan and dry-run path", () => {
		const queueObj = {
			phase: "P2-SERIALIZED",
			title: "Serialized Plan Test",
			maxParallelWorkspaces: 3,
			workspaces: [
				{ id: "S.A", title: "Step A", dependencies: [] as string[], roleBudget: "worker" as const, maxRetries: 3 },
				{ id: "S.B", title: "Step B", dependencies: ["S.A"], roleBudget: "worker" as const, maxRetries: 3 },
				{ id: "S.C", title: "Step C", dependencies: ["S.B"], roleBudget: "worker" as const, maxRetries: 3 },
			],
		};
		const serializedPlan = buildPlanMarkdown(queueObj);
		const result = parsePlan(serializedPlan, { validate: true });
		expect(result.success).toBe(true);
		expect(result.queue).toBeDefined();

		if (result.queue) {
			const batchResult = computeBatchPlan(result.queue);
			expect(batchResult.isOverSerialized).toBe(true);
			expect(batchResult.effectiveParallelism).toBe(1);
		}
	});
});

// ---------------------------------------------------------------------------
// E2E: Editing Dependencies Into 3-Wide Batches
// ---------------------------------------------------------------------------

describe("E2E: Editing dependencies into 3-wide batches", () => {
	test("removing unnecessary dependencies widens batch to 3-wide", () => {
		// Initially: A -> B -> C -> D (serial, all in separate batches)
		const originalWorkspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
			{ id: "D", title: "Workspace D", dependencies: ["C"], roleBudget: "worker", maxRetries: 3 },
		];
		const originalQueue = makeQueue(originalWorkspaces, 3);
		const originalResult = computeBatchPlan(originalQueue);

		expect(originalResult.isOverSerialized).toBe(true);
		expect(originalResult.effectiveParallelism).toBe(1);

		// After edit: B no longer depends on A, C no longer depends on B, D depends on all three
		const editedWorkspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "D", title: "Workspace D", dependencies: ["A", "B", "C"], roleBudget: "worker", maxRetries: 3 },
		];
		const editedQueue = makeQueue(editedWorkspaces, 3);
		const editedResult = computeBatchPlan(editedQueue);

		expect(editedResult.isOverSerialized).toBe(false);
		expect(editedResult.batches).toHaveLength(2);
		expect(editedResult.batches[0].width).toBe(3);
		expect(editedResult.batches[0].workspaceIds).toContain("A");
		expect(editedResult.batches[0].workspaceIds).toContain("B");
		expect(editedResult.batches[0].workspaceIds).toContain("C");
		expect(editedResult.batches[1].width).toBe(1);
		expect(editedResult.batches[1].workspaceIds).toContain("D");
		expect(editedResult.effectiveParallelism).toBe(3);
	});

	test("partial dependency edit produces 3-wide mid-plan batch", () => {
		const editedWorkspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "D", title: "Workspace D", dependencies: ["A", "B", "C"], roleBudget: "worker", maxRetries: 3 },
			{ id: "E", title: "Workspace E", dependencies: ["D"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(editedWorkspaces, 3);
		const result = computeBatchPlan(queue);

		expect(result.batches).toHaveLength(3);
		expect(result.batches[0].width).toBe(3);
		expect(result.effectiveParallelism).toBe(3);
	});

	test("block details reflect the widened batches after dependency edit", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "D", title: "Workspace D", dependencies: ["A", "B", "C"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(workspaces, 3);
		const details = computeBlockDetails(queue);

		const unblocked = details.filter((d) => !d.isBlocked);
		expect(unblocked).toHaveLength(3);
		expect(unblocked.map((d) => d.workspaceId).sort()).toEqual(["A", "B", "C"]);

		const blocked = details.filter((d) => d.isBlocked);
		expect(blocked).toHaveLength(1);
		expect(blocked[0].workspaceId).toBe("D");
		expect(blocked[0].criticalPathDependencies.sort()).toEqual(["A", "B", "C"].sort());
	});

	test("validation still passes after dependency edit", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "D", title: "Workspace D", dependencies: ["A", "B", "C"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(workspaces, 3);
		const validation = validateWorkspaceQueue(queue);
		expect(validation.valid).toBe(true);
		expect(validation.errors).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// E2E: Rejected Cycle Edit
// ---------------------------------------------------------------------------

describe("E2E: Rejected cycle edit", () => {
	test("direct cycle A -> B -> A is detected and rejected", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(workspaces, 3);

		const cycleResult = detectCycles(workspaces);
		expect(cycleResult.hasCycle).toBe(true);
		expect(cycleResult.cycle).toBeDefined();
		expect(cycleResult.cycle!.length).toBeGreaterThan(0);

		const validation = validateWorkspaceQueue(queue);
		expect(validation.valid).toBe(false);
		const cycleErrors = validation.errors.filter((e) => e.type === "cycle");
		expect(cycleErrors.length).toBeGreaterThanOrEqual(1);
		expect(cycleErrors[0].message).toContain("cycle");
	});

	test("transitive cycle A -> B -> C -> A is detected", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: ["C"], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
		];
		const cycleResult = detectCycles(workspaces);
		expect(cycleResult.hasCycle).toBe(true);
		expect(cycleResult.cycle).toBeDefined();
	});

	test("computeBatchPlan reports cycle error instead of producing batches", () => {
		const workspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
		];
		const queue = makeQueue(workspaces, 3);
		const result = computeBatchPlan(queue);

		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].type).toBe("cycle");
		expect(result.batches).toHaveLength(0);
		expect(result.totalBatches).toBe(0);
		expect(result.effectiveParallelism).toBe(0);
	});

	test("attempting to add a dependency that creates a cycle is rejected by validation", () => {
		// Start with valid: A -> B -> C
		const validWorkspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
		];
		const validResult = validateWorkspaceQueue(makeQueue(validWorkspaces, 3));
		expect(validResult.valid).toBe(true);

		// Edit: Add A depends on C, creating A -> B -> C -> A cycle
		const cycledWorkspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: ["C"], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
		];
		const cycledResult = validateWorkspaceQueue(makeQueue(cycledWorkspaces, 3));
		expect(cycledResult.valid).toBe(false);
		const cycleErrors = cycledResult.errors.filter((e) => e.type === "cycle");
		expect(cycleErrors.length).toBeGreaterThan(0);
	});

	test("parsePlan rejects a plan with cycles in the JSON queue", () => {
		const queueObj = {
			phase: "P2-CYCLE",
			title: "Cycle Test",
			maxParallelWorkspaces: 3,
			workspaces: [
				{ id: "X", title: "X", dependencies: ["Y"], roleBudget: "worker", maxRetries: 3 },
				{ id: "Y", title: "Y", dependencies: ["X"], roleBudget: "worker", maxRetries: 3 },
			],
		};
		const planWithCycle = buildPlanMarkdown(queueObj);
		const result = parsePlan(planWithCycle, { validate: true });
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("cycle") || e.includes("Cycle"))).toBe(true);
	});

	test("acyclic plan passes validation after removing the cycle-causing edge", () => {
		const fixedWorkspaces: Workspace[] = [
			{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			{ id: "C", title: "Workspace C", dependencies: ["B"], roleBudget: "worker", maxRetries: 3 },
		];
		const result = validateWorkspaceQueue(makeQueue(fixedWorkspaces, 3));
		expect(result.valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Regression: v2.1.0 Plan Without Interactive Review
// ---------------------------------------------------------------------------

describe("Regression: v2.1.0 plan without interactive review", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "v210-regression-"));
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch (_error) {
			// Ignore cleanup errors
		}
	});

	test("v2.1.0 plan parses successfully without interactiveParallelismReview", () => {
		const queueObj = {
			contractVersion: "2.1.0",
			phase: "P2-V210",
			title: "v2.1.0 Plan Without Interactive Review",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "A",
					title: "Workspace A",
					dependencies: [] as string[],
					roleBudget: "worker" as const,
					maxRetries: 3,
				},
				{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
				{ id: "C", title: "Workspace C", dependencies: ["A"], roleBudget: "worker" as const, maxRetries: 3 },
			],
		};
		const v210Plan = buildPlanMarkdown(queueObj);
		const result = parsePlan(v210Plan, { validate: true });
		expect(result.success).toBe(true);
		expect(result.queue).toBeDefined();
		expect(result.queue!.contractVersion).toBe("2.1.0");
		expect(result.queue!.planExecution).toBeUndefined();
		expect(result.queue!.parallelismReview).toBeUndefined();
	});

	test("v2.1.0 contract version is accepted", () => {
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.1.0")).toBe(true);
	});

	test("v2.1.0 plan runs batch computation without requiring interactive review", () => {
		const queue: WorkspaceQueue = {
			contractVersion: "2.1.0",
			phase: "P2-V210",
			title: "v2.1.0 Plan Without Interactive Review",
			maxParallelWorkspaces: 3,
			workspaces: [
				{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "B", title: "Workspace B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
				{ id: "C", title: "Workspace C", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			],
		};

		const validation = validateWorkspaceQueue(queue);
		expect(validation.valid).toBe(true);

		const batchResult = computeBatchPlan(queue);
		expect(batchResult.errors).toHaveLength(0);
		expect(batchResult.batches).toHaveLength(2);
		expect(batchResult.batches[0].width).toBe(1);
		expect(batchResult.batches[1].width).toBe(2);

		expect(queue.planExecution?.interactiveParallelismReview).toBeUndefined();
		expect(queue.parallelismReview).toBeUndefined();
	});

	test("v2.1.0 plan with parallelGroup-free workspaces computes batches correctly", () => {
		const queue: WorkspaceQueue = {
			contractVersion: "2.1.0",
			phase: "P2-V210",
			title: "v2.1.0 With Parallel Workspaces",
			maxParallelWorkspaces: 3,
			workspaces: [
				{ id: "A", title: "Root A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "B", title: "Root B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "C", title: "Root C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{
					id: "D",
					title: "Depends on all roots",
					dependencies: ["A", "B", "C"],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const batchResult = computeBatchPlan(queue);
		expect(batchResult.errors).toHaveLength(0);
		expect(batchResult.batches).toHaveLength(2);
		expect(batchResult.batches[0].width).toBe(3);
		expect(batchResult.effectiveParallelism).toBe(3);

		expect(queue.planExecution?.interactiveParallelismReview).toBeUndefined();
		expect(queue.parallelismReview).toBeUndefined();
	});

	test("v2.1.0 plan is not rejected for lacking parallelismReview field", () => {
		const queue: WorkspaceQueue = {
			contractVersion: "2.1.0",
			phase: "P2-V210",
			title: "v2.1.0 Plan Without Review Config",
			maxParallelWorkspaces: 3,
			workspaces: [{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
		};

		const validation = validateWorkspaceQueue(queue);
		expect(validation.valid).toBe(true);
		const reviewErrors = validation.errors.filter(
			(e) => e.message.includes("parallelismReview") || e.message.includes("interactiveParallelismReview"),
		);
		expect(reviewErrors).toHaveLength(0);
	});

	test("contrast: v2.2.0 plan can opt into interactive parallelism review", () => {
		const v220WithReview: WorkspaceQueue = {
			contractVersion: "2.2.0",
			phase: "P2-V220",
			title: "v2.2.0 With Interactive Review",
			maxParallelWorkspaces: 3,
			planExecution: {
				interactiveParallelismReview: true,
			},
			parallelismReview: {
				enabled: true,
				threshold: 2,
				description: "Review required for batches wider than 2",
			},
			workspaces: [
				{ id: "A", title: "Workspace A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "B", title: "Workspace B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "C", title: "Workspace C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
			],
		};

		const validation = validateWorkspaceQueue(v220WithReview);
		expect(validation.valid).toBe(true);
		expect(v220WithReview.planExecution?.interactiveParallelismReview).toBe(true);
		expect(v220WithReview.parallelismReview?.enabled).toBe(true);
	});

	test("v2.1.0 plan file parses and validates end-to-end", async () => {
		const queueObj = {
			contractVersion: "2.1.0",
			phase: "P2-V210",
			title: "v2.1.0 Full E2E",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "W.A",
					title: "Foundation",
					dependencies: [] as string[],
					roleBudget: "worker" as const,
					maxRetries: 3,
				},
				{ id: "W.B", title: "Dependent B", dependencies: ["W.A"], roleBudget: "worker" as const, maxRetries: 3 },
				{ id: "W.C", title: "Dependent C", dependencies: ["W.A"], roleBudget: "worker" as const, maxRetries: 3 },
				{ id: "W.D", title: "Final", dependencies: ["W.B", "W.C"], roleBudget: "worker" as const, maxRetries: 3 },
			],
		};
		const v210PlanContent = buildPlanMarkdown(queueObj);

		const planFile = path.join(tempDir, "v210-plan.md");
		await fs.writeFile(planFile, v210PlanContent, "utf-8");

		const result = parsePlan(v210PlanContent, { validate: true });
		expect(result.success).toBe(true);
		expect(result.queue).toBeDefined();
		expect(result.queue!.contractVersion).toBe("2.1.0");
		expect(result.queue!.planExecution?.interactiveParallelismReview).toBeUndefined();

		const batchResult = computeBatchPlan(result.queue!);
		expect(batchResult.errors).toHaveLength(0);
		expect(batchResult.batches).toHaveLength(3);
		expect(batchResult.batches[0].width).toBe(1);
		expect(batchResult.batches[1].width).toBe(2);
		expect(batchResult.batches[2].width).toBe(1);
	});
});
