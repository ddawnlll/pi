/**
 * P44.6.08 — P44.6 Readiness Gate
 *
 * The admission checkpoint for the entire P44.6 pipeline.
 * Blocks execution when mode, target, scope, acceptance criteria,
 * or evidence requirements are missing or contradictory.
 *
 * This gate runs after mode compilation but before any tool execution.
 * It is the last check before the pipeline proceeds to the write-gate
 * or edit-scope guard.
 *
 * Contract Schema: 4.1.1
 */

import type { NormalizationResult } from "./acceptance-criteria-normalizer.js";
import { EngineMode } from "./engine-mode.js";
import type { DiagnosticCollection, ModeDiagnostic } from "./mode-diagnostic.js";
import type { ModeMappingResult } from "./mode-mapping-compiler.js";
import type { TargetResolutionCollection } from "./target-artifact-resolver.js";

// ---------------------------------------------------------------------------
// Gate Inputs
// ---------------------------------------------------------------------------

/**
 * All inputs required by the Readiness Gate to make a decision.
 */
export interface ReadinessGateInputs {
	/** The mode mapping result (mode + config + diagnostics). */
	modeMapping: ModeMappingResult;
	/** The target resolution collection (filesystem state). */
	targetResolution: TargetResolutionCollection;
	/** The normalized acceptance criteria. */
	criteria: NormalizationResult;
}

// ---------------------------------------------------------------------------
// Gate Verdict
// ---------------------------------------------------------------------------

/**
 * The readiness gate verdict.
 * - pass: All checks passed. Execution may proceed.
 * - fail: One or more blocking issues. Execution must not proceed.
 * - warning: Non-blocking issues found. Execution may proceed with warnings.
 */
export type ReadinessVerdict = "pass" | "fail" | "warning";

/**
 * The result of the readiness gate evaluation.
 */
export interface ReadinessGateResult extends DiagnosticCollection {
	/** Whether the gate passed (admission granted). */
	passed: boolean;
	/** The gate verdict. */
	verdict: ReadinessVerdict;
	/** Summary of what was checked. */
	summary: string;
	/** Blocking diagnostics (convenience — also in diagnostics). */
	blockingDiagnostics: ModeDiagnostic[];
}

// ---------------------------------------------------------------------------
// Gate Checks
// ---------------------------------------------------------------------------

/**
 * Check that a mode was successfully resolved.
 */
function checkModeResolved(modeMapping: ModeMappingResult): ModeDiagnostic[] {
	if (!modeMapping.success || modeMapping.mode === null) {
		return [
			{
				severity: "blocking",
				code: "BLOCKED_AMBIGUOUS_MODE",
				message:
					"Engine mode could not be resolved. All mode blocking diagnostics must be resolved before proceeding.",
				details: modeMapping.diagnostics.map((d) => `[${d.code}] ${d.message}`).join("; "),
			},
		];
	}
	return [];
}

/**
 * Check that targets are resolvable for the given mode.
 */
function checkTargets(mode: EngineMode, targetResolution: TargetResolutionCollection): ModeDiagnostic[] {
	const diagnostics: ModeDiagnostic[] = [];

	if (mode === EngineMode.Write || mode === EngineMode.SmartWrite) {
		// Write modes: target should not already exist (unless overwrite allowed)
		if (targetResolution.allExist && targetResolution.resolutions.length > 0) {
			diagnostics.push({
				severity: "blocking",
				code: "BLOCKED_MISSING_TARGET",
				message: `Write mode requested but target already exists: ${targetResolution.allPaths.join(", ")}. Use edit mode or set overwrite policy.`,
			});
		}
	}

	if (mode === EngineMode.Edit || mode === EngineMode.SmartEdit) {
		// Edit modes: target must exist
		if (!targetResolution.allExist && targetResolution.resolutions.length > 0) {
			diagnostics.push({
				severity: "blocking",
				code: "BLOCKED_MISSING_TARGET",
				message: `Edit mode requested but target does not exist: ${targetResolution.allPaths.filter((_, i) => !targetResolution.resolutions[i] || targetResolution.resolutions[i].existence !== "exists").join(", ")}. Use write mode to create.`,
			});
		}
	}

	if (targetResolution.anyUnsafeOverwrite) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_LARGE_OVERWRITE",
			message: "One or more targets have unsafe overwrite conditions. Resolve overwrite safety before proceeding.",
		});
	}

	return diagnostics;
}

