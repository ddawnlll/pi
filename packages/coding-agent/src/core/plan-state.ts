/**
 * State Store + Report System - P2 Workstream 7.C
 *
 * Manages workspace execution state, persistence, and execution journal.
 * State is stored in .pi/plan-state.json (atomic writes).
 * Journal is stored in .pi/execution-journal.ndjson (append-only, crash-safe).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EditStrategyAuditSummary } from "./edit-audit-events.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

/**
 * Workspace execution state
 */
export interface WorkspaceState {
	/** Workspace ID */
	workspaceId: string;
	/** Current stage */
	stage: WorkspaceStage;
	/** Number of retry attempts */
	attempts: number;
	/** Timestamp when workspace started */
	startedAt?: number;
	/** Timestamp when workspace completed/failed */
	completedAt?: number;
	/** Error message (if failed) */
	error?: string;
	/** Report file path (if generated) */
	reportPath?: string;
	/** Files currently owned by this workspace (for locking) */
	ownedFiles?: string[];
	/** Edit strategy audit summary (P4.5) */
	editAuditSummary?: EditStrategyAuditSummary;
}

/**
 * Plan execution state
 */
export interface PlanState {
	/** Phase identifier */
	phase: string;
	/** Plan title */
	title: string;
	/** Workspace states */
	workspaces: Map<string, WorkspaceState>;
	/** Timestamp when execution started */
	startedAt: number;
	/** Timestamp when execution completed */
	completedAt?: number;
	/** Overall execution status */
	status: "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled" | "awaiting_handoff";
	/** Timestamp when handoff state was entered (if awaiting_handoff) */
	handoffStartedAt?: number;
	/** Metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Execution journal event types
 */
export type JournalEventType =
	| "plan_start"
	| "plan_complete"
	| "plan_failed"
	| "plan_paused"
	| "plan_stopped"
	| "plan_cancelled"
	| "plan_pause_requested"
	| "plan_stop_requested"
	| "plan_cancel_requested"
	| "plan_resumed"
	| "plan_handoff"
	| "plan_handoff_committed"
	| "plan_handoff_keep"
	| "plan_handoff_discard"
	| "tool_call"
	| "workspace_start"
	| "workspace_complete"
	| "workspace_failed"
	| "workspace_blocked"
	| "retry_attempt"
	| "file_lock_acquired"
	| "file_lock_released"
	| "worker_status"
	| "worker_decision_summary"
	| "validation"
	| "blocker";

/**
 * Execution journal event
 */
export interface JournalEvent {
	/** Event type */
	type: JournalEventType;
	/** Timestamp */
	timestamp: number;
	/** Workspace ID (if applicable) */
	workspaceId?: string;
	/** Event data */
	data?: Record<string, unknown>;
}

/**
 * Worker transcript event — a sanitized, UI-safe event emitted by the worker
 * during execution. Unlike raw chain-of-thought (which is never emitted),
 * these events are safe for dashboard rendering and archival.
 *
 * Transcript events are archived to .pi/executions/{planExecId}/workspaces/{workspaceId}/transcript.ndjson
 */
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

export interface WorkerTranscriptEvent {
	/** Event type */
	type: WorkerTranscriptEventType;
	/** Timestamp */
	timestamp: number;
	/** Workspace ID */
	workspaceId: string;
	/** Human-readable summary (no private chain-of-thought) */
	summary: string;
	/** Event data (sanitized — no raw thinking/chain-of-thought content) */
	data?: Record<string, unknown>;
}

/** Keys that are stripped from transcript event data to prevent leaking private chain-of-thought */
const PRIVATE_DATA_KEYS: ReadonlySet<string> = new Set([
	"thinking",
	"thinkingContent",
	"chainOfThought",
	"rawThinking",
	"privateReasoning",
	"internalMonologue",
	"reasoning",
]);

/**
 * Sanitize event data for safe emission — strips private chain-of-thought fields.
 *
 * @param data - Raw event data
 * @returns Sanitized data safe for transcript archival and UI rendering
 */
export function sanitizeTranscriptData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!data) return undefined;
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (PRIVATE_DATA_KEYS.has(key)) continue;
		// Recursively sanitize nested objects
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			sanitized[key] = sanitizeTranscriptData(value as Record<string, unknown>);
		} else {
			sanitized[key] = value;
		}
	}
	return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Create a worker transcript event from a journal event, adding sanitization and summary.
 *
 * @param event - Source journal event
 * @param summary - Human-readable summary of the event
 * @returns Sanitized transcript event, or null if the event should not be recorded
 */
