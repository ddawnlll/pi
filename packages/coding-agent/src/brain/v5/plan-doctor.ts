/**
 * Brain V5 — Plan Doctor Extension.
 *
 * Reports V5 advisory status to the plan doctor. The plan doctor can
 * report that V5 is advisory unless operator gates pass, meaning V5
 * suggestions are informational-only until the user or policy grants
 * operator-level authority.
 *
 * @packageDocumentation
 */

import type { BrainV5Config, V5OperatorGateStatus, V5PlanDoctorReport } from "./types.js";

// =========================================================================
// V5 Plan Doctor Report Builder
// =========================================================================

/**
 * Build a V5PlanDoctorReport for the given config and gate status.
 *
 * The plan doctor calls this to understand whether V5 is:
 * - Completely off (OFF mode)
 * - Observing only (READ_ONLY mode)
 * - Advisory only (ADVISORY mode — can suggest but not push)
 * - Drafting (DRAFTING mode — can emit approved change proposals)
 * - Fully operational (OPERATOR_READY mode)
 *
 * In ADVISORY mode, the plan doctor reports that V5 is advisory
 * unless operator gates pass.
 */
export function buildV5DoctorReport(config: BrainV5Config, gateStatus: V5OperatorGateStatus): V5PlanDoctorReport {
	const details: string[] = [];
	let summary: string;
	let canSuggest: boolean;
	let operatorGatesPassed: boolean = gateStatus.allGatesPassed;

	switch (config.mode) {
		case "OFF": {
			summary = "Brain V5 is disabled. No V5 suggestions or observations are available.";
			canSuggest = false;
			details.push("BRAIN_V5_ENABLED is false in settings.");
			details.push("Enable brainV5.enabled in settings.json to activate V5.");
			break;
		}

		case "READ_ONLY": {
			summary = "Brain V5 is in read-only mode. V5 can observe but cannot emit events or suggestions.";
			canSuggest = false;
			details.push("BRAIN_V5_READ_ONLY_MODE is true in settings.");
			details.push("V5 brain modules can observe and store timeline events but cannot emit actor events.");
			details.push("Set brainV5.readOnlyMode to false and brainV5.pushEnabled to true for drafting capability.");
			break;
		}

		case "ADVISORY": {
			summary = "Brain V5 is in advisory mode. V5 can emit observations and signals but cannot push changes.";
			canSuggest = true;
			details.push("V5 is ADVISORY — operator gates must pass before V5 can push approved changes.");
			details.push("BRAIN_V5_PUSH_ENABLED is false in settings (required for DRAFTING+).");
			if (!gateStatus.pushEnabled) {
				details.push("Gate FAILED: brainV5.pushEnabled is not enabled in settings.");
			}
			if (!gateStatus.safetyProfileAllows) {
				details.push("Gate FAILED: The current safety profile does not allow V5 mutations.");
			}
			if (!gateStatus.executionContextAllows) {
				details.push("Gate FAILED: The current execution context does not permit V5 actions.");
			}
			if (gateStatus.allGatesPassed) {
				details.push("All operator gates pass — enable push in settings to reach DRAFTING mode.");
			}
			break;
		}

		case "DRAFTING": {
			summary = "Brain V5 is in drafting mode. V5 can emit approved change proposals for execution.";
			canSuggest = true;
			operatorGatesPassed = true;
			details.push("BRAIN_V5_PUSH_ENABLED is true — V5 can push approved changes.");
			details.push("V5 is DRAFTING: changes require explicit approval before execution.");
			if (!gateStatus.overnightOperatorEnabled) {
				details.push("BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED is false — overnight sessions are not available.");
			}
			break;
		}

		case "OPERATOR_READY": {
			summary = "Brain V5 is fully operational. V5 can run autonomous operator sessions.";
			canSuggest = true;
			operatorGatesPassed = true;
			details.push("All V5 capabilities are enabled.");
			details.push("BRAIN_V5_PUSH_ENABLED is true.");
			details.push("BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED is true — overnight operator is active.");
			details.push("All operator gates passed: V5 has full capability.");
			break;
		}
	}

	return {
		mode: config.mode,
		canSuggest,
		operatorGatesPassed,
		summary,
		details,
	};
}

// =========================================================================
// Operator Gate Check
// =========================================================================

/**
 * Evaluate all operator gates and return their status.
 *
 * Operator gates control whether V5 can move from ADVISORY (can suggest
 * but not push) to DRAFTING/OPERATOR_READY (can push changes).
 *
 * Gates:
 * 1. pushEnabled — user has enabled push capability in settings
 * 2. safetyProfileAllows — the active safety profile permits V5 mutations
 * 3. executionContextAllows — the current workspace/plan context allows V5
 */
export function checkV5OperatorGates(
	config: BrainV5Config,
	context?: {
		safetyProfileAllows?: boolean;
		executionContextAllows?: boolean;
	},
): V5OperatorGateStatus {
	const pushEnabled = config.pushEnabled;
	const safetyProfileAllows = context?.safetyProfileAllows ?? true;
	const executionContextAllows = context?.executionContextAllows ?? true;

	const allGatesPassed = pushEnabled && safetyProfileAllows && executionContextAllows;

	return {
		pushEnabled,
		overnightOperatorEnabled: config.overnightOperatorEnabled,
		safetyProfileAllows,
		executionContextAllows,
		allGatesPassed,
	};
}

/**
 * Build a human-readable V5 advisory status string for the plan doctor CLI output.
 */
export function formatV5DoctorSummary(report: V5PlanDoctorReport): string {
	const lines: string[] = [];
	lines.push(`V5 Mode: ${report.mode}`);
	lines.push(`  Can suggest: ${report.canSuggest ? "yes" : "no"}`);
	lines.push(`  Operator gates passed: ${report.operatorGatesPassed ? "yes" : "no"}`);
	lines.push(`  Summary: ${report.summary}`);
	for (const detail of report.details) {
		lines.push(`  - ${detail}`);
	}
	return lines.join("\n");
}
