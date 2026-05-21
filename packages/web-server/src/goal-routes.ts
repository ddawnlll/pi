/**
 * Goal Routes — REST API for the Goal Board (P15.G).
 *
 * Provides CRUD endpoints for goals, goal statistics, and drift reports.
 * Backed by the GoalStore from @earendil-works/pi-coding-agent.
 *
 * Endpoints:
 *   GET    /api/brain/goals         List goals with optional filters
 *   GET    /api/brain/goals/stats   Get goal statistics
 *   GET    /api/brain/goals/drift   Get drift reports
 *   GET    /api/brain/goals/:id     Get a single goal by ID
 *   POST   /api/brain/goals         Create a new goal
 *   PUT    /api/brain/goals/:id     Update an existing goal
 *   DELETE /api/brain/goals/:id     Delete a goal
 *
 * Dependencies: P15.B (GoalStore), P15.A (types)
 *
 * Usage:
 * ```typescript
 * import { GoalStore } from "@earendil-works/pi-coding-agent";
 * const store = new GoalStore({ basePath: "<path>/brain/goals" });
 * await store.initialize();
 * registerGoalRoutes(fastify, store);
 * ```
 */

import type { FastifyInstance } from "fastify";

/**
 * Minimal duck-typed interface for GoalStore operations needed by these routes.
 *
 * This avoids a direct compile-time dependency on the coding-agent package.
 */
export interface GoalStoreApi {
	initialize(): Promise<void>;

	createGoal(goal: {
		id: string;
		title: string;
		description: string;
		priority: "critical" | "high" | "normal" | "low";
		status: "active" | "completed" | "paused" | "cancelled" | "needs_review";
		category: string;
		milestones: Array<{
			id: string;
			title: string;
			description?: string;
			completed: boolean;
			completedAt?: string;
			createdAt: string;
			order: number;
		}>;
		createdAt: string;
		updatedAt: string;
		targetDate?: string;
		completedAt?: string;
		relatedMemoryIds: string[];
		metadata: Record<string, unknown>;
	}): Promise<unknown>;

	getGoal(id: string): Promise<unknown | null>;

	updateGoal(id: string, updates: Record<string, unknown>): Promise<unknown>;

	deleteGoal(id: string): Promise<void>;

	listGoals(filters?: { status?: string; priority?: string; category?: string }): Promise<unknown[]>;

	listDriftReports(goalId?: string): Promise<unknown[]>;

	getStats(): Promise<{
		totalGoals: number;
		activeGoals: number;
		completedGoals: number;
		byStatus: Record<string, number>;
		byPriority: Record<string, number>;
		driftReports: number;
		openDriftReports: number;
	}>;
}

/**
 * Register goal CRUD routes on the Fastify instance.
 *
 * @param fastify - Fastify instance
 * @param store - A GoalStoreApi-compatible object
 */
export async function registerGoalRoutes(fastify: FastifyInstance, store: GoalStoreApi): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /api/brain/goals — List goals with optional filters
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			status?: string;
			priority?: string;
			category?: string;
		};
	}>("/api/brain/goals", async (request, reply) => {
		try {
			const filters: { status?: string; priority?: string; category?: string } = {};
			if (request.query.status) filters.status = request.query.status;
			if (request.query.priority) filters.priority = request.query.priority;
			if (request.query.category) filters.category = request.query.category;

			const goals = await store.listGoals(Object.keys(filters).length > 0 ? filters : undefined);

			return reply.send({
				success: true,
				goals,
				count: goals.length,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list goals");
			return reply.code(500).send({
				success: false,
				error: "Failed to list goals",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/goals/stats — Get goal statistics
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/goals/stats", async (_request, reply) => {
		try {
			const stats = await store.getStats();
			return reply.send({
				success: true,
				stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get goal stats");
			return reply.code(500).send({
				success: false,
				error: "Failed to get goal stats",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/goals/drift — Get drift reports
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			goalId?: string;
		};
	}>("/api/brain/goals/drift", async (request, reply) => {
		try {
			const reports = await store.listDriftReports(request.query.goalId);
			return reply.send({
				success: true,
				reports,
				count: reports.length,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list drift reports");
			return reply.code(500).send({
				success: false,
				error: "Failed to list drift reports",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/goals/:id — Get a single goal by ID
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/api/brain/goals/:id", async (request, reply) => {
		try {
			const goal = await store.getGoal(request.params.id);
			if (!goal) {
				return reply.code(404).send({
					success: false,
					error: "Goal not found",
				});
			}
			return reply.send({
				success: true,
				goal,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get goal");
			return reply.code(500).send({
				success: false,
				error: "Failed to get goal",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/goals — Create a new goal
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			title: string;
			description: string;
			priority?: "critical" | "high" | "normal" | "low";
			category?: string;
			milestones?: Array<{
				title: string;
				description?: string;
				completed?: boolean;
				order?: number;
			}>;
			targetDate?: string;
		};
	}>("/api/brain/goals", async (request, reply) => {
		try {
			const { title, description, priority, category, milestones, targetDate } = request.body;

			if (!title || typeof title !== "string" || title.trim().length === 0) {
				return reply.code(400).send({
					success: false,
					error: "title is required and must be a non-empty string",
				});
			}

			// Use GoalStore's own factory via the coding-agent's exported helpers.
			// Since we're duck-typing the API, we create the record on the server side.
			// The client sends minimal input; the store's createGoal handles validation.
			const now = new Date().toISOString();
			const goal = {
				id: crypto.randomUUID(),
				title: title.trim(),
				description: description ?? "",
				priority: priority ?? "normal",
				status: "active" as const,
				category: category ?? "general",
				milestones: (milestones ?? []).map((m, i) => ({
					id: crypto.randomUUID(),
					title: m.title,
					description: m.description,
					completed: m.completed ?? false,
					createdAt: now,
					order: m.order ?? i,
				})),
				createdAt: now,
				updatedAt: now,
				targetDate,
				relatedMemoryIds: [],
				metadata: {},
			};

			const created = await store.createGoal(goal);
			return reply.code(201).send({
				success: true,
				goal: created,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to create goal");
			return reply.code(500).send({
				success: false,
				error: "Failed to create goal",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// PUT /api/brain/goals/:id — Update an existing goal
	// -----------------------------------------------------------------------

	fastify.put<{
		Params: { id: string };
		Body: Record<string, unknown>;
	}>("/api/brain/goals/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const existing = await store.getGoal(id);
			if (!existing) {
				return reply.code(404).send({
					success: false,
					error: "Goal not found",
				});
			}

			const updated = await store.updateGoal(id, request.body);
			return reply.send({
				success: true,
				goal: updated,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to update goal");
			return reply.code(500).send({
				success: false,
				error: "Failed to update goal",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// DELETE /api/brain/goals/:id — Delete a goal
	// -----------------------------------------------------------------------

	fastify.delete<{
		Params: { id: string };
	}>("/api/brain/goals/:id", async (request, reply) => {
		try {
			await store.deleteGoal(request.params.id);
			return reply.send({
				success: true,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to delete goal");
			return reply.code(500).send({
				success: false,
				error: "Failed to delete goal",
				message: String(error),
			});
		}
	});
}
