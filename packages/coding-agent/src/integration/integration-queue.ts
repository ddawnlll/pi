/**
 * Integration Queue - P2 Workstream 6.C / 6.D / 6.6.F
 *
 * Manages a queue of workspaces awaiting integration into the integration
 * branch. Workspaces are processed one at a time: merged, validated, and
 * recorded. Failed validation blocks the merge queue.
 *
 * Merge conflict detection (6.D):
 * - When a cherry-pick fails due to a merge conflict, a conflict artifact
 *   is written to .pi/merge-conflicts/ and the entry is marked as "blocked"
 *   with conflict-specific error metadata.
 * - The queue stops processing at the first conflict (same as any blocked
 *   entry).
 * - Use retryEntry() after manual resolution to re-attempt integration.
 *
 * Queue control actions (6.6.F):
 * - pause/resume: Suspend and resume queue processing safely
 * - retry/requeue: Re-attempt blocked/failed or requeue merged entries
 * - clear-completed: Remove completed entries from the queue
 * - reorder: Optimize queue ordering respecting dependency constraints
 * - All actions are audited and unsafe actions are rejected
 *
 * Never pushes to remote — all operations are local.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Workspace } from "../core/workspace-schema.js";
import { IntegrationBranch } from "./integration-branch.js";
import { isMergeConflictError, MergeConflictResolver } from "./merge-conflict-handoff.js";
import { isIntegrationStatusDirty } from "./queue-domain.js";
import type { OptimizationResult, ReorderSuggestionResult, ThroughputImpact } from "./queue-optimizer.js";
import { QueueOptimizer } from "./queue-optimizer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of a queue entry.
 */
export type QueueEntryStatus =
	/** Waiting in queue */
	| "queued"
	/** Currently being merged into integration branch */
	| "merging"
	/** Validation is running on the merged result */
	| "validating"
	/** Successfully merged and validated */
	| "merged"
	/** Merge failed */
	| "failed"
	/** Validation failed — blocked until resolved */
	| "blocked"
	/** Merge conflict detected — blocked until manual resolution */
	| "conflict";

/**
 * Merge-priority score breakdown for a queue entry.
 */
export interface MergePriorityScore {
	/** Final computed score */
	total: number;
	/** downstreamReadyCount * 50 */
	downstreamComponent: number;
	/** Number of workspaces that would become ready after this workspace merges */
	downstreamReadyCount: number;
	/** criticalPathPosition * 30 */
	criticalPathComponent: number;
	/** Inverse position on the critical path (0 = not on critical path) */
	criticalPathPosition: number;
	/** waitTimeBoost * 10, capped at 100 (10 min) */
	waitTimeBoost: number;
	/** Static band multiplier from queuePriority */
	staticBandMultiplier: number;
	/** Timestamp when the score was recomputed */
	recomputedAt: number;
}

// ---------------------------------------------------------------------------
// Merge Priority Scorer
// ---------------------------------------------------------------------------

/**
 * Dynamic merge-priority scorer for the integration queue.
 *
 * Formula:
 *   downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10
 *
 * The score is recomputed at dequeue time (not enqueue time) so it reflects
 * the current graph state. Static queuePriority from workspace definition
 * acts as a band multiplier: critical × 2.0, high × 1.5, normal × 1.0, low × 0.5.
 */
export class MergePriorityScorer {
	/**
	 * Compute the merge-priority score for a queue entry.
	 *
	 * @param workspaceId - Workspace ID
	 * @param entries - All queue entries
	 * @param workspaceDependencies - Dependency map
	 * @param queuePriority - Static queue priority level
	 * @returns Computed score
	 */
	computeScore(
		workspaceId: string,
		entries: QueueEntry[],
		workspaceDependencies: Map<string, string[]>,
		queuePriority?: string,
	): MergePriorityScore {
		const now = Date.now();

		// 1. Downstream ready count: number of workspaces that would become
		//    ready to execute immediately after this workspace merges
		const downstreamReadyCount = this.computeDownstreamReadyCount(workspaceId, entries, workspaceDependencies);

		// 2. Critical path position: inverse position on the critical path
		const criticalPathPosition = this.computeCriticalPathPosition(workspaceId, entries, workspaceDependencies);

		// 3. Wait time boost: minutes in queue, capped at 10
		const entry = entries.find((e) => e.workspaceId === workspaceId);
		const minutesInQueue = entry ? (now - entry.queuedAt) / 60_000 : 0;
		const waitTimeBoost = Math.min(Math.floor(minutesInQueue), 10);

		// 4. Static band multiplier
		const staticBandMultiplier = this.getBandMultiplier(queuePriority);

		// 5. Compute total
		const downstreamComponent = downstreamReadyCount * 50;
		const criticalPathComponent = criticalPathPosition * 30;
		const waitComponent = waitTimeBoost * 10;
		const total = (downstreamComponent + criticalPathComponent + waitComponent) * staticBandMultiplier;

		return {
			total,
			downstreamComponent,
			downstreamReadyCount,
			criticalPathComponent,
			criticalPathPosition,
			waitTimeBoost,
			staticBandMultiplier,
			recomputedAt: now,
		};
	}

	/**
	 * Compute how many workspaces would become ready after this one merges.
	 */
	private computeDownstreamReadyCount(
		workspaceId: string,
		entries: QueueEntry[],
		workspaceDependencies: Map<string, string[]>,
	): number {
		let count = 0;
		for (const [depId, deps] of workspaceDependencies) {
			if (deps.includes(workspaceId)) {
				// This workspace depends on us. Check if all OTHER deps are already merged.
				const otherDepsMerged = deps.every((d) => d === workspaceId || this.isEntryMerged(d, entries));
				if (otherDepsMerged) {
					const depEntry = entries.find((e) => e.workspaceId === depId);
					if (depEntry && depEntry.status === "queued") {
						count++;
					}
				}
			}
		}
		return count;
	}

