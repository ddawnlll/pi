/**
 * Plan revision repository.
 *
 * Provides CRUD and query operations for plan revisions.
 * Supports revision history tracking per plan execution (P9.G2).
 */

import type { Kysely } from "kysely";
import type { Database, NewPlanRevision, PlanRevision } from "../types.js";

/**
 * Plan revision filter options
 */
export interface PlanRevisionFilter {
	planExecutionId?: string;
	status?: string;
	limit?: number;
	offset?: number;
}

/**
 * Plan revision repository
 */
export class PlanRevisionRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new plan revision.
	 *
	 * The version_number is auto-incremented based on the
	 * highest existing version for the given plan execution.
	 *
	 * @param data - Plan revision data (version_number can be omitted)
	 * @returns Created plan revision
	 */
	async create(data: Omit<NewPlanRevision, "version_number"> & { version_number?: number }): Promise<PlanRevision> {
		let versionNumber = data.version_number;
		if (versionNumber === undefined) {
			const latest = await this.db
				.selectFrom("plan_revisions")
				.select(this.db.fn.max<number>("version_number").as("max_version"))
				.where("plan_execution_id", "=", data.plan_execution_id)
				.executeTakeFirst();
			versionNumber = (latest?.max_version ?? 0) + 1;
		}

		return this.db
			.insertInto("plan_revisions")
			.values({
				plan_execution_id: data.plan_execution_id,
				version_number: versionNumber,
				title: data.title,
				content: data.content,
				status: data.status ?? "draft",
				diff_summary: data.diff_summary ?? null,
				created_by: data.created_by ?? null,
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	}

	/**
	 * Find plan revision by ID.
	 *
	 * @param id - Revision UUID
	 * @returns Plan revision or undefined
	 */
	async findById(id: string): Promise<PlanRevision | undefined> {
		return this.db.selectFrom("plan_revisions").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * List revisions for a plan execution, ordered by version descending.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @param filter - Optional filter criteria
	 * @returns Array of plan revisions
	 */
	async listByPlanExecution(planExecutionId: string, filter?: PlanRevisionFilter): Promise<PlanRevision[]> {
		let query = this.db.selectFrom("plan_revisions").selectAll().where("plan_execution_id", "=", planExecutionId);

		if (filter?.status) {
			query = query.where("status", "=", filter.status);
		}

		const limit = filter?.limit ?? 50;
		const offset = filter?.offset ?? 0;

		return query.orderBy("version_number", "desc").limit(limit).offset(offset).execute();
	}

	/**
	 * Get the latest revision for a plan execution.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @returns Latest plan revision or undefined
	 */
	async getLatestByPlanExecution(planExecutionId: string): Promise<PlanRevision | undefined> {
		return this.db
			.selectFrom("plan_revisions")
			.selectAll()
			.where("plan_execution_id", "=", planExecutionId)
			.orderBy("version_number", "desc")
			.limit(1)
			.executeTakeFirst();
	}

	/**
	 * Update revision status.
	 *
	 * @param id - Revision UUID
	 * @param status - New status
	 * @returns Updated plan revision or undefined
	 */
	async updateStatus(id: string, status: string): Promise<PlanRevision | undefined> {
		return this.db
			.updateTable("plan_revisions")
			.set({ status })
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();
	}

	/**
	 * Delete a plan revision.
	 *
	 * @param id - Revision UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("plan_revisions").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}

	/**
	 * Count revisions for a plan execution.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @returns Revision count
	 */
	async countByPlanExecution(planExecutionId: string): Promise<number> {
		const result = await this.db
			.selectFrom("plan_revisions")
			.select(this.db.fn.countAll<number>().as("count"))
			.where("plan_execution_id", "=", planExecutionId)
			.executeTakeFirst();
		return Number(result?.count ?? 0);
	}
}
