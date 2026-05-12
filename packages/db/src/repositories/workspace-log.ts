/**
 * Repository for workspace_logs table operations.
 *
 * Handles CRUD operations for workspace execution logs.
 */

import type { Kysely } from "kysely";
import type { Database, NewWorkspaceLog, WorkspaceLog } from "../types.js";

/**
 * Workspace log repository.
 */
export class WorkspaceLogRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new workspace log entry.
	 */
	async create(log: NewWorkspaceLog): Promise<WorkspaceLog> {
		return await this.db.insertInto("workspace_logs").values(log).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Get logs for a workspace execution.
	 */
	async getByWorkspaceExecution(workspaceExecutionId: string, limit?: number): Promise<WorkspaceLog[]> {
		let query = this.db
			.selectFrom("workspace_logs")
			.selectAll()
			.where("workspace_execution_id", "=", workspaceExecutionId)
			.orderBy("line_number", "asc");

		if (limit) {
			query = query.limit(limit);
		}

		return await query.execute();
	}

	/**
	 * Get recent logs for a workspace execution.
	 */
	async getRecentLogs(workspaceExecutionId: string, limit: number): Promise<WorkspaceLog[]> {
		return await this.db
			.selectFrom("workspace_logs")
			.selectAll()
			.where("workspace_execution_id", "=", workspaceExecutionId)
			.orderBy("line_number", "desc")
			.limit(limit)
			.execute()
			.then((logs) => logs.reverse());
	}

	/**
	 * Get the current line number for a workspace execution.
	 */
	async getMaxLineNumber(workspaceExecutionId: string): Promise<number> {
		const result = await this.db
			.selectFrom("workspace_logs")
			.select((eb) => eb.fn.max("line_number").as("max_line"))
			.where("workspace_execution_id", "=", workspaceExecutionId)
			.executeTakeFirst();

		return (result?.max_line as number) ?? 0;
	}

	/**
	 * Delete all logs for a workspace execution.
	 */
	async deleteByWorkspaceExecution(workspaceExecutionId: string): Promise<void> {
		await this.db.deleteFrom("workspace_logs").where("workspace_execution_id", "=", workspaceExecutionId).execute();
	}
}
