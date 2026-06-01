/**
 * Human Directive / Intervention Routes — P41.10
 *
 * REST API for issuing human directives and interventions to workspaces,
 * querying active directives and escalations, and resolving escalations.
 *
 * Endpoints:
 *   POST   /api/human/directive                                  — Issue a human directive to a workspace
 *   GET    /api/human/directives/:planExecId/:workspaceId        — List directives for a workspace
 *   POST   /api/human/escalations/:escalationId/resolve          — Resolve an escalation with user choice
 *   GET    /api/human/escalations/:planExecId/:workspaceId       — List active escalations for a workspace
 *   POST   /api/human/intervene/:planExecId/:workspaceId         — Intervene (stop/pause/cancel/retry) a workspace
 */

import crypto from "node:crypto";
import { handleExecutionCommand } from "@earendil-works/pi-execution-service";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

/**
 * Register human directive / intervention routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param getStateStore - Function returning the state store instance
 */
export function registerHumanDirectiveRoutes(fastify: FastifyInstance, getStateStore: () => any): void {
	// -----------------------------------------------------------------------
	// POST /api/human/directive
	// Issue a human directive to a workspace.
	// -----------------------------------------------------------------------
	fastify.post<{
		Body: {
			planExecutionId: string;
			workspaceId: string;
			directive: string;
			severity?: "low" | "medium" | "high" | "blocking";
		};
	}>("/api/human/directive", async (request, reply) => {
		try {
			const { planExecutionId, workspaceId, directive, severity } = request.body;

			if (!planExecutionId || typeof planExecutionId !== "string") {
				return reply.code(400).send({
					success: false,
					error: "planExecutionId is required and must be a string",
				});
			}
			if (!workspaceId || typeof workspaceId !== "string") {
				return reply.code(400).send({
					success: false,
					error: "workspaceId is required and must be a string",
				});
			}
			if (!directive || typeof directive !== "string" || directive.trim().length === 0) {
				return reply.code(400).send({
					success: false,
					error: "directive is required and must be a non-empty string",
				});
			}

			const stateStore = getStateStore();
			const directiveId = crypto.randomUUID();

			const result = await handleExecutionCommand(
				{
					type: "issue_human_directive",
					planExecutionId,
					workspaceId,
					directive,
					severity: severity ?? "medium",
					directiveId,
				},
				{
					planControlManager: stateStore,
				},
			);

			if (!result.accepted) {
				return reply.code(422).send({
					success: false,
					error: result.error ?? result.message,
				});
			}

			return reply.code(201).send({
				success: true,
				message: result.message,
				directiveId,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to issue human directive");
			return reply.code(500).send({
				success: false,
				error: "Failed to issue human directive",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/human/directives/:planExecId/:workspaceId
	// List human directives for a specific workspace.
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string; workspaceId: string };
	}>("/api/human/directives/:planExecId/:workspaceId", async (request, reply) => {
		try {
			const { planExecId, workspaceId } = request.params;
			const stateStore = getStateStore();

			// Collect directives from control requests stored in the state store
			const directives: Array<{
				id: string;
				directive: string;
				severity: string;
				issuedAt: number;
				acknowledged: boolean;
			}> = [];

			// Read from the control request file/history if available
			if (typeof stateStore.readControlRequest === "function") {
				// The readControlRequest may return the latest; for history
				// we try the workspace state's stored directives
				const ws = await stateStore.getWorkspaceState(planExecId, workspaceId);
				if (ws) {
					// Check for stored directives in workspace metadata
					const storedDirectives = (ws as any).humanDirectives;
					if (Array.isArray(storedDirectives)) {
						directives.push(...storedDirectives);
					} else if ((ws as any).humanDirective) {
						// Legacy single-directive fallback
						directives.push({
							id: "legacy",
							directive: (ws as any).humanDirective,
							severity: "medium",
							issuedAt: Date.now(),
							acknowledged: false,
						});
					}
				}

				// Also check the plan-level control request for human_directive actions
				try {
					const control = await stateStore.readControlRequest(planExecId);
					if (control && control.workspaceId === workspaceId && control.action === "human_directive") {
						const parsed = tryParseDirectivePayload(control.reason);
						if (parsed) {
							// Avoid duplicates
							const exists = directives.some((d) => d.id === parsed.id);
							if (!exists) {
								directives.push(parsed);
							}
						}
					}
				} catch {
					// Control request read may not be supported
				}
			}

			return reply.send({
				success: true,
				directives,
				count: directives.length,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list human directives");
			return reply.code(500).send({
				success: false,
				error: "Failed to list human directives",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/human/escalations/:escalationId/resolve
	// Resolve an escalation with the user's chosen option.
	// -----------------------------------------------------------------------
	fastify.post<{
		Params: { escalationId: string };
		Body: {
			planExecutionId: string;
			workspaceId: string;
			chosenOptionId: string;
			userResponse?: string;
		};
	}>("/api/human/escalations/:escalationId/resolve", async (request, reply) => {
		try {
			const { escalationId } = request.params;
			const { planExecutionId, workspaceId, chosenOptionId, userResponse } = request.body;

			if (!planExecutionId || !workspaceId) {
				return reply.code(400).send({
					success: false,
					error: "planExecutionId and workspaceId are required",
				});
			}
			if (!chosenOptionId) {
				return reply.code(400).send({
					success: false,
					error: "chosenOptionId is required",
				});
			}

			// Validate that the escalation exists
			const stateStore = getStateStore();
			if (typeof stateStore.getLeadEscalations === "function") {
				const escalations = await stateStore.getLeadEscalations(planExecutionId, workspaceId);
				const escalation = escalations?.find((e: any) => e.escalationId === escalationId);
				if (!escalation) {
					return reply.code(404).send({
						success: false,
						error: `Escalation not found: ${escalationId}`,
					});
				}
			}

			const result = await handleExecutionCommand(
				{
					type: "resolve_escalation",
					planExecutionId,
					workspaceId,
					escalationId,
					chosenOptionId,
					userResponse,
				},
				{},
			);

			if (!result.accepted) {
				return reply.code(422).send({
					success: false,
					error: result.error ?? result.message,
				});
			}

			return reply.send({
				success: true,
				message: `Escalation ${escalationId} resolved with option ${chosenOptionId}`,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to resolve escalation");
			return reply.code(500).send({
				success: false,
				error: "Failed to resolve escalation",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/human/escalations/:planExecId/:workspaceId
	// List active escalations for a workspace.
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string; workspaceId: string };
	}>("/api/human/escalations/:planExecId/:workspaceId", async (request, reply) => {
		try {
			const { planExecId, workspaceId } = request.params;
			const stateStore = getStateStore();

			let escalations: any[] = [];
			if (typeof stateStore.getLeadEscalations === "function") {
				escalations = await stateStore.getLeadEscalations(planExecId, workspaceId);
			}

			return reply.send({
				success: true,
				escalations,
				count: escalations.length,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list escalations");
			return reply.code(500).send({
				success: false,
				error: "Failed to list escalations",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/human/intervene/:planExecId/:workspaceId
	// Intervene on a workspace (stop/pause/cancel/retry).
	// -----------------------------------------------------------------------
	fastify.post<{
		Params: { planExecId: string; workspaceId: string };
		Body: {
			action: "stop" | "pause" | "cancel" | "retry";
			reason?: string;
		};
	}>("/api/human/intervene/:planExecId/:workspaceId", async (request, reply) => {
		try {
			const { planExecId, workspaceId } = request.params;
			const { action, reason } = request.body;

			if (!action || !["stop", "pause", "cancel", "retry"].includes(action)) {
				return reply.code(400).send({
					success: false,
					error: 'action must be one of: "stop", "pause", "cancel", "retry"',
				});
			}

			const stateStore = getStateStore();

			const result = await handleExecutionCommand(
				{
					type: "intervene_workspace",
					planExecutionId: planExecId,
					workspaceId,
					action,
					reason,
				},
				{
					planControlManager: stateStore,
				},
			);

			if (!result.accepted) {
				return reply.code(422).send({
					success: false,
					error: result.error ?? result.message,
				});
			}

			return reply.send({
				success: true,
				message: result.message,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to intervene on workspace");
			return reply.code(500).send({
				success: false,
				error: "Failed to intervene on workspace",
				message: String(error),
			});
		}
	});
}

// ---------------------------------------------------------------------------
// Helper: Try to parse a directive payload from a control request reason field
// ---------------------------------------------------------------------------

function tryParseDirectivePayload(reason: string | undefined): {
	id: string;
	directive: string;
	severity: string;
	issuedAt: number;
	acknowledged: boolean;
} | null {
	if (!reason) return null;
	try {
		const parsed = JSON.parse(reason);
		if (parsed && typeof parsed.directive === "string") {
			return {
				id: parsed.directiveId ?? crypto.randomUUID(),
				directive: parsed.directive,
				severity: parsed.severity ?? "medium",
				issuedAt: Date.now(),
				acknowledged: false,
			};
		}
	} catch {
		// Not JSON, treat the raw string as the directive
	}
	return null;
}
