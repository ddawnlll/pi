/**
 * Proposal Rubric repository.
 *
 * Provides CRUD operations for scoring rubrics backed by PostgreSQL.
 * Rubrics define named criteria with weights and max scores for
 * evaluating proposals (P16.C).
 */

import type { Kysely } from "kysely";
import type { Database, NewProposalRubric, ProposalRubric, ProposalRubricUpdate, RubricCriterion } from "../types.js";

/**
 * Filter options for listing rubrics.
 */
export interface RubricFilter {
	limit?: number;
	offset?: number;
}

/**
 * Proposal Rubric repository
 */
export class ProposalRubricRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new rubric.
	 *
	 * @param data - Rubric data
	 * @returns Created rubric
	 */
	async create(data: NewProposalRubric): Promise<ProposalRubric> {
		return this.db.insertInto("proposal_rubrics").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find rubric by ID.
	 *
	 * @param id - Rubric UUID
	 * @returns Rubric or undefined
	 */
	async findById(id: string): Promise<ProposalRubric | undefined> {
		return this.db.selectFrom("proposal_rubrics").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * List rubrics for a project.
	 *
	 * @param projectId - Project UUID
	 * @param filter - Optional filter criteria
	 * @returns Array of rubrics
	 */
	async listByProject(projectId: string, filter?: RubricFilter): Promise<ProposalRubric[]> {
		const query = this.db.selectFrom("proposal_rubrics").selectAll().where("project_id", "=", projectId);

		const limit = filter?.limit ?? 50;
		const offset = filter?.offset ?? 0;

		return query.orderBy("name", "asc").limit(limit).offset(offset).execute();
	}

	/**
	 * List all rubrics across projects.
	 *
	 * @param filter - Optional filter criteria
	 * @returns Array of rubrics
	 */
	async listAll(filter?: RubricFilter): Promise<ProposalRubric[]> {
		const query = this.db.selectFrom("proposal_rubrics").selectAll();

		const limit = filter?.limit ?? 100;
		const offset = filter?.offset ?? 0;

		return query.orderBy("name", "asc").limit(limit).offset(offset).execute();
	}

	/**
	 * Update a rubric.
	 *
	 * @param id - Rubric UUID
	 * @param data - Fields to update
	 * @returns Updated rubric
	 */
	async update(id: string, data: ProposalRubricUpdate): Promise<ProposalRubric | undefined> {
		return this.db
			.updateTable("proposal_rubrics")
			.set({ ...data, updated_at: new Date().toISOString() })
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();
	}

	/**
	 * Delete a rubric.
	 *
	 * @param id - Rubric UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("proposal_rubrics").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}

	/**
	 * Count rubrics for a project.
	 *
	 * @param projectId - Optional project UUID
	 * @returns Count of matching rubrics
	 */
	async count(projectId?: string): Promise<number> {
		let query = this.db.selectFrom("proposal_rubrics").select(this.db.fn.countAll<number>().as("count"));

		if (projectId) {
			query = query.where("project_id", "=", projectId);
		}

		const result = await query.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	/**
	 * Get criteria for a rubric.
	 *
	 * @param id - Rubric UUID
	 * @returns Array of rubric criteria or undefined if rubric not found
	 */
	async getCriteria(id: string): Promise<RubricCriterion[] | undefined> {
		const rubric = await this.findById(id);
		return rubric?.criteria;
	}

	/**
	 * Update criteria for a rubric.
	 *
	 * @param id - Rubric UUID
	 * @param criteria - Array of rubric criteria
	 * @returns Updated rubric
	 */
	async updateCriteria(id: string, criteria: RubricCriterion[]): Promise<ProposalRubric | undefined> {
		return this.update(id, { criteria } as ProposalRubricUpdate);
	}
}
