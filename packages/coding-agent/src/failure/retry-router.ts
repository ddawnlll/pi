/**
 * Retry Router - P2 Workstream 6.H
 *
 * Routes retry strategies based on failure category.
 *
 * Key behaviors:
 * - Merge conflicts are never retried as ordinary coding failures;
 *   they require manual resolution or special merge-resolution retry.
 * - Network/timeout failures are auto-retried with backoff.
 * - Test/lint/type failures retry with code-quality focus.
 * - Permission failures halt execution immediately.
 * - Review failures route to human re-review.
 */

import { FailureCategory } from "./failure-classifier.js";

/**
 * Retry strategy type.
 */
export type RetryStrategyType =
	/** Retry immediately with same context */
	| "immediate"
	/** Retry with exponential backoff */
	| "backoff"
	/** Escalate to a different approach (reviewer, flash) */
	| "escalate"
	/** Halt execution, do not retry */
	| "halt"
	/** Route to merge-conflict resolution flow */
	| "merge_resolution";

/**
 * Retry strategy for a given failure category.
 */
export interface RetryStrategy {
	/** Strategy type */
	type: RetryStrategyType;
	/** Maximum number of retry attempts */
	maxRetries: number;
	/** Base delay between retries in milliseconds (for backoff) */
	baseDelayMs: number;
	/** Whether the system can auto-retry without user intervention */
	canAutoRetry: boolean;
	/** Whether human review is required before next retry */
	requiresHumanReview: boolean;
	/** Instruction/guidance for the retry agent */
	agentGuidance: string;
	/** Whether to include full previous attempt context or just error summary */
	includeFullContext: boolean;
}

/**
 * Gets the retry strategy for a given failure category.
 *
 * @param category - The classified failure category
 * @returns The retry strategy to use
 */
export function getRetryStrategy(category: FailureCategory): RetryStrategy {
	switch (category) {
		case FailureCategory.Test:
			return {
				type: "escalate",
				maxRetries: 3,
				baseDelayMs: 0,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Test assertions failed. Analyze the test output and error details. " +
					"Fix the code to match expected behavior or update tests if the behavior change is intentional. " +
					"Run the failing tests after making changes to verify the fix.",
				includeFullContext: true,
			};

		case FailureCategory.Lint:
			return {
				type: "immediate",
				maxRetries: 3,
				baseDelayMs: 0,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Linting errors detected. Apply automatic formatting fixes where possible, " +
					"then fix remaining style violations. Run the linter after changes to verify.",
				includeFullContext: false,
			};

		case FailureCategory.Type:
			return {
				type: "immediate",
				maxRetries: 3,
				baseDelayMs: 0,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Type errors detected. Fix type annotations, imports, or type assertions. " +
					"Run the type checker after changes to verify.",
				includeFullContext: true,
			};

		case FailureCategory.Build:
			return {
				type: "escalate",
				maxRetries: 3,
				baseDelayMs: 0,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Build failed. Check compilation errors and fix syntax or configuration issues. " +
					"Ensure all imports and dependencies are correctly specified. " +
					"Rebuild after making changes to verify.",
				includeFullContext: true,
			};

		case FailureCategory.Runtime:
			return {
				type: "escalate",
				maxRetries: 2,
				baseDelayMs: 500,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Runtime error occurred. Examine the stack trace and error details. " +
					"Check for null/undefined values, incorrect types, or environment issues. " +
					"Add defensive checks and error handling as needed.",
				includeFullContext: true,
			};

		case FailureCategory.MergeConflict:
			return {
				type: "merge_resolution",
				maxRetries: 0,
				baseDelayMs: 0,
				canAutoRetry: false,
				requiresHumanReview: true,
				agentGuidance:
					"MERGE CONFLICT DETECTED. This is NOT a standard coding failure. " +
					"Do NOT retry as an ordinary coding task. " +
					"Conflicting changes require manual resolution. " +
					"Use a merge-resolution flow to identify conflicting sections, " +
					"understand both versions, and produce a correct merged result. " +
					"After resolution, verify the merged code compiles and tests pass.",
				includeFullContext: true,
			};

		case FailureCategory.Network:
			return {
				type: "backoff",
				maxRetries: 3,
				baseDelayMs: 2000,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Network error occurred. This is likely transient. " +
					"Retry with exponential backoff. If persistent, verify network connectivity " +
					"and API endpoint availability.",
				includeFullContext: false,
			};

		case FailureCategory.Timeout:
			return {
				type: "backoff",
				maxRetries: 2,
				baseDelayMs: 5000,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Operation timed out. Consider whether the operation needs more time " +
					"or can be broken into smaller steps. Retry with longer timeout if available.",
				includeFullContext: false,
			};

		case FailureCategory.Permission:
			return {
				type: "halt",
				maxRetries: 0,
				baseDelayMs: 0,
				canAutoRetry: false,
				requiresHumanReview: true,
				agentGuidance:
					"Permission denied. This requires human intervention to grant access " +
					"rights or correct file permissions. Cannot proceed automatically.",
				includeFullContext: false,
			};

		case FailureCategory.Review:
			return {
				type: "escalate",
				maxRetries: 3,
				baseDelayMs: 0,
				canAutoRetry: true,
				requiresHumanReview: true,
				agentGuidance:
					"Review feedback received. Address the specific concerns raised in the review. " +
					"Make targeted changes to satisfy reviewer requirements.",
				includeFullContext: true,
			};

		case FailureCategory.Unknown:
			return {
				type: "escalate",
				maxRetries: 2,
				baseDelayMs: 1000,
				canAutoRetry: true,
				requiresHumanReview: false,
				agentGuidance:
					"Unknown failure type. Analyze the error output carefully. " +
					"Apply conservative fixes and verify. " +
					"If the failure persists, gather more context for better diagnosis.",
				includeFullContext: true,
			};
	}
}

