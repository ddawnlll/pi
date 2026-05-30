/**
 * PatchCoordinator - P37.03 Workstream
 *
 * Central coordinator for safe patch application. This is the ONLY component
 * that applies patches to the workspace. All other code paths delegate to
 * PatchCoordinator for patch application.
 *
 * Responsibilities:
 * 1. Run guard checks before application (writeSet, forbiddenPath, staleHash, applyValidation)
 * 2. Capture pre-apply file snapshots for rollback
 * 3. Apply the patch via file operations (edits, creates, deletes)
 * 4. Handle rollback on guard failure or apply failure
 * 5. Update the patch artifact status throughout the lifecycle
 * 6. Verify clean state after rollback
 *
 * Acceptance Criteria (P37.03):
 * 1. WriteSet violation, forbidden path, stale hash, and apply failure are handled safely.
 * 2. Validation failure triggers rollback.
 * 3. Dirty repo leak after failed patch is zero in tests.
 * 4. Only PatchCoordinator applies patches.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PatchArtifact } from "./index.js";
import type { PatchGuardConfig, PatchGuardResult } from "./patch-guards.js";
import { runAllGuards } from "./patch-guards.js";
import type { RollbackResult } from "./rollback-manager.js";
import { RollbackManager } from "./rollback-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of the patch coordination lifecycle.
 */
export type CoordinationStatus =
	| "pending"
	| "guards_running"
	| "guards_passed"
	| "guards_failed"
	| "applying"
	| "applied"
	| "apply_failed"
	| "rolling_back"
	| "rolled_back"
	| "completed"
	| "failed";

/**
 * Result of a patch coordination operation.
 */
export interface CoordinationResult {
	/** Whether the patch was applied successfully */
	success: boolean;
	/** Final status of the coordination */
	status: CoordinationStatus;
	/** Guard results (if guards were run) */
	guardResults?: PatchGuardResult;
	/** Rollback result (if rollback was triggered) */
	rollbackResult?: RollbackResult;
	/** Human-readable summary */
	summary: string;
	/** Error message if failed */
	error?: string;
}

/**
 * Configuration for PatchCoordinator.
 */
export interface PatchCoordinatorConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** Plan execution ID for audit/logging */
	planExecId: string;
	/** Workspace ID for audit/logging */
	workspaceId: string;
	/** Optional guard configuration */
	guards?: PatchGuardConfig;
}

// ---------------------------------------------------------------------------
// PatchCoordinator
// ---------------------------------------------------------------------------

/**
 * Coordinates the safe application of a PatchArtifact to the workspace.
 *
 * Lifecycle:
 *   pending -> guards_running -> guards_passed -> applying -> applied -> completed
 *                                                      -> apply_failed -> rolling_back -> rolled_back -> failed
 *                                 -> guards_failed -> rolling_back -> rolled_back -> failed
 */
export class PatchCoordinator {
	private readonly workspaceRoot: string;
	private readonly planExecId: string;
	private readonly workspaceId: string;
	private readonly guardConfig?: PatchGuardConfig;
	private readonly rollbackManager: RollbackManager;

	constructor(config: PatchCoordinatorConfig) {
		this.workspaceRoot = path.resolve(config.workspaceRoot);
		this.planExecId = config.planExecId;
		this.workspaceId = config.workspaceId;
		this.guardConfig = config.guards;
		this.rollbackManager = new RollbackManager({
			workspaceRoot: this.workspaceRoot,
			planExecId: this.planExecId,
			workspaceId: this.workspaceId,
		});
	}

	/**
	 * Get the rollback manager instance for testing/inspection.
	 */
	get rollback(): RollbackManager {
		return this.rollbackManager;
	}

