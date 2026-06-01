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
	writeControlRequest(
		planExecutionId: string,
		action: string,
		reason?: string,
		schemaCompatible?: boolean,
	): Promise<void>;
	stopPlan(planExecutionId: string, reason: string): Promise<void>;
	pausePlan(planExecutionId: string): Promise<void>;
	cancelPlan(planExecutionId: string): Promise<void>;
	resumePlan(planExecutionId: string): Promise<void>;
	transitionWorkspace(
		planExecutionId: string,
		workspaceId: string,
		stage: string,
		metadata?: Record<string, unknown>,
	): Promise<void>;
	incrementRetryAttempt(planExecutionId: string, workspaceId: string): Promise<void>;
	getWorkspaceState(
		planExecutionId: string,
		workspaceId: string,
	): Promise<{
		stage: string;
		attempts: number;
		startedAt?: number;
		completedAt?: number;
		error?: string;
		reportPath?: string;
	} | null>;
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
	execute(
		packet: Record<string, unknown>,
		workspaceId: string,
		config: AgentRuntimeConfig,
	): Promise<AgentRuntimeResult>;
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
// P40.2C Dirty Runtime Dependency Ports
// These interfaces allow extraction of completion-gate, state-store,
// workspace-schema, and retry-handler without importing coding-agent infra.
// Implementations remain in coding-agent.
// ---------------------------------------------------------------------------

/**
 * Governance ledger port — abstracts plan/workspace approval checks.
 * Used by completion-gate.ts to verify governance status.
 */
export interface GovernanceLedgerLike {
	isApproved(planExecutionId: string): Promise<boolean>;
	getApprovalReason(planExecutionId: string): Promise<string | null>;
}

/**
 * Failure signal detector port — abstracts log-based failure detection.
 * Used by completion-gate.ts to detect unresolved failures.
 */
export interface FailureDetectorLike {
	detectFailures(planExecutionId: string, workspaceId: string): Promise<FailureSignalLike[]>;
}

export interface FailureSignalLike {
	category: string;
	message: string;
	workspaceId: string;
}

/**
 * Watch mode guard port — abstracts watch-mode command detection.
 * Used by completion-gate.ts to check for watch-mode commands.
 */
export interface WatchModeGuardLike {
	isWatchModeCommand(command: string): boolean;
	isWatchCommand(command: string): boolean;
}

/**
 * State store backend factory port — abstracts DB vs JSON backend creation.
 * Used by state-store.ts to create persistence backends.
 */
export interface StateStoreBackendFactoryLike {
	createDatabaseBackend(): unknown;
	createJsonBackend(): unknown;
}

/**
 * Budget policy port — abstracts workspace budget enforcement.
 * Used by workspace-schema.ts for capacity validation.
 */
export interface BudgetPolicyLike {
	checkBudget(workspaceCount: number, config?: Record<string, unknown>): { allowed: boolean; reason?: string };
}

/**
 * Completion gate dependency bundle — groups all deps needed by completion-gate.
 * Allows completion-gate to be extracted as a pure module that accepts
 * this bundle at construction time.
 */
export interface CompletionGateDeps {
	governance: GovernanceLedgerLike;
	failureDetector: FailureDetectorLike;
	watchModeGuard: WatchModeGuardLike;
}

// ---------------------------------------------------------------------------
// Forward declarations (defined in commands.ts, imported for convenience)
// ---------------------------------------------------------------------------

import type { ExecutionCommand } from "./commands.js";
export type { ExecutionCommand };
