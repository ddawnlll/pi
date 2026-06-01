/**
 * Snapshot Artifacts — P41.07
 *
 * Types, interfaces, and utilities for capturing file snapshots and computing
 * diffs between pre-execution and post-execution file states.
 *
 * A snapshot artifact captures the state of workspace files at a point in
 * time. When paired (pre + post), diffs are computed to show exactly what
 * changed during execution.
 *
 * This module provides:
 * - `FileSnapshot` / `WorkspaceSnapshot` — file state at a point in time
 * - `SnapshotDiff` / `SnapshotArtifact` — computed diffs with full context
 * - `ISnapshotArtifactStore` — persistence contract
 * - `InMemorySnapshotArtifactStore` — ephemeral store for testing
 * - Factory functions for creating snapshots and computing diffs
 *
 * Consumption path:
 *   Pre-execution: createWorkspaceSnapshot(files, "pre") → WorkspaceSnapshot
 *   Post-execution: createWorkspaceSnapshot(files, "post") → WorkspaceSnapshot
 *   Diff: computeSnapshotDiff(pre, post) → SnapshotDiff[]
 *   Store: snapshotArtifactStore.save(artifact) → persisted
 *   Query: snapshotArtifactStore.get(planExecId, workspaceId, attemptNo) → retrieve
 *
 * DEPENDENCY NOTE:
 *   This module MUST NOT import from @earendil-works/pi-coding-agent.
 *   It is a platform contract consumed by both the coding-agent runtime
 *   and the web-ui dashboard.
 */

import { createHash } from "node:crypto";
import type { FileChangeStatus } from "./read-model.js";

// ---------------------------------------------------------------------------
// FileSnapshot — state of a single file at a point in time
// ---------------------------------------------------------------------------

/**
 * A snapshot of a single file's content and metadata at a point in time.
 * Used as a building block for WorkspaceSnapshot and SnapshotDiff.
 *
 * The `hash` field is a SHA-256 content hash that enables efficient
 * change detection without comparing file contents directly.
 */
export interface FileSnapshot {
	/** File path relative to workspace root */
	path: string;
	/** File content as text (null for binary files) */
	content: string | null;
	/** Base64-encoded content for binary files */
	base64Content?: string | null;
	/** Whether the file is binary */
	isBinary: boolean;
	/** File size in bytes */
	size: number;
	/** File modification timestamp (ms since epoch) */
	mtime: number;
	/** Programming language detected from extension */
	language?: string;
	/** SHA-256 content hash for efficient change detection */
	hash: string;
}

// ---------------------------------------------------------------------------
// Snapshot source — where in the execution lifecycle the snapshot was taken
// ---------------------------------------------------------------------------

/**
 * The lifecycle phase at which a snapshot was captured.
 * - "pre": captured before workspace execution begins
 * - "post": captured after workspace execution completes
 * - "baseline": a reference snapshot (e.g., from the original project state)
 */
export type SnapshotSource = "pre" | "post" | "baseline";

// ---------------------------------------------------------------------------
// WorkspaceSnapshot — collection of file snapshots at a point in time
// ---------------------------------------------------------------------------

/**
 * A collection of FileSnapshot entries capturing the state of a workspace
 * at a specific point in the execution lifecycle.
 *
 * A workspace snapshot is always associated with a plan execution, workspace,
 * and attempt number so retries can be tracked independently.
 */
export interface WorkspaceSnapshot {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Lifecycle phase at capture time */
	source: SnapshotSource;
	/** Attempt number (0 = first attempt, 1+ = retry) */
	attemptNumber: number;
	/** Ordered list of file snapshots (sorted by path) */
	files: FileSnapshot[];
	/** Timestamp when the snapshot was captured (ms since epoch) */
	capturedAt: number;
}

// ---------------------------------------------------------------------------
// SnapshotDiff — diff between pre and post snapshots of a single file
// ---------------------------------------------------------------------------

