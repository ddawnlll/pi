/**
 * Patch Guards - P37.03 Workstream
 *
 * Guard checks that run before a patch is applied:
 *
 * 1. WriteSetGuard: Verifies file operations only touch files declared in the writeSet.
 * 2. ForbiddenPathGuard: Verifies no file operations target forbidden paths (e.g., .git/,
 *    .pi/private/, node_modules/, etc.).
 * 3. StaleHashGuard: Verifies the git baseSha matches the current HEAD or is an ancestor.
 * 4. ApplyGuard: Validates that the file operations can be applied (pre-apply validation).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createGitRunner } from "@earendil-works/pi-execution-service";
import type { PatchArtifact } from "./patch-artifact.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a single guard check.
 */
export interface GuardResult {
	/** Whether the guard check passed */
	passed: boolean;
	/** Human-readable message (empty when passed) */
	message: string;
	/** Error code for categorisation */
	code: GuardErrorCode;
}

/**
 * Error codes for guard failures.
 */
export type GuardErrorCode =
	| "OK"
	| "WRITE_SET_VIOLATION"
	| "FORBIDDEN_PATH"
	| "STALE_HASH"
	| "APPLY_VALIDATION_FAILED"
	| "INTERNAL_ERROR";

/**
 * Collection of all guard results for a patch.
 */
export interface PatchGuardResult {
	/** Overall pass/fail (all guards must pass) */
	allPassed: boolean;
	/** Individual guard results */
	writeSet: GuardResult;
	forbiddenPath: GuardResult;
	staleHash: GuardResult;
	applyValidation: GuardResult;
}

/**
 * Default forbidden path patterns that no patch should ever touch.
 */
export const DEFAULT_FORBIDDEN_PATTERNS: string[] = [
	".git/",
	".pi/private/",
	".pi/keys/",
	".pi/secrets/",
	".pi/auth.json",
	"node_modules/",
];

/**
 * Options for WriteSetGuard.
 */
export interface WriteSetGuardOptions {
	/**
	 * When true, files that are not in the writeSet but share a common
	 * ancestor directory with declared files are flagged as violations.
	 * Default: false.
	 */
	strict?: boolean;
}

/**
 * Options for ForbiddenPathGuard.
 */
export interface ForbiddenPathGuardOptions {
	/**
	 * Extra patterns to forbid beyond DEFAULT_FORBIDDEN_PATTERNS.
	 * Each pattern can be a directory path (ending in /) or an exact
	 * file path.
	 */
	extraPatterns?: string[];
}

/**
 * Options for StaleHashGuard.
 */
export interface StaleHashGuardOptions {
	/**
	 * Git working directory to check HEAD against.
	 */
	gitCwd?: string;
}

/**
 * Configuration for all guards used by PatchCoordinator.
 */
export interface PatchGuardConfig {
	writeSet?: WriteSetGuardOptions;
	forbiddenPath?: ForbiddenPathGuardOptions;
	staleHash?: StaleHashGuardOptions;
}

// ---------------------------------------------------------------------------
// WriteSetGuard
// ---------------------------------------------------------------------------

/**
 * Verify that every file operation in the patch targets a file declared
 * in the writeSet.
 *
 * A violation occurs when a file operation's filePath is NOT in the
 * writeSet.files list AND does not match any writeSet.patterns glob.
 */
export function checkWriteSet(
	artifact: Pick<PatchArtifact, "fileOperations" | "writeSet">,
	_options?: WriteSetGuardOptions,
): GuardResult {
	const declaredFiles = new Set(artifact.writeSet.files.map((f) => f.replace(/\\/g, "/")));
	const declaredPatterns = artifact.writeSet.patterns ?? [];

	// Find violating operations
	const violations: string[] = [];

	for (const op of artifact.fileOperations) {
		const normalizedPath = op.filePath.replace(/\\/g, "/");

		if (declaredFiles.has(normalizedPath)) {
			continue; // File is explicitly declared
		}

		if (matchesAnyPattern(normalizedPath, declaredPatterns)) {
			continue; // File matches a declared pattern
		}

		violations.push(normalizedPath);
	}

	if (violations.length > 0) {
		return {
			passed: false,
			message: `WriteSet violation: file(s) [${violations.join(", ")}] are not declared in the writeSet`,
			code: "WRITE_SET_VIOLATION",
		};
	}

	return {
		passed: true,
		message: "",
		code: "OK",
	};
}

// ---------------------------------------------------------------------------
// ForbiddenPathGuard
// ---------------------------------------------------------------------------

/**
 * Verify that no file operation targets a forbidden path.
 */
