/**
 * Observability Event Repository (25.A).
 *
 * Provides persistence and query operations for observability events
 * with trace IDs, span IDs, and correlation model support.
 *
 * Supports distributed tracing queries:
 * - Get all spans for a trace (ordered by timestamp)
 * - Get span tree (parent-child relationships)
 * - Query by correlation ID for cross-cutting concerns
 * - Filter by execution hierarchy (project, plan, workspace)
 */

import { sql, type Kysely } from "kysely";
import type { Database, NewObservabilityEvent, ObservabilityEvent } from "../types.js";

/**
 * Severity levels for observability events.
 */
export const OBSERVABILITY_SEVERITIES = ["debug", "info", "warning", "error", "critical"] as const;

/**
 * Span status values.
 */
export const OBSERVABILITY_STATUSES = ["ok", "error", "running", "unknown"] as const;

/**
 * Filter options for querying observability events.
 */
export interface ObservabilityEventFilter {
	/** Filter by trace ID */
	traceId?: string;
	/** Filter by span ID */
	spanId?: string;
	/** Filter by parent span ID */
	parentSpanId?: string | null;
	/** Filter by correlation ID */
	correlationId?: string;
	/** Filter by event type */
	eventType?: string;
	/** Filter by source component */
	source?: string;
	/** Filter by severity */
	severity?: string;
	/** Filter by status */
	status?: string;
	/** Filter by project UUID */
	projectId?: string;
	/** Filter by plan execution UUID */
	planExecutionId?: string;
	/** Filter by workspace execution UUID */
	workspaceExecutionId?: string;
	/** Return events on or after this ISO timestamp */
	since?: string;
	/** Return events on or before this ISO timestamp */
	until?: string;
	/** Maximum number of events to return (default: 100) */
	limit?: number;
	/** Number of events to skip (default: 0) */
	offset?: number;
	/** Sort order for results (default: "asc") */
	order?: "asc" | "desc";
}

/**
 * Span tree node representing a span and its children.
 */
export interface SpanTreeNode {
	/** The span event */
	event: ObservabilityEvent;
	/** Child spans */
	children: SpanTreeNode[];
}

/**
 * Observability event repository
 */
