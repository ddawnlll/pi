/**
 * Execution Stats - Plan Progress and Execution Cockpit Stats
 *
 * Computes dashboard statistics from PlanState for the execution cockpit.
 * Provides progress percentage, workspace counts, worker utilization,
 * and timing information for real-time dashboard rendering.
 */

import type { JournalEvent, PlanState } from "./plan-state.js";
import type { WorkspaceScheduler } from "./workspace-scheduler.js";
import { WorkspaceStage } from "./workspace-schema.js";

/**
 * Execution cockpit dashboard statistics.
 *
 * Aggregates all dashboard-relevant stats from a running or completed
 * plan execution for display in the cockpit UI.
 */
export interface ExecutionStats {
	/** Plan progress as a percentage (0-100), rounded to 1 decimal */
	progressPercent: number;
	/** Number of completed workspaces */
	completed: number;
	/** Total number of workspaces */
	total: number;
	/** Number of currently active (executing) workspaces */
	active: number;
	/** Maximum concurrent workers allowed */
	maxWorkers: number;
	/** Number of ready-to-run workspaces (pending and eligible) */
	ready: number;
	/** Number of pending workspaces (not yet scheduled) */
	pending: number;
	/** Number of blocked workspaces */
	blocked: number;
	/** Number of failed workspaces */
	failed: number;
	/** Elapsed time in milliseconds since execution started */
	elapsedMs: number;
	/** Timestamp of the last journal event, or null if no events */
	lastEventTimestamp: number | null;
	/** Workers requested by user configuration (before validation/clamping) */
	requestedWorkers: number;
	/** Maximum workers allowed after validation/clamping */
	maxAllowedWorkers: number;
	/** Safe effective parallelism considering current constraints (active + ready, capped by maxAllowedWorkers) */
	safeEffectiveParallelism: number;
	/** Reasons the scheduler is bottlenecked (human-readable strings) */
	bottleneckReasons: string[];
}

/**
 * Compute execution stats from plan state and scheduler.
 *
 * Derives all dashboard statistics from the current plan state,
 * the workspace scheduler (for ready count and max workers),
 * and the journal (for the last event timestamp).
 *
 * @param state - Current plan execution state
 * @param scheduler - Workspace scheduler instance
 * @param journal - Array of journal events (most recent last)
 * @param now - Current timestamp (defaults to Date.now())
 * @param requestedWorkers - Workers requested by user config (before clamping); defaults to maxWorkers
 * @returns ExecutionStats for dashboard rendering
 */
export function computeExecutionStats(
	state: PlanState,
	scheduler: WorkspaceScheduler,
	journal: JournalEvent[],
	now?: number,
	requestedWorkers?: number,
): ExecutionStats {
	const currentTime = now ?? Date.now();

	let completed = 0;
	let active = 0;
	let pending = 0;
	let blocked = 0;
	let failed = 0;

	for (const ws of state.workspaces.values()) {
		switch (ws.stage) {
			case WorkspaceStage.Complete:
				completed++;
				break;
			case WorkspaceStage.Active:
				active++;
				break;
			case WorkspaceStage.Pending:
				pending++;
				break;
			case WorkspaceStage.Blocked:
				blocked++;
				break;
			case WorkspaceStage.Failed:
				failed++;
				break;
		}
	}

	const total = state.workspaces.size;

	// Progress percentage: completed workspaces / total, 0-100
	const progressPercent = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

	// Ready count: pending workspaces that are eligible to schedule now
	// Use the scheduler to determine ready vs blocked-pending
	const schedStats = scheduler.getStatistics(state);
	const ready = Math.max(0, schedStats.availableSlots > 0 ? pending - blocked : 0);

	// Max workers from the scheduler (active + availableSlots = scheduler.maxWorkers)
	const maxWorkers = schedStats.active + schedStats.availableSlots;

	// Requested workers: user value before clamping, or fall back to scheduler's actual max
	const requested = requestedWorkers ?? maxWorkers;

	// Max allowed workers: the scheduler's validated/clamped maxWorkers
	const maxAllowedWorkers = maxWorkers;

	// Safe effective parallelism: how many workers can actually run concurrently
	// given current constraints (capped by maxAllowedWorkers)
	const safeEffectiveParallelism = Math.min(maxAllowedWorkers, active + ready);

	// Derive bottleneck reasons from the current scheduler state
	const bottleneckReasons: string[] = [];
	{
		const availableSlots = schedStats.availableSlots;
		if (blocked > 0) {
			bottleneckReasons.push(`${blocked} workspace(s) blocked by dependencies`);
		}
		if (active >= maxWorkers && pending > 0) {
			bottleneckReasons.push(`All ${maxWorkers} worker slots occupied`);
		}
		if (pending > 0 && active < maxWorkers && ready === 0) {
			bottleneckReasons.push("Pending workspaces waiting on file locks or dependencies");
		}
		if (availableSlots > 0 && pending === 0 && total > completed + failed) {
			bottleneckReasons.push("Pending workspaces consumed; waiting for active workspaces to complete");
		}
	}

	// Elapsed time
	const elapsedMs = Math.max(0, currentTime - state.startedAt);

	// Last event timestamp from journal
	const lastEventTimestamp = journal.length > 0 ? journal[journal.length - 1].timestamp : null;

	return {
		progressPercent,
		completed,
		total,
		active,
		maxWorkers,
		ready,
		pending,
		blocked,
		failed,
		elapsedMs,
		lastEventTimestamp,
		requestedWorkers: requested,
		maxAllowedWorkers,
		safeEffectiveParallelism,
		bottleneckReasons,
	};
}

