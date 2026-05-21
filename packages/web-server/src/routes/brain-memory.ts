/**
 * Brain Memory API Routes — P14.F
 *
 * REST API for memory CRUD, correction workflow, and query operations.
 *
 * Endpoints:
 *   POST   /api/brain/memory              Create memory
 *   GET    /api/brain/memory              List with filters
 *   GET    /api/brain/memory/stats        Memory statistics
 *   GET    /api/brain/memory/:id          Get single memory
 *   PUT    /api/brain/memory/:id          Update memory
 *   DELETE /api/brain/memory/:id          Delete memory
 *   POST   /api/brain/memory/:id/reject   Reject memory
 *   POST   /api/brain/memory/:id/supersede Supersede with replacement
 *   POST   /api/brain/memory/:id/activate Activate memory
 *   POST   /api/brain/memory/:id/deactivate Deactivate memory
 *   POST   /api/brain/memory/:id/restore  Restore memory (from rejected/expired/superseded)
 *   GET    /api/brain/memory/corrections  Get correction audit records
 *
 * Dependencies: P14.B (MemoryStore), P14.C (MemoryLifecycleEngine), P14.F (MemoryCorrectionApi)
 *
 * Usage:
 * ```typescript
 * import { MemoryCorrectionApi, MemoryStore } from "@earendil-works/pi-coding-agent";
 * const store = new MemoryStore();
 * await store.initialize();
 * const api = new MemoryCorrectionApi(store);
 * registerBrainMemoryRoutes(fastify, api);
 * ```
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// API Interface (duck-typed to avoid direct dependency on coding-agent)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the Memory Correction API.
 *
 * The routes only depend on this interface, not on the concrete
 * MemoryCorrectionApi class from the coding-agent package.
 * This keeps the web-server free of a direct dependency on
 * the coding-agent package.
 */
