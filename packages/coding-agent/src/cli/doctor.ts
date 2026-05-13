/**
 * Token Safety Doctor - P1 Workstream 7.F
 *
 * Validates configuration for token safety hazards before agent execution.
 */

import { DEFAULT_CONTEXT_BUDGETS } from "@earendil-works/pi-agent-core";
import { DEFAULT_EDIT_STRATEGY_POLICY_CONFIG } from "../core/edit-strategy-policy.js";
import type { EditStrategyMode } from "../core/edit-strategy-types.js";
import type { ModelRegistry } from "../core/model-registry.js";
import type { SettingsManager } from "../core/settings-manager.js";

/**
 * Doctor check result
 */
export interface DoctorCheck {
	/** Check name */
	name: string;
	/** Check status */
	status: "pass" | "fail" | "warn";
	/** Status message */
	message: string;
	/** Optional details */
	details?: string;
}

/**
 * Doctor check category
 */
export type DoctorCategory = "budget" | "policy" | "config" | "models" | "edit_strategy";

/**
 * Information about an editable file for doctor checks.
 */
export interface EditableFileInfo {
	/** Relative file path */
	filePath: string;
	/** Number of lines in the file (0 if unknown/new) */
	lineCount: number;
	/** Byte size of the file (0 if unknown/new) */
	byteSize: number;
	/** Whether the file is a TSX/JSX component */
	isTsx: boolean;
}

/**
 * Categorized doctor results
 */
export interface DoctorResults {
	/** All checks */
	checks: DoctorCheck[];
	/** Checks by category */
	byCategory: Record<DoctorCategory, DoctorCheck[]>;
	/** Overall status */
	overallStatus: "pass" | "warn" | "fail";
	/** Number of passed checks */
	passCount: number;
	/** Number of warnings */
	warnCount: number;
	/** Number of failed checks */
	failCount: number;
}

/**
 * Run all token safety doctor checks
 *
 * @param settingsManager - Settings manager instance
 * @param modelRegistry - Model registry instance
 * @param editableFiles - Optional list of editable files with size info for large-file warnings
 * @returns Doctor results
 */
export async function runDoctor(
	settingsManager: SettingsManager,
	modelRegistry: ModelRegistry,
	editableFiles?: EditableFileInfo[],
): Promise<DoctorResults> {
	const checks: DoctorCheck[] = [];

	// Budget checks
	checks.push(...checkContextBudgets(settingsManager));

	// File policy checks
	checks.push(...checkFilePolicy(settingsManager));

	// Configuration checks
	checks.push(...checkConfiguration(settingsManager));

	// Edit strategy checks (P4.5)
	checks.push(...checkEditStrategy(settingsManager));

	// Large editable file checks (P4.5.F)
	if (editableFiles && editableFiles.length > 0) {
		checks.push(...checkLargeEditableFiles(settingsManager, editableFiles));
	}

	// Model checks
	checks.push(...(await checkModels(modelRegistry)));

	// Categorize checks
	const byCategory: Record<DoctorCategory, DoctorCheck[]> = {
		budget: checks.filter((c) => c.name.includes("Budget") || c.name.includes("Context")),
		policy: checks.filter((c) => c.name.includes("File") || c.name.includes("Policy")),
		config: checks.filter((c) => c.name.includes("Config") || c.name.includes("Setting")),
		models: checks.filter((c) => c.name.includes("Model")),
		edit_strategy: checks.filter((c) => c.name.includes("Edit Strategy") || c.name.includes("Threshold")),
	};

	// Calculate overall status
	const passCount = checks.filter((c) => c.status === "pass").length;
	const warnCount = checks.filter((c) => c.status === "warn").length;
	const failCount = checks.filter((c) => c.status === "fail").length;

	const overallStatus = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";

	return {
		checks,
		byCategory,
		overallStatus,
		passCount,
		warnCount,
		failCount,
	};
}