export class ObservabilityEventRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new observability event.
	 *
	 * @param data - Observability event data
	 * @returns Created observability event
	 */
	async create(data: NewObservabilityEvent): Promise<ObservabilityEvent> {
		return this.db.insertInto("observability_events").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find an observability event by ID.
	 *
	 * @param id - Event UUID
	 * @returns Event or undefined
	 */
	async findById(id: string): Promise<ObservabilityEvent | undefined> {
		return this.db.selectFrom("observability_events").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * Query observability events with flexible filtering.
	 *
	 * @param filter - Filter options (all optional)
	 * @returns Array of matching events
	 */
	async query(filter: ObservabilityEventFilter = {}): Promise<ObservabilityEvent[]> {
		let query = this.db.selectFrom("observability_events").selectAll();

		if (filter.traceId) {
			query = query.where("trace_id", "=", filter.traceId);
		}
		if (filter.spanId) {
			query = query.where("span_id", "=", filter.spanId);
		}
		if (filter.parentSpanId !== undefined) {
			if (filter.parentSpanId === null) {
				query = query.where("parent_span_id", "is", null);
			} else {
				query = query.where("parent_span_id", "=", filter.parentSpanId);
			}
		}
		if (filter.correlationId) {
			query = query.where("correlation_id", "=", filter.correlationId);
		}
		if (filter.eventType) {
			query = query.where("event_type", "=", filter.eventType);
		}
		if (filter.source) {
			query = query.where("source", "=", filter.source);
		}
		if (filter.severity) {
			query = query.where("severity", "=", filter.severity);
		}
		if (filter.status) {
			query = query.where("status", "=", filter.status);
		}
		if (filter.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter.planExecutionId) {
			query = query.where("plan_execution_id", "=", filter.planExecutionId);
		}
		if (filter.workspaceExecutionId) {
			query = query.where("workspace_execution_id", "=", filter.workspaceExecutionId);
		}
		if (filter.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter.until) {
			query = query.where("timestamp", "<=", filter.until);
		}

		const order = filter.order ?? "asc";
		query = query.orderBy("timestamp", order);

		const limit = filter.limit ?? 100;
		const offset = filter.offset ?? 0;
		query = query.limit(limit).offset(offset);

		return query.execute();
	}

	/**
	 * Get all spans for a trace, ordered by timestamp.
	 *
	 * @param traceId - Trace UUID
	 * @param order - Sort order (default: "asc")
	 * @returns Array of events in the trace
	 */
	async getTrace(traceId: string, order: "asc" | "desc" = "asc"): Promise<ObservabilityEvent[]> {
		return this.db
			.selectFrom("observability_events")
			.selectAll()
			.where("trace_id", "=", traceId)
			.orderBy("timestamp", order)
			.execute();
	}

	/**
	 * Build a span tree for a given trace.
	 *
	 * Returns root spans (no parent) with nested children.
	 *
	 * @param traceId - Trace UUID
	 * @returns Array of root span tree nodes
	 */
	async getSpanTree(traceId: string): Promise<SpanTreeNode[]> {
		const events = await this.getTrace(traceId, "asc");

		// Build lookup: spanId -> event
		const eventMap = new Map<string, ObservabilityEvent>();
		for (const event of events) {
			eventMap.set(event.span_id, event);
		}

		// Build tree
		const roots: SpanTreeNode[] = [];
		const nodeMap = new Map<string, SpanTreeNode>();

		for (const event of events) {
			const node: SpanTreeNode = { event, children: [] };
			nodeMap.set(event.span_id, node);

			if (event.parent_span_id && eventMap.has(event.parent_span_id)) {
				// Add as child of parent
				const parent = nodeMap.get(event.parent_span_id);
				if (parent) {
					parent.children.push(node);
				} else {
					roots.push(node);
				}
			} else {
				// Root span
				roots.push(node);
			}
		}

		return roots;
	}

	/**
	 * Get events by correlation ID (cross-cutting concerns).
	 *
	 * @param correlationId - Correlation identifier
	 * @param filter - Additional filter options
	 * @returns Array of correlated events
	 */
	async getByCorrelation(
		correlationId: string,
		filter?: Omit<ObservabilityEventFilter, "correlationId">,
	): Promise<ObservabilityEvent[]> {
		return this.query({ ...filter, correlationId });
	}

	/**
	 * Get events by project.
	 *
	 * @param projectId - Project UUID
	 * @param filter - Additional filter options
	 * @returns Array of events
	 */
	async getByProject(
		projectId: string,
		filter?: Omit<ObservabilityEventFilter, "projectId">,
	): Promise<ObservabilityEvent[]> {
		return this.query({ ...filter, projectId });
	}

	/**
	 * Get events by plan execution.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @param filter - Additional filter options
	 * @returns Array of events
	 */
	async getByPlanExecution(
		planExecutionId: string,
		filter?: Omit<ObservabilityEventFilter, "planExecutionId">,
	): Promise<ObservabilityEvent[]> {
		return this.query({ ...filter, planExecutionId });
	}

	/**
	 * Get events by workspace execution.
	 *
	 * @param workspaceExecutionId - Workspace execution UUID
	 * @param filter - Additional filter options
	 * @returns Array of events
	 */
	async getByWorkspaceExecution(
		workspaceExecutionId: string,
		filter?: Omit<ObservabilityEventFilter, "workspaceExecutionId">,
	): Promise<ObservabilityEvent[]> {
		return this.query({ ...filter, workspaceExecutionId });
	}

	/**
	 * Get the root span for a trace (the first span with no parent).
	 *
	 * @param traceId - Trace UUID
	 * @returns Root span event or undefined
	 */
	async getRootSpan(traceId: string): Promise<ObservabilityEvent | undefined> {
		return this.db
			.selectFrom("observability_events")
			.selectAll()
			.where("trace_id", "=", traceId)
			.where("parent_span_id", "is", null)
			.orderBy("timestamp", "asc")
			.limit(1)
			.executeTakeFirst();
	}

	/**
	 * Count events matching a filter.
	 *
	 * @param filter - Filter options
	 * @returns Count of matching events
	 */
	async count(filter: ObservabilityEventFilter = {}): Promise<number> {
		let query = this.db.selectFrom("observability_events").select(this.db.fn.countAll<number>().as("count"));

		if (filter.traceId) {
			query = query.where("trace_id", "=", filter.traceId);
		}
		if (filter.correlationId) {
			query = query.where("correlation_id", "=", filter.correlationId);
		}
		if (filter.eventType) {
			query = query.where("event_type", "=", filter.eventType);
		}
		if (filter.severity) {
			query = query.where("severity", "=", filter.severity);
		}
		if (filter.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter.planExecutionId) {
			query = query.where("plan_execution_id", "=", filter.planExecutionId);
		}
		if (filter.workspaceExecutionId) {
			query = query.where("workspace_execution_id", "=", filter.workspaceExecutionId);
		}
		if (filter.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter.until) {
			query = query.where("timestamp", "<=", filter.until);
		}

		const result = await query.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	/**
	 * Get latest events for error analysis.
	 *
	 * @param limit - Number of events (default: 50)
	 * @returns Array of error/critical events
	 */
	async getLatestErrors(limit = 50): Promise<ObservabilityEvent[]> {
		return this.db
			.selectFrom("observability_events")
			.selectAll()
			.where("severity", "in", ["error", "critical"])
			.orderBy("timestamp", "desc")
			.limit(limit)
			.execute();
	}

	/**
	 * Prune events older than a given timestamp (retention).
	 *
	 * @param beforeISO - ISO timestamp: events older than this are deleted
	 * @param filter - Optional additional filter to scope the deletion (e.g., by severity or event type)
	 * @returns Number of deleted rows
	 */
	async pruneOlderThan(
		beforeISO: string,
		filter?: Pick<ObservabilityEventFilter, "severity" | "eventType" | "source" | "projectId">,
	): Promise<number> {
		let query = this.db.deleteFrom("observability_events").where("timestamp", "<", beforeISO);

		if (filter?.severity) {
			query = query.where("severity", "=", filter.severity);
		}
		if (filter?.eventType) {
			query = query.where("event_type", "=", filter.eventType);
		}
		if (filter?.source) {
			query = query.where("source", "=", filter.source);
		}
		if (filter?.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}

		const result = await query.executeTakeFirst();
		return Number(result.numDeletedRows);
	}

	/**
	 * Prune events beyond a maximum count, keeping the most recent.
	 *
	 * @param maxCount - Maximum number of events to retain
	 * @param filter - Optional additional filter to scope the operation
	 * @returns Number of deleted rows
	 */
	async pruneToMaxCount(
		maxCount: number,
		filter?: Pick<ObservabilityEventFilter, "severity" | "eventType" | "source" | "projectId">,
	): Promise<number> {
		// Count total matching events
		let countQuery = this.db
			.selectFrom("observability_events")
			.select(this.db.fn.countAll<number>().as("count"));

		if (filter?.severity) {
			countQuery = countQuery.where("severity", "=", filter.severity);
		}
		if (filter?.eventType) {
			countQuery = countQuery.where("event_type", "=", filter.eventType);
		}
		if (filter?.source) {
			countQuery = countQuery.where("source", "=", filter.source);
		}
		if (filter?.projectId) {
			countQuery = countQuery.where("project_id", "=", filter.projectId);
		}

		const countResult = await countQuery.executeTakeFirst();
		const total = Number(countResult?.count ?? 0);

		if (total <= maxCount) return 0;

		const toDelete = total - maxCount;

		// Find the cutoff: the timestamp of the Nth most recent event
		let thresholdQuery = this.db
			.selectFrom("observability_events")
			.select("timestamp")
			.orderBy("timestamp", "desc")
			.limit(1)
			.offset(maxCount - 1);

		if (filter?.severity) {
			thresholdQuery = thresholdQuery.where("severity", "=", filter.severity);
		}
		if (filter?.eventType) {
			thresholdQuery = thresholdQuery.where("event_type", "=", filter.eventType);
		}
		if (filter?.source) {
			thresholdQuery = thresholdQuery.where("source", "=", filter.source);
		}
		if (filter?.projectId) {
			thresholdQuery = thresholdQuery.where("project_id", "=", filter.projectId);
		}

		const threshold = await thresholdQuery.executeTakeFirst();
		if (!threshold) return 0;

		return this.pruneOlderThan(threshold.timestamp, filter);
	}

	/**
	 * Get aggregation counts by severity.
	 *
	 * @param filter - Optional time range or scope filter
	 * @returns Record of severity -> count
	 */
	async countBySeverity(
		filter?: Pick<ObservabilityEventFilter, "since" | "until" | "projectId" | "eventType">,
	): Promise<Record<string, number>> {
		let query = this.db
			.selectFrom("observability_events")
			.select(["severity", this.db.fn.countAll<number>().as("count")]);

		if (filter?.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter?.until) {
			query = query.where("timestamp", "<=", filter.until);
		}
		if (filter?.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter?.eventType) {
			query = query.where("event_type", "=", filter.eventType);
		}

		query = query.groupBy("severity");

		const rows = await query.execute();
		const result: Record<string, number> = {};
		for (const row of rows) {
			result[row.severity] = Number(row.count);
		}
		return result;
	}

	/**
	 * Get aggregation counts by event type.
	 *
	 * @param filter - Optional time range or scope filter
	 * @returns Record of event_type -> count
	 */
	async countByEventType(
		filter?: Pick<ObservabilityEventFilter, "since" | "until" | "projectId" | "severity">,
	): Promise<Record<string, number>> {
		let query = this.db
			.selectFrom("observability_events")
			.select(["event_type", this.db.fn.countAll<number>().as("count")]);

		if (filter?.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter?.until) {
			query = query.where("timestamp", "<=", filter.until);
		}
		if (filter?.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter?.severity) {
			query = query.where("severity", "=", filter.severity);
		}

		query = query.groupBy("event_type");

		const rows = await query.execute();
		const result: Record<string, number> = {};
		for (const row of rows) {
			result[row.event_type] = Number(row.count);
		}
		return result;
	}

	/**
	 * Get aggregation counts by source.
	 *
	 * @param filter - Optional time range or scope filter
	 * @returns Record of source -> count
	 */
	async countBySource(
		filter?: Pick<ObservabilityEventFilter, "since" | "until" | "projectId" | "severity" | "eventType">,
	): Promise<Record<string, number>> {
		let query = this.db
			.selectFrom("observability_events")
			.select(["source", this.db.fn.countAll<number>().as("count")]);

		if (filter?.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter?.until) {
			query = query.where("timestamp", "<=", filter.until);
		}
		if (filter?.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter?.severity) {
			query = query.where("severity", "=", filter.severity);
		}
		if (filter?.eventType) {
			query = query.where("event_type", "=", filter.eventType);
		}

		query = query.groupBy("source");

		const rows = await query.execute();
		const result: Record<string, number> = {};
		for (const row of rows) {
			result[row.source] = Number(row.count);
		}
		return result;
	}

	/**
	 * Get average duration for events that have duration_ms, grouped by event type.
	 *
	 * @param filter - Optional time range or scope filter
	 * @returns Record of event_type -> avg duration
	 */
	async averageDurationByEventType(
		filter?: Pick<ObservabilityEventFilter, "since" | "until" | "projectId" | "severity">,
	): Promise<Record<string, number>> {
		let query = this.db
			.selectFrom("observability_events")
			.select(["event_type", this.db.fn.avg<number>("duration_ms").as("avg_duration")])
			.where("duration_ms", "is not", null);

		if (filter?.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter?.until) {
			query = query.where("timestamp", "<=", filter.until);
		}
		if (filter?.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter?.severity) {
			query = query.where("severity", "=", filter.severity);
		}

		query = query.groupBy("event_type");

		const rows = await query.execute();
		const result: Record<string, number> = {};
		for (const row of rows) {
			result[row.event_type] = Number(row.avg_duration);
		}
		return result;
	}

	/**
	 * Get time-series bucket counts for dashboard-style queries.
	 *
	 * Uses epoch-second arithmetic for cross-version PostgreSQL compatibility.
	 *
	 * @param bucketWidthMs - Width of each time bucket in milliseconds
	 * @param since - Start of the time range
	 * @param until - End of the time range
	 * @param filter - Optional additional filters
	 * @returns Array of { bucket, count } ordered by bucket
	 */
	async timeSeriesCount(
		bucketWidthMs: number,
		since: string,
		until: string,
		filter?: Pick<ObservabilityEventFilter, "projectId" | "severity" | "eventType" | "source">,
	): Promise<Array<{ bucket: string; count: number }>> {
		const widthSec = Math.max(Math.round(bucketWidthMs / 1000), 1);
		const sinceSec = Math.floor(new Date(since).getTime() / 1000);

		// Use epoch arithmetic: bucket = to_timestamp(floor(extract(epoch from timestamp) / width) * width)
		// This works on all PostgreSQL versions and does not require date_bin
		let query = this.db
			.selectFrom("observability_events")
			.select([
				sql<string>`to_timestamp(floor(extract(epoch from "timestamp") / ${sql.literal(widthSec)}) * ${sql.literal(widthSec)})`.as("bucket"),
				this.db.fn.countAll<number>().as("count"),
			])
			.where("timestamp", ">=", since)
			.where("timestamp", "<=", until);

		if (filter?.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter?.severity) {
			query = query.where("severity", "=", filter.severity);
		}
		if (filter?.eventType) {
			query = query.where("event_type", "=", filter.eventType);
		}
		if (filter?.source) {
			query = query.where("source", "=", filter.source);
		}

		query = query.groupBy("bucket").orderBy("bucket", "asc");

		const rows = await query.execute();
		return rows.map((r) => ({
			bucket: String((r as any).bucket),
			count: Number(r.count),
		}));
	}

	/**
	 * Get the time range (min/max timestamp) of stored events.
	 *
	 * @param filter - Optional scope filter
	 * @returns Object with min and max timestamp, or null if no events
	 */
	async getTimeRange(
		filter?: Pick<ObservabilityEventFilter, "projectId" | "severity" | "eventType">,
	): Promise<{ minTimestamp: string; maxTimestamp: string } | null> {
		let query = this.db
			.selectFrom("observability_events")
			.select([
				this.db.fn.min<string>("timestamp").as("min_ts"),
				this.db.fn.max<string>("timestamp").as("max_ts"),
			]);

		if (filter?.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter?.severity) {
			query = query.where("severity", "=", filter.severity);
		}
		if (filter?.eventType) {
			query = query.where("event_type", "=", filter.eventType);
		}

		const row = await query.executeTakeFirst();
		if (!row || !row.min_ts || !row.max_ts) return null;
		return { minTimestamp: row.min_ts, maxTimestamp: row.max_ts };
	}

	/**
	 * Delete events for a trace.
	 *
	 * @param traceId - Trace UUID
	 * @returns Number of deleted rows
	 */
	async deleteTrace(traceId: string): Promise<number> {
		const result = await this.db
			.deleteFrom("observability_events")
			.where("trace_id", "=", traceId)
			.executeTakeFirst();
		return Number(result.numDeletedRows);
	}

	/**
	 * Delete an event by ID.
	 *
	 * @param id - Event UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("observability_events").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}
}
