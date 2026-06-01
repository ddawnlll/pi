/**
 * Runtime Event Emitter — P41.03
 *
 * Typed event emission bridge between execution components and the event store.
 * Wraps IEventStore with typed emit methods keyed off the ExecutionEventPayloadMap,
 * providing a convenient runtime API for emitting events from any part of the
 * execution platform (autonomous-executor, transition-router, completion-gate, etc).
 *
 * Consumption path:
 *   Component → RuntimeEventEmitter.emit*() → IEventStore.appendEvent() → Event Spine
 *
 * Usage:
 *   const emitter = new RuntimeEventEmitter(eventStore, planExecutionId, workspaceId);
 *   await emitter.emitPlanStarted({ planId, phase, title, totalWorkspaces });
 *   await emitter.emitWorkspaceTransition(toStage, { fromStage, attemptNumber });
 *   const child = emitter.child({ workspaceId: "ws-2" });
 *   await child.emitWorkerStarted({ runId, attemptNumber });
 */

import type { IEventStore } from "./event-store.js";
import type {
	BrainApprovedPayload,
	BrainProposedPayload,
	BrainRejectedPayload,
	CommandFinishedPayload,
	CommandOutputPayload,
	CommandStartedPayload,
	ExecutionEventPayloadMap,
	ExecutionEventType,
	GovernanceApprovedPayload,
	GovernanceCheckStartedPayload,
	GovernanceEscalatedPayload,
	GovernanceRejectedPayload,
	LeadAgentDirectiveAcknowledgedPayload,
	LeadAgentDirectiveIssuedPayload,
	LeadAgentEscalationInitiatedPayload,
	LeadAgentEscalationResolvedPayload,
	LeadAgentReviewStartedPayload,
	PlanCancelledPayload,
	PlanCompletedPayload,
	PlanFailedPayload,
	PlanPausedPayload,
	PlanResumedPayload,
	PlanStartedPayload,
	PlanStoppedPayload,
	SystemErrorPayload,
	SystemInfoPayload,
	SystemWarningPayload,
	WorkerCancelledPayload,
	WorkerCompletedPayload,
	WorkerFailedPayload,
	WorkerStartedPayload,
	WorkerTimedOutPayload,
	WorkspaceExecutionStage,
	WorkspaceStageChangedPayload,
} from "./events.js";
import { createExecutionEvent, workspaceStageToEventType } from "./events.js";
import type { PiLogger } from "./logger.js";
import type { WorkerEvent } from "./worker-adapter.js";
import type { IWorkerTranscriptStore, JournalEvent, WorkerTranscriptEvent } from "./worker-transcript.js";
import { buildTranscriptSummary, createWorkerTranscriptEvent } from "./worker-transcript.js";

// ---------------------------------------------------------------------------
// RuntimeEventEmitter
// ---------------------------------------------------------------------------

/**
 * Typed runtime event emitter.
 *
 * Construct with an IEventStore and the execution context (planExecutionId,
 * optional workspaceId). Methods emit structured ExecutionEvents via the store
 * and return the generated eventId (UUID).
 */
export class RuntimeEventEmitter {
	constructor(
		private readonly store: IEventStore,
		private readonly planExecutionId: string,
		private readonly workspaceId?: string,
		private readonly logger?: PiLogger,
		private readonly transcriptStore?: IWorkerTranscriptStore,
	) {}

	// -----------------------------------------------------------------------
	// Derivation
	// -----------------------------------------------------------------------

	/**
	 * Create a child emitter that inherits the parent's store and planExecutionId
	 * but overrides workspaceId (and optionally planExecutionId).
	 * The parent emitter is not affected.
	 */
	child(overrides: { planExecutionId?: string; workspaceId?: string }): RuntimeEventEmitter {
		return new RuntimeEventEmitter(
			this.store,
			overrides.planExecutionId ?? this.planExecutionId,
			overrides.workspaceId ?? this.workspaceId,
			this.logger,
			this.transcriptStore,
		);
	}

	// -----------------------------------------------------------------------
	// Generic emit
	// -----------------------------------------------------------------------