export function createWorkerTranscriptEvent(event: JournalEvent, summary: string): WorkerTranscriptEvent | null {
	if (!event.workspaceId) return null;
	// Never turn private-thinking events into transcript events
	if (event.type === ("thinking" as JournalEventType) || event.type === ("chain_of_thought" as JournalEventType)) {
		return null;
	}
	return {
		type: event.type as WorkerTranscriptEventType,
		timestamp: event.timestamp,
		workspaceId: event.workspaceId,
		summary,
		data: sanitizeTranscriptData(event.data),
	};
}

/**
 * Build a human-readable summary for a worker transcript event.
 *
 * @param event - Journal event
 * @returns Readable summary string
 */
export function buildTranscriptSummary(event: JournalEvent): string {
	const ws = event.workspaceId ?? "unknown";
	switch (event.type) {
		case "worker_status":
			return `Worker ${ws}: ${(event.data?.status as string) ?? "unknown"}${event.data?.message ? ` — ${event.data.message}` : ""}`;
		case "worker_decision_summary":
			return `Worker ${ws} decision: ${(event.data?.summary as string) ?? "no summary"}`;
		case "validation": {
			const passed = event.data?.passed as boolean | undefined;
			const criterion = (event.data?.criterion as string) ?? "unknown";
			return `Worker ${ws} validation ${passed ? "passed" : "failed"}: ${criterion}`;
		}
		case "blocker":
			return `Worker ${ws} blocker: ${(event.data?.reason as string) ?? "unknown blocker"}`;
		case "tool_call":
			return `Worker ${ws} tool call: ${(event.data?.toolName as string) ?? "unknown"}`;
		case "workspace_start":
			return `Worker ${ws} started`;
		case "workspace_complete":
			return `Worker ${ws} completed`;
		case "workspace_failed":
			return `Worker ${ws} failed: ${(event.data?.error as string) ?? "unknown error"}`;
		case "workspace_blocked":
			return `Worker ${ws} blocked: ${(event.data?.reason as string) ?? "unknown"}`;
		case "retry_attempt":
			return `Worker ${ws} retry attempt ${(event.data?.attempt as number) ?? "?"}`;
		default:
			return `Worker ${ws} ${event.type}`;
	}
}

/**
 * State store manager
 *
 * Manages plan execution state with atomic persistence and crash-safe journaling.
 */
export class PlanStateStore {
	private state: PlanState | null = null;
	private stateFilePath: string;
	private journalFilePath: string;

	/** Mutex to serialize concurrent saveState() calls (race: #1) */
	private saveMutex: Promise<void> = Promise.resolve();

	constructor(workspaceRoot: string, piDir = ".pi") {
		this.stateFilePath = path.join(workspaceRoot, piDir, "plan-state.json");
		this.journalFilePath = path.join(workspaceRoot, piDir, "execution-journal.ndjson");
	}

	/**
	 * Initialize state for a new plan execution
	 *
	 * @param queue - Workspace queue
	 * @returns Initialized state
	 */
	async initializeState(queue: WorkspaceQueue): Promise<PlanState> {
		const workspaces = new Map<string, WorkspaceState>();

		for (const workspace of queue.workspaces) {
			workspaces.set(workspace.id, {
				workspaceId: workspace.id,
				stage: WorkspaceStage.Pending,
				attempts: 0,
			});
		}

		this.state = {
			phase: queue.phase,
			title: queue.title,
			workspaces,
			startedAt: Date.now(),
			status: "running",
		};

		await this.saveState();
		await this.appendJournal({
			type: "plan_start",
			timestamp: Date.now(),
			data: { phase: queue.phase, title: queue.title },
		});

		return this.state;
	}

