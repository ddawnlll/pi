/**
 * State Store + Report System - P2 Workstream 7.C
 *
 * Manages workspace execution state, persistence, and execution journal.
 * State is stored in .pi/plan-state.json (atomic writes).
 * Journal is stored in .pi/execution-journal.ndjson (append-only, crash-safe).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
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
	status: "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled";
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
	| "workspace_start"
	| "workspace_complete"
	| "workspace_failed"
	| "workspace_blocked"
	| "retry_attempt"
	| "file_lock_acquired"
	| "file_lock_released";

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
	 * @param event - Journal event
	 */
	async appendJournal(event: JournalEvent): Promise<void> {
		// Ensure .pi directory exists
		const piDir = path.dirname(this.journalFilePath);
		await fs.mkdir(piDir, { recursive: true });

		// Append as NDJSON (one JSON object per line)
		const line = `${JSON.stringify(event)}\n`;
		await fs.appendFile(this.journalFilePath, line, "utf-8");
	}

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
