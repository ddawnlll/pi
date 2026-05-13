/**
 * Plan Watch Dashboard - P2 Workstream 7.M + P2.2 Slices 1-3
 *
 * Observer-only dashboard for monitoring plan execution.
 * Read-only, never pauses execution, never mutates state.
 *
 * P2.2 Slice 1: Adds keyboard navigation (1/2/3, tab, j/k, f, r, q)
 * P2.2 Slice 3: Adds fallback mode for non-TTY and TUI init failures
 *
 * Refactored to use Ink for proper TUI rendering with no flicker.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import React, { useEffect, useState } from "react";
import { Box, Text, render, useInput } from "ink";
import chalk from "chalk";
import { createPlanControlManager, type PlanControlState } from "../core/plan-control.js";
import type { PlanState, JournalEvent } from "../core/plan-state.js";
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
 * Display mode
 */
type DisplayMode = "interactive" | "fallback";

/**
 * Dashboard state
 */
interface DashboardState {
	plan: PlanState | null;
	control: PlanControlState | null;
	recentEvents: JournalEvent[];
	lastUpdate: number;
}

/**
 * Derived dashboard data (shared between interactive and fallback modes)
 */
interface DerivedDashboardData {
	counts: {
		pending: number;
		active: number;
		complete: number;
		blocked: number;
		failed: number;
	};
	activeWorkspaces: Array<{ id: string; attempts: number }>;
}

/**
 * Deserialize plan state from JSON (converts workspaces array to Map)
 *
 * @param rawState - Raw state from JSON
 * @returns Deserialized plan state
 */
function deserializePlanState(rawState: unknown): PlanState {
	const state = rawState as PlanState & { workspaces: unknown };

	// Convert workspaces array to Map
	if (Array.isArray(state.workspaces)) {
		const workspacesMap = new Map();
		for (const ws of state.workspaces) {
			workspacesMap.set((ws as { workspaceId: string }).workspaceId, ws);
		}
		state.workspaces = workspacesMap;
	}

	return state as PlanState;
}

/**
 * Derive dashboard data from plan state
 *
 * @param plan - Plan state
 * @returns Derived data
 */
function deriveDashboardData(plan: PlanState): DerivedDashboardData {
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

	return { counts, activeWorkspaces };
}

/**
 * Handoff dialog component — shown when plan enters awaiting_handoff state.
 * Displays a summary with three action buttons.
 */
function HandoffDialog({
	plan,
}: {
	plan: PlanState;
}): React.JSX.Element {
	const commitsCount = Array.from(plan.workspaces.values()).filter(
		(w) => w.stage === WorkspaceStage.Complete,
	).length;

	return (
		<Box flexDirection="column" marginY={1}>
			<Text> </Text>
			<Text bold color="yellow">
				═══════════════════════════════════════════════════════════════
			</Text>
			<Text bold color="yellow">
				  Plan Handoff — Awaiting User Decision
			</Text>
			<Text bold color="yellow">
				═══════════════════════════════════════════════════════════════
			</Text>
			<Text> </Text>
			<Text>Plan: {plan.title}</Text>
			<Text>Phase: {plan.phase}</Text>
			<Text>
				Workspaces completed: {commitsCount}/{plan.workspaces.size}
			</Text>
			<Text>Status: {chalk.yellow("awaiting handoff")}</Text>
			<Text> </Text>
			<Text bold>Actions:</Text>
			<Text>
				  [{chalk.cyan("1")}] {chalk.green("Commit & finish")} — Rollup commit all changes & complete plan
			</Text>
			<Text>
				  [{chalk.cyan("2")}] {chalk.yellow("Keep editing")} — Return plan to running status
			</Text>
			<Text>
				  [{chalk.cyan("3")}] {chalk.red("Discard")} — Revert uncommitted workspace files & fail plan
			</Text>
			<Text> </Text>
			<Text dimColor>Plan will auto-commit after 30 minutes of inactivity</Text>
			<Text> </Text>
		</Box>
	);
}

