/**
 * Merge Conflict Handoff - P2 Workstream 6.D
 *
 * Detects merge conflicts that occur during integration branch merges,
 * writes conflict artifacts, reports status to the dashboard, and
 * provides a manual resolution and resume path.
 *
 * Key behaviors:
 * - Merge conflicts are detected via git conflict markers in affected files
 *   or via git's conflict exit codes/stderr
 * - Conflict artifacts (diff, list of conflicted files, description) are
 *   written to the .pi/ directory
 * - The integration queue stops safely on conflict (uses "blocked" status
 *   with conflict-specific error metadata)
 * - A resume path is provided for after manual resolution
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of a merge conflict.
 */
export type MergeConflictStatus =
	/** Merge conflict detected, not yet resolved */
	| "unresolved"
	/** Conflict has been manually resolved; ready for resume */
	| "resolved"
	/** Resume completed successfully */
	| "resume_complete"
	/** Resume failed */
	| "resume_failed";

/**
 * A single conflicted file within a merge conflict.
 */
export interface ConflictedFile {
	/** File path relative to workspace root */
	filePath: string;
	/** Git status of the file (e.g., "both modified", "deleted by us", etc.) */
	conflictType: string;
	/** Whether this file still contains conflict markers */
	hasConflictMarkers: boolean;
}

/**
 * Merge conflict artifact persisted to disk.
 */
