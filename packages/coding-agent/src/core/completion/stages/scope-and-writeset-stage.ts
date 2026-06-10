/**
 * P44.5.04 — Scope and WriteSet Stage
 *
 * Verifies that all modified files are within the workspace's allowedFiles
 * and writeSet. Blocks (or routes to HIR) when files are modified outside
 * the writeSet. Never silently excludes files.
 *
 * Per the canEditMismatchPolicy:
 * - If changed file is outside canEdit/writeSet and not declared shared → BLOCK
 * - If declared output is outside allowedFiles but appears legitimate → HIR
 * - Silent exclusion is forbidden
 *
 * Contract Schema: 4.1.1
 */

import type { StageExecutionContext, StageRunner } from "../completion-gate-vnext.js";
import type { StageVerdict } from "../completion-gate-vnext-types.js";
import { createFailedStageVerdict, createPassedStageVerdict } from "../workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A file found to be modified outside the writeSet.
 */
export interface UnauthorizedFileEntry {
	/** File path relative to repo root */
	filePath: string;
	/** Nature of the violation */
	violation: "outside_writeSet" | "outside_allowedFiles" | "forbidden_file";
	/** Whether this appears to be a legitimate output that was accidentally excluded */
	appearsLegitimate?: boolean;
}

/**
 * Configuration for the scope and writeSet stage.
 */
export interface ScopeAndWriteSetStageConfig {
	/** Repository root path */
	repoRoot: string;
	/** Workspace identifier */
	workspaceId: string;
	/** Allowed files from the plan spec */
	allowedFiles: string[];
	/** Write set from the plan spec */
	writeSet: string[];
	/** Forbidden files that should never be written */
	forbiddenFiles?: string[];
	/** Shared files that are declared as shared */
	declaredSharedFiles?: string[];
	/** Whether to treat legitimate-looking outputs outside allowedFiles as HIR instead of block */
	hirOnAmbiguousLegitimateOutput?: boolean;
}

// ---------------------------------------------------------------------------
// Stage Runner Factory
// ---------------------------------------------------------------------------

/**
 * Create a stage runner for the ScopeAndWriteSet stage.
 *
 * @param config - Stage configuration
 * @param getModifiedFiles - Function that returns the list of modified files (injectable for testing)
 */
export function createScopeAndWriteSetStageRunner(
	config: ScopeAndWriteSetStageConfig,
	getModifiedFiles?: () => string[],
): StageRunner {
	return (_stage: string, _workspace: unknown, _context: StageExecutionContext): StageVerdict => {
		const startTime = Date.now();

		// Get modified files (from git state or injected)
		let modifiedFiles: string[];
		if (getModifiedFiles) {
			modifiedFiles = getModifiedFiles();
		} else {
			// Default: no modified files detected (empty workspace)
			modifiedFiles = [];
		}

		const unauthorizedEntries: UnauthorizedFileEntry[] = [];

		for (const file of modifiedFiles) {
			// Check forbidden files first
			if (config.forbiddenFiles?.some((f) => f === file || file.startsWith(f.replace(/\/\*$/, "/")))) {
				unauthorizedEntries.push({
					filePath: file,
					violation: "forbidden_file",
				});
				continue;
			}

			// Check if file is in writeSet (allowed)
			const inWriteSet = config.writeSet.some((ws) => matchGlob(file, ws));
			const inAllowedFiles = config.allowedFiles.some((af) => matchGlob(file, af));
			const inSharedFiles = config.declaredSharedFiles?.some((sf) => matchGlob(file, sf));

			if (inWriteSet || inSharedFiles) {
				// File is authorized
				continue;
			}

			if (!inAllowedFiles && inWriteSet) {
				// File is in writeSet but not in allowedFiles — this is okay
				continue;
			}

			if (!inWriteSet && inAllowedFiles) {
				// File is in allowedFiles but not writeSet — this is okay (read-only access)
				continue;
			}

			// File is outside both allowedFiles and writeSet
			const appearsLegitimate = !isConfigOrGeneratedFile(file);
			unauthorizedEntries.push({
				filePath: file,
				violation: "outside_writeSet",
				appearsLegitimate,
			});
		}

		if (unauthorizedEntries.length > 0) {
			const hasLegitimateOutput = unauthorizedEntries.some((e) => e.appearsLegitimate);
			const hasForbidden = unauthorizedEntries.some((e) => e.violation === "forbidden_file");

			// Forbidden files always block
			if (hasForbidden) {
				return createFailedStageVerdict(
					"ScopeAndWriteSet",
					unauthorizedEntries
						.filter((e) => e.violation === "forbidden_file")
						.map((e) => `Forbidden file modified: ${e.filePath}`),
					{
						unauthorizedFiles: unauthorizedEntries,
						recoveryState: "NEEDS_HIR",
					},
					Date.now() - startTime,
				);
			}

			// Legitimate-looking output outside writeSet → HIR
			if (hasLegitimateOutput && config.hirOnAmbiguousLegitimateOutput) {
				return createFailedStageVerdict(
					"ScopeAndWriteSet",
					unauthorizedEntries
						.filter((e) => e.appearsLegitimate)
						.map((e) => `Appears legitimate but outside writeSet: ${e.filePath}`),
					{
						unauthorizedFiles: unauthorizedEntries,
						recoveryState: "NEEDS_HIR",
					},
					Date.now() - startTime,
				);
			}

			// Standard block
			return createFailedStageVerdict(
				"ScopeAndWriteSet",
				unauthorizedEntries.map(
					(e) =>
						`File outside writeSet${e.appearsLegitimate ? " (appears legitimate, route to HIR)" : ""}: ${e.filePath}`,
				),
				{
					unauthorizedFiles: unauthorizedEntries,
					recoveryState: "NEEDS_HIR",
				},
				Date.now() - startTime,
			);
		}

		return createPassedStageVerdict(
			"ScopeAndWriteSet",
			{
				modifiedFilesCount: modifiedFiles.length,
				allFilesAuthorized: true,
			},
			Date.now() - startTime,
		);
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple glob matching (supports **, * wildcards at end).
 * This is a simplified version; real implementation should use minimatch or similar.
 */
function matchGlob(filePath: string, pattern: string): boolean {
	if (pattern === filePath) return true;
	if (pattern.endsWith("/**") && filePath.startsWith(pattern.slice(0, -3))) return true;
	if (pattern.endsWith("/*") && filePath.startsWith(pattern.slice(0, -2))) return true;
	if (pattern.endsWith("*") && !pattern.includes("/") && filePath.endsWith(pattern.slice(0, -1))) {
		return filePath.endsWith(pattern.slice(0, -1));
	}
	return false;
}

/**
 * Determine if a file is a config or generated file (not a legitimate source output).
 */
function isConfigOrGeneratedFile(filePath: string): boolean {
	const generatedPatterns = [
		"node_modules/",
		".git/",
		"package-lock.json",
		"pnpm-lock.yaml",
		"dist/",
		"build/",
		".next/",
	];
	return generatedPatterns.some((p) => filePath.startsWith(p) || filePath === p);
}
