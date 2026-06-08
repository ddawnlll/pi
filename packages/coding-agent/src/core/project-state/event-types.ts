/**
 * Project State — Event, Classifier, Watcher, Reconcile, Query Types
 *
 * PSS-MEGA-02 additions, kept separate from PSS-MEGA-01 types.
 */

import type { SnapshotValidity } from "./types.js";

// ============================================================================
// Event Journal
// ============================================================================

export interface ProjectStateEventEnvelope {
	eventId: string;
	sequence: number;
	timestamp: string;
	sessionId: string;
	planExecutionId?: string;
	workspaceId?: string;
	toolCallId?: string;
	cwd: string;
	source:
		| "read_tool"
		| "write_tool"
		| "edit_tool"
		| "bash_tool"
		| "watcher"
		| "reconcile"
		| "snapshot"
		| "git_detector"
		| "external";
	event: ProjectStateEvent;
}

export type ProjectStateEvent =
	| { type: "snapshot_started"; snapshotRunId: string; rootDir: string }
	| { type: "snapshot_completed"; snapshotRunId: string; rootDir: string; treeHash: string }
	| { type: "file_written"; path: string; oldHash?: string; newHash?: string }
	| { type: "file_edited"; path: string; oldHash?: string; newHash?: string }
	| { type: "file_touched"; path: string }
	| { type: "file_deleted"; path: string; oldHash?: string }
	| { type: "file_moved"; from: string; to: string; oldHash?: string; newHash?: string }
	| { type: "directory_created"; path: string }
	| { type: "directory_deleted"; path: string }
	| { type: "package_manifest_changed"; path: string }
	| { type: "config_file_changed"; path: string }
	| { type: "git_head_changed"; oldHead?: string; newHead?: string }
	| { type: "git_worktree_changed" }
	| { type: "command_started"; command: string; classification: CommandStateEffect }
	| { type: "command_completed"; command: string; exitCode: number; classification: CommandStateEffect }
	| { type: "mutation_window_opened"; windowId: string; reason: string }
	| { type: "mutation_window_closed"; windowId: string; reason: string }
	| { type: "fs_change_batch"; batchId: string; changes: ProjectStateFsChange[] }
	| { type: "state_marked_dirty"; reason: string; scope: string[] }
	| { type: "state_marked_unknown"; reason: string; scope: string[] };

// ============================================================================
// Bash Command Classifier
// ============================================================================

export type CommandStateEffect =
	| "no_state_change"
	| "path_local_mutation"
	| "tree_mutation"
	| "package_state_mutation"
	| "git_state_mutation"
	| "unknown_global_mutation"
	| "dangerous_destructive_mutation";

export interface CommandClassification {
	effect: CommandStateEffect;
	confidence: "high" | "medium" | "low";
	affectedPaths?: string[];
	requiresMutationWindow: boolean;
	requiresReconcile: "none" | "path" | "parent_dirs" | "bounded_tree" | "full_tree";
	reason: string;
}

// ========================================================================
// File System Changes (Watcher / Reconcile)
// ========================================================================

export type FsChangeFlushReason =
	| "debounce"
	| "unknown_command_completed"
	| "manual_flush"
	| "periodic_reconcile"
	| "watcher_overflow";

export type ProjectStateFsChange =
	| { type: "fs_file_created"; path: string }
	| { type: "fs_file_changed"; path: string }
	| { type: "fs_file_deleted"; path: string }
	| { type: "fs_directory_created"; path: string }
	| { type: "fs_directory_deleted"; path: string }
	| { type: "fs_unknown_change"; path: string };

export interface ProjectStateFsChangeBatch {
	batchId: string;
	changes: ProjectStateFsChange[];
	flushedAt: string;
	reason: FsChangeFlushReason;
}

// ============================================================================
// Mutation Windows
// ============================================================================

export interface MutationWindow {
	id: string;
	source: "bash_unknown" | "git_operation" | "package_operation" | "external" | "ide";
	startedAt: string;
	completedAt?: string;
	cwd: string;
	command?: string;
	preTreeHash?: string;
	postTreeHash?: string;
	collectedWatcherEvents: number;
	status: "open" | "reconciling" | "closed" | "failed";
}

// ============================================================================
// Reconcile
// ============================================================================

export type ReconcileLevel = "path" | "parent_dirs" | "bounded_tree" | "full_tree";

export interface ReconcileOptions {
	rootDir: string;
	candidatePaths: string[];
	level: ReconcileLevel;
	statLimit?: number;
}

export interface ReconcileResult {
	events: ProjectStateEventEnvelope[];
	statCalls: number;
	hashCalls: number;
	exceededLimit: boolean;
	markedUnknown: boolean;
	failures: Array<{ path: string; error: string }>;
}

// ============================================================================
// Query Service
// ============================================================================

export interface QueryRenderOptions {
	mode?: "compact" | "summary" | "full";
	maxItems?: number;
	maxTokens?: number;
	cursor?: string;
}

export interface ProjectStateQueryResult {
	source: "project_state_cache" | "filesystem_fallback" | "unavailable";
	validity: SnapshotValidity;
	summary: string;
	items?: string[];
	cursor?: string;
	totalItems?: number;
	truncated: boolean;
	warnings: string[];
}
