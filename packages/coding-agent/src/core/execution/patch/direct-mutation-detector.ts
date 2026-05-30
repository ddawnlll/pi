/**
 * Direct Mutation Detector - P37.04 Workstream
 *
 * Detects and prevents direct mutations to the main repository when
 * running in worker overlay mode. The detector intercepts file write
 * operations and checks whether the target path falls within the
 * allowed overlay/worktree path.
 *
 * If a direct mutation to the main repo is detected, the detector
 * hard-stops the operation with an error message.
 */

import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a direct mutation check.
 */
export interface DirectMutationCheckResult {
	/** Whether the write is allowed */
	allowed: boolean;
	/** Whether this is a direct mutation (write outside allowed path) */
	isDirectMutation: boolean;
	/** Human-readable message explaining the result */
	message: string;
	/** The normalized path that was checked */
	normalizedPath: string;
	/** The allowed base path */
	allowedBasePath: string;
	/** Whether the allowed path is the main repo path */
	isMainRepoPath: boolean;
}

/**
 * Configuration for DirectMutationDetector.
 */
export interface DirectMutationDetectorConfig {
	/**
	 * The main repository root path.
	 * Mutations to this path (outside the overlay) are considered direct mutations.
	 */
	mainRepoPath: string;

	/**
	 * The allowed overlay/worktree path.
	 * Writes must fall within this path to be allowed.
	 */
	allowedPath: string;

	/**
	 * Whether mutation detection is enabled.
	 * When disabled, all writes are allowed (preserves existing behavior).
	 * Default: true
	 */
	enabled?: boolean;
}

// ---------------------------------------------------------------------------
// DirectMutationDetector
// ---------------------------------------------------------------------------

/**
 * Detects direct mutations to the main repository outside the allowed
 * overlay/worktree path.
 *
 * In worker overlay mode, all file writes from the agent should be
 * directed at the overlay/worktree. Any write targeting the main repo
 * directly is a "direct mutation" and should be hard-stopped.
 *
 * When `enabled` is false, the detector allows all writes (preserving
 * existing behavior for non-patch modes).
 */
export class DirectMutationDetector {
	private readonly mainRepoPath: string;
	private readonly allowedPath: string;
	private readonly enabled: boolean;

	constructor(config: DirectMutationDetectorConfig) {
		this.mainRepoPath = path.resolve(config.mainRepoPath);
		this.allowedPath = path.resolve(config.allowedPath);
		this.enabled = config.enabled ?? true;
	}

	/**
	 * Whether the detector is enabled.
	 */
	get isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Check if a file path is within the allowed overlay/worktree path.
	 *
	 * @param targetPath - The absolute or relative path being written to
	 * @returns DirectMutationCheckResult indicating whether the write is allowed
	 */
	check(targetPath: string): DirectMutationCheckResult {
		const normalizedPath = path.resolve(targetPath);

		if (!this.enabled) {
			return {
				allowed: true,
				isDirectMutation: false,
				message: "Direct mutation detection is disabled — write allowed",
				normalizedPath,
				allowedBasePath: this.allowedPath,
				isMainRepoPath:
					normalizedPath.startsWith(this.mainRepoPath + path.sep) || normalizedPath === this.mainRepoPath,
			};
		}

		// Check if the target is within the allowed path
		const isWithinAllowed =
			normalizedPath.startsWith(this.allowedPath + path.sep) || normalizedPath === this.allowedPath;

		// Check if the target is within the main repo (but NOT within the allowed path)
		const isWithinMainRepo =
			(normalizedPath.startsWith(this.mainRepoPath + path.sep) || normalizedPath === this.mainRepoPath) &&
			!isWithinAllowed;

		if (isWithinAllowed) {
			return {
				allowed: true,
				isDirectMutation: false,
				message: `Write to "${normalizedPath}" is within allowed path — allowed`,
				normalizedPath,
				allowedBasePath: this.allowedPath,
				isMainRepoPath: false,
			};
		}

		if (isWithinMainRepo) {
			return {
				allowed: false,
				isDirectMutation: true,
				message: `DIRECT MUTATION DETECTED: Write to "${normalizedPath}" targets the main repository outside the allowed overlay path "${this.allowedPath}". This write has been hard-stopped.`,
				normalizedPath,
				allowedBasePath: this.allowedPath,
				isMainRepoPath: true,
			};
		}

		// Path is outside both main repo and allowed path (e.g., /tmp, /var, etc.)
		// These are generally allowed since they don't mutate the repo
		return {
			allowed: true,
			isDirectMutation: false,
			message: `Write to "${normalizedPath}" is outside the main repository — allowed`,
			normalizedPath,
			allowedBasePath: this.allowedPath,
			isMainRepoPath: false,
		};
	}

	/**
	 * Check and throw if a path would cause a direct mutation.
	 * Convenience wrapper for use in synchronous validation.
	 *
	 * @param targetPath - The path being written to
	 * @throws Error if the path is a direct mutation to the main repo
	 */
	assertAllowed(targetPath: string): void {
		const result = this.check(targetPath);
		if (!result.allowed) {
			throw new Error(result.message);
		}
	}
}

/**
 * Create a DirectMutationDetector instance.
 */
export function createDirectMutationDetector(config: DirectMutationDetectorConfig): DirectMutationDetector {
	return new DirectMutationDetector(config);
}
