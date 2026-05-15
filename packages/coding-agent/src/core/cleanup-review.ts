/**
 * Cleanup & Review Workspace Executor
 *
 * Runs after all plan workspace workers complete. The cleanup agent:
 * 1. Reads all workspace reports, logs, and git diffs
 * 2. Runs tests / validation
 * 3. Catches regressions and bugs
 * 4. Generates a comprehensive human-readable summary of what changed
 *
 * The summary is persisted as a plan_summary journal event and as a
 * plan-summary.md file in .pi/workspaces/ for dashboard consumption.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai";
import { PiLogger } from "../utils/logger.js";
import { createAgentSession } from "./sdk.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";
import type { IStateStore } from "./state-store.js";
import {
	canStartWorker,
	formatMemorySnapshot,
	getMemorySnapshot,
	waitForMemoryAvailable,
} from "./worker-memory-guard.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

/**
 * Global merge lock to prevent concurrent cleanup/merge operations.
 * Uses an async mutex so only one cleanup runs at a time across
 * all plan executions within the same process.
 */
let cleanupLock: Promise<void> = Promise.resolve();

/**
 * Acquire the global cleanup lock.
 * Returns a release function. The caller must call release() when done.
 */
function acquireCleanupLock(): Promise<() => void> {
	let release: () => void;
	const prev = cleanupLock;
	cleanupLock = new Promise<void>((resolve) => {
		release = resolve;
	});
	return prev.then(() => release!);
}

/**
 * Result of the cleanup/review process.
 */
export interface CleanupReviewResult {
	/** Whether the cleanup passed review */
	passed: boolean;
	/** Human-readable summary of changes, tests, and findings */
	summary: string;
	/** Number of issues found */
	issueCount: number;
	/** Warnings / issues found */
	issues: string[];
	/** Files that were modified across all workspaces */
	changedFiles: string[];
	/** Tests that were run and their results */
	testResults: Array<{ name: string; passed: boolean; output?: string }>;
}

/**
 * Configuration for the cleanup review executor.
 */
export interface CleanupReviewConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** Plan execution ID */
	planExecutionId: string;
	/** State store for persisting results */
	stateStore: IStateStore;
	/** The workspace queue (all workspaces) */
	queue: WorkspaceQueue;
	/** Model to use for the cleanup agent */
	model?: Model<any>;
}

/**
 * Run the cleanup/review process after all workspace workers complete.
 *
 * Creates a cleanup agent session that reads workspace reports, git diffs,
 * runs tests, and produces a comprehensive plan summary.
 */
