/**
 * Brain Orchestrator Supervisor — Worker Health System — 25.D
 *
 * Monitors brain worker health via heartbeats, tracks consecutive
 * failures, detects zombie/unresponsive workers, and produces
 * evidence-backed diagnostics.
 *
 * Workers emit heartbeats periodically; if no heartbeat arrives within
 * the stale threshold, the worker is flagged as "unhealthy". Additional
 * checks track runtime statistics and failure trends for proactive
 * intervention.
 *
 * @packageDocumentation
 */

import type { WorkerDiagnostic, WorkerLifecycleState } from "../types.js";
import { createWorkerDiagnostic } from "../types.js";

// ---------------------------------------------------------------------------
// Health Status
// ---------------------------------------------------------------------------

/**
 * Overall health assessment for a worker.
 */
export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

/**
 * All valid HealthStatus values for runtime validation.
 */
export const ALL_HEALTH_STATUSES: readonly HealthStatus[] = ["healthy", "degraded", "unhealthy", "unknown"] as const;

// ---------------------------------------------------------------------------
// Worker Health Record
// ---------------------------------------------------------------------------

/**
 * Health tracking record for a single worker.
 *
 * Stores heartbeat timing, failure trend analysis, runtime stats,
 * and recent diagnostics for observability and supervisor decisions.
 */
export interface WorkerHealthRecord {
	/** Worker instance ID */
	workerId: string;

	/** ISO 8601 timestamp of last heartbeat */
	lastHeartbeatAt: string | null;

	/** ISO 8601 timestamp of when health tracking started */
	trackedSince: string;

	/** Current health status */
	status: HealthStatus;

	/** Human-readable health detail */
	detail: string;

	/** Consecutive failure count (incremented on each failure, reset on success) */
	consecutiveFailures: number;

	/** Total failure count since tracking began */
	totalFailures: number;

	/** Total successful cycles since tracking began */
	totalSuccesses: number;

	/** Recent diagnostics (most recent first, max MAX_HEALTH_DIAGNOSTICS) */
	recentDiagnostics: WorkerDiagnostic[];

	/** Runtime statistics across all tracked cycles */
	runtimeStats: {
		/** Total runtime in milliseconds across all cycles */
		totalRuntimeMs: number;
		/** Number of completed cycles with tracked runtime */
		cycleCount: number;
		/** Average runtime per cycle in ms */
		averageRuntimeMs: number;
		/** Maximum runtime for a single cycle in ms */
		maxRuntimeMs: number;
	};

	/** Whether the worker is currently considered stale (no heartbeat) */
	stale: boolean;

	/** ISO 8601 timestamp when the worker was last seen healthy, null if never */
	lastHealthyAt: string | null;

	/** ISO 8601 timestamp when the worker's status last changed */
	lastStatusChangeAt: string;
}

// ---------------------------------------------------------------------------
// Health Check Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for worker health checking.
 */
export interface HealthCheckConfig {
	/**
	 * Time in milliseconds after which a worker is considered stale
	 * if no heartbeat is received. Default: 120_000 (2 minutes).
	 */
	staleThresholdMs: number;

	/**
	 * Maximum consecutive failures before status drops to "unhealthy".
	 * Default: 3.
	 */
	maxConsecutiveFailures: number;

	/**
	 * Maximum number of recent diagnostics to retain per worker.
	 * Default: 20.
	 */
	maxDiagnostics: number;

	/**
	 * Whether to automatically mark stale workers as unhealthy.
	 * Default: true.
	 */
	autoMarkStale: boolean;
}

/**
 * Default health check configuration.
 */
export const DEFAULT_HEALTH_CHECK_CONFIG: HealthCheckConfig = {
	staleThresholdMs: 120_000,
	maxConsecutiveFailures: 3,
	maxDiagnostics: 20,
	autoMarkStale: true,
};

// ---------------------------------------------------------------------------
// Health Check Result
// ---------------------------------------------------------------------------

/**
 * Result of a health check operation.
 */