export interface BrainMemoryApi {
	createMemory(input: Record<string, unknown>): Promise<unknown>;
	getMemory(id: string): Promise<unknown | null>;
	updateMemory(id: string, updates: Record<string, unknown>): Promise<unknown>;
	deleteMemory(id: string): Promise<void>;
	listMemories(query?: Record<string, unknown>): Promise<{ memories: unknown[]; total: number }>;
	getMemoryStats(): Promise<Record<string, unknown>>;
	rejectMemory(id: string, reason?: string, createdBy?: string): Promise<unknown>;
	supersedeMemory(
		id: string,
		replacement: Record<string, unknown>,
		reason?: string,
		createdBy?: string,
	): Promise<{ original: unknown; replacement: unknown }>;
	activateMemory(id: string, reason?: string): Promise<unknown>;
	deactivateMemory(id: string, reason?: string): Promise<unknown>;
	restoreMemory(id: string, reason?: string): Promise<unknown>;
	getCorrectionRecords(): unknown[];
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register brain memory API routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param api - A MemoryCorrectionApi-compatible object
 */
export async function registerBrainMemoryRoutes(fastify: FastifyInstance, api: BrainMemoryApi): Promise<void> {
	// -----------------------------------------------------------------------
	// POST /api/brain/memory — Create memory
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: Record<string, unknown>;
	}>("/api/brain/memory", async (request, reply) => {
		try {
			const memory = await api.createMemory(request.body);
			return reply.code(201).send({ success: true, memory });
		} catch (error) {
			fastify.log.error({ error }, "Failed to create memory");
			return reply.code(400).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to create memory",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/memory — List memories with filters
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: Record<string, string | undefined>;
	}>("/api/brain/memory", async (request, reply) => {
		try {
			const { types, lifecycle, tags, searchText, minConfidence, minRelevance, limit, offset, sortBy, sortOrder } =
				request.query;

			const query: Record<string, unknown> = {};

			if (types) {
				query.types = types.split(",");
			}
			if (lifecycle) {
				query.lifecycle = lifecycle.split(",");
			}
			if (tags) {
				query.tags = tags.split(",");
			}
			if (searchText) {
				query.searchText = searchText;
			}
			if (minConfidence !== undefined) {
				query.minConfidence = Number(minConfidence);
			}
			if (minRelevance !== undefined) {
				query.minRelevance = Number(minRelevance);
			}
			if (limit !== undefined) {
				query.limit = Math.min(Math.max(1, Number(limit)), 100);
			}
			if (offset !== undefined) {
				query.offset = Math.max(0, Number(offset));
			}
			if (sortBy) {
				query.sortBy = sortBy;
			}
			if (sortOrder) {
				query.sortOrder = sortOrder;
			}

			const result = await api.listMemories(query);
			return { success: true, memories: result.memories, total: result.total };
		} catch (error) {
			fastify.log.error({ error }, "Failed to list memories");
			return reply.code(400).send({
				success: false,
				memories: [],
				total: 0,
				error: error instanceof Error ? error.message : "Failed to list memories",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/memory/stats — Memory statistics
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/memory/stats", async (_request, reply) => {
		try {
			const stats = await api.getMemoryStats();
			return { success: true, stats };
		} catch (error) {
			fastify.log.error({ error }, "Failed to get memory stats");
			return reply.code(500).send({
				success: false,
				error: "Failed to get memory stats",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/memory/corrections — Correction audit records
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/memory/corrections", async (_request, reply) => {
		try {
			const corrections = api.getCorrectionRecords();
			return { success: true, corrections };
		} catch (error) {
			fastify.log.error({ error }, "Failed to get correction records");
			return reply.code(500).send({
				success: false,
				corrections: [],
				error: "Failed to get correction records",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/memory/:id — Get single memory
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/api/brain/memory/:id", async (request, reply) => {
		try {
			const memory = await api.getMemory(request.params.id);
			if (!memory) {
				return reply.code(404).send({ success: false, error: "Memory not found", memory: null });
			}
			return { success: true, memory };
		} catch (error) {
			fastify.log.error({ error }, "Failed to get memory");
			return reply.code(500).send({
				success: false,
				error: "Failed to get memory",
				memory: null,
			});
		}
	});

	// -----------------------------------------------------------------------
	// PUT /api/brain/memory/:id — Update memory
	// -----------------------------------------------------------------------

	fastify.put<{
		Params: { id: string };
		Body: Record<string, unknown>;
	}>("/api/brain/memory/:id", async (request, reply) => {
		try {
			const memory = await api.updateMemory(request.params.id, request.body);
			return { success: true, memory };
		} catch (error) {
			fastify.log.error({ error }, "Failed to update memory");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to update memory",
			});
		}
	});

	// -----------------------------------------------------------------------
	// DELETE /api/brain/memory/:id — Delete memory
	// -----------------------------------------------------------------------

	fastify.delete<{
		Params: { id: string };
	}>("/api/brain/memory/:id", async (request, reply) => {
		try {
			await api.deleteMemory(request.params.id);
			return { success: true };
		} catch (error) {
			fastify.log.error({ error }, "Failed to delete memory");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 500;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to delete memory",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/memory/:id/reject — Reject memory
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: { reason?: string; createdBy?: string };
	}>("/api/brain/memory/:id/reject", async (request, reply) => {
		try {
			const { reason, createdBy } = request.body;
			const memory = await api.rejectMemory(request.params.id, reason, createdBy);
			return { success: true, memory };
		} catch (error) {
			fastify.log.error({ error }, "Failed to reject memory");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to reject memory",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/memory/:id/supersede — Supersede with replacement
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			replacement: Record<string, unknown>;
			reason?: string;
			createdBy?: string;
		};
	}>("/api/brain/memory/:id/supersede", async (request, reply) => {
		try {
			const { replacement, reason, createdBy } = request.body;
			const result = await api.supersedeMemory(request.params.id, replacement, reason, createdBy);
			return { success: true, ...result };
		} catch (error) {
			fastify.log.error({ error }, "Failed to supersede memory");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to supersede memory",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/memory/:id/activate — Activate memory
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: { reason?: string };
	}>("/api/brain/memory/:id/activate", async (request, reply) => {
		try {
			const memory = await api.activateMemory(request.params.id, request.body.reason);
			return { success: true, memory };
		} catch (error) {
			fastify.log.error({ error }, "Failed to activate memory");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to activate memory",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/memory/:id/deactivate — Deactivate memory
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: { reason?: string };
	}>("/api/brain/memory/:id/deactivate", async (request, reply) => {
		try {
			const memory = await api.deactivateMemory(request.params.id, request.body.reason);
			return { success: true, memory };
		} catch (error) {
			fastify.log.error({ error }, "Failed to deactivate memory");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to deactivate memory",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/memory/:id/restore — Restore memory
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: { reason?: string };
	}>("/api/brain/memory/:id/restore", async (request, reply) => {
		try {
			const memory = await api.restoreMemory(request.params.id, request.body.reason);
			return { success: true, memory };
		} catch (error) {
			fastify.log.error({ error }, "Failed to restore memory");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to restore memory",
			});
		}
	});
}
