/**
 * Plan Queue Runner - Multi-Plan Queue Management
 *
 * Manages a queue of plan executions per project, ensuring:
 * - Multiple plans can be queued
 * - Only one active plan per project runs at a time
 * - Next plan starts only after current plan gates pass
 * - Dirty working tree prevents next plan start
 * - Failed plan stops queue by default (configurable)
 * - Queue state survives restart (persisted to JSON)
 */

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { checkDraftGates, isDraftPlan } from "./draft-planner.js";
import type { IStateStore } from "./state-store.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

const execAsync = promisify(exec);

/**
 * Status of a plan entry in the queue.
 */
export enum PlanQueueEntryStatus {
	/** Waiting to be executed */
	Pending = "pending",
	/** Currently executing */
	Active = "active",
	/** Completed successfully */
	Complete = "complete",
	/** Failed execution */
	Failed = "failed",
	/** Blocked due to queue policy (e.g., dirty tree) */
	Blocked = "blocked",
	/** Skipped because a prior plan failed and stopOnFailure is true */
	Skipped = "skipped",
}

/**
 * A single plan entry in the queue.
 */
export interface PlanQueueEntry {
	/** Unique entry ID */
	id: string;
	/** Project this plan belongs to */
	projectId: string;
	/** Plan file path or identifier */
	planPath: string;
	/** Workspace queue (parsed plan) */
	queue?: WorkspaceQueue;
	/** Current status */
	status: PlanQueueEntryStatus;
	/** Plan execution ID (assigned when plan starts running) */
	planExecutionId?: string;
	/** Timestamp when entry was added */
	queuedAt: number;
	/** Timestamp when entry started executing */
	startedAt?: number;
	/** Timestamp when entry completed/failed */
	completedAt?: number;
	/** Error message (if failed) */
	error?: string;
	/** Reason for blocking (if blocked) */
	blockReason?: string;
	/**
	 * Agent ID of the enqueuing agent (P8.E).
	 * When set, draft gate checks use this to enforce lead agent restrictions.
	 */
	agentId?: string;
}

/**
 * Configuration for the plan queue runner.
 */
export interface PlanQueueRunnerConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** State store for plan execution */
	stateStore: IStateStore;
	/** .pi directory name (default: ".pi") */
	piDir?: string;
	/** Whether a failed plan stops the queue (default: true) */
	stopOnFailure?: boolean;
	/** Function to check if working tree is dirty (default: git check) */
	isDirtyFn?: () => Promise<boolean>;
	/** Function to check if the integration queue has unresolved entries (optional) */
	isIntegrationQueueDirtyFn?: () => Promise<boolean>;
	/** Function to execute a single plan (must be provided) */
	executePlanFn: (entry: PlanQueueEntry) => Promise<{ success: boolean; error?: string }>;
	/** Function to check if plan gates passed (default: checks execution status) */
	checkGatesFn?: (planExecutionId: string) => Promise<boolean>;
}

/**
 * Queue state persisted to disk for restart survival.
 */
export interface PlanQueueState {
	/** All entries in the queue */
	entries: PlanQueueEntry[];
	/** Whether the runner is currently processing */
	isRunning: boolean;
	/** Currently active entry ID (if any) */
	activeEntryId?: string;
	/** Configuration: stop on failure */
	stopOnFailure: boolean;
	/** Timestamp of last state save */
	savedAt: number;
}

/**
 * Plan Queue Runner
 *
 * Manages sequential execution of multiple plans per project.
 * Only one plan per project runs at a time. The queue is persisted
 * to disk so it survives process restarts.
 */
export class PlanQueueRunner {
	private workspaceRoot: string;
	private piDir: string;
	private stateStore: IStateStore;
	private stopOnFailure: boolean;
	private isDirtyFn: () => Promise<boolean>;
	private isIntegrationQueueDirtyFn?: () => Promise<boolean>;
	private executePlanFn: (entry: PlanQueueEntry) => Promise<{ success: boolean; error?: string }>;
	private checkGatesFn: (planExecutionId: string) => Promise<boolean>;
	private stateFilePath: string;

	private entries: PlanQueueEntry[] = [];
	private isRunning: boolean = false;
	private activeEntryId: string | null = null;
	private abortController: AbortController | null = null;

	/**
	 * Create a PlanQueueRunner.
	 *
	 * @param config - Runner configuration
	 */
	constructor(config: PlanQueueRunnerConfig) {
		this.workspaceRoot = config.workspaceRoot;
		this.piDir = config.piDir ?? ".pi";
		this.stateStore = config.stateStore;
		this.stopOnFailure = config.stopOnFailure ?? true;
		this.isDirtyFn = config.isDirtyFn ?? this.defaultIsDirtyFn.bind(this);
		this.isIntegrationQueueDirtyFn = config.isIntegrationQueueDirtyFn;
		this.executePlanFn = config.executePlanFn;
		this.checkGatesFn = config.checkGatesFn ?? this.defaultCheckGatesFn.bind(this);
		this.stateFilePath = path.join(this.workspaceRoot, this.piDir, "plan-queue-state.json");
	}

