/**
 * Execution Read Model — P40 Platform / Agent Separation
 *
 * Read model interfaces for querying execution state.
 * These are the ONLY way external consumers (Brain, Web, UI) should read
 * execution state. Direct access to state-store or DB is forbidden.
 *
 * DATA AVAILABILITY CONVENTION:
 * All read model methods MUST return real data when available and explicit
 * "not available" markers when they are not. This prevents consumers from
 * displaying stale or misleading state. The `available` boolean on response
 * wrappers or explicit `null`/empty arrays with documentation constitutes
 * compliance.
 *
 * UNIMPLEMENTED SOURCES:
 * The following data sources are not yet available through the read model
 * and require dedicated persistence or filesystem access:
 *   - File content retrieval needs worktree snapshot store
 *   - File diff retrieval needs git access or pre/post snapshot pairs
 *   - Dependency graph needs execution plan parser integration
 *   - Stats aggregation requires event counting from journal
 */

import type { WorkerTranscriptEvent } from "./worker-transcript.js";

// ---------------------------------------------------------------------------
// Data Availability Sentinel
// ---------------------------------------------------------------------------

/**
 * Universal sentinel for data that is not available from any backend.
 * Consumers check `.available` to decide whether to render the data or
 * show an explicit "not available" message.
 */
export interface DataAvailability {
	/** Whether the data is available from the current backend */
	available: boolean;
	/** Human-readable explanation of why data is unavailable */
	reason?: string;
}

// ---------------------------------------------------------------------------
// Plan Execution Summary
// ---------------------------------------------------------------------------

export interface PlanExecutionSummary {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
	/** Whether this data is backed by real sources or fallback defaults */
	dataAvailability?: DataAvailability;
}

// ---------------------------------------------------------------------------
// Plan Execution Stats
// ---------------------------------------------------------------------------

/**
 * Aggregated statistics for a plan execution, computed from journal events.
 * All numeric fields default to 0 when events are not yet available.
 */
export interface PlanExecutionStats {
	/** Plan execution ID */
	planExecutionId: string;
	/** Total number of workspaces in the plan */
	totalWorkspaces: number;
	/** Number of completed workspaces */
	completedWorkspaces: number;
	/** Number of failed workspaces */
	failedWorkspaces: number;
	/** Number of blocked workspaces */
	blockedWorkspaces: number;
	/** Number of running workspaces */
	runningWorkspaces: number;
	/** Number of pending workspaces */
	pendingWorkspaces: number;
	/** Number of cancelled workspaces */
	cancelledWorkspaces: number;
	/** Number of skipped workspaces */
	skippedWorkspaces: number;
	/** Total duration in ms (from first workspace start to last completion/failure) */
	durationMs: number | null;
	/** When the stats were computed (ISO string) */
	computedAt: string;
	/** Whether the stats are backed by real event data */
	dataSource: "events" | "state-store" | "unavailable";
}

// ---------------------------------------------------------------------------
// Dependency Graph View
// ---------------------------------------------------------------------------

/**
 * A single node in the workspace dependency graph.
 * Represents a workspace and its dependencies on other workspaces.
 */
export interface DependencyGraphNode {
	/** Workspace ID */
	id: string;
	/** Workspace title (if available) */
	title?: string;
	/** IDs of workspaces this workspace depends on */
	dependsOn: string[];
	/** Batch number in the execution plan (0-indexed) */
	batch: number;
	/** Current stage of this workspace */
	stage: string;
}

/**
 * The complete dependency graph for a plan execution.
 * Includes all workspaces, their dependency relationships,
 * and computed batch assignments.
 */
export interface DependencyGraphView {
	/** Plan execution ID */
	planExecutionId: string;
	/** All workspace nodes with their dependencies */
	nodes: DependencyGraphNode[];
	/** Total number of batches in the execution plan */
	totalBatches: number;
	/** Whether the dependency graph data is backed by real plan data */
	dataAvailability: DataAvailability;
}

// ---------------------------------------------------------------------------
// Artifact Entry (from execution archive)
// ---------------------------------------------------------------------------

/**
 * A file artifact stored in the execution archive.
 * Artifacts are generated files (logs, reports, patches) produced
 * during execution and stored under `.pi/executions/{planExecId}/`.
 *
 * NOTE: Artifact content is served through dedicated artifact-routes.ts
 * endpoints (GET /api/artifacts/:planExecId/*), not through the read model.
 * This interface is for listing available artifacts only.
 */
