import { describe, expect, it } from "vitest";
import { planCompletionPredicate } from "../../src/execution-kernel/plan-supervisor.js";
import type { HandoffQueueRow } from "../../src/execution-kernel/types.js";

describe("plan-supervisor", () => {
	const makeHandoff = (overrides: Partial<HandoffQueueRow> = {}): HandoffQueueRow => ({
		id: "h1",
		attempt_id: "a",
		plan_execution_id: "p",
		workspace_execution_id: "w",
		status: "pending",
		reason: null,
		required: true,
		resolved_at: null,
		resolution: null,
		rejected_at: null,
		rejection_reason: null,
		expired_at: null,
		expires_at: null,
		created_at: "",
		updated_at: "",
		...overrides,
	});

	describe("handoff resolution", () => {
		it("returns HANDOFF_REQUIRED when required workspace has unresolved handoff", () => {
			expect(
				planCompletionPredicate([
					{ required: true, state: "RUNNING", handoff: makeHandoff({ status: "pending" }) },
				]),
			).toBe("HANDOFF_REQUIRED");
		});

		it("does not block on resolved handoff", () => {
			expect(
				planCompletionPredicate([
					{ required: true, state: "RUNNING", handoff: makeHandoff({ status: "complete" }) },
				]),
			).not.toBe("HANDOFF_REQUIRED");
		});

		it("does not block on non-required workspace handoff", () => {
			expect(planCompletionPredicate([{ required: false, state: "RUNNING", handoff: makeHandoff() }])).not.toBe(
				"HANDOFF_REQUIRED",
			);
		});

		it("does not block when non-required workspace has required handoff (handoff check requires required workspace)", () => {
			// The predicate only checks handoff on required workspaces
			expect(
				planCompletionPredicate([
					{ required: false, state: "RUNNING", handoff: makeHandoff({ required: true, status: "pending" }) },
					{ required: true, state: "SUCCEEDED" },
				]),
			).toBe("FINAL_VALIDATION");
		});
	});

	describe("failure detection", () => {
		it("returns FAILED_FINAL when required workspace failed finally", () => {
			expect(planCompletionPredicate([{ required: true, state: "FAILED_FINAL" }])).toBe("FAILED_FINAL");
		});

		it("does not fail on non-required workspace failure", () => {
			expect(
				planCompletionPredicate([
					{ required: false, state: "FAILED_FINAL" },
					{ required: true, state: "SUCCEEDED" },
				]),
			).toBe("FINAL_VALIDATION");
		});

		it("handoff check takes precedence over FAILED_FINAL", () => {
			// The predicate checks handoff before FAILED_FINAL
			expect(
				planCompletionPredicate([
					{ required: true, state: "FAILED_FINAL", handoff: makeHandoff({ status: "pending" }) },
				]),
			).toBe("HANDOFF_REQUIRED");
		});

		it("returns FAILED_FINAL when final validation fails", () => {
			expect(
				planCompletionPredicate([{ required: true, state: "SUCCEEDED" }], { finalValidationFailed: true }),
			).toBe("FAILED_FINAL");
		});
	});

	describe("success path", () => {
		it("enters FINAL_VALIDATION when all required workspaces succeeded", () => {
			expect(
				planCompletionPredicate([
					{ required: true, state: "SUCCEEDED" },
					{ required: true, state: "SUCCEEDED" },
				]),
			).toBe("FINAL_VALIDATION");
		});

		it("returns RUNNING when still in progress", () => {
			expect(
				planCompletionPredicate([
					{ required: true, state: "RUNNING" },
					{ required: true, state: "SUCCEEDED" },
				]),
			).toBe("RUNNING");
		});

		it("ignores non-required workspaces that are still running", () => {
			expect(
				planCompletionPredicate([
					{ required: true, state: "SUCCEEDED" },
					{ required: false, state: "RUNNING" },
				]),
			).toBe("FINAL_VALIDATION");
		});
	});
});
