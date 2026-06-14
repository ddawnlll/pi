/**
 * P44.5.03 — Validation Stage
 *
 * Verifies that the workspace's target command (or equivalent validation)
 * passed. Delegates to the existing completion-gate evaluation logic.
 *
 * The stage bridges the vNext pipeline with the legacy evaluateWorkspaceCompletion
 * checks: target command passed, no unresolved test failures, no watch-mode
 * commands, no out-of-retries, etc.
 *
 * Contract Schema: 4.1.1
 */

import type { WorkspaceValidationState } from "../../completion-gate.js";
import { evaluateWorkspaceCompletion } from "../../completion-gate.js";
import type { Workspace } from "../../workspace-schema.js";
import type { StageExecutionContext, StageRunner } from "../completion-gate-vnext.js";
import type { StageVerdict } from "../completion-gate-vnext-types.js";
import { createFailedStageVerdict, createPassedStageVerdict } from "../workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the validation stage.
 */
export interface ValidationStageConfig {
	/** Workspace definition (for targetCommand, validationRequirement, etc.) */
	workspace: Workspace;
	/** Current validation state (populated by the executor) */
	validationState: WorkspaceValidationState;
}

// ---------------------------------------------------------------------------
// Stage Runner Factory
// ---------------------------------------------------------------------------

/**
 * Create a stage runner for the Validation stage.
 *
 * Delegates to evaluateWorkspaceCompletion for the actual check logic.
 */
export function createValidationStageRunner(config: ValidationStageConfig): StageRunner {
	return (_stage: string, _workspace: unknown, _context: StageExecutionContext): StageVerdict => {
		const startTime = Date.now();

		const result = evaluateWorkspaceCompletion(config.validationState, config.workspace);

		if (result.canComplete) {
			return createPassedStageVerdict(
				"Validation",
				{ note: "All validation checks passed" },
				Date.now() - startTime,
			);
		}

		return createFailedStageVerdict(
			"Validation",
			result.blockReasons,
			{
				recoveryState: "NEEDS_REPAIR_OR_RAR",
				blockReasons: result.blockReasons,
			},
			Date.now() - startTime,
		);
	};
}
