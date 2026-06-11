/**
 * ACCP Route Policy — Runtime Authority Guardrail Rules
 *
 * Defines the auto-advance rules for compiled route signals.
 * Route signals are advisory; runtime must check PlanSpec
 * authority before acting on any route signal.
 *
 * ## Guardrail Rules
 *
 * - READ_ONLY (mutationPolicyNeeded=none|read_only):
 *   May auto-advance when confidence is high and no blocking findings exist.
 * - VALIDATION_ONLY (mutationPolicyNeeded=validation_only):
 *   May auto-advance when validation commands are in the allowed class.
 * - MUTATION_ALLOWED (mutationPolicyNeeded=mutation_allowed):
 *   Requires PlanSpec authority check or human confirmation.
 * - UNRESOLVED (targetResolved=false):
 *   Requires HIR or human confirmation.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpRouteSignal } from "@earendil-works/pi-execution-contracts";

/** Result of a route policy check. */
export interface RoutePolicyResult {
	/** Whether the route is allowed to auto-advance. */
	canAutoAdvance: boolean;
	/** Whether human confirmation is required. */
	humanConfirmationRequired: boolean;
	/** Whether a HIR (handoff intervention report) is required. */
	hirRequired: boolean;
	/** Diagnostics from the policy check. */
	diagnostics: AccpDiagnostic[];
	/** Reason for the policy decision. */
	reason: string;
}

/**
 * Check route policy against auto-advance rules.
 *
 * @param signal - The compiled route signal.
 * @param validationCommandsAllowed - Whether validation commands are in the allowed class.
 * @returns Route policy result.
 */
export function checkRoutePolicy(
	signal: AccpRouteSignal,
	validationCommandsAllowed: boolean = false,
): RoutePolicyResult {
	const _diagnostics: AccpDiagnostic[] = [];

	// Rule 1: Unresolved targets require HIR
	if (!signal.targetResolved) {
		return {
			canAutoAdvance: false,
			humanConfirmationRequired: false,
			hirRequired: true,
			diagnostics: [
				{
					code: "ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY",
					message: `Route target "${signal.recommendedNextRoute}" is unresolved — HIR required`,
					severity: "error",
					fatal: true,
				},
			],
			reason: "unresolved_target",
		};
	}

	// Rule 2: Mutation-allowed routes require authority check or human confirmation
	if (signal.mutationPolicyNeeded === "mutation_allowed") {
		return {
			canAutoAdvance: false,
			humanConfirmationRequired: true,
			hirRequired: false,
			diagnostics: [
				{
					code: "ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY",
					message: `Route "${signal.recommendedNextRoute}" requires mutation authority — human confirmation or PlanSpec gate required`,
					severity: "warning",
					fatal: false,
				},
			],
			reason: "mutation_requires_authority",
		};
	}

	// Rule 3: Validation-only routes require validation commands allowed
	if (signal.mutationPolicyNeeded === "validation_only") {
		if (!validationCommandsAllowed) {
			return {
				canAutoAdvance: false,
				humanConfirmationRequired: true,
				hirRequired: false,
				diagnostics: [
					{
						code: "ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY",
						message: `Validation route "${signal.recommendedNextRoute}" blocked — validation commands not in allowed class`,
						severity: "warning",
						fatal: false,
					},
				],
				reason: "validation_commands_not_allowed",
			};
		}
		return {
			canAutoAdvance: true,
			humanConfirmationRequired: false,
			hirRequired: false,
			diagnostics: [],
			reason: "auto_advance_validation_allowed",
		};
	}

	// Rule 4: Read-only routes auto-advance when confidence is high
	if (signal.mutationPolicyNeeded === "none" || signal.mutationPolicyNeeded === "read_only") {
		if (signal.confidence === "high") {
			return {
				canAutoAdvance: true,
				humanConfirmationRequired: false,
				hirRequired: false,
				diagnostics: [],
				reason: "auto_advance_read_only_high_confidence",
			};
		}
		return {
			canAutoAdvance: false,
			humanConfirmationRequired: true,
			hirRequired: false,
			diagnostics: [
				{
					code: "ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY",
					message: `Read-only route "${signal.recommendedNextRoute}" has low confidence — human review required`,
					severity: "warning",
					fatal: false,
				},
			],
			reason: "low_confidence_requires_review",
		};
	}

	// Fallback: unknown policy
	return {
		canAutoAdvance: false,
		humanConfirmationRequired: true,
		hirRequired: false,
		diagnostics: [
			{
				code: "ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY",
				message: `Unknown mutation policy "${signal.mutationPolicyNeeded}" — human review required`,
				severity: "warning",
				fatal: false,
			},
		],
		reason: "unknown_policy",
	};
}