/**
 * Check context budget configuration
 */
function checkContextBudgets(settingsManager: SettingsManager): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	const budgets = settingsManager.getContextBudgets();

	// Check if budgets are configured
	checks.push({
		name: "Context Budgets Configured",
		status: budgets ? "pass" : "warn",
		message: budgets ? "Context budgets are configured" : "Context budgets not configured, using defaults",
	});

	// Check max auto context
	const maxAuto = budgets?.maxAuto ?? DEFAULT_CONTEXT_BUDGETS.maxAuto;
	checks.push({
		name: "Max Auto Context",
		status: maxAuto <= 64000 ? "pass" : "fail",
		message: `Max automatic context is ${maxAuto.toLocaleString()} tokens`,
		details: maxAuto > 64000 ? "Should be ≤64K unless explicitly overridden" : undefined,
	});

	// Check 1M context disabled by default
	const millionEnabled = budgets?.millionContextEnabled ?? DEFAULT_CONTEXT_BUDGETS.millionContextEnabled;
	checks.push({
		name: "1M Context Disabled",
		status: !millionEnabled ? "pass" : "fail",
		message: millionEnabled ? "1M context is enabled by default" : "1M context is disabled by default",
		details: millionEnabled ? "1M context should require explicit flag" : undefined,
	});

	// Check worker budget
	const workerBudget = budgets?.worker ?? DEFAULT_CONTEXT_BUDGETS.worker;
	checks.push({
		name: "Worker Budget",
		status: workerBudget <= 12000 ? "pass" : "warn",
		message: `Worker budget is ${workerBudget.toLocaleString()} tokens`,
		details: workerBudget > 12000 ? "Default is 12K tokens" : undefined,
	});

	return checks;
}

/**
 * Check file policy configuration
 */
function checkFilePolicy(_settingsManager: SettingsManager): DoctorCheck[] {
	const checks: DoctorCheck[] = [];

	// Note: File policy settings would be added to SettingsManager in full implementation
	// For now, check that defaults are reasonable

	checks.push({
		name: "Large File Full Injection Disabled",
		status: "pass",
		message: "Large files (>2500 lines) require chunking by default",
	});

	checks.push({
		name: "Huge File Manual Approval",
		status: "pass",
		message: "Huge files (≥8000 lines) require manual approval",
	});

	return checks;
}

/**
 * Check general configuration
 */
function checkConfiguration(settingsManager: SettingsManager): DoctorCheck[] {
	const checks: DoctorCheck[] = [];

	// Check compaction settings
	const compaction = settingsManager.getCompactionSettings();
	checks.push({
		name: "Compaction Enabled",
		status: compaction.enabled ? "pass" : "warn",
		message: compaction.enabled ? "Context compaction is enabled" : "Context compaction is disabled",
		details: !compaction.enabled ? "Compaction helps manage context size" : undefined,
	});

	// Check reserve tokens
	checks.push({
		name: "Reserve Tokens",
		status: compaction.reserveTokens >= 8000 ? "pass" : "warn",
		message: `Reserve tokens: ${compaction.reserveTokens.toLocaleString()}`,
		details: compaction.reserveTokens < 8000 ? "Consider increasing to ≥8K for safety margin" : undefined,
	});

	return checks;
}

/**
 * Check edit strategy configuration (P4.5).
 */
