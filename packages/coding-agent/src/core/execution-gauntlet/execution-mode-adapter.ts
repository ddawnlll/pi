/**
 * Execution Mode Adapter — P38.1
 *
 * Adapts execution behavior based on stable_3 and patch_transaction modes.
 * Each mode has different invariants around parallelism, patch application,
 * direct mutations, and validation.
 */

import type { GauntletPlan } from "./synthetic-plan-builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GauntletExecutionMode = "stable_3" | "patch_transaction";

export interface ExecutionModeContext {
	mode: GauntletExecutionMode;
	plan: GauntletPlan;
	/** Effective max parallel workers for this plan under this mode */
	maxWorkers: number;
	/** Whether workers can directly mutate the repo */
	workersCanMutateRepo: boolean;
	/** Whether PatchCoordinator is required for mutations */
	patchCoordinatorRequired: boolean;
	/** Whether writeSet is enforced */
	writeSetEnforced: boolean;
	/** Whether base hash is required for patches */
	baseHashRequired: boolean;
	/** Whether rollback is required */
	rollbackRequired: boolean;
	/** Number of patch apply lanes */
	patchApplyLanes: number;
	/** Whether stop/continue is supported */
	stopContinueSupported: boolean;
	/** Whether final validation is required */
	finalValidationRequired: boolean;
	/** Whether CompletionGate is active */
	completionGateActive: boolean;
	/** Whether LeadAgent retry prevention is active */
	leadAgentActive: boolean;
	/** Documentation of mode limitations */
	limitations: string[];
}

/**
 * P39.01: Stable_3 execution profile definition.
 * This is the canonical profile — must not be silently mutated.
 */
export const STABLE_3_PROFILE = {
	maxParallelWorkspaces: 3,
	worktreeRequired: false,
	patchIsolationRequired: false,
	patchTransaction: false as const,
	finalValidationRequired: true,
	leadAgentEnabled: true,
	completionGateEnabled: true,
	commandHistoryRequired: true,
	stopContinueRecoveryEnabled: true,
} as const;

/**
 * P39.01: Verify that a context matches the stable_3 profile invariants.
 */
export function assertStable3Profile(ctx: ExecutionModeContext): string[] {
	if (ctx.mode !== "stable_3") return [];
	const violations: string[] = [];
	if (ctx.maxWorkers > 3) violations.push(`maxWorkers ${ctx.maxWorkers} > 3`);
	if (ctx.patchCoordinatorRequired) violations.push("patchCoordinatorRequired is true (stable_3 must not use patch coordinator)");
	if (ctx.writeSetEnforced) violations.push("writeSetEnforced is true (stable_3 must not enforce writeSet)");
	if (!ctx.completionGateActive) violations.push("completionGateActive is false");
	if (!ctx.leadAgentActive) violations.push("leadAgentActive is false");
	if (!ctx.finalValidationRequired) violations.push("finalValidationRequired is false");
	if (!ctx.stopContinueSupported) violations.push("stopContinueSupported is false");
	return violations;
}

// ---------------------------------------------------------------------------
// Mode adapter factory
// ---------------------------------------------------------------------------

export function createExecutionModeContext(mode: GauntletExecutionMode, plan: GauntletPlan): ExecutionModeContext {
	switch (mode) {
		case "stable_3":
			return createStable3Context(plan);
		case "patch_transaction":
			return createPatchTransactionContext(plan);
	}
}

function createStable3Context(plan: GauntletPlan): ExecutionModeContext {
	return {
		mode: "stable_3",
		plan,
		maxWorkers: Math.min(plan.maxParallelWorkspaces ?? 3, 3),
		workersCanMutateRepo: true,
		patchCoordinatorRequired: false,
		writeSetEnforced: false,
		baseHashRequired: false,
		rollbackRequired: false,
		patchApplyLanes: 0,
		stopContinueSupported: true,
		finalValidationRequired: true,
		completionGateActive: true,
		leadAgentActive: true,
		limitations: [],
	};
}

function createPatchTransactionContext(plan: GauntletPlan): ExecutionModeContext {
	return {
		mode: "patch_transaction",
		plan,
		maxWorkers: plan.maxParallelWorkspaces ?? 3,
		workersCanMutateRepo: false,
		patchCoordinatorRequired: true,
		writeSetEnforced: true,
		baseHashRequired: true,
		rollbackRequired: true,
		patchApplyLanes: 1,
		stopContinueSupported: true,
		finalValidationRequired: true,
		completionGateActive: true,
		leadAgentActive: true,
		limitations: [
			"patch_transaction mode in gauntlet tests control-plane semantics only",
			"Full production patch_transaction with real codegen is not required for fast mode",
			"Real LLM patch generation is not exercised here",
		],
	};
}

// ---------------------------------------------------------------------------
// Mode-aware assertions
// ---------------------------------------------------------------------------

/**
 * Check if a given behavior is valid under the current execution mode.
 */
export function isBehaviorValidForMode(
	behavior: string,
	ctx: ExecutionModeContext,
): { valid: boolean; reason?: string } {
	if (ctx.mode === "patch_transaction") {
		// Patch behaviors are only valid in patch_transaction mode
		const patchBehaviors = ["patch_non_overlapping", "patch_write_set_violation", "patch_stale_hash"];

		// Non-patch behaviors can also run — they just won't produce patches
		if (!patchBehaviors.includes(behavior) && behavior.startsWith("patch")) {
			return { valid: false, reason: `Behavior "${behavior}" requires patch_transaction mode` };
		}
	}

	return { valid: true };
}

/**
 * Check if direct repo mutation is allowed in this mode.
 */
export function isDirectMutationAllowed(ctx: ExecutionModeContext): boolean {
	return ctx.workersCanMutateRepo;
}
