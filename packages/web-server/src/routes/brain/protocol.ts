/**
 * Brain Protocol API Routes — P15.F
 *
 * REST API for the User Protocol Actions: morning report, daytime
 * approval/rejection, night run configuration, and decision explanations.
 *
 * Endpoints:
 *   GET    /api/brain/protocol/morning        Get morning report data (JSON)
 *   GET    /api/brain/protocol/morning/markdown  Get morning report (Markdown)
 *   POST   /api/brain/protocol/approval       Process an approval/rejection
 *   POST   /api/brain/protocol/rejection      Record a rejection
 *   POST   /api/brain/protocol/memory-correction  Record a memory correction
 *   POST   /api/brain/protocol/night/configure  Configure a night run
 *   POST   /api/brain/protocol/night/:sessionId/start  Start a night run
 *   GET    /api/brain/protocol/night/:sessionId/status  Check night run status
 *   POST   /api/brain/protocol/explain         Explain a decision
 *   GET    /api/brain/protocol/rejections      Get all rejection records
 *
 * Dependencies: P15.F (UserProtocol)
 *
 * Usage:
 * ```typescript
 * import { UserProtocol } from "@earendil-works/pi-coding-agent";
 * const protocol = new UserProtocol(goalStore, autonomyEngine, decisionClassifier);
 * registerBrainProtocolRoutes(fastify, protocol);
 * ```
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// API Interface (duck-typed to avoid direct dependency on coding-agent)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the User Protocol API.
 *
 * The routes only depend on this interface, not on the concrete
 * UserProtocol class from the coding-agent package.
 * This keeps the web-server free of a direct dependency on
 * the coding-agent package.
 */
export interface BrainProtocolApi {
	getMorningData(): Promise<{
		date: string;
		whatRan: Array<{ planId: string; planTitle: string; status: string }>;
		whatCompleted: Array<{ planId: string; planTitle: string }>;
		whatStopped: Array<{ planId: string; planTitle: string; reason: string }>;
		whatChanged: string[];
		whatLearned: string[];
		needsApproval: Array<{ type: string; id: string; description: string }>;
		top3NextActions: string[];
		artifactLinks: Array<{ label: string; path: string }>;
	}>;

	generateMorningMarkdown(): Promise<string>;

	processApproval(requestId: string, approved: boolean, by: string): Promise<void>;

	processRejection(
		proposalId: string,
		by: string,
		reason?: string,
	): Promise<{
		id: string;
		proposalId: string;
		proposedAt: string;
		rejectedAt: string;
		rejectionReason?: string;
		category: string;
		affected: string[];
		suppressSimilar: boolean;
		memoryUpdated: boolean;
		updatedMemoryId?: string;
	}>;

	processMemoryCorrection(
		memoryId: string,
		correction: string,
		by: string,
	): Promise<{
		id: string;
		originalMemoryId: string;
		reason: string;
		action: string;
		createdAt: string;
		createdBy: string;
	}>;

	configureNightRun(config: {
		queue: string[];
		autonomyLevel: number;
		stopConditions: string[];
		maxDurationHours: number;
		notificationEmail?: string;
		generateMorningReport: boolean;
	}): Promise<{ sessionId: string }>;

	startNightRun(sessionId: string): Promise<void>;

	checkNightRunStatus(sessionId: string): Promise<{ status: string; progress: number }>;

	explainDecision(
		action: string,
		context: Record<string, unknown>,
	): Promise<{
		action: string;
		decision: Record<string, unknown>;
		reasoning: string;
		applicableRules: Array<Record<string, unknown>>;
		autonomyLevel: number;
		appealOptions: string[];
	}>;

