/**
 * Replay / Resume / Retry Metadata - Workspace 5.J
 *
 * Provides replay manifests, per-workspace replay metadata, retry gating
 * (dirty working tree + safety conflict checks), and dry-run replay.
 *
 * Files produced:
 *   .pi/executions/{planExecId}/replay-manifest.json  — per plan execution
 *   .pi/workspaces/{workspaceId}/workspace-replay.json — per workspace
 */

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { PlanState, WorkspaceState } from "./plan-state.js";
import { createSafetyDoctor } from "./safety-doctor.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";
import { WorkspaceStage } from "./workspace-schema.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Glob pattern matching
// ---------------------------------------------------------------------------

const BACKSLASH = String.fromCharCode(92);

/**
 * Simple glob-style pattern matching.
 * Single-star matches any sequence of non-separator characters.
 * Double-star matches any sequence including path separators.
 *
 * @param value - File path or string to test
 * @param pattern - Glob pattern (e.g. "src/star-star/star.ts")
 * @returns True if value matches pattern
 */
export function matchesGlobPattern(value: string, pattern: string): boolean {
	const regexStr = globPatternToRegexStr(pattern);
	const regex = new RegExp(`^${regexStr}$`);
	return regex.test(value);
}

function globPatternToRegexStr(pattern: string): string {
	let result = "";
	let i = 0;
	while (i < pattern.length) {
		if (pattern[i] === "*" && pattern[i + 1] === "*") {
			result += ".*";
			i += 2;
			if (i < pattern.length && pattern[i] === "/") {
				i++;
			}
		} else if (pattern[i] === "*") {
			result += "[^/]*";
			i++;
		} else {
			result += escapeRegexChar(pattern[i]);
			i++;
		}
	}
	return result;
}

function escapeRegexChar(ch: string): string {
	const code = ch.charCodeAt(0);
	if (
		code === 46 || // .
		code === 43 || // +
		code === 63 || // ?
		code === 94 || // ^
		code === 36 || // $
		code === 123 || // {
		code === 125 || // }
		code === 40 || // (
		code === 41 || // )
		code === 124 || // |
		code === 91 || // [
		code === 93 // ]
	) {
		return BACKSLASH + ch;
	}
	return ch;
}

// ---------------------------------------------------------------------------
// Replay Manifest (per plan execution)
// ---------------------------------------------------------------------------

/** Describes a single workspace entry inside the replay manifest. */
export interface ReplayManifestWorkspaceEntry {
	/** Workspace ID (e.g. "5.A") */
	workspaceId: string;
	/** Human-readable title */
	title: string;
	/** Current stage snapshot */
	stage: WorkspaceStage;
	/** Retry attempts so far */
	attempts: number;
	/** Per-workspace replay file (relative to workspace root) */
	replayFile: string;
	/** Whether this workspace is eligible for retry */
	retryEligible: boolean;
	/** Reason when retry is NOT eligible */
	retryBlockReason?: string;
}

/**
 * Top-level replay manifest written per plan execution.
 * Stored at `.pi/executions/{planExecId}/replay-manifest.json`.
 */
export interface ReplayManifest {
	/** Schema version for forward compat */
	schemaVersion: 1;
	/** Plan execution ID */
	planExecutionId: string;
	/** Phase identifier */
	phase: string;
	/** Plan title */
	title: string;
	/** Overall plan status */
	status: PlanState["status"];
	/** Timestamp when manifest was generated */
	generatedAt: number;
	/** Timestamp when plan execution started */
	startedAt: number;
	/** Timestamp when plan completed (if applicable) */
	completedAt?: number;
	/** Per-workspace entries */
	workspaces: ReplayManifestWorkspaceEntry[];
	/** Original plan file path (if preserved) */
	planFile?: string;
}

// ---------------------------------------------------------------------------
// Workspace Replay (per workspace)
// ---------------------------------------------------------------------------

