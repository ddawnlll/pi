/**
 * Plan execution repository.
 *
 * Provides CRUD operations for plan executions.
 */

import type { Kysely } from "kysely";
import type { Database, NewPlanExecution, PlanExecution, PlanExecutionUpdate } from "../types.js";

/**
 * Plan execution repository
 */
export class PlanExecutionRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new plan execution.
	 *
	 * @param data - Plan execution data
	 * @returns Created plan execution
	 */
	async create(data: NewPlanExecution): Promise<PlanExecution> {
		return this.db.insertInto("plan_executions").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find plan execution by ID.
	 *
	 * @param id - Plan execution UUID
	 * @returns Plan execution or undefined
	 */
	async findById(id: string): Promise<PlanExecution | undefined> {
		return this.db.selectFrom("plan_executions").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * List plan executions for a project.
	 *
	 * @param projectId - Project UUID
	 * @param limit - Max results (default: 50)
	 * @param offset - Pagination offset (default: 0)
	 * @returns Array of plan executions
	 */
	async listByProject(projectId: string, limit = 50, offset = 0): Promise<PlanExecution[]> {
		return this.db
			.selectFrom("plan_executions")
			.selectAll()
			.where("project_id", "=", projectId)
			.orderBy("started_at", "desc")
			.limit(limit)
			.offset(offset)
			.execute();
	}

	/**
	 * List all plan executions across projects.
	 *
	 * @param limit - Max results (default: 100)
	 * @param offset - Pagination offset (default: 0)
	 * @returns Array of plan executions
	 */
	async listAll(limit = 100, offset = 0): Promise<PlanExecution[]> {
		return this.db
			.selectFrom("plan_executions")
			.selectAll()
			.orderBy("started_at", "desc")
			.limit(limit)
			.offset(offset)
			.execute();
	}

	/**
	 * Update a plan execution.
	 *
	 * @param id - Plan execution UUID
	 * @param data - Fields to update
	 * @returns Updated plan execution
	 */
	async update(id: string, data: PlanExecutionUpdate): Promise<PlanExecution | undefined> {
		return this.db
			.updateTable("plan_executions")
			.set({ ...data, updated_at: new Date().toISOString() })
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();
	}

	/**
	 * Update plan execution status.
	 *
	 * @param id - Plan execution UUID
	 * @param status - New status
	 * @returns Updated plan execution
	 */
	async updateStatus(id: string, status: PlanExecution["status"]): Promise<PlanExecution | undefined> {
		const update: PlanExecutionUpdate = { status };
		if (status === "complete" || status === "failed" || status === "stopped" || status === "cancelled") {
			update.completed_at = new Date().toISOString();
		}
		return this.update(id, update);
	}

	/**
	 * Delete a plan execution.
	 *
	 * @param id - Plan execution UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("plan_executions").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}
}
