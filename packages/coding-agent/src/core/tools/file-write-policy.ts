/**
 * File Write Policy - P37.04 Workstream
 *
 * Defines the policy for file writes in the context of worker overlay mode.
 *
 * When running in patch/overlay mode, the file write policy ensures that:
 * 1. Writes are directed to the correct overlay/worktree path
 * 2. Direct writes to the main repo are blocked
 * 3. The policy can be disabled for non-patch modes
 */

import type { DirectMutationDetector } from "../execution/patch/direct-mutation-detector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a file write policy check.
 */
export interface FileWritePolicyResult {
	/** Whether the write is allowed */
	allowed: boolean;
	/** Human-readable message */
	message: string;
	/** Whether the path was rewritten to the overlay */
	rewritten: boolean;
	/** The effective write path (rewritten if applicable) */
	effectivePath: string;
}

/**
 * Configuration for FileWritePolicy.
 */
export interface FileWritePolicyConfig {
	/**
	 * The direct mutation detector to use.
	 */
	detector?: DirectMutationDetector;

	/**
	 * Whether to rewrite paths to the overlay.
	 * When true, paths targeting the main repo are rewritten to the overlay path.
	 * When false, such paths are simply blocked.
	 * Default: false (block direct mutations)
	 */
	rewritePaths?: boolean;

	/**
	 * Whether the policy is enabled.
	 * When disabled, all writes are allowed (preserves existing behavior).
	 * Default: true
	 */
	enabled?: boolean;
}

// ---------------------------------------------------------------------------
// FileWritePolicy
// ---------------------------------------------------------------------------

/**
 * Policy for controlling file writes in worker overlay mode.
 *
 * This policy sits between the agent's write tool and the actual filesystem,
 * ensuring that writes go through the correct overlay path when in patch mode.
 */
export class FileWritePolicy {
	private readonly detector: DirectMutationDetector | undefined;
	private readonly rewritePaths: boolean;
	private readonly enabled: boolean;

	constructor(config: FileWritePolicyConfig = {}) {
		this.detector = config.detector;
		this.rewritePaths = config.rewritePaths ?? false;
		this.enabled = config.enabled ?? true;
	}

	/**
	 * Check whether a write to the given path is allowed.
	 *
	 * @param targetPath - The absolute path being written to
	 * @returns FileWritePolicyResult
	 */
	check(targetPath: string): FileWritePolicyResult {
		if (!this.enabled || !this.detector) {
			return {
				allowed: true,
				message: "File write policy is disabled — write allowed",
				rewritten: false,
				effectivePath: targetPath,
			};
		}

		const result = this.detector.check(targetPath);

		if (result.allowed) {
			return {
				allowed: true,
				message: result.message,
				rewritten: false,
				effectivePath: targetPath,
			};
		}

		// Direct mutation detected
		if (this.rewritePaths) {
			// Rewrite the path to the overlay path
			const relativePath = targetPath.slice(result.allowedBasePath.length);
			const rewrittenPath = result.allowedBasePath + relativePath;

			return {
				allowed: true,
				message: `Direct mutation detected. Path rewritten to overlay: "${rewrittenPath}"`,
				rewritten: true,
				effectivePath: rewrittenPath,
			};
		}

		return {
			allowed: false,
			message: result.message,
			rewritten: false,
			effectivePath: targetPath,
		};
	}

	/**
	 * Check and throw if a write to the given path is not allowed.
	 *
	 * @param targetPath - The path being written to
	 * @throws Error if the write is not allowed
	 * @returns The effective path (possibly rewritten)
	 */
	assertAllowed(targetPath: string): string {
		const result = this.check(targetPath);
		if (!result.allowed) {
			throw new Error(result.message);
		}
		return result.effectivePath;
	}
}

/**
 * Create a FileWritePolicy instance.
 */
export function createFileWritePolicy(config?: FileWritePolicyConfig): FileWritePolicy {
	return new FileWritePolicy(config);
}
