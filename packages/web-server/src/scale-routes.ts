/**
 * Scale Routes — Dashboard endpoints for worktree status, integration queue
 * status, merge conflicts, and scale mode readiness.
 *
 * Workspace 6.J — Dashboard scale controls and integration visibility.
 * Workspace 6.6.F — Executor-mediated queue control actions.
 *
 * Endpoints:
 *   GET  /api/scale/worktrees
 *       Returns git worktree status for all worktrees.
 *
 *   GET  /api/scale/integration-queue
 *       Returns integration queue state from .pi/integration-queue.json.
 *
 *   GET  /api/scale/queue-metrics
 *       Returns queue DAG metrics, timing, and optimizer suggestions.
 *
 *   GET  /api/scale/readiness
 *       Returns scale mode readiness (prerequisites, enabled/blocked reasons).
 *
 *   POST /api/scale/worktrees/cleanup
 *       Safely removes stale/prunable worktrees (scoped cleanup).
 *
 *   DELETE /api/scale/worktrees/:worktreeName
 *       Removes a specific worktree by name (scoped cleanup).
 *
 *   POST /api/scale/integration-queue/pause
 *       Pauses queue processing (safe, no new entries started).
 *
 *   POST /api/scale/integration-queue/resume
 *       Resumes queue processing.
 *
 *   POST /api/scale/integration-queue/retry/:workspaceId
 *       Retries a blocked, conflict, or failed entry.
 *
 *   POST /api/scale/integration-queue/requeue/:workspaceId
 *       Requeues a merged entry (with dependency safety check).
 *
 *   POST /api/scale/integration-queue/clear-completed
 *       Removes all completed, failed, and conflict entries.
 *
 *   POST /api/scale/integration-queue/reorder
 *       Reorders queued entries respecting dependency constraints.
 *
 *   GET  /api/scale/integration-queue/audit-log
 *       Returns audit trail of queue control actions.
 */

import { exec as execCb } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { IntegrationQueue } from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";

