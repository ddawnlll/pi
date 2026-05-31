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
// P40.2 Dependency Inversion Interfaces
// These interfaces allow execution-runtime modules to be extracted
// without importing coding-agent infrastructure directly.
// Implementations stay in coding-agent; execution-* imports the interface only.
// ---------------------------------------------------------------------------

/**
 * AgentRuntime — abstraction over the local Pi worker agent executor.
 * Replaces direct WorkspaceAgentExecutor construction in autonomous-executor.
 */
export interface AgentRuntime {
	execute(packet: Record<string, unknown>, workspaceId: string, config: AgentRuntimeConfig): Promise<AgentRuntimeResult>;
	abort(): void;
}

export interface AgentRuntimeConfig {
	logPath?: string;
	attemptNo?: number;
	_signal?: AbortSignal;
}

export interface AgentRuntimeResult {
	success: boolean;
	verdict: string;
	report?: string;
	error?: string;
	logs: unknown[];
}

/**
 * GovernanceProvider — abstracts completion gate governance checks.
 */
export interface GovernanceProvider {
	checkApproval(planExecutionId: string, workspaceId: string): Promise<{ approved: boolean; reason?: string }>;
}

/**
 * StorageProvider — abstracts DB/JSON state persistence.
 */
export interface StorageProvider {
	loadState(planExecutionId: string): Promise<unknown>;
	saveState(planExecutionId: string, state: unknown): Promise<void>;
}

/**
 * InfrastructureProvider — abstracts SDK, session, settings access.
 */
export interface InfrastructureProvider {
	getSdk(): unknown;
	getSessionManager(): unknown;
	getSettingsManager(): unknown;
}

/**
 * SkillProvider — abstracts skill registry access.
 */
export interface SkillProvider {
	getAvailableSkills(): Promise<unknown[]>;
}

// ---------------------------------------------------------------------------
// Forward declarations (defined in commands.ts, imported for convenience)
// ---------------------------------------------------------------------------

import type { ExecutionCommand } from "./commands.js";
export type { ExecutionCommand };
