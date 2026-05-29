/**
 * Workspace Agent Executor
 *
 * Executes workspace tasks using real Pi agent sessions.
 * Converts workspace packets into agent prompts and runs them to completion.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai";
import { getAgentDir } from "../config.js";
import type { ActorEventSink } from "../execution-kernel/actor-events.js";
import { ToolAdapter } from "../extensions/tool-adapter.js";
import type { WorktreeConfig, WorktreeDiffArtifact, WorktreeState } from "../worktree/worktree-types.js";
import { WorktreeWorkspaceExecutor } from "../worktree/worktree-workspace-executor.js";
import type { AgentSession, AgentSessionEvent } from "./agent-session.js";
import { createWorkspaceBudgetEnforcer } from "./budget-enforcer.js";
import { createGitRunner } from "./git-runner.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import type { HashedPacket } from "./role-packets.js";
import { type CreateAgentSessionResult, createAgentSession } from "./sdk.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

function parsePositiveTimeoutEnv(name: string, fallbackMs: number): number {
	const raw = process.env[name];
	if (!raw) return fallbackMs;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function formatLiveLogPreview(value: unknown, maxLength = 1200): string {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value, null, 2);
		} catch {
			text = String(value);
		}
	}
	return text.length > maxLength ? `${text.slice(0, maxLength)}… [truncated ${text.length - maxLength} chars]` : text;
}

/**
 * Agent execution result
 */
export interface AgentExecutionResult {
	/** Whether execution succeeded */
	success: boolean;
	/** Verdict from agent */
	verdict: "COMPLETE" | "BLOCKED" | "FAILED";
	/** Agent's final report/output */
	report: string;
	/** Error message if failed */
	error?: string;
	/** Execution logs */
	logs: string[];
}

/**
 * Agent executor configuration
 */
export interface WorkspaceAgentExecutorConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** Model to use for execution */
	model?: Model<any>;
	/** Maximum turns before timeout */
	maxTurns?: number;
	/** State store for persisting logs */
	stateStore?: import("./state-store.js").IStateStore;
	/** Plan execution ID for log persistence */
	planExecutionId?: string;
	/**
	 * Worktree isolation configuration.
	 * Always enabled in P22.C (worktree-only mode).
	 */
	worktree: WorktreeConfig;
	/**
	 * Execution timeout in milliseconds.
	 * If the agent execution takes longer than this, it is aborted.
	 * Defaults to 30 minutes (1800000 ms) when not set.
	 */
	timeoutMs?: number;
	/** Optional actor event sink for event-only migration */
	actorEventSink?: ActorEventSink;
	/**
	 * LLM stream idle timeout in milliseconds.
	 * Defaults to PI_LLM_STREAM_IDLE_TIMEOUT_MS or 60 seconds.
	 */
	llmStreamIdleTimeoutMs?: number;
	/**
	 * First event timeout in milliseconds.
	 * Defaults to PI_FIRST_AGENT_EVENT_TIMEOUT_MS or 30 seconds.
	 */
	firstAgentEventTimeoutMs?: number;
	/**
	 * Optional callback for worktree lifecycle events (instrumentation/diagnostics).
	 * Passed through to WorktreeWorkspaceExecutor when executing in worktree mode.
	 */
	onWorktreeEvent?: (event: { type: string; data?: Record<string, unknown> }) => void;
	/**
	 * P37.RCA: Callback fired when the agent executes a command through the
	 * bash tool. The completion gate uses this to record command history
	 * and determine whether the targetCommand was satisfied.
	 */
	onCommandExecuted?: (event: WorkspaceCommandExecutionEvent) => void;
}

export interface WorkspaceCommandExecutionEvent {
	command: string;
	cwd: string;
	startedAt: number;
	finishedAt: number;
	exitCode: number | null;
	outputSummary?: string;
	outputArtifactPath?: string;
}

/**
 * P26.C: Per-execution context — holds all mutable state for a single
 * workspace execution. Created fresh per execute() call so concurrent
 * workspaces cannot interfere with each other's timers, abort state,
 * or worktree executor.
 */
interface ExecutionContext {
	/** Log path for the current execution */
	logPath?: string;
	/** Attempt number (0-based), used for retry/recovery path uniqueness (P26.F) */
	attemptNo?: number;
	/** Abort controller for the current execution */
	abortController: AbortController;
	/** Execution timeout handle */
	timeoutHandle: ReturnType<typeof setTimeout>;
	/** LLM idle timeout handle */
	llmIdleHandle: ReturnType<typeof setTimeout> | null;
	/** Time waiting for the first agent event after prompt dispatch. */
	firstEventHandle: ReturnType<typeof setTimeout> | null;
	/** Timestamp of last LLM event */
	lastLLMEventTime: number;
	/** Whether any agent event has been observed for this execution. */
	firstAgentEventSeen: boolean;
	/** When session.prompt() dispatch started. */
	promptDispatchStartedAt: number | null;
	/** When session.prompt() resolved. */
	promptDispatchResolvedAt: number | null;
	/** Worktree executor scoped to this execution */
	worktreeExecutor: WorktreeWorkspaceExecutor | null;
}

/**
 * Workspace Agent Executor
 *
 * Creates and runs agent sessions for workspace execution.
 *
 * P26.C: All mutable execution state (abortController, timeoutHandle,
 * llmIdleHandle, lastLLMEventTime, worktreeExecutor, logPath) is held
 * in an ExecutionContext created per execute() call. This prevents
 * concurrent workspaces from interfering with each other's state.
 */
export class WorkspaceAgentExecutor {
	private workspaceRoot: string;
	private model: Model<any>;
	private maxTurns: number;
	private stateStore?: import("./state-store.js").IStateStore;
	private planExecutionId?: string;
	/** Worktree isolation config. Always enabled in P22.C. */
	private worktreeConfig: WorktreeConfig;
	/** Execution timeout in milliseconds. */
	private timeoutMs: number;
	private actorEventSink?: ActorEventSink;
	/**
	 * P26.J: Circuit breaker state for consecutive provider failures.
	 * After threshold consecutive failures, the circuit opens and halts
	 * execution of this workspace to prevent infinite retry loops.
	 */
	private consecutiveProviderFailures = 0;
	private readonly MAX_CONSECUTIVE_PROVIDER_FAILURES = 3;
	private onWorktreeEvent?: (event: { type: string; data?: Record<string, unknown> }) => void;
	private onCommandExecuted?: (event: WorkspaceCommandExecutionEvent) => void;
	/** Last effective workspace root used by a completed execution. */
	private lastEffectiveWorkspaceRoot: string | null = null;

	/**
	 * P26.C: worktree executor is created per-execution inside ExecutionContext.
	 * getAllWorktreeStates now iterates over WorktreeManager directly.
	 */
	async getAllWorktreeStates(): Promise<WorktreeState[]> {
		const { WorktreeManager } = await import("../worktree/worktree-manager.js");
		const manager = new WorktreeManager(this.workspaceRoot);
		await manager.loadState();
		return manager.list();
	}

	/**
	 * LLM streaming idle timeout in milliseconds.
	 */
	private readonly llmStreamIdleTimeoutMs: number;

	/**
	 * Maximum time to wait for the first agent event after prompt dispatch.
	 */
	private readonly firstAgentEventTimeoutMs: number;

	/** P26.C: Current execution context — null when not executing. */
	private currentContext: ExecutionContext | null = null;

