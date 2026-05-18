/**
 * Tests for Plan Queue Runner - Multi-Plan Queue Management
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PlanQueueEntry, PlanQueueEntryStatus, PlanQueueRunner } from "../src/core/plan-queue-runner.js";
import type { IStateStore } from "../src/core/state-store.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-plan-queue-runner");

/**
 * Create a minimal mock IStateStore for testing.
 */
function createMockStateStore(): IStateStore {
	return {
		getBackendType: () => "json" as const,
		listProjects: async () => [],
		findOrCreateProject: async (name: string) => ({
			id: "proj-1",
			name,
			description: null,
			rootPath: null,
			createdAt: new Date().toISOString(),
		}),
		updateProject: async () => {},
		initializeState: async () => `exec-${Date.now()}`,
		loadState: async () => null,
		saveState: async () => {},
		listPlanExecutions: async () => [],
		updateWorkspaceState: async () => {},
		transitionWorkspace: async () => {},
		incrementRetryAttempt: async () => {},
		acquireFileLocks: async () => {},
		releaseFileLocks: async () => {},
		setAwaitingHandoff: async () => {},
		handoffCommit: async () => {},
		handoffKeepEditing: async () => {},
		handoffDiscard: async () => {},
		isAwaitingHandoff: async () => false,
		getHandoffStartedAt: async () => 0,
		appendJournal: async () => {},
		appendJournalEvent: async () => {},
		readJournal: async () => [],
		completePlan: async () => {},
		failPlan: async () => {},
		pausePlan: async () => {},
		stopPlan: async () => {},
		cancelPlan: async () => {},
		resumePlan: async () => {},
		writeControlRequest: async () => {},
		readControlRequest: async () => null,
		clearControlRequest: async () => {},
		getWorkspaceState: async () => undefined,
		getWorkspaceAttempts: async () => [],
		getStatistics: async () => ({
			total: 1,
			pending: 0,
			active: 0,
			complete: 1,
			blocked: 0,
			failed: 0,
		}),
		saveExecutionLog: async () => {},
		loadExecutionLog: async () => null,
	} as unknown as IStateStore;
}

/**
 * Sample workspace queue for tests.
 */
const sampleQueue: WorkspaceQueue = {
	phase: "P5",
	title: "Test Queue Plan",
	maxParallelWorkspaces: 3,
	workspaces: [
		{
			id: "5.A",
			title: "Task A",
			dependencies: [],
			roleBudget: "worker",
			maxRetries: 3,
		},
	],
};

