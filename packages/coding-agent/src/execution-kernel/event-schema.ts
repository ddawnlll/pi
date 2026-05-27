/**
 * Event schema for v4 AttemptEvent journal entries.
 *
 * Every attempt mutation in the ExecutionKernel is recorded as an event.
 * Events are append-only and versioned. They provide the replay source
 * for the AttemptEventJournal and the source of truth for attempt state reconstruction.
 */

import type { AttemptState } from "./types.js";

// =========================================================================
// Event version
// =========================================================================

export const ATTEMPT_EVENT_VERSION = 1;

// =========================================================================
// Event types
// =========================================================================

export type AttemptEventTypeV4 =
	| "attempt_created"
	| "worktree_lease_requested"
	| "worktree_lease_acquired"
	| "worktree_lease_failed"
	| "executor_started"
	| "executor_heartbeat"
	| "executor_completed"
	| "executor_failed"
	| "llm_request_timed_out"
	| "tool_call_failed"
	| "validation_lane_requested"
	| "validation_lane_acquired"
	| "validation_started"
	| "validation_passed"
	| "validation_failed"
	| "validation_timed_out"
	| "validation_process_killed"
	| "integration_queued"
	| "integration_started"
	| "integration_passed"
	| "integration_failed"
	| "merge_conflict_detected"
	| "abort_requested"
	| "abort_completed"
	| "deadline_exceeded"
	| "lease_stale_detected"
	| "quarantine_required"
	| "handoff_required"
	| "retry_requested"
	| "handoff_retry_requested"
	| "handoff_closed"
	| "manual_resolution_recorded";

// =========================================================================
// Event source types
// =========================================================================

export type EventSource =
	| "plan_supervisor"
	| "attempt_controller"
	| "executor_actor"
	| "validation_actor"
	| "git_runner"
	| "worktree_actor"
	| "lease_actor"
	| "integration_actor"
	| "retry_policy"
	| "deadline_watchdog"
	| "cleanup_actor"
	| "brain_worker"
	| "diagnostics"
	| "admission_gate"
	| "legacy_adapter"
	| "human";

// =========================================================================
// Attempt event payload types
// =========================================================================

export interface AttemptCreatedPayload {
	workspaceExecutionId: string;
	planExecutionId: string;
	projectId: string;
	attemptNo: number;
	initialState: AttemptState;
	deadlineAt: string | null;
}

export interface WorktreeLeaseRequestedPayload {
	worktreeId: string;
}

export interface WorktreeLeaseAcquiredPayload {
	worktreeId: string;
	path: string;
}

export interface WorktreeLeaseFailedPayload {
	worktreeId: string;
	reason: string;
}

export interface ExecutorStartedPayload {
	agentId: string;
	providerModel: string;
}

export interface ExecutorHeartbeatPayload {
	progress: string;
}

export interface ExecutorCompletedPayload {
	result: "success" | "failure";
	summary: string;
}

export interface ExecutorFailedPayload {
	error: string;
	errorClass: "retryable" | "final";
}

export interface LlmRequestTimedOutPayload {
	provider: string;
	timeoutMs: number;
}

export interface ToolCallFailedPayload {
	tool: string;
	error: string;
	retryable: boolean;
}

export interface ValidationLaneRequestedPayload {
	laneType: "heavy" | "targeted";
}

export interface ValidationLaneAcquiredPayload {
	laneType: "heavy" | "targeted";
}

export interface ValidationStartedPayload {
	command: string;
	timeoutMs: number;
}

export interface ValidationPassedPayload {
	output: string;
	durationMs: number;
}

export interface ValidationFailedPayload {
	output: string;
	durationMs: number;
	error: string;
}

export interface ValidationTimedOutPayload {
	command: string;
	timeoutMs: number;
	outputTruncated: string;
}

export interface ValidationProcessKilledPayload {
	pid: number;
	signal: string;
}

export interface IntegrationQueuedPayload {
	queuePosition: number;
}

export interface IntegrationStartedPayload {
	branch: string;
}

export interface IntegrationPassedPayload {
	commitHash: string;
}

export interface IntegrationFailedPayload {
	error: string;
}

export interface MergeConflictDetectedPayload {
	files: string[];
}

export interface AbortRequestedPayload {
	reason: string;
	source: string;
}

export interface AbortCompletedPayload {
	cleanupStatus: string;
}

export interface DeadlineExceededPayload {
	state: AttemptState;
	deadlineAt: string;
}

export interface LeaseStaleDetectedPayload {
	lastHeartbeatAt: string;
	staleThresholdSeconds: number;
}

export interface QuarantineRequiredPayload {
	reason: string;
}

export interface HandoffRequiredPayload {
	reason: string;
	artifactId?: string;
	artifactPath?: string;
}

export interface RetryRequestedPayload {
	previousAttemptState: AttemptState;
	previousAttemptId: string;
	retryBudgetRemaining: number;
}

export interface HandoffRetryRequestedPayload {
	previousAttemptId: string;
	handoffQueueItemId: string;
}

export interface HandoffClosedPayload {
	handoffQueueItemId: string;
	resolution: "retried" | "manually_resolved" | "closed_failed" | "followup_created";
}