	constructor(config: WorkspaceAgentExecutorConfig) {
		this.workspaceRoot = config.workspaceRoot;
		this.maxTurns = config.maxTurns ?? 50;
		this.stateStore = config.stateStore;
		this.planExecutionId = config.planExecutionId;
		this.worktreeConfig = config.worktree;
		this.timeoutMs = config.timeoutMs ?? 30 * 60 * 1000; // 30 minutes
		this.llmStreamIdleTimeoutMs =
			config.llmStreamIdleTimeoutMs ?? parsePositiveTimeoutEnv("PI_LLM_STREAM_IDLE_TIMEOUT_MS", 60 * 1000);
		this.firstAgentEventTimeoutMs =
			config.firstAgentEventTimeoutMs ?? parsePositiveTimeoutEnv("PI_FIRST_AGENT_EVENT_TIMEOUT_MS", 30 * 1000);
		this.actorEventSink = config.actorEventSink;
		this.onWorktreeEvent = config.onWorktreeEvent;
		this.onCommandExecuted = config.onCommandExecuted;

		// Use provided model or try to get from settings, then fall back to available models
		if (config.model) {
			this.model = config.model;
		} else {
			// Try to get default model from settings
			const settingsManager = SettingsManager.create(config.workspaceRoot);
			const defaultProvider = settingsManager.getDefaultProvider();
			const defaultModelId = settingsManager.getDefaultModel();

			if (defaultProvider && defaultModelId) {
				this.model = getModel(defaultProvider as any, defaultModelId) ?? this.getFallbackModel();
			} else {
				this.model = this.getFallbackModel();
			}
		}

		if (!this.model) {
			throw new Error(
				"No model available for workspace execution. Configure a model in settings or provide one in config.",
			);
		}
	}

	private getFallbackModel(): Model<any> {
		return (
			getModel("opencode-go", "deepseek-v4-flash") ??
			getModel("opencode-go", "minimax-m2.7") ??
			getModel("anthropic", "claude-3-5-haiku-20241022") ??
			getModel("openai", "gpt-4o-mini") ??
			getModel("anthropic", "claude-sonnet-4-20250514") ??
			getModel("openai", "gpt-4o") ??
			getModel("anthropic", "claude-3-5-sonnet-20241022")
		);
	}

	/**
	 * P26.C: Set the log path for the current execution context.
	 * Called by the executor owner before each execute() call.
	 * Sets the log path on the active context; no-op if no context.
	 */
	setLogPath(logPath: string): void {
		if (this.currentContext) {
			this.currentContext.logPath = logPath;
		}
	}

	/**
	 * Abort the current execution, if one is active.
	 * The in-flight execute() promise will resolve with a FAILED verdict.
	 * P26.C: Uses currentContext.abortController instead of a class field.
	 */
	abort(): void {
		if (this.currentContext?.abortController && !this.currentContext.abortController.signal.aborted) {
			this.currentContext.abortController.abort();
		}
	}

	/**
	 * Whether worktree isolation mode is enabled.
	 * P22.C: Worktree-only mode — always enabled by default.
	 * The inner worktree executor sets this to false to avoid recursion.
	 */
	get isWorktreeModeEnabled(): boolean {
		return this.worktreeConfig?.enabled === true;
	}

	/**
	 * Get the current worktree state, if worktree mode is active.
	 * P26.C: Reads from currentContext.worktreeExecutor.
	 */
	get currentWorktreeState(): WorktreeState | null {
		return this.currentContext?.worktreeExecutor?.currentWorktreeState ?? null;
	}

	/**
	 * Get the worktree path, if worktree mode is active.
	 * P26.C: Reads from currentContext.worktreeExecutor.
	 */
	get worktreePath(): string | null {
		return this.currentContext?.worktreeExecutor?.worktreePath ?? null;
	}

	/**
	 * Get the base commit hash for the worktree, if available.
	 * P26.C: Reads from currentContext.worktreeExecutor.
	 */
	get baseCommit(): string | null {
		return this.currentContext?.worktreeExecutor?.baseCommit ?? null;
	}

	/**
	 * Get the effective workspace root for agent execution.
	 * Returns the worktree path when mode is enabled, or the original root otherwise.
	 * P26.C: Reads from currentContext.worktreeExecutor.
	 */
	getEffectiveWorkspaceRoot(): string {
		return (
			this.currentContext?.worktreeExecutor?.getEffectiveWorkspaceRoot() ??
			this.lastEffectiveWorkspaceRoot ??
			this.workspaceRoot
		);
	}

	/**
	 * Set the plan execution ID for log persistence context.
	 * Used by AutonomousExecutor to update context after initialization
	 * without needing to recreate the entire executor.
	 * Also updates the current context's worktree executor if present.
	 */
	setPlanExecutionId(id: string): void {
		this.planExecutionId = id;
		if (this.currentContext?.worktreeExecutor) {
			this.currentContext.worktreeExecutor.setPlanExecutionId(id);
		}
	}

	/**
	 * Save artifacts from the active worktree (if any) before stopping.
	 *
	 * Generates a diff artifact for the worktree and quarantines it so the
	 * worktree directory is preserved on disk for review. The diff is saved
	 * outside the worktree directory so it survives cleanup.
	 *
	 * Call this BEFORE abort() when stopping a plan mid-execution to avoid
	 * losing in-progress work.
	 *
	 * P26.C: Reads worktree executor from currentContext.
	 *
	 * @returns The generated diff artifact, or undefined if no worktree was active.
	 */
	async saveWorktreeArtifactsBeforeStop(): Promise<WorktreeDiffArtifact | undefined> {
		const wtExec = this.currentContext?.worktreeExecutor;
		if (!wtExec || !wtExec.currentWorktreeState) {
			return undefined;
		}

		const ws = wtExec.currentWorktreeState;
		const worktreeDir = ws.worktreePath;

		// Check the worktree directory still exists
		try {
			await fs.access(worktreeDir);
		} catch {
			return undefined;
		}

		// Generate diff from base commit to HEAD
		let diffOutput = "";
		try {
			const runner = createGitRunner({
				planExecId: this.planExecutionId ?? "",
				workspaceId: ws.workspaceId,
				leaseId: "",
				cwd: worktreeDir,
			});
			const result = await runner.read(["diff", ws.baseCommit, "HEAD"], { cwd: worktreeDir, timeout: 30_000 });
			diffOutput = result.stdout;
		} catch {
			// Diff failed — still quarantine the worktree so the on-disk state is preserved
		}

		const artifact: WorktreeDiffArtifact = {
			planExecutionId: this.planExecutionId ?? "",
			workspaceId: ws.workspaceId,
			diff: diffOutput,
			generatedAt: Date.now(),
		};

		// Persist diff artifact outside the worktree directory
		if (diffOutput && this.planExecutionId) {
			try {
				const artifactDir = path.join(this.workspaceRoot, ".pi", "executions", this.planExecutionId, "worktrees");
				await fs.mkdir(artifactDir, { recursive: true });
				const diffPath = path.join(artifactDir, `${ws.workspaceId}.patch`);
				await fs.writeFile(diffPath, diffOutput, "utf-8");
				artifact.diffPath = diffPath;
			} catch {
				// Non-fatal
			}
		}

		return artifact;
	}

