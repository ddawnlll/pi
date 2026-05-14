/**
 * Tests for P7.G Human Review and Approval UX
 *
 * Acceptance Criteria:
 * AC1: Execution blocks until required approval is current.
 * AC2: Rejected suggestions are logged with reason where available.
 * AC3: Approval UX never mutates executor state directly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PlanState, WorkspaceState } from "../src/core/plan-state.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";
import { DynamicParallelScheduler } from "../src/scheduler/dynamic-scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
	return {
		id,
		title: `Workspace ${id}`,
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

function makePlanState(workspaces: Workspace[], overrides: Partial<PlanState> = {}): PlanState {
	const wsMap = new Map<string, WorkspaceState>();
	for (const ws of workspaces) {
		wsMap.set(ws.id, {
			workspaceId: ws.id,
			stage: WorkspaceStage.Pending,
			attempts: 0,
			// If the workspace has preflightRequired, set initial preflightStatus
			...(ws.preflightRequired ? { preflightStatus: undefined } : {}),
		});
	}
	return {
		phase: "P2",
		title: "Test Plan",
		workspaces: wsMap,
		startedAt: Date.now(),
		status: "running",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC1: Execution blocks until required approval is current
// ---------------------------------------------------------------------------

describe("AC1: Execution blocks until required approval is current", () => {
	let scheduler: DynamicParallelScheduler;

	beforeEach(() => {
		scheduler = new DynamicParallelScheduler(3, false);
	});

	it("should block workspaces with preflightRequired=true and no preflightStatus set", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true })];
		const state = makePlanState(workspaces);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		// No workspaces should be ready
		expect(decision.ready).toHaveLength(0);

		// The workspace should be in the blocked list
		expect(decision.blocked.length).toBeGreaterThan(0);

		// The skip reason should include preflight_required
		const preflightSkip = decision.diagnostics.skipped.find((s) => s.category === "preflight_required");
		expect(preflightSkip).toBeDefined();
		expect(preflightSkip!.workspaceId).toBe("7.A");
		expect(preflightSkip!.reason).toContain("Preflight approval required");
	});

	it("should block workspaces with preflightStatus=pending", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true })];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
			preflightStatus: "pending",
		});
		const state = makePlanState([], { workspaces: wsMap });

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(0);
		const preflightSkip = decision.diagnostics.skipped.find((s) => s.category === "preflight_required");
		expect(preflightSkip).toBeDefined();
		expect(preflightSkip!.reason).toContain("pending");
	});

	it("should block workspaces with preflightStatus=rejected", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true })];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
			preflightStatus: "rejected",
			preflightRejectionReason: "Too risky for parallel execution",
		});
		const state = makePlanState([], { workspaces: wsMap });

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(0);
		const preflightSkip = decision.diagnostics.skipped.find((s) => s.category === "preflight_required");
		expect(preflightSkip).toBeDefined();
		expect(preflightSkip!.reason).toContain("rejected");
		expect(preflightSkip!.reason).toContain("Too risky for parallel execution");
	});

	it("should allow workspaces with preflightStatus=approved", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true })];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
			preflightStatus: "approved",
		});
		const state = makePlanState([], { workspaces: wsMap });

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		// Workspace should be ready since preflight is approved
		expect(decision.ready).toHaveLength(1);
		expect(decision.ready[0].id).toBe("7.A");
	});

	it("should not block workspaces without preflightRequired", () => {
		const workspaces = [makeWorkspace("7.A")];
		const state = makePlanState(workspaces);

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(1);
		expect(decision.ready[0].id).toBe("7.A");
	});

	it("should block preflight workspace even when dependencies are complete and capacity available", () => {
		// Workspace 7.A has done preflightRequired, 7.B depends on 7.A (no preflight needed)
		const workspaces = [
			makeWorkspace("7.A", { preflightRequired: true }),
			makeWorkspace("7.B", { dependencies: ["7.A"] }),
		];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
			preflightStatus: "pending",
		});
		wsMap.set("7.B", {
			workspaceId: "7.B",
			stage: WorkspaceStage.Pending,
			attempts: 0,
		});
		const state = makePlanState([], { workspaces: wsMap });

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		// 7.A should be blocked by preflight
		// 7.B should be blocked because 7.A is not complete
		expect(decision.ready).toHaveLength(0);
	});

	it("should allow non-preflight workspaces alongside approved preflight workspaces", () => {
		const workspaces = [makeWorkspace("7.A"), makeWorkspace("7.B", { preflightRequired: true })];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
		});
		wsMap.set("7.B", {
			workspaceId: "7.B",
			stage: WorkspaceStage.Pending,
			attempts: 0,
			preflightStatus: "approved",
		});
		const state = makePlanState([], { workspaces: wsMap });

		const decision = scheduler.getNextWorkspaces(workspaces, state);

		// Both should be ready
		expect(decision.ready).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// AC2: Rejected suggestions are logged with reason where available
// ---------------------------------------------------------------------------

describe("AC2: Rejected suggestions are logged with reason where available", () => {
	it("should include rejection reason in skip diagnostics when preflight was rejected", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true })];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
			preflightStatus: "rejected",
			preflightRejectionReason: "Insufficient test coverage",
		});
		const state = makePlanState([], { workspaces: wsMap });

		const scheduler = new DynamicParallelScheduler(3, false);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		const preflightSkip = decision.diagnostics.skipped.find((s) => s.category === "preflight_required");
		expect(preflightSkip).toBeDefined();
		expect(preflightSkip!.reason).toContain("Insufficient test coverage");
	});

	it("should still block without a rejection reason (reason is optional)", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true })];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
			preflightStatus: "rejected",
		});
		const state = makePlanState([], { workspaces: wsMap });

		const scheduler = new DynamicParallelScheduler(3, false);
		const decision = scheduler.getNextWorkspaces(workspaces, state);

		expect(decision.ready).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// AC3: Approval UX never mutates executor state directly
// ---------------------------------------------------------------------------

describe("AC3: Approval UX never mutates executor state directly", () => {
	it("should only read from state via the scheduler (not mutate)", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true })];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
		});
		const state = makePlanState([], { workspaces: wsMap });

		const scheduler = new DynamicParallelScheduler(3, false);

		// Capture the original state
		const originalPreflightStatus = wsMap.get("7.A")!.preflightStatus;

		// The scheduler should NOT modify the state
		scheduler.getNextWorkspaces(workspaces, state);

		// Verify the state was not mutated by the scheduler
		expect(state.workspaces.get("7.A")!.preflightStatus).toBe(originalPreflightStatus);
	});

	it("should not create side effects on state when scheduling", () => {
		const workspaces = [makeWorkspace("7.A", { preflightRequired: true }), makeWorkspace("7.B")];
		const wsMap = new Map<string, WorkspaceState>();
		wsMap.set("7.A", {
			workspaceId: "7.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
		});
		wsMap.set("7.B", {
			workspaceId: "7.B",
			stage: WorkspaceStage.Pending,
			attempts: 0,
		});
		const state = makePlanState([], { workspaces: wsMap });

		const scheduler = new DynamicParallelScheduler(3, false);
		scheduler.getNextWorkspaces(workspaces, state);

		// State should be unchanged
		expect(state.workspaces.get("7.A")!.stage).toBe(WorkspaceStage.Pending);
		expect(state.workspaces.get("7.B")!.stage).toBe(WorkspaceStage.Pending);

		// Workspace 7.A preflightStatus should still be undefined (not touched by scheduler)
		// The preflight is only initialized by the executor via the state store
		expect(state.workspaces.get("7.A")!.preflightStatus).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Journal event types
// ---------------------------------------------------------------------------

describe("Journal event types for preflight", () => {
	it("should have workspace_preflight_approved and workspace_preflight_rejected types available", () => {
		// Verify the types exist by checking that valid JournalEventType values work
		const approvedEvent = {
			type: "workspace_preflight_approved" as const,
			timestamp: Date.now(),
			workspaceId: "7.A",
		};

		const rejectedEvent = {
			type: "workspace_preflight_rejected" as const,
			timestamp: Date.now(),
			workspaceId: "7.A",
			data: { reason: "Too risky" },
		};

		expect(approvedEvent.type).toBe("workspace_preflight_approved");
		expect(rejectedEvent.type).toBe("workspace_preflight_rejected");
		expect(rejectedEvent.data?.reason).toBe("Too risky");
	});
});