	// =========================================================================
	// Queue Management
	// =========================================================================

	/**
	 * Add a plan to the queue.
	 *
	 * Checks draft gates (P8.E AC3): if the queue is a draft plan and the
	 * enqueuing agent is the lead agent, the enqueue is rejected.
	 *
	 * @param projectId - Project ID
	 * @param planPath - Path to plan file
	 * @param queue - Optional parsed workspace queue
	 * @param agentId - Optional agent ID for draft gate enforcement (P8.E)
	 * @returns The created queue entry
	 * @throws Error if draft gates block the enqueue
	 */
	async enqueue(
		projectId: string,
		planPath: string,
		queue?: WorkspaceQueue,
		agentId?: string,
	): Promise<PlanQueueEntry> {
		// P8.E AC3: Check draft gate before enqueueing
		if (queue && isDraftPlan(queue) && agentId) {
			const gateResult = checkDraftGates(queue, agentId, "enqueue");
			if (!gateResult.allowed) {
				throw new Error(gateResult.reason);
			}
		}

		const entry: PlanQueueEntry = {
			id: this.generateId(),
			projectId,
			planPath,
			queue,
			status: PlanQueueEntryStatus.Pending,
			queuedAt: Date.now(),
			agentId,
		};

		this.entries.push(entry);
		await this.saveState();

		return entry;
	}

	/**
	 * Remove a plan from the queue (only if not active).
	 *
	 * @param entryId - Entry ID to remove
	 * @returns True if removed
	 */
	async dequeue(entryId: string): Promise<boolean> {
		const index = this.entries.findIndex((e) => e.id === entryId);
		if (index === -1) {
			return false;
		}

		const entry = this.entries[index];
		if (entry.status === PlanQueueEntryStatus.Active) {
			return false; // Cannot remove active plan
		}

		this.entries.splice(index, 1);
		await this.saveState();

		return true;
	}

	/**
	 * Get all entries in the queue.
	 *
	 * @returns Copy of entries array
	 */
	getEntries(): PlanQueueEntry[] {
		return [...this.entries];
	}

	/**
	 * Get entry by ID.
	 *
	 * @param entryId - Entry ID
	 * @returns Entry or undefined
	 */
	getEntry(entryId: string): PlanQueueEntry | undefined {
		return this.entries.find((e) => e.id === entryId);
	}

	/**
	 * Get entries for a specific project.
	 *
	 * @param projectId - Project ID
	 * @returns Entries for the project
	 */
	getEntriesForProject(projectId: string): PlanQueueEntry[] {
		return this.entries.filter((e) => e.projectId === projectId);
	}

	/**
	 * Get the active entry for a project.
	 *
	 * @param projectId - Project ID
	 * @returns Active entry or undefined
	 */
	getActiveEntryForProject(projectId: string): PlanQueueEntry | undefined {
		return this.entries.find((e) => e.projectId === projectId && e.status === PlanQueueEntryStatus.Active);
	}

	/**
	 * Check if a project has an active plan.
	 *
	 * @param projectId - Project ID
	 * @returns True if project has an active plan
	 */
	hasActivePlan(projectId: string): boolean {
		return this.getActiveEntryForProject(projectId) !== undefined;
	}

	// =========================================================================
	// Queue Execution
	// =========================================================================

	// =========================================================================
	// Queue Execution
	// =========================================================================

	/**
	 * Start processing the queue.
	 *
	 * Processes plans sequentially per project. Only one plan per project
	 * runs at a time. Continues until the queue is empty or a non-recoverable
	 * condition stops it (dirty tree, draft gate blocked). Failed plans do
	 * NOT stop the queue runner — remaining pending entries for the same
	 * project are skipped (when stopOnFailure is true), but the runner stays
	 * alive so that newly enqueued plans (e.g., from autonomous recovery
	 * after a failed summary) are picked up without an explicit restart.
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			return; // Already running
		}

		this.isRunning = true;
		this.abortController = new AbortController();
		await this.saveState();

		try {
			await this.processQueue();
		} finally {
			this.isRunning = false;
			this.activeEntryId = null;
			this.abortController = null;
			await this.saveState();
		}
	}

	/**
	 * Stop processing the queue.
	 *
	 * The currently active plan will finish, but no new plans will be started.
	 */
	async stop(): Promise<void> {
		if (this.abortController) {
			this.abortController.abort();
		}
		// Don't set isRunning = false here; the processQueue loop will do it
	}