const execAsync = promisify(execCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of a git worktree. */
export interface WorktreeInfo {
	/** Worktree path */
	path: string;
	/** Current branch (may be "HEAD" if detached) */
	branch: string | null;
	/** Commit hash the worktree is on */
	commit: string;
	/** Whether the worktree is bare */
	bare: boolean;
	/** Whether the worktree is currently locked */
	locked: boolean;
	/** Whether the worktree has uncommitted changes (derived from git status) */
	dirty: boolean;
	/** Name derived from branch or path for display */
	name: string;
}

/** Integration queue entry status from .pi/integration-queue.json. */
export interface QueueEntryInfo {
	/** Workspace ID */
	workspaceId: string;
	/** Current queue status */
	status: string;
	/** Commit hash from the workspace branch */
	commitHash: string;
	/** Timestamp when enqueued */
	queuedAt: number;
	/** Timestamp when processing started (may be null) */
	processedAt: number | null;
	/** Whether validation passed (may be null if not yet validated) */
	validationPassed: boolean | null;
	/** Error message if processing failed (may be null) */
	error: string | null;
	/** List of conflicted files (may be null) */
	conflictFiles: string[] | null;
}

/** Integration queue status summary. */
export interface IntegrationQueueStatus {
	/** Whether the queue is currently processing an entry */
	isProcessing: boolean;
	/** Whether the queue is paused (will not process new entries) */
	paused: boolean;
	/** Workspace ID currently being processed (may be null) */
	currentWorkspaceId: string | null;
	/** All queue entries in order */
	entries: QueueEntryInfo[];
	/** Total entries in queue */
	totalEntries: number;
	/** Count of entries per status */
	counts: {
		queued: number;
		merging: number;
		validating: number;
		merged: number;
		failed: number;
		blocked: number;
		conflict: number;
	};
	/** Audit events (most recent first) */
	auditEvents: AuditEntryInfo[];
}

/** Audit event info for queue control actions. */
export interface AuditEntryInfo {
	action: "pause" | "resume" | "retry" | "requeue" | "clear_completed" | "reorder" | "cancel";
	workspaceId?: string;
	timestamp: number;
	details: string;
}

/** Result of a queue control action. */
export interface QueueControlActionResult {
	success: boolean;
	message?: string;
	error?: string;
}

/** Merge conflict details from .pi/merge-conflicts/ artifacts. */
export interface MergeConflictInfo {
	/** Workspace ID */
	workspaceId: string;
	/** List of conflicted files */
	conflictedFiles: string[];
	/** Diff of conflicted files */
	diff: string;
	/** Timestamp when conflict occurred */
	timestamp: number;
	/** Path to conflict artifact file */
	artifactPath: string;
}

/** Scale mode prerequisite status. */
export interface PrerequisiteStatus {
	key: string;
	name: string;
	met: boolean;
	message: string;
}

/** Scale mode readiness result. */
export interface ScaleModeReadiness {
	ready: boolean;
	currentMode: "stable_3" | "experimental_6" | "scale_8";
	isScaleModeActive: boolean;
	prerequisites: PrerequisiteStatus[];
	blockedReasons: string[];
	warnings: string[];
	requestedWorkers: number;
	maxAllowedWorkers: number;
}

/** Queue metrics — DAG width, worker cap, safe runnable workers, utilization, timing. */
export interface QueueMetrics {
	/** Maximum number of parallel non-conflicting branches in the DAG. */
	dagWidth: number;
	/** Maximum workers allowed (from settings). */
	workerCap: number;
	/** Number of workers that can safely run without exceeding DAG width or cap. */
	safeRunnableWorkers: number;
	/** Number of workers currently actively processing entries. */
	actualUtilization: number;
	/** Length of the longest serial dependency chain in the queue. */
	criticalPath: number;
	/** Number of entries queued behind the current processing entry. */
	serializedTail: number;
	/** Queue timing metrics when available (null if insufficient data). */
	queueTiming: {
		sampleSize: number;
		avgWaitTimeMs: number | null;
		avgProcessTimeMs: number | null;
		totalProcessed: number;
	} | null;
	/** Advisory optimizer suggestions. */
	optimizerSuggestions: OptimizerSuggestion[];
}

/** Advisory suggestion from the queue optimizer. */
export interface OptimizerSuggestion {
	type: "info" | "warning" | "tip";
	title: string;
	message: string;
}

/** Worktree cleanup result. */
export interface WorktreeCleanupResult {
	/** Number of worktrees removed */
	removed: number;
	/** Names of worktrees removed */
	removedNames: string[];
	/** Any errors during cleanup */
	errors: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse `git worktree list` output into structured worktree info.
 *
 * Git worktree list format:
 *   /path/to/worktree  commit-hash  [branch-name]
 *   /path/to/worktree  commit-hash  (detached HEAD)
 *
 * @param output - Raw stdout from `git worktree list`
 * @returns Array of worktree info objects
 */
export function parseGitWorktreeList(output: string): WorktreeInfo[] {
	const lines = output.trim().split("\n").filter(Boolean);
	return lines.map((line) => {
		const parts = line.trim().split(/\s+/);
		const path = parts[0];
		const commit = parts[1] || "";
		const rawBranch = parts.slice(2).join(" ");

		let branch: string | null = null;
		let bare = false;
		let locked = false;

		if (rawBranch === "(bare)") {
			bare = true;
		} else if (rawBranch === "(detached HEAD)") {
			branch = null;
		} else {
			// Extract lock indicator from suffix like " [locked]"
			const lockMatch = rawBranch.match(/\s+\[([^\]]+)\]$/);
			if (lockMatch) {
				locked = true;
			}

			// Remove bracketed suffix for branch name extraction
			const cleanBranch = rawBranch.replace(/\s+\[[^\]]+\]$/, "");

			if (cleanBranch.startsWith("refs/heads/")) {
				branch = cleanBranch.replace("refs/heads/", "");
			} else if (cleanBranch === "(detached HEAD)") {
				branch = null;
			}
		}

		// Derive a display name
		let name: string;
		if (branch) {
			name = branch;
		} else {
			// Use last directory component of path as name
			name = path.split("/").pop() || path;
		}

		return { path, branch, commit, bare, locked, dirty: false, name };
	});
}

/**
 * Parse integration queue JSON into structured status.
 *
 * @param jsonContent - Raw JSON content from .pi/integration-queue.json
 * @returns Parsed integration queue status
 */
