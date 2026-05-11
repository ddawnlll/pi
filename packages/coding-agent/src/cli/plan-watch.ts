/**
 * Plan Watch Dashboard - P2 Workstream 7.M
 *
 * Observer-only dashboard for monitoring plan execution.
 * Read-only, never pauses execution, never mutates state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
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
 * Watch command - observer-only dashboard
 *
 * Displays:
 * - Phase and title
 * - Active workers and their current workspaces
 * - Stage counts
 * - Retry counts
 * - Queue counts
 * - Recent events from journal
 *
 * @param options - Watch options
 */
export async function planWatch(options: WatchOptions = {}): Promise<void> {
	const { cwd = process.cwd(), refreshMs = 500, exitAfter } = options;

	const stateFile = path.join(cwd, ".pi", "plan-state.json");
	const journalFile = path.join(cwd, ".pi", "execution-journal.ndjson");

	let running = true;
	const _startTime = Date.now();

	// Handle exit
	if (exitAfter) {
		setTimeout(() => {
			running = false;
		}, exitAfter * 1000);
	}

	// Handle Ctrl+C
	process.on("SIGINT", () => {
		running = false;
	});

	// Clear screen and hide cursor
	process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");

	try {
		while (running) {
			const state = await loadDashboardState(stateFile, journalFile);
			renderDashboard(state);

			// Wait for next refresh
			await new Promise((resolve) => setTimeout(resolve, refreshMs));

			// Check if execution is complete
			if (state.plan && state.plan.status !== "running") {
				running = false;
			}
		}
	} finally {
		// Show cursor
		process.stdout.write("\x1b[?25h");
		console.log("\n");
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

	// Load recent journal events (last 10)
	try {
		const journalContent = await fs.readFile(journalFile, "utf-8");
		const lines = journalContent
			.trim()
			.split("\n")
			.filter((line) => line.length > 0);
		const events = lines.slice(-10).map((line) => JSON.parse(line) as JournalEvent);
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
 */
function renderDashboard(state: DashboardState): void {
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
		lines.push(chalk.dim("Press Ctrl+C to exit"));
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

	// Active workers
	if (activeWorkspaces.length > 0) {
		lines.push(chalk.bold("Active Workers:"));
		for (const ws of activeWorkspaces) {
			lines.push(`  ${chalk.blue("→")} ${ws.id} ${chalk.dim(`(attempt ${ws.attempts})`)}`);
		}
		lines.push("");
	}

	// Recent events
	if (state.recentEvents.length > 0) {
		lines.push(chalk.bold("Recent Events:"));
		for (const event of state.recentEvents.slice(-5)) {
			const time = new Date(event.timestamp).toLocaleTimeString();
			const eventStr = formatEvent(event);
			lines.push(`  ${chalk.dim(time)} ${eventStr}`);
		}
		lines.push("");
	}

	// Elapsed time
	const elapsed = plan.completedAt ? plan.completedAt - plan.startedAt : Date.now() - plan.startedAt;
	const elapsedMinutes = Math.floor(elapsed / 60000);
	const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
	lines.push(chalk.dim(`Elapsed: ${elapsedMinutes}m ${elapsedSeconds}s`));
	lines.push(chalk.dim(`Last update: ${new Date(state.lastUpdate).toLocaleTimeString()}`));
	lines.push("");
	lines.push(chalk.dim("Press Ctrl+C to exit"));

	process.stdout.write(lines.join("\n"));
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
