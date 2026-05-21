/**
 * Overnight Run Orchestration — P20.A
 *
 * Manages scheduled/unscheduled overnight execution of plan queues with
 * automatic stop conditions, progress tracking, and session lifecycle.
 *
 * The orchestrator wraps the plan queue runner and adds:
 *   - Scheduled execution (HH:mm start time)
 *   - Stop condition monitoring (dirty integration queue, merge conflicts,
 *     policy violations, user intervention, duration limits)
 *   - Session persistence and history
 *   - Progress tracking across multiple plans
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Conditions that can trigger an overnight run to stop.
 */
export type OvernightStopCondition =
	| "integration_queue_dirty"
	| "merge_conflict"
	| "policy_violation"
	| "low_confidence_unsafe"
	| "user_intervention"
	| "error_threshold_exceeded"
	| "max_duration_reached";

/**
 * Configuration for an overnight run session.
 */
export interface OvernightConfig {
	/** Plan execution IDs to execute during the session. */
	planExecIds: string[];
	/** Autonomy level — only 3+ can execute autonomously. */
	autonomyLevel: 3 | 4;
	/** Stop conditions to monitor during execution. */
	stopConditions: OvernightStopCondition[];
	/** Maximum run duration in hours (default: 8). */
	maxDurationHours: number;
	/** Scheduled start time in HH:mm format (24-hour), if using scheduled mode. */
	scheduleTime?: string;
	/** Whether desktop/push notifications are enabled. */
	notificationEnabled: boolean;
	/** Whether to generate a morning report after completion. */
	generateMorningReport: boolean;
}

/**
 * Default values for optional OvernightConfig fields.
 */
export const DEFAULT_OVERNIGHT_CONFIG: Partial<OvernightConfig> = {
	autonomyLevel: 3,
	stopConditions: [
		"integration_queue_dirty",
		"merge_conflict",
		"policy_violation",
		"error_threshold_exceeded",
		"max_duration_reached",
	],
	maxDurationHours: 8,
	notificationEnabled: true,
	generateMorningReport: true,
};

/**
 * Runtime state of a single overnight run session.
 */
export interface RunSession {
	/** Unique session identifier (UUID v4). */
	id: string;
	/** Plan execution IDs in this session. */
	planExecIds: string[];
	/** Current session status. */
	status: "scheduled" | "running" | "completed" | "stopped" | "failed";
	/** ISO-8601 timestamp when execution started. */
	startedAt?: string;
	/** ISO-8601 timestamp when execution completed. */
	completedAt?: string;
	/** Human-readable reason for stopping (if status is "stopped"). */
	stopReason?: string;
	/** Execution progress. */
	progress: RunProgress;
	/** ISO-8601 timestamp when the session was created. */
	createdAt: string;
	/** The configuration used for this session. */
	config: OvernightConfig;
}

/**
 * Progress within an overnight run session.
 */
export interface RunProgress {
	/** Number of plans completed successfully. */
	completed: number;
	/** Total number of plans in the session. */
	total: number;
	/** Number of plans that failed. */
	failed: number;
}

/**
 * Snapshot of current run status for external consumers (API, dashboard).
 */
export interface RunStatus {
	/** The active session ID. */
	sessionId: string;
	/** Current session status. */
	status: RunSession["status"];
	/** Execution progress. */
	progress: RunProgress;
	/** Plan execution ID currently being executed (if any). */
	currentPlan?: string;
	/** Status of the current plan (if any). */
	currentPlanStatus?: string;
	/** ISO-8601 timestamp of the last stop condition check. */
	lastStopCheckAt?: string;
	/** Stop conditions that have been met. */
	stopConditionsMet?: string[];
	/** Elapsed hours since the run started. */
	elapsedHours: number;
}

/**
 * Reference to the plan queue runner subsystem.
 *
 * The OvernightOrchestrator depends on this interface rather than
 * importing the concrete PlanQueueRunner directly, keeping the
 * coupling loose and testable.
 */
