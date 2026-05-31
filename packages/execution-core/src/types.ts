/**
 * Execution Core Types — P40 Platform / Agent Separation
 *
 * Shared types and contracts for the execution platform boundary.
 * Brain, Web Server, and UI consume these types.
 * Only Execution may transition state.
 */

// ---------------------------------------------------------------------------
// Plan Status
// ---------------------------------------------------------------------------

export type PlanStatus = "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled" | "awaiting_handoff";

// ---------------------------------------------------------------------------
// Brain Proposal
// ---------------------------------------------------------------------------

export interface BrainProposal {
	id: string;
	type: "retry" | "split_workspace" | "draft_plan" | "investigate" | "notify";
	summary: string;
	rationale: string;
	evidenceRefs: string[];
	proposedCommand?: ExecutionCommand;
}


// ---------------------------------------------------------------------------
// Workspace Stage (extracted from workspace-schema.ts for transition-router)
// ---------------------------------------------------------------------------

export enum WorkspaceStage {
	/** Workspace is waiting for dependencies */
	Pending = "pending",
	/** Workspace is currently being executed */
	Active = "active",
	/** Workspace completed successfully */
	Complete = "complete",
	/** Workspace is blocked (dependencies failed or file conflicts) */
	Blocked = "blocked",
	/** Workspace execution failed */
	Failed = "failed",
}

// ---------------------------------------------------------------------------
// State Store Interface (extracted for execution-kernel)
// ---------------------------------------------------------------------------

/**
 * Minimal state store interface consumed by execution-kernel.
 * The full IStateStore lives in coding-agent and is not extracted yet.
 */
export interface IStateStore {
	loadState(planExecutionId: string): Promise<unknown>;
	saveState(planExecutionId: string, state: unknown): Promise<void>;
	writeControlRequest(planExecutionId: string, action: string, reason?: string, schemaCompatible?: boolean): Promise<void>;
	stopPlan(planExecutionId: string, reason: string): Promise<void>;
	pausePlan(planExecutionId: string): Promise<void>;
	cancelPlan(planExecutionId: string): Promise<void>;
	resumePlan(planExecutionId: string): Promise<void>;
	transitionWorkspace(planExecutionId: string, workspaceId: string, stage: string, metadata?: Record<string, unknown>): Promise<void>;
	incrementRetryAttempt(planExecutionId: string, workspaceId: string): Promise<void>;
	getWorkspaceState(planExecutionId: string, workspaceId: string): Promise<{ stage: string; attempts: number; startedAt?: number; completedAt?: number; error?: string; reportPath?: string } | null>;
	getBackendType(): string;
}

// ---------------------------------------------------------------------------
// Forward declarations (defined in commands.ts, imported for convenience)
// ---------------------------------------------------------------------------

import type { ExecutionCommand } from "./commands.js";
export type { ExecutionCommand };
