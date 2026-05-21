/**
 * Overnight — P20 Overnight Autonomous Execution.
 *
 * This module provides the overnight run orchestrator for scheduling
 * and managing autonomous plan queue execution with automatic stop
 * conditions, progress tracking, and session lifecycle.
 *
 * @packageDocumentation
 */

export type {
	OvernightConfig,
	OvernightStopCondition,
	PlanQueueRef,
	RunProgress,
	RunSession,
	RunStatus,
} from "./orchestrator.js";
export {
	DEFAULT_OVERNIGHT_CONFIG,
	OvernightOrchestrator,
	SessionStore,
} from "./orchestrator.js";