	/**
	 * Load state from disk
	 *
	 * @returns Loaded state or null if not found
	 */
	async loadState(): Promise<PlanState | null> {
		try {
			const content = await fs.readFile(this.stateFilePath, "utf-8");
			const parsed = JSON.parse(content);

			// Convert workspaces array to Map
			const workspaces = new Map<string, WorkspaceState>();
			if (Array.isArray(parsed.workspaces)) {
				for (const ws of parsed.workspaces) {
					workspaces.set(ws.workspaceId, ws);
				}
			} else if (parsed.workspaces && typeof parsed.workspaces === "object") {
				// Handle object format
				for (const [id, ws] of Object.entries(parsed.workspaces)) {
					workspaces.set(id, ws as WorkspaceState);
				}
			}

			this.state = {
				...parsed,
				workspaces,
			};

			return this.state;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Save state to disk (atomic write)
	 */
	async saveState(): Promise<void> {
		if (!this.state) {
			throw new Error("No state to save");
		}

		// Serialize concurrent saves via promise-chain mutex
		await this.saveMutex;
		let release!: () => void;
		this.saveMutex = new Promise<void>((resolve) => {
			release = resolve;
		});

		try {
			// Ensure .pi directory exists
			const piDir = path.dirname(this.stateFilePath);
			await fs.mkdir(piDir, { recursive: true });

			// Convert Map to array for JSON serialization
			const serializable = {
				...this.state,
				workspaces: Array.from(this.state.workspaces.values()),
			};

			// Atomic write: write to unique temp file, then rename
			const tempPath = `${this.stateFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
			await fs.writeFile(tempPath, JSON.stringify(serializable, null, 2), "utf-8");
			await fs.rename(tempPath, this.stateFilePath);
		} finally {
			release();
		}
	}

	/**
	 * Append event to execution journal (crash-safe)
	 *
	 * Also archives a sanitized transcript event to the workspace transcript ndjson
	 * if the event has a workspaceId and is a transcript-worthy type.
	 * Private chain-of-thought fields are never emitted to the transcript.
	 *
	 * @param event - Journal event
	 */
	async appendJournal(event: JournalEvent): Promise<void> {
		// Ensure .pi directory exists
		const piDir = path.dirname(this.journalFilePath);
		await fs.mkdir(piDir, { recursive: true });

		// Append as NDJSON (one JSON object per line)
		const line = `${JSON.stringify(event)}\n`;
		await fs.appendFile(this.journalFilePath, line, "utf-8");

		// Archive transcript event for workspace-level timeline
		// Requires planExecutionId — infer from the journal path structure
		if (event.workspaceId) {
			const summary = buildTranscriptSummary(event);
			const transcriptEvent = createWorkerTranscriptEvent(event, summary);
			if (transcriptEvent) {
				const planExecId = this.inferPlanExecutionId();
				if (planExecId) {
					await this.appendWorkerTranscriptEvent(planExecId, event.workspaceId, transcriptEvent).catch(() => {
						// Transcript archiving failure must not break the journal
					});
				}
			}
		}
	}

	/**
	 * Try to infer the current plan execution ID from the running execution context.
	 * Falls back to reading the most recent execution directory under .pi/executions/.
	 */
	private inferPlanExecutionId(): string | null {
		return this._currentPlanExecutionId;
	}

	/** Set the current plan execution ID for transcript archiving */
	setCurrentPlanExecutionId(id: string): void {
		this._currentPlanExecutionId = id;
	}

	private _currentPlanExecutionId: string | null = null;

	/**
	 * Read execution journal
	 *
	 * @returns Array of journal events
	 */
	async readJournal(): Promise<JournalEvent[]> {
		try {
			const content = await fs.readFile(this.journalFilePath, "utf-8");
			const lines = content.trim().split("\n");
			return lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Update workspace state
	 *
	 * @param workspaceId - Workspace ID
	 * @param updates - State updates
	 */
	async updateWorkspaceState(workspaceId: string, updates: Partial<WorkspaceState>): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		const current = this.state.workspaces.get(workspaceId);
		if (!current) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}

		const updated = { ...current, ...updates };
		this.state.workspaces.set(workspaceId, updated);

		await this.saveState();
	}

	/**
	 * Transition workspace to a new stage
	 *
	 * @param workspaceId - Workspace ID
	 * @param newStage - New stage
	 * @param data - Additional data for journal
	 */
	async transitionWorkspace(
		workspaceId: string,
		newStage: WorkspaceStage,
		data?: Record<string, unknown>,
	): Promise<void> {
		const current = this.state?.workspaces.get(workspaceId);
		if (!current) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}

		const updates: Partial<WorkspaceState> = { stage: newStage };

		// Update timestamps
		if (newStage === WorkspaceStage.Active && !current.startedAt) {
			updates.startedAt = Date.now();
		}
		if (newStage === WorkspaceStage.Active && current.error) {
			updates.error = undefined; // Clear previous error on retry
		}
		if ((newStage === WorkspaceStage.Complete || newStage === WorkspaceStage.Failed) && !current.completedAt) {
			updates.completedAt = Date.now();
		}

		await this.updateWorkspaceState(workspaceId, updates);

		// Log to journal
		const eventType = this.getJournalEventType(newStage);
		if (eventType) {
			await this.appendJournal({
				type: eventType,
				timestamp: Date.now(),
				workspaceId,
				data,
			});
		}
	}

	/**
	 * Increment retry attempt counter
	 *
	 * @param workspaceId - Workspace ID
	 */
	async incrementRetryAttempt(workspaceId: string): Promise<void> {
		const current = this.state?.workspaces.get(workspaceId);
		if (!current) {
			throw new Error(`Workspace not found: ${workspaceId}`);
		}

		await this.updateWorkspaceState(workspaceId, {
			attempts: current.attempts + 1,
		});

		await this.appendJournal({
			type: "retry_attempt",
			timestamp: Date.now(),
			workspaceId,
			data: { attempt: current.attempts + 1 },
		});
	}

	/**
	 * Acquire file locks for a workspace
	 *
	 * @param workspaceId - Workspace ID
	 * @param files - Files to lock
	 */
	async acquireFileLocks(workspaceId: string, files: string[]): Promise<void> {
		await this.updateWorkspaceState(workspaceId, {
			ownedFiles: files,
		});

		await this.appendJournal({
			type: "file_lock_acquired",
			timestamp: Date.now(),
			workspaceId,
			data: { files },
		});
	}

	/**
	 * Release file locks for a workspace
	 *
	 * @param workspaceId - Workspace ID
	 */
	async releaseFileLocks(workspaceId: string): Promise<void> {
		await this.updateWorkspaceState(workspaceId, {
			ownedFiles: [],
		});

		await this.appendJournal({
			type: "file_lock_released",
			timestamp: Date.now(),
			workspaceId,
		});
	}

	/**
	 * Mark plan as complete
	 */
	async completePlan(): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "complete";
		this.state.completedAt = Date.now();

		await this.saveState();
		await this.appendJournal({
			type: "plan_complete",
			timestamp: Date.now(),
		});
	}

	/**
	 * Set plan to awaiting_handoff state.
	 * Emits plan_handoff journal event before the plan is finalized.
	 *
	 * @param planTitle - Plan title for handoff summary
	 */
	async setAwaitingHandoff(planTitle: string): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		// Emit plan_handoff journal event before transitioning state
		await this.appendJournal({
			type: "plan_handoff",
			timestamp: Date.now(),
			data: { title: planTitle },
		});

		this.state.status = "awaiting_handoff";
		this.state.handoffStartedAt = Date.now();

		await this.saveState();
	}

	/**
	 * Finalize handoff: commit and mark plan complete.
	 * Called when user chooses "Commit & finish".
	 */
	async handoffCommitPlan(): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "complete";
		this.state.completedAt = Date.now();

		await this.saveState();
		await this.appendJournal({
			type: "plan_handoff_committed",
			timestamp: Date.now(),
		});
	}

	/**
	 * Keep editing: return plan to running status.
	 * Called when user chooses "Keep editing".
	 */
	async handoffKeepEditingPlan(): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "running";
		this.state.handoffStartedAt = undefined;

		await this.saveState();
		await this.appendJournal({
			type: "plan_handoff_keep",
			timestamp: Date.now(),
		});
	}

	/**
	 * Discard changes and fail the plan.
	 * Called when user chooses "Discard".
	 *
	 * @param error - Error message describing the discard
	 */
	async revertAndFailPlan(error: string): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "failed";
		this.state.completedAt = Date.now();

		await this.saveState();
		await this.appendJournal({
			type: "plan_handoff_discard",
			timestamp: Date.now(),
			data: { error },
		});
	}

	/**
	 * Mark plan as failed
	 *
	 * @param error - Error message
	 */
	async failPlan(error: string): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "failed";
		this.state.completedAt = Date.now();

		await this.saveState();
		await this.appendJournal({
			type: "plan_failed",
			timestamp: Date.now(),
			data: { error },
		});
	}

	/**
	 * Pause plan execution
	 *
	 * @param reason - Optional reason for pausing
	 */
	async pausePlan(reason?: string): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "paused";

		await this.saveState();
		await this.appendJournal({
			type: "plan_paused",
			timestamp: Date.now(),
			data: { reason },
		});
	}

	/**
	 * Stop plan execution (graceful)
	 *
	 * @param reason - Optional reason for stopping
	 */
	async stopPlan(reason?: string): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "stopped";
		this.state.completedAt = Date.now();

		await this.saveState();
		await this.appendJournal({
			type: "plan_stopped",
			timestamp: Date.now(),
			data: { reason },
		});
	}

	/**
	 * Cancel plan execution (hard cancellation)
	 *
	 * @param reason - Optional reason for cancellation
	 */
	async cancelPlan(reason?: string): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		this.state.status = "cancelled";
		this.state.completedAt = Date.now();

		// Mark all active workspaces as cancelled
		for (const [id, ws] of this.state.workspaces.entries()) {
			if (ws.stage === WorkspaceStage.Active) {
				this.state.workspaces.set(id, {
					...ws,
					stage: WorkspaceStage.Failed,
					error: "Cancelled by user",
					completedAt: Date.now(),
				});
			}
		}

		await this.saveState();
		await this.appendJournal({
			type: "plan_cancelled",
			timestamp: Date.now(),
			data: { reason },
		});
	}

	/**
	 * Resume plan execution
	 */
	async resumePlan(): Promise<void> {
		if (!this.state) {
			throw new Error("State not initialized");
		}

		if (this.state.status === "cancelled") {
			throw new Error("Cannot resume cancelled plan without --force");
		}

		this.state.status = "running";

		await this.saveState();
		await this.appendJournal({
			type: "plan_resumed",
			timestamp: Date.now(),
		});
	}

	/**
	 * Get current state
	 *
	 * @returns Current state or null
	 */
	getState(): PlanState | null {
		return this.state;
	}

	/**
	 * Get workspace state
	 *
	 * @param workspaceId - Workspace ID
	 * @returns Workspace state or undefined
	 */
	getWorkspaceState(workspaceId: string): WorkspaceState | undefined {
		return this.state?.workspaces.get(workspaceId);
	}

	/**
	 * Get all workspaces in a specific stage
	 *
	 * @param stage - Stage to filter by
	 * @returns Array of workspace states
	 */
	getWorkspacesByStage(stage: WorkspaceStage): WorkspaceState[] {
		if (!this.state) {
			return [];
		}

		return Array.from(this.state.workspaces.values()).filter((ws) => ws.stage === stage);
	}

	/**
	 * Get journal event type for a stage transition
	 */
	private getJournalEventType(stage: WorkspaceStage): JournalEventType | null {
		switch (stage) {
			case WorkspaceStage.Active:
				return "workspace_start";
			case WorkspaceStage.Complete:
				return "workspace_complete";
			case WorkspaceStage.Failed:
				return "workspace_failed";
			case WorkspaceStage.Blocked:
				return "workspace_blocked";
			default:
				return null;
		}
	}

	/**
	 * Append a worker transcript event to the workspace transcript ndjson file.
	 *
	 * Writes to .pi/executions/{planExecId}/workspaces/{workspaceId}/transcript.ndjson
	 * Only sanitized events (no private chain-of-thought) are archived.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param event - Worker transcript event
	 */
	async appendWorkerTranscriptEvent(
		planExecutionId: string,
		workspaceId: string,
		event: WorkerTranscriptEvent,
	): Promise<void> {
		const transcriptDir = path.join(
			path.dirname(this.journalFilePath),
			"executions",
			planExecutionId,
			"workspaces",
			workspaceId,
		);
		await fs.mkdir(transcriptDir, { recursive: true });
		const transcriptFilePath = path.join(transcriptDir, "transcript.ndjson");
		const line = `${JSON.stringify(event)}\n`;
		await fs.appendFile(transcriptFilePath, line, "utf-8");
	}

	/**
	 * Read worker transcript events from the workspace transcript ndjson file.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Array of worker transcript events
	 */
	async readWorkerTranscriptEvents(planExecutionId: string, workspaceId: string): Promise<WorkerTranscriptEvent[]> {
		const transcriptFilePath = path.join(
			path.dirname(this.journalFilePath),
			"executions",
			planExecutionId,
			"workspaces",
			workspaceId,
			"transcript.ndjson",
		);
		try {
			const content = await fs.readFile(transcriptFilePath, "utf-8");
			const lines = content.trim().split("\n");
			return lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}
}

/**
 * Generate workspace execution report
 *
 * @param workspace - Workspace
 * @param state - Workspace state
 * @returns Report content
 */
export function generateWorkspaceReport(workspace: Workspace, state: WorkspaceState): string {
	const lines: string[] = [];

	lines.push(`# Workspace ${workspace.id} — ${workspace.title}`);
	lines.push("");
	lines.push(`**Status:** ${state.stage}`);
	lines.push(`**Attempts:** ${state.attempts}`);

	if (state.startedAt) {
		lines.push(`**Started:** ${new Date(state.startedAt).toISOString()}`);
	}

	if (state.completedAt) {
		lines.push(`**Completed:** ${new Date(state.completedAt).toISOString()}`);
		const duration = state.completedAt - (state.startedAt || state.completedAt);
		lines.push(`**Duration:** ${Math.round(duration / 1000)}s`);
	}

	if (state.error) {
		lines.push("");
		lines.push("## Error");
		lines.push("```");
		lines.push(state.error);
		lines.push("```");
	}

	if (state.editAuditSummary) {
		const audit = state.editAuditSummary;
		lines.push("");
		lines.push("## Token Waste Prevention");
		if (audit.editModeUsed) {
			lines.push(`- **Edit Mode:** ${audit.editModeUsed.replace(/_/g, " ")}`);
		}
		lines.push(`- **Blocked Rewrites:** ${audit.blockedRewrites}`);
		lines.push(`- **Truncation Events:** ${audit.truncationEvents}`);
		lines.push(`- **Exact-Match Failures:** ${audit.exactMatchFailures}`);
		lines.push(`- **Edit Failure Handoffs:** ${audit.handoffs}`);
		lines.push(`- **Estimated Waste Prevented:** ${audit.estimatedWastePrevented} event(s)`);

		if (audit.estimatedWastePrevented > 0) {
			lines.push("");
			lines.push(
				"> The edit strategy policy prevented unnecessary token usage by blocking full rewrites and forcing targeted edits. Use `pi plan doctor` to review edit strategy settings.",
			);
		}
	}

	lines.push("");
	lines.push("## Workspace Details");
	lines.push(`- **Role Budget:** ${workspace.roleBudget}`);
	lines.push(`- **Max Retries:** ${workspace.maxRetries}`);
	lines.push(`- **Dependencies:** ${workspace.dependencies.length > 0 ? workspace.dependencies.join(", ") : "None"}`);

	if (workspace.capabilities) {
		lines.push("");
		lines.push("## Capabilities");
		lines.push(`- **Can Edit:** ${workspace.capabilities.canEdit.join(", ") || "None"}`);
		lines.push(`- **Cannot Edit:** ${workspace.capabilities.cannotEdit.join(", ") || "None"}`);
	}

	return lines.join("\n");
}

/**
 * Format plan state for display
 *
 * @param state - Plan state
 * @returns Formatted string
 */
export function formatPlanState(state: PlanState): string {
	const lines: string[] = [];

	lines.push(`Phase: ${state.phase} — ${state.title}`);
	lines.push(`Status: ${state.status}`);
	lines.push(`Started: ${new Date(state.startedAt).toISOString()}`);

	if (state.completedAt) {
		lines.push(`Completed: ${new Date(state.completedAt).toISOString()}`);
	}

	lines.push("");
	lines.push("Workspaces:");

	const byStage = new Map<WorkspaceStage, WorkspaceState[]>();
	for (const ws of Array.from(state.workspaces.values())) {
		const list = byStage.get(ws.stage) || [];
		list.push(ws);
		byStage.set(ws.stage, list);
	}

	for (const stage of Object.values(WorkspaceStage)) {
		const workspaces = byStage.get(stage) || [];
		if (workspaces.length > 0) {
			lines.push(`  ${stage}: ${workspaces.map((w) => w.workspaceId).join(", ")}`);
		}
	}

	return lines.join("\n");
}
