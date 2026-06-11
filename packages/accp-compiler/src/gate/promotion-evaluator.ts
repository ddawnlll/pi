/**
 * ACCP Promotion Evaluator
 *
 * Evaluates whether a report is promotion-ready based on gate verdicts
 * and overall report status.
 *
 * @packageDocumentation
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";

/** Promotion evaluation result. */
export interface PromotionEvaluationResult {
	/** Whether the report is promotion-ready. */
	ready: boolean;
	/** Reasons blocking promotion (if not ready). */
	blockingReasons: string[];
	/** Evidence status summary. */
	evidenceSummary: string;
}

/**
 * Evaluate promotion readiness from a gate verdict.
 *
 * @param verdict - The compiled gate verdict.
 * @returns Promotion evaluation result.
 */
export function evaluatePromotion(verdict: AccpGateVerdict): PromotionEvaluationResult {
	const blockingReasons: string[] = [];

	if (!verdict.valid) {
		blockingReasons.push("Gate verdict is not valid");
	}

	if (verdict.fatalErrors.length > 0) {
		blockingReasons.push(...verdict.fatalErrors.map((e) => `Fatal error: ${e}`));
	}

	if (verdict.blockingFindings.length > 0) {
		blockingReasons.push(...verdict.blockingFindings.map((f) => `Blocking finding: ${f}`));
	}

	if (verdict.evidenceStatus === "missing") {
		blockingReasons.push("Evidence is missing");
	}

	return {
		ready: blockingReasons.length === 0 && verdict.promotionReady,
		blockingReasons,
		evidenceSummary: verdict.evidenceStatus,
	};
}