	getRejectionRecords(): unknown[];
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register brain protocol API routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param api - A BrainProtocolApi-compatible object
 */
export async function registerBrainProtocolRoutes(fastify: FastifyInstance, api: BrainProtocolApi): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /api/brain/protocol/morning — Get morning report data (JSON)
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/protocol/morning", async (_request, reply) => {
		try {
			const data = await api.getMorningData();
			return { success: true, data };
		} catch (error) {
			fastify.log.error({ error }, "Failed to get morning report data");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to get morning report data",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/protocol/morning/markdown — Get morning report (Markdown)
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/protocol/morning/markdown", async (_request, reply) => {
		try {
			const markdown = await api.generateMorningMarkdown();
			return reply.header("Content-Type", "text/markdown; charset=utf-8").send(markdown);
		} catch (error) {
			fastify.log.error({ error }, "Failed to generate morning markdown");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to generate morning markdown",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/protocol/approval — Process an approval/rejection
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			requestId: string;
			approved: boolean;
			by: string;
		};
	}>("/api/brain/protocol/approval", async (request, reply) => {
		try {
			const { requestId, approved, by } = request.body;
			if (!requestId || by === undefined || by === null) {
				return reply.code(400).send({
					success: false,
					error: "requestId and by are required",
				});
			}
			await api.processApproval(requestId, approved, by);
			return { success: true };
		} catch (error) {
			fastify.log.error({ error }, "Failed to process approval");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to process approval",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/protocol/rejection — Record a rejection
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			proposalId: string;
			by: string;
			reason?: string;
		};
	}>("/api/brain/protocol/rejection", async (request, reply) => {
		try {
			const { proposalId, by, reason } = request.body;
			if (!proposalId || !by) {
				return reply.code(400).send({
					success: false,
					error: "proposalId and by are required",
				});
			}
			const record = await api.processRejection(proposalId, by, reason);
			return reply.code(201).send({ success: true, record });
		} catch (error) {
			fastify.log.error({ error }, "Failed to record rejection");
			return reply.code(400).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to record rejection",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/protocol/memory-correction — Record a memory correction
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			memoryId: string;
			correction: string;
			by: string;
		};
	}>("/api/brain/protocol/memory-correction", async (request, reply) => {
		try {
			const { memoryId, correction, by } = request.body;
			if (!memoryId || !correction || !by) {
				return reply.code(400).send({
					success: false,
					error: "memoryId, correction, and by are required",
				});
			}
			const record = await api.processMemoryCorrection(memoryId, correction, by);
			return reply.code(201).send({ success: true, record });
		} catch (error) {
			fastify.log.error({ error }, "Failed to record memory correction");
			return reply.code(400).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to record memory correction",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/protocol/night/configure — Configure a night run
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			queue: string[];
			autonomyLevel: number;
			stopConditions: string[];
			maxDurationHours: number;
			notificationEmail?: string;
			generateMorningReport: boolean;
		};
	}>("/api/brain/protocol/night/configure", async (request, reply) => {
		try {
			const config = {
				queue: request.body.queue,
				autonomyLevel: request.body.autonomyLevel,
				stopConditions: request.body.stopConditions,
				maxDurationHours: request.body.maxDurationHours,
				notificationEmail: request.body.notificationEmail,
				generateMorningReport: request.body.generateMorningReport,
			};

			if (!config.queue || config.queue.length === 0) {
				return reply.code(400).send({
					success: false,
					error: "queue must contain at least one plan ID",
				});
			}

			const result = await api.configureNightRun(config);
			return reply.code(201).send({ success: true, sessionId: result.sessionId });
		} catch (error) {
			fastify.log.error({ error }, "Failed to configure night run");
			return reply.code(400).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to configure night run",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/protocol/night/:sessionId/start — Start a night run
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { sessionId: string };
	}>("/api/brain/protocol/night/:sessionId/start", async (request, reply) => {
		try {
			await api.startNightRun(request.params.sessionId);
			return { success: true };
		} catch (error) {
			fastify.log.error({ error }, "Failed to start night run");
			const status = error instanceof Error && error.message.includes("not found") ? 404 : 400;
			return reply.code(status).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to start night run",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/protocol/night/:sessionId/status — Check night run status
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { sessionId: string };
	}>("/api/brain/protocol/night/:sessionId/status", async (request, reply) => {
		try {
			const status = await api.checkNightRunStatus(request.params.sessionId);
			return { success: true, ...status };
		} catch (error) {
			fastify.log.error({ error }, "Failed to check night run status");
			const statusCode = error instanceof Error && error.message.includes("not found") ? 404 : 500;
			return reply.code(statusCode).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to check night run status",
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/brain/protocol/explain — Explain a decision
	// -----------------------------------------------------------------------

	fastify.post<{
		Body: {
			action: string;
			context?: Record<string, unknown>;
		};
	}>("/api/brain/protocol/explain", async (request, reply) => {
		try {
			const { action, context = {} } = request.body;
			if (!action) {
				return reply.code(400).send({
					success: false,
					error: "action is required",
				});
			}
			const explanation = await api.explainDecision(action, context);
			return { success: true, explanation };
		} catch (error) {
			fastify.log.error({ error }, "Failed to explain decision");
			return reply.code(500).send({
				success: false,
				error: error instanceof Error ? error.message : "Failed to explain decision",
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/brain/protocol/rejections — Get all rejection records
	// -----------------------------------------------------------------------

	fastify.get("/api/brain/protocol/rejections", async (_request, reply) => {
		try {
			const records = api.getRejectionRecords();
			return { success: true, records };
		} catch (error) {
			fastify.log.error({ error }, "Failed to get rejection records");
			return reply.code(500).send({
				success: false,
				records: [],
				error: error instanceof Error ? error.message : "Failed to get rejection records",
			});
		}
	});
}
