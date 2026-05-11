/**
 * Plan Watch Dashboard - P2 Workstream 7.M + P2.2 Slice 1
 *
 * Observer-only dashboard for monitoring plan execution.
 * Read-only, never pauses execution, never mutates state.
 *
 * P2.2 Slice 1: Adds keyboard navigation (1/2/3, tab, j/k, f, r, q)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { matchesKey, parseKey, StdinBuffer } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { PlanState } from "../core/plan-state.js";
import { WorkspaceStage } from "../core/workspace-schema.js";

/**
 * Watch options
 */
export interface WatchOptions {
	/** Working directory (default: process.cwd()) */
	cwd?: string;
	/** Refresh interval in milliseconds (default: 500) */
	refreshMs?: number;
	/** Exit after N seconds (for testing) */
	exitAfter?: number;
}

/**
 * Journal event for display
 */
interface JournalEvent {
	type: string;
	timestamp: number;
	workspaceId?: string;
	data?: Record<string, unknown>;
}

/**
 * Dashboard state
 */
interface DashboardState {
	plan: PlanState | null;
	recentEvents: JournalEvent[];
	lastUpdate: number;
}

/**
 * Watcher UI state (P2.2 Slice 1)
 */
interface WatcherState {
	selectedWorkerIndex: number; // 0-based index into active workers array
	focusedPanel: "workers" | "events";
	eventScrollOffset: number;
	failedRetryOnly: boolean;
	shouldExit: boolean;
}

/**
 * Watch command - observer-only dashboard with keyboard navigation
 *
 * Displays:
 * - Phase and title
 * - Active workers and their current workspaces (with selection marker)
 * - Stage counts
 * - Retry counts
 * - Queue counts
 * - Recent events from journal (with filtering and scrolling)
 *
 * Keyboard shortcuts:
 * - 1/2/3: Select worker 1/2/3
 * - tab: Cycle focused panel
 * - j/k or arrows: Scroll event log
 * - f: Toggle failed/retry filter
 * - r: Force refresh
 * - q: Exit watch
 *
 * @param options - Watch options
 */
export async function planWatch(options: WatchOptions = {}): Promise<void> {
	const { cwd = process.cwd(), refreshMs = 500, exitAfter } = options;

	const stateFile = path.join(cwd, ".pi", "plan-state.json");
	const journalFile = path.join(cwd, ".pi", "execution-journal.ndjson");

	let running = true;
	const _startTime = Date.now();

	// Watcher UI state
	const watcherState: WatcherState = {
		selectedWorkerIndex: 0,
		focusedPanel: "workers",
		eventScrollOffset: 0,
		failedRetryOnly: false,
		shouldExit: false,
	};

	// Handle exit
	if (exitAfter) {
		setTimeout(() => {
			running = false;
		}, exitAfter * 1000);
	}

	// Set up keyboard input handling
	const stdinBuffer = new StdinBuffer();
	let stdinSetup = false;

	try {
		// Set stdin to raw mode for keyboard input
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
			process.stdin.resume();
			stdinSetup = true;

			// Handle keyboard input
			stdinBuffer.on("data", (data: string) => {
				handleKeyPress(data, watcherState);
			});

			process.stdin.on("data", (chunk: Buffer) => {
				stdinBuffer.process(chunk.toString());
			});
		}
	} catch (_error) {
		// Fallback to non-interactive mode if stdin setup fails
		stdinSetup = false;
	}

	// Handle Ctrl+C
	process.on("SIGINT", () => {
		running = false;
	});

	// Clear screen and hide cursor
	process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");

	try {
		while (running && !watcherState.shouldExit) {
			const state = await loadDashboardState(stateFile, journalFile);
			renderDashboard(state, watcherState, stdinSetup);

			// Wait for next refresh
			await new Promise((resolve) => setTimeout(resolve, refreshMs));

			// Check if execution is complete
			if (state.plan && state.plan.status !== "running") {
				running = false;
			}
		}
	} finally {
		// Restore stdin
		if (stdinSetup && process.stdin.isTTY) {
			process.stdin.setRawMode(false);
			process.stdin.pause();
		}

		// Show cursor
		process.stdout.write("\x1b[?25h");
		console.log("\n");
	}
}