export interface PlanQueueRef {
	/** Enqueue one or more plan execution IDs for processing. */
	enqueuePlans(planExecIds: string[]): Promise<void>;
	/** Get the list of currently queued or active plan execution IDs. */
	getQueuedPlanIds(): Promise<string[]>;
	/** Get the status of a specific plan execution. */
	getPlanStatus(planExecId: string): Promise<{
		status: string;
		progress: { completed: number; total: number };
	} | null>;
	/** Check if the queue has any dirty (non-terminal) entries. */
	hasDirtyEntries(): Promise<boolean>;
	/** Get the current active plan execution ID, if any. */
	getActivePlanId(): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Session Store
// ---------------------------------------------------------------------------

/**
 * In-memory session store with optional JSON persistence.
 *
 * Sessions are kept in memory during the process lifetime. When
 * `persistPath` is provided, sessions are saved to a JSON file after
 * every mutation for crash recovery.
 */
export class SessionStore {
	private sessions: Map<string, RunSession> = new Map();
	private persistPath?: string;

	constructor(persistPath?: string) {
		this.persistPath = persistPath;
	}

	/** Add a new session. */
	async add(session: RunSession): Promise<void> {
		this.sessions.set(session.id, session);
		await this.maybePersist();
	}

	/** Update an existing session by merging fields. */
	async update(id: string, updates: Partial<RunSession>): Promise<RunSession | null> {
		const existing = this.sessions.get(id);
		if (!existing) return null;
		const updated: RunSession = { ...existing, ...updates };
		this.sessions.set(id, updated);
		await this.maybePersist();
		return updated;
	}

	/** Get a session by ID. */
	get(id: string): RunSession | null {
		return this.sessions.get(id) ?? null;
	}

	/** Get all sessions, most recent first. */
	getAll(limit = 10): RunSession[] {
		return [...this.sessions.values()]
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
			.slice(0, limit);
	}

	/** Remove a session by ID. */
	async remove(id: string): Promise<boolean> {
		const deleted = this.sessions.delete(id);
		if (deleted) await this.maybePersist();
		return deleted;
	}

	/** Clear all sessions. */
	async clear(): Promise<void> {
		this.sessions.clear();
		await this.maybePersist();
	}

	private async maybePersist(): Promise<void> {
		if (!this.persistPath) return;
		try {
			const fs = await import("node:fs/promises");
			const data = JSON.stringify([...this.sessions.values()], null, 2);
			await fs.writeFile(this.persistPath, data, "utf-8");
		} catch {
			// Persistence failures are non-fatal.
		}
	}

	/** Load sessions from a persisted JSON file. */
	async loadFromDisk(): Promise<void> {
		if (!this.persistPath) return;
		try {
			const fs = await import("node:fs/promises");
			const data = await fs.readFile(this.persistPath, "utf-8");
			const loaded: RunSession[] = JSON.parse(data);
			for (const session of loaded) {
				this.sessions.set(session.id, session);
			}
		} catch {
			// File not found or invalid JSON is non-fatal.
		}
	}
}

// ---------------------------------------------------------------------------
// OvernightOrchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrates overnight execution of plan queues with automatic stop
 * condition monitoring, scheduling, and session lifecycle management.
 *
 * Usage:
 * ```ts
 * const orch = new OvernightOrchestrator(planQueueRef);
 * const session = await orch.startNow({
 *   planExecIds: ["exec-1", "exec-2"],
 *   autonomyLevel: 3,
 *   stopConditions: ["integration_queue_dirty", "max_duration_reached"],
 *   maxDurationHours: 8,
 *   notificationEnabled: true,
 *   generateMorningReport: true,
 * });
 * ```
 */
export class OvernightOrchestrator {
	private config: OvernightConfig;
	private session?: RunSession;
	private sessionStore: SessionStore;
	private planQueue: PlanQueueRef;
	private stopCheckTimer?: ReturnType<typeof setInterval>;
	private startTimer?: ReturnType<typeof setTimeout>;
	private startTime?: number;
	private metStopConditions: string[] = [];