export function parseIntegrationQueue(jsonContent: string): IntegrationQueueStatus {
	const raw = JSON.parse(jsonContent);

	const entries: QueueEntryInfo[] = (raw.entries ?? []).map((entry: Record<string, unknown>) => ({
		workspaceId: String(entry.workspaceId ?? ""),
		status: String(entry.status ?? "queued"),
		commitHash: String(entry.commitHash ?? ""),
		queuedAt: Number(entry.queuedAt ?? 0),
		processedAt: entry.processedAt != null ? Number(entry.processedAt) : null,
		validationPassed: entry.validationPassed != null ? Boolean(entry.validationPassed) : null,
		error: entry.error != null ? String(entry.error) : null,
		conflictFiles: entry.conflictFiles != null ? (entry.conflictFiles as string[]) : null,
	}));

	const counts = {
		queued: entries.filter((e) => e.status === "queued").length,
		merging: entries.filter((e) => e.status === "merging").length,
		validating: entries.filter((e) => e.status === "validating").length,
		merged: entries.filter((e) => e.status === "merged").length,
		failed: entries.filter((e) => e.status === "failed").length,
		blocked: entries.filter((e) => e.status === "blocked").length,
		conflict: entries.filter((e) => e.status === "conflict").length,
	};

	const auditEvents: AuditEntryInfo[] = (raw.auditEvents ?? []).map((event: Record<string, unknown>) => ({
		action: String(event.action) as AuditEntryInfo["action"],
		workspaceId: event.workspaceId != null ? String(event.workspaceId) : undefined,
		timestamp: Number(event.timestamp ?? 0),
		details: String(event.details ?? ""),
	}));

	return {
		isProcessing: Boolean(raw.isProcessing ?? false),
		paused: Boolean(raw.paused ?? false),
		currentWorkspaceId: raw.currentWorkspaceId != null ? String(raw.currentWorkspaceId) : null,
		entries,
		totalEntries: entries.length,
		counts,
		auditEvents,
	};
}

/**
 * Parse merge conflict artifact file content.
 *
 * @param workspaceId - Workspace ID
 * @param content - Raw content of the conflict artifact file
 * @returns Parsed merge conflict info or null if parsing fails
 */
export function parseMergeConflictArtifact(workspaceId: string, content: string): MergeConflictInfo | null {
	try {
		const data = JSON.parse(content);
		return {
			workspaceId,
			conflictedFiles: data.conflictedFiles ?? [],
			diff: data.diff ?? "",
			timestamp: data.timestamp ?? 0,
			artifactPath: data.artifactPath ?? "",
		};
	} catch {
		return null;
	}
}

/**
 * Parse merge conflict artifacts from a directory listing.
 *
 * @param conflictDir - Path to the merge-conflicts directory
 * @returns Array of merge conflict info
 */
export async function collectMergeConflicts(conflictDir: string): Promise<MergeConflictInfo[]> {
	const conflicts: MergeConflictInfo[] = [];
	if (!existsSync(conflictDir)) return conflicts;

	try {
		const files = await readdir(conflictDir);
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const filePath = join(conflictDir, file);
			const content = await readFile(filePath, "utf-8");
			// Workspace ID is the file name without extension
			const workspaceId = file.replace(/\.json$/i, "");
			const parsed = parseMergeConflictArtifact(workspaceId, content);
			if (parsed) {
				parsed.artifactPath = filePath;
				conflicts.push(parsed);
			}
		}
	} catch {
		// Directory read failed, return empty
	}

	return conflicts;
}

/**
 * Check if a worktree can be safely pruned.
 *
 * A worktree is safe to prune if:
 * - It is not the main working tree (not at workspace root)
 * - It has no uncommitted changes (not dirty)
 * - It is not currently processing (no matching integration queue entry in merging/validating)
 *
 * @param worktree - Worktree info
 * @param activeQueueWorkspaceIds - Set of workspace IDs currently active in the integration queue
 * @returns True if the worktree can be safely pruned
 */
export function isWorktreeSafeToPrune(worktree: WorktreeInfo, activeQueueWorkspaceIds: Set<string>): boolean {
	if (worktree.bare) return false;
	if (worktree.dirty) return false;
	if (worktree.locked) return false;
	if (worktree.name.startsWith(".")) return false;
	const nameLower = worktree.name.toLowerCase();
	if (nameLower === "main" || nameLower === "master" || nameLower === "primary") return false;
	if (activeQueueWorkspaceIds.has(worktree.name)) return false;
	return true;
}

/**
 * Build scale mode readiness from settings and worker count.
 *
 * @param settings - Object with worktree isolation, integration queue, and validation lock booleans
 * @param requestedWorkers - Requested number of workers
 * @param experimentalModeEnabled - Whether experimental/scale mode is enabled
 * @returns Scale mode readiness result
 */
