/**
 * Persistent Job State Store — 25.S
 *
 * JSON-backed persistent store for brain worker job state across
 * process crashes and restarts.
 *
 * The store maintains a JSON file on disk containing:
 * - All job records with their current status
 * - A session marker for crash detection
 * - A manifest of active workers at time of snapshot
 *
 * All writes are serialised through a write queue to prevent
 * concurrent write races. The store is designed for single-process
 * use with infrequent writes (on job state transitions).
 *
 * Dependencies: supervisor/job-lease.ts (JobRecord, JobStatus, JobInput, etc.)
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Job Status (mirrors supervisor/job-lease.ts for independent use)
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a persisted job.
 */
export type PersistedJobStatus = "pending" | "leased" | "completed" | "failed" | "cancelled";

/**
 * All valid PersistedJobStatus values.
 */
export const ALL_PERSISTED_JOB_STATUSES: readonly PersistedJobStatus[] = [
	"pending",
	"leased",
	"completed",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Persisted Job Priority
// ---------------------------------------------------------------------------

export type PersistedJobPriority = "low" | "normal" | "high" | "critical";

export const ALL_PERSISTED_JOB_PRIORITIES: readonly PersistedJobPriority[] = [
	"low",
	"normal",
	"high",
	"critical",
] as const;

// ---------------------------------------------------------------------------
// Persisted Job Record
// ---------------------------------------------------------------------------

/**
 * A persisted job record.
 *
 * Mirrors the structure of supervisor/job-lease.ts JobRecord but is
 * serializable to JSON without circular references. Designed to be
 * compatible with JobRecord for round-trip conversion.
 */
export interface PersistedJobRecord {
	/** Unique job identifier (UUID v4) */
	id: string;
	/** Job type (e.g., "diagnose_failure", "scan_health") */
	jobType: string;
	/** Target worker role */
	targetRole: string;
	/** Current status */
	status: PersistedJobStatus;
	/** Priority level */
	priority: PersistedJobPriority;
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
	/** Job payload (from input) */
	payload: Record<string, unknown>;
	/** Job output data (set on completion) */
	output: Record<string, unknown> | null;
	/** Error message if failed */
	error: string | null;
	/** Diagnostic serialised as a plain object, attached on failure */
	diagnostic: {
		timestamp: string;
		stopCondition: string;
		message: string;
		errorDetail?: string;
		context: Record<string, unknown>;
		evidenceRefs: string[];
	} | null;
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
// Session Marker
// ---------------------------------------------------------------------------

/**
 * A session marker written at startup and cleared on clean shutdown.
 *
 * If the marker exists on next startup, the previous session crashed.
 */
export interface SessionMarker {
	/** Unique session ID (UUID v4) */
	sessionId: string;
	/** ISO 8601 timestamp when the session started */
	startedAt: string;
	/** Whether the session has been cleanly shut down */
	cleanShutdown: boolean;
	/** Number of jobs persisted during this session */
	jobCount: number;
}

// ---------------------------------------------------------------------------
// Store Snapshot (complete on-disk state)
// ---------------------------------------------------------------------------

/**
 * The complete on-disk state structure.
 */
export interface JobStateSnapshot {
	/** Schema version for forward/backward compatibility */
	version: number;
	/** ISO 8601 timestamp of last snapshot write */
	lastUpdated: string;
	/** Current session marker, null if no active session */
	session: SessionMarker | null;
	/** Previous session marker preserved from before the current init.
	 * Used to detect whether the previous session crashed (cleanShutdown=false). */
	previousSession: SessionMarker | null;
	/** All persisted job records, keyed by job ID */
	jobs: Record<string, PersistedJobRecord>;
}

// ---------------------------------------------------------------------------
// Job State Store Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Job State Store.
 */
export interface JobStateStoreConfig {
	/**
	 * Directory path for the store file.
	 * Default: .pi/
	 */
	storeDir: string;

	/**
	 * Filename for the job state snapshot.
	 * Default: "brain-worker-jobs.json"
	 */
	storeFilename: string;

	/**
	 * Schema version for forward compatibility.
	 * Default: 1.
	 */
	schemaVersion: number;
}

/**
 * Default job state store configuration.
 */
export const DEFAULT_JOB_STATE_STORE_CONFIG: JobStateStoreConfig = {
	storeDir: ".pi",
	storeFilename: "brain-worker-jobs.json",
	schemaVersion: 1,
};

// ---------------------------------------------------------------------------
// Job State Store
// ---------------------------------------------------------------------------

/**
 * Persistent job state store with JSON backing.
 *
 * Provides crash-safe persistence for brain worker job state. Uses a
 * serialised write queue for all mutations to prevent concurrent write
 * races. Reads are always served from an in-memory cache; only writes
 * hit the filesystem.
 *
 * Usage:
 * ```typescript
 * const store = new JobStateStore("/path/to/workspace");
 * await store.init();
 *
 * // Create a job
 * const job = store.createJob(input);
 *
 * // Update job status
 * store.updateJobStatus(job.id, "completed", { output: { ... } });
 *
 * // Check if previous session crashed
 * const marker = store.getSessionMarker();
 * if (marker && !marker.cleanShutdown) {
 *   // Previous session crashed — perform recovery
 * }
 *
 * // Mark clean shutdown
 * await store.markCleanShutdown();
 * ```
 */
export class JobStateStore {
	private config: JobStateStoreConfig;
	private filePath: string;

	/** In-memory cache of the current snapshot */
	private snapshot: JobStateSnapshot;

	/** Serialised write queue for atomic file writes */
	private writeQueue: Promise<void> = Promise.resolve();

	/** Whether the store has been initialised */
	private initialised = false;

	/** Session ID for the current runtime session */
	private sessionId: string;

	constructor(workspaceRoot: string, config?: Partial<JobStateStoreConfig>) {
		this.config = {
			storeDir: config?.storeDir ?? DEFAULT_JOB_STATE_STORE_CONFIG.storeDir,
			storeFilename: config?.storeFilename ?? DEFAULT_JOB_STATE_STORE_CONFIG.storeFilename,
			schemaVersion: config?.schemaVersion ?? DEFAULT_JOB_STATE_STORE_CONFIG.schemaVersion,
		};
		this.filePath = path.join(workspaceRoot, this.config.storeDir, this.config.storeFilename);
		this.sessionId = randomUUID();

		// Start with an empty snapshot
		this.snapshot = this.createEmptySnapshot();
	}

	// -----------------------------------------------------------------------
	// Initialisation
	// -----------------------------------------------------------------------

	/**
	 * Initialise the store.
	 *
	 * Creates the store directory if it doesn't exist, reads any existing
	 * snapshot from disk, and writes a new session marker.
	 */
	async init(): Promise<void> {
		if (this.initialised) return;

		await fs.mkdir(path.dirname(this.filePath), { recursive: true });

		// Try to read existing snapshot — capture previous session before overwriting
		let previousSession: SessionMarker | null = null;
		try {
			const data = await fs.readFile(this.filePath, "utf-8");
			const parsed = JSON.parse(data) as JobStateSnapshot;

			// Validate basic structure
			if (parsed && typeof parsed === "object" && parsed.version !== undefined) {
				// Save the existing session as the previous session
				previousSession = parsed.session ?? null;
				this.snapshot = parsed;
			}
		} catch {
			// File doesn't exist or is unreadable — start fresh
			this.snapshot = this.createEmptySnapshot();
		}

		// Capture previous session from the old marker (before we overwrite it)
		this.snapshot.previousSession = previousSession;

		// Write current session marker
		this.snapshot.session = {
			sessionId: this.sessionId,
			startedAt: new Date().toISOString(),
			cleanShutdown: false,
			jobCount: Object.keys(this.snapshot.jobs).length,
		};

		await this.flush();

		this.initialised = true;
	}

	/**
	 * Create an empty snapshot.
	 */
	private createEmptySnapshot(): JobStateSnapshot {
		return {
			version: this.config.schemaVersion,
			lastUpdated: new Date().toISOString(),
			session: null,
			previousSession: null,
			jobs: {},
		};
	}

	// -----------------------------------------------------------------------
	// Write Queue (Serialised Mutations)
	// -----------------------------------------------------------------------

	/**
	 * Enqueue a mutation through the serialised write queue.
	 * All mutating file writes must go through this to guarantee ordering.
	 */
	private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.writeQueue = this.writeQueue.then(async () => {
				try {
					resolve(await fn());
				} catch (err) {
					reject(err);
				}
			});
		});
	}

	/**
	 * Flush the current in-memory snapshot to disk.
	 */
	private async flush(): Promise<void> {
		this.snapshot.lastUpdated = new Date().toISOString();
		this.snapshot.session = this.snapshot.session
			? {
					...this.snapshot.session,
					jobCount: Object.keys(this.snapshot.jobs).length,
				}
			: null;

		const data = JSON.stringify(this.snapshot, null, 2);

		// Write to a temp file first for atomicity, then rename
		const tmpPath = `${this.filePath}.tmp`;
		await fs.writeFile(tmpPath, data, "utf-8");
		await fs.rename(tmpPath, this.filePath);
	}

	// -----------------------------------------------------------------------
	// Session Management
	// -----------------------------------------------------------------------

	/**
	 * Get the current session marker.
	 *
	 * Returns the marker for the current runtime session.
	 */
	getSessionMarker(): SessionMarker | null {
		return this.snapshot.session;
	}

	/**
	 * Get the previous session marker.
	 *
	 * Returns the marker from the session that was active before the
	 * current init(). This is used to detect whether the previous
	 * session crashed (cleanShutdown=false).
	 */
	getPreviousSessionMarker(): SessionMarker | null {
		return this.snapshot.previousSession;
	}

	/**
	 * Check if the previous session crashed.
	 *
	 * Returns true if there was a previous session that did not
	 * complete a clean shutdown. The previous session marker is
	 * captured on init() before the new session marker is written.
	 */
	wasPreviousSessionCrashed(): boolean {
		const marker = this.snapshot.previousSession;
		if (!marker) return false;
		return !marker.cleanShutdown;
	}

	/**
	 * Mark the current session as having a clean shutdown.
	 *
	 * Call this during graceful process shutdown.
	 */
	async markCleanShutdown(): Promise<void> {
		await this.enqueueWrite(async () => {
			if (this.snapshot.session) {
				this.snapshot.session.cleanShutdown = true;
			}
			await this.flush();
		});
	}

	// -----------------------------------------------------------------------
	// Job CRUD
	// -----------------------------------------------------------------------

	/**
	 * Create a new persisted job record.
	 *
	 * @param input - Job input data
	 * @param overrides - Optional field overrides
	 * @returns The created PersistedJobRecord
	 */
	createJob(
		input: {
			targetRole: string;
			jobType: string;
			payload: Record<string, unknown>;
			taskHash?: string;
			traceId?: string;
			spanId?: string;
			correlationId?: string;
			projectId?: string;
			planExecutionId?: string;
			workspaceExecutionId?: string;
		},
		overrides?: {
			priority?: PersistedJobPriority;
			maxRetries?: number;
		},
	): PersistedJobRecord {
		const taskHash = input.taskHash ?? this.computeTaskHash(input.targetRole, input.jobType, input.payload);
		const now = new Date().toISOString();

		const job: PersistedJobRecord = {
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
			payload: input.payload,
			output: null,
			error: null,
			diagnostic: null,
			taskHash,
			retryCount: 0,
			maxRetries: overrides?.maxRetries ?? 3,
			traceId: input.traceId ?? null,
			spanId: input.spanId ?? null,
			correlationId: input.correlationId ?? null,
			projectId: input.projectId ?? null,
			planExecutionId: input.planExecutionId ?? null,
			workspaceExecutionId: input.workspaceExecutionId ?? null,
		};

		this.snapshot.jobs[job.id] = job;
		return job;
	}

	/**
	 * Update the status of an existing job.
	 *
	 * @param jobId - The job ID to update
	 * @param status - New status
	 * @param updates - Optional field updates
	 * @returns The updated job record, or null if not found
	 */
	updateJobStatus(
		jobId: string,
		status: PersistedJobStatus,
		updates?: {
			workerId?: string | null;
			leasedAt?: string | null;
			leaseExpiresAt?: string | null;
			output?: Record<string, unknown> | null;
			error?: string | null;
			diagnostic?: {
				timestamp: string;
				stopCondition: string;
				message: string;
				errorDetail?: string;
				context: Record<string, unknown>;
				evidenceRefs: string[];
			} | null;
			retryCount?: number;
			priority?: PersistedJobPriority;
		},
	): PersistedJobRecord | null {
		const job = this.snapshot.jobs[jobId];
		if (!job) return null;

		job.status = status;
		job.updatedAt = new Date().toISOString();

		if (updates) {
			if (updates.workerId !== undefined) job.workerId = updates.workerId;
			if (updates.leasedAt !== undefined) job.leasedAt = updates.leasedAt;
			if (updates.leaseExpiresAt !== undefined) job.leaseExpiresAt = updates.leaseExpiresAt;
			if (updates.output !== undefined) job.output = updates.output;
			if (updates.error !== undefined) job.error = updates.error;
			if (updates.diagnostic !== undefined) job.diagnostic = updates.diagnostic;
			if (updates.retryCount !== undefined) job.retryCount = updates.retryCount;
			if (updates.priority !== undefined) job.priority = updates.priority;
		}

		return job;
	}

	/**
	 * Get a job record by ID.
	 */
	getJob(jobId: string): PersistedJobRecord | undefined {
		return this.snapshot.jobs[jobId];
	}

	/**
	 * Get all job records, optionally filtered by status.
	 */
	getJobs(status?: PersistedJobStatus): PersistedJobRecord[] {
		const all = Object.values(this.snapshot.jobs);
		if (status) {
			return all.filter((j) => j.status === status);
		}
		return all;
	}

	/**
	 * Get count of jobs by status.
	 */
	getJobCount(status?: PersistedJobStatus): number {
		if (status) {
			return Object.values(this.snapshot.jobs).filter((j) => j.status === status).length;
		}
		return Object.keys(this.snapshot.jobs).length;
	}

	/**
	 * Remove a job record.
	 *
	 * @param jobId - The job ID to remove
	 * @returns true if the job was found and removed
	 */
	removeJob(jobId: string): boolean {
		if (!this.snapshot.jobs[jobId]) return false;
		delete this.snapshot.jobs[jobId];
		return true;
	}

	/**
	 * Remove all job records.
	 */
	clearJobs(): void {
		this.snapshot.jobs = {};
	}

	/**
	 * Persist pending changes to disk.
	 */
	async save(): Promise<void> {
		await this.enqueueWrite(async () => {
			await this.flush();
		});
	}

	// -----------------------------------------------------------------------
	// Query & Statistics
	// -----------------------------------------------------------------------

	/**
	 * Get jobs with expired leases (leased but past leaseExpiresAt).
	 *
	 * @returns Array of PersistedJobRecord with expired leases
	 */
	getExpiredLeasedJobs(): PersistedJobRecord[] {
		const now = Date.now();
		return Object.values(this.snapshot.jobs).filter((job) => {
			if (job.status !== "leased") return false;
			if (!job.leaseExpiresAt) return false;
			return new Date(job.leaseExpiresAt).getTime() <= now;
		});
	}

	/**
	 * Get jobs that were in-progress at time of crash.
	 *
	 * These are jobs with status "leased" (worker was actively working)
	 * or "pending" (awaiting dispatch) when the crash occurred.
	 *
	 * @returns Array of PersistedJobRecord that need recovery
	 */
	getRecoverableJobs(): PersistedJobRecord[] {
		return Object.values(this.snapshot.jobs).filter((job) => {
			return job.status === "pending" || job.status === "leased";
		});
	}

	/**
	 * Get statistics about the stored jobs.
	 */
	getStats(): JobStateStoreStats {
		const all = Object.values(this.snapshot.jobs);
		return {
			total: all.length,
			pending: all.filter((j) => j.status === "pending").length,
			leased: all.filter((j) => j.status === "leased").length,
			completed: all.filter((j) => j.status === "completed").length,
			failed: all.filter((j) => j.status === "failed").length,
			cancelled: all.filter((j) => j.status === "cancelled").length,
			totalRetries: all.reduce((sum, j) => sum + j.retryCount, 0),
		};
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Compute a deterministic content hash from job fields.
	 */
	private computeTaskHash(targetRole: string, jobType: string, payload: Record<string, unknown>): string {
		const hash = createHash("sha256");
		hash.update(targetRole);
		hash.update(":");
		hash.update(jobType);
		hash.update(":");
		hash.update(JSON.stringify(payload));
		return hash.digest("hex");
	}

	/**
	 * Check if the store has been initialised.
	 */
	isInitialised(): boolean {
		return this.initialised;
	}

	/**
	 * Get the current session ID.
	 */
	getSessionId(): string {
		return this.sessionId;
	}

	/**
	 * Get the store file path.
	 */
	getFilePath(): string {
		return this.filePath;
	}
}

// ---------------------------------------------------------------------------
// Store Statistics
// ---------------------------------------------------------------------------

/**
 * Summary statistics from the job state store.
 */
export interface JobStateStoreStats {
	total: number;
	pending: number;
	leased: number;
	completed: number;
	failed: number;
	cancelled: number;
	totalRetries: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a JobStateStore with default configuration.
 *
 * @param workspaceRoot - Root directory for the store file
 * @param config - Optional partial configuration overrides
 * @returns A new JobStateStore instance
 */
export function createJobStateStore(workspaceRoot: string, config?: Partial<JobStateStoreConfig>): JobStateStore {
	return new JobStateStore(workspaceRoot, config);
}
