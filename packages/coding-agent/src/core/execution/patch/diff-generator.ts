/**
 * Diff Generator - P37.04 Workstream
 *
 * Generates unified diffs between original and modified file contents.
 * Supports created, deleted, and modified files.
 *
 * The diff format follows standard unified diff format:
 * ```
 * --- a/<path>
 * +++ b/<path>
 * @@ -line,count +line,count @@
 *  context
 * -removed
 * +added
 * ```
 */

import type { Dirent } from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a diff operation.
 */
export interface DiffResult {
	/**
	 * The unified diff text.
	 * For created files: diff from /dev/null to new content.
	 * For deleted files: diff from old content to /dev/null.
	 * For modified files: standard old-to-new unified diff.
	 */
	diff: string;

	/**
	 * The file path relative to the workspace root.
	 */
	filePath: string;

	/**
	 * The type of change.
	 */
	type: "created" | "deleted" | "modified";
}

/**
 * Options for generating a diff.
 */
export interface DiffGeneratorOptions {
	/**
	 * Number of context lines around each change.
	 * Default: 3
	 */
	contextLines?: number;

	/**
	 * Label for the "original" side. Default: "a"
	 */
	originalLabel?: string;

	/**
	 * Label for the "modified" side. Default: "b"
	 */
	modifiedLabel?: string;
}

// ---------------------------------------------------------------------------
// Line-based diff using LCS
// ---------------------------------------------------------------------------

/**
 * Represents a single diff operation.
 */
interface DiffOp {
	type: "equal" | "insert" | "delete";
	lines: string[];
}

/**
 * Compute the longest common subsequence table for two arrays of lines.
 */
function computeLcs(a: string[], b: string[]): number[][] {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}
	return dp;
}

/**
 * Backtrack through the LCS table to produce diff operations.
 */
function backtrack(a: string[], b: string[], dp: number[][], i: number, j: number): DiffOp[] {
	if (i === 0 && j === 0) return [];
	if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
		const ops = backtrack(a, b, dp, i - 1, j - 1);
		ops.push({ type: "equal", lines: [a[i - 1]] });
		return ops;
	}
	if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
		const ops = backtrack(a, b, dp, i, j - 1);
		ops.push({ type: "insert", lines: [b[j - 1]] });
		return ops;
	}
	if (i > 0) {
		const ops = backtrack(a, b, dp, i - 1, j);
		ops.push({ type: "delete", lines: [a[i - 1]] });
		return ops;
	}
	return [];
}

/**
 * Compute the diff ops between two arrays of lines.
 */
function computeDiff(a: string[], b: string[]): DiffOp[] {
	const dp = computeLcs(a, b);
	return backtrack(a, b, dp, a.length, b.length);
}

// ---------------------------------------------------------------------------
// Unified diff formatting
// ---------------------------------------------------------------------------

/**
 * Format diff operations as a unified diff string.
 */