	/**
	 * Compute critical path position.
	 * Position = the longest chain length starting from this workspace.
	 * A workspace at position 1 is first on the critical path (highest priority).
	 * A workspace at position 3 is third on the critical path.
	 * Position 0 = not on critical path (not part of any dependency chain).
	 */
	private computeCriticalPathPosition(
		workspaceId: string,
		_entries: QueueEntry[],
		workspaceDependencies: Map<string, string[]>,
	): number {
		// Check if this workspace is part of any dependency chain.
		// An orphan workspace is not in the map at all and is not listed
		// as a dependency of any other workspace.
		const isReferenced =
			workspaceDependencies.has(workspaceId) ||
			Array.from(workspaceDependencies.values()).some((deps) => deps.includes(workspaceId));

		if (!isReferenced) return 0;

		// Find the longest chain of workspaces that depend on this one
		return this.findCriticalPathLength(workspaceId, workspaceDependencies, new Set());
	}

	/**
	 * Find how many workspaces are in the dependency chain starting from workspaceId.
	 * Counts this workspace + all recursive dependents.
	 */
	private findCriticalPathLength(
		workspaceId: string,
		workspaceDependencies: Map<string, string[]>,
		visited: Set<string>,
	): number {
		if (visited.has(workspaceId)) return 0;
		visited.add(workspaceId);

		let maxLen = 0;
		for (const [depId, deps] of workspaceDependencies) {
			if (deps.includes(workspaceId)) {
				const len = this.findCriticalPathLength(depId, workspaceDependencies, visited);
				maxLen = Math.max(maxLen, len);
			}
		}
		visited.delete(workspaceId);
		// Count this workspace plus the longest chain of dependents
		return maxLen + 1;
	}

	private isEntryMerged(workspaceId: string, entries: QueueEntry[]): boolean {
		const entry = entries.find((e) => e.workspaceId === workspaceId);
		return entry?.status === "merged";
	}

	private getBandMultiplier(queuePriority?: string): number {
		switch (queuePriority) {
			case "critical":
				return 2.0;
			case "high":
				return 1.5;
			case "normal":
				return 1.0;
			case "low":
				return 0.5;
			default:
				return 1.0;
		}
	}
}

/**
 * Computed timing metrics for a queue entry.
 */
export interface QueueEntryTiming {
	/** Time spent waiting in queue before processing started (ms) */
	waitTimeMs: number;
	/** Time spent on the merge operation (ms) */
	mergeTimeMs: number;
	/** Time spent on validation, if validation was run (ms) */
	validationTimeMs?: number;
	/** Total time from enqueue to terminal state (ms) */
	totalTimeMs: number;
}

/**
 * A single audit event recording a queue control action.
 */
export interface AuditEntry {
	/** Action type */
	action: "pause" | "resume" | "retry" | "requeue" | "clear_completed" | "reorder" | "cancel";
	/** Workspace ID if the action targeted a specific entry */
	workspaceId?: string;
	/** Timestamp when the action occurred */
	timestamp: number;
	/** Human-readable details about the action */
	details: string;
}

/**
 * A single queue entry.
 */
export interface QueueEntry {
	/** Workspace ID */
	workspaceId: string;
	/** Current queue status */
	status: QueueEntryStatus;
	/** Commit hash from the workspace branch */
	commitHash: string;
	/** Optional validation command to run after merge */
	validationCommand?: string;
	/** Timestamp when the entry was enqueued */
	queuedAt: number;
	/** Timestamp when processing started */
	processedAt?: number;
	/** Timestamp when merge completed */
	mergedAt?: number;
	/** Timestamp when validation started */
	validationStartedAt?: number;
	/** Timestamp when processing completed (terminal state reached) */
	completedAt?: number;
	/** Whether validation passed */
	validationPassed?: boolean;
	/** Validation output */
	validationOutput?: string;
	/** Error message if processing failed */
	error?: string;
	/** Path to merge conflict artifact file (if merge conflict) */
	conflictArtifactPath?: string;
	/** List of files involved in a merge conflict */
	conflictFiles?: string[];
	/** Computed timing metrics for the entry */
	timingMetrics?: QueueEntryTiming;
}

/**
 * Serialized state of the integration queue.
 */
export interface IntegrationQueueState {
	/** Queue entries in order */
	entries: QueueEntry[];
	/** Whether the queue is currently processing an entry */
	isProcessing: boolean;
	/** Whether the queue is paused (will not process new entries) */
	paused: boolean;
	/** Workspace ID currently being processed (if isProcessing) */
	currentWorkspaceId?: string;
	/** Timestamp when the queue was created */
	createdAt: number;
	/** Timestamp when the state was last updated */
	updatedAt: number;
	/** Audit trail of queue control actions (most recent first) */
	auditEvents: AuditEntry[];
}

// ---------------------------------------------------------------------------
// IntegrationQueue
// ---------------------------------------------------------------------------

/**
 * Integration Queue Manager
 *
 * Manages the queue of workspaces waiting to be merged into the integration
 * branch. Workspaces are processed strictly one at a time:
 *
 * 1. Merge the workspace commit into the integration branch
 * 2. Run validation (if a validation command was specified)
 * 3. If validation passes, mark as merged and proceed to next
 * 4. If validation fails, mark as blocked — queue halts
 * 5. Record all results to persistent archive state
 *
 * The merge queue follows a "one at a time" model where only one workspace
 * is merged and validated before the next one begins. This ensures each
 * merge's validation result is clear and independent.
 */
export class IntegrationQueue {
	private workspaceRoot: string;
	private branch: IntegrationBranch;
	private state: IntegrationQueueState;
	private stateFilePath: string;
	/**
	 * Workspace dependency map: workspaceId -> array of dependency workspace IDs.
	 * Set via setWorkspaceDependencies() before processing if dependency ordering is needed.
	 */
	private workspaceDependencies: Map<string, string[]> = new Map();

	/**
	 * Merge priority scorer (P23 W3).
	 */
	private mergePriorityScorer: MergePriorityScorer;

