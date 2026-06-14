/**
 * ACCP Evidence Validator V2
 *
 * Validates ACCP evidence entries: shape, uniqueness, authority level.
 * Evidence is never promoted to runtime proof unless independently verified.
 * Self-report-only evidence is explicitly marked as low authority.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpReportType } from "@earendil-works/pi-execution-contracts";

/** Evidence entry from an ACCP report. */
export interface AccpEvidenceEntry {
	id?: string;
	type?: string;
	description?: string;
	path?: string;
	hash?: string;
	hashRequired?: boolean;
	command?: string;
	exitCode?: number;
	kind?: string;
	claim?: string;
}

/** False-positive guard flags for command results. */
export interface AccpFalsePositiveGuards {
	watchModeForbidden?: boolean;
	watchModeDetected?: boolean;
	noTestsFoundIsFailure?: boolean;
	noTestsFound?: boolean;
	commandNotFoundIsFailure?: boolean;
	commandNotFound?: boolean;
	timeoutIsFailure?: boolean;
	timeout?: boolean;
}

/** Promotion-bearing report types that require concrete evidence. */
const PROMOTION_BEARING_TYPES: AccpReportType[] = ["PRR", "TVR", "CAR", "FPR"];

/**
 * Validate a single evidence entry shape.
 *
 * @param entry - Evidence entry to validate.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateEvidenceEntry(entry: AccpEvidenceEntry, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	if (!entry || typeof entry !== "object") {
		diagnostics.push({
			code: "ACCP_EVIDENCE_INVALID_SHAPE",
			message: "Evidence entry must be an object",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return diagnostics;
	}

	// Check hash requirement
	if (entry.hashRequired && !entry.hash) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_HASH_UNVERIFIED",
			message: `Evidence entry of type "${entry.type ?? "unknown"}" requires a hash but none was provided`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Check path exists if provided
	if (entry.path !== undefined && entry.path.trim().length === 0) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_INVALID_SHAPE",
			message: `Evidence entry has an empty path (type: "${entry.type ?? "unknown"}")`,
			severity: "error",
			fatal: false,
			sourcePath,
		});
	}

	// Mark self-report-only evidence as low authority
	const hasConcreteProof = entry.path || entry.command || entry.hash;
	if (!hasConcreteProof && (entry.kind || entry.claim || entry.description)) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_SELF_REPORT_ONLY",
			message: `Evidence entry "${entry.id ?? entry.type ?? "unknown"}" is self-report only and not runtime proof`,
			severity: "warning",
			fatal: false,
			sourcePath,
		});
	}

	return diagnostics;
}

/**
 * Validate false-positive guards for a command result entry.
 * All guard violations are fatal.
 */
export function validateFalsePositiveGuards(guards: AccpFalsePositiveGuards, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	if (guards.watchModeForbidden && guards.watchModeDetected) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_COMMAND_UNVERIFIED",
			message: "False positive guard violation: watch mode was used but watchModeForbidden=true",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (guards.noTestsFoundIsFailure && guards.noTestsFound) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_COMMAND_UNVERIFIED",
			message: "False positive guard violation: no tests found but noTestsFoundIsFailure=true",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (guards.commandNotFoundIsFailure && guards.commandNotFound) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_COMMAND_UNVERIFIED",
			message: "False positive guard violation: command not found but commandNotFoundIsFailure=true",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (guards.timeoutIsFailure && guards.timeout) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_COMMAND_UNVERIFIED",
			message: "False positive guard violation: command timed out but timeoutIsFailure=true",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	return diagnostics;
}

/**
 * Validate all evidence entries in a report.
 *
 * @param entries - Array of evidence entries.
 * @param guards - Optional false-positive guard flags.
 * @param reportType - Report type for promotion policy.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateEvidence(
	entries: AccpEvidenceEntry[],
	guards?: AccpFalsePositiveGuards,
	reportType?: AccpReportType,
	sourcePath?: string,
): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];
	const isPromotionBearing = reportType ? PROMOTION_BEARING_TYPES.includes(reportType) : false;

	if (!entries || entries.length === 0) {
		const fatal = isPromotionBearing;
		diagnostics.push({
			code: "ACCP_EVIDENCE_MISSING",
			message: "No evidence entries found — at least one evidence entry is required",
			severity: fatal ? "error" : "warning",
			fatal,
			sourcePath,
		});
		return diagnostics;
	}

	// Check evidence ids are unique
	const ids = new Map<string, number>();
	for (const entry of entries) {
		if (entry.id) {
			const count = ids.get(entry.id) ?? 0;
			ids.set(entry.id, count + 1);
		}
	}
	for (const [id, count] of ids.entries()) {
		if (count > 1) {
			diagnostics.push({
				code: "ACCP_EVIDENCE_INVALID_SHAPE",
				message: `Duplicate evidence id: "${id}"`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
	}

	for (const entry of entries) {
		const diags = validateEvidenceEntry(entry, sourcePath);
		diagnostics.push(...diags);
	}

	if (guards) {
		const guardDiags = validateFalsePositiveGuards(guards, sourcePath);
		diagnostics.push(...guardDiags);
	}

	// Check for false positive patterns — non-zero exit codes are fatal
	for (const entry of entries) {
		if (entry.type === "command" && entry.exitCode !== undefined && entry.exitCode !== 0) {
			diagnostics.push({
				code: "ACCP_EVIDENCE_COMMAND_UNVERIFIED",
				message: `Command "${entry.command || "unknown"}" exited with non-zero code ${entry.exitCode}`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
	}

	return diagnostics;
}
