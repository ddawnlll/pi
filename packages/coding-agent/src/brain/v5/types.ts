/**
 * Brain V5 — Capability boundary, modes, and shared types.
 *
 * Every V5 brain module must go through this type/API boundary before
 * emitting any execution-relevant event. Direct execution-state mutation
 * from brain modules is rejected at the type level — brains emit events
 * only (V4 ExecutionKernel doctrine).
 *
 * @packageDocumentation
 */

import type { ActorEvent, ActorEventType } from "../../execution-kernel/actor-events.js";
import type { BrainTimelineEvent } from "../types.js";

// =========================================================================
// V5 Operating Modes
// =========================================================================

/**
 * V5 operating modes, ordered from least to most capable.
 *
 * OFF             - V5 is disabled. No V5 code paths execute.
 * READ_ONLY       - V5 can observe and report but cannot emit any events.
 * ADVISORY        - V5 can emit observation/signal timeline events but cannot
 *                   push mutations to execution state.
 * DRAFTING        - V5 can emit approved change proposals for execution.
 * OPERATOR_READY  - V5 can autonomously run overnight operator sessions.
 */
export type BrainV5Mode = "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";

/** Ordered list of V5 modes from least to most capable. */
export const BRAIN_V5_MODES: readonly BrainV5Mode[] = [
	"OFF",
	"READ_ONLY",
	"ADVISORY",
	"DRAFTING",
	"OPERATOR_READY",
] as const;

/**
 * Numerical rank for each V5 mode, used for capability comparison.
 * Higher rank = more capable.
 */
export const BRAIN_V5_MODE_RANK: Record<BrainV5Mode, number> = {
	OFF: 0,
	READ_ONLY: 1,
	ADVISORY: 2,
	DRAFTING: 3,
	OPERATOR_READY: 4,
};

/** Check if a V5 mode meets or exceeds a required threshold. */
export function brainV5ModeAtLeast(actual: BrainV5Mode, required: BrainV5Mode): boolean {
	return BRAIN_V5_MODE_RANK[actual] >= BRAIN_V5_MODE_RANK[required];
}

// =========================================================================
// V5 Configuration (mirrors settings-manager brainV5 block)
// =========================================================================

/**
 * V5 capability flags as consumed by brain modules.
 * These are derived from the user's settings.json brainV5 block.
 */
export interface BrainV5Config {
	/** Master switch: enable all V5 brain code paths. */
	enabled: boolean;
	/** Read-only mode: V5 cannot emit any mutation-bound events. */
	readOnlyMode: boolean;
	/** Push enabled: V5 can push approved changes to the execution kernel. */
	pushEnabled: boolean;
	/** Overnight operator: V5 can run autonomous overnight operator sessions. */
	overnightOperatorEnabled: boolean;
	/** Derived mode from the above flags. */
	mode: BrainV5Mode;
}

// =========================================================================
// V5 Event Boundary
// =========================================================================

/**
 * Event types that V5 brain modules are allowed to emit.
 *
 * Following the V4 ExecutionKernel doctrine, brain code must not mutate
 * execution state directly. Instead, actors emit events only.
 *
 * The V5 boundary allows:
 * - Timeline observation/signal events (brain-level awareness)
 * - Actor events (execution-kernel-level communication via actor event stream)
 *
 * Direct state mutation (StateWriter.transition, etc.) is forbidden.
 */
export type V5AllowedEvent = { kind: "timeline"; event: BrainTimelineEvent } | { kind: "actor"; event: ActorEvent };

/**
 * The set of ActorEventType values that V5 is permitted to emit.
 *
 * V5 must never emit events that directly transition attempt state or
 * mutate execution graphs. It can request actions, record proposals,
 * and report observations — but the execution kernel decides whether
 * and how to act on them.
 */
export const V5_ALLOWED_ACTOR_EVENT_TYPES: ReadonlySet<ActorEventType> = new Set<ActorEventType>([
	"proposal_submitted",
	"proposal_evidence_recorded",
	"workspace_started",
	"workspace_running",
	"tool_event",
]);

/** Actor event types that are FORBIDDEN for V5 to emit. */
export const V5_FORBIDDEN_ACTOR_EVENT_TYPES: ReadonlySet<ActorEventType> = new Set<ActorEventType>([
	"retry_requested",
	"validation_started",
	"validation_passed",
	"validation_failed",
	"validation_timed_out",
	"lease_stale_detected",
	"lease_quarantine_requested",
	"cleanup_completed",
	"cleanup_failed",
	"llm_timeout",
]);

// =========================================================================
// V5 Plan Doctor Report
// =========================================================================

/**
 * A report segment from the plan doctor about V5 advisory status.
 *
 * The plan doctor reports that V5 is advisory unless operator gates pass,
 * meaning V5 suggestions are informational-only until the user or policy
 * grants operator-level authority.
 */
export interface V5PlanDoctorReport {
	/** The current V5 mode. */
	mode: BrainV5Mode;
	/** Whether V5 can directly suggest plan mutations. */
	canSuggest: boolean;
	/** Whether operator gates have passed for this workspace. */
	operatorGatesPassed: boolean;
	/** Human-readable summary of the V5 advisory status. */
	summary: string;
	/** Detailed messages about gate status and constraints. */
	details: string[];
}

// =========================================================================
// V5 Operator Gate
// =========================================================================

/**
 * Status of operator gates that must pass before V5 can move from
 * ADVISORY to DRAFTING/OPERATOR_READY capability.
 */
export interface V5OperatorGateStatus {
	/** Whether the user has explicitly enabled push for V5. */
	pushEnabled: boolean;
	/** Whether the user has explicitly enabled overnight operator. */
	overnightOperatorEnabled: boolean;
	/** Whether the safety profile allows V5 mutations. */
	safetyProfileAllows: boolean;
	/** Whether the current plan execution context permits V5 actions. */
	executionContextAllows: boolean;
	/** Overall gate result: all gates must pass to reach DRAFTING+. */
	allGatesPassed: boolean;
}

// =========================================================================
// V5 Mutation Guard — Type-level API Boundary
// =========================================================================

/**
 * Result of attempting to emit a V5 event.
 */
export type V5EmitResult = { ok: true; eventId: string } | { ok: false; error: string; code: V5RejectCode };

/**
 * Reason codes for V5 event rejection.
 */
export type V5RejectCode =
	| "MODE_OFF" // V5 is disabled
	| "MODE_READ_ONLY" // V5 in read-only mode
	| "MODE_NO_PUSH" // V5 cannot push (below DRAFTING)
	| "FORBIDDEN_EVENT_TYPE" // Event type not in allowed set
	| "OPERATOR_GATES_NOT_PASSED" // Operator gates not passed
	| "EXECUTION_KERNEL_REJECTION"; // Execution kernel rejected the event

/**
 * V5 event sink — the only way V5 modules can emit events.
 *
 * This enforces the V4 ExecutionKernel doctrine: brain code must not
 * mutate execution state directly. All V5 output goes through this
 * event sink, which validates against the current mode and allowed
 * event types before forwarding to the execution kernel.
 */
export interface V5EventSink {
	emit(event: V5AllowedEvent): Promise<V5EmitResult>;
}
