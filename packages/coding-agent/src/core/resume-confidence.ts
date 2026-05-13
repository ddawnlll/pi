/**
 * Resume Confidence Indicators - Workspace 4.6.G
 *
 * Tracks and evaluates confidence markers after a plan execution is resumed
 * from a paused or stopped state. Enables the dashboard to display:
 *
 * - Resume timestamp (when the plan was resumed)
 * - New event count after resume (how much progress since resume)
 * - Stall warning (if no new events after a configurable threshold)
 * - Rerun warning (if a completed workspace appears to re-execute)
 *
 * Resume confidence states:
 * - `progressing`: New events are appearing after resume; execution is healthy
 * - `nominal`: Resumed recently (within threshold); too early to tell
 * - `stalled`: No new events after the stall threshold; likely stuck
 * - `unsafe`: A completed workspace appears to be re-running; possible error
 */

import type { JournalEvent, PlanState } from "./plan-state.js";
import { WorkspaceStage } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resume confidence state values.
 *
 * - `progressing` — New events are appearing after resume; execution is healthy.
 * - `nominal`      — Resumed recently (within threshold); too early to judge.
 * - `stalled`     — No new events after the stall threshold; likely stuck.
 * - `unsafe`      — A completed workspace appears to be re-running.
 */
export type ResumeConfidenceState = "progressing" | "nominal" | "stalled" | "unsafe";

/**
 * Configuration for resume confidence evaluation.
 */
export interface ResumeConfidenceConfig {
	/** Milliseconds after resume before a plan is considered stalled (default: 60_000) */
	stallThresholdMs: number;
}

/**
 * Default resume confidence configuration.
 */
export const DEFAULT_RESUME_CONFIDENCE_CONFIG: ResumeConfidenceConfig = {
	stallThresholdMs: 60_000,
};

/**
 * Result of a resume confidence evaluation.
 */
export interface ResumeConfidenceResult {
	/** Current confidence state */
	state: ResumeConfidenceState;
	/** Timestamp when the plan was resumed (0 if never resumed) */
	resumedAt: number;
	/** Number of journal events that occurred after the resume timestamp */
	newEventCount: number;
	/** Whether a stall warning should be displayed */
	hasStallWarning: boolean;
	/** Whether a rerun warning should be displayed */
	hasRerunWarning: boolean;
	/** IDs of workspaces that appear to be re-running after completion */
	rerunWorkspaceIds: string[];
	/** Human-readable summary of the confidence assessment */
	summary: string;
}

// ---------------------------------------------------------------------------
// Core evaluation logic
// ---------------------------------------------------------------------------

/**
 * Find the most recent `plan_resumed` event timestamp from journal events.
 *
 * Returns 0 if no resume event exists (plan was never paused/stopped then resumed).
 *
 * @param events - Journal events to scan
 * @returns Timestamp of the most recent resume event, or 0
 */
export function findResumeTimestamp(events: JournalEvent[]): number {
	let latest = 0;
	for (const event of events) {
		if (event.type === "plan_resumed" && event.timestamp > latest) {
			latest = event.timestamp;
		}
	}
	return latest;
}

/**
 * Extract post-resume journal events.
 *
 * Returns events that appear strictly after the last `plan_resumed` event
 * in the journal order. This is more reliable than timestamp comparison
 * because events can share the same millisecond timestamp but have clear
 * ordering in the append-only journal.
 *
 * @param events - Full journal events
 * @returns Events occurring after the last plan_resumed event
 */
export function getPostResumeEvents(events: JournalEvent[]): JournalEvent[] {
	// Find the index of the last plan_resumed event
	let lastResumeIndex = -1;
	for (let i = events.length - 1; i >= 0; i--) {
		if (events[i].type === "plan_resumed") {
			lastResumeIndex = i;
			break;
		}
	}
	if (lastResumeIndex === -1) return [];
	return events.slice(lastResumeIndex + 1);
}

/**
 * Count events that occurred after a resume.
 *
 * Uses journal ordering (not just timestamp) to correctly determine which
 * events follow the `plan_resumed` event. This handles the common case
 * where resume and subsequent events share the same millisecond timestamp.
 *
 * @param events - Journal events
 * @param afterTimestamp - Resume timestamp (used as secondary check)
 * @returns Number of events after the resume
 */
export function countEventsAfterResume(events: JournalEvent[], afterTimestamp: number): number {
	if (afterTimestamp === 0) return 0;
	return getPostResumeEvents(events).length;
}

/**
 * Detect workspaces that have completed but appear to be running again after resume.
 *
 * A workspace is flagged as a "rerun" when:
 * 1. Its current stage is `Active` (it's executing right now)
 * 2. It had previously reached `Complete` stage (journal shows a `workspace_complete` event before resume)
 * 3. A `workspace_start` event for this workspace exists in post-resume events
 *
 * Uses journal ordering to correctly identify events after resume, handling
 * same-millisecond timestamp scenarios.
 *
 * @param planState - Current plan state
 * @param events - Journal events
 * @param resumedAt - Resume timestamp (0 if never resumed)
 * @returns Array of workspace IDs that appear to be re-running
 */
