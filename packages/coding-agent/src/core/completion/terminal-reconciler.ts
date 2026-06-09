/**
 * P44.04 — Terminal Verdict Reconciler
 *
 * Reconciles terminal verdicts across multiple execution attempts for a
 * workspace and produces a final verdict for attempt finalization.
 *
 * Reconciliation rules:
 * 1. If ANY attempt returned COMPLETE, the overall verdict is COMPLETE
 *    (first successful attempt wins).
 * 2. If all attempts are FAILED or BLOCKED, the overall verdict is
 *    determined by the LAST attempt's verdict.
 * 3. BLOCKED verdicts from early attempts are overridden by later FAILED
 *    verdicts when later attempts provided more information.
 * 4. If no attempts were made (empty history), the verdict is FAILED.
 *
 * Consumed by:
 * - AutonomousExecutor for attempt finalization
 * - PlanState for tracking attempt history
 *
 * Contract Schema: 4.1.5
 */

import type { TerminalVerdict, TerminalVerdictParseResult } from "./terminal-verdict-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Record of a single execution attempt for a workspace.
 */
export interface AttemptRecord {
	/** Attempt number (1-based) */
	attemptNo: number;
	/** The parsed terminal verdict for this attempt */
	verdict: TerminalVerdict;
	/** Confidence level of the parsed verdict */
	confidence: "high" | "medium" | "low";
	/** Human-readable reasoning from the parse */
	reasoning: string;
	/** Optional error message if the attempt failed */
	error?: string;
	/** Optional timestamp when attempt completed */
	completedAt?: number;
}

/**
 * Reconciled result for a workspace across multiple attempts.
 */
export interface ReconciledWorkspaceResult {
	/** The workspace identifier */
	workspaceId: string;
	/** The final reconciled verdict */
	finalVerdict: TerminalVerdict;
	/** Total number of attempts made */
	totalAttempts: number;
	/** The attempt record that determined the final verdict */
	determiningAttempt: AttemptRecord;
	/** All attempt records in chronological order */
	attempts: AttemptRecord[];
	/** Human-readable summary of the reconciliation */
	summary: string;
	/** Whether this is a definitive result (as opposed to inconclusive) */
	isDefinitive: boolean;
}

/**
 * Configuration for the Terminal Verdict Reconciler.
 */
export interface TerminalReconcilerConfig {
	/**
	 * If true, a BLOCKED verdict on the final attempt maps to FAILED
	 * for plan-level finalization (a blocked workspace is still terminal).
	 * Default: true.
	 */
	treatBlockedAsTerminal?: boolean;

	/**
	 * Maximum number of attempts to consider when reconciling.
	 * Attempts beyond this limit are ignored.
	 * Default: 10.
	 */
	maxAttempts?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TerminalReconcilerConfig = {
	treatBlockedAsTerminal: true,
	maxAttempts: 10,
};

// ---------------------------------------------------------------------------
// Reconciler
// ---------------------------------------------------------------------------

/**
 * Terminal Verdict Reconciler class.
 *
 * Reconciles execution results across multiple retry attempts to produce
 * a definitive final verdict for a workspace.
 */
export class TerminalVerdictReconciler {
	private config: TerminalReconcilerConfig;

	constructor(config?: Partial<TerminalReconcilerConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): TerminalReconcilerConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration.
	 */
	updateConfig(config: Partial<TerminalReconcilerConfig>): void {
		Object.assign(this.config, config);
	}

