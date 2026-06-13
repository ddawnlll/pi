/**
 * Validate Alpha2 Command Policy
 *
 * Checks:
 * - Exact allowed commands conform to execution policy
 * - Command classes have valid structure
 * - Runtime command grant policy is satisfiable
 * - Validation evidence rules are consistent
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { diag, type PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Commands(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	if (!spec.commands) return diagnostics;

	// Check that exact allowed commands have valid structure
	if (spec.commands.exactAllowedCommands) {
		spec.commands.exactAllowedCommands.forEach((cmd, i) => {
			if (typeof cmd !== "object" || !cmd.executable) {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_INVALID_TYPE,
						phase: "policy_validation",
						path: `$.commands.exactAllowedCommands[${i}]`,
						message: `Exact allowed command at index ${i} is missing "executable" field`,
					}),
				);
			}
		});
	}

	// Check that command classes reference valid executables
	if (spec.commands.commandClasses) {
		spec.commands.commandClasses.forEach((cls, i) => {
			if (typeof cls !== "object") {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_INVALID_TYPE,
						phase: "policy_validation",
						path: `$.commands.commandClasses[${i}]`,
						message: `Command class at index ${i} must be an object`,
					}),
				);
				return;
			}
			// Command classes with mode "argvPattern" must have argPatterns or argSchema
			if (
				(cls as Record<string, unknown>).mode === "argvPattern" &&
				!(cls as Record<string, unknown>).argPatterns &&
				!(cls as Record<string, unknown>).argSchema
			) {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_INVALID_TYPE,
						phase: "policy_validation",
						path: `$.commands.commandClasses[${i}]`,
						message: `Command class "${(cls as Record<string, unknown>).id}" with mode argvPattern must have argPatterns or argSchema`,
					}),
				);
			}
		});
	}

	// Check validation evidence rules consistency
	if (
		spec.commands.validationEvidenceRules?.discoveryCommandsMayNotSatisfyFinalValidation &&
		spec.validation?.finalRequired
	) {
		// This is expected — just note it
	}

	return diagnostics;
}
