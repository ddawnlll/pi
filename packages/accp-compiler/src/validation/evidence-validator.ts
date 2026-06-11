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
 * Validate false-positive guards for a command result entry.
 * All guard violations are BLOCKER severity (fatal=true).
 */
export function validateFalsePositiveGuards(guards: AccpFalsePositiveGuards, sourcePath?: string): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	// Guard 1: watchModeForbidden + watchModeDetected
	if (guards.watchModeForbidden && guards.watchModeDetected) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
			message: "False positive guard violation: watch mode was used but watchModeForbidden=true",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Guard 2: noTestsFoundIsFailure + noTestsFound
	if (guards.noTestsFoundIsFailure && guards.noTestsFound) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
			message: "False positive guard violation: no tests found but noTestsFoundIsFailure=true",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Guard 3: commandNotFoundIsFailure + commandNotFound
	if (guards.commandNotFoundIsFailure && guards.commandNotFound) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
			message: "False positive guard violation: command not found but commandNotFoundIsFailure=true",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Guard 4: timeoutIsFailure + timeout
	if (guards.timeoutIsFailure && guards.timeout) {
		diagnostics.push({
			code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
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
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateEvidence(
	entries: AccpEvidenceEntry[],
	guards?: AccpFalsePositiveGuards,
	sourcePath?: string,
): AccpDiagnostic[] {
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

	if (guards) {
		const guardDiags = validateFalsePositiveGuards(guards, sourcePath);
		diagnostics.push(...guardDiags);
	}

	// Check for false positive patterns — non-zero exit codes are BLOCKER
	for (const entry of entries) {
		if (entry.type === "command" && entry.exitCode !== undefined && entry.exitCode !== 0) {
			diagnostics.push({
				code: "ACCP_EVIDENCE_PATH_NOT_FOUND",
				message: `Command "${entry.command || "unknown"}" exited with non-zero code ${entry.exitCode}`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
	}

	return diagnostics;
}
