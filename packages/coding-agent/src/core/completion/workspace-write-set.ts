/**
 * P44.08 — Workspace WriteSet
 *
 * Defines the types and utilities for managing workspace write sets in the
 * completion subsystem. A write set is the set of files a workspace is
 * authorized to create, modify, or delete during execution.
 *
 * This module provides:
 * - Type definitions for write set entries and tracking
 * - Pattern matching against write set globs
 * - Empirical write set computation from git state
 * - Comparison between declared and actual write sets
 *
 * Used by:
 * - WorkspaceCommitGate (P44.08) for commit gate
 * - CompletionGate for post-execution validation
 * - WriteSetDriftDetector for drift analysis
 */

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for write set artifacts.
 */
export const WRITE_SET_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of a file in a write set.
 */
export type WriteSetFileStatus = "created" | "modified" | "deleted" | "unchanged" | "unexpected";

/**
 * Information about a single file in a write set.
 */
export interface WriteSetFileEntry {
	/** Repository-relative path to the file */
	path: string;
	/** Status of the file relative to the base commit */
	status: WriteSetFileStatus;
	/** Size in bytes (0 for deleted files) */
	size: number;
	/** Whether the file is explicitly declared in the workspace write set */
	declared: boolean;
	/** Whether the file is an allowed generated artifact */
	artifact?: boolean;
}

/**
 * A workspace write set snapshot.
 */
export interface WorkspaceWriteSet {
	/** Workspace identifier */
	workspaceId: string;
	/** Plan execution identifier */
	planExecId: string;
	/** Declared write set patterns from the workspace spec */
	declaredPatterns: string[];
	/** Declared artifact glob patterns */
	artifactPatterns: string[];
	/** Files in the write set (declared or empirical) */
	files: WriteSetFileEntry[];
}

/**
 * Result of comparing declared vs empirical write sets.
 */
export interface WriteSetComparisonResult {
	/** Files that were expected and changed as expected */
	matched: WriteSetFileEntry[];
	/** Files that were changed but not declared */
	unexpected: WriteSetFileEntry[];
	/** Files that were declared but not changed */
	unused: WriteSetFileEntry[];
	/** Whether all changes are within the declared write set */
	covered: boolean;
	/** Summary message */
	summary: string;
}

// ---------------------------------------------------------------------------
// Pattern Matching
// ---------------------------------------------------------------------------

/**
 * Check whether a file path matches any pattern in a write set.
 *
 * Supports:
 * - Exact matches: "src/main.ts"
 * - Directory prefix: "src/core/" matches "src/core/foo.ts"
 * - Glob stars: "dir/**" matches "dir/sub/foo.ts"
 * - Extension globs: "*.ts" matches "foo.ts"
 * - Single-level globs: "src/*.ts" matches "src/foo.ts"
 *
 * @param filePath - Repository-relative file path (forward slashes)
 * @param patterns - Write set patterns to check against
 * @returns True if the file matches any pattern
 */
export function isFileInWriteSet(filePath: string, patterns: string[]): boolean {
	const normalized = filePath.replace(/\\/g, "/");

	for (const rawPattern of patterns) {
		const pattern = rawPattern.replace(/\\/g, "/");

		// Exact match
		if (pattern === normalized) return true;

		// Directory prefix (trailing slash)
		if (pattern.endsWith("/") && normalized.startsWith(pattern)) return true;

		// Glob: dir/** matches all children recursively
		if (pattern.endsWith("/**")) {
			const prefix = pattern.slice(0, -3);
			if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return true;
		}

		// Extension glob: *.ext
		if (pattern.startsWith("*.")) {
			const ext = pattern.slice(1);
			if (normalized.endsWith(ext)) return true;
		}

		// General glob with wildcards
		if (pattern.includes("*")) {
			const regexStr =
				"^" +
				pattern
					.split("/")
					.map((part) => {
						if (part === "**") return ".*";
						if (part.includes("*")) {
							return part.replace(/\./g, "\\.").replace(/\*/g, "[^/]*");
						}
						return part.replace(/\./g, "\\.");
					})
					.join("/") +
				"$";
			try {
				if (new RegExp(regexStr).test(normalized)) return true;
			} catch {
				// Malformed pattern, skip
			}
		}
	}

	return false;
}

