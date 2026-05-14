/**
 * Scale Routes — Dashboard endpoints for worktree status, integration queue
 * status, merge conflicts, and scale mode readiness.
 *
 * Workspace 6.J — Dashboard scale controls and integration visibility.
 *
 * Endpoints:
 *   GET  /api/scale/worktrees
 *       Returns git worktree status for all worktrees.
 *
 *   GET  /api/scale/integration-queue
 *       Returns integration queue state from .pi/integration-queue.json.
 *
 *   GET  /api/scale/readiness
 *       Returns scale mode readiness (prerequisites, enabled/blocked reasons).
 *
 *   POST /api/scale/worktrees/cleanup
 *       Safely removes stale/prunable worktrees (scoped cleanup).
 *
 *   DELETE /api/scale/worktrees/:worktreeName
 *       Removes a specific worktree by name (scoped cleanup).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";

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

	return {
		isProcessing: Boolean(raw.isProcessing ?? false),
		currentWorkspaceId: raw.currentWorkspaceId != null ? String(raw.currentWorkspaceId) : null,
		entries,
		totalEntries: entries.length,
		counts,
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

	const { readdir } = await import("node:fs/promises");
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
			const output = execSync("git worktree list", {
				cwd: workspaceRoot,
				encoding: "utf-8",
				timeout: 10000,
			});

			const worktrees = parseGitWorktreeList(output);

			// Check dirty status for each worktree
			for (const wt of worktrees) {
				try {
					const statusOut = execSync("git status --porcelain", {
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
	// GET /api/scale/readiness — check scale mode readiness
	// -----------------------------------------------------------------------

	fastify.get("/api/scale/readiness", async (_request, reply) => {
		try {
			const settingsMgr = getSettingsManager();
			const settings = settingsMgr.getMergedSettings() as Record<string, unknown>;

			const workerConcurrency = (settings.workerConcurrency as Record<string, unknown>) ?? {};
			const requestedWorkers = Number(workerConcurrency.maxWorkers ?? 3);
			const experimentalModeEnabled = Boolean(workerConcurrency.experimentalModeEnabled ?? false);

			// Read prerequisite flags from settings
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
				const output = execSync("git worktree list", {
					cwd: workspaceRoot,
					encoding: "utf-8",
					timeout: 10000,
				});
				worktrees = parseGitWorktreeList(output);
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
						execSync(`git worktree remove "${wt.path}"`, {
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
			const output = execSync("git worktree list", {
				cwd: workspaceRoot,
				encoding: "utf-8",
				timeout: 10000,
			});
			const worktrees = parseGitWorktreeList(output);
			const target = worktrees.find(
				(wt) => wt.name === worktreeName && wt.path !== workspaceRoot && wt.path !== join(workspaceRoot, ".git"),
			);

			if (!target) {
				return reply.code(404).send({
					error: `Worktree "${worktreeName}" not found or is the main working tree`,
				});
			}

			execSync(`git worktree remove "${target.path}"`, {
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
}