export interface ArtifactEntry {
	/** Path relative to the execution archive root */
	path: string;
	/** File size in bytes */
	size: number;
	/** Last modification timestamp (ISO string) */
	modifiedAt: string | null;
	/** Whether the artifact is accessible through the read model */
	dataAvailability: DataAvailability;
}

// ---------------------------------------------------------------------------
// Workspace Execution Summary
// ---------------------------------------------------------------------------

export interface WorkspaceExecutionSummary {
	id: string;
	planExecutionId: string;
	workspaceId: string;
	stage: string;
	attempts: number;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	reportPath?: string;
	/** Whether this data is backed by real sources or fallback defaults */
	dataAvailability?: DataAvailability;
}

// ---------------------------------------------------------------------------
// Journal / Event Envelope
// ---------------------------------------------------------------------------

export interface JournalEventEnvelope {
	seq: string;
	eventId: string;
	planExecutionId: string;
	workspaceId?: string;
	eventType: string;
	payload: Record<string, unknown> | null;
	createdAt: string;
}

export interface JournalQuery {
	limit?: number;
	offset?: number;
	eventType?: string;
	workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Command History
// ---------------------------------------------------------------------------

export interface CommandHistoryView {
	command: string;
	cwd: string;
	exitCode: number | null;
	startedAt: number;
	finishedAt: number;
	outputSummary?: string;
	isTargetCommand?: boolean;
}

// ---------------------------------------------------------------------------
// Lead Directive View (P41.09)
// ---------------------------------------------------------------------------

/**
 * A durable view of a Lead Agent directive issued to a worker.
 * Mirrors the LeadDirective from the lead-agent domain.
 */
export interface LeadDirectiveView {
	/** Workspace the directive targets */
	workspaceId: string;
	/** Unique directive ID */
	directiveId: string;
	/** Directive type/category */
	directiveType: string;
	/** Attempt number when issued */
	attemptNumber: number;
	/** Severity level */
	severity: "low" | "medium" | "high" | "blocking";
	/** Human-readable summary of the failure */
	summary: string;
	/** The directed next actions for the worker */
	directive: string;
	/** Actions the worker is allowed to take */
	allowedActions: string[];
	/** Actions the worker is forbidden from taking */
	forbiddenActions: string[];
	/** Maximum additional retries allowed */
	retryBudget: number;
	/** After how many retries to escalate */
	escalateAfter: number;
	/** Current directive status */
	status: "issued" | "acknowledged" | "resolved" | "escalated" | "expired";
	/** Escalation option if escalated */
	escalationOption?: string;
	/** When created (ISO string) */
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Lead Agent Escalation View (P41.09)
// ---------------------------------------------------------------------------

/**
 * View of a user escalation initiated by the Lead Agent.
 */
export interface LeadEscalationView {
	/** Unique escalation ID */
	escalationId: string;
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Severity */
	severity: "low" | "medium" | "high" | "blocking";
	/** Title of the escalation */
	title: string;
	/** Human-readable summary */
	summary: string;
	/** What happened */
	whatHappened: string;
	/** Why the worker is stuck */
	whyStuck: string;
	/** Options for the user */
	options: Array<{ id: string; label: string; risk: string; description?: string }>;
	/** Recommended option */
	recommendedOptionId: string;
	/** Evidence references */
	evidenceRefs: string[];
	/** Log paths to inspect */
	logsToInspect: string[];
	/** Current status */
	status: "awaiting_user" | "user_responded" | "resolved" | "expired";
	/** User's chosen option if responded */
	userChoice?: string;
	/** User's response message if responded */
	userResponse?: string;
	/** When created (ISO string) */
	createdAt: string;
	/** When resolved (ISO string) */
	resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// File Tree Read Model (P41.06)
// ---------------------------------------------------------------------------

/**
 * Change status for a file entry.
 */
export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged";

/**
 * A file entry with change metadata.
 * Represents a single file changed during workspace execution.
 */
export interface ChangedFileEntry {
	/** File path relative to workspace root */
	path: string;
	/** File name (basename) */
	name: string;
	/** File extension */
	ext: string;
	/** Type of change detected */
	status: FileChangeStatus;
	/** Number of lines added (if available) */
	additions?: number;
	/** Number of lines deleted (if available) */
	deletions?: number;
	/** File size in bytes (if available) */
	size?: number;
}

/**
 * A node in the hierarchical file tree.
 * Directories contain children; leaf nodes represent files.
 */
export interface FileTreeNode {
	/** File path relative to workspace root */
	path: string;
	/** File/directory name */
	name: string;
	/** File extension (empty string for directories) */
	ext: string;
	/** Change status */
	status: FileChangeStatus;
	/** Whether this is a directory */
	isDir: boolean;
	/** Number of lines added (aggregated for directories) */
	additions?: number;
	/** Number of lines deleted (aggregated for directories) */
	deletions?: number;
	/** Child nodes (directory entries only) */
	children?: FileTreeNode[];
}

/**
 * Content of a file from a workspace execution.
 */
export interface FileContentView {
	/** File path relative to workspace root */
	path: string;
	/** File content as text (null for binary files) */
	content: string | null;
	/** Base64-encoded content for binary files */
	base64Content?: string | null;
	/** Whether the file is binary */
	isBinary: boolean;
	/** File size in bytes */
	size: number;
	/** Programming language detected from extension */
	language?: string;
	/** Whether content was truncated due to size limits */
	truncated?: boolean;
}

/**
 * Diff output for files changed in a workspace execution.
 */
export interface FileDiffView {
	/** File path relative to workspace root */
	path: string;
	/** Change status */
	status: FileChangeStatus;
	/** Unified diff content */
	diff: string;
	/** Number of lines added */
	additions: number;
	/** Number of lines deleted */
	deletions: number;
	/** Whether the diff was truncated */
	truncated?: boolean;
}

/**
 * Query options for the file tree read model methods.
 */
export interface FileTreeQuery {
	/** Include file content in the response */
	includeContent?: boolean;
	/** Maximum file size to include (in bytes) */
	maxFileSize?: number;
	/** Maximum lines per diff */
	maxDiffLines?: number;
	/** Return flat list instead of tree structure */
	flat?: boolean;
}

// ---------------------------------------------------------------------------
// Worker Context View (P41.08)
// ---------------------------------------------------------------------------

/**
 * Worker context view — exposes the context packet, role, goals, allowed/touched
 * files, transcript link, and Lead Agent state for a worker running in a workspace.
 *
 * This read model collects static packet data (from the execution archive) with
 * dynamic runtime state (current stage, retry count, lead directives) and provides
 * a link to the transcript SSE endpoint for real-time event streaming.
 */
export interface WorkerContextView {
	/** Workspace ID */
	workspaceId: string;
	/** Plan execution ID */
	planExecutionId: string;

