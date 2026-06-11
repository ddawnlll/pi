/**
 * P44.6.07 — Acceptance Criteria Normalizer
 *
 * Converts implicit user success conditions into explicit acceptance
 * criteria with IDs and evidence expectations. Each criterion carries
 * an evidence type, a verdict, and optional command to validate.
 *
 * Contract Schema: 4.1.1
 */

import { EngineMode } from "./engine-mode.js";
import type { ModeDiagnostic } from "./mode-diagnostic.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ACCEPTANCE_CRITERIA_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Evidence Type
// ---------------------------------------------------------------------------

/**
 * Types of evidence that can satisfy an acceptance criterion.
 */
export type EvidenceRequirement =
	| "source_exists"
	| "source_modified"
	| "tests_pass"
	| "type_check_passes"
	| "lint_passes"
	| "command_succeeds"
	| "manual_review"
	| "all";

// ---------------------------------------------------------------------------
// Normalized Criterion
// ---------------------------------------------------------------------------

/**
 * A normalized acceptance criterion with explicit evidence expectations.
 */
export interface NormalizedCriterion {
	/** Unique criterion ID (e.g., "AC-001"). */
	id: string;
	/** Human-readable title. */
	title: string;
	/** Detailed description of the criterion. */
	description: string;
	/** Type of evidence required to satisfy this criterion. */
	evidenceRequirement: EvidenceRequirement;
	/** Whether this criterion is required or optional. */
	required: boolean;
	/** Optional command to validate this criterion. */
	validationCommand?: string;
}

// ---------------------------------------------------------------------------
// Normalization Result
// ---------------------------------------------------------------------------

export interface NormalizationResult {
	criteria: NormalizedCriterion[];
	diagnostics: ModeDiagnostic[];
	success: boolean;
}

// ---------------------------------------------------------------------------
// Default Criteria per Mode
// ---------------------------------------------------------------------------

function getDefaultCriteria(mode: EngineMode): NormalizedCriterion[] {
	switch (mode) {
		case EngineMode.Write:
			return [
				{
					id: "AC-WRITE-001",
					title: "Target artifact created",
					description: "The target file or artifact was successfully created.",
					evidenceRequirement: "source_exists",
					required: true,
				},
				{
					id: "AC-WRITE-002",
					title: "No compilation errors",
					description: "TypeScript compilation passes after creation.",
					evidenceRequirement: "type_check_passes",
					required: false,
				},
			];
		case EngineMode.Edit:
			return [
				{
					id: "AC-EDIT-001",
					title: "Target artifact modified",
					description: "The target file or artifact was successfully modified.",
					evidenceRequirement: "source_modified",
					required: true,
				},
				{
					id: "AC-EDIT-002",
					title: "Preserve constraints honored",
					description: "Preserve constraints were not violated during modification.",
					evidenceRequirement: "manual_review",
					required: true,
				},
				{
					id: "AC-EDIT-003",
					title: "No compilation errors",
					description: "TypeScript compilation passes after edit.",
					evidenceRequirement: "type_check_passes",
					required: false,
				},
			];
		case EngineMode.SmartWrite:
			return [
				{
					id: "AC-SMWRITE-001",
					title: "JSON PlanSpec artifact produced",
					description: "A valid JSON PlanSpec artifact was generated.",
					evidenceRequirement: "source_exists",
					required: true,
				},
				{
					id: "AC-SMWRITE-002",
					title: "Schema validation passes",
					description: "The generated PlanSpec passes schema validation.",
					evidenceRequirement: "command_succeeds",
					required: true,
				},
			];
		case EngineMode.SmartEdit:
			return [
				{
					id: "AC-SMEDIT-001",
					title: "Audit findings produced",
					description: "Audit phase completed with findings.",
					evidenceRequirement: "source_exists",
					required: true,
				},
				{
					id: "AC-SMEDIT-002",
					title: "Findings resolved or justified",
					description: "All audit findings were resolved by the patch or justified as acceptable.",
					evidenceRequirement: "manual_review",
					required: true,
				},
				{
					id: "AC-SMEDIT-003",
					title: "No regressions introduced",
					description: "Existing tests continue to pass after the smart edit patch.",
					evidenceRequirement: "tests_pass",
					required: true,
				},
			];
	}
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

/**
 * Normalize acceptance criteria for a given engine mode.
 * Produces explicit criteria with evidence expectations.
 */
export function normalizeCriteria(
	mode: EngineMode,
	customCriteria?: Partial<NormalizedCriterion>[],
): NormalizationResult {
	const diagnostics: ModeDiagnostic[] = [];
	const baseCriteria = getDefaultCriteria(mode);
	const criteria: NormalizedCriterion[] = [...baseCriteria];

	// Merge custom criteria if provided
	if (customCriteria && customCriteria.length > 0) {
		for (const custom of customCriteria) {
			if (custom.id) {
				// Replace or add
				const existingIndex = criteria.findIndex((c) => c.id === custom.id);
				if (existingIndex >= 0) {
					criteria[existingIndex] = { ...criteria[existingIndex], ...custom };
				} else {
					criteria.push({
						id: custom.id ?? `AC-CUSTOM-${criteria.length + 1}`,
						title: custom.title ?? "Custom criterion",
						description: custom.description ?? "",
						evidenceRequirement: custom.evidenceRequirement ?? "manual_review",
						required: custom.required ?? true,
					});
				}
			} else {
				diagnostics.push({
					severity: "warning",
					code: "WARN_MISSING_CONSTRAINTS",
					message: "Custom criterion without ID — skipped.",
				});
			}
		}
	}

	return {
		criteria,
		diagnostics,
		success: diagnostics.length === 0,
	};
}
