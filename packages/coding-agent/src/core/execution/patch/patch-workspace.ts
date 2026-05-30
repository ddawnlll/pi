/**
 * Patch Workspace - P37.04 Workstream
 *
 * Orchestrates worker codegen with temp overlay isolation, diff generation,
 * and direct mutation detection.
 *
 * Key responsibilities:
 * 1. Creates a temporary overlay for worker codegen (main repo stays unchanged)
 * 2. Generates diffs between original and modified files
 * 3. Detects and blocks direct mutations to the main repo
 * 4. Produces PatchArtifact for coordinator apply
 * 5. Preserves existing behavior in non-patch modes
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DiffResult } from "./diff-generator.js";
import { generateDirectoryDiffs } from "./diff-generator.js";
import { DirectMutationDetector, type DirectMutationDetectorConfig } from "./direct-mutation-detector.js";
import type { PatchArtifact, PatchFileOperation } from "./patch-artifact.js";
import { createPatchArtifact, createPatchFileOperation, createPatchWriteSet } from "./patch-artifact.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mode for workspace patching.
 */
export type PatchMode = "overlay" | "direct" | "worktree";

/**
 * Configuration for PatchWorkspace.
 */
export interface PatchWorkspaceConfig {
	/**
	 * Workspace root directory (main repo).
	 */
	workspaceRoot: string;

	/**
	 * Plan execution ID for artifact tracking.
	 */
	planExecId: string;

	/**
	 * Workspace ID for artifact tracking.
	 */
	workspaceId: string;

	/**
	 * The patch mode to use.
	 * - "overlay": Create a temp overlay for codegen, generate diff for apply
	 * - "direct": Write directly to the workspace (legacy behavior)
	 * - "worktree": Use git worktree (delegated to WorktreeWorkspaceExecutor)
	 * Default: "direct"
	 */
	mode?: PatchMode;

	/**
	 * Base directory for overlays (created under
	 * workspaceRoot/.pi/overlays/<planExecId>/<workspaceId>/).
	 * Only used when mode is "overlay".
	 * Default: ".pi/overlays"
	 */
	overlayBaseDir?: string;

	/**
	 * Whether to clean up the overlay after generating diffs.
	 * Default: true
	 */
	cleanupOverlay?: boolean;

	/**
	 * Whether to preserve the overlay directory for debugging.
	 * Overrides cleanupOverlay when true.
	 * Default: false
	 */
	preserveOverlay?: boolean;
}

/**
 * Result of a workspace patch operation.
 */
export interface PatchWorkspaceResult {
	/**
	 * Whether the operation succeeded.
	 */
	success: boolean;

	/**
	 * The generated patch artifact (if mode is "overlay" or "worktree").
	 */
	artifact?: PatchArtifact;

	/**
	 * The overlay path (if mode is "overlay").
	 */
	overlayPath?: string;

	/**
	 * Any generated diffs.
	 */
	diffs?: DiffResult[];

	/**
	 * Error message if failed.
	 */
	error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OVERLAY_BASE = ".pi/overlays";

// ---------------------------------------------------------------------------
// PatchWorkspace
// ---------------------------------------------------------------------------

/**
 * Orchestrates workspace patching with overlay isolation and diff generation.
 */
export class PatchWorkspace {
	private readonly workspaceRoot: string;
	private readonly planExecId: string;
	private readonly workspaceId: string;
	private readonly mode: PatchMode;
	private readonly overlayDir: string;
	private readonly cleanupOverlay: boolean;
	private readonly preserveOverlay: boolean;
	private readonly detector: DirectMutationDetector;

	constructor(config: PatchWorkspaceConfig) {
		this.workspaceRoot = path.resolve(config.workspaceRoot);
		this.planExecId = config.planExecId;
		this.workspaceId = config.workspaceId;
		this.mode = config.mode ?? "direct";
		this.preserveOverlay = config.preserveOverlay ?? false;
		this.cleanupOverlay = config.cleanupOverlay ?? !this.preserveOverlay;

		const overlayBase = config.overlayBaseDir ?? DEFAULT_OVERLAY_BASE;
		this.overlayDir = path.join(this.workspaceRoot, overlayBase, this.planExecId, this.workspaceId);

		// Create the direct mutation detector
		// In overlay mode, it protects the main repo
		// In direct mode, it's disabled (preserves existing behavior)
		const detectorConfig: DirectMutationDetectorConfig = {
			mainRepoPath: this.workspaceRoot,
			allowedPath: this.mode === "overlay" ? this.overlayDir : this.workspaceRoot,
			enabled: this.mode === "overlay",
		};
		this.detector = new DirectMutationDetector(detectorConfig);
	}

	/**
	 * Get the direct mutation detector for this workspace.
	 */
	get directMutationDetector(): DirectMutationDetector {
		return this.detector;
	}

	/**
	 * Get the overlay directory path.
	 */
	get overlayPath(): string {
		return this.overlayDir;
	}

	/**
	 * Get the current patch mode.
	 */
	get currentMode(): PatchMode {
		return this.mode;
	}

	/**
	 * Initialize the overlay directory.
	 * Creates a snapshot of the workspace files in the overlay.
	 * In "direct" mode, this is a no-op.
	 */
	async initializeOverlay(): Promise<void> {
		if (this.mode !== "overlay") return;

		// Create the overlay directory
		await fs.mkdir(this.overlayDir, { recursive: true });

		// Copy the entire workspace (excluding .git and .pi) to the overlay
		await this.copyWorkspaceToOverlay();
	}

