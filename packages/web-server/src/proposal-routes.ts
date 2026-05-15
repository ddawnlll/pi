/**
 * Proposal Routes — Read-only endpoints for the Lead Agent Dashboard (P8.G).
 *
 * Exposes proposal evidence, status, and audit trail without allowing
 * direct mutation of protected systems or queue state (AC2).
 *
 * Endpoints:
 *   GET /api/proposals
 *       List proposals with optional status/phase filters.
 *
 *   GET /api/proposals/:id
 *       Get a single proposal with full evidence and audit trail.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectStateStoreBackend } from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types (mirror the proposal inbox types for serialization)
// ---------------------------------------------------------------------------

/**
 * Evidence bundle captured at proposal submission time.
 */
export interface ProposalEvidence {
	plannerOutput: Record<string, unknown>;
	queue: Record<string, unknown>;
	optimizationProposals?: Array<{
		id: string;
		kind: string;
		description: string;
		approvalStatus: string;
		evidence: Record<string, unknown>;
	}>;
}

/**
 * Audit trail entry — extended with multi-stage approval actions.
 */
export interface ProposalAuditEntry {
	timestamp: number;
	action:
		| "submitted"
		| "approved"
		| "rejected"
		| "approved_for_planning"
		| "approved_for_execution"
		| "changes_requested"
		| "self_modification_approved";
	actor: string;
	reason?: string;
	resultingStatus: string;
}

/** Approval gate status. */
export type ApprovalGateStatus = "pending" | "approved" | "rejected" | "changes_requested";

/** Approval gate with metadata. */
export interface ApprovalGate {
	status: ApprovalGateStatus;
	actionedAt?: number;
	actionedBy?: string;
	reason?: string;
}

/** Dry-run status. */
export type DryRunStatus = "not_started" | "in_progress" | "passed" | "failed";

/** Budget state. */
export type BudgetState = "not_set" | "valid" | "exceeded" | "insufficient";

/** Proposal returned by the API (read-only). */
export interface ProposalResponse {
	id: string;
	title: string;
	phase: string;
	status: "pending" | "approved" | "rejected";
	planningApproval: ApprovalGate;
	executionApproval: ApprovalGate;
	selfModificationApproval: ApprovalGate;
	dryRunStatus: DryRunStatus;
	budgetState: BudgetState;
	evidence: ProposalEvidence;
	auditTrail: ProposalAuditEntry[];
	submittedAt: number;
	actionedAt?: number;
	rejectionReason?: string;
	metadata?: Record<string, unknown>;
}

/** Proposal action type. */
export type ProposalAction =
	| "approve_for_planning"
	| "approve_for_execution"
	| "reject"
	| "request_changes"
	| "approve_self_modification";

/** Request body for a proposal action. */
export interface ProposalActionRequest {
	action: ProposalAction;
	reason?: string;
	actor?: string;
}

/**
 * Filter params from query string.
 */
interface ProposalQueryParams {
	status?: string;
	phase?: string;
	limit?: number;
	offset?: number;
}

// ---------------------------------------------------------------------------
// File-based proposal loader
// ---------------------------------------------------------------------------

/**
 * Load proposals from the file-based .pi/proposals/index.json.
 *
 * @param piDir - Path to the .pi directory
 * @returns Array of proposals
 */
async function loadProposalsFromFile(piDir: string): Promise<ProposalResponse[]> {
	const proposalsFile = join(piDir, "proposals", "index.json");
	if (!existsSync(proposalsFile)) {
		return [];
	}

	try {
		const content = await readFile(proposalsFile, "utf-8");
		const parsed = JSON.parse(content);
		const rawProposals = (parsed.proposals ?? []) as Record<string, unknown>[];
		return rawProposals.map(migrateProposalFields);
	} catch {
		return [];
	}
}

/**
 * Load a single proposal from the file-based index.
 *
 * @param piDir - Path to the .pi directory
 * @param proposalId - Proposal ID
 * @returns Proposal or undefined
 */
async function loadProposalFromFile(piDir: string, proposalId: string): Promise<ProposalResponse | undefined> {
	const proposals = await loadProposalsFromFile(piDir);
	return proposals.find((p) => p.id === proposalId);
}

// ---------------------------------------------------------------------------
// DB-backed proposal loader
// ---------------------------------------------------------------------------

/**
 * Load proposals from PostgreSQL via ProposalRepository.
 *
 * @param filter - Optional filter criteria
 * @returns Array of proposals
 */