/**
 * A computed diff for a single file between a pre-execution and post-execution
 * snapshot. Includes the unified diff content, line statistics, and the
 * pre/post file states for full context.
 *
 * For added files, preSnapshot is null. For deleted files, postSnapshot is null.
 */
export interface SnapshotDiff {
	/** File path relative to workspace root */
	path: string;
	/** Type of change detected */
	status: FileChangeStatus;
	/** Unified diff content (empty string if identical) */
	diff: string;
	/** Number of lines added */
	additions: number;
	/** Number of lines deleted */
	deletions: number;
	/** Pre-execution file snapshot (null if file was added) */
	preSnapshot: FileSnapshot | null;
	/** Post-execution file snapshot (null if file was deleted) */
	postSnapshot: FileSnapshot | null;
}

// ---------------------------------------------------------------------------
// SnapshotArtifactSummary — aggregate statistics for a snapshot artifact
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics computed from the set of SnapshotDiff entries
 * in a SnapshotArtifact. Provides a high-level summary of changes.
 */
export interface SnapshotArtifactSummary {
	/** Total number of files in the post-snapshot (or pre if no post) */
	totalFiles: number;
	/** Number of files added during execution */
	addedFiles: number;
	/** Number of files modified during execution */
	modifiedFiles: number;
	/** Number of files deleted during execution */
	deletedFiles: number;
	/** Total lines added across all files */
	totalAdditions: number;
	/** Total lines deleted across all files */
	totalDeletions: number;
}

// ---------------------------------------------------------------------------
// SnapshotArtifact — complete artifact with pre/post snapshots and diffs
// ---------------------------------------------------------------------------

/**
 * A complete snapshot artifact pairing the pre-execution and post-execution
 * workspace snapshots with computed diffs and summary statistics.
 *
 * This is the top-level type for the P41.07 snapshot artifact system.
 * Consumers (dashboard UI, Brain, report generators) use this to render
 * file change visualizations, generate patch files, and produce summaries.
 */
export interface SnapshotArtifact {
	/** Plan execution ID */
	planExecutionId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Attempt number (0 = first attempt, 1+ = retry) */
	attemptNumber: number;
	/** Pre-execution workspace snapshot (null if not captured) */
	preSnapshot: WorkspaceSnapshot | null;
	/** Post-execution workspace snapshot (null if not captured) */
	postSnapshot: WorkspaceSnapshot | null;
	/** Computed per-file diffs (empty if no changes or only one snapshot) */
	diffs: SnapshotDiff[];
	/** Aggregate summary statistics */
	summary: SnapshotArtifactSummary;
	/** Timestamp when the artifact was generated (ms since epoch) */
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// ISnapshotArtifactStore — persistence contract for snapshot artifacts
// ---------------------------------------------------------------------------

/**
 * Persistence contract for snapshot artifacts.
 *
 * Implementations may be in-memory (testing), file-based (local execution),
 * or database-backed (server deployments).
 *
 * Each artifact is uniquely identified by the triple (planExecutionId,
 * workspaceId, attemptNumber), enabling independent artifact tracking
 * across retry attempts.
 */
export interface ISnapshotArtifactStore {
	/**
	 * Persist a snapshot artifact.
	 *
	 * @param artifact - The snapshot artifact to save
	 */
	save(artifact: SnapshotArtifact): Promise<void>;

	/**
	 * Retrieve a snapshot artifact by its key triple.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param attemptNumber - Attempt number
	 * @returns The artifact, or null if not found
	 */
	get(planExecutionId: string, workspaceId: string, attemptNumber: number): Promise<SnapshotArtifact | null>;

	/**
	 * List all snapshot artifacts for a given plan execution.
	 * Returns summary info (workspaceId, attemptNumber, generatedAt) for each.
	 *
	 * @param planExecutionId - Plan execution to list artifacts for
	 * @returns Array of artifact summaries, empty if none exist
	 */
	list(planExecutionId: string): Promise<Array<{ workspaceId: string; attemptNumber: number; generatedAt: number }>>;

