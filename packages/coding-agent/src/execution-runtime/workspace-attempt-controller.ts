import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import { AttemptEventJournal } from "./attempt-event-journal.js";
import { assertLegalTransition, assertRetryAllowed } from "./attempt-fsm.js";
import { createStateAuthorityToken } from "./state-authority.js";
import type { AttemptEventType, AttemptState, AttemptTransitionResult } from "./types.js";

export type AttemptControllerEventType = AttemptEventType | "retry" | "succeeded" | "failed_final";

const ATTEMPT_CONTROLLER_EVENT_TYPES = new Set<AttemptControllerEventType>([
	"attempt_started",
	"attempt_progressed",
	"attempt_blocked",
	"handoff_required",
	"deadline_exceeded",
	"attempt_succeeded",
	"attempt_failed",
	"legacy_state_write_detected",
	"legacy_state_write_rejected",
	"retry",
	"succeeded",
	"failed_final",
]);

function assertAttemptControllerEventType(eventType: string): asserts eventType is AttemptControllerEventType {
	if (!ATTEMPT_CONTROLLER_EVENT_TYPES.has(eventType as AttemptControllerEventType)) {
		throw new Error(`Unknown attempt event: ${eventType}`);
	}
}

export class WorkspaceAttemptController {
	private readonly journal: AttemptEventJournal;

	constructor(
		private readonly db: Kysely<Database>,
		private readonly controllerId: string,
	) {
		this.journal = new AttemptEventJournal(db);
	}

	async handleEvent(
		attemptId: string,
		eventType: AttemptControllerEventType,
		payload: Record<string, unknown> = {},
	): Promise<void> {
		assertAttemptControllerEventType(eventType);
		const attempt = await this.db.selectFrom("attempts").selectAll().where("id", "=", attemptId).executeTakeFirst();
		if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
		const currentState = attempt.current_state as AttemptState;
		if (eventType === "retry") assertRetryAllowed(currentState);
		const nextState = this.reduceEvent(currentState, eventType);
		assertLegalTransition(currentState, nextState);
		const token = createStateAuthorityToken(attemptId, this.controllerId);
		const result = await this.transition(token, nextState, currentState, attempt.version, attempt.id, payload);
		await this.journal.append({
			eventId: crypto.randomUUID(),
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
		currentState: AttemptState,
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
				from_state: currentState,
				to_state: nextState,
				expected_version: expectedVersion,
				next_version: expectedVersion + 1,
				event_id: crypto.randomUUID(),
				metadata: payload,
				created_at: new Date().toISOString(),
			})
			.execute();
		return { state: nextState, version: expectedVersion + 1, deadlineAt: null };
	}

	private reduceEvent(state: AttemptState, eventType: AttemptControllerEventType): AttemptState {
		switch (eventType) {
			case "retry":
				return "READY";
			case "handoff_required":
				return "HANDOFF_REQUIRED";
			case "deadline_exceeded":
				return "FAILED_RETRYABLE";
			case "succeeded":
			case "attempt_succeeded":
				return "SUCCEEDED";
			case "failed_final":
				return "FAILED_FINAL";
			case "attempt_started":
				return "RUNNING";
			case "attempt_failed":
				return "FAILED_RETRYABLE";
			case "attempt_blocked":
				return "BLOCKED";
			case "attempt_progressed":
			case "legacy_state_write_detected":
			case "legacy_state_write_rejected":
				return state;
		}
		const _exhaustive: never = eventType;
		return _exhaustive;
	}
}
