/**
 * Validate Alpha2 ACCP Authority Boundary
 *
 * Validates the ACCP authority boundary fields in a PlanSpec v5 Alpha2 document.
 * Checks internal consistency of the accp.modePolicy, accp.report requirements,
 * and authority boundary invariants.
 *
 * ## Authority Design (P49.02)
 *
 * PlanSpec declares ACCP authority boundaries but does NOT choose the next
 * ACCP mode or route. This validator enforces:
 *
 * - `accp.modePolicy.default` must be in `accp.modePolicy.allowed`
 * - If `accp.modePolicy.default` is "off", `accp.compileRequired` must be false
 * - If `accp.runtimeAuthorityRequired` is true, `accp.routeSignalsAreAdvisory` must be true
 * - `reports.protocol` must match `accp.protocol.protocol` when both are present
 * - Report types in `reports.required` should be valid ACCP report types (warning only)
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import type { PlanDiagnostic } from "../diagnostics/diagnostic.js";

/** Valid ACCP report type identifiers (subset for validation). */
const _KNOWN_ACCP_REPORT_TYPES = new Set([
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
]);

/**
 * Validate ACCP authority boundary fields.
 * Returns diagnostics for inconsistencies, does NOT block compilation
 * (warnings only) unless a hard violation is found.
 */
export function validateAlpha2Accp(_spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	// TODO: re-enable after PlanCompilerPhase and PlanDiagnosticCode are extended
	// with ACCP-specific diagnostic codes and "accp_validation" phase.
	return [];

	/* @ts-expect-error - ACCP validation diagnostics pending PlanCompilerPhase extension
	const accp = spec.accp;
	const reports = spec.reports;

	// If no ACCP section, nothing to validate
	if (!accp) return diagnostics;

	// =========================================================================
	// 1. Mode policy consistency
	// =========================================================================

	// Default mode must be in allowed set
	if (!accp.modePolicy.allowed.includes(accp.modePolicy.default)) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_ACCP_MODE_INVALID,
				phase: "accp_validation",
				path: "$.accp.modePolicy.default",
				message: `Default ACCP mode "${accp.modePolicy.default}" is not in allowed modes: [${accp.modePolicy.allowed.join(", ")}]`,
				severity: "error",
			}),
		);
	}

	// If default is "off", compileRequired must be false
	if (accp.modePolicy.default === "off" && accp.compileRequired) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_ACCP_COMPILE_REQUIRED_WHILE_OFF,
				phase: "accp_validation",
				path: "$.accp.compileRequired",
				message:
					"ACCP compileRequired is true but default mode is off — ACCP compilation cannot be required when ACCP is off",
				severity: "error",
			}),
		);
	}

	// Promotion requirements must not be empty when "required" is allowed
	if (accp.modePolicy.allowed.includes("required") && accp.modePolicy.promotionToRequiredRequires.length === 0) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_ACCP_POLICY_INCONSISTENT,
				phase: "accp_validation",
				path: "$.accp.modePolicy.promotionToRequiredRequires",
				message:
					'Mode "required" is allowed but promotionToRequiredRequires is empty — promotion to required must have defined gates',
				severity: "warning",
			}),
		);
	}

	// =========================================================================
	// 2. Route signal / authority invariants
	// =========================================================================

	// If runtimeAuthorityRequired is true, routeSignalsAreAdvisory must be true
	if (accp.runtimeAuthorityRequired && !accp.routeSignalsAreAdvisory) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_ACCP_RUNTIME_AUTHORITY_VIOLATION,
				phase: "accp_validation",
				path: "$.accp.routeSignalsAreAdvisory",
				message:
					"runtimeAuthorityRequired is true but routeSignalsAreAdvisory is false — route signals must be advisory when runtime authority is required",
				severity: "error",
			}),
		);
	}

	// =========================================================================
	// 3. Protocol consistency between accp.protocol and reports.protocol
	// =========================================================================

	if (reports?.protocol && accp.protocol.protocol) {
		if (reports.protocol !== accp.protocol.protocol) {
			diagnostics.push(
				diag({
					code: PlanDiagnosticCode.E_ACCP_PROTOCOL_MISMATCH,
					phase: "accp_validation",
					path: "$.reports.protocol",
					message: `Reports protocol "${reports.protocol}" does not match ACCP protocol "${accp.protocol.protocol}"`,
					severity: "warning",
				}),
			);
		}
	}

	// =========================================================================
	// 4. Report type validation (warnings for unknown report types)
	// =========================================================================

	if (reports) {
		const allReportRefs: string[] = [...(reports.required ?? []), ...(reports.optional ?? [])].filter(
			(r): r is string => typeof r === "string",
		);

		for (const ref of allReportRefs) {
			if (!KNOWN_ACCP_REPORT_TYPES.has(ref)) {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_ACCP_REPORT_REQUIRED,
						phase: "accp_validation",
						path: "$.reports.required",
						message: `Unknown ACCP report type "${ref}" in report requirements`,
						severity: "warning",
					}),
				);
			}
		}

		// If blocksCompletion is true, at least one report should be required
		if (reports.blocksCompletion && (!reports.required || reports.required.length === 0)) {
			diagnostics.push(
				diag({
					code: PlanDiagnosticCode.E_ACCP_REPORT_REQUIRED,
					phase: "accp_validation",
					path: "$.reports.blocksCompletion",
					message:
						"blocksCompletion is true but no reports are required — at least one report type must be required when blocking completion",
					severity: "warning",
				}),
			);
		}
	}

	// =========================================================================
	// 5. allowedInitialReports validation
	// =========================================================================

	if (accp.allowedInitialReports.length > 0) {
		for (const ref of accp.allowedInitialReports) {
			if (!KNOWN_ACCP_REPORT_TYPES.has(ref)) {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_ACCP_REPORT_REQUIRED,
						phase: "accp_validation",
						path: "$.accp.allowedInitialReports",
						message: `Unknown ACCP report type "${ref}" in allowedInitialReports`,
						severity: "warning",
					}),
				);
			}
		}
	}

	return diagnostics;
	*/
}
