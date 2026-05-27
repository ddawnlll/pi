/**
 * Telemetry Store — local in-memory store for telemetry events (25.B).
 *
 * Provides a local buffering layer that stores telemetry events in memory
 * before optionally flushing them to the database. This enables telemetry
 * collection even when the database is temporarily unavailable.
 *
 * Key features:
 * - In-memory event buffer with configurable capacity
 * - Automatic batching and background flush
 * - FIFO eviction when buffer exceeds capacity
 * - Queryable while buffered
 * - Failover: when DB flush fails, events remain in buffer
 *
 * @module observability/store/telemetry-store
 */

import type { ObservabilityEvent } from "../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Configuration for the telemetry store.
 */
export interface TelemetryStoreConfig {
	/** Maximum number of events to buffer in memory (default: 1000) */
	maxBufferSize: number;
	/** Maximum batch size for flush operations (default: 100) */
	batchSize: number;
	/** Flush interval in milliseconds (default: 10000, 0 = no auto-flush) */
	flushIntervalMs: number;
	/** Whether to automatically flush to the database */
	autoFlush: boolean;
}

/**
 * Default telemetry store configuration.
 */
export const DEFAULT_TELEMETRY_STORE_CONFIG: TelemetryStoreConfig = {
	maxBufferSize: 1000,
	batchSize: 100,
	flushIntervalMs: 10_000,
	autoFlush: true,
};

/**
 * Flush target interface for persisting buffered events.
 * Implementations can write to database, file, or network.
 */
export interface TelemetryFlushTarget {
	/**
	 * Persist a batch of events.
	 * @param events - Events to persist
	 * @returns Number of successfully persisted events
	 */
	flush(events: ObservabilityEvent[]): Promise<number>;
}

/**
 * Telemetry storage query filter.
 */
export interface TelemetryQueryFilter {
	/** Filter by event type */
	eventType?: string | string[];
	/** Filter by source component */
	source?: string | string[];
	/** Filter by severity */
	severity?: string | string[];
	/** Filter by status */
	status?: string | string[];
	/** Filter by trace ID */
	traceId?: string;
	/** Filter by correlation ID */
	correlationId?: string;
	/** Filter by project */
	projectId?: string;
	/** Filter by plan execution */
	planExecutionId?: string;
	/** Filter by workspace execution */
	workspaceExecutionId?: string;
	/** Return events on or after this ISO timestamp */
	since?: string;
	/** Return events on or before this ISO timestamp */
	until?: string;
	/** Maximum events to return (default: 100) */
	limit?: number;
	/** Number of events to skip (default: 0) */
	offset?: number;
	/** Sort order (default: "desc") */
	order?: "asc" | "desc";
}

/**
 * Result of a flush operation.
 */
export interface FlushResult {
	/** Number of events successfully flushed */
	flushed: number;
	/** Number of events that failed to flush (remain in buffer) */
	failed: number;
	/** Error messages for failed events, if any */
	errors: string[];
}

/**
 * Storage diagnostics for monitoring.
 */
export interface TelemetryStoreDiagnostics {
	/** Current buffer size */
	bufferSize: number;
	/** Total events recorded since creation */
	totalRecorded: number;
	/** Total events flushed */
	totalFlushed: number;
	/** Total flush failures */
	totalFlushFailures: number;
	/** Number of times buffer was full and events were evicted */
	evictionCount: number;
	/** Is auto-flush active */
	autoFlushActive: boolean;
	/** Time since last successful flush in ms (null if never flushed) */
	timeSinceLastFlushMs: number | null;
}

// ─────────────────────────────────────────────────────────────────────
// InMemoryTelemetryStore
// ─────────────────────────────────────────────────────────────────────

/**
 * In-memory telemetry store with optional background flushing.
 *
 * Events are stored in a FIFO queue. When the buffer exceeds maxBufferSize,
 * the oldest events are evicted. A background interval flushes events
 * to the configured flush target.
 *
 * The store is fully queryable while events are buffered, combining
 * in-memory results with any additional results from the flush target.
 */
export class InMemoryTelemetryStore {
	private buffer: ObservabilityEvent[] = [];
	private config: TelemetryStoreConfig;
	private flushTarget: TelemetryFlushTarget | null = null;
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private totalRecorded = 0;
	private totalFlushed = 0;
	private totalFlushFailures = 0;
	private evictionCount = 0;
	private lastFlushTimestamp: number | null = null;

	constructor(config?: Partial<TelemetryStoreConfig>) {
		this.config = { ...DEFAULT_TELEMETRY_STORE_CONFIG, ...config };
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Set or change the flush target for persisting events.
	 */
	setFlushTarget(target: TelemetryFlushTarget | null): void {
		this.flushTarget = target;
	}

	/**
	 * Update store configuration at runtime.
	 */
	updateConfig(config: Partial<TelemetryStoreConfig>): void {
		this.config = { ...this.config, ...config };
		this.restartFlushTimer();
	}

	/**
	 * Get current configuration.
	 */
	getConfig(): TelemetryStoreConfig {
		return { ...this.config };
	}

	// ── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Start the auto-flush timer if configured and not already running.
	 */
	start(): void {
		if (this.flushTimer) return;
		if (this.config.autoFlush && this.config.flushIntervalMs > 0) {
			this.flushTimer = setInterval(() => {
				this.flush().catch(() => {
					// Silently handle flush errors in background
				});
			}, this.config.flushIntervalMs);
			// Allow the process to exit even if timer is active
			if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
				this.flushTimer.unref();
			}
		}
	}