export function checkForbiddenPaths(
	artifact: Pick<PatchArtifact, "fileOperations">,
	options?: ForbiddenPathGuardOptions,
): GuardResult {
	const forbiddenPatterns = [...DEFAULT_FORBIDDEN_PATTERNS, ...(options?.extraPatterns ?? [])];

	const violations: string[] = [];

	for (const op of artifact.fileOperations) {
		const normalizedPath = op.filePath.replace(/\\/g, "/");

		if (isForbiddenPath(normalizedPath, forbiddenPatterns)) {
			violations.push(normalizedPath);
		}
	}

	if (violations.length > 0) {
		return {
			passed: false,
			message: `Forbidden path violation: file(s) [${violations.join(", ")}] target forbidden paths`,
			code: "FORBIDDEN_PATH",
		};
	}

	return {
		passed: true,
		message: "",
		code: "OK",
	};
}

// ---------------------------------------------------------------------------
// StaleHashGuard
// ---------------------------------------------------------------------------

/**
 * Verify that the patch's baseSha is not stale compared to the current
 * git HEAD. The baseSha must either equal HEAD or be an ancestor of HEAD.
 *
 * Uses the workspace git repository for comparison.
 */
export async function checkStaleHash(
	artifact: Pick<PatchArtifact, "baseSha">,
	workspaceRoot: string,
	options?: StaleHashGuardOptions,
): Promise<GuardResult> {
	const baseSha = artifact.baseSha;
	if (!baseSha) {
		return {
			passed: false,
			message: "Stale hash check failed: patch has no baseSha",
			code: "STALE_HASH",
		};
	}

	const gitCwd = options?.gitCwd ?? workspaceRoot;

	try {
		// Get current HEAD
		const runner = createGitRunner({
			planExecId: "",
			workspaceId: "",
			leaseId: "",
			cwd: gitCwd,
		});

		const headResult = await runner.read(["rev-parse", "HEAD"], { cwd: gitCwd });
		const currentHead = headResult.stdout?.trim();

		if (!currentHead) {
			return {
				passed: false,
				message: "Stale hash check failed: unable to read current HEAD",
				code: "STALE_HASH",
			};
		}

		// If baseSha equals HEAD, it's not stale
		if (baseSha === currentHead) {
			return {
				passed: true,
				message: "",
				code: "OK",
			};
		}

		// Check if baseSha is an ancestor of HEAD (merge-base test)
		const mergeBaseResult = await runner.read(["merge-base", "--is-ancestor", baseSha, currentHead], { cwd: gitCwd });

		if (mergeBaseResult.exitCode === 0) {
			// baseSha is an ancestor of HEAD - acceptable
			return {
				passed: true,
				message: "",
				code: "OK",
			};
		}

		// baseSha is not an ancestor - stale
		return {
			passed: false,
			message: `Stale hash: patch baseSha ${baseSha} is not an ancestor of current HEAD ${currentHead}`,
			code: "STALE_HASH",
		};
	} catch (error) {
		return {
			passed: false,
			message: `Stale hash check failed: ${error instanceof Error ? error.message : String(error)}`,
			code: "STALE_HASH",
		};
	}
}

// ---------------------------------------------------------------------------
// ApplyGuard
// ---------------------------------------------------------------------------

/**
 * Pre-apply validation of file operations.
 *
 * Checks:
 * - For edit operations: the file must exist and oldText (if provided) must
 *   be found in the file content.
 * - For delete operations: the file must exist.
 * - For create operations: the file must not already exist.
 */
export async function checkApplyValidation(
	artifact: Pick<PatchArtifact, "fileOperations">,
	workspaceRoot: string,
): Promise<GuardResult> {
	const results: string[] = [];

	for (const op of artifact.fileOperations) {
		const fullPath = path.resolve(workspaceRoot, op.filePath);
		const fileExists = await fileExistsCheck(fullPath);

		switch (op.operation) {
			case "edit": {
				if (!fileExists) {
					results.push(`Edit operation on "${op.filePath}" fails: file does not exist`);
					continue;
				}

				if (op.oldText) {
					const content = await fs.readFile(fullPath, "utf-8").catch(() => null);
					if (content !== null && !content.includes(op.oldText)) {
						results.push(`Edit operation on "${op.filePath}" fails: oldText not found in file content`);
					}
				}
				break;
			}
			case "delete": {
				if (!fileExists) {
					results.push(`Delete operation on "${op.filePath}" fails: file does not exist`);
				}
				break;
			}
			case "create": {
				if (fileExists) {
					results.push(`Create operation on "${op.filePath}" fails: file already exists`);
				}
				break;
			}
		}
	}

	if (results.length > 0) {
		return {
			passed: false,
			message: `Apply validation failed: ${results.join("; ")}`,
			code: "APPLY_VALIDATION_FAILED",
		};
	}

	return {
		passed: true,
		message: "",
		code: "OK",
	};
}