/**
 * Get a merged strategy for a workspace retry attempt.
 *
 * Combines the category-based strategy with the attempt number
 * to determine escalation behavior.
 *
 * @param category - The failure category
 * @param attemptNumber - The current attempt number (1-based)
 * @returns The effective retry strategy for this attempt
 */
export function getMergedRetryStrategy(category: FailureCategory, attemptNumber: number): RetryStrategy {
	const baseStrategy = getRetryStrategy(category);

	// If max retries exceeded, halt
	if (attemptNumber > baseStrategy.maxRetries) {
		return {
			...baseStrategy,
			type: "halt",
			canAutoRetry: false,
			requiresHumanReview: true,
			agentGuidance: `Exhausted ${baseStrategy.maxRetries} retries for ${category}. Manual intervention required.`,
		};
	}

	// Escalate strategy as attempts increase
	if (baseStrategy.type === "backoff" && attemptNumber > 2) {
		return {
			...baseStrategy,
			agentGuidance:
				baseStrategy.agentGuidance +
				" Multiple retries failed — consider alternative approaches or check for underlying issues.",
			includeFullContext: true,
		};
	}

	return baseStrategy;
}

/**
 * Human-readable heading for a retry strategy.
 *
 * @param strategy - The retry strategy
 * @returns A short heading describing the strategy
 */
export function getRetryStrategyHeading(strategy: RetryStrategy): string {
	switch (strategy.type) {
		case "immediate":
			return "Retrying immediately with fix guidance";
		case "backoff":
			return `Retrying with backoff (${strategy.baseDelayMs}ms base delay)`;
		case "escalate":
			return "Escalating with deeper analysis";
		case "halt":
			return "Retries exhausted — halting execution";
		case "merge_resolution":
			return "Resolving merge conflict — not a standard retry";
	}
}

/**
 * Check if a failure category should bypass normal retry logic.
 *
 * @param category - The failure category
 * @returns True if normal retry should be bypassed
 */
export function shouldBypassNormalRetry(category: FailureCategory): boolean {
	return (
		category === FailureCategory.MergeConflict ||
		category === FailureCategory.Permission ||
		category === FailureCategory.Unknown
	);
}

/**
 * Format retry strategy for dashboard/log display.
 *
 * @param category - The failure category
 * @param strategy - The retry strategy
 * @param attemptNumber - Current attempt number
 * @returns Formatted display string
 */
export function formatRetryStrategy(category: FailureCategory, strategy: RetryStrategy, attemptNumber: number): string {
	const heading = getRetryStrategyHeading(strategy);
	const lines: string[] = [
		`[Retry] Category: ${category}`,
		`[Retry] Attempt: ${attemptNumber}/${strategy.maxRetries}`,
		`[Retry] Strategy type: ${strategy.type}`,
		`[Retry] Strategy: ${heading}`,
		`[Retry] Auto-retry: ${strategy.canAutoRetry ? "yes" : "no"}`,
		`[Retry] Human review: ${strategy.requiresHumanReview ? "required" : "not required"}`,
	];

	return lines.join("\n");
}
