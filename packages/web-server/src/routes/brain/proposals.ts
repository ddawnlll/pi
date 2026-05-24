/**
 * Brain Proposal API Routes — P16.F
 *
 * REST API for proposal CRUD, accept/reject/correct/expire, inbox,
 * stats, and evidence retrieval.
 *
 * Endpoints:
 *   GET    /proposals                    List proposals (query: status, type, minScore, limit, offset)
 *   POST   /proposals                    Create proposal
 *   GET    /proposals/inbox              Top-3 inbox view
 *   GET    /proposals/stats              Proposal statistics
 *   GET    /proposals/{id}               Get single proposal
 *   PUT    /proposals/{id}               Update proposal
 *   DELETE /proposals/{id}               Delete proposal
 *   POST   /proposals/{id}/accept        Accept proposal
 *   POST   /proposals/{id}/reject        Reject proposal
 *   POST   /proposals/{id}/correct       Correct proposal
 *   POST   /proposals/{id}/expire        Manually expire
 *   GET    /proposals/{id}/evidence      Get evidence detail
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
 * Minimal interface for the Brain Proposal API.
 *
 * The routes only depend on this interface, not on the concrete
 * BrainProposalApi class from the coding-agent package.
 * This keeps the web-server free of a direct dependency on
 * the coding-agent package.
 *
 * All methods return Promise with serializable JSON responses.
 */
export interface BrainProposalApiLike {
	// CRUD
	listProposals(query?: {
		status?: string[];
		type?: string[];
		minScore?: number;
		maxScore?: number;
		tag?: string;
		relatedGoalId?: string;
		createdAfter?: string;
		createdBefore?: string;
		limit?: number;
		offset?: number;
		sortBy?: "score" | "createdAt" | "updatedAt";
		sortOrder?: "asc" | "desc";
	}): Promise<any[]>;

	getProposal(id: string): Promise<any | null>;

	createProposal(input: any): Promise<{
		success: boolean;
		proposal?: any;
		error?: string;
		isDuplicate?: boolean;
		isInCooldown?: boolean;
	}>;

	updateProposal(id: string, input: any): Promise<any | null>;

	deleteProposal(id: string): Promise<boolean>;

	// Accept/Reject/Correct/Expire
	acceptProposal(
		id: string,
		approvedBy?: string,
	): Promise<{
		success: boolean;
		proposal?: any;
		message: string;
	}>;

	rejectProposal(
		id: string,
		rejectedBy?: string,
		reason?: string,
	): Promise<{
		success: boolean;
		proposal?: any;
		message: string;
	}>;

	correctProposal(
		id: string,
		corrections: any,
	): Promise<{
		success: boolean;
		proposal?: any;
		message: string;
	}>;

	expireProposal(id: string): Promise<{
		success: boolean;
		proposal?: any;
		message: string;
	}>;

	// Inbox
	getInbox(): Promise<any>;
	refreshInbox(): Promise<any>;
	getInboxStats(): Promise<any>;

	// Stats
	getStats(): Promise<any>;

