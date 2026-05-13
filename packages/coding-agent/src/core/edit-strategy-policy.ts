/**
 * Edit Strategy Policy - Adaptive Edit Strategy & Failure Handoff
 *
 * P4.5: Provides strategy modes (Token Saving, Hybrid, Speed) that determine
 * whether a file should be edited (patched) or fully rewritten.
 * Default mode is Hybrid, which balances token savings with flexibility.
 *
 * Uses shared types from edit-strategy-types.ts.
 */

import type { EditStrategyMode, EditStrategyPolicyConfig, EditStrategyResult } from "./edit-strategy-types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_EDIT_STRATEGY_POLICY_CONFIG: EditStrategyPolicyConfig = {
	mode: "hybrid",
	tokenSavingMaxLines: 200,
	tokenSavingMaxBytes: 8192, // 8KB
	hybridBudgetMaxLines: 1000,
	hybridBudgetMaxBytes: 40960, // 40KB
	speedMaxLines: 1000,
	tokenSavingTsxPatchRequiredLines: 300,
	hybridTsxPatchRequiredLines: 1000,
	sameFileEditFailureHandoffThreshold: 2,
	truncationForcesFallback: true,
	exactMatchFailureCountsTowardHandoff: true,
	generatedManifest: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file path is a TSX/JSX component.
 *
 * @param filePath - Relative file path
 * @returns True if the file has a .tsx or .jsx extension
 */
function isTsxComponent(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return lower.endsWith(".tsx") || lower.endsWith(".jsx");
}

// ---------------------------------------------------------------------------
// EditStrategyPolicy
// ---------------------------------------------------------------------------

/**
 * Policy engine that determines whether a file write operation should be
 * allowed as a full rewrite or must be performed as a targeted edit (patch).
 *
 * Three modes are supported:
 * - **Token Saving**: Blocks full rewrites of existing files over 200 lines or 8KB.
 *   TSX/JSX components over 300 lines require patch mode.
 *   New files are always allowed. Generated files need manifest marking.
 * - **Hybrid** (default): Like Token Saving for small files, but allows full rewrites
 *   under 1000 lines and 40KB when output budget passes.
 *   TSX/JSX components over 1000 lines require patch mode.
 * - **Speed**: Allows full rewrites under 1000 lines (warn above soft limit),
 *   preserving hard safety gates. Token-saving edit restrictions are disabled.
 */
export class EditStrategyPolicy {
	private config: EditStrategyPolicyConfig;

