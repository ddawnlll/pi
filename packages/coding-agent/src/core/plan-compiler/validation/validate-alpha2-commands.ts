/**
 * Validate Alpha2 Command Policy
 *
 * Checks:
 * - Blocked commands must not appear in allowed commands
 * - Task execution policies must obey top-level command policy
 * - Validation command references must be resolvable
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { diag, error, type PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Commands(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	if (!spec.commands) return diagnostics;

	const topPolicy = spec.commands;
	const blockedSet = new Set(topPolicy.blockedCommands ?? []);
	const allowedSet = new Set(topPolicy.allowedCommands ?? []);

	// Check that blocked commands are not in allowed
	for (const cmd of blockedSet) {
		if (allowedSet.has(cmd)) {
			diagnostics.push(
				error({
					code: PlanDiagnosticCode.E_COMMAND_POLICY_VIOLATION,
					phase: "policy_validation",
					path: "$.commands",
					message: `Command "${cmd}" is both in allowedCommands and blockedCommands`,
				}),
			);
		}
	}

	// Check task execution policies
	for (let i = 0; i < spec.waves.length; i++) {
		const wave = spec.waves[i];
		for (let j = 0; j < wave.tasks.length; j++) {
			const task = wave.tasks[j];
			const taskPath = `$.waves[${i}].tasks[${j}]`;

			if (task.executionPolicy?.allowedCommands) {
				for (const cmd of task.executionPolicy.allowedCommands) {
					if (blockedSet.has(cmd)) {
						diagnostics.push(
							error({
								code: PlanDiagnosticCode.E_BLOCKED_COMMAND,
								phase: "policy_validation",
								path: `${taskPath}.executionPolicy.allowedCommands`,
								message: `Task "${task.id}" allows blocked command: "${cmd}"`,
							}),
						);
					}
				}

				// If top-level policy is strict, task-level commands must be subset
				if (topPolicy.policy === "strict" && topPolicy.allowedCommands) {
					for (const cmd of task.executionPolicy.allowedCommands) {
						if (!allowedSet.has(cmd)) {
							diagnostics.push(
								error({
									code: PlanDiagnosticCode.E_COMMAND_POLICY_VIOLATION,
									phase: "policy_validation",
									path: `${taskPath}.executionPolicy.allowedCommands`,
									message: `Task "${task.id}" allows command "${cmd}" not in top-level allowedCommands (strict policy)`,
								}),
							);
						}
					}
				}

				if (task.executionPolicy.mode === "strict" && topPolicy.policy === "moderate") {
					// Task is stricter than top — this is fine but we could warn
				}
			}
		}
	}

	// Validate validation commands (preCheck/postCheck)
	if (spec.validation) {
		const allCommands = new Set([
			...(topPolicy.allowedCommands ?? []),
			...spec.waves.flatMap((w) => w.tasks.flatMap((t) => t.executionPolicy?.allowedCommands ?? [])),
		]);

		const preChecks = spec.validation.preValidation?.checks ?? [];
		const postChecks = spec.validation.postValidation?.checks ?? [];

		for (const check of preChecks) {
			// If it's a blocked command, that's fine (blocked commands are known)
			if (blockedSet.has(check)) continue;
			// If the command isn't in the allowed set and there IS a policy, flag it
			if (topPolicy.allowedCommands && topPolicy.allowedCommands.length > 0 && !allCommands.has(check)) {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_VALIDATION_UNRESOLVABLE,
						phase: "policy_validation",
						path: "$.validation.preValidation.checks",
						message: `Pre-validation check "${check}" is not in allowedCommands`,
					}),
				);
			}
		}

		for (const check of postChecks) {
			if (blockedSet.has(check)) continue;
			if (topPolicy.allowedCommands && topPolicy.allowedCommands.length > 0 && !allCommands.has(check)) {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_VALIDATION_UNRESOLVABLE,
						phase: "policy_validation",
						path: "$.validation.postValidation.checks",
						message: `Post-validation check "${check}" is not in allowedCommands`,
					}),
				);
			}
		}
	}

	return diagnostics;
}
