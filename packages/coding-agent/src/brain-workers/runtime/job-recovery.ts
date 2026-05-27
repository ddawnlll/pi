/**
 * Worker Crash Recovery and Job Resumption — 25.S
 *
 * Detects brain worker process crashes, reloads persisted job state,
 * recovers lost leases, and resumes pending jobs with evidence-backed
 * diagnostics.
 *
 * Features:
 * 1. **Crash detection** via session markers (clean shutdown flag)
 * 2. **Persistent job state** reload from JSON-backed store
 * 3. **Lease recovery** — jobs that were "leased" at crash time are
 *    failed with timeout diagnostic and retried (or dispatched to
 *    another worker)
 * 4. **Job resumption** — "pending" jobs that survived the crash are
 *    re-dispatched to available workers
 * 5. **Evidence-backed diagnostics** on all recovery actions
 * 6. **Budget, cooldown, dedup, and stop-condition handling**
 *    integrated into the recovery workflow
 *
 * The recovery engine is a standalone orchestrator that coordinates
 * between the JobStateStore (persistence) and BrainSupervisor
 * (live routing/execution). It is called on startup before the
 * supervisor begins accepting new jobs.
 *
 * Dependencies:
 * - ./job-state-store.ts — persistent job state
 * - ../supervisor/supervisor.ts — live job routing and lifecycle
 * - ../types.ts — diagnostics, stop conditions, budgets
 *
 * @packageDocumentation
 */

import type { BrainSupervisor } from "../supervisor/supervisor.js";
import type { WorkerDiagnostic, WorkerStopCondition } from "../types.js";
import { createWorkerDiagnostic } from "../types.js";
import type { JobStateStore, PersistedJobRecord, SessionMarker } from "./job-state-store.js";

// ---------------------------------------------------------------------------
// Recovery Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the recovery engine.
 *
 * Sensible defaults provided for all values.
 */
export interface RecoveryConfig {
	/**
	 * Whether auto-recovery on startup is enabled.
	 * If false, recovery must be triggered manually via recover().
	 * Default: true.
	 */
	autoRecoverOnStart: boolean;

	/**
	 * Whether to recover expired leases from the persisted state.
	 * If false, expired leases are left as-is for manual intervention.
	 * Default: true.
	 */
	recoverExpiredLeases: boolean;

	/**
	 * Whether to re-dispatch pending jobs after recovery.
	 * If false, pending jobs are recovered but not automatically dispatched.
	 * Default: true.
	 */
	redispatchPendingJobs: boolean;

	/**
	 * Whether to produce evidence-backed diagnostics for all
	 * recovery actions. Default: true.
	 */
	produceDiagnostics: boolean;

	/**
	 * Maximum number of jobs to recover in a single recovery pass.
	 * Prevents a massive backlog from overwhelming the system on restart.
	 * Default: 100.
	 */
	maxRecoveryBatchSize: number;

	/**
	 * Cooldown period in milliseconds after a recovery action before
	 * new jobs are accepted. Default: 5_000 (5 seconds).
	 */
	recoveryCooldownMs: number;

	/**
	 * Lease duration in milliseconds for re-dispatched recovered jobs.
	 * Shorter than the default lease to allow faster failure detection
	 * on recovered jobs. Default: 60_000 (1 minute).
	 */
	recoveredLeaseDurationMs: number;

	/**
	 * Whether to enable content-based dedup during recovery.
	 * Prevents duplicate job creation from stale state. Default: true.
	 */
	dedupEnabled: boolean;

	/**
	 * Dedup window in milliseconds during recovery.
	 * Default: 300_000 (5 minutes).
	 */
	dedupWindowMs: number;
}

/**
 * Default recovery configuration.
 */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
	autoRecoverOnStart: true,
	recoverExpiredLeases: true,
	redispatchPendingJobs: true,
	produceDiagnostics: true,
	maxRecoveryBatchSize: 100,
	recoveryCooldownMs: 5_000,
	recoveredLeaseDurationMs: 60_000,
	dedupEnabled: true,
	dedupWindowMs: 300_000,
};

// ---------------------------------------------------------------------------
// Recovery Result
// ---------------------------------------------------------------------------

/**
 * Counts of recovery actions performed.
 */
