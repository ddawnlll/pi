/**
 * Telemetry Routes — REST API for telemetry data queries and management (25.B).
 *
 * Provides REST endpoints for querying telemetry (observability) events,
 * managing retention, and accessing dashboard data.
 *
 * Uses a local `InMemoryTelemetryStore` combined with the `TelemetryQueryApi`
 * for query and aggregation operations on buffered/available events.
 *
 * Endpoints:
 *   GET    /api/telemetry/events              Query telemetry events
 *   GET    /api/telemetry/events/:id          Get single event
 *   GET    /api/telemetry/stats               Aggregate statistics
 *   GET    /api/telemetry/traces/:traceId     Get trace events
 *   GET    /api/telemetry/traces/:traceId/tree  Get span tree
 *   GET    /api/telemetry/errors              Error analysis
 *   GET    /api/telemetry/dashboard           Dashboard summary
 *   DELETE /api/telemetry/prune              Prune old events (retention)
 *   GET    /api/telemetry/summary             Counts by severity/eventType/source
 *   GET    /api/telemetry/time-series         Time-series data
 *   GET    /api/telemetry/retention/policy    Get current retention policy
 *
 * All endpoints require optional authentication (use existing auth middleware).
 */

import type { FastifyInstance } from "fastify";
import type { InMemoryTelemetryStore, TelemetryQueryApi, RetentionEngine } from "@earendil-works/pi-coding-agent";

// ─────────────────────────────────────────────────────────────────────
// Route Registration
// ─────────────────────────────────────────────────────────────────────

/**
 * Register telemetry routes on the given Fastify instance.
 *
 * @param fastify - Fastify instance
 * @param store - InMemoryTelemetryStore instance for buffered events
 * @param queryApi - TelemetryQueryApi instance for query operations
 * @param retention - RetentionEngine instance (optional, for prune operations)
 */