/** Record of a single retry attempt for a workspace. */
export interface WorkspaceReplayAttempt {
	/** 1-based attempt number */
	attempt: number;
	/** Retry stage (worker / flash / reviewer / final) */
	stage: string;
	/** Timestamp attempt started */
	startedAt?: number;
	/** Timestamp attempt completed */
	completedAt?: number;
	/** Verdict */
	verdict: "running" | "complete" | "failed";
	/** Error excerpt */
	error?: string;
}

/**
 * Per-workspace replay metadata.
 * Stored at `.pi/workspaces/{workspaceId}/workspace-replay.json`.
 */
export interface WorkspaceReplay {
	/** Schema version */
	schemaVersion: 1;
	/** Workspace ID */
	workspaceId: string;
	/** Human-readable title */
	title: string;
	/** Current stage */
	stage: WorkspaceStage;
	/** Total retry attempts */
	totalAttempts: number;
	/** Maximum allowed retries */
	maxRetries: number;
	/** Retry history */
	attempts: WorkspaceReplayAttempt[];
	/** Last error (if failed / blocked) */
	lastError?: string;
	/** Whether this workspace can be retried right now */
	retryEligible: boolean;
	/** Reason retry is blocked (if not eligible) */
	retryBlockReason?: string;
	/** Workspace role budget */
	roleBudget: string;
	/** Files this workspace owns (via capability manifest) */
	ownedFiles: string[];
	/** Timestamp when replay metadata was generated */
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Retry eligibility check result
// ---------------------------------------------------------------------------

/** Result of checking whether a workspace is eligible for retry. */
export interface RetryEligibilityResult {
	/** Whether the workspace can be retried */
	eligible: boolean;
	/** Reason for blocking retry (if not eligible) */
	reason?: string;
	/** Dirty files that would conflict */
	dirtyFiles?: string[];
	/** Safety issues */
	safetyIssues?: string[];
}

// ---------------------------------------------------------------------------
// Dry-run replay result
// ---------------------------------------------------------------------------

/** Result of a dry-run replay (reads archive without modifying files). */
export interface DryRunReplayResult {
	/** Whether the dry-run succeeded */
	success: boolean;
	/** The replay manifest (if readable) */
	manifest?: ReplayManifest;
	/** Per-workspace replay data */
	workspaceReplays: Map<string, WorkspaceReplay>;
	/** Warnings encountered */
	warnings: string[];
	/** Errors encountered */
	errors: string[];
}

// ---------------------------------------------------------------------------
// ReplayMetadataManager
// ---------------------------------------------------------------------------

/**
 * Manages replay manifests and per-workspace replay metadata.
 *
 * - Write `replay-manifest.json` per plan execution
 * - Write `workspace-replay.json` per workspace
 * - Check retry eligibility (dirty tree, safety conflict)
 * - Dry-run replay (read-only archive scan)
 * - Gate retry operations with pre-flight checks
 */
export class ReplayMetadataManager {
	private workspaceRoot: string;
	private piDir: string;

	/**
	 * @param workspaceRoot - Project root directory
	 * @param piDir - Relative path to .pi directory (default ".pi")
	 */
	constructor(workspaceRoot: string, piDir = ".pi") {
		this.workspaceRoot = workspaceRoot;
		this.piDir = piDir;
	}

	// -------------------------------------------------------------------
	// Manifest generation
	// -------------------------------------------------------------------

