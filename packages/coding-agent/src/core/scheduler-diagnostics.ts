/**
 * Scheduler Diagnostics - Workspace 6.E
 *
 * Diagnostics utilities for the Dynamic Parallel Scheduler.
 * Provides dashboard-friendly formatting and analysis of scheduling decisions.
 *
 * Re-exports from the scheduler package for convenient access from the core layer.
 */

export type {
	FileLockConflict,
	IdleExplanation,
	ResourcePressureMetrics,
	SchedulerCapacitySnapshot,
	SchedulerDiagnostics,
	SchedulingDecision,
	SkipReason,
} from "../scheduler/dynamic-scheduler.js";
export {
	formatCapacitySummary,
	formatSchedulingDecision,
} from "../scheduler/dynamic-scheduler.js";
