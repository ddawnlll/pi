/**
 * P44.5.02 — CompletionGate vNext Adapter
 *
 * Provides rollout-mode-aware evaluation for CompletionGate vNext.
 * Supports shadow, warn, and block modes for phased rollout.
 *
 * Contract Schema: 4.1.1
 */

import type { CompletionGateVNextVerdict, RolloutMode } from "./completion-gate-vnext-types.js";

// ---------------------------------------------------------------------------
// Adapter Options
// ---------------------------------------------------------------------------

/**
 * Options for the CompletionGate vNext adapter.
 */
export interface CompletionGateVNextAdapterOptions {
	/** Current rollout mode */
	rolloutMode: RolloutMode;
	/** Whether this workspace requires blocking mode */
	requiredMode?: RolloutMode;
	/** Custom warning handler (e.g., log to dashboard) */
	warningHandler?: (warnings: string[]) => void;
}

// ---------------------------------------------------------------------------
// Adapter Functions
// ---------------------------------------------------------------------------

/**
 * Evaluate a raw verdict through the rollout-mode-aware adapter.
 *
 * In shadow mode: verdict is computed and returned but marked as not blocking.
 * In warn mode: warnings are emitted but not blocking.
 * In block_strict_plans: block if the plan requires blocking mode.
 * In block_all_stable_3: always block on failures.
 */
export function evaluateThroughAdapter(
	rawVerdict: CompletionGateVNextVerdict,
	options: CompletionGateVNextAdapterOptions,
): CompletionGateVNextVerdict {
	const { rolloutMode, requiredMode, warningHandler } = options;

	// Determine whether this should block
	const effectiveBlocking = shouldBlockForMode(rolloutMode, requiredMode);

	if (!effectiveBlocking) {
		// Non-blocking modes: compute but don't change verdict
		const adapted: CompletionGateVNextVerdict = {
			...rawVerdict,
			rolloutMode,
			// In non-blocking mode, the verdict ALWAYS passes (doesn't block)
			passed: true,
			// Record what would have blocked
			wouldBlockReasons: rawVerdict.passed ? undefined : rawVerdict.blockReasons,
			// But don't actually block
			blockReasons: [],
			warnings: rawVerdict.warnings,
		};

		// In warn mode, route non-blocking issues to warnings
		if (rolloutMode === "warn" && !rawVerdict.passed) {
			adapted.warnings = [...rawVerdict.warnings, ...rawVerdict.blockReasons.map((r) => `[WOULD-BLOCK] ${r}`)];
		}

		if (warningHandler && adapted.warnings.length > 0) {
			warningHandler(adapted.warnings);
		}

		return adapted;
	}

	// Blocking mode: return verdict as-is (it will block)
	return {
		...rawVerdict,
		rolloutMode,
	};
}

/**
 * Determine whether a rollout mode should block completion.
 */
export function shouldBlockForMode(mode: RolloutMode, requiredMode?: RolloutMode): boolean {
	if (!requiredMode) {
		return mode === "block_strict_plans" || mode === "block_all_stable_3";
	}
	// If a specific mode is required, block only if current mode meets the requirement
	const modeOrder: Record<RolloutMode, number> = {
		off: 0,
		shadow: 1,
		warn: 2,
		block_strict_plans: 3,
		block_all_stable_3: 4,
	};
	return modeOrder[mode] >= modeOrder[requiredMode];
}

/**
 * Decide whether the vNext gate should be used at all.
 * Off mode means skip the gate entirely.
 */
export function shouldUseVNextMode(mode: RolloutMode): boolean {
	return mode !== "off";
}
