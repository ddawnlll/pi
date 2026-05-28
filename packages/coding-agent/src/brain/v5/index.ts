/**
 * Brain V5 — V5 Contract, Flags & Safety Doctrine.
 *
 * Defines the V5 capability boundary, feature flags, shared types, and
 * safety doctrine so every later workspace agrees that Brain V5 is
 * advisory by default and never mutates execution state directly.
 *
 * All V5 modules must go through the V5 mutation guard
 * (V5MutationGuard) before emitting any execution-relevant event.
 *
 * @packageDocumentation
 */

// V5 config resolution
export {
	canV5EmitEvents,
	canV5Push,
	canV5RunOvernight,
	deriveBrainV5Mode,
	isV5Enabled,
	resolveBrainV5Config,
} from "./config.js";
// V5 mutation guard (V4 ExecutionKernel boundary enforcement)
export { V5MutationGuard } from "./mutation-guard.js";
// V5 plan doctor integration
export {
	buildV5DoctorReport,
	checkV5OperatorGates,
	formatV5DoctorSummary,
} from "./plan-doctor.js";
// V5 types and enums
export type {
	BrainV5Config,
	BrainV5Mode,
	V5AllowedEvent,
	V5EmitResult,
	V5EventSink,
	V5OperatorGateStatus,
	V5PlanDoctorReport,
	V5RejectCode,
} from "./types.js";
export {
	BRAIN_V5_MODE_RANK,
	BRAIN_V5_MODES,
	brainV5ModeAtLeast,
	V5_ALLOWED_ACTOR_EVENT_TYPES,
	V5_FORBIDDEN_ACTOR_EVENT_TYPES,
} from "./types.js";
