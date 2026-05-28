/**
 * Brain V5 Routes — REST API for V5 capability boundary status and Temporal Journal v2.
 *
 * Provides endpoints:
 *   GET /brain-v5/status      — Current V5 mode and capability flags
 *   GET /brain-v5/doctor       — V5 plan doctor report
 *   GET /brain-v5/gates        — V5 operator gate status
 *
 * Temporal Journal v2 endpoints (V5.01):
 *   POST /brain-v5/temporal/events          — Record a temporal event
 *   GET  /brain-v5/temporal/events          — Query temporal events
 *   GET  /brain-v5/temporal/rollups         — Query temporal rollups
 *   POST /brain-v5/temporal/rollups/generate — Generate a new rollup
 *   GET  /brain-v5/temporal/stuck           — Query "what got stuck?"
 *   GET  /brain-v5/temporal/stuck/last-week — Query "what got stuck last week?"
 *   POST /brain-v5/temporal/rollups/:id/regenerate — Regenerate and verify a rollup
 *
 * Routes can be registered under any prefix:
 * - Globally: prefix "/api" → /api/brain-v5/status
 * - Per-project: prefix "/api/projects/:projectId" → /api/projects/:projectId/brain-v5/status
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface V5RouteOptions {
	getSettingsManager?: () => Promise<{
		getBrainV5Settings: () => {
			enabled?: boolean;
			readOnlyMode?: boolean;
			pushEnabled?: boolean;
			overnightOperatorEnabled?: boolean;
		};
		getBrainV5Mode: () => string;
	}>;
	getTemporalEngine?: () => Promise<{
		recordEvent: (event: {
			id?: string;
			timestamp: string;
			entityId?: string;
			entityType?: string;
			eventType: string;
			summary: string;
			evidence: Array<{ type: string; ref: string; description: string }>;
			metadata?: Record<string, unknown>;
		}) => Promise<void>;
		recordEvents: (events: unknown[]) => Promise<void>;
		store: {
			queryEvents: (query: {
				since?: string;
				until?: string;
				entityId?: string;
				eventTypes?: string[];
				limit?: number;
				offset?: number;
			}) => Promise<unknown[]>;
			countEvents: (query: {
				since?: string;
				until?: string;
				entityId?: string;
				eventTypes?: string[];
			}) => Promise<number>;
			queryRollups: (query: {
				period?: string;
				since?: string;
				until?: string;
				entityId?: string;
				limit?: number;
				offset?: number;
			}) => Promise<unknown[]>;
		};
		queryStuckItems: (
			since: string,
			until: string,
			entityId?: string,
		) => Promise<{
			items: unknown[];
			total: number;
			period: { since: string; until: string };
		}>;
		queryStuckLastWeek: (entityId?: string) => Promise<{
			items: unknown[];
			total: number;
			period: { since: string; until: string };
		}>;
		generateAndStoreRollup: (
			period: string,
			periodStart: string,
			periodEnd: string,
			entityId?: string,
		) => Promise<unknown>;
		regenerateRollup: (rollupId: string) => Promise<{
			rollup: unknown;
			matchesOriginal: boolean;
		}>;
		queryWhatHappened: (query: {
			since?: string;
			until?: string;
			entityId?: string;
			eventTypes?: string[];
			limit?: number;
			offset?: number;
		}) => Promise<{ items: unknown[]; total: number }>;
		queryWhatRepeated: (query: {
			since?: string;
			until?: string;
			entityId?: string;
			eventTypes?: string[];
			limit?: number;
			offset?: number;
		}) => Promise<{ patterns: unknown[]; total: number }>;
		queryWhatChanged: (query: {
			since?: string;
			until?: string;
			entityId?: string;
			eventTypes?: string[];
			limit?: number;
			offset?: number;
		}) => Promise<{ changes: unknown[]; total: number }>;
	}>;
}

/**
 * Register Brain V5 status and Temporal Journal routes on a Fastify instance.
 *
 * @param fastify - Fastify instance to register routes on
 * @param options - SettingsManager and TemporalEngine providers
 */
