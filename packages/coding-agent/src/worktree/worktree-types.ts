/**
 * Worktree Types - P2 Workstream 6.A
 *
 * Types for git worktree isolation during workspace execution.
 * Each workspace runs in its own git worktree to prevent cross-contamination
 * and enable safe parallel execution.
 */

// ---------------------------------------------------------------------------
// Worktree Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a git worktree.
 */
export type WorktreeStatus = "created" | "active" | "completed" | "failed" | "quarantined";

// ---------------------------------------------------------------------------
// Worktree State
// ---------------------------------------------------------------------------

/**
 * Persistent state for a single workspace git worktree.
 */
export interface WorktreeState {
	/** Absolute path to the worktree directory */
	worktreePath: string;
	/** Git commit hash at which the worktree was created (base commit) */
	baseCommit: string;
	/** Git branch name created for this worktree (e.g., worktree/<planExecId>/<workspaceId>) */
	branchName: string;
	/** Workspace identifier (e.g., "7.A") */
	workspaceId: string;
	/** Plan execution ID that owns this worktree */
	planExecutionId: string;
	/** Epoch ms when the worktree was created */
	createdAt: number;
	/** Current lifecycle status */
	status: WorktreeStatus;
	/** Epoch ms of last status change */
	statusChangedAt: number;
}

// ---------------------------------------------------------------------------
// Worktree Configuration
// ---------------------------------------------------------------------------

/**
 * Worktree mode configuration for plan execution.
 */
export interface WorktreeConfig {
	/**
	 * Whether worktree isolation is enabled.
	 * When false, falls back to P5.5 shared-working-tree execution.
	 */
	enabled: boolean;
	/**
	 * Directory root for worktrees, relative to the project workspace root.
	 * Default: ".pi/worktrees"
	 */
	root?: string;
}

// ---------------------------------------------------------------------------
// Worktree Executor Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for creating and managing a workspace worktree.
 */
export interface WorktreeExecutorConfig {
	/** Absolute path to the main project root (the original git checkout) */
	workspaceRoot: string;
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace ID (e.g., "7.A") */
	workspaceId: string;
	/** Worktree configuration (enabled flag and root override) */
	worktree?: WorktreeConfig;
	/** Optional explicit branch name override */
	branchName?: string;
}

// ---------------------------------------------------------------------------
// Worktree Create Result
// ---------------------------------------------------------------------------

/**
 * Result of creating a git worktree.
 */
export interface WorktreeCreateResult {
	/** The worktree state that was persisted */
	state: WorktreeState;
	/** Whether a new worktree was actually created (vs. reusing an existing one) */
	created: boolean;
	/** Any error encountered during creation */
	error?: string;
}

// ---------------------------------------------------------------------------
// Worktree Execution Result
// ---------------------------------------------------------------------------

/**
 * Overall result of worktree-based workspace execution.
 */
export interface WorktreeExecutionResult {
	/** Whether execution was successful */
	success: boolean;
	/** Final verdict */
	verdict: "COMPLETE" | "BLOCKED" | "FAILED";
	/** The worktree state, if worktree mode was active */
	worktreeState?: WorktreeState;
	/** Agent report content */
	report?: string;
	/** Error message if failed */
	error?: string;
	/** Execution logs */
	logs: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default worktree storage root relative to workspace root */
export const DEFAULT_WORKTREE_ROOT = ".pi/worktrees";

/** Default worktree config (disabled) */
export const DEFAULT_WORKTREE_CONFIG: WorktreeConfig = {
	enabled: false,
	root: DEFAULT_WORKTREE_ROOT,
};

// ---------------------------------------------------------------------------
// Worktree List Entry
// ---------------------------------------------------------------------------

/**
 * Summary entry for listing worktrees with their current status.
 */
export interface WorktreeListEntry {
	/** Absolute path to the worktree directory */
	worktreePath: string;
	/** Workspace identifier */
	workspaceId: string;
	/** Plan execution ID that owns this worktree */
	planExecutionId: string;
	/** Git branch name */
	branchName: string;
	/** Base commit hash */
	baseCommit: string;
	/** Current lifecycle status */
	status: WorktreeStatus;
	/** ISO-8601 timestamp when the worktree was created */
	createdAt: number;
	/** ISO-8601 timestamp of last status change */
	statusChangedAt: number;
	/** Whether a diff artifact exists (meaning worktree completed and was diffed) */
	diffArtifact?: string;
}

// ---------------------------------------------------------------------------
// Worktree Diff Artifact
// ---------------------------------------------------------------------------

/**
 * A diff artifact produced from a completed worktree.
 */
export interface WorktreeDiffArtifact {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Unified diff output between the worktree's head and the base commit */
	diff: string;
	/** File path where the diff artifact is stored (if persisted) */
	diffPath?: string;
	/** Timestamp when the diff was generated */
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Cleanup Result
// ---------------------------------------------------------------------------

/**
 * Result of a worktree cleanup operation.
 */
export interface WorktreeCleanupResult {
	/** Whether cleanup was successful */
	success: boolean;
	/** Path that was cleaned up */
	path: string;
	/** Error message if failed */
	error?: string;
}
