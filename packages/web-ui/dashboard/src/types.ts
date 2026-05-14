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
	/** Prefix/suffix token split for prompt assembly. */
	tokenSplit?: {
		prefixTokenCount: number | null;
		suffixTokenCount: number | null;
		totalTokenCount: number | null;
	};
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

// =============================================================================
// Performance Telemetry Types (workspace 5.5.G)
// =============================================================================

/** Performance telemetry for a single workspace's prompt cache. */
export interface CachePerformanceMetrics {
	/** Cache hit rate as a decimal (0.0 – 1.0). null/undefined means unknown. */
	cacheHitRate: number | null;
	/** Whether cache_hit_rate is known; false means the backend hasn't tracked it yet. */
	cacheHitRateKnown: boolean;
	/** Cache creation input tokens (tokens written to cache). */
	cacheCreationInputTokens: number | null;
	/** Cache read input tokens (tokens served from cache). */
	cacheReadInputTokens: number | null;
}

/** Token split for prefix vs suffix in a workspace's prompt assembly. */
export interface TokenSplitMetrics {
	/** Estimated tokens in the cacheable prefix (system prompt + tools + pinned messages). */
	prefixTokenCount: number | null;
	/** Estimated tokens in the dynamic suffix (recent messages, user input). */
	suffixTokenCount: number | null;
	/** Total tokens (prefix + suffix). */
	totalTokenCount: number | null;
}

/** Validation lock performance metrics for a workspace. */
export interface ValidationLockMetrics {
	/** Number of times the workspace waited for the validation lock. */
	lockWaits: number;
	/** Total time (ms) spent waiting for the validation lock across all waits. */
	totalLockWaitMs: number | null;
	/** Longest single lock wait (ms). */
	maxLockWaitMs: number | null;
	/** Average lock wait (ms); null when lockWaits === 0. */
	avgLockWaitMs: number | null;
}

/** Full performance telemetry for a workspace. */
export interface WorkspacePerformanceMetrics {
	/** Workspace ID these metrics belong to. */
	workspaceId: string;
	/** Cache/prompt performance metrics. */
	cache: CachePerformanceMetrics;
	/** Prefix/suffix token split. */
	tokenSplit: TokenSplitMetrics;
	/** Validation lock performance. */
	validationLock: ValidationLockMetrics;
}

// =============================================================================
// Parallelism Preview Types (workspace 7.F)
// =============================================================================

/** A node in the dependency graph, as returned by the validate endpoint. */
export interface DependencyGraphNode {
	/** Workspace ID */
	id: string;
	/** Workspace title */
	title: string;
	/** IDs of workspaces this workspace depends on */
	dependencies: string[];
	/** IDs of workspaces that depend on this workspace */
	dependents: string[];
	/** Batch index (1-based) from topological sort */
	batchIndex: number;
}

/** A topological batch of workspaces from the parallelism preview. */
export interface TopologicalBatch {
	/** 1-based batch index */
	batchIndex: number;
	/** Workspace IDs in this batch */
	workspaceIds: string[];
	/** Number of workspaces in this batch */
	width: number;
}

/** A dependency patch operation for the preview PATCH endpoint. */
export interface DependencyPatch {
	/** Workspace ID to modify */
	workspaceId: string;
	/** Type of patch operation */
	action: "add_dependency" | "remove_dependency";
	/** Dependency ID to add or remove */
	dependencyId: string;
}

/** A suggested fix for a plan issue. */
export interface SuggestedFix {
	/** Fix identifier */
	id: string;
	/** Category of the fix */
	category: "remove_dependency" | "add_dependency" | "reorder_workspace" | "adjust_parallelism" | "resolve_cycle";
	/** Human-readable description */
	description: string;
	/** Workspace IDs affected */
	workspaceIds: string[];
	/** The patch to apply (if applicable) */
	patch?: DependencyPatch;
}

/** Warning about the batch plan from parallelism preview. */
export interface BatchPlanWarning {
	type: "over_serialized" | "low_effective_parallelism" | "single_width_batch";
	message: string;
	workspaceIds?: string[];
	batchIndex?: number;
}

/** Error that prevented batch computation. */
export interface BatchPlanError {
	type: "cycle" | "missing_dependency" | "empty_queue";
	message: string;
	workspaceIds?: string[];
}

/** Result of the batch plan computation from the validate endpoint. */
export interface BatchPlanResult {
	/** Dependency graph nodes */
	dependencyGraph: DependencyGraphNode[];
	/** Topological batches */
	batches: TopologicalBatch[];
	/** Total number of batches */
	totalBatches: number;
	/** Maximum width across all batches */
	effectiveParallelism: number;
	/** The maxParallelWorkspaces from the queue */
	requestedParallelism: number;
	/** Delta between requested and effective */
	parallelismDelta: number;
	/** Whether plan is over-serialized (requested > 1 but effective = 1) */
	isOverSerialized: boolean;
	/** Warnings about the batch plan */
	warnings: BatchPlanWarning[];
	/** Errors that prevented computation */
	errors: BatchPlanError[];
}

/** Result of applying dependency patches (preview PATCH endpoint response). */
export interface PreviewResult {
	/** Whether the preview was successfully computed */
	success: boolean;
	/** Updated batch plan result after patches */
	batchPlan?: BatchPlanResult;
	/** Validation errors from the patched queue */
	errors: string[];
	/** Warnings from the patched queue */
	warnings: string[];
	/** Patches that were applied */
	appliedPatches: DependencyPatch[];
	/** Patches that could not be applied */
	rejectedPatches: Array<{ patch: DependencyPatch; reason: string }>;
}

/** Full response from POST /plans/validate with parallelism preview data. */
export interface ValidateWithPreviewResponse {
	success: boolean;
	parseResult?: {
		title: string;
		phase: string;
		workspaceCount: number;
		maxParallel: number;
	};
	safety?: {
		safe: boolean;
		critical: Array<{ type: string; message: string }>;
		warnings: Array<{ type: string; message: string }>;
	};
	errors?: string[];
	warnings?: string[];
	/** Parallelism preview batch analysis */
	batchPlan?: BatchPlanResult;
	/** Suggested fixes for dependency issues */
	suggestedFixes?: SuggestedFix[];
	/** Whether the plan requires interactive approval before running */
	requiresApproval?: boolean;
}

// =============================================================================
// Scale Readiness Types (workspace 6.5.C)
// =============================================================================

/** Scale mode prerequisite status. */
export interface PrerequisiteStatus {
	key: string;
	name: string;
	met: boolean;
	message: string;
}

/** Scale mode readiness from the API. */
export interface ScaleModeReadiness {
	ready: boolean;
	currentMode: "stable_3" | "experimental_6" | "scale_8";
	isScaleModeActive: boolean;
	prerequisites: PrerequisiteStatus[];
	blockedReasons: string[];
	warnings: string[];
	requestedWorkers: number;
	maxAllowedWorkers: number;
	experimentalModeEnabled: boolean;
}
