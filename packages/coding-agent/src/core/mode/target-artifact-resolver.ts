/**
 * P44.6.06 — Target Artifact Resolver
 *
 * Resolves whether a requested target artifact exists on the filesystem,
 * is new (doesn't exist), is part of a multi-file operation, or is
 * unsafe to overwrite.
 *
 * This resolver runs before any mutation tools execute. It provides
 * the factual basis for write-gate and edit-scope guard decisions.
 *
 * Contract Schema: 4.1.1
 */

import fs from "node:fs";
import type { DiagnosticCollection, ModeDiagnostic } from "./mode-diagnostic.js";

// ---------------------------------------------------------------------------
// Resolution Result
// ---------------------------------------------------------------------------

/**
 * Whether a target artifact exists on the filesystem.
 */
export type TargetExistence = "exists" | "not_found" | "not_checked";

/**
 * Overwrite safety classification.
 */
export type OverwriteSafety = "safe" | "unsafe_large" | "unsafe_dependency" | "unknown";

/**
 * Result of resolving a single target artifact.
 */
export interface TargetArtifactResolution {
	/** The target path that was resolved. */
	targetPath: string;

	/** Whether the target exists on disk. */
	existence: TargetExistence;

	/** File size in bytes (0 if not found or not checked). */
	fileSizeBytes: number;

	/** Overwrite safety classification. */
	overwriteSafety: OverwriteSafety;

	/** Whether this is part of a multi-file operation. */
	isMultiFile: boolean;

	/** Total count of files in the operation (1 if single). */
	totalFileCount: number;

	/** Diagnostics from resolution, if any. */
	diagnostics: ModeDiagnostic[];

	/** Dependencies that would be affected by overwrite. */
	affectedDependencies: string[];
}

/**
 * Result of resolving all targets in a prompt.
 */
export interface TargetResolutionCollection extends DiagnosticCollection {
	resolutions: TargetArtifactResolution[];
	allPaths: string[];
	allExist: boolean;
	anyNew: boolean;
	anyUnsafeOverwrite: boolean;
}

// ---------------------------------------------------------------------------
// Size Thresholds
// ---------------------------------------------------------------------------

/**
 * File size threshold (in bytes) above which a file is considered "large"
 * for overwrite safety checks.
 */
export const LARGE_FILE_THRESHOLD_BYTES = 50 * 1024; // 50 KB

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single target artifact path.
 */
export function resolveTarget(targetPath: string): TargetArtifactResolution {
	const diagnostics: ModeDiagnostic[] = [];
	let existence: TargetExistence = "not_checked";
	let fileSizeBytes = 0;
	let overwriteSafety: OverwriteSafety = "unknown";

	try {
		const stat = fs.statSync(targetPath, { throwIfNoEntry: false });
		if (stat?.isFile()) {
			existence = "exists";
			fileSizeBytes = stat.size;

			if (fileSizeBytes > LARGE_FILE_THRESHOLD_BYTES) {
				overwriteSafety = "unsafe_large";
				diagnostics.push({
					severity: "warning",
					code: "WARN_LARGE_TARGET",
					message: `Target '${targetPath}' is ${fileSizeBytes} bytes (exceeds ${LARGE_FILE_THRESHOLD_BYTES} threshold). Overwrite may be unsafe.`,
					fileRef: targetPath,
				});
			} else {
				overwriteSafety = "safe";
			}
		} else {
			existence = "not_found";
			overwriteSafety = "safe"; // New files are safe to create
		}
	} catch {
		existence = "not_found";
		overwriteSafety = "safe";
	}

	return {
		targetPath,
		existence,
		fileSizeBytes,
		overwriteSafety,
		isMultiFile: false, // Will be set by resolveTargets
		totalFileCount: 1,
		diagnostics,
		affectedDependencies: [],
	};
}

/**
 * Resolve all target artifact paths.
 */
export function resolveTargets(targetPaths: string[]): TargetResolutionCollection {
	if (targetPaths.length === 0) {
		return {
			resolutions: [],
			allPaths: [],
			allExist: false,
			anyNew: false,
			anyUnsafeOverwrite: false,
			diagnostics: [],
		};
	}

	const resolutions = targetPaths.map((path) => resolveTarget(path));

	// Mark multi-file
	const isMulti = resolutions.length > 1;
	for (const res of resolutions) {
		res.isMultiFile = isMulti;
		res.totalFileCount = resolutions.length;
	}

	const allPaths = resolutions.map((r) => r.targetPath);
	const allExist = resolutions.length > 0 && resolutions.every((r) => r.existence === "exists");
	const anyNew = resolutions.some((r) => r.existence === "not_found");
	const anyUnsafeOverwrite = resolutions.some(
		(r) => r.overwriteSafety === "unsafe_large" || r.overwriteSafety === "unsafe_dependency",
	);

	const diagnostics: ModeDiagnostic[] = resolutions.flatMap((r) => r.diagnostics);

	return {
		resolutions,
		allPaths,
		allExist,
		anyNew,
		anyUnsafeOverwrite,
		diagnostics,
	};
}

/**
 * Check whether a target can be safely overwritten.
 * Returns blocking diagnostics if the overwrite is unsafe.
 */
export function checkOverwriteSafety(targetPath: string, overwritePolicy: string): ModeDiagnostic[] {
	const resolution = resolveTarget(targetPath);

	if (resolution.existence !== "exists") {
		return []; // Nothing to overwrite
	}

	if (overwritePolicy === "fail_if_exists") {
		return [
			{
				severity: "blocking",
				code: "BLOCKED_LARGE_OVERWRITE",
				message: `Target '${targetPath}' already exists and overwrite policy is 'fail_if_exists'. Cannot proceed.`,
				fileRef: targetPath,
			},
		];
	}

	if (resolution.overwriteSafety === "unsafe_large" && overwritePolicy !== "allow") {
		return [
			{
				severity: "blocking",
				code: "BLOCKED_LARGE_OVERWRITE",
				message: `Target '${targetPath}' is a large file (${resolution.fileSizeBytes} bytes) and overwrite policy does not allow it. Set overwritePolicy to 'allow' or use edit/smart_edit mode.`,
				fileRef: targetPath,
			},
		];
	}

	return [];
}
