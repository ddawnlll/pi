/**
 * Brain Orchestrator Supervisor — 25.D
 *
 * Routes jobs to specialist brain workers, manages leases, cooldowns,
 * job states, health, retries, and audit events.
 *
 * The supervisor is the central orchestrator that:
 * 1. Accepts job submissions and routes them to capable workers
 * 2. Manages job leases with timeout-based recovery
 * 3. Tracks worker health via heartbeats and failure detection
 * 4. Enforces budgets, cooldowns, deduplication, and stop conditions
 * 5. Produces evidence-backed diagnostics on all failures
 * 6. Emits observability events for traceability
 *
 * Dependencies:
 * - JobStore (./job-lease.ts) — job lifecycle management
 * - WorkerHealthMonitor (./worker-health.ts) — health tracking
 * - WorkerLifecycleEngine (../lifecycle.ts) — state transitions
 * - ContractRegistry (../contracts.ts) — capability-based routing
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { ContractRegistry, matchCapabilities } from "../contracts.js";
import { WorkerLifecycleEngine } from "../lifecycle.js";
import type { WorkerDiagnostic, WorkerManifest } from "../types.js";
import { createWorkerDiagnostic } from "../types.js";
import {
	DEFAULT_LEASE_CONFIG,
	type JobInput,
	type JobPriority,
	type JobRecord,
	JobStore,
	type LeaseConfig,
} from "./job-lease.js";
import {
	DEFAULT_HEALTH_CHECK_CONFIG,
	type HealthCheckConfig,
	type HealthCheckResult,
	WorkerHealthMonitor,
} from "./worker-health.js";

// ---------------------------------------------------------------------------
// Supervisor Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Brain Orchestrator Supervisor.
 *
 * All fields have sensible defaults. Override only what you need.
 */
export interface BrainSupervisorConfig {
	/** Lease configuration for job lifecycle */
	leaseConfig: LeaseConfig;

	/** Health check configuration for worker monitoring */
	healthConfig: HealthCheckConfig;

	/** Whether observability events are enabled (default: true) */
	observabilityEnabled: boolean;

	/** Whether the supervisor auto-recovers expired leases (default: true) */
	autoRecoverLeases: boolean;

	/** Maximum number of concurrent jobs per worker (default: 3) */
	maxJobsPerWorker: number;

	/** Whether to enable capability-based job routing (default: true) */
	capabilityRouting: boolean;
}

/**
 * Default supervisor configuration.
 */
export const DEFAULT_SUPERVISOR_CONFIG: BrainSupervisorConfig = {
	leaseConfig: { ...DEFAULT_LEASE_CONFIG },
	healthConfig: { ...DEFAULT_HEALTH_CHECK_CONFIG },
	observabilityEnabled: true,
	autoRecoverLeases: true,
	maxJobsPerWorker: 3,
	capabilityRouting: true,
};

// ---------------------------------------------------------------------------
// Supervisor State
// ---------------------------------------------------------------------------

/**
 * Operational state of the supervisor daemon.
 */
export type SupervisorState = "stopped" | "running" | "paused" | "failed";

/**
 * All valid SupervisorState values.
 */
export const ALL_SUPERVISOR_STATES: readonly SupervisorState[] = ["stopped", "running", "paused", "failed"] as const;

// ---------------------------------------------------------------------------
// Supervisor Event
// ---------------------------------------------------------------------------

/**
 * Event emitted by the supervisor for observability integration.
 *
 * Each event carries trace/correlation identifiers so it can be linked
 * to the broader observability system.
 */
export interface SupervisorEvent {
	/** Unique event identifier */
	id: string;
	/** Event type (e.g., "job_submitted", "job_completed", "worker_unhealthy") */
	eventType: string;
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Job ID if this event is about a specific job */
	jobId: string | null;
	/** Worker ID if this event is about a specific worker */
	workerId: string | null;
	/** Human-readable description */
	message: string;
	/** Arbitrary event payload */
	data: Record<string, unknown>;
	/** Trace identifiers for observability linkage */
	traceId: string | null;
	spanId: string | null;
	correlationId: string | null;
	projectId: string | null;
	planExecutionId: string | null;
	workspaceExecutionId: string | null;
}

