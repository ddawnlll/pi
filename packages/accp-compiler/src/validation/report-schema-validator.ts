/**
 * ACCP Report-Specific Schema Validator V2
 *
 * Validates report-specific schema constraints and exposes support level and
 * validation level in diagnostics. Gate-critical reports (BSR, FPR, TVR, PRR,
 * HIR, CAR) are strictly validated; template-only types are validated lightly.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpReportType } from "@earendil-works/pi-execution-contracts";
import { lookupReportType } from "../registry/report-registry.js";
import { ACCP_GATE_CRITICAL_TYPES, ACCP_SCHEMA_LITE_TYPES } from "../registry/support-matrix.js";

/** Report validation level. */
export type AccpReportValidationLevel = "strict" | "lite" | "template_only" | "unknown";

/**
 * Get the validation level for a report type.
 */
export function getReportValidationLevel(reportType: AccpReportType): AccpReportValidationLevel {
	const entry = lookupReportType(reportType);
	if (!entry) return "unknown";
	if (entry.hasStrictSchema) return "strict";
	if (entry.supportLevel === "schema_lite") return "lite";
	return "template_only";
}

/**
 * Validate report-specific schema for a given report type.
 *
 * @param reportType - The ACCP report type.
 * @param sections - Parsed report sections.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateReportSchema(
	reportType: AccpReportType,
	sections: Record<string, unknown>,
	sourcePath?: string,
): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];
	const level = getReportValidationLevel(reportType);

	// Record validation level as an info diagnostic.
	diagnostics.push({
		code: "ACCP_SCHEMA_REPORT_VALIDATION_LEVEL",
		message: `Report type "${reportType}" validated at "${level}" level`,
		severity: "info",
		fatal: false,
		sourcePath,
	});

	// Strict schema checks for gate-critical types.
	if (ACCP_GATE_CRITICAL_TYPES.includes(reportType)) {
		switch (reportType) {
			case "TVR": {
				if (!sections.validation_summary) {
					diagnostics.push({
						code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
						message: "TVR report is missing required section: validation_summary",
						severity: "error",
						fatal: true,
						sourcePath,
					});
				}
				if (!sections.command_results) {
					diagnostics.push({
						code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
						message: "TVR report is missing required section: command_results",
						severity: "error",
						fatal: true,
						sourcePath,
					});
				}
				break;
			}
			case "BSR": {
				if (!sections.bug_findings) {
					diagnostics.push({
						code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
						message: "BSR report is missing required section: bug_findings",
						severity: "error",
						fatal: false,
						sourcePath,
					});
				}
				break;
			}
			case "PRR": {
				if (!sections.promotion_decision) {
					diagnostics.push({
						code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
						message: "PRR report is missing required section: promotion_decision",
						severity: "error",
						fatal: true,
						sourcePath,
					});
				}
				break;
			}
			case "FPR": {
				if (!sections.patch_summary) {
					diagnostics.push({
						code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
						message: "FPR report is missing recommended section: patch_summary",
						severity: "warning",
						fatal: false,
						sourcePath,
					});
				}
				break;
			}
			case "HIR": {
				if (!sections.intervention_reason) {
					diagnostics.push({
						code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
						message: "HIR report is missing recommended section: intervention_reason",
						severity: "warning",
						fatal: false,
						sourcePath,
					});
				}
				break;
			}
			case "CAR": {
				if (!sections.correction_summary) {
					diagnostics.push({
						code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
						message: "CAR report is missing recommended section: correction_summary",
						severity: "warning",
						fatal: false,
						sourcePath,
					});
				}
				break;
			}
		}
	} else if (ACCP_SCHEMA_LITE_TYPES.includes(reportType)) {
		// Schema-lite types have minimal required sections.
		if (!sections.scope && !sections.summary && !sections.findings && !sections.evidence) {
			diagnostics.push({
				code: "ACCP_EVIDENCE_MISSING",
				message: `Schema-lite report "${reportType}" should include scope, summary, findings, or evidence section`,
				severity: "warning",
				fatal: false,
				sourcePath,
			});
		}
	}

	return diagnostics;
}