	/**
	 * @param planQueue  Reference to the plan queue for enqueueing and status checks.
	 * @param config     Default configuration overrides (applied if not provided per-session).
	 * @param sessionStore Optional session store (creates a default in-memory store if omitted).
	 */
	constructor(planQueue: PlanQueueRef, config?: Partial<OvernightConfig>, sessionStore?: SessionStore) {
		this.planQueue = planQueue;
		this.config = {
			planExecIds: [],
			autonomyLevel: config?.autonomyLevel ?? DEFAULT_OVERNIGHT_CONFIG.autonomyLevel!,
			stopConditions: config?.stopConditions ?? DEFAULT_OVERNIGHT_CONFIG.stopConditions!,
			maxDurationHours: config?.maxDurationHours ?? DEFAULT_OVERNIGHT_CONFIG.maxDurationHours!,
			notificationEnabled: config?.notificationEnabled ?? DEFAULT_OVERNIGHT_CONFIG.notificationEnabled!,
			generateMorningReport: config?.generateMorningReport ?? DEFAULT_OVERNIGHT_CONFIG.generateMorningReport!,
		};
		this.sessionStore = sessionStore ?? new SessionStore();
	}

	// ─────────────────────────────────────────────────────────────
	// Lifecycle: Schedule
	// ─────────────────────────────────────────────────────────────

	/**
	 * Schedule an overnight run to start at the specified time.
	 *
	 * If `config.scheduleTime` is set, the run will start at that time.
	 * If no `scheduleTime` is provided or the time has already passed today,
	 * the session is scheduled for the next occurrence.
	 *
	 * Returns the created session in "scheduled" status.
	 */
	async schedule(config: OvernightConfig): Promise<RunSession> {
		this.validateConfig(config);

		const session: RunSession = {
			id: randomUUID(),
			planExecIds: [...config.planExecIds],
			status: "scheduled",
			progress: { completed: 0, total: config.planExecIds.length, failed: 0 },
			createdAt: new Date().toISOString(),
			config: { ...config },
		};

		await this.sessionStore.add(session);
		this.session = session;
		this.config = { ...config };

		// Set up the scheduled start timer.
		const scheduleTime = config.scheduleTime;
		if (scheduleTime) {
			const delayMs = this.computeScheduleDelay(scheduleTime);
			this.startTimer = setTimeout(() => {
				this.startScheduled(session.id).catch(() => {});
			}, delayMs);
		}

		return session;
	}

	/**
	 * Start an overnight run immediately with the given configuration.
	 *
	 * Returns the created session in "running" status.
	 */
	async startNow(config: OvernightConfig): Promise<RunSession> {
		this.validateConfig(config);

		const session: RunSession = {
			id: randomUUID(),
			planExecIds: [...config.planExecIds],
			status: "running",
			startedAt: new Date().toISOString(),
			progress: { completed: 0, total: config.planExecIds.length, failed: 0 },
			createdAt: new Date().toISOString(),
			config: { ...config },
		};

		await this.sessionStore.add(session);
		this.session = session;
		this.config = { ...config };
		this.startTime = Date.now();
		this.metStopConditions = [];

		// Enqueue plans and start the orchestration loop.
		await this.planQueue.enqueuePlans(config.planExecIds);
		this.startStopCheckInterval();
		this.runOrchestrationLoop().catch((err) => {
			this.handleError(err instanceof Error ? err.message : String(err));
		});

		return session;
	}

	/**
	 * Start a previously scheduled session.
	 *
	 * Called internally by the scheduled timer or externally by
	 * a user who wants to trigger a scheduled start manually.
	 */
	async startScheduled(sessionId: string): Promise<void> {
		const session = await this.sessionStore.get(sessionId);
		if (!session) {
			throw new Error(`Session "${sessionId}" not found`);
		}
		if (session.status !== "scheduled") {
			throw new Error(`Session "${sessionId}" is not in "scheduled" status`);
		}

		this.session = session;
		this.config = { ...session.config };
		this.startTime = Date.now();
		this.metStopConditions = [];

		const updated = await this.sessionStore.update(sessionId, {
			status: "running",
			startedAt: new Date().toISOString(),
		});
		if (updated) this.session = updated;

		await this.planQueue.enqueuePlans(session.planExecIds);
		this.startStopCheckInterval();
		this.runOrchestrationLoop().catch((err) => {
			this.handleError(err instanceof Error ? err.message : String(err));
		});
	}

	// ─────────────────────────────────────────────────────────────
	// Lifecycle: Stop / Pause / Resume
	// ─────────────────────────────────────────────────────────────

