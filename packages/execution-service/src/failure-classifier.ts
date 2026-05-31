/**
 * Failure Classifier - P2 Workstream 6.H
 *
 * Classifies workspace execution failures into known categories.
 * Each category drives different retry and escalation behavior.
 *
 * Key categories:
 * - Merge conflicts: detected via git conflict markers, never retried as
 *   ordinary coding failures
 * - Test/lint/type: code quality failures, retriable with same strategy
 * - Build: compilation failures, retriable with build-specific context
 * - Runtime: execution errors, may require deeper analysis
 * - Network/timeout: transient infrastructure failures, automatically retriable
 * - Permission: access control failures, require human intervention
 * - Review: human review rejection, requires rework
 * - Unknown: fallback, conservative retry
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * Known failure categories for workspace execution.
 */
export enum FailureCategory {
	/** Test assertion failure */
	Test = "test",
	/** Linting error */
	Lint = "lint",
	/** TypeScript type check failure */
	Type = "type",
	/** Build/compilation failure */
	Build = "build",
	/** Runtime exception */
	Runtime = "runtime",
	/** Git merge conflict markers detected */
	MergeConflict = "merge_conflict",
	/** Network connectivity or API failure */
	Network = "network",
	/** Operation timed out */
	Timeout = "timeout",
	/** File permission or access control error */
	Permission = "permission",
	/** Human review rejection */
	Review = "review",
	/** Uncategorized failure */
	Unknown = "unknown",
}

/**
 * Result of a failure classification.
 */
export interface FailureClassification {
	/** The classified failure category */
	category: FailureCategory;
	/** Confidence level 0-1 (1 = high certainty) */
	confidence: number;
	/** Additional details about the failure (optional) */
	details?: string;
	/** Whether this failure is potentially recoverable via retry */
	recoverable: boolean;
}

/**
 * Context provided for failure classification.
 */
export interface FailureContext {
	/** The error message or log output */
	error: string;
	/** Title of the workspace that failed */
	workspaceTitle?: string;
	/** The command that was being executed */
	attemptedCommand?: string;
	/** Files that were created or modified during the failed attempt */
	outputFiles?: string[];
}

/**
 * Pattern-based classification rule.
 */
interface ClassificationRule {
	/** Priority (lower = checked first) */
	priority: number;
	/** Human-readable label */
	label: string;
	/** Category to classify as */
	category: FailureCategory;
	/** Patterns to match against the error message */
	patterns: RegExp[];
	/** Whether this category is recoverable */
	recoverable: boolean;
}

/**
 * Default classification rules, ordered by priority.
 *
 * More specific patterns come first to avoid false positives.
 * The last rule (Unknown) catches everything.
 */
