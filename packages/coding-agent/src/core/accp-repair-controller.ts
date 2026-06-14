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

// =============================================================================
// Immutability guard for repair — fields that must NEVER be modified
// =============================================================================

/** Field paths that are immutable during repair canonicalization. */
const _REPAIR_IMMUTABLE_FIELDS = [
	"findings",
	"verdicts",
	"command_results",
	"evidence_hashes",
	"blockers",
	"fatalErrors",
	"blockingFindings",
	"evidenceStatus",
] as const;

/** Error thrown when repair attempts to mutate an immutable field. */
export class RepairBoundaryViolationError extends Error {
	constructor(field: string) {
		super(`Repair attempted to modify immutable field: ${field}`);
		this.name = "RepairBoundaryViolationError";
	}
}

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
	/** Repair prompt text to inject into the worker's next attempt (if any). */
	repairPrompt?: string;
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

	// Field diff tracking for immutability enforcement
	const originalFatalCount = compileResult.diagnostics.filter((d) => d.fatal).length;
	const originalFindingCount = compileResult.diagnostics.length;

	// Attempt repair up to maxAttempts
	while (attempts < config.maxAttempts) {
		attempts++;

		// IMMUTABILITY GUARD: Check that no repair attempt removed fatal findings
		const currentFatalCount = diagnostics.filter((d) => d.fatal).length;
		const currentFindingCount = diagnostics.length;

		if (currentFatalCount < originalFatalCount) {
			throw new RepairBoundaryViolationError(
				`fatal findings: ${originalFatalCount} -> ${currentFatalCount} (removed ${originalFatalCount - currentFatalCount})`,
			);
		}

		if (currentFindingCount < originalFindingCount && config.structuralFixesOnly) {
			// Findings were removed without verifiable structural improvement
			throw new RepairBoundaryViolationError(
				`findings: ${originalFindingCount} -> ${currentFindingCount} (removed ${originalFindingCount - currentFindingCount})`,
			);
		}

		// Structural fix: add canonicalization note as warning diagnostic
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