	/**
	 * Execute a workspace using the provided packet
	 *
	 * P22.C: Worktree-only mode — execution always happens inside an isolated git worktree.
	 * The inner executor (scoped to the worktree path) has worktree disabled to avoid recursion.
	 *
	 * @param packet - Hashed workspace packet
	 * @param workspaceId - Workspace ID for logging
	 * @returns Execution result
	 */
	/**
	 * Execute a workspace using the provided packet
	 *
	 * P22.C: Worktree-only mode — execution always happens inside an isolated git worktree.
	 * The inner executor (scoped to the worktree path) has worktree disabled to avoid recursion.
	 *
	 * P26.C: Creates an ExecutionContext per call, passed to inner methods.
	 * All mutable state (abortController, timeoutHandle, llmIdleHandle,
	 * lastLLMEventTime, worktreeExecutor, logPath) lives in the context.
	 *
	 * @param packet - Hashed workspace packet
	 * @param workspaceId - Workspace ID for logging
	 * @param _options - Options including _skipWorktreeCheck and logPath
	 * @returns Execution result
	 */
	async execute(
		packet: HashedPacket,
		workspaceId: string,
		/**
		 * Options for per-call execution state.
		 *
		 * - `signal`: External AbortSignal (e.g. from ContinuousExecutor) wired to
		 *   the execution's internal abortController so both timeout and external
		 *   abort trigger the same abort path.
		 * - `logPath`: Path for the execution log file (replaces old setLogPath()).
		 * - `attemptNo`: Current attempt number, used for attempt-scoped worktrees.
		 * - `_skipWorktreeCheck`: Internal flag used ONLY by executeInWorktree()
		 *   when creating the inner executor scoped to the worktree path.
		 */
		_options?: {
			_signal?: AbortSignal;
			_skipWorktreeCheck?: boolean;
			logPath?: string;
			attemptNo?: number;
		},
	): Promise<AgentExecutionResult> {
		// P26.C: Create per-execution context
		const abortController = new AbortController();
		const timeoutHandle = setTimeout(() => {
			if (!abortController.signal.aborted) {
				console.log(
					`[workspace-agent-executor] Execution timed out after ${this.timeoutMs}ms, aborting workspace ${workspaceId}`,
				);
				abortController.abort();
			}
		}, this.timeoutMs);
		timeoutHandle.unref();

		// P26.D: Wire external abort signal to the execution's internal controller.
		// When the ContinuousExecutor aborts, both the timeout and the external
		// signal trigger the same abort path, ensuring in-flight workspaces
		// respect pause/stop immediately.
		if (_options?._signal) {
			if (_options._signal.aborted) {
				abortController.abort();
			} else {
				_options._signal.addEventListener(
					"abort",
					() => {
						if (!abortController.signal.aborted) {
							abortController.abort();
						}
					},
					{ once: true },
				);
			}
		}

		const ctx: ExecutionContext = {
			logPath: _options?.logPath,
			attemptNo: _options?.attemptNo,
			abortController,
			timeoutHandle,
			llmIdleHandle: null,
			firstEventHandle: null,
			lastLLMEventTime: 0,
			firstAgentEventSeen: false,
			promptDispatchStartedAt: null,
			promptDispatchResolvedAt: null,
			worktreeExecutor: null,
		};
		this.currentContext = ctx;

		try {
			// ====================================================================
			// P22.C: Worktree-only mode — ALWAYS execute inside an isolated git
			// worktree. Every workspace MUST run inside a worktree to prevent
			// file corruption, dirty tree conflicts, and concurrent edits.
			//
			// The outer executor creates a worktree, then spawns an inner executor
			// scoped to the worktree path. The inner executor has worktree mode
			// enabled (worktree: { enabled: true }) but passes _skipWorktreeCheck
			// to bypass the worktree-creation step — it is ALREADY inside the
			// worktree and runs executeAgentInPlace() directly.
			//
			// Any caller without _skipWorktreeCheck that has worktree mode
			// disabled is BLOCKED with a fatal error. No worktree-less execution
			// is ever allowed.
			// See P22.C and P25 dogfood regression #3.
			// ====================================================================
			const skipWorktree = _options?._skipWorktreeCheck === true;

			if (skipWorktree) {
				// Inner executor: already inside a worktree, run agent directly.
				return await this.executeAgentInPlace(packet, workspaceId, ctx);
			}

			if (!this.isWorktreeModeEnabled) {
				return {
					success: false,
					verdict: "FAILED",
					report: "Worktree-less execution is blocked. All workspaces must run inside an isolated git worktree.",
					error: "Worktree mode disabled — execution not allowed without worktree isolation",
					logs: [
						`[${new Date().toISOString()}] FATAL: Worktree-less execution attempted for workspace ${workspaceId}`,
						`[${new Date().toISOString()}] Worktree mode must be enabled for all workspace execution`,
					],
				};
			}

			if (!this.planExecutionId) {
				throw new Error(
					"Worktree-only mode requires planExecutionId for worktree-based execution. " +
						"All workspace execution must run inside an isolated git worktree.",
				);
			}
			return await this.executeInWorktree(packet, workspaceId, ctx);
		} finally {
			// P26.C: Clear context and timeout on completion
			this.currentContext = null;
			clearTimeout(ctx.timeoutHandle);
			if (ctx.llmIdleHandle) {
				clearTimeout(ctx.llmIdleHandle);
			}
			if (ctx.firstEventHandle) {
				clearTimeout(ctx.firstEventHandle);
			}
		}
	}

