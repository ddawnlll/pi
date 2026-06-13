/**
 * P45.04 — StrictObservation Validator
 *
 * Validates that dependency removals are backed by strict evidence,
 * not LLM assumptions. Rejects vague claims.
 */

import type { ContractPrediction } from "./predictive-spec-input.js";

// =============================================================================
// Types
// =============================================================================

export interface ObservationEvidence {
	contract: string;
	kind: "import_removed" | "type_unused" | "function_unused" | "file_deleted" | "export_removed";
	evidenceSource: "static_analysis" | "compiler_output" | "test_coverage" | "git_diff" | "declared";
	detail: string;
}

export interface StrictObservationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
	observations: ObservationEvidence[];
}

// =============================================================================
// Validator
// =============================================================================

/**
 * Validate that a dependency removal observation has strict evidence.
 * Rejects observations with only "llm_only" or "declared" evidence when
 * removing a contract with static_confirmation history.
 */
export function validateObservation(
	prediction: ContractPrediction,
	evidence: ObservationEvidence,
): { valid: boolean; reason?: string } {
	// Never allow removal based on declared-only evidence
	if (evidence.evidenceSource === "declared") {
		return {
			valid: false,
			reason: `Removal of "${prediction.contract}" based on declaration only — strict evidence required`,
		};
	}

	// High-confidence static contracts require stronger evidence for removal
	if (
		prediction.evidenceClass === "static_confirmation" &&
		evidence.evidenceSource !== "static_analysis" &&
		evidence.evidenceSource !== "compiler_output"
	) {
		return {
			valid: false,
			reason: `Removal of static_confirmation contract "${prediction.contract}" requires static_analysis or compiler_output evidence`,
		};
	}

	return { valid: true };
}

/**
 * Batch-validate observations against predictions.
 */
export function validateObservations(
	predictions: ContractPrediction[],
	observations: ObservationEvidence[],
): StrictObservationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	for (const obs of observations) {
		const pred = predictions.find((p) => p.contract === obs.contract);
		if (pred) {
			const result = validateObservation(pred, obs);
			if (!result.valid) {
				errors.push(result.reason!);
			}
		} else {
			warnings.push(`Observation for unknown contract: "${obs.contract}"`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		observations,
	};
}