// ---------------------------------------------------------------------------
// Supervisor Diagnostics
// ---------------------------------------------------------------------------

/**
 * Diagnostic snapshot of the supervisor's current state.
 *
 * Provides evidence-backed visibility into supervisor operations for
 * dashboard and debugging purposes.
 */
export interface SupervisorDiagnostics {
	/** Supervisor operational state */
	state: SupervisorState;
	/** ISO 8601 timestamp when supervisor started */
	startedAt: string | null;
	/** Number of jobs submitted since start */
	totalJobsSubmitted: number;
	/** Number of jobs completed since start */
	totalJobsCompleted: number;
	/** Number of jobs failed since start */
	totalJobsFailed: number;
	/** Number of jobs cancelled since start */
	totalJobsCancelled: number;
	/** Number of lease recoveries performed */
	totalLeaseRecoveries: number;
	/** Number of workers registered */
	registeredWorkerCount: number;
	/** Health stats from health monitor */
	healthStats: {
		healthy: number;
		degraded: number;
		unhealthy: number;
		unknown: number;
		stale: number;
	};
	/** Job store statistics */
	jobStats: {
		pending: number;
		leased: number;
		completed: number;
		failed: number;
		cancelled: number;
	};
	/** Last error message, if any */
	lastError: string | null;
	/** ISO 8601 timestamp of last error */
	lastErrorAt: string | null;
	/** Number of events emitted since start */
	eventsEmitted: number;
}

// ---------------------------------------------------------------------------
// BrainSupervisor
// ---------------------------------------------------------------------------

/**
 * Main supervisor class that routes jobs, manages leases, monitors health,
 * and produces evidence-backed diagnostics.
 *
 * Usage:
 * ```typescript
 * const supervisor = new BrainSupervisor();
 *
 * // Register workers
 * supervisor.registerWorker(manifest);
 *
 * // Submit a job
 * const job = supervisor.submitJob(input);
 *
 * // Lease the job to an available worker
 * const leased = supervisor.leaseNextJob(workerId);
 *
 * // Complete or fail the job
 * supervisor.completeJob(job.id, output);
 * supervisor.failJob(job.id, "reason", diagnostic);
 *
 * // Monitor health
 * const results = supervisor.checkAllHealth();
 * ```
 */
export class BrainSupervisor {
	private config: BrainSupervisorConfig;
	private state: SupervisorState = "stopped";
	private startedAt: string | null = null;

	// Sub-systems
	private jobStore: JobStore;
	private healthMonitor: WorkerHealthMonitor;
	private lifecycleEngine: WorkerLifecycleEngine;
	private contractRegistry: ContractRegistry;

	// Metrics
	private totalJobsSubmitted = 0;
	private totalJobsCompleted = 0;
	private totalJobsFailed = 0;
	private totalJobsCancelled = 0;
	private totalLeaseRecoveries = 0;
	private eventsEmitted = 0;
	private lastError: string | null = null;
	private lastErrorAt: string | null = null;

	// Event callback
	private eventCallbacks: Array<(event: SupervisorEvent) => void> = [];

	// Worker-to-job mapping (workerId -> Set of job IDs)
	private workerJobs: Map<string, Set<string>> = new Map();