	/**
	 * Stop the currently running session with a reason.
	 *
	 * Stops the orchestration loop and any running plan execution.
	 * Does not clear the plan queue — pending plans remain for
	 * manual intervention.
	 */
	async stop(reason: string): Promise<RunSession> {
		this.stopStopCheckInterval();
		this.clearStartTimer();

		if (this.session) {
			const updated = await this.sessionStore.update(this.session.id, {
				status: "stopped",
				completedAt: new Date().toISOString(),
				stopReason: reason,
			});
			if (updated) this.session = updated;
		}

		return this.session ?? this.createEmptySession();
	}

	/**
	 * Pause the currently running session.
	 *
	 * Stops the orchestration loop and stop condition checks but
	 * preserves the session state for later resumption. The current
	 * plan continues running (if active) but no new plans will start.
	 */
	async pause(): Promise<RunSession> {
		this.stopStopCheckInterval();
		this.clearStartTimer();

		if (this.session) {
			const updated = await this.sessionStore.update(this.session.id, {
				status: "stopped",
				completedAt: new Date().toISOString(),
				stopReason: "paused_by_user",
			});
			if (updated) this.session = updated;
		}

		return this.session ?? this.createEmptySession();
	}

	/**
	 * Resume a previously paused/stopped session.
	 *
	 * Re-enqueues any remaining plans and starts the orchestration loop.
	 */
	async resume(): Promise<RunSession> {
		if (!this.session) {
			throw new Error("No session to resume");
		}

		const remainingPlanIds = this.session.planExecIds.slice(this.session.progress.completed);
		if (remainingPlanIds.length === 0) {
			throw new Error("All plans in the session have already been completed");
		}

		this.startTime = Date.now();
		this.metStopConditions = [];

		const updated = await this.sessionStore.update(this.session.id, {
			status: "running",
			startedAt: new Date().toISOString(),
		});
		if (updated) this.session = updated;

		await this.planQueue.enqueuePlans(remainingPlanIds);
		this.startStopCheckInterval();
		this.runOrchestrationLoop().catch((err) => {
			this.handleError(err instanceof Error ? err.message : String(err));
		});

		return this.session;
	}

	// ─────────────────────────────────────────────────────────────
	// Status
	// ─────────────────────────────────────────────────────────────

	/**
	 * Get a snapshot of the current run status.
	 */
	getStatus(): RunStatus {
		const elapsedHours = this.startTime ? (Date.now() - this.startTime) / 3_600_000 : 0;

		return {
			sessionId: this.session?.id ?? "",
			status: this.session?.status ?? "failed",
			progress: this.session?.progress ?? { completed: 0, total: 0, failed: 0 },
			lastStopCheckAt: new Date().toISOString(),
			stopConditionsMet: this.metStopConditions.length > 0 ? [...this.metStopConditions] : undefined,
			elapsedHours,
		};
	}

	/**
	 * Get the current session, if any.
	 */
	getSession(): RunSession | null {
		return this.session ?? null;
	}

	/**
	 * Get session history from the store.
	 *
	 * @param limit Maximum number of sessions to return (most recent first).
	 */
	getHistory(limit = 10): RunSession[] {
		return this.sessionStore.getAll(limit);
	}

	// ─────────────────────────────────────────────────────────────
	// Stop Condition Checks
	// ─────────────────────────────────────────────────────────────

	/**
	 * Check all active stop conditions and return any that are met.
	 *
	 * This is the main entry point for external monitoring and is
	 * also called periodically by the internal stop check timer.
	 */
	async checkStopConditions(): Promise<OvernightStopCondition[]> {
		const met: OvernightStopCondition[] = [];

		for (const condition of this.config.stopConditions) {
			let isMet = false;
			switch (condition) {
				case "integration_queue_dirty":
					isMet = await this.checkIntegrationQueue();
					break;
				case "merge_conflict":
					isMet = await this.checkMergeConflicts();
					break;
				case "policy_violation":
					isMet = await this.checkPolicyViolations();
					break;
				case "low_confidence_unsafe":
					isMet = false; // Requires policy engine integration.
					break;
				case "user_intervention":
					isMet = await this.checkUserIntervention();
					break;
				case "error_threshold_exceeded":
					isMet = await this.checkErrorThreshold();
					break;
				case "max_duration_reached":
					isMet = await this.checkDuration();
					break;
			}

			if (isMet) {
				met.push(condition);
			}
		}

		if (met.length > 0) {
			this.metStopConditions.push(...met);
		}

		return met;
	}

