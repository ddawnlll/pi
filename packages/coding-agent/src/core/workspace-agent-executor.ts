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
import type { WorktreeConfig, WorktreeState } from "../worktree/worktree-types.js";
import { WorktreeWorkspaceExecutor } from "../worktree/worktree-workspace-executor.js";
import type { AgentSession, AgentSessionEvent } from "./agent-session.js";
import { createWorkspaceBudgetEnforcer } from "./budget-enforcer.js";
import type { HashedPacket } from "./role-packets.js";
import { type CreateAgentSessionResult, createAgentSession } from "./sdk.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

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
	/** Log file path */
	logPath?: string;
	/** State store for persisting logs */
	stateStore?: import("./state-store.js").IStateStore;
	/** Plan execution ID for log persistence */
	planExecutionId?: string;
	/**
	 * Worktree isolation configuration.
	 * When enabled, each workspace executes inside its own git worktree.
	 * When disabled or absent, falls back to shared-working-tree execution (P5.5).
	 */
	worktree?: WorktreeConfig;
}

/**
 * Workspace Agent Executor
 *
 * Creates and runs agent sessions for workspace execution.
 */
export class WorkspaceAgentExecutor {
	private workspaceRoot: string;
	private model: Model<any>;
	private maxTurns: number;
	private logPath?: string;
	private stateStore?: import("./state-store.js").IStateStore;
	private planExecutionId?: string;
	/** Worktree isolation config, if enabled. */
	private worktreeConfig?: WorktreeConfig;
	/** P6.A: The worktree executor, created when worktree mode is enabled. */
	private worktreeExecutor: WorktreeWorkspaceExecutor | null = null;
	/** P4.6.3: AbortController for the current execution, created per execute() call. */
	private abortController: AbortController | null = null;

