/**
 * P43.6 — WorkspaceCommitGate
 *
 * Enforces that workers can only stage and commit files belonging to their
 * workspace-owned write-set. Blocks dangerous git commands like `git add .`,
 * `git add -A`, and `git commit -a`.
 *
 * This is the core P44 commit safety guarantee.
 */

import { execSync } from "node:child_process";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceCommitGateConfig {
	/** Root of the git repository */
	repoRoot: string;
	/** Workspace identifier for audit */
	workspaceId: string;
	/** File globs/patterns the workspace is allowed to modify */
	allowedWriteSet: string[];
	/** Whether to allow staging/committing deleted files that are in the write-set */
	allowDeletedOwnedFiles?: boolean;
	/** Whether to allow generated artifact files (lockfiles, build output) */
	allowGeneratedArtifacts?: boolean;
	/** Glob patterns for generated artifacts */
	generatedArtifactGlobs?: string[];
	/** Whether to forbid bulk git add commands (add ., add -A, etc.) */
	forbidBulkGitAdd?: boolean;
	/** Whether to forbid git commit -a / --all */
	forbidCommitAll?: boolean;
}

export interface WorkspaceCommitGateResult {
	/** Whether the commit/staging operation is allowed */
	allowed: boolean;
	/** Human-readable reason if blocked */
	reason?: string;
	/** Files currently staged */
	stagedFiles: string[];
	/** Files modified but unstaged */
	unstagedModifiedFiles: string[];
	/** Staged files not in the allowed write-set */
	unexpectedStagedFiles: string[];
	/** Modified files not in the allowed write-set */
	unexpectedModifiedFiles: string[];
	/** Files in the write-set that are staged or modified */
	allowedFiles: string[];
	/** Git commands that were blocked */
	blockedCommands?: string[];
}

// ---------------------------------------------------------------------------
// WorkspaceCommitGate
// ---------------------------------------------------------------------------

const DANGEROUS_GIT_ADD_PATTERNS = [
	/^git\s+add\s*\.\s*$/,
	/^git\s+add\s+-A\s*$/,
	/^git\s+add\s+--all\s*$/,
	/^git\s+add\s+-A\s+.*$/,
	/^git\s+add\s+--all\s+.*$/,
	/^git\s+add\s+\.$/,
	/^git\s+commit\s+-a\b/,
	/^git\s+commit\s+--all\b/,
];

export class WorkspaceCommitGate {
	private readonly config: Required<WorkspaceCommitGateConfig>;

	constructor(config: WorkspaceCommitGateConfig) {
		this.config = {
			repoRoot: path.resolve(config.repoRoot),
			workspaceId: config.workspaceId,
			allowedWriteSet: config.allowedWriteSet,
			allowDeletedOwnedFiles: config.allowDeletedOwnedFiles ?? true,
			allowGeneratedArtifacts: config.allowGeneratedArtifacts ?? false,
			generatedArtifactGlobs: config.generatedArtifactGlobs ?? [],
			forbidBulkGitAdd: config.forbidBulkGitAdd ?? true,
			forbidCommitAll: config.forbidCommitAll ?? true,
		};
	}

	/**
	 * Get the resolved repo root path.
	 */
	get repoRoot(): string {
		return this.config.repoRoot;
	}

	/**
	 * Inspect the current git state: staged files and unstaged modified files.
	 */
	async inspectGitState(): Promise<WorkspaceCommitGateResult> {
		const stagedFiles = this._getStagedFiles();
		const unstagedModifiedFiles = this._getUnstagedModifiedFiles();
		const allModified = [...new Set([...stagedFiles, ...unstagedModifiedFiles])];

		const allowedFiles = allModified.filter((f) => this._isAllowed(f));
		const unexpectedStagedFiles = stagedFiles.filter((f) => !this._isAllowed(f));
		const unexpectedModifiedFiles = unstagedModifiedFiles.filter((f) => !this._isAllowed(f));

		return {
			allowed: unexpectedStagedFiles.length === 0,
			reason:
				unexpectedStagedFiles.length > 0
					? `WorkspaceCommitGate blocked: unexpected staged files outside writeSet: ${unexpectedStagedFiles.join(", ")}`
					: undefined,
			stagedFiles,
			unstagedModifiedFiles,
			unexpectedStagedFiles,
			unexpectedModifiedFiles,
			allowedFiles,
		};
	}

	/**
	 * Validate currently staged files against the write-set.
	 */
	async validateStagedFiles(): Promise<WorkspaceCommitGateResult> {
		return this.inspectGitState();
	}

