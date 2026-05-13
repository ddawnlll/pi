/**
 * P4.6 Execution Visibility — Hung Detection, Burn Rate, and Stability Report
 *
 * Provides execution visibility features for the plan execution cockpit:
 *
 * - **Hung workspace detection**: Active workspaces that have been running
 *   beyond a configurable threshold are flagged as potentially hung.
 *   Completed/failed/blocked workspaces are never flagged.
 *
 * - **Burn rate computation**: Token consumption rate (tokens/minute)
 *   derived from total tokens consumed divided by elapsed minutes.
 *
 * - **Live log validation**: Workspace-level log buffers that update
 *   in real-time and can be queried by the dashboard/API.
 *
 * - **Stability report**: A structured report summarizing plan execution
 *   health, including progress, burn rate, hung workspaces, resume
 *   confidence, and an overall assessment.
 */

import type { JournalEvent, PlanState } from "./plan-state.js";
import {
	evaluateResumeConfidence,
	type ResumeConfidenceConfig,
	type ResumeConfidenceResult,
} from "./resume-confidence.js";
import { WorkspaceStage } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Hung Workspace Detection
// ---------------------------------------------------------------------------

/**
 * Default hung-workspace threshold: 10 minutes.
 *
 * An active workspace that has been running for longer than this threshold
 * without any recent events is flagged as potentially hung.
 */
export const DEFAULT_HUNG_WORKSPACE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Warning emitted when a workspace appears to be hung.
 */
export interface HungWorkspaceWarning {
	/** Workspace ID */
	workspaceId: string;
	/** How long the workspace has been active (ms) */
	activeDurationMs: number;
	/** The threshold that was exceeded (ms) */
	thresholdMs: number;
	/** Timestamp of the last journal event for this workspace, or null */
	lastEventTimestamp: number | null;
}

/**
 * Result of hung workspace detection across all active workspaces.
 */
export interface HungDetectionResult {
	/** List of hung workspace warnings (empty if none detected) */
	warnings: HungWorkspaceWarning[];
	/** Whether any hung workspaces were detected */
	hasHungWorkspaces: boolean;
}

/**
 * Detect hung workspaces in a plan execution.
 *
 * A workspace is considered "hung" when:
 * 1. Its current stage is `Active` (it's currently executing)
 * 2. It has been active for longer than the threshold
 * 3. It has had no recent journal events (optional secondary check)
 *
 * Completed, failed, blocked, or pending workspaces are NEVER flagged as hung.
 *
 * @param state - Current plan state
 * @param journal - Journal events (to check last activity per workspace)
 * @param thresholdMs - Milliseconds an active workspace must exceed to be considered hung (default: 10 min)
 * @param now - Current timestamp (defaults to Date.now())
 * @returns Hung detection result
 */
export function detectHungWorkspaces(
	state: PlanState,
	journal: JournalEvent[],
	thresholdMs: number = DEFAULT_HUNG_WORKSPACE_THRESHOLD_MS,
	now?: number,
): HungDetectionResult {
	const currentTime = now ?? Date.now();
	const warnings: HungWorkspaceWarning[] = [];

	for (const ws of state.workspaces.values()) {
		// Only active workspaces can be hung
		if (ws.stage !== WorkspaceStage.Active) {
			continue;
		}

		// Must have a startedAt timestamp to measure elapsed time
		if (!ws.startedAt) {
			continue;
		}

		const activeDurationMs = currentTime - ws.startedAt;

		// Check if workspace has exceeded the threshold
		if (activeDurationMs > thresholdMs) {
			// Find the last journal event for this workspace
			let lastEventTimestamp: number | null = null;
			for (let i = journal.length - 1; i >= 0; i--) {
				const event = journal[i];
				if (event.workspaceId === ws.workspaceId) {
					lastEventTimestamp = event.timestamp;
					break;
				}
			}

			warnings.push({
				workspaceId: ws.workspaceId,
				activeDurationMs,
				thresholdMs,
				lastEventTimestamp,
			});
		}
	}

	return {
		warnings,
		hasHungWorkspaces: warnings.length > 0,
	};
}

// ---------------------------------------------------------------------------
// Burn Rate Computation
// ---------------------------------------------------------------------------

/**
 * Compute token burn rate (tokens consumed per minute).
 *
 * Burn rate is defined as: totalTokensIn / elapsedMinutes.
 * Returns 0 if elapsed time is 0 or negative (no time has passed).
 *
 * @param totalTokensIn - Total input tokens consumed
 * @param startedAt - Timestamp when execution started (epoch ms)
 * @param now - Current timestamp (defaults to Date.now())
 * @returns Burn rate in tokens per minute (rounded)
 */
