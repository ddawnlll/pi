/**
 * Autonomous Execution Loop - P2 Workstreams 7.F + 7.H
 *
 * Orchestrates autonomous workspace execution with state management,
 * packet generation, journal logging, and retry handling.
 *
 * Refactored for Phase 1 to use IStateStore instead of PlanStateStore,
 * enabling both JSON and PostgreSQL persistence backends.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { compileAccpSource } from "@earendil-works/pi-accp-compiler";
import type { Model } from "@earendil-works/pi-ai";
import type { WorkerAdapter, WorktreeConfig } from "@earendil-works/pi-execution-contracts";
import {
	DEFAULT_WORKERS,
	resolveEffectiveWorkerCount,
	type WorkerConcurrencySettings,
} from "@earendil-works/pi-execution-contracts";
import { createGitRunner, handleExecutionCommand } from "@earendil-works/pi-execution-service";
import { LocalPiWorkerAdapter } from "@earendil-works/pi-worker-adapters";
import { getBrainStore } from "../brain/api.js";
import type { Severity, TimelineEventType } from "../brain/types.js";
import type { TransitionRouter } from "../execution-runtime/transition-router.js";
import { createTransitionRouter } from "../execution-runtime/transition-router.js";
import { PiLogger } from "../utils/logger.js";
import { killPlanProcesses, killTrackedDetachedChildren } from "../utils/shell.js";
import { AccpArtifactStore } from "./accp-artifact-store.js";
import { runAccpRepairLoop } from "./accp-repair-controller.js";
import { AutoCommit } from "./auto-commit.js";
import { createScopedIntegrationFromWorkspace } from "./completion/scoped-commit-integration.js";
import type { AttemptRecord as ReconcilerAttemptRecord } from "./completion/terminal-reconciler.js";
import { TerminalVerdictReconciler } from "./completion/terminal-reconciler.js";
import { extractWorkerEcho } from "./completion/worker-echo-extractor.js";
import { CompletionGateRegistry, evaluatePlanCompletion } from "./completion-gate.js";
import type { ExecutionPolicyContext } from "./execution-policy.js";
import { createDefaultPolicyContext } from "./execution-policy.js";
import type { LeadAgent } from "./lead-agent/index.js";
import type { JournalEventType, PlanState } from "./plan-state.js";
import { generateWorkspaceReport } from "./plan-state.js";
import { type RetryDecision, RetryHandler, type RetryPolicy, RetryStage } from "./retry-handler.js";
import { type HashedPacket, RolePacketBuilder } from "./role-packets.js";
import type { ControlAction, IStateStore, PlanControlState } from "./state-store.js";
import { createStateStore, detectStateStoreBackend } from "./state-store.js";
import {
	WorkspaceAgentExecutor,
	type WorkspaceAgentExecutorConfig,
	type WorkspaceCommandExecutionEvent,
} from "./workspace-agent-executor.js";
import { WorkspaceScheduler } from "./workspace-scheduler.js";
import type { ApprovedPreviewMetadata, Workspace, WorkspaceQueue, WorkspaceQueue as WQ } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

/**
 * Simple promise-chain based async mutex.
 * Serializes access to shared resources without risk of deadlock.
 */
class AsyncMutex {
	private current: Promise<void> = Promise.resolve();

	/**
	 * Execute a function exclusively under this mutex.
	 * The mutex is released in a finally block after the function completes or throws.
	 */
	async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		await this.current;
		let release: () => void;
		this.current = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			return await fn();
		} finally {
			release!();
		}
	}
}

/**
 * Workspace snapshot directory structure
 */
export interface WorkspaceSnapshot {
	/** Workspace ID */
	workspaceId: string;
	/** Snapshot directory path */
	snapshotDir: string;
	/** Latest packet file path */
	packetPath: string;
	/** Latest report file path */
	reportPath: string;
	/** Retry snapshots directory */
	retryDir: string;
}

/**
 * Execution result for a workspace
 */
export interface WorkspaceExecutionResult {
	/** Workspace ID */
	workspaceId: string;
	/** Execution success */
	success: boolean;
	/** Result verdict */
	verdict: "COMPLETE" | "BLOCKED" | "FAILED";
	/** Error message (if failed) */
	error?: string;
	/** Report content */
	report?: string;
	/** Estimated context usage in tokens (from prompt.length / 4) */
	contextUsed?: number;
}

/**
 * Autonomous executor configuration.
 */
export interface AutonomousExecutorConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** Maximum concurrent workers (default: 3) */
	maxWorkers?: number;
	/** Retry policy */
	retryPolicy?: RetryPolicy;
	/** Project ID to associate executions with */
	projectId?: string;
	/** Skip project management (for backward compat with single-project mode) */
	skipProjectManagement?: boolean;
	/** Model to use for agent execution */
	model?: Model<any>;
	/** Enable real agent execution (default: false for backward compat) */
	enableRealExecution?: boolean;
	/**
	 * Worker concurrency settings.
	 * When provided, overrides maxWorkers.
	 * Supports stable (1-3) and experimental (4-6) worker modes.
	 */
	workerConcurrency?: WorkerConcurrencySettings;
	/**
	 * Enable automatic git commits after workspace completion.
	 * When false, no commits are made.
	 * Defaults to true.
	 */
	autoCommit?: boolean;
	/**
	 * Enable post-plan handoff dialog.
	 * When true (default), plan enters awaiting_handoff state after all workspaces complete
	 * and waits for user to commit, keep editing, or discard.
	 * When false, plan auto-commits without handoff dialog.
	 * Defaults to true.
	 */
	postPlanHandoff?: boolean;
	/**
	 * Handoff timeout in milliseconds.
	 * If the plan is awaiting_handoff for longer than this duration,
	 * it auto-commits with a warning log.
	 * Defaults to 30 minutes (1800000 ms).
	 */
	handoffTimeoutMs?: number;
	/**
	 * Approved preview metadata from the plan preview flow.
	 *
	 * When provided, the executor uses the approved dependency graph for
	 * scheduling (AC1) and persists the preview metadata (AC2).
	 */
	approvedPreview?: ApprovedPreviewMetadata;
	/**
	 * Worktree isolation configuration.
	 * When enabled, each workspace executes inside its own git worktree.
	 * When disabled or absent, falls back to P5.5 shared-working-tree execution.
	 * Required for experimental_6 scale mode.
	 */
	worktree?: WorktreeConfig;
	/**
	 * Workspace execution timeout in milliseconds.
	 * If a single workspace execution takes longer than this, it is aborted.
	 * Defaults to 30 minutes (1800000 ms).
	 */
	workspaceTimeoutMs?: number;
	/**
	 * P37.HOTFIX: Stop drain hard timeout in milliseconds.
	 * When stop is requested, the drain phase waits up to this long for
	 * active workspaces to settle before force-killing.
	 * Defaults to 30 seconds (30000 ms).
	 */
	stopDrainTimeoutMs?: number;
	/**
	 * Lead Agent instance for failure supervision — P38.LEAD.
	 * When provided, the Lead Agent observes failures, classifies them,
	 * limits blind retries, and issues directives before retrying.
	 */
	leadAgent?: LeadAgent;
	/**
	 * P40: WorkerAdapter for platform/agent separation.
	 * When provided, execution uses the adapter instead of directly constructing
	 * WorkspaceAgentExecutor. This makes Pi replaceable as the default worker.
	 * If not provided, falls back to direct WorkspaceAgentExecutor construction.
	 */
	workerAdapter?: WorkerAdapter;
	/**
	 * Enable scoped commit enforcement via WorkspaceCommitGate.
	 * When true, only files matching the workspace's canEdit patterns
	 * are staged and committed, preventing commits that include files
	 * outside the workspace write set.
	 * Defaults to false (uses existing AutoCommit flow).
	 */
	scopedCommitEnabled?: boolean;
}

/**
 * Autonomous executor
 *
 * Manages autonomous workspace execution:
 * - Reads plan state
 * - Schedules eligible workspaces
 * - Creates role packets
 * - Executes workspace stages
 * - Updates journal and state
 * - Creates workspace snapshots
 *
 * Uses IStateStore for persistence, supporting both JSON and PostgreSQL backends.
 */
export class AutonomousExecutor {
	private stateStore: IStateStore;
	private transitionRouter: TransitionRouter;
	private scheduler: WorkspaceScheduler;
	private packetBuilder: RolePacketBuilder;
	private retryHandler: RetryHandler;
	private stateCacheMutex = new AsyncMutex();
	private workspaceRoot: string;
	private projectId: string;
	private planExecutionId: string | null = null;
	private currentPlanState: PlanState | null = null;
	private workspaceQueue: WorkspaceQueue | null = null;
	/** Approved preview metadata from the dependency graph (AC1 + AC2). */
	private approvedPreview: ApprovedPreviewMetadata | null = null;
	/** P26.B: Per-workspace executor instances, keyed by workspace ID */
	private activeAgentExecutors = new Map<string, WorkspaceAgentExecutor>();
	private enableRealExecution: boolean;
	/** Stored config for lazy per-workspace executor creation */
	private executorConfig: WorkspaceAgentExecutorConfig | null = null;
	/** P40: WorkerAdapter for platform/agent separation */
	private workerAdapter: WorkerAdapter | null = null;
	private autoCommitEnabled: boolean;
	private scopedCommitEnabled: boolean;
	private postPlanHandoffEnabled: boolean;
	private handoffTimeoutMs: number;
	/** Completion gate registry for tracking validation state per workspace (P4.6.1) */
	private completionGate = new CompletionGateRegistry();
	/** P4.6.3: Track in-flight execution promises per workspace for cancellation */
	private inFlightExecutions = new Map<string, Promise<WorkspaceExecutionResult>>();

	/**
	 * P37.HOTFIX: Flag preventing the scheduler from starting new work during
	 * the draining phase of a stop/stop request. Set when stop begins, cleared
	 * after the stop has fully completed.
	 */
	/** Execution policy context (V5 PlanSpec mode tracking) */
	private executionPolicy: ExecutionPolicyContext = createDefaultPolicyContext();

	/** Plan lock hash from PlanLock admission (for planspec_locked mode) */
	private planLockHash: string | undefined;

	/** Per-workspace lock hashes keyed by workspace ID (from PlanLock admission) */
	private _workspaceLockHashes: Record<string, string> = {};

	/** The admitted PlanLock object (for workspace packet derivation) */
	private _admittedPlanLock: import("./planlock-types.js").PlanLock | undefined;

	private isStopping = false;

	/**
	 * P37.HOTFIX: Map of workspaceId -> attemptNo for the currently in-flight
	 * workspace executions. Used by the stale attempt guard to verify that a
	 * completion event still belongs to the current execution round.
	 */
	private inFlightAttemptNos = new Map<string, number>();

	/**
	 * P37.HOTFIX: Mutex serializing stop/stop transitions so concurrent
	 * callers do not race (idempotency guard).
	 */
	private stopMutex = new AsyncMutex();

	/**
	 * P37.HOTFIX: Maximum time (ms) to wait for active workspaces to drain
	 * before force-killing during stop (default 30s).
	 */
	private stopDrainTimeoutMs = 30_000;
	/** Lead Agent for failure supervision — P38.LEAD */
	private leadAgent: LeadAgent | null = null;

	/** P44.04 Terminal Verdict Reconciler for attempt finalization */
	private terminalReconciler: TerminalVerdictReconciler;

	/** Attempt history per workspace, keyed by workspace ID, for terminal reconciliation */
	private attemptHistories: Map<string, ReconcilerAttemptRecord[]> = new Map();

	/**
	 * P37.RCA: Extract test file name from a command string for matching.
	 */
	private extractTestFileFromCommand(command: string): string | undefined {
		const match = command.match(/[a-zA-Z0-9_.-]+test[a-zA-Z0-9_.-]*\.(test|spec)\.(ts|tsx|js|jsx)/i);
		return match ? match[0] : undefined;
	}

	/**
	 * P37.RCA: Check if a workspace execution result is from a stale attempt.
	 *
	 * Returns true if the workspace execution should be treated as stale:
	 * - The workspace's current stage is no longer Active (was terminalized by
	 *   stop or reset to Pending by retry/continue).
	 * - The attempt number doesn't match the current in-flight attempt.
	 * - The plan is stopped/cancelled.
	 *
	 * IMPORTANT: Reads fresh state from the database (not the in-memory cache)
	 * to correctly detect staleness after a new executor (created by Continue)
	 * has reset the workspace while the old executor's promises are still
	 * in-flight. The old implementation used `this.currentPlanState` which was
	 * stale and showed the workspace as Active when it was already Pending in DB.
	 *
	 * Additionally, only Active workspaces may transition. Pending is stale —
	 * the workspace was reset and any incoming completion belongs to a prior
	 * attempt.
	 */
	private async isAttemptStale(
		planExecutionId: string,
		workspaceId: string,
		expectedAttemptNo?: number,
	): Promise<{ stale: boolean; reason?: string }> {
		// Load FRESH state from the database, not from the stale in-memory cache.
		// This catches the case where adoptExistingExecution (called by Continue API)
		// reset the workspace to Pending after the old executor's cache was loaded.
		const state = await this.stateStore.loadState(planExecutionId);
		if (!state) {
			return { stale: true, reason: "no_plan_state" };
		}

		// Check plan status from fresh DB state
		if (state.status === "stopped" || state.status === "cancelled") {
			return { stale: true, reason: `plan_status_${state.status}` };
		}

		// Check workspace stage from fresh DB state
		const wsState = state.workspaces.get(workspaceId);
		if (!wsState) {
			return { stale: true, reason: "workspace_not_found" };
		}

		// P37.RCA: Only Active workspaces may transition. Pending is stale —
		// the workspace was reset (by stop then continue, or by retry). Any
		// incoming completion event belongs to a prior attempt and must be
		// discarded. The old allowance for Pending was wrong: it allowed
		// the catch block's retry path, but that path should only transition
		// workspace state inside the catch block itself, not receive stale
		// completions from the outside.
		if (wsState.stage !== WorkspaceStage.Active) {
			return { stale: true, reason: `workspace_stage_${wsState.stage}` };
		}

		// Check attempt number if provided
		if (expectedAttemptNo !== undefined) {
			const currentAttempt = wsState.attempts;
			if (currentAttempt !== expectedAttemptNo) {
				return { stale: true, reason: `attempt_mismatch_expected_${expectedAttemptNo}_current_${currentAttempt}` };
			}
		}

		return { stale: false };
	}

	/**
	 * Register a promise for tracking via inFlightExecutions.
	 * When the promise settles (resolves or rejects), it is removed from the map.
	 */
	private async appendControlPlaneEvent(
		planExecutionId: string,
		type: JournalEventType,
		data?: Record<string, unknown>,
		workspaceId?: string,
	): Promise<void> {
		try {
			await this.stateStore.appendJournal(planExecutionId, {
				type,
				timestamp: Date.now(),
				workspaceId,
				data,
			});
		} catch {
			// Diagnostics must never break control-plane recovery.
		}
	}