export interface RecoveryCounts {
	/** Number of expired leases detected and recovered */
	expiredLeasesRecovered: number;
	/** Number of jobs re-dispatched to available workers */
	jobsRedispatched: number;
	/** Number of jobs that were already in terminal states (completed/failed/cancelled) */
	jobsPreserved: number;
	/** Number of jobs that exceeded max retries and were marked as failed */
	jobsExhausted: number;
	/** Number of diagnostics produced during recovery */
	diagnosticsProduced: number;
}

/**
 * Overall result of a recovery pass.
 */
export interface RecoveryResult {
	/** Whether recovery was successful (no fatal errors) */
	success: boolean;
	/** Whether a crash was detected */
	crashDetected: boolean;
	/** The previous session marker, if a crash was detected */
	previousSession: SessionMarker | null;
	/** The current session ID after recovery */
	currentSessionId: string;
	/** Timing information */
	timestamps: {
		recoveryStarted: string;
		recoveryCompleted: string;
	};
	/** Recovery action counts */
	counts: RecoveryCounts;
	/** Human-readable summary */
	summary: string;
	/** Diagnostics produced during recovery */
	diagnostics: WorkerDiagnostic[];
	/** Error message if recovery failed */
	error?: string;
}

// ---------------------------------------------------------------------------
// Recovery Diagnostics Builder
// ---------------------------------------------------------------------------

/**
 * Build an evidence-backed diagnostic for a recovery action.
 *
 * @param stopCondition - The stop condition to report
 * @param message - Human-readable description
 * @param context - Relevant context about the recovery action
 * @param evidenceRefs - References to source artifacts
 * @returns A WorkerDiagnostic
 */
function buildRecoveryDiagnostic(
	stopCondition: WorkerStopCondition,
	message: string,
	context: Record<string, unknown> = {},
	evidenceRefs: string[] = [],
): WorkerDiagnostic {
	return createWorkerDiagnostic(
		stopCondition,
		message,
		{
			origin: "job-recovery",
			...context,
		},
		["recovery://25.S", ...evidenceRefs],
	);
}

// ---------------------------------------------------------------------------
// Recovery Engine
// ---------------------------------------------------------------------------

/**
 * Engine for detecting and recovering from brain worker process crashes.
 *
 * The recovery engine is the entry point for all crash recovery
 * operations. It coordinates between the persistent job state store
 * and the live supervisor to restore the system to a working state
 * after a crash.
 *
 * Usage:
 * ```typescript
 * const store = new JobStateStore(workspaceRoot);
 * await store.init();
 *
 * const supervisor = new BrainSupervisor();
 * supervisor.start();
 * // ... register workers ...
 *
 * const recovery = new JobRecoveryEngine(store, supervisor);
 * const result = await recovery.runRecovery();
 *
 * if (result.crashDetected) {
 *   console.log(`Recovered from crash: ${result.summary}`);
 * }
 * ```
 */
export class JobRecoveryEngine {
	private config: RecoveryConfig;
	private jobStore: JobStateStore;
	private supervisor: BrainSupervisor;
	private recoveredJobIds: Set<string> = new Set();

