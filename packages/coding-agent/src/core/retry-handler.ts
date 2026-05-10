/**
 * Retry Handler - P2 Workstream 7.G
 *
 * Manages workspace retry logic with escalation strategy:
 * - Attempts 1-3: Normal worker retry
 * - Attempts 4-6: Flash-assisted retry (quick fixes)
 * - Attempts 7-9: Reviewer-guided retry (deeper analysis)
 * - Attempt 10: Final fail
 *
 * Retry limits:
 * - Test/lint/type failures: max 10 retries
 * - Review fixes: max 3 retries
 */

import type { WorkspaceState } from "./plan-state.js";
import type { Workspace } from "./workspace-schema.js";

/**
 * Retry escalation stage
 */
export enum RetryStage {
	/** Normal worker retry (attempts 1-3) */
	Worker = "worker",
	/** Flash-assisted retry for quick fixes (attempts 4-6) */
	Flash = "flash",
	/** Reviewer-guided retry for deeper analysis (attempts 7-9) */
	Reviewer = "reviewer",
	/** Final attempt before failure (attempt 10) */
	Final = "final",
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
	/** Maximum retry attempts for test/lint/type failures */
	maxTestRetries: number;
	/** Maximum retry attempts for review fixes */
	maxReviewRetries: number;
	/** Attempt thresholds for escalation stages */
	escalationThresholds: {
		flash: number; // Start flash-assisted at this attempt
		reviewer: number; // Start reviewer-guided at this attempt
		final: number; // Final attempt
	};
}

/**
 * Retry decision
 */
export interface RetryDecision {
	/** Whether to retry */
	shouldRetry: boolean;
	/** Current retry stage */
	stage: RetryStage;
	/** Reason for decision */
	reason: string;
	/** Next attempt number (if retrying) */
	nextAttempt?: number;
}

/**
 * Failure type classification
 */
export enum FailureType {
	/** Test failure */
	Test = "test",
	/** Lint failure */
	Lint = "lint",
	/** Type check failure */
	Type = "type",
	/** Review rejection */
	Review = "review",
	/** Build failure */
	Build = "build",
	/** Runtime error */
	Runtime = "runtime",
	/** Unknown failure */
	Unknown = "unknown",
}

/**
 * Default retry policy
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxTestRetries: 10,
	maxReviewRetries: 3,
	escalationThresholds: {
		flash: 4, // Attempts 4-6
		reviewer: 7, // Attempts 7-9
		final: 10, // Attempt 10
	},
};

/**
 * Retry handler
 *
 * Manages retry logic with escalation strategy based on attempt count.
 */
export class RetryHandler {
	private policy: RetryPolicy;

	constructor(policy: RetryPolicy = DEFAULT_RETRY_POLICY) {
		this.policy = policy;
	}

	/**
	 * Determine if workspace should be retried
	 *
	 * @param workspace - Workspace specification
	 * @param state - Current workspace state
	 * @param failureType - Type of failure
	 * @returns Retry decision
	 */
	shouldRetry(workspace: Workspace, state: WorkspaceState, failureType: FailureType): RetryDecision {
		const currentAttempt = state.attempts;
		const nextAttempt = currentAttempt + 1;

		// Check if workspace has custom max retries
		const maxRetries = workspace.maxRetries;

		// Determine max retries based on failure type
		let effectiveMaxRetries = maxRetries;
		if (failureType === FailureType.Review) {
			effectiveMaxRetries = Math.min(maxRetries, this.policy.maxReviewRetries);
		} else if (
			failureType === FailureType.Test ||
			failureType === FailureType.Lint ||
			failureType === FailureType.Type
		) {
			effectiveMaxRetries = Math.min(maxRetries, this.policy.maxTestRetries);
		}

		// Check if we've exhausted retries
		if (currentAttempt >= effectiveMaxRetries) {
			return {
				shouldRetry: false,
				stage: this.getRetryStage(currentAttempt),
				reason: `Exhausted retries (${currentAttempt}/${effectiveMaxRetries})`,
			};
		}

		// Determine retry stage for next attempt
		const stage = this.getRetryStage(nextAttempt);

		return {
			shouldRetry: true,
			stage,
			reason: `Retry with ${stage} strategy (attempt ${nextAttempt}/${effectiveMaxRetries})`,
			nextAttempt,
		};
	}

