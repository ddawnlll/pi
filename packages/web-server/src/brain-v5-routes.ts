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

interface ProposalActionResult {
	success: boolean;
	proposal: unknown;
	message: string;
}

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

	/** Optional provider for the Evidence Index API (V5.02). */
	getEvidenceApi?: () => Promise<{
		registerEvidence: (
			type: string,
			id: string,
			label: string,
			description: string,
			confidence: number,
			content?: string,
		) => Promise<{
			type: string;
			id: string;
			label: string;
			description: string;
			timestamp: string;
			confidence: number;
		}>;
		registerBatch: (sources: unknown[]) => Promise<unknown[]>;
		query: (query: {
			types?: string[];
			search?: string;
			minConfidence?: number;
			createdAfter?: string;
			createdBefore?: string;
			limit?: number;
			offset?: number;
			sortBy?: string;
			sortOrder?: string;
		}) => Promise<{ items: unknown[]; total: number }>;
		resolve: (refs: unknown[]) => Promise<unknown[]>;
		assess: (refs: unknown[]) => Promise<unknown>;
		stats: () => Promise<unknown>;
	}>;

	/** Optional provider for the Reflection API v2 (V5.10). */
	getReflectionApi?: () => Promise<{
		getReflection: (planExecId: string) => Promise<unknown | null>;
		getClaims: (planExecId: string) => Promise<{ claims: unknown[] } | null>;
		correctClaim: (
			planExecId: string,
			claimId: string,
			correctedValue: string,
			reason: string,
			correctedBy?: string,
			sourceRefs?: unknown[],
		) => Promise<{ success: boolean; report?: unknown; entry?: unknown; error?: string }>;
		correctSummary: (
			planExecId: string,
			correctedSummary: string,
			reason: string,
			correctedBy?: string,
		) => Promise<{ success: boolean; report?: unknown; entry?: unknown; error?: string }>;
		correctConfidence: (
			planExecId: string,
			correctedConfidence: number,
			reason: string,
			correctedBy?: string,
		) => Promise<{ success: boolean; report?: unknown; entry?: unknown; error?: string }>;
		rejectClaim: (
			planExecId: string,
			claimId: string,
			reason: string,
			rejectedBy?: string,
		) => Promise<{ success: boolean; entry?: unknown; error?: string }>;
		rejectReport: (
			planExecId: string,
			reason: string,
			rejectedBy?: string,
		) => Promise<{ success: boolean; entry?: unknown; error?: string }>;
		getAuditTrail: (planExecId: string) => Promise<{ entries: unknown[]; total: number }>;
		listAuditEntries: (limit?: number, offset?: number) => Promise<{ entries: unknown[]; total: number }>;
		registerClaimsAsEvidence: (
			planExecId: string,
			evidenceApi: {
				registerEvidence: (
					type: string,
					id: string,
					label: string,
					description: string,
					confidence: number,
					content?: string,
				) => Promise<unknown>;
				registerBatch: (sources: unknown[]) => Promise<unknown[]>;
				query: (query: {
					types?: string[];
					search?: string;
					minConfidence?: number;
					createdAfter?: string;
					createdBefore?: string;
				}) => Promise<{ items: unknown[]; total: number }>;
			},
		) => Promise<unknown[] | null>;
	}>;

	/** Optional provider for the Proposal Engine v2 API (V5.08). */
	getProposalApi?: () => Promise<{
		listProposals: (query?: {
			status?: string[];
			type?: string[];
			minScore?: number;
			maxScore?: number;
			tag?: string;
			limit?: number;
			offset?: number;
			sortBy?: string;
			sortOrder?: string;
		}) => Promise<unknown[]>;
		getProposal: (id: string) => Promise<unknown | null>;
		createProposal: (input: unknown) => Promise<{
			success: boolean;
			proposal?: unknown;
			error?: string;
			isDuplicate?: boolean;
			duplicateReason?: string;
			isInCooldown?: boolean;
			cooldownRemainingHours?: number;
		}>;
		updateProposal: (id: string, input: unknown) => Promise<unknown | null>;
		deleteProposal: (id: string) => Promise<boolean>;
		acceptProposal: (id: string, approvedBy?: string) => Promise<unknown>;
		rejectProposal: (id: string, rejectedBy?: string, reason?: string) => Promise<unknown>;
		markExecutionReady: (id: string, approvedBy?: string) => Promise<unknown>;
		correctProposal: (id: string, corrections: unknown) => Promise<unknown>;
		expireProposal: (id: string) => Promise<unknown>;
		getInbox: () => Promise<unknown>;
		getInboxStats: () => Promise<unknown>;
		getEvidence: (id: string) => Promise<unknown | null>;
		getStats: () => Promise<unknown>;
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

	// =========================================================================
	// Evidence Index Routes (V5.02)
	// =========================================================================

	// POST /brain-v5/evidence/register — Register evidence sources
	fastify.post("/brain-v5/evidence/register", async (request, reply) => {
		try {
			if (!options?.getEvidenceApi) {
				return reply.code(503).send({ error: "Evidence API not available" });
			}

			const api = await options.getEvidenceApi();
			const body = request.body as {
				type: string;
				id?: string;
				label: string;
				description: string;
				confidence?: number;
				content?: string;
			};

			if (!body.type || !body.label || !body.description) {
				return reply.code(400).send({ error: "type, label, and description are required" });
			}

			const ref = await api.registerEvidence(
				body.type,
				body.id ?? body.label.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase(),
				body.label,
				body.description,
				body.confidence ?? 0.5,
				body.content,
			);

			return reply.code(201).send({ success: true, ref });
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to register evidence",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/evidence/register-batch — Register multiple evidence sources
	fastify.post("/brain-v5/evidence/register-batch", async (request, reply) => {
		try {
			if (!options?.getEvidenceApi) {
				return reply.code(503).send({ error: "Evidence API not available" });
			}

			const api = await options.getEvidenceApi();
			const body = request.body as { sources: unknown[] };

			if (!body.sources || !Array.isArray(body.sources) || body.sources.length === 0) {
				return reply.code(400).send({ error: "sources array is required and must be non-empty" });
			}

			const refs = await api.registerBatch(body.sources);
			return reply.code(201).send({ success: true, count: refs.length, refs });
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to register evidence batch",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/evidence/query — Query evidence
	fastify.get("/brain-v5/evidence/query", async (request, reply) => {
		try {
			if (!options?.getEvidenceApi) {
				return reply.code(503).send({ error: "Evidence API not available" });
			}

			const api = await options.getEvidenceApi();
			const query = request.query as {
				types?: string;
				search?: string;
				minConfidence?: string;
				createdAfter?: string;
				createdBefore?: string;
				limit?: string;
				offset?: string;
				sortBy?: string;
				sortOrder?: string;
			};

			const result = await api.query({
				types: query.types?.split(",") as string[] | undefined,
				search: query.search,
				minConfidence: query.minConfidence ? parseFloat(query.minConfidence) : undefined,
				createdAfter: query.createdAfter,
				createdBefore: query.createdBefore,
				limit: query.limit ? parseInt(query.limit, 10) : 50,
				offset: query.offset ? parseInt(query.offset, 10) : 0,
				sortBy: query.sortBy as "timestamp" | "confidence" | "label" | undefined,
				sortOrder: query.sortOrder as "asc" | "desc" | undefined,
			});

			return result;
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to query evidence",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/evidence/resolve — Resolve evidence refs to content
	fastify.post("/brain-v5/evidence/resolve", async (request, reply) => {
		try {
			if (!options?.getEvidenceApi) {
				return reply.code(503).send({ error: "Evidence API not available" });
			}

			const api = await options.getEvidenceApi();
			const body = request.body as { refs: unknown[] };

			if (!body.refs || !Array.isArray(body.refs) || body.refs.length === 0) {
				return reply.code(400).send({ error: "refs array is required and must be non-empty" });
			}

			const resolutions = await api.resolve(body.refs);
			return { resolutions };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to resolve evidence",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/evidence/assess — Assess confidence for evidence refs
	fastify.post("/brain-v5/evidence/assess", async (request, reply) => {
		try {
			if (!options?.getEvidenceApi) {
				return reply.code(503).send({ error: "Evidence API not available" });
			}

			const api = await options.getEvidenceApi();
			const body = request.body as { refs: unknown[] };

			if (!body.refs || !Array.isArray(body.refs) || body.refs.length === 0) {
				return reply.code(400).send({ error: "refs array is required and must be non-empty" });
			}

			const assessment = await api.assess(body.refs);
			return { assessment };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to assess evidence",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/evidence/stats — Evidence index statistics
	fastify.get("/brain-v5/evidence/stats", async (_request, reply) => {
		try {
			if (!options?.getEvidenceApi) {
				return reply.code(503).send({ error: "Evidence API not available" });
			}

			const api = await options.getEvidenceApi();
			const stats = await api.stats();
			return { stats };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get evidence stats",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// =========================================================================
	// Proposal Engine v2 Routes (V5.08)
	// =========================================================================

	// GET /brain-v5/proposals — List proposals with optional filters
	fastify.get("/brain-v5/proposals", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const query = request.query as {
				status?: string;
				type?: string;
				minScore?: string;
				maxScore?: string;
				tag?: string;
				limit?: string;
				offset?: string;
				sortBy?: string;
				sortOrder?: string;
			};

			const proposals = await api.listProposals({
				status: query.status?.split(",") as string[] | undefined,
				type: query.type?.split(",") as string[] | undefined,
				minScore: query.minScore ? parseFloat(query.minScore) : undefined,
				maxScore: query.maxScore ? parseFloat(query.maxScore) : undefined,
				tag: query.tag,
				limit: query.limit ? parseInt(query.limit, 10) : 50,
				offset: query.offset ? parseInt(query.offset, 10) : 0,
			} as Record<string, unknown>);

			return { proposals };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to list proposals",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/proposals/:id — Get a single proposal
	fastify.get("/brain-v5/proposals/:id", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const params = request.params as { id: string };
			const proposal = await api.getProposal(params.id);

			if (!proposal) {
				return reply.code(404).send({ error: "Proposal not found" });
			}

			return { proposal };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get proposal",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/proposals — Create a new proposal (advisory only, V5.08 AC4)
	fastify.post("/brain-v5/proposals", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const body = request.body as Record<string, unknown>;

			if (!body.type || !body.title || !body.description) {
				return reply.code(400).send({ error: "type, title, and description are required" });
			}

			const result = await api.createProposal(body);

			if (!result.success) {
				return reply.code(400).send({
					error: result.error ?? "Failed to create proposal",
					isDuplicate: result.isDuplicate,
					duplicateReason: result.duplicateReason,
					isInCooldown: result.isInCooldown,
					cooldownRemainingHours: result.cooldownRemainingHours,
				});
			}

			return reply.code(201).send({ success: true, proposal: result.proposal });
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to create proposal",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// PATCH /brain-v5/proposals/:id — Update a proposal
	fastify.patch("/brain-v5/proposals/:id", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const params = request.params as { id: string };
			const body = request.body as Record<string, unknown>;

			const proposal = await api.updateProposal(params.id, body);

			if (!proposal) {
				return reply.code(404).send({ error: "Proposal not found" });
			}

			return { proposal };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to update proposal",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// DELETE /brain-v5/proposals/:id — Delete a proposal
	fastify.delete("/brain-v5/proposals/:id", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const params = request.params as { id: string };
			const deleted = await api.deleteProposal(params.id);

			if (!deleted) {
				return reply.code(404).send({ error: "Proposal not found" });
			}

			return { success: true };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to delete proposal",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/proposals/:id/accept — Accept/approve a proposal (V5.08 AC2 gate)
	fastify.post("/brain-v5/proposals/:id/accept", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const params = request.params as { id: string };
			const body = request.body as { approvedBy?: string };

			const result = await api.acceptProposal(params.id, body.approvedBy ?? "user");

			if (!(result as ProposalActionResult).success) {
				return reply.code(400).send({
					error: (result as ProposalActionResult).message,
				});
			}

			return { success: true, proposal: (result as ProposalActionResult).proposal, message: (result as ProposalActionResult).message };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to accept proposal",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/proposals/:id/reject — Reject a proposal
	fastify.post("/brain-v5/proposals/:id/reject", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const params = request.params as { id: string };
			const body = request.body as { rejectedBy?: string; reason?: string };

			const result = await api.rejectProposal(params.id, body.rejectedBy ?? "user", body.reason);

			if (!(result as ProposalActionResult).success) {
				return reply.code(400).send({
					error: (result as ProposalActionResult).message,
				});
			}

			return { success: true, proposal: (result as ProposalActionResult).proposal, message: (result as ProposalActionResult).message };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to reject proposal",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/proposals/:id/execution-ready — Mark a proposal execution-ready (V5.08 AC2 gate)
	fastify.post("/brain-v5/proposals/:id/execution-ready", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const params = request.params as { id: string };
			const body = request.body as { approvedBy?: string };

			const result = await api.markExecutionReady(params.id, body.approvedBy ?? "user");

			if (!(result as ProposalActionResult).success) {
				return reply.code(400).send({
					error: (result as ProposalActionResult).message,
				});
			}

			return { success: true, proposal: (result as ProposalActionResult).proposal, message: (result as ProposalActionResult).message };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to mark proposal execution-ready",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/proposals/inbox — Get proposal inbox (V5.08 AC1 cards)
	fastify.get("/brain-v5/proposals/inbox", async (_request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const inbox = await api.getInbox();

			return { inbox };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get proposal inbox",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/proposals/evidence/:id — Get evidence for a proposal (V5.08 AC1)
	fastify.get("/brain-v5/proposals/evidence/:id", async (request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const params = request.params as { id: string };
			const evidence = await api.getEvidence(params.id);

			if (!evidence) {
				return reply.code(404).send({ error: "Proposal not found" });
			}

			return { evidence };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get proposal evidence",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/proposals/stats — Get proposal statistics
	fastify.get("/brain-v5/proposals/stats", async (_request, reply) => {
		try {
			if (!options?.getProposalApi) {
				return reply.code(503).send({ error: "Proposal API not available" });
			}

			const api = await options.getProposalApi();
			const stats = await api.getStats();

			return { stats };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get proposal stats",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// =========================================================================
	// Reflection V2 Routes (V5.10 — Reflection Loop v2)
	// =========================================================================

	// GET /brain-v5/reflection/:planExecId/claims — Get evidence-backed claims (AC1/AC2)
	fastify.get("/brain-v5/reflection/:planExecId/claims", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const params = request.params as { planExecId: string };

			const result = await api.getClaims(params.planExecId);
			if (!result) {
				return reply.code(404).send({ error: "Reflection not found" });
			}

			return { claims: result.claims };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get reflection claims",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/reflection/:planExecId/correct-claim — Correct a claim (AC3)
	fastify.post("/brain-v5/reflection/:planExecId/correct-claim", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const params = request.params as { planExecId: string };
			const body = request.body as {
				claimId: string;
				correctedValue: string;
				reason: string;
				correctedBy?: string;
				sourceRefs?: unknown[];
			};

			if (!body.claimId || !body.correctedValue || !body.reason) {
				return reply.code(400).send({ error: "claimId, correctedValue, and reason are required" });
			}

			const result = await api.correctClaim(
				params.planExecId,
				body.claimId,
				body.correctedValue,
				body.reason,
				body.correctedBy,
				body.sourceRefs,
			);

			if (!result.success) {
				return reply.code(400).send({ error: result.error });
			}

			return { success: true, entry: result.entry };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to correct claim",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/reflection/:planExecId/correct-summary — Correct the summary (AC3)
	fastify.post("/brain-v5/reflection/:planExecId/correct-summary", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const params = request.params as { planExecId: string };
			const body = request.body as {
				correctedSummary: string;
				reason: string;
				correctedBy?: string;
			};

			if (!body.correctedSummary || !body.reason) {
				return reply.code(400).send({ error: "correctedSummary and reason are required" });
			}

			const result = await api.correctSummary(
				params.planExecId,
				body.correctedSummary,
				body.reason,
				body.correctedBy,
			);

			if (!result.success) {
				return reply.code(400).send({ error: result.error });
			}

			return { success: true, entry: result.entry };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to correct summary",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/reflection/:planExecId/correct-confidence — Correct the confidence (AC3)
	fastify.post("/brain-v5/reflection/:planExecId/correct-confidence", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const params = request.params as { planExecId: string };
			const body = request.body as {
				correctedConfidence: number;
				reason: string;
				correctedBy?: string;
			};

			if (body.correctedConfidence === undefined || !body.reason) {
				return reply.code(400).send({ error: "correctedConfidence and reason are required" });
			}

			const result = await api.correctConfidence(
				params.planExecId,
				body.correctedConfidence,
				body.reason,
				body.correctedBy,
			);

			if (!result.success) {
				return reply.code(400).send({ error: result.error });
			}

			return { success: true, entry: result.entry };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to correct confidence",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/reflection/:planExecId/reject-claim — Reject a claim (AC3)
	fastify.post("/brain-v5/reflection/:planExecId/reject-claim", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const params = request.params as { planExecId: string };
			const body = request.body as {
				claimId: string;
				reason: string;
				rejectedBy?: string;
			};

			if (!body.claimId || !body.reason) {
				return reply.code(400).send({ error: "claimId and reason are required" });
			}

			const result = await api.rejectClaim(params.planExecId, body.claimId, body.reason, body.rejectedBy);

			if (!result.success) {
				return reply.code(400).send({ error: result.error });
			}

			return { success: true, entry: result.entry };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to reject claim",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/reflection/:planExecId/reject — Reject the entire report (AC3)
	fastify.post("/brain-v5/reflection/:planExecId/reject", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const params = request.params as { planExecId: string };
			const body = request.body as {
				reason: string;
				rejectedBy?: string;
			};

			if (!body.reason) {
				return reply.code(400).send({ error: "reason is required" });
			}

			const result = await api.rejectReport(params.planExecId, body.reason, body.rejectedBy);

			if (!result.success) {
				return reply.code(400).send({ error: result.error });
			}

			return { success: true, entry: result.entry };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to reject report",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/reflection/:planExecId/audit — Get audit trail (AC3)
	fastify.get("/brain-v5/reflection/:planExecId/audit", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const params = request.params as { planExecId: string };

			const result = await api.getAuditTrail(params.planExecId);
			return { entries: result.entries, total: result.total };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to get audit trail",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// GET /brain-v5/reflection/audit — List all audit entries
	fastify.get("/brain-v5/reflection/audit", async (request, reply) => {
		try {
			if (!options?.getReflectionApi) {
				return reply.code(503).send({ error: "Reflection API not available" });
			}

			const api = await options.getReflectionApi();
			const query = request.query as { limit?: string; offset?: string };

			const limit = query.limit ? parseInt(query.limit, 10) : 100;
			const offset = query.offset ? parseInt(query.offset, 10) : 0;

			const result = await api.listAuditEntries(limit, offset);
			return { entries: result.entries, total: result.total };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to list audit entries",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	// POST /brain-v5/reflection/:planExecId/register-evidence — Register claims as evidence (AC2)
	fastify.post("/brain-v5/reflection/:planExecId/register-evidence", async (request, reply) => {
		try {
			if (!options?.getReflectionApi || !options?.getEvidenceApi) {
				return reply.code(503).send({ error: "Reflection API or Evidence API not available" });
			}

			const reflectionApi = await options.getReflectionApi();
			const evidenceApi = await options.getEvidenceApi();
			const params = request.params as { planExecId: string };

			const refs = await reflectionApi.registerClaimsAsEvidence(params.planExecId, evidenceApi);

			if (!refs) {
				return reply.code(404).send({ error: "Reflection not found" });
			}

			return { success: true, refs };
		} catch (error) {
			return reply.code(500).send({
				error: "Failed to register claims as evidence",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});
}
