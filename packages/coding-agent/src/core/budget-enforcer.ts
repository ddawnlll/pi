/**
 * Budget & Blast-Radius Enforcer - P9.E
 *
 * Enforces budget limits (token budgets) and blast-radius controls
 * (maxFiles, maxLines, allowedPaths, forbiddenPaths, approvalExpiry)
 * for workspace execution.
 *
 * Budget violations block execution entirely.
 * Blast-radius violations block execution with a clear error.
 *
 * Both budget and blast-radius summaries appear in dry-run and
 * approval artifacts.
 */

import type { WorkspacePacket } from "./context-packet.js";

// ---------------------------------------------------------------------------
// Blast-Radius Config
// ---------------------------------------------------------------------------

/**
 * Blast-radius controls that limit how much a workspace can affect.
 *
 * These controls prevent a single workspace from modifying too many
 * files, changing too many lines, or touching forbidden paths.
 */
export interface BlastRadiusConfig {
	/**
	 * Maximum number of files that can be modified.
	 * When set, execution is blocked if the workspace attempts to
	 * modify more files than this limit.
	 * @default undefined (no limit)
	 */
	maxFiles?: number;

	/**
	 * Maximum number of lines that can be modified across all files.
	 * When set, execution is blocked if total modified lines exceed
	 * this limit.
	 * @default undefined (no limit)
	 */
	maxLines?: number;

	/**
	 * File glob patterns that are allowed to be modified.
	 * Only files matching these patterns may be changed.
	 * Workspace capabilities (canEdit) must also match.
	 * @default undefined (no restriction beyond canEdit/cannotEdit)
	 */
	allowedPaths?: string[];

	/**
	 * File glob patterns that are forbidden from modification.
	 * No files matching these patterns may be changed, regardless of
	 * what canEdit/cannotEdit says.
	 * @default undefined (no restriction beyond canEdit/cannotEdit)
	 */
	forbiddenPaths?: string[];

	/**
	 * Approval expiry duration in milliseconds.
	 * When set, approvals for this workspace expire after this duration.
	 * null means the approval never expires.
	 * @default null (never expires)
	 */
	approvalExpiry?: number | null;
}

// ---------------------------------------------------------------------------
// Budget Config
// ---------------------------------------------------------------------------

/**
 * Budget configuration for token limits.
 */
export interface BudgetConfig {
	/**
	 * Maximum input tokens allowed for this workspace.
	 * When the estimated input tokens exceed this, execution is blocked.
	 * @default 12000 (worker default)
	 */
	maxInputTokens: number;
}

// ---------------------------------------------------------------------------
// Budget Summary
// ---------------------------------------------------------------------------

/**
 * A snapshot of budget and blast-radius controls for display in
 * dry-run reports and approval artifacts.
 */
export interface BudgetSummary {
	/** Token budget */
	maxInputTokens: number;
	/** Estimated input tokens (0 if not yet estimated) */
	estimatedInputTokens: number;
	/** Maximum files allowed (undefined if no limit) */
	maxFiles?: number;
	/** Maximum lines allowed (undefined if no limit) */
	maxLines?: number;
	/** Allowed file paths (empty array if no restriction) */
	allowedPaths: string[];
	/** Forbidden file paths */
	forbiddenPaths: string[];
	/** Approval expiry in ms (null = never expires) */
	approvalExpiry: number | null;

	/** Whether the budget is within limits */
	withinBudget: boolean;
	/** Whether blast-radius controls are within limits (placeholder - actual check at post-execution) */
	blastRadiusOk: boolean;
}

// ---------------------------------------------------------------------------
// Budget Violation Error
// ---------------------------------------------------------------------------

/**
 * Error thrown when budget or blast-radius controls are violated.
 */
export class BudgetViolation extends Error {
	/** The type of violation */
	public readonly violationType: "budget" | "blast_radius";
	/** Human-readable details about the violation */
	public readonly details: string;

	constructor(violationType: "budget" | "blast_radius", message: string, details?: string) {
		super(message);
		this.name = "BudgetViolation";
		this.violationType = violationType;
		this.details = details ?? message;
	}
}