/**
 * Format journal event for display
 *
 * @param event - Journal event
 * @param options - Format options
 * @returns Formatted event string
 */
function formatEvent(event: JournalEvent, options: { color: boolean }): string {
	const { color } = options;

	switch (event.type) {
		case "plan_start":
			return color ? chalk.green("▶ Plan started") : "▶ Plan started";
		case "plan_complete":
			return color ? chalk.green("✓ Plan completed") : "✓ Plan completed";
		case "plan_handoff":
			return color ? chalk.yellow("⟳ Plan awaiting handoff") : "⟳ Plan awaiting handoff";
		case "plan_handoff_committed":
			return color ? chalk.green("✓ Handoff committed") : "✓ Handoff committed";
		case "plan_handoff_keep":
			return color ? chalk.yellow("⟳ Handoff keep editing") : "⟳ Handoff keep editing";
		case "plan_handoff_discard":
			return color ? chalk.red("✗ Handoff discarded") : "✗ Handoff discarded";
		case "plan_failed":
			return color ? chalk.red("✗ Plan failed") : "✗ Plan failed";
		case "plan_paused":
			return color ? chalk.yellow("⏸ Plan paused") : "⏸ Plan paused";
		case "plan_stopped":
			return color ? chalk.yellow("⏹ Plan stopped") : "⏹ Plan stopped";
		case "plan_cancelled":
			return color ? chalk.red("✗ Plan cancelled") : "✗ Plan cancelled";
		case "plan_pause_requested":
			return color ? chalk.yellow("⏸ Pause requested") : "⏸ Pause requested";
		case "plan_stop_requested":
			return color ? chalk.yellow("⏹ Stop requested") : "⏹ Stop requested";
		case "plan_cancel_requested":
			return color ? chalk.red("✗ Cancel requested") : "✗ Cancel requested";
		case "plan_resumed":
			return color ? chalk.green("▶ Plan resumed") : "▶ Plan resumed";
		case "workspace_start":
			return color
				? `${chalk.blue("→")} ${event.workspaceId} started`
				: `→ ${event.workspaceId} started`;
		case "workspace_complete":
			return color
				? `${chalk.green("✓")} ${event.workspaceId} completed`
				: `✓ ${event.workspaceId} completed`;
		case "workspace_failed":
			return color
				? `${chalk.red("✗")} ${event.workspaceId} failed`
				: `✗ ${event.workspaceId} failed`;
		case "workspace_blocked":
			return color
				? `${chalk.yellow("⊘")} ${event.workspaceId} blocked`
				: `⊘ ${event.workspaceId} blocked`;
		case "retry_attempt":
			return color
				? `${chalk.yellow("⟳")} ${event.workspaceId} retry ${event.data?.attempt ?? "?"}`
				: `⟳ ${event.workspaceId} retry ${event.data?.attempt ?? "?"}`;
		case "file_lock_acquired":
			return color
				? `${chalk.dim("[lock]")} ${event.workspaceId} locked files`
				: `[lock] ${event.workspaceId} locked files`;
		case "file_lock_released":
			return color
				? `${chalk.dim("[unlock]")} ${event.workspaceId} released files`
				: `[unlock] ${event.workspaceId} released files`;
		default:
			return `[unknown: ${event.type}] ${event.workspaceId ?? ""}`;
	}
}

/**
 * Load dashboard state from disk
 *
 * @param stateFile - Path to state file
 * @param journalFile - Path to journal file
 * @param controlManager - Control manager
 * @returns Dashboard state
 */
