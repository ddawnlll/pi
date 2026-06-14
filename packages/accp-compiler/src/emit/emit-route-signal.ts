/**
 * ACCP Route Signal Emitter
 *
 * Compiles an ACCP report into a route-signal.json artifact.
 * Route signals are advisory — they recommend a next route but
 * never authorize execution, mutation, or workspace transitions.
 *
 * ## Guardrail Rules
 *
 * - READ_ONLY routes: auto-advance allowed when confidence high, no blockers
 * - VALIDATION_ONLY routes: auto-advance when validation commands allowed
 * - MUTATION_ALLOWED routes: require PlanSpec authority or human confirmation
 * - UNKNOWN/UNRESOLVED targets: require HIR or human confirmation
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpReportType, AccpRouteSignal } from "@earendil-works/pi-execution-contracts";

/** Mutation policy needed for a route. */
export type MutationPolicyNeeded = "none" | "read_only" | "validation_only" | "mutation_allowed";

/** Options for route signal compilation. */
export interface RouteSignalCompileOptions {
	/** Whether to auto-advance on high confidence read-only routes. */
	autoAdvanceReadOnly: boolean;
	/** Whether to auto-advance on validation routes with allowed commands. */
	autoAdvanceValidation: boolean;
	/** Known report types that can be resolved as route targets. */
	knownReportTypes: Set<string>;
}

/** Default route signal compilation options. */
export const DEFAULT_ROUTE_SIGNAL_OPTIONS: RouteSignalCompileOptions = {
	autoAdvanceReadOnly: true,
	autoAdvanceValidation: false,
	knownReportTypes: new Set([
		"RIR",
		"PIR",
		"IPR",
		"TVR",
		"HIR",
		"RAR",
		"PRR",
		"CAR",
		"BSR",
		"BRR",
		"RCA",
		"FPR",
		"FVR",
		"FER",
		"FDR",
		"FCR",
		"FIR",
		"FGR",
		"WBR",
		"WDR",
		"WER",
		"WQR",
		"ECR",
		"DCR",
	]),
};

/**
 * Compile a route signal from report metadata and findings.
 *
 * @param sourceReportId - The report ID that produced this signal.
 * @param sourceReportType - The report type.
 * @param findings - Array of diagnostic findings from compilation/validation.
 * @param options - Compile options.
 * @returns Route signal and any compilation diagnostics.
 */