// ---------------------------------------------------------------------------
// Budget Enforcer
// ---------------------------------------------------------------------------

/**
 * Enforces budget and blast-radius controls for workspace execution.
 *
 * Checks performed:
 * 1. Token budget: estimatedInputTokens <= maxInputTokens
 * 2. Max files: attempt count <= maxFiles (if set)
 * 3. Max lines: total line modifications <= maxLines (if set)
 * 4. Allowed paths: all attempted file paths match allowedPaths (if set)
 * 5. Forbidden paths: no attempted file paths match forbiddenPaths (if set)
 * 6. Approval expiry: approval timestamp is within expiry window (if set)
 */
export class BudgetEnforcer {
	private blastRadius: BlastRadiusConfig;
	private budget: BudgetConfig;

	constructor(blastRadius: BlastRadiusConfig = {}, budget: BudgetConfig = { maxInputTokens: 12000 }) {
		this.blastRadius = blastRadius;
		this.budget = budget;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the current blast-radius configuration.
	 */
	getBlastRadiusConfig(): Readonly<BlastRadiusConfig> {
		return { ...this.blastRadius };
	}

	/**
	 * Get the current budget configuration.
	 */
	getBudgetConfig(): Readonly<BudgetConfig> {
		return { ...this.budget };
	}

	/**
	 * Update the blast-radius configuration (partial merge).
	 */
	updateBlastRadiusConfig(partial: Partial<BlastRadiusConfig>): void {
		this.blastRadius = { ...this.blastRadius, ...partial };
	}

	/**
	 * Update the budget configuration (partial merge).
	 */
	updateBudgetConfig(partial: Partial<BudgetConfig>): void {
		this.budget = { ...this.budget, ...partial };
	}

	// -----------------------------------------------------------------------
	// Enforcement
	// -----------------------------------------------------------------------

	/**
	 * Check that a workspace packet is within budget limits.
	 *
	 * @param packet - The workspace packet to check
	 * @throws {BudgetViolation} If the packet exceeds budget limits
	 * @returns The packet (if within budget)
	 */
	checkBudget(packet: WorkspacePacket): WorkspacePacket {
		if (packet.budget.estimatedInputTokens > packet.budget.maxInputTokens) {
			throw new BudgetViolation(
				"budget",
				`Budget violation: estimated input tokens (${packet.budget.estimatedInputTokens}) exceed max (${packet.budget.maxInputTokens})`,
				`The workspace packet for "${packet.workspaceId}" is over budget. ` +
					`Estimated: ${packet.budget.estimatedInputTokens} tokens, ` +
					`Max: ${packet.budget.maxInputTokens} tokens. ` +
					`Consider reducing scope or increasing the token limit.`,
			);
		}
		return packet;
	}

	/**
	 * Check that an execution attempt is within blast-radius limits.
	 *
	 * @param workspaceId - The workspace ID
	 * @param attemptedFiles - Files the workspace attempted to modify
	 * @param totalLinesChanged - Total lines changed across all files
	 * @throws {BudgetViolation} If blast-radius limits are exceeded
	 */
	checkBlastRadius(workspaceId: string, attemptedFiles: string[], totalLinesChanged: number): void {
		// Max files check
		if (this.blastRadius.maxFiles !== undefined && attemptedFiles.length > this.blastRadius.maxFiles) {
			throw new BudgetViolation(
				"blast_radius",
				`Blast-radius violation: ${attemptedFiles.length} files modified exceeds max of ${this.blastRadius.maxFiles}`,
				`Workspace "${workspaceId}" attempted to modify ${attemptedFiles.length} files, ` +
					`but the maximum allowed is ${this.blastRadius.maxFiles}. ` +
					`Affected files: ${attemptedFiles.join(", ")}`,
			);
		}

		// Max lines check
		if (this.blastRadius.maxLines !== undefined && totalLinesChanged > this.blastRadius.maxLines) {
			throw new BudgetViolation(
				"blast_radius",
				`Blast-radius violation: ${totalLinesChanged} lines changed exceeds max of ${this.blastRadius.maxLines}`,
				`Workspace "${workspaceId}" changed ${totalLinesChanged} lines across ` +
					`${attemptedFiles.length} files, but the maximum allowed is ${this.blastRadius.maxLines}.`,
			);
		}

		// Forbidden paths check
		if (this.blastRadius.forbiddenPaths && this.blastRadius.forbiddenPaths.length > 0) {
			const matches = this.matchPatterns(attemptedFiles, this.blastRadius.forbiddenPaths);
			if (matches.length > 0) {
				throw new BudgetViolation(
					"blast_radius",
					`Blast-radius violation: files in forbidden paths: ${matches.join(", ")}`,
					`Workspace "${workspaceId}" attempted to modify files in forbidden paths: ` +
						`${matches.join(", ")}. ` +
						`Forbidden patterns: ${this.blastRadius.forbiddenPaths.join(", ")}`,
				);
			}
		}

		// Allowed paths check (if set, only those paths may be modified)
		if (this.blastRadius.allowedPaths && this.blastRadius.allowedPaths.length > 0) {
			const disallowed = attemptedFiles.filter(
				(file) => !this.matchPatterns([file], this.blastRadius.allowedPaths!).length,
			);
			if (disallowed.length > 0) {
				throw new BudgetViolation(
					"blast_radius",
					`Blast-radius violation: files not in allowed paths: ${disallowed.join(", ")}`,
					`Workspace "${workspaceId}" attempted to modify files outside allowed paths: ` +
						`${disallowed.join(", ")}. ` +
						`Allowed patterns: ${this.blastRadius.allowedPaths.join(", ")}`,
				);
			}
		}
	}

	/**
	 * Check an approval expiry.
	 *
	 * @param approvedAt - Timestamp when the approval was granted (ms since epoch)
	 * @throws {BudgetViolation} If the approval has expired
	 * @returns Time remaining in ms (or null if never expires)
	 */
	checkApprovalExpiry(approvedAt: number): number | null {
		if (this.blastRadius.approvalExpiry === undefined || this.blastRadius.approvalExpiry === null) {
			return null; // Never expires
		}

		const elapsed = Date.now() - approvedAt;
		if (elapsed > this.blastRadius.approvalExpiry) {
			throw new BudgetViolation(
				"blast_radius",
				"Approval has expired",
				`Approval granted at ${new Date(approvedAt).toISOString()} ` +
					`has expired after ${this.blastRadius.approvalExpiry}ms ` +
					`(${this.blastRadius.approvalExpiry / 1000}s). ` +
					`Please re-approve the workspace.`,
			);
		}

		return this.blastRadius.approvalExpiry - elapsed;
	}

	/**
	 * Check pre-execution conditions: budget and approval expiry.
	 *
	 * @param packet - The workspace packet
	 * @param approvedAt - Optional timestamp when approval was granted
	 * @throws {BudgetViolation} If any pre-execution check fails
	 */
	checkPreExecution(packet: WorkspacePacket, approvedAt?: number): void {
		// Budget check
		this.checkBudget(packet);

		// Approval expiry check
		if (approvedAt !== undefined) {
			this.checkApprovalExpiry(approvedAt);
		}
	}

	// -----------------------------------------------------------------------
	// Summary
	// -----------------------------------------------------------------------

	/**
	 * Build a budget summary from the current configuration and a packet.
	 *
	 * @param packet - Optional workspace packet to include estimated tokens
	 * @returns Budget summary suitable for dry-run reports and approval artifacts
	 */
	buildBudgetSummary(packet?: WorkspacePacket): BudgetSummary {
		const estimatedTokens = packet?.budget.estimatedInputTokens ?? 0;
		const maxTokens = packet?.budget.maxInputTokens ?? this.budget.maxInputTokens;

		return {
			maxInputTokens: maxTokens,
			estimatedInputTokens: estimatedTokens,
			maxFiles: this.blastRadius.maxFiles,
			maxLines: this.blastRadius.maxLines,
			allowedPaths: this.blastRadius.allowedPaths ?? [],
			forbiddenPaths: this.blastRadius.forbiddenPaths ?? [],
			approvalExpiry: this.blastRadius.approvalExpiry ?? null,
			withinBudget: estimatedTokens <= maxTokens,
			blastRadiusOk: true, // Placeholder - actual check at post-execution
		};
	}

	/**
	 * Format a budget summary as a human-readable string.
	 *
	 * @param summary - The budget summary to format
	 * @returns Formatted string
	 */
	formatBudgetSummary(summary: BudgetSummary): string {
		const lines: string[] = [
			"=== Budget & Blast-Radius Summary ===",
			"",
			"--- Token Budget ---",
			`  Max Input Tokens:  ${summary.maxInputTokens}`,
			`  Estimated Tokens:  ${summary.estimatedInputTokens}`,
			`  Status:            ${summary.withinBudget ? "WITHIN BUDGET" : "OVER BUDGET (BLOCKED)"}`,
			"",
			"--- Blast-Radius Controls ---",
		];

		if (summary.maxFiles !== undefined) {
			lines.push(`  Max Files:         ${summary.maxFiles}`);
		} else {
			lines.push(`  Max Files:         No limit`);
		}

		if (summary.maxLines !== undefined) {
			lines.push(`  Max Lines:         ${summary.maxLines}`);
		} else {
			lines.push(`  Max Lines:         No limit`);
		}

		if (summary.allowedPaths.length > 0) {
			lines.push(`  Allowed Paths:     ${summary.allowedPaths.join(", ")}`);
		} else {
			lines.push(`  Allowed Paths:     All (no restriction)`);
		}

		if (summary.forbiddenPaths.length > 0) {
			lines.push(`  Forbidden Paths:   ${summary.forbiddenPaths.join(", ")}`);
		} else {
			lines.push(`  Forbidden Paths:   None`);
		}

		if (summary.approvalExpiry !== null) {
			lines.push(`  Approval Expiry:   ${summary.approvalExpiry}ms (${summary.approvalExpiry / 1000}s)`);
		} else {
			lines.push(`  Approval Expiry:   Never`);
		}

		lines.push(`  Status:            ${summary.blastRadiusOk ? "PASS" : "FAIL"}`);

		return lines.join("\n");
	}

	// -----------------------------------------------------------------------
	// Private Helpers
	// -----------------------------------------------------------------------

	/**
	 * Match file paths against glob-like patterns.
	 *
	 * Supports simple wildcard patterns:
	 * - double-star-slash matches zero or more directory segments
	 * - double-star matches any characters including slash
	 * - star matches any characters except slash
	 * - question matches a single character except slash
	 */
	private matchPatterns(filePaths: string[], patterns: string[]): string[] {
		if (patterns.length === 0) {
			return [];
		}

		return filePaths.filter((filePath) => {
			const normalized = filePath.replace(/\\/g, "/");
			return patterns.some((pattern) => {
				let regexStr = "^";
				let i = 0;
				while (i < pattern.length) {
					const ch = pattern[i];
					if (ch === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
						regexStr += "(?:.+/)?";
						i += 3;
					} else if (ch === "*" && pattern[i + 1] === "*") {
						regexStr += ".*";
						i += 2;
					} else if (ch === "*") {
						regexStr += "[^/]*";
						i += 1;
					} else if (ch === "?") {
						regexStr += "[^/]";
						i += 1;
					} else if (/[.+^${}()|[\]\\]/.test(ch)) {
						regexStr += `\\${ch}`;
						i += 1;
					} else {
						regexStr += ch;
						i += 1;
					}
				}
				regexStr += "$";

				try {
					return new RegExp(regexStr).test(normalized);
				} catch {
					return false;
				}
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a workspace budget and blast-radius enforcer instance.
 *
 * @param blastRadius - Blast-radius configuration (partial, uses defaults)
 * @param budget - Budget configuration (partial, uses defaults)
 * @returns BudgetEnforcer instance
 */
export function createWorkspaceBudgetEnforcer(
	blastRadius: BlastRadiusConfig = {},
	budget: BudgetConfig = { maxInputTokens: 12000 },
): BudgetEnforcer {
	return new BudgetEnforcer(blastRadius, budget);
}