	// -- Workspace state --
	/** Current workspace stage (Pending, Running, Complete, Failed, Blocked, Cancelled) */
	stage: string;
	/** Retry attempt count */
	attempts: number;
	/** Error message if the workspace failed or is blocked */
	error?: string;
	/** Started at ISO timestamp */
	startedAt?: string;
	/** Completed at ISO timestamp */
	completedAt?: string;

	// -- Goal & Role --
	/** Goal description extracted from the workspace packet or workspace definition */
	goal?: string;
	/** Role/agent type assigned to this worker (e.g. "coder", "reviewer") */
	role?: string;

	// -- Packets --
	/**
	 * Full role packet content from the execution archive (packet.md).
	 * Contains the brief/goal given to the worker agent.
	 */
	rolePacketContent?: string;
	/**
	 * Context packet summary — what context was provided to the worker
	 * (e.g. file paths, prior workspace results, constraints).
	 * A sanitized excerpt from the packet, not the full raw prompt.
	 */
	contextPacketSummary?: string;

	// -- File access --
	/** Files the worker is allowed to edit (from the workspace definition) */
	allowedFiles: string[];
	/** Files the worker touched during execution (from archive files-touched.json) */
	touchedFiles: Array<{ path: string; change: "created" | "modified" | "deleted" }>;

	// -- Command history --
	/** Last command executed by the worker, if available */
	lastCommand?: string;
	/** Short stdout/stderr summary from recent logs */
	logSummary?: string;

	// -- Lead Agent state --
	/** Active Lead Agent directives for this workspace */
	activeDirectives: LeadDirectiveView[];
	/** Active escalations (should be at most one) */
	activeEscalations: LeadEscalationView[];
	/** Human directive message, if one was issued */
	humanDirective?: string;

