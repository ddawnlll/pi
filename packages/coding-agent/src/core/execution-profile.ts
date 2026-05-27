import {
	type ExecutionIntent,
	deriveExecutionProfile as kernelDerive,
} from "../execution-kernel/execution-profile-deriver.js";
import { normalizeLegacyPlanToIntent as kernelNormalize } from "../execution-kernel/legacy-normalizer.js";
import type { PlanExecutionConfig, WorkspaceQueue } from "./workspace-schema.js";

export type IntentSafetyLevel = "relaxed" | "normal" | "strict";
export type IntentConflictRisk = "none" | "low" | "medium" | "high";
export type IntentExecutionEnvironmentMode = "trusted_local" | "local_sandbox" | "cloud_sandbox";

export interface IntentV4 {
	parallelism: number;
	safetyLevel: IntentSafetyLevel;
	conflictRisk: IntentConflictRisk;
	executionEnvironment: { mode: IntentExecutionEnvironmentMode };
	deadlines: Record<string, unknown>;
}

/**
 * DerivedExecutionProfile for stored plan data (WorkspaceQueue).
 *
 * This type is backward-compatible with stored plan files. For the canonical
 * derivation logic and the authoritative DerivedExecutionProfile used by the
 * ExecutionKernel, see execution-kernel/execution-profile-deriver.ts.
 *
 * Derivation LOGIC is unified: deriveExecutionProfile below delegates to the
 * kernel deriver. These core types remain separate only to preserve backward
 * compat with serialized plan data.
 */
export interface DerivedExecutionProfile {
	worktreeRequired: boolean;
	integrationQueueRequired: boolean;
	validationLaneRequired: boolean;
	gitRunnerQueueRequired: boolean;
	eventJournalRequired: boolean;
	writeSetDriftDetectionRequired: boolean;
	writeSetDriftBlockOnConflict: boolean;
	heavyValidationMax?: number;
	targetedValidationMax?: number;
	admissionGateMode: "normal" | "strict";
	explicitApprovalRequired: boolean;
	sandboxRequirements: string[];
	explanations: string[];
}

export interface LegacyNormalizationResult {
	intent: IntentV4;
	warnings: string[];
}

/**
 * Derive an execution profile from v4 intent.
 *
 * Delegates to the kernel's authoritative deriveExecutionProfile, then
 * adapts the result to the backward-compatible core DerivedExecutionProfile
 * type. This ensures there is exactly ONE derivation logic path.
 */
export function deriveExecutionProfile(intent: IntentV4): DerivedExecutionProfile {
	const kernelIntent: ExecutionIntent = {
		parallelism: intent.parallelism,
		safetyLevel: intent.safetyLevel,
		conflictRisk: intent.conflictRisk,
		executionEnvironment: intent.executionEnvironment,
		deadlines:
			Object.keys(intent.deadlines ?? {}).length > 0 ? (intent.deadlines as Record<string, number>) : undefined,
	};
	const kernelProfile = kernelDerive(kernelIntent);
	// Adapt kernel profile (canonical) to core profile (backward-compat)
	return {
		worktreeRequired: kernelProfile.worktreeRequired,
		integrationQueueRequired: kernelProfile.integrationQueueRequired,
		validationLaneRequired: kernelProfile.validationLanesRequired,
		gitRunnerQueueRequired: kernelProfile.gitRunnerQueueRequired,
		eventJournalRequired: kernelProfile.eventJournalRequired,
		writeSetDriftDetectionRequired: kernelProfile.writeSetDriftDetectionRequired,
		writeSetDriftBlockOnConflict: kernelProfile.writeSetDriftBlockOnConflict,
		heavyValidationMax: kernelProfile.heavyValidationMax,
		targetedValidationMax: kernelProfile.targetedValidationMax,
		admissionGateMode: kernelProfile.admissionGateMode,
		explicitApprovalRequired: kernelProfile.explicitApprovalRequired,
		sandboxRequirements: kernelProfile.sandboxRequirements,
		explanations: kernelProfile.explanations,
	};
}

export function normalizeLegacyPlanToIntentV4(input: {
	maxParallelWorkspaces?: number;
	planExecution?: { scale?: { selectedMode?: string } };
	worktreeRequired?: boolean;
	integrationQueueRequired?: boolean;
	validationLockRequired?: boolean;
}): LegacyNormalizationResult {
	const kernelInput = {
		maxParallelWorkspaces: input.maxParallelWorkspaces,
		scale: input.planExecution?.scale ? { selectedMode: input.planExecution.scale.selectedMode } : undefined,
		worktreeRequired: input.worktreeRequired,
		integrationQueueRequired: input.integrationQueueRequired,
		validationLockRequired: input.validationLockRequired,
	};
	const kernelResult = kernelNormalize(kernelInput);
	return {
		intent: {
			parallelism: kernelResult.intent.parallelism,
			safetyLevel: kernelResult.intent.safetyLevel,
			conflictRisk: kernelResult.intent.conflictRisk,
			executionEnvironment: kernelResult.intent.executionEnvironment,
			deadlines: (kernelResult.intent.deadlines ?? {}) as Record<string, unknown>,
		},
		warnings: kernelResult.warnings.map((w) => w.message),
	};
}

export function derivePlanExecutionFromProfile(profile: DerivedExecutionProfile): PlanExecutionConfig {
	return {
		scale: { selectedMode: "experimental_6" },
		worktree: profile.worktreeRequired ? { enabled: true } : undefined,
		integrationQueue: { enabled: profile.integrationQueueRequired },
		validation: { globalValidationLockRequired: profile.validationLaneRequired },
	};
}

export function applyIntentV4ToQueue<T extends WorkspaceQueue>(queue: T, intent: IntentV4): T {
	const derivedProfile = deriveExecutionProfile(intent);
	return {
		...queue,
		contractVersion: "4.0.0",
		maxParallelWorkspaces: intent.parallelism,
		intent,
		derivedProfile,
		planExecution: {
			...queue.planExecution,
			...derivePlanExecutionFromProfile(derivedProfile),
		},
	};
}