	/**
	 * Execute a workspace agent directly in the given workspace root.
	 *
	 * This is the core agent execution logic: creates an agent session,
	 * runs the prompt, monitors events, and determines the final verdict.
	 *
	 * P22.C: This is called by the inner executor (scoped to the worktree path)
	 * with worktree mode disabled to avoid recursion.
	 */
	private async executeAgentInPlace(
		packet: HashedPacket,
		workspaceId: string,
		ctx: ExecutionContext,
	): Promise<AgentExecutionResult> {
		const logs: string[] = [];
		let thinkingBuffer = "";
		const log = async (message: string) => {
			const timestamp = new Date().toISOString();
			const logLine = `[${timestamp}] ${message}`;
			logs.push(logLine);
			console.log(`[workspace-agent-executor] ${logLine}`);

			// Persist to state store if available
			if (this.stateStore && this.planExecutionId) {
				try {
					await this.stateStore.appendWorkspaceLog?.(this.planExecutionId, workspaceId, logLine);
				} catch (error) {
					// Don't fail execution if log persistence fails
					console.error(`[workspace-agent-executor] Failed to persist log:`, error);
				}
			}
		};

		try {
			// P26.C: Use the abort controller from the execution context
			const abortSignal = ctx.abortController.signal;

			log(`Starting execution for workspace ${workspaceId}`);
			log(`Provider: ${this.model.provider}`);
			log(`Model: ${this.model.id}`);
			log(`Role: ${packet.packet.role}`);
			log(`Goal: ${packet.packet.goal}`);
			log(`Max turns: ${this.maxTurns}`);
			log(`Workspace root: ${this.workspaceRoot}`);

			// P9.E: Check budget before execution
			const budgetEnforcer = createWorkspaceBudgetEnforcer();
			try {
				budgetEnforcer.checkBudget(packet.packet);
				log(
					`Budget check passed: ${packet.packet.budget.estimatedInputTokens} tokens <= ${packet.packet.budget.maxInputTokens}`,
				);
			} catch (budgetError) {
				log(`Budget check FAILED: ${budgetError instanceof Error ? budgetError.message : String(budgetError)}`);
				throw budgetError;
			}

			// Build and log budget summary
			const budgetSummary = budgetEnforcer.buildBudgetSummary(packet.packet);
			log(`Budget summary:\n${budgetEnforcer.formatBudgetSummary(budgetSummary)}`);

			// Create session directory for this workspace
			const sessionDir = path.join(this.workspaceRoot, ".pi", "sessions", workspaceId);
			await fs.mkdir(sessionDir, { recursive: true });

			// Create session manager
			const sessionManager = SessionManager.create(this.workspaceRoot, sessionDir);

			// Create settings manager
			const settingsManager = SettingsManager.create(this.workspaceRoot);

			// Build the prompt from the packet
			const prompt = this.buildPromptFromPacket(packet);
			log(`Prompt length: ${prompt.length} characters`);

			// P8.A: Select tools based on role
			// Lead agents get read-only tools (observe only), worker agents get full coding tools
			const isLeadRole = packet.packet.role === "lead";
			const tools = isLeadRole
				? ["read", "grep", "find", "ls"]
				: ["read", "write", "edit", "bash", "find", "grep", "ls"];
			log(`Role ${packet.packet.role} — using ${isLeadRole ? "read-only" : "full"} tools: ${tools.join(", ")}`);

			// 7.D: Load extensions and adapt their tools for sandbox isolation
			log("Loading extension tools...");
			const resourceLoader = new DefaultResourceLoader({
				cwd: this.workspaceRoot,
				agentDir: getAgentDir(),
				settingsManager,
			});
			await resourceLoader.reload();
			const extensionsResult = resourceLoader.getExtensions();
			const toolAdapter = new ToolAdapter({
				extensions: extensionsResult.extensions,
				sandbox: true,
			});
			const { toolDefinitions: customTools, toolNames: extensionToolNames } = toolAdapter.adaptAllTools();
			if (extensionToolNames.length > 0) {
				log(`Loaded ${extensionToolNames.length} extension tools: ${extensionToolNames.join(", ")}`);
			}

			// Create agent session
			log("Creating agent session...");
			const sessionResult: CreateAgentSessionResult = await createAgentSession({
				cwd: this.workspaceRoot,
				model: this.model,
				thinkingLevel: "medium",
				sessionManager,
				settingsManager,
				resourceLoader,
				tools: [...tools, ...extensionToolNames],
				customTools,
			});

			const { session } = sessionResult;
			log("Agent session created successfully");

			// Wire workspace canEdit paths into the self-modification firewall
			// so V5 brain workspaces can modify source code they have explicit
			// permission for.
			if (packet.packet.allowedFiles && packet.packet.allowedFiles.length > 0) {
				session.setFirewallAllowedPaths(packet.packet.allowedFiles);
				log(`Firewall: ${packet.packet.allowedFiles.length} allowed path(s) registered`);
			}

			// Log active tools for debugging
			const activeTools = session.getActiveToolNames();
			log(`Active tools: ${activeTools.join(", ")}`);
			log(`Agent has ${session.agent.state.tools.length} tools registered`);

			// Track last event timestamp for LLM idle timeout
			let _agentCompleted = false;
			const pendingToolCalls = new Map<string, { toolName: string; args: unknown; startedAt: number }>();
			let agentTurnCount = 0;

			// Helper: emit worker_status via state store and log
			const emitStatus = (status: string, message?: string) => {
				log(`Status: ${status}${message ? ` — ${message}` : ""}`);
				if (this.stateStore && this.planExecutionId && typeof this.stateStore.emitWorkerStatus === "function") {
					this.stateStore.emitWorkerStatus(this.planExecutionId, workspaceId, status, message).catch(() => {});
				}
				if (status === "executing") {
					void this.actorEventSink?.emit({
						type: "workspace_running",
						timestamp: Date.now(),
						payload: { workspaceId, message: message ?? "executing" },
					});
				}
			};

			const emitDiagnosticStatus = (status: string, message: string) => {
				emitStatus(status, message);
				void this.actorEventSink?.emit({
					type: "workspace_running",
					timestamp: Date.now(),
					payload: { workspaceId, message: `${status}: ${message}` },
				});
			};

			const clearFirstEventWatchdog = () => {
				if (ctx.firstEventHandle) {
					clearTimeout(ctx.firstEventHandle);
					ctx.firstEventHandle = null;
				}
			};

			const markAgentEventSeen = (eventType: AgentSessionEvent["type"]) => {
				if (!ctx.firstAgentEventSeen) {
					ctx.firstAgentEventSeen = true;
					clearFirstEventWatchdog();
					const latencyMs = ctx.promptDispatchStartedAt ? Date.now() - ctx.promptDispatchStartedAt : 0;
					void log(`First agent event observed: ${eventType}${latencyMs > 0 ? ` after ${latencyMs}ms` : ""}`);
					emitDiagnosticStatus(
						"thinking",
						`First agent event: ${eventType}${latencyMs > 0 ? ` after ${latencyMs}ms` : ""}`,
					);
				}
			};

			const startFirstEventWatchdog = () => {
				clearFirstEventWatchdog();
				ctx.firstEventHandle = setTimeout(() => {
					const elapsed = ctx.promptDispatchStartedAt ? Date.now() - ctx.promptDispatchStartedAt : 0;
					const warnMsg =
						`No agent events received within ${this.firstAgentEventTimeoutMs}ms after prompt dispatch` +
						`${elapsed > 0 ? ` (elapsed ${elapsed}ms)` : ""} for workspace ${workspaceId}`;
					void this.actorEventSink?.emit({
						type: "workspace_running",
						timestamp: Date.now(),
						payload: { workspaceId, message: `stalled_waiting_for_first_event: ${warnMsg}` },
					});
					emitDiagnosticStatus("executing", `stalled_waiting_for_first_event — ${warnMsg}`);
					console.error(`[workspace-agent-executor] ${warnMsg}`);
					if (ctx.logPath && logs.length > 0) {
						fs.writeFile(ctx.logPath, logs.join("\n"), "utf-8").catch(() => {});
					}
					if (!ctx.abortController.signal.aborted) {
						ctx.abortController.abort();
					}
				}, this.firstAgentEventTimeoutMs);
				ctx.firstEventHandle.unref();
			};

			const flushThinkingBuffer = (force = false) => {
				const maxChunkLength = 320;
				let newlineIdx = thinkingBuffer.lastIndexOf("\n");
				while (newlineIdx >= 0) {
					const completeLines = thinkingBuffer.slice(0, newlineIdx);
					for (const line of completeLines.split("\n")) {
						if (line.length > 0) {
							void log(`[assistant] ${line}`);
						}
					}
					thinkingBuffer = thinkingBuffer.slice(newlineIdx + 1);
					newlineIdx = thinkingBuffer.lastIndexOf("\n");
				}

				while (thinkingBuffer.length >= maxChunkLength || (force && thinkingBuffer.length > 0)) {
					const chunk = force ? thinkingBuffer : thinkingBuffer.slice(0, maxChunkLength);
					void log(`[assistant] ${chunk}`);
					thinkingBuffer = force ? "" : thinkingBuffer.slice(maxChunkLength);
				}
			};

			// LLM stream idle watchdog: reset on every agent event
			const resetIdleWatchdog = () => {
				ctx.lastLLMEventTime = Date.now();
				if (ctx.llmIdleHandle) {
					clearTimeout(ctx.llmIdleHandle);
				}
				ctx.llmIdleHandle = setTimeout(() => {
					const elapsed = Date.now() - ctx.lastLLMEventTime;
					void this.actorEventSink?.emit({
						type: "llm_timeout",
						timestamp: Date.now(),
						payload: { workspaceId, idleMs: elapsed, timeoutMs: this.llmStreamIdleTimeoutMs },
					});
					const warnMsg = `LLM stream idle for ${Math.round(elapsed / 1000)}s — aborting workspace ${workspaceId} to trigger retry`;
					emitDiagnosticStatus("executing", `llm_timeout — ${warnMsg}`);
					console.error(`[workspace-agent-executor] ${warnMsg}`);
					if (ctx.logPath && logs.length > 0) {
						fs.writeFile(ctx.logPath, logs.join("\n"), "utf-8").catch(() => {});
					}
					if (ctx.abortController && !ctx.abortController.signal.aborted) {
						ctx.abortController.abort();
					}
				}, this.llmStreamIdleTimeoutMs);
				ctx.llmIdleHandle.unref();
			};

			const completionPromise = new Promise<void>((resolve) => {
				const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
					markAgentEventSeen(event.type);
					// Reset idle watchdog on every agent event (any event = stream is alive)
					resetIdleWatchdog();

					// --- Agent lifecycle ---
					if (event.type === "agent_start") {
						agentTurnCount = 0;
						emitStatus("thinking", "Agent started");
					} else if (event.type === "agent_end") {
						_agentCompleted = true;
						emitStatus("deciding", "Agent completed");
						unsubscribe();
						if (ctx.llmIdleHandle) {
							clearTimeout(ctx.llmIdleHandle);
							ctx.llmIdleHandle = null;
						}
						resolve();
					} else if (event.type === "turn_start") {
						agentTurnCount++;
						emitStatus("thinking", `Turn ${agentTurnCount} started`);
					} else if (event.type === "turn_end") {
						emitStatus("deciding", `Turn ${agentTurnCount} ended`);
					}

					// --- Message events (live thinking stream) ---
					if (event.type === "message_start" && event.message.role === "assistant") {
						emitStatus("thinking", "Assistant message started");
					} else if (event.type === "message_update") {
						// Mirror assistant text deltas into the raw Pi CLI stream. This is
						// intentionally separate from the sanitized transcript: the web UI's
						// Pi CLI tab should show what the agent is actively writing, not only
						// turn/status summaries. Deltas are chunked to avoid one log row per
						// character while still updating during long paragraphs with no newline.
						if (
							event.assistantMessageEvent &&
							event.assistantMessageEvent.type === "text_delta" &&
							event.assistantMessageEvent.delta
						) {
							thinkingBuffer += event.assistantMessageEvent.delta;
							flushThinkingBuffer(false);
						}
					} else if (event.type === "message_end" && event.message.role === "assistant") {
						flushThinkingBuffer(true);

						// Capture cache usage from assistant message for cache hit rate computation
						const assistantMsg = event.message as unknown as AssistantMessage;
						if (assistantMsg.usage) {
							const { cacheRead, cacheWrite, input } = assistantMsg.usage;

							// Persist cache usage to journal for statistics computation
							if (this.stateStore && this.planExecutionId) {
								this.stateStore
									.appendJournal(this.planExecutionId, {
										type: "cache_usage",
										timestamp: Date.now(),
										data: {
											cacheRead,
											cacheWrite,
											input,
										},
									})
									.catch((err: unknown) => {
										console.error("[workspace-agent-executor] Failed to persist cache_usage:", err);
									});
							}
						}

						emitStatus("deciding", "Assistant message completed");
					}

					// --- Tool execution events ---
					if (event.type === "tool_execution_start") {
						pendingToolCalls.set(event.toolCallId, {
							toolName: event.toolName,
							args: event.args,
							startedAt: Date.now(),
						});
						void log(`[tool:start] ${event.toolName} ${formatLiveLogPreview(event.args)}`);
						void this.actorEventSink?.emit({
							type: "tool_event",
							timestamp: Date.now(),
							payload: { workspaceId, phase: "start", toolName: event.toolName },
						});
						emitStatus("executing", `Tool: ${event.toolName}`);
					} else if (event.type === "tool_execution_end") {
						void this.actorEventSink?.emit({
							type: "tool_event",
							timestamp: Date.now(),
							payload: { workspaceId, phase: "end", toolCallId: event.toolCallId, isError: event.isError },
						});
						const pending = pendingToolCalls.get(event.toolCallId);
						if (pending) {
							const resultPreview = event.isError
								? `error: ${formatLiveLogPreview(event.result, 1200)}`
								: "success";
							void log(`[tool:end] ${pending.toolName} ${resultPreview}`);
							emitStatus("deciding", `Tool ${pending.toolName}: ${resultPreview.slice(0, 120)}`);

							// P37.RCA: Record bash commands for completion gate validation.
							// When a bash command completes, notify the completion gate so
							// the workspace can pass its targetCommand check on the next
							// completion evaluation.
							if (pending.toolName === "bash") {
								const args = pending.args as { command?: unknown };
								if (typeof args.command === "string") {
									const result = event.result as
										| {
												content?: Array<{ text?: string }>;
												details?: { fullOutputPath?: string; exitCode?: number | null };
										  }
										| string
										| undefined;
									const resultText =
										typeof result === "string"
											? result
											: (result?.content?.map((part) => part.text ?? "").join("\n") ?? "");
									const exitMatch = resultText.match(/Command exited with code (\d+)/);
									const parsedExitCode = event.isError
										? exitMatch
											? Number(exitMatch[1])
											: 1
										: typeof result === "object" && result?.details?.exitCode !== undefined
											? result.details.exitCode
											: 0;
									this.onCommandExecuted?.({
										command: args.command,
										cwd: this.workspaceRoot,
										startedAt: pending.startedAt,
										finishedAt: Date.now(),
										exitCode: parsedExitCode,
										outputSummary: resultText.slice(-2000),
										outputArtifactPath:
											typeof result === "object" ? result?.details?.fullOutputPath : undefined,
									});
								}
							}

							// Persist tool call to journal
							if (this.stateStore && this.planExecutionId) {
								const input =
									typeof pending.args === "object" && pending.args !== null
										? (pending.args as Record<string, unknown>)
										: { value: String(pending.args) };
								this.stateStore
									.appendJournalEvent(this.planExecutionId, pending.toolName, input, {
										isError: event.isError,
										errorMessage: event.isError ? JSON.stringify(event.result) : undefined,
										result: event.isError ? undefined : event.result,
									})
									.catch((err: unknown) => {
										console.error("[workspace-agent-executor] Failed to emit tool_call journal event:", err);
									});
							}

							pendingToolCalls.delete(event.toolCallId);
						}
					}

					// --- Compaction / retry events ---
					if (event.type === "compaction_start") {
						emitStatus("compacting", `Reason: ${event.reason}`);
					} else if (event.type === "compaction_end") {
						emitStatus("deciding", `Compaction ${event.aborted ? "aborted" : "complete"}`);
					} else if (event.type === "thinking_level_changed") {
						emitStatus("thinking", `Level changed to: ${event.level}`);
					} else if (event.type === "auto_retry_start") {
						emitStatus("thinking", `Auto-retry attempt ${event.attempt}/${event.maxAttempts}`);
					} else if (event.type === "auto_retry_end") {
						emitStatus("deciding", `Auto-retry ${event.success ? "succeeded" : "failed"}`);
					}
				});

				// P4.6.3: If abort signal fires before agent completes, abort the agent session
				if (abortSignal.aborted) {
					_agentCompleted = true;
					clearFirstEventWatchdog();
					unsubscribe();
					session.agent.abort();
					resolve();
					return;
				}
				abortSignal.addEventListener(
					"abort",
					() => {
						_agentCompleted = true;
						clearFirstEventWatchdog();
						unsubscribe();
						session.agent.abort();
						if (ctx.llmIdleHandle) {
							clearTimeout(ctx.llmIdleHandle);
							ctx.llmIdleHandle = null;
						}
						resolve();
					},
					{ once: true },
				);
			});

