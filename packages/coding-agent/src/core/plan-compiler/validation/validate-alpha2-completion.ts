/**
 * Validate Alpha2 Completion Satisfiability
 *
 * Checks:
 * - If evidence ledger is required, evidence configuration must be present
 * - If reports are required, report targets must exist
 * - If completion gate is enabled, acceptance criteria must be defined
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { diag, type PlanDiagnostic, warn } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Completion(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	// Evidence required -> must have evidence config
	if (spec.authority.completion.evidenceLedgerRequired && !spec.evidence) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
				phase: "completion_validation",
				path: "$.authority.completion.evidenceLedgerRequired",
				message: "evidenceLedgerRequired is true but no evidence config is present",
				hint: "Add evidence configuration",
			}),
		);
	}

	// Reports config check
	if (!spec.reports) {
		// Reports are always required per schema
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
				phase: "completion_validation",
				path: "$.reports",
				message: "Reports configuration is required",
			}),
		);
	} else if (spec.reports.protocol !== "ACCP") {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
				phase: "completion_validation",
				path: "$.reports.protocol",
				message: `Reports protocol must be "ACCP", got "${spec.reports.protocol}"`,
			}),
		);
	}

	// Acceptance criteria: check that workspaces define them when completion gate is used
	if (spec.authority.completion.completionGate) {
		const workspacesWithCriteria = spec.workspaces.filter(
			(w) => w.acceptanceCriteria && w.acceptanceCriteria.length > 0,
		);
		if (workspacesWithCriteria.length === 0) {
			diagnostics.push(
				warn({
					code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
					phase: "completion_validation",
					path: "$.authority.completion.completionGate",
					message: "completionGate is set but no workspace defines acceptanceCriteria",
					hint: "Add acceptanceCriteria to at least one workspace",
				}),
			);
		}

		// Check validation requirements
		if (spec.authority.completion.missingEvidenceBlocksCompletion && !spec.evidence?.ledgerRequired) {
			diagnostics.push(
				diag({
					code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
					phase: "completion_validation",
					path: "$.authority.completion.missingEvidenceBlocksCompletion",
					message: "missingEvidenceBlocksCompletion is true but evidence.ledgerRequired is not set",
					hint: "Enable evidence.ledgerRequired",
				}),
			);
		}
	}

	return diagnostics;
}
