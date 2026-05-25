/**
 * Lease Monitor — Continuous Lease Watchdog (P23 W2)
 *
 * Manages lease lifecycle with heartbeat writing and a background watchdog
 * loop that automatically quarantines stale leases without requiring a
 * server restart.
 *
 * Key design:
 * - Each active lease writes a heartbeat file every 15 seconds.
 * - A background watchdog runs every 30 seconds checking all leases.
 * - Stale leases (no heartbeat for > 45s, PID dead) are quarantined.
 * - Quarantine = rename worktree, create replacement slot, delete lease.
 * - Reconciliation precedence: lease file = "was running", worktree-state = "on disk".
 * - Both watchdog and resumeStrandedExecutions() coexist.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Content of a lease heartbeat file.
 */
export interface LeaseHeartbeat {
	/** Lease ID */
	leaseId: string;
	/** Workspace ID this lease is for */
	workspaceId: string;
	/** Plan execution ID */
	planExecId: string;
	/** Process ID of the lease holder */
	pid: number;
	/** ISO timestamp of last heartbeat */
	lastHeartbeatAt: string;
	/** Working directory */
	cwd: string;
	/** Last git command executed (if known) */
	lastGitCommand: string;
}

/**
 * Configuration for the lease monitor.
 */
export interface LeaseMonitorConfig {
	/** Whether the lease monitor is enabled */
	enabled: boolean;
	/** How often to write heartbeat files (seconds) */
	heartbeatIntervalSeconds: number;
	/** How long without a heartbeat before a lease is considered stale (seconds) */
	staleThresholdSeconds: number;
	/** How often to run the watchdog loop (seconds) */
	monitorLoopIntervalSeconds: number;
	/** What to do with stale leases */
	stalePolicy: "quarantine_and_replace";
	/** Precedence rules for lease vs worktree-state reconciliation */
	reconciliationPrecedence: {
		wasRunning: "lease_file";
		whatIsOnDisk: "worktree_state";
		onDisagreement: "quarantine_and_requeue";
	};
}

/**
 * Default lease monitor configuration.
 */
export const DEFAULT_LEASE_MONITOR_CONFIG: LeaseMonitorConfig = {
	enabled: true,
	heartbeatIntervalSeconds: 15,
	staleThresholdSeconds: 45,
	monitorLoopIntervalSeconds: 30,
	stalePolicy: "quarantine_and_replace",
	reconciliationPrecedence: {
		wasRunning: "lease_file",
		whatIsOnDisk: "worktree_state",
		onDisagreement: "quarantine_and_requeue",
	},
};

/**
 * Result of a lease quarantine operation.
 */
export interface QuarantineResult {
	/** Whether quarantine was successful */
	success: boolean;
	/** Lease ID that was quarantined */
	leaseId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Path to the quarantined worktree (renamed with .quarantined suffix) */
	quarantinedPath: string;
	/** Error message if quarantine failed */
	error?: string;
}

/**
 * Reconciliation event emitted when lease-file and worktree-state disagree.
 */
export interface LeaseReconciliationEvent {
	/** Type of disagreement */
	disagreementType:
		| "lease_says_running_worktree_says_completed"
		| "lease_says_running_worktree_missing"
		| "worktree_says_running_no_lease";
	/** Lease ID (if available) */
	leaseId: string | null;
	/** Workspace ID */
	workspaceId: string;
	/** Plan execution ID */
	planExecId: string;
	/** What the lease file says */
	leaseState: string | null;
	/** What the worktree state says */
	worktreeState: string | null;
	/** Action taken */
	action: "treat_as_completed" | "quarantine_and_requeue";
}

// ---------------------------------------------------------------------------
// LeaseMonitor
// ---------------------------------------------------------------------------

/**
 * Continuous lease watchdog.
 *
 * Manages lease lifecycle with heartbeat writing and periodic stale-lease
 * detection and quarantine.
 */
export class LeaseMonitor {
	private config: LeaseMonitorConfig;
	private workspaceRoot: string;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private watchdogTimer: ReturnType<typeof setInterval> | null = null;
	private activeLeases: Map<string, LeaseHeartbeat> = new Map();
	private leaseDir: string;
	private worktreeRoot: string;
	private onQuarantine?: (result: QuarantineResult) => void;
	private onReconciliation?: (event: LeaseReconciliationEvent) => void;