	// -- Transcript link --
	/** URL path for the SSE transcript stream endpoint (/api/transcript/:planExecId/:workspaceId) */
	transcriptUrl: string;
}

// ---------------------------------------------------------------------------
// Final Validation View
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Completion Status View (P44.10)
// ---------------------------------------------------------------------------

/**
 * Completion status for a workspace, exposed from the completion gate
 * evaluation. Provides insight into whether a workspace can be completed
 * and, if blocked, what the reasons and recommended state are.
 *
 * DATA SOURCE: Completion status is extracted from
 * `completion_gate_blocked_visible` journal events which contain the block
 * reasons and recommended transition. If no such event exists, the workspace
 * is either not yet evaluated or was completed without blockage.
 */
/**
 * Workspace truth status view for the dashboard.
 * Exposes separate runtime, implementation, validation, and durability dimensions.
 */
export interface WorkspaceTruthStatusView {
	/** Runtime execution status */
	runtimeStatus: string;
	/** Implementation existence status */
	implementationStatus: string;
	/** Validation pass/fail status */
	validationStatus: string;
	/** Durability/commit status */
	durabilityStatus: string;
	/** Whether the workspace is fully verified complete (all 4 dimensions) */
	verifiedComplete: boolean;
	/** Backfill status for legacy workspaces */
	backfillStatus: string;
	/** Commit hash (if committed) */
	commitHash?: string;
	/** Files verified in the commit */
	verifiedFiles: string[];
	/** Blockers preventing completion */
	blockers: string[];
	/** Warnings (non-blocking) */
	warnings: string[];
	/** Recommended recovery route */
	recoveryState?: string;
	/** Current rollout mode */
	rolloutMode: string;
	/** Data availability */
	dataAvailability: DataAvailability;
}

export interface CompletionStatusView {
	/** Whether the workspace can be marked as Complete */
	canComplete: boolean;
	/** Reasons why completion is blocked (empty when canComplete is true) */
	blockReasons: string[];
	/** Recommended stage when completion is blocked */
	recommendedStage?: string;
	/** Whether this data is backed by real events or default */
	dataAvailability: DataAvailability;
}

export interface FinalValidationView {
	required: boolean;
	passed: boolean | null;
	blocked: boolean;
	blockReasons: string[];
}

// ---------------------------------------------------------------------------
// Execution Read Model
// ---------------------------------------------------------------------------

export interface ExecutionReadModel {
	/**
	 * Get the worker context for a workspace.
	 * Returns the full context view including role packet, touched files,
	 * command history, lead directives, and transcript link.
	 */
	getWorkerContext(planExecutionId: string, workspaceId: string): Promise<WorkerContextView>;

	getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary>;

	/**
	 * Get aggregated statistics for a plan execution.
	 * Stats are computed from journal events when available.
	 * Returns explicit unavailable state when no event data exists.
	 */
	getPlanStats(planExecutionId: string): Promise<PlanExecutionStats>;

	/**
	 * Get the dependency graph for a plan execution.
	 * Returns workspace nodes with dependency relationships and batch assignments.
	 * The graph is computed from plan_started event payload or state store.
	 * Returns explicit unavailable state when no plan data exists.
	 */
	getDependencyGraph(planExecutionId: string): Promise<DependencyGraphView>;

	getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary>;
	listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]>;

	/**
	 * Get command history for a workspace.
	 * Commands are extracted from command_started/command_finished journal events.
	 * Returns an empty array when no command events exist for the workspace.
	 *
	 * NOTE: Output content is not available through the read model. Streamed
	 * command output is captured by the command_log_stream and must be consumed
	 * via the SSE /api/logs/v2/ endpoint or ICommandLogStream interface.
	 */
	getCommandHistory(planExecutionId: string, workspaceId: string): Promise<CommandHistoryView[]>;

	/**
	 * Get Lead Agent directives for a workspace.
	 * Directives are extracted from lead_agent_directive_issued journal events.
	 * Returns an empty array when no directive events exist for the workspace.
	 */
	getLeadDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]>;

	/**
	 * Get Lead Agent escalations for a workspace.
	 * Escalations are extracted from lead_agent_escalation_initiated journal events.
	 * Returns an empty array when no escalation events exist for the workspace.
	 */
	getLeadEscalations(planExecutionId: string, workspaceId: string): Promise<LeadEscalationView[]>;

	getFinalValidationStatus(planExecutionId: string, workspaceId: string): Promise<FinalValidationView>;

	// -----------------------------------------------------------------------
	// Completion Status (P44.10)
	// -----------------------------------------------------------------------