export function detectRerunWorkspaces(planState: PlanState, events: JournalEvent[], resumedAt: number): string[] {
	if (resumedAt === 0) return [];

	// Find workspaces that have ever reached Complete
	const completedWorkspaceIds = new Set<string>();
	for (const event of events) {
		if (event.type === "workspace_complete" && event.workspaceId) {
			completedWorkspaceIds.add(event.workspaceId);
		}
	}

	// Find workspaces that were started after resume (using journal ordering)
	const postResumeEvents = getPostResumeEvents(events);
	const startedAfterResumeIds = new Set<string>();
	for (const event of postResumeEvents) {
		if (event.type === "workspace_start" && event.workspaceId) {
			startedAfterResumeIds.add(event.workspaceId);
		}
	}

	// A workspace is a rerun if it previously completed AND was started after resume AND is currently Active
	const rerunIds: string[] = [];
	for (const wsId of completedWorkspaceIds) {
		if (startedAfterResumeIds.has(wsId)) {
			const wsState = planState.workspaces.get(wsId);
			if (wsState && wsState.stage === WorkspaceStage.Active) {
				rerunIds.push(wsId);
			}
		}
	}

	return rerunIds;
}

/**
 * Evaluate the resume confidence state for a plan execution.
 *
 * Determines whether a resumed execution is progressing normally, stalled,
 * or potentially unsafe (completed workspace appearing to rerun).
 *
 * @param planState - Current plan state
 * @param events - Full journal events
 * @param config - Resume confidence configuration
 * @returns Resume confidence result
 */
export function evaluateResumeConfidence(
	planState: PlanState,
	events: JournalEvent[],
	config: Partial<ResumeConfidenceConfig> = {},
): ResumeConfidenceResult {
	const effectiveConfig: ResumeConfidenceConfig = {
		...DEFAULT_RESUME_CONFIDENCE_CONFIG,
		...config,
	};

	// Find resume timestamp from journal events (authoritative source)
	const resumedAt = findResumeTimestamp(events);

	// If never resumed, no confidence indicators apply
	if (resumedAt === 0) {
		return {
			state: "nominal",
			resumedAt: 0,
			newEventCount: 0,
			hasStallWarning: false,
			hasRerunWarning: false,
			rerunWorkspaceIds: [],
			summary: "Plan has not been resumed",
		};
	}

	// Count new events after resume
	const newEventCount = countEventsAfterResume(events, resumedAt);

	// Detect rerun workspaces
	const rerunWorkspaceIds = detectRerunWorkspaces(planState, events, resumedAt);
	const hasRerunWarning = rerunWorkspaceIds.length > 0;

	// Determine time since resume
	const now = Date.now();
	const timeSinceResume = now - resumedAt;
	const isBeyondThreshold = timeSinceResume >= effectiveConfig.stallThresholdMs;

	// Determine stall warning
	const hasStallWarning = newEventCount === 0 && isBeyondThreshold;

	// Determine overall state
	let state: ResumeConfidenceState;
	if (hasRerunWarning) {
		state = "unsafe";
	} else if (hasStallWarning) {
		state = "stalled";
	} else if (newEventCount > 0) {
		state = "progressing";
	} else {
		state = "nominal";
	}

	// Build human-readable summary
	const summary = buildSummary(state, resumedAt, newEventCount, rerunWorkspaceIds);

	return {
		state,
		resumedAt,
		newEventCount,
		hasStallWarning,
		hasRerunWarning,
		rerunWorkspaceIds,
		summary,
	};
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary for a resume confidence result.
 *
 * @param state - Confidence state
 * @param resumedAt - Resume timestamp
 * @param newEventCount - Events after resume
 * @param rerunWorkspaceIds - Workspaces that appear to re-run
 * @returns Summary string
 */
function buildSummary(
	state: ResumeConfidenceState,
	resumedAt: number,
	newEventCount: number,
	rerunWorkspaceIds: string[],
): string {
	const resumeTime = new Date(resumedAt).toLocaleTimeString();

	switch (state) {
		case "progressing":
			return `Resumed at ${resumeTime} — ${newEventCount} new event(s) — progressing normally`;
		case "nominal":
			return `Resumed at ${resumeTime} — ${newEventCount} new event(s) — waiting for activity`;
		case "stalled":
			return `Resumed at ${resumeTime} — NO new events — STALLED (no progress after resume)`;
		case "unsafe":
			return `Resumed at ${resumeTime} — UNSAFE: completed workspace(s) appear to re-run: ${rerunWorkspaceIds.join(", ")}`;
	}
}

// ---------------------------------------------------------------------------
// Formatting helpers (for dashboard display)
// ---------------------------------------------------------------------------

/**
 * Format the resume confidence result for dashboard display.
 *
 * Returns a multi-line string suitable for terminal rendering.
 *
 * @param result - Resume confidence result
 * @param color - Whether to use ANSI color codes
 * @returns Formatted string lines
 */
export function formatResumeConfidenceIndicator(result: ResumeConfidenceResult, color: boolean = true): string[] {
	const lines: string[] = [];

	// Only show indicators if plan has been resumed
	if (result.resumedAt === 0) {
		return lines;
	}

	// Resume timestamp line
	const resumeTime = new Date(result.resumedAt).toLocaleTimeString();
	lines.push(
		color
			? `  Resume: ${resumeTime} (${result.newEventCount} new events)`
			: `  Resume: ${resumeTime} (${result.newEventCount} new events)`,
	);

	// Stall warning
	if (result.hasStallWarning) {
		lines.push(
			color
				? `  ⚠ STALLED: No new events after resume — execution may be stuck`
				: `  ⚠ STALLED: No new events after resume — execution may be stuck`,
		);
	}

	// Rerun warning
	if (result.hasRerunWarning) {
		const ids = result.rerunWorkspaceIds.join(", ");
		lines.push(
			color
				? `  ⚠ RERUN: Completed workspace(s) re-executing: ${ids}`
				: `  ⚠ RERUN: Completed workspace(s) re-executing: ${ids}`,
		);
	}

	return lines;
}