	/**
	 * Reconcile attempt records into a final verdict for a workspace.
	 *
	 * @param workspaceId - Workspace identifier
	 * @param attempts - Chronological list of attempt records
	 * @returns Reconciled result
	 */
	reconcile(workspaceId: string, attempts: AttemptRecord[]): ReconciledWorkspaceResult {
		// Sort by attempt number ascending
		const sorted = [...attempts].sort((a, b) => a.attemptNo - b.attemptNo);

		// Clamp to max attempts
		const limited =
			this.config.maxAttempts && sorted.length > this.config.maxAttempts
				? sorted.slice(-this.config.maxAttempts!)
				: sorted;

		if (limited.length === 0) {
			return {
				workspaceId,
				finalVerdict: "FAILED",
				totalAttempts: 0,
				determiningAttempt: {
					attemptNo: 0,
					verdict: "FAILED",
					confidence: "low",
					reasoning: "No attempts recorded for workspace",
				},
				attempts: [],
				summary: `No attempts recorded for workspace ${workspaceId}`,
				isDefinitive: false,
			};
		}

		// Rule 1: If ANY attempt returned COMPLETE, overall is COMPLETE
		const completeAttempt = limited.find((a) => a.verdict === "COMPLETE");
		if (completeAttempt) {
			return {
				workspaceId,
				finalVerdict: "COMPLETE",
				totalAttempts: limited.length,
				determiningAttempt: completeAttempt,
				attempts: limited,
				summary: `Workspace completed on attempt ${completeAttempt.attemptNo}: ${completeAttempt.reasoning}`,
				isDefinitive: true,
			};
		}

		// Rule 2/3: Use the LAST attempt's verdict
		const lastAttempt = limited[limited.length - 1];
		const lastVerdict = lastAttempt.verdict;

		// If treatBlockedAsTerminal is true, BLOCKED maps to FAILED for terminal purposes
		// but we preserve the original verdict in the result
		const isDefinitive =
			lastVerdict === "FAILED" || (lastVerdict === "BLOCKED" && this.config.treatBlockedAsTerminal);

		// Build summary with retry context
		const attemptSummary = limited
			.map((a) => `Attempt ${a.attemptNo}: ${a.verdict}${a.error ? ` (${a.error})` : ""}`)
			.join(" → ");
		const summary = `Workspace reached terminal state after ${limited.length} attempt(s): ${attemptSummary}. Final verdict: ${lastVerdict}.`;

		return {
			workspaceId,
			finalVerdict: lastVerdict,
			totalAttempts: limited.length,
			determiningAttempt: lastAttempt,
			attempts: limited,
			summary,
			isDefinitive,
		};
	}

	/**
	 * Check if a workspace's execution history should be retried based on
	 * the reconciled result and retry policy.
	 *
	 * @param reconciled - The reconciled workspace result
	 * @param maxRetries - Maximum number of retries allowed
	 * @returns True if the workspace should be retried
	 */
	shouldRetry(reconciled: ReconciledWorkspaceResult, maxRetries: number): boolean {
		if (reconciled.isDefinitive && reconciled.finalVerdict === "COMPLETE") {
			return false;
		}

		if (reconciled.totalAttempts >= maxRetries) {
			return false;
		}

		// Only retry if the last attempt was not COMPLETE
		const lastAttempt = reconciled.attempts[reconciled.attempts.length - 1];
		return lastAttempt?.verdict !== "COMPLETE";
	}

	/**
	 * Build an AttemptRecord from a TerminalVerdictParseResult.
	 *
	 * @param attemptNo - The attempt number
	 * @param parseResult - The parsed verdict result
	 * @param error - Optional error message
	 * @returns An AttemptRecord
	 */
	static buildAttemptRecord(
		attemptNo: number,
		parseResult: TerminalVerdictParseResult,
		error?: string,
	): AttemptRecord {
		return {
			attemptNo,
			verdict: parseResult.verdict,
			confidence: parseResult.confidence,
			reasoning: parseResult.reasoning,
			error,
			completedAt: Date.now(),
		};
	}
}

/**
 * Shorthand function to reconcile attempt records without instantiating
 * the full class.
 *
 * @param workspaceId - Workspace identifier
 * @param attempts - Chronological list of attempt records
 * @param config - Optional reconciler configuration
 * @returns Reconciled result
 */
export function reconcileTerminalVerdicts(
	workspaceId: string,
	attempts: AttemptRecord[],
	config?: Partial<TerminalReconcilerConfig>,
): ReconciledWorkspaceResult {
	const reconciler = new TerminalVerdictReconciler(config);
	return reconciler.reconcile(workspaceId, attempts);
}
