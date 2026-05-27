import { describe, expect, it } from "vitest";
import type { WorkspaceTerminalState } from "../../src/execution-kernel/completion-predicate.js";
import {
	assertNoUnresolvedHandoffs,
	computePlanLifecycleState,
	isPlanComplete,
} from "../../src/execution-kernel/completion-predicate.js";
import type { HandoffQueueRow } from "../../src/execution-kernel/types.js";

function makeHandoff(overrides?: Partial<HandoffQueueRow>): HandoffQueueRow {
	return {
		id: "h-1",
		attempt_id: "att-1",
		plan_execution_id: "plan-1",
		workspace_execution_id: "ws-1",
		status: "pending",
		reason: "test handoff",
		required: true,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

describe("completion-predicate", () => {
	describe("computePlanLifecycleState", () => {
		it("returns awaiting_handoff when required workspace has unresolved handoff", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "HANDOFF_REQUIRED",
					handoff: makeHandoff({ status: "pending" }),
				},
			];
			expect(computePlanLifecycleState({ workspaces })).toBe("awaiting_handoff");
		});

		it("returns failed_final when required workspace is FAILED_FINAL", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "FAILED_FINAL",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces })).toBe("failed_final");
		});

		it("returns blocked_with_reason when required workspace is non-terminal", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "RUNNING",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces })).toBe("blocked_with_reason");
		});

		it("returns final_validation when all required workspaces succeeded", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "SUCCEEDED",
					handoff: null,
				},
				{
					workspaceId: "ws-2",
					required: true,
					state: "SUCCEEDED",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces })).toBe("final_validation");
		});

		it("returns completed when final validation passed", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "SUCCEEDED",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces, finalValidationPassed: true })).toBe("completed");
		});

		it("returns completed_with_warnings when final validation passed but optional workspaces failed", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "SUCCEEDED",
					handoff: null,
				},
				{
					workspaceId: "ws-2",
					required: false,
					state: "FAILED_RETRYABLE",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces, finalValidationPassed: true })).toBe("completed_with_warnings");
		});

		it("returns failed_final when final validation failed", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "SUCCEEDED",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces, finalValidationFailed: true })).toBe("failed_final");
		});

		it("returns running when required workspace is FAILED_RETRYABLE", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "FAILED_RETRYABLE",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces })).toBe("running");
		});

		it("returns blocked_with_reason when multiple required states are problematic", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "SUCCEEDED",
					handoff: null,
				},
				{
					workspaceId: "ws-2",
					required: true,
					state: "PENDING",
					handoff: null,
				},
			];
			expect(computePlanLifecycleState({ workspaces })).toBe("blocked_with_reason");
		});
	});

	describe("assertNoUnresolvedHandoffs", () => {
		it("throws when handoffs are unresolved", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "HANDOFF_REQUIRED",
					handoff: makeHandoff({ status: "pending" }),
				},
			];
			expect(() => assertNoUnresolvedHandoffs(workspaces)).toThrow("plan_completed_with_unresolved_handoff");
		});

		it("does not throw when handoffs are resolved", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "HANDOFF_REQUIRED",
					handoff: makeHandoff({ status: "complete" }),
				},
			];
			expect(() => assertNoUnresolvedHandoffs(workspaces)).not.toThrow();
		});

		it("does not throw when no handoffs exist", () => {
			const workspaces: WorkspaceTerminalState[] = [
				{
					workspaceId: "ws-1",
					required: true,
					state: "SUCCEEDED",
					handoff: null,
				},
			];
			expect(() => assertNoUnresolvedHandoffs(workspaces)).not.toThrow();
		});
	});

	describe("isPlanComplete", () => {
		it("completed is complete", () => expect(isPlanComplete("completed")).toBe(true));
		it("completed_with_warnings is complete", () => expect(isPlanComplete("completed_with_warnings")).toBe(true));
		it("failed_final is complete", () => expect(isPlanComplete("failed_final")).toBe(true));
		it("running is not complete", () => expect(isPlanComplete("running")).toBe(false));
		it("awaiting_handoff is not complete", () => expect(isPlanComplete("awaiting_handoff")).toBe(false));
	});
});
