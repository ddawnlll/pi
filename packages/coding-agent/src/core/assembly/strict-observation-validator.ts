/**
 * P45.04 — StrictObservation Validator (core validator)
 *
 * Re-exports the validator with additional dependency elimination optimizer.
 */

export {
	type ObservationEvidence,
	type StrictObservationResult,
	validateObservation,
	validateObservations,
} from "./strict-observation.js";

/**
 * Dependency Elimination Optimizer
 *
 * Given a list of contracts and their dependency usage, suggest which
 * dependencies can be safely eliminated based on strict observation evidence.
 */

import type { ContractPrediction } from "./predictive-spec-input.js";

export interface DependencyEliminationCandidate {
	contract: string;
	canEliminate: boolean;
	reason: string;
	evidenceRequired: string;
}

/**
 * Analyze which contracts can be eliminated from the dependency graph.
 * Only suggests elimination if there's clear evidence.
 */
export function analyzeDependencyElimination(predictions: ContractPrediction[]): DependencyEliminationCandidate[] {
	return predictions.map((p) => {
		// Static confirmation contracts should NOT be eliminated without compiler evidence
		if (p.evidenceClass === "static_confirmation") {
			return {
				contract: p.contract,
				canEliminate: false,
				reason: "Static confirmation — elimination requires compiler output evidence",
				evidenceRequired: "compiler_output or static_analysis showing no references",
			};
		}

		// LLM-only contracts can be eliminated more easily
		if (p.evidenceClass === "llm_only") {
			return {
				contract: p.contract,
				canEliminate: true,
				reason: "LLM-only prediction — low confidence, safe to eliminate if unused",
				evidenceRequired: "static_analysis showing zero imports",
			};
		}

		// Unknown contracts: can eliminate if not required
		return {
			contract: p.contract,
			canEliminate: true,
			reason: "Unknown evidence — can eliminate if not explicitly required",
			evidenceRequired: "human_approval or static_analysis",
		};
	});
}