const DEFAULT_RULES: ClassificationRule[] = [
	// Merge conflict markers (highest priority - very specific)
	{
		priority: 1,
		label: "merge-conflict-markers",
		category: FailureCategory.MergeConflict,
		patterns: [
			/<<<<<<< /,
			/=======\n[\s\S]*?>>>>>>> /,
			/merge conflict/i,
			/conflict markers? found/i,
			/automatic merge failed/i,
			/merge (failed|error|conflict)/i,
			/not something we can merge/i,
			/conflict.*needs resolution/i,
		],
		recoverable: false,
	},
	// Test failures
	{
		priority: 2,
		label: "test-failure",
		category: FailureCategory.Test,
		patterns: [
			/FAIL\s+test/i,
			/test.*failed/i,
			/assertionError/i,
			/expect\(.*\)\.(toEqual|toBe|toMatch|toContain|toThrow)/i,
			/not ok \d+.*failed/i,
			/\d+ tests? (failed|failing)/i,
			/testsuite:? .* (failed|failure)/i,
			/failed.*test/i,
			/spec.*failed/i,
		],
		recoverable: true,
	},
	// Lint failures
	{
		priority: 3,
		label: "lint-failure",
		category: FailureCategory.Lint,
		patterns: [
			/lint(ing)? (error|failure|failed)/i,
			/eslint/i,
			/biome/i,
			/prettier/i,
			/stylelint/i,
			/\d+ lint(ing)? error/i,
			/lint check failed/i,
			/code style violation/i,
		],
		recoverable: true,
	},
	// Type check failures
	{
		priority: 4,
		label: "type-failure",
		category: FailureCategory.Type,
		patterns: [
			/TypeScript error TS\d+/i,
			/type.*not assignable/i,
			/type.*cannot be used/i,
			/is not assignable to type/i,
			/property.*does not exist on type/i,
			/tsc\b.*failed/i,
			/type check.*failed/i,
			/compilation error.*type/i,
			/error TS\d+/i,
			/cannot find (name|module)/i,
		],
		recoverable: true,
	},
	// Network failures
	{
		priority: 5,
		label: "network-failure",
		category: FailureCategory.Network,
		patterns: [
			/network (error|failure|timeout|unreachable)/i,
			/ECONNREFUSED/i,
			/ECONNRESET/i,
			/ETIMEDOUT/i,
			/ENOTFOUND/i,
			/socket (hang up|error|closed)/i,
			/request failed/i,
			/API request.*(fail|error|timeout)/i,
			/connection (refused|reset|closed|failed)/i,
			/fetch failed/i,
			/getaddrinfo/i,
			/fetch.*ENOTFOUND/i,
		],
		recoverable: true,
	},
	// Timeout failures
	{
		priority: 6,
		label: "timeout-failure",
		category: FailureCategory.Timeout,
		patterns: [/timeout/i, /timed out/i, /operation.*(timed out|timeout)/i, /exceeded.*(deadline|timeout|limit)/i],
		recoverable: true,
	},
	// Build failures
	{
		priority: 7,
		label: "build-failure",
		category: FailureCategory.Build,
		patterns: [
			/build (failed|error|failure)/i,
			/compil(ation|e) error/i,
			/compil(ation|e) failed/i,
			/exit code \d+.*build/i,
			/module build failed/i,
			/webpack.*failed/i,
			/rollup.*error/i,
			/vite.*build.*error/i,
			/tsc.*error/i,
			/cannot compile/i,
		],
		recoverable: true,
	},
	// Runtime failures
	{
		priority: 8,
		label: "runtime-failure",
		category: FailureCategory.Runtime,
		patterns: [
			/uncaught (exception|error)/i,
			/runtime (error|exception|failure)/i,
			/TypeError:/i,
			/ReferenceError:/i,
			/RangeError:/i,
			/SyntaxError:/i,
			/cannot read property/i,
			/cannot read properties/i,
			/is not defined/i,
			/undefined is not/i,
			/null pointer/i,
			/segmentation fault/i,
			/abort trap/i,
		],
		recoverable: true,
	},
	// Permission failures
	{
		priority: 9,
		label: "permission-failure",
		category: FailureCategory.Permission,
		patterns: [
			/permission denied/i,
			/EACCES/i,
			/EPERM/i,
			/not (allowed|authorized|permitted)/i,
			/access (denied|forbidden)/i,
			/unauthorized/i,
			/forbidden/i,
			/EACCESS/i,
		],
		recoverable: false,
	},
	// Review failures
	{
		priority: 10,
		label: "review-failure",
		category: FailureCategory.Review,
		patterns: [
			/review (rejected|failed|denied)/i,
			/needs revision/i,
			/code review/i,
			/approval (denied|rejected)/i,
			/changes requested/i,
			/rework needed/i,
			/rejected.*review/i,
		],
		recoverable: true,
	},
	// Unknown (catch-all, lowest priority)
	{
		priority: 99,
		label: "unknown",
		category: FailureCategory.Unknown,
		patterns: [/.*/],
		recoverable: true,
	},
];

/**
 * Classifies workspace execution failures into known categories.
 *
 * Uses pattern matching on error messages and optionally inspects
 * output files for merge conflict markers.
 */
export class FailureClassifier {
	private rules: ClassificationRule[];