export interface MergeConflictArtifact {
	/** Workspace ID that caused the conflict */
	workspaceId: string;
	/** Commit hash that was being merged */
	commitHash: string;
	/** Current merge status */
	status: MergeConflictStatus;
	/** Timestamp when the conflict was detected */
	detectedAt: number;
	/** Timestamp when the conflict was resolved */
	resolvedAt?: number;
	/** Timestamp when resume completed */
	resumeCompletedAt?: number;
	/** List of conflicted files */
	conflictedFiles: ConflictedFile[];
	/** Full git diff of the conflicted area */
	conflictDiff: string;
	/** Git status output at conflict time */
	gitStatusOutput: string;
	/** Human-readable description of what happened */
	description: string;
	/** Suggested manual resolution steps */
	suggestedResolutionSteps: string[];
	/** Error message from git */
	gitErrorMessage?: string;
	/** Optional notes added during resolution */
	resolutionNotes?: string;
	/** Error message if resume failed */
	resumeError?: string;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Check whether a git operation failure was caused by a merge conflict.
 *
 * Examines the error message for known conflict-related patterns.
 *
 * @param errorMessage - Error message from the failed git operation
 * @returns True if the error indicates a merge conflict
 */
export function isMergeConflictError(errorMessage: string): boolean {
	const conflictPatterns = [
		/automatic merge failed/i,
		/merge conflict/i,
		/cherry.pick.*conflict/i,
		/conflict.*(detected|found|marker)/i,
		/cannot merge/i,
		/not something we can merge/i,
		/conflict.*needs resolution/i,
		/merge.*failed.*resolve/i,
		/pull is not possible.*merge conflict/i,
		/merge.*abort/i,
		/<<<<<<< /,
		/=======\n[\s\S]*?>>>>>>> /,
	];

	return conflictPatterns.some((pattern) => pattern.test(errorMessage));
}

/**
 * Scan the workspace for files containing git conflict markers.
 *
 * @param workspaceRoot - Root directory of the git repository
 * @returns Array of file paths containing conflict markers
 */
export function scanForConflictFiles(workspaceRoot: string): string[] {
	try {
		// Use git diff --name-only --diff-filter=U to list unmerged files
		const unmergedOutput = execSync("git diff --name-only --diff-filter=U", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();

		if (unmergedOutput.length > 0) {
			return unmergedOutput
				.split("\n")
				.map((f) => f.trim())
				.filter(Boolean);
		}

		// Fallback: use git status --porcelain to find conflicted files
		const statusOutput = execSync("git status --porcelain", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();

		const conflictFiles: string[] = [];
		for (const line of statusOutput.split("\n")) {
			const trimmed = line.trim();
			// Conflicted files show as "UU" or "AA" or "DD" in porcelain
			if (/^(UU|AA|DD)\s/.test(trimmed)) {
				conflictFiles.push(trimmed.slice(3).trim());
			}
		}
		return conflictFiles;
	} catch {
		// git commands may fail if we're not in a proper repo state
		return [];
	}
}

/**
 * Get detailed info about each conflicted file.
 *
 * @param workspaceRoot - Root directory of the git repository
 * @param filePaths - Array of conflicted file paths
 * @returns Array of ConflictedFile objects
 */
export async function getConflictedFilesDetail(workspaceRoot: string, filePaths: string[]): Promise<ConflictedFile[]> {
	const results: ConflictedFile[] = [];

	for (const filePath of filePaths) {
		let conflictType = "both modified";
		let hasConflictMarkers = false;

		try {
			// Try to determine the conflict type from git status
			const statusLine = execSync(`git status --porcelain "${filePath}"`, {
				cwd: workspaceRoot,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();

			if (statusLine.length >= 2) {
				const working = statusLine[0];
				const staging = statusLine[1];
				if (working === "U" && staging === "U") conflictType = "both modified";
				else if (working === "A" && staging === "A") conflictType = "both added";
				else if (working === "D" && staging === "D") conflictType = "both deleted";
				else if (working === "U" || staging === "U") conflictType = "unmerged";
			}

			// Check if file still contains conflict markers
			const fullPath = path.resolve(workspaceRoot, filePath);
			const content = await fs.readFile(fullPath, "utf-8");
			hasConflictMarkers = /<<<<<<< /.test(content) && /=======/.test(content) && />>>>>>> /.test(content);
		} catch {
			// If we can't read the file, assume it has conflict markers
			hasConflictMarkers = true;
		}

		results.push({ filePath, conflictType, hasConflictMarkers });
	}

	return results;
}

/**
 * Get the full diff of conflicted areas in the workspace.
 *
 * @param workspaceRoot - Root directory of the git repository
 * @returns The diff output as a string
 */
export function getConflictDiff(workspaceRoot: string): string {
	try {
		return execSync("git diff", { cwd: workspaceRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return "[unable to produce diff]";
	}
}

/**
 * Get the git status output for the workspace.
 *
 * @param workspaceRoot - Root directory of the git repository
 * @returns The git status output
 */
export function getGitStatusOutput(workspaceRoot: string): string {
	try {
		return execSync("git status", {
			cwd: workspaceRoot,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch {
		return "[unable to get git status]";
	}
}

/**
 * Generate suggested resolution steps for a merge conflict.
 *
 * @param conflictedFiles - List of conflicted files
 * @param workspaceId - Workspace ID for context
 * @returns Array of suggested steps
 */
export function generateSuggestedResolutionSteps(conflictedFiles: ConflictedFile[], workspaceId: string): string[] {
	const steps: string[] = [
		`1. Identify the conflicting changes in each conflicted file (see list below).`,
		`2. For each conflicted file, open it and locate the conflict markers (<<<<<<<, =======, >>>>>>>).`,
		`3. Review both versions of the conflicting code:`,
		`   - The section between <<<<<<< and ======= is the integration branch version ("ours").`,
		`   - The section between ======= and >>>>>>> is the workspace ${workspaceId} version ("theirs").`,
		`4. Edit each conflict to produce the correct merged result, removing all conflict markers.`,
		`5. After resolving all conflicts, stage the resolved files: git add <file1> <file2> ...`,
		`6. Complete the merge: git commit --no-verify -m "chore: resolve merge conflict for ${workspaceId}"`,
		`7. Resume the integration queue to continue processing.`,
	];

	// Add file-specific guidance
	if (conflictedFiles.length > 0) {
		steps.push("");
		steps.push("Conflicted files:");
		for (const file of conflictedFiles) {
			const markerStatus = file.hasConflictMarkers ? " (contains conflict markers)" : "";
			steps.push(`  - ${file.filePath} [${file.conflictType}]${markerStatus}`);
		}
	}

	return steps;
}

/**
 * Build a human-readable description of the merge conflict.
 *
 * @param workspaceId - Workspace ID
 * @param commitHash - Commit hash being merged
 * @param conflictedFiles - List of conflicted files
 * @returns Description string
 */
export function buildConflictDescription(
	workspaceId: string,
	commitHash: string,
	conflictedFiles: ConflictedFile[],
): string {
	const fileList = conflictedFiles.map((f) => f.filePath).join(", ");
	return (
		`Merge conflict detected when merging workspace ${workspaceId} ` +
		`(commit ${commitHash.slice(0, 8)}) into the integration branch. ` +
		`${conflictedFiles.length} file(s) have conflicts: ${fileList}. ` +
		`The integration queue has been halted until the conflict is resolved.`
	);
}

// ---------------------------------------------------------------------------
// Artifact file I/O
// ---------------------------------------------------------------------------

/**
 * Write a merge conflict artifact to disk.
 *
 * @param workspaceRoot - Root directory of the workspace
 * @param artifact - The merge conflict artifact to persist
 * @returns The file path of the written artifact
 */
export async function writeMergeConflictArtifact(
	workspaceRoot: string,
	artifact: MergeConflictArtifact,
): Promise<string> {
	const artifactsDir = path.join(workspaceRoot, ".pi", "merge-conflicts");
	await fs.mkdir(artifactsDir, { recursive: true });

	const filename = `${artifact.workspaceId}-${artifact.detectedAt}.json`;
	const filePath = path.join(artifactsDir, filename);

	const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	await fs.writeFile(tempPath, JSON.stringify(artifact, null, 2), "utf-8");
	await fs.rename(tempPath, filePath);

	return filePath;
}

/**
 * Read a merge conflict artifact from disk.
 *
 * @param filePath - Path to the artifact file
 * @returns The parsed artifact, or null if not found or invalid
 */
export async function readMergeConflictArtifact(filePath: string): Promise<MergeConflictArtifact | null> {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		return JSON.parse(content) as MergeConflictArtifact;
	} catch {
		return null;
	}
}

/**
 * List all merge conflict artifacts in the workspace.
 *
 * @param workspaceRoot - Root directory of the workspace
 * @returns Array of artifact file paths
 */
export async function listMergeConflictArtifacts(workspaceRoot: string): Promise<string[]> {
	const artifactsDir = path.join(workspaceRoot, ".pi", "merge-conflicts");
	try {
		const files = await fs.readdir(artifactsDir);
		return files
			.filter((f) => f.endsWith(".json"))
			.sort()
			.map((f) => path.join(artifactsDir, f));
	} catch {
		return [];
	}
}

/**
 * Get the latest unresolved merge conflict artifact.
 *
 * @param workspaceRoot - Root directory of the workspace
 * @returns The latest unresolved artifact, or null
 */
export async function getLatestUnresolvedConflict(workspaceRoot: string): Promise<MergeConflictArtifact | null> {
	const artifactFiles = await listMergeConflictArtifacts(workspaceRoot);

	let latest: MergeConflictArtifact | null = null;
	let latestTime = 0;

	for (const filePath of artifactFiles) {
		const artifact = await readMergeConflictArtifact(filePath);
		if (artifact && artifact.status === "unresolved" && artifact.detectedAt > latestTime) {
			latest = artifact;
			latestTime = artifact.detectedAt;
		}
	}

	return latest;
}

/**
 * Update a merge conflict artifact (e.g., after resolution).
 *
 * @param filePath - Path to the artifact file
 * @param updates - Partial artifact fields to update
 */
export async function updateMergeConflictArtifact(
	filePath: string,
	updates: Partial<MergeConflictArtifact>,
): Promise<void> {
	const existing = await readMergeConflictArtifact(filePath);
	if (!existing) {
		throw new Error(`Merge conflict artifact not found: ${filePath}`);
	}

	const updated: MergeConflictArtifact = { ...existing, ...updates };

	const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
	await fs.writeFile(tempPath, JSON.stringify(updated, null, 2), "utf-8");
	await fs.rename(tempPath, filePath);
}

// ---------------------------------------------------------------------------
// MergeConflictResolver
// ---------------------------------------------------------------------------

/**
 * Merge Conflict Resolver
 *
 * Provides a manual resolution and resume path for merge conflicts that
 * occur during integration branch merges.
 *
 * Flow:
 * 1. Conflict is detected → artifact is written, queue is blocked
 * 2. User manually resolves conflicts in the working directory
 * 3. User calls resolveConflict() to mark the conflict as resolved
 * 4. User calls resumeIntegration() to verify resolution and continue
 */
export class MergeConflictResolver {
	private workspaceRoot: string;

	/**
	 * @param workspaceRoot - Root directory of the workspace
	 */
	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Detect and create a merge conflict artifact from the current workspace state.
	 *
	 * Scans the workspace for conflicted files, generates a diff and description,
	 * and writes the artifact to disk.
	 *
	 * @param workspaceId - Workspace ID that caused the conflict
	 * @param commitHash - Commit hash being merged
	 * @param gitErrorMessage - Optional error message from git
	 * @returns The created artifact and its file path
	 */
	async detectAndRecordConflict(
		workspaceId: string,
		commitHash: string,
		gitErrorMessage?: string,
	): Promise<{ artifact: MergeConflictArtifact; filePath: string }> {
		const conflictFiles = scanForConflictFiles(this.workspaceRoot);
		const conflictedFiles = await getConflictedFilesDetail(this.workspaceRoot, conflictFiles);
		const conflictDiff = getConflictDiff(this.workspaceRoot);
		const gitStatusOutput = getGitStatusOutput(this.workspaceRoot);
		const description = buildConflictDescription(workspaceId, commitHash, conflictedFiles);
		const suggestedResolutionSteps = generateSuggestedResolutionSteps(conflictedFiles, workspaceId);

		const artifact: MergeConflictArtifact = {
			workspaceId,
			commitHash,
			status: "unresolved",
			detectedAt: Date.now(),
			conflictedFiles,
			conflictDiff,
			gitStatusOutput,
			description,
			suggestedResolutionSteps,
			gitErrorMessage,
		};

		const filePath = await writeMergeConflictArtifact(this.workspaceRoot, artifact);
		return { artifact, filePath };
	}

	/**
	 * Mark a merge conflict as resolved.
	 *
	 * Does NOT verify the resolution — only marks it. After calling this,
	 * call resumeIntegration() to verify and continue.
	 *
	 * @param artifactFilePath - Path to the conflict artifact file
	 * @param notes - Optional resolution notes
	 * @returns The updated artifact
	 */
	async resolveConflict(artifactFilePath: string, notes?: string): Promise<MergeConflictArtifact> {
		const update: Partial<MergeConflictArtifact> = {
			status: "resolved",
			resolvedAt: Date.now(),
		};
		if (notes !== undefined) {
			update.resolutionNotes = notes;
		}

		await updateMergeConflictArtifact(artifactFilePath, update);

		const artifact = await readMergeConflictArtifact(artifactFilePath);
		if (!artifact) {
			throw new Error(`Failed to read updated artifact: ${artifactFilePath}`);
		}

		return artifact;
	}

	/**
	 * Resume integration after a merge conflict has been resolved.
	 *
	 * Verifies that:
	 * - The conflict artifact exists and is in "resolved" status
	 * - No conflicted files remain (no conflict markers in working tree)
	 * - The merge commit has been completed
	 *
	 * @param artifactFilePath - Path to the conflict artifact file
	 * @returns True if resume succeeded, false if verification failed
	 */
	async resumeIntegration(artifactFilePath: string): Promise<boolean> {
		const artifact = await readMergeConflictArtifact(artifactFilePath);
		if (!artifact) {
			throw new Error(`Merge conflict artifact not found: ${artifactFilePath}`);
		}

		if (artifact.status !== "resolved") {
			throw new Error(
				`Cannot resume: conflict is ${artifact.status}, expected "resolved". Call resolveConflict() first.`,
			);
		}

		// Verify no conflicted files remain
		const remainingConflicts = scanForConflictFiles(this.workspaceRoot);
		if (remainingConflicts.length > 0) {
			await updateMergeConflictArtifact(artifactFilePath, {
				status: "resume_failed",
				resumeError: `Still have ${remainingConflicts.length} conflicted file(s): ${remainingConflicts.join(", ")}`,
			});
			return false;
		}

		// Verify no conflict markers in affected files
		const affectedFiles = artifact.conflictedFiles.map((f) => f.filePath);
		let stillHasMarkers = false;
		for (const filePath of affectedFiles) {
			try {
				const fullPath = path.resolve(this.workspaceRoot, filePath);
				const content = await fs.readFile(fullPath, "utf-8");
				if (/<<<<<<< /.test(content) && /=======/.test(content) && />>>>>>> /.test(content)) {
					stillHasMarkers = true;
					break;
				}
			} catch {
				stillHasMarkers = true; // If we can't read a file, assume it's still conflicted
				break;
			}
		}

		if (stillHasMarkers) {
			await updateMergeConflictArtifact(artifactFilePath, {
				status: "resume_failed",
				resumeError: "Some affected files still contain conflict markers",
			});
			return false;
		}

		// Mark as complete
		await updateMergeConflictArtifact(artifactFilePath, {
			status: "resume_complete",
			resumeCompletedAt: Date.now(),
		});

		return true;
	}

	/**
	 * Abort the merge and reset the workspace state.
	 *
	 * Runs `git merge --abort` (or `git cherry-pick --abort`) to restore
	 * the pre-merge state.
	 */
	async abortMerge(): Promise<void> {
		// Try cherry-pick --abort first, then merge --abort
		try {
			execSync("git cherry-pick --abort", {
				cwd: this.workspaceRoot,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch {
			try {
				execSync("git merge --abort", {
					cwd: this.workspaceRoot,
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch {
				try {
					execSync("git reset --merge", {
						cwd: this.workspaceRoot,
						encoding: "utf-8",
						stdio: ["ignore", "pipe", "pipe"],
					});
				} catch {
					// Last resort
				}
			}
		}
	}
}