	/**
	 * Check if the integration queue has dirty (non-terminal) entries.
	 *
	 * When dirty, the overnight run should stop to avoid merging
	 * workspace output into an already-busy integration branch.
	 */
	private async checkIntegrationQueue(): Promise<boolean> {
		try {
			return await this.planQueue.hasDirtyEntries();
		} catch {
			return false;
		}
	}

	/**
	 * Check if there are unresolved merge conflicts.
	 *
	 * Merge conflicts require manual resolution and cannot be
	 * handled autonomously.
	 */
	private async checkMergeConflicts(): Promise<boolean> {
		// This check relies on the integration queue reporting merge
		// conflicts. The default implementation inspects the queue state.
		try {
			// Check if any plan has a merge conflict status.
			const activePlanId = await this.planQueue.getActivePlanId();
			if (!activePlanId) return false;

			const status = await this.planQueue.getPlanStatus(activePlanId);
			return status?.status === "conflict" || status?.status === "blocked";
		} catch {
			return false;
		}
	}

	/**
	 * Check if there are policy violations that warrant stopping.
	 *
	 * Policy violations indicate the system attempted something
	 * that should not have been allowed.
	 */
	private async checkPolicyViolations(): Promise<boolean> {
		// Placeholder: requires policy engine integration.
		// In a full implementation, queries the audit ledger for
		// recent policy violation events.
		return false;
	}

	/**
	 * Check if the user has requested intervention.
	 *
	 * The presence of an intervention flag file or a specific
	 * queue state indicates the user wants to take manual control.
	 */
	private async checkUserIntervention(): Promise<boolean> {
		// Placeholder: checks for a user intervention signal.
		// This could be a flag file, an IPC signal, or a queue state.
		return false;
	}

	/**
	 * Check if the error threshold has been exceeded.
	 *
	 * The session fails if more than 50% of plans have failed.
	 */
	private async checkErrorThreshold(): Promise<boolean> {
		if (!this.session) return false;
		const { completed, failed } = this.session.progress;
		const processed = completed + failed;
		if (processed === 0) return false;
		return failed / processed > 0.5;
	}

	/**
	 * Check if the maximum duration has been reached.
	 */
	private async checkDuration(): Promise<boolean> {
		if (!this.startTime) return false;
		const elapsedHours = (Date.now() - this.startTime) / 3_600_000;
		return elapsedHours >= this.config.maxDurationHours;
	}

	// ─────────────────────────────────────────────────────────────
	// Progress Tracking
	// ─────────────────────────────────────────────────────────────

	/**
	 * Update the session progress from the plan queue state.
	 */
	private async updateProgress(): Promise<void> {
		if (!this.session) return;

		let completed = 0;
		let failed = 0;

		for (const planExecId of this.session.planExecIds) {
			try {
				const status = await this.planQueue.getPlanStatus(planExecId);
				if (status) {
					if (status.status === "complete") completed++;
					else if (status.status === "failed") failed++;
				}
			} catch {
				// Skip entries that can't be queried.
			}
		}

		const progress: RunProgress = {
			completed,
			total: this.session.planExecIds.length,
			failed,
		};

		await this.sessionStore.update(this.session.id, { progress });
		if (this.session) this.session.progress = progress;
	}

	/**
	 * Get the next plan to execute from the queue.
	 *
	 * Returns the first plan execution ID that is still pending,
	 * or null if all plans have been processed.
	 */

	// ─────────────────────────────────────────────────────────────
	// Internal: Timer Management
	// ─────────────────────────────────────────────────────────────

	/**
	 * Start the periodic stop condition check interval.
	 *
	 * Checks stop conditions every 30 seconds.
	 */
	private startStopCheckInterval(): void {
		this.stopStopCheckInterval();
		this.stopCheckTimer = setInterval(async () => {
			try {
				const met = await this.checkStopConditions();
				if (met.length > 0) {
					await this.stop(`Stop condition(s) met: ${met.join(", ")}`);
				}
			} catch {
				// Check failures should not crash the interval.
			}
		}, 30_000);
	}

	/**
	 * Stop the periodic stop condition check interval.
	 */
	private stopStopCheckInterval(): void {
		if (this.stopCheckTimer) {
			clearInterval(this.stopCheckTimer);
			this.stopCheckTimer = undefined;
		}
	}