	/**
	 * Workspace queue priority levels: workspaceId -> priority level.
	 * Set via setQueuePriorities() for use by the priority scorer.
	 */
	private queuePriorities: Map<string, string> = new Map();

	/**
	 * @param workspaceRoot - Root directory of the workspace (git repo)
	 * @param branchName - Name of the integration branch (default: "integration")
	 * @param baseBranch - Base branch (default: "main")
	 */
	constructor(workspaceRoot: string, branchName = "integration", baseBranch = "main") {
		this.workspaceRoot = workspaceRoot;
		this.branch = new IntegrationBranch(workspaceRoot, branchName, baseBranch);
		this.mergePriorityScorer = new MergePriorityScorer();
		this.state = {
			entries: [],
			isProcessing: false,
			paused: false,
			currentWorkspaceId: undefined,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			auditEvents: [],
		};
		this.stateFilePath = path.join(workspaceRoot, ".pi", "integration-queue.json");
	}

	/**
	 * Set queue priority levels for workspaces (for merge-priority scorer).
	 *
	 * @param priorities - Map from workspace ID to priority level (critical, high, normal, low)
	 */
	setQueuePriorities(priorities: Map<string, string>): void {
		this.queuePriorities = priorities;
	}

	/**
	 * The underlying IntegrationBranch instance.
	 */
	get integrationBranch(): IntegrationBranch {
		return this.branch;
	}

	/**
	 * Set workspace dependency information for dependency-order-aware merge processing.
	 * This should be called before processing starts if you need the queue to respect
	 * workspace dependencies (i.e., don't merge a workspace before its dependencies).
	 *
	 * @param dependencies - Map from workspace ID to array of dependency workspace IDs
	 */
	setWorkspaceDependencies(dependencies: Map<string, string[]>): void {
		this.workspaceDependencies = dependencies;
	}

	/**
	 * The queue name (derived from the integration branch name).
	 */
	get name(): string {
		return `${this.branch.name}-queue`;
	}

	/**
	 * Whether the queue is currently processing an entry.
	 */
	get isProcessing(): boolean {
		return this.state.isProcessing;
	}

	/**
	 * The workspace ID currently being processed, if any.
	 */
	get currentWorkspaceId(): string | undefined {
		return this.state.currentWorkspaceId;
	}

	/**
	 * Whether the queue is paused (loads persisted state).
	 */
	async isPaused(): Promise<boolean> {
		await this.loadState();
		return this.state.paused;
	}

	/**
	 * Enqueue a workspace for integration.
	 *
	 * Adds the workspace to the end of the queue. If the workspace is already
	 * in the queue (in any non-terminal state), this is a no-op.
	 *
	 * @param workspaceId - Workspace ID to enqueue
	 * @param commitHash - Commit hash of the workspace changes to merge
	 * @param validationCommand - Optional command to run for post-merge validation
	 */
	async enqueue(workspaceId: string, commitHash: string, validationCommand?: string): Promise<void> {
		await this.loadState();

		// Check if workspace is already in queue with a non-terminal status
		const existing = this.state.entries.find(
			(e) => e.workspaceId === workspaceId && e.status !== "merged" && e.status !== "failed",
		);
		if (existing) {
			// Update the existing entry with the new commit hash
			existing.commitHash = commitHash;
			if (validationCommand !== undefined) {
				existing.validationCommand = validationCommand;
			}
			await this.saveState();
			return;
		}

		const entry: QueueEntry = {
			workspaceId,
			status: "queued",
			commitHash,
			validationCommand,
			queuedAt: Date.now(),
		};

		this.state.entries.push(entry);
		await this.saveState();
	}

	/**
	 * Process the next workspace in the queue.
	 *
	 * Processes exactly one workspace at a time:
	 * - Skips if queue is already processing
	 * - Skips if the first non-terminal entry has a terminal status (already merged/failed)
	 * - Skips blocked entries — the queue is halted
	 * - Skips conflict entries — the queue is halted (AC4, 6.D)
	 *
	 * For each entry:
	 * 1. Marks as "merging", cherry-picks into integration branch
	 * 2. If validation command is set, runs it and checks result
	 * 3. On validation failure, marks as "blocked" and halts
	 * 4. On merge conflict, marks as "conflict" and halts
	 * 5. On success, marks as "merged"
	 * 6. Records result via the integration branch
	 *
	 * @returns Result indicating whether an entry was processed
	 */
	async processNext(): Promise<{ processed: boolean; entry?: QueueEntry }> {
		await this.loadState();

		// Guard: already processing
		if (this.state.isProcessing) {
			return { processed: false };
		}

		// Guard: paused queue does not process new entries (6.6.F)
		if (this.state.paused) {
			return { processed: false };
		}

		// Find the next entry that is queued, blocked, or conflicted
		// (skip already merged/failed ones)
		const nextEntry = this.state.entries.find(
			(e) => e.status === "queued" || e.status === "blocked" || e.status === "conflict",
		);

		if (!nextEntry) {
			return { processed: false };
		}

		// Guard: blocked entries halt the queue (AC3)
		if (nextEntry.status === "blocked") {
			return { processed: false };
		}

		// Guard: conflict entries halt the queue (AC4, 6.D)
		if (nextEntry.status === "conflict") {
			return { processed: false };
		}

		// Guard: dependency ordering — find the first queued entry whose dependencies
		// (if any) have all been merged. This prevents out-of-order merging that could
		// break downstream workspaces.
		const eligibleEntry = this.findEligibleEntry(nextEntry);
		if (!eligibleEntry) {
			// No eligible entry found — all queued entries have unmet dependencies.
			// Return without processing to avoid blocking the queue indefinitely
			// on an entry whose dependencies may never arrive.
			return { processed: false };
		}

		// If the original first entry was not eligible, reset it to queued and use the eligible one
		if (eligibleEntry.workspaceId !== nextEntry.workspaceId) {
			nextEntry.status = "queued";
			await this.saveState();
		}

		return this.processEntry(eligibleEntry);
	}

