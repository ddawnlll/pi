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
import { readFile } from "node:fs/promises";
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
 * Audit trail entry.
 */
export interface ProposalAuditEntry {
	timestamp: number;
	action: "submitted" | "approved" | "rejected";
	actor: string;
	reason?: string;
	resultingStatus: string;
}

/**
 * Proposal returned by the API (read-only).
 */
export interface ProposalResponse {
	id: string;
	title: string;
	phase: string;
	status: "pending" | "approved" | "rejected";
	evidence: ProposalEvidence;
	auditTrail: ProposalAuditEntry[];
	submittedAt: number;
	actionedAt?: number;
	rejectionReason?: string;
	metadata?: Record<string, unknown>;
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
		return parsed.proposals ?? [];
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

		return rows.map((row) => ({
			id: row.id,
			title: row.title,
			phase: row.phase,
			status: row.status as ProposalResponse["status"],
			evidence: (row.evidence ?? { plannerOutput: {}, queue: {} }) as unknown as ProposalEvidence,
			auditTrail: (row.audit_trail ?? []) as unknown as ProposalAuditEntry[],
			submittedAt: new Date(row.submitted_at).getTime(),
			actionedAt: row.actioned_at ? new Date(row.actioned_at).getTime() : undefined,
			rejectionReason: row.rejection_reason ?? undefined,
			metadata: row.metadata ?? undefined,
		})) as ProposalResponse[];
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

		return {
			id: row.id,
			title: row.title,
			phase: row.phase,
			status: row.status as ProposalResponse["status"],
			evidence: (row.evidence ?? { plannerOutput: {}, queue: {} }) as unknown as ProposalEvidence,
			auditTrail: (row.audit_trail ?? []) as unknown as ProposalAuditEntry[],
			submittedAt: new Date(row.submitted_at).getTime(),
			actionedAt: row.actioned_at ? new Date(row.actioned_at).getTime() : undefined,
			rejectionReason: row.rejection_reason ?? undefined,
			metadata: row.metadata ?? undefined,
		} as ProposalResponse;
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
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register read-only proposal routes on the Fastify instance.
 *
 * These endpoints are read-only (GET only) to satisfy AC2:
 * "Dashboard cannot directly mutate protected systems or queue state."
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
}