	/**
	 * Copy the workspace to the overlay directory, excluding .git and .pi.
	 */
	private async copyWorkspaceToOverlay(): Promise<void> {
		const excludeDirs = new Set([".git", ".pi", "node_modules"]);

		await this.copyRecursive(this.workspaceRoot, this.overlayDir, excludeDirs);
	}

	/**
	 * Recursively copy files from source to destination.
	 */
	private async copyRecursive(src: string, dest: string, excludeDirs: Set<string>): Promise<void> {
		const entries = await fs.readdir(src, { withFileTypes: true });

		for (const entry of entries) {
			if (excludeDirs.has(entry.name)) continue;

			const srcPath = path.join(src, entry.name);
			const destPath = path.join(dest, entry.name);

			if (entry.isDirectory()) {
				await fs.mkdir(destPath, { recursive: true });
				await this.copyRecursive(srcPath, destPath, excludeDirs);
			} else if (entry.isFile()) {
				await fs.copyFile(srcPath, destPath);
			}
		}
	}

	/**
	 * Resolve the effective workspace root for agent execution.
	 * In overlay mode, returns the overlay path (isolated from main repo).
	 * In direct mode, returns the original workspace root.
	 * In worktree mode, returns the workspace root (worktree setup is external).
	 *
	 * @returns The effective workspace root path
	 */
	getEffectiveWorkspaceRoot(): string {
		switch (this.mode) {
			case "overlay":
				return this.overlayDir;
			default:
				return this.workspaceRoot;
		}
	}

	/**
	 * Check if a file write target is allowed.
	 * In overlay mode, this checks the direct mutation detector.
	 * In direct/worktree mode, all writes are allowed.
	 *
	 * @param targetPath - The path being written to
	 * @returns Object indicating whether the write is allowed
	 */
	checkFileWrite(targetPath: string): {
		allowed: boolean;
		reason?: string;
	} {
		if (this.mode !== "overlay") {
			return { allowed: true };
		}

		const result = this.detector.check(targetPath);

		if (!result.allowed) {
			return {
				allowed: false,
				reason: result.message,
			};
		}

		return { allowed: true };
	}

	/**
	 * Generate diffs between the original workspace and the overlay.
	 * In direct mode, returns an empty array.
	 * In overlay mode, compares the original workspace root with the overlay directory.
	 *
	 * @returns Array of DiffResult for each changed file
	 */
	async generateDiffs(): Promise<DiffResult[]> {
		if (this.mode !== "overlay") {
			return [];
		}

		return generateDirectoryDiffs(this.workspaceRoot, this.overlayDir);
	}

	/**
	 * Generate a PatchArtifact from the current set of diffs.
	 * In direct mode, returns undefined.
	 *
	 * @param baseSha - The git base commit SHA
	 * @param diffs - The generated diffs (from generateDiffs() call)
	 * @returns A PatchArtifact ready for storage and coordinator apply
	 */
	createPatchArtifact(baseSha: string, diffs: DiffResult[]): PatchArtifact | undefined {
		if (this.mode !== "overlay" || diffs.length === 0) {
			return undefined;
		}

		const fileOperations: PatchFileOperation[] = diffs.map((diffResult) => {
			switch (diffResult.type) {
				case "created":
					return createPatchFileOperation(diffResult.filePath, "create", {
						diff: diffResult.diff,
						description: `Create file: ${diffResult.filePath}`,
					});
				case "deleted":
					return createPatchFileOperation(diffResult.filePath, "delete", {
						diff: diffResult.diff,
						description: `Delete file: ${diffResult.filePath}`,
					});
				case "modified":
					return createPatchFileOperation(diffResult.filePath, "edit", {
						diff: diffResult.diff,
						description: `Modify file: ${diffResult.filePath}`,
					});
				default:
					throw new Error(`Unknown diff type: ${diffResult.type}`);
			}
		});

		const writeSetFiles = diffs.map((d) => d.filePath);

		return createPatchArtifact({
			planExecId: this.planExecId,
			workspaceId: this.workspaceId,
			baseSha,
			writeSet: createPatchWriteSet(writeSetFiles),
			fileOperations,
			description: `Patch for workspace ${this.workspaceId} (${this.mode} mode)`,
		});
	}

	/**
	 * Clean up the overlay directory.
	 * No-op in direct/worktree mode.
	 */
	async cleanup(): Promise<void> {
		if (this.mode !== "overlay") return;
		if (this.preserveOverlay) return;

		try {
			await fs.rm(this.overlayDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}

	/**
	 * Execute a workspace patch operation.
	 *
	 * This is the main entry point that:
	 * 1. Initializes the overlay (if in overlay mode)
	 * 2. Provides the effective workspace root for the executor
	 * 3. After execution, generates diffs
	 * 4. Creates a PatchArtifact from the diffs
	 * 5. Cleans up the overlay
	 *
	 * @param baseSha - The git base commit SHA
	 * @returns PatchWorkspaceResult with the generated diffs and artifact
	 */
	async execute(baseSha: string): Promise<PatchWorkspaceResult> {
		try {
			// 1. Initialize the overlay
			await this.initializeOverlay();

			// 2. The caller runs the agent against getEffectiveWorkspaceRoot()
			//    and calls checkFileWrite() for each write operation.

			// 3. Generate diffs
			const diffs = await this.generateDiffs();

			// 4. Create the patch artifact
			const artifact = this.createPatchArtifact(baseSha, diffs);

			return {
				success: true,
				artifact,
				overlayPath: this.mode === "overlay" ? this.overlayDir : undefined,
				diffs,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			// 5. Clean up
			await this.cleanup();
		}
	}
}

/**
 * Create a PatchWorkspace instance.
 */
export function createPatchWorkspace(config: PatchWorkspaceConfig): PatchWorkspace {
	return new PatchWorkspace(config);
}
