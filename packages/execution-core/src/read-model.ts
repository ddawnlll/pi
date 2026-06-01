/**
 * Execution Read Model — P40 Platform / Agent Separation
 *
 * Read model interfaces for querying execution state.
 * These are the ONLY way external consumers (Brain, Web, UI) should read
 * execution state. Direct access to state-store or DB is forbidden.
 */

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
// Final Validation View
// ---------------------------------------------------------------------------

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
	getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary>;
	getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary>;
	listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]>;
	getCommandHistory(planExecutionId: string, workspaceId: string): Promise<CommandHistoryView[]>;
	getLeadDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]>;
	getLeadEscalations(planExecutionId: string, workspaceId: string): Promise<LeadEscalationView[]>;
	getFinalValidationStatus(planExecutionId: string, workspaceId: string): Promise<FinalValidationView>;

	// -----------------------------------------------------------------------
	// File Tree Read Model (P41.06)
	// -----------------------------------------------------------------------

	/**
	 * Get the list of files changed during a workspace execution.
	 * Returns an array of file entries with change metadata, or an empty array
	 * if no change information is available.
	 */
	getChangedFiles(
		planExecutionId: string,
		workspaceId: string,
	): Promise<ChangedFileEntry[]>;

	/**
	 * Get a hierarchical file tree of files changed during a workspace execution.
	 * Returns an array of root-level tree nodes; directories contain children.
	 *
	 * Use options.flat=true to receive a flat list instead of a tree.
	 */
	getFileTree(
		planExecutionId: string,
		workspaceId: string,
		options?: FileTreeQuery,
	): Promise<FileTreeNode[]>;

	/**
	 * Get the content of a specific file from a workspace execution.
	 * Returns null if the file is not found in the workspace's file set.
	 */
	getFileContent(
		planExecutionId: string,
		workspaceId: string,
		filePath: string,
	): Promise<FileContentView | null>;

	/**
	 * Get diff output for files changed in a workspace execution.
	 * If filePath is provided, returns diff only for that file.
	 * If omitted, returns diffs for all changed files.
	 *
	 * Returns an empty array if no diff information is available.
	 */
	getFileDiff(
		planExecutionId: string,
		workspaceId: string,
		filePath?: string,
		options?: FileTreeQuery,
	): Promise<FileDiffView[]>;
}