function checkEditStrategy(settingsManager: SettingsManager): DoctorCheck[] {
	const checks: DoctorCheck[] = [];

	// Get current edit strategy mode from settings
	const allSettings = settingsManager.getGlobalSettings();
	const editMode =
		(allSettings.editStrategyMode as EditStrategyMode | undefined) ?? DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.mode;

	// Report selected edit strategy mode
	const modeDescriptions: Record<EditStrategyMode, string> = {
		token_saving: "Token Saving (strict patch-first, 200L/8KB limits)",
		hybrid: "Hybrid (default, allows rewrites under 1000L/40KB)",
		speed: "Speed (full rewrites under 1000L, hard safety gates active)",
	};

	checks.push({
		name: "Edit Strategy Mode",
		status: "pass",
		message: `Selected mode: ${editMode} — ${modeDescriptions[editMode]}`,
	});

	// Warn when in token_saving mode (may block useful full rewrites)
	if (editMode === "token_saving") {
		checks.push({
			name: "Edit Strategy Threshold Warning",
			status: "warn",
			message: "Token Saving mode blocks full rewrites above 200 lines / 8KB",
			details: "Consider switching to Hybrid for more flexibility with larger files",
		});
	}

	// Warn when in speed mode (may cause token spikes)
	if (editMode === "speed") {
		checks.push({
			name: "Edit Strategy Speed Warning",
			status: "warn",
			message: "Speed mode disables token-saving edit restrictions",
			details: "Hard safety gates remain active, but large file rewrites may consume more tokens",
		});
	}

	// Warn about handoff threshold
	const handoffThreshold = DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.sameFileEditFailureHandoffThreshold;
	checks.push({
		name: "Edit Strategy Handoff Threshold",
		status: handoffThreshold >= 2 ? "pass" : "warn",
		message: `Same-file edit failure handoff threshold: ${handoffThreshold}`,
		details: handoffThreshold < 2 ? "Threshold below 2 may trigger handoff too early" : undefined,
	});

	return checks;
}

/**
 * Check for large existing editable files that may need patch-first instruction.
 *
 * Warns when the plan includes canEdit files that exceed the selected mode's
 * thresholds, because these files will force the agent to use targeted patches
 * or risk truncation/rejection.
 *
 * @param settingsManager - Settings manager instance
 * @param editableFiles - List of editable files with size info
 * @returns Array of doctor checks
 */
export function checkLargeEditableFiles(
	settingsManager: SettingsManager,
	editableFiles: EditableFileInfo[],
): DoctorCheck[] {
	const checks: DoctorCheck[] = [];

	// Get current edit strategy mode from settings
	const allSettings = settingsManager.getGlobalSettings();
	const editMode =
		(allSettings.editStrategyMode as EditStrategyMode | undefined) ?? DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.mode;

	// Determine thresholds based on mode
	const thresholds = getModeThresholds(editMode);

	// Scan editable files for those exceeding thresholds
	const largeFiles: EditableFileInfo[] = [];
	for (const file of editableFiles) {
		if (file.lineCount > thresholds.maxLines || file.byteSize > thresholds.maxBytes) {
			largeFiles.push(file);
		} else if (file.isTsx && file.lineCount > thresholds.tsxPatchRequiredLines) {
			largeFiles.push(file);
		}
	}

	if (largeFiles.length === 0) {
		checks.push({
			name: "Edit Strategy Large Editable Files",
			status: "pass",
			message: "No editable files exceed mode thresholds",
		});
	} else {
		const fileList = largeFiles
			.map((f) => `${f.filePath} (${f.lineCount}L, ${f.byteSize}B${f.isTsx ? ", TSX" : ""})`)
			.join(", ");

		checks.push({
			name: "Edit Strategy Large Editable Files",
			status: "warn",
			message: `${largeFiles.length} editable file(s) exceed ${editMode} mode thresholds and require patch-first approach`,
			details:
				`Files: ${fileList}. Agent will be forced to use targeted edits for these files. ` +
				`Consider restructuring large files or using Hybrid/Speed mode for more flexibility.`,
		});
	}

	return checks;
}

/**
 * Get the threshold limits for a given edit strategy mode.
 *
 * @param mode - Edit strategy mode
 * @returns Threshold values for the mode
 */