	/**
	 * Clear the scheduled start timer.
	 */
	private clearStartTimer(): void {
		if (this.startTimer) {
			clearTimeout(this.startTimer);
			this.startTimer = undefined;
		}
	}

	// ─────────────────────────────────────────────────────────────
	// Internal: Orchestration Loop
	// ─────────────────────────────────────────────────────────────

	/**
	 * The main orchestration loop.
	 *
	 * Runs until:
	 *   - All plans are completed/failed
	 *   - A stop condition is triggered
	 *   - The session is manually stopped/paused
	 *
	 * The loop polls the plan queue for completion status every
	 * 15 seconds. This is intentional — we are waiting for the
	 * plan queue runner (which runs in another process or context)
	 * to process the enqueued plans.
	 */
	private async runOrchestrationLoop(): Promise<void> {
		if (!this.session) return;

		const pollIntervalMs = 15_000;

		while (this.session?.status === "running") {
			// Update progress from the queue state.
			await this.updateProgress();

			// Check stop conditions.
			const met = await this.checkStopConditions();
			if (met.length > 0) {
				await this.stop(`Stop condition(s) met: ${met.join(", ")}`);
				return;
			}

			// Check if all plans are done.
			const { completed, failed, total } = this.session.progress;
			const processed = completed + failed;

			if (processed >= total) {
				const finalStatus = failed > 0 ? "failed" : "completed";
				await this.sessionStore.update(this.session.id, {
					status: finalStatus,
					completedAt: new Date().toISOString(),
				});
				if (this.session) {
					this.session.status = finalStatus;
					this.session.completedAt = new Date().toISOString();
				}
				this.stopStopCheckInterval();
				return;
			}

			// Wait before next poll.
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}

	// ─────────────────────────────────────────────────────────────
	// Internal: Helpers
	// ─────────────────────────────────────────────────────────────

	/**
	 * Validate an OvernightConfig object before creating a session.
	 */
	private validateConfig(config: OvernightConfig): void {
		if (!config.planExecIds || config.planExecIds.length === 0) {
			throw new Error("planExecIds must be a non-empty array");
		}
		if (config.autonomyLevel < 3) {
			throw new Error(`autonomyLevel must be 3 or higher, got ${config.autonomyLevel}`);
		}
		if (config.maxDurationHours <= 0 || config.maxDurationHours > 24) {
			throw new Error(`maxDurationHours must be between 1 and 24, got ${config.maxDurationHours}`);
		}
		if (config.scheduleTime && !/^\d{2}:\d{2}$/.test(config.scheduleTime)) {
			throw new Error(`scheduleTime must be in HH:mm format, got "${config.scheduleTime}"`);
		}
	}

	/**
	 * Compute the delay (in ms) until the next occurrence of the given schedule time.
	 */
	private computeScheduleDelay(scheduleTime: string): number {
		const [hours, minutes] = scheduleTime.split(":").map(Number);
		const now = new Date();
		const scheduled = new Date(now);
		scheduled.setHours(hours, minutes, 0, 0);

		if (scheduled.getTime() <= now.getTime()) {
			// Schedule time has passed today — schedule for tomorrow.
			scheduled.setDate(scheduled.getDate() + 1);
		}

		return scheduled.getTime() - now.getTime();
	}

	/**
	 * Handle an unrecoverable error in the orchestration loop.
	 */
	private async handleError(error: string): Promise<void> {
		this.stopStopCheckInterval();
		this.clearStartTimer();

		if (this.session) {
			const updated = await this.sessionStore.update(this.session.id, {
				status: "failed",
				completedAt: new Date().toISOString(),
				stopReason: `error: ${error}`,
			});
			if (updated) this.session = updated;
		}
	}

	/**
	 * Create an empty session for when no session exists.
	 */
	private createEmptySession(): RunSession {
		return {
			id: "",
			planExecIds: [],
			status: "failed",
			progress: { completed: 0, total: 0, failed: 0 },
			createdAt: new Date().toISOString(),
			config: {
				planExecIds: [],
				autonomyLevel: 3,
				stopConditions: [],
				maxDurationHours: 8,
				notificationEnabled: false,
				generateMorningReport: false,
			},
		};
	}

	/** Dispose of the orchestrator (clean up timers). */
	dispose(): void {
		this.stopStopCheckInterval();
		this.clearStartTimer();
	}
}