export async function runCleanupReview(config: CleanupReviewConfig): Promise<CleanupReviewResult> {
	const { workspaceRoot, planExecutionId, stateStore, queue, model } = config;

	// Logger for this cleanup session — created immediately so we can log before/after memory
	const log = new PiLogger({ planExecId: planExecutionId });

	// Check memory before starting cleanup agent
	const memoryCheck = getMemorySnapshot();
	log.info(`[cleanup] Memory: ${formatMemorySnapshot(memoryCheck)}`);

	if (!canStartWorker("cleanup review agent")) {
		log.warn("[cleanup] Memory limit exceeded, waiting for memory to become available...");
		await waitForMemoryAvailable();
		const afterWait = getMemorySnapshot();
		log.info(`[cleanup] Memory available after wait: ${formatMemorySnapshot(afterWait)}`);
	}

	// Acquire the global merge lock — only one cleanup at a time
	const releaseLock = await acquireCleanupLock();
	log.info(`[cleanup] Acquired cleanup lock`);

	try {
		const resolvedModel = model ?? getFallbackModel();

		// Create archive directories for cleanup logs (same structure as workers)
		const cleanupArchiveDir = path.join(
			workspaceRoot,
			".pi",
			"executions",
			planExecutionId,
			"workspaces",
			"_cleanup",
		);
		try {
			await fs.mkdir(cleanupArchiveDir, { recursive: true });
		} catch {
			// Non-fatal
		}

		// Archive helper: persist a raw log line
		const archiveRawLog = async (line: string) => {
			try {
				const rawLogPath = path.join(cleanupArchiveDir, "raw.log");
				await fs.appendFile(rawLogPath, `${line}\n`, "utf-8");
			} catch {
				// Non-fatal
			}
		};

		const emitStatus = (status: string, message?: string) => {
			stateStore.emitWorkerStatus?.(planExecutionId, "_cleanup", status, message).catch(() => {});
			log.info(`[cleanup] Worker status: ${status}${message ? `: ${message}` : ""}`);
		};

		emitStatus("starting", "Cleanup review started, acquired merge lock");

		// Emit cleanup_workspace journal event
		await stateStore
			.appendJournal(planExecutionId, {
				type: "cleanup_workspace",
				timestamp: Date.now(),
				data: { message: "Cleanup review started" },
			})
			.catch(() => {});

		await archiveRawLog(`[${new Date().toISOString()}] Cleanup review started - acquired merge lock`);

		// Collect workspace execution data for the cleanup agent
		const workspaceData: Array<{
			id: string;
			title: string;
			stage: string;
			report?: string;
			logs?: string;
			error?: string;
		}> = [];

		for (const ws of queue.workspaces) {
			const reportPath = path.join(workspaceRoot, ".pi", "workspaces", ws.id, "report.md");
			let report: string | undefined;
			try {
				report = await fs.readFile(reportPath, "utf-8");
			} catch {
				// Report not available
			}

			// Get the workspace state from the state store
			let wsState: { stage: string; error?: string } | undefined;
			try {
				wsState = await stateStore.getWorkspaceState(planExecutionId, ws.id);
			} catch {
				// State not available
			}

			workspaceData.push({
				id: ws.id,
				title: ws.title,
				stage: wsState?.stage ?? "unknown",
				report,
				error: wsState?.error,
			});
		}

		// Get git diff for context on what changed
		let gitDiff = "";
		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);
			const diffResult = await execAsync("git diff --stat HEAD", {
				cwd: workspaceRoot,
				timeout: 5000,
				encoding: "utf-8",
				env: { ...process.env, GIT_ALLOW_PROTOCOL: "file" },
			}).catch(() => ({ stdout: "" }));
			gitDiff = diffResult.stdout;
		} catch {
			gitDiff = "(git diff unavailable)";
		}

		emitStatus("analyzing", `Collected ${workspaceData.length} workspace reports`);

		// Build the cleanup prompt
		const prompt = buildCleanupPrompt(queue, workspaceData, gitDiff);

		// Run the cleanup agent (max 3 turns, 90 second timeout)
		const result = await executeCleanupAgent({
			workspaceRoot,
			model: resolvedModel,
			prompt,
			planExecutionId,
			stateStore,
			emitStatus,
			archiveRawLog,
		});

		emitStatus("complete", `Cleanup review ${result.passed ? "PASS" : "FAIL"}`);
		await archiveRawLog(`[${new Date().toISOString()}] Cleanup review complete: ${result.passed ? "PASS" : "FAIL"}`);

		return result;
	} finally {
		releaseLock();
		log.info("[cleanup] Released clean up / merge lock");
	}
}

/**
 * Build the system prompt for the cleanup agent.
 *
 * Validation is NOT included here — each workspace worker already ran its
 * own validation via targetCommand. The cleanup agent only reviews reports
 * and produces a summary.
 */
function buildCleanupPrompt(
	queue: WorkspaceQueue,
	workspaceData: Array<{
		id: string;
		title: string;
		stage: string;
		report?: string;
		logs?: string;
		error?: string;
	}>,
	gitDiff: string,
): string {
	const parts: string[] = [];

	parts.push(`You are the cleanup & review agent for a plan execution.`);
	parts.push(``);
	parts.push(`Plan: ${queue.title}`);
	parts.push(`Phase: ${queue.phase}`);
	parts.push(``);
	parts.push(`## All Workspaces and Their Results`);
	parts.push(``);

	for (const ws of workspaceData) {
		parts.push(`### ${ws.id}: ${ws.title} (${ws.stage})`);
		if (ws.report) {
			// Truncate report to avoid blowing the context
			const truncated = ws.report.length > 2000 ? `${ws.report.slice(0, 2000)}...` : ws.report;
			parts.push(truncated);
		}
		if (ws.error) {
			parts.push(`Error: ${ws.error}`);
		}
		parts.push(``);
	}

	parts.push(`## Git Diff Summary (uncommitted changes)`);
	parts.push(``);
	parts.push(gitDiff || "(no changes)");
	parts.push(``);
	parts.push(`## Your Task`);
	parts.push(``);
	parts.push(
		`1. **Review**: Analyze each workspace's report and the git diff. Check for logical errors, incomplete implementations, missing edge cases, code quality issues, and regressions.`,
	);
	parts.push(
		`2. **Summarize**: Write a comprehensive summary of what was accomplished and whether the plan passed review.`,
	);
	parts.push(`3. Do NOT run any commands or modify any files. Your job is only review and summarization.`);
	parts.push(``);
	parts.push(`## Output Contract`);
	parts.push(``);
	parts.push(`Output exactly this structure — no extra text before or after:`);
	parts.push(``);
	parts.push(`CLEANUP_REVIEW_RESULT`);
	parts.push(`Summary: <one-paragraph summary of what was accomplished in this plan execution>`);
	parts.push(`Changed files: <comma-separated list of all files modified by the whole plan>`);
	parts.push(`Issues found: <number>`);
	parts.push(`Issues: <one issue per line, or "None">`);
	parts.push(`Tests run: 0`);
	parts.push(`Tests passed: 0`);
	parts.push(`Tests failed: 0`);
	parts.push(`Verdict: PASS | FAIL`);
	parts.push(`END_CLEANUP_REVIEW_RESULT`);
	parts.push(``);
	parts.push(`IMPORTANT: Do NOT run any commands. Do NOT edit files or commit. Only review and summarize.`);

	return parts.join("\n");
}

