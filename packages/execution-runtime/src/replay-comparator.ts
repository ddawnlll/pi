import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import { AttemptEventJournal } from "./attempt-event-journal.js";
import { getDeadlinePolicy } from "./attempt-fsm.js";
import type { AttemptEventType, AttemptState } from "./types.js";

/**
 * Replayed state derived from shadow events.
 */
export interface ReplayResult {
	/** The shadow attempt ID that was replayed */
	attemptId: string;
	/** The computed state after replaying all events */
	replayedState: AttemptState;
	/** The final event version reached */
	replayedVersion: number;
	/** Total events replayed */
	eventCount: number;
	/** Any deadline policy that would apply */
	deadlineMs: number | null;
}

/**
 * Results of a comparison between replayed state and legacy state.
 */
export interface ComparisonResult<TLegacy> {
	replayed: ReplayResult | null;
	legacy: TLegacy | null;
	diverged: boolean;
	details: string[];
}

/**
 * Replay comparator — reads shadow events from the attempt_events table
 * and replays them through the FSM, then compares the resulting state
 * with the current legacy state (P28.D).
 *
 * This is a read-only operation: it does NOT mutate any state.
 */
export class ReplayComparator {
	private readonly journal: AttemptEventJournal;

	constructor(private readonly db: Kysely<Database>) {
		this.journal = new AttemptEventJournal(db);
	}

	/**
	 * Compare replayed state with a legacy plan execution status.
	 *
	 * @param planExecutionId - Plan execution ID to compare
	 * @returns Divergence report
	 */
	async comparePlanExecution(planExecutionId: string): Promise<ComparisonResult<{ status: string }>> {
		const shadowAttemptId = `shadow:plan:${planExecutionId}`;
		const replayed = await this.replay(shadowAttemptId);

		// Read current legacy state
		const planExec = await this.db
			.selectFrom("plan_executions")
			.select(["status"])
			.where("id", "=", planExecutionId)
			.executeTakeFirst();

		if (!replayed) {
			return {
				replayed: null,
				legacy: planExec ? { status: planExec.status } : null,
				diverged: true,
				details: ["No shadow events found for replay"],
			};
		}

		if (!planExec) {
			return {
				replayed,
				legacy: null,
				diverged: true,
				details: [`Legacy plan execution ${planExecutionId} not found, but shadow events exist`],
			};
		}

		const details: string[] = [];
		let diverged = false;

		// Map replayed state to plan status
		const replayedStatus = this.attemptStateToPlanStatus(replayed.replayedState);
		if (replayedStatus !== planExec.status) {
			diverged = true;
			details.push(
				`Status mismatch: replayed=${replayedStatus} (from state ${replayed.replayedState}), legacy=${planExec.status}`,
			);
		} else {
			details.push(`Status match: ${planExec.status}`);
		}

		details.push(`Events replayed: ${replayed.eventCount}, version: ${replayed.replayedVersion}`);

		return { replayed, legacy: { status: planExec.status }, diverged, details };
	}

	/**
	 * Compare replayed state with a legacy workspace execution stage.
	 *
	 * @param workspaceExecutionId - Workspace execution ID to compare
	 * @returns Divergence report
	 */
	async compareWorkspaceExecution(
		workspaceExecutionId: string,
	): Promise<ComparisonResult<{ stage: string; attempts: number }>> {
		const shadowAttemptId = `shadow:ws:${workspaceExecutionId}`;
		const replayed = await this.replay(shadowAttemptId);

		// Read current legacy state
		const wsExec = await this.db
			.selectFrom("workspace_executions")
			.select(["stage", "attempts"])
			.where("id", "=", workspaceExecutionId)
			.executeTakeFirst();

		if (!replayed) {
			return {
				replayed: null,
				legacy: wsExec ? { stage: wsExec.stage, attempts: wsExec.attempts } : null,
				diverged: true,
				details: ["No shadow events found for replay"],
			};
		}

		if (!wsExec) {
			return {
				replayed,
				legacy: null,
				diverged: true,
				details: [`Legacy workspace execution ${workspaceExecutionId} not found, but shadow events exist`],
			};
		}

		const details: string[] = [];
		let diverged = false;

		// Map replayed state to workspace stage
		const replayedStage = this.attemptStateToWorkspaceStage(replayed.replayedState);
		if (replayedStage !== wsExec.stage) {
			diverged = true;
			details.push(
				`Stage mismatch: replayed=${replayedStage} (from state ${replayed.replayedState}), legacy=${wsExec.stage}`,
			);
		} else {
			details.push(`Stage match: ${wsExec.stage}`);
		}

		details.push(`Events replayed: ${replayed.eventCount}, version: ${replayed.replayedVersion}`);

		return { replayed, legacy: { stage: wsExec.stage, attempts: wsExec.attempts }, diverged, details };
	}

