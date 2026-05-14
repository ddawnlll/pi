/**
 * Validation Planner - P5.5.F
 *
 * Determines what validation commands to run after a workspace is executed,
 * based on the changed files and the workspace's configuration.
 *
 * Decision tree:
 * 1. If the workspace has a targetCommand, use that (full validation)
 * 2. If the workspace is high risk, use full validation
 * 3. If changed files are available, try targeted validation
 * 4. Fall back to full validation
 *
 * Watch-mode commands are always detected and reported so callers can
 * reject them or rewrite them to their non-watch equivalent.
 *
 * Heavy validation commands are expected to be wrapped in the global
 * validation lock (see validation-lock.ts) to prevent concurrent
 * validation runs across parallel workspaces.
 */

import { isWatchModeCommand, rewriteToNonWatch } from "../core/watch-mode-guard.js";
import type { Workspace } from "../core/workspace-schema.js";
import { analyzeTestImpact, type TestImpactResult } from "./test-impact-analyzer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A file change detected during workspace execution.
 */
export interface ChangedFile {
	/** Path relative to workspace root */
	path: string;
	/** Type of change */
	status: "added" | "modified" | "deleted";
}

/**
 * The chosen validation scope.
 */
export type ValidationScope = "none" | "targeted" | "full";

/**
 * A planned validation command.
 */
export interface ValidationCommand {
	/** The shell command to run */
	command: string;
	/** Whether this command should go through the validation lock */
	useValidationLock: boolean;
}

/**
 * Result of planning validation for a workspace.
 */
export interface ValidationPlan {
	/** The commands to run (empty if none needed) */
	commands: ValidationCommand[];
	/** The scope of validation chosen */
	scope: ValidationScope;
	/** Human-readable reason for this plan */
	reason: string;
	/** Whether a watch-mode command was detected (and thus rejected) */
	watchModeRejected: boolean;
	/** If watch mode was detected, the suggested non-watch alternative */
	watchModeAlternative: string | null;
	/** Whether the plan was derived from a targetCommand on the workspace */
	fromTargetCommand: boolean;
}

/**
 * Options for the validation planner.
 */
export interface ValidationPlannerOptions {
	/** The workspace definition */
	workspace: Workspace;
	/** Files changed by the workspace execution */
	changedFiles: ChangedFile[];
	/** Default fallback validation command when nothing else is specified */
	defaultValidationCommand?: string;
	/** Whether to attempt targeted validation (default: true) */
	preferTargeted?: boolean;
	/**
	 * Whether to use the test impact analyzer for smarter targeted
	 * command derivation (default: false for now, opt-in).
	 *
	 * When enabled, the analyzer maps changed files to repo areas and
	 * derives area-specific test and build commands. Low-confidence
	 * mappings trigger broader validation.
	 *
	 * @experimental This is v1 of test impact analysis.
	 */
	useTestImpactAnalyzer?: boolean;
	/**
	 * When useTestImpactAnalyzer is true and the analyzer produces a
	 * result, that result is returned here for callers to log/inspect.
	 *
	 * Populated as a side-effect of planValidation when the analyzer
	 * is used, unless already provided.
	 */
	testImpactResult?: TestImpactResult;
}

// ---------------------------------------------------------------------------
// Watch-mode guard
// ---------------------------------------------------------------------------

/**
 * Check a command for watch-mode usage.
 *
 * @param command - The shell command to check
 * @returns Watch-mode detection result
 */
function detectWatchMode(command: string): { isWatchMode: boolean; alternative: string | null } {
	const trimmed = command.trimStart();
	const watchMode = isWatchModeCommand(trimmed);
	const alternative = watchMode ? rewriteToNonWatch(trimmed) : null;
	return { isWatchMode: watchMode, alternative };
}

// ---------------------------------------------------------------------------
// Targeted command derivation
// ---------------------------------------------------------------------------

/**
 * Patterns for test file identification.
 */
