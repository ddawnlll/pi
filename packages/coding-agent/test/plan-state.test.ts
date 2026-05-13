/**
 * Tests for State Store + Report System - P2 Workstream 7.C
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPlanState, generateWorkspaceReport, PlanStateStore } from "../src/core/plan-state.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-plan-state");

describe("PlanStateStore", () => {
	let store: PlanStateStore;

	beforeEach(async () => {
		// Create test directory
		await fs.mkdir(TEST_DIR, { recursive: true });
		store = new PlanStateStore(TEST_DIR);
	});

	afterEach(async () => {
		// Clean up test directory
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("should initialize state for a new plan", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "7.B",
					title: "Task B",
					dependencies: ["7.A"],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const state = await store.initializeState(queue);

		expect(state.phase).toBe("P2");
		expect(state.title).toBe("Test Phase");
		expect(state.status).toBe("running");
		expect(state.workspaces.size).toBe(2);
		expect(state.workspaces.get("7.A")?.stage).toBe(WorkspaceStage.Pending);
		expect(state.workspaces.get("7.B")?.stage).toBe(WorkspaceStage.Pending);
	});

	it("should save and load state", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.updateWorkspaceState("7.A", { stage: WorkspaceStage.Active });

		// Create new store instance and load
		const newStore = new PlanStateStore(TEST_DIR);
		const loaded = await newStore.loadState();

		expect(loaded).toBeDefined();
		expect(loaded?.phase).toBe("P2");
		expect(loaded?.workspaces.get("7.A")?.stage).toBe(WorkspaceStage.Active);
	});

	it("should return null when loading non-existent state", async () => {
		const loaded = await store.loadState();
		expect(loaded).toBeNull();
	});

	it("should update workspace state", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.updateWorkspaceState("7.A", {
			stage: WorkspaceStage.Active,
			startedAt: Date.now(),
		});

		const state = store.getState();
		const wsState = state?.workspaces.get("7.A");
		expect(wsState?.stage).toBe(WorkspaceStage.Active);
		expect(wsState?.startedAt).toBeDefined();
	});

	it("should transition workspace stages", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);

		// Transition to active
		await store.transitionWorkspace("7.A", WorkspaceStage.Active);
		let wsState = store.getWorkspaceState("7.A");
		expect(wsState?.stage).toBe(WorkspaceStage.Active);
		expect(wsState?.startedAt).toBeDefined();

		// Transition to complete
		await store.transitionWorkspace("7.A", WorkspaceStage.Complete);
		wsState = store.getWorkspaceState("7.A");
		expect(wsState?.stage).toBe(WorkspaceStage.Complete);
		expect(wsState?.completedAt).toBeDefined();
	});

	it("should increment retry attempts", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);

		await store.incrementRetryAttempt("7.A");
		let wsState = store.getWorkspaceState("7.A");
		expect(wsState?.attempts).toBe(1);

		await store.incrementRetryAttempt("7.A");
		wsState = store.getWorkspaceState("7.A");
		expect(wsState?.attempts).toBe(2);
	});

	it("should manage file locks", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);

		const files = ["file1.ts", "file2.ts"];
		await store.acquireFileLocks("7.A", files);

		let wsState = store.getWorkspaceState("7.A");
		expect(wsState?.ownedFiles).toEqual(files);

		await store.releaseFileLocks("7.A");
		wsState = store.getWorkspaceState("7.A");
		expect(wsState?.ownedFiles).toEqual([]);
	});

	it("should append to execution journal", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.transitionWorkspace("7.A", WorkspaceStage.Active);
		await store.transitionWorkspace("7.A", WorkspaceStage.Complete);

		const journal = await store.readJournal();
		expect(journal.length).toBeGreaterThan(0);
		expect(journal.some((e) => e.type === "plan_start")).toBe(true);
		expect(journal.some((e) => e.type === "workspace_start")).toBe(true);
		expect(journal.some((e) => e.type === "workspace_complete")).toBe(true);
	});

	it("should mark plan as complete", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.completePlan();

		const state = store.getState();
		expect(state?.status).toBe("complete");
		expect(state?.completedAt).toBeDefined();

		const journal = await store.readJournal();
		expect(journal.some((e) => e.type === "plan_complete")).toBe(true);
	});

	it("should mark plan as failed", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.failPlan("Test error");

		const state = store.getState();
		expect(state?.status).toBe("failed");
		expect(state?.completedAt).toBeDefined();

		const journal = await store.readJournal();
		expect(journal.some((e) => e.type === "plan_failed")).toBe(true);
	});

	it("should get workspaces by stage", async () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "7.B",
					title: "Task B",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		await store.initializeState(queue);
		await store.transitionWorkspace("7.A", WorkspaceStage.Active);

		const pending = store.getWorkspacesByStage(WorkspaceStage.Pending);
		const active = store.getWorkspacesByStage(WorkspaceStage.Active);

		expect(pending).toHaveLength(1);
		expect(pending[0].workspaceId).toBe("7.B");
		expect(active).toHaveLength(1);
		expect(active[0].workspaceId).toBe("7.A");
	});
});

describe("generateWorkspaceReport", () => {
	it("should generate report for completed workspace", () => {
		const workspace = {
			id: "7.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
		};

		const state = {
			workspaceId: "7.A",
			stage: WorkspaceStage.Complete,
			attempts: 1,
			startedAt: Date.now() - 5000,
			completedAt: Date.now(),
		};

		const report = generateWorkspaceReport(workspace, state);
		expect(report).toContain("# Workspace 7.A");
		expect(report).toContain("**Status:** complete");
		expect(report).toContain("**Attempts:** 1");
		expect(report).toContain("**Duration:**");
	});

	it("should include error in report for failed workspace", () => {
		const workspace = {
			id: "7.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
		};

		const state = {
			workspaceId: "7.A",
			stage: WorkspaceStage.Failed,
			attempts: 3,
			error: "Test failed",
		};

		const report = generateWorkspaceReport(workspace, state);
		expect(report).toContain("## Error");
		expect(report).toContain("Test failed");
	});

	it("should include token waste prevention section when editAuditSummary is present", () => {
		const workspace = {
			id: "7.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
		};

		const state = {
			workspaceId: "7.A",
			stage: WorkspaceStage.Complete,
			attempts: 1,
			editAuditSummary: {
				editModeUsed: "token_saving" as const,
				blockedRewrites: 3,
				truncationEvents: 1,
				exactMatchFailures: 2,
				handoffs: 1,
				estimatedWastePrevented: 4,
			},
		};

		const report = generateWorkspaceReport(workspace, state);
		expect(report).toContain("## Token Waste Prevention");
		expect(report).toContain("**Edit Mode:** token saving");
		expect(report).toContain("**Blocked Rewrites:** 3");
		expect(report).toContain("**Truncation Events:** 1");
		expect(report).toContain("**Exact-Match Failures:** 2");
		expect(report).toContain("**Edit Failure Handoffs:** 1");
		expect(report).toContain("**Estimated Waste Prevented:** 4 event(s)");
		expect(report).toContain("pi plan doctor");
	});

	it("should not include token waste prevention section when editAuditSummary is absent", () => {
		const workspace = {
			id: "7.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker" as const,
			maxRetries: 3,
		};

		const state = {
			workspaceId: "7.A",
			stage: WorkspaceStage.Complete,
			attempts: 1,
		};

		const report = generateWorkspaceReport(workspace, state);
		expect(report).not.toContain("## Token Waste Prevention");
	});
});

describe("formatPlanState", () => {
	it("should format plan state", () => {
		const state = {
			phase: "P2",
			title: "Test Phase",
			workspaces: new Map([
				[
					"7.A",
					{
						workspaceId: "7.A",
						stage: WorkspaceStage.Complete,
						attempts: 1,
					},
				],
				[
					"7.B",
					{
						workspaceId: "7.B",
						stage: WorkspaceStage.Active,
						attempts: 0,
					},
				],
			]),
			startedAt: Date.now(),
			status: "running" as const,
		};

		const formatted = formatPlanState(state);
		expect(formatted).toContain("Phase: P2");
		expect(formatted).toContain("Status: running");
		expect(formatted).toContain("complete: 7.A");
		expect(formatted).toContain("active: 7.B");
	});
});