// ---------------------------------------------------------------------------
// Empirical Write Set Computation
// ---------------------------------------------------------------------------

/**
 * Compute the empirical write set from git state relative to a base commit.
 *
 * Uses `git diff --name-status` to find files that were created, modified,
 * or deleted since the base commit.
 *
 * @param repoRoot - Repository root path
 * @param baseCommit - Base commit SHA (default: HEAD)
 * @returns Array of file entries with status
 */
export function computeEmpiricalWriteSet(repoRoot: string, baseCommit?: string): WriteSetFileEntry[] {
	const base = baseCommit ?? "HEAD";
	const entries: WriteSetFileEntry[] = [];

	try {
		// Tracked changes (modified, deleted, staged additions) vs base
		const trackedOutput = execSync(`git diff --name-status ${base}`, {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});

		for (const line of trackedOutput.trim().split("\n")) {
			if (!line.trim()) continue;

			const statusChar = line.charAt(0);
			const filePath = line.slice(1).trim();
			if (!filePath) continue;

			let status: WriteSetFileStatus;
			switch (statusChar) {
				case "A":
					status = "created";
					break;
				case "M":
					status = "modified";
					break;
				case "D":
					status = "deleted";
					break;
				default:
					status = "modified";
					break;
			}

			if (!entries.some((e) => e.path === filePath)) {
				entries.push({
					path: filePath,
					status,
					size: status === "deleted" ? 0 : _getFileSize(repoRoot, filePath),
					declared: false,
				});
			}
		}
	} catch {
		// Ignore errors from git diff
	}

	try {
		// Staged but not committed additions (tracked via diff --cached)
		const stagedOutput = execSync(`git diff --cached --name-status ${base}`, {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});

		for (const line of stagedOutput.trim().split("\n")) {
			if (!line.trim()) continue;
			const statusChar = line.charAt(0);
			const filePath = line.slice(1).trim();
			if (!filePath) continue;

			if (entries.some((e) => e.path === filePath)) continue;

			const status: WriteSetFileStatus = statusChar === "D" ? "deleted" : "created";
			entries.push({
				path: filePath,
				status,
				size: status === "deleted" ? 0 : _getFileSize(repoRoot, filePath),
				declared: false,
			});
		}
	} catch {
		// Ignore errors from git diff --cached
	}

	try {
		// Untracked files (not yet staged)
		const untrackedOutput = execSync("git ls-files --others --exclude-standard", {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});

		for (const filePath of untrackedOutput.trim().split("\n")) {
			if (!filePath.trim()) continue;
			if (entries.some((e) => e.path === filePath)) continue;

			entries.push({
				path: filePath,
				status: "created",
				size: _getFileSize(repoRoot, filePath),
				declared: false,
			});
		}
	} catch {
		// Ignore errors from git ls-files
	}

	return entries;
}

/**
 * Classify empirical files against declared patterns.
 *
 * @param empiricalFiles - Files from empirical write set
 * @param declaredPatterns - Declared write set patterns
 * @param artifactPatterns - Allowed artifact glob patterns
 * @returns Classified file entries with declared/artifact flags
 */