	/**
	 * Check if the runner is currently processing.
	 *
	 * @returns True if running
	 */
	getIsRunning(): boolean {
		return this.isRunning;
	}

	/**
	 * Process the queue: find next ready plan and execute it.
	 *
	 * Processes plans sequentially per project. Only one plan per project
	 * runs at a time. When there are no more entries, the loop exits
	 * normally.
	 *
	 * Exit conditions:
	 * - Queue empty (no pending entries)
	 * - AbortController signal fires (explicit stop())
	 * - Dirty working tree (cannot proceed until clean)
	 * - Draft gate blocked (cannot execute until promoted)
	 *
	 * Unlike the old behavior, a failed plan with stopOnFailure=true does
	 * NOT exit the loop — remaining entries for the same project are
	 * skipped, but the runner stays alive. This allows newly enqueued
	 * plans (e.g., autonomous recovery after a failed summary) to be
	 * picked up on the next call to start().
	 */
	private async processQueue(): Promise<void> {
		while (!this.abortController?.signal.aborted) {
			// Find next eligible entry
			const next = this.findNextEligibleEntry();
			if (!next) {
				break; // No more plans to run
			}

			// Mark as active
			next.status = PlanQueueEntryStatus.Active;
			next.startedAt = Date.now();
			this.activeEntryId = next.id;
			await this.saveState();

			// Check for dirty working tree
			const isDirty = await this.isDirtyFn();
			if (isDirty) {
				next.status = PlanQueueEntryStatus.Blocked;
				next.blockReason = "Dirty working tree: uncommitted changes detected";
				next.completedAt = Date.now();
				this.activeEntryId = null;
				await this.saveState();

				// Dirty tree stops the queue — we cannot proceed until the tree is clean
				break;
			}

			// P6.C AC: Check integration queue — do not start next plan until it is clean
			if (this.isIntegrationQueueDirtyFn) {
				const isIntegrationDirty = await this.isIntegrationQueueDirtyFn();
				if (isIntegrationDirty) {
					next.status = PlanQueueEntryStatus.Blocked;
					next.blockReason =
						"Integration queue has unresolved entries: existing plan integration not yet complete";
					next.completedAt = Date.now();
					this.activeEntryId = null;
					await this.saveState();

					// Integration queue not clean stops the queue
					break;
				}
			}

			// P8.E AC2: Check draft execution gate before executing
			if (next.queue && isDraftPlan(next.queue)) {
				const gateResult = checkDraftGates(next.queue, next.agentId ?? "unknown", "execute");
				if (!gateResult.allowed) {
					next.status = PlanQueueEntryStatus.Blocked;
					next.blockReason = gateResult.reason;
					next.completedAt = Date.now();
					this.activeEntryId = null;
					await this.saveState();

					// Draft plan blocking stops the queue — the draft must be promoted first
					break;
				}
			}

			// Execute the plan
			try {
				const result = await this.executePlanFn(next);

				if (result.success) {
					// Check gates (if planExecutionId was assigned)
					if (next.planExecutionId) {
						const gatesPassed = await this.checkGatesFn(next.planExecutionId);
						if (!gatesPassed) {
							next.status = PlanQueueEntryStatus.Failed;
							next.error = "Post-execution gates did not pass";
							next.completedAt = Date.now();
							this.activeEntryId = null;
							await this.saveState();

							if (this.stopOnFailure) {
								// Mark remaining pending entries as skipped
								await this.skipRemainingEntries(next.projectId, "Prior plan gates failed");
								break;
							}
							continue;
						}
					}

					next.status = PlanQueueEntryStatus.Complete;
					next.completedAt = Date.now();
				} else {
					next.status = PlanQueueEntryStatus.Failed;
					next.error = result.error ?? "Plan execution failed";
					next.completedAt = Date.now();
				}
			} catch (error) {
				next.status = PlanQueueEntryStatus.Failed;
				next.error = error instanceof Error ? error.message : String(error);
				next.completedAt = Date.now();
			}

			this.activeEntryId = null;
			await this.saveState();

			// If the plan failed and stopOnFailure is enabled, skip remaining
			// pending entries for this project. Unlike the old behavior, do NOT
			// break the queue loop — the runner exits naturally when no more
			// entries remain. The caller (e.g., autonomous recovery loop) can
			// enqueue and call start() again to process the next plan.
			if (next.status === PlanQueueEntryStatus.Failed && this.stopOnFailure) {
				await this.skipRemainingEntries(next.projectId, "Prior plan failed");
				// Fall through — the while loop will iterate again, find no more
				// pending entries, and break normally.
			}
		}
	}