	// Evidence
	getEvidence(id: string): Promise<any | null>;
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * Register brain proposal API routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param api - A BrainProposalApiLike-compatible object
 */
export async function registerBrainProposalRoutes(fastify: FastifyInstance, api: BrainProposalApiLike): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /proposals — List proposals
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			status?: string;
			type?: string;
			minScore?: number;
			maxScore?: number;
			tag?: string;
			relatedGoalId?: string;
			createdAfter?: string;
			createdBefore?: string;
			limit?: number;
			offset?: number;
			sortBy?: "score" | "createdAt" | "updatedAt";
			sortOrder?: "asc" | "desc";
		};
	}>("/proposals", async (request, reply) => {
		try {
			const { query } = request;
			const proposals = await api.listProposals({
				status: query.status ? query.status.split(",") : undefined,
				type: query.type ? query.type.split(",") : undefined,
				minScore: query.minScore,
				maxScore: query.maxScore,
				tag: query.tag,
				relatedGoalId: query.relatedGoalId,
				createdAfter: query.createdAfter,
				createdBefore: query.createdBefore,
				limit: query.limit ? Math.min(Math.max(query.limit, 1), 1000) : undefined,
				offset: query.offset ? Math.max(query.offset, 0) : undefined,
				sortBy: query.sortBy,
				sortOrder: query.sortOrder,
			});

			return reply.send({
				success: true,
				proposals,
				count: proposals.length,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list proposals");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to list proposals",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /proposals — Create proposal
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: Record<string, unknown>;
	}>("/proposals", async (request, reply) => {
		try {
			const body = request.body;
			if (!body.type || !body.title || !body.description) {
				return reply.code(400).send({
					success: false,
					error: "Missing required fields: type, title, description",
				});
			}

			const result = await api.createProposal(body);

			if (!result.success) {
				const statusCode = result.isDuplicate ? 409 : result.isInCooldown ? 429 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.error ?? "Failed to create proposal",
					isDuplicate: result.isDuplicate,
					isInCooldown: result.isInCooldown,
				});
			}

			return reply.code(201).send({
				success: true,
				proposal: result.proposal,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to create proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to create proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /proposals/inbox — Top-3 inbox view
	// -----------------------------------------------------------------------

	fastify.get("/proposals/inbox", async (_request, reply) => {
		try {
			const inbox = await api.getInbox();
			return reply.send({
				success: true,
				inbox,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get inbox");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get inbox",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /proposals/stats — Proposal statistics
	// -----------------------------------------------------------------------

	fastify.get("/proposals/stats", async (_request, reply) => {
		try {
			const stats = await api.getStats();
			return reply.send({
				success: true,
				stats,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get stats");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get stats",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /proposals/:id — Get single proposal
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/proposals/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const proposal = await api.getProposal(id);

			if (!proposal) {
				return reply.code(404).send({
					success: false,
					error: `Proposal "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
				proposal,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// PUT /proposals/:id — Update proposal
	// -----------------------------------------------------------------------

	fastify.put<{
		Params: { id: string };
		Body: Record<string, unknown>;
	}>("/proposals/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const body = request.body;

			const proposal = await api.updateProposal(id, body);
			if (!proposal) {
				return reply.code(404).send({
					success: false,
					error: `Proposal "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
				proposal,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to update proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to update proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// DELETE /proposals/:id — Delete proposal
	// -----------------------------------------------------------------------

	fastify.delete<{
		Params: { id: string };
	}>("/proposals/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const deleted = await api.deleteProposal(id);

			if (!deleted) {
				return reply.code(404).send({
					success: false,
					error: `Proposal "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
				message: `Proposal "${id}" deleted`,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to delete proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to delete proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /proposals/:id/accept — Accept proposal
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			approvedBy?: string;
		};
	}>("/proposals/:id/accept", async (request, reply) => {
		try {
			const { id } = request.params;
			const { approvedBy } = request.body ?? {};

			const result = await api.acceptProposal(id, approvedBy ?? "user");

			if (!result.success) {
				const statusCode = result.message.includes("not found") ? 404 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.message,
				});
			}

			return reply.send({
				success: true,
				proposal: result.proposal,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to accept proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to accept proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /proposals/:id/reject — Reject proposal
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			rejectedBy?: string;
			reason?: string;
		};
	}>("/proposals/:id/reject", async (request, reply) => {
		try {
			const { id } = request.params;
			const { rejectedBy, reason } = request.body ?? {};

			const result = await api.rejectProposal(id, rejectedBy ?? "user", reason);

			if (!result.success) {
				const statusCode = result.message.includes("not found") ? 404 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.message,
				});
			}

			return reply.send({
				success: true,
				proposal: result.proposal,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to reject proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to reject proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /proposals/:id/correct — Correct proposal
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			corrections: Record<string, unknown>;
		};
	}>("/proposals/:id/correct", async (request, reply) => {
		try {
			const { id } = request.params;
			const { corrections } = request.body ?? {};

			if (!corrections || Object.keys(corrections).length === 0) {
				return reply.code(400).send({
					success: false,
					error: "corrections body is required",
				});
			}

			const result = await api.correctProposal(id, corrections);

			if (!result.success) {
				const statusCode = result.message.includes("not found") ? 404 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.message,
				});
			}

			return reply.send({
				success: true,
				proposal: result.proposal,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to correct proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to correct proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /proposals/:id/expire — Manually expire proposal
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
	}>("/proposals/:id/expire", async (request, reply) => {
		try {
			const { id } = request.params;

			const result = await api.expireProposal(id);

			if (!result.success) {
				const statusCode = result.message.includes("not found") ? 404 : 400;
				return reply.code(statusCode).send({
					success: false,
					error: result.message,
				});
			}

			return reply.send({
				success: true,
				proposal: result.proposal,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to expire proposal");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to expire proposal",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /proposals/:id/evidence — Get evidence detail
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/proposals/:id/evidence", async (request, reply) => {
		try {
			const { id } = request.params;
			const evidence = await api.getEvidence(id);

			if (!evidence) {
				return reply.code(404).send({
					success: false,
					error: `Proposal "${id}" not found`,
				});
			}

			return reply.send({
				success: true,
				evidence,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to get evidence");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get evidence",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /proposals/inbox/refresh — Refresh inbox
	//
	// NOTE: This must be registered AFTER the /:id routes to avoid
	// Fastify interpreting "inbox" as an :id param. However, because
	// Fastify matches routes in order, and we register inbox routes
	// before :id routes, this is safe. We use a separate prefix path
	// to guarantee no conflict.
	// -----------------------------------------------------------------------

	fastify.post("/proposals/inbox/refresh", async (_request, reply) => {
		try {
			const inbox = await api.refreshInbox();
			return reply.send({
				success: true,
				inbox,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to refresh inbox");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to refresh inbox",
			});
		}
	});
}
