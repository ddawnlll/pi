/**
 * Brain Worker Inbox Routes — REST API for the Worker Handoff Inbox (25.O).
 *
 * Routes use relative paths so they can be registered under any prefix:
 * - Globally: prefix "/api/brain" → /api/brain/workers/inbox
 * - Per-project: prefix "/api/projects/:projectId/brain" → /api/projects/:projectId/brain/workers/inbox
 *
 * Endpoints:
 *   GET    /workers/inbox         — List handoff entries (with optional filters)
 *   GET    /workers/inbox/stats   — Get inbox aggregate statistics
 *   GET    /workers/inbox/:id     — Get a single handoff entry
 *   POST   /workers/inbox         — Create a new handoff entry
 *   POST   /workers/inbox/:id/route    — Route a handoff entry
 *   POST   /workers/inbox/:id/cancel   — Cancel a handoff entry
 *   POST   /workers/inbox/prune        — Manually trigger pruning
 */

import type {
	HandoffEntryStatus,
	HandoffInbox,
	HandoffInboxQuery,
	HandoffPriority,
	RoutingRule,
	TriageRouter,
} from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";

/**
 * Register brain worker inbox routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param inbox - The HandoffInbox singleton instance
 * @param triageRouter - The TriageRouter singleton instance
 */