/**
 * Handle keyboard input
 *
 * @param data - Key data
 * @param state - Watcher state
 */
function handleKeyPress(data: string, state: WatcherState): void {
	const _key = parseKey(data);

	// Worker selection: 1/2/3
	if (matchesKey(data, "1")) {
		state.selectedWorkerIndex = 0;
		state.focusedPanel = "workers";
	} else if (matchesKey(data, "2")) {
		state.selectedWorkerIndex = 1;
		state.focusedPanel = "workers";
	} else if (matchesKey(data, "3")) {
		state.selectedWorkerIndex = 2;
		state.focusedPanel = "workers";
	}
	// Panel cycling: tab
	else if (matchesKey(data, "tab")) {
		state.focusedPanel = state.focusedPanel === "workers" ? "events" : "workers";
	}
	// Event log scrolling: j/k or arrows
	else if (matchesKey(data, "j") || matchesKey(data, "down")) {
		state.eventScrollOffset = Math.max(0, state.eventScrollOffset + 1);
		state.focusedPanel = "events";
	} else if (matchesKey(data, "k") || matchesKey(data, "up")) {
		state.eventScrollOffset = Math.max(0, state.eventScrollOffset - 1);
		state.focusedPanel = "events";
	}
	// Filter toggle: f
	else if (matchesKey(data, "f")) {
		state.failedRetryOnly = !state.failedRetryOnly;
		state.eventScrollOffset = 0; // Reset scroll when filter changes
	}
	// Force refresh: r
	else if (matchesKey(data, "r")) {
		// Refresh happens automatically in the main loop
	}
	// Exit: q
	else if (matchesKey(data, "q")) {
		state.shouldExit = true;
	}
}

/**
 * Load dashboard state from disk
 *
 * @param stateFile - Path to state file
 * @param journalFile - Path to journal file
 * @returns Dashboard state
 */
async function loadDashboardState(stateFile: string, journalFile: string): Promise<DashboardState> {
	const state: DashboardState = {
		plan: null,
		recentEvents: [],
		lastUpdate: Date.now(),
	};

	// Load plan state
	try {
		const stateContent = await fs.readFile(stateFile, "utf-8");
		const planState = JSON.parse(stateContent);

		// Convert workspaces array to Map
		if (Array.isArray(planState.workspaces)) {
			const workspacesMap = new Map();
			for (const ws of planState.workspaces) {
				workspacesMap.set(ws.workspaceId, ws);
			}
			planState.workspaces = workspacesMap;
		}

		state.plan = planState;
	} catch (_error) {
		// State file doesn't exist or is invalid
	}

	// Load recent journal events (last 50 for filtering/scrolling)
	try {
		const journalContent = await fs.readFile(journalFile, "utf-8");
		const lines = journalContent
			.trim()
			.split("\n")
			.filter((line) => line.length > 0);
		const events = lines.slice(-50).map((line) => JSON.parse(line) as JournalEvent);
		state.recentEvents = events;
	} catch (_error) {
		// Journal file doesn't exist or is invalid
	}

	return state;
}

/**
 * Render dashboard to terminal
 *
 * @param state - Dashboard state
 * @param watcherState - Watcher UI state
 * @param interactive - Whether keyboard input is available
 */
