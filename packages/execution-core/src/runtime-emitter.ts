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
	ExecutionEventType,
	ExecutionEventPayloadMap,
	PlanStartedPayload,
	PlanCompletedPayload,
	PlanFailedPayload,
	PlanPausedPayload,
	PlanResumedPayload,
	PlanCancelledPayload,
	PlanStoppedPayload,
	WorkspaceStageChangedPayload,
	WorkspaceExecutionStage,
	WorkerStartedPayload,
	WorkerCompletedPayload,
	WorkerFailedPayload,
	WorkerTimedOutPayload,
	WorkerCancelledPayload,
	CommandStartedPayload,
	CommandFinishedPayload,
	BrainProposedPayload,
	BrainApprovedPayload,
	BrainRejectedPayload,
	GovernanceCheckStartedPayload,
	GovernanceApprovedPayload,
	GovernanceRejectedPayload,
	GovernanceEscalatedPayload,
	SystemErrorPayload,
	SystemWarningPayload,
	SystemInfoPayload,
} from "./events.js";
import { createExecutionEvent, workspaceStageToEventType } from "./events.js";
import type { PiLogger } from "./logger.js";
import type { WorkerEvent } from "./worker-adapter.js";

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
	async emitWorkerEvents(
		workerEvents: WorkerEvent[],
		workspaceId?: string,
	): Promise<string[]> {
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
			"plan_started", "plan_completed", "plan_failed",
			"plan_paused", "plan_resumed", "plan_cancelled", "plan_stopped",
			"workspace_pending", "workspace_running", "workspace_completed",
			"workspace_failed", "workspace_blocked", "workspace_cancelled",
			"workspace_skipped", "workspace_paused", "workspace_timed_out",
			"worker_started", "worker_completed", "worker_failed",
			"worker_timed_out", "worker_cancelled",
			"command_started", "command_finished",
			"brain_proposed", "brain_approved", "brain_rejected",
			"governance_check_started", "governance_approved",
			"governance_rejected", "governance_escalated",
			"system_error", "system_warning", "system_info",
		] as const;

		if (knownTypes.includes(type as any)) {
			return type as ExecutionEventType;
		}
		return "system_info";
	}
}