export function classifyEmpiricalWriteSet(
	empiricalFiles: WriteSetFileEntry[],
	declaredPatterns: string[],
	artifactPatterns: string[] = [],
): WriteSetFileEntry[] {
	return empiricalFiles.map((entry) => {
		const declared = isFileInWriteSet(entry.path, declaredPatterns);
		const artifact = !declared && isFileInWriteSet(entry.path, artifactPatterns);
		// Keep original status for declared or artifact files; mark as unexpected otherwise
		const status: WriteSetFileStatus = declared || artifact ? entry.status : "unexpected";
		return {
			...entry,
			declared,
			artifact: artifact || undefined,
			status,
		};
	});
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare a classified write set against declared patterns.
 *
 * @param classifiedFiles - Files classified against declared patterns
 * @param declaredPatterns - Declared write set patterns (for unused detection)
 * @returns Comparison result
 */
export function compareWriteSets(
	classifiedFiles: WriteSetFileEntry[],
	declaredPatterns: string[],
): WriteSetComparisonResult {
	const matched: WriteSetFileEntry[] = [];
	const unexpected: WriteSetFileEntry[] = [];
	const usedPatterns = new Set<string>();

	for (const entry of classifiedFiles) {
		if (entry.declared || entry.artifact) {
			matched.push(entry);
			// Track which patterns were used
			for (const pattern of declaredPatterns) {
				if (isFileInWriteSet(entry.path, [pattern])) {
					usedPatterns.add(pattern);
				}
			}
		} else {
			unexpected.push({ ...entry, status: "unexpected" });
		}
	}

	// Unused patterns: declared but no file matched
	const unused: WriteSetFileEntry[] = declaredPatterns
		.filter((p) => !usedPatterns.has(p))
		.map((p) => ({
			path: p,
			status: "unchanged" as WriteSetFileStatus,
			size: 0,
			declared: true,
		}));

	const covered = unexpected.length === 0;

	return {
		matched,
		unexpected,
		unused,
		covered,
		summary: covered
			? `All ${matched.length} changed files are within the declared write set`
			: `${unexpected.length} file(s) changed outside the declared write set`,
	};
}

// ---------------------------------------------------------------------------
// Formatting / Reporting
// ---------------------------------------------------------------------------

/**
 * Build a workspace write set snapshot from declared patterns and empirical data.
 *
 * @param workspaceId - Workspace identifier
 * @param planExecId - Plan execution identifier
 * @param declaredPatterns - Declared write set patterns
 * @param artifactPatterns - Allowed artifact glob patterns
 * @param baseCommit - Base commit for empirical comparison
 * @param repoRoot - Repository root path
 * @returns WorkspaceWriteSet snapshot
 */
export function buildWorkspaceWriteSet(
	workspaceId: string,
	planExecId: string,
	declaredPatterns: string[],
	artifactPatterns: string[] = [],
	baseCommit: string | undefined,
	repoRoot: string,
): WorkspaceWriteSet {
	const empirical = computeEmpiricalWriteSet(repoRoot, baseCommit);
	const classified = classifyEmpiricalWriteSet(empirical, declaredPatterns, artifactPatterns);

	return {
		workspaceId,
		planExecId,
		declaredPatterns,
		artifactPatterns,
		files: classified,
	};
}

/**
 * Format a write set comparison result as a human-readable string.
 *
 * @param result - Comparison result to format
 * @returns Formatted string
 */
export function formatWriteSetComparison(result: WriteSetComparisonResult): string {
	const parts: string[] = [];

	parts.push(`Total: ${result.matched.length + result.unexpected.length} files`);
	parts.push(`Matched: ${result.matched.length} files`);
	parts.push(`Unexpected: ${result.unexpected.length} files`);
	parts.push(`Unused declared patterns: ${result.unused.length}`);

	if (result.unexpected.length > 0) {
		parts.push("");
		parts.push("Unexpected files:");
		for (const entry of result.unexpected) {
			parts.push(`  - ${entry.path} (${entry.status})`);
		}
	}

	if (result.unused.length > 0) {
		parts.push("");
		parts.push("Unused declared patterns:");
		for (const entry of result.unused) {
			parts.push(`  - ${entry.path}`);
		}
	}

	return parts.join("\n");
}

/**
 * Check if a file path matches any allowed artifact pattern.
 *
 * @param filePath - Repository-relative file path
 * @param artifactPatterns - Allowed artifact glob patterns
 * @returns True if the file matches an artifact pattern
 */
export function isAllowedArtifact(filePath: string, artifactPatterns: string[]): boolean {
	return isFileInWriteSet(filePath, artifactPatterns);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get the file size of a repository file.
 */
function _getFileSize(repoRoot: string, filePath: string): number {
	try {
		const output = execSync(`stat --format="%s" "${filePath}" 2>/dev/null || echo 0`, {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		return Number.parseInt(output.trim(), 10) || 0;
	} catch {
		return 0;
	}
}
