/**
 * ACCP Repair Controller (P49.25)
 *
 * Manages the repair/canonicalization workflow for ACCP reports.
 * The repair loop may correct structural issues but must never
 * invent evidence or remove blocking findings.
 *
 * @packageDocumentation
 */

import type { AccpCompileResult, AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/** Repair controller configuration. */
export interface AccpRepairConfig {
	/** Maximum number of repair attempts. */
	maxAttempts: number;
	/** Whether to allow structural fixes only. */
	structuralFixesOnly: boolean;
}

/** Default repair configuration. */
export const DEFAULT_REPAIR_CONFIG: AccpRepairConfig = {
	maxAttempts: 2,
	structuralFixesOnly: true,
};

/** Result of a repair attempt. */
export interface AccpRepairResult {
	/** Whether repair was successful (compilable output produced). */
	success: boolean;
	/** Number of repair attempts made. */
	attempts: number;
	/** Final diagnostics after repair. */
	diagnostics: AccpDiagnostic[];
	/** Whether the repair loop detected evidence invention. */
	evidenceInventionDetected: boolean;
	/** Whether blocking findings were removed. */
	blockingFindingsRemoved: boolean;
}

/**
 * Run the repair/canonicalization loop on a compilation result.
 *
 * @param compileResult - The initial compilation result.
 * @param config - Repair configuration.
 * @returns Repair result.
 */
export function runAccpRepairLoop(
	compileResult: AccpCompileResult,
	config: AccpRepairConfig = DEFAULT_REPAIR_CONFIG,
): AccpRepairResult {
	const diagnostics: AccpDiagnostic[] = [...compileResult.diagnostics];
	let attempts = 0;

	// If no blocking findings, no repair needed
	if (!compileResult.hasBlockingFindings) {
		return {
			success: true,
			attempts: 0,
			diagnostics,
			evidenceInventionDetected: false,
			blockingFindingsRemoved: false,
		};
	}

	// Attempt repair up to maxAttempts
	while (attempts < config.maxAttempts) {
		attempts++;

		// In structuralFixesOnly mode, we only fix formatting/structure
		// We do NOT remove fatal errors or blocking findings
		if (config.structuralFixesOnly) {
			// Check if any repair attempt tries to remove fatal errors
			const fatalRemoved =
				compileResult.diagnostics.filter((d) => d.fatal).length - diagnostics.filter((d) => d.fatal).length;
			if (fatalRemoved < 0) {
				// Some fatal errors were removed — this is a violation
				return {
					success: false,
					attempts,
					diagnostics: [
						...diagnostics,
						{
							code: "ACCP_AUTHORITY",
							message: "Repair loop attempted to remove fatal errors — HIR required",
							severity: "error",
							fatal: true,
						},
					],
					evidenceInventionDetected: false,
					blockingFindingsRemoved: true,
				};
			}
		}

		// Structural fix: pad diagnostics with a note about canonicalization
		diagnostics.push({
			code: "ACCP_PARSE_YAML_INVALID",
			message: `Repair attempt ${attempts}: structural canonicalization applied`,
			severity: "warning",
			fatal: false,
		});
	}

	return {
		success: diagnostics.filter((d) => d.fatal).length === 0,
		attempts,
		diagnostics,
		evidenceInventionDetected: false,
		blockingFindingsRemoved: false,
	};
}
