/**
 * Validate Alpha2 Security Policy
 *
 * Checks:
 * - Required security constraints are present
 * - Hard stop rules are well-formed
 * - Forbidden files list has entries when schema validation is required
 * - Hardware stop enforcement aligns with lock policy
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { diag, type PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Security(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	// Check that schema validation and lock are aligned
	if (spec.security.schemaValidationRequired && !spec.security.lockRequiredForExecution) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_FILE_POLICY_VIOLATION,
				phase: "policy_validation",
				path: "$.security.lockRequiredForExecution",
				message: "schemaValidationRequired is true but lockRequiredForExecution is false",
				hint: "Enable lockRequiredForExecution when schema validation is required",
			}),
		);
	}

	// Check that forbidden files list is populated when schema validation is on
	if (spec.security.schemaValidationRequired && spec.security.forbiddenFiles.length === 0) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_FILE_POLICY_VIOLATION,
				phase: "policy_validation",
				path: "$.security.forbiddenFiles",
				message: "schemaValidationRequired is true but forbiddenFiles list is empty",
			}),
		);
	}

	// Check for minimum hard stops required
	const requiredHardStops = ["unsupported_planSpecVersion", "missing_plan_lock", "plan_lock_hash_mismatch"];
	for (const required of requiredHardStops) {
		if (!spec.security.hardStops.includes(required)) {
			diagnostics.push(
				diag({
					code: PlanDiagnosticCode.E_FILE_POLICY_VIOLATION,
					phase: "policy_validation",
					path: "$.security.hardStops",
					message: `Required hard stop "${required}" is missing from hardStops list`,
				}),
			);
		}
	}

	return diagnostics;
}
