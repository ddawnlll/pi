/**
 * Brain Reflection API Routes — P17.G
 *
 * REST API for listing, reading, and extracting data from reflection reports.
 *
 * Endpoints:
 *   GET    /api/brain/reflections              List reflections (query: planExecId, planTitle, limit, offset, since, until)
 *   GET    /api/brain/reflections/stats        Reflection aggregate statistics
 *   GET    /api/brain/reflections/:planExecId  Get single reflection detail
 *   POST   /api/brain/reflections/:planExecId/generate  Generate/regenerate a reflection
 *   GET    /api/brain/reflections/:planExecId/memories  Get memory proposals from a reflection
 *   GET    /api/brain/reflections/:planExecId/future    Get future suggestions from a reflection
 *
 * All list endpoints return { success: true, ... } format.
 * Errors return { success: false, error: "..." }.
 *
 * @packageDocumentation
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// API Interface (duck-typed to avoid direct dependency on coding-agent)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the Brain Reflection API.
 *
 * The routes only depend on this interface, not on the concrete
 * BrainReflectionApi class from the coding-agent package.
 * This keeps the web-server free of a direct dependency on
 * the coding-agent package.
 */
export interface BrainReflectionApiLike {
	listReflections(query?: {
		planExecId?: string;
		planTitle?: string;
		limit?: number;
		offset?: number;
		since?: string;
		until?: string;
	}): Promise<{
		reflections: unknown[];
		total: number;
	}>;

	getReflection(planExecId: string): Promise<unknown | null>;

	generateReflection(
		input: any,
		options?: { force?: boolean },
	): Promise<{
		success: boolean;
		report?: unknown;
		error?: string;
		regenerated?: boolean;
	}>;

	getStats(): Promise<{
		total: number;
		byPlan: Record<string, number>;
		avgConfidence: number;
	}>;

	getMemories(planExecId: string): Promise<{ memories: unknown[] } | null>;

	getFuture(planExecId: string): Promise<{ suggestions: unknown[] } | null>;
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * Register brain reflection API routes on the Fastify instance.
 *
 * NOTE: The `/stats` route MUST be registered BEFORE the `/:planExecId` route
 * to avoid Fastify interpreting "stats" as a planExecId parameter.
 *
 * @param fastify - The Fastify server instance
 * @param api - A BrainReflectionApiLike-compatible object
 */
export async function registerBrainReflectionRoutes(
	fastify: FastifyInstance,
	api: BrainReflectionApiLike,
): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /api/brain/reflections — List reflections
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			planExecId?: string;
			planTitle?: string;
			limit?: number;
			offset?: number;
			since?: string;
			until?: string;
		};
	}>("/api/brain/reflections", async (request, reply) => {
		try {
			const { query } = request;
			const result = await api.listReflections({
				planExecId: query.planExecId,
				planTitle: query.planTitle,
				limit: query.limit ? Math.min(Math.max(query.limit, 1), 1000) : undefined,
				offset: query.offset ? Math.max(query.offset, 0) : undefined,
				since: query.since,
				until: query.until,
			});

			return reply.send({
				success: true,
				reflections: result.reflections,
				total: result.total,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list reflections");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to list reflections",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/reflections/stats — Reflection aggregate statistics
	//
	// NOTE: This MUST be registered BEFORE the /:planExecId route to avoid
	// Fastify interpreting "stats" as a planExecId parameter.
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/reflections/stats", async (_request, reply) => {
		try {
			const stats = await api.getStats();
			return reply.send({
				success: true,
				stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get reflection stats");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get reflection stats",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/reflections/:planExecId — Get single reflection detail
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { planExecId: string };
	}>("/api/brain/reflections/:planExecId", async (request, reply) => {
		try {
			const { planExecId } = request.params;
			const report = await api.getReflection(planExecId);

			if (!report) {
				return reply.code(404).send({
					success: false,
					error: `Reflection not found for plan execution "${planExecId}"`,
				});
			}

			return reply.send({
				success: true,
				reflection: report,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get reflection");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get reflection",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/reflections/:planExecId/generate — Generate/regenerate
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { planExecId: string };
		Body: {
			force?: boolean;
			input?: Record<string, unknown>;
		};
	}>("/api/brain/reflections/:planExecId/generate", async (request, reply) => {
		try {
			const { planExecId } = request.params;
			const { force, input: rawInput } = request.body ?? {};

			// Build the reflection input. The caller must provide execution data,
			// either as a complete ReflectionInput object or it will be looked up
			// from stored plan execution state.
			if (!rawInput || Object.keys(rawInput).length === 0) {
				return reply.code(400).send({
					success: false,
					error:
						"Reflection input is required. Provide execution data in the 'input' field " +
						"with planExecId, executionJournal, workspaceOutcomes, and validationResults.",
				});
			}

			const reflectionInput = {
				...rawInput,
				planExecId: rawInput.planExecId ?? planExecId,
			};

			const result = await api.generateReflection(reflectionInput, { force });

			if (!result.success) {
				return reply.code(500).send({
					success: false,
					error: result.error ?? "Failed to generate reflection",
				});
			}

			const statusCode = result.regenerated ? 200 : 201;
			return reply.code(statusCode).send({
				success: true,
				reflection: result.report,
				regenerated: result.regenerated,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to generate reflection");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to generate reflection",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/reflections/:planExecId/memories — Get memory proposals
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { planExecId: string };
	}>("/api/brain/reflections/:planExecId/memories", async (request, reply) => {
		try {
			const { planExecId } = request.params;
			const result = await api.getMemories(planExecId);

			if (!result) {
				return reply.code(404).send({
					success: false,
					error: `Reflection not found for plan execution "${planExecId}"`,
				});
			}

			return reply.send({
				success: true,
				memories: result.memories,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get memory proposals");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get memory proposals",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/reflections/:planExecId/future — Get future suggestions
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { planExecId: string };
	}>("/api/brain/reflections/:planExecId/future", async (request, reply) => {
		try {
			const { planExecId } = request.params;
			const result = await api.getFuture(planExecId);

			if (!result) {
				return reply.code(404).send({
					success: false,
					error: `Reflection not found for plan execution "${planExecId}"`,
				});
			}

			return reply.send({
				success: true,
				suggestions: result.suggestions,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get future suggestions");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get future suggestions",
			});
		}
	});
}