	constructor(config: WorkspaceAgentExecutorConfig) {
		this.workspaceRoot = config.workspaceRoot;
		this.maxTurns = config.maxTurns ?? 50;
		this.logPath = config.logPath;
		this.stateStore = config.stateStore;
		this.planExecutionId = config.planExecutionId;
		this.worktreeConfig = config.worktree;

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
	 * Abort the current execution, if one is active.
	 * The in-flight execute() promise will resolve with a FAILED verdict.
	 */
	abort(): void {
		if (this.abortController && !this.abortController.signal.aborted) {
			this.abortController.abort();
		}
	}

	/**
	 * Whether worktree isolation mode is enabled.
	 */
	get isWorktreeModeEnabled(): boolean {
		return this.worktreeConfig?.enabled === true;
	}

	/**
	 * Get the current worktree state, if worktree mode is active.
	 */
	get currentWorktreeState(): WorktreeState | null {
		return this.worktreeExecutor?.currentWorktreeState ?? null;
	}

	/**
	 * Get the worktree path, if worktree mode is active.
	 */
	get worktreePath(): string | null {
		return this.worktreeExecutor?.worktreePath ?? null;
	}

	/**
	 * Get the base commit hash for the worktree, if available.
	 */
	get baseCommit(): string | null {
		return this.worktreeExecutor?.baseCommit ?? null;
	}

	/**
	 * Get the effective workspace root for agent execution.
	 * Returns the worktree path when mode is enabled, or the original root otherwise.
	 */
	getEffectiveWorkspaceRoot(): string {
		return this.worktreeExecutor?.getEffectiveWorkspaceRoot() ?? this.workspaceRoot;
	}

	/**
	 * Set the plan execution ID for log persistence context.
	 * Used by AutonomousExecutor to update context after initialization
	 * without needing to recreate the entire executor.
	 * Also updates the worktree executor if created.
	 */
	setPlanExecutionId(id: string): void {
		this.planExecutionId = id;
		if (this.worktreeExecutor) {
			this.worktreeExecutor.setPlanExecutionId(id);
		}
	}

	/**
	 * Execute a workspace using the provided packet
	 *
	 * When worktree mode is enabled, execution happens inside an isolated git worktree.
	 * Otherwise, falls back to shared-working-tree execution (P5.5).
	 *
	 * @param packet - Hashed workspace packet
	 * @param workspaceId - Workspace ID for logging
	 * @returns Execution result
	 */
	async execute(packet: HashedPacket, workspaceId: string): Promise<AgentExecutionResult> {
		// P6.A: When worktree mode is enabled, delegate to WorktreeWorkspaceExecutor
		if (this.isWorktreeModeEnabled && this.planExecutionId) {
			return this.executeInWorktree(packet, workspaceId);
		}

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
			// P4.6.3: Create per-execution abort controller
			this.abortController = new AbortController();
			const abortSignal = this.abortController.signal;

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

			// Create agent session
			log("Creating agent session...");
			const sessionResult: CreateAgentSessionResult = await createAgentSession({
				cwd: this.workspaceRoot,
				model: this.model,
				thinkingLevel: "medium",
				sessionManager,
				settingsManager,
				tools,
			});

			const { session } = sessionResult;
			log("Agent session created successfully");

			// Log active tools for debugging
			const activeTools = session.getActiveToolNames();
			log(`Active tools: ${activeTools.join(", ")}`);
			log(`Agent has ${session.agent.state.tools.length} tools registered`);

			// Subscribe to agent events for live status tracking and completion
			let _agentCompleted = false;
			const pendingToolCalls = new Map<string, { toolName: string; args: any }>();
			let agentTurnCount = 0;

			// Helper: emit worker_status via state store and log
			const emitStatus = (status: string, message?: string) => {
				log(`Status: ${status}${message ? ` — ${message}` : ""}`);
				if (this.stateStore && this.planExecutionId && typeof this.stateStore.emitWorkerStatus === "function") {
					this.stateStore.emitWorkerStatus(this.planExecutionId, workspaceId, status, message).catch(() => {});
				}
			};

			const completionPromise = new Promise<void>((resolve) => {
				const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
					// --- Agent lifecycle ---
					if (event.type === "agent_start") {
						agentTurnCount = 0;
						emitStatus("thinking", "Agent started");
					} else if (event.type === "agent_end") {
						_agentCompleted = true;
						emitStatus("deciding", "Agent completed");
						unsubscribe();
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
						// Buffer text deltas until newline, then emit complete lines.
						// Each delta is often a single character; logging each one individually
						// would flood the log viewer with one-line-per-character garbage.
						if (
							event.assistantMessageEvent &&
							event.assistantMessageEvent.type === "text_delta" &&
							event.assistantMessageEvent.delta
						) {
							const delta = event.assistantMessageEvent.delta;
							thinkingBuffer += delta;

							// Flush complete lines (split on \n, keep remainder)
							const newlineIdx = thinkingBuffer.lastIndexOf("\n");
							if (newlineIdx >= 0) {
								const completeLines = thinkingBuffer.slice(0, newlineIdx);
								for (const line of completeLines.split("\n")) {
									if (line.length <= 120) {
										log(`[thinking] ${line}`);
									}
								}
								thinkingBuffer = thinkingBuffer.slice(newlineIdx + 1);
							}
						}
					} else if (event.type === "message_end" && event.message.role === "assistant") {
						// Flush remaining thinking buffer
						if (thinkingBuffer) {
							const remainder = thinkingBuffer.trim();
							if (remainder && remainder.length <= 120) {
								log(`[thinking] ${remainder}`);
							}
							thinkingBuffer = "";
						}

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
						});
						emitStatus("executing", `Tool: ${event.toolName}`);
					} else if (event.type === "tool_execution_end") {
						const pending = pendingToolCalls.get(event.toolCallId);
						if (pending) {
							const resultPreview = event.isError
								? `error: ${typeof event.result === "object" && event.result !== null ? JSON.stringify(event.result).slice(0, 100) : String(event.result).slice(0, 100)}`
								: "success";
							emitStatus("deciding", `Tool ${pending.toolName}: ${resultPreview}`);

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
					unsubscribe();
					session.agent.abort();
					resolve();
					return;
				}
				abortSignal.addEventListener(
					"abort",
					() => {
						_agentCompleted = true;
						unsubscribe();
						session.agent.abort();
						resolve();
					},
					{ once: true },
				);
			});

			// Run the agent with the prompt
			log("Starting agent execution...");

			// Emit worker_status: executing
			if (this.stateStore && this.planExecutionId && typeof this.stateStore.emitWorkerStatus === "function") {
				await this.stateStore.emitWorkerStatus(
					this.planExecutionId,
					workspaceId,
					"executing",
					"Agent execution started",
				);
			}

			await session.prompt(prompt);
			log("Agent prompt sent, waiting for completion...");

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
						// Tool calls are in the content array with type "tool_call"
						const toolCalls = m.content.filter((c: any) => c.type === "tool_call");
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
				const content = this.getMessageContent(lastMessage);
				log(`Final assistant message (${content.length} chars): ${content.substring(0, 500)}...`);

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
								.catch(() => {});
						}
						if (typeof this.stateStore.emitWorkerDecisionSummary === "function") {
							await this.stateStore
								.emitWorkerDecisionSummary(
									this.planExecutionId,
									workspaceId,
									`Task failed: ${content.substring(0, 200)}`,
									"FAILED",
								)
								.catch(() => {});
						}
					}
				} else {
					// If no explicit verdict but agent completed without error, assume success
					if (content.toLowerCase().includes("complete") || content.toLowerCase().includes("done")) {
						finalVerdict = "COMPLETE";
						log("Agent appears to have completed successfully");
					} else {
						log("No verdict found in assistant message, defaulting to FAILED");
					}
				}
			} else {
				log(`Last message is not assistant, it's: ${lastMessage?.role || "undefined"}`);
			}

			// Generate report from session
			const report = this.generateReport(session, finalVerdict);
			log(`Execution completed with verdict: ${finalVerdict}`);

			// Write logs to file if path provided
			// P4.6.3: Check if aborted mid-execution
			if (this.abortController?.signal.aborted) {
				log("Execution aborted during finalization");
				if (this.logPath) {
					await fs.writeFile(this.logPath, logs.join("\n"), "utf-8");
				}
				return {
					success: false,
					verdict: "FAILED",
					report: "Execution aborted by user",
					error: "Execution aborted by user",
					logs,
				};
			}

			if (this.logPath) {
				await fs.writeFile(this.logPath, logs.join("\n"), "utf-8");
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
					(this.abortController?.signal.aborted ?? false));
			const errorMessage = isAborted
				? "Execution aborted by user"
				: error instanceof Error
					? error.message
					: String(error);

			log(`Execution ${isAborted ? "aborted" : "failed"}: ${errorMessage}`);

			// Write logs even on error
			if (this.logPath) {
				try {
					await fs.writeFile(this.logPath, logs.join("\n"), "utf-8");
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
			// P4.6.3: Clean up abort controller
			this.abortController = null;
		}
	}

	/**
	 * P6.A: Execute a workspace inside an isolated git worktree.
	 * Creates the worktree, delegates to the WorktreeWorkspaceExecutor,
	 * and maps the result to AgentExecutionResult.
	 */
	private async executeInWorktree(packet: HashedPacket, workspaceId: string): Promise<AgentExecutionResult> {
		const logs: string[] = [];
		const log = (message: string) => {
			const timestamp = new Date().toISOString();
			const logLine = `[${timestamp}] ${message}`;
			logs.push(logLine);
			console.log(`[workspace-agent-executor] ${logLine}`);
		};

		try {
			log(`Worktree mode enabled for workspace ${workspaceId}`);

			// Create or reuse the worktree executor
			if (!this.worktreeExecutor) {
				this.worktreeExecutor = new WorktreeWorkspaceExecutor({
					workspaceRoot: this.workspaceRoot,
					planExecutionId: this.planExecutionId!,
					workspaceId,
					worktree: this.worktreeConfig,
				});
			}

			// Create the worktree
			const createResult = await this.worktreeExecutor.createWorktree();
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

			log(`Worktree ready at: ${createResult.state.worktreePath}`);
			log(`Base commit: ${createResult.state.baseCommit}`);
			log(`Branch: ${createResult.state.branchName}`);

			// Execute using the worktree path as workspace root
			// We create a fresh WorkspaceAgentExecutor scoped to the worktree
			const worktreeExecutor = new WorkspaceAgentExecutor({
				workspaceRoot: createResult.state.worktreePath,
				model: this.model,
				maxTurns: this.maxTurns,
				logPath: this.logPath,
				stateStore: this.stateStore,
				planExecutionId: this.planExecutionId,
				// Worktree mode is disabled for the inner executor to avoid recursion
				worktree: { enabled: false },
			});

			log(`Executing agent in worktree: ${createResult.state.worktreePath}`);
			const result = await worktreeExecutor.execute(packet, workspaceId);

			// Attach worktree state to the result
			return {
				...result,
				logs: [...logs, ...result.logs],
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log(`Worktree execution error: ${errorMessage}`);
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
					.map((c: any) => (c.type === "text" ? c.text : ""))
					.filter(Boolean)
					.join("\n");
			}
		}
		return "";
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
