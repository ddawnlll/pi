/**
 * ACCP Report-Specific Schema Validator
 *
 * Validates report-specific schema constraints for gate-critical
 * report types (BSR, FPR, TVR, PRR, HIR, CAR).
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpReportType } from "@earendil-works/pi-execution-contracts";

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

	switch (reportType) {
		case "TVR": {
			// TVR must have validation_summary and command_results sections
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
		default:
			// Non-strict types pass with no additional validation
			break;
	}

	return diagnostics;
}