/**
 * Check that acceptance criteria are present and valid.
 */
function checkCriteria(criteria: NormalizationResult): ModeDiagnostic[] {
	const diagnostics: ModeDiagnostic[] = [];

	if (criteria.criteria.length === 0) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_EVIDENCE_MISSING",
			message: "No acceptance criteria defined. At least one criterion is required before execution.",
		});
	}

	const requiredCriteria = criteria.criteria.filter((c) => c.required);
	if (requiredCriteria.length === 0) {
		diagnostics.push({
			severity: "warning",
			code: "WARN_MISSING_CONSTRAINTS",
			message:
				"No required acceptance criteria found. All criteria are optional — consider adding at least one required criterion.",
		});
	}

	return diagnostics;
}

// ---------------------------------------------------------------------------
// Main Gate
// ---------------------------------------------------------------------------

/**
 * Evaluate the readiness gate.
 *
 * Checks (in order):
 * 1. Mode was resolved successfully.
 * 2. Targets are appropriate for the mode.
 * 3. Acceptance criteria are present and valid.
 *
 * Returns a verdict. If verdict is "fail", the pipeline must NOT proceed.
 */
export function evaluateReadiness(inputs: ReadinessGateInputs): ReadinessGateResult {
	const allDiagnostics: ModeDiagnostic[] = [];

	// Check 1: Mode resolved
	const modeErrors = checkModeResolved(inputs.modeMapping);
	allDiagnostics.push(...modeErrors);

	// Check 2: Targets
	const targetErrors = checkTargets(inputs.modeMapping.mode ?? EngineMode.Write, inputs.targetResolution);
	allDiagnostics.push(...targetErrors);

	// Check 3: Criteria
	const criteriaErrors = checkCriteria(inputs.criteria);
	allDiagnostics.push(...criteriaErrors);

	// Combine with pre-existing diagnostics
	allDiagnostics.push(
		...inputs.modeMapping.diagnostics.filter((d) => !allDiagnostics.some((ad) => ad.message === d.message)),
	);

	const blockingDiagnostics = allDiagnostics.filter((d) => d.severity === "blocking");
	const hasBlocking = blockingDiagnostics.length > 0;
	const hasWarnings = allDiagnostics.some((d) => d.severity === "warning");

	const verdict: ReadinessVerdict = hasBlocking ? "fail" : hasWarnings ? "warning" : "pass";

	const summary = buildSummary(inputs, verdict, allDiagnostics);

	return {
		passed: !hasBlocking,
		verdict,
		summary,
		diagnostics: allDiagnostics,
		blockingDiagnostics,
	};
}

/**
 * Build a human-readable summary of the readiness check.
 */
function buildSummary(inputs: ReadinessGateInputs, verdict: ReadinessVerdict, diagnostics: ModeDiagnostic[]): string {
	const mode = inputs.modeMapping.mode ?? "null";
	const targetCount = inputs.targetResolution.resolutions.length;
	const criteriaCount = inputs.criteria.criteria.length;
	const diagnosticCount = diagnostics.length;

	const parts: string[] = [
		`Readiness Gate: ${verdict.toUpperCase()}`,
		`Mode: ${mode}`,
		`Targets: ${targetCount}`,
		`Criteria: ${criteriaCount}`,
		`Diagnostics: ${diagnosticCount}`,
	];

	if (diagnostics.length > 0) {
		const blockingCount = diagnostics.filter((d) => d.severity === "blocking").length;
		parts.push(`Blocking: ${blockingCount}, Warnings: ${diagnosticCount - blockingCount}`);
	}

	return parts.join(" | ");
}
