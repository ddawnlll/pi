/**
 * Execution Event Schema — P41.01
 *
 * Typed event type definitions for the execution platform.
 * Events are emitted during execution and consumed by observers (Brain, Web, UI).
 * Each event has a discriminant string type and a typed payload.
 *
 * Consumption path: Worker → WorkerAdapter emits WorkerEvent →
 * Execution journals typed ExecutionEvent → Read Model surfaces via JournalEventEnvelope.
 */

// ---------------------------------------------------------------------------
// Workspace Execution Stage
// ---------------------------------------------------------------------------

/**
 * Workspace execution stage enum.
 * Mirrors WorkspaceStage from the execution kernel for external consumers.
 */
export type WorkspaceExecutionStage =
	| "Pending"
	| "Running"
	| "Complete"
	| "Failed"
	| "Blocked"
	| "Cancelled"
	| "Skipped"
	| "Paused"
	| "TimedOut";

// ---------------------------------------------------------------------------
// Event type literal list — used at the union level and for discriminated narrowing
// ---------------------------------------------------------------------------

/**
 * All known execution event type string literals.
 * Adding a new event type requires an entry here, a payload interface below,
 * and an entry in the ExecutionEvent union.
 */
export const EXECUTION_EVENT_TYPES = [
	// Plan-level events
	"plan_started",
	"plan_completed",
	"plan_failed",
	"plan_paused",
	"plan_resumed",
	"plan_cancelled",
	"plan_stopped",

	// Workspace-level events
	"workspace_pending",
	"workspace_running",
	"workspace_completed",
	"workspace_failed",
	"workspace_blocked",
	"workspace_cancelled",
	"workspace_skipped",
	"workspace_paused",
	"workspace_timed_out",

	// Worker lifecycle events
	"worker_started",
	"worker_completed",
	"worker_failed",
	"worker_timed_out",
	"worker_cancelled",

	// Command execution events
	"command_started",
	"command_finished",

	// Brain proposal events
	"brain_proposed",
	"brain_approved",
	"brain_rejected",

	// Governance / validation events
	"governance_check_started",
	"governance_approved",
	"governance_rejected",
	"governance_escalated",

	// System-level events
	"system_error",
	"system_warning",
	"system_info",
] as const;

export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Event Payload Interfaces
// ---------------------------------------------------------------------------

// ---------- Plan Events ----------

export interface PlanStartedPayload {
	planId: string;
	planExecutionId: string;
	phase: string;
	title: string;
	totalWorkspaces: number;
}

export interface PlanCompletedPayload {
	planExecutionId: string;
	completedWorkspaces: number;
	failedWorkspaces: number;
	durationMs: number;
}

export interface PlanFailedPayload {
	planExecutionId: string;
	reason: string;
	failedWorkspaces: number;
}

export interface PlanPausedPayload {
	planExecutionId: string;
	reason?: string;
}

export interface PlanResumedPayload {
	planExecutionId: string;
	reason?: string;
}

export interface PlanCancelledPayload {
	planExecutionId: string;
	reason?: string;
}

export interface PlanStoppedPayload {
	planExecutionId: string;
	reason?: string;
}

// ---------- Workspace Events ----------

export interface WorkspaceStageChangedPayload {
	planExecutionId: string;
	workspaceId: string;
	workspaceExecutionId: string;
	fromStage: WorkspaceExecutionStage;
	toStage: WorkspaceExecutionStage;
	attemptNumber: number;
	error?: string;
	reportPath?: string;
}

// ---------- Worker Events ----------

export interface WorkerStartedPayload {
	planExecutionId: string;
	workspaceId: string;
	workspaceExecutionId: string;
	runId: string;
	attemptNumber: number;
}

export interface WorkerCompletedPayload {
	planExecutionId: string;
	workspaceId: string;
	workspaceExecutionId: string;
	runId: string;
	verdict: "complete" | "failed" | "blocked" | "timed_out" | "cancelled";
	changedFiles: string[];
}

export interface WorkerFailedPayload {
	planExecutionId: string;
	workspaceId: string;
	workspaceExecutionId: string;
	runId: string;
	error: string;
}