	/**
	 * Delete snapshot artifacts for a plan execution.
	 * If workspaceId is provided, only artifacts for that workspace are deleted.
	 *
	 * @param planExecutionId - Plan execution to delete artifacts from
	 * @param workspaceId - Optional workspace filter
	 */
	delete(planExecutionId: string, workspaceId?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemorySnapshotArtifactStore — ephemeral store for testing
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of ISnapshotArtifactStore.
 *
 * Artifacts are stored in a tri-level map:
 *   planExecutionId → workspaceId → attemptNumber → SnapshotArtifact
 *
 * All operations are async but synchronous in practice (JavaScript single-threaded).
 */
export class InMemorySnapshotArtifactStore implements ISnapshotArtifactStore {
	/**
	 * planExecutionId → workspaceId → Map<attemptNumber, SnapshotArtifact>
	 */
	private readonly store: Map<string, Map<string, Map<number, SnapshotArtifact>>> = new Map();

	async save(artifact: SnapshotArtifact): Promise<void> {
		if (!artifact.planExecutionId) {
			throw new Error("planExecutionId is required");
		}
		if (!artifact.workspaceId) {
			throw new Error("workspaceId is required");
		}
		if (artifact.attemptNumber < 0) {
			throw new Error("attemptNumber must be >= 0");
		}

		let planStore = this.store.get(artifact.planExecutionId);
		if (!planStore) {
			planStore = new Map();
			this.store.set(artifact.planExecutionId, planStore);
		}

		let wsStore = planStore.get(artifact.workspaceId);
		if (!wsStore) {
			wsStore = new Map();
			planStore.set(artifact.workspaceId, wsStore);
		}

		wsStore.set(artifact.attemptNumber, artifact);
	}

	async get(planExecutionId: string, workspaceId: string, attemptNumber: number): Promise<SnapshotArtifact | null> {
		const planStore = this.store.get(planExecutionId);
		if (!planStore) return null;
		const wsStore = planStore.get(workspaceId);
		if (!wsStore) return null;
		return wsStore.get(attemptNumber) ?? null;
	}

	async list(
		planExecutionId: string,
	): Promise<Array<{ workspaceId: string; attemptNumber: number; generatedAt: number }>> {
		const planStore = this.store.get(planExecutionId);
		if (!planStore) return [];

		const results: Array<{ workspaceId: string; attemptNumber: number; generatedAt: number }> = [];
		for (const [workspaceId, wsStore] of planStore) {
			for (const [attemptNumber, artifact] of wsStore) {
				results.push({ workspaceId, attemptNumber, generatedAt: artifact.generatedAt });
			}
		}
		return results;
	}

	async delete(planExecutionId: string, workspaceId?: string): Promise<void> {
		if (workspaceId) {
			const planStore = this.store.get(planExecutionId);
			if (planStore) {
				planStore.delete(workspaceId);
				if (planStore.size === 0) {
					this.store.delete(planExecutionId);
				}
			}
		} else {
			this.store.delete(planExecutionId);
		}
	}

	/**
	 * Clear all stored artifacts (primarily for testing).
	 */
	async clear(): Promise<void> {
		this.store.clear();
	}
}

// ---------------------------------------------------------------------------
// Content hash computation
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 content hash for a string of file content.
 * Returns a hex-encoded digest.
 *
 * @param content - File content (empty string is valid)
 * @returns Hex-encoded SHA-256 hash
 */
export function computeContentHash(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Factory: createFileSnapshot
// ---------------------------------------------------------------------------

/**
 * Create a FileSnapshot from a file path and content.
 *
 * Automatically computes:
 * - file size in bytes
 * - content hash (SHA-256)
 * - language hint from file extension
 * - isBinary flag (content === null means binary)
 *
 * @param path - File path relative to workspace root
 * @param content - File content as string, or null for binary files
 * @param mtime - Optional file modification timestamp (defaults to Date.now())
 * @param base64Content - Optional base64 content for binary files
 * @returns A populated FileSnapshot
 */
export function createFileSnapshot(
	path: string,
	content: string | null,
	mtime?: number,
	base64Content?: string | null,
): FileSnapshot {
	const hash = content !== null ? computeContentHash(content) : computeContentHash("");
	const size = content !== null ? Buffer.byteLength(content, "utf-8") : 0;
	const isBinary = content === null;
	const ext = extractExtension(path);

	return {
		path,
		content,
		base64Content: base64Content ?? undefined,
		isBinary,
		size,
		mtime: mtime ?? Date.now(),
		language: ext ? extToLanguage(ext) : undefined,
		hash,
	};
}

// ---------------------------------------------------------------------------
// Factory: createWorkspaceSnapshot
// ---------------------------------------------------------------------------

/**
 * Create a WorkspaceSnapshot from an array of file path/content pairs.
 *
 * Each entry in the files array should be an object with:
 * - path: relative file path
 * - content: file content (string) or null (binary)
 * - mtime (optional): modification timestamp
 * - base64Content (optional): base64 content for binary files
 *
 * Files are sorted by path for deterministic ordering.
 *
 * @param planExecutionId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param source - Snapshot source ("pre", "post", or "baseline")
 * @param attemptNumber - Attempt number (0 = first attempt)
 * @param files - Array of file data to snapshot
 * @returns A populated WorkspaceSnapshot
 */
export function createWorkspaceSnapshot(
	planExecutionId: string,
	workspaceId: string,
	source: SnapshotSource,
	attemptNumber: number,
	files: Array<{
		path: string;
		content: string | null;
		mtime?: number;
		base64Content?: string | null;
	}>,
): WorkspaceSnapshot {
	const fileSnapshots: FileSnapshot[] = files.map((f) =>
		createFileSnapshot(f.path, f.content, f.mtime, f.base64Content),
	);

	// Sort by path for deterministic ordering
	fileSnapshots.sort((a, b) => a.path.localeCompare(b.path));

	return {
		planExecutionId,
		workspaceId,
		source,
		attemptNumber,
		files: fileSnapshots,
		capturedAt: Date.now(),
	};
}

// ---------------------------------------------------------------------------
// Factory: computeSnapshotDiff
// ---------------------------------------------------------------------------

/**
 * Compute diffs between a pre-execution and post-execution workspace snapshot.
 *
 * The algorithm:
 * 1. Build maps from both snapshots keyed by file path
 * 2. Detect added files: in post but not in pre
 * 3. Detect deleted files: in pre but not in post
 * 4. Detect modified files: in both but with different content hashes
 * 5. For added/modified files, generate unified diff content
 * 6. Compute line-additions/deletions statistics from diffs
 *
 * @param preSnapshot - Pre-execution workspace snapshot
 * @param postSnapshot - Post-execution workspace snapshot
 * @returns Array of SnapshotDiff entries sorted by path, empty if identical
 */
export function computeSnapshotDiff(preSnapshot: WorkspaceSnapshot, postSnapshot: WorkspaceSnapshot): SnapshotDiff[] {
	const diffs: SnapshotDiff[] = [];

	// Build quick-lookup maps
	const preMap = new Map<string, FileSnapshot>();
	for (const file of preSnapshot.files) {
		preMap.set(file.path, file);
	}

	const postMap = new Map<string, FileSnapshot>();
	for (const file of postSnapshot.files) {
		postMap.set(file.path, file);
	}

	// Detect added files
	for (const postFile of postSnapshot.files) {
		if (!preMap.has(postFile.path)) {
			diffs.push({
				path: postFile.path,
				status: "added",
				diff: generateAddedDiff(postFile),
				additions: countLines(postFile.content),
				deletions: 0,
				preSnapshot: null,
				postSnapshot: postFile,
			});
		}
	}

	// Detect deleted files
	for (const preFile of preSnapshot.files) {
		if (!postMap.has(preFile.path)) {
			diffs.push({
				path: preFile.path,
				status: "deleted",
				diff: generateDeletedDiff(preFile),
				additions: 0,
				deletions: countLines(preFile.content),
				preSnapshot: preFile,
				postSnapshot: null,
			});
		}
	}

	// Detect modified files (same path, different hash)
	for (const preFile of preSnapshot.files) {
		const postFile = postMap.get(preFile.path);
		if (postFile && preFile.hash !== postFile.hash) {
			const unifiedDiff = generateUnifiedDiff(preFile, postFile);
			const { additions, deletions } = countDiffChanges(unifiedDiff);
			diffs.push({
				path: preFile.path,
				status: "modified",
				diff: unifiedDiff,
				additions,
				deletions,
				preSnapshot: preFile,
				postSnapshot: postFile,
			});
		}
	}

	// Sort by path for deterministic output
	diffs.sort((a, b) => a.path.localeCompare(b.path));

	return diffs;
}

// ---------------------------------------------------------------------------
// Factory: computeSnapshotSummary
// ---------------------------------------------------------------------------

/**
 * Compute aggregate summary statistics from an array of SnapshotDiff entries.
 *
 * @param diffs - Array of computed file diffs
 * @param postFiles - Optional post-execution file count (for totalFiles)
 * @returns SnapshotArtifactSummary with aggregated statistics
 */
export function computeSnapshotSummary(diffs: SnapshotDiff[], postFiles?: number): SnapshotArtifactSummary {
	let addedFiles = 0;
	let modifiedFiles = 0;
	let deletedFiles = 0;
	let totalAdditions = 0;
	let totalDeletions = 0;

	for (const diff of diffs) {
		switch (diff.status) {
			case "added":
				addedFiles++;
				break;
			case "modified":
				modifiedFiles++;
				break;
			case "deleted":
				deletedFiles++;
				break;
		}
		totalAdditions += diff.additions;
		totalDeletions += diff.deletions;
	}

	return {
		totalFiles: postFiles ?? addedFiles + modifiedFiles,
		addedFiles,
		modifiedFiles,
		deletedFiles,
		totalAdditions,
		totalDeletions,
	};
}

// ---------------------------------------------------------------------------
// Factory: createSnapshotArtifact
// ---------------------------------------------------------------------------

/**
 * Create a complete SnapshotArtifact from pre and post workspace snapshots.
 *
 * This is the top-level factory that ties everything together:
 * 1. Computes the diff between pre and post snapshots
 * 2. Generates summary statistics
 * 3. Assembles the complete artifact
 *
 * If either snapshot is missing, diffs will be empty (not computed).
 *
 * @param planExecutionId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param attemptNumber - Attempt number
 * @param preSnapshot - Pre-execution snapshot (nullable)
 * @param postSnapshot - Post-execution snapshot (nullable)
 * @returns A complete SnapshotArtifact
 */
export function createSnapshotArtifact(
	planExecutionId: string,
	workspaceId: string,
	attemptNumber: number,
	preSnapshot: WorkspaceSnapshot | null,
	postSnapshot: WorkspaceSnapshot | null,
): SnapshotArtifact {
	const diffs = preSnapshot && postSnapshot ? computeSnapshotDiff(preSnapshot, postSnapshot) : [];

	const summary = computeSnapshotSummary(diffs, postSnapshot?.files.length);

	return {
		planExecutionId,
		workspaceId,
		attemptNumber,
		preSnapshot,
		postSnapshot,
		diffs,
		summary,
		generatedAt: Date.now(),
	};
}

// ===========================================================================
// Internal helpers
// ===========================================================================

/**
 * Extract the file extension from a path (lowercase, no leading dot).
 */
function extractExtension(path: string): string {
	const idx = path.lastIndexOf(".");
	if (idx === -1 || idx === path.length - 1) return "";
	return path.slice(idx + 1).toLowerCase();
}

/**
 * Map a file extension to a programming language name.
 */
function extToLanguage(ext: string): string | undefined {
	const languageMap: Record<string, string> = {
		ts: "TypeScript",
		tsx: "TypeScript React",
		js: "JavaScript",
		jsx: "JavaScript React",
		mjs: "JavaScript",
		cjs: "JavaScript",
		json: "JSON",
		md: "Markdown",
		yml: "YAML",
		yaml: "YAML",
		toml: "TOML",
		html: "HTML",
		css: "CSS",
		scss: "SCSS",
		sass: "Sass",
		less: "Less",
		py: "Python",
		rb: "Ruby",
		rs: "Rust",
		go: "Go",
		java: "Java",
		kt: "Kotlin",
		swift: "Swift",
		cpp: "C++",
		c: "C",
		h: "C Header",
		hpp: "C++ Header",
		sh: "Shell",
		bash: "Shell",
		zsh: "Shell",
		fish: "Shell",
		env: "Environment",
		gitignore: "Git Ignore",
		dockerfile: "Dockerfile",
	};
	return languageMap[ext];
}

/**
 * Count the number of non-empty lines in a content string.
 * Returns 0 for null content.
 */
function countLines(content: string | null): number {
	if (content === null) return 0;
	if (content.length === 0) return 0;
	return content.split("\n").filter((line) => line.length > 0).length;
}

/**
 * Generate a unified diff string for a newly added file.
 * Formats the entire file content as added lines with a unified diff header.
 */
function generateAddedDiff(postFile: FileSnapshot): string {
	const lines = postFile.content?.split("\n") ?? [];
	const header = `--- /dev/null\n+++ b/${postFile.path}\n@@ -0,0 +1,${lines.length} @@\n`;
	const body = lines
		.map((line) => `+${line}`)
		.join("\n")
		// Ensure trailing newline
		.concat(lines.length > 0 && !postFile.content?.endsWith("\n") ? "\n" : "");
	return header + body;
}

/**
 * Generate a unified diff string for a deleted file.
 * Formats the entire file content as removed lines with a unified diff header.
 */
function generateDeletedDiff(preFile: FileSnapshot): string {
	const lines = preFile.content?.split("\n") ?? [];
	const header = `--- a/${preFile.path}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n`;
	const body = lines
		.map((line) => `-${line}`)
		.join("\n")
		// Ensure trailing newline
		.concat(lines.length > 0 && !preFile.content?.endsWith("\n") ? "\n" : "");
	return header + body;
}

/**
 * Generate a unified diff string between two file snapshots.
 * Uses Myers-like diff via simple line-by-line comparison.
 *
 * For files with very different content (>50% lines changed), falls back
 * to showing the full old/new content.
 */
function generateUnifiedDiff(preFile: FileSnapshot, postFile: FileSnapshot): string {
	const oldLines = preFile.content?.split("\n") ?? [];
	const newLines = postFile.content?.split("\n") ?? [];

	// Compute LCS-based diff
	const diffOperations = computeLineDiff(oldLines, newLines);

	// Build unified diff
	const contextLines = 3;
	const header = `--- a/${preFile.path}\n+++ b/${postFile.path}\n`;

	if (diffOperations.length === 0) {
		return header;
	}

	const hunks = buildHunks(diffOperations, oldLines, newLines, contextLines);

	if (hunks.length === 0) {
		return header;
	}

	let output = header;
	for (const hunk of hunks) {
		output += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`;
		for (const line of hunk.lines) {
			output += `${line}\n`;
		}
	}

	return output;
}

/**
 * A single diff operation in the LCS-based comparison.
 */
interface DiffOp {
	type: "equal" | "delete" | "insert";
	oldLineIdx: number;
	newLineIdx: number;
}

/**
 * Compute line-level diff operations between two arrays of lines
 * using a simple LCS (Longest Common Subsequence) algorithm.
 *
 * Returns an array of DiffOp entries describing how to transform
 * oldLines into newLines.
 */
function computeLineDiff(oldLines: string[], newLines: string[]): DiffOp[] {
	// Use LCS to find the longest common subsequence
	const m = oldLines.length;
	const n = newLines.length;

	// Build DP table
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to produce diff operations
	const ops: DiffOp[] = [];
	let i = m;
	let j = n;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			ops.unshift({ type: "equal", oldLineIdx: i - 1, newLineIdx: j - 1 });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			ops.unshift({ type: "insert", oldLineIdx: i, newLineIdx: j - 1 });
			j--;
		} else if (i > 0) {
			ops.unshift({ type: "delete", oldLineIdx: i - 1, newLineIdx: j });
			i--;
		}
	}

	return ops;
}

/**
 * A unified diff hunk — a grouped set of changes with context.
 */
interface DiffHunk {
	oldStart: number;
	newStart: number;
	oldCount: number;
	newCount: number;
	lines: string[];
}

/**
 * Build unified diff hunks from an array of diff operations.
 * Groups changes with surrounding context lines.
 */
function buildHunks(ops: DiffOp[], oldLines: string[], newLines: string[], contextLines: number): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	let i = 0;

	while (i < ops.length) {
		// Skip equal regions until we find a change
		while (i < ops.length && ops[i].type === "equal") {
			i++;
		}
		if (i >= ops.length) break;

		// Found start of a change region
		const hunkStart = Math.max(0, i - contextLines);

		// Collect change region + trailing context
		let j = i;
		while (j < ops.length) {
			if (ops[j].type === "equal") {
				// Count consecutive equal lines
				let eqCount = 0;
				while (j < ops.length && ops[j].type === "equal") {
					eqCount++;
					j++;
				}
				if (eqCount > contextLines * 2) {
					// Too many equal lines — end this hunk
					j -= eqCount - contextLines;
					break;
				}
			} else {
				j++;
			}
		}

		const hunkEnd = Math.min(ops.length, j + contextLines);

		// Build hunk lines
		const hunkLines: string[] = [];
		let oldLineNum = hunkStart > 0 ? oldLines.length : 1;
		let newLineNum = hunkStart > 0 ? newLines.length : 1;

		// Find the old/new line numbers at hunk start
		if (hunkStart > 0) {
			const prevOp = ops[hunkStart - 1];
			if (prevOp.type === "equal") {
				oldLineNum = prevOp.oldLineIdx + 2;
				newLineNum = prevOp.newLineIdx + 2;
			}
		}

		for (let k = hunkStart; k < hunkEnd && k < ops.length; k++) {
			const op = ops[k];
			switch (op.type) {
				case "equal": {
					const line = oldLines[op.oldLineIdx] ?? "";
					hunkLines.push(` ${line}`);
					oldLineNum = op.oldLineIdx + 2;
					newLineNum = op.newLineIdx + 2;
					break;
				}
				case "delete": {
					const line = oldLines[op.oldLineIdx] ?? "";
					hunkLines.push(`-${line}`);
					oldLineNum = op.oldLineIdx + 2;
					break;
				}
				case "insert": {
					const line = newLines[op.newLineIdx] ?? "";
					hunkLines.push(`+${line}`);
					newLineNum = op.newLineIdx + 2;
					break;
				}
			}
		}

		// Calculate hunk metadata
		const oldStart = hunkStart > 0 && ops[hunkStart] ? ops[hunkStart].oldLineIdx + 1 : 1;
		const newStart = hunkStart > 0 && ops[hunkStart] ? ops[hunkStart].newLineIdx + 1 : 1;
		const oldCount = hunkLines.filter((l) => !l.startsWith("+")).length;
		const newCount = hunkLines.filter((l) => !l.startsWith("-")).length;

		hunks.push({
			oldStart,
			newStart,
			oldCount,
			newCount,
			lines: hunkLines,
		});

		i = hunkEnd;
	}

	return hunks;
}

/**
 * Count additions and deletions from a unified diff string.
 * Non-prefixed lines (context) are not counted.
 */
function countDiffChanges(diff: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;

	const lines = diff.split("\n");
	for (const line of lines) {
		if (line.startsWith("+") && !line.startsWith("+++")) {
			additions++;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			deletions++;
		}
	}

	return { additions, deletions };
}
