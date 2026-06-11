/**
 * ACCP Gate Stage Runner (P49.18)
 *
 * CompletionGate vNext stage that checks ACCP gate verdicts.
 * When ACCP mode is "required", a blocking gate verdict prevents
 * the Active -> Complete transition.
 *
 * ## Authority
 *
 * This stage reads compiled ACCP gate verdicts and applies them
 * against the workspace's completion gate. It does NOT authorize
 * execution or mutation. It only blocks completion when the ACCP
 * gate has blocking findings and ACCP mode is required.
 *
 * @packageDocumentation
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";
import type { CompletionGateStageName, StageVerdict } from "./completion/completion-gate-vnext-types.js";

/** ACCP gate configuration for the completion gate stage. */
export interface AccpGateStageConfig {
	/** Whether ACCP mode is required (blocks on failure). */
	modeRequired: boolean;
	/** Optional ACCP gate verdict to evaluate. */
	verdict?: AccpGateVerdict;
}

/**
 * Run the ACCP gate stage.
 *
 * @param stage - Stage name (always "AccpGate").
 * @param _workspace - Workspace context (unused).
 * @param config - ACCP gate configuration.
 * @returns Stage verdict.
 */
export function runAccpGateStage(
	stage: CompletionGateStageName,
	_workspace: unknown,
	config: AccpGateStageConfig,
): StageVerdict {
	const startTime = Date.now();

	// If mode is not required, ACCP gate is advisory only
	if (!config.modeRequired) {
		return {
			stage,
			passed: true,
			warning: false,
			detail: { note: "ACCP mode is not required — gate is advisory" },
			blockReasons: [],
			warnings: [],
			evaluatedAt: Date.now(),
			durationMs: Date.now() - startTime,
		};
	}

	// If no verdict was provided, check skipped
	if (!config.verdict) {
		return {
			stage,
			passed: true,
			warning: true,
			detail: { note: "no ACCP gate verdict provided — skipped" },
			blockReasons: [],
			warnings: ["No ACCP gate verdict was provided for evaluation"],
			evaluatedAt: Date.now(),
			durationMs: Date.now() - startTime,
		};
	}

	const verdict = config.verdict;

	// Block on invalid verdict or fatal errors
	if (!verdict.valid) {
		return {
			stage,
			passed: false,
			warning: false,
			detail: {
				note: "ACCP gate verdict is not valid",
				fatalErrors: verdict.fatalErrors,
				blockingFindings: verdict.blockingFindings,
			},
			blockReasons: [...verdict.fatalErrors, ...verdict.blockingFindings.map((f) => `ACCP blocking finding: ${f}`)],
			warnings: [],
			evaluatedAt: Date.now(),
			durationMs: Date.now() - startTime,
		};
	}

	// Warn on warnings but still pass
	if (verdict.warnings.length > 0) {
		return {
			stage,
			passed: true,
			warning: true,
			detail: {
				note: "ACCP gate passed with warnings",
				warnings: verdict.warnings,
			},
			blockReasons: [],
			warnings: verdict.warnings,
			evaluatedAt: Date.now(),
			durationMs: Date.now() - startTime,
		};
	}

	// Clean pass
	return {
		stage,
		passed: true,
		warning: false,
		detail: { note: "ACCP gate passed" },
		blockReasons: [],
		warnings: [],
		evaluatedAt: Date.now(),
		durationMs: Date.now() - startTime,
	};
}