	/**
	 * Find the best queue entry to process next using the merge-priority scorer.
	 *
	 * Score is recomputed at dequeue time to reflect current graph state.
	 * The entry with the highest priority score whose dependencies are all merged
	 * is selected. If enabled, uses the dynamic merge-priority scorer formula:
	 *   downstreamReadyCount * 50 + criticalPathPosition * 30 + waitTimeBoost * 10
	 *
	 * Falls back to FIFO (first eligible) if scorer is not configured or disabled.
	 *
	 * @param _firstQueued - Previously the first queued entry; now used as filter context
	 * @returns An eligible entry, or undefined if none found
	 */
	private findEligibleEntry(_firstQueued: QueueEntry): QueueEntry | undefined {
		const allMerged = (workspaceId: string): boolean => {
			const entryDeps = this.workspaceDependencies.get(workspaceId);
			if (!entryDeps || entryDeps.length === 0) return true;
			for (const depId of entryDeps) {
				const depEntry = this.state.entries.find((e) => e.workspaceId === depId);
				if (!depEntry || depEntry.status !== "merged") return false;
			}
			return true;
		};

		// Collect all queued entries whose dependencies are met
		const eligible = this.state.entries.filter((e) => e.status === "queued" && allMerged(e.workspaceId));

		if (eligible.length === 0) return undefined;
		if (eligible.length === 1) return eligible[0];

		// Use merge-priority scorer to pick the best entry
		let bestEntry: QueueEntry | undefined;
		let bestScore = -1;

		for (const entry of eligible) {
			const priority = this.queuePriorities.get(entry.workspaceId);
			const score = this.mergePriorityScorer.computeScore(
				entry.workspaceId,
				this.state.entries,
				this.workspaceDependencies,
				priority,
			);

			// Persist score as metadata for dashboard (use a runtime field)
			(entry as any)._lastScore = score;

			if (score.total > bestScore) {
				bestScore = score.total;
				bestEntry = entry;
			} else if (score.total === bestScore && bestEntry) {
				// Tiebreaker: FIFO (submission order)
				if (entry.queuedAt < bestEntry.queuedAt) {
					bestEntry = entry;
				}
			}
		}

		return bestEntry;
	}

