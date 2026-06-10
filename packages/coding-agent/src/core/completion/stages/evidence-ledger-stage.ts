/**
 * P44.5.03 — Evidence Ledger Stage
 *
 * Verifies that the evidence ledger contains sufficient evidence for all
 * acceptance criteria. Blocks when evidence pass rate is below threshold
 * or when too many failed entries exist.
 *
 * Uses the existing P26 EvidenceLedger where possible (compatible_no_change
 * per the P26 overlap map).
 *
 * Contract Schema: 4.1.1
 */

import type { StageExecutionContext, StageRunner } from "../completion-gate-vnext.js";
import type { StageVerdict } from "../completion-gate-vnext-types.js";
import type { EvidenceLedger } from "../evidence-ledger.js";
import type { EvidenceSummary } from "../evidence-types.js";
import { createFailedStageVerdict, createPassedStageVerdict } from "../workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the evidence ledger stage.
 */
export interface EvidenceLedgerStageConfig {
	/** Evidence ledger instance to check */
	ledger: EvidenceLedger;
	/** Minimum required pass rate (0.0 to 1.0) */
	minPassRate?: number;
	/** Maximum allowed failed entries before blocking */
	maxFailures?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MIN_PASS_RATE = 1.0;
const DEFAULT_MAX_FAILURES = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countByVerdict(summary: EvidenceSummary, verdict: string): number {
	return summary.byVerdict[verdict] ?? 0;
}

function countByConfidence(summary: EvidenceSummary, confidence: string): number {
	return summary.byConfidence[confidence] ?? 0;
}

// ---------------------------------------------------------------------------
// Stage Runner Factory
// ---------------------------------------------------------------------------

/**
 * Create a stage runner for the EvidenceLedger stage.
 */
export function createEvidenceLedgerStageRunner(config: EvidenceLedgerStageConfig): StageRunner {
	return (_stage: string, _workspace: unknown, _context: StageExecutionContext): StageVerdict => {
		const startTime = Date.now();
		const minPassRate = config.minPassRate ?? DEFAULT_MIN_PASS_RATE;
		const maxFailures = config.maxFailures ?? DEFAULT_MAX_FAILURES;

		// Get the ledger summary
		const summary: EvidenceSummary = config.ledger.getSummary();
		const blockReasons: string[] = [];
		const warnings: string[] = [];

		// Check pass rate
		if (summary.passRate < minPassRate) {
			blockReasons.push(
				`Evidence pass rate ${(summary.passRate * 100).toFixed(1)}% is below minimum ${(minPassRate * 100).toFixed(1)}%`,
			);
		}

		// Check failure count
		const failureCount = countByVerdict(summary, "fail");
		if (failureCount > maxFailures) {
			blockReasons.push(`${failureCount} evidence entries have fail verdict (max allowed: ${maxFailures})`);
		}

		// Warn about low confidence evidence
		const lowConfidenceCount = countByConfidence(summary, "low");
		if (lowConfidenceCount > 0) {
			warnings.push(`${lowConfidenceCount} evidence entries have low confidence`);
		}

		if (blockReasons.length > 0) {
			return createFailedStageVerdict(
				"EvidenceLedger",
				blockReasons,
				{
					total: summary.total,
					passRate: summary.passRate,
					failures: failureCount,
					lowConfidence: lowConfidenceCount,
					minPassRate,
					maxFailures,
					recoveryState: "NEEDS_REPAIR",
				},
				Date.now() - startTime,
			);
		}

		return createPassedStageVerdict(
			"EvidenceLedger",
			{
				total: summary.total,
				passRate: summary.passRate,
				failures: failureCount,
				lowConfidence: lowConfidenceCount,
				minPassRate,
				maxFailures,
			},
			Date.now() - startTime,
		);
	};
}