	constructor(config: Partial<EditStrategyPolicyConfig> = {}) {
		this.config = { ...DEFAULT_EDIT_STRATEGY_POLICY_CONFIG, ...config };
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Check whether a full rewrite (write) is allowed for the given file,
	 * or whether only targeted edits (patches) should be used.
	 *
	 * @param filePath - Relative path of the file being written
	 * @param isNewFile - True if the file does not yet exist on disk
	 * @param existingLineCount - Number of lines in the existing file (0 for new files)
	 * @param existingByteSize - Byte size of the existing file (0 for new files)
	 * @param newContentByteSize - Byte size of the content being written
	 * @param outputBudgetRemaining - Remaining output token budget (undefined = not checked)
	 * @param newLineCount - Number of lines in the new content being written
	 * @returns Policy result indicating whether write is allowed and why
	 */
	checkPolicy(
		filePath: string,
		isNewFile: boolean,
		existingLineCount: number,
		existingByteSize: number,
		newContentByteSize: number = 0,
		outputBudgetRemaining?: number,
		newLineCount: number = 0,
	): EditStrategyResult {
		// New files: always write-allowed in all modes
		if (isNewFile) {
			return {
				allowed: true,
				writeAllowed: true,
				reasonCode: "new_file_write_allowed",
				reason: "New files are always write-allowed in all modes",
			};
		}

		// Generated files with manifest marking can be rewrite-allowed
		const manifestEntry = this.config.generatedManifest.find((entry) => entry.path === filePath);
		if (manifestEntry?.rewriteAllowed) {
			return {
				allowed: true,
				writeAllowed: true,
				reasonCode: "manifest_marked_rewrite_allowed",
				reason: `File "${filePath}" is marked as rewrite-allowed in the generated manifest`,
			};
		}

		// Generated files without manifest marking: blocked if over size
		if (manifestEntry && !manifestEntry.rewriteAllowed) {
			return {
				allowed: true,
				writeAllowed: false,
				reasonCode: "generated_file_rewrite_blocked",
				reason: `File "${filePath}" is in the generated manifest but not marked as rewrite-allowed`,
			};
		}

		// Dispatch to mode-specific logic
		switch (this.config.mode) {
			case "token_saving":
				return this.checkTokenSaving(existingLineCount, existingByteSize, filePath);
			case "hybrid":
				return this.checkHybrid(
					existingLineCount,
					existingByteSize,
					newContentByteSize,
					outputBudgetRemaining,
					newLineCount,
					filePath,
				);
			case "speed":
				return this.checkSpeed(existingLineCount, existingByteSize, filePath);
		}
	}

	/**
	 * Get the current strategy mode.
	 */
	getMode(): EditStrategyMode {
		return this.config.mode;
	}

	/**
	 * Get a read-only copy of the current config.
	 */
	getConfig(): Readonly<EditStrategyPolicyConfig> {
		return { ...this.config };
	}

	/**
	 * Get the same-file edit failure handoff threshold for the current mode.
	 */
	getHandoffThreshold(): number {
		return this.config.sameFileEditFailureHandoffThreshold;
	}

	/**
	 * Whether truncation forces fallback in the current mode.
	 */
	isTruncationFallbackEnabled(): boolean {
		return this.config.truncationForcesFallback;
	}

	/**
	 * Whether exact-match failure counts toward handoff in the current mode.
	 */
	isExactMatchFailureCounted(): boolean {
		return this.config.exactMatchFailureCountsTowardHandoff;
	}

	/**
	 * Update the policy configuration (partial merge).
	 */
	updateConfig(partial: Partial<EditStrategyPolicyConfig>): void {
		this.config = { ...this.config, ...partial };
	}

	// -----------------------------------------------------------------------
	// Mode-specific checks
	// -----------------------------------------------------------------------

	/**
	 * Token Saving mode: blocks existing files over 200 lines or 8KB from full rewrite.
	 * TSX/JSX components over 300 lines require targeted patch mode.
	 */
	private checkTokenSaving(existingLineCount: number, existingByteSize: number, filePath: string): EditStrategyResult {
		// TSX/JSX component check
		if (isTsxComponent(filePath) && existingLineCount > this.config.tokenSavingTsxPatchRequiredLines) {
			return {
				allowed: true,
				writeAllowed: false,
				reasonCode: "tsx_component_patch_required",
				reason: `Token Saving mode: TSX/JSX component "${filePath}" has ${existingLineCount} lines, exceeding ${this.config.tokenSavingTsxPatchRequiredLines}-line component limit. Use patch edits instead.`,
			};
		}

		// Block if exceeding line limit
		if (existingLineCount > this.config.tokenSavingMaxLines) {
			return {
				allowed: true,
				writeAllowed: false,
				reasonCode: "existing_file_blocked_size",
				reason: `Token Saving mode: existing file "${filePath}" has ${existingLineCount} lines, exceeding ${this.config.tokenSavingMaxLines}-line limit. Use patch edits instead.`,
			};
		}

		// Block if exceeding byte limit
		if (existingByteSize > this.config.tokenSavingMaxBytes) {
			return {
				allowed: true,
				writeAllowed: false,
				reasonCode: "existing_file_blocked_bytes",
				reason: `Token Saving mode: existing file "${filePath}" is ${existingByteSize} bytes, exceeding ${this.config.tokenSavingMaxBytes}-byte limit. Use patch edits instead.`,
			};
		}

		// Under both limits, full rewrite is allowed
		return {
			allowed: true,
			writeAllowed: true,
			reasonCode: "existing_file_blocked_size",
			reason: `Token Saving mode: existing file "${filePath}" is within limits, write allowed`,
		};
	}

	/**
	 * Hybrid mode: like Token Saving by default, but allows full rewrite
	 * under 1000 lines and 40KB when output budget passes.
	 * TSX/JSX components over 1000 lines require targeted patch mode.
	 */
	private checkHybrid(
		existingLineCount: number,
		existingByteSize: number,
		newContentByteSize: number,
		outputBudgetRemaining: number | undefined,
		newLineCount: number,
		filePath: string,
	): EditStrategyResult {
		// Check if output budget allows full rewrite
		const budgetPasses = this.outputBudgetPasses(newContentByteSize, outputBudgetRemaining, newLineCount);

		if (budgetPasses) {
			// TSX/JSX component check in hybrid budget-pass path
			if (isTsxComponent(filePath) && existingLineCount > this.config.hybridTsxPatchRequiredLines) {
				return {
					allowed: true,
					writeAllowed: false,
					reasonCode: "tsx_component_patch_required",
					reason: `Hybrid mode: TSX/JSX component "${filePath}" has ${existingLineCount} lines, exceeding ${this.config.hybridTsxPatchRequiredLines}-line component limit. Use patch edits.`,
				};
			}

			// Allow full rewrite under hybrid budget limits
			if (
				existingLineCount <= this.config.hybridBudgetMaxLines &&
				existingByteSize <= this.config.hybridBudgetMaxBytes
			) {
				return {
					allowed: true,
					writeAllowed: true,
					reasonCode: "output_budget_pass_full_rewrite",
					reason: `Hybrid mode: output budget passes, file "${filePath}" (${existingLineCount} lines, ${existingByteSize} bytes) within budget limits. Full rewrite allowed.`,
				};
			}

			// File too large even for budget-pass hybrid
			if (existingLineCount > this.config.hybridBudgetMaxLines) {
				return {
					allowed: true,
					writeAllowed: false,
					reasonCode: "existing_file_blocked_size",
					reason: `Hybrid mode: output budget passes but file "${filePath}" has ${existingLineCount} lines, exceeding ${this.config.hybridBudgetMaxLines}-line limit. Use patch edits.`,
				};
			}

			if (existingByteSize > this.config.hybridBudgetMaxBytes) {
				return {
					allowed: true,
					writeAllowed: false,
					reasonCode: "existing_file_blocked_bytes",
					reason: `Hybrid mode: output budget passes but file "${filePath}" is ${existingByteSize} bytes, exceeding ${this.config.hybridBudgetMaxBytes}-byte limit. Use patch edits.`,
				};
			}
		}

		// Budget doesn't pass or not provided: fall back to token-saving behavior
		return this.checkTokenSaving(existingLineCount, existingByteSize, filePath);
	}

	/**
	 * Speed mode: allows full rewrite under 1000 lines (warn above soft limit),
	 * preserving hard safety gates.
	 */
	private checkSpeed(existingLineCount: number, _existingByteSize: number, filePath: string): EditStrategyResult {
		// Hard safety gate: extremely large files are always blocked
		if (existingLineCount > this.config.speedMaxLines) {
			return {
				allowed: true,
				writeAllowed: false,
				reasonCode: "hard_safety_gate_blocked",
				reason: `Speed mode: hard safety gate - file "${filePath}" has ${existingLineCount} lines, exceeding ${this.config.speedMaxLines}-line limit. Use patch edits.`,
			};
		}

		// Warn when above soft limit but below hard gate
		if (existingLineCount > this.config.speedMaxLines) {
			// Already handled above
		}

		// Under speed limit: full rewrite allowed
		return {
			allowed: true,
			writeAllowed: true,
			reasonCode: "speed_mode_full_rewrite",
			reason: `Speed mode: file "${filePath}" (${existingLineCount} lines) under ${this.config.speedMaxLines}-line limit. Full rewrite allowed.`,
		};
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Determine whether the remaining output budget is sufficient to
	 * justify a full rewrite.
	 *
	 * @param newContentByteSize - Byte size of the new content being written
	 * @param outputBudgetRemaining - Remaining output token budget
	 * @param newLineCount - Number of lines in the new content
	 * @returns True if budget passes
	 */
	private outputBudgetPasses(
		newContentByteSize: number,
		outputBudgetRemaining: number | undefined,
		newLineCount: number,
	): boolean {
		if (outputBudgetRemaining === undefined) {
			return false;
		}

		// Estimate tokens from byte size (conservative: ~4 bytes per token)
		const estimatedTokens = newContentByteSize > 0 ? Math.ceil(newContentByteSize / 4) : newLineCount * 20; // fallback: ~20 tokens per line

		return estimatedTokens <= outputBudgetRemaining;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EditStrategyPolicy instance.
 *
 * @param config - Partial config overrides (defaults used for omitted fields)
 * @returns EditStrategyPolicy instance
 */
export function createEditStrategyPolicy(config?: Partial<EditStrategyPolicyConfig>): EditStrategyPolicy {
	return new EditStrategyPolicy(config);
}

// Re-export types for convenience
export type {
	EditStrategyMode,
	EditStrategyPolicyConfig,
	EditStrategyReasonCode,
	EditStrategyResult,
	GeneratedManifestEntry,
} from "./edit-strategy-types.js";
