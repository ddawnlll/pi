/**
 * ACCP Promotion Evaluator for Runtime (P49.19)
 *
 * Evaluates whether a workspace is promotion-ready based on ACCP gate verdicts.
 *
 * @packageDocumentation
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";

/** Promotion evaluation result. */
export interface RuntimePromotionEvaluation {
	ready: boolean;
	blockingReasons: string[];
}

/**
 * Evaluate promotion readiness from multiple ACCP gate verdicts.
 *
 * @param verdicts - Array of compiled ACCP gate verdicts.
 * @returns Promotion evaluation result.
 */
export function evaluateAccpPromotion(verdicts: AccpGateVerdict[]): RuntimePromotionEvaluation {
	const blockingReasons: string[] = [];

	for (const verdict of verdicts) {
		if (!verdict.valid) {
			blockingReasons.push(`Gate verdict for ${verdict.reportId} is not valid`);
		}
		if (verdict.blockingFindings.length > 0) {
			for (const f of verdict.blockingFindings) {
				blockingReasons.push(`[${verdict.reportId}] ${f}`);
			}
		}
		if (!verdict.promotionReady && verdict.fatalErrors.length > 0) {
			blockingReasons.push(`Report ${verdict.reportId} is not promotion-ready`);
		}
	}

	return {
		ready: blockingReasons.length === 0,
		blockingReasons,
	};
}
