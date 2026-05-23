/**
 * Memory routes — P14 memory CRUD endpoints for the Brain API client
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainMemoryRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /api/brain/memories - List memories
	fastify.get<{
		Querystring: {
			limit?: string;
			offset?: string;
			search?: string;
			type?: string;
			lifecycle?: string;
			tags?: string;
		};
	}>("/api/brain/memories", async (request, _reply) => {
		try {
			const { getMemories } = await import("@earendil-works/pi-coding-agent");
			const limit = Number(request.query.limit) || 20;
			const offset = Number(request.query.offset) || 0;
			const result = await getMemories({
				limit,
				offset,
				search: request.query.search,
				type: request.query.type,
				lifecycle: request.query.lifecycle,
				tags: request.query.tags?.split(",").filter(Boolean),
			});
			return result;
		} catch {
			return { memories: [], total: 0 };
		}
	});

	// GET /api/brain/memories/stats - Memory stats
	fastify.get("/api/brain/memories/stats", async () => {
		try {
			const { getMemoryStats } = await import("@earendil-works/pi-coding-agent");
			return await getMemoryStats();
		} catch {
			return { total: 0, byType: {}, byLifecycle: {}, averageConfidence: 0 };
		}
	});

	// GET /api/brain/memories/:id - Get single memory
	fastify.get<{ Params: { id: string } }>("/api/brain/memories/:id", async (request, reply) => {
		try {
			const { getMemory } = await import("@earendil-works/pi-coding-agent");
			const memory = await getMemory(request.params.id);
			if (!memory) return reply.code(404).send({ error: "Memory not found" });
			return memory;
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});

	// POST /api/brain/memories - Create memory
	fastify.post<{ Body: { title: string; content: string; type?: string; tags?: string[]; confidence?: number } }>(
		"/api/brain/memories",
		async (request, reply) => {
			try {
				const { createMemory } = await import("@earendil-works/pi-coding-agent");
				const memory = await createMemory(request.body);
				return reply.code(201).send(memory);
			} catch (error) {
				return reply.code(500).send({ error: "Failed to create memory", message: String(error) });
			}
		},
	);

	// PATCH /api/brain/memories/:id - Update memory
	fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
		"/api/brain/memories/:id",
		async (request, reply) => {
			try {
				const { updateMemory } = await import("@earendil-works/pi-coding-agent");
				const memory = await updateMemory(request.params.id, request.body);
				return memory;
			} catch {
				return reply.code(404).send({ error: "Memory not found" });
			}
		},
	);

	// DELETE /api/brain/memories/:id - Delete memory
	fastify.delete<{ Params: { id: string } }>("/api/brain/memories/:id", async (request, reply) => {
		try {
			const { deleteMemory } = await import("@earendil-works/pi-coding-agent");
			await deleteMemory(request.params.id);
			return reply.code(204).send();
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});

	// POST /api/brain/memories/:id/reject - Reject memory
	fastify.post<{ Params: { id: string } }>("/api/brain/memories/:id/reject", async (request, reply) => {
		try {
			const { rejectMemory } = await import("@earendil-works/pi-coding-agent");
			return await rejectMemory(request.params.id);
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});

	// POST /api/brain/memories/:id/activate - Activate memory
	fastify.post<{ Params: { id: string } }>("/api/brain/memories/:id/activate", async (request, reply) => {
		try {
			const { activateMemory } = await import("@earendil-works/pi-coding-agent");
			return await activateMemory(request.params.id);
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});
}
