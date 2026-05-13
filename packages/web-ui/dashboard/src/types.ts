/**
 * Plan Dashboard Types
 * Matches the data structures from .pi/ directory
 */

// =============================================================================
// Legacy Types (backward compat)
// =============================================================================

export interface PlanState {
	phase: string;
	title: string;
	status: "running" | "paused" | "stopped" | "completed" | "failed";
	workspaces: WorkspaceJson[];
	startedAt?: number;
	completedAt?: number;
}

/** Workspace entry as it appears in plan-state.json */
export interface WorkspaceJson {
	workspaceId: string;
	stage: string;
	attempts: number;
	startedAt?: number;
	completedAt?: number;
	ownedFiles?: string[];
	error?: string | null;
}

export interface WorkerInfo {
	id: string;
	stage: "pending" | "active" | "blocked" | "complete" | "failed";
	attempt: number;
	retries: number;
	snapshotPath?: string;
	reportPath?: string;
	error?: string | null;
}

export interface ExecutionEvent {
	timestamp: string;
	type: "started" | "completed" | "failed" | "retry" | "blocked";
	workspaceId: string;
	message: string;
}

export interface ControlRequest {
	action: "pause" | "stop" | "cancel" | "resume";
	requestedAt: string;
	requestedBy: string;
}

export interface ControlResponse {
	success: boolean;
	error?: string;
}

export type LogStream = "raw" | "structured" | "narrative" | "audit" | "decision" | "stdout" | "stderr" | "test" | "error" | "transcript";

/** Worker transcript event — matches WorkerTranscriptEvent from plan-state.ts */
export type WorkerTranscriptEventType =
	| "worker_status"
	| "worker_decision_summary"
	| "validation"
	| "blocker"
	| "tool_call"
	| "workspace_start"
	| "workspace_complete"
	| "workspace_failed"
	| "workspace_blocked"
	| "retry_attempt";

/** Worker transcript event from /api/transcript endpoint */
export interface WorkerTranscriptEvent {
	type: WorkerTranscriptEventType;
	timestamp: number;
	workspaceId: string;
	summary: string;
	data?: Record<string, unknown>;
}

// =============================================================================
// Multi-Project Types (P2 Phase 1)
// =============================================================================

/** Project summary from GET /api/projects */
export interface Project {
	id: string;
	name: string;
	description: string | null;
	rootPath: string | null;
	createdAt: string;
}

/** Plan execution summary from GET /api/projects/:id/plans */
export interface PlanExecution {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: PlanExecutionStatus;
	startedAt: string;
	completedAt: string | null;
}

export type PlanExecutionStatus =
	| "running"
	| "complete"
	| "failed"
	| "paused"
	| "stopped"
	| "cancelled";

/** Plan execution detail from GET /api/projects/:id/plans/:execId */
export interface PlanExecutionDetail {
	planExecutionId: string;
	phase: string;
	title: string;
	status: string;
	startedAt: number;
	completedAt: number | null;
	workspaces: WorkspaceSummary[];
}

export interface WorkspaceSummary {
	id: string;
	stage: string;
	attempts: number;
	error: string | null;
	startedAt: number | null;
	completedAt: number | null;
	// Context / pulse fields (optional — backend may enrich workspace detail)
	contextUsed?: number;
	contextLimit?: number;
	updatedAt?: number;
	/** Timestamp of last meaningful workspace activity (journal/tool/log/edit/validation/transcript event). */
	lastActivityAt?: number;
	/** Human-readable description of what caused the last activity (e.g. "journal", "tool_call", "edit", "validation", "transcript"). */
	lastActivitySource?: string;
	// Git metadata (optional)
	gitBranch?: string;
	gitDirty?: boolean;
	gitCommits?: string[];
	// Edit strategy audit summary (P4.5)
	editAuditSummary?: {
		editModeUsed?: string;
		blockedRewrites: number;
		truncationEvents: number;
		exactMatchFailures: number;
		handoffs: number;
		estimatedWastePrevented: number;
	};
}

/** Workspace detail with owned files */
export interface WorkspaceDetail {
	workspaceId: string;
	stage: string;
	attempts: number;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	ownedFiles?: string[];
}

/** Journal event from new SSE endpoint */
export interface JournalEvent {
	type: string;
	timestamp: number;
	workspaceId?: string;
	data?: Record<string, unknown>;
}

/** Execution statistics */
export interface ExecutionStats {
	total: number;
	pending: number;
	active: number;
	complete: number;
	blocked: number;
	failed: number;
	total_tokens_in?: number;
	total_tokens_out?: number;
	cache_hit_rate?: number;
	estimated_cost_usd?: number;
	burn_rate_per_min?: number;
	/** Whether cache_hit_rate is known; false means the backend hasn't tracked it yet. */
	cache_hit_rate_known?: boolean;
	/** Tokens per completed workspace (total_tokens / complete count). */
	tokens_per_workspace?: number;
	/** Tokens per percent progress (total_tokens / (complete/total*100)). Undefined when total === 0. */
	tokens_per_percent?: number;
}

/** Paginated journal response */
export interface JournalPage {
	events: JournalEvent[];
	total: number;
	limit: number;
	offset: number;
}

/** A single attempt in a workspace's retry history */
export interface WorkspaceAttempt {
	attempt: number;
	role: "worker" | "flash" | "reviewer" | "final";
	startedAt: number | null;
	completedAt: number | null;
	duration: number | null;
	verdict: "running" | "complete" | "failed";
	error: string | null;
}

/** Git file change from /git-diff endpoint */
export interface GitFileChange {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged";
	additions: number;
	deletions: number;
}

/** Git file patch from /git-diff?format=patch endpoint */
export interface GitFilePatch {
	path: string;
	status: GitFileChange["status"];
	patch: string;
	truncated: boolean;
	truncatedLines: number;
}