	/**
	 * Emit a typed execution event by type literal.
	 * Returns the generated eventId (UUID).
	 *
	 * @example
	 *   await emitter.emit("system_info", { message: "hello", planExecutionId });
	 */
	async emit<T extends ExecutionEventType>(
		type: T,
		payload: ExecutionEventPayloadMap[T],
		workspaceId?: string,
	): Promise<string> {
		const event = createExecutionEvent(type, payload);
		const wsId = workspaceId ?? this.workspaceId;

		this.logger?.debug(`Emitting event: ${type}`, {
			planExecutionId: this.planExecutionId,
			workspaceId: wsId,
		});

		return this.store.appendEvent(this.planExecutionId, event, wsId);
	}

	// -----------------------------------------------------------------------
	// Plan events
	// -----------------------------------------------------------------------

	/** Emit plan_started. */
	async emitPlanStarted(payload: PlanStartedPayload): Promise<string> {
		return this.emit("plan_started", payload);
	}

	/** Emit plan_completed. */
	async emitPlanCompleted(payload: PlanCompletedPayload): Promise<string> {
		return this.emit("plan_completed", payload);
	}

	/** Emit plan_failed. */
	async emitPlanFailed(payload: PlanFailedPayload): Promise<string> {
		return this.emit("plan_failed", payload);
	}

	/** Emit plan_paused. */
	async emitPlanPaused(payload: PlanPausedPayload): Promise<string> {
		return this.emit("plan_paused", payload);
	}

	/** Emit plan_resumed. */
	async emitPlanResumed(payload: PlanResumedPayload): Promise<string> {
		return this.emit("plan_resumed", payload);
	}

	/** Emit plan_cancelled. */
	async emitPlanCancelled(payload: PlanCancelledPayload): Promise<string> {
		return this.emit("plan_cancelled", payload);
	}

	/** Emit plan_stopped. */
	async emitPlanStopped(payload: PlanStoppedPayload): Promise<string> {
		return this.emit("plan_stopped", payload);
	}

	// -----------------------------------------------------------------------
	// Workspace events
	// -----------------------------------------------------------------------

	/**
	 * Emit a workspace stage change event.
	 * Automatically selects the correct event type based on the target stage,
	 * or you may pass an explicit eventType to override.
	 *
	 * @example
	 *   await emitter.emitWorkspaceTransition("Running", {
	 *     fromStage: "Pending",
	 *     toStage: "Running",
	 *     attemptNumber: 1,
	 *   });
	 */
	async emitWorkspaceTransition(
		toStage: WorkspaceExecutionStage,
		payload: WorkspaceStageChangedPayload,
	): Promise<string> {
		const eventType = workspaceStageToEventType(toStage);
		if (!eventType) {
			throw new Error(`No event type mapped for workspace stage: ${toStage}`);
		}
		return this.emit(eventType as any, payload);
	}

	// -----------------------------------------------------------------------
	// Worker lifecycle events
	// -----------------------------------------------------------------------

	/** Emit worker_started. */
	async emitWorkerStarted(payload: WorkerStartedPayload): Promise<string> {
		return this.emit("worker_started", payload, payload.workspaceId);
	}

	/** Emit worker_completed. */
	async emitWorkerCompleted(payload: WorkerCompletedPayload): Promise<string> {
		return this.emit("worker_completed", payload, payload.workspaceId);
	}

	/** Emit worker_failed. */
	async emitWorkerFailed(payload: WorkerFailedPayload): Promise<string> {
		return this.emit("worker_failed", payload, payload.workspaceId);
	}

	/** Emit worker_timed_out. */
	async emitWorkerTimedOut(payload: WorkerTimedOutPayload): Promise<string> {
		return this.emit("worker_timed_out", payload, payload.workspaceId);
	}

	/** Emit worker_cancelled. */
	async emitWorkerCancelled(payload: WorkerCancelledPayload): Promise<string> {
		return this.emit("worker_cancelled", payload, payload.workspaceId);
	}

	// -----------------------------------------------------------------------
	// Command execution events
	// -----------------------------------------------------------------------

	/** Emit command_started. */
	async emitCommandStarted(payload: CommandStartedPayload): Promise<string> {
		return this.emit("command_started", payload, payload.workspaceId);
	}

	/** Emit command_finished. */
	async emitCommandFinished(payload: CommandFinishedPayload): Promise<string> {
		return this.emit("command_finished", payload, payload.workspaceId);
	}

