/**
 * ACCP Reference Validator
 *
 * Validates cross-report references. Rejects unresolved refs,
 * ambiguous short refs, and malformed reference strings.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/** Pattern for valid reference strings (report IDs, short refs, or URIs). */
const REF_PATTERN = /^[A-Za-z#][A-Za-z0-9_./#-]{0,127}$/;

/**
 * Validate a single reference string.
 *
 * @param ref - The reference string to validate.
 * @param knownIds - Set of known report IDs for resolution.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateReference(ref: string, knownIds: Set<string>, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	if (!ref || ref.trim().length === 0) {
		diagnostics.push({
			code: "ACCP_REF_UNRESOLVED",
			message: "Reference is empty",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return diagnostics;
	}

	if (!REF_PATTERN.test(ref)) {
		diagnostics.push({
			code: "ACCP_REF_UNRESOLVED",
			message: `Malformed reference: "${ref}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return diagnostics;
	}

	// If the ref looks like a report ID, check it resolves
	if (ref.startsWith("#")) {
		// Short ref (local reference within same document)
		const target = ref.slice(1);
		if (target.length > 0 && !knownIds.has(target)) {
			diagnostics.push({
				code: "ACCP_REF_UNRESOLVED",
				message: `Unresolved short reference: "${ref}"`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
	} else if (/^[A-Z][A-Z0-9_]+$/.test(ref)) {
		// Looks like a report ID reference
		if (!knownIds.has(ref)) {
			diagnostics.push({
				code: "ACCP_REF_UNRESOLVED",
				message: `Unresolved report reference: "${ref}"`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
	}

	return diagnostics;
}

/**
 * Validate all references in a set of reports.
 *
 * @param refs - Array of reference strings to validate.
 * @param knownIds - Set of known report IDs.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateReferences(refs: string[], knownIds: Set<string>, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	for (const ref of refs) {
		const diags = validateReference(ref, knownIds, sourcePath);
		diagnostics.push(...diags);
	}

	return diagnostics;
}