export interface WorkerTimedOutPayload {
	planExecutionId: string;
	workspaceId: string;
	workspaceExecutionId: string;
	runId: string;
	timeoutMs: number;
}

export interface WorkerCancelledPayload {
	planExecutionId: string;
	workspaceId: string;
	workspaceExecutionId: string;
	runId: string;
	reason?: string;
}

// ---------- Command Events ----------

export interface CommandStartedPayload {
	planExecutionId: string;
	workspaceId: string;
	command: string;
	cwd: string;
	runId?: string;
}

export interface CommandFinishedPayload {
	planExecutionId: string;
	workspaceId: string;
	command: string;
	cwd: string;
	exitCode: number | null;
	durationMs: number;
	outputSummary?: string;
	runId?: string;
}

// ---------- Brain Proposal Events ----------

export interface BrainProposedPayload {
	planExecutionId: string;
	proposalId: string;
	proposalType: "retry" | "split_workspace" | "draft_plan" | "investigate" | "notify";
	summary: string;
	rationale: string;
	evidenceRefs: string[];
}

export interface BrainApprovedPayload {
	planExecutionId: string;
	proposalId: string;
	approvedBy?: string;
}

export interface BrainRejectedPayload {
	planExecutionId: string;
	proposalId: string;
	reason?: string;
	rejectedBy?: string;
}

// ---------- Governance Events ----------

export interface GovernanceCheckStartedPayload {
	planExecutionId: string;
	workspaceId?: string;
}

export interface GovernanceApprovedPayload {
	planExecutionId: string;
	workspaceId?: string;
	reason?: string;
}

export interface GovernanceRejectedPayload {
	planExecutionId: string;
	workspaceId?: string;
	reason: string;
}

export interface GovernanceEscalatedPayload {
	planExecutionId: string;
	workspaceId?: string;
	reason: string;
}

// ---------- System Events ----------

export interface SystemErrorPayload {
	planExecutionId?: string;
	message: string;
	code?: string;
	stack?: string;
}

export interface SystemWarningPayload {
	planExecutionId?: string;
	message: string;
	code?: string;
}