	/**
	 * Apply a patch artifact to the workspace.
	 *
	 * This is the main entry point. The caller must have already created
	 * and validated the PatchArtifact using PatchWorkspace or similar.
	 *
	 * @param artifact - The patch artifact to apply
	 * @returns CoordinationResult with the outcome
	 */
	async apply(artifact: PatchArtifact): Promise<CoordinationResult> {
		try {
			// Phase 1: Run guards
			const guardResults = await this.runGuards(artifact);

			if (!guardResults.allPassed) {
				// Phase 2a: Guard failure triggers rollback
				const rollbackResult = await this.executeRollback(artifact, guardResults);
				return {
					success: false,
					status: "failed",
					guardResults,
					rollbackResult,
					summary: this.buildFailureSummary(guardResults, rollbackResult),
					error: this.buildGuardError(guardResults),
				};
			}

			// Phase 3: Capture snapshots for potential rollback
			await this.rollbackManager.captureSnapshots(artifact.fileOperations);

			// Phase 4: Apply the patch
			const applyError = await this.applyPatch(artifact);

			if (applyError) {
				// Phase 5a: Apply failure triggers rollback
				const rollbackResult = await this.executeRollback(artifact, undefined, applyError);
				return {
					success: false,
					status: "failed",
					guardResults,
					rollbackResult,
					summary: this.buildApplyFailureSummary(applyError, rollbackResult),
					error: applyError,
				};
			}

			// Phase 5b: Success! Clear snapshots
			this.rollbackManager.clearSnapshots();

			return {
				success: true,
				status: "completed",
				guardResults,
				summary: `Patch ${artifact.id} applied successfully (${artifact.fileOperations.length} file operations)`,
			};
		} catch (error) {
			// Unexpected error during coordination itself
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				status: "failed",
				summary: `Patch coordination failed: ${errorMessage}`,
				error: errorMessage,
			};
		}
	}

	// -----------------------------------------------------------------------
	// Internal phases
	// -----------------------------------------------------------------------

	/**
	 * Run all guard checks.
	 */
	private async runGuards(artifact: PatchArtifact): Promise<PatchGuardResult> {
		return runAllGuards(artifact, this.workspaceRoot, this.guardConfig);
	}

	/**
	 * Apply the patch's file operations to the workspace.
	 *
	 * For each operation:
	 * - edit: Write new content or apply diff
	 * - create: Write new file
	 * - delete: Remove file
	 *
	 * Returns an error string if any operation fails, or null on success.
	 */
	private async applyPatch(artifact: PatchArtifact): Promise<string | null> {
		for (const op of artifact.fileOperations) {
			const fullPath = path.resolve(this.workspaceRoot, op.filePath);

			switch (op.operation) {
				case "edit":
					if (op.newText !== undefined) {
						// Direct content replacement
						if (op.oldText !== undefined && op.oldText.length > 0) {
							// Targeted replacement: find oldText and replace with newText
							const content = await fs.readFile(fullPath, "utf-8");
							if (!content.includes(op.oldText)) {
								return `Edit operation on "${op.filePath}" failed: oldText not found in file content`;
							}
							const newContent = content.replace(op.oldText, op.newText);
							await fs.writeFile(fullPath, newContent, "utf-8");
						} else {
							// Full rewrite with newText
							await fs.mkdir(path.dirname(fullPath), { recursive: true });
							await fs.writeFile(fullPath, op.newText, "utf-8");
						}
					} else if (op.diff) {
						// Apply a unified diff using git apply
						const applyError = await this.applyDiff(fullPath, op.diff);
						if (applyError) return applyError;
					} else {
						return `Edit operation on "${op.filePath}" has neither newText nor diff content`;
					}
					break;

				case "create":
					if (op.newText === undefined) {
						return `Create operation on "${op.filePath}" has no content`;
					}
					await fs.mkdir(path.dirname(fullPath), { recursive: true });
					await fs.writeFile(fullPath, op.newText, "utf-8");
					break;

				case "delete":
					try {
						await fs.unlink(fullPath);
					} catch {
						return `Delete operation on "${op.filePath}" failed: file does not exist`;
					}
					break;
			}
		}

		return null;
	}

	/**
	 * Apply a unified diff to a file using git apply.
	 */
	private async applyDiff(filePath: string, diff: string): Promise<string | null> {
		try {
			const { execSync } = await import("node:child_process");
			// Write diff to temp file and apply with git apply
			const diffFile = path.join(this.workspaceRoot, ".pi", "patches", `.tmp-diff-${Date.now()}.patch`);
			await fs.mkdir(path.dirname(diffFile), { recursive: true });
			await fs.writeFile(diffFile, diff, "utf-8");

			try {
				execSync(`git apply "${diffFile}"`, {
					cwd: this.workspaceRoot,
					stdio: "pipe",
				});
			} finally {
				// Cleanup temp diff file
				try {
					await fs.unlink(diffFile);
				} catch {
					// Non-fatal
				}
			}

			return null;
		} catch (error) {
			return `Diff apply failed for "${filePath}": ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute rollback after a guard failure or apply failure.
	 */
	private async executeRollback(
		_artifact: PatchArtifact,
		_guardResults?: PatchGuardResult,
		_error?: string,
	): Promise<RollbackResult> {
		return this.rollbackManager.rollback();
	}

	/**
	 * Build a summary string for guard failures.
	 */
	private buildFailureSummary(guardResults: PatchGuardResult, rollbackResult?: RollbackResult): string {
		const parts: string[] = [];

		if (!guardResults.writeSet.passed) {
			parts.push(guardResults.writeSet.message);
		}
		if (!guardResults.forbiddenPath.passed) {
			parts.push(guardResults.forbiddenPath.message);
		}
		if (!guardResults.staleHash.passed) {
			parts.push(guardResults.staleHash.message);
		}
		if (!guardResults.applyValidation.passed) {
			parts.push(guardResults.applyValidation.message);
		}

		if (rollbackResult) {
			if (rollbackResult.success) {
				parts.push("Rollback completed successfully.");
			} else {
				parts.push("Rollback had issues.");
				if (rollbackResult.error) {
					parts.push(rollbackResult.error);
				}
			}

			if (rollbackResult.repoCleanAfterRollback) {
				parts.push("Repository is clean.");
			} else {
				parts.push("Repository has remaining dirty files.");
			}
		}

		return parts.join(" ");
	}

	/**
	 * Build a summary string for apply failures.
	 */
	private buildApplyFailureSummary(applyError: string, rollbackResult?: RollbackResult): string {
		const parts: string[] = [`Apply failed: ${applyError}`];

		if (rollbackResult) {
			if (rollbackResult.success) {
				parts.push("Rollback completed successfully.");
			} else {
				parts.push("Rollback had issues.");
				if (rollbackResult.error) {
					parts.push(rollbackResult.error);
				}
			}

			if (rollbackResult.repoCleanAfterRollback) {
				parts.push("Repository is clean.");
			} else {
				parts.push("Repository has remaining dirty files.");
			}
		}

		return parts.join(" ");
	}

	/**
	 * Build a concise error message from guard results.
	 */
	private buildGuardError(guardResults: PatchGuardResult): string {
		if (!guardResults.writeSet.passed) return guardResults.writeSet.message;
		if (!guardResults.forbiddenPath.passed) return guardResults.forbiddenPath.message;
		if (!guardResults.staleHash.passed) return guardResults.staleHash.message;
		if (!guardResults.applyValidation.passed) return guardResults.applyValidation.message;
		return "Guard check failed";
	}
}

/**
 * Create a PatchCoordinator instance.
 */
export function createPatchCoordinator(config: PatchCoordinatorConfig): PatchCoordinator {
	return new PatchCoordinator(config);
}
