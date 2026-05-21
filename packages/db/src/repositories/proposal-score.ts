/**
 * Proposal Score repository.
 *
 * Provides CRUD operations for proposal scores backed by PostgreSQL.
 * Scores link proposals to rubrics with individual criterion scores
 * and computed totals (P16.C).
 */

import type { Kysely } from "kysely";
import type { CriterionScore, Database, NewProposalScore, ProposalScore, ProposalScoreUpdate } from "../types.js";

/**
 * Filter options for listing scores.
 */
export interface ScoreFilter {
	scored_by?: string;
	limit?: number;
	offset?: number;
}

/**
 * Aggregate score summary for a proposal across rubrics.
 */
export interface ProposalScoreSummary {
	proposal_id: string;
	score_count: number;
	average_total_score: number;
	average_max_score: number;
	average_percentage: number;
	latest_score: ProposalScore | null;
}

/**
 * Proposal Score repository
 */
export class ProposalScoreRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new proposal score.
	 *
	 * @param data - Score data
	 * @returns Created score
	 */
	async create(data: NewProposalScore): Promise<ProposalScore> {
		return this.db.insertInto("proposal_scores").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find score by ID.
	 *
	 * @param id - Score UUID
	 * @returns Score or undefined
	 */
	async findById(id: string): Promise<ProposalScore | undefined> {
		return this.db.selectFrom("proposal_scores").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * List scores for a proposal.
	 *
	 * @param proposalId - Proposal UUID
	 * @param filter - Optional filter criteria
	 * @returns Array of scores
	 */
	async listByProposal(proposalId: string, filter?: ScoreFilter): Promise<ProposalScore[]> {
		let query = this.db.selectFrom("proposal_scores").selectAll().where("proposal_id", "=", proposalId);

		if (filter?.scored_by) {
			query = query.where("scored_by", "=", filter.scored_by);
		}

		const limit = filter?.limit ?? 50;
		const offset = filter?.offset ?? 0;

		return query.orderBy("scored_at", "desc").limit(limit).offset(offset).execute();
	}

	/**
	 * List scores for a rubric.
	 *
	 * @param rubricId - Rubric UUID
	 * @param filter - Optional filter criteria
	 * @returns Array of scores
	 */
	async listByRubric(rubricId: string, filter?: ScoreFilter): Promise<ProposalScore[]> {
		let query = this.db.selectFrom("proposal_scores").selectAll().where("rubric_id", "=", rubricId);

		if (filter?.scored_by) {
			query = query.where("scored_by", "=", filter.scored_by);
		}

		const limit = filter?.limit ?? 100;
		const offset = filter?.offset ?? 0;

		return query.orderBy("scored_at", "desc").limit(limit).offset(offset).execute();
	}

	/**
	 * Find the most recent score for a proposal under a specific rubric.
	 *
	 * @param proposalId - Proposal UUID
	 * @param rubricId - Rubric UUID
	 * @returns Latest score or undefined
	 */
	async findLatestByProposalAndRubric(proposalId: string, rubricId: string): Promise<ProposalScore | undefined> {
		return this.db
			.selectFrom("proposal_scores")
			.selectAll()
			.where("proposal_id", "=", proposalId)
			.where("rubric_id", "=", rubricId)
			.orderBy("scored_at", "desc")
			.limit(1)
			.executeTakeFirst();
	}

	/**
	 * Update a proposal score.
	 *
	 * @param id - Score UUID
	 * @param data - Fields to update
	 * @returns Updated score
	 */
	async update(id: string, data: ProposalScoreUpdate): Promise<ProposalScore | undefined> {
		return this.db.updateTable("proposal_scores").set(data).where("id", "=", id).returningAll().executeTakeFirst();
	}

	/**
	 * Delete a proposal score.
	 *
	 * @param id - Score UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("proposal_scores").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}

	/**
	 * Count scores matching optional filters.
	 *
	 * @param proposalId - Optional proposal UUID
	 * @param rubricId - Optional rubric UUID
	 * @returns Count of matching scores
	 */
	async count(proposalId?: string, rubricId?: string): Promise<number> {
		let query = this.db.selectFrom("proposal_scores").select(this.db.fn.countAll<number>().as("count"));

		if (proposalId) {
			query = query.where("proposal_id", "=", proposalId);
		}
		if (rubricId) {
			query = query.where("rubric_id", "=", rubricId);
		}

		const result = await query.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	/**
	 * Get aggregate score summary for a proposal across all rubrics.
	 *
	 * @param proposalId - Proposal UUID
	 * @returns Score summary or null if no scores exist
	 */
	async getProposalSummary(proposalId: string): Promise<ProposalScoreSummary | null> {
		const rows = await this.db
			.selectFrom("proposal_scores")
			.selectAll()
			.where("proposal_id", "=", proposalId)
			.orderBy("scored_at", "desc")
			.execute();

		if (rows.length === 0) {
			return null;
		}

		const totalScoreSum = rows.reduce((sum, r) => sum + r.total_score, 0);
		const maxScoreSum = rows.reduce((sum, r) => sum + r.max_score, 0);

		return {
			proposal_id: proposalId,
			score_count: rows.length,
			average_total_score: totalScoreSum / rows.length,
			average_max_score: maxScoreSum / rows.length,
			average_percentage: maxScoreSum > 0 ? (totalScoreSum / maxScoreSum) * 100 : 0,
			latest_score: rows[0] ?? null,
		};
	}

	/**
	 * Get the individual criterion scores for a score entry.
	 *
	 * @param id - Score UUID
	 * @returns Array of criterion scores or undefined if score not found
	 */
	async getCriterionScores(id: string): Promise<CriterionScore[] | undefined> {
		const score = await this.findById(id);
		return score?.scores;
	}
}
