/**
 * Memory routes — P14 memory CRUD endpoints for the Brain API client
 *
 * Routes use relative paths so they can be registered under any prefix.
 */

import type { FastifyInstance } from "fastify";

export async function registerBrainMemoryRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /memories - List memories
	fastify.get<{
		Querystring: {
			limit?: string;
			offset?: string;
			search?: string;
			type?: string;
			lifecycle?: string;
			tags?: string;
		};
	}>("/memories", async (request, _reply) => {
		try {
			const { getMemories } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const limit = Number(request.query.limit) || 20;
			const offset = Number(request.query.offset) || 0;
			const result = await getMemories(
				{
					limit,
					offset,
					search: request.query.search,
					type: request.query.type,
					lifecycle: request.query.lifecycle,
					tags: request.query.tags?.split(",").filter(Boolean),
				},
				projectId,
			);
			return result;
		} catch {
			return { memories: [], total: 0 };
		}
	});

	// GET /memories/stats - Memory stats
	fastify.get("/memories/stats", async (request) => {
		try {
			const { getMemoryStats } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await getMemoryStats(projectId);
		} catch {
			return { total: 0, byType: {}, byLifecycle: {}, averageConfidence: 0 };
		}
	});

	// GET /memories/:id - Get single memory
	fastify.get<{ Params: { id: string } }>("/memories/:id", async (request, reply) => {
		try {
			const { getMemory } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const memory = await getMemory(request.params.id, projectId);
			if (!memory) return reply.code(404).send({ error: "Memory not found" });
			return memory;
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});

	// POST /memories - Create memory
	fastify.post<{ Body: { title: string; content: string; type?: string; tags?: string[]; confidence?: number } }>(
		"/memories",
		async (request, reply) => {
			try {
				const { createMemory } = await import("@earendil-works/pi-coding-agent");
				const { projectId } = request.params as { projectId?: string };
				const memory = await createMemory(request.body, projectId);
				return reply.code(201).send(memory);
			} catch (error) {
				return reply.code(500).send({ error: "Failed to create memory", message: String(error) });
			}
		},
	);

	// PATCH /memories/:id - Update memory
	fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/memories/:id", async (request, reply) => {
		try {
			const { updateMemory } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			const memory = await updateMemory(request.params.id, request.body, projectId);
			return memory;
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});

	// DELETE /memories/:id - Delete memory
	fastify.delete<{ Params: { id: string } }>("/memories/:id", async (request, reply) => {
		try {
			const { deleteMemory } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			await deleteMemory(request.params.id, projectId);
			return reply.code(204).send();
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});

	// POST /memories/:id/reject - Reject memory
	fastify.post<{ Params: { id: string } }>("/memories/:id/reject", async (request, reply) => {
		try {
			const { rejectMemory } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await rejectMemory(request.params.id, projectId);
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});

	// POST /memories/:id/activate - Activate memory
	fastify.post<{ Params: { id: string } }>("/memories/:id/activate", async (request, reply) => {
		try {
			const { activateMemory } = await import("@earendil-works/pi-coding-agent");
			const { projectId } = request.params as { projectId?: string };
			return await activateMemory(request.params.id, projectId);
		} catch {
			return reply.code(404).send({ error: "Memory not found" });
		}
	});
}
