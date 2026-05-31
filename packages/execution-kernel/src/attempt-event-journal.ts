import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import type { AttemptEventRow, AttemptEventType } from "./types.js";

export class AttemptEventJournal {
	constructor(private readonly db: Kysely<Database>) {}

	async append(event: {
		eventId: string;
		attemptId: string;
		planExecutionId: string;
		workspaceExecutionId: string;
		eventType: AttemptEventType;
		eventVersion: number;
		payload?: Record<string, unknown> | null;
	}): Promise<void> {
		await this.db
			.insertInto("attempt_events")
			.values({
				event_id: event.eventId,
				attempt_id: event.attemptId,
				plan_execution_id: event.planExecutionId,
				workspace_execution_id: event.workspaceExecutionId,
				event_type: event.eventType,
				event_version: event.eventVersion,
				payload: event.payload ?? null,
			})
			.onConflict((oc) => oc.column("event_id").doNothing())
			.execute();
	}

	async listByAttempt(attemptId: string): Promise<AttemptEventRow[]> {
		return (await this.db
			.selectFrom("attempt_events")
			.selectAll()
			.where("attempt_id", "=", attemptId)
			.orderBy("seq", "asc")
			.execute()) as unknown as AttemptEventRow[];
	}
}
