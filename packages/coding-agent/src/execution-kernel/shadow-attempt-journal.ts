import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import { AttemptEventJournal } from "./attempt-event-journal.js";
import type { AttemptEventType } from "./types.js";

/**
 * Shadow attempt journal — maps legacy state changes to execution kernel
 * events without changing legacy behavior (P28.B).
 *
 * Each legacy workspace execution maps to a shadow attempt using the
 * synthetic ID pattern `shadow:ws:<workspace_execution_id>`.
 */
export class ShadowAttemptJournal {
	private readonly journal: AttemptEventJournal;

	constructor(db: Kysely<Database>) {
		this.journal = new AttemptEventJournal(db);
	}

	/**
	 * Derive a shadow attempt ID from a workspace execution ID.
	 */
	static shadowAttemptId(workspaceExecutionId: string): string {
		return `shadow:ws:${workspaceExecutionId}`;
	}

	/**
	 * Derive a shadow attempt ID from a plan execution ID (for plan-level events).
	 */
	static shadowPlanAttemptId(planExecutionId: string): string {
		return `shadow:plan:${planExecutionId}`;
	}

	/**
	 * Emit a shadow event for a legacy state write.
	 *
	 * @param attemptId - Shadow attempt ID
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceExecutionId - Workspace execution ID (or plan ID for plan-level)
	 * @param eventType - The execution kernel event type
	 * @param version - Shadow event version number
	 * @param payload - Additional metadata about the legacy write
	 */
	async emitLegacyEvent(
		attemptId: string,
		planExecutionId: string,
		workspaceExecutionId: string,
		eventType: AttemptEventType,
		version: number,
		payload?: Record<string, unknown> | null,
	): Promise<void> {
		await this.journal.append({
			eventId: `shadow:${attemptId}:${version}:${eventType}`,
			attemptId,
			planExecutionId,
			workspaceExecutionId,
			eventType,
			eventVersion: version,
			payload: {
				...(payload ?? {}),
				_shadow: true,
				_shadow_source: "legacy_state_store",
			},
		});
	}

	/**
	 * Map a legacy workspace stage to an execution kernel event type.
	 */
	static legacyStageToEvent(stage: string): AttemptEventType {
		switch (stage) {
			case "pending":
			case "active":
				return "attempt_started";
			case "complete":
				return "attempt_succeeded";
			case "failed":
				return "attempt_failed";
			case "blocked":
				return "attempt_blocked";
			default:
				return "legacy_state_write_detected";
		}
	}

	/**
	 * Map a legacy plan status to an execution kernel event type.
	 */
	static legacyPlanStatusToEvent(status: string): AttemptEventType {
		switch (status) {
			case "running":
				return "attempt_progressed";
			case "complete":
				return "attempt_succeeded";
			case "failed":
			case "stopped":
				return "attempt_failed";
			case "cancelled":
				return "legacy_state_write_detected";
			case "awaiting_handoff":
				return "handoff_required";
			case "paused":
				return "attempt_blocked";
			default:
				return "legacy_state_write_detected";
		}
	}

	/**
	 * List all shadow events for a given shadow attempt, ordered by seq.
	 */
	async listShadowEvents(attemptId: string): Promise<
		Array<{
			seq: number;
			eventType: AttemptEventType;
			eventVersion: number;
			payload: Record<string, unknown> | null;
			createdAt: string;
		}>
	> {
		const rows = await this.journal.listByAttempt(attemptId);
		return rows.map((r) => ({
			seq: Number(r.seq),
			eventType: r.event_type as AttemptEventType,
			eventVersion: r.event_version,
			payload: r.payload,
			createdAt: r.created_at,
		}));
	}
}

/**
 * Legacy state change event emitted by the shadow adapter.
 */
export interface LegacyStateChangeEvent {
	type: "workspace" | "plan" | "control_request";
	executionId: string;
	workspaceExecutionId?: string;
	oldStatus: string;
	newStatus: string;
	shadowAttemptId: string;
	eventType: AttemptEventType;
	timestamp: number;
}

/**
 * Determine the kernel event type and attempt ID for a legacy workspace transition.
 */
export function mapWorkspaceTransition(
	workspaceExecutionId: string,
	_planExecutionId: string,
	newStage: string,
): { attemptId: string; eventType: AttemptEventType } {
	return {
		attemptId: ShadowAttemptJournal.shadowAttemptId(workspaceExecutionId),
		eventType: ShadowAttemptJournal.legacyStageToEvent(newStage),
	};
}

/**
 * Determine the kernel event type and attempt ID for a legacy plan status change.
 */
export function mapPlanTransition(
	planExecutionId: string,
	newStatus: string,
): { attemptId: string; eventType: AttemptEventType } {
	return {
		attemptId: ShadowAttemptJournal.shadowPlanAttemptId(planExecutionId),
		eventType: ShadowAttemptJournal.legacyPlanStatusToEvent(newStatus),
	};
}
