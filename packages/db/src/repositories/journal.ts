/**
 * Journal event repository.
 *
 * Provides CRUD and query operations for journal events.
 */

import type { Kysely } from "kysely";
import type { Database, JournalEvent, NewJournalEvent } from "../types.js";

/**
 * Journal event filter options
 */
export interface JournalEventFilter {
	planExecutionId?: string;
	workspaceExecutionId?: string;
	eventTypes?: string[];
	since?: string;
	until?: string;
	limit?: number;
	offset?: number;
}

/**
 * Journal event repository
 */
export class JournalEventRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Insert a new journal event.
	 *
	 * @param data - Journal event data
	 * @returns Created journal event
	 */
	async create(data: NewJournalEvent): Promise<JournalEvent> {
		return this.db.insertInto("journal_events").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find journal event by ID.
	 *
	 * @param id - Journal event UUID
	 * @returns Journal event or undefined
	 */
	async findById(id: string): Promise<JournalEvent | undefined> {
		return this.db.selectFrom("journal_events").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * Query journal events with filters.
	 *
	 * @param filter - Filter options
	 * @returns Array of journal events
	 */
	async query(filter: JournalEventFilter = {}): Promise<JournalEvent[]> {
		let query = this.db.selectFrom("journal_events").selectAll().orderBy("timestamp", "asc");

		if (filter.planExecutionId) {
			query = query.where("plan_execution_id", "=", filter.planExecutionId);
		}
		if (filter.workspaceExecutionId) {
			query = query.where("workspace_execution_id", "=", filter.workspaceExecutionId);
		}
		if (filter.eventTypes && filter.eventTypes.length > 0) {
			query = query.where("event_type", "in", filter.eventTypes);
		}
		if (filter.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter.until) {
			query = query.where("timestamp", "<=", filter.until);
		}

		const limit = filter.limit ?? 100;
		const offset = filter.offset ?? 0;
		query = query.limit(limit).offset(offset);

		return query.execute();
	}

	/**
	 * Get recent events for a plan execution (last N).
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @param limit - Number of events (default: 50)
	 * @returns Array of journal events
	 */
	async getRecentByPlan(planExecutionId: string, limit = 50): Promise<JournalEvent[]> {
		return this.db
			.selectFrom("journal_events")
			.selectAll()
			.where("plan_execution_id", "=", planExecutionId)
			.orderBy("timestamp", "desc")
			.limit(limit)
			.execute();
	}

	/**
	 * Delete journal events for a plan execution.
	 *
	 * @param planExecutionId - Plan execution UUID
	 * @returns Number of deleted rows
	 */
	async deleteByPlanExecution(planExecutionId: string): Promise<number> {
		const result = await this.db
			.deleteFrom("journal_events")
			.where("plan_execution_id", "=", planExecutionId)
			.executeTakeFirst();
		return Number(result.numDeletedRows);
	}
}