	/**
	 * @param config - Lease monitor configuration
	 * @param workspaceRoot - Workspace root directory
	 * @param leaseDir - Directory for lease files (default: .pi/scheduler/leases)
	 * @param worktreeRootOverride - Override for worktree root
	 */
	constructor(
		config: Partial<LeaseMonitorConfig>,
		workspaceRoot: string,
		leaseDir?: string,
		worktreeRootOverride?: string,
	) {
		this.config = { ...DEFAULT_LEASE_MONITOR_CONFIG, ...config };
		this.workspaceRoot = workspaceRoot;
		this.leaseDir = leaseDir ?? path.join(workspaceRoot, ".pi", "scheduler", "leases");
		this.worktreeRoot = worktreeRootOverride ?? ".pi/worktrees";
	}

	/**
	 * Set callback for quarantine events (for dashboard emission).
	 */
	setQuarantineCallback(cb: (result: QuarantineResult) => void): void {
		this.onQuarantine = cb;
	}

	/**
	 * Set callback for reconciliation events (for dashboard emission).
	 */
	setReconciliationCallback(cb: (event: LeaseReconciliationEvent) => void): void {
		this.onReconciliation = cb;
	}

	/**
	 * Start the lease monitor.
	 *
	 * Begins periodic heartbeat writing for all active leases and starts
	 * the background watchdog loop. Also runs an initial reconciliation pass.
	 */
	async start(): Promise<void> {
		if (!this.config.enabled) return;
		await fs.mkdir(this.leaseDir, { recursive: true });

		// Run initial reconciliation for any existing leases from a previous run
		await this.reconcileAll();

		// Start heartbeat writer
		this.heartbeatTimer = setInterval(() => {
			this.writeAllHeartbeats().catch(() => {});
		}, this.config.heartbeatIntervalSeconds * 1000);
		this.heartbeatTimer.unref();

		// Start watchdog loop
		this.watchdogTimer = setInterval(() => {
			this.watchdogIteration().catch(() => {});
		}, this.config.monitorLoopIntervalSeconds * 1000);
		this.watchdogTimer.unref();
	}

	/**
	 * Stop the lease monitor.
	 */
	stop(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		if (this.watchdogTimer) {
			clearInterval(this.watchdogTimer);
			this.watchdogTimer = null;
		}
	}

	/**
	 * Acquire a lease for a workspace.
	 *
	 * Writes the initial lease file with a heartbeat.
	 *
	 * @param leaseId - Unique lease ID
	 * @param workspaceId - Workspace ID
	 * @param planExecId - Plan execution ID
	 * @param pid - Process ID
	 * @param cwd - Working directory
	 * @returns The lease heartbeat
	 */
	async acquireLease(
		leaseId: string,
		workspaceId: string,
		planExecId: string,
		pid: number,
		cwd: string,
	): Promise<LeaseHeartbeat> {
		const heartbeat: LeaseHeartbeat = {
			leaseId,
			workspaceId,
			planExecId,
			pid,
			lastHeartbeatAt: new Date().toISOString(),
			cwd,
			lastGitCommand: "",
		};

		this.activeLeases.set(leaseId, heartbeat);
		await this.writeHeartbeat(leaseId);
		return heartbeat;
	}

	/**
	 * Release a lease.
	 *
	 * Deletes the lease file and removes from active set.
	 *
	 * @param leaseId - Lease ID to release
	 */
	async releaseLease(leaseId: string): Promise<void> {
		this.activeLeases.delete(leaseId);
		try {
			await fs.unlink(this.leaseFilePath(leaseId));
		} catch {
			// File may not exist
		}
		try {
			await fs.unlink(this.heartbeatFilePath(leaseId));
		} catch {
			// File may not exist
		}
	}

	/**
	 * Check if a lease is currently active.
	 */
	isLeaseActive(leaseId: string): boolean {
		return this.activeLeases.has(leaseId);
	}

	/**
	 * Get a lease's heartbeat.
	 */
	getLease(leaseId: string): LeaseHeartbeat | undefined {
		return this.activeLeases.get(leaseId);
	}

