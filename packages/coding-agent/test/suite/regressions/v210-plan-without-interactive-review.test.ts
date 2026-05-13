/**
 * Regression: v2.1.0 plan without interactive review
 *
 * Ensures that plans declaring contractVersion 2.1.0
 * (which predates planExecution.interactiveParallelismReview
 * and parallelismReview fields) are accepted and execute
 * without requiring interactive parallelism review.
 *
 * This is a regression guard against accidentally requiring
 * v2.2.0-only fields for older contract versions.
 */

import { describe, expect, it } from "vitest";
import { computeBatchPlan } from "../../../src/core/dag-analyzer.js";
import { parsePlan } from "../../../src/core/plan-parser.js";
import type { WorkspaceQueue } from "../../../src/core/workspace-schema.js";
import { ACCEPTED_SCHEMA_VERSIONS, validateWorkspaceQueue } from "../../../src/core/workspace-schema.js";

/** Build a plan markdown string with an embedded JSON Part 3 queue. */
function buildPlanMarkdown(queueObj: Record<string, unknown>): string {
	const queueJson = JSON.stringify(queueObj, null, 2);
	const NL = String.fromCharCode(10);
	const lines: string[] = [
		"# Phase P2 - v2.1.0 Regression",
		"",
		"# Part 3 - Workspace Queue",
		"",
		"```json",
		queueJson,
		"```",
	];
	return lines.join(NL);
}

describe("regression: v2.1.0 plan without interactive review", () => {
	it("v2.1.0 is an accepted contract schema version", () => {
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.1.0")).toBe(true);
	});

	it("v2.1.0 plan without planExecution or parallelismReview validates successfully", () => {
		const queue: WorkspaceQueue = {
			contractVersion: "2.1.0",
			phase: "P2",
			title: "v2.1.0 Regression Test",
			maxParallelWorkspaces: 2,
			workspaces: [
				{ id: "A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "B", title: "Task B", dependencies: ["A"], roleBudget: "worker", maxRetries: 3 },
			],
		};

		const validation = validateWorkspaceQueue(queue);
		expect(validation.valid).toBe(true);
		expect(
			validation.errors.filter(
				(e) => e.message.includes("interactiveParallelismReview") || e.message.includes("parallelismReview"),
			),
		).toHaveLength(0);
	});

	it("v2.1.0 plan parses successfully from markdown with JSON queue", () => {
		const queueObj = {
			contractVersion: "2.1.0",
			phase: "P2",
			title: "v2.1.0 Regression Plan",
			maxParallelWorkspaces: 2,
			workspaces: [
				{ id: "X", title: "Task X", dependencies: [] as string[], roleBudget: "worker" as const, maxRetries: 3 },
				{ id: "Y", title: "Task Y", dependencies: ["X"], roleBudget: "worker" as const, maxRetries: 3 },
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

	it("batch computation completes for v2.1.0 plan without interactive review gate", () => {
		const queue: WorkspaceQueue = {
			contractVersion: "2.1.0",
			phase: "P2",
			title: "v2.1.0 Batch Test",
			maxParallelWorkspaces: 3,
			workspaces: [
				{ id: "A", title: "Task A", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "B", title: "Task B", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "C", title: "Task C", dependencies: [], roleBudget: "worker", maxRetries: 3 },
				{ id: "D", title: "Task D", dependencies: ["A", "B", "C"], roleBudget: "worker", maxRetries: 3 },
			],
		};

		const batchResult = computeBatchPlan(queue);
		expect(batchResult.errors).toHaveLength(0);
		expect(batchResult.batches).toHaveLength(2);
		expect(batchResult.batches[0].width).toBe(3);
		expect(batchResult.effectiveParallelism).toBe(3);

		// v2.1.0 has no interactive review concept
		expect(queue.planExecution?.interactiveParallelismReview).toBeUndefined();
		expect(queue.parallelismReview).toBeUndefined();
	});

	it("v2.1.0 plan does not get rejected for missing v2.2.0 fields", () => {
		const queue: WorkspaceQueue = {
			contractVersion: "2.1.0",
			phase: "P2",
			title: "Minimal v2.1.0",
			maxParallelWorkspaces: 1,
			workspaces: [{ id: "A", title: "Single Task", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
		};

		const validation = validateWorkspaceQueue(queue);
		expect(validation.valid).toBe(true);

		// No errors about missing v2.2.0 fields
		const v220RelatedErrors = validation.errors.filter(
			(e) =>
				e.message.includes("interactiveParallelismReview") ||
				e.message.includes("parallelismReview") ||
				e.message.includes("parallelGroup") ||
				e.message.includes("dependencyReason"),
		);
		expect(v220RelatedErrors).toHaveLength(0);
	});

	it("contrast: v2.2.0 plan can declare interactiveParallelismReview without error", () => {
		const v220Queue: WorkspaceQueue = {
			contractVersion: "2.2.0",
			phase: "P2",
			title: "v2.2.0 With Review",
			maxParallelWorkspaces: 3,
			planExecution: { interactiveParallelismReview: true },
			parallelismReview: { enabled: true },
			workspaces: [{ id: "A", title: "Task", dependencies: [], roleBudget: "worker", maxRetries: 3 }],
		};

		const validation = validateWorkspaceQueue(v220Queue);
		expect(validation.valid).toBe(true);
		expect(v220Queue.planExecution?.interactiveParallelismReview).toBe(true);
	});
});