export async function registerBrainV5Routes(fastify: FastifyInstance, options?: V5RouteOptions): Promise<void> {
	// =========================================================================
	// V5 Status Routes
	// =========================================================================

	// GET /brain-v5/status — Current V5 mode and capability flags
	fastify.get("/brain-v5/status", async (_request, reply) => {
		try {
			let mode = "OFF";
			let flags = {
				enabled: false,
				readOnlyMode: true,
				pushEnabled: false,
				overnightOperatorEnabled: false,
			};

			if (options?.getSettingsManager) {
				const sm = await options.getSettingsManager();
				const settings = sm.getBrainV5Settings();
				mode = sm.getBrainV5Mode();
				flags = {
					enabled: settings.enabled ?? false,
					readOnlyMode: settings.readOnlyMode ?? true,
					pushEnabled: settings.pushEnabled ?? false,
					overnightOperatorEnabled: settings.overnightOperatorEnabled ?? false,
				};
			}

			return {
				mode,
				flags,
				v5Available: mode !== "OFF",
				canEmit: mode !== "OFF" && mode !== "READ_ONLY",
				canPush: mode === "DRAFTING" || mode === "OPERATOR_READY",
				canRunOvernight: mode === "OPERATOR_READY",
			};
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get Brain V5 status",
				message: error instanceof Error ? error.message : String(error),
				mode: "OFF",
				v5Available: false,
				canEmit: false,
				canPush: false,
				canRunOvernight: false,
			});
		}
	});

	// GET /brain-v5/doctor — V5 plan doctor report
	fastify.get("/brain-v5/doctor", async (_request, reply) => {
		try {
			const { buildV5DoctorReport, checkV5OperatorGates } = await import("@earendil-works/pi-coding-agent");

			let config: {
				enabled: boolean;
				readOnlyMode: boolean;
				pushEnabled: boolean;
				overnightOperatorEnabled: boolean;
				mode: "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";
			} = {
				enabled: false,
				readOnlyMode: true,
				pushEnabled: false,
				overnightOperatorEnabled: false,
				mode: "OFF",
			};

			if (options?.getSettingsManager) {
				const sm = await options.getSettingsManager();
				const raw = sm.getBrainV5Settings();
				config = {
					enabled: raw.enabled ?? false,
					readOnlyMode: raw.readOnlyMode ?? true,
					pushEnabled: raw.pushEnabled ?? false,
					overnightOperatorEnabled: raw.overnightOperatorEnabled ?? false,
					mode: sm.getBrainV5Mode() as "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY",
				};
			}

			const gates = checkV5OperatorGates(config);
			const report = buildV5DoctorReport(config, gates);

			return report;
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get V5 doctor report",
				message: error instanceof Error ? error.message : String(error),
				mode: "OFF",
				canSuggest: false,
				operatorGatesPassed: false,
				summary: "Error retrieving V5 status.",
				details: [],
			});
		}
	});

	// GET /brain-v5/gates — V5 operator gate status
	fastify.get("/brain-v5/gates", async (_request, reply) => {
		try {
			const { checkV5OperatorGates } = await import("@earendil-works/pi-coding-agent");

			let config: {
				enabled: boolean;
				readOnlyMode: boolean;
				pushEnabled: boolean;
				overnightOperatorEnabled: boolean;
				mode: "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";
			} = {
				enabled: false,
				readOnlyMode: true,
				pushEnabled: false,
				overnightOperatorEnabled: false,
				mode: "OFF",
			};

			if (options?.getSettingsManager) {
				const sm = await options.getSettingsManager();
				const raw = sm.getBrainV5Settings();
				config = {
					enabled: raw.enabled ?? false,
					readOnlyMode: raw.readOnlyMode ?? true,
					pushEnabled: raw.pushEnabled ?? false,
					overnightOperatorEnabled: raw.overnightOperatorEnabled ?? false,
					mode: sm.getBrainV5Mode() as "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY",
				};
			}

			const gates = checkV5OperatorGates(config);
			return gates;
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get V5 gate status",
				message: error instanceof Error ? error.message : String(error),
				pushEnabled: false,
				overnightOperatorEnabled: false,
				safetyProfileAllows: false,
				executionContextAllows: false,
				allGatesPassed: false,
			});
		}
	});

	// =========================================================================
	// Temporal Journal v2 Routes (V5.01)
	// =========================================================================

	// POST /brain-v5/temporal/events — Record a temporal event
	fastify.post("/brain-v5/temporal/events", async (request, reply) => {
		try {
			if (!options?.getTemporalEngine) {
				return reply.code(503).send({ error: "Temporal engine not available" });
			}

			const engine = await options.getTemporalEngine();
			const body = request.body as {
				timestamp?: string;
				entityId?: string;
				entityType?: string;
				eventType: string;
				summary: string;
				evidence?: Array<{ type: string; ref: string; description: string }>;
				metadata?: Record<string, unknown>;
			};

			if (!body.eventType || !body.summary) {
				return reply.code(400).send({ error: "eventType and summary are required" });
			}

			const event = {
				timestamp: body.timestamp ?? new Date().toISOString(),
				entityId: body.entityId,
				entityType: body.entityType,
				eventType: body.eventType,
				summary: body.summary,
				evidence: body.evidence ?? [],
				metadata: body.metadata ?? {},
			};

			await engine.recordEvent(event as Parameters<typeof engine.recordEvent>[0]);

			return reply.code(201).send({ success: true, event });
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to record temporal event",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/temporal/events — Query temporal events
	fastify.get("/brain-v5/temporal/events", async (request, reply) => {
		try {
			if (!options?.getTemporalEngine) {
				return reply.code(503).send({ error: "Temporal engine not available" });
			}

			const engine = await options.getTemporalEngine();
			const query = request.query as {
				since?: string;
				until?: string;
				entityId?: string;
				eventTypes?: string;
				limit?: string;
				offset?: string;
			};

			const events = await engine.store.queryEvents({
				since: query.since,
				until: query.until,
				entityId: query.entityId,
				eventTypes: query.eventTypes?.split(","),
				limit: query.limit ? parseInt(query.limit, 10) : 100,
				offset: query.offset ? parseInt(query.offset, 10) : 0,
			});

			const total = await engine.store.countEvents({
				since: query.since,
				until: query.until,
				entityId: query.entityId,
				eventTypes: query.eventTypes?.split(","),
			});

			return { events, total };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to query temporal events",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/temporal/rollups — Query temporal rollups
	fastify.get("/brain-v5/temporal/rollups", async (request, reply) => {
		try {
			if (!options?.getTemporalEngine) {
				return reply.code(503).send({ error: "Temporal engine not available" });
			}

			const engine = await options.getTemporalEngine();
			const query = request.query as {
				period?: string;
				since?: string;
				until?: string;
				entityId?: string;
				limit?: string;
				offset?: string;
			};

			const rollups = await engine.store.queryRollups({
				period: query.period as "daily" | "weekly" | "monthly" | undefined,
				since: query.since,
				until: query.until,
				entityId: query.entityId,
				limit: query.limit ? parseInt(query.limit, 10) : 100,
				offset: query.offset ? parseInt(query.offset, 10) : 0,
			});

			return { rollups };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to query temporal rollups",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/temporal/rollups/generate — Generate a new rollup from source events
	fastify.post("/brain-v5/temporal/rollups/generate", async (request, reply) => {
		try {
			if (!options?.getTemporalEngine) {
				return reply.code(503).send({ error: "Temporal engine not available" });
			}

			const engine = await options.getTemporalEngine();
			const body = request.body as {
				period: string;
				periodStart: string;
				periodEnd: string;
				entityId?: string;
			};

			if (!body.period || !body.periodStart || !body.periodEnd) {
				return reply.code(400).send({ error: "period, periodStart, and periodEnd are required" });
			}

			if (!["daily", "weekly", "monthly"].includes(body.period)) {
				return reply.code(400).send({ error: "period must be 'daily', 'weekly', or 'monthly'" });
			}

			const rollup = await engine.generateAndStoreRollup(
				body.period,
				body.periodStart,
				body.periodEnd,
				body.entityId,
			);

			return reply.code(201).send({ rollup });
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to generate temporal rollup",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/temporal/stuck — Query "what got stuck?"
	fastify.get("/brain-v5/temporal/stuck", async (request, reply) => {
		try {
			if (!options?.getTemporalEngine) {
				return reply.code(503).send({ error: "Temporal engine not available" });
			}

			const engine = await options.getTemporalEngine();
			const query = request.query as {
				since?: string;
				until?: string;
				entityId?: string;
			};

			const since = query.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
			const until = query.until ?? new Date().toISOString();

			const result = await engine.queryStuckItems(since, until, query.entityId);
			return result;
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to query stuck items",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/temporal/stuck/last-week — Query "what got stuck last week?"
	fastify.get("/brain-v5/temporal/stuck/last-week", async (request, reply) => {
		try {
			if (!options?.getTemporalEngine) {
				return reply.code(503).send({ error: "Temporal engine not available" });
			}

			const engine = await options.getTemporalEngine();
			const query = request.query as { entityId?: string };
			const result = await engine.queryStuckLastWeek(query.entityId);

			return result;
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to query stuck items for last week",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/temporal/rollups/:id/regenerate — Regenerate and verify a rollup
	fastify.post("/brain-v5/temporal/rollups/:id/regenerate", async (request, reply) => {
		try {
			if (!options?.getTemporalEngine) {
				return reply.code(503).send({ error: "Temporal engine not available" });
			}

			const engine = await options.getTemporalEngine();
			const params = request.params as { id: string };

			const result = await engine.regenerateRollup(params.id);

			return {
				rollup: result.rollup,
				matchesOriginal: result.matchesOriginal,
				verificationPassed: result.matchesOriginal,
			};
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to regenerate rollup",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});
}
