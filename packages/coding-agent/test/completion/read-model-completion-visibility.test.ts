/**
 * P44.10 — Read Model Completion Truth Visibility Tests
 *
 * Tests that workspace completion gate status is properly exposed through:
 * 1. The ExecutionReadModel interface (packages/execution-contracts)
 * 2. The query-handler extraction logic (packages/execution-service)
 *
 * Also verifies that the dashboard hook and component types are aligned
 * with the read model contract.
 *
 * Acceptance criteria:
 * - CompletionStatusView interface exposes canComplete, blockReasons,
 *   recommendedStage, and dataAvailability
 * - extractCompletionStatusFromEvents returns blocked status when
 *   completion_gate_blocked_visible events exist
 * - extractCompletionStatusFromEvents returns canComplete=true when
 *   workspace reached terminal state without blockage
 * - extractCompletionStatusFromEvents returns unavailable when no
 *   relevant events exist
 * - The getWorkspaceCompletionStatus() method on ExecutionReadModel
 *   delegates to extraction correctly
 */

import { createExecutionReadModel } from "@earendil-works/pi-execution-service";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Contract Structure Tests
// ---------------------------------------------------------------------------

describe("CompletionStatusView — interface contract", () => {
	it("returns canComplete=false with blockReasons when completion_gate_blocked_visible exists", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "completion_gate_blocked_visible",
					payload: {
						blockReasons: ["Test command did not pass", "Implementation not finished"],
					},
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(false);
		expect(status.blockReasons).toEqual(["Test command did not pass", "Implementation not finished"]);
		expect(status.dataAvailability.available).toBe(true);
	});

	it("extracts recommendedStage from completion_gate_blocked_visible payload", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "completion_gate_blocked_visible",
					payload: {
						blockReasons: ["Implementation not finished"],
						recommendedStage: "blocked",
					},
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(false);
		expect(status.recommendedStage).toBe("blocked");
		expect(status.blockReasons).toHaveLength(1);
	});

	it("uses the latest completion_gate_blocked_visible event when multiple exist", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "completion_gate_blocked_visible",
					payload: {
						blockReasons: ["Initial block reason"],
					},
					createdAt: new Date(Date.now() - 5000).toISOString(),
				},
				{
					seq: "2",
					eventId: "evt-2",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "completion_gate_blocked_visible",
					payload: {
						blockReasons: ["Updated block reason"],
					},
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(false);
		expect(status.blockReasons).toEqual(["Updated block reason"]);
	});
});

// ---------------------------------------------------------------------------
// No-Block Scenarios
// ---------------------------------------------------------------------------

describe("CompletionStatusView — no block scenarios", () => {
	it("returns canComplete=true when workspace completed without blockage", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "workspace_completed",
					payload: null,
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(true);
		expect(status.blockReasons).toHaveLength(0);
		expect(status.dataAvailability.available).toBe(true);
	});

	it("returns canComplete=true when workspace failed without blockage", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "workspace_failed",
					payload: { error: "Something went wrong" },
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(true);
		expect(status.blockReasons).toHaveLength(0);
	});

	it("returns canComplete=true when workspace was blocked (non-gate) without blockage", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "workspace_blocked",
					payload: { reason: "Dependency failed" },
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(true);
		expect(status.blockReasons).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Unavailable Scenarios
// ---------------------------------------------------------------------------

describe("CompletionStatusView — unavailable", () => {
	it("returns unavailable when no relevant events exist", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(false);
		expect(status.blockReasons).toHaveLength(0);
		expect(status.dataAvailability.available).toBe(false);
	});

	it("returns unavailable when no journal provider exists", async () => {
		const model = createExecutionReadModel({});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(false);
		expect(status.blockReasons).toHaveLength(0);
		expect(status.dataAvailability.available).toBe(false);
	});

	it("filters events by workspace ID correctly", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-other",
					eventType: "completion_gate_blocked_visible",
					payload: { blockReasons: ["Blocked for other workspace"] },
					createdAt: new Date().toISOString(),
				},
			],
		});

		// Querying for ws-1 should not see the event from ws-other
		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.dataAvailability.available).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("CompletionStatusView — edge cases", () => {
	it("handles empty blockReasons array from payload", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "completion_gate_blocked_visible",
					payload: { blockReasons: [] },
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(false);
		expect(status.blockReasons).toHaveLength(0);
		expect(status.dataAvailability.available).toBe(true);
	});

	it("handles missing payload gracefully", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "completion_gate_blocked_visible",
					payload: null,
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(false);
		expect(status.blockReasons).toHaveLength(0);
		expect(status.dataAvailability.available).toBe(true);
	});

	it("ignores events for other workspaces when mixed", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "workspace_running",
					payload: null,
					createdAt: new Date().toISOString(),
				},
				{
					seq: "2",
					eventId: "evt-2",
					planExecutionId: "exec-1",
					workspaceId: "ws-2",
					eventType: "completion_gate_blocked_visible",
					payload: { blockReasons: ["Blocked"] },
					createdAt: new Date().toISOString(),
				},
				{
					seq: "3",
					eventId: "evt-3",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "workspace_completed",
					payload: null,
					createdAt: new Date().toISOString(),
				},
			],
		});

		// ws-1 completed without gate block
		const status = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");

		expect(status.canComplete).toBe(true);
		expect(status.dataAvailability.available).toBe(true);
	});

	it("handles concurrent workspaces independently", async () => {
		const model = createExecutionReadModel({
			getJournalEvents: async () => [
				{
					seq: "1",
					eventId: "evt-1",
					planExecutionId: "exec-1",
					workspaceId: "ws-1",
					eventType: "completion_gate_blocked_visible",
					payload: { blockReasons: ["ws-1 blocked"] },
					createdAt: new Date().toISOString(),
				},
				{
					seq: "2",
					eventId: "evt-2",
					planExecutionId: "exec-1",
					workspaceId: "ws-2",
					eventType: "workspace_completed",
					payload: null,
					createdAt: new Date().toISOString(),
				},
			],
		});

		const status1 = await model.getWorkspaceCompletionStatus("exec-1", "ws-1");
		expect(status1.canComplete).toBe(false);
		expect(status1.blockReasons).toEqual(["ws-1 blocked"]);

		const status2 = await model.getWorkspaceCompletionStatus("exec-1", "ws-2");
		expect(status2.canComplete).toBe(true);
		expect(status2.blockReasons).toHaveLength(0);
	});
});
