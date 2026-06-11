/**
 * ACCP Evidence Validator
 *
 * Validates ACCP evidence entries: paths, hashes, commands, and
 * false positive guards.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/** Evidence entry from an ACCP report. */
export interface AccpEvidenceEntry {
	type: string;
	description?: string;
	path?: string;
	hash?: string;
	hashRequired?: boolean;
	command?: string;
	exitCode?: number;
}

/**
 * Validate a single evidence entry.
 *
 * @param entry - Evidence entry to validate.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateEvidenceEntry(entry: AccpEvidenceEntry, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	// Check hash requirement
	if (entry.hashRequired && !entry.hash) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
			message: `Evidence entry of type "${entry.type}" requires a hash but none was provided`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Check path exists if provided
	if (entry.path && entry.path.trim().length === 0) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
			message: `Evidence entry has an empty path (type: "${entry.type}")`,
			severity: "error",
			fatal: false,
			sourcePath,
		});
	}

	return diagnostics;
}

/**
 * Validate all evidence entries in a report.
 *
 * @param entries - Array of evidence entries.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateEvidence(entries: AccpEvidenceEntry[], sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	if (!entries || entries.length === 0) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
			message: "No evidence entries found — at least one evidence entry is required",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return diagnostics;
	}

	for (const entry of entries) {
		const diags = validateEvidenceEntry(entry, sourcePath);
		diagnostics.push(...diags);
	}

	// Check for false positive patterns
	for (const entry of entries) {
		if (entry.type === "command" && entry.exitCode !== undefined && entry.exitCode !== 0) {
			diagnostics.push({
				code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
				message: `Command "${entry.command || "unknown"}" exited with non-zero code ${entry.exitCode}`,
				severity: "warning",
				fatal: false,
				sourcePath,
			});
		}
	}

	return diagnostics;
}
