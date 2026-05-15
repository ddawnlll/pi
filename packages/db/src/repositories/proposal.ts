/**
 * Proposal repository.
 *
 * Provides CRUD operations for proposals backed by PostgreSQL.
 * Supports the Proposal Inbox (P8.B) with persistence, audit trail,
 * and approval gating.
 */

import type { Kysely } from "kysely";
import type { Database, NewProposal, Proposal, ProposalUpdate } from "../types.js";

/**
 * Filter options for listing proposals.
 */
export interface ProposalFilter {
	status?: string;
	phase?: string;
	limit?: number;
	offset?: number;
}

/**
 * Source artifact descriptor.
 *
 * Represents an artifact (file, report, etc.) that serves as
 * the source evidence for a proposal (P8 output before plan generation).
 */
export interface SourceArtifact {
	/** Path to the source artifact file */
	path: string;
	/** Human-readable label */
	label: string;
	/** Artifact type (e.g., "remediation-plan", "dag", "risk-report") */
	type: string;
	/** Size in bytes (optional) */
	size?: number;
	/** Content hash for integrity checking (optional) */
	hash?: string;
	/** ISO timestamp when the artifact was recorded */
	recorded_at: string;
}

/**
 * Proposal repository
 */
export class ProposalRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new proposal.
	 *
	 * @param data - Proposal data
	 * @returns Created proposal
	 */
	async create(data: NewProposal): Promise<Proposal> {
		return this.db.insertInto("proposals").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find proposal by ID.
	 *
	 * @param id - Proposal UUID
	 * @returns Proposal or undefined
	 */
	async findById(id: string): Promise<Proposal | undefined> {
		return this.db.selectFrom("proposals").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * Find proposal by unique proposal key.
	 *
	 * @param proposalKey - Proposal key (e.g., "prop-xxx-yyy")
	 * @returns Proposal or undefined
	 */
	async findByKey(proposalKey: string): Promise<Proposal | undefined> {
		return this.db.selectFrom("proposals").selectAll().where("proposal_key", "=", proposalKey).executeTakeFirst();
	}

	/**
	 * List proposals for a project.
	 *
	 * @param projectId - Project UUID
	 * @param filter - Optional filter criteria
	 * @returns Array of proposals
	 */
	async listByProject(projectId: string, filter?: ProposalFilter): Promise<Proposal[]> {
		let query = this.db.selectFrom("proposals").selectAll().where("project_id", "=", projectId);

		if (filter?.status) {
			query = query.where("status", "=", filter.status);
		}
		if (filter?.phase) {
			query = query.where("phase", "=", filter.phase);
		}

		const limit = filter?.limit ?? 50;
		const offset = filter?.offset ?? 0;

		return query.orderBy("submitted_at", "desc").limit(limit).offset(offset).execute();
	}

	/**
	 * List all proposals across projects.
	 *
	 * @param filter - Optional filter criteria
	 * @returns Array of proposals
	 */
	async listAll(filter?: ProposalFilter): Promise<Proposal[]> {
		let query = this.db.selectFrom("proposals").selectAll();

		if (filter?.status) {
			query = query.where("status", "=", filter.status);
		}
		if (filter?.phase) {
			query = query.where("phase", "=", filter.phase);
		}

		const limit = filter?.limit ?? 100;
		const offset = filter?.offset ?? 0;

		return query.orderBy("submitted_at", "desc").limit(limit).offset(offset).execute();
	}

	/**
	 * Update a proposal.
	 *
	 * @param id - Proposal UUID
	 * @param data - Fields to update
	 * @returns Updated proposal
	 */
	async update(id: string, data: ProposalUpdate): Promise<Proposal | undefined> {
		return this.db
			.updateTable("proposals")
			.set({ ...data, updated_at: new Date().toISOString() })
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();
	}

	/**
	 * Update proposal status.
	 *
	 * @param id - Proposal UUID
	 * @param status - New status
	 * @returns Updated proposal
	 */
	async updateStatus(id: string, status: string): Promise<Proposal | undefined> {
		const update: ProposalUpdate = { status };
		if (status === "approved" || status === "rejected") {
			update.actioned_at = new Date().toISOString();
		}
		return this.update(id, update);
	}

	/**
	 * Record source artifacts for a proposal (AC 1: record P8 output before plan generation).
	 *
	 * Adds source artifacts and sets the source_recorded_at timestamp.
	 * This should be called before any plan is generated from the proposal.
	 *
	 * @param id - Proposal UUID
	 * @param artifacts - Array of source artifact descriptors
	 * @returns Updated proposal
	 */
	async recordSourceArtifacts(id: string, artifacts: SourceArtifact[]): Promise<Proposal | undefined> {
		const now = new Date().toISOString();
		return this.db
			.updateTable("proposals")
			.set({
				source_artifacts: JSON.stringify(artifacts) as any,
				source_recorded_at: now,
				updated_at: now,
			})
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();
	}

	/**
	 * Get source artifacts for a proposal.
	 *
	 * @param id - Proposal UUID
	 * @returns Array of source artifacts or undefined if proposal not found
	 */
	async getSourceArtifacts(id: string): Promise<SourceArtifact[] | undefined> {
		const proposal = await this.findById(id);
		return proposal?.source_artifacts as SourceArtifact[] | undefined;
	}

	/**
	 * Check if source artifacts have been recorded for a proposal.
	 *
	 * @param id - Proposal UUID
	 * @returns True if source artifacts are recorded
	 */
	async hasSourceArtifacts(id: string): Promise<boolean> {
		const proposal = await this.findById(id);
		return proposal?.source_recorded_at != null;
	}

	/**
	 * Count proposals matching optional filters.
	 *
	 * @param projectId - Optional project UUID
	 * @param status - Optional status filter
	 * @returns Count of matching proposals
	 */
	async count(projectId?: string, status?: string): Promise<number> {
		let query = this.db.selectFrom("proposals").select(this.db.fn.countAll<number>().as("count"));

		if (projectId) {
			query = query.where("project_id", "=", projectId);
		}
		if (status) {
			query = query.where("status", "=", status);
		}

		const result = await query.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	/**
	 * Delete a proposal.
	 *
	 * @param id - Proposal UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("proposals").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}
}
