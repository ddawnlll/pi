"use strict";
/**
 * Workspace execution repository.
 *
 * Provides CRUD operations for workspace executions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceExecutionRepository = void 0;
/**
 * Workspace execution repository
 */
class WorkspaceExecutionRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Create a new workspace execution.
     *
     * @param data - Workspace execution data
     * @returns Created workspace execution
     */
    async create(data) {
        return this.db.insertInto("workspace_executions").values(data).returningAll().executeTakeFirstOrThrow();
    }
    /**
     * Find workspace execution by ID.
     *
     * @param id - Workspace execution UUID
     * @returns Workspace execution or undefined
     */
    async findById(id) {
        return this.db.selectFrom("workspace_executions").selectAll().where("id", "=", id).executeTakeFirst();
    }
    /**
     * List workspace executions for a plan.
     *
     * @param planExecutionId - Plan execution UUID
     * @returns Array of workspace executions
     */
    async listByPlanExecution(planExecutionId) {
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
    async update(id, data) {
        return this.db
            .updateTable("workspace_executions")
            .set(Object.assign(Object.assign({}, data), { updated_at: new Date().toISOString() }))
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
    async updateStage(id, stage) {
        const update = { stage };
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
    async incrementAttempts(id) {
        const current = await this.findById(id);
        if (!current)
            return undefined;
        return this.update(id, { attempts: current.attempts + 1 });
    }
    /**
     * Get statistics for a plan execution.
     *
     * @param planExecutionId - Plan execution UUID
     * @returns Statistics object
     */
    async getStats(planExecutionId) {
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
    async deleteByPlanExecution(planExecutionId) {
        const result = await this.db
            .deleteFrom("workspace_executions")
            .where("plan_execution_id", "=", planExecutionId)
            .executeTakeFirst();
        return Number(result.numDeletedRows);
    }
}
exports.WorkspaceExecutionRepository = WorkspaceExecutionRepository;