	private detectNoTestsFound(output: string | undefined): boolean {
		return /No test files found|No tests found|0 test files|0 tests/i.test(output ?? "");
	}

	private recordWorkspaceCommand(workspaceId: string, event: WorkspaceCommandExecutionEvent): void {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) return;
		const workspace = this.workspaceQueue?.workspaces.find((w) => w.id === workspaceId);
		const noTestsFoundDetected = this.detectNoTestsFound(event.outputSummary);
		const acceptedCommands = [
			...(workspace?.acceptedEquivalentCommands ?? []),
			...(workspace?.validationRequirement?.acceptedEquivalentCommands ?? []),
		];
		const matchedAcceptedEquivalentCommand = acceptedCommands.find((command) => command === event.command);
		const matchedValidationRequirement = Boolean(
			workspace?.validationRequirement &&
				(event.command === workspace.validationRequirement.preferredCommand ||
					matchedAcceptedEquivalentCommand ||
					(workspace.validationRequirement.testFile &&
						event.command.includes(workspace.validationRequirement.testFile))),
		);

		// P37.RCA: Also check if command contains test file from targetCommand
		// (heuristic match). The agent might run the test from a different cwd
		// (e.g., cd packages/coding-agent && npm test -- test/execution/foo.test.ts)
		// which doesn't match the exact targetCommand string but runs the same test.
		const targetCmdTestFile = workspace?.targetCommand
			? this.extractTestFileFromCommand(workspace.targetCommand)
			: undefined;
		const executedTestFile = this.extractTestFileFromCommand(event.command);
		const sameTestFile = Boolean(targetCmdTestFile && executedTestFile && targetCmdTestFile === executedTestFile);
		void this.appendControlPlaneEvent(
			planExecutionId,
			"command_started",
			{ command: event.command, cwd: event.cwd, startedAt: event.startedAt },
			workspaceId,
		);
		this.completionGate.recordCommand(planExecutionId, workspaceId, event.command);
		this.completionGate.recordCompletion(
			planExecutionId,
			workspaceId,
			event.exitCode ?? -1,
			workspace?.targetCommand === event.command,
			event.command,
			{
				cwd: event.cwd,
				startedAt: event.startedAt,
				finishedAt: event.finishedAt,
				outputSummary: event.outputSummary,
				outputArtifactPath: event.outputArtifactPath,
				matchedValidationRequirement,
				matchedAcceptedEquivalentCommand: matchedAcceptedEquivalentCommand || undefined,
				noTestsFoundDetected,
				equivalentValidationSatisfied:
					event.exitCode === 0 &&
					!noTestsFoundDetected &&
					(Boolean(matchedAcceptedEquivalentCommand) || Boolean(sameTestFile)),
			},
		);
		void this.appendControlPlaneEvent(
			planExecutionId,
			"command_completed",
			{
				command: event.command,
				cwd: event.cwd,
				exitCode: event.exitCode,
				outputArtifactPath: event.outputArtifactPath ?? null,
				isTargetCommand: workspace?.targetCommand === event.command,
				matchedValidationRequirement,
				matchedAcceptedEquivalentCommand: matchedAcceptedEquivalentCommand ?? null,
				noTestsFoundDetected,
			},
			workspaceId,
		);
	}

	private async ignoreStaleWorkspaceCompletion(
		planExecutionId: string,
		workspace: Workspace,
		reason: string,
		error?: string,
	): Promise<WorkspaceExecutionResult> {
		new PiLogger({ planExecId: planExecutionId }).info(
			`[workspace ${workspace.id}] stale_attempt_completion_ignored — ${reason}`,
			{ planExecId: planExecutionId, workspaceId: workspace.id, staleReason: reason },
		);
		await this.appendControlPlaneEvent(
			planExecutionId,
			"stale_attempt_completion_ignored",
			{ reason, error: error ?? null },
			workspace.id,
		);
		await this.appendControlPlaneEvent(
			planExecutionId,
			"illegal_transition_prevented_before_router",
			{ reason, preventedTransition: "PENDING->SUCCEEDED/COMPLETE" },
			workspace.id,
		);

		this.scheduler.releaseFileLocks(workspace);
		await this.stateStore.releaseFileLocks(planExecutionId, workspace.id);
		await this.appendControlPlaneEvent(planExecutionId, "workspace_locks_released", { reason }, workspace.id);
		this.activeAgentExecutors.delete(workspace.id);
		this.inFlightAttemptNos.delete(workspace.id);

		await this.stateCacheMutex.runExclusive(async () => {
			const updatedState = await this.stateStore.loadState(planExecutionId);
			if (updatedState) {
				this.currentPlanState = updatedState;
			}
		});

		return {
			workspaceId: workspace.id,
			success: false,
			verdict: "FAILED",
			error: `Stale completion ignored (${reason})`,
			report: `Stale attempt completion was ignored: ${reason}`,
		};
	}

	private trackExecution(workspaceId: string, promise: Promise<WorkspaceExecutionResult>): void {
		this.inFlightExecutions.set(workspaceId, promise);
		// Suppress unhandled rejection from the .finally() side-chain
		// The caller (executeWorkspace) handles the rejection via catch.
		promise
			.finally(() => {
				if (this.inFlightExecutions.get(workspaceId) === promise) {
					this.inFlightExecutions.delete(workspaceId);
				}
			})
			.catch(() => {});
	}

	constructor(stateStore: IStateStore, config: AutonomousExecutorConfig) {
		this.stateStore = stateStore;
		this.transitionRouter = createTransitionRouter(stateStore);
		this.workspaceRoot = config.workspaceRoot;

		// Resolve effective worker count from workerConcurrency settings or maxWorkers
		const effectiveWorkers = config.workerConcurrency
			? resolveEffectiveWorkerCount(config.workerConcurrency)
			: (config.maxWorkers ?? DEFAULT_WORKERS);

		this.scheduler = new WorkspaceScheduler(effectiveWorkers);
		this.packetBuilder = new RolePacketBuilder();
		this.retryHandler = new RetryHandler(config.retryPolicy);
		this.terminalReconciler = new TerminalVerdictReconciler();
		this.projectId = config.projectId ?? "default";
		this.enableRealExecution = config.enableRealExecution ?? false;
		this.autoCommitEnabled = config.autoCommit ?? true;
		this.scopedCommitEnabled = config.scopedCommitEnabled ?? false;
		this.postPlanHandoffEnabled = config.postPlanHandoff ?? true;
		this.handoffTimeoutMs = config.handoffTimeoutMs ?? 30 * 60 * 1000; // 30 minutes

		// AC1 + AC2: Apply approved preview metadata if provided in config
		if (config.approvedPreview) {
			this.setApprovedPreviewMetadata(config.approvedPreview);
		}

		// If skipProjectManagement and no explicit projectId was provided, use a fixed projectId
		if (config.skipProjectManagement && !config.projectId) {
			this.projectId = "default";
		}

		// P26.B: Store config for lazy per-workspace executor creation.
		// Each executeWorkspace call creates its own WorkspaceAgentExecutor
		// so concurrent workspaces have isolated executor instances.
		if (this.enableRealExecution) {
			this.executorConfig = {
				workspaceRoot: config.workspaceRoot,
				model: config.model,
				maxTurns: 50,
				stateStore: this.stateStore,
				timeoutMs: config.workspaceTimeoutMs,
				// Respect the worktree config passed in from the caller.
				// P22.C worktree enforcement is handled at the WorkspaceAgentExecutor level.
				worktree: config.worktree ?? { enabled: true },
			};
		}

		// P38.LEAD: Wire Lead Agent for failure supervision
		this.leadAgent = config.leadAgent ?? null;

		// P40: Wire WorkerAdapter for platform/agent separation.
		// If no adapter is provided, auto-create a default LocalPiWorkerAdapter.
		if (config.workerAdapter) {
			this.workerAdapter = config.workerAdapter;
		} else if (this.enableRealExecution && this.executorConfig) {
			this.workerAdapter = new LocalPiWorkerAdapter({
				createExecutor: (request) => {
					return new WorkspaceAgentExecutor({
						...this.executorConfig!,
						onCommandExecuted: (event) => this.recordWorkspaceCommand(request.workspaceId, event),
					});
				},
			});
		}
	}

	/**
	 * Update all active agent executors with current plan execution ID after
	 * initialization or when adopting an existing execution.
	 */
	private updateAgentExecutorContext(): void {
		if (this.planExecutionId) {
			for (const executor of this.activeAgentExecutors.values()) {
				executor.setPlanExecutionId(this.planExecutionId);
			}
		}
	}

	/**
	 * Detect execution policy mode from a workspace queue.
	 *
	 * Checks queue metadata (or parsed plan) to determine if this is:
	 * - planspec_locked: queue has a planspecVersion or planSpecJson metadata
	 * - legacy_v411: queue has legacyTemplateVersion metadata
	 * - manual_no_plan: default fallback
	 */
	private detectExecutionPolicy(queue: WQ): ExecutionPolicyContext {
		const metadata = (queue as any).metadata ?? (queue as unknown as Record<string, unknown>);
		const planspecVersion = (queue as any).planSpecVersion ?? (metadata as any).planSpecVersion;
		const legacyVersion = (queue as any).legacyTemplateVersion ?? (metadata as any).legacyTemplateVersion;
		const planSpecJson = (queue as any).planSpecJson ?? (metadata as any).planSpecJson;

		// If the plan carries a PlanSpec v5 version or JSON, it is planspec_locked
		if (planspecVersion || planSpecJson) {
			return {
				mode: "planspec_locked",
				planSpecVersion: (planspecVersion as string) ?? "5.0.0",
				planSpecJson: planSpecJson as string | undefined,
			};
		}

		// If the plan has legacy template version, use legacy_v411
		if (legacyVersion) {
			return {
				mode: "legacy_v411",
				legacyTemplateVersion: legacyVersion as string,
			};
		}

		// Default: manual_no_plan
		return createDefaultPolicyContext();
	}

	/**
	 * Attempt PlanLock admission from queue-stored PlanSpec data.
	 * If successful, stores planLockHash in this.planLockHash.
	 */
	private async admitPlanspecFromQueue(queue: WQ): Promise<void> {
		const metadata = (queue as any).metadata ?? (queue as unknown as Record<string, unknown>);
		const planSpecJson = (queue as any).planSpecJson ?? (metadata as any).planSpecJson;
		if (!planSpecJson) {
			// No PlanSpec JSON means we can't be in planspec_locked mode with enforcement.
			// If the queue metadata says planspec but no JSON, that's a data error.
			const planspecVersion = (queue as any).planSpecVersion ?? (metadata as any).planSpecVersion;
			if (planspecVersion && this.executionPolicy.mode === "planspec_locked") {
				throw new Error(
					`PlanSpec v${planspecVersion} detected but no PlanSpec JSON found in queue metadata. ` +
						"Cannot admit PlanLock without PlanSpec JSON.",
				);
			}
			return;
		}

		const { compilePlanSpecAlpha2 } = await import("./plan-compiler/index.js");

		const compileResult = compilePlanSpecAlpha2(planSpecJson as string);
		if (!compileResult.ok) {
			const errors = compileResult.diagnostics.map((d) => `[${d.severity}] ${d.message}`).join("; ");
			throw new Error(
				`PlanSpec admission rejected: compilation failed. ` +
					`Errors: ${errors || "unknown"}. ` +
					"Cannot start workspace execution. Fix the PlanSpec and re-upload.",
			);
		}

		if (!compileResult.planLock) {
			throw new Error(
				"PlanSpec admission rejected: compilation succeeded but no PlanLock emitted. " +
					"This is an internal error. Cannot start workspace execution.",
			);
		}

		const planLock = compileResult.planLock as import("./planlock-types.js").PlanLock;

		// Success: store lock hashes and per-workspace metadata
		this.planLockHash = planLock.planLockHash;
		this.executionPolicy.planLockHash = planLock.planLockHash;

		// Store per-workspace lock hashes from the admitted PlanLock
		const wsLockHashes: Record<string, string> = {};
		for (const wsId of planLock.normalized.workspaceIds) {
			const wsLock = planLock.normalized.workspaces[wsId];
			if (wsLock) {
				wsLockHashes[wsId] = wsLock.workspaceLockHash;
			}
		}
		(this as any)._workspaceLockHashes = wsLockHashes;
		(this as any)._admittedPlanLock = planLock;

		// Persist lock metadata to state store for dashboard and crash recovery
		if (this.planExecutionId) {
			const planSpecVersion = this.executionPolicy.planSpecVersion ?? "5.0.0";
			await this.stateStore
				.updatePlanLockMetadata(this.planExecutionId, {
					planLockHash: planLock.planLockHash,
					planSpecVersion,
					lockStatus: "admitted",
				})
				.catch(() => {});
		}

		// Emit PlanLock admitted event best-effort; state store persistence is the critical path
		try {
			const { emitPlanLockAdmitted } = await import("./planlock-events.js");
			const { createEventBus: _createBus } = await import("./event-bus.js");
			const bus = (this as any)._eventBus ?? _createBus();
			emitPlanLockAdmitted(bus, {
				planLockHash: planLock.planLockHash,
				planSpecTaskId: planLock.source.planSpecTaskId,
				workspaceCount: planLock.contract.workspaceCount,
				mode: planLock.contract.mode,
			});
		} catch {
			// Event emission is best-effort
		}
	}

	/**
	 * Create a workspace-scoped WorkspaceAgentExecutor for the given workspace.
	 * Registers the executor in activeAgentExecutors for stop/artifact handling.
	 * The executor is removed from the map after execution completes (via
	 * trackExecution cleanup) or abort.
	 */
	private createWorkspaceExecutor(workspaceId: string): WorkspaceAgentExecutor | null {
		if (!this.enableRealExecution || !this.executorConfig) {
			return null;
		}

		// Remove any stale executor for this workspace (from a prior attempt)
		const existing = this.activeAgentExecutors.get(workspaceId);
		if (existing) {
			existing.abort();
			this.activeAgentExecutors.delete(workspaceId);
		}

		const executor = new WorkspaceAgentExecutor({
			...this.executorConfig,
			onCommandExecuted: (event) => this.recordWorkspaceCommand(workspaceId, event),
		});
		if (this.planExecutionId) {
			executor.setPlanExecutionId(this.planExecutionId);
		}
		this.activeAgentExecutors.set(workspaceId, executor);
		return executor;
	}

	/**
	 * Set the approved preview metadata from the plan preview approval flow.
	 *
	 * AC1: Ensures the executor uses the approved dependency graph, not stale
	 * parser output. The batch assignments and topological batches are transferred
	 * to the scheduler for batch-aware scheduling and logging.
	 *
	 * AC2: The approved preview metadata is persisted alongside execution state
	 * for audit and crash recovery.
	 *
	 * @param metadata - Approved preview metadata (batch assignments, batches, etc.)
	 */
	setApprovedPreviewMetadata(metadata: ApprovedPreviewMetadata): void {
		this.approvedPreview = metadata;

		// Transfer batch assignments to scheduler for AC4 (batch ID logging)
		const batchAssignment = new Map<string, number>(Object.entries(metadata.batchAssignment));
		this.scheduler.setBatchAssignment(batchAssignment, metadata.batches);
	}

	/**
	 * Get the approved preview metadata.
	 *
	 * @returns Approved preview metadata or null if not set
	 */
	getApprovedPreviewMetadata(): ApprovedPreviewMetadata | null {
		return this.approvedPreview;
	}

	/**
	 * Initialize execution for a plan
	 *
	 * @param queue - Workspace queue
	 */
	async initialize(queue: WQ): Promise<string> {
		// NOTE: The old hasRunningExecution phase-based dedup check was removed.
		// Each plan upload should always create a fresh execution. The in-flight
		// guard in runPlan() prevents concurrent calls for the same project.

		const planExecutionId = await this.stateStore.initializeState(this.projectId, queue);
		this.planExecutionId = planExecutionId;
		this.workspaceQueue = queue;

		// Apply queue-level postPlanHandoff setting
		if (queue.postPlanHandoff !== undefined) {
			this.postPlanHandoffEnabled = queue.postPlanHandoff;
		}

		// Load state into cache
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) {
			this.currentPlanState = state;
		}

		// Detect execution policy mode from queue/plan.
		// If the queue has a PlanSpec v5 template reference, use planspec_locked.
		// If the queue has a legacy template version, use legacy_v411.
		// Default to manual_no_plan.
		this.executionPolicy = this.detectExecutionPolicy(queue);

		// If planspec_locked mode, try to admit the PlanSpec.
		// The planSpecJson or parsedPlanSpec should come from queue metadata.
		if (this.executionPolicy.mode === "planspec_locked") {
			await this.admitPlanspecFromQueue(queue);
		}

		// Store policy mode in plan state
		if (this.currentPlanState) {
			const ps = this.currentPlanState as any;
			ps.executionPolicyMode = this.executionPolicy.mode;
			ps.planSpecVersion = this.executionPolicy.planSpecVersion;
			ps.planLockHash = this.planLockHash;
			ps.lockStatus = this.planLockHash ? "admitted" : undefined;
			await this.stateStore.saveState(planExecutionId).catch(() => {});
		}

		// Update agent executor with the new plan execution ID
		this.updateAgentExecutorContext();

		return planExecutionId;
	}

	/**
	 * Adopt an existing execution for crash recovery.
	 *
	 * Loads persisted state and workspace queue, then resets any stranded
	 * active/pending workspaces so the background loop can resume them.
	 *
	 * @param planExecutionId - Existing execution ID
	 * @param queue - The original workspace queue (used for scheduling)
	 */
	async adoptExistingExecution(
		planExecutionId: string,
		queue: WorkspaceQueue,
		options: { allowTerminal?: boolean } = {},
	): Promise<boolean> {
		this.planExecutionId = planExecutionId;
		this.workspaceQueue = queue;

		// Apply queue-level postPlanHandoff setting
		if (queue.postPlanHandoff !== undefined) {
			this.postPlanHandoffEnabled = queue.postPlanHandoff;
		}

		const state = await this.stateStore.loadState(planExecutionId);
		if (!state) {
			return false;
		}
		this.currentPlanState = state;

		// If the plan is already terminal, only manual continue/rerun may adopt it.
		if (state.status === "complete") {
			return false;
		}
		if ((state.status === "failed" || state.status === "cancelled") && !options.allowTerminal) {
			return false;
		}

		// Reset scheduler caches (fileLocks, batchAssignment, batches) to prevent
		// stale locks from previous execution from blocking workspace scheduling.
		this.scheduler.reset();

		// P37.HOTFIX: Reset stranded or resettable workspaces.
		// Active workspaces must first be terminalized (to Failed) before resetting
		// to Pending. Direct Active -> Pending bypasses the attempt FSM and can cause
		// illegal PENDING -> SUCCEEDED transitions if a stale completion arrives.
		// Completed workspaces are never reset.
		let recovered = 0;
		const resetReason = options.allowTerminal ? "manual-continue" : "crash-recovery";
		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === WorkspaceStage.Active) {
				// Terminalize active workspaces first, then reset to Pending
				try {
					await this.transitionRouter.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Failed, {
						reason: resetReason,
						previousStage: ws.stage,
						note: `Stranded workspace from ${resetReason} — terminalized before reset`,
					});
				} catch {
					// If FSM rejects (e.g. attempt already gone), fallback to direct store
					await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Failed, {
						reason: resetReason,
					});
				}
				await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
					reason: resetReason,
					previousStage: WorkspaceStage.Failed,
				});
				recovered++;
			} else if (
				ws.stage === WorkspaceStage.Failed ||
				(options.allowTerminal && ws.stage === WorkspaceStage.Blocked)
			) {
				await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
					reason: resetReason,
					previousStage: ws.stage,
				});
				recovered++;
			}
		}

		// Reset paused/stopped/failed/cancelled plans to running so the loop picks them up.
		if (
			state.status === "paused" ||
			state.status === "stopped" ||
			(options.allowTerminal && (state.status === "failed" || state.status === "cancelled"))
		) {
			await this.stateStore.resumePlan(planExecutionId);
		}

		// Update agent executor with the current plan execution ID (#2/#3)
		this.updateAgentExecutorContext();

		// Rebuild completion gate state from persisted workspace state (#4).
		// Completed workspaces are marked as implementation-finished so the
		// gate doesn't block them when evaluateWorkspaceCompletion is called.
		this.completionGate = new CompletionGateRegistry();
		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === WorkspaceStage.Complete) {
				this.completionGate.markImplementationFinished(planExecutionId, wsId);
			}
		}

		// Reload state cache after transitions so the background loop sees
		// the updated workspace states (e.g. stranded Active → Pending).
		const updatedState = await this.stateStore.loadState(planExecutionId);
		if (updatedState) {
			this.currentPlanState = updatedState;
		}

		const log = new PiLogger({ planExecId: planExecutionId });
		log.info(
			`Adopted execution ${planExecutionId}, recovered ${recovered} stranded workspace(s), status=${state.status}`,
		);

		return true;
	}

	/**
	 * Get the current plan execution ID.
	 */
	getPlanExecutionId(): string | null {
		return this.planExecutionId;
	}

	/**
	 * Re-run a failed plan execution, skipping already-completed workspaces.
	 *
	 * Resets failed and blocked workspaces back to pending so they can be
	 * re-scheduled. Completed workspaces are left untouched. The plan status
	 * is reset from "failed" to "running" so the execution loop picks it up.
	 *
	 * Returns a summary of what was reset and what was kept.
	 *
	 * @param queue - The original workspace queue (for scheduling/dependency graph)
	 * @param options - Rerun options
	 * @returns Rerun result summary
	 */
	async rerunExecution(
		queue: WorkspaceQueue,
		options: { resetBlocked?: boolean; resetFailed?: boolean } = {},
	): Promise<{
		success: boolean;
		resetWorkspaces: string[];
		keptWorkspaces: string[];
		error?: string;
	}> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return { success: false, resetWorkspaces: [], keptWorkspaces: [], error: "No plan execution ID" };
		}

		const state = await this.stateStore.loadState(planExecutionId);
		if (!state) {
			return { success: false, resetWorkspaces: [], keptWorkspaces: [], error: "No state found to rerun" };
		}

		// Only allow rerun for terminal states (failed, stopped, cancelled)
		if (state.status !== "failed" && state.status !== "stopped" && state.status !== "cancelled") {
			return {
				success: false,
				resetWorkspaces: [],
				keptWorkspaces: [],
				error: `Plan status is '${state.status}', not a terminal state. Rerun is only for failed/stopped/cancelled plans.`,
			};
		}

		const resetFailed = options.resetFailed ?? true;
		const resetBlocked = options.resetBlocked ?? true;
		const resetWorkspaces: string[] = [];
		const keptWorkspaces: string[] = [];

		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === WorkspaceStage.Complete) {
				keptWorkspaces.push(wsId);
				continue;
			}

			if (ws.stage === WorkspaceStage.Failed && resetFailed) {
				await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
					reason: "rerun",
					previousStage: ws.stage,
				});
				resetWorkspaces.push(wsId);
				continue;
			}

			if (ws.stage === WorkspaceStage.Blocked && resetBlocked) {
				await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, {
					reason: "rerun",
					previousStage: ws.stage,
				});
				resetWorkspaces.push(wsId);
				continue;
			}

			// Active or pending workspaces: just keep them as-is (they'll be picked up)
			if (ws.stage === WorkspaceStage.Active || ws.stage === WorkspaceStage.Pending) {
				keptWorkspaces.push(wsId);
				continue;
			}

			// Any other stage (shouldn't happen, but be safe)
			keptWorkspaces.push(wsId);
		}

		if (resetWorkspaces.length === 0) {
			return {
				success: false,
				resetWorkspaces: [],
				keptWorkspaces,
				error: "No workspaces to reset. All workspaces are already complete or not in a resettable state.",
			};
		}

		// Reset plan status to running so the execution loop picks it up
		await this.stateStore.resumePlan(planExecutionId);

		// Load updated state into cache
		this.workspaceQueue = queue;
		this.currentPlanState = await this.stateStore.loadState(planExecutionId);

		// P37.RCA: Clear any pending control requests from both file-based
		// and database-backed state stores. The stop API writes control
		// requests to the state store, not just the file manager. Stale
		// control requests cause the new execution loop to immediately
		// stop on the first iteration.
		try {
			const { createPlanControlManager } = await import("./plan-control.js");
			const mgr = createPlanControlManager(this.workspaceRoot);
			await mgr.clearControlRequest();
		} catch {
			// Non-fatal — control file may not exist
		}
		try {
			await this.stateStore.clearControlRequest(planExecutionId);
		} catch {
			// Non-fatal — database may not support control requests
		}

		const log = new PiLogger({ planExecId: planExecutionId });
		log.info(
			`Rerun execution ${planExecutionId}: reset ${resetWorkspaces.length} workspace(s), kept ${keptWorkspaces.length} complete`,
		);

		return { success: true, resetWorkspaces, keptWorkspaces };
	}

	/**
	 * Execute a single workspace
	 *
	 * This is a simplified execution that:
	 * 1. Creates workspace snapshot directory
	 * 2. Generates role packet
	 * 3. Saves packet to snapshot
	 * 4. Simulates execution (actual agent execution deferred)
	 * 5. Generates report
	 * 6. Updates state
	 *
	 * @param workspace - Workspace to execute
	 * @returns Execution result
	 */
	/**
	 * Execute a single workspace.
	 *
	 * P26.D: Accepts an optional AbortSignal. When the signal fires,
	 * the workspace-scoped executor is aborted and execution resolves
	 * with a FAILED verdict.
	 *
	 * @param workspace - Workspace to execute
	 * @param simulateFailure - Simulate a failure (for testing)
	 * @param abortSignal - Optional external abort signal
	 * @returns Execution result
	 */
	async executeWorkspace(
		workspace: Workspace,
		simulateFailure = false,
		abortSignal?: AbortSignal,
	): Promise<WorkspaceExecutionResult> {
		const { planExecutionId, wsState } = await this.stateCacheMutex.runExclusive(async () => {
			const planExecutionId = this.planExecutionId;
			if (!planExecutionId) {
				throw new Error("Execution not initialized. Call initialize() first.");
			}

			const state = this.currentPlanState;
			if (!state) {
				throw new Error("State not initialized");
			}

			const wsState = state.workspaces.get(workspace.id);
			if (!wsState) {
				throw new Error(`Workspace ${workspace.id} not found in state`);
			}

			return { planExecutionId, wsState } as const;
		});

		try {
			// Memory guard: check before starting a new agent session
			const { getMemorySnapshot, canStartWorker, waitForMemoryAvailable, formatMemorySnapshot } = await import(
				"./worker-memory-guard.js"
			);
			const memSnap = getMemorySnapshot();
			if (!canStartWorker(`workspace ${workspace.id}`)) {
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Memory limit reached (${formatMemorySnapshot(memSnap)}), waiting...`,
				);
				await waitForMemoryAvailable();
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Memory available, proceeding`,
				);
			}

			// Increment execution attempt counter for every agent run.
			// Attempt 1 is the initial execution; the state store suppresses
			// retry_attempt journal events until attempt > 1.
			await this.transitionRouter.incrementRetryAttempt(planExecutionId, workspace.id);
			const updatedWsState = await this.stateStore.getWorkspaceState(planExecutionId, workspace.id);

			// P37.HOTFIX: Track the attempt number so the stale attempt guard
			// can verify that completion events still belong to this execution.
			const currentAttemptNo = updatedWsState?.attempts ?? wsState?.attempts ?? 1;
			this.inFlightAttemptNos.set(workspace.id, currentAttemptNo);

			// Transition to active via TransitionRouter (Finding 2)
			await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Active);

			// P41.2: Bridge workspace start to brain activity timeline
			const phase = this.workspaceQueue?.phase ?? "unknown";
			await this.bridgeToBrainActivity(
				planExecutionId,
				workspace.id,
				"observation",
				"info",
				`Workspace ${workspace.id} started`,
				`Workspace ${workspace.id} executing (attempt ${currentAttemptNo})`,
				phase,
				"started",
				{ attemptNo: currentAttemptNo },
			).catch(() => {});

			// Create workspace snapshot directory
			const snapshot = await this.createWorkspaceSnapshot(workspace.id);

			// Release stale file locks from completed/failed workspaces before acquiring new ones.
			// This prevents lock contention between workspaces with overlapping canEdit paths
			// (e.g., "src/**") when a prior workspace has finished but its locks weren't released.
			const currentPlanState = this.currentPlanState;
			if (currentPlanState) {
				for (const [wsId, wsState] of currentPlanState.workspaces) {
					if (wsState.stage === WorkspaceStage.Complete || wsState.stage === WorkspaceStage.Failed) {
						this.scheduler.releaseLocksByWorkspaceId(wsId);
					}
				}
			}

			// Acquire file locks
			const lockedFiles = this.scheduler.acquireFileLocks(workspace);
			await this.stateStore.acquireFileLocks(planExecutionId, workspace.id, lockedFiles);

			const wsStateForPacket = updatedWsState ?? wsState;

			// Determine retry stage and generate appropriate packet
			const retryStage = this.retryHandler.getRetryStage(wsStateForPacket.attempts);
			const retryContext = wsStateForPacket.error
				? this.retryHandler.getRetryContext(wsStateForPacket, wsStateForPacket.error)
				: "";

			const policy = this.retryHandler.getPolicy();
			const flashThreshold = policy.escalationThresholds.flash;
			const reviewerThreshold = policy.escalationThresholds.reviewer;
			let packet: HashedPacket;

			// P8.A: Dispatch based on workspace role budget
			// Lead role: read-only observation, skip retry escalation
			if (workspace.roleBudget === "lead") {
				// Gather dependency results for lead context from current plan state
				const depResults: Record<string, string> = {};
				const currentState = this.currentPlanState;
				if (currentState) {
					for (const depId of workspace.dependencies) {
						const depState = currentState.workspaces.get(depId);
						if (depState && depState.stage === WorkspaceStage.Complete) {
							depResults[depId] = depState.error || "Completed";
						}
					}
				}
				packet = this.packetBuilder.buildLeadPacket(workspace, wsStateForPacket, depResults);
				// Log that this is a read-only lead agent execution
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Lead role — read-only execution, no mutations allowed`,
				);
			} else if (retryStage === RetryStage.Flash && wsStateForPacket.attempts >= flashThreshold) {
				packet = this.packetBuilder.buildFlashPacket(workspace, wsStateForPacket, retryContext);
			} else if (retryStage === RetryStage.Reviewer && wsStateForPacket.attempts >= reviewerThreshold) {
				packet = this.packetBuilder.buildReviewerPacket(workspace, wsStateForPacket, retryContext);
			} else {
				packet = this.packetBuilder.buildWorkerPacket(workspace, wsStateForPacket, retryContext);
			}

			// Save packet to snapshot
			await this.savePacketSnapshot(snapshot, packet, wsStateForPacket.attempts);

			// P26.B: Create a workspace-scoped executor for this call.
			// Each executeWorkspace call gets its own WorkspaceAgentExecutor so
			// concurrent workspaces cannot overwrite each other's executor state.
			const workspaceExecutor = this.createWorkspaceExecutor(workspace.id);

			// Execute workspace with real agent or simulate
			// P4.6.3: Wrap execution in a tracked promise so stopAllActiveWorkspaces() can await it.
			// P26.D: External abort signal is passed to execute() via _signal option;
			// execute() wires it to the internal abortController internally.
			const executionPromise = (async (): Promise<WorkspaceExecutionResult> => {
				let result: WorkspaceExecutionResult;

				if (this.enableRealExecution && this.workerAdapter) {
					// P40: WorkerAdapter path — adapter executes work and returns result.
					// Execution decides how the result maps to workspace state.
					const logPath = path.join(snapshot.snapshotDir, `execution-${wsStateForPacket.attempts}.log`);

					const workerResult = await this.workerAdapter.run({
						planExecutionId,
						workspaceExecutionId: workspace.id,
						workspaceId: workspace.id,
						attemptNumber: wsStateForPacket.attempts,
						projectRoot: this.workspaceRoot,
						workspacePath: this.workspaceRoot,
						packet: packet as unknown as Record<string, unknown>,
						allowedTools: [],
						timeoutMs: this.executorConfig?.timeoutMs ?? 30 * 60 * 1000,
						abortSignal,
						metadata: {
							logPath,
						},
					});

					// ACCP compile hook: if worker produced ACCP output, compile it
					// Gated by ACCP mode (warn = diagnostic only, required = blocking)
					if (workerResult.accp?.shouldCompile && workerResult.accp?.sourceYaml) {
						try {
							const compileResult = compileAccpSource(workerResult.accp.sourceYaml);
							workerResult.accp.compiledArtifactPath = `reports/accp/${planExecutionId || "P49"}/compiled/${workerResult.accp.reportId}.compiled.json`;
							workerResult.accp.diagnostics = compileResult.diagnostics;

							// P49.31 FIX-007: persist the compiled artifact through
							// the AccpArtifactStore so the AccpGate reader can
							// consume it later through the same store.
							try {
								const store = new AccpArtifactStore({
									rootDir: "reports/accp",
									planId: planExecutionId || "P49",
								});
								store.saveCompiled(workerResult.accp.reportId, compileResult);
								if (workerResult.accp.routeSignal) {
									store.saveRouteSignal(workerResult.accp.reportId, workerResult.accp.routeSignal);
								}
							} catch (storeErr) {
								console.warn(`[ACCP] Artifact store write failed for ${workerResult.accp.reportId}:`, storeErr);
							}

							if (compileResult.hasBlockingFindings) {
								console.error(`[ACCP] Compilation warnings/errors for ${workerResult.accp.reportId}:`);
								for (const d of compileResult.diagnostics) {
									console.error(`  [${d.code}] ${d.message}`);
								}

								// P49.25: Invoke the repair loop for canonicalization.
								// The repair prompt is stored on the worker result so the
								// caller can inject it into the worker's next attempt.
								const repairResult = runAccpRepairLoop(compileResult);
								if (repairResult.repairPrompt) {
									workerResult.accp.repairPrompt = repairResult.repairPrompt;
									console.error(
										`[ACCP] Repair prompt generated for ${workerResult.accp.reportId} (attempts: ${repairResult.attempts})`,
									);
								}
							}
						} catch (err) {
							console.error(`[ACCP] Compile hook error: ${err}`);
						}
					}

					// Write execution logs (the adapter writes logs, but keep this
					// as a safety net in case adapter didn't write them)
					if (workerResult.report) {
						await fs.writeFile(logPath, workerResult.report, "utf-8").catch(() => {});
					}

					if (workerResult.error?.startsWith("Transient provider failure:")) {
						throw new Error(workerResult.error);
					}

					// Map WorkerRunResult to WorkspaceExecutionResult
					result = {
						workspaceId: workspace.id,
						success: workerResult.verdict === "complete",
						verdict:
							workerResult.verdict === "complete"
								? "COMPLETE"
								: workerResult.verdict === "blocked"
									? "BLOCKED"
									: "FAILED",
						report: workerResult.report,
						error: workerResult.error,
						contextUsed: workerResult.metadata?.contextUsed as number | undefined,
					};
				} else if (this.enableRealExecution && workspaceExecutor) {
					// Legacy path — direct WorkspaceAgentExecutor construction
					const logPath = path.join(snapshot.snapshotDir, `execution-${wsStateForPacket.attempts}.log`);

					// P26.C: Pass logPath to execute() instead of calling setLogPath()
					// P26.D: Pass abortSignal so execute() wires it to the internal abortController
					// P26.F: Pass attemptNo for attempt-scoped worktree paths and branch names
					// V5: Pass planLockHash/workspaceLockHash/executionPolicyMode for planspec_locked
					const v5PacketInfo =
						this._admittedPlanLock && this.executionPolicy.mode === "planspec_locked"
							? {
									planLockHash: this.planLockHash,
									workspaceLockHash: this._workspaceLockHashes[workspace.id],
									executionPolicyMode: this.executionPolicy.mode as any,
								}
							: {};
					const agentResult = await workspaceExecutor.execute(packet, workspace.id, {
						_signal: abortSignal,
						logPath,
						attemptNo: wsStateForPacket.attempts,
						...v5PacketInfo,
					});

					// Write execution logs (also written by executor on completion, but keep
					// this as a safety net in case executor didn't write them for any reason)
					await fs.writeFile(logPath, agentResult.logs.join("\n"), "utf-8");

					if (agentResult.error?.startsWith("Transient provider failure:")) {
						throw new Error(agentResult.error);
					}

					result = {
						workspaceId: workspace.id,
						success: agentResult.success,
						verdict: agentResult.verdict,
						report: agentResult.report,
						error: agentResult.error,
						contextUsed: agentResult.contextUsed,
					};
				} else {
					// Simulate execution (for testing/backward compat)
					if (simulateFailure) {
						throw new Error("Simulated test failure");
					}

					result = {
						workspaceId: workspace.id,
						success: true,
						verdict: "COMPLETE",
						report: `Workspace ${workspace.id} executed successfully (attempt ${wsStateForPacket.attempts}) [SIMULATED]`,
					};
				}

				return result;
			})();

			this.trackExecution(workspace.id, executionPromise);
			const result = await executionPromise;

			// P37.STABILITY: Before any completion path can transition the workspace,
			// reload DB truth and quarantine stale completions. This protects lead-role
			// and completion-gate paths alike from old workers finishing after Stop or
			// Continue reset the workspace to Pending.
			const preTransitionStale = this.isStopping
				? { stale: true, reason: "plan_stopping" }
				: await this.isAttemptStale(planExecutionId, workspace.id, currentAttemptNo);
			if (preTransitionStale.stale) {
				return this.ignoreStaleWorkspaceCompletion(
					planExecutionId,
					workspace,
					preTransitionStale.reason ?? "stale_attempt",
				);
			}

			// P26.B: Keep the workspace-scoped executor registered until after
			// auto-commit so commitWorkspace() can read its effective worktree root.

			// P44.04: Record attempt in history for terminal reconciliation
			{
				const attemptRecord: ReconcilerAttemptRecord = {
					attemptNo: currentAttemptNo,
					verdict: result.verdict,
					confidence: result.success ? "high" : "medium",
					reasoning: result.error || (result.success ? "Execution completed successfully" : "Execution failed"),
					error: result.error,
					completedAt: Date.now(),
				};
				const existing = this.attemptHistories.get(workspace.id) ?? [];
				existing.push(attemptRecord);
				this.attemptHistories.set(workspace.id, existing);

				// Reconcile attempt history
				const reconciled = this.terminalReconciler.reconcile(workspace.id, existing);
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] P44.04 reconciliation after attempt ${currentAttemptNo}: ${reconciled.finalVerdict} (${reconciled.totalAttempts} attempt(s), definitive=${reconciled.isDefinitive})`,
				);
			}

			// Generate and save report
			const report = generateWorkspaceReport(workspace, {
				...wsStateForPacket,
				stage: WorkspaceStage.Complete,
				completedAt: Date.now(),
			});
			await this.saveReport(snapshot, report);

			// Release file locks
			this.scheduler.releaseFileLocks(workspace);
			await this.stateStore.releaseFileLocks(planExecutionId, workspace.id);

			// P8.A: Lead role — skip completion gate (no implementation to validate) and auto-commit
			const isLeadRole = workspace.roleBudget === "lead";
			if (isLeadRole) {
				// Lead agents are read-only observers; mark complete directly without completion gate
				// Routes through TransitionRouter for FSM enforcement (Finding 2)
				if (result.verdict === "COMPLETE") {
					await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Complete, {
						verdict: result.verdict,
					});
				} else {
					await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Complete, {
						verdict: result.verdict,
						note: "Lead agent completed observation, no mutations performed",
					});
				}

				// Log that lead agent completed without mutations
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] Lead agent completed — read-only observation, no mutations performed. Verdict: ${result.verdict}`,
				);

				// Update local cache
				await this.stateCacheMutex.runExclusive(async () => {
					const updatedState = await this.stateStore.loadState(planExecutionId);
					if (updatedState) {
						this.currentPlanState = updatedState;
					}
				});

				// Skip auto-commit for lead agents (no changes to commit)
				this.activeAgentExecutors.delete(workspace.id);
				return result;
			}

			// Feed the completion gate with execution results before evaluating (P4.6.1).
			// The agent executor does not call into the completion gate directly, so we
			// translate the agent result into gate state here.
			//
			// P37.HOTFIX: Do NOT blindly mark targetCommand as passed just because the
			// agent returned COMPLETE. Instead, mark implementation as finished and let
			// the completion gate evaluate whether the validation requirement was met based
			// on command history or equivalent validation records. If the agent report/log
			// contains evidence that a low-memory equivalent test passed, that is recorded
			// as an equivalent validation artifact via recordEquivalentCommand().
			if (result.verdict === "COMPLETE") {
				// Mark implementation as finished
				this.completionGate.markImplementationFinished(planExecutionId, workspace.id);
				// If a targetCommand was specified, record it via the equivalent command path
				// so the gate can check command history for equivalence. Do NOT blindly set
				// targetCommandPassed=true — the gate must see real command evidence.
				if (workspace.targetCommand) {
					// Scan agent report for equivalent command evidence. If the report mentions
					// running an equivalent command with exit code 0, record it.
					const reportText = result.report ?? "";
					const acceptedCommands = new Set<string>();
					if (workspace.acceptedEquivalentCommands) {
						for (const cmd of workspace.acceptedEquivalentCommands) {
							acceptedCommands.add(cmd);
						}
					}
					if (workspace.validationRequirement?.acceptedEquivalentCommands) {
						for (const cmd of workspace.validationRequirement.acceptedEquivalentCommands) {
							acceptedCommands.add(cmd);
						}
					}
					// Check if report contains evidence of a successful equivalent command
					let foundEquivalent = false;
					if (acceptedCommands.size > 0) {
						for (const cmd of acceptedCommands) {
							if (reportText.includes(cmd)) {
								this.completionGate.recordEquivalentCommand(planExecutionId, workspace.id, cmd, 0);
								foundEquivalent = true;
								break;
							}
						}
					}
					// Check if report mentions the test file from validationRequirement
					if (!foundEquivalent && workspace.validationRequirement?.testFile) {
						if (reportText.includes(workspace.validationRequirement.testFile)) {
							this.completionGate.recordEquivalentCommand(
								planExecutionId,
								workspace.id,
								workspace.targetCommand,
								0,
							);
						}
					}
					// Only mark target command explicitly passed if there IS command history
					// evidence (from actual command execution, not just agent report).
					// The recordEquivalentCommand above provides a fallback for the agent report case.
				}
			}
			// Process lifecycle containment: kill any orphaned child processes
			// (vitest, npm, node, etc.) that the agent may have spawned via the bash
			// tool and left running — even if the agent reported COMPLETE. Run on
			// both success and failure, not only when result.verdict === "COMPLETE".
			killTrackedDetachedChildren();

			// P43.8A: Validate commit safety via WorkspaceCommitGate before completion gate
			if (workspace.writeSet && workspace.writeSet.length > 0 && this.workspaceRoot) {
				const commitSafetyReasons = await this.completionGate.validateCommitSafety({
					repoRoot: this.workspaceRoot,
					workspaceId: workspace.id,
					allowedWriteSet: workspace.writeSet,
					allowDeletedOwnedFiles: true,
					allowGeneratedArtifacts: false,
					forbidBulkGitAdd: true,
					forbidCommitAll: true,
				});
				if (commitSafetyReasons.length > 0) {
					console.error(
						`[autonomous-executor] Workspace ${workspace.id} commit safety blocked: ${commitSafetyReasons.join("; ")}`,
					);
					// Block completion
					const blockMsg = commitSafetyReasons.join("; ");
					await this.appendControlPlaneEvent(planExecutionId, "workspace_blocked", {
						reason: blockMsg,
						blockType: "workspace_commit_gate",
					});
					await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Blocked, {
						commitGateBlock: blockMsg,
					});
					this.activeAgentExecutors.delete(workspace.id);
					this.inFlightAttemptNos.delete(workspace.id);
					return {
						workspaceId: workspace.id,
						success: false,
						verdict: "FAILED",
						error: blockMsg,
						report: `Workspace blocked: ${blockMsg}`,
					};
				}
			}

			// Evaluate via registry to get the live state after mutations above.
			// In planspec_locked mode, use the V2 evaluation with PlanSpec-aware checks.
			const isPlanspecLocked = this.executionPolicy.mode === "planspec_locked";

			// Set lock hashes on validation state for PlanSpec mode
			if (isPlanspecLocked && this.planLockHash && this._workspaceLockHashes[workspace.id]) {
				this.completionGate.setLockHashes(
					planExecutionId,
					workspace.id,
					this.planLockHash,
					this._workspaceLockHashes[workspace.id],
				);
			}

			// Extract worker echo from report if available
			let workerReportedPlanLockHash: string | undefined;
			let workerReportedWorkspaceLockHash: string | undefined;

			if (isPlanspecLocked && result.report) {
				const echoResult = extractWorkerEcho(result.report);
				if (echoResult.success && echoResult.claim) {
					workerReportedPlanLockHash = echoResult.claim.planLockHash;
					workerReportedWorkspaceLockHash = echoResult.claim.workspaceLockHash;
				}
			}

			const gateResult = isPlanspecLocked
				? this.completionGate.evaluateWorkspaceV2(planExecutionId, workspace.id, workspace, {
						planspecMode: true,
						expectedPlanLockHash: this.planLockHash,
						expectedWorkspaceLockHash: this._workspaceLockHashes[workspace.id],
						workerReportedPlanLockHash,
						workerReportedWorkspaceLockHash,
					})
				: this.completionGate.evaluateWorkspace(planExecutionId, workspace.id, workspace);

			// P37.HOTFIX: Stale attempt guard — check if workspace is still current
			// before attempting any transition. If the workspace was terminalized
			// by a plan stop during execution, skip the transition.
			if (this.isStopping || (await this.isAttemptStale(planExecutionId, workspace.id, currentAttemptNo)).stale) {
				const staleReason = this.isStopping ? "plan_stopping" : "stale_attempt";
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] stale_attempt_completion_ignored — workspace was ${staleReason}, discarding completion result`,
					{ planExecId: planExecutionId, workspaceId: workspace.id, staleReason },
				);
				// Clean up without transitioning (workspace is already terminal)
				this.activeAgentExecutors.delete(workspace.id);
				this.inFlightAttemptNos.delete(workspace.id);
				// Update local cache
				await this.stateCacheMutex.runExclusive(async () => {
					const updatedState = await this.stateStore.loadState(planExecutionId);
					if (updatedState) {
						this.currentPlanState = updatedState;
					}
				});
				return {
					workspaceId: workspace.id,
					success: false,
					verdict: "FAILED",
					error: `Stale completion ignored (${staleReason})`,
					report: `Stale attempt completion was ignored because the workspace was terminalized by plan stop.`,
				};
			}

			if (gateResult.canComplete) {
				await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Complete, {
					verdict: result.verdict,
				});
				// Persist contextUsed so the web server can read it from state
				// instead of parsing log files on every request.
				if (result.contextUsed !== undefined) {
					await this.stateStore
						.updateWorkspaceState(planExecutionId, workspace.id, {
							contextUsed: result.contextUsed,
						})
						.catch(() => {});
				}
				// P44.04: Clear attempt history for terminal workspace
				this.attemptHistories.delete(workspace.id);
				// P41.2: Bridge completed workspace event to brain activity timeline
				const phase = this.workspaceQueue?.phase ?? "unknown";
				await this.bridgeToBrainActivity(
					planExecutionId,
					workspace.id,
					"observation",
					"info",
					`Workspace ${workspace.id} completed`,
					`Workspace ${workspace.id} completed with verdict: ${result.verdict}`,
					phase,
					"completed",
					{ verdict: result.verdict, attempts: currentAttemptNo },
				).catch(() => {});
			} else {
				// Completion gate blocked — transition to the recommended state instead
				const gateBlockMsg = gateResult.blockReasons.join("; ");
				console.error(`[completion-gate] Workspace ${workspace.id} cannot be marked complete: ${gateBlockMsg}`);

				// P38.LEAD: Observe completion gate block through Lead Agent
				if (this.leadAgent) {
					try {
						this.leadAgent.observeEvent({
							eventType: "completion_gate_blocked",
							planExecId: planExecutionId,
							workspaceId: workspace.id,
							attemptNo: currentAttemptNo,
							errorMessage: `Completion gate blocked: ${gateBlockMsg}`,
							completionGateBlockReasons: gateResult.blockReasons,
							timestamp: Date.now(),
						});
					} catch {
						// Lead Agent observation failure must not crash
					}
				}
				// Write the block reason into the workspace state and journal so the
				// dashboard can show why execution is blocked.
				await this.appendControlPlaneEvent(
					planExecutionId,
					"completion_gate_blocked_visible",
					{ blockReasons: gateResult.blockReasons },
					workspace.id,
				);
				await this.stateStore.updateWorkspaceState(planExecutionId, workspace.id, {
					error: `Completion gate blocked: ${gateBlockMsg}`,
					contextUsed: result.contextUsed,
				});
				await this.transitionRouter.transitionWorkspace(
					planExecutionId,
					workspace.id,
					gateResult.recommendedState,
					{
						verdict: "FAILED",
						gateBlockReasons: gateResult.blockReasons,
					},
				);
				result.success = false;
				result.verdict = gateResult.recommendedState === WorkspaceStage.Blocked ? "BLOCKED" : "FAILED";
				// P44.04: Clear attempt history for terminal workspace
				this.attemptHistories.delete(workspace.id);
				// P41.2: Bridge blocked/failed workspace event to brain activity timeline
				const phase = this.workspaceQueue?.phase ?? "unknown";
				const bridgeEventType: TimelineEventType =
					gateResult.recommendedState === WorkspaceStage.Blocked ? "observation" : "observation";
				const bridgeStatus = gateResult.recommendedState === WorkspaceStage.Blocked ? "failed" : "failed";
				const bridgeTitle =
					gateResult.recommendedState === WorkspaceStage.Blocked
						? `Workspace ${workspace.id} blocked`
						: `Workspace ${workspace.id} failed`;
				await this.bridgeToBrainActivity(
					planExecutionId,
					workspace.id,
					bridgeEventType,
					"warning",
					bridgeTitle,
					`Gate blocked: ${gateBlockMsg}`,
					phase,
					bridgeStatus,
					{ verdict: result.verdict, gateBlockReasons: gateResult.blockReasons },
				).catch(() => {});
			}

			// Update local cache
			await this.stateCacheMutex.runExclusive(async () => {
				const updatedState = await this.stateStore.loadState(planExecutionId);
				if (updatedState) {
					this.currentPlanState = updatedState;
				}
			});

			// Auto-commit on success (skipped for lead agents — no changes to commit)
			if (result.success && workspace.autoCommit !== false) {
				try {
					await this.commitWorkspace(workspace);
				} catch (commitError) {
					// Commit failure logs warning, does not fail workspace
					const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
					console.warn(`[auto-commit] Warning: commit failed for workspace ${workspace.id}: ${commitMsg}`);
				}
			}

			// P26.B: Remove workspace-scoped executor after auto-commit has had a
			// chance to inspect the worktree root.
			this.activeAgentExecutors.delete(workspace.id);

			// NOTE: The plan-runner (executePlanInBackground) handles plan completion
			// when all workspaces are terminal. Do NOT auto-complete here to avoid
			// a race with the plan-runner's while loop. The setTimout-based auto-complete
			// was removed because it raced with the plan-runner calling completePlan()
			// or entering handoff, causing a double transition or stale state.

			return result;
		} catch (error) {
			// Handle failure
			const errorMessage = error instanceof Error ? error.message : String(error);

			// P38.LEAD: Observe workspace failure through Lead Agent
			if (this.leadAgent) {
				try {
					this.leadAgent.observeEvent({
						eventType: "workspace_failed",
						planExecId: planExecutionId,
						workspaceId: workspace.id,
						attemptNo: wsState?.attempts ?? 1,
						errorMessage,
						timestamp: Date.now(),
					});
				} catch {
					// Lead Agent observation failure must not crash
				}
			}

			// P26.B: Clean up workspace-scoped executor on failure
			this.activeAgentExecutors.delete(workspace.id);

			// Release locks on failure
			this.scheduler.releaseFileLocks(workspace);
			await this.stateStore.releaseFileLocks(planExecutionId, workspace.id);

			// Update state with error
			await this.stateStore.updateWorkspaceState(planExecutionId, workspace.id, {
				error: errorMessage,
			});

			// P41.2: Bridge unexpected workspace failure to brain activity timeline
			const phase = this.workspaceQueue?.phase ?? "unknown";
			await this.bridgeToBrainActivity(
				planExecutionId,
				workspace.id,
				"observation",
				"critical",
				`Workspace ${workspace.id} execution error`,
				errorMessage,
				phase,
				"failed",
				{ errorMessage, attemptNo: wsState?.attempts ?? 1 },
			).catch(() => {});

			// Get updated state for retry decision
			const updatedWsState = await this.stateStore.getWorkspaceState(planExecutionId, workspace.id);
			const wsForRetry = updatedWsState ?? wsState;

			// P37.HOTFIX: Stale attempt guard — if workspace was terminalized by a
			// plan stop, skip retry/fail transitions and return cleanly.
			if (this.isStopping || (await this.isAttemptStale(planExecutionId, workspace.id)).stale) {
				new PiLogger({ planExecId: planExecutionId }).info(
					`[workspace ${workspace.id}] stale_attempt_completion_ignored — workspace was terminalized, discarding failure result`,
					{ planExecId: planExecutionId, workspaceId: workspace.id },
				);
				this.activeAgentExecutors.delete(workspace.id);
				this.inFlightAttemptNos.delete(workspace.id);
				await this.stateCacheMutex.runExclusive(async () => {
					const updatedState = await this.stateStore.loadState(planExecutionId);
					if (updatedState) {
						this.currentPlanState = updatedState;
					}
				});
				return {
					workspaceId: workspace.id,
					success: false,
					verdict: "FAILED",
					error: `Stale error ignored: ${errorMessage}`,
					report: `Stale attempt completion was ignored because the workspace was terminalized by plan stop.`,
				};
			}

			// Classify failure and determine if retry is possible
			const failureType = this.retryHandler.classifyFailure(errorMessage);

			// P38.LEAD: Consult Lead Agent before retrying
			let leadReviewResult: ReturnType<LeadAgent["reviewFailure"]> | null = null;
			let leadBlocksRetry = false;
			if (this.leadAgent) {
				try {
					leadReviewResult = this.leadAgent.reviewFailure({
						planExecId: planExecutionId,
						workspaceId: workspace.id,
						errorMessage,
						attemptNo: wsForRetry.attempts,
						completionGateBlockReasons: [],
						commandHistory: [],
						lastCommand: null,
						lastCommandExitCode: null,
					});

					new PiLogger({ planExecId: planExecutionId }).info(
						`[workspace ${workspace.id}] Lead review: ${leadReviewResult.decision} — ${leadReviewResult.summary}`,
						{ planExecId: planExecutionId, workspaceId: workspace.id, leadDecision: leadReviewResult.decision },
					);

					if (
						leadReviewResult.decision === "block_and_escalate_user" ||
						leadReviewResult.decision === "handoff_required"
					) {
						leadBlocksRetry = true;
					}
				} catch (leadError) {
					new PiLogger({ planExecId: planExecutionId }).warn(
						`[workspace ${workspace.id}] Lead Agent review failed, falling back: ${leadError}`,
					);
				}
			}

			// H-P-STATE-2: Controller rejection (transition routing failed) is NOT retryable.
			// The workspace must terminalize immediately instead of staying Pending and
			// causing an infinite schedule loop.
			const isRejectionError =
				errorMessage.includes("rejected transition") ||
				errorMessage.includes("Attempt controller rejected") ||
				errorMessage.includes("invalid input syntax for type uuid") ||
				errorMessage.includes("version_conflict") ||
				errorMessage.includes("Attempt not found");

			let retryDecision: RetryDecision;
			if (isRejectionError || leadBlocksRetry) {
				retryDecision = {
					shouldRetry: false,
					stage: RetryStage.Worker,
					reason: leadBlocksRetry
						? `Lead Agent blocked retry: ${leadReviewResult?.reason ?? "retry budget exhausted"}`
						: "Transition rejection — not retryable",
				};
			} else {
				retryDecision = this.retryHandler.shouldRetry(workspace, wsForRetry, failureType);
			}

			if (retryDecision.shouldRetry) {
				// P37.HOTFIX: Re-check in case the stop flag was set during retry decision
				if (this.isStopping) {
					new PiLogger({ planExecId: planExecutionId }).info(
						`[workspace ${workspace.id}] Retry skipped — plan is stopping`,
						{ planExecId: planExecutionId, workspaceId: workspace.id },
					);
					this.inFlightAttemptNos.delete(workspace.id);
					return {
						workspaceId: workspace.id,
						success: false,
						verdict: "FAILED",
						error: `Retry skipped due to plan stop: ${errorMessage}`,
						report: `Retry cancelled because the plan is stopping.`,
					};
				}

				// Transition back to pending for retry via TransitionRouter
				await this.transitionRouter.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Pending, {
					error: errorMessage,
					retryStage: retryDecision.stage,
				});

				// Update local cache
				this.inFlightAttemptNos.delete(workspace.id);
				await this.stateCacheMutex.runExclusive(async () => {
					const updatedState = await this.stateStore.loadState(planExecutionId);
					if (updatedState) {
						this.currentPlanState = updatedState;
					}
				});

				return {
					workspaceId: workspace.id,
					success: false,
					verdict: "BLOCKED",
					error: errorMessage,
					report: `Retry scheduled: ${retryDecision.reason}`,
				};
			}

			// No more retries - mark as failed via state store directly
			// bypassing TransitionRouter to avoid attempt-controller rejection cascade.
			// The router's attempt FSM may reject Failed->Pending because the workspace
			// never transitioned to Active (controller rejected the Active transition).
			// Writing directly to state store ensures terminal state is persisted.
			await this.stateStore.transitionWorkspace(planExecutionId, workspace.id, WorkspaceStage.Failed, {
				error: errorMessage,
			});

			// P44.04: Use Terminal Verdict Reconciler for final verdict
			const existingHistory = this.attemptHistories.get(workspace.id) ?? [];
			// Record the final failed attempt if not already recorded (it may have been
			// recorded before the retry loop if the error came from a transient failure)
			const lastAttemptNo = wsForRetry.attempts;
			const alreadyRecorded = existingHistory.some((a) => a.attemptNo === lastAttemptNo);
			if (!alreadyRecorded) {
				existingHistory.push({
					attemptNo: lastAttemptNo,
					verdict: "FAILED",
					confidence: "medium",
					reasoning: errorMessage,
					error: errorMessage,
					completedAt: Date.now(),
				});
			}
			this.attemptHistories.set(workspace.id, existingHistory);
			const reconciled = this.terminalReconciler.reconcile(workspace.id, existingHistory);
			new PiLogger({ planExecId: planExecutionId }).info(
				`[workspace ${workspace.id}] P44.04 final reconciliation after retry exhaustion: ${reconciled.finalVerdict} — ${reconciled.summary}`,
			);

			// P44.04: Clear attempt history for terminal workspace
			this.attemptHistories.delete(workspace.id);

			// Update local cache
			this.inFlightAttemptNos.delete(workspace.id);
			await this.stateCacheMutex.runExclusive(async () => {
				const updatedState = await this.stateStore.loadState(planExecutionId);
				if (updatedState) {
					this.currentPlanState = updatedState;
				}
			});

			// NOTE: The plan-runner handles plan failure when all workspaces are terminal.
			// Do NOT auto-fail here to avoid a race with the plan-runner's while loop.

			return {
				workspaceId: workspace.id,
				success: false,
				verdict: reconciled.finalVerdict,
				error: errorMessage,
				report: `Failed after ${reconciled.totalAttempts} attempt(s): ${reconciled.summary}`,
			};
		}
	}

	/**
	 * Check for control requests and handle them
	 *
	 * @returns Control state if a control request is pending, null otherwise
	 */
	/**
	 * P37.HOTFIX: Drain and terminalize active workspaces during stop.
	 *
	 * Unlike the old abortAndResetActiveWorkspaces, this method:
	 * 1. Prevents new scheduling before starting drain (isStopping = true)
	 * 2. Aborts executors and waits for in-flight promises to settle
	 * 3. Applies a hard timeout to the drain
	 * 4. Terminalizes each workspace to Failed (not Pending) with a
	 *    stop-related reason so the attempt FSM can accept the transition
	 * 5. Does NOT reset to Pending — that only happens on continue/rerun
	 *
	 * Returns the list of workspace IDs that were active and have been
	 * terminalized.
	 */
	private async drainAndTerminalizeActiveWorkspaces(
		planExecutionId: string,
		options: { reason?: string } = {},
	): Promise<string[]> {
		const stopReason = options.reason ?? "plan_stop";
		const log = new PiLogger({ planExecId: planExecutionId });

		// P37.HOTFIX: Idempotency guard — serialize stop operations via mutex.
		// If a drain is already in progress, subsequent calls return immediately.
		return this.stopMutex.runExclusive(async () => {
			// Prevent new scheduling during drain
			this.isStopping = true;

			// Collect active workspace IDs from fresh DB/runtime state, not stale cache.
			const state = await this.stateStore.loadState(planExecutionId);
			if (state) {
				this.currentPlanState = state;
			}
			const activeIds: string[] = [];
			if (state) {
				for (const [wsId, ws] of Array.from(state.workspaces)) {
					if (ws.stage === "active") {
						activeIds.push(wsId);
					}
				}
			}

			await this.appendControlPlaneEvent(planExecutionId, "plan_stop_acknowledged", { reason: stopReason });

			if (activeIds.length === 0) {
				log.info(`[drain] No active workspaces to drain`);
				await this.appendControlPlaneEvent(planExecutionId, "plan_stop_drained", { activeWorkspaces: 0 });
				return [];
			}

			log.info(`[drain] Stopping plan — draining ${activeIds.length} active workspace(s): ${activeIds.join(", ")}`);
			await this.appendControlPlaneEvent(planExecutionId, "plan_stop_draining_started", {
				activeWorkspaces: activeIds.length,
				workspaceIds: activeIds,
			});

			// Step 1: Abort all executors (sends abort signal to in-flight LLM calls)
			for (const [workspaceId, executor] of this.activeAgentExecutors) {
				await this.appendControlPlaneEvent(
					planExecutionId,
					"workspace_abort_requested",
					{ reason: stopReason },
					workspaceId,
				);
				executor.abort();
			}
			this.activeAgentExecutors.clear();

			// Step 2: Await in-flight execution promises with hard timeout
			const drainTimeout = this.stopDrainTimeoutMs;
			if (this.inFlightExecutions.size > 0) {
				const promises = Array.from(this.inFlightExecutions.values());
				this.inFlightExecutions.clear();

				const drainTimer = new Promise<"timeout">((resolve) => {
					setTimeout(() => resolve("timeout"), drainTimeout).unref();
				});
				const drainResult = await Promise.race([
					Promise.allSettled(promises).then(() => "settled" as const),
					drainTimer,
				]);

				if (drainResult === "timeout") {
					log.warn(`[drain] In-flight workspaces did not settle within ${drainTimeout}ms — force-killing`);
					await this.appendControlPlaneEvent(planExecutionId, "workspace_inflight_timeout", {
						timeoutMs: drainTimeout,
						workspaceIds: activeIds,
					});
					// Kill process scopes for active workspaces
					killPlanProcesses(planExecutionId, "stop-drain-timeout");
					killTrackedDetachedChildren();
				} else {
					await this.appendControlPlaneEvent(planExecutionId, "workspace_inflight_settled", {
						workspaceIds: activeIds,
					});
				}
			}

			// Step 3: Kill remaining tracked processes
			killPlanProcesses(planExecutionId, "plan-stop");
			killTrackedDetachedChildren();
			await this.appendControlPlaneEvent(planExecutionId, "workspace_processes_killed", {
				reason: "plan-stop",
				workspaceIds: activeIds,
			});

			// Step 4: Terminalize each active workspace to Failed with stop reason.
			// Do NOT reset to Pending — the attempt FSM must see a terminal state
			// so that any stale completion events are rejected.
			for (const wsId of activeIds) {
				try {
					// Try via TransitionRouter (FSM-aware)
					await this.transitionRouter.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Failed, {
						reason: stopReason,
						previousStage: WorkspaceStage.Active,
						note: `Aborted during plan stop (${stopReason})`,
					});
				} catch (transitionError) {
					// If FSM rejects (e.g. attempt already Pending from a stale completion),
					// try direct state store transition as safety net.
					log.warn(
						`[drain] FSM rejected Active->Failed for ${wsId}: ${transitionError instanceof Error ? transitionError.message : String(transitionError)}`,
					);
					try {
						await this.stateStore.transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Failed, {
							reason: stopReason,
							note: `Fallback terminalization after stop`,
						});
					} catch (storeError) {
						log.error(
							`[drain] Failed to terminalize ${wsId}: ${storeError instanceof Error ? storeError.message : String(storeError)}`,
						);
					}
				}

				// Release file locks
				const wsDef = this.workspaceQueue?.workspaces.find((w) => w.id === wsId);
				if (wsDef) {
					this.scheduler.releaseFileLocks(wsDef);
				}
				await this.stateStore.releaseFileLocks(planExecutionId, wsId);
				await this.appendControlPlaneEvent(
					planExecutionId,
					"workspace_locks_released",
					{ reason: stopReason },
					wsId,
				);

				// Release workspace-scoped executor
				this.activeAgentExecutors.delete(wsId);
			}

			// P37.HOTFIX: Clear in-flight attempt tracking after terminalization
			this.inFlightAttemptNos.clear();

			// Reload state cache after terminalization
			const updatedState = await this.stateStore.loadState(planExecutionId);
			if (updatedState) {
				this.currentPlanState = updatedState;
			}

			log.info(`[drain] Terminalized ${activeIds.length} workspace(s)`);
			await this.appendControlPlaneEvent(planExecutionId, "plan_stop_drained", {
				activeWorkspaces: activeIds.length,
				workspaceIds: activeIds,
			});
			return activeIds;
		}); // End of stopMutex.runExclusive
	}

	async drainActiveWorkspacesForStop(reason?: string): Promise<string[]> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return [];
		}
		return this.drainAndTerminalizeActiveWorkspaces(planExecutionId, { reason });
	}

	async checkControlRequest(): Promise<PlanControlState | null> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) return null;

		const control = await this.stateStore.readControlRequest(planExecutionId);
		if (!control) {
			return null;
		}

		const state = this.currentPlanState;
		if (!state) {
			return null;
		}

		// P37.HOTFIX: If already stopping, ignore new control requests (idempotency).
		// This prevents a second stop request from double-terminalizing already
		// terminal workspaces.
		if (this.isStopping && state.status === "stopped") {
			// Already fully stopped — clear and return
			await this.stateStore.clearControlRequest(planExecutionId);
			return null;
		}

		const log = new PiLogger({ planExecId: planExecutionId });

		// Handle control actions
		switch (control.action) {
			case "pause":
				if (state.status === "running") {
					const activeIds: string[] = [];
					for (const [wsId, ws] of Array.from(state.workspaces)) {
						if (ws.stage === "active") {
							activeIds.push(wsId);
						}
					}

					if (activeIds.length === 0) {
						await this.stateStore.pausePlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					} else {
						// P37.HOTFIX: Use drain+terminalize instead of abort+reset to Pending
						await this.drainAndTerminalizeActiveWorkspaces(planExecutionId, {
							reason: "paused-abort",
						});
						await this.stateStore.pausePlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
					}
				}
				break;

			case "stop":
				if (state.status === "running" || state.status === "paused" || state.status === "stopped") {
					log.info(`[control] plan_stop_requested — draining active workspaces`);

					// P40.1D: Route stop through execution-service command boundary
					await handleExecutionCommand(
						{ type: "stop_plan", planExecutionId, reason: control.reason ?? "plan_stop" },
						{
							planControlManager: {
								writeControlRequest: (action, reason) =>
									this.stateStore.writeControlRequest(planExecutionId, action as ControlAction, reason),
							},
						},
					);

					await this.appendControlPlaneEvent(planExecutionId, "plan_stop_requested", {
						reason: control.reason ?? null,
						status: state.status,
					});

					const activeIds: string[] = [];
					for (const [wsId, ws] of Array.from(state.workspaces)) {
						if (ws.stage === "active") {
							activeIds.push(wsId);
						}
					}

					if (activeIds.length === 0) {
						// No active workspaces, stop immediately
						await this.stateStore.stopPlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
						await this.appendControlPlaneEvent(planExecutionId, "plan_stop_acknowledged", {
							reason: control.reason ?? null,
						});
						await this.appendControlPlaneEvent(planExecutionId, "plan_stop_drained", { activeWorkspaces: 0 });
					} else {
						// P37.HOTFIX: Drain active workspaces — terminalize them first,
						// then set plan status to stopped. Do NOT reset to Pending
						// while in-flight execution can still complete.
						log.info(`[control] plan_stop_draining_started — ${activeIds.length} active workspace(s)`);
						const terminalized = await this.drainAndTerminalizeActiveWorkspaces(planExecutionId, {
							reason: control.reason ?? "plan_stop",
						});
						await this.stateStore.stopPlan(planExecutionId, control.reason);
						await this.stateStore.clearControlRequest(planExecutionId);
						log.info(`[control] plan stopped — terminalized ${terminalized.length} workspace(s)`);
					}

					// Clear stopping flag after stop is fully complete
					this.isStopping = false;
				}
				break;

			case "cancel":
				// Cancel is handled immediately by the command itself
				break;

			case "resume":
				// Resume is handled by the resume command
				await this.stateStore.clearControlRequest(planExecutionId);
				break;
		}

		return control;
	}

	/**
	 * Get next eligible workspaces to execute.
	 *
	 * AC1: Uses approved dependency graph (not stale parser output) when
	 * approvedPreviewMetadata has been set. The scheduler uses the approved
	 * batch assignments for dependency resolution.
	 *
	 * AC4: The scheduling decision includes batch IDs for each ready workspace,
	 * logged via the scheduler's diagnostic output.
	 *
	 * @param workspaces - All workspaces
	 * @returns Array of eligible workspaces
	 */

	// ── P41-HOTFIX: Runaway retry loop admission guard ──────────────────
	/**
	 * Create an admission guard that checks whether a workspace is allowed
	 * to be scheduled. Prevents runaway retry loops by rejecting workspaces
	 * that have exceeded retry limits or are in terminal/escalated states.
	 */
	private createAdmissionGuard(): {
		canSchedule(
			workspaceId: string,
			wsState: import("./plan-state.js").WorkspaceState,
			planExecutionId: string,
		): { allowed: boolean; reason?: string };
	} {
		const maxAttemptsPerWorkspace = 5;

		return {
			canSchedule: (_workspaceId: string, wsState: any, _planExecutionId: string) => {
				// Reject if workspace is in a terminal/escalated state
				if (wsState.stage === WorkspaceStage.Blocked || wsState.stage === WorkspaceStage.Complete) {
					return {
						allowed: false,
						reason: `workspace in terminal state: ${wsState.stage}`,
					};
				}

				// Reject if workspace has exceeded max attempts
				if (wsState.attempts > maxAttemptsPerWorkspace) {
					return {
						allowed: false,
						reason: `workspace exceeded max attempts: ${wsState.attempts} > ${maxAttemptsPerWorkspace}`,
					};
				}

				return { allowed: true };
			},
		};
	}

	async getNextWorkspaces(workspaces: Workspace[]): Promise<Workspace[]> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return [];
		}

		const state = this.currentPlanState;
		if (!state) {
			return [];
		}

		// P37.HOTFIX: Check stopping flag before scheduling new work.
		// This prevents the scheduler from starting new workspaces during
		// the draining phase of a stop request.
		if (this.isStopping) {
			return [];
		}

		// Check for control requests before scheduling
		const control = await this.checkControlRequest();
		if (control) {
			// If pause or stop is requested, don't schedule new workspaces
			if (control.action === "pause" || control.action === "stop") {
				return [];
			}
		}

		// Check if plan is paused or stopped
		if (state.status === "paused" || state.status === "stopped" || state.status === "cancelled") {
			return [];
		}

		// P7.G AC1: Initialize preflight status for workspaces that require preflight approval
		// but don't have a status set yet. This ensures the scheduler sees them as "pending"
		// and blocks execution until a human reviews them.
		for (const workspace of workspaces) {
			if (workspace.preflightRequired) {
				const wsState = state.workspaces.get(workspace.id);
				if (wsState && wsState.preflightStatus === undefined) {
					await this.stateStore.updateWorkspaceState(planExecutionId, workspace.id, {
						preflightStatus: "pending",
					});
					// Update in-memory cache
					wsState.preflightStatus = "pending";
				}
			}
		}

		const decision = this.scheduler.getNextWorkspaces(workspaces, state);

		// ── P41-HOTFIX: Scheduler admission guard ─────────────────────────
		// Before admitting any workspace for execution, verify it hasn't
		// exceeded retry limits. Filter out workspaces that are in terminal
		// or escalated states, or that have been retried too many times.
		const admissionGuard = this.createAdmissionGuard();
		const admitted: Workspace[] = [];
		for (const ws of decision.ready) {
			const wsState = state.workspaces.get(ws.id);
			if (wsState) {
				const decision_ = admissionGuard.canSchedule(ws.id, wsState, planExecutionId);
				if (decision_.allowed) {
					admitted.push(ws);
				} else {
					new PiLogger({ planExecId: planExecutionId }).info(
						`Scheduler admission guard rejected ${ws.id}: ${decision_.reason}`,
						{ planExecId: planExecutionId, workspaceId: ws.id, reason: decision_.reason },
					);
				}
			} else {
				admitted.push(ws);
			}
		}

		// AC4: Log planned batch IDs for each scheduled workspace
		if (admitted.length > 0) {
			const log = new PiLogger({ planExecId: planExecutionId });
			for (const ws of admitted) {
				const batchId = decision.readyBatchIds.get(ws.id);
				if (batchId !== undefined) {
					log.info(`Scheduled workspace ${ws.id} in batch ${batchId}`);
				} else {
					log.info(`Scheduled workspace ${ws.id} (no batch assignment)`);
				}
			}
		}

		return admitted;
	}

	/**
	 * Get workspaces that are blocked waiting for preflight approval.
	 * Returns workspaces with preflightRequired that have not been approved yet.
	 *
	 * @param workspaces - All workspace definitions
	 * @returns Array of { workspace, status, rejectionReason } for blocked workspaces
	 */
	getPreflightBlockedWorkspaces(
		workspaces: Workspace[],
	): Array<{ workspace: Workspace; status: string; rejectionReason?: string }> {
		const state = this.currentPlanState;
		if (!state) return [];

		const blocked: Array<{ workspace: Workspace; status: string; rejectionReason?: string }> = [];
		for (const workspace of workspaces) {
			if (workspace.preflightRequired) {
				const wsState = state.workspaces.get(workspace.id);
				const status = wsState?.preflightStatus ?? "not_reviewed";
				if (status !== "approved") {
					blocked.push({
						workspace,
						status,
						rejectionReason: wsState?.preflightRejectionReason,
					});
				}
			}
		}
		return blocked;
	}

	/**
	 * Approve a workspace's preflight requirement, allowing it to be scheduled.
	 *
	 * P7.G AC3: Approval UX never mutates executor state directly —
	 * this writes approval via the state store, which the scheduler
	 * reads passively on its next scheduling round.
	 *
	 * @param workspaceId - Workspace ID to approve
	 */
	async approveWorkspacePreflight(workspaceId: string): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.updateWorkspaceState(planExecutionId, workspaceId, {
			preflightStatus: "approved",
			preflightRejectionReason: undefined,
		});

		// Update in-memory cache
		const state = this.currentPlanState;
		const wsState = state?.workspaces.get(workspaceId);
		if (wsState) {
			wsState.preflightStatus = "approved";
			wsState.preflightRejectionReason = undefined;
		}

		// Log to journal
		await this.stateStore.appendJournal(planExecutionId, {
			type: "workspace_preflight_approved",
			timestamp: Date.now(),
			workspaceId,
		});
	}

	/**
	 * Reject a workspace's preflight requirement, preventing it from being scheduled.
	 *
	 * P7.G AC2: Rejected suggestions are logged with reason where available.
	 * P7.G AC3: Approval UX never mutates executor state directly.
	 *
	 * @param workspaceId - Workspace ID to reject
	 * @param reason - Human-readable reason for rejection (optional)
	 */
	async rejectWorkspacePreflight(workspaceId: string, reason?: string): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.updateWorkspaceState(planExecutionId, workspaceId, {
			preflightStatus: "rejected",
			preflightRejectionReason: reason,
		});

		// Update in-memory cache
		const state = this.currentPlanState;
		const wsState = state?.workspaces.get(workspaceId);
		if (wsState) {
			wsState.preflightStatus = "rejected";
			wsState.preflightRejectionReason = reason;
		}

		// Log to journal (P7.G AC2: rejected suggestions are logged with reason)
		await this.stateStore.appendJournal(planExecutionId, {
			type: "workspace_preflight_rejected",
			timestamp: Date.now(),
			workspaceId,
			data: { reason: reason ?? null },
		});
	}

	/**
	 * Check if execution is complete
	 *
	 * Returns true only when all workspaces have reached a terminal state
	 * through actual execution (Complete or Failed), not just being blocked.
	 * Workspaces in Blocked state without any execution attempts are treated
	 * as incomplete and will cause the execution loop to report the deadlock.
	 *
	 * @returns True if all workspaces are in a legitimate terminal state
	 */
	isExecutionComplete(): boolean {
		const state = this.currentPlanState;
		if (!state) {
			return false;
		}

		for (const ws of Array.from(state.workspaces.values())) {
			if (ws.stage === WorkspaceStage.Pending || ws.stage === WorkspaceStage.Active) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Verify that at least 80% of workspaces reached a terminal state
	 * through actual execution (Complete or Failed with attempt count > 0).
	 * Workspaces in Blocked state without any attempts are considered
	 * never-executed and count against the completion ratio.
	 *
	 * @returns { completed: number, total: number, ratio: number, neverExecuted: string[] }
	 */
	hasVerifiableCompletion(): {
		completed: number;
		total: number;
		ratio: number;
		neverExecuted: string[];
		passed: boolean;
	} {
		const state = this.currentPlanState;
		if (!state) {
			return { completed: 0, total: 0, ratio: 0, neverExecuted: [], passed: false };
		}

		let completedOrFailed = 0;
		const neverExecuted: string[] = [];

		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === WorkspaceStage.Complete) {
				completedOrFailed++;
			} else if (ws.stage === WorkspaceStage.Failed && ws.attempts > 0) {
				// Failed after attempting execution — counted as "executed"
				completedOrFailed++;
			} else if (ws.stage === WorkspaceStage.Failed && ws.attempts === 0) {
				// Failed without ever executing — never ran
				neverExecuted.push(wsId);
			} else if (ws.stage === WorkspaceStage.Blocked) {
				// Blocked without execution — never ran
				neverExecuted.push(wsId);
			}
		}

		const total = state.workspaces.size;
		const ratio = total > 0 ? completedOrFailed / total : 0;

		return {
			completed: completedOrFailed,
			total,
			ratio,
			neverExecuted,
			passed: neverExecuted.length === 0 || ratio >= 0.8,
		};
	}

	/**
	 * Get execution statistics
	 *
	 * @returns Execution statistics
	 */
	getStatistics() {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return null;
		}

		const state = this.currentPlanState;
		if (!state) {
			return null;
		}

		return this.scheduler.getStatistics(state);
	}

	/**
	 * Create workspace snapshot directory structure
	 *
	 * @param workspaceId - Workspace ID
	 * @returns Workspace snapshot
	 */
	private async createWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
		const snapshotDir = path.join(this.workspaceRoot, ".pi", "workspaces", workspaceId);
		const retryDir = path.join(snapshotDir, "retries");

		await fs.mkdir(snapshotDir, { recursive: true });
		await fs.mkdir(retryDir, { recursive: true });

		return {
			workspaceId,
			snapshotDir,
			packetPath: path.join(snapshotDir, "packet.json"),
			reportPath: path.join(snapshotDir, "report.md"),
			retryDir,
		};
	}

	/**
	 * Save packet snapshot
	 *
	 * @param snapshot - Workspace snapshot
	 * @param packet - Hashed packet
	 * @param attempt - Attempt number
	 */
	private async savePacketSnapshot(snapshot: WorkspaceSnapshot, packet: HashedPacket, attempt: number): Promise<void> {
		// Save latest packet
		await fs.writeFile(snapshot.packetPath, JSON.stringify(packet, null, 2), "utf-8");

		// Save retry snapshot if this is a retry
		if (attempt > 0) {
			const retryPath = path.join(snapshot.retryDir, `packet-attempt-${attempt}.json`);
			await fs.writeFile(retryPath, JSON.stringify(packet, null, 2), "utf-8");
		}
	}

	/**
	 * Save workspace report
	 *
	 * @param snapshot - Workspace snapshot
	 * @param report - Report content
	 */
	private async saveReport(snapshot: WorkspaceSnapshot, report: string): Promise<void> {
		await fs.writeFile(snapshot.reportPath, report, "utf-8");
	}

	/**
	 * Load state from store
	 *
	 * @returns True if state was loaded
	 */
	async loadState(): Promise<boolean> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) {
			return false;
		}

		const state = await this.stateStore.loadState(planExecutionId);
		this.currentPlanState = state;
		return state !== null;
	}

	/**
	 * Get current state
	 */
	getState(): PlanState | null {
		return this.currentPlanState;
	}

	/**
	 * Get the underlying state store.
	 */
	getStateStore(): IStateStore {
		return this.stateStore;
	}

	/**
	 * Commit workspace changes to git.
	 *
	 * Stages only files matching the workspace capability manifest (canEdit)
	 * that are actually modified, then creates a commit with the format:
	 * `feat(p{phase}): complete workspace {id} — {title}`
	 *
	 * Skips if autoCommit is globally disabled or if the workspace has
	 * autoCommit set to false.
	 *
	 * Never pushes, never merges.
	 * Commit failures are logged as warnings and do not fail execution.
	 *
	 * @param workspace - Workspace to commit
	 */
	async commitWorkspace(workspace: Workspace): Promise<void> {
		// Check global auto-commit flag
		if (!this.autoCommitEnabled) {
			return;
		}

		// Check per-workspace autoCommit flag
		if (workspace.autoCommit === false) {
			return;
		}

		const state = this.currentPlanState;
		if (!state) {
			return;
		}

		const wsState = state.workspaces.get(workspace.id);
		if (!wsState) {
			return;
		}

		// Only commit if workspace is complete
		if (wsState.stage !== WorkspaceStage.Complete) {
			return;
		}

		try {
			const agentExecutor = this.activeAgentExecutors.get(workspace.id);
			const worktreeRoot = agentExecutor?.getEffectiveWorkspaceRoot() ?? null;
			const commitRoot = worktreeRoot ?? this.workspaceRoot;
			const phase = this.workspaceQueue?.phase ?? "2";
			const commitMsg = `feat(p${phase}): complete workspace ${workspace.id} — ${workspace.title.slice(0, 50)}`;

			let commitResult: { success: boolean; commitHash?: string; reason?: string };

			if (this.scopedCommitEnabled) {
				// Scoped commit: only files matching workspace write set are staged and committed
				const integration = createScopedIntegrationFromWorkspace(commitRoot, workspace.id, workspace);
				commitResult = await integration.createScopedCommit(commitMsg);
			} else {
				// Original auto-commit path: stages files matching canEdit patterns
				const autoCommit = new AutoCommit(commitRoot);
				commitResult = await autoCommit.commit(workspace, wsState, phase);
			}

			if (!commitResult.success) {
				// Log warnings for skip reasons (not errors)
				if (commitResult.reason && !commitResult.reason.includes("failed")) {
					console.warn(`[auto-commit] ${workspace.id}: ${commitResult.reason}`);
				} else if (commitResult.reason) {
					console.warn(`[auto-commit] Warning: ${workspace.id}: ${commitResult.reason}`);
				}
				return;
			}

			console.log(`[auto-commit] Committed workspace ${workspace.id} in ${commitRoot} (${commitResult.commitHash})`);

			if (worktreeRoot && worktreeRoot !== this.workspaceRoot && commitResult.commitHash) {
				try {
					const runner = createGitRunner({
						planExecId: this.planExecutionId ?? "",
						workspaceId: workspace.id,
						leaseId: "",
						cwd: this.workspaceRoot,
					});
					// P49.31: Use diff-tree + apply instead of cherry-pick so the
					// worktree commit can be transplanted even when main has diverged
					// (cherry-pick would fail with merge conflicts).
					const diffResult = await runner.run(
						["diff-tree", "--no-commit-id", "-p", "-r", "-M", "--root", commitResult.commitHash],
						{ cwd: worktreeRoot, timeout: 30_000 },
					);
					if (diffResult.exitCode !== 0 || !diffResult.stdout.trim()) {
						console.log(`[auto-commit] No diff to apply for ${workspace.id}, skipping`);
						return;
					}
					// Write diff to temp file then apply
					const diffFile = path.join(os.tmpdir(), `pi-auto-commit-${workspace.id}-${Date.now()}.diff`);
					await fs.writeFile(diffFile, diffResult.stdout);
					try {
						const applyResult = await runner.writeRepo(["apply", "--index", diffFile], {
							timeout: 60_000,
						});
						if (applyResult.exitCode !== 0) {
							console.warn(`[auto-commit] git apply failed for ${workspace.id}: ${applyResult.stderr}`);
							return;
						}
						const commitResult2 = await runner.writeRepo(["commit", "--no-verify", "-m", commitMsg], {
							timeout: 30_000,
						});
						if (commitResult2.stderr.includes("nothing to commit")) {
							console.log(`[auto-commit] Applied diff was empty for ${workspace.id}`);
						} else {
							console.log(`[auto-commit] Applied ${workspace.id} into main repo`);
						}
					} finally {
						await fs.unlink(diffFile).catch(() => {});
					}
				} catch (applyErr) {
					const errMsg = applyErr instanceof Error ? applyErr.message : String(applyErr);
					if (errMsg.includes("nothing to commit") || errMsg.includes("empty commit")) {
						console.log(`[auto-commit] Apply was empty (changes already in main): ${workspace.id}`);
					} else {
						console.warn(`[auto-commit] Failed to apply ${workspace.id} into main repo: ${errMsg}`);
					}
				}
			}
		} catch (error) {
			// Log warning, don't fail
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.warn(`[auto-commit] Warning: commit failed for workspace ${workspace.id}: ${errorMsg}`);
		}
	}

	/**
	 * Complete plan execution with optional rollup commit.
	 *
	 * If postPlanHandoff is enabled, instead of completing immediately,
	 * the plan enters awaiting_handoff state. The caller should then
	 * call handleHandoffCommit(), handleHandoffKeepEditing(), or handleHandoffDiscard().
	 *
	 * If postPlanHandoff is disabled, marks the plan as complete and,
	 * if autoCommit is enabled, creates a rollup commit via commitPlan().
	 * Rollup commit failures are logged as warnings and do not fail execution.
	 */
	async completePlan(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		// P4.6.1: Check plan completion gate — verify all workspaces are terminal healthy
		if (this.currentPlanState) {
			const planResult = evaluatePlanCompletion(this.currentPlanState.workspaces);
			if (!planResult.canComplete) {
				const errorMsg = `Plan cannot be marked complete: ${planResult.blockReasons.join("; ")}`;
				console.error(`[completion-gate] ${errorMsg}`);
				await this.failPlan(errorMsg);
				return;
			}
		}

		if (this.postPlanHandoffEnabled) {
			// Enter awaiting_handoff state — plan_handoff journal event is emitted inside setAwaitingHandoff
			await this.stateStore.setAwaitingHandoff(planExecutionId, this.workspaceQueue?.title ?? "Plan execution");
			const state = await this.stateStore.loadState(planExecutionId);
			if (state) this.currentPlanState = state;
			return;
		}

		// Skip handoff — complete immediately
		await this.stateStore.completePlan(planExecutionId);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;

		// Auto-commit rollup if enabled
		if (this.autoCommitEnabled) {
			try {
				await this.commitPlan();
			} catch (commitError) {
				// Rollup commit failure logs warning, doesn't fail plan completion
				const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
				console.warn(`[auto-commit] Warning: rollup commit failed: ${commitMsg}`);
			}
		}
	}

	/**
	 * Handle handoff commit: trigger rollup commit and mark plan complete.
	 * Called when user chooses "Commit & finish" in the handoff dialog.
	 */
	async handleHandoffCommit(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		// Rollup commit first
		if (this.autoCommitEnabled) {
			try {
				await this.commitPlan();
			} catch (commitError) {
				const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
				console.warn(`[auto-commit] Warning: rollup commit failed: ${commitMsg}`);
			}
		}

		// Mark plan complete
		await this.stateStore.handoffCommit(planExecutionId);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Handle handoff keep editing: return plan to running status.
	 * Called when user chooses "Keep editing" in the handoff dialog.
	 */
	async handleHandoffKeepEditing(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.handoffKeepEditing(planExecutionId);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Handle handoff discard: revert uncommitted workspace files and fail the plan.
	 * Called when user chooses "Discard" in the handoff dialog.
	 */
	async handleHandoffDiscard(): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");

		await this.stateStore.handoffDiscard(planExecutionId, this.workspaceRoot);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Check if the plan is currently awaiting handoff and if the handoff timeout
	 * has elapsed. If so, auto-commit with a warning log.
	 *
	 * Call this periodically (e.g., during polling) when awaiting_handoff.
	 */
	async checkHandoffTimeout(): Promise<boolean> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) return false;

		const isAwaiting = await this.stateStore.isAwaitingHandoff(planExecutionId);
		if (!isAwaiting) return false;

		const handoffStartedAt = await this.stateStore.getHandoffStartedAt(planExecutionId);
		if (handoffStartedAt === 0) return false;

		const elapsed = Date.now() - handoffStartedAt;
		if (elapsed >= this.handoffTimeoutMs) {
			console.warn(
				`[handoff] Auto-committing plan after ${this.handoffTimeoutMs / 60000} minute timeout (elapsed: ${Math.round(elapsed / 60000)} min)`,
			);

			// Auto-commit: rollup + complete
			if (this.autoCommitEnabled) {
				try {
					await this.commitPlan();
				} catch (commitError) {
					const commitMsg = commitError instanceof Error ? commitError.message : String(commitError);
					console.warn(`[auto-commit] Warning: rollup commit failed: ${commitMsg}`);
				}
			}

			await this.stateStore.handoffCommit(planExecutionId);
			const state = await this.stateStore.loadState(planExecutionId);
			if (state) this.currentPlanState = state;
			return true;
		}

		return false;
	}

	/**
	 * Commit a rollup of all remaining changes from the entire plan.
	 *
	 * Stages all modified files into a single plan-level commit with format:
	 * `feat(p{phase}): complete plan — {title}`
	 *
	 * Skips if autoCommit is globally disabled.
	 * Never pushes, never merges.
	 *
	 * @returns Commit result
	 */
	async commitPlan(): Promise<void> {
		if (!this.autoCommitEnabled) {
			return;
		}

		try {
			const autoCommit = new AutoCommit(this.workspaceRoot);
			const phase = this.workspaceQueue?.phase ?? "2";
			const planTitle = this.workspaceQueue?.title ?? "Plan execution complete";
			const result = await autoCommit.commitPlan(phase, planTitle);

			if (!result.success) {
				if (result.reason && !result.reason.includes("failed")) {
					console.warn(`[auto-commit] Rollup: ${result.reason}`);
				} else if (result.reason) {
					console.warn(`[auto-commit] Warning: rollup commit: ${result.reason}`);
				}
			} else if (result.commitHash) {
				console.log(`[auto-commit] Rollup commit (${result.commitHash})`);
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.warn(`[auto-commit] Warning: rollup commit failed: ${errorMsg}`);
		}
	}

	/**
	 * Fail plan execution
	 *
	 * @param error - Error message
	 */
	async failPlan(error: string): Promise<void> {
		const planExecutionId = this.planExecutionId;
		if (!planExecutionId) throw new Error("No active execution");
		await this.stateStore.failPlan(planExecutionId, error);
		const state = await this.stateStore.loadState(planExecutionId);
		if (state) this.currentPlanState = state;
	}

	/**
	 * Get retry handler
	 *
	 * @returns Retry handler instance
	 */
	getRetryHandler(): RetryHandler {
		return this.retryHandler;
	}

	/**
	 * Get the stored workspace queue (used for recovery).
	 */
	getWorkspaceQueue(): WorkspaceQueue | null {
		return this.workspaceQueue;
	}

	/**
	 * Get the maximum parallel workspaces limit (AC3 verification).
	 *
	 * The scheduler enforces this limit — it will never schedule more than
	 * this many concurrent workspaces.
	 *
	 * @returns Maximum concurrent workers
	 */
	getMaxParallelWorkspaces(): number {
		return this.scheduler.getMaxWorkers();
	}

	/**
	 * Get the underlying workspace scheduler.
	 * Exposed for testing and diagnostic purposes.
	 */
	getScheduler(): WorkspaceScheduler {
		return this.scheduler;
	}

	/**
	 * Get the completion gate registry for direct validation state manipulation.
	 * Used by callers that need to feed log signals or command results into
	 * the completion gate before calling completePlan().
	 */
	getCompletionGate(): CompletionGateRegistry {
		return this.completionGate;
	}

	/**
	 * Save diff artifacts from all active worktrees before stopping.
	 *
	 * Must be called BEFORE stopAllActiveWorkspaces() to capture the state
	 * of the in-flight worktrees before the agent is aborted and worktree
	 * directories become stale.
	 *
	 * P26.B: Iterates all per-workspace executors instead of a singleton.
	 * Each concurrent workspace's worktree diff is preserved.
	 *
	 * @returns Number of worktree artifacts saved.
	 */
	async saveAllWorktreeArtifactsBeforeStop(): Promise<number> {
		let saved = 0;
		for (const executor of this.activeAgentExecutors.values()) {
			if (!executor.isWorktreeModeEnabled) continue;
			const artifact = await executor.saveWorktreeArtifactsBeforeStop();
			if (artifact) saved++;
		}
		return saved;
	}

	/**
	 * Get worktree states for recovery reconciliation from all active executors.
	 * During crash recovery, this helps identify orphaned worktrees that
	 * need cleanup or reconciliation.
	 * @returns Array of worktree states from all active executors
	 */
	getWorktreeStates(): import("../worktree/worktree-types.js").WorktreeState[] {
		return this.activeAgentExecutors.size > 0
			? [] // P26.C: Worktree states are now per-execution; collect via getAllWorktreeStates
			: [];
	}

	/**
	 * Load worktree state from disk during crash recovery.
	 * This reconciles in-memory state with persisted worktree-state.json.
	 * @returns Number of worktrees loaded
	 */
	async loadWorktreeManagerState(): Promise<number> {
		// Load worktree manager state from .pi/worktree-state.json.
		// P26.B: No singleton executor guard — always try to load from disk.
		const { WorktreeManager } = await import("../worktree/worktree-manager.js");
		const manager = new WorktreeManager(this.workspaceRoot);
		await manager.loadState();
		const worktrees = manager.list();
		return worktrees.length;
	}

	/**
	 * Remove stale worktrees for a continued execution while preserving only
	 * workspaces that are already complete. This makes active/failed/blocked
	 * workspaces restart from a clean worktree on manual continue.
	 */
	async cleanupWorktreesExcept(planExecutionId: string, preservedWorkspaceIds: Set<string>): Promise<number> {
		const { WorktreeManager } = await import("../worktree/worktree-manager.js");
		const manager = new WorktreeManager(this.workspaceRoot);
		await manager.loadState();

		let removed = 0;
		for (const worktree of manager.list(planExecutionId)) {
			if (preservedWorkspaceIds.has(worktree.workspaceId)) {
				continue;
			}
			const result = await manager.cleanupQuarantinedWorktree(planExecutionId, worktree.workspaceId);
			if (result.success) {
				removed++;
			}
		}

		await manager.reconcileFromDisk();
		await manager.persistState();
		return removed;
	}

	/**
	 * P4.6.3: Abort all in-flight workspace executions.
	 * Each active WorkspaceAgentExecutor receives an abort signal,
	 * causing the in-flight execute() promise to resolve with FAILED.
	 * Then waits for all promises to settle.
	 *
	 * IMPORTANT: Call saveAllWorktreeArtifactsBeforeStop() BEFORE this
	 * method to preserve in-progress worktree changes.
	 */
	async stopAllActiveWorkspaces(): Promise<void> {
		// P26.B: Abort all per-workspace executors (sends signal to in-flight LLM calls)
		for (const executor of this.activeAgentExecutors.values()) {
			executor.abort();
		}
		// Clear the map after aborting all executors
		this.activeAgentExecutors.clear();

		// P37.HOTFIX: Clear in-flight attempt tracking
		this.inFlightAttemptNos.clear();

		// Wait for all tracked in-flight executions to settle
		if (this.inFlightExecutions.size > 0) {
			const promises = Array.from(this.inFlightExecutions.values());
			this.inFlightExecutions.clear();
			await Promise.allSettled(promises);
		}

		// P37.HOTFIX: Kill only plan-scoped processes, not every tracked process.
		// This prevents killing unrelated processes from other plans.
		if (this.planExecutionId) {
			killPlanProcesses(this.planExecutionId, "plan-stop");
		}
		// Keep global kill as fallback for untracked orphans
		killTrackedDetachedChildren();

		// Clean up git worktrees created during this execution
		try {
			const planExecId = this.planExecutionId;
			if (planExecId) {
				// Import GitRunner lazily to avoid circular deps
				const { createGitRunner } = await import("./git-runner.js");
				const runner = createGitRunner({
					planExecId,
					workspaceId: "",
					leaseId: "",
					cwd: this.workspaceRoot,
				});

				// List worktrees and remove any belonging to this execution
				const listResult = await runner.read(["worktree", "list"], { timeout: 10000 });
				const lines = listResult.stdout.split("\n").filter(Boolean);
				for (const line of lines) {
					const parts = line.trim().split(/\s+/);
					const wtPath = parts[0];
					// Skip the main worktree (repository root)
					if (!wtPath || wtPath === this.workspaceRoot) continue;

					// Check if this worktree belongs to our plan execution
					// Worktree paths are under .pi/worktrees/{planExecId}/
					if (wtPath.includes(planExecId) || wtPath.includes(".pi/worktrees")) {
						try {
							await runner.writeRepo(["worktree", "remove", "--force", wtPath], { timeout: 15000 });
						} catch {
							// If git worktree remove fails, try force with recursive
							try {
								await runner.writeRepo(["worktree", "remove", "--force", wtPath], { timeout: 15000 });
							} catch {
								// Still failed — log but don't block
								console.error(`[autonomous-executor] Failed to remove worktree ${wtPath} during stop`);
							}
						}
					}
				}

				// Prune stale worktree references
				try {
					await runner.writeRepo(["worktree", "prune"], { timeout: 10000 });
				} catch {
					// Non-fatal
				}
			}
		} catch {
			// Worktree cleanup is best-effort during stop/cancel
		}
	}

	// ───────────────────────────────────────────────────────────────────
	// P41.2: Brain Activity Bridge — non-fatal instrumentation
	// ───────────────────────────────────────────────────────────────────

	/**
	 * Bridge a workspace lifecycle event into the brain activity timeline.
	 *
	 * Called after workspace transitions (complete, fail, block). Emits a
	 * BrainTimelineEvent into the InMemoryBrainTimelineStore so the Brain
	 * Activity dashboard can display real runtime events.
	 *
	 * This is non-fatal instrumentation: if bridging fails, execution
	 * continues without error.
	 */
	private async bridgeToBrainActivity(
		planExecutionId: string,
		workspaceId: string,
		eventType: TimelineEventType,
		severity: Severity,
		title: string,
		description: string,
		phase: string,
		status: "started" | "progress" | "completed" | "failed",
		dataOverrides?: Record<string, unknown>,
	): Promise<void> {
		try {
			const store = getBrainStore();
			const traceId = randomUUID();
			const eventData: Record<string, unknown> = {
				// P41.1 identity fields
				runId: planExecutionId,
				workspaceId,
				planExecId: planExecutionId,
				traceId,
				type: eventType,
				phase,
				status,
				title,
				description,
				source: "execution",
				...dataOverrides,
			};

			await store.append({
				id: randomUUID(),
				eventType,
				timestamp: new Date().toISOString(),
				data: eventData,
				workspaceId,
				planExecId: planExecutionId,
				severity,
			});
		} catch {
			// Non-fatal: brain activity instrumentation must never
			// crash or block workspace execution.
		}
	}
}

/**
 * Create an autonomous executor instance with JSON backend.
 *
 * This is a convenience factory that creates a JSON-backed executor,
 * maintaining backward compatibility with existing code.
 *
 * @param workspaceRoot - Workspace root directory
 * @param maxWorkers - Maximum concurrent workers
 * @param retryPolicy - Optional retry policy
 * @returns Autonomous executor
 */
export function createAutonomousExecutor(
	workspaceRoot: string,
	maxWorkers = DEFAULT_WORKERS,
	retryPolicy?: RetryPolicy,
	worktree?: WorktreeConfig,
	configOverrides?: Partial<
		Omit<AutonomousExecutorConfig, "workspaceRoot" | "maxWorkers" | "retryPolicy" | "worktree">
	>,
): AutonomousExecutor {
	// Use createStateStore for centralized backend selection (Finding 4/5)
	const backend = detectStateStoreBackend();
	const stateStore = createStateStore({
		backend,
		workspaceRoot,
		projectId: "default",
	});
	return new AutonomousExecutor(stateStore, {
		workspaceRoot,
		maxWorkers,
		retryPolicy,
		projectId: "default",
		skipProjectManagement: true,
		worktree,
		...configOverrides,
	});
}