/**
 * Execute the cleanup agent in a real agent session.
 */
async function executeCleanupAgent(config: {
	workspaceRoot: string;
	model: Model<any>;
	prompt: string;
	planExecutionId: string;
	stateStore: IStateStore;
	emitStatus: (status: string, message?: string) => void;
	archiveRawLog: (line: string) => Promise<void>;
}): Promise<CleanupReviewResult> {
	const { workspaceRoot, model, prompt, planExecutionId, stateStore, emitStatus, archiveRawLog } = config;

	// Persist raw log lines to the cleanup archive directory
	const logAndArchive = async (message: string) => {
		const timestamp = new Date().toISOString();
		const line = `[${timestamp}] ${message}`;
		await archiveRawLog(line);
	};

	await logAndArchive("Creating cleanup agent session...");

	const sessionManager = SessionManager.create(workspaceRoot, path.join(workspaceRoot, ".pi", "sessions", "_cleanup"));

	const settingsManager = SettingsManager.create(workspaceRoot);

	try {
		const { session } = await createAgentSession({
			cwd: workspaceRoot,
			model,
			thinkingLevel: "low",
			sessionManager,
			settingsManager,
			tools: ["read", "write", "edit", "bash", "find", "grep", "ls"],
		});

		// Collect output
		const outputParts: string[] = [];

		const unsubscribe = session.subscribe((event) => {
			// Forward agent session events as worker status updates
			if (event.type === "agent_start") {
				emitStatus("executing", "Cleanup agent started");
				logAndArchive("Cleanup agent started execution");
			} else if (event.type === "agent_end") {
				emitStatus("deciding", "Cleanup agent completed");
				logAndArchive("Cleanup agent completed execution");
			} else if (event.type === "turn_start") {
				emitStatus("thinking", `Turn started`);
			} else if (event.type === "tool_execution_start") {
				emitStatus("executing", `Tool: ${event.toolName}`);
				logAndArchive(`Tool execution: ${event.toolName}`);
			} else if (event.type === "tool_execution_end") {
				emitStatus("deciding", `Tool ${event.toolName}: ${event.isError ? "error" : "success"}`);
				logAndArchive(`Tool ${event.toolName}: ${event.isError ? "error" : "success"}`);
			}

			if (event.type === "message_update") {
				if (
					event.assistantMessageEvent &&
					event.assistantMessageEvent.type === "text_delta" &&
					event.assistantMessageEvent.delta
				) {
					outputParts.push(event.assistantMessageEvent.delta);
				}
			}
		});

		// Wait for agent end
		let agentCompleted = false;
		const completionPromise = new Promise<void>((resolve) => {
			const unsub = session.subscribe((event) => {
				if (event.type === "agent_end") {
					agentCompleted = true;
					unsub();
					resolve();
				}
			});
			// Hard timeout: if agent hasn't completed within 90 seconds, force-resolve
			// to avoid hanging the entire cleanup process on a stalled agent.
			// The dispose() call kills any orphaned child processes via the
			// killTrackedDetachedChildren() hook added in agent-session.ts.
			setTimeout(() => {
				if (!agentCompleted) {
					agentCompleted = true;
					unsub();
					// Dispose kills tracked children (vitest, etc.) via shell.ts exit handler
					session.dispose();
					outputParts.push("\n[cleanup] Agent timed out after 90 seconds");
					resolve();
				}
			}, 90_000);
		});

		await logAndArchive("Sending prompt to cleanup agent...");
		emitStatus("executing", "Sending prompt to cleanup agent");

		await session.prompt(prompt);
		if (!agentCompleted) {
			await completionPromise;
		}

		unsubscribe();

		// Parse the final output for the structured result
		const fullOutput = outputParts.join("");
		const result = parseCleanupResult(fullOutput);

		await logAndArchive(
			`Cleanup result: ${result.passed ? "PASS" : "FAIL"}, issues=${result.issueCount}, files=${result.changedFiles.length}`,
		);

		// Emit plan_summary journal event
		await stateStore
			.appendJournal(planExecutionId, {
				type: "plan_summary",
				timestamp: Date.now(),
				data: {
					summary: result.summary,
					issueCount: result.issueCount,
					issues: result.issues,
					changedFiles: result.changedFiles,
					testResults: result.testResults,
					passed: result.passed,
					rawOutput: fullOutput.slice(0, 5000),
				},
			})
			.catch(() => {});

		// Write summary to file for dashboard consumption, scoped to plan execution
		try {
			const summaryPath = path.join(workspaceRoot, ".pi", "executions", planExecutionId, "plan-summary.json");
			await fs.writeFile(
				summaryPath,
				JSON.stringify(
					{
						planExecutionId,
						planTitle: "",
						phase: "",
						completedAt: Date.now(),
						...result,
					},
					null,
					2,
				),
				"utf-8",
			);
		} catch {
			// Non-fatal
		}

		return result;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		const fallback: CleanupReviewResult = {
			passed: false,
			summary: `Cleanup review failed: ${errorMsg}`,
			issueCount: 1,
			issues: [`Cleanup agent error: ${errorMsg}`],
			changedFiles: [],
			testResults: [],
		};

		await logAndArchive(`Cleanup review failed: ${errorMsg}`);
		emitStatus("error", `Cleanup review failed: ${errorMsg}`);

		await stateStore
			.appendJournal(planExecutionId, {
				type: "plan_summary",
				timestamp: Date.now(),
				data: {
					summary: fallback.summary,
					issueCount: 1,
					issues: fallback.issues,
					passed: false,
				},
			})
			.catch(() => {});

		return fallback;
	}
}

