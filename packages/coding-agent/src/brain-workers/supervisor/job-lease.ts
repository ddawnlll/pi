/**
 * Brain Orchestrator Supervisor — Job Lease System — 25.D
 *
 * Manages job lifecycle: pending, leasing, active, completed, failed,
 * cancelled. Each job is a unit of work dispatched to a brain worker.
 * Leases ensure exclusive execution and support timeout-based recovery.
 *
 * Key design decisions:
 * - Content-based deduplication via task hash matching.
 * - Lease expiry allows zombie recovery (worker crashes mid-job).
 * - All transitions emit diagnostics for observability integration.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import type { WorkerDiagnostic } from "../types.js";

// ---------------------------------------------------------------------------
// Job Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a supervisor job.
 */
export type JobStatus =
	| "pending" // Job created, awaiting worker dispatch
	| "leased" // Job leased to a worker, execution in progress
	| "completed" // Job finished successfully
	| "failed" // Job finished with an error
	| "cancelled"; // Job was cancelled before/during execution

/**
 * All valid JobStatus values for runtime validation.
 */
export const ALL_JOB_STATUSES: readonly JobStatus[] = [
	"pending",
	"leased",
	"completed",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Job Priority
// ---------------------------------------------------------------------------

/**
 * Priority level for supervisor job scheduling.
 */
export type JobPriority = "low" | "normal" | "high" | "critical";

/**
 * All valid JobPriority values for runtime validation.
 */
export const ALL_JOB_PRIORITIES: readonly JobPriority[] = ["low", "normal", "high", "critical"] as const;

// ---------------------------------------------------------------------------
// Job Input / Output
// ---------------------------------------------------------------------------

/**
 * Input data for a supervisor job.
 *
 * Carries the payload a worker needs to execute the job,
 * plus metadata for routing, dedup, and observability.
 */
export interface JobInput {
	/** Worker role that should handle this job */
	targetRole: string;
	/** Human-readable job type (e.g., "diagnose_failure", "scan_health") */
	jobType: string;
	/** Job payload data */
	payload: Record<string, unknown>;
	/** Content hash for deduplication */
	taskHash?: string;
	/** Correlation identifiers for observability */
	traceId?: string;
	spanId?: string;
	correlationId?: string;
	/** Optional project scoping */
	projectId?: string;
	planExecutionId?: string;
	workspaceExecutionId?: string;
}

// ---------------------------------------------------------------------------
// Job Record
// ---------------------------------------------------------------------------

/**
 * A single job record tracked by the supervisor.
 *
 * Every job transitions through statuses and carries evidence-backed
 * diagnostics on failure.
 */
export interface JobRecord {
	/** Unique job identifier (UUID v4) */
	id: string;
	/** Job type (e.g., "diagnose_failure", "scan_health") */
	jobType: string;
	/** Target worker role */
	targetRole: string;
	/** Current status */
	status: JobStatus;
	/** Priority level */
	priority: JobPriority;
	/** ISO 8601 timestamp of creation */
	createdAt: string;
	/** ISO 8601 timestamp of last status change */
	updatedAt: string;
	/** ISO 8601 timestamp of lease start, null if not yet leased */
	leasedAt: string | null;
	/** ISO 8601 timestamp of lease expiry, null if not leased */
	leaseExpiresAt: string | null;
	/** Worker ID that holds/held the lease */
	workerId: string | null;
	/** Job input payload */
	input: JobInput;
	/** Job output data (set on completion) */
	output: Record<string, unknown> | null;
	/** Error message if failed */
	error: string | null;
	/** Diagnostic attached on failure, if available */
	diagnostic: WorkerDiagnostic | null;
	/** Content hash for deduplication */
	taskHash: string;
	/** Number of times this job has been retried */
	retryCount: number;
	/** Maximum retries allowed */
	maxRetries: number;
	/** Correlation / observability trace identifiers */
	traceId: string | null;
	spanId: string | null;
	correlationId: string | null;
	projectId: string | null;
	planExecutionId: string | null;
	workspaceExecutionId: string | null;
}

// ---------------------------------------------------------------------------
// Job Query
// ---------------------------------------------------------------------------

/**
 * Filter/query options for listing jobs from the store.
 */
export interface JobQuery {
	status?: JobStatus;
	targetRole?: string;
	jobType?: string;
	priority?: JobPriority;
	workerId?: string;
	limit?: number;
	offset?: number;
	includeExpired?: boolean;
}

// ---------------------------------------------------------------------------
// Lease Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for job leasing behaviour.
 */
export interface LeaseConfig {
	/**
	 * Default lease duration in milliseconds.
	 * A worker must complete the job within this window or the lease
	 * expires and the job becomes available for re-dispatch.
	 * Default: 300_000 (5 minutes).
	 */
	defaultLeaseDurationMs: number;

	/**
	 * Maximum lease duration in milliseconds.
	 * No single job can hold a lease longer than this.
	 * Default: 3_600_000 (1 hour).
	 */
	maxLeaseDurationMs: number;

	/**
	 * Default maximum retries for jobs that fail.
	 * Default: 3.
	 */
	defaultMaxRetries: number;

	/**
	 * Whether to enable content-hash based deduplication.
	 * Default: true.
	 */
	dedupEnabled: boolean;

	/**
	 * Time window in milliseconds for dedup window.
	 * If the same task hash appears within this window, it is deduped.
	 * Default: 300_000 (5 minutes).
	 */
	dedupWindowMs: number;
}

/**
 * Default lease configuration.
 */
export const DEFAULT_LEASE_CONFIG: LeaseConfig = {
	defaultLeaseDurationMs: 300_000,
	maxLeaseDurationMs: 3_600_000,
	defaultMaxRetries: 3,
	dedupEnabled: true,
	dedupWindowMs: 300_000,
};

// ---------------------------------------------------------------------------
// Job Store
// ---------------------------------------------------------------------------

/**
 * In-memory job store for the supervisor.
 *
 * Thread-safe for single-process use. Provides create, update, query,
 * and dedup-check operations.
 */
export class JobStore {
	private jobs: Map<string, JobRecord> = new Map();
	private dedupMap: Map<string, number> = new Map(); // taskHash -> timestamp

	/**
	 * Create a new job in pending status.
	 *
	 * Returns the created job, or null if dedup matched an existing job
	 * within the dedup window.
	 *
	 * @param input - Job input data
	 * @param config - Lease configuration (for dedup window)
	 * @param overrides - Optional field overrides (priority, maxRetries, etc.)
	 * @returns The created job record, or null if deduped
	 */
	create(
		input: JobInput,
		config: LeaseConfig,
		overrides?: {
			priority?: JobPriority;
			maxRetries?: number;
			leaseDurationMs?: number;
		},
	): JobRecord | null {
		const taskHash = input.taskHash ?? this.computeTaskHash(input);

		// Dedup check: if same task hash exists within dedup window, skip
		if (config.dedupEnabled) {
			const existingTimestamp = this.dedupMap.get(taskHash);
			if (existingTimestamp !== undefined) {
				const age = Date.now() - existingTimestamp;
				if (age < config.dedupWindowMs) {
					return null; // Deduped
				}
			}
		}

		const now = new Date().toISOString();
		const nowMs = Date.now();

		const job: JobRecord = {
			id: randomUUID(),
			jobType: input.jobType,
			targetRole: input.targetRole,
			status: "pending",
			priority: overrides?.priority ?? "normal",
			createdAt: now,
			updatedAt: now,
			leasedAt: null,
			leaseExpiresAt: null,
			workerId: null,
			input,
			output: null,
			error: null,
			diagnostic: null,
			taskHash,
			retryCount: 0,
			maxRetries: overrides?.maxRetries ?? config.defaultMaxRetries,
			traceId: input.traceId ?? null,
			spanId: input.spanId ?? null,
			correlationId: input.correlationId ?? null,
			projectId: input.projectId ?? null,
			planExecutionId: input.planExecutionId ?? null,
			workspaceExecutionId: input.workspaceExecutionId ?? null,
		};

		this.jobs.set(job.id, job);
		this.dedupMap.set(taskHash, nowMs);

		return job;
	}

	/**
	 * Lease a pending job to a worker.
	 *
	 * Sets status to "leased", records the worker and lease expiry.
	 * Returns null if the job is not in pending status.
	 *
	 * @param jobId - The job ID to lease
	 * @param workerId - The worker taking the lease
	 * @param leaseDurationMs - Custom lease duration, or default
	 * @returns The updated job record, or null if not leasable
	 */
	lease(jobId: string, workerId: string, leaseDurationMs?: number): JobRecord | null {
		const job = this.jobs.get(jobId);
		if (!job) return null;
		if (job.status !== "pending") return null;

		const now = new Date().toISOString();
		job.status = "leased";
		job.workerId = workerId;
		job.leasedAt = now;
		job.updatedAt = now;
		job.leaseExpiresAt = new Date(
			Date.now() + (leaseDurationMs ?? DEFAULT_LEASE_CONFIG.defaultLeaseDurationMs),
		).toISOString();

		return job;
	}

	/**
	 * Complete a leased job successfully.
	 *
	 * @param jobId - The job ID to complete
	 * @param output - Job output data
	 * @returns The updated job record, or null if not found
	 */
	complete(jobId: string, output: Record<string, unknown>): JobRecord | null {
		const job = this.jobs.get(jobId);
		if (!job) return null;

		job.status = "completed";
		job.output = output;
		job.updatedAt = new Date().toISOString();
		job.leaseExpiresAt = null;

		return job;
	}

	/**
	 * Mark a leased job as failed.
	 *
	 * If retryCount < maxRetries, resets status to "pending" for retry.
	 * Otherwise, marks as "failed" with the provided diagnostic.
	 *
	 * @param jobId - The job ID to fail
	 * @param error - Error message
	 * @param diagnostic - Optional evidence-backed diagnostic
	 * @returns The updated job record, or null if not found
	 */
	fail(jobId: string, error: string, diagnostic?: WorkerDiagnostic): JobRecord | null {
		const job = this.jobs.get(jobId);
		if (!job) return null;

		job.retryCount++;
		job.updatedAt = new Date().toISOString();
		job.error = error;
		job.leaseExpiresAt = null;

		if (diagnostic) {
			job.diagnostic = diagnostic;
		}

		if (job.retryCount < job.maxRetries) {
			// Reset for retry
			job.status = "pending";
			job.workerId = null;
			job.leasedAt = null;
		} else {
			job.status = "failed";
		}

		return job;
	}

	/**
	 * Cancel a job (from any non-terminal status).
	 *
	 * @param jobId - The job ID to cancel
	 * @param reason - Reason for cancellation
	 * @returns The updated job record, or null if not found
	 */
	cancel(jobId: string, reason: string): JobRecord | null {
		const job = this.jobs.get(jobId);
		if (!job) return null;
		if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
			return null; // Already terminal
		}

		job.status = "cancelled";
		job.error = reason;
		job.updatedAt = new Date().toISOString();
		job.leaseExpiresAt = null;

		return job;
	}

	/**
	 * Get a job record by ID.
	 */
	get(jobId: string): JobRecord | undefined {
		return this.jobs.get(jobId);
	}

	/**
	 * Find expired leases and return their job IDs.
	 *
	 * These jobs can be reclaimed for re-dispatch.
	 *
	 * @returns Array of job IDs with expired leases
	 */
	getExpiredLeases(): string[] {
		const now = Date.now();
		const expired: string[] = [];

		for (const [id, job] of this.jobs) {
			if (job.status === "leased" && job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() <= now) {
				expired.push(id);
			}
		}

		return expired;
	}

	/**
	 * Query jobs with optional filters.
	 */
	query(query?: JobQuery): JobRecord[] {
		let results = Array.from(this.jobs.values());

		if (query) {
			if (query.status) {
				results = results.filter((j) => j.status === query.status);
			}
			if (query.targetRole) {
				results = results.filter((j) => j.targetRole === query.targetRole);
			}
			if (query.jobType) {
				results = results.filter((j) => j.jobType === query.jobType);
			}
			if (query.priority) {
				results = results.filter((j) => j.priority === query.priority);
			}
			if (query.workerId) {
				results = results.filter((j) => j.workerId === query.workerId);
			}
			// Sort by created date descending
			results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
			if (query.limit !== undefined) {
				const offset = query.offset ?? 0;
				results = results.slice(offset, offset + query.limit);
			}
		}

		return results;
	}

	/**
	 * Get summary statistics about the job store.
	 */
	getStats(): JobStoreStats {
		const all = Array.from(this.jobs.values());
		return {
			total: all.length,
			pending: all.filter((j) => j.status === "pending").length,
			leased: all.filter((j) => j.status === "leased").length,
			completed: all.filter((j) => j.status === "completed").length,
			failed: all.filter((j) => j.status === "failed").length,
			cancelled: all.filter((j) => j.status === "cancelled").length,
			expiredLeases: this.getExpiredLeases().length,
			totalRetries: all.reduce((sum, j) => sum + j.retryCount, 0),
		};
	}

	/**
	 * Clear all jobs (for testing or reset).
	 */
	clear(): void {
		this.jobs.clear();
		this.dedupMap.clear();
	}

	/**
	 * Compute a deterministic content hash from job input.
	 */
	private computeTaskHash(input: JobInput): string {
		const hash = createHash("sha256");
		hash.update(input.targetRole);
		hash.update(":");
		hash.update(input.jobType);
		hash.update(":");
		hash.update(JSON.stringify(input.payload));
		return hash.digest("hex");
	}
}

// ---------------------------------------------------------------------------
// Job Store Stats
// ---------------------------------------------------------------------------

/**
 * Summary statistics from the job store.
 */
export interface JobStoreStats {
	total: number;
	pending: number;
	leased: number;
	completed: number;
	failed: number;
	cancelled: number;
	expiredLeases: number;
	totalRetries: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a JobStore with default configuration.
 */
export function createJobStore(): JobStore {
	return new JobStore();
}