async function loadProposalsFromDb(filter?: ProposalQueryParams): Promise<ProposalResponse[]> {
	try {
		const { getKysely, ProposalRepository } = await import("@earendil-works/pi-db");
		const db = getKysely();
		const repo = new ProposalRepository(db);

		const dbFilter: { status?: string; phase?: string; limit?: number; offset?: number } = {};
		if (filter?.status) dbFilter.status = filter.status;
		if (filter?.phase) dbFilter.phase = filter.phase;
		if (filter?.limit) dbFilter.limit = filter.limit;
		if (filter?.offset) dbFilter.offset = filter.offset;

		const rows = await repo.listAll(dbFilter);

		return rows.map((row) => {
			// Migrate DB row to include multi-stage approval fields
			const raw: Record<string, unknown> = {
				id: row.id,
				title: row.title,
				phase: row.phase,
				status: row.status,
				evidence: row.evidence ?? { plannerOutput: {}, queue: {} },
				auditTrail: row.audit_trail ?? [],
				submittedAt: new Date(row.submitted_at).getTime(),
				actionedAt: row.actioned_at ? new Date(row.actioned_at).getTime() : undefined,
				rejectionReason: row.rejection_reason ?? undefined,
				metadata: row.metadata ?? undefined,
			};
			return migrateProposalFields(raw);
		});
	} catch (error) {
		console.error("[proposal-routes] DB load error:", error);
		return [];
	}
}

/**
 * Load a single proposal from PostgreSQL.
 *
 * @param proposalId - Proposal UUID
 * @returns Proposal or undefined
 */