			// Start the idle watchdog (will fire on first event)
			resetIdleWatchdog();

			// Run the agent with the prompt
			log("Starting agent execution...");
			ctx.promptDispatchStartedAt = Date.now();
			startFirstEventWatchdog();
			await this.actorEventSink?.emit({
				type: "workspace_started",
				timestamp: Date.now(),
				payload: { workspaceId },
			});

			// Emit worker_status: executing (fire-and-forget — don't block prompt on DB)
			if (this.stateStore && this.planExecutionId && typeof this.stateStore.emitWorkerStatus === "function") {
				this.stateStore
					.emitWorkerStatus(this.planExecutionId, workspaceId, "executing", "Agent execution started")
					.catch(() => {});
			}

			let removePromptAbortListener = (): void => {};
			const promptAbortPromise = new Promise<never>((_, reject) => {
				const onAbort = () => reject(new Error("Execution aborted during provider stream"));
				abortSignal.addEventListener("abort", onAbort, { once: true });
				removePromptAbortListener = () => abortSignal.removeEventListener("abort", onAbort);
			});
			let promptError: unknown;
			const promptPromise = session.prompt(prompt).catch((error: unknown) => {
				promptError = error;
				if (!_agentCompleted) {
					throw error;
				}
				log(
					`Agent prompt settled after agent_end with error: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
			try {
				await Promise.race([promptPromise, promptAbortPromise, completionPromise]);
				if (promptError && !_agentCompleted) {
					throw promptError;
				}
			} finally {
				removePromptAbortListener();
			}
			ctx.promptDispatchResolvedAt = Date.now();
			log(
				`Agent prompt unblocked after ${ctx.promptDispatchStartedAt ? ctx.promptDispatchResolvedAt - ctx.promptDispatchStartedAt : 0}ms, waiting for completion...`,
			);

			// Wait for agent to fully complete (all turns, tool calls, and final response)
			await completionPromise;
			log("Agent execution finished");

			// P8.A: For lead agents, emit observation log instead of mutation-related operations
			if (isLeadRole) {
				log("Lead agent execution completed — read-only mode, no mutations performed");
				if (this.stateStore && this.planExecutionId) {
					const agentMessages = session.messages.filter((m) => m.role === "assistant");
					const toolCallsCount = agentMessages.reduce(
						(count, m) => count + m.content.filter((c: any) => c.type === "tool_call").length,
						0,
					);
					this.stateStore
						.appendJournal(this.planExecutionId, {
							type: "lead_observation",
							timestamp: Date.now(),
							data: {
								workspaceId,
								role: "lead",
								readOnly: true,
								toolCalls: toolCallsCount,
								messageCount: session.messages.length,
								mutationsBlocked: true,
							},
						})
						.catch((err: unknown) => {
							console.error("[workspace-agent-executor] Failed to persist lead_observation:", err);
						});
				}
			}

			// Get the final messages and determine verdict
			const messages = session.messages;
			log(`Total messages in session: ${messages.length}`);

			// Log all message types for debugging
			const messageSummary = messages
				.map((m, i) => {
					if (m.role === "assistant") {
						const toolCalls = m.content.filter((c) => c.type === "toolCall");
						return `${i}: assistant (${toolCalls.length} tool calls)`;
					}
					return `${i}: ${m.role}`;
				})
				.join(", ");
			log(`Message roles: ${messageSummary}`);

			// Count tool-related messages
			const toolResultCount = messages.filter((m) => m.role === "toolResult").length;
			log(`Tool results in session: ${toolResultCount}`);

			const lastMessage = messages[messages.length - 1];
			let finalVerdict: "COMPLETE" | "BLOCKED" | "FAILED" = "FAILED";

			if (lastMessage?.role === "assistant") {
				const assistantMessage = lastMessage as AssistantMessage;
				const content = this.getMessageContent(lastMessage);
				log(`Final assistant message (${content.length} chars): ${content.substring(0, 500)}...`);
				log(`Final assistant diagnostics: ${this.getAssistantDiagnostics(assistantMessage)}`);

				if (this.isEmptyProviderResponse(lastMessage)) {
					throw new Error(
						`Transient provider failure: assistant stream completed with no final text and no tool call (${this.getAssistantDiagnostics(assistantMessage)})`,
					);
				}

				// Check for verdict in the response
				if (content.includes("VERDICT: COMPLETE")) {
					finalVerdict = "COMPLETE";
					log("Agent reported COMPLETE");

					// Emit validation passed and decision summary
					if (this.stateStore && this.planExecutionId) {
						if (typeof this.stateStore.emitValidation === "function") {
							await this.stateStore
								.emitValidation(this.planExecutionId, workspaceId, "All acceptance criteria met", true)
								.catch(() => {});
						}
						if (typeof this.stateStore.emitWorkerDecisionSummary === "function") {
							await this.stateStore
								.emitWorkerDecisionSummary(
									this.planExecutionId,
									workspaceId,
									"Task completed successfully",
									"COMPLETE",
								)
								.catch(() => {});
						}
					}
				} else if (content.includes("VERDICT: BLOCKED")) {
					finalVerdict = "BLOCKED";
					log("Agent reported BLOCKED");

					// Emit blocker event
					if (this.stateStore && this.planExecutionId) {
						if (typeof this.stateStore.emitBlocker === "function") {
							// Extract blocker reason from content after VERDICT: BLOCKED
							const blockerMatch = content.match(/VERDICT:\s*BLOCKED[^\n]*\n([^\n]*)/);
							const blockerReason = blockerMatch ? blockerMatch[1].trim() : "Agent reported blocked";
							await this.stateStore
								.emitBlocker(this.planExecutionId, workspaceId, blockerReason)
								.catch(() => {});
						}
						if (typeof this.stateStore.emitWorkerDecisionSummary === "function") {
							await this.stateStore
								.emitWorkerDecisionSummary(
									this.planExecutionId,
									workspaceId,
									`Task blocked: ${content.substring(0, 200)}`,
									"BLOCKED",
								)
								.catch(() => {});
						}
					}
				} else if (content.includes("VERDICT: FAILED")) {
					finalVerdict = "FAILED";
					log("Agent reported FAILED");

					// Emit validation failed and decision summary
					if (this.stateStore && this.planExecutionId) {
						if (typeof this.stateStore.emitValidation === "function") {
							await this.stateStore
								.emitValidation(
									this.planExecutionId,
									workspaceId,
									"Task failed",
									false,
									content.substring(0, 200),
								)
								.catch((err) => {
									console.error(`[workspace-agent-executor] Failed to emit validation:`, err);
								});
						}
						if (typeof this.stateStore.emitWorkerDecisionSummary === "function") {
							await this.stateStore
								.emitWorkerDecisionSummary(
									this.planExecutionId,
									workspaceId,
									`Task failed: ${content.substring(0, 200)}`,
									"FAILED",
								)
								.catch((err) => {
									console.error(`[workspace-agent-executor] Failed to emit worker decision summary:`, err);
								});
						}
					}
				} else {
					// If no explicit verdict but agent completed without error, assume success
					if (content.toLowerCase().includes("complete") || content.toLowerCase().includes("done")) {
						finalVerdict = "COMPLETE";
						log("Agent appears to have completed successfully");
					} else {
						// Capture the last assistant message content as the failure reason
						const snippet = content.length > 200 ? `${content.substring(0, 200)}...` : content;
						log(`No verdict found in assistant message, defaulting to FAILED. Last output: ${snippet}`);
					}
				}
			} else {
				log(`Last message is not assistant, it's: ${lastMessage?.role || "undefined"}`);
			}

			// Generate report from session
			const report = this.generateReport(session, finalVerdict);
			log(`Execution completed with verdict: ${finalVerdict}`);
			log(
				`Execution diagnostics: firstAgentEventSeen=${ctx.firstAgentEventSeen}, promptDispatchStartedAt=${ctx.promptDispatchStartedAt ?? "n/a"}, promptDispatchResolvedAt=${ctx.promptDispatchResolvedAt ?? "n/a"}, lastLLMEventTime=${ctx.lastLLMEventTime || "n/a"}`,
			);

			// Flush buffered output to disk before returning, even on abort.
			// This ensures partial work artifacts are not lost on cancellation.
			if (ctx.logPath) {
				await fs.writeFile(ctx.logPath, logs.join("\n"), "utf-8");
			}

			// P4.6.3: Check if aborted mid-execution
			if (ctx.abortController.signal.aborted) {
				const abortReason = !ctx.firstAgentEventSeen
					? "Execution aborted while waiting for first agent event"
					: ctx.promptDispatchResolvedAt === null
						? "Execution aborted while prompt dispatch was still in progress"
						: "Execution aborted during finalization";
				log(abortReason);
				return {
					success: false,
					verdict: "FAILED",
					report: abortReason,
					error: abortReason,
					logs,
				};
			}

			// P26.J: Reset circuit breaker on successful execution
			if (finalVerdict === "COMPLETE" && this.consecutiveProviderFailures > 0) {
				this.consecutiveProviderFailures = 0;
				log("Circuit breaker reset — workspace completed successfully");
			}

			return {
				success: finalVerdict === "COMPLETE",
				verdict: finalVerdict,
				report,
				logs,
			};
		} catch (error) {
			// P4.6.3: Check if this was an abort-caused error
			const isAborted =
				error instanceof Error &&
				(error.message === "aborted" ||
					error.message.includes("abort") ||
					(ctx.abortController.signal.aborted ?? false));
			const abortPhase = !ctx.firstAgentEventSeen
				? "before_first_agent_event"
				: ctx.promptDispatchResolvedAt === null
					? "during_prompt_dispatch"
					: "after_prompt_dispatch";
			const errorMessage = isAborted
				? `Execution aborted (${abortPhase})`
				: error instanceof Error
					? error.message
					: String(error);

			log(`Execution ${isAborted ? "aborted" : "failed"}: ${errorMessage}`);
			log(
				`Failure diagnostics: firstAgentEventSeen=${ctx.firstAgentEventSeen}, promptDispatchStartedAt=${ctx.promptDispatchStartedAt ?? "n/a"}, promptDispatchResolvedAt=${ctx.promptDispatchResolvedAt ?? "n/a"}, lastLLMEventTime=${ctx.lastLLMEventTime || "n/a"}`,
			);

			// P26.J: Increment circuit breaker on execution failure (not abort)
			if (!isAborted) {
				this.consecutiveProviderFailures++;
				log(
					`Circuit breaker: ${this.consecutiveProviderFailures}/${this.MAX_CONSECUTIVE_PROVIDER_FAILURES} consecutive failures`,
				);
			}

			// Write logs even on error
			if (ctx.logPath) {
				try {
					await fs.writeFile(ctx.logPath, logs.join("\n"), "utf-8");
				} catch (writeError) {
					console.error("Failed to write error logs:", writeError);
				}
			}

			return {
				success: false,
				verdict: "FAILED",
				report: `Execution failed: ${errorMessage}`,
				error: errorMessage,
				logs,
			};
		} finally {
			// execute() handles timeout and abortController cleanup in its own finally.
		}
	}

