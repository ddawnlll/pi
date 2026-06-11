/**
 * P45.S3 — Predictive Spec Quality Gate
 *
 * Blocks spec freeze when hardCoverage, softCoverage, llmOnlyRatio,
 * unknown required contract count, or historical risk are outside thresholds.
 * Emits HIR/DCR routes where human or runtime decisions are needed.
 *
 * Decision outputs:
 * - allow: coverage and metrics within thresholds
 * - block: hard coverage or critical safety violations
 * - hold: borderline metrics requiring review
 * - downgrade: reduce parallelism or scope due to quality concerns
 */

import type { CoverageVerdict } from "./contract-coverage-calculator.js";
import type { TrendAnalysis } from "./spec-quality-history.js";

// =============================================================================
// Types
// =============================================================================

export type QualityGateDecision = "allow" | "block" | "hold" | "downgrade";

export interface QualityGateInput {
	/** Coverage verdict from the contract coverage calculator. */
	coverage: CoverageVerdict;
	/** Trend analysis from the spec quality history store. */
	trend?: TrendAnalysis;
	/** Whether the ledger has reliable historical data. */
	ledgerReliable: boolean;
}

export interface QualityGateVerdict {
	/** Final gate decision. */
	decision: QualityGateDecision;
	/** Whether spec freeze is permitted. */
	freezePermitted: boolean;
	/** Blocking reasons if not permitted. */
	blockingReasons: string[];
	/** Warnings that do not block. */
	warnings: string[];
	/** Suggested action for the operator. */
	suggestedAction: string;
	/** Whether a HIR (human intervention required) route is needed. */
	hirRequired: boolean;
	/** Whether a DCR (contract conflict) route is needed. */
	dcrRequired: boolean;
	/** Recommended maximum parallelism given current quality. */
	recommendedMaxWorkers: number;
}

export interface QualityGateThresholds {
	/** Maximum risk score allowed for auto-approval (default: 0.4). */
	maxRiskScore: number;
	/** Maximum risk score before hard block (default: 0.8). */
	hardBlockRiskScore: number;
	/** Whether trend degradation forces hold. */
	degradingForcesHold: boolean;
	/** Whether insufficient history forces downgrade. */
	insufficientHistoryForcesDowngrade: boolean;
}

// =============================================================================
// Default Thresholds
// =============================================================================

export const DEFAULT_QUALITY_GATE_THRESHOLDS: QualityGateThresholds = {
	maxRiskScore: 0.4,
	hardBlockRiskScore: 0.8,
	degradingForcesHold: true,
	insufficientHistoryForcesDowngrade: true,
};

// =============================================================================
// Gate
// =============================================================================

/**
 * Evaluate the predictive spec quality gate.
 *
 * Decision logic (fail-closed):
 * 1. If coverage is not admitted → block
 * 2. If trend risk score > hardBlockRiskScore → block
 * 3. If trend risk score > maxRiskScore → hold
 * 4. If trend is degrading → hold
 * 5. If ledger is not reliable → downgrade
 * 6. Otherwise → allow
 */
export function evaluateQualityGate(
	input: QualityGateInput,
	thresholds: QualityGateThresholds = DEFAULT_QUALITY_GATE_THRESHOLDS,
): QualityGateVerdict {
	const blockingReasons: string[] = [];
	const warnings: string[] = [];

	// Step 1: Coverage check
	if (!input.coverage.admitted) {
		blockingReasons.push(`Contract coverage not admitted: ${input.coverage.blockingReasons.join("; ")}`);
	}

	// Step 2: Risk score from trend analysis
	let recommendedMaxWorkers = 6; // default stable_6
	let riskScore = 1.0;

	if (input.trend) {
		riskScore = input.trend.riskScore;

		if (riskScore >= thresholds.hardBlockRiskScore) {
			blockingReasons.push(`Risk score ${riskScore} exceeds hard block threshold ${thresholds.hardBlockRiskScore}`);
		}
	} else if (input.ledgerReliable) {
		// No trend but ledger says we have data — unusual
		warnings.push("Trend analysis unavailable despite reliable ledger");
	}

	// Step 3: Determine decision
	let decision: QualityGateDecision;
	let freezePermitted: boolean;
	let hirRequired = false;
	let dcrRequired = false;

	if (blockingReasons.length > 0) {
		decision = "block";
		freezePermitted = false;
		hirRequired = true;
		dcrRequired = input.coverage.blockingReasons.length > 0;
		recommendedMaxWorkers = 0;
	} else if (input.trend && riskScore > thresholds.maxRiskScore) {
		decision = "hold";
		freezePermitted = false;
		warnings.push(`Risk score ${riskScore} exceeds max auto-approval threshold ${thresholds.maxRiskScore}`);
		hirRequired = true;
		recommendedMaxWorkers = 3; // reduced parallelism
	} else if (input.trend?.direction === "degrading" && thresholds.degradingForcesHold) {
		decision = "hold";
		freezePermitted = false;
		warnings.push("Trend is degrading — holding pending review");
		hirRequired = true;
		recommendedMaxWorkers = 3;
	} else if (!input.ledgerReliable && thresholds.insufficientHistoryForcesDowngrade) {
		decision = "downgrade";
		freezePermitted = true; // permit but with reduced parallelism
		warnings.push("Ledger history is insufficient — downgrading parallelism");
		recommendedMaxWorkers = 4; // below stable_6
	} else {
		decision = "allow";
		freezePermitted = true;

		// Scale recommendation based on risk
		if (riskScore <= 0.1) {
			recommendedMaxWorkers = 12; // excellent quality
		} else if (riskScore <= 0.2) {
			recommendedMaxWorkers = 8;
		} else {
			recommendedMaxWorkers = 6;
		}
	}

	// Check for DCR: coverage warnings about LLM-only
	if (input.coverage.summary.llmOnlyRatioExceeded) {
		dcrRequired = true;
	}

	const suggestedAction = buildSuggestedAction(decision, blockingReasons, warnings);

	return {
		decision,
		freezePermitted,
		blockingReasons,
		warnings,
		suggestedAction,
		hirRequired,
		dcrRequired,
		recommendedMaxWorkers,
	};
}

// =============================================================================
// Helpers
// =============================================================================

function buildSuggestedAction(decision: QualityGateDecision, blockingReasons: string[], warnings: string[]): string {
	switch (decision) {
		case "allow":
			return "Spec freeze is permitted. Proceed with async assembly at recommended parallelism.";
		case "block":
			return `Spec freeze blocked: ${blockingReasons.join("; ")}. Human intervention required.`;
		case "hold":
			return `Spec freeze on hold: ${warnings.join("; ")}. Review and retry when conditions improve.`;
		case "downgrade":
			return `Spec freeze permitted with reduced parallelism. ${warnings.join("; ")}`;
	}
}