export function computeBurnRate(totalTokensIn: number, startedAt: number, now?: number): number {
	const currentTime = now ?? Date.now();
	const elapsedMs = currentTime - startedAt;

	if (elapsedMs <= 0) {
		return 0;
	}

	const elapsedMinutes = elapsedMs / 60_000;
	return Math.round(totalTokensIn / elapsedMinutes);
}

// ---------------------------------------------------------------------------
// Live Log Validation
// ---------------------------------------------------------------------------

/**
 * In-memory live log buffer for real-time workspace log streaming.
 *
 * Supports a sliding-window buffer of recent log lines per workspace,
 * enabling the dashboard/API to poll or stream recent log output
 * without reading from disk on every request.
 */
export class LiveLogBuffer {
	private buffers: Map<string, string[]> = new Map();
	private readonly maxLinesPerWorkspace: number;

	constructor(maxLinesPerWorkspace: number = 1000) {
		this.maxLinesPerWorkspace = maxLinesPerWorkspace;
	}

	/**
	 * Append a log line for a workspace.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param line - Log line to append
	 */
	appendLine(planExecutionId: string, workspaceId: string, line: string): void {
		const key = `${planExecutionId}:${workspaceId}`;
		let buffer = this.buffers.get(key);
		if (!buffer) {
			buffer = [];
			this.buffers.set(key, buffer);
		}
		buffer.push(line);
		// Trim to max size (keep most recent)
		if (buffer.length > this.maxLinesPerWorkspace) {
			buffer.splice(0, buffer.length - this.maxLinesPerWorkspace);
		}
	}

	/**
	 * Get recent log lines for a workspace.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param maxLines - Maximum lines to return (default: 100)
	 * @returns Array of log lines (most recent last)
	 */
	getRecentLines(planExecutionId: string, workspaceId: string, maxLines: number = 100): string[] {
		const key = `${planExecutionId}:${workspaceId}`;
		const buffer = this.buffers.get(key);
		if (!buffer) {
			return [];
		}
		return buffer.slice(-maxLines);
	}

	/**
	 * Get the total number of buffered lines for a workspace.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Number of buffered lines
	 */
	getLineCount(planExecutionId: string, workspaceId: string): number {
		const key = `${planExecutionId}:${workspaceId}`;
		return this.buffers.get(key)?.length ?? 0;
	}

	/**
	 * Clear log buffer for a specific workspace.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 */
	clear(planExecutionId: string, workspaceId: string): void {
		const key = `${planExecutionId}:${workspaceId}`;
		this.buffers.delete(key);
	}

	/**
	 * Clear all log buffers.
	 */
	clearAll(): void {
		this.buffers.clear();
	}
}

// ---------------------------------------------------------------------------
// Progress Percentage Computation
// ---------------------------------------------------------------------------

/**
 * Compute plan progress percentage from workspace states.
 *
 * Progress is the ratio of completed workspaces to total workspaces,
 * expressed as a percentage (0-100) rounded to 1 decimal place.
 *
 * @param state - Current plan state
 * @returns Progress percentage (0-100)
 */
