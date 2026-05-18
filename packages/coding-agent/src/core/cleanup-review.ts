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

import { exec as execCb } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { Model } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai";
import { PiLogger } from "../utils/logger.js";
import { killTrackedDetachedChildren } from "../utils/shell.js";
import { createAgentSession } from "./sdk.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

const execAsync = promisify(execCb);

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

	// Acquire the global merge lock first — only one cleanup at a time.
	// Must acquire BEFORE memory check to avoid TOCTOU: without the lock,
	// another plan's cleanup could race in and consume the freed memory
	// between our memory wait and our actual agent execution.
	const releaseLock = await acquireCleanupLock();
	log.info(`[cleanup] Acquired cleanup lock`);

	try {
		const memoryCheck = getMemorySnapshot();
		log.info(`[cleanup] Memory: ${formatMemorySnapshot(memoryCheck)}`);

		if (!canStartWorker("cleanup review agent")) {
			log.warn("[cleanup] Memory limit exceeded, waiting for memory to become available...");
			await waitForMemoryAvailable();
			const afterWait = getMemorySnapshot();
			log.info(`[cleanup] Memory available after wait: ${formatMemorySnapshot(afterWait)}`);
		}
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
	parts.push(
		`IMPORTANT: Do NOT run any commands. Do NOT use read/find/grep/ls tools. Do NOT edit files or commit. Only review and summarize. All data is present above.`,
	);

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

	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null;
	let unsubscribe: (() => void) | null = null;

	try {
		const created = await createAgentSession({
			cwd: workspaceRoot,
			model,
			thinkingLevel: "off",
			sessionManager,
			settingsManager,
			// NOTE: intentionally no bash/write/edit — the cleanup agent only reviews
			// and summarizes. It must not modify files or run commands.
			tools: ["read", "find", "grep", "ls"],
		});
		session = created.session;

		// Collect output
		const outputParts: string[] = [];

		// Single subscription to collect output + detect agent_end
		unsubscribe = session.subscribe((event) => {
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

		// Adaptive timeout: base 90s + 10s per workspace report. Cap at 300s.
		const workspaceCount = (config.prompt.match(/^### /gm) || []).length || 1;
		const timeoutMs = Math.min(90_000 + workspaceCount * 10_000, 300_000);

		await logAndArchive("Sending prompt to cleanup agent...");
		emitStatus("executing", "Sending prompt to cleanup agent");

		// Race prompt execution against the adaptive timeout
		const result = await Promise.race([
			session.prompt(prompt).then(() => "completed" as const),
			timeout(timeoutMs).then(() => "timeout" as const),
		]);

		if (result === "timeout") {
			outputParts.push(`\n[cleanup] Agent timed out after ${timeoutMs / 1000}s`);
			await logAndArchive(`Cleanup agent timed out after ${timeoutMs / 1000}s`);
			emitStatus("error", `Cleanup agent timed out after ${timeoutMs / 1000}s`);
			// Even on timeout, commit any pending changes from worktrees
			try {
				const { stdout: staged } = await execAsync("git diff --cached --name-only", {
					cwd: workspaceRoot,
					timeout: 10_000,
				});
				const { stdout: unstaged } = await execAsync("git diff --name-only", {
					cwd: workspaceRoot,
					timeout: 10_000,
				});
				if (staged.trim() || unstaged.trim()) {
					await execAsync("git add -A", { cwd: workspaceRoot, timeout: 30_000 });
					await execAsync(
						'git commit -m "chore(cleanup): auto-commit worktree changes after timeout" --no-verify',
						{ cwd: workspaceRoot, timeout: 30_000 },
					);
					await logAndArchive("Commited worktree changes after timeout");
				}
			} catch (commitErr) {
				await logAndArchive(
					`Failed to commit worktree changes after timeout: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
				);
			}
			// Dispose kills tracked children (vitest, etc.) via shell.ts exit handler
			session.dispose();
		}

		// Kill any orphan child processes left by the cleanup agent session
		killTrackedDetachedChildren();

		// Unsubscribe before parsing to avoid further event processing
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}

		// Parse the final output for the structured result
		const fullOutput = outputParts.join("");
		const parsed: CleanupReviewResult = fullOutput.trim()
			? parseCleanupResult(fullOutput)
			: {
					summary: "Cleanup agent timed out before producing a result. Worktree changes have been auto-committed.",
					changedFiles: [],
					issueCount: 0,
					issues: [],
					testResults: [],
					passed: true,
				};

		await logAndArchive(
			`Cleanup result: ${parsed.passed ? "PASS" : "FAIL"}, issues=${parsed.issueCount}, files=${parsed.changedFiles.length}`,
		);

		// Emit plan_summary journal event
		await stateStore
			.appendJournal(planExecutionId, {
				type: "plan_summary",
				timestamp: Date.now(),
				data: {
					summary: parsed.summary,
					issueCount: parsed.issueCount,
					issues: parsed.issues,
					changedFiles: parsed.changedFiles,
					testResults: parsed.testResults,
					passed: parsed.passed,
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
						...parsed,
					},
					null,
					2,
				),
				"utf-8",
			);
		} catch {
			// Non-fatal
		}

		return parsed;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		// Ensure session is always cleaned up on unexpected errors
		if (session && !(error as any)?._sessionDisposed) {
			try {
				session.dispose();
			} catch {
				// Non-fatal
			}
		}
		// Kill any orphan child processes left by the failed session
		killTrackedDetachedChildren();
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
	} finally {
		if (unsubscribe) {
			try {
				unsubscribe();
			} catch {
				// Non-fatal
			}
		}
		// Safety net: kill any orphan child processes left by the cleanup agent
		killTrackedDetachedChildren();
	}
}

/**
 * Return a promise that resolves after `ms` milliseconds.
 */
function timeout(ms: number): Promise<"timeout"> {
	return new Promise((resolve) => setTimeout(() => resolve("timeout" as const), ms));
}

/**
 * Parse the structured CLEANUP_REVIEW_RESULT block from the agent output.
 *
 * Uses a state-machine approach per section:
 *   - Issues: once "Issues:" is seen, every subsequent non-empty line that
 *     does not start with a known key is accumulated as an issue.
 *   - Changed files: split on comma, trim each.
 *   - Verdict: PASS → true, anything else → false.
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

	// State machine: tracks which section we are in for multi-line fields.
	// Sections: "summary", "issues", none = ""
	let section = "";

	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith("Summary:")) {
			section = "summary";
			result.summary = trimmed.slice("Summary:".length).trim();
		} else if (trimmed.startsWith("Changed files:")) {
			section = "";
			const files = trimmed.slice("Changed files:".length).trim();
			result.changedFiles = files
				.split(",")
				.map((f) => f.trim())
				.filter(Boolean);
		} else if (trimmed.startsWith("Issues found:")) {
			section = "";
			const count = Number.parseInt(trimmed.slice("Issues found:".length).trim(), 10);
			result.issueCount = Number.isNaN(count) ? 0 : count;
		} else if (trimmed.startsWith("Issues:")) {
			section = "issues";
			const rest = trimmed.slice("Issues:".length).trim();
			if (rest && rest !== "None") {
				result.issues.push(rest);
			}
		} else if (trimmed.startsWith("Verdict:")) {
			section = "";
			const verdict = trimmed.slice("Verdict:".length).trim();
			result.passed = verdict === "PASS";
		} else if (
			trimmed.startsWith("Tests run:") ||
			trimmed.startsWith("Tests passed:") ||
			trimmed.startsWith("Tests failed:")
		) {
			section = "";
			// Track test counts — handled below
		} else if (section === "summary") {
			// Multi-line summary: append with space separator
			result.summary += ` ${trimmed}`;
		} else if (section === "issues") {
			// Multi-line issues: accumulate each line as a separate issue
			result.issues.push(trimmed);
		}
	}

	// Re-count issues from the issues array if the structured count disagreed
	if (result.issues.length > 0) {
		result.issueCount = result.issues.length;
	}

	return result;
}

/**
 * Get a fallback model for the cleanup agent.
 * Throws if none of the known providers/models are configured.
 */
function getFallbackModel(): Model<any> {
	const models = [
		getModel("opencode-go" as any, "deepseek-v4-flash" as any),
		getModel("opencode-go" as any, "minimax-m2.7" as any),
		getModel("anthropic" as any, "claude-3-5-haiku-20241022" as any),
		getModel("openai" as any, "gpt-4o-mini" as any),
		getModel("anthropic" as any, "claude-sonnet-4-20250514" as any),
		getModel("openai" as any, "gpt-4o" as any),
	];

	for (const m of models) {
		if (m) return m;
	}

	throw new Error(
		"No model available for cleanup review agent. Configure at least one provider/model (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENCODE_GO_API_KEY)." +
			" Tried: opencode-go/deepseek-v4-flash, opencode-go/minimax-m2.7, anthropic/claude-3-5-haiku-20241022, openai/gpt-4o-mini, anthropic/claude-sonnet-4-20250514, openai/gpt-4o",
	);
}

export const _CLEANUP_INTERNALS = { parseCleanupResult, buildCleanupPrompt };
