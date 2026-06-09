/**
 * P44.09 — Scoped Commit Integration
 *
 * Bridges WorkspaceCommitGate into the auto-commit workflow.
 * Extracts workspace capability patterns (canEdit) as allowedWriteSet
 * for WorkspaceCommitGate, ensuring only write-set-owned files are
 * staged and committed during workspace and plan completion.
 *
 * This is the core integration point between workspace capability
 * manifests and P44's commit safety guarantees.
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import { WorkspaceCommitGate, type WorkspaceCommitGateResult } from "../workspace-commit-gate.js";
import type { Workspace } from "../workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScopedCommitIntegrationConfig {
	/** Root of the git repository */
	repoRoot: string;
	/** Workspace identifier for audit */
	workspaceId: string;
	/**
	 * File glob patterns the workspace is allowed to modify.
	 * Typically derived from workspace.capabilities.canEdit.
	 */
	allowedWriteSet: string[];
	/** Whether to allow generated artifact files (lockfiles, build output) */
	allowGeneratedArtifacts?: boolean;
	/** Glob patterns for generated artifacts */
	generatedArtifactGlobs?: string[];
	/** Whether to allow staging/committing deleted files that are in the write-set */
	allowDeletedOwnedFiles?: boolean;
}

/**
 * Result of a scoped commit operation.
 */
export interface ScopedCommitResult {
	/** Whether the commit was successful */
	success: boolean;
	/** Short commit hash (hex) if successful */
	commitHash?: string;
	/** Human-readable reason if unsuccessful */
	reason?: string;
	/** Files that were committed */
	committedFiles?: string[];
	/** Raw gate result for diagnostic purposes */
	gateResult?: WorkspaceCommitGateResult;
}

/**
 * Result of a scoped stage operation.
 */
export interface ScopedStageResult {
	/** Whether staging was allowed */
	allowed: boolean;
	/** Human-readable reason if blocked */
	reason?: string;
	/** Files that were staged */
	stagedFiles: string[];
}

// ---------------------------------------------------------------------------
// ScopedCommitIntegration
// ---------------------------------------------------------------------------

/**
 * Integrates WorkspaceCommitGate scoped commit safety into the executor
 * commit workflow. Provides factory and convenience methods for creating
 * scoped commits from workspace capability manifests.
 */
export class ScopedCommitIntegration {
	private readonly config: Required<ScopedCommitIntegrationConfig>;

	constructor(config: ScopedCommitIntegrationConfig) {
		this.config = {
			repoRoot: path.resolve(config.repoRoot),
			workspaceId: config.workspaceId,
			allowedWriteSet: [...config.allowedWriteSet],
			allowGeneratedArtifacts: config.allowGeneratedArtifacts ?? false,
			generatedArtifactGlobs: config.generatedArtifactGlobs ?? [],
			allowDeletedOwnedFiles: config.allowDeletedOwnedFiles ?? true,
		};
	}

	/**
	 * Create a WorkspaceCommitGate configured for this workspace.
	 */
	private createGate(): WorkspaceCommitGate {
		return new WorkspaceCommitGate({
			repoRoot: this.config.repoRoot,
			workspaceId: this.config.workspaceId,
			allowedWriteSet: this.config.allowedWriteSet,
			allowGeneratedArtifacts: this.config.allowGeneratedArtifacts,
			generatedArtifactGlobs: this.config.generatedArtifactGlobs,
			allowDeletedOwnedFiles: this.config.allowDeletedOwnedFiles,
		});
	}

	/**
	 * Inspect the current git state through the commit gate lens.
	 * Returns the full gate inspection result without modifying any files.
	 */
	async inspectState(): Promise<WorkspaceCommitGateResult> {
		const gate = this.createGate();
		return gate.inspectGitState();
	}

	/**
	 * Validate that the current workspace state is safe to scoped-commit.
	 * Checks that no unexpected (non-write-set) files are staged or dirty.
	 *
	 * @returns Validation result with allowed flag and diagnostics
	 */
	async validateScopedCommit(): Promise<{
		allowed: boolean;
		reason?: string;
		unexpectedStagedFiles: string[];
		unexpectedModifiedFiles: string[];
	}> {
		const gate = this.createGate();
		const validation = await gate.validateStagedFiles();

		if (!validation.allowed) {
			return {
				allowed: false,
				reason: validation.reason,
				unexpectedStagedFiles: validation.unexpectedStagedFiles,
				unexpectedModifiedFiles: validation.unexpectedModifiedFiles,
			};
		}

		return {
			allowed: true,
			unexpectedStagedFiles: [],
			unexpectedModifiedFiles: [],
		};
	}

