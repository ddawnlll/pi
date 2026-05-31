/**
 * Execution Events — P40 Platform / Agent Separation
 *
 * Event type definitions for the execution platform.
 * Events are emitted during execution and consumed by observers.
 */

// ---------------------------------------------------------------------------
// Workspace Execution Stage
// ---------------------------------------------------------------------------

/**
 * Workspace execution stage enum.
 * Mirrors WorkspaceStage from the execution kernel for external consumers.
 */
export type WorkspaceExecutionStage =
	| "Pending"
	| "Running"
	| "Complete"
	| "Failed"
	| "Blocked"
	| "Cancelled"
	| "Skipped"
	| "Paused"
	| "TimedOut";