export function computeProgressPercent(state: PlanState): number {
	const total = state.workspaces.size;
	if (total === 0) {
		return 0;
	}

	let completed = 0;
	for (const ws of state.workspaces.values()) {
		if (ws.stage === WorkspaceStage.Complete) {
			completed++;
		}
	}

	return Math.round((completed / total) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Stability Report
// ---------------------------------------------------------------------------

/**
 * Stability report for a plan execution.
 *
 * Provides a structured summary of plan execution health for
 * the cockpit dashboard, including progress, burn rate, hung
 * workspaces, resume confidence, and an overall assessment.
 */
export interface StabilityReport {
	/** Timestamp when the report was generated */
	generatedAt: number;
	/** Plan phase identifier */
	planPhase: string;
	/** Plan title */
	planTitle: string;
	/** Plan status */
	planStatus: string;
	/** Total workspace count */
	totalWorkspaces: number;
	/** Completed workspace count */
	completedWorkspaces: number;
	/** Failed workspace count */
	failedWorkspaces: number;
	/** Active workspace count */
	activeWorkspaces: number;
	/** Blocked workspace count */
	blockedWorkspaces: number;
	/** Pending workspace count */
	pendingWorkspaces: number;
	/** Progress percentage (0-100) */
	progressPercent: number;
	/** Token burn rate (tokens/minute), 0 if unavailable */
	burnRatePerMin: number;
	/** Total input tokens consumed */
	totalTokensIn: number;
	/** Elapsed time in minutes */
	elapsedMinutes: number;
	/** Workspace IDs flagged as hung */
	hungWorkspaces: string[];
	/** Resume confidence result (null if plan was never resumed) */
	resumeConfidence: ResumeConfidenceResult | null;
	/** Overall health assessment */
	health: StabilityHealth;
	/** Human-readable summary */
	summary: string;
}

/**
 * Overall stability health assessment.
 */
export enum StabilityHealth {
	/** Plan is proceeding normally */
	Healthy = "healthy",
	/** Minor issues detected (e.g., one hung workspace, near stall) */
	Warning = "warning",
	/** Significant issues detected (e.g., multiple hung workspaces, stalled) */
	Critical = "critical",
}

/**
 * Options for generating a stability report.
 */
export interface StabilityReportOptions {
	/** Total input tokens consumed (default: 0 if not available) */
	totalTokensIn?: number;
	/** Hung workspace detection threshold in ms (default: 10 min) */
	hungThresholdMs?: number;
	/** Resume confidence configuration */
	resumeConfidenceConfig?: Partial<ResumeConfidenceConfig>;
	/** Current timestamp (defaults to Date.now()) */
	now?: number;
}

/**
 * Generate a stability report for a plan execution.
 *
 * Aggregates all execution visibility data into a structured report
 * including progress, burn rate, hung workspaces, resume confidence,
 * and an overall health assessment.
 *
 * @param state - Current plan state
 * @param journal - Journal events
 * @param options - Report generation options
 * @returns Stability report
 */
export function generateStabilityReport(
	state: PlanState,
	journal: JournalEvent[],
	options: StabilityReportOptions = {},
): StabilityReport {
	const currentTime = options.now ?? Date.now();
	const totalTokensIn = options.totalTokensIn ?? 0;

	// Count workspaces by stage
	let completedWorkspaces = 0;
	let failedWorkspaces = 0;
	let activeWorkspaces = 0;
	let blockedWorkspaces = 0;
	let pendingWorkspaces = 0;

	for (const ws of state.workspaces.values()) {
		switch (ws.stage) {
			case WorkspaceStage.Complete:
				completedWorkspaces++;
				break;
			case WorkspaceStage.Failed:
				failedWorkspaces++;
				break;
			case WorkspaceStage.Active:
				activeWorkspaces++;
				break;
			case WorkspaceStage.Blocked:
				blockedWorkspaces++;
				break;
			case WorkspaceStage.Pending:
				pendingWorkspaces++;
				break;
		}
	}

	const totalWorkspaces = state.workspaces.size;
	const progressPercent = computeProgressPercent(state);

	// Compute elapsed time
	const elapsedMs = Math.max(0, currentTime - state.startedAt);
	const elapsedMinutes = elapsedMs / 60_000;

	// Compute burn rate
	const burnRatePerMin = computeBurnRate(totalTokensIn, state.startedAt, currentTime);

	// Detect hung workspaces
	const hungResult = detectHungWorkspaces(state, journal, options.hungThresholdMs, currentTime);
	const hungWorkspaces = hungResult.warnings.map((w) => w.workspaceId);

	// Evaluate resume confidence
	const resumeConfidence = evaluateResumeConfidence(state, journal, options.resumeConfidenceConfig);
	// If never resumed, null out the resume confidence in the report
	const resumeConfidenceForReport = resumeConfidence.resumedAt > 0 ? resumeConfidence : null;

	// Determine overall health
	const health = assessHealth(hungResult, resumeConfidenceForReport, failedWorkspaces, activeWorkspaces);

	// Build summary
	const summary = buildStabilitySummary(
		progressPercent,
		burnRatePerMin,
		hungWorkspaces,
		resumeConfidenceForReport,
		failedWorkspaces,
		health,
	);

	return {
		generatedAt: currentTime,
		planPhase: state.phase,
		planTitle: state.title,
		planStatus: state.status,
		totalWorkspaces,
		completedWorkspaces,
		failedWorkspaces,
		activeWorkspaces,
		blockedWorkspaces,
		pendingWorkspaces,
		progressPercent,
		burnRatePerMin,
		totalTokensIn,
		elapsedMinutes: Math.round(elapsedMinutes * 100) / 100,
		hungWorkspaces,
		resumeConfidence: resumeConfidenceForReport,
		health,
		summary,
	};
}

/**
 * Assess overall stability health from various signals.
 *
 * @param hungResult - Hung workspace detection result
 * @param resumeConfidence - Resume confidence result (null if never resumed)
 * @param failedWorkspaces - Number of failed workspaces
 * @param activeWorkspaces - Number of active workspaces
 * @returns Overall health assessment
 */
export function assessHealth(
	hungResult: HungDetectionResult,
	resumeConfidence: ResumeConfidenceResult | null,
	failedWorkspaces: number,
	activeWorkspaces: number,
): StabilityHealth {
	// Critical: multiple hung workspaces or unsafe resume confidence
	if (hungResult.warnings.length >= 2) {
		return StabilityHealth.Critical;
	}

	if (resumeConfidence?.state === "unsafe") {
		return StabilityHealth.Critical;
	}

	if (failedWorkspaces > 0 && activeWorkspaces === 0) {
		return StabilityHealth.Critical;
	}

	// Warning: single hung workspace or stalled resume confidence
	if (hungResult.hasHungWorkspaces) {
		return StabilityHealth.Warning;
	}

	if (resumeConfidence?.state === "stalled") {
		return StabilityHealth.Warning;
	}

	// Otherwise healthy
	return StabilityHealth.Healthy;
}

/**
 * Build a human-readable stability summary.
 *
 * @param progressPercent - Plan progress percentage
 * @param burnRatePerMin - Token burn rate per minute
 * @param hungWorkspaces - IDs of hung workspaces
 * @param resumeConfidence - Resume confidence result
 * @param failedWorkspaces - Number of failed workspaces
 * @param health - Overall health assessment
 * @returns Summary string
 */
function buildStabilitySummary(
	progressPercent: number,
	burnRatePerMin: number,
	hungWorkspaces: string[],
	resumeConfidence: ResumeConfidenceResult | null,
	failedWorkspaces: number,
	health: StabilityHealth,
): string {
	const parts: string[] = [];

	parts.push(`Progress: ${progressPercent}%`);
	parts.push(`Burn rate: ${burnRatePerMin} tokens/min`);
	parts.push(`Health: ${health}`);

	if (hungWorkspaces.length > 0) {
		parts.push(`HUNG: ${hungWorkspaces.join(", ")}`);
	}

	if (resumeConfidence) {
		parts.push(`Resume: ${resumeConfidence.state} (${resumeConfidence.newEventCount} new events)`);
	}

	if (failedWorkspaces > 0) {
		parts.push(`Failed: ${failedWorkspaces} workspace(s)`);
	}

	return parts.join(" | ");
}

/**
 * Format a stability report for terminal display.
 *
 * @param report - Stability report
 * @returns Formatted multi-line string
 */
export function formatStabilityReport(report: StabilityReport): string {
	const lines: string[] = [];

	lines.push("=== P4.6 Stability Report ===");
	lines.push("");
	lines.push(`Plan: ${report.planPhase} — ${report.planTitle}`);
	lines.push(`Status: ${report.planStatus}`);
	lines.push(
		`Progress: ${report.progressPercent}% (${report.completedWorkspaces}/${report.totalWorkspaces} complete)`,
	);
	lines.push(
		`Active: ${report.activeWorkspaces} | Pending: ${report.pendingWorkspaces} | Blocked: ${report.blockedWorkspaces} | Failed: ${report.failedWorkspaces}`,
	);
	lines.push(
		`Burn rate: ${report.burnRatePerMin} tokens/min (${report.totalTokensIn} tokens in ${report.elapsedMinutes} min)`,
	);
	lines.push(`Health: ${report.health}`);

	if (report.hungWorkspaces.length > 0) {
		lines.push("");
		lines.push(`⚠ HUNG WORKSPACES: ${report.hungWorkspaces.join(", ")}`);
	}

	if (report.resumeConfidence) {
		lines.push("");
		lines.push(`Resume confidence: ${report.resumeConfidence.state}`);
		lines.push(`  New events: ${report.resumeConfidence.newEventCount}`);
		if (report.resumeConfidence.hasStallWarning) {
			lines.push("  ⚠ STALLED: No new events after resume");
		}
		if (report.resumeConfidence.hasRerunWarning) {
			lines.push(`  ⚠ RERUN: ${report.resumeConfidence.rerunWorkspaceIds.join(", ")}`);
		}
	}

	lines.push("");
	lines.push(`Summary: ${report.summary}`);
	lines.push("");
	lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);

	return lines.join("  |  ");
}