function renderDashboard(state: DashboardState, watcherState: WatcherState, interactive: boolean): void {
	// Clear screen and move to top
	process.stdout.write("\x1b[2J\x1b[H");

	const lines: string[] = [];

	// Header
	lines.push(chalk.bold.cyan("═══════════════════════════════════════════════════════════════"));
	lines.push(chalk.bold.cyan("  Pi Plan Execution Dashboard (Observer Mode)"));
	lines.push(chalk.bold.cyan("═══════════════════════════════════════════════════════════════"));
	lines.push("");

	if (!state.plan) {
		lines.push(chalk.yellow("No active plan execution found"));
		lines.push(chalk.dim("Waiting for execution to start..."));
		lines.push("");
		lines.push(chalk.dim(`Last update: ${new Date(state.lastUpdate).toLocaleTimeString()}`));
		if (interactive) {
			lines.push(chalk.dim("Press q to exit"));
		} else {
			lines.push(chalk.dim("Press Ctrl+C to exit"));
		}
		process.stdout.write(lines.join("\n"));
		return;
	}

	const plan = state.plan;

	// Plan info
	lines.push(chalk.bold(`Plan: ${plan.title}`));
	lines.push(chalk.dim(`Phase: ${plan.phase}`));
	lines.push(chalk.dim(`Status: ${formatStatus(plan.status)}`));
	lines.push("");

	// Count workspaces by stage
	const counts = {
		pending: 0,
		active: 0,
		complete: 0,
		blocked: 0,
		failed: 0,
	};

	const activeWorkspaces: Array<{ id: string; attempts: number }> = [];

	for (const [id, ws] of plan.workspaces.entries()) {
		counts[ws.stage]++;
		if (ws.stage === WorkspaceStage.Active) {
			activeWorkspaces.push({ id, attempts: ws.attempts });
		}
	}

	// Workspace status
	lines.push(chalk.bold("Workspace Status:"));
	lines.push(`  ${chalk.green("●")} Complete: ${chalk.bold(String(counts.complete))}`);
	lines.push(`  ${chalk.blue("●")} Active:   ${chalk.bold(String(counts.active))}`);
	lines.push(`  ${chalk.yellow("●")} Pending:  ${chalk.bold(String(counts.pending))}`);
	lines.push(`  ${chalk.yellow("●")} Blocked:  ${chalk.bold(String(counts.blocked))}`);
	lines.push(`  ${chalk.red("●")} Failed:   ${chalk.bold(String(counts.failed))}`);
	lines.push("");

	// Active workers (with selection marker)
	if (activeWorkspaces.length > 0) {
		const panelFocused = watcherState.focusedPanel === "workers";
		const title = panelFocused ? chalk.bold.cyan("Active Workers:") : chalk.bold("Active Workers:");
		lines.push(title);

		for (let i = 0; i < activeWorkspaces.length; i++) {
			const ws = activeWorkspaces[i];
			const isSelected = i === watcherState.selectedWorkerIndex && panelFocused;
			const marker = isSelected ? chalk.cyan("▶") : " ";
			const workerNum = chalk.dim(`[${i + 1}]`);
			lines.push(`  ${marker} ${workerNum} ${chalk.blue("→")} ${ws.id} ${chalk.dim(`(attempt ${ws.attempts})`)}`);
		}
		lines.push("");
	}

	// Selected worker detail (P2.2 Slice 2 - minimal version using plan state only)
	if (activeWorkspaces.length > 0 && watcherState.selectedWorkerIndex < activeWorkspaces.length) {
		const selectedWorker = activeWorkspaces[watcherState.selectedWorkerIndex];
		const workspaceState = plan.workspaces.get(selectedWorker.id);

		lines.push(chalk.bold("Selected Worker Detail:"));
		lines.push(`  ${chalk.cyan("Workspace:")} ${selectedWorker.id}`);

		if (workspaceState) {
			lines.push(`  ${chalk.cyan("Stage:")} ${formatWorkspaceStage(workspaceState.stage)}`);
			lines.push(`  ${chalk.cyan("Attempts:")} ${workspaceState.attempts}`);

			// Worker-specific recent events (last 5)
			const workerEvents = state.recentEvents.filter((e) => e.workspaceId === selectedWorker.id).slice(-5);

			if (workerEvents.length > 0) {
				lines.push(`  ${chalk.cyan("Recent Events:")}`);
				for (const event of workerEvents) {
					const time = new Date(event.timestamp).toLocaleTimeString();
					const eventStr = formatEvent(event);
					lines.push(`    ${chalk.dim(time)} ${eventStr}`);
				}
			} else {
				lines.push(`  ${chalk.dim("No recent events for this worker")}`);
			}
		} else {
			lines.push(chalk.dim("  Workspace state unavailable"));
		}
		lines.push("");
	}

	// Recent events (with filtering and scrolling)
	const panelFocused = watcherState.focusedPanel === "events";
	const title = panelFocused ? chalk.bold.cyan("Recent Events:") : chalk.bold("Recent Events:");
	lines.push(title);

	// Apply filter
	let displayEvents = state.recentEvents;
	if (watcherState.failedRetryOnly) {
		displayEvents = displayEvents.filter(
			(e) =>
				e.type === "workspace_failed" ||
				e.type === "workspace_blocked" ||
				e.type === "retry_attempt" ||
				e.type === "plan_failed",
		);
	}

	// Apply scroll offset and limit to 5 visible events
	const visibleEvents = displayEvents.slice(watcherState.eventScrollOffset, watcherState.eventScrollOffset + 5);

	if (visibleEvents.length > 0) {
		for (const event of visibleEvents) {
			const time = new Date(event.timestamp).toLocaleTimeString();
			const eventStr = formatEvent(event);
			lines.push(`  ${chalk.dim(time)} ${eventStr}`);
		}
	} else {
		lines.push(chalk.dim("  No events to display"));
	}

	// Event panel status
	if (displayEvents.length > 5) {
		const showing = `${watcherState.eventScrollOffset + 1}-${Math.min(watcherState.eventScrollOffset + 5, displayEvents.length)}`;
		lines.push(chalk.dim(`  Showing ${showing} of ${displayEvents.length}`));
	}
	if (watcherState.failedRetryOnly) {
		lines.push(chalk.yellow("  [Filter: Failed/Retry only]"));
	}
	lines.push("");

	// Elapsed time
	const elapsed = plan.completedAt ? plan.completedAt - plan.startedAt : Date.now() - plan.startedAt;
	const elapsedMinutes = Math.floor(elapsed / 60000);
	const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
	lines.push(chalk.dim(`Elapsed: ${elapsedMinutes}m ${elapsedSeconds}s`));
	lines.push(chalk.dim(`Last update: ${new Date(state.lastUpdate).toLocaleTimeString()}`));
	lines.push("");

	// Keyboard shortcuts
	if (interactive) {
		lines.push(chalk.dim("Keys: 1/2/3=worker  tab=panel  j/k=scroll  f=filter  r=refresh  q=exit"));
	} else {
		lines.push(chalk.dim("Press Ctrl+C to exit"));
	}

	process.stdout.write(lines.join("\n"));
}

