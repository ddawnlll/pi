/**
 * P45.02 — Predictive Spec Validator
 *
 * Validates a generated predictive spec against safety rules:
 * - All namespaces must be disjoint (no file in two namespaces)
 * - Assembler-only files must not appear in worker namespaces
 * - Contract predictions must use valid evidence classes
 * - LLM-only ratio must not exceed threshold
 */

import type { PredictiveSpec } from "./predictive-spec-input.js";

// =============================================================================
// Types
// =============================================================================

export interface ValidationError {
	rule: string;
	message: string;
	path?: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
	warnings: ValidationError[];
}

// =============================================================================
// Validator
// =============================================================================

export function validatePredictiveSpec(spec: PredictiveSpec, options?: { maxLlmOnlyRatio?: number }): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];
	const maxLlmOnlyRatio = options?.maxLlmOnlyRatio ?? 0.3;

	// Rule 1: Disjoint namespaces (no file in two namespaces)
	const fileToNamespaces = new Map<string, string[]>();
	for (const ns of spec.namespaces) {
		for (const file of ns.files) {
			if (!fileToNamespaces.has(file)) {
				fileToNamespaces.set(file, []);
			}
			fileToNamespaces.get(file)!.push(ns.namespace);
		}
	}

	for (const [file, namespaces] of fileToNamespaces) {
		if (namespaces.length > 1) {
			errors.push({
				rule: "disjoint_namespaces",
				message: `File "${file}" is assigned to multiple namespaces: ${namespaces.join(", ")}`,
				path: file,
			});
		}
	}

	// Rule 2: Assembler-only files must not be in worker namespaces
	for (const ns of spec.namespaces) {
		for (const assemblerFile of spec.assemblerOnlyFiles) {
			if (ns.files.includes(assemblerFile)) {
				errors.push({
					rule: "assembler_only_violation",
					message: `Namespace "${ns.namespace}" contains assembler-only file "${assemblerFile}"`,
					path: assemblerFile,
				});
			}
		}
	}

	// Rule 3: Contract predictions must have valid evidence classes
	const validClasses = [
		"static_confirmation",
		"human_approval",
		"historical_pattern_confirmation",
		"llm_only",
		"unknown",
	];
	for (const pred of spec.contractPredictions) {
		if (!validClasses.includes(pred.evidenceClass)) {
			errors.push({
				rule: "invalid_evidence_class",
				message: `Contract "${pred.contract}" has invalid evidence class: ${pred.evidenceClass}`,
				path: pred.contract,
			});
		}
		if (pred.confidence > 1.0 || pred.confidence < 0) {
			warnings.push({
				rule: "invalid_confidence",
				message: `Contract "${pred.contract}" has out-of-range confidence: ${pred.confidence}`,
				path: pred.contract,
			});
		}
	}

	// Rule 4: LLM-only ratio check
	const total = spec.contractPredictions.length;
	const llmOnlyCount = spec.contractPredictions.filter((p) => p.evidenceClass === "llm_only").length;
	const llmRatio = total > 0 ? llmOnlyCount / total : 0;

	if (llmRatio > maxLlmOnlyRatio) {
		errors.push({
			rule: "llm_only_ratio_exceeded",
			message: `LLM-only contract ratio ${(llmRatio * 100).toFixed(1)}% exceeds ${(maxLlmOnlyRatio * 100).toFixed(1)}%`,
		});
	}

	// Rule 5: Schema version check
	if (spec.schemaVersion !== "1.0.0") {
		warnings.push({
			rule: "schema_version",
			message: `Unexpected schema version: ${spec.schemaVersion} (expected 1.0.0)`,
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}