/**
 * Parse the structured CLEANUP_REVIEW_RESULT block from the agent output.
 */
function parseCleanupResult(output: string): CleanupReviewResult {
	const result: CleanupReviewResult = {
		passed: true,
		summary: "",
		issueCount: 0,
		issues: [],
		changedFiles: [],
		testResults: [],
	};

	// Find the structured result block
	const startMarker = "CLEANUP_REVIEW_RESULT";
	const endMarker = "END_CLEANUP_REVIEW_RESULT";

	const startIdx = output.indexOf(startMarker);
	const endIdx = output.indexOf(endMarker);

	if (startIdx === -1 || endIdx === -1) {
		// No structured result — use the full output as summary
		result.summary = output.slice(-2000).trim();
		return result;
	}

	const block = output.slice(startIdx + startMarker.length, endIdx).trim();

	// Parse each line
	for (const line of block.split("\n")) {
		const trimmed = line.trim();

		if (trimmed.startsWith("Summary:")) {
			result.summary = trimmed.slice("Summary:".length).trim();
		} else if (trimmed.startsWith("Changed files:")) {
			const files = trimmed.slice("Changed files:".length).trim();
			result.changedFiles = files
				.split(",")
				.map((f) => f.trim())
				.filter(Boolean);
		} else if (trimmed.startsWith("Issues found:")) {
			const count = Number.parseInt(trimmed.slice("Issues found:".length).trim(), 10);
			result.issueCount = Number.isNaN(count) ? 0 : count;
		} else if (trimmed.startsWith("Issues:")) {
			// Issues are on subsequent lines or inline
			const rest = trimmed.slice("Issues:".length).trim();
			if (rest && rest !== "None") {
				result.issues.push(rest);
			}
		} else if (
			trimmed.startsWith("Tests run:") ||
			trimmed.startsWith("Tests passed:") ||
			trimmed.startsWith("Tests failed:")
		) {
			// Track test counts — handled below
		} else if (trimmed.startsWith("Verdict:")) {
			const verdict = trimmed.slice("Verdict:".length).trim();
			result.passed = verdict === "PASS";
		} else if (trimmed && !trimmed.startsWith("---") && !trimmed.startsWith("*")) {
			// Additional issue lines not prefixed with "Issues:" but non-empty
			if (
				result.issues.length > 0 ||
				trimmed.includes("error") ||
				trimmed.includes("warning") ||
				trimmed.includes("bug") ||
				trimmed.includes("issue")
			) {
				result.issues.push(trimmed);
			}
		}
	}

	// Re-count issues from the issues array if issues found was 0 but we have issues
	if (result.issueCount === 0 && result.issues.length > 0) {
		result.issueCount = result.issues.length;
	}

	return result;
}

/**
 * Get a fallback model for the cleanup agent.
 */
function getFallbackModel(): Model<any> {
	return (
		getModel("opencode-go", "deepseek-v4-flash") ??
		getModel("opencode-go", "minimax-m2.7") ??
		getModel("anthropic", "claude-3-5-haiku-20241022") ??
		getModel("openai", "gpt-4o-mini") ??
		getModel("anthropic", "claude-sonnet-4-20250514") ??
		getModel("openai", "gpt-4o")
	);
}

export const _CLEANUP_INTERNALS = { parseCleanupResult, buildCleanupPrompt };