export interface SystemInfoPayload {
	planExecutionId?: string;
	message: string;
	details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Payload map — maps event type string to payload type
// ---------------------------------------------------------------------------

export interface ExecutionEventPayloadMap {
	// Plan
	plan_started: PlanStartedPayload;
	plan_completed: PlanCompletedPayload;
	plan_failed: PlanFailedPayload;
	plan_paused: PlanPausedPayload;
	plan_resumed: PlanResumedPayload;
	plan_cancelled: PlanCancelledPayload;
	plan_stopped: PlanStoppedPayload;
	// Workspace
	workspace_pending: WorkspaceStageChangedPayload;
	workspace_running: WorkspaceStageChangedPayload;
	workspace_completed: WorkspaceStageChangedPayload;
	workspace_failed: WorkspaceStageChangedPayload;
	workspace_blocked: WorkspaceStageChangedPayload;
	workspace_cancelled: WorkspaceStageChangedPayload;
	workspace_skipped: WorkspaceStageChangedPayload;
	workspace_paused: WorkspaceStageChangedPayload;
	workspace_timed_out: WorkspaceStageChangedPayload;
	// Worker
	worker_started: WorkerStartedPayload;
	worker_completed: WorkerCompletedPayload;
	worker_failed: WorkerFailedPayload;
	worker_timed_out: WorkerTimedOutPayload;
	worker_cancelled: WorkerCancelledPayload;
	// Commands
	command_started: CommandStartedPayload;
	command_finished: CommandFinishedPayload;
	// Brain
	brain_proposed: BrainProposedPayload;
	brain_approved: BrainApprovedPayload;
	brain_rejected: BrainRejectedPayload;
	// Governance
	governance_check_started: GovernanceCheckStartedPayload;
	governance_approved: GovernanceApprovedPayload;
	governance_rejected: GovernanceRejectedPayload;
	governance_escalated: GovernanceEscalatedPayload;
	// System
	system_error: SystemErrorPayload;
	system_warning: SystemWarningPayload;
	system_info: SystemInfoPayload;
}

// ---------------------------------------------------------------------------
// ExecutionEvent — discriminated union over all event types
// ---------------------------------------------------------------------------

/**
 * An execution event is a discriminated union.
 * Every event has at minimum `type` (the discriminant) and `timestamp`.
 * The `payload` is typed according to the event type via ExecutionEventPayloadMap.
 */
export type ExecutionEvent = {
	[K in ExecutionEventType]: {
		type: K;
		timestamp: number;
		payload: ExecutionEventPayloadMap[K];
	};
}[ExecutionEventType];

// ---------------------------------------------------------------------------
// Event helper — create a typed ExecutionEvent with a current timestamp
// ---------------------------------------------------------------------------

/**
 * Create a typed ExecutionEvent with an auto-populated timestamp.
 */
export function createExecutionEvent<T extends ExecutionEventType>(
	type: T,
	payload: ExecutionEventPayloadMap[T],
	timestamp?: number,
): ExecutionEvent {
	return {
		type,
		timestamp: timestamp ?? Date.now(),
		payload,
	} as ExecutionEvent;
}

// ---------------------------------------------------------------------------
// Event type categorization helpers
// ---------------------------------------------------------------------------

/** True if the event type is a plan-level event. */
export function isPlanEventType(type: ExecutionEventType): boolean {
	return type.startsWith("plan_");
}

/** True if the event type is a workspace-level event. */
export function isWorkspaceEventType(type: ExecutionEventType): boolean {
	return type.startsWith("workspace_");
}

/** True if the event type is a worker lifecycle event. */
export function isWorkerEventType(type: ExecutionEventType): boolean {
	return type.startsWith("worker_");
}

/** True if the event type is a command execution event. */
export function isCommandEventType(type: ExecutionEventType): boolean {
	return type.startsWith("command_");
}

/** True if the event type is a brain proposal event. */
export function isBrainEventType(type: ExecutionEventType): boolean {
	return type.startsWith("brain_");
}

/** True if the event type is a governance/validation event. */
export function isGovernanceEventType(type: ExecutionEventType): boolean {
	return type.startsWith("governance_");
}

/** True if the event type is a system-level event. */
export function isSystemEventType(type: ExecutionEventType): boolean {
	return type.startsWith("system_");
}

// ---------------------------------------------------------------------------
// Mapping: WorkspaceStage → WorkspaceExecutionStage
// ---------------------------------------------------------------------------

import { WorkspaceStage } from "./types.js";

/**
 * Map a WorkspaceStage enum value to the corresponding WorkspaceExecutionStage string.
 * Returns undefined if no mapping exists.
 */
export function mapWorkspaceStageToExecutionStage(stage: WorkspaceStage): WorkspaceExecutionStage | undefined {
	switch (stage) {
		case WorkspaceStage.Pending:
			return "Pending";
		case WorkspaceStage.Active:
			return "Running";
		case WorkspaceStage.Complete:
			return "Complete";
		case WorkspaceStage.Blocked:
			return "Blocked";
		case WorkspaceStage.Failed:
			return "Failed";
	}
}

// ---------------------------------------------------------------------------
// Mapping: WorkspaceExecutionStage → corresponding event type
// ---------------------------------------------------------------------------

/**
 * Map a WorkspaceExecutionStage to the workspace event type emitted on entry to that stage.
 */
export function workspaceStageToEventType(stage: WorkspaceExecutionStage): ExecutionEventType | undefined {
	switch (stage) {
		case "Pending":
			return "workspace_pending";
		case "Running":
			return "workspace_running";
		case "Complete":
			return "workspace_completed";
		case "Failed":
			return "workspace_failed";
		case "Blocked":
			return "workspace_blocked";
		case "Cancelled":
			return "workspace_cancelled";
		case "Skipped":
			return "workspace_skipped";
		case "Paused":
			return "workspace_paused";
		case "TimedOut":
			return "workspace_timed_out";
	}
}