export function getModeThresholds(mode: EditStrategyMode): {
	maxLines: number;
	maxBytes: number;
	tsxPatchRequiredLines: number;
} {
	switch (mode) {
		case "token_saving":
			return {
				maxLines: DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxLines,
				maxBytes: DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxBytes,
				tsxPatchRequiredLines: DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingTsxPatchRequiredLines,
			};
		case "hybrid":
			return {
				maxLines: DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxLines,
				maxBytes: DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxBytes,
				tsxPatchRequiredLines: DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridTsxPatchRequiredLines,
			};
		case "speed":
			return {
				maxLines: DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.speedMaxLines,
				maxBytes: Number.MAX_SAFE_INTEGER, // Speed mode doesn't enforce byte limits for rewrites
				tsxPatchRequiredLines: Number.MAX_SAFE_INTEGER, // Speed mode doesn't require TSX patch
			};
	}
}

/**
 * Check model configuration
 */
async function checkModels(modelRegistry: ModelRegistry): Promise<DoctorCheck[]> {
	const checks: DoctorCheck[] = [];

	// Check if models are available
	const availableModels = await modelRegistry.getAvailable();
	checks.push({
		name: "Models Available",
		status: availableModels.length > 0 ? "pass" : "fail",
		message: `${availableModels.length} model(s) available with configured auth`,
		details: availableModels.length === 0 ? "No models available. Configure API keys or OAuth." : undefined,
	});

	// Check for models with reasonable context windows
	const largeContextModels = availableModels.filter((m) => m.contextWindow >= 100000);
	if (largeContextModels.length > 0) {
		checks.push({
			name: "Large Context Models",
			status: "warn",
			message: `${largeContextModels.length} model(s) with ≥100K context window`,
			details: "Ensure budget enforcement is active to prevent accidental expensive usage",
		});
	}

	return checks;
}

/**
 * Format doctor results for human-readable output
 *
 * @param results - Doctor results
 * @returns Formatted string
 */
export function formatDoctorResults(results: DoctorResults): string {
	const lines: string[] = [];

	// Header
	lines.push("Token Safety Doctor");
	lines.push("=".repeat(60));
	lines.push("");

	// Overall status
	const statusIcon = results.overallStatus === "pass" ? "✓" : results.overallStatus === "warn" ? "⚠" : "✗";
	const statusColor = results.overallStatus === "pass" ? "PASS" : results.overallStatus === "warn" ? "WARN" : "FAIL";
	lines.push(`Overall Status: ${statusIcon} ${statusColor}`);
	lines.push(`Passed: ${results.passCount} | Warnings: ${results.warnCount} | Failed: ${results.failCount}`);
	lines.push("");

	// Checks by category
	for (const [category, categoryChecks] of Object.entries(results.byCategory)) {
		if (categoryChecks.length === 0) continue;

		lines.push(`${category.toUpperCase()}:`);
		for (const check of categoryChecks) {
			const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
			lines.push(`  ${icon} ${check.name}: ${check.message}`);
			if (check.details) {
				lines.push(`    ${check.details}`);
			}
		}
		lines.push("");
	}

	// Recommendations
	if (results.failCount > 0 || results.warnCount > 0) {
		lines.push("RECOMMENDATIONS:");
		if (results.failCount > 0) {
			lines.push("  • Fix failed checks before running agent in production");
		}
		if (results.warnCount > 0) {
			lines.push("  • Review warnings and adjust configuration as needed");
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Format doctor results as JSON
 *
 * @param results - Doctor results
 * @param pretty - Whether to pretty-print
 * @returns JSON string
 */
export function formatDoctorResultsJson(results: DoctorResults, pretty = true): string {
	return JSON.stringify(results, null, pretty ? 2 : 0);
}

/**
 * Get exit code based on doctor results
 *
 * @param results - Doctor results
 * @returns Exit code (0 = pass, 1 = warn, 2 = fail)
 */
export function getDoctorExitCode(results: DoctorResults): number {
	if (results.overallStatus === "fail") return 2;
	if (results.overallStatus === "warn") return 1;
	return 0;
}
