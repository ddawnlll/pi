/**
 * ACCP ID Validator
 *
 * Validates stable report IDs. IDs must be unique, non-empty,
 * and match the expected pattern for ACCP reports.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/** Pattern for valid ACCP report IDs. */
const ACCP_ID_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Validate a single ACCP report ID.
 *
 * @param id - The report ID to validate.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateReportId(id: string, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	if (!id || id.trim().length === 0) {
		diagnostics.push({
			code: "ACCP_ID_DUPLICATE",
			message: "Report ID is empty",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return diagnostics;
	}

	if (!ACCP_ID_PATTERN.test(id)) {
		diagnostics.push({
			code: "ACCP_ID_DUPLICATE",
			message: `Invalid report ID format: "${id}". Must match pattern /^[A-Z][A-Z0-9_]{2,63}$/`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	return diagnostics;
}

/**
 * Validate IDs across a set of reports for duplicates.
 *
 * @param ids - Array of report IDs to check.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateUniqueIds(ids: string[], sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];
	const seen = new Set<string>();

	for (const id of ids) {
		if (seen.has(id)) {
			diagnostics.push({
				code: "ACCP_ID_DUPLICATE",
				message: `Duplicate report ID: "${id}"`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
		seen.add(id);
	}

	return diagnostics;
}