	/**
	 * Validate a git command before execution.
	 * Returns a result with allowed=false if the command is dangerous.
	 */
	validateCommand(command: string): WorkspaceCommitGateResult {
		const trimmed = command.trim().replace(/\s+/g, " ");

		for (const pattern of DANGEROUS_GIT_ADD_PATTERNS) {
			if (pattern.test(trimmed)) {
				return {
					allowed: false,
					reason: `WorkspaceCommitGate blocked dangerous git command: "${trimmed}". Use scoped 'git add <file>' instead.`,
					stagedFiles: [],
					unstagedModifiedFiles: [],
					unexpectedStagedFiles: [],
					unexpectedModifiedFiles: [],
					allowedFiles: [],
					blockedCommands: [trimmed],
				};
			}
		}

		// For scoped git add <file>, validate that each file is in the write-set
		if (trimmed.startsWith("git add ")) {
			const args = trimmed.slice(8).trim();
			// Parse shell arguments respecting backslash escaping
			const files: string[] = [];
			let current = "";
			let escaped = false;
			for (const ch of args) {
				if (ch === "\\") {
					escaped = true;
					continue;
				}
				if (escaped) {
					current += ch;
					escaped = false;
					continue;
				}
				if (/\s/.test(ch)) {
					if (current.length > 0 && !current.startsWith("-")) {
						files.push(current.replace(/^\.\//, ""));
					}
					current = "";
					continue;
				}
				current += ch;
			}
			if (current.length > 0 && !current.startsWith("-")) {
				files.push(current.replace(/^\.\//, ""));
			}

			const disallowed = files.filter((f) => !this._isAllowed(f));
			if (disallowed.length > 0) {
				return {
					allowed: false,
					reason: `WorkspaceCommitGate blocked: files not in writeSet: ${disallowed.join(", ")}`,
					stagedFiles: [],
					unstagedModifiedFiles: [],
					unexpectedStagedFiles: disallowed,
					unexpectedModifiedFiles: [],
					allowedFiles: files.filter((f) => this._isAllowed(f)),
					blockedCommands: [trimmed],
				};
			}
		}

		return {
			allowed: true,
			stagedFiles: [],
			unstagedModifiedFiles: [],
			unexpectedStagedFiles: [],
			unexpectedModifiedFiles: [],
			allowedFiles: [],
		};
	}

	/**
	 * Stage only the allowed files from the write-set.
	 * Does NOT run `git add .` or `git add -A`.
	 */
	async stageAllowedFiles(): Promise<WorkspaceCommitGateResult> {
		const result = await this.inspectGitState();

		if (result.unexpectedStagedFiles.length > 0) {
			return {
				reason: `WorkspaceCommitGate: cannot stage: unexpected files already staged: ${result.unexpectedStagedFiles.join(", ")}`,
				...result,
				allowed: false,
			};
		}

		// Only stage files from the write-set that exist and are modified (or new)
		const filesToStage = this._getModifiedFilesInWriteSet();

		if (filesToStage.length === 0) {
			// Nothing to stage
			return {
				allowed: true,
				stagedFiles: result.stagedFiles,
				unstagedModifiedFiles: result.unstagedModifiedFiles,
				unexpectedStagedFiles: [],
				unexpectedModifiedFiles: result.unexpectedModifiedFiles,
				allowedFiles: result.allowedFiles,
			};
		}

		try {
			execSync(`git add -- ${filesToStage.map((f) => this._shellEscape(f)).join(" ")}`, {
				cwd: this.config.repoRoot,
				stdio: "pipe",
			});
		} catch (error) {
			return {
				allowed: false,
				reason: `WorkspaceCommitGate: failed to stage files: ${(error as Error).message}`,
				stagedFiles: result.stagedFiles,
				unstagedModifiedFiles: result.unstagedModifiedFiles,
				unexpectedStagedFiles: [],
				unexpectedModifiedFiles: result.unexpectedModifiedFiles,
				allowedFiles: filesToStage,
			};
		}

		const newStagedFiles = await this._getStagedFilesAsync();
		return {
			allowed: true,
			stagedFiles: newStagedFiles,
			unstagedModifiedFiles: result.unstagedModifiedFiles.filter((f) => !filesToStage.includes(f)),
			unexpectedStagedFiles: [],
			unexpectedModifiedFiles: result.unexpectedModifiedFiles,
			allowedFiles: filesToStage,
		};
	}

	/**
	 * Create a scoped commit with only allowed files staged.
	 * Validates state first, then commits scoped files.
	 */
	async createScopedCommit(message: string): Promise<WorkspaceCommitGateResult> {
		// First validate current state
		const validation = await this.validateStagedFiles();
		if (!validation.allowed) {
			return validation;
		}

		// Get staged files
		const stagedFiles = this._getStagedFiles();
		if (stagedFiles.length === 0) {
			// Try staging allowed files
			const stageResult = await this.stageAllowedFiles();
			if (!stageResult.allowed) {
				return stageResult;
			}
		}

		// Final check: all staged files must be allowed
		const allStaged = this._getStagedFiles();
		const disallowedStaged = allStaged.filter((f) => !this._isAllowed(f));
		if (disallowedStaged.length > 0) {
			return {
				allowed: false,
				reason: `WorkspaceCommitGate: cannot commit: unexpected files staged: ${disallowedStaged.join(", ")}`,
				stagedFiles: allStaged,
				unstagedModifiedFiles: this._getUnstagedModifiedFiles(),
				unexpectedStagedFiles: disallowedStaged,
				unexpectedModifiedFiles: [],
				allowedFiles: allStaged.filter((f) => this._isAllowed(f)),
			};
		}

		if (allStaged.length === 0) {
			return {
				allowed: false,
				reason: "WorkspaceCommitGate: nothing to commit",
				stagedFiles: [],
				unstagedModifiedFiles: this._getUnstagedModifiedFiles(),
				unexpectedStagedFiles: [],
				unexpectedModifiedFiles: [],
				allowedFiles: [],
			};
		}

		try {
			execSync(`git commit -m ${this._shellEscape(message)}`, {
				cwd: this.config.repoRoot,
				stdio: "pipe",
			});
		} catch (error) {
			return {
				allowed: false,
				reason: `WorkspaceCommitGate: commit failed: ${(error as Error).message}`,
				stagedFiles: allStaged,
				unstagedModifiedFiles: this._getUnstagedModifiedFiles(),
				unexpectedStagedFiles: [],
				unexpectedModifiedFiles: [],
				allowedFiles: allStaged,
			};
		}

		return {
			allowed: true,
			stagedFiles: allStaged,
			unstagedModifiedFiles: this._getUnstagedModifiedFiles(),
			unexpectedStagedFiles: [],
			unexpectedModifiedFiles: [],
			allowedFiles: allStaged,
		};
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Check if a file path is within the allowed write-set.
	 */
	private _isAllowed(filePath: string): boolean {
		const normalized = filePath.replace(/\\/g, "/");
		return this.config.allowedWriteSet.some((pattern) => {
			const normalizedPattern = pattern.replace(/\\/g, "/");

			// Exact match
			if (normalizedPattern === normalized) return true;

			// Glob-style: dir/** matches dir and its children
			if (normalizedPattern.endsWith("/**")) {
				const prefix = normalizedPattern.slice(0, -3);
				return normalized === prefix || normalized.startsWith(`${prefix}/`);
			}

			// Extension glob: *.ext matches files ending in .ext
			if (normalizedPattern.startsWith("*.")) {
				const ext = normalizedPattern.slice(1);
				return normalized.endsWith(ext);
			}

			// Directory prefix match
			if (normalizedPattern.endsWith("/")) {
				return normalized.startsWith(normalizedPattern);
			}

			// General glob: path/*.ext (e.g., src/*.ts)
			// Convert pattern to regex for exact path-level matching
			if (normalizedPattern.includes("*")) {
				const regexStr =
					"^" +
					normalizedPattern
						.split("/")
						.map((part) => {
							if (part === "**") return ".*";
							if (part.includes("*")) {
								return part.replace(/\./g, "\\.").replace(/\*/g, "[^/]*");
							}
							return part.replace(/\./g, "\\.");
						})
						.join("/") +
					"$";
				try {
					return new RegExp(regexStr).test(normalized);
				} catch {
					return false;
				}
			}

			return false;
		});
	}

	/**
	 * Get files staged in the index.
	 */
	private _getStagedFiles(): string[] {
		try {
			const output = execSync("git diff --cached --name-only", {
				cwd: this.config.repoRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "ignore"],
			});
			return output
				.trim()
				.split("\n")
				.filter((f) => f.length > 0);
		} catch {
			return [];
		}
	}

	/**
	 * Get unstaged modified files (working tree changes not in index).
	 */
	private _getUnstagedModifiedFiles(): string[] {
		try {
			const output = execSync("git diff --name-only", {
				cwd: this.config.repoRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "ignore"],
			});
			return output
				.trim()
				.split("\n")
				.filter((f) => f.length > 0);
		} catch {
			return [];
		}
	}

	/**
	 * Async variant of _getStagedFiles for use in async contexts.
	 */
	private async _getStagedFilesAsync(): Promise<string[]> {
		return this._getStagedFiles();
	}

	/**
	 * Get files in the write-set that are currently modified (staged or unstaged).
	 */
	private _getModifiedFilesInWriteSet(): string[] {
		const allModified = [...new Set([...this._getStagedFiles(), ...this._getUnstagedModifiedFiles()])];
		return allModified.filter((f) => this._isAllowed(f));
	}

	/**
	 * Shell-escape a string for use in execSync.
	 */
	private _shellEscape(s: string): string {
		return `'${s.replace(/'/g, "'\\''")}'`;
	}
}