	constructor(rules?: ClassificationRule[]) {
		this.rules = rules ?? DEFAULT_RULES;
		// Sort by priority ascending
		this.rules.sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Classify a failure from context.
	 *
	 * @param context - The failure context (error message, workspace info, etc.)
	 * @returns The classified failure result
	 */
	classify(context: FailureContext): FailureClassification {
		const { error } = context;

		// Try each rule in priority order, return first match
		for (const rule of this.rules) {
			for (const pattern of rule.patterns) {
				if (pattern.test(error)) {
					let details: string | undefined;

					// For merge conflicts, also check output files
					if (
						rule.category === FailureCategory.MergeConflict &&
						context.outputFiles &&
						context.outputFiles.length > 0
					) {
						const conflictFiles = this.findConflictFiles(context.outputFiles);
						if (conflictFiles.length > 0) {
							details = `Merge conflicts in: ${conflictFiles.join(", ")}`;
						} else {
							// Pattern matched error but no file-level conflicts
							// Could be a different kind of merge issue
							details = "Merge operation reported conflicts";
						}
					}

					return {
						category: rule.category,
						confidence: this.calculateConfidence(pattern, error),
						details,
						recoverable: rule.recoverable,
					};
				}
			}
		}

		// Should never reach here due to catch-all rule
		return {
			category: FailureCategory.Unknown,
			confidence: 0.3,
			recoverable: true,
		};
	}

	/**
	 * Shortcut: classify from an error string alone.
	 *
	 * @param error - Error message
	 * @returns The classified failure result
	 */
	classifyError(error: string): FailureClassification {
		return this.classify({ error });
	}

	/**
	 * Get a human-readable description of a failure category.
	 *
	 * @param category - The failure category
	 * @returns Human-readable description
	 */
	getCategoryDescription(category: FailureCategory): string {
		switch (category) {
			case FailureCategory.Test:
				return "Test assertion failure — one or more tests did not pass";
			case FailureCategory.Lint:
				return "Linting error — code style or formatting violations";
			case FailureCategory.Type:
				return "Type check failure — type system violations detected";
			case FailureCategory.Build:
				return "Build failure — compilation or bundling error";
			case FailureCategory.Runtime:
				return "Runtime error — exception occurred during execution";
			case FailureCategory.MergeConflict:
				return "Git merge conflict — conflicting changes detected that require manual resolution";
			case FailureCategory.Network:
				return "Network error — connectivity issue or API request failure";
			case FailureCategory.Timeout:
				return "Operation timed out — execution exceeded allowed time";
			case FailureCategory.Permission:
				return "Permission denied — insufficient access rights";
			case FailureCategory.Review:
				return "Review rejection — human review requested changes";
			case FailureCategory.Unknown:
				return "Unknown failure — could not determine the cause";
		}
	}

	/**
	 * Format a failure classification for dashboard/log display.
	 *
	 * @param classification - The classification result
	 * @param workspaceId - Optional workspace identifier
	 * @returns Formatted string for display
	 */
	formatForDisplay(classification: FailureClassification, workspaceId?: string): string {
		const prefix = workspaceId ? `[${workspaceId}] ` : "";
		const confidenceStr = Math.round(classification.confidence * 100);
		const recoverableStr = classification.recoverable ? "recoverable" : "non-recoverable";

		let display = `${prefix}Failure: ${classification.category} (confidence: ${confidenceStr}%, ${recoverableStr})`;
		display += `\n${prefix}  Description: ${this.getCategoryDescription(classification.category)}`;

		if (classification.details) {
			display += `\n${prefix}  Details: ${classification.details}`;
		}

		return display;
	}

	/**
	 * Check output files for merge conflict markers.
	 */
	private findConflictFiles(files: string[]): string[] {
		const conflictFiles: string[] = [];

		for (const filePath of files) {
			try {
				if (existsSync(filePath)) {
					const content = readFileSync(filePath, "utf-8");
					if (/<<<<<<< /.test(content) && /=======/.test(content) && />>>>>>> /.test(content)) {
						conflictFiles.push(filePath);
					}
				}
			} catch {
				// Skip files we can't read
			}
		}

		return conflictFiles;
	}

	/**
	 * Calculate confidence for a pattern match.
	 *
	 * More specific/longer patterns give higher confidence.
	 * Generic catch-all gives low confidence.
	 */
	private calculateConfidence(pattern: RegExp, _error: string): number {
		const source = pattern.source;

		// Catch-all patterns
		if (source === ".*") {
			return 0.3;
		}

		// Merge conflict markers are very specific
		if (source.includes("<<<<<<<") || source.includes("merge conflict")) {
			return 0.95;
		}

		// Longer patterns tend to be more specific
		if (source.length > 40) {
			return 0.9;
		}

		// Short but targeted patterns
		if (source.length > 15) {
			return 0.8;
		}

		return 0.7;
	}
}

/**
 * Create a failure classifier with default rules.
 */
export function createFailureClassifier(): FailureClassifier {
	return new FailureClassifier();
}