	/**
	 * Get retry stage based on attempt number
	 *
	 * @param attempt - Attempt number
	 * @returns Retry stage
	 */
	getRetryStage(attempt: number): RetryStage {
		if (attempt >= this.policy.escalationThresholds.final) {
			return RetryStage.Final;
		}
		if (attempt >= this.policy.escalationThresholds.reviewer) {
			return RetryStage.Reviewer;
		}
		if (attempt >= this.policy.escalationThresholds.flash) {
			return RetryStage.Flash;
		}
		return RetryStage.Worker;
	}

	/**
	 * Classify failure type from error message
	 *
	 * @param error - Error message
	 * @returns Failure type
	 */
	classifyFailure(error: string): FailureType {
		const lowerError = error.toLowerCase();

		if (lowerError.includes("test") || lowerError.includes("spec") || lowerError.includes("assertion")) {
			return FailureType.Test;
		}
		if (lowerError.includes("lint") || lowerError.includes("eslint") || lowerError.includes("biome")) {
			return FailureType.Lint;
		}
		if (
			lowerError.includes("type") ||
			lowerError.includes("typescript") ||
			lowerError.includes("ts(") ||
			lowerError.includes("tsc")
		) {
			return FailureType.Type;
		}
		if (lowerError.includes("review") || lowerError.includes("rejected") || lowerError.includes("needs revision")) {
			return FailureType.Review;
		}
		if (lowerError.includes("build") || lowerError.includes("compile")) {
			return FailureType.Build;
		}
		if (lowerError.includes("runtime") || lowerError.includes("exception")) {
			return FailureType.Runtime;
		}

		return FailureType.Unknown;
	}

	/**
	 * Get retry context for packet generation
	 *
	 * Provides context about previous attempts for inclusion in retry packets.
	 *
	 * @param state - Current workspace state
	 * @param error - Error message from previous attempt
	 * @returns Retry context string
	 */
	getRetryContext(state: WorkspaceState, error: string): string {
		const attempt = state.attempts;
		const stage = this.getRetryStage(attempt + 1);
		const failureType = this.classifyFailure(error);

		const lines: string[] = [];
		lines.push(`Previous attempt ${attempt} failed: ${failureType}`);
		lines.push(`Error: ${error.slice(0, 500)}`); // Truncate long errors
		lines.push(`Next retry strategy: ${stage}`);

		if (stage === RetryStage.Flash) {
			lines.push("Focus on quick, targeted fixes to resolve the immediate error.");
		} else if (stage === RetryStage.Reviewer) {
			lines.push("Perform deeper analysis to identify root cause and implement comprehensive fix.");
		} else if (stage === RetryStage.Final) {
			lines.push("FINAL ATTEMPT: This is the last retry before marking workspace as failed.");
		}

		return lines.join("\n");
	}

	/**
	 * Check if workspace should be serialized (no parallelism)
	 *
	 * High-risk or security-sensitive workspaces should not run in parallel.
	 *
	 * @param workspace - Workspace specification
	 * @returns True if workspace should be serialized
	 */
	shouldSerialize(workspace: Workspace): boolean {
		// Check risk level
		if (workspace.riskLevel === "high") {
			return true;
		}

		// Check for security-related keywords in title
		const title = workspace.title.toLowerCase();
		const securityKeywords = ["security", "auth", "credential", "secret", "token", "password", "encryption"];

		for (const keyword of securityKeywords) {
			if (title.includes(keyword)) {
				return true;
			}
		}

		// Check capabilities for sensitive operations
		if (workspace.capabilities) {
			const sensitiveCommands = ["rm -rf", "sudo", "chmod", "chown", "git push", "npm publish"];
			for (const cmd of workspace.capabilities.canRun) {
				for (const sensitive of sensitiveCommands) {
					if (cmd.includes(sensitive)) {
						return true;
					}
				}
			}
		}

		return false;
	}

	/**
	 * Get policy configuration
	 *
	 * @returns Current retry policy
	 */
	getPolicy(): RetryPolicy {
		return { ...this.policy };
	}

	/**
	 * Update policy configuration
	 *
	 * @param policy - New retry policy
	 */
	updatePolicy(policy: Partial<RetryPolicy>): void {
		this.policy = { ...this.policy, ...policy };
	}
}

/**
 * Create a retry handler instance
 *
 * @param policy - Optional retry policy
 * @returns Retry handler
 */
export function createRetryHandler(policy?: RetryPolicy): RetryHandler {
	return new RetryHandler(policy);
}