	/**
	 * Stage only files that belong to the workspace write set.
	 * Files outside the write set are left unstaged.
	 *
	 * @returns Result listing what was staged and any blocked files
	 */
	async stageAllowedFiles(): Promise<ScopedStageResult> {
		const gate = this.createGate();
		const result = await gate.stageAllowedFiles();

		if (!result.allowed) {
			return {
				allowed: false,
				reason: result.reason,
				stagedFiles: result.allowedFiles,
			};
		}

		return {
			allowed: true,
			stagedFiles: result.allowedFiles,
		};
	}

	/**
	 * Create a scoped commit that only includes files in the workspace
	 * write set. Validates state first, stages allowed files if needed,
	 * then commits with the given message.
	 *
	 * This is the primary integration point — replaces direct AutoCommit
	 * usage when scoped commit enforcement is enabled.
	 *
	 * @param message - Commit message
	 * @returns Scoped commit result
	 */
	async createScopedCommit(message: string): Promise<ScopedCommitResult> {
		const gate = this.createGate();
		const result = await gate.createScopedCommit(message);

		if (!result.allowed) {
			return {
				success: false,
				reason: result.reason ?? "Scoped commit rejected by gate",
				committedFiles: result.allowedFiles,
				gateResult: result,
			};
		}

		// Extract commit hash from HEAD
		let commitHash: string | undefined;
		try {
			const output = execSync("git rev-parse --short HEAD", {
				cwd: this.config.repoRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "ignore"],
			});
			commitHash = output.trim();
		} catch {
			// Non-fatal — hash is best-effort
		}

		return {
			success: true,
			commitHash,
			committedFiles: result.allowedFiles,
			gateResult: result,
		};
	}

	/**
	 * Get the list of files that are modified and belong to the write set.
	 * These are the files that would be staged and committed by
	 * createScopedCommit.
	 */
	async getModifiedWriteSetFiles(): Promise<string[]> {
		const state = await this.inspectState();
		return state.allowedFiles;
	}
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a ScopedCommitIntegration from a workspace's capability manifest.
 * Extracts canEdit patterns as the allowedWriteSet for the commit gate.
 *
 * @param repoRoot - Root of the git repository
 * @param workspaceId - Workspace identifier for audit
 * @param workspace - Workspace specification with capabilities
 * @param options - Optional overrides
 * @returns Configured ScopedCommitIntegration
 */
export function createScopedIntegrationFromWorkspace(
	repoRoot: string,
	workspaceId: string,
	workspace: Workspace,
	options?: {
		allowGeneratedArtifacts?: boolean;
		generatedArtifactGlobs?: string[];
	},
): ScopedCommitIntegration {
	const allowedWriteSet: string[] = [];

	// Primary source: capabilities.canEdit
	if (workspace.capabilities?.canEdit && workspace.capabilities.canEdit.length > 0) {
		allowedWriteSet.push(...workspace.capabilities.canEdit);
	}

	// Fallback: if no canEdit patterns, use a reasonable default
	if (allowedWriteSet.length === 0) {
		allowedWriteSet.push("src/**", "*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.md");
	}

	return new ScopedCommitIntegration({
		repoRoot,
		workspaceId,
		allowedWriteSet,
		allowGeneratedArtifacts: options?.allowGeneratedArtifacts,
		generatedArtifactGlobs: options?.generatedArtifactGlobs,
	});
}

/**
 * Create a ScopedCommitIntegration from explicit allowedWriteSet patterns.
 *
 * @param repoRoot - Root of the git repository
 * @param workspaceId - Workspace identifier for audit
 * @param allowedWriteSet - File glob patterns the workspace is allowed to modify
 * @param options - Optional overrides
 * @returns Configured ScopedCommitIntegration
 */
export function createScopedCommitIntegration(
	repoRoot: string,
	workspaceId: string,
	allowedWriteSet: string[],
	options?: {
		allowGeneratedArtifacts?: boolean;
		generatedArtifactGlobs?: string[];
	},
): ScopedCommitIntegration {
	return new ScopedCommitIntegration({
		repoRoot,
		workspaceId,
		allowedWriteSet,
		allowGeneratedArtifacts: options?.allowGeneratedArtifacts,
		generatedArtifactGlobs: options?.generatedArtifactGlobs,
	});
}
