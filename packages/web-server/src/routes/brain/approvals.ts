/**
 * Brain Approval Queue API Routes — P18.D
 *
 * REST API for listing, approving, rejecting, and deferring approval requests.
 *
 * Endpoints:
 *   GET  /api/brain/approvals              List approvals (query: status, limit, offset)
 *   GET  /api/brain/approvals/stats        Approval queue statistics
 *   GET  /api/brain/approvals/history      Completed approval history
 *   GET  /api/brain/approvals/{id}         Get single approval request
 *   POST /api/brain/approvals/{id}/approve Approve request
 *   POST /api/brain/approvals/{id}/reject  Reject request with optional reason
 *   POST /api/brain/approvals/{id}/defer   Extend deadline
 *
 * All responses follow { success: boolean, ... } format.
 *
 * @packageDocumentation
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// API Interface
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the Approval Queue API.
 *
 * The routes only depend on this interface, not on the concrete
 * ApprovalQueueApi class from the coding-agent package.
 * This keeps the web-server free of a direct dependency on
 * the coding-agent package.
 *
 * All methods return Promise with serializable JSON responses.
 */
export interface ApprovalQueueApiLike {
	listApprovals(query?: { status?: string; limit?: number; offset?: number }): Promise<{
		approvals: any[];
		total: number;
		stats: any;
	}>;

	getApproval(id: string): Promise<any | null>;

	approveRequest(
		requestId: string,
		approvedBy: string,
	): Promise<{
		success: boolean;
		approval?: any;
		message: string;
	}>;

	rejectRequest(
		requestId: string,
		rejectedBy: string,
		reason?: string,
	): Promise<{
		success: boolean;
		approval?: any;
		message: string;
	}>;

	deferRequest(
		requestId: string,
		newDeadline?: string,
	): Promise<{
		success: boolean;
		approval?: any;
		message: string;
	}>;

	getStats(): Promise<any>;

	getHistory(query?: { limit?: number; offset?: number; since?: string; until?: string }): Promise<{
		approvals: any[];
		total: number;
	}>;
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * Register brain approval queue API routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param api - An ApprovalQueueApiLike-compatible object
 */
export async function registerBrainApprovalRoutes(fastify: FastifyInstance, api: ApprovalQueueApiLike): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /api/brain/approvals — List approvals
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			status?: string;
			limit?: number;
			offset?: number;
		};
	}>("/api/brain/approvals", async (request, reply) => {
		try {
			const { query } = request;
			const result = await api.listApprovals({
				status: query.status,
				limit: query.limit ? Math.min(Math.max(query.limit, 1), 1000) : undefined,
				offset: query.offset ? Math.max(query.offset, 0) : undefined,
			});

			return reply.send({
				success: true,
				approvals: result.approvals,
				total: result.total,
				stats: result.stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list approvals");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to list approvals",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/approvals/stats — Approval queue statistics
	//
	// NOTE: This must be registered BEFORE the /:id routes to avoid
	// Fastify interpreting "stats" as an :id param.
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/approvals/stats", async (_request, reply) => {
		try {
			const stats = await api.getStats();
			return reply.send({
				success: true,
				stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get approval stats");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get approval stats",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/approvals/history — Completed approval history
	//
	// NOTE: Must be registered BEFORE /:id routes to avoid Fastify
	// interpreting "history" as an :id param.
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			limit?: number;
			offset?: number;
			since?: string;
			until?: string;
		};
	}>("/api/brain/approvals/history", async (request, reply) => {
		try {
			const { query } = request;
			const result = await api.getHistory({
				limit: query.limit ? Math.min(Math.max(query.limit, 1), 1000) : undefined,
				offset: query.offset ? Math.max(query.offset, 0) : undefined,
				since: query.since,
				until: query.until,
			});

			return reply.send({
				success: true,
				approvals: result.approvals,
				total: result.total,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get approval history");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get approval history",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/approvals/:id — Get single approval request
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/api/brain/approvals/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const approval = await api.getApproval(id);

			if (!approval) {
				return reply.code(404).send({
					success: false,
					error: `Approval request "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
				approval,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get approval request");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get approval request",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/approvals/:id/approve — Approve approval request
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			approvedBy?: string;
		};
	}>("/api/brain/approvals/:id/approve", async (request, reply) => {
		try {
			const { id } = request.params;
			const { approvedBy } = request.body ?? {};

			const result = await api.approveRequest(id, approvedBy ?? "user");

			if (!result.success) {
				const statusCode = result.message.includes("not found") ? 404 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.message,
				});
			}

			return reply.send({
				success: true,
				approval: result.approval,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to approve request");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to approve request",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/approvals/:id/reject — Reject approval request
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			rejectedBy?: string;
			reason?: string;
		};
	}>("/api/brain/approvals/:id/reject", async (request, reply) => {
		try {
			const { id } = request.params;
			const { rejectedBy, reason } = request.body ?? {};

			const result = await api.rejectRequest(id, rejectedBy ?? "user", reason);

			if (!result.success) {
				const statusCode = result.message.includes("not found") ? 404 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.message,
				});
			}

			return reply.send({
				success: true,
				approval: result.approval,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to reject request");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to reject request",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/approvals/:id/defer — Defer approval request (extend deadline)
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			newDeadline?: string;
		};
	}>("/api/brain/approvals/:id/defer", async (request, reply) => {
		try {
			const { id } = request.params;
			const { newDeadline } = request.body ?? {};

			const result = await api.deferRequest(id, newDeadline);

			if (!result.success) {
				const statusCode = result.message.includes("not found") ? 404 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.message,
				});
			}

			return reply.send({
				success: true,
				approval: result.approval,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to defer request");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to defer request",
			});
		}
	});
}