	/** Emit command_output — stream stdout/stderr chunk during command execution. */
	async emitCommandOutput(payload: CommandOutputPayload): Promise<string> {
		return this.emit("command_output", payload, payload.workspaceId);
	}

	// -----------------------------------------------------------------------
	// Brain proposal events
	// -----------------------------------------------------------------------

	/** Emit brain_proposed. */
	async emitBrainProposed(payload: BrainProposedPayload): Promise<string> {
		return this.emit("brain_proposed", payload);
	}

	/** Emit brain_approved. */
	async emitBrainApproved(payload: BrainApprovedPayload): Promise<string> {
		return this.emit("brain_approved", payload);
	}

	/** Emit brain_rejected. */
	async emitBrainRejected(payload: BrainRejectedPayload): Promise<string> {
		return this.emit("brain_rejected", payload);
	}

	// -----------------------------------------------------------------------
	// Lead Agent escalation events (P41.09)
	// -----------------------------------------------------------------------

	/** Emit lead_agent_review_started when the Lead Agent begins reviewing a failure. */
	async emitLeadAgentReviewStarted(payload: LeadAgentReviewStartedPayload): Promise<string> {
		return this.emit("lead_agent_review_started", payload, payload.workspaceId);
	}

	/** Emit lead_agent_directive_issued when the Lead Agent issues a directive. */
	async emitLeadAgentDirectiveIssued(payload: LeadAgentDirectiveIssuedPayload): Promise<string> {
		return this.emit("lead_agent_directive_issued", payload, payload.workspaceId);
	}

	/** Emit lead_agent_directive_acknowledged when a worker acknowledges a directive. */
	async emitLeadAgentDirectiveAcknowledged(payload: LeadAgentDirectiveAcknowledgedPayload): Promise<string> {
		return this.emit("lead_agent_directive_acknowledged", payload, payload.workspaceId);
	}

	/** Emit lead_agent_escalation_initiated when the Lead Agent escalates to the user. */
	async emitLeadAgentEscalationInitiated(payload: LeadAgentEscalationInitiatedPayload): Promise<string> {
		return this.emit("lead_agent_escalation_initiated", payload, payload.workspaceId);
	}

	/** Emit lead_agent_escalation_resolved when the user responds to an escalation. */
	async emitLeadAgentEscalationResolved(payload: LeadAgentEscalationResolvedPayload): Promise<string> {
		return this.emit("lead_agent_escalation_resolved", payload, payload.workspaceId);
	}

	// -----------------------------------------------------------------------
	// Governance events
	// -----------------------------------------------------------------------

	/** Emit governance_check_started. */
	async emitGovernanceCheckStarted(payload: GovernanceCheckStartedPayload): Promise<string> {
		return this.emit("governance_check_started", payload);
	}

	/** Emit governance_approved. */
	async emitGovernanceApproved(payload: GovernanceApprovedPayload): Promise<string> {
		return this.emit("governance_approved", payload);
	}

	/** Emit governance_rejected. */
	async emitGovernanceRejected(payload: GovernanceRejectedPayload): Promise<string> {
		return this.emit("governance_rejected", payload);
	}

	/** Emit governance_escalated. */
	async emitGovernanceEscalated(payload: GovernanceEscalatedPayload): Promise<string> {
		return this.emit("governance_escalated", payload);
	}

	// -----------------------------------------------------------------------
	// System events
	// -----------------------------------------------------------------------

	/** Emit system_error. */
	async emitSystemError(payload: SystemErrorPayload): Promise<string> {
		return this.emit("system_error", payload);
	}

	/** Emit system_warning. */
	async emitSystemWarning(payload: SystemWarningPayload): Promise<string> {
		return this.emit("system_warning", payload);
	}

	/** Emit system_info. */
	async emitSystemInfo(payload: SystemInfoPayload): Promise<string> {
		return this.emit("system_info", payload);
	}

	// -----------------------------------------------------------------------
	// WorkerEvent bridge
	// -----------------------------------------------------------------------