/**
 * Format workspace stage with color
 *
 * @param stage - Workspace stage
 * @returns Formatted stage string
 */
function formatWorkspaceStage(stage: WorkspaceStage): string {
	switch (stage) {
		case WorkspaceStage.Pending:
			return chalk.yellow("pending");
		case WorkspaceStage.Active:
			return chalk.blue("active");
		case WorkspaceStage.Complete:
			return chalk.green("complete");
		case WorkspaceStage.Blocked:
			return chalk.yellow("blocked");
		case WorkspaceStage.Failed:
			return chalk.red("failed");
		default:
			return stage;
	}
}

/**
 * Format status with color
 *
 * @param status - Plan status
 * @returns Formatted status string
 */
function formatStatus(status: string): string {
	switch (status) {
		case "running":
			return chalk.blue(status);
		case "complete":
			return chalk.green(status);
		case "failed":
			return chalk.red(status);
		case "paused":
			return chalk.yellow(status);
		default:
			return status;
	}
}

/**
 * Format journal event for display
 *
 * @param event - Journal event
 * @returns Formatted event string
 */
function formatEvent(event: JournalEvent): string {
	switch (event.type) {
		case "plan_start":
			return chalk.green("▶ Plan started");
		case "plan_complete":
			return chalk.green("✓ Plan completed");
		case "plan_failed":
			return chalk.red("✗ Plan failed");
		case "workspace_start":
			return `${chalk.blue("→")} ${event.workspaceId} started`;
		case "workspace_complete":
			return `${chalk.green("✓")} ${event.workspaceId} completed`;
		case "workspace_failed":
			return `${chalk.red("✗")} ${event.workspaceId} failed`;
		case "workspace_blocked":
			return `${chalk.yellow("⊘")} ${event.workspaceId} blocked`;
		case "retry_attempt":
			return `${chalk.yellow("⟳")} ${event.workspaceId} retry ${event.data?.attempt || "?"}`;
		case "file_lock_acquired":
			return `${chalk.dim("🔒")} ${event.workspaceId} locked files`;
		case "file_lock_released":
			return `${chalk.dim("🔓")} ${event.workspaceId} released files`;
		default:
			return `${event.type} ${event.workspaceId || ""}`;
	}
}
