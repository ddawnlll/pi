/**
 * Workspace Agent Executor
 *
 * Executes workspace tasks using real Pi agent sessions.
 * Converts workspace packets into agent prompts and runs them to completion.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai";
import type { AgentSession } from "./agent-session.js";
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

	constructor(config: WorkspaceAgentExecutorConfig) {
		this.workspaceRoot = config.workspaceRoot;
		this.maxTurns = config.maxTurns ?? 50;
		this.logPath = config.logPath;
		this.stateStore = config.stateStore;
		this.planExecutionId = config.planExecutionId;

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
	 * Set the plan execution ID for log persistence context.
	 * Used by AutonomousExecutor to update context after initialization
	 * without needing to recreate the entire executor.
	 */
	setPlanExecutionId(id: string): void {
		this.planExecutionId = id;
	}

	/**
	 * Execute a workspace using the provided packet
	 *
	 * @param packet - Hashed workspace packet
	 * @param workspaceId - Workspace ID for logging
	 * @returns Execution result
	 */
	async execute(packet: HashedPacket, workspaceId: string): Promise<AgentExecutionResult> {
		const logs: string[] = [];
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
			log(`Starting execution for workspace ${workspaceId}`);
			log(`Provider: ${this.model.provider}`);
			log(`Model: ${this.model.id}`);
			log(`Role: ${packet.packet.role}`);
			log(`Goal: ${packet.packet.goal}`);
			log(`Max turns: ${this.maxTurns}`);
			log(`Workspace root: ${this.workspaceRoot}`);

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

			// Create agent session
			log("Creating agent session...");
			const sessionResult: CreateAgentSessionResult = await createAgentSession({
				cwd: this.workspaceRoot,
				model: this.model,
				thinkingLevel: "medium",
				sessionManager,
				settingsManager,
				// Enable all coding tools (using correct tool names)
				tools: ["read", "write", "edit", "bash", "find", "grep", "ls"],
			});

			const { session } = sessionResult;
			log("Agent session created successfully");

			// Log active tools for debugging
			const activeTools = session.getActiveToolNames();
			log(`Active tools: ${activeTools.join(", ")}`);
			log(`Agent has ${session.agent.state.tools.length} tools registered`);

			// Subscribe to agent events to track completion
			let _agentCompleted = false;
			const completionPromise = new Promise<void>((resolve) => {
				const unsubscribe = session.subscribe((event) => {
					if (event.type === "agent_end") {
						_agentCompleted = true;
						unsubscribe();
						resolve();
					}
				});
			});

			// Track tool calls for journal events
			const pendingToolCalls = new Map<string, { toolName: string; args: any }>();
			session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					pendingToolCalls.set(event.toolCallId, {
						toolName: event.toolName,
						args: event.args,
					});
				} else if (event.type === "tool_execution_end") {
					const pending = pendingToolCalls.get(event.toolCallId);
					if (pending && this.stateStore && this.planExecutionId) {
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

						// Emit worker_status transcript event for tool execution
						if (typeof this.stateStore.emitWorkerStatus === "function") {
							this.stateStore
								.emitWorkerStatus(this.planExecutionId, workspaceId, "executing", `Tool: ${pending.toolName}`)
								.catch(() => {});
						}

						pendingToolCalls.delete(event.toolCallId);
					}
				}
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
			const errorMessage = error instanceof Error ? error.message : String(error);
			log(`Execution failed with error: ${errorMessage}`);

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
			prompt += `\n### Allowed to Edit\n${p.allowedFiles.map((f) => `- ${f}`).join("\n")}\n`;
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