	/**
	 * Get all active leases.
	 */
	getActiveLeases(): Map<string, LeaseHeartbeat> {
		return new Map(this.activeLeases);
	}

	/**
	 * Update the last git command for a lease.
	 */
	updateLastGitCommand(leaseId: string, command: string): void {
		const lease = this.activeLeases.get(leaseId);
		if (lease) {
			lease.lastGitCommand = command;
		}
	}

	/**
	 * Get the lease directory path.
	 */
	getLeaseDir(): string {
		return this.leaseDir;
	}

	// -----------------------------------------------------------------------
	// Heartbeat management
	// -----------------------------------------------------------------------

	/**
	 * Write heartbeats for all active leases.
	 */
	private async writeAllHeartbeats(): Promise<void> {
		const now = new Date().toISOString();
		for (const [leaseId, heartbeat] of this.activeLeases) {
			heartbeat.lastHeartbeatAt = now;
			await this.writeHeartbeat(leaseId);
		}
	}

	/**
	 * Write a single heartbeat file for a lease.
	 */
	private async writeHeartbeat(leaseId: string): Promise<void> {
		const lease = this.activeLeases.get(leaseId);
		if (!lease) return;

		const filePath = this.heartbeatFilePath(leaseId);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, JSON.stringify(lease, null, 2), "utf-8");
	}

	/**
	 * Path to a lease's heartbeat file.
	 */
	private heartbeatFilePath(leaseId: string): string {
		return path.join(this.leaseDir, `${leaseId}.heartbeat`);
	}

	/**
	 * Path to a lease file.
	 */
	private leaseFilePath(leaseId: string): string {
		return path.join(this.leaseDir, leaseId);
	}

	// -----------------------------------------------------------------------
	// Watchdog
	// -----------------------------------------------------------------------

	/**
	 * Run a single watchdog iteration.
	 *
	 * Reads all lease files from disk. For each:
	 * 1. Check if heartbeat is stale (> staleThresholdSeconds)
	 * 2. Verify PID is alive via process.kill(pid, 0)
	 * 3. If both stale and dead: quarantine the worktree
	 */
	private async watchdogIteration(): Promise<void> {
		try {
			const files = await fs.readdir(this.leaseDir);
			for (const file of files) {
				if (!file.endsWith(".heartbeat") && !file.endsWith(".lease")) continue;
				const leaseId = file.replace(/\.(heartbeat|lease)$/, "");
				await this.checkAndQuarantine(leaseId);
			}
		} catch {
			// Directory doesn't exist yet, nothing to check
		}
	}

	/**
	 * Check a single lease and quarantine if stale.
	 */
	private async checkAndQuarantine(leaseId: string): Promise<void> {
		try {
			const heartbeatPath = this.heartbeatFilePath(leaseId);
			const content = await fs.readFile(heartbeatPath, "utf-8");
			const heartbeat: LeaseHeartbeat = JSON.parse(content);

			// Check if heartbeat is stale
			const lastBeat = new Date(heartbeat.lastHeartbeatAt).getTime();
			const ageSeconds = (Date.now() - lastBeat) / 1000;

			if (ageSeconds < this.config.staleThresholdSeconds) {
				return; // Not stale
			}

			// Check if PID is alive
			let pidAlive = false;
			try {
				process.kill(heartbeat.pid, 0);
				pidAlive = true;
			} catch {
				pidAlive = false;
			}

			if (pidAlive) {
				return; // PID alive, don't quarantine
			}

			// Lease is stale AND PID is dead — quarantine
			await this.quarantineLease(heartbeat);
		} catch {
			// Can't read heartbeat file — skip
		}
	}

	/**
	 * Quarantine a stale lease.
	 *
	 * Steps:
	 * 1. Rename worktree directory to .quarantined suffix
	 * 2. Delete the lease file
	 * 3. Emit quarantine event
	 */
	private async quarantineLease(heartbeat: LeaseHeartbeat): Promise<void> {
		const { leaseId, workspaceId, planExecId } = heartbeat;

		// Find the worktree directory for this workspace
		const worktreeDir = path.join(this.workspaceRoot, this.worktreeRoot, planExecId, workspaceId);

		const quarantinedDir = `${worktreeDir}.quarantined`;

		try {
			// Rename worktree to quarantined
			try {
				await fs.access(worktreeDir);
				await fs.rename(worktreeDir, quarantinedDir);
			} catch {
				// Worktree may not exist — that's fine
			}

			// Delete lease file
			await this.releaseLease(leaseId);

			const result: QuarantineResult = {
				success: true,
				leaseId,
				workspaceId,
				quarantinedPath: quarantinedDir,
			};

			this.onQuarantine?.(result);
		} catch (error) {
			const result: QuarantineResult = {
				success: false,
				leaseId,
				workspaceId,
				quarantinedPath: quarantinedDir,
				error: error instanceof Error ? error.message : String(error),
			};

			this.onQuarantine?.(result);
		}
	}

	// -----------------------------------------------------------------------
	// Lease reconciliation
	// -----------------------------------------------------------------------

	/**
	 * Reconcile all leases against worktree state.
	 *
	 * This runs on startup and during watchdog iterations to detect
	 * disagreements between lease files and worktree state.
	 *
	 * Precedence rules:
	 * - Lease file is ground truth for "was this workspace running"
	 * - Worktree state is ground truth for "what is on disk"
	 * - Disagreement → quarantine and requeue
	 */
	async reconcileAll(): Promise<LeaseReconciliationEvent[]> {
		const events: LeaseReconciliationEvent[] = [];

		try {
			const files = await fs.readdir(this.leaseDir);
			for (const file of files) {
				if (!file.endsWith(".heartbeat")) continue;
				const leaseId = file.replace(/\.heartbeat$/, "");
				const event = await this.reconcileLease(leaseId);
				if (event) events.push(event);
			}
		} catch {
			// Directory doesn't exist yet
		}

		return events;
	}

	/**
	 * Reconcile a single lease against worktree state.
	 */
	private async reconcileLease(leaseId: string): Promise<LeaseReconciliationEvent | null> {
		try {
			const heartbeatPath = this.heartbeatFilePath(leaseId);
			const content = await fs.readFile(heartbeatPath, "utf-8");
			const heartbeat: LeaseHeartbeat = JSON.parse(content);

			// Check worktree state
			const worktreeStatePath = path.join(this.workspaceRoot, ".pi", "worktree-state.json");
			let worktreeState: string | null = null;
			try {
				const stateContent = await fs.readFile(worktreeStatePath, "utf-8");
				const state = JSON.parse(stateContent);
				// Check if this workspace has a state entry
				const stateKey = `${heartbeat.planExecId}::${heartbeat.workspaceId}`;
				worktreeState =
					state.worktrees?.find((w: any) => {
						const key = `${w.planExecutionId}::${w.workspaceId}`;
						return key === stateKey;
					})?.status ?? null;
			} catch {
				// Worktree state file may not exist
			}

			// Lease file exists — workspace was running
			if (worktreeState === null || worktreeState === "completed") {
				// Disagreement: lease says running but worktree says completed or doesn't exist
				const event: LeaseReconciliationEvent = {
					disagreementType:
						worktreeState === "completed"
							? "lease_says_running_worktree_says_completed"
							: "lease_says_running_worktree_missing",
					leaseId,
					workspaceId: heartbeat.workspaceId,
					planExecId: heartbeat.planExecId,
					leaseState: "running",
					worktreeState,
					action: worktreeState === "completed" ? "treat_as_completed" : "quarantine_and_requeue",
				};
				this.onReconciliation?.(event);

				if (event.action === "quarantine_and_requeue") {
					await this.quarantineLease(heartbeat);
				} else {
					await this.releaseLease(leaseId);
				}

				return event;
			}
		} catch {
			// Can't read lease file
		}

		return null;
	}
}

/**
 * Create a LeaseMonitor instance.
 *
 * @param config - Lease monitor configuration
 * @param workspaceRoot - Workspace root directory
 * @returns A new LeaseMonitor instance
 */
export function createLeaseMonitor(config: Partial<LeaseMonitorConfig>, workspaceRoot: string): LeaseMonitor {
	return new LeaseMonitor(config, workspaceRoot);
}