export function buildScaleModeReadiness(
	settings: {
		worktreeIsolationEnabled: boolean;
		integrationQueueEnabled: boolean;
		validationLockEnabled: boolean;
	},
	requestedWorkers: number,
	experimentalModeEnabled: boolean,
): ScaleModeReadiness {
	const MIN_STABLE = 1;
	const MAX_STABLE = 3;
	const MIN_EXPERIMENTAL = 4;
	const MAX_EXPERIMENTAL = 6;
	const MIN_SCALE = 7;
	const MAX_SCALE = 8;

	const blockedReasons: string[] = [];
	const warnings: string[] = [];

	const workers = Math.max(MIN_STABLE, Math.min(MAX_SCALE, requestedWorkers));

	let currentMode: "stable_3" | "experimental_6" | "scale_8";
	let isScaleModeActive: boolean;

	if (workers >= MIN_EXPERIMENTAL && workers <= MAX_EXPERIMENTAL && experimentalModeEnabled) {
		currentMode = "experimental_6";
		isScaleModeActive = true;
	} else if (workers >= MIN_SCALE && workers <= MAX_SCALE && experimentalModeEnabled) {
		currentMode = "scale_8";
		isScaleModeActive = true;
	} else {
		currentMode = "stable_3";
		isScaleModeActive = false;
	}

	const prerequisites: PrerequisiteStatus[] = [
		{
			key: "worktree_isolation",
			name: "Worktree Isolation",
			met: settings.worktreeIsolationEnabled,
			message: settings.worktreeIsolationEnabled
				? "Worktree isolation is enabled — workers run in isolated git worktrees"
				: "Worktree isolation is disabled — file conflicts may occur with concurrent workers",
		},
		{
			key: "integration_queue",
			name: "Integration Queue",
			met: settings.integrationQueueEnabled,
			message: settings.integrationQueueEnabled
				? "Integration queue is enabled — workspace changes are merged serially"
				: "Integration queue is disabled — without serial merge, concurrent changes may conflict",
		},
		{
			key: "validation_lock",
			name: "Global Validation Lock",
			met: settings.validationLockEnabled,
			message: settings.validationLockEnabled
				? "Global validation lock is enabled — validation commands are serialized"
				: "Global validation lock is disabled — concurrent validation may cause conflicts",
		},
	];

	if (isScaleModeActive) {
		const unmet = prerequisites.filter((p) => !p.met);
		for (const prereq of unmet) {
			blockedReasons.push(`Scale mode requires "${prereq.name}" to be enabled. ${prereq.message}`);
		}
	}

	if (!isScaleModeActive && prerequisites.every((p) => p.met) && workers <= MAX_STABLE) {
		warnings.push(
			`All scale mode prerequisites are met, but worker count (${workers}) is within stable range (1-3). ` +
				"Increase worker count to 4-8 to enable scale mode.",
		);
	}

	if (experimentalModeEnabled && !isScaleModeActive) {
		warnings.push(
			`Scale/experimental mode is enabled but worker count (${workers}) is within stable range (1-3). ` +
				"The flag has no effect at this worker count.",
		);
	}

	const ready = !isScaleModeActive || blockedReasons.length === 0;

	return {
		ready,
		currentMode,
		isScaleModeActive,
		prerequisites,
		blockedReasons,
		warnings,
		requestedWorkers,
		maxAllowedWorkers: MAX_SCALE,
	};
}

// ---------------------------------------------------------------------------
// Queue metrics computation
// ---------------------------------------------------------------------------

/**
 * Compute queue metrics from integration queue entries and settings.
 *
 * @param entries - Parsed queue entries
 * @param isProcessing - Whether the queue is processing
 * @param currentWorkspaceId - Current processing workspace ID
 * @param workerCap - Maximum workers configured
 * @returns Computed queue metrics
 */