// ---------------------------------------------------------------------------
// Composite Guard Check
// ---------------------------------------------------------------------------

/**
 * Run all guard checks for a patch artifact.
 *
 * Runs synchronous guards first (writeSet, forbiddenPath), then async
 * guards (staleHash, applyValidation). Returns a combined result.
 *
 * @param artifact - The patch artifact to guard check
 * @param workspaceRoot - Workspace root directory
 * @param config - Optional guard configuration
 * @returns Compiled guard result
 */
export async function runAllGuards(
	artifact: PatchArtifact,
	workspaceRoot: string,
	config?: PatchGuardConfig,
): Promise<PatchGuardResult> {
	// Run synchronous guards
	const writeSetResult = checkWriteSet(artifact, config?.writeSet);
	const forbiddenPathResult = checkForbiddenPaths(artifact, config?.forbiddenPath);

	// If sync guards fail, still run async guards to provide full diagnostic
	const staleHashResult = await checkStaleHash(artifact, workspaceRoot, config?.staleHash);
	const applyValidationResult = await checkApplyValidation(artifact, workspaceRoot);

	const allPassed =
		writeSetResult.passed && forbiddenPathResult.passed && staleHashResult.passed && applyValidationResult.passed;

	return {
		allPassed,
		writeSet: writeSetResult,
		forbiddenPath: forbiddenPathResult,
		staleHash: staleHashResult,
		applyValidation: applyValidationResult,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a path matches any glob pattern.
 */
function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (matchesPattern(filePath, pattern)) return true;
	}
	return false;
}

/**
 * Simple glob pattern matching.
 *
 * Supports:
 * - Exact path matches
 * - Single-segment wildcard (*) — matches within one directory level only
 * - Multi-segment wildcard (**) — matches across zero or more directory levels
 * - Directory prefix patterns (ending with /)
 *
 * Rules for globstar (two consecutive asterisks):
 * - standalone globstar matches everything (including empty)
 * - pattern ending with globstar followed by slash then x matches x at any depth
 * - supports standard globstar semantics used by .gitignore and TypeScript
 */
function matchesPattern(filePath: string, pattern: string): boolean {
	const trimmed = pattern.trim();
	if (!trimmed) return false;

	// Directory pattern (ends with /) — match prefix
	if (trimmed.endsWith("/")) {
		const dirPrefix = trimmed.replace(/\/+$/, "");
		return filePath.startsWith(dirPrefix) || filePath.startsWith(`${dirPrefix}/`);
	}

	// Convert glob to regex.
	// Strategy for **: when we see **/ or /** or standalone **, we need
	// to allow it to match across directories (including zero).
	// After standard escaping, ** becomes ___DS___ which we then
	// expand to match zero-or-more dir levels.
	let regexStr = "";
	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];

		// Detect ** (must have two consecutive *)
		if (ch === "*" && i + 1 < trimmed.length && trimmed[i + 1] === "*") {
			// Consume **
			i++;

			// If followed by /, the / is optional (zero dir levels)
			if (i + 1 < trimmed.length && trimmed[i + 1] === "/") {
				i++; // consume /
				regexStr += "(?:.*/)?";
			} else {
				regexStr += ".*";
			}
			continue;
		}

		// Escape special regex characters
		if (
			ch === "." ||
			ch === "+" ||
			ch === "?" ||
			ch === "^" ||
			ch === "$" ||
			ch === "{" ||
			ch === "}" ||
			ch === "(" ||
			ch === ")" ||
			ch === "|" ||
			ch === "[" ||
			ch === "]" ||
			ch === "\\"
		) {
			regexStr += `\\${ch}`;
			continue;
		}

		// Single * matches within one directory level
		if (ch === "*") {
			regexStr += "[^/]*";
			continue;
		}

		regexStr += ch;
	}

	try {
		const regex = new RegExp(`^${regexStr}$`);
		return regex.test(filePath);
	} catch {
		return false;
	}
}

/**
 * Check if a path is forbidden based on patterns.
 */

function isForbiddenPath(filePath: string, forbiddenPatterns: string[]): boolean {
	for (const pattern of forbiddenPatterns) {
		if (pattern.endsWith("/")) {
			// Directory prefix match
			if (filePath.startsWith(pattern) || filePath.startsWith(pattern.replace(/\/+$/, "/"))) {
				return true;
			}
		} else if (filePath === pattern) {
			// Exact file path match
			return true;
		} else if (filePath.startsWith(pattern)) {
			// Prefix match (for paths without trailing /)
			return true;
		}
	}
	return false;
}

/**
 * Check if a file exists on disk.
 */
async function fileExistsCheck(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
