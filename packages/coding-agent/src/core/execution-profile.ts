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

export function deriveExecutionProfile(intent: IntentV4): DerivedExecutionProfile {
	const explanations: string[] = [];
	const profile: DerivedExecutionProfile = {
		worktreeRequired: false,
		integrationQueueRequired: false,
		validationLaneRequired: true,
		gitRunnerQueueRequired: true,
		eventJournalRequired: false,
		writeSetDriftDetectionRequired: false,
		writeSetDriftBlockOnConflict: false,
		admissionGateMode: intent.safetyLevel === "strict" ? "strict" : "normal",
		explicitApprovalRequired: false,
		sandboxRequirements: [],
		explanations,
	};

	if (intent.parallelism < 1 || intent.parallelism > 8) {
		throw new Error(`intent.parallelism must be between 1 and 8, got ${intent.parallelism}`);
	}
	if (intent.safetyLevel === "relaxed" && intent.parallelism > 1) {
		throw new Error("relaxed safetyLevel is only allowed for parallelism <= 1");
	}

	if (intent.parallelism === 1) {
		profile.worktreeRequired = intent.safetyLevel === "strict" || ["medium", "high"].includes(intent.conflictRisk);
		profile.integrationQueueRequired = intent.safetyLevel === "strict";
		explanations.push("parallelism=1 enables minimal coordination defaults");
	} else if (intent.parallelism <= 3) {
		profile.worktreeRequired = ["medium", "high"].includes(intent.conflictRisk) || intent.safetyLevel === "strict";
		profile.integrationQueueRequired = profile.worktreeRequired;
		explanations.push("parallelism=2-3 derives conditional worktree/integration requirements");
	} else if (intent.parallelism <= 6) {
		profile.worktreeRequired = true;
		profile.integrationQueueRequired = true;
		profile.eventJournalRequired = true;
		profile.heavyValidationMax = 1;
		profile.targetedValidationMax = 3;
		profile.admissionGateMode = "strict";
		explanations.push("parallelism=4-6 requires strict execution controls");
	} else {
		profile.worktreeRequired = true;
		profile.integrationQueueRequired = true;
		profile.eventJournalRequired = true;
		profile.explicitApprovalRequired = true;
		profile.admissionGateMode = "strict";
		explanations.push("parallelism=7-8 requires explicit approval and stress readiness");
	}

	if (intent.safetyLevel === "strict") {
		profile.eventJournalRequired = true;
		profile.integrationQueueRequired = true;
		explanations.push("strict safety level forces event journal and integration queue");
	}

	if (intent.conflictRisk === "medium") {
		profile.worktreeRequired = intent.parallelism >= 2 || profile.worktreeRequired;
		profile.integrationQueueRequired = true;
		profile.writeSetDriftDetectionRequired = true;
		explanations.push("medium conflict risk enables drift detection");
	}
	if (intent.conflictRisk === "high") {
		profile.worktreeRequired = true;
		profile.integrationQueueRequired = true;
		profile.writeSetDriftDetectionRequired = true;
		profile.writeSetDriftBlockOnConflict = true;
		explanations.push("high conflict risk requires blocking drift behavior");
	}

	if (intent.executionEnvironment.mode === "trusted_local") {
		profile.sandboxRequirements.push("process_group_kill_required");
	} else if (intent.executionEnvironment.mode === "local_sandbox") {
		profile.sandboxRequirements.push(
			"cpu_memory_disk_pid_quotas_required",
			"network_policy_required",
			"env_allowlist_required",
			"worktree_scoped_mount_required",
		);
	} else {
		profile.sandboxRequirements.push(
			"cpu_memory_disk_pid_quotas_required",
			"network_policy_required",
			"env_allowlist_required",
			"worktree_scoped_mount_required",
			"egress_firewall_required",
			"ephemeral_credentials_required",
			"per_attempt_container_vm_required",
		);
	}

	return profile;
}

export function normalizeLegacyPlanToIntentV4(input: {
	maxParallelWorkspaces?: number;
	planExecution?: { scale?: { selectedMode?: string } };
	worktreeRequired?: boolean;
	integrationQueueRequired?: boolean;
	validationLockRequired?: boolean;
}): LegacyNormalizationResult {
	const warnings: string[] = [];
	const parallelism =
		input.maxParallelWorkspaces ?? (input.planExecution?.scale?.selectedMode === "experimental_6" ? 6 : 3);
	const safetyLevel: IntentSafetyLevel =
		input.planExecution?.scale?.selectedMode === "experimental_6" ? "strict" : "normal";
	const conflictRisk: IntentConflictRisk = input.worktreeRequired || input.integrationQueueRequired ? "medium" : "low";
	if (input.worktreeRequired !== undefined) warnings.push("worktreeRequired is deprecated and treated as a hint only");
	if (input.integrationQueueRequired !== undefined)
		warnings.push("integrationQueueRequired is deprecated and treated as a hint only");
	if (input.validationLockRequired !== undefined)
		warnings.push("validationLockRequired is deprecated and treated as a hint only");
	return {
		intent: {
			parallelism,
			safetyLevel,
			conflictRisk,
			executionEnvironment: { mode: "trusted_local" },
			deadlines: {},
		},
		warnings,
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