	/**
	 * Stop the auto-flush timer and optionally flush remaining events.
	 */
	async stop(flushRemaining = true): Promise<void> {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		if (flushRemaining && this.buffer.length > 0) {
			await this.flush();
		}
	}

	// ── Recording ────────────────────────────────────────────────────

	/**
	 * Record a telemetry event.
	 *
	 * If the buffer is full, the oldest event is evicted (FIFO).
	 *
	 * @param event - Observability event to record
	 */
	record(event: ObservabilityEvent): void {
		this.buffer.push(event);
		this.totalRecorded++;

		// Evict oldest if buffer exceeds capacity
		if (this.buffer.length > this.config.maxBufferSize) {
			const toEvict = this.buffer.length - this.config.maxBufferSize;
			this.buffer.splice(0, toEvict);
			this.evictionCount += toEvict;
		}
	}

	/**
	 * Record multiple events at once.
	 *
	 * @param events - Array of events to record
	 */
	recordBatch(events: ObservabilityEvent[]): void {
		for (const event of events) {
			this.record(event);
		}
	}

	// ── Querying ─────────────────────────────────────────────────────

	/**
	 * Query events currently in the buffer.
	 *
	 * @param filter - Query filter
	 * @returns Matching events
	 */
	query(filter: TelemetryQueryFilter = {}): ObservabilityEvent[] {
		let results = [...this.buffer];

		// Apply filters
		if (filter.eventType) {
			const types = Array.isArray(filter.eventType) ? filter.eventType : [filter.eventType];
			results = results.filter((e) => types.includes(e.eventType));
		}
		if (filter.source) {
			const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
			results = results.filter((e) => sources.includes(e.source));
		}
		if (filter.severity) {
			const severities = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
			results = results.filter((e) => severities.includes(e.severity));
		}
		if (filter.status) {
			const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
			results = results.filter((e) => statuses.includes(e.status));
		}
		if (filter.traceId) {
			results = results.filter((e) => e.traceId === filter.traceId);
		}
		if (filter.correlationId) {
			results = results.filter((e) => e.correlationId === filter.correlationId);
		}
		if (filter.projectId) {
			results = results.filter((e) => e.projectId === filter.projectId);
		}
		if (filter.planExecutionId) {
			results = results.filter((e) => e.planExecutionId === filter.planExecutionId);
		}
		if (filter.workspaceExecutionId) {
			results = results.filter((e) => e.workspaceExecutionId === filter.workspaceExecutionId);
		}
		if (filter.since) {
			results = results.filter((e) => e.timestamp >= filter.since!);
		}
		if (filter.until) {
			results = results.filter((e) => e.timestamp <= filter.until!);
		}

		// Sort
		const order = filter.order ?? "desc";
		results.sort((a, b) => {
			const cmp = a.timestamp.localeCompare(b.timestamp);
			return order === "asc" ? cmp : -cmp;
		});

		// Paginate
		const offset = filter.offset ?? 0;
		const limit = filter.limit ?? 100;
		return results.slice(offset, offset + limit);
	}

	/**
	 * Count events in the buffer matching the filter.
	 */
	count(filter: TelemetryQueryFilter = {}): number {
		return this.query({ ...filter, limit: undefined, offset: undefined }).length;
	}

	// ── Flushing ─────────────────────────────────────────────────────

	/**
	 * Flush buffered events to the persistence target.
	 *
	 * Events are batched according to the configured batch size.
	 * Failed events remain in the buffer for retry.
	 *
	 * @returns FlushResult with counts of flushed/failed events
	 */
	async flush(): Promise<FlushResult> {
		if (!this.flushTarget || this.buffer.length === 0) {
			return { flushed: 0, failed: 0, errors: [] };
		}

		const errors: string[] = [];
		let flushedCount = 0;
		let failedCount = 0;
		const remaining: ObservabilityEvent[] = [];

		// Flush in batches
		for (let i = 0; i < this.buffer.length; i += this.config.batchSize) {
			const batch = this.buffer.slice(i, i + this.config.batchSize);
			try {
				const persisted = await this.flushTarget.flush(batch);
				flushedCount += persisted;
				if (persisted < batch.length) {
					// Partial failure - keep the failed ones
					failedCount += batch.length - persisted;
					remaining.push(...batch.slice(persisted));
					errors.push(`Partial flush: ${persisted}/${batch.length} persisted`);
				}
			} catch (err) {
				failedCount += batch.length;
				remaining.push(...batch);
				errors.push(`Flush error: ${(err as Error).message}`);
			}
		}

		// Update tracking
		this.totalFlushed += flushedCount;
		if (failedCount > 0) {
			this.totalFlushFailures += failedCount;
		}

		// Replace buffer with failed events only (preserving order)
		this.buffer = remaining;
		this.lastFlushTimestamp = Date.now();

		return {
			flushed: flushedCount,
			failed: failedCount,
			errors,
		};
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get diagnostic information about the store.
	 */
	getDiagnostics(): TelemetryStoreDiagnostics {
		const now = Date.now();
		return {
			bufferSize: this.buffer.length,
			totalRecorded: this.totalRecorded,
			totalFlushed: this.totalFlushed,
			totalFlushFailures: this.totalFlushFailures,
			evictionCount: this.evictionCount,
			autoFlushActive: this.flushTimer !== null,
			timeSinceLastFlushMs: this.lastFlushTimestamp !== null ? now - this.lastFlushTimestamp : null,
		};
	}

	/**
	 * Clear all buffered events.
	 */
	clear(): void {
		this.buffer = [];
	}

	// ── Private ──────────────────────────────────────────────────────

	private restartFlushTimer(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		this.start();
	}
}
