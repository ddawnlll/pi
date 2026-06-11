/**
 * ACCP Gate Reader (P49.19)
 *
 * Reads compiled ACCP gate verdicts from the artifact store
 * and evaluates whether a workspace transition should be blocked.
 *
 * @packageDocumentation
 */

import type { AccpGateVerdict } from "@earendil-works/pi-execution-contracts";

/** ACCP gate reader result. */
export interface AccpGateReaderResult {
	/** Whether the gate allows the transition. */
	allowed: boolean;
	/** Blocking reasons (if not allowed). */
	blockingReasons: string[];
	/** The gate verdict (if available). */
	verdict?: AccpGateVerdict;
}

/**
 * Read and evaluate an ACCP gate verdict for a workspace transition.
 *
 * @param verdict - Compiled ACCP gate verdict.
 * @param modeRequired - Whether ACCP mode is required (blocks on failure).
 * @returns Gate reader result.
 */
export function evaluateAccpGateForTransition(
	verdict: AccpGateVerdict | undefined,
	modeRequired: boolean,
): AccpGateReaderResult {
	if (!modeRequired) {
		return {
			allowed: true,
			blockingReasons: [],
			verdict,
		};
	}

	if (!verdict) {
		return {
			allowed: true,
			blockingReasons: [],
			verdict: undefined,
		};
	}

	if (!verdict.valid) {
		return {
			allowed: false,
			blockingReasons: [...verdict.fatalErrors, ...verdict.blockingFindings.map((f) => `ACCP gate blocking: ${f}`)],
			verdict,
		};
	}

	return {
		allowed: true,
		blockingReasons: [],
		verdict,
	};
}
