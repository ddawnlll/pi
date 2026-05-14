/**
 * Integration Queue - P2 Workstream 6.C / 6.D
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
 * Never pushes to remote — all operations are local.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IntegrationBranch } from "./integration-branch.js";
import { isMergeConflictError, MergeConflictResolver } from "./merge-conflict-handoff.js";

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
}

/**
 * Serialized state of the integration queue.
 */
export interface IntegrationQueueState {
	/** Queue entries in order */
	entries: QueueEntry[];
	/** Whether the queue is currently processing an entry */
	isProcessing: boolean;
	/** Workspace ID currently being processed (if isProcessing) */
	currentWorkspaceId?: string;
	/** Timestamp when the queue was created */
	createdAt: number;
	/** Timestamp when the state was last updated */
	updatedAt: number;
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
	 * @param workspaceRoot - Root directory of the workspace (git repo)
	 * @param branchName - Name of the integration branch (default: "integration")
	 * @param baseBranch - Base branch (default: "main")
	 */
	constructor(workspaceRoot: string, branchName = "integration", baseBranch = "main") {
		this.workspaceRoot = workspaceRoot;
		this.branch = new IntegrationBranch(workspaceRoot, branchName, baseBranch);
		this.state = {
			entries: [],
			isProcessing: false,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		this.stateFilePath = path.join(workspaceRoot, ".pi", "integration-queue.json");
	}

	/**
	 * The underlying IntegrationBranch instance.
	 */
	get integrationBranch(): IntegrationBranch {
		return this.branch;
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

		// Begin processing
		this.state.isProcessing = true;
		this.state.currentWorkspaceId = nextEntry.workspaceId;
		nextEntry.status = "merging";
		nextEntry.processedAt = Date.now();
		await this.saveState();

		try {
			// AC1: Merge one workspace at a time into integration branch
			await this.branch.ensureBranch();
			const mergeEntry = await this.branch.mergeWorkspace(nextEntry.workspaceId, nextEntry.commitHash);

			// Update queue state from merge result
			nextEntry.status = "merged";
			nextEntry.mergedAt = mergeEntry.mergedAt;

			// AC4: Run integration validation after merge
			if (nextEntry.validationCommand) {
				nextEntry.status = "validating";
				await this.saveState();

				const validationResult = await this.branch.runValidation(
					nextEntry.workspaceId,
					nextEntry.validationCommand,
				);

				nextEntry.validationPassed = validationResult.passed;
				nextEntry.validationOutput = validationResult.output;

				if (validationResult.passed) {
					nextEntry.status = "merged";

					// AC5: Record merge result
					const updatedMergeEntry = this.branch.getMergeStatus(nextEntry.workspaceId);
					if (updatedMergeEntry) {
						await this.branch.recordResult(updatedMergeEntry);
					}
				} else {
					// AC3: Failed validation blocks merge
					nextEntry.status = "blocked";
					nextEntry.error = `Validation failed: ${nextEntry.validationCommand}`;

					// Record the blocked result
					const blockedMergeEntry = this.branch.getMergeStatus(nextEntry.workspaceId);
					if (blockedMergeEntry) {
						await this.branch.recordResult(blockedMergeEntry);
					}
				}
			} else {
				// No validation command — mark as merged
				nextEntry.status = "merged";

				// AC5: Record merge result
				const updatedMergeEntry = this.branch.getMergeStatus(nextEntry.workspaceId);
				if (updatedMergeEntry) {
					await this.branch.recordResult(updatedMergeEntry);
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// AC1: Detect merge conflict — does not silently fail or mark complete
			if (isMergeConflictError(errorMessage)) {
				// AC2: Write conflict artifact
				nextEntry.status = "conflict";
				nextEntry.error = errorMessage;

				try {
					const resolver = new MergeConflictResolver(this.workspaceRoot);
					const { artifact, filePath } = await resolver.detectAndRecordConflict(
						nextEntry.workspaceId,
						nextEntry.commitHash,
						errorMessage,
					);

					nextEntry.conflictArtifactPath = filePath;
					nextEntry.conflictFiles = artifact.conflictedFiles.map((f) => f.filePath);
				} catch {
					// Best-effort artifact writing
				}

				// Record the conflict result in branch state
				try {
					const conflictMergeEntry = this.branch.getMergeStatus(nextEntry.workspaceId);
					if (conflictMergeEntry) {
						await this.branch.recordResult(conflictMergeEntry);
					}
				} catch {
					// Best-effort
				}
			} else {
				nextEntry.status = "failed";
				nextEntry.error = errorMessage;

				// Record the failed result
				try {
					const failedMergeEntry = this.branch.getMergeStatus(nextEntry.workspaceId);
					if (failedMergeEntry) {
						await this.branch.recordResult(failedMergeEntry);
					}
				} catch {
					// Best-effort
				}
			}
		} finally {
			// Release processing lock
			this.state.isProcessing = false;
			this.state.currentWorkspaceId = undefined;
			await this.saveState();
		}

		return { processed: true, entry: nextEntry };
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
			this.state.entries.splice(idx, 1);
			await this.saveState();
		}
	}

	/**
	 * Clear all completed entries from the queue.
	 *
	 * Removes merged, failed, and conflict entries. Keeps queued,
	 * blocked, and currently processing entries.
	 */
	async clearCompleted(): Promise<void> {
		await this.loadState();
		this.state.entries = this.state.entries.filter(
			(e) => e.status !== "merged" && e.status !== "failed" && e.status !== "conflict",
		);
		await this.saveState();
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
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// No saved state yet — use defaults
				return;
			}
			throw error;
		}
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
	if (state.currentWorkspaceId) {
		lines.push(`Current: ${state.currentWorkspaceId}`);
	}
	lines.push(`Created: ${new Date(state.createdAt).toISOString()}`);
	lines.push(`Updated: ${new Date(state.updatedAt).toISOString()}`);
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
		lines.push("");
	}

	return lines.join("\n");
}
