/**
 * WriteSet / Path Guard — P43.8C Smart Mutation Engine
 *
 * Validates file paths against repo root, writeSet, and artifact policies.
 */

import * as path from "node:path";

export interface WriteSetCheckResult {
	ok: boolean;
	path: string;
	repoRelativePath: string;
	withinRepo: boolean;
	allowedByWriteSet: boolean;
	allowedByArtifactPolicy: boolean;
	reason?: string;
}

// =========================================================================
// Path normalization
// =========================================================================

/**
 * Normalize a path to POSIX-style repo-relative path.
 * Returns null if the path is outside the repo root.
 */
export function normalizeRepoPath(filePath: string, repoRoot: string): string | null {
	const absRepoRoot = path.resolve(repoRoot);
	const absPath = path.resolve(absRepoRoot, filePath);

	// Check path traversal
	if (!absPath.startsWith(absRepoRoot + path.sep) && absPath !== absRepoRoot) {
		return null;
	}

	// Get relative path
	const relative = path.relative(absRepoRoot, absPath);

	// Normalize to POSIX
	return relative.replace(/\\/g, "/");
}

/**
 * Check if a file path is within the repository root.
 */
export function isWithinRepo(filePath: string, repoRoot: string): boolean {
	return normalizeRepoPath(filePath, repoRoot) !== null;
}

// =========================================================================
// WriteSet matching
// =========================================================================

/**
 * Check if a repo-relative path matches the writeSet.
 * WriteSet patterns support:
 *   - Exact file paths: "src/math.ts"
 *   - Directory prefixes: "src/"
 *   - Glob patterns: "src/*.ts", "**\/*.ts"
 *   - Wildcard: "*"
 */
export function isAllowedByWriteSet(repoRelativePath: string, allowedWriteSet: string[]): boolean {
	if (!allowedWriteSet || allowedWriteSet.length === 0) {
		// No writeSet = anything allowed (default permissive)
		return true;
	}

	const normalizedPath = repoRelativePath.replace(/\\/g, "/");

	for (const pattern of allowedWriteSet) {
		const normalizedPattern = pattern.replace(/\\/g, "/");

		// Exact match
		if (normalizedPath === normalizedPattern) return true;

		// Directory prefix match
		if (normalizedPattern.endsWith("/") && normalizedPath.startsWith(normalizedPattern)) return true;
		if (normalizedPattern.endsWith("/**") && normalizedPath.startsWith(normalizedPattern.slice(0, -3))) return true;

		// Glob pattern - simple star matching
		if (normalizedPattern.includes("*")) {
			const regexStr = normalizedPattern
				.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
				.replace(/\*\*/g, "§§§§") // preserve ** during escaping
				.replace(/\*/g, "[^/]*") // single * -> any non-separator
				.replace(/§§§§/g, ".*"); // ** -> anything
			try {
				const regex = new RegExp(`^${regexStr}$`);
				if (regex.test(normalizedPath)) return true;
			} catch {
				// Invalid regex pattern, skip
			}
		}
	}

	return false;
}

/**
 * Check if a repo-relative path matches generated artifact globs.
 */
export function isAllowedArtifact(repoRelativePath: string, allowlistedArtifactGlobs: string[] | undefined): boolean {
	if (!allowlistedArtifactGlobs || allowlistedArtifactGlobs.length === 0) return false;

	const normalizedPath = repoRelativePath.replace(/\\/g, "/");

	for (const glob of allowlistedArtifactGlobs) {
		const normalizedGlob = glob.replace(/\\/g, "/");

		if (normalizedPath === normalizedGlob) return true;
		if (normalizedGlob.endsWith("/**") && normalizedPath.startsWith(normalizedGlob.slice(0, -3))) return true;
		if (normalizedGlob.endsWith("/") && normalizedPath.startsWith(normalizedGlob)) return true;

		if (normalizedGlob.includes("*")) {
			const regexStr = normalizedGlob
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*\*/g, "§§§§")
				.replace(/\*/g, "[^/]*")
				.replace(/§§§§/g, ".*");
			try {
				const regex = new RegExp(`^${regexStr}$`);
				if (regex.test(normalizedPath)) return true;
			} catch {
				// skip
			}
		}
	}

	return false;
}

/**
 * Check if a repo-relative path matches a P45 forbidden runtime path pattern.
 * P45 runtime paths (e.g., "packages/ai/src/runtime/**") are protected
 * and cannot be written or modified outside of PlanSpec-authorized bridges.
 *
 * @param repoRelativePath - Repo-relative file path
 * @param p45ForbiddenPaths - P45 forbidden path patterns (if undefined, no paths are forbidden)
 * @returns True if the path is forbidden
 */
export function isP45PathForbidden(repoRelativePath: string, p45ForbiddenPaths?: string[]): boolean {
	if (!p45ForbiddenPaths || p45ForbiddenPaths.length === 0) {
		return false;
	}

	const normalized = repoRelativePath.replace(/\\/g, "/");

	for (const pattern of p45ForbiddenPaths) {
		const normalizedPattern = pattern.replace(/\\/g, "/");

		// Exact match
		if (normalized === normalizedPattern) return true;

		// Directory prefix match
		if (normalizedPattern.endsWith("/**") && normalized.startsWith(normalizedPattern.slice(0, -3))) {
			return true;
		}
		if (normalizedPattern.endsWith("/") && normalized.startsWith(normalizedPattern)) return true;

		// Glob pattern match
		if (normalizedPattern.includes("*") || normalizedPattern.includes("?")) {
			const globPattern = normalizedPattern
				.replace(/\./g, "\\.")
				.replace(/\*\*/g, ".*")
				.replace(/\*/g, "[^/]*")
				.replace(/\?/g, ".");
			if (new RegExp(`^${globPattern}$`).test(normalized)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Full writeSet check.
 */
export function checkWriteSet(
	filePath: string,
	repoRoot: string,
	allowedWriteSet?: string[],
	allowlistedArtifactGlobs?: string[],
): WriteSetCheckResult {
	const repoRelativePath = normalizeRepoPath(filePath, repoRoot);
	const withinRepo = repoRelativePath !== null;

	if (!withinRepo) {
		return {
			ok: false,
			path: filePath,
			repoRelativePath: filePath,
			withinRepo: false,
			allowedByWriteSet: false,
			allowedByArtifactPolicy: false,
			reason: "path_outside_repo",
		};
	}

	const allowedByWriteSet = isAllowedByWriteSet(repoRelativePath, allowedWriteSet ?? []);
	const allowedByArtifact = isAllowedArtifact(repoRelativePath, allowlistedArtifactGlobs);

	const ok = allowedByWriteSet || allowedByArtifact;

	return {
		ok,
		path: filePath,
		repoRelativePath,
		withinRepo: true,
		allowedByWriteSet,
		allowedByArtifactPolicy: allowedByArtifact,
		reason: ok ? undefined : "path_not_in_writeSet_or_artifact_globs",
	};
}