function formatUnifiedDiff(
	ops: DiffOp[],
	filePath: string,
	originalLabel: string,
	modifiedLabel: string,
	contextLines: number,
): string {
	const header = `--- ${originalLabel}/${filePath}\n+++ ${modifiedLabel}/${filePath}\n`;
	const chunks: string[] = [];

	let i = 0;
	while (i < ops.length) {
		// Skip leading context that won't be part of any hunk
		while (i < ops.length && ops[i].type === "equal") {
			i++;
		}
		if (i >= ops.length) break;

		// Find the end of this change region
		let end = i;
		while (end < ops.length && ops[end].type !== "equal") {
			end++;
		}
		// Add trailing context
		let trailingContext = 0;
		while (
			end + trailingContext < ops.length &&
			trailingContext < contextLines &&
			ops[end + trailingContext].type === "equal"
		) {
			trailingContext++;
		}
		end += trailingContext;

		// Add leading context
		const leadingStart = Math.max(i - contextLines, 0);

		// Calculate positions for the hunk header
		const oldStartLine =
			ops
				.slice(0, leadingStart)
				.filter((op) => op.type !== "insert")
				.reduce((sum, op) => sum + op.lines.length, 0) + 1;
		const newStartLine =
			ops
				.slice(0, leadingStart)
				.filter((op) => op.type !== "delete")
				.reduce((sum, op) => sum + op.lines.length, 0) + 1;

		let oldCount = 0;
		let newCount = 0;
		const hunkLines: string[] = [];

		// Leading context
		for (let k = leadingStart; k < i; k++) {
			if (ops[k].type === "equal") {
				for (const line of ops[k].lines) {
					hunkLines.push(` ${line}`);
					oldCount++;
					newCount++;
				}
			}
		}

		// Changes
		for (let k = i; k < end; k++) {
			const op = ops[k];
			if (op.type === "equal") {
				for (const line of op.lines) {
					hunkLines.push(` ${line}`);
					oldCount++;
					newCount++;
				}
			} else if (op.type === "delete") {
				for (const line of op.lines) {
					hunkLines.push(`-${line}`);
					oldCount++;
				}
			} else {
				for (const line of op.lines) {
					hunkLines.push(`+${line}`);
					newCount++;
				}
			}
		}

		chunks.push(`@@ -${oldStartLine},${oldCount} +${newStartLine},${newCount} @@\n${hunkLines.join("\n")}`);

		i = end;
	}

	if (chunks.length === 0) {
		return header; // No differences
	}

	return `${header + chunks.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Default options for diff generation.
 */
const DEFAULT_DIFF_OPTIONS: Required<DiffGeneratorOptions> = {
	contextLines: 3,
	originalLabel: "a",
	modifiedLabel: "b",
};

/**
 * Generate a unified diff for a modified file.
 *
 * @param originalContent - The original file content (before changes)
 * @param modifiedContent - The new file content (after changes)
 * @param filePath - Relative file path for the diff header
 * @param options - Diff generation options
 * @returns Unified diff string
 */
export function generateFileDiff(
	originalContent: string,
	modifiedContent: string,
	filePath: string,
	options?: DiffGeneratorOptions,
): string {
	const opts = { ...DEFAULT_DIFF_OPTIONS, ...options };

	const originalLines = originalContent === "" ? [] : originalContent.split("\n");
	const modifiedLines = modifiedContent === "" ? [] : modifiedContent.split("\n");

	const ops = computeDiff(originalLines, modifiedLines);
	return formatUnifiedDiff(ops, filePath, opts.originalLabel, opts.modifiedLabel, opts.contextLines);
}

/**
 * Generate a diff for a created file (from /dev/null to new content).
 *
 * @param content - The new file content
 * @param filePath - Relative file path for the diff header
 * @param options - Diff generation options
 * @returns Unified diff string showing file creation
 */
export function generateCreatedFileDiff(content: string, filePath: string, options?: DiffGeneratorOptions): string {
	const opts = { ...DEFAULT_DIFF_OPTIONS, ...options };
	const lines = content === "" ? [] : content.split("\n");

	const header = `--- /dev/null\n+++ ${opts.modifiedLabel}/${filePath}\n`;
	if (lines.length === 0) {
		return `${header}@@ -0,0 +1,0 @@\n`;
	}

	const hunkLines = lines.map((l) => `+${l}`);
	return `${header}@@ -0,0 +1,${lines.length} @@\n${hunkLines.join("\n")}\n`;
}

/**
 * Generate a diff for a deleted file (from content to /dev/null).
 *
 * @param content - The original file content being deleted
 * @param filePath - Relative file path for the diff header
 * @param options - Diff generation options
 * @returns Unified diff string showing file deletion
 */
export function generateDeletedFileDiff(content: string, filePath: string, options?: DiffGeneratorOptions): string {
	const opts = { ...DEFAULT_DIFF_OPTIONS, ...options };
	const lines = content === "" ? [] : content.split("\n");

	const header = `--- ${opts.originalLabel}/${filePath}\n+++ /dev/null\n`;
	if (lines.length === 0) {
		return `${header}@@ -1,0 +0,0 @@\n`;
	}

	const hunkLines = lines.map((l) => `-${l}`);
	return `${header}@@ -1,${lines.length} +0,0 @@\n${hunkLines.join("\n")}\n`;
}

/**
 * Generate a DiffResult for a file change.
 *
 * Automatically detects the change type based on original and modified content:
 * - If original is null/undefined: treat as created
 * - If modified is null/undefined: treat as deleted
 * - Otherwise: treat as modified
 *
 * @param filePath - Relative file path
 * @param originalContent - Original file content (null/undefined for created files)
 * @param modifiedContent - Modified file content (null/undefined for deleted files)
 * @param options - Diff generation options
 * @returns DiffResult with the unified diff and change type
 */
export function generateDiff(
	filePath: string,
	originalContent: string | null | undefined,
	modifiedContent: string | null | undefined,
	options?: DiffGeneratorOptions,
): DiffResult {
	if (!originalContent) {
		const content = modifiedContent ?? "";
		return {
			diff: generateCreatedFileDiff(content, filePath, options),
			filePath,
			type: "created",
		};
	}

	if (!modifiedContent) {
		return {
			diff: generateDeletedFileDiff(originalContent, filePath, options),
			filePath,
			type: "deleted",
		};
	}

	return {
		diff: generateFileDiff(originalContent, modifiedContent, filePath, options),
		filePath,
		type: "modified",
	};
}

/**
 * Compare two directories and produce diffs for all changed files.
 *
 * @param originalDir - Path to the original directory (base checkout)
 * @param modifiedDir - Path to the modified directory (overlay/worktree)
 * @param options - Diff generation options
 * @returns Array of DiffResult for each changed file
 */
export async function generateDirectoryDiffs(
	originalDir: string,
	modifiedDir: string,
	options?: DiffGeneratorOptions,
): Promise<DiffResult[]> {
	const results: DiffResult[] = [];
	const allFiles = new Set<string>();

	// Collect all files from both directories
	await collectFiles(originalDir, "", allFiles);
	await collectFiles(modifiedDir, "", allFiles);

	// Generate diff for each file
	for (const relativePath of allFiles) {
		const originalPath = path.join(originalDir, relativePath);
		const modifiedPath = path.join(modifiedDir, relativePath);

		let originalContent: string | null = null;
		let modifiedContent: string | null = null;

		try {
			originalContent = await fsPromises.readFile(originalPath, "utf-8");
		} catch {
			// File doesn't exist in original — it was created
		}

		try {
			modifiedContent = await fsPromises.readFile(modifiedPath, "utf-8");
		} catch {
			// File doesn't exist in modified — it was deleted
		}

		// Skip files that are identical (both exist and have same content)
		if (originalContent !== null && modifiedContent !== null && originalContent === modifiedContent) {
			continue;
		}

		results.push(generateDiff(relativePath, originalContent, modifiedContent, options));
	}

	return results;
}

/**
 * Recursively collect all files in a directory.
 */
async function collectFiles(dirPath: string, prefix: string, results: Set<string>): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
	} catch {
		return; // Directory doesn't exist
	}

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			if (entry.name === ".git") continue;
			await collectFiles(fullPath, relativePath, results);
		} else if (entry.isFile()) {
			results.add(relativePath);
		}
	}
}