async function loadDashboardState(
	stateFile: string,
	journalFile: string,
	controlManager: ReturnType<typeof createPlanControlManager>,
): Promise<DashboardState> {
	const state: DashboardState = {
		plan: null,
		control: null,
		recentEvents: [],
		lastUpdate: Date.now(),
	};

	// Load plan state
	try {
		const stateContent = await fs.readFile(stateFile, "utf-8");
		const planState = JSON.parse(stateContent);
		state.plan = deserializePlanState(planState);
	} catch (_error) {
		// State file doesn't exist or is invalid
	}

	// Load control state
	try {
		state.control = await controlManager.readControlRequest();
	} catch (_error) {
		// Control file doesn't exist or is invalid
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
 * Header component
 */
function Header({ plan }: { plan: PlanState | null }): React.JSX.Element {
	return (
		<Box flexDirection="column">
			<Text bold color="cyan">
				═══════════════════════════════════════════════════════════════
			</Text>
			<Text bold color="cyan">
				  Pi Plan Execution Dashboard (Observer Mode)
			</Text>
			<Text bold color="cyan">
				═══════════════════════════════════════════════════════════════
			</Text>
			<Text> </Text>
			{plan && (
				<>
					<Text bold>Plan: {plan.title}</Text>
					<Text dimColor>Phase: {plan.phase}</Text>
					<Text dimColor>Status: {formatStatus(plan.status)}</Text>
					<Text> </Text>
				</>
			)}
		</Box>
	);
}

/**
 * Format status with color
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
		case "awaiting_handoff":
			return chalk.yellow(status);
		default:
			return status;
	}
}

/**
 * Worker panel component
 */
function WorkerPanel({
	workers,
	selectedId,
	focused,
}: {
	workers: Array<{ id: string; attempts: number }>;
	selectedId: string | null;
	focused: boolean;
}): React.JSX.Element {
	const workerPanelTitle = focused ? (
		<Text bold color="cyan">
			Active Workers:
		</Text>
	) : (
		<Text bold>Active Workers:</Text>
	);

	return (
		<Box flexDirection="column">
			{workerPanelTitle}
			{workers.map((ws, i) => {
				const isSelected = ws.id === selectedId && focused;
				const marker = isSelected ? chalk.cyan("▶") : " ";
				const workerNum = chalk.dim(`[${i + 1}]`);
				return (
					<Text key={ws.id}>
						  {marker} {workerNum} {chalk.blue("→")} {ws.id} {chalk.dim(`(attempt ${ws.attempts})`)}
					</Text>
				);
			})}
			<Text> </Text>
		</Box>
	);
}

/**
 * Worker detail component
 */
function WorkerDetail({
	worker,
	plan,
	events,
}: {
	worker: { id: string; attempts: number } | null;
	plan: PlanState;
	events: JournalEvent[];
}): React.JSX.Element {
	if (!worker) {
		return <Box />;
	}

	const workspaceState = plan.workspaces.get(worker.id);
	const workerEvents = events.filter((e) => e.workspaceId === worker.id).slice(-5);

	return (
		<Box flexDirection="column">
			<Text bold>Selected Worker Detail:</Text>
			<Text>
				  {chalk.cyan("Workspace:")} {worker.id}
			</Text>
			{workspaceState && (
				<>
					<Text>
						  {chalk.cyan("Stage:")} {formatWorkspaceStage(workspaceState.stage)}
					</Text>
					<Text>
						  {chalk.cyan("Attempts:")} {workspaceState.attempts}
					</Text>
					{workerEvents.length > 0 ? (
						<>
							<Text>  {chalk.cyan("Recent Events:")}</Text>
							{workerEvents.map((event, i) => {
								const time = new Date(event.timestamp).toLocaleTimeString();
								const eventStr = formatEvent(event, { color: true });
								return (
									<Text key={i}>
										    {chalk.dim(time)} {eventStr}
									</Text>
								);
							})}
						</>
					) : (
						<Text dimColor>  No recent events for this worker</Text>
					)}
				</>
			)}
			{!workspaceState && <Text dimColor>  Workspace state unavailable</Text>}
			<Text> </Text>
		</Box>
	);
}

/**
 * Format workspace stage with color
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
 * Event panel component
 */
function EventPanel({
	events,
	offset,
	focused,
	total,
	filterActive,
}: {
	events: JournalEvent[];
	offset: number;
	focused: boolean;
	total: number;
	filterActive: boolean;
}): React.JSX.Element {
	const eventPanelTitle = focused ? (
		<Text bold color="cyan">
			Recent Events:
		</Text>
	) : (
		<Text bold>Recent Events:</Text>
	);

	const visibleEvents = events.slice(offset, offset + 5);

	return (
		<Box flexDirection="column">
			{eventPanelTitle}
			{visibleEvents.length > 0 ? (
				visibleEvents.map((event, i) => {
					const time = new Date(event.timestamp).toLocaleTimeString();
					const eventStr = formatEvent(event, { color: true });
					return (
						<Text key={i}>
							  {chalk.dim(time)} {eventStr}
						</Text>
					);
				})
			) : (
				<Text dimColor>  No events to display</Text>
			)}
			{total > 5 && (
				<Text dimColor>
					  Showing {offset + 1}-{Math.min(offset + 5, total)} of {total}
				</Text>
			)}
			{filterActive && <Text color="yellow">  [Filter: Failed/Retry only]</Text>}
			<Text> </Text>
		</Box>
	);
}

/**
 * Status bar component
 */
function StatusBar({
	plan,
	lastUpdate,
}: {
	plan: PlanState | null;
	lastUpdate: number;
}): React.JSX.Element {
	if (!plan) {
		return (
			<Box flexDirection="column">
				<Text dimColor>Last update: {new Date(lastUpdate).toLocaleTimeString()}</Text>
			</Box>
		);
	}

	const elapsed = plan.completedAt ? plan.completedAt - plan.startedAt : Date.now() - plan.startedAt;
	const elapsedMinutes = Math.floor(elapsed / 60000);
	const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

	return (
		<Box flexDirection="column">
			<Text dimColor>
				Elapsed: {elapsedMinutes}m {elapsedSeconds}s
			</Text>
			<Text dimColor>Last update: {new Date(lastUpdate).toLocaleTimeString()}</Text>
		</Box>
	);
}

/**
 * Keyboard hints component
 */
function KeyHints(): React.JSX.Element {
	return (
		<Box flexDirection="column">
			<Text> </Text>
			<Text dimColor>Keys: 1-9=worker  tab=panel  j/k=scroll  f=filter  r=refresh  q=exit</Text>
		</Box>
	);
}

/**
 * Main Ink App component
 */
function App({
	stateFile,
	journalFile,
	controlManager,
	refreshMs,
	onExit,
	cwd,
}: {
	stateFile: string;
	journalFile: string;
	controlManager: ReturnType<typeof createPlanControlManager>;
	refreshMs: number;
	onExit: () => void;
	cwd: string;
}): React.JSX.Element {
	const [state, setState] = useState<DashboardState>({
		plan: null,
		control: null,
		recentEvents: [],
		lastUpdate: Date.now(),
	});
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [focusedPanel, setFocusedPanel] = useState<"workers" | "events">("workers");
	const [eventScrollOffset, setEventScrollOffset] = useState(0);
	const [failedRetryOnly, setFailedRetryOnly] = useState(false);
	const [refreshToken, setRefreshToken] = useState(0);
	const [lastKeyPress, setLastKeyPress] = useState(0);

	// Load data on mount and refresh
	useEffect(() => {
		let mounted = true;

		const load = async () => {
			const newState = await loadDashboardState(stateFile, journalFile, controlManager);
			if (mounted) {
				setState(newState);

				// If plan completed/failed, exit after showing final state
				if (
					newState.plan &&
					newState.plan.status !== "running" &&
					newState.plan.status !== "awaiting_handoff"
				) {
					setTimeout(() => {
						if (mounted) {
							onExit();
						}
					}, 1000);
				}
			}
		};

		load();

		const interval = setInterval(load, refreshMs);

		return () => {
			mounted = false;
			clearInterval(interval);
		};
	}, [stateFile, journalFile, controlManager, refreshMs, refreshToken, onExit]);

	// Handle keyboard input with debouncing for scroll
	useInput((input, key) => {
		const now = Date.now();

		// Handoff dialog actions (only when awaiting_handoff)
		if (state.plan?.status === "awaiting_handoff") {
			if (input === "1") {
				// Commit & finish
				try {
					execSync("npx tsx ../../src/plan-command-cli.ts plan handoff-commit", {
						cwd: cwd,
						stdio: "inherit",
					});
				} catch {
					// Fall through
				}
				onExit();
				return;
			}
			if (input === "2") {
				// Keep editing
				try {
					execSync("npx tsx ../../src/plan-command-cli.ts plan handoff-keep", {
						cwd: cwd,
						stdio: "inherit",
					});
				} catch {
					// Fall through
				}
				onExit();
				return;
			}
			if (input === "3") {
				// Discard
				try {
					execSync("npx tsx ../../src/plan-command-cli.ts plan handoff-discard", {
						cwd: cwd,
						stdio: "inherit",
					});
				} catch {
					// Fall through
				}
				onExit();
				return;
			}
		}

		// Worker selection: 1-9 (only if not awaiting_handoff, since 1/2/3 are used for handoff)
		if (state.plan?.status !== "awaiting_handoff" && input >= "1" && input <= "9") {
			const index = Number.parseInt(input, 10) - 1;
			if (state.plan) {
				const data = deriveDashboardData(state.plan);
				if (index < data.activeWorkspaces.length) {
					setSelectedWorkerId(data.activeWorkspaces[index].id);
					setFocusedPanel("workers");
				}
			}
		}
		// Panel cycling: tab
		else if (key.tab) {
			setFocusedPanel((prev) => (prev === "workers" ? "events" : "workers"));
		}
		// Event log scrolling: j/k or arrows (debounced to 50ms)
		else if ((input === "j" || key.downArrow) && now - lastKeyPress >= 50) {
			setLastKeyPress(now);
			setEventScrollOffset((prev) => {
				const filteredEvents = getFilteredEvents(state.recentEvents, failedRetryOnly);
				return Math.min(prev + 1, Math.max(0, filteredEvents.length - 5));
			});
			setFocusedPanel("events");
		} else if ((input === "k" || key.upArrow) && now - lastKeyPress >= 50) {
			setLastKeyPress(now);
			setEventScrollOffset((prev) => Math.max(0, prev - 1));
			setFocusedPanel("events");
		}
		// Filter toggle: f
		else if (input === "f") {
			setFailedRetryOnly((prev) => !prev);
			setEventScrollOffset(0);
		}
		// Force refresh: r
		else if (input === "r") {
			setRefreshToken((prev) => prev + 1);
		}
		// Exit: q
		else if (input === "q") {
			onExit();
		}
	});

	// Clamp scroll offset when filter changes or data updates
	useEffect(() => {
		const filteredEvents = getFilteredEvents(state.recentEvents, failedRetryOnly);
		setEventScrollOffset((prev) => Math.min(prev, Math.max(0, filteredEvents.length - 5)));
	}, [state.recentEvents, failedRetryOnly]);

	if (!state.plan) {
		return (
			<Box flexDirection="column">
				<Header plan={null} />
				<Text color="yellow">No active plan execution found</Text>
				<Text dimColor>Waiting for execution to start...</Text>
				<Text> </Text>
				<Text dimColor>Last update: {new Date(state.lastUpdate).toLocaleTimeString()}</Text>
				<Text dimColor>Press q to exit</Text>
			</Box>
		);
	}

	const data = deriveDashboardData(state.plan);
	const filteredEvents = getFilteredEvents(state.recentEvents, failedRetryOnly);

	// Auto-select first worker if none selected
	const selectedWorker =
		selectedWorkerId && data.activeWorkspaces.find((w) => w.id === selectedWorkerId)
			? data.activeWorkspaces.find((w) => w.id === selectedWorkerId)!
			: data.activeWorkspaces[0] ?? null;

	const isHandoff = state.plan.status === "awaiting_handoff";

	return (
		<Box flexDirection="column">
			<Header plan={state.plan} />

			{/* Handoff dialog (shown when plan is awaiting_handoff) */}
			{isHandoff && <HandoffDialog plan={state.plan} />}

			{/* Workspace status (hide detailed status during handoff, show summary instead) */}
			{!isHandoff && (
				<Box flexDirection="column">
					<Text bold>Workspace Status:</Text>
					<Text>
						  {chalk.green("●")} Complete: {chalk.bold(String(data.counts.complete))}
					</Text>
					<Text>
						  {chalk.blue("●")} Active:   {chalk.bold(String(data.counts.active))}
					</Text>
					<Text>
						  {chalk.yellow("●")} Pending:  {chalk.bold(String(data.counts.pending))}
					</Text>
					<Text>
						  {chalk.yellow("●")} Blocked:  {chalk.bold(String(data.counts.blocked))}
					</Text>
					<Text>
						  {chalk.red("●")} Failed:   {chalk.bold(String(data.counts.failed))}
					</Text>
					<Text> </Text>
				</Box>
			)}

			{/* Active workers */}
			{!isHandoff && data.activeWorkspaces.length > 0 && (
				<WorkerPanel
					workers={data.activeWorkspaces}
					selectedId={selectedWorker?.id ?? null}
					focused={focusedPanel === "workers"}
				/>
			)}

			{/* Selected worker detail */}
			{!isHandoff && selectedWorker && (
				<WorkerDetail worker={selectedWorker} plan={state.plan} events={state.recentEvents} />
			)}

			{/* Recent events */}
			<EventPanel
				events={filteredEvents}
				offset={eventScrollOffset}
				focused={focusedPanel === "events"}
				total={filteredEvents.length}
				filterActive={failedRetryOnly}
			/>

			{/* Status bar */}
			<StatusBar plan={state.plan} lastUpdate={state.lastUpdate} />

			{/* Keyboard hints */}
			{isHandoff ? (
				<Box flexDirection="column">
					<Text> </Text>
					<Text dimColor>Handoff Keys: 1=Commit  2=Keep editing  3=Discard  q=Exit</Text>
				</Box>
			) : (
				<KeyHints />
			)}
		</Box>
	);
}

/**
 * Get filtered events based on filter state
 */
function getFilteredEvents(events: JournalEvent[], failedRetryOnly: boolean): JournalEvent[] {
	if (!failedRetryOnly) {
		return events;
	}

	return events.filter(
		(e) =>
			e.type === "workspace_failed" ||
			e.type === "workspace_blocked" ||
			e.type === "retry_attempt" ||
			e.type === "plan_failed",
	);
}

/**
 * Render fallback status (non-interactive mode)
 *
 * Used when:
 * - Non-TTY environment (pipes, redirects, CI/CD)
 * - Terminal doesn't support raw mode
 * - Stdin setup fails
 *
 * @param state - Dashboard state
 */
function renderFallbackStatus(state: DashboardState): void {
	const lines: string[] = [];

	lines.push("═══════════════════════════════════════════════════════════════");
	lines.push("  Pi Plan Execution Dashboard (Observer Mode - Fallback)");
	lines.push("═══════════════════════════════════════════════════════════════");
	lines.push("");

	if (!state.plan) {
		lines.push("No active plan execution found");
		lines.push("Waiting for execution to start...");
		lines.push("");
		lines.push(`Last update: ${new Date(state.lastUpdate).toLocaleTimeString()}`);
		lines.push("Press Ctrl+C to exit");
		console.log(lines.join("\n"));
		console.log("---");
		return;
	}

	const plan = state.plan;
	const data = deriveDashboardData(plan);

	// Plan info
	lines.push(`Plan: ${plan.title}`);
	lines.push(`Phase: ${plan.phase}`);
	lines.push(`Status: ${plan.status}`);
	lines.push("");

	// Show handoff options in fallback mode
	if (plan.status === "awaiting_handoff") {
		lines.push("───────────────────────────────────────────────────────────");
		lines.push("  Plan Handoff — Awaiting User Decision");
		lines.push("───────────────────────────────────────────────────────────");
		lines.push("");
		lines.push("Actions:");
		lines.push("  [1] Commit & finish — Rollup commit all changes & complete plan");
		lines.push("  [2] Keep editing — Return plan to running status");
		lines.push("  [3] Discard — Revert uncommitted workspace files & fail plan");
		lines.push("");
		lines.push("Run: pi plan handoff-commit | handoff-keep | handoff-discard");
		lines.push("Plan will auto-commit after 30 minutes of inactivity");
		lines.push("");
	}

	// Workspace status
	lines.push("Workspace Status:");
	lines.push(`  Complete: ${data.counts.complete}`);
	lines.push(`  Active:   ${data.counts.active}`);
	lines.push(`  Pending:  ${data.counts.pending}`);
	lines.push(`  Blocked:  ${data.counts.blocked}`);
	lines.push(`  Failed:   ${data.counts.failed}`);
	lines.push("");

	// Active workers
	if (data.activeWorkspaces.length > 0) {
		lines.push("Active Workers:");
		for (const ws of data.activeWorkspaces) {
			lines.push(`  → ${ws.id} (attempt ${ws.attempts})`);
		}
		lines.push("");
	}

	// Recent events (last 5)
	const recentEvents = state.recentEvents.slice(-5);
	if (recentEvents.length > 0) {
		lines.push("Recent Events:");
		for (const event of recentEvents) {
			const time = new Date(event.timestamp).toLocaleTimeString();
			const eventStr = formatEvent(event, { color: false });
			lines.push(`  ${time} ${eventStr}`);
		}
		lines.push("");
	}

	// Elapsed time
	const elapsed = plan.completedAt ? plan.completedAt - plan.startedAt : Date.now() - plan.startedAt;
	const elapsedMinutes = Math.floor(elapsed / 60000);
	const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
	lines.push(`Elapsed: ${elapsedMinutes}m ${elapsedSeconds}s`);
	lines.push(`Last update: ${new Date(state.lastUpdate).toLocaleTimeString()}`);
	lines.push("");
	lines.push("Press Ctrl+C to exit");

	console.log(lines.join("\n"));
	console.log("---");
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
 * - 1-9: Select worker 1-9
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
	const controlManager = createPlanControlManager(cwd);

	// Detect display mode
	const mode: DisplayMode = process.stdin.isTTY && process.stdout.isTTY ? "interactive" : "fallback";

	if (mode === "interactive") {
		// Interactive mode: use Ink
		let shouldExit = false;
		let unmount: (() => void) | null = null;

		const handleExit = () => {
			shouldExit = true;
			if (unmount) {
				unmount();
			}
		};

		// Handle Ctrl+C
		process.on("SIGINT", handleExit);

		// Handle exitAfter for testing
		if (exitAfter) {
			setTimeout(handleExit, exitAfter * 1000);
		}

		try {
			const { unmount: unmountFn } = render(
				<App
					stateFile={stateFile}
					journalFile={journalFile}
					controlManager={controlManager}
					refreshMs={refreshMs}
					onExit={handleExit}
					cwd={cwd}
				/>,
			);
			unmount = unmountFn;

			// Wait for exit
			await new Promise<void>((resolve) => {
				const checkExit = setInterval(() => {
					if (shouldExit) {
						clearInterval(checkExit);
						resolve();
					}
				}, 100);
			});
		} finally {
			process.off("SIGINT", handleExit);
		}
	} else {
		// Fallback mode: static status output
		let running = true;

		// Handle Ctrl+C
		const handleSigint = () => {
			running = false;
		};
		process.on("SIGINT", handleSigint);

		// Handle exitAfter for testing
		if (exitAfter) {
			setTimeout(() => {
				running = false;
			}, exitAfter * 1000);
		}

		try {
			while (running) {
				const state = await loadDashboardState(stateFile, journalFile, controlManager);
				renderFallbackStatus(state);

				// Wait for next refresh
				await new Promise((resolve) => setTimeout(resolve, refreshMs));

				// Check if execution is complete
				if (state.plan && state.plan.status !== "running" && state.plan.status !== "awaiting_handoff") {
					running = false;
				}
			}
		} finally {
			process.off("SIGINT", handleSigint);
			console.log("\n");
		}
	}
}