	/**
	 * P6.A: Execute a workspace inside an isolated git worktree.
	 * Creates the worktree, delegates to the WorktreeWorkspaceExecutor,
	 * and maps the result to AgentExecutionResult.
	 *
	 * P22.C: Worktree-only mode — this is the primary execution path for all workspaces.
	 */
	private async executeInWorktree(
		packet: HashedPacket,
		workspaceId: string,
		ctx: ExecutionContext,
	): Promise<AgentExecutionResult> {
		const logs: string[] = [];
		const log = (message: string) => {
			const timestamp = new Date().toISOString();
			const logLine = `[${timestamp}] ${message}`;
			logs.push(logLine);
			console.log(`[workspace-agent-executor] ${logLine}`);
		};
		const emitWorktreeStatus = (message: string): void => {
			if (this.stateStore && this.planExecutionId && typeof this.stateStore.emitWorkerStatus === "function") {
				this.stateStore.emitWorkerStatus(this.planExecutionId, workspaceId, "executing", message).catch(() => {});
			}
		};

		// Listen for abort signal from the execution context and abort the worktree executor
		const abortWorktree = () => {
			if (ctx.worktreeExecutor) {
				log("Abort signal received, aborting worktree creation...");
				ctx.worktreeExecutor.abort();
			}
		};
		ctx.abortController.signal.addEventListener("abort", abortWorktree, { once: true });

		try {
			log(`Worktree mode enabled for workspace ${workspaceId}`);
			emitWorktreeStatus("Creating isolated worktree");

			// P26.C: Create the worktree executor in the execution context
			// P26.F: Pass attemptNo for attempt-scoped worktree paths and branch names
			ctx.worktreeExecutor = new WorktreeWorkspaceExecutor({
				workspaceRoot: this.workspaceRoot,
				planExecutionId: this.planExecutionId!,
				workspaceId,
				attemptNo: ctx.attemptNo,
				worktree: this.worktreeConfig,
				onWorktreeEvent: this.onWorktreeEvent,
			});

			// Create the worktree
			const createResult = await ctx.worktreeExecutor.createWorktree();
			if (createResult.error) {
				log(`Failed to create worktree: ${createResult.error}`);
				return {
					success: false,
					verdict: "FAILED",
					report: `Worktree creation failed: ${createResult.error}`,
					error: createResult.error,
					logs,
				};
			}

			this.lastEffectiveWorkspaceRoot = createResult.state.worktreePath;
			log(`Worktree ready at: ${createResult.state.worktreePath}`);
			emitWorktreeStatus(`Worktree ready: ${createResult.state.worktreePath}`);
			log(`Base commit: ${createResult.state.baseCommit}`);
			log(`Branch: ${createResult.state.branchName}`);

			// Execute using the worktree path as workspace root
			// We create a fresh WorkspaceAgentExecutor scoped to the worktree.
			// Worktree mode is enabled (so the security check passes) but the
			// inner executor's execute() will skip worktree creation because
			// this executor does NOT have a planExecutionId — it runs directly.
			// Actually no — inner executor MUST NOT create another worktree.
			// We pass worktree: { enabled: true } but the execute() method's
			// security check for isWorktreeModeEnabled passes. However, inside
			// executeInWorktree() (which runs because isWorktreeModeEnabled is true),
			// we would try to create ANOTHER worktree. To prevent infinite recursion,
			// we set a flag on the executor that tells executeInWorktree to skip
			// worktree creation and just run the agent directly.
			// Actually the simplest fix: give the inner executor worktree: { enabled: true }
			// but it won't call executeInWorktree because planExecutionId is set.
			// Wait — execute() checks isWorktreeModeEnabled first, if true it goes to
			// executeInWorktree which tries to create another worktree. That's wrong.
			//
			// BEST approach: give the inner executor a flag that tells execute()
			// to skip the worktree check entirely. We name it _skipWorktreeCheck.
			// The inner executor runs executeAgentInPlace() directly.
			const innerModel = this.model;
			if (!innerModel) {
				log(`FATAL: No model available for inner executor (workspace ${workspaceId})`);
				return {
					success: false,
					verdict: "FAILED",
					report: "No model available for inner executor",
					error: "Model is undefined — cannot execute workspace in worktree",
					logs,
				};
			}
			const innerExecutor = new WorkspaceAgentExecutor({
				workspaceRoot: createResult.state.worktreePath,
				model: innerModel,
				maxTurns: this.maxTurns,
				stateStore: this.stateStore,
				planExecutionId: this.planExecutionId,
				timeoutMs: this.timeoutMs,
				onCommandExecuted: this.onCommandExecuted,
				// Worktree mode enabled. The executor will enter execute(),
				// but _skipWorktreeCheck will make it bypass the worktree check
				// and go directly to executeAgentInPlace().
				worktree: { enabled: true },
			});

			log(`Executing agent in worktree: ${createResult.state.worktreePath}`);

			// Race the inner executor against a 10-minute timeout.
			const INNER_TIMEOUT_MS = 10 * 60 * 1000;
			const result = await Promise.race([
				innerExecutor.execute(packet, workspaceId, { _skipWorktreeCheck: true, logPath: ctx.logPath }),
				new Promise<AgentExecutionResult>((_, reject) =>
					setTimeout(
						() => reject(new Error(`Inner executor timed out after ${INNER_TIMEOUT_MS / 60000} min`)),
						INNER_TIMEOUT_MS,
					).unref(),
				),
			]);

			// Do NOT remove the worktree after execution — the agent's changes are in it.
			// The plan-runner or a separate cleanup pass handles worktree cleanup.
			log(`Worktree preserved at: ${createResult.state.worktreePath}`);

			// Attach worktree state to the result
			return {
				...result,
				logs: [...logs, ...result.logs],
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log(`Worktree execution error: ${errorMessage}`);

			// Preserve worktree on error too — the agent's partial work may be salvageable.
			log(`Worktree preserved (worktree execution had error)`);

			return {
				success: false,
				verdict: "FAILED",
				report: `Worktree execution failed: ${errorMessage}`,
				error: errorMessage,
				logs,
			};
		}
	}

	/**
	 * Get content from a message
	 */
	private getMessageContent(message: AgentMessage): string {
		if (message.role === "assistant" || message.role === "user") {
			const content = message.content;
			if (typeof content === "string") {
				return content;
			}
			if (Array.isArray(content)) {
				return content
					.map((c) => (c.type === "text" ? c.text : ""))
					.filter(Boolean)
					.join("\n");
			}
		}
		return "";
	}

	private getAssistantDiagnostics(message: AssistantMessage): string {
		const blockTypes = message.content.map((c) => c.type).join(",") || "none";
		const toolCalls = message.content.filter((c) => c.type === "toolCall").length;
		const thinkingChars = message.content.reduce(
			(total, c) => total + (c.type === "thinking" ? c.thinking.length : 0),
			0,
		);
		return `stopReason=${message.stopReason}, contentBlocks=${message.content.length}, blockTypes=${blockTypes}, toolCalls=${toolCalls}, thinkingChars=${thinkingChars}`;
	}

	private isEmptyProviderResponse(lastMessage: AgentMessage | undefined): boolean {
		if (!lastMessage || lastMessage.role !== "assistant") {
			return false;
		}

		const content = this.getMessageContent(lastMessage).trim();
		const assistantMessage = lastMessage as AssistantMessage;
		const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall").length;
		return content.length === 0 && toolCalls === 0;
	}

	/**
	 * Build a prompt from a workspace packet
	 *
	 * @param packet - Hashed workspace packet
	 * @returns Prompt string
	 */
	private buildPromptFromPacket(packet: HashedPacket): string {
		const p = packet.packet;
		const isLeadRole = p.role === "lead";

		let prompt = `# Workspace Execution Task

You are a ${p.role} agent executing a specific workspace task.

## Workspace: ${p.workspaceId}

## Goal
${p.goal}

## Acceptance Criteria
${p.acceptanceCriteria.map((ac, i) => `${i + 1}. ${typeof ac === "string" ? ac : ac.description}`).join("\n")}

## File Permissions
`;

		if (p.allowedFiles.length > 0) {
			prompt += `\n### Allowed to Observe\n${p.allowedFiles.map((f) => `- ${f}`).join("\n")}\n`;
		}

		if (p.forbiddenFiles.length > 0) {
			prompt += `\n### Forbidden to Edit\n${p.forbiddenFiles.map((f) => `- ${f}`).join("\n")}\n`;
		}

		if (p.stateSummary) {
			prompt += `\n## Prior State\n${p.stateSummary}\n`;
		}

		if (p.targetCommand) {
			prompt += `\n## Target Command\nAfter implementation, run: \`${p.targetCommand}\`\n`;
		}

		if (p.relevantSnippets && p.relevantSnippets.length > 0) {
			prompt += `\n## Relevant Code Snippets\n`;
			for (const snippet of p.relevantSnippets) {
				prompt += `\n### ${snippet.file}\n\`\`\`\n${snippet.content}\n\`\`\`\n`;
			}
		}

		// P8.A: Generate role-specific instructions
		if (isLeadRole) {
			prompt += `\n## Output Contract
${p.outputContract}

## Instructions (Read-Only Mode)
1. Read and understand the goal and acceptance criteria
2. Observe the codebase by CALLING THE TOOLS directly — use read, grep, find, and ls to explore the source
3. You are in READ-ONLY mode. You CANNOT:
   - Create, modify, or delete files
   - Execute shell commands
   - Run tests or build commands
   - Make git commits or changes
   - Modify the plan queue or execution state
4. Focus on analysis, understanding, and reporting your findings
5. After completing your observation, respond with EXACTLY one of these verdicts:
   - VERDICT: COMPLETE (if all acceptance criteria are met)
   - VERDICT: BLOCKED (if you cannot proceed due to missing dependencies)
   - VERDICT: FAILED (if you encountered unresolvable errors)

CRITICAL: You have only read-only tools available. Any attempt to write, edit, or execute commands will be blocked.

Begin observation now.`;
		} else {
			prompt += `\n## Output Contract
${p.outputContract}

## Instructions
1. Read and understand the goal and acceptance criteria
2. Implement the required changes by CALLING THE TOOLS directly - do NOT just describe what you would do
   - Use write_to_file to create or modify files
   - Use execute_command to run shell commands
   - Use read_file to read existing files
   - Do NOT use markdown code blocks - actually call the tools
3. Test your implementation${p.targetCommand ? ` using execute_command: ${p.targetCommand}` : ""}
4. After completing the work, respond with EXACTLY one of these verdicts:
   - VERDICT: COMPLETE (if all acceptance criteria are met)
   - VERDICT: BLOCKED (if you cannot proceed due to missing dependencies)
   - VERDICT: FAILED (if you encountered unresolvable errors)

CRITICAL: You must CALL the tools, not describe them. Your response should invoke tool calls, wait for results, then provide the verdict.

Begin implementation now.`;
		}

		return prompt;
	}

	/**
	 * Generate a report from the agent session
	 *
	 * @param session - Agent session
	 * @param verdict - Final verdict
	 * @returns Report string
	 */
	private generateReport(session: AgentSession, verdict: string): string {
		const messages = session.messages;
		const assistantMessages = messages.filter((m) => m.role === "assistant");

		let report = `# Workspace Execution Report

## Verdict: ${verdict}

## Execution Summary
- Total messages: ${messages.length}
- Assistant messages: ${assistantMessages.length}

## Agent Output

`;

		// Include last few assistant messages
		const lastMessages = assistantMessages.slice(-3);
		for (const msg of lastMessages) {
			const content = this.getMessageContent(msg);
			report += `${content}\n\n---\n\n`;
		}

		return report;
	}
}

/**
 * Create a workspace agent executor
 *
 * @param config - Executor configuration
 * @returns Workspace agent executor
 */
export function createWorkspaceAgentExecutor(config: WorkspaceAgentExecutorConfig): WorkspaceAgentExecutor {
	return new WorkspaceAgentExecutor(config);
}
