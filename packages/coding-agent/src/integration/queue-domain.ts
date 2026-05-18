/**
 * Queue Domain Model — P12.5.A
 *
 * Defines the two-layer queue domain model for Pi's execution pipeline:
 *
 * ## Layer 1 — Plan Queue (PlanQueueRunner)
 *   Manages the execution order of *plans* per project. Only one active
 *   plan per project runs at a time. The queue is persisted to disk and
 *   survives process restarts.
 *
 *   States: Pending → Active → Complete | Failed | Blocked | Skipped
 *
 * ## Layer 2 — Integration Queue (IntegrationQueue)
 *   Manages the merge and validation order of *workspaces* within a
 *   single plan's integration branch. Workspaces are processed one at a
 *   time: merged, validated, and recorded.
 *
 *   States: queued → merging → validating → merged | failed | blocked | conflict
 *
 * ## Clean / Dirty Classification
 *
 * Each layer defines terminal states ("clean") and non-terminal states
 * ("dirty"). A clean queue has no entries in dirty states.
 *
 * | Layer          | Clean (terminal) states                     | Dirty (non-terminal) states |
 * |----------------|---------------------------------------------|-----------------------------|
 * | Plan Queue     | Complete, Failed, Skipped, Blocked          | Pending, Active             |
 * | Integration Q  | merged, failed, blocked, conflict           | queued, merging, validating |
 */

// ---------------------------------------------------------------------------
// Layer 1: Plan Queue Types
// ---------------------------------------------------------------------------

/**
 * Status of a plan entry in the plan queue.
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
 * A single plan entry in the plan queue.
 */
export interface PlanQueueEntry {
	/** Unique entry ID */
	id: string;
	/** Project this plan belongs to */
	projectId: string;
	/** Plan file path or identifier */
	planPath: string;
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
}

// ---------------------------------------------------------------------------
// Layer 2: Integration Queue Types
// ---------------------------------------------------------------------------

/**
 * Status of a workspace queue entry in the integration queue.
 */
export type IntegrationQueueStatus =
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
 * Computed timing metrics for an integration queue entry.
 */
export interface IntegrationQueueTiming {
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
 * A single workspace entry in the integration queue.
 */
export interface IntegrationQueueEntry {
	/** Workspace ID */
	workspaceId: string;
	/** Current queue status */
	status: IntegrationQueueStatus;
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
	timingMetrics?: IntegrationQueueTiming;
}

/**
 * Serialized state of the integration queue.
 */
export interface IntegrationQueueState {
	/** Queue entries in order */
	entries: IntegrationQueueEntry[];
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

// ---------------------------------------------------------------------------
// Clean / Dirty State Classification
// ---------------------------------------------------------------------------

/**
 * Set of plan queue states considered "clean" (terminal / stable).
 *
 * A plan entry in a clean state will not transition further without
 * explicit user or agent intervention.
 */
export const PLAN_CLEAN_STATES: ReadonlySet<PlanQueueEntryStatus> = new Set([
	PlanQueueEntryStatus.Complete,
	PlanQueueEntryStatus.Failed,
	PlanQueueEntryStatus.Skipped,
	PlanQueueEntryStatus.Blocked,
]);

/**
 * Set of plan queue states considered "dirty" (non-terminal / in-progress).
 *
 * A plan entry in a dirty state is either waiting to run or actively
 * executing. It will transition to a clean state automatically.
 */
export const PLAN_DIRTY_STATES: ReadonlySet<PlanQueueEntryStatus> = new Set([
	PlanQueueEntryStatus.Pending,
	PlanQueueEntryStatus.Active,
]);

/**
 * Set of integration queue states considered "clean" (terminal / stable).
 *
 * A workspace in a clean state has completed processing (merged, failed,
 * blocked, or in merge conflict). No further transitions occur without
 * explicit action.
 */
export const INTEGRATION_CLEAN_STATES: ReadonlySet<IntegrationQueueStatus> = new Set([
	"merged",
	"failed",
	"blocked",
	"conflict",
]);

/**
 * Set of integration queue states considered "dirty" (non-terminal / in-progress).
 *
 * A workspace in a dirty state is either queued, being merged, or being
 * validated. It will transition to a clean state automatically.
 */
export const INTEGRATION_DIRTY_STATES: ReadonlySet<IntegrationQueueStatus> = new Set([
	"queued",
	"merging",
	"validating",
]);

// ---------------------------------------------------------------------------
// Classification Utilities
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the given plan queue status is a clean (terminal) state.
 */
export function isPlanStatusClean(status: PlanQueueEntryStatus): boolean {
	return PLAN_CLEAN_STATES.has(status);
}

/**
 * Returns `true` if the given plan queue status is a dirty (non-terminal) state.
 */
export function isPlanStatusDirty(status: PlanQueueEntryStatus): boolean {
	return PLAN_DIRTY_STATES.has(status);
}

/**
 * Returns `true` if the given integration queue status is a clean (terminal) state.
 */
export function isIntegrationStatusClean(status: IntegrationQueueStatus): boolean {
	return INTEGRATION_CLEAN_STATES.has(status);
}

/**
 * Returns `true` if the given integration queue status is a dirty (non-terminal) state.
 */
export function isIntegrationStatusDirty(status: IntegrationQueueStatus): boolean {
	return INTEGRATION_DIRTY_STATES.has(status);
}

/**
 * Returns `true` if a {@link PlanQueueEntry} is in a clean (terminal) state.
 */
export function isPlanEntryClean(entry: PlanQueueEntry): boolean {
	return isPlanStatusClean(entry.status);
}

/**
 * Returns `true` if a {@link PlanQueueEntry} is in a dirty (non-terminal) state.
 */
export function isPlanEntryDirty(entry: PlanQueueEntry): boolean {
	return isPlanStatusDirty(entry.status);
}

/**
 * Returns `true` if an {@link IntegrationQueueEntry} is in a clean (terminal) state.
 */
export function isIntegrationEntryClean(entry: IntegrationQueueEntry): boolean {
	return isIntegrationStatusClean(entry.status);
}

/**
 * Returns `true` if an {@link IntegrationQueueEntry} is in a dirty (non-terminal) state.
 */
export function isIntegrationEntryDirty(entry: IntegrationQueueEntry): boolean {
	return isIntegrationStatusDirty(entry.status);
}

/**
 * Returns `true` if a plan queue has no dirty entries (all entries are clean).
 *
 * An empty queue is considered clean.
 */
export function isPlanQueueClean(entries: PlanQueueEntry[]): boolean {
	return entries.every(isPlanEntryClean);
}

/**
 * Returns `true` if a plan queue has any dirty entries.
 */
export function isPlanQueueDirty(entries: PlanQueueEntry[]): boolean {
	return entries.some(isPlanEntryDirty);
}

/**
 * Returns `true` if an integration queue has no dirty entries (all entries are clean).
 *
 * An empty queue is considered clean.
 */
export function isIntegrationQueueClean(entries: IntegrationQueueEntry[]): boolean {
	return entries.every(isIntegrationEntryClean);
}

/**
 * Returns `true` if an integration queue has any dirty entries.
 */
export function isIntegrationQueueDirty(entries: IntegrationQueueEntry[]): boolean {
	return entries.some(isIntegrationEntryDirty);
}