export interface ManualResolutionRecordedPayload {
	resolution: string;
	summary: string;
}

// =========================================================================
// Attempt event union type
// =========================================================================

export type AttemptEventPayload =
	| AttemptCreatedPayload
	| WorktreeLeaseRequestedPayload
	| WorktreeLeaseAcquiredPayload
	| WorktreeLeaseFailedPayload
	| ExecutorStartedPayload
	| ExecutorHeartbeatPayload
	| ExecutorCompletedPayload
	| ExecutorFailedPayload
	| LlmRequestTimedOutPayload
	| ToolCallFailedPayload
	| ValidationLaneRequestedPayload
	| ValidationLaneAcquiredPayload
	| ValidationStartedPayload
	| ValidationPassedPayload
	| ValidationFailedPayload
	| ValidationTimedOutPayload
	| ValidationProcessKilledPayload
	| IntegrationQueuedPayload
	| IntegrationStartedPayload
	| IntegrationPassedPayload
	| IntegrationFailedPayload
	| MergeConflictDetectedPayload
	| AbortRequestedPayload
	| AbortCompletedPayload
	| DeadlineExceededPayload
	| LeaseStaleDetectedPayload
	| QuarantineRequiredPayload
	| HandoffRequiredPayload
	| RetryRequestedPayload
	| HandoffRetryRequestedPayload
	| HandoffClosedPayload
	| ManualResolutionRecordedPayload;

// =========================================================================
// Attempt event structure
// =========================================================================

export interface AttemptEvent {
	eventVersion: number;
	eventId: string;
	commandId: string | null;
	correlationId: string | null;
	planExecutionId: string;
	workspaceId: string | null;
	attemptId: string;
	source: EventSource;
	type: AttemptEventTypeV4;
	payload: AttemptEventPayload;
	createdAt: string;
}

// =========================================================================
// Validation helpers
// =========================================================================

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<AttemptEventTypeV4>([
	"attempt_created",
	"worktree_lease_requested",
	"worktree_lease_acquired",
	"worktree_lease_failed",
	"executor_started",
	"executor_heartbeat",
	"executor_completed",
	"executor_failed",
	"llm_request_timed_out",
	"tool_call_failed",
	"validation_lane_requested",
	"validation_lane_acquired",
	"validation_started",
	"validation_passed",
	"validation_failed",
	"validation_timed_out",
	"validation_process_killed",
	"integration_queued",
	"integration_started",
	"integration_passed",
	"integration_failed",
	"merge_conflict_detected",
	"abort_requested",
	"abort_completed",
	"deadline_exceeded",
	"lease_stale_detected",
	"quarantine_required",
	"handoff_required",
	"retry_requested",
	"handoff_retry_requested",
	"handoff_closed",
	"manual_resolution_recorded",
]);

const VALID_SOURCES: ReadonlySet<string> = new Set<EventSource>([
	"plan_supervisor",
	"attempt_controller",
	"executor_actor",
	"validation_actor",
	"git_runner",
	"worktree_actor",
	"lease_actor",
	"integration_actor",
	"retry_policy",
	"deadline_watchdog",
	"cleanup_actor",
	"brain_worker",
	"diagnostics",
	"admission_gate",
	"legacy_adapter",
	"human",
]);

/**
 * Check if a value is a valid AttemptEventTypeV4.
 */
export function isValidAttemptEventType(type: string): type is AttemptEventTypeV4 {
	return VALID_EVENT_TYPES.has(type);
}

/**
 * Check if a value is a valid EventSource.
 */
export function isValidEventSource(source: string): source is EventSource {
	return VALID_SOURCES.has(source);
}

/**
 * Check if an unknown value is a valid AttemptEvent.
 */
export function isAttemptEvent(value: unknown): value is AttemptEvent {
	if (typeof value !== "object" || value === null) return false;
	const e = value as Record<string, unknown>;
	if (typeof e.eventVersion !== "number") return false;
	if (typeof e.eventId !== "string" || !e.eventId) return false;
	if (typeof e.planExecutionId !== "string" || !e.planExecutionId) return false;
	if (typeof e.attemptId !== "string" || !e.attemptId) return false;
	if (typeof e.source !== "string" || !isValidEventSource(e.source)) return false;
	if (typeof e.type !== "string" || !isValidAttemptEventType(e.type)) return false;
	if (typeof e.createdAt !== "string" || !e.createdAt) return false;
	return true;
}

/**
 * Assert that a value is a valid AttemptEvent. Throws otherwise.
 */
export function assertAttemptEvent(value: unknown): asserts value is AttemptEvent {
	if (!isAttemptEvent(value)) {
		throw new Error("Invalid AttemptEvent: failed schema validation");
	}
}

/**
 * Create a new AttemptEvent with default fields.
 */
export function createAttemptEvent(params: Omit<AttemptEvent, "eventVersion" | "createdAt">): AttemptEvent {
	return {
		eventVersion: ATTEMPT_EVENT_VERSION,
		createdAt: new Date().toISOString(),
		...params,
	};
}