	/**
	 * Replay all shadow events for a given attempt by deriving state
	 * from the latest meaningful event type.
	 *
	 * Uses a derived state model rather than strict FSM transitions:
	 * each event maps independently to an outcome state, and the latest
	 * one wins. This is safe because shadow events are emitted by the
	 * legacy runtime which has already validated the state change.
	 *
	 * Returns null if no events found.
	 */
	async replay(shadowAttemptId: string): Promise<ReplayResult | null> {
		const events = await this.journal.listByAttempt(shadowAttemptId);
		if (events.length === 0) return null;

		let derivedState: AttemptState = "PENDING";
		let currentVersion = 0;
		let eventCount = 0;

		for (const event of events) {
			const eventType = event.event_type as AttemptEventType;
			const nextState = this.deriveState(eventType);
			if (nextState) {
				derivedState = nextState;
			}
			currentVersion = event.event_version;
			eventCount++;
		}

		return {
			attemptId: shadowAttemptId,
			replayedState: derivedState,
			replayedVersion: currentVersion,
			eventCount,
			deadlineMs: getDeadlinePolicy(derivedState),
		};
	}

	/**
	 * Derive an attempt state from an event type.
	 * Returns null for events that don't imply a state change.
	 */
	private deriveState(eventType: AttemptEventType): AttemptState | null {
		switch (eventType) {
			case "handoff_required":
				return "HANDOFF_REQUIRED";
			case "deadline_exceeded":
				return "FAILED_RETRYABLE";
			case "attempt_succeeded":
				return "SUCCEEDED";
			case "attempt_progressed":
				return "RUNNING";
			case "attempt_failed":
				return "FAILED_FINAL";
			case "attempt_blocked":
				return "BLOCKED";
			case "attempt_started":
				return "READY";
			case "legacy_state_write_detected":
				return null;
			default:
				return null;
		}
	}

	/**
	 * Map attempt state to plan execution status.
	 */
	private attemptStateToPlanStatus(state: AttemptState): string {
		switch (state) {
			case "PENDING":
			case "READY":
			case "RUNNING":
			case "BLOCKED":
			case "HANDOFF_REQUIRED":
			case "FINAL_VALIDATION":
				return "running";
			case "SUCCEEDED":
				return "complete";
			case "FAILED_FINAL":
			case "FAILED_RETRYABLE":
				return "failed";
			case "CANCELLED":
				return "cancelled";
		}
	}

	/**
	 * Map attempt state to workspace execution stage.
	 */
	private attemptStateToWorkspaceStage(state: AttemptState): string {
		switch (state) {
			case "PENDING":
				return "pending";
			case "READY":
			case "RUNNING":
				return "active";
			case "BLOCKED":
				return "blocked";
			case "HANDOFF_REQUIRED":
			case "FINAL_VALIDATION":
				return "active";
			case "SUCCEEDED":
				return "complete";
			case "FAILED_FINAL":
			case "FAILED_RETRYABLE":
				return "failed";
			case "CANCELLED":
				return "failed";
		}
	}
}