	/**
	 * Bridge: store an array of WorkerEvent objects (as returned by WorkerAdapter.run())
	 * as ExecutionEvent records in the event store.
	 *
	 * WorkerEvent is untyped (string type + Record payload). The bridge stores each
	 * worker event verbatim using the "system_info" event type (or a mapping if the
	 * worker event type matches a known ExecutionEventType).
	 *
	 * Returns the list of generated eventIds.
	 */
	async emitWorkerEvents(workerEvents: WorkerEvent[], workspaceId?: string): Promise<string[]> {
		const eventIds: string[] = [];
		for (const we of workerEvents) {
			// Try to match the WorkerEvent type to a known ExecutionEventType
			const knownType = this.resolveWorkerEventType(we.type);
			const payload: Record<string, unknown> = {
				...we.payload,
				_sourceWorkerType: we.type,
			};

			const event = createExecutionEvent(knownType, payload as any);
			const wsId = workspaceId ?? this.workspaceId;
			const eventId = await this.store.appendEvent(this.planExecutionId, event, wsId);
			eventIds.push(eventId);
		}
		return eventIds;
	}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Map a WorkerEvent type string to a known ExecutionEventType.
	 * Falls back to "system_info" for unrecognized types.
	 */
	private resolveWorkerEventType(type: string): ExecutionEventType {
		const knownTypes = [
			"plan_started",
			"plan_completed",
			"plan_failed",
			"plan_paused",
			"plan_resumed",
			"plan_cancelled",
			"plan_stopped",
			"workspace_pending",
			"workspace_running",
			"workspace_completed",
			"workspace_failed",
			"workspace_blocked",
			"workspace_cancelled",
			"workspace_skipped",
			"workspace_paused",
			"workspace_timed_out",
			"worker_started",
			"worker_completed",
			"worker_failed",
			"worker_timed_out",
			"worker_cancelled",
			"command_started",
			"command_finished",
			"brain_proposed",
			"brain_approved",
			"brain_rejected",
			"governance_check_started",
			"governance_approved",
			"governance_rejected",
			"governance_escalated",
			"lead_agent_review_started",
			"lead_agent_directive_issued",
			"lead_agent_directive_acknowledged",
			"lead_agent_escalation_initiated",
			"lead_agent_escalation_resolved",
			"system_error",
			"system_warning",
			"system_info",
		] as const;

		if (knownTypes.includes(type as any)) {
			return type as ExecutionEventType;
		}
		return "system_info";
	}

	// -----------------------------------------------------------------------
	// Worker Transcript bridge
	// -----------------------------------------------------------------------

	/**
	 * Derive and store a transcript event from a raw journal event.
	 *
	 * Takes a JournalEvent, builds a human-readable summary, creates a sanitized
	 * WorkerTranscriptEvent, and persists it via the optional IWorkerTranscriptStore.
	 *
	 * This is the primary bridge between the raw journal event pipeline and the
	 * sanitized transcript pipeline consumed by the dashboard UI.
	 *
	 * @param journalEvent - Raw journal event to derive a transcript from
	 * @param workspaceId - Workspace ID (defaults to emitter's workspaceId)
	 * @returns The generated transcript event, or null if skipped (no store,
	 *          no workspaceId, or private thinking event)
	 */
	async emitTranscriptFromJournal(
		journalEvent: JournalEvent,
		workspaceId?: string,
	): Promise<WorkerTranscriptEvent | null> {
		if (!this.transcriptStore) return null;

		const wsId = workspaceId ?? journalEvent.workspaceId ?? this.workspaceId;
		if (!wsId) return null;

		const summary = buildTranscriptSummary(journalEvent);
		const transcriptEvent = createWorkerTranscriptEvent({ ...journalEvent, workspaceId: wsId }, summary);

		if (!transcriptEvent) return null;

		await this.transcriptStore.appendTranscriptEvent(this.planExecutionId, wsId, transcriptEvent);

		return transcriptEvent;
	}

	/**
	 * Emit a raw worker transcript event directly (already sanitized).
	 *
	 * Use this when you have already constructed the WorkerTranscriptEvent
	 * (e.g., from an existing pipeline). For automatic derivation from a
	 * JournalEvent, use emitTranscriptFromJournal instead.
	 *
	 * @param workspaceId - Workspace ID
	 * @param event - The sanitized WorkerTranscriptEvent to store
	 */
	async emitTranscriptEvent(workspaceId: string, event: WorkerTranscriptEvent): Promise<void> {
		if (!this.transcriptStore) return;
		await this.transcriptStore.appendTranscriptEvent(this.planExecutionId, workspaceId, event);
	}
}
