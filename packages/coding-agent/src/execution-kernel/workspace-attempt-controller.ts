import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import { AttemptEventJournal } from "./attempt-event-journal.js";
import { assertLegalTransition, assertRetryAllowed } from "./attempt-fsm.js";
import { createStateAuthorityToken } from "./state-authority.js";
import type { AttemptState, AttemptTransitionResult } from "./types.js";

export class WorkspaceAttemptController {
	private readonly journal: AttemptEventJournal;

	constructor(
		private readonly db: Kysely<Database>,
		private readonly controllerId: string,
	) {
		this.journal = new AttemptEventJournal(db);
	}

	async handleEvent(attemptId: string, eventType: string, payload: Record<string, unknown> = {}): Promise<void> {
		const attempt = await this.db.selectFrom("attempts").selectAll().where("id", "=", attemptId).executeTakeFirst();
		if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
		const currentState = attempt.current_state as AttemptState;
		if (eventType === "retry") assertRetryAllowed(currentState);
		const nextState = this.reduceEvent(currentState, eventType);
		assertLegalTransition(currentState, nextState);
		const token = createStateAuthorityToken(attemptId, this.controllerId);
		const result = await this.transition(token, nextState, attempt.version, attempt.id, payload);
		await this.journal.append({
			eventId: `${attemptId}:${result.version}:${eventType}`,
			attemptId,
			planExecutionId: String(attempt.plan_execution_id),
			workspaceExecutionId: String(attempt.workspace_execution_id),
			eventType: eventType as never,
			eventVersion: result.version,
			payload,
		});
		if (nextState === "HANDOFF_REQUIRED") {
			await this.db
				.insertInto("handoff_queue")
				.values({
					id: crypto.randomUUID(),
					attempt_id: attemptId,
					plan_execution_id: attempt.plan_execution_id,
					workspace_execution_id: attempt.workspace_execution_id,
					status: "pending",
					reason: String(payload.reason ?? "handoff required"),
					required: true,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.execute();
		}
	}

	async transition(
		_token: ReturnType<typeof createStateAuthorityToken>,
		nextState: AttemptState,
		expectedVersion: number,
		attemptId: string,
		payload: Record<string, unknown>,
	): Promise<AttemptTransitionResult> {
		const updated = await this.db
			.updateTable("attempts")
			.set({
				current_state: nextState,
				version: expectedVersion + 1,
				metadata: payload,
				updated_at: new Date().toISOString(),
			})
			.where("id", "=", attemptId)
			.where("version", "=", expectedVersion)
			.executeTakeFirst();
		if (updated.numUpdatedRows === 0n) throw new Error("version_conflict");
		await this.db
			.insertInto("attempt_transitions")
			.values({
				attempt_id: attemptId,
				from_state: "RUNNING",
				to_state: nextState,
				expected_version: expectedVersion,
				next_version: expectedVersion + 1,
				event_id: `${attemptId}:${expectedVersion + 1}`,
				metadata: payload,
				created_at: new Date().toISOString(),
			})
			.execute();
		return { state: nextState, version: expectedVersion + 1, deadlineAt: null };
	}

	private reduceEvent(state: AttemptState, eventType: string): AttemptState {
		if (eventType === "handoff_required") return "HANDOFF_REQUIRED";
		if (eventType === "deadline_exceeded") return "FAILED_RETRYABLE";
		if (eventType === "succeeded") return "SUCCEEDED";
		if (eventType === "failed_final") return "FAILED_FINAL";
		return state;
	}
}