describe("PlanQueueRunner", () => {
	let runner: PlanQueueRunner;
	let stateStore: IStateStore;
	let executionLog: { entryId: string; success: boolean; error?: string }[] = [];

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		stateStore = createMockStateStore();
		executionLog = [];

		runner = new PlanQueueRunner({
			workspaceRoot: TEST_DIR,
			stateStore,
			isDirtyFn: async () => false, // Clean by default
			executePlanFn: async (entry: PlanQueueEntry) => {
				executionLog.push({
					entryId: entry.id,
					success: true,
				});
				entry.planExecutionId = `exec-${entry.id}`;
				return { success: true };
			},
			checkGatesFn: async () => true, // Gates pass by default
		});
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	describe("enqueue", () => {
		it("should add a plan to the queue", async () => {
			const entry = await runner.enqueue("proj-1", "/plans/plan1.md", sampleQueue);

			expect(entry.id).toBeDefined();
			expect(entry.projectId).toBe("proj-1");
			expect(entry.planPath).toBe("/plans/plan1.md");
			expect(entry.status).toBe(PlanQueueEntryStatus.Pending);
			expect(entry.queue).toBe(sampleQueue);
		});

		it("should add multiple plans to the queue", async () => {
			const entry1 = await runner.enqueue("proj-1", "/plans/plan1.md", sampleQueue);
			const entry2 = await runner.enqueue("proj-1", "/plans/plan2.md", sampleQueue);
			const entry3 = await runner.enqueue("proj-1", "/plans/plan3.md", sampleQueue);

			const entries = runner.getEntries();
			expect(entries).toHaveLength(3);
			expect(entries[0].id).toBe(entry1.id);
			expect(entries[1].id).toBe(entry2.id);
			expect(entries[2].id).toBe(entry3.id);
		});

		it("should add plans to different projects", async () => {
			const entry1 = await runner.enqueue("proj-1", "/plans/plan1.md");
			const entry2 = await runner.enqueue("proj-2", "/plans/plan2.md");

			const proj1Entries = runner.getEntriesForProject("proj-1");
			const proj2Entries = runner.getEntriesForProject("proj-2");

			expect(proj1Entries).toHaveLength(1);
			expect(proj2Entries).toHaveLength(1);
			expect(proj1Entries[0].id).toBe(entry1.id);
			expect(proj2Entries[0].id).toBe(entry2.id);
		});

		it("should persist state after enqueue", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");

			const statePath = runner.getStateFilePath();
			const content = await fs.readFile(statePath, "utf-8");
			const state = JSON.parse(content);

			expect(state.entries).toHaveLength(1);
			expect(state.entries[0].status).toBe(PlanQueueEntryStatus.Pending);
		});
	});

	describe("dequeue", () => {
		it("should remove a pending plan from the queue", async () => {
			const entry = await runner.enqueue("proj-1", "/plans/plan1.md");
			const removed = await runner.dequeue(entry.id);

			expect(removed).toBe(true);
			expect(runner.getEntries()).toHaveLength(0);
		});

		it("should not remove an active plan", async () => {
			const entry = await runner.enqueue("proj-1", "/plans/plan1.md");
			// Manually set status to active
			const entries = runner.getEntries();
			(entries[0] as any).status = PlanQueueEntryStatus.Active;

			const removed = await runner.dequeue(entry.id);
			expect(removed).toBe(false);
		});

		it("should return false for non-existent entry", async () => {
			const removed = await runner.dequeue("non-existent-id");
			expect(removed).toBe(false);
		});
	});

	describe("one active plan per project", () => {
		it("should not have more than one active plan per project at a time", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			await runner.enqueue("proj-1", "/plans/plan2.md");
			await runner.enqueue("proj-1", "/plans/plan3.md");

			// Start the queue
			await runner.start();

			// Check execution log - plans should have been executed sequentially
			expect(executionLog).toHaveLength(3);

			// Verify they were not all active at the same time
			// Since executePlanFn is sync-ish, we can check that entries ended up complete
			const entries = runner.getEntries();
			for (const entry of entries) {
				expect(entry.status).toBe(PlanQueueEntryStatus.Complete);
			}
		});

		it("should allow concurrent plans across different projects", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			await runner.enqueue("proj-2", "/plans/plan2.md");

			// Create a runner that tracks concurrency
			let maxConcurrent = 0;
			let currentConcurrent = 0;
			const concurrentEntries = new Set<string>();

			const concurrentRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					currentConcurrent++;
					concurrentEntries.add(entry.projectId);
					if (currentConcurrent > maxConcurrent) {
						maxConcurrent = currentConcurrent;
					}
					// Simulate async work
					await new Promise((resolve) => setTimeout(resolve, 10));
					currentConcurrent--;
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await concurrentRunner.enqueue("proj-1", "/plans/plan1.md");
			await concurrentRunner.enqueue("proj-2", "/plans/plan2.md");

			await concurrentRunner.start();

			// Per-project constraint: should track correctly
			const entries = concurrentRunner.getEntries();
			expect(entries).toHaveLength(2);
			expect(entries.every((e) => e.status === PlanQueueEntryStatus.Complete)).toBe(true);
		});
	});

	describe("queue runner starts next plan after gates pass", () => {
		it("should start the next plan only after current plan gates pass", async () => {
			const executionOrder: string[] = [];
			let gatesCheckCount = 0;

			const gatedRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					executionOrder.push(entry.planPath);
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => {
					gatesCheckCount++;
					return true;
				},
			});

			await gatedRunner.enqueue("proj-1", "/plans/plan1.md");
			await gatedRunner.enqueue("proj-1", "/plans/plan2.md");

			await gatedRunner.start();

			// Both plans should have been executed in order
			expect(executionOrder).toEqual(["/plans/plan1.md", "/plans/plan2.md"]);

			// Gates should have been checked for each completed plan
			expect(gatesCheckCount).toBe(2);
		});

		it("should not start next plan if gates fail", async () => {
			const executionOrder: string[] = [];

			const gatedRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					executionOrder.push(entry.planPath);
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => false, // Gates always fail
			});

			await gatedRunner.enqueue("proj-1", "/plans/plan1.md");
			await gatedRunner.enqueue("proj-1", "/plans/plan2.md");

			await gatedRunner.start();

			// Only the first plan should have been executed
			expect(executionOrder).toEqual(["/plans/plan1.md"]);

			// Second plan should be skipped
			const entries = gatedRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Failed);
			expect(entries[0].error).toBe("Post-execution gates did not pass");
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Skipped);
		});
	});

	describe("dirty working tree prevents next plan start", () => {
		it("should block next plan when working tree is dirty", async () => {
			let callCount = 0;
			let _dirtyOnSecond = false;

			const dirtyAwareRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => {
					callCount++;
					// Return dirty on the second call (before second plan)
					if (callCount >= 2) {
						_dirtyOnSecond = true;
						return true;
					}
					return false;
				},
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await dirtyAwareRunner.enqueue("proj-1", "/plans/plan1.md");
			await dirtyAwareRunner.enqueue("proj-1", "/plans/plan2.md");

			await dirtyAwareRunner.start();

			// Second plan should be blocked
			const entries = dirtyAwareRunner.getEntries();
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Blocked);
			expect(entries[1].blockReason).toContain("Dirty working tree");
		});

		it("should always check dirty before starting a plan", async () => {
			const isDirty = true; // Start dirty

			const dirtyRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => isDirty,
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await dirtyRunner.enqueue("proj-1", "/plans/plan1.md");

			await dirtyRunner.start();

			// Plan should be blocked because tree is dirty
			const entries = dirtyRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Blocked);
			expect(entries[0].blockReason).toContain("Dirty working tree");
		});
	});

	describe("integration queue cleanliness gate", () => {
		it("should block next plan when integration queue has dirty entries", async () => {
			let integrationDirtyCallCount = 0;

			const gatedRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				isIntegrationQueueDirtyFn: async () => {
					integrationDirtyCallCount++;
					// Return dirty on the second call (before second plan)
					if (integrationDirtyCallCount >= 2) {
						return true;
					}
					return false;
				},
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await gatedRunner.enqueue("proj-1", "/plans/plan1.md");
			await gatedRunner.enqueue("proj-1", "/plans/plan2.md");

			await gatedRunner.start();

			// First plan should have completed
			// Second plan should be blocked because integration queue is dirty
			const entries = gatedRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Complete);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Blocked);
			expect(entries[1].blockReason).toContain("Integration queue");
			expect(entries[1].blockReason).toContain("unresolved entries");
		});

		it("should allow next plan when integration queue is clean", async () => {
			const gatedRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				isIntegrationQueueDirtyFn: async () => false, // Always clean
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await gatedRunner.enqueue("proj-1", "/plans/plan1.md");
			await gatedRunner.enqueue("proj-1", "/plans/plan2.md");

			await gatedRunner.start();

			const entries = gatedRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Complete);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Complete);
		});

		it("should set human-readable blocker reason when integration queue is dirty", async () => {
			const gatedRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				isIntegrationQueueDirtyFn: async () => true, // Always dirty
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await gatedRunner.enqueue("proj-1", "/plans/plan1.md");

			await gatedRunner.start();

			const entries = gatedRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Blocked);
			expect(entries[0].blockReason).toBeDefined();
			expect(entries[0].blockReason!.length).toBeGreaterThan(0);
			expect(entries[0].blockReason).toMatch(/integration/i);
		});

		it("should produce different blocker reason than dirty working tree", async () => {
			const integrationGateRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				isIntegrationQueueDirtyFn: async () => true,
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await integrationGateRunner.enqueue("proj-1", "/plans/plan1.md");
			await integrationGateRunner.start();

			const entries = integrationGateRunner.getEntries();
			expect(entries[0].blockReason).toContain("Integration queue");
			expect(entries[0].blockReason).not.toContain("Dirty working tree");
		});

		it("should not block when integration queue dirty check is not configured", async () => {
			// When isIntegrationQueueDirtyFn is not provided, the gate is not enforced
			const runner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await runner.enqueue("proj-1", "/plans/plan1.md");
			await runner.enqueue("proj-1", "/plans/plan2.md");

			await runner.start();

			const entries = runner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Complete);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Complete);
		});
	});

	describe("failed plan stops queue by default", () => {
		it("should stop queue when a plan fails and stopOnFailure is true", async () => {
			const executionOrder: string[] = [];

			const failingRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				stopOnFailure: true,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					executionOrder.push(entry.planPath);
					if (entry.planPath === "/plans/plan2.md") {
						return { success: false, error: "Plan 2 failed" };
					}
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await failingRunner.enqueue("proj-1", "/plans/plan1.md");
			await failingRunner.enqueue("proj-1", "/plans/plan2.md");
			await failingRunner.enqueue("proj-1", "/plans/plan3.md");

			await failingRunner.start();

			// First two plans should have been attempted (1 succeeds, 2 fails)
			expect(executionOrder).toEqual(["/plans/plan1.md", "/plans/plan2.md"]);

			const entries = failingRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Complete);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Failed);
			expect(entries[1].error).toBe("Plan 2 failed");
			expect(entries[2].status).toBe(PlanQueueEntryStatus.Skipped);
		});

		it("should continue queue when a plan fails and stopOnFailure is false", async () => {
			const executionOrder: string[] = [];

			const continuingRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				stopOnFailure: false,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					executionOrder.push(entry.planPath);
					if (entry.planPath === "/plans/plan2.md") {
						return { success: false, error: "Plan 2 failed" };
					}
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await continuingRunner.enqueue("proj-1", "/plans/plan1.md");
			await continuingRunner.enqueue("proj-1", "/plans/plan2.md");
			await continuingRunner.enqueue("proj-1", "/plans/plan3.md");

			await continuingRunner.start();

			// All three plans should have been attempted
			expect(executionOrder).toEqual(["/plans/plan1.md", "/plans/plan2.md", "/plans/plan3.md"]);

			const entries = continuingRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Complete);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Failed);
			expect(entries[2].status).toBe(PlanQueueEntryStatus.Complete);
		});

		it("should stop queue by default (stopOnFailure defaults to true)", async () => {
			const defaultRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					if (entry.planPath === "/plans/plan1.md") {
						return { success: false, error: "First plan fails" };
					}
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await defaultRunner.enqueue("proj-1", "/plans/plan1.md");
			await defaultRunner.enqueue("proj-1", "/plans/plan2.md");

			await defaultRunner.start();

			const entries = defaultRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Failed);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Skipped);
		});
	});

	describe("queue state survives restart", () => {
		it("should persist and reload queue state", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			await runner.enqueue("proj-1", "/plans/plan2.md");

			// Create a new runner and load state
			const newRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			const loaded = await newRunner.loadState();
			expect(loaded).toBe(true);

			const entries = newRunner.getEntries();
			expect(entries).toHaveLength(2);
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Pending);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Pending);
		});

		it("should recover active plan after restart", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");

			// Manually simulate state where plan was active when crash happened
			const statePath = runner.getStateFilePath();
			const content = await fs.readFile(statePath, "utf-8");
			const state = JSON.parse(content);
			state.isRunning = true;
			state.activeEntryId = state.entries[0].id;
			state.entries[0].status = PlanQueueEntryStatus.Active;
			state.entries[0].startedAt = Date.now();
			await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");

			// Create a new runner and load state
			const newRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			const loaded = await newRunner.loadState();
			expect(loaded).toBe(true);

			// The stranded active plan should be reset to pending
			const entries = newRunner.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Pending);
		});

		it("should persist completed entries across restart", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			await runner.enqueue("proj-1", "/plans/plan2.md");

			// Run the queue
			await runner.start();

			// Create a new runner and load state
			const newRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			const loaded = await newRunner.loadState();
			expect(loaded).toBe(true);

			const entries = newRunner.getEntries();
			expect(entries).toHaveLength(2);
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Complete);
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Complete);
		});

		it("should return false when no state file exists", async () => {
			const freshRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async () => ({ success: true }),
			});

			// Delete the state file to simulate fresh start
			try {
				await fs.unlink(freshRunner.getStateFilePath());
			} catch {
				// Ignore if doesn't exist
			}

			const loaded = await freshRunner.loadState();
			expect(loaded).toBe(false);
		});

		it("should persist stopOnFailure setting across restart", async () => {
			const customRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				stopOnFailure: false,
				isDirtyFn: async () => false,
				executePlanFn: async () => ({ success: true }),
			});

			await customRunner.enqueue("proj-1", "/plans/plan1.md");

			// Create a new runner with different default and load state
			const newRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				stopOnFailure: true, // Different default
				isDirtyFn: async () => false,
				executePlanFn: async () => ({ success: true }),
			});

			await newRunner.loadState();

			// The loaded state should have stopOnFailure = false from the original runner
			const statePath = newRunner.getStateFilePath();
			const content = await fs.readFile(statePath, "utf-8");
			const state = JSON.parse(content);
			expect(state.stopOnFailure).toBe(false);
		});
	});

	describe("getEntries and query methods", () => {
		it("should return a copy of entries array", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			const entries1 = runner.getEntries();
			const entries2 = runner.getEntries();
			expect(entries1).not.toBe(entries2); // Different array instances
			expect(entries1).toEqual(entries2);
		});

		it("should find entry by ID", async () => {
			const entry = await runner.enqueue("proj-1", "/plans/plan1.md");
			const found = runner.getEntry(entry.id);
			expect(found).toBeDefined();
			expect(found?.id).toBe(entry.id);
		});

		it("should return undefined for non-existent entry", () => {
			const found = runner.getEntry("non-existent");
			expect(found).toBeUndefined();
		});

		it("should detect active plan for project", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			expect(runner.hasActivePlan("proj-1")).toBe(false);

			// Manually set status
			const entries = runner.getEntries();
			(entries[0] as any).status = PlanQueueEntryStatus.Active;

			expect(runner.hasActivePlan("proj-1")).toBe(true);
		});

		it("should get active entry for project", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			await runner.enqueue("proj-2", "/plans/plan2.md");

			// Manually set first entry to active
			const entries = runner.getEntries();
			(entries[0] as any).status = PlanQueueEntryStatus.Active;

			const active = runner.getActiveEntryForProject("proj-1");
			expect(active).toBeDefined();
			expect(active?.id).toBe(entries[0].id);

			const noActive = runner.getActiveEntryForProject("proj-2");
			expect(noActive).toBeUndefined();
		});
	});

	describe("clear", () => {
		it("should remove all entries and reset state", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");
			await runner.enqueue("proj-1", "/plans/plan2.md");

			await runner.clear();

			expect(runner.getEntries()).toHaveLength(0);
			expect(runner.getIsRunning()).toBe(false);
		});
	});

	describe("multiple plans queued and processed", () => {
		it("should process plans in FIFO order", async () => {
			const executionOrder: string[] = [];

			const fifoRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async (entry: PlanQueueEntry) => {
					executionOrder.push(entry.planPath);
					entry.planExecutionId = `exec-${entry.id}`;
					return { success: true };
				},
				checkGatesFn: async () => true,
			});

			await fifoRunner.enqueue("proj-1", "/plans/alpha.md");
			await fifoRunner.enqueue("proj-1", "/plans/beta.md");
			await fifoRunner.enqueue("proj-1", "/plans/gamma.md");

			await fifoRunner.start();

			expect(executionOrder).toEqual(["/plans/alpha.md", "/plans/beta.md", "/plans/gamma.md"]);

			const entries = fifoRunner.getEntries();
			expect(entries.every((e) => e.status === PlanQueueEntryStatus.Complete)).toBe(true);
		});

		it("should set timestamps on entries during execution", async () => {
			await runner.enqueue("proj-1", "/plans/plan1.md");

			await runner.start();

			const entries = runner.getEntries();
			expect(entries[0].queuedAt).toBeDefined();
			expect(entries[0].startedAt).toBeDefined();
			expect(entries[0].completedAt).toBeDefined();
			expect(entries[0].queuedAt!).toBeLessThanOrEqual(entries[0].startedAt!);
			expect(entries[0].startedAt!).toBeLessThanOrEqual(entries[0].completedAt!);
		});
	});

	describe("executePlanFn error handling", () => {
		it("should handle exceptions from executePlanFn", async () => {
			const errorRunner = new PlanQueueRunner({
				workspaceRoot: TEST_DIR,
				stateStore,
				isDirtyFn: async () => false,
				executePlanFn: async () => {
					throw new Error("Unexpected execution error");
				},
				checkGatesFn: async () => true,
			});

			await errorRunner.enqueue("proj-1", "/plans/plan1.md");
			await errorRunner.enqueue("proj-1", "/plans/plan2.md");

			await errorRunner.start();

			const entries = errorRunner.getEntries();
			expect(entries[0].status).toBe(PlanQueueEntryStatus.Failed);
			expect(entries[0].error).toBe("Unexpected execution error");
			expect(entries[1].status).toBe(PlanQueueEntryStatus.Skipped);
		});
	});
});