export async function registerBrainWorkerInboxRoutes(
	fastify: FastifyInstance,
	inbox: HandoffInbox,
	triageRouter: TriageRouter,
): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /workers/inbox — List handoff entries
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			status?: string;
			priority?: string;
			sourceWorkerId?: string;
			targetWorkerRole?: string;
			targetWorkerId?: string;
			tags?: string;
			limit?: string;
			offset?: string;
			sortBy?: string;
			sortDir?: string;
		};
	}>("/workers/inbox", async (request, reply) => {
		try {
			const status = request.query.status as HandoffEntryStatus | undefined;
			const priority = request.query.priority as HandoffPriority | undefined;
			const sourceWorkerId = request.query.sourceWorkerId;
			const targetWorkerRole = request.query.targetWorkerRole;
			const targetWorkerId = request.query.targetWorkerId;
			const tags = request.query.tags ? request.query.tags.split(",") : undefined;
			const limit = request.query.limit ? Math.min(Math.max(Number(request.query.limit), 1), 200) : 50;
			const offset = request.query.offset ? Math.max(Number(request.query.offset), 0) : 0;
			const sortBy = (request.query.sortBy ?? "createdAt") as "createdAt" | "updatedAt" | "priority";
			const sortDir = (request.query.sortDir ?? "desc") as "asc" | "desc";

			const query: HandoffInboxQuery = {
				status,
				priority,
				sourceWorkerId,
				targetWorkerRole,
				targetWorkerId,
				tags,
				limit,
				offset,
				sortBy,
				sortDir,
			};

			const entries = inbox.list(query);
			const stats = inbox.stats();

			return reply.send({
				success: true,
				entries,
				total: stats.total,
				limit,
				offset,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list handoff entries");
			return reply.code(500).send({
				success: false,
				error: "Failed to list handoff entries",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /workers/inbox/stats — Get inbox statistics
	// -----------------------------------------------------------------------

	fastify.get("/workers/inbox/stats", async (_request, reply) => {
		try {
			const stats = inbox.stats();
			return reply.send({
				success: true,
				stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get inbox stats");
			return reply.code(500).send({
				success: false,
				error: "Failed to get inbox stats",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /workers/inbox/:id — Get a single handoff entry
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/workers/inbox/:id", async (request, reply) => {
		try {
			const entry = inbox.get(request.params.id);
			if (!entry) {
				return reply.code(404).send({
					success: false,
					error: `Handoff entry not found: ${request.params.id}`,
				});
			}
			return reply.send({
				success: true,
				entry,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get handoff entry");
			return reply.code(500).send({
				success: false,
				error: "Failed to get handoff entry",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /workers/inbox — Create a new handoff entry
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			sourceWorkerId: string;
			sourceWorkerRole: string;
			targetWorkerRole: string;
			title: string;
			description: string;
			dedupKey: string;
			priority?: HandoffPriority;
			targetWorkerId?: string;
			input?: Record<string, unknown>;
			output?: Record<string, unknown>;
			tags?: string[];
			evidenceRefs?: string[];
		};
	}>("/workers/inbox", async (request, reply) => {
		try {
			const result = inbox.create({
				sourceWorkerId: request.body.sourceWorkerId,
				sourceWorkerRole: request.body.sourceWorkerRole,
				targetWorkerRole: request.body.targetWorkerRole,
				title: request.body.title,
				description: request.body.description,
				dedupKey: request.body.dedupKey,
				priority: request.body.priority,
				targetWorkerId: request.body.targetWorkerId,
				input: request.body.input,
				output: request.body.output,
				tags: request.body.tags,
				evidenceRefs: request.body.evidenceRefs,
			});

			if ("entry" in result) {
				return reply.code(201).send({
					success: true,
					entry: result.entry,
					duplicate: false,
				});
			}

			if ("duplicate" in result) {
				return reply.code(200).send({
					success: true,
					entry: result.duplicate,
					duplicate: true,
					reason: result.reason,
				});
			}

			return reply.code(422).send({
				success: false,
				error: result.error,
				diagnostics: result.diagnostics,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to create handoff entry");
			return reply.code(500).send({
				success: false,
				error: "Failed to create handoff entry",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /workers/inbox/:id/route — Route a handoff entry
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
	}>("/workers/inbox/:id/route", async (request, reply) => {
		try {
			const entry = inbox.get(request.params.id);
			if (!entry) {
				return reply.code(404).send({
					success: false,
					error: `Handoff entry not found: ${request.params.id}`,
				});
			}

			// Run a single triage cycle to route this entry
			const cycleResult = triageRouter.processCycle();

			// Find the result for this specific entry
			const entryResult = cycleResult.routingResults.find((r) => r.entryId === request.params.id);

			if (!entryResult) {
				return reply.send({
					success: false,
					error: "Entry was not processed in this cycle. It may have been skipped or the cycle reached its limit.",
					cycleResult,
				});
			}

			return reply.send({
				success: entryResult.success,
				routingResult: entryResult,
				cycleResult,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to route handoff entry");
			return reply.code(500).send({
				success: false,
				error: "Failed to route handoff entry",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /workers/inbox/:id/cancel — Cancel a handoff entry
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: { reason?: string };
	}>("/workers/inbox/:id/cancel", async (request, reply) => {
		try {
			const result = inbox.cancel(request.params.id, request.body?.reason);
			if ("entry" in result) {
				return reply.send({
					success: true,
					entry: result.entry,
				});
			}
			return reply.code(422).send({
				success: false,
				error: result.error,
				diagnostics: result.diagnostics,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to cancel handoff entry");
			return reply.code(500).send({
				success: false,
				error: "Failed to cancel handoff entry",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /workers/inbox/prune — Manually trigger pruning
	// -----------------------------------------------------------------------

	fastify.post("/workers/inbox/prune", async (_request, reply) => {
		try {
			inbox.prune();
			const stats = inbox.stats();
			return reply.send({
				success: true,
				stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to prune inbox");
			return reply.code(500).send({
				success: false,
				error: "Failed to prune inbox",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// Triage Router Control Endpoints
	// -----------------------------------------------------------------------

	/**
	 * GET /workers/triage/status — Get triage router status
	 */
	fastify.get("/workers/triage/status", async (_request, reply) => {
		try {
			const stats = triageRouter.getStats();
			const config = triageRouter.getConfig();
			return reply.send({
				success: true,
				stats,
				config,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get triage router status");
			return reply.code(500).send({
				success: false,
				error: "Failed to get triage router status",
				message: String(error),
			});
		}
	});

	/**
	 * POST /workers/triage/cycle — Trigger a triage cycle
	 */
	fastify.post("/workers/triage/cycle", async (_request, reply) => {
		try {
			const result = triageRouter.processCycle();
			return reply.send({
				success: true,
				cycleResult: result,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to run triage cycle");
			return reply.code(500).send({
				success: false,
				error: "Failed to run triage cycle",
				message: String(error),
			});
		}
	});

	/**
	 * POST /workers/triage/pause — Pause the triage router
	 */
	fastify.post<{
		Body: { reason?: string };
	}>("/workers/triage/pause", async (request, reply) => {
		try {
			triageRouter.pause(request.body?.reason);
			return reply.send({
				success: true,
				status: triageRouter.getStatus(),
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to pause triage router");
			return reply.code(500).send({
				success: false,
				error: "Failed to pause triage router",
				message: String(error),
			});
		}
	});

	/**
	 * POST /workers/triage/resume — Resume the triage router
	 */
	fastify.post("/workers/triage/resume", async (_request, reply) => {
		try {
			triageRouter.resume();
			return reply.send({
				success: true,
				status: triageRouter.getStatus(),
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to resume triage router");
			return reply.code(500).send({
				success: false,
				error: "Failed to resume triage router",
				message: String(error),
			});
		}
	});

	/**
	 * POST /workers/triage/reset — Reset the triage router
	 */
	fastify.post("/workers/triage/reset", async (_request, reply) => {
		try {
			triageRouter.reset();
			return reply.send({
				success: true,
				stats: triageRouter.getStats(),
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to reset triage router");
			return reply.code(500).send({
				success: false,
				error: "Failed to reset triage router",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// Routing Rules Management
	// -----------------------------------------------------------------------

	/**
	 * GET /workers/triage/rules — List routing rules
	 */
	fastify.get("/workers/triage/rules", async (_request, reply) => {
		try {
			const rules = triageRouter.getRules();
			return reply.send({
				success: true,
				rules,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list routing rules");
			return reply.code(500).send({
				success: false,
				error: "Failed to list routing rules",
				message: String(error),
			});
		}
	});

	/**
	 * POST /workers/triage/rules — Add a routing rule
	 */
	fastify.post<{
		Body: RoutingRule;
	}>("/workers/triage/rules", async (request, reply) => {
		try {
			triageRouter.addRule(request.body);
			return reply.code(201).send({
				success: true,
				rule: request.body,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to add routing rule");
			return reply.code(500).send({
				success: false,
				error: "Failed to add routing rule",
				message: String(error),
			});
		}
	});

	/**
	 * DELETE /workers/triage/rules/:id — Remove a routing rule
	 */
	fastify.delete<{
		Params: { id: string };
	}>("/workers/triage/rules/:id", async (request, reply) => {
		try {
			const removed = triageRouter.removeRule(request.params.id);
			if (!removed) {
				return reply.code(404).send({
					success: false,
					error: `Routing rule not found: ${request.params.id}`,
				});
			}
			return reply.send({
				success: true,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to remove routing rule");
			return reply.code(500).send({
				success: false,
				error: "Failed to remove routing rule",
				message: String(error),
			});
		}
	});

	/**
	 * PATCH /workers/triage/rules/:id — Enable/disable a routing rule
	 */
	fastify.patch<{
		Params: { id: string };
		Body: { enabled: boolean };
	}>("/workers/triage/rules/:id", async (request, reply) => {
		try {
			const updated = triageRouter.setRuleEnabled(request.params.id, request.body.enabled);
			if (!updated) {
				return reply.code(404).send({
					success: false,
					error: `Routing rule not found: ${request.params.id}`,
				});
			}
			return reply.send({
				success: true,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to update routing rule");
			return reply.code(500).send({
				success: false,
				error: "Failed to update routing rule",
				message: String(error),
			});
		}
	});
}