export function computeQueueMetrics(
	entries: QueueEntryInfo[],
	isProcessing: boolean,
	currentWorkspaceId: string | null,
	workerCap: number,
): QueueMetrics {
	// ── DAG width: max non-conflicting branches ──
	// Count entries that are not in terminal states (merged/failed) — these
	// are potentially runnable. DAG width is bounded by worker cap.
	const activeEntries = entries.filter((e) => e.status !== "merged" && e.status !== "failed");
	const dagWidth = Math.min(activeEntries.length, workerCap);

	// ── Actual utilization ──
	const actualUtilization = entries.filter((e) => e.status === "merging" || e.status === "validating").length;

	// ── Safe runnable workers: min(worker cap, DAG width) ──
	const safeRunnableWorkers = Math.min(workerCap, dagWidth);

	// ── Critical path: longest serial chain ──
	// In a serial queue, the critical path is the number of entries that must
	// be processed end-to-end. Non-terminal entries define the current run.
	const criticalPath = isProcessing ? activeEntries.length : entries.length;

	// ── Serialized tail: entries blocked behind current ──
	// Count queued entries after the current workspace.
	let serializedTail = 0;
	if (isProcessing && currentWorkspaceId) {
		const currentIndex = entries.findIndex((e) => e.workspaceId === currentWorkspaceId);
		if (currentIndex >= 0) {
			serializedTail = entries.length - currentIndex - 1;
		}
	} else if (entries.length > 0 && !isProcessing) {
		serializedTail = entries.length; // all entries are waiting
	}

	// ── Queue timing metrics ──
	// Compute from processed entries (merged/failed) that have timing data.
	const processedEntries = entries.filter(
		(e) =>
			(e.status === "merged" || e.status === "failed") &&
			e.processedAt != null &&
			e.queuedAt > 0 &&
			e.processedAt > e.queuedAt,
	);

	let queueTiming: QueueMetrics["queueTiming"] = null;
	if (processedEntries.length > 0) {
		const waitTimes: number[] = [];
		const processTimes: number[] = [];

		for (const entry of processedEntries) {
			// Wait time: queuedAt -> processedAt (when processing started)
			// For failed entries, processedAt is the failure timestamp.
			const waitMs = entry.processedAt! - entry.queuedAt;
			if (waitMs > 0) waitTimes.push(waitMs);

			// Process time: we don't have a completion timestamp separate from
			// processedAt in the current schema. Use fallback logic:
			// If validationPassed is known, estimate process time as half of
			// the total duration (conservative heuristic).
			if (entry.validationPassed != null) {
				// For entries with validation results, processedAt represents
				// completion, so total duration = processedAt - queuedAt.
				// Process time is a subset of total time.
				const totalMs = entry.processedAt! - entry.queuedAt;
				// Rough estimate: processing takes at least 10% of total time
				const estProcessMs = Math.max(totalMs * 0.3, 1000);
				processTimes.push(estProcessMs);
			}
		}

		queueTiming = {
			sampleSize: processedEntries.length,
			avgWaitTimeMs:
				waitTimes.length > 0 ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : null,
			avgProcessTimeMs:
				processTimes.length > 0 ? Math.round(processTimes.reduce((a, b) => a + b, 0) / processTimes.length) : null,
			totalProcessed: processedEntries.length,
		};
	}

	// ── Optimizer suggestions ──
	const optimizerSuggestions: OptimizerSuggestion[] = [];

	// 1. If there are many queued entries and low worker cap, suggest increasing workers
	if (entries.length > 3 && workerCap < 6 && dagWidth > workerCap) {
		optimizerSuggestions.push({
			type: "tip",
			title: "Increase worker concurrency",
			message:
				`The queue has ${entries.length} entries but worker cap is ${workerCap}. ` +
				`DAG analysis suggests up to ${dagWidth} workers could run in parallel. ` +
				"Consider increasing maxWorkers in Scale & Safety settings.",
		});
	}

	// 2. If there are blocked/conflict entries, suggest resolution
	const blockedCount = entries.filter((e) => e.status === "blocked").length;
	const conflictCount = entries.filter((e) => e.status === "conflict").length;
	if (blockedCount > 0 || conflictCount > 0) {
		const total = blockedCount + conflictCount;
		optimizerSuggestions.push({
			type: "warning",
			title: `Resolve ${total} blocking issue${total !== 1 ? "s" : ""}`,
			message:
				`${blockedCount} blocked and ${conflictCount} conflict entries are blocking the queue. ` +
				"Resolve these before adding more workers yields benefits.",
		});
	}

	// 3. If actual utilization is far below safe runnable, note underutilization
	if (actualUtilization < safeRunnableWorkers && safeRunnableWorkers > 1) {
		optimizerSuggestions.push({
			type: "info",
			title: "Workers are underutilized",
			message:
				`Only ${actualUtilization} of ${safeRunnableWorkers} safe runnable workers are active. ` +
				"This may indicate dependencies between queued entries that limit parallelism.",
		});
	}

	// 4. If the queue is empty, no suggestions needed
	if (entries.length === 0) {
		optimizerSuggestions.push({
			type: "info",
			title: "Queue is empty",
			message: "No entries in the integration queue. Suggestions will appear when workspace changes are queued.",
		});
	}

	// 5. Timing insight if available
	if (queueTiming && queueTiming.avgProcessTimeMs != null && queueTiming.sampleSize >= 2) {
		const avgProcessSec = Math.round(queueTiming.avgProcessTimeMs / 1000);
		const totalQueueTime = criticalPath * avgProcessSec;
		if (totalQueueTime > 120) {
			optimizerSuggestions.push({
				type: "warning",
				title: `Estimated queue time: ${totalQueueTime}s`,
				message:
					`Based on ${queueTiming.sampleSize} processed entries (avg ${avgProcessSec}s each), ` +
					`the queue may take ~${totalQueueTime}s to drain. Consider batching workspace changes.`,
			});
		}
	}

	return {
		dagWidth,
		workerCap,
		safeRunnableWorkers,
		actualUtilization,
		criticalPath,
		serializedTail,
		queueTiming,
		optimizerSuggestions,
	};
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register scale dashboard routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param getPiDir - Function that returns the .pi directory path
 * @param getWorkspaceRoot - Function that returns the workspace root path
 * @param getSettingsManager - Function that returns the settings manager
 */
export async function registerScaleRoutes(
	fastify: FastifyInstance,
	getPiDir: () => string,
	getWorkspaceRoot: () => string,
	getSettingsManager: () => SettingsManager,
): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /api/scale/worktrees — list worktree status
	// -----------------------------------------------------------------------

	fastify.get("/api/scale/worktrees", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const { stdout } = await execAsync("git worktree list", {
				cwd: workspaceRoot,
				encoding: "utf-8",
				timeout: 10000,
			});

			const worktrees = parseGitWorktreeList(stdout);

			// Check dirty status for each worktree
			for (const wt of worktrees) {
				try {
					const { stdout: statusOut } = await execAsync("git status --porcelain", {
						cwd: wt.path,
						encoding: "utf-8",
						timeout: 5000,
					});
					wt.dirty = statusOut.trim().length > 0;
				} catch {
					wt.dirty = false;
				}
			}

			return { worktrees, total: worktrees.length };
		} catch (error) {
			fastify.log.error({ error }, "Failed to get worktree list");
			return reply.code(500).send({
				error: "Failed to get worktree list",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/scale/integration-queue — list integration queue status
	// -----------------------------------------------------------------------

	fastify.get("/api/scale/integration-queue", async (_request, reply) => {
		try {
			const piDir = getPiDir();
			const queuePath = join(piDir, "integration-queue.json");

			if (!existsSync(queuePath)) {
				return {
					isProcessing: false,
					currentWorkspaceId: null,
					entries: [],
					totalEntries: 0,
					counts: {
						queued: 0,
						merging: 0,
						validating: 0,
						merged: 0,
						failed: 0,
						blocked: 0,
						conflict: 0,
					},
				};
			}

			const content = await readFile(queuePath, "utf-8");
			const status = parseIntegrationQueue(content);

			// Collect merge conflict details from artifacts
			const conflictDir = join(piDir, "merge-conflicts");
			const conflicts = await collectMergeConflicts(conflictDir);

			return { ...status, mergeConflicts: conflicts };
		} catch (error) {
			fastify.log.error({ error }, "Failed to get integration queue");
			return reply.code(500).send({
				error: "Failed to get integration queue",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/scale/queue-metrics — queue DAG metrics and optimizer suggestions
	// -----------------------------------------------------------------------

	fastify.get("/api/scale/queue-metrics", async (_request, reply) => {
		try {
			const piDir = getPiDir();
			const queuePath = join(piDir, "integration-queue.json");

			let entries: QueueEntryInfo[] = [];
			let isProcessing = false;
			let currentWorkspaceId: string | null = null;

			if (existsSync(queuePath)) {
				const content = await readFile(queuePath, "utf-8");
				const queue = parseIntegrationQueue(content);
				entries = queue.entries;
				isProcessing = queue.isProcessing;
				currentWorkspaceId = queue.currentWorkspaceId;
			}

			// Get worker cap from settings
			const settingsMgr = getSettingsManager();
			const settings = settingsMgr.getMergedSettings() as Record<string, unknown>;
			const workerConcurrency = (settings.workerConcurrency as Record<string, unknown>) ?? {};
			const workerCap = Number(workerConcurrency.maxWorkers ?? 3);

			const metrics = computeQueueMetrics(entries, isProcessing, currentWorkspaceId, workerCap);

			return metrics;
		} catch (error) {
			fastify.log.error({ error }, "Failed to compute queue metrics");
			return reply.code(500).send({
				error: "Failed to compute queue metrics",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/scale/readiness — check scale mode readiness
	// -----------------------------------------------------------------------

	fastify.get("/api/scale/readiness", async (_request, reply) => {
		try {
			const settingsMgr = getSettingsManager();
			const settings = settingsMgr.getMergedSettings() as Record<string, unknown>;

			const workerConcurrency = (settings.workerConcurrency as Record<string, unknown>) ?? {};
			const requestedWorkers = Number(workerConcurrency.maxWorkers ?? 3);
			const experimentalModeEnabled = Boolean(workerConcurrency.experimentalModeEnabled ?? false);

			// Read actual flag status from settings (no hardcoded default true —
			// only report enabled if explicitly configured).
			const worktreeIsolationEnabled = Boolean(
				(settings.scale as Record<string, unknown>)?.worktreeIsolationEnabled ?? false,
			);
			const integrationQueueEnabled = Boolean(
				(settings.scale as Record<string, unknown>)?.integrationQueueEnabled ?? false,
			);
			const validationLockEnabled = Boolean(
				(settings.scale as Record<string, unknown>)?.validationLockEnabled ?? false,
			);

			const readiness = buildScaleModeReadiness(
				{ worktreeIsolationEnabled, integrationQueueEnabled, validationLockEnabled },
				requestedWorkers,
				experimentalModeEnabled,
			);

			return {
				...readiness,
				experimentalModeEnabled,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to check scale mode readiness");
			return reply.code(500).send({
				error: "Failed to check scale mode readiness",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/scale/worktrees/cleanup — safely prune stale worktrees
	// -----------------------------------------------------------------------

	fastify.post("/api/scale/worktrees/cleanup", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const result: WorktreeCleanupResult = { removed: 0, removedNames: [], errors: [] };

			// Get active worktrees
			let worktrees: WorktreeInfo[];
			try {
				const { stdout } = await execAsync("git worktree list", {
					cwd: workspaceRoot,
					encoding: "utf-8",
					timeout: 10000,
				});
				worktrees = parseGitWorktreeList(stdout);
			} catch (e) {
				return reply.code(500).send({
					error: "Failed to list worktrees",
					message: String(e),
				});
			}

			// Get active integration queue workspace IDs
			const activeQueueIds = new Set<string>();
			const piDir = getPiDir();
			const queuePath = join(piDir, "integration-queue.json");
			if (existsSync(queuePath)) {
				try {
					const content = await readFile(queuePath, "utf-8");
					const queue = parseIntegrationQueue(content);
					for (const entry of queue.entries) {
						if (entry.status === "merging" || entry.status === "validating") {
							activeQueueIds.add(entry.workspaceId);
						}
					}
				} catch {
					// Ignore parse errors
				}
			}

			for (const wt of worktrees) {
				// Skip main worktree
				if (wt.path === workspaceRoot || wt.path === join(workspaceRoot, ".git")) continue;

				if (isWorktreeSafeToPrune(wt, activeQueueIds)) {
					try {
						await execAsync(`git worktree remove "${wt.path}"`, {
							cwd: workspaceRoot,
							encoding: "utf-8",
							timeout: 30000,
						});
						result.removed++;
						result.removedNames.push(wt.name);
					} catch (e) {
						result.errors.push(`Failed to remove worktree "${wt.name}": ${String(e)}`);
					}
				}
			}

			return result;
		} catch (error) {
			fastify.log.error({ error }, "Failed to cleanup worktrees");
			return reply.code(500).send({
				error: "Failed to cleanup worktrees",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// DELETE /api/scale/worktrees/:worktreeName — remove a specific worktree
	// -----------------------------------------------------------------------

	fastify.delete<{
		Params: { worktreeName: string };
	}>("/api/scale/worktrees/:worktreeName", async (request, reply) => {
		try {
			const { worktreeName } = request.params;
			const workspaceRoot = getWorkspaceRoot();

			// Find the worktree by name
			const { stdout } = await execAsync("git worktree list", {
				cwd: workspaceRoot,
				encoding: "utf-8",
				timeout: 10000,
			});
			const worktrees = parseGitWorktreeList(stdout);
			const target = worktrees.find(
				(wt) => wt.name === worktreeName && wt.path !== workspaceRoot && wt.path !== join(workspaceRoot, ".git"),
			);

			if (!target) {
				return reply.code(404).send({
					error: `Worktree "${worktreeName}" not found or is the main working tree`,
				});
			}

			await execAsync(`git worktree remove "${target.path}"`, {
				cwd: workspaceRoot,
				encoding: "utf-8",
				timeout: 30000,
			});

			return { success: true, removed: worktreeName, path: target.path };
		} catch (error) {
			fastify.log.error({ error }, "Failed to remove worktree");
			return reply.code(500).send({
				error: "Failed to remove worktree",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// 6.6.F: Executor-mediated queue control actions
	// -----------------------------------------------------------------------

	// -----------------------------------------------------------------------
	// POST /api/scale/integration-queue/pause — pause queue processing
	// -----------------------------------------------------------------------

	fastify.post("/api/scale/integration-queue/pause", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const queue = new IntegrationQueue(workspaceRoot);

			const validation = await queue.validateAction("pause");
			if (!validation.safe) {
				return reply.code(422).send({
					success: false,
					error: validation.errors.join("; "),
				});
			}

			await queue.pause();
			return { success: true, message: "Queue processing paused" };
		} catch (error) {
			fastify.log.error({ error }, "Failed to pause integration queue");
			return reply.code(500).send({
				success: false,
				error: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/scale/integration-queue/resume — resume queue processing
	// -----------------------------------------------------------------------

	fastify.post("/api/scale/integration-queue/resume", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const queue = new IntegrationQueue(workspaceRoot);

			const validation = await queue.validateAction("resume");
			if (!validation.safe) {
				return reply.code(422).send({
					success: false,
					error: validation.errors.join("; "),
				});
			}

			await queue.resume();
			return { success: true, message: "Queue processing resumed" };
		} catch (error) {
			fastify.log.error({ error }, "Failed to resume integration queue");
			return reply.code(500).send({
				success: false,
				error: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/scale/integration-queue/retry/:workspaceId — retry an entry
	// -----------------------------------------------------------------------

	fastify.post<{ Params: { workspaceId: string } }>(
		"/api/scale/integration-queue/retry/:workspaceId",
		async (request, reply) => {
			try {
				const { workspaceId } = request.params;
				const workspaceRoot = getWorkspaceRoot();
				const queue = new IntegrationQueue(workspaceRoot);

				const validation = await queue.validateAction("retry", workspaceId);
				if (!validation.safe) {
					return reply.code(422).send({
						success: false,
						error: validation.errors.join("; "),
					});
				}

				await queue.retryEntry(workspaceId);
				return { success: true, message: `Entry "${workspaceId}" retried` };
			} catch (error) {
				fastify.log.error({ error }, "Failed to retry entry");
				return reply.code(500).send({
					success: false,
					error: String(error),
				});
			}
		},
	);

	// -----------------------------------------------------------------------
	// POST /api/scale/integration-queue/requeue/:workspaceId — requeue merged
	// -----------------------------------------------------------------------

	fastify.post<{ Params: { workspaceId: string } }>(
		"/api/scale/integration-queue/requeue/:workspaceId",
		async (request, reply) => {
			try {
				const { workspaceId } = request.params;
				const workspaceRoot = getWorkspaceRoot();
				const queue = new IntegrationQueue(workspaceRoot);

				const validation = await queue.validateAction("requeue", workspaceId);
				if (!validation.safe) {
					return reply.code(422).send({
						success: false,
						error: validation.errors.join("; "),
					});
				}

				await queue.requeueEntry(workspaceId);
				return { success: true, message: `Entry "${workspaceId}" requeued` };
			} catch (error) {
				fastify.log.error({ error }, "Failed to requeue entry");
				return reply.code(500).send({
					success: false,
					error: String(error),
				});
			}
		},
	);

	// -----------------------------------------------------------------------
	// POST /api/scale/integration-queue/clear-completed
	// -----------------------------------------------------------------------

	fastify.post("/api/scale/integration-queue/clear-completed", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const queue = new IntegrationQueue(workspaceRoot);

			const validation = await queue.validateAction("clear_completed");
			if (!validation.safe) {
				return reply.code(422).send({
					success: false,
					error: validation.errors.join("; "),
				});
			}

			await queue.clearCompleted();
			return { success: true, message: "Completed entries cleared from queue" };
		} catch (error) {
			fastify.log.error({ error }, "Failed to clear completed entries");
			return reply.code(500).send({
				success: false,
				error: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// POST /api/scale/integration-queue/reorder — reorder respecting deps
	// -----------------------------------------------------------------------

	fastify.post("/api/scale/integration-queue/reorder", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const queue = new IntegrationQueue(workspaceRoot);

			const validation = await queue.validateAction("reorder");
			if (!validation.safe) {
				return reply.code(422).send({
					success: false,
					error: validation.errors.join("; "),
				});
			}

			const result = await queue.applyOptimizerOrdering();
			return {
				success: true,
				optimized: result.optimized,
				message: result.optimized ? "Queue reordered for optimal throughput" : "Queue is already in optimal order",
				throughputImpact: result.throughputImpact,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to reorder queue");
			return reply.code(500).send({
				success: false,
				error: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/scale/integration-queue/audit-log — audit trail
	// -----------------------------------------------------------------------

	fastify.get("/api/scale/integration-queue/audit-log", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const queue = new IntegrationQueue(workspaceRoot);
			const auditLog = await queue.getAuditLog();
			return {
				entries: auditLog,
				total: auditLog.length,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to get audit log");
			return reply.code(500).send({
				error: "Failed to get audit log",
				message: String(error),
			});
		}
	});
}