export interface HealthCheckResult {
	/** Worker ID that was checked */
	workerId: string;
	/** Status determined by the check */
	status: HealthStatus;
	/** Detailed message about what was found */
	message: string;
	/** Whether a state transition is recommended */
	recommendedTransition: boolean;
	/** Suggested target lifecycle state if transition is recommended */
	suggestedState?: WorkerLifecycleState;
	/** Diagnostic produced by the check, if applicable */
	diagnostic?: WorkerDiagnostic;
}

// ---------------------------------------------------------------------------
// Worker Health Monitor
// ---------------------------------------------------------------------------

/**
 * Monitors and tracks health of brain workers.
 *
 * Provides heartbeat tracking, staleness detection, failure trend
 * analysis, and health check evaluation for supervisor decision-making.
 */
export class WorkerHealthMonitor {
	private config: HealthCheckConfig;
	private workers: Map<string, WorkerHealthRecord> = new Map();

	constructor(config?: Partial<HealthCheckConfig>) {
		this.config = {
			staleThresholdMs: config?.staleThresholdMs ?? DEFAULT_HEALTH_CHECK_CONFIG.staleThresholdMs,
			maxConsecutiveFailures: config?.maxConsecutiveFailures ?? DEFAULT_HEALTH_CHECK_CONFIG.maxConsecutiveFailures,
			maxDiagnostics: config?.maxDiagnostics ?? DEFAULT_HEALTH_CHECK_CONFIG.maxDiagnostics,
			autoMarkStale: config?.autoMarkStale ?? DEFAULT_HEALTH_CHECK_CONFIG.autoMarkStale,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the health check configuration.
	 */
	setConfig(config: Partial<HealthCheckConfig>): void {
		if (config.staleThresholdMs !== undefined) {
			this.config.staleThresholdMs = config.staleThresholdMs;
		}
		if (config.maxConsecutiveFailures !== undefined) {
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		}
		if (config.maxDiagnostics !== undefined) {
			this.config.maxDiagnostics = config.maxDiagnostics;
		}
		if (config.autoMarkStale !== undefined) {
			this.config.autoMarkStale = config.autoMarkStale;
		}
	}

	/**
	 * Get a snapshot of current configuration.
	 */
	getConfig(): HealthCheckConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Worker Registration
	// -----------------------------------------------------------------------

	/**
	 * Register a new worker for health tracking.
	 *
	 * @param workerId - Unique worker identifier
	 * @returns The newly created health record
	 */
	registerWorker(workerId: string): WorkerHealthRecord {
		if (this.workers.has(workerId)) {
			throw new Error(`Worker '${workerId}' is already registered for health tracking`);
		}

		const now = new Date().toISOString();
		const record: WorkerHealthRecord = {
			workerId,
			lastHeartbeatAt: null,
			trackedSince: now,
			status: "healthy",
			detail: "Worker registered for health tracking",
			consecutiveFailures: 0,
			totalFailures: 0,
			totalSuccesses: 0,
			recentDiagnostics: [],
			runtimeStats: {
				totalRuntimeMs: 0,
				cycleCount: 0,
				averageRuntimeMs: 0,
				maxRuntimeMs: 0,
			},
			stale: false,
			lastHealthyAt: now,
			lastStatusChangeAt: now,
		};

		this.workers.set(workerId, record);
		return record;
	}

	/**
	 * Unregister a worker from health tracking.
	 *
	 * @param workerId - Worker to unregister
	 * @returns true if the worker was found and removed
	 */
	unregisterWorker(workerId: string): boolean {
		return this.workers.delete(workerId);
	}

	// -----------------------------------------------------------------------
	// Heartbeat
	// -----------------------------------------------------------------------

	/**
	 * Record a heartbeat from a worker.
	 *
	 * Updates the last heartbeat timestamp and clears stale flag.
	 *
	 * @param workerId - The worker sending the heartbeat
	 * @returns The updated health record, or null if worker is not registered
	 */
	recordHeartbeat(workerId: string): WorkerHealthRecord | null {
		const record = this.workers.get(workerId);
		if (!record) return null;

		const now = new Date().toISOString();
		record.lastHeartbeatAt = now;
		record.stale = false;

		// If was unhealthy and now heartbeating, restore to degraded
		if (record.status === "unhealthy") {
			record.status = "degraded";
			record.detail = "Worker resumed heartbeats, marked degraded pending stability";
			record.lastStatusChangeAt = now;
		}

		return record;
	}

	// -----------------------------------------------------------------------
	// Success / Failure Recording
	// -----------------------------------------------------------------------

	/**
	 * Record a successful work cycle for a worker.
	 *
	 * Resets consecutive failures, increments success count,
	 * and updates runtime statistics.
	 *
	 * @param workerId - The worker that completed successfully
	 * @param runtimeMs - Runtime of the completed cycle in ms
	 * @returns The updated health record, or null if worker is not registered
	 */
	recordSuccess(workerId: string, runtimeMs: number): WorkerHealthRecord | null {
		const record = this.workers.get(workerId);
		if (!record) return null;

		const now = new Date().toISOString();
		record.consecutiveFailures = 0;
		record.totalSuccesses++;
		record.runtimeStats.totalRuntimeMs += runtimeMs;
		record.runtimeStats.cycleCount++;
		record.runtimeStats.averageRuntimeMs = record.runtimeStats.totalRuntimeMs / record.runtimeStats.cycleCount;
		if (runtimeMs > record.runtimeStats.maxRuntimeMs) {
			record.runtimeStats.maxRuntimeMs = runtimeMs;
		}

		// Restore health if was degraded
		if (record.status === "degraded" && record.consecutiveFailures === 0) {
			record.status = "healthy";
			record.detail = "Worker completed a successful cycle, restored to healthy";
			record.lastHealthyAt = now;
			record.lastStatusChangeAt = now;
		}

		return record;
	}

	/**
	 * Record a failure for a worker.
	 *
	 * Increments consecutive failures, total failures, adds diagnostic,
	 * and may downgrade health status based on threshold.
	 *
	 * @param workerId - The worker that failed
	 * @param diagnostic - Evidence-backed diagnostic for the failure
	 * @returns The updated health record, or null if worker is not registered
	 */
	recordFailure(workerId: string, diagnostic: WorkerDiagnostic): WorkerHealthRecord | null {
		const record = this.workers.get(workerId);
		if (!record) return null;

		const now = new Date().toISOString();
		record.consecutiveFailures++;
		record.totalFailures++;

		// Add diagnostic
		record.recentDiagnostics.unshift(diagnostic);
		if (record.recentDiagnostics.length > this.config.maxDiagnostics) {
			record.recentDiagnostics = record.recentDiagnostics.slice(0, this.config.maxDiagnostics);
		}

		// Evaluate health status based on consecutive failures
		if (record.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			record.status = "unhealthy";
			record.detail = `Worker exceeded ${this.config.maxConsecutiveFailures} consecutive failures`;
			record.lastStatusChangeAt = now;
		} else if (record.consecutiveFailures >= Math.ceil(this.config.maxConsecutiveFailures / 2)) {
			record.status = "degraded";
			record.detail = `Worker has ${record.consecutiveFailures} consecutive failure(s)`;
			record.lastStatusChangeAt = now;
		}

		return record;
	}

	// -----------------------------------------------------------------------
	// Health Checks
	// -----------------------------------------------------------------------

	/**
	 * Run a health check on a specific worker.
	 *
	 * Evaluates:
	 * 1. Staleness (no recent heartbeat)
	 * 2. Consecutive failure count vs threshold
	 * 3. Overall status degradation
	 *
	 * Returns a HealthCheckResult with recommended actions.
	 *
	 * @param workerId - The worker to check
	 * @returns HealthCheckResult with assessment and recommendations
	 */
	checkHealth(workerId: string): HealthCheckResult {
		const record = this.workers.get(workerId);

		if (!record) {
			return {
				workerId,
				status: "unknown",
				message: `Worker '${workerId}' is not registered for health tracking`,
				recommendedTransition: false,
			};
		}

		const now = Date.now();
		const issues: string[] = [];

		// 1. Check staleness
		if (record.lastHeartbeatAt) {
			const heartbeatTime = new Date(record.lastHeartbeatAt).getTime();
			const timeSinceHeartbeat = now - heartbeatTime;

			if (timeSinceHeartbeat > this.config.staleThresholdMs) {
				record.stale = true;
				issues.push(`No heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`);

				if (this.config.autoMarkStale) {
					record.status = "unhealthy";
					record.detail = `Worker is stale: no heartbeat for ${Math.round(timeSinceHeartbeat / 1000)}s`;
					record.lastStatusChangeAt = new Date().toISOString();
				}
			} else {
				record.stale = false;
			}
		} else {
			// Never heartbeated — might be newly registered
			const timeSinceRegistration = now - new Date(record.trackedSince).getTime();
			if (timeSinceRegistration > this.config.staleThresholdMs) {
				record.stale = true;
				issues.push("Registered but never sent a heartbeat");
			}
		}

		// Determine overall assessed status
		const assessedStatus = record.stale ? "unhealthy" : record.status;

		// Build diagnostic if unhealthy
		let diagnostic: WorkerDiagnostic | undefined;

		if (assessedStatus === "unhealthy") {
			diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Worker health check: ${record.detail}`,
				{
					consecutiveFailures: record.consecutiveFailures,
					totalFailures: record.totalFailures,
					stale: record.stale,
					lastHeartbeatAt: record.lastHeartbeatAt,
				},
				[`health-monitor://${workerId}`],
			);
		}

		// Determine recommended transition
		const recommendedTransition = assessedStatus === "unhealthy";
		let suggestedState: WorkerLifecycleState | undefined;
		if (assessedStatus === "unhealthy") {
			suggestedState = "failed";
		}

		const message = issues.length > 0 ? issues.join("; ") : `Worker is ${assessedStatus}`;

		return {
			workerId,
			status: assessedStatus,
			message,
			recommendedTransition,
			suggestedState,
			diagnostic,
		};
	}

	/**
	 * Run health checks on all registered workers.
	 *
	 * @returns Array of health check results for all workers
	 */
	checkAllHealth(): HealthCheckResult[] {
		const results: HealthCheckResult[] = [];
		for (const workerId of this.workers.keys()) {
			results.push(this.checkHealth(workerId));
		}
		return results;
	}

	/**
	 * Get the health record for a specific worker.
	 *
	 * @param workerId - Worker to look up
	 * @returns The health record, or undefined if not registered
	 */
	getHealthRecord(workerId: string): WorkerHealthRecord | undefined {
		return this.workers.get(workerId);
	}

	/**
	 * Get all registered health records.
	 */
	getAllHealthRecords(): WorkerHealthRecord[] {
		return Array.from(this.workers.values());
	}

	/**
	 * Get health summary statistics.
	 */
	getHealthStats(): HealthStats {
		const all = Array.from(this.workers.values());
		return {
			totalWorkers: all.length,
			healthy: all.filter((w) => w.status === "healthy").length,
			degraded: all.filter((w) => w.status === "degraded").length,
			unhealthy: all.filter((w) => w.status === "unhealthy").length,
			unknown: all.filter((w) => w.status === "unknown").length,
			stale: all.filter((w) => w.stale).length,
			totalFailures: all.reduce((s, w) => s + w.totalFailures, 0),
			totalSuccesses: all.reduce((s, w) => s + w.totalSuccesses, 0),
		};
	}

	/**
	 * Clear all health tracking data (for testing or reset).
	 */
	clear(): void {
		this.workers.clear();
	}
}

// ---------------------------------------------------------------------------
// Health Stats
// ---------------------------------------------------------------------------

/**
 * Aggregate health statistics across all tracked workers.
 */
export interface HealthStats {
	totalWorkers: number;
	healthy: number;
	degraded: number;
	unhealthy: number;
	unknown: number;
	stale: number;
	totalFailures: number;
	totalSuccesses: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a WorkerHealthMonitor with default configuration.
 *
 * @param config - Optional partial configuration overrides
 * @returns A new WorkerHealthMonitor instance
 */
export function createWorkerHealthMonitor(config?: Partial<HealthCheckConfig>): WorkerHealthMonitor {
	return new WorkerHealthMonitor(config);
}
