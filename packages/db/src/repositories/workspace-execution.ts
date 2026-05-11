/**
 * Workspace execution repository.
 *
 * Provides CRUD operations for workspace executions.
 */

import type { Kysely } from "kysely";
import type { Database, NewWorkspaceExecution, WorkspaceExecution, WorkspaceExecutionUpdate } from "../types.js";

/**
 * Workspace execution repository
 */
export class WorkspaceExecutionRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new workspace execution.
	 *
	 * @param data - Workspace execution data
	 * @returns Created workspace execution
	 */
	async create(data: NewWorkspaceExecution): Promise<WorkspaceExecution> {
		return this.db.insertInto("workspace_executions").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find workspace execution by ID.
	 *
	 * @param id - Workspace execution UUID
	 * @returns Workspace execution or undefined
	 */
	async findById(id: string): Promise<WorkspaceExecution | undefined> {
		return this.db.selectFrom("workspace_executions").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * List workspace executions for a plan.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @returns Array of workspace executions
	 */
	async listByPlanExecution(planExecutionId: string): Promise<WorkspaceExecution[]> {
		return this.db
			.selectFrom("workspace_executions")
			.selectAll()
			.where("plan_execution_id", "=", planExecutionId)
			.orderBy("created_at", "asc")
			.execute();
	}

	/**
	 * Update a workspace execution.
	 *
	 * @param id - Workspace execution UUID
	 * @param data - Fields to update
	 * @returns Updated workspace execution
	 */
	async update(id: string, data: WorkspaceExecutionUpdate): Promise<WorkspaceExecution | undefined> {
		return this.db
			.updateTable("workspace_executions")
			.set({ ...data, updated_at: new Date().toISOString() })
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();
	}

	/**
	 * Update workspace execution stage.
	 *
	 * @param id - Workspace execution UUID
	 * @param stage - New stage
	 * @returns Updated workspace execution
	 */
	async updateStage(id: string, stage: WorkspaceExecution["stage"]): Promise<WorkspaceExecution | undefined> {
		const update: WorkspaceExecutionUpdate = { stage };
		if (stage === "active") {
			update.started_at = new Date().toISOString();
		}
		if (stage === "complete" || stage === "failed") {
			update.completed_at = new Date().toISOString();
		}
		return this.update(id, update);
	}

	/**
	 * Increment retry attempt counter.
	 *
	 * @param id - Workspace execution UUID
	 * @returns Updated workspace execution
	 */
	async incrementAttempts(id: string): Promise<WorkspaceExecution | undefined> {
		const current = await this.findById(id);
		if (!current) return undefined;

		return this.update(id, { attempts: current.attempts + 1 });
	}

	/**
	 * Get statistics for a plan execution.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @returns Statistics object
	 */
	async getStats(planExecutionId: string): Promise<{
		total: number;
		pending: number;
		active: number;
		complete: number;
		blocked: number;
		failed: number;
	}> {
		const rows = await this.listByPlanExecution(planExecutionId);

		const stats = { total: rows.length, pending: 0, active: 0, complete: 0, blocked: 0, failed: 0 };
		for (const row of rows) {
			switch (row.stage) {
				case "pending":
					stats.pending++;
					break;
				case "active":
					stats.active++;
					break;
				case "complete":
					stats.complete++;
					break;
				case "blocked":
					stats.blocked++;
					break;
				case "failed":
					stats.failed++;
					break;
			}
		}
		return stats;
	}

	/**
	 * Delete all workspace executions for a plan.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @returns Number of deleted rows
	 */
	async deleteByPlanExecution(planExecutionId: string): Promise<number> {
		const result = await this.db
			.deleteFrom("workspace_executions")
			.where("plan_execution_id", "=", planExecutionId)
			.executeTakeFirst();
		return Number(result.numDeletedRows);
	}
}
