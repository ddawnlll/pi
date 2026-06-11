/**
 * PlanLock Lifecycle Events — ACCP 1.2 / PlanSpec v5
 *
 * Emits typed PlanLock lifecycle events over the EventBus.
 * Consumers include:
 * - Dashboard/read-model for lock status visibility
 * - AutonomousExecutor for admission gating
 * - WorkerPacketDeriver for packet creation tracking
 *
 * All event payloads are defined in planlock-types.ts.
 */

import type { EventBus } from "./event-bus.js";
import type {
	CommandGrantDecisionPayload,
	CommandGrantRequestedPayload,
	DeletePolicyBlockedPayload,
	PlanLockAdmittedPayload,
	PlanAmendmentRequestedPayload,
	WorkspacePacketCreatedPayload,
	WorkspacePacketRejectedPayload,
} from "./planlock-types.js";

// =============================================================================
// Event Channel Constants
// =============================================================================

export const PLANLOCK_EVENTS = {
	/** PlanLock has been admitted (validated and locked for execution) */
	PLAN_LOCK_ADMITTED: "planlock:admitted",
	/** A workspace packet has been derived from the lock */
	WORKSPACE_PACKET_CREATED: "planlock:workspace_packet_created",
	/** A workspace packet was rejected (e.g., stale hashes) */
	WORKSPACE_PACKET_REJECTED: "planlock:workspace_packet_rejected",
	/** A command grant was requested */
	COMMAND_GRANT_REQUESTED: "planlock:command_grant_requested",
	/** A command grant decision was made */
	COMMAND_GRANT_DECISION: "planlock:command_grant_decision",
	/** A delete was blocked by controlled delete policy */
	DELETE_POLICY_BLOCKED: "planlock:delete_policy_blocked",
	/** A plan amendment was requested */
	PLAN_AMENDMENT_REQUESTED: "planlock:plan_amendment_requested",
} as const;

// =============================================================================
// Event Payload Re-exports (for consumer convenience)
// =============================================================================

export type {
	PlanLockAdmittedPayload,
	WorkspacePacketCreatedPayload,
	WorkspacePacketRejectedPayload,
	CommandGrantRequestedPayload,
	CommandGrantDecisionPayload,
	DeletePolicyBlockedPayload,
	PlanAmendmentRequestedPayload,
};

// =============================================================================
// Event Emitters
// =============================================================================

/**
 * Emit a plan_lock_admitted event.
 */
export function emitPlanLockAdmitted(
	bus: EventBus,
	payload: PlanLockAdmittedPayload,
): void {
	bus.emit(PLANLOCK_EVENTS.PLAN_LOCK_ADMITTED, payload);
}

/**
 * Emit a workspace_packet_created event.
 */
export function emitWorkspacePacketCreated(
	bus: EventBus,
	payload: WorkspacePacketCreatedPayload,
): void {
	bus.emit(PLANLOCK_EVENTS.WORKSPACE_PACKET_CREATED, payload);
}

/**
 * Emit a workspace_packet_rejected event.
 */
export function emitWorkspacePacketRejected(
	bus: EventBus,
	payload: WorkspacePacketRejectedPayload,
): void {
	bus.emit(PLANLOCK_EVENTS.WORKSPACE_PACKET_REJECTED, payload);
}

/**
 * Emit a command_grant_requested event.
 */
export function emitCommandGrantRequested(
	bus: EventBus,
	payload: CommandGrantRequestedPayload,
): void {
	bus.emit(PLANLOCK_EVENTS.COMMAND_GRANT_REQUESTED, payload);
}

/**
 * Emit a command_grant_decision event.
 */
export function emitCommandGrantDecision(
	bus: EventBus,
	payload: CommandGrantDecisionPayload,
): void {
	bus.emit(PLANLOCK_EVENTS.COMMAND_GRANT_DECISION, payload);
}

/**
 * Emit a delete_policy_blocked event.
 */
export function emitDeletePolicyBlocked(
	bus: EventBus,
	payload: DeletePolicyBlockedPayload,
): void {
	bus.emit(PLANLOCK_EVENTS.DELETE_POLICY_BLOCKED, payload);
}

/**
 * Emit a plan_amendment_requested event.
 */
export function emitPlanAmendmentRequested(
	bus: EventBus,
	payload: PlanAmendmentRequestedPayload,
): void {
	bus.emit(PLANLOCK_EVENTS.PLAN_AMENDMENT_REQUESTED, payload);
}