export function compileRouteSignal(
	sourceReportId: string,
	sourceReportType: AccpReportType,
	findings: AccpDiagnostic[],
	options: RouteSignalCompileOptions = DEFAULT_ROUTE_SIGNAL_OPTIONS,
): { signal: AccpRouteSignal; diagnostics: AccpDiagnostic[] } {
	const diagnostics: AccpDiagnostic[] = [];

	// Determine route based on report type and findings
	const hasBlockingFindings = findings.some((f) => f.fatal);
	const hasWarnings = findings.some((f) => f.severity === "warning");

	// Default: no auto-advance
	let recommendedNextRoute = "";
	let recommendedNextAction = "";
	let mutationPolicyNeeded: MutationPolicyNeeded = "none";
	let confidence: "high" | "medium" | "low" = "medium";
	let targetResolved = false;
	const unresolvedRefs: string[] = [];

	// Determine next route based on report type family
	switch (sourceReportType) {
		case "TVR":
		case "FVR":
			// Validation results -> next action based on pass/fail
			if (hasBlockingFindings) {
				recommendedNextRoute = "BSR";
				recommendedNextAction = "investigate_failures";
				mutationPolicyNeeded = "read_only";
				confidence = "high";
				targetResolved = true;
			} else if (hasWarnings) {
				recommendedNextRoute = "CAR";
				recommendedNextAction = "review_warnings";
				mutationPolicyNeeded = "validation_only";
				confidence = "medium";
				targetResolved = true;
			} else {
				recommendedNextRoute = "PRR";
				recommendedNextAction = "promotion_readiness";
				mutationPolicyNeeded = "validation_only";
				confidence = "high";
				targetResolved = true;
			}
			break;

		case "BSR":
		case "FPR":
			// Bugfix/fix reports -> next action
			if (hasBlockingFindings) {
				recommendedNextRoute = "RCA";
				recommendedNextAction = "root_cause_analysis";
				mutationPolicyNeeded = "read_only";
				confidence = "high";
				targetResolved = true;
			} else {
				recommendedNextRoute = "FVR";
				recommendedNextAction = "validate_fix";
				mutationPolicyNeeded = "read_only";
				confidence = "high";
				targetResolved = true;
			}
			break;

		case "PRR":
			// Promotion readiness -> promotion decision
			if (hasBlockingFindings) {
				recommendedNextRoute = "CAR";
				recommendedNextAction = "resolve_blockers";
				mutationPolicyNeeded = "mutation_allowed";
				confidence = "low";
				targetResolved = true;
			} else {
				recommendedNextRoute = "";
				recommendedNextAction = "promote";
				mutationPolicyNeeded = "mutation_allowed";
				confidence = "high";
				targetResolved = false; // Promotion is a runtime decision, not a route
			}
			break;

		case "IPR":
			// Implementation patch -> validation
			recommendedNextRoute = "TVR";
			recommendedNextAction = "validate_implementation";
			mutationPolicyNeeded = "validation_only";
			confidence = "high";
			targetResolved = true;
			break;

		case "HIR":
		case "RAR":
			// Human intervention / regression analysis -> investigation
			recommendedNextRoute = "BSR";
			recommendedNextAction = "investigate";
			mutationPolicyNeeded = "read_only";
			confidence = "medium";
			targetResolved = true;
			break;

		case "CAR":
			// Correction -> re-validate
			recommendedNextRoute = "TVR";
			recommendedNextAction = "revalidate_after_correction";
			mutationPolicyNeeded = "validation_only";
			confidence = "medium";
			targetResolved = true;
			break;

		case "RIR":
			// Repo inspection -> implementation or validation
			recommendedNextRoute = "IPR";
			recommendedNextAction = "implement_findings";
			mutationPolicyNeeded = "mutation_allowed";
			confidence = "medium";
			targetResolved = true;
			break;

		case "PIR":
			// Plan inspection -> review
			recommendedNextRoute = "HIR";
			recommendedNextAction = "review_analysis";
			mutationPolicyNeeded = "read_only";
			confidence = "medium";
			targetResolved = true;
			break;

		case "ECR":
		case "DCR":
			// Coordination reports -> human review
			recommendedNextRoute = "HIR";
			recommendedNextAction = "coordinate";
			mutationPolicyNeeded = "read_only";
			confidence = "medium";
			targetResolved = true;
			break;

		default:
			// Unknown report type -> unresolvable
			recommendedNextRoute = "HIR";
			recommendedNextAction = "unresolved_route_target";
			mutationPolicyNeeded = "read_only";
			confidence = "low";
			targetResolved = false;
			unresolvedRefs.push(sourceReportType);
			diagnostics.push({
				code: "ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY",
				message: `Unknown report type "${sourceReportType}" — route target unresolved`,
				severity: "warning",
				fatal: false,
			});
			break;
	}

	// Verify target resolution
	if (recommendedNextRoute && !options.knownReportTypes.has(recommendedNextRoute)) {
		targetResolved = false;
		unresolvedRefs.push(recommendedNextRoute);
		diagnostics.push({
			code: "ACCP_ROUTE_MUTATION_WITHOUT_AUTHORITY",
			message: `Route target "${recommendedNextRoute}" is not a known report type`,
			severity: "warning",
			fatal: false,
		});
	}

	const signal: AccpRouteSignal = {
		sourceReportId,
		sourceReportType,
		recommendedNextAction,
		recommendedNextRoute,
		confidence,
		isAdvisory: true,
		mutationPolicyNeeded,
		targetResolved,
		unresolvedRefs: unresolvedRefs.length > 0 ? unresolvedRefs : undefined,
	};

	return { signal, diagnostics };
}