	/**
	 * Generate and persist the replay manifest for a plan execution.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param planState - Current plan state
	 * @param queue - Original workspace queue
	 * @returns Written manifest
	 */
	async writeReplayManifest(
		planExecutionId: string,
		planState: PlanState,
		queue: WorkspaceQueue,
	): Promise<ReplayManifest> {
		const workspaces: ReplayManifestWorkspaceEntry[] = [];

		for (const wsDef of queue.workspaces) {
			const wsState = planState.workspaces.get(wsDef.id);
			const stage = wsState?.stage ?? WorkspaceStage.Pending;
			const attempts = wsState?.attempts ?? 0;

			const eligibility = await this.checkRetryEligibility(wsDef, wsState);
			const relativeReplayFile = path.join(this.piDir, "workspaces", wsDef.id, "workspace-replay.json");

			workspaces.push({
				workspaceId: wsDef.id,
				title: wsDef.title,
				stage,
				attempts,
				replayFile: relativeReplayFile,
				retryEligible: eligibility.eligible,
				retryBlockReason: eligibility.reason,
			});
		}

		const manifest: ReplayManifest = {
			schemaVersion: 1,
			planExecutionId,
			phase: planState.phase,
			title: planState.title,
			status: planState.status,
			generatedAt: Date.now(),
			startedAt: planState.startedAt,
			completedAt: planState.completedAt,
			workspaces,
		};

		const dir = path.join(this.workspaceRoot, this.piDir, "executions", planExecutionId);
		await fs.mkdir(dir, { recursive: true });
		await this.atomicWriteJson(path.join(dir, "replay-manifest.json"), manifest);

		return manifest;
	}

	/**
	 * Generate and persist per-workspace replay metadata.
	 *
	 * @param workspace - Workspace definition
	 * @param state - Current workspace state (undefined if never started)
	 * @returns Written workspace replay
	 */
	async writeWorkspaceReplay(workspace: Workspace, state: WorkspaceState | undefined): Promise<WorkspaceReplay> {
		const stage = state?.stage ?? WorkspaceStage.Pending;
		const totalAttempts = state?.attempts ?? 0;

		const attempts: WorkspaceReplayAttempt[] = [];
		if (state) {
			for (let i = 1; i <= totalAttempts; i++) {
				const isCurrent = i === totalAttempts;
				attempts.push({
					attempt: i,
					stage: retryStageForAttempt(i),
					startedAt: isCurrent ? state.startedAt : undefined,
					completedAt: isCurrent ? state.completedAt : undefined,
					verdict: isCurrent
						? stage === WorkspaceStage.Complete
							? "complete"
							: stage === WorkspaceStage.Failed
								? "failed"
								: "running"
						: "failed",
					error: isCurrent ? state.error : undefined,
				});
			}
		}

		const eligibility = await this.checkRetryEligibility(workspace, state);

		const replay: WorkspaceReplay = {
			schemaVersion: 1,
			workspaceId: workspace.id,
			title: workspace.title,
			stage,
			totalAttempts,
			maxRetries: workspace.maxRetries,
			attempts,
			lastError: state?.error,
			retryEligible: eligibility.eligible,
			retryBlockReason: eligibility.reason,
			roleBudget: workspace.roleBudget,
			ownedFiles: workspace.capabilities?.canEdit ?? [],
			generatedAt: Date.now(),
		};

		const dir = path.join(this.workspaceRoot, this.piDir, "workspaces", workspace.id);
		await fs.mkdir(dir, { recursive: true });
		await this.atomicWriteJson(path.join(dir, "workspace-replay.json"), replay);

		return replay;
	}

	// -------------------------------------------------------------------
	// Reading
	// -------------------------------------------------------------------

	/**
	 * Load a replay manifest from disk.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @returns Manifest or null if not found
	 */
	async loadReplayManifest(planExecutionId: string): Promise<ReplayManifest | null> {
		const filePath = path.join(this.workspaceRoot, this.piDir, "executions", planExecutionId, "replay-manifest.json");
		return this.readJsonFile<ReplayManifest>(filePath);
	}

	/**
	 * Load a workspace replay from disk.
	 *
	 * @param workspaceId - Workspace ID
	 * @returns Workspace replay or null if not found
	 */
	async loadWorkspaceReplay(workspaceId: string): Promise<WorkspaceReplay | null> {
		const filePath = path.join(this.workspaceRoot, this.piDir, "workspaces", workspaceId, "workspace-replay.json");
		return this.readJsonFile<WorkspaceReplay>(filePath);
	}

	// -------------------------------------------------------------------
	// Dry-run replay
	// -------------------------------------------------------------------