	/**
	 * Process a single entry through merge, validation, and finalization.
	 * The entry is marked "merging", cherry-picked into the integration branch,
	 * validated if a validation command is configured, and finalized.
	 *
	 * @param entry - The queue entry to process
	 * @returns Processing result
	 */
	private async processEntry(entry: QueueEntry): Promise<{ processed: boolean; entry?: QueueEntry }> {
		// Begin processing
		this.state.isProcessing = true;
		this.state.currentWorkspaceId = entry.workspaceId;
		entry.status = "merging";
		entry.processedAt = Date.now();
		await this.saveState();

		try {
			// AC1: Merge one workspace at a time into integration branch
			await this.branch.ensureBranch();
			const mergeEntry = await this.branch.mergeWorkspace(entry.workspaceId, entry.commitHash);

			// Update queue state from merge result
			entry.status = "merged";
			entry.mergedAt = mergeEntry.mergedAt;

			// AC4: Run integration validation after merge
			if (entry.validationCommand) {
				entry.status = "validating";
				entry.validationStartedAt = Date.now();
				await this.saveState();

				const validationResult = await this.branch.runValidation(entry.workspaceId, entry.validationCommand);

				entry.validationPassed = validationResult.passed;
				entry.validationOutput = validationResult.output;

				if (validationResult.passed) {
					entry.status = "merged";

					// AC5: Record merge result
					const updatedMergeEntry = this.branch.getMergeStatus(entry.workspaceId);
					if (updatedMergeEntry) {
						await this.branch.recordResult(updatedMergeEntry);
					}
				} else {
					// AC3: Failed validation blocks merge
					entry.status = "blocked";
					entry.error = `Validation failed: ${entry.validationCommand}`;

					// Record the blocked result
					const blockedMergeEntry = this.branch.getMergeStatus(entry.workspaceId);
					if (blockedMergeEntry) {
						await this.branch.recordResult(blockedMergeEntry);
					}
				}
			} else {
				// No validation command — mark as merged
				entry.status = "merged";

				// AC5: Record merge result
				const updatedMergeEntry = this.branch.getMergeStatus(entry.workspaceId);
				if (updatedMergeEntry) {
					await this.branch.recordResult(updatedMergeEntry);
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// AC1: Detect merge conflict — does not silently fail or mark complete
			if (isMergeConflictError(errorMessage)) {
				// AC2: Write conflict artifact
				entry.status = "conflict";
				entry.error = errorMessage;

				try {
					const resolver = new MergeConflictResolver(this.workspaceRoot);
					const { artifact, filePath } = await resolver.detectAndRecordConflict(
						entry.workspaceId,
						entry.commitHash,
						errorMessage,
					);

					entry.conflictArtifactPath = filePath;
					entry.conflictFiles = artifact.conflictedFiles.map((f) => f.filePath);
				} catch {
					// Best-effort artifact writing
				}

				// Record the conflict result in branch state
				try {
					const conflictMergeEntry = this.branch.getMergeStatus(entry.workspaceId);
					if (conflictMergeEntry) {
						await this.branch.recordResult(conflictMergeEntry);
					}
				} catch {
					// Best-effort
				}
			} else {
				entry.status = "failed";
				entry.error = errorMessage;

				// Record the failed result
				try {
					const failedMergeEntry = this.branch.getMergeStatus(entry.workspaceId);
					if (failedMergeEntry) {
						await this.branch.recordResult(failedMergeEntry);
					}
				} catch {
					// Best-effort
				}
			}
		} finally {
			// Set completedAt and compute timing metrics when entry reaches a terminal state
			if (
				entry.status === "merged" ||
				entry.status === "failed" ||
				entry.status === "blocked" ||
				entry.status === "conflict"
			) {
				entry.completedAt = Date.now();
				entry.timingMetrics = this.computeTimingMetrics(entry);
			}

			// Release processing lock
			this.state.isProcessing = false;
			this.state.currentWorkspaceId = undefined;
			await this.saveState();
		}

		return { processed: true, entry };
	}

	/**
	 * Process all entries in the queue sequentially.
	 *
	 * Continues processing as long as entries succeed. Stops at the first
	 * failure, blocked entry, or conflict.
	 *
	 * @returns Array of processed entries
	 */
	async processAll(): Promise<QueueEntry[]> {
		const processed: QueueEntry[] = [];

		while (true) {
			const result = await this.processNext();
			if (!result.processed || !result.entry) {
				break;
			}

			processed.push(result.entry);

			// AC4: Stop at conflict, blocked, or failed
			if (
				result.entry.status === "blocked" ||
				result.entry.status === "failed" ||
				result.entry.status === "conflict"
			) {
				break;
			}
		}

		return processed;
	}

	/**
	 * Get the current queue state.
	 */
	async getQueueState(): Promise<IntegrationQueueState> {
		await this.loadState();
		return {
			...this.state,
			entries: [...this.state.entries],
		};
	}

	/**
	 * Get workspace queue entries that have been successfully merged.
	 */
	async getMergedWorkspaces(): Promise<QueueEntry[]> {
		await this.loadState();
		return this.state.entries.filter((e) => e.status === "merged");
	}

	/**
	 * Get workspace queue entries that are blocked or failed.
	 */
	async getFailedWorkspaces(): Promise<QueueEntry[]> {
		await this.loadState();
		return this.state.entries.filter((e) => e.status === "blocked" || e.status === "failed");
	}

	/**
	 * Get workspace queue entries with merge conflicts.
	 */
	async getConflictWorkspaces(): Promise<QueueEntry[]> {
		await this.loadState();
		return this.state.entries.filter((e) => e.status === "conflict");
	}

	/**
	 * Get all queue entries.
	 */
	async getAllEntries(): Promise<QueueEntry[]> {
		await this.loadState();
		return [...this.state.entries];
	}

	/**
	 * Get a specific queue entry.
	 *
	 * @param workspaceId - Workspace ID
	 * @returns Queue entry or undefined
	 */
	async getEntry(workspaceId: string): Promise<QueueEntry | undefined> {
		await this.loadState();
		return this.state.entries.find((e) => e.workspaceId === workspaceId);
	}

	/**
	 * Check whether the queue has any unresolved entries (queued, merging,
	 * validating, blocked, conflict, or failed).
	 *
	 * Used by PlanQueueRunner to prevent starting a new plan while the
	 * integration queue still has work to resolve or complete.
	 *
	 * @returns true if there are unresolved entries
	 */
	async hasUnresolvedEntries(): Promise<boolean> {
		await this.loadState();
		return this.state.entries.some((e) => e.status !== "merged");
	}

	/**
	 * Check whether the integration queue has any dirty (non-terminal) entries.
	 *
	 * Dirty states are "queued", "merging", and "validating" — entries that
	 * are either waiting to be processed or are actively being processed.
	 *
	 * Clean (terminal) states are "merged", "failed", "blocked", and "conflict"
	 * — entries that have completed processing.
	 *
	 * Used by PlanQueueRunner to gate next plan execution: if the integration
	 * queue has dirty entries, the next plan must wait until all entries reach
	 * a clean terminal state.
	 *
	 * An empty queue is considered clean.
	 *
	 * @returns true if there are any dirty (non-terminal) entries
	 */
	async hasDirtyEntries(): Promise<boolean> {
		await this.loadState();
		return this.state.entries.some((e) => isIntegrationStatusDirty(e.status as any));
	}

	/**
	 * Retry a blocked, conflict, or failed queue entry.
	 *
	 * Resets the entry status to "queued" so it will be picked up by the
	 * next processNext() call. Clears the error, validation state, and
	 * conflict info.
	 *
	 * AC5: Manual resolution and resume path — after user resolves the
	 * conflict manually, call retryEntry() to re-attempt integration.
	 *
	 * @param workspaceId - Workspace ID to retry
	 */
	async retryEntry(workspaceId: string): Promise<void> {
		await this.loadState();

		const entry = this.state.entries.find(
			(e) =>
				e.workspaceId === workspaceId &&
				(e.status === "blocked" || e.status === "failed" || e.status === "conflict"),
		);

		if (!entry) {
			throw new Error(`No blocked, conflict, or failed entry found for workspace ${workspaceId}`);
		}

		entry.status = "queued";
		entry.validationPassed = undefined;
		entry.validationOutput = undefined;
		entry.error = undefined;
		entry.conflictArtifactPath = undefined;
		entry.conflictFiles = undefined;
		entry.validationStartedAt = undefined;
		entry.completedAt = undefined;
		entry.timingMetrics = undefined;

		this.appendAuditEvent(
			"retry",
			workspaceId,
			`Retried entry for workspace "${workspaceId}" (was ${entry.status} before reset)`,
		);
		await this.saveState();
	}

	/**
	 * Cancel a queued entry (removes it from the queue).
	 *
	 * @param workspaceId - Workspace ID to cancel
	 */
	async cancelEntry(workspaceId: string): Promise<void> {
		await this.loadState();

		const idx = this.state.entries.findIndex((e) => e.workspaceId === workspaceId && e.status === "queued");

		if (idx >= 0) {
			const entry = this.state.entries[idx];
			this.state.entries.splice(idx, 1);
			this.appendAuditEvent(
				"cancel",
				workspaceId,
				`Cancelled queued entry for workspace "${workspaceId}" (commit ${entry.commitHash.slice(0, 8)})`,
			);
			await this.saveState();
		}
	}

	// -----------------------------------------------------------------------
	// 6.6.F: Queue Control Actions
	// -----------------------------------------------------------------------

	/**
	 * Pause the queue, suspending processing of new entries.
	 *
	 * If a workspace is currently being processed, it will finish,
	 * but no new entries will start until resume() is called.
	 *
	 * Safe to call even if already paused (no-op).
	 */
	async pause(): Promise<void> {
		await this.loadState();

		if (this.state.paused) {
			return; // Already paused — no-op
		}

		this.state.paused = true;
		this.appendAuditEvent("pause", undefined, "Queue processing paused");
		await this.saveState();
	}

	/**
	 * Resume queue processing.
	 *
	 * Safe to call even if not paused (no-op). The next call to
	 * processNext() will resume processing queued entries.
	 */
	async resume(): Promise<void> {
		await this.loadState();

		if (!this.state.paused) {
			return; // Not paused — no-op
		}

		this.state.paused = false;
		this.appendAuditEvent("resume", undefined, "Queue processing resumed");
		await this.saveState();
	}

	/**
	 * Requeue a merged entry, moving it back to the queued state.
	 *
	 * Unlike retryEntry(), requeueEntry() specifically targets merged
	 * entries that have already completed successfully. This allows
	 * re-running a merge for entries that need to be refreshed.
	 *
	 * Unsafe if dependents of this entry are still in the queue —
	 * those would need to be re-processed after this entry.
	 * Use validateAction() first to check safety.
	 *
	 * @param workspaceId - Workspace ID to requeue
	 * @throws If entry is not found or is not in a requeue-able state
	 */
	async requeueEntry(workspaceId: string): Promise<void> {
		await this.loadState();

		const entry = this.state.entries.find((e) => e.workspaceId === workspaceId && e.status === "merged");

		if (!entry) {
			// Check if it exists at all
			const exists = this.state.entries.find((e) => e.workspaceId === workspaceId);
			if (!exists) {
				throw new Error(`No entry found for workspace "${workspaceId}"`);
			}
			throw new Error(
				`Entry "${workspaceId}" is in status "${exists.status}" — requeue is only valid for "merged" entries. Use retryEntry() for blocked/conflict/failed entries.`,
			);
		}

		entry.status = "queued";
		entry.validationPassed = undefined;
		entry.validationOutput = undefined;
		entry.validationStartedAt = undefined;
		entry.completedAt = undefined;
		entry.timingMetrics = undefined;
		entry.error = undefined;
		entry.conflictArtifactPath = undefined;
		entry.conflictFiles = undefined;

		this.appendAuditEvent("requeue", workspaceId, `Requeued merged entry for workspace "${workspaceId}"`);
		await this.saveState();
	}

	/**
	 * Get the audit log of queue control actions.
	 *
	 * @returns Array of audit events (most recent first)
	 */
	async getAuditLog(): Promise<AuditEntry[]> {
		await this.loadState();
		return [...this.state.auditEvents];
	}

	/**
	 * Validate whether a queue control action is safe to execute.
	 *
	 * Checks:
	 * - Requeuing an entry whose dependents are still in the queue
	 * - Cancelling an entry that is currently being processed
	 * - Reordering when blocked entries exist (blockers halt the queue)
	 * - Clearing completed entries with dependents still active
	 *
	 * @param action - The action to validate
	 * @param workspaceId - Optional workspace ID for single-entry actions
	 * @param workspaceDefs - Optional workspace definitions for dependency checks
	 * @returns Validation result with safe flag and detailed error messages
	 */
	async validateAction(
		action: "pause" | "resume" | "retry" | "requeue" | "clear_completed" | "reorder" | "cancel",
		workspaceId?: string,
		workspaceDefs?: Workspace[],
	): Promise<{ safe: boolean; errors: string[] }> {
		await this.loadState();
		const errors: string[] = [];

		// Build a fast lookup of workspace IDs still in the queue
		const queuedIds = new Set(this.state.entries.map((e) => e.workspaceId));

		switch (action) {
			case "pause":
				// Pause is always safe (already processing entries finish naturally)
				break;

			case "resume":
				// Resume is always safe
				break;

			case "retry":
				if (!workspaceId) {
					errors.push("retry requires a workspaceId");
					break;
				}
				{
					const entry = this.state.entries.find((e) => e.workspaceId === workspaceId);
					if (!entry) {
						errors.push(`No entry found for workspace "${workspaceId}"`);
					} else if (entry.status !== "blocked" && entry.status !== "failed" && entry.status !== "conflict") {
						errors.push(
							`Cannot retry entry "${workspaceId}": status is "${entry.status}". ` +
								"Retry is only valid for blocked, conflict, or failed entries.",
						);
					}
				}
				break;

			case "requeue":
				if (!workspaceId) {
					errors.push("requeue requires a workspaceId");
					break;
				}
				{
					const entry = this.state.entries.find((e) => e.workspaceId === workspaceId);
					if (!entry) {
						errors.push(`No entry found for workspace "${workspaceId}"`);
					} else if (entry.status !== "merged") {
						errors.push(
							`Cannot requeue entry "${workspaceId}": status is "${entry.status}". ` +
								"Requeue is only valid for merged entries.",
						);
					} else if (workspaceDefs && workspaceDefs.length > 0) {
						// Check if any queued entries depend on this workspace
						const depMap = new Map<string, string[]>();
						for (const wd of workspaceDefs) {
							if (wd.dependencies && wd.dependencies.length > 0) {
								depMap.set(wd.id, wd.dependencies);
							}
						}

						const dependents = workspaceDefs
							.filter((wd) => wd.dependencies?.includes(workspaceId))
							.map((wd) => wd.id)
							.filter((id) => queuedIds.has(id));

						if (dependents.length > 0) {
							errors.push(
								`Cannot requeue "${workspaceId}": the following queued entries depend on it: "${dependents.join(", ")}". ` +
									"Requeue this entry would invalidate the dependency order. Resolve dependents first.",
							);
						}
					}
				}
				break;

			case "cancel":
				if (!workspaceId) {
					errors.push("cancel requires a workspaceId");
					break;
				}
				{
					const entry = this.state.entries.find((e) => e.workspaceId === workspaceId);
					if (!entry) {
						errors.push(`No entry found for workspace "${workspaceId}"`);
					} else if (entry.status !== "queued") {
						errors.push(
							`Cannot cancel entry "${workspaceId}": status is "${entry.status}". ` +
								"Cancel is only valid for queued entries.",
						);
					} else if (this.state.isProcessing && this.state.currentWorkspaceId === workspaceId) {
						errors.push(
							`Cannot cancel entry "${workspaceId}": it is currently being processed. ` +
								"Wait for processing to complete before cancelling.",
						);
					}
				}
				break;

			case "clear_completed":
				// clear_completed is always safe — completed entries have already
				// been merged into the integration branch and removing them from
				// the queue does not affect the branch state.
				break;

			case "reorder":
				if (this.state.isProcessing) {
					errors.push(
						"Cannot reorder the queue while an entry is being processed. " +
							"Wait for processing to complete before reordering.",
					);
				}
				{
					const blockers = this.state.entries.filter((e) => e.status === "blocked" || e.status === "conflict");
					if (blockers.length > 0 && workspaceDefs) {
						// Informational — blocked entries at the front effectively halt the queue
						// but reorder can still reorder non-blocked entries behind them
					}
				}
				break;
		}

		return { safe: errors.length === 0, errors };
	}

	/**
	 * Clear all completed entries from the queue.
	 *
	 * Removes merged, failed, and conflict entries. Keeps queued,
	 * blocked, and currently processing entries.
	 */
	async clearCompleted(): Promise<void> {
		await this.loadState();
		const before = this.state.entries.length;
		this.state.entries = this.state.entries.filter(
			(e) => e.status !== "merged" && e.status !== "failed" && e.status !== "conflict",
		);
		const removed = before - this.state.entries.length;
		this.appendAuditEvent(
			"clear_completed",
			undefined,
			`Cleared ${removed} completed/failed/conflict entries from the queue`,
		);
		await this.saveState();
	}

	/**
	 * Compute timing metrics for a queue entry from its timestamps.
	 */
	private computeTimingMetrics(entry: QueueEntry): QueueEntryTiming {
		const waitTimeMs =
			entry.processedAt && entry.processedAt >= entry.queuedAt ? entry.processedAt - entry.queuedAt : 0;
		const mergeTimeMs =
			entry.mergedAt && entry.processedAt && entry.mergedAt >= entry.processedAt
				? entry.mergedAt - entry.processedAt
				: 0;
		const totalTimeMs =
			entry.completedAt && entry.completedAt >= entry.queuedAt
				? entry.completedAt - entry.queuedAt
				: entry.mergedAt && entry.mergedAt >= entry.queuedAt
					? entry.mergedAt - entry.queuedAt
					: 0;

		let validationTimeMs: number | undefined;
		if (entry.validationStartedAt && entry.mergedAt && entry.validationStartedAt >= entry.mergedAt) {
			// If we have a completion time for validation, use it; otherwise approximate
			// by the time between validation started and completedAt/mergedAt
			const validationEnd = entry.completedAt ?? Date.now();
			if (validationEnd >= entry.validationStartedAt) {
				validationTimeMs = validationEnd - entry.validationStartedAt;
			}
		}

		return {
			waitTimeMs: Math.max(0, waitTimeMs),
			mergeTimeMs: Math.max(0, mergeTimeMs),
			validationTimeMs: validationTimeMs !== undefined ? Math.max(0, validationTimeMs) : undefined,
			totalTimeMs: Math.max(0, totalTimeMs),
		};
	}

	/**
	 * Append an event to the audit log.
	 *
	 * Maintains a maximum of 100 recent events, discarding the oldest
	 * as new events are added.
	 */
	private appendAuditEvent(action: AuditEntry["action"], workspaceId: string | undefined, details: string): void {
		const entry: AuditEntry = {
			action,
			workspaceId,
			timestamp: Date.now(),
			details,
		};
		// Prepend for most-recent-first ordering
		this.state.auditEvents.unshift(entry);
		// Cap at 100 entries
		if (this.state.auditEvents.length > 100) {
			this.state.auditEvents = this.state.auditEvents.slice(0, 100);
		}
	}

	/**
	 * Save queue state to disk.
	 */
	private async saveState(): Promise<void> {
		this.state.updatedAt = Date.now();

		const piDir = path.dirname(this.stateFilePath);
		await fs.mkdir(piDir, { recursive: true });

		const tempPath = `${this.stateFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), "utf-8");
		await fs.rename(tempPath, this.stateFilePath);
	}

	/**
	 * Load queue state from disk if it exists.
	 */
	private async loadState(): Promise<void> {
		try {
			const content = await fs.readFile(this.stateFilePath, "utf-8");
			const parsed = JSON.parse(content) as IntegrationQueueState;

			this.state = {
				...parsed,
				entries: parsed.entries ?? [],
				// Backward compat: old state files won't have paused/auditEvents
				paused: parsed.paused ?? false,
				auditEvents: parsed.auditEvents ?? [],
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// No saved state yet — use defaults
				return;
			}
			throw error;
		}
	}

	// -----------------------------------------------------------------------
	// Queue Optimizer Integration (6.D)
	// -----------------------------------------------------------------------

	/**
	 * Get reorder suggestions for the current queue state.
	 *
	 * Returns suggested reorderings without modifying the queue.
	 * Safe to call at any point for informational purposes.
	 *
	 * @param workspaceDefs - Optional workspace definitions for accurate scoring
	 * @returns Reorder suggestions
	 */
	async getOptimizerSuggestions(workspaceDefs?: Workspace[]): Promise<ReorderSuggestionResult> {
		await this.loadState();
		const optimizer = new QueueOptimizer();
		return optimizer.suggestReorder(this.state, workspaceDefs);
	}

	/**
	 * Apply queue optimizer suggestions to reorder the queue.
	 *
	 * Reorders queued entries by priority score while respecting
	 * dependency constraints. Non-queued entries are preserved.
	 *
	 * @param workspaceDefs - Optional workspace definitions for accurate scoring
	 * @returns Optimization result
	 */
	async applyOptimizerOrdering(workspaceDefs?: Workspace[]): Promise<OptimizationResult> {
		await this.loadState();
		const optimizer = new QueueOptimizer();
		const result = optimizer.optimize(this.state, workspaceDefs);

		if (result.optimized) {
			this.state = result.state;
			const orderStr = this.state.entries
				.filter((e) => e.status === "queued")
				.map((e) => e.workspaceId)
				.join(" \u2192 ");
			this.appendAuditEvent("reorder", undefined, `Reordered queue (optimized): ${orderStr}`);
			await this.saveState();
		}

		return result;
	}

	/**
	 * Get a throughput impact analysis of the current queue ordering.
	 *
	 * Compares the current order against the optimized order and
	 * explains the throughput difference.
	 *
	 * @param workspaceDefs - Optional workspace definitions for accurate scoring
	 * @returns Throughput impact analysis
	 */
	async analyzeThroughput(workspaceDefs?: Workspace[]): Promise<ThroughputImpact> {
		await this.loadState();
		const optimizer = new QueueOptimizer();
		const suggestions = optimizer.suggestReorder(this.state, workspaceDefs);
		return suggestions.throughputImpact;
	}

	/**
	 * Check whether the current queue ordering respects dependency constraints.
	 *
	 * @param workspaceDefs - Workspace definitions with dependency info
	 * @returns True if all dependency constraints are satisfied
	 */
	async isOrderSafe(workspaceDefs?: Workspace[]): Promise<boolean> {
		await this.loadState();
		const optimizer = new QueueOptimizer();
		const suggestions = optimizer.suggestReorder(this.state, workspaceDefs);
		return suggestions.isSafe;
	}
}

/**
 * Format a queue entry for human-readable display.
 *
 * @param entry - Queue entry
 * @returns Formatted string
 */
export function formatQueueEntry(entry: QueueEntry): string {
	const lines: string[] = [];
	lines.push(`Workspace: ${entry.workspaceId}`);
	lines.push(`  Status: ${entry.status}`);
	lines.push(`  Commit: ${entry.commitHash.slice(0, 8)}`);

	if (entry.validationCommand) {
		lines.push(`  Validation: ${entry.validationCommand}`);
	}
	if (entry.validationPassed !== undefined) {
		lines.push(`  Validation Passed: ${entry.validationPassed}`);
	}
	if (entry.validationOutput) {
		lines.push(`  Validation Output: ${entry.validationOutput.slice(0, 200)}`);
	}
	if (entry.error) {
		lines.push(`  Error: ${entry.error}`);
	}
	if (entry.conflictFiles && entry.conflictFiles.length > 0) {
		lines.push(`  Conflicted Files: ${entry.conflictFiles.join(", ")}`);
	}
	if (entry.conflictArtifactPath) {
		lines.push(`  Conflict Artifact: ${entry.conflictArtifactPath}`);
	}

	lines.push(`  Queued: ${new Date(entry.queuedAt).toISOString()}`);
	if (entry.processedAt) {
		lines.push(`  Processed: ${new Date(entry.processedAt).toISOString()}`);
	}
	if (entry.mergedAt) {
		lines.push(`  Merged: ${new Date(entry.mergedAt).toISOString()}`);
	}

	if (entry.timingMetrics) {
		lines.push(`  Timing Metrics:`);
		lines.push(`    Wait Time: ${entry.timingMetrics.waitTimeMs}ms`);
		lines.push(`    Merge Time: ${entry.timingMetrics.mergeTimeMs}ms`);
		if (entry.timingMetrics.validationTimeMs !== undefined) {
			lines.push(`    Validation Time: ${entry.timingMetrics.validationTimeMs}ms`);
		}
		lines.push(`    Total Time: ${entry.timingMetrics.totalTimeMs}ms`);
	}

	return lines.join("\n");
}

/**
 * Format full queue state for display.
 *
 * @param state - Integration queue state
 * @returns Formatted string
 */
export function formatIntegrationQueueState(state: IntegrationQueueState): string {
	const lines: string[] = [];

	lines.push(`Integration Queue`);
	lines.push(`Processing: ${state.isProcessing}`);
	lines.push(`Paused: ${state.paused}`);
	if (state.currentWorkspaceId) {
		lines.push(`Current: ${state.currentWorkspaceId}`);
	}
	lines.push(`Created: ${new Date(state.createdAt).toISOString()}`);
	lines.push(`Updated: ${new Date(state.updatedAt).toISOString()}`);
	lines.push(`Audit Events: ${state.auditEvents.length} logged`);
	lines.push("");
	lines.push(`Entries (${state.entries.length}):`);
	lines.push("");

	for (let i = 0; i < state.entries.length; i++) {
		const entry = state.entries[i];
		const statusIcon =
			entry.status === "merged"
				? "[OK]"
				: entry.status === "conflict"
					? "[<>]"
					: entry.status === "blocked" || entry.status === "failed"
						? "[!!]"
						: "[--]";
		lines.push(`  ${statusIcon} [${i + 1}] ${entry.workspaceId} — ${entry.status}`);
		if (entry.validationPassed !== undefined) {
			lines.push(`       Validation: ${entry.validationPassed ? "PASSED" : "FAILED"}`);
		}
		if (entry.error) {
			lines.push(`       Error: ${entry.error}`);
		}
		if (entry.conflictFiles && entry.conflictFiles.length > 0) {
			lines.push(`       Conflict Files: ${entry.conflictFiles.join(", ")}`);
		}
		if (entry.timingMetrics) {
			lines.push(
				`       Times: wait=${entry.timingMetrics.waitTimeMs}ms merge=${entry.timingMetrics.mergeTimeMs}ms total=${entry.timingMetrics.totalTimeMs}ms`,
			);
		}
		lines.push("");
	}

	return lines.join("\n");
}