	/**
	 * Get completion gate status for a workspace.
	 * Returns whether the workspace can be completed, and if blocked,
	 * the block reasons and recommended stage.
	 *
	 * DATA SOURCE: Completion status is extracted from
	 * `completion_gate_blocked_visible` journal events. If no such event
	 * exists and the workspace is in a terminal state, returns `canComplete: true`.
	 * If no events exist at all, returns explicit unavailable state.
	 */
	/**
	 * Get workspace truth status for the dashboard.
	 * Returns separate runtime, implementation, validation, and durability status.
	 * Never returns verifiedComplete=true from runtime complete alone.
	 */
	getWorkspaceTruthStatus(planExecutionId: string, workspaceId: string): Promise<WorkspaceTruthStatusView>;

	getWorkspaceCompletionStatus(planExecutionId: string, workspaceId: string): Promise<CompletionStatusView>;

	// -----------------------------------------------------------------------
	// File Tree Read Model (P41.06)
	// -----------------------------------------------------------------------

	/**
	 * Get the list of files changed during a workspace execution.
	 * Returns an array of file entries with change metadata, or an empty array
	 * if no change information is available.
	 *
	 * DATA SOURCE: Changed files are extracted from worker_completed journal
	 * event payloads (changedFiles field). This only captures file paths, not
	 * diff or content data. For diff/content, consumers must use the worktree
	 * or git-based endpoints directly.
	 */
	getChangedFiles(planExecutionId: string, workspaceId: string): Promise<ChangedFileEntry[]>;

	/**
	 * Get a hierarchical file tree of files changed during a workspace execution.
	 * Returns an array of root-level tree nodes; directories contain children.
	 *
	 * Use options.flat=true to receive a flat list instead of a tree.
	 */
	getFileTree(planExecutionId: string, workspaceId: string, options?: FileTreeQuery): Promise<FileTreeNode[]>;

	/**
	 * Get the content of a specific file from a workspace execution.
	 * Returns null if the file is not found in the workspace's file set.
	 *
	 * NOTE: File content retrieval requires filesystem access to worktree
	 * directories or a snapshot store. The default read model implementation
	 * returns null. Consumers that need file content (e.g., web-server
	 * worktree routes) should implement file content retrieval directly
	 * using filesystem access to the worktree directory.
	 */
	getFileContent(planExecutionId: string, workspaceId: string, filePath: string): Promise<FileContentView | null>;

	/**
	 * Get diff output for files changed in a workspace execution.
	 * If filePath is provided, returns diff only for that file.
	 * If omitted, returns diffs for all changed files.
	 *
	 * Returns an empty array if no diff information is available.
	 *
	 * NOTE: Diff retrieval requires git access or pre/post snapshot pairs
	 * from the snapshot artifact store. The default read model implementation
	 * returns an empty array. Consumers that need diff content should use
	 * the worktree git-diff endpoint directly.
	 */
	getFileDiff(
		planExecutionId: string,
		workspaceId: string,
		filePath?: string,
		options?: FileTreeQuery,
	): Promise<FileDiffView[]>;

	// -----------------------------------------------------------------------
	// Transcript
	// -----------------------------------------------------------------------

	/**
	 * Get transcript events for a workspace execution.
	 * Transcript events are sanitized, UI-safe event summaries derived from
	 * the raw journal events emitted during worker execution.
	 *
	 * Transcripts are persisted by IWorkerTranscriptStore implementations
	 * (e.g., ndjson files under the execution archive, or in-memory store).
	 *
	 * Returns an empty array when no transcript events exist for the given
	 * workspace (no execution data yet, or transcript store unavailable).
	 *
	 * NOTE: This method requires a backing IWorkerTranscriptStore. If the
	 * read model was not constructed with a transcript store, this method
	 * returns an empty array.
	 */
	getTranscript(planExecutionId: string, workspaceId: string): Promise<WorkerTranscriptEvent[]>;

	// -----------------------------------------------------------------------
	// Artifacts
	// -----------------------------------------------------------------------

	/**
	 * List available artifacts in the execution archive for a plan execution.
	 * Artifacts are generated files (logs, reports, patches) stored under
	 * `.pi/executions/{planExecId}/`.
	 *
	 * NOTE: Artifact content is not served through this read model method.
	 * Use the dedicated GET /api/artifacts/:planExecId/* endpoints to read
	 * artifact content with proper path sandboxing.
	 */
	getArtifacts(planExecutionId: string): Promise<ArtifactEntry[]>;
}
