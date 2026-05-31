import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";

export class HandoffQueue {
	constructor(private readonly db: Kysely<Database>) {}
	async createRequired(
		attemptId: string,
		planExecutionId: string,
		workspaceExecutionId: string,
		reason: string,
	): Promise<void> {
		await this.db
			.insertInto("handoff_queue" as any)
			.values({
				id: crypto.randomUUID(),
				attempt_id: attemptId,
				plan_execution_id: planExecutionId,
				workspace_execution_id: workspaceExecutionId,
				status: "pending",
				reason,
				required: true,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.execute();
	}
}