	/**
	 * Create a new BrainSupervisor.
	 *
	 * @param config - Optional partial configuration overrides
	 */
	constructor(config?: Partial<BrainSupervisorConfig>) {
		this.config = {
			leaseConfig: { ...DEFAULT_LEASE_CONFIG, ...config?.leaseConfig },
			healthConfig: { ...DEFAULT_HEALTH_CHECK_CONFIG, ...config?.healthConfig },
			observabilityEnabled: config?.observabilityEnabled ?? DEFAULT_SUPERVISOR_CONFIG.observabilityEnabled,
			autoRecoverLeases: config?.autoRecoverLeases ?? DEFAULT_SUPERVISOR_CONFIG.autoRecoverLeases,
			maxJobsPerWorker: config?.maxJobsPerWorker ?? DEFAULT_SUPERVISOR_CONFIG.maxJobsPerWorker,
			capabilityRouting: config?.capabilityRouting ?? DEFAULT_SUPERVISOR_CONFIG.capabilityRouting,
		};

		this.jobStore = new JobStore();
		this.healthMonitor = new WorkerHealthMonitor(this.config.healthConfig);
		this.lifecycleEngine = new WorkerLifecycleEngine();
		this.contractRegistry = new ContractRegistry();
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Start the supervisor.
	 *
	 * Transitions from "stopped" to "running".
	 * @throws If supervisor is in "failed" state (must reset first)
	 */
	start(): void {
		if (this.state === "running") {
			this.emitEvent("supervisor_warn", "Supervisor is already running", {});
			return;
		}
		if (this.state === "failed") {
			throw new Error("Cannot start supervisor from failed state; call reset() first");
		}

		this.state = "running";
		this.startedAt = new Date().toISOString();

		this.emitEvent("supervisor_started", "Supervisor started", {
			config: {
				autoRecoverLeases: this.config.autoRecoverLeases,
				observabilityEnabled: this.config.observabilityEnabled,
				maxJobsPerWorker: this.config.maxJobsPerWorker,
			},
		});
	}

	/**
	 * Pause the supervisor.
	 *
	 * Transitions from "running" to "paused". Existing jobs continue
	 * but no new jobs are dispatched.
	 * @throws If supervisor is not running
	 */
	pause(): void {
		if (this.state !== "running") {
			throw new Error("Cannot pause: supervisor is not running");
		}

		this.state = "paused";
		this.emitEvent("supervisor_paused", "Supervisor paused", {});
	}

	/**
	 * Resume the supervisor after a pause.
	 *
	 * @throws If supervisor is not paused
	 */
	resume(): void {
		if (this.state !== "paused") {
			throw new Error("Cannot resume: supervisor is not paused");
		}

		this.state = "running";
		this.emitEvent("supervisor_resumed", "Supervisor resumed", {});
	}

	/**
	 * Stop the supervisor.
	 *
	 * Transitions to "stopped". Does not cancel in-flight jobs.
	 */
	stop(): void {
		this.state = "stopped";
		this.emitEvent("supervisor_stopped", "Supervisor stopped", {});
	}

	/**
	 * Reset the supervisor to initial state.
	 *
	 * Clears all job store, health data, and resets counters.
	 * Only call when supervisor is stopped or failed.
	 */
	reset(): void {
		if (this.state === "running" || this.state === "paused") {
			throw new Error("Cannot reset: stop or pause supervisor first");
		}

		this.jobStore.clear();
		this.healthMonitor.clear();
		this.workerJobs.clear();
		this.totalJobsSubmitted = 0;
		this.totalJobsCompleted = 0;
		this.totalJobsFailed = 0;
		this.totalJobsCancelled = 0;
		this.totalLeaseRecoveries = 0;
		this.eventsEmitted = 0;
		this.lastError = null;
		this.lastErrorAt = null;
		this.state = "stopped";
		this.startedAt = null;

		this.emitEvent("supervisor_reset", "Supervisor reset to initial state", {});
	}

	/**
	 * Get the current supervisor state.
	 */
	getState(): SupervisorState {
		return this.state;
	}

	// -----------------------------------------------------------------------
	// Worker Registration
	// -----------------------------------------------------------------------

	/**
	 * Register a worker with the supervisor.
	 *
	 * Adds the worker to the lifecycle engine, health monitor,
	 * and contract registry.
	 *
	 * @param manifest - Worker manifest describing capabilities and budget
	 * @throws If the worker is already registered
	 */
	registerWorker(manifest: WorkerManifest): void {
		if (this.lifecycleEngine.getStatus(manifest.id)) {
			throw new Error(`Worker '${manifest.id}' is already registered`);
		}

		// Register with lifecycle engine
		this.lifecycleEngine.registerWorker(manifest);

		// Register with health monitor
		this.healthMonitor.registerWorker(manifest.id);

		// Register contract in registry
		try {
			this.contractRegistry.register(manifest.contract);
		} catch {
			// Contract may already be registered — that's okay
		}

		this.emitEvent("worker_registered", `Worker '${manifest.name}' registered`, {
			workerId: manifest.id,
			role: manifest.role,
			version: manifest.version,
		});
	}

	/**
	 * Unregister a worker from the supervisor.
	 *
	 * @param workerId - Worker ID to unregister
	 * @returns true if the worker was found and unregistered
	 */
	unregisterWorker(workerId: string): boolean {
		const status = this.lifecycleEngine.getStatus(workerId);
		if (!status) return false;

		this.healthMonitor.unregisterWorker(workerId);
		this.workerJobs.delete(workerId);
		this.lifecycleEngine.unregisterWorker(workerId);

		this.emitEvent("worker_unregistered", `Worker '${workerId}' unregistered`, { workerId });
		return true;
	}

	/**
	 * Get the lifecycle engine for direct worker state inspection.
	 */
	getLifecycleEngine(): WorkerLifecycleEngine {
		return this.lifecycleEngine;
	}

	/**
	 * Get the health monitor for direct health inspection.
	 */
	getHealthMonitor(): WorkerHealthMonitor {
		return this.healthMonitor;
	}

	/**
	 * Get the contract registry for capability inspection.
	 */
	getContractRegistry(): ContractRegistry {
		return this.contractRegistry;
	}

	/**
	 * Get the job store for direct job inspection.
	 */
	getJobStore(): JobStore {
		return this.jobStore;
	}

	// -----------------------------------------------------------------------
	// Job Submission & Routing
	// -----------------------------------------------------------------------

	/**
	 * Submit a job to the supervisor.
	 *
	 * Creates a job record, applies dedup, and routes it if a capable
	 * worker is available. Returns the created job record or null if
	 * deduplication suppressed it.
	 *
	 * @param input - Job input specifying target role, type, and payload
	 * @param overrides - Optional overrides (priority, maxRetries, leaseDuration)
	 * @returns The created JobRecord, or null if deduped
	 */
	submitJob(
		input: JobInput,
		overrides?: {
			priority?: JobPriority;
			maxRetries?: number;
			leaseDurationMs?: number;
		},
	): JobRecord | null {
		if (this.state === "failed") {
			this.recordError("Cannot submit job: supervisor is in failed state");
			return null;
		}

		const job = this.jobStore.create(input, this.config.leaseConfig, overrides);
		if (!job) {
			// Deduped
			this.emitEvent("job_deduped", `Job deduped: ${input.jobType}`, {
				taskHash: input.taskHash,
				targetRole: input.targetRole,
			});
			return null;
		}

		this.totalJobsSubmitted++;

		this.emitEvent("job_submitted", `Job '${job.id}' submitted: ${job.jobType}`, {
			jobId: job.id,
			jobType: job.jobType,
			targetRole: job.targetRole,
			priority: job.priority,
			taskHash: job.taskHash,
			traceId: job.traceId,
		});

		// Try to route the job immediately
		if (this.state === "running") {
			this.routeJob(job.id);
		}

		return job;
	}

	/**
	 * Try to route a pending job to a capable and available worker.
	 *
	 * @param jobId - The job ID to route
	 * @returns The leased job record if routed, or null if no worker available
	 */
	private routeJob(jobId: string): JobRecord | null {
		const job = this.jobStore.get(jobId);
		if (!job || job.status !== "pending") return null;

		// Find an appropriate worker
		const workerId = this.findWorkerForJob(job);
		if (!workerId) return null;

		return this.leaseJob(jobId, workerId);
	}

	/**
	 * Find the best worker for a given job based on capability matching
	 * and availability.
	 *
	 * @param job - The job to find a worker for
	 * @returns The best worker ID, or null if none available
	 */
	private findWorkerForJob(job: JobRecord): string | null {
		const candidates: Array<{ workerId: string; score: number }> = [];

		for (const [workerId, jobIds] of this.workerJobs) {
			// Check worker capacity
			if (jobIds.size >= this.config.maxJobsPerWorker) continue;

			// Check worker health
			const healthRecord = this.healthMonitor.getHealthRecord(workerId);
			if (!healthRecord || healthRecord.status === "unhealthy") continue;

			// Check worker lifecycle state
			const status = this.lifecycleEngine.getStatus(workerId);
			if (!status || status.state !== "standby") continue;

			// Check capability match (if routing enabled)
			if (this.config.capabilityRouting) {
				const manifest = this.lifecycleEngine.getManifest(workerId);
				if (manifest) {
					const contract = manifest.contract;
					const match = matchCapabilities(
						contract.capabilities,
						[job.targetRole],
						true, // Allow partial match
					);
					if (!match.satisfied) continue;

					// Score: more matched capabilities = better
					candidates.push({
						workerId,
						score: match.matched.length,
					});
				} else {
					// No manifest — basic role match
					candidates.push({ workerId, score: 0 });
				}
			} else {
				candidates.push({ workerId, score: 0 });
			}
		}

		if (candidates.length === 0) return null;

		// Sort by score descending (best match first)
		candidates.sort((a, b) => b.score - a.score);
		return candidates[0].workerId;
	}

	// -----------------------------------------------------------------------
	// Job Leasing
	// -----------------------------------------------------------------------

	/**
	 * Lease a pending job to a specific worker.
	 *
	 * @param jobId - The job ID to lease
	 * @param workerId - The worker to lease to
	 * @returns The leased job record, or null if not leasable
	 */
	leaseJob(jobId: string, workerId: string): JobRecord | null {
		const job = this.jobStore.lease(jobId, workerId);
		if (!job) return null;

		// Track worker-job mapping
		let jobs = this.workerJobs.get(workerId);
		if (!jobs) {
			jobs = new Set();
			this.workerJobs.set(workerId, jobs);
		}
		jobs.add(jobId);

		// Transition worker to active
		try {
			this.lifecycleEngine.transition(workerId, "active", "Job leased to worker");
		} catch {
			// Non-critical — worker may already be active
		}

		this.emitEvent("job_leased", `Job '${jobId}' leased to worker '${workerId}'`, {
			jobId,
			workerId,
			leaseExpiresAt: job.leaseExpiresAt,
		});

		return job;
	}

	/**
	 * Complete a job successfully.
	 *
	 * @param jobId - The job ID to complete
	 * @param output - Job output data
	 * @returns The completed job record, or null if not found
	 */
	completeJob(jobId: string, output: Record<string, unknown>): JobRecord | null {
		const job = this.jobStore.complete(jobId, output);
		if (!job) return null;

		this.totalJobsCompleted++;

		// Record health success
		if (job.workerId) {
			this.healthMonitor.recordSuccess(job.workerId, 0);
			this.releaseWorkerJob(job.workerId, jobId);
		}

		this.emitEvent("job_completed", `Job '${jobId}' completed successfully`, {
			jobId,
			workerId: job.workerId,
			outputKeys: Object.keys(output),
		});

		return job;
	}

	/**
	 * Fail a job with an error and optional evidence-backed diagnostic.
	 *
	 * If retries remain, the job returns to pending for re-dispatch.
	 *
	 * @param jobId - The job ID to fail
	 * @param error - Human-readable error message
	 * @param diagnostic - Optional evidence-backed diagnostic
	 * @param runtimeMs - Optional runtime for health tracking
	 * @returns The updated job record, or null if not found
	 */
	failJob(jobId: string, error: string, diagnostic?: WorkerDiagnostic, _runtimeMs?: number): JobRecord | null {
		const job = this.jobStore.fail(jobId, error, diagnostic);
		if (!job) return null;

		// Record health failure
		if (job.workerId) {
			const diag =
				diagnostic ??
				createWorkerDiagnostic("unknown_error", error, { jobId, jobType: job.jobType }, [`job://${jobId}`]);
			this.healthMonitor.recordFailure(job.workerId, diag);
			this.releaseWorkerJob(job.workerId, jobId);
		}

		if (job.status === "failed") {
			this.totalJobsFailed++;

			// Transition worker to cooling
			if (job.workerId) {
				try {
					this.lifecycleEngine.transition(job.workerId, "cooling", "Job failed, entering cooldown");
				} catch {
					// Non-critical
				}
			}

			this.emitEvent("job_failed", `Job '${jobId}' failed: ${error}`, {
				jobId,
				workerId: job.workerId,
				error,
				retryCount: job.retryCount,
				maxRetries: job.maxRetries,
				hasDiagnostic: !!diagnostic,
			});
		} else {
			// Retrying
			this.emitEvent("job_retrying", `Job '${jobId}' retrying (${job.retryCount}/${job.maxRetries})`, {
				jobId,
				workerId: job.workerId,
				error,
				retryCount: job.retryCount,
				maxRetries: job.maxRetries,
			});

			// Try to re-route
			if (this.state === "running") {
				this.routeJob(jobId);
			}
		}

		return job;
	}

	/**
	 * Cancel a job.
	 *
	 * @param jobId - The job ID to cancel
	 * @param reason - Reason for cancellation
	 * @returns The cancelled job record, or null if not found
	 */
	cancelJob(jobId: string, reason: string): JobRecord | null {
		const job = this.jobStore.cancel(jobId, reason);
		if (!job) return null;

		this.totalJobsCancelled++;

		if (job.workerId) {
			this.releaseWorkerJob(job.workerId, jobId);
			try {
				this.lifecycleEngine.transition(job.workerId, "cooling", "Job cancelled");
			} catch {
				// Non-critical
			}
		}

		this.emitEvent("job_cancelled", `Job '${jobId}' cancelled: ${reason}`, {
			jobId,
			workerId: job.workerId,
			reason,
		});

		return job;
	}

	/**
	 * Get a job record by ID.
	 */
	getJob(jobId: string): JobRecord | undefined {
		return this.jobStore.get(jobId);
	}

	/**
	 * Query jobs with optional filters.
	 */
	queryJobs(query?: {
		status?: string;
		targetRole?: string;
		jobType?: string;
		priority?: JobPriority;
		workerId?: string;
		limit?: number;
		offset?: number;
	}): JobRecord[] {
		// Cast status to ensure type compatibility
		const typedQuery: import("./job-lease.js").JobQuery | undefined = query as any;
		return this.jobStore.query(typedQuery);
	}

	/**
	 * Release a job from a worker's active set.
	 */
	private releaseWorkerJob(workerId: string, jobId: string): void {
		const jobs = this.workerJobs.get(workerId);
		if (jobs) {
			jobs.delete(jobId);
			if (jobs.size === 0) {
				// No more active jobs — transition to standby or cooling
				try {
					const status = this.lifecycleEngine.getStatus(workerId);
					if (status && status.state === "active") {
						this.lifecycleEngine.transition(workerId, "standby", "All jobs released");
					}
				} catch {
					// Non-critical
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Lease Recovery
	// -----------------------------------------------------------------------

	/**
	 * Recover expired leases.
	 *
	 * Finds all jobs with expired leases and fails them with a timeout
	 * diagnostic. If the job has remaining retries, it will be
	 * re-dispatched.
	 *
	 * @returns Array of job IDs that were recovered
	 */
	recoverExpiredLeases(): string[] {
		const expired = this.jobStore.getExpiredLeases();
		const recovered: string[] = [];

		for (const jobId of expired) {
			const job = this.jobStore.get(jobId);
			if (!job) continue;

			const diagnostic = createWorkerDiagnostic(
				"timeout",
				`Job lease expired: worker '${job.workerId}' did not complete within lease window`,
				{
					jobId,
					jobType: job.jobType,
					workerId: job.workerId,
					leaseExpiresAt: job.leaseExpiresAt,
				},
				[`job://${jobId}`, `supervisor://lease-recovery`],
			);

			this.failJob(jobId, "Lease expired — worker did not complete in time", diagnostic);
			recovered.push(jobId);
		}

		if (recovered.length > 0) {
			this.totalLeaseRecoveries += recovered.length;
			this.emitEvent("leases_recovered", `Recovered ${recovered.length} expired lease(s)`, {
				recoveredJobIds: recovered,
			});
		}

		return recovered;
	}

	// -----------------------------------------------------------------------
	// Health Checks
	// -----------------------------------------------------------------------

	/**
	 * Run a health check on a specific worker.
	 */
	checkWorkerHealth(workerId: string): HealthCheckResult {
		return this.healthMonitor.checkHealth(workerId);
	}

	/**
	 * Run health checks on all registered workers.
	 */
	checkAllHealth(): HealthCheckResult[] {
		return this.healthMonitor.checkAllHealth();
	}

	/**
	 * Register a callback for supervisor events.
	 *
	 * @param callback - Called with each SupervisorEvent
	 */
	onEvent(callback: (event: SupervisorEvent) => void): void {
		this.eventCallbacks.push(callback);
	}

	/**
	 * Remove an event listener.
	 *
	 * @param callback - The callback to remove
	 */
	offEvent(callback: (event: SupervisorEvent) => void): void {
		const idx = this.eventCallbacks.indexOf(callback);
		if (idx >= 0) {
			this.eventCallbacks.splice(idx, 1);
		}
	}

	// -----------------------------------------------------------------------
	// Diagnostics
	// -----------------------------------------------------------------------

	/**
	 * Get a diagnostic snapshot of the supervisor's current state.
	 */
	getDiagnostics(): SupervisorDiagnostics {
		const healthStats = this.healthMonitor.getHealthStats();
		const jobStats = this.jobStore.getStats();

		return {
			state: this.state,
			startedAt: this.startedAt,
			totalJobsSubmitted: this.totalJobsSubmitted,
			totalJobsCompleted: this.totalJobsCompleted,
			totalJobsFailed: this.totalJobsFailed,
			totalJobsCancelled: this.totalJobsCancelled,
			totalLeaseRecoveries: this.totalLeaseRecoveries,
			registeredWorkerCount: healthStats.totalWorkers,
			healthStats: {
				healthy: healthStats.healthy,
				degraded: healthStats.degraded,
				unhealthy: healthStats.unhealthy,
				unknown: healthStats.unknown,
				stale: healthStats.stale,
			},
			jobStats: {
				pending: jobStats.pending,
				leased: jobStats.leased,
				completed: jobStats.completed,
				failed: jobStats.failed,
				cancelled: jobStats.cancelled,
			},
			lastError: this.lastError,
			lastErrorAt: this.lastErrorAt,
			eventsEmitted: this.eventsEmitted,
		};
	}

	// -----------------------------------------------------------------------
	// Internal Helpers
	// -----------------------------------------------------------------------

	/**
	 * Record an error state.
	 */
	private recordError(message: string): void {
		this.lastError = message;
		this.lastErrorAt = new Date().toISOString();
	}

	/**
	 * Emit a supervisor event for observability.
	 */
	private emitEvent(eventType: string, message: string, data: Record<string, unknown>): void {
		if (!this.config.observabilityEnabled) return;

		const event: SupervisorEvent = {
			id: randomUUID(),
			eventType,
			timestamp: new Date().toISOString(),
			jobId: (data.jobId as string) ?? null,
			workerId: (data.workerId as string) ?? null,
			message,
			data,
			traceId: (data.traceId as string) ?? null,
			spanId: (data.spanId as string) ?? null,
			correlationId: (data.correlationId as string) ?? null,
			projectId: (data.projectId as string) ?? null,
			planExecutionId: (data.planExecutionId as string) ?? null,
			workspaceExecutionId: (data.workspaceExecutionId as string) ?? null,
		};

		this.eventsEmitted++;

		for (const callback of this.eventCallbacks) {
			try {
				callback(event);
			} catch {
				// Swallow callback errors to prevent one bad listener from crashing the supervisor
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a BrainSupervisor with default configuration.
 *
 * @param config - Optional partial configuration overrides
 * @returns A new BrainSupervisor instance
 */
export function createBrainSupervisor(config?: Partial<BrainSupervisorConfig>): BrainSupervisor {
	return new BrainSupervisor(config);
}