const TEST_FILE_PATTERNS = [/\.test\.(ts|tsx|js|jsx)$/, /\.spec\.(ts|tsx|js|jsx)$/, /\/__tests__\//];

/**
 * Source file extensions that could have matching test files.
 */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Check if a file path points to a test file.
 */
function isTestFilePath(filePath: string): boolean {
	return TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Derive targeted validation commands from a list of changed files.
 *
 * Strategy:
 * - If test files were changed, run those specific tests
 * - If source files were changed, attempt to derive matching test commands
 * - Otherwise return empty (no targeted commands possible)
 *
 * When useTestImpactAnalyzer is true, uses the test impact analyzer
 * for smarter area-aware command derivation.
 *
 * @param changedFiles - Files that were changed
 * @param useAnalyzer - Whether to use the test impact analyzer
 * @returns Targeted validation commands (may be empty if none can be derived)
 */
function deriveTargetedCommands(changedFiles: ChangedFile[], useAnalyzer: boolean = false): string[] {
	if (useAnalyzer) {
		const paths = changedFiles.map((f) => f.path);
		const result = analyzeTestImpact(paths);
		if (result.useBroaderValidation) {
			// Analyzer says broader validation needed — return empty to
			// let the planner fall through to full validation
			return [];
		}
		return [...result.testCommands, ...result.buildCommands];
	}
	const commands: string[] = [];

	// Group changed files by type
	const testFiles = changedFiles.filter((f) => isTestFilePath(f.path));
	const sourceFiles = changedFiles.filter(
		(f) => !isTestFilePath(f.path) && f.status !== "deleted" && SOURCE_EXTENSIONS.some((ext) => f.path.endsWith(ext)),
	);

	// 1. Run specific test file commands for changed test files (skip deleted ones)
	const nonDeletedTestFiles = testFiles.filter((f) => f.status !== "deleted");
	for (const tf of nonDeletedTestFiles) {
		commands.push(`vitest --run ${tf.path}`);
	}

	// 2. For changed source files, try to derive matching test commands
	for (const sf of sourceFiles) {
		// Strip the source extension to try common test file patterns
		const basePath = SOURCE_EXTENSIONS.reduce(
			(path, ext) => (path.endsWith(ext) ? path.slice(0, -ext.length) : path),
			sf.path,
		);
		commands.push(`vitest --run ${basePath}.test.ts`);
	}

	// Deduplicate
	return [...new Set(commands)];
}

// ---------------------------------------------------------------------------
// Command construction helpers
// ---------------------------------------------------------------------------

/**
 * Build a validation command entry.
 *
 * @param command - The shell command
 * @param useLock - Whether to use validation lock
 * @returns Validation command entry
 */
function cmd(command: string, useLock: boolean = true): ValidationCommand {
	return { command, useValidationLock: useLock };
}

/**
 * Default validation command used when no better option exists.
 */
const DEFAULT_FULL_VALIDATION = "npm test && npm run typecheck";

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Plan validation for a workspace given its changed files and configuration.
 *
 * Decision tree:
 * 1. **targetCommand** — if the workspace has a targetCommand, use that.
 *    Watch-mode detection is performed. The caller is responsible for
 *    rejecting or rewriting watch-mode commands.
 * 2. **High risk** — if the workspace risk level is "high", use full
 *    validation regardless of changed files.
 * 3. **Targeted** — if changed files are available and targeted validation
 *    is preferred, derive targeted test commands from the changed files.
 * 4. **Fallback** — full validation with the default command.
 *
 * All validation commands (targeted or full) are expected to be wrapped
 * in the global validation lock to prevent concurrent runs across parallel
 * workspaces. The `useValidationLock` flag on each command indicates this.
 *
 * @param options - Planning options
 * @returns A validation plan
 */
export function planValidation(options: ValidationPlannerOptions): ValidationPlan {
	const { workspace, changedFiles, defaultValidationCommand, preferTargeted } = options;
	const preferTargetedValidation = preferTargeted ?? true;

	// -----------------------------------------------------------------------
	// 1. targetCommand defined on workspace
	// -----------------------------------------------------------------------
	if (workspace.targetCommand) {
		const { isWatchMode, alternative } = detectWatchMode(workspace.targetCommand);

		return {
			commands: [cmd(workspace.targetCommand)],
			scope: "full",
			reason: isWatchMode
				? `targetCommand "${workspace.targetCommand}" is a watch-mode command and was rejected`
				: `targetCommand defined on workspace: ${workspace.targetCommand}`,
			watchModeRejected: isWatchMode,
			watchModeAlternative: alternative,
			fromTargetCommand: true,
		};
	}

	// -----------------------------------------------------------------------
	// 2. High-risk workspace — full validation
	// -----------------------------------------------------------------------
	if (workspace.riskLevel === "high") {
		const validationCmd = defaultValidationCommand ?? DEFAULT_FULL_VALIDATION;
		return {
			commands: [cmd(validationCmd)],
			scope: "full",
			reason: "high risk workspace requires full validation",
			watchModeRejected: false,
			watchModeAlternative: null,
			fromTargetCommand: false,
		};
	}

	// -----------------------------------------------------------------------
	// 3. Targeted validation based on changed files
	// -----------------------------------------------------------------------
	if (preferTargetedValidation && changedFiles.length > 0) {
		const targetedCommands = deriveTargetedCommands(
			changedFiles,
			preferTargetedValidation && !!options.useTestImpactAnalyzer,
		);
		if (targetedCommands.length > 0) {
			return {
				commands: targetedCommands.map((c) => cmd(c)),
				scope: "targeted",
				reason: `targeted validation based on ${changedFiles.length} changed file(s): ${changedFiles.map((f) => f.path).join(", ")}`,
				watchModeRejected: false,
				watchModeAlternative: null,
				fromTargetCommand: false,
			};
		}
	}

	// -----------------------------------------------------------------------
	// 4. Fallback — full validation
	// -----------------------------------------------------------------------
	const validationCmd = defaultValidationCommand ?? DEFAULT_FULL_VALIDATION;
	return {
		commands: [cmd(validationCmd)],
		scope: "full",
		reason: "fallback to full validation (no targetCommand, not high risk, no targeted commands derived)",
		watchModeRejected: false,
		watchModeAlternative: null,
		fromTargetCommand: false,
	};
}

/**
 * Check whether a validation plan contains any watch-mode commands.
 *
 * Convenience wrapper around isWatchModeCommand for plan validation.
 *
 * @param plan - The validation plan to check
 * @returns True if any command in the plan is a watch-mode command
 */
export function planContainsWatchMode(plan: ValidationPlan): boolean {
	return plan.watchModeRejected || plan.commands.some((vc) => isWatchModeCommand(vc.command));
}

/**
 * Reject a plan if it contains watch-mode commands.
 *
 * Returns a new plan with an empty command list and watchModeRejected set
 * if the original plan had watch-mode commands. Otherwise returns the
 * original plan unchanged.
 *
 * @param plan - The validation plan to check
 * @returns The original plan, or a rejected version
 */
export function rejectWatchMode(plan: ValidationPlan): ValidationPlan {
	if (!planContainsWatchMode(plan)) {
		return plan;
	}

	const alternative = plan.watchModeAlternative;
	return {
		commands: [],
		scope: "none",
		reason: alternative
			? `watch-mode command rejected; suggested alternative: ${alternative}`
			: "watch-mode command rejected; no alternative available",
		watchModeRejected: true,
		watchModeAlternative: alternative,
		fromTargetCommand: plan.fromTargetCommand,
	};
}
