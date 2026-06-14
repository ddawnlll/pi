/**
 * ACCP Common Schema Validator V2
 *
 * Validates top-level ACCP fields common to all report types:
 * - accp_version must be "2.0.0"
 * - source_format must be "ACCP-YAML"
 * - report section must contain id, type, family (already canonicalized by parser)
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";
import type { AccpParsedReport } from "../parser/yaml-parser.js";

/**
 * Validate common ACCP schema fields.
 *
 * @param parsed - Parsed ACCP report.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateCommonSchema(parsed: AccpParsedReport, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	// Validate accp_version
	if (parsed.accpVersion !== "2.0.0") {
		diagnostics.push({
			code: "ACCP_SCHEMA_INVALID_ACCP_VERSION",
			message: `Invalid accp_version: expected "2.0.0", got "${parsed.accpVersion}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Validate source_format
	if (parsed.sourceFormat !== "ACCP-YAML") {
		diagnostics.push({
			code: "ACCP_SCHEMA_INVALID_SOURCE_FORMAT",
			message: `Invalid source_format: expected "ACCP-YAML", got "${parsed.sourceFormat}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Validate report fields
	if (!parsed.report.id) {
		diagnostics.push({
			code: "ACCP_SCHEMA_REPORT_ID_MISSING",
			message: "Missing required field: report.id or report_id",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (!parsed.report.type) {
		diagnostics.push({
			code: "ACCP_SCHEMA_REPORT_TYPE_MISSING",
			message: "Missing required field: report.type or report_type",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (!parsed.report.family) {
		diagnostics.push({
			code: "ACCP_SCHEMA_REPORT_FAMILY_MISSING",
			message: "Missing required field: report.family",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	return diagnostics;
}