	/**
	 * Find the next eligible entry to execute.
	 *
	 * An entry is eligible if:
	 * - It is pending
	 * - No other entry with the same projectId is active
	 *
	 * @returns Next eligible entry or undefined
	 */
	private findNextEligibleEntry(): PlanQueueEntry | undefined {
		// Get set of project IDs that currently have active plans
		const activeProjectIds = new Set(
			this.entries.filter((e) => e.status === PlanQueueEntryStatus.Active).map((e) => e.projectId),
		);

		// Find first pending entry whose project doesn't have an active plan
		return this.entries.find((e) => e.status === PlanQueueEntryStatus.Pending && !activeProjectIds.has(e.projectId));
	}

	/**
	 * Mark all remaining pending entries for a project as skipped.
	 *
	 * @param projectId - Project ID
	 * @param reason - Reason for skipping
	 */
	private async skipRemainingEntries(projectId: string, reason: string): Promise<void> {
		for (const entry of this.entries) {
			if (entry.projectId === projectId && entry.status === PlanQueueEntryStatus.Pending) {
				entry.status = PlanQueueEntryStatus.Skipped;
				entry.blockReason = reason;
				entry.completedAt = Date.now();
			}
		}
		await this.saveState();
	}

	// =========================================================================
	// Persistence
	// =========================================================================

	/**
	 * Save queue state to disk for restart survival.
	 */
	async saveState(): Promise<void> {
		const state: PlanQueueState = {
			entries: this.entries,
			isRunning: this.isRunning,
			activeEntryId: this.activeEntryId ?? undefined,
			stopOnFailure: this.stopOnFailure,
			savedAt: Date.now(),
		};

		const dir = path.dirname(this.stateFilePath);
		await fs.mkdir(dir, { recursive: true });

		const tempPath = `${this.stateFilePath}.tmp`;
		await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
		await fs.rename(tempPath, this.stateFilePath);
	}

	/**
	 * Load queue state from disk.
	 *
	 * Call this on startup to restore the queue after a restart.
	 *
	 * @returns True if state was loaded
	 */
	async loadState(): Promise<boolean> {
		try {
			const content = await fs.readFile(this.stateFilePath, "utf-8");
			const state: PlanQueueState = JSON.parse(content);

			this.entries = state.entries;
			this.stopOnFailure = state.stopOnFailure;

			// If we were running, we need to handle the potentially stranded active entry
			if (state.isRunning && state.activeEntryId) {
				const activeEntry = this.entries.find((e) => e.id === state.activeEntryId);
				if (activeEntry && activeEntry.status === PlanQueueEntryStatus.Active) {
					// Reset the stranded active entry back to pending
					activeEntry.status = PlanQueueEntryStatus.Pending;
					activeEntry.startedAt = undefined;
					activeEntry.error = undefined;
				}
				this.isRunning = false;
				this.activeEntryId = null;
			} else {
				this.isRunning = false;
				this.activeEntryId = null;
			}

			await this.saveState(); // Persist the cleaned-up state
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return false; // No saved state
			}
			throw error;
		}
	}

	/**
	 * Get the path to the queue state file.
	 *
	 * @returns State file path
	 */
	getStateFilePath(): string {
		return this.stateFilePath;
	}

	// =========================================================================
	// Default Implementations
	// =========================================================================

	/**
	 * Check if the working tree is dirty using git.
	 *
	 * @returns True if there are uncommitted changes
	 */
	private async defaultIsDirtyFn(): Promise<boolean> {
		try {
			const { stdout } = await execAsync("git status --porcelain", {
				cwd: this.workspaceRoot,
			});
			return stdout.trim().length > 0;
		} catch {
			// If git fails, assume dirty (safe default)
			return true;
		}
	}

	/**
	 * Default gate check: verifies that the plan completed successfully
	 * via the state store.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns True if gates passed
	 */
	private async defaultCheckGatesFn(planExecutionId: string): Promise<boolean> {
		try {
			const stats = await this.stateStore.getStatistics(planExecutionId);
			if (!stats) {
				return false;
			}
			// All workspaces must be complete (no failed, no blocked, no pending)
			return (
				stats.failed === 0 &&
				stats.blocked === 0 &&
				stats.pending === 0 &&
				stats.total > 0 &&
				stats.complete === stats.total
			);
		} catch {
			return false;
		}
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Generate a unique ID for a queue entry.
	 *
	 * @returns Unique ID string
	 */
	private generateId(): string {
		return `pqr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	}

	/**
	 * Clear all entries and reset state.
	 */
	async clear(): Promise<void> {
		this.entries = [];
		this.isRunning = false;
		this.activeEntryId = null;
		await this.saveState();
	}
}

/**
 * Create a PlanQueueRunner instance.
 *
 * @param config - Runner configuration
 * @returns PlanQueueRunner instance
 */
export function createPlanQueueRunner(config: PlanQueueRunnerConfig): PlanQueueRunner {
	return new PlanQueueRunner(config);
}