export async function registerTelemetryRoutes(
	fastify: FastifyInstance,
	store: InMemoryTelemetryStore,
	queryApi: TelemetryQueryApi,
	retention?: RetentionEngine,
): Promise<void> {
	// ── GET /api/telemetry/summary ────────────────────────────────
	// Must be registered before /events/:id to avoid route conflict

	fastify.get<{
		Querystring: {
			since?: string;
			until?: string;
			projectId?: string;
			eventType?: string;
			severity?: string;
			source?: string;
		};
	}>("/api/telemetry/summary", async (request, reply) => {
		try {
			const events = store.query({
				since: request.query.since,
				until: request.query.until,
				projectId: request.query.projectId,
				eventType: request.query.eventType ? [request.query.eventType] : undefined,
				severity: request.query.severity ? [request.query.severity] : undefined,
				source: request.query.source ? [request.query.source] : undefined,
			});

			const stats = queryApi.statistics(events);

			return {
				totalCount: stats.totalCount,
				bySeverity: stats.bySeverity,
				byEventType: stats.byEventType,
				bySource: stats.bySource,
				filter: {
					since: request.query.since,
					until: request.query.until,
					projectId: request.query.projectId,
					eventType: request.query.eventType,
					severity: request.query.severity,
				},
			};
		} catch (err) {
			request.log.error({ err }, "Failed to get telemetry summary");
			return reply.status(500).send({
				error: "Failed to get telemetry summary",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/events ─────────────────────────────────

	fastify.get<{
		Querystring: {
			traceId?: string;
			spanId?: string;
			correlationId?: string;
			eventType?: string;
			source?: string;
			severity?: string;
			status?: string;
			projectId?: string;
			planExecutionId?: string;
			workspaceExecutionId?: string;
			since?: string;
			until?: string;
			limit?: string;
			offset?: string;
			order?: "asc" | "desc";
		};
	}>("/api/telemetry/events", async (request, reply) => {
		try {
			const filter = {
				traceId: request.query.traceId,
				eventType: request.query.eventType,
				source: request.query.source,
				severity: request.query.severity ? [request.query.severity] : undefined,
				status: request.query.status ? [request.query.status] : undefined,
				projectId: request.query.projectId,
				planExecutionId: request.query.planExecutionId,
				workspaceExecutionId: request.query.workspaceExecutionId,
				correlationId: request.query.correlationId,
				since: request.query.since,
				until: request.query.until,
				limit: request.query.limit ? Number(request.query.limit) : 100,
				offset: request.query.offset ? Number(request.query.offset) : 0,
				order: request.query.order ?? "desc",
			};

			const events = store.query(filter);
			const total = store.count(filter);

			return { events, total, filter };
		} catch (err) {
			request.log.error({ err }, "Failed to query telemetry events");
			return reply.status(500).send({
				error: "Failed to query telemetry events",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/events/:id ─────────────────────────────

	fastify.get<{
		Params: { id: string };
	}>("/api/telemetry/events/:id", async (request, reply) => {
		try {
			// Search through all buffered events by ID
			const allEvents = store.query({ limit: 10000 });
			const event = allEvents.find((e) => e.id === request.params.id);

			if (!event) {
				return reply.status(404).send({ error: "Event not found" });
			}
			return event;
		} catch (err) {
			request.log.error({ err }, "Failed to get telemetry event");
			return reply.status(500).send({
				error: "Failed to get telemetry event",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/stats ──────────────────────────────────

	fastify.get<{
		Querystring: {
			traceId?: string;
			correlationId?: string;
			projectId?: string;
			planExecutionId?: string;
			workspaceExecutionId?: string;
			eventType?: string;
			source?: string;
			severity?: string;
			status?: string;
			since?: string;
			until?: string;
			limit?: string;
		};
	}>("/api/telemetry/stats", async (request, reply) => {
		try {
			const events = store.query({
				traceId: request.query.traceId,
				correlationId: request.query.correlationId,
				projectId: request.query.projectId,
				planExecutionId: request.query.planExecutionId,
				workspaceExecutionId: request.query.workspaceExecutionId,
				eventType: request.query.eventType,
				source: request.query.source,
				severity: request.query.severity ? [request.query.severity] : undefined,
				status: request.query.status ? [request.query.status] : undefined,
				since: request.query.since,
				until: request.query.until,
				limit: request.query.limit ? Number(request.query.limit) : 1000,
				order: "desc",
			});

			const stats = queryApi.statistics(events);
			const aggregations = queryApi.aggregate(events, [
				{ fn: "count", as: "total" },
				{ fn: "avg", field: "durationMs", as: "avgDuration" },
				{ fn: "p50", field: "durationMs", as: "p50Duration" },
				{ fn: "p90", field: "durationMs", as: "p90Duration" },
				{ fn: "p95", field: "durationMs", as: "p95Duration" },
			]);

			return {
				stats,
				aggregations,
				filteredEvents: events.length,
				filter: {
					traceId: request.query.traceId,
					correlationId: request.query.correlationId,
					projectId: request.query.projectId,
					planExecutionId: request.query.planExecutionId,
					workspaceExecutionId: request.query.workspaceExecutionId,
					eventType: request.query.eventType,
					source: request.query.source,
					severity: request.query.severity,
					status: request.query.status,
					since: request.query.since,
					until: request.query.until,
					limit: request.query.limit ? Number(request.query.limit) : 1000,
				},
			};
		} catch (err) {
			request.log.error({ err }, "Failed to get telemetry stats");
			return reply.status(500).send({
				error: "Failed to get telemetry stats",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/traces/:traceId ────────────────────────

	fastify.get<{
		Params: { traceId: string };
		Querystring: { order?: "asc" | "desc" };
	}>("/api/telemetry/traces/:traceId", async (request, reply) => {
		try {
			const events = store.query({
				traceId: request.params.traceId,
				order: request.query.order ?? "asc",
			});
			return { traceId: request.params.traceId, events, count: events.length };
		} catch (err) {
			request.log.error({ err }, "Failed to get trace");
			return reply.status(500).send({
				error: "Failed to get trace",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/traces/:traceId/tree ───────────────────

	fastify.get<{
		Params: { traceId: string };
	}>("/api/telemetry/traces/:traceId/tree", async (request, reply) => {
		try {
			const events = store.query({
				traceId: request.params.traceId,
				order: "asc",
			});

			// Build span tree manually from events
			const eventMap = new Map<string, (typeof events)[0]>();
			for (const event of events) {
				eventMap.set(event.spanId, event);
			}

			const roots: Array<{ event: (typeof events)[0]; children: any[] }> = [];
			const nodeMap = new Map<string, { event: (typeof events)[0]; children: any[] }>();

			for (const event of events) {
				const node = { event, children: [] as any[] };
				nodeMap.set(event.spanId, node);

				if (event.parentSpanId && eventMap.has(event.parentSpanId)) {
					const parent = nodeMap.get(event.parentSpanId);
					if (parent) {
						parent.children.push(node);
					} else {
						roots.push(node);
					}
				} else {
					roots.push(node);
				}
			}

			return { traceId: request.params.traceId, tree: roots };
		} catch (err) {
			request.log.error({ err }, "Failed to get span tree");
			return reply.status(500).send({
				error: "Failed to get span tree",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/errors ─────────────────────────────────

	fastify.get<{
		Querystring: {
			limit?: string;
			since?: string;
			until?: string;
			projectId?: string;
			source?: string;
		};
	}>("/api/telemetry/errors", async (request, reply) => {
		try {
			const limit = request.query.limit ? Number(request.query.limit) : 50;

			const events = store.query({
				severity: ["error", "critical"],
				since: request.query.since,
				until: request.query.until,
				projectId: request.query.projectId,
				source: request.query.source ? [request.query.source] : undefined,
				limit: 10000,
				order: "desc",
			});

			const analysis = queryApi.analyzeErrors(events, limit);

			return analysis;
		} catch (err) {
			request.log.error({ err }, "Failed to analyze errors");
			return reply.status(500).send({
				error: "Failed to analyze errors",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/dashboard ──────────────────────────────

	fastify.get<{
		Querystring: {
			projectId?: string;
			since?: string;
			until?: string;
			limit?: string;
		};
	}>("/api/telemetry/dashboard", async (request, reply) => {
		try {
			const filter = {
				projectId: request.query.projectId,
				since: request.query.since,
				until: request.query.until,
				limit: request.query.limit ? Number(request.query.limit) : 1000,
				order: "desc" as const,
			};

			const events = store.query(filter);
			const summary = queryApi.dashboardSummary(events);

			return { summary, filter };
		} catch (err) {
			request.log.error({ err }, "Failed to get dashboard data");
			return reply.status(500).send({
				error: "Failed to get dashboard data",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/time-series ────────────────────────────

	fastify.get<{
		Querystring: {
			bucketWidthMs?: string;
			since: string;
			until: string;
			projectId?: string;
			severity?: string;
			eventType?: string;
			source?: string;
		};
	}>("/api/telemetry/time-series", async (request, reply) => {
		try {
			const bucketWidthMs = request.query.bucketWidthMs
				? Number(request.query.bucketWidthMs)
				: 3600000; // default 1h

			if (!request.query.since || !request.query.until) {
				return reply.status(400).send({
					error: "since and until query parameters are required",
				});
			}

			const events = store.query({
				since: request.query.since,
				until: request.query.until,
				projectId: request.query.projectId,
				severity: request.query.severity ? [request.query.severity] : undefined,
				eventType: request.query.eventType ? [request.query.eventType] : undefined,
				source: request.query.source ? [request.query.source] : undefined,
			});

			const result = queryApi.timeSeries(
				events,
				{
					widthMs: bucketWidthMs,
					since: request.query.since,
					until: request.query.until,
				},
				[{ fn: "count", as: "count" }],
			);

			return {
				bucketWidthMs,
				since: request.query.since,
				until: request.query.until,
				buckets: result.points,
			};
		} catch (err) {
			request.log.error({ err }, "Failed to get time-series data");
			return reply.status(500).send({
				error: "Failed to get time-series data",
				message: (err as Error).message,
			});
		}
	});

	// ── DELETE /api/telemetry/prune ───────────────────────────────

	fastify.delete<{
		Querystring: {
			before?: string;
			severity?: string;
			eventType?: string;
			source?: string;
			projectId?: string;
			maxCount?: string;
		};
	}>("/api/telemetry/prune", async (request, reply) => {
		try {
			const before = request.query.before;
			const maxCount = request.query.maxCount ? Number(request.query.maxCount) : undefined;

			if (maxCount === undefined && !before) {
				return reply.status(400).send({
					error: "Either 'before' (ISO timestamp) or 'maxCount' (number) query parameter is required",
				});
			}

			let deletedCount = 0;

			if (retention) {
				// Use the retention engine for policy-based pruning
				const allEvents = store.query({ limit: 100000, order: "asc" });
				const { retained, result } = retention.prune(allEvents);

				deletedCount = result.eventsPruned;

				// Replace store buffer with retained events
				store.clear();
				store.recordBatch(retained);
			} else if (maxCount !== undefined) {
				// Manual count-based prune
				const allEvents = store.query({ order: "asc" });
				if (allEvents.length > maxCount) {
					const toRemove = allEvents.length - maxCount;
					const retained = allEvents.slice(toRemove);
					store.clear();
					store.recordBatch(retained);
					deletedCount = toRemove;
				}
			} else if (before) {
				// Manual time-based prune
				const allEvents = store.query({ order: "asc" });
				const retained = allEvents.filter((e) => e.timestamp >= before!);
				deletedCount = allEvents.length - retained.length;
				store.clear();
				store.recordBatch(retained);
			}

			return {
				deleted: deletedCount,
				filter: {
					severity: request.query.severity,
					eventType: request.query.eventType,
					source: request.query.source,
					projectId: request.query.projectId,
				},
			};
		} catch (err) {
			request.log.error({ err }, "Failed to prune telemetry events");
			return reply.status(500).send({
				error: "Failed to prune telemetry events",
				message: (err as Error).message,
			});
		}
	});

	// ── GET /api/telemetry/retention/policy ───────────────────────

	fastify.get("/api/telemetry/retention/policy", async (_request, reply) => {
		try {
			if (retention) {
				const policy = retention.getPolicy();
				return {
					policy: {
						name: policy.name,
						rules: policy.rules.map((r) => ({
							name: r.name,
							eventType: r.eventType,
							source: r.source,
							severity: r.severity,
							maxAgeMs: r.maxAgeMs,
							maxCount: r.maxCount,
							priority: r.priority,
						})),
						globalMaxCount: policy.globalMaxCount,
						pruneIntervalMs: policy.pruneIntervalMs,
						autoPrune: policy.autoPrune,
					},
				};
			}

			// Fallback default policy
			return {
				policy: {
					name: "default",
					rules: [
						{ name: "debug", severity: "debug", maxAgeMs: 3_600_000, maxCount: 1000 },
						{ name: "info", severity: "info", maxAgeMs: 86_400_000, maxCount: 10_000 },
						{ name: "warning", severity: "warning", maxAgeMs: 604_800_000, maxCount: 5_000 },
						{ name: "error", severity: "error", maxAgeMs: 2_592_000_000, maxCount: 10_000 },
						{ name: "critical", severity: "critical", maxAgeMs: 7_776_000_000, maxCount: 5_000 },
					],
					globalMaxCount: 100_000,
				},
			};
		} catch (err) {
			request.log.error({ err }, "Failed to get retention policy");
			return reply.status(500).send({
				error: "Failed to get retention policy",
				message: (err as Error).message,
			});
		}
	});
}
