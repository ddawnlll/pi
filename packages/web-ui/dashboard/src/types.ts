/**
 * Plan Dashboard Types
 * Matches the data structures from .pi/ directory
 */

// =============================================================================
// Legacy Types (backward compat)
// =============================================================================

export interface PlanState {
	title: string;
	phase: string;
	status: "running" | "paused" | "stopped" | "completed" | "failed";
	elapsed: number;
	queue: {
		pending: number;
		active: number;
		blocked: number;
		complete: number;
		failed: number;
	};
	workers: WorkerInfo[];
	startedAt?: string;
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

export type LogStream = "stdout" | "stderr" | "test" | "error";

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
}

/** Paginated journal response */
export interface JournalPage {
	events: JournalEvent[];
	total: number;
	limit: number;
	offset: number;
}