	/**
	 * Create a new JobRecoveryEngine.
	 *
	 * @param jobStore - Initialised JobStateStore instance
	 * @param supervisor - Initialised BrainSupervisor instance
	 * @param config - Optional partial configuration overrides
	 */
	constructor(jobStore: JobStateStore, supervisor: BrainSupervisor, config?: Partial<RecoveryConfig>) {
		this.jobStore = jobStore;
		this.supervisor = supervisor;
		this.config = {
			autoRecoverOnStart: config?.autoRecoverOnStart ?? DEFAULT_RECOVERY_CONFIG.autoRecoverOnStart,
			recoverExpiredLeases: config?.recoverExpiredLeases ?? DEFAULT_RECOVERY_CONFIG.recoverExpiredLeases,
			redispatchPendingJobs: config?.redispatchPendingJobs ?? DEFAULT_RECOVERY_CONFIG.redispatchPendingJobs,
			produceDiagnostics: config?.produceDiagnostics ?? DEFAULT_RECOVERY_CONFIG.produceDiagnostics,
			maxRecoveryBatchSize: config?.maxRecoveryBatchSize ?? DEFAULT_RECOVERY_CONFIG.maxRecoveryBatchSize,
			recoveryCooldownMs: config?.recoveryCooldownMs ?? DEFAULT_RECOVERY_CONFIG.recoveryCooldownMs,
			recoveredLeaseDurationMs: config?.recoveredLeaseDurationMs ?? DEFAULT_RECOVERY_CONFIG.recoveredLeaseDurationMs,
			dedupEnabled: config?.dedupEnabled ?? DEFAULT_RECOVERY_CONFIG.dedupEnabled,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_RECOVERY_CONFIG.dedupWindowMs,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get a snapshot of the current configuration.
	 */
	getConfig(): RecoveryConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration. Only provided fields are changed.
	 */
	setConfig(config: Partial<RecoveryConfig>): void {
		if (config.autoRecoverOnStart !== undefined) this.config.autoRecoverOnStart = config.autoRecoverOnStart;
		if (config.recoverExpiredLeases !== undefined) this.config.recoverExpiredLeases = config.recoverExpiredLeases;
		if (config.redispatchPendingJobs !== undefined) this.config.redispatchPendingJobs = config.redispatchPendingJobs;
		if (config.produceDiagnostics !== undefined) this.config.produceDiagnostics = config.produceDiagnostics;
		if (config.maxRecoveryBatchSize !== undefined) this.config.maxRecoveryBatchSize = config.maxRecoveryBatchSize;
		if (config.recoveryCooldownMs !== undefined) this.config.recoveryCooldownMs = config.recoveryCooldownMs;
		if (config.recoveredLeaseDurationMs !== undefined)
			this.config.recoveredLeaseDurationMs = config.recoveredLeaseDurationMs;
		if (config.dedupEnabled !== undefined) this.config.dedupEnabled = config.dedupEnabled;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
	}

	// -----------------------------------------------------------------------
	// Crash Detection
	// -----------------------------------------------------------------------

	/**
	 * Check if the previous session appears to have crashed.
	 *
	 * A crash is detected when the session marker exists and the
	 * cleanShutdown flag is false.
	 *
	 * @returns true if a previous session crash was detected
	 */
	detectCrash(): boolean {
		return this.jobStore.wasPreviousSessionCrashed();
	}

	/**
	 * Get information about the previous session.
	 *
	 * @returns The previous session marker, or null if none exists
	 */
	getPreviousSession(): SessionMarker | null {
		return this.jobStore.getPreviousSessionMarker();
	}

	// -----------------------------------------------------------------------
	// Recovery
	// -----------------------------------------------------------------------

	/**
	 * Run the full recovery workflow.
	 *
	 * Steps:
	 * 1. Detect if the previous session crashed
	 * 2. If crashed, recover expired leases from persisted state
	 * 3. Re-dispatch pending jobs to available workers
	 * 4. Persist diagnostics about recovery actions
	 * 5. Apply budget/cooldown/dedup/stop-condition handling
	 *
	 * The supervisor must be started and have workers registered before
	 * calling this method.
	 *
	 * @returns A RecoveryResult with details of what was recovered
	 */
	async runRecovery(): Promise<RecoveryResult> {
		const recoveryStarted = new Date().toISOString();
		const diagnostics: WorkerDiagnostic[] = [];
		const counts: RecoveryCounts = {
			expiredLeasesRecovered: 0,
			jobsRedispatched: 0,
			jobsPreserved: 0,
			jobsExhausted: 0,
			diagnosticsProduced: 0,
		};

		let crashDetected = false;
		let previousSession: SessionMarker | null = null;

		try {
			// Step 1: Detect crash
			crashDetected = this.detectCrash();
			previousSession = this.getPreviousSession();

			if (crashDetected) {
				if (this.config.produceDiagnostics) {
					const diag = buildRecoveryDiagnostic(
						"unknown_error",
						`Crash detected: previous session '${previousSession?.sessionId ?? "unknown"}' did not complete clean shutdown`,
						{
							previousSessionId: previousSession?.sessionId ?? null,
							previousSessionStartedAt: previousSession?.startedAt ?? null,
							jobCount: previousSession?.jobCount ?? 0,
						},
						[`session://${previousSession?.sessionId ?? "unknown"}`],
					);
					diagnostics.push(diag);
					counts.diagnosticsProduced++;
				}

				// Step 2: Recover expired leases
				if (this.config.recoverExpiredLeases) {
					const recovered = this.recoverExpiredLeases();
					counts.expiredLeasesRecovered = recovered.count;
					counts.diagnosticsProduced += recovered.diagnostics.length;
					diagnostics.push(...recovered.diagnostics);
				}

				// Step 3: Re-dispatch pending jobs
				if (this.config.redispatchPendingJobs) {
					const redispatched = this.redispatchPendingJobs();
					counts.jobsRedispatched = redispatched.count;
					counts.jobsExhausted = redispatched.exhausted;
					counts.jobsPreserved = redispatched.preserved;
					diagnostics.push(...redispatched.diagnostics);
					counts.diagnosticsProduced += redispatched.diagnostics.length;
				}
			} else {
				// No crash detected — count existing non-terminal jobs as preserved
				const stats = this.jobStore.getStats();
				counts.jobsPreserved = stats.pending + stats.leased;

				if (this.config.produceDiagnostics) {
					const diag = buildRecoveryDiagnostic(
						"completed",
						"No crash detected — previous session had clean shutdown",
						{
							previousSessionId: previousSession?.sessionId ?? null,
							jobStats: stats,
						},
					);
					diagnostics.push(diag);
					counts.diagnosticsProduced++;
				}
			}

			// Persist updates to the job store
			await this.jobStore.save();

			const recoveryCompleted = new Date().toISOString();

			// Build summary
			const parts: string[] = [];
			if (crashDetected) {
				parts.push("Crash detected and recovered");
			} else {
				parts.push("No crash detected");
			}
			if (counts.expiredLeasesRecovered > 0) {
				parts.push(`${counts.expiredLeasesRecovered} expired lease(s) recovered`);
			}
			if (counts.jobsRedispatched > 0) {
				parts.push(`${counts.jobsRedispatched} job(s) re-dispatched`);
			}
			if (counts.jobsExhausted > 0) {
				parts.push(`${counts.jobsExhausted} job(s) exhausted (max retries)`);
			}
			parts.push(`${counts.jobsPreserved} job(s) preserved`);

			return {
				success: true,
				crashDetected,
				previousSession,
				currentSessionId: this.jobStore.getSessionId(),
				timestamps: {
					recoveryStarted,
					recoveryCompleted,
				},
				counts,
				summary: `${parts.join("; ")}.`,
				diagnostics,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error during recovery";

			if (this.config.produceDiagnostics) {
				const diag = buildRecoveryDiagnostic(
					"unknown_error",
					`Recovery failed: ${errorMessage}`,
					{
						error: errorMessage,
						recoveryPhase: "runRecovery",
					},
					["recovery://25.S/error"],
				);
				diagnostics.push(diag);
				counts.diagnosticsProduced++;
			}

			return {
				success: false,
				crashDetected,
				previousSession,
				currentSessionId: this.jobStore.getSessionId(),
				timestamps: {
					recoveryStarted,
					recoveryCompleted: new Date().toISOString(),
				},
				counts,
				summary: `Recovery failed: ${errorMessage}`,
				diagnostics,
				error: errorMessage,
			};
		}
	}

	// -----------------------------------------------------------------------
	// Lease Recovery
	// -----------------------------------------------------------------------

	/**
	 * Recover expired leases from the persisted job state.
	 *
	 * For each expired lease:
	 * 1. Mark the job as failed with a timeout diagnostic
	 * 2. If the job has remaining retries, re-dispatched it to pending
	 * 3. If no retries remain, mark as permanently failed
	 *
	 * @returns Recovery counts and diagnostics for lease recovery
	 */
	recoverExpiredLeases(): {
		count: number;
		diagnostics: WorkerDiagnostic[];
	} {
		const diagnostics: WorkerDiagnostic[] = [];
		const expiredJobs = this.jobStore.getExpiredLeasedJobs();
		let count = 0;

		// Apply batch size limit
		const batch = expiredJobs.slice(0, this.config.maxRecoveryBatchSize);

		for (const job of batch) {
			// Build evidence-backed timeout diagnostic
			const diagnostic = buildRecoveryDiagnostic(
				"timeout",
				`Job lease expired during crash: job '${job.id}' (${job.jobType}) was leased to worker '${job.workerId}' but never completed`,
				{
					jobId: job.id,
					jobType: job.jobType,
					targetRole: job.targetRole,
					workerId: job.workerId,
					leaseExpiresAt: job.leaseExpiresAt,
					leasedAt: job.leasedAt,
					recoveryAction: "lease_failed_timeout",
				},
				[`job://${job.id}`, `worker://${job.workerId ?? "unknown"}`, `recovery://25.S/lease-recovery`],
			);

			diagnostics.push(diagnostic);

			// Check retry budget
			const retryCount = job.retryCount;
			const maxRetries = job.maxRetries;

			if (retryCount < maxRetries) {
				// Reset to pending for retry
				this.jobStore.updateJobStatus(job.id, "pending", {
					workerId: null,
					leasedAt: null,
					leaseExpiresAt: null,
					error: `Lease expired after crash (retry ${retryCount + 1}/${maxRetries})`,
					diagnostic: {
						timestamp: diagnostic.timestamp,
						stopCondition: diagnostic.stopCondition,
						message: diagnostic.message,
						context: diagnostic.context,
						evidenceRefs: diagnostic.evidenceRefs,
					},
					retryCount: retryCount + 1,
				});
			} else {
				// Exhausted retries — mark as permanently failed
				this.jobStore.updateJobStatus(job.id, "failed", {
					workerId: null,
					leasedAt: null,
					leaseExpiresAt: null,
					error: `Lease expired after crash — no retries remaining (${maxRetries}/${maxRetries})`,
					diagnostic: {
						timestamp: diagnostic.timestamp,
						stopCondition: diagnostic.stopCondition,
						message: diagnostic.message,
						context: diagnostic.context,
						evidenceRefs: diagnostic.evidenceRefs,
					},
					retryCount: retryCount,
				});
			}

			this.recoveredJobIds.add(job.id);
			count++;
		}

		return { count, diagnostics };
	}

	// -----------------------------------------------------------------------
	// Pending Job Re-dispatch
	// -----------------------------------------------------------------------

	/**
	 * Re-dispatch pending jobs to available workers via the supervisor.
	 *
	 * For each pending job:
	 * 1. Check dedup to prevent duplicate dispatch
	 * 2. Submit to supervisor for routing
	 * 3. If worker not available, leave as pending
	 *
	 * @returns Recovery counts and diagnostics for re-dispatch
	 */
	redispatchPendingJobs(): {
		count: number;
		exhausted: number;
		preserved: number;
		diagnostics: WorkerDiagnostic[];
	} {
		const diagnostics: WorkerDiagnostic[] = [];
		let count = 0;
		let exhausted = 0;
		let preserved = 0;

		const pendingJobs = this.jobStore.getJobs("pending");
		const batch = pendingJobs.slice(0, this.config.maxRecoveryBatchSize);

		for (const job of batch) {
			// Skip jobs we already recovered (dedup within recovery)
			if (this.recoveredJobIds.has(job.id)) continue;

			// Check retry budget before re-dispatch
			if (job.retryCount >= job.maxRetries) {
				// Mark as failed
				const diagnostic = buildRecoveryDiagnostic(
					"consecutive_failures_exceeded",
					`Job '${job.id}' (${job.jobType}) has exhausted retries (${job.retryCount}/${job.maxRetries}) — marking as failed`,
					{
						jobId: job.id,
						jobType: job.jobType,
						targetRole: job.targetRole,
						retryCount: job.retryCount,
						maxRetries: job.maxRetries,
					},
					[`job://${job.id}`, `recovery://25.S/retry-exhausted`],
				);

				diagnostics.push(diagnostic);
				this.jobStore.updateJobStatus(job.id, "failed", {
					error: `Exhausted retries during crash recovery (${job.retryCount}/${job.maxRetries})`,
					diagnostic: {
						timestamp: diagnostic.timestamp,
						stopCondition: diagnostic.stopCondition,
						message: diagnostic.message,
						context: diagnostic.context,
						evidenceRefs: diagnostic.evidenceRefs,
					},
				});

				exhausted++;
				continue;
			}

			// Check dedup: skip if same task hash was recently dispatched
			if (this.config.dedupEnabled) {
				const recentlyRecovered = this.checkDedup(job);
				if (recentlyRecovered) {
					// Dedup preserved — leave as pending for later dispatch
					preserved++;
					continue;
				}
			}

			// Submit to supervisor for routing
			try {
				const supervisorJob = this.supervisor.submitJob(
					{
						targetRole: job.targetRole,
						jobType: job.jobType,
						payload: job.payload,
						taskHash: job.taskHash,
						traceId: job.traceId ?? undefined,
						spanId: job.spanId ?? undefined,
						correlationId: job.correlationId ?? undefined,
						projectId: job.projectId ?? undefined,
						planExecutionId: job.planExecutionId ?? undefined,
						workspaceExecutionId: job.workspaceExecutionId ?? undefined,
					},
					{
						priority: job.priority as any,
						maxRetries: job.maxRetries,
					},
				);

				if (supervisorJob) {
					// Job was submitted successfully — update persisted state
					this.jobStore.updateJobStatus(job.id, "leased", {
						workerId: supervisorJob.workerId,
						leasedAt: supervisorJob.leasedAt,
						leaseExpiresAt: supervisorJob.leaseExpiresAt,
					});

					if (this.config.produceDiagnostics) {
						const diag = buildRecoveryDiagnostic(
							"completed",
							`Job '${job.id}' (${job.jobType}) re-dispatched to worker '${supervisorJob.workerId}'`,
							{
								jobId: job.id,
								jobType: job.jobType,
								targetRole: job.targetRole,
								workerId: supervisorJob.workerId,
								supervisorJobId: supervisorJob.id,
							},
							[`job://${job.id}`, `recovery://25.S/redispatched`],
						);
						diagnostics.push(diag);
					}

					this.recoveredJobIds.add(job.id);
					count++;
				} else {
					// Deduped by supervisor — preserved
					preserved++;

					if (this.config.produceDiagnostics) {
						const diag = buildRecoveryDiagnostic(
							"completed",
							`Job '${job.id}' (${job.jobType}) deduped by supervisor — skipping`,
							{
								jobId: job.id,
								jobType: job.jobType,
								targetRole: job.targetRole,
							},
							[`job://${job.id}`, `recovery://25.S/deduped`],
						);
						diagnostics.push(diag);
					}
				}
			} catch (error) {
				// Supervisor submission failed — keep as pending for later
				preserved++;

				if (this.config.produceDiagnostics) {
					const diag = buildRecoveryDiagnostic(
						"unknown_error",
						`Failed to re-dispatch job '${job.id}': ${(error as Error).message}`,
						{
							jobId: job.id,
							jobType: job.jobType,
							targetRole: job.targetRole,
							error: (error as Error).message,
						},
						[`job://${job.id}`, `recovery://25.S/dispatch-error`],
					);
					diagnostics.push(diag);
				}
			}
		}

		return { count, exhausted, preserved, diagnostics };
	}

	// -----------------------------------------------------------------------
	// Dedup Check
	// -----------------------------------------------------------------------

	/**
	 * Check if a job should be deduped based on recently recovered jobs.
	 *
	 * @param job - The persisted job record to check
	 * @returns true if this job looks like a duplicate
	 */
	private checkDedup(job: PersistedJobRecord): boolean {
		if (!this.config.dedupEnabled) return false;

		const now = Date.now();

		// Check against recently recovered jobs
		for (const recoveredId of this.recoveredJobIds) {
			const recovered = this.jobStore.getJob(recoveredId);
			if (!recovered) continue;

			// Same task hash = duplicate
			if (recovered.taskHash === job.taskHash) {
				const age = now - new Date(recovered.updatedAt).getTime();
				if (age < this.config.dedupWindowMs) {
					return true;
				}
			}
		}

		return false;
	}

	// -----------------------------------------------------------------------
	// Information
	// -----------------------------------------------------------------------

	/**
	 * Get the list of job IDs that have been recovered in this session.
	 */
	getRecoveredJobIds(): string[] {
		return Array.from(this.recoveredJobIds);
	}

	/**
	 * Get the current count of recovered jobs.
	 */
	getRecoveredJobCount(): number {
		return this.recoveredJobIds.size;
	}

	/**
	 * Check whether a specific job was recovered.
	 *
	 * @param jobId - The job ID to check
	 * @returns true if the job was recovered in this session
	 */
	isJobRecovered(jobId: string): boolean {
		return this.recoveredJobIds.has(jobId);
	}

	/**
	 * Get the recovery eligibility of jobs from the persisted store.
	 *
	 * @returns Array of PersistedJobRecord that are eligible for recovery
	 */
	getRecoverableJobs(): PersistedJobRecord[] {
		return this.jobStore.getRecoverableJobs();
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a JobRecoveryEngine with default configuration.
 *
 * @param jobStore - Initialised JobStateStore instance
 * @param supervisor - Initialised BrainSupervisor instance
 * @param config - Optional partial configuration overrides
 * @returns A new JobRecoveryEngine instance
 */
export function createJobRecoveryEngine(
	jobStore: JobStateStore,
	supervisor: BrainSupervisor,
	config?: Partial<RecoveryConfig>,
): JobRecoveryEngine {
	return new JobRecoveryEngine(jobStore, supervisor, config);
}