/**
 * Compute execution stats without a scheduler (fallback).
 *
 * Uses default maxWorkers=3 and derives ready from pending count
 * when no scheduler instance is available.
 *
 * @param state - Current plan execution state
 * @param journal - Array of journal events
 * @param maxWorkers - Maximum concurrent workers (default: 3)
 * @param now - Current timestamp (defaults to Date.now())
 * @param requestedWorkers - Workers requested by user config (before clamping); defaults to maxWorkers
 * @returns ExecutionStats for dashboard rendering
 */
export function computeExecutionStatsSimple(
	state: PlanState,
	journal: JournalEvent[],
	maxWorkers?: number,
	now?: number,
	requestedWorkers?: number,
): ExecutionStats {
	const currentTime = now ?? Date.now();
	const effectiveMaxWorkers = maxWorkers ?? 3;

	let completed = 0;
	let active = 0;
	let pending = 0;
	let blocked = 0;
	let failed = 0;

	for (const ws of state.workspaces.values()) {
		switch (ws.stage) {
			case WorkspaceStage.Complete:
				completed++;
				break;
			case WorkspaceStage.Active:
				active++;
				break;
			case WorkspaceStage.Pending:
				pending++;
				break;
			case WorkspaceStage.Blocked:
				blocked++;
				break;
			case WorkspaceStage.Failed:
				failed++;
				break;
		}
	}

	const total = state.workspaces.size;
	const progressPercent = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

	// In simple mode, ready = pending workspaces when there are available slots
	const availableSlots = Math.max(0, effectiveMaxWorkers - active);
	const ready = availableSlots > 0 ? pending : 0;

	// Requested workers: user value before clamping, or fall back to max workers
	const requested = requestedWorkers ?? effectiveMaxWorkers;

	// Max allowed workers: same as effectiveMaxWorkers in simple mode
	const maxAllowedWorkers = effectiveMaxWorkers;

	// Safe effective parallelism: how many workers can actually run concurrently
	const safeEffectiveParallelism = Math.min(maxAllowedWorkers, active + ready);

	// Derive bottleneck reasons
	const bottleneckReasons: string[] = [];
	if (blocked > 0) {
		bottleneckReasons.push(`${blocked} workspace(s) blocked by dependencies`);
	}
	if (active >= effectiveMaxWorkers && pending > 0) {
		bottleneckReasons.push(`All ${effectiveMaxWorkers} worker slots occupied`);
	}
	if (pending > 0 && active < effectiveMaxWorkers && ready === 0) {
		bottleneckReasons.push("Pending workspaces waiting on dependencies");
	}
	if (availableSlots > 0 && pending === 0 && total > completed + failed) {
		bottleneckReasons.push("Pending workspaces consumed; waiting for active workspaces to complete");
	}

	const elapsedMs = Math.max(0, currentTime - state.startedAt);
	const lastEventTimestamp = journal.length > 0 ? journal[journal.length - 1].timestamp : null;

	return {
		progressPercent,
		completed,
		total,
		active,
		maxWorkers: effectiveMaxWorkers,
		ready,
		pending,
		blocked,
		failed,
		elapsedMs,
		lastEventTimestamp,
		requestedWorkers: requested,
		maxAllowedWorkers,
		safeEffectiveParallelism,
		bottleneckReasons,
	};
}

/**
 * Format execution stats for cockpit display.
 *
 * Produces a multi-line string suitable for terminal or log output.
 *
 * @param stats - Execution stats to format
 * @returns Formatted string
 */
export function formatExecutionStats(stats: ExecutionStats): string {
	const lines: string[] = [];

	lines.push(`Progress: ${stats.progressPercent}% (${stats.completed}/${stats.total})`);
	lines.push(`Workers:  ${stats.active}/${stats.maxWorkers} active`);
	lines.push(
		`Stages:   ready=${stats.ready} pending=${stats.pending} blocked=${stats.blocked} failed=${stats.failed}`,
	);
	lines.push(`Requested: ${stats.requestedWorkers} workers | Max allowed: ${stats.maxAllowedWorkers}`);
	lines.push(`Safe parallelism: ${stats.safeEffectiveParallelism}`);
	if (stats.bottleneckReasons.length > 0) {
		lines.push(`Bottlenecks: ${stats.bottleneckReasons.join("; ")}`);
	}
	lines.push(`Elapsed:  ${formatElapsedMs(stats.elapsedMs)}`);

	if (stats.lastEventTimestamp !== null) {
		lines.push(`Last event: ${new Date(stats.lastEventTimestamp).toISOString()}`);
	} else {
		lines.push("Last event: —");
	}

	return lines.join("  |  ");
}

/**
 * Format elapsed milliseconds as a human-readable duration string.
 *
 * @param ms - Elapsed milliseconds
 * @returns Formatted duration (e.g., "1h 23m 45s", "5m 00s", "12s")
 */
export function formatElapsedMs(ms: number): string {
	if (ms < 0) {
		return "0s";
	}

	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	}
	return `${seconds}s`;
}