	/**
	 * Perform a dry-run replay: read all archive data without modifying
	 * any files. Validates that the archive is readable and consistent.
	 *
	 * @param planExecutionId - Plan execution ID to replay
	 * @returns Dry-run result
	 */
	async dryRunReplay(planExecutionId: string): Promise<DryRunReplayResult> {
		const warnings: string[] = [];
		const errors: string[] = [];
		const workspaceReplays = new Map<string, WorkspaceReplay>();

		const manifest = await this.loadReplayManifest(planExecutionId);
		if (!manifest) {
			return {
				success: false,
				workspaceReplays,
				warnings,
				errors: [`Replay manifest not found for execution ${planExecutionId}`],
			};
		}

		if (manifest.schemaVersion !== 1) {
			errors.push(`Unsupported manifest schema version: ${manifest.schemaVersion}`);
		}

		for (const wsEntry of manifest.workspaces) {
			try {
				const wsReplay = await this.loadWorkspaceReplay(wsEntry.workspaceId);
				if (wsReplay) {
					workspaceReplays.set(wsEntry.workspaceId, wsReplay);
					if (wsEntry.stage !== wsReplay.stage) {
						warnings.push(
							`Stage mismatch for workspace ${wsEntry.workspaceId}: manifest=${wsEntry.stage}, replay=${wsReplay.stage}`,
						);
					}
				} else {
					warnings.push(`Workspace replay not found for ${wsEntry.workspaceId}`);
				}
			} catch (err) {
				warnings.push(
					`Failed to read workspace replay for ${wsEntry.workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		// Detect orphan workspace directories
		const workspacesDir = path.join(this.workspaceRoot, this.piDir, "workspaces");
		try {
			const entries = await fs.readdir(workspacesDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory() && !manifest.workspaces.some((w) => w.workspaceId === entry.name)) {
					warnings.push(`Orphan workspace directory found: ${entry.name}`);
				}
			}
		} catch {
			// Directory may not exist — that is fine
		}

		return { success: errors.length === 0, manifest, workspaceReplays, warnings, errors };
	}

	// -------------------------------------------------------------------
	// Retry eligibility
	// -------------------------------------------------------------------

	/**
	 * Check whether a workspace is eligible for retry.
	 *
	 * Not eligible when:
	 * - Stage is not "failed" or "blocked"
	 * - Max retries exhausted
	 * - Dirty working tree has files outside canEdit scope
	 * - Safety conflict detected
	 *
	 * @param workspace - Workspace definition
	 * @param wsState - Current workspace state (may be undefined)
	 * @returns Eligibility result
	 */
	async checkRetryEligibility(
		workspace: Workspace,
		wsState: WorkspaceState | undefined,
	): Promise<RetryEligibilityResult> {
		const stage = wsState?.stage ?? WorkspaceStage.Pending;

		if (stage !== WorkspaceStage.Failed && stage !== WorkspaceStage.Blocked) {
			return {
				eligible: false,
				reason: `Workspace stage is "${stage}", only "failed" or "blocked" workspaces can be retried`,
			};
		}

		const attempts = wsState?.attempts ?? 0;
		if (attempts >= workspace.maxRetries) {
			return {
				eligible: false,
				reason: `Max retries exhausted (${attempts}/${workspace.maxRetries})`,
			};
		}

		const dirtyTreeResult = await this.checkDirtyWorkingTree(workspace);
		if (!dirtyTreeResult.clean) {
			return {
				eligible: false,
				reason: `Dirty working tree: ${dirtyTreeResult.conflictingFiles.join(", ")}`,
				dirtyFiles: dirtyTreeResult.conflictingFiles,
			};
		}

		const safetyResult = await this.checkSafetyConflict(workspace);
		if (!safetyResult.safe) {
			return {
				eligible: false,
				reason: `Safety conflict: ${safetyResult.issues.join("; ")}`,
				safetyIssues: safetyResult.issues,
			};
		}

		return { eligible: true };
	}

	/**
	 * Gate a retry operation: throws if the workspace is not eligible.
	 *
	 * @param workspace - Workspace definition
	 * @param wsState - Current workspace state
	 * @throws Error if retry is not eligible
	 */
	async gateRetry(workspace: Workspace, wsState: WorkspaceState | undefined): Promise<void> {
		const eligibility = await this.checkRetryEligibility(workspace, wsState);
		if (!eligibility.eligible) {
			throw new Error(`Retry blocked: ${eligibility.reason}`);
		}
	}

	// -------------------------------------------------------------------
	// Internal helpers
	// -------------------------------------------------------------------

	private async checkDirtyWorkingTree(workspace: Workspace): Promise<{ clean: boolean; conflictingFiles: string[] }> {
		const gitStatus = await getGitStatus(this.workspaceRoot);
		const allDirty = [...gitStatus.modified, ...gitStatus.added, ...gitStatus.deleted];

		if (allDirty.length === 0) {
			return { clean: true, conflictingFiles: [] };
		}

		if (!workspace.capabilities || workspace.capabilities.canEdit.length === 0) {
			return { clean: false, conflictingFiles: allDirty };
		}

		const canEditPatterns = workspace.capabilities.canEdit;
		const cannotEditPatterns = workspace.capabilities.cannotEdit ?? [];

		const conflictingFiles: string[] = [];
		for (const file of allDirty) {
			if (cannotEditPatterns.some((p) => matchesGlobPattern(file, p))) {
				conflictingFiles.push(file);
				continue;
			}
			if (!canEditPatterns.some((p) => matchesGlobPattern(file, p))) {
				conflictingFiles.push(file);
			}
		}

		return { clean: conflictingFiles.length === 0, conflictingFiles };
	}

	private async checkSafetyConflict(workspace: Workspace): Promise<{ safe: boolean; issues: string[] }> {
		const issues: string[] = [];

		const miniQueue: WorkspaceQueue = {
			phase: "replay-check",
			title: "Retry safety check",
			maxParallelWorkspaces: 1,
			workspaces: [workspace],
		};

		try {
			const doctor = createSafetyDoctor();
			const report = doctor.validateQueue(miniQueue);

			if (!report.safe) {
				for (const critical of report.critical) {
					issues.push(`Critical: ${critical.message}`);
				}
				for (const warning of report.warnings) {
					issues.push(`Warning: ${warning.message}`);
				}
			}
		} catch (err) {
			issues.push(`Safety check failed: ${err instanceof Error ? err.message : String(err)}`);
		}

		return { safe: issues.length === 0, issues };
	}

	private async atomicWriteJson(filePath: string, data: unknown): Promise<void> {
		const tmpPath = `${filePath}.tmp`;
		await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
		await fs.rename(tmpPath, filePath);
	}

	private async readJsonFile<T>(filePath: string): Promise<T | null> {
		try {
			const content = await fs.readFile(filePath, "utf-8");
			return JSON.parse(content) as T;
		} catch {
			return null;
		}
	}
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function retryStageForAttempt(attempt: number): string {
	if (attempt >= 10) return "final";
	if (attempt >= 7) return "reviewer";
	if (attempt >= 4) return "flash";
	return "worker";
}

async function getGitStatus(workspaceRoot: string): Promise<{
	modified: string[];
	added: string[];
	deleted: string[];
}> {
	try {
		const { stdout } = await execAsync("git status --porcelain --untracked-files=all", {
			cwd: workspaceRoot,
		});

		const modified: string[] = [];
		const added: string[] = [];
		const deleted: string[] = [];

		for (const line of stdout.split(String.fromCharCode(10))) {
			if (!line.trim()) continue;
			const status = line.slice(0, 2);
			const file = line.slice(3).trim();
			if (file.endsWith("/")) continue;

			if (status.includes("M")) {
				modified.push(file);
			} else if (status.includes("A") || status.includes("?")) {
				added.push(file);
			} else if (status.includes("D")) {
				deleted.push(file);
			}
		}

		return { modified, added, deleted };
	} catch {
		return { modified: [], added: [], deleted: [] };
	}
}
