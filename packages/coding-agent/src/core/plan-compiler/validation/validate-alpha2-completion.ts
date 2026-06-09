/**
 * Validate Alpha2 Completion Satisfiability
 *
 * Checks:
 * - If acceptance criteria are required, at least one task must define them
 * - If validation evidence is required, validation requirements must be present
 * - If reports are required, report targets must exist
 * - If rollback plan is required, rollback strategy must exist
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { diag, type PlanDiagnostic, warn } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Completion(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	const completion = spec.authority.completion;

	// Acceptance criteria check
	if (completion.requiresAcceptanceCriteria) {
		const tasksWithCriteria = spec.waves.flatMap((w) => w.tasks.filter((t) => t.acceptanceCriteria.length > 0));
		if (tasksWithCriteria.length === 0) {
			diagnostics.push(
				diag({
					code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
					phase: "completion_validation",
					path: "$.authority.completion.requiresAcceptanceCriteria",
					message: "requiresAcceptanceCriteria is true but no task defines acceptanceCriteria",
					hint: "Add acceptanceCriteria to at least one task",
				}),
			);
		}
	}

	// Validation evidence check
	if (completion.requiresValidationEvidence) {
		const hasValidation = spec.validation != null;
		const _hasPreValidation = (spec.validation?.preValidation?.checks ?? []).length > 0;
		const _hasPostValidation = (spec.validation?.postValidation?.checks ?? []).length > 0;
		const tasksWithValidation = spec.waves.flatMap((w) =>
			w.tasks.filter((t) => (t.validation?.preCheck?.length ?? 0) > 0 || (t.validation?.postCheck?.length ?? 0) > 0),
		);

		if (!hasValidation && tasksWithValidation.length === 0) {
			diagnostics.push(
				warn({
					code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
					phase: "completion_validation",
					path: "$.authority.completion.requiresValidationEvidence",
					message: "requiresValidationEvidence is true but no validation configuration is present",
					hint: "Add validation config or task-level validation checks",
				}),
			);
		}
	}

	// Reports check
	if (completion.requiresReport) {
		const hasReports = spec.reports != null;
		if (!hasReports) {
			diagnostics.push(
				warn({
					code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
					phase: "completion_validation",
					path: "$.authority.completion.requiresReport",
					message: "requiresReport is true but no reports config is present",
					hint: "Add reports configuration",
				}),
			);
		}
	}

	// Rollback plan check
	if (completion.requiresRollbackPlan) {
		const hasRollback = spec.migration?.rollbackStrategy != null;
		if (!hasRollback) {
			diagnostics.push(
				warn({
					code: PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE,
					phase: "completion_validation",
					path: "$.authority.completion.requiresRollbackPlan",
					message: "requiresRollbackPlan is true but no migration.rollbackStrategy is present",
					hint: "Add migration.rollbackStrategy",
				}),
			);
		}
	}

	return diagnostics;
}