async function loadProposalFromDb(proposalId: string): Promise<ProposalResponse | undefined> {
	try {
		const { getKysely, ProposalRepository } = await import("@earendil-works/pi-db");
		const db = getKysely();
		const repo = new ProposalRepository(db);
		const row = await repo.findById(proposalId);

		if (!row) return undefined;

		const raw: Record<string, unknown> = {
			id: row.id,
			title: row.title,
			phase: row.phase,
			status: row.status,
			evidence: row.evidence ?? { plannerOutput: {}, queue: {} },
			auditTrail: row.audit_trail ?? [],
			submittedAt: new Date(row.submitted_at).getTime(),
			actionedAt: row.actioned_at ? new Date(row.actioned_at).getTime() : undefined,
			rejectionReason: row.rejection_reason ?? undefined,
			metadata: row.metadata ?? undefined,
		};
		return migrateProposalFields(raw);
	} catch (error) {
		console.error("[proposal-routes] DB load error:", error);
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply query filters to a list of proposals (for file-based backend).
 */
function applyFilters(proposals: ProposalResponse[], filter?: ProposalQueryParams): ProposalResponse[] {
	let results = proposals;

	if (filter?.status) {
		results = results.filter((p) => p.status === filter.status);
	}
	if (filter?.phase) {
		results = results.filter((p) => p.phase === filter.phase);
	}

	// Sort by submission time, newest first
	results.sort((a, b) => b.submittedAt - a.submittedAt);

	const offset = filter?.offset ?? 0;
	const limit = filter?.limit ?? 50;
	results = results.slice(offset, offset + limit);

	return results;
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/**
 * Ensure old proposals (without multi-stage approval fields) have sensible defaults.
 * Called after loading to normalize the shape.
 */
function migrateProposalFields(p: Record<string, unknown>): ProposalResponse {
	const defaultGate = (): ApprovalGate => ({
		status: "pending",
		actionedAt: undefined,
		actionedBy: undefined,
		reason: undefined,
	});

	const planningApproval: ApprovalGate = (p.planningApproval as ApprovalGate) ?? defaultGate();
	const executionApproval: ApprovalGate = (p.executionApproval as ApprovalGate) ?? defaultGate();
	const selfModificationApproval: ApprovalGate = (p.selfModificationApproval as ApprovalGate) ?? defaultGate();

	// Compute legacy status from gates
	let legacyStatus: "pending" | "approved" | "rejected" = "pending";
	const oldStatus = p.status as string | undefined;
	if (executionApproval.status === "approved" || oldStatus === "approved") {
		legacyStatus = "approved";
	} else if (
		executionApproval.status === "rejected" ||
		planningApproval.status === "rejected" ||
		oldStatus === "rejected"
	) {
		legacyStatus = "rejected";
	}

	return {
		id: p.id as string,
		title: (p.title as string) ?? "Untitled",
		phase: (p.phase as string) ?? "",
		status: legacyStatus,
		planningApproval,
		executionApproval,
		selfModificationApproval,
		dryRunStatus: (p.dryRunStatus as DryRunStatus) ?? "not_started",
		budgetState: (p.budgetState as BudgetState) ?? "not_set",
		evidence: (p.evidence as ProposalEvidence) ?? { plannerOutput: {}, queue: {} },
		auditTrail: (p.auditTrail as ProposalAuditEntry[]) ?? [],
		submittedAt: (p.submittedAt as number) ?? Date.now(),
		actionedAt: p.actionedAt as number | undefined,
		rejectionReason: p.rejectionReason as string | undefined,
		metadata: p.metadata as Record<string, unknown> | undefined,
	};
}

/**
 * Save proposals back to the file-based index.json.
 */
async function saveProposalsToFile(piDir: string, proposals: ProposalResponse[]): Promise<void> {
	const proposalsFile = join(piDir, "proposals", "index.json");
	await writeFile(proposalsFile, JSON.stringify({ proposals }, null, 2), "utf-8");
}

/**
 * Apply a proposal action (mutation) to a proposal and return the updated proposal.
 * Updates the appropriate approval gate and appends an audit trail entry.
 */
function applyProposalAction(
	proposal: ProposalResponse,
	action: ProposalAction,
	actor: string,
	reason?: string,
): ProposalResponse {
	const now = Date.now();
	const updated = { ...proposal };

	// Build audit entry
	const auditEntry: ProposalAuditEntry = {
		timestamp: now,
		action: action as ProposalAuditEntry["action"],
		actor,
		reason,
		resultingStatus: "pending",
	};

	switch (action) {
		case "approve_for_planning":
			updated.planningApproval = {
				status: "approved",
				actionedAt: now,
				actionedBy: actor,
				reason,
			};
			auditEntry.resultingStatus = "planning_approved";
			break;

		case "approve_for_execution":
			updated.executionApproval = {
				status: "approved",
				actionedAt: now,
				actionedBy: actor,
				reason,
			};
			auditEntry.resultingStatus = "execution_approved";
			break;

		case "reject":
			// Rejection applies to both gates
			updated.planningApproval = {
				...updated.planningApproval,
				status: "rejected",
				actionedAt: now,
				actionedBy: actor,
				reason,
			};
			updated.executionApproval = {
				...updated.executionApproval,
				status: "rejected",
				actionedAt: now,
				actionedBy: actor,
				reason,
			};
			updated.rejectionReason = reason;
			updated.actionedAt = now;
			auditEntry.resultingStatus = "rejected";
			break;

		case "request_changes":
			updated.planningApproval = {
				...updated.planningApproval,
				status: "changes_requested",
				actionedAt: now,
				actionedBy: actor,
				reason,
			};
			auditEntry.resultingStatus = "changes_requested";
			break;

		case "approve_self_modification":
			updated.selfModificationApproval = {
				status: "approved",
				actionedAt: now,
				actionedBy: actor,
				reason,
			};
			auditEntry.resultingStatus = "self_modification_approved";
			break;
	}

	// Compute legacy status
	if (updated.executionApproval.status === "approved") {
		updated.status = "approved";
	} else if (updated.planningApproval.status === "rejected" || updated.executionApproval.status === "rejected") {
		updated.status = "rejected";
	} else {
		updated.status = "pending";
	}

	updated.auditTrail = [...updated.auditTrail, auditEntry];
	return updated;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register proposal routes on the Fastify instance.
 *
 * P9.F multi-stage approval endpoints:
 *   POST /api/proposals/:id/action  —  perform an approval action
 *
 * @param fastify - The Fastify server instance
 * @param getPiDir - Function that returns the .pi directory path
 * @param getWorkspaceRoot - Function that returns the workspace root path
 */
export async function registerProposalRoutes(
	fastify: FastifyInstance,
	getPiDir: () => string,
	_getWorkspaceRoot: () => string,
): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /api/proposals — List proposals with optional filters
	// -----------------------------------------------------------------------

	fastify.get<{
		Querystring: {
			status?: string;
			phase?: string;
			limit?: number;
			offset?: number;
		};
	}>("/api/proposals", async (request, reply) => {
		try {
			const backend = detectStateStoreBackend();
			const filter: ProposalQueryParams = {
				status: request.query.status,
				phase: request.query.phase,
				limit: request.query.limit ? Number(request.query.limit) : undefined,
				offset: request.query.offset ? Number(request.query.offset) : undefined,
			};

			let proposals: ProposalResponse[];

			if (backend === "postgres") {
				proposals = await loadProposalsFromDb(filter);
			} else {
				const piDir = getPiDir();
				const allProposals = await loadProposalsFromFile(piDir);
				proposals = applyFilters(allProposals, filter);
			}

			return reply.send({
				success: true,
				proposals,
				count: proposals.length,
			});
		} catch (error) {
			fastify.log.error({ error }, "Failed to list proposals");
			return reply.code(500).send({
				success: false,
				error: "Failed to list proposals",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/proposals/:id — Get a single proposal with full details
	// -----------------------------------------------------------------------

	fastify.get<{
		Params: { id: string };
	}>("/api/proposals/:id", async (request, reply) => {
		try {
			const { id } = request.params;
			const backend = detectStateStoreBackend();

			let proposal: ProposalResponse | undefined;

			if (backend === "postgres") {
				proposal = await loadProposalFromDb(id);
			} else {
				const piDir = getPiDir();
				proposal = await loadProposalFromFile(piDir, id);
			}

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
				error: "Failed to get proposal",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/proposals/:id/action — Perform a multi-stage approval action
	// -----------------------------------------------------------------------

	fastify.post<{
		Params: { id: string };
		Body: {
			action: ProposalAction;
			reason?: string;
			actor?: string;
		};
	}>("/api/proposals/:id/action", async (request, reply) => {
		try {
			const { id } = request.params;
			const { action, reason, actor } = request.body;

			const humanActor = actor ?? "dashboard-user";

			// Validate the action
			const validActions: ProposalAction[] = [
				"approve_for_planning",
				"approve_for_execution",
				"reject",
				"request_changes",
				"approve_self_modification",
			];
			if (!validActions.includes(action)) {
				return reply.code(400).send({
					success: false,
					error: `Invalid action: ${action}. Must be one of: ${validActions.join(", ")}`,
				});
			}

			// If this is approve_for_execution, enforce dry-run and budget checks
			if (action === "approve_for_execution") {
				let proposal: ProposalResponse | undefined;

				const backend = detectStateStoreBackend();
				if (backend === "postgres") {
					proposal = await loadProposalFromDb(id);
				} else {
					const piDir = getPiDir();
					proposal = await loadProposalFromFile(piDir, id);
				}

				if (!proposal) {
					return reply.code(404).send({
						success: false,
						error: `Proposal "${id}" not found`,
					});
				}

				// AC3: Execution cannot start without valid dry-run and budget state
				if (proposal.dryRunStatus !== "passed") {
					return reply.code(400).send({
						success: false,
						error: `Execution approval requires a passed dry-run. Current dry-run status: ${proposal.dryRunStatus}`,
					});
				}

				if (proposal.budgetState !== "valid") {
					return reply.code(400).send({
						success: false,
						error: `Execution approval requires a valid budget. Current budget state: ${proposal.budgetState}`,
					});
				}
			}

			const backend = detectStateStoreBackend();

			if (backend === "postgres") {
				// For DB backend, load, apply, and save through ProposalRepository
				try {
					const { getKysely, ProposalRepository } = await import("@earendil-works/pi-db");
					const db = getKysely();
					const repo = new ProposalRepository(db);
					const row = await repo.findById(id);

					if (!row) {
						return reply.code(404).send({
							success: false,
							error: `Proposal "${id}" not found`,
						});
					}

					const raw: Record<string, unknown> = {
						id: row.id,
						title: row.title,
						phase: row.phase,
						status: row.status,
						evidence: row.evidence,
						auditTrail: row.audit_trail,
						submittedAt: new Date(row.submitted_at).getTime(),
						actionedAt: row.actioned_at ? new Date(row.actioned_at).getTime() : undefined,
						rejectionReason: row.rejection_reason ?? undefined,
						metadata: row.metadata ?? undefined,
					};

					const current = migrateProposalFields(raw);
					const updated = applyProposalAction(current, action, humanActor, reason);

					await repo.update(id, {
						status: updated.status,
						audit_trail: JSON.parse(JSON.stringify(updated.auditTrail)),
						actioned_at: updated.actionedAt ? new Date(updated.actionedAt).toISOString() : undefined,
						rejection_reason: updated.rejectionReason ?? undefined,
					});

					return reply.send({
						success: true,
						proposal: updated,
					});
				} catch (dbError) {
					fastify.log.error({ dbError }, "Failed to update proposal in DB");
					return reply.code(500).send({
						success: false,
						error: "Failed to update proposal",
						message: String(dbError),
					});
				}
			} else {
				// File-based backend
				const piDir = getPiDir();
				const allProposals = await loadProposalsFromFile(piDir);
				const index = allProposals.findIndex((p) => p.id === id);

				if (index === -1) {
					return reply.code(404).send({
						success: false,
						error: `Proposal "${id}" not found`,
					});
				}

				const updated = applyProposalAction(allProposals[index], action, humanActor, reason);

				allProposals[index] = updated;
				await saveProposalsToFile(piDir, allProposals);

				return reply.send({
					success: true,
					proposal: updated,
				});
			}
		} catch (error) {
			fastify.log.error({ error }, "Failed to apply proposal action");
			return reply.code(500).send({
				success: false,
				error: "Failed to apply proposal action",
				message: String(error),
			});
		}
	});
}
